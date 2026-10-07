from copy import deepcopy

import pytest

from app.database import empty_workspace
from test_api import client, login, restore_historical_workspace, stock_document
from test_accounts import create_staff, login_as, staff_browser


def initial_item(**overrides):
    return stock_document(**{"type": "opening-crafted", "customerId": "", "gramPrice": "100000", "amount": 552000,
        "gramDebt": 0, "rialDebt": 0, **overrides})


def save_data(client, headers, documents, customers=None, **other):
    data = {**empty_workspace(), "documents": documents, "customers": customers or [], **other}
    return restore_historical_workspace(client, data)


def patch(client, headers, identifier="lot-1", revision=None, **changes):
    if revision is None:
        revision = client.get("/api/owner/workspace").json()["revision"]
    return client.patch(f"/api/owner/inventory/{identifier}", json={"revision": revision, "changes": changes}, headers=headers)


def remove(client, headers, identifier="lot-1", revision=None):
    if revision is None:
        revision = client.get("/api/owner/workspace").json()["revision"]
    return client.request("DELETE", f"/api/owner/inventory/{identifier}", json={"revision": revision}, headers=headers)


def purchase_case(**overrides):
    source = {**initial_item(), "source": "purchase", "type": "crafted-purchase", "customerId": "seller", "customerName": "private seller",
        "gramDebt": 2, "rialDebt": 100, "transactionId": "invoice-1", **overrides}
    customer = {"id": "seller", "name": "private seller", "gramDebt": -5, "rialDebt": -300,
        "settlements": [{"id": "settlement-1", "rialAmount": 25}],
        "purchases": [{"id": source["id"], "amount": source["amount"], "detail": "previous", "date": "2026-01-01"},
            {"id": "unrelated", "amount": 50, "detail": "untouched"}]}
    return source, customer


def test_opening_edit_recalculates_historic_and_current_values_without_repricing_history(client):
    headers = login(client)
    original = initial_item()
    other = initial_item(id="other", amount=5000)
    saved = save_data(client, headers, [original, other], prices={"goldGramPrice": "200000"}, openingSetup={"completed": True, "completedAt": "old"})
    response = patch(client, headers, weight="3", itemCount="1", itemName="انگشتر جدید")
    assert response.status_code == 200, response.text
    result = response.json()
    edited = result["data"]["documents"][0]
    assert edited["amount"] == 331000 and edited["currentAmount"] == 661000
    assert edited["itemWeight"] == 3 and edited["gramPrice"] == original["gramPrice"]
    assert edited["gramDebt"] == original["gramDebt"] and edited["rialDebt"] == original["rialDebt"]
    assert result["data"]["documents"][1] == other
    assert result["data"]["openingSetup"] == {"completed": True, "completedAt": "old", "documentCount": 2, "totalValue": 336000}
    assert patch(client, headers, revision=saved["revision"], note="stale").status_code == 409
    assert client.get("/api/owner/workspace").json() == result


def test_purchase_edit_updates_only_matching_customer_cache_and_keeps_debts(client):
    headers = login(client)
    source, customer = purchase_case()
    save_data(client, headers, [source], [customer])
    response = patch(client, headers, weight="3", itemName="نام اصلاح‌شده")
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    updated = data["customers"][0]
    assert data["documents"][0]["amount"] == 662000
    assert updated["purchases"][0]["amount"] == 662000
    assert "نام اصلاح‌شده" in updated["purchases"][0]["detail"]
    assert updated["purchases"][1] == customer["purchases"][1]
    assert updated["gramDebt"] == -5 and updated["rialDebt"] == -300
    assert updated["settlements"] == customer["settlements"]


def test_purchase_delete_reverses_only_its_explicit_debt_and_preserves_customer(client):
    headers = login(client)
    source, customer = purchase_case()
    save_data(client, headers, [source], [customer])
    response = remove(client, headers)
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["documents"] == []
    updated = data["customers"][0]
    assert updated["id"] == "seller" and updated["gramDebt"] == -3 and updated["rialDebt"] == -200
    assert updated["purchases"] == [customer["purchases"][1]]
    assert updated["settlements"] == customer["settlements"]


def test_linked_stock_allows_text_but_rejects_economic_edit_and_delete(client):
    headers = login(client)
    source, customer = purchase_case()
    sale = {"id": "sale-1", "type": "crafted-sale", "inventorySourceId": "lot-1", "category": "crafted", "itemCount": "1", "amount": 400000, "weight": 2.5}
    save_data(client, headers, [source, sale], [customer])
    assert patch(client, headers, weight="3").status_code == 409
    assert remove(client, headers).status_code == 409
    unchanged = patch(client, headers, weight="2.500")
    assert unchanged.status_code == 200
    assert unchanged.json()["data"]["documents"][0]["amount"] == source["amount"]
    response = patch(client, headers, itemName="نام صحیح", description="شرح خصوصی تازه", note="یادداشت خصوصی")
    assert response.status_code == 200, response.text
    assert response.json()["data"]["documents"][0]["amount"] == source["amount"]
    assert response.json()["data"]["documents"][1] == sale
    assert response.json()["data"]["customers"][0]["purchases"][0]["amount"] == customer["purchases"][0]["amount"]
    public = client.get("/api/public/products/lot-1")
    assert public.status_code == 404
    assert all(secret not in public.text for secret in ("شرح خصوصی تازه", "یادداشت خصوصی", "private seller", "gramDebt"))


@pytest.mark.parametrize("grouping", [{"setId": "set-1", "setMode": "separate", "setPieceCount": 2}, {"transactionId": "transaction-1"}])
def test_grouped_unsold_source_can_be_edited_but_not_deleted(client, grouping):
    headers = login(client)
    save_data(client, headers, [initial_item(**grouping), initial_item(id="other", **grouping)])
    response = patch(client, headers, weight="3")
    assert response.status_code == 200, response.text
    assert all(response.json()["data"]["documents"][0][key] == value for key, value in grouping.items())
    assert remove(client, headers).status_code == 409


@pytest.mark.parametrize("category,values,changes,expected_amount,expected_weight", [
    ("crafted", {"weight": "2", "itemCount": "1", "wagePercent": "0", "wageFixed": "0"}, {"weight": "3"}, 300000, 3),
    ("coin", {"coinType": "امامی", "coinCount": "1", "coinPrice": "500000", "wagePercent": "0", "wageFixed": "0"}, {"coinCount": "2"}, 1000000, 0),
    ("coin", {"coinType": "پارسیان", "coinCount": "1", "parsianPrice": "100000", "parsianWeight": "1", "wagePercent": "0", "wageFixed": "0"}, {"parsianWeight": "2"}, 100000, 2),
    ("melted", {"meltedWeight": "2", "meltedAyar": "750", "meltedGramPrice": "100000", "itemCount": "1", "wagePercent": "0", "wageFixed": "0"}, {"meltedWeight": "3", "wageFixed": "1000"}, 301000, 3),
    ("currency", {"currencyType": "USD", "currencyAmount": "10", "currencyRate": "50000"}, {"currencyAmount": "20.5"}, 1025000, 0),
])
def test_all_stock_types_recompute_with_fixed_recorded_rates(client, category, values, changes, expected_amount, expected_weight):
    headers = login(client)
    source = {**initial_item(), "category": category, "type": f"opening-{category}", **values}
    save_data(client, headers, [source])
    response = patch(client, headers, **changes)
    assert response.status_code == 200, response.text
    document = response.json()["data"]["documents"][0]
    assert document["amount"] == expected_amount and document["itemWeight"] == expected_weight
    assert document["category"] == category


@pytest.mark.parametrize("changes", [{"gramPrice": "2"}, {"gramDebt": 9}, {"id": "new"}, {"category": "coin"}, {"setId": "new"}, {"date": "2020-01-01"}, {"weight": -1}, {"itemCount": "1.5"}, {"wagePercent": "101"}])
def test_disallowed_or_invalid_changes_do_not_mutate_workspace(client, changes):
    headers = login(client)
    saved = save_data(client, headers, [initial_item()])
    assert patch(client, headers, **changes).status_code == 422
    assert client.get("/api/owner/workspace").json() == saved


@pytest.mark.parametrize("broken", ["missing", "duplicate", "bad-debt"])
def test_incomplete_customer_links_block_purchase_changes_and_delete(client, broken):
    headers = login(client)
    source, customer = purchase_case()
    if broken == "missing":
        customer["purchases"] = []
    elif broken == "duplicate":
        customer["purchases"].append(deepcopy(customer["purchases"][0]))
    else:
        source["gramDebt"] = "invalid"
    saved = save_data(client, headers, [source], [customer])
    assert patch(client, headers, itemName="new").status_code == 409
    assert remove(client, headers).status_code == 409
    assert client.get("/api/owner/workspace").json() == saved


def test_permissions_require_customer_write_only_for_purchase_and_redact_response(client):
    owner_headers = login(client)
    source, customer = purchase_case()
    save_data(client, owner_headers, [source, initial_item(id="opening")], [customer])
    account = create_staff(client, owner_headers, permissions=["documents.write"])
    staff = staff_browser(client)
    headers = login_as(staff, account["username"])
    assert patch(staff, headers, itemName="new").status_code == 403
    assert remove(staff, headers).status_code == 403
    response = patch(staff, headers, identifier="opening", itemName="مجاز")
    assert response.status_code == 200
    assert set(response.json()["data"]) == {"documents"}


def test_authorized_staff_can_correct_purchase_but_readonly_and_missing_csrf_cannot(client):
    owner_headers = login(client)
    source, customer = purchase_case()
    save_data(client, owner_headers, [source], [customer])
    editor = create_staff(client, owner_headers, username="editor", permissions=["documents.write", "customers.write"])
    staff = staff_browser(client)
    headers = login_as(staff, editor["username"])
    assert patch(staff, headers, weight="3").status_code == 200
    assert set(staff.get("/api/owner/workspace").json()["data"]) == {"documents", "customers"}
    assert patch(staff, {"Origin": headers["Origin"]}, note="missing token").status_code == 403
    reader = create_staff(client, owner_headers, username="reader", permissions=["documents.read"])
    read_client = staff_browser(client)
    read_headers = login_as(read_client, reader["username"])
    assert patch(read_client, read_headers, note="not allowed").status_code == 403


def test_workspace_put_cannot_bypass_sold_stock_guard(client):
    headers = login(client)
    original = initial_item()
    sale = {"id": "sale", "type": "crafted-sale", "inventorySourceId": "lot-1", "itemCount": 1, "category": "crafted"}
    saved = save_data(client, headers, [original, sale])
    for documents in ([sale], [{**original, "weight": "9"}, sale], []):
        response = client.put("/api/owner/workspace", json={"revision": saved["revision"], "data": {"documents": documents}}, headers=headers)
        assert response.status_code == 409
    assert client.get("/api/owner/workspace").json() == saved


def test_customer_name_correction_with_same_identity_keeps_linked_stock_valid(client):
    headers = login(client)
    source, customer = purchase_case()
    sale = {"id": "sale", "type": "crafted-sale", "inventorySourceId": "lot-1", "itemCount": 1, "category": "crafted"}
    saved = save_data(client, headers, [source, sale], [customer])
    changed = deepcopy(saved["data"])
    changed["documents"][0]["customerName"] = "نام صحیح طرف حساب"
    changed["customers"][0]["name"] = "نام صحیح طرف حساب"
    response = client.put("/api/owner/workspace", json={"revision": saved["revision"], "data": changed}, headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["data"]["documents"][0]["customerId"] == source["customerId"]
    assert response.json()["data"]["documents"][1] == sale
    assert response.json()["data"]["customers"][0]["purchases"] == customer["purchases"]
    changed["documents"][0]["customerId"] = "different-customer"
    assert client.put("/api/owner/workspace", json={"revision": response.json()["revision"], "data": changed}, headers=headers).status_code == 409


def test_delete_opening_preserves_other_documents_and_rebuilds_summary(client):
    headers = login(client)
    other = initial_item(id="other", amount=500)
    save_data(client, headers, [initial_item(), other], openingSetup={"completed": True})
    response = remove(client, headers)
    assert response.status_code == 200, response.text
    assert response.json()["data"]["documents"] == [other]
    assert response.json()["data"]["openingSetup"] == {"completed": True, "documentCount": 1, "totalValue": 500}
    assert client.get("/api/public/products/lot-1").status_code == 404


def test_legacy_import_flag_survives_last_stock_deletion_and_still_allows_explicit_import(client):
    headers = login(client)
    initial = client.get("/api/owner/workspace").json()
    assert initial["legacyImported"] is False
    saved = save_data(client, headers, [])
    assert saved["legacyImported"] is False
    legacy = {**empty_workspace(), "documents": [initial_item()]}
    response = client.post("/api/owner/workspace/import", json={"data": legacy, "sourceUsername": "legacy"}, headers=headers)
    assert response.status_code == 200
    assert response.json()["legacyImported"] is True
    assert client.get("/api/owner/workspace").json()["legacyImported"] is True
    edited = patch(client, headers, note="keep import history")
    assert edited.json()["legacyImported"] is True
    removed = remove(client, headers)
    assert removed.status_code == 200 and removed.json()["data"]["documents"] == []
    assert removed.json()["legacyImported"] is True
    after_delete = client.get("/api/owner/workspace").json()
    assert after_delete == removed.json()
    saved_again = client.put("/api/owner/workspace", json={"revision": after_delete["revision"], "data": {"prices": {}}}, headers=headers)
    assert saved_again.json()["legacyImported"] is True
    manual = client.post("/api/owner/workspace/import", json={"data": legacy, "sourceUsername": "legacy"}, headers=headers)
    assert manual.status_code == 200 and manual.json()["legacyImported"] is True
    repeated = client.post("/api/owner/workspace/import", json={"data": legacy, "sourceUsername": "legacy"}, headers=headers)
    assert repeated.json()["legacyImported"] is True and repeated.json()["imported"] is False
