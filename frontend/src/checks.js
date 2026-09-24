import { iranDate } from './sales.js';

export const chequeStatuses = { pending: 'در انتظار', cleared: 'پاس‌شده', bounced: 'برگشتی', cancelled: 'لغوشده' };
export const chequeDirections = { received: 'دریافتی', issued: 'پرداختی' };

export function normalizeChequeText(value) {
  return String(value ?? '').replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\s+/g, ' ').trim();
}

export function isChequeDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function chequeDaysUntilDue(dueDate, today = iranDate()) {
  if (!isChequeDate(dueDate) || !isChequeDate(today)) return null;
  return Math.round((Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
}

export function isOutstandingCheque(cheque) {
  return cheque.status === 'pending' || cheque.status === 'bounced';
}

export function getChequeReminders(cheques = [], today = iranDate()) {
  const items = cheques.filter(isOutstandingCheque).map(cheque => {
    const daysUntilDue = chequeDaysUntilDue(cheque.dueDate, today);
    return { ...cheque, daysUntilDue, urgency: daysUntilDue < 0 ? 'overdue' : daysUntilDue === 0 ? 'today' : 'upcoming' };
  }).filter(cheque => cheque.daysUntilDue !== null && cheque.daysUntilDue <= 3)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || String(a.id).localeCompare(String(b.id)));
  return {
    items, total: items.length,
    overdue: items.filter(cheque => cheque.urgency === 'overdue').length,
    today: items.filter(cheque => cheque.urgency === 'today').length,
    upcoming: items.filter(cheque => cheque.urgency === 'upcoming').length,
    receivedAmount: items.filter(cheque => cheque.direction === 'received').reduce((sum, cheque) => sum + cheque.amount, 0),
    issuedAmount: items.filter(cheque => cheque.direction === 'issued').reduce((sum, cheque) => sum + cheque.amount, 0),
  };
}

export function chequeSummary(cheques = [], today = iranDate()) {
  const outstanding = cheques.filter(isOutstandingCheque);
  const summarize = direction => {
    const records = outstanding.filter(cheque => cheque.direction === direction);
    return { count: records.length, amount: records.reduce((sum, cheque) => sum + cheque.amount, 0) };
  };
  return { received: summarize('received'), issued: summarize('issued'), reminders: getChequeReminders(cheques, today) };
}

export function validateCheque(form, cheques = [], parseNumber = Number) {
  const errors = {};
  const amountText = normalizeChequeText(form.amount).replace(/[,٬\s]/g, '');
  const amount = /^\d+$/.test(amountText) ? parseNumber(amountText) : NaN;
  const record = {
    ...form,
    counterparty: normalizeChequeText(form.counterparty),
    bank: normalizeChequeText(form.bank),
    number: normalizeChequeText(form.number).replace(/\s/g, ''),
    note: String(form.note || '').trim(),
    amount,
  };
  if (!Object.hasOwn(chequeDirections, record.direction)) errors.direction = 'نوع چک را انتخاب کنید.';
  if (!record.counterparty) errors.counterparty = 'نام طرف حساب را وارد کنید.';
  if (!record.bank) errors.bank = 'نام بانک را وارد کنید.';
  if (!/^\d[\d/-]*$/.test(record.number)) errors.number = 'شماره چک را با عدد وارد کنید (خط تیره و / مجاز است).';
  if (!Number.isSafeInteger(amount) || amount <= 0) errors.amount = 'مبلغ را به تومان، با عدد صحیح بزرگ‌تر از صفر وارد کنید.';
  if (!isChequeDate(record.issueDate)) errors.issueDate = 'تاریخ ثبت معتبر وارد کنید.';
  if (!isChequeDate(record.dueDate)) errors.dueDate = 'تاریخ سررسید معتبر وارد کنید.';
  if (!Object.hasOwn(chequeStatuses, record.status)) errors.status = 'وضعیت چک را انتخاب کنید.';
  if (!errors.number && !errors.bank && cheques.some(cheque => cheque.id !== record.id && cheque.direction === record.direction
    && normalizeChequeText(cheque.bank) === record.bank && normalizeChequeText(cheque.number).replace(/\s/g, '') === record.number)) {
    errors.number = 'این شماره چک برای همین بانک و نوع چک قبلاً ثبت شده است.';
  }
  return { errors, record };
}

export function upsertCheque(cheques, form, { parseNumber = Number, now = new Date().toISOString(), id } = {}) {
  const { errors, record } = validateCheque(form, cheques, parseNumber);
  if (Object.keys(errors).length) {
    const error = new Error(Object.values(errors)[0]);
    error.fields = errors;
    throw error;
  }
  const existing = cheques.find(cheque => cheque.id === record.id);
  if (record.id && !existing) throw new Error('چک موردنظر پیدا نشد؛ فهرست را تازه کنید.');
  const saved = { ...existing, ...record, id: existing?.id || id || crypto.randomUUID(), createdAt: existing?.createdAt || now, updatedAt: now };
  return existing ? cheques.map(cheque => cheque.id === existing.id ? saved : cheque) : [saved, ...cheques];
}
