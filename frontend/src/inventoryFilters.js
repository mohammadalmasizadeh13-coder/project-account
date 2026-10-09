import { currencyName, documentBreakdown } from './assets.js';
import { craftedKind } from './crmAnalytics.js';
import { stockCategories } from './inventory.js';
import { normalizeDigits } from './persianDate.js';
import { coinSpec, isOrdinaryCoin } from './coins.js';

export const defaultVaultFilters = Object.freeze({
  query: '', category: 'all', status: 'available', craftedKind: 'all', coinType: 'all', currencyType: 'all',
  minPrice: '', maxPrice: '', minWeight: '', maxWeight: '',
});

// Use exactly the price displayed on the collapsed item, regardless of its lot size.
export const inventoryUnitPrice = (item, prices = {}) => documentBreakdown({
  ...item, itemCount: 1, coinCount: 1, currencyAmount: 1,
}, prices).total;

const displayedPrice = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3, useGrouping: false });

const normalizeText = value => normalizeDigits(value)
  .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک')
  .replace(/[\u200c-\u200f\u202a-\u202e\u2066-\u2069]/g, '').toLowerCase();

function parseBound(value) {
  const raw = normalizeDigits(value).trim().replace(/٫/g, '.');
  if (!raw) return null;
  // Group separators must separate groups of three digits; malformed values
  // must never become a different, apparently valid budget or weight.
  if (!/^(?:(?:\d+|\d{1,3}(?:[,٬\s]\d{3})+)(?:\.\d*)?|\.\d+)$/.test(raw)) return NaN;
  const parsed = Number(raw.replace(/[,٬\s]/g, ''));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : NaN;
}

function itemUnitWeight(item) {
  if (item.category === 'coin' && isOrdinaryCoin(item)) return coinSpec(item).weight;
  const value = item.category === 'crafted' ? item.weight
    : item.category === 'melted' ? item.meltedWeight
      : item.category === 'coin' && item.coinType === 'پارسیان' ? item.parsianWeight : null;
  const parsed = parseBound(value);
  return parsed !== null && Number.isFinite(parsed) ? parsed : null;
}

function searchableText(item) {
  const fields = [item.productCode, item.itemName, item.description, stockCategories[item.category],
    item.category === 'crafted' ? craftedKind(item) : null, item.coinType, item.currencyType,
    item.setName, item.setKind,
    item.category === 'currency' ? currencyName(item.currencyType) : null,
    item.assayCode, item.laboratoryName, item.note];
  return fields.filter(value => value !== null && value !== undefined)
    .map(value => normalizeText(value).replace(/\s+/g, '')).join(' ');
}

export function filterInventoryItems(items, filters = {}, prices = {}) {
  const selected = { ...defaultVaultFilters, ...filters };
  const bounds = {};
  const errors = {};
  for (const field of ['minPrice', 'maxPrice', 'minWeight', 'maxWeight']) {
    bounds[field] = parseBound(selected[field]);
    if (Number.isNaN(bounds[field])) errors[field] = 'عدد معتبر و صفر یا بیشتر وارد کنید.';
  }
  for (const [min, max, label] of [['minPrice', 'maxPrice', 'قیمت'], ['minWeight', 'maxWeight', 'وزن']]) {
    if (bounds[min] !== null && bounds[max] !== null && bounds[min] > bounds[max]) {
      errors[min] = `حداقل ${label} نباید بیشتر از حداکثر باشد.`;
      errors[max] = `حداکثر ${label} نباید کمتر از حداقل باشد.`;
    }
  }
  if (Object.keys(errors).length) return { items: [], errors };

  const terms = normalizeText(selected.query).trim().split(/\s+/).filter(Boolean);
  const hasPrice = bounds.minPrice !== null || bounds.maxPrice !== null;
  const hasWeight = bounds.minWeight !== null || bounds.maxWeight !== null;
  const within = (value, min, max) => (min === null || value >= min) && (max === null || value <= max);
  const matches = items.filter(item => {
    if (selected.category !== 'all' && item.category !== selected.category) return false;
    if (selected.status === 'available' && !(item.remaining > 0)) return false;
    if (selected.status === 'empty' && !(item.remaining <= 0)) return false;
    if (selected.craftedKind !== 'all' && (item.category !== 'crafted'
      || (craftedKind(item) !== selected.craftedKind && item.setKind !== selected.craftedKind))) return false;
    if (selected.coinType !== 'all' && (item.category !== 'coin' || normalizeText(item.coinType) !== normalizeText(selected.coinType))) return false;
    if (selected.currencyType !== 'all' && (item.category !== 'currency' || normalizeText(item.currencyType) !== normalizeText(selected.currencyType))) return false;
    // Compare the price customers can read on the item, including its displayed
    // precision, so binary arithmetic cannot exclude an equal inclusive bound.
    if (hasPrice && !within(Number(displayedPrice.format(inventoryUnitPrice(item, prices))), bounds.minPrice, bounds.maxPrice)) return false;
    if (hasWeight) {
      const weight = itemUnitWeight(item);
      if (weight === null || !within(weight, bounds.minWeight, bounds.maxWeight)) return false;
    }
    if (terms.length) {
      const text = searchableText(item);
      if (!terms.every(term => text.includes(term))) return false;
    }
    return true;
  });
  return { items: matches, errors };
}

// Display only matching rows, but retain the full group for a joint sale. This
// prevents a search or budget filter from silently changing the pieces sold.
export function inventoryDisplayGroups(visibleItems, allItems) {
  const setIdOf = item => item.category === 'crafted' && item.setMode === 'separate' && item.setId;
  const members = new Map();
  for (const item of allItems) {
    const setId = setIdOf(item);
    if (!setId) continue;
    if (!members.has(setId)) members.set(setId, []);
    members.get(setId).push(item);
  }
  const groups = [], bySet = new Map();
  for (const item of visibleItems) {
    const setId = setIdOf(item);
    if (!setId) { groups.push({ key: `item:${item.id}`, item }); continue; }
    let group = bySet.get(setId);
    if (!group) {
      const all = members.get(setId) || [item];
      group = { key: `set:${setId}`, setId, setName: item.setName || item.setKind || 'مجموعه', setKind: item.setKind || 'ست',
        items: [], allItems: all, availableItems: all.filter(member => member.remaining > 0),
        totalPieces: Math.max(all.length, ...all.map(member => Number(member.setPieceCount) || 0)) };
      bySet.set(setId, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}
