import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { goldBalance, goldBalancePurchases, goldPurchasesReport, invoiceCount, iranDate, salesReport } from './sales.js';
import { quantity, documentBreakdown, currencyName, currencyRate, coinCatalog } from './assets.js';
import { validateDocument } from './documentValidation.js';
import { profitPercentInput } from './profitDefaults.js';
import { isMiscPurchase, miscGoldWeight750, miscGoldDefaults } from './miscGold.js';
import { expandSetForm, isJewelrySetKind, isSeparateSetForm, validateSetForm } from './jewelrySets.js';
const dependencies = { isMiscPurchase, miscGoldWeight750, miscGoldDefaults, quantity, documentBreakdown, currencyName, currencyRate, validateDocument, profitPercentInput, expandSetForm, isJewelrySetKind, isSeparateSetForm, validateSetForm, stockQuantity: quantity, coinPriceFields: Object.fromEntries(coinCatalog.map(coin => [coin.name, coin.price])), CircleDollarSign: null };
const dependencySource = 'const { isMiscPurchase, miscGoldWeight750, miscGoldDefaults, quantity, documentBreakdown, currencyName, currencyRate, validateDocument, profitPercentInput, expandSetForm, isJewelrySetKind, isSeparateSetForm, validateSetForm, stockQuantity, coinPriceFields, CircleDollarSign } = dependencies;';

// Exercise the existing ledger's financial calculations, not copies of them.
const source = readFileSync(new URL('./AccountingApp.jsx', import.meta.url), 'utf8');
const digitMap = source.slice(source.indexOf('const digitMap'), source.indexOf('function createEmptyDocumentForm'));
const calculations = source.slice(source.indexOf('function normalizeNumberInput'), source.indexOf('function isOpeningItemBlank'));
const helpers = new Function('dependencies', `${dependencySource}\n${digitMap}\n${calculations}\nreturn { quantity: getDocumentQuantity, weight: getDocumentWeight, amount: getDocumentAmount };`)(dependencies);
const today = '2026-09-23';
const crafted = { type: 'crafted-sale', category: 'crafted', date: today, itemName: 'Bracelet', itemCount: '2', weight: '3', gramPrice: '100', wagePercent: '10', profitPercent: '5', discountRial: '13' };

test('sales keep the invoice amount and exclude purchases, opening stock and future records', () => {
  const report = salesReport([
    { ...crafted, amount: 680, currentAmount: 999999 },
    { ...crafted, type: 'crafted-purchase', amount: 5000 },
    { ...crafted, source: 'opening-inventory', amount: 5000 },
    { ...crafted, date: '2026-09-24', amount: 5000 },
  ], 'today', helpers, today);
  assert.equal(report.total, 680);
  assert.equal(report.count, 2);
  assert.equal(report.totalWeight, 6);
  assert.equal(report.invoices, 1);
});

test('groups repeated products and coin types; handles melted purity and Parsian weight', () => {
  const report = salesReport([
    crafted, { ...crafted, itemCount: '1' },
    { type: 'coin-sale', category: 'coin', date: today, coinType: 'Emami', coinCount: '3', coinPrice: '1000' },
    { type: 'coin-sale', category: 'coin', date: today, coinType: '\u067e\u0627\u0631\u0633\u06cc\u0627\u0646', coinCount: '2', parsianWeight: '0.5', parsianPrice: '100' },
    { type: 'melted-sale', category: 'melted', date: today, itemCount: '2', meltedWeight: '10', meltedAyar: '780', meltedGramPrice: '100' },
  ], 'today', helpers, today);
  assert.equal(report.total, 6293.5);
  assert.equal(report.count, 10);
  assert.equal(report.totalWeight, 30.8);
  assert.equal(report.products.find(item => item.name === 'Bracelet').quantity, 3);
  assert.equal(report.products.length, 4);
  assert.equal(report.categories.reduce((sum, item) => sum + item.amount, 0), report.total);
});

test('inclusive seven-day and thirty-day periods use Tehran dates, with empty days retained', () => {
  assert.equal(iranDate(new Date('2026-09-22T21:00:00Z')), today);
  const records = ['2026-08-24', '2026-08-25', '2026-09-16', '2026-09-17', today].map(date => ({ ...crafted, date, amount: 10 }));
  assert.equal(salesReport(records, 'today', helpers, today).total, 10);
  const week = salesReport(records, 'week', helpers, today);
  assert.equal(week.total, 20);
  assert.equal(week.series.length, 7);
  assert.equal(week.series[1].amount, 0);
  assert.equal(salesReport(records, 'month', helpers, today).total, 40);
});

test('empty reports and zero-valued discounted sales remain valid', () => {
  assert.equal(salesReport([], 'today', helpers, today).total, 0);
  assert.equal(salesReport([{ ...crafted, amount: 0 }], 'today', helpers, today).total, 0);
});

test('joint sales count one invoice while retaining each piece amount, quantity, weight and product', () => {
  const common = { ...crafted, setId: 'set', transactionId: 'sale-batch', itemCount: 1, setMode: 'separate' };
  const lines = [
    { ...common, id: 'bracelet-a', amount: 100, weight: 2 },
    { ...common, id: 'bracelet-b', amount: 150, weight: 3 },
    { ...common, id: 'necklace', itemName: 'Necklace', amount: 200, weight: 4 },
    { ...common, id: 'later-sale', transactionId: 'second-sale', amount: 75, weight: 1 },
    { ...crafted, id: 'legacy-sale', itemCount: 1, amount: 50, weight: 1 },
  ];
  const report = salesReport(lines, 'today', helpers, today);
  assert.equal(report.total, 575);
  assert.equal(report.count, 5);
  assert.equal(report.totalWeight, 11);
  assert.equal(report.invoices, 3);
  assert.equal(report.products.find(product => product.name === 'Bracelet').invoices, 3);
  assert.equal(report.products.find(product => product.name === 'Bracelet').amount, 375);
  assert.equal(report.products.find(product => product.name === 'Necklace').invoices, 1);
  assert.equal(report.categories.reduce((sum, category) => sum + category.amount, 0), 575);
  assert.equal(report.series.reduce((sum, day) => sum + day.amount, 0), 575);
});

test('invoice counting preserves independent legacy rows and unifies only explicit transaction identities', () => {
  assert.equal(invoiceCount([{ id: 'old-a' }, { id: 'old-b' }, {}, {}]), 4);
  assert.equal(invoiceCount([{ id: 'a', transactionId: 'one' }, { id: 'b', transactionId: 'one' }, { id: 'c', transactionId: 'two' }]), 2);
  assert.equal(invoiceCount([]), 0);
});

test('gold balance converts invoice totals at the current gram rate, including all sale types', () => {
  assert.equal(goldBalance(680, 200), 3.4);
  assert.equal(goldBalance(680, 400), 1.7);
  assert.equal(goldBalance(0, 200), 0);
  for (const rate of [0, -10, '', undefined, NaN, Infinity]) assert.equal(goldBalance(680, rate), null);
});

test('purchased gold reduces the balance and preserves negative and zero balances', () => {
  assert.equal(goldBalance(1400, 100, 15), -1);
  assert.equal(goldBalance(1400, 100, 14), 0);
  assert.equal(goldBalance(1400, 100, 10), 4);
  assert.equal(goldBalance(0, 100, 15), -15);
  assert.equal(goldBalance(1400, 0, 15), null);
});

test('gold purchases use the same inclusive date windows as sales', () => {
  const purchases = ['2026-08-24', '2026-08-25', '2026-09-16', '2026-09-17', today, today, '2026-09-24'].map(date => ({ date, grams: 2.5 }));
  assert.equal(goldPurchasesReport(purchases, 'today', today).total, 5);
  assert.equal(goldPurchasesReport(purchases, 'week', today).total, 7.5);
  assert.equal(goldPurchasesReport(purchases, 'month', today).total, 12.5);
  assert.equal(goldPurchasesReport([], 'today', today).total, 0);
});

test('balance purchases combine legacy entries with only marked partner melted purchases at physical weight', () => {
  const legacy = { id: 'legacy', date: today, grams: 1.25, note: 'Earlier purchase' };
  const document = {
    id: 'melted-a', date: today, source: 'partner-invoice', type: 'melted-purchase',
    goldBalancePurchase: true, transactionId: 'purchase', totalWeight750: '3.8',
    partnerGoldDebit: 8, principalGold: 7, laborGold: 1, amount: 800,
    invoiceNumber: 4, externalInvoiceNumber: 'P-17', customerName: 'Supplier',
    description: 'Assayed gold', recordedAt: '2026-09-23T09:00:00.000Z',
  };
  const records = goldBalancePurchases([legacy], [
    document,
    { ...document, id: 'melted-b', totalWeight750: 2 },
    { ...document, id: 'ordinary', goldBalancePurchase: undefined },
    { ...document, id: 'disabled', goldBalancePurchase: false },
    { ...document, id: 'opening', source: 'opening-inventory' },
    { ...document, id: 'sale', type: 'melted-sale' },
    { ...document, id: 'crafted', type: 'crafted-purchase' },
    { ...document, id: 'missing-weight', totalWeight750: undefined },
    { ...document, id: 'invalid-weight', totalWeight750: 'invalid' },
    { ...document, id: 'zero-weight', totalWeight750: 0 },
  ]);
  assert.equal(records.length, 3);
  assert.equal(goldPurchasesReport(records, 'today', today).total, 7.05);
  assert.equal(goldBalance(1000, 100, goldPurchasesReport(records, 'today', today).total), 2.95);
  assert.equal(records[0].purchaseSource, 'legacy');
  assert.equal(records[1].purchaseSource, 'invoice');
  assert.equal(records[1].invoiceNumber, 4);
  assert.equal(records[1].externalInvoiceNumber, 'P-17');
  assert.equal(records[1].customerName, 'Supplier');
  assert.equal(records[1].note, 'Assayed gold');
  assert.equal(records[1].recordedAt, document.recordedAt);
  assert.equal(legacy.purchaseSource, undefined, 'normalization leaves stored legacy data unchanged');
  assert.equal(document.grams, undefined, 'normalization leaves the invoice unchanged');
});

test('balance purchases follow authoritative invoice edits and deletions without a second purchase record', () => {
  const legacy = [{ id: 'earlier', date: today, grams: 2 }];
  const document = { id: 'melted', date: today, source: 'partner-invoice', type: 'melted-purchase', goldBalancePurchase: true, totalWeight750: 5 };
  const total = documents => goldPurchasesReport(goldBalancePurchases(legacy, documents), 'today', today).total;
  assert.equal(total([document]), 7);
  assert.equal(total([{ ...document, totalWeight750: 8 }]), 10);
  assert.equal(total([{ ...document, date: '2026-09-22' }]), 2);
  assert.equal(total([]), 2);
});

test('linked and legacy balance purchases share inclusive daily, weekly and monthly windows', () => {
  const dates = ['2026-08-24', '2026-08-25', '2026-09-16', '2026-09-17', today, '2026-09-24'];
  const legacy = dates.map(date => ({ id: `legacy-${date}`, date, grams: 1 }));
  const documents = dates.map(date => ({ id: `invoice-${date}`, date, source: 'partner-invoice', type: 'melted-purchase', goldBalancePurchase: true, totalWeight750: 2 }));
  const records = goldBalancePurchases(legacy, documents);
  assert.equal(goldPurchasesReport(records, 'today', today).total, 3);
  assert.equal(goldPurchasesReport(records, 'week', today).total, 6);
  assert.equal(goldPurchasesReport(records, 'month', today).total, 12);
  assert.deepEqual(goldBalancePurchases(), []);
});

test('melted documents preserve the laboratory in opening stock and summaries', () => {
  const openingFunctions = source.slice(source.indexOf('function isOpeningItemBlank'), source.indexOf('function OpeningInventoryPage('));
  const constants = source.slice(source.indexOf('const openingCategoryMeta'), source.indexOf('const digitMap'));
  const functions = new Function('dependencies', 'iranDate', 'Gem', 'Coins', 'FileText', 'newRecordTimestamp', `${dependencySource}\n${constants}\n${digitMap}\n${calculations}\n${openingFunctions}\nreturn { describeDocumentItem, isOpeningItemBlank, validateOpeningItem, createOpeningDocumentFromItem };`)(dependencies, () => today, null, null, null, () => '2026-09-24T10:15:00.000Z');
  const item = { category: 'melted', itemName: ' آب‌شده تهران ', itemCount: '1', meltedWeight: '10', meltedAyar: '750', assayCode: '123', laboratoryName: '  آزمایشگاه تهران  ' };
  assert.equal(functions.validateOpeningItem(item, { goldGramPrice: '100' }), '');
  assert.match(functions.validateOpeningItem({ ...item, laboratoryName: ' ' }, { goldGramPrice: '100' }), /آزمایشگاه/);
  assert.equal(functions.isOpeningItemBlank({ category: 'melted', laboratoryName: 'تهران' }), false);
  assert.equal(functions.isOpeningItemBlank({ category: 'coin', itemName: 'سکه نمونه' }), false);
  assert.equal(functions.isOpeningItemBlank({ category: 'crafted', craftedKind: 'انگشتر' }), false);
  assert.equal(functions.isOpeningItemBlank({ category: 'crafted', profitPercent: '7' }), true, 'default profit alone does not fill an empty opening row');
  assert.equal(functions.isOpeningItemBlank({ category: 'crafted', profitPercent: '' }), true);
  assert.equal(functions.isOpeningItemBlank({ category: 'crafted', profitPercent: '0' }), false, 'an explicit change remains part of the draft');
  assert.match(functions.validateOpeningItem({ ...item, itemName: ' ' }, { goldGramPrice: '100' }), /نام جنس/);
  const document = functions.createOpeningDocumentFromItem(item, { goldGramPrice: '100' }, 0);
  assert.equal(document.itemName, 'آب‌شده تهران');
  assert.equal(document.laboratoryName, 'آزمایشگاه تهران');
  assert.equal(document.recordedAt, '2026-09-24T10:15:00.000Z');
  assert.match(document.itemSummary, /آزمایشگاه تهران/);
  assert.doesNotThrow(() => functions.describeDocumentItem({ ...item, laboratoryName: undefined }));
  const craftedItem = { category: 'crafted', itemName: 'انگشتر', craftedKind: 'انگشتر', itemCount: '1', weight: '2', ayar: '750', wagePercent: '0', profitPercent: '' };
  const craftedDocument = functions.createOpeningDocumentFromItem(craftedItem, { goldGramPrice: '100' });
  assert.equal(craftedDocument.profitPercent, '7');
  assert.equal(craftedDocument.amount, 214);
  assert.equal(craftedDocument.currentAmount, 214);
  assert.equal(functions.createOpeningDocumentFromItem({ ...craftedItem, profitPercent: '۰' }, { goldGramPrice: '100' }).amount, 200);
});
