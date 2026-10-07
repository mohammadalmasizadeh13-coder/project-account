import { craftedKinds } from './crmAnalytics.js';

export const storefrontCraftedKinds = craftedKinds;
export const emptyStorefrontFilters = () => ({
  minWeight: '', maxWeight: '', minPrice: '', maxPrice: '',
  minWagePercent: '', maxWagePercent: '', craftedKind: '',
});

export const storefrontRanges = [
  { key: 'weight', title: 'وزن کار', unit: 'گرم', minimum: 'minWeight', maximum: 'maxWeight', limit: 100000, placeholders: ['مثلاً ۱', 'مثلاً ۱۰'] },
  { key: 'price', title: 'قیمت نهایی', unit: 'تومان', minimum: 'minPrice', maximum: 'maxPrice', limit: Number.MAX_SAFE_INTEGER, placeholders: ['مثلاً ۵٬۰۰۰٬۰۰۰', 'مثلاً ۳۰٬۰۰۰٬۰۰۰'] },
  { key: 'wage-percent', title: 'اجرت ساخت', unit: 'درصد', minimum: 'minWagePercent', maximum: 'maxWagePercent', limit: 100, placeholders: ['مثلاً ۰', 'مثلاً ۷'] },
];

export function parseStorefrontNumber(value) {
  const raw = String(value ?? '').replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/٫/g, '.').replace(/[٬،]/g, ',').trim();
  if (!raw) return '';
  const plain = /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw);
  const grouped = /^\d{1,3}(?:(?:,|\s+)\d{3})+(?:\.\d*)?$/.test(raw);
  if (!plain && !grouped) return null;
  const parsed = Number(raw.replace(/[,\s]/g, ''));
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= Number.MAX_SAFE_INTEGER ? String(parsed) : null;
}

export function validateStorefrontFilters(draft) {
  const filters = emptyStorefrontFilters();
  const errors = {};
  for (const range of storefrontRanges) {
    for (const field of [range.minimum, range.maximum]) {
      const parsed = parseStorefrontNumber(draft[field]);
      if (parsed === null || (parsed !== '' && Number(parsed) > range.limit)) {
        errors[field] = range.key === 'wage-percent' ? 'اجرت باید عددی از صفر تا صد باشد.'
          : range.key === 'weight' ? 'وزن را از صفر تا ۱۰۰٬۰۰۰ گرم وارد کنید.'
            : 'قیمت را به‌صورت عدد معتبر و غیرمنفی وارد کنید.';
      } else filters[field] = parsed;
    }
    if (!errors[range.minimum] && !errors[range.maximum] && filters[range.minimum] !== '' && filters[range.maximum] !== '' && Number(filters[range.minimum]) > Number(filters[range.maximum])) {
      errors[range.maximum] = 'حداکثر باید بیشتر یا برابر حداقل باشد.';
    }
  }
  if (draft.craftedKind && !craftedKinds.includes(draft.craftedKind)) errors.craftedKind = 'نوع کار را از فهرست انتخاب کنید.';
  else filters.craftedKind = draft.craftedKind || '';
  return { filters, errors };
}

export function storefrontFilterCount(filters) {
  return storefrontRanges.filter(range => filters[range.minimum] !== '' || filters[range.maximum] !== '').length + Number(Boolean(filters.craftedKind));
}

export function storefrontQuery({ query = '', category = '', sort = 'newest', filters = emptyStorefrontFilters() } = {}) {
  const parameters = new URLSearchParams();
  if (query.trim()) parameters.set('q', query.trim());
  if (category) parameters.set('category', category);
  const fields = {
    minWeight: 'min_weight', maxWeight: 'max_weight', minPrice: 'min_price', maxPrice: 'max_price',
    minWagePercent: 'min_wage_percent', maxWagePercent: 'max_wage_percent', craftedKind: 'crafted_kind',
  };
  for (const [field, parameter] of Object.entries(fields)) {
    if (filters[field] !== '' && filters[field] !== undefined && filters[field] !== null) parameters.set(parameter, filters[field]);
  }
  parameters.set('sort', sort);
  return parameters.toString();
}
