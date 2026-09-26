import test from 'node:test';
import assert from 'node:assert/strict';
import { birthdayReminders, profitReport, toolSections, workspaceSections } from './workspace.js';
import { persianToIso } from './persianDate.js';

test('navigation has exactly four primary sections and every tool belongs to one', () => {
  assert.deepEqual(Object.keys(workspaceSections), ['home', 'entries', 'reports', 'crm']);
  for (const section of Object.values(toolSections)) assert.ok(workspaceSections[section]);
  for (const tool of ['opening','register','expense','cheques','pricing','customer-entry','settlement-entry','gold-entry']) assert.equal(toolSections[tool], 'entries');
});

test('birthday reminders recur by Persian month/day and cross Nowruz without using the Gregorian birthday', () => {
  const customers = [{ id: 'a', name: 'الف', birthDate: persianToIso('1370/12/29') }, { id: 'b', name: 'ب', birthDate: persianToIso('1380/01/01') }];
  const today = persianToIso('1405/12/28');
  const reminders = birthdayReminders(customers, today, 7);
  assert.equal(reminders.length, 2);
  assert.equal(reminders[0].offset, 1);
  assert.equal(reminders[1].date, persianToIso('1406/01/01'));
  assert.equal(birthdayReminders(customers, today, 0).length, 0);
  assert.equal(birthdayReminders(customers, persianToIso('1406/01/01'), 0)[0].customer.id, 'b');
});

test('Esfand 30 birthdays use Esfand 29 in nonleap years and do not appear twice in leap years', () => {
  const customer = { id: 'leap', name: 'تولد اسفند', birthDate: persianToIso('1399/12/30') };
  const nonleap = birthdayReminders([customer], persianToIso('1400/12/29'), 2);
  assert.equal(nonleap.length, 1); assert.equal(nonleap[0].offset, 0); assert.equal(nonleap[0].leapAdjusted, true);
  const leap = birthdayReminders([customer], persianToIso('1403/12/29'), 2);
  assert.equal(leap.length, 1); assert.equal(leap[0].offset, 1); assert.equal(leap[0].leapAdjusted, false);
});

test('missing, invalid and future birth dates do not create reminders', () => {
  assert.deepEqual(birthdayReminders([{ name: 'a' }, { name: 'b', birthDate: '2026-02-30' }, { name: 'c', birthDate: '2099-01-01' }], '2026-09-24'), []);
});

const source = { id: 'lot', type: 'crafted-purchase', category: 'crafted', itemCount: 4, amount: 880, date: '2026-09-01' };
const sale = { id: 'sold', type: 'crafted-sale', category: 'crafted', inventorySourceId: 'lot', itemCount: 1, amount: 300, currentAmount: 999999, date: '2026-09-24' };
test('profit allocates historical full costs to partial sales, permits losses and excludes market repricing', () => {
  const docs = [source, sale, { ...sale, id: 'loss', itemCount: 2, amount: 400 }];
  const before = structuredClone(docs);
  const report = profitReport(docs, 'today', '2026-09-24');
  assert.equal(report.revenue, 700); assert.equal(report.cost, 660); assert.equal(report.grossProfit, 40);
  assert.equal(report.records[1].profit, -40); assert.deepEqual(docs, before);
});
test('unknown costs stay unknown, opening valuations are included, and period boundaries hold', () => {
  const docs = [{ ...source, source: 'opening-inventory', type: 'opening-crafted' }, sale, { ...sale, id: 'old', date: '2026-09-17' }, { ...sale, id: 'future', date: '2026-09-25' }, { ...sale, id: 'unlinked', inventorySourceId: '' }];
  const report = profitReport(docs, 'week', '2026-09-24');
  assert.equal(report.known, 1); assert.equal(report.unknown, 1); assert.equal(report.unknownRevenue, 300);
  assert.equal(report.grossProfit, 80); assert.equal(report.records.find(row => row.sale.id === 'unlinked').profit, null);
  assert.equal(profitReport([{ ...source, amount: undefined }, sale], 'today', sale.date).unknown, 1);
});
test('cost fallback includes labor and other costs; currency profit uses fractional quantities', () => {
  const gold = { ...source, amount: undefined, itemCount: 2, weight: 2, gramPrice: 100, wagePercent: 10, wageFixed: 5, otherCosts: 3, profitPercent: 5 };
  assert.equal(profitReport([gold, sale], 'today', sale.date).cost, 239.4);
  const usd = { ...source, category: 'currency', type: 'currency-purchase', currencyAmount: 100.5, amount: 1005 };
  const sold = { ...sale, category: 'currency', type: 'currency-sale', currencyAmount: 20.25, amount: 405 };
  assert.equal(profitReport([usd, sold], 'today', sale.date).grossProfit, 202.5);
});

test('recorded seller profit handles partial and unlinked sales, discounts and expenses separately from inventory gain', () => {
  const pricedSale = { ...sale, weight: 2, gramPrice: 100, wagePercent: 10, wageFixed: 5, otherCosts: 3, profitPercent: 7, discountRial: 10, amount: 233.96 };
  const unlinked = { ...pricedSale, id: 'unlinked', inventorySourceId: '', itemCount: 2, discountRial: 5, amount: 482.92 };
  const expense = { id: 'rent', type: 'expense', category: 'expense', amount: 40, date: sale.date, description: 'اجاره' };
  const docs = [source, pricedSale, unlinked, expense];
  const before = structuredClone(docs);
  const report = profitReport(docs, 'today', sale.date);
  assert.equal(report.records.length, 2);
  assert.equal(report.cost, 220);
  assert.equal(report.grossProfit, 233.96 - 220);
  assert.equal(report.records[0].sellerProfit, 15.96);
  assert.equal(report.records[1].sellerProfit, 31.92);
  assert.equal(report.records[1].profit, null);
  assert.equal(report.sellerProfit, 15.96 + 31.92);
  assert.equal(report.discounts, 15);
  assert.equal(report.records[0].sellerProfitAfterDiscount, 15.96 - 10);
  assert.equal(report.expenseTotal, 40);
  assert.deepEqual(report.expenses, [expense]);
  assert.equal(report.netSellerProfit, 15.96 + 31.92 - 15 - 40);
  assert.ok(report.netSellerProfit < 0);
  assert.equal(report.sellerProfitKnown, 2);
  assert.equal(report.sellerProfitUnknown, 0);
  assert.deepEqual(docs, before);
});

test('seller profit needs explicit historical percentage and price, preserves zero, and ignores current valuation', () => {
  const report = profitReport([
    { ...sale, id: 'missing-percent', weight: 2, gramPrice: 100 },
    { ...sale, id: 'blank-percent', weight: 2, gramPrice: 100, profitPercent: ' ' },
    { ...sale, id: 'invalid-percent', weight: 2, gramPrice: 100, profitPercent: 'invalid' },
    { ...sale, id: 'missing-price', weight: 2, profitPercent: 7 },
    { ...sale, id: 'zero', profitPercent: 0, discountRial: 5 },
    { ...sale, id: 'recorded', weight: 2, gramPrice: 100, profitPercent: '۷', currentAmount: 5000000, currentPrice: 999999 },
  ], 'today', sale.date);
  assert.equal(report.sellerProfit, 14);
  assert.equal(report.sellerProfitKnown, 2);
  assert.equal(report.sellerProfitUnknown, 4);
  for (const row of report.records.slice(0, 4)) {
    assert.equal(row.sellerProfit, null);
    assert.equal(row.sellerProfitAfterDiscount, null);
  }
  assert.equal(report.records[4].sellerProfit, 0);
  assert.equal(report.records[4].sellerProfitAfterDiscount, -5);
  assert.equal(report.netSellerProfit, 9);
});

test('expense-only periods include both boundaries and exclude future and older documents', () => {
  const expense = (id, date, amount) => ({ id, type: 'expense', category: 'expense', date, amount });
  const docs = [
    expense('today', '2026-09-24', 10),
    expense('week-start', '2026-09-18', 20),
    expense('before-week', '2026-09-17', 30),
    expense('month-start', '2026-08-26', 40),
    expense('before-month', '2026-08-25', 50),
    expense('future', '2026-09-25', 60),
  ];
  const daily = profitReport(docs, 'today', '2026-09-24');
  assert.equal(daily.expenseTotal, 10);
  assert.equal(daily.netSellerProfit, -10);
  assert.equal(daily.sellerProfit, 0);
  assert.equal(daily.records.length, 0);
  assert.equal(daily.grossProfit, 0);
  assert.equal(profitReport(docs, 'week', '2026-09-24').expenseTotal, 30);
  const monthly = profitReport(docs, 'month', '2026-09-24');
  assert.equal(monthly.expenseTotal, 100);
  assert.equal(monthly.netSellerProfit, -100);
});

test('expenses cannot become sale revenue or inventory cost through legacy direction or source fields', () => {
  const disguisedExpense = { ...source, type: 'expense', category: 'expense', source: 'opening-inventory', direction: 'فروش', amount: 40, date: sale.date };
  const report = profitReport([disguisedExpense, sale], 'today', sale.date);
  assert.equal(report.records.length, 1);
  assert.equal(report.known, 0);
  assert.equal(report.unknown, 1);
  assert.equal(report.expenseTotal, 40);
  assert.equal(report.grossProfit, 0);
});

test('historical discounts stop at the full invoice amount and preserve the entered amount for review', () => {
  const pricedSale = { ...sale, weight: 1, gramPrice: 100, wagePercent: 10, wageFixed: 5, otherCosts: 5, profitPercent: 7, amount: 0 };
  const docs = [source, { ...pricedSale, id: 'full', discountRial: 128.4 }, { ...pricedSale, id: 'oversized', discountRial: 500 }];
  const before = structuredClone(docs);
  const report = profitReport(docs, 'today', sale.date);
  assert.equal(report.discounts, 256.8);
  assert.equal(report.records[0].discount, 128.4);
  assert.equal(report.records[1].discount, 128.4);
  assert.equal(report.records[1].recordedDiscount, 500);
  assert.ok(Math.abs(report.records[1].sellerProfitAfterDiscount + 120) < 1e-9);
  assert.ok(Math.abs(report.netSellerProfit + 240) < 1e-9);
  assert.equal(report.revenue, 0);
  assert.equal(report.grossProfit, -440);
  assert.deepEqual(docs, before);
});

test('historical discounts with no recorded price stay visible without inventing an invoice cap', () => {
  const report = profitReport([{ ...sale, profitPercent: 7, discountRial: 500 }], 'today', sale.date);
  assert.equal(report.records[0].sellerProfit, null);
  assert.equal(report.records[0].discount, 500);
  assert.equal(report.records[0].recordedDiscount, 500);
  assert.equal(report.discounts, 500);
  assert.equal(report.sellerProfitUnknown, 1);
});

test('mixed expenses preserve original units and subtract each frozen toman equivalent exactly once', () => {
  const expense = fields => ({ type: 'expense', category: 'expense', date: sale.date, ...fields });
  const pricedSale = { ...sale, weight: 1, gramPrice: 10000, profitPercent: 7, discountRial: 10, amount: 10690 };
  const docs = [
    pricedSale,
    expense({ id: 'legacy', amount: 40, expenseAmount: 999 }),
    expense({ id: 'internet', expenseUnit: 'toman', expenseAmount: 80, amount: 80 }),
    expense({ id: 'rial', expenseUnit: 'rial', expenseAmount: 1200, amount: 120 }),
    expense({ id: 'workshop', expenseUnit: 'gold', expenseAmount: 1.5, expenseGoldPurity: 750, expenseRate: 200, amount: 300 }),
    expense({ id: 'pure-gold', expenseUnit: 'gold', expenseAmount: 0.75, expenseGoldPurity: 995, expenseRate: 1000, amount: 995 }),
    expense({ id: 'usd', expenseUnit: 'currency', expenseAmount: 2.5, expenseCurrency: 'USD', expenseRate: 100, amount: 250 }),
    expense({ id: 'usd-fraction', expenseUnit: 'currency', expenseAmount: 0.25, expenseCurrency: 'USD', expenseRate: 200, amount: 50 }),
    expense({ id: 'euro', expenseUnit: 'currency', expenseAmount: 1.25, expenseCurrency: 'EUR', expenseRate: 80, amount: 100 }),
  ];
  const before = structuredClone(docs);
  const report = profitReport(docs, 'today', sale.date);
  assert.equal(report.expenseTotal, 1935);
  assert.deepEqual(report.expenseTotals, {
    toman: 120, rial: 1200, goldWeightGrams: 2.25, goldGrams750: 2.495,
    currencies: { USD: 2.75, EUR: 1.25 },
  });
  assert.equal(report.records.length, 1);
  assert.equal(report.sellerProfit, 700);
  assert.equal(report.discounts, 10);
  assert.equal(report.netSellerProfit, 700 - 10 - 1935);
  assert.deepEqual(docs, before);
  const differentRates = docs.map(doc => ({ ...doc, expenseRate: 999999, currentAmount: 999999 }));
  const unchanged = profitReport(differentRates, 'today', sale.date);
  assert.equal(unchanged.expenseTotal, report.expenseTotal);
  assert.equal(unchanged.netSellerProfit, report.netSellerProfit);
  assert.deepEqual(unchanged.expenseTotals, report.expenseTotals);
});

test('expense unit totals share period boundaries and legacy cash expenses remain unchanged', () => {
  const expense = fields => ({ type: 'expense', category: 'expense', ...fields });
  const docs = [
    expense({ id: 'legacy', date: '2026-09-24', amount: 12.5 }),
    expense({ id: 'start', date: '2026-09-18', expenseUnit: 'gold', expenseAmount: 0.5, expenseRate: 100, amount: 50 }),
    expense({ id: 'old', date: '2026-09-17', expenseUnit: 'currency', expenseAmount: 2.5, expenseCurrency: 'GBP', expenseRate: 200, amount: 500 }),
    expense({ id: 'future', date: '2026-09-25', expenseUnit: 'rial', expenseAmount: 1000, amount: 100 }),
  ];
  const daily = profitReport(docs, 'today', '2026-09-24');
  assert.equal(daily.expenseTotal, 12.5);
  assert.equal(daily.netSellerProfit, -12.5);
  assert.deepEqual(daily.expenseTotals, { toman: 12.5, rial: 0, goldWeightGrams: 0, goldGrams750: 0, currencies: {} });
  const weekly = profitReport(docs, 'week', '2026-09-24');
  assert.equal(weekly.expenseTotal, 62.5);
  assert.equal(weekly.netSellerProfit, -62.5);
  assert.deepEqual(weekly.expenseTotals, { toman: 12.5, rial: 0, goldWeightGrams: 0.5, goldGrams750: 0.5, currencies: {} });
  const monthly = profitReport(docs, 'month', '2026-09-24');
  assert.equal(monthly.expenseTotal, 562.5);
  assert.deepEqual(monthly.expenseTotals.currencies, { GBP: 2.5 });
});
