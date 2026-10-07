import { newRecordTimestamp } from './recordTime.js';

export function customerItemName(document, inventorySource) {
  return [document.itemName, inventorySource?.itemName, document.description, inventorySource?.description, document.typeLabel]
    .map(value => String(value || '').trim()).find(Boolean) || 'نام جنس ثبت نشده';
}

export function customerTransactions(customer, documents) {
  return documents.filter(doc => doc.source !== 'opening-inventory' && doc.counterpartyType !== 'partner' && (doc.customerId ? doc.customerId === customer.id : doc.customerName?.trim() === customer.name.trim()))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

export function customerSummary(customer, documents) {
  const transactions = customerTransactions(customer, documents);
  const purchases = transactions.filter(doc => doc.direction === 'فروش' || String(doc.type).endsWith('-sale'));
  const sales = transactions.filter(doc => doc.direction === 'خرید' || String(doc.type).endsWith('-purchase'));
  const total = items => items.reduce((sum, doc) => sum + (Number(doc.amount) || 0), 0);
  return { transactions, purchases, sales, purchased: total(purchases), sold: total(sales), lastVisit: transactions[0]?.date || '' };
}

export function settleCustomer(customer, { rialAmount, gramAmount, direction, date, note }, id = crypto.randomUUID(), now = new Date()) {
  if (![rialAmount, gramAmount].every(value => Number.isFinite(value) && value >= 0) || !(rialAmount || gramAmount)) throw new Error('مبلغ یا وزن معتبر وارد کنید.');
  if (!['received', 'paid'].includes(direction)) throw new Error('نوع تسویه معتبر نیست.');
  const sign = direction === 'received' ? -1 : 1;
  const recordedAt = newRecordTimestamp(now);
  return { ...customer, rialDebt: (Number(customer.rialDebt) || 0) + sign * rialAmount, gramDebt: (Number(customer.gramDebt) || 0) + sign * gramAmount,
    settlements: [{ id, rialAmount, gramAmount, direction, date, note, createdAt: recordedAt, recordedAt }, ...(customer.settlements || [])], updatedAt: recordedAt };
}
