import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceStorage, emptyWorkspace } from './ownerStorage.js';

test('document mutation retains the revision shown in the editor and atomically hydrates balances', async () => {
  const calls = [];
  const storage = createWorkspaceStorage(async (path, options) => {
    calls.push({ path, ...options });
    return { revision: 8, data: { ...emptyWorkspace(), documents: [{ id: 'sale', amount: 12000 }], customers: [{ id: 'buyer', gramDebt: 1 }] } };
  });
  storage.hydrate({ revision: 7, data: emptyWorkspace() });
  const rows = [{ id: 'sale', changes: { cashPaid: '6000' } }];
  await storage.mutateDocument('sale', rows, 'stable-request', 6);
  assert.deepEqual(calls[0], { path: '/api/owner/documents/sale', method: 'PATCH', body: { revision: 6, requestId: 'stable-request', rows } });
  assert.equal(storage.snapshot().customers[0].gramDebt, 1);
  assert.equal(storage.snapshot().documents[0].amount, 12000);
  assert.equal(storage.status().revision, 8);
  storage.clear();
});

test('uncertain deletion can replay the identical request without removing local documents prematurely', async () => {
  const calls = [];
  const original = { ...emptyWorkspace(), documents: [{ id: 'sale' }] };
  const storage = createWorkspaceStorage(async (path, options) => {
    calls.push(options);
    if (calls.length === 1) throw new Error('connection lost');
    return { revision: 3, data: emptyWorkspace() };
  });
  storage.hydrate({ revision: 2, data: original });
  await assert.rejects(storage.mutateDocument('sale', null, 'same', 2), /connection lost/);
  assert.deepEqual(storage.snapshot(), original);
  assert.equal(storage.status().saving, false);
  await storage.mutateDocument('sale', null, 'same', 2);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[1].method, 'DELETE');
  assert.equal(storage.snapshot().documents.length, 0);
  storage.clear();
});

test('document edits enforce permissions and ignore responses from a previous account', async () => {
  let release;
  const storage = createWorkspaceStorage(() => new Promise(resolve => { release = resolve; }));
  storage.hydrate({ revision: 2, data: emptyWorkspace() });
  storage.setWritableFields(['customers']);
  await assert.rejects(storage.mutateDocument('sale', [], 'request'), /دسترسی/);
  storage.setWritableFields(['documents']);
  const pending = storage.mutateDocument('sale', [], 'request');
  await new Promise(resolve => setImmediate(resolve));
  storage.clear();
  const second = { ...emptyWorkspace(), documents: [{ id: 'second-account' }] };
  storage.hydrate({ revision: 12, data: second });
  release({ revision: 3, data: emptyWorkspace() });
  assert.equal(await pending, null);
  assert.deepEqual(storage.snapshot(), second);
  assert.equal(storage.status().revision, 12);
  storage.clear();
});
