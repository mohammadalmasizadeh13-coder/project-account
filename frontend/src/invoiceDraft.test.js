import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanInvoiceLine, expandInvoiceDraft, invoiceLineForms } from './invoiceDraft.js';
import { documentBreakdown } from './assets.js';
import { validateStockSales } from './inventory.js';
import { miscGoldDefaults, miscGoldWeight750 } from './miscGold.js';

const header = { customerId: 'customer-1', customerName: 'مشتری سند', date: '2026-09-27', gold18Price: '6000000', rialDebt: '200000', gramDebt: '1.5', note: 'تحویل حضوری' };
const crafted = { type: 'crafted-sale', category: 'crafted', itemName: 'النگو', craftedKind: 'النگو', itemCount: '1', weight: '2', ayar: '750', gramPrice: '6000000', wagePercent: '10', profitPercent: '', inventorySourceId: 'bangle' };
const coin = { type: 'coin-sale', category: 'coin', itemName: 'سکه', coinType: 'امامی', coinCount: '1', coinPrice: '60000000', profitPercent: '0', inventorySourceId: 'coin' };
const melted = { type: 'melted-sale', category: 'melted', itemName: 'آبشده', itemCount: '1', meltedWeight: '1', meltedAyar: '750', meltedGramPrice: '6000000', profitPercent: '0', inventorySourceId: 'melted' };

test('updated customer and payment header replaces stale row snapshots across the invoice', () => {
  const details = { customerPhone: '09123456789', customerBirthDate: '1991-03-22', customerAddress: 'تهران\nخیابان نمونه', customerNationalId: '0012345678', paymentMethod: 'کارت‌به‌کارت\nباقی‌مانده چک' };
  const draft = { ...header, ...details, invoiceRows: [{ ...crafted, customerNationalId: '1111111111', paymentMethod: 'قدیمی' }, coin], invoiceCurrentEmpty: true };
  const rows = expandInvoiceDraft(draft, '6000000', 'customer-details-invoice');
  assert.equal(rows.length, 2);
  for (const row of rows) for (const [field, value] of Object.entries(details)) assert.equal(row[field], value);
});

test('three mixed draft rows retain one header and apply debt once with the crafted profit default', () => {
  const draft = { ...header, invoiceRows: [crafted, coin, melted], invoiceCurrentEmpty: true, invoiceEditingIndex: -1 };
  const before = structuredClone(draft);
  const rows = expandInvoiceDraft(draft, '6000000', 'invoice-id');
  assert.deepEqual(rows.map(row => row.category), ['crafted', 'coin', 'melted']);
  assert.equal(rows[0].profitPercent, '7');
  assert.equal(rows.reduce((sum, row) => sum + documentBreakdown(row).total, 0), 80124000);
  assert.deepEqual(rows.map(row => Number(row.rialDebt)), [200000, 0, 0]);
  assert.deepEqual(rows.map(row => Number(row.gramDebt)), [1.5, 0, 0]);
  assert.ok(rows.every(row => row.customerId === header.customerId && row.date === header.date && row.note === header.note && row.transactionId === 'invoice-id'));
  assert.ok(rows.every(row => !('invoiceRows' in row)));
  assert.deepEqual(draft, before);
});

test('editing replaces a staged row in place, while a new in-progress row joins the final invoice', () => {
  const editing = { ...melted, ...header, invoiceRows: [crafted, coin], invoiceEditingIndex: 1, invoiceCurrentEmpty: false };
  assert.deepEqual(invoiceLineForms(editing).map(row => row.itemName), ['النگو', 'آبشده']);
  const next = { ...editing, invoiceEditingIndex: -1 };
  assert.deepEqual(invoiceLineForms(next).map(row => row.itemName), ['النگو', 'سکه', 'آبشده']);
  assert.equal(invoiceLineForms({ ...next, invoiceCurrentEmpty: true }).length, 2);
});

test('separate set pieces and a coin expand into one invoice without repeating header debts', () => {
  const set = { ...crafted, craftedKind: 'نیم‌ست', itemName: 'مجموعه', setMode: 'separate', setParts: [
    { ...crafted, id: 'part-1', craftedKind: 'النگو', itemName: 'قطعه اول', profitPercent: '0' },
    { ...crafted, id: 'part-2', craftedKind: 'انگشتر', itemName: 'قطعه دوم', inventorySourceId: 'ring', profitPercent: '9' },
  ] };
  const rows = expandInvoiceDraft({ ...header, invoiceRows: [set, coin], invoiceCurrentEmpty: true }, '6000000', 'one-invoice');
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(row => Number(row.rialDebt)), [200000, 0, 0]);
  assert.deepEqual(rows.map(row => row.profitPercent), ['0', '9', '0']);
  assert.equal(rows[0].setId, rows[1].setId);
  assert.ok(rows.every(row => row.transactionId === 'one-invoice'));
});

test('expanded duplicate stock picks cannot exceed one physical stock balance', () => {
  const stock = [{ ...crafted, id: 'bangle', type: 'crafted-purchase', itemCount: '1', date: '2026-09-26' }];
  const rows = expandInvoiceDraft({ ...header, invoiceRows: [crafted, crafted], invoiceCurrentEmpty: true }, '6000000');
  assert.match(validateStockSales(rows, stock), /موجودی/);
});

test('line snapshots remove nested drafts and saved identity while retaining financial fields', () => {
  const cleaned = cleanInvoiceLine({ ...crafted, id: 'old-id', amount: 99, invoiceRows: [coin], invoiceLine: 1, invoiceNumber: 180, transactionId: 'old-transaction', invoiceEditingIndex: 0 });
  assert.equal(cleaned.weight, '2');
  assert.ok(['id', 'amount', 'invoiceRows', 'invoiceLine', 'invoiceNumber', 'transactionId', 'invoiceEditingIndex'].every(key => !(key in cleaned)));
});

test('misc purchase remains its own document type and prices the actual lower purity gold with no labor or default profit', () => {
  const draft = { ...miscGoldDefaults(), ...header, type: 'misc-purchase', itemName: 'طلای دست دوم',
    weight: '۱۰', ayar: '۷۴۰', gramPrice: '6000000', profitPercent: '',
    wagePercent: '10', wageFixed: '100', otherCosts: '25', invoiceRows: [], invoiceCurrentEmpty: false,
  };
  const before = structuredClone(draft);
  const rows = expandInvoiceDraft(draft, '6000000', 'misc-invoice');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, 'misc-purchase');
  assert.equal(rows[0].category, 'crafted');
  assert.equal(rows[0].weight, '۱۰');
  assert.equal(rows[0].ayar, '۷۴۰');
  assert.equal(rows[0].profitPercent, '0');
  assert.equal(rows[0].wagePercent, '0');
  assert.equal(rows[0].wageFixed, '0');
  assert.equal(documentBreakdown(rows[0]).total, miscGoldWeight750(rows[0]) * 6000000 + 25);
  assert.deepEqual(draft, before);
});
