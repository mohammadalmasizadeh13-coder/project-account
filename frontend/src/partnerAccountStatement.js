import { parsePartnerNumber, roundPartnerAmount } from './partnerLedger.js';
import { normalizeDigits } from './persianDate.js';
import { ledgerClock } from './recordTime.js';

const number = value => {
  // JSON numbers below 0.000001 stringify in exponent notation, although they
  // are valid saved quantities. The form parser intentionally rejects that text.
  if (typeof value === 'number') return Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER ? value : 0;
  const parsed = parsePartnerNumber(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const isExtraAsset = key => key.startsWith('coin:') || key.startsWith('currency:');
const round = (asset, value) => asset === 'gold' || asset === 'toman' ? roundPartnerAmount(value)
  : (Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 1e8) / 1e8) || 0;

function dateBound(value, label) {
  const date = normalizeDigits(value ?? '').trim();
  if (!date) return '';
  const parsed = new Date(`${date}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(`تاریخ ${label} ته حساب را به صورت معتبر وارد کنید.`);
  }
  return date;
}

function savedPostings(entry, changes, values) {
  const postings = Object.fromEntries(Object.entries(changes).map(([asset, change]) => [asset,
    asset === 'gold' || asset === 'toman'
      ? { debit: values[`${asset}Debit`], credit: values[`${asset}Credit`] }
      : { debit: Math.max(change, 0), credit: Math.max(-change, 0) }]));
  if (entry.calculationVersion !== 5) return postings;
  const sides = { trade: { sale: 'debit', purchase: 'credit' }, delivery: { receive: 'debit', pay: 'credit' },
    offset: { receivable: 'debit', payable: 'credit' } }[entry.type];
  if (!sides) return postings;
  const candidates = {};
  const add = (asset, side, rawQuantity) => {
    const candidate = candidates[asset] ||= { debit: 0, credit: 0, valid: true };
    const quantity = number(rawQuantity);
    if (!['debit', 'credit'].includes(side) || !(quantity > 0)) candidate.valid = false;
    else candidate[side] += quantity;
  };
  for (const line of entry.lines || []) {
    if (typeof line.asset !== 'string' || !['gold', 'toman'].includes(line.asset) && !isExtraAsset(line.asset)) {
      if (entry.type === 'trade') add('toman', undefined, 0);
      continue;
    }
    if (entry.type === 'trade' && line.asset === 'toman') {
      const side = line.simultaneous === true ? { receive: 'debit', pay: 'credit' }[line.direction] : undefined;
      add('toman', side, line.quantity);
    } else {
      const side = sides[line.direction];
      add(line.asset, side, line.quantity);
      // Each trade's frozen monetary amount moves opposite to its asset.
      // The quote is deliberately unused, including for weight-based gold.
      if (entry.type === 'trade') add('toman', side === 'debit' ? 'credit' : side === 'credit' ? 'debit' : undefined, line.amount);
    }
  }
  for (const [asset, candidate] of Object.entries(candidates)) {
    // V5 stores net postings (and omits zero net assetChanges). Saved line
    // quantities and amounts establish gross turnover only when reconciled.
    const debit = round(asset, candidate.debit), credit = round(asset, candidate.credit), savedChange = round(asset, changes[asset] || 0);
    if (!candidate.valid || round(asset, candidate.debit - candidate.credit) !== savedChange || round(asset, debit - credit) !== savedChange) continue;
    changes[asset] ??= 0;
    postings[asset] = { debit, credit };
  }
  return postings;
}

// Read saved ledger postings, never current quotes or cached ending balances.
// Positive balances mean we owe the partner; negative balances are our claims.
export function partnerAccountStatement(partner, { from = '', to = '' } = {}) {
  from = dateBound(from, 'شروع');
  to = dateBound(to, 'پایان');
  if (from && to && from > to) throw new Error('تاریخ شروع ته حساب نباید بعد از تاریخ پایان باشد.');

  const initial = { gold: number(partner?.openingGoldBalance), toman: number(partner?.openingTomanBalance) };
  for (const [asset, value] of Object.entries(partner?.openingAssetBalances || {})) {
    if (isExtraAsset(asset)) initial[asset] = number(value);
  }
  const entries = (partner?.entries || []).map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || ledgerClock(a).localeCompare(ledgerClock(b))
      || (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0) || a.index - b.index);

  const before = { ...initial };
  const selected = [];
  for (const entry of entries) {
    if (to && entry.date > to) continue;
    const values = Object.fromEntries(['goldDebit', 'goldCredit', 'tomanDebit', 'tomanCredit'].map(key => [key, number(entry[key])]));
    const changes = { gold: values.goldDebit - values.goldCredit, toman: values.tomanDebit - values.tomanCredit };
    for (const [asset, value] of Object.entries(entry.assetChanges || {})) {
      if (isExtraAsset(asset)) changes[asset] = number(value);
    }
    const postings = savedPostings(entry, changes, values);
    if (from && entry.date < from) {
      for (const [asset, value] of Object.entries(changes)) before[asset] = (before[asset] || 0) + value;
    } else selected.push({ ...entry, ...values, changes, postings });
  }

  // Discover columns only from the opening and in-period postings. An asset
  // first traded after the report's end must not appear in its balances.
  const assets = [...new Set([...Object.keys(before), ...selected.flatMap(entry => Object.keys(entry.changes))])];
  const snapshot = values => Object.fromEntries(assets.map(asset => [asset, round(asset, values[asset] || 0)]));
  const openingBalances = snapshot(before);
  const balances = { ...before };
  const totals = Object.fromEntries(assets.map(asset => [asset, { debit: 0, credit: 0 }]));
  const rows = selected.map(entry => {
    const previousBalances = snapshot(balances);
    const postings = Object.fromEntries(assets.map(asset => [asset, entry.postings[asset] || { debit: 0, credit: 0 }]));
    for (const asset of assets) {
      const change = entry.changes[asset] || 0;
      balances[asset] = (balances[asset] || 0) + change;
      // Legacy mixed invoices can record both sides in one document. Keep
      // their gross debit/credit totals even when their net change is zero.
      totals[asset].debit += postings[asset].debit;
      totals[asset].credit += postings[asset].credit;
    }
    const current = snapshot(balances);
    return { ...entry, postings, changes: snapshot(entry.changes), previousBalances, balances: current,
      previousGoldBalance: previousBalances.gold, previousTomanBalance: previousBalances.toman,
      documentGoldBalance: round('gold', entry.changes.gold), documentTomanBalance: round('toman', entry.changes.toman),
      goldBalance: current.gold, tomanBalance: current.toman };
  });
  for (const asset of assets) {
    totals[asset].debit = round(asset, totals[asset].debit);
    totals[asset].credit = round(asset, totals[asset].credit);
  }
  return { rows, openingBalances, closingBalances: snapshot(balances), totals, assets };
}
