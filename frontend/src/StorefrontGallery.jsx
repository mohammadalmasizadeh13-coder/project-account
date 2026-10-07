import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpLeft } from 'lucide-react';
import { storefrontGallerySlides } from './storefrontGallery.js';
import bracelet from './assets/gallery/gold-bracelet.webp';
import earrings from './assets/gallery/gold-earrings.webp';
import rings from './assets/gallery/gold-rings.webp';
import './storefront-gallery.css';

const samples = [
  { id: 'sample-bracelet', url: bracelet, title: 'ظرافت، در جزئیات', alt: 'تصویر نمونهٔ تزئینی دستبند و زنجیر طلا', sample: true },
  { id: 'sample-earrings', url: earrings, title: 'درخششِ هر روز', alt: 'تصویر نمونهٔ تزئینی گوشواره و گردنبند طلا', sample: true },
  { id: 'sample-rings', url: rings, title: 'سادگیِ ماندگار', alt: 'تصویر نمونهٔ تزئینی انگشترهای طلا', sample: true },
];
const format = value => new Intl.NumberFormat('fa-IR').format(value);

export default function StorefrontGallery({ images = [], products = [] }) {
  const [selectedId, setSelectedId] = useState(null);
  const [failed, setFailed] = useState([]);
  const available = storefrontGallerySlides(images, products).filter(photo => !failed.includes(photo.url));
  const slides = (available.length ? available : samples).filter(photo => !failed.includes(photo.url));
  const selected = slides.find(photo => photo.id === selectedId) || slides[0];
  const activeIndex = slides.indexOf(selected);
  const preview = slides.filter(photo => photo.id !== selected?.id).slice(0, 2);
  const change = offset => setSelectedId(slides[(activeIndex + offset + slides.length) % slides.length].id);
  const fail = url => setFailed(previous => previous.includes(url) ? previous : [...previous, url]);

  return <section className="noor-hero noor-photo-gallery noor-container" aria-labelledby="noor-hero-heading">
    <div className="noor-photo-heading"><div><span className="noor-eyebrow">گالری نور گلد</span><h1 id="noor-hero-heading">طلا، در قاب نور</h1></div><a href="#noor-catalogue" className="noor-text-link">کشف کالاها <ArrowUpLeft size={18} aria-hidden="true"/></a></div>
    {selected ? <>
      <div className={`noor-photo-layout${preview.length ? '' : ' noor-photo-solo'}`}>
        <figure className="noor-photo-main" aria-live="polite">
          <img key={selected.url} src={selected.url} alt={selected.alt || selected.title} fetchPriority="high" decoding="async" onError={() => fail(selected.url)}/>
          <figcaption><div>{selected.sample && <span className="noor-sample-label">تصویر نمونهٔ تزئینی</span>}<h2>{selected.title}</h2></div>{selected.href && <a href={selected.href}>مشاهدهٔ این کار <ArrowUpLeft size={19} aria-hidden="true"/></a>}</figcaption>
        </figure>
        {preview.length > 0 && <div className="noor-photo-previews">{preview.map(photo => <button key={photo.id} type="button" onClick={() => setSelectedId(photo.id)} aria-label={`نمایش ${photo.title}`}>
          <img src={photo.url} alt={photo.alt || photo.title} decoding="async" onError={() => fail(photo.url)}/><span>{photo.title}<ArrowUpLeft size={16} aria-hidden="true"/></span>
        </button>)}</div>}
      </div>
      {slides.length > 1 && <div className="noor-photo-controls"><span>{format(activeIndex + 1)} <span aria-hidden="true">/</span> {format(slides.length)}</span><div className="noor-photo-dots" aria-label="انتخاب تصویر">{slides.map(photo => <button key={photo.id} type="button" aria-label={`تصویر ${photo.title}`} aria-pressed={photo.id === selected.id} onClick={() => setSelectedId(photo.id)}/>)}</div><div className="noor-photo-arrows"><button type="button" onClick={() => change(-1)} aria-label="تصویر قبلی"><ArrowRight size={19}/></button><button type="button" onClick={() => change(1)} aria-label="تصویر بعدی"><ArrowLeft size={19}/></button></div></div>}
    </> : <p className="noor-photo-unavailable">تصاویر گالری در دسترس نیستند. مجموعهٔ کالاها را در پایین ببینید.</p>}
  </section>;
}
