import { number } from './assets.js';
import { craftedKinds } from './crmAnalytics.js';
import { validateDocument } from './documentValidation.js';
import { validateStockSales } from './inventory.js';

const uniqueId = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
const normalizedKind = kind => String(kind || '').replace(/[\s\u200c]/g, '');
export const isJewelrySetKind = kind => ['نیمست', 'ست', 'سرویس'].includes(normalizedKind(kind));
export const isSeparateSetForm = form => (!form.category || form.category === 'crafted') && form.setMode === 'separate' && isJewelrySetKind(form.craftedKind);

export function createSetPart(values = {}) {
  return {
    id: uniqueId('set-part'), craftedKind: '', itemName: '', itemCount: '1',
    weight: '', ayar: '750', gramPrice: '', wagePercent: '0', wageFixed: '0',
    otherCosts: '0', profitPercent: '0', discountRial: '', ...values,
  };
}

const partFields = ['craftedKind', 'itemName', 'itemCount', 'weight', 'ayar', 'gramPrice', 'wagePercent', 'wageFixed', 'otherCosts', 'profitPercent', 'discountRial', 'inventorySourceId', 'productCode'];
const parentFields = new Set(['customerName', 'date', 'gold18Price', 'gramDebt', 'rialDebt']);
const cleanForm = form => {
  const result = { ...form };
  for (const key of ['id', 'setParts', 'selected', 'remaining', 'received', 'sold', 'sales']) delete result[key];
  return result;
};

// A separate set has no parent stock record: its rows are the only inventory
// and accounting entries. Shared debt belongs to the invoice and is counted once.
export function expandSetForm(form, { setId, transactionId } = {}) {
  const parent = cleanForm(form);
  if (!isSeparateSetForm(form)) {
    const crafted = !form.category || form.category === 'crafted';
    if (isJewelrySetKind(form.craftedKind) && crafted) {
      parent.setKind = form.craftedKind;
      parent.setMode = 'together';
    } else if (!(crafted && form.setId && form.setMode === 'separate')) {
      // Empty forms default to "together" for their picker. That UI default
      // does not make an ordinary ring, coin, or currency lot a jewelry set.
      for (const key of ['setId', 'setName', 'setKind', 'setMode', 'setPieceCount']) delete parent[key];
    }
    if (transactionId) parent.transactionId = transactionId;
    return [parent];
  }
  const allParts = Array.isArray(form.setParts) ? form.setParts : [];
  const parts = allParts.filter(part => part.selected !== false);
  const groupId = setId || form.setId || uniqueId('jewelry-set');
  const isSale = String(form.type).endsWith('-sale');
  return parts.map((part, index) => {
    const fields = Object.fromEntries(partFields.map(key => [key, part[key] ?? '']));
    return {
      ...parent, ...fields, category: 'crafted',
      gramPrice: String(part.gramPrice ?? '').trim() ? part.gramPrice : form.gramPrice,
      itemName: String(part.itemName || '').trim() || part.craftedKind || '',
      setId: groupId, setName: form.setName || form.itemName || form.description || form.craftedKind,
      setKind: form.craftedKind, setMode: 'separate',
      setPieceCount: isSale ? (part.setPieceCount || form.setPieceCount || allParts.length) : allParts.length,
      gramDebt: index === 0 ? form.gramDebt : 0, rialDebt: index === 0 ? form.rialDebt : 0,
      ...(transactionId ? { transactionId } : {}),
    };
  });
}

export function validateSetForm(form, documents) {
  const category = form.category || String(form.type || '').replace(/^opening-/, '').split('-')[0] || 'crafted';
  const validationForm = form.source === 'opening-inventory' || String(form.type).startsWith('opening-')
    ? { ...form, customerName: form.customerName || 'موجودی اولیه' } : form;
  if (!isSeparateSetForm(form)) return validateDocument(validationForm, category, number);

  const errors = {};
  const allParts = Array.isArray(form.setParts) ? form.setParts : [];
  const selected = allParts.filter(part => part.selected !== false);
  const sale = String(form.type).endsWith('-sale');
  if (selected.length < (sale ? 1 : 2)) errors.setParts = sale ? 'حداقل یک قطعه را برای فروش انتخاب کنید.' : 'برای ثبت ست یا نیم‌ست جدا، حداقل دو قطعه اضافه کنید.';
  const expanded = expandSetForm(validationForm);
  // Parent errors must stay visible even if the set has no selected rows.
  for (const [key, message] of Object.entries(validateDocument(validationForm, 'crafted', number))) {
    if (parentFields.has(key)) errors[key] = message;
  }
  selected.forEach((part, index) => {
    const prefix = `setParts.${part.id}.`;
    const itemErrors = validateDocument(expanded[index], 'crafted', number);
    for (const [key, message] of Object.entries(itemErrors)) {
      if (parentFields.has(key)) errors[key] = message;
      else errors[`${prefix}${key}`] = message;
    }
    if (!craftedKinds.includes(part.craftedKind) || isJewelrySetKind(part.craftedKind)) errors[`${prefix}craftedKind`] = 'نوع قطعه را انتخاب کنید.';
    if (part.craftedKind === 'سایر' && !String(part.itemName || '').trim()) errors[`${prefix}itemName`] = 'نام قطعه را وارد کنید.';
    const count = number(part.itemCount);
    if (!Number.isSafeInteger(count) || count <= 0) errors[`${prefix}itemCount`] = 'تعداد قطعه باید عدد صحیح بیشتر از صفر باشد.';
  });
  if (sale && documents) {
    const stockError = validateStockSales(expanded, documents);
    if (stockError) errors.setParts = stockError;
  }
  return errors;
}
