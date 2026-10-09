import React, { useEffect, useRef, useState } from 'react';
import NumberInput from './NumberInput.jsx';
import { Pencil, Trash2, X } from 'lucide-react';
import { currencyCatalog } from './assets.js';
import { craftedKinds } from './crmAnalytics.js';
import { stockCategories } from './inventory.js';
import { normalizeDigits } from './persianDate.js';
import { isMiscPurchase, miscGoldWeight750 } from './miscGold.js';
import CoinFields from './CoinFields.jsx';
import { coinSpec, isModernCoin, isOrdinaryCoin, legacyCoinOptions } from './coins.js';

const fieldsByCategory = {
  crafted: [
    ['craftedKind', 'نوع کار', 'kind'], ['itemCount', 'تعداد ورودی', 'count'], ['weight', 'وزن هر عدد (گرم)', 'weight'],
    ['ayar', 'عیار', 'purity'], ['wagePercent', 'اجرت درصدی', 'percent'], ['wageFixed', 'اجرت ثابت هر عدد (تومان)', 'money'],
  ],
  coin: [['coinType', 'نوع سکه', 'coin'], ['coinCount', 'تعداد ورودی سکه', 'count']],
  melted: [
    ['itemCount', 'تعداد ورودی قطعه', 'count'], ['meltedWeight', 'وزن ترازو هر قطعه (گرم)', 'weight'],
    ['meltedAyar', 'عیار', 'purity'], ['assayCode', 'شماره انگ', 'text'], ['laboratoryName', 'نام آزمایشگاه', 'text'],
    ['wagePercent', 'اجرت درصدی', 'percent'], ['wageFixed', 'اجرت ثابت هر قطعه (تومان)', 'money'],
  ],
  currency: [['currencyType', 'نوع ارز', 'currency'], ['currencyAmount', 'مقدار ورودی ارز', 'amount']],
};
const defaults = { itemCount: '1', coinCount: '1', ayar: '750', meltedAyar: '750', wagePercent: '0', wageFixed: '0' };
const numericValue = value => {
  const normalized = normalizeDigits(value).trim().replace(/٫/g, '.');
  if (!/^(?:(?:\d+|\d{1,3}(?:[,٬\s]\d{3})+)(?:\.\d*)?|\.\d+)$/.test(normalized)) return NaN;
  return Number(normalized.replace(/[,٬\s]/g, ''));
};
const hasSales = item => (item.sales?.length || 0) > 0 || Number(item.sold) > 0;

export default function VaultItemEditor({ item, name, mode, onSave, onDelete, onClose }) {
  const ref = useRef(null);
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState({});
  const [draft, setDraft] = useState(() => Object.fromEntries([
    'itemName', 'description', 'note', ...(fieldsByCategory[item.category] || []).map(([key]) => key), 'parsianWeight',
    'coinPricingVersion', 'coinGroup', 'coinWeight', 'coinAyar', 'coinWeight750',
  ].map(key => [key, String(item[key] ?? defaults[key] ?? '')])));
  const deleting = mode === 'delete';
  const locked = hasSales(item);
  const purchase = item.source !== 'opening-inventory';
  const modernCoin = item.category === 'coin' && isModernCoin(item);
  const fields = [...(fieldsByCategory[item.category] || []).filter(([key]) => !isMiscPurchase(item) || !['wagePercent', 'wageFixed'].includes(key)), ...(modernCoin && isOrdinaryCoin(draft) ? [['coinWeight', 'وزن ترازو هر سکه (گرم)', 'weight'], ['coinAyar', 'عیار اصلی', 'purity']] : item.category === 'coin' && !modernCoin && draft.coinType === 'پارسیان' ? [['parsianWeight', 'وزن هر سکهٔ پارسیان (گرم)', 'weight']] : [])];
  useEffect(() => {
    const dialog = ref.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (!dialog.open) dialog.showModal();
    return () => { if (dialog.open) dialog.close(); document.body.style.overflow = previousOverflow; };
  }, []);
  function close() { if (!running.current) onClose(); }
  function update(key, value) { setDraft(previous => ({ ...previous, [key]: value })); setErrors(previous => ({ ...previous, [key]: '' })); setError(''); }
  function buildChanges() {
    const nextErrors = {};
    const changes = {};
    for (const key of ['itemName', 'description', 'note']) {
      if (draft[key] !== String(item[key] ?? '')) changes[key] = draft[key].trim();
    }
    if (!locked) for (const [key, label, kind] of fields) {
      const raw = draft[key] ?? '';
      const original = String(item[key] ?? defaults[key] ?? '');
      if (raw === original) continue;
      if (['kind', 'coin', 'currency', 'text'].includes(kind)) {
        if (!raw.trim()) nextErrors[key] = `${label} را وارد کنید.`;
        else changes[key] = raw.trim();
        continue;
      }
      const parsed = numericValue(raw);
      const zeroAllowed = ['percent', 'money'].includes(kind);
      if (!Number.isFinite(parsed) || (zeroAllowed ? parsed < 0 : parsed <= 0)) nextErrors[key] = `${label} باید عدد معتبر و ${zeroAllowed ? 'صفر یا بیشتر' : 'بیشتر از صفر'} باشد.`;
      else if (kind === 'count' && !Number.isSafeInteger(parsed)) nextErrors[key] = 'تعداد باید عدد صحیح باشد.';
      else if (kind === 'percent' && parsed > 100) nextErrors[key] = 'اجرت درصدی نباید بیشتر از ۱۰۰ باشد.';
      else if (kind === 'purity' && parsed > 1000) nextErrors[key] = 'عیار نباید بیشتر از ۱۰۰۰ باشد.';
      else changes[key] = parsed;
    }
    // Selecting Parsian must supply its weight even when the previous field was absent.
    if (!locked && item.category === 'coin' && !modernCoin && draft.coinType === 'پارسیان' && item.coinType !== 'پارسیان') {
      const weight = numericValue(draft.parsianWeight);
      if (!Number.isFinite(weight) || weight <= 0) nextErrors.parsianWeight = 'وزن معتبر و بیشتر از صفر برای پارسیان وارد کنید.';
      else changes.parsianWeight = weight;
    }
    if (!locked && modernCoin) {
      if (draft.coinGroup !== item.coinGroup) changes.coinGroup = draft.coinGroup;
      if (['coinType', 'coinGroup', 'coinWeight', 'coinAyar'].some(key => Object.hasOwn(changes, key))) changes.coinWeight750 = coinSpec(draft).weight750;
    }
    setErrors(nextErrors);
    const invalid = Object.keys(nextErrors)[0];
    if (invalid) { ref.current.querySelector(`[name="${invalid}"]`)?.focus(); return null; }
    return changes;
  }
  async function submit(event) {
    event.preventDefault();
    if (running.current) return;
    const changes = deleting ? null : buildChanges();
    if (!deleting && !changes) return;
    if (!deleting && !Object.keys(changes).length) { setError('تغییری در اطلاعات ایجاد نشده است.'); return; }
    running.current = true; setBusy(true); setError('');
    try {
      if (deleting) await onDelete(item.id);
      else await onSave(item.id, changes);
      onClose();
    } catch (failure) { setError(failure?.message || 'ذخیره انجام نشد. دوباره تلاش کنید.'); }
    finally { running.current = false; setBusy(false); }
  }
  function field([key, label, kind]) {
    const props = { id: `vault-edit-${key}`, name: key, value: draft[key] ?? '', onChange: event => update(key, event.target.value), 'aria-invalid': !!errors[key], 'aria-describedby': errors[key] ? `vault-edit-${key}-error` : undefined };
    let control;
    if (['kind', 'coin', 'currency'].includes(kind)) {
      const choices = kind === 'kind' ? craftedKinds.map(value => [value, value]) : kind === 'coin' ? [...legacyCoinOptions, { name: 'پارسیان' }].map(coin => [coin.name, coin.name]) : currencyCatalog.map(currency => [currency.code, currency.name]);
      if (props.value && !choices.some(([value]) => value === props.value)) choices.unshift([props.value, props.value]);
      control = <select {...props}><option value="">انتخاب کنید</option>{choices.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select>;
    } else control = kind === 'text' ? <input {...props} type="text" maxLength={200}/> : <NumberInput {...props} maxLength={32}/>;
    return <label key={key} htmlFor={props.id}>{label}{control}{errors[key] && <small id={`vault-edit-${key}-error`} className="vault-editor-field-error">{errors[key]}</small>}</label>;
  }
  return <dialog ref={ref} className={`vault-editor-dialog ${deleting ? 'is-delete' : ''}`} dir="rtl" aria-labelledby="vault-editor-title" aria-describedby="vault-editor-context" onCancel={event => { event.preventDefault(); close(); }}>
    <div className="vault-editor-heading"><h2 id="vault-editor-title">{deleting ? <Trash2 size={21} aria-hidden="true"/> : <Pencil size={21} aria-hidden="true"/>}{deleting ? 'حذف جنس از صندوق' : 'ویرایش جنس صندوق'}</h2><button type="button" className="vault-editor-close" aria-label="بستن پنجره" disabled={busy} onClick={close}><X size={20} aria-hidden="true"/></button></div>
    <p id="vault-editor-context" className="vault-editor-context"><strong>{name}</strong><span>{stockCategories[item.category]} · <bdi>{item.productCode}</bdi></span></p>
    <form onSubmit={submit} aria-busy={busy}>
      {deleting ? <div className="vault-editor-delete-copy"><p>با تأیید، این ردیف جنس از موجودی صندوق حسابداری حذف می‌شود.</p>{purchase && <p>بدهی ثبت‌شدهٔ همین ردیف خرید از ماندهٔ طرف حساب برگردانده می‌شود؛ سابقهٔ تسویه‌ها محفوظ می‌ماند.</p>}<p>حذف «{name}» با کد <bdi>{item.productCode}</bdi> را تأیید می‌کنید؟</p></div> : <>
        <fieldset disabled={busy} className="vault-editor-text-fields">
          <label htmlFor="vault-edit-itemName">نام جنس<input id="vault-edit-itemName" name="itemName" value={draft.itemName} maxLength={200} onChange={event => update('itemName', event.target.value)}/></label>
          <label htmlFor="vault-edit-description">شرح حسابداری<textarea id="vault-edit-description" name="description" value={draft.description} maxLength={5000} rows={2} onChange={event => update('description', event.target.value)}/></label>
          <label htmlFor="vault-edit-note">یادداشت داخلی<textarea id="vault-edit-note" name="note" value={draft.note} maxLength={5000} rows={2} onChange={event => update('note', event.target.value)}/></label>
        </fieldset>
        <p className="vault-editor-note">شرح و یادداشت در دفتر خصوصی حسابداری شما ذخیره می‌شوند.</p>
        <fieldset disabled={busy || locked} className="vault-editor-spec-fields"><legend>مشخصات و موجودی</legend><div className="vault-editor-grid">{modernCoin ? <CoinFields value={draft} onChange={next => { setDraft(next); setErrors({}); setError(''); }} locked={locked} groupLocked errors={errors} showRate={false}/> : fields.map(field)}</div></fieldset>
        {isMiscPurchase(item) && <p className="vault-editor-note" data-misc-edit-weight750>وزن معادل ۷۵۰ هر عدد: {new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 6 }).format(miscGoldWeight750(draft))} گرم</p>}
        {locked && <p className="vault-editor-note important">این جنس فروش مرتبط دارد؛ فقط نام، شرح و یادداشت قابل ویرایش است. وزن، اجرت، تعداد و سایر مشخصات حفظ می‌شوند.</p>}
        <p className="vault-editor-note">نرخ تاریخی، سود و هزینه‌های ثبت‌شدهٔ سند در این فرم تغییر نمی‌کنند.</p>
        {purchase && <p className="vault-editor-note">بدهی ثبت‌شدهٔ فاکتور با اصلاح مشخصات جنس تغییر نمی‌کند.</p>}
        {item.setId && <p className="vault-editor-note">عضویت این قطعه در مجموعه و مشخصات مشترک مجموعه حفظ می‌شود.</p>}
      </>}
      {error && <p className="vault-editor-error" role="alert">{error}</p>}
      <div className="vault-editor-actions"><button type="submit" className={`button ${deleting ? 'vault-editor-delete' : 'button-primary'}`} disabled={busy} data-confirm-stock-action={mode}>{busy ? 'در حال ذخیره…' : deleting ? 'تأیید حذف این جنس' : 'ذخیرهٔ تغییرات'}</button><button type="button" className="button button-ghost" disabled={busy} onClick={close} autoFocus={deleting}>انصراف</button></div>
    </form>
  </dialog>;
}
