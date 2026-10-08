import test from 'node:test';
import assert from 'node:assert/strict';
import { customerDocumentDetails, customerProfileDetails, validateCustomerDocumentDetails } from './customerDetails.js';

test('customer snapshot preserves leading zeroes and multiline address with Persian digits', () => {
  const profile = { phone: '09123456789', birthDate: '1991-03-22', address: 'تهران\nخیابان نمونه', nationalId: '۰۰۱۲۳۴۵۶۷۸' };
  const snapshot = customerDocumentDetails(profile);
  assert.equal(snapshot.customerNationalId, '0012345678');
  assert.deepEqual(customerProfileDetails(snapshot), { ...profile, nationalId: '0012345678' });
  assert.deepEqual(validateCustomerDocumentDetails(snapshot), {});
  assert.equal(profile.nationalId, '۰۰۱۲۳۴۵۶۷۸');
});

test('new customer clears previously selected details and older records need no optional details', () => {
  assert.deepEqual(customerDocumentDetails(), { customerPhone: '', customerBirthDate: '', customerAddress: '', customerNationalId: '' });
  assert.deepEqual(validateCustomerDocumentDetails({}), {});
});

test('optional identity validation rejects impossible or future dates and nonnumeric IDs', () => {
  assert.ok(validateCustomerDocumentDetails({ customerBirthDate: '2025-02-29' }).customerBirthDate);
  assert.ok(validateCustomerDocumentDetails({ customerBirthDate: '2026-10-09' }, '2026-10-08').customerBirthDate);
  assert.ok(validateCustomerDocumentDetails({ customerNationalId: '001234567x' }).customerNationalId);
  assert.deepEqual(validateCustomerDocumentDetails({ customerNationalId: '٠٠١٢٣٤٥٦٧٨', customerBirthDate: '2026-10-08' }, '2026-10-08'), {});
});

test('payment method accepts arbitrary multiline text within the same bounds as the server', () => {
  assert.deepEqual(validateCustomerDocumentDetails({ paymentMethod: 'کارت‌به‌کارت\nباقی‌مانده با چک شماره ۱۲۳' }), {});
  assert.ok(validateCustomerDocumentDetails({ paymentMethod: 'x'.repeat(5001) }).paymentMethod);
});
