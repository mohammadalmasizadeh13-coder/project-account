import { normalizeDigits } from './persianDate.js';
import { coinCatalog, currencyRate, quantity } from './assets.js';

export const stockCategories = { crafted: 'کار ساخته', coin: 'سکه', melted: 'آب‌شده', currency: 'ارز' };
export const normalizeProductCode = value => normalizeDigits(value).trim().toUpperCase().replace(/\s/g, '');
export const stockQuantity = quantity;
export const stockUnit = doc => doc.category === 'currency' ? (doc.currencyType || 'واحد ارز') : 'عدد / قطعه';
export const isStockEntry = doc => Boolean(stockCategories[doc.category]) && (doc.source === 'opening-inventory' || String(doc.type).endsWith('-purchase'));
export const isStockSale = doc => String(doc.type).endsWith('-sale');

// Codes belong to an incoming lot, not to a name: two rings with the same name
// but different weights must never share a stock balance. Persist assigned codes.
export function assignProductCodes(documents) {
  const used = new Set(documents.map(doc => normalizeProductCode(doc.productCode || '')).filter(Boolean));
  let sequence = Math.max(0, ...[...used].map(code => /^ZG-\d+$/.test(code) ? Number(code.slice(3)) : 0));
  const assigned = new Map();
  for (const doc of [...documents].reverse()) {
    if (!isStockEntry(doc) || doc.productCode) continue;
    let code;
    do { code = `ZG-${String(++sequence).padStart(6, '0')}`; } while (used.has(code));
    used.add(code); assigned.set(doc.id, code);
  }
  return documents.map(doc => assigned.has(doc.id) ? { ...doc, productCode: assigned.get(doc.id) } : doc);
}

export function inventoryReport(documents) {
  const entries = documents.filter(isStockEntry);
  const byId = new Map(entries.map(doc => [doc.id, { ...doc, received: stockQuantity(doc), sold: 0, sales: [] }]));
  const unlinkedSales = [];
  for (const sale of documents.filter(isStockSale)) {
    const item = byId.get(sale.inventorySourceId);
    if (!item) { unlinkedSales.push(sale); continue; }
    item.sold += stockQuantity(sale);
    item.sales.push(sale);
  }
  const items = [...byId.values()].map(item => ({ ...item, remaining: Math.round((item.received - item.sold) * 1e8) / 1e8 || 0 }));
  return { items, available: items.filter(item => item.remaining > 0), unlinkedSales };
}

export function validateStockSale(sale, documents) {
  const item = inventoryReport(documents.filter(doc => doc.id !== sale.id)).items.find(entry => entry.id === sale.inventorySourceId);
  if (!item) return 'کد جنس موجود در صندوق را انتخاب کنید.';
  if (sale.category !== item.category) return 'نوع سند با جنس انتخاب‌شده مطابقت ندارد.';
  const quantity = stockQuantity(sale);
  if (!Number.isFinite(quantity) || quantity <= 0 || (sale.category !== 'currency' && !Number.isSafeInteger(quantity))) return 'مقدار فروش باید معتبر و بیشتر از صفر باشد؛ تعداد جنس باید صحیح باشد.';
  if (sale.category === 'currency' && sale.currencyType !== item.currencyType) return 'نوع ارز با موجودی انتخاب‌شده مطابقت ندارد.';
  if (sale.category === 'coin' && sale.coinType !== item.coinType) return 'نوع سکه با موجودی انتخاب‌شده مطابقت ندارد.';
  if (quantity > item.remaining) return 'تعداد فروش از موجودی این کد بیشتر است.';
  if (sale.date < item.date) return 'تاریخ فروش نمی‌تواند قبل از ورود این جنس به صندوق باشد.';
  return '';
}

// Validate a whole invoice against the same balances, including repeat picks of
// one source. Give draft rows distinct identities so an unpersisted row cannot
// accidentally hide another unpersisted sale during validation.
export function validateStockSales(sales, documents) {
  const replacingIds = new Set(sales.map(sale => sale.id).filter(Boolean));
  const staged = documents.filter(doc => !replacingIds.has(doc.id));
  for (const sale of sales) {
    const draft = { ...sale, id: Symbol('stock-sale-draft') };
    const error = validateStockSale(draft, staged);
    if (error) return error;
    staged.push(draft);
  }
  return '';
}

export const stockIdentityFields = ['itemName', 'craftedKind', 'weight', 'ayar', 'coinType', 'currencyType', 'parsianWeight', 'meltedWeight', 'meltedAyar', 'assayCode', 'laboratoryName', 'setId', 'setName', 'setKind', 'setMode', 'setPieceCount'];

export function stockSaleForm(item, form, prices = {}) {
  const fields = Object.fromEntries(stockIdentityFields.map(key => [key, item[key] ?? '']));
  const coinRates = Object.fromEntries(coinCatalog.map(coin => [coin.name, coin.price]));
  return { ...form, ...fields, itemName: String(item.itemName || '').trim(),
    type: `${item.category}-sale`, inventorySourceId: item.id, productCode: item.productCode,
    itemCount: '1', coinCount: '1', description: '', setParts: [],
    currencyAmount: '1', currencyRate: String(currencyRate(item.currencyType, prices) || item.currencyRate || ''),
    gramPrice: prices.goldGramPrice || item.gramPrice || '', meltedGramPrice: prices.goldGramPrice || item.meltedGramPrice || '',
    coinPrice: prices[coinRates[item.coinType]] || item.coinPrice || '', parsianPrice: item.parsianPrice || '',
    wagePercent: item.wagePercent || '0', wageFixed: item.wageFixed || '0', otherCosts: item.otherCosts || '0', profitPercent: '7', discountRial: '', discountPercent: '',
  };
}

export function linkHistoricalSale(documents, saleId, sourceId) {
  const sale = documents.find(doc => doc.id === saleId && isStockSale(doc));
  const source = documents.find(doc => doc.id === sourceId && isStockEntry(doc));
  if (!sale || !source) throw new Error('سند یا جنس انتخاب‌شده پیدا نشد.');
  if (sale.inventorySourceId) throw new Error('این فروش قبلاً به صندوق وصل شده است.');
  const linked = { ...sale, inventorySourceId: source.id, productCode: source.productCode };
  const error = validateStockSale(linked, documents);
  if (error) throw new Error(error);
  // Never alter old invoice totals, physical specifications or customer debt.
  return documents.map(doc => doc.id === saleId ? linked : doc);
}

// Stage the customer update first and commit the authoritative ledger last.
// If the ledger write fails, restore the old customer record before allowing retry.
export function saveLedgerRecords(storage, documentsKey, customersKey, documents, customers) {
  const previous = storage.getItem(customersKey);
  storage.setItem(customersKey, JSON.stringify(customers));
  try { storage.setItem(documentsKey, JSON.stringify(documents)); }
  catch (error) {
    if (previous === null) storage.removeItem(customersKey);
    else storage.setItem(customersKey, previous);
    throw error;
  }
}
