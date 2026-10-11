import { currencyName } from './assets.js';
import { coinOptions } from './coins.js';
import { iranDate } from './sales.js';
import { invoiceTimeNow } from './recordTime.js';
import { parsePartnerNumber } from './partnerLedger.js';

export const operationNames = { trade: 'معاملهٔ حسابی', delivery: 'دریافت / تحویل واقعی', offset: 'تهاتر انتخابی' };
export const directions = { purchase: 'خرید', sale: 'فروش', receive: 'دریافت از همکار', pay: 'پرداخت به همکار', payable: 'کاهش بدهی ما', receivable: 'کاهش طلب ما' };
const num = value => parsePartnerNumber(value) || 0;
const round = (value, places = 6) => Math.round((value + Number.EPSILON) * 10 ** places) / 10 ** places;
export const allBalances = partner => ({ gold: num(partner.goldBalance), toman: num(partner.tomanBalance), ...partner.assetBalances });
export const balanceSide = value => value > 0 ? 'باید بدهیم' : value < 0 ? 'باید بگیریم' : 'تسویه';
export function assetName(key) {
  if (key === 'gold') return 'طلای آب‌شده';
  if (key?.startsWith('coin:')) { const [, name, , , ...extra] = key.split(':'); return extra.join(':') || name; }
  return assetLabel(key);
}
export function assetLabel(key) {
  if (key === 'gold') return 'گرم طلای ۷۵۰';
  if (key === 'toman') return 'تومان';
  if (key?.startsWith('currency:')) return currencyName(key.slice(9));
  const [, name, weight, purity, ...extra] = String(key).split(':');
  return `${extra.join(':') || name || 'دارایی'}${Number(weight) ? ` · ${weight} گرم · عیار ${purity}` : ''}`;
}
export function lineAsset(line) {
  if (line.category === 'melted') return 'gold';
  if (line.category === 'toman') return 'toman';
  if (line.category === 'currency') return `currency:${line.currencyType}`;
  const spec = coinOptions.find(coin => coin.name === line.coinType);
  return `coin:${line.coinType}:${spec?.group === 'ordinary' ? num(line.coinWeight || spec.weight) : 0}:${spec?.group === 'ordinary' ? num(line.coinAyar || spec.ayar) : 0}${line.coinType === 'سایر' ? `:${line.itemName?.trim() || ''}` : ''}`;
}
export function newOperationLine(kind, category = 'melted') {
  return kind === 'offset' ? { asset: '', quantity: '', rate: '' } : { category, direction: kind === 'trade' ? 'purchase' : 'receive',
    inputMode: 'quantity', quantity: '', amount: '', rate: '', coinType: coinOptions[0].name, coinWeight: '', coinAyar: '',
    currencyType: 'IQD', itemName: '', meltedWeight: '', meltedAyar: '750', assayCode: '', laboratoryName: '', inventorySourceId: '' };
}
export function newOperation(kind = 'trade') {
  return { kind, date: iranDate(), invoiceTime: invoiceTimeNow(), note: '', reference: '', cashAmount: '', cashDirection: 'pay', lines: [newOperationLine(kind)] };
}
export function operationDraft(entry) {
  const simultaneous = entry.lines.find(line => line.simultaneous);
  return { ...newOperation(entry.type), date: entry.date, invoiceTime: entry.invoiceTime || '', note: entry.note, reference: entry.reference,
    cashAmount: simultaneous?.quantity || '', cashDirection: simultaneous?.direction || 'pay',
    lines: entry.lines.filter(line => !line.simultaneous).map(line => ({ ...newOperationLine(entry.type, line.category), ...line,
      ...(entry.type === 'delivery' && line.category !== 'toman' ? { quantity: line.stockQuantity } : {}) })) };
}
export function operationPayload(form) {
  const pick = (line, keys) => Object.fromEntries(keys.filter(key => line[key] !== undefined).map(key => [key, line[key]]));
  const lines = form.lines.map(line => {
    if (form.kind === 'offset') return pick(line, ['asset', 'quantity', 'rate']);
    const base = ['category', 'direction'];
    if (line.category === 'coin') base.push('coinType', 'coinWeight', 'coinAyar', 'itemName');
    if (line.category === 'currency') base.push('currencyType');
    if (form.kind === 'trade') return pick(line, [...base, 'quantity', 'rate', 'inputMode', 'amount']);
    return pick(line, [...base, 'quantity', ...(line.direction === 'pay' && line.category !== 'toman' ? ['inventorySourceId'] : ['rate']),
      ...(line.category === 'melted' && line.direction === 'receive' ? ['meltedWeight', 'meltedAyar', 'assayCode', 'laboratoryName', 'itemName'] : [])]);
  });
  return { kind: form.kind, date: form.date, invoiceTime: form.invoiceTime, note: form.note, reference: form.reference, lines,
    cashAmount: form.kind === 'trade' ? form.cashAmount || 0 : 0, cashDirection: form.cashDirection };
}
export function tradeValue(line) {
  const unit = num(line.rate) / (line.category === 'melted' ? 4.3318 : 1);
  const quantity = line.category === 'melted' && line.inputMode === 'amount' ? unit ? round(num(line.amount) / unit) : 0 : num(line.quantity);
  return { quantity, amount: line.category === 'melted' && line.inputMode === 'amount' ? num(line.amount) : round(quantity * unit, 2) };
}
export function operationPreview(form, partner, stock = []) {
  const before = allBalances(partner), changes = {};
  const move = (key, value) => { changes[key] = round((changes[key] || 0) + value, 8); };
  let offsetPayable = 0, offsetReceivable = 0;
  for (const line of form.lines) {
    if (form.kind === 'trade') {
      const { quantity, amount } = tradeValue(line), sign = line.direction === 'sale' ? 1 : -1;
      move(lineAsset(line), sign * quantity); move('toman', -sign * amount);
    } else if (form.kind === 'offset') {
      if (!line.asset) continue;
      const amount = round(num(line.quantity) * (line.asset === 'toman' ? 1 : num(line.rate)), 2);
      if (before[line.asset] > 0) offsetPayable += amount; else offsetReceivable += amount;
      move(line.asset, (before[line.asset] > 0 ? -1 : 1) * num(line.quantity));
    } else {
      const source = line.direction === 'pay' && line.category !== 'toman' ? stock.find(row => row.id === line.inventorySourceId) : line;
      if (!source) continue;
      const quantity = source.category === 'melted' ? round(num(source.meltedWeight) * num(source.meltedAyar) / 750 * (line.direction === 'pay' ? num(line.quantity) : 1)) : num(line.quantity);
      move(lineAsset(source), (line.direction === 'receive' ? 1 : -1) * quantity);
    }
  }
  if (form.kind === 'trade') move('toman', (form.cashDirection === 'pay' ? -1 : 1) * num(form.cashAmount));
  return { changes, after: Object.fromEntries(Object.entries({ ...before, ...changes }).map(([key]) => [key, round((before[key] || 0) + (changes[key] || 0), 8)])), offsetPayable, offsetReceivable };
}
