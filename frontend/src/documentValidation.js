import { coinCatalog, currencyCatalog, documentBreakdown } from './assets.js';
import { validateExpense } from './expenses.js';
import { isTradeDocument } from './tradeGoldPrice.js';
import { craftedKinds } from './crmAnalytics.js';
import { profitPercentInput } from './profitDefaults.js';
import { isMiscPurchase } from './miscGold.js';

export function validateDocument(form, category, parseNumber) {
  form = { ...form, profitPercent: profitPercentInput(form.profitPercent, category, form) };
  const errors = {};
  const required = (name, label) => { if (!String(form[name] || '').trim()) errors[name] = `${label} را وارد کنید.`; };
  const numeric = (name, label, allowZero = false, optional = false) => {
    const raw = String(form[name] ?? '').trim();
    if (!raw && optional) return;
    const normalized = raw.replace(/[۰-۹]/g, digit => '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)).replace(/[٠-٩]/g, digit => '٠١٢٣٤٥٦٧٨٩'.indexOf(digit)).replace(/[٬,\s]/g, '').replace(/٫/g, '.');
    const value = parseNumber(raw);
    if (!normalized || !Number.isFinite(Number(normalized)) || (allowZero ? value < 0 : value <= 0)) errors[name] = `${label} باید ${allowZero ? 'صفر یا بیشتر' : 'بیشتر از صفر'} باشد.`;
  };
  const date = new Date(`${form.date}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date || '') || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== form.date) errors.date = 'تاریخ معتبر سند را وارد کنید.';
  if (category === 'expense') {
    return { ...errors, ...validateExpense(form) };
  }
  required('customerName', 'نام طرف حساب');
  required('itemName', 'نام جنس');
  if (isTradeDocument(form)) numeric('gold18Price', 'قیمت طلای ۱۸ عیار هنگام ثبت');
  if (category === 'crafted') {
    if (!craftedKinds.includes(form.craftedKind)) errors.craftedKind = 'نوع کار ساخته را انتخاب کنید.';
    for (const [name, label] of [['itemCount', 'تعداد'], ['weight', 'وزن'], ['gramPrice', 'قیمت هر گرم'], ['ayar', 'عیار']]) numeric(name, label);
    if (isMiscPurchase(form) && !errors.ayar && (parseNumber(form.ayar) < 1 || parseNumber(form.ayar) > 1000)) errors.ayar = 'عیار طلای متفرقه باید بین ۱ و ۱۰۰۰ باشد.';
    numeric('wagePercent', 'اجرت درصدی', true);
  }
  if (category === 'coin') {
    if (!coinCatalog.some(coin => coin.name === form.coinType)) errors.coinType = 'نوع سکه معتبر را انتخاب کنید.';
    numeric('coinCount', 'تعداد سکه');
    if (form.coinType === 'پارسیان') {
      numeric('parsianWeight', 'وزن پارسیان'); numeric('parsianPrice', 'قیمت پارسیان');
    } else numeric('coinPrice', 'قیمت سکه');
  }
  if (category === 'currency') {
    if (!currencyCatalog.some(currency => currency.code === form.currencyType)) errors.currencyType = 'نوع ارز معتبر را انتخاب کنید.';
    numeric('currencyRate', 'قیمت لحظه‌ای ارز');
    numeric('currencyAmount', 'مقدار ارز');
  }
  if (category === 'melted') {
    for (const [name, label] of [['itemCount', 'تعداد قطعه'], ['meltedWeight', 'وزن ترازو'], ['meltedAyar', 'عیار'], ['meltedGramPrice', 'قیمت هر گرم']]) numeric(name, label);
    required('assayCode', 'شماره انگ آبشده'); required('laboratoryName', 'نام آزمایشگاه آبشده');
  }
  for (const [name, label] of [['profitPercent', 'سود درصدی'], ['gramDebt', 'بدهی گرمی'], ['rialDebt', 'بدهی ریالی']]) numeric(name, label, true, true);
  for (const [name, label] of [['wageFixed', 'اجرت ثابت'], ['otherCosts', 'هزینه‌های دیگر']]) numeric(name, label, true, true);
  if (category !== 'crafted') numeric('wagePercent', 'اجرت درصدی', true, true);
  if (String(form.type).endsWith('-sale')) {
    numeric('discountRial', 'تخفیف', true, true);
    numeric('discountPercent', 'تخفیف درصدی', true, true);
    if (!errors.discountPercent && parseNumber(form.discountPercent) > 100) errors.discountPercent = 'تخفیف درصدی باید بین صفر و ۱۰۰ باشد.';
    const beforeDiscount = documentBreakdown({ ...form, category, discountRial: 0, discountPercent: 0 }).total;
    const discount = documentBreakdown({ ...form, category }).discount;
    const tolerance = Math.max(1e-12, beforeDiscount * 2e-15);
    if (!errors.discountRial && !errors.discountPercent && discount - beforeDiscount > tolerance) {
      const message = 'جمع تخفیف‌ها نمی‌تواند بیشتر از مبلغ سند پیش از تخفیف باشد.';
      errors.discountRial = message;
      if (parseNumber(form.discountPercent) > 0) errors.discountPercent = message;
    }
  }
  return errors;
}
