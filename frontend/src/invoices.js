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
    if (entry.type === 'settlement' && !entry.linkedEntryId) {
      const remittance = entry.paymentMethod === 'remittance';
      const title = remittance ? 'حواله همکار' : 'دریافت / پرداخت همکار';
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
        invoiceLine: 1, invoiceLineCount: 1, date: entry.date, invoiceTime: entry.invoiceTime, createdAt: entry.createdAt, recordedAt: entry.createdAt,
        category: 'remittance', type: remittance ? 'partner-remittance' : 'partner-settlement', typeLabel: title,
        direction: remittanceDirection === 'debit' ? 'بدهکار' : 'بستانکار', remittanceDirection,
        goldAmount, tomanAmount, amount: tomanAmount,
        itemName: entry.note || title, note: entry.note || '', reference: entry.reference || '', counterpartyName: entry.counterpartyName || '',
        itemSummary: [entry.counterpartyName, entry.reference, goldAmount ? `${format(goldAmount)} گرم طلای ۷۵۰` : '', tomanAmount ? `${format(tomanAmount)} تومان` : ''].filter(Boolean).join(' · '),
        counterpartyType: 'partner', partnerId: partner.id, customerId: partner.id, customerName: partner.name,
        partnerEntryId: entry.id, partnerEntry: entry, partnerLedgerTotals: totals,
        partnerDisplayOnly: true, partnerRemittance: remittance,
      }]);
      continue;
    }
    if (entry.type === 'settlement') continue;
    if (![3, 4].includes(entry.calculationVersion)) {
      const originals = documents.filter(row => (entry.documentIds || []).includes(row.id) || entry.transactionId && row.transactionId === entry.transactionId);
      if (!originals.length) continue;
      const ledger = [entry, ...(partner.entries || []).filter(row => row.linkedEntryId === entry.id)];
      const totals = Object.fromEntries(['goldDebit', 'goldCredit', 'tomanDebit', 'tomanCredit'].map(key => [key, roundLedger(ledger.reduce((sum, row) => sum + number(row[key]), 0))]));
      totals.netGold = roundLedger(totals.goldDebit - totals.goldCredit);
      totals.netToman = roundLedger(totals.tomanDebit - totals.tomanCredit);
      totals.amount = originals.reduce((sum, row) => sum + invoiceRowAmount(row), 0);
      for (const row of originals) byId.set(String(row.id), { ...row, partnerId: partner.id, partnerEntryId: entry.id, partnerEntry: entry, partnerLedgerTotals: totals });
      continue;
    }
    if (!entry.transactionId || !entry.lines?.length) continue;
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
    if (entry.calculationVersion === 4) totals.amount = totals.netGold * rate + totals.netToman;
    projected.set(String(entry.transactionId), entry.lines.map((line, index) => {
      const original = byId.get(String(line.documentId));
      const remittance = line.category === 'remittance';
      return {
        ...(original || line),
        galleryName: entry.galleryName || original?.galleryName,
        id: original?.id || `partner-entry-${entry.id}-line-${index + 1}`,
        ...(original ? {} : { partnerDisplayOnly: true }),
        transactionId: entry.transactionId, invoiceNumber: entry.invoiceNumber, invoiceLine: index + 1,
        invoiceLineCount: entry.lines.length, date: entry.date, invoiceTime: entry.invoiceTime, createdAt: entry.createdAt, recordedAt: original?.recordedAt || entry.createdAt,
        counterpartyType: 'partner', partnerId: partner.id, customerId: partner.id, customerName: partner.name,
        partnerEntryId: entry.id, partnerEntry: entry, partnerLedgerTotals: totals,
        externalInvoiceNumber: entry.externalInvoiceNumber, calculationVersion: entry.calculationVersion,
        ...(remittance ? { category: 'remittance', type: 'partner-remittance', typeLabel: 'حواله همکار',
          direction: line.remittanceDirection === 'debit' ? 'بدهکار' : 'بستانکار', itemName: line.note || 'حواله طلای ۷۵۰',
          itemSummary: [line.counterpartyName, line.reference].filter(Boolean).join(' · '), amount: line.amount ?? (line.settlementUnit === 'toman' ? number(line.tomanAmount) : number(line.goldAmount) * rate) } : {}),
      };
    }));
  }
  const emitted = new Set();
  const rows = documents.flatMap(row => {
    const key = String(row.transactionId);
    if (!projected.has(key)) return [byId.get(String(row.id)) || row];
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
    const mixedCustomer = first.settlementVersion === 3;
    const saleTotal = rows.filter(row => String(row.type).endsWith('-sale')).reduce((sum, row) => sum + invoiceRowAmount(row), 0);
    const purchaseTotal = rows.filter(row => String(row.type).endsWith('-purchase')).reduce((sum, row) => sum + invoiceRowAmount(row), 0);
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
      direction: mixedCustomer ? 'ترکیبی' : first.direction || (String(first.type).endsWith('-sale') ? 'فروش' : String(first.type).endsWith('-purchase') ? 'خرید' : ''),
      createdAt: first.createdAt,
      recordedAt: first.recordedAt,
      invoiceTime: first.invoiceTime,
      amount: mixedCustomer ? saleTotal - purchaseTotal : rows.reduce((sum, row) => sum + invoiceRowAmount(row), 0),
      ...(mixedCustomer ? { saleTotal, purchaseTotal } : {}),
      rialDebt: rows.reduce((sum, row) => sum + number(row.rialDebt), 0),
      gramDebt: rows.reduce((sum, row) => sum + number(row.gramDebt), 0),
      ...(partnerEntry && partnerTotals ? {
        typeLabel: partnerEntry.type === 'settlement' ? first.typeLabel : 'سند همکار',
        direction: first.partnerRemittance ? first.direction : partnerEntry.type === 'mixed' ? 'ترکیبی' : partnerEntry.type === 'sale' ? 'فروش' : 'خرید',
        partnerId: first.partnerId, partnerEntryId: partnerEntry.id, partnerEntry,
        ...(first.partnerRemittance ? { partnerRemittance: true, remittanceDirection: first.remittanceDirection } : {}),
        ...partnerTotals, gramDebt: partnerTotals.netGold, rialDebt: partnerTotals.netToman,
      } : {}),
      ...([1, 3].includes(first.settlementVersion) ? {
        settlementVersion: first.settlementVersion, cashPaid: number(first.cashPaid),
        settlementGoldPrice: number(first.settlementGoldPrice),
        settlementRemainder: number(first.settlementRemainder),
      } : {}),
    };
  });
}
