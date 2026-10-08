import io
import json
import time
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update

from app.database import empty_workspace, rates, sessions, workspaces
from app.main import create_app
from app.pricing import RateService, iso_now, price_breakdown
from app.security import COOKIE_NAME, hash_password
from app.settings import Settings


ORIGIN = "http://localhost:5173"
PASSWORD = "noor-test-password-only"
PASSWORD_HASH = hash_password(PASSWORD)


@pytest.fixture
def client(tmp_path):
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'test.db'}", upload_dir=tmp_path / "uploads",
        owner_username="owner", owner_password_hash=PASSWORD_HASH, cookie_secure=False, origins=(ORIGIN,))
    with TestClient(create_app(settings)) as test_client:
        yield test_client


def login(client):
    response = client.post("/api/auth/login", json={"username": "owner", "password": PASSWORD}, headers={"Origin": ORIGIN})
    assert response.status_code == 200, response.text
    return {"Origin": ORIGIN, "X-CSRF-Token": response.json()["csrfToken"]}


def stock_document(**overrides):
    return {"id": "lot-1", "source": "opening-inventory", "category": "crafted", "itemName": "انگشتر نور",
        "productCode": "ZG-000001", "itemCount": "2", "weight": "۲٫۵", "ayar": "750", "wagePercent": "10",
        "wageFixed": "1000", "customerId": "private-customer", "description": "private supplier note", **overrides}


def restore_historical_workspace(client, data):
    """Set up persisted legacy fixtures, including records predating required goods identity."""
    current = client.get("/api/owner/workspace").json()
    with client.app.state.engine.begin() as connection:
        connection.execute(update(workspaces).where(workspaces.c.id == 1).values(
            data=json.dumps(data, ensure_ascii=False), revision=current["revision"] + 1))
    return client.get("/api/owner/workspace").json()


def seed(client, headers, documents=None):
    data = empty_workspace()
    data["documents"] = documents or [stock_document()]
    data["customers"] = [{"id": "private-customer", "phone": "private-phone"}]
    return restore_historical_workspace(client, data)


def test_guest_cannot_access_accounting_or_forge_registration_role(client):
    for route in ("/api/auth/session", "/api/owner/workspace"):
        assert client.get(route).status_code == 401
    assert client.put("/api/owner/workspace", json={"revision": 0, "data": {}}, headers={"Origin": ORIGIN}).status_code == 401
    assert client.post("/api/auth/register", json={"galleryName": "گالری آزمایشی", "username": "intruder", "password": PASSWORD, "role": "owner"}, headers={"Origin": ORIGIN}).status_code == 422
    assert client.get("/api/public/products").status_code == 404


def test_origin_csrf_session_rotation_and_logout(client):
    assert client.post("/api/auth/login", json={"username": "owner", "password": PASSWORD}, headers={"Origin": "https://evil.example"}).status_code == 403
    headers = login(client)
    token = client.cookies[COOKIE_NAME]
    response = client.get("/api/auth/session")
    assert response.json()["user"]["role"] == "owner"
    assert response.headers["Cache-Control"] == "no-store"
    with client.app.state.engine.connect() as connection:
        stored = connection.execute(select(sessions)).mappings().one()
        assert stored["token_hash"] != token
    assert client.put("/api/owner/workspace", json={"revision": 0, "data": {}}, headers={"Origin": ORIGIN}).status_code == 403
    assert client.put("/api/owner/workspace", json={"revision": 0, "data": {}}, headers=[(b"origin", ORIGIN.encode()), (b"x-csrf-token", b"\xff")]).status_code == 403
    assert client.put("/api/owner/workspace", json={"revision": 0, "data": {}}, headers={**headers, "X-CSRF-Token": "x" * 129}).status_code == 403
    assert client.put("/api/owner/workspace", json={"revision": 0, "data": {}}, headers={**headers, "Origin": "https://evil.example"}).status_code == 403
    new_headers = login(client)
    new_token = client.cookies[COOKIE_NAME]
    assert token != new_token
    client.cookies.set(COOKIE_NAME, token, domain="testserver.local", path="/")
    assert client.get("/api/auth/session").status_code == 401
    client.cookies.set(COOKIE_NAME, new_token, domain="testserver.local", path="/")
    assert client.post("/api/auth/logout", headers=new_headers).status_code == 200
    assert client.get("/api/owner/workspace").status_code == 401


def test_cookie_flags_and_expired_credentials(client):
    client.app.state.settings.cookie_secure = True
    response = client.post("/api/auth/login", json={"username": "owner", "password": PASSWORD}, headers={"Origin": ORIGIN})
    cookie = response.headers["set-cookie"].lower()
    assert all(flag in cookie for flag in ("httponly", "samesite=lax", "secure"))
    client.app.state.settings.cookie_secure = False
    login(client)
    with client.app.state.engine.begin() as connection:
        connection.execute(update(sessions).values(expires_at=time.time() - 1))
    assert client.get("/api/auth/session").status_code == 401
    login(client)
    client.app.state.settings.owner_password_hash = hash_password("changed-password-long")
    # Environment bootstrap must never overwrite persisted credentials.
    assert client.get("/api/auth/session").status_code == 200


def test_db_backed_login_limit(client):
    for _ in range(10):
        assert client.post("/api/auth/login", json={"username": "owner", "password": "wrong"}, headers={"Origin": ORIGIN}).status_code == 401
    response = client.post("/api/auth/login", json={"username": "owner", "password": PASSWORD}, headers={"Origin": ORIGIN})
    assert response.status_code == 429
    assert int(response.headers["retry-after"]) > 0


def test_password_checks_have_bounded_memory_concurrency(client):
    from app.security import PASSWORD_CHECKS
    PASSWORD_CHECKS.acquire()
    PASSWORD_CHECKS.acquire()
    try:
        response = client.post("/api/auth/login", json={"username": "owner", "password": PASSWORD}, headers={"Origin": ORIGIN})
        assert response.status_code == 429
    finally:
        PASSWORD_CHECKS.release()
        PASSWORD_CHECKS.release()


def test_request_limit_prevents_large_private_writes(client):
    response = client.put("/api/owner/workspace", content=b"{}", headers={"Content-Length": str(9 * 1024 * 1024), "Content-Type": "application/json"})
    assert response.status_code == 413


def test_revision_conflict_keeps_committed_accounting_data(client):
    headers = login(client)
    saved = seed(client, headers)
    stale = {"revision": 0, "data": empty_workspace()}
    assert client.put("/api/owner/workspace", json=stale, headers=headers).status_code == 409
    assert client.get("/api/owner/workspace").json() == saved


def test_stale_live_rate_survives_provider_failure_without_new_timestamp(client, monkeypatch):
    service = RateService(client.app.state.engine, client.app.state.settings)
    service.settings.rate_url = "https://rates.example.test/gold"
    old = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    service.save("live", 123456, old, "rates.example.test")
    with client.app.state.engine.begin() as connection:
        connection.execute(update(rates).values(checked_at=0))
    def failed_provider():
        raise OSError("offline")
    monkeypatch.setattr(service, "_refresh_live", failed_provider)
    rate = service.get()
    assert rate["value"] == 123456 and rate["stale"] is True and rate["updatedAt"] == old


def test_provider_contract_converts_rials_and_retains_provider_time(client, monkeypatch):
    import json
    import app.pricing as pricing
    timestamp = iso_now()
    service = RateService(client.app.state.engine, client.app.state.settings)
    service.settings.rate_url = "https://rates.example.test/gold"
    class Provider:
        def open(self, request, timeout):
            return io.BytesIO(json.dumps({"price": 1234560, "unit": "rial", "updatedAt": timestamp}).encode())
    monkeypatch.setattr(pricing, "build_opener", lambda *args: Provider())
    response = service.get()
    assert response["value"] == 123456
    assert response["mode"] == "live" and response["updatedAt"] == timestamp


def test_decimal_price_components_sum_to_the_recorded_total():
    assert price_breakdown("2.5", 750, 10, 1000, 7, 10, 100000) == {"gold": 250000, "wage": 26000, "profit": 19320, "tax": 4532, "total": 299852}
