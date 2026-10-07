import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceStorage, emptyWorkspace } from './ownerStorage.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const requestId = '958ca6a0-303a-4563-89cc-9ea346cb4f7d';
const anotherId = '82c28646-aaea-4aab-bd07-f67cc32f6cdd';
const backupKey = username => `noor:pending-workspace:v1:${encodeURIComponent(username)}`;
function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
}
function fixture(request, backup = memoryStorage(), username = 'owner') {
  const storage = createWorkspaceStorage(request, 60_000, backup);
  storage.setRecoveryUser(username);
  storage.hydrate({ data: emptyWorkspace(), revision: 0 });
  return { storage, backup };
}

test('document commit drains earlier edits, sends only explicit changes, and waits for database acknowledgment', async () => {
  const calls = [];
  let release;
  const { storage, backup } = fixture(async (path, options) => {
    calls.push(options.body);
    if (calls.length === 1) return { revision: 1 };
    return new Promise(resolve => { release = resolve; });
  });
  storage.setItem('zarngarPrices:owner', '{"goldGramPrice":"100"}');
  const changes = { documents: [{ id: 'purchase' }], customers: [{ id: 'seller', debt: 50 }] };
  const saving = storage.commit(changes, requestId);
  changes.documents[0].id = 'changed-after-submit';
  assert.equal(storage.status().saving, true);
  assert.throws(() => storage.setItem('zarngarDocuments:owner', '[]'));
  await assert.rejects(storage.commit({ documents: [] }, anotherId));
  await assert.rejects(storage.createInventory({}, anotherId));
  await assert.rejects(storage.mutateInventory('lot', null));
  await tick();
  assert.equal(calls.length, 2);
  assert.deepEqual(Object.keys(calls[1].data).sort(), ['customers', 'documents']);
  assert.equal(calls[1].revision, 1);
  assert.equal(calls[1].data.documents[0].id, 'purchase');
  assert.deepEqual(storage.snapshot().documents, []);
  assert.deepEqual(JSON.parse(backup.getItem(backupKey('owner'))).body, calls[1]);
  const saved = { revision: 2, data: { ...storage.snapshot(), ...calls[1].data } };
  release(saved);
  assert.deepEqual(await saving, saved);
  assert.deepEqual(storage.snapshot(), saved.data);
  assert.equal(storage.status().recovery, null);
  assert.equal(storage.status().saving, false);
  assert.equal(backup.getItem(backupKey('owner')), null);
  storage.clear();
});

test('a lost response retains the exact prepared document and customer balances for idempotent retry', async () => {
  const calls = [];
  const changes = { documents: [{ id: 'one-purchase' }], customers: [{ id: 'seller', debt: 30 }] };
  const saved = { revision: 1, data: { ...emptyWorkspace(), ...changes } };
  const { storage, backup } = fixture(async (path, options) => {
    calls.push(options.body);
    if (calls.length === 1) throw new Error('response lost after commit');
    return saved;
  });
  await assert.rejects(storage.commit(changes, requestId));
  assert.deepEqual(storage.snapshot().documents, []);
  assert.deepEqual(storage.snapshot().customers, []);
  assert.equal(storage.status().recovery.requestId, requestId);
  assert.ok(backup.getItem(backupKey('owner')));
  assert.throws(() => storage.setItem('zarngarDocuments:owner', '[]'));
  await assert.rejects(storage.commit(changes, anotherId));
  // Callers may have recomputed balances after a reload; retry must ignore them.
  await storage.commit({ documents: [{ id: 'duplicate' }], customers: [{ id: 'seller', debt: 60 }] }, requestId);
  assert.deepEqual(calls[1], calls[0]);
  assert.equal(storage.snapshot().documents.length, 1);
  assert.equal(storage.snapshot().customers[0].debt, 30);
  assert.equal(storage.status().error, null);
  storage.clear();
});

test('reload hydrates current server records while retaining recovery without automatically submitting it', async () => {
  const backup = memoryStorage();
  const first = fixture(async () => { throw new Error('offline'); }, backup).storage;
  await assert.rejects(first.commit({ documents: [{ id: 'saved-on-server' }] }, requestId));
  const original = JSON.parse(backup.getItem(backupKey('owner'))).body;
  first.clear();
  assert.ok(backup.getItem(backupKey('owner')));
  const calls = [];
  const current = { revision: 4, data: { ...emptyWorkspace(), documents: [{ id: 'saved-on-server' }, { id: 'later-record' }] } };
  const second = createWorkspaceStorage(async (path, options) => { calls.push(options); return current; }, 60_000, backup);
  second.setRecoveryUser('owner');
  await second.load();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, undefined);
  assert.deepEqual(second.snapshot(), current.data);
  assert.equal(second.status().recovery.requestId, requestId);
  assert.throws(() => second.setItem('zarngarCustomers:owner', '[]'));
  await second.retryCommit();
  assert.deepEqual(calls[1].body, original);
  assert.equal(second.snapshot().documents.length, 2);
  assert.equal(backup.getItem(backupKey('owner')), null);
  second.clear();
});

test('a conflict keeps the original revision and backup even after loading a newer workspace', async () => {
  const calls = [];
  const conflict = Object.assign(new Error('revision conflict'), { status: 409 });
  const current = { revision: 8, data: { ...emptyWorkspace(), documents: [{ id: 'other-tab' }] } };
  const { storage, backup } = fixture(async (path, options) => {
    if (!options.method) return current;
    calls.push(options.body); throw conflict;
  });
  await assert.rejects(storage.commit({ documents: [{ id: 'unsaved' }] }, requestId), { status: 409 });
  await storage.load();
  await assert.rejects(storage.retryCommit(), { status: 409 });
  assert.deepEqual(calls[1], calls[0]);
  assert.equal(calls[1].revision, 0);
  assert.equal(storage.snapshot().documents[0].id, 'other-tab');
  assert.equal(storage.status().recovery.changes.documents[0].id, 'unsaved');
  assert.ok(backup.getItem(backupKey('owner')));
  storage.clear();
});

test('recovery is isolated by username and a logout does not erase the pending account backup', async () => {
  const { storage, backup } = fixture(async () => { throw new Error('offline'); });
  await assert.rejects(storage.commit({ documents: [{ id: 'owner-secret' }] }, requestId));
  storage.clear();
  assert.equal(storage.status().recovery, null);
  assert.deepEqual(storage.snapshot().documents, []);
  storage.setRecoveryUser('staff');
  storage.hydrate({ revision: 0, data: emptyWorkspace() });
  assert.equal(storage.status().recovery, null);
  assert.ok(backup.getItem(backupKey('owner')));
  await assert.rejects(storage.retryCommit());
  storage.clear();
  storage.setRecoveryUser('owner');
  storage.hydrate({ revision: 0, data: emptyWorkspace() });
  assert.equal(storage.status().recovery.changes.documents[0].id, 'owner-secret');
  storage.clear();
});

test('late commit acknowledgment cannot hydrate another user or delete a different pending request', async () => {
  let release;
  const { storage, backup } = fixture(() => new Promise(resolve => { release = resolve; }));
  const saving = storage.commit({ documents: [{ id: 'private' }] }, requestId);
  await tick();
  const original = JSON.parse(backup.getItem(backupKey('owner')));
  const laterBackup = JSON.stringify({ ...original, body: { ...original.body, requestId: anotherId } });
  backup.setItem(backupKey('owner'), laterBackup);
  storage.clear();
  storage.setRecoveryUser('staff');
  storage.hydrate({ revision: 0, data: emptyWorkspace() });
  release({ revision: 1, data: { ...emptyWorkspace(), documents: [{ id: 'private' }] } });
  assert.equal(await saving, null);
  assert.deepEqual(storage.snapshot().documents, []);
  assert.equal(storage.status().recovery, null);
  assert.equal(backup.getItem(backupKey('owner')), laterBackup);
  storage.clear();
});

test('failure to write the browser backup prevents network submission and keeps the prepared retry', async () => {
  let available = false;
  let calls = 0;
  const backup = memoryStorage();
  const setItem = backup.setItem;
  backup.setItem = (key, value) => { if (!available) throw new Error('quota exceeded'); setItem(key, value); };
  const { storage } = fixture(async (path, options) => {
    calls++;
    return { revision: 1, data: { ...emptyWorkspace(), ...options.body.data } };
  }, backup);
  await assert.rejects(storage.commit({ documents: [{ id: 'retained' }] }, requestId));
  assert.equal(calls, 0);
  assert.deepEqual(storage.snapshot().documents, []);
  assert.equal(storage.status().recovery.changes.documents[0].id, 'retained');
  available = true;
  await storage.retryCommit();
  assert.equal(calls, 1);
  assert.equal(storage.snapshot().documents[0].id, 'retained');
  storage.clear();
});

test('an incomplete success response cannot clear recovery or update the ledger', async () => {
  const { storage, backup } = fixture(async () => ({ revision: 1 }));
  await assert.rejects(storage.commit({ documents: [{ id: 'pending' }] }, requestId));
  assert.deepEqual(storage.snapshot().documents, []);
  assert.ok(backup.getItem(backupKey('owner')));
  assert.equal(storage.status().recovery.requestId, requestId);
  storage.clear();
});

test('a malformed recovery is preserved and prevents accidental overwrite', async () => {
  const backup = memoryStorage();
  backup.setItem(backupKey('owner'), '{broken-json');
  let calls = 0;
  const { storage } = fixture(async () => { calls++; }, backup);
  assert.equal(storage.status().recovery.unreadable, true);
  await assert.rejects(storage.commit({ documents: [] }, requestId));
  await assert.rejects(storage.retryCommit());
  assert.throws(() => storage.setItem('zarngarDocuments:owner', '[]'));
  assert.equal(calls, 0);
  assert.equal(backup.getItem(backupKey('owner')), '{broken-json');
  storage.clear();
});

test('commit requires identity and writable fields before creating a pending request', async () => {
  let calls = 0;
  const { storage, backup } = fixture(async () => { calls++; });
  storage.setWritableFields(['prices']);
  await assert.rejects(storage.commit({ documents: [] }, requestId));
  assert.equal(backup.getItem(backupKey('owner')), null);
  storage.clear();
  storage.hydrate({ revision: 0, data: emptyWorkspace() });
  await assert.rejects(storage.commit({ prices: {} }, requestId));
  assert.equal(calls, 0);
  storage.clear();
});

test('background retry reuses the failed request and only then saves edits queued during that request', async () => {
  const calls = [];
  let rejectFirst;
  const { storage } = fixture(async (path, options) => {
    calls.push(options.body);
    if (calls.length === 1) return new Promise((resolve, reject) => { rejectFirst = reject; });
    return { revision: calls.length - 1 };
  });
  storage.setItem('zarngarDocuments:owner', '[{"id":"first"}]');
  const flushing = storage.flush();
  storage.setItem('zarngarDocuments:owner', '[{"id":"first"},{"id":"second"}]');
  rejectFirst(new Error('lost response'));
  await assert.rejects(flushing);
  await storage.retry();
  assert.deepEqual(calls[1], calls[0]);
  assert.notEqual(calls[2].requestId, calls[1].requestId);
  assert.equal(calls[2].revision, 1);
  assert.equal(calls[2].data.documents.length, 2);
  assert.equal(storage.status().dirty, false);
  storage.clear();
});
