import test from 'node:test';
import assert from 'node:assert/strict';
import { findLegacyAccounts, matchingLegacyAccount, normalizeLegacyUsername, readLegacyWorkspace, validateLegacyWorkspace } from './legacyMigration.js';

function storageFor(values) {
  const entries = Object.entries(values);
  return { length: entries.length, key: index => entries[index]?.[0] ?? null, getItem: key => Object.hasOwn(values, key) ? values[key] : null };
}

test('Persian names normalize Arabic ya and kaf and inconsistent whitespace', () => {
  assert.equal(normalizeLegacyUsername('  مهدي   كاظمي  '), 'مهدی کاظمی');
  assert.equal(normalizeLegacyUsername('مهدی\u200cقاسمی'), 'مهدی قاسمی');
});

test('matching uses the actual stored key and reads all ledger sections', () => {
  const storage = storageFor({
    'zarngarDocuments:  مهدي   قاسمي ': '[{"id":"old","weight":4}]',
    'zarngarCustomers:  مهدي   قاسمي ': '[{"id":"customer"}]',
    'zarngarCheques:  مهدي   قاسمي ': '[{"id":"cheque"}]',
    'zarngarGoldPurchases:  مهدي   قاسمي ': '[{"id":"purchase"}]',
    'zarngarPrices:  مهدي   قاسمي ': '{"goldGramPrice":5000000}',
    'zarngarOpeningSetup:  مهدي   قاسمي ': '{"completed":true}',
  });
  const matching = matchingLegacyAccount(storage, 'مهدی قاسمی');
  assert.equal(matching.username, '  مهدي   قاسمي ');
  assert.equal(matching.documentCount, 1);
  assert.equal(matching.customerCount, 1);
  assert.equal(matching.chequeCount, 1);
  assert.equal(matching.goldPurchaseCount, 1);
  const data = readLegacyWorkspace(storage, 'مهدی قاسمی');
  assert.equal(data.documents[0].weight, 4);
  assert.equal(data.prices.goldGramPrice, 5000000);
  assert.equal(data.openingSetup.completed, true);
});

test('account detection never reads passwords or trusts old login flags', () => {
  const values = { 'zarngarDocuments:owner': '[]', zarngarAccounts: 'private', zarngarCurrentUser: 'owner' };
  const storage = storageFor(values);
  const get = storage.getItem;
  storage.getItem = key => { assert.match(key, /^zarngar(?:Documents|Customers|Prices|OpeningSetup|GoldPurchases|Cheques):/); return get(key); };
  assert.equal(findLegacyAccounts(storage).length, 1);
  assert.equal(readLegacyWorkspace(storage, 'another'), null);
});

test('empty records and auto-saved empty setup are detected without claiming stock', () => {
  const storage = storageFor({ 'zarngarDocuments:owner': '[]', 'zarngarOpeningSetup:owner': '{"completed":false}', 'zarngarPrices:owner': '{"goldGramPrice":"0","dollarPrice":""}' });
  const [account] = findLegacyAccounts(storage);
  assert.equal(account.valid, true);
  assert.equal(account.hasRecords, false);
  assert.equal(account.hasData, false);
  assert.equal(account.documentCount, 0);
  assert.deepEqual(readLegacyWorkspace(storage, 'owner').documents, []);
});

test('ambiguous normalized accounts need exact selection and are never merged', () => {
  const storage = storageFor({ 'zarngarDocuments:مهدي قاسمي': '[{"id":1}]', 'zarngarDocuments:مهدی  قاسمی': '[{"id":2}]' });
  assert.equal(matchingLegacyAccount(storage, 'مهدی قاسمی'), null);
  assert.throws(() => readLegacyWorkspace(storage, 'مهدی قاسمی'), /چند حساب/);
  assert.equal(matchingLegacyAccount(storage, 'مهدي قاسمي').username, 'مهدي قاسمي');
  assert.equal(readLegacyWorkspace(storage, 'مهدی  قاسمی').documents[0].id, 2);
});

test('corrupt accounts are listed but cannot be imported', () => {
  const storage = storageFor({ 'zarngarDocuments:broken': '{', 'zarngarDocuments:valid': '[{"id":"good"}]' });
  const accounts = findLegacyAccounts(storage);
  assert.equal(accounts.find(account => account.username === 'broken').valid, false);
  assert.equal(accounts.find(account => account.username === 'valid').documentCount, 1);
  assert.throws(() => readLegacyWorkspace(storage, 'broken'), /خوانا نیست/);
});

test('workspace validation rejects wrong shapes and missing or duplicate document IDs', () => {
  for (const value of [[], null, {}, { documents: {} }, { documents: [null] }, { documents: [{ id: '' }] }, { documents: [{}] }, { documents: [{ id: true }] }, { documents: [{ id: 1 }, { id: '1' }] }, { customers: ['bad'] }, { openingSetup: [] }, { documents: [], unknown: [] }]) {
    assert.throws(() => validateLegacyWorkspace(value));
  }
});

test('plain and envelope backups restore without changing their originals', () => {
  const original = { documents: [{ id: 'one', weight: 2.5 }], customers: [] };
  const plain = validateLegacyWorkspace(original);
  const envelope = validateLegacyWorkspace({ revision: 17, data: original });
  assert.deepEqual(plain, envelope);
  plain.documents[0].weight = 10;
  assert.equal(original.documents[0].weight, 2.5);
  assert.deepEqual(plain.cheques, []);
});

test('nonfinite values cannot silently become null during backup migration', () => {
  const parsed = JSON.parse('{"documents":[{"id":"one","weight":1e400}]}');
  assert.throws(() => validateLegacyWorkspace(parsed), /قابل ذخیره/);
});
