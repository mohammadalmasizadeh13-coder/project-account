"""Optional customer identity and payment notes captured with a document."""
from datetime import date, datetime

from fastapi import HTTPException

from .inventory import TEHRAN_ZONE
from .pricing import TRANSLATION

CUSTOMER_SNAPSHOT_FIELDS = {
    "customerPhone": "phone",
    "customerBirthDate": "birthDate",
    "customerAddress": "address",
    "customerNationalId": "nationalId",
}
DOCUMENT_DETAIL_FIELDS = {*CUSTOMER_SNAPSHOT_FIELDS, "paymentMethod"}


def normalize_customer_detail(field, value):
    if value is None:
        return ""
    maximum = 5000 if field in {"address", "customerAddress", "paymentMethod"} else 100
    if not isinstance(value, str) or len(value) > maximum:
        raise HTTPException(422, "مشخصات مشتری یا متن نحوه پرداخت معتبر نیست.")
    value = value.strip()
    if field in {"nationalId", "customerNationalId"} and value:
        value = value.translate(TRANSLATION)
        if len(value) != 10 or not value.isascii() or not value.isdigit():
            raise HTTPException(422, "کد ملی مشتری باید ۱۰ رقم باشد.")
    if field in {"birthDate", "customerBirthDate"} and value:
        try:
            if len(value) != 10:
                raise ValueError()
            parsed = date.fromisoformat(value)
            if parsed.isoformat() != value or parsed > datetime.now(TEHRAN_ZONE).date():
                raise ValueError()
        except ValueError:
            raise HTTPException(422, "تاریخ تولد مشتری معتبر نیست.")
    return value


def guard_customer_details(previous, incoming, *, documents=False):
    """Validate new/changed fields without rewriting historical customer records."""
    previous_by_id = {str(row.get("id")): row for row in previous}
    fields = DOCUMENT_DETAIL_FIELDS if documents else set(CUSTOMER_SNAPSHOT_FIELDS.values())
    for row in incoming:
        old = previous_by_id.get(str(row.get("id")), {})
        for field in fields.intersection(row):
            if field not in old or row[field] != old[field]:
                row[field] = normalize_customer_detail(field, row[field])


def document_detail_header(row):
    return tuple(row.get(field) or "" for field in sorted(DOCUMENT_DETAIL_FIELDS))
