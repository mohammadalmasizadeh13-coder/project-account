import test from 'node:test';
import assert from 'node:assert/strict';
import { assignProductCodes, inventoryReport, linkHistoricalSale, normalizeProductCode, saveLedgerRecords, stockSaleForm, validateStockSale, validateStockSales } from './inventory.js';

const entry = { id: 'entry-1', type: 'crafted-purchase', category: 'crafted', date: '2026-09-24', itemName: 'النگو', itemCount: '۳', weight: '2', ayar: '750', gramPrice: '100', wagePercent: '5' };
const sale = { id: 'sale-1', type: 'crafted-sale', category: 'crafted', inventorySourceId: 'entry-1', itemCount: '1', date: '2026-09-24' };

test('incoming lots get stable unique codes including same-name products and old data', () => {
  const docs = assignProductCodes([{ ...entry, id: 'entry-2', weight: '4' }, entry]);
  assert.equal(new Set(docs.map(doc => doc.productCode)).size, 2);
  const next = assignProductCodes([{ ...entry, id: 'entry-3' }, ...docs]);
  assert.equal(next[1].productCode, docs[0].productCode);
  assert.equal(next[2].productCode, docs[1].productCode);
  assert.deepEqual(assignProductCodes(next), next);
  assert.equal(normalizeProductCode(' zg-۰۰۰۰۰۱ '), 'ZG-000001');
});
test('opening and purchase quantities enter vault; partial and final sales reduce only linked lot', () => {
  const docs = assignProductCodes([entry, { ...entry, id: 'entry-2', source: 'opening-inventory', type: 'opening-crafted' }]);
  let report = inventoryReport([sale, ...docs]);
  assert.equal(report.items.find(item => item.id === entry.id).remaining, 2);
  assert.equal(report.items.find(item => item.id === 'entry-2').remaining, 3);
  report = inventoryReport([{ ...sale, itemCount: '3' }, ...docs]);
  assert.equal(report.available.length, 1);
  assert.equal(report.items.find(item => item.id === entry.id).sales.length, 1);
  assert.equal(report.items.length, 2, 'sold-out stock remains in history');
});
test('overselling, fractional quantities, missing stocks, wrong categories and pre-receipt sales fail', () => {
  for (const changes of [{ itemCount: '4' }, { itemCount: '0' }, { itemCount: '-1' }, { itemCount: '.5' }, { inventorySourceId: 'missing' }, { category: 'melted' }, { date: '2026-09-23' }]) assert.ok(validateStockSale({ ...sale, ...changes }, [entry]));
  assert.equal(validateStockSale(sale, [entry]), '');
  assert.ok(validateStockSale({ ...sale, id: 'sale-2', itemCount: '1' }, [{ ...sale, itemCount: '3' }, entry]));
});
test('coin counts and melted piece counts are independent from weight', () => {
  for (const category of ['coin', 'melted']) {
    const doc = { ...entry, category, type: `${category}-purchase`, coinCount: '5', itemCount: '2', meltedWeight: '20', meltedAyar: '780' };
    const sold = { ...sale, category, type: `${category}-sale`, coinCount: '2', itemCount: '1' };
    assert.equal(inventoryReport([doc, sold]).items[0].remaining, category === 'coin' ? 3 : 1);
  }
});
test('selecting stock copies identity and laboratory, uses latest price, preserves customer, clears source debts', () => {
  const item = { ...entry, category: 'melted', productCode: 'ZG-000001', laboratoryName: 'تهران', assayCode: '123', meltedWeight: '4', meltedAyar: '780', gramDebt: 10 };
  const form = stockSaleForm(item, { customerName: 'خریدار', date: '2026-09-24', gramDebt: '' }, { goldGramPrice: '200' });
  assert.equal(form.customerName, 'خریدار'); assert.equal(form.laboratoryName, 'تهران'); assert.equal(form.meltedGramPrice, '200');
  assert.equal(form.inventorySourceId, entry.id); assert.equal(form.type, 'melted-sale'); assert.equal(form.gramDebt, '');
});

test('new sales default to seven percent profit without changing recorded stock', () => {
  for (const category of ['crafted', 'melted', 'coin', 'currency']) {
    const item = Object.freeze({ ...entry, category, profitPercent: '2' });
    const draft = Object.freeze({ customerName: 'خریدار', profitPercent: '11' });
    const form = stockSaleForm(item, draft);
    assert.equal(form.profitPercent, '7');
    assert.equal(item.profitPercent, '2');
    assert.equal(draft.profitPercent, '11');
  }
});
test('legacy sales require explicit linking; linking affects stock once and preserves accounting', () => {
  const oldSale = { ...sale, inventorySourceId: '', amount: 500, gramDebt: 1, itemSummary: 'old summary' };
  const docs = assignProductCodes([oldSale, entry]);
  assert.equal(inventoryReport(docs).unlinkedSales.length, 1);
  assert.equal(inventoryReport(docs).items[0].remaining, 3);
  const linked = linkHistoricalSale(docs, oldSale.id, entry.id);
  assert.equal(inventoryReport(linked).items[0].remaining, 2);
  assert.equal(linked[0].amount, 500); assert.equal(linked[0].itemSummary, oldSale.itemSummary);
  assert.throws(() => linkHistoricalSale(linked, oldSale.id, entry.id), /قبلاً/);
});
test('storage failure rolls back customer change and cannot create stock movement without its sale', () => {
  const data = new Map([['customers', '[{"id":"old"}]'], ['docs', '[]']]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => { if (key === 'docs') throw Error('quota'); data.set(key, value); }, removeItem: key => data.delete(key) };
  assert.throws(() => saveLedgerRecords(storage, 'docs', 'customers', [sale], [{ id: 'new' }]), /quota/);
  assert.equal(data.get('customers'), '[{"id":"old"}]'); assert.equal(data.get('docs'), '[]');
});

test('batch validation accumulates repeated stock picks and leaves the input ledger untouched', () => {
  const first = { ...sale, id: undefined, itemCount: '2' };
  const second = { ...sale, id: undefined, itemCount: '2' };
  const documents = [{ ...entry }];
  const before = JSON.stringify(documents);
  assert.ok(validateStockSales([first, second], documents));
  assert.equal(validateStockSales([first, { ...second, itemCount: '1' }], documents), '');
  assert.equal(JSON.stringify(documents), before);
});

test('batch replacement removes the old sale quantities once before validating the replacement', () => {
  const old = { ...sale, itemCount: '3' };
  assert.equal(validateStockSales([{ ...old, itemCount: '2' }, { ...sale, id: 'sale-2' }], [entry, old]), '');
  assert.ok(validateStockSales([{ ...old, itemCount: '2' }, { ...sale, id: 'sale-2', itemCount: '2' }], [entry, old]));
});

test('individual stock selection preserves group identity and clears any previous batch draft', () => {
  const item = { ...entry, setId: 'set-1', setName: 'نیم‌ست', setKind: 'نیم‌ست', setMode: 'separate', setPieceCount: 3 };
  const draft = stockSaleForm(item, { setParts: [{ id: 'old-piece' }] });
  for (const key of ['setId', 'setName', 'setKind', 'setMode', 'setPieceCount']) assert.equal(draft[key], item[key]);
  assert.deepEqual(draft.setParts, []);
  assert.equal(stockSaleForm(entry, draft).setId, '', 'selecting an unrelated lot clears the prior membership');
});
