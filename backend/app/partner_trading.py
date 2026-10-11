"""Agreed trades, physical deliveries and explicitly priced multi-asset offsets."""
from copy import deepcopy
from datetime import date
from decimal import Decimal, ROUND_HALF_UP, localcontext
from typing import Any, Literal
from uuid import UUID, uuid4

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .catalog import CURRENCIES, stock_entries
from .inventory import (BANK_COINS, COINS, ORDINARY_COINS, ORDINARY_COIN_SPECS,
    create_stock, decimal_output, item_summary, item_weight, numeric, quantity)
from .invoices import guard_invoice_stock, reserve_invoice_numbers
from .invoice_time import validate_invoice_time
from .pricing import iso_now, number


MELTED_DIVISOR = Decimal("4.3318")
OPERATION_TYPES = {"trade", "delivery", "offset"}


class PartnerOperation(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    revision: int = Field(ge=0, strict=True)
    requestId: UUID
    kind: Literal["trade", "delivery", "offset"]
    date: str = Field(min_length=10, max_length=10)
    invoiceTime: str = ""
    note: str = Field(default="", max_length=5000)
    reference: str = Field(default="", max_length=200)
    lines: list[dict[str, Any]] = Field(min_length=1, max_length=100)
    cashAmount: Any = 0
    cashDirection: Literal["pay", "receive"] = "pay"
    # Keep request hashes for requests recorded before row descriptions unchanged.
    cashDescription: str = Field(default="", max_length=5000, exclude_if=lambda value: not value)

    @field_validator("date")
    @classmethod
    def valid_date(cls, value):
        date.fromisoformat(value)
        return value

    _time = field_validator("invoiceTime")(validate_invoice_time)


def rounded(value, places="0.000001"):
    with localcontext() as context:
        context.prec = 80
        return value.quantize(Decimal(places), rounding=ROUND_HALF_UP)


def positive(value, label):
    return numeric(value, label, minimum=Decimal("0.00000001"))


def short_text(value, label):
    if not isinstance(value, str) or len(value.strip()) > 200:
        raise HTTPException(422, f"{label} معتبر نیست.")
    return value.strip()


def asset_spec(line):
    category = line.get("category")
    if category == "toman":
        return "toman", "تومان", {}
    if category == "melted":
        return "gold", "طلای ۷۵۰", {}
    if category == "currency":
        code = line.get("currencyType")
        if not isinstance(code, str) or code not in CURRENCIES:
            raise HTTPException(422, "نوع ارز معتبر نیست.")
        return f"currency:{code}", CURRENCIES[code][0], {"currencyType": code}
    if category != "coin" or not isinstance(line.get("coinType"), str) or line["coinType"] not in COINS:
        raise HTTPException(422, "نوع دارایی یا سکه معتبر نیست.")
    kind = line["coinType"]
    if kind not in ORDINARY_COINS:
        return f"coin:{kind}:0:0", kind, {"coinType": kind, "coinGroup": "bank", "coinPricingVersion": 2} if kind in BANK_COINS else {"coinType": kind}
    defaults = ORDINARY_COIN_SPECS.get(kind, (None, None))
    weight = positive(line.get("coinWeight") or defaults[0], "وزن هر سکه")
    purity = numeric(line.get("coinAyar") or defaults[1], "عیار سکه", minimum=Decimal("0.000001"), maximum=Decimal(1000))
    weight, purity = rounded(weight), rounded(purity)
    if weight <= 0 or purity <= 0:
        raise HTTPException(422, "وزن و عیار سکه باید بیشتر از صفر باشند.")
    weight_text, purity_text = format(weight.normalize(), "f"), format(purity.normalize(), "f")
    extra = short_text(line.get("itemName", ""), "نام سکه") if kind == "سایر" else ""
    if kind == "سایر" and not extra:
        raise HTTPException(422, "برای سایر سکه‌ها نام مشخص وارد کنید.")
    key = f"coin:{kind}:{weight_text}:{purity_text}" + (f":{extra}" if extra else "")
    return key, f"{extra or kind} · {weight_text} گرم · عیار {purity_text}", {
        "coinType": kind, "coinGroup": "ordinary", "coinPricingVersion": 2,
        "coinWeight": decimal_output(weight), "coinAyar": decimal_output(purity)}


def balances(partner):
    return {"gold": number(partner.get("goldBalance")), "toman": number(partner.get("tomanBalance")),
        **{key: number(value) for key, value in partner.get("assetBalances", {}).items()}}


def check_fields(line, allowed):
    if set(line) - allowed:
        raise HTTPException(422, "فیلد این ردیف مجاز نیست؛ فرم را تازه کنید.")


ASSET_FIELDS = {"category", "coinType", "coinWeight", "coinAyar", "currencyType", "itemName"}


def make_operation(data, partner, payload, identity, connection, existing=None, previous_documents=()):
    entry_id = existing["id"] if existing else uuid4().hex
    transaction = existing.get("transactionId") if existing else str(uuid4())
    created_at = existing["createdAt"] if existing else iso_now()
    movements, details, documents = {}, [], []
    def move(asset, value):
        movements[asset] = movements.get(asset, Decimal(0)) + value
    def stock_document(document, index, direction, description):
        old_ids = existing.get("documentIds", []) if existing else []
        document_id = old_ids[len(documents)] if len(documents) < len(old_ids) else f"document-delivery-{uuid4()}"
        original = next((row for row in previous_documents if row["id"] == document_id), None)
        if original and direction == "receive" and not original.get("inventorySourceId"):
            document["productCode"] = original["productCode"]
        document.update(id=document_id, source="partner-delivery", partnerOperation=True,
            counterpartyType="partner", partnerId=partner["id"], partnerEntryId=entry_id,
            customerId=partner["id"], customerName=partner["name"], transactionId=transaction,
            type=f"{document['category']}-{'purchase' if direction == 'receive' else 'sale'}",
            typeLabel="دریافت جنس از همکار" if direction == "receive" else "تحویل جنس به همکار",
            direction="دریافت" if direction == "receive" else "تحویل", date=payload.date,
            invoiceTime=payload.invoiceTime, createdAt=created_at, recordedAt=created_at,
            gramDebt=0, rialDebt=0, note=payload.note, description=description, invoiceLine=index + 1)
        for key in ("entryMethod", "invoiceVersion", "invoiceLineCount", "settlementVersion", "cashPaid", "setId", "setMode"):
            document.pop(key, None)
        document["currentAmount"] = document["amount"]
        document["itemSummary"] = item_summary(document)
        documents.append(document)
        data["documents"].append(document)
        return document_id

    with localcontext() as context:
        context.prec = 80
        offset_total = Decimal(0)
        original_balances = balances(partner)
        offset_used = {}
        for index, raw in enumerate(payload.lines):
            line = deepcopy(raw)
            if "description" in line:
                if not isinstance(line["description"], str) or len(line["description"]) > 5000:
                    raise HTTPException(422, "شرح ردیف باید متن و حداکثر ۵۰۰۰ نویسه باشد.")
                line["description"] = line["description"].strip()
            if payload.kind == "trade":
                check_fields(line, ASSET_FIELDS | {"direction", "quantity", "rate", "inputMode", "amount", "description"})
                asset, label, spec = asset_spec(line)
                if asset == "toman" or line.get("direction") not in {"purchase", "sale"}:
                    raise HTTPException(422, "نوع خرید یا فروش را انتخاب کنید.")
                rate = positive(line.get("rate"), "مظنه / قیمت توافقی")
                mode = line.get("inputMode", "quantity")
                if mode not in {"quantity", "amount"} or mode == "amount" and asset != "gold":
                    raise HTTPException(422, "روش ورود مبلغ فقط برای آب‌شده مجاز است.")
                unit_rate = rate / MELTED_DIVISOR if asset == "gold" else rate
                if mode == "amount":
                    total = rounded(positive(line.get("amount"), "مبلغ کل"), "0.01")
                    count = rounded(total / unit_rate)
                else:
                    count = positive(line.get("quantity"), "مقدار معامله")
                    if asset.startswith("coin:") and count != count.to_integral_value():
                        raise HTTPException(422, "تعداد سکه باید صحیح باشد.")
                    count = rounded(count, "0.00000001" if asset.startswith("currency:") else "0.000001")
                    total = rounded(count * unit_rate, "0.01")
                if count <= 0 or total <= 0:
                    raise HTTPException(422, "مقدار و مبلغ معامله باید بیشتر از صفر باشند.")
                sign = 1 if line["direction"] == "sale" else -1
                move(asset, sign * count)
                move("toman", -sign * total)
                details.append({**line, **spec, "asset": asset, "label": label, "quantity": decimal_output(count),
                    "rate": decimal_output(rate), "unitRate": decimal_output(unit_rate), "amount": decimal_output(total)})
            elif payload.kind == "offset":
                check_fields(line, {"asset", "quantity", "rate", "description"})
                asset = line.get("asset")
                if not isinstance(asset, str) or not original_balances.get(asset):
                    raise HTTPException(422, "برای تهاتر، یکی از مانده‌های غیرصفر همین همکار را انتخاب کنید.")
                count = positive(line.get("quantity"), "مقدار تهاتر")
                if asset.startswith("coin:") and count != count.to_integral_value():
                    raise HTTPException(422, "تعداد سکه باید صحیح باشد.")
                count = rounded(count, "0.00000001" if asset.startswith("currency:") else "0.000001")
                if count <= 0:
                    raise HTTPException(422, "مقدار تهاتر باید بیشتر از صفر باشد.")
                offset_used[asset] = offset_used.get(asset, Decimal(0)) + count
                if offset_used[asset] > abs(original_balances[asset]):
                    raise HTTPException(409, "مقدار تهاتر از ماندهٔ انتخاب‌شده بیشتر است.")
                rate = Decimal(1) if asset == "toman" else positive(line.get("rate"), "نرخ توافقی تهاتر")
                sign = -1 if original_balances[asset] > 0 else 1
                value = rounded(count * rate, "0.01")
                move(asset, sign * count)
                offset_total += sign * value
                details.append({"asset": asset, "quantity": decimal_output(count), "rate": decimal_output(rate),
                    "amount": decimal_output(value), "direction": "payable" if sign < 0 else "receivable",
                    **({"description": line["description"]} if "description" in line else {})})
            else:
                check_fields(line, ASSET_FIELDS | {"direction", "quantity", "rate", "inventorySourceId", "meltedWeight", "meltedAyar", "assayCode", "laboratoryName", "description"})
                direction = line.get("direction")
                if direction not in {"receive", "pay"}:
                    raise HTTPException(422, "جهت دریافت یا پرداخت را انتخاب کنید.")
                if line.get("category") == "toman":
                    count = rounded(positive(line.get("quantity"), "مبلغ دریافت / پرداخت"), "0.01")
                    move("toman", count if direction == "receive" else -count)
                    details.append({"category": "toman", "asset": "toman", "label": "تومان", "quantity": decimal_output(count), "amount": decimal_output(count), "direction": direction,
                        **({"description": line["description"]} if "description" in line else {})})
                    continue
                if direction == "pay":
                    source_id = line.get("inventorySourceId")
                    source = stock_entries(data["documents"]).get(str(source_id))
                    if not source:
                        raise HTTPException(422, "جنس قابل تحویل را از صندوق انتخاب کنید.")
                    count = positive(line.get("quantity"), "تعداد / مقدار تحویل")
                    if source["category"] != "currency" and count != count.to_integral_value():
                        raise HTTPException(422, "تعداد قطعه یا سکه باید صحیح باشد.")
                    if count > source["remaining"]:
                        raise HTTPException(409, "مقدار تحویل از موجودی صندوق بیشتر است.")
                    if payload.date < source.get("date", ""):
                        raise HTTPException(422, "تاریخ تحویل پیش از ورود جنس به صندوق است.")
                    asset, label, spec = asset_spec(source)
                    document = {key: value for key, value in source.items() if key in {
                        "category", "itemName", "productCode", "coinType", "coinGroup", "coinPricingVersion", "coinWeight", "coinAyar", "coinWeight750", "parsianWeight", "parsianPrice", "coinPrice",
                        "currencyType", "currencyRate", "meltedWeight", "meltedAyar", "assayCode", "laboratoryName", "meltedGramPrice", "gramPrice", "wagePercent", "wageFixed", "profitPercent", "profitFixed", "otherCosts"}}
                    quantity_field = "currencyAmount" if source["category"] == "currency" else "coinCount" if source["category"] == "coin" else "itemCount"
                    document[quantity_field] = decimal_output(count)
                    document["inventorySourceId"] = source["id"]
                    document["amount"] = decimal_output(rounded(number(source.get("amount")) * count / quantity(source), "0.01"))
                    document["currentAmount"] = document["amount"]
                    document["itemWeight"] = item_weight(document)
                    actual = rounded(number(source["meltedWeight"]) * number(source.get("meltedAyar", 750)) / 750 * count) if asset == "gold" else count
                else:
                    asset, label, spec = asset_spec(line)
                    rate = positive(line.get("rate"), "نرخ ثبت موجودی")
                    item = {"category": line["category"], "itemName": short_text(line.get("itemName") or label, "نام جنس"), **spec, "profitPercent": 0}
                    if asset == "gold":
                        weight = positive(line.get("meltedWeight"), "وزن دریافتی")
                        purity = numeric(line.get("meltedAyar"), "عیار آب‌شده", minimum=Decimal("0.000001"), maximum=Decimal(1000))
                        item.update(meltedWeight=decimal_output(weight), meltedAyar=decimal_output(purity), itemCount=1,
                            assayCode=short_text(line.get("assayCode", ""), "شماره انگ"), laboratoryName=short_text(line.get("laboratoryName", ""), "آزمایشگاه"),
                            meltedGramPrice=decimal_output(rate / MELTED_DIVISOR))
                        actual = rounded(weight * purity / 750)
                    else:
                        count = positive(line.get("quantity"), "مقدار دریافتی")
                        if asset.startswith("coin:"):
                            if count != count.to_integral_value():
                                raise HTTPException(422, "تعداد سکه باید صحیح باشد.")
                            item["coinCount"] = decimal_output(count)
                            if spec.get("coinGroup") == "ordinary":
                                item["gramPrice"] = decimal_output(rate / (number(spec["coinWeight"]) * number(spec["coinAyar"]) / 750))
                            else:
                                item["coinPrice"] = decimal_output(rate)
                        else:
                            item.update(currencyAmount=decimal_output(count), currencyRate=decimal_output(rate))
                        actual = count
                    received, document_id = create_stock(data, item, identity, require_assay=True)
                    document = next(row for row in received["documents"] if row["id"] == document_id)
                document_id = stock_document(document, index, direction, line.get("description", ""))
                move(asset, actual if direction == "receive" else -actual)
                details.append({**line, **spec, "category": document["category"], "asset": asset, "label": label,
                    "quantity": decimal_output(actual), "stockQuantity": decimal_output(quantity(document)),
                    "amount": document["amount"], "documentId": document_id})
        if payload.kind == "offset" and (not offset_used or offset_total != 0):
            raise HTTPException(422, "ارزش بدهی و طلب انتخاب‌شده برای تهاتر برابر نیست؛ مقدار یا نرخ توافقی را اصلاح کنید.")
        cash = rounded(numeric(payload.cashAmount, "پرداخت هم‌زمان", default=0), "0.01")
        if cash:
            if payload.kind != "trade":
                raise HTTPException(422, "پرداخت هم‌زمان فقط همراه معامله ثبت می‌شود.")
            move("toman", cash if payload.cashDirection == "receive" else -cash)
            details.append({"category": "toman", "asset": "toman", "label": "وجه هم‌زمان معامله", "direction": payload.cashDirection,
                "quantity": decimal_output(cash), "amount": decimal_output(cash), "simultaneous": True,
                **({"description": payload.cashDescription.strip()} if payload.cashDescription.strip() else {})})
        guard_invoice_stock(data["documents"], [row for row in documents if row.get("inventorySourceId")])
        if existing:
            invoice_number = existing["invoiceNumber"]
        else:
            numbered = [*data["documents"], *(row for record in data["partners"] for row in record["entries"])]
            minimum = max((int(number(row.get("invoiceNumber"))) for row in numbered), default=0)
            invoice_number = reserve_invoice_numbers(connection, minimum, 1, identity["user"]["account_id"])
        for document in documents:
            document["invoiceNumber"] = invoice_number
        entry = {"id": entry_id, "type": payload.kind, "date": payload.date, "invoiceTime": payload.invoiceTime,
            "createdAt": created_at, "note": payload.note, "reference": payload.reference,
            "invoiceNumber": invoice_number, "transactionId": transaction, "calculationVersion": 5, "settlementUnit": "mixed",
            "documentIds": [row["id"] for row in documents], "lines": details,
            "assetChanges": {key: decimal_output(rounded(value, "0.00000001")) for key, value in movements.items() if key not in {"gold", "toman"} and value}}
        for asset, prefix in (("gold", "gold"), ("toman", "toman")):
            value = rounded(movements.get(asset, Decimal(0)), "0.000001" if asset == "gold" else "0.01")
            entry[prefix + "Debit"] = decimal_output(max(value, Decimal(0)))
            entry[prefix + "Credit"] = decimal_output(max(-value, Decimal(0)))
        return entry
