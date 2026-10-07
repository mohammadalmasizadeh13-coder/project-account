import test from 'node:test';
import assert from 'node:assert/strict';

let moduleSequence = 0;
async function updates(t, mode = 'normal') {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const target = new EventTarget();
  target.Event = Event;
  const channels = [];
  const sent = [];
  if (mode !== 'unsupported') {
    target.BroadcastChannel = class {
      constructor(name) {
        if (mode === 'constructor-error') throw new Error('disabled');
        this.name = name;
        channels.push(this);
      }
      postMessage(data) {
        if (mode === 'send-error') throw new Error('closed');
        sent.push(data);
        for (const peer of channels) {
          if (peer !== this && peer.name === this.name) peer.onmessage?.({ data });
        }
      }
    };
  }
  Object.defineProperty(globalThis, 'window', { value: target, configurable: true });
  t.after(() => original ? Object.defineProperty(globalThis, 'window', original) : delete globalThis.window);
  return { ...(await import(`./storefrontUpdates.js?test=${++moduleSequence}`)), target, channels, sent };
}

test('one channel signals local and other tabs once without sharing accounting data', async t => {
  const fixture = await updates(t);
  let first = 0;
  let second = 0;
  const unsubscribe = fixture.subscribeStorefrontUpdates(() => first++);
  const unsubscribeSecond = fixture.subscribeStorefrontUpdates(() => second++);
  assert.equal(fixture.channels.length, 1, 'subscriptions share the tab channel');
  assert.equal(fixture.channels[0].name, 'noor-storefront-updates');
  const remote = new fixture.target.BroadcastChannel('noor-storefront-updates');
  const received = [];
  remote.onmessage = event => received.push(event.data);

  fixture.notifyStorefrontUpdated({ documents: [{ customerName: 'private' }], csrfToken: 'secret' });
  assert.deepEqual([first, second], [1, 1], 'same-tab subscribers are not called twice');
  assert.deepEqual(received, ['changed']);
  assert.deepEqual(fixture.sent, ['changed']);

  unsubscribe();
  remote.postMessage('changed');
  assert.deepEqual([first, second], [1, 2]);
  assert.equal(fixture.sent.length, 2, 'received updates must not rebroadcast');
  remote.postMessage({ changed: true, data: 'unexpected' });
  assert.equal(second, 2, 'only the fixed change message is accepted');
  unsubscribeSecond();
  fixture.notifyStorefrontUpdated();
  assert.equal(second, 2, 'unsubscribed listeners stay detached');
});

for (const mode of ['unsupported', 'constructor-error', 'send-error']) {
  test(`local changes continue when cross-tab notifications are ${mode}`, async t => {
    const fixture = await updates(t, mode);
    let count = 0;
    const unsubscribe = fixture.subscribeStorefrontUpdates(() => count++);
    assert.doesNotThrow(() => fixture.notifyStorefrontUpdated());
    assert.equal(count, 1);
    unsubscribe();
  });
}

test('server rendering does not open a Node BroadcastChannel or require a window', async () => {
  const module = await import(`./storefrontUpdates.js?test=${++moduleSequence}`);
  assert.equal(typeof window, 'undefined');
  const unsubscribe = module.subscribeStorefrontUpdates(() => assert.fail('not a browser'));
  assert.doesNotThrow(() => module.notifyStorefrontUpdated());
  assert.doesNotThrow(unsubscribe);
});
