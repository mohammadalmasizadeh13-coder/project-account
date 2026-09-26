import { currencyName } from './assets.js';

export const saleCategories = [
  { key: 'crafted', label: 'کار ساخته', color: '#507b76' },
  { key: 'coin', label: 'سکه', color: '#d9bb62' },
  { key: 'melted', label: 'طلای آبشده', color: '#a5bab4' },
  { key: 'currency', label: 'ارز', color: '#779ac4' },
];

export function iranDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function dateBefore(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

export function goldBalance(salesAmount, gramPrice, purchasedGrams = 0) {
  const price = Number(gramPrice);
  return Number.isFinite(price) && price > 0 ? salesAmount / price - purchasedGrams : null;
}

export function goldPurchasesReport(purchases, period, today = iranDate()) {
  const days = period === 'week' ? 7 : period === 'month' ? 30 : 1;
  const start = dateBefore(today, days - 1);
  const records = purchases.filter(item => item.date >= start && item.date <= today);
  return { records, total: records.reduce((sum, item) => sum + Number(item.grams), 0) };
}

// A transaction may contain several physical pieces. Legacy documents remain
// individual invoices, and old rows without IDs retain their own identity.
export const transactionKey = document => document.transactionId || document.id || document;
export const invoiceCount = documents => new Set(documents.map(transactionKey)).size;

export function salesReport(documents, period, helpers, today = iranDate()) {
  const { quantity, weight, amount } = helpers;
  const days = period === 'week' ? 7 : period === 'month' ? 30 : 1;
  const start = dateBefore(today, days - 1);
  const sales = documents.filter(doc => (String(doc.type).endsWith('-sale') || doc.direction === 'فروش') && doc.date >= start && doc.date <= today && doc.source !== 'opening-inventory');
  const categories = saleCategories.map(category => ({ ...category, amount: 0, quantity: 0, weight: 0 }));
  const products = new Map();
  const productTransactions = new Map();
  const series = Array.from({ length: days }, (_, index) => ({ date: dateBefore(today, days - index - 1), amount: 0 }));
  let total = 0;
  let count = 0;
  let totalWeight = 0;
  for (const doc of sales) {
    const value = doc.amount !== undefined && doc.amount !== null && doc.amount !== '' && Number.isFinite(Number(doc.amount)) ? Number(doc.amount) : amount(doc);
    const qty = quantity(doc);
    const grams = weight(doc);
    total += value;
    if (doc.category !== 'currency') count += qty;
    totalWeight += grams;
    const category = categories.find(item => item.key === doc.category);
    if (category) { category.amount += value; category.quantity += qty; category.weight += grams; }
    const name = doc.category === 'currency' ? currencyName(doc.currencyType) : doc.category === 'coin' ? `سکه ${doc.coinType || ''}`.trim() : (String(doc.itemName || '').trim() || String(doc.description || '').trim() || category?.label || 'سایر');
    const key = `${doc.category}:${name}`;
    const product = products.get(key) || { key, name, category: category?.label || 'سایر', unit: doc.category === 'currency' ? doc.currencyType : 'عدد / قطعه', amount: 0, quantity: 0, weight: 0, invoices: 0 };
    const invoices = productTransactions.get(key) || new Set();
    invoices.add(transactionKey(doc));
    productTransactions.set(key, invoices);
    product.amount += value; product.quantity += qty; product.weight += grams; product.invoices = invoices.size;
    products.set(key, product);
    const bucket = series.find(item => item.date === doc.date);
    if (bucket) bucket.amount += value;
  }
  return { total, count, totalWeight, invoices: invoiceCount(sales), categories, products: [...products.values()].sort((a, b) => b.amount - a.amount), series };
}
