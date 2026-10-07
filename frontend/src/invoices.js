import { currencyName, documentBreakdown, number } from './assets.js';
import { customerItemName } from './crm.js';
import { expenseValue } from './expenses.js';
import { normalizeDigits } from './persianDate.js';
import { isMiscPurchase } from './miscGold.js';

export function invoiceItemName(row, source) {
  const savedName = customerItemName(row, source);
  if (savedName !== 'نام جنس ثبت نشده') return savedName;
  if (isMiscPurchase(row)) return 'طلای متفرقه';
  if (row.category === 'coin') return `سکه ${row.coinType || ''}`.trim();
  if (row.category === 'currency') return currencyName(row.currencyType) || 'ارز';
  if (row.category === 'melted') return 'طلای آبشده';
  return row.craftedKind || savedName;
}

export function invoiceRowAmount(row) {
  const saved = normalizeDigits(row.amount ?? '').replace(/[٬,\s]/g, '').replace(/٫/g, '.');
  if (saved !== '' && Number.isFinite(Number(saved))) return Number(saved);
  return row.type === 'expense' ? number(expenseValue(row)) : documentBreakdown(row).total;
}

// A grouped view never changes the physical stock rows or their recorded values.
// First appearance controls invoice order; numbered rows control its item order.
export function groupInvoices(documents = []) {
  const groups = new Map();
  for (const [index, row] of documents.entries()) {
    const key = row.transactionId || row.id || Symbol(index);
    if (!groups.has(key)) groups.set(key, { id: String(row.transactionId || row.id || `legacy-row-${index}`), rows: [] });
    groups.get(key).rows.push(row);
  }
  return [...groups.values()].map(group => {
    const rows = [...group.rows].sort((a, b) => (number(a.invoiceLine) || Infinity) - (number(b.invoiceLine) || Infinity));
    const first = rows[0];
    const invoiceNumber = rows.find(row => row.invoiceNumber != null && String(row.invoiceNumber).trim())?.invoiceNumber;
    return {
      id: group.id,
      rows,
      number: invoiceNumber ?? group.id.slice(-8),
      date: first.date,
      customerName: first.customerName,
      customerId: first.customerId,
      direction: first.direction || (String(first.type).endsWith('-sale') ? 'فروش' : String(first.type).endsWith('-purchase') ? 'خرید' : ''),
      createdAt: first.createdAt,
      recordedAt: first.recordedAt,
      amount: rows.reduce((sum, row) => sum + invoiceRowAmount(row), 0),
      rialDebt: rows.reduce((sum, row) => sum + number(row.rialDebt), 0),
      gramDebt: rows.reduce((sum, row) => sum + number(row.gramDebt), 0),
      ...(first.settlementVersion === 1 ? {
        settlementVersion: 1, cashPaid: number(first.cashPaid),
        settlementGoldPrice: number(first.settlementGoldPrice),
        settlementRemainder: number(first.settlementRemainder),
      } : {}),
    };
  });
}
