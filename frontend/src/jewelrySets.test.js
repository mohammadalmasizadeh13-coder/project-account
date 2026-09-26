import test from 'node:test';
import assert from 'node:assert/strict';
import { documentBreakdown } from './assets.js';
import { assignProductCodes, inventoryReport, stockSaleForm } from './inventory.js';
import { createSetPart, expandSetForm, isJewelrySetKind, isSeparateSetForm, validateSetForm } from './jewelrySets.js';

const part = values => createSetPart({ craftedKind: 'گردنبند', weight: '3', gramPrice: '100', ...values });
const setForm = values => ({
  type: 'crafted-purchase', category: 'crafted', customerName: 'طرف حساب', date: '2026-09-25',
  gold18Price: '100', itemName: 'نیم‌ست طرح برگ', craftedKind: 'نیم‌ست', setMode: 'separate',
  gramDebt: '2', rialDebt: '500', setParts: [part(), part({ craftedKind: 'دستبند', weight: '2', wagePercent: '10' })], ...values,
});
const stockDocuments = form => assignProductCodes(expandSetForm(form, { setId: 'set-1', transactionId: 'purchase-1' }).map((row, i) => ({ ...row, id: `entry-${i}` })));

test('set kinds include both full sets and half sets; individual pieces do not activate group mode', () => {
  for (const kind of ['نیم‌ست', 'نیم ست', 'ست', 'سرویس']) assert.equal(isJewelrySetKind(kind), true);
  assert.equal(isJewelrySetKind('گردنبند'), false);
  assert.equal(isSeparateSetForm(setForm()), true);
  assert.equal(isSeparateSetForm(setForm({ category: 'coin' })), false);
  assert.equal(isSeparateSetForm(setForm({ craftedKind: 'دستبند' })), false);
  assert.equal(isSeparateSetForm(setForm({ setMode: 'together' })), false);
  assert.notEqual(createSetPart().id, createSetPart().id);
});

test('arbitrary sets expand into any number of independent pieces, without a parent inventory entry', () => {
  const form = setForm({ setParts: [part({ craftedKind: 'گوشواره' }), part({ craftedKind: 'پابند' }), part({ craftedKind: 'دستبند' }), part({ craftedKind: 'سایر', itemName: 'سنجاق طلا' })] });
  assert.deepEqual(validateSetForm(form), {});
  const documents = stockDocuments(form);
  assert.equal(documents.length, 4);
  assert.deepEqual(documents.map(doc => doc.craftedKind), ['گوشواره', 'پابند', 'دستبند', 'سایر']);
  assert.equal(documents[3].itemName, 'سنجاق طلا');
  assert.equal(new Set(documents.map(doc => doc.productCode)).size, 4);
  assert.equal(inventoryReport(documents).items.length, 4);
  for (const doc of documents) {
    assert.equal(doc.setId, 'set-1'); assert.equal(doc.setKind, 'نیم‌ست'); assert.equal(doc.setName, form.itemName);
    assert.equal(doc.setPieceCount, 4); assert.equal(doc.transactionId, 'purchase-1');
    assert.equal('setParts' in doc, false);
  }
});

test('piece weights and wages produce their own amounts, and aggregate debt is recorded only once', () => {
  const documents = expandSetForm(setForm());
  assert.deepEqual(documents.map(doc => documentBreakdown(doc).total), [300, 220]);
  assert.deepEqual(documents.map(doc => doc.gramDebt), ['2', 0]);
  assert.deepEqual(documents.map(doc => doc.rialDebt), ['500', 0]);
  assert.equal(new Set(documents.map(doc => doc.setId)).size, 1);
});

test('piece data cannot override shared customer, date, type, rate snapshot, or debt', () => {
  const form = setForm();
  Object.assign(form.setParts[0], { customerName: 'other', customerId: 'other', date: '2000-01-01', type: 'crafted-sale', category: 'coin', gold18Price: 5, gramDebt: 999, rialDebt: 999, selected: true, remaining: 3, setParts: [{}] });
  const row = expandSetForm(form)[0];
  assert.equal(row.customerName, form.customerName); assert.equal(row.customerId, undefined);
  assert.equal(row.type, form.type); assert.equal(row.category, 'crafted'); assert.equal(row.date, form.date);
  assert.equal(row.gold18Price, form.gold18Price); assert.equal(row.gramDebt, '2'); assert.equal(row.rialDebt, '500');
  for (const key of ['id', 'selected', 'remaining', 'setParts']) assert.equal(key in row, false);
});

test('together and legacy sets remain one stock item, ignoring stale part drafts', () => {
  for (const kind of ['نیم‌ست', 'ست', 'سرویس']) {
    const form = setForm({ craftedKind: kind, setMode: 'together', itemCount: '1', weight: '5', gramPrice: '100', ayar: '750', wagePercent: '0' });
    assert.deepEqual(validateSetForm(form), {});
    const rows = expandSetForm(form);
    assert.equal(rows.length, 1); assert.equal(rows[0].weight, '5'); assert.equal(rows[0].setMode, 'together');
    assert.equal(rows[0].setKind, kind); assert.equal('setParts' in rows[0], false);
    assert.equal(inventoryReport([{ ...rows[0], id: 'together' }]).items.length, 1);
    assert.equal(expandSetForm({ ...form, setMode: undefined }).length, 1);
  }
});

test('single-piece sales keep their set membership and only deplete their source', () => {
  const documents = stockDocuments(setForm());
  const saleDraft = stockSaleForm(documents[1], { date: '2026-09-25', customerName: 'خریدار', gold18Price: '100', setParts: [part()] });
  assert.equal(isSeparateSetForm(saleDraft), false);
  const [sale] = expandSetForm(saleDraft);
  assert.equal(sale.setId, 'set-1'); assert.equal(sale.setPieceCount, 2); assert.equal(sale.setMode, 'separate');
  assert.equal('setParts' in sale, false);
  const inventory = inventoryReport([{ ...sale, id: 'sale-1', category: 'crafted' }, ...documents]);
  assert.deepEqual(inventory.items.map(item => item.remaining), [1, 0]);
});

test('ordinary rows and other asset categories do not inherit set metadata from picker defaults or stale fields', () => {
  const metadata = { setMode: 'together', setName: 'old set', setKind: 'نیم‌ست', setId: 'old-set', setPieceCount: 2 };
  for (const category of ['crafted', 'coin', 'melted', 'currency']) {
    const [row] = expandSetForm({ category, type: `${category}-purchase`, craftedKind: 'انگشتر', ...metadata });
    for (const key of Object.keys(metadata)) assert.equal(key in row, false, `${category}: ${key}`);
  }
  const [currency] = expandSetForm({ ...metadata, category: 'currency', craftedKind: 'نیم‌ست', setMode: 'separate' });
  assert.equal('setId' in currency, false);
  assert.equal('setMode' in currency, false);
  const [orphan] = expandSetForm({ category: 'crafted', craftedKind: 'انگشتر', setMode: 'separate', setKind: 'نیم‌ست' });
  assert.equal('setMode' in orphan, false);
});

test('batch sales select any remaining pieces, keep original group size, and assign debt to first selected', () => {
  const documents = stockDocuments(setForm({ setParts: [part(), part({ craftedKind: 'گوشواره' }), part({ craftedKind: 'پابند' })] }));
  const sale = setForm({ type: 'crafted-sale', setId: 'set-1', setParts: documents.map(item => ({ ...stockSaleForm(item, {}), id: item.id })) });
  sale.setParts[0].selected = false;
  assert.deepEqual(validateSetForm(sale, documents), {});
  const expanded = expandSetForm(sale, { transactionId: 'sale-batch' });
  assert.equal(expanded.length, 2); assert.equal(expanded[0].gramDebt, '2'); assert.equal(expanded[1].gramDebt, 0);
  for (const row of expanded) { assert.equal(row.setPieceCount, 3); assert.equal(row.transactionId, 'sale-batch'); }
  assert.deepEqual(inventoryReport([...expanded.map((row, index) => ({ ...row, id: `sale-${index}` })), ...documents]).items.map(item => item.remaining), [1, 0, 0]);
  assert.ok(validateSetForm({ ...sale, setParts: sale.setParts.map(row => ({ ...row, selected: false })) }, documents).setParts);
});

test('a depleted or duplicated piece rejects the entire batch before any inventory mutation', () => {
  const documents = stockDocuments(setForm());
  const sold = { ...stockSaleForm(documents[0], {}), id: 'old-sale', category: 'crafted', date: '2026-09-25' };
  const sale = setForm({ type: 'crafted-sale', setParts: documents.map(item => ({ ...stockSaleForm(item, {}), id: item.id })) });
  const current = [sold, ...documents];
  const snapshot = JSON.stringify(current);
  assert.ok(validateSetForm(sale, current).setParts);
  assert.equal(JSON.stringify(current), snapshot);
  sale.setParts = [sale.setParts[1], { ...sale.setParts[1], id: 'duplicate' }];
  assert.ok(validateSetForm(sale, current).setParts);
});

test('validation reports shared and per-piece errors and permits custom composition', () => {
  assert.ok(validateSetForm(setForm({ setParts: [] })).setParts);
  assert.ok(validateSetForm(setForm({ setParts: [part()] })).setParts);
  const invalid = part({ craftedKind: 'سایر', itemName: '', itemCount: '1.5', weight: '0', wagePercent: '-1' });
  const form = setForm({ date: 'bad', gold18Price: '', setParts: [invalid, part({ craftedKind: 'نیم‌ست' })] });
  const errors = validateSetForm(form);
  assert.ok(errors.date); assert.ok(errors.gold18Price);
  for (const key of ['itemName', 'itemCount', 'weight', 'wagePercent']) assert.ok(errors[`setParts.${invalid.id}.${key}`], key);
  assert.ok(errors[`setParts.${form.setParts[1].id}.craftedKind`]);
  assert.deepEqual(validateSetForm(setForm({ setParts: [part({ itemCount: '۲' }), part()] })), {});
});

test('opening inventory inherits a later parent gram price and does not require a trade gold snapshot', () => {
  const form = setForm({ type: 'opening-crafted', source: 'opening-inventory', customerName: '', gold18Price: undefined, gramPrice: '250', setParts: [part({ gramPrice: '' }), part({ craftedKind: 'دستبند', gramPrice: '200' })] });
  assert.deepEqual(validateSetForm(form), {});
  const rows = expandSetForm(form);
  assert.deepEqual(rows.map(row => row.gramPrice), ['250', '200']);
});
