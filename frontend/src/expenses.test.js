import test from 'node:test';
import assert from 'node:assert/strict';
import { expenseRateSummary, expenseSummary, expenseUnitLabel, expenseUnits, expenseValue, normalizeExpense, validateExpense } from './expenses.js';

test('toman and rial costs preserve the entered amount and capture toman equivalents', () => {
  assert.deepEqual(expenseUnits.map(unit => unit.value), ['toman', 'rial', 'gold', 'currency']);
  const toman = normalizeExpense({ expenseAmount: '۱۲۵٬۰۰۰' });
  assert.equal(toman.expenseUnit, 'toman');
  assert.equal(toman.expenseAmount, 125000);
  assert.equal(toman.amount, 125000);
  const rial = normalizeExpense({ expenseUnit: 'rial', expenseAmount: '١٢٥٠٠٠' });
  assert.equal(rial.expenseAmount, 125000);
  assert.equal(rial.amount, 12500);
  assert.equal(expenseValue({ expenseUnit: 'rial', expenseAmount: '۱۵' }), 1.5);
});

test('fractional gold expenses apply the recorded purity and rate per gram of 750 gold', () => {
  const gold = normalizeExpense({ expenseUnit: 'gold', expenseAmount: '۰٫۲۵', expenseGoldPurity: '۹۰۰', expenseRate: '۱۰٬۰۰۰٬۰۰۰' });
  assert.equal(gold.expenseAmount, 0.25);
  assert.equal(gold.expenseGoldPurity, 900);
  assert.equal(gold.expenseRate, 10000000);
  assert.equal(gold.amount, 3000000);
  assert.equal(expenseValue({ expenseUnit: 'gold', expenseAmount: '٠٫٥', expenseRate: '٢٬٠٠٠' }), 1000);
  assert.equal(normalizeExpense({ expenseUnit: 'gold', expenseAmount: 0.5, expenseRate: 2000 }).expenseGoldPurity, 750);
});

test('currency expenses retain their original quantity and currency, including fractions', () => {
  for (const expenseCurrency of ['USD', 'EUR', 'AED', 'GBP', 'TRY']) {
    const currency = normalizeExpense({ expenseUnit: 'currency', expenseAmount: '۱۲٫۵', expenseCurrency, expenseRate: '۱۰٬۰۰۰' });
    assert.equal(currency.expenseAmount, 12.5);
    assert.equal(currency.expenseCurrency, expenseCurrency);
    assert.equal(currency.amount, 125000);
  }
  assert.equal(normalizeExpense({ expenseUnit: 'currency', expenseAmount: 1, expenseRate: 100 }).expenseCurrency, 'USD');
});

test('cash units ignore and clear stale gold and foreign currency conversion fields', () => {
  for (const expenseUnit of ['toman', 'rial']) {
    const value = normalizeExpense({ expenseUnit, expenseAmount: 100, expenseCurrency: 'unknown', expenseGoldPurity: 'bad', expenseRate: -1 });
    assert.equal(value.expenseCurrency, null);
    assert.equal(value.expenseGoldPurity, null);
    assert.equal(value.expenseRate, null);
    assert.equal(value.amount, expenseUnit === 'toman' ? 100 : 10);
  }
});

test('invalid quantities and conversions cannot become saved zero or nonfinite expenses', () => {
  const base = { expenseUnit: 'currency', expenseAmount: 1, expenseCurrency: 'USD', expenseRate: 100, description: 'هزینه' };
  for (const expenseAmount of ['', 0, '۰', -1, 'bad', 'Infinity', '1e999']) {
    assert.ok(validateExpense({ ...base, expenseAmount }).expenseAmount);
    assert.ok(Number.isNaN(expenseValue({ ...base, expenseAmount })));
    assert.throws(() => normalizeExpense({ ...base, expenseAmount }), TypeError);
  }
  for (const expenseRate of [undefined, '', 0, -1, 'bad', 'Infinity', '1e999']) {
    for (const expenseUnit of ['gold', 'currency']) assert.ok(validateExpense({ ...base, expenseUnit, expenseRate }).expenseRate);
  }
  assert.ok(validateExpense({ ...base, expenseUnit: 'coin' }).expenseUnit);
  assert.ok(validateExpense({ ...base, expenseCurrency: 'unknown' }).expenseCurrency);
  assert.ok(validateExpense({ ...base, expenseAmount: '1e308', expenseRate: '1e308' }).expenseAmount);
  for (const expenseGoldPurity of ['', 0, -1, 1001, 'bad', 'Infinity']) {
    assert.ok(validateExpense({ ...base, expenseUnit: 'gold', expenseGoldPurity }).expenseGoldPurity);
  }
});

test('expense summaries show original units and preserve legacy toman meaning', () => {
  const legacy = { amount: 125000 };
  assert.equal(expenseSummary(legacy), '۱۲۵٬۰۰۰ تومان');
  assert.deepEqual(legacy, { amount: 125000 });
  assert.equal(expenseSummary({ expenseUnit: 'rial', expenseAmount: 125000, amount: 12500 }), '۱۲۵٬۰۰۰ ریال');
  assert.equal(expenseSummary({ expenseUnit: 'gold', expenseAmount: 0.25, expenseGoldPurity: 900, amount: 3000000 }), '۰٫۲۵ گرم طلا با عیار ۹۰۰');
  assert.equal(expenseSummary({ expenseUnit: 'currency', expenseAmount: 12.5, expenseCurrency: 'EUR', amount: 125000 }), '۱۲٫۵ یورو');
  assert.equal(expenseUnitLabel({ expenseUnit: 'currency', expenseCurrency: 'USD' }), 'دلار آمریکا');
});

test('saved cost and rate remain fixed when unrelated market rates change', () => {
  const prices = { goldGramPrice: 10000000, usdPrice: 100000 };
  const saved = [
    normalizeExpense({ expenseUnit: 'gold', expenseAmount: 0.25, expenseRate: prices.goldGramPrice }),
    normalizeExpense({ expenseUnit: 'currency', expenseAmount: 2, expenseRate: prices.usdPrice }),
  ];
  prices.goldGramPrice = 15000000;
  prices.usdPrice = 200000;
  assert.equal(saved.reduce((total, expense) => total + expense.amount, 0), 2700000);
  assert.equal(saved[0].expenseRate, 10000000);
  assert.equal(saved[1].expenseRate, 100000);
  assert.equal(expenseRateSummary(saved[0]), 'هر گرم طلای ۷۵۰: ۱۰٬۰۰۰٬۰۰۰ تومان');
  assert.equal(expenseRateSummary(saved[1]), 'هر واحد دلار آمریکا: ۱۰۰٬۰۰۰ تومان');
  assert.equal(expenseRateSummary({ amount: 5000 }), '');
});
