"""Registration, tenant isolation, and migration of an existing single ledger."""
from copy import deepcopy
import json
import sqlite3
import time
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, select

from app.database import LEGACY_ACCOUNT_ID, empty_workspace, imports, users, workspaces
from app.main import create_app
from app.security import COOKIE_NAME, credential_version, digest, login_throttle
from app.settings import Settings
from test_api import ORIGIN, PASSWORD, PASSWORD_HASH
from test_invoices import invoice


def account_settings(tmp_path):
    return Settings(database_url=f"sqlite:///{tmp_path / 'accounts.db'}", upload_dir=tmp_path / "uploads",
        owner_username="", owner_password_hash="", cookie_secure=False, origins=(ORIGIN,))


@pytest.fixture
def accounting(tmp_path):
    with TestClient(create_app(account_settings(tmp_path))) as browser:
        yield browser


def register(browser, username):
    response = browser.post("/api/auth/register", json={"galleryName": "گالری آزمایشی", "username": username, "password": PASSWORD}, headers={"Origin": ORIGIN})
    assert response.status_code == 201, response.text
    return response.json()["user"], {"Origin": ORIGIN, "X-CSRF-Token": response.json()["csrfToken"]}


def authenticate(browser, username, password=PASSWORD):
    response = browser.post("/api/auth/login", json={"username": username, "password": password}, headers={"Origin": ORIGIN})
    assert response.status_code == 200, response.text
    return {"Origin": ORIGIN, "X-CSRF-Token": response.json()["csrfToken"]}


def save(browser, headers, data, request_id=None):
    revision = browser.get("/api/owner/workspace").json()["revision"]
    response = browser.put("/api/owner/workspace", json={"revision": revision, "data": data, "requestId": request_id or str(uuid4())}, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def stock(browser, headers, request_id=None, item=None):
    return browser.post("/api/owner/inventory", json={
        "revision": browser.get("/api/owner/workspace").json()["revision"],
        "requestId": request_id or str(uuid4()),
        "item": item or {"category": "crafted", "craftedKind": "انگشتر", "itemName": "انگشتر خصوصی", "weight": "2"}}, headers=headers)


def test_registration_creates_authenticated_empty_owner_account(accounting):
    user, headers = register(accounting, "  مهدي   كاظمي  ")
    assert user["username"] == "مهدی کاظمی" and user["role"] == "owner"
    assert user["accountId"] and user["legacyAccount"] is False
    assert "storefront.manage" not in user["permissions"]
    assert accounting.get("/api/auth/session").json()["user"] == user
    assert accounting.get("/api/owner/workspace").json() == {"revision": 0, "data": empty_workspace(), "legacyImported": False}
    cookie = next(cookie for cookie in accounting.cookies.jar if cookie.name == COOKIE_NAME)
    assert cookie.has_nonstandard_attr("HttpOnly")
    assert accounting.put("/api/owner/workspace", json={"revision": 0, "data": {"customers": []}}, headers=headers).status_code == 200
    with accounting.app.state.engine.connect() as connection:
        stored = connection.execute(select(users).where(users.c.id == user["id"])).mappings().one()
        assert stored["password_hash"] != PASSWORD and stored["password_hash"].startswith("scrypt$")


@pytest.mark.parametrize("extra", [{"role": "owner"}, {"permissions": ["documents.write"]}, {"accountId": LEGACY_ACCOUNT_ID}, {"active": False}])
def test_registration_rejects_caller_controlled_authorization(accounting, extra):
    response = accounting.post("/api/auth/register", json={"galleryName": "گالری آزمایشی", "username": "attacker", "password": PASSWORD, **extra}, headers={"Origin": ORIGIN})
    assert response.status_code == 422
    with accounting.app.state.engine.connect() as connection:
        assert connection.execute(select(users)).first() is None


@pytest.mark.parametrize("username,password", [("   ", PASSWORD), ("a", "short"), ("a" * 201, PASSWORD), ("ﬃ" * 100, PASSWORD)])
def test_registration_validates_credentials_before_writing(accounting, username, password):
    assert accounting.post("/api/auth/register", json={"galleryName": "گالری آزمایشی", "username": username, "password": password}, headers={"Origin": ORIGIN}).status_code == 422
    assert accounting.get("/api/auth/session").status_code == 401


def test_registration_normalization_conflict_is_atomic(accounting):
    original, _ = register(accounting, "  مهدي كاظمي ")
    original_cookie = accounting.cookies[COOKIE_NAME]
    assert accounting.post("/api/auth/register", json={"galleryName": "گالری آزمایشی", "username": "مهدی کاظمی", "password": "different-password"}, headers={"Origin": ORIGIN}).status_code == 409
    assert accounting.cookies[COOKIE_NAME] == original_cookie
    assert accounting.get("/api/auth/session").json()["user"] == original
    with accounting.app.state.engine.connect() as connection:
        assert len(connection.execute(select(users)).all()) == 1
        assert len(connection.execute(select(workspaces)).all()) == 2  # Existing ledger plus the new account.


def test_signup_session_failure_rolls_back_user_workspace_and_previous_session(accounting):
    original, _ = register(accounting, "original-account")
    original_cookie = accounting.cookies[COOKIE_NAME]

    def fail_session(connection, cursor, statement, parameters, context, executemany):
        if statement.startswith("INSERT INTO noor_sessions"):
            raise RuntimeError("simulated registration session failure")

    engine = accounting.app.state.engine
    event.listen(engine, "before_cursor_execute", fail_session)
    try:
        with pytest.raises(RuntimeError, match="simulated registration session failure"):
            register(accounting, "failed-account")
    finally:
        event.remove(engine, "before_cursor_execute", fail_session)
    assert accounting.cookies[COOKIE_NAME] == original_cookie
    assert accounting.get("/api/auth/session").json()["user"] == original
    with engine.connect() as connection:
        assert len(connection.execute(select(users)).all()) == 1
        assert len(connection.execute(select(workspaces)).all()) == 2


def test_signup_rotates_existing_session_into_the_new_empty_account(accounting):
    user_a, headers_a = register(accounting, "switch-a")
    saved_a = save(accounting, headers_a, {"customers": [{"id": "a", "name": "private-a"}]})
    cookie_a = accounting.cookies[COOKIE_NAME]
    user_b, _ = register(accounting, "switch-b")
    assert accounting.cookies[COOKIE_NAME] != cookie_a and user_a["accountId"] != user_b["accountId"]
    assert accounting.get("/api/owner/workspace").json()["data"] == empty_workspace()
    assert accounting.put("/api/owner/workspace", json={"revision": 0, "data": {"customers": []}}, headers=headers_a).status_code == 403
    stale_browser = TestClient(accounting.app)
    stale_browser.cookies.set(COOKIE_NAME, cookie_a)
    assert stale_browser.get("/api/owner/workspace").status_code == 401
    authenticate(stale_browser, "switch-a")
    assert stale_browser.get("/api/owner/workspace").json() == saved_a


def test_workspace_customers_prices_and_receipts_are_account_scoped(accounting):
    user_a, headers_a = register(accounting, "account-a")
    account_b = TestClient(accounting.app)
    user_b, headers_b = register(account_b, "account-b")
    assert user_a["accountId"] != user_b["accountId"]
    request_id = str(uuid4())
    data_a = {"customers": [{"id": "shared-id", "name": "private-a"}], "prices": {"goldGramPrice": "100000"},
        "goldPurchases": [{"id": "gold-a"}], "cheques": [{"id": "cheque-a"}]}
    saved_a = save(accounting, headers_a, data_a, request_id)
    assert account_b.get("/api/owner/workspace").json()["data"] == empty_workspace()
    data_b = {"customers": [{"id": "shared-id", "name": "private-b"}], "prices": {"goldGramPrice": "200000"}}
    saved_b = save(account_b, headers_b, data_b, request_id)
    assert accounting.get("/api/owner/workspace").json() == saved_a
    assert saved_a["revision"] == saved_b["revision"] == 1
    replay_a = accounting.put("/api/owner/workspace", json={"revision": 0, "data": data_a, "requestId": request_id}, headers=headers_a)
    assert replay_a.status_code == 200 and replay_a.json() == saved_a
    assert account_b.put("/api/owner/workspace", json={"revision": 0, "data": data_a, "requestId": request_id}, headers=headers_b).status_code == 409
    assert account_b.get("/api/owner/workspace").json() == saved_b


def test_inventory_create_edit_delete_and_replay_are_isolated(accounting):
    _, headers_a = register(accounting, "inventory-a")
    account_b = TestClient(accounting.app)
    _, headers_b = register(account_b, "inventory-b")
    save(accounting, headers_a, {"prices": {"goldGramPrice": "100000"}})
    save(account_b, headers_b, {"prices": {"goldGramPrice": "200000"}})
    receipt_id = str(uuid4())
    response_a = stock(accounting, headers_a, receipt_id)
    response_b = stock(account_b, headers_b, receipt_id)
    assert response_a.status_code == response_b.status_code == 201
    row_a = response_a.json()["data"]["documents"][0]
    row_b = response_b.json()["data"]["documents"][0]
    assert row_a["gramPrice"] == "100000" and row_b["gramPrice"] == "200000"
    assert row_a["productCode"] == row_b["productCode"] == "ZG-000001"
    assert row_a["id"] != row_b["id"]
    assert stock(accounting, headers_a, receipt_id).status_code == 200
    before_b = account_b.get("/api/owner/workspace").json()
    assert account_b.patch(f"/api/owner/inventory/{row_a['id']}", json={"revision": before_b["revision"], "changes": {"itemName": "stolen"}}, headers=headers_b).status_code == 404
    assert account_b.request("DELETE", f"/api/owner/inventory/{row_a['id']}", json={"revision": before_b["revision"]}, headers=headers_b).status_code == 404
    assert account_b.get("/api/owner/workspace").json() == before_b
    revision_a = accounting.get("/api/owner/workspace").json()["revision"]
    edited = accounting.patch(f"/api/owner/inventory/{row_a['id']}", json={"revision": revision_a, "changes": {"itemName": "changed-a"}}, headers=headers_a)
    assert edited.status_code == 200
    assert accounting.request("DELETE", f"/api/owner/inventory/{row_a['id']}", json={"revision": edited.json()["revision"]}, headers=headers_a).status_code == 200
    assert account_b.get("/api/owner/workspace").json() == before_b


def test_imports_and_import_audit_marker_are_private(accounting):
    user_a, headers_a = register(accounting, "import-a")
    account_b = TestClient(accounting.app)
    user_b, headers_b = register(account_b, "import-b")
    data_a = {**empty_workspace(), "customers": [{"id": "a", "name": "imported-a"}]}
    imported = accounting.post("/api/owner/workspace/import", json={"sourceUsername": "legacy-source", "data": data_a}, headers=headers_a)
    assert imported.status_code == 200 and imported.json()["legacyImported"] is True
    assert account_b.get("/api/owner/workspace").json()["legacyImported"] is False
    data_b = {**empty_workspace(), "prices": {"goldGramPrice": "200000"}}
    imported_b = account_b.post("/api/owner/workspace/import", json={"sourceUsername": "legacy-source", "data": data_b}, headers=headers_b)
    assert imported_b.status_code == 200
    assert accounting.get("/api/owner/workspace").json()["data"] == data_a
    assert accounting.post("/api/owner/workspace/import", json={"sourceUsername": "b", "data": data_b}, headers=headers_a).status_code == 409
    with accounting.app.state.engine.connect() as connection:
        audits = connection.execute(select(imports)).mappings().all()
        assert {audit["account_id"] for audit in audits} == {user_a["accountId"], user_b["accountId"]}


def test_staff_listing_management_and_ledger_follow_their_owner_account(accounting):
    user_a, headers_a = register(accounting, "staff-owner-a")
    account_b = TestClient(accounting.app)
    user_b, headers_b = register(account_b, "staff-owner-b")
    created = accounting.post("/api/owner/users", json={"username": "staff-a", "password": PASSWORD, "permissions": ["customers.write"]}, headers=headers_a)
    assert created.status_code == 201
    staff_user = created.json()["user"]
    assert staff_user["accountId"] == user_a["accountId"]
    assert {item["id"] for item in accounting.get("/api/owner/users").json()["users"]} == {user_a["id"], staff_user["id"]}
    assert {item["id"] for item in account_b.get("/api/owner/users").json()["users"]} == {user_b["id"]}
    staff_browser = TestClient(accounting.app)
    staff_headers = authenticate(staff_browser, "staff-a")
    saved_b = save(account_b, headers_b, {"customers": [{"id": "b", "name": "private-b"}]})
    assert staff_browser.get("/api/owner/workspace").json()["data"] == {"customers": []}
    save(staff_browser, staff_headers, {"customers": [{"id": "a", "name": "staff customer"}]})
    assert accounting.get("/api/owner/workspace").json()["data"]["customers"][0]["name"] == "staff customer"
    assert account_b.get("/api/owner/workspace").json() == saved_b
    for change in ({"active": False}, {"permissions": []}, {"password": "foreign-reset-pass"}):
        assert account_b.patch(f"/api/owner/users/{staff_user['id']}", json=change, headers=headers_b).status_code == 404
    assert staff_browser.get("/api/auth/session").status_code == 200
    assert staff_browser.get("/api/owner/users").status_code == 403
    assert staff_browser.patch(f"/api/owner/users/{user_b['id']}", json={"active": False}, headers=staff_headers).status_code == 403


def test_invoice_counters_are_independent_and_keep_their_own_high_watermark(accounting):
    _, headers_a = register(accounting, "invoice-a")
    account_b = TestClient(accounting.app)
    _, headers_b = register(account_b, "invoice-b")
    rows_a = invoice(("coin",))
    rows_b = deepcopy(rows_a)  # Even document and transaction IDs can coincide in separate accounts.
    first_a = save(accounting, headers_a, {"documents": rows_a})
    first_b = save(account_b, headers_b, {"documents": rows_b})
    assert first_a["data"]["documents"][0]["invoiceNumber"] == first_b["data"]["documents"][0]["invoiceNumber"] == 1
    second_a = save(accounting, headers_a, {"documents": [*first_a["data"]["documents"], *invoice(("coin",))]})
    assert second_a["data"]["documents"][-1]["invoiceNumber"] == 2
    assert account_b.get("/api/owner/workspace").json() == first_b


def test_registration_origin_and_authenticated_csrf_are_required(accounting):
    for origin in (None, "https://foreign.example"):
        assert accounting.post("/api/auth/register", json={"galleryName": "گالری آزمایشی", "username": "origin-test", "password": PASSWORD}, headers={"Origin": origin} if origin else {}).status_code == 403
    _, headers = register(accounting, "csrf-test")
    payload = {"revision": 0, "data": {"prices": {"goldGramPrice": "100000"}}}
    assert accounting.put("/api/owner/workspace", json=payload, headers={"Origin": ORIGIN}).status_code == 403
    assert accounting.put("/api/owner/workspace", json=payload, headers={**headers, "Origin": "https://foreign.example"}).status_code == 403
    assert accounting.put("/api/owner/workspace", json=payload, headers={**headers, "X-CSRF-Token": "incorrect"}).status_code == 403
    assert accounting.get("/api/owner/workspace").json()["revision"] == 0


def test_registration_rate_limit_persists_across_restart_and_recovers(tmp_path, monkeypatch):
    settings = account_settings(tmp_path)
    monkeypatch.setattr("app.security.time.time", lambda: 1000)
    with TestClient(create_app(settings)) as first:
        for _ in range(10):
            login_throttle(first.app.state.engine, "testclient")
    with TestClient(create_app(settings)) as restarted:
        response = restarted.post("/api/auth/register", json={"galleryName": "گالری آزمایشی", "username": "rate-limited", "password": PASSWORD}, headers={"Origin": ORIGIN})
        assert response.status_code == 429 and int(response.headers["Retry-After"]) > 0
        assert restarted.post("/api/auth/login", json={"username": "unknown", "password": PASSWORD}, headers={"Origin": ORIGIN}).status_code == 429
        with restarted.app.state.engine.connect() as connection:
            assert connection.execute(select(users)).first() is None
        monkeypatch.setattr("app.security.time.time", lambda: 1201)
        register(restarted, "rate-limited")


def test_registered_accounts_password_and_workspace_survive_restart(tmp_path):
    settings = account_settings(tmp_path)
    with TestClient(create_app(settings)) as first:
        user_a, headers_a = register(first, "persistent-a")
        account_b = TestClient(first.app)
        user_b, headers_b = register(account_b, "persistent-b")
        saved_a = save(first, headers_a, {"customers": [{"id": "a", "name": "persist-a"}]})
        saved_b = save(account_b, headers_b, {"prices": {"goldGramPrice": "200000"}})
        changed = first.post("/api/auth/password", json={"currentPassword": PASSWORD, "newPassword": "new-persistent-password"}, headers=headers_a)
        assert changed.status_code == 200
        cookie_a = first.cookies[COOKIE_NAME]
    with TestClient(create_app(settings)) as restarted:
        restarted.cookies.set(COOKIE_NAME, cookie_a)
        assert restarted.get("/api/auth/session").json()["user"]["accountId"] == user_a["accountId"]
        assert restarted.get("/api/owner/workspace").json() == saved_a
        account_b = TestClient(restarted.app)
        authenticate(account_b, "persistent-b")
        assert account_b.get("/api/auth/session").json()["user"]["accountId"] == user_b["accountId"]
        assert account_b.get("/api/owner/workspace").json() == saved_b
        assert restarted.post("/api/auth/login", json={"username": "persistent-a", "password": PASSWORD}, headers={"Origin": ORIGIN}).status_code == 401
        authenticate(restarted, "persistent-a", "new-persistent-password")


def test_additive_migration_preserves_ledger_users_sessions_receipts_and_counter(tmp_path):
    settings = account_settings(tmp_path)
    legacy_owner = {"id": "existing-owner", "username": "legacy-owner", "normalized_username": "legacy-owner", "role": "owner",
        "password_hash": PASSWORD_HASH, "permissions": "[]", "active": True, "version": 4}
    legacy_item = {"category": "crafted", "craftedKind": "انگشتر", "itemName": "legacy-item", "weight": "2", "gramPrice": "123000"}
    legacy_data = {**empty_workspace(), "documents": [{"id": "legacy-stock", "source": "opening-inventory", **legacy_item}],
        "customers": [{"id": "old-customer", "name": "preserved"}], "prices": {"goldGramPrice": "123000"}}
    receipt_id = str(uuid4())
    inventory_receipt_id = str(uuid4())
    changes = {"customers": legacy_data["customers"]}
    with sqlite3.connect(tmp_path / "accounts.db") as connection:
        connection.executescript("""
            CREATE TABLE noor_users (id VARCHAR(64) PRIMARY KEY, username VARCHAR(200) NOT NULL,
                normalized_username VARCHAR(200) NOT NULL UNIQUE, role VARCHAR(20) NOT NULL,
                password_hash VARCHAR(300) NOT NULL, permissions TEXT NOT NULL, active BOOLEAN NOT NULL, version INTEGER NOT NULL);
            CREATE TABLE noor_workspace (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL);
            CREATE TABLE noor_workspace_requests (request_id VARCHAR(36) PRIMARY KEY, actor_id VARCHAR(64) NOT NULL,
                body_hash VARCHAR(64) NOT NULL, revision INTEGER NOT NULL, created_at FLOAT NOT NULL);
            CREATE TABLE noor_inventory_requests (request_id VARCHAR(36) PRIMARY KEY, actor_id VARCHAR(64) NOT NULL,
                body_hash VARCHAR(64) NOT NULL, created_id VARCHAR(200) NOT NULL, created_at FLOAT NOT NULL);
            CREATE TABLE noor_workspace_imports (id VARCHAR(64) PRIMARY KEY, source_username VARCHAR(200) NOT NULL,
                actor_id VARCHAR(64) NOT NULL, created_at FLOAT NOT NULL, revision INTEGER NOT NULL);
            CREATE TABLE noor_invoice_sequence (id INTEGER PRIMARY KEY, last_number INTEGER NOT NULL);
            CREATE TABLE noor_sessions (token_hash VARCHAR(64) PRIMARY KEY, csrf VARCHAR(128) NOT NULL,
                username VARCHAR(200) NOT NULL, credential_version VARCHAR(64) NOT NULL, expires_at FLOAT NOT NULL);
        """)
        connection.execute("INSERT INTO noor_users VALUES (?, ?, ?, ?, ?, ?, ?, ?)", tuple(legacy_owner.values()))
        connection.execute("INSERT INTO noor_users VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            ("existing-staff", "legacy-staff", "legacy-staff", "staff", PASSWORD_HASH, '["customers.read", "storefront.manage"]', True, 1))
        connection.execute("INSERT INTO noor_workspace VALUES (1, 7, ?)", (json.dumps(legacy_data),))
        connection.execute("INSERT INTO noor_workspace_requests VALUES (?, ?, ?, 7, ?)",
            (receipt_id, legacy_owner["id"], digest(json.dumps(changes, sort_keys=True, ensure_ascii=False)), time.time()))
        connection.execute("INSERT INTO noor_workspace_imports VALUES ('old-import', 'old-source', 'existing-owner', ?, 7)", (time.time(),))
        connection.execute("INSERT INTO noor_inventory_requests VALUES (?, 'existing-owner', ?, 'legacy-stock', ?)",
            (inventory_receipt_id, digest(json.dumps(legacy_item, sort_keys=True, ensure_ascii=False)), time.time()))
        connection.execute("INSERT INTO noor_invoice_sequence VALUES (1, 50)")
        connection.execute("INSERT INTO noor_sessions VALUES (?, 'old-csrf', 'legacy-owner', ?, ?)",
            (digest("old-session"), credential_version(legacy_owner), time.time() + 3600))
    with TestClient(create_app(settings)) as migrated:
        migrated.cookies.set(COOKIE_NAME, "old-session")
        session = migrated.get("/api/auth/session").json()
        assert session["user"]["id"] == legacy_owner["id"] and session["user"]["legacyAccount"] is True
        assert session["user"]["galleryName"] == ""
        original = migrated.get("/api/owner/workspace").json()
        assert original == {"revision": 7, "data": legacy_data, "legacyImported": True}
        replayed = migrated.put("/api/owner/workspace", json={"revision": 6, "data": changes, "requestId": receipt_id}, headers={"Origin": ORIGIN, "X-CSRF-Token": "old-csrf"})
        assert replayed.status_code == 200 and replayed.json() == original
        old_stock = migrated.post("/api/owner/inventory", json={"revision": 6, "requestId": inventory_receipt_id, "item": legacy_item}, headers={"Origin": ORIGIN, "X-CSRF-Token": "old-csrf"})
        assert old_stock.status_code == 200 and old_stock.json()["createdId"] == "legacy-stock"
        assert migrated.get("/api/owner/workspace").json() == original
        new_account = TestClient(migrated.app)
        _, new_headers = register(new_account, "new-account")
        assert new_account.get("/api/owner/workspace").json() == {"revision": 0, "data": empty_workspace(), "legacyImported": False}
        new_invoice = save(new_account, new_headers, {"documents": invoice(("coin",))})
        assert new_invoice["data"]["documents"][0]["invoiceNumber"] == 1
        old_invoice = save(migrated, {"Origin": ORIGIN, "X-CSRF-Token": "old-csrf"}, {"documents": invoice(("coin",))})
        assert old_invoice["data"]["documents"][0]["invoiceNumber"] == 51
        staff = TestClient(migrated.app)
        authenticate(staff, "legacy-staff")
        assert staff.get("/api/auth/session").json()["user"]["permissions"] == ["customers.read"]
        assert staff.get("/api/owner/workspace").json()["data"] == {"customers": legacy_data["customers"]}
    with TestClient(create_app(settings)) as restarted:
        authenticate(restarted, "legacy-owner")
        assert restarted.get("/api/owner/workspace").json()["data"]["customers"] == legacy_data["customers"]
        with restarted.app.state.engine.connect() as connection:
            assert len(connection.execute(select(workspaces)).all()) == 2
