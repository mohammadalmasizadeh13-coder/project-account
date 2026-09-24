import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPersianDate, isoToPersian, normalizeDigits, persianToIso, todayInTehran } from './persianDate.js';

test('Nowruz and leap Esfand preserve the exact calendar day', () => {
  assert.equal(isoToPersian('2024-03-19'), '1402/12/29');
  assert.equal(isoToPersian('2024-03-20'), '1403/01/01');
  assert.equal(persianToIso('1403/12/30'), '2025-03-20');
  assert.equal(persianToIso('1404/01/01'), '2025-03-21');
  assert.equal(persianToIso('1399/12/30'), '2021-03-20');
  assert.equal(persianToIso('1400/12/30'), '');
  assert.equal(persianToIso('1402/12/30'), '');
  assert.equal(persianToIso('1404/12/30'), '');
});

test('Persian and Arabic digits, compact numeric entry and short month/day work', () => {
  assert.equal(normalizeDigits('۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩'), '01234567890123456789');
  for (const input of ['۱۴۰۵/۰۷/۰۲', '١٤٠٥/٠٧/٠٢', '1405/7/2', '۱۴۰۵۰۷۰۲', ' 1405/07/02 ']) {
    assert.equal(persianToIso(input), '2026-09-24');
  }
  assert.equal(formatPersianDate('2026-09-24'), '۱۴۰۵/۰۷/۰۲');
});

test('invalid dates are rejected rather than normalized into a different month', () => {
  for (const input of ['', null, undefined, '1405/00/02', '1405/13/01', '1405/07/31', '1405/06/32', '1405/01/00', '1405/1', '1405/7/2x', '2026-09-24', '0000/01/01', '9999/01/01']) assert.equal(persianToIso(input), '');
  for (const input of ['', null, undefined, '2025-02-29', '2026-09-31', '2026-13-01', '2026-00-01', '2026-01-00', '2026-9-24', '2026-09-24T00:00:00Z']) assert.equal(isoToPersian(input), '');
  assert.equal(formatPersianDate('2026-02-30'), '—');
});

test('roundtrip dates over 1900–2200, including leap days and year boundaries', () => {
  for (let year = 1900; year <= 2200; year += 1) {
    for (const suffix of ['01-01', '02-28', '03-19', '03-20', '03-21', '06-30', '09-22', '12-31']) {
      const iso = `${year}-${suffix}`;
      assert.equal(persianToIso(isoToPersian(iso)), iso, iso);
    }
    if (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) {
      const iso = `${year}-02-29`;
      assert.equal(persianToIso(isoToPersian(iso)), iso, iso);
    }
  }
});

test('today uses Tehran midnight rather than UTC midnight', () => {
  assert.equal(todayInTehran(new Date('2026-09-23T20:29:59Z')), '2026-09-23');
  assert.equal(todayInTehran(new Date('2026-09-23T20:30:00Z')), '2026-09-24');
  assert.equal(todayInTehran('invalid'), '');
});
