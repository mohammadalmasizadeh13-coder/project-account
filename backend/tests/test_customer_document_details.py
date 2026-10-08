from copy import deepcopy

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from test_api import client, login, restore_historical_workspace
from test_document_edits import customer, patch
from test_invoices import invoice, save


DETAILS = {
    "customerPhone": "09123456789",
    "customerBirthDate": "1991-04-15",
    "customerAddress": "تهران، خیابان آزادی، پلاک ۱۵",
    "customerNationalId": "0012345678",
    "paymentMethod": "بخشی نقدی؛ باقی با چک\nشماره پیگیری ۱۲۳۴۵",
}
PROFILE = {"phone": DETAILS["customerPhone"], "birthDate": DETAILS["customerBirthDate"],
    "address": DETAILS["customerAddress"], "nationalId": DETAILS["customerNationalId"]}


def test_customer_details_and_free_text_payment_survive_save_profile_changes_and_restart(client):
    headers = login(client)
    rows = invoice(("crafted", "coin"), **{**DETAILS, "customerNationalId": "۰۰۱۲۳۴۵۶۷۸"})
    person = customer(rows, **{**PROFILE, "nationalId": "٠٠١٢٣٤٥٦٧٨"})
    response = save(client, headers, rows, customers=[person])
    assert response.status_code == 200, response.text
    saved = response.json()
    assert all({field: row[field] for field in DETAILS} == DETAILS for row in saved["data"]["documents"])
    assert {field: saved["data"]["customers"][0][field] for field in PROFILE} == PROFILE
    updated_profile = {**saved["data"]["customers"][0], "address": "نشانی جدید"}
    changed = save(client, headers, saved["data"]["documents"], customers=[updated_profile])
    assert changed.status_code == 200, changed.text
    assert changed.json()["data"]["documents"] == saved["data"]["documents"]
    with TestClient(create_app(client.app.state.settings)) as restarted:
        login(restarted)
        assert restarted.get("/api/owner/workspace").json() == changed.json()


@pytest.mark.parametrize("field,value", [
    ("customerPhone", 9123456789), ("customerPhone", "0" * 101),
    ("customerBirthDate", "1991-02-30"), ("customerBirthDate", "2999-01-01"),
    ("customerNationalId", "123456789"), ("customerNationalId", "001234567x"),
    ("customerAddress", {"city": "تهران"}), ("paymentMethod", ["cash"]),
    ("paymentMethod", "x" * 5001),
])
def test_invalid_document_details_reject_the_entire_new_invoice(client, field, value):
    headers = login(client)
    before = client.get("/api/owner/workspace").json()
    rows = invoice(("crafted",), **{**DETAILS, field: value})
    response = save(client, headers, rows, customers=[customer(rows, **PROFILE)])
    assert response.status_code == 422, response.text
    assert client.get("/api/owner/workspace").json() == before


@pytest.mark.parametrize("field,value", [("birthDate", "2999-01-01"), ("nationalId", "123"), ("phone", {})])
def test_invalid_new_customer_profile_rolls_back_document_and_customer(client, field, value):
    headers = login(client)
    before = client.get("/api/owner/workspace").json()
    rows = invoice(("crafted",), **DETAILS)
    response = save(client, headers, rows, customers=[customer(rows, **{**PROFILE, field: value})])
    assert response.status_code == 422, response.text
    assert client.get("/api/owner/workspace").json() == before


@pytest.mark.parametrize("field", list(DETAILS))
def test_invoice_rows_require_matching_customer_details_and_payment(client, field):
    headers = login(client)
    rows = invoice(("crafted", "coin"), **DETAILS)
    rows[1][field] = ""
    before = client.get("/api/owner/workspace").json()
    response = save(client, headers, rows, customers=[customer(rows, **PROFILE)])
    assert response.status_code == 422, response.text
    assert client.get("/api/owner/workspace").json() == before


def test_document_details_edit_and_clear_without_repricing_or_changing_customer_profile(client):
    headers = login(client)
    rows = invoice(("crafted", "coin"), **DETAILS)
    saved = save(client, headers, rows, customers=[customer(rows, **PROFILE)]).json()
    details = {"customerPhone": "09121111111", "customerBirthDate": "1992-05-16",
        "customerAddress": "نشانی زمان صدور سند " * 30, "customerNationalId": "۰۰۲۳۴۵۶۷۸۹",
        "paymentMethod": "نقد و انتقال وجه\nتسویه تا پایان ماه " * 20}
    changes = {index: details for index in range(len(rows))}
    response = patch(client, headers, saved, rows, changes)
    assert response.status_code == 200, response.text
    edited = response.json()
    expected = {**{field: value.strip() for field, value in details.items()}, "customerNationalId": "0023456789"}
    assert all({field: row[field] for field in expected} == expected for row in edited["data"]["documents"])
    financial_fields = ("invoiceNumber", "amount", "gramDebt", "rialDebt")
    assert [[row[field] for field in financial_fields] for row in edited["data"]["documents"]] == [
        [row[field] for field in financial_fields] for row in saved["data"]["documents"]]
    assert {field: edited["data"]["customers"][0][field] for field in PROFILE} == PROFILE
    assert all({field: entry[field] for field in expected} == expected for entry in edited["data"]["customers"][0]["purchases"])
    cleared = patch(client, headers, edited, rows, {index: dict.fromkeys(DETAILS, "") for index in range(len(rows))})
    assert cleared.status_code == 200, cleared.text
    assert all(all(row[field] == "" for field in DETAILS) for row in cleared.json()["data"]["documents"])


def test_partial_snapshot_edit_rejects_complete_invoice_atomically(client):
    headers = login(client)
    rows = invoice(("crafted", "coin"), **DETAILS)
    saved = save(client, headers, rows, customers=[customer(rows, **PROFILE)]).json()
    response = patch(client, headers, saved, rows, {0: {"paymentMethod": "روش متفاوت"}})
    assert response.status_code == 422
    assert client.get("/api/owner/workspace").json() == saved


def test_customer_reassignment_replaces_old_identity_and_preserves_payment(client):
    headers = login(client)
    rows = invoice(("crafted", "coin"), **DETAILS)
    target = {"id": "target", "name": "مشتری تازه", "phone": "09121111111", "address": "نشانی تازه"}
    saved = save(client, headers, rows, customers=[customer(rows, **PROFILE), target]).json()
    response = patch(client, headers, saved, rows, {index: {"customerId": "target"} for index in range(len(rows))})
    assert response.status_code == 200, response.text
    for row in response.json()["data"]["documents"]:
        assert row["customerName"] == target["name"]
        assert row["customerPhone"] == target["phone"] and row["customerAddress"] == target["address"]
        assert row["customerNationalId"] == row["customerBirthDate"] == ""
        assert row["paymentMethod"] == DETAILS["paymentMethod"]


def test_legacy_customer_values_stay_unchanged_when_other_fields_are_saved(client):
    headers = login(client)
    rows = invoice(("crafted",))
    saved = save(client, headers, rows, customers=[customer(rows)]).json()
    legacy = deepcopy(saved["data"])
    legacy["customers"][0].update(birthDate="تاریخ قدیمی", nationalId="شناسه قدیمی", phone=9123456789)
    historical = restore_historical_workspace(client, legacy)
    response = save(client, headers, historical["data"]["documents"], customers=historical["data"]["customers"])
    assert response.status_code == 200, response.text
    assert response.json()["data"] == historical["data"]
