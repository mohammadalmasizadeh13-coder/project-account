from copy import deepcopy
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.database import empty_workspace
from app.main import create_app
from app.settings import Settings
from test_api import ORIGIN, PASSWORD_HASH, client, login, restore_historical_workspace
from test_invoices import invoice, save, source
from test_workspace_durability import receipts


def settled_invoice(cash=4000000):
    rows = invoice(("crafted", "melted", "coin", "currency"), "sale")
    rows[0].update(itemCount="2", wagePercent="10", wageFixed="5000", otherCosts="1000", discountRial="1000")
    # Independently calculated totals include per-piece fixed wage/costs,
    # purity normalization, profit, discount and whole-toman rounding.
    amounts = [541490, 475457, 1070000, 8045063]
    stocks = [source(row["category"], count="1000") for row in rows]
    for row, stock, amount in zip(rows, stocks, amounts):
        row.update(amount=amount, inventorySourceId=stock["id"], gramDebt=0, rialDebt=0)
    remainder = sum(amounts) - cash
    rows[0].update(settlementVersion=1, cashPaid=cash, settlementGoldPrice=100000,
        settlementRemainder=remainder, gramDebt=round(remainder / 100000, 6))
    return rows, stocks


def customer_snapshot(rows, previous_grams=2, previous_tomans=300):
    return {"id": "invoice-customer", "name": "طرف حساب", "gramDebt": previous_grams + rows[0]["gramDebt"],
        "rialDebt": previous_tomans, "purchases": [{key: row[key] for key in (
            "id", "amount", "transactionId", "gramDebt", "rialDebt", "settlementVersion", "cashPaid",
            "settlementGoldPrice", "settlementRemainder") if key in row} for row in rows]}


def test_settlement_persists_with_customer_history_replay_restart_and_changed_market_price(tmp_path):
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'settlement.db'}", upload_dir=tmp_path / "uploads",
        owner_username="owner", owner_password_hash=PASSWORD_HASH, cookie_secure=False, origins=(ORIGIN,))
    rows, stocks = settled_invoice()
    customer = customer_snapshot(rows)
    payload = {"revision": 0, "requestId": str(uuid4()), "data": {"documents": [*rows, *stocks],
        "customers": [customer], "prices": {"goldGramPrice": 100000}}}
    with TestClient(create_app(settings)) as first:
        headers = login(first)
        response = first.put("/api/owner/workspace", json=payload, headers=headers)
        assert response.status_code == 200, response.text
        saved = response.json()
        assert saved["data"]["documents"][:4] == [{**row, "invoiceNumber": 1} for row in rows]
        assert saved["data"]["customers"] == [customer]
        assert sum(row["gramDebt"] for row in saved["data"]["documents"][:4]) == 61.3201
        assert sum(row["rialDebt"] for row in saved["data"]["documents"][:4]) == 0
    with TestClient(create_app(settings)) as restarted:
        headers = login(restarted)
        assert restarted.get("/api/owner/workspace").json() == saved
        replay = restarted.put("/api/owner/workspace", json=payload, headers=headers)
        assert replay.status_code == 200 and replay.json() == saved
        assert len(receipts(restarted)) == 1
        updated = save(restarted, headers, saved["data"]["documents"], prices={"goldGramPrice": 400000})
        assert updated.status_code == 200, updated.text
        assert updated.json()["data"]["documents"] == saved["data"]["documents"]
        assert updated.json()["data"]["customers"] == [customer]


@pytest.mark.parametrize("cash", [0, 10132010])
def test_explicit_zero_cash_and_full_payment_are_valid(client, cash):
    headers = login(client)
    rows, stocks = settled_invoice(cash)
    response = save(client, headers, [*rows, *stocks], customers=[customer_snapshot(rows)])
    assert response.status_code == 200, response.text
    first = response.json()["data"]["documents"][0]
    assert first["cashPaid"] == cash and first["settlementRemainder"] == 10132010 - cash
    assert first["gramDebt"] == (101.3201 if cash == 0 else 0)


@pytest.mark.parametrize("changes", [
    {"settlementVersion": 2}, {"settlementVersion": True}, {"settlementVersion": "1"},
    {"cashPaid": None}, {"cashPaid": ""}, {"cashPaid": -1}, {"cashPaid": 0.5}, {"cashPaid": True},
    {"cashPaid": 10132011}, {"cashPaid": 9007199254740992},
    {"settlementGoldPrice": 0}, {"settlementGoldPrice": -100000},
    {"settlementGoldPrice": "Infinity"}, {"settlementGoldPrice": 1000000000001},
    {"settlementGoldPrice": 200000}, {"gold18Price": 200000},
    {"settlementRemainder": 6132011}, {"settlementRemainder": -1},
    {"settlementRemainder": ""}, {"settlementRemainder": "NaN"},
    {"gramDebt": 61.3202}, {"gramDebt": 61.3201001}, {"gramDebt": 61.320101},
    {"gramDebt": None}, {"rialDebt": 1}, {"rialDebt": None},
    {"amount": 541489}, {"amount": 541490.1}, {"discountRial": 999999999},
    {"wageFixed": -1}, {"otherCosts": -1}, {"profitPercent": -1}, {"gramPrice": 0},
])
def test_invalid_settlement_rejects_document_and_customer_atomically(client, changes):
    headers = login(client)
    rows, stocks = settled_invoice()
    before = restore_historical_workspace(client, {**empty_workspace(), "documents": stocks,
        "customers": [{"id": "invoice-customer", "gramDebt": 2, "rialDebt": 300}]})
    rows[0].update(changes)
    response = save(client, headers, [*rows, *stocks], customers=[{"id": "invoice-customer", "gramDebt": 999}])
    assert response.status_code == 422, response.text
    assert client.get("/api/owner/workspace").json() == before
    assert receipts(client) == []


@pytest.mark.parametrize("missing", ["settlementVersion", "cashPaid", "settlementGoldPrice", "settlementRemainder", "gramDebt", "rialDebt"])
def test_partial_settlement_metadata_is_rejected(client, missing):
    headers = login(client)
    rows, stocks = settled_invoice()
    rows[0].pop(missing)
    assert save(client, headers, [*rows, *stocks]).status_code == 422


@pytest.mark.parametrize("changes", [
    {"cashPaid": 0}, {"settlementVersion": 1}, {"settlementGoldPrice": 100000},
    {"settlementRemainder": 0}, {"gold18Price": 200000}, {"gramDebt": 1}, {"rialDebt": 1},
    {"amount": 475456.64}, {"amount": 475458}, {"meltedGramPrice": 90000},
])
def test_settlement_cannot_repeat_or_diverge_on_later_invoice_rows(client, changes):
    headers = login(client)
    rows, stocks = settled_invoice()
    rows[1].update(changes)
    assert save(client, headers, [*rows, *stocks]).status_code == 422


def test_settlement_is_only_for_complete_sale_invoice_and_metadata_stays_on_line_one(client):
    headers = login(client)
    rows, stocks = settled_invoice()
    purchase = [{**row, "type": f"{row['category']}-purchase", "direction": "خرید"} for row in rows]
    assert save(client, headers, [*purchase, *stocks]).status_code == 422
    legacy = deepcopy(rows[0])
    for field in ("invoiceVersion", "invoiceLine", "invoiceLineCount", "transactionId"):
        legacy.pop(field)
    assert save(client, headers, [legacy, *stocks]).status_code == 422
    # List order is irrelevant; invoiceLine identifies the single settlement.
    response = save(client, headers, [*reversed(rows), *stocks])
    assert response.status_code == 200, response.text
    assert sum("cashPaid" in row for row in response.json()["data"]["documents"]) == 1


@pytest.mark.parametrize("changes", [
    {"cashPaid": 0}, {"settlementGoldPrice": 200000}, {"settlementRemainder": 0},
    {"gramDebt": 0}, {"rialDebt": 1}, {"amount": 0}, {"discountRial": 0},
])
def test_recorded_settlement_cannot_be_changed(client, changes):
    headers = login(client)
    rows, stocks = settled_invoice()
    response = save(client, headers, [*rows, *stocks], customers=[customer_snapshot(rows)])
    assert response.status_code == 200, response.text
    before = response.json()
    documents = deepcopy(before["data"]["documents"])
    documents[0].update(changes)
    assert save(client, headers, documents).status_code == 409
    assert client.get("/api/owner/workspace").json() == before


@pytest.mark.parametrize("category,details,amount", [
    ("crafted", {"weight": "0.0204", "gramPrice": "100", "profitPercent": "0", "wageFixed": "0.4599999999999998"}, 3),
    ("coin", {"coinType": "پارسیان", "parsianWeight": "0.5", "parsianPrice": "100", "coinCount": "2", "wagePercent": "10", "wageFixed": "5", "otherCosts": "2", "profitPercent": "5", "discountRial": "3.2"}, 243),
    ("crafted", {"weight": "1", "gramPrice": "100000", "profitPercent": "0", "discountRial": "100000"}, 0),
])
def test_settlement_handles_parsian_rounding_boundary_and_full_discount(client, category, details, amount):
    headers = login(client)
    rows = invoice((category,), "sale")
    stock = source(category, count="10", **{key: value for key, value in details.items() if key == "coinType"})
    rows[0].update(**details, amount=amount, inventorySourceId=stock["id"], gramDebt=amount / 100000,
        rialDebt=0, settlementVersion=1, cashPaid=0, settlementGoldPrice=100000, settlementRemainder=amount)
    response = save(client, headers, [*rows, stock])
    assert response.status_code == 200, response.text


@pytest.mark.parametrize("rate,grams", [(2000000, 0.000001), (2000000, 0), (3000000, 0), ("0.000000001", 1000000000)])
def test_gold_debt_rounds_to_six_places_with_browser_boundary_tolerance(client, rate, grams):
    headers = login(client)
    rows = invoice(("crafted",), "sale", gold18Price=rate)
    stock = source()
    rows[0].update(weight="1", gramPrice="1", profitPercent="0", amount=1, inventorySourceId=stock["id"],
        gramDebt=grams, rialDebt=0, settlementVersion=1, cashPaid=0, settlementGoldPrice=rate, settlementRemainder=1)
    response = save(client, headers, [*rows, stock])
    assert response.status_code == 200, response.text


def test_tiny_rate_rejects_unrepresentable_gold_debt_instead_of_overflowing(client):
    headers = login(client)
    rows, stocks = settled_invoice()
    for row in rows:
        row["gold18Price"] = "1e-1000000"
    rows[0]["settlementGoldPrice"] = "1e-1000000"
    response = save(client, headers, [*rows, *stocks])
    assert response.status_code == 422, response.text
    assert client.get("/api/owner/workspace").json()["revision"] == 0
