import test from 'node:test';
import assert from 'node:assert/strict';
import { invoiceSettlement } from './invoiceSettlement.js';
import { expandInvoiceDraft } from './invoiceDraft.js';
import { groupInvoices } from './invoices.js';

const gold = { category: 'crafted', type: 'crafted-sale', itemCount: 2, weight: 2.5, ayar: 750, gramPrice: 6000000, wagePercent: 10, wageFixed: 100000, profitPercent: 7, discountRial: 524000 };

test('partial cash settles combined weights, percentage and fixed wage, profit and discount into gold once', () => {
  const rows = [gold, { category: 'coin', type: 'coin-sale', coinCount: 1, coinPrice: 10000000, wagePercent: 0, profitPercent: 0 }];
  const result = invoiceSettlement(rows, '۳۸٬۰۰۰٬۰۰۰', '۶٬۰۰۰٬۰۰۰');
  assert.deepEqual(result.errors, {});
  assert.deepEqual(result.amounts, [35000000, 10000000]);
  assert.equal(result.total, 45000000);
  assert.equal(result.cashPaid, 38000000);
  assert.equal(result.settlementRemainder, 7000000);
  assert.equal(result.gramDebt, 1.166667);
  assert.equal(result.rialDebt, 0);
});

test('cash must be explicitly entered, supports zero/full payment and rejects overpayment or malformed values', () => {
  for (const cash of ['', null, undefined, 'bad', '-1', '1.2', Infinity]) assert.ok(invoiceSettlement([gold], cash, 6000000).errors.cashPaid);
  const unpaid = invoiceSettlement([gold], '۰', 6000000);
  assert.equal(unpaid.settlementRemainder, 35000000);
  assert.equal(unpaid.gramDebt, 5.833333);
  const paid = invoiceSettlement([gold], '35000000', 6000000);
  assert.equal(paid.gramDebt, 0);
  assert.equal(paid.settlementRemainder, 0);
  assert.ok(invoiceSettlement([gold], 35000001, 6000000).errors.cashPaid);
});

test('conversion requires a valid positive saved rate even for full cash payment', () => {
  for (const rate of ['', '0', -1, 'bad', Infinity, 1e13]) {
    assert.ok(invoiceSettlement([gold], 35000000, rate).errors.gold18Price);
  }
});

test('new sale money is rounded per line before summing and converting, including free discounted sale', () => {
  const rows = [{ category: 'currency', type: 'currency-sale', currencyAmount: 1, currencyRate: 10.5 }, { category: 'currency', type: 'currency-sale', currencyAmount: 1, currencyRate: 10.4 }];
  const result = invoiceSettlement(rows, 1, 10);
  assert.deepEqual(result.amounts, [11, 10]);
  assert.equal(result.total, 21);
  assert.equal(result.gramDebt, 2);
  const free = invoiceSettlement([{ ...gold, discountRial: 35524000 }], 0, 6000000);
  assert.deepEqual(free.errors, {});
  assert.equal(free.total, 0);
  assert.equal(free.gramDebt, 0);
});

test('large or invalid calculated amounts cannot be committed', () => {
  assert.ok(invoiceSettlement([{ ...gold, weight: 1e15 }], 0, 6000000).errors.invoiceRows);
  assert.ok(invoiceSettlement([], 0, 6000000).errors.invoiceRows);
});

test('draft expansion does not leak payment UI state or duplicate a settlement snapshot into item rows', () => {
  const rows = expandInvoiceDraft({ ...gold, cashPaid: 10, invoicePaymentStep: true, settlementVersion: 1, settlementGoldPrice: 10, settlementRemainder: 20, invoiceRows: [gold, gold], invoiceCurrentEmpty: true }, 6000000, 'group');
  assert.equal(rows.length, 2);
  for (const row of rows) for (const field of ['cashPaid', 'invoicePaymentStep', 'settlementVersion', 'settlementGoldPrice', 'settlementRemainder']) assert.ok(!(field in row), field);
});

test('grouped invoices retain their historical payment and rate without inventing payments for legacy invoices', () => {
  const [invoice] = groupInvoices([
    { ...gold, id: 'one', transactionId: 'group', amount: 35000000, invoiceLine: 1, settlementVersion: 1, cashPaid: 29000000, settlementGoldPrice: 6000000, settlementRemainder: 6000000, gramDebt: 1, rialDebt: 0 },
    { ...gold, id: 'two', transactionId: 'group', amount: 0, invoiceLine: 2, gramDebt: 0, rialDebt: 0 },
  ]);
  assert.equal(invoice.cashPaid, 29000000);
  assert.equal(invoice.settlementGoldPrice, 6000000);
  assert.equal(invoice.settlementRemainder, 6000000);
  assert.equal(invoice.gramDebt, 1);
  assert.ok(!('cashPaid' in groupInvoices([{ ...gold, id: 'old', amount: 35000000 }])[0]));
});
