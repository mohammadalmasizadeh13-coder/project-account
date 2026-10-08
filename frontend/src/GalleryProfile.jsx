import React, { useContext, useEffect, useRef, useState } from 'react';
import { api } from './noorApi.js';
import { GalleryAccountContext } from './GalleryAccountContext.js';

export default function GalleryProfile({ user, onProfileChanged }) {
  const account = useContext(GalleryAccountContext);
  const [galleryName, setGalleryName] = useState(user?.galleryName || '');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const lock = useRef(false);
  useEffect(() => { setGalleryName(user?.galleryName || ''); }, [user?.galleryName]);

  async function save(event) {
    event.preventDefault();
    if (lock.current) return;
    setNotice(null);
    if (!galleryName.trim()) { setNotice({ error: true, text: 'نام گالری را وارد کنید.' }); return; }
    lock.current = true; setBusy(true);
    try {
      const result = await api('/api/owner/profile', { method: 'PATCH', body: { galleryName: galleryName.trim() } });
      if (!result.user?.galleryName) throw new Error('نام گالری از سرور دریافت نشد؛ دوباره تلاش کنید.');
      (onProfileChanged || account.onProfileChanged)(result.user);
      setGalleryName(result.user.galleryName);
      setNotice({ text: 'نام گالری ذخیره شد و روی سندهای جدید درج می‌شود.' });
    } catch (error) { setNotice({ error: true, text: error.message }); }
    finally { lock.current = false; setBusy(false); }
  }

  return <form className="gallery-profile" data-gallery-profile onSubmit={save} aria-busy={busy}>
    <h2>نام گالری روی سندها</h2>
    <p>نام گالری هنگام ثبت سند ذخیره می‌شود. تغییر نام، نام ثبت‌شده روی سندهای قبلی را عوض نمی‌کند.</p>
    {!user?.galleryName && <p>برای درج نام روی سندهای این حساب، نام گالری را وارد کنید.</p>}
    <label htmlFor="gallery-profile-name">نام گالری</label>
    <input id="gallery-profile-name" name="galleryName" autoComplete="organization" maxLength={120} required disabled={busy} value={galleryName} onChange={event => { setGalleryName(event.target.value); setNotice(null); }}/>
    {notice && <p className={notice.error ? 'gallery-profile-error' : 'gallery-profile-success'} role={notice.error ? 'alert' : 'status'}>{notice.text}</p>}
    <button className="noor-settings-action" type="submit" data-gallery-save disabled={busy}>{busy ? 'در حال ذخیره…' : 'ذخیرهٔ نام گالری'}</button>
  </form>;
}
