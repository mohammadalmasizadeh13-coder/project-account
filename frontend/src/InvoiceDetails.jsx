import React, { useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X } from 'lucide-react';
import { documentBreakdown, number, quantity } from './assets';
import { formatRecordDate } from './recordTime';
import { formatPersianDate } from './persianDate';
import { invoiceItemName, invoiceRowAmount } from './invoices';
import { isMiscPurchase, miscGoldWeight750 } from './miscGold.js';
import { GalleryAccountContext } from './GalleryAccountContext.js';
import './invoice.css';

const decimal = value => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 3 }).format(number(value));
const debtGrams = value => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 6 }).format(number(value));
const money = value => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(number(value));
const categories = { crafted: 'کار ساخته', melted: 'طلای آبشده', coin: 'سکه', currency: 'ارز', expense: 'هزینه' };
const rowWeight = row => {
  const unitWeight = row.category === 'crafted' ? number(row.weight) : row.category === 'melted' ? number(row.meltedWeight) : row.category === 'coin' && row.coinType === 'پارسیان' ? number(row.parsianWeight) : null;
  return unitWeight == null ? null : unitWeight * quantity(row);
};
const rowPurity = row => row.category === 'crafted' ? (row.ayar || 750) : row.category === 'melted' ? (row.meltedAyar || 750) : null;
const rowRate = row => row.category === 'crafted' ? row.gramPrice : row.category === 'melted' ? row.meltedGramPrice : row.category === 'coin' ? (row.coinType === 'پارسیان' ? row.parsianPrice : row.coinPrice) : row.category === 'currency' ? row.currencyRate : null;

const printOffset = value => Math.max(-5, Math.min(5, Number(value) || 0));
const printSettingsKey = accountId => accountId == null || accountId === '' ? null : 'zar-invoice-print:' + accountId;
const readPrintSettings = accountId => {
  try {
    const key = printSettingsKey(accountId);
    const saved = key ? JSON.parse(localStorage.getItem(key) || '{}') : {};
    return { x: printOffset(saved?.x), y: printOffset(saved?.y) };
  } catch {
    return { x: 0, y: 0 };
  }
};

function InvoiceBrand({ galleryName }) {
  return <div className="invoice-identity">
    <svg className="invoice-emblem" viewBox="0 0 180 110" fill="none" aria-hidden="true">
      <path d="M25 94a65 65 0 0 1 130 0" stroke="currentColor" strokeWidth="10"/>
      <path d="M90 5v20M49 14l9 20M15 41l20 12M4 77l22 4M131 14l-9 20M165 41l-20 12M176 77l-22 4" stroke="currentColor" strokeWidth="7" strokeLinecap="square"/>
      <path d="M90 59c4 13 9 19 23 23-14 4-19 10-23 23-4-13-9-19-23-23 14-4 19-10 23-23Z" fill="currentColor"/>
    </svg>
    <span className="invoice-brand" data-invoice-gallery-name dir="auto">{galleryName}</span>
  </div>;
}

export default function InvoiceDetails({ invoice, galleryName, accountId, onClose, onEdit, onDelete }) {
  const account = useContext(GalleryAccountContext);
  const printAccountId = accountId ?? account.accountId;
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  const [printSettings, setPrintSettings] = useState(() => readPrintSettings(printAccountId));
  useEffect(() => { setPrintSettings(readPrintSettings(printAccountId)); }, [printAccountId]);
  const updatePrintSettings = (settings, normalize = false) => {
    const next = { x: printOffset(settings.x), y: printOffset(settings.y) };
    setPrintSettings(normalize ? next : settings);
    try {
      const key = printSettingsKey(printAccountId);
      if (key) localStorage.setItem(key, JSON.stringify(next));
    } catch { /* Printing still works when browser storage is unavailable. */ }
  };
  closeRef.current = onClose;
  useEffect(() => {
    if (!invoice) return undefined;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.classList.add('invoice-open');
    dialogRef.current?.focus();
    const handleKey = event => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current?.(); }
      if (event.key !== 'Tab') return;
      const controls = [...(dialogRef.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]') || [])];
      const first = controls[0]; const last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.classList.remove('invoice-open');
      document.removeEventListener('keydown', handleKey);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [invoice?.id]);
  if (!invoice) return null;
  const rows = invoice.rows;
  const totals = rows.reduce((sum, row) => {
    const value = documentBreakdown(row);
    return { weight: sum.weight + (rowWeight(row) || 0), discount: sum.discount + value.discount, costs: sum.costs + value.costs };
  }, { weight: 0, discount: 0, costs: 0 });
  const first = rows[0] || {};
  const documentGalleryName = [invoice.galleryName, first.galleryName, galleryName ?? account.galleryName].map(value => String(value || '').trim()).find(Boolean) || 'گالری';
  // A cash payment is shown only when a settlement was actually recorded.
  const settlement = number(invoice.settlementVersion ?? first.settlementVersion) === 1 ? {
    cashPaid: invoice.cashPaid ?? first.cashPaid,
    goldPrice: invoice.settlementGoldPrice ?? first.settlementGoldPrice,
    remainder: invoice.settlementRemainder ?? first.settlementRemainder,
  } : null;
  const isPurchase = invoice.direction === 'خرید';
  const isPartner = first.counterpartyType === 'partner';
  const customerDetails = {
    phone: invoice.customerPhone ?? first.customerPhone,
    birthDate: invoice.customerBirthDate ?? first.customerBirthDate,
    address: invoice.customerAddress ?? first.customerAddress,
    nationalId: invoice.customerNationalId ?? first.customerNationalId,
  };
  const hasCustomerDetails = Object.values(customerDetails).some(value => String(value || '').trim());
  const paymentMethod = String(invoice.paymentMethod ?? first.paymentMethod ?? '').trim();
  const notes = [...new Set(rows.map(row => String(row.note || '').trim()).filter(Boolean))];
  return createPortal(<div className="invoice-overlay" onClick={event => { if (event.target === event.currentTarget) onClose?.(); }}>
    <section className="invoice-dialog" role="dialog" aria-modal="true" aria-labelledby="invoice-title" tabIndex={-1} ref={dialogRef} dir="rtl">
      <div className="invoice-controls"><span>مشاهده و چاپ سند</span><div><button type="button" className="button button-primary" data-invoice-print onClick={() => window.print()}><Printer size={17}/> چاپ روی برگهٔ آماده</button><button type="button" className="invoice-close" data-invoice-close aria-label="بستن صورتحساب" onClick={onClose}><X size={21}/></button></div></div>
      {(onEdit || onDelete) && <div className="invoice-controls document-actions">{onEdit && <button type="button" className="button button-ghost" data-invoice-edit onClick={onEdit}>ویرایش سند</button>}{onDelete && <button type="button" className="button button-ghost document-delete-link" data-invoice-delete onClick={onDelete}>حذف سند</button>}</div>}
      <div className="invoice-print-settings">
        <p id="invoice-print-help">برگهٔ طرح‌دار آماده را در چاپگر بگذارید؛ فقط نوشته‌ها به رنگ مشکی چاپ می‌شوند. رنگ و طرح این پیش‌نمایش چاپ نمی‌شود. کاغذ A5 عمودی، مقیاس ۱۰۰٪ و سربرگ و پابرگ مرورگر خاموش باشد.</p>
        <fieldset aria-describedby="invoice-print-help"><legend>تنظیم جای نوشته‌ها روی کاغذ</legend>
          <label>جابه‌جایی افقی (میلی‌متر)<input type="number" min="-5" max="5" step="0.5" value={printSettings.x} data-invoice-print-offset-x onChange={event => updatePrintSettings({ ...printSettings, x: event.target.value })} onBlur={() => updatePrintSettings(printSettings, true)}/><small>عدد مثبت: به راست</small></label>
          <label>جابه‌جایی عمودی (میلی‌متر)<input type="number" min="-5" max="5" step="0.5" value={printSettings.y} data-invoice-print-offset-y onChange={event => updatePrintSettings({ ...printSettings, y: event.target.value })} onBlur={() => updatePrintSettings(printSettings, true)}/><small>عدد مثبت: به پایین</small></label>
          <button type="button" className="button button-ghost" onClick={() => updatePrintSettings({ x: 0, y: 0 })}>بازنشانی جای نوشته‌ها</button>
        </fieldset>
        <p>برای هماهنگی با طرح برگه، ابتدا یک نسخهٔ آزمایشی چاپ کنید. این تنظیم فقط روی چاپ اثر دارد.</p>
      </div>
      <article className="invoice-sheet" style={{ '--invoice-print-x': printOffset(printSettings.x) + 'mm', '--invoice-print-y': printOffset(printSettings.y) + 'mm' }}>
        <header className="invoice-heading">
          <svg className="invoice-heading-wave" viewBox="0 0 1000 330" preserveAspectRatio="none" aria-hidden="true"><path d="M0 0H1000V153C868 109 836 325 639 293S441 219 308 282 103 328 0 291Z" fill="currentColor"/><path d="M0 62C158 121 169 6 356 74S593 198 714 78 909 69 1000 20V0H0Z" fill="currentColor" opacity=".35"/></svg>
          <h2 id="invoice-title">صورتحساب {invoice.direction}</h2>
          <InvoiceBrand galleryName={documentGalleryName}/>
          <dl className="invoice-document-info">
            <div><dt>شماره فاکتور:</dt><dd><bdi>{typeof invoice.number === 'number' ? decimal(invoice.number) : invoice.number}</bdi></dd></div>
            <div><dt>تاریخ:</dt><dd>{invoice.date ? formatRecordDate(invoice) : 'ثبت نشده'}</dd></div>
            <div className="invoice-customer"><dt>{isPurchase ? 'فروشنده:' : 'خریدار:'}</dt><dd>{invoice.customerName || 'ثبت نشده'}</dd></div>
          </dl>
        </header>
        <div className="invoice-content">
        {hasCustomerDetails && <section className="invoice-customer-details" aria-label="مشخصات مشتری">
          <dl>
            {customerDetails.phone && <div><dt>شماره تماس:</dt><dd data-invoice-customer-phone><bdi dir="ltr">{customerDetails.phone}</bdi></dd></div>}
            {customerDetails.birthDate && <div><dt>تاریخ تولد:</dt><dd data-invoice-customer-birth-date>{formatPersianDate(customerDetails.birthDate)}</dd></div>}
            {customerDetails.nationalId && <div><dt>کد ملی:</dt><dd data-invoice-customer-national-id><bdi dir="ltr">{customerDetails.nationalId}</bdi></dd></div>}
            {customerDetails.address && <div className="invoice-customer-address"><dt>نشانی:</dt><dd data-invoice-customer-address>{customerDetails.address}</dd></div>}
          </dl>
        </section>}
        <div className="invoice-table-scroll"><table className="invoice-items"><caption className="invoice-table-caption">مشخصات کالاها؛ وزن هر ردیف مجموع وزن همان کالا است. مبالغ به تومان است.</caption><colgroup><col className="invoice-col-index"/><col className="invoice-col-description"/><col className="invoice-col-wage"/><col className="invoice-col-purity"/><col className="invoice-col-weight"/><col className="invoice-col-rate"/><col className="invoice-col-amount"/></colgroup><thead><tr><th scope="col">ردیف</th><th scope="col">شرح کالا</th><th scope="col">اجرت<br/><small>درصد</small></th><th scope="col">عیار</th><th scope="col">وزن کل<br/><small>گرم</small></th><th scope="col">فی<br/><small>تومان</small></th><th scope="col">مبلغ<br/><small>تومان</small></th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id || index} data-invoice-item={row.id || index} data-invoice-detail-line={index + 1}>
          <td>{decimal(index + 1)}</td><td className="invoice-item-description"><strong>{invoiceItemName(row)}</strong><small>{isMiscPurchase(row) ? 'طلای متفرقه' : row.category === 'crafted' ? row.craftedKind || categories.crafted : categories[row.category] || row.typeLabel}</small>{row.productCode && <bdi className="invoice-item-code" dir="ltr">{row.productCode}</bdi>}{isMiscPurchase(row) && <small>وزن معادل ۷۵۰: <span data-invoice-misc-weight750>{debtGrams(miscGoldWeight750(row) * quantity(row))}</span> گرم</small>}{row.category === 'melted' && <small>انگ: <bdi>{row.assayCode || '—'}</bdi>{row.laboratoryName && ` · ${row.laboratoryName}`}<br/>وزن معادل ۷۵۰: {decimal(number(row.meltedWeight) * number(row.meltedAyar || 750) / 750 * quantity(row))} گرم</small>}{row.type?.endsWith('-sale') && number(row.discountPercent) > 0 && <small data-invoice-discount-percent>تخفیف درصدی: {decimal(row.discountPercent)}٪{number(row.discountRial) > 0 && ` + ${money(row.discountRial)} تومان تخفیف ریالی`}</small>}</td>
          <td data-invoice-wage>{row.category !== 'currency' && number(row.wagePercent) > 0 ? `${decimal(row.wagePercent)}٪` : ''}</td><td>{rowPurity(row) == null ? '—' : decimal(rowPurity(row))}</td><td data-invoice-weight>{rowWeight(row) == null ? '—' : decimal(rowWeight(row))}</td><td>{rowRate(row) == null ? '—' : money(rowRate(row))}{['crafted', 'melted'].includes(row.category) && <small>هر گرم ۷۵۰</small>}</td><td className="invoice-row-total">{money(invoiceRowAmount(row))}</td>
        </tr>)}{Array.from({ length: Math.max(0, 4 - rows.length) }, (_, index) => <tr className="invoice-empty-row" aria-hidden="true" key={`empty-${index}`}><td>{decimal(rows.length + index + 1)}</td><td/><td/><td/><td/><td/><td/></tr>)}</tbody></table></div>
        <div className="invoice-bottom">
          <div className="invoice-notes">{paymentMethod && <><h3>نحوه پرداخت</h3><p data-invoice-payment-method>{paymentMethod}</p></>}{notes.length > 0 && <><h3>توضیحات</h3>{notes.map(note => <p key={note}>{note}</p>)}</>}<p>تمام مبالغ به تومان است.</p>{totals.weight > 0 && <p>وزن کل کالاها: <strong data-invoice-total-weight>{decimal(totals.weight)} گرم</strong></p>}</div>
          <section className="invoice-payment" aria-labelledby="invoice-payment-title"><h3 id="invoice-payment-title">جزئیات پرداخت</h3><dl className="invoice-totals">
            {settlement && <><div><dt>{isPurchase ? 'پرداخت نقدی به فروشنده' : 'پرداخت نقدی مشتری'}</dt><dd data-invoice-cash-paid>{money(settlement.cashPaid)} تومان</dd></div><div><dt>نرخ تبدیل هر گرم طلای ۷۵۰</dt><dd data-invoice-settlement-rate>{money(settlement.goldPrice)} تومان</dd></div><div><dt>مانده تبدیل‌شده به طلا</dt><dd data-invoice-settlement-remainder>{money(settlement.remainder)} تومان</dd></div></>}
            {!settlement && number(invoice.rialDebt) !== 0 && <div><dt>{isPartner ? 'بدهی نقدی ما به همکار' : isPurchase ? 'بدهی نقدی ما به مشتری' : 'بدهی نقدی مشتری'}</dt><dd>{money(invoice.rialDebt)} تومان</dd></div>}
            {totals.costs > 0 && <div><dt>هزینه‌های دیگر</dt><dd>{money(totals.costs)} تومان</dd></div>}
            <div><dt>تخفیف</dt><dd data-invoice-discount>{money(totals.discount)} تومان</dd></div>
            <div className="invoice-gold-debt"><dt>{isPartner ? 'بدهی گرمی ما به همکار (با اجرت)' : isPurchase ? 'بدهی گرمی ما به مشتری' : 'بدهی گرمی مشتری'}</dt><dd data-invoice-gram-debt>{debtGrams(invoice.gramDebt)} گرم</dd></div>
            <div className="invoice-grand-total"><dt>جمع کل:</dt><dd data-invoice-total>{money(invoice.amount)} تومان</dd></div>
          </dl></section>
        </div>
        <footer className="invoice-footer"><div className="invoice-signatures"><span>امضا / مهر</span><span>امضای {isPurchase ? 'فروشنده' : 'خریدار'}</span></div><div className="invoice-footer-brand"><span dir="auto">{documentGalleryName}</span><span className="invoice-thanks" dir="ltr">Thank You</span></div></footer>
        </div>
      </article>
    </section>
  </div>, document.body);
}
