import test from 'node:test';
import assert from 'node:assert/strict';
import { exactStockName, findStockMatches } from './stockSearch.js';

const stock = [
  { id: 'one', itemName: 'مدال چشم گربه‌ای', category: 'crafted', craftedKind: 'آویز و پلاک', productCode: 'ZG-000001', remaining: 1, weight: '2' },
  { id: 'two', itemName: 'مدال قلب', category: 'crafted', remaining: 2, weight: '1' },
  { id: 'three', itemName: 'مدال قلب', category: 'crafted', remaining: 1, weight: '3' },
  { id: 'sold', itemName: 'مدال فروخته‌شده', category: 'crafted', remaining: 0 },
  { id: 'ring', itemName: 'انگشتر', category: 'crafted', description: 'مدال در شرح', remaining: 1 },
];

test('live names include each available lot, rank names first and exclude sold-out stock', () => {
  assert.deepEqual(findStockMatches(stock, 'مدال').map(item => item.id), ['one', 'two', 'three', 'ring']);
  assert.equal(findStockMatches(stock, 'فروخته').length, 0);
  assert.equal(findStockMatches(stock, 'مدال چشم').length, 1);
  assert.equal(findStockMatches(stock, 'چشم مدال')[0].id, 'one');
});

test('Persian and Arabic letters, spacing and digits match the same stock', () => {
  assert.equal(exactStockName(stock, '  مدال چشم گربه اي  ')?.id, 'one');
  assert.equal(findStockMatches(stock, 'zg-۰۰۰۰۰۱')[0].id, 'one');
  assert.equal(exactStockName([{ ...stock[0], itemName: 'مدال کیمیا' }], 'مدال كيميا')?.id, 'one');
});

test('a full ambiguous name cannot silently select another weight or lot', () => {
  assert.equal(exactStockName(stock, 'مدال قلب'), null);
  assert.equal(exactStockName(stock, 'مدال'), null);
  assert.equal(exactStockName(stock, ''), null);
  assert.equal(exactStockName(stock, 'مدال فروخته شده'), null);
  assert.equal(exactStockName(stock.map(item => item.id === 'three' ? { ...item, remaining: 0 } : item), 'مدال قلب')?.id, 'two');
});
