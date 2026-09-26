import { currencyCatalog, currencyName } from './assets.js';
import { normalizeDigits } from './persianDate.js';

export const expenseUnits = [
  { value: 'toman', label: 'تومان' },
  { value: 'rial', label: 'ریال' },
  { value: 'gold', label: 'گرم طلا' },
  { value: 'currency', label: 'ارز' },
];

const displayNumber = value => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 8 }).format(value);
const expenseNumber = value => {
  const normalized = normalizeDigits(value).replace(/[٬,\s]/g, '').replace(/٫/g, '.');
  return normalized && Number.isFinite(Number(normalized)) ? Number(normalized) : NaN;
};

function readExpense(form) {
  const expenseUnit = form.expenseUnit ?? 'toman';
  const expenseAmount = expenseNumber(form.expenseAmount);
  const expenseCurrency = expenseUnit === 'currency' ? (form.expenseCurrency ?? 'USD') : null;
  const expenseGoldPurity = expenseUnit === 'gold' ? expenseNumber(form.expenseGoldPurity ?? 750) : null;
  const expenseRate = expenseUnit === 'gold' || expenseUnit === 'currency' ? expenseNumber(form.expenseRate) : null;
  let amount = expenseAmount;
  if (expenseUnit === 'rial') amount /= 10;
  if (expenseUnit === 'gold') amount *= expenseGoldPurity / 750 * expenseRate;
  if (expenseUnit === 'currency') amount *= expenseRate;
  return { expenseUnit, expenseAmount, expenseCurrency, expenseGoldPurity, expenseRate, amount };
}

function valueErrors(value) {
  const errors = {};
  if (!expenseUnits.some(unit => unit.value === value.expenseUnit)) errors.expenseUnit = 'واحد معتبر هزینه را انتخاب کنید.';
  if (!Number.isFinite(value.expenseAmount) || value.expenseAmount <= 0) errors.expenseAmount = 'مقدار هزینه باید بیشتر از صفر باشد.';
  if (value.expenseUnit === 'currency' && !currencyCatalog.some(currency => currency.code === value.expenseCurrency)) errors.expenseCurrency = 'نوع ارز معتبر را انتخاب کنید.';
  if (value.expenseUnit === 'gold' && (!Number.isFinite(value.expenseGoldPurity) || value.expenseGoldPurity <= 0 || value.expenseGoldPurity > 1000)) errors.expenseGoldPurity = 'عیار طلا باید بیشتر از صفر و حداکثر ۱۰۰۰ باشد.';
  if ((value.expenseUnit === 'gold' || value.expenseUnit === 'currency') && (!Number.isFinite(value.expenseRate) || value.expenseRate <= 0)) errors.expenseRate = 'نرخ تبدیل به تومان باید بیشتر از صفر باشد.';
  if (!Object.keys(errors).length && (!Number.isFinite(value.amount) || value.amount <= 0)) errors.expenseAmount = 'معادل تومانی هزینه باید عدد معتبر و بیشتر از صفر باشد.';
  return errors;
}

export function validateExpense(form) {
  const errors = valueErrors(readExpense(form));
  if (!String(form.description ?? '').trim()) errors.description = 'شرح هزینه را وارد کنید.';
  return errors;
}

/** Draft preview only. Saved reports must use the recorded amount, never current market rates. */
export function expenseValue(form) {
  const value = readExpense(form);
  return Object.keys(valueErrors(value)).length ? NaN : value.amount;
}

/** Capture original units and the conversion used when the expense is saved. */
export function normalizeExpense(form) {
  const value = readExpense(form);
  if (Object.keys(valueErrors(value)).length) throw new TypeError('اطلاعات مبلغ هزینه معتبر نیست.');
  return value;
}

export function expenseUnitLabel(record) {
  const unit = record.expenseUnit ?? 'toman';
  return unit === 'currency' ? currencyName(record.expenseCurrency ?? 'USD') : (expenseUnits.find(item => item.value === unit)?.label ?? '');
}

/** Older expenses have only a toman amount; do not reinterpret or migrate them. */
export function expenseSummary(record) {
  const quantity = expenseNumber(record.expenseUnit ? record.expenseAmount : (record.amount ?? record.expenseAmount));
  if (!Number.isFinite(quantity)) return '—';
  const purity = record.expenseUnit === 'gold' ? ` با عیار ${displayNumber(expenseNumber(record.expenseGoldPurity ?? 750))}` : '';
  return `${displayNumber(quantity)} ${expenseUnitLabel(record)}${purity}`;
}

export function expenseRateSummary(record) {
  if (record.expenseUnit !== 'gold' && record.expenseUnit !== 'currency') return '';
  const rate = expenseNumber(record.expenseRate);
  if (!Number.isFinite(rate) || rate <= 0) return '';
  const unit = record.expenseUnit === 'gold' ? 'گرم طلای ۷۵۰' : `واحد ${expenseUnitLabel(record)}`;
  return `هر ${unit}: ${displayNumber(rate)} تومان`;
}
