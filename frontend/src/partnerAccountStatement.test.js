import test from 'node:test';
import assert from 'node:assert/strict';
import { partnerAccountStatement } from './partnerAccountStatement.js';
import { partnerStatement } from './partnerLedger.js';

test('inclusive dates carry earlier postings into opening balances and exclude later balances and assets', () => {
  const partner = { openingGoldBalance: 4, openingTomanBalance: -100, goldBalance: 900, tomanBalance: 900,
    assetBalances: { 'currency:EUR': 999 }, entries: [
      { id: 'after', date: '2026-10-13', goldDebit: 200, assetChanges: { 'currency:EUR': 999 } },
      { id: 'start', date: '2026-10-10', invoiceTime: '00:00', goldCredit: 1, tomanDebit: 150 },
      { id: 'prior', date: '2026-10-09', goldDebit: 2, tomanCredit: 20, assetChanges: { 'currency:USD': -50 } },
      { id: 'end', date: '2026-10-12', invoiceTime: '23:59', goldCredit: 3, assetChanges: { 'currency:USD': 10 } },
    ] };
  const report = partnerAccountStatement(partner, { from: '2026-10-10', to: '2026-10-12' });
  assert.deepEqual(report.rows.map(row => row.id), ['start', 'end']);
  assert.deepEqual(report.openingBalances, { gold: 6, toman: -120, 'currency:USD': -50 });
  assert.deepEqual(report.closingBalances, { gold: 2, toman: 30, 'currency:USD': -40 });
  assert.deepEqual(report.assets, ['gold', 'toman', 'currency:USD']);
  assert.deepEqual(report.rows[0].previousBalances, report.openingBalances);
  assert.deepEqual(report.rows[1].previousBalances, report.rows[0].balances);
  assert.deepEqual(report.totals, { gold: { debit: 0, credit: 4 }, toman: { debit: 150, credit: 0 }, 'currency:USD': { debit: 10, credit: 0 } });
});

test('all legacy versions and linked settlements retain saved gross movements without recalculating rows', () => {
  const partner = { openingGoldBalance: -1, openingTomanBalance: 2, entries: [
    { id: 'v1', type: 'purchase', calculationVersion: 1, date: '2026-10-01', goldDebit: '۲', tomanDebit: '۱٬۰۰۰', lines: [{ weight: 900, gramPrice: 1e12 }] },
    { id: 'pay-v1', type: 'settlement', linkedEntryId: 'v1', date: '2026-10-02', goldCredit: 1, note: 'شرح پرداخت', reference: '۱۲۳' },
    { id: 'v2', type: 'sale', calculationVersion: 2, date: '2026-10-03', goldCredit: 0.25, gold18Price: 1 },
    { id: 'v3', type: 'mixed', calculationVersion: 3, date: '2026-10-04', goldDebit: 3, goldCredit: 2, tomanCredit: 100 },
    { id: 'v4', type: 'mixed', calculationVersion: 4, date: '2026-10-05', goldDebit: 4, goldCredit: 4, tomanDebit: 500, tomanCredit: 500 },
  ] };
  const original = structuredClone(partner);
  const report = partnerAccountStatement(partner);
  const legacy = partnerStatement(partner);
  assert.deepEqual(report.rows.map(row => row.id), legacy.rows.map(row => row.id));
  assert.deepEqual(report.rows.map(row => [row.goldBalance, row.tomanBalance]), legacy.rows.map(row => [row.goldBalance, row.tomanBalance]));
  assert.deepEqual(report.totals.gold, { debit: legacy.goldDebit, credit: legacy.goldCredit });
  assert.deepEqual(report.totals.toman, { debit: legacy.tomanDebit, credit: legacy.tomanCredit });
  assert.deepEqual(report.rows[4].changes, { gold: 0, toman: 0 });
  assert.equal(report.rows[1].note, 'شرح پرداخت');
  assert.equal(report.rows[1].reference, '۱۲۳');
  assert.deepEqual(report.rows[0].lines, original.entries[0].lines);
  assert.deepEqual(partner, original);
  const repriced = structuredClone(partner);
  repriced.entries.forEach(entry => { entry.gold18Price = 1e12; entry.lines?.forEach(line => { line.gramPrice = 1; }); });
  assert.deepEqual(partnerAccountStatement(repriced).closingBalances, report.closingBalances);
});

test('v5 trades deliveries and offsets keep gold money coin specifications and currencies separate', () => {
  const coinA = 'coin:پارسیان:1:750', coinB = 'coin:پارسیان:2:750';
  const partner = { openingAssetBalances: { [coinA]: 1, 'currency:USD': -10 }, entries: [
    { id: 'trade', calculationVersion: 5, type: 'trade', date: '2026-10-10', goldCredit: 2, tomanDebit: 300,
      assetChanges: { [coinA]: -3, [coinB]: 2, 'currency:IQD': -5000, 'currency:USD': 30 }, lines: [{ rate: 123, amount: 246 }] },
    { id: 'delivery', calculationVersion: 5, type: 'delivery', date: '2026-10-11', goldDebit: 1,
      assetChanges: { [coinA]: 1, 'currency:IQD': 2500 } },
    { id: 'offset', calculationVersion: 5, type: 'offset', date: '2026-10-12', goldDebit: 1, tomanCredit: 300,
      assetChanges: { [coinB]: -1, 'currency:USD': -10 } },
  ] };
  const report = partnerAccountStatement(partner, { from: '2026-10-10', to: '2026-10-12' });
  assert.deepEqual(report.closingBalances, { gold: 0, toman: 0, [coinA]: -1, 'currency:USD': 10, [coinB]: 1, 'currency:IQD': -2500 });
  assert.deepEqual(report.totals[coinA], { debit: 1, credit: 3 });
  assert.deepEqual(report.totals[coinB], { debit: 2, credit: 1 });
  assert.deepEqual(report.totals['currency:USD'], { debit: 30, credit: 10 });
  assert.deepEqual(report.totals['currency:IQD'], { debit: 2500, credit: 5000 });
  for (const asset of report.assets) {
    assert.equal(report.closingBalances[asset], report.openingBalances[asset] + report.totals[asset].debit - report.totals[asset].credit);
  }
});

test('chronology matches invoice times Tehran creation times and stable original positions', () => {
  const entries = [
    { id: 'last', date: '2026-10-11', invoiceTime: '23:59', goldCredit: 1 },
    { id: 'created-11', date: '2026-10-10', createdAt: '2026-10-10T07:30:00Z', goldDebit: 1 },
    { id: 'invoice-09', date: '2026-10-10', invoiceTime: '09:00', createdAt: '2026-10-10T15:00:00Z', goldDebit: 2 },
    { id: 'created-10', date: '2026-10-10', createdAt: '2026-10-10T10:00:00+03:30', goldCredit: 3 },
    { id: 'same-a', date: '2026-10-10', invoiceTime: '12:00', goldDebit: 4 },
    { id: 'same-b', date: '2026-10-10', invoiceTime: '12:00', goldCredit: 5 },
  ];
  const report = partnerAccountStatement({ entries });
  assert.deepEqual(report.rows.map(row => row.id), ['invoice-09', 'created-10', 'created-11', 'same-a', 'same-b', 'last']);
  assert.deepEqual(report.rows.map(row => row.goldBalance), [2, -1, 0, 4, -1, -2]);
  assert.deepEqual(report.rows.map(row => row.id), partnerStatement({ entries }).rows.map(row => row.id));
});

test('empty periods retain the opening and all optional boundary combinations work', () => {
  const partner = { openingGoldBalance: -5, openingTomanBalance: 50, entries: [
    { date: '2026-10-01', goldDebit: 2 }, { date: '2026-10-10', tomanCredit: 10 },
  ] };
  const empty = partnerAccountStatement(partner, { from: '2026-10-02', to: '2026-10-09' });
  assert.deepEqual(empty.rows, []);
  assert.deepEqual(empty.openingBalances, { gold: -3, toman: 50 });
  assert.deepEqual(empty.closingBalances, empty.openingBalances);
  assert.deepEqual(empty.totals, { gold: { debit: 0, credit: 0 }, toman: { debit: 0, credit: 0 } });
  assert.deepEqual(partnerAccountStatement(partner, { to: '2026-10-01' }).closingBalances, { gold: -3, toman: 50 });
  assert.deepEqual(partnerAccountStatement(partner, { from: '2026-10-10' }).openingBalances, { gold: -3, toman: 50 });
  assert.deepEqual(partnerAccountStatement(partner, { from: '2026-10-10' }).closingBalances, { gold: -3, toman: 40 });
  assert.deepEqual(partnerAccountStatement(undefined).closingBalances, { gold: 0, toman: 0 });
});

test('date validation rejects impossible reversed and malformed bounds and accepts Persian digits', () => {
  for (const value of ['2026-02-29', '2026-13-01', '2026-1-01', 'not a date']) {
    assert.throws(() => partnerAccountStatement({}, { from: value }), /تاریخ شروع/);
    assert.throws(() => partnerAccountStatement({}, { to: value }), /تاریخ پایان/);
  }
  assert.throws(() => partnerAccountStatement({}, { from: '2026-10-12', to: '2026-10-01' }), /نباید بعد/);
  const partner = { entries: [{ date: '2026-10-10', goldDebit: 1 }] };
  assert.equal(partnerAccountStatement(partner, { from: '۲۰۲۶-۱۰-۱۰', to: '۲۰۲۶-۱۰-۱۰' }).rows.length, 1);
  assert.doesNotThrow(() => partnerAccountStatement({}, { from: '2024-02-29' }));
});

test('tiny asset movements retain eight decimal places and zero net documents remain visible', () => {
  const report = partnerAccountStatement({ entries: [
    { id: 'tiny', date: '2026-10-10', goldDebit: 0.1, assetChanges: { 'currency:USD': 0.00000001 } },
    { id: 'tiny-again', date: '2026-10-11', goldDebit: 0.2, assetChanges: { 'currency:USD': 0.00000002 } },
    { id: 'zero', date: '2026-10-12', type: 'trade', goldDebit: 0, goldCredit: 0, tomanDebit: 0, tomanCredit: 0,
      assetChanges: {}, note: 'خرید و فروش همزمان', lines: [{ quantity: 1, direction: 'purchase' }, { quantity: 1, direction: 'sale' }] },
  ] });
  assert.equal(report.rows.length, 3);
  assert.equal(report.closingBalances.gold, 0.3);
  assert.equal(report.closingBalances['currency:USD'], 0.00000003);
  assert.equal(report.totals['currency:USD'].debit, 0.00000003);
  assert.deepEqual(report.rows[2].balances, report.rows[1].balances);
  assert.equal(report.rows[2].note, 'خرید و فروش همزمان');
});

test('saved opposite currency and coin lines reconstruct reconciled gross postings even when the net is omitted', () => {
  const coin = 'coin:پارسیان:1:750';
  const report = partnerAccountStatement({ entries: [
    { id: 'trade', calculationVersion: 5, type: 'trade', date: '2026-10-10', assetChanges: { 'currency:USD': -20 },
      lines: [{ asset: 'currency:USD', direction: 'purchase', quantity: 50, rate: 100 },
        { asset: 'currency:USD', direction: 'sale', quantity: 30, rate: 900 },
        { asset: coin, direction: 'purchase', quantity: 2 }, { asset: coin, direction: 'sale', quantity: 2 }] },
    { id: 'delivery', calculationVersion: 5, type: 'delivery', date: '2026-10-11', assetChanges: { 'currency:USD': 10 },
      lines: [{ asset: 'currency:USD', direction: 'receive', quantity: 20 }, { asset: 'currency:USD', direction: 'pay', quantity: 10 }] },
    { id: 'offset', calculationVersion: 5, type: 'offset', date: '2026-10-12', assetChanges: { 'currency:USD': 5 },
      lines: [{ asset: 'currency:USD', direction: 'receivable', quantity: 5 }] },
    { id: 'later', calculationVersion: 5, type: 'trade', date: '2026-10-13', lines: [
      { asset: 'currency:EUR', direction: 'purchase', quantity: 10 }, { asset: 'currency:EUR', direction: 'sale', quantity: 10 }] },
  ] }, { from: '2026-10-10', to: '2026-10-12' });
  assert.deepEqual(report.assets, ['gold', 'toman', 'currency:USD', coin]);
  assert.deepEqual(report.rows[0].postings['currency:USD'], { debit: 30, credit: 50 });
  assert.deepEqual(report.rows[0].postings[coin], { debit: 2, credit: 2 });
  assert.deepEqual(report.rows[1].postings['currency:USD'], { debit: 20, credit: 10 });
  assert.deepEqual(report.rows[2].postings['currency:USD'], { debit: 5, credit: 0 });
  assert.deepEqual(report.rows[2].postings[coin], { debit: 0, credit: 0 });
  assert.deepEqual(report.totals['currency:USD'], { debit: 55, credit: 60 });
  assert.deepEqual(report.totals[coin], { debit: 2, credit: 2 });
  assert.deepEqual(report.closingBalances, { gold: 0, toman: 0, 'currency:USD': -5, [coin]: 0 });
});

test('unreconciled incomplete or unknown line movements fall back to saved net extra-asset postings', () => {
  const report = partnerAccountStatement({ entries: [
    { id: 'mismatch', calculationVersion: 5, type: 'trade', date: '2026-10-10', assetChanges: { 'currency:USD': 15 },
      lines: [{ asset: 'currency:USD', direction: 'purchase', quantity: 20 }, { asset: 'currency:USD', direction: 'sale', quantity: 40 }] },
    { id: 'unknown-direction', calculationVersion: 5, type: 'trade', date: '2026-10-11', assetChanges: { 'currency:USD': -3 },
      lines: [{ asset: 'currency:USD', direction: 'purchase', quantity: 3 }, { asset: 'currency:USD', direction: 'pay', quantity: 4 }] },
    { id: 'incomplete', calculationVersion: 5, type: 'delivery', date: '2026-10-12', assetChanges: { 'currency:USD': 2 },
      lines: [{ asset: 'currency:USD', direction: 'receive', quantity: 2 }, { asset: 'currency:USD', direction: 'pay' }] },
    { id: 'legacy', calculationVersion: 4, type: 'mixed', date: '2026-10-12', goldDebit: 5, goldCredit: 5, tomanDebit: 20, tomanCredit: 10,
      lines: [{ asset: 'currency:EUR', direction: 'purchase', quantity: 10 }, { asset: 'currency:EUR', direction: 'sale', quantity: 10 }] },
  ] });
  assert.deepEqual(report.rows.map(row => row.postings['currency:USD']), [
    { debit: 15, credit: 0 }, { debit: 0, credit: 3 }, { debit: 2, credit: 0 }, { debit: 0, credit: 0 },
  ]);
  assert.deepEqual(report.totals['currency:USD'], { debit: 17, credit: 3 });
  assert.deepEqual(report.rows[3].postings.gold, { debit: 5, credit: 5 });
  assert.deepEqual(report.rows[3].postings.toman, { debit: 20, credit: 10 });
  assert.equal(report.assets.includes('currency:EUR'), false);
});

test('only current period gross turnover enters totals while an earlier zero net asset carries forward', () => {
  const partner = { entries: [{ id: 'prior', calculationVersion: 5, type: 'trade', date: '2026-10-01', lines: [
    { asset: 'currency:USD', direction: 'purchase', quantity: 0.1 }, { asset: 'currency:USD', direction: 'sale', quantity: 0.1 },
  ] }, { id: 'current', calculationVersion: 5, type: 'delivery', date: '2026-10-10', assetChanges: { 'currency:USD': 0.00000001 }, lines: [
    { asset: 'currency:USD', direction: 'receive', quantity: 0.00000003 }, { asset: 'currency:USD', direction: 'pay', quantity: 0.00000002 },
  ] }] };
  const report = partnerAccountStatement(partner, { from: '2026-10-10', to: '2026-10-10' });
  assert.deepEqual(report.openingBalances, { gold: 0, toman: 0, 'currency:USD': 0 });
  assert.deepEqual(report.totals['currency:USD'], { debit: 0.00000003, credit: 0.00000002 });
  assert.equal(report.closingBalances['currency:USD'], 0.00000001);
  assert.equal(report.rows.length, 1);
});

test('gross side rounding must also reconcile with the saved movement before using line quantities', () => {
  const report = partnerAccountStatement({ entries: [{ calculationVersion: 5, type: 'delivery', date: '2026-10-10',
    assetChanges: { 'currency:USD': 0 }, lines: [
      { asset: 'currency:USD', direction: 'receive', quantity: 0.000000005 },
      { asset: 'currency:USD', direction: 'pay', quantity: 0.000000004 },
    ] }] });
  assert.deepEqual(report.rows[0].postings['currency:USD'], { debit: 0, credit: 0 });
  assert.equal(report.closingBalances['currency:USD'], 0);
});

test('v5 purchases and sales retain gross saved cash movement alongside simultaneous payment or receipt', () => {
  const report = partnerAccountStatement({ entries: [
    { id: 'purchase', calculationVersion: 5, type: 'trade', date: '2026-10-10', goldCredit: 10, tomanDebit: 75000000, lines: [
      { asset: 'gold', direction: 'purchase', quantity: 10, amount: 100000000, rate: 1 },
      { asset: 'toman', direction: 'pay', simultaneous: true, quantity: 25000000, amount: 25000000 },
    ] },
    { id: 'sale', calculationVersion: 5, type: 'trade', date: '2026-10-11', goldDebit: 5, tomanCredit: 30000000, lines: [
      { asset: 'gold', direction: 'sale', quantity: 5, amount: 50000000, rate: 1e12 },
      { asset: 'toman', direction: 'receive', simultaneous: true, quantity: 20000000, amount: 20000000 },
    ] },
  ] });
  assert.deepEqual(report.rows[0].postings.gold, { debit: 0, credit: 10 });
  assert.deepEqual(report.rows[0].postings.toman, { debit: 100000000, credit: 25000000 });
  assert.deepEqual(report.rows[1].postings.gold, { debit: 5, credit: 0 });
  assert.deepEqual(report.rows[1].postings.toman, { debit: 20000000, credit: 50000000 });
  assert.deepEqual(report.totals.toman, { debit: 120000000, credit: 75000000 });
  assert.deepEqual(report.closingBalances, { gold: -5, toman: 45000000 });
  assert.equal(report.rows[0].tomanDebit, 75000000);
});

test('v5 opposite gold trades preserve gross gold and cash totals in a fully zero net document', () => {
  const report = partnerAccountStatement({ entries: [{ calculationVersion: 5, type: 'trade', date: '2026-10-10',
    goldDebit: 0, goldCredit: 0, tomanDebit: 0, tomanCredit: 0, lines: [
      { asset: 'gold', direction: 'purchase', quantity: 10, amount: 100000000 },
      { asset: 'gold', direction: 'sale', quantity: 10, amount: 100000000 },
    ] }] });
  assert.deepEqual(report.rows[0].postings.gold, { debit: 10, credit: 10 });
  assert.deepEqual(report.rows[0].postings.toman, { debit: 100000000, credit: 100000000 });
  assert.deepEqual(report.totals.gold, { debit: 10, credit: 10 });
  assert.deepEqual(report.totals.toman, { debit: 100000000, credit: 100000000 });
  assert.deepEqual(report.closingBalances, { gold: 0, toman: 0 });
});

test('v5 deliveries and offsets reconstruct gold and cash quantities using their recorded directions', () => {
  const report = partnerAccountStatement({ entries: [
    { calculationVersion: 5, type: 'delivery', date: '2026-10-10', goldDebit: 2, tomanDebit: 60, lines: [
      { asset: 'gold', direction: 'receive', quantity: 3, amount: 99999, meltedWeight: 10, meltedAyar: 225 },
      { asset: 'gold', direction: 'pay', quantity: 1, amount: 88888 },
      { asset: 'toman', direction: 'receive', quantity: 100 }, { asset: 'toman', direction: 'pay', quantity: 40 },
    ] },
    { calculationVersion: 5, type: 'offset', date: '2026-10-11', goldCredit: 1, tomanDebit: 20, lines: [
      { asset: 'gold', direction: 'payable', quantity: 1, amount: 20 },
      { asset: 'toman', direction: 'receivable', quantity: 20, amount: 20 },
    ] },
  ] });
  assert.deepEqual(report.rows[0].postings.gold, { debit: 3, credit: 1 });
  assert.deepEqual(report.rows[0].postings.toman, { debit: 100, credit: 40 });
  assert.deepEqual(report.rows[1].postings.gold, { debit: 0, credit: 1 });
  assert.deepEqual(report.rows[1].postings.toman, { debit: 20, credit: 0 });
  assert.deepEqual(report.closingBalances, { gold: 1, toman: 80 });
});

test('v5 gold and cash gross reconstruction falls back independently when saved lines do not reconcile', () => {
  const report = partnerAccountStatement({ entries: [{ calculationVersion: 5, type: 'trade', date: '2026-10-10',
    goldCredit: 9, tomanDebit: 80, lines: [
      { asset: 'gold', direction: 'purchase', quantity: 10, amount: 100 },
      { asset: 'toman', direction: 'pay', simultaneous: true, quantity: 25 },
    ] }] });
  assert.deepEqual(report.rows[0].postings.gold, { debit: 0, credit: 9 });
  assert.deepEqual(report.rows[0].postings.toman, { debit: 80, credit: 0 });
  assert.deepEqual(report.closingBalances, { gold: -9, toman: 80 });
});
