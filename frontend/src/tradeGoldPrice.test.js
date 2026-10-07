import test from 'node:test';
import assert from 'node:assert/strict';
import { isTradeDocument, tradeGoldPriceSummary } from './tradeGoldPrice.js';

test('gold snapshots apply to both directions of every trade category', () => {
  for (const category of ['crafted', 'coin', 'melted', 'currency']) {
    for (const direction of ['purchase', 'sale']) {
      const doc = { type: `${category}-${direction}`, gold18Price: 10250000 };
      assert.equal(isTradeDocument(doc), true);
      assert.equal(tradeGoldPriceSummary(doc), 'طلای ۱۸ عیار هنگام ثبت: ۱۰٬۲۵۰٬۰۰۰ تومان / گرم');
    }
  }
});

test('misc purchase also retains and shows its historical gold rate', () => {
  assert.equal(isTradeDocument({ type: 'misc-purchase' }), true);
  assert.equal(tradeGoldPriceSummary({ type: 'misc-purchase', gold18Price: 6000000 }), 'طلای ۱۸ عیار هنگام ثبت: ۶٬۰۰۰٬۰۰۰ تومان / گرم');
});

test('opening inventory, cash documents and expenses have no gold snapshot summary', () => {
  for (const doc of [
    { type: 'crafted-purchase', source: 'opening-inventory' },
    { type: 'currency-sale', source: 'opening-inventory' },
    { type: 'receipt' }, { type: 'payment' }, { type: 'expense' },
    { type: 'cash-purchase' }, { direction: 'خرید' }, {}, null,
  ]) {
    assert.equal(isTradeDocument(doc), false);
    assert.equal(tradeGoldPriceSummary(doc && { ...doc, gold18Price: 10250000 }), '');
  }
});

test('legacy transactions never infer a historic gold price from transaction or current prices', () => {
  const doc = { type: 'melted-purchase', gramPrice: 5000000, meltedGramPrice: 6000000, goldGramPrice: 7000000, date: '2026-09-24' };
  assert.equal(tradeGoldPriceSummary(doc), 'طلای ۱۸ عیار هنگام ثبت: ثبت نشده');
  assert.equal(tradeGoldPriceSummary({ ...doc, gold18Price: 4000000 }), 'طلای ۱۸ عیار هنگام ثبت: ۴٬۰۰۰٬۰۰۰ تومان / گرم');
  assert.equal(tradeGoldPriceSummary({ ...doc, gold18Price: 4000000, gramPrice: 9000000, goldGramPrice: 10000000 }), 'طلای ۱۸ عیار هنگام ثبت: ۴٬۰۰۰٬۰۰۰ تومان / گرم');
});

test('invalid snapshots remain unrecorded and saved numeric prices retain their value', () => {
  for (const gold18Price of [undefined, null, '', ' ', 0, -1, NaN, Infinity, 'bad', '1e999', true]) {
    assert.equal(tradeGoldPriceSummary({ type: 'coin-sale', gold18Price }), 'طلای ۱۸ عیار هنگام ثبت: ثبت نشده');
  }
  assert.equal(tradeGoldPriceSummary({ type: 'coin-sale', gold18Price: '10250000.5' }), 'طلای ۱۸ عیار هنگام ثبت: ۱۰٬۲۵۰٬۰۰۰٫۵ تومان / گرم');
});
