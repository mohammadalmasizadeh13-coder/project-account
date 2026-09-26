import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPersianDate, normalizeDigits } from './persianDate.js';
import { formatRecordDate, formatRecordTimestamp, newRecordTimestamp } from './recordTime.js';

test('new registration timestamps retain the exact instant and normalize offsets to UTC', () => {
  assert.equal(newRecordTimestamp(new Date('2026-09-25T07:08:09.123Z')), '2026-09-25T07:08:09.123Z');
  assert.equal(newRecordTimestamp('2026-09-25T10:38:09.123+03:30'), '2026-09-25T07:08:09.123Z');
  const before = Date.now();
  const current = Date.parse(newRecordTimestamp());
  assert.ok(current >= before && current <= Date.now());
});

test('record display uses Tehran hours and minutes regardless of machine timezone', () => {
  const record = Object.freeze({ date: '2026-09-25', recordedAt: '2026-09-25T07:08:59.123Z' });
  const expected = `${formatPersianDate(record.date)}، ساعت ۱۰:۳۸`;
  const previousZone = process.env.TZ;
  try {
    for (const zone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
      process.env.TZ = zone;
      assert.equal(formatRecordDate(record), expected);
      assert.equal(formatRecordTimestamp(record), expected);
    }
  } finally {
    if (previousZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousZone;
  }
});

test('Tehran midnight belongs to the next date and displays 00:00 instead of 24:00', () => {
  assert.equal(normalizeDigits(formatRecordDate({ date: '2026-09-24', recordedAt: '2026-09-24T20:29:59Z' })), `${normalizeDigits(formatPersianDate('2026-09-24'))}، ساعت 23:59`);
  assert.equal(normalizeDigits(formatRecordDate({ date: '2026-09-25', recordedAt: '2026-09-24T20:30:00Z' })), `${normalizeDigits(formatPersianDate('2026-09-25'))}، ساعت 00:00`);
});

test('backdated documents distinguish the business date from actual registration date and time', () => {
  const record = { date: '2026-09-22', recordedAt: '2026-09-24T20:30:00Z' };
  assert.equal(formatRecordDate(record), `${formatPersianDate('2026-09-22')} · ثبت: ${formatPersianDate('2026-09-25')}، ساعت ۰۰:۰۰`);
  assert.equal(formatRecordDate({ issueDate: record.date, recordedAt: record.recordedAt }, 'issueDate'), formatRecordDate(record));
});

test('legacy records retain their date-only display and are never backfilled from createdAt', () => {
  for (const record of [
    { date: '2026-09-24' },
    { date: '2026-09-24', createdAt: '2026-09-24T10:11:12Z' },
    { date: '2026-09-24', recordedAt: '' },
    { date: '2026-09-24', recordedAt: 'invalid' },
    { date: '2026-09-24', recordedAt: '2026-09-24' },
    { date: '2026-09-24', recordedAt: '2026-02-30T10:11:12Z' },
  ]) {
    const original = structuredClone(record);
    Object.freeze(record);
    assert.equal(formatRecordDate(record), formatPersianDate(record.date));
    assert.equal(formatRecordTimestamp(record), '');
    assert.deepEqual(record, original);
  }
});
