import test from 'node:test';
import assert from 'node:assert/strict';
import { customerSummary, settleCustomer } from './crm.js';

test('customer history follows IDs after renames, supports legacy records and separates both trade directions', () => {
  const customer = { id: 'a', name: 'Renamed' };
  const result = customerSummary(customer, [
    { id: 'sale', customerId: 'a', customerName: 'Original', type: 'coin-sale', amount: 1000, date: '2026-09-23' },
    { id: 'purchase', customerId: 'a', type: 'coin-purchase', amount: 200, date: '2026-09-22' },
    { id: 'legacy', customerName: 'Renamed', direction: 'فروش', amount: 30, date: '2026-09-21' },
    { id: 'other', customerId: 'b', customerName: 'Renamed', type: 'coin-sale', amount: 9999, date: '2026-09-23' },
    { id: 'opening', customerId: 'a', source: 'opening-inventory', amount: 9999, date: '2026-09-23' },
  ]);
  assert.equal(result.purchased, 1030);
  assert.equal(result.sold, 200);
  assert.equal(result.transactions.length, 3);
  assert.equal(result.lastVisit, '2026-09-23');
});

test('receipts decrease debt, payments decrease customer credit and create separate history', () => {
  const customer = { id: 'a', rialDebt: 300, gramDebt: 2, note: 'Preserve', purchases: [{ id: 'old' }] };
  const received = settleCustomer(customer, { rialAmount: 100, gramAmount: .5, direction: 'received', date: '2026-09-23', note: 'Receipt' }, 'one');
  assert.equal(received.rialDebt, 200);
  assert.equal(received.gramDebt, 1.5);
  assert.equal(received.settlements.length, 1);
  assert.equal(customer.rialDebt, 300);
  assert.equal(received.purchases[0].id, 'old');
  const paid = settleCustomer({ ...received, rialDebt: -200 }, { rialAmount: 150, gramAmount: 0, direction: 'paid', date: '2026-09-23' }, 'two');
  assert.equal(paid.rialDebt, -50);
  assert.equal(paid.settlements.length, 2);
});

test('settlements reject negative, missing, infinite and empty amounts', () => {
  for (const amount of [-1, NaN, Infinity, undefined]) assert.throws(() => settleCustomer({}, { rialAmount: amount, gramAmount: 0, direction: 'received' }));
  assert.throws(() => settleCustomer({}, { rialAmount: 0, gramAmount: 0, direction: 'received' }));
});
