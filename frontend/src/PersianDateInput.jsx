import React, { useEffect, useId, useRef, useState } from 'react';
import { formatPersianDate, formatPersianDateLong, isoToPersian, persianToIso, toPersianDigits } from './persianDate';
import './persian-date.css';

// onChange exposes an ISO date through the same target.name/target.value API as
// a native date input. Incomplete or invalid text emits '' to prevent stale saves.
export default function PersianDateInput({ name, value = '', onChange, required = false, min, max, disabled = false, id, className = '', onBlur, ...props }) {
  const generatedId = useId();
  const inputId = id || `persian-date-${generatedId}`;
  const inputRef = useRef(null);
  const emittedValue = useRef(value);
  const [draft, setDraft] = useState(() => toPersianDigits(isoToPersian(value)));
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (value !== emittedValue.current) {
      setDraft(toPersianDigits(isoToPersian(value)));
      setTouched(false);
    }
    emittedValue.current = value;
  }, [value]);

  function validationMessage(text) {
    if (!text.trim()) return required ? 'تاریخ را وارد کنید.' : '';
    const iso = persianToIso(text);
    if (!iso) return 'تاریخ شمسی معتبر وارد کنید؛ مثلاً ۱۴۰۵/۰۷/۰۲.';
    if (min && iso < min) return `تاریخ باید از ${formatPersianDate(min)} به بعد باشد.`;
    if (max && iso > max) return `تاریخ باید تا ${formatPersianDate(max)} باشد.`;
    return '';
  }

  const error = validationMessage(draft);
  const parsed = persianToIso(draft);
  useEffect(() => { inputRef.current?.setCustomValidity(error); }, [error]);

  function handleChange(event) {
    const nextDraft = event.target.value;
    const nextValue = persianToIso(nextDraft);
    setDraft(nextDraft);
    event.target.setCustomValidity(validationMessage(nextDraft));
    emittedValue.current = nextValue;
    onChange?.({ target: { name, value: nextValue }, currentTarget: { name, value: nextValue } });
  }

  return <span className={`persian-date-control ${className}`}>
    <input
      {...props}
      ref={inputRef}
      id={inputId}
      name={name}
      type="text"
      dir="ltr"
      inputMode="numeric"
      autoComplete="off"
      placeholder="۱۴۰۵/۰۷/۰۲"
      required={required}
      disabled={disabled}
      value={draft}
      aria-invalid={props['aria-invalid'] || (touched && Boolean(error) ? 'true' : undefined)}
      aria-describedby={[props['aria-describedby'], `${inputId}-hint`].filter(Boolean).join(' ')}
      onChange={handleChange}
      onInvalid={() => setTouched(true)}
      onBlur={event => {
        setTouched(true);
        if (parsed) setDraft(toPersianDigits(isoToPersian(parsed)));
        onBlur?.(event);
      }}
    />
    <span id={`${inputId}-hint`} className={touched && error ? 'persian-date-hint persian-date-error' : 'persian-date-hint'} aria-live="polite">
      {touched && error ? error : parsed ? formatPersianDateLong(parsed) : 'شمسی؛ سال/ماه/روز یا ۸ رقم بدون فاصله'}
    </span>
  </span>;
}
