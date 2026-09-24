import React, { useState } from 'react';
import { Download, Trophy, TrendingUp, ShoppingBag, CalendarClock } from 'lucide-react';
import { customerRankingCsv, normalizeCustomerText, purchaseGroups, rankCustomers, sortPreferences } from './crmAnalytics';
import { formatPersianDate } from './persianDate';

const numeric = value => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 3 }).format(value || 0);
const money = value => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(value || 0);
const date = value => value ? formatPersianDate(value) : 'بدون خرید';
const metrics = { purchased: 'بیشترین مبلغ خرید', itemCount: 'بیشترین تعداد جنس', craftedQuantity: 'بیشترین تعداد کار ساخته', received: 'بیشترین دریافت ثبت‌شده', invoices: 'بیشترین دفعات خرید (سند)', goldGrams: 'بیشترین وزن طلای ۷۵۰', averagePurchase: 'بیشترین میانگین خرید', lastPurchase: 'تازه‌ترین خرید' };

export function CRMOverview({ rows, query, options, onOptions, onSelect, compact = false }) {
  const [metric, setMetric] = useState('purchased');
  const [segment, setSegment] = useState('all');
  const [limit, setLimit] = useState(10);
  const matches = rows.filter(row => normalizeCustomerText(`${row.customer.name} ${row.customer.phone} ${row.customer.tag}`).includes(normalizeCustomerText(query))
    && (segment === 'all' || (segment === 'due' ? row.followUpDue : segment === 'inactive' ? row.inactive : segment === 'debtor' ? row.debtor : segment === 'repeat' ? row.purchaseDays >= 3 : row.invoices > 0)));
  const ranked = rankCustomers(matches, metric);
  const total = rows.reduce((sum, row) => sum + row.purchased, 0);
  const leader = rankCustomers(rows, 'purchased').find(row => row.purchased > 0);
  const quantityLeader = rankCustomers(rows, 'itemCount').find(row => row.itemCount > 0);
  const receiptLeader = rankCustomers(rows, 'received').find(row => row.received > 0);
  const download = () => {
    const url = URL.createObjectURL(new Blob([customerRankingCsv(ranked)], { type: 'text/csv;charset=utf-8;' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'customer-ranking.csv'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className="crm-overview" aria-label="تحلیل و رتبه‌بندی مشتریان">
    <div className="crm-insights-heading"><div><span className="crm-eyebrow">شناخت مشتری‌ها</span><h2><TrendingUp size={23}/> رفتار خرید و مشتریان برتر</h2><p>خرید مشتری از فروشگاه، بر اساس مبلغ ثبت‌شده فاکتور و پس از تخفیف</p></div><div className="crm-report-controls">
      <label>بازه تحلیل<select aria-label="بازه تحلیل مشتریان" value={options.days} onChange={event => { onOptions({ ...options, days: Number(event.target.value) }); setLimit(10); }}><option value="0">همه سوابق تا امروز</option><option value="30">۳۰ روز اخیر</option><option value="90">۹۰ روز اخیر</option><option value="365">۳۶۵ روز اخیر</option></select></label>
      <label>گروه خرید<select aria-label="گروه خرید مشتریان" value={options.category} onChange={event => { onOptions({ ...options, category: event.target.value }); setLimit(10); }}><option value="all">همه گروه‌ها</option>{Object.entries(purchaseGroups).filter(([key]) => key !== 'other').map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    </div></div>
    {!compact && <div className="crm-overview-stats"><article><span>مبلغ خرید در بازه</span><strong>{money(total)} <small>تومان</small></strong><small>{numeric(rows.filter(row => row.invoices > 0).length)} مشتری خریدار</small></article><article><span>مشتریان با خرید تکراری</span><strong>{numeric(rows.filter(row => row.purchaseDays >= 3).length)} <small>نفر</small></strong><small>خرید در حداقل ۳ روز متفاوت، کل سوابق</small></article><article><span>پیگیری سررسیدشده</span><strong>{numeric(rows.filter(row => row.followUpDue).length)} <small>نفر</small></strong><button onClick={() => { setSegment('due'); setLimit(10); }}>نمایش فهرست پیگیری</button></article><article><span>۹۰ روز بدون خرید</span><strong>{numeric(rows.filter(row => row.inactive).length)} <small>نفر</small></strong><button onClick={() => { setSegment('inactive'); setLimit(10); }}>نمایش مشتریان کم‌مراجعه</button></article></div>
    }
    <details className="simple-details" open={!compact}><summary>خلاصه مشتریان برتر</summary><div className="crm-leaders">{[[leader, 'بیشترین مبلغ خرید', 'purchased', Trophy, 'تومان'], [quantityLeader, 'بیشترین تعداد جنس', 'itemCount', ShoppingBag, 'عدد / قطعه'], [receiptLeader, 'بیشترین دریافت ثبت‌شده', 'received', Trophy, 'تومان']].map(([row, title, key, Icon, unit]) => <article key={key}><Icon size={20}/><span>{title}</span>{row ? <><button onClick={() => onSelect(row.customer.id)}>{row.customer.name}</button><strong>{numeric(row[key])} <small>{unit}</small></strong></> : <p>هنوز سابقه‌ای در این بازه نیست</p>}</article>)}</div>
    </details>
    <div className="crm-ranking-toolbar"><h3>رتبه‌بندی مشتریان</h3><div className="crm-report-controls"><label>مرتب‌سازی<select aria-label="مرتب‌سازی مشتریان" value={metric} onChange={event => { setMetric(event.target.value); setLimit(10); }}>{Object.entries(metrics).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>فهرست<select aria-label="فیلتر رتبه‌بندی مشتریان" value={segment} onChange={event => { setSegment(event.target.value); setLimit(10); }}><option value="all">همه مشتریان</option><option value="buyers">خریداران این بازه</option><option value="repeat">خریداران تکراری</option><option value="due">نیازمند پیگیری</option><option value="inactive">۹۰ روز بدون خرید</option><option value="debtor">دارای مانده بدهی</option></select></label><button className="button button-ghost" disabled={!ranked.length} onClick={download}><Download size={15}/> خروجی CSV</button></div></div>
    <p className="crm-analysis-note">دریافت ثبت‌شده فقط از بخش «دریافت / پرداخت و تسویه» محاسبه می‌شود؛ مبلغ فاکتور به معنی پرداخت واقعی نیست. دریافت‌ها در بازه انتخابی و مستقل از گروه کالا هستند. مقدار ارز در تعداد جنس جمع نمی‌شود.</p>
    <div className="crm-table-scroll"><table className="crm-ranking"><thead><tr><th>رتبه</th><th>مشتری</th><th>مبلغ خرید / میانگین (تومان)</th><th>تعداد جنس / کار ساخته</th><th>دفعات خرید (سند)</th><th>دریافت ثبت‌شده (تومان)</th><th>گروه محبوب بر اساس مبلغ</th><th>آخرین خرید / وضعیت</th></tr></thead><tbody>{ranked.slice(0, limit).map(row => <tr key={row.customer.id} data-ranking-customer={row.customer.id}><td>{row[metric] ? numeric(row.rank) : '—'}</td><td><button className="crm-open-profile" onClick={() => onSelect(row.customer.id)}>{row.customer.name}</button><small>{row.customer.tag || 'عادی'}</small></td><td>{money(row.purchased)}<small>میانگین: {money(row.averagePurchase)}</small></td><td>{numeric(row.itemCount)}<small>کار ساخته: {numeric(row.craftedQuantity)}</small></td><td>{numeric(row.invoices)}</td><td>{row.receiptCount ? money(row.received) : 'ثبت نشده'}</td><td>{row.groups[0]?.label || 'بدون خرید در بازه'}<small>{numeric(row.goldGrams)} گرم طلای ۷۵۰ (بدون سکه)</small></td><td>{date(row.lastPurchase)}<small>{row.segment}{row.followUpDue ? ' · پیگیری سررسیدشده' : ''}</small></td></tr>)}</tbody></table></div>
    {!ranked.length && <p className="empty-state">مشتری مطابق این جستجو و فیلتر پیدا نشد.</p>}
    {ranked.length > limit && <button className="button button-ghost" onClick={() => setLimit(limit + 25)}>نمایش مشتریان بیشتر ({numeric(ranked.length - limit)} نفر)</button>}
    <p className="crm-analysis-note">رتبه‌ها در فهرست فعلی محاسبه می‌شوند؛ مقدار برابر، رتبه برابر دارد. آخرین خرید، وضعیت مراجعه و مانده بدهی بر اساس کل سوابق تا امروز هستند.</p>
  </section>;
}

function PreferenceTable({ title, rows, metric, total, showShare = false, group = false }) {
  const ordered = sortPreferences(rows, metric);
  return <section className="crm-preference-table"><h4>{title}</h4>{!ordered.length ? <p>خریدی در بازه انتخابی ثبت نشده است.</p> : <div className="crm-table-scroll"><table><thead><tr><th>نوع / کالا</th><th>{group ? 'دفعات (سند)' : 'تعداد / مقدار'}</th><th>مبلغ (تومان)</th>{showShare && <th>سهم مبلغ</th>}</tr></thead><tbody>{ordered.map(item => <tr key={item.key}><td>{item.label}</td><td>{numeric(group ? item.invoices : item.quantity)} {!group && item.unit}</td><td>{money(item.amount)}</td>{showShare && <td><span>{numeric(total ? item.amount / total * 100 : 0)}٪</span><progress max="100" value={total ? item.amount / total * 100 : 0} aria-label={`سهم خرید ${item.label}`}/></td>}</tr>)}</tbody></table></div>}</section>;
}

export function CustomerInsights({ row, days, category }) {
  const [metric, setMetric] = useState('quantity');
  const favoriteCoins = sortPreferences(row.coins, metric);
  const favoriteCrafted = sortPreferences(row.crafted, metric);
  const suggestion = row.followUpDue ? 'زمان پیگیری ثبت‌شده این مشتری رسیده است؛ یادداشت پرونده را بررسی کنید.'
    : row.inactive ? `از آخرین خرید ${numeric(row.daysSincePurchase)} روز گذشته؛ زمان مناسبی برای پیگیری نیاز جدید مشتری است.`
      : row.groups[0] ? `برای پیشنهاد بعدی، علاقه ثبت‌شده به ${row.groups[0].label} را در نظر بگیرید.` : 'با ثبت خرید مشتری، الگوی خرید و پیشنهاد پیگیری مشخص می‌شود.';
  return <section className="crm-customer-insights" aria-label="الگوی خرید مشتری">
    <div className="crm-section-title"><div><h3>این مشتری بیشتر چه می‌خرد؟</h3><p className="crm-analysis-note">{days ? `${numeric(days)} روز اخیر` : 'همه سوابق تا امروز'} · {category === 'all' ? 'همه گروه‌ها' : purchaseGroups[category]}</p></div><label className="crm-preference-sort">معیار محبوبیت کالا<select aria-label="معیار محبوبیت کالا" value={metric} onChange={event => setMetric(event.target.value)}><option value="quantity">تعداد / مقدار خرید</option><option value="amount">مبلغ خرید</option></select></label></div>
    <div className="crm-preference-cards"><article><span>گروه محبوب بر اساس مبلغ</span><strong>{row.groups[0]?.label || 'بدون سابقه در بازه'}</strong></article><article><span>سکه محبوب بر اساس {metric === 'quantity' ? 'تعداد' : 'مبلغ'}</span><strong>{favoriteCoins[0]?.label || 'بدون خرید سکه'}</strong></article><article><span>کار ساخته محبوب بر اساس {metric === 'quantity' ? 'تعداد' : 'مبلغ'}</span><strong>{favoriteCrafted[0]?.label || 'بدون خرید کار ساخته'}</strong></article></div>
    <div className="crm-insight-numbers"><span>تعداد جنس: <b>{numeric(row.itemCount)}</b></span><span>میانگین هر سند خرید: <b>{money(row.averagePurchase)} تومان</b></span><span>تخفیف دریافتی: <b>{money(row.discounts)} تومان</b></span><span>دریافت ثبت‌شده از مشتری: <b>{row.receiptCount ? `${money(row.received)} تومان` : 'ثبت نشده'}</b></span><span>طلای دریافتی در تسویه: <b>{numeric(row.receivedGrams)} گرم</b></span><span>اولین خرید: <b>{date(row.firstPurchase)}</b></span></div>
    <p className="crm-followup-suggestion"><CalendarClock size={19}/>{suggestion}</p>
    <PreferenceTable title="سهم گروه‌ها از خرید" rows={row.groups} metric="amount" total={row.purchased} group showShare/>
    <div className="crm-preference-columns"><PreferenceTable title="سکه‌های خریداری‌شده" rows={row.coins} metric={metric}/><PreferenceTable title="انواع کار ساخته خریداری‌شده" rows={row.crafted} metric={metric}/></div>
    {!!row.currencies.length && <PreferenceTable title="ارزهای خریداری‌شده" rows={row.currencies} metric="amount"/>}
    <details className="crm-product-details"><summary>جزئیات کالاهای خریداری‌شده ({numeric(row.products.length)} نوع)</summary><PreferenceTable title="کالاهای پرتکرار" rows={row.products} metric="amount"/></details>
    <p className="crm-analysis-note">نوع کار ساخته از فیلد نوع کالا یا نام ثبت‌شده تشخیص داده می‌شود؛ موارد نامشخص در «سایر» قرار می‌گیرند. هر فاکتور یک نوبت خرید در گزارش محسوب می‌شود. در برابری معیار محبوبیت، دفعات خرید بیشتر و سپس ترتیب نام‌ها ملاک است.</p>
  </section>;
}
