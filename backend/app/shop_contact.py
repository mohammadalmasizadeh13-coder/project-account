"""Public shop contact details, stored independently from the accounting ledger."""
import re

from fastapi import Depends
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import CheckConstraint, Column, Integer, String, Table, Text, select, update
from sqlalchemy.exc import IntegrityError

from .database import metadata
from .security import require_storefront, require_storefront_mutation


shop_contact = Table("noor_shop_contact", metadata,
    Column("id", Integer, primary_key=True),
    Column("phone", String(16), nullable=False),
    Column("address", Text, nullable=False),
    Column("hours", String(200), nullable=False),
    CheckConstraint("id = 1", name="shop_contact_singleton"))

DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
EMPTY_CONTACT = {"phone": "", "address": "", "hours": ""}


class ShopContactInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    phone: str = Field(max_length=50)
    address: str = Field(max_length=1000)
    hours: str = Field(default="", max_length=200)

    @field_validator("phone")
    @classmethod
    def clean_phone(cls, value):
        normalized = re.sub(r"[\s()\-]", "", value.translate(DIGITS))
        if not re.fullmatch(r"\+?[0-9]{8,15}", normalized):
            raise ValueError("شماره تماس باید بین ۸ تا ۱۵ رقم باشد.")
        return normalized

    @field_validator("address")
    @classmethod
    def clean_address(cls, value):
        normalized = value.strip()
        if len(normalized) < 5:
            raise ValueError("نشانی فروشگاه باید حداقل ۵ نویسه باشد.")
        return normalized

    @field_validator("hours")
    @classmethod
    def clean_hours(cls, value):
        return value.strip()


def register_shop_contact_routes(application):
    engine = application.state.engine

    def read_contact():
        with engine.connect() as connection:
            row = connection.execute(select(shop_contact).where(shop_contact.c.id == 1)).mappings().first()
        return {key: row[key] for key in EMPTY_CONTACT} if row else dict(EMPTY_CONTACT)

    @application.get("/api/public/contact")
    def public_contact():
        return read_contact()

    @application.get("/api/owner/contact", dependencies=[Depends(require_storefront)])
    def owner_contact():
        return read_contact()

    @application.put("/api/owner/contact", dependencies=[Depends(require_storefront_mutation)])
    def save_contact(payload: ShopContactInput):
        values = payload.model_dump()
        with engine.begin() as connection:
            result = connection.execute(update(shop_contact).where(shop_contact.c.id == 1).values(**values))
            if not result.rowcount:
                # Concurrent first saves cannot create duplicate settings or partially save fields.
                try:
                    with connection.begin_nested():
                        connection.execute(shop_contact.insert().values(id=1, **values))
                except IntegrityError:
                    connection.execute(update(shop_contact).where(shop_contact.c.id == 1).values(**values))
        return values
