const eventName = 'noor-storefront-updated';
const channelName = 'noor-storefront-updates';
const changedMessage = 'changed';

let channel;
let channelInitialized = false;

function browserWindow() {
  return typeof window !== 'undefined' && typeof window.addEventListener === 'function' ? window : null;
}

function emitChanged(target) {
  target.dispatchEvent(new target.Event(eventName));
}

function changesChannel(target) {
  if (!channelInitialized) {
    channelInitialized = true;
    if (typeof target.BroadcastChannel === 'function') {
      try {
        channel = new target.BroadcastChannel(channelName);
        channel.onmessage = event => {
          if (event.data === changedMessage) emitChanged(target);
        };
      } catch {
        // Local notifications and the storefront's refresh interval still work.
      }
    }
  }
  return channel;
}

export function subscribeStorefrontUpdates(listener) {
  const target = browserWindow();
  if (!target) return () => {};
  changesChannel(target);
  target.addEventListener(eventName, listener);
  return () => target.removeEventListener(eventName, listener);
}

export function notifyStorefrontUpdated() {
  const target = browserWindow();
  if (!target) return;
  emitChanged(target);
  try {
    // Never send accounting fields, customer details, or credentials between tabs.
    changesChannel(target)?.postMessage(changedMessage);
  } catch {
    // An unavailable/closed browser channel must not turn a saved mutation into an error.
  }
}
