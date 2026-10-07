import React, { useMemo, useState } from 'react';
import { ArrowLeft, BarChart3, Cake, CalendarClock, Coins, FileText, Gem, PackageOpen, Plus, ReceiptText, Search, TrendingUp, Users, Wallet } from 'lucide-react';
import { number, marketPriceFields, currencyName } from './assets';
import { birthdayReminders, profitReport } from './workspace';
import { salesReport } from './sales';
import { formatPersianDate } from './persianDate';
import { formatRecordDate } from './recordTime';
import { expenseSummary, expenseRateSummary } from './expenses';
import { chequeDirections, chequeStatuses, chequeSummary } from './checks';
import { customerAnalytics } from './crmAnalytics';
import { CRMOverview } from './CRMInsights';
import './workspace.css';

const money = value => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(value || 0);
const decimal = value => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 3 }).format(value || 0);
const entryGroups = [
  { key: 'store', title: 'اسناد فروشگاه', tools: [
    ['cheques', 'چک‌ها', 'ثبت و مدیریت چک دریافتی و پرداختی', Wallet],
    ['opening', 'موجودی اولیه', 'دارایی‌های شروع کار', PackageOpen],
    ['expense', 'هزینه‌های فروشگاه', 'ثبت هزینه‌ها و پرداخت‌های فروشگاه', Wallet],
    ['pricing', 'ثبت نرخ', 'قیمت روز طلا، سکه و ارز', Coins],
    ['gold-entry', 'خرید برای تراز طلا', 'ثبت وزن طلای خریداری‌شده', Gem],
  ] },
  { key: 'customer', title: 'اسناد مشتری', tools: [
    ['register', 'ثبت سند', 'خرید و فروش مشتری', ReceiptText],
    ['customer-entry', 'ثبت مشتری', 'مشخصات، تولد و یادداشت', Users],
    ['settlement-entry', 'دریافت و پرداخت', 'تسویه حساب مشتری', Wallet],
  ] },
  { key: 'partner', title: 'اسناد همکار', tools: [
    ['partner-crafted-purchase', 'خرید کار ساخته', 'خرید کار ساخته از همکار و ورود به صندوق', Gem],
    ['partner-coin-purchase', 'خرید سکه', 'خرید سکه از همکار و ورود به صندوق', Coins],
    ['partner-crafted-sale', 'فروش کار ساخته', 'فروش کار ساخته به همکار و خروج از صندوق', Gem],
    ['partner-coin-sale', 'فروش سکه', 'فروش سکه به همکار و خروج از صندوق', Coins],
    ['partner-melted-purchase', 'خرید آب‌شده', 'ثبت خرید آب‌شده از همکار', ReceiptText],
    ['partner-remittance', 'حواله همکار', 'ثبت حواله بدهکار یا بستانکار همکار', ArrowLeft],
  ] },
];
export const entryTools = entryGroups.flatMap(group => group.tools);
export const reportTools = [
  ['dashboard', 'فروش فروشگاه', 'روند فروش و سهم گروه‌ها', BarChart3], ['profit', 'سود و هزینه‌ها', 'سود درصدی و خالص روز، هفته و ماه', TrendingUp],
  ['products', 'کالاهای پرفروش', 'رتبه‌بندی بر اساس تعداد و مبلغ', PackageOpen], ['balance', 'تراز طلا', 'فروش و خریدهای تراز', Gem],
  ['customer-reports', 'مشتریان برتر', 'مبلغ خرید، تعداد و دریافت‌ها', Users], ['rates', 'نرخ‌های بازار', 'آخرین نرخ‌های ثبت‌شده', Coins],
  ['vault', 'صندوق و دارایی‌ها', 'موجودی و ارزش کل فروشگاه', PackageOpen], ['search', 'دفتر اسناد', 'جستجو در خرید و فروش‌ها', Search], ['cheque-reports', 'وضعیت چک‌ها', 'سررسیدها و مبالغ باز', Wallet],
];
export function ToolHub({ kind, onOpen, canOpen = () => true }) {
  if (kind === 'entries') {
    const groups = entryGroups.map(group => ({ ...group, tools: group.tools.filter(([key]) => canOpen(key.startsWith('partner-') && key !== 'partner-remittance' ? 'partner-invoice' : key)) })).filter(group => group.tools.length);
    return <div className="workspace-hub document-hub"><div className="document-groups">
      {groups.map(group => <section key={group.key} className="document-group" data-document-group={group.key} aria-labelledby={`document-group-${group.key}`}>
        <h2 id={`document-group-${group.key}`}>{group.title}</h2>
        <ul className="document-group-options">{group.tools.map(([key, title, description, Icon]) => <li key={key}>
          <button type="button" data-tool={key} onClick={() => onOpen(key)}>
            <Icon size={20} aria-hidden="true"/>
            <span><strong>{title}</strong><small>{description}</small></span>
            <ArrowLeft size={16} aria-hidden="true"/>
          </button>
        </li>)}</ul>
      </section>)}
    </div></div>;
  }
  return <div className="workspace-hub"><header className="simple-heading"><div><span>دید روشن از فروشگاه</span><h1>کدام گزارش را می‌خواهید؟</h1><p>هر گزارش در صفحه خودش باز می‌شود.</p></div></header><div className="tool-cards">{reportTools.filter(([key]) => canOpen(key)).map(([key, title, description, Icon]) => <button key={key} data-tool={key} onClick={() => onOpen(key)}><span className="tool-card-icon"><Icon size={23}/></span><strong>{title}</strong><small>{description}</small><ArrowLeft size={17}/></button>)}</div></div>;
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
    <div className="home-bottom"><section className="simple-panel"><div className="simple-panel-title"><h2>یادآوری‌ها</h2><CalendarClock size={19}/></div><div className="home-reminders"><button onClick={() => onOpen('cheque-reports')}><Wallet size={18}/><span>چک‌های نیازمند پیگیری</span><b>{money(checks.reminders.total)}</b></button><button onClick={() => onOpen('crm-occasions')}><Cake size={18}/><span>تولدهای امروز و ۷ روز آینده</span><b>{money(birthdays.length)}</b></button><button onClick={() => onOpen('crm-occasions')}><Users size={18}/><span>پیگیری‌های سررسیدشده مشتریان</span><b>{money(due)}</b></button></div></section><section className="simple-panel"><div className="simple-panel-title"><h2>آخرین ثبت‌ها</h2><button onClick={() => onOpen('search')}>دفتر اسناد <ArrowLeft size={14}/></button></div><div className="home-recent">{documents.slice(0, 4).map(doc => <article key={doc.id}><FileText size={16}/><div><strong>{doc.typeLabel || doc.description}</strong><small>{doc.customerName} · {formatRecordDate(doc)}</small></div><b>{money(doc.amount)} <small>تومان</small></b></article>)}{!documents.length && <p>برای شروع، موجودی اولیه یا اولین سند را ثبت کنید.</p>}</div></section></div>
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

export function ProfitPage({ documents, today, onOpen, canOpen = () => true }) {
  const [period, setPeriod] = useState('today');
  const report = profitReport(documents, period, today);
  const incomplete = report.sellerProfitUnknown > 0;
  return <div className="standalone-report profit-page">
    <div className="simple-panel-title"><div><h1>سود فروش و هزینه‌ها</h1><p>سود درصدی فروش‌ها پس از کسر تخفیف و هزینه‌های فروشگاه</p></div><PeriodSelect value={period} onChange={setPeriod}/></div>
    <div className="home-metrics profit-metrics">
      <article data-testid="seller-profit"><span>سود درصدی فروش‌ها</span><strong>{money(report.sellerProfit)} <small>تومان</small></strong><small>۷٪ یا درصد ثبت‌شده در هر سند فروش</small></article>
      <article data-testid="report-expenses"><span>هزینه‌های ثبت‌شده</span><strong>{money(report.expenseTotal)} <small>تومان</small></strong>{canOpen('expense') && <button onClick={() => onOpen('expense')}>ثبت هزینه <Plus size={14}/></button>}</article>
      <article data-testid="net-profit"><span>{incomplete ? 'سود خالص بخش قابل محاسبه' : 'سود خالص'}</span><strong>{money(report.netSellerProfit)} <small>تومان</small></strong><small>سود درصدی − تخفیف − هزینه‌ها</small></article>
    </div>
    <p className="quiet-note profit-formula">سود فروشنده از درصدِ مجموع ارزش جنس، اجرت و هزینه‌های همان سند محاسبه می‌شود. <span data-testid="report-discounts">تخفیف اعمال‌شده در این بازه: {money(report.discounts)} تومان.</span> هزینه‌های عمومی فقط یک‌بار از مجموع سود کم می‌شوند.</p>
    {incomplete && <p className="report-notice" role="status" data-testid="seller-profit-coverage">درصد سود یا اطلاعات قیمتِ {money(report.sellerProfitUnknown)} فروش قدیمی مشخص نیست. مبلغ سود آن‌ها در جمع بالا نیست؛ تخفیف‌ها و تمام هزینه‌های این بازه کسر شده‌اند. سود خالص نمایش‌داده‌شده برای کل فروش‌ها کامل نیست.</p>}
    <details className="simple-details profit-sales"><summary>جزئیات سود فروش‌ها ({money(report.records.length)} سند)</summary>
      <div className="crm-table-scroll"><table className="crm-history"><thead><tr><th>تاریخ / مشتری</th><th>جنس</th><th>درصد سود</th><th>سود فروشنده (تومان)</th><th>تخفیف</th><th>سود پس از تخفیف</th></tr></thead><tbody>
        {report.records.map(row => <tr key={row.sale.id}><td>{formatRecordDate(row.sale)}<small>{row.sale.customerName}</small></td><td>{row.sale.itemName || row.sale.itemSummary}</td><td>{row.sellerProfit === null ? 'نامشخص' : `${decimal(number(row.sale.profitPercent))}٪`}</td><td>{row.sellerProfit === null ? 'نامشخص' : money(row.sellerProfit)}</td><td>{money(row.discount)}</td><td>{row.sellerProfitAfterDiscount === null ? '—' : money(row.sellerProfitAfterDiscount)}</td></tr>)}
      </tbody></table>{!report.records.length && <p className="simple-empty">در این بازه فروشی ثبت نشده است.</p>}</div>
    </details>
    <section className="simple-panel profit-expenses"><div className="simple-panel-title"><h2>هزینه‌های این بازه</h2>{canOpen('expense') && <button onClick={() => onOpen('expense')}>ثبت هزینه <Plus size={14}/></button>}</div>
      {!!report.expenses.length && <>
        <dl className="expense-unit-totals" data-testid="expense-original-totals">
          {report.expenseTotals.toman > 0 && <div><dt>هزینه به تومان</dt><dd>{decimal(report.expenseTotals.toman)} تومان</dd></div>}
          {report.expenseTotals.rial > 0 && <div><dt>هزینه به ریال</dt><dd>{decimal(report.expenseTotals.rial)} ریال</dd></div>}
          {report.expenseTotals.goldWeightGrams > 0 && <div><dt>هزینه به طلا</dt><dd>{decimal(report.expenseTotals.goldWeightGrams)} گرم<small>معادل عیار ۷۵۰: {decimal(report.expenseTotals.goldGrams750)} گرم</small></dd></div>}
          {Object.entries(report.expenseTotals.currencies).map(([code, amount]) => <div key={code}><dt>هزینه به {currencyName(code)}</dt><dd>{decimal(amount)} <bdi>{code}</bdi></dd></div>)}
        </dl>
        <p className="quiet-note">جمع تومانی و سود خالص با نرخ زمان ثبت هر هزینه محاسبه می‌شوند. مقدار اصلی طلا و ارز جدا نگه داشته می‌شود.</p>
      </>}
      {report.expenses.length ? <div className="crm-table-scroll"><table className="crm-history"><thead><tr><th>تاریخ و ساعت</th><th>عنوان هزینه</th><th>پرداخت به</th><th>مقدار اصلی</th><th>معادل ثبت‌شده (تومان)</th></tr></thead><tbody>{report.expenses.map(expense => <tr key={expense.id}><td>{formatRecordDate(expense)}</td><td>{expense.description}<small>{expense.note}</small></td><td>{expense.expensePayee || '—'}</td><td>{expenseSummary(expense)}<small>{expenseRateSummary(expense)}</small></td><td>{money(number(expense.amount))}</td></tr>)}</tbody></table></div> : <p className="simple-empty">در این بازه هزینه‌ای ثبت نشده است.</p>}
    </section>
    <details className="simple-details profit-history"><summary>اختلاف مبلغ فروش و بهای ورود</summary>
      <p className="quiet-note">این محاسبه شامل اختلاف قیمت خرید و فروش جنس است. برای سود درصدی فروشنده و هزینه‌ها، اعداد بالای گزارش را ببینید.</p>
      <div className="home-metrics"><article><span>فروش دارای بهای ورود</span><strong>{money(report.revenue)} <small>تومان</small></strong></article><article><span>بهای ورود جنس‌های فروخته‌شده</span><strong>{money(report.cost)} <small>تومان</small></strong></article><article><span>اختلاف فروش و بهای ورود</span><strong>{report.known ? money(report.grossProfit) : '—'} <small>تومان</small></strong></article></div>
      {report.unknown > 0 && <p className="report-notice">بهای ورود {money(report.unknown)} فروش مشخص نیست؛ مبلغ آن‌ها {money(report.unknownRevenue)} تومان است. <button onClick={() => onOpen('vault')}>بررسی در صندوق</button></p>}
      <div className="crm-table-scroll"><table className="crm-history"><thead><tr><th>سند / مشتری</th><th>فروش (تومان)</th><th>بهای ورود</th><th>اختلاف</th></tr></thead><tbody>{report.records.map(row => <tr key={row.sale.id}><td>{row.sale.customerName}<small>{row.sale.itemName || row.sale.itemSummary}</small></td><td>{money(row.revenue)}</td><td>{row.cost === null ? 'نامشخص' : money(row.cost)}</td><td>{row.profit === null ? '—' : money(row.profit)}</td></tr>)}</tbody></table></div>
    </details>
  </div>;
}
export function PeriodSelect({ value, onChange }) { return <select className="simple-select" aria-label="بازه گزارش" value={value} onChange={event => onChange(event.target.value)}><option value="today">امروز</option><option value="week">۷ روز اخیر</option><option value="month">۳۰ روز اخیر</option></select>; }

export function RatesPage({ prices, onOpen }) {
  return <div className="standalone-report"><div className="simple-panel-title"><div><h1>نرخ‌های طلا، سکه و ارز</h1><p>آخرین نرخ‌های دستی ثبت‌شده، به تومان</p></div>{onOpen && <button className="button button-primary" onClick={() => onOpen('pricing')}>ثبت نرخ جدید</button>}</div><div className="rate-cards">{marketPriceFields.map(([key, label]) => <article key={key}><span>{label}</span><strong>{number(prices[key]) ? money(number(prices[key])) : '—'} <small>تومان</small></strong></article>)}</div><p className="quiet-note">آخرین ثبت: {prices.updatedAt ? new Date(prices.updatedAt).toLocaleString('fa-IR') : 'ثبت نشده'}</p></div>;
}

export function ChequeReportPage({ cheques, today, onEdit }) {
  const summary = chequeSummary(cheques, today);
  const [filter, setFilter] = useState('due');
  const records = filter === 'due' ? summary.reminders.items : cheques;
  return <div className="standalone-report"><div className="simple-panel-title"><div><h1>وضعیت چک‌ها</h1><p>مانده چک‌های باز و سررسیدهای نزدیک</p></div>{onEdit && <button className="button button-primary" onClick={() => onEdit()}>ثبت و مدیریت چک</button>}</div><div className="home-metrics"><article><span>چک دریافتی باز</span><strong>{money(summary.received.amount)} <small>تومان</small></strong></article><article><span>چک پرداختی باز</span><strong>{money(summary.issued.amount)} <small>تومان</small></strong></article><article><span>نیازمند پیگیری</span><strong>{money(summary.reminders.total)} <small>چک</small></strong></article></div><div className="simple-panel-title"><h2>فهرست چک‌ها</h2><select className="simple-select" aria-label="نمایش چک‌ها" value={filter} onChange={event => setFilter(event.target.value)}><option value="due">نیازمند پیگیری</option><option value="all">همه چک‌ها</option></select></div><div className="occasion-list">{records.map(cheque => <button className={`cheque-report-item ${cheque.urgency || ''}`} key={cheque.id} disabled={!onEdit} onClick={onEdit ? () => onEdit(cheque) : undefined}><Wallet size={19}/><span><strong>{cheque.counterparty}</strong><small>{cheque.bank} · {chequeDirections[cheque.direction]} · <time dateTime={cheque.dueDate}>{formatPersianDate(cheque.dueDate)}</time> · {chequeStatuses[cheque.status]}</small>{cheque.recordedAt && <small>{formatRecordDate(cheque, 'issueDate')}</small>}</span><b>{money(cheque.amount)} تومان</b>{onEdit && <ArrowLeft size={16}/>}</button>)}</div>{!records.length && <p className="simple-empty">چکی در این فهرست نیست.</p>}</div>;
}
