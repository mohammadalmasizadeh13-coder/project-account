"""Buy used or lower-purity crafted gold without losing its physical purity."""
from copy import deepcopy
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.settings import Settings
from test_accounts import create_staff, login_as, staff_browser
from test_api import ORIGIN, PASSWORD_HASH, client, login
from test_invoices import invoice, save


def misc_purchase(**changes):
    row = invoice(("crafted",))[0]
    row.update(type="misc-purchase", typeLabel="خرید طلای متفرقه", craftedKind="سایر", itemName="طلای دست دوم",
        weight="10", ayar="600", itemCount="2", gramPrice="100000", wagePercent="0", wageFixed="0", profitPercent="0",
        gramDebt=0, rialDebt=0, amount=1600000, itemWeight=16, weight750=8, otherCosts="0")
    row.update(changes)
    return row


def seller(row):
    return {"id": row["customerId"], "name": row["customerName"], "gramDebt": -2, "rialDebt": -100,
        "purchases": [{"id": row["id"], "amount": row["amount"], "detail": "client detail"}],
        "settlements": [{"id": "prior-payment", "rialAmount": 200}]}


@pytest.mark.parametrize("purity,expected_weight,expected_total,expected_amount", [
    ("600", 8, 16, 1600000), ("۷۵۰", 10, 20, 2000000), ("900", 12, 24, 2400000), ("۱۰۰۰", 40 / 3, 80 / 3, 8000000 / 3),
])
def test_actual_purity_is_retained_and_equivalent_and_amount_are_server_derived(client, purity, expected_weight, expected_total, expected_amount):
    headers = login(client)
    row = misc_purchase(ayar=purity, amount=999, itemWeight=999, weight750=999, wagePercent="10", wageFixed="10000", profitPercent="7")
    customer = seller(row)
    response = save(client, headers, [row], customers=[customer], prices={"goldGramPrice": "200000"})
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    stored = data["documents"][0]
    assert stored["type"] == "misc-purchase" and stored["category"] == "crafted" and stored["ayar"] == purity
    assert stored["weight"] == "10" and stored["weight750"] == pytest.approx(expected_weight)
    assert stored["itemWeight"] == pytest.approx(expected_total) and stored["amount"] == pytest.approx(expected_amount)
    assert stored["currentAmount"] == pytest.approx(expected_amount * 2)
    assert [stored[field] for field in ("wagePercent", "wageFixed", "profitPercent")] == ["0", "0", "0"]
    assert stored["invoiceNumber"] == 1 and "۷۵۰" in stored["itemSummary"] and "هر عدد 10 گرم" in stored["itemSummary"]
    assert data["customers"][0]["purchases"][0]["amount"] == stored["amount"]
    assert data["customers"][0]["purchases"][0]["detail"] == stored["itemSummary"]
    assert data["customers"][0]["gramDebt"] == customer["gramDebt"] and data["customers"][0]["settlements"] == customer["settlements"]


@pytest.mark.parametrize("changes", [
    {"weight": 0}, {"weight": ""}, {"weight": "NaN"}, {"weight": -1},
    {"ayar": None}, {"ayar": ""}, {"ayar": 0}, {"ayar": -10}, {"ayar": 1001},
    {"gramPrice": 0}, {"gramPrice": ""}, {"gramPrice": "Infinity"}, {"itemCount": 1.5},
    {"otherCosts": -1}, {"otherCosts": "invalid"}, {"category": "melted"},
])
def test_invalid_misc_purchase_rejects_documents_and_customer_atomically(client, changes):
    headers = login(client)
    before = client.get("/api/owner/workspace").json()
    row = misc_purchase(**changes)
    response = save(client, headers, [row], customers=[seller(row)])
    assert response.status_code == 422, response.text
    assert client.get("/api/owner/workspace").json() == before


def test_purchase_edit_recalculates_750_weight_and_customer_cache_without_changing_debts(client):
    headers = login(client)
    row = misc_purchase()
    original = save(client, headers, [row], customers=[seller(row)], prices={"goldGramPrice": "200000"})
    assert original.status_code == 200
    response = client.patch(f"/api/owner/inventory/{row['id']}", json={"revision": original.json()["revision"],
        "changes": {"weight": "15", "ayar": "500", "itemCount": "3"}}, headers=headers)
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    updated = data["documents"][0]
    assert updated["weight"] == "15" and updated["ayar"] == "500"
    assert updated["weight750"] == 10 and updated["itemWeight"] == 30
    assert updated["amount"] == 3000000 and updated["currentAmount"] == 6000000 and updated["invoiceNumber"] == 1
    assert "عیار 500" in updated["itemSummary"] and "هر عدد 10 گرم طلای ۷۵۰" in updated["itemSummary"]
    assert data["customers"][0]["purchases"][0]["amount"] == 3000000
    assert data["customers"][0]["purchases"][0]["detail"] == updated["itemSummary"]
    assert data["customers"][0]["gramDebt"] == -2 and data["customers"][0]["rialDebt"] == -100
    assert data["customers"][0]["settlements"] == seller(row)["settlements"]
    denied = client.patch(f"/api/owner/inventory/{row['id']}", json={"revision": response.json()["revision"], "changes": {"wagePercent": "5"}}, headers=headers)
    assert denied.status_code == 422
    assert client.get("/api/owner/workspace").json() == response.json()


def test_misc_purchase_can_be_sold_as_crafted_stock_and_then_only_text_can_change(client):
    headers = login(client)
    purchased = misc_purchase()
    response = save(client, headers, [purchased], customers=[seller(purchased)])
    source = response.json()["data"]["documents"][0]
    sale = invoice(("crafted",), operation="sale", customerId="buyer", customerName="خریدار")[0]
    sale.update(inventorySourceId=source["id"], weight="10", ayar="600", itemCount="1", gramDebt=0, rialDebt=0)
    sale_response = save(client, headers, [source, sale])
    assert sale_response.status_code == 200, sale_response.text
    revision = sale_response.json()["revision"]
    assert client.patch(f"/api/owner/inventory/{source['id']}", json={"revision": revision, "changes": {"ayar": "750"}}, headers=headers).status_code == 409
    assert client.request("DELETE", f"/api/owner/inventory/{source['id']}", json={"revision": revision}, headers=headers).status_code == 409
    corrected = client.patch(f"/api/owner/inventory/{source['id']}", json={"revision": revision, "changes": {"itemName": "نام اصلاح‌شده"}}, headers=headers)
    assert corrected.status_code == 200, corrected.text
    stock = corrected.json()["data"]["documents"][0]
    assert stock["weight750"] == 8 and stock["ayar"] == "600" and "نام اصلاح‌شده" in stock["itemSummary"]


@pytest.mark.parametrize("changes", [{"type": "crafted-purchase"}, {"category": "melted"}, {"weight750": 1000}, {"ayar": "900"}])
def test_workspace_rewrite_cannot_bypass_misc_purchase_identity_or_conversion(client, changes):
    headers = login(client)
    row = misc_purchase()
    original = save(client, headers, [row], customers=[seller(row)])
    changed = deepcopy(original.json()["data"]["documents"])
    changed[0].update(changes)
    assert save(client, headers, changed).status_code == 409
    assert client.get("/api/owner/workspace").json() == original.json()


def test_customer_grant_is_required_for_misc_stock_corrections(client):
    headers = login(client)
    row = misc_purchase()
    original = save(client, headers, [row], customers=[seller(row)])
    staff = create_staff(client, headers, permissions=["documents.write"])
    browser = staff_browser(client)
    staff_headers = login_as(browser, staff["username"])
    assert browser.patch(f"/api/owner/inventory/{row['id']}", json={"revision": original.json()["revision"], "changes": {"weight": "12"}}, headers=staff_headers).status_code == 403
    assert client.get("/api/owner/workspace").json() == original.json()


def test_misc_purchase_survives_restart_and_replay_with_server_equivalent(tmp_path):
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'misc.db'}", upload_dir=tmp_path / "uploads",
        owner_username="owner", owner_password_hash=PASSWORD_HASH, cookie_secure=False, origins=(ORIGIN,))
    row = misc_purchase(weight750=999, itemWeight=999)
    payload = {"revision": 0, "requestId": str(uuid4()), "data": {"documents": [row], "customers": [seller(row)]}}
    with TestClient(create_app(settings)) as first:
        headers = login(first)
        saved = first.put("/api/owner/workspace", json=payload, headers=headers)
        assert saved.status_code == 200, saved.text
        assert saved.json()["data"]["documents"][0]["weight750"] == 8
    with TestClient(create_app(settings)) as restarted:
        headers = login(restarted)
        assert restarted.get("/api/owner/workspace").json() == saved.json()
        replayed = restarted.put("/api/owner/workspace", json=payload, headers=headers)
        assert replayed.status_code == 200 and replayed.json() == saved.json()
