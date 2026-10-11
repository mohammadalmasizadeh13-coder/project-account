"""Supplier profiles, purchases, and two-unit debit/credit ledgers."""
from copy import deepcopy
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP, localcontext
import json
import secrets
import time
from typing import Any, Literal
from uuid import UUID, uuid4

from fastapi import Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import Column, Float, Integer, String, Table, select, update

from .account_profile import stamp_workspace_gallery
from .database import account_column, metadata, read_workspace, workspaces
from .inventory import (COIN_PHYSICAL_FIELDS, amount, coin_base, coin_fixed_profit, coin_rate_field,
    create_stock, decimal_output, find_source, guard_linked_inventory_changes, is_ordinary_coin,
    is_priced_coin, item_summary, numeric, quantity)
from .invoices import guard_invoice_stock, prepare_invoices, reserve_invoice_numbers, validate_group
from .pricing import iso_now, number
from .partner_trading import PartnerOperation, make_operation, OPERATION_TYPES
from .invoice_time import validate_invoice_time, ledger_clock
from .security import account_request_id, digest, get_user, has_permission, require_mutation


partner_requests = Table("noor_partner_requests", metadata,
    Column("request_id", String(64), primary_key=True), account_column(),
    Column("actor_id", String(64), nullable=False), Column("body_hash", String(64), nullable=False),
    Column("revision", Integer, nullable=False), Column("created_id", String(64), nullable=False),
    Column("created_at", Float, nullable=False))
MAX_BALANCE = Decimal("9007199254740991")


def coin_snapshot(document):
    if document.get("category") != "coin":
        return {}
    fields = (*COIN_PHYSICAL_FIELDS, "gramPrice", "coinPrice", "parsianPrice", "profitFixed")
    return {field: document[field] for field in fields if field in document}


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class PartnerProfile(StrictModel):
    name: str = Field(min_length=1, max_length=200)
    tradeType: Literal["wholesaler", "melted", "jeweler", "other"] = "other"
    phone: str = Field(default="", max_length=100)
    address: str = Field(default="", max_length=1000)
    note: str = Field(default="", max_length=5000)
    openingGoldBalance: float = Field(default=0, ge=-1e12, le=1e12)
    openingTomanBalance: float = Field(default=0, ge=-1e12, le=1e12)

    @field_validator("name", "phone", "address", "note")
    @classmethod
    def trim_text(cls, value):
        return value.strip()

    @field_validator("name")
    @classmethod
    def nonblank_name(cls, value):
        if not value:
            raise ValueError("نام همکار را وارد کنید.")
        return value


class LedgerEntry(StrictModel):
    id: str = Field(min_length=1, max_length=64)
    galleryName: str = Field(default="", max_length=120)
    type: Literal["purchase", "sale", "mixed", "settlement", "trade", "delivery", "offset"]
    direction: Literal["purchase", "sale"] | None = None
    date: str = Field(min_length=10, max_length=10)
    invoiceTime: str = Field(default="", exclude_if=lambda value: not value)
    _valid_invoice_time = field_validator("invoiceTime")(validate_invoice_time)
    createdAt: str = Field(min_length=1, max_length=60)
    goldDebit: float = Field(default=0, ge=0, le=float(MAX_BALANCE))
    goldCredit: float = Field(default=0, ge=0, le=float(MAX_BALANCE))
    tomanDebit: float = Field(default=0, ge=0, le=float(MAX_BALANCE))
    tomanCredit: float = Field(default=0, ge=0, le=float(MAX_BALANCE))
    goldBalance: float = Field(default=0, ge=-float(MAX_BALANCE), le=float(MAX_BALANCE))
    tomanBalance: float = Field(default=0, ge=-float(MAX_BALANCE), le=float(MAX_BALANCE))
    note: str = Field(default="", max_length=5000)
    reference: str = Field(default="", max_length=200)
    counterpartyName: str = Field(default="", max_length=200)
    paymentMethod: Literal["gold", "cash", "remittance"] = "gold"
    externalInvoiceNumber: str = Field(default="", max_length=200)
    invoiceNumber: int | None = Field(default=None, ge=1)
    transactionId: str | None = Field(default=None, max_length=64)
    documentIds: list[str] = Field(default_factory=list, max_length=100)
    lines: list[dict[str, Any]] = Field(default_factory=list, max_length=101)
    # Persisted v4 ledgers may remain after rolling back the invoice editor.
    # Preserve their independent gold and cash balances during reads and edits.
    settlementUnit: Literal["gold", "toman", "mixed"] | None = None
    gold18Price: float | None = Field(default=None, gt=0, le=1e12)
    linkedEntryId: str | None = Field(default=None, max_length=64)
    calculationVersion: Literal[1, 2, 3, 4, 5] = 1
    assetChanges: dict[str, float] = Field(default_factory=dict, exclude_if=lambda value: not value)
    assetBalances: dict[str, float] = Field(default_factory=dict, exclude_if=lambda value: not value)
    conversionGoldPrice: float | None = Field(default=None, gt=0, le=1e12)
    paidGold: float = Field(default=0, ge=0, le=1e12)
    paidToman: float = Field(default=0, ge=0, le=1e12)
    convertedPaidTomanGold: float = Field(default=0, ge=0, le=float(MAX_BALANCE))
    goldBalancePurchase: bool = Field(default=False, strict=True, exclude_if=lambda value: not value)

    @field_validator("date")
    @classmethod
    def valid_date(cls, value):
        date.fromisoformat(value)
        return value

    @field_validator("createdAt")
    @classmethod
    def valid_timestamp(cls, value):
        if datetime.fromisoformat(value.replace("Z", "+00:00")).tzinfo is None:
            raise ValueError("زمان ثبت دفتر معتبر نیست.")
        return value

    @model_validator(mode="after")
    def one_direction(self):
        if (self.type in OPERATION_TYPES) != (self.calculationVersion == 5):
            raise ValueError("نوع عملیات با نسخهٔ دفتر مطابقت ندارد.")
        if self.calculationVersion == 5:
            if not self.lines or self.settlementUnit != "mixed":
                raise ValueError("ردیف عملیات حساب معتبر نیست.")
            return self
        if self.assetChanges:
            raise ValueError("گردش دارایی فقط در عملیات حساب ثبت می‌شود.")
        if self.settlementUnit == "mixed" and self.calculationVersion != 4:
            raise ValueError("تسویهٔ ترکیبی مربوط به نسخهٔ چهارم محاسبات است.")
        if self.type == "mixed" and self.calculationVersion not in (3, 4):
            raise ValueError("سند ترکیبی باید با نسخهٔ سوم محاسبات ثبت شود.")
        if self.calculationVersion not in (3, 4) and (self.goldDebit and self.goldCredit or self.tomanDebit and self.tomanCredit):
            raise ValueError("ردیف دفتر نمی‌تواند همزمان بدهکار و بستانکار باشد.")
        if not any((self.goldDebit, self.goldCredit, self.tomanDebit, self.tomanCredit)):
            raise ValueError("مقدار ردیف دفتر باید بیشتر از صفر باشد.")
        return self


class PartnerRecord(PartnerProfile):
    id: str = Field(min_length=1, max_length=64)
    entries: list[LedgerEntry] = Field(default_factory=list, max_length=50000)
    goldBalance: float = Field(default=0, ge=-float(MAX_BALANCE), le=float(MAX_BALANCE))
    tomanBalance: float = Field(default=0, ge=-float(MAX_BALANCE), le=float(MAX_BALANCE))
    assetBalances: dict[str, float] = Field(default_factory=dict, exclude_if=lambda value: not value)
    createdAt: str = Field(default="", max_length=60)
    updatedAt: str = Field(default="", max_length=60)


class PartnerMutation(StrictModel):
    revision: int = Field(ge=0, strict=True)
    requestId: UUID


class PartnerCreate(PartnerMutation, PartnerProfile):
    pass


class PartnerPatch(PartnerMutation):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    tradeType: Literal["wholesaler", "melted", "jeweler", "other"] | None = None
    phone: str | None = Field(default=None, max_length=100)
    address: str | None = Field(default=None, max_length=1000)
    note: str | None = Field(default=None, max_length=5000)
    openingGoldBalance: float | None = Field(default=None, ge=-1e12, le=1e12)
    openingTomanBalance: float | None = Field(default=None, ge=-1e12, le=1e12)

    @field_validator("name", "phone", "address", "note")
    @classmethod
    def trim_patch(cls, value, info):
        if value is not None:
            value = value.strip()
            if info.field_name == "name" and not value:
                raise ValueError("نام همکار را وارد کنید.")
        return value

    @model_validator(mode="after")
    def nonempty_patch(self):
        changes = self.model_dump(exclude_unset=True, exclude={"revision", "requestId"})
        if not changes or any(value is None for value in changes.values()):
            raise ValueError("تغییر معتبر مشخص نشده است.")
        return self


class PartnerInvoice(PartnerMutation):
    direction: Literal["purchase", "sale"] = "purchase"
    date: str = Field(min_length=10, max_length=10)
    invoiceTime: str = Field(default="", exclude_if=lambda value: not value)
    _valid_invoice_time = field_validator("invoiceTime")(validate_invoice_time)
    externalInvoiceNumber: str = Field(default="", max_length=200)
    note: str = Field(default="", max_length=5000)
    gold18Price: Any
    settlementUnit: Literal["gold", "toman", "mixed"] = "gold"
    lines: list[dict[str, Any]] = Field(min_length=1, max_length=100)
    paidGold: Any = 0
    paidToman: Any = 0
    referenceName: str = Field(default="", max_length=200)
    refNumber: str = Field(default="", max_length=200)
    calculationVersion: Literal[1, 2, 3, 4] = 1
    # Omit the default so pre-upgrade request receipt hashes remain unchanged.
    goldBalancePurchase: bool = Field(default=False, strict=True, exclude_if=lambda value: not value)

    @field_validator("date")
    @classmethod
    def valid_date(cls, value):
        date.fromisoformat(value)
        return value

    @model_validator(mode="after")
    def gold_settlement_for_current_version(self):
        allowed = {1: {"gold", "toman"}, 2: {"gold"}, 3: {"gold"}, 4: {"mixed"}}
        if self.settlementUnit not in allowed[self.calculationVersion]:
            raise ValueError("واحد تسویه با روش محاسبهٔ سند مطابقت ندارد.")
        return self


class PartnerSettlement(PartnerMutation):
    date: str = Field(min_length=10, max_length=10)
    invoiceTime: str = Field(default="", exclude_if=lambda value: not value)
    _valid_invoice_time = field_validator("invoiceTime")(validate_invoice_time)
    direction: Literal["debit", "credit"] = "credit"
    goldAmount: Any = 0
    tomanAmount: Any = 0
    paymentMethod: Literal["gold", "cash", "remittance"]
    counterpartyName: str = Field(default="", max_length=200)
    reference: str = Field(default="", max_length=200)
    note: str = Field(default="", max_length=5000)

    @field_validator("date")
    @classmethod
    def valid_date(cls, value):
        date.fromisoformat(value)
        return value


def rounded_gold(value):
    with localcontext() as context:
        context.prec = 80
        return value.quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)


def recalculate_partner(partner):
    gold, toman = number(partner.get("openingGoldBalance")), number(partner.get("openingTomanBalance"))
    assets = {}
    chronological = sorted(enumerate(partner.get("entries", [])), key=lambda pair: (pair[1]["date"], ledger_clock(pair[1]), datetime.fromisoformat(pair[1]["createdAt"].replace("Z", "+00:00")), pair[0]))
    for _, entry in chronological:
        gold += number(entry.get("goldDebit")) - number(entry.get("goldCredit"))
        toman += number(entry.get("tomanDebit")) - number(entry.get("tomanCredit"))
        entry["goldBalance"], entry["tomanBalance"] = decimal_output(rounded_gold(gold)), decimal_output(toman)
        for key, value in entry.get("assetChanges", {}).items():
            if not key.startswith(("coin:", "currency:")) or len(key) > 300 or abs(number(value)) > MAX_BALANCE:
                raise ValueError("گردش دارایی معتبر نیست.")
            assets[key] = assets.get(key, Decimal(0)) + number(value)
            if abs(assets[key]) > MAX_BALANCE:
                raise ValueError("ماندهٔ دارایی بیش از حد مجاز است.")
        if assets:
            entry["assetBalances"] = {key: decimal_output(value) for key, value in assets.items()}
        else:
            entry.pop("assetBalances", None)
    partner["goldBalance"], partner["tomanBalance"] = decimal_output(rounded_gold(gold)), decimal_output(toman)
    if assets:
        partner["assetBalances"] = {key: decimal_output(value) for key, value in assets.items()}
    else:
        partner.pop("assetBalances", None)
    return partner


def validate_partner_records(partners):
    identifiers = set()
    for partner in partners:
        identifier = partner["id"]
        if identifier in identifiers:
            raise ValueError("شناسهٔ همکار تکراری است.")
        identifiers.add(identifier)
        entry_ids = {entry["id"] for entry in partner.get("entries", [])}
        if len(entry_ids) != len(partner.get("entries", [])):
            raise ValueError("شناسهٔ گردش دفتر تکراری است.")
        recalculated = recalculate_partner(deepcopy(partner))
        if partner.get("assetBalances", {}) != recalculated.get("assetBalances", {}):
            raise ValueError("ماندهٔ دارایی همکار با گردش‌ها مطابقت ندارد.")
        if abs(number(partner.get("goldBalance")) - number(recalculated["goldBalance"])) > Decimal("0.000001") or number(partner.get("tomanBalance")) != number(recalculated["tomanBalance"]):
            raise ValueError("ماندهٔ دفتر همکار با گردش‌ها مطابقت ندارد.")
        for entry, expected in zip(partner.get("entries", []), recalculated.get("entries", [])):
            if entry.get("assetBalances", {}) != expected.get("assetBalances", {}):
                raise ValueError("ماندهٔ دارایی ردیف با گردش‌ها مطابقت ندارد.")
            if abs(number(entry["goldBalance"]) - number(expected["goldBalance"])) > Decimal("0.000001") or number(entry["tomanBalance"]) != number(expected["tomanBalance"]):
                raise ValueError("ماندهٔ ردیف دفتر همکار با گردش‌ها مطابقت ندارد.")
    return partners


def canonical_partner_records(partners, *, validate_balances=False):
    records = [PartnerRecord.model_validate(partner).model_dump() for partner in partners]
    return validate_partner_records(records) if validate_balances else records


def guard_partner_documents(previous, incoming, *, allow_stock_text=False):
    def protected(row):
        return (row.get("partnerId") or row.get("counterpartyType") == "partner"
            or row.get("source") == "partner-invoice" or "goldBalancePurchase" in row)

    old_rows = {str(row["id"]): row for row in previous if protected(row)}
    new_rows = {str(row["id"]): row for row in incoming}
    allowed = {"itemName", "description", "note", "itemSummary"} if allow_stock_text else set()
    for identifier, old in old_rows.items():
        updated = new_rows.get(identifier)
        if updated is None or {key: value for key, value in old.items() if key not in allowed} != {key: value for key, value in updated.items() if key not in allowed}:
            raise HTTPException(409, "فاکتور ثبت‌شده در دفتر همکار از این بخش قابل تغییر یا حذف نیست.")
    for row in incoming:
        if str(row["id"]) not in old_rows and protected(row):
            raise HTTPException(409, "خرید همکار باید از بخش فاکتور همکار ثبت شود.")


def find_partner(data, identifier):
    found = next((partner for partner in data["partners"] if partner["id"] == identifier), None)
    if found is None:
        raise HTTPException(404, "همکار پیدا نشد.")
    return found


def entry_base(payload, **values):
    return {"id": secrets.token_hex(16), "date": payload.date, "createdAt": iso_now(),
        **({"invoiceTime": payload.invoiceTime} if payload.invoiceTime else {}),
        "goldDebit": 0, "goldCredit": 0, "tomanDebit": 0, "tomanCredit": 0,
        "goldBalance": 0, "tomanBalance": 0, "note": payload.note, "reference": "", "counterpartyName": "",
        "paymentMethod": "gold", **values}


def mark_gold_balance_purchase(payload, documents, existing_entry=None):
    was_marked = bool(existing_entry and existing_entry.get("goldBalancePurchase"))
    marked = payload.goldBalancePurchase or was_marked
    purchases = [row for row in documents if row["category"] == "melted" and row["type"] == "melted-purchase"]
    if marked and not was_marked and not purchases:
        raise HTTPException(422, "خرید برای تراز طلا باید حداقل یک ردیف خرید آب‌شده داشته باشد.")
    if marked:
        for document in purchases:
            document["goldBalancePurchase"] = True
    return {"goldBalancePurchase": True} if marked else {}


def make_supplier_invoice(data, partner, payload, identity, connection, *, existing_entry=None, previous_documents=None):
    if payload.calculationVersion >= 3:
        return make_mixed_partner_invoice(data, partner, payload, identity, connection,
            existing_entry=existing_entry, previous_documents=previous_documents)
    selling = payload.direction == "sale"
    gold_invoice = payload.calculationVersion == 2
    rate = numeric(payload.gold18Price, "نرخ طلای ۷۵۰", minimum=Decimal("0.00000001"))
    paid_gold = numeric(payload.paidGold, "پرداخت طلا", maximum=Decimal("1e12"))
    if paid_gold and not rounded_gold(paid_gold):
        raise HTTPException(422, "مقدار پرداخت طلا کمتر از دقت مجاز دفتر است.")
    paid_gold = rounded_gold(paid_gold)
    paid_toman = numeric(payload.paidToman, "پرداخت تومان", maximum=Decimal("1e12"))
    transaction = existing_entry["transactionId"] if existing_entry else str(uuid4())
    created_at = existing_entry["createdAt"] if existing_entry else iso_now()
    old_documents = {row["id"]: row for row in previous_documents or [] if existing_entry and row["id"] in existing_entry["documentIds"]}
    used_document_ids = set()
    linked_payments = [row for row in partner["entries"] if existing_entry and row.get("linkedEntryId") == existing_entry["id"]]
    if len(linked_payments) > 1:
        raise HTTPException(422, "این فاکتور چند گردش تسویهٔ متصل دارد و نیازمند بررسی دفتر است.")
    existing_payment = linked_payments[0] if linked_payments else None
    documents, details, gold_total, toman_total = [], [], Decimal(0), Decimal(0)
    draft = {**data, "documents": list(data["documents"])}
    for position, original in enumerate(payload.lines):
        line = dict(original)
        document_id = line.pop("documentId", None)
        old_document = None
        if document_id is not None:
            if not isinstance(document_id, str) or document_id not in old_documents or document_id in used_document_ids:
                raise HTTPException(422, "شناسهٔ ردیف ویرایش‌شده معتبر نیست.")
            old_document = old_documents[document_id]
            if old_document["category"] != line.get("category"):
                raise HTTPException(422, "برای تغییر نوع کالا، ردیف قبلی را حذف و ردیف تازه اضافه کنید.")
            used_document_ids.add(document_id)
        if line.pop("direction", payload.direction) != payload.direction:
            raise HTTPException(422, "جهت تمام ردیف‌های این فاکتور باید یکسان باشد.")
        source_id = line.pop("inventorySourceId", None)
        source = None
        if selling:
            source = find_source(data, str(source_id or ""))
            if source["category"] not in {"crafted", "coin"} or source["category"] != line.get("category"):
                raise HTTPException(422, "نوع کالای فروش همکار با موجودی ساخته یا سکه مطابقت ندارد.")
            # Use stock values only for omitted inputs; preserve the invoice snapshot.
            for field in ("itemName", "craftedKind", "weight", "ayar", *COIN_PHYSICAL_FIELDS):
                if field in source:
                    line.setdefault(field, source[field])
            line.setdefault("weightMode", "unit")
        elif source_id:
            raise HTTPException(422, "خرید همکار نباید به موجودی فروش متصل باشد.")
        weight_mode = line.pop("weightMode", "total")
        if not isinstance(weight_mode, str) or weight_mode not in {"total", "unit"}:
            raise HTTPException(422, "روش ثبت وزن معتبر نیست.")
        category = line.get("category")
        if not isinstance(category, str) or category not in {"crafted", "melted", "coin", "currency"}:
            raise HTTPException(422, "نوع کالای فاکتور معتبر نیست.")
        if category == "crafted":
            line.setdefault("craftedKind", "سایر")
            line.setdefault("ayar", 750)
            line.setdefault("gramPrice", decimal_output(rate))
        elif category == "melted":
            line.setdefault("meltedAyar", 750)
            line.setdefault("meltedGramPrice", decimal_output(rate))
        elif is_ordinary_coin(line):
            line.setdefault("gramPrice", decimal_output(rate))
        if gold_invoice:
            profit_percent = numeric(line.get("profitPercent"), "سود خرید همکار", maximum=Decimal(100), default=7 if category == "crafted" else 0)
            line["profitPercent"] = format(profit_percent, "f")
            if category in {"crafted", "melted"}:
                # A purchase and its gold conversion must use one frozen rate.
                line["gramPrice" if category == "crafted" else "meltedGramPrice"] = decimal_output(rate)
            elif is_ordinary_coin(line):
                line.setdefault("gramPrice", decimal_output(rate))
        else:
            if not is_priced_coin(line) and numeric(line.get("profitPercent"), "سود خرید همکار", default=0) != 0:
                raise HTTPException(422, "خرید از همکار بدون سود فروش ثبت می‌شود.")
            if not is_priced_coin(line):
                line["profitPercent"] = 0
        scale_weight = None
        with localcontext() as context:
            context.prec = 80
            if category in {"crafted", "melted"}:
                field = "weight" if category == "crafted" else "meltedWeight"
                physical = numeric(line.get(field), "وزن فاکتور", minimum=Decimal("0.000001"), maximum=Decimal("100000"))
                count = quantity(line)
                scale_weight = physical if weight_mode == "total" else physical * count
                line[field] = format(physical / count if weight_mode == "total" else physical, "f")
            created, identifier = create_stock(draft, line, identity)
            document = created["documents"][0]
            document.update(id=document_id or f"document-partner-{uuid4()}", source="partner-invoice", entryMethod="supplier-invoice",
                type=f"{category}-{'sale' if selling else 'purchase'}", typeLabel="فروش به همکار" if selling else "خرید از همکار", direction="فروش" if selling else "خرید", customerId=partner["id"],
                customerName=partner["name"], counterpartyType="partner", partnerId=partner["id"],
                externalInvoiceNumber=payload.externalInvoiceNumber, date=payload.date, invoiceTime=payload.invoiceTime, createdAt=created_at, recordedAt=created_at,
                invoiceVersion=1, invoiceLine=position + 1, invoiceLineCount=len(payload.lines), transactionId=transaction,
                gold18Price=decimal_output(rate))
            if old_document is not None:
                document.update({field: old_document[field] for field in ("createdAt", "recordedAt") if field in old_document})
            if source is not None:
                document.update(inventorySourceId=source["id"], productCode=source["productCode"])
            elif old_document is not None and old_document["type"].endswith("-purchase"):
                document["productCode"] = old_document["productCode"]
            line_value = number(document["amount"])
            snapshot = {}
            if category in {"crafted", "melted"}:
                purity = number(document["ayar" if category == "crafted" else "meltedAyar"])
                equivalent = scale_weight * purity / 750
                labor = equivalent * number(document.get("wagePercent")) / 100
                extras = quantity(document) * (number(document.get("wageFixed")) + number(document.get("otherCosts")))
                line_gold = equivalent + labor if payload.settlementUnit == "gold" else Decimal(0)
                line_toman = extras if payload.settlementUnit == "gold" else line_value
                document.update(scaleWeight=decimal_output(scale_weight), weightMode=weight_mode,
                    weight750=decimal_output(equivalent / quantity(document)), totalWeight750=decimal_output(equivalent), laborGold=decimal_output(labor))
            else:
                equivalent, labor, line_gold, line_toman = Decimal(0), Decimal(0), Decimal(0), line_value
                if is_ordinary_coin(document):
                    scale_weight = quantity(document) * number(document["coinWeight"])
                    equivalent = scale_weight * number(document["coinAyar"]) / 750
                    document.update(scaleWeight=decimal_output(scale_weight), totalWeight750=decimal_output(equivalent))
            if gold_invoice:
                count = quantity(document)
                if category in {"crafted", "melted"}:
                    principal = equivalent
                else:
                    price_field = "currencyRate" if category == "currency" else coin_rate_field(document)[0]
                    principal = (coin_base(document, number(document[price_field])) if category == "coin" else count * number(document[price_field])) / rate
                    labor = Decimal(0) if category == "currency" else principal * number(document.get("wagePercent")) / 100
                fixed_labor = count * number(document.get("wageFixed")) / rate
                other_costs = count * number(document.get("otherCosts")) / rate
                profit = (principal + labor + fixed_labor + other_costs) * profit_percent / 100 + coin_fixed_profit(document) / rate
                line_gold, line_toman = principal + labor + fixed_labor + other_costs + profit, Decimal(0)
                snapshot = {"calculationVersion": 2, "conversionGoldPrice": decimal_output(rate),
                    "principalGold": decimal_output(principal), "laborGold": decimal_output(labor),
                    "fixedLaborGold": decimal_output(fixed_labor), "otherCostsGold": decimal_output(other_costs),
                    "profitGold": decimal_output(profit), "profitPercent": decimal_output(profit_percent)}
                document.update({key: value for key, value in snapshot.items() if key != "profitPercent"})
                # Keep the unrounded historical cost; gold ledger rounds only after summing lines.
                document["amount"] = decimal_output(line_gold * rate)
            gold_total += line_gold
            toman_total += line_toman
            document["partnerGoldCredit" if selling else "partnerGoldDebit"] = decimal_output(rounded_gold(line_gold))
            document["itemSummary"] = item_summary(document)
            documents.append(document)
            details.append({**{key: value for key, value in original.items() if category != "coin" or key not in COIN_PHYSICAL_FIELDS}, **coin_snapshot(document), **({"weightMode": "unit", **{field: document[field] for field in ("itemName", "weight", "ayar", "craftedKind", "coinType", "parsianWeight") if field in document}} if selling else {}), "documentId": document["id"], "productCode": document["productCode"],
                "scaleWeight": decimal_output(scale_weight) if scale_weight is not None else 0,
                "weight750": decimal_output(equivalent), "laborGold": decimal_output(labor),
                "goldDebit": decimal_output(rounded_gold(line_gold)), "tomanDebit": decimal_output(line_toman), "amount": document["amount"], **snapshot})
            draft["documents"] = [document, *draft["documents"]]
    gold_total = rounded_gold(gold_total)
    if gold_total <= 0 and toman_total <= 0:
        raise HTTPException(422, "مقدار فاکتور کمتر از دقت مجاز دفتر است.")
    documents[0]["gramDebt"] = decimal_output(gold_total)
    documents[0]["rialDebt"] = decimal_output(toman_total)
    if selling:
        try:
            guard_invoice_stock([*documents, *data["documents"]], documents)
        except HTTPException as error:
            # A rejected stock choice has not committed. Let the editor correct
            # it, while workspace revision conflicts still use safe replay.
            raise HTTPException(422, error.detail) from error
    balance_purchase = mark_gold_balance_purchase(payload, documents, existing_entry)
    if existing_entry:
        for document in documents:
            document["invoiceNumber"] = existing_entry["invoiceNumber"]
        validate_group(documents)
        incoming = [*documents, *data["documents"]]
        try:
            guard_linked_inventory_changes(previous_documents, incoming)
            downstream = [row for row in data["documents"] if str(row.get("inventorySourceId", "")) in old_documents]
            guard_invoice_stock(incoming, [*documents, *downstream])
        except HTTPException as error:
            raise HTTPException(422, error.detail) from error
    else:
        incoming = prepare_invoices(data["documents"], [*documents, *data["documents"]], connection, account_id=identity["user"]["account_id"])
    data["documents"] = incoming
    entry = entry_base(payload, type="sale" if selling else "purchase", externalInvoiceNumber=payload.externalInvoiceNumber,
        invoiceNumber=incoming[0]["invoiceNumber"], transactionId=transaction, documentIds=[row["id"] for row in documents],
        lines=details, settlementUnit=payload.settlementUnit, gold18Price=decimal_output(rate),
        **{"goldCredit" if selling else "goldDebit": decimal_output(gold_total), "tomanCredit" if selling else "tomanDebit": decimal_output(toman_total)},
        **({"calculationVersion": 2, "conversionGoldPrice": decimal_output(rate)} if gold_invoice else {}), **balance_purchase)
    if existing_entry:
        entry.update(id=existing_entry["id"], createdAt=created_at)
        position = next(index for index, row in enumerate(partner["entries"]) if row["id"] == existing_entry["id"])
        partner["entries"][position] = entry
    else:
        partner["entries"].append(entry)
    if paid_gold or paid_toman:
        with localcontext() as context:
            context.prec = 80
            converted_cash = paid_toman / rate if gold_invoice else Decimal(0)
            gold_credit = rounded_gold(paid_gold + converted_cash)
        if gold_invoice and not gold_credit:
            raise HTTPException(422, "مقدار پرداخت کمتر از دقت مجاز دفتر است.")
        payment_entry = entry_base(payload, type="settlement",
            **{"goldDebit" if selling else "goldCredit": decimal_output(gold_credit), "tomanDebit" if selling else "tomanCredit": 0 if gold_invoice else decimal_output(paid_toman)}, counterpartyName=payload.referenceName,
            reference=payload.refNumber, paymentMethod="remittance" if payload.referenceName or payload.refNumber else "cash" if paid_toman else "gold",
            linkedEntryId=entry["id"], **({"calculationVersion": 2, "settlementUnit": "gold", "gold18Price": decimal_output(rate),
                "conversionGoldPrice": decimal_output(rate), "paidGold": decimal_output(paid_gold), "paidToman": decimal_output(paid_toman),
                "convertedPaidTomanGold": decimal_output(converted_cash)} if gold_invoice else {}))
        if existing_payment:
            payment_entry.update({key: existing_payment[key] for key in ("id", "createdAt", "invoiceNumber", "transactionId") if key in existing_payment})
            position = next(index for index, row in enumerate(partner["entries"]) if row["id"] == existing_payment["id"])
            partner["entries"][position] = payment_entry
        else:
            partner["entries"].append(payment_entry)
    elif existing_payment:
        partner["entries"] = [row for row in partner["entries"] if row["id"] != existing_payment["id"]]
    return entry["id"]


def make_mixed_partner_invoice(data, partner, payload, identity, connection, *, existing_entry=None, previous_documents=None):
    """Freeze each row's direction and prices in one atomic partner posting."""
    dual = payload.calculationVersion == 4
    rate = numeric(payload.gold18Price, "نرخ طلای ۷۵۰", minimum=Decimal("0.00000001"))
    paid_gold = numeric(payload.paidGold, "پرداخت طلا")
    paid_toman = numeric(payload.paidToman, "پرداخت تومان")
    if paid_gold and not rounded_gold(paid_gold):
        raise HTTPException(422, "مقدار پرداخت طلا کمتر از دقت مجاز دفتر است.")
    paid_gold = rounded_gold(paid_gold)
    transaction = existing_entry["transactionId"] if existing_entry else str(uuid4())
    created_at = existing_entry["createdAt"] if existing_entry else iso_now()
    old_documents = {row["id"]: row for row in previous_documents or [] if existing_entry and row["id"] in existing_entry["documentIds"]}
    used_document_ids = set()
    documents, details, directions = [], [], set()
    totals = {key: Decimal(0) for key in ("goldDebit", "goldCredit", "tomanDebit", "tomanCredit")}
    draft = {**data, "documents": list(data["documents"])}
    physical_fields = ("itemName", "craftedKind", "weight", "ayar", *COIN_PHYSICAL_FIELDS,
        "meltedWeight", "meltedAyar", "assayCode", "laboratoryName", "currencyType")
    with localcontext() as context:
        context.prec = 80
        for original in payload.lines:
            line = dict(original)
            category = line.get("category")
            if not isinstance(category, str) or category not in {"crafted", "melted", "coin", "currency", "remittance"}:
                raise HTTPException(422, "نوع کالای فاکتور معتبر نیست.")
            unit = line.pop("settlementUnit", "gold" if category in {"crafted", "melted", "remittance"} or is_ordinary_coin(line) else "toman") if dual else "gold"
            if not isinstance(unit, str) or unit not in {"gold", "toman"} or (dual and unit == "gold" and (category == "currency" or category == "coin" and not is_ordinary_coin(line))):
                raise HTTPException(422, "واحد حساب ردیف معتبر نیست.")
            inventory_mode = line.pop("inventoryMode", "stock") if dual else "stock"
            ledger_only = dual and category == "melted" and inventory_mode == "ledger"
            if not isinstance(inventory_mode, str) or inventory_mode not in {"stock", "ledger"} or inventory_mode == "ledger" and not ledger_only:
                raise HTTPException(422, "روش ثبت موجودی معتبر نیست.")
            if category == "remittance":
                allowed = ({"tomanAmount"} if dual else set()) | {"category", "remittanceDirection", "goldAmount", "counterpartyName", "reference", "note"}
                direction = line.get("remittanceDirection")
                if set(line) - allowed or not isinstance(direction, str) or direction not in {"debit", "credit"}:
                    raise HTTPException(422, "مشخصات یا جهت حوالهٔ ردیف معتبر نیست.")
                remittance = rounded_gold(numeric(line.get("tomanAmount" if unit == "toman" else "goldAmount"), "وزن حواله", minimum=Decimal("0.000001")))
                for field, limit in (("counterpartyName", 200), ("reference", 200), ("note", 5000)):
                    value = line.get(field, "")
                    if not isinstance(value, str) or len(value) > limit:
                        raise HTTPException(422, "متن حواله معتبر نیست.")
                    line[field] = value.strip()
                amounts = {"goldDebit": 0, "goldCredit": 0, "tomanDebit": 0, "tomanCredit": 0}
                field = ("toman" if unit == "toman" else "gold") + ("Credit" if direction == "credit" else "Debit")
                amounts[field] = decimal_output(remittance)
                totals[field] += remittance
                details.append({**line, **({"settlementUnit": unit} if dual else {}), "tomanAmount" if unit == "toman" else "goldAmount": decimal_output(remittance), **amounts,
                    "amount": decimal_output(remittance if unit == "toman" else remittance * rate), "calculationVersion": payload.calculationVersion,
                    "conversionGoldPrice": decimal_output(rate)})
                directions.add("remittance")
                continue
            if not isinstance(category, str) or category not in {"crafted", "melted", "coin", "currency"}:
                raise HTTPException(422, "نوع کالای فاکتور معتبر نیست.")
            document_id = line.pop("documentId", None)
            old_document = None
            if document_id is not None:
                if not isinstance(document_id, str) or document_id not in old_documents or document_id in used_document_ids:
                    raise HTTPException(422, "شناسهٔ ردیف ویرایش‌شده معتبر نیست.")
                old_document = old_documents[document_id]
                if old_document["category"] != category:
                    raise HTTPException(422, "برای تغییر نوع کالا، ردیف قبلی را حذف و ردیف تازه اضافه کنید.")
                used_document_ids.add(document_id)
            direction = line.pop("direction", payload.direction)
            if not isinstance(direction, str) or direction not in {"purchase", "sale"}:
                raise HTTPException(422, "جهت معاملهٔ ردیف معتبر نیست.")
            directions.add(direction)
            source_id = line.pop("inventorySourceId", None)
            source = None
            if ledger_only and source_id:
                raise HTTPException(422, "سند حسابی نباید به موجودی متصل باشد.")
            if direction == "sale" and not ledger_only:
                source = find_source(data, str(source_id or ""))
                if source["category"] != category:
                    raise HTTPException(422, "نوع کالای فروش با موجودی انتخاب‌شده مطابقت ندارد.")
                for field in physical_fields:
                    if field in source:
                        line.setdefault(field, source[field])
                line.setdefault("weightMode", "unit")
            elif source_id:
                raise HTTPException(422, "خرید همکار نباید به موجودی فروش متصل باشد.")
            weight_mode = line.pop("weightMode", "total")
            if not isinstance(weight_mode, str) or weight_mode not in {"total", "unit"}:
                raise HTTPException(422, "روش ثبت وزن معتبر نیست.")
            fee = line.pop("meltedFee", None)
            if category == "crafted":
                line.setdefault("craftedKind", "سایر")
                line.setdefault("ayar", 750)
                line["gramPrice"] = format(rate, "f")
            elif category == "melted":
                fee = numeric(fee, "فی آب‌شده", minimum=Decimal("0.00000001"))
                line.setdefault("meltedAyar", 750)
                line["meltedGramPrice"] = format(fee / Decimal("4.3318"), "f")
            elif fee is not None:
                raise HTTPException(422, "فی آب‌شده فقط برای ردیف آب‌شده معتبر است.")
            if is_ordinary_coin(line):
                line.setdefault("gramPrice", format(rate, "f"))
            profit_percent = numeric(line.get("profitPercent"), "سود همکار", maximum=Decimal(100), default=7 if category == "crafted" else 0)
            line["profitPercent"] = format(profit_percent, "f")
            scale_weight = Decimal(0)
            if category in {"crafted", "melted"}:
                field = "weight" if category == "crafted" else "meltedWeight"
                physical = numeric(line.get(field), "وزن فاکتور", minimum=Decimal("0.000001"), maximum=Decimal("100000"))
                count = quantity(line)
                scale_weight = physical if weight_mode == "total" else physical * count
                line[field] = format(physical / count if weight_mode == "total" else physical, "f")
            fixed_profit = numeric(line.get("profitFixed"), "سود ثابت", default=0) if dual else Decimal(0)
            stock_line = {key: value for key, value in line.items() if not (dual and category != "coin" and key == "profitFixed")}
            created, _ = create_stock(draft, stock_line, identity, require_assay=not ledger_only)
            document = created["documents"][0]
            count = quantity(document)
            equivalent = Decimal(0)
            if category in {"crafted", "melted"}:
                purity = number(document["ayar" if category == "crafted" else "meltedAyar"])
                equivalent = scale_weight * purity / 750
                principal = equivalent if category == "crafted" else equivalent * fee / Decimal("4.3318") / rate
                document.update(scaleWeight=decimal_output(scale_weight), weightMode=weight_mode,
                    weight750=decimal_output(equivalent / count), totalWeight750=decimal_output(equivalent))
            else:
                price_field = "currencyRate" if category == "currency" else coin_rate_field(document)[0]
                principal = (coin_base(document, number(document[price_field])) if category == "coin" else count * number(document[price_field])) / rate
                if is_ordinary_coin(document):
                    scale_weight = count * number(document["coinWeight"])
                    equivalent = scale_weight * number(document["coinAyar"]) / 750
                    document.update(scaleWeight=decimal_output(scale_weight), totalWeight750=decimal_output(equivalent))
            labor = Decimal(0) if category == "currency" else principal * number(document.get("wagePercent")) / 100
            fixed_labor = Decimal(0) if category == "currency" else count * number(document.get("wageFixed")) / rate
            other_costs = count * number(document.get("otherCosts")) / rate
            profit = (principal + labor + fixed_labor + other_costs) * profit_percent / 100 + coin_fixed_profit(document) / rate
            line_gold = principal + labor + fixed_labor + other_costs + profit
            if not dual and not rounded_gold(line_gold):
                raise HTTPException(422, "مقدار ردیف کمتر از دقت مجاز دفتر است.")
            line_toman = Decimal(0)
            if dual:
                cash_principal = Decimal(0) if unit == "gold" else principal * rate
                principal = equivalent if unit == "gold" else Decimal(0)
                labor = principal * number(document.get("wagePercent")) / 100
                cash_labor = cash_principal * number(document.get("wagePercent")) / 100 if category != "currency" else Decimal(0)
                cash_costs = count * (number(document.get("wageFixed")) + number(document.get("otherCosts")))
                profit = (principal + labor) * profit_percent / 100
                line_gold = principal + labor + profit
                line_toman = (cash_principal + cash_labor + cash_costs) * (1 + profit_percent / 100) + count * fixed_profit
                fixed_labor = other_costs = Decimal(0)
                if not rounded_gold(line_gold) and not rounded_gold(line_toman):
                    raise HTTPException(422, "مقدار ردیف کمتر از دقت مجاز دفتر است.")
                document.update(settlementUnit=unit, goldTotal=decimal_output(line_gold), tomanTotal=decimal_output(line_toman), profitFixed=decimal_output(fixed_profit))
                if ledger_only:
                    document["inventoryMode"] = "ledger"
                    document.pop("productCode", None)
            snapshot = {"calculationVersion": payload.calculationVersion, "conversionGoldPrice": decimal_output(rate),
                "principalGold": decimal_output(principal), "laborGold": decimal_output(labor),
                "fixedLaborGold": decimal_output(fixed_labor), "otherCostsGold": decimal_output(other_costs),
                "profitGold": decimal_output(profit), "profitPercent": decimal_output(profit_percent)}
            if category == "melted":
                snapshot.update(meltedFee=decimal_output(fee), meltedGramPrice=document["meltedGramPrice"])
            document.update(id=document_id or f"document-partner-{uuid4()}", source="partner-invoice", entryMethod="supplier-invoice",
                type=f"{category}-{direction}", typeLabel="فروش به همکار" if direction == "sale" else "خرید از همکار",
                direction="فروش" if direction == "sale" else "خرید", customerId=partner["id"], customerName=partner["name"],
                counterpartyType="partner", partnerId=partner["id"], externalInvoiceNumber=payload.externalInvoiceNumber,
                date=payload.date, invoiceTime=payload.invoiceTime, createdAt=created_at, recordedAt=created_at, invoiceVersion=1,
                invoiceLine=len(documents) + 1, transactionId=transaction, gold18Price=decimal_output(rate),
                amount=decimal_output(line_gold * rate + line_toman), **{key: value for key, value in snapshot.items() if key != "profitPercent"})
            if old_document is not None:
                document.update({field: old_document[field] for field in ("createdAt", "recordedAt") if field in old_document})
            if source is not None:
                document.update(inventorySourceId=source["id"], productCode=source["productCode"])
            elif not ledger_only and old_document is not None and old_document["type"].endswith("-purchase"):
                document["productCode"] = old_document["productCode"]
            amounts = {"goldDebit": 0, "goldCredit": 0, "tomanDebit": 0, "tomanCredit": 0}
            field = "goldCredit" if direction == "sale" else "goldDebit"
            amounts[field] = decimal_output(rounded_gold(line_gold))
            totals[field] += line_gold
            cash_field = "tomanCredit" if direction == "sale" else "tomanDebit"
            amounts[cash_field] = decimal_output(rounded_gold(line_toman))
            totals[cash_field] += line_toman
            document["partnerTomanCredit" if direction == "sale" else "partnerTomanDebit"] = amounts[cash_field]
            document["partnerGoldCredit" if direction == "sale" else "partnerGoldDebit"] = amounts[field]
            document["itemSummary"] = item_summary(document)
            documents.append(document)
            # Persist authoritative physical fields and derived prices, never client snapshots.
            details.append({**line, **({"settlementUnit": unit, "goldTotal": decimal_output(line_gold), "tomanTotal": decimal_output(line_toman), "profitFixed": decimal_output(fixed_profit), **({"inventoryMode": "ledger"} if ledger_only else {})} if dual else {}), **coin_snapshot(document), **{field: document[field] for field in physical_fields if field in document},
                **({"inventorySourceId": source["id"]} if source else {}), "direction": direction,
                "weightMode": weight_mode, "documentId": document["id"], **({"productCode": document["productCode"]} if "productCode" in document else {}),
                "scaleWeight": decimal_output(scale_weight), "weight750": decimal_output(equivalent),
                **amounts, "amount": document["amount"], **snapshot})
            draft["documents"] = [document, *draft["documents"]]
        converted_cash = Decimal(0) if dual else paid_toman / rate
        payment = rounded_gold(paid_gold + converted_cash)
        if (paid_gold or paid_toman and not dual) and not payment:
            raise HTTPException(422, "مقدار پرداخت کمتر از دقت مجاز دفتر است.")
        totals["goldDebit" if payload.direction == "sale" else "goldCredit"] += payment
        if dual:
            totals["tomanDebit" if payload.direction == "sale" else "tomanCredit"] += paid_toman
        totals = {field: decimal_output(rounded_gold(value)) for field, value in totals.items()}
    balance_purchase = mark_gold_balance_purchase(payload, documents, existing_entry)
    if documents:
        for document in documents:
            document["invoiceLineCount"] = len(documents)
        try:
            guard_invoice_stock([*documents, *data["documents"]], documents)
        except HTTPException as error:
            raise HTTPException(422, error.detail) from error
        if existing_entry:
            invoice_number = existing_entry["invoiceNumber"]
            for document in documents:
                document["invoiceNumber"] = invoice_number
            validate_group(documents)
            incoming = [*documents, *data["documents"]]
            try:
                guard_linked_inventory_changes(previous_documents, incoming)
                # Revalidate only downstream sales of edited lots; unrelated legacy
                # sales may predate mandatory inventory source references.
                downstream = [row for row in data["documents"] if str(row.get("inventorySourceId", "")) in old_documents]
                guard_invoice_stock(incoming, [*documents, *downstream])
            except HTTPException as error:
                raise HTTPException(422, error.detail) from error
        else:
            incoming = prepare_invoices(data["documents"], [*documents, *data["documents"]], connection, account_id=identity["user"]["account_id"])
            invoice_number = incoming[0]["invoiceNumber"]
        data["documents"] = incoming
    else:
        if existing_entry:
            try:
                guard_linked_inventory_changes(previous_documents, data["documents"])
            except HTTPException as error:
                raise HTTPException(422, error.detail) from error
            invoice_number = existing_entry["invoiceNumber"]
        else:
            previous_number = max((int(number(row.get("invoiceNumber"))) for row in data["documents"]), default=0)
            invoice_number = reserve_invoice_numbers(connection, previous_number, 1, identity["user"]["account_id"])
    entry = entry_base(payload, type=next(iter(directions)) if len(directions) == 1 and "remittance" not in directions else "mixed",
        direction=payload.direction,
        externalInvoiceNumber=payload.externalInvoiceNumber, invoiceNumber=invoice_number, transactionId=transaction,
        documentIds=[row["id"] for row in documents], lines=details, settlementUnit="mixed" if dual else "gold", gold18Price=decimal_output(rate),
        calculationVersion=payload.calculationVersion, conversionGoldPrice=decimal_output(rate), paidGold=decimal_output(paid_gold),
        paidToman=decimal_output(paid_toman), convertedPaidTomanGold=decimal_output(converted_cash),
        counterpartyName=payload.referenceName, reference=payload.refNumber, **totals, **balance_purchase)
    if existing_entry:
        entry.update(id=existing_entry["id"], createdAt=created_at)
        position = next(index for index, row in enumerate(partner["entries"]) if row["id"] == existing_entry["id"])
        partner["entries"][position] = entry
    else:
        partner["entries"].append(entry)
    return entry["id"]


def register_partner_routes(application, workspace_response, encode_workspace):
    engine = application.state.engine

    def mutate(action, identifier, payload, identity, response, entry_id=None):
        if not has_permission(identity, "partners.write"):
            raise HTTPException(403, "اجازهٔ ویرایش دفتر همکاران ندارید.")
        if action in {"invoice", "invoice-update", "invoice-delete"} and not has_permission(identity, "documents.write"):
            raise HTTPException(403, "ثبت خرید همکار به اجازهٔ افزودن موجودی نیز نیاز دارد.")
        if action in {"invoice", "invoice-update"} and payload.goldBalancePurchase and not has_permission(identity, "goldPurchases.write"):
            raise HTTPException(403, "ثبت یا ویرایش خرید تراز طلا به اجازهٔ خرید طلا نیاز دارد.")
        account_id, actor_id = identity["user"]["account_id"], identity["user"]["id"]
        request_id = account_request_id(account_id, str(payload.requestId))
        body = payload.model_dump(mode="json", exclude={"revision", "requestId"}, exclude_unset=action == "update")
        if action == "invoice" and payload.direction == "purchase":
            body.pop("direction", None)
        # Requests saved before gold-only invoices did not contain a version field.
        # Retrying one after an upgrade must still match its original receipt hash.
        if action == "invoice" and payload.calculationVersion == 1:
            body.pop("calculationVersion", None)
        if action in {"invoice-update", "settlement-update", "invoice-delete", "settlement-delete", "operation-update", "operation-delete"}:
            body["entryId"] = entry_id
        try:
            body_hash = digest(json.dumps({"action": action, "partnerId": identifier, "payload": body}, sort_keys=True, ensure_ascii=False, allow_nan=False))
        except ValueError:
            raise HTTPException(422, "اطلاعات عددی معتبر نیست.")

        def replay(connection):
            receipt = connection.execute(select(partner_requests).where(partner_requests.c.request_id == request_id, partner_requests.c.account_id == account_id)).mappings().first()
            if receipt is None:
                return None
            if receipt["actor_id"] != actor_id or receipt["body_hash"] != body_hash:
                raise HTTPException(409, "شناسهٔ این درخواست قبلاً برای ثبت دیگری استفاده شده است.")
            return {**workspace_response(read_workspace(connection, account_id), identity, connection), "createdId": receipt["created_id"]}

        with engine.begin() as connection:
            current = read_workspace(connection, account_id)
            if action.startswith("operation"):
                previous_partner = find_partner(current["data"], identifier)
                previous_entry = next((row for row in previous_partner["entries"] if row["id"] == entry_id), None)
                if (getattr(payload, "kind", None) == "delivery" or previous_entry and previous_entry["type"] == "delivery") and not has_permission(identity, "documents.write"):
                    raise HTTPException(403, "دریافت و تحویل جنس به اجازهٔ تغییر موجودی نیاز دارد.")
            if action in {"invoice-update", "invoice-delete"} and not has_permission(identity, "goldPurchases.write"):
                previous_partner = find_partner(current["data"], identifier)
                previous_entry = next((row for row in previous_partner["entries"] if row["id"] == entry_id), None)
                if previous_entry and previous_entry.get("goldBalancePurchase"):
                    raise HTTPException(403, "ویرایش خرید تراز طلا به اجازهٔ خرید طلا نیاز دارد.")
            previous = replay(connection)
            if previous is not None:
                response.status_code = 200
                return previous
            if current["revision"] != payload.revision:
                raise HTTPException(409, "دفتر همزمان تغییر کرده است؛ ابتدا آخرین نسخه را بارگذاری کنید.")
            data, now = deepcopy(current["data"]), iso_now()
            if action == "create":
                if len(data["partners"]) >= 50000:
                    raise HTTPException(413, "تعداد همکاران دفتر به حد مجاز رسیده است.")
                partner = {**body, "id": secrets.token_hex(16), "entries": [], "createdAt": now, "updatedAt": now}
                recalculate_partner(partner)
                data["partners"].append(partner)
                created_id = partner["id"]
            else:
                partner = find_partner(data, identifier)
                # Existing documents remain correctable; the partner's current
                # trade type controls which workflow may create new documents.
                if action == "operation" and partner["tradeType"] != "melted":
                    raise HTTPException(422, "معاملات حسابی و تسویه فقط برای همکار آب‌شده‌فروش فعال است.")
                if action in {"invoice", "settlement"} and partner["tradeType"] == "melted":
                    raise HTTPException(422, "برای آب‌شده‌فروش، سند جدید را از بخش معاملات و تسویه ثبت کنید؛ فاکتور کار ساخته مجاز نیست.")
                if action == "update":
                    if partner["entries"] and any(key in body and number(body[key]) != number(partner[key]) for key in ("openingGoldBalance", "openingTomanBalance")):
                        raise HTTPException(409, "ماندهٔ افتتاحیه پس از ثبت گردش قابل تغییر نیست؛ اصلاح را با ردیف بدهکار یا بستانکار ثبت کنید.")
                    normalized = PartnerProfile.model_validate({**{key: partner[key] for key in PartnerProfile.model_fields}, **body}).model_dump()
                    partner.update(normalized)
                    for document in data["documents"]:
                        if document.get("partnerId") == partner["id"]:
                            document["customerName"] = partner["name"]
                    created_id = partner["id"]
                elif action in {"operation", "operation-update", "operation-delete"}:
                    existing_entry = None
                    position = len(partner["entries"])
                    previous_documents = list(data["documents"])
                    if action != "operation":
                        existing_entry = next((row for row in partner["entries"] if row["id"] == entry_id), None)
                        if not existing_entry:
                            raise HTTPException(404, "عملیات حساب پیدا نشد.")
                        if existing_entry["type"] not in OPERATION_TYPES or existing_entry["calculationVersion"] != 5:
                            raise HTTPException(422, "این مسیر فقط برای عملیات حساب است.")
                        if action == "operation-update" and payload.kind != existing_entry["type"]:
                            raise HTTPException(422, "نوع عملیات هنگام ویرایش قابل تغییر نیست.")
                        position = partner["entries"].index(existing_entry)
                        old_ids = set(existing_entry["documentIds"])
                        if old_ids != {row["id"] for row in previous_documents if row["id"] in old_ids}:
                            raise HTTPException(409, "اسناد موجودی این عملیات کامل نیست.")
                        data["documents"] = [row for row in previous_documents if row["id"] not in old_ids]
                        partner["entries"].pop(position)
                        recalculate_partner(partner)
                    if action != "operation-delete":
                        entry = make_operation(data, partner, payload, identity, connection, existing_entry, previous_documents)
                        partner["entries"].insert(position, entry)
                        created_id = entry["id"]
                    else:
                        created_id = existing_entry["id"]
                    guard_linked_inventory_changes(previous_documents, data["documents"])
                elif action == "invoice":
                    created_id = make_supplier_invoice(data, partner, payload, identity, connection)
                elif action == "invoice-update":
                    existing_entry = next((row for row in partner["entries"] if row["id"] == entry_id), None)
                    if existing_entry is None:
                        raise HTTPException(404, "سند همکار پیدا نشد.")
                    if existing_entry["type"] == "settlement":
                        raise HTTPException(422, "گردش مستقل باید از ویرایش دریافت و پرداخت اصلاح شود.")
                    if existing_entry.get("calculationVersion", 1) != payload.calculationVersion:
                        raise HTTPException(422, "روش محاسبهٔ سند ثبت‌شده هنگام ویرایش قابل تغییر نیست.")
                    if payload.calculationVersion < 3 and existing_entry.get("settlementUnit") != payload.settlementUnit:
                        raise HTTPException(422, "واحد تسویهٔ فاکتور قدیمی هنگام ویرایش قابل تغییر نیست.")
                    previous_documents = list(data["documents"])
                    old_ids = set(existing_entry["documentIds"])
                    if (not existing_entry.get("transactionId") or not existing_entry.get("invoiceNumber")
                            or old_ids != {row["id"] for row in previous_documents if row["id"] in old_ids}
                            or payload.calculationVersion < 3 and not old_ids):
                        raise HTTPException(422, "اطلاعات اصلی این فاکتور ناقص است و نیازمند بررسی دفتر است.")
                    data["documents"] = [row for row in data["documents"] if row["id"] not in old_ids]
                    created_id = make_supplier_invoice(data, partner, payload, identity, connection,
                        existing_entry=existing_entry, previous_documents=previous_documents)
                elif action in {"invoice-delete", "settlement-delete"}:
                    existing_entry = next((row for row in partner["entries"] if row["id"] == entry_id), None)
                    if existing_entry is None:
                        raise HTTPException(404, "سند همکار پیدا نشد.")
                    expected_type = "settlement" if action == "settlement-delete" else None
                    if expected_type and existing_entry["type"] != expected_type:
                        raise HTTPException(422, "این مسیر فقط برای حذف گردش مستقل است.")
                    if not expected_type and existing_entry["type"] not in {"purchase", "sale", "mixed"}:
                        raise HTTPException(422, "این مسیر فقط برای حذف سند فاکتور است.")
                    if existing_entry.get("linkedEntryId"):
                        raise HTTPException(422, "گردش متصل باید همراه سند اصلی حذف شود.")
                    old_ids = set(existing_entry.get("documentIds", []))
                    previous_documents = list(data["documents"])
                    if old_ids:
                        found_ids = {row["id"] for row in previous_documents if row["id"] in old_ids}
                        if found_ids != old_ids:
                            raise HTTPException(422, "اطلاعات اصلی این سند ناقص است و نیاز به بررسی دفتر دارد.")
                        data["documents"] = [row for row in previous_documents if row["id"] not in old_ids]
                        guard_linked_inventory_changes(previous_documents, data["documents"])
                    linked_id = existing_entry["id"]
                    partner["entries"] = [row for row in partner["entries"]
                        if row["id"] != linked_id and row.get("linkedEntryId") != linked_id]
                    created_id = linked_id
                else:
                    existing_entry = None
                    if action == "settlement-update":
                        existing_entry = next((row for row in partner["entries"] if row["id"] == entry_id), None)
                        if existing_entry is None:
                            raise HTTPException(404, "گردش همکار پیدا نشد.")
                        if (existing_entry["type"] != "settlement" or existing_entry.get("linkedEntryId")
                                or existing_entry.get("documentIds")):
                            raise HTTPException(422, "گردش متصل به فاکتور باید از ویرایش همان فاکتور اصلاح شود.")
                    gold = rounded_gold(numeric(payload.goldAmount, "مقدار طلای گردش", maximum=Decimal("1e12")))
                    toman = numeric(payload.tomanAmount, "مبلغ تومانی گردش", maximum=Decimal("1e12"))
                    if not gold and not toman:
                        raise HTTPException(422, "مقدار گردش باید بیشتر از صفر باشد.")
                    entry = entry_base(payload, type="settlement", paymentMethod=payload.paymentMethod, counterpartyName=payload.counterpartyName,
                        reference=payload.reference, **{"goldCredit" if payload.direction == "credit" else "goldDebit": decimal_output(gold),
                            "tomanCredit" if payload.direction == "credit" else "tomanDebit": decimal_output(toman)})
                    invoice_number = existing_entry.get("invoiceNumber") if existing_entry else None
                    if invoice_number is None:
                        numbered_rows = [*data["documents"], *(row for record in data["partners"] for row in record["entries"])]
                        minimum_number = max((int(value) for row in numbered_rows if (value := number(row.get("invoiceNumber"))) > 0
                            and value <= MAX_BALANCE and value == value.to_integral_value()), default=0)
                        invoice_number = reserve_invoice_numbers(connection, minimum_number, 1, account_id)
                    entry.update(invoiceNumber=invoice_number,
                        transactionId=(existing_entry.get("transactionId") if existing_entry else None) or str(uuid4()))
                    if existing_entry:
                        entry.update(id=existing_entry["id"], createdAt=existing_entry["createdAt"])
                        position = next(index for index, row in enumerate(partner["entries"]) if row["id"] == existing_entry["id"])
                        partner["entries"][position] = entry
                    else:
                        partner["entries"].append(entry)
                    created_id = entry["id"]
                partner["updatedAt"] = now
                recalculate_partner(partner)
                if len(partner["entries"]) > 50000:
                    raise HTTPException(413, "تعداد گردش‌های دفتر به حد مجاز رسیده است.")
            stamp_workspace_gallery(current["data"], data, connection, account_id)
            data["partners"] = canonical_partner_records(data["partners"], validate_balances=True)
            encoded = encode_workspace(data)
            revision = current["revision"] + 1
            updated = connection.execute(update(workspaces).where(workspaces.c.account_id == account_id, workspaces.c.revision == current["revision"]).values(data=encoded, revision=revision))
            if updated.rowcount != 1:
                previous = replay(connection)
                if previous is not None:
                    connection.rollback()
                    response.status_code = 200
                    return previous
                raise HTTPException(409, "دفتر همزمان تغییر کرده است؛ ابتدا آخرین نسخه را بارگذاری کنید.")
            connection.execute(partner_requests.insert().values(request_id=request_id, account_id=account_id, actor_id=actor_id,
                body_hash=body_hash, revision=revision, created_id=created_id, created_at=time.time()))
            result = workspace_response({"revision": revision, "data": data}, identity, connection)
        return {**result, "createdId": created_id}

    @application.get("/api/owner/partners")
    def list_partners(identity=Depends(get_user)):
        if not has_permission(identity, "partners.read"):
            raise HTTPException(403, "اجازهٔ مشاهدهٔ دفتر همکاران ندارید.")
        with engine.connect() as connection:
            return {"partners": read_workspace(connection, identity["user"]["account_id"])["data"]["partners"]}

    @application.post("/api/owner/partners", status_code=201)
    def create_partner(payload: PartnerCreate, response: Response, identity=Depends(require_mutation)):
        return mutate("create", None, payload, identity, response)

    @application.patch("/api/owner/partners/{identifier}")
    def edit_partner(identifier: str, payload: PartnerPatch, response: Response, identity=Depends(require_mutation)):
        return mutate("update", identifier, payload, identity, response)

    @application.post("/api/owner/partners/{identifier}/invoices", status_code=201)
    def post_invoice(identifier: str, payload: PartnerInvoice, response: Response, identity=Depends(require_mutation)):
        return mutate("invoice", identifier, payload, identity, response)

    @application.post("/api/owner/partners/{identifier}/operations", status_code=201)
    def post_operation(identifier: str, payload: PartnerOperation, response: Response, identity=Depends(require_mutation)):
        return mutate("operation", identifier, payload, identity, response)

    @application.patch("/api/owner/partners/{identifier}/operations/{entry_id}")
    def edit_operation(identifier: str, entry_id: str, payload: PartnerOperation, response: Response, identity=Depends(require_mutation)):
        return mutate("operation-update", identifier, payload, identity, response, entry_id=entry_id)

    @application.delete("/api/owner/partners/{identifier}/operations/{entry_id}")
    def delete_operation(identifier: str, entry_id: str, payload: PartnerMutation, response: Response, identity=Depends(require_mutation)):
        return mutate("operation-delete", identifier, payload, identity, response, entry_id=entry_id)

    @application.patch("/api/owner/partners/{identifier}/invoices/{entry_id}")
    def edit_invoice(identifier: str, entry_id: str, payload: PartnerInvoice, response: Response, identity=Depends(require_mutation)):
        return mutate("invoice-update", identifier, payload, identity, response, entry_id=entry_id)

    @application.delete("/api/owner/partners/{identifier}/invoices/{entry_id}")
    def delete_invoice(identifier: str, entry_id: str, payload: PartnerMutation, response: Response, identity=Depends(require_mutation)):
        return mutate("invoice-delete", identifier, payload, identity, response, entry_id=entry_id)

    @application.post("/api/owner/partners/{identifier}/settlements", status_code=201)
    def post_settlement(identifier: str, payload: PartnerSettlement, response: Response, identity=Depends(require_mutation)):
        return mutate("settlement", identifier, payload, identity, response)

    @application.patch("/api/owner/partners/{identifier}/settlements/{entry_id}")
    def edit_settlement(identifier: str, entry_id: str, payload: PartnerSettlement, response: Response, identity=Depends(require_mutation)):
        return mutate("settlement-update", identifier, payload, identity, response, entry_id=entry_id)

    @application.delete("/api/owner/partners/{identifier}/settlements/{entry_id}")
    def delete_settlement(identifier: str, entry_id: str, payload: PartnerMutation, response: Response, identity=Depends(require_mutation)):
        return mutate("settlement-delete", identifier, payload, identity, response, entry_id=entry_id)
