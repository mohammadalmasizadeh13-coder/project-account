import React, { useState } from 'react';
import { Gem, Package, ReceiptText, Search, ShoppingBag, TrendingUp } from 'lucide-react';
import { goldBalance, goldBalancePurchases, goldPurchasesReport, salesReport } from './sales';
import './dashboard.css';
import { PeriodSelect } from './WorkspacePages';
import { formatRecordDate, formatRecordTimestamp } from './recordTime';

const number = value => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 3 }).format(value || 0);
const money = value => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(value || 0);
const dateLabel = value => new Intl.DateTimeFormat('fa-IR', { day: 'numeric', month: 'short' }).format(new Date(`${value}T12:00:00Z`));

export default function SalesDashboard({ documents, prices, helpers, username, goldPurchases = [], onSaveGoldPurchases, canCreateGoldPurchase = false, alerts, view = 'sales', onOpen }) {
  const [period, setPeriod] = useState('today');
  const [query, setQuery] = useState('');
  const [productOrder, setProductOrder] = useState('amount');
  const [purchaseMessage, setPurchaseMessage] = useState(null);
  const report = salesReport(documents, period, helpers);
  const gramPrice = helpers.number(prices.goldGramPrice);
  const purchaseRecords = goldBalancePurchases(goldPurchases, documents);
  const purchases = goldPurchasesReport(purchaseRecords, period);
  const balanceGrams = goldBalance(report.total, gramPrice, purchases.total);
  const removePurchase = id => {
    if (!onSaveGoldPurchases) return;
    try {
      onSaveGoldPurchases(goldPurchases.filter(item => item.id !== id));
      setPurchaseMessage({ type: 'success', text: 'خرید حذف و تراز اصلاح شد.' });
    } catch {
      setPurchaseMessage({ type: 'error', text: 'حذف خرید ذخیره نشد؛ دوباره تلاش کنید.' });
    }
  };
  const periodLabel = period === 'today' ? 'امروز' : period === 'week' ? '۷ روز اخیر' : '۳۰ روز اخیر';
  const products = report.products.filter(item => `${item.name} ${item.category}`.includes(query.trim()) && (productOrder !== 'quantity' || item.category !== 'ارز')).sort((a, b) => b[productOrder] - a[productOrder]);
  const max = Math.max(...report.series.map(item => item.amount), 1);
  const purchaseHistory = [...purchaseRecords].sort((a, b) => b.date.localeCompare(a.date));
  let cursor = 0;
  const gradient = report.categories.map(item => {
    const from = cursor;
    cursor += report.total ? item.amount / report.total * 100 : 0;
    return `${item.color} ${from}% ${cursor}%`;
  }).join(', ');
  const cards = [
    { label: 'مجموع فروش', value: money(report.total), unit: 'تومان', Icon: TrendingUp, tone: 'gold' },
    { label: 'تعداد اجناس فروخته‌شده', value: number(report.count), unit: 'عدد / قطعه', Icon: ShoppingBag, tone: 'green' },
    { label: 'سندهای فروش', value: number(report.invoices), unit: 'سند', Icon: ReceiptText, tone: 'gold' },
    { label: 'وزن طلای فروخته‌شده', value: number(report.totalWeight), unit: 'گرم', Icon: Gem, tone: 'green' },
  ];

  const titles = { sales: 'گزارش فروش', products: 'کالاهای پرفروش', balance: 'تراز طلا' };
  return <div className="sales-dashboard focused-report" data-report-view={view}>
    <header className="simple-panel-title"><div><h1>{titles[view]}</h1><p>گزارش بر اساس سندهای ثبت‌شده فروشگاه</p></div><PeriodSelect value={period} onChange={setPeriod}/></header>
    {view === 'sales' && <>
      <div className="home-metrics">{cards.slice(0,3).map(({label,value,unit}) => <article key={label}><span>{label}</span><strong>{value} <small>{unit}</small></strong></article>)}</div>
              <section className="sd-panel sd-trend"><div className="sd-panel-title"><div><h2>روند فروش</h2><p>مبلغ فروش ثبت‌شده · {periodLabel}</p></div><span className="sd-unit">تومان</span></div>
          <div className="sd-chart" role="img" aria-label={`نمودار فروش ${periodLabel}، مجموع ${money(report.total)} تومان`}>
            <div className="sd-yaxis">{[1, .75, .5, .25, 0].map(value => <span key={value}>{money((max === 1 ? 0 : max) * value)}</span>)}</div>
            <div className="sd-plot"><div className="sd-gridlines">{[1, 2, 3, 4, 5].map(value => <i key={value}/>)}</div><div className="sd-bars">{report.series.map(item => <div className="sd-bar-slot" key={item.date}><div className="sd-bar" tabIndex={0} style={{ height: `${item.amount / max * 100}%`, minHeight: item.amount ? 4 : 0 }} title={`${dateLabel(item.date)}: ${money(item.amount)} تومان`}><span>{money(item.amount)} تومان</span></div><small>{dateLabel(item.date)}</small></div>)}</div>{!report.invoices && <div className="sd-chart-empty"><BarEmpty/><strong>فروش امروز از اینجا شروع می‌شود</strong><span>از منوی «ثبت خرید و فروش» سند جدید ثبت کنید.</span></div>}</div>
          </div>
          <div className="sd-chart-foot"><span><i/> فروش ثبت‌شده</span><small>وزن شامل کار ساخته، آبشده معادل ۷۵۰ و سکه پارسیان است.</small></div>
        </section>

      <details className="simple-details"><summary>سهم گروه‌ها از فروش</summary>        <section className="sd-panel sd-share"><div className="sd-panel-title"><div><h2>سهم هر گروه از فروش</h2><p>بر اساس مبلغ · {periodLabel}</p></div><Package size={18}/></div><div className="sd-share-content"><div className="sd-donut" role="img" aria-label={report.categories.map(item => `${item.label}: ${money(item.amount)} تومان`).join('، ')} style={{ background: report.total ? `conic-gradient(${gradient})` : '#e9eeeb' }}><div><small>مجموع فروش</small><strong>{money(report.total)}</strong><small>تومان</small></div></div><div className="sd-legend">{report.categories.map(item => <div key={item.key}><span><i style={{ background: item.color }}/>{item.label}</span><strong>{number(report.total ? item.amount / report.total * 100 : 0)}٪</strong><small>{money(item.amount)} تومان</small></div>)}</div></div></section>
</details>
    </>}
    {view === 'products' && <><label className="product-order">رتبه‌بندی بر اساس<select className="simple-select" aria-label="ترتیب کالاهای پرفروش" value={productOrder} onChange={event => setProductOrder(event.target.value)}><option value="amount">مبلغ فروش</option><option value="quantity">تعداد جنس (بدون ارز)</option></select></label>    <section className="sd-panel sd-products"><div className="sd-panel-title"><div><h2>فروش به تفکیک جنس</h2><p>تعداد، وزن و مبلغ هر جنس در {periodLabel}</p></div><label className="sd-product-search"><Search size={16}/><input aria-label="جستجوی جنس" value={query} onChange={event => setQuery(event.target.value)} placeholder="جستجوی جنس…"/></label></div><div className="sd-table-scroll"><table><thead><tr><th>نام جنس</th><th>گروه</th><th>تعداد</th><th>وزن (گرم)</th><th>مبلغ فروش (تومان)</th><th>سهم از فروش</th></tr></thead><tbody>{products.map(item => <tr key={item.key}><td><span className="sd-product-name"><span><Gem size={16}/></span>{item.name}</span></td><td>{item.category}</td><td>{number(item.quantity)} {item.unit}</td><td>{item.weight ? number(item.weight) : '—'}</td><td className="sd-sale-amount">{money(item.amount)}</td><td><div className="sd-share-bar"><i style={{ width: `${report.total ? item.amount / report.total * 100 : 0}%` }}/></div><small>{number(report.total ? item.amount / report.total * 100 : 0)}٪</small></td></tr>)}</tbody></table>{!products.length && <div className="sd-table-empty">{query ? 'جنسی با این نام پیدا نشد.' : 'با ثبت سند فروش، گزارش هر جنس اینجا نمایش داده می‌شود.'}</div>}</div></section>
</>}
    {view === 'balance' && <section className="sd-gold-balance">
      <div className="sd-gold-total"><span>تراز طلا · {periodLabel}</span><strong data-testid="gold-balance">{balanceGrams === null ? '—' : number(balanceGrams)} <small>گرم طلای ۷۵۰</small></strong><p>{balanceGrams === null ? 'نرخ طلا را ثبت کنید.' : balanceGrams < 0 ? 'خرید بیشتر از نیاز این بازه' : 'طلای باقی‌مانده برای خرید'}</p></div>
      <div><span>فروش ثبت‌شده</span><strong>{money(report.total)} <small>تومان</small></strong></div><div><span>طلای خریداری‌شده برای تراز</span><strong data-testid="gold-purchased">{number(purchases.total)} <small>گرم</small></strong></div>
      <p className="sd-gold-formula">فروش نقد و نسیه ÷ نرخ فعلی هر گرم طلا − خریدهای ثبت‌شده برای تراز در همین بازه. این عدد معادل ارزش است؛ موجودی واقعی در صندوق نمایش داده می‌شود.</p>
      {canCreateGoldPurchase && onOpen && <button className="button button-primary" data-gold-balance-purchase onClick={() => onOpen('gold-entry')}>ثبت خرید برای تراز</button>}
      <div className="sd-gold-purchases">
        <div className="sd-purchase-heading"><h2>خریدهای تراز طلا</h2></div>
        <p>خرید آب‌شده از همکار که از دکمه این بخش ثبت می‌کنید، با وزن معادل ۷۵۰ به‌صورت خودکار از تراز کم می‌شود. برای اصلاح این خریدها، سند همکار را ویرایش کنید. ثبت‌های قبلی نیز در تراز لحاظ می‌شوند.</p>
        {purchaseMessage && <div role="status" className={`form-message ${purchaseMessage.type}`}>{purchaseMessage.text}</div>}
        <details className="sd-purchase-history"><summary>همه خریدهای ثبت‌شده ({number(purchaseHistory.length)})</summary>
          {purchaseHistory.length ? <ul>{purchaseHistory.map(item => <li key={`${item.purchaseSource}:${item.id}`}><time dateTime={item.date}>{formatRecordTimestamp(item) ? formatRecordDate(item) : dateLabel(item.date)}</time><b>{number(item.grams)} گرم</b><p>{item.purchaseSource === 'invoice' && <span>{item.invoiceNumber ? `سند ${number(item.invoiceNumber)}` : 'سند خرید همکار'}{item.customerName && ` · ${item.customerName}`}{item.externalInvoiceNumber && ` · فاکتور همکار ${item.externalInvoiceNumber}`}</span>}{item.note || 'بدون توضیح'}</p>{item.purchaseSource === 'legacy' && onSaveGoldPurchases && <button type="button" onClick={() => removePurchase(item.id)} aria-label={`حذف خرید ${number(item.grams)} گرم در ${dateLabel(item.date)}`}>حذف</button>}</li>)}</ul> : <p>هنوز خریدی ثبت نشده است.</p>}
        </details>
      </div>
</section>}
  </div>;
}
function BarEmpty() { return <TrendingUp size={25} strokeWidth={1.4}/>; }
