import React, { lazy, Suspense, useEffect, useState } from 'react';
import { AccountingLanding, AccountingAuth } from './AccountingWelcome.jsx';
import { api, setCsrfToken, setAccountId } from './noorApi.js';
import { ownerStorage, flushWorkspace } from './ownerStorage.js';
import { SaveStatus, downloadWorkspace } from './OwnerTools.jsx';
import { matchingLegacyAccount, readLegacyWorkspace } from './legacyMigration.js';
import { writableFields } from './access.js';
import { clearCommittedDraft } from './accountingDrafts.js';
import './noor-shell.css';

const AccountingApp = lazy(() => import('./AccountingApp.jsx'));
const isLoginPath = path => ['/login', '/owner/login'].includes(path);
const isAuthPath = path => isLoginPath(path) || path === '/register';
const isPrivatePath = path => /^\/(owner|account|accounting|dashboard)(\/|$)/.test(path) && !isAuthPath(path);

export default function NoorApp() {
  const [path, setPath] = useState(location.pathname);
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [canDiscard, setCanDiscard] = useState(false);
  const [version, setVersion] = useState(0);
  const [migrationNotice, setMigrationNotice] = useState('');
  function navigate(next, replace = false) {
    history[replace ? 'replaceState' : 'pushState']({}, '', next); setPath(next);
  }
  function resetSession(destination = '/login') {
    ownerStorage.clear(); setCsrfToken(); setAccountId(); setUser(null); setReady(false);
    setMigrationNotice('');
    setError(''); setCanDiscard(false);
    navigate(destination, true);
  }
  useEffect(() => {
    const change = () => setPath(location.pathname);
    window.addEventListener('popstate', change);
    const expired = () => resetSession();
    window.addEventListener('noor-session-expired', expired);
    return () => { window.removeEventListener('popstate', change); window.removeEventListener('noor-session-expired', expired); };
  }, []);
  useEffect(() => {
    if (!isPrivatePath(path)) return;
    let cancelled = false;
    const controller = new AbortController();
    setReady(false); setError(''); setMigrationNotice('');
    ownerStorage.clear();
    (async () => {
      try {
        const session = await api('/api/auth/session', { signal: controller.signal });
        if (cancelled) return;
        if (!['owner', 'staff'].includes(session.user?.role)) { resetSession(); return; }
        setCsrfToken(session.csrfToken);
        setAccountId(session.user.accountId);
        ownerStorage.setWritableFields(writableFields(session.user));
        ownerStorage.setRecoveryUser(session.user.username);
        const workspace = await ownerStorage.load({ signal: controller.signal });
        if (cancelled) return;
        const hasServerRecords = ['documents', 'customers', 'partners', 'goldPurchases', 'cheques'].some(field => workspace?.data?.[field]?.length > 0);
        if (session.user.legacyAccount === true && session.user.role === 'owner' && !hasServerRecords && !workspace?.legacyImported) {
          try {
            const legacy = matchingLegacyAccount(localStorage, session.user.username);
            if (legacy?.hasData && legacy.valid) {
              const previous = readLegacyWorkspace(localStorage, legacy.username);
              const saved = await ownerStorage.importLegacyData(previous, legacy.username, { signal: controller.signal });
              if (saved?.imported) setMigrationNotice('موجودی و اطلاعات قبلی شما از همین مرورگر به سرور منتقل شد؛ نسخهٔ قبلی هم محفوظ است.');
            }
          } catch (cause) {
            if (cause.name !== 'AbortError') setMigrationNotice(cause.status === 409
              ? 'اطلاعات قبلی در مرورگر محفوظ است و سرور هم اطلاعات دارد؛ برای جلوگیری از تکرار یا بازنویسی، انتقال خودکار انجام نشد.'
              : `انتقال موجودی قبلی کامل نشد: ${cause.message}`);
          }
        }
        if (cancelled || !ownerStorage.status().active) return;
        setUser(session.user); setReady(true);
      } catch (cause) {
        if (cancelled) return;
        if (cause.status === 401 || cause.status === 403) resetSession();
        else setError(cause.message);
      }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [path]);
  useEffect(() => {
    if (!user || !ready || !isPrivatePath(path)) return;
    let active = true;
    async function verify() {
      try {
        const session = await api('/api/auth/session');
        if (!active) return;
        if (!['owner', 'staff'].includes(session.user?.role)) resetSession();
        else {
          setCsrfToken(session.csrfToken);
          if (JSON.stringify(session.user) !== JSON.stringify(user)) {
            ownerStorage.clear(); location.reload();
          }
        }
      } catch (cause) { if (active && (cause.status === 401 || cause.status === 403)) resetSession(); }
    }
    const timer = setInterval(verify, 30000);
    window.addEventListener('focus', verify);
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', verify); };
  }, [user, ready, path]);
  async function logout() {
    setError(''); setCanDiscard(false);
    try {
      await flushWorkspace(); await api('/api/auth/logout', { method: 'POST' }); resetSession('/');
    } catch (cause) {
      setError(`خروج کامل نشد: ${cause.message}`);
      setCanDiscard(!!ownerStorage.status().error);
    }
  }
  async function logoutWithoutSaving() {
    try { await api('/api/auth/logout', { method: 'POST' }); setCanDiscard(false); resetSession('/'); }
    catch (cause) { setError(`خروج کامل نشد: ${cause.message}`); }
  }
  if (isAuthPath(path)) return <AccountingAuth key={path} mode={path === '/register' ? 'register' : 'login'} onAuthenticated={session => {
    ownerStorage.clear(); setCsrfToken(session.csrfToken); setAccountId(session.user.accountId); setUser(session.user); navigate('/account', true);
  }}/>;
  if (!isPrivatePath(path)) return <AccountingLanding/>;
  if (!ready) return <main className="noor-owner-gate" dir="rtl"><h1>حسابداری زرنگار</h1>
    <p role={error ? 'alert' : 'status'}>{error || 'در حال آماده‌سازی دفتر شما…'}</p>
    {error && <button onClick={() => location.reload()}>تلاش دوباره</button>}<a href="/">بازگشت به صفحهٔ اصلی</a></main>;
  const notices = <><SaveStatus onRecovered={requestId => { clearCommittedDraft(user.username, requestId); setVersion(value => value + 1); }}/>
    {user.role === 'owner' && migrationNotice && <p className="noor-save-state" role="status">{migrationNotice}</p>}
    {error && <p className="noor-shell-error" role="alert">{error}</p>}
    {canDiscard && <div className="noor-shell-error"><p>تغییرات ذخیره‌نشده با خروج از دست می‌روند. ابتدا نسخهٔ پشتیبان را دریافت کنید.</p><button onClick={downloadWorkspace}>دریافت نسخهٔ پشتیبان</button> <button onClick={logoutWithoutSaving}>خروج بدون ذخیرهٔ تغییرات</button></div>}
  </>;
  return <div className="noor-owner-shell" dir="rtl">
    <Suspense fallback={<p className="noor-loading" role="status">در حال آماده‌سازی حسابداری…</p>}>
      <AccountingApp key={`${user.id}:${version}`} username={user.username} user={user} onLogout={logout} notices={notices}
        migrationNotice={migrationNotice} onImported={() => { setMigrationNotice('اطلاعات بازیابی شد و حسابداری به‌روز شد. نسخهٔ اصلی اطلاعات شما محفوظ است.'); setVersion(value => value + 1); }}
        onSessionChanged={session => { setCsrfToken(session.csrfToken); setAccountId(session.user.accountId); setUser(session.user); ownerStorage.setWritableFields(writableFields(session.user)); }}/>
    </Suspense>
  </div>;
}
