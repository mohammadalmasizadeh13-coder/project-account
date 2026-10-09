import { normalizeDigits } from './persianDate.js';
import { coinBase, coinOptions, coinSpec, isModernCoin, isOrdinaryCoin, legacyCoinOptions } from './coins.js';

export const number = value => {
  const parsed = Number(normalizeDigits(value ?? '').replace(/[٬,\s]/g, '').replace(/٫/g, '.'));
  return Number.isFinite(parsed) ? parsed : 0;
};
export const coinCatalog = [...coinOptions, ...legacyCoinOptions];
export const currencyCatalog = [
  { code: 'USD', name: 'دلار آمریکا', price: 'usdPrice' },
  { code: 'EUR', name: 'یورو', price: 'eurPrice' },
  { code: 'AED', name: 'درهم امارات', price: 'aedPrice' },
  { code: 'GBP', name: 'پوند انگلیس', price: 'gbpPrice' },
  { code: 'TRY', name: 'لیر ترکیه', price: 'tryPrice' },
];
export const currencyName = code => currencyCatalog.find(item => item.code === code)?.name || code;
export const currencyRate = (code, prices) => number(prices[currencyCatalog.find(item => item.code === code)?.price]);
export const coinRate = (name, prices) => number(prices[coinCatalog.find(item => item.name === name)?.price]);
export const marketPriceFields = [
  ['goldGramPrice', 'قیمت هر گرم طلای ۷۵۰'],
  ['meltedFee', 'فی آب‌شده'],
  ...coinOptions.filter(item => item.price).map(item => [item.price, item.name]),
  ...currencyCatalog.map(item => [item.price, `نرخ ${item.name}`]),
];
export const quantity = doc => number(doc.category === 'currency' ? doc.currencyAmount : doc.category === 'coin' ? (doc.coinCount ?? 1) : (doc.itemCount ?? 1));

// All persisted money and rates use tomans, matching the existing ledger.
// The rial equivalent is converted once, at the asset-report boundary.
export function documentBreakdown(doc, prices = null) {
  const count = quantity(doc);
  let base = 0;
  if (doc.category === 'crafted') base = count * number(doc.weight) * number(doc.ayar || 750) / 750 * (number(prices?.goldGramPrice) || number(doc.gramPrice));
  if (doc.category === 'melted') base = count * number(doc.meltedWeight) * number(doc.meltedAyar || 750) / 750 * (number(prices?.goldGramPrice) || number(doc.meltedGramPrice));
  if (doc.category === 'coin') base = coinBase(doc, prices);
  if (doc.category === 'currency') base = count * ((prices && currencyRate(doc.currencyType, prices)) || number(doc.currencyRate));
  const wage = doc.category === 'currency' ? 0 : base * number(doc.wagePercent) / 100 + count * number(doc.wageFixed);
  const costs = count * number(doc.otherCosts);
  const profit = (base + wage + costs) * number(doc.profitPercent) / 100 + (doc.category === 'coin' && isModernCoin(doc) ? count * number(doc.profitFixed) : 0);
  const gross = base + wage + costs + profit;
  const discount = String(doc.type).endsWith('-sale') || doc.direction === 'فروش'
    ? number(doc.discountRial) + gross * number(doc.discountPercent) / 100 : 0;
  return { base, wage, costs, profit, discount, total: Math.max(0, gross - discount) };
}

export function assetReport(stock, prices = {}) {
  const result = { totalToman: 0, totalRial: 0, equivalentGrams: null, equivalentUsd: null, goldWeightGrams: 0, goldGrams750: 0, goldWithWageGrams750: null, goldWithWageAndProfitGrams750: null, wage: 0, costs: 0, profit: 0, currencies: {}, coins: {}, items: {} };
  let goldWage = 0;
  let goldProfit = 0;
  for (const item of stock.available) {
    const remaining = { ...item, itemCount: item.remaining, coinCount: item.remaining, currencyAmount: item.remaining };
    const value = documentBreakdown(remaining, prices);
    result.items[item.id] = value;
    result.totalToman += value.total;
    result.wage += value.wage; result.costs += value.costs; result.profit += value.profit;
    if (item.category === 'crafted' || item.category === 'melted' || (item.category === 'coin' && isOrdinaryCoin(item))) {
      const ordinary = item.category === 'coin' && isOrdinaryCoin(item);
      const weight = item.remaining * (ordinary ? coinSpec(item).weight : number(item.category === 'crafted' ? item.weight : item.meltedWeight));
      const purity = ordinary ? coinSpec(item).ayar : number((item.category === 'crafted' ? item.ayar : item.meltedAyar) || 750);
      result.goldWeightGrams += weight;
      result.goldGrams750 += weight * purity / 750;
      goldWage += value.wage;
      goldProfit += value.profit;
    }
    if (item.category === 'currency') result.currencies[item.currencyType] = (result.currencies[item.currencyType] || 0) + item.remaining;
    if (item.category === 'coin') result.coins[item.coinType] = (result.coins[item.coinType] || 0) + item.remaining;
  }
  result.totalRial = result.totalToman * 10;
  const goldRate = number(prices.goldGramPrice);
  if (goldRate > 0) {
    result.equivalentGrams = result.totalToman / goldRate;
    // Ordinary coins join crafted and melted gold in these staged weights.
    // Other costs stay separate; profit retains each lot's recorded formula.
    result.goldWithWageGrams750 = result.goldGrams750 + goldWage / goldRate;
    result.goldWithWageAndProfitGrams750 = result.goldGrams750 + (goldWage + goldProfit) / goldRate;
  }
  if (currencyRate('USD', prices) > 0) result.equivalentUsd = result.totalToman / currencyRate('USD', prices);
  return result;
}
