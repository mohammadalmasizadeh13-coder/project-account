import { documentBreakdown, number, quantity } from './assets.js';
import { dateBefore, iranDate } from './sales.js';
import { isoToPersian, normalizeDigits, persianToIso } from './persianDate.js';

export const workspaceSections = { home: 'صفحه اصلی', entries: 'ثبت‌ها', reports: 'گزارشات فروشگاه', crm: 'CRM و مشتریان' };
export const toolSections = {
  home: 'home', entries: 'entries', register: 'entries', expense: 'entries', opening: 'entries', cheques: 'entries', pricing: 'entries', 'gold-entry': 'entries', 'customer-entry': 'entries', 'settlement-entry': 'entries',
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

// Keep historical inventory gains separate from the seller percentage recorded on sales.
// Neither calculation uses today's market value or supplies missing historical rates.
export function profitReport(documents, period = 'today', today = iranDate()) {
  const start = dateBefore(today, (period === 'month' ? 30 : period === 'week' ? 7 : 1) - 1);
  const isExpense = doc => doc.type === 'expense' || doc.category === 'expense';
  const inPeriod = doc => doc.date >= start && doc.date <= today;
  const expenses = documents.filter(doc => isExpense(doc) && inPeriod(doc));
  const expenseTotal = expenses.reduce((sum, doc) => sum + number(doc.amount), 0);
  // Keep the original payment units alongside their saved toman equivalent.
  // Missing units identify old cash expenses; never reprice a saved expense.
  const expenseTotals = { toman: 0, rial: 0, goldWeightGrams: 0, goldGrams750: 0, currencies: {} };
  for (const expense of expenses) {
    const unit = expense.expenseUnit || 'toman';
    const amount = number(expense.expenseUnit ? expense.expenseAmount : expense.amount);
    if (unit === 'toman' || unit === 'rial') expenseTotals[unit] += amount;
    if (unit === 'gold') {
      expenseTotals.goldWeightGrams += amount;
      expenseTotals.goldGrams750 += amount * number(expense.expenseGoldPurity ?? 750) / 750;
    }
    if (unit === 'currency') {
      const currency = expense.expenseCurrency || 'USD';
      expenseTotals.currencies[currency] = number(expenseTotals.currencies[currency]) + amount;
    }
  }
  const entries = new Map(documents.filter(doc => !isExpense(doc) && (doc.source === 'opening-inventory' || String(doc.type).endsWith('-purchase'))).map(doc => [doc.id, doc]));
  const sales = documents.filter(doc => !isExpense(doc) && doc.source !== 'opening-inventory' && (String(doc.type).endsWith('-sale') || doc.direction === 'فروش') && inPeriod(doc));
  let revenue = 0, cost = 0, unknownRevenue = 0;
  let sellerProfit = 0, discounts = 0, sellerProfitKnown = 0;
  const records = sales.map(sale => {
    const source = entries.get(sale.inventorySourceId);
    const breakdown = documentBreakdown(sale);
    const saleAmount = sale.amount === undefined || sale.amount === null || sale.amount === '' ? breakdown.total : number(sale.amount);
    const percentText = normalizeDigits(sale.profitPercent ?? '').replace(/[٬,\s]/g, '').replace(/٫/g, '.');
    const hasRecordedBase = breakdown.base > 0 && quantity(sale) > 0;
    const hasSellerProfit = percentText !== '' && Number.isFinite(Number(percentText)) && Number(percentText) >= 0 && (Number(percentText) === 0 || hasRecordedBase);
    const recordedSellerProfit = hasSellerProfit ? breakdown.profit : null;
    // Older invoices allowed oversized discounts but clamped the final amount to zero.
    // Preserve the entered discount while counting only the amount actually applied.
    const discount = hasRecordedBase ? Math.min(breakdown.discount, Math.max(0, breakdown.base + breakdown.wage + breakdown.costs + breakdown.profit)) : breakdown.discount;
    const sellerFields = { sellerProfit: recordedSellerProfit, discount, recordedDiscount: breakdown.discount, sellerProfitAfterDiscount: hasSellerProfit ? recordedSellerProfit - discount : null };
    discounts += discount;
    if (hasSellerProfit) { sellerProfit += recordedSellerProfit; sellerProfitKnown += 1; }
    const hasRecordedCost = source && source.amount !== undefined && source.amount !== null && source.amount !== '' && Number.isFinite(Number(source.amount));
    const hasPrice = source && number(source.category === 'crafted' ? source.gramPrice : source.category === 'melted' ? source.meltedGramPrice : source.category === 'currency' ? source.currencyRate : source.coinType === 'پارسیان' ? source.parsianPrice : source.coinPrice) > 0;
    const known = source && source.category === sale.category && quantity(source) > 0 && quantity(sale) > 0 && (hasRecordedCost || hasPrice);
    if (!known) { unknownRevenue += saleAmount; return { sale, revenue: saleAmount, cost: null, profit: null, ...sellerFields }; }
    const lotCost = hasRecordedCost ? number(source.amount) : documentBreakdown(source).total;
    const allocatedCost = lotCost * quantity(sale) / quantity(source);
    cost += allocatedCost; revenue += saleAmount;
    return { sale, revenue: saleAmount, cost: allocatedCost, profit: saleAmount - allocatedCost, ...sellerFields };
  });
  const unknown = records.filter(row => row.profit === null).length;
  return {
    revenue, cost, grossProfit: revenue - cost, unknownRevenue, known: records.length - unknown, unknown, records,
    sellerProfit, discounts, expenses, expenseTotal, expenseTotals, netSellerProfit: sellerProfit - discounts - expenseTotal,
    sellerProfitKnown, sellerProfitUnknown: records.length - sellerProfitKnown,
  };
}
