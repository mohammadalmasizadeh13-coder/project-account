import test from 'node:test';
import assert from 'node:assert/strict';
import { api, setCsrfToken, setAccountId } from './noorApi.js';

test('account switches replace the CSRF token and logout clears it', async t => {
  const previousFetch = globalThis.fetch;
  const requests = [];
  t.after(() => { globalThis.fetch = previousFetch; setCsrfToken(); setAccountId(); });
  globalThis.fetch = async (path, options) => {
    requests.push({ path, ...options });
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  await api('/api/auth/register', { method: 'POST', body: { username: 'one', password: 'private-password' } });
  assert.equal(requests.at(-1).headers.has('X-CSRF-Token'), false);
  assert.equal(requests.at(-1).credentials, 'same-origin');
  assert.equal(requests.at(-1).cache, 'no-store');
  setCsrfToken('account-one-token');
  setAccountId('account-one');
  await api('/api/owner/workspace', { method: 'PUT', body: { revision: 0, data: { customers: [] } } });
  assert.equal(requests.at(-1).headers.get('X-CSRF-Token'), 'account-one-token');
  assert.equal(requests.at(-1).headers.get('X-Account-ID'), 'account-one');
  setCsrfToken('account-two-token');
  setAccountId('account-two');
  await api('/api/owner/workspace');
  assert.equal(requests.at(-1).headers.get('X-Account-ID'), 'account-two');
  await api('/api/auth/logout', { method: 'POST' });
  assert.equal(requests.at(-1).headers.get('X-CSRF-Token'), 'account-two-token');
  setCsrfToken();
  setAccountId();
  await api('/api/auth/login', { method: 'POST', body: { username: 'one', password: 'private-password' } });
  assert.equal(requests.at(-1).headers.has('X-CSRF-Token'), false);
});

test('duplicate registration, validation, and network failures retain actionable errors', async t => {
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });
  globalThis.fetch = async () => ({ ok: false, status: 409, json: async () => ({ detail: 'این نام کاربری قبلاً ثبت شده است.' }) });
  await assert.rejects(api('/api/auth/register', { method: 'POST' }), { status: 409, message: 'این نام کاربری قبلاً ثبت شده است.' });
  globalThis.fetch = async () => ({ ok: false, status: 422, json: async () => ({ detail: [] }) });
  await assert.rejects(api('/api/auth/register', { method: 'POST' }), error => error.status === 422 && error.message.includes('فیلدها'));
  globalThis.fetch = async () => { throw new Error('offline'); };
  await assert.rejects(api('/api/auth/register', { method: 'POST' }), error => error.status === 0 && error.message.includes('در دسترس نیست'));
  globalThis.fetch = async () => { throw new DOMException('cancelled', 'AbortError'); };
  await assert.rejects(api('/api/auth/session'), { name: 'AbortError' });
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => { throw new Error('HTML'); } });
  await assert.rejects(api('/api/auth/register', { method: 'POST' }), /نشانی سرور/);
});

test('expired workspace session signals the shell; rejected login stays in its form', async t => {
  const previousFetch = globalThis.fetch;
  const previousDispatch = globalThis.dispatchEvent;
  const events = [];
  t.after(() => { globalThis.fetch = previousFetch; globalThis.dispatchEvent = previousDispatch; });
  globalThis.dispatchEvent = event => events.push(event.type);
  globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({ detail: 'ورود لازم است.' }) });
  await assert.rejects(api('/api/auth/login', { method: 'POST' }), { status: 401 });
  assert.deepEqual(events, []);
  await assert.rejects(api('/api/owner/workspace'), { status: 401 });
  assert.deepEqual(events, ['noor-session-expired']);
});
