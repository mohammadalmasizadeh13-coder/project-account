import React, { useEffect, useRef, useState } from 'react';
import { ownerStorage } from './ownerStorage.js';
import { findLegacyAccounts, matchingLegacyAccount, MAX_LEGACY_BYTES, readLegacyWorkspace, validateLegacyWorkspace } from './legacyMigration.js';

export function downloadWorkspace() {
  const blob = new Blob([JSON.stringify(ownerStorage.snapshot(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = `noor-accounting-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function SaveStatus({ onRecovered }) {
  const [status, setStatus] = useState(ownerStorage.status);
  const [recoveryError, setRecoveryError] = useState('');
  useEffect(() => ownerStorage.subscribe(setStatus), []);
  useEffect(() => {
    const guard = event => {
      const current = ownerStorage.status();
      if (current.dirty || current.saving || current.recovery) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, []);
  async function recover() {
    const requestId = status.recovery?.requestId;
    setRecoveryError('');
    try { await ownerStorage.retryCommit(); onRecovered?.(requestId); }
    catch (cause) { setRecoveryError(cause.message); }
  }
  return <div className={`noor-save-state ${status.error || status.recovery ? 'has-error' : ''}`} role={status.error || status.recovery ? 'alert' : 'status'}>
    <span>{status.saving ? 'در حال ذخیره در سرور؛ صفحه را نبندید…' : status.recovery ? 'یک ثبت تأییدنشده محفوظ است؛ برای بررسی و تکمیل همان ثبت، تلاش دوباره را بزنید.' : status.error ? `اطلاعات هنوز در سرور ذخیره نشده است: ${status.error.message}` : status.dirty ? 'در حال ذخیره در سرور؛ صفحه را نبندید…' : 'اطلاعات در سرور ذخیره است.'}</span>
    {status.recovery && <button data-retry-commit disabled={status.saving || status.recovery.unreadable} onClick={recover}>تلاش دوباره برای تکمیل ثبت</button>}
    {recoveryError && <span>{recoveryError}</span>}
    {status.error && <>{!status.recovery && status.error.status !== 409 && <button onClick={() => ownerStorage.retry().catch(() => {})}>تلاش دوباره</button>}<button onClick={downloadWorkspace}>دریافت نسخهٔ پشتیبان</button>
      {status.error.status === 409 && <span>اطلاعات در پنجرهٔ دیگری تغییر کرده است؛ ابتدا نسخهٔ پشتیبان بگیرید و سپس صفحه را بازخوانی کنید.</span>}</>}
  </div>;
}

export function LegacyImport({ onImported, username = '', notice = '' }) {
  const detectAccounts = () => {
    try { return { accounts: findLegacyAccounts(localStorage), error: '' }; }
    catch { return { accounts: [], error: 'دسترسی به اطلاعات قدیمی این مرورگر ممکن نشد؛ می‌توانید فایل پشتیبان را بازیابی کنید.' }; }
  };
  const [discovery, setDiscovery] = useState(detectAccounts);
  const [legacyUser, setLegacyUser] = useState(() => {
    try {
      const match = matchingLegacyAccount(localStorage, username);
      return match?.username || (discovery.accounts.length === 1 ? discovery.accounts[0].username : '');
    } catch { return ''; }
  });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [backup, setBackup] = useState(null);
  const operation = useRef(false);
  const controller = useRef(null);
  const mounted = useRef(true);
  const backupRead = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); backupRead.current += 1; };
  }, []);
  const selected = discovery.accounts.find(account => account.username === legacyUser);
  const format = value => Number(value).toLocaleString('fa-IR');

  async function transfer(data, sourceUsername, successMessage) {
    if (operation.current) return;
    operation.current = true; setBusy(true); setFailed(false); setMessage('');
    controller.current = new AbortController();
    try {
      const saved = await ownerStorage.importLegacyData(data, sourceUsername, { signal: controller.current.signal });
      if (!saved || !mounted.current || controller.current.signal.aborted) return;
      setMessage(successMessage);
      onImported?.();
    } catch (error) {
      if (!mounted.current || controller.current.signal.aborted) return;
      setFailed(true);
      setMessage(error.status === 409
        ? 'دفتر سرور از قبل اطلاعات دارد؛ هیچ داده‌ای بازنویسی نشد. نسخهٔ فعلی سرور و اطلاعات قدیمی مرورگر هر دو محفوظ‌اند. برای بررسی، از دفتر فعلی نسخهٔ پشتیبان بگیرید.'
        : `${error.message || 'ارتباط با سرور برقرار نشد.'} نسخهٔ قدیمی مرورگر و فایل اصلی تغییری نکرده‌اند.`);
    } finally {
      operation.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function migrate(event) {
    event.preventDefault();
    try {
      if (!legacyUser) throw new Error('حساب قدیمی را از فهرست انتخاب کنید.');
      const data = readLegacyWorkspace(localStorage, legacyUser);
      if (!data) throw new Error('اطلاعات این حساب در همین مرورگر پیدا نشد؛ فهرست را دوباره بررسی کنید.');
      await transfer(data, legacyUser, 'اطلاعات حساب قدیمی در سرور ذخیره شد و حسابداری بازخوانی شد. نسخهٔ اصلی مرورگر نیز محفوظ است.');
    } catch (error) { setFailed(true); setMessage(error.message); }
  }

  async function chooseBackup(event) {
    const file = event.target.files?.[0];
    const readId = ++backupRead.current;
    setBackup(null); setMessage(''); setFailed(false);
    if (!file) return;
    try {
      if (file.size > MAX_LEGACY_BYTES) throw new Error('حجم فایل پشتیبان باید حداکثر ۵ مگابایت باشد.');
      const text = await file.text();
      let parsed;
      try { parsed = JSON.parse(text.replace(/^\uFEFF/, '')); }
      catch { throw new Error('فایل پشتیبان خوانا نیست؛ یک فایل معتبر JSON انتخاب کنید.'); }
      const data = validateLegacyWorkspace(parsed);
      if (mounted.current && backupRead.current === readId) setBackup({ name: file.name, data });
    } catch (error) {
      if (mounted.current && backupRead.current === readId) { setFailed(true); setMessage(error.message); }
    }
  }

  return <details className="noor-migration"><summary>بازیابی موجودی و اطلاعات نسخهٔ قدیمی</summary>
    {notice && <p role="status">{notice}</p>}
    <p>اطلاعات قدیمی فقط در همان مرورگر و همان نشانی سایت قبلی قابل شناسایی است؛ تغییر آدرس یا پورت، مرورگر یا دستگاه می‌تواند فهرست را خالی نشان دهد. انتقال فقط به دفتر خالی سرور انجام می‌شود و نسخهٔ اصلی مرورگر پاک نمی‌شود.</p>
    {discovery.error && <p role="alert">{discovery.error}</p>}
    <form onSubmit={migrate}>
      <label htmlFor="legacy-username">حساب‌های شناسایی‌شده</label>
      <select id="legacy-username" value={legacyUser} onChange={event => { setLegacyUser(event.target.value); setMessage(''); }} disabled={busy || !discovery.accounts.length} required>
        <option value="">{discovery.accounts.length ? 'انتخاب حساب قدیمی' : 'حساب قدیمی در این نشانی پیدا نشد'}</option>
        {discovery.accounts.map(account => <option key={account.username} value={account.username}>{account.username} · {account.valid ? `${format(account.documentCount)} سند و ${format(account.customerCount)} مشتری` : 'نیازمند بررسی اطلاعات'}</option>)}
      </select>
      <button type="submit" disabled={busy || !selected?.valid}>{busy ? 'در حال انتقال…' : 'انتقال اطلاعات این حساب'}</button>
      <button type="button" disabled={busy} onClick={() => { setDiscovery(detectAccounts()); setMessage(''); }}>بررسی دوبارهٔ مرورگر</button>
    </form>
    {selected && <p>{selected.valid ? `${format(selected.documentCount)} سند، ${format(selected.customerCount)} مشتری، ${format(selected.chequeCount)} چک و ${format(selected.goldPurchaseCount)} خرید طلا شناسایی شد.${selected.hasRecords ? '' : ' برای این حساب سند یا موجودی ثبت‌شده‌ای شناسایی نشد.'}` : selected.error}</p>}
    <form onSubmit={event => { event.preventDefault(); if (backup) transfer(backup.data, 'backup-file', 'اطلاعات فایل پشتیبان در سرور بازیابی و حسابداری بازخوانی شد. فایل اصلی شما تغییری نکرده است.'); }}>
      <label htmlFor="legacy-backup-file">بازیابی از فایل پشتیبان حسابداری</label>
      <input id="legacy-backup-file" type="file" accept=".json,application/json" onChange={chooseBackup} disabled={busy}/>
      <button type="submit" disabled={busy || !backup}>بازیابی فایل در دفتر خالی</button>
    </form>
    {backup && <p>{backup.name} · {format(backup.data.documents.length)} سند و {format(backup.data.customers.length)} مشتری آمادهٔ انتقال است.</p>}
    <p>اگر اطلاعات قدیمی در دستگاه یا نشانی دیگری است، از همان نسخه فایل پشتیبان بگیرید و در اینجا بازیابی کنید. اطلاعات مالی فقط در پنل مالک قرار می‌گیرد.</p>
    {message && <p role={failed ? 'alert' : 'status'}>{message}</p>}
  </details>;
}
