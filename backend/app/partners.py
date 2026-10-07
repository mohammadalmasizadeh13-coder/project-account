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

from .database import account_column, metadata, read_workspace, workspaces
from .inventory import amount, create_stock, decimal_output, item_summary, numeric, quantity
from .invoices import prepare_invoices
from .pricing import iso_now, number
from .security import account_request_id, digest, get_user, has_permission, require_mutation


partner_requests = Table("noor_partner_requests", metadata,
    Column("request_id", String(64), primary_key=True), account_column(),
    Column("actor_id", String(64), nullable=False), Column("body_hash", String(64), nullable=False),
    Column("revision", Integer, nullable=False), Column("created_id", String(64), nullable=False),
    Column("created_at", Float, nullable=False))
MAX_BALANCE = Decimal("9007199254740991")


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
    type: Literal["purchase", "settlement"]
    date: str = Field(min_length=10, max_length=10)
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
    lines: list[dict[str, Any]] = Field(default_factory=list, max_length=100)
    settlementUnit: Literal["gold", "toman"] | None = None
    gold18Price: float | None = Field(default=None, gt=0, le=1e12)
    linkedEntryId: str | None = Field(default=None, max_length=64)
    calculationVersion: Literal[1, 2] = 1
    conversionGoldPrice: float | None = Field(default=None, gt=0, le=1e12)
    paidGold: float = Field(default=0, ge=0, le=1e12)
    paidToman: float = Field(default=0, ge=0, le=1e12)
    convertedPaidTomanGold: float = Field(default=0, ge=0, le=float(MAX_BALANCE))

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
        if self.goldDebit and self.goldCredit or self.tomanDebit and self.tomanCredit:
            raise ValueError("ردیف دفتر نمی‌تواند همزمان بدهکار و بستانکار باشد.")
        if not any((self.goldDebit, self.goldCredit, self.tomanDebit, self.tomanCredit)):
            raise ValueError("مقدار ردیف دفتر باید بیشتر از صفر باشد.")
        return self


class PartnerRecord(PartnerProfile):
    id: str = Field(min_length=1, max_length=64)
    entries: list[LedgerEntry] = Field(default_factory=list, max_length=50000)
    goldBalance: float = Field(default=0, ge=-float(MAX_BALANCE), le=float(MAX_BALANCE))
    tomanBalance: float = Field(default=0, ge=-float(MAX_BALANCE), le=float(MAX_BALANCE))
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
    date: str = Field(min_length=10, max_length=10)
    externalInvoiceNumber: str = Field(default="", max_length=200)
    note: str = Field(default="", max_length=5000)
    gold18Price: Any
    settlementUnit: Literal["gold", "toman"] = "gold"
    lines: list[dict[str, Any]] = Field(min_length=1, max_length=100)
    paidGold: Any = 0
    paidToman: Any = 0
    referenceName: str = Field(default="", max_length=200)
    refNumber: str = Field(default="", max_length=200)
    calculationVersion: Literal[1, 2] = 1

    @field_validator("date")
    @classmethod
    def valid_date(cls, value):
        date.fromisoformat(value)
        return value

    @model_validator(mode="after")
    def gold_settlement_for_current_version(self):
        if self.calculationVersion == 2 and self.settlementUnit != "gold":
            raise ValueError("تسویهٔ خرید همکار با طلای ۷۵۰ ثبت می‌شود.")
        return self


class PartnerSettlement(PartnerMutation):
    date: str = Field(min_length=10, max_length=10)
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
    chronological = sorted(enumerate(partner.get("entries", [])), key=lambda pair: (pair[1]["date"], datetime.fromisoformat(pair[1]["createdAt"].replace("Z", "+00:00")), pair[0]))
    for _, entry in chronological:
        gold += number(entry.get("goldDebit")) - number(entry.get("goldCredit"))
        toman += number(entry.get("tomanDebit")) - number(entry.get("tomanCredit"))
        entry["goldBalance"], entry["tomanBalance"] = decimal_output(rounded_gold(gold)), decimal_output(toman)
    partner["goldBalance"], partner["tomanBalance"] = decimal_output(rounded_gold(gold)), decimal_output(toman)
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
        if abs(number(partner.get("goldBalance")) - number(recalculated["goldBalance"])) > Decimal("0.000001") or number(partner.get("tomanBalance")) != number(recalculated["tomanBalance"]):
            raise ValueError("ماندهٔ دفتر همکار با گردش‌ها مطابقت ندارد.")
        for entry, expected in zip(partner.get("entries", []), recalculated.get("entries", [])):
            if abs(number(entry["goldBalance"]) - number(expected["goldBalance"])) > Decimal("0.000001") or number(entry["tomanBalance"]) != number(expected["tomanBalance"]):
                raise ValueError("ماندهٔ ردیف دفتر همکار با گردش‌ها مطابقت ندارد.")
    return partners


def canonical_partner_records(partners, *, validate_balances=False):
    records = [PartnerRecord.model_validate(partner).model_dump() for partner in partners]
    return validate_partner_records(records) if validate_balances else records


def guard_partner_documents(previous, incoming, *, allow_stock_text=False):
    old_rows = {str(row["id"]): row for row in previous if row.get("partnerId") or row.get("counterpartyType") == "partner"}
    new_rows = {str(row["id"]): row for row in incoming}
    allowed = {"itemName", "description", "note", "itemSummary"} if allow_stock_text else set()
    for identifier, old in old_rows.items():
        updated = new_rows.get(identifier)
        if updated is None or {key: value for key, value in old.items() if key not in allowed} != {key: value for key, value in updated.items() if key not in allowed}:
            raise HTTPException(409, "فاکتور ثبت‌شده در دفتر همکار از این بخش قابل تغییر یا حذف نیست.")
    for row in incoming:
        if str(row["id"]) not in old_rows and (row.get("partnerId") or row.get("counterpartyType") == "partner"):
            raise HTTPException(409, "خرید همکار باید از بخش فاکتور همکار ثبت شود.")


def find_partner(data, identifier):
    found = next((partner for partner in data["partners"] if partner["id"] == identifier), None)
    if found is None:
        raise HTTPException(404, "همکار پیدا نشد.")
    return found


def entry_base(payload, **values):
    return {"id": secrets.token_hex(16), "date": payload.date, "createdAt": iso_now(),
        "goldDebit": 0, "goldCredit": 0, "tomanDebit": 0, "tomanCredit": 0,
        "goldBalance": 0, "tomanBalance": 0, "note": payload.note, "reference": "", "counterpartyName": "",
        "paymentMethod": "gold", **values}


def make_supplier_invoice(data, partner, payload, identity, connection):
    gold_invoice = payload.calculationVersion == 2
    rate = numeric(payload.gold18Price, "نرخ طلای ۷۵۰", minimum=Decimal("0.00000001"))
    paid_gold = numeric(payload.paidGold, "پرداخت طلا", maximum=Decimal("1e12"))
    if paid_gold and not rounded_gold(paid_gold):
        raise HTTPException(422, "مقدار پرداخت طلا کمتر از دقت مجاز دفتر است.")
    paid_gold = rounded_gold(paid_gold)
    paid_toman = numeric(payload.paidToman, "پرداخت تومان", maximum=Decimal("1e12"))
    transaction, created_at = str(uuid4()), iso_now()
    documents, details, gold_total, toman_total = [], [], Decimal(0), Decimal(0)
    draft = {**data, "documents": list(data["documents"])}
    for position, original in enumerate(payload.lines):
        line = dict(original)
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
        if gold_invoice:
            profit_percent = numeric(line.get("profitPercent"), "سود خرید همکار", maximum=Decimal(100), default=7 if category == "crafted" else 0)
            line["profitPercent"] = format(profit_percent, "f")
            if category in {"crafted", "melted"}:
                # A purchase and its gold conversion must use one frozen rate.
                line["gramPrice" if category == "crafted" else "meltedGramPrice"] = decimal_output(rate)
        else:
            if numeric(line.get("profitPercent"), "سود خرید همکار", default=0) != 0:
                raise HTTPException(422, "خرید از همکار بدون سود فروش ثبت می‌شود.")
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
            document.update(id=f"document-partner-{uuid4()}", source="partner-invoice", entryMethod="supplier-invoice",
                type=f"{category}-purchase", typeLabel="خرید از همکار", direction="خرید", customerId=partner["id"],
                customerName=partner["name"], counterpartyType="partner", partnerId=partner["id"],
                externalInvoiceNumber=payload.externalInvoiceNumber, date=payload.date, createdAt=created_at, recordedAt=created_at,
                invoiceVersion=1, invoiceLine=position + 1, invoiceLineCount=len(payload.lines), transactionId=transaction,
                gold18Price=decimal_output(rate))
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
            if gold_invoice:
                count = quantity(document)
                if category in {"crafted", "melted"}:
                    principal = equivalent
                else:
                    price_field = "currencyRate" if category == "currency" else "parsianPrice" if document.get("coinType") == "پارسیان" else "coinPrice"
                    principal = count * number(document[price_field]) / rate
                    labor = Decimal(0) if category == "currency" else principal * number(document.get("wagePercent")) / 100
                fixed_labor = count * number(document.get("wageFixed")) / rate
                other_costs = count * number(document.get("otherCosts")) / rate
                profit = (principal + labor + fixed_labor + other_costs) * profit_percent / 100
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
            document["partnerGoldDebit"] = decimal_output(rounded_gold(line_gold))
            document["itemSummary"] = item_summary(document)
            documents.append(document)
            details.append({**original, "documentId": document["id"], "productCode": document["productCode"],
                "scaleWeight": decimal_output(scale_weight) if scale_weight is not None else 0,
                "weight750": decimal_output(equivalent), "laborGold": decimal_output(labor),
                "goldDebit": decimal_output(rounded_gold(line_gold)), "tomanDebit": decimal_output(line_toman), "amount": document["amount"], **snapshot})
            draft["documents"] = [document, *draft["documents"]]
    gold_total = rounded_gold(gold_total)
    if gold_total <= 0 and toman_total <= 0:
        raise HTTPException(422, "مقدار فاکتور کمتر از دقت مجاز دفتر است.")
    documents[0]["gramDebt"] = decimal_output(gold_total)
    documents[0]["rialDebt"] = decimal_output(toman_total)
    incoming = prepare_invoices(data["documents"], [*documents, *data["documents"]], connection, account_id=identity["user"]["account_id"])
    data["documents"] = incoming
    entry = entry_base(payload, type="purchase", externalInvoiceNumber=payload.externalInvoiceNumber,
        invoiceNumber=incoming[0]["invoiceNumber"], transactionId=transaction, documentIds=[row["id"] for row in documents],
        lines=details, settlementUnit=payload.settlementUnit, gold18Price=decimal_output(rate),
        goldDebit=decimal_output(gold_total), tomanDebit=decimal_output(toman_total),
        **({"calculationVersion": 2, "conversionGoldPrice": decimal_output(rate)} if gold_invoice else {}))
    partner["entries"].append(entry)
    if paid_gold or paid_toman:
        with localcontext() as context:
            context.prec = 80
            converted_cash = paid_toman / rate if gold_invoice else Decimal(0)
            gold_credit = rounded_gold(paid_gold + converted_cash)
        if gold_invoice and not gold_credit:
            raise HTTPException(422, "مقدار پرداخت کمتر از دقت مجاز دفتر است.")
        partner["entries"].append(entry_base(payload, type="settlement", goldCredit=decimal_output(gold_credit),
            tomanCredit=0 if gold_invoice else decimal_output(paid_toman), counterpartyName=payload.referenceName,
            reference=payload.refNumber, paymentMethod="remittance" if payload.referenceName or payload.refNumber else "cash" if paid_toman else "gold",
            linkedEntryId=entry["id"], **({"calculationVersion": 2, "settlementUnit": "gold", "gold18Price": decimal_output(rate),
                "conversionGoldPrice": decimal_output(rate), "paidGold": decimal_output(paid_gold), "paidToman": decimal_output(paid_toman),
                "convertedPaidTomanGold": decimal_output(converted_cash)} if gold_invoice else {})))
    return entry["id"]


def register_partner_routes(application, workspace_response, encode_workspace):
    engine = application.state.engine

    def mutate(action, identifier, payload, identity, response):
        if not has_permission(identity, "partners.write"):
            raise HTTPException(403, "اجازهٔ ویرایش دفتر همکاران ندارید.")
        if action == "invoice" and not has_permission(identity, "documents.write"):
            raise HTTPException(403, "ثبت خرید همکار به اجازهٔ افزودن موجودی نیز نیاز دارد.")
        account_id, actor_id = identity["user"]["account_id"], identity["user"]["id"]
        request_id = account_request_id(account_id, str(payload.requestId))
        body = payload.model_dump(mode="json", exclude={"revision", "requestId"}, exclude_unset=action == "update")
        # Requests saved before gold-only invoices did not contain a version field.
        # Retrying one after an upgrade must still match its original receipt hash.
        if action == "invoice" and payload.calculationVersion == 1:
            body.pop("calculationVersion", None)
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
            previous = replay(connection)
            if previous is not None:
                response.status_code = 200
                return previous
            current = read_workspace(connection, account_id)
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
                if action == "update":
                    if partner["entries"] and any(key in body and number(body[key]) != number(partner[key]) for key in ("openingGoldBalance", "openingTomanBalance")):
                        raise HTTPException(409, "ماندهٔ افتتاحیه پس از ثبت گردش قابل تغییر نیست؛ اصلاح را با ردیف بدهکار یا بستانکار ثبت کنید.")
                    normalized = PartnerProfile.model_validate({**{key: partner[key] for key in PartnerProfile.model_fields}, **body}).model_dump()
                    partner.update(normalized)
                    for document in data["documents"]:
                        if document.get("partnerId") == partner["id"]:
                            document["customerName"] = partner["name"]
                    created_id = partner["id"]
                elif action == "invoice":
                    created_id = make_supplier_invoice(data, partner, payload, identity, connection)
                else:
                    gold = rounded_gold(numeric(payload.goldAmount, "مقدار طلای گردش", maximum=Decimal("1e12")))
                    toman = numeric(payload.tomanAmount, "مبلغ تومانی گردش", maximum=Decimal("1e12"))
                    if not gold and not toman:
                        raise HTTPException(422, "مقدار گردش باید بیشتر از صفر باشد.")
                    entry = entry_base(payload, type="settlement", paymentMethod=payload.paymentMethod, counterpartyName=payload.counterpartyName,
                        reference=payload.reference, **{"goldCredit" if payload.direction == "credit" else "goldDebit": decimal_output(gold),
                            "tomanCredit" if payload.direction == "credit" else "tomanDebit": decimal_output(toman)})
                    partner["entries"].append(entry)
                    created_id = entry["id"]
                partner["updatedAt"] = now
                recalculate_partner(partner)
                if len(partner["entries"]) > 50000:
                    raise HTTPException(413, "تعداد گردش‌های دفتر به حد مجاز رسیده است.")
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

    @application.post("/api/owner/partners/{identifier}/settlements", status_code=201)
    def post_settlement(identifier: str, payload: PartnerSettlement, response: Response, identity=Depends(require_mutation)):
        return mutate("settlement", identifier, payload, identity, response)
