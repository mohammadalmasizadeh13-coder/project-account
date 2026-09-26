const goldPriceFormat = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 3 });

export function isTradeDocument(document) {
  return document?.source !== 'opening-inventory' && /^(crafted|coin|melted|currency)-(purchase|sale)$/.test(document?.type || '');
}

export function tradeGoldPriceSummary(document) {
  if (!isTradeDocument(document)) return '';
  const savedPrice = document.gold18Price;
  const price = typeof savedPrice === 'number' || typeof savedPrice === 'string' ? Number(savedPrice) : NaN;
  return Number.isFinite(price) && price > 0
    ? `طلای ۱۸ عیار هنگام ثبت: ${goldPriceFormat.format(price)} تومان / گرم`
    : 'طلای ۱۸ عیار هنگام ثبت: ثبت نشده';
}
