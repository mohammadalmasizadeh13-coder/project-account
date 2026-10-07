import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceStorage, emptyWorkspace } from './ownerStorage.js';

test('partner invoice waits for existing writes and hydrates stock and partner balances together', async () => {
  const calls = [];
  const storage = createWorkspaceStorage(async (path, options) => {
    calls.push({ path, ...options });
    if (path === '/api/owner/workspace') return { revision: 1 };
    return { revision: 2, data: { ...emptyWorkspace(), documents: [{ id: 'stock' }], partners: [{ id: 'supplier', entries: [{ goldDebit: 5.0718 }] }] } };
  }, 60_000);
  storage.hydrate({ revision: 0, data: emptyWorkspace() });
  storage.setItem('zarngarPrices:user', JSON.stringify({ goldGramPrice: 7500000 }));
  await storage.mutatePartner('invoice', 'supplier', { lines: [{ weight: 4.740, ayar: 750, wagePercent: 7 }] }, 'same-request');
  assert.equal(calls[0].path, '/api/owner/workspace');
  assert.equal(calls[1].path, '/api/owner/partners/supplier/invoices');
  assert.equal(calls[1].body.revision, 1);
  assert.equal(calls[1].body.requestId, 'same-request');
  assert.equal(storage.snapshot().documents[0].id, 'stock');
  assert.equal(storage.snapshot().partners[0].entries[0].goldDebit, 5.0718);
  assert.equal(storage.status().revision, 2);
  storage.clear();
});

test('failed acknowledgment can replay the same supplier request without losing local state', async () => {
  const calls = [];
  const storage = createWorkspaceStorage(async (path, options) => {
    calls.push(options.body);
    if (calls.length === 1) throw new Error('network failed');
    return { revision: 1, data: { ...emptyWorkspace(), partners: [{ id: 'one' }] } };
  });
  storage.hydrate({ revision: 0, data: emptyWorkspace() });
  await assert.rejects(storage.mutatePartner('create', null, { name: 'بنکدار' }, 'stable'), /network/);
  assert.equal(storage.status().saving, false);
  assert.equal(storage.status().revision, 0);
  await storage.mutatePartner('create', null, { name: 'بنکدار' }, 'stable');
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(storage.snapshot().partners.length, 1);
  storage.clear();
});

test('partner replies from the previous account cannot populate the next account', async () => {
  let release;
  const storage = createWorkspaceStorage(() => new Promise(resolve => { release = resolve; }));
  storage.hydrate({ revision: 0, data: emptyWorkspace() });
  const pending = storage.mutatePartner('create', null, { name: 'first' }, 'request');
  await new Promise(resolve => setImmediate(resolve));
  storage.clear();
  storage.hydrate({ revision: 8, data: { ...emptyWorkspace(), partners: [{ id: 'second-account' }] } });
  release({ revision: 1, data: { ...emptyWorkspace(), partners: [{ id: 'first-account' }] } });
  assert.equal(await pending, null);
  assert.equal(storage.snapshot().partners[0].id, 'second-account');
  assert.equal(storage.status().revision, 8);
  storage.clear();
});

test('partner financial writes require their own permission and purchase also requires stock permission', async () => {
  let called = false;
  const storage = createWorkspaceStorage(async () => { called = true; });
  storage.hydrate({ revision: 0, data: emptyWorkspace() });
  storage.setWritableFields(['customers', 'documents']);
  await assert.rejects(storage.mutatePartner('settlement', 'supplier', {}, 'id'), /دسترسی/);
  storage.setWritableFields(['partners']);
  await assert.rejects(storage.mutatePartner('invoice', 'supplier', {}, 'id'), /اسناد/);
  assert.equal(called, false);
  storage.clear();
});
