from uuid import uuid4

import pytest

from app.catalog import stock_entries
from test_api import client, login
from test_partners import create_partner, post_invoice, settlement_body


def delete_entry(client, headers, partner_id, entry_id, kind="invoices", body=None):
    payload = body or {"revision": client.get("/api/owner/workspace").json()["revision"], "requestId": str(uuid4())}
    response = client.request("DELETE", f"/api/owner/partners/{partner_id}/{kind}/{entry_id}", headers=headers, json=payload)
    return response, payload


@pytest.mark.parametrize("version,category,fields,count_field", [
    (version, category, fields, count_field)
    for category, fields, count_field in [
        ("crafted", {"craftedKind": "انگشتر", "weight": 2, "ayar": 750, "weightMode": "unit"}, "itemCount"),
        ("coin", {"coinType": "امامی", "coinPrice": 200000}, "coinCount"),
        ("melted", {"meltedWeight": 2, "meltedAyar": 750, "meltedFee": 433180, "assayCode": "123", "laboratoryName": "آزمایشگاه"}, "itemCount"),
        ("currency", {"currencyType": "USD", "currencyRate": 100000}, "currencyAmount"),
    ]
    for version in ([2, 3, 4] if category in {"crafted", "coin"} else [3, 4])
])
def test_deleting_sale_restores_stock_then_purchase_deletion_reverses_ledger(client, version, category, fields, count_field):
    headers = login(client)
    created, _ = create_partner(client, headers, openingGoldBalance=7, openingTomanBalance=1000)
    partner_id = created["createdId"]
    line = {"category": category, "itemName": "جنس آزمون حذف", "profitPercent": 0, count_field: 3, **fields}
    options = {"calculationVersion": version, "settlementUnit": "mixed" if version == 4 else "gold"}
    purchase = post_invoice(client, headers, partner_id, **options, lines=[line], paidGold=.1, paidToman=2)
    assert purchase.status_code == 201, purchase.text
    bought = purchase.json()["data"]
    source = bought["documents"][0]
    buy_entry = next(entry for entry in bought["partners"][0]["entries"] if entry["type"] == "purchase")
    sale_line = {**line, count_field: 1, "inventorySourceId": source["id"]}
    if version >= 3:
        sale_line["direction"] = "sale"
    sale = post_invoice(client, headers, partner_id, **options, direction="sale", lines=[sale_line], paidGold=.2, paidToman=3)
    assert sale.status_code == 201, sale.text
    sold = sale.json()
    assert stock_entries(sold["data"]["documents"])[source["id"]]["remaining"] == 2
    sale_entry = next(entry for entry in sold["data"]["partners"][0]["entries"] if entry["type"] == "sale")
    before_rejection = client.get("/api/owner/workspace").json()
    rejected, _ = delete_entry(client, headers, partner_id, buy_entry["id"])
    assert rejected.status_code == 409
    assert client.get("/api/owner/workspace").json() == before_rejection
    removed, request = delete_entry(client, headers, partner_id, sale_entry["id"])
    assert removed.status_code == 200, removed.text
    restored = removed.json()["data"]
    assert restored["documents"] == bought["documents"]
    assert stock_entries(restored["documents"])[source["id"]]["remaining"] == 3
    for field in ("entries", "goldBalance", "tomanBalance"):
        assert restored["partners"][0][field] == bought["partners"][0][field]
    assert delete_entry(client, headers, partner_id, sale_entry["id"], body=request)[0].json() == removed.json()
    removed_buy, _ = delete_entry(client, headers, partner_id, buy_entry["id"])
    assert removed_buy.status_code == 200, removed_buy.text
    final = removed_buy.json()["data"]
    assert final["documents"] == [] and stock_entries(final["documents"]) == {}
    assert final["customers"] == bought["customers"]
    assert final["partners"][0]["entries"] == []
    assert (final["partners"][0]["goldBalance"], final["partners"][0]["tomanBalance"]) == (7, 1000)
    assert client.get("/api/owner/workspace").json()["data"] == final


@pytest.mark.parametrize("direction", ["debit", "credit"])
def test_deleting_standalone_payment_reverses_both_balances_once(client, direction):
    headers = login(client)
    created, _ = create_partner(client, headers, openingGoldBalance=7, openingTomanBalance=1000)
    partner_id = created["createdId"]
    purchase = post_invoice(client, headers, partner_id)
    assert purchase.status_code == 201, purchase.text
    before = purchase.json()["data"]
    payload = settlement_body(client, direction=direction, goldAmount=1.25, tomanAmount=1234)
    saved = client.post(f"/api/owner/partners/{partner_id}/settlements", headers=headers, json=payload)
    assert saved.status_code == 201, saved.text
    removed, body = delete_entry(client, headers, partner_id, saved.json()["createdId"], "settlements")
    assert removed.status_code == 200, removed.text
    after = removed.json()["data"]
    assert after["documents"] == before["documents"]
    for field in ("entries", "goldBalance", "tomanBalance"):
        assert after["partners"][0][field] == before["partners"][0][field]
    assert delete_entry(client, headers, partner_id, saved.json()["createdId"], "settlements", body)[0].json() == removed.json()
