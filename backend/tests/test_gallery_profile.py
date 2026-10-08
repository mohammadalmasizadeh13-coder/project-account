"""Gallery identity is tenant-scoped and snapshotted on issued documents."""
from copy import deepcopy
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import account_profiles, empty_workspace, users
from app.main import create_app
from test_account_isolation import account_settings, accounting, authenticate, register, stock
from test_accounts import create_staff, login_as, staff_browser
from test_api import ORIGIN, PASSWORD, client, login, restore_historical_workspace
from test_document_edits import customer, patch
from test_invoices import invoice, save
from test_partners import create_partner, post_invoice, settlement_body, supplier_payload


def rename(browser, headers, value):
    response = browser.patch("/api/owner/profile", json={"galleryName": value}, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()["user"]


@pytest.mark.parametrize("extra", [{}, {"galleryName": None}, {"galleryName": "   "},
    {"galleryName": "ن" * 121}, {"galleryName": "ﬃ" * 41}, {"galleryName": "نام\x00گالری"}])
def test_signup_requires_valid_gallery_and_leaves_no_partial_account(accounting, extra):
    response = accounting.post("/api/auth/register", json={"username": "new-owner", "password": PASSWORD, **extra}, headers={"Origin": ORIGIN})
    assert response.status_code == 422
    with accounting.app.state.engine.connect() as connection:
        assert connection.execute(select(users)).first() is None
        assert connection.execute(select(account_profiles)).first() is None


def test_gallery_normalization_login_and_restart(tmp_path):
    settings = account_settings(tmp_path)
    with TestClient(create_app(settings)) as browser:
        response = browser.post("/api/auth/register", json={"username": "owner", "password": PASSWORD,
            "galleryName": "  گالري\t كياني  "}, headers={"Origin": ORIGIN})
        assert response.status_code == 201, response.text
        assert response.json()["user"]["galleryName"] == "گالری کیانی"
        headers = {"Origin": ORIGIN, "X-CSRF-Token": response.json()["csrfToken"]}
        expected = rename(browser, headers, "گالری تازه")
    with TestClient(create_app(settings)) as browser:
        authenticate(browser, "owner")
        assert browser.get("/api/auth/session").json()["user"] == expected


def test_profile_is_owner_only_account_scoped_and_inherited_by_staff(accounting):
    user, headers = register(accounting, "gallery-a")
    other = TestClient(accounting.app)
    other_user, other_headers = register(other, "gallery-b")
    rename(other, other_headers, "گالری دوم")
    created = create_staff(accounting, headers, permissions=["documents.write"])
    assert created["galleryName"] == user["galleryName"]
    staff = staff_browser(accounting)
    staff_headers = login_as(staff, created["username"])
    assert staff.patch("/api/owner/profile", json={"galleryName": "جعل"}, headers=staff_headers).status_code == 403
    assert accounting.patch("/api/owner/profile", json={"galleryName": "جعل"}, headers={"Origin": ORIGIN}).status_code == 403
    assert accounting.patch("/api/owner/profile", json={"galleryName": "جعل"}, headers={**headers, "X-Account-ID": other_user["accountId"]}).status_code == 401
    renamed = rename(accounting, headers, "گالری اول")
    assert renamed["galleryName"] == "گالری اول"
    assert staff.get("/api/auth/session").json()["user"]["galleryName"] == "گالری اول"
    assert other.get("/api/auth/session").json()["user"]["galleryName"] == "گالری دوم"
    issued = save(staff, staff_headers, invoice(("coin",), galleryName="نام جعلی"))
    assert issued.status_code == 200, issued.text
    assert issued.json()["data"]["documents"][0]["galleryName"] == "گالری اول"


@pytest.mark.parametrize("value", ["", "  ", "x" * 121, "گالری\x7f"])
def test_invalid_profile_does_not_overwrite_valid_name(accounting, value):
    user, headers = register(accounting, "owner")
    response = accounting.patch("/api/owner/profile", json={"galleryName": value}, headers=headers)
    assert response.status_code == 422
    assert accounting.get("/api/auth/session").json()["user"] == user


def test_old_account_and_legacy_records_remain_unchanged_until_name_is_set(client):
    headers = login(client)
    assert client.get("/api/auth/session").json()["user"]["galleryName"] == ""
    historical = invoice(("coin",))[0]
    historical.pop("invoiceVersion")
    original = restore_historical_workspace(client, {**empty_workspace(), "documents": [historical]})
    rename(client, headers, "گالری قدیمی")
    assert client.get("/api/owner/workspace").json() == original
    response = save(client, headers, [{**historical, "galleryName": "جعلی"}])
    assert response.status_code == 200, response.text
    assert response.json()["data"]["documents"] == [historical]
    created = stock(client, headers, item={"category": "crafted", "craftedKind": "انگشتر", "itemName": "انگشتر", "weight": "2", "gramPrice": "100000"})
    assert created.status_code == 201, created.text
    assert created.json()["data"]["documents"][0]["galleryName"] == "گالری قدیمی"


def test_import_retains_historical_gallery_names_and_requires_owner(accounting):
    _, headers = register(accounting, "owner")
    created = create_staff(accounting, headers, permissions=["documents.write"])
    staff = staff_browser(accounting)
    staff_headers = login_as(staff, created["username"])
    rows = invoice(("coin",), galleryName="نام تاریخی")
    body = {"sourceUsername": "legacy", "data": {**empty_workspace(), "documents": rows}}
    assert staff.post("/api/owner/workspace/import", json=body, headers=staff_headers).status_code == 403
    assert TestClient(accounting.app).post("/api/owner/workspace/import", json=body, headers={"Origin": ORIGIN}).status_code == 401
    response = accounting.post("/api/owner/workspace/import", json=body, headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["data"]["documents"] == rows


def test_documents_keep_issued_gallery_after_rename_edits_and_retry(accounting):
    _, headers = register(accounting, "owner")
    rename(accounting, headers, "گالری نخست")
    rows = invoice(("crafted", "coin"), galleryName="جعل فرستنده")
    request = {"revision": 0, "requestId": str(uuid4()), "data": {"documents": rows, "customers": [customer(rows)]}}
    response = accounting.put("/api/owner/workspace", json=request, headers=headers)
    assert response.status_code == 200, response.text
    saved = response.json()
    assert all(row["galleryName"] == "گالری نخست" for row in saved["data"]["documents"])
    rename(accounting, headers, "گالری دوم")
    replayed = accounting.put("/api/owner/workspace", json=request, headers=headers)
    assert replayed.status_code == 200 and replayed.json() == saved
    edited = patch(accounting, headers, saved, rows, {0: {"note": "اصلاح توضیح"}})
    assert edited.status_code == 200, edited.text
    assert all(row["galleryName"] == "گالری نخست" for row in edited.json()["data"]["documents"])
    forged = [{**row, "galleryName": "جعل"} for row in edited.json()["data"]["documents"]]
    next_invoice = invoice(("coin",))
    response = save(accounting, headers, [*next_invoice, *forged])
    assert response.status_code == 200, response.text
    assert [row["galleryName"] for row in response.json()["data"]["documents"]] == ["گالری دوم", "گالری نخست", "گالری نخست"]


def test_partner_invoices_and_remittances_preserve_gallery_when_edited(accounting):
    _, headers = register(accounting, "partner-owner")
    rename(accounting, headers, "گالری نخست")
    created, _ = create_partner(accounting, headers)
    identifier = created["createdId"]
    body = supplier_payload(accounting, calculationVersion=3)
    saved = post_invoice(accounting, headers, identifier, body=body)
    assert saved.status_code == 201, saved.text
    entry = saved.json()["data"]["partners"][0]["entries"][0]
    assert entry["galleryName"] == "گالری نخست"
    path = f"/api/owner/partners/{identifier}/settlements"
    remittance = accounting.post(path, json=settlement_body(accounting), headers=headers)
    assert remittance.status_code == 201, remittance.text
    remittance_entry = remittance.json()["data"]["partners"][0]["entries"][-1]
    assert remittance_entry["galleryName"] == "گالری نخست"
    rename(accounting, headers, "گالری دوم")
    revised = supplier_payload(accounting, calculationVersion=3)
    revised["lines"].append(deepcopy(revised["lines"][0]))
    response = accounting.patch(f"/api/owner/partners/{identifier}/invoices/{entry['id']}", json=revised, headers=headers)
    assert response.status_code == 200, response.text
    assert all(row["galleryName"] == "گالری نخست" for row in response.json()["data"]["documents"])
    response = accounting.patch(f"{path}/{remittance_entry['id']}", json=settlement_body(accounting, goldAmount=3), headers=headers)
    assert response.status_code == 200, response.text
    assert all(row["galleryName"] == "گالری نخست" for row in response.json()["data"]["partners"][0]["entries"])
    response = accounting.post(path, json=settlement_body(accounting), headers=headers)
    assert response.status_code == 201
    assert response.json()["data"]["partners"][0]["entries"][-1]["galleryName"] == "گالری دوم"
