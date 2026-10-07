import test from 'node:test';
import assert from 'node:assert/strict';
import { documentBreakdown, assetReport } from './assets.js';
import { inventoryReport } from './inventory.js';
import { isMiscPurchase, miscGoldDefaults, miscGoldSummary, miscGoldWeight750 } from './miscGold.js';

test('misc gold retains actual scale weight and derives the 750 equivalent without rounding accounting values', () => {
  const record = { ...miscGoldDefaults(), id: 'used-gold', type: 'misc-purchase', category: 'crafted', weight: '۱۰', ayar: '۷۴۰', gramPrice: 6000000 };
  const before = structuredClone(record);
  const converted = 10 * 740 / 750;
  assert.equal(miscGoldWeight750(record), converted);
  assert.equal(isMiscPurchase(record), true);
  assert.equal(isMiscPurchase('misc-purchase'), true);
  assert.equal(isMiscPurchase({ type: 'crafted-purchase' }), false);
  assert.equal(documentBreakdown(record).total, converted * 6000000);
  const assets = assetReport(inventoryReport([record]), { goldGramPrice: 6000000 });
  assert.equal(assets.goldWeightGrams, 10);
  assert.equal(assets.goldGrams750, converted);
  assert.equal(assets.wage, 0);
  assert.equal(assets.profit, 0);
  assert.match(miscGoldSummary(record), /۷۵۰.*۹٫۸۶۶۶۶۷/);
  assert.deepEqual(record, before);
});

test('invalid or missing purity never becomes an assumed 750 in the preview', () => {
  for (const ayar of [undefined, '', 0, '۰', -1, 0.5, 1001, 'abc', Infinity]) {
    assert.equal(miscGoldWeight750({ weight: 10, ayar }), 0, String(ayar));
  }
  assert.equal(miscGoldWeight750({ weight: 10, ayar: 1000 }), 10 * 1000 / 750);
  assert.equal(miscGoldWeight750({ weight: -1, ayar: 740 }), 0);
});

test('misc defaults are independent copies with no labor or seller profit', () => {
  const defaults = miscGoldDefaults();
  defaults.profitPercent = '7';
  assert.equal(miscGoldDefaults().profitPercent, '0');
  assert.equal(miscGoldDefaults().wagePercent, '0');
  assert.equal(miscGoldDefaults().wageFixed, '0');
});
