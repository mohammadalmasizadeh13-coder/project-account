import { currencyName, documentBreakdown, number } from './assets.js';
import { customerItemName } from './crm.js';
import { expenseValue } from './expenses.js';
import { normalizeDigits } from './persianDate.js';
import { isMiscPurchase } from './miscGold.js';

export function invoiceItemName(row, source) {
  if (row.category === 'remittance') return row.itemName || row.note || 'حواله طلای ۷۵۰';
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

const roundLedger = value => Math.round((value + Number.EPSILON) * 1e6) / 1e6;

// Ledger-only rows are projected for document browsing, never added to stock.
// Keep the ledger's original order because inventory numbering omits remittances.
export function partnerDocumentRows(documents = [], partners = []) {
  const byId = new Map(documents.map(row => [String(row.id), row]));
  const projected = new Map();
  for (const partner of partners) for (const entry of partner.entries || []) {
    if (entry.type === 'settlement' && entry.paymentMethod === 'remittance' && !entry.linkedEntryId) {
      const totals = Object.fromEntries(['goldDebit', 'goldCredit', 'tomanDebit', 'tomanCredit'].map(field => [field, roundLedger(number(entry[field]))]));
      totals.netGold = roundLedger(totals.goldDebit - totals.goldCredit);
      totals.netToman = roundLedger(totals.tomanDebit - totals.tomanCredit);
      totals.amount = totals.netToman;
      const goldAmount = roundLedger(totals.goldDebit + totals.goldCredit), tomanAmount = roundLedger(totals.tomanDebit + totals.tomanCredit);
      const transactionId = entry.transactionId || `partner-remittance-${entry.id}`;
      const remittanceDirection = totals.goldDebit > 0 || totals.tomanDebit > 0 ? 'debit' : 'credit';
      const format = value => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 6 }).format(value);
      projected.set(String(transactionId), [{
        id: `partner-remittance-${entry.id}`, transactionId, invoiceNumber: entry.invoiceNumber,
        galleryName: entry.galleryName,
        invoiceLine: 1, invoiceLineCount: 1, date: entry.date, createdAt: entry.createdAt, recordedAt: entry.createdAt,
        category: 'remittance', type: 'partner-remittance', typeLabel: 'حواله همکار',
        direction: remittanceDirection === 'debit' ? 'بدهکار' : 'بستانکار', remittanceDirection,
        goldAmount, tomanAmount, amount: tomanAmount,
        itemName: entry.note || 'حواله همکار', note: entry.note || '', reference: entry.reference || '', counterpartyName: entry.counterpartyName || '',
        itemSummary: [entry.counterpartyName, entry.reference, goldAmount ? `${format(goldAmount)} گرم طلای ۷۵۰` : '', tomanAmount ? `${format(tomanAmount)} تومان` : ''].filter(Boolean).join(' · '),
        counterpartyType: 'partner', partnerId: partner.id, customerId: partner.id, customerName: partner.name,
        partnerEntryId: entry.id, partnerEntry: entry, partnerLedgerTotals: totals,
        partnerDisplayOnly: true, partnerRemittance: true,
      }]);
      continue;
    }
    if (entry.calculationVersion !== 3 || !entry.transactionId || !entry.lines?.length || entry.type === 'settlement') continue;
    const linked = (partner.entries || []).filter(payment => payment.linkedEntryId === entry.id);
    const ledger = [entry, ...linked];
    const totals = Object.fromEntries(['goldDebit', 'goldCredit', 'tomanDebit', 'tomanCredit'].map(field =>
      [field, roundLedger(ledger.reduce((sum, row) => sum + number(row[field]), 0))]));
    totals.netGold = roundLedger(totals.goldDebit - totals.goldCredit);
    totals.netToman = roundLedger(totals.tomanDebit - totals.tomanCredit);
    const rate = number(entry.gold18Price);
    const rowDirection = line => line.category === 'remittance'
      ? line.remittanceDirection === 'debit' ? 'purchase' : 'sale'
      : line.direction || entry.direction || (entry.type === 'sale' ? 'sale' : 'purchase');
    const linesAmount = entry.lines.reduce((sum, line) => sum + (rowDirection(line) === 'sale' ? -1 : 1) *
      (line.category === 'remittance' ? number(line.amount ?? number(line.goldAmount) * rate) : invoiceRowAmount(line)), 0);
    const paymentAmount = (number(entry.paidGold) * rate + number(entry.paidToman)) * (entry.direction === 'sale' ? 1 : -1);
    totals.amount = linesAmount + paymentAmount + linked.reduce((sum, payment) => sum +
      (number(payment.goldDebit) - number(payment.goldCredit)) * rate + number(payment.tomanDebit) - number(payment.tomanCredit), 0);
    projected.set(String(entry.transactionId), entry.lines.map((line, index) => {
      const original = byId.get(String(line.documentId));
      const remittance = line.category === 'remittance';
      return {
        ...(original || line),
        galleryName: entry.galleryName || original?.galleryName,
        id: original?.id || `partner-entry-${entry.id}-line-${index + 1}`,
        ...(original ? {} : { partnerDisplayOnly: true }),
        transactionId: entry.transactionId, invoiceNumber: entry.invoiceNumber, invoiceLine: index + 1,
        invoiceLineCount: entry.lines.length, date: entry.date, createdAt: entry.createdAt, recordedAt: original?.recordedAt || entry.createdAt,
        counterpartyType: 'partner', partnerId: partner.id, customerId: partner.id, customerName: partner.name,
        partnerEntryId: entry.id, partnerEntry: entry, partnerLedgerTotals: totals,
        externalInvoiceNumber: entry.externalInvoiceNumber, calculationVersion: 3,
        ...(remittance ? { category: 'remittance', type: 'partner-remittance', typeLabel: 'حواله همکار',
          direction: line.remittanceDirection === 'debit' ? 'بدهکار' : 'بستانکار', itemName: line.note || 'حواله طلای ۷۵۰',
          itemSummary: [line.counterpartyName, line.reference].filter(Boolean).join(' · '), amount: line.amount ?? number(line.goldAmount) * rate } : {}),
      };
    }));
  }
  const emitted = new Set();
  const rows = documents.flatMap(row => {
    const key = String(row.transactionId);
    if (!projected.has(key)) return [row];
    if (emitted.has(key)) return [];
    emitted.add(key);
    return projected.get(key);
  });
  for (const [key, additions] of projected) if (!emitted.has(key)) {
    const timestamp = Date.parse(additions[0].createdAt) || 0;
    const before = rows.findIndex(row => (Date.parse(row.createdAt || row.recordedAt) || 0) <= timestamp);
    rows.splice(before < 0 ? rows.length : before, 0, ...additions);
  }
  return rows;
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
    const partnerEntry = first.partnerEntry;
    const partnerTotals = first.partnerLedgerTotals;
    return {
      id: group.id,
      rows,
      number: invoiceNumber ?? group.id.slice(-8),
      galleryName: first.galleryName,
      date: first.date,
      customerName: first.customerName,
      customerId: first.customerId,
      customerPhone: first.customerPhone,
      customerBirthDate: first.customerBirthDate,
      customerAddress: first.customerAddress,
      customerNationalId: first.customerNationalId,
      paymentMethod: first.paymentMethod,
      direction: first.direction || (String(first.type).endsWith('-sale') ? 'فروش' : String(first.type).endsWith('-purchase') ? 'خرید' : ''),
      createdAt: first.createdAt,
      recordedAt: first.recordedAt,
      amount: rows.reduce((sum, row) => sum + invoiceRowAmount(row), 0),
      rialDebt: rows.reduce((sum, row) => sum + number(row.rialDebt), 0),
      gramDebt: rows.reduce((sum, row) => sum + number(row.gramDebt), 0),
      ...((partnerEntry?.calculationVersion === 3 || first.partnerRemittance) && partnerTotals ? {
        typeLabel: first.partnerRemittance ? 'حواله همکار' : 'سند همکار',
        direction: first.partnerRemittance ? first.direction : partnerEntry.type === 'mixed' ? 'ترکیبی' : partnerEntry.type === 'sale' ? 'فروش' : 'خرید',
        partnerId: first.partnerId, partnerEntryId: partnerEntry.id, partnerEntry,
        ...(first.partnerRemittance ? { partnerRemittance: true, remittanceDirection: first.remittanceDirection } : {}),
        ...partnerTotals, gramDebt: partnerTotals.netGold, rialDebt: partnerTotals.netToman,
      } : {}),
      ...(first.settlementVersion === 1 ? {
        settlementVersion: 1, cashPaid: number(first.cashPaid),
        settlementGoldPrice: number(first.settlementGoldPrice),
        settlementRemainder: number(first.settlementRemainder),
      } : {}),
    };
  });
}
