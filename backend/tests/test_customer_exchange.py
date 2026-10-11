from uuid import uuid4

import pytest

from test_api import client, login
from test_invoices import invoice, save, source
from test_invoice_settlement import customer_snapshot
from test_document_edits import patch, remove


def exchange(sale_price=100000, cash=0, sale_first=False):
    rows = invoice(("coin", "crafted", "crafted"), profitPercent="0")
    rows[0].update(coinCount="2", coinPrice="100000", amount=200000)
    rows[1].update(type="misc-purchase", weight="1", ayar="750", amount=100000)
    stock = source("crafted", count="1", itemName="دستبند", weight="4")
    rows[2].update(type="crafted-sale", direction="فروش", inventorySourceId=stock["id"],
        itemName="دستبند", weight="4", gramPrice=str(sale_price), amount=4 * sale_price)
    if sale_first:
        rows = [rows[2], *rows[:2]]
    for index, row in enumerate(rows):
        row.update(invoiceLine=index + 1, gramDebt=0, rialDebt=0)
    net = 4 * sale_price - 300000
    remainder = net - (cash if net >= 0 else -cash)
    rows[0].update(settlementVersion=3, cashPaid=cash, settlementGoldPrice=100000,
        settlementRemainder=remainder, gramDebt=round(remainder / 100000, 6))
    return rows, stock


@pytest.mark.parametrize("sale_first", [False, True])
@pytest.mark.parametrize("price,cash,grams", [(100000, 20000, .8), (50000, 20000, -.8), (75000, 0, 0), (50000, 100000, 0)])
def test_exchange_combines_incoming_coins_gold_and_outgoing_bracelet(client, sale_first, price, cash, grams):
    headers = login(client)
    rows, stock = exchange(price, cash, sale_first)
    response = save(client, headers, [*rows, stock], customers=[customer_snapshot(rows)])
    assert response.status_code == 200, response.text
    saved = response.json()
    assert {row["invoiceNumber"] for row in saved["data"]["documents"][:3]} == {1}
    assert saved["data"]["documents"][0]["gramDebt"] == grams
    assert saved["data"]["customers"][0]["gramDebt"] == 2 + grams
    # The single lot has gone out; another sale cannot reuse it.
    extra = invoice(("crafted",), "sale")
    extra[0]["inventorySourceId"] = stock["id"]
    rejected = save(client, headers, [*extra, *saved["data"]["documents"]])
    assert rejected.status_code == 409, rejected.text
    assert client.get("/api/owner/workspace").json() == saved
    deleted = remove(client, headers, saved, rows[1]["id"])
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["data"]["documents"] == [stock]
    assert deleted.json()["data"]["customers"][0]["gramDebt"] == 2
    assert deleted.json()["data"]["customers"][0]["purchases"] == []
    assert save(client, headers, [*extra, stock]).status_code == 200


def test_exchange_edit_crosses_zero_and_reverses_customer_balance(client):
    headers = login(client)
    rows, stock = exchange(cash=20000)
    saved = save(client, headers, [*rows, stock], customers=[customer_snapshot(rows)]).json()
    response = patch(client, headers, saved, rows, {2: {"gramPrice": 50000}})
    assert response.status_code == 200, response.text
    edited = response.json()
    assert edited["data"]["documents"][0]["gramDebt"] == -.8
    assert edited["data"]["documents"][0]["settlementRemainder"] == -80000
    assert edited["data"]["customers"][0]["gramDebt"] == 1.2
    response = patch(client, headers, edited, rows, {0: {"cashPaid": 0}, 2: {"gramPrice": 75000}})
    assert response.status_code == 200, response.text
    assert response.json()["data"]["customers"][0]["gramDebt"] == 2
    assert response.json()["data"]["documents"][0]["gramDebt"] == 0


@pytest.mark.parametrize("index,changes", [(0, {"settlementVersion": 1}), (0, {"cashPaid": 100001}),
    (0, {"gramDebt": -1}), (0, {"settlementRemainder": -100000}), (1, {"gramDebt": 1}),
    (1, {"customerId": "other"}), (1, {"gold18Price": 200000}), (1, {"amount": 1}),
    (2, {"itemCount": "2", "amount": 800000})])
def test_invalid_exchange_is_atomic(client, index, changes):
    headers = login(client)
    before = client.get("/api/owner/workspace").json()
    rows, stock = exchange()
    rows[index].update(changes)
    response = save(client, headers, [*rows, stock], customers=[customer_snapshot(rows)])
    assert response.status_code in (409, 422), response.text
    assert client.get("/api/owner/workspace").json() == before


def test_misc_fractional_amount_rounding_and_exchange_replay(client):
    headers = login(client)
    rows, stock = exchange()
    rows[1].update(weight="1.000006", amount=100001)
    rows[0].update(settlementRemainder=99999, gramDebt=.99999)
    payload = {"revision": 0, "requestId": str(uuid4()), "data": {"documents": [*rows, stock], "customers": [customer_snapshot(rows)]}}
    response = client.put("/api/owner/workspace", json=payload, headers=headers)
    assert response.status_code == 200, response.text
    assert client.put("/api/owner/workspace", json=payload, headers=headers).json() == response.json()
    edited = patch(client, headers, response.json(), rows, {1: {"weight": "1.000004"}})
    assert edited.status_code == 200, edited.text
    assert edited.json()["data"]["documents"][1]["amount"] == 100000
    assert edited.json()["data"]["customers"][0]["gramDebt"] == 3


@pytest.mark.parametrize("index,changes", [(0, {"coinCount": "3"}), (1, {"weight": "2"})])
def test_inventory_cannot_bypass_exchange_settlement(client, index, changes):
    headers = login(client)
    rows, stock = exchange(50000)
    saved = save(client, headers, [*rows, stock], customers=[customer_snapshot(rows)]).json()
    response = client.patch(f"/api/owner/inventory/{rows[index]['id']}", headers=headers,
        json={"revision": saved["revision"], "changes": changes})
    assert response.status_code == 409, response.text
    assert client.get("/api/owner/workspace").json() == saved


def test_exchange_requires_explicit_contract_and_valid_transaction(client):
    headers = login(client)
    rows, stock = exchange()
    rows[0].pop("settlementVersion")
    assert save(client, headers, [*rows, stock]).status_code == 422
    rows[0]["settlementVersion"] = 3
    for row in rows:
        row["transactionId"] = []
    assert save(client, headers, [*rows, stock]).status_code == 422
