from copy import deepcopy
from uuid import uuid4

import pytest

from test_api import client, login
from test_partners import create_partner, post_invoice, supplier_payload
from test_coin_pricing import ordinary
from app.catalog import stock_entries


@pytest.mark.parametrize("category,line,gold,cash", [
    ("crafted", {"weight": 2, "ayar": 750, "itemCount": 2, "weightMode": "total"}, 2.31, 2315),
    ("melted", {"meltedWeight": 2, "meltedAyar": 750, "meltedFee": 433180, "inventoryMode": "ledger", "direction": "sale"}, -2.31, -1157.5),
    ("currency", {"currencyType": "USD", "currencyAmount": 2, "currencyRate": 1000}, 0, 4310),
])
def test_v4_edit_keeps_two_balances_identity_and_replays(client, category, line, gold, cash):
    headers = login(client)
    created, _ = create_partner(client, headers)
    identifier = created["createdId"]
    original = {"category": category, "itemName": "Historical item", "wagePercent": 10,
        "wageFixed": 100 if category != "currency" else 0, "otherCosts": 50,
        "profitPercent": 5 if category != "currency" else 10, "profitFixed": 1000, **line}
    if category == "currency":
        original.pop("wagePercent")
        original.pop("wageFixed")
    posted = post_invoice(client, headers, identifier, calculationVersion=4, settlementUnit="mixed", lines=[original])
    assert posted.status_code == 201, posted.text
    saved = posted.json()
    record = saved["data"]["partners"][0]
    assert record["goldBalance"] == gold
    assert record["tomanBalance"] == cash
    entry = record["entries"][0]
    document = saved["data"]["documents"][0]
    if line.get("inventoryMode") == "ledger":
        assert stock_entries(saved["data"]["documents"]) == {}
        assert "productCode" not in document
    edit = supplier_payload(client, calculationVersion=4, settlementUnit="mixed", note="Corrected",
        lines=[{**original, "documentId": document["id"]}], paidGold=0.1, paidToman=10.1)
    path = f"/api/owner/partners/{identifier}/invoices/{entry['id']}"
    response = client.patch(path, headers=headers, json=edit)
    assert response.status_code == 200, response.text
    updated = response.json()
    record = updated["data"]["partners"][0]
    assert record["goldBalance"] == pytest.approx(gold - 0.1)
    assert record["tomanBalance"] == pytest.approx(cash - 10.1)
    for key in ("id", "transactionId", "invoiceNumber", "createdAt", "documentIds"):
        assert record["entries"][0][key] == entry[key]
    assert updated["data"]["documents"][0]["id"] == document["id"]
    assert client.patch(path, headers=headers, json=edit).json() == updated
    assert client.get("/api/owner/workspace").json()["data"] == updated["data"]


def test_v4_cash_remittance_edit_is_searchable_ledger_only_and_atomic(client):
    headers = login(client)
    created, _ = create_partner(client, headers, openingGoldBalance=4, openingTomanBalance=1000)
    identifier = created["createdId"]
    line = {"category": "remittance", "remittanceDirection": "credit", "settlementUnit": "toman", "tomanAmount": 250.1}
    posted = post_invoice(client, headers, identifier, calculationVersion=4, settlementUnit="mixed", lines=[line], paidToman=10)
    assert posted.status_code == 201, posted.text
    saved = posted.json()
    record = saved["data"]["partners"][0]
    assert (record["goldBalance"], record["tomanBalance"]) == (4, 739.9)
    assert saved["data"]["documents"] == []
    entry = record["entries"][0]
    path = f"/api/owner/partners/{identifier}/invoices/{entry['id']}"
    body = supplier_payload(client, calculationVersion=4, settlementUnit="mixed", lines=[{**line, "tomanAmount": 500}])
    response = client.patch(path, headers=headers, json=body)
    assert response.status_code == 200, response.text
    assert response.json()["data"]["partners"][0]["tomanBalance"] == 500
    invalid = deepcopy(body)
    invalid.update(supplier_payload(client, calculationVersion=3, lines=[{"category": "remittance", "remittanceDirection": "credit", "goldAmount": 5}]))
    before = client.get("/api/owner/workspace").json()
    assert client.patch(path, headers=headers, json=invalid).status_code == 422
    assert client.get("/api/owner/workspace").json() == before


def test_v4_saved_coin_pricing_version_survives_edit_without_cash_conversion(client):
    headers = login(client)
    created, _ = create_partner(client, headers)
    identifier = created["createdId"]
    line = ordinary("پارسیان", coinPricingVersion=3, coinWeight=1, coinAyar=750,
        wagePercent=10, wageFixed=1000, otherCosts=100, profitPercent=5, profitFixed=10000, settlementUnit="gold")
    posted = post_invoice(client, headers, identifier, calculationVersion=4, settlementUnit="mixed", lines=[line])
    assert posted.status_code == 201, posted.text
    saved = posted.json()
    entry = saved["data"]["partners"][0]["entries"][0]
    assert (entry["goldDebit"], entry["tomanDebit"]) == (2.31, 22310)
    body = supplier_payload(client, calculationVersion=4, settlementUnit="mixed", paidToman=100,
        lines=[{**line, "documentId": entry["documentIds"][0], "coinCount": 3}])
    response = client.patch(f"/api/owner/partners/{identifier}/invoices/{entry['id']}", headers=headers, json=body)
    assert response.status_code == 200, response.text
    record = response.json()["data"]["partners"][0]
    assert record["goldBalance"] == 3.465 and record["tomanBalance"] == 33365
    assert record["entries"][0]["lines"][0]["coinPricingVersion"] == 3
    assert response.json()["data"]["documents"][0]["coinPricingVersion"] == 3


def test_partner_invoice_delete_removes_linked_payment_stock_and_replays(client):
    headers = login(client)
    created, _ = create_partner(client, headers)
    identifier = created["createdId"]
    posted = post_invoice(client, headers, identifier, paidGold=1, paidToman=100)
    assert posted.status_code == 201, posted.text
    entry = posted.json()["data"]["partners"][0]["entries"][0]
    assert len(posted.json()["data"]["partners"][0]["entries"]) == 2
    body = {"revision": posted.json()["revision"], "requestId": str(uuid4())}
    path = f"/api/owner/partners/{identifier}/invoices/{entry['id']}"
    deleted = client.request("DELETE", path, headers=headers, json=body)
    assert deleted.status_code == 200, deleted.text
    data = deleted.json()["data"]
    assert data["documents"] == []
    assert data["partners"][0]["entries"] == []
    assert data["partners"][0]["goldBalance"] == 0
    assert data["partners"][0]["tomanBalance"] == 0
    replay = client.request("DELETE", path, headers=headers, json=body)
    assert replay.status_code == 200
    assert replay.json() == deleted.json()
