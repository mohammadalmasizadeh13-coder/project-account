import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, KeyRound, RefreshCw, ShieldCheck, UserPlus, Users } from 'lucide-react';
import { api } from './noorApi.js';
import { flushWorkspace } from './ownerStorage.js';
import './user-access.css';

const permissionGroups = [
  ['documents', 'اسناد و موجودی'], ['customers', 'مشتریان'], ['prices', 'نرخ‌های حسابداری'],
  ['goldPurchases', 'خرید طلا'], ['cheques', 'چک‌ها'], ['partners', 'همکاران تجاری و حواله‌ها'],
];
const readPermissions = permissionGroups.map(([key]) => `${key}.read`);
const accountingPermissions = permissionGroups.flatMap(([key]) => [`${key}.read`, `${key}.write`]);
const emptyAccount = () => ({ username: '', password: '', confirmation: '', permissions: [] });
const permissionsFor = user => ({ permissions: (user.permissions || []).filter(permission => accountingPermissions.includes(permission)), active: user.active !== false });
const messageFor = error => error?.message || 'عملیات انجام نشد. اتصال را بررسی کنید و دوباره تلاش کنید.';

function PermissionEditor({ value, onChange, prefix, disabled }) {
  function toggle(permission, checked) {
    const next = new Set(value);
    if (checked) {
      next.add(permission);
      if (permission.endsWith('.write')) next.add(permission.replace('.write', '.read'));
    } else {
      next.delete(permission);
      if (permission.endsWith('.read')) next.delete(permission.replace('.read', '.write'));
    }
    onChange([...next]);
  }
  return <fieldset className="noor-access-permissions" disabled={disabled}>
    <legend>محدودهٔ دسترسی</legend>
    <div className="noor-access-presets">
      <button type="button" onClick={() => onChange([...readPermissions])}>فقط مشاهده</button>
      <button type="button" onClick={() => onChange([...accountingPermissions])}>ثبت و مشاهدهٔ حسابداری</button>
      <button type="button" onClick={() => onChange([])}>پاک‌کردن دسترسی‌ها</button>
    </div>
    <div className="noor-access-table-wrap"><table>
      <caption className="noor-access-sr-only">دسترسی مشاهده و ویرایش برای هر بخش حسابداری</caption>
      <thead><tr><th scope="col">بخش</th><th scope="col">مشاهده</th><th scope="col">ثبت و ویرایش</th></tr></thead>
      <tbody>{permissionGroups.map(([key, label]) => <tr key={key}>
        <th scope="row">{label}</th>
        {['read', 'write'].map(mode => <td key={mode}><label htmlFor={`${prefix}-${key}-${mode}`}><span className="noor-access-sr-only">{mode === 'read' ? 'مشاهدهٔ' : 'ثبت و ویرایش'} {label}</span><input id={`${prefix}-${key}-${mode}`} type="checkbox" checked={value.includes(`${key}.${mode}`)} onChange={event => toggle(`${key}.${mode}`, event.target.checked)}/></label></td>)}
      </tr>)}</tbody>
    </table></div>
    <p className="noor-access-help">اجازهٔ ویرایش، مشاهدهٔ همان بخش را هم فعال می‌کند. برای ثبت فاکتور و تغییر ماندهٔ مشتری، دسترسی ویرایش «اسناد و موجودی» و «مشتریان» را با هم فعال کنید.</p>
    {!value.length && <p className="noor-access-help">این حساب فعلاً به اطلاعات حسابداری دسترسی ندارد و فقط می‌تواند رمز خودش را تغییر دهد.</p>}
  </fieldset>;
}

export default function UserAccessManager({ user, onSessionChanged }) {
  const owner = user?.role === 'owner';
  const [expanded, setExpanded] = useState(true);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [users, setUsers] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [createDraft, setCreateDraft] = useState(emptyAccount);
  const [userDrafts, setUserDrafts] = useState({});
  const [selectedId, setSelectedId] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirmation, setResetConfirmation] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);
  const lock = useRef(false);
  const staff = users.filter(account => account.role !== 'owner');
  const selected = staff.find(account => String(account.id) === selectedId) || staff[0];
  const selectedKey = selected ? String(selected.id) : '';
  const selectedDraft = selected ? userDrafts[selectedKey] || permissionsFor(selected) : null;
  useEffect(() => { if (owner) loadUsers(); }, [owner]);

  async function perform(action, callback) {
    if (lock.current) return;
    lock.current = true; setBusy(action); setNotice(null);
    try { await callback(); }
    catch (error) { setNotice({ type: 'error', text: messageFor(error) }); }
    finally { lock.current = false; setBusy(''); }
  }
  function validation(text) { setNotice({ type: 'error', text }); }
  function success(text) { setNotice({ type: 'success', text }); }
  function updateCreated(key, value) { setCreateDraft(previous => ({ ...previous, [key]: value })); }
  function updateSelected(key, value) { setUserDrafts(previous => ({ ...previous, [selectedKey]: { ...selectedDraft, [key]: value } })); }
  function replaceUser(account) {
    if (!account?.id || !account.username) throw new Error('اطلاعات حساب از سرور دریافت نشد؛ فهرست کاربران را دوباره دریافت کنید.');
    setUsers(previous => [...previous.filter(existing => String(existing.id) !== String(account.id)), account]);
  }
  function loadUsers() {
    return perform('load', async () => {
      const result = await api('/api/owner/users');
      if (!Array.isArray(result?.users)) throw new Error('فهرست کاربران دریافت نشد. دوباره تلاش کنید.');
      setUsers(result.users); setLoaded(true);
    });
  }
  async function changeOwnPassword(event) {
    event.preventDefault();
    if (newPassword.length < 8) { validation('رمز جدید باید حداقل ۸ نویسه داشته باشد.'); return; }
    if (newPassword !== confirmation) { validation('رمز جدید و تکرار آن یکسان نیستند.'); return; }
    await perform('own-password', async () => {
      await flushWorkspace();
      const session = await api('/api/auth/password', { method: 'POST', body: { currentPassword, newPassword } });
      if (!session?.user || !session.csrfToken) throw new Error('رمز تغییر کرد ولی نشست تازه دریافت نشد؛ دوباره وارد حساب شوید.');
      onSessionChanged(session);
      setCurrentPassword(''); setNewPassword(''); setConfirmation('');
      success('رمز شما تغییر کرد. از این پس با رمز جدید وارد شوید؛ نشست‌های قبلی این حساب پایان یافتند.');
    });
  }
  async function createUser(event) {
    event.preventDefault();
    if (!createDraft.username.trim()) { validation('نام کاربری کارمند را وارد کنید.'); return; }
    if (createDraft.password.length < 8) { validation('رمز کارمند باید حداقل ۸ نویسه داشته باشد.'); return; }
    if (createDraft.password !== createDraft.confirmation) { validation('رمز کارمند و تکرار آن یکسان نیستند.'); return; }
    await perform('create', async () => {
      const result = await api('/api/owner/users', { method: 'POST', body: {
        username: createDraft.username.trim(), password: createDraft.password, permissions: createDraft.permissions, active: true,
      } });
      replaceUser(result?.user); setSelectedId(String(result.user.id)); setCreateDraft(emptyAccount());
      setResetPassword(''); setResetConfirmation('');
      success('حساب کارمند ساخته شد. کارمند با نام کاربری و رمز تعیین‌شده، از صفحهٔ ورود وارد می‌شود.');
    });
  }
  async function savePermissions(event) {
    event.preventDefault();
    const identifier = selectedKey;
    await perform('permissions', async () => {
      const result = await api(`/api/owner/users/${encodeURIComponent(identifier)}`, { method: 'PATCH', body: selectedDraft });
      replaceUser(result?.user);
      setUserDrafts(previous => { const next = { ...previous }; delete next[identifier]; return next; });
      success('دسترسی و وضعیت حساب ذخیره شد. نشست‌های قبلی این کارمند پایان یافتند و باید دوباره وارد شود.');
    });
  }
  async function resetUserPassword(event) {
    event.preventDefault();
    if (resetPassword.length < 8) { validation('رمز جدید کارمند باید حداقل ۸ نویسه داشته باشد.'); return; }
    if (resetPassword !== resetConfirmation) { validation('رمز جدید کارمند و تکرار آن یکسان نیستند.'); return; }
    await perform('reset-password', async () => {
      const result = await api(`/api/owner/users/${encodeURIComponent(selectedKey)}`, { method: 'PATCH', body: { password: resetPassword } });
      replaceUser(result?.user); setResetPassword(''); setResetConfirmation('');
      success('رمز کارمند تغییر کرد؛ برای ورود دوباره باید از رمز جدید استفاده کند.');
    });
  }

  return <section className="noor-access" dir="rtl" aria-labelledby="noor-access-heading">
    <button type="button" className="noor-access-toggle" aria-expanded={expanded} aria-controls="noor-access-body" onClick={() => {
      const next = !expanded; setExpanded(next); if (next && owner && !loaded) loadUsers();
    }}><ShieldCheck size={20} aria-hidden="true"/><span id="noor-access-heading">{owner ? 'حساب کاربری و دسترسی کارکنان' : 'حساب کاربری و تغییر رمز'}</span><ChevronDown size={17} className={expanded ? 'is-open' : ''} aria-hidden="true"/></button>
    <div className="noor-access-body" id="noor-access-body" hidden={!expanded}>
      {notice && <p className={`noor-access-notice ${notice.type}`} role={notice.type === 'error' ? 'alert' : 'status'}>{notice.text}</p>}
      <form className="noor-access-own-password" onSubmit={changeOwnPassword}>
        <h2><KeyRound size={18} aria-hidden="true"/>تغییر رمز حساب من <bdi>{user?.username}</bdi></h2>
        <fieldset disabled={!!busy}>
          <div className="noor-access-password-grid">
            <label htmlFor="noor-current-password">رمز فعلی<input id="noor-current-password" name="currentPassword" type="password" autoComplete="current-password" value={currentPassword} maxLength={256} required onChange={event => setCurrentPassword(event.target.value)}/></label>
            <label htmlFor="noor-new-password">رمز جدید<input id="noor-new-password" name="newPassword" type="password" autoComplete="new-password" value={newPassword} minLength={8} maxLength={256} required aria-describedby="noor-password-help" onChange={event => setNewPassword(event.target.value)}/></label>
            <label htmlFor="noor-confirm-password">تکرار رمز جدید<input id="noor-confirm-password" name="passwordConfirmation" type="password" autoComplete="new-password" value={confirmation} minLength={8} maxLength={256} required onChange={event => setConfirmation(event.target.value)}/></label>
          </div>
          <p id="noor-password-help" className="noor-access-help">رمز جدید حداقل ۸ نویسه باشد. تغییر رمز، ورودهای قبلی این حساب را خاتمه می‌دهد.</p>
          <button type="submit" className="noor-access-button">{busy === 'own-password' ? 'در حال تغییر رمز…' : 'تغییر رمز من'}</button>
        </fieldset>
      </form>
      {owner && <section className="noor-access-staff" aria-labelledby="noor-staff-heading">
        <div className="noor-access-staff-heading"><h2 id="noor-staff-heading"><Users size={19} aria-hidden="true"/>حساب‌های کارکنان</h2><button type="button" className="noor-access-button secondary" disabled={!!busy} onClick={loadUsers}><RefreshCw size={15} aria-hidden="true"/>{busy === 'load' ? 'در حال دریافت…' : 'دریافت فهرست کاربران'}</button></div>
        <p className="noor-access-help">کارکنان با دسترسی تعیین‌شده از دفتر حسابداری شما استفاده می‌کنند. فقط مالک این دفتر می‌تواند حساب کارمند بسازد، دسترسی‌ها را تغییر دهد یا حساب را غیرفعال کند.</p>
        <div className="noor-access-columns">
          <form onSubmit={createUser} className="noor-access-create">
            <h3><UserPlus size={17} aria-hidden="true"/>ایجاد حساب کارمند</h3>
            <fieldset disabled={!!busy || !loaded}>
              <label htmlFor="noor-staff-username">نام کاربری<input id="noor-staff-username" name="staffUsername" autoComplete="off" maxLength={100} required value={createDraft.username} onChange={event => updateCreated('username', event.target.value)}/></label>
              <div className="noor-access-password-pair"><label htmlFor="noor-staff-password">رمز ورود<input id="noor-staff-password" name="staffPassword" type="password" autoComplete="new-password" minLength={8} maxLength={256} required value={createDraft.password} onChange={event => updateCreated('password', event.target.value)}/></label>
                <label htmlFor="noor-staff-confirm">تکرار رمز ورود<input id="noor-staff-confirm" name="staffConfirmation" type="password" autoComplete="new-password" minLength={8} maxLength={256} required value={createDraft.confirmation} onChange={event => updateCreated('confirmation', event.target.value)}/></label></div>
              <PermissionEditor prefix="noor-create" value={createDraft.permissions} onChange={value => updateCreated('permissions', value)}/>
              <button type="submit" className="noor-access-button">{busy === 'create' ? 'در حال ساخت حساب…' : 'ایجاد حساب کارمند'}</button>
            </fieldset>
          </form>
          <div className="noor-access-existing">
            <h3>ویرایش دسترسی کارکنان</h3>
            {!loaded ? <p className="noor-access-help">ابتدا فهرست کاربران را دریافت کنید.</p> : !staff.length ? <p className="noor-access-empty">هنوز حساب کارمندی ساخته نشده است.</p> : <>
              <label htmlFor="noor-staff-select">انتخاب کارمند<select id="noor-staff-select" value={selectedKey} disabled={!!busy} onChange={event => { setSelectedId(event.target.value); setResetPassword(''); setResetConfirmation(''); setNotice(null); }}>
                {staff.map(account => <option key={account.id} value={String(account.id)}>{account.username}{account.active === false ? ' — غیرفعال' : ''}</option>)}
              </select></label>
              <form onSubmit={savePermissions} className="noor-access-edit-form">
                <fieldset disabled={!!busy}>
                  <label className="noor-access-check" htmlFor="noor-staff-active"><input id="noor-staff-active" type="checkbox" checked={selectedDraft.active} onChange={event => updateSelected('active', event.target.checked)}/><span>حساب فعال باشد و اجازهٔ ورود داشته باشد</span></label>
                  <PermissionEditor prefix="noor-edit" value={selectedDraft.permissions} onChange={value => updateSelected('permissions', value)}/>
                  <button type="submit" className="noor-access-button">{busy === 'permissions' ? 'در حال ذخیره…' : 'ذخیرهٔ دسترسی و وضعیت'}</button>
                </fieldset>
              </form>
              <details className="noor-access-reset"><summary>تعیین رمز جدید برای این کارمند</summary>
                <form onSubmit={resetUserPassword}><fieldset disabled={!!busy}>
                  <label htmlFor="noor-reset-password">رمز جدید کارمند<input id="noor-reset-password" type="password" autoComplete="new-password" minLength={8} maxLength={256} required value={resetPassword} onChange={event => setResetPassword(event.target.value)}/></label>
                  <label htmlFor="noor-reset-confirm">تکرار رمز جدید<input id="noor-reset-confirm" type="password" autoComplete="new-password" minLength={8} maxLength={256} required value={resetConfirmation} onChange={event => setResetConfirmation(event.target.value)}/></label>
                  <button type="submit" className="noor-access-button secondary">{busy === 'reset-password' ? 'در حال تغییر…' : 'ثبت رمز جدید کارمند'}</button>
                </fieldset></form>
              </details>
            </>}
          </div>
        </div>
      </section>}
    </div>
  </section>;
}
