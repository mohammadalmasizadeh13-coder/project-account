"""Versioned coin pricing across stock, customer invoices and partner ledgers."""
from decimal import Decimal

import pytest

from app.inventory import amount
from app.invoices import settlement_row_total
from test_api import client, login
from test_document_edits import customer, patch
from test_inventory_create import submit
from test_inventory_management import save_data
from test_invoices import invoice, save, source
from test_partners import create_partner, post_invoice, supplier_payload


def ordinary(kind="تمام عادی", **changes):
    return {"category": "coin", "itemName": kind, "coinPricingVersion": 2, "coinGroup": "ordinary",
        "coinType": kind, "coinCount": 2, "gramPrice": 100000, "profitPercent": 5,
        "profitFixed": 1000, **changes}


@pytest.mark.parametrize("kind,grams,equivalent", [
    ("تمام عادی", 8.133, 9.7596), ("نیم عادی", 4.066, 4.8792), ("ربع عادی", 2.022, 2.4264),
])
def test_standard_coins_derive_trusted_specs_and_both_profit_components(client, kind, grams, equivalent):
    headers = login(client)
    save_data(client, headers, [], prices={"goldGramPrice": 200000})
    posted = submit(client, headers, ordinary(kind, coinWeight=999, coinAyar=1, coinWeight750=999,
        wagePercent=2, wageFixed=100, otherCosts=50, coinPrice="", parsianPrice="", parsianWeight=""))
    assert posted.status_code == 201, posted.text
    row = posted.json()["data"]["documents"][0]
    assert row["coinPricingVersion"] == 2
    assert float(row["coinWeight"]) == grams and float(row["coinAyar"]) == 900
    assert row["coinWeight750"] == equivalent and row["itemWeight"] == grams * 2
    assert row["amount"] == pytest.approx((2 * equivalent * 100000 * 1.02 + 300) * 1.05 + 2000)
    assert row["currentAmount"] == pytest.approx((2 * equivalent * 200000 * 1.02 + 300) * 1.05 + 2000)
    assert "عیار اصلی 900" in row["itemSummary"] and "۷۵۰" in row["itemSummary"]


@pytest.mark.parametrize("kind", ["پارسیان", "گل رز", "سایر"])
def test_custom_coin_weight_and_purity_drive_price_and_can_be_edited(client, kind):
    headers = login(client)
    posted = submit(client, headers, ordinary(kind, coinWeight="۰٫۵", coinAyar="۶۰۰", coinWeight750=1234))
    assert posted.status_code == 201, posted.text
    data = posted.json()
    row = data["data"]["documents"][0]
    assert row["coinWeight750"] == 0.4 and row["amount"] == 86000
    edited = client.patch(f"/api/owner/inventory/{row['id']}", headers=headers,
        json={"revision": data["revision"], "changes": {"coinWeight": 1, "coinAyar": 900, "profitFixed": 2000}})
    assert edited.status_code == 200, edited.text
    corrected = edited.json()["data"]["documents"][0]
    assert corrected["coinWeight750"] == 1.2 and corrected["amount"] == 256000


@pytest.mark.parametrize("changes", [
    {"coinWeight": None}, {"coinWeight": 0}, {"coinAyar": ""}, {"coinAyar": 1001}, {"profitFixed": -1},
    {"coinGroup": "bank"}, {"coinGroup": {}}, {"coinPricingVersion": 3},
])
def test_invalid_coin_specs_reject_without_ledger_change(client, changes):
    headers = login(client)
    before = client.get("/api/owner/workspace").json()
    posted = submit(client, headers, ordinary("پارسیان", coinWeight=0.5, coinAyar=750) | changes)
    assert posted.status_code == 422, posted.text
    assert client.get("/api/owner/workspace").json() == before


@pytest.mark.parametrize("kind,rate_key", [
    ("امامی بانکی ۸۶", "bankEmami86Price"), ("نیم سکه بانکی ۸۶", "bankHalf86Price"),
    ("ربع سکه بانکی ۸۶", "bankQuarter86Price"), ("سکه یک گرمی بانکی ۸۶", "bankOneGram86Price"),
])
def test_bank_coins_use_corresponding_board_rate(client, kind, rate_key):
    headers = login(client)
    save_data(client, headers, [], prices={rate_key: 123000, "goldGramPrice": 999999})
    posted = submit(client, headers, {"category": "coin", "itemName": kind, "coinType": kind,
        "coinGroup": "bank", "coinPricingVersion": 2, "coinCount": 2, "coinWeight": "",
        "coinAyar": "", "coinWeight750": 0, "gramPrice": "", "parsianPrice": ""})
    assert posted.status_code == 201, posted.text
    row = posted.json()["data"]["documents"][0]
    assert row["amount"] == 246000 and row["coinPrice"] == "123000"
    assert "coinWeight750" not in row and row["itemWeight"] == 0


@pytest.mark.parametrize("direction", ["purchase", "sale"])
def test_customer_coin_invoice_and_edit_preserve_correct_price_and_identity(client, direction):
    headers = login(client)
    spec = ordinary("پارسیان", coinWeight=0.5, coinAyar=600, coinCount=1)
    row = {**invoice(("coin",), operation=direction)[0], **spec, "amount": 43000,
        "gramDebt": 0, "rialDebt": 0, "coinWeight750": 999, "parsianWeight": "", "parsianPrice": ""}
    stocks = []
    if direction == "sale":
        stock = source(**spec, coinWeight750=0.4, amount=43000)
        row["inventorySourceId"] = stock["id"]
        row.update(settlementVersion=1, cashPaid=10000, settlementGoldPrice=100000,
            settlementRemainder=33000, gramDebt=0.33)
        stocks = [stock]
    posted = save(client, headers, [row, *stocks], customers=[customer([row])])
    assert posted.status_code == 200, posted.text
    saved = posted.json()
    document = saved["data"]["documents"][0]
    assert document["coinWeight750"] == 0.4 and document["itemWeight"] == 0.5
    corrected = patch(client, headers, saved, [document], {0: {"gramPrice": 200000, "profitFixed": 2000}})
    assert corrected.status_code == 200, corrected.text
    data = corrected.json()["data"]
    assert data["documents"][0]["amount"] == 86000
    assert data["customers"][0]["purchases"][0]["amount"] == 86000
    if direction == "sale":
        assert data["documents"][0]["settlementRemainder"] == 76000
        assert data["documents"][0]["gramDebt"] == 0.76
        before = client.get("/api/owner/workspace").json()
        tampered = patch(client, headers, before, [data["documents"][0]], {0: {"coinAyar": 900}})
        assert tampered.status_code == 409
        assert client.get("/api/owner/workspace").json() == before


def test_forged_customer_amount_cannot_override_weight_based_coin_value(client):
    headers = login(client)
    row = {**invoice(("coin",))[0], **ordinary(), "amount": 1}
    assert save(client, headers, [row]).status_code == 422


@pytest.mark.parametrize("version", [1, 2, 3])
@pytest.mark.parametrize("direction", ["purchase", "sale"])
def test_partner_coin_principal_profit_and_physical_snapshots(client, version, direction):
    headers = login(client)
    created, _ = create_partner(client, headers)
    identifier = created["createdId"]
    line = ordinary("پارسیان", coinWeight=0.5, coinAyar=600, gramPrice=50000, wagePercent=2,
        wageFixed=100, otherCosts=50)
    if direction == "sale":
        stock_post = submit(client, headers, line)
        assert stock_post.status_code == 201, stock_post.text
        stock = stock_post.json()["data"]["documents"][0]
        line.update(inventorySourceId=stock["id"], coinWeight=999, coinAyar=999, coinWeight750=999,
            coinGroup="bank", coinPricingVersion=3)
        recorded_date = stock["date"]
    else:
        recorded_date = "2026-10-05"
    posted = post_invoice(client, headers, identifier, calculationVersion=version, direction=direction,
        date=recorded_date, lines=[line], gold18Price=100000)
    assert posted.status_code == 201, posted.text
    data = posted.json()["data"]
    document = data["documents"][0]
    entry = data["partners"][0]["entries"][-1]
    frozen_rate = 50000 if version == 1 else 100000
    expected = (0.8 * frozen_rate * 1.02 + 300) * 1.05 + 2000
    assert document["amount"] == pytest.approx(expected)
    assert float(document["coinWeight"]) == 0.5 and float(document["coinAyar"]) == 600
    assert document["coinWeight750"] == entry["lines"][0]["coinWeight750"] == 0.4
    assert document["scaleWeight"] == 1 and document["totalWeight750"] == 0.8
    assert float(entry["lines"][0]["gramPrice"]) == frozen_rate
    if version >= 2:
        assert document["principalGold"] == 0.8
        assert document["profitGold"] == pytest.approx(0.06095)
        assert entry["goldCredit" if direction == "sale" else "goldDebit"] == pytest.approx(expected / 100000)
    else:
        assert entry["tomanCredit" if direction == "sale" else "tomanDebit"] == pytest.approx(expected)


@pytest.mark.parametrize("version", [1, 2, 3])
def test_partner_edit_recomputes_coin_specs_and_profit(client, version):
    headers = login(client)
    created, _ = create_partner(client, headers)
    identifier = created["createdId"]
    posted = post_invoice(client, headers, identifier, calculationVersion=version,
        lines=[ordinary("گل رز", coinWeight=0.5, coinAyar=600)])
    assert posted.status_code == 201, posted.text
    data = posted.json()["data"]
    entry = data["partners"][0]["entries"][0]
    document = data["documents"][0]
    body = supplier_payload(client, calculationVersion=version, lines=[ordinary("گل رز",
        coinWeight=1, coinAyar=900, profitFixed=2000, documentId=document["id"])])
    edited = client.patch(f"/api/owner/partners/{identifier}/invoices/{entry['id']}", headers=headers, json=body)
    assert edited.status_code == 200, edited.text
    changed = edited.json()["data"]["documents"][0]
    assert changed["id"] == document["id"] and changed["coinWeight750"] == 1.2
    assert changed["amount"] == 256000


def test_legacy_parsian_keeps_per_piece_pricing_even_with_new_fields():
    historical = {"category": "coin", "coinType": "پارسیان", "parsianWeight": 0.5,
        "parsianPrice": 90000, "coinCount": 2, "gramPrice": 100000, "coinWeight": 1,
        "coinAyar": 900, "profitFixed": 1000, "profitPercent": 0}
    assert amount(historical) == 180000
    assert settlement_row_total(historical) == Decimal(180000)
