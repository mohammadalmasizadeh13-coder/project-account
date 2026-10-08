import test from 'node:test';
import assert from 'node:assert/strict';
import { documentBreakdown, number } from './assets.js';
import { validateDocument } from './documentValidation.js';
import { invoiceSettlement } from './invoiceSettlement.js';
import { expandInvoiceDraft } from './invoiceDraft.js';
import { createSetPart, expandSetForm, validateSetForm } from './jewelrySets.js';
import { stockSaleForm } from './inventory.js';
import { customerAnalytics } from './crmAnalytics.js';
import { profitReport } from './workspace.js';

const sale = { id: 'sale', type: 'crafted-sale', category: 'crafted', date: '2026-10-08',
  customerId: 'customer', customerName: 'مشتری', craftedKind: 'انگشتر', itemName: 'انگشتر',
  itemCount: 2, weight: 2, ayar: 750, gramPrice: 100, gold18Price: 100,
  wagePercent: 10, wageFixed: 5, otherCosts: 3, profitPercent: 5 };
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('percentage discounts cover gross including labor, costs and profit and combine with fixed discounts', () => {
  const row = { ...sale, discountPercent: '۱۲٫۵', discountRial: '۱۰' };
  const breakdown = documentBreakdown(row);
  assert.equal(breakdown.base, 400);
  assert.equal(breakdown.wage, 50);
  assert.equal(breakdown.costs, 6);
  assert.equal(breakdown.profit, 22.8);
  close(breakdown.discount, 69.85);
  close(breakdown.total, 408.95);
  assert.deepEqual(validateDocument(row, 'crafted', number), {});
  assert.equal(documentBreakdown({ ...row, type: 'crafted-purchase' }).discount, 0);
  close(documentBreakdown({ ...sale, discountRial: 10 }).total, 468.8);
});

test('all sale categories apply percentages and settle rounded amounts before gold conversion', () => {
  const rows = [
    { type: 'crafted-sale', category: 'crafted', itemCount: 2, weight: 1, ayar: 750, gramPrice: 100 },
    { type: 'melted-sale', category: 'melted', itemCount: 1, meltedWeight: 2.5, meltedAyar: 600, meltedGramPrice: 100 },
    { type: 'coin-sale', category: 'coin', coinCount: 2, coinType: 'پارسیان', parsianPrice: 100 },
    { type: 'currency-sale', category: 'currency', currencyAmount: 2.5, currencyRate: 80 },
  ].map(row => ({ ...row, discountPercent: '12.5', discountRial: 0.5 }));
  for (const row of rows) assert.equal(documentBreakdown(row).total, 174.5);
  const settlement = invoiceSettlement(rows, 100, 100);
  assert.deepEqual(settlement.errors, {});
  assert.deepEqual(settlement.amounts, [175, 175, 175, 175]);
  assert.equal(settlement.total, 700);
  assert.equal(settlement.gramDebt, 6);
});

test('optional percentages include zero and 100 but reject invalid percentages and combined over-discounts', () => {
  for (const discountPercent of [undefined, null, '', '۰', '١٢٫٥', 100]) {
    assert.deepEqual(validateDocument({ ...sale, discountPercent }, 'crafted', number), {});
  }
  for (const discountPercent of [-1, '۱۰۱', '100.00001', 'abc', 'Infinity', '1e999']) {
    assert.ok(validateDocument({ ...sale, discountPercent }, 'crafted', number).discountPercent, String(discountPercent));
  }
  const free = { ...sale, discountPercent: 100 };
  assert.equal(documentBreakdown(free).total, 0);
  assert.equal(invoiceSettlement([free], 0, 100).gramDebt, 0);
  const errors = validateDocument({ ...free, discountRial: 1 }, 'crafted', number);
  assert.match(errors.discountRial, /پیش از تخفیف/);
  assert.ok(errors.discountPercent);
  assert.ok(validateDocument({ ...sale, discountPercent: 10, discountRial: 'bad' }, 'crafted', number).discountRial);
  assert.deepEqual(validateDocument({ ...sale, discountPercent: 50, discountRial: 239.4 }, 'crafted', number), {});
});

test('invoice drafts and separate set pieces preserve independent percentages while fresh stock picks reset them', () => {
  const parts = [createSetPart({ ...sale, id: 'part-one', discountPercent: '10' }), createSetPart({ ...sale, id: 'part-two', discountPercent: '20' })];
  const form = { ...sale, craftedKind: 'نیم‌ست', setMode: 'separate', setParts: parts, discountPercent: '90' };
  const rows = expandSetForm(form);
  assert.deepEqual(rows.map(row => row.discountPercent), ['10', '20']);
  assert.deepEqual(validateSetForm(form), {});
  assert.ok(validateSetForm({ ...form, setParts: [{ ...parts[0], discountPercent: 101 }, parts[1]] })['setParts.part-one.discountPercent']);
  const invoice = expandInvoiceDraft({ ...sale, invoiceRows: [{ ...sale, discountPercent: 5 }, form], invoiceCurrentEmpty: true }, 100, 'invoice');
  assert.deepEqual(invoice.map(row => row.discountPercent), [5, '10', '20']);
  assert.equal(stockSaleForm({ ...sale, type: 'crafted-purchase' }, { discountPercent: '50', discountRial: 10 }).discountPercent, '');
});

test('customer and profit reports include both discount components using historical rates', () => {
  const row = { ...sale, discountPercent: 12.5, discountRial: 10, amount: 409, currentAmount: 99999 };
  const customer = customerAnalytics({ id: 'customer', name: 'مشتری' }, [row], { today: sale.date });
  close(customer.discounts, 69.85);
  assert.equal(customer.purchased, 409);
  const profit = profitReport([row], 'today', sale.date);
  close(profit.discounts, 69.85);
  close(profit.netSellerProfit, -47.05);
});
