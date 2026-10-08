"""Keep multi-item invoices complete while retaining the existing flat ledger."""
from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP, localcontext
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import Column, Index, Integer, Table, case, literal, select, update

from .database import LEGACY_ACCOUNT_ID, account_column, metadata
from .customer_details import document_detail_header
from .inventory import ECONOMIC_FIELDS, STOCK_TYPES, TEXT_FIELDS, discounted_amount, is_sale, is_stock_entry, normalize_misc_purchase, numeric, quantity, validate_item, values_differ
from .pricing import number


MAX_INVOICE_LINES = 100
MAX_SAFE_INTEGER = 9007199254740991
INVOICE_FIELDS = {"invoiceVersion", "invoiceLine", "invoiceLineCount", "invoiceNumber"}
SETTLEMENT_FIELDS = {"settlementVersion", "cashPaid", "settlementGoldPrice", "settlementRemainder"}
invoice_sequence = Table("noor_invoice_sequence", metadata,
    Column("id", Integer, primary_key=True), account_column(), Column("last_number", Integer, nullable=False))
Index("noor_invoice_sequence_account", invoice_sequence.c.account_id, unique=True)


def invoice_error(message="اطلاعات ردیف‌های فاکتور کامل و یکسان نیست.", status=422):
    raise HTTPException(status, message)


def invoice_groups(documents):
    groups = defaultdict(list)
    for document in documents:
        if "invoiceVersion" not in document:
            continue
        transaction = document.get("transactionId")
        if type(document["invoiceVersion"]) is not int or document["invoiceVersion"] != 1 or not isinstance(transaction, str):
            invoice_error()
        try:
            if str(UUID(transaction)) != transaction:
                invoice_error("شناسهٔ فاکتور معتبر نیست.")
        except (ValueError, AttributeError):
            invoice_error("شناسهٔ فاکتور معتبر نیست.")
        groups[transaction].append(document)
    return groups


def rounded_matches(saved, exact, unit):
    """Match the browser's rounding, including float noise at half-way values."""
    rounded = exact.quantize(unit, rounding=ROUND_HALF_UP)
    if saved == rounded:
        return True
    # A browser can fall on either side of the same rounding boundary. Allow
    # only an adjacent rounded value, and only within floating point noise.
    tolerance = max(Decimal("1e-12"), abs(exact) * Decimal("2e-15"))
    boundary = (saved + rounded) / 2
    return abs(saved - rounded) == unit and abs(exact - boundary) <= tolerance


def settlement_row_total(row):
    """Reproduce documentBreakdown from the immutable rates saved on this row."""
    count, category = quantity(row), row["category"]
    if category in {"crafted", "melted"}:
        weight, purity, price = ("weight", "ayar", "gramPrice") if category == "crafted" else ("meltedWeight", "meltedAyar", "meltedGramPrice")
        base = count * numeric(row.get(weight), "وزن") * numeric(row.get(purity), "عیار", default=750) / 750
        base *= numeric(row.get(price), "نرخ ثبت‌شدهٔ هر گرم", minimum=Decimal("0.00000001"))
    elif category == "coin":
        price = "parsianPrice" if row.get("coinType") == "پارسیان" else "coinPrice"
        base = count * numeric(row.get(price), "نرخ ثبت‌شدهٔ سکه", minimum=Decimal("0.00000001"))
    else:
        base = count * numeric(row.get("currencyRate"), "نرخ ثبت‌شدهٔ ارز", minimum=Decimal("0.00000001"))
    wage = Decimal(0) if category == "currency" else base * numeric(row.get("wagePercent"), "اجرت درصدی", default=0) / 100 + count * numeric(row.get("wageFixed"), "اجرت ثابت", default=0)
    costs = count * numeric(row.get("otherCosts"), "هزینه‌های دیگر", default=0)
    profit = (base + wage + costs) * numeric(row.get("profitPercent"), "سود درصدی", default=0) / 100
    gross = base + wage + costs + profit
    return discounted_amount(row, gross)


def validate_settlement(rows, total):
    """New sale settlements store one cash payment and one 750-gold debt."""
    if not any(SETTLEMENT_FIELDS.intersection(row) for row in rows):
        return
    first = next(row for row in rows if row["invoiceLine"] == 1)
    if SETTLEMENT_FIELDS - first.keys() or type(first["settlementVersion"]) is not int or first["settlementVersion"] != 1:
        invoice_error("اطلاعات پرداخت نقدی و تبدیل ماندهٔ فاکتور کامل نیست.")
    if any(SETTLEMENT_FIELDS.intersection(row) for row in rows if row is not first):
        invoice_error("اطلاعات پرداخت فقط یک بار در ردیف اول فاکتور ثبت می‌شود.")
    if any(not str(row["type"]).endswith("-sale") for row in rows):
        invoice_error("تبدیل خودکار مانده به طلا فقط برای فاکتور فروش است.")
    cash = numeric(first["cashPaid"], "پرداخت نقدی", maximum=Decimal(MAX_SAFE_INTEGER))
    remainder = numeric(first["settlementRemainder"], "ماندهٔ پرداخت", maximum=Decimal(MAX_SAFE_INTEGER))
    rate = numeric(first["settlementGoldPrice"], "نرخ تبدیل مانده به طلا")
    if rate <= 0:
        invoice_error("نرخ تبدیل مانده به طلا باید بیشتر از صفر باشد.")
    if cash != cash.to_integral_value() or cash > total:
        invoice_error("پرداخت نقدی باید تومان کامل و حداکثر برابر جمع فاکتور باشد.")
    if remainder != total - cash:
        invoice_error("ماندهٔ پرداخت با جمع فاکتور و پرداخت نقدی مطابقت ندارد.")
    with localcontext() as context:
        context.prec = 80
        for row in rows:
            if numeric(row.get("gold18Price"), "نرخ طلای ثبت‌شدهٔ فاکتور") != rate:
                invoice_error("نرخ تبدیل مانده باید با نرخ طلای ثبت‌شدهٔ تمام ردیف‌ها یکسان باشد.")
            saved_amount = numeric(row["amount"], "مبلغ ردیف", maximum=Decimal(MAX_SAFE_INTEGER))
            if saved_amount != saved_amount.to_integral_value() or not rounded_matches(saved_amount, settlement_row_total(row), Decimal(1)):
                invoice_error("مبلغ ردیف با وزن، نرخ، اجرت و تخفیف ثبت‌شده مطابقت ندارد.")
            if numeric(row.get("rialDebt"), "بدهی ریالی") != 0:
                invoice_error("ماندهٔ این فاکتور به طلا تبدیل شده و بدهی ریالی جداگانه ندارد.")
        grams = numeric(first.get("gramDebt"), "بدهی گرمی")
        if remainder > rate * (Decimal("1e12") + Decimal("0.000001")):
            invoice_error("بدهی گرمی محاسبه‌شده بیش از محدودهٔ مجاز است.")
        if grams != grams.quantize(Decimal("0.000001")) or not rounded_matches(grams, remainder / rate, Decimal("0.000001")):
            invoice_error("بدهی گرمی باید برابر ماندهٔ پرداخت تقسیم بر نرخ طلای ثبت‌شده باشد.")


def validate_group(rows):
    count = len(rows)
    if not 1 <= count <= MAX_INVOICE_LINES:
        invoice_error("فاکتور باید بین یک تا صد ردیف داشته باشد.")
    indexes = []
    headers = []
    total = Decimal(0)
    for row in rows:
        line = row.get("invoiceLine")
        if type(line) is not int or type(row.get("invoiceLineCount")) is not int or row["invoiceLineCount"] != count:
            invoice_error("همهٔ ردیف‌های فاکتور باید با هم ثبت شوند.")
        indexes.append(line)
        customer = row.get("customerId")
        name = row.get("customerName")
        if not isinstance(customer, (str, int)) or isinstance(customer, bool) or not str(customer).strip() or len(str(customer)) > 200:
            invoice_error("طرف حساب فاکتور را مشخص کنید.")
        if not isinstance(name, str) or not name.strip() or len(name) > 200:
            invoice_error("نام طرف حساب فاکتور معتبر نیست.")
        recorded_date, created_at = row.get("date"), row.get("createdAt")
        try:
            if not isinstance(recorded_date, str) or len(recorded_date) != 10:
                raise ValueError()
            date.fromisoformat(recorded_date)
            if not isinstance(created_at, str) or len(created_at) > 50 or datetime.fromisoformat(created_at.replace("Z", "+00:00")).tzinfo is None:
                raise ValueError()
        except ValueError:
            invoice_error("تاریخ و زمان ثبت فاکتور معتبر نیست.")
        category = row.get("category")
        if not isinstance(category, str) or category not in STOCK_TYPES or row.get("source") == "opening-inventory":
            invoice_error("نوع کالای فاکتور معتبر نیست.")
        kind = row.get("type")
        if kind not in (f"{category}-purchase", f"{category}-sale") and not (kind == "misc-purchase" and category == "crafted"):
            invoice_error("نوع معاملهٔ فاکتور معتبر نیست.")
        direction = kind.rsplit("-", 1)[1]
        if row.get("direction") not in (None, "فروش" if direction == "sale" else "خرید"):
            invoice_error("نوع معاملهٔ ردیف با فاکتور مطابقت ندارد.")
        # A partner's mixed document explicitly carries both purchase and sale rows.
        # Keep ordinary customer invoices subject to their single-direction contract.
        group_direction = ("partner-v3", row["partnerId"]) if row.get("calculationVersion") == 3 and row.get("counterpartyType") == "partner" and row.get("partnerId") == customer else direction
        headers.append((customer, name.strip(), recorded_date, created_at, row.get("recordedAt"), group_direction,
            document_detail_header(row)))
        validate_item(row)
        saved_amount = numeric(row.get("amount"), "مبلغ ردیف", maximum=Decimal(MAX_SAFE_INTEGER))
        if is_sale(row) and number(row.get("discountPercent")) > 0:
            with localcontext() as context:
                context.prec = 80
                exact = settlement_row_total(row)
                tolerance = max(Decimal("1e-12"), abs(exact) * Decimal("2e-15"))
                if abs(saved_amount - exact) > tolerance and not rounded_matches(saved_amount, exact, Decimal(1)):
                    invoice_error("مبلغ ردیف با وزن، نرخ، اجرت و تخفیف ثبت‌شده مطابقت ندارد.")
        total += saved_amount
        for field in ("gramDebt", "rialDebt"):
            debt = numeric(row.get(field), "ماندهٔ فاکتور", default=0)
            if line != 1 and debt != 0:
                invoice_error("ماندهٔ فاکتور فقط یک بار در ردیف اول ثبت می‌شود.")
    if sorted(indexes) != list(range(1, count + 1)) or any(header != headers[0] for header in headers[1:]):
        invoice_error()
    if total > MAX_SAFE_INTEGER:
        invoice_error("جمع مبلغ فاکتور بیش از محدودهٔ مجاز است.")
    validate_settlement(rows, total)


def guard_invoice_stock(incoming, new_rows):
    """A repeated pick of one lot must share its single remaining stock balance."""
    sources = {str(row["id"]): row for row in incoming if is_stock_entry(row)}
    touched = set()
    for row in new_rows:
        if not is_sale(row):
            continue
        identifier = row.get("inventorySourceId")
        if identifier in (None, ""):
            invoice_error("برای فروش، کد جنس موجود در صندوق را انتخاب کنید.")
        source = sources.get(str(identifier))
        if source is None or source["category"] != row["category"]:
            invoice_error("کد جنس موجود در صندوق با ردیف فروش مطابقت ندارد.", 409)
        identity_field = {"coin": "coinType", "currency": "currencyType"}.get(row["category"])
        if identity_field and source.get(identity_field) != row.get(identity_field):
            invoice_error("نوع کالا با موجودی انتخاب‌شده مطابقت ندارد.", 409)
        if source.get("date") and row["date"] < str(source["date"]):
            invoice_error("تاریخ فروش نمی‌تواند پیش از ورود جنس به صندوق باشد.")
        touched.add(str(identifier))
    sold = defaultdict(Decimal)
    for row in incoming:
        identifier = str(row.get("inventorySourceId", ""))
        if is_sale(row) and identifier in touched:
            if row.get("category") != sources[identifier]["category"]:
                invoice_error("نوع ردیف فروش با موجودی صندوق مطابقت ندارد.", 409)
            sold[identifier] += quantity(row)
    for identifier in touched:
        if sold[identifier] > quantity(sources[identifier]):
            invoice_error("جمع تعداد فروش در فاکتور از موجودی این کد بیشتر است.", 409)


def reserve_invoice_numbers(connection, minimum, count, account_id=LEGACY_ACCOUNT_ID):
    # The conditional insert takes SQLite's write lock before reading the counter;
    # the increment and workspace save share one transaction and roll back together.
    connection.execute(invoice_sequence.insert().from_select(["account_id", "last_number"],
        select(literal(account_id), literal(minimum)).where(~select(invoice_sequence.c.id).where(invoice_sequence.c.account_id == account_id).exists())))
    last = connection.execute(update(invoice_sequence).where(invoice_sequence.c.account_id == account_id).values(
        last_number=case((invoice_sequence.c.last_number < minimum, minimum), else_=invoice_sequence.c.last_number) + count
    ).returning(invoice_sequence.c.last_number)).scalar_one()
    if last > MAX_SAFE_INTEGER:
        invoice_error("شمارهٔ فاکتور بیش از محدودهٔ مجاز است.")
    return last


def prepare_invoices(previous, incoming, connection, *, allow_single_stock_edit=False, account_id=LEGACY_ACCOUNT_ID, prices=None):
    """Validate new groups and assign their number inside the workspace transaction.

    Historical rows without invoice metadata are left byte-for-byte equivalent.
    Existing invoices cannot be split or rewritten. Complete-group removal and a
    consistent customer name correction retain the existing owner editing paths.
    The inventory route may also correct a single purchase row after applying its
    quantity, linked-sale and customer-history guards; invoice identity stays fixed.
    """
    previous_by_id = {str(row["id"]): row for row in previous}
    for row in incoming:
        old = previous_by_id.get(str(row["id"]))
        if old and old.get("type") == "misc-purchase":
            if row.get("type") != old["type"] or row.get("category") != old["category"]:
                invoice_error("نوع خرید طلای متفرقه پس از ثبت قابل تغییر نیست.", 409)
            protected = ECONOMIC_FIELDS["crafted"] | {"weight750", "itemWeight", "amount", "currentAmount", "profitPercent", "gramPrice"}
            if not allow_single_stock_edit and any(values_differ(field, old.get(field), row.get(field)) for field in protected):
                invoice_error("مشخصات خرید طلای متفرقه را از بخش اصلاح موجودی تغییر دهید.", 409)
    incoming = [normalize_misc_purchase(row, prices) if str(row["id"]) not in previous_by_id else row for row in incoming]
    incoming_by_id = {str(row["id"]): row for row in incoming}
    existing = invoice_groups(previous)
    groups = invoice_groups(incoming)
    for transaction, old_rows in existing.items():
        rows = groups.get(transaction, [])
        if not rows and not any(str(row["id"]) in incoming_by_id for row in old_rows) and not any(row.get("transactionId") == transaction for row in incoming):
            continue
        if {str(row["id"]) for row in rows} != {str(row["id"]) for row in old_rows}:
            invoice_error("ردیف‌های فاکتور ثبت‌شده قابل حذف یا جابه‌جایی مستقل نیستند.", 409)
        for old in old_rows:
            updated = incoming_by_id[str(old["id"])]
            editable = {"customerName"}
            if allow_single_stock_edit and old.get("counterpartyType") == "partner" and is_stock_entry(old):
                editable |= TEXT_FIELDS | {"itemSummary"}
            if allow_single_stock_edit and len(old_rows) == 1 and is_stock_entry(old):
                editable |= TEXT_FIELDS | ECONOMIC_FIELDS[old["category"]] | {"itemSummary", "amount", "currentAmount", "itemWeight", "weight750"}
            if {key: value for key, value in old.items() if key not in editable} != {key: value for key, value in updated.items() if key not in editable}:
                invoice_error("فاکتور ثبت‌شده قابل تغییر جزئی نیست؛ همهٔ ردیف‌های آن محفوظ می‌مانند.", 409)
        validate_group(rows)

    previous_transactions = {row.get("transactionId") for row in previous if isinstance(row.get("transactionId"), str)}
    previous_number = max((int(value) for row in previous if (value := number(row.get("invoiceNumber"))) > 0 and value <= MAX_SAFE_INTEGER and value == value.to_integral_value()), default=0)
    new_transactions = []
    new_rows = []
    for transaction, rows in groups.items():
        if transaction in existing:
            continue
        if transaction in previous_transactions or any(str(row["id"]) in previous_by_id for row in rows):
            invoice_error("فاکتور جدید باید شناسه و ردیف‌های جدید داشته باشد.", 409)
        validate_group(rows)
        new_transactions.append(transaction)
        new_rows.extend(rows)

    for row in incoming:
        if str(row["id"]) not in previous_by_id and "invoiceVersion" not in row and (INVOICE_FIELDS | SETTLEMENT_FIELDS).intersection(row):
            invoice_error("اطلاعات فاکتور ناقص است.")
        transaction = row.get("transactionId")
        if isinstance(transaction, str) and transaction in groups and "invoiceVersion" not in row:
            invoice_error("همهٔ ردیف‌های فاکتور باید مشخصات مشترک داشته باشند.")

    guard_invoice_stock(incoming, new_rows)
    # Keep the high watermark even when an entire old invoice is explicitly removed.
    removed_rows = previous_number and any(str(row["id"]) not in incoming_by_id for row in previous)
    last_number = reserve_invoice_numbers(connection, previous_number, len(new_transactions), account_id) if new_transactions or removed_rows else previous_number
    assigned = {transaction: last_number - len(new_transactions) + index + 1 for index, transaction in enumerate(new_transactions)}
    return [{**row, "invoiceNumber": assigned[row["transactionId"]], "customerName": row["customerName"].strip()}
        if row.get("invoiceVersion") == 1 and row.get("transactionId") in assigned else row for row in incoming]
