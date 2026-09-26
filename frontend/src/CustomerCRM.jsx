import React, { useMemo, useRef, useState } from 'react';
import { CalendarDays, Phone, Plus, Search, UserRound, Pencil, Wallet, X } from 'lucide-react';
import { invoiceCount, iranDate } from './sales';
import { customerSummary, settleCustomer } from './crm';
import './crm.css';
import PersianDateInput from './PersianDateInput';
import { formatPersianDate } from './persianDate';
import { formatRecordDate } from './recordTime';
import { tradeGoldPriceSummary } from './tradeGoldPrice';
import { customerAnalytics } from './crmAnalytics';
import { CRMOverview, CustomerInsights } from './CRMInsights';
import { CustomerOccasions } from './WorkspacePages';
import { birthdayReminders } from './workspace';

const numeric = value => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 3 }).format(Number(value) || 0);
const money = value => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(Number(value) || 0);
const dateText = value => value ? formatPersianDate(value.slice(0, 10)) : 'ثبت نشده';
const empty = () => ({ name: '', phone: '', birthDate: '', address: '', tag: 'عادی', followUpDate: '', note: '', rialDebt: '', gramDebt: '' });
const balance = (value, unit) => `${numeric(Math.abs(Number(value) || 0))} ${unit} · ${Number(value) > 0 ? 'بدهکار به ما' : Number(value) < 0 ? 'بستانکار از ما' : 'تسویه'}`;

export default function CustomerCRM({ customers, documents, onSave, parseNumber, initialSelectedId = '', initialView = 'customers', initialAction = '', today: suppliedToday }) {
  const [selectedId, setSelectedId] = useState(initialSelectedId);
  const [view, setView] = useState(initialView);
  const [profileTab, setProfileTab] = useState(initialAction === 'settlement' ? 'settlement' : 'history');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [reportOptions, setReportOptions] = useState({ days: 0, category: 'all' });
  const profileRef = useRef(null);
  const editorRef = useRef(null);
  const today = suppliedToday || iranDate();
  const birthdays = birthdayReminders(customers, today);
  const analytics = useMemo(() => customers.map(customer => customerAnalytics(customer, documents, { ...reportOptions, today })), [customers, documents, reportOptions, today]);
  const [editing, setEditing] = useState(initialAction === 'new' ? 'new' : null);
  const [form, setForm] = useState(empty);
  const [message, setMessage] = useState(null);
  const [settlement, setSettlement] = useState({ direction: 'received', rialAmount: '', gramAmount: '', date: iranDate(), note: '' });
  const selected = customers.find(customer => customer.id === selectedId);
  const summary = selected ? customerSummary(selected, documents) : null;
  const selectedAnalytics = analytics.find(row => row.customer.id === selectedId);
  const selectProfile = id => {
    setView('customers');
    setSelectedId(id); setEditing(null); setFilter('all'); setMessage(null);
    setSettlement({ direction: 'received', rialAmount: '', gramAmount: '', date: today, note: '' });
    requestAnimationFrame(() => { profileRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); profileRef.current?.focus({ preventScroll: true }); });
  };
  const normalized = value => String(value || '').replace(/ي/g, 'ی').replace(/ك/g, 'ک').trim().toLowerCase();
  const visible = customers.filter(customer => normalized(`${customer.name} ${customer.phone} ${customer.tag}`).includes(normalized(query)));
  const histories = summary?.transactions.filter(doc => filter === 'all' || (filter === 'purchase' ? doc.direction === 'فروش' || String(doc.type).endsWith('-sale') : doc.direction === 'خرید' || String(doc.type).endsWith('-purchase'))) || [];
  const update = event => { setForm(current => ({ ...current, [event.target.name]: event.target.value })); setMessage(null); };
  const editCustomer = customer => {
    setView('customers');
    setEditing(customer?.id || 'new'); setForm(customer ? { ...empty(), ...customer } : empty()); setMessage(null);
    requestAnimationFrame(() => { editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); editorRef.current?.querySelector('[name="name"]')?.focus({ preventScroll: true }); });
  };
  const save = event => {
    event.preventDefault();
    const name = form.name.trim();
    if (!name) return setMessage({ type: 'error', text: 'نام مشتری را وارد کنید.' });
    const phone = String(form.phone || '').replace(/[۰-۹]/g, char => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(char))).replace(/[\s()-]/g, '');
    if (phone && !/^\+?\d{7,15}$/.test(phone)) return setMessage({ type: 'error', text: 'شماره تماس معتبر وارد کنید.' });
    if (form.birthDate && form.birthDate > iranDate()) return setMessage({ type: 'error', text: 'تاریخ تولد نمی‌تواند در آینده باشد.' });
    if (customers.some(customer => customer.id !== editing && (normalized(customer.name) === normalized(name) || (phone && customer.phone === phone)))) return setMessage({ type: 'error', text: 'مشتری با این نام یا شماره موجود است؛ پروندهٔ او را ویرایش کنید.' });
    const existing = customers.find(customer => customer.id === editing);
    const record = { ...existing, ...form, id: existing?.id || `customer-${crypto.randomUUID()}`, name, phone,
      rialDebt: existing ? existing.rialDebt : parseNumber(form.rialDebt), gramDebt: existing ? existing.gramDebt : parseNumber(form.gramDebt),
      createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
    try { onSave(record); }
    catch (error) { setMessage({ type: 'error', text: error.message || 'پرونده ذخیره نشد؛ دوباره تلاش کنید.' }); return; }
    setSelectedId(record.id); setView('customers'); setEditing(null); setMessage({ type: 'success', text: 'پرونده مشتری ذخیره شد.' });
    requestAnimationFrame(() => profileRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  const submitSettlement = event => {
    event.preventDefault();
    try {
      onSave(settleCustomer(selected, { ...settlement, rialAmount: parseNumber(settlement.rialAmount), gramAmount: parseNumber(settlement.gramAmount) }));
      setSettlement({ direction: 'received', rialAmount: '', gramAmount: '', date: iranDate(), note: '' });
      setMessage({ type: 'success', text: 'تسویه ثبت شد و مانده حساب به‌روزرسانی شد.' });
    } catch (error) { setMessage({ type: 'error', text: error.message }); }
  };

  return <div className="crm-workspace">
    <header className="simple-heading"><div><span>ارتباط بهتر، تجربه بهتر</span><h1>{initialAction === 'new' ? 'ثبت مشتری' : initialAction === 'settlement' ? 'دریافت و پرداخت مشتری' : 'CRM و مشتریان'}</h1><p>{initialAction === 'settlement' ? 'مشتری را انتخاب کنید و دریافت یا پرداخت را ثبت کنید.' : 'پرونده، رفتار خرید و فرصت‌های ارتباط با مشتری'}</p></div></header>
    {!initialAction && <nav className="section-tabs" aria-label="بخش‌های CRM">{[['customers', 'پرونده مشتریان'], ['analytics', 'گزارش مشتریان'], ['occasions', 'تولدها و پیگیری‌ها']].map(([key, label]) => <button key={key} data-crm-view={key} aria-pressed={view === key} onClick={() => { setView(key); setEditing(null); }}>{label}{key === 'occasions' && birthdays.length > 0 && <b>{numeric(birthdays.length)}</b>}</button>)}</nav>}
    <div className="crm-toolbar"><label className="crm-search"><Search size={17}/><input aria-label="جستجوی مشتری" placeholder="نام، شماره تماس یا گروه مشتری…" value={query} onChange={event => setQuery(event.target.value)}/></label><button className="button button-primary" onClick={() => editCustomer(null)}><Plus size={16}/> مشتری جدید</button></div>
    {view === 'analytics' && <CRMOverview rows={analytics} query={query} options={reportOptions} onOptions={setReportOptions} onSelect={selectProfile} compact/>}
    {view === 'occasions' && <CustomerOccasions customers={visible} today={today} onSelect={selectProfile}/>}
    {message && <div role="status" className={`form-message ${message.type}`}>{message.text}</div>}
    {editing && <form className="crm-editor crm-form" ref={editorRef} onSubmit={save}>
      <div className="crm-section-title"><h3>{editing === 'new' ? 'مشتری جدید' : 'ویرایش مشخصات مشتری'}</h3><button type="button" className="sd-icon-button" aria-label="بستن ویرایش مشتری" onClick={() => setEditing(null)}><X size={16}/></button></div>
      <div className="form-grid"><label>نام و نام خانوادگی<input name="name" required value={form.name} onChange={update}/></label><label>شماره تماس<input name="phone" type="tel" value={form.phone} onChange={update} placeholder="۰۹۱۲…"/></label><label>تاریخ تولد (شمسی)<PersianDateInput name="birthDate" max={iranDate()} value={form.birthDate} onChange={update}/></label><label>گروه مشتری<select name="tag" value={form.tag} onChange={update}>{['عادی', 'وفادار', 'ویژه', 'همکار'].map(tag => <option key={tag}>{tag}</option>)}</select></label><label>تاریخ پیگیری بعدی<PersianDateInput name="followUpDate" value={form.followUpDate} onChange={update}/></label><label>نشانی<input name="address" value={form.address} onChange={update}/></label><label className="wide">یادداشت و علاقه‌مندی‌ها<input name="note" value={form.note} onChange={update} placeholder="مثلاً علاقه به طلای کم‌اجرت، سایز انگشتر یا موضوع پیگیری"/></label>
        {editing === 'new' && <><label>مانده اولیه ریالی (تومان)<input name="rialDebt" inputMode="decimal" value={form.rialDebt} onChange={update}/></label><label>مانده اولیه گرمی<input name="gramDebt" inputMode="decimal" value={form.gramDebt} onChange={update}/></label><small className="wide">عدد مثبت: بدهی مشتری به ما. عدد منفی: طلب مشتری از ما. ویرایش مشخصات، مانده حساب را تغییر نمی‌دهد.</small></>}
      </div><button className="button button-primary" type="submit">ذخیره پرونده</button>
    </form>}
    {view === 'customers' && <div className="crm-columns"><aside className="crm-customer-list" aria-label="فهرست مشتریان"><div className="crm-list-heading">مشتریان <span>{numeric(visible.length)} نفر</span></div>{visible.map(customer => <button key={customer.id} data-customer-id={customer.id} className={`crm-customer ${selectedId === customer.id ? 'selected' : ''}`} onClick={() => selectProfile(customer.id)}><span className="crm-avatar"><UserRound size={18}/></span><span><strong>{customer.name}</strong><small dir="ltr">{customer.phone || 'بدون شماره تماس'}</small><small>{balance(customer.rialDebt, 'تومان')}</small></span></button>)}{!visible.length && <div className="empty-state">مشتری پیدا نشد.</div>}</aside>
      {selected ? <section className="crm-profile" ref={profileRef} tabIndex={-1}>
        <header className="crm-profile-header"><div><span className="crm-tag">{selected.tag || 'عادی'}</span><h2>{selected.name}</h2><span><Phone size={13}/> {selected.phone ? <a href={`tel:${selected.phone}`}>{selected.phone}</a> : 'شماره تماس ثبت نشده'}</span></div><button className="button button-ghost crm-edit-button" onClick={() => editCustomer(selected)}><Pencil size={15}/> ویرایش مشخصات</button></header>
        <details className="simple-details crm-account-details"><summary>مشخصات و مانده حساب مشتری</summary><div className="crm-facts"><span><CalendarDays size={15}/> تولد: <b>{dateText(selected.birthDate)}</b></span><span>آخرین معامله: <b>{dateText(summary.lastVisit)}</b></span><span className={selected.followUpDate && selected.followUpDate <= iranDate() ? 'crm-due' : ''}>پیگیری بعدی: <b>{dateText(selected.followUpDate)}</b></span><span>نشانی: <b>{selected.address || 'ثبت نشده'}</b></span></div>
        {selected.note && <p className="crm-note">{selected.note}</p>}
        <div className="crm-stats"><article><span>خرید مشتری از ما</span><strong>{money(summary.purchased)} <small>تومان</small></strong><small>{numeric(invoiceCount(summary.purchases))} سند</small></article><article><span>فروش مشتری به ما</span><strong>{money(summary.sold)} <small>تومان</small></strong><small>{numeric(invoiceCount(summary.sales))} سند</small></article><article><span>مانده ریالی</span><strong>{money(Math.abs(selected.rialDebt || 0))} <small>تومان</small></strong><small>{Number(selected.rialDebt) > 0 ? 'مشتری بدهکار است' : Number(selected.rialDebt) < 0 ? 'مشتری بستانکار است' : 'تسویه'}</small></article><article><span>مانده گرمی</span><strong>{numeric(Math.abs(selected.gramDebt || 0))} <small>گرم</small></strong><small>{Number(selected.gramDebt) > 0 ? 'مشتری بدهکار است' : Number(selected.gramDebt) < 0 ? 'مشتری بستانکار است' : 'تسویه'}</small></article></div>
        </details>
        <nav className="section-tabs profile-tabs" aria-label="بخش‌های پرونده مشتری">{[['history', 'معاملات'], ['preferences', 'الگوی خرید'], ['settlement', 'دریافت و پرداخت']].map(([key, label]) => <button key={key} data-profile-tab={key} aria-pressed={profileTab === key} onClick={() => setProfileTab(key)}>{label}</button>)}</nav>
        {profileTab === 'preferences' && selectedAnalytics && <CustomerInsights key={selectedId} row={selectedAnalytics} days={reportOptions.days} category={reportOptions.category}/>}
        {profileTab === 'history' && <><div className="crm-section-title"><h3>خریدها و فروش‌های مشتری · همه سوابق</h3><select aria-label="فیلتر معاملات مشتری" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">همه معاملات</option><option value="purchase">خرید مشتری از ما</option><option value="sale">فروش مشتری به ما</option></select></div>
        <div className="crm-table-scroll"><table className="crm-history"><thead><tr><th>تاریخ و ساعت</th><th>معامله مشتری</th><th>جنس و جزئیات</th><th>مبلغ ثبت‌شده (تومان)</th><th>مانده این سند</th></tr></thead><tbody>{histories.map(doc => <tr key={doc.id}><td>{doc.date ? formatRecordDate(doc) : 'ثبت نشده'}</td><td>{doc.direction === 'فروش' || String(doc.type).endsWith('-sale') ? 'خرید از ما' : 'فروش به ما'}</td><td><strong>{doc.itemName || doc.description || doc.typeLabel}</strong>{doc.productCode && <bdi className="document-product-code" dir="ltr">{doc.productCode}</bdi>}<small>{doc.itemSummary}</small></td><td>{money(doc.amount)}{tradeGoldPriceSummary(doc) && <small>{tradeGoldPriceSummary(doc)}</small>}</td><td>{money(doc.rialDebt)} تومان<small>{numeric(doc.gramDebt)} گرم</small></td></tr>)}</tbody></table>{!histories.length && <div className="empty-state">معامله‌ای در این بخش ثبت نشده است.</div>}</div>
        </>}
        {profileTab === 'settlement' && <><details className="crm-settlement" open><summary><Wallet size={16}/> ثبت دریافت / پرداخت و تسویه حساب</summary><form className="crm-settlement-form" onSubmit={submitSettlement}><p>دریافت از مشتری بدهی او را کم می‌کند؛ پرداخت به مشتری طلب او را کم می‌کند. مبلغ ریالی و وزن طلای تحویلی جدا ثبت می‌شوند.</p><div className="form-grid"><label>نوع تسویه<select name="direction" value={settlement.direction} onChange={event => setSettlement({ ...settlement, direction: event.target.value })}><option value="received">دریافت از مشتری</option><option value="paid">پرداخت به مشتری</option></select></label><label>تاریخ<PersianDateInput name="settlementDate" required value={settlement.date} onChange={event => setSettlement({ ...settlement, date: event.target.value })}/></label>{[['rialAmount', 'مبلغ (تومان)'], ['gramAmount', 'طلای تحویلی (گرم)'], ['note', 'شرح تسویه']].map(([key, label]) => <label key={key}>{label}<input name={`settlement-${key}`} value={settlement[key]} onChange={event => setSettlement({ ...settlement, [key]: event.target.value })}/></label>)}</div><button className="button button-primary" type="submit">ثبت تسویه</button></form></details>
        {!!selected.settlements?.length && <div className="crm-settlement-list"><h3>سوابق تسویه</h3>{selected.settlements.map(item => <div key={item.id}><span>{item.date ? formatRecordDate(item) : 'ثبت نشده'} · {item.direction === 'received' ? 'دریافت از مشتری' : 'پرداخت به مشتری'}</span><strong>{money(item.rialAmount)} تومان / {numeric(item.gramAmount)} گرم</strong><small>{item.note}</small></div>)}</div>}
        </>}
        {profileTab === 'history' && (selected.purchases || []).filter(item => !summary.transactions.some(doc => doc.id === item.id)).length > 0 && <details className="crm-legacy"><summary>یادداشت‌ها و سوابق قدیمی</summary>{selected.purchases.filter(item => !summary.transactions.some(doc => doc.id === item.id)).map(item => <p key={item.id}>{dateText(item.date)} · {item.title}: {item.detail}</p>)}</details>}
      </section> : <div className="crm-profile crm-select-empty"><UserRound size={32}/><h3>پروندهٔ مشتری</h3><p>مشتری را از فهرست انتخاب کنید تا معاملات و مانده حسابش نمایش داده شود.</p></div>}
    </div>}
  </div>;
}
