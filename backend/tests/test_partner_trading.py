from uuid import uuid4

import pytest

from app.catalog import stock_entries
from test_api import client, login
from test_partners import create_partner


def operation(client, headers, identifier, kind="trade", lines=None, **changes):
    body = {"revision": client.get('/api/owner/workspace').json()['revision'], "requestId": str(uuid4()),
        "date": "2026-10-11", "kind": kind, "lines": lines or [
            {"category": "melted", "direction": "purchase", "quantity": 10, "rate": 43318000}], **changes}
    return client.post(f'/api/owner/partners/{identifier}/operations', json=body, headers=headers), body


def setup(client):
    headers = login(client)
    created, _ = create_partner(client, headers)
    return headers, created['createdId']


@pytest.mark.parametrize('cash,expected', [(0, 100000000), (25000000, 75000000), (100000000, 0)])
def test_trade_keeps_gold_claim_when_cash_paid_and_replays(client, cash, expected):
    headers, identifier = setup(client)
    result, body = operation(client, headers, identifier, cashAmount=cash)
    assert result.status_code == 201, result.text
    data = result.json()['data']
    partner = data['partners'][0]
    assert (partner['goldBalance'], partner['tomanBalance']) == (-10, expected)
    assert data['documents'] == []
    assert partner['entries'][0]['lines'][0]['rate'] == 43318000
    replay = client.post(f'/api/owner/partners/{identifier}/operations', json=body, headers=headers)
    assert replay.status_code == 200 and replay.json()['revision'] == result.json()['revision']
    workspace = client.get('/api/owner/workspace').json()
    assert workspace['data']['partners'] == data['partners']


def test_cash_input_sale_and_independent_coin_currency_netting(client):
    headers, identifier = setup(client)
    lines = [
        {"category": "melted", "direction": "sale", "inputMode": "amount", "amount": 50000000, "rate": 43318000},
        {"category": "coin", "coinType": "تمام عادی", "direction": "purchase", "quantity": 2, "rate": 100000000},
        {"category": "coin", "coinType": "تمام عادی", "direction": "sale", "quantity": 1, "rate": 110000000},
        {"category": "currency", "currencyType": "IQD", "direction": "purchase", "quantity": 100000, "rate": 70}]
    result, _ = operation(client, headers, identifier, lines=lines, cashAmount=10000000, cashDirection='receive')
    assert result.status_code == 201, result.text
    record = result.json()['data']['partners'][0]
    assert (record['goldBalance'], record['tomanBalance']) == (5, 57000000)
    assert record['assetBalances'] == {'coin:تمام عادی:8.133:900': -1, 'currency:IQD': -100000}
    assert not result.json()['data']['documents']


def test_physical_receipt_assay_delivery_and_reversal_are_atomic(client):
    headers, identifier = setup(client)
    trade, _ = operation(client, headers, identifier, cashAmount=100000000)
    assert trade.status_code == 201, trade.text
    line = {'category': 'melted', 'direction': 'receive', 'meltedWeight': 10, 'meltedAyar': 750, 'rate': 43318000,
        'assayCode': '12345', 'laboratoryName': 'آزمایشگاه تهران'}
    invalid, _ = operation(client, headers, identifier, kind='delivery', lines=[{**line, 'assayCode': ''}])
    assert invalid.status_code == 422
    assert client.get('/api/owner/workspace').json()['revision'] == trade.json()['revision']
    received, _ = operation(client, headers, identifier, kind='delivery', lines=[line])
    assert received.status_code == 201, received.text
    data = received.json()['data']
    assert (data['partners'][0]['goldBalance'], data['partners'][0]['tomanBalance']) == (0, 0)
    stock = data['documents'][0]
    assert stock['assayCode'] == '12345' and stock['partnerOperation']
    assert stock_entries(data['documents'])[stock['id']]['remaining'] == 1
    paid, _ = operation(client, headers, identifier, kind='delivery', lines=[
        {'category': 'melted', 'direction': 'pay', 'quantity': 1, 'inventorySourceId': stock['id']}])
    assert paid.status_code == 201, paid.text
    assert paid.json()['data']['partners'][0]['goldBalance'] == -10
    assert stock_entries(paid.json()['data']['documents'])[stock['id']]['remaining'] == 0
    path = f'/api/owner/partners/{identifier}/operations/'
    blocked = client.request('DELETE', path + received.json()['createdId'], headers=headers,
        json={'revision': paid.json()['revision'], 'requestId': str(uuid4())})
    assert blocked.status_code == 409, blocked.text
    removed = client.request('DELETE', path + paid.json()['createdId'], headers=headers,
        json={'revision': paid.json()['revision'], 'requestId': str(uuid4())})
    assert removed.status_code == 200, removed.text
    assert stock_entries(removed.json()['data']['documents'])[stock['id']]['remaining'] == 1
    undone = client.request('DELETE', path + received.json()['createdId'], headers=headers,
        json={'revision': removed.json()['revision'], 'requestId': str(uuid4())})
    assert undone.status_code == 200, undone.text
    assert undone.json()['data']['documents'] == []
    assert undone.json()['data']['partners'][0]['goldBalance'] == -10


def test_offset_only_selected_balances_at_explicit_rates_and_can_be_undone(client):
    headers, identifier = setup(client)
    result, _ = operation(client, headers, identifier)
    assert result.status_code == 201
    lines = [{'asset': 'gold', 'quantity': 3, 'rate': 11000000}, {'asset': 'toman', 'quantity': 33000000, 'rate': 1}]
    result, _ = operation(client, headers, identifier, kind='offset', lines=lines)
    assert result.status_code == 201, result.text
    record = result.json()['data']['partners'][0]
    assert (record['goldBalance'], record['tomanBalance']) == (-7, 67000000)
    assert not result.json()['data']['documents']
    invalid, _ = operation(client, headers, identifier, kind='offset', lines=[
        {'asset': 'gold', 'quantity': 8, 'rate': 1000000}, {'asset': 'toman', 'quantity': 8000000}])
    assert invalid.status_code == 409
    unequal, _ = operation(client, headers, identifier, kind='offset', lines=[lines[0], {**lines[1], 'quantity': 33000001}])
    assert unequal.status_code == 422
    assert client.get('/api/owner/workspace').json()['revision'] == result.json()['revision']


@pytest.mark.parametrize('line,key', [
    ({'category': 'currency', 'currencyType': 'IQD', 'quantity': 250000, 'rate': 70}, 'currency:IQD'),
    ({'category': 'coin', 'coinType': 'گل رز', 'coinWeight': .3, 'coinAyar': 999.9, 'quantity': 2, 'rate': 4000000}, 'coin:گل رز:0.3:999.9'),
    ({'category': 'coin', 'coinType': 'امامی بانکی ۸۶', 'quantity': 2, 'rate': 100000000}, 'coin:امامی بانکی ۸۶:0:0')])
def test_coin_currency_delivery_clears_only_asset_balance(client, line, key):
    headers, identifier = setup(client)
    trade, _ = operation(client, headers, identifier, lines=[{**line, 'direction': 'purchase'}])
    assert trade.status_code == 201, trade.text
    received, _ = operation(client, headers, identifier, kind='delivery', lines=[{**line, 'direction': 'receive'}])
    assert received.status_code == 201, received.text
    record = received.json()['data']['partners'][0]
    assert record['assetBalances'][key] == 0
    assert record['tomanBalance'] == line['quantity'] * line['rate']
    assert len(received.json()['data']['documents']) == 1


def test_trade_edit_delete_and_market_repricing_preserve_agreed_accounts(client):
    headers, identifier = setup(client)
    result, body = operation(client, headers, identifier, cashAmount=25000000)
    original = result.json()['data']['partners'][0]['entries'][0]
    rates = client.put('/api/owner/workspace', json={'revision': result.json()['revision'],
        'data': {'prices': {'goldGramPrice': '20000000', 'iqdPrice': '150'}}}, headers=headers)
    assert rates.status_code == 200, rates.text
    assert rates.json()['data']['partners'][0]['entries'][0] == original
    path = f'/api/owner/partners/{identifier}/operations/{original["id"]}'
    edited = client.patch(path, json={**body, 'revision': rates.json()['revision'], 'requestId': str(uuid4()), 'cashAmount': 100000000}, headers=headers)
    assert edited.status_code == 200, edited.text
    entry = edited.json()['data']['partners'][0]['entries'][0]
    assert [entry[key] for key in ('id', 'invoiceNumber', 'transactionId', 'createdAt')] == [original[key] for key in ('id', 'invoiceNumber', 'transactionId', 'createdAt')]
    assert (entry['goldBalance'], entry['tomanBalance']) == (-10, 0)
    stale = client.request('DELETE', path, json={'revision': rates.json()['revision'], 'requestId': str(uuid4())}, headers=headers)
    assert stale.status_code == 409
    removed = client.request('DELETE', path, json={'revision': edited.json()['revision'], 'requestId': str(uuid4())}, headers=headers)
    assert removed.status_code == 200
    record = removed.json()['data']['partners'][0]
    assert not record['entries'] and record['goldBalance'] == record['tomanBalance'] == 0


def test_receipt_edit_preserves_code_even_after_new_lots_and_sales(client):
    headers, identifier = setup(client)
    line = {'category': 'currency', 'currencyType': 'IQD', 'direction': 'receive', 'quantity': 10000, 'rate': 70}
    result, body = operation(client, headers, identifier, kind='delivery', lines=[line])
    assert result.status_code == 201
    original = result.json()['data']['documents'][0]
    later, _ = operation(client, headers, identifier, kind='delivery', lines=[line])
    assert later.status_code == 201
    paid, _ = operation(client, headers, identifier, kind='delivery', lines=[{
        'category': 'currency', 'direction': 'pay', 'inventorySourceId': original['id'], 'quantity': 1000}])
    assert paid.status_code == 201
    path = f'/api/owner/partners/{identifier}/operations/{result.json()["createdId"]}'
    edited = client.patch(path, json={**body, 'revision': paid.json()['revision'], 'requestId': str(uuid4()), 'note': 'توضیح اصلاح‌شده'}, headers=headers)
    assert edited.status_code == 200, edited.text
    source = next(row for row in edited.json()['data']['documents'] if row['id'] == original['id'])
    assert source['productCode'] == original['productCode']
    changed = client.patch(path, json={**body, 'revision': edited.json()['revision'], 'requestId': str(uuid4()), 'lines': [{**line, 'quantity': 500}]}, headers=headers)
    assert changed.status_code in (409, 422)
    assert client.get('/api/owner/workspace').json()['revision'] == edited.json()['revision']


def test_delivery_requires_stock_permission_but_paper_trades_do_not(client):
    from test_accounts import create_staff, login_as, staff_browser
    headers, identifier = setup(client)
    user = create_staff(client, headers, permissions=['partners.write'])
    staff = staff_browser(client)
    staff_headers = login_as(staff, user['username'])
    result, _ = operation(staff, staff_headers, identifier)
    assert result.status_code == 201, result.text
    denied, _ = operation(staff, staff_headers, identifier, kind='delivery', lines=[{'category': 'toman', 'direction': 'pay', 'quantity': 100}])
    assert denied.status_code == 403
    receipt, _ = operation(client, headers, identifier, kind='delivery', lines=[{'category': 'toman', 'direction': 'pay', 'quantity': 100}])
    path = f'/api/owner/partners/{identifier}/operations/{receipt.json()["createdId"]}'
    denied = staff.request('DELETE', path, json={'revision': receipt.json()['revision'], 'requestId': str(uuid4())}, headers=staff_headers)
    assert denied.status_code == 403


def test_duplicate_outgoing_stock_lines_cannot_overspend(client):
    headers, identifier = setup(client)
    received, _ = operation(client, headers, identifier, kind='delivery', lines=[{'category': 'coin', 'coinType': 'تمام عادی', 'direction': 'receive', 'quantity': 2, 'rate': 100000000}])
    original = received.json()['data']['documents'][0]
    line = {'category': 'coin', 'direction': 'pay', 'inventorySourceId': original['id'], 'quantity': 2}
    rejected, _ = operation(client, headers, identifier, kind='delivery', lines=[line, line])
    assert rejected.status_code in (409, 422), rejected.text
    assert client.get('/api/owner/workspace').json()['data'] == received.json()['data']


def test_iraqi_dinar_customer_invoice_and_vault_support(client):
    from test_invoices import invoice, save
    from test_inventory_create import submit
    headers = login(client)
    row = invoice(('currency',))[0]
    row.update(currencyType='IQD', currencyAmount='100000', currencyRate='70', itemName='دینار عراق', gramDebt=0, rialDebt=0)
    saved = save(client, headers, [row])
    assert saved.status_code == 200, saved.text
    received = submit(client, headers, {'category': 'currency', 'currencyType': 'IQD', 'currencyAmount': 1000, 'currencyRate': 70, 'itemName': 'دینار عراق'})
    assert received.status_code == 201, received.text
    assert received.json()['data']['documents'][0]['amount'] == 70000
