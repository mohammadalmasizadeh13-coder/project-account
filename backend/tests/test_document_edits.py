from copy import deepcopy
from uuid import uuid4

import pytest
from sqlalchemy import event

from app.database import empty_workspace
from test_api import client, login, restore_historical_workspace
from test_accounts import create_staff, login_as, staff_browser
from test_invoices import invoice, save, source
from test_invoice_settlement import customer_snapshot, settled_invoice
from test_workspace_durability import receipts


def customer(rows, **overrides):
    sign = 1 if rows[0]["type"].endswith("-sale") else -1
    return {"id": rows[0]["customerId"], "name": rows[0]["customerName"],
        "gramDebt": 3 + sign * sum(row.get("gramDebt", 0) for row in rows),
        "rialDebt": 200 + sign * sum(row.get("rialDebt", 0) for row in rows),
        "settlements": [{"id": "keep-settlement", "rialAmount": 25}],
        "purchases": [{"id": row["id"], "amount": row["amount"], "transactionId": row["transactionId"]} for row in rows], **overrides}


def edit_payload(saved, rows, changes=None):
    return {"revision": saved["revision"], "requestId": str(uuid4()),
        "rows": [{"id": row["id"], "changes": (changes or {}).get(index, {})} for index, row in enumerate(rows)]}


def patch(client, headers, saved, rows, changes=None, payload=None):
    return client.patch(f"/api/owner/documents/{rows[0]['id']}", json=payload or edit_payload(saved, rows, changes), headers=headers)


def remove(client, headers, saved, identifier, request_id=None):
    return client.request("DELETE", f"/api/owner/documents/{identifier}", json={"revision": saved["revision"], "requestId": request_id or str(uuid4())}, headers=headers)


def test_edit_complete_purchase_keeps_identity_and_updates_customer_atomically(client):
    headers = login(client)
    rows = invoice(("crafted", "coin"))
    old_customer = customer(rows)
    saved = save(client, headers, rows, customers=[old_customer]).json()
    response = patch(client, headers, saved, rows, {0: {"weight": "۳", "gramPrice": "۲۰۰٬۰۰۰", "gramDebt": "1", "rialDebt": 400}, 1: {"coinCount": 2}})
    assert response.status_code == 200, response.text
    edited = response.json()
    corrected = edited["data"]["documents"]
    assert [row["amount"] for row in corrected] == [642000, 2140000]
    identity_fields = ("id", "invoiceNumber", "transactionId", "invoiceLine", "invoiceLineCount", "date", "createdAt", "recordedAt", "type", "category")
    assert [{key: row[key] for key in identity_fields} for row in corrected] == [{key: row[key] for key in identity_fields} for row in saved["data"]["documents"]]
    updated_customer = edited["data"]["customers"][0]
    assert updated_customer["gramDebt"] == 2 and updated_customer["rialDebt"] == -200
    assert updated_customer["settlements"] == old_customer["settlements"]
    assert {row["id"]: row["amount"] for row in updated_customer["purchases"]} == {row["id"]: row["amount"] for row in corrected}
    # The unrestricted workspace write still cannot bypass the dedicated path.
    assert save(client, headers, [{**corrected[0], "amount": 1}, corrected[1]]).status_code == 409
    assert client.get("/api/owner/workspace").json() == edited


def test_customer_transfer_reverses_old_debt_and_adds_new_debt_without_touching_settlements(client):
    headers = login(client)
    rows = invoice(("crafted", "coin"))
    old = customer(rows)
    target = {"id": "new-customer", "name": "طرف حساب تازه", "gramDebt": 5, "rialDebt": -20, "purchases": [{"id": "other", "amount": 50}]}
    saved = save(client, headers, rows, customers=[old, target]).json()
    changes = {index: {"date": "2026-10-02", "customerId": target["id"], "customerName": target["name"]} for index in range(2)}
    response = patch(client, headers, saved, rows, changes)
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["customers"][0]["gramDebt"] == 3 and data["customers"][0]["rialDebt"] == 200
    assert data["customers"][0]["purchases"] == []
    assert data["customers"][1]["gramDebt"] == 4.5 and data["customers"][1]["rialDebt"] == -1020
    assert all(row["date"] == "2026-10-02" and row["customerId"] == target["id"] for row in data["documents"])
    assert {entry["id"] for entry in data["customers"][1]["purchases"]} == {"other", *[row["id"] for row in rows]}


def test_sale_edit_recomputes_settlement_and_delete_releases_stock_and_reverses_debt_once(client):
    headers = login(client)
    rows, stocks = settled_invoice()
    saved = save(client, headers, [*rows, *stocks], customers=[customer_snapshot(rows)]).json()
    response = patch(client, headers, saved, rows, {0: {"itemCount": 3, "cashPaid": 2000000, "settlementGoldPrice": 200000}})
    assert response.status_code == 200, response.text
    edited = response.json()
    first = edited["data"]["documents"][0]
    assert first["amount"] == 812735
    assert first["settlementRemainder"] == 8403255
    assert first["gramDebt"] == 42.016275
    assert all(str(row["gold18Price"]) == "200000" for row in edited["data"]["documents"][:4])
    assert edited["data"]["customers"][0]["gramDebt"] == 44.016275
    request_id = str(uuid4())
    deleted = remove(client, headers, edited, rows[2]["id"], request_id)
    assert deleted.status_code == 200, deleted.text
    data = deleted.json()["data"]
    assert data["documents"] == stocks
    assert data["customers"][0]["gramDebt"] == 2 and data["customers"][0]["rialDebt"] == 300
    assert data["customers"][0]["purchases"] == []
    repeated = remove(client, headers, edited, rows[2]["id"], request_id)
    assert repeated.status_code == 200 and repeated.json() == deleted.json()


def test_overselling_edited_invoice_including_repeated_source_is_atomic(client):
    headers = login(client)
    stock = source(count="3")
    rows = invoice(("crafted", "crafted"), "sale", inventorySourceId=stock["id"])
    saved = save(client, headers, [*rows, stock], customers=[customer(rows)]).json()
    response = patch(client, headers, saved, rows, {0: {"itemCount": 2}, 1: {"itemCount": 2}})
    assert response.status_code == 409
    assert client.get("/api/owner/workspace").json() == saved
    accepted = patch(client, headers, saved, rows, {0: {"itemCount": 2}})
    assert accepted.status_code == 200, accepted.text


def test_purchase_with_linked_sale_rejects_financial_edit_and_delete_but_allows_note(client):
    headers = login(client)
    rows = invoice(("crafted",))
    original_customer = customer(rows)
    saved = save(client, headers, rows, customers=[original_customer]).json()
    sales = invoice(("crafted",), "sale", inventorySourceId=rows[0]["id"], customerId="buyer")
    saved = save(client, headers, [*sales, *saved["data"]["documents"]], customers=[customer(sales), original_customer]).json()
    assert patch(client, headers, saved, rows, {0: {"weight": 5}}).status_code == 409
    assert remove(client, headers, saved, rows[0]["id"]).status_code == 409
    assert client.get("/api/owner/workspace").json() == saved
    note = patch(client, headers, saved, rows, {0: {"note": "توضیح اصلاح‌شده"}})
    assert note.status_code == 200, note.text
    assert note.json()["data"]["documents"][1]["amount"] == rows[0]["amount"]


@pytest.mark.parametrize("changes", [{"id": "different"}, {"category": "coin"}, {"type": "crafted-sale"}, {"invoiceNumber": 4}, {"amount": 5}, {"itemCount": "1.5"}, {"weight": -1}, {"date": "invalid"}, {"gramPrice": "NaN"}, {"gramDebt": True}])
def test_invalid_changes_reject_without_mutation(client, changes):
    headers = login(client)
    rows = invoice(("crafted",))
    saved = save(client, headers, rows, customers=[customer(rows)]).json()
    assert patch(client, headers, saved, rows, {0: changes}).status_code == 422
    assert client.get("/api/owner/workspace").json() == saved


def test_partial_or_duplicate_group_and_stale_revision_do_not_mutate(client):
    headers = login(client)
    rows = invoice(("crafted", "coin"))
    saved = save(client, headers, rows, customers=[customer(rows)]).json()
    for members in ([rows[0]], [rows[0], rows[0]]):
        assert patch(client, headers, saved, members).status_code == 409
    stale = {**saved, "revision": saved["revision"] - 1}
    assert patch(client, headers, stale, rows, {0: {"note": "stale"}}).status_code == 409
    assert remove(client, headers, stale, rows[0]["id"]).status_code == 409
    assert client.get("/api/owner/workspace").json() == saved


@pytest.mark.parametrize("unit,changes,expected", [
    ("toman", {"expenseAmount": "۱۲٬۰۰۰"}, 12000),
    ("rial", {"expenseAmount": 12000}, 1200),
    ("currency", {"expenseAmount": 3, "expenseCurrency": "USD", "expenseRate": 100000}, 300000),
    ("gold", {"expenseAmount": 2, "expenseGoldPurity": 375, "expenseRate": 100000}, 100000),
])
def test_expense_edit_and_delete_convert_historical_units_without_customer_access(client, unit, changes, expected):
    headers = login(client)
    expense = {"id": "expense", "type": "expense", "category": "expense", "date": "2026-10-01", "description": "اجاره", "amount": 500}
    saved = restore_historical_workspace(client, {**empty_workspace(), "documents": [expense]})
    editor = create_staff(client, headers, permissions=["documents.write"])
    staff = staff_browser(client)
    staff_headers = login_as(staff, editor["username"])
    changed = patch(staff, staff_headers, saved, [expense], {0: {"expenseUnit": unit, "description": "هزینه اصلاحی", **changes}})
    assert changed.status_code == 200, changed.text
    assert changed.json()["data"]["documents"][0]["amount"] == expected
    assert set(changed.json()["data"]) == {"documents"}
    deleted = remove(staff, staff_headers, changed.json(), "expense")
    assert deleted.status_code == 200 and deleted.json()["data"]["documents"] == []


def test_trade_permission_csrf_and_customer_link_integrity(client):
    headers = login(client)
    rows = invoice(("crafted",))
    saved = save(client, headers, rows, customers=[customer(rows)]).json()
    editor = create_staff(client, headers, permissions=["documents.write"])
    staff = staff_browser(client)
    staff_headers = login_as(staff, editor["username"])
    assert patch(staff, staff_headers, saved, rows, {0: {"note": "forbidden"}}).status_code == 403
    assert remove(staff, staff_headers, saved, rows[0]["id"]).status_code == 403
    assert patch(client, {"Origin": headers["Origin"]}, saved, rows).status_code == 403
    broken = deepcopy(saved["data"])
    broken["customers"][0]["purchases"] = []
    damaged = restore_historical_workspace(client, broken)
    assert remove(client, headers, damaged, rows[0]["id"]).status_code == 409
    assert client.get("/api/owner/workspace").json() == damaged


def test_request_replay_does_not_undo_new_edits_and_payload_reuse_rejected(client):
    headers = login(client)
    rows = invoice(("crafted",))
    saved = save(client, headers, rows, customers=[customer(rows)]).json()
    payload = edit_payload(saved, rows, {0: {"note": "first"}})
    first = patch(client, headers, saved, rows, payload=payload).json()
    second = patch(client, headers, first, rows, {0: {"note": "second"}}).json()
    replay = patch(client, headers, saved, rows, payload=payload)
    assert replay.status_code == 200 and replay.json() == second
    payload["rows"][0]["changes"]["note"] = "changed"
    assert patch(client, headers, saved, rows, payload=payload).status_code == 409
    assert client.get("/api/owner/workspace").json() == second


def test_receipt_failure_rolls_back_customer_and_documents(client):
    headers = login(client)
    rows = invoice(("crafted",))
    saved = save(client, headers, rows, customers=[customer(rows)]).json()
    before_receipts = receipts(client)

    def fail_receipt(connection, cursor, statement, parameters, context, executemany):
        if statement.startswith("INSERT INTO noor_workspace_requests"):
            raise RuntimeError("document receipt failed")

    event.listen(client.app.state.engine, "before_cursor_execute", fail_receipt)
    try:
        with pytest.raises(RuntimeError, match="document receipt failed"):
            patch(client, headers, saved, rows, {0: {"gramDebt": 5}})
    finally:
        event.remove(client.app.state.engine, "before_cursor_execute", fail_receipt)
    assert client.get("/api/owner/workspace").json() == saved
    assert receipts(client) == before_receipts


def test_deleted_invoice_number_is_not_reused(client):
    headers = login(client)
    rows = invoice(("crafted",))
    saved = save(client, headers, rows, customers=[customer(rows)]).json()
    assert remove(client, headers, saved, rows[0]["id"]).status_code == 200
    new_rows = invoice(("coin",))
    second = save(client, headers, new_rows, customers=[customer(new_rows)])
    assert second.status_code == 200
    assert second.json()["data"]["documents"][0]["invoiceNumber"] == 2


def test_legacy_name_link_can_be_corrected_and_deleted_but_ambiguous_name_rejected(client):
    headers = login(client)
    row = invoice(("crafted",))[0]
    for field in ("customerId", "invoiceVersion", "invoiceLine", "invoiceLineCount"):
        row.pop(field)
    person = {"id": "legacy-customer", "name": row["customerName"], "gramDebt": -0.5, "rialDebt": -1000,
        "purchases": [{"id": row["id"], "amount": row["amount"]}]}
    saved = restore_historical_workspace(client, {**empty_workspace(), "documents": [row], "customers": [person]})
    edited = patch(client, headers, saved, [row], {0: {"weight": 3}})
    assert edited.status_code == 200, edited.text
    assert edited.json()["data"]["customers"][0]["purchases"][0]["amount"] == 321000
    deleted = remove(client, headers, edited.json(), row["id"])
    assert deleted.status_code == 200
    assert deleted.json()["data"]["customers"][0]["gramDebt"] == 0
    duplicated = restore_historical_workspace(client, {**empty_workspace(), "documents": [row], "customers": [person, {**person, "id": "duplicate", "purchases": []}]})
    assert remove(client, headers, duplicated, row["id"]).status_code == 409
    assert client.get("/api/owner/workspace").json() == duplicated


def test_legacy_set_group_is_atomic_and_modern_invoices_with_shared_set_are_independent(client):
    headers = login(client)
    rows = invoice(("crafted", "crafted"), setId="legacy-set")
    for row in rows:
        for field in ("transactionId", "invoiceVersion", "invoiceLine", "invoiceLineCount"):
            row.pop(field)
    person = customer([{**row, "transactionId": ""} for row in rows])
    saved = restore_historical_workspace(client, {**empty_workspace(), "documents": rows, "customers": [person]})
    assert patch(client, headers, saved, rows[:1], {0: {"note": "partial"}}).status_code == 409
    edited = patch(client, headers, saved, rows, {0: {"note": "complete"}})
    assert edited.status_code == 200, edited.text
    removed = remove(client, headers, edited.json(), rows[0]["id"])
    assert removed.status_code == 200 and removed.json()["data"]["documents"] == []

    first = invoice(("crafted",), setId="shared-set")
    second = invoice(("crafted",), setId="shared-set")
    saved = save(client, headers, [*first, *second], customers=[customer([*first, *second])]).json()
    response = patch(client, headers, saved, first, {0: {"note": "one invoice"}})
    assert response.status_code == 200, response.text
    assert response.json()["data"]["documents"][1] == saved["data"]["documents"][1]


def test_misc_purchase_recomputes_physical_and_equivalent_weights_and_preserves_independent_gold_entries(client):
    from test_misc_purchases import misc_purchase, seller

    headers = login(client)
    row = misc_purchase()
    gold_entries = [{"id": "manual-gold", "grams": 4, "note": "independent"}]
    saved = save(client, headers, [row], customers=[seller(row)], prices={"goldGramPrice": 200000}, goldPurchases=gold_entries).json()
    response = patch(client, headers, saved, [row], {0: {"weight": 15, "ayar": 500, "itemCount": 3}})
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    changed = data["documents"][0]
    assert changed["weight750"] == 10 and changed["itemWeight"] == 30
    assert changed["amount"] == 3000000 and changed["currentAmount"] == 6000000
    assert data["customers"][0]["purchases"][0]["amount"] == 3000000
    assert data["goldPurchases"] == gold_entries


def test_text_correction_preserves_browser_rounding_at_accepted_half_boundary(client):
    headers = login(client)
    rows, stocks = settled_invoice()
    # A persisted browser value can sit on either side of a floating-point tie.
    rows[3]["amount"] -= 1
    rows[0]["settlementRemainder"] -= 1
    rows[0]["gramDebt"] = round(rows[0]["settlementRemainder"] / rows[0]["settlementGoldPrice"], 6)
    response = save(client, headers, [*rows, *stocks], customers=[customer_snapshot(rows)])
    assert response.status_code == 200, response.text
    saved = response.json()
    response = patch(client, headers, saved, rows, {0: {"note": "شرح اصلاحی"}})
    assert response.status_code == 200, response.text
    updated = response.json()["data"]["documents"][:4]
    assert [row["amount"] for row in updated] == [row["amount"] for row in rows]
    assert updated[0]["gramDebt"] == rows[0]["gramDebt"]


def test_legacy_set_does_not_group_purchase_with_later_legacy_or_modern_sales(client):
    headers = login(client)
    purchased = invoice(("crafted", "crafted"), setId="physical-set")
    for row in purchased:
        for field in ("transactionId", "invoiceVersion", "invoiceLine", "invoiceLineCount"):
            row.pop(field)
    modern_sale = invoice(("crafted",), "sale", setId="physical-set", inventorySourceId=purchased[0]["id"], customerId="buyer")[0]
    legacy_sale = {**modern_sale, "id": "legacy-sale", "inventorySourceId": purchased[1]["id"]}
    for field in ("transactionId", "invoiceVersion", "invoiceLine", "invoiceLineCount"):
        legacy_sale.pop(field)
    seller = customer([{**row, "transactionId": ""} for row in purchased])
    buyer = customer([modern_sale, {**legacy_sale, "transactionId": ""}])
    saved = restore_historical_workspace(client, {**empty_workspace(), "documents": [*purchased, modern_sale, legacy_sale], "customers": [seller, buyer]})
    edited = patch(client, headers, saved, purchased, {0: {"note": "purchase description"}})
    assert edited.status_code == 200, edited.text
    assert edited.json()["data"]["documents"][2:] == [modern_sale, legacy_sale]
    removed = remove(client, headers, edited.json(), legacy_sale["id"])
    assert removed.status_code == 200, removed.text
    assert len(removed.json()["data"]["documents"]) == 3
    assert removed.json()["data"]["documents"][2] == modern_sale


def test_expense_currency_conversion_uses_displayed_default_currency(client):
    headers = login(client)
    expense = {"id": "expense", "type": "expense", "category": "expense", "description": "هزینه", "amount": 500,
        "expenseAmount": 500, "expenseUnit": "toman", "expenseCurrency": None, "expenseRate": None}
    saved = restore_historical_workspace(client, {**empty_workspace(), "documents": [expense]})
    response = patch(client, headers, saved, [expense], {0: {"expenseUnit": "currency", "expenseAmount": 2, "expenseRate": 100000}})
    assert response.status_code == 200, response.text
    assert response.json()["data"]["documents"][0]["expenseCurrency"] == "USD"
    assert response.json()["data"]["documents"][0]["amount"] == 200000
