from copy import deepcopy
from uuid import uuid4

import pytest

from test_api import client, login
from test_coin_pricing import ordinary
from test_document_edits import customer, patch
from test_inventory_create import submit
from test_invoices import invoice, save
from test_partners import create_partner, post_invoice, supplier_payload
from app.partners import recalculate_partner


@pytest.mark.parametrize("kind,group", [("ربع عادی", "ordinary"), ("ربع سکه بانکی ۸۶", "bank")])
def test_quarter_invoice_keeps_custom_weight_purity_and_time(client, kind, group):
    headers = login(client)
    created, _ = create_partner(client, headers)
    line = ordinary(kind, coinGroup=group, coinWeight=2.1, coinAyar=850, coinCount=1,
        coinPrice=500000, gramPrice=90000, coinWeight750=999)
    body = supplier_payload(client, calculationVersion=3, date="2026-10-08", invoiceTime="09:45", lines=[line])
    response = post_invoice(client, headers, created["createdId"], body=body)
    assert response.status_code == 201, response.text
    saved = response.json()
    entry = saved["data"]["partners"][0]["entries"][0]
    row = saved["data"]["documents"][0]
    assert row["date"] == entry["date"] == "2026-10-08"
    assert row["invoiceTime"] == entry["invoiceTime"] == "09:45"
    assert float(row["coinWeight"]) == 2.1 and float(row["coinAyar"]) == 850
    assert row["coinWeight750"] == 2.38
    assert row["amount"] == pytest.approx((2.38 * 90000 if group == "ordinary" else 500000) * 1.05 + 1000)
    replay = post_invoice(client, headers, created["createdId"], body=body)
    assert replay.status_code == 200
    assert len(replay.json()["data"]["documents"]) == 1
    edited = {**body, "revision": saved["revision"], "requestId": str(uuid4()), "invoiceTime": "08:15",
        "lines": [{**line, "documentId": row["id"], "coinWeight": 2.033, "coinAyar": 900}]}
    response = client.patch(f"/api/owner/partners/{created['createdId']}/invoices/{entry['id']}", headers=headers, json=edited)
    assert response.status_code == 200, response.text
    updated = response.json()["data"]["documents"][0]
    assert updated["invoiceTime"] == "08:15" and updated["coinWeight750"] == 2.4396
    assert updated["createdAt"] == row["createdAt"] and updated["recordedAt"] == row["recordedAt"]


def test_customer_invoice_time_is_editable_without_changing_audit_time(client):
    headers = login(client)
    rows = invoice(("coin", "currency"))
    for row in rows:
        row.update(date="2026-10-08", invoiceTime="18:20")
    response = save(client, headers, rows, customers=[customer(rows)])
    assert response.status_code == 200, response.text
    saved = response.json()
    documents = saved["data"]["documents"]
    changed = patch(client, headers, saved, documents, {i: {"date": "2026-10-07", "invoiceTime": "07:15"} for i in range(2)})
    assert changed.status_code == 200, changed.text
    for old, new in zip(documents, changed.json()["data"]["documents"]):
        assert new["invoiceTime"] == "07:15" and new["date"] == "2026-10-07"
        assert new["createdAt"] == old["createdAt"] and new["amount"] == old["amount"]
    before = client.get("/api/owner/workspace").json()
    invalid = patch(client, headers, before, before["data"]["documents"], {0: {"invoiceTime": "24:01"}})
    assert invalid.status_code == 422
    assert client.get("/api/owner/workspace").json() == before


def test_partner_sale_keeps_entered_specs_and_preserves_source_stock(client):
    headers = login(client)
    created, _ = create_partner(client, headers)
    stock_response = submit(client, headers, ordinary("ربع عادی", coinWeight=2.033, coinAyar=900))
    stock = deepcopy(stock_response.json()["data"]["documents"][0])
    line = ordinary("ربع عادی", coinWeight=2.05, coinAyar=875, coinCount=1, inventorySourceId=stock["id"])
    response = post_invoice(client, headers, created["createdId"], calculationVersion=3,
        direction="sale", date=stock["date"], invoiceTime="10:05", lines=[line])
    assert response.status_code == 201, response.text
    data = response.json()["data"]
    sale = data["documents"][0]
    assert float(sale["coinWeight"]) == 2.05 and float(sale["coinAyar"]) == 875
    assert next(row for row in data["documents"] if row["id"] == stock["id"]) == stock
    before = client.get("/api/owner/workspace").json()
    rejected = post_invoice(client, headers, created["createdId"], calculationVersion=3,
        direction="sale", date=stock["date"], lines=[{**line, "coinCount": 2}])
    assert rejected.status_code in (409, 422), rejected.text
    assert client.get("/api/owner/workspace").json() == before


@pytest.mark.parametrize("time", ["24:00", "12:60", "1:00", "yesterday", None])
def test_invalid_partner_invoice_time_cannot_write(client, time):
    headers = login(client)
    created, _ = create_partner(client, headers)
    before = client.get("/api/owner/workspace").json()
    response = post_invoice(client, headers, created["createdId"], invoiceTime=time)
    assert response.status_code == 422
    assert client.get("/api/owner/workspace").json() == before


def test_backdated_partner_entries_follow_selected_time_and_keep_audit_timestamps():
    entries = [
        {"date": "2026-10-08", "invoiceTime": "18:00", "createdAt": "2026-10-11T08:00:00Z", "goldDebit": 2},
        {"date": "2026-10-08", "invoiceTime": "09:00", "createdAt": "2026-10-11T09:00:00Z", "goldCredit": 1},
    ]
    result = recalculate_partner({"entries": deepcopy(entries)})
    assert result["entries"][1]["goldBalance"] == -1
    assert result["entries"][0]["goldBalance"] == result["goldBalance"] == 1
    assert [row["createdAt"] for row in result["entries"]] == [row["createdAt"] for row in entries]
