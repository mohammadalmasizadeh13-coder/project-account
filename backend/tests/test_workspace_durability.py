from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from threading import Barrier, Lock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, select

from app.database import empty_workspace, workspace_requests
from app.main import create_app
from app.settings import Settings
from test_accounts import create_staff, login_as, staff_browser
from test_api import ORIGIN, PASSWORD_HASH, client, login, stock_document


def document(identifier="saved-document"):
    return stock_document(id=identifier, craftedKind="انگشتر", type="crafted-purchase", source="purchase",
        gramPrice="100000", profitPercent="7", amount=535000, gramDebt=2.5, rialDebt=10000,
        recordedAt="2026-09-27T15:00:00+00:00")


def request(data, revision=0, request_id=None):
    return {"revision": revision, "requestId": request_id or str(uuid4()), "data": data}


def receipts(client):
    with client.app.state.engine.connect() as connection:
        return connection.execute(select(workspace_requests)).mappings().all()


def test_acknowledged_document_and_all_accounting_fields_survive_restart_and_lost_response(tmp_path):
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'restart.db'}", upload_dir=tmp_path / "uploads",
        owner_username="owner", owner_password_hash=PASSWORD_HASH, cookie_secure=False, origins=(ORIGIN,))
    data = {**empty_workspace(), "documents": [document()],
        "customers": [{"id": "private-customer", "name": "فروشنده", "gramDebt": -2.5, "rialDebt": -10000,
            "purchases": [{"id": "saved-document", "amount": 535000}], "settlements": [{"id": "old-payment", "rialAmount": 500}]}],
        "prices": {"goldGramPrice": "100000"}, "openingSetup": {"completed": True},
        "goldPurchases": [{"id": "purchase-record", "weight": "2.5"}],
        "cheques": [{"id": "cheque-record", "amount": "10000", "status": "pending"}]}
    payload = request(data)
    with TestClient(create_app(settings)) as first:
        headers = login(first)
        saved = first.put("/api/owner/workspace", json=payload, headers=headers)
        assert saved.status_code == 200, saved.text
        assert saved.json()["data"] == data
        # Committed financial records remain unavailable through retired public routes.
        assert first.get("/api/public/products/saved-document").status_code == 404

    with TestClient(create_app(settings)) as restarted:
        headers = login(restarted)
        assert restarted.get("/api/owner/workspace").json() == saved.json()
        # Simulate a lost HTTP acknowledgement: the original stale request is sent again.
        retried = restarted.put("/api/owner/workspace", json=payload, headers=headers)
        assert retried.status_code == 200 and retried.json() == saved.json()
        assert len(receipts(restarted)) == 1
        assert restarted.get("/api/public/products/saved-document").status_code == 404


def test_replay_after_later_edits_returns_latest_workspace_without_reverting_it(client):
    headers = login(client)
    payload = request({"documents": [document()], "customers": [{"id": "customer", "name": "اول"}]})
    saved = client.put("/api/owner/workspace", json=payload, headers=headers)
    assert saved.status_code == 200, saved.text
    later = client.put("/api/owner/workspace", json=request({"documents": [document(), document("later-document")],
        "customers": [{"id": "customer", "name": "اصلاح شده"}]}, revision=1), headers=headers)
    assert later.status_code == 200, later.text
    # JSON object key ordering and the retry's revision are not the operation identity.
    reordered = {key: payload["data"][key] for key in reversed(payload["data"])}
    reordered["documents"] = [{key: value for key, value in reversed(list(document().items()))}]
    replay = client.put("/api/owner/workspace", json={**payload, "revision": 500, "data": reordered}, headers=headers)
    assert replay.status_code == 200 and replay.json() == later.json()
    assert len(receipts(client)) == 2


def test_reusing_request_id_with_different_data_cannot_overwrite_documents(client):
    headers = login(client)
    payload = request({"documents": [document()]})
    saved = client.put("/api/owner/workspace", json=payload, headers=headers).json()
    changed = {**payload, "revision": saved["revision"], "data": {"documents": []}}
    assert client.put("/api/owner/workspace", json=changed, headers=headers).status_code == 409
    assert client.get("/api/owner/workspace").json() == saved
    assert len(receipts(client)) == 1


def test_stale_save_keeps_data_and_does_not_consume_id_for_a_corrected_retry(client):
    headers = login(client)
    first = client.put("/api/owner/workspace", json=request({"documents": [document()]}), headers=headers).json()
    pending = request({"documents": [document(), document("second-document")]})
    assert client.put("/api/owner/workspace", json=pending, headers=headers).status_code == 409
    assert client.get("/api/owner/workspace").json() == first
    assert len(receipts(client)) == 1
    corrected = client.put("/api/owner/workspace", json={**pending, "revision": first["revision"]}, headers=headers)
    assert corrected.status_code == 200 and len(corrected.json()["data"]["documents"]) == 2
    assert len(receipts(client)) == 2


def test_receipt_insert_failure_rolls_back_every_accounting_change(client):
    headers = login(client)
    before = client.get("/api/owner/workspace").json()
    payload = request({"documents": [document()], "customers": [{"id": "seller", "rialDebt": 10000}]})

    def fail_receipt(connection, cursor, statement, parameters, context, executemany):
        if statement.startswith("INSERT INTO noor_workspace_requests"):
            raise RuntimeError("simulated receipt storage failure")

    engine = client.app.state.engine
    event.listen(engine, "before_cursor_execute", fail_receipt)
    try:
        with pytest.raises(RuntimeError, match="simulated receipt storage failure"):
            client.put("/api/owner/workspace", json=payload, headers=headers)
    finally:
        event.remove(engine, "before_cursor_execute", fail_receipt)
    assert client.get("/api/owner/workspace").json() == before
    assert receipts(client) == []
    assert client.get("/api/public/products").status_code == 404
    retry = client.put("/api/owner/workspace", json=payload, headers=headers)
    assert retry.status_code == 200 and retry.json()["revision"] == 1
    assert len(receipts(client)) == 1


def test_simultaneous_duplicate_requests_commit_only_once(client, monkeypatch):
    import app.main as main

    headers = login(client)
    payload = request({"documents": [document()]})
    original_read = main.read_workspace
    barrier = Barrier(2)
    lock = Lock()
    reads = 0

    def read_together(connection, *args, **kwargs):
        nonlocal reads
        result = original_read(connection, *args, **kwargs)
        with lock:
            reads += 1
            synchronize = reads <= 2
        if synchronize:
            barrier.wait(timeout=10)
        return result

    monkeypatch.setattr(main, "read_workspace", read_together)
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(client.put, "/api/owner/workspace", json=deepcopy(payload), headers=headers) for _ in range(2)]
        responses = [future.result(timeout=20) for future in futures]
    assert [response.status_code for response in responses] == [200, 200]
    assert responses[0].json() == responses[1].json()
    assert responses[0].json()["revision"] == 1
    assert len(responses[0].json()["data"]["documents"]) == 1
    assert len(receipts(client)) == 1


def test_replay_is_actor_scoped_and_permissions_are_checked_before_acknowledgement(client):
    owner_headers = login(client)
    account = create_staff(client, owner_headers, permissions=["documents.write"])
    staff = staff_browser(client)
    headers = login_as(staff, account["username"])
    payload = request({"documents": [document()]})
    saved = staff.put("/api/owner/workspace", json=payload, headers=headers)
    assert saved.status_code == 200 and set(saved.json()["data"]) == {"documents"}
    replayed = staff.put("/api/owner/workspace", json=payload, headers=headers)
    assert replayed.status_code == 200 and replayed.json() == saved.json()
    assert client.put("/api/owner/workspace", json=payload, headers=owner_headers).status_code == 409
    assert staff.put("/api/owner/workspace", json=payload, headers={"Origin": ORIGIN}).status_code == 403
    assert client.patch(f"/api/owner/users/{account['id']}", json={"permissions": ["documents.read"]}, headers=owner_headers).status_code == 200
    readonly_headers = login_as(staff, account["username"])
    assert staff.put("/api/owner/workspace", json=payload, headers=readonly_headers).status_code == 403
    assert len(receipts(client)) == 1


def test_legacy_requests_without_id_still_save_with_revision_protection(client):
    headers = login(client)
    payload = {"revision": 0, "data": {"documents": [document()]}}
    saved = client.put("/api/owner/workspace", json=payload, headers=headers)
    assert saved.status_code == 200 and saved.json()["revision"] == 1
    assert client.put("/api/owner/workspace", json=payload, headers=headers).status_code == 409
    assert receipts(client) == []


@pytest.mark.parametrize("request_id", ["invalid", "", 123])
def test_invalid_request_ids_cannot_mutate_workspace(client, request_id):
    headers = login(client)
    payload = {"requestId": request_id, "revision": 0, "data": {"documents": [document()]}}
    assert client.put("/api/owner/workspace", json=payload, headers=headers).status_code == 422
    assert client.get("/api/owner/workspace").json()["revision"] == 0
    assert receipts(client) == []


def test_sqlite_durable_commit_settings_apply_to_new_connections(client):
    engine = client.app.state.engine
    for _ in range(2):
        with engine.connect() as connection:
            assert connection.exec_driver_sql("PRAGMA journal_mode").scalar_one() == "wal"
            assert connection.exec_driver_sql("PRAGMA synchronous").scalar_one() == 2  # FULL
        engine.dispose()
