import test from 'node:test';
import assert from 'node:assert/strict';
import { can, canOpenTool, writableFields } from './access.js';

test('staff sees only assigned reports and no write or management tools', () => {
  const staff = { role: 'staff', permissions: ['documents.read'] };
  assert.equal(canOpenTool(staff, 'vault'), true);
  assert.equal(canOpenTool(staff, 'search'), true);
  assert.equal(canOpenTool(staff, 'settings'), true, 'Staff can reach their personal password settings');
  for (const key of ['entries', 'register', 'opening', 'crm', 'cheques', 'pricing', 'rates', 'balance']) {
    assert.equal(canOpenTool(staff, key), false, key);
  }
  assert.equal(can(staff, 'storefront.manage'), false);
  assert.deepEqual(writableFields(staff), []);
});

test('trade requires permissions for both ledger and customer balances', () => {
  const staff = { role: 'staff', permissions: ['documents.read', 'documents.write'] };
  assert.equal(canOpenTool(staff, 'expense'), true);
  assert.equal(canOpenTool(staff, 'register'), false);
  staff.permissions.push('customers.read', 'customers.write');
  assert.equal(canOpenTool(staff, 'register'), true);
  assert.deepEqual(writableFields(staff), ['documents', 'customers']);
});

test('only an owner can access opening inventory or every permission', () => {
  assert.equal(canOpenTool({ role: 'owner' }, 'opening'), true);
  assert.equal(canOpenTool({ role: 'staff', permissions: ['documents.write'] }, 'opening'), false);
  assert.equal(canOpenTool(null, 'home'), false);
  assert.equal(canOpenTool(null, 'settings'), false);
  assert.equal(canOpenTool({ role: 'customer' }, 'settings'), false);
  assert.equal(can({ role: 'customer', permissions: ['documents.write'] }, 'documents.write'), false);
  assert.ok(writableFields({ role: 'owner' }).includes('openingSetup'));
});

test('retired storefront permission grants no accounting access to any account', () => {
  const staff = { role: 'staff', permissions: ['storefront.manage'] };
  assert.equal(can(staff, 'storefront.manage'), false);
  assert.equal(can({ role: 'owner' }, 'storefront.manage'), false);
  assert.equal(canOpenTool(staff, 'vault'), false);
  assert.equal(canOpenTool(staff, 'register'), false);
  assert.deepEqual(writableFields(staff), []);
});

test('business partner access is separate from customers and purchasing requires ledger access', () => {
  const staff = { role: 'staff', permissions: ['partners.read', 'partners.write'] };
  assert.equal(canOpenTool(staff, 'crm'), true);
  assert.equal(canOpenTool(staff, 'partners'), true);
  assert.equal(can(staff, 'customers.read'), false);
  assert.equal(canOpenTool(staff, 'partner-invoice'), false);
  staff.permissions.push('documents.read', 'documents.write');
  assert.equal(canOpenTool(staff, 'partner-invoice'), true);
  assert.equal(canOpenTool(staff, 'register'), false);
});
