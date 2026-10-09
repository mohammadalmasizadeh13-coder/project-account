import React, { useEffect, useRef, useState } from 'react';
import NumberInput from './NumberInput.jsx';
import { Archive, ChevronDown, PackageOpen, PackagePlus, Pencil, Search, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { formatRecordDate } from './recordTime';
import { stockCategories, stockQuantity, stockUnit } from './inventory';
import { coinCatalog, currencyCatalog, currencyName, documentBreakdown, number as parseNumber } from './assets';
import { craftedKinds } from './crmAnalytics';
import { defaultVaultFilters, filterInventoryItems, inventoryDisplayGroups } from './inventoryFilters';
import VaultItemEditor from './VaultItemEditor.jsx';
import VaultStockCreate from './VaultStockCreate.jsx';
import { isMiscPurchase, miscGoldWeight750 } from './miscGold.js';
import { coinSpec, isModernCoin, isOrdinaryCoin } from './coins.js';
import './inventory.css';

const number = value => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 3 }).format(parseNumber(value));
const goldGrams = value => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 6 }).format(parseNumber(value));

const statusLabels = { available: 'موجود در صندوق', empty: 'اتمام موجودی', all: 'همه سوابق' };
const rangeGroups = [
  { title: 'قیمت هر عدد یا واحد (تومان)', fields: [['minPrice', 'از قیمت', 'بدون حداقل'], ['maxPrice', 'تا قیمت', 'بدون حداکثر']] },
  { title: 'وزن هر عدد یا قطعه (گرم)', fields: [['minWeight', 'از وزن', 'بدون حداقل'], ['maxWeight', 'تا وزن', 'بدون حداکثر']] },
];

function changeVaultFilter(previous, key, value) {
  const next = { ...previous, [key]: value };
  if (key === 'category') {
    if (value !== 'all' && value !== 'crafted') next.craftedKind = 'all';
    if (value !== 'coin') next.coinType = 'all';
    if (value !== 'currency') next.currencyType = 'all';
  }
  return next;
}

function VaultFilters({ filters, setFilters, errors, count }) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState(() => ({ ...filters }));
  const toggleRef = useRef(null);
  const { errors: draftErrors } = filterInventoryItems([], draft);
  const updateDraft = (key, value) => setDraft(previous => changeVaultFilter(previous, key, value));
  const close = () => {
    setDraft({ ...filters });
    setExpanded(false);
    toggleRef.current?.focus();
  };
  const toggle = () => {
    if (expanded) close();
    else { setDraft({ ...filters }); setExpanded(true); }
  };
  const apply = event => {
    event.preventDefault();
    const invalid = Object.keys(draftErrors)[0];
    if (invalid) { event.currentTarget.elements.namedItem(invalid)?.focus(); return; }
    setFilters({ ...draft });
    setExpanded(false);
    toggleRef.current?.focus();
  };
  const reset = () => { setFilters({ ...defaultVaultFilters }); setDraft({ ...defaultVaultFilters }); };
  const clear = key => {
    setFilters(previous => changeVaultFilter(previous, key, defaultVaultFilters[key]));
    setDraft(previous => changeVaultFilter(previous, key, defaultVaultFilters[key]));
  };
  const numericLabel = (key, unit) => `${errors[key] ? filters[key] : number(filters[key])} ${unit}`;
  const labels = {
    query: `جستجو: ${filters.query}`, category: `گروه: ${stockCategories[filters.category]}`,
    status: `وضعیت: ${statusLabels[filters.status]}`, craftedKind: `نوع کار: ${filters.craftedKind}`,
    coinType: `نوع سکه: ${filters.coinType}`, currencyType: `نوع ارز: ${currencyName(filters.currencyType)}`,
    minPrice: `از ${numericLabel('minPrice', 'تومان')}`, maxPrice: `تا ${numericLabel('maxPrice', 'تومان')}`,
    minWeight: `از ${numericLabel('minWeight', 'گرم')}`, maxWeight: `تا ${numericLabel('maxWeight', 'گرم')}`,
  };
  const active = Object.keys(defaultVaultFilters).filter(key => String(filters[key]).trim() !== String(defaultVaultFilters[key]));
  const hasDraftFilters = Object.keys(defaultVaultFilters).some(key => String(draft[key]).trim() !== String(defaultVaultFilters[key]));
  return <section className="vault-filters" aria-labelledby="vault-filters-title">
    <div className="vault-filters-heading">
      <h2 id="vault-filters-title">فهرست اجناس</h2>
      <div className="vault-filter-toolbar">
        <button ref={toggleRef} type="button" className="button button-ghost vault-filter-toggle" data-toggle-vault-filters aria-expanded={expanded} aria-controls="vault-filter-panel" onClick={toggle}><SlidersHorizontal size={18} aria-hidden="true"/> فیلترها{!!active.length && <span className="vault-filter-badge" aria-label={`${number(active.length)} فیلتر فعال`}>{number(active.length)}</span>}<ChevronDown className="vault-filter-chevron" size={16} aria-hidden="true"/></button>
        <button type="button" className="button button-ghost" data-reset-vault-filters disabled={!active.length && !(expanded && hasDraftFilters)} onClick={reset}>پاک کردن فیلترها</button>
      </div>
    </div>
    <form id="vault-filter-panel" className="vault-filter-panel" aria-label="فیلترهای صندوق" hidden={!expanded} onSubmit={apply} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); close(); } }}>
      <p className="vault-filter-help">فیلترهای موردنظر را انتخاب کنید و «اعمال فیلترها» را بزنید.</p>
      <div className="vault-filter-main">
        <label className="vault-search"><Search size={18} aria-hidden="true"/><input name="query" aria-label="جستجو در صندوق" value={draft.query} onChange={event => updateDraft('query', event.target.value)} placeholder="نام، کد جنس، انگ یا آزمایشگاه…"/></label>
        <label>گروه<select name="category" value={draft.category} onChange={event => updateDraft('category', event.target.value)}><option value="all">همه اجناس</option>{Object.entries(stockCategories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>وضعیت<select name="status" aria-label="وضعیت موجودی" value={draft.status} onChange={event => updateDraft('status', event.target.value)}>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        {(draft.category === 'all' || draft.category === 'crafted') && <label>نوع کار<select name="craftedKind" value={draft.craftedKind} onChange={event => updateDraft('craftedKind', event.target.value)}><option value="all">همه نوع‌ها</option>{craftedKinds.map(kind => <option key={kind} value={kind}>{kind}</option>)}</select></label>}
        {draft.category === 'coin' && <label>نوع سکه<select name="coinType" value={draft.coinType} onChange={event => updateDraft('coinType', event.target.value)}><option value="all">همه سکه‌ها</option>{coinCatalog.map(coin => <option key={coin.name} value={coin.name}>{coin.name}</option>)}</select></label>}
        {draft.category === 'currency' && <label>نوع ارز<select name="currencyType" value={draft.currencyType} onChange={event => updateDraft('currencyType', event.target.value)}><option value="all">همه ارزها</option>{currencyCatalog.map(currency => <option key={currency.code} value={currency.code}>{currency.name}</option>)}</select></label>}
      </div>
      <div className="vault-filter-ranges">
        {rangeGroups.map(group => <fieldset key={group.title}><legend>{group.title}</legend><div className="vault-range-inputs">{group.fields.map(([key, label, placeholder]) => <label key={key} htmlFor={`vault-${key}`}>{label}<NumberInput id={`vault-${key}`} name={key} type="text" inputMode="decimal" value={draft[key]} placeholder={placeholder} aria-invalid={!!draftErrors[key]} aria-describedby={draftErrors[key] ? `vault-${key}-error` : undefined} onChange={event => updateDraft(key, event.target.value)}/>{draftErrors[key] && <small id={`vault-${key}-error`} className="vault-filter-error" role="alert">{draftErrors[key]}</small>}</label>)}</div></fieldset>)}
      </div>
      <p className="vault-filter-help vault-filter-note">قیمت با اجرت و سود محاسبه می‌شود. وزن، وزن خود کار است و فقط اجناس دارای وزن ثبت‌شده را نشان می‌دهد.</p>
      <div className="vault-filter-actions"><button type="submit" className="button button-primary" data-apply-vault-filters>اعمال فیلترها</button><button type="button" className="button button-ghost" data-cancel-vault-filters onClick={close}>انصراف</button></div>
    </form>
    {!!active.length && <div className="vault-filter-chips" aria-label="فیلترهای فعال">{active.map(key => <button type="button" key={key} data-clear-vault-filter={key} aria-label={`حذف فیلتر ${labels[key]}`} onClick={() => clear(key)}><span>{labels[key]}</span><X size={14} aria-hidden="true"/></button>)}</div>}
    <p className="vault-result-count" data-testid="vault-result-count" role="status" aria-live="polite">{Object.keys(errors).length ? 'بازه‌های فیلتر را اصلاح کنید.' : `${number(count)} جنس مطابق فیلترها`}</p>
  </section>;
}

const vaultItemName = item => item.itemName || (item.description !== item.typeLabel && item.description)
    || (item.category === 'coin' && item.coinType)
    || (item.category === 'currency' && currencyName(item.currencyType)) || stockCategories[item.category];
const itemHasSales = item => !!item.sales?.length || parseNumber(item.sold) > 0;

function VaultItem({ item, value, prices, onSell, onEdit, onDelete, canEditPurchases, deleteRestriction }) {
  const name = vaultItemName(item);
  const mayChangeRecord = item.source === 'opening-inventory' || canEditPurchases;
  const deleteReason = itemHasSales(item) ? 'این جنس فروش مرتبط دارد و قابل حذف نیست.' : deleteRestriction?.(item) || '';
  const unitValue = documentBreakdown({ ...item, itemCount: 1, coinCount: 1, currencyAmount: 1 }, prices);
  const specifications = [];
  if (item.category === 'crafted') {
    specifications.push(['وزن هر عدد', `${number(item.weight)} گرم`], ['عیار', number(item.ayar || 750)]);
    if (isMiscPurchase(item)) specifications.push(['وزن معادل ۷۵۰ هر عدد', `${goldGrams(miscGoldWeight750(item))} گرم`], ['وزن معادل ۷۵۰ موجودی', `${goldGrams(miscGoldWeight750(item) * item.remaining)} گرم`]);
    if (item.craftedKind) specifications.push(['نوع کار', item.craftedKind]);
    if (item.setMode) {
      specifications.push(['نوع مجموعه', `${item.setKind || item.craftedKind} ${item.setMode === 'separate' ? 'جدا' : 'با هم'}`]);
      if (item.setName) specifications.push(['نام مجموعه', item.setName]);
    }
  }
  if (item.category === 'melted') {
    specifications.push(
      ['وزن ترازو هر قطعه', `${number(item.meltedWeight)} گرم`], ['عیار', number(item.meltedAyar || 750)],
      ['وزن معادل ۷۵۰ هر قطعه', `${number(parseNumber(item.meltedWeight) * parseNumber(item.meltedAyar || 750) / 750)} گرم`],
      ['شماره انگ', item.assayCode || '—'], ['آزمایشگاه', item.laboratoryName || '—'],
    );
  }
  if (item.category === 'coin') {
    specifications.push(['نوع سکه', item.coinType]);
    if (isOrdinaryCoin(item)) {
      const spec = coinSpec(item);
      specifications.push(
        ['وزن ترازو هر سکه', `${goldGrams(spec.weight)} گرم`], ['عیار اصلی', number(spec.ayar)],
        ['وزن معادل ۷۵۰ هر سکه', `${goldGrams(spec.weight750)} گرم`],
        ['وزن ترازو موجودی', `${goldGrams(spec.weight * item.remaining)} گرم`],
        ['وزن معادل ۷۵۰ موجودی', `${goldGrams(spec.weight750 * item.remaining)} گرم`],
      );
    } else if (!isModernCoin(item) && item.coinType === 'پارسیان') specifications.push(['وزن هر عدد', `${number(item.parsianWeight)} گرم`]);
  }
  if (item.category === 'currency') specifications.push(['نوع ارز', currencyName(item.currencyType)], ['نرخ ثبت‌شده هر واحد', `${number(item.currencyRate)} تومان`]);
  return <details className="vault-item" data-product-code={item.productCode} data-inventory-id={item.id}>
    <summary className="vault-item-summary">
      <div className="vault-item-name"><h2>{name}</h2>{item.setMode && <small className="vault-set-membership">{item.setMode === 'separate' ? `عضو ${item.setName || item.setKind} · فروش جدا یا با هم` : `${item.setKind || item.craftedKind} با هم · یک کار`}</small>}</div>
      <strong className="vault-item-price">{number(unitValue.total)} <small>تومان</small></strong>
      <ChevronDown className="vault-item-chevron" size={18} aria-hidden="true"/>
    </summary>
    <div className="vault-item-details">
      <div className="vault-item-top"><span>{isMiscPurchase(item) ? 'طلای متفرقه' : stockCategories[item.category]}</span><bdi className="vault-code" dir="ltr">{item.productCode}</bdi></div>
      {(onEdit || onDelete) && <section className="vault-item-controls" aria-label={`مدیریت ${name}`}>
        <div className="vault-item-tools">
          {onEdit && <button type="button" className="button button-ghost" data-edit-stock={item.id} disabled={!mayChangeRecord} onClick={event => onEdit(item, event.currentTarget)}><Pencil size={16} aria-hidden="true"/>ویرایش جنس</button>}
          {onDelete && <button type="button" className="button button-ghost vault-item-delete" data-delete-stock={item.id} disabled={!mayChangeRecord || !!deleteReason} title={deleteReason || undefined} onClick={event => onDelete(item, event.currentTarget)}><Trash2 size={16} aria-hidden="true"/>حذف جنس</button>}
        </div>
        {(onEdit || onDelete) && !mayChangeRecord && <p className="vault-item-control-note">ویرایش و حذف خرید به دسترسی ویرایش اسناد و مشتریان نیاز دارد.</p>}
        {onDelete && mayChangeRecord && deleteReason && <p className="vault-item-control-note">{deleteReason}{itemHasSales(item) && onEdit ? ' نام، شرح و یادداشت همچنان قابل ویرایش است.' : ''}</p>}
      </section>}
      <h3>مشخصات جنس</h3>
      <dl className="vault-specifications">
        {specifications.map(([label, content]) => <div key={label}><dt>{label}</dt><dd>{content}</dd></div>)}
        <div><dt>موجودی</dt><dd>{number(item.remaining)} {stockUnit(item)}</dd></div>
        <div><dt>ورودی</dt><dd>{number(item.received)} {stockUnit(item)}</dd></div>
        <div><dt>فروخته‌شده</dt><dd>{number(item.sold)} {stockUnit(item)}</dd></div>
        <div><dt>تاریخ ورود</dt><dd>{formatRecordDate(item)}</dd></div>
      </dl>
      {item.description && item.description !== name && <p><strong>شرح: </strong>{item.description}</p>}
      {item.note && <p><strong>یادداشت: </strong>{item.note}</p>}
      <h3>جزئیات قیمت هر واحد</h3>
      <dl>
        <div><dt>ارزش پایه</dt><dd>{number(unitValue.base)} تومان</dd></div>
        {item.category !== 'currency' && <>
          <div><dt>اجرت درصدی</dt><dd>{number(item.wagePercent)}٪</dd></div>
          <div><dt>اجرت ثابت هر واحد</dt><dd>{number(item.wageFixed)} تومان</dd></div>
          <div><dt>مجموع اجرت هر واحد</dt><dd>{number(unitValue.wage)} تومان</dd></div>
        </>}
        <div><dt>هزینه‌های دیگر هر واحد</dt><dd>{number(unitValue.costs)} تومان</dd></div>
        {item.category === 'coin' && isModernCoin(item) && <div><dt>سود ثابت هر سکه</dt><dd>{number(item.profitFixed)} تومان</dd></div>}
        <div><dt>{item.category === 'coin' && isModernCoin(item) ? `مجموع سود (${number(item.profitPercent)}٪ + سود ثابت)` : `سود (${number(item.profitPercent)}٪)`}</dt><dd>{number(unitValue.profit)} تومان</dd></div>
        <div><dt>قیمت نهایی هر واحد</dt><dd>{number(unitValue.total)} تومان</dd></div>
      </dl>
      {item.remaining > 0 && <div className="vault-item-value"><span>ارزش کل موجودی این جنس</span><strong>{number(value?.total)} تومان</strong><small>اجرت: {number(value?.wage)} · هزینه‌های دیگر: {number(value?.costs)} · سود: {number(value?.profit)} تومان</small></div>}
      {item.remaining > 0 ? onSell && <button type="button" className="button button-primary" onClick={() => onSell(item)}>فروش این جنس</button> : <span className="vault-empty-badge">اتمام موجودی</span>}
      <details className="vault-item-history"><summary>سوابق ورود و فروش</summary><p>{formatRecordDate(item)} · {item.source === 'opening-inventory' ? 'موجودی اولیه' : `خرید از ${item.customerName}`} · {number(item.received)} {stockUnit(item)}</p>{item.sales.map(sale => <p key={sale.id}>{formatRecordDate(sale)} · فروش به {sale.customerName} · {number(stockQuantity(sale))} {stockUnit(sale)}</p>)}</details>
    </div>
  </details>;
}

function VaultSet({ group, assets, prices, onSell, onSellSet, itemActions }) {
  const availableCount = group.availableItems.length;
  const hiddenAvailableCount = group.availableItems.filter(item => !group.items.includes(item)).length;
  const partial = availableCount > 0 && availableCount < group.totalPieces;
  return <section className="vault-set" data-set-id={group.setId} aria-label={`${group.setKind} جدا ${group.setName}`}>
    <header className="vault-set-heading">
      <div><span className="vault-set-kind">{group.setKind} جدا</span><h2>{group.setName}</h2>
        <p>{number(availableCount)} از {number(group.totalPieces)} قطعه موجود{partial ? ' · بخشی از مجموعه فروخته شده' : availableCount ? ' · مجموعه کامل' : ' · اتمام موجودی'}</p>
      </div>
      {!!availableCount && onSellSet && <button type="button" className="button button-primary" data-sell-set={group.setId} onClick={() => onSellSet(group.availableItems)}>فروش قطعه‌ها با هم</button>}
    </header>
    {!!availableCount && onSellSet && <p className="vault-set-sale-hint">فروش با هم، همهٔ {number(availableCount)} قطعهٔ باقی‌مانده را برای انتخاب باز می‌کند.{hiddenAvailableCount > 0 && ` ${number(hiddenAvailableCount)} قطعهٔ موجود با فیلتر فعلی نمایش داده نمی‌شود.`}</p>}
    <div className="vault-set-items">{group.items.map(item => <VaultItem key={item.id} item={item} value={assets.items[item.id]} prices={prices} onSell={onSell} {...itemActions}/>)}</div>
  </section>;
}

export default function InventoryVault({ report, assets, prices, onPrices, onSell, onSellSet, onReceive, onLinkSale, onEditItem, onDeleteItem, onCreateItem, canEditPurchases = false }) {
  const [filters, setFilters] = useState(() => ({ ...defaultVaultFilters }));
  const [links, setLinks] = useState({});
  const [message, setMessage] = useState(null);
  const [editor, setEditor] = useState(null);
  const [creating, setCreating] = useState(false);
  const [createdId, setCreatedId] = useState(null);
  const focusTarget = useRef(null);
  const pageRef = useRef(null);
  const { items: visible, errors } = filterInventoryItems(report.items, filters, prices);
  const groups = inventoryDisplayGroups(visible, report.items);
  useEffect(() => {
    if (createdId == null) return;
    const target = Array.from(pageRef.current?.querySelectorAll('[data-inventory-id]') || []).find(element => element.getAttribute('data-inventory-id') === String(createdId));
    if (!target) return;
    target.open = true;
    requestAnimationFrame(() => { target.scrollIntoView({ block: 'start', behavior: 'instant' }); target.querySelector('summary')?.focus(); });
    setCreatedId(null);
  }, [createdId, report.items, visible]);
  function openEditor(item, mode, target) {
    focusTarget.current = target; setMessage(null); setEditor({ item, mode });
  }
  function closeEditor() {
    setEditor(null); setCreating(false);
    requestAnimationFrame(() => {
      if (focusTarget.current?.isConnected) focusTarget.current.focus();
      else { const heading = pageRef.current?.querySelector('#vault-filters-title'); heading?.setAttribute('tabindex', '-1'); heading?.focus(); }
    });
  }
  function openCreate(target) { focusTarget.current = target; setMessage(null); setCreating(true); }
  function created(identifier) {
    setCreating(false); setFilters({ ...defaultVaultFilters }); setCreatedId(identifier);
    setMessage({ type: 'success', text: 'جنس به موجودی صندوق حسابداری اضافه شد.' });
  }
  const deleteRestriction = item => {
    if (item.setId && report.items.some(other => other.id !== item.id && other.setId === item.setId)) return 'این جنس عضو یک مجموعهٔ چندقطعه‌ای است؛ حذف مستقل آن مجاز نیست.';
    if (item.transactionId && report.items.some(other => other.id !== item.id && other.transactionId === item.transactionId)) return 'این جنس عضو یک فاکتور چندردیفی است؛ حذف مستقل آن مجاز نیست.';
    return '';
  };
  const itemActions = {
    onEdit: onEditItem ? (item, target) => openEditor(item, 'edit', target) : undefined,
    onDelete: onDeleteItem ? (item, target) => openEditor(item, 'delete', target) : undefined,
    canEditPurchases, deleteRestriction,
  };
  const linkSale = sale => {
    if (!onLinkSale) return;
    try { onLinkSale(sale.id, links[sale.id]); setMessage({ type: 'success', text: 'فروش قبلی به جنس وصل شد و موجودی اصلاح شد.' }); }
    catch (error) { setMessage({ type: 'error', text: error.message }); }
  };
  return <div className="vault-page" ref={pageRef}>
    <header className="vault-heading"><div><span>موجودی دفتر حسابداری</span><h1><Archive size={25}/> صندوق من</h1><p>موجودی اولیه و خریدها وارد صندوق می‌شوند؛ فروش هر کد از موجودی همان جنس کم می‌شود.</p></div><div className="vault-heading-actions">{onCreateItem && <button className="button button-primary" data-add-stock onClick={event => openCreate(event.currentTarget)}><PackagePlus size={17} aria-hidden="true"/>افزودن دستی جنس</button>}{onReceive && <button className="button button-ghost" onClick={onReceive}>ثبت خرید جدید</button>}</div></header>
    <section className="vault-assets" aria-label="کل دارایی‌های صندوق">
      <div className="vault-assets-heading"><div><h2>کل دارایی‌های صندوق</h2><p>ارزش موجودی باقی‌مانده با اجرت، هزینه‌های دیگر و سود ثبت‌شده</p></div>{onPrices && <button className="button button-ghost" onClick={onPrices}>به‌روزرسانی نرخ‌ها</button>}</div>
      <div className="vault-stats asset-totals asset-money-totals">
        <article><span>ارزش کل به ریال</span><strong>{number(assets.totalRial)} <small>ریال</small></strong><small>{number(assets.totalToman)} تومان</small></article>
        <article><span>معادل کل به دلار</span><strong>{assets.equivalentUsd === null ? '—' : number(assets.equivalentUsd)} <small>دلار</small></strong>{assets.equivalentUsd === null && <small>نرخ دلار را ثبت کنید.</small>}</article>
      </div>
      <h3 className="vault-gold-heading">وزن طلای ساخته، متفرقه، آب‌شده و سکه‌های عادی</h3>
      <div className="vault-stats asset-totals asset-gold-weights">
        <article><span>گرم خود کارها</span><strong>{number(assets.goldWeightGrams)} <small>گرم</small></strong><small>وزن ترازو، بدون اجرت و سود</small></article>
        <article><span>گرم خود کارها با عیار ۷۵۰</span><strong>{number(assets.goldGrams750)} <small>گرم</small></strong><small>وزن طلا پس از تبدیل عیار</small></article>
        <article><span>گرم با اجرت</span><strong>{assets.goldWithWageGrams750 === null ? '—' : number(assets.goldWithWageGrams750)} <small>گرم</small></strong><small>معادل طلای ۷۵۰، بدون سود</small></article>
        <article><span>گرم با اجرت و سود</span><strong>{assets.goldWithWageAndProfitGrams750 === null ? '—' : number(assets.goldWithWageAndProfitGrams750)} <small>گرم</small></strong><small>معادل طلای ۷۵۰ با سود ثبت‌شده</small></article>
      </div>
      <p className="vault-note vault-gold-note">وزن‌ها شامل موجودی طلای ساخته، متفرقه، آب‌شده و سکه‌های عادی با وزن و عیار ثبت‌شده هستند. تعداد سکه‌ها و موجودی ارز نیز جدا نمایش داده می‌شوند. اجرت و سود با نرخ جاری طلا به گرم تبدیل می‌شوند؛ هزینه‌های دیگر جداگانه به تومان آمده‌اند. این وزن‌ها با هم جمع نمی‌شوند.</p>
      {assets.goldWithWageGrams750 === null && <p className="vault-note vault-gold-note">برای نمایش گرم با اجرت و سود، نرخ هر گرم طلای ۷۵۰ را ثبت کنید.</p>}
      <p className="vault-note">ارزش کل شامل طلا، سکه و ارز با اجرت، هزینه‌های دیگر و سود ثبت‌شده است و وجه نقد صندوق نیست. نرخ روزِ ثبت‌شده و در نبود آن نرخ ورود هر جنس مبنای ارزش‌گذاری است. پارسیان با قیمت ثبت‌شده هر عدد محاسبه می‌شود.</p>
      {prices.updatedAt && <p className="vault-note">آخرین ثبت نرخ‌ها: {new Date(prices.updatedAt).toLocaleString('fa-IR')}</p>}
      <div className="vault-holdings"><div><span>مجموع اجرت موجودی</span><strong>{number(assets.wage)} تومان</strong></div><div><span>هزینه‌های دیگر موجودی</span><strong>{number(assets.costs)} تومان</strong></div><div><span>سود منظورشده در ارزش موجودی</span><strong>{number(assets.profit)} تومان</strong></div>
        {Object.entries(assets.currencies).map(([code, amount]) => <div key={code}><span>موجودی {currencyName(code)}</span><strong>{number(amount)} <bdi>{code}</bdi></strong></div>)}
        {Object.entries(assets.coins).map(([name, count]) => <div key={name}><span>{name}</span><strong>{number(count)} عدد</strong></div>)}
      </div>
    </section>
    <div className="vault-stats"><article><span>کدهای موجود</span><strong>{number(report.available.length)}</strong></article><article><span>تعداد اجناس موجود</span><strong>{number(report.available.filter(item => item.category !== 'currency').reduce((sum, item) => sum + item.remaining, 0))} <small>عدد / قطعه</small></strong></article><article><span>کدهای اتمام موجودی</span><strong>{number(report.items.filter(item => item.remaining <= 0).length)}</strong></article></div>
    {onLinkSale && !!report.unlinkedSales.length && <details className="vault-legacy"><summary>{number(report.unlinkedSales.length)} فروش قبلی بدون کد جنس؛ نیازمند تطبیق موجودی</summary><p>این فروش‌ها هنوز از موجودی کدها کم نشده‌اند. جنس مربوط به هر فروش قبلی را انتخاب کنید تا موجودی دقیق شود. مبلغ و بدهی سند تغییری نمی‌کند.</p>{report.unlinkedSales.map(sale => <div className="vault-legacy-row" key={sale.id}><div><strong>{sale.itemName || sale.description || sale.typeLabel}</strong><small>{formatRecordDate(sale)} · {sale.customerName} · {number(stockQuantity(sale))} {stockUnit(sale)}</small><small>{sale.itemSummary}</small></div><select aria-label={`جنس مربوط به فروش ${sale.id}`} value={links[sale.id] || ''} onChange={event => setLinks({ ...links, [sale.id]: event.target.value })}><option value="">انتخاب کد جنس</option>{report.available.filter(item => item.category === sale.category && (item.category !== 'currency' || item.currencyType === sale.currencyType) && (item.category !== 'coin' || item.coinType === sale.coinType) && item.remaining >= stockQuantity(sale) && item.date <= sale.date).map(item => <option key={item.id} value={item.id}>{item.productCode} · {item.itemName || item.description} · {number(item.remaining)} موجود</option>)}</select><button className="button button-ghost" disabled={!links[sale.id]} onClick={() => linkSale(sale)}>اتصال فروش به جنس</button></div>)}</details>}
    {message && <p className={`form-message ${message.type}`} role={message.type === 'error' ? 'alert' : 'status'}>{message.text}</p>}
    <VaultFilters filters={filters} setFilters={setFilters} errors={errors} count={visible.length}/>
    <p className="vault-list-hint">قیمت‌ها برای هر عدد یا واحد است. برای دیدن وزن و مشخصات، روی جنس بزنید.</p>
    <div className="vault-items">{groups.map(group => group.item
      ? <VaultItem key={group.key} item={group.item} value={assets.items[group.item.id]} prices={prices} onSell={onSell} {...itemActions}/>
      : <VaultSet key={group.key} group={group} assets={assets} prices={prices} onSell={onSell} onSellSet={onSellSet} itemActions={itemActions}/>)}</div>
    {!visible.length && <div className="vault-empty"><PackageOpen size={34}/><h2>{Object.keys(errors).length ? 'بازهٔ واردشده معتبر نیست' : 'جنسی در این فهرست نیست'}</h2><p>{Object.keys(errors).length ? 'مقدارهای مشخص‌شده در فیلترها را اصلاح کنید.' : 'خرید یا موجودی اولیه را ثبت کنید، یا فیلترهای جستجو را تغییر دهید.'}</p></div>}
    <p className="vault-note">هر ردیف خرید یا موجودی اولیه، کد مستقل دارد. برای اجناس با وزن یا مشخصات متفاوت، ردیف جدا ثبت کنید. سوابق در دفتر خصوصی حسابداری شما ذخیره می‌شوند.</p>
    {editor && <VaultItemEditor key={`${editor.mode}:${editor.item.id}`} item={editor.item} name={vaultItemName(editor.item)} mode={editor.mode}
      onSave={async (id, changes) => { await onEditItem(id, changes); setMessage({ type: 'success', text: 'تغییرات جنس در صندوق ذخیره شد.' }); }}
      onDelete={async id => { await onDeleteItem(id); setMessage({ type: 'success', text: 'جنس از صندوق حسابداری حذف شد.' }); }} onClose={closeEditor}/>}
    {creating && <VaultStockCreate prices={prices} onCreate={onCreateItem} onCreated={created} onClose={closeEditor}/>}
  </div>;
}
