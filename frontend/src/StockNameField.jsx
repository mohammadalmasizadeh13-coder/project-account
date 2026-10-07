import React, { useEffect, useId, useRef, useState } from 'react';
import { findStockMatches } from './stockSearch.js';
import { stockCategories } from './inventory.js';
import { normalizeDigits } from './persianDate.js';
import './stock-name.css';

const numeric = value => Number(normalizeDigits(value).replaceAll('٫', '.').replace(/[٬,]/g, '')) || 0;
const number = value => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 5 }).format(numeric(value));

export default function StockNameField({ value, items, selectedId, error, onChange, onSelect }) {
  const id = useId();
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const matches = findStockMatches(items, value);
  const expanded = open;
  useEffect(() => { if (selectedId) { setOpen(false); setActive(-1); } }, [selectedId]);
  useEffect(() => { listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [active]);
  const pick = item => { onSelect(item); inputRef.current?.focus(); setOpen(false); setActive(-1); };
  const keyDown = event => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); setOpen(true);
      setActive(current => matches.length ? (current + (event.key === 'ArrowDown' ? 1 : current < 0 ? 0 : -1) + matches.length) % matches.length : -1);
    } else if (event.key === 'Escape' && expanded) { event.preventDefault(); event.stopPropagation(); setOpen(false); setActive(-1); }
    else if (event.key === 'Enter' && expanded) {
      event.preventDefault();
      if (active >= 0 && matches[active]) pick(matches[active]);
    }
  };
  return <div className={`stock-name-field wide ${error ? 'field-error' : ''}`} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setActive(-1); }
  }}>
    <label htmlFor={id}><span className="document-field-label">نام جنس<span className="required-mark" aria-label="الزامی"> *</span></span></label>
    <input ref={inputRef} id={id} name="itemName" value={value} autoComplete="off" role="combobox"
      aria-autocomplete="list" aria-expanded={expanded} aria-controls={expanded ? `${id}-results` : undefined}
      aria-activedescendant={expanded && active >= 0 && matches[active] ? `${id}-option-${active}` : undefined}
      aria-required="true" aria-invalid={error ? true : undefined} aria-describedby={error ? 'document-error-itemName' : `${id}-hint`}
      onFocus={() => { setOpen(true); setActive(-1); }} onKeyDown={keyDown}
      onChange={event => { setActive(-1); setOpen(!onChange(event.target.value)); }}
      placeholder="نام جنس را بنویسید؛ مثلاً مدال"/>
    {error && <small id="document-error-itemName" className="field-error-text">{error}</small>}
    <small id={`${id}-hint`} className="stock-name-hint">با انتخاب پیشنهاد، مشخصات از صندوق پر می‌شود؛ نیازی به واردکردن کد نیست.</small>
    {expanded && <div className="stock-name-dropdown">
      <p role="status">{matches.length ? `${number(matches.length)} پیشنهاد از موجودی صندوق` : 'کالای موجودی با این نام پیدا نشد.'}</p>
      <div ref={listRef} id={`${id}-results`} role="listbox" aria-label="پیشنهادهای نام جنس" data-stock-name-results>
        {matches.map((item, index) => <button key={item.id} type="button" role="option" tabIndex={-1}
          id={`${id}-option-${index}`} aria-selected={active === index} data-stock-name-option={item.id}
          onMouseDown={event => event.preventDefault()} onClick={() => pick(item)}>
          <strong>{item.itemName || item.description || item.typeLabel || stockCategories[item.category]}</strong>
          <span>{item.craftedKind || item.coinType || stockCategories[item.category]}
            {(item.weight || item.meltedWeight || item.parsianWeight) && <> · وزن هر عدد: {number(item.weight || item.meltedWeight || item.parsianWeight)} گرم</>}
            {item.category !== 'currency' && <> · اجرت: {number(item.wagePercent)}٪{numeric(item.wageFixed) > 0 && <> + {number(item.wageFixed)} تومان</>}</>}
          </span>
          <small><bdi dir="ltr">{item.productCode}</bdi><span>موجودی: {number(item.remaining)} {item.category === 'currency' ? item.currencyType : 'عدد / قطعه'}</span></small>
        </button>)}
      </div>
    </div>}
  </div>;
}
