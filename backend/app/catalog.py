import json
import re
import time
from decimal import Decimal, ROUND_HALF_UP, localcontext

from sqlalchemy import select

from .database import images, products, read_workspace
from .pricing import DEFAULT_CRAFTED_PROFIT_PERCENT, base_price_breakdown, crafted_profit_or_default, number, parse_timestamp, price_breakdown


CRAFTED_CATEGORIES = {"rings", "half-sets", "necklaces", "bracelets", "earrings", "sets", "other"}
CATEGORIES = CRAFTED_CATEGORIES | {"coin", "melted", "currency"}
STOCK_TYPES = {"crafted", "coin", "melted", "currency"}
DEFAULT_PROFIT_PERCENT = DEFAULT_CRAFTED_PROFIT_PERCENT
COIN_RATES = {"امامی بانکی ۸۶": "bankEmami86Price", "نیم سکه بانکی ۸۶": "bankHalf86Price",
    "ربع سکه بانکی ۸۶": "bankQuarter86Price", "سکه یک گرمی بانکی ۸۶": "bankOneGram86Price",
    "امامی": "emamiCoinPrice", "تمام": "tamamCoinPrice", "نیم": "halfCoinPrice", "ربع": "quarterCoinPrice"}
CURRENCIES = {"USD": ("دلار آمریکا", "usdPrice"), "EUR": ("یورو", "eurPrice"),
    "AED": ("درهم امارات", "aedPrice"), "GBP": ("پوند انگلیس", "gbpPrice"), "TRY": ("لیر ترکیه", "tryPrice")}
CRAFTED_KINDS = ("النگو", "دستبند", "گردنبند", "زنجیر", "انگشتر", "گوشواره", "آویز و پلاک", "نیم‌ست", "ست", "سرویس", "پابند", "سایر")
KIND_ALIASES = (("نیم‌ست", ("نیمست",)), ("دستبند", ("دستبند",)), ("گردنبند", ("گردنبند",)),
    ("النگو", ("النگو",)), ("زنجیر", ("زنجیر",)), ("انگشتر", ("انگشتر", "حلقه")),
    ("گوشواره", ("گوشواره",)), ("آویز و پلاک", ("آویز", "پلاک")), ("سرویس", ("سرویس",)), ("پابند", ("پابند",)))
KIND_CATEGORIES = {"نیم‌ست": "half-sets", "انگشتر": "rings", "گردنبند": "necklaces", "زنجیر": "necklaces",
    "آویز و پلاک": "necklaces", "النگو": "bracelets", "دستبند": "bracelets", "گوشواره": "earrings", "ست": "sets", "سرویس": "sets"}


def stock_entries(documents):
    entries = {}
    for document in documents:
        if document.get("category") in STOCK_TYPES and (document.get("source") == "opening-inventory" or str(document.get("type", "")).endswith("-purchase")):
            field = "currencyAmount" if document["category"] == "currency" else "coinCount" if document["category"] == "coin" else "itemCount"
            count = document.get(field)
            entries[str(document["id"])] = {**document, "remaining": number(1 if count is None and field != "currencyAmount" else count)}
    for document in documents:
        if str(document.get("type", "")).endswith("-sale"):
            item = entries.get(str(document.get("inventorySourceId", "")))
            if item:
                field = "currencyAmount" if document.get("category") == "currency" else "coinCount" if document.get("category") == "coin" else "itemCount"
                count = document.get(field)
                item["remaining"] -= number(1 if count is None else count)
    with localcontext() as context:
        context.prec = 80
        for item in entries.values():
            item["remaining"] = item["remaining"].quantize(Decimal("0.00000001"), rounding=ROUND_HALF_UP)
    return entries


def normalize_kind(value):
    return re.sub(r"[\s\u200c\u200f_-]+", "", str(value or "").replace("ي", "ی").replace("ى", "ی").replace("ك", "ک")).casefold()


def canonical_kind(value):
    normalized = normalize_kind(value)
    return next((kind for kind in CRAFTED_KINDS if normalize_kind(kind) == normalized), None)


def crafted_kind_for(item):
    explicit = canonical_kind(item.get("craftedKind"))
    if explicit:
        return explicit
    for field in ("craftedKind", "itemName", "description"):
        raw = str(item.get(field) or "")
        normalized = normalize_kind(raw)
        match = next((kind for kind, terms in KIND_ALIASES if any(term in normalized for term in terms)), None)
        if match:
            return match
        if re.search(r"(?:^|[\s\u200c])ست(?:$|[\s\u200c])", raw):
            return "ست"
    return "سایر"


def category_for(item):
    if item.get("category") in {"coin", "melted", "currency"}:
        return item["category"]
    return KIND_CATEGORIES.get(crafted_kind_for(item), "other")


def valid_product(item):
    stock_type = item.get("category")
    if stock_type not in STOCK_TYPES:
        return False
    quantity_field = "currencyAmount" if stock_type == "currency" else "coinCount" if stock_type == "coin" else "itemCount"
    raw_count = item.get(quantity_field)
    count = number(1 if raw_count is None and stock_type != "currency" else raw_count, "NaN")
    if not count.is_finite() or not 0 < count <= Decimal("1e8") or (stock_type != "currency" and count != count.to_integral_value()):
        return False
    if stock_type == "currency":
        return item.get("currencyType") in CURRENCIES
    if stock_type == "coin" and item.get("coinType") not in {*COIN_RATES, "پارسیان"}:
        return False
    constraints = [("wagePercent", 0, Decimal("0"), Decimal("100")),
        ("wageFixed", 0, Decimal("0"), Decimal("1e12"))]
    if stock_type in {"crafted", "melted"}:
        constraints.extend([("weight" if stock_type == "crafted" else "meltedWeight", None, Decimal("0.000001"), Decimal("100000")),
            ("ayar" if stock_type == "crafted" else "meltedAyar", 750, Decimal("1"), Decimal("1000"))])
    elif item.get("coinType") == "پارسیان" and item.get("parsianWeight") not in (None, ""):
        constraints.append(("parsianWeight", None, Decimal("0.000001"), Decimal("100000")))
    for key, default, minimum, maximum in constraints:
        raw = item.get(key)
        value = number(default if raw in (None, "") else raw, "NaN")
        if not value.is_finite() or not minimum <= value <= maximum:
            return False
    return True


def optional_number(value):
    parsed = number(value, "NaN")
    return float(parsed) if parsed.is_finite() else None


def price_basis(item, rate, prices, stale_seconds):
    stock_type = item["category"]
    unit = item.get("currencyType") if stock_type == "currency" else "coin" if stock_type == "coin" else "gram-750"
    missing = {"unit": unit, "rate": None, "source": "نرخ ثبت نشده", "updatedAt": None, "stale": True, "mode": "unavailable"}
    if stock_type in {"crafted", "melted"}:
        if rate.get("value") is None:
            return missing
        return {"unit": unit, "rate": rate["value"], "source": rate.get("source", "نرخ طلا"),
            "updatedAt": rate.get("updatedAt"), "stale": rate.get("stale", True), "mode": rate.get("mode", "manual")}
    key = CURRENCIES.get(item.get("currencyType"), (None, None))[1] if stock_type == "currency" else COIN_RATES.get(item.get("coinType"))
    value = number(prices.get(key), "NaN") if key else Decimal("NaN")
    if not value.is_finite() or not 0 < value <= Decimal("1e12"):
        return missing
    try:
        timestamp = parse_timestamp(prices.get("updatedAt"))
    except (ValueError, TypeError, OverflowError):
        return missing
    return {"unit": unit, "rate": float(value), "source": "نرخ ثبت‌شده حسابداری", "updatedAt": prices["updatedAt"],
        "stale": time.time() - timestamp.timestamp() > stale_seconds, "mode": "manual"}


def catalog(connection, rate, public=False, stale_seconds=300):
    workspace = read_workspace(connection)["data"]
    entries = stock_entries(workspace["documents"])
    metadata = {row.id: json.loads(row.data) for row in connection.execute(select(products))}
    pictures = {}
    for row in connection.execute(select(images).order_by(images.c.created_at, images.c.id)):
        pictures.setdefault(row.product_id, []).append({"id": row.id, "url": f"/api/media/{row.id}"})
    result = []
    for identifier, item in entries.items():
        info = metadata.get(identifier, {})
        published = info.get("published", True) is not False
        stock_type = item["category"]
        crafted_kind = crafted_kind_for(item) if stock_type == "crafted" else None
        weight = optional_number(item.get("weight") if stock_type == "crafted" else item.get("meltedWeight") if stock_type == "melted" else item.get("parsianWeight") if stock_type == "coin" and item.get("coinType") == "پارسیان" else None)
        purity = optional_number(item.get("ayar") or 750) if stock_type == "crafted" else optional_number(item.get("meltedAyar") or 750) if stock_type == "melted" else None
        wage_percent, wage_fixed = (Decimal(0), Decimal(0)) if stock_type == "currency" else (number(item.get("wagePercent", 0)), number(item.get("wageFixed", 0)))
        valid = valid_product(item)
        if public and (not published or item["remaining"] <= 0 or not valid):
            continue
        fallback_title = (crafted_kind if crafted_kind != "سایر" else "زیور طلا") if stock_type == "crafted" else f"سکه {item.get('coinType', '')}" if stock_type == "coin" else CURRENCIES.get(item.get("currencyType"), ("ارز",))[0] if stock_type == "currency" else "طلای آب‌شده"
        basis = price_basis(item, rate, workspace.get("prices", {}), stale_seconds)
        product = {
            "id": identifier, "productCode": str(item.get("productCode", "")),
            "title": str(info.get("title") or "").strip() or str(item.get("itemName") or "").strip() or fallback_title,
            "description": info.get("description", ""), "category": info["category"] if stock_type == "crafted" and info.get("category") in CRAFTED_CATEGORIES else category_for(item),
            "stockType": stock_type,
            "craftedKind": crafted_kind,
            "coinType": item.get("coinType") if stock_type == "coin" else None,
            "currencyType": item.get("currencyType") if stock_type == "currency" else None,
            "currencyName": CURRENCIES.get(item.get("currencyType"), (None,))[0] if stock_type == "currency" else None,
            "weight": weight, "purity": purity,
            "wagePercent": float(wage_percent), "wageFixed": float(wage_fixed),
            "profitPercent": crafted_profit_or_default(info.get("profitPercent")) if stock_type == "crafted" else info.get("profitPercent", DEFAULT_PROFIT_PERCENT), "taxPercent": info.get("taxPercent", 0),
            "remaining": float(max(Decimal(0), item["remaining"])), "published": published,
            "images": pictures.get(identifier, []), "price": None, "priceBasis": basis,
        }
        if valid and basis["rate"] is not None:
            if stock_type in {"crafted", "melted"}:
                product["price"] = price_breakdown(weight, purity, wage_percent, wage_fixed, product["profitPercent"], product["taxPercent"], basis["rate"])
            else:
                product["price"] = base_price_breakdown(basis["rate"], wage_percent, wage_fixed, product["profitPercent"], product["taxPercent"])
        result.append(product)
    # Existing ledger writes newest entries first.
    return result
