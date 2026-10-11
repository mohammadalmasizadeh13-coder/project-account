import React, { useEffect, useRef, useState } from 'react';
import NumberInput from './NumberInput.jsx';
import PersianDateInput from './PersianDateInput.jsx';
import { currencyCatalog } from './assets.js';
import { coinOptions, legacyCoinOptions } from './coins.js';
import { inventoryReport } from './inventory.js';
import { readAccountingDraft, writeAccountingDraft } from './accountingDrafts.js';
import { formatPartnerAmount as fmt } from './partnerLedger.js';
import { formatRecordDate } from './recordTime.js';
import { allBalances, assetLabel, assetName, balanceSide, directions, newOperation, newOperationLine, operationDraft, operationNames,
  operationPayload, operationPreview, tradeValue } from './partnerTrading.js';
import './partner-trading.css';

function Numeric({ label, name, value, onChange, required = true }) {
  return <label>{label}<NumberInput name={name} value={value ?? ''} required={required} onChange={event => onChange(name, event.target.value)}/></label>;
}
export function AssetBalances({ balances, title = 'ماندهٔ حساب' }) {
  return <div className="partner-asset-balances" data-asset-balances aria-label={title}>{Object.entries(balances).map(([key, value]) =>
    <article key={key} data-asset={key}><span>{assetLabel(key)}</span><strong>{fmt(Math.abs(value), key === 'toman' ? 2 : 8)}</strong><small>{balanceSide(value)}</small></article>)}</div>;
}
export function OperationDetails({ entry }) {
  return <section data-operation-details><h3>{operationNames[entry.type]}</h3><div className="partner-table-scroll"><table className="partner-ledger-table"><thead><tr><th>شرح کالا</th><th>نوع</th><th>مقدار</th><th>مظنه / نرخ توافقی (تومان)</th><th>مبلغ (تومان)</th></tr></thead><tbody>
    {entry.lines.map((line, index) => <tr key={index}><td data-partner-item-description>{line.itemName || assetName(line.asset)}</td><td>{directions[line.direction]}{line.simultaneous && ' · هم‌زمان'}</td><td>{fmt(line.quantity, 8)}</td><td>{line.rate ? fmt(line.rate, 4) : '—'}</td><td>{fmt(line.amount, 2)}</td></tr>)}
  </tbody></table></div>
    {entry.type === 'trade' && <p>مظنهٔ آب‌شده برای یک مثقال است؛ وزن حساب به گرم طلای ۷۵۰ ثبت شده است. نرخ و مبلغ این معامله ثابت می‌مانند.</p>}
    {entry.type === 'offset' && <p>نرخ طلا در این تهاتر برای هر گرم طلای ۷۵۰ است؛ تهاتر اثری بر موجودی صندوق ندارد.</p>}
    {entry.type === 'delivery' && entry.lines.filter(line => line.assayCode).map((line, index) => <p key={index}>انگ: {line.assayCode} · آزمایشگاه: {line.laboratoryName} · وزن واقعی: {fmt(line.meltedWeight)} گرم · عیار: {fmt(line.meltedAyar)}</p>)}
    <AssetBalances title="اثر این سند بر حساب" balances={{ gold: entry.goldDebit - entry.goldCredit, toman: entry.tomanDebit - entry.tomanCredit, ...entry.assetChanges }}/>
  </section>;
}

function OperationLine({ line, kind, index, onChange, onRemove, canRemove, stock, balances }) {
  const change = (key, value) => onChange({ ...line, [key]: value });
  const payingStock = kind === 'delivery' && line.direction === 'pay' && line.category !== 'toman';
  const coin = coinOptions.find(item => item.name === line.coinType);
  const value = kind === 'trade' ? tradeValue(line) : null;
  return <section className="partner-invoice-line" data-operation-line={index}>
    <div className="partner-section-heading"><h4>ردیف {fmt(index + 1)}</h4>{canRemove && <button type="button" className="button button-ghost" onClick={onRemove}>حذف ردیف</button>}</div>
    <div className="partner-form-grid">{kind === 'offset' ? <>
      <label>دارایی برای تهاتر<select name="asset" value={line.asset} required onChange={event => onChange({ ...line, asset: event.target.value, rate: event.target.value === 'toman' ? '1' : '' })}><option value="">انتخاب مانده</option>{Object.entries(balances).filter(([, amount]) => amount !== 0).map(([key, amount]) => <option key={key} value={key}>{assetLabel(key)} · {fmt(Math.abs(amount), 8)} · {balanceSide(amount)}</option>)}</select></label>
      <Numeric label="مقدار انتخابی" name="quantity" value={line.quantity} onChange={change}/>
      {line.asset !== 'toman' && <Numeric label={line.asset === 'gold' ? 'نرخ توافقی هر گرم ۷۵۰ (تومان)' : 'نرخ توافقی هر واحد (تومان)'} name="rate" value={line.rate} onChange={change}/>}
    </> : <>
      <label>نوع دارایی<select name="category" value={line.category} onChange={event => onChange({ ...newOperationLine(kind, event.target.value), direction: line.direction })}><option value="melted">آب‌شده</option><option value="coin">سکه</option><option value="currency">ارز</option>{kind === 'delivery' && <option value="toman">وجه نقد / انتقال وجه</option>}</select></label>
      <label>جهت<select name="direction" value={line.direction} onChange={event => onChange({ ...line, direction: event.target.value, inventorySourceId: '' })}>{(kind === 'trade' ? ['purchase', 'sale'] : ['receive', 'pay']).map(key => <option value={key} key={key}>{directions[key]}</option>)}</select></label>
      {payingStock ? <><label>انتخاب جنس از صندوق<select name="inventorySourceId" required value={line.inventorySourceId} onChange={event => change('inventorySourceId', event.target.value)}><option value="">کد جنس را انتخاب کنید</option>{stock.filter(item => item.category === line.category).map(item => <option key={item.id} value={item.id}>{item.productCode} · {item.itemName || item.itemSummary} · موجود: {fmt(item.remaining, 8)}</option>)}</select></label><Numeric label={line.category === 'currency' ? 'مقدار ارز تحویلی' : 'تعداد قطعه / سکه تحویلی'} name="quantity" value={line.quantity} onChange={change}/></> : <>
        {line.category === 'coin' && <><label>نوع سکه<select name="coinType" value={line.coinType} onChange={event => { const next = coinOptions.find(item => item.name === event.target.value); onChange({ ...line, coinType: event.target.value, coinWeight: next?.weight ?? '', coinAyar: next?.ayar ?? '', itemName: '' }); }}>{[...coinOptions, ...legacyCoinOptions].map(item => <option value={item.name} key={item.name}>{item.name}</option>)}</select></label>
          {coin?.custom && <><Numeric label="وزن هر سکه (گرم)" name="coinWeight" value={line.coinWeight} onChange={change}/><Numeric label="عیار سکه" name="coinAyar" value={line.coinAyar} onChange={change}/></>}
          {line.coinType === 'سایر' && <label>نام سکه<input name="itemName" value={line.itemName} maxLength={200} required onChange={event => change('itemName', event.target.value)}/></label>}
        </>}
        {line.category === 'currency' && <label>نوع ارز<select name="currencyType" value={line.currencyType} onChange={event => change('currencyType', event.target.value)}>{currencyCatalog.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>}
        {kind === 'trade' && line.category === 'melted' && <label>روش ورود<select name="inputMode" value={line.inputMode} onChange={event => change('inputMode', event.target.value)}><option value="quantity">وزن + مظنه ← مبلغ</option><option value="amount">مبلغ + مظنه ← وزن</option></select></label>}
        {kind === 'delivery' && line.category === 'melted' ? <>
          <Numeric label="وزن واقعی دریافتی (گرم)" name="meltedWeight" value={line.meltedWeight} onChange={change}/><Numeric label="عیار آب‌شده" name="meltedAyar" value={line.meltedAyar} onChange={change}/>
          <label>شماره انگ<input name="assayCode" value={line.assayCode} required maxLength={200} onChange={event => change('assayCode', event.target.value)}/></label><label>نام آزمایشگاه<input name="laboratoryName" value={line.laboratoryName} required maxLength={200} onChange={event => change('laboratoryName', event.target.value)}/></label>
        </> : <Numeric label={line.category === 'toman' ? 'مبلغ (تومان)' : line.category === 'melted' ? line.inputMode === 'amount' ? 'مبلغ کل معامله (تومان)' : 'وزن حساب (گرم ۷۵۰)' : line.category === 'coin' ? 'تعداد سکه' : 'مقدار ارز'} name={line.category === 'melted' && line.inputMode === 'amount' ? 'amount' : 'quantity'} value={line.category === 'melted' && line.inputMode === 'amount' ? line.amount : line.quantity} onChange={change}/>}
        {line.category !== 'toman' && <Numeric label={line.category === 'melted' ? 'مظنه توافقی (تومان / مثقال)' : line.category === 'coin' ? 'قیمت توافقی هر سکه (تومان)' : 'نرخ هر واحد ارز (تومان)'} name="rate" value={line.rate} onChange={change}/>}
      </>}
    </>}</div>
    {value && <p className="partner-operation-line-total" aria-live="polite">مقدار: {fmt(value.quantity, 8)} {line.category === 'melted' ? 'گرم ۷۵۰' : line.category === 'coin' ? 'سکه' : 'واحد ارز'} · مبلغ: {fmt(value.amount, 2)} تومان · {fmt(value.amount / 1000000, 6)} میلیون تومان</p>}
  </section>;
}

export default function PartnerTrading({ partner, documents, username, onAction, canEdit = true, canDeliver = true, entry = null, revision, onSaved, onClose, onLockChange, onOpenDocument, canEditDocument }) {
  const draftKey = `partner-operation:${partner.id}:${entry?.id || 'new'}`;
  const [state, setState] = useState(() => readAccountingDraft(username, draftKey)?.form || { form: entry ? operationDraft(entry) : newOperation(), pending: null });
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const running = useRef(false);
  const { form, pending } = state;
  const locked = busy || Boolean(pending);
  const stock = inventoryReport(documents.filter(row => !(entry?.documentIds || []).includes(row.id))).available;
  const balances = allBalances(partner);
  // Editing an offset must offer the balances before that offset was applied.
  if (entry?.type === 'offset') {
    balances.gold -= entry.goldDebit - entry.goldCredit; balances.toman -= entry.tomanDebit - entry.tomanCredit;
    for (const [key, value] of Object.entries(entry.assetChanges || {})) balances[key] = (balances[key] || 0) - value;
  }
  const previewPartner = entry ? { ...partner, goldBalance: partner.goldBalance - (entry.goldDebit - entry.goldCredit),
    tomanBalance: partner.tomanBalance - (entry.tomanDebit - entry.tomanCredit),
    assetBalances: Object.fromEntries(Object.entries(partner.assetBalances || {}).map(([key, amount]) => [key, amount - (entry.assetChanges?.[key] || 0)])) } : partner;
  const preview = operationPreview(form, previewPartner, stock);
  useEffect(() => { onLockChange?.(locked); return () => onLockChange?.(false); }, [locked, onLockChange]);
  function persist(next) { writeAccountingDraft(username, draftKey, next); setState(next); }
  function change(next) { try { persist({ form: next, pending: null }); setError(''); setNotice(''); } catch { setError('پیش‌نویس ذخیره نشد؛ فضای مرورگر را بررسی کنید.'); } }
  async function submit(event) {
    event?.preventDefault();
    if (running.current) return;
    const request = pending || { requestId: crypto.randomUUID(), revision, payload: { ...operationPayload(form), ...(entry ? { entryId: entry.id } : {}) } };
    running.current = true; setBusy(true); setError('');
    try {
      persist({ form, pending: request });
      const saved = await onAction(entry ? 'operation-update' : 'operation', partner.id, request.payload, request.requestId, request.revision);
      if (!saved) throw new Error('تأیید ثبت دریافت نشد؛ دوباره تلاش کنید.');
      const next = { form: newOperation(form.kind), pending: null };
      setState(next);
      try { writeAccountingDraft(username, draftKey, next); } catch { /* A confirmed save remains successful. */ }
      setNotice('سند ثبت شد؛ مانده‌های حساب و موجودی به‌روز شدند.');
      onSaved?.(saved);
    } catch (failure) {
      if (failure.status && failure.status < 500) {
        const next = { form, pending: null }; setState(next);
        try { writeAccountingDraft(username, draftKey, next); } catch { /* Keep editable state in memory. */ }
      }
      setError(failure.message || 'ثبت انجام نشد.');
    } finally { running.current = false; setBusy(false); }
  }
  return <section className="partner-trading" data-partner-trading>
    {!entry && <><h3>معاملات حسابی و تسویه · {partner.name}</h3><AssetBalances balances={allBalances(partner)}/></>}
    {canEdit && <form onSubmit={submit} data-operation-form>
      {!entry && <nav className="partner-tabs" aria-label="نوع عملیات حسابی">{Object.entries(operationNames).filter(([key]) => key !== 'delivery' || canDeliver).map(([key, title]) => <button type="button" key={key} data-operation-kind={key} disabled={locked} aria-pressed={form.kind === key} onClick={() => change(newOperation(key))}>{title}</button>)}</nav>}
      <h4>{entry ? 'ویرایش · ' : ''}{operationNames[form.kind]}</h4>
      <p className="partner-help">{form.kind === 'trade' ? 'خرید، طلب جنس و بدهی پول ایجاد می‌کند؛ فروش برعکس است. مبلغ و مقدار با نرخ توافقی ذخیره می‌شوند و با تغییر نرخ روز تغییر نمی‌کنند. جنس تا زمان دریافت واقعی وارد صندوق نمی‌شود.' : form.kind === 'delivery' ? 'دریافت و پرداخت، فقط ماندهٔ همان دارایی را تغییر می‌دهد. جنس دریافتی وارد صندوق و جنس تحویلی از کد انتخاب‌شده کم می‌شود. نرخ ورود، فقط ارزش ثبت موجودی است و بدهی تومانی جدید نمی‌سازد.' : 'بدهی و طلب مورد نظر را انتخاب کنید و مقدار و نرخ توافقی هر کدام را بنویسید. ارزش تومانی دو طرف باید برابر باشد؛ فقط مانده‌های انتخاب‌شده کم می‌شوند.'}</p>
      <fieldset disabled={locked || form.kind === 'delivery' && !canDeliver}>
        <div className="partner-form-grid"><label>تاریخ<PersianDateInput name="date" required value={form.date} onChange={event => change({ ...form, date: event.target.value })}/></label><label>ساعت<input type="time" name="invoiceTime" value={form.invoiceTime} onChange={event => change({ ...form, invoiceTime: event.target.value })}/></label><label>شماره پیگیری<input name="reference" value={form.reference} maxLength={200} onChange={event => change({ ...form, reference: event.target.value })}/></label></div>
        {form.lines.map((line, index) => <OperationLine key={index} {...{ line, index, stock, balances }} kind={form.kind} canRemove={form.lines.length > 1} onRemove={() => change({ ...form, lines: form.lines.filter((_, at) => at !== index) })} onChange={next => change({ ...form, lines: form.lines.map((item, at) => at === index ? next : item) })}/>)}
        <button type="button" className="button button-ghost" data-operation-add-line disabled={form.lines.length >= 99} onClick={() => change({ ...form, lines: [...form.lines, newOperationLine(form.kind)] })}>افزودن ردیف</button>
        {form.kind === 'trade' && <section className="partner-invoice-payment"><h4>دریافت / پرداخت پول هم‌زمان (اختیاری)</h4><div className="partner-form-grid"><label>جهت پول<select name="cashDirection" value={form.cashDirection} onChange={event => change({ ...form, cashDirection: event.target.value })}><option value="pay">پرداخت ما به همکار</option><option value="receive">دریافت ما از همکار</option></select></label><Numeric label="مبلغ پرداخت یا دریافت‌شده (تومان)" name="cashAmount" value={form.cashAmount} required={false} onChange={(key, value) => change({ ...form, [key]: value })}/></div><p>تمام یا بخشی از پول را وارد کنید؛ ماندهٔ جنس تا زمان دریافت یا تحویل باقی می‌ماند.</p></section>}
        <label>یادداشت<textarea name="note" maxLength={5000} value={form.note} onChange={event => change({ ...form, note: event.target.value })}/></label>
        {form.kind === 'offset' && <p data-offset-preview aria-live="polite">ارزش بدهی انتخابی: {fmt(preview.offsetPayable, 2)} تومان · ارزش طلب انتخابی: {fmt(preview.offsetReceivable, 2)} تومان · اختلاف: {fmt(preview.offsetPayable - preview.offsetReceivable, 2)} تومان</p>}
        <h4>مانده پس از ثبت</h4><AssetBalances balances={preview.after}/>
        <button type="submit" className="button button-primary" data-operation-save>{entry ? 'ذخیره تغییرات' : 'ثبت سند'}</button>
      </fieldset>
      {error && <p className="form-message error" role="alert">{error}</p>}{notice && <p className="form-message success" role="status">{notice}</p>}
      {pending && !busy && <button type="button" className="button button-primary" data-operation-retry onClick={() => submit()}>بازیابی همین ثبت</button>}
      {entry && onClose && <button type="button" className="button button-ghost" disabled={locked} onClick={onClose}>بستن ویرایش</button>}
    </form>}
    {!entry && <div className="partner-operation-history"><h4>اسناد معاملات حسابی و تسویه</h4>{[...(partner.entries || [])].reverse().filter(row => row.calculationVersion === 5).map(row => <article key={row.id} data-operation-entry={row.id}><strong>{operationNames[row.type]} · {fmt(row.invoiceNumber)} · {formatRecordDate(row)}</strong><OperationDetails entry={row}/>{row.note && <p>{row.note}</p>}{onOpenDocument && <div className="partner-entry-actions"><button type="button" className="button button-ghost" disabled={locked} onClick={() => onOpenDocument(partner.id, row.id, 'view')}>نمایش و چاپ</button>{(canEditDocument ? canEditDocument(row) : canEdit) && <><button type="button" className="button button-ghost" data-operation-edit disabled={locked} onClick={() => onOpenDocument(partner.id, row.id, 'edit')}>ویرایش</button><button type="button" className="button button-ghost document-delete-link" data-operation-delete disabled={locked} onClick={() => onOpenDocument(partner.id, row.id, 'delete')}>حذف</button></>}</div>}</article>)}</div>}
  </section>;
}
