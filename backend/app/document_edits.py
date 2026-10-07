"""Correct complete customer invoices and expenses in one ledger transaction."""
from copy import deepcopy
from datetime import date
from decimal import Decimal, ROUND_HALF_UP, localcontext
import json
import time
from typing import Any
from uuid import UUID

from fastapi import Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, update

from .database import read_workspace, workspace_requests, workspaces
from .inventory import (CURRENCIES, ECONOMIC_FIELDS, STRING_FIELDS, STOCK_TYPES, TEXT_FIELDS,
    amount as inventory_amount, decimal_output, guard_linked_inventory_changes, is_sale, item_summary, item_weight,
    normalize_misc_purchase, numeric, validate_item, values_differ)
from .invoices import (MAX_SAFE_INTEGER, SETTLEMENT_FIELDS, guard_invoice_stock,
    reserve_invoice_numbers, settlement_row_total, validate_group)
from .pricing import iso_now, number
from .security import account_request_id, digest, has_permission, require_mutation


RATE_FIELDS = {"crafted": {"gramPrice"}, "melted": {"meltedGramPrice"},
    "coin": {"coinPrice", "parsianPrice"}, "currency": {"currencyRate"}}
TRADE_FIELDS = {"date", "customerId", "customerName", "gramDebt", "rialDebt", "gold18Price",
    "profitPercent", "otherCosts", "discountRial", "cashPaid", "settlementGoldPrice"}
EXPENSE_FIELDS = {"date", "description", "note", "expensePayee", "expenseUnit", "expenseCurrency",
    "expenseGoldPurity", "expenseRate", "expenseAmount"}
EDIT_TEXT_FIELDS = STRING_FIELDS | {"expensePayee", "expenseUnit", "expenseCurrency", "customerName"}


class DocumentRevision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(ge=0, strict=True)
    requestId: UUID


class DocumentLineChanges(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str | int
    changes: dict[str, Any] = Field(max_length=40)


class DocumentChanges(DocumentRevision):
    rows: list[DocumentLineChanges] = Field(min_length=1, max_length=100)


def find_document_group(documents, identifier):
    selected = next((row for row in documents if str(row["id"]) == identifier), None)
    if selected is None:
        raise HTTPException(404, "سند پیدا نشد.")
    # Legacy sets also have to remain complete even without invoice metadata.
    if selected.get("transactionId"):
        rows = [row for row in documents if row.get("transactionId") == selected["transactionId"]]
    elif selected.get("setId"):
        headers = ("type", "customerId", "customerName", "date")
        rows = [row for row in documents if not row.get("transactionId") and row.get("setId") == selected["setId"]
            and all(row.get(field) == selected.get(field) for field in headers)]
    else:
        rows = [selected]
    if any(row.get("counterpartyType") == "partner" or row.get("partnerId") for row in rows):
        raise HTTPException(409, "سند همکار به دفتر همکاران مرتبط است و از این بخش قابل تغییر نیست.")
    if any(row.get("source") == "opening-inventory" for row in rows):
        raise HTTPException(409, "موجودی اولیه را از بخش صندوق اصلاح کنید.")
    if any(row.get("category") not in STOCK_TYPES and row.get("type") != "expense" for row in rows):
        raise HTTPException(409, "این نوع سند از بخش مربوط به خودش قابل اصلاح است.")
    if any(row.get("invoiceVersion") == 1 for row in rows):
        validate_group(rows)
    return rows


def normalize_changes(row, changes):
    expense = row.get("type") == "expense"
    allowed = EXPENSE_FIELDS if expense else TEXT_FIELDS | ECONOMIC_FIELDS[row["category"]] | RATE_FIELDS[row["category"]] | TRADE_FIELDS
    if set(changes) - allowed:
        raise HTTPException(422, "فیلد ارسال‌شده برای اصلاح این سند مجاز نیست.")
    normalized = {}
    for field, value in changes.items():
        if field == "date":
            try:
                if not isinstance(value, str) or len(value) != 10:
                    raise ValueError()
                date.fromisoformat(value)
            except ValueError:
                raise HTTPException(422, "تاریخ سند معتبر نیست.")
            normalized[field] = value
        elif field == "customerId":
            if not isinstance(value, (str, int)) or isinstance(value, bool) or not str(value).strip() or len(str(value)) > 200:
                raise HTTPException(422, "طرف حساب معتبر را انتخاب کنید.")
            normalized[field] = value
        elif field in EDIT_TEXT_FIELDS:
            if not isinstance(value, str) or len(value) > (5000 if field in {"description", "note"} else 200):
                raise HTTPException(422, "متن واردشده معتبر نیست.")
            normalized[field] = value.strip()
        elif expense and field in {"expenseGoldPurity", "expenseRate"} and value in (None, ""):
            normalized[field] = None
        else:
            default = 0 if field in {"wagePercent", "wageFixed", "profitPercent", "otherCosts", "discountRial", "gramDebt", "rialDebt", "cashPaid"} else None
            maximum = Decimal(MAX_SAFE_INTEGER) if field in {"cashPaid", "discountRial", "expenseAmount"} else Decimal("1e12")
            normalized[field] = format(numeric(value, "مقدار واردشده", maximum=maximum, default=default), "f")
    if any(key in normalized for key in ("cashPaid", "settlementGoldPrice")) and row.get("settlementVersion") != 1:
        raise HTTPException(422, "اطلاعات پرداخت فقط در ردیف اول سند فروش ثبت می‌شود.")
    return normalized


def normalize_expense(row):
    unit = row.get("expenseUnit") or "toman"
    if unit not in {"toman", "rial", "gold", "currency"}:
        raise HTTPException(422, "واحد هزینه معتبر نیست.")
    if not str(row.get("description") or "").strip():
        raise HTTPException(422, "شرح هزینه را وارد کنید.")
    value = numeric(row.get("expenseAmount", row.get("amount")), "مقدار هزینه", minimum=Decimal("0.00000001"), maximum=Decimal(MAX_SAFE_INTEGER))
    row.update(expenseUnit=unit, expenseAmount=decimal_output(value))
    if unit == "rial":
        value /= 10
    if unit in {"currency", "gold"}:
        rate = numeric(row.get("expenseRate"), "نرخ هزینه", minimum=Decimal("0.00000001"))
        row["expenseRate"] = decimal_output(rate)
        value *= rate
    else:
        row["expenseRate"] = None
    if unit == "gold":
        purity = numeric(row.get("expenseGoldPurity"), "عیار هزینه", minimum=Decimal(1), maximum=Decimal(1000), default=750)
        row["expenseGoldPurity"] = decimal_output(purity)
        value *= purity / 750
    else:
        row["expenseGoldPurity"] = None
    if unit == "currency":
        row["expenseCurrency"] = row.get("expenseCurrency") or "USD"
        if row.get("expenseCurrency") not in CURRENCIES:
            raise HTTPException(422, "نوع ارز هزینه معتبر نیست.")
    else:
        row["expenseCurrency"] = None
    row.update(amount=decimal_output(value), itemSummary=row["description"])


def customer_for(data, identifier):
    matches = [customer for customer in data["customers"] if str(customer.get("id")) == str(identifier)]
    if len(matches) != 1:
        raise HTTPException(409, "طرف حساب سند پیدا نشد یا شناسهٔ آن تکراری است.")
    return matches[0]


def document_customer(data, row):
    if row.get("customerId") not in (None, ""):
        return customer_for(data, row["customerId"])
    name = str(row.get("customerName") or "").strip()
    matches = [customer for customer in data["customers"] if name and str(customer.get("name") or "").strip() == name]
    if len(matches) != 1:
        raise HTTPException(409, "نام طرف حساب سند قدیمی یکتا نیست؛ ابتدا ارتباط مشتری را بررسی کنید.")
    return matches[0]


def synchronize_customers(data, old_rows, new_rows):
    replacements = {str(row["id"]): row for row in new_rows}
    for old in old_rows:
        if old.get("type") == "expense":
            continue
        customer = document_customer(data, old)
        references = [(candidate, entry) for candidate in data["customers"] for entry in candidate.get("purchases", []) or []
            if isinstance(entry, dict) and str(entry.get("id")) == str(old["id"])]
        if len(references) != 1 or references[0][0] is not customer:
            raise HTTPException(409, "ارتباط سند با سابقهٔ مشتری ناقص یا مبهم است.")
        cached = references[0][1]
        updated = replacements.get(str(old["id"]))
        target = document_customer(data, updated) if updated else None
        sign = 1 if is_sale(old) else -1
        for field in ("gramDebt", "rialDebt"):
            balance = numeric(customer.get(field), "ماندهٔ مشتری", minimum=Decimal(-MAX_SAFE_INTEGER), maximum=Decimal(MAX_SAFE_INTEGER), default=0, status=409)
            before = numeric(old.get(field), "بدهی سند", default=0, status=409)
            customer[field] = decimal_output(balance - sign * before)
            if target is not None:
                after = numeric(updated.get(field), "بدهی سند", default=0)
                target_balance = numeric(target.get(field), "ماندهٔ مشتری", minimum=Decimal(-MAX_SAFE_INTEGER), maximum=Decimal(MAX_SAFE_INTEGER), default=0, status=409)
                target[field] = decimal_output(target_balance + sign * after)
        customer["updatedAt"] = iso_now()
        if target is not None:
            replacement = {**cached, "date": updated.get("date"), "detail": updated.get("itemSummary"),
                "amount": updated.get("amount"), "gold18Price": updated.get("gold18Price"),
                "gramDebt": updated.get("gramDebt", 0), "rialDebt": updated.get("rialDebt", 0)}
            for field in SETTLEMENT_FIELDS:
                if field in updated:
                    replacement[field] = updated[field]
            if target is customer:
                customer["purchases"] = [replacement if entry is cached else entry for entry in customer["purchases"]]
            else:
                customer["purchases"] = [entry for entry in customer["purchases"] if entry is not cached]
                target["purchases"] = [replacement, *(target.get("purchases") or [])]
            target["updatedAt"] = customer["updatedAt"]
        else:
            customer["purchases"] = [entry for entry in customer["purchases"] if entry is not cached]


def correct_documents(data, identifier, requested_rows, identity):
    result = deepcopy(data)
    old_rows = find_document_group(data["documents"], identifier)
    if any(row.get("type") != "expense" for row in old_rows) and not has_permission(identity, "customers.write"):
        raise HTTPException(403, "اصلاح این سند به اجازهٔ ویرایش مشتریان نیز نیاز دارد.")
    ids = {str(row["id"]) for row in old_rows}
    removing = requested_rows is None
    if removing:
        updated_rows = []
    else:
        if len(requested_rows) != len(ids) or {str(row.id) for row in requested_rows} != ids:
            raise HTTPException(409, "همهٔ ردیف‌های سند باید با هم اصلاح شوند.")
        changes_by_id = {str(row.id): row.changes for row in requested_rows}
        updated_rows = []
        repriced = set()
        for old in old_rows:
            changes = normalize_changes(old, changes_by_id[str(old["id"])])
            updated = {**old, **changes}
            if old.get("type") == "expense":
                normalize_expense(updated)
            else:
                target = document_customer(result, updated)
                if str(old.get("customerId")) != str(updated.get("customerId")):
                    updated["customerName"] = target.get("name")
                elif "customerName" in changes and changes["customerName"] not in {old.get("customerName"), target.get("name")}:
                    raise HTTPException(422, "نام طرف حساب را از بخش مشتریان اصلاح کنید.")
                validate_item(updated)
                numeric(updated.get("profitPercent"), "سود درصدی", maximum=Decimal(100), default=0)
                economic_fields = ECONOMIC_FIELDS[old["category"]] | RATE_FIELDS[old["category"]] | {"otherCosts", "profitPercent", "discountRial"}
                economic = any(field in economic_fields and values_differ(field, old.get(field), value) for field, value in changes.items())
                if economic:
                    repriced.add(str(old["id"]))
                    if updated.get("type") == "misc-purchase":
                        updated.update(normalize_misc_purchase(updated, result.get("prices", {})))
                    updated["amount"] = decimal_output(settlement_row_total(updated))
                    updated["currentAmount"] = decimal_output(max(Decimal(0), number(inventory_amount(updated, result.get("prices", {}))) - number(updated.get("discountRial"))))
                    updated["itemWeight"] = item_weight(updated)
                updated["itemSummary"] = item_summary(updated)
            updated_rows.append(updated)
        if any(row.get("type") != "expense" for row in updated_rows):
            headers = {(str(row.get("customerId")), row.get("customerName"), row.get("date")) for row in updated_rows}
            if len(headers) != 1:
                raise HTTPException(422, "تاریخ و طرف حساب تمام ردیف‌های سند باید یکسان باشد.")
        settlement = next((row for row in updated_rows if row.get("settlementVersion") == 1), None)
        old_settlement = next((row for row in old_rows if row.get("settlementVersion") == 1), None)
        payment_changed = settlement and any(number(settlement.get(field)) != number(old_settlement.get(field)) for field in ("cashPaid", "settlementGoldPrice"))
        if settlement and (repriced or payment_changed):
            with localcontext() as context:
                context.prec = 80
                total = Decimal(0)
                for row in updated_rows:
                    if str(row["id"]) in repriced:
                        row["amount"] = decimal_output(settlement_row_total(row).quantize(Decimal(1), rounding=ROUND_HALF_UP))
                    row["gold18Price"] = settlement["settlementGoldPrice"]
                    row["gramDebt"], row["rialDebt"] = 0, 0
                    total += number(row["amount"])
                cash = numeric(settlement.get("cashPaid"), "پرداخت نقدی", maximum=total)
                if cash != cash.to_integral_value():
                    raise HTTPException(422, "پرداخت نقدی باید تومان کامل باشد.")
                rate = numeric(settlement.get("settlementGoldPrice"), "نرخ تبدیل مانده", minimum=Decimal("0.00000001"))
                settlement.update(cashPaid=decimal_output(cash), settlementGoldPrice=decimal_output(rate),
                    settlementRemainder=decimal_output(total - cash),
                    gramDebt=decimal_output(((total - cash) / rate).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)))
        if any(row.get("invoiceVersion") == 1 for row in updated_rows):
            validate_group(updated_rows)
    replacements = {str(row["id"]): row for row in updated_rows}
    result["documents"] = [replacements.get(str(row["id"]), row) for row in result["documents"] if not removing or str(row["id"]) not in ids]
    guard_linked_inventory_changes(data["documents"], result["documents"])
    # Historical unlinked sales keep their historical status; linked rows must
    # share the source balance with every other sale, including sibling rows.
    guard_invoice_stock(result["documents"], [row for row in updated_rows if row.get("inventorySourceId")])
    synchronize_customers(result, old_rows, updated_rows)
    return result


def register_document_routes(application, workspace_response, encode_workspace):
    engine = application.state.engine

    def mutate(identifier, payload, identity, removing=False):
        if not has_permission(identity, "documents.write"):
            raise HTTPException(403, "اجازهٔ ویرایش اسناد ندارید.")
        account_id, actor_id = identity["user"]["account_id"], identity["user"]["id"]
        request_id = account_request_id(account_id, str(payload.requestId))
        body = payload.model_dump(mode="json", exclude={"revision", "requestId"})
        try:
            body_hash = digest(json.dumps({"action": "delete-document" if removing else "edit-document", "id": identifier, "body": body}, sort_keys=True, ensure_ascii=False, allow_nan=False))
        except ValueError:
            raise HTTPException(422, "مقدار عددی نامعتبر است.")

        def replay(connection):
            receipt = connection.execute(select(workspace_requests).where(workspace_requests.c.request_id == request_id, workspace_requests.c.account_id == account_id)).mappings().first()
            if receipt is None:
                return None
            if receipt["actor_id"] != actor_id or receipt["body_hash"] != body_hash:
                raise HTTPException(409, "شناسهٔ درخواست قبلاً برای تغییر دیگری استفاده شده است.")
            return workspace_response(read_workspace(connection, account_id), identity, connection)

        with engine.begin() as connection:
            previous = replay(connection)
            if previous is not None:
                return previous
            current = read_workspace(connection, account_id)
            if current["revision"] != payload.revision:
                previous = replay(connection)
                if previous is not None:
                    return previous
                raise HTTPException(409, "دفتر همزمان تغییر کرده است؛ ابتدا آخرین نسخه را بارگذاری کنید.")
            data = correct_documents(current["data"], identifier, None if removing else payload.rows, identity)
            if removing:
                maximum = max((number(row.get("invoiceNumber")) for row in current["data"]["documents"]), default=Decimal(0))
                if maximum > 0 and maximum <= MAX_SAFE_INTEGER and maximum == maximum.to_integral_value():
                    reserve_invoice_numbers(connection, int(maximum), 0, account_id)
            encoded = encode_workspace(data)
            revision = current["revision"] + 1
            saved = connection.execute(update(workspaces).where(workspaces.c.account_id == account_id, workspaces.c.revision == current["revision"]).values(data=encoded, revision=revision))
            if saved.rowcount != 1:
                previous = replay(connection)
                if previous is not None:
                    connection.rollback()
                    return previous
                raise HTTPException(409, "دفتر همزمان تغییر کرده است؛ ابتدا آخرین نسخه را بارگذاری کنید.")
            connection.execute(workspace_requests.insert().values(request_id=request_id, account_id=account_id,
                actor_id=actor_id, body_hash=body_hash, revision=revision, created_at=time.time()))
            return workspace_response({"revision": revision, "data": data}, identity, connection)

    @application.patch("/api/owner/documents/{identifier}")
    def patch_document(identifier: str, payload: DocumentChanges, identity=Depends(require_mutation)):
        return mutate(identifier, payload, identity)

    @application.delete("/api/owner/documents/{identifier}")
    def delete_document(identifier: str, payload: DocumentRevision, identity=Depends(require_mutation)):
        return mutate(identifier, payload, identity, removing=True)
