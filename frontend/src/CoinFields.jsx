import React from 'react';
import NumberInput from './NumberInput.jsx';
import { coinOptions, coinSpec, isModernCoin, isOrdinaryCoin, selectCoin } from './coins.js';

const format = value => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 6 }).format(value);

export default function CoinFields({ value, onChange, prices = {}, locked = false, groupLocked = false, errors = {}, showCount = true, showRate = true, rateReadOnly = false }) {
  const modern = isModernCoin(value);
  const ordinary = isOrdinaryCoin(value);
  const definition = coinOptions.find(coin => coin.name === value.coinType);
  const spec = coinSpec(value);
  const change = (key, nextValue) => {
    const next = { ...value, [key]: nextValue };
    if (ordinary) next.coinWeight750 = coinSpec(next).weight750;
    onChange(next);
  };
  const choose = type => onChange({ ...value, ...selectCoin(type, prices) });
  const field = (name, label, fieldValue = value[name], readOnly = false) => <label key={name}>{label}<NumberInput name={name} value={fieldValue ?? ''} required inputMode="decimal" readOnly={readOnly} aria-invalid={!!errors[name]} onChange={event => change(name, event.target.value)}/>{errors[name] && <small className="field-error" role="alert">{errors[name]}</small>}</label>;
  return <>
    {modern ? <>
      <label>گروه سکه<select name="coinGroup" value={ordinary ? 'ordinary' : 'bank'} disabled={locked || groupLocked} onChange={event => choose(coinOptions.find(coin => coin.group === event.target.value).name)}><option value="bank">بانکی</option><option value="ordinary">عادی و وزنی</option></select></label>
      <label>نوع سکه<select name="coinType" value={value.coinType} disabled={locked} aria-invalid={!!errors.coinType} onChange={event => choose(event.target.value)}>{coinOptions.filter(coin => coin.group === (ordinary ? 'ordinary' : 'bank')).map(coin => <option key={coin.name} value={coin.name}>{coin.name}</option>)}</select>{errors.coinType && <small className="field-error" role="alert">{errors.coinType}</small>}</label>
    </> : <label>نوع سکه<input name="coinType" value={value.coinType || ''} readOnly/></label>}
    {showCount && field('coinCount', 'تعداد سکه')}
    {ordinary && <>
      {field('coinWeight', 'وزن ترازو هر سکه (گرم)', definition?.custom ? value.coinWeight : spec.weight, locked || !definition?.custom)}
      {field('coinAyar', 'عیار اصلی سکه', definition?.custom ? value.coinAyar : spec.ayar, locked || !definition?.custom)}
      <label>وزن هر سکه با عیار ۷۵۰ (گرم)<input name="coinWeight750" value={format(spec.weight750)} readOnly data-coin-weight750/><small>وزن ترازو × عیار اصلی ÷ ۷۵۰</small></label>
    </>}
    {!modern && value.coinType === 'پارسیان' && field('parsianWeight', 'وزن ترازو هر سکه پارسیان (گرم)', value.parsianWeight, locked)}
    {showRate && (ordinary ? field('gramPrice', 'نرخ روز هر گرم طلای ۷۵۰ (تومان)', value.gramPrice, rateReadOnly) : !modern && value.coinType === 'پارسیان' ? field('parsianPrice', 'قیمت هر سکه پارسیان (تومان)', value.parsianPrice, rateReadOnly) : field('coinPrice', modern ? 'نرخ تابلو هر سکه بانکی (تومان)' : 'قیمت هر سکه (تومان)', value.coinPrice, rateReadOnly))}
    {ordinary && <p className="coin-calculation-help" style={{ gridColumn: '1 / -1' }} data-coin-price-rule>قیمت پایهٔ هر سکه = {format(spec.weight750)} گرم عیار ۷۵۰ × نرخ روز. سود درصدی و سود ثابت به مبلغ اضافه می‌شوند.</p>}
  </>;
}
