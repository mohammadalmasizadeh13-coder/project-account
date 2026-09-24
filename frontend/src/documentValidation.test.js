import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDocument } from './documentValidation.js';
import { normalizeDigits } from './persianDate.js';

const parse = value => Number(normalizeDigits(value).replace(/[٬,\s]/g, '').replace(/٫/g, '.')) || 0;
const melted = { customerName: 'مشتری', date: '2026-09-24', type: 'melted-purchase', itemCount: '۱', meltedWeight: '۲٫۵', meltedAyar: '۷۵۰', meltedGramPrice: '۱۰۰', assayCode: '۱۲۳', laboratoryName: 'تهران' };

test('melted purchase and sale require a laboratory next to the field', () => {
  for (const type of ['melted-purchase', 'melted-sale']) {
    assert.deepEqual(validateDocument({ ...melted, type }, 'melted', parse), {});
    assert.match(validateDocument({ ...melted, type, laboratoryName: ' ' }, 'melted', parse).laboratoryName, /آزمایشگاه/);
  }
});
test('invalid and incomplete dates prevent saving a document', () => {
  for (const date of ['', '2026-02-30', '1405/07/02']) assert.ok(validateDocument({ ...melted, date }, 'melted', parse).date);
});
test('nonpositive gold and malformed optional financial numbers are rejected', () => {
  for (const value of ['-1', '0', 'abc', 'Infinity']) assert.ok(validateDocument({ ...melted, meltedWeight: value }, 'melted', parse).meltedWeight);
  assert.ok(validateDocument({ ...melted, rialDebt: 'abc' }, 'melted', parse).rialDebt);
  assert.deepEqual(validateDocument({ ...melted, rialDebt: '۰', profitPercent: '۰' }, 'melted', parse), {});
});
