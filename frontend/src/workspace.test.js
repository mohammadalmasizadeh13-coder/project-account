import test from 'node:test';
import assert from 'node:assert/strict';
import { birthdayReminders, profitReport, toolSections, workspaceSections } from './workspace.js';
import { persianToIso } from './persianDate.js';

test('navigation has exactly four primary sections and every tool belongs to one', () => {
  assert.deepEqual(Object.keys(workspaceSections), ['home', 'entries', 'reports', 'crm']);
  for (const section of Object.values(toolSections)) assert.ok(workspaceSections[section]);
  for (const tool of ['opening','register','cheques','pricing','customer-entry','settlement-entry','gold-entry']) assert.equal(toolSections[tool], 'entries');
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
