import { emptyWorkspace, storageFields } from './ownerStorage.js';

export const MAX_LEGACY_BYTES = 5 * 1024 * 1024;
const recordFields = ['documents', 'customers', 'partners', 'goldPurchases', 'cheques'];
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function normalizeLegacyUsername(value) {
  return String(value ?? '').normalize('NFKC').replace(/[يى]/g, 'ی').replace(/ك/g, 'ک')
    .replace(/[\s\u200c\u200d\u200e\u200f]+/g, ' ').trim();
}

function actualUsernames(storage) {
  const usernames = new Set();
  const prefixes = Object.keys(storageFields).map(key => `${key}:`);
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    const prefix = prefixes.find(candidate => key?.startsWith(candidate));
    if (prefix && key.length > prefix.length) usernames.add(key.slice(prefix.length));
  }
  return [...usernames];
}

function hasMeaningfulValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (isObject(value)) return Object.values(value).some(hasMeaningfulValue);
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  if (typeof value === 'string') return value.trim() !== '' && !/^0+(?:\.0+)?$/.test(value.trim());
  return value === true;
}

export function validateLegacyWorkspace(input) {
  const source = isObject(input) && Object.hasOwn(input, 'data') ? input.data : input;
  if (!isObject(source) || !Object.keys(source).some(key => Object.values(storageFields).includes(key))) {
    throw new Error('فایل شامل اطلاعات معتبر حسابداری نیست. نسخهٔ پشتیبان حسابداری را انتخاب کنید.');
  }
  if (Object.keys(source).some(key => !Object.values(storageFields).includes(key))) {
    throw new Error('فایل دارای بخش‌های ناشناخته است؛ نسخهٔ پشتیبان سازگار حسابداری را انتخاب کنید.');
  }
  const data = emptyWorkspace();
  for (const field of Object.values(storageFields)) {
    if (!Object.hasOwn(source, field)) continue;
    const value = source[field];
    if (recordFields.includes(field)) {
      if (!Array.isArray(value) || value.length > 50000 || value.some(record => !isObject(record))) {
        throw new Error('ساختار فهرست اسناد، مشتریان یا چک‌ها معتبر نیست؛ اطلاعات اصلی حفظ شده است.');
      }
    } else if (!isObject(value)) {
      throw new Error('ساختار تنظیمات حسابداری معتبر نیست؛ اطلاعات اصلی حفظ شده است.');
    }
    data[field] = structuredClone(value);
  }
  const ids = new Set();
  for (const document of data.documents) {
    const id = document.id;
    if (!((typeof id === 'string' && id.trim()) || (typeof id === 'number' && Number.isSafeInteger(id))) || String(id).length > 200 || ids.has(String(id))) {
      throw new Error('شناسهٔ یکی از اسناد خالی، نامعتبر یا تکراری است؛ انتقال متوقف شد و اطلاعات اصلی حفظ شده است.');
    }
    ids.add(String(id));
  }
  let serialized;
  try {
    serialized = JSON.stringify(data, (key, value) => {
      if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Invalid number');
      return value;
    });
  } catch {
    throw new Error('ساختار اطلاعات قابل ذخیره‌سازی نیست.');
  }
  if (new TextEncoder().encode(serialized).length > MAX_LEGACY_BYTES) {
    throw new Error('حجم اطلاعات بیشتر از ۵ مگابایت است؛ انتقال انجام نشد و نسخهٔ اصلی محفوظ است.');
  }
  return data;
}

export function readLegacyWorkspace(storage, username) {
  const names = actualUsernames(storage);
  let actual = names.find(name => name === username);
  if (actual === undefined) {
    const matches = names.filter(name => normalizeLegacyUsername(name) === normalizeLegacyUsername(username));
    if (matches.length > 1) throw new Error('چند حساب با نام مشابه پیدا شد؛ نام دقیق حساب را از فهرست انتخاب کنید.');
    actual = matches[0];
  }
  if (actual === undefined) return null;
  const source = {};
  for (const [base, field] of Object.entries(storageFields)) {
    const value = storage.getItem(`${base}:${actual}`);
    if (value === null) continue;
    try { source[field] = JSON.parse(value); } catch {
      throw new Error('بخشی از اطلاعات قدیمی خوانا نیست؛ انتقال متوقف شد و نسخهٔ اصلی تغییر نکرد.');
    }
  }
  return Object.keys(source).length ? validateLegacyWorkspace(source) : null;
}

export function findLegacyAccounts(storage) {
  return actualUsernames(storage).map(username => {
    try {
      const data = readLegacyWorkspace(storage, username);
      const hasRecords = recordFields.some(field => data?.[field]?.length > 0);
      return {
        username, valid: true, error: '',
        documentCount: data?.documents.length || 0, customerCount: data?.customers.length || 0,
        goldPurchaseCount: data?.goldPurchases.length || 0, chequeCount: data?.cheques.length || 0,
        hasRecords, hasData: hasRecords || hasMeaningfulValue(data?.prices) || hasMeaningfulValue(data?.openingSetup),
      };
    } catch (error) {
      return { username, valid: false, error: error.message, documentCount: 0, customerCount: 0, goldPurchaseCount: 0, chequeCount: 0, hasRecords: false, hasData: false };
    }
  }).sort((left, right) => Number(right.hasRecords) - Number(left.hasRecords) || left.username.localeCompare(right.username, 'fa'));
}

export function matchingLegacyAccount(storage, currentUsername) {
  const accounts = findLegacyAccounts(storage);
  const exact = accounts.find(account => account.username === currentUsername);
  if (exact) return exact;
  const matches = accounts.filter(account => normalizeLegacyUsername(account.username) === normalizeLegacyUsername(currentUsername));
  return matches.length === 1 ? matches[0] : null;
}
