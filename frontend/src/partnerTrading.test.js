import test from 'node:test';
import assert from 'node:assert/strict';
import { assetName, lineAsset, newOperation, newOperationLine, operationDraft, operationPayload, operationPreview, tradeValue } from './partnerTrading.js';
import { groupInvoices, partnerDocumentRows } from './invoices.js';
import { inventoryReport } from './inventory.js';
import { profitReport } from './workspace.js';
import { salesReport } from './sales.js';

test('weight and cash input use the agreed quote with independent cash settlement', () => {
  const form = { ...newOperation(), cashAmount: '۲۵۰۰۰۰۰۰', lines: [{ ...newOperationLine('trade'), quantity: '۱۰', rate: '۴۳۳۱۸۰۰۰' }] };
  assert.deepEqual(tradeValue(form.lines[0]), { quantity: 10, amount: 100000000 });
  assert.deepEqual(operationPreview(form, {}).after, { gold: -10, toman: 75000000 });
  form.cashAmount = '100000000';
  assert.deepEqual(operationPreview(form, {}).after, { gold: -10, toman: 0 });
  form.lines[0] = { ...form.lines[0], direction: 'sale', inputMode: 'amount', amount: '50000000' };
  form.cashDirection = 'receive'; form.cashAmount = '20000000';
  assert.deepEqual(operationPreview(form, {}).after, { gold: 5, toman: -30000000 });
});

test('coin size and purity stay separate; IQD remains currency units', () => {
  const rose = { category: 'coin', coinType: 'گل رز', coinWeight: .3, coinAyar: 999.9 };
  assert.notEqual(lineAsset(rose), lineAsset({ ...rose, coinWeight: .4 }));
  assert.notEqual(lineAsset(rose), lineAsset({ ...rose, coinAyar: 750 }));
  assert.equal(assetName(lineAsset(rose)), 'گل رز');
  assert.equal(lineAsset({ category: 'currency', currencyType: 'IQD' }), 'currency:IQD');
});

test('selective offsets and physical receipts affect only selected balances', () => {
  const partner = { goldBalance: -10, tomanBalance: 100000000, assetBalances: { 'currency:IQD': -100000 } };
  const offset = { ...newOperation('offset'), lines: [{ asset: 'gold', quantity: 3, rate: 11000000 }, { asset: 'toman', quantity: 33000000, rate: 1 }] };
  const preview = operationPreview(offset, partner);
  assert.equal(preview.offsetPayable, preview.offsetReceivable);
  assert.deepEqual(preview.after, { gold: -7, toman: 67000000, 'currency:IQD': -100000 });
  const receipt = { ...newOperation('delivery'), lines: [{ category: 'melted', direction: 'receive', meltedWeight: 5, meltedAyar: 600, rate: 90000000 }] };
  assert.deepEqual(operationPreview(receipt, partner).after, { gold: -6, toman: 100000000, 'currency:IQD': -100000 });
});

test('editing physical payment uses stock units and strips saved-only fields', () => {
  const entry = { type: 'delivery', date: '2026-10-11', lines: [{ asset: 'gold', category: 'melted', direction: 'pay', quantity: 10, stockQuantity: 1, documentId: 'outgoing', inventorySourceId: 'lot', amount: 100000000 }] };
  const payload = operationPayload(operationDraft(entry));
  assert.deepEqual(payload.lines, [{ category: 'melted', direction: 'pay', quantity: 1, inventorySourceId: 'lot' }]);
});

test('delivery changes stock once without creating a second sale or profit', () => {
  const lot = { id: 'lot', type: 'currency-purchase', category: 'currency', currencyType: 'IQD', currencyAmount: 10000, currencyRate: 70, amount: 700000, partnerOperation: true, date: '2026-10-11' };
  const paid = { ...lot, id: 'paid', type: 'currency-sale', inventorySourceId: 'lot', currencyAmount: 1000, amount: 70000 };
  assert.equal(inventoryReport([lot, paid]).available[0].remaining, 9000);
  const helpers = { quantity: row => row.currencyAmount, weight: () => 0, amount: row => row.amount };
  assert.equal(salesReport([lot, paid], 'today', helpers, lot.date).total, 0);
  assert.equal(profitReport([lot, paid], 'today', lot.date).revenue, 0);
  const entry = { id: 'receipt', transactionId: 'tx', invoiceNumber: 1, type: 'delivery', calculationVersion: 5, date: lot.date, createdAt: '2026-10-11T12:00:00Z', goldDebit: 0, goldCredit: 0, tomanDebit: 0, tomanCredit: 0,
    documentIds: ['lot'], lines: [{ category: 'currency', asset: 'currency:IQD', documentId: 'lot', amount: 700000, quantity: 10000 }] };
  const rows = partnerDocumentRows([{ ...lot, transactionId: 'tx' }], [{ id: 'partner', name: 'همکار', entries: [entry] }]);
  assert.equal(rows.length, 1);
  assert.equal(groupInvoices(rows)[0].partnerEntryId, 'receipt');
  assert.equal(groupInvoices(rows)[0].direction, 'دریافت / تحویل واقعی');
});
