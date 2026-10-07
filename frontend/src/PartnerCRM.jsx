import React, { useEffect, useRef, useState } from 'react';
import NumberInput from './NumberInput.jsx';
import { Coins, FilePlus2, Pencil, Plus, Printer, Search, Trash2, Users, Wallet, X } from 'lucide-react';
import PersianDateInput from './PersianDateInput.jsx';
import { coinCatalog, currencyCatalog } from './assets.js';
import { craftedKinds } from './crmAnalytics.js';
import { formatPersianDate, normalizeDigits } from './persianDate.js';
import { readAccountingDraft, writeAccountingDraft } from './accountingDrafts.js';
import { formatPartnerAmount as fmt, newPartnerInvoice, newPartnerLine, newPartnerProfile, newPartnerSettlement,
  partnerInvoiceTotals, partnerLineTotals, savedPartnerLineTotals, partnerStatement, partnerStockTypes, partnerTradeTypes,
  preparePartnerInvoice, preparePartnerProfile, preparePartnerSettlement, upgradePartnerInvoiceDraft } from './partnerLedger.js';
import './partner-crm.css';

const DRAFT_KIND = 'partner-workspace';
const normalized = value => normalizeDigits(value).replace(/ي/g, 'ی').replace(/ك/g, 'ک').toLowerCase().trim();
const balanceText = (value, unit) => `${fmt(Math.abs(value))} ${unit} · ${value > 0 ? 'بدهی ما به همکار' : value < 0 ? 'طلب ما از همکار' : 'تسویه'}`;
const actionNames = { create: 'ثبت همکار', update: 'ویرایش همکار', invoice: 'ثبت فاکتور خرید', settlement: 'ثبت دریافت و پرداخت' };
const dayText = date => date ? formatPersianDate(date.slice(0, 10)) : '—';
const initialDraft = (username, initialAction) => {
  const recovered = readAccountingDraft(username, DRAFT_KIND)?.form;
  const invoices = recovered?.invoices || {};
  const upgraded = !recovered?.pending && Object.values(invoices).some(invoice => invoice.calculationVersion !== 2);
  return { selectedId: '', view: initialAction || 'statement',
    profileId: null, profile: newPartnerProfile(), invoices: {}, settlements: {}, pending: null,
    ...recovered, ...(initialAction && !recovered?.pending ? { view: initialAction } : {}),
    invoices: recovered?.pending ? invoices : Object.fromEntries(Object.entries(invoices).map(([key, invoice]) => [key, upgradePartnerInvoiceDraft(invoice)])), upgraded,
  };
};

function NumberField({ label, name, value, onChange, required = false, help, ...props }) {
  return <label>{label}<NumberInput {...props} name={name} inputMode="decimal" value={value ?? ''} required={required}
    autoComplete="off" onChange={event => onChange(name, event.target.value)}/>{help && <small>{help}</small>}</label>;
}
function TextField({ label, name, value, onChange, required = false, ...props }) {
  return <label>{label}<input {...props} name={name} value={value ?? ''} required={required}
    maxLength={name === 'note' ? 5000 : 200} onChange={event => onChange(name, event.target.value)}/></label>;
}
function InvoiceLine({ line, index, prices, goldPrice, calculationVersion, categoryLocked = false, onChange, onRemove, canRemove }) {
  const change = (key, value) => onChange({ ...line, [key]: value });
  const metal = ['crafted', 'melted'].includes(line.category);
  const melted = line.category === 'melted';
  const totals = partnerLineTotals(line, goldPrice, calculationVersion);
  return <section className="partner-invoice-line" data-partner-line={index} aria-label={`ردیف ${fmt(index + 1)}`}>
    <div className="partner-line-heading"><h3>ردیف {fmt(index + 1)}</h3>{canRemove && <button type="button" className="partner-icon-button" aria-label={`حذف ردیف ${fmt(index + 1)}`} onClick={onRemove}><Trash2 size={16}/></button>}</div>
    <div className="partner-form-grid">
      <label>نوع کالا<select name="category" value={line.category} disabled={categoryLocked} onChange={event => onChange({ ...newPartnerLine(prices, event.target.value), itemName: line.itemName })}>{Object.entries(partnerStockTypes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <TextField label="نام جنس" name="itemName" value={line.itemName} onChange={change} required/>
      {metal ? <>
        <NumberField label="تعداد قطعه / عدد" name="itemCount" value={line.itemCount} onChange={change} required/>
        <label>روش ثبت وزن<select name="weightMode" value={line.weightMode} onChange={event => change('weightMode', event.target.value)}><option value="total">وزن کل ردیف</option><option value="unit">وزن هر عدد</option></select></label>
        <NumberField label={line.weightMode === 'unit' ? 'وزن هر عدد (گرم)' : 'وزن کل ردیف (گرم)'} name={melted ? 'meltedWeight' : 'weight'} value={melted ? line.meltedWeight : line.weight} onChange={change} required/>
        <NumberField label="عیار واقعی" name={melted ? 'meltedAyar' : 'ayar'} value={melted ? line.meltedAyar : line.ayar} onChange={change} required/>
        <NumberField label="اجرت درصدی (به طلا)" name="wagePercent" value={line.wagePercent} onChange={change} help="اجرت به وزن طلای ۷۵۰ بدهی اضافه می‌شود."/>
        {calculationVersion === 2 ? <><NumberField label={`اجرت ریالی هر عدد (${line.wageFixedUnit === 'rial' ? 'ریال' : 'تومان'})`} name="wageFixed" value={line.wageFixed} onChange={change} help="مبلغ با نرخ فاکتور به گرم طلای ۷۵۰ تبدیل می‌شود."/><label>واحد مبلغ اجرت<select name="wageFixedUnit" value={line.wageFixedUnit || 'toman'} onChange={event => change('wageFixedUnit', event.target.value)}><option value="toman">تومان</option><option value="rial">ریال</option></select></label></>
          : <NumberField label="نرخ هر گرم ۷۵۰ (تومان)" name={melted ? 'meltedGramPrice' : 'gramPrice'} value={melted ? line.meltedGramPrice : line.gramPrice} onChange={change} placeholder="نرخ بالای فاکتور"/>}
        {melted ? <><TextField label="شماره انگ" name="assayCode" value={line.assayCode} onChange={change} required/><TextField label="آزمایشگاه" name="laboratoryName" value={line.laboratoryName} onChange={change} required/></>
          : <label>نوع کار<select name="craftedKind" value={line.craftedKind} onChange={event => change('craftedKind', event.target.value)}>{craftedKinds.map(kind => <option key={kind}>{kind}</option>)}</select></label>}
      </> : line.category === 'coin' ? <>
        <label>نوع سکه<select name="coinType" value={line.coinType} onChange={event => { const name = event.target.value; const field = coinCatalog.find(coin => coin.name === name)?.price; onChange({ ...line, coinType: name, coinPrice: String(prices[field] || '') }); }}>{coinCatalog.map(coin => <option key={coin.name}>{coin.name}</option>)}</select></label>
        <NumberField label="تعداد سکه" name="coinCount" value={line.coinCount} onChange={change} required/>
        {line.coinType === 'پارسیان' ? <><NumberField label="وزن هر سکه پارسیان (گرم)" name="parsianWeight" value={line.parsianWeight} onChange={change} required/><NumberField label="قیمت هر سکه پارسیان (تومان)" name="parsianPrice" value={line.parsianPrice} onChange={change} required/></>
          : <NumberField label="قیمت هر سکه (تومان)" name="coinPrice" value={line.coinPrice} onChange={change} required/>}
      </> : <>
        <label>نوع ارز<select name="currencyType" value={line.currencyType} onChange={event => { const code = event.target.value; const field = currencyCatalog.find(currency => currency.code === code)?.price; onChange({ ...line, currencyType: code, currencyRate: String(prices[field] || '') }); }}>{currencyCatalog.map(currency => <option key={currency.code} value={currency.code}>{currency.name}</option>)}</select></label>
        <NumberField label="مقدار ارز" name="currencyAmount" value={line.currencyAmount} onChange={change} required/>
        <NumberField label="نرخ هر واحد ارز (تومان)" name="currencyRate" value={line.currencyRate} onChange={change} required/>
      </>}
      <NumberField label="هزینه دیگر هر عدد / واحد (تومان)" name="otherCosts" value={line.otherCosts} onChange={change}/>
      {calculationVersion === 2 && <NumberField label="سود همکار (درصد)" name="profitPercent" value={line.profitPercent} onChange={change} help="درصد دلخواه یا صفر؛ سود روی اصل طلا به‌اضافهٔ اجرت و هزینه‌ها، به گرم محاسبه می‌شود."/>}
    </div>
    <div className="partner-line-preview" aria-live="polite">{metal && <><span>وزن واقعی کل: <b>{fmt(totals.actualWeight)} گرم</b></span><span>اصل طلای ۷۵۰: <b>{fmt(totals.weight750)} گرم</b></span><span>اجرت درصدی به طلا: <b>{fmt(totals.laborGold)} گرم</b></span></>}
      {calculationVersion === 2 && <>{!metal && <span>معادل مبلغ کالا: <b>{fmt(totals.principalGold)} گرم</b></span>}<span>اجرت ریالی به طلا: <b data-partner-fixed-labor-gold>{fmt(totals.fixedLaborGold)} گرم</b></span><span>هزینه‌ها به طلا: <b>{fmt(totals.otherCostsGold)} گرم</b></span><span>سود به طلا: <b data-partner-profit-gold>{fmt(totals.profitGold)} گرم</b></span></>}
      {metal || calculationVersion === 2 ? <strong data-partner-line-gold-debit>بدهی ردیف: {fmt(totals.goldDebit)} گرم ۷۵۰</strong> : <strong>بدهی ردیف: {fmt(totals.tomanDebit, 2)} تومان</strong>}</div>
  </section>;
}

function PartnerRemittancePlaceholder() {
  return <section className="partner-remittance-placeholder" data-partner-remittance-placeholder><Wallet size={30}/><h2>حواله همکار</h2><p>بخش حواله همکار آمادهٔ تکمیل است. روش ثبت و محاسبات حواله پس از مشخص شدن جزئیات آن اضافه می‌شود.</p><span>فعلاً سند مالی در این بخش ثبت نمی‌شود.</span></section>;
}

function StatementInvoiceLines({ entry, docById }) {
  const lines = entry.lines?.length ? entry.lines : (entry.documentIds || []).filter(id => docById.has(String(id))).map(id => ({ documentId: id }));
  if (entry.calculationVersion === 2) return <div className="partner-table-scroll"><table className="partner-invoice-lines"><thead><tr><th>شرح</th><th>تعداد</th><th>وزن واقعی (گرم)</th><th>عیار</th><th>وزن ۷۵۰ (گرم)</th><th>اجرت درصدی</th><th>درصد سود</th><th>بدهی طلای ۷۵۰ (گرم)</th></tr></thead>{lines.map((line, index) => {
    const totals = savedPartnerLineTotals(line, docById.get(String(line.documentId)), entry);
    return <tbody key={index}><tr><td>{totals.itemName}<small>{partnerStockTypes[totals.category]}</small></td><td><bdi>{fmt(totals.count)}</bdi></td><td><bdi>{totals.actualWeight ? fmt(totals.actualWeight) : '—'}</bdi></td><td><bdi>{totals.purity == null ? '—' : fmt(totals.purity)}</bdi></td><td><bdi>{fmt(totals.weight750)}</bdi></td><td><bdi>{fmt(totals.wagePercent)}٪</bdi></td><td><bdi>{fmt(totals.profitPercent)}٪</bdi></td><td><bdi>{fmt(totals.goldDebit)}</bdi></td></tr>
      <tr className="partner-invoice-audit-row"><td colSpan={8}><div className="partner-invoice-audit-values"><span>اجرت درصدی به طلا: <bdi>{fmt(totals.laborGold)} گرم</bdi></span><span>اجرت ریالی به طلا: <bdi>{fmt(totals.fixedLaborGold)} گرم</bdi></span><span>هزینه‌ها به طلا: <bdi>{fmt(totals.otherCostsGold)} گرم</bdi></span><span>سود به طلا: <bdi>{fmt(totals.profitGold)} گرم</bdi></span><span>نرخ تبدیل هر گرم ۷۵۰: <bdi>{fmt(totals.conversionGoldPrice, 2)} تومان</bdi></span>{totals.tomanDebit !== 0 && <span>بدهی تومان: <bdi>{fmt(totals.tomanDebit, 2)}</bdi></span>}</div></td></tr></tbody>;
  })}</table></div>;
  return <div className="partner-table-scroll"><table><thead><tr><th>شرح</th><th>تعداد</th><th>وزن واقعی کل</th><th>عیار</th><th>وزن ۷۵۰</th><th>اجرت درصدی</th><th>اجرت طلا</th><th>فی تومان</th><th>بدهی طلا</th><th>بدهی تومان</th></tr></thead><tbody>{lines.map((line, index) => {
    const totals = savedPartnerLineTotals(line, docById.get(String(line.documentId)), entry);
    return <tr key={index}><td>{totals.itemName}<small>{partnerStockTypes[totals.category]}</small></td><td>{fmt(totals.count)}</td><td>{totals.actualWeight ? `${fmt(totals.actualWeight)} گرم` : '—'}</td><td>{totals.purity == null ? '—' : fmt(totals.purity)}</td><td>{fmt(totals.weight750)}</td><td>{fmt(totals.wagePercent)}٪</td><td>{fmt(totals.laborGold)}</td><td>{fmt(totals.rate, 2)}</td><td>{fmt(totals.goldDebit)}</td><td>{fmt(totals.tomanDebit, 2)}</td></tr>;
  })}</tbody></table></div>;
}

function PartnerStatement({ partner, username, documents }) {
  const statement = partnerStatement(partner);
  const [selectedEntry, setSelectedEntry] = useState('');
  const row = statement.rows.find(entry => entry.id === selectedEntry);
  const docById = new Map(documents.map(document => [String(document.id), document]));
  function print() {
    document.body.classList.add('partner-print-open');
    window.addEventListener('afterprint', () => document.body.classList.remove('partner-print-open'), { once: true });
    window.print();
  }
  useEffect(() => () => document.body.classList.remove('partner-print-open'), []);
  return <section className="partner-statement" data-partner-statement>
    <div className="partner-section-heading partner-screen-only"><h3>گردش حساب همکار</h3><button type="button" className="button button-ghost" data-partner-print onClick={print}><Printer size={16}/> چاپ صورت‌حساب</button></div>
    <header className="partner-print-heading"><h2>صورت‌حساب همکار · {partner.name}</h2><p>دفتر حسابداری <bdi>{username}</bdi> · {partnerTradeTypes[partner.tradeType]}</p>{partner.phone && <p>تلفن: <bdi>{partner.phone}</bdi></p>}</header>
    <p className="partner-ledger-help">بدهکار: خرید و بدهی ما به همکار؛ بستانکار: پرداخت ما. خریدهای جدید با سود و اجرت به گرم طلای ۷۵۰ ثبت می‌شوند. گردش‌ها و ماندهٔ تومانی قبلی نیز در صورت‌حساب نمایش داده می‌شوند.</p>
    <div className="partner-statement-opening"><span>مانده قبلی / اولیه: {balanceText(statement.openingGoldBalance, 'گرم ۷۵۰')}</span><span>{balanceText(statement.openingTomanBalance, 'تومان')}</span></div>
    <div className="partner-table-scroll"><table className="partner-ledger-table"><caption>گردش بدهکار و بستانکار همکار؛ تمام وزن‌های حساب، معادل طلای ۷۵۰ هستند.</caption><thead><tr><th>تاریخ و سند</th><th>شرح / ارجاع</th><th>بدهکار طلا</th><th>بستانکار طلا</th><th>بدهکار تومان</th><th>بستانکار تومان</th><th>مانده طلا</th><th>مانده تومان</th><th className="partner-screen-only">جزئیات</th></tr></thead>
      <tbody>{statement.rows.map(entry => <React.Fragment key={entry.id}><tr data-partner-entry={entry.id}><td>{dayText(entry.date)}<small>{entry.type === 'purchase' ? `خرید · ${entry.externalInvoiceNumber || entry.invoiceNumber || 'فاکتور'}` : entry.goldDebit > 0 || entry.tomanDebit > 0 ? 'دریافت از همکار' : 'پرداخت / حواله'}</small></td><td>{entry.note || (entry.type === 'purchase' ? 'فاکتور خرید از همکار' : 'تسویه حساب')}<small>{[entry.counterpartyName, entry.reference].filter(Boolean).join(' · ')}</small></td><td>{fmt(entry.goldDebit)}</td><td>{fmt(entry.goldCredit)}</td><td>{fmt(entry.tomanDebit, 2)}</td><td>{fmt(entry.tomanCredit, 2)}</td><td>{fmt(entry.goldBalance)}</td><td>{fmt(entry.tomanBalance, 2)}</td><td className="partner-screen-only"><button type="button" className="partner-table-action" aria-expanded={selectedEntry === entry.id} onClick={() => setSelectedEntry(selectedEntry === entry.id ? '' : entry.id)}>مشاهده</button></td></tr>
        <tr className={`partner-balance-row ${selectedEntry === entry.id ? '' : 'partner-print-only'}`}><td colSpan={9}><span>مانده قبلی: {fmt(entry.previousGoldBalance)} گرم / {fmt(entry.previousTomanBalance, 2)} تومان</span><span>مانده این سند: {fmt(entry.documentGoldBalance)} گرم / {fmt(entry.documentTomanBalance, 2)} تومان</span><span>مانده نهایی: {fmt(entry.goldBalance)} گرم / {fmt(entry.tomanBalance, 2)} تومان</span></td></tr></React.Fragment>)}</tbody>
      <tfoot><tr><th colSpan={2}>جمع گردش</th><td>{fmt(statement.goldDebit)}</td><td>{fmt(statement.goldCredit)}</td><td>{fmt(statement.tomanDebit, 2)}</td><td>{fmt(statement.tomanCredit, 2)}</td><td>{fmt(statement.goldBalance)}</td><td>{fmt(statement.tomanBalance, 2)}</td><td className="partner-screen-only"/></tr></tfoot></table></div>
    {!statement.rows.length && <p className="partner-empty">هنوز خرید یا پرداختی در حساب این همکار ثبت نشده است.</p>}
    {row?.type === 'purchase' && <section className="partner-entry-details partner-screen-only"><h4>ردیف‌های فاکتور {row.externalInvoiceNumber || row.invoiceNumber || ''}</h4><StatementInvoiceLines entry={row} docById={docById}/></section>}
    <div className="partner-print-only">{statement.rows.filter(entry => entry.type === 'purchase').map(entry => <section className="partner-print-invoice" key={entry.id}><h4>فاکتور {entry.externalInvoiceNumber || entry.invoiceNumber || ''} · {dayText(entry.date)}</h4><StatementInvoiceLines entry={entry} docById={docById}/><p>مانده قبل: {fmt(entry.previousGoldBalance)} گرم / {fmt(entry.previousTomanBalance, 2)} تومان · مانده این سند: {fmt(entry.documentGoldBalance)} گرم / {fmt(entry.documentTomanBalance, 2)} تومان · مانده پس از سند: {fmt(entry.goldBalance)} گرم / {fmt(entry.tomanBalance, 2)} تومان</p></section>)}</div>
    <div className="partner-statement-final"><strong>مانده نهایی: {balanceText(statement.goldBalance, 'گرم ۷۵۰')}</strong><strong>{balanceText(statement.tomanBalance, 'تومان')}</strong></div>
  </section>;
}

export default function PartnerCRM({ username, partners = [], documents = [], prices = {}, onAction, readOnly = false, canPurchase = false, initialAction = '', embedded = false, initialCategory = 'crafted' }) {
  const [draft, setDraft] = useState(() => initialDraft(username, initialAction));
  const draftRef = useRef(draft); draftRef.current = draft;
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [storageError, setStorageError] = useState('');
  const running = useRef(false);
  const mounted = useRef(true);
  const canEdit = !readOnly && typeof onAction === 'function';
  const selected = partners.find(partner => String(partner.id) === String(draft.selectedId)) || partners[0];
  const selectedId = selected?.id || '';
  const locked = busy || !!draft.pending;
  const invoiceKey = embedded ? `${selectedId}:${initialCategory}` : selectedId;
  const invoice = draft.invoices[invoiceKey] || newPartnerInvoice(prices, embedded ? initialCategory : 'crafted');
  const view = embedded ? initialAction || 'invoice' : draft.view;
  const settlement = draft.settlements[selectedId] || newPartnerSettlement();
  const totals = partnerInvoiceTotals(invoice);
  const statement = partnerStatement(selected);
  const visible = partners.filter(partner => normalized(`${partner.name} ${partner.phone} ${partnerTradeTypes[partner.tradeType]}`).includes(normalized(query)));
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    try { writeAccountingDraft(username, DRAFT_KIND, draft, draft.pending?.requestId || null); setStorageError(''); }
    catch { setStorageError('پیش‌نویس در مرورگر ذخیره نشد؛ فضای ذخیره‌سازی مرورگر را بررسی کنید.'); }
  }, [username, draft]);
  function update(change) { if (!locked) setDraft(previous => ({ ...previous, ...change })); setNotice(null); }
  function updateInvoice(key, value) { update({ selectedId, invoices: { ...draft.invoices, [invoiceKey]: { ...invoice, [key]: value } } }); }
  function updateSettlement(key, value) { update({ selectedId, settlements: { ...draft.settlements, [selectedId]: { ...settlement, [key]: value } } }); }
  function editProfile(partner) { update({ profileId: partner?.id || 'new', profile: newPartnerProfile(partner) }); }
  async function submitPending(pending) {
    if (running.current || !canEdit) return;
    running.current = true; setBusy(true); setNotice(null);
    try {
      const snapshot = { ...draftRef.current, pending };
      writeAccountingDraft(username, DRAFT_KIND, snapshot, pending.requestId);
      setDraft(snapshot);
      const saved = await onAction(pending.action, pending.partnerId, structuredClone(pending.payload), pending.requestId);
      if (!saved || !Array.isArray(saved.data?.partners)) throw new Error('تأیید کامل ثبت دریافت نشد؛ ثبت را بازیابی کنید.');
      const id = pending.action === 'create' ? saved.createdId || saved.data.partners.find(partner => partner.name === pending.payload.name)?.id : pending.partnerId;
      const next = { ...draftRef.current, pending: null, selectedId: id || draftRef.current.selectedId, view: embedded ? initialAction || 'invoice' : 'statement' };
      if (pending.action === 'create' || pending.action === 'update') { next.profileId = null; next.profile = newPartnerProfile(); }
      if (pending.action === 'invoice') next.invoices = { ...next.invoices, [pending.invoiceKey || pending.partnerId]: newPartnerInvoice(prices, pending.payload.lines?.[0]?.category || 'crafted') };
      if (pending.action === 'settlement') next.settlements = { ...next.settlements, [pending.partnerId]: newPartnerSettlement() };
      // An acknowledged server commit remains successful even if local cleanup fails.
      try { writeAccountingDraft(username, DRAFT_KIND, next); } catch { /* The retained request safely replays. */ }
      if (mounted.current) { setDraft(next); setNotice({ type: 'success', text: `${actionNames[pending.action]} انجام شد و مانده حساب به‌روز شد.` }); }
    } catch (error) {
      if (mounted.current) {
        if ([400, 403, 404, 413, 422].includes(error.status)) setDraft(previous => ({ ...previous, pending: null }));
        setNotice({ type: 'error', text: error.status === 409 ? `${error.message} صفحه را تازه کنید و همین ثبت را بازیابی کنید.` : error.message || 'ثبت تأیید نشد؛ برای ادامه، همین ثبت را بازیابی کنید.' });
      }
    } finally { running.current = false; if (mounted.current) setBusy(false); }
  }
  function submit(action, partnerId, payloadFactory, event) {
    event.preventDefault();
    if (locked) return;
    try { const payload = payloadFactory(); submitPending({ action, partnerId, payload, ...(action === 'invoice' ? { invoiceKey } : {}), requestId: crypto.randomUUID() }); }
    catch (error) { setNotice({ type: 'error', text: error.message }); }
  }
  const profileChange = (key, value) => update({ profile: { ...draft.profile, [key]: value } });
  const editingPartner = partners.find(partner => partner.id === draft.profileId);
  const mayEditOpening = !editingPartner?.entries?.length;
  return <div className={`partner-crm${embedded ? ' partner-crm-embedded' : ''}`} dir="rtl">
    {!embedded && <header className="simple-heading"><div><span>دفتر همکاران و تأمین‌کنندگان</span><h1>{initialAction === 'invoice' ? 'خرید از همکار' : 'حساب همکاران'}</h1><p>خرید از بنکدار، طلافروش و آبشده‌فروش؛ بدهی خرید به گرم طلای ۷۵۰ در پروندهٔ همکار ثبت می‌شود.</p></div></header>}
    {(!embedded || view !== 'remittance') && <div className="partner-toolbar">{embedded ? <label className="partner-select">همکار فروشنده<select data-partner-select name="partnerId" value={selectedId} disabled={locked || !partners.length} onChange={event => update({ selectedId: event.target.value, profileId: null })}>{!partners.length && <option value="">ابتدا همکار را ثبت کنید</option>}{partners.map(partner => <option key={partner.id} value={partner.id}>{partner.name} · {partnerTradeTypes[partner.tradeType]}</option>)}</select></label> : <label className="partner-search"><Search size={17}/><input aria-label="جستجوی همکار" placeholder="نام، شماره تماس یا گروه همکار…" value={query} onChange={event => setQuery(event.target.value)}/></label>}{canEdit && <button type="button" className="button button-primary" data-partner-new disabled={locked} onClick={() => editProfile(null)}><Plus size={16}/> همکار جدید</button>}</div>}
    {notice && <p className={`form-message ${notice.type}`} role={notice.type === 'error' ? 'alert' : 'status'}>{notice.text}</p>}
    {storageError && <p className="form-message error" role="alert">{storageError}</p>}
    {draft.upgraded && view === 'invoice' && <p className="partner-help" role="status">پیش‌نویس خرید با محاسبهٔ طلایی به‌روز شد. اجرت ریالی و هزینه‌ها به گرم تبدیل می‌شوند؛ درصد سود هر ردیف را پیش از ثبت بررسی کنید.</p>}
    {draft.pending && <section className="partner-pending" role="status"><div><strong>{actionNames[draft.pending.action]} در انتظار تأیید است</strong><p>اطلاعات این ثبت نگه داشته شده است. بازیابی، همین ثبت را پیگیری می‌کند و ثبت تکراری نمی‌سازد.</p></div><button type="button" className="button button-primary" data-partner-retry disabled={busy || !canEdit} onClick={() => submitPending(draft.pending)}>{busy ? 'در حال بررسی…' : 'بازیابی همین ثبت'}</button></section>}
    {canEdit && draft.profileId && <form className="partner-profile-editor" data-partner-profile onSubmit={event => submit(editingPartner ? 'update' : 'create', editingPartner?.id || null, () => preparePartnerProfile(draft.profile, mayEditOpening), event)}>
      <div className="partner-section-heading"><h2>{editingPartner ? 'ویرایش مشخصات همکار' : 'ثبت همکار جدید'}</h2><button type="button" className="partner-icon-button" aria-label="بستن فرم همکار" disabled={locked} onClick={() => update({ profileId: null })}><X size={18}/></button></div>
      <fieldset disabled={locked}><div className="partner-form-grid"><TextField label="نام همکار / مجموعه" name="name" value={draft.profile.name} onChange={profileChange} required/><label>گروه همکار<select name="tradeType" value={draft.profile.tradeType} onChange={event => profileChange('tradeType', event.target.value)}>{Object.entries(partnerTradeTypes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><TextField label="شماره تماس" name="phone" value={draft.profile.phone} onChange={profileChange} dir="ltr"/><TextField label="نشانی" name="address" value={draft.profile.address} onChange={profileChange}/></div><label className="partner-wide-field">یادداشت<textarea name="note" value={draft.profile.note} maxLength={5000} rows={2} onChange={event => profileChange('note', event.target.value)}/></label>
      {mayEditOpening ? <details className="partner-opening-editor"><summary>مانده قبل از شروع حسابداری</summary><div className="partner-form-grid">{[['Gold', 'طلای ۷۵۰ (گرم)'], ['Toman', 'تومان']].map(([unit, label]) => <React.Fragment key={unit}><NumberField label={`مانده اولیه ${label}`} name={`opening${unit}Balance`} value={draft.profile[`opening${unit}Balance`]} onChange={profileChange}/><label>نوع مانده اولیه<select name={`opening${unit}Direction`} value={draft.profile[`opening${unit}Direction`]} onChange={event => profileChange(`opening${unit}Direction`, event.target.value)}><option value="debit">بدهی ما به همکار</option><option value="credit">طلب ما از همکار</option></select></label></React.Fragment>)}</div></details> : <p className="partner-help">مانده اولیه پس از ثبت گردش حساب ثابت است؛ تغییر مانده را با سند دریافت یا پرداخت ثبت کنید.</p>}
      <button type="submit" className="button button-primary" data-partner-save>{busy ? 'در حال ذخیره…' : 'ذخیره همکار'}</button></fieldset>
    </form>}
    {embedded && view === 'remittance' ? <PartnerRemittancePlaceholder/> : <div className="partner-columns">{!embedded && <aside className="partner-contact-list" aria-label="پرونده همکاران"><div className="partner-list-title"><strong>همکاران</strong><span>{fmt(visible.length)} پرونده</span></div>{visible.map(partner => <button type="button" key={partner.id} data-partner-id={partner.id} disabled={locked} aria-pressed={selectedId === partner.id} className={selectedId === partner.id ? 'is-selected' : ''} onClick={() => update({ selectedId: partner.id, profileId: null })}><span className="partner-avatar"><Users size={17}/></span><span><strong>{partner.name}</strong><small>{partnerTradeTypes[partner.tradeType]}</small>{partner.phone && <small dir="ltr">{partner.phone}</small>}</span></button>)}{!visible.length && <p className="partner-empty">{query ? 'همکاری با این مشخصات پیدا نشد.' : 'برای شروع، اولین همکار را ثبت کنید.'}</p>}</aside>}
    <main className="partner-profile">{selected ? <>
      {!embedded && <header className="partner-profile-heading"><div><span className="partner-tag">{partnerTradeTypes[selected.tradeType]}</span><h2>{selected.name}</h2>{selected.phone && <a href={`tel:${selected.phone}`} dir="ltr">{selected.phone}</a>}{selected.address && <p>{selected.address}</p>}</div>{canEdit && <button type="button" className="button button-ghost" disabled={locked} onClick={() => editProfile(selected)}><Pencil size={15}/> ویرایش همکار</button>}</header>}
      {!embedded && selected.note && <p className="partner-profile-note">{selected.note}</p>}
      {!embedded && <div className="partner-balance-cards"><article><span>مانده حساب طلا</span><strong data-partner-gold-balance>{fmt(Math.abs(statement.goldBalance))} <small>گرم ۷۵۰</small></strong><small>{statement.goldBalance > 0 ? 'بدهی ما به همکار' : statement.goldBalance < 0 ? 'طلب ما از همکار' : 'تسویه'}</small></article><article><span>مانده حساب تومان</span><strong data-partner-toman-balance>{fmt(Math.abs(statement.tomanBalance), 2)} <small>تومان</small></strong><small>{statement.tomanBalance > 0 ? 'بدهی ما به همکار' : statement.tomanBalance < 0 ? 'طلب ما از همکار' : 'تسویه'}</small></article></div>}
      {!embedded && <nav className="partner-tabs" aria-label="عملیات همکار"><button type="button" aria-pressed={view === 'statement'} disabled={locked} onClick={() => update({ view: 'statement' })}>گردش و صورت‌حساب</button>{canPurchase && canEdit && <button type="button" data-partner-purchase aria-pressed={view === 'invoice'} disabled={locked} onClick={() => update({ view: 'invoice' })}><FilePlus2 size={16}/> فاکتور خرید</button>}{canEdit && <><button type="button" data-partner-settlement aria-pressed={view === 'settlement'} disabled={locked} onClick={() => update({ view: 'settlement' })}><Wallet size={16}/> دریافت و پرداخت</button><button type="button" data-partner-remittance aria-pressed={view === 'remittance'} disabled={locked} onClick={() => update({ view: 'remittance' })}>حواله همکار</button></>}</nav>}
      {view === 'invoice' && canPurchase && canEdit ? <form data-partner-invoice className="partner-invoice-form" onSubmit={event => submit('invoice', selectedId, () => preparePartnerInvoice(invoice), event)}><fieldset disabled={locked}>
        <h3>فاکتور خرید از {selected.name}</h3><p className="partner-help">کل بدهی این خرید به گرم طلای ۷۵۰ محاسبه می‌شود. اجرت ریالی، هزینه‌ها و مبلغ سکه با نرخ همین فاکتور به طلا تبدیل می‌شوند. درصد سود قابل تغییر است؛ برای خرید بدون سود، صفر وارد کنید.</p>
        <div className="partner-form-grid"><label>تاریخ فاکتور<PersianDateInput name="date" value={invoice.date} required onChange={event => updateInvoice('date', event.target.value)}/></label><TextField label="شماره فاکتور همکار" name="externalInvoiceNumber" value={invoice.externalInvoiceNumber} onChange={updateInvoice}/><NumberField label="نرخ تبدیل هر گرم طلای ۷۵۰ (تومان)" name="gold18Price" value={invoice.gold18Price} onChange={updateInvoice} required/></div>
        {invoice.lines.map((line, index) => <InvoiceLine key={index} line={line} index={index} prices={prices} goldPrice={invoice.gold18Price} calculationVersion={invoice.calculationVersion} categoryLocked={embedded} canRemove={invoice.lines.length > 1} onRemove={() => updateInvoice('lines', invoice.lines.filter((_, at) => at !== index))} onChange={next => updateInvoice('lines', invoice.lines.map((item, at) => at === index ? next : item))}/>)}
        <button type="button" className="button button-ghost" data-partner-add-line disabled={invoice.lines.length >= 100} onClick={() => updateInvoice('lines', [...invoice.lines, newPartnerLine({ ...prices, goldGramPrice: invoice.gold18Price }, embedded ? initialCategory : 'crafted')])}><Plus size={16}/> افزودن ردیف کالا</button>
        <details className="partner-invoice-payment"><summary>پرداخت هم‌زمان خرید</summary><div className="partner-form-grid"><NumberField label="طلای پرداخت‌شده (گرم ۷۵۰)" name="paidGold" value={invoice.paidGold} onChange={updateInvoice}/><NumberField label="مبلغ پرداخت‌شده (تومان)" help="با نرخ همین فاکتور به گرم طلای ۷۵۰ تبدیل و از بدهی کم می‌شود." name="paidToman" value={invoice.paidToman} onChange={updateInvoice}/><TextField label="نام دریافت‌کننده پرداخت" name="referenceName" value={invoice.referenceName} onChange={updateInvoice}/><TextField label="شماره پیگیری پرداخت" name="refNumber" value={invoice.refNumber} onChange={updateInvoice}/></div></details>
        <label className="partner-wide-field">شرح فاکتور<textarea name="note" rows={2} value={invoice.note} maxLength={5000} onChange={event => updateInvoice('note', event.target.value)}/></label>
        <div className="partner-invoice-totals" aria-live="polite"><span>وزن واقعی کل: <b data-partner-physical-weight>{fmt(totals.actualWeight)} گرم</b></span><span>اصل طلا: <b>{fmt(totals.weight750)} گرم ۷۵۰</b></span><span>اجرت درصدی: <b>{fmt(totals.laborGold)} گرم</b></span><span>اجرت ریالی به طلا: <b>{fmt(totals.fixedLaborGold)} گرم</b></span><span>هزینه‌ها به طلا: <b>{fmt(totals.otherCostsGold)} گرم</b></span><span>سود همکار: <b>{fmt(totals.profitGold)} گرم</b></span><strong data-partner-preview-gold-debit>کل طلای ۷۵۰ قابل پرداخت به همکار: {fmt(totals.goldDebit)} گرم</strong><span>پرداخت این خرید: <b>{fmt(totals.goldCredit)} گرم ۷۵۰</b></span>{totals.cashGoldCredit > 0 && <span>معادل پرداخت پولی: <b>{fmt(totals.cashGoldCredit)} گرم</b></span>}<strong data-partner-preview-balance>مانده طلای همکار پس از ثبت: {fmt(statement.goldBalance + totals.goldDebit - totals.goldCredit)} گرم ۷۵۰</strong></div>
        <button type="submit" className="button button-primary" data-partner-invoice-save>{busy ? 'در حال ثبت…' : 'ثبت فاکتور و ورود جنس به صندوق'}</button>
      </fieldset></form> : view === 'settlement' && canEdit ? <form data-partner-settlement-form className="partner-payment-form" onSubmit={event => submit('settlement', selectedId, () => preparePartnerSettlement(settlement), event)}><fieldset disabled={locked}>
        <h3>دریافت و پرداخت</h3><p className="partner-help">پرداخت ما بستانکار حساب همکار است و بدهی ما را کم می‌کند. مقدار طلا را به گرم ۷۵۰ وارد کنید.</p>
        <div className="partner-form-grid"><label>نوع سند<select name="direction" value={settlement.direction} onChange={event => updateSettlement('direction', event.target.value)}><option value="credit">پرداخت ما به همکار · بستانکار</option><option value="debit">دریافت از همکار · بدهکار</option></select></label><label>روش پرداخت<select name="paymentMethod" value={settlement.paymentMethod} onChange={event => updateSettlement('paymentMethod', event.target.value)}><option value="gold">طلا</option><option value="cash">وجه نقد / انتقال وجه</option></select></label><label>تاریخ سند<PersianDateInput name="date" value={settlement.date} required onChange={event => updateSettlement('date', event.target.value)}/></label><NumberField label="مقدار طلای ۷۵۰ (گرم)" name="goldAmount" value={settlement.goldAmount} onChange={updateSettlement}/><NumberField label="مبلغ (تومان)" name="tomanAmount" value={settlement.tomanAmount} onChange={updateSettlement}/><TextField label="نام دریافت‌کننده" name="counterpartyName" value={settlement.counterpartyName} onChange={updateSettlement}/><TextField label="شماره پیگیری پرداخت" name="reference" value={settlement.reference} onChange={updateSettlement}/></div>
        <label className="partner-wide-field">شرح سند<textarea name="note" value={settlement.note} maxLength={5000} rows={2} onChange={event => updateSettlement('note', event.target.value)}/></label><button type="submit" className="button button-primary" data-partner-payment-save>{busy ? 'در حال ثبت…' : 'ثبت سند دریافت / پرداخت'}</button>
      </fieldset></form> : view === 'remittance' ? <PartnerRemittancePlaceholder/> : <PartnerStatement key={selected.id} partner={selected} username={username} documents={documents}/>}
    </> : <div className="partner-empty partner-start"><Coins size={34}/><h2>دفتر همکاران شما آماده است</h2><p>همکار را ثبت کنید، فاکتور خرید را وارد کنید و پرداخت‌های او را در همان پرونده ثبت کنید.</p></div>}</main></div>}
  </div>;
}
