import test from 'node:test';
import assert from 'node:assert/strict';
import { craftedKind, customerAnalytics, customerRankingCsv, rankCustomers, sortPreferences } from './crmAnalytics.js';
import { stockSaleForm } from './inventory.js';

const today = '2026-09-24';
const customer = { id: 'a', name: 'مریم', followUpDate: today, rialDebt: 20 };
const sale = (id, changes = {}) => ({ id, customerId: 'a', customerName: 'نام قبلی', category: 'crafted', type: 'crafted-sale', date: today, itemName: 'النگو', itemCount: 1, weight: 2, ayar: 750, amount: 100, ...changes });
const report = (documents, person = customer, options = {}) => customerAnalytics(person, documents, { today, ...options });

test('preferences separate groups, coin variants, crafted kinds and products by counts and recorded amounts', () => {
  const docs = [sale('a', { itemCount: '۳', amount: 300, discountRial: 10 }), sale('b', { itemName: 'دست بند طرح جدید', itemCount: 1, amount: 500 }),
    sale('c', { category: 'coin', type: 'coin-sale', coinType: 'امامی بانکی ۸۶', coinCount: '۲', amount: 1000 }),
    sale('d', { category: 'coin', type: 'coin-sale', coinType: 'ربع سکه بانکی ۸۶', coinCount: 4, amount: 800 }),
    sale('e', { category: 'melted', type: 'melted-sale', itemCount: 1, meltedWeight: 10, meltedAyar: 780, amount: 600 }),
    sale('f', { category: 'currency', type: 'currency-sale', currencyType: 'USD', currencyAmount: 100.5, amount: 200, currentAmount: 999999 })];
  const row = report(docs);
  assert.equal(row.purchased, 3400);
  assert.equal(row.itemCount, 11);
  assert.equal(row.craftedQuantity, 4);
  assert.equal(row.goldGrams, 18.4);
  assert.equal(row.groups[0].key, 'coin');
  assert.equal(row.coins[0].label, 'امامی بانکی ۸۶');
  assert.equal(sortPreferences(row.coins, 'quantity')[0].label, 'ربع سکه بانکی ۸۶');
  assert.equal(row.crafted[0].label, 'دستبند');
  assert.equal(sortPreferences(row.crafted, 'quantity')[0].label, 'النگو');
  assert.equal(row.currencies[0].quantity, 100.5);
  assert.equal(row.groups.find(group => group.key === 'currency').quantity, 0);
  assert.equal(row.discounts, 10);
  assert.equal(row.averagePurchase, 3400 / 6);
});

test('purchases exclude supplier trades, opening stock, future/invalid dates, other customers and duplicate IDs', () => {
  const valid = sale('valid');
  const row = report([valid, valid, sale('purchase', { type: 'crafted-purchase' }), sale('opening', { source: 'opening-inventory' }),
    sale('future', { date: '2026-09-25' }), sale('invalid', { date: '2026-02-30' }), sale('wrong-id', { customerId: 'b', customerName: customer.name }),
    sale('legacy', { customerId: '', customerName: customer.name, amount: 30 })]);
  assert.equal(row.purchased, 130);
  assert.equal(row.invoices, 2);
  assert.equal(row.lastPurchase, today);
  assert.equal(row.followUpDue, true);
  assert.equal(row.debtor, true);
});

test('period boundaries and category filters preserve lifetime recency and do not change receipts by product category', () => {
  const person = { ...customer, settlements: [{ id: 'r', date: today, direction: 'received', rialAmount: 70, gramAmount: 0 }] };
  const docs = [sale('old', { date: '2026-08-25' }), sale('start', { date: '2026-08-26' }), sale('now'), sale('coin', { category: 'coin', type: 'coin-sale', coinCount: 2, amount: 400 })];
  const row = report(docs, person, { days: 30, category: 'crafted' });
  assert.equal(row.invoices, 2);
  assert.equal(row.purchased, 200);
  assert.equal(row.firstPurchase, '2026-08-25');
  assert.equal(row.purchaseDays, 3);
  assert.equal(row.segment, 'خریدار تکراری');
  assert.equal(report(docs, person, { days: 30, category: 'coin' }).received, 70);
});

test('cash receipt rankings use explicit receipts, excluding payouts, gold amounts, duplicate entries and future dates', () => {
  const receipt = { id: 'r', date: today, direction: 'received', rialAmount: '۱۰۰', gramAmount: 2 };
  const person = { ...customer, settlements: [receipt, receipt, { id: 'p', date: today, direction: 'paid', rialAmount: 40, gramAmount: 3 }, { id: 'future', date: '2026-09-25', direction: 'received', rialAmount: 10000 }, { id: 'old', date: '2020-01-01', direction: 'received', rialAmount: 50 }] };
  const row = report([sale('huge', { amount: 999999, rialDebt: 0 })], person, { days: 30 });
  assert.equal(row.received, 100);
  assert.equal(row.receivedGrams, 2);
  assert.equal(row.paid, 40);
  assert.equal(row.receiptCount, 1);
  assert.equal(report([sale('cash-assumed', { amount: 1000 })]).received, 0);
});

test('crafted kinds normalize Persian spellings, respect explicit stock metadata, and keep unknown names separate', () => {
  assert.equal(craftedKind({ itemName: 'دست‌بند' }), 'دستبند');
  assert.equal(craftedKind({ itemName: 'گردن بند طلا' }), 'گردنبند');
  assert.equal(craftedKind({ itemName: 'نيم ست' }), 'نیم‌ست');
  assert.equal(craftedKind({ itemName: 'مدل ۱۲۳' }), 'سایر');
  assert.equal(craftedKind({ itemName: 'مدل خاص', craftedKind: 'النگو' }), 'النگو');
  assert.equal(craftedKind({}, { craftedKind: 'گردنبند' }), 'گردنبند');
  const source = { id: 'stock', category: 'crafted', craftedKind: 'گردنبند', itemName: 'مدل خاص' };
  assert.equal(stockSaleForm(source, {}).craftedKind, 'گردنبند');
  assert.equal(report([source, sale('source-linked', { inventorySourceId: source.id, itemName: '' })]).crafted[0].label, 'گردنبند');
});

test('equivalent coin spelling merges but legacy coins are never relabelled as bank-86 coins', () => {
  const row = report([sale('a', { category: 'coin', coinType: 'امامي بانكي 86', coinCount: 1 }), sale('b', { category: 'coin', coinType: 'امامی بانکی ۸۶', coinCount: 2 }), sale('c', { category: 'coin', coinType: 'امامی', coinCount: 3 })]);
  assert.equal(row.coins.length, 2);
  assert.equal(row.coins.find(item => item.label === 'امامي بانكي 86').quantity, 3);
});

test('zero invoice values stay zero; missing amounts use original document prices only', () => {
  const row = report([sale('free', { amount: 0, currentAmount: 9999 }), sale('fallback', { amount: undefined, gramPrice: 100, currentAmount: 9999 })]);
  assert.equal(row.purchased, 200);
});

test('segments use lifetime dates, exclude nonbuyers from inactive group, and count distinct purchase days', () => {
  assert.equal(report([]).inactive, false);
  assert.equal(report([sale('old', { date: '2026-06-26' })]).inactive, true);
  assert.equal(report([sale('recent')]).segment, 'مشتری تازه');
  assert.equal(report([sale('a'), sale('b'), sale('c')]).purchaseDays, 1);
  assert.equal(report([sale('a'), sale('b', { date: '2026-09-23' }), sale('c', { date: '2026-09-22' })]).segment, 'خریدار تکراری');
});

test('ranking supports ties, separates volume from spending, and does not mutate the input', () => {
  const a = report([sale('one', { amount: 1000, itemCount: 1 })]);
  const b = { ...a, customer: { id: 'b', name: 'بهار' }, purchased: 500, itemCount: 9 };
  const c = { ...a, customer: { id: 'c', name: 'زهرا' } };
  const rows = [a, b, c];
  assert.deepEqual(rankCustomers(rows).map(row => row.rank), [1, 1, 3]);
  assert.equal(rankCustomers(rows, 'itemCount')[0].customer.id, 'b');
  assert.deepEqual(rows.map(row => row.customer.id), ['a', 'b', 'c']);
});

test('CSV preserves Persian text, quoting, phone leading zeros and neutralizes spreadsheet formulas', () => {
  const row = report([], { ...customer, name: '=HYPERLINK("x")', phone: '09120000000' });
  const csv = customerRankingCsv([{ ...row, rank: 1 }]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"\'=HYPERLINK(""x"")"'));
  assert.ok(csv.includes("'09120000000"));
});
