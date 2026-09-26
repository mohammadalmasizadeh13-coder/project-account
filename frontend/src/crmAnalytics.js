import { currencyName, documentBreakdown, number, quantity } from './assets.js';
import { customerTransactions } from './crm.js';
import { dateBefore, invoiceCount, iranDate, transactionKey } from './sales.js';
import { normalizeDigits } from './persianDate.js';

export const craftedKinds = ['النگو', 'دستبند', 'گردنبند', 'زنجیر', 'انگشتر', 'گوشواره', 'آویز و پلاک', 'نیم‌ست', 'ست', 'سرویس', 'پابند', 'سایر'];
export const purchaseGroups = { crafted: 'کار ساخته', coin: 'سکه', melted: 'آب‌شده', currency: 'ارز', other: 'سایر / نامشخص' };
export const normalizeCustomerText = value => normalizeDigits(value ?? '').replace(/ي|ى/g, 'ی').replace(/ك/g, 'ک').replace(/[\s\u200c\u200f_-]+/g, '').toLowerCase();
const aliases = [
  ['نیم‌ست', ['نیمست']], ['دستبند', ['دستبند']], ['گردنبند', ['گردنبند']], ['النگو', ['النگو']],
  ['زنجیر', ['زنجیر']], ['انگشتر', ['انگشتر', 'حلقه']], ['گوشواره', ['گوشواره']],
  ['آویز و پلاک', ['آویز', 'پلاک']], ['سرویس', ['سرویس']], ['پابند', ['پابند']],
];
export function craftedKind(doc, source) {
  if (craftedKinds.includes(doc.craftedKind)) return doc.craftedKind;
  if (craftedKinds.includes(source?.craftedKind)) return source.craftedKind;
  const rawName = doc.itemName || source?.itemName || doc.description || source?.description || '';
  const name = normalizeCustomerText(rawName);
  return aliases.find(([, terms]) => terms.some(term => name.includes(term)))?.[0]
    || (/(?:^|[\s\u200c])ست(?:$|[\s\u200c])/.test(rawName) ? 'ست' : 'سایر');
}
const isSale = doc => String(doc.type).endsWith('-sale') || doc.direction === 'فروش';
const categoryOf = doc => doc.category || String(doc.type || '').split('-')[0];
const unique = records => {
  const seen = new Set();
  return records.filter(record => { if (!record.id) return true; if (seen.has(record.id)) return false; seen.add(record.id); return true; });
};
const validDate = date => /^\d{4}-\d{2}-\d{2}$/.test(date || '') && Number.isFinite(Date.parse(`${date}T12:00:00Z`)) && new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date;
const inRange = (date, start, end) => validDate(date) && date >= start && date <= end;
const elapsedDays = (from, to) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000);
export const sortPreferences = (items, metric = 'amount') => [...items].sort((a, b) => b[metric] - a[metric] || b.invoices - a.invoices || a.label.localeCompare(b.label, 'fa'));
const increment = (map, key, label, doc, amount, count, grams, unit = 'عدد / قطعه') => {
  const entry = map.get(key) || { key, label, amount: 0, quantity: 0, grams: 0, invoices: 0, unit, invoiceKeys: new Set() };
  entry.invoiceKeys.add(transactionKey(doc));
  entry.amount += amount; entry.quantity += count; entry.grams += grams; entry.invoices = entry.invoiceKeys.size;
  map.set(key, entry);
};
const preferences = map => sortPreferences([...map.values()].map(({ invoiceKeys, ...entry }) => entry));

export function customerAnalytics(customer, documents, { today = iranDate(), days = 0, category = 'all' } = {}) {
  const start = days > 0 ? dateBefore(today, days - 1) : '0000-01-01';
  const transactions = unique(customerTransactions(customer, documents));
  const lifetime = transactions.filter(doc => isSale(doc) && inRange(doc.date, '0000-01-01', today));
  const purchases = lifetime.filter(doc => inRange(doc.date, start, today) && (category === 'all' || categoryOf(doc) === category));
  const sources = new Map(documents.map(doc => [doc.id, doc]));
  const groups = new Map(), coins = new Map(), crafted = new Map(), products = new Map(), currencies = new Map();
  let purchased = 0, itemCount = 0, craftedQuantity = 0, goldGrams = 0, discounts = 0;
  for (const doc of purchases) {
    const source = sources.get(doc.inventorySourceId);
    const category = categoryOf(doc);
    const amount = doc.amount !== undefined && doc.amount !== null && doc.amount !== '' ? number(doc.amount) : documentBreakdown({ ...doc, category }).total;
    const count = quantity({ ...doc, category });
    const grams = category === 'crafted' ? count * number(doc.weight) * number(doc.ayar || 750) / 750
      : category === 'melted' ? count * number(doc.meltedWeight) * number(doc.meltedAyar || 750) / 750 : 0;
    purchased += amount; goldGrams += grams; discounts += number(doc.discountRial);
    if (['crafted', 'coin', 'melted'].includes(category)) itemCount += count;
    if (category === 'crafted') craftedQuantity += count;
    const group = purchaseGroups[category] ? category : 'other';
    // Currency quantities from different denominations are never added together.
    increment(groups, group, purchaseGroups[group], doc, amount, category === 'currency' ? 0 : count, grams);
    if (category === 'coin') {
      const label = doc.coinType || source?.coinType || 'سکه نامشخص';
      increment(coins, normalizeCustomerText(label), label, doc, amount, count, 0, 'عدد');
    }
    if (category === 'crafted') {
      const kind = craftedKind(doc, source);
      increment(crafted, kind, kind, doc, amount, count, grams, 'عدد');
    }
    if (category === 'currency') {
      const code = doc.currencyType || 'نامشخص';
      increment(currencies, code, currencyName(code), doc, amount, count, 0, code);
    }
    const label = category === 'coin' ? (doc.coinType || source?.coinType || 'سکه نامشخص')
      : category === 'currency' ? currencyName(doc.currencyType || 'نامشخص')
      : doc.itemName || source?.itemName || (category === 'crafted' ? craftedKind(doc, source) : purchaseGroups[group]);
    increment(products, `${group}:${normalizeCustomerText(label)}`, label, doc, amount, count, grams, category === 'currency' ? doc.currencyType : 'عدد / قطعه');
  }
  const receipts = unique(customer.settlements || []).filter(item => item.direction === 'received' && inRange(item.date, start, today));
  const paid = unique(customer.settlements || []).filter(item => item.direction === 'paid' && inRange(item.date, start, today));
  const lastPurchase = lifetime[0]?.date || '';
  const firstPurchase = lifetime.at(-1)?.date || '';
  const daysSincePurchase = lastPurchase ? elapsedDays(lastPurchase, today) : null;
  const purchaseDays = new Set(lifetime.map(doc => doc.date)).size;
  const segment = !lifetime.length ? 'بدون سابقه خرید' : daysSincePurchase >= 90 ? '۹۰ روز بدون خرید' : purchaseDays >= 3 ? 'خریدار تکراری' : firstPurchase >= dateBefore(today, 29) ? 'مشتری تازه' : 'خریدار موردی';
  const invoices = invoiceCount(purchases);
  return {
    customer, purchases, purchased, itemCount, craftedQuantity, goldGrams, discounts, invoices,
    averagePurchase: invoices ? purchased / invoices : 0,
    received: receipts.reduce((sum, item) => sum + number(item.rialAmount), 0),
    receivedGrams: receipts.reduce((sum, item) => sum + number(item.gramAmount), 0),
    paid: paid.reduce((sum, item) => sum + number(item.rialAmount), 0), receiptCount: receipts.length,
    groups: preferences(groups), coins: preferences(coins), crafted: preferences(crafted),
    products: preferences(products), currencies: preferences(currencies),
    lastPurchase, firstPurchase, daysSincePurchase, purchaseDays, segment,
    followUpDue: validDate(customer.followUpDate) && customer.followUpDate <= today,
    inactive: daysSincePurchase !== null && daysSincePurchase >= 90,
    debtor: number(customer.rialDebt) > 0 || number(customer.gramDebt) > 0,
    lifetimePurchased: lifetime.reduce((sum, doc) => sum + number(doc.amount), 0),
  };
}

export function rankCustomers(rows, metric = 'purchased') {
  const sorted = [...rows].sort((a, b) => (metric === 'lastPurchase' ? b.lastPurchase.localeCompare(a.lastPurchase) : b[metric] - a[metric]) || a.customer.name.localeCompare(b.customer.name, 'fa') || String(a.customer.id).localeCompare(String(b.customer.id)));
  let rank = 0;
  return sorted.map((row, index) => {
    if (!index || row[metric] !== sorted[index - 1][metric]) rank = index + 1;
    return { ...row, rank };
  });
}

// Spreadsheet exports escape delimiters and disable formula interpretation.
export function customerRankingCsv(rows) {
  const cell = value => `"${String(value ?? '').replace(/^[\s]*[=+@-]/, match => `'${match}`).replace(/"/g, '""')}"`;
  const table = [['رتبه', 'مشتری', 'شماره تماس', 'مبلغ خرید (تومان)', 'تعداد اجناس', 'تعداد کار ساخته', 'دفعات خرید (سند)', 'دریافت ثبت‌شده (تومان)', 'میانگین خرید (تومان)', 'گروه محبوب بر اساس مبلغ', 'آخرین خرید (میلادی)', 'وضعیت'],
    ...rows.map(row => [row.rank, row.customer.name, row.customer.phone ? `'${row.customer.phone}` : '', row.purchased, row.itemCount, row.craftedQuantity, row.invoices, row.received, row.averagePurchase, row.groups[0]?.label || '', row.lastPurchase, row.segment])];
  return '\uFEFF' + table.map(row => row.map(cell).join(',')).join('\r\n');
}
