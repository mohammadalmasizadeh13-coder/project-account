import React, { useState } from 'react';
import { Archive, PackageOpen, Search } from 'lucide-react';
import { formatPersianDate } from './persianDate';
import { normalizeProductCode, stockCategories, stockQuantity, stockUnit } from './inventory';
import { currencyName } from './assets';
import './inventory.css';

const number = value => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 3 }).format(value || 0);

export default function InventoryVault({ report, assets, prices, onPrices, onSell, onReceive, onLinkSale, helpers }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [status, setStatus] = useState('available');
  const [links, setLinks] = useState({});
  const [message, setMessage] = useState(null);
  const visible = report.items.filter(item => (category === 'all' || item.category === category)
    && (status === 'all' || (status === 'available' ? item.remaining > 0 : item.remaining <= 0))
    && normalizeProductCode([item.productCode, item.itemName, item.description, item.coinType, item.currencyType, currencyName(item.currencyType), item.assayCode, item.laboratoryName].join(' ')).includes(normalizeProductCode(query)));
  const linkSale = sale => {
    try { onLinkSale(sale.id, links[sale.id]); setMessage({ type: 'success', text: 'فروش قبلی به جنس وصل شد و موجودی اصلاح شد.' }); }
    catch (error) { setMessage({ type: 'error', text: error.message }); }
  };
  return <div className="vault-page">
    <header className="vault-heading"><div><span>موجودی فروشگاه</span><h1><Archive size={25}/> صندوق من</h1><p>موجودی اولیه و خریدها وارد صندوق می‌شوند؛ فروش هر کد از موجودی همان جنس کم می‌شود.</p></div><button className="button button-primary" onClick={onReceive}>ثبت خرید جدید</button></header>
    <section className="vault-assets" aria-label="کل دارایی‌های صندوق">
      <div className="vault-assets-heading"><div><h2>کل دارایی‌های صندوق</h2><p>ارزش موجودی باقی‌مانده با اجرت، هزینه‌های دیگر و سود ثبت‌شده</p></div><button className="button button-ghost" onClick={onPrices}>به‌روزرسانی نرخ‌ها</button></div>
      <div className="vault-stats asset-totals">
        <article><span>ارزش کل به ریال</span><strong>{number(assets.totalRial)} <small>ریال</small></strong><small>{number(assets.totalToman)} تومان</small></article>
        <article><span>معادل کل به گرم طلای ۷۵۰</span><strong>{assets.equivalentGrams === null ? '—' : number(assets.equivalentGrams)} <small>گرم</small></strong>{assets.equivalentGrams === null && <small>نرخ هر گرم طلا را ثبت کنید.</small>}</article>
        <article><span>معادل کل به دلار</span><strong>{assets.equivalentUsd === null ? '—' : number(assets.equivalentUsd)} <small>دلار</small></strong>{assets.equivalentUsd === null && <small>نرخ دلار را ثبت کنید.</small>}</article>
      </div>
      <p className="vault-note">این سه عدد، معادل یک دارایی هستند و با هم جمع نمی‌شوند. ارزش ریالی، وجه نقد صندوق نیست. نرخ روزِ ثبت‌شده و در نبود آن نرخ ورود هر جنس مبنای ارزش‌گذاری است. پارسیان با قیمت ثبت‌شده هر عدد محاسبه می‌شود.</p>
      {prices.updatedAt && <p className="vault-note">آخرین ثبت نرخ‌ها: {new Date(prices.updatedAt).toLocaleString('fa-IR')}</p>}
      <div className="vault-holdings"><div><span>طلای ساخته و آب‌شده، معادل عیار ۷۵۰</span><strong>{number(assets.goldGrams750)} گرم</strong></div><div><span>مجموع اجرت موجودی</span><strong>{number(assets.wage)} تومان</strong></div><div><span>هزینه‌های دیگر موجودی</span><strong>{number(assets.costs)} تومان</strong></div><div><span>سود منظورشده در ارزش موجودی</span><strong>{number(assets.profit)} تومان</strong></div>
        {Object.entries(assets.currencies).map(([code, amount]) => <div key={code}><span>موجودی {currencyName(code)}</span><strong>{number(amount)} <bdi>{code}</bdi></strong></div>)}
        {Object.entries(assets.coins).map(([name, count]) => <div key={name}><span>{name}</span><strong>{number(count)} عدد</strong></div>)}
      </div>
    </section>
    <div className="vault-stats"><article><span>کدهای موجود</span><strong>{number(report.available.length)}</strong></article><article><span>تعداد اجناس موجود</span><strong>{number(report.available.filter(item => item.category !== 'currency').reduce((sum, item) => sum + item.remaining, 0))} <small>عدد / قطعه</small></strong></article><article><span>کدهای اتمام موجودی</span><strong>{number(report.items.filter(item => item.remaining <= 0).length)}</strong></article></div>
    {!!report.unlinkedSales.length && <details className="vault-legacy"><summary>{number(report.unlinkedSales.length)} فروش قبلی بدون کد جنس؛ نیازمند تطبیق موجودی</summary><p>این فروش‌ها هنوز از موجودی کدها کم نشده‌اند. جنس مربوط به هر فروش قبلی را انتخاب کنید تا موجودی دقیق شود. مبلغ و بدهی سند تغییری نمی‌کند.</p>{report.unlinkedSales.map(sale => <div className="vault-legacy-row" key={sale.id}><div><strong>{sale.itemName || sale.description || sale.typeLabel}</strong><small>{formatPersianDate(sale.date)} · {sale.customerName} · {number(stockQuantity(sale))} {stockUnit(sale)}</small><small>{sale.itemSummary}</small></div><select aria-label={`جنس مربوط به فروش ${sale.id}`} value={links[sale.id] || ''} onChange={event => setLinks({ ...links, [sale.id]: event.target.value })}><option value="">انتخاب کد جنس</option>{report.available.filter(item => item.category === sale.category && (item.category !== 'currency' || item.currencyType === sale.currencyType) && (item.category !== 'coin' || item.coinType === sale.coinType) && item.remaining >= stockQuantity(sale) && item.date <= sale.date).map(item => <option key={item.id} value={item.id}>{item.productCode} · {item.itemName || item.description} · {number(item.remaining)} موجود</option>)}</select><button className="button button-ghost" disabled={!links[sale.id]} onClick={() => linkSale(sale)}>اتصال فروش به جنس</button></div>)}</details>}
    {message && <p className={`form-message ${message.type}`} role="status">{message.text}</p>}
    <div className="vault-filters"><label className="vault-search"><Search size={18}/><input aria-label="جستجو در صندوق" value={query} onChange={event => setQuery(event.target.value)} placeholder="کد جنس، نام، انگ یا آزمایشگاه…"/></label><label>گروه<select value={category} onChange={event => setCategory(event.target.value)}><option value="all">همه اجناس</option>{Object.entries(stockCategories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>وضعیت<select aria-label="وضعیت موجودی" value={status} onChange={event => setStatus(event.target.value)}><option value="available">موجود در صندوق</option><option value="empty">اتمام موجودی</option><option value="all">همه سوابق</option></select></label></div>
    <div className="vault-items">{visible.map(item => <article className="vault-item" key={item.id} data-product-code={item.productCode}><div className="vault-item-top"><span>{stockCategories[item.category]}</span><bdi className="vault-code" dir="ltr">{item.productCode}</bdi></div><h2>{item.itemName || item.description || stockCategories[item.category]}</h2><p>مشخصات هر واحد: {helpers.describe({ ...item, itemCount: 1, coinCount: 1, currencyAmount: 1 })}</p><dl><div><dt>موجودی</dt><dd>{number(item.remaining)} {stockUnit(item)}</dd></div><div><dt>ورودی</dt><dd>{number(item.received)}</dd></div><div><dt>فروخته‌شده</dt><dd>{number(item.sold)}</dd></div><div><dt>تاریخ ورود</dt><dd>{formatPersianDate(item.date)}</dd></div></dl>{item.remaining > 0 && <div className="vault-item-value"><span>ارزش موجودی با اجرت و هزینه‌ها</span><strong>{number(assets.items[item.id]?.total)} تومان</strong><small>اجرت: {number(assets.items[item.id]?.wage)} · هزینه‌های دیگر: {number(assets.items[item.id]?.costs)} · سود: {number(assets.items[item.id]?.profit)} تومان</small></div>}{item.remaining > 0 ? <button className="button button-primary" onClick={() => onSell(item)}>فروش این جنس</button> : <span className="vault-empty-badge">اتمام موجودی</span>}<details><summary>سوابق ورود و فروش</summary><p>{item.source === 'opening-inventory' ? 'موجودی اولیه' : `خرید از ${item.customerName}`} · {number(item.received)} {stockUnit(item)}</p>{item.sales.map(sale => <p key={sale.id}>{formatPersianDate(sale.date)} · فروش به {sale.customerName} · {number(stockQuantity(sale))} {stockUnit(sale)}</p>)}</details></article>)}</div>
    {!visible.length && <div className="vault-empty"><PackageOpen size={34}/><h2>جنسی در این فهرست نیست</h2><p>خرید یا موجودی اولیه را ثبت کنید، یا فیلتر جستجو را تغییر دهید.</p></div>}
    <p className="vault-note">هر ردیف خرید یا موجودی اولیه، کد مستقل دارد. برای اجناس با وزن یا مشخصات متفاوت، ردیف جدا ثبت کنید. سوابق در همین حساب و مرورگر ذخیره می‌شوند.</p>
  </div>;
}
