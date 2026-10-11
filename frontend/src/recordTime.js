import { formatPersianDate, isoToPersian, todayInTehran, normalizeDigits } from './persianDate.js';

export function invoiceTimeNow(now = new Date()) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
}

export function validInvoiceTime(value) {
  const time = normalizeDigits(value ?? '').trim();
  if (time && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('ساعت فاکتور را به صورت ساعت و دقیقه وارد کنید.');
  return time;
}

export function ledgerClock(entry) {
  if (entry.invoiceTime) return entry.invoiceTime;
  const created = new Date(entry.createdAt);
  if (!Number.isFinite(created.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3, hourCycle: 'h23' }).format(created);
}

const tehranTime = new Intl.DateTimeFormat('fa-IR', {
  timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

// Only new financial records receive recordedAt. Older createdAt fields may
// describe imports or earlier metadata, so they are never used as a fallback.
export function newRecordTimestamp(now = new Date()) {
  return (now instanceof Date ? now : new Date(now)).toISOString();
}

function registrationDate(record) {
  const value = record?.recordedAt;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !isoToPersian(value.slice(0, 10))) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function formatRecordTimestamp(record) {
  const registered = registrationDate(record);
  if (!registered) return '';
  return `${formatPersianDate(todayInTehran(registered))}، ساعت ${tehranTime.format(registered)}`;
}

export function formatRecordDate(record, dateField = 'date') {
  const businessDate = record?.[dateField];
  const dateLabel = formatPersianDate(businessDate);
  if (record?.invoiceTime && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(record.invoiceTime)) return `${dateLabel}، ساعت ${record.invoiceTime.replace(/\d/g, digit => '۰۱۲۳۴۵۶۷۸۹'[digit])}`;
  const registered = registrationDate(record);
  if (!registered) return dateLabel;
  if (businessDate === todayInTehran(registered)) return `${dateLabel}، ساعت ${tehranTime.format(registered)}`;
  return `${dateLabel} · ثبت: ${formatRecordTimestamp(record)}`;
}
