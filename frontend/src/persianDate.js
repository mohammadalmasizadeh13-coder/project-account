// Calendar-only values remain ISO YYYY-MM-DD in storage. UTC conversion avoids
// moving the date when the browser runs in a different time zone.
const DAY_MS = 86_400_000;
const persianParts = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', {
  timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
});
const persianDisplay = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
});
const persianLongDisplay = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  timeZone: 'UTC', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
});
const tehranDay = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
  timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function normalizeDigits(value) {
  return String(value ?? '').replace(/[۰-۹٠-٩]/g, digit => String(digit.charCodeAt(0) - (digit >= '۰' ? 1776 : 1632)));
}

export function toPersianDigits(value) {
  return String(value ?? '').replace(/[0-9]/g, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
}

function utcDate(year, month, day) {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function readIso(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = utcDate(year, month, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

function calendarParts(formatter, date) {
  const parts = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type === 'year' || part.type === 'month' || part.type === 'day') parts[part.type] = Number(part.value);
  }
  return parts;
}

function pad(value, length = 2) {
  return String(value).padStart(length, '0');
}

/** Return YYYY/MM/DD using Latin digits, or '' for an invalid ISO date. */
export function isoToPersian(value) {
  const date = readIso(value);
  if (!date) return '';
  const { year, month, day } = calendarParts(persianParts, date);
  if (year < 1) return '';
  return `${pad(year, 4)}/${pad(month)}/${pad(day)}`;
}

/**
 * Parse a real Persian calendar date into ISO YYYY-MM-DD, or '' if invalid.
 * Accept Persian/Arabic/Latin digits, YYYY/M/D or YYYYMMDD. The four-digit
 * Persian year must be 0001..9377 so the ISO storage year stays four digits.
 * Binary search uses the browser's Persian calendar, including leap years,
 * rather than a repeating 33-year approximation.
 */
export function persianToIso(value) {
  let normalized = normalizeDigits(value).trim().replace(/[\u200e\u200f\u061c]/g, '');
  if (/^\d{8}$/.test(normalized)) normalized = `${normalized.slice(0, 4)}/${normalized.slice(4, 6)}/${normalized.slice(6)}`;
  const match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(normalized);
  if (!match) return '';
  const [, year, month, day] = match.map(Number);
  if (year < 1 || year > 9377 || month < 1 || month > 12 || day < 1 || day > (month <= 6 ? 31 : 30)) return '';
  const target = year * 10_000 + month * 100 + day;
  let lower = Math.floor(utcDate(year + 621, 1, 1).getTime() / DAY_MS);
  let upper = Math.floor(utcDate(year + 622, 12, 31).getTime() / DAY_MS);
  while (lower <= upper) {
    const middle = Math.floor((lower + upper) / 2);
    const date = new Date(middle * DAY_MS);
    const actual = calendarParts(persianParts, date);
    const actualValue = actual.year * 10_000 + actual.month * 100 + actual.day;
    if (actualValue === target) return date.toISOString().slice(0, 10);
    if (actualValue < target) lower = middle + 1;
    else upper = middle - 1;
  }
  return '';
}

/** Numeric Persian date suitable for tables; invalid or absent values show —. */
export function formatPersianDate(value) {
  const date = readIso(value);
  return date ? persianDisplay.format(date) : '—';
}

export function formatPersianDateLong(value) {
  const date = readIso(value);
  return date ? persianLongDisplay.format(date) : '';
}

/** Date at an instant in Tehran, independent of the operating-system zone. */
export function todayInTehran(instant = new Date()) {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (!Number.isFinite(date.getTime())) return '';
  const { year, month, day } = calendarParts(tehranDay, date);
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}
