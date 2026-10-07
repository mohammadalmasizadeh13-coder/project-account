import React, { useEffect, useRef, useState } from 'react';
import NumberInput from './NumberInput.jsx';
import { ChevronDown, ImagePlus, RefreshCw, Store, Trash2 } from 'lucide-react';
import { api } from './noorApi.js';
import { flushWorkspace } from './ownerStorage.js';
import { normalizeDigits } from './persianDate.js';
import { currencyName } from './assets.js';
import { stockCategories, stockUnit } from './inventory.js';
import { profitPercentInput } from './profitDefaults.js';
import './storefront-manager.css';

const categories = {
  rings: 'انگشتر', 'half-sets': 'نیم‌ست', necklaces: 'گردنبند و زنجیر',
  bracelets: 'دستبند و النگو', earrings: 'گوشواره', sets: 'ست و سرویس', other: 'سایر زیورآلات',
  coin: 'سکه', melted: 'طلای آب‌شده', currency: 'ارز',
};
const categoryByKind = {
  'انگشتر': 'rings', 'نیم‌ست': 'half-sets', 'نیم ست': 'half-sets', 'گردنبند': 'necklaces',
  'زنجیر': 'necklaces', 'دستبند': 'bracelets', 'النگو': 'bracelets', 'گوشواره': 'earrings',
  'ست': 'sets', 'سرویس': 'sets',
};
const format = value => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 3 }).format(Number(value) || 0);
const numeric = value => Number(normalizeDigits(value).replace(/[,٬\s]/g, '').replace('٫', '.'));
const errorMessage = error => error?.message || 'ارتباط با سرور برقرار نشد. دوباره تلاش کنید.';
const productKey = product => String(product.inventorySourceId ?? product.id);
function makeDraft(item, product) {
  return {
    title: [product?.title, item.itemName, item.craftedKind, item.coinType, item.category === 'currency' ? currencyName(item.currencyType) : '', stockCategories[item.category]].map(value => String(value || '').trim()).find(Boolean) || 'کالا',
    description: product?.description ?? '', category: product?.category ?? (item.category === 'crafted' ? categoryByKind[item.craftedKind] ?? 'other' : item.category),
    published: product?.published ?? true, profitPercent: String(product?.profitPercent ?? 7),
    taxPercent: String(product?.taxPercent ?? 0),
  };
}
function displayTime(value) {
  if (!value || Number.isNaN(new Date(value).getTime())) return 'هنوز به‌روزرسانی نشده';
  return new Intl.DateTimeFormat('fa-IR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Tehran' }).format(new Date(value));
}

export default function StorefrontManager({ report, externalProducts, onProductsChange, defaultOpen = false, active = true }) {
  const items = report?.items || [];
  const [expanded, setExpanded] = useState(defaultOpen);
  const [loaded, setLoaded] = useState(false);
  const [products, setProducts] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [drafts, setDrafts] = useState({});
  const [rate, setRate] = useState(null);
  const [rateInput, setRateInput] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const operation = useRef(false);
  const externalVisibility = useRef(new Map());
  const uploadRef = useRef(null);
  const item = items.find(entry => String(entry.id) === selectedId) || items[0];
  const itemId = item ? String(item.id) : '';
  const product = products.find(entry => productKey(entry) === itemId);
  const draft = item ? drafts[itemId] || makeDraft(item, product) : null;
  const images = product?.images || [];

  useEffect(() => {
    if (!externalProducts) return;
    setProducts(externalProducts);
    // Vault visibility changes must not be undone by an old metadata draft.
    const changedVisibility = new Map(externalProducts.filter(entry => externalVisibility.current.has(productKey(entry)) && externalVisibility.current.get(productKey(entry)) !== entry.published).map(entry => [productKey(entry), entry.published]));
    externalVisibility.current = new Map(externalProducts.map(entry => [productKey(entry), entry.published]));
    setDrafts(previous => Object.fromEntries(Object.entries(previous).map(([id, value]) => {
      return [id, changedVisibility.has(id) ? { ...value, published: changedVisibility.get(id) } : value];
    })));
  }, [externalProducts]);

  async function perform(label, callback) {
    if (operation.current) return;
    operation.current = true;
    setBusy(label); setError(''); setMessage('');
    try { await callback(); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { operation.current = false; setBusy(''); }
  }

  async function loadProducts() {
    await flushWorkspace();
    const response = await api('/api/owner/products');
    if (!Array.isArray(response.products)) throw new Error('فهرست محصولات از سرور دریافت نشد. دوباره تلاش کنید.');
    setProducts(response.products);
    onProductsChange?.(response.products);
    return response.products;
  }

  function refresh() {
    return perform('refresh', async () => {
      const results = await Promise.allSettled([loadProducts(), api('/api/public/rate')]);
      if (results[0].status === 'fulfilled') setLoaded(true);
      if (results[1].status === 'fulfilled') setRate(results[1].value.rate ?? results[1].value);
      const failed = results.find(result => result.status === 'rejected');
      if (failed) throw failed.reason;
    });
  }

  useEffect(() => {
    if (defaultOpen && active) refresh();
  }, [active]);

  function update(key, value) {
    setDrafts(previous => ({ ...previous, [itemId]: { ...draft, [key]: value } }));
    setMessage('');
  }

  async function saveProduct(event) {
    event.preventDefault();
    const profitPercent = numeric(profitPercentInput(draft.profitPercent, item.category));
    const taxPercent = numeric(draft.taxPercent);
    if (!draft.title.trim()) { setError('نام محصول را وارد کنید.'); return; }
    if (![profitPercent, taxPercent].every(value => Number.isFinite(value) && value >= 0 && value <= 100)) {
      setError('درصد سود و مالیات باید عددی بین صفر تا صد باشد.'); return;
    }
    const savingId = itemId;
    await perform('save', async () => {
      await flushWorkspace();
      await api(`/api/owner/products/${encodeURIComponent(savingId)}`, {
        method: 'PUT', body: { ...draft, title: draft.title.trim(), description: draft.description.trim(), profitPercent, taxPercent },
      });
      await loadProducts();
      setDrafts(previous => { const next = { ...previous }; delete next[savingId]; return next; });
      setMessage(draft.published ? 'اطلاعات ویترین ذخیره شد؛ این محصول تا زمانی که موجودی دارد در سایت نمایش داده می‌شود.' : 'محصول از سایت مخفی شد؛ اطلاعات و تصاویر آن در حسابداری محفوظ است.');
    });
  }

  async function uploadImage(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('تصویر را با فرمت جی‌پگ، پی‌ان‌جی یا وب‌پی انتخاب کنید.'); return;
    }
    if (file.size > 5 * 1024 * 1024) { setError('حجم هر تصویر باید حداکثر ۵ مگابایت باشد.'); return; }
    await perform('upload', async () => {
      const body = new FormData();
      body.append('file', file);
      await api(`/api/owner/products/${encodeURIComponent(product.id)}/images`, { method: 'POST', body });
      await loadProducts();
      setMessage('تصویر به محصول اضافه شد. اطلاعات ویرایش‌شدهٔ فرم همچنان حفظ شده است.');
    });
  }

  async function removeImage(imageId) {
    await perform(`remove-${imageId}`, async () => {
      await api(`/api/owner/products/${encodeURIComponent(product.id)}/images/${encodeURIComponent(imageId)}`, { method: 'DELETE' });
      await loadProducts();
      setMessage('تصویر از محصول حذف شد.');
    });
  }

  async function saveRate(event) {
    event.preventDefault();
    const value = numeric(rateInput);
    if (!Number.isFinite(value) || value <= 0) { setError('نرخ هر گرم طلای ۱۸ عیار را به تومان و بیشتر از صفر وارد کنید.'); return; }
    await perform('rate', async () => {
      const response = await api('/api/owner/rate', { method: 'PUT', body: { value } });
      setRate(response.rate ?? response);
      setRateInput('');
      await loadProducts();
      setMessage('نرخ فروشگاه ثبت شد و قیمت محصولات بر اساس آن محاسبه می‌شود.');
    });
  }

  const currentRate = rate?.value;
  const automaticRate = rate?.mode === 'live';
  const rateMode = rate?.mode === 'manual' ? rate.source || 'ثبت دستی مدیر' : automaticRate ? 'دریافت خودکار' : 'در انتظار نرخ معتبر';
  return <section className="noor-manager" dir="rtl" aria-labelledby="noor-manager-title">
    <button type="button" className="noor-manager-heading" aria-expanded={expanded} aria-controls="noor-manager-panel" onClick={() => {
      const next = !expanded; setExpanded(next); if (next && !loaded) refresh();
    }}>
      <Store size={22} aria-hidden="true"/>
      <span><strong id="noor-manager-title">ویترین و تصاویر فروشگاه</strong><small>گالری نور گلد · نمایش خودکار موجودی و مدیریت تصاویر مشترک</small></span>
      <ChevronDown size={19} className={expanded ? 'is-open' : ''} aria-hidden="true"/>
    </button>
    <div id="noor-manager-panel" className="noor-manager-panel" hidden={!expanded}>
      <div className="noor-manager-toolbar">
        <p>اجناس صندوق با موجودی و مشخصات معتبر، خودکار در سایت نمایش داده می‌شوند. برای تکمیل تصاویر و توضیحات یا مخفی‌کردن یک محصول، آن را از صندوق انتخاب کنید.</p>
        <button type="button" className="noor-manager-button secondary" onClick={refresh} disabled={!!busy}><RefreshCw size={16} aria-hidden="true"/> {busy === 'refresh' ? 'در حال دریافت…' : 'دریافت آخرین اطلاعات'}</button>
      </div>
      {error && <p className="noor-manager-notice error" role="alert">{error}</p>}
      {message && <p className="noor-manager-notice success" role="status">{message}</p>}
      <section className="noor-manager-rate" aria-labelledby="noor-rate-title">
        <div>
          <h3 id="noor-rate-title">نرخ طلای ویترین</h3>
          <strong>{currentRate ? `${format(currentRate)} تومان` : 'نرخ ثبت نشده است'}</strong>
          <p>هر گرم طلای ۱۸ عیار · {currentRate ? rateMode : 'در انتظار نرخ معتبر'}</p>
          <small>آخرین به‌روزرسانی: {displayTime(rate?.updatedAt)}</small>
          {rate?.stale && <p className="noor-manager-stale">نرخ نیاز به به‌روزرسانی دارد؛ قیمت ویترین قطعی نیست.</p>}
        </div>
        <form onSubmit={saveRate}>
          <label htmlFor="noor-manual-rate">ثبت دستی نرخ هر گرم (تومان)</label>
          <div><NumberInput id="noor-manual-rate" inputMode="decimal" type="text" value={rateInput} onChange={event => setRateInput(event.target.value)} placeholder="نرخ روز به تومان" required disabled={!!busy || automaticRate}/><button className="noor-manager-button" type="submit" disabled={!!busy || automaticRate}>{busy === 'rate' ? 'در حال ثبت…' : 'ثبت نرخ'}</button></div>
          {automaticRate && <small>دریافت خودکار نرخ فعال است؛ نرخ از منبع متصل به فروشگاه به‌روزرسانی می‌شود.</small>}
          <small>اگر دریافت خودکار فعال نباشد، جدیدترین نرخ معتبر ثبت‌شده در حسابداری یا ویترین، با زمان ثبت خودش مبنای قیمت سایت است. مبلغ اسناد حسابداری گذشته تغییر نمی‌کند.</small>
        </form>
      </section>
      {!items.length ? <p className="noor-manager-empty">برای ساخت ویترین، ابتدا یک جنس در موجودی اول دوره یا خرید ثبت کنید.</p> : <>
        <label className="noor-manager-picker" htmlFor="noor-product-picker">انتخاب جنس از صندوق
          <select id="noor-product-picker" value={itemId} disabled={!!busy} onChange={event => { setSelectedId(event.target.value); setError(''); setMessage(''); }}>
            {items.map(entry => <option key={entry.id} value={String(entry.id)}>{entry.productCode} · {entry.itemName || entry.craftedKind || entry.coinType || (entry.category === 'currency' ? currencyName(entry.currencyType) : stockCategories[entry.category])} · {format(entry.remaining)} {stockUnit(entry)}{Number(entry.remaining) <= 0 ? ' · ناموجود' : ''}</option>)}
          </select>
        </label>
        <div className="noor-manager-editor">
          <form className="noor-manager-metadata" onSubmit={saveProduct}>
            <div className="noor-manager-section-title"><h3>اطلاعات عمومی محصول</h3><span className={product?.published !== false ? 'published' : 'draft'}>{product?.published !== false ? 'نمایش فعال' : 'مخفی از سایت'}</span></div>
            <fieldset disabled={!!busy || !loaded}>
              <label htmlFor="noor-product-title">نام محصول در ویترین<input id="noor-product-title" value={draft.title} maxLength={160} required onChange={event => update('title', event.target.value)}/></label>
              <label htmlFor="noor-product-category">دسته‌بندی<select id="noor-product-category" value={draft.category} onChange={event => update('category', event.target.value)}>{Object.entries(categories).filter(([key]) => item.category === 'crafted' ? !['coin', 'melted', 'currency'].includes(key) : key === item.category).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
              <label htmlFor="noor-product-description">توضیحات قابل نمایش به مشتری<textarea id="noor-product-description" value={draft.description} maxLength={4000} rows={4} placeholder="ویژگی‌های ظاهری، اندازه و جزئیات انتخاب محصول" onChange={event => update('description', event.target.value)}/></label>
              <div className="noor-manager-percentages">
                <label htmlFor="noor-product-profit">سود فروشگاه (درصد)<NumberInput id="noor-product-profit" inputMode="decimal" value={draft.profitPercent} required={item.category !== 'crafted'} placeholder={item.category === 'crafted' ? 'خالی = ۷٪' : ''} onChange={event => update('profitPercent', event.target.value)}/>{item.category === 'crafted' && <small>پیش‌فرض ۷٪؛ قابل تغییر، حتی به صفر</small>}</label>
                <label htmlFor="noor-product-tax">مالیات بر اجرت و سود (درصد)<NumberInput id="noor-product-tax" inputMode="decimal" value={draft.taxPercent} required onChange={event => update('taxPercent', event.target.value)}/></label>
              </div>
              <small>درصد مالیات را مطابق مقررات قابل اعمال به کسب‌وکار خود تنظیم کنید.</small>
              <label className="noor-manager-publish" htmlFor="noor-product-publish"><input id="noor-product-publish" type="checkbox" checked={draft.published} onChange={event => update('published', event.target.checked)}/><span>نمایش در سایت<small>برای مخفی‌کردن این محصول، تیک را بردارید و تغییرات را ذخیره کنید. با اتمام موجودی، نمایش محصول خودکار متوقف می‌شود.</small></span></label>
              <button className="noor-manager-button" type="submit">{busy === 'save' ? 'در حال ذخیره…' : 'ذخیرهٔ اطلاعات ویترین'}</button>
            </fieldset>
          </form>
          <div className="noor-manager-media">
            <h3>تصاویر محصول</h3>
            <p>همین تصاویر در حسابداری و صفحهٔ عمومی این محصول نمایش داده می‌شوند. اولین تصویر، تصویر اصلی ویترین است.</p>
            <div className="noor-manager-images">
              {images.length ? images.map((photo, index) => <figure key={photo.id}>
                <img src={photo.url} alt={`${product?.title || item.itemName || 'محصول'}، تصویر ${format(index + 1)}`} loading="lazy"/>
                <figcaption>{index === 0 ? 'تصویر اصلی' : `تصویر ${format(index + 1)}`}<button type="button" title="حذف تصویر" aria-label={`حذف تصویر ${format(index + 1)}`} disabled={!!busy} onClick={() => removeImage(photo.id)}><Trash2 size={16} aria-hidden="true"/></button></figcaption>
              </figure>) : <div className="noor-manager-image-empty"><ImagePlus size={32} aria-hidden="true"/><span>هنوز تصویری ثبت نشده است</span></div>}
            </div>
            <input ref={uploadRef} id="noor-product-image" className="noor-manager-file" type="file" accept="image/jpeg,image/png,image/webp" disabled={!!busy || !product} onChange={uploadImage} aria-label="انتخاب تصویر محصول"/>
            <button type="button" className="noor-manager-button secondary" disabled={!!busy || !product} onClick={() => uploadRef.current?.click()}><ImagePlus size={17} aria-hidden="true"/>{busy === 'upload' ? 'در حال بارگذاری…' : 'افزودن تصویر'}</button>
            <small>{product ? 'حداکثر ۵ مگابایت؛ فرمت جی‌پگ، پی‌ان‌جی یا وب‌پی.' : 'برای افزودن تصویر، ابتدا آخرین اطلاعات محصول را دریافت کنید.'}</small>
            <h3>مشخصات متصل به موجودی</h3>
            <dl className="noor-manager-specs">
              <div><dt>کد جنس</dt><dd><bdi>{item.productCode}</bdi></dd></div>
              {product?.weight != null && <div><dt>وزن هر قطعه</dt><dd>{format(product.weight)} گرم</dd></div>}
              {product?.purity != null && <div><dt>عیار</dt><dd>{format(product.purity)}</dd></div>}
              <div><dt>موجودی</dt><dd>{format(item.remaining)} {stockUnit(item)}</dd></div>
              {item.category !== 'currency' && <><div><dt>اجرت درصدی</dt><dd>{format(item.wagePercent)}٪</dd></div>
              <div><dt>اجرت ثابت هر قطعه</dt><dd>{format(item.wageFixed)} تومان</dd></div></>}
            </dl>
            <small>مشخصات و موجودی از صندوق خوانده می‌شوند. برای اصلاح، دکمهٔ «ویرایش» همان جنس را در صندوق بزنید. نام و توضیح عمومیِ سفارشی این بخش، مستقل از نام و یادداشت صندوق است.</small>
            {product?.price && <p className="noor-manager-price">قیمت ویترین با اطلاعات ذخیره‌شده <strong>{format(product.price.total)} تومان</strong></p>}
          </div>
        </div>
      </>}
    </div>
  </section>;
}
