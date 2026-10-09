import { normalizeDigits } from './persianDate.js';

const number = value => {
  const parsed = Number(normalizeDigits(value ?? '').replace(/[٬,\s]/g, '').replace(/٫/g, '.'));
  return Number.isFinite(parsed) ? parsed : 0;
};

// Prices and fixed profit are stored in tomans; weights are per coin.
export const coinOptions = [
  { name: 'امامی بانکی ۸۶', group: 'bank', price: 'bankEmami86Price' },
  { name: 'نیم سکه بانکی ۸۶', group: 'bank', price: 'bankHalf86Price' },
  { name: 'ربع سکه بانکی ۸۶', group: 'bank', price: 'bankQuarter86Price' },
  { name: 'سکه یک گرمی بانکی ۸۶', group: 'bank', price: 'bankOneGram86Price' },
  { name: 'تمام عادی', group: 'ordinary', weight: 8.133, ayar: 900 },
  { name: 'نیم عادی', group: 'ordinary', weight: 4.066, ayar: 900 },
  { name: 'ربع عادی', group: 'ordinary', weight: 2.022, ayar: 900 },
  { name: 'پارسیان', group: 'ordinary', custom: true },
  { name: 'گل رز', group: 'ordinary', custom: true },
  { name: 'سایر', group: 'ordinary', custom: true },
];
export const legacyCoinOptions = [
  { name: 'امامی', price: 'emamiCoinPrice' },
  { name: 'تمام', price: 'tamamCoinPrice' },
  { name: 'نیم', price: 'halfCoinPrice' },
  { name: 'ربع', price: 'quarterCoinPrice' },
];
export const isModernCoin = row => Number(row?.coinPricingVersion) === 2;
export const isOrdinaryCoin = row => isModernCoin(row) && coinOptions.some(coin => coin.name === row.coinType && coin.group === 'ordinary');
export const coinOptionsFor = row => {
  const legacy = legacyCoinOptions.find(coin => coin.name === row?.coinType);
  return legacy ? [...coinOptions, legacy] : coinOptions;
};

export function coinSpec(row) {
  if (!isOrdinaryCoin(row)) return { weight: 0, ayar: 0, weight750: 0 };
  const definition = coinOptions.find(coin => coin.name === row.coinType);
  const weight = definition.custom ? number(row.coinWeight) : definition.weight;
  const ayar = definition.custom ? number(row.coinAyar) : definition.ayar;
  return { weight, ayar, weight750: weight * ayar / 750 };
}

export function selectCoin(type, prices = {}) {
  const definition = coinOptions.find(coin => coin.name === type) || coinOptions[0];
  const row = { coinPricingVersion: 2, coinGroup: definition.group, coinType: definition.name,
    coinWeight: definition.weight === undefined ? '' : String(definition.weight),
    coinAyar: definition.ayar === undefined ? '' : String(definition.ayar),
    coinPrice: definition.price ? String(prices[definition.price] || '') : '',
    gramPrice: String(prices.goldGramPrice || prices.gold18Price || ''), parsianWeight: '', parsianPrice: '',
  };
  return { ...row, coinWeight750: coinSpec(row).weight750 };
}

export function coinSummary(row) {
  if (!isOrdinaryCoin(row)) return row?.coinType || '';
  const { weight, ayar, weight750 } = coinSpec(row);
  const format = value => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 6 }).format(value);
  return `${row.coinType} · ترازو ${format(weight)} گرم · عیار ${format(ayar)} · معادل ۷۵۰: ${format(weight750)} گرم`;
}

export function coinBase(row, prices = null) {
  const count = number(row.coinCount ?? 1);
  if (isOrdinaryCoin(row)) return count * coinSpec(row).weight750 * (number(prices?.goldGramPrice ?? prices?.gold18Price) || number(row.gramPrice));
  if (!isModernCoin(row) && row.coinType === 'پارسیان') return count * number(row.parsianPrice);
  const definition = [...coinOptions, ...legacyCoinOptions].find(coin => coin.name === row.coinType);
  return count * (number(prices?.[definition?.price]) || number(row.coinPrice));
}
