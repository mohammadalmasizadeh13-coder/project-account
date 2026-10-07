from copy import deepcopy
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Lock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event

from app.database import empty_workspace
from app.main import create_app
from app.settings import Settings
from test_api import ORIGIN, PASSWORD_HASH, client, login, restore_historical_workspace
from test_workspace_durability import receipts


def invoice(categories=("melted", "coin", "crafted"), operation="purchase", **overrides):
    transaction = str(uuid4())
    common = {"invoiceVersion": 1, "transactionId": transaction, "invoiceLineCount": len(categories),
        "customerId": "invoice-customer", "customerName": "طرف حساب", "date": "2026-09-27",
        "createdAt": "2026-09-27T17:00:00.000Z", "recordedAt": "2026-09-27T17:00:00.000Z",
        "direction": "فروش" if operation == "sale" else "خرید", "itemCount": "1", "wagePercent": "0",
        "wageFixed": "0", "profitPercent": "7", "gold18Price": "100000", **overrides}
    details = {
        "crafted": {"craftedKind": "النگو", "itemName": "النگو نور", "weight": "2.25", "ayar": "750", "gramPrice": "100000"},
        "melted": {"itemName": "آب‌شده تهران", "meltedWeight": "4.24", "meltedAyar": "786", "meltedGramPrice": "100000",
            "assayCode": "100705", "laboratoryName": "آزمایشگاه تهران"},
        "coin": {"itemName": "سکه امامی", "coinType": "امامی", "coinCount": "1", "coinPrice": "1000000"},
        "currency": {"itemName": "دلار", "currencyType": "USD", "currencyAmount": "100.25", "currencyRate": "75000"},
    }
    return [{**common, **details[category], "id": str(uuid4()), "type": f"{category}-{operation}", "category": category,
        "invoiceLine": index + 1, "amount": 123456.789 + index, "gramDebt": 0.5 if index == 0 else 0,
        "rialDebt": 1000 if index == 0 else 0} for index, category in enumerate(categories)]


def save(client, headers, documents, **changes):
    workspace = client.get("/api/owner/workspace").json()
    return client.put("/api/owner/workspace", json={"revision": workspace["revision"], "requestId": str(uuid4()),
        "data": {"documents": documents, **changes}}, headers=headers)


def source(category="crafted", count="2", **overrides):
    row = invoice((category,))[0]
    for key in ("invoiceVersion", "invoiceLine", "invoiceLineCount", "transactionId"):
        row.pop(key)
    return {**row, "source": "opening-inventory", "type": f"opening-{category}", "date": "2026-09-26",
        "customerName": "موجودی اولیه", "customerId": "", "itemCount": count, "coinCount": count,
        "currencyAmount": count, "gramDebt": 0, "rialDebt": 0, **overrides}


def test_mixed_invoice_gets_one_number_preserves_each_amount_and_survives_restart_and_replay(tmp_path):
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'invoices.db'}", upload_dir=tmp_path / "uploads",
        owner_username="owner", owner_password_hash=PASSWORD_HASH, cookie_secure=False, origins=(ORIGIN,))
    rows = invoice(("melted", "coin", "crafted", "currency"), customerName="  طرف حساب  ")
    customer = {"id": "invoice-customer", "name": "طرف حساب", "gramDebt": -0.5, "rialDebt": -1000,
        "purchases": [{"id": row["id"], "amount": row["amount"], "transactionId": row["transactionId"]} for row in rows]}
    payload = {"revision": 0, "requestId": str(uuid4()), "data": {"documents": rows, "customers": [customer]}}
    with TestClient(create_app(settings)) as first:
        headers = login(first)
        response = first.put("/api/owner/workspace", json=payload, headers=headers)
        assert response.status_code == 200, response.text
        saved = response.json()
        expected = [{**row, "customerName": "طرف حساب", "invoiceNumber": 1} for row in rows]
        assert saved["data"]["documents"] == expected
        assert saved["data"]["customers"] == [customer]
        assert first.get("/api/public/products").status_code == 404
    with TestClient(create_app(settings)) as restarted:
        headers = login(restarted)
        assert restarted.get("/api/owner/workspace").json() == saved
        replay = restarted.put("/api/owner/workspace", json=payload, headers=headers)
        assert replay.status_code == 200 and replay.json() == saved
        assert len(receipts(restarted)) == 1


def test_numbering_is_server_assigned_after_highest_historical_number_and_new_groups(client):
    headers = login(client)
    historical = source(invoiceNumber="80")
    restore_historical_workspace(client, {**empty_workspace(), "documents": [historical]})
    first, second = invoice(invoiceNumber=3), invoice(("coin",), invoiceNumber=3)
    response = save(client, headers, [*first, *second, historical])
    assert response.status_code == 200, response.text
    rows = response.json()["data"]["documents"]
    assert [row["invoiceNumber"] for row in rows] == [81, 81, 81, 82, "80"]
    assert rows[-1] == historical
    third = invoice(("crafted",))
    response = save(client, headers, [*third, *rows])
    assert response.status_code == 200 and response.json()["data"]["documents"][0]["invoiceNumber"] == 83


@pytest.mark.parametrize("changes", [
    {"invoiceLineCount": 4}, {"invoiceLine": 1}, {"invoiceLine": 0}, {"invoiceLine": True},
    {"invoiceLineCount": "3"}, {"invoiceVersion": True}, {"invoiceVersion": 2},
    {"customerId": "someone-else"}, {"customerName": "شخص دیگر"}, {"customerName": " "},
    {"date": "2026-09-26"}, {"date": "2026-02-30"}, {"createdAt": "2026-09-27T18:00:00.000Z"},
    {"createdAt": "not-a-time"}, {"recordedAt": "2026-09-27T18:00:00.000Z"},
    {"type": "coin-sale", "direction": "فروش"}, {"direction": "فروش"},
    {"gramDebt": "1"}, {"rialDebt": "1"}, {"amount": -1}, {"coinCount": 0}, {"coinCount": "1.5"},
    {"transactionId": "not-a-uuid"},
])
def test_invalid_row_rejects_entire_invoice_and_customer_change(client, changes):
    headers = login(client)
    before = client.get("/api/owner/workspace").json()
    rows = invoice()
    rows[1].update(changes)
    response = save(client, headers, rows, customers=[{"id": "invoice-customer", "rialDebt": 500}])
    assert response.status_code == 422, response.text
    assert client.get("/api/owner/workspace").json() == before
    assert receipts(client) == []


def test_group_cannot_omit_member_hide_metadata_or_mix_with_legacy_row(client):
    headers = login(client)
    rows = invoice()
    assert save(client, headers, rows[:-1]).status_code == 422
    partial_metadata = deepcopy(rows)
    partial_metadata[1].pop("invoiceVersion")
    assert save(client, headers, partial_metadata).status_code == 422
    legacy_member = source(transactionId=rows[0]["transactionId"])
    assert save(client, headers, [*rows, legacy_member]).status_code == 422
    too_many = invoice(("coin",) * 101)
    assert save(client, headers, too_many).status_code == 422
    assert client.get("/api/owner/workspace").json()["revision"] == 0


@pytest.mark.parametrize("mutation", ["delete-one", "change-amount", "renumber", "strip-metadata", "add-member"])
def test_committed_invoice_cannot_be_split_or_rewritten(client, mutation):
    headers = login(client)
    response = save(client, headers, invoice())
    assert response.status_code == 200, response.text
    before = response.json()
    rows = deepcopy(before["data"]["documents"])
    if mutation == "delete-one":
        rows.pop()
    elif mutation == "change-amount":
        rows[0]["amount"] = 1
    elif mutation == "renumber":
        rows[0]["invoiceNumber"] = 500
    elif mutation == "strip-metadata":
        rows[0].pop("invoiceVersion")
    else:
        rows.append({**rows[-1], "id": str(uuid4()), "invoiceLine": 4})
        for row in rows:
            row["invoiceLineCount"] = 4
    response = save(client, headers, rows)
    assert response.status_code == 409, response.text
    assert client.get("/api/owner/workspace").json() == before


def test_consistent_customer_name_correction_keeps_invoice_number_and_amounts(client):
    headers = login(client)
    saved = save(client, headers, invoice()).json()
    rows = [{**row, "customerName": "نام اصلاح‌شده"} for row in saved["data"]["documents"]]
    response = save(client, headers, rows, customers=[{"id": "invoice-customer", "name": "نام اصلاح‌شده"}])
    assert response.status_code == 200 and response.json()["data"]["documents"] == rows
    partial = deepcopy(rows)
    partial[1]["customerName"] = "نام دیگر"
    assert save(client, headers, partial).status_code == 422
    assert client.get("/api/owner/workspace").json() == response.json()


def test_whole_group_removal_keeps_number_reserved_across_restart(tmp_path):
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'removed.db'}", upload_dir=tmp_path / "uploads",
        owner_username="owner", owner_password_hash=PASSWORD_HASH, cookie_secure=False, origins=(ORIGIN,))
    with TestClient(create_app(settings)) as first:
        headers = login(first)
        assert save(first, headers, invoice()).status_code == 200
        removed = save(first, headers, [])
        assert removed.status_code == 200 and removed.json()["data"]["documents"] == []
    with TestClient(create_app(settings)) as restarted:
        headers = login(restarted)
        response = save(restarted, headers, invoice())
        assert response.status_code == 200, response.text
        assert {row["invoiceNumber"] for row in response.json()["data"]["documents"]} == {2}


def test_existing_legacy_records_are_preserved_without_retroactive_invoice_fields(client):
    headers = login(client)
    legacy = {"id": "legacy", "type": "crafted-purchase", "category": "crafted", "transactionId": "old-set",
        "itemName": "", "amount": 12.345, "customerName": "قدیمی", "customField": {"original": True}}
    restore_historical_workspace(client, {**empty_workspace(), "documents": [legacy]})
    response = save(client, headers, [*invoice(), legacy])
    assert response.status_code == 200 and response.json()["data"]["documents"][-1] == legacy
    converted = {**invoice(("crafted",))[0], "id": legacy["id"]}
    assert save(client, headers, [*response.json()["data"]["documents"][:-1], converted]).status_code == 409


def test_repeated_stock_picks_share_remaining_balance_and_failure_is_atomic(client):
    headers = login(client)
    stock = source(count="3")
    older_sale = {**stock, "id": "old-sale", "source": "sale", "type": "crafted-sale", "direction": "فروش",
        "inventorySourceId": stock["id"], "itemCount": "1"}
    before = restore_historical_workspace(client, {**empty_workspace(), "documents": [older_sale, stock]})
    rows = invoice(("crafted", "crafted", "crafted"), "sale", inventorySourceId=stock["id"])
    response = save(client, headers, [*rows, older_sale, stock], customers=[{"id": "invoice-customer", "rialDebt": 1000}])
    assert response.status_code == 409 and "موجودی" in response.json()["detail"]
    assert client.get("/api/owner/workspace").json() == before
    assert receipts(client) == []
    rows.pop()
    for row in rows:
        row["invoiceLineCount"] = 2
    response = save(client, headers, [*rows, older_sale, stock])
    assert response.status_code == 200, response.text
    assert client.get(f"/api/public/products/{stock['id']}").status_code == 404
    assert len(receipts(client)) == 1


def test_decimal_currency_quantities_are_aggregated_without_float_false_rejection(client):
    headers = login(client)
    stock = source("currency", count="0.3")
    rows = invoice(("currency", "currency"), "sale", inventorySourceId=stock["id"])
    rows[0]["currencyAmount"], rows[1]["currencyAmount"] = "0.1", "0.2"
    response = save(client, headers, [*rows, stock])
    assert response.status_code == 200, response.text
    extra = invoice(("currency",), "sale", inventorySourceId=stock["id"])
    extra[0]["currencyAmount"] = "0.00000001"
    before = response.json()
    assert save(client, headers, [*extra, *before["data"]["documents"]]).status_code == 409
    assert client.get("/api/owner/workspace").json() == before


@pytest.mark.parametrize("stock_change,row_change", [
    ({}, {"inventorySourceId": "missing"}), ({}, {"inventorySourceId": ""}),
    ({"category": "currency", "currencyAmount": 2}, {}),
    ({"date": "2026-09-28"}, {}),
])
def test_sale_requires_matching_existing_stock_with_valid_date(client, stock_change, row_change):
    headers = login(client)
    stock = source(**stock_change)
    rows = invoice(("crafted",), "sale", inventorySourceId=stock["id"])
    rows[0].update(row_change)
    restore_historical_workspace(client, {**empty_workspace(), "documents": [stock]})
    before = client.get("/api/owner/workspace").json()
    assert save(client, headers, [*rows, stock]).status_code in (409, 422)
    assert client.get("/api/owner/workspace").json() == before


def test_inventory_routes_cannot_edit_or_delete_one_committed_invoice_member(client):
    headers = login(client)
    rows = invoice(("crafted", "coin"))
    customer = {"id": "invoice-customer", "name": "طرف حساب", "gramDebt": -0.5, "rialDebt": -1000,
        "purchases": [{"id": row["id"], "amount": row["amount"]} for row in rows]}
    saved = save(client, headers, rows, customers=[customer]).json()
    route = f"/api/owner/inventory/{rows[0]['id']}"
    response = client.patch(route, json={"revision": saved["revision"], "changes": {"weight": "3"}}, headers=headers)
    assert response.status_code == 409, response.text
    response = client.request("DELETE", route, json={"revision": saved["revision"]}, headers=headers)
    assert response.status_code == 409
    assert client.get("/api/owner/workspace").json() == saved


def test_single_purchase_inventory_correction_preserves_invoice_identity_and_updates_customer_history(client):
    headers = login(client)
    row = invoice(("crafted",))[0]
    customer = {"id": row["customerId"], "name": row["customerName"], "gramDebt": -0.5, "rialDebt": -1000,
        "purchases": [{"id": row["id"], "amount": row["amount"], "transactionId": row["transactionId"]}]}
    saved = save(client, headers, [row], customers=[customer]).json()
    original = saved["data"]["documents"][0]
    route = f"/api/owner/inventory/{row['id']}"
    response = client.patch(route, json={"revision": saved["revision"], "changes": {"weight": "3", "itemName": "النگو اصلاح‌شده"}}, headers=headers)
    assert response.status_code == 200, response.text
    corrected = response.json()
    document = corrected["data"]["documents"][0]
    assert document["weight"] == "3" and document["itemName"] == "النگو اصلاح‌شده"
    assert document["amount"] == 321000
    identity_fields = ("id", "invoiceNumber", "invoiceVersion", "transactionId", "invoiceLine", "invoiceLineCount", "customerId", "date", "createdAt", "recordedAt")
    assert {key: document[key] for key in identity_fields} == {key: original[key] for key in identity_fields}
    updated_customer = corrected["data"]["customers"][0]
    assert updated_customer["gramDebt"] == customer["gramDebt"] and updated_customer["rialDebt"] == customer["rialDebt"]
    assert updated_customer["purchases"][0]["amount"] == document["amount"]
    assert updated_customer["purchases"][0]["detail"] == document["itemSummary"]
    assert updated_customer["purchases"][0]["transactionId"] == document["transactionId"]

    # The unrestricted workspace endpoint cannot bypass the dedicated correction path.
    assert save(client, headers, [{**document, "amount": 1}]).status_code == 409
    assert client.get("/api/owner/workspace").json() == corrected

    sale = invoice(("crafted",), "sale", inventorySourceId=document["id"])
    sold = save(client, headers, [*sale, document]).json()
    rejected = client.patch(route, json={"revision": sold["revision"], "changes": {"weight": "4"}}, headers=headers)
    assert rejected.status_code == 409
    assert client.get("/api/owner/workspace").json() == sold
    renamed = client.patch(route, json={"revision": sold["revision"], "changes": {"itemName": "النگو با نام تازه"}}, headers=headers)
    assert renamed.status_code == 200, renamed.text
    after = next(item for item in renamed.json()["data"]["documents"] if item["id"] == document["id"])
    assert after["itemName"] == "النگو با نام تازه" and after["amount"] == document["amount"]
    assert after["invoiceNumber"] == original["invoiceNumber"]


def test_database_failure_rolls_back_invoice_number_customer_and_request_receipt(client):
    headers = login(client)
    before = client.get("/api/owner/workspace").json()
    rows = invoice()

    def fail_receipt(connection, cursor, statement, parameters, context, executemany):
        if statement.startswith("INSERT INTO noor_workspace_requests"):
            raise RuntimeError("invoice receipt failed")

    event.listen(client.app.state.engine, "before_cursor_execute", fail_receipt)
    try:
        with pytest.raises(RuntimeError, match="invoice receipt failed"):
            save(client, headers, rows, customers=[{"id": "invoice-customer", "rialDebt": -1000}])
    finally:
        event.remove(client.app.state.engine, "before_cursor_execute", fail_receipt)
    assert client.get("/api/owner/workspace").json() == before
    assert receipts(client) == []
    response = save(client, headers, rows)
    assert response.status_code == 200 and {row["invoiceNumber"] for row in response.json()["data"]["documents"]} == {1}


def test_simultaneous_invoice_replays_consume_only_one_invoice_number(client, monkeypatch):
    import app.main as main

    headers = login(client)
    payload = {"revision": 0, "requestId": str(uuid4()), "data": {"documents": invoice()}}
    original_read, barrier, lock = main.read_workspace, Barrier(2), Lock()
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
    assert len(receipts(client)) == 1
    rows = responses[0].json()["data"]["documents"]
    response = save(client, headers, [*invoice(), *rows])
    assert response.status_code == 200, response.text
    assert response.json()["data"]["documents"][0]["invoiceNumber"] == 2
