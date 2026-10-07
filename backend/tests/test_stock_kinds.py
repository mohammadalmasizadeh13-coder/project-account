import pytest

from app.catalog import CRAFTED_KINDS, crafted_kind_for


@pytest.mark.parametrize("kind", CRAFTED_KINDS)
def test_twelve_standard_kinds_are_preserved(kind):
    assert crafted_kind_for({"craftedKind": kind, "itemName": "انگشتر متفاوت"}) == kind


@pytest.mark.parametrize("source,expected", [
    ({"craftedKind": "نیم ست"}, "نیم‌ست"),
    ({"itemName": "حلقه نور"}, "انگشتر"),
    ({"description": "زنجير خرید خصوصی"}, "زنجیر"),
    ({"itemName": "گردنبند", "description": "النگوی قدیمی"}, "گردنبند"),
    ({"itemName": "ست طلا"}, "ست"),
    ({"itemName": "شماره نامشخص"}, "سایر"),
])
def test_safe_kind_classification(source, expected):
    assert crafted_kind_for(source) == expected


