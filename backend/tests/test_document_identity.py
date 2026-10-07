from copy import deepcopy

import pytest

from app.database import empty_workspace
from test_accounts import create_staff, login_as, staff_browser
from test_api import client, login
from test_inventory_create import submit


def document(category="crafted", operation="purchase", **overrides):
    specific = {
        "crafted": {"craftedKind": "انگشتر", "weight": 1, "gramPrice": 100000},
        "coin": {"coinType": "امامی", "coinCount": 1, "coinPrice": 100000},
        "melted": {"meltedWeight": 1, "meltedGramPrice": 100000, "assayCode": "123", "laboratoryName": "مرکز"},
        "currency": {"currencyType": "USD", "currencyAmount": 1, "currencyRate": 100000},
    }[category]
    kind = f"opening-{category}" if operation == "opening" else f"{category}-{operation}"
    return {"id": f"{category}-{operation}", "category": category, "type": kind, "itemName": "کالای مشخص",
        "customerName": "طرف حساب", "gold18Price": 100000, "itemCount": 1,
        **({"source": "opening-inventory"} if operation == "opening" else {}), **specific, **overrides}


def save_documents(client, headers, documents, **changes):
    workspace = client.get("/api/owner/workspace").json()
    return client.put("/api/owner/workspace", json={"revision": workspace["revision"],
        "data": {"documents": documents, **changes}}, headers=headers)


@pytest.mark.parametrize("category", ["crafted", "coin", "melted", "currency"])
@pytest.mark.parametrize("operation", ["purchase", "sale", "opening"])
def test_new_goods_documents_require_a_name_and_accept_explicit_identity(client, category, operation):
    headers = login(client)
    before = client.get("/api/owner/workspace").json()
    candidate = document(category, operation)
    for item_name in (None, "", " \t\n", 123, [], {}):
        response = save_documents(client, headers, [{**candidate, "itemName": item_name}])
        assert response.status_code == 422, response.text
        assert "نام کالا" in response.json()["detail"]
        assert client.get("/api/owner/workspace").json() == before
    response = save_documents(client, headers, [candidate])
    assert response.status_code == 200, response.text
    assert response.json()["data"]["documents"] == [candidate]


@pytest.mark.parametrize("category,field", [("crafted", "craftedKind"), ("coin", "coinType"), ("currency", "currencyType")])
def test_new_goods_documents_require_an_explicit_valid_type(client, category, field):
    headers = login(client)
    candidate = document(category)
    for value in (None, "", " ", "نامعتبر", [], {}):
        response = save_documents(client, headers, [{**candidate, field: value}])
        assert response.status_code == 422, response.text
        assert "نوع" in response.json()["detail"]
    without_type = {key: value for key, value in candidate.items() if key != field}
    assert save_documents(client, headers, [without_type]).status_code == 422
    assert client.get("/api/owner/workspace").json()["data"]["documents"] == []


def test_invalid_goods_identity_rejects_the_entire_ledger_and_customer_write(client):
    headers = login(client)
    before = client.get("/api/owner/workspace").json()
    candidates = [document("coin"), document(itemName="")]
    response = save_documents(client, headers, candidates, customers=[{"id": "new-customer", "rialDebt": 700}])
    assert response.status_code == 422
    assert client.get("/api/owner/workspace").json() == before


def test_legacy_import_and_existing_documents_remain_editable_but_new_copies_need_identity(client):
    headers = login(client)
    legacy = {**empty_workspace(), "documents": [document(itemName="", craftedKind=None)]}
    response = client.post("/api/owner/workspace/import", json={"sourceUsername": "legacy", "data": legacy}, headers=headers)
    assert response.status_code == 200, response.text
    existing = deepcopy(legacy["documents"])
    existing[0]["customerName"] = "نام اصلاح‌شده"
    response = save_documents(client, headers, existing, prices={"goldGramPrice": "200000"})
    assert response.status_code == 200, response.text
    assert response.json()["data"]["documents"] == existing
    copied = {**existing[0], "id": "new-copy"}
    assert save_documents(client, headers, [*existing, copied]).status_code == 422
    assert client.get("/api/owner/workspace").json() == response.json()


def test_expenses_do_not_require_goods_names_or_types(client):
    headers = login(client)
    expense = {"id": "expense-1", "type": "expense", "category": "expense", "description": "اجاره", "amount": 100}
    assert save_documents(client, headers, [expense]).status_code == 200


def test_stock_type_cannot_be_bypassed_by_removing_or_mismatching_category(client):
    headers = login(client)
    for category in (None, "", "expense", [], {}):
        assert save_documents(client, headers, [{**document(), "category": category}]).status_code == 422
    assert save_documents(client, headers, [{**document(), "category": "coin"}]).status_code == 422


def test_document_only_staff_writes_enforce_goods_identity(client):
    owner_headers = login(client)
    account = create_staff(client, owner_headers, username="identity-writer", permissions=["documents.write"])
    browser = staff_browser(client)
    headers = login_as(browser, account["username"])
    assert save_documents(browser, headers, [document(craftedKind="")]).status_code == 422
    response = save_documents(browser, headers, [document()])
    assert response.status_code == 200, response.text
    assert set(response.json()["data"]) == {"documents"}


def test_manual_inventory_add_requires_a_crafted_kind_and_does_not_infer_it_from_name(client):
    headers = login(client)
    before = client.get("/api/owner/workspace").json()
    item = {"category": "crafted", "itemName": "انگشتر نور", "weight": 1, "gramPrice": 100000}
    for kind in (None, "", " ", "نامعتبر"):
        response = submit(client, headers, {**item, "craftedKind": kind})
        assert response.status_code == 422
        assert client.get("/api/owner/workspace").json() == before
    assert submit(client, headers, item).status_code == 422
    assert submit(client, headers, {**item, "craftedKind": "انگشتر"}).status_code == 201
