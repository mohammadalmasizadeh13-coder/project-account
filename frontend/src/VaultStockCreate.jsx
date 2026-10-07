import React, { useEffect, useRef, useState } from 'react';
import NumberInput from './NumberInput.jsx';
import { PackagePlus, X } from 'lucide-react';
import { coinCatalog, currencyCatalog } from './assets.js';
import { craftedKinds } from './crmAnalytics.js';
import { stockCategories } from './inventory.js';
import { normalizeDigits } from './persianDate.js';
import { profitPercentInput } from './profitDefaults.js';

const rateValue = value => value == null || value === '' ? '' : String(value);
const initial = prices => ({
  category: 'crafted', itemName: '', craftedKind: 'انگشتر', itemCount: '1', weight: '', ayar: '750',
  gramPrice: rateValue(prices.goldGramPrice), meltedGramPrice: rateValue(prices.goldGramPrice),
  meltedWeight: '', meltedAyar: '750', assayCode: '', laboratoryName: '',
  coinType: 'امامی', coinCount: '1', coinPrice: rateValue(prices.emamiCoinPrice), parsianWeight: '', parsianPrice: '',
  currencyType: 'USD', currencyAmount: '', currencyRate: rateValue(prices.usdPrice),
  wagePercent: '0', wageFixed: '0', otherCosts: '0', profitPercent: '7', description: '', note: '',
});
function parseInput(value) {
  const raw = normalizeDigits(value).trim().replace(/٫/g, '.');
  if (!/^(?:(?:\d+|\d{1,3}(?:[,٬\s]\d{3})+)(?:\.\d*)?|\.\d+)$/.test(raw)) return NaN;
  return Number(raw.replace(/[,٬\s]/g, ''));
}
function categoryFields(draft) {
  if (draft.category === 'crafted') return [
    ['craftedKind', 'نوع کار', 'kind'], ['itemCount', 'تعداد ورودی', 'count'], ['weight', 'وزن هر عدد (گرم)', 'weight'],
    ['ayar', 'عیار', 'purity'], ['gramPrice', 'نرخ هر گرم طلای ۷۵۰ هنگام ورود (تومان)', 'rate'],
  ];
  if (draft.category === 'coin') return [
    ['coinType', 'نوع سکه', 'coin'], ['coinCount', 'تعداد سکه', 'count'],
    ...(draft.coinType === 'پارسیان' ? [['parsianWeight', 'وزن هر سکهٔ پارسیان (گرم)', 'weight'], ['parsianPrice', 'قیمت هر سکهٔ پارسیان هنگام ورود (تومان)', 'rate']] : [['coinPrice', 'قیمت هر سکه هنگام ورود (تومان)', 'rate']]),
  ];
  if (draft.category === 'melted') return [
    ['itemCount', 'تعداد قطعه', 'count'], ['meltedWeight', 'وزن ترازو هر قطعه (گرم)', 'weight'], ['meltedAyar', 'عیار', 'purity'],
    ['meltedGramPrice', 'نرخ هر گرم طلای ۷۵۰ هنگام ورود (تومان)', 'rate'], ['assayCode', 'شماره انگ', 'text'], ['laboratoryName', 'نام آزمایشگاه', 'text'],
  ];
  return [['currencyType', 'نوع ارز', 'currency'], ['currencyAmount', 'مقدار ارز', 'amount'], ['currencyRate', 'نرخ هر واحد ارز هنگام ورود (تومان)', 'rate']];
}

export default function VaultStockCreate({ prices = {}, onCreate, onClose, onCreated }) {
  const dialogRef = useRef(null);
  const running = useRef(false);
  const profitEdited = useRef(false);
  const requestId = useRef(null);
  if (!requestId.current) requestId.current = crypto.randomUUID();
  const [draft, setDraft] = useState(() => initial(prices));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState({});
  const fields = categoryFields(draft);
  const costs = [
    ...(draft.category === 'currency' ? [] : [['wagePercent', 'اجرت درصدی', 'percent'], ['wageFixed', 'اجرت ثابت هر عدد یا قطعه (تومان)', 'money']]),
    ['otherCosts', 'هزینه‌های دیگر هر واحد (تومان)', 'money'], ['profitPercent', 'سود ثبت‌شده (درصد)', 'percent'],
  ];
  useEffect(() => {
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (!dialog.open) dialog.showModal();
    return () => { if (dialog.open) dialog.close(); document.body.style.overflow = previousOverflow; };
  }, []);
  function close() { if (!running.current) onClose(); }
  function update(key, value) {
    if (key === 'profitPercent') profitEdited.current = true;
    setDraft(previous => {
      const next = { ...previous, [key]: value };
      if (key === 'category' && !profitEdited.current) next.profitPercent = profitPercentInput('', value);
      if (key === 'coinType' && value !== 'پارسیان') next.coinPrice = rateValue(prices[coinCatalog.find(coin => coin.name === value)?.price]);
      if (key === 'currencyType') next.currencyRate = rateValue(prices[currencyCatalog.find(currency => currency.code === value)?.price]);
      return next;
    });
    setError(''); setErrors(previous => key === 'category' ? {} : { ...previous, [key]: '' });
  }
  async function submit(event) {
    event.preventDefault();
    if (running.current) return;
    const item = { category: draft.category, itemName: draft.itemName.trim(), description: draft.description.trim(), note: draft.note.trim() };
    const nextErrors = {};
    if (!item.itemName) nextErrors.itemName = 'نام جنس را وارد کنید.';
    for (const [key, label, kind] of [...fields, ...costs]) {
      const raw = key === 'profitPercent' ? profitPercentInput(draft[key], draft.category) : draft[key].trim();
      if (['kind', 'coin', 'currency', 'text'].includes(kind)) {
        if (!raw) nextErrors[key] = `${label} را وارد کنید.`;
        else item[key] = raw;
        continue;
      }
      if (kind === 'rate' && key !== 'parsianPrice' && !raw) continue;
      const zeroAllowed = ['percent', 'money'].includes(kind);
      const value = parseInput(raw || (zeroAllowed ? '0' : ''));
      if (!Number.isFinite(value) || (zeroAllowed ? value < 0 : value <= 0)) nextErrors[key] = `${label} باید عدد معتبر و ${zeroAllowed ? 'صفر یا بیشتر' : 'بیشتر از صفر'} باشد.`;
      else if (kind === 'count' && !Number.isSafeInteger(value)) nextErrors[key] = 'تعداد باید عدد صحیح باشد.';
      else if (['count', 'amount'].includes(kind) && value > 100000000) nextErrors[key] = 'مقدار ورودی بیشتر از محدودهٔ مجاز است.';
      else if (kind === 'weight' && (value < 0.000001 || value > 100000)) nextErrors[key] = 'وزن باید بین ۰٫۰۰۰۰۰۱ تا ۱۰۰٬۰۰۰ گرم باشد.';
      else if (kind === 'purity' && (value < 1 || value > 1000)) nextErrors[key] = 'عیار باید بین ۱ تا ۱۰۰۰ باشد.';
      else if (kind === 'percent' && value > 100) nextErrors[key] = 'درصد باید بین صفر تا ۱۰۰ باشد.';
      else if (value > 1e12) nextErrors[key] = 'مبلغ واردشده بیشتر از محدودهٔ مجاز است.';
      else item[key] = value;
    }
    setErrors(nextErrors);
    const invalid = Object.keys(nextErrors)[0];
    if (invalid) { dialogRef.current.querySelector(`[name="${invalid}"]`)?.focus(); return; }
    running.current = true; setBusy(true); setError('');
    try {
      const createdId = await onCreate(item, requestId.current);
      if (createdId == null || createdId === '') throw new Error('شناسهٔ جنس تازه دریافت نشد؛ پیش از ثبت دوباره، موجودی صندوق را بررسی کنید.');
      onCreated(createdId);
    } catch (failure) { setError(failure?.message || 'جنس ذخیره نشد. دوباره تلاش کنید.'); }
    finally { running.current = false; setBusy(false); }
  }
  function renderField([key, label, kind]) {
    const props = { id: `stock-new-${key}`, name: key, value: draft[key], 'aria-invalid': !!errors[key], 'aria-describedby': errors[key] ? `stock-new-${key}-error` : undefined, onChange: event => update(key, event.target.value) };
    const choices = kind === 'kind' ? craftedKinds.map(value => [value, value]) : kind === 'coin' ? coinCatalog.map(coin => [coin.name, coin.name]) : kind === 'currency' ? currencyCatalog.map(currency => [currency.code, currency.name]) : null;
    return <label key={key} htmlFor={props.id}>{label}{choices
      ? <select {...props}>{choices.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select>
      : kind === 'text' ? <input {...props} type="text" maxLength={200}/> : <NumberInput {...props} maxLength={32}/>}
      {errors[key] && <small className="vault-editor-field-error" id={`stock-new-${key}-error`}>{errors[key]}</small>}
    </label>;
  }
  return <dialog ref={dialogRef} className="vault-editor-dialog vault-stock-create-dialog" dir="rtl" aria-labelledby="stock-new-title" aria-describedby="stock-new-help" onCancel={event => { event.preventDefault(); close(); }}>
    <div className="vault-editor-heading"><h2 id="stock-new-title"><PackagePlus size={21} aria-hidden="true"/>افزودن دستی جنس</h2><button type="button" className="vault-editor-close" aria-label="بستن پنجرهٔ افزودن جنس" disabled={busy} onClick={close}><X size={20} aria-hidden="true"/></button></div>
    <p className="vault-editor-note important" id="stock-new-help">این ثبت، موجودی صندوق را افزایش می‌دهد و بدهی مشتری ایجاد نمی‌کند.</p>
    <form onSubmit={submit} noValidate aria-busy={busy}>
      <fieldset disabled={busy} className="vault-stock-create-fields">
        <div className="vault-editor-grid">
          <label htmlFor="stock-new-category">گروه جنس<select id="stock-new-category" name="category" value={draft.category} onChange={event => update('category', event.target.value)}>{Object.entries(stockCategories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label htmlFor="stock-new-itemName">نام جنس<input id="stock-new-itemName" name="itemName" value={draft.itemName} maxLength={200} required aria-invalid={!!errors.itemName} aria-describedby={errors.itemName ? 'stock-new-itemName-error' : undefined} onChange={event => update('itemName', event.target.value)} autoFocus/>{errors.itemName && <small className="vault-editor-field-error" id="stock-new-itemName-error">{errors.itemName}</small>}</label>
          {fields.map(renderField)}
        </div>
        <p className="vault-editor-note">نرخ ورود از نرخ موجود حسابداری پر می‌شود و قابل اصلاح است. خالی‌گذاشتن نرخ، آخرین نرخ معتبر حسابداری را به کار می‌برد؛ قیمت پارسیان را حتماً وارد کنید. نرخ ورود در سابقهٔ جنس ثبت می‌شود و ارزش روز موجودی از نرخ جاری حسابداری محاسبه می‌شود.</p>
        <fieldset className="vault-editor-spec-fields"><legend>اجرت و هزینه‌ها</legend><div className="vault-editor-grid">{costs.map(renderField)}</div>{draft.category === 'crafted' && <p className="vault-editor-note">سود کار ساخته در حالت پیش‌فرض یا با فیلد خالی ۷٪ است؛ درصد دلخواه یا صفر را هم می‌توانید وارد کنید.</p>}</fieldset>
        <div className="vault-editor-text-fields">
          <label htmlFor="stock-new-description">شرح حسابداری<textarea id="stock-new-description" name="description" rows={2} maxLength={5000} value={draft.description} onChange={event => update('description', event.target.value)}/></label>
          <label htmlFor="stock-new-note">یادداشت داخلی<textarea id="stock-new-note" name="note" rows={2} maxLength={5000} value={draft.note} onChange={event => update('note', event.target.value)}/></label>
        </div>
        <p className="vault-editor-note">شرح و یادداشت داخلی عمومی نمی‌شوند. پس از ثبت، تصویرهای جنس را از همان کارت صندوق اضافه کنید.</p>
      </fieldset>
      {error && <p className="vault-editor-error" role="alert">{error}</p>}
      <div className="vault-editor-actions"><button type="submit" className="button button-primary" data-confirm-stock-create disabled={busy}>{busy ? 'در حال افزودن جنس…' : 'ثبت جنس در صندوق'}</button><button type="button" className="button button-ghost" disabled={busy} onClick={close}>انصراف</button></div>
    </form>
  </dialog>;
}
