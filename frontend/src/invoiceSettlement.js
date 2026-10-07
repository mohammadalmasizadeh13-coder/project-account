import { documentBreakdown } from './assets.js';
import { normalizeDigits } from './persianDate.js';

const parse = value => {
  const raw = normalizeDigits(value ?? '').replace(/[٬,\s]/g, '').replace(/٫/g, '.');
  return raw === '' ? NaN : Number(raw);
};

// Each new sale line is stored in whole tomans, exactly as shown to the customer.
export const settlementRowAmount = row => Math.round(documentBreakdown(row).total);

export function invoiceSettlement(rows, cashInput, rateInput) {
  const errors = {};
  const amounts = rows.map(settlementRowAmount);
  const total = amounts.reduce((sum, value) => sum + value, 0);
  const cashPaid = parse(cashInput);
  const settlementGoldPrice = parse(rateInput);
  if (!rows.length || !amounts.every(value => Number.isSafeInteger(value) && value >= 0) || !Number.isSafeInteger(total)) {
    errors.invoiceRows = 'مبلغ سند بیش از محدودهٔ مجاز است؛ مشخصات ردیف‌ها را بررسی کنید.';
  }
  if (!Number.isSafeInteger(cashPaid) || cashPaid < 0) {
    errors.cashPaid = 'مبلغ پرداخت نقدی را به تومان وارد کنید؛ اگر پرداختی نشده، صفر بنویسید.';
  } else if (cashPaid > total) {
    errors.cashPaid = 'پرداخت نقدی نمی‌تواند بیشتر از مبلغ قابل پرداخت این سند باشد.';
  }
  if (!Number.isFinite(settlementGoldPrice) || settlementGoldPrice <= 0 || settlementGoldPrice > 1e12) {
    errors.gold18Price = 'نرخ معتبر هر گرم طلای ۱۸ عیار را برای تبدیل مانده وارد کنید.';
  }
  const valid = !Object.keys(errors).length;
  const settlementRemainder = valid ? total - cashPaid : null;
  const gramDebt = valid ? Math.round(settlementRemainder / settlementGoldPrice * 1e6) / 1e6 : null;
  if (valid && (!Number.isFinite(gramDebt) || gramDebt > 1e12)) errors.gold18Price = 'نرخ تبدیل با ماندهٔ سند سازگار نیست.';
  return { errors, total, amounts, cashPaid, settlementGoldPrice, settlementRemainder, gramDebt, rialDebt: 0, settlementVersion: 1 };
}
