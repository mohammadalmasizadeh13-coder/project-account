import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultVaultFilters, filterInventoryItems, inventoryDisplayGroups, inventoryUnitPrice } from './inventoryFilters.js';
import { documentBreakdown } from './assets.js';

const ring = { id: 'ring', category: 'crafted', type: 'crafted-purchase', itemName: 'انگشتر نگین‌دار',
  weight: 10, ayar: 750, gramPrice: 10_000_000, itemCount: 3, remaining: 2, productCode: 'ZG-000001' };
const ids = (items, filters, prices) => filterInventoryItems(items, filters, prices).items.map(item => item.id);

test('ring type, price cap and query combine inclusively using each piece rather than the lot', () => {
  const items = [ring, { ...ring, id: 'expensive', weight: 10.1 },
    { ...ring, id: 'bracelet', itemName: 'دستبند', weight: 5 },
    { ...ring, id: 'band', itemName: 'حلقه ساده', weight: 4 },
    { ...ring, id: 'sold', remaining: 0 }];
  assert.deepEqual(ids(items, { craftedKind: 'انگشتر', maxPrice: '۱۰۰٬۰۰۰٬۰۰۰' }), ['ring', 'band']);
  assert.deepEqual(ids(items, { craftedKind: 'انگشتر', maxPrice: '۱۰۰٬۰۰۰٬۰۰۰', query: 'نگین دار' }), ['ring']);
  assert.equal(inventoryUnitPrice(ring), 100_000_000);
  assert.equal(documentBreakdown(ring).total, 300_000_000);
});

test('filter prices include labor, fixed costs and profit and follow live rates with recorded fallback', () => {
  const item = { ...ring, weight: 1, gramPrice: 100, wagePercent: 10, wageFixed: 5, otherCosts: 5, profitPercent: 10 };
  assert.equal(inventoryUnitPrice(item), 132);
  assert.deepEqual(ids([item], { maxPrice: 131 }), []);
  assert.deepEqual(ids([item], { minPrice: 132, maxPrice: 132 }), ['ring']);
  assert.equal(inventoryUnitPrice(item, { goldGramPrice: 200 }), 253);
  assert.deepEqual(ids([item], { maxPrice: 200 }, { goldGramPrice: 200 }), []);
  assert.deepEqual(ids([item], { maxPrice: 200 }, { goldGramPrice: 0 }), ['ring']);
});

test('inclusive price bounds match displayed precision despite decimal weight arithmetic', () => {
  const item = { ...ring, weight: '19.99', gramPrice: 5_000_000 };
  assert.equal(inventoryUnitPrice(item), 99_949_999.99999999, 'public unit price keeps the original accounting precision');
  assert.deepEqual(ids([item], { minPrice: '99950000', maxPrice: '99950000' }), ['ring']);
  assert.deepEqual(ids([item], { maxPrice: '99949999.999' }), []);
  assert.deepEqual(ids([item], { minPrice: '99950000.001' }), []);

  const fractional = { ...ring, weight: 1, gramPrice: 100.0004 };
  assert.deepEqual(ids([fractional], { minPrice: 100, maxPrice: 100 }), ['ring']);
  assert.deepEqual(ids([{ ...fractional, gramPrice: 100.0006 }], { maxPrice: 100 }), []);
});

test('currency and coin price bounds use one unit and Parsian retains its saved price', () => {
  const items = [
    { id: 'usd', category: 'currency', currencyType: 'USD', currencyRate: 100, currencyAmount: 1_000, remaining: 1_000 },
    { id: 'coin', category: 'coin', coinType: 'امامی', coinPrice: 200, coinCount: 10, remaining: 10 },
    { id: 'parsian', category: 'coin', coinType: 'پارسیان', parsianPrice: 50, parsianWeight: 0.5, coinCount: 10, remaining: 10 },
  ];
  const prices = { usdPrice: 110, emamiCoinPrice: 250, goldGramPrice: 500 };
  assert.deepEqual(ids(items, { maxPrice: 110 }, prices), ['usd', 'parsian']);
  assert.deepEqual(ids(items, { currencyType: 'USD', maxPrice: 110 }, prices), ['usd']);
  assert.deepEqual(ids(items, { coinType: 'امامی', maxPrice: 250 }, prices), ['coin']);
  assert.equal(inventoryUnitPrice(items[2], prices), 50);
});

test('blank boundaries are unrestricted but zero is a real inclusive boundary', () => {
  const free = { ...ring, id: 'free', gramPrice: 0 };
  assert.deepEqual(ids([ring, free], { minPrice: '', maxPrice: ' ' }), ['ring', 'free']);
  assert.deepEqual(ids([ring, free], { maxPrice: '۰' }), ['free']);
  assert.deepEqual(ids([ring, free], { minPrice: 0 }), ['ring', 'free']);
});

test('Persian and Arabic digits, valid grouping and decimal boundaries are supported', () => {
  const item = { ...ring, weight: '۱٫۲۵', gramPrice: 1000 };
  for (const value of ['۱٬۲۵۰', '١,٢٥٠', '1 250', '۱۲۵۰٫۰', '1250.0']) {
    const result = filterInventoryItems([item], { minPrice: value, maxPrice: value, minWeight: '١٫٢٥', maxWeight: '۱٫۲۵' });
    assert.deepEqual(result.errors, {}, value);
    assert.deepEqual(result.items, [item], value);
  }
});

test('invalid and negative boundaries return field errors and no results', () => {
  for (const field of ['minPrice', 'maxPrice', 'minWeight', 'maxWeight']) {
    for (const value of ['-1', '-۰٫۵', 'abc', 'NaN', 'Infinity', Infinity, '1e6', '0x10', '1,2', '1..2', ',', '1/2', '1'.repeat(400)]) {
      const result = filterInventoryItems([ring], { [field]: value });
      assert.ok(result.errors[field], `${field}: ${value}`);
      assert.deepEqual(result.items, []);
    }
  }
});

test('reversed ranges report both fields and prevent results', () => {
  for (const [min, max] of [['minPrice', 'maxPrice'], ['minWeight', 'maxWeight']]) {
    const result = filterInventoryItems([ring], { [min]: '۲۰', [max]: '۱۰' });
    assert.ok(result.errors[min]);
    assert.ok(result.errors[max]);
    assert.deepEqual(result.items, []);
  }
});

test('weight bounds use actual weight per piece and omit assets without a recorded physical weight', () => {
  const items = [
    { ...ring, id: 'crafted', weight: 2, ayar: 900, itemCount: 20 },
    { id: 'melted', category: 'melted', meltedWeight: 2, meltedAyar: 900, itemCount: 20, remaining: 20 },
    { id: 'parsian', category: 'coin', coinType: 'پارسیان', parsianWeight: 2, remaining: 10 },
    { id: 'coin', category: 'coin', coinType: 'امامی', remaining: 10 },
    { id: 'usd', category: 'currency', currencyType: 'USD', currencyAmount: 2, remaining: 2 },
    { ...ring, id: 'missing', weight: '' },
    { ...ring, id: 'broken', weight: 'bad' },
  ];
  assert.deepEqual(ids(items, { minWeight: 2, maxWeight: 2 }), ['crafted', 'melted', 'parsian']);
  assert.deepEqual(ids(items, { category: 'melted', minWeight: 2, maxWeight: 2 }), ['melted']);
  assert.deepEqual(ids(items, { minWeight: 0 }), ['crafted', 'melted', 'parsian']);
});

test('default availability, empty inventory and all history remain independent of other filters', () => {
  const items = [ring, { ...ring, id: 'sold', remaining: 0 }, { ...ring, id: 'negative', remaining: -1 }];
  assert.deepEqual(ids(items), ['ring']);
  assert.deepEqual(ids(items, { status: 'empty', craftedKind: 'انگشتر' }), ['sold', 'negative']);
  assert.deepEqual(ids(items, { status: 'all', maxPrice: 100_000_000 }), ['ring', 'sold', 'negative']);
});

test('query searches normalized letters, digits, codes and multiple words in any order', () => {
  const item = { ...ring, itemName: 'انگشتر كيان', note: 'رنگ سفيد', assayCode: '۱۲۳', laboratoryName: 'آزمایشگاه تهران' };
  for (const query of ['سفید کیان', 'كيان سفید', 'دار', 'تهران ١٢٣', 'zg-۰۰۰۰۰۱', 'ساخته انگشتر']) {
    const expected = query === 'دار' ? [] : ['ring'];
    assert.deepEqual(ids([item], { query }), expected, query);
  }
  assert.deepEqual(ids([{ ...ring, itemName: 'نیم ست گل', craftedKind: 'نیم‌ست' }], { query: 'نیم‌ست' }), ['ring']);
  assert.deepEqual(ids([{ ...ring, itemName: 'نیم‌ست گل' }], { query: 'ست نیم' }), ['ring']);
  assert.deepEqual(ids([ring], { query: 'undefined' }), []);
  assert.deepEqual(ids([{ ...ring, description: null, note: null }], { query: 'null' }), []);
  assert.deepEqual(ids([{ id: 'usd', category: 'currency', currencyType: 'USD', remaining: 1 }], { query: 'دلار usd آمریکا' }), ['usd']);
});

test('old names and descriptions classify rings while explicit recorded kinds take precedence', () => {
  const items = [
    { ...ring, id: 'old-band', itemName: 'حلقه ساده' },
    { ...ring, id: 'old-description', itemName: '', description: 'انگشتر عقیق' },
    { ...ring, id: 'explicit', itemName: 'انگشتر طرح دستبند', craftedKind: 'دستبند' },
    { ...ring, id: 'explicit-ring', itemName: 'مدل ۲۴', craftedKind: 'انگشتر' },
  ];
  assert.deepEqual(ids(items, { craftedKind: 'انگشتر' }), ['old-band', 'old-description', 'explicit-ring']);
  assert.deepEqual(ids(items, { craftedKind: 'دستبند' }), ['explicit']);
  assert.deepEqual(ids(items, { query: 'انگشتر', craftedKind: 'انگشتر' }), ['old-band', 'old-description', 'explicit-ring']);
});

test('filtering is pure, preserves input order and returns the original item references', () => {
  const items = Object.freeze([Object.freeze({ ...ring, id: 'z' }), Object.freeze({ ...ring, id: 'a' })]);
  const filters = Object.freeze({ ...defaultVaultFilters, maxPrice: '۱۰۰٬۰۰۰٬۰۰۰' });
  const prices = Object.freeze({ goldGramPrice: 10_000_000 });
  const result = filterInventoryItems(items, filters, prices);
  assert.deepEqual(result.errors, {});
  assert.deepEqual(result.items.map(item => item.id), ['z', 'a']);
  assert.equal(result.items[0], items[0]);
  assert.equal(result.items[1], items[1]);
  assert.equal(defaultVaultFilters.maxPrice, '');
});

test('separate set pieces are searchable by their membership and by their own kind', () => {
  const set = { ...ring, setId: 'rose', setName: 'مدل رز کیان', setKind: 'نیم‌ست', setMode: 'separate', setPieceCount: 3 };
  const items = [
    { ...set, id: 'bracelet', itemName: 'دستبند', craftedKind: 'دستبند' },
    { ...set, id: 'earrings', itemName: 'گوشواره', craftedKind: 'گوشواره' },
    { ...set, id: 'anklet', itemName: 'پابند', craftedKind: 'پابند', remaining: 0 },
    ring,
  ];
  assert.deepEqual(ids(items, { query: 'رز كيان نیم ست' }), ['bracelet', 'earrings']);
  assert.deepEqual(ids(items, { craftedKind: 'نیم‌ست' }), ['bracelet', 'earrings']);
  assert.deepEqual(ids(items, { craftedKind: 'دستبند', query: 'رز' }), ['bracelet']);
  assert.deepEqual(ids(items, { craftedKind: 'نیم‌ست', status: 'all' }), ['bracelet', 'earrings', 'anklet']);
  assert.deepEqual(ids([{ ...items[0], setKind: 'ست' }], { craftedKind: 'ست' }), ['bracelet']);
});

test('filtered set display retains every remaining original piece for a joint sale and partial status', () => {
  const set = { ...ring, setId: 'rose', setName: 'رز', setKind: 'نیم‌ست', setMode: 'separate', setPieceCount: 3 };
  const bracelet = Object.freeze({ ...set, id: 'bracelet', craftedKind: 'دستبند' });
  const earrings = Object.freeze({ ...set, id: 'earrings', craftedKind: 'گوشواره' });
  const sold = Object.freeze({ ...set, id: 'anklet', craftedKind: 'پابند', remaining: 0 });
  const another = Object.freeze({ ...set, id: 'other-set', setId: 'different' });
  const all = Object.freeze([bracelet, ring, earrings, sold, another]);
  const visible = filterInventoryItems(all, { craftedKind: 'دستبند' }).items;
  const [group] = inventoryDisplayGroups(visible, all);
  assert.equal(group.setId, 'rose');
  assert.equal(group.totalPieces, 3);
  assert.deepEqual(group.items, [bracelet]);
  assert.deepEqual(group.availableItems, [bracelet, earrings]);
  assert.equal(group.availableItems[1], earrings, 'hidden matching members retain original stock references');
  assert.deepEqual(group.allItems, [bracelet, earrings, sold]);
  const soldOnly = inventoryDisplayGroups([sold], all)[0];
  assert.deepEqual(soldOnly.availableItems, [bracelet, earrings], 'empty-stock filtering cannot change a joint sale');
});

test('grouping preserves distinct sets, legacy single items and together sets without synthetic money rows', () => {
  const piece = { ...ring, id: 'piece-a', setId: 'one', setName: 'رز', setMode: 'separate', setKind: 'ست', setPieceCount: 2 };
  const second = { ...piece, id: 'piece-b' };
  const together = { ...piece, id: 'one-work', setId: 'together', setMode: 'together', craftedKind: 'ست' };
  const other = { ...piece, id: 'other', setId: 'two', setPieceCount: 1 };
  const items = [piece, ring, together, second, other];
  const groups = inventoryDisplayGroups(items, items);
  assert.deepEqual(groups.map(group => group.key), ['set:one', 'item:ring', 'item:one-work', 'set:two']);
  const displayed = groups.flatMap(group => group.item ? [group.item] : group.items);
  assert.equal(displayed.length, items.length);
  assert.equal(displayed.reduce((sum, item) => sum + inventoryUnitPrice(item), 0), items.reduce((sum, item) => sum + inventoryUnitPrice(item), 0));
  assert.deepEqual(inventoryDisplayGroups([], items), []);
});
