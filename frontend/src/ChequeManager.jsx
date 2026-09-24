import React, { useEffect, useRef, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, BellRing, CalendarClock, CheckCheck, CircleAlert, Landmark, Pencil, Plus, Search, Wallet, X } from 'lucide-react';
import PersianDateInput from './PersianDateInput';
import { formatPersianDate } from './persianDate';
import { iranDate } from './sales';
import { chequeDaysUntilDue, chequeDirections, chequeStatuses, chequeSummary, getChequeReminders, isOutstandingCheque, normalizeChequeText, upsertCheque } from './checks';
import './checks.css';

const number = value => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(value || 0);
const dateText = formatPersianDate;
const newCheque = (direction, today) => ({ direction, counterparty: '', customerId: '', amount: '', bank: '', number: '', issueDate: today, dueDate: '', note: '', status: 'pending' });
const dueText = days => days === null ? '' : days < 0 ? `${number(Math.abs(days))} روز گذشته` : days === 0 ? 'سررسید امروز' : `${number(days)} روز دیگر`;

export function ChequeAlerts({ cheques = [], today = iranDate(), onOpen }) {
  const reminders = getChequeReminders(cheques, today);
  if (!reminders.total) return null;
  return <section className="cheque-alerts" aria-label="یادآوری سررسید چک‌ها">
    <div className="cheque-alert-heading"><div className="cheque-alert-title"><span className="cheque-alert-icon"><BellRing size={20}/></span><div><h2>چک‌های نیازمند پیگیری</h2><p>{number(reminders.overdue)} سررسیدگذشته · {number(reminders.today)} امروز · {number(reminders.upcoming)} تا سه روز آینده</p></div></div><button type="button" className="cheque-text-button" onClick={() => onOpen?.()}>مدیریت چک‌ها <ArrowUpRight size={16}/></button></div>
    <div className="cheque-alert-items">{reminders.items.slice(0, 3).map(cheque => <button type="button" className={`cheque-alert-item ${cheque.urgency}`} key={cheque.id} onClick={() => onOpen?.(cheque)}>
      <span className="cheque-alert-person"><strong>{cheque.counterparty}</strong><small>{chequeDirections[cheque.direction]} · {cheque.bank}{cheque.status === 'bounced' ? ' · برگشتی' : ''}</small></span>
      <span className="cheque-alert-amount"><strong>{number(cheque.amount)} <small>تومان</small></strong><span><time dateTime={cheque.dueDate}>{dateText(cheque.dueDate)}</time> · {dueText(cheque.daysUntilDue)}</span></span>
    </button>)}</div>
    {reminders.total > 3 && <button type="button" className="cheque-more-alerts" onClick={() => onOpen?.()}>مشاهده {number(reminders.total - 3)} چک دیگر</button>}
  </section>;
}

export default function ChequeManager({ cheques = [], customers = [], onSave, parseNumber = Number, today = iranDate(), initialChequeId = '' }) {
  const [direction, setDirection] = useState(() => cheques.find(cheque => cheque.id === initialChequeId)?.direction || 'received');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [dueFilter, setDueFilter] = useState('all');
  const [form, setForm] = useState(() => {
    const selected = cheques.find(cheque => cheque.id === initialChequeId);
    return selected ? { ...selected } : null;
  });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);
  const editorRef = useRef(null);
  const newButtonRef = useRef(null);
  const summary = chequeSummary(cheques, today);
  const editingId = form?.id || (form ? 'new' : '');
  useEffect(() => {
    if (editingId) {
      editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      editorRef.current?.querySelector('[name="counterparty"]')?.focus({ preventScroll: true });
    }
  }, [editingId]);

  const update = event => {
    const { name, value } = event.target;
    setForm(current => ({ ...current, [name]: value }));
    setErrors(current => ({ ...current, [name]: undefined }));
    setMessage(null);
  };
  const openEditor = record => { setForm(record ? { ...record } : newCheque(direction, today)); setErrors({}); setMessage(null); };
  const closeEditor = () => { setForm(null); setErrors({}); newButtonRef.current?.focus(); };
  const save = async event => {
    event.preventDefault();
    if (saving) return;
    try {
      const customer = customers.find(item => normalizeChequeText(item.name) === normalizeChequeText(form.counterparty));
      const next = upsertCheque(cheques, { ...form, customerId: customer?.id || '' }, { parseNumber });
      setSaving(true);
      await onSave(next);
      setDirection(form.direction); setStatus('all'); setDueFilter('all'); setQuery('');
      closeEditor();
      setMessage({ type: 'success', text: form.id ? 'تغییرات چک ذخیره شد.' : 'چک ثبت شد؛ سررسید آن در یادآوری‌ها پیگیری می‌شود.' });
    } catch (error) {
      setErrors(error.fields || {});
      setMessage({ type: 'error', text: error.fields ? 'فیلدهای مشخص‌شده را اصلاح کنید.' : 'چک ذخیره نشد. دوباره تلاش کنید و فضای ذخیره‌سازی مرورگر را بررسی کنید.' });
      if (error.fields) editorRef.current?.querySelector(`[name="${Object.keys(error.fields)[0]}"]`)?.focus();
    } finally { setSaving(false); }
  };
  const fieldProps = name => ({ name, value: form[name], onChange: update, 'aria-invalid': !!errors[name], 'aria-describedby': errors[name] ? `cheque-error-${name}` : undefined });
  const fieldError = name => errors[name] ? <small className="cheque-field-error" id={`cheque-error-${name}`}>{errors[name]}</small> : null;
  const visible = cheques.filter(cheque => {
    if (cheque.direction !== direction || (status !== 'all' && cheque.status !== status)) return false;
    if (!normalizeChequeText(`${cheque.counterparty} ${cheque.bank} ${cheque.number} ${cheque.note || ''}`).toLowerCase().includes(normalizeChequeText(query).toLowerCase())) return false;
    if (dueFilter === 'all') return true;
    const days = chequeDaysUntilDue(cheque.dueDate, today);
    return isOutstandingCheque(cheque) && days !== null && (dueFilter === 'overdue' ? days < 0 : dueFilter === 'today' ? days === 0 : days > 0 && days <= 3);
  }).sort((a, b) => Number(isOutstandingCheque(b)) - Number(isOutstandingCheque(a)) || a.dueDate.localeCompare(b.dueDate) || String(b.createdAt).localeCompare(String(a.createdAt)));

  return <div className="cheque-workspace">
    <header className="cheque-heading"><div><span className="cheque-eyebrow">دریافت‌ها و پرداخت‌های پیش رو</span><h1>مدیریت چک‌ها</h1><p>سررسید، مبلغ و وضعیت هر چک را یک‌جا دنبال کنید.</p></div><button ref={newButtonRef} type="button" className="button button-primary" onClick={() => openEditor(null)}><Plus size={18}/> ثبت چک جدید</button></header>
    <div className="cheque-summary">
      <article><span className="cheque-summary-icon received"><ArrowDownLeft size={20}/></span><span>دریافتی‌های باز</span><strong>{number(summary.received.amount)} <small>تومان</small></strong><small>{number(summary.received.count)} چک در انتظار یا برگشتی</small></article>
      <article><span className="cheque-summary-icon issued"><ArrowUpRight size={20}/></span><span>پرداختی‌های باز</span><strong>{number(summary.issued.amount)} <small>تومان</small></strong><small>{number(summary.issued.count)} چک در انتظار یا برگشتی</small></article>
      <article className={summary.reminders.overdue ? 'cheque-summary-urgent' : ''}><span className="cheque-summary-icon overdue"><CircleAlert size={20}/></span><span>سررسید گذشته</span><strong>{number(summary.reminders.overdue)} <small>چک</small></strong><small>چک‌های باز که نیاز به پیگیری دارند</small></article>
      <article><span className="cheque-summary-icon upcoming"><CalendarClock size={20}/></span><span>امروز تا سه روز آینده</span><strong>{number(summary.reminders.today + summary.reminders.upcoming)} <small>چک</small></strong><small>{number(summary.reminders.today)} چک با سررسید امروز</small></article>
    </div>
    {message && <div role={message.type === 'error' ? 'alert' : 'status'} className={`form-message ${message.type}`}>{message.text}</div>}
    {form && <form ref={editorRef} className="cheque-editor" onSubmit={save} noValidate aria-labelledby="cheque-form-title">
      <div className="cheque-section-heading"><div><h2 id="cheque-form-title">{form.id ? 'ویرایش چک' : 'ثبت چک جدید'}</h2><p>مبلغ را به تومان و تاریخ‌ها را به شمسی وارد کنید.</p></div><button type="button" className="cheque-icon-button" onClick={closeEditor} disabled={saving} aria-label="بستن فرم چک"><X size={19}/></button></div>
      <fieldset disabled={saving}><legend>مشخصات چک و طرف حساب</legend><div className="cheque-form-grid">
        <label>نوع چک<select {...fieldProps('direction')}><option value="received">دریافتی · از طرف حساب</option><option value="issued">پرداختی · به طرف حساب</option></select>{fieldError('direction')}</label>
        <label>نام طرف حساب<input {...fieldProps('counterparty')} list="cheque-customers" required maxLength={120} placeholder="انتخاب مشتری یا نوشتن نام" autoComplete="off"/>{fieldError('counterparty')}<datalist id="cheque-customers">{customers.map(customer => <option key={customer.id} value={customer.name}/>)}</datalist></label>
        <label>مبلغ (تومان)<input {...fieldProps('amount')} required inputMode="numeric" dir="ltr" placeholder="مثلاً ۲۵٬۰۰۰٬۰۰۰"/>{fieldError('amount')}</label>
        <label>نام بانک<input {...fieldProps('bank')} required maxLength={80} placeholder="مثلاً ملت"/>{fieldError('bank')}</label>
        <label>شماره چک / شناسه صیادی<input {...fieldProps('number')} required inputMode="numeric" dir="ltr" maxLength={40} placeholder="شماره درج‌شده روی چک"/>{fieldError('number')}</label>
        <label>وضعیت<select {...fieldProps('status')}>{Object.entries(chequeStatuses).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select>{fieldError('status')}</label>
        <label>تاریخ ثبت (شمسی)<PersianDateInput {...fieldProps('issueDate')} required/>{fieldError('issueDate')}</label>
        <label>تاریخ سررسید (شمسی)<PersianDateInput {...fieldProps('dueDate')} required/>{fieldError('dueDate')}</label>
        <label className="cheque-note-field">توضیحات (اختیاری)<textarea {...fieldProps('note')} maxLength={1000} rows={2} placeholder="بابت معامله، اطلاعات پیگیری یا علت برگشت"/></label>
      </div></fieldset>
      <p className="cheque-form-hint"><CheckCheck size={16}/> وضعیت «پاس‌شده» را پس از تأیید وصول ثبت کنید. برای تغییر مانده حساب، تسویه را در پرونده مشتری ثبت کنید.</p>
      <div className="cheque-form-actions"><button type="submit" className="button button-primary" disabled={saving}><Wallet size={16}/>{saving ? 'در حال ذخیره…' : form.id ? 'ذخیره تغییرات' : 'ثبت چک'}</button><button type="button" className="button button-ghost" disabled={saving} onClick={closeEditor}>انصراف</button></div>
    </form>}
    <section className="cheque-register" aria-label="فهرست چک‌ها">
      <div className="cheque-register-top"><div className="cheque-tabs" aria-label="نوع چک در فهرست">{Object.entries(chequeDirections).map(([key, label]) => <button type="button" key={key} aria-pressed={direction === key} className={direction === key ? 'active' : ''} onClick={() => setDirection(key)}>{key === 'received' ? <ArrowDownLeft size={17}/> : <ArrowUpRight size={17}/>}{label}<span>{number(cheques.filter(cheque => cheque.direction === key).length)}</span></button>)}</div><span className="cheque-result-count">{number(visible.length)} چک</span></div>
      <div className="cheque-filters"><label className="cheque-search"><Search size={17}/><input aria-label="جستجوی چک" value={query} onChange={event => setQuery(event.target.value)} placeholder="طرف حساب، بانک یا شماره چک…"/></label><label>وضعیت<select value={status} onChange={event => setStatus(event.target.value)} aria-label="فیلتر وضعیت چک"><option value="all">همه وضعیت‌ها</option>{Object.entries(chequeStatuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>سررسید<select value={dueFilter} onChange={event => setDueFilter(event.target.value)} aria-label="فیلتر سررسید چک"><option value="all">همه تاریخ‌ها</option><option value="overdue">سررسید گذشته</option><option value="today">امروز</option><option value="upcoming">سه روز آینده</option></select></label></div>
      {visible.length ? <div className="cheque-table-wrap"><table className="cheque-table"><thead><tr><th scope="col">طرف حساب / بانک</th><th scope="col">شماره چک</th><th scope="col">مبلغ (تومان)</th><th scope="col">سررسید / تاریخ ثبت</th><th scope="col">وضعیت</th><th scope="col"><span className="cheque-visually-hidden">عملیات</span></th></tr></thead><tbody>{visible.map(cheque => {
        const days = chequeDaysUntilDue(cheque.dueDate, today);
        const outstanding = isOutstandingCheque(cheque);
        return <tr key={cheque.id} data-cheque-id={cheque.id} className={outstanding && days !== null && days < 0 ? 'cheque-row-overdue' : ''}>
          <td className="cheque-party-cell" data-label="طرف حساب / بانک"><strong>{cheque.counterparty}</strong><small><Landmark size={12}/>{cheque.bank}</small>{cheque.note && <small className="cheque-note">{cheque.note}</small>}</td>
          <td data-label="شماره چک"><bdi className="cheque-number" dir="ltr">{normalizeChequeText(cheque.number).replace(/\d/g, digit => '۰۱۲۳۴۵۶۷۸۹'[digit])}</bdi></td>
          <td data-label="مبلغ (تومان)"><strong className="cheque-money">{number(cheque.amount)}</strong></td>
          <td className="cheque-date-cell" data-label="سررسید / تاریخ ثبت"><time dateTime={cheque.dueDate}>{dateText(cheque.dueDate)}</time>{outstanding && <span className={`cheque-due-label ${days !== null && days < 0 ? 'overdue' : days === 0 ? 'today' : ''}`}>{dueText(days)}</span>}<small>ثبت: <time dateTime={cheque.issueDate}>{dateText(cheque.issueDate)}</time></small></td>
          <td data-label="وضعیت"><span className={`cheque-status ${cheque.status}`}>{chequeStatuses[cheque.status]}</span></td>
          <td className="cheque-row-actions"><button type="button" className="cheque-edit-button" onClick={() => openEditor(cheque)} aria-label={`ویرایش چک ${cheque.number} ${cheque.counterparty}`}><Pencil size={15}/><span>ویرایش</span></button></td>
        </tr>;
      })}</tbody></table></div> : <div className="cheque-empty"><Wallet size={32}/><h3>{cheques.some(cheque => cheque.direction === direction) ? 'چکی با این فیلترها پیدا نشد' : `هنوز چک ${chequeDirections[direction]} ثبت نشده`}</h3><p>{query || status !== 'all' || dueFilter !== 'all' ? 'جستجو یا فیلترها را تغییر دهید.' : 'اولین چک را ثبت کنید تا مبلغ و سررسید آن در دسترس باشد.'}</p>{(query || status !== 'all' || dueFilter !== 'all') ? <button type="button" className="cheque-text-button" onClick={() => { setQuery(''); setStatus('all'); setDueFilter('all'); }}>پاک‌کردن فیلترها</button> : <button type="button" className="cheque-text-button" onClick={() => openEditor(null)}><Plus size={16}/> ثبت چک {chequeDirections[direction]}</button>}</div>}
    </section>
  </div>;
}
