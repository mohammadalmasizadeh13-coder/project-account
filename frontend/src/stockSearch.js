import { normalizeDigits } from './persianDate.js';
import { currencyName } from './assets.js';

export const normalizeStockSearch = value => normalizeDigits(value).normalize('NFKC')
  .replace(/ي|ى/g, 'ی').replace(/ك/g, 'ک').replace(/[\u064B-\u065F\u0670\u0640]/g, '')
  .replace(/[\u200c\u200d\s]+/g, ' ').trim().toLocaleLowerCase('fa-IR');

export function findStockMatches(items, query) {
  const normalized = normalizeStockSearch(query);
  const words = normalized.split(' ').filter(Boolean);
  return items.filter(item => item.remaining > 0).map((item, index) => {
    const name = normalizeStockSearch(item.itemName);
    const text = normalizeStockSearch([item.productCode, item.itemName, item.craftedKind, item.description,
      item.setName, item.setKind, item.assayCode, item.coinType, item.currencyType,
      item.currencyType ? currencyName(item.currencyType) : ''].join(' '));
    return { item, index, text, rank: normalized && name === normalized ? 0 : normalized && name.startsWith(normalized) ? 1 : 2 };
  }).filter(match => words.every(word => match.text.includes(word)))
    .sort((a, b) => a.rank - b.rank || a.index - b.index).map(match => match.item);
}

// Same names can belong to different weights or lots. Only a unique full name
// may select stock automatically; ambiguous names always need an explicit pick.
export function exactStockName(items, query) {
  const name = normalizeStockSearch(query);
  if (!name) return null;
  const matches = items.filter(item => item.remaining > 0 && normalizeStockSearch(item.itemName) === name);
  return matches.length === 1 ? matches[0] : null;
}
