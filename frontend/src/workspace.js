import { documentBreakdown, number, quantity } from './assets.js';
import { dateBefore, iranDate } from './sales.js';
import { isoToPersian, persianToIso } from './persianDate.js';

export const workspaceSections = { home: 'صفحه اصلی', entries: 'ثبت‌ها', reports: 'گزارشات فروشگاه', crm: 'CRM و مشتریان' };
export const toolSections = {
  home: 'home', entries: 'entries', register: 'entries', opening: 'entries', cheques: 'entries', pricing: 'entries', 'gold-entry': 'entries', 'customer-entry': 'entries', 'settlement-entry': 'entries',
  reports: 'reports', dashboard: 'reports', products: 'reports', profit: 'reports', balance: 'reports', rates: 'reports', 'customer-reports': 'reports', vault: 'reports', search: 'reports', 'cheque-reports': 'reports',
  crm: 'crm', 'crm-occasions': 'crm',
};

export function birthdayReminders(customers, today = iranDate(), horizon = 7) {
  const days = Array.from({ length: horizon + 1 }, (_, offset) => {
    const date = dateBefore(today, -offset);
    const [year, month, day] = isoToPersian(date).split('/').map(Number);
    return { date, offset, year, month, day };
  });
  return customers.flatMap(customer => {
    if (!customer.birthDate || customer.birthDate > today) return [];
    const birth = isoToPersian(customer.birthDate);
    if (!birth) return [];
    const [, month, day] = birth.split('/').map(Number);
    const next = days.find(candidate => candidate.month === month && (candidate.day === day || (month === 12 && day === 30 && candidate.day === 29 && !persianToIso(`${candidate.year}/12/30`))));
    return next ? [{ customer, ...next, leapAdjusted: next.day !== day }] : [];
  }).sort((a, b) => a.offset - b.offset || a.customer.name.localeCompare(b.customer.name, 'fa'));
}

// Historical lot cost, never today's market value. Unlinked sales stay unknown.
export function profitReport(documents, period = 'today', today = iranDate()) {
  const start = dateBefore(today, (period === 'month' ? 30 : period === 'week' ? 7 : 1) - 1);
  const entries = new Map(documents.filter(doc => doc.source === 'opening-inventory' || String(doc.type).endsWith('-purchase')).map(doc => [doc.id, doc]));
  const sales = documents.filter(doc => doc.source !== 'opening-inventory' && (String(doc.type).endsWith('-sale') || doc.direction === 'فروش') && doc.date >= start && doc.date <= today);
  let revenue = 0, cost = 0, unknownRevenue = 0;
  const records = sales.map(sale => {
    const source = entries.get(sale.inventorySourceId);
    const saleAmount = sale.amount === undefined || sale.amount === null || sale.amount === '' ? documentBreakdown(sale).total : number(sale.amount);
    const hasRecordedCost = source && source.amount !== undefined && source.amount !== null && source.amount !== '' && Number.isFinite(Number(source.amount));
    const hasPrice = source && number(source.category === 'crafted' ? source.gramPrice : source.category === 'melted' ? source.meltedGramPrice : source.category === 'currency' ? source.currencyRate : source.coinType === 'پارسیان' ? source.parsianPrice : source.coinPrice) > 0;
    const known = source && source.category === sale.category && quantity(source) > 0 && quantity(sale) > 0 && (hasRecordedCost || hasPrice);
    if (!known) { unknownRevenue += saleAmount; return { sale, revenue: saleAmount, cost: null, profit: null }; }
    const lotCost = hasRecordedCost ? number(source.amount) : documentBreakdown(source).total;
    const allocatedCost = lotCost * quantity(sale) / quantity(source);
    cost += allocatedCost; revenue += saleAmount;
    return { sale, revenue: saleAmount, cost: allocatedCost, profit: saleAmount - allocatedCost };
  });
  const unknown = records.filter(row => row.profit === null).length;
  return { revenue, cost, grossProfit: revenue - cost, unknownRevenue, known: records.length - unknown, unknown, records };
}
