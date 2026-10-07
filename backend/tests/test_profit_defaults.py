import pytest

from test_api import client, login, seed
from test_inventory_create import submit
from test_inventory_management import save_data


PROFITS = [({}, 7), ({"profitPercent": None}, 7), ({"profitPercent": ""}, 7),
    ({"profitPercent": " \t\n"}, 7), ({"profitPercent": 0}, 0), ({"profitPercent": "۰"}, 0),
    ({"profitPercent": 12}, 12), ({"profitPercent": "۸٫۵"}, 8.5)]


@pytest.mark.parametrize("changes,expected_profit", PROFITS)
def test_manual_crafted_profit_defaults_and_explicit_values_price_both_amounts(client, changes, expected_profit):
    headers = login(client)
    save_data(client, headers, [], prices={"goldGramPrice": "200000"})
    item = {"category": "crafted", "craftedKind": "انگشتر", "itemName": "انگشتر تازه", "weight": 2,
        "gramPrice": "100000", "wagePercent": 10, "wageFixed": 1000, "otherCosts": 2000, **changes}
    response = submit(client, headers, item)
    assert response.status_code == 201, response.text
    workspace = response.json()["data"]
    document = workspace["documents"][0]
    assert float(document["profitPercent"]) == expected_profit
    assert document["amount"] == pytest.approx(223000 * (1 + expected_profit / 100))
    assert document["currentAmount"] == pytest.approx(443000 * (1 + expected_profit / 100))
    assert workspace["openingSetup"]["totalValue"] == document["amount"]


@pytest.mark.parametrize("value", ["invalid", "NaN", -1, 101, [], True])
def test_invalid_crafted_profit_is_rejected_without_silent_default(client, value):
    headers = login(client)
    historical = seed(client, headers)
    item = {"category": "crafted", "craftedKind": "انگشتر", "itemName": "انگشتر", "weight": 1,
        "gramPrice": 100000, "profitPercent": value}
    assert submit(client, headers, item).status_code == 422
    assert client.get("/api/owner/workspace").json() == historical
