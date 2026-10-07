import test from 'node:test';
import assert from 'node:assert/strict';
import { readAccountingDraft, writeAccountingDraft } from './accountingDrafts.js';
import { newPartnerInvoice, newPartnerLine, newPartnerProfile, newPartnerSettlement, parsePartnerNumber,
  partnerInvoiceTotals, partnerLineTotals, savedPartnerLineTotals, partnerStatement, preparePartnerInvoice, preparePartnerProfile,
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
  assert.equal(payload.calculationVersion, 2);
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

test('coin and melted purchases use the invoice conversion rate and keep stock quantities intact', () => {
  const form = { ...newPartnerInvoice({ goldGramPrice: 100000 }, 'coin'), lines: [
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
  assert.equal(upgraded.calculationVersion, 2);
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

test('new remittance submission remains unavailable while historical remittance credits remain visible', () => {
  assert.throws(() => preparePartnerSettlement({ ...newPartnerSettlement(), goldAmount: 1, paymentMethod: 'remittance' }), /حواله/);
  const statement = partnerStatement({ openingGoldBalance: 5, entries: [{ id: 'historical-remittance', date: '2026-10-07', paymentMethod: 'remittance', goldCredit: 2 }] });
  assert.equal(statement.goldBalance, 3);
  assert.equal(statement.rows[0].paymentMethod, 'remittance');
});
