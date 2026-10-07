import { coinCatalog, currencyCatalog } from './assets.js';
import { normalizeDigits } from './persianDate.js';
import { iranDate } from './sales.js';

export const partnerTradeTypes = { wholesaler: 'بنکدار و عمده‌فروش', melted: 'آبشده‌فروش', jeweler: 'طلافروش و کارگاه', other: 'سایر همکاران' };
export const partnerStockTypes = { crafted: 'طلای ساخته', melted: 'طلای آبشده', coin: 'سکه', currency: 'ارز' };
export const roundPartnerAmount = value => (Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 1e6) / 1e6) || 0;
export const formatPartnerAmount = (value, digits = 6) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: digits }).format(Number(value) || 0);

export function parsePartnerNumber(value) {
  const raw = normalizeDigits(value).trim().replace(/٫/g, '.');
  if (!/^[+-]?(?:(?:\d+|\d{1,3}(?:[,٬\s]\d{3})+)(?:\.\d*)?|\.\d+)$/.test(raw)) return NaN;
  const parsed = Number(raw.replace(/[,٬\s]/g, ''));
  return Number.isFinite(parsed) && Math.abs(parsed) <= Number.MAX_SAFE_INTEGER ? parsed : NaN;
}
const savedNumber = value => { const number = parsePartnerNumber(value); return Number.isFinite(number) ? number : 0; };
const text = value => String(value ?? '').trim();
function numeric(value, label, { optional = false, positive = false, max = 1e12, integer = false } = {}) {
  if (optional && !text(value)) return 0;
  const result = parsePartnerNumber(value);
  if (!Number.isFinite(result) || result < 0 || (positive && result <= 0) || result > max || (integer && !Number.isSafeInteger(result))) {
    throw new Error(`${label} را به صورت عدد معتبر ${positive ? 'بیشتر از صفر' : 'صفر یا بیشتر'}${integer ? ' و صحیح' : ''} وارد کنید.`);
  }
  return result;
}
function validDate(date) {
  const parsed = new Date(`${date}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error('تاریخ معتبر سند را وارد کنید.');
  return date;
}

export function newPartnerProfile(partner) {
  return { name: '', tradeType: 'wholesaler', phone: '', address: '', note: '',
    openingGoldBalance: '', openingTomanBalance: '', openingGoldDirection: 'debit', openingTomanDirection: 'debit',
    ...(partner ? { name: partner.name, tradeType: partner.tradeType, phone: partner.phone || '', address: partner.address || '', note: partner.note || '',
      openingGoldBalance: String(Math.abs(savedNumber(partner.openingGoldBalance))), openingTomanBalance: String(Math.abs(savedNumber(partner.openingTomanBalance))),
      openingGoldDirection: savedNumber(partner.openingGoldBalance) < 0 ? 'credit' : 'debit', openingTomanDirection: savedNumber(partner.openingTomanBalance) < 0 ? 'credit' : 'debit' } : {}),
  };
}
export function preparePartnerProfile(form, allowOpening = true) {
  if (!text(form.name)) throw new Error('نام همکار را وارد کنید.');
  if (!partnerTradeTypes[form.tradeType]) throw new Error('گروه همکار را انتخاب کنید.');
  const phone = normalizeDigits(form.phone).replace(/[\s()\-]/g, '');
  if (phone && !/^\+?\d{7,15}$/.test(phone)) throw new Error('شماره تماس معتبر وارد کنید.');
  const profile = { name: text(form.name), tradeType: form.tradeType, phone, address: text(form.address), note: text(form.note) };
  if (allowOpening) for (const unit of ['Gold', 'Toman']) {
    const amount = numeric(form[`opening${unit}Balance`], 'مانده اولیه', { optional: true });
    if (!['debit', 'credit'].includes(form[`opening${unit}Direction`])) throw new Error('نوع مانده اولیه را انتخاب کنید.');
    profile[`opening${unit}Balance`] = roundPartnerAmount(amount * (form[`opening${unit}Direction`] === 'credit' ? -1 : 1));
  }
  return profile;
}

export function newPartnerLine(prices = {}, category = 'crafted') {
  return { category, itemName: '', craftedKind: 'سایر', weightMode: 'total', itemCount: '1', weight: '', ayar: '750',
    gramPrice: String(prices.goldGramPrice || ''), wagePercent: '0', wageFixed: '', otherCosts: '', profitPercent: category === 'crafted' ? '7' : '0',
    meltedWeight: '', meltedAyar: '750', meltedGramPrice: String(prices.goldGramPrice || ''), assayCode: '', laboratoryName: '',
    coinType: 'امامی بانکی ۸۶', coinCount: '1', coinPrice: String(prices.bankEmami86Price || ''), parsianWeight: '', parsianPrice: '',
    currencyType: 'USD', currencyAmount: '', currencyRate: String(prices.usdPrice || ''),
  };
}
export const newPartnerInvoice = (prices = {}, category = 'crafted') => ({ date: iranDate(), externalInvoiceNumber: '', note: '', calculationVersion: 2,
  gold18Price: String(prices.goldGramPrice || ''), settlementUnit: 'gold', lines: [newPartnerLine(prices, category)],
  paidGold: '', paidToman: '', referenceName: '', refNumber: '',
});
export const newPartnerSettlement = () => ({ date: iranDate(), direction: 'credit', goldAmount: '', tomanAmount: '',
  paymentMethod: 'gold', counterpartyName: '', reference: '', note: '',
});

export function upgradePartnerInvoiceDraft(invoice) {
  if (!invoice || invoice.calculationVersion === 2) return invoice;
  return { ...invoice, calculationVersion: 2, settlementUnit: 'gold',
    lines: (invoice.lines || []).map(line => ({ ...line, wageFixed: line.wageFixed ?? '',
      profitPercent: line.profitPercent ?? (line.category === 'crafted' ? '7' : '0') })) };
}

export function preparePartnerLine(form, rate, calculationVersion = 2) {
  const category = form.category;
  if (!partnerStockTypes[category]) throw new Error('نوع کالای ردیف را انتخاب کنید.');
  if (!text(form.itemName)) throw new Error('نام جنس هر ردیف را وارد کنید.');
  const line = { category, itemName: text(form.itemName), otherCosts: numeric(form.otherCosts, 'هزینه‌های دیگر', { optional: true }) };
  if (calculationVersion === 2) line.profitPercent = numeric(form.profitPercent, 'سود همکار', { optional: true, max: 100 });
  if (['crafted', 'melted'].includes(category)) {
    const weightKey = category === 'crafted' ? 'weight' : 'meltedWeight';
    const purityKey = category === 'crafted' ? 'ayar' : 'meltedAyar';
    const priceKey = category === 'crafted' ? 'gramPrice' : 'meltedGramPrice';
    line.itemCount = numeric(form.itemCount, 'تعداد ردیف', { positive: true, integer: true, max: 1e8 });
    if (!['total', 'unit'].includes(form.weightMode)) throw new Error('روش ورود وزن را انتخاب کنید.');
    line.weightMode = form.weightMode;
    line[weightKey] = numeric(form[weightKey], 'وزن واقعی', { positive: true, max: 1e5 });
    line[purityKey] = numeric(form[purityKey], 'عیار واقعی', { positive: true, max: 1000 });
    if (line[purityKey] < 1) throw new Error('عیار باید بین ۱ و ۱۰۰۰ باشد.');
    line[priceKey] = calculationVersion === 2 ? rate : text(form[priceKey]) ? numeric(form[priceKey], 'نرخ هر گرم ۷۵۰', { positive: true }) : rate;
    line.wagePercent = numeric(form.wagePercent, 'اجرت درصدی', { optional: true, max: 100 });
    line.wageFixed = calculationVersion === 2 ? numeric(form.wageFixed, 'اجرت پولی هر عدد (تومان)', { optional: true }) : 0;
    if (category === 'crafted') line.craftedKind = form.craftedKind || 'سایر';
    else {
      if (!text(form.assayCode) || !text(form.laboratoryName)) throw new Error('شماره انگ و آزمایشگاه طلای آبشده را وارد کنید.');
      line.assayCode = text(form.assayCode); line.laboratoryName = text(form.laboratoryName);
    }
  } else if (category === 'coin') {
    if (!coinCatalog.some(coin => coin.name === form.coinType)) throw new Error('نوع سکه معتبر را انتخاب کنید.');
    line.coinType = form.coinType;
    line.coinCount = numeric(form.coinCount, 'تعداد سکه', { positive: true, integer: true, max: 1e8 });
    if (form.coinType === 'پارسیان') {
      line.parsianWeight = numeric(form.parsianWeight, 'وزن هر سکه پارسیان', { positive: true, max: 1e5 });
      line.parsianPrice = numeric(form.parsianPrice, 'قیمت هر سکه پارسیان', { positive: true });
    } else line.coinPrice = numeric(form.coinPrice, 'قیمت هر سکه', { positive: true });
  } else {
    if (!currencyCatalog.some(currency => currency.code === form.currencyType)) throw new Error('نوع ارز معتبر را انتخاب کنید.');
    line.currencyType = form.currencyType;
    line.currencyAmount = numeric(form.currencyAmount, 'مقدار ارز', { positive: true, max: 1e8 });
    line.currencyRate = numeric(form.currencyRate, 'نرخ هر واحد ارز', { positive: true });
  }
  return line;
}

// Each metal row carries its physical weight separately from principal and labor.
// Sum full-precision row values before rounding the final ledger totals.
export function partnerLineTotals(line, goldPrice = 0, calculationVersion = 1) {
  const metal = ['crafted', 'melted'].includes(line.category);
  const count = savedNumber(line.category === 'currency' ? line.currencyAmount : line.category === 'coin' ? line.coinCount : line.itemCount) || (line.category === 'currency' ? 0 : 1);
  const conversionGoldPrice = savedNumber(goldPrice);
  const convert = amount => conversionGoldPrice > 0 ? amount / conversionGoldPrice : 0;
  const profitPercent = calculationVersion === 2 ? savedNumber(line.profitPercent) : 0;
  const otherCostsGold = calculationVersion === 2 ? convert(count * savedNumber(line.otherCosts)) : 0;
  if (metal) {
    const weight = savedNumber(line.category === 'crafted' ? line.weight : line.meltedWeight);
    const purity = savedNumber(line.category === 'crafted' ? line.ayar : line.meltedAyar);
    const actualWeight = weight * (line.weightMode === 'unit' ? count : 1);
    const weight750 = actualWeight * purity / 750;
    const laborGold = weight750 * savedNumber(line.wagePercent) / 100;
    const fixedLaborGold = calculationVersion === 2 ? convert(count * savedNumber(line.wageFixed)) : 0;
    const baseGold = weight750 + laborGold + fixedLaborGold + otherCostsGold;
    const profitGold = baseGold * profitPercent / 100;
    return { actualWeight, purity, weight750, laborGold, fixedLaborGold, otherCostsGold, profitGold, profitPercent, conversionGoldPrice,
      goldDebit: baseGold + profitGold,
      tomanDebit: calculationVersion === 2 ? 0 : count * (savedNumber(line.otherCosts) + savedNumber(line.wageFixed)),
      rate: calculationVersion === 2 ? conversionGoldPrice : savedNumber(line.category === 'crafted' ? line.gramPrice : line.meltedGramPrice) || savedNumber(goldPrice), count };
  }
  const price = line.category === 'coin' ? (line.coinType === 'پارسیان' ? line.parsianPrice : line.coinPrice) : line.currencyRate;
  const principalGold = calculationVersion === 2 ? convert(count * savedNumber(price)) : 0;
  const profitGold = (principalGold + otherCostsGold) * profitPercent / 100;
  return { actualWeight: line.category === 'coin' && line.coinType === 'پارسیان' ? count * savedNumber(line.parsianWeight) : 0,
    purity: null, weight750: 0, laborGold: 0, fixedLaborGold: 0, otherCostsGold, profitGold, profitPercent, conversionGoldPrice, principalGold,
    goldDebit: principalGold + otherCostsGold + profitGold,
    tomanDebit: calculationVersion === 2 ? 0 : count * (savedNumber(price) + savedNumber(line.otherCosts)), rate: savedNumber(price), count };
}

// Invoice details contain authoritative totals, while linked inventory documents
// store physical weights per unit. Never treat a stock's per-unit weight750 as
// the invoice row's total or overwrite a recorded zero debit with a new formula.
export function savedPartnerLineTotals(line, document = {}, entry = {}) {
  const firstNumber = (...values) => values.map(parsePartnerNumber).find(Number.isFinite);
  const record = { ...document, ...line };
  const metal = ['crafted', 'melted'].includes(record.category);
  const weightKey = record.category === 'crafted' ? 'weight' : 'meltedWeight';
  const purityKey = record.category === 'crafted' ? 'ayar' : 'meltedAyar';
  const hasOriginalWeight = Number.isFinite(parsePartnerNumber(line[weightKey]));
  if (metal) {
    record.weightMode = hasOriginalWeight ? line.weightMode || 'total' : 'unit';
    record[purityKey] = firstNumber(line[purityKey], document[purityKey], 750);
  }
  const calculationVersion = entry.calculationVersion === 2 ? 2 : 1;
  const fallback = partnerLineTotals(record, entry.gold18Price, calculationVersion);
  const actualWeight = metal ? firstNumber(line.scaleWeight, document.scaleWeight, fallback.actualWeight) : fallback.actualWeight;
  const weight750 = metal ? firstNumber(line.weight750, document.totalWeight750, fallback.weight750) : 0;
  const wagePercent = firstNumber(line.wagePercent, document.wagePercent, 0);
  const laborGold = metal ? firstNumber(line.laborGold, document.laborGold, weight750 * wagePercent / 100) : 0;
  const goldDebit = firstNumber(line.goldDebit, entry.settlementUnit !== 'toman' ? document.partnerGoldDebit : undefined,
    calculationVersion === 2 ? roundPartnerAmount(fallback.goldDebit) : metal && entry.settlementUnit !== 'toman' ? roundPartnerAmount(weight750 + laborGold) : 0);
  const fiatFallback = calculationVersion === 2 ? 0 : !metal || entry.settlementUnit === 'toman'
    ? firstNumber(document.amount, fallback.tomanDebit + (metal ? (weight750 + laborGold) * fallback.rate : 0))
    : fallback.tomanDebit;
  const tomanDebit = firstNumber(line.tomanDebit, fiatFallback, 0);
  return { ...fallback, actualWeight, weight750, laborGold, goldDebit, tomanDebit, wagePercent,
    fixedLaborGold: firstNumber(line.fixedLaborGold, document.fixedLaborGold, fallback.fixedLaborGold, 0),
    otherCostsGold: firstNumber(line.otherCostsGold, document.otherCostsGold, fallback.otherCostsGold, 0),
    profitGold: firstNumber(line.profitGold, document.profitGold, fallback.profitGold, 0),
    profitPercent: firstNumber(line.profitPercent, document.profitPercent, fallback.profitPercent, 0),
    conversionGoldPrice: firstNumber(line.conversionGoldPrice, entry.gold18Price, 0),
    itemName: line.itemName || document.itemName || 'نام جنس ثبت نشده', category: record.category,
    productCode: line.productCode || document.productCode || '',
  };
}
export function partnerInvoiceTotals(form) {
  const calculationVersion = form.calculationVersion === 2 ? 2 : 1;
  const lines = (form.lines || []).map(line => partnerLineTotals(line, form.gold18Price, calculationVersion));
  const totals = lines.reduce((sum, row) => ({ actualWeight: sum.actualWeight + row.actualWeight,
    weight750: sum.weight750 + row.weight750, laborGold: sum.laborGold + row.laborGold,
    fixedLaborGold: sum.fixedLaborGold + row.fixedLaborGold, otherCostsGold: sum.otherCostsGold + row.otherCostsGold,
    profitGold: sum.profitGold + row.profitGold, principalGold: sum.principalGold + (row.principalGold || 0),
    goldDebit: sum.goldDebit + (form.settlementUnit === 'toman' ? 0 : row.goldDebit),
    tomanDebit: sum.tomanDebit + row.tomanDebit + (form.settlementUnit === 'toman' ? row.goldDebit * row.rate : 0),
  }), { actualWeight: 0, weight750: 0, laborGold: 0, fixedLaborGold: 0, otherCostsGold: 0, profitGold: 0, principalGold: 0, goldDebit: 0, tomanDebit: 0 });
  const cashGoldCredit = calculationVersion === 2 && savedNumber(form.gold18Price) > 0 ? savedNumber(form.paidToman) / savedNumber(form.gold18Price) : 0;
  return { ...Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, roundPartnerAmount(value)])),
    cashGoldCredit: roundPartnerAmount(cashGoldCredit),
    goldCredit: roundPartnerAmount(savedNumber(form.paidGold) + cashGoldCredit), tomanCredit: calculationVersion === 2 ? 0 : roundPartnerAmount(savedNumber(form.paidToman)), lines };
}
export function preparePartnerInvoice(form) {
  const calculationVersion = form.calculationVersion === 2 ? 2 : 1;
  const gold18Price = numeric(form.gold18Price, 'نرخ طلای ۷۵۰ هنگام ثبت', { positive: true });
  if (!Array.isArray(form.lines) || form.lines.length < 1 || form.lines.length > 100) throw new Error('فاکتور باید بین یک تا صد ردیف داشته باشد.');
  return { date: validDate(form.date), externalInvoiceNumber: text(form.externalInvoiceNumber), note: text(form.note), gold18Price,
    ...(calculationVersion === 2 ? { calculationVersion } : {}),
    settlementUnit: 'gold', lines: form.lines.map(line => preparePartnerLine(line, gold18Price, calculationVersion)),
    paidGold: roundPartnerAmount(numeric(form.paidGold, 'طلای پرداخت‌شده', { optional: true })),
    paidToman: roundPartnerAmount(numeric(form.paidToman, 'مبلغ پرداخت‌شده', { optional: true })),
    referenceName: text(form.referenceName), refNumber: text(form.refNumber),
  };
}
export function preparePartnerSettlement(form) {
  if (form.paymentMethod === 'remittance') throw new Error('بخش حواله همکار پس از مشخص شدن روش انجام حواله تکمیل می‌شود.');
  if (!['credit', 'debit'].includes(form.direction) || !['gold', 'cash'].includes(form.paymentMethod)) throw new Error('نوع دریافت یا پرداخت را انتخاب کنید.');
  const goldAmount = roundPartnerAmount(numeric(form.goldAmount, 'مقدار طلای ۷۵۰', { optional: true }));
  const tomanAmount = roundPartnerAmount(numeric(form.tomanAmount, 'مبلغ تومان', { optional: true }));
  if (!(goldAmount > 0 || tomanAmount > 0)) throw new Error('حداقل مقدار طلا یا مبلغ تومان را وارد کنید.');
  return { date: validDate(form.date), direction: form.direction, goldAmount, tomanAmount,
    paymentMethod: form.paymentMethod, counterpartyName: text(form.counterpartyName), reference: text(form.reference), note: text(form.note) };
}

export function partnerStatement(partner) {
  let goldBalance = savedNumber(partner?.openingGoldBalance);
  let tomanBalance = savedNumber(partner?.openingTomanBalance);
  const totals = { goldDebit: 0, goldCredit: 0, tomanDebit: 0, tomanCredit: 0 };
  const entries = [...(partner?.entries || [])].map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0) || a.index - b.index);
  const rows = entries.map(entry => {
    const previousGoldBalance = roundPartnerAmount(goldBalance), previousTomanBalance = roundPartnerAmount(tomanBalance);
    const values = Object.fromEntries(Object.keys(totals).map(key => [key, savedNumber(entry[key])]));
    for (const key of Object.keys(totals)) totals[key] += values[key];
    goldBalance += values.goldDebit - values.goldCredit; tomanBalance += values.tomanDebit - values.tomanCredit;
    return { ...entry, ...values, previousGoldBalance, previousTomanBalance,
      documentGoldBalance: roundPartnerAmount(values.goldDebit - values.goldCredit), documentTomanBalance: roundPartnerAmount(values.tomanDebit - values.tomanCredit),
      goldBalance: roundPartnerAmount(goldBalance), tomanBalance: roundPartnerAmount(tomanBalance) };
  });
  return { rows, ...Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, roundPartnerAmount(value)])),
    openingGoldBalance: savedNumber(partner?.openingGoldBalance), openingTomanBalance: savedNumber(partner?.openingTomanBalance),
    goldBalance: roundPartnerAmount(goldBalance), tomanBalance: roundPartnerAmount(tomanBalance) };
}
