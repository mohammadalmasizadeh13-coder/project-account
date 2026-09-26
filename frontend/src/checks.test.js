import test from 'node:test';
import assert from 'node:assert/strict';
import { chequeDaysUntilDue, chequeSummary, getChequeReminders, isChequeDate, upsertCheque, validateCheque } from './checks.js';

const valid = { direction: 'received', counterparty: 'علی رضایی', amount: '25,000,000', bank: 'ملت', number: '0123456789012345', issueDate: '2026-09-24', dueDate: '2026-09-27', note: '', status: 'pending' };

test('reminders include overdue, today and three future days, but never cleared or cancelled cheques', () => {
  const fixtures = [
    { id: 'old', dueDate: '2026-09-01', status: 'pending' },
    { id: 'today', dueDate: '2026-09-24', status: 'pending' },
    { id: 'next', dueDate: '2026-09-25', status: 'pending' },
    { id: 'third', dueDate: '2026-09-27', status: 'bounced' },
    { id: 'fourth', dueDate: '2026-09-28', status: 'pending' },
    { id: 'cleared', dueDate: '2026-09-23', status: 'cleared' },
    { id: 'cancelled', dueDate: '2026-09-24', status: 'cancelled' },
    { id: 'invalid', dueDate: '2026-02-30', status: 'pending' },
  ].map((cheque, index) => ({ ...valid, ...cheque, amount: 100, direction: index % 2 ? 'issued' : 'received' }));
  const reminders = getChequeReminders(fixtures, '2026-09-24');
  assert.deepEqual(reminders.items.map(cheque => cheque.id), ['old', 'today', 'next', 'third']);
  assert.equal(reminders.overdue, 1);
  assert.equal(reminders.today, 1);
  assert.equal(reminders.upcoming, 2);
  assert.equal(reminders.receivedAmount, 200);
  assert.equal(reminders.issuedAmount, 200);
  assert.equal(fixtures[0].status, 'pending');
  assert.equal(fixtures[3].status, 'bounced');
});

test('calendar day calculations handle month/year/leap boundaries without changing dates', () => {
  assert.equal(chequeDaysUntilDue('2027-01-02', '2026-12-30'), 3);
  assert.equal(chequeDaysUntilDue('2024-03-01', '2024-02-28'), 2);
  assert.equal(chequeDaysUntilDue('2026-03-01', '2026-02-28'), 1);
  assert.equal(chequeDaysUntilDue('2026-09-23', '2026-09-24'), -1);
  assert.equal(chequeDaysUntilDue('invalid', '2026-09-24'), null);
  assert.equal(isChequeDate('2026-02-29'), false);
  assert.equal(isChequeDate('2024-02-29'), true);
  assert.equal(isChequeDate('2026-1-01'), false);
});

test('cheque totals retain bounced amounts and separate received and issued outstanding records', () => {
  const summary = chequeSummary([
    { ...valid, amount: 200, status: 'pending' },
    { ...valid, amount: 300, status: 'bounced' },
    { ...valid, direction: 'issued', amount: 100, status: 'pending' },
    { ...valid, amount: 500, status: 'cleared' },
    { ...valid, direction: 'issued', amount: 900, status: 'cancelled' },
  ], '2026-09-24');
  assert.deepEqual(summary.received, { amount: 500, count: 2 });
  assert.deepEqual(summary.issued, { amount: 100, count: 1 });
});

test('Persian and Arabic digits are accepted, full cheque identifiers preserve leading zeros', () => {
  let parsedValue;
  const result = validateCheque({ ...valid, amount: '۲۵٬۰۰۰٬٠٠٠', number: '۰۱۲۳۴۵۶۷۸۹۰۱۲۳۴۵', bank: '  ملت  ' }, [], value => { parsedValue = value; return Number(value); });
  assert.deepEqual(result.errors, {});
  assert.equal(result.record.amount, 25000000);
  assert.equal(parsedValue, '25000000');
  assert.equal(result.record.number, '0123456789012345');
  assert.equal(result.record.bank, 'ملت');
});

test('invalid money/date/status values are rejected without silently coercing them', () => {
  for (const amount of ['0', '-10', '1.5', 'NaN', 'Infinity', '12abc', '1e5', '9007199254740992', '']) {
    assert.ok(validateCheque({ ...valid, amount }).errors.amount, amount);
  }
  const result = validateCheque({ ...valid, counterparty: ' ', bank: '', number: 'abc', dueDate: '2026-02-30', issueDate: '', status: 'unknown' });
  for (const name of ['counterparty', 'bank', 'number', 'dueDate', 'issueDate', 'status']) assert.ok(result.errors[name], name);
  assert.deepEqual(validateCheque({ ...valid, dueDate: '2026-09-01' }).errors, {}, 'existing overdue cheques can be recorded today');
});

test('editing replaces exactly one cheque, preserves identity/creation time, and rejects duplicates', () => {
  const records = upsertCheque([], valid, { id: 'one', now: '2026-09-24T10:00:00Z' });
  assert.equal(records[0].amount, 25000000);
  assert.equal(records[0].recordedAt, '2026-09-24T10:00:00.000Z');
  const original = structuredClone(records);
  const edited = upsertCheque(records, { ...records[0], amount: '۳۰۰۰۰۰۰۰', status: 'cleared', dueDate: '2026-09-29' }, { now: '2026-09-25T10:00:00Z' });
  assert.equal(edited.length, 1);
  assert.equal(edited[0].id, 'one');
  assert.equal(edited[0].createdAt, '2026-09-24T10:00:00Z');
  assert.equal(edited[0].recordedAt, records[0].recordedAt);
  assert.equal(edited[0].updatedAt, '2026-09-25T10:00:00Z');
  assert.equal(edited[0].status, 'cleared');
  assert.equal(edited[0].amount, 30000000);
  assert.deepEqual(records, original);
  assert.throws(() => upsertCheque(records, { ...valid, number: '۰۱۲۳۴۵۶۷۸۹۰۱۲۳۴۵' }), /قبلاً/);
  assert.throws(() => upsertCheque(records, { ...valid, id: 'missing' }), /پیدا نشد|قبلاً/);
  assert.equal(upsertCheque(records, { ...valid, direction: 'issued' }, { id: 'two' }).length, 2);
  assert.equal(getChequeReminders(edited, '2026-10-01').total, 0);
});

test('cheque edits preserve registration time and never add it to legacy cheques', () => {
  const legacy = { ...valid, id: 'legacy', amount: 25000000, createdAt: '2026-09-20T10:00:00Z' };
  const existing = { ...valid, id: 'new', amount: 25000000, recordedAt: '2026-09-24T09:10:00.000Z' };
  for (const original of [legacy, existing]) {
    const before = structuredClone(original);
    const [edited] = upsertCheque([original], { ...original, note: 'Updated', recordedAt: '2026-09-25T11:12:00.000Z' }, { now: '2026-09-25T11:12:00Z' });
    assert.equal(edited.recordedAt, original.recordedAt);
    assert.equal(Object.hasOwn(edited, 'recordedAt'), Object.hasOwn(original, 'recordedAt'));
    assert.deepEqual(original, before);
  }
});
