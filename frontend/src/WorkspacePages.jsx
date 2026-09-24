import React, { useMemo, useState } from 'react';
import { ArrowLeft, BarChart3, Cake, CalendarClock, Coins, FileText, Gem, PackageOpen, Plus, ReceiptText, Search, TrendingUp, Users, Wallet } from 'lucide-react';
import { number, marketPriceFields } from './assets';
import { birthdayReminders, profitReport } from './workspace';
import { salesReport } from './sales';
import { formatPersianDate } from './persianDate';
import { chequeDirections, chequeStatuses, chequeSummary } from './checks';
import { customerAnalytics } from './crmAnalytics';
import { CRMOverview } from './CRMInsights';
import './workspace.css';

const money = value => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(value || 0);
const decimal = value => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 3 }).format(value || 0);
export const entryTools = [
  ['register', 'سند خرید و فروش', 'طلا، سکه، آب‌شده و ارز', ReceiptText], ['opening', 'موجودی اولیه', 'دارایی‌های شروع کار', PackageOpen],
  ['cheques', 'ثبت و مدیریت چک', 'چک دریافتی و پرداختی', Wallet], ['pricing', 'ثبت نرخ‌ها', 'قیمت روز طلا، سکه و ارز', Coins],
  ['customer-entry', 'ثبت مشتری', 'مشخصات، تولد و یادداشت', Users], ['settlement-entry', 'دریافت و پرداخت', 'تسویه حساب مشتری', Wallet], ['gold-entry', 'خرید برای تراز طلا', 'ثبت وزن طلای خریداری‌شده', Gem],
];
export const reportTools = [
  ['dashboard', 'فروش فروشگاه', 'روند فروش و سهم گروه‌ها', BarChart3], ['profit', 'سود فروش', 'سود ناخالص روز، هفته و ماه', TrendingUp],
  ['products', 'کالاهای پرفروش', 'رتبه‌بندی بر اساس تعداد و مبلغ', PackageOpen], ['balance', 'تراز طلا', 'فروش و خریدهای تراز', Gem],
  ['customer-reports', 'مشتریان برتر', 'مبلغ خرید، تعداد و دریافت‌ها', Users], ['rates', 'نرخ‌های بازار', 'آخرین نرخ‌های ثبت‌شده', Coins],
  ['vault', 'صندوق و دارایی‌ها', 'موجودی و ارزش کل فروشگاه', PackageOpen], ['search', 'دفتر اسناد', 'جستجو در خرید و فروش‌ها', Search], ['cheque-reports', 'وضعیت چک‌ها', 'سررسیدها و مبالغ باز', Wallet],
];
export function ToolHub({ kind, onOpen }) {
  const entries = kind === 'entries';
  return <div className="workspace-hub"><header className="simple-heading"><div><span>{entries ? 'همه ثبت‌ها در یک جا' : 'دید روشن از فروشگاه'}</span><h1>{entries ? 'چه چیزی ثبت می‌کنید؟' : 'کدام گزارش را می‌خواهید؟'}</h1><p>{entries ? 'نوع ثبت را انتخاب کنید تا فرم مربوط باز شود.' : 'هر گزارش در صفحه خودش باز می‌شود.'}</p></div></header><div className="tool-cards">{(entries ? entryTools : reportTools).map(([key, title, description, Icon]) => <button key={key} data-tool={key} onClick={() => onOpen(key)}><span className="tool-card-icon"><Icon size={23}/></span><strong>{title}</strong><small>{description}</small><ArrowLeft size={17}/></button>)}</div></div>;
}

export function HomePage({ username, documents, prices, assets, customers, cheques, today, helpers, onOpen }) {
  const sales = salesReport(documents, 'today', helpers, today);
  const profit = profitReport(documents, 'today', today);
  const checks = chequeSummary(cheques, today);
  const birthdays = birthdayReminders(customers, today);
  const due = customers.filter(customer => customer.followUpDate && customer.followUpDate <= today).length;
  const rates = [['goldGramPrice', 'هر گرم طلای ۷۵۰'], ['usdPrice', 'دلار آمریکا'], [number(prices.bankEmami86Price) ? 'bankEmami86Price' : 'emamiCoinPrice', number(prices.bankEmami86Price) ? 'امامی بانکی ۸۶' : 'سکه امامی']];
  return <div className="home-page"><header className="simple-heading"><div><span>سلام {username}</span><h1>امروز در فروشگاه</h1><p>{formatPersianDate(today)} · خلاصه فعالیت‌ها</p></div><button className="button button-primary" data-tool="register" onClick={() => onOpen('register')}><Plus size={17}/> ثبت سند جدید</button></header>
    <div className="home-metrics"><article><span>فروش امروز</span><strong>{money(sales.total)} <small>تومان</small></strong><small>{money(sales.invoices)} سند فروش</small></article><article><span>سود ناخالص امروز</span><strong>{profit.known ? money(profit.grossProfit) : '—'} <small>تومان</small></strong><small>{profit.unknown ? `${money(profit.unknown)} فروش با بهای ورود نامشخص` : 'بر پایه بهای ورود جنس‌های فروخته‌شده'}</small></article><article><span>ارزش موجودی صندوق</span><strong>{money(assets.totalToman)} <small>تومان</small></strong><button onClick={() => onOpen('vault')}>مشاهده صندوق <ArrowLeft size={13}/></button></article></div>
    <section className="home-rates"><div className="simple-panel-title"><h2>نرخ‌های اصلی</h2><button onClick={() => onOpen('rates')}>همه نرخ‌ها <ArrowLeft size={14}/></button></div><div>{rates.map(([key, label]) => <article key={key}><span>{label}</span><strong>{number(prices[key]) ? money(number(prices[key])) : 'ثبت نشده'} <small>تومان</small></strong></article>)}</div><small>آخرین ثبت دستی: {prices.updatedAt ? new Date(prices.updatedAt).toLocaleString('fa-IR') : 'زمان ثبت مشخص نیست'}</small></section>
    <div className="home-bottom"><section className="simple-panel"><div className="simple-panel-title"><h2>یادآوری‌ها</h2><CalendarClock size={19}/></div><div className="home-reminders"><button onClick={() => onOpen('cheque-reports')}><Wallet size={18}/><span>چک‌های نیازمند پیگیری</span><b>{money(checks.reminders.total)}</b></button><button onClick={() => onOpen('crm-occasions')}><Cake size={18}/><span>تولدهای امروز و ۷ روز آینده</span><b>{money(birthdays.length)}</b></button><button onClick={() => onOpen('crm-occasions')}><Users size={18}/><span>پیگیری‌های سررسیدشده مشتریان</span><b>{money(due)}</b></button></div></section><section className="simple-panel"><div className="simple-panel-title"><h2>آخرین ثبت‌ها</h2><button onClick={() => onOpen('search')}>دفتر اسناد <ArrowLeft size={14}/></button></div><div className="home-recent">{documents.slice(0, 4).map(doc => <article key={doc.id}><FileText size={16}/><div><strong>{doc.typeLabel || doc.description}</strong><small>{doc.customerName} · {formatPersianDate(doc.date)}</small></div><b>{money(doc.amount)} <small>تومان</small></b></article>)}{!documents.length && <p>برای شروع، موجودی اولیه یا اولین سند را ثبت کنید.</p>}</div></section></div>
    {!documents.length && <button className="home-start" onClick={() => onOpen('opening')}>اولین بار است وارد شده‌اید؟ ثبت موجودی اولیه <ArrowLeft size={16}/></button>}
  </div>;
}

export function CustomerReports({ customers, documents, today, onSelect }) {
  const [options, setOptions] = useState({ days: 30, category: 'all' });
  const [query, setQuery] = useState('');
  const rows = useMemo(() => customers.map(customer => customerAnalytics(customer, documents, { ...options, today })), [customers, documents, options, today]);
  return <div className="standalone-report"><label className="crm-search"><Search size={17}/><input aria-label="جستجوی مشتری" placeholder="نام یا شماره مشتری" value={query} onChange={event => setQuery(event.target.value)}/></label><CRMOverview rows={rows} query={query} options={options} onOptions={setOptions} onSelect={onSelect} compact/></div>;
}

export function CustomerOccasions({ customers, today, onSelect }) {
  const [horizon, setHorizon] = useState(7);
  const birthdays = birthdayReminders(customers, today, horizon);
  const followups = customers.filter(customer => customer.followUpDate && customer.followUpDate <= today).sort((a, b) => a.followUpDate.localeCompare(b.followUpDate));
  return <section className="customer-occasions"><div className="simple-panel-title"><div><h2><Cake size={21}/> تولدها و فرصت‌های ارتباط</h2><p>برای تبریک، جشنواره یا پیشنهاد متناسب با سلیقه مشتری برنامه‌ریزی کنید.</p></div><select aria-label="بازه اعلان تولد" value={horizon} onChange={event => setHorizon(Number(event.target.value))}><option value="0">تولدهای امروز</option><option value="7">تا ۷ روز آینده</option><option value="30">تا ۳۰ روز آینده</option></select></div><div className="occasion-list">{birthdays.map(item => <button key={item.customer.id} data-birthday-customer={item.customer.id} onClick={() => onSelect(item.customer.id)}><span className="occasion-icon"><Cake size={22}/></span><span><strong>{item.customer.name}</strong><small>{formatPersianDate(item.date)}{item.leapAdjusted ? ' · یادآوری اسفند ۳۰ در آخرین روز سال' : ''}</small></span><b>{item.offset === 0 ? 'امروز' : `${money(item.offset)} روز دیگر`}</b><ArrowLeft size={15}/></button>)}{!birthdays.length && <p className="simple-empty">در این بازه تولدی ثبت نشده است. تاریخ تولد را در پرونده مشتری وارد کنید.</p>}</div><p className="quiet-note">تولدها بر اساس تقویم شمسی یادآوری می‌شوند. این بخش فقط اعلان داخل برنامه است.</p><details className="simple-details" open={followups.length > 0}><summary>پیگیری‌های سررسیدشده ({money(followups.length)})</summary><div className="occasion-list">{followups.map(customer => <button key={customer.id} onClick={() => onSelect(customer.id)}><CalendarClock size={19}/><span><strong>{customer.name}</strong><small>{formatPersianDate(customer.followUpDate)} · {customer.note || 'یادداشت پیگیری ثبت نشده'}</small></span><ArrowLeft size={15}/></button>)}{!followups.length && <p>پیگیری سررسیدشده‌ای ندارید.</p>}</div></details></section>;
}

export function ProfitPage({ documents, today, onOpen }) {
  const [period, setPeriod] = useState('today');
  const report = profitReport(documents, period, today);
  return <div className="standalone-report"><div className="simple-panel-title"><div><h1>سود ناخالص فروش</h1><p>مبلغ فروش منهای بهای ورود مقدار فروخته‌شده</p></div><PeriodSelect value={period} onChange={setPeriod}/></div><div className="home-metrics"><article><span>فروش دارای بهای ورود</span><strong>{money(report.revenue)} <small>تومان</small></strong></article><article><span>بهای ورود جنس‌های فروخته‌شده</span><strong>{money(report.cost)} <small>تومان</small></strong></article><article><span>سود ناخالص</span><strong>{report.known ? money(report.grossProfit) : '—'} <small>تومان</small></strong></article></div><p className="quiet-note">اجرت و هزینه‌های ثبت‌شده در بهای ورود لحاظ می‌شوند. هزینه‌های عمومی فروشگاه از این عدد کم نشده‌اند. برای موجودی اولیه، ارزش ثبت‌شده هنگام ورود مبناست.</p>{report.unknown > 0 && <p className="report-notice">بهای ورود {money(report.unknown)} فروش مشخص نیست؛ مبلغ آن‌ها {money(report.unknownRevenue)} تومان است و در سود بالا محاسبه نشده. <button onClick={() => onOpen('vault')}>بررسی اتصال فروش‌ها در صندوق</button></p>}<details className="simple-details"><summary>جزئیات محاسبه ({money(report.records.length)} سند)</summary><div className="crm-table-scroll"><table className="crm-history"><thead><tr><th>سند / مشتری</th><th>فروش (تومان)</th><th>بهای ورود</th><th>سود ناخالص</th></tr></thead><tbody>{report.records.map(row => <tr key={row.sale.id}><td>{row.sale.customerName}<small>{row.sale.itemName || row.sale.itemSummary}</small></td><td>{money(row.revenue)}</td><td>{row.cost === null ? 'نامشخص' : money(row.cost)}</td><td>{row.profit === null ? '—' : money(row.profit)}</td></tr>)}</tbody></table></div></details></div>;
}
export function PeriodSelect({ value, onChange }) { return <select className="simple-select" aria-label="بازه گزارش" value={value} onChange={event => onChange(event.target.value)}><option value="today">امروز</option><option value="week">۷ روز اخیر</option><option value="month">۳۰ روز اخیر</option></select>; }

export function RatesPage({ prices, onOpen }) {
  return <div className="standalone-report"><div className="simple-panel-title"><div><h1>نرخ‌های طلا، سکه و ارز</h1><p>آخرین نرخ‌های دستی ثبت‌شده، به تومان</p></div><button className="button button-primary" onClick={() => onOpen('pricing')}>ثبت نرخ جدید</button></div><div className="rate-cards">{marketPriceFields.map(([key, label]) => <article key={key}><span>{label}</span><strong>{number(prices[key]) ? money(number(prices[key])) : '—'} <small>تومان</small></strong></article>)}</div><p className="quiet-note">آخرین ثبت: {prices.updatedAt ? new Date(prices.updatedAt).toLocaleString('fa-IR') : 'ثبت نشده'}</p></div>;
}

export function ChequeReportPage({ cheques, today, onEdit }) {
  const summary = chequeSummary(cheques, today);
  const [filter, setFilter] = useState('due');
  const records = filter === 'due' ? summary.reminders.items : cheques;
  return <div className="standalone-report"><div className="simple-panel-title"><div><h1>وضعیت چک‌ها</h1><p>مانده چک‌های باز و سررسیدهای نزدیک</p></div><button className="button button-primary" onClick={() => onEdit()}>ثبت و مدیریت چک</button></div><div className="home-metrics"><article><span>چک دریافتی باز</span><strong>{money(summary.received.amount)} <small>تومان</small></strong></article><article><span>چک پرداختی باز</span><strong>{money(summary.issued.amount)} <small>تومان</small></strong></article><article><span>نیازمند پیگیری</span><strong>{money(summary.reminders.total)} <small>چک</small></strong></article></div><div className="simple-panel-title"><h2>فهرست چک‌ها</h2><select className="simple-select" aria-label="نمایش چک‌ها" value={filter} onChange={event => setFilter(event.target.value)}><option value="due">نیازمند پیگیری</option><option value="all">همه چک‌ها</option></select></div><div className="occasion-list">{records.map(cheque => <button className={`cheque-report-item ${cheque.urgency || ''}`} key={cheque.id} onClick={() => onEdit(cheque)}><Wallet size={19}/><span><strong>{cheque.counterparty}</strong><small>{cheque.bank} · {chequeDirections[cheque.direction]} · <time dateTime={cheque.dueDate}>{formatPersianDate(cheque.dueDate)}</time> · {chequeStatuses[cheque.status]}</small></span><b>{money(cheque.amount)} تومان</b><ArrowLeft size={16}/></button>)}</div>{!records.length && <p className="simple-empty">چکی در این فهرست نیست.</p>}</div>;
}
