import test from 'node:test';
import assert from 'node:assert/strict';
import { coinBase, coinOptions, coinOptionsFor, coinSpec, coinSummary, selectCoin } from './coins.js';
import { assetReport, documentBreakdown, number } from './assets.js';
import { inventoryReport, stockSaleForm, validateStockSale } from './inventory.js';
import { validateDocument } from './documentValidation.js';
import { invoiceLinePreview } from './invoiceDraft.js';
import { newPartnerInvoice, newPartnerLine, partnerInvoiceDraftFromEntry, partnerInvoiceTotals, preparePartnerInvoice, savedPartnerLineTotals } from './partnerLedger.js';
import { filterInventoryItems } from './inventoryFilters.js';
import { profitReport } from './workspace.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const date = '2026-10-09';
const purchase = (type = 'تمام عادی', overrides = {}) => ({ ...selectCoin(type, { goldGramPrice: 1000 }),
  id: 'lot', category: 'coin', type: 'coin-purchase', itemName: 'سکه', customerName: 'مشتری', date,
  coinCount: 2, gold18Price: 1000, profitPercent: 5, profitFixed: 100, ...overrides });

test('ordinary standard coins use exact scale weights and purity before applying both profit amounts', () => {
  for (const [type, weight, equivalent] of [['تمام عادی', 8.133, 9.7596], ['نیم عادی', 4.066, 4.8792], ['ربع عادی', 2.022, 2.4264]]) {
    const row = purchase(type);
    const spec = coinSpec(row);
    assert.equal(spec.weight, weight);
    assert.equal(spec.ayar, 900);
    close(spec.weight750, equivalent);
    const totals = documentBreakdown(row);
    close(totals.base, equivalent * 2000);
    close(totals.profit, equivalent * 100 + 200);
    close(totals.total, equivalent * 2100 + 200);
    close(documentBreakdown(row, { goldGramPrice: 2000 }).base, equivalent * 4000);
    assert.match(coinSummary(row), /ترازو.*عیار.*۷۵۰/);
    assert.deepEqual(validateDocument(row, 'coin', number), {});
  }
});

test('custom coins require actual weights and purity and support Persian numbers', () => {
  for (const type of ['پارسیان', 'گل رز', 'سایر']) {
    const row = purchase(type, { coinWeight: '۲٫۵', coinAyar: '۹۰۰' });
    close(coinBase(row), 6000);
    assert.deepEqual(validateDocument(row, 'coin', number), {});
    for (const field of ['coinWeight', 'coinAyar', 'gramPrice']) for (const invalid of ['', 0, -1, 'abc', Infinity]) {
      assert.ok(validateDocument({ ...row, [field]: invalid }, 'coin', number)[field], `${type} ${field} ${invalid}`);
    }
    for (const ayar of [0.5, 1001]) assert.ok(validateDocument({ ...row, coinAyar: ayar }, 'coin', number).coinAyar);
    assert.ok(validateDocument({ ...row, coinCount: 1.5 }, 'coin', number).coinCount);
    assert.ok(validateDocument({ ...row, profitFixed: -1 }, 'coin', number).profitFixed);
  }
});

test('bank coins use their separate board rates while legacy ordinary and Parsian values keep their formula', () => {
  const banks = coinOptions.filter(coin => coin.group === 'bank');
  assert.equal(banks.length, 4);
  for (const [index, coin] of banks.entries()) {
    const row = purchase(coin.name, { coinPrice: 500 });
    close(coinBase(row, { [coin.price]: 100 * (index + 1), goldGramPrice: 1e9 }), 200 * (index + 1));
    close(documentBreakdown(row).total, 1250);
  }
  assert.equal(coinOptions.length, 10);
  assert.equal(coinOptions.some(coin => coin.name === 'تمام'), false);
  assert.equal(coinOptionsFor({ coinType: 'تمام' }).at(-1).name, 'تمام');
  const legacy = { category: 'coin', coinType: 'پارسیان', coinCount: 2, parsianWeight: 1, parsianPrice: 500, coinWeight: 2, coinAyar: 900, gramPrice: 1e9, profitFixed: 1000 };
  assert.equal(documentBreakdown(legacy).total, 1000);
  assert.equal(documentBreakdown({ ...legacy, coinType: 'تمام', coinPrice: 300 }).total, 600);
  assert.equal(coinSpec(legacy).weight750, 0);
});

test('draft and stock sales carry canonical coin specifications and preserve historical inventory identity', () => {
  const row = purchase('تمام عادی', { coinWeight: 99, coinAyar: 750, coinWeight750: 99 });
  const preview = invoiceLinePreview(row, 5000);
  assert.equal(preview.coinWeight, 8.133);
  assert.equal(preview.coinAyar, 900);
  close(preview.coinWeight750, 9.7596);
  const custom = purchase('گل رز', { coinWeight: 0.5, coinAyar: 750 });
  const sale = { ...stockSaleForm(custom, {}, { goldGramPrice: 2000 }), category: 'coin', date, id: 'sale' };
  assert.equal(sale.coinPricingVersion, 2);
  assert.equal(sale.coinWeight, 0.5);
  assert.equal(sale.coinAyar, 750);
  assert.equal(sale.gramPrice, 2000);
  assert.equal(validateStockSale(sale, [custom]), '');
  assert.ok(validateStockSale({ ...sale, coinWeight: 1 }, [custom]));
  assert.ok(validateStockSale({ ...sale, coinAyar: 900 }, [custom]));
  assert.ok(validateStockSale({ ...sale, coinPricingVersion: '' }, [custom]));
  const apiStock = { ...custom };
  delete apiStock.parsianWeight;
  const apiSale = JSON.parse(JSON.stringify(invoiceLinePreview(stockSaleForm(apiStock, {}, {}), 1000)));
  assert.equal(Object.hasOwn(apiSale, 'parsianWeight'), false);
  const legacy = { ...custom, coinPricingVersion: undefined, coinType: 'پارسیان', parsianWeight: 1, parsianPrice: 500 };
  const legacySale = stockSaleForm(legacy, selectCoin('تمام عادی'), {});
  assert.equal(legacySale.coinPricingVersion, undefined);
  assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(invoiceLinePreview(legacySale, 1000))), 'coinPricingVersion'), false);
  assert.equal(Object.hasOwn(invoiceLinePreview({ ...legacySale, coinPricingVersion: '' }, 1000), 'coinPricingVersion'), false);
});

test('remaining ordinary coins contribute physical gold and current value while profits use recorded purchase cost', () => {
  const row = purchase('ربع عادی');
  const sale = { ...row, id: 'sale', type: 'coin-sale', inventorySourceId: row.id, coinCount: 1, gramPrice: 2000, profitPercent: 0, profitFixed: 0 };
  const stock = inventoryReport([row, sale]);
  const assets = assetReport(stock, { goldGramPrice: 3000 });
  close(assets.goldWeightGrams, 2.022);
  close(assets.goldGrams750, 2.4264);
  close(assets.totalToman, 2.4264 * 3000 * 1.05 + 100);
  const profit = profitReport([row, sale], 'today', date);
  assert.equal(profit.unknown, 0);
  close(profit.cost, 2.4264 * 1000 * 1.05 + 100);
  close(profit.revenue, 2.4264 * 2000);
  assert.equal(filterInventoryItems(stock.items, { minWeight: '2', maxWeight: '2.1' }).items.length, 1);
});

test('partner purchases and sales agree with customer coin amounts at the invoice gold rate', () => {
  for (const type of ['تمام عادی', 'نیم عادی', 'ربع عادی', 'پارسیان', 'گل رز', 'سایر', 'امامی بانکی ۸۶']) {
    for (const direction of ['purchase', 'sale']) {
      const line = { ...newPartnerLine({ goldGramPrice: 500 }, 'coin', direction), ...selectCoin(type),
        itemName: 'سکه', coinCount: 2, coinWeight: 0.5, coinAyar: 900, coinPrice: 5000, gramPrice: 999999,
        wagePercent: 1, wageFixed: 20, otherCosts: 30, profitPercent: 5, profitFixed: 100, inventorySourceId: 'lot' };
      const form = { ...newPartnerInvoice({ goldGramPrice: 1000 }, 'coin', direction), date, lines: [line] };
      const prepared = preparePartnerInvoice(form);
      const totals = partnerInvoiceTotals(prepared);
      const expected = documentBreakdown(prepared.lines[0]).total;
      close(totals.amount, expected);
      close(partnerInvoiceTotals(form).amount, expected);
      close(direction === 'sale' ? totals.goldCredit : totals.goldDebit, Math.round(expected / 1000 * 1e6) / 1e6);
      if (type !== 'امامی بانکی ۸۶') {
        assert.equal(prepared.lines[0].gramPrice, 1000);
        close(totals.weight750, 2 * coinSpec(prepared.lines[0]).weight750);
        close(savedPartnerLineTotals(prepared.lines[0], {}, prepared).weight750, totals.weight750);
      }
    }
  }
});

test('loading legacy partner coin invoices never upgrades their prices through modern defaults', () => {
  const saved = { type: 'purchase', date, calculationVersion: 3, gold18Price: 1000,
    lines: [{ category: 'coin', itemName: 'پارسیان قدیمی', coinType: 'پارسیان', coinCount: 2, parsianWeight: 0.5, parsianPrice: 200 }] };
  const draft = partnerInvoiceDraftFromEntry(saved);
  assert.equal(draft.lines[0].coinPricingVersion, '');
  assert.equal(partnerInvoiceTotals(preparePartnerInvoice(draft)).amount, 400);
  const modern = { ...newPartnerInvoice({ goldGramPrice: 1000 }, 'coin'), date,
    lines: [{ ...newPartnerLine({}, 'coin'), ...selectCoin('پارسیان'), itemName: 'پارسیان', coinWeight: 1, coinAyar: 1001 }] };
  assert.throws(() => preparePartnerInvoice(modern), /عیار/);
});

test('partner versions one through three preserve their own rate and settlement formulas for modern coins', () => {
  for (const version of [1, 2, 3]) {
    const row = { ...purchase('پارسیان'), coinWeight: 0.5, coinAyar: 600, gramPrice: 50000,
      wagePercent: 2, wageFixed: 100, otherCosts: 50, profitPercent: 5, profitFixed: 1000 };
    const form = { ...newPartnerInvoice({ goldGramPrice: 100000 }, 'coin'), date, calculationVersion: version, lines: [row] };
    const prepared = preparePartnerInvoice(form);
    const frozenRate = version === 1 ? 50000 : 100000;
    const expected = (0.8 * frozenRate * 1.02 + 300) * 1.05 + 2000;
    assert.equal(prepared.lines[0].gramPrice, frozenRate);
    assert.equal(prepared.lines[0].profitPercent, 5);
    const totals = partnerInvoiceTotals(prepared);
    const preview = partnerInvoiceTotals(form);
    if (version === 1) {
      close(totals.tomanDebit, expected);
      close(preview.tomanDebit, expected);
    } else {
      close(totals.goldDebit, expected / 100000);
      close(preview.goldDebit, expected / 100000);
    }
    const saved = { ...prepared, type: 'purchase', lines: prepared.lines };
    const restored = preparePartnerInvoice(partnerInvoiceDraftFromEntry(saved));
    assert.equal(restored.lines[0].gramPrice, frozenRate);
    assert.equal(restored.lines[0].profitPercent, 5);
  }
});
