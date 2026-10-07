import React, { useEffect, useRef, useState } from 'react';
import { Pencil, Trash2, X } from 'lucide-react';
import NumberInput from './NumberInput.jsx';
import PersianDateInput from './PersianDateInput';
import { currencyCatalog, documentBreakdown, number } from './assets';
import { expenseUnits, expenseValue } from './expenses';
import { invoiceItemName } from './invoices';
import { invoiceSettlement } from './invoiceSettlement';
import { isMiscPurchase } from './miscGold';
import './document-editor.css';

const money = value => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(value);
const commonNumbers = [['profitPercent', 'سود (%)'], ['otherCosts', 'سایر هزینه‌های هر واحد (تومان)'], ['discountRial', 'تخفیف ردیف (تومان)']];
function rowFields(row) {
  if (row.type === 'expense') return [['expenseAmount', 'مقدار هزینه']];
  const fields = row.category === 'crafted'
    ? [['itemCount', 'تعداد'], ['weight', 'وزن هر قطعه (گرم)'], ['ayar', 'عیار'], ['gramPrice', 'قیمت هر گرم طلا (تومان)']]
    : row.category === 'melted'
      ? [['itemCount', 'تعداد'], ['meltedWeight', 'وزن هر قطعه (گرم)'], ['meltedAyar', 'عیار'], ['meltedGramPrice', 'قیمت هر گرم طلا (تومان)']]
      : row.category === 'currency'
        ? [['currencyAmount', 'مقدار ارز'], ['currencyRate', 'نرخ هر واحد ارز (تومان)']]
        : [['coinCount', 'تعداد سکه'], [row.coinType === 'پارسیان' ? 'parsianPrice' : 'coinPrice', 'قیمت هر سکه (تومان)'], ...(row.coinType === 'پارسیان' ? [['parsianWeight', 'وزن هر سکه (گرم)']] : [])];
  return [...fields, ...(row.category !== 'currency' && !isMiscPurchase(row) ? [['wagePercent', 'اجرت (%)'], ['wageFixed', 'اجرت ثابت هر واحد (تومان)']] : []), ...(!isMiscPurchase(row) ? commonNumbers : [])];
}

export const canManageInvoice = invoice => invoice?.rows?.length > 0 && invoice.rows.every(row => row.source !== 'opening-inventory' && row.counterpartyType !== 'partner' && !row.partnerId);

export default function DocumentEditor({ invoice, mode, customers, revision, onSave, onClose }) {
  const dialogRef = useRef(null);
  const running = useRef(false);
  const pending = useRef(null);
  const deleting = mode === 'delete';
  const original = invoice.rows;
  const first = original[0];
  const expense = first.type === 'expense';
  const settled = first.settlementVersion === 1;
  const [rows, setRows] = useState(() => original.map(row => ({ ...row })));
  const [header, setHeader] = useState({ date: first.date || '', customerId: first.customerId || '', cashPaid: first.cashPaid ?? '', settlementGoldPrice: first.settlementGoldPrice ?? '', gold18Price: first.gold18Price ?? '', gramDebt: invoice.gramDebt, rialDebt: invoice.rialDebt });
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const dialog = dialogRef.current;
    const focus = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    return () => { dialog.close(); document.body.style.overflow = overflow; if (focus?.isConnected) focus.focus(); };
  }, []);
  function close() { if (!running.current) onClose(); }
  function updateHeader(name, value) { setHeader(previous => ({ ...previous, [name]: value })); setError(''); }
  function updateRow(index, name, value) { setRows(previous => previous.map((row, position) => position === index ? { ...row, [name]: value, ...(name === 'expenseUnit' && value === 'currency' && !row.expenseCurrency ? { expenseCurrency: 'USD' } : {}) } : row)); setError(''); }
  function numericField(index, name, label) {
    return <label key={name}>{label}<NumberInput name={name} value={rows[index][name] ?? (['ayar', 'meltedAyar', 'expenseGoldPurity'].includes(name) ? '750' : ['itemCount', 'coinCount'].includes(name) ? '1' : name === 'expenseAmount' ? rows[index].amount ?? '' : '')} onChange={event => updateRow(index, name, event.target.value)}/></label>;
  }
  const total = rows.reduce((sum, row, index) => {
    if (row.type === 'expense') return sum + expenseValue({ ...row, expenseUnit: row.expenseUnit ?? 'toman', expenseAmount: row.expenseAmount ?? row.amount });
    const economicChange = rowFields(row).some(([key]) => String(row[key] ?? '') !== String(original[index][key] ?? ''));
    const amount = settled ? Math.round(documentBreakdown(row).total) : !economicChange && row.amount != null ? number(row.amount) : documentBreakdown(row).total;
    return sum + amount;
  }, 0);
  const settlement = settled ? invoiceSettlement(rows, header.cashPaid, header.settlementGoldPrice) : null;
  function changes() {
    const customer = customers.find(item => String(item.id) === String(header.customerId));
    return rows.map((row, index) => {
      const next = Object.fromEntries(Object.entries(row).filter(([key, value]) => String(value ?? '') !== String(original[index][key] ?? '')));
      if (header.date !== first.date) next.date = header.date;
      if (!expense && !settled && String(header.gold18Price) !== String(first.gold18Price ?? '')) next.gold18Price = header.gold18Price;
      if (!expense && String(header.customerId) !== String(first.customerId ?? '')) {
        next.customerId = customer?.id ?? header.customerId;
        next.customerName = customer?.name || '';
      }
      if (index === 0 && settled) {
        for (const key of ['cashPaid', 'settlementGoldPrice']) if (String(header[key]) !== String(first[key])) next[key] = header[key];
      } else if (!expense && !settled) {
        for (const key of ['gramDebt', 'rialDebt']) if (number(header[key]) !== number(invoice[key])) next[key] = index === 0 ? header[key] : '0';
      }
      return { id: row.id, changes: next };
    });
  }
  async function submit(event) {
    event.preventDefault();
    if (running.current) return;
    if (!pending.current) {
      const payload = deleting ? null : changes();
      if (!deleting && !payload.some(row => Object.keys(row.changes).length)) { setError('تغییری در سند ایجاد نشده است.'); return; }
      pending.current = { rows: payload, requestId: crypto.randomUUID() };
    }
    running.current = true; setBusy(true); setError('');
    try {
      await onSave(first.id, pending.current.rows, pending.current.requestId, revision);
      onClose();
    } catch (failure) {
      const retry = !failure.status || failure.status >= 500;
      setUncertain(retry);
      if (!retry) pending.current = null;
      setError(failure.message || 'ذخیره انجام نشد؛ دوباره تلاش کنید.');
    } finally { running.current = false; setBusy(false); }
  }
  return <dialog ref={dialogRef} className="document-editor" data-document-action={mode} dir="rtl" aria-labelledby="document-editor-title" onCancel={event => { event.preventDefault(); close(); }}>
    <header><h2 id="document-editor-title">{deleting ? <Trash2 size={21}/> : <Pencil size={21}/>} {deleting ? 'حذف سند' : 'ویرایش سند'} <bdi>{invoice.number}</bdi></h2><button type="button" className="button button-ghost" disabled={busy} aria-label="بستن پنجره" onClick={close}><X size={20}/></button></header>
    <p>{expense ? first.description : invoice.customerName} · {original.length.toLocaleString('fa-IR')} ردیف · {money(invoice.amount)} تومان</p>
    <form onSubmit={submit} aria-busy={busy}>
      {deleting ? <div className="document-delete-message"><p>با تأیید، تمام ردیف‌های این سند حذف می‌شود و موجودی صندوق و ماندهٔ طرف حساب دوباره محاسبه می‌شود.</p><p>از حذف این سند مطمئن هستید؟</p></div> : <fieldset disabled={busy || uncertain} className="document-edit-fields">
        <div className="document-edit-grid">
          <label>تاریخ سند<PersianDateInput name="date" value={header.date} required onChange={event => updateHeader('date', event.target.value)}/></label>
          {!expense && <label>طرف حساب<select name="customerId" value={header.customerId} onChange={event => updateHeader('customerId', event.target.value)}><option value="">{first.customerName || 'انتخاب کنید'}</option>{!customers.some(customer => String(customer.id) === String(header.customerId)) && header.customerId && <option value={header.customerId}>{first.customerName}</option>}{customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>}
          {!expense && !settled && <label>نرخ طلای ۱۸ عیار هنگام معامله (تومان)<NumberInput name="gold18Price" value={header.gold18Price} onChange={event => updateHeader('gold18Price', event.target.value)}/></label>}
        </div>
        {rows.map((row, index) => <fieldset className="document-edit-row" data-document-row={row.id} key={row.id}><legend>{expense ? 'هزینهٔ ثبت‌شده' : `${(index + 1).toLocaleString('fa-IR')} · ${invoiceItemName(row)}`}</legend>
          <div className="document-edit-grid">
            {!expense && <label>نام جنس<input name="itemName" value={row.itemName || ''} maxLength={200} onChange={event => updateRow(index, 'itemName', event.target.value)}/></label>}
            {expense && <><label>دریافت‌کننده<input name="expensePayee" value={row.expensePayee || ''} onChange={event => updateRow(index, 'expensePayee', event.target.value)}/></label><label>واحد هزینه<select name="expenseUnit" value={row.expenseUnit ?? 'toman'} onChange={event => updateRow(index, 'expenseUnit', event.target.value)}>{expenseUnits.map(unit => <option key={unit.value} value={unit.value}>{unit.label}</option>)}</select></label></>}
            {rowFields(row).map(([name, label]) => numericField(index, name, label))}
            {expense && row.expenseUnit === 'gold' && numericField(index, 'expenseGoldPurity', 'عیار طلای هزینه')}
            {expense && row.expenseUnit === 'currency' && <label>نوع ارز<select name="expenseCurrency" value={row.expenseCurrency || 'USD'} onChange={event => updateRow(index, 'expenseCurrency', event.target.value)}>{currencyCatalog.map(currency => <option value={currency.code} key={currency.code}>{currency.name}</option>)}</select></label>}
            {expense && ['gold', 'currency'].includes(row.expenseUnit) && numericField(index, 'expenseRate', 'نرخ تبدیل به تومان')}
            {row.category === 'melted' && <><label>انگ<input name="assayCode" value={row.assayCode || ''} onChange={event => updateRow(index, 'assayCode', event.target.value)}/></label><label>آزمایشگاه<input name="laboratoryName" value={row.laboratoryName || ''} onChange={event => updateRow(index, 'laboratoryName', event.target.value)}/></label></>}
            <label>شرح<textarea name="description" value={row.description || ''} required={expense} onChange={event => updateRow(index, 'description', event.target.value)}/></label>
            <label>یادداشت<textarea name="note" value={row.note || ''} onChange={event => updateRow(index, 'note', event.target.value)}/></label>
          </div>
        </fieldset>)}
        {!expense && <div className="document-edit-grid">{(settled ? [['cashPaid', 'پرداخت نقدی (تومان)'], ['settlementGoldPrice', 'نرخ تبدیل مانده به طلای ۱۸ عیار (تومان)']] : [['gramDebt', 'بدهی گرمی سند'], ['rialDebt', 'بدهی نقدی سند (تومان)']]).map(([key, label]) => <label key={key}>{label}<NumberInput name={key} value={header[key]} onChange={event => updateHeader(key, event.target.value)}/></label>)}</div>}
        <div className="document-edit-preview" aria-live="polite"><strong>مبلغ اصلاح‌شده: {Number.isFinite(total) ? money(total) : '—'} تومان</strong>{settlement && <span>بدهی گرمی: {settlement.gramDebt === null ? '—' : settlement.gramDebt.toLocaleString('fa-IR', { maximumFractionDigits: 6 })} گرم</span>}</div>
      </fieldset>}
      {error && <p role="alert" className="document-edit-error">{error}</p>}
      {uncertain && <p>تأیید سرور دریافت نشد. «تلاش دوباره» همین تغییر را پیگیری می‌کند.</p>}
      <footer><button type="submit" className={`button ${deleting ? 'document-delete-button' : 'button-primary'}`} data-confirm-document-action={mode} disabled={busy}>{busy ? 'در حال ذخیره…' : uncertain ? 'تلاش دوباره' : deleting ? 'تأیید حذف سند' : 'ذخیرهٔ تغییرات'}</button><button type="button" className="button button-ghost" data-document-action-cancel disabled={busy} onClick={close} autoFocus={deleting}>انصراف</button></footer>
    </form>
  </dialog>;
}
