from copy import deepcopy
from decimal import Decimal, ROUND_HALF_UP
import json
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, select

from app.database import empty_workspace
from app.main import create_app
from app.partners import PartnerInvoice, PartnerSettlement, partner_requests
from app.security import digest
from app.settings import Settings
from test_account_isolation import register
from test_accounts import create_staff, login_as, staff_browser
from test_api import ORIGIN, PASSWORD_HASH, client, login
from test_invoices import invoice, save


def create_partner(browser, headers, request_id=None, **changes):
    body = {"revision": browser.get("/api/owner/workspace").json()["revision"], "requestId": request_id or str(uuid4()),
        "name": "بنکدار تهران", "tradeType": "wholesaler", "phone": "09120000000", **changes}
    response = browser.post("/api/owner/partners", json=body, headers=headers)
    assert response.status_code == 201, response.text
    return response.json(), body


def supplier_payload(browser, **changes):
    return {"revision": browser.get("/api/owner/workspace").json()["revision"], "requestId": str(uuid4()),
        "date": "2026-10-05", "externalInvoiceNumber": "13887", "gold18Price": "100000", "settlementUnit": "gold",
        "lines": [{"category": "crafted", "craftedKind": "انگشتر", "itemName": "انگشتر عمده", "weight": "4.740", "ayar": "750", "itemCount": "3", "wagePercent": "7"}], **changes}


def post_invoice(browser, headers, partner_id, body=None, **changes):
    return browser.post(f"/api/owner/partners/{partner_id}/invoices", json=body or supplier_payload(browser, **changes), headers=headers)


def settlement_body(browser, **changes):
    return {"revision": browser.get("/api/owner/workspace").json()["revision"], "requestId": str(uuid4()), "date": "2026-10-06",
        "direction": "credit", "goldAmount": "2", "tomanAmount": 0, "paymentMethod": "remittance",
        "counterpartyName": "آب‌شده‌فروش", "reference": "حواله ۷۵۶", "note": "پرداخت به طرف معرفی‌شده", **changes}


def partner(browser, identifier):
    return next(item for item in browser.get("/api/owner/workspace").json()["data"]["partners"] if item["id"] == identifier)


@pytest.mark.parametrize("direction,expected", [("debit", 10), ("credit", -10)])
def test_ten_gram_remittance_records_our_debt_or_claim_and_replays(client, direction, expected):
    headers = login(client)
    created, _ = create_partner(client, headers)
    identifier = created["createdId"]
    body = settlement_body(client, direction=direction, goldAmount=10)
    path = f"/api/owner/partners/{identifier}/settlements"
    saved = client.post(path, json=body, headers=headers)
    assert saved.status_code == 201, saved.text
    assert saved.json()["data"]["partners"][0]["goldBalance"] == expected
    assert saved.json()["data"]["documents"] == []
    replay = client.post(path, json=body, headers=headers)
    assert replay.status_code == 200
    assert replay.json()["revision"] == saved.json()["revision"]
    assert len(partner(client, identifier)["entries"]) == 1


@pytest.mark.parametrize("category", ["crafted", "coin"])
def test_partner_sale_credits_claim_links_stock_and_receipt_debits_it(client, category):
    headers = login(client)
    created, _ = create_partner(client, headers)
    identifier = created["createdId"]
    line = ({"category": "crafted", "itemName": "انگشتر", "craftedKind": "انگشتر", "weight": 6, "ayar": 750, "itemCount": 3, "wagePercent": 0, "profitPercent": 0}
        if category == "crafted" else {"category": "coin", "itemName": "سکه", "coinType": "امامی", "coinCount": 3, "coinPrice": 200000, "profitPercent": 0})
    purchase = post_invoice(client, headers, identifier, calculationVersion=2, lines=[line])
    assert purchase.status_code == 201, purchase.text
    stock = purchase.json()["data"]["documents"][0]
    sale_line = {**line, "inventorySourceId": stock["id"], "itemCount" if category == "crafted" else "coinCount": 1}
    # Crafted weight is taken from the original lot, even with a tampered input.
    if category == "crafted":
        sale_line.update(weight=999, ayar=999)
    body = supplier_payload(client, direction="sale", calculationVersion=2, lines=[sale_line], paidGold=0.5, paidToman=50000)
    response = post_invoice(client, headers, identifier, body=body)
    assert response.status_code == 201, response.text
    data = response.json()["data"]
    record = data["partners"][0]
    sale, receipt = record["entries"][-2:]
    assert sale["type"] == "sale" and sale["goldCredit"] == 2 and sale["goldDebit"] == 0
    assert receipt["goldDebit"] == 1 and receipt["goldCredit"] == 0
    assert record["goldBalance"] == 5
    document = data["documents"][0]
    assert document["type"] == f"{category}-sale" and document["inventorySourceId"] == stock["id"]
    assert document["productCode"] == stock["productCode"] and document["partnerId"] == identifier
    assert document["amount"] == 200000 and document["partnerGoldCredit"] == 2
    assert data["customers"] == []
    if category == "crafted":
        assert document["weight"] == "2" and document["ayar"] == "750"
    replay = post_invoice(client, headers, identifier, body=body)
    assert replay.status_code == 200 and replay.json()["revision"] == response.json()["revision"]
    assert len(replay.json()["data"]["documents"]) == 2
    too_many = {**sale_line, "itemCount" if category == "crafted" else "coinCount": 3}
    rejected = post_invoice(client, headers, identifier, direction="sale", calculationVersion=2, lines=[too_many])
    assert rejected.status_code == 422, rejected.text
    assert client.get("/api/owner/workspace").json()["data"] == data
    repeated = post_invoice(client, headers, identifier, direction="sale", calculationVersion=2, lines=[sale_line] * 3)
    assert repeated.status_code == 422, repeated.text
    missing = post_invoice(client, headers, identifier, direction="sale", calculationVersion=2, lines=[line])
    assert missing.status_code == 404, missing.text


def test_partner_profiles_are_separate_from_customer_crm_and_opening_balances_are_explicit(client):
    headers = login(client)
    result, _ = create_partner(client, headers, openingGoldBalance=-2, openingTomanBalance=100000)
    record = result["data"]["partners"][0]
    assert result["revision"] == 1 and result["createdId"] == record["id"]
    assert record["goldBalance"] == -2 and record["tomanBalance"] == 100000 and record["entries"] == []
    assert result["data"]["customers"] == []
    assert client.get("/api/owner/partners").json()["partners"] == [record]
    response = client.patch(f"/api/owner/partners/{record['id']}", json={"revision": 1, "requestId": str(uuid4()), "name": "  همکار جدید  ", "openingGoldBalance": 3}, headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["data"]["partners"][0]["name"] == "همکار جدید"
    assert response.json()["data"]["partners"][0]["goldBalance"] == 3


def test_supplier_invoice_posts_gold_labor_and_physical_total_weight_once(client):
    headers = login(client)
    created, _ = create_partner(client, headers)
    identifier = created["createdId"]
    response = post_invoice(client, headers, identifier)
    assert response.status_code == 201, response.text
    data = response.json()["data"]
    record, document = data["partners"][0], data["documents"][0]
    entry = record["entries"][0]
    assert entry["goldDebit"] == 5.0718 and entry["tomanDebit"] == 0
    assert record["goldBalance"] == 5.0718 and record["tomanBalance"] == 0
    assert entry["externalInvoiceNumber"] == "13887" and entry["invoiceNumber"] == 1
    assert document["type"] == "crafted-purchase" and document["source"] == "partner-invoice"
    assert document["customerId"] == document["partnerId"] == identifier and document["counterpartyType"] == "partner"
    assert document["weight"] == "1.580" and document["itemCount"] == "3" and document["scaleWeight"] == 4.74
    assert document["itemWeight"] == 4.74 and document["totalWeight750"] == 4.74 and document["laborGold"] == 0.3318
    assert document["gramDebt"] == 5.0718 and document["rialDebt"] == 0 and document["amount"] == 507180
    assert data["customers"] == [] and data["openingSetup"] == {}
    assert entry["documentIds"] == [document["id"]] and entry["lines"][0]["goldDebit"] == 5.0718


@pytest.mark.parametrize("mode,expected_physical,expected_gold", [("total", 4.74, 4.05744), ("unit", 14.22, 12.17232)])
def test_supplier_purity_and_unit_mode_convert_without_double_counting(client, mode, expected_physical, expected_gold):
    headers = login(client)
    created, _ = create_partner(client, headers)
    line = {"category": "crafted", "itemName": "طلای ساخته", "weight": "4.740", "ayar": "600", "itemCount": "3", "weightMode": mode, "wagePercent": "7"}
    response = post_invoice(client, headers, created["createdId"], lines=[line])
    assert response.status_code == 201, response.text
    data = response.json()["data"]
    assert data["documents"][0]["scaleWeight"] == expected_physical
    assert data["documents"][0]["itemWeight"] == expected_physical
    assert data["partners"][0]["entries"][0]["goldDebit"] == expected_gold
    assert data["documents"][0]["ayar"] == "600"


def test_mixed_invoice_keeps_fiat_and_gold_in_distinct_ledger_columns(client):
    headers = login(client)
    created, _ = create_partner(client, headers)
    lines = [
        {"category": "crafted", "itemName": "کار ساخته", "weight": "4.740", "ayar": "750", "itemCount": "3", "wagePercent": "7", "otherCosts": "1000", "wageFixed": "2000"},
        {"category": "melted", "itemName": "آب‌شده", "meltedWeight": "6", "meltedAyar": "500", "itemCount": "2", "assayCode": "123", "laboratoryName": "آزمایشگاه"},
        {"category": "coin", "itemName": "سکه", "coinType": "امامی", "coinCount": "2", "coinPrice": "1000000"},
        {"category": "currency", "itemName": "دلار", "currencyType": "USD", "currencyAmount": "10", "currencyRate": "75000"},
    ]
    response = post_invoice(client, headers, created["createdId"], lines=lines)
    assert response.status_code == 201, response.text
    data = response.json()["data"]
    entry = data["partners"][0]["entries"][0]
    assert entry["goldDebit"] == 9.0718 and entry["tomanDebit"] == 2759000
    assert [row["goldDebit"] for row in entry["lines"]] == [5.0718, 4, 0, 0]
    assert [row["tomanDebit"] for row in entry["lines"]] == [9000, 0, 2000000, 750000]
    assert len({row["invoiceNumber"] for row in data["documents"]}) == 1
    assert len({row["productCode"] for row in data["documents"]}) == 4
    assert data["documents"][0]["gramDebt"] == 9.0718 and data["documents"][0]["rialDebt"] == 2759000


def test_coin_only_invoice_does_not_implicitly_convert_cash_to_gold(client):
    headers = login(client)
    created, _ = create_partner(client, headers)
    response = post_invoice(client, headers, created["createdId"], lines=[{"category": "coin", "itemName": "سکه", "coinType": "امامی", "coinCount": "2", "coinPrice": "1000000"}])
    assert response.status_code == 201, response.text
    entry = response.json()["data"]["partners"][0]["entries"][0]
    assert entry["goldDebit"] == 0 and entry["tomanDebit"] == 2000000


def test_optional_toman_invoice_and_direct_payments_keep_units_and_reference(client):
    headers = login(client)
    created, _ = create_partner(client, headers)
    response = post_invoice(client, headers, created["createdId"], settlementUnit="toman", paidGold="1", paidToman="100000", referenceName="نماینده همکار", refNumber="حواله 123")
    assert response.status_code == 201, response.text
    record = response.json()["data"]["partners"][0]
    debit, credit = record["entries"]
    assert debit["tomanDebit"] == 507180 and debit["goldDebit"] == 0
    assert credit["goldCredit"] == 1 and credit["tomanCredit"] == 100000
    assert credit["counterpartyName"] == "نماینده همکار" and credit["reference"] == "حواله 123" and credit["linkedEntryId"] == debit["id"]
    assert record["goldBalance"] == -1 and record["tomanBalance"] == 407180


def test_remittance_credit_and_manual_debit_change_balances_without_deducting_stock(client):
    headers = login(client)
    created, _ = create_partner(client, headers)
    identifier = created["createdId"]
    purchase = post_invoice(client, headers, identifier)
    documents = purchase.json()["data"]["documents"]
    payload = settlement_body(client)
    credited = client.post(f"/api/owner/partners/{identifier}/settlements", json=payload, headers=headers)
    assert credited.status_code == 201, credited.text
    record = credited.json()["data"]["partners"][0]
    assert record["goldBalance"] == 3.0718 and record["entries"][-1]["goldCredit"] == 2
    assert record["entries"][-1]["counterpartyName"] == payload["counterpartyName"] and record["entries"][-1]["paymentMethod"] == "remittance"
    assert credited.json()["data"]["documents"] == documents
    debited = client.post(f"/api/owner/partners/{identifier}/settlements", json=settlement_body(client, direction="debit", goldAmount="1", tomanAmount="200000", paymentMethod="cash"), headers=headers)
    assert debited.status_code == 201, debited.text
    assert debited.json()["data"]["partners"][0]["goldBalance"] == 4.0718
    assert debited.json()["data"]["partners"][0]["tomanBalance"] == 200000
    assert debited.json()["data"]["documents"] == documents


def test_generic_workspace_write_cannot_change_partner_profiles_entries_or_purchase_documents(client):
    headers = login(client)
    created, _ = create_partner(client, headers)
    posted = post_invoice(client, headers, created["createdId"])
    original = client.get("/api/owner/workspace").json()
    unchanged = client.put("/api/owner/workspace", json={"revision": original["revision"], "data": original["data"]}, headers=headers)
    assert unchanged.status_code == 200, unchanged.text
    latest = unchanged.json()
    changed = deepcopy(latest["data"]["partners"])
    changed[0]["name"] = "changed outside partner route"
    assert client.put("/api/owner/workspace", json={"revision": latest["revision"], "data": {"partners": changed}}, headers=headers).status_code == 409
    assert save(client, headers, []).status_code == 409
    for field, value in (("weight", "9"), ("amount", 1), ("partnerId", "foreign"), ("counterpartyType", "customer")):
        changed_docs = deepcopy(latest["data"]["documents"])
        changed_docs[0][field] = value
        assert save(client, headers, changed_docs).status_code == 409
    assert client.get("/api/owner/workspace").json() == latest


def test_posted_supplier_inventory_only_allows_safe_text_correction_and_regular_sale(client):
    headers = login(client)
    created, _ = create_partner(client, headers)
    posted = post_invoice(client, headers, created["createdId"])
    document = posted.json()["data"]["documents"][0]
    revision = posted.json()["revision"]
    assert client.patch(f"/api/owner/inventory/{document['id']}", json={"revision": revision, "changes": {"weight": "4"}}, headers=headers).status_code == 409
    assert client.request("DELETE", f"/api/owner/inventory/{document['id']}", json={"revision": revision}, headers=headers).status_code == 409
    corrected = client.patch(f"/api/owner/inventory/{document['id']}", json={"revision": revision, "changes": {"itemName": "نام صحیح"}}, headers=headers)
    assert corrected.status_code == 200, corrected.text
    source = corrected.json()["data"]["documents"][0]
    sale = invoice(("crafted",), "sale")[0]
    sale.update(inventorySourceId=source["id"], weight=source["weight"], ayar=source["ayar"], itemCount="1", date="2026-10-06")
    sold = save(client, headers, [source, sale])
    assert sold.status_code == 200, sold.text
    assert sold.json()["data"]["partners"] == posted.json()["data"]["partners"]


def test_posted_opening_balance_cannot_be_rewritten_and_profile_name_still_updates(client):
    headers = login(client)
    created, _ = create_partner(client, headers)
    identifier = created["createdId"]
    posted = post_invoice(client, headers, identifier)
    assert client.patch(f"/api/owner/partners/{identifier}", json={"revision": posted.json()["revision"], "requestId": str(uuid4()), "openingGoldBalance": 50}, headers=headers).status_code == 409
    updated = client.patch(f"/api/owner/partners/{identifier}", json={"revision": posted.json()["revision"], "requestId": str(uuid4()), "name": "همکار جدید"}, headers=headers)
    assert updated.status_code == 200, updated.text
    assert updated.json()["data"]["partners"][0]["goldBalance"] == 5.0718
    assert updated.json()["data"]["documents"][0]["customerName"] == "همکار جدید"


def test_partner_mutation_replays_return_latest_workspace_without_duplicate_stock_or_posting(client):
    headers = login(client)
    created, create_body = create_partner(client, headers)
    repeated_create = client.post("/api/owner/partners", json={**create_body, "revision": created["revision"]}, headers=headers)
    assert repeated_create.status_code == 200 and repeated_create.json() == created
    identifier = created["createdId"]
    body = supplier_payload(client)
    saved = post_invoice(client, headers, identifier, body)
    assert saved.status_code == 201
    later = save(client, headers, saved.json()["data"]["documents"], prices={"goldGramPrice": "200000"})
    replay = post_invoice(client, headers, identifier, {**body, "revision": later.json()["revision"]})
    assert replay.status_code == 200 and replay.json()["revision"] == later.json()["revision"]
    assert len(replay.json()["data"]["documents"]) == len(replay.json()["data"]["partners"][0]["entries"]) == 1
    changed = {**body, "externalInvoiceNumber": "different", "revision": later.json()["revision"]}
    assert post_invoice(client, headers, identifier, changed).status_code == 409


def test_partner_receipt_failure_rolls_back_stock_invoice_counter_and_ledger(client):
    headers = login(client)
    created, _ = create_partner(client, headers)
    original = client.get("/api/owner/workspace").json()

    def fail_receipt(connection, cursor, statement, parameters, context, executemany):
        if statement.startswith("INSERT INTO noor_partner_requests"):
            raise RuntimeError("simulated partner receipt failure")

    engine = client.app.state.engine
    event.listen(engine, "before_cursor_execute", fail_receipt)
    try:
        with pytest.raises(RuntimeError, match="simulated partner receipt failure"):
            post_invoice(client, headers, created["createdId"])
    finally:
        event.remove(engine, "before_cursor_execute", fail_receipt)
    assert client.get("/api/owner/workspace").json() == original
    retry = post_invoice(client, headers, created["createdId"])
    assert retry.status_code == 201 and retry.json()["data"]["documents"][0]["invoiceNumber"] == 1


@pytest.mark.parametrize("changes", [{"gold18Price": 0}, {"lines": []}, {"date": "2026-02-30"},
    {"lines": [{"category": "crafted", "itemName": "bad", "weight": 0}]},
    {"lines": [{"category": "crafted", "itemName": "bad", "weight": 4, "ayar": 1001}]},
    {"lines": [{"category": "crafted", "itemName": "bad", "weight": 4, "weightMode": "invalid"}]},
    {"lines": [{"category": "crafted", "itemName": "bad", "weight": 4, "profitPercent": 7}]},
    {"lines": [{"category": ["crafted"], "itemName": "bad", "weight": 4}]},
    {"lines": [{"category": "crafted", "itemName": "bad", "weight": 4, "weightMode": {"unexpected": "total"}}]},
    {"paidGold": -1}, {"paidToman": "NaN"}])
def test_invalid_supplier_invoice_is_atomic(client, changes):
    headers = login(client)
    created, _ = create_partner(client, headers)
    original = client.get("/api/owner/workspace").json()
    assert post_invoice(client, headers, created["createdId"], **changes).status_code == 422
    assert client.get("/api/owner/workspace").json() == original


def test_staff_permissions_and_origin_csrf_apply_before_partner_mutations_and_replay(client):
    owner_headers = login(client)
    created, _ = create_partner(client, owner_headers)
    identifier = created["createdId"]
    reader = create_staff(client, owner_headers, username="partner-reader", permissions=["partners.read"])
    browser = staff_browser(client)
    headers = login_as(browser, reader["username"])
    assert set(browser.get("/api/owner/workspace").json()["data"]) == {"partners"}
    assert browser.get("/api/owner/partners").status_code == 200
    assert post_invoice(browser, headers, identifier).status_code == 403
    writer = create_staff(client, owner_headers, username="partner-writer", permissions=["partners.write"])
    writer_browser = staff_browser(client)
    writer_headers = login_as(writer_browser, writer["username"])
    assert post_invoice(writer_browser, writer_headers, identifier).status_code == 403
    payload = settlement_body(writer_browser)
    assert writer_browser.post(f"/api/owner/partners/{identifier}/settlements", json=payload, headers={"Origin": ORIGIN}).status_code == 403
    saved = writer_browser.post(f"/api/owner/partners/{identifier}/settlements", json=payload, headers=writer_headers)
    assert saved.status_code == 201 and set(saved.json()["data"]) == {"partners"}
    assert writer_browser.post(f"/api/owner/partners/{identifier}/settlements", json=payload, headers={**writer_headers, "Origin": "https://evil.example"}).status_code == 403


def test_partner_cross_account_reads_mutations_and_replay_ids_are_isolated(client):
    original_headers = login(client)
    original, _ = create_partner(client, original_headers)
    browser = TestClient(client.app)
    user, headers = register(browser, "second-partner-account")
    assert browser.get("/api/owner/partners").json() == {"partners": []}
    assert post_invoice(browser, headers, original["createdId"]).status_code == 404
    assert browser.post(f"/api/owner/partners/{original['createdId']}/settlements", json=settlement_body(browser), headers=headers).status_code == 404
    shared_request = str(uuid4())
    second, _ = create_partner(browser, headers, request_id=shared_request, name="private-b")
    third, _ = create_partner(client, original_headers, request_id=shared_request, name="private-a")
    assert second["createdId"] != third["createdId"]
    assert len(browser.get("/api/owner/partners").json()["partners"]) == 1
    foreign_account = client.get("/api/auth/session").json()["user"]["accountId"]
    for route in ("/api/owner/workspace", "/api/owner/partners"):
        assert browser.get(route, headers={"X-Account-ID": foreign_account}).status_code == 401
    stale_headers = {**headers, "X-Account-ID": foreign_account}
    assert browser.post(f"/api/owner/partners/{second['createdId']}/settlements", json=settlement_body(browser), headers=stale_headers).status_code == 401
    assert browser.put("/api/owner/workspace", json={"revision": second["revision"], "data": {}}, headers=stale_headers).status_code == 401


def test_partner_backup_import_validates_balances_and_preserves_profiles_entries_and_stock(client):
    headers = login(client)
    created, _ = create_partner(client, headers)
    saved = post_invoice(client, headers, created["createdId"])
    browser = TestClient(client.app)
    _, new_headers = register(browser, "partner-backup-account")
    data = saved.json()["data"]
    invalid = deepcopy(data)
    invalid["partners"][0]["goldBalance"] = 100000
    assert browser.post("/api/owner/workspace/import", json={"data": invalid, "sourceUsername": "backup"}, headers=new_headers).status_code == 422
    imported = browser.post("/api/owner/workspace/import", json={"data": data, "sourceUsername": "backup"}, headers=new_headers)
    assert imported.status_code == 200, imported.text
    assert imported.json()["data"] == data
    assert browser.post("/api/owner/workspace/import", json={"data": empty_workspace(), "sourceUsername": "different"}, headers=new_headers).status_code == 409


def test_partner_profile_purchase_settlement_and_replay_survive_restart(tmp_path):
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'partners.db'}", upload_dir=tmp_path / "uploads",
        owner_username="owner", owner_password_hash=PASSWORD_HASH, cookie_secure=False, origins=(ORIGIN,))
    with TestClient(create_app(settings)) as first:
        headers = login(first)
        created, _ = create_partner(first, headers)
        invoice_payload = supplier_payload(first)
        posted = post_invoice(first, headers, created["createdId"], invoice_payload)
        settlement = settlement_body(first)
        settled = first.post(f"/api/owner/partners/{created['createdId']}/settlements", json=settlement, headers=headers)
        assert posted.status_code == settled.status_code == 201
        saved = first.get("/api/owner/workspace").json()
    with TestClient(create_app(settings)) as restarted:
        headers = login(restarted)
        assert restarted.get("/api/owner/workspace").json() == saved
        replay = post_invoice(restarted, headers, created["createdId"], invoice_payload)
        assert replay.status_code == 200 and replay.json()["data"] == saved["data"]
        repeated = restarted.post(f"/api/owner/partners/{created['createdId']}/settlements", json=settlement, headers=headers)
        assert repeated.status_code == 200 and repeated.json()["data"] == saved["data"]
        with restarted.app.state.engine.connect() as connection:
            assert len(connection.execute(select(partner_requests)).all()) == 3


def test_blank_profile_patch_is_rejected_before_any_revision_changes(client):
    headers = login(client)
    created, _ = create_partner(client, headers)
    original = client.get("/api/owner/workspace").json()
    response = client.patch(f"/api/owner/partners/{created['createdId']}", json={"revision": original["revision"], "requestId": str(uuid4()), "name": "   "}, headers=headers)
    assert response.status_code == 422
    assert client.get("/api/owner/workspace").json() == original


def test_sparse_partner_backup_hydrates_defaults_and_remains_usable(client):
    headers = login(client)
    imported = client.post("/api/owner/workspace/import", json={"sourceUsername": "sparse backup", "data": {"partners": [{"id": "minimal", "name": "Minimal Supplier"}]}}, headers=headers)
    assert imported.status_code == 200, imported.text
    record = imported.json()["data"]["partners"][0]
    assert record["entries"] == [] and record["tradeType"] == "other" and record["goldBalance"] == 0
    updated = client.patch("/api/owner/partners/minimal", json={"revision": imported.json()["revision"], "requestId": str(uuid4()), "name": "Valid Name"}, headers=headers)
    assert updated.status_code == 200, updated.text
    posted = client.post("/api/owner/partners/minimal/settlements", json=settlement_body(client), headers=headers)
    assert posted.status_code == 201, posted.text
    assert posted.json()["data"]["partners"][0]["goldBalance"] == -2


def test_safe_text_correction_of_one_multi_line_supplier_stock_preserves_posted_financials(client):
    headers = login(client)
    created, _ = create_partner(client, headers)
    lines = [
        {"category": "crafted", "itemName": "انگشتر", "weight": "4.74", "ayar": "750", "wagePercent": "7"},
        {"category": "coin", "itemName": "سکه", "coinType": "امامی", "coinPrice": "1000000"},
    ]
    posted = post_invoice(client, headers, created["createdId"], lines=lines)
    assert posted.status_code == 201, posted.text
    document = posted.json()["data"]["documents"][0]
    corrected = client.patch(f"/api/owner/inventory/{document['id']}", json={"revision": posted.json()["revision"], "changes": {"description": "شرح اصلاح‌شده"}}, headers=headers)
    assert corrected.status_code == 200, corrected.text
    assert corrected.json()["data"]["partners"] == posted.json()["data"]["partners"]
    assert corrected.json()["data"]["documents"][0]["amount"] == document["amount"]


def test_backdated_settlement_recalculates_statement_rows_in_chronological_order(client):
    headers = login(client)
    created, _ = create_partner(client, headers)
    identifier = created["createdId"]
    assert post_invoice(client, headers, identifier).status_code == 201
    backdated = client.post(f"/api/owner/partners/{identifier}/settlements", json=settlement_body(client, date="2026-10-01"), headers=headers)
    assert backdated.status_code == 201, backdated.text
    record = backdated.json()["data"]["partners"][0]
    # Registration order stays intact, and saved row balances follow statement dates.
    assert record["entries"][0]["type"] == "purchase" and record["entries"][0]["goldBalance"] == 3.0718
    assert record["entries"][1]["date"] == "2026-10-01" and record["entries"][1]["goldBalance"] == -2
    assert record["goldBalance"] == 3.0718
    other = TestClient(client.app)
    _, other_headers = register(other, "running-balance-backup")
    malformed = deepcopy(backdated.json()["data"])
    malformed["partners"][0]["entries"][0]["goldBalance"] = 999
    assert other.post("/api/owner/workspace/import", json={"sourceUsername": "invalid statement", "data": malformed}, headers=other_headers).status_code == 422


def test_gold_invoice_adds_crafted_default_profit_after_labor_and_converted_cash_costs(client):
    headers = login(client)
    created, _ = create_partner(client, headers)
    line = {"category": "crafted", "itemName": "کار ساخته", "weight": "4.740", "ayar": "750", "itemCount": "3",
        "wagePercent": "7", "wageFixed": "2000", "otherCosts": "1000", "gramPrice": "999999"}
    response = post_invoice(client, headers, created["createdId"], calculationVersion=2, lines=[line])
    assert response.status_code == 201, response.text
    data = response.json()["data"]
    entry, document = data["partners"][0]["entries"][0], data["documents"][0]
    detail = entry["lines"][0]
    # Total row weight is 4.740, rather than three times that weight.
    # (4.74 + 0.3318 + 0.06 + 0.03) * 1.07 = 5.523126 g.
    assert entry["goldDebit"] == data["partners"][0]["goldBalance"] == 5.523126
    assert entry["tomanDebit"] == data["partners"][0]["tomanBalance"] == 0
    assert entry["calculationVersion"] == 2 and entry["conversionGoldPrice"] == 100000
    assert detail["principalGold"] == 4.74 and detail["laborGold"] == 0.3318
    assert detail["fixedLaborGold"] == 0.06 and detail["otherCostsGold"] == 0.03
    assert detail["profitGold"] == 0.361326 and detail["profitPercent"] == 7
    assert document["gramPrice"] == "100000" and document["profitPercent"] == "7"
    assert document["amount"] == document["currentAmount"] == 552312.6
    assert document["gramDebt"] == 5.523126 and document["rialDebt"] == 0
    assert document["itemWeight"] == document["scaleWeight"] == 4.74
    assert data["customers"] == []


@pytest.mark.parametrize("profit,expected", [("0", 4.05744), ("7", 4.341461), ("100", 8.11488)])
def test_gold_invoice_low_purity_and_explicit_profit_are_respected(client, profit, expected):
    headers = login(client)
    created, _ = create_partner(client, headers)
    response = post_invoice(client, headers, created["createdId"], calculationVersion=2,
        lines=[{"category": "crafted", "itemName": "کار عیار پایین", "weight": "4.740", "ayar": "600", "itemCount": "3", "wagePercent": "7", "profitPercent": profit}])
    assert response.status_code == 201, response.text
    data = response.json()["data"]
    assert data["partners"][0]["goldBalance"] == expected
    assert data["documents"][0]["itemWeight"] == 4.74 and data["documents"][0]["totalWeight750"] == 3.792
    assert data["documents"][0]["profitPercent"] == profit


def test_gold_invoice_mixed_melted_coin_and_currency_convert_with_no_default_profit(client):
    headers = login(client)
    created, _ = create_partner(client, headers)
    response = post_invoice(client, headers, created["createdId"], calculationVersion=2, lines=[
        {"category": "melted", "itemName": "آب‌شده", "meltedWeight": "6", "meltedAyar": "500", "itemCount": "2", "assayCode": "123", "laboratoryName": "آزمایشگاه", "wageFixed": "5000"},
        {"category": "coin", "itemName": "سکه", "coinType": "امامی", "coinCount": "2", "coinPrice": "1000000", "wagePercent": "1", "wageFixed": "1000", "otherCosts": "500"},
        {"category": "currency", "itemName": "دلار", "currencyType": "USD", "currencyAmount": "10", "currencyRate": "75000", "otherCosts": "100"},
    ])
    assert response.status_code == 201, response.text
    data = response.json()["data"]
    entry = data["partners"][0]["entries"][0]
    assert entry["goldDebit"] == 31.84 and entry["tomanDebit"] == 0
    assert [row["goldDebit"] for row in entry["lines"]] == [4.1, 20.23, 7.51]
    assert all(row["tomanDebit"] == row["profitGold"] == row["profitPercent"] == 0 for row in entry["lines"])
    assert [row["amount"] for row in data["documents"]] == [410000, 2023000, 751000]
    assert len({row["invoiceNumber"] for row in data["documents"]}) == 1


def test_gold_invoice_cash_payment_and_rate_are_frozen_across_repricing_replay_and_backup(client):
    headers = login(client)
    created, _ = create_partner(client, headers)
    identifier = created["createdId"]
    payload = supplier_payload(client, calculationVersion=2, paidGold="1", paidToman="100000")
    response = post_invoice(client, headers, identifier, payload)
    assert response.status_code == 201, response.text
    saved = response.json()
    debit, credit = saved["data"]["partners"][0]["entries"]
    assert debit["goldDebit"] == 5.426826
    assert credit["goldCredit"] == 2 and credit["tomanCredit"] == 0
    assert credit["paidGold"] == credit["convertedPaidTomanGold"] == 1
    assert credit["paidToman"] == credit["conversionGoldPrice"] == credit["gold18Price"] == 100000
    assert credit["linkedEntryId"] == debit["id"] and credit["calculationVersion"] == 2
    assert saved["data"]["partners"][0]["goldBalance"] == 3.426826
    repriced = save(client, headers, saved["data"]["documents"], prices={"goldGramPrice": "200000"})
    assert repriced.status_code == 200, repriced.text
    assert repriced.json()["data"]["partners"] == saved["data"]["partners"]
    replay = post_invoice(client, headers, identifier, {**payload, "revision": repriced.json()["revision"]})
    assert replay.status_code == 200 and replay.json()["data"] == repriced.json()["data"]
    assert post_invoice(client, headers, identifier, {**payload, "gold18Price": "200000"}).status_code == 409
    other = TestClient(client.app)
    _, other_headers = register(other, "gold-invoice-backup")
    imported = other.post("/api/owner/workspace/import", json={"data": repriced.json()["data"], "sourceUsername": "gold backup"}, headers=other_headers)
    assert imported.status_code == 200, imported.text
    assert imported.json()["data"]["partners"] == saved["data"]["partners"]


def test_legacy_invoice_receipt_hash_and_missing_version_keep_original_math(client):
    headers = login(client)
    created, _ = create_partner(client, headers)
    payload = supplier_payload(client)
    response = post_invoice(client, headers, created["createdId"], payload)
    assert response.status_code == 201, response.text
    assert response.json()["data"]["partners"][0]["goldBalance"] == 5.0718
    old_body = PartnerInvoice.model_validate(payload).model_dump(mode="json", exclude={"revision", "requestId", "calculationVersion", "direction"})
    expected_hash = digest(json.dumps({"action": "invoice", "partnerId": created["createdId"], "payload": old_body}, sort_keys=True, ensure_ascii=False, allow_nan=False))
    with client.app.state.engine.connect() as connection:
        receipt = connection.execute(select(partner_requests).where(partner_requests.c.created_id == response.json()["createdId"])).mappings().one()
        assert receipt["body_hash"] == expected_hash
    repeated = post_invoice(client, headers, created["createdId"], {**payload, "calculationVersion": 1})
    assert repeated.status_code == 200 and repeated.json() == response.json()
    assert post_invoice(client, headers, created["createdId"], {**payload, "calculationVersion": 2}).status_code == 409


@pytest.mark.parametrize("changes", [
    {"calculationVersion": 4}, {"calculationVersion": "2"}, {"settlementUnit": "toman"},
    {"lines": [{"category": "crafted", "itemName": "نامعتبر", "weight": "4", "profitPercent": "100.01"}]},
    {"lines": [{"category": "crafted", "itemName": "نامعتبر", "weight": "4", "profitPercent": "-1"}]},
    {"paidToman": "0.000001"},
])
def test_invalid_gold_invoice_is_atomic(client, changes):
    headers = login(client)
    created, _ = create_partner(client, headers)
    original = client.get("/api/owner/workspace").json()
    payload = supplier_payload(client, calculationVersion=2)
    payload.update(changes)
    assert post_invoice(client, headers, created["createdId"], payload).status_code == 422
    assert client.get("/api/owner/workspace").json() == original
    retry = post_invoice(client, headers, created["createdId"], calculationVersion=2)
    assert retry.status_code == 201 and retry.json()["data"]["documents"][0]["invoiceNumber"] == 1


def mixed_rows(source_id):
    return [
        {"category": "crafted", "direction": "purchase", "itemName": "کار ساخته", "weight": "10", "ayar": "750", "profitPercent": 0},
        {"category": "coin", "direction": "sale", "inventorySourceId": source_id, "coinCount": 2, "coinPrice": 200000, "profitPercent": 0},
        {"category": "remittance", "remittanceDirection": "credit", "goldAmount": 10, "counterpartyName": "نماینده علی", "reference": "حواله ۱۰", "note": "بابت سند"},
        {"category": "melted", "direction": "purchase", "itemName": "آب‌شده", "meltedWeight": 20, "meltedAyar": 750,
            "assayCode": "123", "laboratoryName": "آزمایشگاه", "meltedFee": 110000, "meltedGramPrice": 999999},
    ]


def coin_inventory(browser, headers, count=3):
    response = browser.post("/api/owner/inventory", headers=headers, json={
        "revision": browser.get("/api/owner/workspace").json()["revision"], "requestId": str(uuid4()),
        "item": {"category": "coin", "itemName": "سکه صندوق", "coinType": "امامی", "coinCount": count, "coinPrice": 200000},
    })
    assert response.status_code == 201, response.text
    return response.json()["data"]["documents"][0]


def post_mixed(browser, headers, identifier, source):
    body = supplier_payload(browser, calculationVersion=3, date=source["date"], lines=mixed_rows(source["id"]))
    response = post_invoice(browser, headers, identifier, body)
    assert response.status_code == 201, response.text
    return response, body


def test_mixed_partner_document_posts_four_operations_with_one_invoice_and_fee(client):
    headers = login(client)
    created, _ = create_partner(client, headers, name="علی بیگلری")
    source = coin_inventory(client, headers)
    response, body = post_mixed(client, headers, created["createdId"], source)
    saved = response.json()
    record = saved["data"]["partners"][0]
    assert len(record["entries"]) == 1
    entry = record["entries"][0]
    expected_melted = Decimal(110000) / Decimal("4.3318") * 20
    expected_debit = (Decimal(10) + expected_melted / 100000).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)
    assert entry["type"] == "mixed" and entry["calculationVersion"] == 3
    assert entry["goldDebit"] == float(expected_debit) and entry["goldCredit"] == 14
    assert record["goldBalance"] == pytest.approx(float(expected_debit) - 14)
    assert [row["goldCredit"] for row in entry["lines"]] == [0, 4, 10, 0]
    assert entry["lines"][1]["goldDebit"] == 0 and entry["lines"][2]["reference"] == "حواله ۱۰"
    assert "documentId" not in entry["lines"][2]
    docs = [row for row in saved["data"]["documents"] if row["id"] in entry["documentIds"]]
    assert len(docs) == 3 and len(entry["lines"]) == 4
    assert {row["invoiceNumber"] for row in docs} == {entry["invoiceNumber"]}
    assert {row["transactionId"] for row in docs} == {entry["transactionId"]}
    assert [row["invoiceLine"] for row in docs] == [1, 2, 3]
    assert {row["invoiceLineCount"] for row in docs} == {3}
    assert docs[1]["inventorySourceId"] == source["id"]
    melted = docs[2]
    assert melted["meltedFee"] == 110000 and melted["amount"] == pytest.approx(float(expected_melted))
    assert float(melted["meltedGramPrice"]) == pytest.approx(110000 / 4.3318)
    assert entry["lines"][3]["meltedGramPrice"] == melted["meltedGramPrice"]
    assert melted["scaleWeight"] == melted["totalWeight750"] == 20
    replay = post_invoice(client, headers, created["createdId"], body)
    assert replay.status_code == 200 and replay.json() == saved
    repriced = save(client, headers, saved["data"]["documents"], prices={"goldGramPrice": "200000", "meltedFee": "220000"})
    assert repriced.status_code == 200, repriced.text
    assert repriced.json()["data"]["partners"] == saved["data"]["partners"]
    other = TestClient(client.app)
    _, other_headers = register(other, "mixed-partner-backup")
    imported = other.post("/api/owner/workspace/import", json={"data": saved["data"], "sourceUsername": "mixed backup"}, headers=other_headers)
    assert imported.status_code == 200, imported.text
    assert imported.json()["data"]["partners"] == saved["data"]["partners"]


@pytest.mark.parametrize("direction", ["purchase", "sale"])
def test_mixed_remittances_and_payments_allow_net_zero_in_one_entry(client, direction):
    headers = login(client)
    created, _ = create_partner(client, headers)
    response = post_invoice(client, headers, created["createdId"], calculationVersion=3, direction=direction,
        paidGold=1, paidToman=100000, lines=[
            {"category": "remittance", "remittanceDirection": "debit" if direction == "purchase" else "credit", "goldAmount": 12},
            {"category": "remittance", "remittanceDirection": "credit" if direction == "purchase" else "debit", "goldAmount": 10},
        ])
    assert response.status_code == 201, response.text
    record = response.json()["data"]["partners"][0]
    assert len(record["entries"]) == 1 and record["goldBalance"] == 0
    entry = record["entries"][0]
    assert entry["goldDebit"] == entry["goldCredit"] == 12
    assert entry["paidGold"] == entry["convertedPaidTomanGold"] == 1 and entry["paidToman"] == 100000
    assert entry["invoiceNumber"] == 1 and entry["documentIds"] == []
    assert response.json()["data"]["documents"] == []
    next_invoice = post_invoice(client, headers, created["createdId"], calculationVersion=3)
    assert next_invoice.status_code == 201 and next_invoice.json()["data"]["documents"][0]["invoiceNumber"] == 2


@pytest.mark.parametrize("category", ["melted", "currency"])
def test_v3_sale_uses_authoritative_melted_or_currency_lot_identity(client, category):
    headers = login(client)
    created, _ = create_partner(client, headers)
    purchase = ({"category": "melted", "itemName": "آب‌شده", "meltedWeight": 8, "meltedAyar": 600, "itemCount": 2,
        "assayCode": "123", "laboratoryName": "آزمایشگاه", "meltedFee": 433180}
        if category == "melted" else {"category": "currency", "itemName": "دلار", "currencyType": "USD", "currencyAmount": 10, "currencyRate": 75000})
    bought = post_invoice(client, headers, created["createdId"], calculationVersion=3, lines=[purchase])
    assert bought.status_code == 201, bought.text
    stock = bought.json()["data"]["documents"][0]
    line = {**purchase, "direction": "sale", "inventorySourceId": stock["id"]}
    if category == "melted":
        line.update(itemCount=1, meltedWeight=999, meltedAyar=999, assayCode="tampered", laboratoryName="tampered", meltedFee=216590)
    else:
        line.update(currencyAmount=3, currencyType="EUR", currencyRate=80000)
    sold = post_invoice(client, headers, created["createdId"], calculationVersion=3, lines=[line])
    assert sold.status_code == 201, sold.text
    entry = sold.json()["data"]["partners"][0]["entries"][-1]
    doc = sold.json()["data"]["documents"][0]
    assert entry["type"] == "sale" and entry["goldDebit"] == entry["lines"][0]["goldDebit"] == 0
    if category == "melted":
        assert entry["goldCredit"] == 1.6 and doc["totalWeight750"] == 3.2
        assert doc["meltedWeight"] == "4" and doc["meltedAyar"] == "600" and doc["assayCode"] == "123"
    else:
        assert entry["goldCredit"] == 2.4 and doc["currencyType"] == "USD"


def test_v3_melted_fee_prices_purity_labor_and_profit_using_monetary_base(client):
    headers = login(client)
    created, _ = create_partner(client, headers)
    response = post_invoice(client, headers, created["createdId"], calculationVersion=3, lines=[{
        "category": "melted", "itemName": "آب‌شده", "meltedWeight": 10, "meltedAyar": 600, "itemCount": 2,
        "assayCode": "123", "laboratoryName": "آزمایشگاه", "meltedFee": 216590, "meltedGramPrice": 99999,
        "wagePercent": 10, "wageFixed": 1000, "otherCosts": 2000, "profitPercent": 20,
    }])
    assert response.status_code == 201, response.text
    doc = response.json()["data"]["documents"][0]
    # 8 g at fee/4.3318 = 50,000: (400,000 + 40,000 + 2,000 + 4,000) * 1.2.
    assert doc["amount"] == 535200 and doc["totalWeight750"] == 8
    line = response.json()["data"]["partners"][0]["entries"][0]["lines"][0]
    assert line["goldDebit"] == 5.352 and line["principalGold"] == 4 and line["laborGold"] == 0.4


@pytest.mark.parametrize("invalid", ["repeat-sale", "missing-fee", "bad-remittance", "bad-direction"])
def test_invalid_mixed_document_rolls_back_every_row_and_invoice_number(client, invalid):
    headers = login(client)
    created, _ = create_partner(client, headers)
    source = coin_inventory(client, headers)
    rows = mixed_rows(source["id"])
    if invalid == "repeat-sale":
        rows.append(dict(rows[1]))
    elif invalid == "missing-fee":
        rows[-1].pop("meltedFee")
    elif invalid == "bad-remittance":
        rows[2]["goldAmount"] = 0
    else:
        rows[0]["direction"] = ["purchase"]
    before = client.get("/api/owner/workspace").json()
    rejected = post_invoice(client, headers, created["createdId"], calculationVersion=3, date=source["date"], lines=rows)
    assert rejected.status_code == 422, rejected.text
    assert client.get("/api/owner/workspace").json() == before
    valid, _ = post_mixed(client, headers, created["createdId"], source)
    assert valid.json()["data"]["partners"][0]["entries"][0]["invoiceNumber"] == 1


def edit_payload(browser, body, entry):
    lines = deepcopy(body["lines"])
    for line, saved in zip(lines, entry["lines"]):
        if saved.get("documentId"):
            line["documentId"] = saved["documentId"]
    return {**body, "revision": browser.get("/api/owner/workspace").json()["revision"], "requestId": str(uuid4()), "lines": lines}


def test_edit_mixed_invoice_replaces_balances_preserves_ids_and_replays(client):
    headers = login(client)
    created, _ = create_partner(client, headers)
    source = coin_inventory(client, headers)
    saved, body = post_mixed(client, headers, created["createdId"], source)
    entry = saved.json()["data"]["partners"][0]["entries"][0]
    payload = edit_payload(client, body, entry)
    payload["lines"][0]["weight"] = 12
    payload["lines"][2]["goldAmount"] = 8
    payload["lines"] = list(reversed(payload["lines"]))
    path = f"/api/owner/partners/{created['createdId']}/invoices/{entry['id']}"
    response = client.patch(path, json=payload, headers=headers)
    assert response.status_code == 200, response.text
    result = response.json()
    record = result["data"]["partners"][0]
    assert len(record["entries"]) == 1 and record["goldBalance"] == pytest.approx(saved.json()["data"]["partners"][0]["goldBalance"] + 4)
    updated = record["entries"][0]
    for field in ("id", "transactionId", "invoiceNumber", "createdAt"):
        assert updated[field] == entry[field]
    assert set(updated["documentIds"]) == set(entry["documentIds"])
    assert len(result["data"]["documents"]) == 4
    replay = client.patch(path, json=payload, headers=headers)
    assert replay.status_code == 200 and replay.json() == result
    assert client.patch(path, json={**payload, "note": "different"}, headers=headers).status_code == 409
    assert client.patch(path, json={**payload, "requestId": str(uuid4())}, headers=headers).status_code == 409
    later = post_invoice(client, headers, created["createdId"], calculationVersion=3)
    assert later.status_code == 201 and later.json()["data"]["documents"][0]["invoiceNumber"] == 2


@pytest.mark.parametrize("change", ["quantity", "remove", "category", "oversale", "foreign-id"])
def test_mixed_edit_rejects_stock_history_damage_atomically(client, change):
    headers = login(client)
    created, _ = create_partner(client, headers)
    source = coin_inventory(client, headers)
    saved, body = post_mixed(client, headers, created["createdId"], source)
    entry = saved.json()["data"]["partners"][0]["entries"][0]
    purchase = saved.json()["data"]["documents"][0]
    sold = post_invoice(client, headers, created["createdId"], calculationVersion=3, date=source["date"], lines=[{
        "category": "crafted", "direction": "sale", "inventorySourceId": purchase["id"], "itemCount": 1, "profitPercent": 0}])
    assert sold.status_code == 201, sold.text
    payload = edit_payload(client, body, entry)
    if change == "quantity":
        payload["lines"][0]["weight"] = 11
    elif change == "remove":
        payload["lines"].pop(0)
    elif change == "category":
        payload["lines"][0] = {**payload["lines"][1], "documentId": entry["lines"][0]["documentId"]}
    elif change == "oversale":
        payload["lines"][1]["coinCount"] = 4
    else:
        payload["lines"][0]["documentId"] = source["id"]
    before = client.get("/api/owner/workspace").json()
    response = client.patch(f"/api/owner/partners/{created['createdId']}/invoices/{entry['id']}", json=payload, headers=headers)
    assert response.status_code == 422, response.text
    assert client.get("/api/owner/workspace").json() == before


def test_mixed_document_and_edited_receipt_survive_restart(tmp_path):
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'mixed-partners.db'}", upload_dir=tmp_path / "uploads",
        owner_username="owner", owner_password_hash=PASSWORD_HASH, cookie_secure=False, origins=(ORIGIN,))
    with TestClient(create_app(settings)) as first:
        headers = login(first)
        created, _ = create_partner(first, headers)
        source = coin_inventory(first, headers)
        saved, body = post_mixed(first, headers, created["createdId"], source)
        entry = saved.json()["data"]["partners"][0]["entries"][0]
        edited_body = edit_payload(first, body, entry)
        edited_body["paidToman"] = 100000
        path = f"/api/owner/partners/{created['createdId']}/invoices/{entry['id']}"
        edited = first.patch(path, json=edited_body, headers=headers)
        assert edited.status_code == 200, edited.text
        state = first.get("/api/owner/workspace").json()
    with TestClient(create_app(settings)) as restarted:
        headers = login(restarted)
        assert restarted.get("/api/owner/workspace").json() == state
        assert post_invoice(restarted, headers, created["createdId"], body).json()["data"] == state["data"]
        replay = restarted.patch(path, json=edited_body, headers=headers)
        assert replay.status_code == 200 and replay.json()["data"] == state["data"]


def test_v3_noop_edit_preserves_total_weight_for_multiple_pieces_already_sold(client):
    headers = login(client)
    created, _ = create_partner(client, headers)
    body = supplier_payload(client, calculationVersion=3)
    saved = post_invoice(client, headers, created["createdId"], body)
    assert saved.status_code == 201, saved.text
    entry = saved.json()["data"]["partners"][0]["entries"][0]
    stock = saved.json()["data"]["documents"][0]
    sold = post_invoice(client, headers, created["createdId"], calculationVersion=3, lines=[{
        "category": "crafted", "direction": "sale", "inventorySourceId": stock["id"], "itemCount": 1}])
    assert sold.status_code == 201, sold.text
    before = sold.json()["data"]
    payload = edit_payload(client, body, entry)
    response = client.patch(f"/api/owner/partners/{created['createdId']}/invoices/{entry['id']}", json=payload, headers=headers)
    assert response.status_code == 200, response.text
    result = response.json()["data"]
    assert result["partners"][0]["goldBalance"] == before["partners"][0]["goldBalance"]
    unchanged = next(row for row in result["documents"] if row["id"] == stock["id"])
    assert unchanged["weight"] == "1.580" and unchanged["scaleWeight"] == 4.74 and unchanged["itemCount"] == "3"
    assert unchanged["amount"] == stock["amount"]


def test_backup_restores_invoice_sequence_for_remittance_only_partner_document(client):
    headers = login(client)
    created, _ = create_partner(client, headers)
    response = post_invoice(client, headers, created["createdId"], calculationVersion=3, lines=[{
        "category": "remittance", "remittanceDirection": "credit", "goldAmount": 10}])
    assert response.status_code == 201, response.text
    other = TestClient(client.app)
    _, other_headers = register(other, "remittance-number-restore")
    imported = other.post("/api/owner/workspace/import", json={"data": response.json()["data"], "sourceUsername": "remittance backup"}, headers=other_headers)
    assert imported.status_code == 200, imported.text
    posted = post_invoice(other, other_headers, created["createdId"], calculationVersion=3)
    assert posted.status_code == 201, posted.text
    assert posted.json()["data"]["documents"][0]["invoiceNumber"] == 2


def test_standalone_remittance_shares_invoice_number_sequence_and_preserves_old_request_hash(client):
    headers = login(client)
    created, _ = create_partner(client, headers)
    identifier = created["createdId"]
    invoice_response = post_invoice(client, headers, identifier)
    assert invoice_response.status_code == 201
    before_docs = invoice_response.json()["data"]["documents"]
    body = settlement_body(client, goldAmount=10)
    path = f"/api/owner/partners/{identifier}/settlements"
    response = client.post(path, json=body, headers=headers)
    assert response.status_code == 201, response.text
    saved = response.json()
    entry = saved["data"]["partners"][0]["entries"][-1]
    assert entry["invoiceNumber"] == 2 and entry["transactionId"] and entry["documentIds"] == []
    assert entry["goldCredit"] == 10 and saved["data"]["documents"] == before_docs
    old_body = PartnerSettlement.model_validate(body).model_dump(mode="json", exclude={"revision", "requestId"})
    expected_hash = digest(json.dumps({"action": "settlement", "partnerId": identifier, "payload": old_body}, sort_keys=True, ensure_ascii=False, allow_nan=False))
    with client.app.state.engine.connect() as connection:
        receipt = connection.execute(select(partner_requests).where(partner_requests.c.created_id == entry["id"])).mappings().one()
        assert receipt["body_hash"] == expected_hash
    replay = client.post(path, json=body, headers=headers)
    assert replay.status_code == 200 and replay.json() == saved
    following = post_invoice(client, headers, identifier, calculationVersion=3)
    assert following.status_code == 201 and following.json()["data"]["documents"][0]["invoiceNumber"] == 3


def test_standalone_remittance_edit_replaces_original_and_recalculates_later_balances(client):
    headers = login(client)
    created, _ = create_partner(client, headers)
    identifier = created["createdId"]
    original_body = settlement_body(client, goldAmount=10, tomanAmount=200000)
    collection = f"/api/owner/partners/{identifier}/settlements"
    original = client.post(collection, json=original_body, headers=headers)
    assert original.status_code == 201, original.text
    entry = original.json()["data"]["partners"][0]["entries"][0]
    following = client.post(collection, json=settlement_body(client, direction="debit", goldAmount=3, date="2026-10-07"), headers=headers)
    assert following.status_code == 201
    body = settlement_body(client, direction="debit", goldAmount=4, tomanAmount=50000, date="2026-10-01", reference="اصلاح حواله", counterpartyName="نماینده جدید", note="شرح جدید")
    path = f"{collection}/{entry['id']}"
    response = client.patch(path, json=body, headers=headers)
    assert response.status_code == 200, response.text
    saved = response.json()
    record = saved["data"]["partners"][0]
    assert len(record["entries"]) == 2 and record["goldBalance"] == 7 and record["tomanBalance"] == 50000
    edited, later = record["entries"]
    for field in ("id", "createdAt", "invoiceNumber", "transactionId"):
        assert edited[field] == entry[field]
    assert edited["goldDebit"] == edited["goldBalance"] == 4 and edited["goldCredit"] == edited["tomanCredit"] == 0
    assert edited["tomanDebit"] == 50000 and later["goldBalance"] == 7
    assert edited["reference"] == "اصلاح حواله" and edited["counterpartyName"] == "نماینده جدید" and edited["note"] == "شرح جدید"
    assert saved["data"]["documents"] == []
    replay = client.patch(path, json=body, headers=headers)
    assert replay.status_code == 200 and replay.json() == saved
    assert client.post(collection, json=original_body, headers=headers).json()["data"] == saved["data"]
    assert client.patch(path, json={**body, "goldAmount": 5}, headers=headers).status_code == 409
    assert client.patch(path, json={**body, "requestId": str(uuid4())}, headers=headers).status_code == 409
    next_invoice = post_invoice(client, headers, identifier, calculationVersion=3)
    assert next_invoice.status_code == 201 and next_invoice.json()["data"]["documents"][0]["invoiceNumber"] == 3


def test_legacy_unnumbered_remittance_is_editable_and_allocates_number_once(client):
    headers = login(client)
    created, _ = create_partner(client, headers)
    identifier = created["createdId"]
    response = client.post(f"/api/owner/partners/{identifier}/settlements", json=settlement_body(client, goldAmount=10), headers=headers)
    assert response.status_code == 201
    legacy = deepcopy(response.json()["data"])
    entry = legacy["partners"][0]["entries"][0]
    entry.pop("invoiceNumber")
    entry.pop("transactionId")
    other = TestClient(client.app)
    _, other_headers = register(other, "old-remittance-editor")
    imported = other.post("/api/owner/workspace/import", json={"data": legacy, "sourceUsername": "old remittance"}, headers=other_headers)
    assert imported.status_code == 200, imported.text
    assert imported.json()["data"]["partners"][0]["entries"][0]["invoiceNumber"] is None
    invoice_response = post_invoice(other, other_headers, identifier, calculationVersion=3)
    assert invoice_response.status_code == 201
    body = settlement_body(other, goldAmount=8)
    path = f"/api/owner/partners/{identifier}/settlements/{entry['id']}"
    edited = other.patch(path, json=body, headers=other_headers)
    assert edited.status_code == 200, edited.text
    saved = edited.json()["data"]["partners"][0]["entries"][0]
    assert saved["invoiceNumber"] == 2 and saved["transactionId"] and saved["createdAt"] == entry["createdAt"]
    again = other.patch(path, json=settlement_body(other, goldAmount=7), headers=other_headers)
    assert again.status_code == 200
    latest = again.json()["data"]["partners"][0]["entries"][0]
    assert latest["invoiceNumber"] == 2 and latest["transactionId"] == saved["transactionId"]
    assert len(again.json()["data"]["partners"][0]["entries"]) == 2


@pytest.mark.parametrize("changes", [{"goldAmount": 0, "tomanAmount": 0}, {"goldAmount": -1}, {"goldAmount": "0.00000001"}, {"paymentMethod": "gold"}])
def test_invalid_standalone_remittance_edit_is_atomic_and_correctable(client, changes):
    headers = login(client)
    created, _ = create_partner(client, headers)
    identifier = created["createdId"]
    response = client.post(f"/api/owner/partners/{identifier}/settlements", json=settlement_body(client, goldAmount=10), headers=headers)
    entry = response.json()["data"]["partners"][0]["entries"][0]
    path = f"/api/owner/partners/{identifier}/settlements/{entry['id']}"
    before = client.get("/api/owner/workspace").json()
    body = settlement_body(client, **changes)
    rejected = client.patch(path, json=body, headers=headers)
    assert rejected.status_code == 422, rejected.text
    assert client.get("/api/owner/workspace").json() == before
    fixed = client.patch(path, json={**body, "goldAmount": 8, "tomanAmount": 0, "paymentMethod": "remittance"}, headers=headers)
    assert fixed.status_code == 200 and fixed.json()["data"]["partners"][0]["goldBalance"] == -8


@pytest.mark.parametrize("kind", ["invoice", "linked-payment", "cash"])
def test_remittance_edit_rejects_nonstandalone_entries(client, kind):
    headers = login(client)
    created, _ = create_partner(client, headers)
    identifier = created["createdId"]
    if kind == "cash":
        response = client.post(f"/api/owner/partners/{identifier}/settlements", json=settlement_body(client, paymentMethod="cash"), headers=headers)
    else:
        response = post_invoice(client, headers, identifier, calculationVersion=2, paidGold=1, referenceName="نماینده")
    assert response.status_code == 201, response.text
    entry = response.json()["data"]["partners"][0]["entries"][0 if kind == "invoice" else -1]
    before = client.get("/api/owner/workspace").json()
    rejected = client.patch(f"/api/owner/partners/{identifier}/settlements/{entry['id']}", json=settlement_body(client), headers=headers)
    assert rejected.status_code == 422 and client.get("/api/owner/workspace").json() == before


def test_remittance_edit_requires_partner_permission_and_scopes_account_and_entry(client):
    owner_headers = login(client)
    created, _ = create_partner(client, owner_headers)
    identifier = created["createdId"]
    response = client.post(f"/api/owner/partners/{identifier}/settlements", json=settlement_body(client, goldAmount=10), headers=owner_headers)
    entry = response.json()["data"]["partners"][0]["entries"][0]
    path = f"/api/owner/partners/{identifier}/settlements/{entry['id']}"
    reader = create_staff(client, owner_headers, username="remittance-editor-reader", permissions=["partners.read"])
    browser = staff_browser(client)
    headers = login_as(browser, reader["username"])
    assert browser.patch(path, json=settlement_body(browser), headers=headers).status_code == 403
    writer = create_staff(client, owner_headers, username="remittance-only-writer", permissions=["partners.write"])
    writer_browser = staff_browser(client)
    writer_headers = login_as(writer_browser, writer["username"])
    payload = settlement_body(writer_browser, goldAmount=8)
    assert writer_browser.patch(path, json=payload, headers={"Origin": ORIGIN}).status_code == 403
    edited = writer_browser.patch(path, json=payload, headers=writer_headers)
    assert edited.status_code == 200 and set(edited.json()["data"]) == {"partners"}
    assert edited.json()["data"]["partners"][0]["goldBalance"] == -8
    assert writer_browser.patch(path, json=payload, headers={**writer_headers, "Origin": "https://evil.example"}).status_code == 403
    other = TestClient(client.app)
    _, other_headers = register(other, "foreign-remittance-editor")
    assert other.patch(path, json=settlement_body(other), headers=other_headers).status_code == 404
    second, _ = create_partner(client, owner_headers, name="همکار دیگر")
    wrong_partner_path = f"/api/owner/partners/{second['createdId']}/settlements/{entry['id']}"
    assert client.patch(wrong_partner_path, json=settlement_body(client), headers=owner_headers).status_code == 404


def test_standalone_remittance_create_and_edit_replay_survive_restart(tmp_path):
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'standalone-remittance.db'}", upload_dir=tmp_path / "uploads",
        owner_username="owner", owner_password_hash=PASSWORD_HASH, cookie_secure=False, origins=(ORIGIN,))
    with TestClient(create_app(settings)) as first:
        headers = login(first)
        created, _ = create_partner(first, headers)
        collection = f"/api/owner/partners/{created['createdId']}/settlements"
        create_body = settlement_body(first, goldAmount=10)
        response = first.post(collection, json=create_body, headers=headers)
        assert response.status_code == 201, response.text
        entry = response.json()["data"]["partners"][0]["entries"][0]
        path = f"{collection}/{entry['id']}"
        edit_body = settlement_body(first, goldAmount=8)
        edited = first.patch(path, json=edit_body, headers=headers)
        assert edited.status_code == 200, edited.text
        state = first.get("/api/owner/workspace").json()
    with TestClient(create_app(settings)) as restarted:
        headers = login(restarted)
        assert restarted.get("/api/owner/workspace").json() == state
        created_replay = restarted.post(collection, json=create_body, headers=headers)
        edited_replay = restarted.patch(path, json=edit_body, headers=headers)
        assert created_replay.status_code == edited_replay.status_code == 200
        assert created_replay.json()["data"] == edited_replay.json()["data"] == state["data"]
        invoice_response = post_invoice(restarted, headers, created["createdId"], calculationVersion=3)
        assert invoice_response.status_code == 201 and invoice_response.json()["data"]["documents"][0]["invoiceNumber"] == 2
