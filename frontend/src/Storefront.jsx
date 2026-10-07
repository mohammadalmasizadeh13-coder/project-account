import React, { useEffect, useState } from 'react';
import NumberInput from './NumberInput.jsx';
import { ArrowLeft, ArrowRight, ArrowUpLeft, Banknote, Check, Clock3, Coins, Gem, Image as ImageIcon, MapPin, Phone, RefreshCw, Scale, Search, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import { api } from './noorApi.js';
import { subscribeStorefrontUpdates } from './storefrontUpdates.js';
import { emptyStorefrontFilters, storefrontCraftedKinds, storefrontFilterCount, storefrontQuery, storefrontRanges, validateStorefrontFilters } from './storefrontFilters.js';
import './storefront.css';
import StorefrontGallery from './StorefrontGallery.jsx';
import './storefront-toolbar.css';
import './purchase.css';

const CATEGORIES = [
  ['rings', 'انگشتر', 'ring'], ['half-sets', 'نیم‌ست', 'half'],
  ['necklaces', 'گردنبند', 'necklace'], ['bracelets', 'دستبند', 'bracelet'],
  ['earrings', 'گوشواره', 'earring'], ['sets', 'سرویس', 'set'], ['other', 'دیگر زیورها', 'other'],
  ['coin', 'سکه', 'coin', Coins], ['melted', 'طلای آب‌شده', 'melted', Gem], ['currency', 'ارز', 'currency', Banknote],
];
const number = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 8 });
const money = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 });
const categoryName = id => CATEGORIES.find(category => category[0] === id)?.[1] || 'زیورآلات';
const formatTime = value => {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('fa-IR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tehran' }).format(date) : 'زمان ثبت مشخص نیست';
};
const purchaseLink = productId => `/purchase?product=${encodeURIComponent(productId)}`;
const stockType = product => product.stockType || 'crafted';
const unitLabel = product => stockType(product) === 'currency' ? `هر واحد ${product.currencyName || product.currencyType || 'ارز'}` : stockType(product) === 'coin' ? 'هر عدد سکه' : stockType(product) === 'melted' ? 'هر قطعه' : 'هر عدد';
const goldProduct = product => ['crafted', 'melted'].includes(stockType(product));
const basisFor = (product, rate) => product.priceBasis || (goldProduct(product) ? { unit: 'gram-750', rate: rate?.value, source: rate?.source, updatedAt: rate?.updatedAt, stale: rate?.stale, mode: rate?.mode } : { rate: null, stale: true, mode: 'unavailable' });
const basisLabel = product => goldProduct(product) ? 'نرخ هر گرم طلای ۱۸ عیار' : `نرخ ${unitLabel(product)}`;

function usePublicResource(path) {
  const [state, setState] = useState({ data: null, loading: Boolean(path), error: false });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!path) {
      setState({ data: null, loading: false, error: false });
      return undefined;
    }
    let mounted = true;
    let controller;
    let requestId = 0;
    let inFlight = false;
    let refreshAgain = false;
    let refreshTimer;
    setState({ data: null, loading: true, error: false });
    const fetchData = async () => {
      if (!mounted) return;
      if (inFlight) { refreshAgain = true; return; }
      inFlight = true;
      controller = new AbortController();
      const currentId = ++requestId;
      try {
        const data = await api(path, { signal: controller.signal });
        if (mounted && currentId === requestId) setState({ data, loading: false, error: false });
      } catch (error) {
        if (mounted && currentId === requestId && error.name !== 'AbortError') {
          setState(previous => ({ ...previous, ...(error.status === 404 || error.status === 410 ? { data: null } : {}), loading: false, error: true }));
        }
      } finally {
        inFlight = false;
        if (mounted && refreshAgain) { refreshAgain = false; queueRefresh(); }
      }
    };
    const queueRefresh = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(fetchData, 60);
    };
    const refreshVisible = () => { if (!document.hidden) queueRefresh(); };
    const unsubscribe = subscribeStorefrontUpdates(queueRefresh);
    window.addEventListener('focus', refreshVisible);
    window.addEventListener('pageshow', refreshVisible);
    window.addEventListener('online', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    fetchData();
    const interval = window.setInterval(refreshVisible, 5000);
    return () => {
      mounted = false; controller?.abort(); unsubscribe();
      window.clearInterval(interval); window.clearTimeout(refreshTimer);
      window.removeEventListener('focus', refreshVisible);
      window.removeEventListener('pageshow', refreshVisible);
      window.removeEventListener('online', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [path, attempt]);
  return { ...state, retry: () => setAttempt(value => value + 1) };
}

function Amount({ value, className = '' }) {
  return <span className={`noor-amount ${className}`}>{money.format(value)} <small>تومان</small></span>;
}

function RateBar({ resource }) {
  const rate = resource.data;
  const available = rate?.value > 0 && rate.mode !== 'unavailable';
  const stale = rate?.stale || resource.error;
  const label = !available ? 'نرخ طلا در دسترس نیست' : stale ? 'آخرین نرخ ثبت‌شده · نیازمند به‌روزرسانی' : rate.mode === 'live' ? 'نرخ زنده طلای ۱۸ عیار' : 'نرخ طلای ۱۸ عیار · ثبت دستی گالری';
  return <div className={`noor-ratebar ${stale ? 'noor-ratebar-stale' : ''}`} role="status" aria-live="polite">
    <div className="noor-container noor-ratebar-inner">
      <span className="noor-ratebar-value"><i className={available && !stale ? 'noor-rate-dot' : ''} />{resource.loading ? 'در حال دریافت نرخ طلا…' : label}{available && <><span className="noor-rate-divider" /><Amount value={rate.value} /><span className="noor-rate-unit">هر گرم</span></>}</span>
      <span className="noor-ratebar-time"><Clock3 size={12} aria-hidden="true" />{available ? formatTime(rate.updatedAt) : 'قیمت نهایی نیازمند استعلام است'}</span>
    </div>
  </div>;
}

function Brand() {
  return <a className="noor-brand" href="/" aria-label="گالری نور گلد، صفحه اصلی"><span className="noor-brand-mark"><Gem size={26} strokeWidth={1.25} aria-hidden="true" /></span><span><strong>نور گلد</strong><small>گالری طلا و زیورآلات</small></span></a>;
}

function SearchBox({ value, onChange, onSubmit, onClear }) {
  return <form id="noor-search-form" className="noor-search noor-catalogue-search" role="search" aria-label="جست‌وجوی کالاها" onSubmit={onSubmit}>
    <Search size={20} strokeWidth={1.6} aria-hidden="true" />
    <label className="noor-sr-only" htmlFor="noor-search">جست‌وجوی نام یا کد محصول</label>
    <input id="noor-search" name="q" value={value} onChange={event => onChange(event.target.value)} placeholder="نام یا کد کالا را جست‌وجو کنید…" autoComplete="off" maxLength={120} />
    {value && <button className="noor-icon-button" type="button" onClick={onClear} aria-label="پاک کردن جست‌وجو"><X size={16} /></button>}
    <button className="noor-search-submit" type="submit">جست‌وجو</button>
  </form>;
}

function Photo({ url, title, eager = false }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (!url || failed) return <div className="noor-no-photo"><Gem size={53} strokeWidth={0.8} aria-hidden="true" /><span>{failed ? 'تصویر در دسترس نیست' : 'تصویر محصول ثبت نشده'}</span></div>;
  return <img src={url} alt={title} loading={eager ? 'eager' : 'lazy'} decoding="async" onError={() => setFailed(true)} />;
}

function Wage({ product }) {
  const percent = Number(product.wagePercent) || 0;
  const fixed = Number(product.wageFixed) || 0;
  return <span>{number.format(percent)}٪{fixed > 0 && <> + <Amount value={fixed} /></>}</span>;
}

function ProductCard({ product, rate }) {
  const basis = basisFor(product, rate);
  return <article className="noor-product-card">
    <a className="noor-product-image" href={`/products/${encodeURIComponent(product.id)}`} aria-label={`مشاهده ${product.title}`}>
      <Photo url={product.images?.[0]?.url} title={product.title} />
      <span className="noor-product-category">{product.craftedKind || categoryName(product.category)}</span>
      {product.remaining <= 0 && <span className="noor-sold-out">ناموجود</span>}
      <span className="noor-image-cta">نگاهی نزدیک‌تر <ArrowUpLeft size={16} aria-hidden="true" /></span>
    </a>
    <div className="noor-product-content">
      <h3><a href={`/products/${encodeURIComponent(product.id)}`}>{product.title}</a></h3>
      <div className="noor-product-facts"><span>{product.weight != null ? <><Scale size={13} aria-hidden="true" />{number.format(product.weight)} گرم</> : unitLabel(product)}</span>{stockType(product) !== 'currency' && <span>اجرت: <Wage product={product} /></span>}{stockType(product) === 'currency' && <span>ارز: <bdi>{product.currencyType}</bdi></span>}</div>
      <div className="noor-product-price">{product.price ? <Amount value={product.price.total} /> : <span>قیمت با استعلام</span>}<a href={`/products/${encodeURIComponent(product.id)}`} aria-label={`جزئیات ${product.title}`}><ArrowUpLeft size={19} aria-hidden="true" /></a></div>
      {stockType(product) !== 'crafted' && <p className="noor-card-unit">قیمت برای {unitLabel(product)}</p>}
      <p className="noor-card-rate">{basisLabel(product)}: {basis.rate > 0 ? <Amount value={basis.rate} /> : 'نیازمند استعلام'}{basis.rate > 0 && (basis.stale || basis.mode === 'manual') && <span> · {basis.stale ? 'نرخ قدیمی' : 'ثبت گالری'}</span>}</p>
      <a className="noor-card-request" href={purchaseLink(product.id)}>درخواست کالا <ArrowLeft size={15} aria-hidden="true" /></a>
    </div>
  </article>;
}

function EmptyState({ error = false, retry, clear }) {
  return <div className="noor-empty" role={error ? 'alert' : 'status'}><Gem size={34} strokeWidth={1} aria-hidden="true" /><h3>{error ? 'ویترین در دسترس نیست' : 'کالایی مطابق انتخاب شما پیدا نشد'}</h3><p>{error ? 'دریافت محصولات انجام نشد. دوباره تلاش کنید.' : 'بازه‌ها یا نوع کار را تغییر دهید، یا همهٔ کالاهای موجود گالری را ببینید.'}</p><button className="noor-button noor-button-outline" onClick={error ? retry : clear}>{error ? 'تلاش دوباره' : 'نمایش همه کالاها'}<RefreshCw size={15} aria-hidden="true" /></button></div>;
}

function Catalogue({ query, setQuery, category, setCategory }) {
  const [draftQuery, setDraftQuery] = useState(query);
  const [draft, setDraft] = useState(emptyStorefrontFilters);
  const [filters, setFilters] = useState(emptyStorefrontFilters);
  const [sort, setSort] = useState('newest');
  const [filterErrors, setFilterErrors] = useState({});
  const [filtersOpen, setFiltersOpen] = useState(true);
  const parameters = storefrontQuery({ query, category, sort, filters });
  const resource = usePublicResource(`/api/public/products?${parameters}`);
  const products = resource.data?.products || [];
  const filterCount = storefrontFilterCount(filters);
  const isFiltered = Boolean(query || category || filterCount || sort !== 'newest');
  const hasPriceFilter = filters.minPrice !== '' || filters.maxPrice !== '';
  const clearAdvanced = () => { setDraft(emptyStorefrontFilters()); setFilters(emptyStorefrontFilters()); setFilterErrors({}); };
  const clearSearch = () => { setDraftQuery(''); setQuery(''); };
  const clear = () => { clearSearch(); setCategory(''); clearAdvanced(); setSort('newest'); };
  const search = event => { event.preventDefault(); setQuery(draftQuery.trim()); };
  const updateDraft = (field, value) => {
    setDraft(previous => ({ ...previous, [field]: value }));
    setFilterErrors(previous => { const next = { ...previous }; delete next[field]; return next; });
  };
  const removeFilter = fields => {
    const cleared = Object.fromEntries(fields.map(field => [field, '']));
    setDraft(previous => ({ ...previous, ...cleared }));
    setFilters(previous => ({ ...previous, ...cleared }));
    setFilterErrors(previous => { const next = { ...previous }; fields.forEach(field => delete next[field]); return next; });
  };
  const applyFilters = event => {
    event.preventDefault();
    const result = validateStorefrontFilters(draft);
    setFilterErrors(result.errors);
    if (Object.keys(result.errors).length) {
      event.currentTarget.elements.namedItem(Object.keys(result.errors)[0])?.focus();
      return;
    }
    setFilters(result.filters);
  };
  const rangeLabel = range => `${range.title}: ${filters[range.minimum] !== '' ? `از ${number.format(filters[range.minimum])} ` : ''}${filters[range.maximum] !== '' ? `تا ${number.format(filters[range.maximum])} ` : ''}${range.unit}`;
  const rows = CATEGORIES.map(([id, title]) => ({ id, title, products: products.filter(product => product.category === id) })).filter(row => row.products.length);
  return <>
    <section className="noor-categories noor-container" aria-labelledby="noor-categories-heading">
      <div className="noor-section-heading"><div><span className="noor-eyebrow">برای هر سلیقه، یک انتخاب</span><h2 id="noor-categories-heading">دنیای انتخاب‌های نور</h2></div><a href="#noor-catalogue" className="noor-text-link">کاوش در ویترین <ArrowLeft size={16} aria-hidden="true" /></a></div>
      <div className="noor-category-row"><button className={`noor-category ${!category ? 'is-active' : ''}`} onClick={() => setCategory('')} aria-pressed={!category}><span className="noor-category-art"><Sparkles size={35} strokeWidth={1} aria-hidden="true" /></span><span>همه کالاها</span></button>{CATEGORIES.map(([id, title, art, Icon]) => <button key={id} className={`noor-category ${category === id ? 'is-active' : ''}`} onClick={() => setCategory(id)} aria-pressed={category === id}><span className={`noor-category-art noor-art-${art}`} aria-hidden="true">{Icon ? <Icon size={35} strokeWidth={1} /> : <><i /><b /></>}</span><span>{title}</span></button>)}</div>
    </section>
    <section className="noor-catalogue noor-container" id="noor-catalogue" aria-labelledby="noor-catalogue-heading">
      <div className="noor-section-heading"><div><span className="noor-eyebrow">جزئیات کوچک، درخشش ماندگار</span><h2 id="noor-catalogue-heading">{query ? `نتیجه جست‌وجوی «${query}»` : category ? categoryName(category) : 'انتخابی از گالری نور'}</h2></div><span className="noor-result-count" aria-live="polite">{resource.loading ? 'در حال دریافت…' : resource.error && !resource.data ? 'دریافت انجام نشد' : `${number.format(products.length)} کالا${isFiltered ? ' مطابق انتخاب شما' : ' موجود در گالری'}`}</span></div>
      <div className="noor-toolbar">
        <SearchBox value={draftQuery} onChange={setDraftQuery} onSubmit={search} onClear={clearSearch}/>
        <div className="noor-toolbar-controls">
        {isFiltered && <button type="button" className="noor-clear-filter" onClick={clear}>پاک کردن همه <X size={14} aria-hidden="true" /></button>}
        <label className="noor-sort"><span>مرتب‌سازی:</span><select value={sort} onChange={event => setSort(event.target.value)} aria-label="مرتب‌سازی محصولات">
          <option value="newest">تازه‌ترین‌ها</option>
          <option value="price-asc">کمترین قیمت</option>
          <option value="price-desc">بیشترین قیمت</option>
          <option value="wage-asc">کمترین اجرت درصدی</option>
          <option value="wage-desc">بیشترین اجرت درصدی</option>
          <option value="weight-asc">کمترین وزن</option>
          <option value="weight-desc">بیشترین وزن</option>
        </select></label>
        <button type="button" className={`noor-filter-toggle ${filtersOpen ? 'is-active' : ''}`} onClick={() => setFiltersOpen(value => !value)} aria-expanded={filtersOpen} aria-controls="noor-filters"><SlidersHorizontal size={17} aria-hidden="true" />فیلترها{filterCount > 0 && <span className="noor-filter-count" aria-label={`${number.format(filterCount)} فیلتر فعال`}>{number.format(filterCount)}</span>}</button>
        </div>
      </div>
      <form id="noor-filters" className="noor-filter-panel noor-advanced-filters" aria-label="فیلتر کالاها" hidden={!filtersOpen} onSubmit={applyFilters} noValidate>
        <div className="noor-filter-heading"><div><h3>فیلتر کالای دلخواه</h3><p>وزن، بودجه، اجرت و نوع کار را انتخاب کنید.</p></div><SlidersHorizontal size={21} strokeWidth={1.25} aria-hidden="true" /></div>
        <div className="noor-filter-ranges">{storefrontRanges.map(range => <fieldset className="noor-filter-group" key={range.key}><legend>{range.title} <span>{range.unit}</span></legend><div className="noor-filter-pair">{[range.minimum, range.maximum].map((field, index) => {
          const id = `noor-${index === 0 ? 'min' : 'max'}-${range.key}`;
          return <label key={field} htmlFor={id}>{index === 0 ? 'حداقل' : 'حداکثر'}<NumberInput id={id} name={field} inputMode="decimal" value={draft[field]} onChange={event => updateDraft(field, event.target.value)} placeholder={range.placeholders[index]} maxLength={32} aria-label={`${index === 0 ? 'حداقل' : 'حداکثر'} ${range.title} (${range.unit})`} aria-invalid={Boolean(filterErrors[field])} aria-describedby={filterErrors[field] ? `${id}-error` : undefined} />{filterErrors[field] && <small className="noor-filter-error" id={`${id}-error`} role="alert">{filterErrors[field]}</small>}</label>;
        })}</div></fieldset>)}</div>
        <div className="noor-filter-bottom"><label className="noor-kind-filter" htmlFor="noor-crafted-kind">نوع کار ساخته<select id="noor-crafted-kind" name="craftedKind" value={draft.craftedKind} onChange={event => updateDraft('craftedKind', event.target.value)} aria-invalid={Boolean(filterErrors.craftedKind)} aria-describedby={filterErrors.craftedKind ? 'noor-kind-error' : undefined}><option value="">همهٔ نوع‌ها</option>{storefrontCraftedKinds.map(kind => <option key={kind} value={kind}>{kind}</option>)}</select>{filterErrors.craftedKind && <small className="noor-filter-error" id="noor-kind-error" role="alert">{filterErrors.craftedKind}</small>}</label><p className="noor-filter-help">قیمت نهایی به تومان و برای واحد فروش هر کالا است. نوع کار فقط زیورهای ساخته را انتخاب می‌کند؛ فیلتر وزن فقط کالاهای دارای وزن ثبت‌شده را نشان می‌دهد. اجرت ثابت در جزئیات محصول آمده است.</p></div>
        <div className="noor-filter-actions"><button className="noor-button noor-button-dark" type="submit">اعمال فیلترها <Check size={16} aria-hidden="true" /></button><button className="noor-button noor-button-outline" type="button" onClick={clearAdvanced}>پاک کردن انتخاب‌ها <X size={15} aria-hidden="true" /></button></div>
      </form>
      {filterCount > 0 && <div className="noor-filter-chips" aria-label="فیلترهای اعمال‌شده">{storefrontRanges.filter(range => filters[range.minimum] !== '' || filters[range.maximum] !== '').map(range => <button key={range.key} type="button" onClick={() => removeFilter([range.minimum, range.maximum])} aria-label={`حذف فیلتر ${rangeLabel(range)}`}><span>{rangeLabel(range)}</span><X size={13} aria-hidden="true" /></button>)}{filters.craftedKind && <button type="button" onClick={() => removeFilter(['craftedKind'])} aria-label={`حذف نوع کار ${filters.craftedKind}`}><span>نوع کار: {filters.craftedKind}</span><X size={13} aria-hidden="true" /></button>}</div>}
      {hasPriceFilter && <p className="noor-price-filter-note" role="note">با فیلتر قیمت، فقط کالاهای دارای قیمت محاسبه‌شده نمایش داده می‌شوند؛ کالاهای «قیمت با استعلام» در این نتیجه نیستند.</p>}
      {resource.error && resource.data && <p className="noor-notice" role="alert">به‌روزرسانی انجام نشد؛ موجودی و قیمت‌های نمایش‌داده‌شده نیازمند تأیید هستند. <button onClick={resource.retry}>تلاش دوباره</button></p>}
      {resource.loading ? <div className="noor-product-grid" aria-label="در حال دریافت محصولات" role="status">{[1, 2, 3, 4].map(id => <div className="noor-skeleton" key={id}><div /><span /><span /></div>)}<span className="noor-sr-only">در حال دریافت محصولات…</span></div> : !products.length ? <EmptyState error={resource.error} retry={resource.retry} clear={clear} /> : isFiltered ? <div className="noor-product-grid">{products.map(product => <ProductCard key={product.id} product={product} rate={resource.data.rate} />)}</div> : rows.map(row => <div className="noor-collection" key={row.id}><div className="noor-collection-heading"><h3>{row.title}</h3><button className="noor-text-link" onClick={() => setCategory(row.id)}>نمایش همه <ArrowLeft size={15} aria-hidden="true" /></button></div><div className="noor-product-row">{row.products.map(product => <ProductCard key={product.id} product={product} rate={resource.data.rate} />)}</div></div>)}
    </section>
  </>;
}

function ProductDetail({ productId }) {
  const resource = usePublicResource(productId ? `/api/public/products/${encodeURIComponent(productId)}` : null);
  const [selectedImage, setSelectedImage] = useState(0);
  const product = resource.data?.product;
  useEffect(() => setSelectedImage(0), [productId]);
  if (resource.loading) return <main className="noor-container noor-detail-loading" aria-busy="true"><div className="noor-skeleton"><div /></div><p role="status">در حال دریافت جزئیات کالا…</p></main>;
  if (!product) return <main className="noor-container"><div className="noor-empty"><Gem size={34} aria-hidden="true" /><h1>{resource.error ? 'دریافت این کالا ممکن نشد' : 'این کالا در ویترین موجود نیست'}</h1><p>ممکن است محصول از ویترین خارج شده باشد یا اتصال برقرار نباشد.</p><a className="noor-button noor-button-dark" href="/">بازگشت به ویترین <ArrowLeft size={16} aria-hidden="true" /></a>{resource.error && <button className="noor-text-link" onClick={resource.retry}>تلاش دوباره</button>}</div></main>;
  const images = product.images || [];
  const activeImage = images[Math.min(selectedImage, Math.max(0, images.length - 1))];
  const rate = resource.data.rate;
  const basis = basisFor(product, rate);
  const type = stockType(product);
  const baseLabel = goldProduct(product) ? 'بهای طلا' : type === 'currency' ? 'بهای هر واحد ارز' : 'بهای هر عدد سکه';
  return <main className="noor-container noor-detail">
    <nav className="noor-breadcrumb" aria-label="مسیر صفحه"><a href="/">ویترین نور</a><span>/</span><a href={`/?category=${encodeURIComponent(product.category)}`}>{categoryName(product.category)}</a><span>/</span><span>{product.title}</span></nav>
    {resource.error && <p className="noor-notice" role="alert">به‌روزرسانی قیمت انجام نشد. قیمت و موجودی را پیش از خرید با گالری تأیید کنید. <button onClick={resource.retry}>تلاش دوباره</button></p>}
    <div className="noor-detail-grid"><section className="noor-gallery" aria-label="تصاویر محصول"><div className="noor-detail-image"><Photo url={activeImage?.url} title={`${product.title}${images.length > 1 ? `، تصویر ${number.format(selectedImage + 1)}` : ''}`} eager /></div>{images.length > 1 && <div className="noor-thumbnails">{images.map((item, index) => <button key={item.id || item.url} type="button" className={index === selectedImage ? 'is-active' : ''} onClick={() => setSelectedImage(index)} aria-label={`نمایش تصویر ${number.format(index + 1)}`} aria-pressed={index === selectedImage}><Photo url={item.url} title={`${product.title}، تصویر ${number.format(index + 1)}`} /></button>)}</div>}<p className="noor-photo-note"><ImageIcon size={14} aria-hidden="true" />مشخصات و ظاهر کالا را پیش از خرید با گالری بررسی کنید.</p></section>
      <section className="noor-detail-copy"><span className="noor-eyebrow">{categoryName(product.category)} · گالری نور گلد</span><h1>{product.title}</h1><p className="noor-product-code">کد محصول: <bdi>{product.productCode || product.id}</bdi></p><p className="noor-detail-description">{product.description || 'مشخصات ثبت‌شده و جزئیات قیمت این کالا را در ادامه ببینید.'}</p>
        <dl className="noor-detail-specs">{product.craftedKind && <div><dt>نوع کار</dt><dd>{product.craftedKind}</dd></div>}{type === 'coin' && <div><dt>نوع سکه</dt><dd>{product.coinType}</dd></div>}{type === 'currency' && <div><dt>نوع ارز</dt><dd>{product.currencyName} <bdi>{product.currencyType}</bdi></dd></div>}<div><dt>دسته‌بندی</dt><dd>{categoryName(product.category)}</dd></div>{product.weight != null && <div><dt>{type === 'melted' ? 'وزن هر قطعه' : 'وزن دقیق'}</dt><dd>{number.format(product.weight)} <small>گرم</small></dd></div>}{product.purity != null && <div><dt>عیار</dt><dd>{number.format(product.purity)}</dd></div>}{type !== 'currency' && <div><dt>اجرت</dt><dd><Wage product={product} /></dd></div>}<div><dt>واحد قیمت‌گذاری</dt><dd>{unitLabel(product)}</dd></div><div><dt>وضعیت</dt><dd className={product.remaining > 0 ? 'noor-in-stock' : ''}>{product.remaining > 0 ? 'موجود در گالری' : 'ناموجود'}</dd></div></dl>
        <div className="noor-price-panel"><div className="noor-detail-rate"><span>{basisLabel(product)}</span><strong>{basis.rate > 0 ? <Amount value={basis.rate} /> : 'نیازمند استعلام'}</strong></div><p className="noor-rate-explanation">{!(basis.rate > 0) ? 'برای این کالا نرخ معتبر فروش در دسترس نیست؛ قیمت را از گالری استعلام کنید.' : basis.stale ? 'این نرخ قدیمی است؛ قیمت نیازمند تأیید گالری است.' : basis.mode === 'live' ? 'نرخ دریافتی از منبع زنده' : 'نرخ ثبت‌شده توسط گالری'}{basis.rate > 0 && basis.updatedAt && <> · {formatTime(basis.updatedAt)}</>}</p>
          {product.price && <dl className="noor-price-breakdown"><div><dt>{baseLabel}</dt><dd><Amount value={product.price.gold} /></dd></div>{type !== 'currency' && <div><dt>اجرت</dt><dd><Amount value={product.price.wage} /></dd></div>}<div><dt>سود ({number.format(product.profitPercent)}٪)</dt><dd><Amount value={product.price.profit} /></dd></div><div><dt>مالیات ({number.format(product.taxPercent)}٪)</dt><dd><Amount value={product.price.tax} /></dd></div></dl>}
          <div className="noor-detail-total"><span>قیمت {unitLabel(product)}</span>{product.price ? <Amount value={product.price.total} /> : <strong>با استعلام از گالری</strong>}</div><p className="noor-price-disclaimer">با تغییر نرخ مبنا، قیمت تغییر می‌کند. مبلغ نهایی، مقدار و موجودی پیش از خرید تأیید می‌شوند.</p>
        </div>
        <a href={purchaseLink(product.id)} className="noor-button noor-button-dark noor-purchase-button">درخواست این کالا <ArrowLeft size={18} aria-hidden="true" /></a>
        <div className="noor-purchase-info" id="noor-purchase-info"><h2>خرید با خیال روشن</h2><p>در صفحهٔ بعد، شمارهٔ تماس و آدرس گالری را ببینید و برای هماهنگی خرید این کالا با ما تماس بگیرید.</p></div>
      </section>
    </div>
  </main>;
}

function PurchasePage({ productId }) {
  const contactResource = usePublicResource('/api/public/contact');
  const productResource = usePublicResource(productId ? `/api/public/products/${encodeURIComponent(productId)}` : null);
  const product = productResource.data?.product;
  const contact = contactResource.data;
  const hasPhone = /^\+?[0-9]{8,15}$/.test(contact?.phone || '');
  return <main className="noor-purchase-page noor-container" aria-labelledby="noor-purchase-heading">
    <a className="noor-text-link noor-purchase-back" href="/#noor-catalogue"><ArrowRight size={16} aria-hidden="true" />بازگشت به کالاها</a>
    <div className="noor-purchase-heading"><span className="noor-eyebrow">یک تماس تا هماهنگی خرید</span><h1 id="noor-purchase-heading">{productId ? 'برای خرید این کار، با ما تماس بگیرید' : 'تماس با گالری نور گلد'}</h1><p>قیمت نهایی و شرایط تحویل را با گالری هماهنگ کنید.</p></div>
    <div className="noor-purchase-layout">
      <section className="noor-purchase-selection" aria-label="کالای انتخاب‌شده" aria-busy={productResource.loading}>
        {productId ? product ? <>
          <a className="noor-purchase-photo" href={`/products/${encodeURIComponent(product.id)}`}><Photo url={product.images?.[0]?.url} title={product.title} eager /></a>
          <div className="noor-purchase-product-copy"><span className="noor-eyebrow">انتخاب شما</span><h2>{product.title}</h2><p className="noor-product-code">کد محصول: <bdi>{product.productCode || product.id}</bdi></p>
            {product.weight != null && <p className="noor-purchase-weight"><Scale size={16} aria-hidden="true" />{number.format(product.weight)} گرم</p>}
            <p className="noor-purchase-hint">هنگام تماس، نام یا کد این کالا را اعلام کنید.</p>
            <a className="noor-text-link" href={`/products/${encodeURIComponent(product.id)}`}>مشاهدهٔ مشخصات کالا <ArrowUpLeft size={16} aria-hidden="true" /></a>
          </div>
        </> : <div className="noor-purchase-message" role={productResource.error ? 'alert' : 'status'}><Gem size={38} strokeWidth={1} aria-hidden="true" /><h2>{productResource.loading ? 'در حال دریافت مشخصات کالا…' : 'مشخصات این کالا در دسترس نیست'}</h2><p>{productResource.loading ? 'انتخاب شما را آماده می‌کنیم.' : 'ممکن است کالا از ویترین خارج شده باشد. برای استعلام موجودی با گالری تماس بگیرید.'}</p>{productResource.error && <button type="button" className="noor-button noor-button-outline" onClick={productResource.retry}>تلاش دوباره <RefreshCw size={16} aria-hidden="true" /></button>}</div>
        : <div className="noor-purchase-message"><Gem size={48} strokeWidth={1} aria-hidden="true" /><span className="noor-eyebrow">گالری نور گلد</span><h2>برای انتخابتان، در کنارتان هستیم.</h2><p>برای راهنمایی دربارهٔ کالاها و هماهنگی خرید یا مراجعهٔ حضوری، با ما تماس بگیرید.</p><a className="noor-text-link" href="/#noor-catalogue">مشاهدهٔ کالاها <ArrowLeft size={16} aria-hidden="true" /></a></div>}
      </section>
      <section className="noor-purchase-contact" aria-labelledby="noor-contact-heading" aria-busy={contactResource.loading}>
        <span className="noor-contact-icon"><Phone size={25} strokeWidth={1.4} aria-hidden="true" /></span><h2 id="noor-contact-heading">هماهنگی خرید با گالری</h2>
        {contactResource.loading ? <p role="status">در حال دریافت اطلاعات تماس…</p> : contactResource.error && !contact ? <div className="noor-purchase-contact-error" role="alert"><p>اطلاعات تماس دریافت نشد. دوباره تلاش کنید.</p><button type="button" className="noor-button noor-button-outline" onClick={contactResource.retry}>تلاش دوباره <RefreshCw size={16} aria-hidden="true" /></button></div> : <>
          {hasPhone ? <><p className="noor-purchase-phone-label">شمارهٔ تماس فروشگاه</p><a className="noor-purchase-phone" href={`tel:${contact.phone}`}><bdi>{contact.phone}</bdi></a><a className="noor-button noor-button-dark noor-contact-call" href={`tel:${contact.phone}`}><Phone size={18} aria-hidden="true" />تماس برای خرید <ArrowUpLeft size={18} aria-hidden="true" /></a></> : <p className="noor-contact-empty" role="status">اطلاعات تماس فروشگاه به‌زودی در این صفحه قرار می‌گیرد.</p>}
          {contact?.address && <div className="noor-purchase-contact-detail"><MapPin size={20} aria-hidden="true" /><div><h3>آدرس فروشگاه</h3><address>{contact.address}</address></div></div>}
          {contact?.hours && <div className="noor-purchase-contact-detail"><Clock3 size={20} aria-hidden="true" /><div><h3>ساعت پاسخ‌گویی</h3><p>{contact.hours}</p></div></div>}
          {hasPhone && <p className="noor-purchase-visit-note">پیش از مراجعه، موجودی کالا و زمان حضور را تلفنی هماهنگ کنید.</p>}
        </>}
      </section>
    </div>
  </main>;
}

function Footer() {
  return <footer className="noor-footer"><div className="noor-container"><div className="noor-footer-main"><div><Brand /><p>درخششِ آرام، انتخابِ ماندگار.</p></div><div><h2>انتخاب آگاهانه</h2><p>مشخصات روشن و قیمت بر اساس نرخ ثبت‌شده.<br />برای تأیید موجودی و شرایط خرید با گالری هماهنگ کنید.</p></div><div className="noor-footer-links"><a href="/">ویترین گالری</a><a href="/purchase">تماس و آدرس گالری <Phone size={14} aria-hidden="true" /></a><a href="/owner/login">ورود مدیریت گالری <ArrowUpLeft size={14} aria-hidden="true" /></a></div></div><div className="noor-footer-bottom"><span>گالری نور گلد</span><span>تمام مبلغ‌ها به تومان است.</span></div></div></footer>;
}

export default function Storefront() {
  const parameters = new URLSearchParams(window.location.search);
  const [query, setQuery] = useState(() => parameters.get('q')?.slice(0, 120) || '');
  const [category, setCategory] = useState(() => CATEGORIES.some(item => item[0] === parameters.get('category')) ? parameters.get('category') : '');
  const isDetail = window.location.pathname.startsWith('/products/');
  const isPurchase = /^\/purchase\/?$/.test(window.location.pathname);
  const isCatalogue = !isDetail && !isPurchase;
  let productId = isPurchase ? parameters.get('product')?.slice(0, 200) || null : null;
  if (isDetail) {
    try { productId = decodeURIComponent(window.location.pathname.split('/')[2] || ''); } catch { productId = null; }
  }
  const rateResource = usePublicResource('/api/public/rate');
  const galleryResource = usePublicResource(isCatalogue ? '/api/public/gallery' : null);
  const galleryProducts = usePublicResource(isCatalogue ? '/api/public/products?sort=newest' : null);
  useEffect(() => {
    document.title = isPurchase ? 'هماهنگی خرید | گالری نور گلد' : isDetail ? 'جزئیات کالا | گالری نور گلد' : 'گالری نور گلد | درخششِ آرام، انتخابِ ماندگار';
  }, [isDetail, isPurchase]);
  return <div className="noor-store" dir="rtl" lang="fa"><a className="noor-skip-link" href={isCatalogue ? '#noor-catalogue' : '#noor-content'}>رفتن به محتوای اصلی</a><RateBar resource={rateResource} /><header className="noor-header"><div className="noor-container noor-header-inner"><Brand /><a className="noor-header-link" href={isCatalogue ? '#noor-catalogue' : '/#noor-catalogue'}>مجموعه کالاها <ArrowUpLeft size={15} aria-hidden="true" /></a></div></header><div id="noor-content">{isPurchase ? <PurchasePage productId={productId} /> : isDetail ? <ProductDetail productId={productId} /> : <main><StorefrontGallery images={galleryResource.data?.images} products={galleryProducts.data?.products}/><div className="noor-values noor-container"><span><Scale size={19} strokeWidth={1.4} aria-hidden="true" />وزن و اجرت شفاف</span><span><RefreshCw size={18} strokeWidth={1.4} aria-hidden="true" />قیمت بر پایه نرخ ثبت‌شده</span><span><Gem size={19} strokeWidth={1.4} aria-hidden="true" />انتخاب مستقیم از گالری</span></div><Catalogue query={query} setQuery={setQuery} category={category} setCategory={setCategory} /><section className="noor-closing noor-container"><span className="noor-eyebrow">یک انتخاب، برای ماندن</span><h2>طلایی که به شما می‌آید.</h2><p>جزئیات را ببینید، مقایسه کنید و انتخابتان را با گالری هماهنگ کنید.</p><a href="#noor-catalogue" className="noor-text-link">بازگشت به کالاها <ArrowRight size={16} aria-hidden="true" /></a></section></main>}</div><Footer /></div>;
}
