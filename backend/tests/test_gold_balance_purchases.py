"""Gold-balance purchases use the supplier invoice as their only saved record."""
from copy import deepcopy
from uuid import uuid4

import pytest

from test_accounts import create_staff, login_as, staff_browser
from test_api import client, login, restore_historical_workspace
from test_invoices import invoice, save
from test_partners import create_partner, edit_payload, post_invoice, supplier_payload


def melted_line(**changes):
    return {"category": "melted", "itemName": "آب‌شده تراز", "meltedWeight": 12,
        "meltedAyar": 600, "itemCount": 3, "weightMode": "total", "meltedFee": 866360,
        "assayCode": "12345", "laboratoryName": "آزمایشگاه تهران", "profitPercent": 10, **changes}


@pytest.mark.parametrize("weight_mode,equivalent", [("total", 9.6), ("unit", 28.8)])
def test_balance_invoice_freezes_physical_gold_and_replays_once(client, weight_mode, equivalent):
    headers = login(client)
    created, _ = create_partner(client, headers)
    body = supplier_payload(client, calculationVersion=3, goldBalancePurchase=True,
        note="خرید برای تکمیل تراز", lines=[melted_line(weightMode=weight_mode)])
    saved = post_invoice(client, headers, created["createdId"], body)
    assert saved.status_code == 201, saved.text
    data = saved.json()["data"]
    document = data["documents"][0]
    entry = data["partners"][0]["entries"][0]
    assert entry["goldBalancePurchase"] is True and document["goldBalancePurchase"] is True
    assert document["totalWeight750"] == equivalent
    assert document["weight750"] == pytest.approx(equivalent / 3)
    assert document["principalGold"] == equivalent * 2
    assert document["partnerGoldDebit"] == pytest.approx(equivalent * 2.2)
    assert document["assayCode"] == "12345" and document["laboratoryName"] == "آزمایشگاه تهران"
    assert entry["note"] == body["note"] and data["goldPurchases"] == []
    replay = post_invoice(client, headers, created["createdId"], body)
    assert replay.status_code == 200 and replay.json() == saved.json()


def test_only_melted_purchase_rows_are_marked_in_a_mixed_invoice(client):
    headers = login(client)
    created, _ = create_partner(client, headers)
    identifier = created["createdId"]
    previous = post_invoice(client, headers, identifier, calculationVersion=3, lines=[melted_line()])
    assert previous.status_code == 201, previous.text
    source = previous.json()["data"]["documents"][0]
    assert "goldBalancePurchase" not in source
    lines = [melted_line(), melted_line(direction="sale", inventorySourceId=source["id"], itemCount=1),
        {"category": "crafted", "itemName": "انگشتر", "weight": 3, "ayar": 750, "itemCount": 1},
        {"category": "remittance", "remittanceDirection": "credit", "goldAmount": 2}]
    saved = post_invoice(client, headers, identifier, calculationVersion=3, goldBalancePurchase=True, lines=lines)
    assert saved.status_code == 201, saved.text
    data = saved.json()["data"]
    entry = data["partners"][0]["entries"][-1]
    assert entry["goldBalancePurchase"] is True and len(entry["documentIds"]) == 3
    tagged = [row for row in data["documents"] if row.get("goldBalancePurchase")]
    assert len(tagged) == 1 and tagged[0]["type"] == "melted-purchase"
    assert tagged[0]["totalWeight750"] == 9.6
    assert data["goldPurchases"] == []


@pytest.mark.parametrize("version", [1, 2, 3])
def test_flagged_invoice_requires_melted_purchase_atomically(client, version):
    headers = login(client)
    created, _ = create_partner(client, headers)
    before = client.get("/api/owner/workspace").json()
    rejected = post_invoice(client, headers, created["createdId"], calculationVersion=version, goldBalancePurchase=True)
    assert rejected.status_code == 422, rejected.text
    assert client.get("/api/owner/workspace").json() == before


@pytest.mark.parametrize("value", [1, "true", None])
def test_balance_flag_requires_a_json_boolean(client, value):
    headers = login(client)
    created, _ = create_partner(client, headers)
    rejected = post_invoice(client, headers, created["createdId"], calculationVersion=3,
        goldBalancePurchase=value, lines=[melted_line()])
    assert rejected.status_code == 422


@pytest.mark.parametrize("include_flag", [False, True])
def test_edit_preserves_balance_flag_and_updates_physical_gold_date_and_retry(client, include_flag):
    headers = login(client)
    created, _ = create_partner(client, headers)
    body = supplier_payload(client, calculationVersion=3, goldBalancePurchase=True, lines=[melted_line()])
    saved = post_invoice(client, headers, created["createdId"], body)
    assert saved.status_code == 201, saved.text
    entry = saved.json()["data"]["partners"][0]["entries"][0]
    edit = edit_payload(client, body, entry)
    edit.pop("goldBalancePurchase")
    if include_flag:
        edit["goldBalancePurchase"] = False
    edit["date"] = "2026-10-04"
    edit["lines"][0]["meltedWeight"] = 15
    path = f"/api/owner/partners/{created['createdId']}/invoices/{entry['id']}"
    updated = client.patch(path, json=edit, headers=headers)
    assert updated.status_code == 200, updated.text
    data = updated.json()["data"]
    document = data["documents"][0]
    assert data["partners"][0]["entries"][0]["goldBalancePurchase"] is True
    assert document["goldBalancePurchase"] is True
    assert document["totalWeight750"] == 12 and document["date"] == edit["date"]
    assert document["id"] == entry["documentIds"][0] and data["goldPurchases"] == []
    replay = client.patch(path, json=edit, headers=headers)
    assert replay.status_code == 200 and replay.json() == updated.json()
    # Removing the physical purchase leaves no contribution and retains its origin.
    remove = {**edit, "revision": updated.json()["revision"], "requestId": str(uuid4()),
        "lines": [{"category": "remittance", "remittanceDirection": "credit", "goldAmount": 2}]}
    removed = client.patch(path, json=remove, headers=headers)
    assert removed.status_code == 200, removed.text
    assert removed.json()["data"]["documents"] == []
    assert removed.json()["data"]["partners"][0]["entries"][0]["goldBalancePurchase"] is True


def test_gold_purchase_permission_is_required_for_creation_and_existing_flagged_edits(client):
    owner_headers = login(client)
    created, _ = create_partner(client, owner_headers)
    identifier = created["createdId"]
    user = create_staff(client, owner_headers, username="balance-supplier-writer",
        permissions=["partners.write", "documents.write"])
    browser = staff_browser(client)
    headers = login_as(browser, user["username"])
    body = supplier_payload(browser, calculationVersion=3, goldBalancePurchase=True, lines=[melted_line()])
    before = client.get("/api/owner/workspace").json()
    assert post_invoice(browser, headers, identifier, body).status_code == 403
    assert client.get("/api/owner/workspace").json() == before
    saved = post_invoice(client, owner_headers, identifier, body)
    assert saved.status_code == 201, saved.text
    entry = saved.json()["data"]["partners"][0]["entries"][0]
    edit = edit_payload(browser, body, entry)
    edit.pop("goldBalancePurchase")
    path = f"/api/owner/partners/{identifier}/invoices/{entry['id']}"
    assert browser.patch(path, json=edit, headers=headers).status_code == 403
    assert browser.patch(path, json={**edit, "goldBalancePurchase": False}, headers=headers).status_code == 403
    assert client.get("/api/owner/workspace").json()["data"] == saved.json()["data"]
    ordinary = deepcopy(body)
    ordinary.update(revision=saved.json()["revision"], requestId=str(uuid4()))
    ordinary.pop("goldBalancePurchase")
    assert post_invoice(browser, headers, identifier, ordinary).status_code == 201
    authorized = create_staff(client, owner_headers, username="balance-authorized-writer",
        permissions=["partners.write", "documents.write", "goldPurchases.write"])
    authorized_browser = staff_browser(client)
    authorized_headers = login_as(authorized_browser, authorized["username"])
    authorized_body = supplier_payload(authorized_browser, calculationVersion=3, goldBalancePurchase=True,
        lines=[melted_line()])
    allowed = post_invoice(authorized_browser, authorized_headers, identifier, authorized_body)
    assert allowed.status_code == 201, allowed.text


@pytest.mark.parametrize("metadata", [{"source": "partner-invoice"}, {"goldBalancePurchase": True},
    {"goldBalancePurchase": False}, {"source": "partner-invoice", "goldBalancePurchase": True, "totalWeight750": 100}])
def test_workspace_cannot_forge_partner_or_balance_purchase_metadata(client, metadata):
    owner_headers = login(client)
    user = create_staff(client, owner_headers, username="documents-only", permissions=["documents.write"])
    browser = staff_browser(client)
    headers = login_as(browser, user["username"])
    rows = invoice(("melted",))
    before = client.get("/api/owner/workspace").json()
    forged = [{**rows[0], **metadata}]
    assert save(browser, headers, forged).status_code == 409
    assert client.get("/api/owner/workspace").json() == before
    # Ordinary purchases remain writable; adding the marker to one is also blocked.
    ordinary = save(browser, headers, rows)
    assert ordinary.status_code == 200, ordinary.text
    saved = client.get("/api/owner/workspace").json()
    altered = [{**saved["data"]["documents"][0], **metadata}]
    assert save(browser, headers, altered).status_code == 409
    assert client.get("/api/owner/workspace").json() == saved


def test_workspace_protects_existing_balance_markers_without_partner_identifiers(client):
    headers = login(client)
    current = client.get("/api/owner/workspace").json()
    rows = invoice(("melted",), source="partner-invoice", goldBalancePurchase=True, totalWeight750=5)
    # Persisted historical/imported rows may lack the usual partner identity fields.
    saved = restore_historical_workspace(client, {**current["data"], "documents": rows})
    for changes in ({"goldBalancePurchase": False}, {"totalWeight750": 500}):
        assert save(client, headers, [{**rows[0], **changes}]).status_code == 409
        assert client.get("/api/owner/workspace").json() == saved
    stripped = {key: value for key, value in rows[0].items() if key not in {"source", "goldBalancePurchase"}}
    assert save(client, headers, [stripped]).status_code == 409
    assert save(client, headers, []).status_code == 409
    assert client.get("/api/owner/workspace").json() == saved
