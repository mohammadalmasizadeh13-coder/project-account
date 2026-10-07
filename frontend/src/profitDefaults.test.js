import test from 'node:test';
import assert from 'node:assert/strict';
import { documentBreakdown, number } from './assets.js';
import { validateDocument } from './documentValidation.js';
import { profitPercentInput } from './profitDefaults.js';

const crafted = { category: 'crafted', type: 'crafted-sale', itemName: 'انگشتر', craftedKind: 'انگشتر',
  customerName: 'مشتری', date: '2026-09-27', gold18Price: '100', itemCount: '2', weight: '1',
  gramPrice: '100', ayar: '750', wagePercent: '10', wageFixed: '2', otherCosts: '3' };

test('new crafted forms use seven percent for omitted or cleared profit in the invoice and discount limit', () => {
  for (const profitPercent of [undefined, null, '', '   ', '\t\n']) {
    const form = { ...crafted, profitPercent };
    const normalized = { ...form, profitPercent: profitPercentInput(form.profitPercent, form.category) };
    assert.equal(documentBreakdown(normalized).total, 246.1);
    assert.deepEqual(validateDocument({ ...form, discountRial: '246.1' }, 'crafted', number), {});
    assert.ok(validateDocument({ ...form, discountRial: '246.2' }, 'crafted', number).discountRial);
    assert.equal(form.profitPercent, profitPercent);
  }
});

test('explicit zero and custom percentages override defaults including Persian input', () => {
  for (const [profitPercent, expected] of [[0, 230], ['0', 230], ['۰', 230], ['٠', 230], ['12.5', 258.75], ['۱۲٫۵', 258.75]]) {
    const form = { ...crafted, profitPercent: profitPercentInput(profitPercent, 'crafted') };
    assert.equal(documentBreakdown(form).total, expected);
    assert.deepEqual(validateDocument(form, 'crafted', number), {});
  }
  assert.ok(validateDocument({ ...crafted, profitPercent: '0', discountRial: '246.1' }, 'crafted', number).discountRial);
});

test('invalid entered percentages stay invalid and historical calculations keep their recorded meaning', () => {
  for (const profitPercent of ['abc', '-1', 'Infinity']) {
    const form = { ...crafted, profitPercent: profitPercentInput(profitPercent, 'crafted') };
    assert.ok(validateDocument(form, 'crafted', number).profitPercent);
  }
  const historical = Object.freeze({ ...crafted });
  assert.equal(documentBreakdown(historical).total, 230);
  for (const category of ['coin', 'melted', 'currency']) assert.equal(profitPercentInput('', category), '0');
});

test('misc purchases never inherit the crafted seven percent default', () => {
  for (const value of [undefined, '', ' ', 0, '7']) {
    assert.equal(profitPercentInput(value, 'crafted', 'misc-purchase'), '0');
    assert.equal(profitPercentInput(value, 'crafted', { type: 'misc-purchase' }), '0');
  }
  assert.equal(profitPercentInput('', 'crafted', { type: 'crafted-purchase' }), '7');
});
