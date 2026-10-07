import { api } from './noorApi.js';

export const storageFields = Object.freeze({
  zarngarDocuments: 'documents', zarngarCustomers: 'customers', zarngarPrices: 'prices',
  zarngarOpeningSetup: 'openingSetup', zarngarGoldPurchases: 'goldPurchases', zarngarCheques: 'cheques',
  zarngarPartners: 'partners',
});
export const emptyWorkspace = () => ({ documents: [], customers: [], partners: [], prices: {}, openingSetup: {}, goldPurchases: [], cheques: [] });

const recoveryPrefix = 'noor:pending-workspace:v1:';
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const workspaceShape = emptyWorkspace();
const validChanges = value => record(value) && Object.entries(value).every(([field, content]) =>
  Object.hasOwn(workspaceShape, field) && (Array.isArray(workspaceShape[field]) ? Array.isArray(content) : record(content)));
const newRequestId = () => globalThis.crypto.randomUUID();

// Normal edits retain the synchronous adapter. Explicit document commits wait
// for the database and keep an account-scoped recovery copy until acknowledged.
export function createWorkspaceStorage(request = api, delay = 150, recoveryStorage) {
  let data = emptyWorkspace();
  let revision = 0;
  let generation = 0;
  let dirty = false;
  let active = false;
  let error = null;
  let timer;
  let pending;
  let importing = false;
  let mutatingInventory = false;
  let committing = false;
  let commitFlight;
  let recoveryUser = null;
  let recovery = null;
  let recoveryIssue = null;
  let flushAttempt;
  let editSequence = 0;
  let allowedFields = new Set(Object.values(storageFields));
  const listeners = new Set();
  const status = () => ({ dirty, saving: !!pending || importing || mutatingInventory || committing, error, revision, active,
    recovery: recovery ? { requestId: recovery.body.requestId, createdAt: recovery.createdAt,
      revision: recovery.body.revision, changes: structuredClone(recovery.body.data) } : recoveryIssue ? { unreadable: true } : null });
  const notify = () => listeners.forEach(listener => listener(status()));
  const fieldFor = key => storageFields[String(key).split(':')[0]];

  const recoveryKey = username => `${recoveryPrefix}${encodeURIComponent(username)}`;
  function durableStorage() {
    if (recoveryStorage !== undefined) return recoveryStorage;
    try {
      const storage = globalThis.localStorage;
      if (storage) return storage;
      if (typeof window === 'undefined') return null;
    } catch { /* Report the actionable storage error below. */ }
    throw new Error('نسخهٔ بازیابی در این مرورگر قابل ذخیره نیست؛ اجازهٔ ذخیره‌سازی مرورگر را بررسی کنید.');
  }
  function readRecovery() {
    recovery = null; recoveryIssue = null;
    if (!recoveryUser) return;
    try {
      const encoded = durableStorage()?.getItem(recoveryKey(recoveryUser));
      if (!encoded) return;
      const candidate = JSON.parse(encoded);
      if (candidate.version !== 1 || candidate.username !== recoveryUser || !record(candidate.body)
        || typeof candidate.body.requestId !== 'string' || !candidate.body.requestId
        || !Number.isSafeInteger(candidate.body.revision) || candidate.body.revision < 0 || !validChanges(candidate.body.data)) {
        throw new Error('نسخهٔ بازیابی این حساب قابل خواندن نیست؛ پیش از ثبت جدید، اطلاعات بازیابی را بررسی کنید.');
      }
      recovery = candidate;
    } catch (cause) { recoveryIssue = cause; }
  }
  function persistRecovery(envelope) {
    const storage = durableStorage();
    if (!storage) return; // Server-side callers have no browser persistence.
    const key = recoveryKey(envelope.username);
    const encoded = JSON.stringify(envelope);
    const existing = storage.getItem(key);
    if (existing && existing !== encoded) throw new Error('ثبت دیگری برای این حساب در انتظار بازیابی است؛ ابتدا همان ثبت را کامل کنید.');
    try {
      storage.setItem(key, encoded);
      if (storage.getItem(key) !== encoded) throw new Error('Recovery write was not retained');
    } catch {
      throw new Error('نسخهٔ بازیابی ذخیره نشد و سند به سرور ارسال نشده است؛ فضای ذخیره‌سازی مرورگر را بررسی کنید.');
    }
  }
  function removeRecovery(envelope) {
    // A later attempt or another signed-in user's backup must never be removed.
    try {
      const storage = durableStorage();
      const key = recoveryKey(envelope.username);
      if (storage?.getItem(key) === JSON.stringify(envelope)) storage.removeItem(key);
    } catch { /* A retained acknowledged request is safe to retry idempotently. */ }
  }
  function ensureNoRecovery() {
    if (recoveryIssue) throw recoveryIssue;
    if (recovery) throw new Error('یک ثبت در انتظار تأیید است؛ ابتدا گزینهٔ «بازیابی ثبت» را بزنید.');
  }
  function validateSaved(saved, body) {
    if (!record(saved) || !Number.isSafeInteger(saved.revision) || saved.revision <= body.revision
      || !validChanges(saved.data) || Object.keys(body.data).some(field => !Object.hasOwn(saved.data, field))) {
      throw new Error('تأیید کامل ذخیره‌سازی از سرور دریافت نشد؛ ثبت برای تلاش دوباره نگه داشته شد.');
    }
  }

  async function drain() {
    clearTimeout(timer);
    if (!active) throw new Error('ابتدا وارد حساب مالک شوید.');
    if (importing) throw new Error('انتقال موجودی در حال انجام است؛ چند لحظه صبر کنید.');
    if (mutatingInventory) throw new Error('تغییر صندوق در حال ذخیره است؛ چند لحظه صبر کنید.');
    ensureNoRecovery();
    if (error) throw error;
    if (pending) { await pending; return drain(); }
    if (!dirty) return;
    if (!flushAttempt) {
      const snapshot = Object.fromEntries(Object.entries(structuredClone(data)).filter(([field]) => allowedFields.has(field)));
      flushAttempt = { body: { revision, data: snapshot, requestId: newRequestId() }, sequence: editSequence };
    }
    const attempt = flushAttempt;
    const snapshotGeneration = generation;
    dirty = false;
    pending = request('/api/owner/workspace', { method: 'PUT', body: structuredClone(attempt.body) });
    notify();
    try {
      const saved = await pending;
      if (snapshotGeneration !== generation) return;
      revision = saved.revision;
      dirty = editSequence !== attempt.sequence;
      flushAttempt = undefined;
    } catch (cause) {
      if (snapshotGeneration === generation) { error = cause; dirty = true; }
      throw cause;
    } finally {
      if (snapshotGeneration === generation) { pending = undefined; notify(); }
    }
    if (dirty) await drain();
  }
  async function flush() {
    if (commitFlight) { await commitFlight; return flush(); }
    return drain();
  }
  function schedule() {
    dirty = true; clearTimeout(timer);
    timer = setTimeout(() => { flush().catch(() => {}); }, delay);
    notify();
  }
  const storage = {
    getItem(key) { const field = fieldFor(key); return active && field ? JSON.stringify(data[field]) : null; },
    setItem(key, value) {
      if (!active) throw new Error('نشست مالک فعال نیست.');
      if (importing) throw new Error('انتقال موجودی در حال انجام است؛ چند لحظه صبر کنید.');
      if (mutatingInventory) throw new Error('تغییر صندوق در حال ذخیره است؛ چند لحظه صبر کنید.');
      if (committing) throw new Error('ثبت سند در حال ذخیره است؛ چند لحظه صبر کنید.');
      ensureNoRecovery();
      if (error) throw new Error('ذخیره‌سازی سرور متوقف است؛ پیام بالای صفحه را بررسی کنید.');
      const field = fieldFor(key);
      if (!field) throw new Error('نوع اطلاعات ناشناخته است.');
      if (!allowedFields.has(field)) throw new Error('برای تغییر این بخش دسترسی ندارید؛ با مالک گالری هماهنگ کنید.');
      data[field] = JSON.parse(value); editSequence += 1; schedule();
    },
    removeItem(key) { this.setItem(key, JSON.stringify(emptyWorkspace()[fieldFor(key)])); },
    async load(options = {}) {
      const loadingGeneration = generation;
      const saved = await request('/api/owner/workspace', options);
      if (loadingGeneration !== generation || options.signal?.aborted) return null;
      this.hydrate(saved); return saved;
    },
    hydrate(saved) {
      clearTimeout(timer); generation += 1; pending = undefined; flushAttempt = undefined;
      data = { ...emptyWorkspace(), ...structuredClone(saved.data) };
      revision = saved.revision; dirty = false; error = recoveryIssue; importing = false; mutatingInventory = false;
      committing = false; commitFlight = undefined; active = true; notify();
    },
    clear() {
      clearTimeout(timer); generation += 1; pending = undefined; flushAttempt = undefined;
      data = emptyWorkspace(); revision = 0; active = false; dirty = false; importing = false; mutatingInventory = false;
      committing = false; commitFlight = undefined; recovery = null; recoveryUser = null; recoveryIssue = null; error = null; notify();
    },
    snapshot: () => structuredClone(data),
    setWritableFields(fields) { allowedFields = new Set(fields); },
    setRecoveryUser(username) {
      const nextUser = typeof username === 'string' ? username.trim() : null;
      if (nextUser === recoveryUser) return;
      if (active) this.clear();
      recoveryUser = nextUser || null; readRecovery(); notify();
    },
    status,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    flush,
    async retry() {
      if (recovery || recoveryIssue) return this.retryCommit();
      error = null; notify(); await flush();
    },
    commit(changes, requestId) {
      if (committing || commitFlight) return Promise.reject(new Error('ثبت سند در حال ذخیره است؛ چند لحظه صبر کنید.'));
      if (!active || !recoveryUser) return Promise.reject(new Error('ابتدا وارد حساب خود شوید.'));
      if (importing || mutatingInventory) return Promise.reject(new Error('ابتدا ذخیرهٔ جاری را کامل کنید.'));
      if (recoveryIssue) return Promise.reject(recoveryIssue);
      if (!requestId || typeof requestId !== 'string') return Promise.reject(new Error('شناسهٔ ثبت مشخص نیست؛ فرم را دوباره باز کنید.'));
      if (recovery && recovery.body.requestId !== requestId) return Promise.reject(new Error('ابتدا ثبت قبلی را بازیابی کنید تا اطلاعات دوباره ثبت نشوند.'));
      if (!recovery && (!validChanges(changes) || !Object.keys(changes).length)) return Promise.reject(new Error('اطلاعات ثبت معتبر نیست.'));
      const preparedChanges = structuredClone(recovery ? recovery.body.data : changes);
      if (Object.keys(preparedChanges).some(field => !allowedFields.has(field))) return Promise.reject(new Error('برای تغییر این بخش دسترسی ندارید؛ با مالک حساب هماهنگ کنید.'));
      const commitGeneration = generation;
      const username = recoveryUser;
      committing = true; notify();
      const operation = (async () => {
        if (!recovery) await drain();
        if (generation !== commitGeneration || !active || username !== recoveryUser) return null;
        const envelope = recovery || { version: 1, username, createdAt: new Date().toISOString(),
          body: { revision, data: preparedChanges, requestId } };
        recovery = envelope;
        try {
          persistRecovery(envelope);
          error = null; notify();
          const saved = await request('/api/owner/workspace', { method: 'PUT', body: structuredClone(envelope.body) });
          validateSaved(saved, envelope.body);
          removeRecovery(envelope);
          if (generation !== commitGeneration || !active || username !== recoveryUser) return null;
          recovery = null; storage.hydrate(saved);
          return saved;
        } catch (cause) {
          if (generation === commitGeneration) { error = cause; notify(); }
          throw cause;
        }
      })();
      commitFlight = operation.finally(() => {
        if (generation === commitGeneration) { committing = false; commitFlight = undefined; notify(); }
      });
      return commitFlight;
    },
    retryCommit() {
      if (recoveryIssue) return Promise.reject(recoveryIssue);
      if (!recovery) return Promise.reject(new Error('ثبتی برای بازیابی وجود ندارد.'));
      return this.commit(recovery.body.data, recovery.body.requestId);
    },
    async createInventory(item, requestId) {
      if (committing) throw new Error('ثبت سند در حال ذخیره است؛ چند لحظه صبر کنید.');
      if (!allowedFields.has('documents')) throw new Error('برای افزودن جنس به صندوق دسترسی ندارید.');
      if (!requestId) throw new Error('شناسهٔ ثبت موجودی مشخص نیست؛ فرم را دوباره باز کنید.');
      await flush();
      if (!active || mutatingInventory || committing) throw new Error('ابتدا ذخیرهٔ جاری صندوق را کامل کنید.');
      const mutationGeneration = generation;
      mutatingInventory = true; notify();
      try {
        const saved = await request('/api/owner/inventory', { method: 'POST', body: { revision, item, requestId } });
        if (generation !== mutationGeneration || !active) return null;
        this.hydrate(saved);
        return saved;
      } finally {
        if (generation === mutationGeneration) { mutatingInventory = false; notify(); }
      }
    },
    async mutateInventory(identifier, changes) {
      if (committing) throw new Error('ثبت سند در حال ذخیره است؛ چند لحظه صبر کنید.');
      if (!allowedFields.has('documents')) throw new Error('برای ویرایش صندوق دسترسی ندارید.');
      await flush();
      if (mutatingInventory || committing) throw new Error('تغییر صندوق در حال ذخیره است؛ چند لحظه صبر کنید.');
      const mutationGeneration = generation;
      mutatingInventory = true; notify();
      try {
        const saved = await request(`/api/owner/inventory/${encodeURIComponent(identifier)}`, {
          method: changes === null ? 'DELETE' : 'PATCH',
          body: changes === null ? { revision } : { revision, changes },
        });
        if (generation !== mutationGeneration || !active) return null;
        this.hydrate(saved);
        return saved;
      } finally {
        if (generation === mutationGeneration) { mutatingInventory = false; notify(); }
      }
    },
    async mutateDocument(identifier, rows, requestId, expectedRevision) {
      if (!allowedFields.has('documents')) throw new Error('برای تغییر اسناد دسترسی ندارید.');
      if (!active || committing || mutatingInventory || importing) throw new Error('ابتدا ذخیرهٔ جاری را کامل کنید.');
      if (!requestId) throw new Error('شناسهٔ تغییر سند مشخص نیست؛ فرم را دوباره باز کنید.');
      const mutationGeneration = generation;
      await flush();
      if (generation !== mutationGeneration || !active) return null;
      if (committing || mutatingInventory || importing) throw new Error('ابتدا ذخیرهٔ جاری را کامل کنید.');
      mutatingInventory = true; notify();
      try {
        const saved = await request(`/api/owner/documents/${encodeURIComponent(identifier)}`, {
          method: rows === null ? 'DELETE' : 'PATCH',
          body: { revision: expectedRevision ?? revision, requestId, ...(rows === null ? {} : { rows: structuredClone(rows) }) },
        });
        if (generation !== mutationGeneration || !active) return null;
        if (!Number.isSafeInteger(saved?.revision) || saved.revision <= (expectedRevision ?? revision) || !Array.isArray(saved?.data?.documents)) throw new Error('تأیید تغییر سند دریافت نشد؛ دوباره تلاش کنید.');
        this.hydrate(saved);
        return saved;
      } finally {
        if (generation === mutationGeneration) { mutatingInventory = false; notify(); }
      }
    },
    async mutatePartner(action, identifier, payload, requestId) {
      if (!allowedFields.has('partners')) throw new Error('برای تغییر حساب همکاران دسترسی ندارید.');
      if (['invoice', 'invoice-update'].includes(action) && !allowedFields.has('documents')) throw new Error('برای ثبت فاکتور همکار، دسترسی ثبت اسناد نیز لازم است.');
      if (['invoice-update', 'settlement-update'].includes(action) && !String(payload?.entryId || '').trim()) throw new Error('شناسهٔ سند همکار برای ویرایش مشخص نیست.');
      if (!active || committing || mutatingInventory || importing) throw new Error('ابتدا ذخیرهٔ جاری را کامل کنید.');
      if (!requestId) throw new Error('شناسهٔ ثبت مشخص نیست؛ فرم را دوباره باز کنید.');
      const mutationGeneration = generation;
      await flush();
      if (generation !== mutationGeneration || !active) return null;
      if (committing || mutatingInventory || importing) throw new Error('ابتدا ذخیرهٔ جاری را کامل کنید.');
      const routes = { create: ['', 'POST'], update: [`/${encodeURIComponent(identifier)}`, 'PATCH'], invoice: [`/${encodeURIComponent(identifier)}/invoices`, 'POST'],
        'invoice-update': [`/${encodeURIComponent(identifier)}/invoices/${encodeURIComponent(payload?.entryId)}`, 'PATCH'], settlement: [`/${encodeURIComponent(identifier)}/settlements`, 'POST'],
        'settlement-update': [`/${encodeURIComponent(identifier)}/settlements/${encodeURIComponent(payload?.entryId)}`, 'PATCH'] };
      if (!routes[action]) throw new Error('عملیات همکار معتبر نیست.');
      const [suffix, method] = routes[action];
      mutatingInventory = true; notify();
      try {
        const body = { ...structuredClone(payload), revision, requestId };
        if (['invoice-update', 'settlement-update'].includes(action)) delete body.entryId;
        const saved = await request(`/api/owner/partners${suffix}`, { method, body });
        if (generation !== mutationGeneration || !active) return null;
        if (!Number.isSafeInteger(saved?.revision) || !Array.isArray(saved?.data?.partners)) throw new Error('تأیید ثبت حساب همکار دریافت نشد؛ دوباره تلاش کنید.');
        this.hydrate(saved);
        return saved;
      } finally {
        if (generation === mutationGeneration) { mutatingInventory = false; notify(); }
      }
    },
    async importLegacyData(nextData, sourceUsername, options = {}) {
      if (committing) throw new Error('ثبت سند در حال ذخیره است؛ چند لحظه صبر کنید.');
      if (!allowedFields.has('openingSetup')) throw new Error('انتقال موجودی فقط برای مالک حساب مجاز است.');
      await flush();
      if (committing) throw new Error('ثبت سند در حال ذخیره است؛ چند لحظه صبر کنید.');
      const importGeneration = generation;
      importing = true; notify();
      try {
        const saved = await request('/api/owner/workspace/import', { ...options, method: 'POST', body: { data: nextData, sourceUsername } });
        if (generation !== importGeneration || options.signal?.aborted) return null;
        this.hydrate(saved); return saved;
      } finally {
        if (generation === importGeneration) { importing = false; notify(); }
      }
    },
    async importData(nextData, onStaged = () => {}) {
      ensureNoRecovery();
      if (!active || dirty || pending || error || committing) throw new Error('ابتدا ذخیره‌سازی جاری را کامل کنید.');
      if (revision !== 0) throw new Error('انتقال فقط به حساب خالی انجام می‌شود تا اطلاعات قبلی بازنویسی نشوند.');
      data = { ...emptyWorkspace(), ...structuredClone(nextData) };
      editSequence += 1; onStaged(); schedule(); await flush();
    },
  };
  return storage;
}

export const ownerStorage = createWorkspaceStorage();
export const flushWorkspace = () => ownerStorage.flush();
