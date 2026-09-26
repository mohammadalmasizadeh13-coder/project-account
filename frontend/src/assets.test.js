import test from 'node:test';
import assert from 'node:assert/strict';
import { assetReport, coinCatalog, documentBreakdown, number } from './assets.js';
import { assignProductCodes, inventoryReport, stockSaleForm, validateStockSale } from './inventory.js';
import { validateDocument } from './documentValidation.js';
import { salesReport } from './sales.js';

const gold = { id: 'gold', type: 'crafted-purchase', category: 'crafted', itemCount: 3, weight: 2, ayar: 750, gramPrice: 100, wagePercent: 10, wageFixed: 5, otherCosts: 3, profitPercent: 5, date: '2026-09-24' };
const usd = { id: 'usd', type: 'opening-currency', source: 'opening-inventory', category: 'currency', currencyType: 'USD', currencyAmount: '۱۰۰٫۵', currencyRate: 10, date: gold.date };

test('remaining assets include proportional labor, costs, profit and purity; sold invoice values cannot distort the vault', () => {
  const sale = { ...gold, id: 'sale', type: 'crafted-sale', inventorySourceId: gold.id, itemCount: 1, gramPrice: 999, wagePercent: 90, discountRial: 50 };
  const before = structuredClone([gold, sale]);
  const report = assetReport(inventoryReport(before), { goldGramPrice: 200, usdPrice: 20 });
  assert.equal(report.totalToman, 940.8);
  assert.equal(report.wage, 90);
  assert.equal(report.costs, 6);
  assert.equal(report.profit, 44.8);
  assert.equal(report.goldWeightGrams, 4);
  assert.equal(report.goldGrams750, 4);
  assert.equal(report.goldWithWageGrams750, 4.45);
  assert.equal(report.goldWithWageAndProfitGrams750, 4.674);
  assert.equal(report.totalRial, 9408);
  assert.equal(report.equivalentUsd, 47.04);
  assert.equal(report.equivalentGrams, 4.704);
  assert.deepEqual(before, [gold, sale]);
  assert.equal(documentBreakdown({ ...gold, itemCount: 1, ayar: 900 }).base, 240);
  assert.equal(assetReport(inventoryReport([gold, { ...sale, itemCount: 3 }]), {}).totalToman, 0);
});

test('gold weight stages distinguish scale weight, purity, labor and profit for remaining gold only', () => {
  const crafted = { ...gold, ayar: 900 };
  const melted = { id: 'melted', type: 'melted-purchase', category: 'melted', itemCount: 2, meltedWeight: 5, meltedAyar: 600, meltedGramPrice: 100, wagePercent: 2, wageFixed: 2, otherCosts: 4, profitPercent: 7, date: gold.date };
  const documents = [crafted, melted,
    { ...crafted, id: 'crafted-sold', type: 'crafted-sale', inventorySourceId: crafted.id, itemCount: 1 },
    { ...melted, id: 'melted-sold', type: 'melted-sale', inventorySourceId: melted.id, itemCount: 1 },
  ];
  const before = structuredClone(documents);
  const prices = { goldGramPrice: 200, usdPrice: 20, emamiCoinPrice: 1000 };
  const report = assetReport(inventoryReport(documents), prices);
  assert.equal(report.goldWeightGrams, 9);
  assert.equal(report.goldGrams750, 8.8);
  assert.ok(Math.abs(report.goldWithWageGrams750 - 9.42) < 1e-10);
  assert.ok(Math.abs(report.goldWithWageAndProfitGrams750 - 9.9757) < 1e-10);
  // The ten tomans of other costs remain in total valuation, outside staged grams.
  assert.equal(report.costs, 10);
  assert.ok(Math.abs(report.totalToman - 2005.14) < 1e-10);
  const withOtherAssets = assetReport(inventoryReport([...documents, usd,
    { id: 'coin', category: 'coin', type: 'coin-purchase', coinType: 'امامی', coinCount: 3, coinPrice: 500, wagePercent: 10, profitPercent: 7 },
    { id: 'parsian', category: 'coin', type: 'coin-purchase', coinType: 'پارسیان', coinCount: 5, parsianWeight: 1.2, parsianPrice: 300, profitPercent: 10 },
  ]), prices);
  for (const key of ['goldWeightGrams', 'goldGrams750', 'goldWithWageGrams750', 'goldWithWageAndProfitGrams750']) assert.equal(withOtherAssets[key], report[key]);
  assert.ok(withOtherAssets.totalToman > report.totalToman);
  assert.deepEqual(documents, before);
});

test('physical grams stay available without a market rate and remain stable when rates change', () => {
  const stock = inventoryReport([gold]);
  const historical = assetReport(stock);
  assert.equal(historical.goldWeightGrams, 6);
  assert.equal(historical.goldGrams750, 6);
  assert.equal(historical.goldWithWageGrams750, null);
  assert.equal(historical.goldWithWageAndProfitGrams750, null);
  const repriced = assetReport(stock, { goldGramPrice: '۲۰۰' });
  assert.equal(repriced.goldWeightGrams, historical.goldWeightGrams);
  assert.equal(repriced.goldGrams750, historical.goldGrams750);
  assert.equal(repriced.goldWithWageGrams750, 6.675);
  assert.equal(repriced.goldWithWageAndProfitGrams750, 7.011);
  const empty = assetReport(inventoryReport([gold, { ...gold, id: 'sold-all', type: 'crafted-sale', inventorySourceId: gold.id }]), { goldGramPrice: 200 });
  for (const key of ['goldWeightGrams', 'goldGrams750', 'goldWithWageGrams750', 'goldWithWageAndProfitGrams750']) assert.equal(empty[key], 0);
});

test('foreign currencies retain separate fractional stock and historical rates after repricing', () => {
  const sale = { ...usd, source: undefined, id: 'sold-usd', type: 'currency-sale', currencyAmount: '۲۰٫۲۵', currencyRate: 15, inventorySourceId: usd.id };
  const docs = assignProductCodes([usd, sale, { ...usd, id: 'eur', currencyType: 'EUR', currencyAmount: 5, currencyRate: 30 }]);
  assert.equal(validateStockSale(sale, docs), '');
  assert.ok(validateStockSale({ ...sale, currencyType: 'EUR' }, docs));
  assert.ok(validateStockSale({ ...sale, currencyAmount: 101 }, docs));
  const stock = inventoryReport(docs);
  const report = assetReport(stock, { usdPrice: 20, eurPrice: 40 });
  assert.deepEqual(report.currencies, { USD: 80.25, EUR: 5 });
  assert.equal(report.totalToman, 1805);
  assert.equal(report.equivalentUsd, 90.25);
  assert.equal(report.equivalentGrams, null);
  assert.equal(documentBreakdown(sale).total, 303.75);
  assert.equal(stockSaleForm(usd, {}, { usdPrice: 20 }).currencyRate, '20');
  assert.equal(assetReport(stock, {}).equivalentUsd, null);
});

test('decimal currency depletion does not leave phantom inventory', () => {
  const entry = { ...usd, currencyAmount: 0.3 };
  const sale = { ...usd, source: undefined, type: 'currency-sale', inventorySourceId: usd.id };
  const stock = inventoryReport([entry, { ...sale, id: 'a', currencyAmount: 0.1 }, { ...sale, id: 'b', currencyAmount: 0.2 }]);
  assert.equal(stock.items[0].remaining, 0);
  assert.equal(stock.available.length, 0);
});

test('all four bank 86 coins use distinct rates, retaining older types and Parsian', () => {
  const bank = coinCatalog.filter(coin => coin.name.includes('۸۶'));
  assert.equal(bank.length, 4);
  assert.equal(new Set(bank.map(coin => coin.price)).size, 4);
  const prices = Object.fromEntries(bank.map((coin, i) => [coin.price, 100 * (i + 1)]));
  for (const [index, coin] of bank.entries()) {
    const item = { id: coin.name, category: 'coin', type: 'coin-purchase', coinType: coin.name, coinCount: 2, coinPrice: 10 };
    assert.equal(documentBreakdown(item, prices).total, (index + 1) * 200);
    assert.equal(Number(stockSaleForm(item, {}, prices).coinPrice), (index + 1) * 100);
    assert.equal(documentBreakdown(item).total, 20);
  }
  assert.equal(documentBreakdown({ category: 'coin', coinType: 'امامی', coinCount: 2, coinPrice: 7 }, prices).total, 14);
  assert.equal(documentBreakdown({ category: 'coin', coinType: 'پارسیان', coinCount: 2, parsianPrice: 50 }, prices).total, 100);
});

test('currency forms reject unknown types and invalid rates, quantities and costs', () => {
  const form = { ...usd, customerName: 'مشتری', type: 'currency-purchase', gold18Price: '10000000' };
  assert.deepEqual(validateDocument(form, 'currency', number), {});
  for (const field of ['currencyRate', 'currencyAmount']) {
    for (const value of ['', '0', '-1', 'abc', 'Infinity']) assert.ok(validateDocument({ ...form, [field]: value }, 'currency', number)[field]);
  }
  assert.ok(validateDocument({ ...form, currencyType: 'UNKNOWN' }, 'currency', number).currencyType);
  assert.ok(validateDocument({ ...form, otherCosts: '-1' }, 'currency', number).otherCosts);
});

test('currency sales enter revenue and their own category without inflating product counts or gold weight', () => {
  const sale = { ...usd, source: undefined, type: 'currency-sale', amount: 1005 };
  const report = salesReport([sale], 'today', { quantity: doc => number(doc.currencyAmount), weight: () => 0, amount: doc => documentBreakdown(doc).total }, gold.date);
  assert.equal(report.total, 1005);
  assert.equal(report.count, 0);
  assert.equal(report.totalWeight, 0);
  assert.equal(report.categories.find(item => item.key === 'currency').amount, 1005);
  assert.equal(report.products[0].unit, 'USD');
});
