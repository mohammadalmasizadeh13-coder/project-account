import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDocument } from './documentValidation.js';
import { normalizeDigits } from './persianDate.js';
import { miscGoldDefaults } from './miscGold.js';

const parse = value => Number(normalizeDigits(value).replace(/[٬,\s]/g, '').replace(/٫/g, '.')) || 0;
const melted = { customerName: 'مشتری', itemName: 'آب‌شده تهران', date: '2026-09-24', type: 'melted-purchase', gold18Price: '۱۰٬۰۰۰٬۰۰۰', itemCount: '۱', meltedWeight: '۲٫۵', meltedAyar: '۷۵۰', meltedGramPrice: '۱۰۰', assayCode: '۱۲۳', laboratoryName: 'تهران' };

test('every purchase and sale requires a positive finite gold-18 snapshot independent of trade price', () => {
  for (const category of ['crafted', 'coin', 'melted', 'currency']) {
    for (const direction of ['purchase', 'sale']) {
      const form = { ...melted, type: `${category}-${direction}` };
      for (const gold18Price of [undefined, '', ' ', '۰', '-1', 'abc', 'Infinity', '1e999']) {
        assert.match(validateDocument({ ...form, gold18Price }, category, parse).gold18Price, /قیمت طلای ۱۸ عیار/);
      }
      for (const gold18Price of [10000000, '۱۰٬۰۰۰٬۰۰۰', '١٠٬٠٠٠٬٠٠٠٫٥']) {
        assert.equal(validateDocument({ ...form, gold18Price }, category, parse).gold18Price, undefined);
      }
    }
  }
});

test('opening inventory and expense forms do not require trade gold snapshots', () => {
  assert.deepEqual(validateDocument({ ...melted, source: 'opening-inventory', gold18Price: undefined }, 'melted', parse), {});
  assert.deepEqual(validateDocument({ date: '2026-09-25', type: 'expense', description: 'اجاره', expenseAmount: 100, gold18Price: 'bad' }, 'expense', parse), {});
});

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

test('expenses accept Persian amounts without a customer and ignore stale stock or debt fields', () => {
  const expense = { date: '2026-09-25', type: 'expense', description: 'اجاره فروشگاه', expenseAmount: '۱٬۲۵۰٫۵', customerName: '', itemCount: '-1', weight: 'abc', gramPrice: 'abc', wagePercent: 'abc', wageFixed: '-1', profitPercent: '-1', otherCosts: 'abc', gramDebt: 'abc', rialDebt: '-1' };
  assert.deepEqual(validateDocument(expense, 'expense', parse), {});
});

test('expenses require a description, positive finite amount and valid ISO date', () => {
  const expense = { date: '2026-09-25', type: 'expense', description: 'اجاره فروشگاه', expenseAmount: '100' };
  for (const expenseAmount of ['', '0', '۰', '-1', 'abc', 'Infinity', '1e999']) {
    assert.ok(validateDocument({ ...expense, expenseAmount }, 'expense', parse).expenseAmount, `reject ${expenseAmount}`);
  }
  for (const description of ['', '   ']) assert.ok(validateDocument({ ...expense, description }, 'expense', parse).description);
  for (const date of ['', '2026-02-30', '1405/07/03']) assert.ok(validateDocument({ ...expense, date }, 'expense', parse).date);
});

test('gold and foreign currency expenses validate their own conversion fields', () => {
  const expense = { date: '2026-09-25', type: 'expense', description: 'هزینه کارگاه', expenseUnit: 'gold', expenseAmount: '۰٫۲۵', expenseGoldPurity: '۷۵۰', expenseRate: '۱۰٬۰۰۰٬۰۰۰' };
  assert.deepEqual(validateDocument(expense, 'expense', parse), {});
  assert.deepEqual(validateDocument({ ...expense, expenseUnit: 'currency', expenseCurrency: 'EUR' }, 'expense', parse), {});
  for (const expenseUnit of ['gold', 'currency']) {
    assert.ok(validateDocument({ ...expense, expenseUnit, expenseRate: '' }, 'expense', parse).expenseRate);
  }
  assert.ok(validateDocument({ ...expense, expenseGoldPurity: 1001 }, 'expense', parse).expenseGoldPurity);
  assert.ok(validateDocument({ ...expense, expenseUnit: 'currency', expenseCurrency: 'bad' }, 'expense', parse).expenseCurrency);
  assert.ok(validateDocument({ ...expense, expenseUnit: 'bad' }, 'expense', parse).expenseUnit);
  assert.deepEqual(validateDocument({ ...expense, expenseUnit: 'rial', expenseRate: 'bad', expenseGoldPurity: -1, expenseCurrency: 'bad' }, 'expense', parse), {});
});

test('sale discounts may cover the full invoice but cannot exceed value, labor, costs and seller profit', () => {
  const sale = { ...melted, type: 'melted-sale', itemCount: '۲', meltedWeight: '۱', meltedGramPrice: '۱۰۰', wagePercent: '۱۰', wageFixed: '۵', otherCosts: '۵', profitPercent: '۷' };
  for (const discountRial of ['', '۰', '۲۵۰', '۲۵۶٫۸']) {
    assert.deepEqual(validateDocument({ ...sale, discountRial }, 'melted', parse), {}, `allow ${discountRial}`);
  }
  for (const discountRial of ['۲۵۶٫۸۱', '۱٬۰۰۰']) {
    assert.match(validateDocument({ ...sale, discountRial }, 'melted', parse).discountRial, /پیش از تخفیف/);
  }
});

test('discount limit also applies to fractional currency sales and leaves malformed discounts invalid', () => {
  const sale = { customerName: 'مشتری', itemName: 'دلار آمریکا', date: '2026-09-24', type: 'currency-sale', gold18Price: '۱۰٬۰۰۰٬۰۰۰', currencyType: 'USD', currencyAmount: '۱٫۵', currencyRate: '۱۰۰', profitPercent: '۷' };
  assert.deepEqual(validateDocument({ ...sale, discountRial: '۱۶۰٫۵' }, 'currency', parse), {});
  assert.ok(validateDocument({ ...sale, discountRial: '۱۶۱' }, 'currency', parse).discountRial);
  for (const discountRial of ['-1', 'abc', 'Infinity']) assert.ok(validateDocument({ ...sale, discountRial }, 'currency', parse).discountRial);
});

test('every new goods document requires a name even when a description or type exists', () => {
  for (const category of ['crafted', 'coin', 'melted', 'currency']) {
    for (const type of [`${category}-purchase`, `${category}-sale`, `opening-${category}`]) {
      for (const itemName of [undefined, '', '   ', '\t\n']) {
        const errors = validateDocument({ ...melted, type, itemName, description: 'شرح داخلی', craftedKind: 'انگشتر' }, category, parse);
        assert.match(errors.itemName, /نام جنس/, `${type} rejects blank names`);
      }
      assert.equal(validateDocument({ ...melted, type, itemName: ' نام کالا ' }, category, parse).itemName, undefined);
    }
  }
});

test('crafted documents require an explicit valid kind independently of their name', () => {
  const form = { ...melted, type: 'crafted-purchase', itemName: 'انگشتر طرح گل', itemCount: '۱', weight: '۲', gramPrice: '۱۰۰', ayar: '۷۵۰', wagePercent: '۰' };
  for (const craftedKind of [undefined, '', ' ', 'نوع نامعتبر']) {
    assert.match(validateDocument({ ...form, craftedKind }, 'crafted', parse).craftedKind, /نوع کار ساخته/);
  }
  assert.deepEqual(validateDocument({ ...form, craftedKind: 'انگشتر' }, 'crafted', parse), {});
  assert.deepEqual(validateDocument({ date: form.date, type: 'expense', description: 'اجاره', expenseAmount: '۱۰۰' }, 'expense', parse), {});
});

test('misc purchase requires actual weight, explicit purity within 1 to 1000 and a historic gold price', () => {
  const misc = { ...miscGoldDefaults(), customerName: 'فروشنده', itemName: 'طلای دست دوم', date: '2026-10-05',
    type: 'misc-purchase', weight: '۱۰', ayar: '۷۴۰', gramPrice: '6000000', gold18Price: '6000000',
  };
  assert.deepEqual(validateDocument(misc, 'crafted', parse), {});
  for (const ayar of [undefined, '', '۰', -1, '۰٫۵', '۱۰۰۱', 'abc', Infinity]) {
    assert.ok(validateDocument({ ...misc, ayar }, 'crafted', parse).ayar, `reject ${ayar}`);
  }
  for (const weight of ['', 0, -1, 'abc', Infinity]) {
    assert.ok(validateDocument({ ...misc, weight }, 'crafted', parse).weight, `reject ${weight}`);
  }
  assert.ok(validateDocument({ ...misc, gold18Price: '' }, 'crafted', parse).gold18Price);
  assert.deepEqual(validateDocument({ ...misc, ayar: '۱۰۰۰' }, 'crafted', parse), {});
});
