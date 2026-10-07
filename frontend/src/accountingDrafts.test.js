import test from 'node:test';
import assert from 'node:assert/strict';
import { readAccountingDraft, writeAccountingDraft, clearCommittedDraft } from './accountingDrafts.js';

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
  assert.throws(() => writeAccountingDraft('owner', 'document', {}, null, storage));
  assert.doesNotThrow(() => clearCommittedDraft('owner', 'done', storage));
});
