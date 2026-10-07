import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceStorage, emptyWorkspace } from './ownerStorage.js';

function fixture(request) {
  const storage = createWorkspaceStorage(request, 60_000);
  storage.hydrate({ data: emptyWorkspace(), revision: 0 });
  return storage;
}

test('private data stays unavailable until hydration and clears after logout', () => {
  const storage = createWorkspaceStorage();
  assert.equal(storage.getItem('zarngarDocuments:forged'), null);
  assert.throws(() => storage.setItem('zarngarDocuments:forged', '[]'));
  storage.hydrate({ revision: 1, data: { ...emptyWorkspace(), documents: [{ id: 'private' }] } });
  assert.equal(JSON.parse(storage.getItem('zarngarDocuments:owner'))[0].id, 'private');
  storage.clear();
  assert.equal(storage.getItem('zarngarDocuments:owner'), null);
});

test('ledger and customer edits flush together as one atomic server snapshot', async () => {
  const requests = [];
  const storage = fixture(async (path, options) => { requests.push(options.body); return { revision: 1 }; });
  storage.setItem('zarngarCustomers:owner', JSON.stringify([{ id: 'customer', debt: 10 }]));
  storage.setItem('zarngarDocuments:owner', JSON.stringify([{ id: 'sale' }]));
  await storage.flush();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].data.documents[0].id, 'sale');
  assert.equal(requests[0].data.customers[0].debt, 10);
  assert.equal(storage.status().dirty, false);
  storage.clear();
});

test('edits arriving during a save wait and use the returned revision', async () => {
  let release;
  const requests = [];
  const storage = fixture(async (path, options) => {
    requests.push(options.body);
    if (requests.length === 1) await new Promise(resolve => { release = resolve; });
    return { revision: requests.length };
  });
  storage.setItem('zarngarDocuments:owner', '[{"id":"first"}]');
  const first = storage.flush();
  storage.setItem('zarngarDocuments:owner', '[{"id":"first"},{"id":"second"}]');
  release(); await first;
  assert.deepEqual(requests.map(request => request.revision), [0, 1]);
  assert.equal(requests[0].data.documents.length, 1);
  assert.equal(requests[1].data.documents.length, 2);
  storage.clear();
});

test('a conflicting save preserves the unsaved data and prevents later overwrites', async () => {
  const conflict = Object.assign(new Error('conflict'), { status: 409 });
  let calls = 0;
  const storage = fixture(async () => { calls++; throw conflict; });
  storage.setItem('zarngarDocuments:owner', '[{"id":"unsaved"}]');
  await assert.rejects(storage.flush(), { status: 409 });
  assert.equal(storage.snapshot().documents[0].id, 'unsaved');
  assert.equal(storage.status().dirty, true);
  assert.throws(() => storage.setItem('zarngarDocuments:owner', '[]'));
  await assert.rejects(storage.flush(), { status: 409 });
  assert.equal(calls, 1);
  storage.clear();
});

test('a late save response cannot repopulate data cleared on logout', async () => {
  let release;
  const storage = fixture(() => new Promise(resolve => { release = resolve; }));
  storage.setItem('zarngarDocuments:owner', '[{"id":"secret"}]');
  const save = storage.flush();
  storage.clear(); release({ revision: 10 }); await save;
  assert.equal(storage.status().active, false);
  assert.equal(storage.status().revision, 0);
  assert.deepEqual(storage.snapshot().documents, []);
});

test('migration cannot overwrite an existing server workspace', async () => {
  const storage = fixture(() => { throw new Error('should never write'); });
  storage.hydrate({ data: emptyWorkspace(), revision: 2 });
  await assert.rejects(storage.importData({ documents: [{ id: 'legacy' }] }));
  assert.deepEqual(storage.snapshot().documents, []);
  storage.clear();
});

test('a late workspace read cannot hydrate private records after session reset', async () => {
  let release;
  const storage = fixture(() => new Promise(resolve => { release = resolve; }));
  const loading = storage.load();
  storage.clear();
  release({ revision: 7, data: { ...emptyWorkspace(), documents: [{ id: 'secret' }] } });
  assert.equal(await loading, null);
  assert.equal(storage.status().active, false);
  assert.deepEqual(storage.snapshot().documents, []);
});

test('a logout flush waits for every subsequent in-flight snapshot', async () => {
  const releases = [];
  const storage = fixture(() => new Promise(resolve => { releases.push(resolve); }));
  storage.setItem('zarngarDocuments:owner', '[{"id":"first"}]');
  const saving = storage.flush();
  storage.setItem('zarngarDocuments:owner', '[{"id":"second"}]');
  let drained = false;
  const logoutFlush = storage.flush().then(() => { drained = true; });
  releases[0]({ revision: 1 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(releases.length, 2);
  assert.equal(drained, false);
  releases[1]({ revision: 2 });
  await Promise.all([saving, logoutFlush]);
  assert.equal(drained, true);
  assert.equal(storage.status().saving, false);
  storage.clear();
});

test('import stages UI state before a failed save can later be retried', async () => {
  let calls = 0;
  const storage = fixture(async () => {
    if (++calls === 1) throw new Error('offline');
    return { revision: 1 };
  });
  let uiSnapshot;
  await assert.rejects(storage.importData({ customers: [{ id: 'legacy' }] }, () => { uiSnapshot = storage.snapshot(); }));
  assert.equal(uiSnapshot.customers[0].id, 'legacy');
  await storage.retry();
  assert.equal(storage.snapshot().customers[0].id, 'legacy');
  storage.clear();
});

test('staff sends only writable fields and rejects edits to other fields', async () => {
  const requests = [];
  const storage = fixture(async (path, options) => { requests.push(options.body); return { revision: 1 }; });
  storage.setWritableFields(['prices']);
  assert.throws(() => storage.setItem('zarngarDocuments:staff', '[]'));
  storage.setItem('zarngarPrices:staff', '{"goldGramPrice":"100"}');
  await storage.flush();
  assert.deepEqual(requests[0].data, { prices: { goldGramPrice: '100' } });
  storage.clear();
});

test('legacy import locks edits and hydrates only after server acknowledgment', async () => {
  let release;
  const storage = fixture(() => new Promise(resolve => { release = resolve; }));
  const importing = storage.importLegacyData({ ...emptyWorkspace(), documents: [{ id: 'legacy' }] }, 'old-owner');
  await new Promise(resolve => setImmediate(resolve));
  assert.throws(() => storage.setItem('zarngarDocuments:owner', '[]'));
  assert.deepEqual(storage.snapshot().documents, []);
  release({ revision: 4, data: { ...emptyWorkspace(), documents: [{ id: 'legacy' }] }, imported: true });
  await importing;
  assert.equal(storage.snapshot().documents[0].id, 'legacy');
  assert.equal(storage.status().saving, false);
  storage.clear();
});

test('a rejected migration leaves current records and local staging intact', async () => {
  const storage = fixture(async () => { throw Object.assign(new Error('conflict'), { status: 409 }); });
  storage.hydrate({ revision: 3, data: { ...emptyWorkspace(), documents: [{ id: 'existing' }] } });
  await assert.rejects(storage.importLegacyData({ documents: [{ id: 'legacy' }] }, 'old-owner'), { status: 409 });
  assert.equal(storage.snapshot().documents[0].id, 'existing');
  assert.equal(storage.status().saving, false);
  assert.equal(storage.status().error, null);
  storage.clear();
});

test('inventory editing flushes staged records first and hydrates the acknowledged ledger together', async () => {
  const calls = [];
  const saved = { revision: 2, data: { ...emptyWorkspace(), documents: [{ id: 'lot', weight: '3' }], customers: [{ id: 'buyer', purchases: [{ id: 'lot', amount: 30 }] }] } };
  const storage = fixture(async (path, options) => {
    calls.push({ path, ...options });
    return calls.length === 1 ? { revision: 1 } : saved;
  });
  storage.setItem('zarngarDocuments:owner', '[{"id":"lot","weight":"2"}]');
  assert.deepEqual(await storage.mutateInventory('lot', { weight: '3' }), saved);
  assert.equal(calls[0].method, 'PUT');
  assert.deepEqual(calls[1], { path: '/api/owner/inventory/lot', method: 'PATCH', body: { revision: 1, changes: { weight: '3' } } });
  assert.deepEqual(storage.snapshot(), saved.data);
  assert.equal(storage.status().dirty, false);
  storage.clear();
});

test('inventory mutation locks writes and concurrent actions without optimistically removing a lot', async () => {
  let release;
  const storage = fixture(() => new Promise(resolve => { release = resolve; }));
  storage.hydrate({ revision: 3, data: { ...emptyWorkspace(), documents: [{ id: 'lot' }] } });
  const deleting = storage.mutateInventory('lot', null);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(storage.snapshot().documents.length, 1);
  assert.equal(storage.status().saving, true);
  assert.throws(() => storage.setItem('zarngarDocuments:owner', '[]'));
  await assert.rejects(storage.mutateInventory('lot', { itemName: 'changed' }));
  release({ revision: 4, data: emptyWorkspace() });
  await deleting;
  assert.equal(storage.snapshot().documents.length, 0);
  assert.equal(storage.status().saving, false);
  storage.clear();
});

test('rejected inventory deletion preserves the ledger and permits a corrected request', async () => {
  const calls = [];
  const storage = fixture(async (path, options) => {
    calls.push(options);
    throw Object.assign(new Error('linked sale'), { status: 409 });
  });
  storage.hydrate({ revision: 8, data: { ...emptyWorkspace(), documents: [{ id: 'lot' }, { id: 'sale', inventorySourceId: 'lot' }] } });
  const before = storage.snapshot();
  await assert.rejects(storage.mutateInventory('lot', null), { status: 409 });
  assert.deepEqual(calls[0], { method: 'DELETE', body: { revision: 8 } });
  assert.deepEqual(storage.snapshot(), before);
  assert.equal(storage.status().revision, 8);
  assert.equal(storage.status().saving, false);
  assert.equal(storage.status().error, null);
  storage.clear();
});

test('inventory mutation cannot restore private records after logout and cannot run for read-only staff', async () => {
  let release;
  const storage = fixture(() => new Promise(resolve => { release = resolve; }));
  storage.setWritableFields([]);
  await assert.rejects(storage.mutateInventory('lot', null));
  assert.equal(release, undefined);
  storage.setWritableFields(['documents']);
  const saving = storage.mutateInventory('lot', { itemName: 'new' });
  await new Promise(resolve => setImmediate(resolve));
  storage.clear();
  release({ revision: 9, data: { ...emptyWorkspace(), documents: [{ id: 'private' }] } });
  assert.equal(await saving, null);
  assert.equal(storage.status().active, false);
  assert.deepEqual(storage.snapshot().documents, []);
});

test('manual stock creation flushes pending entries and accepts only the server-created record', async () => {
  const calls = [];
  const item = { category: 'crafted', itemName: 'Ring', weight: '2', gramPrice: '100' };
  const saved = { revision: 2, createdId: 'server-id', data: { ...emptyWorkspace(), documents: [{ id: 'existing' }, { ...item, id: 'server-id' }] } };
  const storage = fixture(async (path, options) => {
    calls.push({ path, ...options });
    return calls.length === 1 ? { revision: 1 } : saved;
  });
  storage.setItem('zarngarDocuments:owner', '[{"id":"existing"}]');
  assert.deepEqual(await storage.createInventory(item, 'request-id'), saved);
  assert.equal(calls[0].method, 'PUT');
  assert.deepEqual(calls[1], { path: '/api/owner/inventory', method: 'POST', body: { revision: 1, item, requestId: 'request-id' } });
  assert.deepEqual(storage.snapshot(), saved.data);
  assert.equal(storage.status().dirty, false);
  storage.clear();
});

test('an ambiguous creation failure preserves the stable retry identifier and does not add a local item', async () => {
  const calls = [];
  const item = { category: 'currency', itemName: 'Dollar', quantity: '10', currencyRate: '100' };
  const storage = fixture(async (path, options) => {
    calls.push(options.body);
    if (calls.length === 1) throw new Error('connection lost after save');
    return { revision: 1, createdId: 'one-id', data: { ...emptyWorkspace(), documents: [{ ...item, id: 'one-id' }] } };
  });
  await assert.rejects(storage.createInventory(item, 'stable-id'));
  assert.deepEqual(storage.snapshot().documents, []);
  assert.equal(storage.status().saving, false);
  await storage.createInventory(item, 'stable-id');
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(storage.snapshot().documents.length, 1);
  storage.clear();
});

test('manual creation locks ledger writes and cannot repopulate records after logout', async () => {
  let release;
  const storage = fixture(() => new Promise(resolve => { release = resolve; }));
  const saving = storage.createInventory({ category: 'coin' }, 'stable-id');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(storage.status().saving, true);
  assert.throws(() => storage.setItem('zarngarDocuments:owner', '[]'));
  await assert.rejects(storage.createInventory({ category: 'coin' }, 'another-id'));
  await assert.rejects(storage.mutateInventory('lot', null));
  storage.clear();
  release({ revision: 1, createdId: 'private', data: { ...emptyWorkspace(), documents: [{ id: 'private' }] } });
  assert.equal(await saving, null);
  assert.equal(storage.status().active, false);
  assert.deepEqual(storage.snapshot().documents, []);
});

test('manual creation requires writable documents and a stable retry identifier', async () => {
  let calls = 0;
  const storage = fixture(async () => { calls++; });
  await assert.rejects(storage.createInventory({}, ''));
  storage.setWritableFields([]);
  await assert.rejects(storage.createInventory({}, 'stable-id'));
  assert.equal(calls, 0);
  storage.clear();
});
