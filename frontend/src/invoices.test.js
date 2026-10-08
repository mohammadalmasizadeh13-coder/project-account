import test from 'node:test';
import assert from 'node:assert/strict';
import { groupInvoices, invoiceItemName, partnerDocumentRows } from './invoices.js';

test('mixed gold, coin and crafted rows become one ordered invoice with one combined balance', () => {
  const common = { transactionId: 'mixed-sale', invoiceVersion: 1, invoiceLineCount: 3, invoiceNumber: 180, customerId: 'customer', customerName: 'مشتری آزمون', date: '2026-09-27', recordedAt: '2026-09-27T12:00:00Z', direction: 'فروش' };
  const documents = [
    { ...common, id: 'bracelet', invoiceLine: 3, category: 'crafted', itemName: 'النگو', amount: 850, gramDebt: 0, rialDebt: 0 },
    { ...common, id: 'melted', invoiceLine: 1, category: 'melted', amount: 1200, gramDebt: '۰٫۲', rialDebt: '۱٬۰۰۰' },
    { ...common, id: 'coin', invoiceLine: 2, category: 'coin', amount: 500, gramDebt: 0, rialDebt: 0 },
  ];
  const before = structuredClone(documents);
  const invoices = groupInvoices(documents);
  assert.equal(invoices.length, 1);
  assert.deepEqual(invoices[0].rows.map(row => row.id), ['melted', 'coin', 'bracelet']);
  assert.equal(invoices[0].number, 180);
  assert.equal(invoices[0].amount, 2550);
  assert.equal(invoices[0].rialDebt, 1000);
  assert.equal(invoices[0].gramDebt, 0.2);
  assert.equal(invoices[0].customerName, 'مشتری آزمون');
  assert.equal(invoices[0].recordedAt, common.recordedAt);
  assert.deepEqual(documents, before);
});

test('existing sets group by transaction while separate sales and legacy records stay separate', () => {
  const documents = [
    { id: 'set-necklace', setId: 'one-set', transactionId: 'set-purchase', amount: 100, type: 'crafted-purchase' },
    { id: 'legacy-sale', amount: 30, type: 'coin-sale' },
    { id: 'set-bracelet', setId: 'one-set', transactionId: 'set-purchase', amount: 150, type: 'crafted-purchase' },
    { id: 'piece-sale', setId: 'one-set', transactionId: 'separate-sale', amount: 200, type: 'crafted-sale' },
    { amount: 10 }, { amount: 20 },
  ];
  const invoices = groupInvoices(documents);
  assert.equal(invoices.length, 5);
  assert.deepEqual(invoices.map(invoice => invoice.amount), [250, 30, 200, 10, 20]);
  assert.deepEqual(invoices[0].rows.map(row => row.id), ['set-necklace', 'set-bracelet']);
  assert.equal(invoices[0].direction, 'خرید');
  assert.equal(invoices[1].direction, 'فروش');
  assert.equal(invoices[1].number, 'acy-sale');
});

test('grouped invoices retain the recorded customer identity and multiline payment instructions', () => {
  const saved = {
    customerName: 'مشتری آزمون', customerPhone: '09123456789', customerBirthDate: '1990-03-21',
    customerAddress: 'تهران، خیابان اول\nپلاک ۱۲', customerNationalId: '0012345678',
    paymentMethod: 'بخشی کارت به کارت\nباقی مبلغ با چک شماره ۱۲۳',
  };
  const documents = [
    { ...saved, id: 'second', transactionId: 'invoice', invoiceLine: 2, amount: 20 },
    { ...saved, id: 'first', transactionId: 'invoice', invoiceLine: 1, amount: 10 },
    { id: 'legacy', customerName: 'مشتری قدیمی', amount: 30 },
  ];
  const before = structuredClone(documents);
  const [invoice, legacy] = groupInvoices(documents);
  for (const [field, value] of Object.entries(saved)) assert.equal(invoice[field], value);
  assert.equal(invoice.amount, 30);
  assert.equal(legacy.customerName, 'مشتری قدیمی');
  assert.equal(legacy.customerNationalId, undefined);
  assert.equal(legacy.customerBirthDate, undefined);
  assert.equal(legacy.paymentMethod, undefined);
  assert.deepEqual(documents, before);
});

test('invoice totals retain recorded zero and parse Persian amounts, falling back to original rates only', () => {
  const common = { category: 'crafted', type: 'crafted-sale', itemCount: 1, weight: 2, gramPrice: 100, ayar: 750, profitPercent: 7, currentAmount: 999999 };
  const invoices = groupInvoices([
    { ...common, id: 'zero', amount: 0 },
    { ...common, id: 'persian', amount: '۱٬۵۰۰' },
    { ...common, id: 'missing' },
    { id: 'cost', type: 'expense', expenseUnit: 'rial', expenseAmount: 500 },
  ]);
  assert.deepEqual(invoices.map(invoice => invoice.amount), [0, 1500, 214, 50]);
});

test('invoice descriptions use saved names, linked inventory names and legacy category details', () => {
  assert.equal(invoiceItemName({ itemName: 'نام ثبت‌شده' }, { itemName: 'نام جدید' }), 'نام ثبت‌شده');
  assert.equal(invoiceItemName({ description: 'فروش' }, { itemName: 'النگوی قدیمی' }), 'النگوی قدیمی');
  assert.equal(invoiceItemName({ category: 'coin', coinType: 'امامی' }), 'سکه امامی');
  assert.equal(invoiceItemName({ category: 'currency', currencyType: 'USD' }), 'دلار آمریکا');
  assert.deepEqual(groupInvoices([]), []);
  assert.equal(invoiceItemName({ type: 'misc-purchase', category: 'crafted', craftedKind: 'سایر' }), 'طلای متفرقه');
});

test('partner document view keeps purchases, sales and remittance together in original row order', () => {
  const common = { transactionId: 'partner-mixed', invoiceNumber: 91, partnerId: 'partner', counterpartyType: 'partner', createdAt: '2026-10-07T10:00:00Z' };
  const documents = [
    { ...common, id: 'melted', invoiceLine: 3, category: 'melted', type: 'melted-purchase', amount: 3000 },
    { ...common, id: 'coin', invoiceLine: 2, category: 'coin', type: 'coin-sale', amount: 200, inventorySourceId: 'coin-lot' },
    { ...common, id: 'crafted', invoiceLine: 1, category: 'crafted', type: 'crafted-purchase', amount: 1000 },
    { id: 'customer', type: 'crafted-sale', amount: 150, createdAt: '2026-10-06T10:00:00Z' },
  ];
  const entry = { id: 'mixed-entry', type: 'mixed', direction: 'purchase', calculationVersion: 3,
    transactionId: common.transactionId, invoiceNumber: 91, date: '2026-10-07', createdAt: common.createdAt,
    gold18Price: 100, goldDebit: 40, goldCredit: 13, paidGold: 1, paidToman: 0,
    lines: [
      { documentId: 'crafted', category: 'crafted', direction: 'purchase', amount: 1000 },
      { documentId: 'coin', category: 'coin', direction: 'sale', amount: 200 },
      { category: 'remittance', remittanceDirection: 'credit', goldAmount: 10, reference: 'حواله در همین سند' },
      { documentId: 'melted', category: 'melted', direction: 'purchase', amount: 3000 },
    ] };
  const partners = [{ id: 'partner', name: 'همکار', entries: [entry] }];
  const before = structuredClone({ documents, partners });
  const projected = partnerDocumentRows(documents, partners);
  const invoices = groupInvoices(projected);
  assert.equal(invoices.length, 2);
  assert.deepEqual(invoices[0].rows.map(row => row.category), ['crafted', 'coin', 'remittance', 'melted']);
  assert.equal(invoices[0].rows[1].id, 'coin');
  assert.equal(invoices[0].rows[1].inventorySourceId, 'coin-lot');
  assert.equal(invoices[0].rows[2].partnerDisplayOnly, true);
  assert.equal(invoices[0].rows[3].invoiceLine, 4);
  assert.equal(invoices[0].partnerEntryId, entry.id);
  assert.equal(invoices[0].partnerId, 'partner');
  assert.equal(invoices[0].typeLabel, 'سند همکار');
  assert.equal(invoices[0].direction, 'ترکیبی');
  assert.equal(invoices[0].goldDebit, 40);
  assert.equal(invoices[0].goldCredit, 13);
  assert.equal(invoices[0].netGold, 27);
  assert.equal(invoices[0].gramDebt, 27);
  assert.equal(invoices[0].amount, 2700);
  assert.equal(invoices[0].customerName, 'همکار');
  assert.equal(invoices[1].amount, 150);
  assert.equal(projected.at(-1), documents.at(-1));
  assert.deepEqual({ documents, partners }, before);
});

test('remittance-only partner invoices remain visible with zero net and include linked settlement once', () => {
  const entry = { id: 'only-remit', type: 'mixed', calculationVersion: 3, transactionId: 'remittance-transaction', invoiceNumber: 92,
    date: '2026-10-07', createdAt: '2026-10-07T12:00:00Z', gold18Price: 100,
    goldDebit: 10, goldCredit: 8, lines: [
      { category: 'remittance', remittanceDirection: 'debit', goldAmount: 10 },
      { category: 'remittance', remittanceDirection: 'credit', goldAmount: 8 },
    ] };
  const payment = { id: 'settlement', type: 'settlement', linkedEntryId: entry.id, goldCredit: 2 };
  const partner = { id: 'partner', name: 'همکار حواله', entries: [entry, payment] };
  const [invoice] = groupInvoices(partnerDocumentRows([], [partner]));
  assert.equal(invoice.number, 92);
  assert.equal(invoice.rows.length, 2);
  assert.ok(invoice.rows.every(row => row.partnerDisplayOnly && row.category === 'remittance'));
  assert.equal(invoice.goldDebit, 10);
  assert.equal(invoice.goldCredit, 10);
  assert.equal(invoice.netGold, 0);
  assert.equal(invoice.amount, 0);
  assert.equal(invoiceItemName(invoice.rows[0]), 'حواله طلای ۷۵۰');
});

test('legacy partner documents remain unchanged by mixed document projection', () => {
  const old = { id: 'old', transactionId: 'legacy-partner', type: 'crafted-purchase', partnerId: 'partner', amount: 20 };
  const partner = { id: 'partner', entries: [{ id: 'old-entry', transactionId: 'legacy-partner', calculationVersion: 2, lines: [{ documentId: 'old' }] }] };
  const rows = partnerDocumentRows([old], [partner]);
  assert.equal(rows[0], old);
  assert.equal(groupInvoices(rows)[0].amount, 20);
});

test('historical standalone partner remittances become searchable documents without inventing a gold valuation', () => {
  const entry = { id: 'legacy-remit', type: 'settlement', paymentMethod: 'remittance', date: '2026-10-06', createdAt: '2026-10-06T10:00:00Z',
    goldDebit: 0, goldCredit: '۱۰', tomanDebit: 0, tomanCredit: '۲۵۰٬۰۰۰', counterpartyName: 'علی بیگلری', reference: 'حواله ۴۲', note: 'تسویه کار' };
  const partners = [{ id: 'partner', name: 'همکار آزمون', entries: [entry] }];
  const before = structuredClone(partners);
  const rows = partnerDocumentRows([], partners);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].transactionId, 'partner-remittance-legacy-remit');
  assert.equal(rows[0].partnerRemittance, true);
  assert.equal(rows[0].partnerDisplayOnly, true);
  assert.equal(rows[0].goldAmount, 10);
  assert.equal(rows[0].tomanAmount, 250000);
  assert.match(rows[0].itemSummary, /علی بیگلری.*حواله ۴۲.*۱۰ گرم طلای ۷۵۰.*۲۵۰٬۰۰۰ تومان/);
  assert.equal(rows[0].note, 'تسویه کار');
  assert.equal(Object.hasOwn(rows[0], 'gold18Price'), false);
  const [invoice] = groupInvoices(rows);
  assert.equal(invoice.id, 'partner-remittance-legacy-remit');
  assert.equal(invoice.partnerId, 'partner');
  assert.equal(invoice.partnerEntryId, entry.id);
  assert.equal(invoice.partnerRemittance, true);
  assert.equal(invoice.typeLabel, 'حواله همکار');
  assert.equal(invoice.direction, 'بستانکار');
  assert.equal(invoice.goldCredit, 10);
  assert.equal(invoice.gramDebt, -10);
  assert.equal(invoice.rialDebt, -250000);
  assert.equal(invoice.amount, -250000);
  assert.deepEqual(partners, before);
});

test('numbered standalone remittances preserve both units and appear beside mixed documents in time order', () => {
  const partners = [{ id: 'partner', name: 'همکار', entries: [
    { id: 'new-remit', type: 'settlement', paymentMethod: 'remittance', transactionId: 'recorded-remit-transaction', invoiceNumber: 101,
      createdAt: '2026-10-07T11:00:00Z', date: '2026-10-07', goldDebit: 5, tomanDebit: 900 },
    { id: 'gold-only', type: 'settlement', paymentMethod: 'remittance', date: '2026-10-06', createdAt: '2026-10-06T10:00:00Z', goldCredit: 2 },
  ] }];
  const physical = { id: 'customer', type: 'crafted-sale', amount: 20, createdAt: '2026-10-07T10:00:00Z' };
  const grouped = groupInvoices(partnerDocumentRows([physical], partners));
  assert.deepEqual(grouped.map(row => row.id), ['recorded-remit-transaction', 'customer', 'partner-remittance-gold-only']);
  assert.equal(grouped[0].number, 101);
  assert.equal(grouped[0].direction, 'بدهکار');
  assert.equal(grouped[0].netGold, 5);
  assert.equal(grouped[0].netToman, 900);
  assert.equal(grouped[0].amount, 900);
  assert.equal(grouped[2].netGold, -2);
  assert.equal(grouped[2].amount, 0);
  assert.equal(grouped[2].netToman, 0);
});

test('linked remittance invoice payments are never duplicated as standalone documents', () => {
  const entries = [
    { id: 'standalone', type: 'settlement', paymentMethod: 'remittance', goldCredit: 1 },
    { id: 'linked-remit', type: 'settlement', paymentMethod: 'remittance', linkedEntryId: 'legacy-invoice', goldCredit: 2 },
    { id: 'linked-v3', type: 'settlement', paymentMethod: 'remittance', linkedEntryId: 'mixed', goldCredit: 3 },
    { id: 'cash', type: 'settlement', paymentMethod: 'cash', tomanCredit: 10 },
    { id: 'gold', type: 'settlement', paymentMethod: 'gold', goldCredit: 4 },
  ];
  const rows = partnerDocumentRows([], [{ id: 'partner', entries }]);
  assert.deepEqual(rows.map(row => row.partnerEntryId), ['standalone']);
});
