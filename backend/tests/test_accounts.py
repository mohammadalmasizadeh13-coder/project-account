import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import empty_workspace, imports, users
from app.main import create_app
from app.security import COOKIE_NAME, hash_password
from app.settings import Settings
from test_api import ORIGIN, PASSWORD, PASSWORD_HASH, client, login, seed, stock_document


STAFF_PASSWORD = "staff-secret-123"


def create_staff(owner, headers, username="کارمند", permissions=None):
    response = owner.post("/api/owner/users", json={"username": username, "password": STAFF_PASSWORD, "permissions": permissions or []}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()["user"]


def login_as(client, username, password=STAFF_PASSWORD):
    response = client.post("/api/auth/login", json={"username": username, "password": password}, headers={"Origin": ORIGIN})
    assert response.status_code == 200, response.text
    return {"Origin": ORIGIN, "X-CSRF-Token": response.json()["csrfToken"]}


def staff_browser(owner):
    # Do not enter a second lifespan on the same in-memory application.
    return TestClient(owner.app)


def test_staff_without_grants_cannot_read_or_write_private_fields(client):
    owner_headers = login(client)
    saved = seed(client, owner_headers)
    created = create_staff(client, owner_headers)
    staff = staff_browser(client)
    headers = login_as(staff, created["username"])
    session = staff.get("/api/auth/session").json()
    assert session["user"]["role"] == "staff" and session["user"]["permissions"] == []
    assert staff.get("/api/owner/workspace").json() == {"revision": saved["revision"], "data": {}}
    for route in ("/api/owner/users",):
        assert staff.get(route).status_code == 403
    assert staff.put("/api/owner/workspace", json={"revision": saved["revision"], "data": {"customers": []}}, headers=headers).status_code == 403
    assert staff.post("/api/owner/users", json={"username": "intruder", "password": STAFF_PASSWORD}, headers=headers).status_code == 403
    assert staff.post("/api/owner/workspace/import", json={"data": empty_workspace(), "sourceUsername": "legacy"}, headers=headers).status_code == 403
    assert staff.put("/api/owner/workspace", json={"revision": saved["revision"], "data": {"prices": {"goldGramPrice": "123"}}}, headers=headers).status_code == 403
    assert client.get("/api/owner/workspace").json() == saved


def test_partial_writes_preserve_hidden_fields_and_forbidden_keys_reject_atomically(client):
    owner_headers = login(client)
    saved = seed(client, owner_headers)
    created = create_staff(client, owner_headers, permissions=["documents.write"])
    assert created["permissions"] == ["documents.read", "documents.write"]
    staff = staff_browser(client)
    headers = login_as(staff, created["username"])
    visible = staff.get("/api/owner/workspace").json()
    assert set(visible["data"]) == {"documents"}
    changed_documents = [stock_document(itemCount="3")]
    denied = staff.put("/api/owner/workspace", json={"revision": visible["revision"], "data": {"documents": changed_documents, "customers": []}}, headers=headers)
    assert denied.status_code == 403
    assert client.get("/api/owner/workspace").json() == saved
    response = staff.put("/api/owner/workspace", json={"revision": visible["revision"], "data": {"documents": changed_documents}}, headers=headers)
    assert response.status_code == 200, response.text
    assert set(response.json()["data"]) == {"documents"}
    complete = client.get("/api/owner/workspace").json()
    assert complete["data"]["customers"] == saved["data"]["customers"]
    assert complete["data"]["documents"] == changed_documents
    assert staff.put("/api/owner/workspace", json={"revision": complete["revision"], "data": {"openingSetup": {}}}, headers=headers).status_code == 403


def test_read_only_cannot_rewrite_even_identical_data(client):
    owner_headers = login(client)
    seed(client, owner_headers)
    created = create_staff(client, owner_headers, permissions=["documents.read", "prices.read"])
    staff = staff_browser(client)
    headers = login_as(staff, created["username"])
    visible = staff.get("/api/owner/workspace").json()
    assert set(visible["data"]) == {"documents", "prices"}
    assert staff.put("/api/owner/workspace", json=visible, headers=headers).status_code == 403


def test_permissions_revoked_immediately_and_owner_cannot_be_disabled(client):
    owner_headers = login(client)
    created = create_staff(client, owner_headers, permissions=["documents.read"])
    staff = staff_browser(client)
    login_as(staff, created["username"])
    assert client.patch(f"/api/owner/users/{created['id']}", json={"permissions": []}, headers=owner_headers).status_code == 200
    assert staff.get("/api/auth/session").status_code == 401
    login_as(staff, created["username"])
    assert client.patch(f"/api/owner/users/{created['id']}", json={"active": False}, headers=owner_headers).status_code == 200
    assert staff.get("/api/auth/session").status_code == 401
    assert staff.post("/api/auth/login", json={"username": created["username"], "password": STAFF_PASSWORD}, headers={"Origin": ORIGIN}).status_code == 401
    owner_id = client.get("/api/auth/session").json()["user"]["id"]
    assert client.patch(f"/api/owner/users/{owner_id}", json={"active": False}, headers=owner_headers).status_code == 403


def test_staff_cannot_promote_self_and_responses_hide_hashes(client):
    headers = login(client)
    response = client.post("/api/owner/users", json={"username": "new", "password": STAFF_PASSWORD, "role": "owner"}, headers=headers)
    assert response.status_code == 422
    created = create_staff(client, headers)
    response = client.get("/api/owner/users")
    assert "password_hash" not in response.text and "scrypt" not in response.text and "version" not in response.text
    assert client.patch(f"/api/owner/users/{created['id']}", json={"role": "owner"}, headers=headers).status_code == 422
    assert client.patch(f"/api/owner/users/{created['id']}", json={"permissions": ["owner"]}, headers=headers).status_code == 422


def test_username_normalization_prevents_duplicate_persian_accounts(client):
    headers = login(client)
    created = create_staff(client, headers, username="  مهدي   كاظمي  ")
    assert created["username"] == "مهدی کاظمی"
    response = client.post("/api/owner/users", json={"username": "مهدی کاظمی", "password": STAFF_PASSWORD}, headers=headers)
    assert response.status_code == 409
    staff = staff_browser(client)
    login_as(staff, "  مهدي كاظمي  ")


def test_password_change_rotates_current_and_revokes_other_sessions(client):
    headers = login(client)
    other = staff_browser(client)
    login_as(other, "owner", PASSWORD)
    original_cookie = client.cookies[COOKIE_NAME]
    wrong = client.post("/api/auth/password", json={"currentPassword": "incorrect", "newPassword": "changed-long-password"}, headers=headers)
    assert wrong.status_code == 400
    response = client.post("/api/auth/password", json={"currentPassword": PASSWORD, "newPassword": "changed-long-password"}, headers=headers)
    assert response.status_code == 200, response.text
    assert client.cookies[COOKIE_NAME] != original_cookie
    assert response.json()["csrfToken"] != headers["X-CSRF-Token"]
    assert client.get("/api/auth/session").status_code == 200
    assert other.get("/api/auth/session").status_code == 401
    assert other.post("/api/auth/login", json={"username": "owner", "password": PASSWORD}, headers={"Origin": ORIGIN}).status_code == 401
    login_as(other, "owner", "changed-long-password")


def test_owner_reset_staff_password_revokes_previous_session(client):
    headers = login(client)
    created = create_staff(client, headers)
    staff = staff_browser(client)
    login_as(staff, created["username"])
    assert client.patch(f"/api/owner/users/{created['id']}", json={"password": "reset-password-123"}, headers=headers).status_code == 200
    assert staff.get("/api/auth/session").status_code == 401
    login_as(staff, created["username"], "reset-password-123")


def test_staff_can_change_own_password_without_owner_grants(client):
    headers = login(client)
    created = create_staff(client, headers)
    staff = staff_browser(client)
    staff_headers = login_as(staff, created["username"])
    assert staff.post("/api/auth/password", json={"currentPassword": STAFF_PASSWORD, "newPassword": "short"}, headers=staff_headers).status_code == 422
    response = staff.post("/api/auth/password", json={"currentPassword": STAFF_PASSWORD, "newPassword": "new-staff-password"}, headers=staff_headers)
    assert response.status_code == 200
    assert response.json()["user"]["id"] == created["id"] and response.json()["user"]["permissions"] == []
    assert staff.get("/api/auth/session").status_code == 200


def test_import_after_empty_autosave_is_idempotent_and_never_overwrites(client):
    headers = login(client)
    initial = empty_workspace()
    initial["openingSetup"] = {"completed": True, "completedAt": "2026-01-01T12:00:00Z", "skipped": True}
    initial["prices"] = {"goldGramPrice": "", "usdPrice": None}
    assert client.put("/api/owner/workspace", json={"revision": 0, "data": initial}, headers=headers).status_code == 200
    legacy = empty_workspace()
    legacy["documents"] = [stock_document()]
    body = {"data": legacy, "sourceUsername": "نام قدیمی دیگر"}
    response = client.post("/api/owner/workspace/import", json=body, headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["imported"] is True and response.json()["revision"] == 2
    repeated = client.post("/api/owner/workspace/import", json=body, headers=headers)
    assert repeated.status_code == 200 and repeated.json()["imported"] is False and repeated.json()["revision"] == 2
    assert client.post("/api/owner/workspace/import", json={"data": empty_workspace(), "sourceUsername": "other"}, headers=headers).status_code == 409
    assert client.get("/api/owner/workspace").json()["data"] == legacy
    with client.app.state.engine.connect() as connection:
        audit = connection.execute(select(imports)).mappings().one()
        assert audit["source_username"] == body["sourceUsername"]


def test_restart_preserves_changed_password_and_short_legacy_bootstrap(tmp_path):
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'persistent.db'}", upload_dir=tmp_path / "images", owner_username="  مهدي   قاسمي ",
        owner_password_hash=hash_password("12345"), cookie_secure=False, origins=(ORIGIN,))
    with TestClient(create_app(settings)) as first:
        headers = login_as(first, "مهدی قاسمی", "12345")
        changed = first.post("/api/auth/password", json={"currentPassword": "12345", "newPassword": "persistent-new-pass"}, headers=headers)
        assert changed.status_code == 200
    with TestClient(create_app(settings)) as restarted:
        assert restarted.post("/api/auth/login", json={"username": "مهدی قاسمی", "password": "12345"}, headers={"Origin": ORIGIN}).status_code == 401
        login_as(restarted, "مهدي قاسمي", "persistent-new-pass")
        with restarted.app.state.engine.connect() as connection:
            assert len(connection.execute(select(users)).all()) == 1


def test_removed_storefront_permission_cannot_be_granted(client):
    headers = login(client)
    before = client.get("/api/owner/users").json()
    response = client.post("/api/owner/users", json={"username": "old-manager", "password": STAFF_PASSWORD,
        "permissions": ["storefront.manage"]}, headers=headers)
    assert response.status_code == 422
    assert client.get("/api/owner/users").json() == before
