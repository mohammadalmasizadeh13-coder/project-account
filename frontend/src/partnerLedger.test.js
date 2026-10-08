import test from 'node:test';
import assert from 'node:assert/strict';
import { readAccountingDraft, writeAccountingDraft } from './accountingDrafts.js';
import { newPartnerInvoice, newPartnerLine, newPartnerProfile, newPartnerSettlement, parsePartnerNumber,
  partnerInvoiceDraftFromEntry, partnerSettlementDraftFromEntry, partnerInvoiceTotals, partnerLineTotals, savedPartnerLineTotals, partnerStatement, preparePartnerInvoice, preparePartnerProfile,
  preparePartnerSettlement, upgradePartnerInvoiceDraft } from './partnerLedger.js';

const line = { ...newPartnerLine({ goldGramPrice: 10000000 }), itemName: 'النگو', craftedKind: 'النگو', itemCount: '۳', weight: '۴٫۷۴۰', ayar: '۷۵۰', wagePercent: '۷' };
test('legacy supplier photo example retains total row weight and seven percent labor without new profit', () => {
  const invoice = { ...newPartnerInvoice({ goldGramPrice: 10000000 }), calculationVersion: 1, date: '2026-10-07', lines: [line] };
  const before = structuredClone(invoice);
  const payload = preparePartnerInvoice(invoice);
  const totals = partnerInvoiceTotals(payload);
  assert.equal(payload.lines[0].weightMode, 'total');
  assert.equal(payload.lines[0].itemCount, 3);
  assert.equal(payload.lines[0].weight, 4.74);
  assert.equal(totals.actualWeight, 4.74);
  assert.equal(totals.weight750, 4.74);
  assert.equal(totals.laborGold, 0.3318);
  assert.equal(totals.goldDebit, 5.0718);
  assert.equal(totals.tomanDebit, 0);
  assert.deepEqual(invoice, before);
});
test('explicit unit weights multiply by count and lower purity converts principal before labor', () => {
  const totals = partnerLineTotals({ ...line, weight: '۱٫۵۸', weightMode: 'unit', ayar: '۷۴۰' });
  assert.equal(totals.actualWeight, 4.74);
  assert.ok(Math.abs(totals.weight750 - 4.74 * 740 / 750) < 1e-12);
  assert.ok(Math.abs(totals.goldDebit - 4.74 * 740 / 750 * 1.07) < 1e-12);
});
test('legacy mixed invoices keep fiat debt and gold debt without reinterpretation', () => {
  const invoice = { ...newPartnerInvoice({ goldGramPrice: 10000000 }), calculationVersion: 1, lines: [
    { ...line, otherCosts: '۱۰' },
    { ...newPartnerLine({}, 'coin'), itemName: 'سکه', coinCount: '۲', coinPrice: '۵۰۰' },
    { ...newPartnerLine({}, 'currency'), itemName: 'دلار', currencyAmount: '۱٫۵', currencyRate: '۱۰۰' },
  ], paidGold: '۱', paidToman: '۲۵۰' };
  const totals = partnerInvoiceTotals(preparePartnerInvoice(invoice));
  assert.equal(totals.goldDebit, 5.0718);
  assert.equal(totals.tomanDebit, 1180);
  assert.equal(totals.goldCredit, 1);
  assert.equal(totals.tomanCredit, 250);
});
test('full precision line weights are summed before six-decimal ledger rounding', () => {
  const item = { ...line, itemCount: '1', weight: '0.000001', ayar: '740', wagePercent: '0' };
  const totals = partnerInvoiceTotals({ lines: Array.from({ length: 100 }, () => ({ ...item })) });
  assert.equal(totals.goldDebit, 0.000099);
});
test('a gold payment credits only supplier ledger and returns the sample gold balance to zero', () => {
  const payment = preparePartnerSettlement({ ...newPartnerSettlement(), date: '2026-10-07', goldAmount: '۵٫۰۷۱۸', paymentMethod: 'gold', counterpartyName: 'همکار دوم', reference: 'پرداخت ۱۲۳' });
  assert.equal(payment.direction, 'credit');
  assert.equal(payment.goldAmount, 5.0718);
  assert.equal(payment.tomanAmount, 0);
  assert.equal(payment.counterpartyName, 'همکار دوم');
  const partner = { openingGoldBalance: 0, openingTomanBalance: 10, entries: [
    { id: 'buy', type: 'purchase', date: '2026-10-07', createdAt: '2026-10-07T09:00:00Z', goldDebit: 5.0718, goldCredit: 0, tomanDebit: 0, tomanCredit: 0 },
    { id: 'pay', type: 'settlement', date: '2026-10-07', createdAt: '2026-10-07T10:00:00Z', goldDebit: 0, goldCredit: payment.goldAmount, tomanDebit: 0, tomanCredit: 0 },
  ] };
  const statement = partnerStatement(partner);
  assert.equal(statement.rows[1].previousGoldBalance, 5.0718);
  assert.equal(statement.rows[1].documentGoldBalance, -5.0718);
  assert.equal(statement.rows[1].goldBalance, 0);
  assert.equal(statement.goldBalance, 0);
  assert.equal(statement.tomanBalance, 10);
});
test('profile opening credit means our claim on supplier and does not reuse customer debt orientation', () => {
  const form = { ...newPartnerProfile(), name: 'بنکدار', openingGoldBalance: '۲', openingGoldDirection: 'credit', openingTomanBalance: '۱٬۰۰۰' };
  const profile = preparePartnerProfile(form);
  assert.equal(profile.openingGoldBalance, -2);
  assert.equal(profile.openingTomanBalance, 1000);
  assert.equal(partnerStatement(profile).goldBalance, -2);
  assert.ok(!Object.hasOwn(preparePartnerProfile(form, false), 'openingGoldBalance'));
});

test('backdated and imported timezone entries show chronological running balances', () => {
  const statement = partnerStatement({ entries: [
    { id: 'later-day', date: '2026-10-08', createdAt: '2026-10-08T09:00:00Z', goldCredit: 1 },
    { id: 'later-time', date: '2026-10-07', createdAt: '2026-10-07T08:00:00Z', goldCredit: 2 },
    { id: 'earlier-time', date: '2026-10-07', createdAt: '2026-10-07T10:00:00+03:30', goldDebit: 5 },
  ] });
  assert.deepEqual(statement.rows.map(row => row.id), ['earlier-time', 'later-time', 'later-day']);
  assert.deepEqual(statement.rows.map(row => row.goldBalance), [5, 3, 2]);
});
test('malformed grouped numbers nonfinite values and invalid supplier goods cannot be submitted', () => {
  assert.equal(parsePartnerNumber('١٬٢٣٤٫٥'), 1234.5);
  assert.equal(parsePartnerNumber(' -۲٫۵ '), -2.5);
  for (const value of ['', 'abc', Infinity, '1e999', '1,23', '1 2', true]) assert.ok(Number.isNaN(parsePartnerNumber(value)), String(value));
  const invoice = { ...newPartnerInvoice({ goldGramPrice: 1000 }), lines: [line] };
  for (const weight of [0, -1, 'abc', Infinity]) assert.throws(() => preparePartnerInvoice({ ...invoice, lines: [{ ...line, weight }] }));
  for (const ayar of [0, 0.5, 1001, 'abc']) assert.throws(() => preparePartnerInvoice({ ...invoice, lines: [{ ...line, ayar }] }));
  assert.throws(() => preparePartnerInvoice({ ...invoice, lines: [{ ...line, itemCount: 1.5 }] }));
  assert.throws(() => preparePartnerInvoice({ ...invoice, lines: [{ ...line, wagePercent: 101 }] }));
  assert.throws(() => preparePartnerInvoice({ ...invoice, gold18Price: '' }));
  assert.throws(() => preparePartnerSettlement({ ...newPartnerSettlement(), goldAmount: 'abc' }));
  assert.throws(() => preparePartnerSettlement(newPartnerSettlement()));
});

test('legacy blank per-line gold rates inherit the invoice snapshot without affecting gold labor debt', () => {
  const form = { ...newPartnerInvoice({ goldGramPrice: 1000 }), calculationVersion: 1, lines: [{ ...line, gramPrice: '' }] };
  assert.equal(preparePartnerInvoice(form).lines[0].gramPrice, 1000);
  assert.equal(partnerInvoiceTotals(form).lines[0].rate, 1000);
  assert.equal(partnerInvoiceTotals(form).goldDebit, 5.0718);
});

test('partner drafts retain exact pending payload and identity only for their signed-in account', () => {
  const items = new Map();
  const storage = { getItem: key => items.get(key) || null, setItem: (key, value) => items.set(key, value) };
  const pending = { action: 'invoice', partnerId: 'supplier-1', requestId: 'one-stable-request', payload: preparePartnerInvoice({ ...newPartnerInvoice({ goldGramPrice: 1000 }), lines: [line] }) };
  writeAccountingDraft('account-a', 'partner-workspace', { selectedId: 'supplier-1', pending }, pending.requestId, storage);
  assert.deepEqual(readAccountingDraft('account-a', 'partner-workspace', storage).form.pending, pending);
  assert.equal(readAccountingDraft('account-b', 'partner-workspace', storage), null);
  assert.equal(readAccountingDraft('account-a', 'document', storage), null);
});

test('saved invoice details use canonical totals even when original optional purity was omitted', () => {
  const savedLine = { category: 'crafted', itemName: 'النگو', itemCount: 3, weight: 4.74, wagePercent: 7,
    scaleWeight: 4.74, weight750: 4.74, laborGold: 0.3318, goldDebit: 5.0718, tomanDebit: 30 };
  const totals = savedPartnerLineTotals(savedLine, undefined, { settlementUnit: 'gold', gold18Price: 1000 });
  assert.equal(totals.purity, 750);
  assert.equal(totals.actualWeight, 4.74);
  assert.equal(totals.weight750, 4.74);
  assert.equal(totals.laborGold, 0.3318);
  assert.equal(totals.goldDebit, 5.0718);
  assert.equal(totals.tomanDebit, 30);
});

test('saved fiat settlement preserves zero gold debit and authoritative coin currency and metal extras totals', () => {
  const totals = savedPartnerLineTotals({ ...line, goldDebit: 0, tomanDebit: 5071.8 }, undefined, { settlementUnit: 'toman', gold18Price: 1000 });
  assert.equal(totals.goldDebit, 0);
  assert.equal(totals.tomanDebit, 5071.8);
  const coin = savedPartnerLineTotals({ category: 'coin', coinCount: 2, coinPrice: 500, otherCosts: 10, goldDebit: 0, tomanDebit: 1020 });
  assert.equal(coin.goldDebit, 0);
  assert.equal(coin.tomanDebit, 1020);
  const currency = savedPartnerLineTotals({ category: 'currency', currencyAmount: 1.5, currencyRate: 100, tomanDebit: 150 });
  assert.equal(currency.tomanDebit, 150);
});

test('linked stock fallback multiplies its per-unit physical weight and preserves total equivalent gold', () => {
  const document = { category: 'crafted', itemName: 'النگو', itemCount: 3, weight: 1.58, ayar: 750,
    weightMode: 'total', scaleWeight: 4.74, weight750: 1.58, totalWeight750: 4.74, wagePercent: 7,
    laborGold: 0.3318, partnerGoldDebit: 5.0718, otherCosts: 10, gramPrice: 1000, amount: 5101.8 };
  const totals = savedPartnerLineTotals({ documentId: 'stock' }, document, { settlementUnit: 'gold' });
  assert.equal(totals.actualWeight, 4.74);
  assert.equal(totals.weight750, 4.74);
  assert.equal(totals.goldDebit, 5.0718);
  assert.equal(totals.tomanDebit, 30);
  assert.equal(totals.itemName, 'النگو');
  const legacy = { ...document };
  for (const key of ['scaleWeight', 'weight750', 'totalWeight750', 'laborGold', 'partnerGoldDebit']) delete legacy[key];
  const legacyTotals = savedPartnerLineTotals({ documentId: 'stock' }, legacy, { settlementUnit: 'gold' });
  assert.equal(legacyTotals.actualWeight, 4.74);
  assert.equal(legacyTotals.goldDebit, 5.0718);
});

test('new crafted purchase adds editable profit and converts monetary labor costs and payment to gold', () => {
  const form = { ...newPartnerInvoice({ goldGramPrice: 100000 }), lines: [{ ...line, gramPrice: 999999, wageFixed: '2000', otherCosts: '1000', profitPercent: '7' }], paidGold: '1', paidToman: '100000' };
  const payload = preparePartnerInvoice(form);
  const totals = partnerInvoiceTotals(payload);
  assert.equal(payload.calculationVersion, 3);
  assert.equal(payload.lines[0].gramPrice, 100000);
  assert.equal(totals.actualWeight, 4.74);
  assert.equal(totals.fixedLaborGold, 0.06);
  assert.equal(totals.otherCostsGold, 0.03);
  assert.equal(totals.profitGold, 0.361326);
  assert.equal(totals.goldDebit, 5.523126);
  assert.equal(totals.tomanDebit, 0);
  assert.equal(totals.goldCredit, 2);
  assert.equal(totals.cashGoldCredit, 1);
  assert.equal(totals.tomanCredit, 0);
  assert.deepEqual(partnerInvoiceTotals(form), totals);
});

test('profit accepts a smaller percentage or explicit zero and defaults only crafted rows to seven', () => {
  assert.equal(newPartnerLine({}, 'crafted').profitPercent, '7');
  assert.equal(newPartnerLine({}, 'melted').profitPercent, '0');
  assert.equal(newPartnerLine({}, 'coin').profitPercent, '0');
  const invoice = { ...newPartnerInvoice({ goldGramPrice: 100000 }), lines: [{ ...line, weight: 10, wagePercent: 10, profitPercent: 5 }] };
  assert.equal(partnerInvoiceTotals(preparePartnerInvoice(invoice)).goldDebit, 11.55);
  invoice.lines[0].profitPercent = 0;
  assert.equal(partnerInvoiceTotals(preparePartnerInvoice(invoice)).goldDebit, 11);
  invoice.lines[0].profitPercent = -1;
  assert.throws(() => preparePartnerInvoice(invoice));
  invoice.lines[0].profitPercent = 101;
  assert.throws(() => preparePartnerInvoice(invoice));
});

test('rial labor is normalized once to toman before the gold conversion', () => {
  const form = { ...newPartnerInvoice({ goldGramPrice: 5000000 }), lines: [{ ...line, itemCount: 1, weight: 10, wagePercent: 0, profitPercent: 0, wageFixed: '۱۰۰۰۰۰۰۰', wageFixedUnit: 'rial' }] };
  const payload = preparePartnerInvoice(form);
  assert.equal(payload.lines[0].wageFixed, 1000000);
  assert.equal(Object.hasOwn(payload.lines[0], 'wageFixedUnit'), false);
  assert.equal(partnerInvoiceTotals(form).fixedLaborGold, 0.2);
  assert.equal(partnerInvoiceTotals(payload).fixedLaborGold, 0.2);
  assert.equal(partnerInvoiceTotals(payload).goldDebit, 10.2);
});

test('version two coin and melted purchases retain the invoice conversion rate and stock quantities', () => {
  const form = { ...newPartnerInvoice({ goldGramPrice: 100000 }, 'coin'), calculationVersion: 2, lines: [
    { ...newPartnerLine({}, 'coin'), itemName: 'سکه', coinCount: 2, coinPrice: 500000, otherCosts: 10000, profitPercent: 1 },
    { ...newPartnerLine({}, 'melted'), itemName: 'آبشده', itemCount: 3, meltedWeight: 10, meltedAyar: 740, assayCode: '123', laboratoryName: 'آزمایشگاه', profitPercent: 0 },
  ] };
  const payload = preparePartnerInvoice(form);
  const totals = partnerInvoiceTotals(payload);
  assert.equal(payload.lines[0].coinCount, 2);
  assert.equal(payload.lines[1].meltedWeight, 10);
  assert.equal(totals.lines[0].goldDebit, 10.302);
  assert.equal(totals.actualWeight, 10);
  assert.equal(totals.goldDebit, 20.168667);
  assert.equal(totals.tomanDebit, 0);
});

test('unsigned legacy draft upgrade preserves entered values while version one pending payload stays replayable', () => {
  const legacy = { ...newPartnerInvoice({ goldGramPrice: 100000 }), calculationVersion: undefined, lines: [{ ...line, profitPercent: undefined, wageFixed: 2000 }] };
  const before = structuredClone(legacy);
  const upgraded = upgradePartnerInvoiceDraft(legacy);
  assert.equal(upgraded.calculationVersion, 3);
  assert.equal(upgraded.lines[0].wageFixed, 2000);
  assert.equal(upgraded.lines[0].weight, line.weight);
  assert.equal(upgraded.lines[0].profitPercent, '7');
  assert.deepEqual(legacy, before);
  assert.equal(Object.hasOwn(preparePartnerInvoice(legacy), 'calculationVersion'), false);
  assert.equal(partnerInvoiceTotals(preparePartnerInvoice(legacy)).goldDebit, 5.0718);
});

test('saved version two details preserve audited gold values without recomputing historical rates', () => {
  const saved = savedPartnerLineTotals({ ...line, profitPercent: 3, goldDebit: 5.260854, tomanDebit: 0,
    fixedLaborGold: 0.03, otherCostsGold: 0.006, profitGold: 0.153054, conversionGoldPrice: 100000 },
  { gramPrice: 999999 }, { calculationVersion: 2, gold18Price: 100000 });
  assert.equal(saved.goldDebit, 5.260854);
  assert.equal(saved.fixedLaborGold, 0.03);
  assert.equal(saved.profitGold, 0.153054);
  assert.equal(saved.conversionGoldPrice, 100000);
});

test('remittance supports both our debt and our claim while preserving historical credits', () => {
  for (const direction of ['debit', 'credit']) {
    const payload = preparePartnerSettlement({ ...newPartnerSettlement(), direction, goldAmount: '۱۰', paymentMethod: 'remittance' });
    assert.equal(payload.goldAmount, 10);
    assert.equal(payload.direction, direction);
    assert.equal(payload.paymentMethod, 'remittance');
    const statement = partnerStatement({ entries: [{ date: payload.date, [direction === 'debit' ? 'goldDebit' : 'goldCredit']: payload.goldAmount }] });
    assert.equal(statement.goldBalance, direction === 'debit' ? 10 : -10);
  }
  const statement = partnerStatement({ openingGoldBalance: 5, entries: [{ id: 'historical-remittance', date: '2026-10-07', paymentMethod: 'remittance', goldCredit: 2 }] });
  assert.equal(statement.goldBalance, 3);
  assert.equal(statement.rows[0].paymentMethod, 'remittance');
});

test('partner sales require stock selection and carry sale direction without changing purchase replay payloads', () => {
  const invoice = { ...newPartnerInvoice({ goldGramPrice: 1000 }), calculationVersion: 2, lines: [line] };
  assert.equal(Object.hasOwn(preparePartnerInvoice(invoice), 'direction'), false);
  assert.throws(() => preparePartnerInvoice({ ...invoice, direction: 'sale' }), /صندوق/);
  const sale = preparePartnerInvoice({ ...invoice, direction: 'sale', lines: [{ ...line, inventorySourceId: 'stock-1' }] });
  assert.equal(sale.direction, 'sale');
  assert.equal(sale.lines[0].inventorySourceId, 'stock-1');
});

test('one version three document combines crafted purchases coin sales remittances and melted purchases', () => {
  const prices = { goldGramPrice: 25000000, meltedFee: 110000000 };
  const form = { ...newPartnerInvoice(prices), lines: [
    { ...newPartnerLine(prices), itemName: 'کار ساخته', weight: 10, profitPercent: 0 },
    { ...newPartnerLine(prices, 'coin', 'sale'), itemName: 'سکه', coinCount: 2, coinPrice: 100000000, inventorySourceId: 'coin-stock' },
    { ...newPartnerLine(prices, 'remittance'), goldAmount: '۱۰', counterpartyName: 'علی بیگلری', reference: 'حواله ۱۲' },
    { ...newPartnerLine(prices, 'melted'), itemName: 'آبشده', meltedWeight: 20, assayCode: '123', laboratoryName: 'آزمایشگاه' },
  ] };
  const payload = preparePartnerInvoice(form);
  const totals = partnerInvoiceTotals(payload);
  const expectedMelted = 20 * (110000000 / 4.3318) / 25000000;
  assert.equal(payload.calculationVersion, 3);
  assert.deepEqual(payload.lines.map(row => row.category), ['crafted', 'coin', 'remittance', 'melted']);
  assert.equal(payload.lines[1].direction, 'sale');
  assert.equal(payload.lines[1].inventorySourceId, 'coin-stock');
  assert.deepEqual(payload.lines[2], { category: 'remittance', remittanceDirection: 'credit', goldAmount: 10, counterpartyName: 'علی بیگلری', reference: 'حواله ۱۲', note: '' });
  assert.equal(totals.goldDebit, Math.round((10 + expectedMelted) * 1e6) / 1e6);
  assert.equal(totals.goldCredit, 18);
  assert.equal(totals.netGold, Math.round((10 + expectedMelted - 18) * 1e6) / 1e6);
  assert.equal(totals.actualWeight, 30);
  assert.equal(totals.lines[1].goldDebit, 0);
  assert.equal(totals.lines[1].goldCredit, 8);
  assert.deepEqual(partnerInvoiceTotals(form), totals);
});

test('melted fee is independent of gram price and prices purity-adjusted weight without changing literal units', () => {
  const form = { ...newPartnerInvoice({ goldGramPrice: 20 }), lines: [
    { ...newPartnerLine({}, 'melted'), itemName: 'آبشده', itemCount: 2, weightMode: 'unit', meltedWeight: 10,
      meltedAyar: 740, meltedFee: '۱۱۰', meltedGramPrice: 999, assayCode: '42', laboratoryName: 'آزمایشگاه', profitPercent: 0 },
  ] };
  const payload = preparePartnerInvoice(form);
  const result = partnerInvoiceTotals(payload).lines[0];
  const weight750 = 20 * 740 / 750;
  assert.equal(payload.lines[0].meltedFee, 110);
  assert.equal(payload.lines[0].meltedGramPrice, 110 / 4.3318);
  assert.equal(result.actualWeight, 20);
  assert.equal(result.weight750, weight750);
  assert.equal(result.principalGold, weight750 * (110 / 4.3318) / 20);
  assert.ok(Math.abs(result.amount - weight750 * (110 / 4.3318)) < 1e-10);
  const repriced = partnerInvoiceTotals({ ...form, gold18Price: 40 }).lines[0];
  assert.equal(repriced.amount, result.amount);
  assert.equal(repriced.principalGold, result.principalGold / 2);
});

test('melted labor profit and monetary costs follow the independently priced principal', () => {
  const form = { ...newPartnerInvoice({ goldGramPrice: 100 }), lines: [
    { ...newPartnerLine({}, 'melted'), itemName: 'آبشده', meltedWeight: 10, meltedFee: 866.36,
      wagePercent: 10, wageFixed: 50, otherCosts: 25, profitPercent: 5, assayCode: '1', laboratoryName: 'آزمایشگاه' },
  ] };
  const row = partnerInvoiceTotals(preparePartnerInvoice(form)).lines[0];
  assert.ok(Math.abs(row.principalGold - 20) < 1e-12);
  assert.ok(Math.abs(row.laborGold - 2) < 1e-12);
  assert.equal(row.fixedLaborGold, 0.5);
  assert.equal(row.otherCostsGold, 0.25);
  assert.ok(Math.abs(row.profitGold - 1.1375) < 1e-12);
  assert.ok(Math.abs(row.amount - 2388.75) < 1e-8);
});

test('each goods sale needs inventory while purchase and remittance rows do not', () => {
  const goods = [
    { ...line, direction: 'sale' },
    { ...newPartnerLine({ meltedFee: 4331.8 }, 'melted', 'sale'), itemName: 'آبشده', meltedWeight: 1, assayCode: '1', laboratoryName: 'آزمایشگاه' },
    { ...newPartnerLine({}, 'coin', 'sale'), itemName: 'سکه', coinPrice: 500 },
    { ...newPartnerLine({}, 'currency', 'sale'), itemName: 'دلار', currencyAmount: 2, currencyRate: 100 },
  ];
  for (const row of goods) {
    const form = { ...newPartnerInvoice({ goldGramPrice: 1000 }), lines: [row] };
    assert.throws(() => preparePartnerInvoice(form), /صندوق/);
    const payload = preparePartnerInvoice({ ...form, lines: [{ ...row, inventorySourceId: 'stock' }] });
    assert.equal(payload.lines[0].inventorySourceId, 'stock');
    assert.equal(payload.lines[0].direction, 'sale');
    const purchase = preparePartnerInvoice({ ...form, direction: 'sale', lines: [{ ...row, direction: 'purchase' }] });
    assert.equal(purchase.lines[0].direction, 'purchase');
    assert.equal(Object.hasOwn(purchase.lines[0], 'inventorySourceId'), false);
  }
});

test('missing row directions inherit the invoice and payments follow its settlement direction', () => {
  const sale = { ...newPartnerInvoice({ goldGramPrice: 1000 }, 'crafted', 'sale'), lines: [
    { ...line, direction: undefined, weight: 10, wagePercent: 0, profitPercent: 0, inventorySourceId: 'stock' },
  ], paidGold: 2, paidToman: 1000 };
  assert.equal(preparePartnerInvoice(sale).lines[0].direction, 'sale');
  const result = partnerInvoiceTotals(sale);
  assert.equal(result.goldCredit, 10);
  assert.equal(result.goldDebit, 3);
  assert.equal(result.netGold, -7);
  assert.equal(result.cashGoldDebit, 1);
  assert.equal(result.cashGoldCredit, 0);
  const purchase = { ...sale, direction: 'purchase' };
  assert.equal(preparePartnerInvoice(purchase).lines[0].direction, 'purchase');
  assert.equal(partnerInvoiceTotals(purchase).netGold, 7);
});

test('standalone document remittances support either balance direction and reject invalid inputs', () => {
  for (const direction of ['debit', 'credit']) {
    const form = { ...newPartnerInvoice({ goldGramPrice: 1000 }), lines: [{ category: 'remittance', goldAmount: 10, remittanceDirection: direction }] };
    const payload = preparePartnerInvoice(form);
    const result = partnerInvoiceTotals(payload);
    assert.equal(result[direction === 'credit' ? 'goldCredit' : 'goldDebit'], 10);
    assert.equal(result.netGold, direction === 'credit' ? -10 : 10);
    assert.equal(result.actualWeight, 0);
  }
  for (const goldAmount of ['', 0, -1, 'abc']) {
    assert.throws(() => preparePartnerInvoice({ ...newPartnerInvoice({ goldGramPrice: 1000 }), lines: [{ category: 'remittance', goldAmount }] }));
  }
  assert.throws(() => preparePartnerInvoice({ ...newPartnerInvoice({ goldGramPrice: 1000 }), lines: [{ category: 'remittance', goldAmount: 10, remittanceDirection: 'invalid' }] }));
  for (const meltedFee of ['', 0, -1, 'abc']) {
    assert.throws(() => preparePartnerInvoice({ ...newPartnerInvoice({ goldGramPrice: 1000 }), lines: [{
      ...newPartnerLine({}, 'melted'), itemName: 'آبشده', meltedWeight: 10, meltedFee, assayCode: '1', laboratoryName: 'آزمایشگاه',
    }] }), /فی/);
  }
  assert.throws(() => preparePartnerInvoice({ ...newPartnerInvoice({ goldGramPrice: 1000 }), lines: [{ ...line, direction: 'invalid' }] }), /خرید یا فروش/);
});

test('mixed previews use the recorded precision for remittances and converted payments before summing', () => {
  const form = { ...newPartnerInvoice({ goldGramPrice: 3 }, 'crafted', 'sale'), paidToman: 1, lines: [
    { category: 'remittance', remittanceDirection: 'debit', goldAmount: 0.0000015 },
    { ...line, direction: 'purchase', weight: 0.000001, ayar: 740, wagePercent: 0, profitPercent: 0 },
  ] };
  const totals = partnerInvoiceTotals(form);
  assert.equal(totals.lines[0].goldDebit, 0.000002);
  assert.equal(totals.goldDebit, 0.333336);
  assert.equal(totals.convertedPaidTomanGold, 0.333333);
});

test('version three saved rows retain authoritative zero debits sale credits and remittance data', () => {
  const row = savedPartnerLineTotals({ category: 'melted', itemName: 'آبشده', direction: 'sale', meltedWeight: 20,
    meltedAyar: 750, meltedFee: 110, goldDebit: 0, goldCredit: 19, amount: 380, principalGold: 18,
    laborGold: 1, meltedGramPrice: 25.393598966711297 }, {}, { calculationVersion: 3, gold18Price: 20 });
  assert.equal(row.goldDebit, 0);
  assert.equal(row.goldCredit, 19);
  assert.equal(row.netGold, -19);
  assert.equal(row.amount, 380);
  assert.equal(row.principalGold, 18);
  assert.equal(row.laborGold, 1);
  const remittance = savedPartnerLineTotals({ category: 'remittance', remittanceDirection: 'credit', goldAmount: 10, goldDebit: 0, goldCredit: 10 }, {}, { calculationVersion: 3, gold18Price: 20 });
  assert.equal(remittance.goldCredit, 10);
  assert.equal(remittance.itemName, 'حواله طلا');
});

test('draft upgrades preserve prior melted valuation and never mutate version one or two replay payloads', () => {
  assert.equal(newPartnerLine({ goldGramPrice: 100, meltedFee: 110 }, 'melted').meltedFee, '110');
  assert.ok(Math.abs(Number(newPartnerLine({ goldGramPrice: 100 }, 'melted').meltedFee) - 433.18) < 1e-9);
  for (const calculationVersion of [1, 2]) {
    const draft = { ...newPartnerInvoice({ goldGramPrice: 1000 }, 'melted'), calculationVersion, direction: 'sale', lines: [{
      ...newPartnerLine({}, 'melted'), direction: undefined, itemName: 'آبشده', meltedWeight: 10, meltedGramPrice: 2000,
      meltedFee: undefined, assayCode: '1', laboratoryName: 'آزمایشگاه', inventorySourceId: 'stock',
    }] };
    const payload = preparePartnerInvoice(draft);
    const before = structuredClone(payload);
    const upgraded = upgradePartnerInvoiceDraft(draft);
    assert.equal(upgraded.calculationVersion, 3);
    assert.equal(upgraded.lines[0].direction, 'sale');
    assert.ok(Math.abs(Number(upgraded.lines[0].meltedFee) - (calculationVersion === 2 ? 1000 : 2000) * 4.3318) < 1e-9);
    assert.deepEqual(preparePartnerInvoice(draft), before);
    assert.equal(Object.hasOwn(payload.lines[0], 'direction'), false);
    assert.equal(Object.hasOwn(payload.lines[0], 'meltedFee'), false);
  }
});

test('editing saved mixed documents restores total weights frozen fee payment direction and stable row identities', () => {
  const entry = { id: 'mixed-entry', calculationVersion: 3, type: 'mixed', direction: 'sale', date: '2026-10-07',
    externalInvoiceNumber: '123', note: 'سند ترکیبی', gold18Price: 1000, paidGold: 2, paidToman: 500,
    counterpartyName: 'مرجع پرداخت', reference: 'رسید 1', lines: [
      { category: 'crafted', documentId: 'crafted-document', direction: 'purchase', itemName: 'النگو', itemCount: 4,
        weight: 2.5, weightMode: 'total', scaleWeight: 10, ayar: 750, wagePercent: 0, wageFixed: 20, profitPercent: 0 },
      { category: 'melted', documentId: 'melted-document', direction: 'purchase', itemName: 'آبشده', itemCount: 2,
        meltedWeight: 10, weightMode: 'total', scaleWeight: 20, meltedAyar: 740, meltedFee: 8663.6, assayCode: '1', laboratoryName: 'آزمایشگاه', profitPercent: 0 },
      { category: 'coin', documentId: 'coin-document', direction: 'sale', itemName: 'سکه', coinType: 'امامی بانکی ۸۶',
        coinCount: 2, coinPrice: 2000, inventorySourceId: 'coin-source' },
      { category: 'remittance', remittanceDirection: 'credit', goldAmount: 10, counterpartyName: 'همکار دوم', reference: '42' },
    ] };
  const before = structuredClone(entry);
  const draft = partnerInvoiceDraftFromEntry(entry);
  assert.equal(draft.direction, 'sale');
  assert.equal(draft.lines[0].weight, 10);
  assert.equal(draft.lines[0].wageFixed, 20);
  assert.equal(draft.lines[0].wageFixedUnit, 'toman');
  assert.equal(draft.lines[1].meltedWeight, 20);
  assert.equal(draft.lines[1].meltedFee, 8663.6);
  assert.equal(draft.gold18Price, '1000');
  assert.equal(draft.paidGold, 2);
  assert.equal(draft.paidToman, 500);
  assert.equal(draft.referenceName, 'مرجع پرداخت');
  assert.equal(draft.refNumber, 'رسید 1');
  const payload = preparePartnerInvoice(draft);
  assert.deepEqual(payload.lines.slice(0, 3).map(row => row.documentId), ['crafted-document', 'melted-document', 'coin-document']);
  assert.equal(payload.lines[2].inventorySourceId, 'coin-source');
  assert.equal(Object.hasOwn(payload.lines[3], 'documentId'), false);
  assert.equal(partnerInvoiceTotals(payload).actualWeight, 30);
  assert.equal(partnerInvoiceTotals(payload).cashGoldDebit, 0.5);
  assert.deepEqual(entry, before);
});

test('edit reconstruction respects saved per-unit weights and rejects legacy entries', () => {
  const document = { id: 'metal-document', type: 'crafted-sale', category: 'crafted', direction: 'فروش', inventorySourceId: 'source',
    itemName: 'النگو', itemCount: 3, weight: 2, ayar: 750, scaleWeight: 6, weightMode: 'unit', profitPercent: 0 };
  const entry = { calculationVersion: 3, type: 'sale', date: '2026-10-07', gold18Price: 1000, documentIds: ['metal-document'] };
  const draft = partnerInvoiceDraftFromEntry(entry, [document]);
  assert.equal(draft.lines[0].weightMode, 'unit');
  assert.equal(draft.lines[0].weight, 2);
  assert.equal(draft.lines[0].direction, 'sale');
  assert.equal(preparePartnerInvoice(draft).lines[0].documentId, 'metal-document');
  assert.equal(partnerInvoiceTotals(draft).actualWeight, 6);
  assert.equal(partnerInvoiceTotals(draft).goldCredit, 6);
  assert.throws(() => partnerInvoiceDraftFromEntry({ calculationVersion: 2 }), /قدیمی/);
});

test('editing API-created coin rows preserves their recorded labor fields and monetary total', () => {
  const entry = { calculationVersion: 3, type: 'purchase', direction: 'purchase', date: '2026-10-07', gold18Price: 1000, lines: [
    { category: 'coin', documentId: 'coin', direction: 'purchase', itemName: 'سکه', coinType: 'امامی', coinCount: 2,
      coinPrice: 5000, wagePercent: 10, wageFixed: 100, otherCosts: 50, profitPercent: 5 },
  ] };
  const form = partnerInvoiceDraftFromEntry(entry);
  const prepared = preparePartnerInvoice(form);
  const totals = partnerInvoiceTotals(prepared);
  assert.equal(prepared.lines[0].wagePercent, 10);
  assert.equal(prepared.lines[0].wageFixed, 100);
  assert.equal(totals.laborGold, 1);
  assert.equal(totals.fixedLaborGold, 0.2);
  assert.equal(totals.goldDebit, 11.865);
  assert.equal(totals.amount, 11865);
  assert.deepEqual(partnerInvoiceTotals(form), totals);
  assert.equal(savedPartnerLineTotals({ ...entry.lines[0], laborGold: 1 }, {}, entry).laborGold, 1);
});

test('standalone remittance edit drafts restore historical debit or credit without converting gold and money', () => {
  for (const direction of ['debit', 'credit']) {
    const entry = { type: 'settlement', paymentMethod: 'remittance', date: '2026-10-07',
      [direction === 'debit' ? 'goldDebit' : 'goldCredit']: 10,
      [direction === 'debit' ? 'tomanDebit' : 'tomanCredit']: 120000,
      counterpartyName: 'همکار دوم', reference: 'حواله ۱۲', note: 'سند قدیمی' };
    const before = structuredClone(entry);
    const form = partnerSettlementDraftFromEntry(entry);
    assert.equal(form.direction, direction);
    assert.deepEqual(preparePartnerSettlement(form), { date: entry.date, direction, paymentMethod: 'remittance', goldAmount: 10, tomanAmount: 120000,
      counterpartyName: entry.counterpartyName, reference: entry.reference, note: entry.note });
    assert.deepEqual(entry, before);
  }
  assert.throws(() => partnerSettlementDraftFromEntry({ type: 'settlement', paymentMethod: 'remittance', linkedEntryId: 'invoice' }), /مستقل/);
  assert.throws(() => partnerSettlementDraftFromEntry({ type: 'settlement', paymentMethod: 'cash' }), /مستقل/);
  assert.throws(() => partnerSettlementDraftFromEntry({ type: 'settlement', paymentMethod: 'remittance', goldDebit: 10, tomanCredit: 100 }), /هم‌زمان/);
});

test('balance purchase marker survives draft storage and invoice edit reconstruction', () => {
  const form = { ...newPartnerInvoice({ goldGramPrice: 1000 }, 'melted'), goldBalancePurchase: true,
    date: '2026-10-08', lines: [{ ...newPartnerLine({ goldGramPrice: 1000 }, 'melted'),
      itemName: 'آب‌شده تراز', itemCount: '2', meltedWeight: '12', meltedAyar: '900', assayCode: '1234', laboratoryName: 'آزمایشگاه' }] };
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  writeAccountingDraft('test-owner', 'partner-gold-balance', form, null, storage);
  const payload = preparePartnerInvoice(readAccountingDraft('test-owner', 'partner-gold-balance', storage).form);
  assert.equal(payload.goldBalancePurchase, true);
  assert.equal(partnerInvoiceTotals(payload).weight750, 14.4);
  const restored = partnerInvoiceDraftFromEntry({ ...payload, type: 'purchase' });
  assert.equal(preparePartnerInvoice(restored).goldBalancePurchase, true);
  const { goldBalancePurchase, ...ordinary } = form;
  assert.equal(Object.hasOwn(preparePartnerInvoice(ordinary), 'goldBalancePurchase'), false);
});
