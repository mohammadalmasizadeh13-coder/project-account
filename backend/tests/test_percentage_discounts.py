from copy import deepcopy
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.invoices import settlement_row_total
from app.main import create_app
from app.settings import Settings
from test_api import ORIGIN, PASSWORD_HASH, client, login
from test_document_edits import customer, patch
from test_invoice_settlement import customer_snapshot, settled_invoice
from test_invoices import invoice, save, source


def percentage_invoice(percent="10", fixed="1000", amount=89000):
    rows = invoice(("crafted",), "sale")
    stock = source(count="10")
    rows[0].update(weight="1", gramPrice="100000", profitPercent="0", discountPercent=percent,
        discountRial=fixed, amount=amount, currentAmount=amount, inventorySourceId=stock["id"],
        gramDebt=amount / 100000, rialDebt=0, settlementVersion=1, cashPaid=0,
        settlementGoldPrice=100000, settlementRemainder=amount)
    return rows, stock


@pytest.mark.parametrize("category,details,expected", [
    ("crafted", {"weight": "1", "ayar": "750", "itemCount": "2", "gramPrice": "100000", "discountRial": "10"}, 217200),
    ("melted", {"meltedWeight": "1", "meltedAyar": "375", "itemCount": "2", "meltedGramPrice": "100000", "discountRial": "2.5"}, 114220),
    ("coin", {"coinCount": "2", "coinPrice": "100000", "discountRial": "10"}, 217200),
    ("coin", {"coinType": "پارسیان", "parsianWeight": "0.5", "coinCount": "2", "parsianPrice": "100000", "discountRial": "10"}, 217200),
    ("currency", {"currencyAmount": "2", "currencyRate": "100000", "discountRial": "2.5"}, 189120),
])
def test_percentage_and_fixed_discounts_apply_to_complete_row_total(client, category, details, expected):
    headers = login(client)
    rows = invoice((category,), "sale", wagePercent="10", wageFixed="5000", otherCosts="1000", discountPercent="۱۲٫۵")
    stock = source(category, count="10", **({"coinType": details["coinType"]} if "coinType" in details else {}))
    rows[0].update(**details, amount=expected, inventorySourceId=stock["id"], gramDebt=expected / 100000,
        rialDebt=0, settlementVersion=1, cashPaid=0, settlementGoldPrice=100000, settlementRemainder=expected)
    response = save(client, headers, [*rows, stock], customers=[customer_snapshot(rows)])
    assert response.status_code == 200, response.text
    recorded = response.json()["data"]["documents"][0]
    assert recorded["discountPercent"] == "۱۲٫۵" and recorded["amount"] == expected
    assert recorded["settlementRemainder"] == expected
    assert response.json()["data"]["customers"][0]["purchases"][0]["amount"] == expected


@pytest.mark.parametrize("percent,fixed,expected", [("100", "0", 0), ("50", "50000", 0), ("", "1000", 99000), (None, "1000", 99000)])
def test_full_and_blank_percentage_discounts(client, percent, fixed, expected):
    headers = login(client)
    rows, stock = percentage_invoice(percent, fixed, expected)
    response = save(client, headers, [*rows, stock], customers=[customer_snapshot(rows)])
    assert response.status_code == 200, response.text
    first = response.json()["data"]["documents"][0]
    assert first["amount"] == expected and first["gramDebt"] == expected / 100000


@pytest.mark.parametrize("percent", [-1, "100.01", "۱۰۰٫۱", "NaN", "Infinity", True, {}, []])
def test_invalid_percentage_rejects_creation_and_edit_atomically(client, percent):
    headers = login(client)
    rows, stock = percentage_invoice()
    before = client.get("/api/owner/workspace").json()
    invalid = [{**rows[0], "discountPercent": percent}, stock]
    assert save(client, headers, invalid, customers=[customer_snapshot(rows)]).status_code == 422
    assert client.get("/api/owner/workspace").json() == before
    created = save(client, headers, [*rows, stock], customers=[customer_snapshot(rows)])
    assert created.status_code == 200, created.text
    saved = created.json()
    response = patch(client, headers, saved, rows, {0: {"discountPercent": percent}})
    assert response.status_code == 422, response.text
    assert client.get("/api/owner/workspace").json() == saved


@pytest.mark.parametrize("percent,fixed", [("100", "1"), ("90", "10001")])
def test_combined_discount_cannot_exceed_gross_on_create_or_edit(client, percent, fixed):
    headers = login(client)
    rows, stock = percentage_invoice(percent, fixed, 0)
    before = client.get("/api/owner/workspace").json()
    assert save(client, headers, [*rows, stock]).status_code == 422
    assert client.get("/api/owner/workspace").json() == before
    rows, stock = percentage_invoice()
    saved = save(client, headers, [*rows, stock], customers=[customer_snapshot(rows)]).json()
    response = patch(client, headers, saved, rows, {0: {"discountPercent": percent, "discountRial": fixed}})
    assert response.status_code == 422, response.text
    assert client.get("/api/owner/workspace").json() == saved


def test_percentage_edit_recomputes_payment_gold_debt_market_value_and_customer_cache(client):
    headers = login(client)
    rows, stock = percentage_invoice()
    rows[0].update(cashPaid=20000, settlementRemainder=69000, gramDebt=0.69)
    saved = save(client, headers, [*rows, stock], customers=[customer_snapshot(rows)], prices={"goldGramPrice": 200000}).json()
    response = patch(client, headers, saved, rows, {0: {"discountPercent": "۱۲٫۵"}})
    assert response.status_code == 200, response.text
    updated = response.json()
    row = updated["data"]["documents"][0]
    assert row["discountPercent"] == "12.5"
    assert row["amount"] == 86500 and row["currentAmount"] == 174000
    assert row["settlementRemainder"] == 66500 and row["gramDebt"] == 0.665
    person = updated["data"]["customers"][0]
    assert person["gramDebt"] == 2.665 and person["purchases"][0]["amount"] == 86500
    # Removing the percentage retains the existing fixed discount.
    response = patch(client, headers, updated, rows, {0: {"discountPercent": ""}})
    assert response.status_code == 200, response.text
    row = response.json()["data"]["documents"][0]
    assert row["discountPercent"] == "0" and row["discountRial"] == "1000"
    assert row["amount"] == 99000 and row["currentAmount"] == 199000


def test_market_value_keeps_zero_floor_when_prices_fall_below_fixed_discount(client):
    headers = login(client)
    rows, stock = percentage_invoice("10", "50000", 40000)
    saved = save(client, headers, [*rows, stock], customers=[customer_snapshot(rows)], prices={"goldGramPrice": 10000}).json()
    response = patch(client, headers, saved, rows, {0: {"discountPercent": 20}})
    assert response.status_code == 200, response.text
    row = response.json()["data"]["documents"][0]
    assert row["amount"] == 30000 and row["currentAmount"] == 0


def test_full_percentage_edit_clears_debt_with_zero_cash(client):
    headers = login(client)
    rows, stock = percentage_invoice()
    saved = save(client, headers, [*rows, stock], customers=[customer_snapshot(rows)]).json()
    response = patch(client, headers, saved, rows, {0: {"discountPercent": "100", "discountRial": "0"}})
    assert response.status_code == 200, response.text
    row = response.json()["data"]["documents"][0]
    assert row["amount"] == row["currentAmount"] == row["settlementRemainder"] == row["gramDebt"] == 0
    assert response.json()["data"]["customers"][0]["gramDebt"] == 2


def test_percentage_discount_survives_restart_replay_and_market_changes(tmp_path):
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'percentage.db'}", upload_dir=tmp_path / "uploads",
        owner_username="owner", owner_password_hash=PASSWORD_HASH, cookie_secure=False, origins=(ORIGIN,))
    rows, stock = percentage_invoice("۱۲٫۵", "500", 87000)
    payload = {"revision": 0, "requestId": str(uuid4()), "data": {"documents": [*rows, stock],
        "customers": [customer_snapshot(rows)], "prices": {"goldGramPrice": 100000}}}
    with TestClient(create_app(settings)) as first:
        headers = login(first)
        response = first.put("/api/owner/workspace", json=payload, headers=headers)
        assert response.status_code == 200, response.text
        saved = response.json()
    with TestClient(create_app(settings)) as restarted:
        headers = login(restarted)
        assert restarted.get("/api/owner/workspace").json() == saved
        replay = restarted.put("/api/owner/workspace", json=payload, headers=headers)
        assert replay.status_code == 200 and replay.json() == saved
        changed_prices = save(restarted, headers, saved["data"]["documents"], prices={"goldGramPrice": 200000})
        assert changed_prices.status_code == 200, changed_prices.text
        assert changed_prices.json()["data"]["documents"] == saved["data"]["documents"]


def test_legacy_fixed_discount_and_text_edits_keep_historical_amounts(client):
    headers = login(client)
    rows, stocks = settled_invoice()
    saved = save(client, headers, [*rows, *stocks], customers=[customer_snapshot(rows)]).json()
    response = patch(client, headers, saved, rows, {0: {"note": "تخفیف قدیمی محفوظ است"}})
    assert response.status_code == 200, response.text
    corrected = response.json()["data"]["documents"][:4]
    assert [row["amount"] for row in corrected] == [row["amount"] for row in rows]
    assert corrected[0]["discountRial"] == "1000"
    assert all("discountPercent" not in row for row in corrected)


def test_percentage_discount_cannot_bypass_whole_invoice_or_linked_purchase_guards(client):
    headers = login(client)
    purchases = invoice(("crafted",), discountPercent="0")
    seller = customer(purchases)
    saved = save(client, headers, purchases, customers=[seller]).json()
    rows, _ = percentage_invoice()
    rows[0]["inventorySourceId"] = purchases[0]["id"]
    rows[0].update(customerId="buyer", customerName="خریدار")
    buyer = {**customer_snapshot(rows), "id": "buyer", "name": "خریدار"}
    response = save(client, headers, [*rows, *saved["data"]["documents"]], customers=[buyer, seller])
    assert response.status_code == 200, response.text
    saved = response.json()
    changed = deepcopy(saved["data"]["documents"])
    changed[0]["discountPercent"] = "20"
    assert save(client, headers, changed).status_code == 409
    changed = deepcopy(saved["data"]["documents"])
    changed[1]["discountPercent"] = "20"
    assert save(client, headers, changed).status_code == 409
    assert patch(client, headers, saved, purchases, {0: {"discountPercent": "20"}}).status_code == 409
    assert client.get("/api/owner/workspace").json() == saved


@pytest.mark.parametrize("changes", [{"amount": 89001}, {"discountPercent": "100", "discountRial": "1", "amount": 0}])
def test_percentage_validation_also_covers_invoices_without_settlement_metadata(client, changes):
    headers = login(client)
    rows, stock = percentage_invoice()
    for field in ("settlementVersion", "cashPaid", "settlementGoldPrice", "settlementRemainder"):
        rows[0].pop(field)
    rows[0].update(changes)
    assert save(client, headers, [*rows, stock]).status_code == 422
    assert client.get("/api/owner/workspace").json()["revision"] == 0


def test_percentage_does_not_discount_purchase_rows():
    row = invoice(("crafted",), discountPercent="100")[0]
    assert settlement_row_total(row) == Decimal("240750")


def test_percentage_rounding_preserves_existing_browser_boundary_tolerance(client):
    headers = login(client)
    # 0.7 times 45 yields 31.499999999999996 in the browser.
    rows, stock = percentage_invoice("30", "0", 31)
    rows[0].update(gramPrice="45", gramDebt=0.00031, settlementRemainder=31)
    response = save(client, headers, [*rows, stock])
    assert response.status_code == 200, response.text
