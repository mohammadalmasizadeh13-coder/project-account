import test from 'node:test';
import assert from 'node:assert/strict';
import { formatNumberInput, normalizeNumberInput, numberInputEdit } from './numberInput.js';

test('live prices are grouped without rounding or changing fractional precision', () => {
  assert.equal(formatNumberInput('12500000'), '12,500,000');
  assert.equal(formatNumberInput('12345678901234567890.00100'), '12,345,678,901,234,567,890.00100');
  assert.equal(formatNumberInput('-12500.0300'), '-12,500.0300');
  for (const value of ['', '-', '.', '-.', '0.', '0.00']) assert.equal(formatNumberInput(value), value);
});

test('Persian/Arabic digits and pasted formatted prices produce plain values', () => {
  assert.equal(normalizeNumberInput('۱۲٬۳۴۵٬۶۷۸٫۰۰۵'), '12345678.005');
  assert.equal(normalizeNumberInput('−١٢ ٣٤٥٫٦٠'), '-12345.60');
  assert.equal(numberInputEdit({ text: '۱۲٬۳۴۵٬۶۷۸٫۰۰۵' }).formatted, '12,345,678.005');
  assert.equal(numberInputEdit({ text: '12abc34' }), null);
  assert.equal(numberInputEdit({ text: '12.3.4' }), null);
  assert.equal(numberInputEdit({ text: '12-34' }), null);
});

test('typing and replacing in the middle keeps the caret at the edited digits', () => {
  assert.deepEqual(numberInputEdit({ text: '1234', start: 4 }), { value: '1234', formatted: '1,234', start: 5, end: 5 });
  assert.deepEqual(numberInputEdit({ text: '129,345', start: 3, previousValue: '12345' }), { value: '129345', formatted: '129,345', start: 3, end: 3 });
  assert.deepEqual(numberInputEdit({ text: '1,934', start: 3, previousValue: '1234' }), { value: '1934', formatted: '1,934', start: 3, end: 3 });
  assert.deepEqual(numberInputEdit({ text: '1,234.50', start: 8 }), { value: '1234.50', formatted: '1,234.50', start: 8, end: 8 });
});

test('backspace/delete across a comma remove a digit instead of getting stuck', () => {
  assert.deepEqual(numberInputEdit({ text: '1234', start: 1, previousValue: '1234', inputType: 'deleteContentBackward' }), { value: '234', formatted: '234', start: 0, end: 0 });
  assert.deepEqual(numberInputEdit({ text: '1234', start: 1, previousValue: '1234', inputType: 'deleteContentForward' }), { value: '134', formatted: '134', start: 1, end: 1 });
  assert.deepEqual(numberInputEdit({ text: '1,34', start: 2, previousValue: '1234', inputType: 'deleteContentBackward' }), { value: '134', formatted: '134', start: 1, end: 1 });
  assert.deepEqual(numberInputEdit({ text: '', start: 0, previousValue: '1234', inputType: 'deleteContentBackward' }), { value: '', formatted: '', start: 0, end: 0 });
});
