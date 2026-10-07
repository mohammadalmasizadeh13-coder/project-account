import { number, quantity } from './assets.js';

export const isMiscPurchase = record => (typeof record === 'string' ? record : record?.type) === 'misc-purchase';

export const miscGoldDefaults = () => ({
  craftedKind: 'سایر', itemCount: '1', ayar: '750',
  wagePercent: '0', wageFixed: '0', otherCosts: '0', profitPercent: '0',
});

// Preserve the scale weight and purity; conversion is a derived per-unit value.
export function miscGoldWeight750(record) {
  const weight = number(record?.weight);
  const purity = number(record?.ayar);
  return weight > 0 && purity >= 1 && purity <= 1000 ? weight * purity / 750 : 0;
}

const format = value => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 6 }).format(value);
export function miscGoldSummary(record) {
  if (!isMiscPurchase(record)) return '';
  const count = quantity({ ...record, category: 'crafted' });
  return `طلای متفرقه · وزن ترازو ${format(number(record.weight) * count)} گرم · عیار ${format(number(record.ayar))} · وزن معادل ۷۵۰: ${format(miscGoldWeight750(record) * count)} گرم`;
}
