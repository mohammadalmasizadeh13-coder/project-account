import { expandSetForm, isSeparateSetForm } from './jewelrySets.js';
import { profitPercentInput } from './profitDefaults.js';
import { isMiscPurchase, miscGoldDefaults } from './miscGold.js';
import { coinSpec, isOrdinaryCoin } from './coins.js';

export const invoiceHeaderFields = ['date', 'customerId', 'customerName', 'customerPhone', 'customerBirthDate', 'customerAddress', 'customerNationalId', 'paymentMethod', 'gold18Price', 'gramDebt', 'rialDebt', 'cashPaid', 'note'];
export const invoiceHeader = form => Object.fromEntries(invoiceHeaderFields.map(key => [key, form[key]]));

export function cleanInvoiceLine(form) {
  const line = { ...form };
  if (line.coinPricingVersion == null || line.coinPricingVersion === '') delete line.coinPricingVersion;
  for (const key of ['invoiceRows', 'invoiceCurrentEmpty', 'invoiceEditingIndex', 'invoicePaymentStep', 'invoiceVersion', 'invoiceLine', 'invoiceLineCount', 'invoiceNumber', 'transactionId', 'id', 'amount', 'settlementVersion', 'settlementGoldPrice', 'settlementRemainder', 'cashPaid']) delete line[key];
  return line;
}

export function invoiceLineForms(form) {
  const rows = [...(form.invoiceRows || [])];
  const current = cleanInvoiceLine(form);
  if (Number.isInteger(form.invoiceEditingIndex) && form.invoiceEditingIndex >= 0 && form.invoiceEditingIndex < rows.length) rows[form.invoiceEditingIndex] = current;
  else if (!rows.length || !form.invoiceCurrentEmpty) rows.push(current);
  return rows.map(row => ({ ...row, ...invoiceHeader(form) }));
}

export function invoiceLinePreview(form, goldPrice) {
  const miscellaneous = isMiscPurchase(form);
  const category = miscellaneous ? 'crafted' : String(form.type).split('-')[0];
  const spec = category === 'coin' && isOrdinaryCoin(form) ? coinSpec(form) : null;
  return { ...(miscellaneous ? miscGoldDefaults() : {}), ...cleanInvoiceLine(form), category,
    ...(spec ? { coinWeight: spec.weight, coinAyar: spec.ayar, coinWeight750: spec.weight750 } : {}),
    profitPercent: profitPercentInput(form.profitPercent, category, form),
    ...(miscellaneous ? { wagePercent: '0', wageFixed: '0' } : {}),
    gold18Price: form.gold18Price ?? goldPrice ?? '',
    ...(isSeparateSetForm({ ...form, category }) ? { gramPrice: goldPrice } : {}),
  };
}

export function expandInvoiceDraft(form, goldPrice, transactionId) {
  const rows = invoiceLineForms(form).flatMap(line => expandSetForm(invoiceLinePreview(line, goldPrice), { transactionId }));
  return rows.map((row, index) => ({ ...row, gramDebt: index === 0 ? form.gramDebt : 0, rialDebt: index === 0 ? form.rialDebt : 0 }));
}
