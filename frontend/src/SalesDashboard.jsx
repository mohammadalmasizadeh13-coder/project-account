import React, { useState } from 'react';
import NumberInput from './NumberInput.jsx';
import { Coins, Gem, Package, ReceiptText, Search, ShoppingBag, TrendingUp } from 'lucide-react';
import { goldBalance, goldPurchasesReport, iranDate, salesReport } from './sales';
import './dashboard.css';
import PersianDateInput from './PersianDateInput';
import { PeriodSelect } from './WorkspacePages';
import { formatRecordDate, formatRecordTimestamp, newRecordTimestamp } from './recordTime';

const number = value => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 3 }).format(value || 0);
const money = value => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(value || 0);
const dateLabel = value => new Intl.DateTimeFormat('fa-IR', { day: 'numeric', month: 'short' }).format(new Date(`${value}T12:00:00Z`));

export default function SalesDashboard({ documents, prices, helpers, username, goldPurchases = [], onSaveGoldPurchases, alerts, view = 'sales', onOpen }) {
  const [period, setPeriod] = useState('today');
  const [query, setQuery] = useState('');
  const [productOrder, setProductOrder] = useState('amount');
  const [purchaseForm, setPurchaseForm] = useState(() => ({ date: iranDate(), grams: '', note: '' }));
  const [purchaseMessage, setPurchaseMessage] = useState(null);
  const report = salesReport(documents, period, helpers);
  const gramPrice = helpers.number(prices.goldGramPrice);
  const purchases = goldPurchasesReport(goldPurchases, period);
  const balanceGrams = goldBalance(report.total, gramPrice, purchases.total);
  const updatePurchase = event => {
    const { name, value } = event.target;
    setPurchaseForm(current => ({ ...current, [name]: value }));
    setPurchaseMessage(null);
  };
  const savePurchase = event => {
    event.preventDefault();
    if (!onSaveGoldPurchases) return;
    const grams = helpers.number(purchaseForm.grams);
    if (grams <= 0) {
      setPurchaseMessage({ type: 'error', text: 'وزن خرید را بیشتر از صفر وارد کنید.' });
      return;
    }
    const date = purchaseForm.date;
    const parsedDate = new Date(`${date}T12:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date || date > iranDate()) {
      setPurchaseMessage({ type: 'error', text: 'تاریخ معتبر تا امروز را انتخاب کنید.' });
      return;
    }
    try {
      const recordedAt = newRecordTimestamp();
      onSaveGoldPurchases([{ id: crypto.randomUUID(), date, grams, note: purchaseForm.note.trim(), createdAt: recordedAt, recordedAt }, ...goldPurchases]);
      setPurchaseForm(current => ({ ...current, grams: '', note: '' }));
      setPurchaseMessage({ type: 'success', text: 'خرید ثبت شد؛ از تراز بازه‌ای که این تاریخ را شامل شود کم می‌شود.' });
    } catch {
      setPurchaseMessage({ type: 'error', text: 'خرید ذخیره نشد. وضعیت ذخیره‌سازی سرور را بررسی کنید و دوباره تلاش کنید.' });
    }
  };
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
  const purchaseHistory = [...goldPurchases].sort((a, b) => b.date.localeCompare(a.date));
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

  const titles = { sales: 'گزارش فروش', products: 'کالاهای پرفروش', balance: 'تراز طلا', 'gold-entry': 'ثبت خرید برای تراز طلا' };
  return <div className="sales-dashboard focused-report" data-report-view={view}>
    <header className="simple-panel-title"><div><h1>{titles[view]}</h1><p>{view === 'gold-entry' ? 'خریدهای این بخش از تراز طلا کم می‌شوند.' : 'گزارش بر اساس سندهای ثبت‌شده فروشگاه'}</p></div>{view !== 'gold-entry' && <PeriodSelect value={period} onChange={setPeriod}/>}</header>
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
      {onSaveGoldPurchases && onOpen && <button className="button button-primary" onClick={() => onOpen('gold-entry')}>ثبت خرید برای تراز</button>}
    </section>}
    {view === 'gold-entry' && <section className="sd-gold-balance gold-entry-only">      <div className="sd-gold-purchases">
        <div className="sd-purchase-heading"><h2>ثبت طلای خریداری‌شده</h2><span>جمع خرید · {periodLabel}: <b data-testid="gold-purchased">{number(purchases.total)}</b> گرم</span></div>
        <p>وزن را به گرم معادل طلای ۱۸ عیار وارد کنید. هر خرید را یک بار در این بخش ثبت کنید؛ سند خرید به‌تنهایی از این تراز کم نمی‌شود.</p>
        {onSaveGoldPurchases && <form className="sd-purchase-form" onSubmit={savePurchase}>
          <label>تاریخ خرید (شمسی)<PersianDateInput name="date" value={purchaseForm.date} max={iranDate()} onChange={updatePurchase} required/></label>
          <label>وزن خرید (گرم ۱۸ عیار)<NumberInput name="grams" inputMode="decimal" value={purchaseForm.grams} onChange={updatePurchase} placeholder="مثلاً ۱۵" required/></label>
          <label>توضیح خرید<input name="note" value={purchaseForm.note} onChange={updatePurchase} placeholder="اختیاری"/></label>
          <button className="button button-primary" type="submit">ثبت خرید و کسر از تراز</button>
        </form>}
        {purchaseMessage && <div role="status" className={`form-message ${purchaseMessage.type}`}>{purchaseMessage.text}</div>}
        <details className="sd-purchase-history"><summary>همه خریدهای ثبت‌شده ({number(purchaseHistory.length)})</summary>
          {purchaseHistory.length ? <ul>{purchaseHistory.map(item => <li key={item.id}><time dateTime={item.date}>{formatRecordTimestamp(item) ? formatRecordDate(item) : dateLabel(item.date)}</time><b>{number(item.grams)} گرم</b><p>{item.note || 'بدون توضیح'}</p>{onSaveGoldPurchases && <button type="button" onClick={() => removePurchase(item.id)} aria-label={`حذف خرید ${number(item.grams)} گرم در ${dateLabel(item.date)}`}>حذف</button>}</li>)}</ul> : <p>هنوز خریدی ثبت نشده است.</p>}
        </details>
      </div>
</section>}
  </div>;
}
function BarEmpty() { return <TrendingUp size={25} strokeWidth={1.4}/>; }
