import test from 'node:test';
import assert from 'node:assert/strict';
import { groupInvoices, invoiceItemName } from './invoices.js';

test('mixed gold, coin and crafted rows become one ordered invoice with one combined balance', () => {
  const common = { transactionId: 'mixed-sale', invoiceVersion: 1, invoiceLineCount: 3, invoiceNumber: 180, customerId: 'customer', customerName: 'مشتری آزمون', date: '2026-09-27', recordedAt: '2026-09-27T12:00:00Z', direction: 'فروش' };
  const documents = [
    { ...common, id: 'bracelet', invoiceLine: 3, category: 'crafted', itemName: 'النگو', amount: 850, gramDebt: 0, rialDebt: 0 },
    { ...common, id: 'melted', invoiceLine: 1, category: 'melted', amount: 1200, gramDebt: '۰٫۲', rialDebt: '۱٬۰۰۰' },
    { ...common, id: 'coin', invoiceLine: 2, category: 'coin', amount: 500, gramDebt: 0, rialDebt: 0 },
  ];
  const before = structuredClone(documents);
  const invoices = groupInvoices(documents);
  assert.equal(invoices.length, 1);
  assert.deepEqual(invoices[0].rows.map(row => row.id), ['melted', 'coin', 'bracelet']);
  assert.equal(invoices[0].number, 180);
  assert.equal(invoices[0].amount, 2550);
  assert.equal(invoices[0].rialDebt, 1000);
  assert.equal(invoices[0].gramDebt, 0.2);
  assert.equal(invoices[0].customerName, 'مشتری آزمون');
  assert.equal(invoices[0].recordedAt, common.recordedAt);
  assert.deepEqual(documents, before);
});

test('existing sets group by transaction while separate sales and legacy records stay separate', () => {
  const documents = [
    { id: 'set-necklace', setId: 'one-set', transactionId: 'set-purchase', amount: 100, type: 'crafted-purchase' },
    { id: 'legacy-sale', amount: 30, type: 'coin-sale' },
    { id: 'set-bracelet', setId: 'one-set', transactionId: 'set-purchase', amount: 150, type: 'crafted-purchase' },
    { id: 'piece-sale', setId: 'one-set', transactionId: 'separate-sale', amount: 200, type: 'crafted-sale' },
    { amount: 10 }, { amount: 20 },
  ];
  const invoices = groupInvoices(documents);
  assert.equal(invoices.length, 5);
  assert.deepEqual(invoices.map(invoice => invoice.amount), [250, 30, 200, 10, 20]);
  assert.deepEqual(invoices[0].rows.map(row => row.id), ['set-necklace', 'set-bracelet']);
  assert.equal(invoices[0].direction, 'خرید');
  assert.equal(invoices[1].direction, 'فروش');
  assert.equal(invoices[1].number, 'acy-sale');
});

test('invoice totals retain recorded zero and parse Persian amounts, falling back to original rates only', () => {
  const common = { category: 'crafted', type: 'crafted-sale', itemCount: 1, weight: 2, gramPrice: 100, ayar: 750, profitPercent: 7, currentAmount: 999999 };
  const invoices = groupInvoices([
    { ...common, id: 'zero', amount: 0 },
    { ...common, id: 'persian', amount: '۱٬۵۰۰' },
    { ...common, id: 'missing' },
    { id: 'cost', type: 'expense', expenseUnit: 'rial', expenseAmount: 500 },
  ]);
  assert.deepEqual(invoices.map(invoice => invoice.amount), [0, 1500, 214, 50]);
});

test('invoice descriptions use saved names, linked inventory names and legacy category details', () => {
  assert.equal(invoiceItemName({ itemName: 'نام ثبت‌شده' }, { itemName: 'نام جدید' }), 'نام ثبت‌شده');
  assert.equal(invoiceItemName({ description: 'فروش' }, { itemName: 'النگوی قدیمی' }), 'النگوی قدیمی');
  assert.equal(invoiceItemName({ category: 'coin', coinType: 'امامی' }), 'سکه امامی');
  assert.equal(invoiceItemName({ category: 'currency', currencyType: 'USD' }), 'دلار آمریکا');
  assert.deepEqual(groupInvoices([]), []);
  assert.equal(invoiceItemName({ type: 'misc-purchase', category: 'crafted', craftedKind: 'سایر' }), 'طلای متفرقه');
});
