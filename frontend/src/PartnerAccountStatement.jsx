import React, { useContext, useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import PersianDateInput from './PersianDateInput.jsx';
import { GalleryAccountContext } from './GalleryAccountContext.js';
import { partnerAccountStatement } from './partnerAccountStatement.js';
import { formatPartnerAmount as fmt, savedPartnerLineTotals } from './partnerLedger.js';
import { assetLabel, assetName, balanceSide, directions, operationNames } from './partnerTrading.js';
import { formatPersianDate, todayInTehran } from './persianDate.js';
import { formatRecordDate } from './recordTime.js';
import './partner-account-statement.css';

const amount = (value, asset) => fmt(value, asset === 'toman' ? 2 : 8);
const entryTitle = entry => operationNames[entry.type] || ({ purchase: 'خرید از همکار', sale: 'فروش به همکار', mixed: 'سند ترکیبی' })[entry.type]
  || (entry.paymentMethod === 'remittance' ? 'حواله همکار' : entry.goldDebit > 0 || entry.tomanDebit > 0 ? 'دریافت از همکار' : 'پرداخت به همکار');
function postings(entry, asset) {
  return entry.postings[asset] || { debit: 0, credit: 0 };
}

function EntryLines({ entry, documents }) {
  const lines = entry.lines?.length ? entry.lines : (entry.documentIds || []).map(documentId => ({ documentId }));
  return lines.map((line, index) => {
    const record = { ...documents.get(String(line.documentId)), ...line };
    if (entry.calculationVersion === 5) return <div className="account-statement-line" data-statement-line key={index}>
      <span>{directions[line.direction]} · {line.itemName || assetName(line.asset)}{line.simultaneous ? ' · هم‌زمان' : ''}</span>
      {line.description && <strong className="account-statement-description">{line.description}</strong>}
      <small>مقدار: {amount(line.quantity, line.asset)} {assetLabel(line.asset)}{line.rate > 0 && <> · {line.category === 'melted' && entry.type !== 'offset' ? 'مظنه' : 'فی'}: {fmt(line.rate, 4)} تومان</>}</small>
      {line.meltedWeight > 0 && <small>وزن واقعی: {fmt(line.meltedWeight)} گرم · عیار: {fmt(line.meltedAyar)}{line.assayCode && <> · انگ: {line.assayCode}</>}{line.laboratoryName && <> · {line.laboratoryName}</>}</small>}
    </div>;
    const saved = savedPartnerLineTotals(line, documents.get(String(line.documentId)), entry);
    return <div className="account-statement-line" data-statement-line key={index}>
      <span>{record.category === 'remittance' ? record.remittanceDirection === 'credit' ? 'حواله بستانکار' : 'حواله بدهکار' : directions[record.direction || entry.direction || entry.type]} · {saved.itemName || record.itemName || 'حواله'}</span>
      {(record.description || record.note) && <strong className="account-statement-description">{record.description || record.note}</strong>}
      <small>{record.category === 'remittance' ? record.settlementUnit === 'toman' ? <>حواله: {fmt(record.tomanAmount, 2)} تومان</> : <>حواله: {fmt(record.goldAmount)} گرم ۷۵۰</> : <>تعداد: {fmt(saved.count)} · وزن ۷۵۰: {fmt(saved.weight750)} گرم{saved.purity != null && <> · عیار: {fmt(saved.purity)}</>}{saved.rate > 0 && <> · فی: {fmt(saved.rate, 2)} تومان</>}</>}</small>
    </div>;
  });
}

function BalanceTable({ balances, assets, final = false }) {
  return <table className="account-statement-balances" data-statement-final={final || undefined} data-statement-opening={!final || undefined}>
    <caption>{final ? 'ته حساب · مانده تا پایان بازه' : 'مانده منتقل‌شده از قبل از بازه'}</caption>
    <thead><tr><th>دارایی / واحد</th><th>باید بدهیم</th><th>باید بگیریم</th><th>وضعیت</th></tr></thead>
    <tbody>{assets.map(asset => <tr key={asset} data-statement-asset={asset} data-balance={balances[asset] || 0}>
      <th scope="row">{assetLabel(asset)}</th><td>{amount(Math.max(balances[asset] || 0, 0), asset)}</td><td>{amount(Math.max(-(balances[asset] || 0), 0), asset)}</td><td>{balanceSide(balances[asset] || 0)}</td>
    </tr>)}</tbody>
  </table>;
}

export default function PartnerAccountStatement({ partner, documents = [], username }) {
  const { galleryName } = useContext(GalleryAccountContext);
  const [range, setRange] = useState(() => ({ from: [todayInTehran(), ...(partner.entries || []).map(entry => entry.date).filter(Boolean)].sort()[0], to: todayInTehran() }));
  const [applied, setApplied] = useState(range);
  const [error, setError] = useState('');
  const report = partnerAccountStatement(partner, applied);
  const docById = new Map(documents.map(document => [String(document.id), document]));
  const pendingRange = range.from !== applied.from || range.to !== applied.to;
  function apply(event) {
    event.preventDefault();
    try { partnerAccountStatement(partner, range); setApplied({ ...range }); setError(''); }
    catch (failure) { setError(failure.message); }
  }
  function cleanupPrint() { document.body.classList.remove('partner-print-open', 'partner-account-print-open'); }
  useEffect(() => {
    window.addEventListener('afterprint', cleanupPrint);
    return () => { window.removeEventListener('afterprint', cleanupPrint); cleanupPrint(); };
  }, []);
  function print() {
    document.body.classList.add('partner-print-open', 'partner-account-print-open');
    try { window.print(); } catch (failure) { cleanupPrint(); setError(failure.message || 'چاپ باز نشد.'); }
  }
  return <section className="partner-statement partner-account-statement" data-partner-account-statement>
    <div className="partner-section-heading partner-screen-only"><h3>ته حساب</h3><button type="button" className="button button-ghost" data-partner-statement-print disabled={pendingRange || Boolean(error)} onClick={print}><Printer size={16}/> چاپ ته حساب</button></div>
    <form className="account-statement-filter partner-screen-only" onSubmit={apply}>
      <label>از تاریخ<PersianDateInput name="statementFrom" value={range.from} required onChange={event => { setRange({ ...range, from: event.target.value }); setError(''); }}/></label>
      <label>تا تاریخ<PersianDateInput name="statementTo" value={range.to} required onChange={event => { setRange({ ...range, to: event.target.value }); setError(''); }}/></label>
      <button type="submit" className="button button-primary" data-partner-statement-apply>نمایش ته حساب</button>
    </form>
    {error && <p role="alert" className="form-message error partner-screen-only">{error}</p>}
    {pendingRange && <p className="partner-help partner-screen-only">برای اعمال تاریخ‌های جدید، «نمایش ته حساب» را بزنید.</p>}
    <header className="account-statement-heading"><h2>{galleryName || username}</h2><h3>ته حساب · {partner.name}</h3><p>از {formatPersianDate(applied.from)} تا {formatPersianDate(applied.to)} · شامل ابتدا و انتهای بازه</p>{partner.phone && <p>تلفن: <bdi>{partner.phone}</bdi></p>}</header>
    <p className="account-statement-help">بدهکار یعنی افزایش بدهی ما؛ بستانکار یعنی افزایش طلب ما یا کاهش بدهی. ماندهٔ هر دارایی جداست؛ وزن حساب طلا برحسب گرم عیار ۷۵۰ و مبالغ پول برحسب تومان است.</p>
    <div className="partner-table-scroll"><BalanceTable balances={report.openingBalances} assets={report.assets}/></div>
    <div className="partner-table-scroll"><table className="account-statement-ledger">
      <caption>ریز معاملات، حواله‌ها، دریافت و پرداخت و تهاتر · {fmt(report.rows.length)} سند</caption>
      <colgroup><col className="statement-date-column"/><col className="statement-description-column"/><col/><col/><col/><col/></colgroup>
      <thead><tr><th>تاریخ / سند</th><th>شرح</th><th>دارایی / واحد</th><th>بدهکار</th><th>بستانکار</th><th>مانده پس از سند</th></tr></thead>
      {report.rows.map(entry => {
        const moved = report.assets.filter(asset => { const value = postings(entry, asset); return value.debit || value.credit || entry.lines?.some(line => line.asset === asset); });
        const assets = moved.length ? moved : ['gold'];
        return <tbody key={entry.id} data-statement-entry={entry.id}>{assets.map((asset, index) => {
          const value = postings(entry, asset);
          return <tr key={asset}>
            {index === 0 && <><td rowSpan={assets.length}>{formatRecordDate(entry)}<small>سند {entry.invoiceNumber ? fmt(entry.invoiceNumber, 0) : '—'}</small>{entry.externalInvoiceNumber && <small>فاکتور همکار: {entry.externalInvoiceNumber}</small>}</td>
              <td rowSpan={assets.length}><strong>{entryTitle(entry)}</strong>{entry.note && <div className="account-statement-description">{entry.note}</div>}{[entry.counterpartyName, entry.reference].filter(Boolean).length > 0 && <small>{[entry.counterpartyName, entry.reference].filter(Boolean).join(' · ')}</small>}<EntryLines entry={entry} documents={docById}/></td></>}
            <td>{assetLabel(asset)}</td><td>{amount(value.debit, asset)}</td><td>{amount(value.credit, asset)}</td><td>{amount(Math.abs(entry.balances[asset] || 0), asset)}<small>{balanceSide(entry.balances[asset] || 0)}</small></td>
          </tr>;
        })}</tbody>;
      })}
      {!report.rows.length && <tbody><tr><td colSpan={6}>در این بازه گردش ثبت نشده است؛ ماندهٔ منتقل‌شده در ته حساب آمده است.</td></tr></tbody>}
      <tbody className="account-statement-totals">{report.assets.map((asset, index) => <tr key={asset}>{index === 0 && <th colSpan={2} rowSpan={report.assets.length}>جمع گردش همین بازه</th>}<th>{assetLabel(asset)}</th><td>{amount(report.totals[asset].debit, asset)}</td><td>{amount(report.totals[asset].credit, asset)}</td><td>{amount(Math.abs(report.closingBalances[asset] || 0), asset)}<small>{balanceSide(report.closingBalances[asset] || 0)}</small></td></tr>)}</tbody>
    </table></div>
    <div className="account-statement-final-wrap"><BalanceTable final balances={report.closingBalances} assets={report.assets}/><p>این ته حساب با احتساب ماندهٔ قبل از بازه و تمام گردش‌های تا {formatPersianDate(applied.to)} محاسبه شده است.</p></div>
  </section>;
}
