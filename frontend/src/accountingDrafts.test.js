import test from 'node:test';
import assert from 'node:assert/strict';
import { readAccountingDraft, readDocumentDraft, writeAccountingDraft, clearCommittedDraft } from './accountingDrafts.js';

function memory() {
  const entries = new Map();
  return { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) };
}

test('draft values and pending identity survive reload and stay isolated by account and form', () => {
  const storage = memory();
  const form = { itemName: 'انگشتر', weight: '۲٫۵', customerName: 'مشتری', setParts: [{ weight: '۱' }] };
  writeAccountingDraft('owner', 'document', form, 'request-1', storage);
  assert.deepEqual(readAccountingDraft('owner', 'document', storage), { version: 1, form, requestId: 'request-1' });
  assert.equal(readAccountingDraft('staff', 'document', storage), null);
  assert.equal(readAccountingDraft('owner', 'opening', storage), null);
});

test('acknowledgment only clears the draft that belongs to the confirmed request', () => {
  const storage = memory();
  writeAccountingDraft('owner', 'document', { itemName: 'saved' }, 'done', storage);
  writeAccountingDraft('owner', 'opening', { items: [{ itemName: 'unsent' }] }, null, storage);
  writeAccountingDraft('staff', 'document', { itemName: 'private' }, 'done', storage);
  clearCommittedDraft('owner', 'done', storage);
  assert.equal(readAccountingDraft('owner', 'document', storage), null);
  assert.equal(readAccountingDraft('owner', 'opening', storage).form.items[0].itemName, 'unsent');
  assert.equal(readAccountingDraft('staff', 'document', storage).form.itemName, 'private');
});

test('unavailable browser storage cannot crash initial draft reads or turn database acknowledgment into failure', () => {
  const storage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  assert.equal(readAccountingDraft('owner', 'document', storage), null);
  assert.equal(readDocumentDraft('owner', 'document', storage), null);
  assert.equal(readDocumentDraft('owner', 'expense', storage), null);
  assert.throws(() => writeAccountingDraft('owner', 'document', {}, null, storage));
  assert.doesNotThrow(() => clearCommittedDraft('owner', 'done', storage));
});

test('legacy expense recovery preserves the pending request without writing or appearing in customer registration', () => {
  const storage = memory();
  const form = { type: 'expense', itemName: 'Rent', amount: '1250' };
  writeAccountingDraft('owner', 'document', form, 'uncertain-expense-request', storage);
  const readOnlyStorage = { getItem: storage.getItem, setItem() { assert.fail('Reading cannot overwrite a pending draft'); }, removeItem() { assert.fail('Reading cannot delete a pending draft'); } };
  const recovered = { version: 1, form, requestId: 'uncertain-expense-request' };
  assert.deepEqual(readDocumentDraft('owner', 'expense', readOnlyStorage), recovered);
  assert.equal(readDocumentDraft('owner', 'document', readOnlyStorage), null);
  assert.deepEqual(readAccountingDraft('owner', 'document', storage), recovered);
  assert.equal(readAccountingDraft('owner', 'expense', storage), null);
  assert.equal(readDocumentDraft('staff', 'expense', readOnlyStorage), null);
});

test('customer and store drafts stay isolated by account and form', () => {
  const storage = memory();
  const customer = { type: 'sale', itemName: 'Ring', customerName: 'Customer' };
  const expense = { type: 'expense', itemName: 'Electricity' };
  writeAccountingDraft('owner', 'document', customer, 'customer-request', storage);
  writeAccountingDraft('owner', 'expense', expense, 'expense-request', storage);
  writeAccountingDraft('staff', 'document', { type: 'sale', itemName: 'Staff sale' }, 'staff-request', storage);
  assert.deepEqual(readDocumentDraft('owner', 'document', storage), { version: 1, form: customer, requestId: 'customer-request' });
  assert.deepEqual(readDocumentDraft('owner', 'expense', storage), { version: 1, form: expense, requestId: 'expense-request' });
  assert.equal(readDocumentDraft('staff', 'expense', storage), null);
  assert.equal(readDocumentDraft('staff', 'document', storage).requestId, 'staff-request');
});

test('the dedicated expense draft takes precedence over a legacy expense', () => {
  const storage = memory();
  writeAccountingDraft('owner', 'document', { type: 'expense', itemName: 'Legacy rent' }, 'legacy-request', storage);
  writeAccountingDraft('owner', 'expense', { type: 'expense', itemName: 'New expense' }, 'new-request', storage);
  assert.equal(readDocumentDraft('owner', 'expense', storage).requestId, 'new-request');
  assert.equal(readAccountingDraft('owner', 'document', storage).requestId, 'legacy-request');
});

test('expense recovery rejects customer drafts in either storage location', () => {
  const storage = memory();
  writeAccountingDraft('owner', 'document', { type: 'sale', itemName: 'Customer sale' }, 'customer-request', storage);
  writeAccountingDraft('owner', 'expense', { type: 'purchase', itemName: 'Customer purchase' }, 'misplaced-request', storage);
  assert.equal(readDocumentDraft('owner', 'expense', storage), null);
  writeAccountingDraft('owner', 'document', { type: 'expense', itemName: 'Legacy expense' }, 'legacy-request', storage);
  assert.equal(readDocumentDraft('owner', 'expense', storage).requestId, 'legacy-request');
});

test('expense acknowledgment preserves customer, opening, and other account drafts', () => {
  const storage = memory();
  writeAccountingDraft('owner', 'document', { type: 'sale' }, 'customer-request', storage);
  writeAccountingDraft('owner', 'expense', { type: 'expense' }, 'done', storage);
  writeAccountingDraft('owner', 'opening', { items: [] }, 'opening-request', storage);
  writeAccountingDraft('staff', 'expense', { type: 'expense' }, 'done', storage);
  clearCommittedDraft('owner', 'done', storage);
  assert.equal(readAccountingDraft('owner', 'expense', storage), null);
  assert.equal(readAccountingDraft('owner', 'document', storage).requestId, 'customer-request');
  assert.equal(readAccountingDraft('owner', 'opening', storage).requestId, 'opening-request');
  assert.equal(readAccountingDraft('staff', 'expense', storage).requestId, 'done');
});

test('acknowledgment clears both copies of a migrated expense request', () => {
  const storage = memory();
  writeAccountingDraft('owner', 'document', { type: 'expense' }, 'done', storage);
  writeAccountingDraft('owner', 'expense', { type: 'expense' }, 'done', storage);
  clearCommittedDraft('owner', 'done', storage);
  assert.equal(readAccountingDraft('owner', 'document', storage), null);
  assert.equal(readAccountingDraft('owner', 'expense', storage), null);
});

test('acknowledgment of an older expense preserves its newer replacement', () => {
  const storage = memory();
  writeAccountingDraft('owner', 'document', { type: 'expense' }, 'old-request', storage);
  writeAccountingDraft('owner', 'expense', { type: 'expense' }, 'new-request', storage);
  clearCommittedDraft('owner', 'old-request', storage);
  assert.equal(readAccountingDraft('owner', 'document', storage), null);
  assert.equal(readDocumentDraft('owner', 'expense', storage).requestId, 'new-request');
});
