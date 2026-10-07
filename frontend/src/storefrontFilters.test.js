import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyStorefrontFilters, parseStorefrontNumber, storefrontCraftedKinds, storefrontFilterCount, storefrontQuery, validateStorefrontFilters } from './storefrontFilters.js';

test('storefront numbers accept Persian, Arabic, decimal and thousands separators', () => {
  for (const [input, expected] of [['۲٫۵', '2.5'], ['٣٬٥٠٠٬٠٠٠', '3500000'], [' ۱,۰۰۰,۰۰۰ ', '1000000'], ['۲ ۰۰۰ ۰۰۰', '2000000'], ['۳\u00a0۰۰۰', '3000'], ['.۵', '0.5'], ['۰', '0'], ['٠٫٠', '0'], ['', ''], ['  ', '']]) {
    assert.equal(parseStorefrontNumber(input), expected, input);
  }
});

test('invalid or ambiguous numbers cannot silently change a price bound', () => {
  for (const value of ['۱,۲۳', '1,,000', '-1', '1e6', 'Infinity', 'NaN', '۵٪', '1.2.3', '۹۰۰۷۱۹۹۲۵۴۷۴۰۹۹۲', '1.000,000', ',']) assert.equal(parseStorefrontNumber(value), null, value);
});

test('zero wage and price limits stay active in the API request', () => {
  const { filters, errors } = validateStorefrontFilters({ ...emptyStorefrontFilters(), minPrice: '۰', maxWagePercent: '٠' });
  assert.deepEqual(errors, {});
  const parameters = new URLSearchParams(storefrontQuery({ filters }));
  assert.equal(parameters.get('min_price'), '0');
  assert.equal(parameters.get('max_wage_percent'), '0');
  assert.equal(storefrontFilterCount(filters), 2);
});

test('all ranges combine with query, category, kind and sorting without dropping filters', () => {
  const { filters, errors } = validateStorefrontFilters({ minWeight: '۱٫۵', maxWeight: '٥', minPrice: '۲٬۰۰۰٬۰۰۰', maxPrice: '۲۰٬۰۰۰٬۰۰۰', minWagePercent: '۰', maxWagePercent: '۷٫۵', craftedKind: 'النگو' });
  assert.deepEqual(errors, {});
  const parameters = Object.fromEntries(new URLSearchParams(storefrontQuery({ query: '  ظریف ', category: 'bracelets', sort: 'price-asc', filters })));
  assert.deepEqual(parameters, { q: 'ظریف', category: 'bracelets', min_weight: '1.5', max_weight: '5', min_price: '2000000', max_price: '20000000', min_wage_percent: '0', max_wage_percent: '7.5', crafted_kind: 'النگو', sort: 'price-asc' });
  assert.equal(storefrontFilterCount(filters), 4);
});

test('each reversed range reports its own upper field and valid equal bounds remain allowed', () => {
  for (const [minimum, maximum] of [['minWeight', 'maxWeight'], ['minPrice', 'maxPrice'], ['minWagePercent', 'maxWagePercent']]) {
    const reversed = validateStorefrontFilters({ ...emptyStorefrontFilters(), [minimum]: '۱۰', [maximum]: '۹' });
    assert.deepEqual(Object.keys(reversed.errors), [maximum]);
    assert.deepEqual(validateStorefrontFilters({ ...emptyStorefrontFilters(), [minimum]: '۰', [maximum]: '۰' }).errors, {});
  }
});

test('percent, weight and integer-safe price bounds reject overflow', () => {
  const { errors } = validateStorefrontFilters({ ...emptyStorefrontFilters(), maxWeight: '100001', maxPrice: '9007199254740992', maxWagePercent: '100.01' });
  assert.deepEqual(Object.keys(errors).sort(), ['maxPrice', 'maxWagePercent', 'maxWeight']);
  assert.deepEqual(validateStorefrontFilters({ ...emptyStorefrontFilters(), maxPrice: String(Number.MAX_SAFE_INTEGER), maxWeight: '100000', maxWagePercent: '100' }).errors, {});
});

test('the full twelve-kind list is validated and clearing removes all advanced query fields', () => {
  assert.equal(storefrontCraftedKinds.length, 12);
  for (const craftedKind of storefrontCraftedKinds) assert.deepEqual(validateStorefrontFilters({ ...emptyStorefrontFilters(), craftedKind }).errors, {});
  assert.ok(validateStorefrontFilters({ ...emptyStorefrontFilters(), craftedKind: 'unknown' }).errors.craftedKind);
  assert.equal(storefrontQuery({ filters: emptyStorefrontFilters() }), 'sort=newest');
  assert.equal(storefrontFilterCount(emptyStorefrontFilters()), 0);
});
