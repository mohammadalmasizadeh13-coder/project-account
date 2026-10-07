import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, ChartNoAxesCombined, Check, CheckCheck, ChevronLeft, Coins, Eye, EyeOff, FileText, Gem, LayoutDashboard, LockKeyhole, Package, ReceiptText, ShieldCheck, Users, Wallet } from 'lucide-react';
import { api } from './noorApi.js';
import './accounting-welcome.css';

const features = [
  { Icon: ReceiptText, title: 'خرید، فروش و فاکتور', text: 'اسناد خرید و فروش را ثبت کنید و پرداخت‌ها و ماندهٔ هر فاکتور را ببینید.' },
  { Icon: Gem, title: 'موجودی طلا، سکه و ارز', text: 'موجودی اولیه، ورود و خروج هر جنس و ارزش دارایی‌ها همیشه پیش چشم شماست.' },
  { Icon: Users, title: 'مشتریان و همکاران تجاری', text: 'پروندهٔ مشتریان، فاکتور بنکدار و حساب بد و بس حواله‌های همکاران را جدا پیگیری کنید.' },
  { Icon: ChartNoAxesCombined, title: 'گزارش سود و هزینه', text: 'فروش، سود و هزینه‌های کسب‌وکارتان را در بازه‌های زمانی مختلف بررسی کنید.' },
  { Icon: Wallet, title: 'چک‌ها و سررسیدها', text: 'چک‌های دریافتی و پرداختی را ثبت کنید و سررسیدهای پیش رو را پیگیری کنید.' },
  { Icon: ShieldCheck, title: 'کاربران و پشتیبان', text: 'برای کارکنان دسترسی مشخص بسازید و از اطلاعات دفترتان نسخهٔ پشتیبان بگیرید.' },
];

function Brand() {
  return <a className="accounting-brand" href="/" aria-label="زرنگار، صفحهٔ اصلی"><span><BookOpen size={23} aria-hidden="true"/></span><div><strong>زرنگار</strong><small>حسابداری آنلاین</small></div></a>;
}

function DashboardPreview() {
  return <div className="accounting-preview-stage">
    <div className="accounting-preview" aria-label="پیش‌نمایش یک دفتر حسابداری خالی">
      <div className="accounting-preview-top"><span><span className="accounting-preview-logo"><BookOpen size={17}/></span> دفتر حسابداری من</span><small>پیش‌نمایش</small></div>
      <div className="accounting-preview-body">
        <aside aria-hidden="true"><LayoutDashboard/><ReceiptText/><Gem/><Users/><Wallet/></aside>
        <div className="accounting-preview-content">
          <div className="accounting-preview-heading"><div><small>همه‌چیز از همین‌جا شروع می‌شود</small><h2>یک نگاه به حساب‌ها</h2></div><span><CheckCheck size={15}/> دفتر اختصاصی</span></div>
          <div className="accounting-preview-balance"><span>ارزش دارایی‌های شما <Wallet size={18}/></span><strong>۰ <small>تومان</small></strong><p>طلا، سکه، ارز و موجودی صندوق</p><div><i/> آمادهٔ ثبت اولین موجودی</div></div>
          <div className="accounting-preview-stats"><div><span><ArrowLeft size={14}/> فروش ثبت‌شده</span><strong>۰ <small>تومان</small></strong></div><div><span><Coins size={14}/> ماندهٔ مشتریان</span><strong>۰ <small>تومان</small></strong></div></div>
          <div className="accounting-preview-ledger"><div><strong>آخرین اسناد</strong><span>دفتر شما</span></div><FileText size={28}/><p>اولین سند، شروع یک حساب روشن</p><small>خرید، فروش و هزینه‌ها را اینجا ثبت می‌کنید.</small></div>
        </div>
      </div>
    </div>
    <div className="accounting-preview-note"><span><LockKeyhole size={19}/></span><div><strong>اطلاعات شما، در دفتر خودتان</strong><small>هر حساب یک فضای حسابداری مستقل دارد.</small></div></div>
  </div>;
}

export function AccountingLanding() {
  return <div className="accounting-site" dir="rtl">
    <a className="accounting-skip" href="#main">رفتن به محتوای اصلی</a>
    <header className="accounting-header"><div className="accounting-container"><Brand/><nav aria-label="منوی اصلی"><a href="#features">امکانات</a><a href="#start">شروع کار</a></nav><div className="accounting-header-actions"><a className="accounting-login-link" href="/login">ورود</a><a className="accounting-button accounting-button-dark" href="/register">ساخت حساب <ArrowLeft size={16}/></a></div></div></header>
    <main id="main">
      <section className="accounting-hero accounting-container">
        <div className="accounting-hero-copy"><p className="accounting-eyebrow"><span/> حسابداری آنلاین طلا و جواهر</p><h1>حساب‌های کسب‌وکارت،<br/><em>مرتب و روشن.</em></h1><p className="accounting-lead">از اولین خرید تا آخرین تسویه؛ موجودی، فاکتورها، مشتریان و چک‌ها را در دفتر اختصاصی خود مدیریت کنید.</p><div className="accounting-hero-actions"><a className="accounting-button accounting-button-gold" href="/register">ساخت حساب حسابداری <ArrowLeft size={18}/></a><a className="accounting-secondary-link" href="/login">قبلاً ثبت‌نام کرده‌اید؟ <ChevronLeft size={17}/></a></div><div className="accounting-hero-details"><span><Check size={15}/> دفتر مستقل برای هر حساب</span><span><Check size={15}/> فارسی و راست‌به‌چپ</span></div></div>
        <DashboardPreview/>
      </section>
      <div className="accounting-benefits accounting-container"><div><ReceiptText/><span>ثبت‌ها و فاکتورها<strong>منظم، از خرید تا تسویه</strong></span></div><div><Package/><span>صندوق و موجودی<strong>دید روشن از دارایی‌ها</strong></span></div><div><ShieldCheck/><span>فضای اختصاصی<strong>حساب‌ها جدا از یکدیگر</strong></span></div></div>
      <section className="accounting-features accounting-container" id="features"><div className="accounting-section-title"><p className="accounting-eyebrow">یک دفتر، تمام حساب‌ها</p><h2>کارهای روزمره، در یک جای مشخص</h2><p>ابزارهای حسابداری کسب‌وکارتان را کنار هم داشته باشید.</p></div><div className="accounting-feature-grid">{features.map(({ Icon, title, text }) => <article key={title}><span><Icon size={23}/></span><h3>{title}</h3><p>{text}</p></article>)}</div></section>
      <section className="accounting-start accounting-container" id="start"><div><p className="accounting-eyebrow">از دفتر خالی تا حساب‌های مرتب</p><h2>شروع کار، فقط سه قدم</h2><p>حساب بسازید و اطلاعات کسب‌وکار خودتان را وارد کنید.</p><a className="accounting-button accounting-button-dark" href="/register">دفتر من را بساز <ArrowLeft size={17}/></a></div><ol><li><span>۱</span><div><h3>حساب خودتان را بسازید</h3><p>یک نام کاربری و رمز عبور انتخاب کنید.</p></div></li><li><span>۲</span><div><h3>موجودی اولیه را وارد کنید</h3><p>دارایی‌ها و حساب‌های شروع کار را ثبت کنید؛ یا این مرحله را به بعد بسپارید.</p></div></li><li><span>۳</span><div><h3>حسابداری را شروع کنید</h3><p>سند ثبت کنید، مشتری اضافه کنید و گزارش‌های دفترتان را ببینید.</p></div></li></ol></section>
    </main>
    <footer className="accounting-footer"><div className="accounting-container"><Brand/><p>دفتر روشن برای کسب‌وکار شما.</p><a href="/login">ورود به حسابداری <ArrowLeft size={15}/></a></div></footer>
  </div>;
}

export function AccountingAuth({ mode, onAuthenticated }) {
  const registering = mode === 'register';
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const callbackRef = useRef(onAuthenticated);
  const submittedRef = useRef(false);
  callbackRef.current = onAuthenticated;
  useEffect(() => {
    const controller = new AbortController();
    api('/api/auth/session', { signal: controller.signal }).then(session => {
      if (!controller.signal.aborted && ['owner', 'staff'].includes(session.user?.role)) callbackRef.current(session);
    }).catch(() => {}).finally(() => { if (!controller.signal.aborted) setCheckingSession(false); });
    return () => controller.abort();
  }, []);
  async function submit(event) {
    event.preventDefault();
    if (submittedRef.current || checkingSession) return;
    setError('');
    if (!username.trim()) { setError('نام کاربری را وارد کنید.'); return; }
    if (registering && password !== confirmation) { setError('رمز عبور و تکرار آن یکسان نیستند.'); return; }
    submittedRef.current = true; setBusy(true);
    try {
      const session = await api(`/api/auth/${registering ? 'register' : 'login'}`, { method: 'POST', body: { username: username.trim(), password } });
      if (!['owner', 'staff'].includes(session.user?.role)) throw new Error('این حساب دسترسی حسابداری ندارد.');
      setPassword(''); setConfirmation(''); callbackRef.current(session);
    } catch (cause) { setError(cause.message); }
    finally { submittedRef.current = false; setBusy(false); }
  }
  return <div className="accounting-site accounting-auth-page" dir="rtl"><header className="accounting-auth-header accounting-container"><Brand/><a href="/" className="accounting-secondary-link">صفحهٔ اصلی <ArrowLeft size={16}/></a></header>
    <main className="accounting-auth-layout accounting-container"><section className="accounting-auth-copy"><p className="accounting-eyebrow"><span/> حسابداری زرنگار</p><h1>{registering ? <>یک حساب جدید،<br/><em>یک شروع مرتب.</em></> : <>خوش برگشتید،<br/><em>دفترتان آماده است.</em></>}</h1><p>{registering ? 'حساب بسازید و حسابداری کسب‌وکارتان را در فضای اختصاصی خود شروع کنید.' : 'با نام کاربری و رمز عبور وارد شوید و کارهای روزمرهٔ حسابداری را ادامه دهید.'}</p><div className="accounting-auth-points"><span><LockKeyhole size={20}/> دفتر مستقل و اطلاعات خصوصی</span><span><ReceiptText size={20}/> اسناد، مشتریان و موجودی در کنار هم</span><span><Users size={20}/> دسترسی مشخص برای همکاران</span></div></section>
      <section className="accounting-auth-card" aria-labelledby="auth-title"><span className="accounting-auth-icon"><BookOpen size={26}/></span><h2 id="auth-title">{registering ? 'ساخت حساب حسابداری' : 'ورود به حسابداری'}</h2><p>{registering ? 'اطلاعات ورود به دفتر خودتان را انتخاب کنید.' : 'برای ادامه، وارد حساب خود شوید.'}</p><form onSubmit={submit} aria-busy={busy || checkingSession}>
        <label htmlFor="account-username">نام کاربری</label><input id="account-username" name="username" autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} maxLength={200} disabled={busy} required spellCheck={false} placeholder="نام کاربری شما"/>
        <label htmlFor="account-password">رمز عبور</label><div className="accounting-password-field"><input id="account-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete={registering ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} minLength={registering ? 8 : 1} maxLength={256} disabled={busy} required aria-describedby={registering ? 'password-hint' : undefined}/><button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'پنهان‌کردن رمز عبور' : 'نمایش رمز عبور'} aria-pressed={showPassword}>{showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div>
        {registering && <><small id="password-hint" className="accounting-input-hint">حداقل ۸ نویسه؛ رمز مخصوص این حساب را انتخاب کنید.</small><label htmlFor="account-password-confirmation">تکرار رمز عبور</label><input id="account-password-confirmation" name="passwordConfirmation" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} minLength={8} maxLength={256} disabled={busy} required/></>}
        {error && <p className="accounting-auth-error" role="alert">{error}</p>}
        <button className="accounting-button accounting-button-dark accounting-submit" type="submit" disabled={busy || checkingSession}>{checkingSession ? 'در حال بررسی نشست…' : busy ? (registering ? 'در حال ساخت حساب…' : 'در حال ورود…') : (registering ? 'ساخت حساب و ورود به دفتر' : 'ورود به دفتر من')}<ArrowLeft size={17}/></button>
      </form><p className="accounting-auth-switch">{registering ? 'حساب دارید؟' : 'هنوز حساب ندارید؟'} <a href={registering ? '/login' : '/register'}>{registering ? 'وارد شوید' : 'حساب بسازید'} <ChevronLeft size={15}/></a></p><p className="accounting-auth-footnote"><ShieldCheck size={15}/>{registering ? 'پس از ثبت‌نام، دفتر اختصاصی شما ساخته می‌شود.' : 'همکاران هم با حسابی که مالک ساخته وارد می‌شوند.'}</p></section>
    </main><footer className="accounting-auth-footer">زرنگار · حسابداری آنلاین طلا و جواهر</footer></div>;
}
