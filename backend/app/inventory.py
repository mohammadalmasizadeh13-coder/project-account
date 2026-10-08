"""Apply bounded stock corrections while preserving invoice and customer history."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP, localcontext
import re
from uuid import uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException
from sqlalchemy import Column, Float, String, Table

from .database import account_column, metadata
from .pricing import TRANSLATION, crafted_profit_or_default, iso_now, number
from .security import has_permission


STOCK_TYPES = {"crafted", "coin", "melted", "currency"}
inventory_requests = Table("noor_inventory_requests", metadata,
    Column("request_id", String(64), primary_key=True), account_column(), Column("actor_id", String(64), nullable=False),
    Column("body_hash", String(64), nullable=False), Column("created_id", String(200), nullable=False),
    Column("created_at", Float, nullable=False))
try:
    TEHRAN_ZONE = ZoneInfo("Asia/Tehran")
except ZoneInfoNotFoundError:
    # Windows may lack the IANA database. Tehran has used UTC+03:30 year-round since 2022.
    TEHRAN_ZONE = timezone(timedelta(hours=3, minutes=30), name="Asia/Tehran")
TEXT_FIELDS = {"itemName", "description", "note"}
ECONOMIC_FIELDS = {
    "crafted": {"weight", "ayar", "itemCount", "wagePercent", "wageFixed", "craftedKind"},
    "coin": {"coinType", "coinCount", "parsianWeight", "wagePercent", "wageFixed"},
    "melted": {"meltedWeight", "meltedAyar", "itemCount", "assayCode", "laboratoryName", "wagePercent", "wageFixed"},
    "currency": {"currencyType", "currencyAmount"},
}
STRING_FIELDS = TEXT_FIELDS | {"craftedKind", "coinType", "currencyType", "assayCode", "laboratoryName"}
LINKED_PROTECTED_FIELDS = set().union(*ECONOMIC_FIELDS.values()) | {
    "category", "source", "type", "direction", "productCode", "date", "customerId",
    "gramPrice", "meltedGramPrice", "coinPrice", "parsianPrice", "currencyRate", "profitPercent", "otherCosts",
    "gramDebt", "rialDebt", "gold18Price", "amount", "currentAmount", "itemWeight", "discountRial", "discountPercent",
    "setId", "setName", "setKind", "setMode", "setPieceCount", "transactionId",
    "weight750",
}
COINS = {"امامی بانکی ۸۶", "نیم سکه بانکی ۸۶", "ربع سکه بانکی ۸۶", "سکه یک گرمی بانکی ۸۶", "امامی", "تمام", "نیم", "ربع", "پارسیان"}
CURRENCIES = {"USD", "EUR", "AED", "GBP", "TRY"}
COIN_RATE_FIELDS = {"امامی بانکی ۸۶": "bankEmami86Price", "نیم سکه بانکی ۸۶": "bankHalf86Price",
    "ربع سکه بانکی ۸۶": "bankQuarter86Price", "سکه یک گرمی بانکی ۸۶": "bankOneGram86Price", "امامی": "emamiCoinPrice",
    "تمام": "tamamCoinPrice", "نیم": "halfCoinPrice", "ربع": "quarterCoinPrice"}
CURRENCY_RATE_FIELDS = {"USD": "usdPrice", "EUR": "eurPrice", "AED": "aedPrice", "GBP": "gbpPrice", "TRY": "tryPrice"}
KINDS = {"النگو", "دستبند", "گردنبند", "زنجیر", "انگشتر", "گوشواره", "آویز و پلاک", "نیم‌ست", "ست", "سرویس", "پابند", "سایر"}
NUMERIC_FIELDS = (set().union(*ECONOMIC_FIELDS.values()) - STRING_FIELDS) | {
    "gramPrice", "meltedGramPrice", "coinPrice", "parsianPrice", "currencyRate", "profitPercent", "otherCosts",
    "gramDebt", "rialDebt", "gold18Price", "amount", "currentAmount", "itemWeight", "discountRial", "discountPercent", "setPieceCount",
    "weight750",
}


def values_differ(field, previous, current):
    if field in NUMERIC_FIELDS:
        left, right = number(previous, "NaN"), number(current, "NaN")
        if left.is_finite() and right.is_finite():
            return left != right
    return previous != current


def is_stock_entry(document):
    return document.get("category") in STOCK_TYPES and (document.get("source") == "opening-inventory" or str(document.get("type", "")).endswith("-purchase"))


def is_sale(document):
    return str(document.get("type", "")).endswith("-sale") or document.get("direction") == "فروش"


def validate_stock_identity(document):
    name = document.get("itemName")
    if not isinstance(name, str) or not name.strip():
        raise HTTPException(422, "نام کالا را وارد کنید.")
    category = document["category"]
    field, choices, message = {
        "crafted": ("craftedKind", KINDS, "نوع کار ساخته را انتخاب کنید."),
        "coin": ("coinType", COINS, "نوع سکه معتبر را انتخاب کنید."),
        "currency": ("currencyType", CURRENCIES, "نوع ارز معتبر را انتخاب کنید."),
    }.get(category, (None, None, None))
    if field and (not isinstance(document.get(field), str) or document[field] not in choices):
        raise HTTPException(422, message)


def guard_new_document_identity(previous, incoming):
    """Require explicit goods identity on new records without rewriting historical ones."""
    existing_ids = {str(document["id"]) for document in previous}
    for document in incoming:
        if str(document["id"]) in existing_ids:
            continue
        category = document.get("category")
        kind = str(document.get("type") or "")
        implied_category = kind.removeprefix("opening-") if kind.startswith("opening-") else kind.rsplit("-", 1)[0]
        stock_category = isinstance(category, str) and category in STOCK_TYPES
        if not stock_category and implied_category not in STOCK_TYPES and document.get("source") != "opening-inventory":
            continue
        if not stock_category or implied_category in STOCK_TYPES and implied_category != category:
            raise HTTPException(422, "نوع کالا معتبر نیست.")
        validate_stock_identity(document)


def linked_sales(documents, identifier):
    return [document for document in documents if is_sale(document) and str(document.get("inventorySourceId", "")) == str(identifier)]


def guard_linked_inventory_changes(previous, incoming):
    replacements = {str(document["id"]): document for document in incoming}
    sold_ids = {str(document.get("inventorySourceId", "")) for document in previous + incoming if is_sale(document)}
    for source in previous:
        identifier = str(source["id"])
        if not is_stock_entry(source) or identifier not in sold_ids:
            continue
        updated = replacements.get(identifier)
        if updated is None:
            raise HTTPException(409, "جنس دارای سابقهٔ فروش حذف نمی‌شود.")
        if any(values_differ(field, source.get(field), updated.get(field)) for field in LINKED_PROTECTED_FIELDS):
            raise HTTPException(409, "مشخصات مالی جنس دارای سابقهٔ فروش قابل تغییر نیست؛ فقط نام و توضیحات را اصلاح کنید.")


def numeric(value, label, *, minimum=Decimal(0), maximum=Decimal("1e12"), default=None, status=422):
    if value in (None, "") and default is not None:
        value = default
    parsed = number(value, "NaN")
    if not parsed.is_finite() or parsed < minimum or parsed > maximum:
        raise HTTPException(status, f"{label} معتبر نیست.")
    return parsed


def decimal_output(value):
    if not value.is_finite() or abs(value) > Decimal("9007199254740991"):
        raise HTTPException(422, "مبلغ یا مقدار محاسبه‌شده بیش از محدودهٔ مجاز است.")
    return int(value) if value == value.to_integral_value() else float(value)


def quantity(document):
    category = document["category"]
    field = "currencyAmount" if category == "currency" else "coinCount" if category == "coin" else "itemCount"
    count = numeric(document.get(field), "تعداد یا مقدار", minimum=Decimal("0.00000001"), maximum=Decimal("100000000"), default=1)
    if category != "currency" and count != count.to_integral_value():
        raise HTTPException(422, "تعداد جنس باید عدد صحیح باشد.")
    return count


def validate_item(document):
    quantity(document)
    category = document["category"]
    if category in {"crafted", "melted"}:
        weight_key = "weight" if category == "crafted" else "meltedWeight"
        purity_key = "ayar" if category == "crafted" else "meltedAyar"
        numeric(document.get(weight_key), "وزن", minimum=Decimal("0.000001"), maximum=Decimal("100000"))
        numeric(document.get(purity_key), "عیار", minimum=Decimal(1), maximum=Decimal(1000), default=750)
    if category == "crafted" and document.get("craftedKind") not in (None, "") and document["craftedKind"] not in KINDS:
        raise HTTPException(422, "نوع کار ساخته معتبر نیست.")
    if category == "coin":
        if document.get("coinType") not in COINS:
            raise HTTPException(422, "نوع سکه معتبر نیست.")
        if document["coinType"] == "پارسیان":
            numeric(document.get("parsianWeight"), "وزن پارسیان", minimum=Decimal("0.000001"), maximum=Decimal("100000"))
    if category == "currency" and document.get("currencyType") not in CURRENCIES:
        raise HTTPException(422, "نوع ارز معتبر نیست.")
    numeric(document.get("wagePercent"), "اجرت درصدی", maximum=Decimal(100), default=0)
    numeric(document.get("wageFixed"), "اجرت ثابت", default=0)
    numeric(document.get("discountPercent"), "تخفیف درصدی", maximum=Decimal(100), default=0)
    if document.get("type") == "misc-purchase":
        if category != "crafted":
            raise HTTPException(422, "خرید طلای متفرقه فقط برای طلای ساخته ثبت می‌شود.")
        numeric(document.get("ayar"), "عیار واقعی", minimum=Decimal(1), maximum=Decimal(1000))
        numeric(document.get("gramPrice"), "نرخ خرید طلای متفرقه", minimum=Decimal("0.00000001"))
        if any(numeric(document.get(field), "اجرت یا سود", default=0) != 0 for field in ("wagePercent", "wageFixed", "profitPercent")):
            raise HTTPException(422, "خرید طلای متفرقه بدون اجرت و سود ثبت می‌شود.")


def discounted_amount(document, gross, *, validate_total=True):
    """Apply a sale's percentage before its fixed discount, on the whole row."""
    percent = numeric(document.get("discountPercent"), "تخفیف درصدی", maximum=Decimal(100), default=0)
    discount = numeric(document.get("discountRial"), "تخفیف", maximum=Decimal("9007199254740991"), default=0)
    if is_sale(document):
        discount += gross * percent / 100
    if validate_total and discount > gross and discount - gross > max(Decimal("1e-12"), gross * Decimal("2e-15")):
        raise HTTPException(422, "تخفیف نمی‌تواند بیشتر از مبلغ ردیف پیش از تخفیف باشد.")
    return max(Decimal(0), gross - discount)


def amount(document, prices=None):
    category, count = document["category"], quantity(document)
    prices = prices or {}
    def rate(field, market_field):
        market = number(prices.get(market_field))
        return market if 0 < market <= Decimal("1e12") else numeric(document.get(field), "نرخ تاریخی سند", minimum=Decimal("0.00000001"), status=409)
    with localcontext() as context:
        context.prec = 60
        if category == "crafted":
            base = count * number(document.get("weight")) * number(document.get("ayar") or 750) / 750 * rate("gramPrice", "goldGramPrice")
        elif category == "melted":
            base = count * number(document.get("meltedWeight")) * number(document.get("meltedAyar") or 750) / 750 * rate("meltedGramPrice", "goldGramPrice")
        elif category == "coin":
            base = count * (rate("parsianPrice", "") if document.get("coinType") == "پارسیان" else rate("coinPrice", COIN_RATE_FIELDS.get(document.get("coinType"), "")))
        else:
            base = count * rate("currencyRate", CURRENCY_RATE_FIELDS.get(document.get("currencyType"), ""))
        wage = Decimal(0) if category == "currency" else base * numeric(document.get("wagePercent"), "اجرت درصدی", default=0) / 100 + count * numeric(document.get("wageFixed"), "اجرت ثابت", default=0)
        costs = count * numeric(document.get("otherCosts"), "هزینهٔ تاریخی", default=0, status=409)
        profit = (base + wage + costs) * numeric(document.get("profitPercent"), "سود تاریخی", default=0, status=409) / 100
        return decimal_output(base + wage + costs + profit)


def item_weight(document):
    count = quantity(document)
    if document["category"] == "crafted":
        weight = count * number(document.get("weight"))
        if document.get("type") == "misc-purchase":
            with localcontext() as context:
                context.prec = 60
                weight = count * number(document.get("weight")) * number(document.get("ayar")) / 750
        return decimal_output(weight)
    if document["category"] == "melted":
        return decimal_output(count * number(document.get("meltedWeight")) * number(document.get("meltedAyar") or 750) / 750)
    if document["category"] == "coin" and document.get("coinType") == "پارسیان":
        return decimal_output(count * number(document.get("parsianWeight")))
    return 0


def format_number(value):
    parsed = number(value)
    return format(parsed, "f").rstrip("0").rstrip(".") if parsed % 1 else str(int(parsed))


def item_summary(document):
    name = str(document.get("itemName") or "").strip()
    category, count = document["category"], format_number(quantity(document))
    if category == "crafted":
        detail = f"{count} عدد، هر عدد {format_number(document.get('weight'))} گرم، عیار {document.get('ayar') or 750}، اجرت {format_number(document.get('wagePercent'))}٪"
        if document.get("type") == "misc-purchase":
            with localcontext() as context:
                context.prec = 60
                equivalent = (number(document.get("weight")) * number(document.get("ayar")) / 750).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)
            detail = f"{count} عدد، هر عدد {format_number(document.get('weight'))} گرم، عیار {format_number(document.get('ayar'))}، معادل هر عدد {format_number(equivalent)} گرم طلای ۷۵۰"
    elif category == "coin":
        detail = f"{document.get('coinType', 'سکه')}، {count} عدد"
        if document.get("coinType") == "پارسیان":
            detail += f"، هر عدد {format_number(document.get('parsianWeight'))} گرم"
    elif category == "melted":
        detail = f"{count} قطعه، هر قطعه {format_number(document.get('meltedWeight'))} گرم، عیار {document.get('meltedAyar') or 750}، انگ {document.get('assayCode') or '-'}، آزمایشگاه {document.get('laboratoryName') or '-'}"
    else:
        detail = f"{document.get('currencyType', 'ارز')}، مقدار {count}، نرخ ثبت {format_number(document.get('currencyRate'))} تومان"
    return f"{name}؛ {detail}" if name else detail


def normalize_misc_purchase(document, prices=None):
    """Keep physical purity and derive its 750 equivalent from trusted inputs."""
    if document.get("type") != "misc-purchase":
        return document
    result = {**document, "wagePercent": "0", "wageFixed": "0", "profitPercent": "0", "typeLabel": "خرید طلای متفرقه"}
    validate_item(result)
    numeric(result.get("otherCosts"), "هزینه‌های دیگر", default=0)
    with localcontext() as context:
        context.prec = 60
        result["weight750"] = decimal_output(number(result["weight"]) * number(result["ayar"]) / 750)
    result["itemWeight"] = item_weight(result)
    result["amount"] = amount(result)
    result["currentAmount"] = amount(result, prices)
    result["itemSummary"] = item_summary(result)
    return result


def sync_misc_purchase_caches(data, previous):
    previous_ids = {str(document["id"]) for document in previous}
    added = {str(document["id"]): document for document in data["documents"]
        if document.get("type") == "misc-purchase" and str(document["id"]) not in previous_ids}
    for customer in data["customers"]:
        for purchase in customer.get("purchases", []) or []:
            if not isinstance(purchase, dict):
                continue
            document = added.get(str(purchase.get("id")))
            if document and str(document.get("customerId")) == str(customer.get("id")):
                purchase.update(amount=document["amount"], detail=document["itemSummary"])


def customer_reference(data, source, identity):
    if source.get("source") == "opening-inventory" or source.get("counterpartyType") == "partner" or source.get("partnerId"):
        return None
    if not has_permission(identity, "customers.write"):
        raise HTTPException(403, "اصلاح این خرید به اجازهٔ ویرایش مشتریان نیز نیاز دارد.")
    matches = [customer for customer in data["customers"] if source.get("customerId") and str(customer.get("id")) == str(source["customerId"])]
    references = [(customer, index) for customer in data["customers"] for index, purchase in enumerate(customer.get("purchases", []) or [])
        if isinstance(purchase, dict) and str(purchase.get("id")) == str(source["id"])]
    if len(matches) != 1 or len(references) != 1 or references[0][0] is not matches[0]:
        raise HTTPException(409, "ارتباط این سند با سابقهٔ مشتری ناقص یا مبهم است؛ ابتدا فاکتور مرتبط را اصلاح کنید.")
    customer, index = references[0]
    for field in ("gramDebt", "rialDebt"):
        numeric(source.get(field), "بدهی سند", default=0, status=409)
        numeric(customer.get(field), "ماندهٔ مشتری", minimum=Decimal("-1e12"), default=0, status=409)
    return customer, index


def update_opening_summary(data):
    opening = [document for document in data["documents"] if document.get("source") == "opening-inventory"]
    total = sum((numeric(document.get("amount") if document.get("amount") not in (None, "") else amount(document), "مبلغ موجودی اولیه", status=409) for document in opening), Decimal(0))
    data["openingSetup"] = {**data.get("openingSetup", {}), "documentCount": len(opening), "totalValue": decimal_output(total)}


def find_source(data, identifier):
    source = next((document for document in data["documents"] if str(document.get("id")) == identifier and is_stock_entry(document)), None)
    if source is None:
        raise HTTPException(404, "جنس ورودی صندوق پیدا نشد.")
    return source


def next_product_code(documents):
    used = {re.sub(r"\s+", "", str(document.get("productCode") or "").translate(TRANSLATION).upper()) for document in documents}
    sequence = max((int(code[3:]) for code in used if re.fullmatch(r"ZG-[0-9]{1,18}", code)), default=0)
    while True:
        sequence += 1
        code = f"ZG-{sequence:06d}"
        if code not in used:
            return code


def create_stock(data, item, identity):
    if not has_permission(identity, "documents.write"):
        raise HTTPException(403, "اجازهٔ افزودن جنس به صندوق ندارید.")
    category = item.get("category")
    if not isinstance(category, str) or category not in STOCK_TYPES:
        raise HTTPException(422, "نوع موجودی معتبر نیست.")
    rate_fields = {"crafted": {"gramPrice"}, "coin": {"coinPrice", "parsianPrice"}, "melted": {"meltedGramPrice"}, "currency": {"currencyRate"}}[category]
    allowed = {"category", "otherCosts", "profitPercent"} | TEXT_FIELDS | ECONOMIC_FIELDS[category] | rate_fields
    if set(item) - allowed:
        raise HTTPException(422, "فقط مشخصات جنس را ارسال کنید؛ شناسه، بدهی، مشتری و اطلاعات سند توسط سرور تعیین می‌شوند.")
    if len(data["documents"]) >= 50000:
        raise HTTPException(413, "تعداد اسناد دفتر به حد مجاز رسیده است.")
    defaults = {"crafted": {"itemCount": "1", "ayar": "750"}, "coin": {"coinCount": "1"},
        "melted": {"itemCount": "1", "meltedAyar": "750"}, "currency": {}}[category]
    document = {"category": category, "description": "", "note": "", "wagePercent": "0", "wageFixed": "0",
        "otherCosts": "0", "profitPercent": str(crafted_profit_or_default(None)) if category == "crafted" else "0", **defaults}
    for field, value in item.items():
        if field == "category":
            continue
        if field in STRING_FIELDS:
            if not isinstance(value, str) or len(value) > (5000 if field in {"description", "note"} else 200):
                raise HTTPException(422, "متن واردشده معتبر نیست.")
            document[field] = value.strip()
        elif field in rate_fields:
            document[field] = format(numeric(value, "نرخ ورود", minimum=Decimal("0.00000001")), "f")
        else:
            if field == "profitPercent" and category == "crafted":
                value = crafted_profit_or_default(value)
            optional_default = 0 if field in {"wagePercent", "wageFixed", "otherCosts", "profitPercent"} else defaults.get(field)
            parsed = numeric(value, "مشخصات عددی جنس", default=optional_default)
            if field in {"wagePercent", "profitPercent"} and parsed > 100:
                raise HTTPException(422, "درصد اجرت یا سود باید بین صفر و صد باشد.")
            document[field] = format(parsed, "f")
    validate_stock_identity(document)
    if category == "currency":
        numeric(document.get("currencyAmount"), "مقدار ارز", minimum=Decimal("0.00000001"))
    if category == "melted" and (not document.get("assayCode") or not document.get("laboratoryName")):
        raise HTTPException(422, "شمارهٔ انگ و نام آزمایشگاه آب‌شده را وارد کنید.")
    validate_item(document)
    if category == "crafted":
        rate_field, market_field = "gramPrice", "goldGramPrice"
    elif category == "melted":
        rate_field, market_field = "meltedGramPrice", "goldGramPrice"
    elif category == "coin":
        rate_field, market_field = ("parsianPrice", None) if document["coinType"] == "پارسیان" else ("coinPrice", COIN_RATE_FIELDS.get(document["coinType"]))
    else:
        rate_field, market_field = "currencyRate", CURRENCY_RATE_FIELDS.get(document["currencyType"])
    if rate_field not in document:
        recorded_rate = number(data.get("prices", {}).get(market_field), "NaN") if market_field else Decimal("NaN")
        if not recorded_rate.is_finite() or not 0 < recorded_rate <= Decimal("1e12"):
            raise HTTPException(422, "نرخ ورود معتبر موجود نیست؛ قیمت ورود این جنس را وارد کنید.")
        document[rate_field] = format(recorded_rate, "f")
    recorded_at = iso_now()
    document.update({"id": f"document-opening-{uuid4()}", "productCode": next_product_code(data["documents"]),
        "source": "opening-inventory", "type": f"opening-{category}", "entryMethod": "manual",
        "typeLabel": {"crafted": "موجودی اولیه کار ساخته", "coin": "موجودی اولیه سکه", "melted": "موجودی اولیه آب‌شده", "currency": "موجودی اولیه ارز"}[category],
        "direction": "موجودی اولیه", "customerName": "موجودی اولیه", "customerId": "", "gramDebt": 0, "rialDebt": 0,
        "createdAt": recorded_at, "recordedAt": recorded_at, "date": datetime.fromisoformat(recorded_at).astimezone(TEHRAN_ZONE).date().isoformat()})
    document["amount"] = amount(document)
    document["currentAmount"] = amount(document, data.get("prices", {}))
    document["itemWeight"] = item_weight(document)
    document["itemSummary"] = item_summary(document)
    result = deepcopy(data)
    result["documents"] = [document, *result["documents"]]
    update_opening_summary(result)
    return result, document["id"]


def edit_stock(data, identifier, changes, identity):
    if not has_permission(identity, "documents.write"):
        raise HTTPException(403, "اجازهٔ ویرایش اسناد ندارید.")
    result = deepcopy(data)
    source = find_source(result, identifier)
    allowed = TEXT_FIELDS | ECONOMIC_FIELDS[source["category"]]
    if not changes or set(changes) - allowed:
        raise HTTPException(422, "فیلد ویرایش موجودی مجاز نیست یا تغییری ارسال نشده است.")
    normalized = {}
    for field, value in changes.items():
        if field in STRING_FIELDS:
            if not isinstance(value, str) or len(value) > (5000 if field in {"description", "note"} else 200):
                raise HTTPException(422, "متن واردشده معتبر نیست.")
            normalized[field] = value.strip()
        else:
            normalized[field] = format(numeric(value, "مقدار واردشده"), "f")
    economic = any(field in ECONOMIC_FIELDS[source["category"]] and values_differ(field, source.get(field), value) for field, value in normalized.items())
    if economic and (source.get("counterpartyType") == "partner" or source.get("partnerId")):
        raise HTTPException(409, "مشخصات مالی خرید ثبت‌شده در دفتر همکار قابل اصلاح از موجودی نیست.")
    if economic and linked_sales(result["documents"], identifier):
        raise HTTPException(409, "مشخصات مالی جنس دارای سابقهٔ فروش قابل تغییر نیست؛ فقط نام و توضیحات را اصلاح کنید.")
    reference = customer_reference(result, source, identity)
    source.update(normalized)
    if economic:
        validate_item(source)
        if source.get("type") == "misc-purchase":
            source.update(normalize_misc_purchase(source, result.get("prices", {})))
        source["amount"] = amount(source)
        source["currentAmount"] = amount(source, result.get("prices", {}))
        source["itemWeight"] = item_weight(source)
    source["itemSummary"] = item_summary(source)
    if reference:
        customer, index = reference
        cached = {**customer["purchases"][index], "detail": source["itemSummary"]}
        if economic:
            cached["amount"] = source["amount"]
        customer["purchases"][index] = cached
        customer["updatedAt"] = iso_now()
    if economic and source.get("source") == "opening-inventory":
        update_opening_summary(result)
    return result


def delete_stock(data, identifier, identity):
    if not has_permission(identity, "documents.write"):
        raise HTTPException(403, "اجازهٔ ویرایش اسناد ندارید.")
    result = deepcopy(data)
    source = find_source(result, identifier)
    if source.get("counterpartyType") == "partner" or source.get("partnerId"):
        raise HTTPException(409, "خرید ثبت‌شده در دفتر همکار از موجودی قابل حذف نیست.")
    if linked_sales(result["documents"], identifier):
        raise HTTPException(409, "جنس دارای سابقهٔ فروش حذف نمی‌شود.")
    grouped = any(source.get(field) and sum(document.get(field) == source[field] for document in result["documents"]) > 1 for field in ("transactionId", "setId"))
    if grouped or source.get("setMode") == "separate" and number(source.get("setPieceCount")) > 1:
        raise HTTPException(409, "این جنس بخشی از فاکتور یا مجموعهٔ چندقطعه است؛ فاکتور مرتبط را اصلاح کنید.")
    reference = customer_reference(result, source, identity)
    if reference:
        customer, index = reference
        for field in ("gramDebt", "rialDebt"):
            customer[field] = decimal_output(number(customer.get(field)) + number(source.get(field)))
        customer["purchases"] = [purchase for position, purchase in enumerate(customer["purchases"]) if position != index]
        customer["updatedAt"] = iso_now()
    result["documents"] = [document for document in result["documents"] if str(document["id"]) != identifier]
    if source.get("source") == "opening-inventory":
        update_opening_summary(result)
    return result
