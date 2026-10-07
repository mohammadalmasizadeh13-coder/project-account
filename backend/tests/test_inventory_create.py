from copy import deepcopy
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.database import empty_workspace
from app.inventory import inventory_requests
from test_accounts import create_staff, login_as, staff_browser
from test_api import client, login
from test_inventory_management import initial_item, remove, save_data


def submit(client, headers, item=None, revision=None, request_id=None):
    if revision is None:
        revision = client.get("/api/owner/workspace").json()["revision"]
    return client.post("/api/owner/inventory", json={"revision": revision,
        "requestId": request_id or str(uuid4()), "item": item or {"category": "crafted", "craftedKind": "انگشتر", "itemName": "انگشتر تازه", "weight": "2", "gramPrice": "100000"}}, headers=headers)


@pytest.mark.parametrize("item,expected_amount,expected_weight", [
    ({"category": "crafted", "craftedKind": "انگشتر", "itemName": "انگشتر", "weight": "۲", "gramPrice": "100000"}, 214000, 2),
    ({"category": "coin", "itemName": "سکه امامی", "coinType": "امامی", "coinCount": "2", "coinPrice": "500000"}, 1000000, 0),
    ({"category": "coin", "itemName": "سکه پارسیان", "coinType": "پارسیان", "parsianWeight": "0.5", "parsianPrice": "90000"}, 90000, 0.5),
    ({"category": "melted", "itemName": "آب‌شده", "meltedWeight": "3", "meltedAyar": "600", "meltedGramPrice": "100000", "assayCode": "123", "laboratoryName": "آزمایشگاه"}, 240000, 2.4),
    ({"category": "currency", "itemName": "دلار", "currencyType": "USD", "currencyAmount": "10.5", "currencyRate": "50000"}, 525000, 0),
])
def test_manual_entry_all_stock_types_are_computed_and_kept_private(client, item, expected_amount, expected_weight):
    headers = login(client)
    customer = {"id": "unchanged", "gramDebt": 4, "rialDebt": 10, "purchases": [], "settlements": [{"id": "paid"}]}
    old = initial_item()
    saved = save_data(client, headers, [old], [customer], openingSetup={"completed": True, "completedAt": "original"})
    response = submit(client, headers, item)
    assert response.status_code == 201, response.text
    workspace = response.json()
    document = workspace["data"]["documents"][0]
    assert document["id"] == workspace["createdId"] and document["productCode"] == "ZG-000002"
    assert document["source"] == "opening-inventory" and document["type"] == f"opening-{item['category']}" and document["entryMethod"] == "manual"
    assert document["amount"] == expected_amount and document["currentAmount"] == expected_amount and document["itemWeight"] == expected_weight
    assert document["customerId"] == "" and document["gramDebt"] == 0 and document["rialDebt"] == 0
    assert workspace["data"]["customers"] == saved["data"]["customers"]
    assert workspace["data"]["documents"][1:] == saved["data"]["documents"]
    assert workspace["data"]["openingSetup"]["documentCount"] == 2
    assert workspace["data"]["openingSetup"]["totalValue"] == old["amount"] + expected_amount
    assert workspace["data"]["openingSetup"]["completedAt"] == "original"
    public = client.get(f"/api/public/products/{document['id']}")
    assert public.status_code == 404
    assert "customerId" not in public.text and "entryMethod" not in public.text


def test_defaults_price_fallback_and_tehran_document_date(client, monkeypatch):
    import app.inventory as inventory
    headers = login(client)
    save_data(client, headers, [], prices={"goldGramPrice": "۲۰۰٬۰۰۰"})
    monkeypatch.setattr(inventory, "iso_now", lambda: "2026-01-01T21:00:00+00:00")
    response = submit(client, headers, {"category": "crafted", "craftedKind": "انگشتر", "itemName": "کار ساخته", "weight": "2"})
    assert response.status_code == 201, response.text
    source = response.json()["data"]["documents"][0]
    assert source["date"] == "2026-01-02"
    assert source["createdAt"] == source["recordedAt"] == "2026-01-01T21:00:00+00:00"
    assert source["gramPrice"] == "200000" and source["amount"] == 428000
    assert source["itemCount"] == "1" and source["ayar"] == "750"
    assert all(source[field] == "0" for field in ("wagePercent", "wageFixed", "otherCosts"))
    assert source["profitPercent"] == "7"


@pytest.mark.parametrize("item,prices,rate_field", [
    ({"category": "coin", "itemName": "نیم سکه", "coinType": "نیم"}, {"halfCoinPrice": "400000"}, "coinPrice"),
    ({"category": "melted", "itemName": "آب‌شده", "meltedWeight": 2, "assayCode": "12", "laboratoryName": "مرکز"}, {"goldGramPrice": "100000"}, "meltedGramPrice"),
    ({"category": "currency", "itemName": "یورو", "currencyType": "EUR", "currencyAmount": "12.5"}, {"eurPrice": "60000"}, "currencyRate"),
])
def test_fallback_uses_the_matching_stock_rate_only(client, item, prices, rate_field):
    headers = login(client)
    save_data(client, headers, [], prices=prices)
    response = submit(client, headers, item)
    assert response.status_code == 201, response.text
    assert response.json()["data"]["documents"][0][rate_field] == next(iter(prices.values()))


def test_explicit_entry_rate_stays_historic_while_current_amount_uses_valid_market_rate(client):
    headers = login(client)
    save_data(client, headers, [], prices={"goldGramPrice": "200000"})
    response = submit(client, headers)
    document = response.json()["data"]["documents"][0]
    assert document["gramPrice"] == "100000" and document["amount"] == 214000 and document["currentAmount"] == 428000
    # A corrupt stored market value must not replace a valid explicit entry rate.
    workspace = client.get("/api/owner/workspace").json()
    assert client.put("/api/owner/workspace", json={"revision": workspace["revision"], "data": {"prices": {"goldGramPrice": "1e18"}}}, headers=headers).status_code == 200
    response = submit(client, headers)
    assert response.status_code == 201 and response.json()["data"]["documents"][0]["currentAmount"] == 214000


@pytest.mark.parametrize("rate", ["0", -1, "invalid", None, ""])
def test_invalid_explicit_rate_never_silently_falls_back(client, rate):
    headers = login(client)
    saved = save_data(client, headers, [], prices={"goldGramPrice": "200000"})
    response = submit(client, headers, {"category": "crafted", "craftedKind": "انگشتر", "itemName": "جنس", "weight": 1, "gramPrice": rate})
    assert response.status_code == 422
    assert client.get("/api/owner/workspace").json() == saved


@pytest.mark.parametrize("item", [
    {"category": "crafted", "craftedKind": "انگشتر", "itemName": "جنس", "weight": 1},
    {"category": "coin", "itemName": "پارسیان", "coinType": "پارسیان", "parsianWeight": "0.5"},
    {"category": "currency", "itemName": "ارز", "currencyType": "USD", "currencyAmount": 10},
])
def test_absent_valid_entry_rate_does_not_create_zero_cost_stock(client, item):
    headers = login(client)
    before = client.get("/api/owner/workspace").json()
    response = submit(client, headers, item)
    assert response.status_code == 422 and "نرخ ورود" in response.json()["detail"]
    assert client.get("/api/owner/workspace").json() == before


@pytest.mark.parametrize("field,value", [("id", "fake"), ("productCode", "ZG-999999"), ("customerId", "seller"), ("gramDebt", 50), ("amount", 1), ("setId", "set"), ("date", "2000-01-01"), ("published", False)])
def test_server_generated_and_financial_reference_fields_cannot_be_forged(client, field, value):
    headers = login(client)
    item = {"category": "crafted", "craftedKind": "انگشتر", "itemName": "جنس", "weight": 1, "gramPrice": 100000, field: value}
    assert submit(client, headers, item).status_code == 422
    assert client.get("/api/owner/workspace").json()["data"]["documents"] == []


@pytest.mark.parametrize("changes", [{"itemName": " "}, {"weight": 0}, {"itemCount": 1.5}, {"ayar": 1001}, {"wagePercent": 101}, {"wageFixed": -1}, {"profitPercent": -1}])
def test_invalid_physical_specs_and_negative_costs_are_rejected(client, changes):
    headers = login(client)
    item = {"category": "crafted", "craftedKind": "انگشتر", "itemName": "جنس", "weight": 1, "gramPrice": 100000, **changes}
    assert submit(client, headers, item).status_code == 422


def test_request_retry_is_durable_and_never_resurrects_deleted_item(client):
    headers = login(client)
    request_id = str(uuid4())
    created = submit(client, headers, request_id=request_id, revision=0)
    assert created.status_code == 201
    retried = submit(client, headers, request_id=request_id, revision=0)
    assert retried.status_code == 200 and retried.json() == created.json()
    assert len(retried.json()["data"]["documents"]) == 1
    different = {"category": "crafted", "craftedKind": "انگشتر", "itemName": "نام متفاوت", "weight": "2", "gramPrice": "100000"}
    assert submit(client, headers, different, request_id=request_id, revision=0).status_code == 409
    assert remove(client, headers, identifier=created.json()["createdId"]).status_code == 200
    assert submit(client, headers, request_id=request_id, revision=0).status_code == 409
    with client.app.state.engine.connect() as connection:
        record = connection.execute(select(inventory_requests)).mappings().one()
        assert record["created_id"] == created.json()["createdId"]


def test_stale_revision_is_atomic_and_does_not_consume_request_id(client):
    headers = login(client)
    first = submit(client, headers)
    request_id = str(uuid4())
    assert submit(client, headers, request_id=request_id, revision=0).status_code == 409
    response = submit(client, headers, request_id=request_id, revision=first.json()["revision"])
    assert response.status_code == 201
    assert [source["productCode"] for source in response.json()["data"]["documents"]] == ["ZG-000002", "ZG-000001"]


def test_document_writer_can_create_without_customer_permissions_and_cannot_replay_another_user(client):
    headers = login(client)
    account = create_staff(client, headers, username="entry-editor", permissions=["documents.write"])
    staff = staff_browser(client)
    staff_headers = login_as(staff, account["username"])
    request_id = str(uuid4())
    response = submit(staff, staff_headers, request_id=request_id)
    assert response.status_code == 201 and set(response.json()["data"]) == {"documents"}
    assert "legacyImported" not in response.json()
    assert submit(client, headers, request_id=request_id).status_code == 409
    reader = create_staff(client, headers, username="entry-reader", permissions=["documents.read"])
    browser = staff_browser(client)
    reader_headers = login_as(browser, reader["username"])
    assert submit(browser, reader_headers).status_code == 403
    assert submit(staff, {"Origin": staff_headers["Origin"]}).status_code == 403


def test_generated_codes_respect_existing_normalized_codes_and_keep_old_records(client):
    headers = login(client)
    existing = [initial_item(productCode=" zg-۰۰۰۰۱۲ "), initial_item(id="other", productCode="CUSTOM-15")]
    save_data(client, headers, existing)
    response = submit(client, headers)
    assert response.status_code == 201
    assert response.json()["data"]["documents"][0]["productCode"] == "ZG-000013"
    assert response.json()["data"]["documents"][1:] == existing
