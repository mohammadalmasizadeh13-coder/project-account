"""User-entered transaction time, independent of the audit creation timestamp."""
import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

try:
    TEHRAN_ZONE = ZoneInfo("Asia/Tehran")
except ZoneInfoNotFoundError:
    TEHRAN_ZONE = timezone(timedelta(hours=3, minutes=30), name="Asia/Tehran")


def validate_invoice_time(value):
    if not isinstance(value, str) or value and not re.fullmatch(r"(?:[01][0-9]|2[0-3]):[0-5][0-9]", value):
        raise ValueError("ساعت فاکتور باید به صورت ساعت و دقیقه باشد.")
    return value


def ledger_clock(entry):
    return entry.get("invoiceTime") or datetime.fromisoformat(entry["createdAt"].replace("Z", "+00:00")).astimezone(TEHRAN_ZONE).strftime("%H:%M:%S.%f")
