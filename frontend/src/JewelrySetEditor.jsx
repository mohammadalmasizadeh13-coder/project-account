import React, { useId } from 'react';
import NumberInput from './NumberInput.jsx';
import { Plus, Trash2 } from 'lucide-react';
import { documentBreakdown, number } from './assets.js';
import { craftedKinds } from './crmAnalytics.js';
import { createSetPart } from './jewelrySets.js';
import { profitPercentInput } from './profitDefaults.js';
import './jewelrySets.css';

const partKinds = craftedKinds.filter(kind => !['نیم‌ست', 'ست', 'سرویس'].includes(kind));
const formatNumber = value => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 3 }).format(number(value));
const formatMoney = value => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(number(value));

export function SetModePicker({ kind, value = 'together', onChange }) {
  const id = useId();
  return <div className="jewelry-set-mode">
    <label htmlFor={`${id}-mode`}>روش ثبت {kind}</label>
    <select id={`${id}-mode`} name="setMode" value={value || 'together'} onChange={event => onChange(event.target.value)} aria-describedby={`${id}-hint`}>
      <option value="together">{kind} با هم</option>
      <option value="separate">{kind} جدا</option>
    </select>
    <p id={`${id}-hint`}>{value === 'separate'
      ? 'قطعه‌ها را با نوع، وزن و اجرت دلخواه اضافه کنید. هر قطعه موجودی مستقل دارد و می‌توانید یک یا چند قطعه را با هم بفروشید.'
      : 'کل مجموعه به‌عنوان یک کار با یک وزن و اجرت ثبت و فروخته می‌شود.'}</p>
  </div>;
}

function PartField({ id, part, field, label, error, required = false, children }) {
  const fieldId = `${id}-${part.id}-${field}`;
  return <label className={`jewelry-set-field${error ? ' jewelry-set-field-error' : ''}`} htmlFor={fieldId}>
    <span>{label}{required && <span className="jewelry-set-required" aria-hidden="true"> *</span>}</span>
    {React.cloneElement(children, {
      id: fieldId,
      name: `setParts.${part.id}.${field}`,
      'data-part-field': field,
      'aria-required': required || undefined,
      'aria-invalid': error ? true : undefined,
      'aria-describedby': error ? `${fieldId}-error` : undefined,
    })}
    {error && <small id={`${fieldId}-error`} className="jewelry-set-error">{error}</small>}
  </label>;
}

export default function JewelrySetEditor({ parts = [], onChange, errors = {}, sale = false, prices, documents = [] }) {
  const id = useId();
  const activeParts = sale ? parts.filter(part => part.selected !== false) : parts;
  const breakdown = part => documentBreakdown({ ...part, profitPercent: profitPercentInput(part.profitPercent, 'crafted'), gramPrice: String(part.gramPrice ?? '').trim() ? part.gramPrice : prices?.goldGramPrice || '', category: 'crafted', type: sale ? 'crafted-sale' : 'crafted-purchase' });
  const total = activeParts.reduce((sum, part) => sum + breakdown(part).total, 0);
  const changePart = (partId, field, value) => onChange(parts.map(part => part.id === partId ? { ...part, [field]: value } : part));
  const addPart = () => onChange([...parts, createSetPart({ gramPrice: prices?.goldGramPrice || parts[0]?.gramPrice || '' })]);

  return <section className="jewelry-set-editor" aria-labelledby={`${id}-heading`}>
    <div className="jewelry-set-heading">
      <div>
        <h3 id={`${id}-heading`}>{sale ? 'انتخاب قطعه‌های مجموعه برای فروش' : 'قطعه‌های این مجموعه'}</h3>
        <p>{sale ? 'قطعه‌های موردنظر را انتخاب کنید و قیمت و اجرت فروش هر کدام را وارد کنید.' : 'نوع و تعداد قطعه‌ها را خودتان انتخاب کنید؛ وزن و اجرت هر قطعه جدا ثبت می‌شود.'}</p>
        {sale && <p>تخفیف درصدی از کل مبلغ هر ردیف، شامل اجرت، هزینه‌ها و سود محاسبه می‌شود و تخفیف ریالی هم علاوه بر آن کسر می‌شود.</p>}
        {number(prices?.goldGramPrice) > 0 && <p>قیمت خالی هر گرم با نرخ {formatMoney(prices.goldGramPrice)} تومان محاسبه می‌شود.</p>}
      </div>
      <span className="jewelry-set-count">{formatNumber(sale ? activeParts.length : parts.length)} {sale ? 'قطعه انتخاب‌شده' : 'ردیف قطعه'}</span>
    </div>

    {sale && parts.length > 0 && <div className="jewelry-set-actions">
      <button type="button" className="jewelry-set-button" onClick={() => onChange(parts.map(part => ({ ...part, selected: true })))}>انتخاب همه قطعه‌ها</button>
      <button type="button" className="jewelry-set-button" onClick={() => onChange(parts.map(part => ({ ...part, selected: false })))}>لغو انتخاب همه</button>
    </div>}

    {errors.setParts && <p className="jewelry-set-error jewelry-set-group-error" role="alert">{errors.setParts}</p>}
    {!parts.length && <p className="jewelry-set-empty">{sale ? 'قطعه‌ای از این مجموعه برای فروش موجود نیست.' : 'برای شروع، قطعه‌های دلخواه این مجموعه را اضافه کنید.'}</p>}

    <div className="jewelry-set-parts">
      {parts.map((part, index) => {
        const selected = !sale || part.selected !== false;
        const source = sale ? documents.find(document => document.id === part.inventorySourceId) : null;
        const amount = breakdown(part);
        const title = part.itemName || part.craftedKind || `قطعه ${formatNumber(index + 1)}`;
        const errorFor = field => errors[`setParts.${part.id}.${field}`];
        const field = (name, label, options = {}) => <PartField key={name} id={id} part={part} field={name} label={label} error={errorFor(name)} required={options.required}>
          <NumberInput inputMode={options.inputMode || 'decimal'} value={part[name] ?? ''} placeholder={options.placeholder ?? '۰'} readOnly={sale && Boolean(options.identity)} disabled={!selected} onChange={event => changePart(part.id, name, event.target.value)}/>
        </PartField>;

        return <fieldset key={part.id} data-set-part={part.id} className={`jewelry-set-part${selected ? '' : ' jewelry-set-part-unselected'}`}>
          <legend>قطعه {formatNumber(index + 1)}</legend>
          <div className="jewelry-set-part-heading">
            {sale ? <label className="jewelry-set-select-part">
              <input type="checkbox" data-part-field="selected" checked={selected} onChange={event => changePart(part.id, 'selected', event.target.checked)}/>
              <span>فروش {title}</span>
            </label> : <strong>{title}</strong>}
            {!sale && <button type="button" className="jewelry-set-button jewelry-set-remove" data-remove-set-part={part.id} aria-label={`حذف قطعه ${formatNumber(index + 1)}: ${title}`} onClick={() => onChange(parts.filter(item => item.id !== part.id))}><Trash2 size={15} aria-hidden="true"/>حذف قطعه</button>}
          </div>

          {sale && <p className="jewelry-set-stock-info">{part.productCode && <span>کد کالا: <bdi>{part.productCode}</bdi></span>}{part.remaining != null && <span>موجودی: {formatNumber(part.remaining)} عدد</span>}</p>}

          <div className="jewelry-set-fields">
            <PartField id={id} part={part} field="craftedKind" label="نوع قطعه" error={errorFor('craftedKind')} required>
              <select value={part.craftedKind || ''} disabled={!selected || (sale && partKinds.includes(source?.craftedKind))} onChange={event => changePart(part.id, 'craftedKind', event.target.value)}>
                <option value="">انتخاب نوع قطعه</option>
                {partKinds.map(kind => <option key={kind} value={kind}>{kind}</option>)}
              </select>
            </PartField>
            <PartField id={id} part={part} field="itemName" label="نام یا مدل قطعه" error={errorFor('itemName')} required>
              <input value={part.itemName || ''} readOnly={sale && Boolean(String(source?.itemName || '').trim())} disabled={!selected} placeholder="نام یا مدل قطعه را وارد کنید" onChange={event => changePart(part.id, 'itemName', event.target.value)}/>
            </PartField>
            {field('itemCount', sale ? 'تعداد فروش' : 'تعداد این قطعه', { required: true, inputMode: 'numeric', placeholder: '۱' })}
            {field('weight', 'وزن هر عدد (گرم)', { required: true, identity: true, placeholder: 'مثلاً ۵٫۲' })}
            {field('ayar', 'عیار', { required: true, identity: true, inputMode: 'numeric', placeholder: '۷۵۰' })}
            {field('gramPrice', 'قیمت هر گرم طلای ۷۵۰ (تومان)', { required: true, inputMode: 'numeric', placeholder: number(prices?.goldGramPrice) > 0 ? formatMoney(prices.goldGramPrice) : 'قیمت هر گرم' })}
            {field('wagePercent', 'اجرت درصدی', { required: true })}
            {field('wageFixed', 'اجرت ثابت هر عدد (تومان)', { inputMode: 'numeric' })}
            {field('otherCosts', 'هزینه‌های دیگر هر عدد (تومان)', { inputMode: 'numeric' })}
            {field('profitPercent', sale ? 'درصد سود فروشنده' : 'سود درصدی', { placeholder: 'خالی = ۷٪' })}
            {sale && field('discountRial', 'تخفیف این ردیف (تومان)', { inputMode: 'numeric' })}
            {sale && field('discountPercent', 'تخفیف درصدی (%)', { placeholder: '۰ تا ۱۰۰' })}
          </div>

          <div className="jewelry-set-part-total">
            <span>مبلغ {sale ? 'فروش' : 'ثبت'} این ردیف <strong>{formatMoney(amount.total)} <small>تومان</small></strong></span>
            <span>اجرت این ردیف: {formatMoney(amount.wage)} تومان{!selected && ' · انتخاب نشده'}</span>
            {sale && amount.discount > 0 && <span>تخفیف این ردیف: {formatMoney(amount.discount)} تومان</span>}
          </div>
        </fieldset>;
      })}
    </div>

    <div className="jewelry-set-footer">
      {!sale && <button type="button" className="jewelry-set-button jewelry-set-add" data-add-set-part onClick={addPart}><Plus size={17} aria-hidden="true"/>افزودن قطعه</button>}
      <p aria-live="polite">{sale ? 'جمع قطعه‌های انتخاب‌شده' : 'جمع مبلغ قطعه‌ها'}: <strong>{formatMoney(total)}</strong> تومان</p>
    </div>
  </section>;
}
