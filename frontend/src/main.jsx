import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, BarChart3, Bell, Calculator, ChevronLeft, CircleDollarSign, Coins, FileText, Gem, Menu, Plus, ReceiptText, Search, ShieldCheck, Sparkles, TrendingUp, UserRound, Users, Wallet, X, Zap } from 'lucide-react';
import './styles.css';
import './ledger.css';
import SalesDashboard from './SalesDashboard';
import CustomerCRM from './CustomerCRM';
import ChequeManager, { ChequeAlerts } from './ChequeManager';
import { getChequeReminders } from './checks';
import PersianDateInput from './PersianDateInput';
import { formatRecordDate, newRecordTimestamp } from './recordTime';
import { isTradeDocument, tradeGoldPriceSummary } from './tradeGoldPrice';
import { expenseRateSummary, expenseSummary, expenseUnitLabel, expenseUnits, expenseValue, normalizeExpense } from './expenses';
import { validateDocument } from './documentValidation';
import InventoryVault from './InventoryVault';
import JewelrySetEditor, { SetModePicker } from './JewelrySetEditor';
import { createSetPart, expandSetForm, isJewelrySetKind, isSeparateSetForm, validateSetForm } from './jewelrySets';
import { assignProductCodes, inventoryReport, isStockSale, linkHistoricalSale, normalizeProductCode, saveLedgerRecords, stockIdentityFields, stockQuantity, stockSaleForm, validateStockSale, validateStockSales } from './inventory';
import { iranDate } from './sales';
import { assetReport, coinCatalog, currencyCatalog, currencyName, currencyRate, documentBreakdown, marketPriceFields, quantity } from './assets';
import { craftedKinds } from './crmAnalytics';
import { birthdayReminders, toolSections, workspaceSections } from './workspace';
import { HomePage, ToolHub, CustomerReports, ProfitPage, RatesPage, ChequeReportPage, entryTools, reportTools } from './WorkspacePages';
import { LayoutDashboard, LogOut, PackageOpen } from 'lucide-react';

const stats = [
  { label: 'ارزش موجودی طلا', value: '۱۲٬۸۴۰٬۵۰۰٬۰۰۰', unit: 'تومان', tone: 'gold' },
  { label: 'سود این ماه', value: '۳۴۸٬۲۰۰٬۰۰۰', unit: 'تومان', tone: 'mint' },
  { label: 'تراکنش‌های امروز', value: '۲۴۸', unit: 'مورد', tone: 'blue' },
];

const ACCOUNTS_KEY = 'zarngarAccounts';
const SESSION_KEY = 'zarngarCurrentUser';
const DOCUMENTS_KEY = 'zarngarDocuments';
const CUSTOMERS_KEY = 'zarngarCustomers';
const PRICES_KEY = 'zarngarPrices';
const OPENING_SETUP_KEY = 'zarngarOpeningSetup';
const GOLD_PURCHASES_KEY = 'zarngarGoldPurchases';
const CHEQUES_KEY = 'zarngarCheques';

const documentTypes = [
  { value: 'crafted-sale', label: 'فروش کار ساخته', category: 'crafted', direction: 'فروش' },
  { value: 'crafted-purchase', label: 'خرید کار ساخته', category: 'crafted', direction: 'خرید' },
  { value: 'coin-sale', label: 'فروش سکه', category: 'coin', direction: 'فروش' },
  { value: 'coin-purchase', label: 'خرید سکه', category: 'coin', direction: 'خرید' },
  { value: 'melted-sale', label: 'فروش آبشده', category: 'melted', direction: 'فروش' },
  { value: 'melted-purchase', label: 'خرید آبشده', category: 'melted', direction: 'خرید' },
  { value: 'currency-sale', label: 'فروش ارز', category: 'currency', direction: 'فروش' },
  { value: 'currency-purchase', label: 'خرید ارز', category: 'currency', direction: 'خرید' },
  { value: 'expense', label: 'هزینه فروشگاه', category: 'expense', direction: 'هزینه' },
];

const coinTypes = coinCatalog.map(coin => coin.name);
const coinPriceFields = Object.fromEntries(coinCatalog.map(coin => [coin.name, coin.price]));

const openingCategoryMeta = {
  currency: { label: 'ارز', typeLabel: 'موجودی اولیه ارز', Icon: CircleDollarSign },
  crafted: { label: 'کار ساخته', typeLabel: 'موجودی اولیه کار ساخته', Icon: Gem },
  coin: { label: 'سکه', typeLabel: 'موجودی اولیه سکه', Icon: Coins },
  melted: { label: 'آبشده', typeLabel: 'موجودی اولیه آبشده', Icon: FileText },
};

const digitMap = {
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};

function createEmptyDocumentForm(type = 'crafted-sale') {
  return {
    type,
    date: iranDate(),
    customerName: '',
    customerId: '',
    description: '',
    itemName: '',
    craftedKind: '',
    setMode: 'together',
    setParts: [],
    productCode: '',
    inventorySourceId: '',
    itemCount: '1',
    weight: '',
    gramPrice: '',
    gold18Price: null,
    ayar: '750',
    wagePercent: '',
    profitPercent: type.endsWith('-sale') ? '7' : '0',
    discountRial: '',
    coinType: 'امامی بانکی ۸۶',
    currencyType: 'USD',
    currencyRate: '',
    currencyAmount: '',
    wageFixed: '',
    otherCosts: '',
    expenseAmount: '',
    expensePayee: '',
    expenseUnit: 'toman',
    expenseCurrency: 'USD',
    expenseGoldPurity: '750',
    expenseRate: '',
    coinCount: '1',
    coinPrice: '',
    parsianWeight: '',
    parsianPrice: '',
    meltedWeight: '',
    meltedGramPrice: '',
    meltedAyar: '750',
    assayCode: '',
    laboratoryName: '',
    gramDebt: '',
    rialDebt: '',
    note: '',
  };
}

function createDefaultPriceForm() {
  return Object.fromEntries(marketPriceFields.map(([field]) => [field, '']));
}

function createOpeningInventoryItem(category) {
  return {
    id: `opening-item-${category}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    category,
    craftedKind: '',
    setMode: 'together',
    setParts: [],
    description: '',
    itemCount: '',
    weight: '',
    ayar: '750',
    wagePercent: '',
    profitPercent: '0',
    discountRial: '',
    coinType: 'امامی بانکی ۸۶',
    currencyType: 'USD',
    currencyRate: '',
    currencyAmount: '',
    wageFixed: '',
    otherCosts: '',
    coinCount: '',
    coinPrice: '',
    parsianWeight: '',
    parsianPrice: '',
    meltedWeight: '',
    meltedAyar: '750',
    assayCode: '',
    laboratoryName: '',
    note: '',
  };
}

function userStorageKey(baseKey, username) {
  return `${baseKey}:${username || 'guest'}`;
}

function loadUserRecords(baseKey, username) {
  try {
    return JSON.parse(localStorage.getItem(userStorageKey(baseKey, username))) || [];
  } catch {
    return [];
  }
}

function saveUserRecords(baseKey, username, records) {
  localStorage.setItem(userStorageKey(baseKey, username), JSON.stringify(records));
}

function loadUserObject(baseKey, username, fallback) {
  try {
    return { ...fallback, ...(JSON.parse(localStorage.getItem(userStorageKey(baseKey, username))) || {}) };
  } catch {
    return fallback;
  }
}

function saveUserObject(baseKey, username, record) {
  localStorage.setItem(userStorageKey(baseKey, username), JSON.stringify(record));
}

function loadOpeningSetup(username) {
  return Boolean(loadUserObject(OPENING_SETUP_KEY, username, { completed: false }).completed);
}

function saveOpeningSetup(username, payload = {}) {
  saveUserObject(OPENING_SETUP_KEY, username, {
    completed: true,
    completedAt: new Date().toISOString(),
    ...payload,
  });
}

function getDocumentType(value) {
  return documentTypes.find(type => type.value === value) || documentTypes[0];
}

function normalizeNumberInput(value) {
  return String(value ?? '').replace(/[۰-۹٠-٩]/g, character => digitMap[character] || character).replace(/٬/g, ',').replace(/٫/g, '.');
}

function toNumber(value) {
  const cleanValue = normalizeNumberInput(value).replace(/,/g, '').replace(/\s/g, '');
  const parsed = Number(cleanValue);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatNumber(value) {
  return new Intl.NumberFormat('fa-IR').format(Math.round(Number(value) || 0));
}

function formatDecimal(value) {
  return new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 3 }).format(Number(value) || 0);
}

const getDocumentQuantity = quantity;

function isSaleDocument(document) {
  return String(document.type || '').endsWith('-sale') || document.direction === 'فروش';
}

function getMeltedWeight750(document) {
  const scaleWeight = toNumber(document.meltedWeight);
  const ayar = toNumber(document.meltedAyar || 750) || 750;
  return scaleWeight * ayar / 750;
}

const getDocumentAmount = document => document.amount != null ? toNumber(document.amount) : document.type === 'expense' ? expenseValue(document) : documentBreakdown(document).total;

function getCoinPrice(coinType, prices) {
  const priceKey = coinPriceFields[coinType];
  return priceKey ? toNumber(prices[priceKey]) : 0;
}

const getLiveDocumentAmount = (document, prices) => document.type === 'expense' ? getDocumentAmount(document) : documentBreakdown(document, prices).total;

function getDocumentWeight(document) {
  if (document.category === 'crafted') return getDocumentQuantity(document) * toNumber(document.weight);
  if (document.category === 'coin' && document.coinType === 'پارسیان') return getDocumentQuantity(document) * toNumber(document.parsianWeight);
  if (document.category === 'melted') return getDocumentQuantity(document) * getMeltedWeight750(document);
  return 0;
}

function describeDocumentItem(document) {
  if (document.type === 'expense') return document.description || 'هزینه فروشگاه';
  const quantity = getDocumentQuantity(document);
  if (document.category === 'currency') return `${currencyName(document.currencyType)}، مقدار ${formatDecimal(quantity)}، نرخ ثبت ${formatNumber(toNumber(document.currencyRate))} تومان`;

  if (document.category === 'crafted') {
    const weightText = quantity > 1 ? `${formatDecimal(quantity)} عدد، هر عدد ${formatDecimal(document.weight)} گرم` : `${formatDecimal(document.weight)} گرم`;
    const membership = document.setMode === 'separate' && document.setId ? ` · قطعه‌ای از ${document.setName || document.setKind}` : isJewelrySetKind(document.craftedKind) ? ` · ${document.craftedKind} با هم` : '';
    return `${weightText}، عیار ${document.ayar || '-'}، اجرت ${document.wagePercent || 0}٪${membership}`;
  }

  if (document.category === 'coin') {
    if (document.coinType === 'پارسیان') return `سکه پارسیان، ${formatDecimal(quantity)} عدد، هر عدد ${formatDecimal(document.parsianWeight)} گرم`;
    return `${document.coinType}، ${formatDecimal(document.coinCount || 1)} عدد`;
  }

  if (document.category === 'melted') {
    const weightText = quantity > 1 ? `${formatDecimal(quantity)} قطعه، هر قطعه ${formatDecimal(document.meltedWeight)} گرم ترازو` : `${formatDecimal(document.meltedWeight)} گرم ترازو`;
    return `${weightText}، معادل ۷۵۰: ${formatDecimal(getMeltedWeight750(document))} گرم، عیار ${document.meltedAyar || 750}، انگ ${document.assayCode || '-'}، آزمایشگاه ${String(document.laboratoryName || '').trim() || '-'}`;
  }

  return '-';
}

function isOpeningItemBlank(item) {
  if (item.category === 'crafted' && isJewelrySetKind(item.craftedKind)) return false;
  if ([item.wageFixed, item.wagePercent, item.otherCosts].some(value => String(value || '').trim()) || toNumber(item.profitPercent)) return false;
  if (item.category === 'currency') return ![item.currencyAmount, item.currencyRate, item.description, item.note].some(value => String(value || '').trim());
  if (item.category === 'crafted') {
    return !String(item.description || '').trim() && !toNumber(item.itemCount) && !toNumber(item.weight) && !String(item.note || '').trim();
  }

  if (item.category === 'coin') {
    return !toNumber(item.coinCount) && !toNumber(item.parsianWeight) && !toNumber(item.parsianPrice) && !String(item.note || '').trim();
  }

  if (item.category === 'melted') {
    return !toNumber(item.itemCount) && !toNumber(item.meltedWeight) && !String(item.assayCode || '').trim() && !String(item.laboratoryName || '').trim() && !String(item.note || '').trim();
  }

  return true;
}

function validateOpeningItem(item, prices) {
  const form = { ...item, type: 'opening-' + item.category, customerName: 'موجودی اولیه', date: iranDate(), gramPrice: prices.goldGramPrice, meltedGramPrice: prices.goldGramPrice, coinPrice: String(getCoinPrice(item.coinType, prices)), currencyRate: item.currencyRate || String(currencyRate(item.currencyType, prices) || ''), wagePercent: item.wagePercent || '0' };
  if (isSeparateSetForm(form)) return Object.values(validateSetForm(form))[0] || '';
  const errors = validateDocument(form, item.category, toNumber);
  const count = stockQuantity(form);
  if (item.category !== 'currency' && (!Number.isSafeInteger(count) || count <= 0)) return 'تعداد جنس باید عدد صحیح بیشتر از صفر باشد.';
  return Object.values(errors)[0] || '';
}

function createOpeningDocumentFromItem(item, prices, index) {
  const createdAt = newRecordTimestamp();
  const date = iranDate();
  const meta = openingCategoryMeta[item.category];
  const baseRecord = {
    id: `document-opening-${crypto.randomUUID()}`,
    type: `opening-${item.category}`,
    typeLabel: meta.typeLabel,
    category: item.category,
    direction: 'موجودی اولیه',
    customerName: 'موجودی اولیه',
    date,
    description: String(item.description || '').trim() || meta.typeLabel,
    note: String(item.note || '').trim(),
    gramDebt: 0,
    rialDebt: 0,
    source: 'opening-inventory',
    createdAt,
    recordedAt: createdAt,
    itemName: item.itemName || '',
    ...Object.fromEntries(['setId', 'setName', 'setKind', 'setMode', 'setPieceCount', 'transactionId'].filter(key => item[key] != null).map(key => [key, item[key]])),
    wagePercent: item.wagePercent || '0', wageFixed: item.wageFixed || '0', otherCosts: item.otherCosts || '0', profitPercent: item.profitPercent || '0',
  };

  let documentRecord = baseRecord;
  if (item.category === 'currency') documentRecord = { ...baseRecord, currencyType: item.currencyType, currencyAmount: item.currencyAmount, currencyRate: item.currencyRate || String(currencyRate(item.currencyType, prices) || '') };

  if (item.category === 'crafted') {
    documentRecord = {
      ...baseRecord,
      itemCount: item.itemCount,
      weight: item.weight,
      gramPrice: item.gramPrice || prices.goldGramPrice,
      ayar: item.ayar,
      craftedKind: item.craftedKind || '',
      wagePercent: item.wagePercent || '0',
    };
  }

  if (item.category === 'coin') {
    documentRecord = {
      ...baseRecord,
      coinType: item.coinType,
      coinCount: item.coinCount,
      coinPrice: item.coinType === 'پارسیان' ? item.parsianPrice : String(getCoinPrice(item.coinType, prices) || item.coinPrice || ''),
      parsianWeight: item.parsianWeight,
      parsianPrice: item.parsianPrice,
    };
  }

  if (item.category === 'melted') {
    documentRecord = {
      ...baseRecord,
      itemCount: item.itemCount,
      meltedWeight: item.meltedWeight,
      meltedAyar: item.meltedAyar,
      meltedGramPrice: prices.goldGramPrice,
      assayCode: String(item.assayCode || '').trim(),
      laboratoryName: String(item.laboratoryName || '').trim(),
    };
  }

  return {
    ...documentRecord,
    amount: getDocumentAmount(documentRecord),
    currentAmount: getLiveDocumentAmount(documentRecord, prices),
    itemWeight: getDocumentWeight(documentRecord),
    itemSummary: describeDocumentItem(documentRecord),
  };
}

function createOpeningDocumentsFromItem(item, prices) {
  const form = { ...item, type: `opening-${item.category}`, gramPrice: item.gramPrice || prices.goldGramPrice };
  return expandSetForm(form, { setId: item.id, transactionId: `opening-${item.id}` }).map(row => createOpeningDocumentFromItem(row, prices));
}

function loadAccounts() {
  try {
    return JSON.parse(localStorage.getItem(ACCOUNTS_KEY)) || [];
  } catch {
    return [];
  }
}

function saveAccounts(accounts) {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

function loadCurrentUser() {
  try {
    return localStorage.getItem(SESSION_KEY) || '';
  } catch {
    return '';
  }
}

function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState(loadCurrentUser);
  const [activePage, setActivePage] = useState(() => loadCurrentUser() ? 'account' : 'home');
  const [authMessage, setAuthMessage] = useState('');

  const openLogin = () => {
    setMenuOpen(false);
    setAuthMessage('');
    setActivePage('login');
  };

  const openSignup = () => {
    setMenuOpen(false);
    setAuthMessage('');
    setActivePage('signup');
  };

  const openAccount = () => {
    setMenuOpen(false);
    setActivePage('account');
  };

  const showHome = () => {
    setMenuOpen(false);
    setActivePage('home');
  };

  const createAccount = ({ username, password }) => {
    const cleanUsername = username.trim();

    if (!cleanUsername || !password) return 'نام کاربری و رمز عبور را کامل وارد کنید.';
    if (password.length < 4) return 'رمز عبور باید حداقل ۴ کاراکتر باشد.';

    const accounts = loadAccounts();
    const usernameExists = accounts.some(account => account.username === cleanUsername);

    if (usernameExists) return 'این نام کاربری قبلاً ساخته شده است.';

    saveAccounts([...accounts, { username: cleanUsername, password }]);
    saveUserObject(OPENING_SETUP_KEY, cleanUsername, { completed: false });
    setAuthMessage('حساب ساخته شد. حالا با نام کاربری و رمز عبور وارد شوید.');
    setActivePage('login');
    return '';
  };

  const login = ({ username, password }) => {
    setAuthMessage('');
    const cleanUsername = username.trim();
    const account = loadAccounts().find(item => item.username === cleanUsername && item.password === password);

    if (!account) return 'نام کاربری یا رمز عبور درست نیست.';

    localStorage.setItem(SESSION_KEY, account.username);
    setCurrentUser(account.username);
    setActivePage('account');
    return '';
  };

  const logout = () => {
    localStorage.removeItem(SESSION_KEY);
    setCurrentUser('');
    setActivePage('home');
  };

  const renderAccountActions = () => currentUser ? <>
    <button className="button button-dark" onClick={openAccount}>حساب من</button>
    <button className="button button-ghost" onClick={logout}>خروج</button>
  </> : <>
    <button className="button button-dark" onClick={openSignup}>ثبت نام <ArrowLeft size={16}/></button>
    <button className="button button-ghost" onClick={openLogin}>ورود</button>
  </>;

  return <div className={`site-shell ${activePage === 'account' ? 'account-shell' : ''}`}>
    <header className="nav-wrap">
      <nav className="nav container">
        <a className="brand" href="#top" aria-label="زرنگار" onClick={showHome}><span className="brand-mark">ز</span><span>زرنگار</span></a>
        <div className={`nav-links ${menuOpen ? 'open' : ''}`}>
          <a href="#features" onClick={showHome}>امکانات</a>
          <a href="#how" onClick={showHome}>چطور کار می‌کند؟</a>
          <a href="#security" onClick={showHome}>امنیت</a>
          <a href="#pricing" onClick={showHome}>تعرفه‌ها</a>
          <div className="mobile-actions">{renderAccountActions()}</div>
        </div>
        <div className="nav-actions">{renderAccountActions()}</div>
        <button className="menu-toggle" onClick={() => setMenuOpen(!menuOpen)} aria-label="باز کردن منو">{menuOpen ? <X/> : <Menu/>}</button>
      </nav>
    </header>

    <main id="top">
      {activePage === 'login' ? <LoginPage onBack={showHome} onLogin={login} onSignup={openSignup} message={authMessage} /> : activePage === 'signup' ? <SignupPage onBack={showHome} onSignup={createAccount} onLogin={openLogin} /> : activePage === 'account' ? <AccountPage username={currentUser} onLogout={logout} /> : <>
      <section className="hero container">
        <div className="hero-copy">
          <div className="eyebrow"><Sparkles size={15}/> حسابداری مخصوص بازار طلا</div>
          <h1>حسابداری طلافروشی، <em>دقیق و درخشان.</em></h1>
          <p className="hero-lead">زرنگار، نرم‌افزار تخصصی فروشندگان طلا برای مدیریت موجودی، خرید و فروش، سود و زیان و حساب مشتریان است؛ ساده، دقیق و همیشه در دسترس.</p>
          <div className="hero-actions"><button className="button button-primary" onClick={openSignup}>ثبت نام <ArrowLeft size={18}/></button><button className="button button-ghost" onClick={openLogin}>ورود</button></div>
          <div className="trust-row"><div className="avatars"><span>م</span><span>ع</span><span>ک</span><span>+</span></div><span>مورد اعتماد بیش از <strong>۲٬۰۰۰</strong> فروشنده طلا</span></div>
        </div>
        <div className="dashboard-stage" aria-label="پیش‌نمایش داشبورد زرنگار">
          <div className="glow"></div><div className="dashboard-card">
            <div className="dash-top"><div><span className="muted">شنبه، ۲۳ تیر ۱۴۰۳</span><h3>سلام، آقای احمدی <span>✦</span></h3></div><div className="profile">م</div></div>
            <div className="balance-card"><div className="balance-heading"><span>ارزش کل دارایی</span><span className="live"><i></i> بروز</span></div><strong>۱۲٬۸۴۰٬۵۰۰٬۰۰۰ <small>تومان</small></strong><div className="balance-foot"><span>+ ۲.۴٪ امروز</span><span>در مقایسه با دیروز</span></div></div>
            <div className="mini-stats"><div><span>وزن خالص موجودی</span><b>۴۸۲.۷ <small>گرم</small></b></div><div><span>سود این ماه</span><b className="green">+۳۴۸.۲ <small>میلیون</small></b></div></div>
            <div className="chart-title"><span>روند ارزش موجودی</span><span className="period">این ماه⌄</span></div><div className="chart"><div className="grid-lines"><i></i><i></i><i></i></div><svg viewBox="0 0 420 105" preserveAspectRatio="none"><defs><linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#d3a848" stopOpacity=".27"/><stop offset="1" stopColor="#d3a848" stopOpacity="0"/></linearGradient></defs><path d="M0 82 C35 74 44 79 70 68 S115 77 145 54 S180 66 210 45 S244 58 270 28 S302 55 332 33 S369 45 420 10 L420 105 L0 105Z" fill="url(#chartFill)"/><path d="M0 82 C35 74 44 79 70 68 S115 77 145 54 S180 66 210 45 S244 58 270 28 S302 55 332 33 S369 45 420 10" fill="none" stroke="#d3a848" strokeWidth="3"/></svg></div>
            <div className="dash-bottom"><span>۰۱ تیر</span><span>۱۰ تیر</span><span>۲۰ تیر</span><span>۳۰ تیر</span></div>
          </div>
        </div>
      </section>

      <section className="stats-strip container">{stats.map(s => <div className="stat" key={s.label}><span className={`stat-icon ${s.tone}`}>{s.tone === 'gold' ? <CircleDollarSign/> : s.tone === 'mint' ? <BarChart3/> : <Zap/>}</span><div><span>{s.label}</span><strong>{s.value} <small>{s.unit}</small></strong></div></div>)}</section>

      <section className="feature-section" id="features"><div className="container"><div className="section-heading"><span className="section-kicker">حسابداری تخصصی فروشندگان طلا</span><h2>همه‌چیز برای مدیریت <em>طلافروشی شما</em></h2><p>ابزارهایی که فروشنده طلا برای کنترل دقیق دخل، موجودی و حساب‌ها نیاز دارد.</p></div><div className="feature-grid"><Feature icon={<CircleDollarSign/>} title="مدیریت موجودی طلا" text="موجودی آبشده، مصنوعات و سنگ‌ها را با دقت گرم و عیار مدیریت کنید."/><Feature icon={<BarChart3/>} title="گزارش‌های هوشمند" text="سود و زیان، فروش روزانه و عملکرد طلافروشی‌تان را در یک نگاه ببینید."/><Feature icon={<ShieldCheck/>} title="امنیت حساب‌ها" text="اطلاعات مالی و حساب مشتریان شما با رمزنگاری و پشتیبان‌گیری خودکار محافظت می‌شود."/></div></div></section>

      <section className="how-section container" id="how"><div className="how-copy"><span className="section-kicker">شروعی به سادگی آب‌کردن طلا</span><h2>از دفترهای شلوغ تا <em>کنترل کامل</em></h2><p>در کمتر از چند دقیقه فروشگاهتان را به زرنگار بسپارید و وقتتان را برای مشتری‌ها و رشد کسب‌وکارتان نگه دارید.</p><div className="steps"><div><b>۱</b><span><strong>ثبت‌نام کنید</strong><small>حساب کاربری خود را بسازید.</small></span></div><div><b>۲</b><span><strong>اطلاعات را وارد کنید</strong><small>موجودی و محصولاتتان را اضافه کنید.</small></span></div><div><b>۳</b><span><strong>هوشمندانه مدیریت کنید</strong><small>گزارش بگیرید و تصمیم بگیرید.</small></span></div></div></div><div className="quote-card"><div className="quote-mark">“</div><p>زرنگار کمک کرد بالاخره بدانم دقیقاً چه چیزی در مغازه دارم و سود واقعی‌ام چقدر است.</p><div className="quote-author"><div className="profile gold-profile">ن</div><span><strong>نیما رضایی</strong><small>گالری طلای رضایی، تهران</small></span></div></div></section>
      </>}
    </main>

    <footer className="footer"><div className="container footer-inner"><div><a className="brand light" href="#top" onClick={showHome}><span className="brand-mark">ز</span><span>زرنگار</span></a><p>حسابداری دقیق برای کسب‌وکارهای درخشان.</p></div><span className="copyright">© ۱۴۰۳ زرنگار. تمامی حقوق محفوظ است.</span></div></footer>
  </div>
}

function LoginPage({ onBack, onLogin, onSignup, message }) {
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');

  const updateField = event => {
    setForm({ ...form, [event.target.name]: event.target.value });
    setError('');
  };

  const submitLogin = event => {
    event.preventDefault();
    setError(onLogin(form));
  };

  return <section className="login-page container">
    <div className="login-panel">
      <button className="back-link" onClick={onBack}><ChevronLeft size={16}/> بازگشت به صفحه اصلی</button>
      <span className="modal-icon login-icon"><UserRound/></span>
      <h1>ورود به حساب</h1>
      <p>نام کاربری و رمز عبور خود را وارد کنید.</p>
      {message && <div className="form-message success">{message}</div>}
      {error && <div className="form-message error">{error}</div>}
      <form className="login-form" onSubmit={submitLogin}>
        <label>نام کاربری<input type="text" name="username" placeholder="نام کاربری" autoComplete="username" value={form.username} onChange={updateField}/></label>
        <label>رمز عبور<input type="password" name="password" placeholder="رمز عبور" autoComplete="current-password" value={form.password} onChange={updateField}/></label>
        <button className="button button-primary full" type="submit">ورود <ArrowLeft size={17}/></button>
      </form>
      <p className="auth-switch">حساب ندارید؟ <button onClick={onSignup}>ثبت نام کنید</button></p>
    </div>
  </section>
}

function SignupPage({ onBack, onSignup, onLogin }) {
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');

  const updateField = event => {
    setForm({ ...form, [event.target.name]: event.target.value });
    setError('');
  };

  const submitSignup = event => {
    event.preventDefault();
    setError(onSignup(form));
  };

  return <section className="login-page container">
    <div className="login-panel">
      <button className="back-link" onClick={onBack}><ChevronLeft size={16}/> بازگشت به صفحه اصلی</button>
      <span className="modal-icon login-icon"><Sparkles/></span>
      <h1>ثبت نام</h1>
      <p>یک نام کاربری و رمز عبور بسازید.</p>
      {error && <div className="form-message error">{error}</div>}
      <form className="login-form" onSubmit={submitSignup}>
        <label>نام کاربری<input type="text" name="username" placeholder="نام کاربری" autoComplete="username" value={form.username} onChange={updateField}/></label>
        <label>رمز عبور<input type="password" name="password" placeholder="رمز عبور" autoComplete="new-password" value={form.password} onChange={updateField}/></label>
        <button className="button button-primary full" type="submit">ساخت اکانت <ArrowLeft size={17}/></button>
      </form>
      <p className="auth-switch">قبلاً حساب ساخته‌اید؟ <button onClick={onLogin}>ورود به حساب</button></p>
    </div>
  </section>
}

function OpeningInventoryPage({ username, prices, onComplete }) {
  const [openingPrices, setOpeningPrices] = useState(prices);
  useEffect(() => setOpeningPrices(prices), [prices]);
  const [items, setItems] = useState([
    createOpeningInventoryItem('crafted'),
    createOpeningInventoryItem('coin'),
    createOpeningInventoryItem('melted'),
    createOpeningInventoryItem('currency'),
  ]);
  const [message, setMessage] = useState(null);

  const filledItems = items.filter(item => !isOpeningItemBlank(item));
  const [openingErrors, setOpeningErrors] = useState({});
  const previewDocuments = filledItems.flatMap(item => createOpeningDocumentsFromItem(item, openingPrices));
  const previewValue = previewDocuments.reduce((sum, document) => sum + getLiveDocumentAmount(document, openingPrices), 0);

  const updatePriceField = event => {
    const { name, value } = event.target;
    setOpeningPrices(currentPrices => ({ ...currentPrices, [name]: value }));
    setMessage(null);
  };

  const updateItemField = (id, fieldName, fieldValue) => {
    setItems(currentItems => currentItems.map(item => item.id === id ? {
      ...item, [fieldName]: fieldValue,
      ...(fieldName === 'setMode' && fieldValue === 'separate' && !item.setParts.length ? { setParts: [createSetPart({ gramPrice: openingPrices.goldGramPrice }), createSetPart({ gramPrice: openingPrices.goldGramPrice })] } : {}),
    } : item));
    setOpeningErrors(current => ({ ...current, [id]: {} }));
    setMessage(null);
  };

  const addItem = category => {
    const item = createOpeningInventoryItem(category);
    setItems(currentItems => [...currentItems, item]);
    setMessage(null);
    requestAnimationFrame(() => document.querySelector(`[data-opening-item="${item.id}"] [data-opening-field="description"]`)?.focus());
  };

  const removeItem = id => {
    setItems(currentItems => currentItems.length > 1 ? currentItems.filter(item => item.id !== id) : currentItems);
    setMessage(null);
  };

  const submitOpeningInventory = event => {
    event.preventDefault();

    if (!filledItems.length) {
      setMessage({ type: 'error', text: 'حداقل یک دارایی اولیه ثبت کنید یا فعلاً بدون موجودی شروع کنید.' });
      return;
    }

    const partErrors = Object.fromEntries(filledItems.filter(isSeparateSetForm).map(item => [item.id, validateSetForm({ ...item, type: 'opening-crafted', date: iranDate(), gramPrice: openingPrices.goldGramPrice })]));
    setOpeningErrors(partErrors);
    const validationError = filledItems.map(item => validateOpeningItem(item, openingPrices)).find(Boolean);

    if (validationError) {
      setMessage({ type: 'error', text: validationError });
      return;
    }

    const openingDocuments = filledItems.flatMap(item => createOpeningDocumentsFromItem(item, openingPrices));
    try { onComplete({
      documents: openingDocuments,
      prices: openingPrices,
      totalValue: openingDocuments.reduce((sum, document) => sum + Number(document.currentAmount || 0), 0),
    }); } catch (error) { setMessage({ type: 'error', text: error.message || 'موجودی ذخیره نشد؛ دوباره تلاش کنید.' }); return; }
    setItems(['crafted', 'coin', 'melted', 'currency'].map(createOpeningInventoryItem));
    setOpeningErrors({});
    setMessage({ type: 'success', text: 'موجودی اولیه ثبت شد؛ کد هر جنس در «صندوق من» آماده است.' });
  };

  const renderOpeningRows = category => {
    const categoryItems = items.filter(item => item.category === category);
    const { Icon, label } = openingCategoryMeta[category];

    return <section className="opening-asset-section" key={category}>
      <div className="opening-section-head">
        <div>
          <span className="account-metric-icon gold"><Icon size={18}/></span>
          <strong>{label}</strong>
        </div>
      </div>

      <div className="opening-item-list">
        {categoryItems.map(item => <article className="opening-item-card" data-opening-item={item.id} data-opening-category={category} key={item.id}>
          <button className="opening-remove" type="button" onClick={() => removeItem(item.id)} aria-label="حذف ردیف"><X size={15}/></button>
          <div className="form-grid">
            <label className="wide">شرح دارایی<input data-opening-field="description" value={item.description} onChange={event => updateItemField(item.id, 'description', event.target.value)} placeholder={category === 'crafted' ? 'مثلاً النگو، زنجیر، نیم‌ست' : category === 'coin' ? 'مثلاً سکه امامی بانکی' : 'مثلاً آبشده ۷۵۰'}/></label>

            {category === 'crafted' && !isSeparateSetForm(item) && <>
              <label>تعداد<input inputMode="decimal" value={item.itemCount} onChange={event => updateItemField(item.id, 'itemCount', event.target.value)} placeholder="مثلاً ۱۰"/></label>
              <label>وزن هر عدد<input inputMode="decimal" value={item.weight} onChange={event => updateItemField(item.id, 'weight', event.target.value)} placeholder="گرم"/></label>
              <label>عیار<input inputMode="numeric" value={item.ayar} onChange={event => updateItemField(item.id, 'ayar', event.target.value)} placeholder="مثلاً 750"/></label>
              <label>اجرت درصدی<input inputMode="decimal" value={item.wagePercent} onChange={event => updateItemField(item.id, 'wagePercent', event.target.value)} placeholder="اختیاری"/></label>
              <label>نوع کار ساخته<select data-opening-field="craftedKind" value={item.craftedKind || ''} onChange={event => updateItemField(item.id, 'craftedKind', event.target.value)}><option value="">تشخیص از نام کالا</option>{craftedKinds.map(kind => <option key={kind}>{kind}</option>)}</select></label>
            </>}
            {category === 'crafted' && isSeparateSetForm(item) && <label>نوع مجموعه<select data-opening-field="craftedKind" value={item.craftedKind} onChange={event => updateItemField(item.id, 'craftedKind', event.target.value)}>{craftedKinds.map(kind => <option key={kind}>{kind}</option>)}</select></label>}
            {category === 'crafted' && isJewelrySetKind(item.craftedKind) && <div className="wide"><SetModePicker kind={item.craftedKind} value={item.setMode} onChange={value => updateItemField(item.id, 'setMode', value)}/></div>}
            {isSeparateSetForm(item) && <div className="wide"><JewelrySetEditor parts={item.setParts} onChange={parts => updateItemField(item.id, 'setParts', parts)} prices={openingPrices} errors={openingErrors[item.id]}/></div>}

            {category === 'coin' && <>
              <label>نوع سکه<select value={item.coinType} onChange={event => updateItemField(item.id, 'coinType', event.target.value)}>{coinTypes.map(type => <option key={type} value={type}>{type}</option>)}</select></label>
              <label>تعداد<input inputMode="decimal" value={item.coinCount} onChange={event => updateItemField(item.id, 'coinCount', event.target.value)} placeholder="مثلاً ۱۰"/></label>
              {item.coinType === 'پارسیان' && <>
                <label>وزن هر عدد پارسیان<input inputMode="decimal" value={item.parsianWeight} onChange={event => updateItemField(item.id, 'parsianWeight', event.target.value)} placeholder="گرم"/></label>
                <label>قیمت هر عدد پارسیان<input inputMode="numeric" value={item.parsianPrice} onChange={event => updateItemField(item.id, 'parsianPrice', event.target.value)} placeholder="تومان"/></label>
              </>}
            </>}

            {category === 'melted' && <>
              <label>تعداد قطعه<input inputMode="decimal" value={item.itemCount} onChange={event => updateItemField(item.id, 'itemCount', event.target.value)} placeholder="مثلاً ۳"/></label>
              <label>وزن ترازو هر قطعه<input inputMode="decimal" value={item.meltedWeight} onChange={event => updateItemField(item.id, 'meltedWeight', event.target.value)} placeholder="گرم"/></label>
              <label>عیار خریداری<input inputMode="numeric" value={item.meltedAyar} onChange={event => updateItemField(item.id, 'meltedAyar', event.target.value)} placeholder="مثلاً ۷۸۰"/></label>
              <label>گرم معادل ۷۵۰<input value={formatDecimal(getMeltedWeight750(item))} readOnly/></label>
              <label className="wide">شماره انگ آبشده<input value={item.assayCode} onChange={event => updateItemField(item.id, 'assayCode', event.target.value)} placeholder="شماره انگ"/></label>
              <label className="wide">نام آزمایشگاه<input value={item.laboratoryName || ''} onChange={event => updateItemField(item.id, 'laboratoryName', event.target.value)} placeholder="نام آزمایشگاه ری‌گیری"/></label>
            </>}

            {category === 'currency' && <>
              <label>نوع ارز<select value={item.currencyType} onChange={event => updateItemField(item.id, 'currencyType', event.target.value)}>{currencyCatalog.map(currency => <option key={currency.code} value={currency.code}>{currency.name} ({currency.code})</option>)}</select></label>
              <label>قیمت لحظه‌ای هر واحد ارز (تومان)<input inputMode="decimal" value={item.currencyRate || ''} onChange={event => updateItemField(item.id, 'currencyRate', event.target.value)} placeholder={String(currencyRate(item.currencyType, openingPrices) || 'تومان')}/></label>
              <label>مقدار ارز<input inputMode="decimal" value={item.currencyAmount} onChange={event => updateItemField(item.id, 'currencyAmount', event.target.value)} placeholder="مثلاً ۱۰۰۰"/></label>
            </>}
            {!isSeparateSetForm(item) && <>{category !== 'currency' && <>
              {category !== 'crafted' && <label>اجرت درصدی<input inputMode="decimal" value={item.wagePercent} onChange={event => updateItemField(item.id, 'wagePercent', event.target.value)} placeholder="اختیاری"/></label>}
              <label>اجرت ثابت هر عدد / قطعه (تومان)<input inputMode="decimal" value={item.wageFixed} onChange={event => updateItemField(item.id, 'wageFixed', event.target.value)} placeholder="اختیاری"/></label>
            </>}
            <label>هزینه‌های دیگر هر واحد (تومان)<input inputMode="decimal" value={item.otherCosts} onChange={event => updateItemField(item.id, 'otherCosts', event.target.value)} placeholder="اختیاری"/></label>
            <label>سود درصدی<input inputMode="decimal" value={item.profitPercent} onChange={event => updateItemField(item.id, 'profitPercent', event.target.value)} placeholder="اختیاری"/></label>
            </>}
            <label className="wide">یادداشت<input value={item.note} onChange={event => updateItemField(item.id, 'note', event.target.value)} placeholder="اختیاری"/></label>
          </div>
        </article>)}
      </div>
      <button className="button button-ghost opening-add-item" type="button" data-add-opening-item={category} onClick={() => addItem(category)}><Plus size={16}/> افزودن {label}</button>
    </section>;
  };

  return <section className="opening-page workspace-opening">
    <form className="opening-shell" onSubmit={submitOpeningInventory}>
      <div className="opening-welcome">
        <span className="modal-icon login-icon"><Sparkles/></span>
        <div>
          <span className="section-kicker">شروع حسابداری</span>
          <h1>خوش آمدی، {username}</h1>
          <p>موجودی اولیه فروشگاه را ثبت کنید تا ارزش کل دارایی با نرخ امروز محاسبه شود.</p>
        </div>
      </div>

      <div className="opening-grid">
        <div className="opening-assets-panel">
          {['crafted', 'coin', 'melted', 'currency'].map(renderOpeningRows)}
        </div>

        <aside className="opening-rate-panel">
          <div className="panel-heading compact">
            <span>نرخ امروز</span>
            <b><i></i> مبنای محاسبه</b>
          </div>
          <div className="form-grid">
            {marketPriceFields.map(([field, label]) => <label className="wide" key={field}>{label}<input name={field} inputMode="decimal" value={openingPrices[field] || ''} onChange={updatePriceField} placeholder="تومان"/></label>)}
            <p className="document-required-note">نرخ هر واحد به تومان؛ فقط نرخ دارایی‌های خود را وارد کنید.</p>
          </div>
        </aside>
      </div>

      <div className="opening-actions">
        <div className="opening-total">
          <span>ارزش فعلی موجودی اولیه</span>
          <strong>{formatNumber(previewValue)} <small>تومان</small></strong>
          <small>{formatNumber(previewDocuments.length)} ردیف جنس آماده ثبت</small>
        </div>
        {message && <div className={`form-message ${message.type}`} role={message.type === 'error' ? 'alert' : 'status'}>{message.text}</div>}
        <button className="button button-primary" type="submit"><ReceiptText size={17}/> ثبت موجودی اولیه</button>
      </div>
    </form>
  </section>
}

function AccountPage({ username, onLogout }) {
  const [documents, setDocuments] = useState(() => assignProductCodes(loadUserRecords(DOCUMENTS_KEY, username)));
  const [stockQuery, setStockQuery] = useState('');
  const [storageMessage, setStorageMessage] = useState('');
  const [cheques, setCheques] = useState(() => loadUserRecords(CHEQUES_KEY, username));
  const [selectedChequeId, setSelectedChequeId] = useState('');
  const [today, setToday] = useState(iranDate);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const navigationRef = useRef(null);
  const menuButtonRef = useRef(null);
  const [goldPurchases, setGoldPurchases] = useState(() => loadUserRecords(GOLD_PURCHASES_KEY, username));
  const [customers, setCustomers] = useState(() => loadUserRecords(CUSTOMERS_KEY, username));
  const [priceForm, setPriceForm] = useState(() => loadUserObject(PRICES_KEY, username, createDefaultPriceForm()));
  const [savedPrices, setSavedPrices] = useState(priceForm);
  const [activeTool, setActiveTool] = useState('home');
  const [selectedCrmId, setSelectedCrmId] = useState('');
  const notificationsRef = useRef(null);
  const activeSection = toolSections[activeTool] || 'home';
  const [documentForm, setDocumentForm] = useState(() => ({ ...createEmptyDocumentForm(), gramPrice: priceForm.goldGramPrice }));
  const [searchTerm, setSearchTerm] = useState('');
  const [formMessage, setFormMessage] = useState(null);
  const [documentErrors, setDocumentErrors] = useState({});
  const [priceMessage, setPriceMessage] = useState(null);

  useEffect(() => {
    const dismiss = event => {
      if (event.type === 'keydown' ? event.key === 'Escape' : !notificationsRef.current?.contains(event.target)) {
        if (notificationsRef.current) notificationsRef.current.open = false;
      }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', dismiss);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', dismiss); };
  }, []);

  useEffect(() => {
    try {
      const stored = loadUserRecords(DOCUMENTS_KEY, username);
      const coded = assignProductCodes(stored);
      if (JSON.stringify(coded) !== JSON.stringify(stored)) saveUserRecords(DOCUMENTS_KEY, username, coded);
      setDocuments(coded);
    } catch { setStorageMessage('کدهای موجودی ذخیره نشدند؛ فضای ذخیره‌سازی مرورگر را بررسی کنید.'); }
    const refresh = event => {
      if (event.key === userStorageKey(DOCUMENTS_KEY, username)) setDocuments(assignProductCodes(loadUserRecords(DOCUMENTS_KEY, username)));
      if (event.key === userStorageKey(CUSTOMERS_KEY, username)) setCustomers(loadUserRecords(CUSTOMERS_KEY, username));
    };
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, [username]);

  useEffect(() => {
    const refresh = () => setToday(iranDate());
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const resize = () => { setIsMobile(media.matches); if (!media.matches) setMenuOpen(false); };
    media.addEventListener('change', resize);
    return () => media.removeEventListener('change', resize);
  }, []);

  useEffect(() => {
    if (!menuOpen || !isMobile) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () => [...navigationRef.current.querySelectorAll('button:not([disabled]), a[href]')].filter(element => element.getClientRects().length);
    const focusTimer = window.setTimeout(() => focusable()[0]?.focus(), 220);
    const keydown = event => {
      if (event.key === 'Escape') { setMenuOpen(false); return; }
      if (event.key !== 'Tab') return;
      const targets = focusable();
      const first = targets[0]; const last = targets[targets.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { window.clearTimeout(focusTimer); document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', keydown); menuButtonRef.current?.focus(); };
  }, [menuOpen, isMobile]);

  const openTool = tool => {
    if (tool === 'expense') {
      setDocumentForm(createEmptyDocumentForm('expense'));
      setStockQuery(''); setDocumentErrors({}); setFormMessage(null);
    }
    setActiveTool(tool === 'expense' ? 'register' : tool); setMenuOpen(false); setSelectedChequeId('');
    if (tool !== 'crm') setSelectedCrmId('');
    if (notificationsRef.current) notificationsRef.current.open = false;
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  const openCustomer = id => { openTool('crm'); setSelectedCrmId(id); };
  const openCheque = cheque => { openTool('cheques'); setSelectedChequeId(cheque?.id || ''); };
  const chequeReminders = getChequeReminders(cheques, today);
  const birthdays = birthdayReminders(customers, today);
  const toolTitle = [...entryTools, ...reportTools].find(([key]) => key === activeTool)?.[1] || workspaceSections[activeSection];

  const selectedDocumentType = getDocumentType(documentForm.type);
  const stock = inventoryReport(documents);
  const selectedStock = stock.items.find(item => item.id === documentForm.inventorySourceId);
  const saleMode = isStockSale(documentForm);
  const expenseMode = documentForm.type === 'expense';
  const separateSetMode = selectedDocumentType.category === 'crafted' && isSeparateSetForm(documentForm);
  const stockMatches = stock.available.filter(item => normalizeProductCode([item.productCode, item.itemName, item.description, item.setName, item.setKind, item.assayCode, item.coinType, item.currencyType, currencyName(item.currencyType)].join(' ')).includes(normalizeProductCode(stockQuery))).slice(0, 8);
  const documentPreview = { ...documentForm, category: selectedDocumentType.category, ...(separateSetMode ? { gramPrice: savedPrices.goldGramPrice } : {}) };
  const previewRows = expandSetForm(documentPreview);
  const previewAmount = previewRows.reduce((sum, row) => sum + getDocumentAmount(row), 0);
  const latestDocuments = documents.slice(0, 5);
  const assets = assetReport(stock, savedPrices);
  const liveInventoryValue = assetReport(stock, priceForm).totalToman;
  const normalizedSearch = searchTerm.trim().toLocaleLowerCase('fa-IR');
  const filteredDocuments = documents.filter(document => {
    if (!normalizedSearch) return true;
    return [
      document.customerName,
      document.expensePayee,
      document.expenseCurrency,
      document.type === 'expense' ? expenseSummary(document) : '',
      document.typeLabel,
      document.direction,
      document.itemSummary,
      document.coinType,
      document.currencyType,
      currencyName(document.currencyType),
      document.assayCode,
      document.laboratoryName,
      document.note,
      document.description,
      document.itemName,
      document.setName,
      document.setKind,
      document.productCode,
    ].some(value => String(value || '').toLocaleLowerCase('fa-IR').includes(normalizedSearch));
  });

  const persistDocuments = nextDocuments => {
    const coded = assignProductCodes(nextDocuments);
    saveUserRecords(DOCUMENTS_KEY, username, coded);
    setDocuments(coded);
    return coded;
  };

  const currentDocuments = () => {
    const stored = assignProductCodes(loadUserRecords(DOCUMENTS_KEY, username));
    if (JSON.stringify(stored) !== JSON.stringify(documents)) {
      setDocuments(stored);
      throw new Error('اسناد در صفحهٔ دیگری تغییر کرده‌اند؛ موجودی تازه شد. دوباره ثبت کنید.');
    }
    return stored;
  };

  const chooseStock = item => {
    setDocumentForm(current => stockSaleForm(item, current, savedPrices));
    setStockQuery(item.productCode);
    setDocumentErrors({}); setFormMessage(null);
  };
  const sellStock = item => { chooseStock(item); openTool('register'); };
  const chooseSet = items => {
    const available = items.filter(item => item.remaining > 0);
    if (!available.length) return;
    const first = available[0];
    setDocumentForm(current => ({
      ...createEmptyDocumentForm('crafted-sale'), customerId: current.customerId, customerName: current.customerName, date: current.date,
      gold18Price: current.gold18Price, gramDebt: current.gramDebt, rialDebt: current.rialDebt, note: current.note, description: current.description,
      craftedKind: first.setKind, itemName: first.setName || first.setKind, setMode: 'separate', setId: first.setId,
      setParts: available.map(item => ({ ...stockSaleForm(item, createEmptyDocumentForm('crafted-sale'), savedPrices), id: item.id, remaining: item.remaining, selected: true })),
    }));
    setStockQuery(''); setDocumentErrors({}); setFormMessage(null);
  };
  const sellSet = items => { chooseSet(items); openTool('register'); };
  const findStock = event => {
    const value = event.target.value;
    setStockQuery(value);
    const match = stock.available.find(item => normalizeProductCode(item.productCode) === normalizeProductCode(value));
    if (match) { chooseStock(match); return; }
    setDocumentForm(current => ({ ...createEmptyDocumentForm(), type: current.type, date: current.date, customerId: current.customerId, customerName: current.customerName, gold18Price: current.gold18Price }));
    setDocumentErrors({}); setFormMessage(null);
  };

  const persistGoldPurchases = nextPurchases => {
    saveUserRecords(GOLD_PURCHASES_KEY, username, nextPurchases);
    setGoldPurchases(nextPurchases);
  };

  const persistCheques = nextCheques => {
    saveUserRecords(CHEQUES_KEY, username, nextCheques);
    setCheques(nextCheques);
  };

  const persistCustomers = nextCustomers => {
    saveUserRecords(CUSTOMERS_KEY, username, nextCustomers);
    setCustomers(nextCustomers);
  };

  const saveCustomerProfile = record => {
    const existing = customers.find(customer => customer.id === record.id);
    if (existing) {
      // Attach older name-only documents before a name changes.
      persistDocuments(documents.map(doc => (doc.customerId === existing.id || (!doc.customerId && doc.source !== 'opening-inventory' && doc.customerName?.trim() === existing.name.trim())) ? { ...doc, customerId: record.id, customerName: record.name } : doc));
      persistCustomers(customers.map(customer => customer.id === record.id ? record : customer));
    } else {
      persistCustomers([record, ...customers]);
    }
  };

  const updateFormWithMarketPrice = (form, fieldName, fieldValue) => {
    const nextForm = { ...form, [fieldName]: fieldValue };
    const nextType = fieldName === 'type' ? getDocumentType(fieldValue) : selectedDocumentType;

    if (fieldName === 'type') {
      if (nextType.category === 'crafted' && !nextForm.gramPrice) nextForm.gramPrice = priceForm.goldGramPrice;
      if (nextType.category === 'melted' && !nextForm.meltedGramPrice) nextForm.meltedGramPrice = priceForm.goldGramPrice;
      if (nextType.category === 'coin' && nextForm.coinType !== 'پارسیان' && !nextForm.coinPrice) {
        nextForm.coinPrice = String(getCoinPrice(nextForm.coinType, priceForm) || '');
      }
    }

    if (fieldName === 'currencyType') nextForm.currencyRate = String(currencyRate(fieldValue, savedPrices) || '');
    if (fieldName === 'coinType' && fieldValue !== 'پارسیان') {
      nextForm.coinPrice = String(getCoinPrice(fieldValue, savedPrices) || '');
    }

    return nextForm;
  };

  const updateDocumentField = event => {
    const { name, value } = event.target;
    setDocumentErrors(current => name === 'type' ? {} : { ...current, [name]: '', ...(name === 'customerId' ? { customerName: '' } : {}) });
    if (name === 'customerId') {
      const customer = customers.find(item => item.id === value);
      setDocumentForm(current => ({ ...current, customerId: value, customerName: customer?.name || '' }));
      setFormMessage(null);
      return;
    }
    if (name === 'expenseUnit' || name === 'expenseCurrency') {
      setDocumentForm(current => {
        const expenseUnit = name === 'expenseUnit' ? value : current.expenseUnit;
        const expenseCurrency = name === 'expenseCurrency' ? value : current.expenseCurrency;
        const rate = expenseUnit === 'gold' ? toNumber(savedPrices.goldGramPrice) : expenseUnit === 'currency' ? currencyRate(expenseCurrency, savedPrices) : 0;
        return { ...current, expenseUnit, expenseCurrency, expenseAmount: name === 'expenseUnit' ? '' : current.expenseAmount, expenseRate: rate > 0 ? String(rate) : '' };
      });
      setDocumentErrors({}); setFormMessage(null); return;
    }
    if (name === 'type') {
      setDocumentForm(current => ({ ...createEmptyDocumentForm(value), date: current.date, customerId: value === 'expense' ? '' : current.customerId, customerName: value === 'expense' ? '' : current.customerName, gramPrice: savedPrices.goldGramPrice, meltedGramPrice: savedPrices.goldGramPrice, currencyRate: String(currencyRate('USD', savedPrices) || ''), coinPrice: String(getCoinPrice('امامی بانکی ۸۶', savedPrices) || '') }));
      setStockQuery(''); setFormMessage(null); return;
    }
    if (name === 'setMode') {
      setDocumentForm(current => ({ ...current, setMode: value, setParts: value === 'separate' && !current.setParts.length ? [createSetPart({ gramPrice: savedPrices.goldGramPrice }), createSetPart({ gramPrice: savedPrices.goldGramPrice })] : current.setParts }));
      setDocumentErrors({}); setFormMessage(null); return;
    }
    if (saleMode && selectedStock && stockIdentityFields.includes(name) && String(selectedStock[name] || '').trim()) return;
    setDocumentForm(currentForm => updateFormWithMarketPrice(currentForm, name, value));
    setFormMessage(null);
  };

  const updatePriceField = event => {
    const { name, value } = event.target;
    setPriceForm(currentForm => ({ ...currentForm, [name]: value }));
    setPriceMessage(null);
  };

  const upsertCustomerFromDocument = (currentCustomers, documentRecord) => {
    const cleanName = documentRecord.customerName.trim();
    const customerIndex = currentCustomers.findIndex(customer => customer.id === documentRecord.customerId);
    const debtSign = isSaleDocument(documentRecord) ? 1 : -1;
    const purchaseRecord = {
      id: documentRecord.id,
      title: documentRecord.typeLabel,
      detail: documentRecord.itemSummary,
      amount: documentRecord.amount,
      date: documentRecord.date,
      recordedAt: documentRecord.recordedAt,
      gold18Price: documentRecord.gold18Price,
      transactionId: documentRecord.transactionId,
    };

    if (customerIndex === -1) {
      return [{
        id: documentRecord.customerId,
        name: cleanName,
        phone: '',
        gramDebt: debtSign * documentRecord.gramDebt,
        rialDebt: debtSign * documentRecord.rialDebt,
        purchases: [purchaseRecord],
        note: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, ...currentCustomers];
    }

    return currentCustomers.map((customer, index) => index === customerIndex ? {
      ...customer,
      gramDebt: Number(customer.gramDebt || 0) + debtSign * documentRecord.gramDebt,
      rialDebt: Number(customer.rialDebt || 0) + debtSign * documentRecord.rialDebt,
      purchases: [purchaseRecord, ...(customer.purchases || [])],
      updatedAt: new Date().toISOString(),
    } : customer);
  };

  const submitDocument = event => {
    event.preventDefault();
    const cleanCustomerName = documentForm.customerName.trim();
    const documentWithCategory = { ...documentForm, category: selectedDocumentType.category, gold18Price: documentForm.gold18Price ?? savedPrices.goldGramPrice ?? '', ...(separateSetMode ? { gramPrice: savedPrices.goldGramPrice } : {}) };

    const errors = separateSetMode ? validateSetForm(documentWithCategory, documents) : validateDocument(documentWithCategory, selectedDocumentType.category, toNumber);
    const quantity = stockQuantity(documentWithCategory);
    if (!expenseMode && !separateSetMode && selectedDocumentType.category !== 'currency' && (!Number.isSafeInteger(quantity) || quantity <= 0)) errors[selectedDocumentType.category === 'coin' ? 'coinCount' : 'itemCount'] = 'تعداد باید عدد صحیح بیشتر از صفر باشد.';
    if (saleMode && !separateSetMode) {
      const stockError = validateStockSale(documentWithCategory, documents);
      if (stockError) errors.productCode = stockError;
    }
    setDocumentErrors(errors);
    if (Object.keys(errors).length) {
      setFormMessage({ type: 'error', text: Object.values(errors)[0] });
      requestAnimationFrame(() => document.querySelector('.document-form [aria-invalid="true"]')?.focus());
      return;
    }

    const recordedAt = newRecordTimestamp();
    if (expenseMode) {
      const expense = {
        ...normalizeExpense(documentForm),
        id: `document-${crypto.randomUUID()}`, type: 'expense', category: 'expense', direction: 'هزینه', typeLabel: 'هزینه فروشگاه',
        date: documentForm.date, description: documentForm.description.trim(), note: documentForm.note.trim(),
        expensePayee: documentForm.expensePayee.trim(), itemSummary: documentForm.description.trim(),
        customerName: '', customerId: '', gramDebt: 0, rialDebt: 0, createdAt: recordedAt, recordedAt,
      };
      try { persistDocuments([expense, ...currentDocuments()]); }
      catch (error) { setFormMessage({ type: 'error', text: error.message || 'هزینه ذخیره نشد؛ دوباره تلاش کنید.' }); return; }
      setDocumentForm(createEmptyDocumentForm('expense'));
      setFormMessage({ type: 'success', text: 'هزینه ثبت شد و در گزارش سود همین تاریخ محاسبه می‌شود.' });
      return;
    }

    const customerId = documentForm.customerId || customers.find(customer => customer.name.trim() === cleanCustomerName)?.id || `customer-${crypto.randomUUID()}`;
    const rows = expandSetForm(documentWithCategory, { setId: documentForm.setId || `set-${crypto.randomUUID()}`, transactionId: `transaction-${crypto.randomUUID()}` });
    const documentRecords = rows.map(row => ({
      ...row,
      profitPercent: String(toNumber(row.profitPercent)),
      id: `document-${crypto.randomUUID()}`,
      laboratoryName: selectedDocumentType.category === 'melted' ? documentForm.laboratoryName.trim() : '',
      customerName: cleanCustomerName,
      customerId,
      typeLabel: selectedDocumentType.label,
      category: selectedDocumentType.category,
      direction: selectedDocumentType.direction,
      amount: getDocumentAmount(row),
      gold18Price: toNumber(documentWithCategory.gold18Price),
      itemWeight: getDocumentWeight(row),
      itemSummary: describeDocumentItem(row),
      gramDebt: toNumber(row.gramDebt),
      rialDebt: toNumber(row.rialDebt),
      createdAt: recordedAt,
      recordedAt,
    }));

    let saved;
    try {
      const latest = currentDocuments();
      // A sale and its stock movement are the same stored record.
      if (saleMode) {
        const stockError = validateStockSales(documentRecords, latest);
        if (stockError) throw new Error(stockError);
      }
      saved = assignProductCodes([...documentRecords, ...latest]);
      const nextCustomers = documentRecords.reduce(upsertCustomerFromDocument, loadUserRecords(CUSTOMERS_KEY, username));
      saveLedgerRecords(localStorage, userStorageKey(DOCUMENTS_KEY, username), userStorageKey(CUSTOMERS_KEY, username), saved, nextCustomers);
      setDocuments(saved); setCustomers(nextCustomers);
    } catch (error) { setFormMessage({ type: 'error', text: error.message || 'سند ذخیره نشد؛ دوباره تلاش کنید.' }); return; }
    setDocumentForm({ ...createEmptyDocumentForm(), gramPrice: savedPrices.goldGramPrice });
    setStockQuery('');
    const savedRecord = saved.find(item => item.id === documentRecords[0].id);
    setFormMessage({ type: 'success', text: `سند ثبت شد؛ ${saleMode ? 'موجودی قطعه‌های فروخته‌شده کم شد' : separateSetMode ? `${formatNumber(documentRecords.length)} قطعه با کدهای مستقل به مجموعه اضافه شد` : `جنس با کد ${savedRecord.productCode} وارد صندوق شد`}.` });
  };

  const submitPrices = event => {
    event.preventDefault();
    const entered = marketPriceFields.filter(([field]) => String(priceForm[field] || '').trim());
    const invalid = entered.find(([field]) => !Number.isFinite(Number(normalizeNumberInput(priceForm[field]).replace(/[,\s]/g, ''))) || toNumber(priceForm[field]) <= 0);
    if (!entered.length || invalid) {
      setPriceMessage({ type: 'error', text: invalid ? invalid[1] + ' باید عدد معتبر بیشتر از صفر باشد.' : 'حداقل یک نرخ وارد کنید.' });
      return;
    }
    const nextPrices = { ...priceForm, ...Object.fromEntries(entered.map(([key]) => [key, String(toNumber(priceForm[key]))])), updatedAt: new Date().toISOString() };
    try { saveUserObject(PRICES_KEY, username, nextPrices); }
    catch { setPriceMessage({ type: 'error', text: 'نرخ‌ها ذخیره نشد؛ دوباره تلاش کنید.' }); return; }
    setPriceForm(nextPrices);
    setSavedPrices(nextPrices);
    setPriceMessage({ type: 'success', text: 'نرخ‌ها ثبت شد و ارزش موجودی صندوق به‌روز شد.' });
  };

  const completeOpeningInventory = ({ documents: openingDocuments, prices: openingPrices, totalValue }) => {
    const latest = currentDocuments();
    const savedPrices = { ...openingPrices, updatedAt: new Date().toISOString() };
    saveUserObject(PRICES_KEY, username, savedPrices);
    saveOpeningSetup(username, { skipped: false, documentCount: openingDocuments.length, totalValue });
    persistDocuments([...openingDocuments, ...latest]);
    setPriceForm(savedPrices);
    setSavedPrices(savedPrices);
  };

  return <section className="account-page container workspace-page">
    {isMobile && menuOpen && <button className="workspace-menu-overlay" aria-label="بستن منو" onClick={() => setMenuOpen(false)} tabIndex={-1}/>}
    <aside id="workspace-navigation" ref={navigationRef} className={`workspace-rail ${menuOpen ? 'is-open' : ''}`} aria-label="منوی حسابداری" aria-hidden={isMobile && !menuOpen ? true : undefined} inert={isMobile && !menuOpen ? true : undefined}>
      <button className="workspace-menu-close" onClick={() => setMenuOpen(false)} aria-label="بستن منو"><X size={20}/> بستن منو</button>
      <div className="workspace-brand"><span className="brand-mark">ز</span><strong>زرنگار</strong><small>حسابداری طلا و جواهر</small></div>
      <span className="workspace-nav-label">فضای کار</span>
      {[[ 'home', LayoutDashboard ], [ 'entries', ReceiptText ], [ 'reports', BarChart3 ], [ 'crm', Users ]].map(([key, Icon]) => <button key={key} data-section={key} title={workspaceSections[key]} className={activeSection === key ? 'active' : ''} aria-current={activeSection === key ? 'page' : undefined} onClick={() => { setSelectedCrmId(''); openTool(key); }}><Icon size={21}/><span>{workspaceSections[key]}</span>{activeSection === key && <ChevronLeft size={14}/>}</button>)}
      <div className="workspace-rail-foot"><span className="workspace-avatar"><UserRound size={20}/></span><div><strong>{username}</strong><small>حساب من</small></div><button onClick={onLogout} title="خروج از حساب" aria-label="خروج از حساب"><LogOut size={17}/></button></div>
    </aside>
    <div className="workspace-content" inert={isMobile && menuOpen ? true : undefined}>
      <div className="workspace-topbar"><div><button ref={menuButtonRef} className="workspace-menu-toggle" aria-label="باز کردن منو" aria-expanded={menuOpen} aria-controls="workspace-navigation" onClick={() => setMenuOpen(true)}><Menu size={22}/></button><span className="workspace-top-icon"><Gem size={20}/></span><span>زرنگار <ChevronLeft size={13}/> <strong>{workspaceSections[activeSection]}</strong></span></div><details ref={notificationsRef} className="workspace-notifications"><summary aria-label={'اعلان‌ها؛ ' + formatNumber(chequeReminders.total + birthdays.length) + ' یادآوری'}><Bell size={19}/>{chequeReminders.total + birthdays.length > 0 && <b>{formatNumber(chequeReminders.total + birthdays.length)}</b>}</summary><div><strong>یادآوری‌های شما</strong><button onClick={() => openTool('crm-occasions')}>تولدهای امروز و ۷ روز آینده <b>{formatNumber(birthdays.length)}</b></button><button onClick={() => openTool('cheque-reports')}>چک‌های نیازمند پیگیری <b>{formatNumber(chequeReminders.total)}</b></button></div></details></div>
      {!['home', 'entries', 'reports', 'crm', 'crm-occasions'].includes(activeTool) && <div className="workspace-subheading"><button onClick={() => openTool(activeSection)}><ChevronLeft size={17}/> {workspaceSections[activeSection]}</button><span>{toolTitle}</span></div>}
      {storageMessage && <p role="alert" className="form-message error">{storageMessage}</p>}
      <div hidden={activeTool !== 'opening'}><OpeningInventoryPage username={username} prices={savedPrices} onComplete={completeOpeningInventory}/></div>
      {activeTool === 'home' ? <HomePage username={username} documents={documents} prices={savedPrices} assets={assets} customers={customers} cheques={cheques} today={today} helpers={{ quantity: getDocumentQuantity, weight: getDocumentWeight, amount: getDocumentAmount }} onOpen={openTool}/> : ['entries','reports'].includes(activeTool) ? <ToolHub kind={activeTool} onOpen={openTool}/> : ['dashboard','products','balance','gold-entry'].includes(activeTool) ? <SalesDashboard key={activeTool} view={{ dashboard:'sales', products:'products', balance:'balance', 'gold-entry':'gold-entry' }[activeTool]} onOpen={openTool} username={username} documents={documents} prices={savedPrices} goldPurchases={goldPurchases} onSaveGoldPurchases={persistGoldPurchases} helpers={{ quantity: getDocumentQuantity, weight: getDocumentWeight, amount: getDocumentAmount, number: toNumber }}/> : activeTool === 'profit' ? <ProfitPage documents={documents} today={today} onOpen={openTool}/> : activeTool === 'rates' ? <RatesPage prices={savedPrices} onOpen={openTool}/> : activeTool === 'customer-reports' ? <CustomerReports customers={customers} documents={documents} today={today} onSelect={openCustomer}/> : activeTool === 'cheque-reports' ? <ChequeReportPage cheques={cheques} today={today} onEdit={openCheque}/> : activeTool === 'opening' ? null : activeTool === 'vault' ? <InventoryVault report={stock} assets={assets} prices={savedPrices} onPrices={() => openTool('pricing')} onSell={sellStock} onSellSet={sellSet} onReceive={() => { openTool('register'); updateDocumentField({ target: { name: 'type', value: 'crafted-purchase' } }); }} onLinkSale={(saleId, sourceId) => persistDocuments(linkHistoricalSale(currentDocuments(), saleId, sourceId))}/> : activeTool === 'cheques' ? <ChequeManager key={selectedChequeId} cheques={cheques} customers={customers} onSave={persistCheques} parseNumber={toNumber} today={today} initialChequeId={selectedChequeId}/> : ['crm','crm-occasions','customer-entry','settlement-entry'].includes(activeTool) ? <div className="workspace-tools crm-section-page"><CustomerCRM key={activeTool + selectedCrmId} customers={customers} documents={documents} onSave={saveCustomerProfile} parseNumber={toNumber} today={today} initialSelectedId={selectedCrmId} initialView={activeTool === 'crm-occasions' ? 'occasions' : 'customers'} initialAction={activeTool === 'customer-entry' ? 'new' : activeTool === 'settlement-entry' ? 'settlement' : ''}/></div> : <div className="workspace-tools">
        <div className="account-main-panel">
          <div className="panel-heading"><div><span>{({ register: 'ثبت خرید، فروش و هزینه', search: 'جستجو در سندها', cheques: 'مدیریت چک‌ها', pricing: 'ثبت نرخ طلا، سکه و ارز', crm: 'پرونده مشتریان' })[activeTool]}</span></div></div>
          <div className="ledger-panel">
            {activeTool === 'pricing' && <form className="price-form" onSubmit={submitPrices}>
              {priceMessage && <div className={`form-message ${priceMessage.type}`}>{priceMessage.text}</div>}
              <div className="form-grid price-grid">
                {marketPriceFields.map(([field, label]) => <label key={field}>{label}<input name={field} inputMode="decimal" value={priceForm[field] || ''} onChange={updatePriceField} placeholder="تومان"/></label>)}
                <p className="document-required-note wide">نرخ‌ها دستی ثبت می‌شوند؛ قیمت هر واحد به تومان است. نرخ ثبت‌شده در سندهای قبلی حفظ می‌شود.</p>
                {savedPrices.updatedAt && <p className="document-required-note wide">آخرین ثبت نرخ: {new Date(savedPrices.updatedAt).toLocaleString('fa-IR')}</p>}
              </div>
              <div className="price-impact">
                <div>
                  <span>تعداد سندهای قابل بروزرسانی</span>
                  <strong>{formatNumber(documents.length)} <small>سند</small></strong>
                </div>
                <div>
                  <span>ارزش جدید بر اساس نرخ‌ها</span>
                  <strong>{formatNumber(liveInventoryValue)} <small>تومان</small></strong>
                </div>
              </div>
              <button className="button button-primary full" type="submit"><TrendingUp size={17}/> ثبت قیمت و بروزرسانی جنس‌ها</button>
            </form>}

            {activeTool === 'register' && <form className="document-form" onSubmit={submitDocument} noValidate>
              <label className="document-type-select">نوع سند<select name="type" value={documentForm.type} onChange={updateDocumentField}>{documentTypes.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>

              {formMessage && <div className={`form-message ${formMessage.type}`}>{formMessage.text}</div>}
              <p className="document-required-note">ساعت و دقیقهٔ ثبت، هنگام ذخیره به‌صورت خودکار به وقت ایران ثبت می‌شود.</p>

              {expenseMode ? <>
                <p className="document-required-note">هزینه را به تومان، ریال، گرم طلا یا ارز ثبت کنید. معادل تومانی با نرخ همین سند از سود دوره کم می‌شود.</p>
                <fieldset className="document-section"><legend>مشخصات هزینه</legend>
                  <DocumentField className="wide" name="description" label="عنوان هزینه" error={documentErrors.description} required><input name="description" value={documentForm.description} onChange={updateDocumentField} placeholder="مثلاً اجاره مغازه یا هزینه حمل"/></DocumentField>
                  <DocumentField name="expenseUnit" label="واحد هزینه" error={documentErrors.expenseUnit} required><select name="expenseUnit" value={documentForm.expenseUnit} onChange={updateDocumentField}>{expenseUnits.map(unit => <option key={unit.value} value={unit.value}>{unit.label}</option>)}</select></DocumentField>
                  {documentForm.expenseUnit === 'currency' && <DocumentField name="expenseCurrency" label="نوع ارز" error={documentErrors.expenseCurrency} required><select name="expenseCurrency" value={documentForm.expenseCurrency} onChange={updateDocumentField}>{currencyCatalog.map(currency => <option key={currency.code} value={currency.code}>{currency.name} ({currency.code})</option>)}</select></DocumentField>}
                  <DocumentField name="expenseAmount" label={documentForm.expenseUnit === 'gold' ? 'وزن هزینه (گرم)' : `مقدار هزینه (${expenseUnitLabel(documentForm)})`} error={documentErrors.expenseAmount} required><input name="expenseAmount" inputMode="decimal" value={documentForm.expenseAmount} onChange={updateDocumentField} placeholder={documentForm.expenseUnit === 'gold' ? 'مثلاً ۰٫۵' : 'مقدار پرداخت‌شده'}/></DocumentField>
                  {documentForm.expenseUnit === 'gold' && <DocumentField name="expenseGoldPurity" label="عیار طلای پرداختی" error={documentErrors.expenseGoldPurity} required><input name="expenseGoldPurity" inputMode="decimal" value={documentForm.expenseGoldPurity} onChange={updateDocumentField} placeholder="مثلاً ۷۵۰"/></DocumentField>}
                  {['gold', 'currency'].includes(documentForm.expenseUnit) && <>
                    <DocumentField name="expenseRate" label={documentForm.expenseUnit === 'gold' ? 'نرخ هر گرم طلای ۷۵۰ (تومان)' : 'نرخ هر واحد ارز (تومان)'} error={documentErrors.expenseRate} required><input name="expenseRate" inputMode="decimal" value={documentForm.expenseRate} onChange={updateDocumentField} placeholder="نرخ زمان پرداخت"/></DocumentField>
                    <p className="document-required-note wide">نرخ پیشنهادی را بررسی کنید؛ مقدار و نرخ این هزینه پس از ثبت ثابت می‌مانند.</p>
                  </>}
                  <DocumentField name="date" label="تاریخ هزینه" error={documentErrors.date} required><PersianDateInput name="date" required value={documentForm.date} onChange={updateDocumentField}/></DocumentField>
                  <DocumentField className="wide" name="expensePayee" label="پرداخت به (اختیاری)"><input name="expensePayee" value={documentForm.expensePayee} onChange={updateDocumentField} placeholder="نام دریافت‌کننده"/></DocumentField>
                  <DocumentField className="wide" name="note" label="یادداشت"><input name="note" value={documentForm.note} onChange={updateDocumentField} placeholder="توضیح تکمیلی"/></DocumentField>
                </fieldset>
              </> : <>
              {saleMode ? <section className="stock-picker" aria-label="انتخاب جنس از صندوق">
                <label>کد یا نام جنس در صندوق<input name="productCode" value={stockQuery} onChange={findStock} autoComplete="off" placeholder="مثلاً ZG-000001" aria-invalid={Boolean(documentErrors.productCode)} aria-describedby={documentErrors.productCode ? 'stock-code-error' : undefined}/></label>
                {documentErrors.productCode && <p id="stock-code-error" className="field-error-text" role="alert">{documentErrors.productCode}</p>}
                {separateSetMode ? <p className="stock-picker-picked">قطعه‌های {documentForm.itemName} انتخاب شده‌اند. قطعه‌های موردنظر برای فروش را در پایین مشخص کنید.</p> : selectedStock ? <><p className="stock-picker-picked">کد <bdi dir="ltr">{selectedStock.productCode}</bdi> انتخاب شد · موجودی: {formatDecimal(selectedStock.remaining)} {selectedStock.category === 'currency' ? selectedStock.currencyType : 'عدد / قطعه'}. تعداد فروش و قیمت را بررسی کنید.</p>{selectedStock.setMode === 'separate' && selectedStock.setId && <button type="button" className="button button-ghost" data-choose-set onClick={() => chooseSet(stock.available.filter(item => item.setId === selectedStock.setId))}>انتخاب قطعه‌های دیگر همین {selectedStock.setKind}</button>}</> : <><p>جنس را با کد پیدا کنید یا از فهرست انتخاب کنید؛ مشخصات خودکار وارد می‌شوند.</p><div className="stock-picker-options">{stockMatches.map(item => <button key={item.id} type="button" onClick={() => chooseStock(item)}><bdi dir="ltr">{item.productCode}</bdi><span>{item.itemName || item.description || item.typeLabel}{item.setName && <small>از {item.setName}</small>}</span><small>{formatDecimal(item.remaining)} موجود</small></button>)}</div>{!stockMatches.length && <p>جنسی پیدا نشد؛ ابتدا خرید یا موجودی اولیه را ثبت کنید.</p>}</>}
              </section> : <p className="stock-picker">با ثبت خرید، کد جنس خودکار صادر می‌شود و جنس وارد «صندوق من» می‌شود.</p>}

              <p className="document-required-note">فیلدهای ستاره‌دار الزامی هستند. مبلغ‌ها به تومان و تاریخ‌ها شمسی‌اند.</p>
              <fieldset className="document-section"><legend>طرف حساب و تاریخ</legend>
                <DocumentField name="customerId" label="انتخاب مشتری" error={documentErrors.customerId}><select name="customerId" value={documentForm.customerId} onChange={updateDocumentField}><option value="">مشتری جدید / ورود نام</option>{customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}{customer.phone ? ` — ${customer.phone}` : ''}</option>)}</select></DocumentField>
                <DocumentField name="customerName" label="نام مشتری" error={documentErrors.customerName} required><input name="customerName" value={documentForm.customerName} readOnly={Boolean(documentForm.customerId)} onChange={updateDocumentField} placeholder="نام مشتری جدید"/></DocumentField>
                <DocumentField name="date" label="تاریخ سند" error={documentErrors.date} required><PersianDateInput name="date" required value={documentForm.date} onChange={updateDocumentField}/></DocumentField>
                <DocumentField name="gold18Price" label="قیمت هر گرم طلای ۱۸ عیار هنگام ثبت (تومان)" error={documentErrors.gold18Price} required><input name="gold18Price" inputMode="decimal" value={documentForm.gold18Price ?? savedPrices.goldGramPrice ?? ''} onChange={updateDocumentField} placeholder="نرخ طلای ۱۸ عیار"/></DocumentField>
                <p className="document-required-note wide">نرخ طلا را بررسی کنید؛ همراه با ساعت ثبت در همین سند ذخیره می‌شود و با تغییر نرخ‌های بازار ثابت می‌ماند. مقدار اولیه از آخرین نرخ دستی ثبت‌شده است.</p>
              </fieldset>
              <fieldset className="document-section"><legend>مشخصات جنس و آزمایشگاه</legend>
                <DocumentField className="wide" name="itemName" label={separateSetMode ? 'نام مجموعه' : 'نام جنس'} error={documentErrors.itemName}><input readOnly={saleMode && (separateSetMode || Boolean(selectedStock?.itemName))} name="itemName" value={documentForm.itemName} onChange={updateDocumentField} placeholder="مثلاً النگو، زنجیر یا پلاک؛ برای گزارش فروش هر جنس"/></DocumentField>
                <DocumentField className="wide" name="description" label="شرح سند" error={documentErrors.description}><input name="description" value={documentForm.description} onChange={updateDocumentField} placeholder="مثلاً خرید النگو یا فروش آبشده"/></DocumentField>

                {selectedDocumentType.category === 'currency' && <>
                  <DocumentField name="currencyType" label="نوع ارز" error={documentErrors.currencyType} required><select name="currencyType" disabled={saleMode && Boolean(selectedStock)} value={documentForm.currencyType} onChange={updateDocumentField}>{currencyCatalog.map(currency => <option key={currency.code} value={currency.code}>{currency.name} ({currency.code})</option>)}</select></DocumentField>
                  <DocumentField name="currencyRate" label="قیمت لحظه‌ای هر واحد ارز (تومان)" error={documentErrors.currencyRate} required><input name="currencyRate" inputMode="decimal" value={documentForm.currencyRate} onChange={updateDocumentField} placeholder="تومان"/></DocumentField>
                  <DocumentField name="currencyAmount" label="مقدار ارز" error={documentErrors.currencyAmount} required><input name="currencyAmount" inputMode="decimal" value={documentForm.currencyAmount} onChange={updateDocumentField} placeholder="مثلاً ۱۰۰٫۵۰"/></DocumentField>
                </>}
                {selectedDocumentType.category === 'crafted' && <>
                  <DocumentField name="craftedKind" label="نوع کار ساخته"><select name="craftedKind" value={documentForm.craftedKind || ''} disabled={saleMode && (separateSetMode || Boolean(selectedStock?.craftedKind))} onChange={updateDocumentField}><option value="">تشخیص از نام کالا</option>{craftedKinds.map(kind => <option key={kind}>{kind}</option>)}</select></DocumentField>
                  {!saleMode && isJewelrySetKind(documentForm.craftedKind) && <div className="wide"><SetModePicker kind={documentForm.craftedKind} value={documentForm.setMode} onChange={value => updateDocumentField({ target: { name: 'setMode', value } })}/></div>}
                  {!separateSetMode && <>
                  <DocumentField name="itemCount" label="تعداد" error={documentErrors.itemCount} required><input name="itemCount" inputMode="decimal" value={documentForm.itemCount} onChange={updateDocumentField} placeholder="مثلاً ۱۰"/></DocumentField>
                  <DocumentField name="weight" label="وزن هر عدد" error={documentErrors.weight} required><input readOnly={saleMode && Boolean(selectedStock?.weight)} name="weight" inputMode="decimal" value={documentForm.weight} onChange={updateDocumentField} placeholder="مثلاً ۱۲.۵"/></DocumentField>
                  <DocumentField name="gramPrice" label="قیمت هر گرم" error={documentErrors.gramPrice} required><input name="gramPrice" inputMode="numeric" value={documentForm.gramPrice} onChange={updateDocumentField} placeholder="تومان"/></DocumentField>
                  <DocumentField name="ayar" label="عیار" error={documentErrors.ayar} required><input readOnly={saleMode && Boolean(selectedStock?.ayar)} name="ayar" inputMode="numeric" value={documentForm.ayar} onChange={updateDocumentField} placeholder="مثلاً 750"/></DocumentField>
                  <DocumentField name="wagePercent" label="اجرت درصدی" error={documentErrors.wagePercent} required><input name="wagePercent" inputMode="decimal" value={documentForm.wagePercent} onChange={updateDocumentField} placeholder="مثلاً ۷"/></DocumentField>
                  </>}
                </>}

                {selectedDocumentType.category === 'coin' && <>
                  <DocumentField name="coinType" label="نوع سکه" error={documentErrors.coinType}><select disabled={saleMode && Boolean(selectedStock)} name="coinType" value={documentForm.coinType} onChange={updateDocumentField}>{coinTypes.map(type => <option key={type} value={type}>{type}</option>)}</select></DocumentField>
                  {documentForm.coinType === 'پارسیان' ? <>
                    <DocumentField name="coinCount" label="تعداد" error={documentErrors.coinCount} required><input name="coinCount" inputMode="decimal" value={documentForm.coinCount} onChange={updateDocumentField} placeholder="مثلاً ۱۰"/></DocumentField>
                    <DocumentField name="parsianWeight" label="گرم هر عدد پارسیان" error={documentErrors.parsianWeight} required><input readOnly={saleMode && Boolean(selectedStock?.parsianWeight)} name="parsianWeight" inputMode="decimal" value={documentForm.parsianWeight} onChange={updateDocumentField} placeholder="مثلاً ۱.۲"/></DocumentField>
                    <DocumentField name="parsianPrice" label="قیمت هر عدد پارسیان" error={documentErrors.parsianPrice} required><input name="parsianPrice" inputMode="numeric" value={documentForm.parsianPrice} onChange={updateDocumentField} placeholder="تومان"/></DocumentField>
                  </> : <>
                    <DocumentField name="coinCount" label="تعداد" error={documentErrors.coinCount} required><input name="coinCount" inputMode="decimal" value={documentForm.coinCount} onChange={updateDocumentField} placeholder="۱"/></DocumentField>
                    <DocumentField name="coinPrice" label="قیمت هر سکه" error={documentErrors.coinPrice} required><input name="coinPrice" inputMode="numeric" value={documentForm.coinPrice} onChange={updateDocumentField} placeholder="تومان"/></DocumentField>
                  </>}
                </>}

                {selectedDocumentType.category === 'melted' && <>
                  <DocumentField name="itemCount" label="تعداد قطعه" error={documentErrors.itemCount} required><input name="itemCount" inputMode="decimal" value={documentForm.itemCount} onChange={updateDocumentField} placeholder="مثلاً ۳"/></DocumentField>
                  <DocumentField name="meltedWeight" label="وزن ترازو هر قطعه" error={documentErrors.meltedWeight} required><input readOnly={saleMode && Boolean(selectedStock?.meltedWeight)} name="meltedWeight" inputMode="decimal" value={documentForm.meltedWeight} onChange={updateDocumentField} placeholder="گرم"/></DocumentField>
                  <DocumentField name="meltedAyar" label="عیار خریداری" error={documentErrors.meltedAyar} required><input readOnly={saleMode && Boolean(selectedStock?.meltedAyar)} name="meltedAyar" inputMode="numeric" value={documentForm.meltedAyar} onChange={updateDocumentField} placeholder="مثلاً ۷۸۰"/></DocumentField>
                  <label>گرم معادل ۷۵۰<input value={formatDecimal(getMeltedWeight750(documentPreview))} readOnly/></label>
                  <DocumentField name="meltedGramPrice" label="قیمت هر گرم" error={documentErrors.meltedGramPrice} required><input name="meltedGramPrice" inputMode="numeric" value={documentForm.meltedGramPrice} onChange={updateDocumentField} placeholder="تومان"/></DocumentField>
                  <DocumentField name="assayCode" label="شماره انگ آبشده" error={documentErrors.assayCode} required><input readOnly={saleMode && Boolean(selectedStock?.assayCode)} name="assayCode" value={documentForm.assayCode} onChange={updateDocumentField} placeholder="شماره انگ"/></DocumentField>
                  <DocumentField name="laboratoryName" label="نام آزمایشگاه" error={documentErrors.laboratoryName} required><input readOnly={saleMode && Boolean(selectedStock?.laboratoryName)} name="laboratoryName" value={documentForm.laboratoryName} onChange={updateDocumentField} placeholder="نام آزمایشگاه ری‌گیری"/></DocumentField>
                </>}

              </fieldset>
              {separateSetMode && <JewelrySetEditor parts={documentForm.setParts} onChange={setParts => { setDocumentForm(current => ({ ...current, setParts })); setDocumentErrors({}); setFormMessage(null); }} sale={saleMode} prices={savedPrices} errors={documentErrors}/>}
              <fieldset className="document-section"><legend>{separateSetMode ? 'بدهی کل مجموعه و یادداشت' : 'مبلغ و بدهی'}</legend>
                {!separateSetMode && <>
                {selectedDocumentType.category !== 'currency' && <>
                  {selectedDocumentType.category !== 'crafted' && <DocumentField name="wagePercent" label="اجرت درصدی" error={documentErrors.wagePercent}><input name="wagePercent" inputMode="decimal" value={documentForm.wagePercent} onChange={updateDocumentField} placeholder="اختیاری"/></DocumentField>}
                  <DocumentField name="wageFixed" label="اجرت ثابت هر عدد / قطعه (تومان)" error={documentErrors.wageFixed}><input name="wageFixed" inputMode="decimal" value={documentForm.wageFixed} onChange={updateDocumentField} placeholder="اختیاری"/></DocumentField>
                </>}
                <DocumentField name="otherCosts" label="هزینه‌های دیگر هر واحد (تومان)" error={documentErrors.otherCosts}><input name="otherCosts" inputMode="decimal" value={documentForm.otherCosts} onChange={updateDocumentField} placeholder="اختیاری"/></DocumentField>
                <DocumentField name="profitPercent" label={saleMode ? 'درصد سود فروشنده' : 'سود درصدی'} error={documentErrors.profitPercent}><input name="profitPercent" inputMode="decimal" value={documentForm.profitPercent} onChange={updateDocumentField} placeholder="مثلاً ۷"/></DocumentField>
                {selectedDocumentType.value.endsWith('-sale') && <DocumentField name="discountRial" label="تخفیف ریالی" error={documentErrors.discountRial}><input name="discountRial" inputMode="numeric" value={documentForm.discountRial} onChange={updateDocumentField} placeholder="تومان"/></DocumentField>}
                </>}

                <DocumentField name="gramDebt" label={selectedDocumentType.direction === 'فروش' ? 'بدهی گرمی مشتری به ما' : 'بدهی گرمی ما به مشتری'} error={documentErrors.gramDebt}><input name="gramDebt" inputMode="decimal" value={documentForm.gramDebt} onChange={updateDocumentField} placeholder="گرم"/></DocumentField>
                <DocumentField name="rialDebt" label={selectedDocumentType.direction === 'فروش' ? 'بدهی ریالی مشتری به ما' : 'بدهی ریالی ما به مشتری'} error={documentErrors.rialDebt}><input name="rialDebt" inputMode="numeric" value={documentForm.rialDebt} onChange={updateDocumentField} placeholder="تومان"/></DocumentField>
                <DocumentField className="wide" name="note" label="یادداشت" error={documentErrors.note}><input name="note" value={documentForm.note} onChange={updateDocumentField} placeholder="توضیح تکمیلی"/></DocumentField>
              </fieldset>
              {saleMode && <p className="document-required-note">سود فروشنده از مجموع ارزش طلا، اجرت و هزینه‌های این سند محاسبه می‌شود. هزینه‌های عمومی فروشگاه را با نوع سند «هزینه فروشگاه» ثبت کنید.</p>}
              </>}

              <div className="document-preview">
                <span>{expenseMode ? 'معادل تومانی هزینه' : 'پیش‌نمایش مبلغ سند'}</span>
                <strong>{Number.isFinite(previewAmount) ? formatNumber(previewAmount) : '—'} <small>تومان</small></strong>
                <small>{separateSetMode ? `${formatNumber(previewRows.length)} قطعه انتخاب‌شده از ${documentForm.itemName || documentForm.craftedKind}` : describeDocumentItem(documentPreview)}</small>
                {expenseMode && <small>{expenseSummary(documentForm)}{!Number.isFinite(previewAmount) && ' · مقدار و نرخ معتبر را وارد کنید.'}</small>}
                {saleMode && <small>سود فروشنده: {formatNumber(previewRows.reduce((sum, row) => sum + documentBreakdown(row).profit, 0))} تومان · تخفیف: {formatNumber(previewRows.reduce((sum, row) => sum + toNumber(row.discountRial), 0))} تومان</small>}
              </div>

              <button className="button button-primary full" type="submit"><ReceiptText size={17}/> {expenseMode ? 'ثبت هزینه' : 'ثبت سند'}</button>
            </form>}

            {activeTool === 'search' && <div className="search-ledger">
              <div className="search-controls">
                <label>جستجو در سندها<input value={searchTerm} onChange={event => setSearchTerm(event.target.value)} placeholder="نام مشتری، آزمایشگاه، انگ آبشده یا نوع سکه"/></label>
                <button className="button button-ghost" onClick={() => setSearchTerm('')}>پاک کردن</button>
              </div>
              <div className="document-list">
                {filteredDocuments.length ? filteredDocuments.map(document => <article className="document-card" key={document.id}>
                  <div>
                    <span>{document.typeLabel}</span>
                    <strong>{document.type === 'expense' ? document.expensePayee || 'هزینه فروشگاه' : document.customerName}</strong>
                    {document.productCode && <bdi className="document-product-code" dir="ltr">{document.productCode}</bdi>}
                    {document.itemName && <small>{document.itemName}</small>}
                    <small>{document.itemSummary}</small>
                  </div>
                  <div>
                    <span>{formatRecordDate(document)}</span>
                    {document.type === 'expense' ? <><strong>هزینه: {expenseSummary(document)}</strong>{document.expenseUnit && document.expenseUnit !== 'toman' && <small>معادل ثبت‌شده: {formatNumber(document.amount)} تومان</small>}{expenseRateSummary(document) && <small>{expenseRateSummary(document)}</small>}</> : <>
                      <strong>مبلغ ثبت‌شده: {formatNumber(getDocumentAmount(document))} تومان</strong>
                      {isTradeDocument(document) && <small data-trade-gold-price>{tradeGoldPriceSummary(document)}</small>}
                      <small>بدهی: {formatDecimal(document.gramDebt)} گرم / {formatNumber(document.rialDebt)} تومان</small>
                    </>}
                  </div>
                </article>) : <div className="empty-state">سندی برای این جستجو پیدا نشد.</div>}
              </div>
            </div>}

            {activeTool === 'crm' && <CustomerCRM customers={customers} documents={documents} onSave={saveCustomerProfile} parseNumber={toNumber}/>}
          </div>
        </div>

      {activeTool === 'register' && <details className="account-table-panel recent-documents-details"><summary>آخرین سندهای ثبت‌شده</summary>
        <div className="panel-heading">
          <div>
            <span>آخرین سندها</span>
            <p>خلاصه خرید، فروش، هزینه‌ها و بدهی مرتبط با هر مشتری.</p>
          </div>
        </div>
        <div className="activity-table">
          <div className="activity-row activity-head document-row"><span>شرح</span><span>طرف حساب</span><span>مبلغ (تومان)</span><span>بدهی</span></div>
          {latestDocuments.length ? latestDocuments.map(document => <div className="activity-row document-row" key={document.id}>
            <span>{document.typeLabel} - {document.itemSummary}{document.productCode && <bdi className="document-product-code" dir="ltr">{document.productCode}</bdi>}{document.recordedAt && <small className="document-record-time">{formatRecordDate(document)}</small>}{document.type === 'expense' && <small className="document-record-time">{expenseSummary(document)}</small>}</span>
            <span>{document.customerName || document.expensePayee || '—'}</span>
            <span>{formatNumber(getDocumentAmount(document))}{isTradeDocument(document) && <small className="document-record-time" data-trade-gold-price>{tradeGoldPriceSummary(document)}</small>}</span>
            <b>{document.type === 'expense' ? '—' : `${formatDecimal(document.gramDebt)} گرم / ${formatNumber(document.rialDebt)}`}</b>
          </div>) : <div className="empty-state inside-table">هنوز سندی ثبت نشده است.</div>}
        </div>
      </details>}
      </div>}
    </div>
  </section>
}

function DocumentField({ name, label, error, required, className = '', children }) {
  return <label className={`${className} ${error ? 'field-error' : ''}`}><span className="document-field-label">{label}{required && <span className="required-mark" aria-label="الزامی"> *</span>}</span>{React.cloneElement(children, { 'aria-invalid': error ? true : undefined, 'aria-describedby': error ? `document-error-${name}` : undefined, 'aria-required': required || undefined })}{error && <small id={`document-error-${name}`} className="field-error-text">{error}</small>}</label>;
}

function Feature({icon, title, text}) { return <article className="feature"><span className="feature-icon">{icon}</span><h3>{title}</h3><p>{text}</p><a href="#how">بیشتر بدانید <ChevronLeft size={15}/></a></article> }
createRoot(document.getElementById('root')).render(<App />);
