import { ownerStorage } from './ownerStorage.js';
import { readAccountingDraft, readDocumentDraft, writeAccountingDraft, clearCommittedDraft } from './accountingDrafts.js';
import StoreSettings from './StoreSettings.jsx';
import { can, canOpenTool } from './access.js';
import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, BarChart3, Bell, Calculator, ChevronLeft, CircleDollarSign, Coins, FileText, Gem, Menu, Plus, ReceiptText, Search, ShieldCheck, Sparkles, TrendingUp, UserRound, Users, Wallet, X, Zap } from 'lucide-react';
import './styles.css';
import './ledger.css';
import SalesDashboard from './SalesDashboard';
import CustomerCRM from './CustomerCRM';
import PartnerCRM, { PartnerDocumentDialog } from './PartnerCRM';
import ChequeManager, { ChequeAlerts } from './ChequeManager';
import { getChequeReminders } from './checks';
import PersianDateInput from './PersianDateInput';
import { formatRecordDate, newRecordTimestamp } from './recordTime';
import { isTradeDocument, tradeGoldPriceSummary } from './tradeGoldPrice';
import { expenseRateSummary, expenseSummary, expenseUnitLabel, expenseUnits, expenseValue, normalizeExpense } from './expenses';
import { validateDocument } from './documentValidation';
import { profitPercentInput } from './profitDefaults';
import { isMiscPurchase, miscGoldDefaults, miscGoldWeight750 } from './miscGold';
import { cleanInvoiceLine, expandInvoiceDraft, invoiceHeader, invoiceHeaderFields, invoiceLineForms, invoiceLinePreview } from './invoiceDraft';
import { groupInvoices, partnerDocumentRows } from './invoices';
import { invoiceSettlement, settlementRowAmount } from './invoiceSettlement';
import InvoiceDetails from './InvoiceDetails';
import DocumentEditor, { canManageInvoice } from './DocumentEditor';
import NumberInput from './NumberInput.jsx';
import './invoice-draft.css';
import InventoryVault from './InventoryVault';
import StockNameField from './StockNameField';
import { exactStockName, findStockMatches } from './stockSearch';
import JewelrySetEditor, { SetModePicker } from './JewelrySetEditor';
import { createSetPart, expandSetForm, isJewelrySetKind, isSeparateSetForm, validateSetForm } from './jewelrySets';
import { assignProductCodes, inventoryReport, isStockSale, linkHistoricalSale, normalizeProductCode, saveLedgerRecords, stockIdentityFields, stockQuantity, stockSaleForm, validateStockSale, validateStockSales } from './inventory';
import { iranDate } from './sales';
import { assetReport, coinCatalog, currencyCatalog, currencyName, currencyRate, documentBreakdown, marketPriceFields, quantity } from './assets';
import { craftedKinds } from './crmAnalytics';
import { birthdayReminders, toolSections, workspaceSections } from './workspace';
import { HomePage, ToolHub, CustomerReports, ProfitPage, RatesPage, ChequeReportPage, entryTools, reportTools } from './WorkspacePages';
import { LayoutDashboard, LogOut, PackageOpen, Settings } from 'lucide-react';

const DOCUMENTS_KEY = 'zarngarDocuments';
const CUSTOMERS_KEY = 'zarngarCustomers';
const PARTNERS_KEY = 'zarngarPartners';
const PRICES_KEY = 'zarngarPrices';
const OPENING_SETUP_KEY = 'zarngarOpeningSetup';
const GOLD_PURCHASES_KEY = 'zarngarGoldPurchases';
const CHEQUES_KEY = 'zarngarCheques';

const documentTypes = [
  { value: 'crafted-sale', label: 'فروش کار ساخته', category: 'crafted', direction: 'فروش' },
  { value: 'crafted-purchase', label: 'خرید کار ساخته', category: 'crafted', direction: 'خرید' },
  { value: 'misc-purchase', label: 'خرید طلای متفرقه', category: 'crafted', direction: 'خرید' },
  { value: 'coin-sale', label: 'فروش سکه', category: 'coin', direction: 'فروش' },
  { value: 'coin-purchase', label: 'خرید سکه', category: 'coin', direction: 'خرید' },
  { value: 'melted-sale', label: 'فروش آبشده', category: 'melted', direction: 'فروش' },
  { value: 'melted-purchase', label: 'خرید آبشده', category: 'melted', direction: 'خرید' },
  { value: 'currency-sale', label: 'فروش ارز', category: 'currency', direction: 'فروش' },
  { value: 'currency-purchase', label: 'خرید ارز', category: 'currency', direction: 'خرید' },
  { value: 'expense', label: 'هزینه فروشگاه', category: 'expense', direction: 'هزینه' },
];

const partnerDocumentTypes = [
  { value: 'partner-crafted-sale', label: 'فروش کار ساخته به همکار', category: 'crafted' },
  { value: 'partner-coin-sale', label: 'فروش سکه به همکار', category: 'coin' },
  { value: 'partner-crafted-purchase', label: 'خرید کار ساخته از همکار', category: 'crafted' },
  { value: 'partner-melted-purchase', label: 'خرید آب‌شده از همکار', category: 'melted' },
  { value: 'partner-coin-purchase', label: 'خرید سکه از همکار', category: 'coin' },
  { value: 'partner-remittance', label: 'حواله همکار', category: null },
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
    profitPercent: type.startsWith('crafted-') || type.endsWith('-sale') ? '7' : '0',
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
    cashPaid: '',
    invoicePaymentStep: false,
    note: '',
    invoiceRows: [],
    invoiceCurrentEmpty: true,
    invoiceEditingIndex: -1,
    ...(isMiscPurchase(type) ? miscGoldDefaults() : {}),
  };
}

function createDefaultPriceForm() {
  return Object.fromEntries(marketPriceFields.map(([field]) => [field, '']));
}

function createOpeningInventoryItem(category) {
  return {
    id: `opening-item-${category}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    category,
    itemName: '',
    craftedKind: '',
    setMode: 'together',
    setParts: [],
    description: '',
    itemCount: '',
    weight: '',
    ayar: '750',
    wagePercent: '',
    profitPercent: profitPercentInput('', category),
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
    return JSON.parse(ownerStorage.getItem(userStorageKey(baseKey, username))) || [];
  } catch {
    return [];
  }
}

function saveUserRecords(baseKey, username, records) {
  ownerStorage.setItem(userStorageKey(baseKey, username), JSON.stringify(records));
}

function loadUserObject(baseKey, username, fallback) {
  try {
    return { ...fallback, ...(JSON.parse(ownerStorage.getItem(userStorageKey(baseKey, username))) || {}) };
  } catch {
    return fallback;
  }
}

function saveUserObject(baseKey, username, record) {
  ownerStorage.setItem(userStorageKey(baseKey, username), JSON.stringify(record));
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

const formatDebtGrams = value => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 6 }).format(Number(value) || 0);

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
  if (isMiscPurchase(document)) return getDocumentQuantity(document) * miscGoldWeight750(document);
  if (document.category === 'crafted') return getDocumentQuantity(document) * toNumber(document.weight);
  if (document.category === 'coin' && document.coinType === 'پارسیان') return getDocumentQuantity(document) * toNumber(document.parsianWeight);
  if (document.category === 'melted') return getDocumentQuantity(document) * getMeltedWeight750(document);
  return 0;
}

function describeDocumentItem(document) {
  if (document.type === 'expense') return document.description || 'هزینه فروشگاه';
  const quantity = getDocumentQuantity(document);
  if (isMiscPurchase(document)) return `طلای متفرقه؛ ${formatDecimal(quantity)} قطعه، هر قطعه ${formatDecimal(document.weight)} گرم ترازو، عیار خرید ${document.ayar}، معادل ۷۵۰ هر قطعه: ${formatDebtGrams(miscGoldWeight750(document))} گرم، جمع معادل ۷۵۰: ${formatDebtGrams(getDocumentWeight(document))} گرم`;
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
  if (String(item.itemName || '').trim() || String(item.craftedKind || '').trim()) return false;
  if (item.category === 'crafted' && isJewelrySetKind(item.craftedKind)) return false;
  const customProfit = String(item.profitPercent ?? '').trim() && toNumber(item.profitPercent) !== Number(profitPercentInput('', item.category));
  if ([item.wageFixed, item.wagePercent, item.otherCosts].some(value => String(value || '').trim()) || customProfit) return false;
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
    itemName: String(item.itemName || '').trim(),
    ...Object.fromEntries(['setId', 'setName', 'setKind', 'setMode', 'setPieceCount', 'transactionId'].filter(key => item[key] != null).map(key => [key, item[key]])),
    wagePercent: item.wagePercent || '0', wageFixed: item.wageFixed || '0', otherCosts: item.otherCosts || '0', profitPercent: profitPercentInput(item.profitPercent, item.category),
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

function OpeningInventoryPage({ username, prices, onComplete }) {
  const initialDraft = useRef(readAccountingDraft(username, 'opening'));
  const requestId = useRef(initialDraft.current?.requestId || null);
  const operation = useRef(false);
  const [saving, setSaving] = useState(false);
  const [locked, setLocked] = useState(Boolean(requestId.current && ownerStorage.status().recovery?.requestId === requestId.current));
  const [openingPrices, setOpeningPrices] = useState(initialDraft.current?.form?.prices || prices);
  const [items, setItems] = useState(() => initialDraft.current?.form?.items || [
    createOpeningInventoryItem('crafted'),
    createOpeningInventoryItem('coin'),
    createOpeningInventoryItem('melted'),
    createOpeningInventoryItem('currency'),
  ]);
  const [message, setMessage] = useState(null);
  const [draftError, setDraftError] = useState('');
  useEffect(() => {
    try { writeAccountingDraft(username, 'opening', { items, prices: openingPrices }, requestId.current); setDraftError(''); }
    catch { setDraftError('پیش‌نویس در مرورگر ذخیره نشد؛ تا تأیید ثبت در سرور، این صفحه را نبندید.'); }
  }, [username, items, openingPrices]);
  useEffect(() => {
    if (!initialDraft.current?.form && !operation.current && !locked) setOpeningPrices(prices);
  }, [prices, locked]);

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
    requestAnimationFrame(() => document.querySelector(`[data-opening-item="${item.id}"] [data-opening-field="itemName"]`)?.focus());
  };

  const removeItem = id => {
    setItems(currentItems => currentItems.length > 1 ? currentItems.filter(item => item.id !== id) : currentItems);
    setMessage(null);
  };

  const submitOpeningInventory = async event => {
    event.preventDefault();
    if (operation.current) return;

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
    operation.current = true; setSaving(true); setMessage(null);
    requestId.current ||= crypto.randomUUID();
    try {
      writeAccountingDraft(username, 'opening', { items, prices: openingPrices }, requestId.current);
      await onComplete({
        documents: openingDocuments,
        prices: openingPrices,
        totalValue: openingDocuments.reduce((sum, document) => sum + Number(document.currentAmount || 0), 0),
      }, requestId.current);
      clearCommittedDraft(username, requestId.current);
      requestId.current = null; initialDraft.current = null; setLocked(false);
      setItems(['crafted', 'coin', 'melted', 'currency'].map(createOpeningInventoryItem));
      setOpeningErrors({});
      setMessage({ type: 'success', text: 'موجودی اولیه ثبت شد؛ کد هر جنس در «صندوق من» آماده است.' });
    } catch (error) {
      setLocked(Boolean(ownerStorage.status().recovery));
      setMessage({ type: 'error', text: `ثبت هنوز تأیید نشده و ردیف‌ها محفوظ هستند. ${error.message || 'دوباره تلاش کنید.'}` });
    } finally { operation.current = false; setSaving(false); }
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
            <label className="wide">{isSeparateSetForm(item) ? 'نام مجموعه' : 'نام جنس'} *<input data-opening-field="itemName" aria-required="true" value={item.itemName} onChange={event => updateItemField(item.id, 'itemName', event.target.value)} placeholder="نام کالا برای نمایش به مشتری"/></label>
            <label className="wide">شرح دارایی<input data-opening-field="description" value={item.description} onChange={event => updateItemField(item.id, 'description', event.target.value)} placeholder={category === 'crafted' ? 'مثلاً النگو، زنجیر، نیم‌ست' : category === 'coin' ? 'مثلاً سکه امامی بانکی' : 'مثلاً آبشده ۷۵۰'}/></label>

            {category === 'crafted' && !isSeparateSetForm(item) && <>
              <label>تعداد<NumberInput inputMode="decimal" value={item.itemCount} onChange={event => updateItemField(item.id, 'itemCount', event.target.value)} placeholder="مثلاً ۱۰"/></label>
              <label>وزن هر عدد<NumberInput inputMode="decimal" value={item.weight} onChange={event => updateItemField(item.id, 'weight', event.target.value)} placeholder="گرم"/></label>
              <label>عیار<NumberInput inputMode="numeric" value={item.ayar} onChange={event => updateItemField(item.id, 'ayar', event.target.value)} placeholder="مثلاً 750"/></label>
              <label>اجرت درصدی<NumberInput inputMode="decimal" value={item.wagePercent} onChange={event => updateItemField(item.id, 'wagePercent', event.target.value)} placeholder="اختیاری"/></label>
              <label>نوع کار ساخته *<select data-opening-field="craftedKind" aria-required="true" value={item.craftedKind || ''} onChange={event => updateItemField(item.id, 'craftedKind', event.target.value)}><option value="">نوع کار را انتخاب کنید</option>{craftedKinds.map(kind => <option key={kind}>{kind}</option>)}</select></label>
            </>}
            {category === 'crafted' && isSeparateSetForm(item) && <label>نوع مجموعه<select data-opening-field="craftedKind" value={item.craftedKind} onChange={event => updateItemField(item.id, 'craftedKind', event.target.value)}>{craftedKinds.map(kind => <option key={kind}>{kind}</option>)}</select></label>}
            {category === 'crafted' && isJewelrySetKind(item.craftedKind) && <div className="wide"><SetModePicker kind={item.craftedKind} value={item.setMode} onChange={value => updateItemField(item.id, 'setMode', value)}/></div>}
            {isSeparateSetForm(item) && <div className="wide"><JewelrySetEditor parts={item.setParts} onChange={parts => updateItemField(item.id, 'setParts', parts)} prices={openingPrices} errors={openingErrors[item.id]}/></div>}

            {category === 'coin' && <>
              <label>نوع سکه<select value={item.coinType} onChange={event => updateItemField(item.id, 'coinType', event.target.value)}>{coinTypes.map(type => <option key={type} value={type}>{type}</option>)}</select></label>
              <label>تعداد<NumberInput inputMode="decimal" value={item.coinCount} onChange={event => updateItemField(item.id, 'coinCount', event.target.value)} placeholder="مثلاً ۱۰"/></label>
              {item.coinType === 'پارسیان' && <>
                <label>وزن هر عدد پارسیان<NumberInput inputMode="decimal" value={item.parsianWeight} onChange={event => updateItemField(item.id, 'parsianWeight', event.target.value)} placeholder="گرم"/></label>
                <label>قیمت هر عدد پارسیان<NumberInput inputMode="numeric" value={item.parsianPrice} onChange={event => updateItemField(item.id, 'parsianPrice', event.target.value)} placeholder="تومان"/></label>
              </>}
            </>}

            {category === 'melted' && <>
              <label>تعداد قطعه<NumberInput inputMode="decimal" value={item.itemCount} onChange={event => updateItemField(item.id, 'itemCount', event.target.value)} placeholder="مثلاً ۳"/></label>
              <label>وزن ترازو هر قطعه<NumberInput inputMode="decimal" value={item.meltedWeight} onChange={event => updateItemField(item.id, 'meltedWeight', event.target.value)} placeholder="گرم"/></label>
              <label>عیار خریداری<NumberInput inputMode="numeric" value={item.meltedAyar} onChange={event => updateItemField(item.id, 'meltedAyar', event.target.value)} placeholder="مثلاً ۷۸۰"/></label>
              <label>گرم معادل ۷۵۰<input value={formatDecimal(getMeltedWeight750(item))} readOnly/></label>
              <label className="wide">شماره انگ آبشده<input value={item.assayCode} onChange={event => updateItemField(item.id, 'assayCode', event.target.value)} placeholder="شماره انگ"/></label>
              <label className="wide">نام آزمایشگاه<input value={item.laboratoryName || ''} onChange={event => updateItemField(item.id, 'laboratoryName', event.target.value)} placeholder="نام آزمایشگاه ری‌گیری"/></label>
            </>}

            {category === 'currency' && <>
              <label>نوع ارز<select value={item.currencyType} onChange={event => updateItemField(item.id, 'currencyType', event.target.value)}>{currencyCatalog.map(currency => <option key={currency.code} value={currency.code}>{currency.name} ({currency.code})</option>)}</select></label>
              <label>قیمت لحظه‌ای هر واحد ارز (تومان)<NumberInput inputMode="decimal" value={item.currencyRate || ''} onChange={event => updateItemField(item.id, 'currencyRate', event.target.value)} placeholder={String(currencyRate(item.currencyType, openingPrices) || 'تومان')}/></label>
              <label>مقدار ارز<NumberInput inputMode="decimal" value={item.currencyAmount} onChange={event => updateItemField(item.id, 'currencyAmount', event.target.value)} placeholder="مثلاً ۱۰۰۰"/></label>
            </>}
            {!isSeparateSetForm(item) && <>{category !== 'currency' && <>
              {category !== 'crafted' && <label>اجرت درصدی<NumberInput inputMode="decimal" value={item.wagePercent} onChange={event => updateItemField(item.id, 'wagePercent', event.target.value)} placeholder="اختیاری"/></label>}
              <label>اجرت ثابت هر عدد / قطعه (تومان)<NumberInput inputMode="decimal" value={item.wageFixed} onChange={event => updateItemField(item.id, 'wageFixed', event.target.value)} placeholder="اختیاری"/></label>
            </>}
            <label>هزینه‌های دیگر هر واحد (تومان)<NumberInput inputMode="decimal" value={item.otherCosts} onChange={event => updateItemField(item.id, 'otherCosts', event.target.value)} placeholder="اختیاری"/></label>
            <label>سود درصدی{item.category === 'crafted' && ' (پیش‌فرض ۷٪)'}<NumberInput inputMode="decimal" value={item.profitPercent} onChange={event => updateItemField(item.id, 'profitPercent', event.target.value)} placeholder={item.category === 'crafted' ? 'خالی = ۷٪' : 'اختیاری'}/></label>
            </>}
            <label className="wide">یادداشت<input value={item.note} onChange={event => updateItemField(item.id, 'note', event.target.value)} placeholder="اختیاری"/></label>
          </div>
        </article>)}
      </div>
      <button className="button button-ghost opening-add-item" type="button" data-add-opening-item={category} onClick={() => addItem(category)}><Plus size={16}/> افزودن {label}</button>
    </section>;
  };

  return <section className="opening-page workspace-opening">
    <form className="opening-shell" onSubmit={submitOpeningInventory} aria-busy={saving}>
      <fieldset className="document-save-fields" disabled={saving || locked}>
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
            {marketPriceFields.map(([field, label]) => <label className="wide" key={field}>{label}<NumberInput name={field} inputMode="decimal" value={openingPrices[field] || ''} onChange={updatePriceField} placeholder="تومان"/></label>)}
            <p className="document-required-note">نرخ هر واحد به تومان؛ فقط نرخ دارایی‌های خود را وارد کنید.</p>
          </div>
        </aside>
      </div>

      </fieldset>
      <div className="opening-actions">
        <div className="opening-total">
          <span>ارزش فعلی موجودی اولیه</span>
          <strong>{formatNumber(previewValue)} <small>تومان</small></strong>
          <small>{formatNumber(previewDocuments.length)} ردیف جنس آماده ثبت</small>
        </div>
        {message && <div className={`form-message ${message.type}`} role={message.type === 'error' ? 'alert' : 'status'}>{message.text}</div>}
        {draftError && <p className="form-message error" role="alert">{draftError}</p>}
        <button className="button button-primary" type="submit" disabled={saving}><ReceiptText size={17}/> {saving ? 'در حال ذخیره در دیتابیس…' : locked ? 'تلاش دوباره برای ثبت' : 'ثبت موجودی اولیه'}</button>
      </div>
    </form>
  </section>
}

export default function AccountPage({ username, user, onLogout, notices, onSessionChanged, migrationNotice, onImported }) {
  const has = permission => can(user, permission);
  const canOpen = tool => canOpenTool(user, tool);
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
  const [partners, setPartners] = useState(() => loadUserRecords(PARTNERS_KEY, username));
  const [priceForm, setPriceForm] = useState(() => loadUserObject(PRICES_KEY, username, createDefaultPriceForm()));
  const [savedPrices, setSavedPrices] = useState(priceForm);
  const [activeTool, setActiveTool] = useState('home');
  const [settingsVisited, setSettingsVisited] = useState(false);
  const [selectedCrmId, setSelectedCrmId] = useState('');
  const notificationsRef = useRef(null);
  const activeSection = toolSections[activeTool] || 'home';
  const sectionTitle = key => workspaceSections[key];
  const initialDocumentDraft = useRef(readDocumentDraft(username, 'document'));
  const initialExpenseDraft = useRef(readDocumentDraft(username, 'expense'));
  const customerRequestId = useRef(initialDocumentDraft.current?.requestId || null);
  const expenseRequestId = useRef(initialExpenseDraft.current?.requestId || null);
  const documentDraftKind = activeTool === 'expense' ? 'expense' : 'document';
  const documentRequestId = documentDraftKind === 'expense' ? expenseRequestId : customerRequestId;
  const documentOperation = useRef(false);
  const [documentSaving, setDocumentSaving] = useState(false);
  const [documentLocks, setDocumentLocks] = useState(() => ({
    document: Boolean(customerRequestId.current && ownerStorage.status().recovery?.requestId === customerRequestId.current),
    expense: Boolean(expenseRequestId.current && ownerStorage.status().recovery?.requestId === expenseRequestId.current),
  }));
  const documentLocked = documentLocks[documentDraftKind];
  const setDocumentLocked = locked => setDocumentLocks(current => ({ ...current, [documentDraftKind]: locked }));
  const [draftError, setDraftError] = useState('');
  const [customerDocumentForm, setCustomerDocumentForm] = useState(() => ({ ...createEmptyDocumentForm(), gramPrice: priceForm.goldGramPrice, ...initialDocumentDraft.current?.form }));
  const [expenseDocumentForm, setExpenseDocumentForm] = useState(() => ({ ...createEmptyDocumentForm('expense'), ...initialExpenseDraft.current?.form }));
  const documentForm = documentDraftKind === 'expense' ? expenseDocumentForm : customerDocumentForm;
  const setDocumentForm = documentDraftKind === 'expense' ? setExpenseDocumentForm : setCustomerDocumentForm;
  const [partnerPurchaseType, setPartnerPurchaseType] = useState(() => {
    const saved = readAccountingDraft(username, 'document-entry-mode')?.form?.type;
    return partnerDocumentTypes.some(type => type.value === saved && type.category) ? saved : 'partner-crafted-purchase';
  });
  const partnerEntry = ['partner-invoice', 'partner-remittance'].includes(activeTool);
  const partnerEntryType = activeTool === 'partner-remittance' ? activeTool : partnerPurchaseType;
  const [searchTerm, setSearchTerm] = useState('');
  const [formMessage, setFormMessage] = useState(null);
  const [documentErrors, setDocumentErrors] = useState({});
  const [vaultSaleRequest, setVaultSaleRequest] = useState(null);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [documentAction, setDocumentAction] = useState(null);
  const [partnerDocumentAction, setPartnerDocumentAction] = useState(null);
  const [priceMessage, setPriceMessage] = useState(null);

  useEffect(() => {
    try {
      // Save a migrated expense before replacing its old shared draft slot.
      writeAccountingDraft(username, 'expense', expenseDocumentForm, expenseRequestId.current);
      writeAccountingDraft(username, 'document', customerDocumentForm, customerRequestId.current);
      setDraftError('');
    }
    catch { setDraftError('پیش‌نویس در مرورگر ذخیره نشد؛ تا تأیید ثبت در سرور، این صفحه را نبندید.'); }
  }, [username, customerDocumentForm, expenseDocumentForm]);
  useEffect(() => {
    try { writeAccountingDraft(username, 'document-entry-mode', { type: partnerPurchaseType }); }
    catch { setDraftError('نوع سند انتخاب‌شده در مرورگر ذخیره نشد.'); }
  }, [username, partnerPurchaseType]);

  const applyStockWorkspace = saved => {
    if (!saved) throw new Error('نشست تغییر کرده است؛ دوباره وارد حساب شوید.');
    setDocuments(assignProductCodes(saved.data.documents || []));
    if (saved.data.customers) setCustomers(saved.data.customers);
    if (saved.data.partners) setPartners(saved.data.partners);
    if (saved.data.prices) { setSavedPrices(saved.data.prices); setPriceForm(saved.data.prices); }
    if (saved.data.goldPurchases) setGoldPurchases(saved.data.goldPurchases);
    if (saved.data.cheques) setCheques(saved.data.cheques);
  };
  const mutateStockItem = async (identifier, changes) => {
    applyStockWorkspace(await ownerStorage.mutateInventory(identifier, changes));
  };
  const createStockItem = async (item, requestId) => {
    const saved = await ownerStorage.createInventory(item, requestId);
    applyStockWorkspace(saved);
    return saved.createdId;
  };
  const openDocumentAction = async (invoice, mode) => {
    try {
      await ownerStorage.flush();
      setSelectedInvoice(null);
      if (invoice.partnerEntryId) {
        setPartnerDocumentAction({ partnerId: invoice.partnerId, entryId: invoice.partnerEntryId, editing: mode === 'edit' });
        return;
      }
      const first = invoice.rows[0];
      const legacySet = !first.transactionId && first.setId ? documents.filter(row => !row.transactionId && row.setId === first.setId && row.type === first.type && String(row.customerId ?? '') === String(first.customerId ?? '') && row.customerName === first.customerName && row.date === first.date) : null;
      const editingInvoice = legacySet ? { ...invoice, rows: legacySet, amount: legacySet.reduce((sum, row) => sum + getDocumentAmount(row), 0), gramDebt: legacySet.reduce((sum, row) => sum + toNumber(row.gramDebt), 0), rialDebt: legacySet.reduce((sum, row) => sum + toNumber(row.rialDebt), 0) } : invoice;
      setDocumentAction({ invoice: editingInvoice, mode, revision: ownerStorage.status().revision });
    } catch (error) { setStorageMessage(error.message); }
  };
  const mutateSavedDocument = async (identifier, rows, requestId, revision) => {
    applyStockWorkspace(await ownerStorage.mutateDocument(identifier, rows, requestId, revision));
    setSelectedInvoice(null);
    setStorageMessage(rows === null ? 'سند حذف شد و حساب‌ها به‌روز شدند.' : 'تغییرات سند ذخیره شد و حساب‌ها به‌روز شدند.');
  };
  const canChangeDocument = invoice => has('documents.write') && canManageInvoice(invoice) && (invoice.rows[0].type === 'expense' || has('customers.write'));
  const canChangePartnerDocument = invoice => invoice.partnerEntryId && has('partners.write') && (invoice.partnerRemittance || has('documents.write'));
  const documentActions = invoice => canChangePartnerDocument(invoice) ? <div className="document-actions"><button type="button" className="button button-ghost" data-invoice-edit onClick={() => openDocumentAction(invoice, 'edit')}>ویرایش سند</button></div> : canChangeDocument(invoice) && <div className="document-actions"><button type="button" className="button button-ghost" data-invoice-edit onClick={() => openDocumentAction(invoice, 'edit')}>ویرایش سند</button><button type="button" className="button button-ghost document-delete-link" data-invoice-delete onClick={() => openDocumentAction(invoice, 'delete')}>حذف سند</button></div>;
  const performPartnerAction = async (action, identifier, payload, requestId) => {
    const saved = await ownerStorage.mutatePartner(action, identifier, payload, requestId);
    applyStockWorkspace(saved);
    return saved;
  };

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
      if (has('documents.write') && JSON.stringify(coded) !== JSON.stringify(stored)) saveUserRecords(DOCUMENTS_KEY, username, coded);
      setDocuments(coded);
    } catch { setStorageMessage('کدهای موجودی ذخیره نشدند؛ وضعیت اتصال به سرور را بررسی کنید.'); }
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
    const partnerDocument = partnerDocumentTypes.find(type => type.value === tool);
    if (!canOpen(partnerDocument && tool !== 'partner-remittance' ? 'partner-invoice' : tool)) { setStorageMessage('دسترسی این بخش برای حساب شما فعال نشده است.'); return false; }
    if (partnerDocument && tool !== 'partner-remittance') tool = 'partner-invoice';
    if (['register', 'expense', 'partner-invoice', 'partner-remittance'].includes(tool)) {
      const pendingKind = documentLocks.expense ? 'expense' : 'document';
      const savingKind = documentOperation.current ? documentOperation.current : pendingKind;
      const pendingTool = savingKind === 'expense' ? 'expense' : 'register';
      if ((documentSaving || documentOperation.current || documentLocks.document || documentLocks.expense) && tool !== pendingTool) {
        setStorageMessage(`ابتدا وضعیت ثبت ${pendingTool === 'expense' ? 'هزینه فروشگاه' : 'سند مشتری'} را مشخص کنید.`); return false;
      }
      if (tool !== activeTool) { setDocumentErrors({}); setFormMessage(null); }
    }
    if (partnerDocument?.category) setPartnerPurchaseType(partnerDocument.value);
    if (tool === 'crm' && !has('customers.read')) tool = 'partners';
    if (tool === 'settings') setSettingsVisited(true);
    setStorageMessage('');
    setActiveTool(tool); setMenuOpen(false); setSelectedChequeId('');
    if (tool !== 'crm') setSelectedCrmId('');
    if (notificationsRef.current) notificationsRef.current.open = false;
    window.scrollTo({ top: 0, behavior: 'instant' });
    return true;
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
  const miscMode = isMiscPurchase(documentForm);
  const separateSetMode = !miscMode && selectedDocumentType.category === 'crafted' && isSeparateSetForm(documentForm);
  const stockMatches = findStockMatches(stock.available, stockQuery).slice(0, 8);
  const documentPreview = { ...documentForm, category: selectedDocumentType.category, profitPercent: profitPercentInput(documentForm.profitPercent, selectedDocumentType.category, documentForm), ...(separateSetMode ? { gramPrice: savedPrices.goldGramPrice } : {}) };
  const invoiceRows = documentForm.invoiceRows || [];
  const previewRows = expenseMode ? [documentPreview] : expandInvoiceDraft(documentForm, savedPrices.goldGramPrice);
  const previewAmount = previewRows.reduce((sum, row) => sum + (saleMode ? settlementRowAmount(row) : getDocumentAmount(row)), 0);
  const paymentStep = saleMode && Boolean(documentForm.invoicePaymentStep);
  const paymentPreview = invoiceSettlement(previewRows, documentForm.cashPaid, documentForm.gold18Price ?? savedPrices.goldGramPrice ?? '');
  const latestDocuments = groupInvoices(documents.filter(document => expenseMode ? document.type === 'expense' : isTradeDocument(document) && !document.partnerId)).slice(0, 5);
  const assets = assetReport(stock, savedPrices);
  const liveInventoryValue = assetReport(stock, priceForm).totalToman;
  const normalizedSearch = searchTerm.trim().toLocaleLowerCase('fa-IR');
  const searchableDocuments = partnerDocumentRows(documents, partners);
  const filteredDocuments = searchableDocuments.filter(document => {
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
      document.invoiceNumber,
    ].some(value => String(value || '').toLocaleLowerCase('fa-IR').includes(normalizedSearch));
  });
  const matchingInvoiceIds = new Set(filteredDocuments.map(row => String(row.transactionId || row.id)));
  const filteredInvoices = groupInvoices(searchableDocuments).filter(invoice => matchingInvoiceIds.has(invoice.id));
  const editingPartner = partners.find(partner => partner.id === partnerDocumentAction?.partnerId);
  const editingPartnerEntry = editingPartner?.entries?.find(entry => entry.id === partnerDocumentAction?.entryId);

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

  const newInvoiceEditor = (current, type = current.type) => ({
    ...createEmptyDocumentForm(type), ...invoiceHeader(current),
    customerId: type === 'expense' ? '' : current.customerId, customerName: type === 'expense' ? '' : current.customerName,
    invoiceRows: current.invoiceRows || [], invoiceEditingIndex: current.invoiceEditingIndex ?? -1,
    gramPrice: savedPrices.goldGramPrice, meltedGramPrice: savedPrices.goldGramPrice,
    currencyRate: String(currencyRate('USD', savedPrices) || ''), coinPrice: String(getCoinPrice('امامی بانکی ۸۶', savedPrices) || ''),
  });

  const validateInvoiceLine = (form, ledger) => {
    const line = invoiceLinePreview(form, savedPrices.goldGramPrice);
    if (isStockSale(line)) { line.gramDebt = 0; line.rialDebt = 0; }
    const separate = isSeparateSetForm(line);
    const errors = separate ? validateSetForm(line, ledger) : validateDocument(line, line.category, toNumber);
    const count = stockQuantity(line);
    if (!separate && line.category !== 'currency' && (!Number.isSafeInteger(count) || count <= 0)) errors[line.category === 'coin' ? 'coinCount' : 'itemCount'] = 'تعداد باید عدد صحیح بیشتر از صفر باشد.';
    if (isStockSale(line) && !separate) {
      const stockError = validateStockSale(line, ledger);
      if (stockError) errors.productCode = stockError;
    }
    return errors;
  };

  const showInvoiceErrors = errors => {
    if (Object.keys(errors).some(key => key !== 'cashPaid')) setDocumentForm(current => ({ ...current, invoicePaymentStep: false }));
    setDocumentErrors(errors); setFormMessage({ type: 'error', text: Object.values(errors)[0] });
    requestAnimationFrame(() => document.querySelector('.document-form [aria-invalid="true"]')?.focus());
  };

  const addInvoiceRow = () => {
    if (documentSaving || documentLocked) return;
    const errors = validateInvoiceLine(documentForm, documents);
    if (Object.keys(errors).length) { showInvoiceErrors(errors); return; }
    const lines = invoiceLineForms({ ...documentForm, invoiceCurrentEmpty: false });
    const expanded = expandInvoiceDraft({ ...documentForm, invoiceCurrentEmpty: false }, savedPrices.goldGramPrice);
    if (lines.length > 50 || expanded.length > 100) { showInvoiceErrors({ invoiceRows: 'حداکثر ۵۰ جنس و ۱۰۰ ردیف در هر سند قابل ثبت است.' }); return; }
    if (saleMode) {
      const error = validateStockSales(expanded, documents);
      if (error) { showInvoiceErrors({ productCode: error }); return; }
    }
    setDocumentForm(current => ({ ...newInvoiceEditor(current), invoiceRows: lines.map(cleanInvoiceLine), invoiceEditingIndex: -1 }));
    setStockQuery(''); setDocumentErrors({});
    setFormMessage({ type: 'info', text: 'ردیف به پیش‌نویس سند اضافه شد. جنس بعدی را انتخاب کنید یا «ثبت سند» را بزنید.' });
  };

  const editInvoiceRow = index => {
    if (!documentForm.invoiceCurrentEmpty) { setFormMessage({ type: 'error', text: 'ابتدا ورودی فعلی را به سند اضافه کنید یا پاک کنید، سپس ردیف دیگری را ویرایش کنید.' }); return; }
    setDocumentForm(current => ({ ...createEmptyDocumentForm(invoiceRows[index].type), ...invoiceRows[index], ...invoiceHeader(current), invoiceRows: current.invoiceRows, invoiceEditingIndex: index, invoiceCurrentEmpty: false }));
    setStockQuery(invoiceRows[index].productCode || ''); setDocumentErrors({}); setFormMessage(null);
  };

  const clearInvoiceEditor = () => {
    setDocumentForm(current => ({ ...newInvoiceEditor(current), invoiceEditingIndex: -1 }));
    setStockQuery(''); setDocumentErrors({}); setFormMessage(null);
  };

  const removeInvoiceRow = index => {
    setDocumentForm(current => ({ ...(current.invoiceEditingIndex === index ? newInvoiceEditor(current) : current),
      invoiceRows: current.invoiceRows.filter((_, position) => position !== index),
      invoiceEditingIndex: current.invoiceEditingIndex === index ? -1 : current.invoiceEditingIndex > index ? current.invoiceEditingIndex - 1 : current.invoiceEditingIndex,
    }));
    if (documentForm.invoiceEditingIndex === index) setStockQuery('');
    setDocumentErrors({}); setFormMessage(null);
  };

  const chooseStock = item => {
    if (documentSaving || documentLocked || documentOperation.current) { setStorageMessage('ثبت سند در حال تأیید است؛ ابتدا وضعیت ذخیره را مشخص کنید.'); return; }
    if (invoiceRows.length && !String(invoiceRows[0].type).endsWith('-sale')) { setFormMessage({ type: 'error', text: 'این سند برای خرید است؛ فروش را در یک سند جدا ثبت کنید.' }); return; }
    setDocumentForm(current => ({ ...stockSaleForm(item, current, savedPrices), invoiceCurrentEmpty: false, invoicePaymentStep: false }));
    setStockQuery(item.productCode);
    setDocumentErrors({}); setFormMessage(null);
  };
  const setSaleForm = (available, current) => {
    const first = available[0];
    return {
      ...createEmptyDocumentForm('crafted-sale'), ...invoiceHeader(current), description: current.description,
      invoiceRows: current.invoiceRows, invoiceEditingIndex: current.invoiceEditingIndex, invoiceCurrentEmpty: false,
      craftedKind: first.setKind, itemName: first.setName || first.setKind, setMode: 'separate', setId: first.setId,
      setParts: available.map(item => ({ ...stockSaleForm(item, createEmptyDocumentForm('crafted-sale'), savedPrices), id: item.id, remaining: item.remaining, selected: true })),
    };
  };
  const chooseSet = items => {
    if (documentSaving || documentLocked || documentOperation.current) { setStorageMessage('ثبت سند در حال تأیید است؛ ابتدا وضعیت ذخیره را مشخص کنید.'); return; }
    if (invoiceRows.length && !String(invoiceRows[0].type).endsWith('-sale')) { setFormMessage({ type: 'error', text: 'این سند برای خرید است؛ فروش را در یک سند جدا ثبت کنید.' }); return; }
    const available = items.filter(item => item.remaining > 0);
    if (!available.length) return;
    setDocumentForm(current => setSaleForm(available, current));
    setStockQuery(''); setDocumentErrors({}); setFormMessage(null);
  };
  const continueVaultSale = request => {
    setVaultSaleRequest(request);
    if (!openTool('register')) return;
    if (documentSaving || documentLocked || documentOperation.current) {
      setStorageMessage('ثبت سند در حال تأیید است؛ پس از مشخص شدن وضعیت ذخیره، فروش جنس انتخاب‌شده را ادامه دهید.');
      return;
    }
    const requestedIds = new Set(request.items.map(item => item.id));
    const available = stock.available.filter(item => requestedIds.has(item.id));
    if (!available.length) {
      setVaultSaleRequest(null);
      setFormMessage({ type: 'error', text: 'جنس انتخاب‌شده دیگر در صندوق موجود نیست؛ موجودی صندوق را بررسی کنید.' });
      return;
    }
    if (invoiceRows.some(row => !String(row.type).endsWith('-sale')) || (!documentForm.invoiceCurrentEmpty && !saleMode)) {
      setFormMessage({ type: 'info', text: 'پیش‌نویس خرید محفوظ است. ابتدا آن را ثبت یا پاک کنید، سپس فروش جنس انتخاب‌شده را ادامه دهید.' });
      return;
    }
    const currentIds = separateSetMode
      ? documentForm.setParts.filter(part => part.selected !== false).map(part => part.inventorySourceId)
      : [documentForm.inventorySourceId];
    if (!documentForm.invoiceCurrentEmpty && currentIds.length === available.length && available.every(item => currentIds.includes(item.id))) {
      setVaultSaleRequest(null);
      setFormMessage({ type: 'info', text: 'فرم فروش همین جنس باز است؛ تغییرات قبلی آن حفظ شده است.' });
      return;
    }
    let prepared = documentForm;
    let stagedCurrent = false;
    if (!documentForm.invoiceCurrentEmpty) {
      const errors = validateInvoiceLine(documentForm, documents);
      if (Object.keys(errors).length) {
        showInvoiceErrors(errors);
        setFormMessage({ type: 'error', text: `ورودی قبلی حفظ شد. ابتدا آن را کامل یا پاک کنید و سپس فروش جنس انتخاب‌شده را ادامه دهید. ${Object.values(errors)[0]}` });
        return;
      }
      const rows = invoiceLineForms({ ...documentForm, invoiceCurrentEmpty: false });
      prepared = { ...newInvoiceEditor(documentForm), invoiceRows: rows.map(cleanInvoiceLine), invoiceEditingIndex: -1 };
      stagedCurrent = true;
    }
    const next = request.kind === 'set'
      ? setSaleForm(available, prepared)
      : { ...stockSaleForm(available[0], prepared, savedPrices), invoiceCurrentEmpty: false };
    const expanded = expandInvoiceDraft(next, savedPrices.goldGramPrice);
    if (invoiceLineForms(next).length > 50 || expanded.length > 100) {
      setFormMessage({ type: 'error', text: 'ظرفیت این سند تکمیل است؛ ابتدا آن را ثبت کنید و فروش جنس انتخاب‌شده را در سند بعدی ادامه دهید.' });
      return;
    }
    const stockError = validateStockSales(expanded, documents);
    if (stockError) {
      setFormMessage({ type: 'error', text: `ورودی قبلی حفظ شد. ${stockError} ردیف‌های سند را بررسی کنید و دوباره ادامه دهید.` });
      return;
    }
    if (stagedCurrent) setDocumentForm(prepared);
    if (request.kind === 'set') chooseSet(available); else chooseStock(available[0]);
    setVaultSaleRequest(null);
    if (stagedCurrent) setFormMessage({ type: 'info', text: 'جنس قبلی به ردیف‌های همین سند اضافه شد و مشخصات جنس انتخاب‌شده از صندوق آمادهٔ فروش است.' });
  };
  const sellStock = item => continueVaultSale({ kind: 'item', items: [item], name: item.itemName || item.productCode });
  const sellSet = items => continueVaultSale({ kind: 'set', items, name: items[0]?.setName || items[0]?.setKind || 'قطعه‌های مجموعه' });
  const findStock = event => {
    const value = event.target.value;
    setStockQuery(value);
    const match = stock.available.find(item => normalizeProductCode(item.productCode) === normalizeProductCode(value));
    if (match) { chooseStock(match); return; }
    setDocumentForm(current => ({ ...newInvoiceEditor(current), invoiceCurrentEmpty: !value.trim() }));
    setDocumentErrors({}); setFormMessage(null);
  };

  const findStockName = value => {
    if (documentSaving || documentLocked || documentOperation.current) return true;
    const match = exactStockName(stock.available, value);
    if (match) { chooseStock(match); return true; }
    // Editing a selected name starts a new selection; old weight, code and
    // charges must not stay attached to a different (or ambiguous) name.
    if (selectedStock && !String(selectedStock.itemName || '').trim()) {
      setDocumentForm(current => ({ ...current, itemName: value, invoiceCurrentEmpty: false }));
    } else {
      setStockQuery('');
      setDocumentForm(current => ({ ...(current.inventorySourceId ? newInvoiceEditor(current) : current), itemName: value,
        invoiceCurrentEmpty: current.inventorySourceId ? !value.trim() : current.invoiceCurrentEmpty && !value.trim() }));
    }
    setDocumentErrors({}); setFormMessage(null);
    return false;
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
      if (existing.name !== record.name && !has('documents.write')) throw new Error('برای تغییر نام مشتری و اصلاح اسناد مرتبط، اجازهٔ ویرایش اسناد هم لازم است.');
      // Attach older name-only documents before a name changes.
      if (has('documents.write')) persistDocuments(documents.map(doc => (doc.customerId === existing.id || (!doc.customerId && doc.source !== 'opening-inventory' && doc.customerName?.trim() === existing.name.trim())) ? { ...doc, customerId: record.id, customerName: record.name } : doc));
      persistCustomers(customers.map(customer => customer.id === record.id ? record : customer));
    } else {
      persistCustomers([record, ...customers]);
    }
  };

  const updateFormWithMarketPrice = (form, fieldName, fieldValue) => {
    const nextForm = { ...form, [fieldName]: fieldValue, ...(!invoiceHeaderFields.includes(fieldName) ? { invoiceCurrentEmpty: false } : {}) };
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
    if (name === 'cashPaid') {
      setDocumentForm(current => ({ ...current, cashPaid: value }));
      setDocumentErrors(current => ({ ...current, cashPaid: '' })); setFormMessage(null); return;
    }
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
      if (invoiceRows.length && !documentForm.invoiceCurrentEmpty) { setFormMessage({ type: 'error', text: 'ابتدا ورودی فعلی را به سند اضافه کنید یا پاک کنید، سپس نوع جنس بعدی را انتخاب کنید.' }); return; }
      if (invoiceRows.length && getDocumentType(value).direction !== getDocumentType(invoiceRows[0].type).direction) { setFormMessage({ type: 'error', text: 'ردیف‌های یک سند باید همگی خرید یا همگی فروش باشند.' }); return; }
      setDocumentForm(current => newInvoiceEditor(current, value));
      setStockQuery(''); setFormMessage(null); return;
    }
    if (name === 'setMode') {
      setDocumentForm(current => ({ ...current, invoiceCurrentEmpty: false, setMode: value, setParts: value === 'separate' && !current.setParts.length ? [createSetPart({ gramPrice: savedPrices.goldGramPrice }), createSetPart({ gramPrice: savedPrices.goldGramPrice })] : current.setParts }));
      setDocumentErrors({}); setFormMessage(null); return;
    }
    if (saleMode && selectedStock && stockIdentityFields.includes(name) && String(selectedStock[name] || '').trim() && (name !== 'craftedKind' || craftedKinds.includes(selectedStock.craftedKind))) return;
    setDocumentForm(currentForm => updateFormWithMarketPrice(currentForm, name, value));
    setFormMessage(null);
  };

  const chooseDocumentEntryType = event => {
    const value = event.target.value;
    if (documentSaving || documentLocked || documentOperation.current) return;
    if (partnerEntry) {
      if (!partnerDocumentTypes.some(type => type.value === value)) return;
      if (!canOpen(value === 'partner-remittance' ? 'partner-remittance' : 'partner-invoice')) return;
      if (value !== 'partner-remittance') setPartnerPurchaseType(value);
      setActiveTool(value === 'partner-remittance' ? value : 'partner-invoice');
      setFormMessage(null); setStorageMessage('');
      return;
    }
    if (activeTool !== 'register' || !has('customers.write') || !documentTypes.some(type => type.value === value && type.value !== 'expense')) return;
    if (value !== documentForm.type) updateDocumentField(event);
  };
  const availableDocumentTypes = partnerEntry
    ? partnerDocumentTypes.filter(type => canOpen(type.value === 'partner-remittance' ? 'partner-remittance' : 'partner-invoice'))
    : documentTypes.filter(type => expenseMode ? type.value === 'expense' : type.value !== 'expense');
  const documentTypeSelector = <label className="document-type-select">{partnerEntry ? 'نوع سند همکار' : expenseMode ? 'نوع سند فروشگاه' : 'نوع سند مشتری'}<select data-document-type name="type" value={partnerEntry ? partnerEntryType : documentForm.type} disabled={documentSaving || documentLocked} onChange={chooseDocumentEntryType}>
    {availableDocumentTypes.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
  </select></label>;

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
      ...(documentRecord.settlementVersion === 1 ? {
        settlementVersion: 1, cashPaid: documentRecord.cashPaid,
        settlementGoldPrice: documentRecord.settlementGoldPrice,
        settlementRemainder: documentRecord.settlementRemainder,
        gramDebt: documentRecord.gramDebt, rialDebt: 0,
      } : {}),
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

  const confirmDocument = async (changes, successMessage, resetType = 'crafted-sale') => {
    if (documentOperation.current) return;
    documentOperation.current = documentDraftKind; setDocumentSaving(true); setFormMessage(null);
    const requestId = documentRequestId.current || crypto.randomUUID();
    documentRequestId.current = requestId;
    try {
      writeAccountingDraft(username, documentDraftKind, documentForm, requestId);
      const saved = await ownerStorage.commit(changes, requestId);
      applyStockWorkspace(saved);
      clearCommittedDraft(username, requestId);
      documentRequestId.current = null; setDocumentLocked(false);
      setDocumentForm({ ...createEmptyDocumentForm(resetType), gramPrice: savedPrices.goldGramPrice });
      setStockQuery('');
      const transactionId = changes.documents?.find(row => row.invoiceVersion === 1 && !documents.some(previous => previous.id === row.id))?.transactionId;
      const invoice = transactionId && groupInvoices(saved.data.documents || []).find(item => item.id === transactionId);
      if (invoice?.settlementVersion === 1) setSelectedInvoice(invoice);
      setFormMessage({ type: 'success', text: invoice ? `سند شمارهٔ ${formatNumber(invoice.number)} با ${formatNumber(invoice.rows.length)} ردیف ثبت شد؛ موجودی و حساب مشتری به‌روز شد.` : successMessage });
    } catch (error) {
      setDocumentLocked(ownerStorage.status().recovery?.requestId === requestId);
      setFormMessage({ type: 'error', text: `ثبت هنوز تأیید نشده و اطلاعات فرم محفوظ است. ${error.message || 'دوباره تلاش کنید.'}` });
    } finally { documentOperation.current = false; setDocumentSaving(false); }
  };

  const submitDocument = async event => {
    event.preventDefault();
    if (documentOperation.current) return;
    const recovery = ownerStorage.status().recovery;
    if (documentRequestId.current && recovery?.requestId === documentRequestId.current) {
      await confirmDocument(recovery.changes, 'سند و تغییرات مرتبط در سرور ذخیره و تأیید شد.', documentForm.type === 'expense' ? 'expense' : 'crafted-sale');
      return;
    }
    if (recovery) { setFormMessage({ type: 'error', text: 'ابتدا ثبت قبلی را با گزینهٔ تلاش دوباره تأیید کنید.' }); return; }
    if (!has('documents.write') || (!expenseMode && !has('customers.write'))) {
      setFormMessage({ type: 'error', text: 'برای ثبت خرید و فروش اجازهٔ ویرایش اسناد و مشتریان لازم است.' }); return;
    }
    const cleanCustomerName = documentForm.customerName.trim();
    const documentWithCategory = { ...documentForm, category: selectedDocumentType.category, profitPercent: profitPercentInput(documentForm.profitPercent, selectedDocumentType.category, documentForm), gold18Price: documentForm.gold18Price ?? savedPrices.goldGramPrice ?? '', ...(separateSetMode ? { gramPrice: savedPrices.goldGramPrice } : {}) };

    const forms = expenseMode ? [] : invoiceLineForms(documentForm);
    if (expenseMode) {
      const errors = validateDocument(documentWithCategory, 'expense', toNumber);
      if (Object.keys(errors).length) { showInvoiceErrors(errors); return; }
    } else {
      for (let index = 0; index < forms.length; index++) {
        const errors = validateInvoiceLine(forms[index], documents);
        if (Object.keys(errors).length) {
          if (invoiceRows.length) {
            setDocumentForm(current => ({ ...createEmptyDocumentForm(forms[index].type), ...forms[index], ...invoiceHeader(current), invoiceRows: forms.map(cleanInvoiceLine), invoiceEditingIndex: index, invoiceCurrentEmpty: false }));
            setStockQuery(forms[index].productCode || '');
          }
          showInvoiceErrors(errors); return;
        }
      }
      if (new Set(forms.map(line => getDocumentType(line.type).direction)).size !== 1) { showInvoiceErrors({ invoiceRows: 'ردیف‌های سند باید همگی خرید یا همگی فروش باشند.' }); return; }
    }
    setDocumentErrors({});

    const recordedAt = newRecordTimestamp();
    if (expenseMode) {
      const expense = {
        ...normalizeExpense(documentForm),
        id: `document-${crypto.randomUUID()}`, type: 'expense', category: 'expense', direction: 'هزینه', typeLabel: 'هزینه فروشگاه',
        date: documentForm.date, description: documentForm.description.trim(), note: documentForm.note.trim(),
        expensePayee: documentForm.expensePayee.trim(), itemSummary: documentForm.description.trim(),
        customerName: '', customerId: '', gramDebt: 0, rialDebt: 0, createdAt: recordedAt, recordedAt,
      };
      try { await confirmDocument({ documents: assignProductCodes([expense, ...currentDocuments()]) }, 'هزینه ثبت شد و در گزارش سود همین تاریخ محاسبه می‌شود.', 'expense'); }
      catch (error) { setFormMessage({ type: 'error', text: error.message || 'هزینه ذخیره نشد؛ دوباره تلاش کنید.' }); return; }
      return;
    }

    const customerId = documentForm.customerId || customers.find(customer => customer.name.trim() === cleanCustomerName)?.id || `customer-${crypto.randomUUID()}`;
    const transactionId = crypto.randomUUID();
    const rows = expandInvoiceDraft(documentForm, savedPrices.goldGramPrice, transactionId);
    if (forms.length > 50 || rows.length > 100) { showInvoiceErrors({ invoiceRows: 'حداکثر ۵۰ جنس و ۱۰۰ ردیف در هر سند قابل ثبت است.' }); return; }
    const payment = saleMode ? invoiceSettlement(rows, documentForm.cashPaid, documentForm.gold18Price ?? savedPrices.goldGramPrice ?? '') : null;
    if (saleMode) {
      const stockError = validateStockSales(rows, documents);
      if (stockError) { setDocumentForm(current => ({ ...current, invoicePaymentStep: false })); showInvoiceErrors({ productCode: stockError }); return; }
      if (!paymentStep) {
        const { cashPaid: ignored, ...errors } = payment.errors;
        if (Object.keys(errors).length) { showInvoiceErrors(errors); return; }
        setDocumentForm(current => ({ ...current, invoicePaymentStep: true, gold18Price: String(payment.settlementGoldPrice) }));
        setFormMessage(null);
        requestAnimationFrame(() => document.querySelector('[data-invoice-payment-step] input[name="cashPaid"]')?.focus());
        return;
      }
      if (Object.keys(payment.errors).length) { showInvoiceErrors(payment.errors); return; }
    }
    const documentRecords = rows.map((row, index) => {
      const rowType = getDocumentType(row.type);
      return {
        ...row, invoiceVersion: 1, invoiceLine: index + 1, invoiceLineCount: rows.length,
        itemName: String(row.itemName || '').trim(),
        profitPercent: String(toNumber(row.profitPercent)), id: `document-${crypto.randomUUID()}`,
        laboratoryName: rowType.category === 'melted' ? String(row.laboratoryName || '').trim() : '',
        customerName: cleanCustomerName, customerId,
        typeLabel: rowType.label, category: rowType.category, direction: rowType.direction,
        amount: payment ? payment.amounts[index] : getDocumentAmount(row), gold18Price: toNumber(row.gold18Price),
        itemWeight: getDocumentWeight(row), itemSummary: describeDocumentItem(row),
        gramDebt: index === 0 ? (payment ? payment.gramDebt : toNumber(documentForm.gramDebt)) : 0,
        rialDebt: index === 0 && !payment ? toNumber(documentForm.rialDebt) : 0,
        ...(payment && index === 0 ? {
          settlementVersion: 1, cashPaid: payment.cashPaid,
          settlementGoldPrice: payment.settlementGoldPrice, settlementRemainder: payment.settlementRemainder,
        } : {}),
        createdAt: recordedAt, recordedAt,
      };
    });

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
      const savedRecord = saved.find(item => item.id === documentRecords[0].id);
      await confirmDocument({ documents: saved, customers: nextCustomers }, `سند ثبت شد؛ ${saleMode ? 'موجودی قطعه‌های فروخته‌شده کم شد' : separateSetMode ? `${formatNumber(documentRecords.length)} قطعه با کدهای مستقل به مجموعه اضافه شد` : `جنس با کد ${savedRecord.productCode} وارد صندوق شد`}.`);
    } catch (error) { setFormMessage({ type: 'error', text: error.message || 'سند ذخیره نشد؛ دوباره تلاش کنید.' }); return; }
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

  const completeOpeningInventory = async ({ documents: openingDocuments, prices: openingPrices, totalValue }, requestId) => {
    const latest = currentDocuments();
    const recovery = ownerStorage.status().recovery;
    const changes = recovery?.requestId === requestId ? recovery.changes : {
      documents: assignProductCodes([...openingDocuments, ...latest]),
      prices: { ...openingPrices, updatedAt: new Date().toISOString() },
      openingSetup: { completed: true, completedAt: new Date().toISOString(), skipped: false, documentCount: openingDocuments.length, totalValue },
    };
    applyStockWorkspace(await ownerStorage.commit(changes, requestId));
  };

  return <section className="account-page container workspace-page">
    {isMobile && menuOpen && <button className="workspace-menu-overlay" aria-label="بستن منو" onClick={() => setMenuOpen(false)} tabIndex={-1}/>}
    <aside id="workspace-navigation" ref={navigationRef} className={`workspace-rail ${menuOpen ? 'is-open' : ''}`} aria-label="منوی حسابداری" aria-hidden={isMobile && !menuOpen ? true : undefined} inert={isMobile && !menuOpen ? true : undefined}>
      <button className="workspace-menu-close" onClick={() => setMenuOpen(false)} aria-label="بستن منو"><X size={20}/> بستن منو</button>
      <div className="workspace-brand"><span className="brand-mark">ز</span><strong>حسابداری زرنگار</strong><small>دفتر خصوصی طلا و جواهر</small></div>
      <span className="workspace-nav-label">فضای کار</span>
      {[[ 'home', LayoutDashboard ], [ 'entries', ReceiptText ], [ 'reports', BarChart3 ], [ 'crm', Users ], [ 'settings', Settings ]].filter(([key]) => canOpen(key)).map(([key, Icon]) => <button key={key} data-section={key} title={sectionTitle(key)} className={activeSection === key ? 'active' : ''} aria-current={activeSection === key ? 'page' : undefined} onClick={() => { setSelectedCrmId(''); openTool(key); }}><Icon size={21}/><span>{sectionTitle(key)}</span>{activeSection === key && <ChevronLeft size={14}/>}</button>)}
      <div className="workspace-rail-foot"><span className="workspace-avatar"><UserRound size={20}/></span><div><strong><bdi>{username}</bdi></strong><small>{user.role === 'owner' ? 'مالک دفتر حسابداری' : 'کارمند دفتر حسابداری'}</small></div><button onClick={onLogout} title="خروج از حساب" aria-label="خروج از حساب"><LogOut size={17}/></button></div>
    </aside>
    <div className="workspace-content" inert={isMobile && menuOpen ? true : undefined}>
      <div className="workspace-topbar"><div><button ref={menuButtonRef} className="workspace-menu-toggle" aria-label="باز کردن منو" aria-expanded={menuOpen} aria-controls="workspace-navigation" onClick={() => setMenuOpen(true)}><Menu size={22}/></button><span className="workspace-top-icon"><Gem size={20}/></span><span>حسابداری زرنگار <ChevronLeft size={13}/> <strong>{sectionTitle(activeSection)}</strong></span></div>{(canOpen('crm-occasions') || canOpen('cheque-reports')) && <details ref={notificationsRef} className="workspace-notifications"><summary aria-label={'اعلان‌ها؛ ' + formatNumber(chequeReminders.total + birthdays.length) + ' یادآوری'}><Bell size={19}/>{chequeReminders.total + birthdays.length > 0 && <b>{formatNumber(chequeReminders.total + birthdays.length)}</b>}</summary><div><strong>یادآوری‌های شما</strong><button hidden={!canOpen('crm-occasions')} onClick={() => openTool('crm-occasions')}>تولدهای امروز و ۷ روز آینده <b>{formatNumber(birthdays.length)}</b></button><button hidden={!canOpen('cheque-reports')} onClick={() => openTool('cheque-reports')}>چک‌های نیازمند پیگیری <b>{formatNumber(chequeReminders.total)}</b></button></div></details>}</div>
      {notices}
      {!['home', 'entries', 'reports', 'crm', 'crm-occasions', 'settings'].includes(activeTool) && <div className="workspace-subheading"><button onClick={() => openTool(activeSection)}><ChevronLeft size={17}/> {workspaceSections[activeSection]}</button><span>{toolTitle}</span></div>}
      {storageMessage && <p role="alert" className="form-message error">{storageMessage}</p>}
      {user.role === 'owner' && <div hidden={activeTool !== 'opening'}><OpeningInventoryPage username={username} prices={savedPrices} onComplete={completeOpeningInventory}/></div>}
      {settingsVisited && <div hidden={activeTool !== 'settings'}><StoreSettings user={user} onSessionChanged={onSessionChanged} migrationNotice={migrationNotice} onImported={onImported}/></div>}
      {activeSection === 'crm' && <nav className="section-tabs" aria-label="گروه طرف حساب">{has('customers.read') && <button type="button" data-crm-group="customers" aria-pressed={!['partners', 'partner-invoice'].includes(activeTool)} onClick={() => openTool('crm')}>مشتریان</button>}{has('partners.read') && <button type="button" data-crm-group="partners" aria-pressed={['partners', 'partner-invoice'].includes(activeTool)} onClick={() => openTool('partners')}>همکاران تجاری</button>}</nav>}
      {activeTool === 'settings' ? null : activeTool === 'partners' ? <PartnerCRM key={activeTool} username={username} partners={partners} documents={documents} prices={savedPrices} onAction={performPartnerAction} readOnly={!has('partners.write')} canPurchase={has('partners.write') && has('documents.write')} initialAction={activeTool === 'partner-invoice' ? 'invoice' : ''}/> : activeTool === 'home' && user.role !== 'owner' ? <div><p className="form-message">{username}</p>{canOpen('entries') && <ToolHub kind="entries" onOpen={openTool} canOpen={canOpen}/>}<ToolHub kind="reports" onOpen={openTool} canOpen={canOpen}/></div> : activeTool === 'home' ? <HomePage username={username} documents={documents} prices={savedPrices} assets={assets} customers={customers} cheques={cheques} today={today} helpers={{ quantity: getDocumentQuantity, weight: getDocumentWeight, amount: getDocumentAmount }} onOpen={openTool}/> : ['entries','reports'].includes(activeTool) ? <ToolHub kind={activeTool} onOpen={openTool} canOpen={canOpen}/> : ['dashboard','products','balance','gold-entry'].includes(activeTool) ? <SalesDashboard key={activeTool} view={{ dashboard:'sales', products:'products', balance:'balance', 'gold-entry':'gold-entry' }[activeTool]} onOpen={openTool} username={username} documents={documents} prices={savedPrices} goldPurchases={goldPurchases} onSaveGoldPurchases={has('goldPurchases.write') ? persistGoldPurchases : undefined} helpers={{ quantity: getDocumentQuantity, weight: getDocumentWeight, amount: getDocumentAmount, number: toNumber }}/> : activeTool === 'profit' ? <ProfitPage documents={documents} today={today} onOpen={openTool} canOpen={canOpen}/> : activeTool === 'rates' ? <RatesPage prices={savedPrices} onOpen={has('prices.write') ? openTool : undefined}/> : activeTool === 'customer-reports' ? <CustomerReports customers={customers} documents={documents} today={today} onSelect={openCustomer}/> : activeTool === 'cheque-reports' ? <ChequeReportPage cheques={cheques} today={today} onEdit={has('cheques.write') ? openCheque : undefined}/> : activeTool === 'opening' ? null : activeTool === 'vault' ? <><InventoryVault report={stock} assets={assets} prices={savedPrices} onCreateItem={has('documents.write') ? createStockItem : undefined} onEditItem={has('documents.write') ? (id, changes) => mutateStockItem(id, changes) : undefined} onDeleteItem={has('documents.write') ? id => mutateStockItem(id, null) : undefined} canEditPurchases={has('customers.write')} onPrices={has('prices.write') ? () => openTool('pricing') : undefined} onSell={canOpen('register') ? sellStock : undefined} onSellSet={canOpen('register') ? sellSet : undefined} onReceive={canOpen('register') ? () => { if (openTool('register')) updateDocumentField({ target: { name: 'type', value: 'crafted-purchase' } }); } : undefined} onLinkSale={has('documents.write') ? (saleId, sourceId) => persistDocuments(linkHistoricalSale(currentDocuments(), saleId, sourceId)) : undefined}/></> : activeTool === 'cheques' ? <ChequeManager key={selectedChequeId} cheques={cheques} customers={customers} onSave={persistCheques} parseNumber={toNumber} today={today} initialChequeId={selectedChequeId}/> : ['crm','crm-occasions','customer-entry','settlement-entry'].includes(activeTool) ? <div className="workspace-tools crm-section-page"><CustomerCRM key={activeTool + selectedCrmId} customers={customers} documents={documents} onSave={saveCustomerProfile} readOnly={!has('customers.write')} parseNumber={toNumber} today={today} initialSelectedId={selectedCrmId} initialView={activeTool === 'crm-occasions' ? 'occasions' : 'customers'} initialAction={activeTool === 'customer-entry' ? 'new' : activeTool === 'settlement-entry' ? 'settlement' : ''}/></div> : <div className="workspace-tools">
        <div className="account-main-panel">
          <div className="panel-heading"><div><span>{({ register: 'ثبت سند مشتری', expense: 'ثبت هزینه فروشگاه', 'partner-invoice': 'ثبت سند همکار', 'partner-remittance': 'حواله همکار', search: 'جستجو در سندها', cheques: 'مدیریت چک‌ها', pricing: 'ثبت نرخ طلا، سکه و ارز', crm: 'پرونده مشتریان' })[activeTool]}</span></div></div>
          <div className="ledger-panel">
            {activeTool === 'pricing' && <form className="price-form" onSubmit={submitPrices}>
              {priceMessage && <div className={`form-message ${priceMessage.type}`}>{priceMessage.text}</div>}
              <div className="form-grid price-grid">
                {marketPriceFields.map(([field, label]) => <label key={field}>{label}<NumberInput name={field} inputMode="decimal" value={priceForm[field] || ''} onChange={updatePriceField} placeholder="تومان"/></label>)}
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

            {partnerEntry && <section className="document-form partner-document-entry" data-partner-document-entry data-document-scope="partner">
              {documentTypeSelector}
              <PartnerCRM key={partnerEntryType} embedded username={username} partners={partners} documents={documents} prices={savedPrices} onAction={performPartnerAction}
                readOnly={!has('partners.write')} canPurchase={has('partners.write') && has('documents.write')}
                invoiceDirection={partnerEntryType.endsWith('-sale') ? 'sale' : 'purchase'} initialAction={partnerEntryType === 'partner-remittance' ? 'remittance' : 'invoice'} initialCategory={partnerDocumentTypes.find(type => type.value === partnerEntryType)?.category || 'crafted'}/>
            </section>}
            {['register', 'expense'].includes(activeTool) && <form className="document-form" data-document-scope={expenseMode ? 'store' : 'customer'} onSubmit={submitDocument} noValidate aria-busy={documentSaving}>
              {formMessage && <div className={`form-message ${formMessage.type}`} role={formMessage.type === 'error' ? 'alert' : 'status'}>{formMessage.text}</div>}
              {draftError && <p className="form-message error" role="alert">{draftError}</p>}
              {!expenseMode && vaultSaleRequest && <div className="invoice-draft-list" data-vault-sale-request role="status">
                <strong>ادامهٔ فروش «{vaultSaleRequest.name}»</strong>
                <p>ورودی فعلی محفوظ است. پس از تکمیل، ثبت یا پاک کردن آن، فروش جنس انتخاب‌شده از صندوق را ادامه دهید.</p>
                <div className="invoice-row-actions">
                  <button type="button" data-vault-sale-continue disabled={documentSaving || documentLocked} onClick={() => continueVaultSale(vaultSaleRequest)}>ادامه فروش این جنس</button>
                  <button type="button" data-vault-sale-cancel onClick={() => setVaultSaleRequest(null)}>لغو انتخاب جنس</button>
                </div>
              </div>}
              <fieldset className="document-save-fields" hidden={paymentStep} disabled={documentSaving || documentLocked || paymentStep}>
              {documentTypeSelector}

              <p className="document-required-note">ساعت و دقیقهٔ ثبت، هنگام ذخیره به‌صورت خودکار به وقت ایران ثبت می‌شود.</p>

              {expenseMode ? <>
                <p className="document-required-note">هزینه را به تومان، ریال، گرم طلا یا ارز ثبت کنید. معادل تومانی با نرخ همین سند از سود دوره کم می‌شود.</p>
                <fieldset className="document-section"><legend>مشخصات هزینه</legend>
                  <DocumentField className="wide" name="description" label="عنوان هزینه" error={documentErrors.description} required><input name="description" value={documentForm.description} onChange={updateDocumentField} placeholder="مثلاً اجاره مغازه یا هزینه حمل"/></DocumentField>
                  <DocumentField name="expenseUnit" label="واحد هزینه" error={documentErrors.expenseUnit} required><select name="expenseUnit" value={documentForm.expenseUnit} onChange={updateDocumentField}>{expenseUnits.map(unit => <option key={unit.value} value={unit.value}>{unit.label}</option>)}</select></DocumentField>
                  {documentForm.expenseUnit === 'currency' && <DocumentField name="expenseCurrency" label="نوع ارز" error={documentErrors.expenseCurrency} required><select name="expenseCurrency" value={documentForm.expenseCurrency} onChange={updateDocumentField}>{currencyCatalog.map(currency => <option key={currency.code} value={currency.code}>{currency.name} ({currency.code})</option>)}</select></DocumentField>}
                  <DocumentField name="expenseAmount" label={documentForm.expenseUnit === 'gold' ? 'وزن هزینه (گرم)' : `مقدار هزینه (${expenseUnitLabel(documentForm)})`} error={documentErrors.expenseAmount} required><NumberInput name="expenseAmount" inputMode="decimal" value={documentForm.expenseAmount} onChange={updateDocumentField} placeholder={documentForm.expenseUnit === 'gold' ? 'مثلاً ۰٫۵' : 'مقدار پرداخت‌شده'}/></DocumentField>
                  {documentForm.expenseUnit === 'gold' && <DocumentField name="expenseGoldPurity" label="عیار طلای پرداختی" error={documentErrors.expenseGoldPurity} required><NumberInput name="expenseGoldPurity" inputMode="decimal" value={documentForm.expenseGoldPurity} onChange={updateDocumentField} placeholder="مثلاً ۷۵۰"/></DocumentField>}
                  {['gold', 'currency'].includes(documentForm.expenseUnit) && <>
                    <DocumentField name="expenseRate" label={documentForm.expenseUnit === 'gold' ? 'نرخ هر گرم طلای ۷۵۰ (تومان)' : 'نرخ هر واحد ارز (تومان)'} error={documentErrors.expenseRate} required><NumberInput name="expenseRate" inputMode="decimal" value={documentForm.expenseRate} onChange={updateDocumentField} placeholder="نرخ زمان پرداخت"/></DocumentField>
                    <p className="document-required-note wide">نرخ پیشنهادی را بررسی کنید؛ مقدار و نرخ این هزینه پس از ثبت ثابت می‌مانند.</p>
                  </>}
                  <DocumentField name="date" label="تاریخ هزینه" error={documentErrors.date} required><PersianDateInput name="date" required value={documentForm.date} onChange={updateDocumentField}/></DocumentField>
                  <DocumentField className="wide" name="expensePayee" label="پرداخت به (اختیاری)"><input name="expensePayee" value={documentForm.expensePayee} onChange={updateDocumentField} placeholder="نام دریافت‌کننده"/></DocumentField>
                  <DocumentField className="wide" name="note" label="یادداشت"><input name="note" value={documentForm.note} onChange={updateDocumentField} placeholder="توضیح تکمیلی"/></DocumentField>
                </fieldset>
              </> : <>
              <p className="document-required-note">فیلدهای ستاره‌دار الزامی هستند. مبلغ‌ها به تومان و تاریخ‌ها شمسی‌اند.</p>
              <fieldset className="document-section"><legend>مشخصات مشترک سند</legend>
                <DocumentField name="customerId" label="انتخاب مشتری" error={documentErrors.customerId}><select name="customerId" value={documentForm.customerId} onChange={updateDocumentField}><option value="">مشتری جدید / ورود نام</option>{customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}{customer.phone ? ` — ${customer.phone}` : ''}</option>)}</select></DocumentField>
                <DocumentField name="customerName" label="نام مشتری" error={documentErrors.customerName} required><input name="customerName" value={documentForm.customerName} readOnly={Boolean(documentForm.customerId)} onChange={updateDocumentField} placeholder="نام مشتری جدید"/></DocumentField>
                <DocumentField name="date" label="تاریخ سند" error={documentErrors.date} required><PersianDateInput name="date" required value={documentForm.date} onChange={updateDocumentField}/></DocumentField>
                <DocumentField name="gold18Price" label="قیمت هر گرم طلای ۱۸ عیار هنگام ثبت (تومان)" error={documentErrors.gold18Price} required><NumberInput name="gold18Price" inputMode="decimal" value={documentForm.gold18Price ?? savedPrices.goldGramPrice ?? ''} onChange={updateDocumentField} placeholder="نرخ طلای ۱۸ عیار"/></DocumentField>
                {!saleMode && <>
                <DocumentField name="gramDebt" label="بدهی گرمی ما به مشتری" error={documentErrors.gramDebt}><NumberInput name="gramDebt" inputMode="decimal" value={documentForm.gramDebt} onChange={updateDocumentField} placeholder="گرم"/></DocumentField>
                <DocumentField name="rialDebt" label="بدهی ریالی ما به مشتری" error={documentErrors.rialDebt}><NumberInput name="rialDebt" inputMode="numeric" value={documentForm.rialDebt} onChange={updateDocumentField} placeholder="تومان"/></DocumentField>
                </>}
                <DocumentField className="wide" name="note" label="یادداشت" error={documentErrors.note}><input name="note" value={documentForm.note} onChange={updateDocumentField} placeholder="توضیح تکمیلی"/></DocumentField>
                <p className="document-required-note wide">{saleMode ? 'پس از محاسبهٔ مبلغ سند، پرداخت نقدی مشتری را وارد می‌کنید و باقی‌مانده با نرخ همین سند به بدهی گرمی تبدیل می‌شود.' : 'مشتری، تاریخ و ماندهٔ بدهی برای کل سند است؛ بدهی فقط یک‌بار در حساب مشتری اعمال می‌شود.'}</p>
                <p className="document-required-note wide">نرخ طلا را بررسی کنید؛ همراه با ساعت ثبت در همین سند ذخیره می‌شود و با تغییر نرخ‌های بازار ثابت می‌ماند. مقدار اولیه از آخرین نرخ دستی ثبت‌شده است.</p>
              </fieldset>
              {invoiceRows.length > 0 && <section className="invoice-draft-list" aria-label="ردیف‌های پیش‌نویس سند">
                <div className="invoice-draft-heading"><h3>جنس‌های این سند</h3><span>{formatNumber(invoiceRows.length)} جنس اضافه‌شده</span></div>
                <p>این ردیف‌ها هنوز ثبت نهایی نشده‌اند. با «ثبت سند» همه با هم ذخیره می‌شوند.</p>
                <div className="invoice-draft-scroll"><table><thead><tr><th>ردیف</th><th>جنس / نوع</th><th>مبلغ (تومان)</th><th>ویرایش</th></tr></thead><tbody>{invoiceRows.map((row, index) => <tr key={index} data-invoice-row={index} className={documentForm.invoiceEditingIndex === index ? 'is-editing' : ''}>
                  <td>{formatNumber(index + 1)}</td><td><strong>{row.itemName}</strong><small>{getDocumentType(row.type).label}{row.productCode && <> · <bdi>{row.productCode}</bdi></>}</small></td><td>{formatNumber(expandSetForm(invoiceLinePreview({ ...row, ...invoiceHeader(documentForm) }, savedPrices.goldGramPrice)).reduce((sum, part) => sum + getDocumentAmount(part), 0))}</td><td><div className="invoice-row-actions"><button type="button" data-invoice-edit={index} onClick={() => editInvoiceRow(index)}>ویرایش</button><button type="button" data-invoice-remove={index} onClick={() => removeInvoiceRow(index)} aria-label={`حذف ردیف ${formatNumber(index + 1)}`}>حذف</button></div></td>
                </tr>)}</tbody></table></div>
              </section>}
              <div className="invoice-editor-heading"><h3>{documentForm.invoiceEditingIndex >= 0 ? `ویرایش ردیف ${formatNumber(documentForm.invoiceEditingIndex + 1)}` : 'جنس بعدی سند'}</h3><p>برای هر جنس، نوع سند و مشخصات زیر را انتخاب کنید.</p></div>
              {saleMode ? <section className="stock-picker" aria-label="انتخاب جنس از صندوق">
                <label>کد یا نام جنس در صندوق<input name="productCode" value={stockQuery} onChange={findStock} autoComplete="off" placeholder="نام جنس یا کد؛ مثلاً مدال" aria-invalid={Boolean(documentErrors.productCode)} aria-describedby={documentErrors.productCode ? 'stock-code-error' : undefined}/></label>
                {documentErrors.productCode && <p id="stock-code-error" className="field-error-text" role="alert">{documentErrors.productCode}</p>}
                {separateSetMode ? <p className="stock-picker-picked">قطعه‌های {documentForm.itemName} انتخاب شده‌اند. قطعه‌های موردنظر برای فروش را در پایین مشخص کنید.</p> : selectedStock ? <><p className="stock-picker-picked">کد <bdi dir="ltr">{selectedStock.productCode}</bdi> انتخاب شد · موجودی: {formatDecimal(selectedStock.remaining)} {selectedStock.category === 'currency' ? selectedStock.currencyType : 'عدد / قطعه'}. تعداد فروش و قیمت را بررسی کنید.</p>{selectedStock.setMode === 'separate' && selectedStock.setId && <button type="button" className="button button-ghost" data-choose-set onClick={() => chooseSet(stock.available.filter(item => item.setId === selectedStock.setId))}>انتخاب قطعه‌های دیگر همین {selectedStock.setKind}</button>}</> : <><p>نام جنس را در پایین بنویسید یا از فهرست انتخاب کنید؛ مشخصات خودکار وارد می‌شوند.</p><div className="stock-picker-options">{stockMatches.map(item => <button key={item.id} type="button" onClick={() => chooseStock(item)}><bdi dir="ltr">{item.productCode}</bdi><span>{item.itemName || item.description || item.typeLabel}{item.setName && <small>از {item.setName}</small>}</span><small>{formatDecimal(item.remaining)} موجود</small></button>)}</div>{!stockMatches.length && <p>جنسی پیدا نشد؛ ابتدا خرید یا موجودی اولیه را ثبت کنید.</p>}</>}
              </section> : <p className="stock-picker">با ثبت خرید، کد جنس خودکار صادر می‌شود و جنس وارد «صندوق من» می‌شود.</p>}

              {miscMode && <p className="document-required-note">برای خرید کار ساختهٔ دست‌دوم یا طلای کم‌عیار، وزن ترازو و عیار واقعی را وارد کنید. وزن معادل ۷۵۰ خودکار محاسبه می‌شود و مبنای مبلغ خرید است. اجرت و سود خرید متفرقه صفر است.</p>}
              <fieldset className="document-section"><legend>{miscMode ? 'مشخصات طلای متفرقه و تبدیل عیار' : 'مشخصات جنس و آزمایشگاه'}</legend>
                {saleMode && !separateSetMode ? <StockNameField value={documentForm.itemName} items={stock.available} selectedId={documentForm.inventorySourceId} error={documentErrors.itemName} onChange={findStockName} onSelect={chooseStock}/> : <DocumentField className="wide" name="itemName" label={separateSetMode ? 'نام مجموعه' : 'نام جنس'} error={documentErrors.itemName} required><input readOnly={saleMode && (separateSetMode || Boolean(String(selectedStock?.itemName || '').trim()))} name="itemName" value={documentForm.itemName} onChange={updateDocumentField} placeholder="مثلاً النگو، زنجیر یا پلاک؛ برای گزارش فروش هر جنس"/></DocumentField>}
                <DocumentField className="wide" name="description" label="شرح سند" error={documentErrors.description}><input name="description" value={documentForm.description} onChange={updateDocumentField} placeholder="مثلاً خرید النگو یا فروش آبشده"/></DocumentField>

                {selectedDocumentType.category === 'currency' && <>
                  <DocumentField name="currencyType" label="نوع ارز" error={documentErrors.currencyType} required><select name="currencyType" disabled={saleMode && Boolean(selectedStock)} value={documentForm.currencyType} onChange={updateDocumentField}>{currencyCatalog.map(currency => <option key={currency.code} value={currency.code}>{currency.name} ({currency.code})</option>)}</select></DocumentField>
                  <DocumentField name="currencyRate" label="قیمت لحظه‌ای هر واحد ارز (تومان)" error={documentErrors.currencyRate} required><NumberInput name="currencyRate" inputMode="decimal" value={documentForm.currencyRate} onChange={updateDocumentField} placeholder="تومان"/></DocumentField>
                  <DocumentField name="currencyAmount" label="مقدار ارز" error={documentErrors.currencyAmount} required><NumberInput name="currencyAmount" inputMode="decimal" value={documentForm.currencyAmount} onChange={updateDocumentField} placeholder="مثلاً ۱۰۰٫۵۰"/></DocumentField>
                </>}
                {selectedDocumentType.category === 'crafted' && <>
                  <DocumentField name="craftedKind" label="نوع کار ساخته" error={documentErrors.craftedKind} required><select name="craftedKind" value={documentForm.craftedKind || ''} disabled={saleMode && (separateSetMode || craftedKinds.includes(selectedStock?.craftedKind))} onChange={updateDocumentField}><option value="">نوع کار را انتخاب کنید</option>{craftedKinds.map(kind => <option key={kind}>{kind}</option>)}</select></DocumentField>
                  {!saleMode && !miscMode && isJewelrySetKind(documentForm.craftedKind) && <div className="wide"><SetModePicker kind={documentForm.craftedKind} value={documentForm.setMode} onChange={value => updateDocumentField({ target: { name: 'setMode', value } })}/></div>}
                  {!separateSetMode && <>
                  <DocumentField name="itemCount" label="تعداد" error={documentErrors.itemCount} required><NumberInput name="itemCount" inputMode="decimal" value={documentForm.itemCount} onChange={updateDocumentField} placeholder="مثلاً ۱۰"/></DocumentField>
                  <DocumentField name="weight" label={miscMode ? 'وزن ترازو هر قطعه (گرم)' : 'وزن هر عدد'} error={documentErrors.weight} required><NumberInput readOnly={saleMode && Boolean(selectedStock?.weight)} name="weight" inputMode="decimal" value={documentForm.weight} onChange={updateDocumentField} placeholder="مثلاً ۱۲.۵"/></DocumentField>
                  <DocumentField name="gramPrice" label={miscMode ? 'قیمت خرید هر گرم طلای ۷۵۰ (تومان)' : 'قیمت هر گرم'} error={documentErrors.gramPrice} required><NumberInput name="gramPrice" inputMode="numeric" value={documentForm.gramPrice} onChange={updateDocumentField} placeholder="تومان"/></DocumentField>
                  <DocumentField name="ayar" label={miscMode ? 'عیار واقعی خرید' : 'عیار'} error={documentErrors.ayar} required><NumberInput readOnly={saleMode && Boolean(selectedStock?.ayar)} name="ayar" inputMode="decimal" value={documentForm.ayar} onChange={updateDocumentField} placeholder={miscMode ? 'مثلاً ۷۴۰' : 'مثلاً 750'}/></DocumentField>
                  {miscMode ? <><label>وزن معادل ۷۵۰ هر قطعه (گرم)<input data-misc-weight750 value={formatDebtGrams(miscGoldWeight750(documentPreview))} readOnly/></label><div className="document-required-note wide" role="status" data-misc-conversion>وزن ترازو × عیار واقعی ÷ ۷۵۰ = وزن معادل ۷۵۰<br/>جمع معادل ۷۵۰ برای {formatDecimal(toNumber(documentForm.itemCount))} قطعه: <strong>{formatDebtGrams(getDocumentWeight(documentPreview))} گرم</strong></div></> : <DocumentField name="wagePercent" label="اجرت درصدی" error={documentErrors.wagePercent} required><NumberInput name="wagePercent" inputMode="decimal" value={documentForm.wagePercent} onChange={updateDocumentField} placeholder="مثلاً ۷"/></DocumentField>}
                  </>}
                </>}

                {selectedDocumentType.category === 'coin' && <>
                  <DocumentField name="coinType" label="نوع سکه" error={documentErrors.coinType}><select disabled={saleMode && Boolean(selectedStock)} name="coinType" value={documentForm.coinType} onChange={updateDocumentField}>{coinTypes.map(type => <option key={type} value={type}>{type}</option>)}</select></DocumentField>
                  {documentForm.coinType === 'پارسیان' ? <>
                    <DocumentField name="coinCount" label="تعداد" error={documentErrors.coinCount} required><NumberInput name="coinCount" inputMode="decimal" value={documentForm.coinCount} onChange={updateDocumentField} placeholder="مثلاً ۱۰"/></DocumentField>
                    <DocumentField name="parsianWeight" label="گرم هر عدد پارسیان" error={documentErrors.parsianWeight} required><NumberInput readOnly={saleMode && Boolean(selectedStock?.parsianWeight)} name="parsianWeight" inputMode="decimal" value={documentForm.parsianWeight} onChange={updateDocumentField} placeholder="مثلاً ۱.۲"/></DocumentField>
                    <DocumentField name="parsianPrice" label="قیمت هر عدد پارسیان" error={documentErrors.parsianPrice} required><NumberInput name="parsianPrice" inputMode="numeric" value={documentForm.parsianPrice} onChange={updateDocumentField} placeholder="تومان"/></DocumentField>
                  </> : <>
                    <DocumentField name="coinCount" label="تعداد" error={documentErrors.coinCount} required><NumberInput name="coinCount" inputMode="decimal" value={documentForm.coinCount} onChange={updateDocumentField} placeholder="۱"/></DocumentField>
                    <DocumentField name="coinPrice" label="قیمت هر سکه" error={documentErrors.coinPrice} required><NumberInput name="coinPrice" inputMode="numeric" value={documentForm.coinPrice} onChange={updateDocumentField} placeholder="تومان"/></DocumentField>
                  </>}
                </>}

                {selectedDocumentType.category === 'melted' && <>
                  <DocumentField name="itemCount" label="تعداد قطعه" error={documentErrors.itemCount} required><NumberInput name="itemCount" inputMode="decimal" value={documentForm.itemCount} onChange={updateDocumentField} placeholder="مثلاً ۳"/></DocumentField>
                  <DocumentField name="meltedWeight" label="وزن ترازو هر قطعه" error={documentErrors.meltedWeight} required><NumberInput readOnly={saleMode && Boolean(selectedStock?.meltedWeight)} name="meltedWeight" inputMode="decimal" value={documentForm.meltedWeight} onChange={updateDocumentField} placeholder="گرم"/></DocumentField>
                  <DocumentField name="meltedAyar" label="عیار خریداری" error={documentErrors.meltedAyar} required><NumberInput readOnly={saleMode && Boolean(selectedStock?.meltedAyar)} name="meltedAyar" inputMode="numeric" value={documentForm.meltedAyar} onChange={updateDocumentField} placeholder="مثلاً ۷۸۰"/></DocumentField>
                  <label>گرم معادل ۷۵۰<input value={formatDecimal(getMeltedWeight750(documentPreview))} readOnly/></label>
                  <DocumentField name="meltedGramPrice" label="قیمت هر گرم" error={documentErrors.meltedGramPrice} required><NumberInput name="meltedGramPrice" inputMode="numeric" value={documentForm.meltedGramPrice} onChange={updateDocumentField} placeholder="تومان"/></DocumentField>
                  <DocumentField name="assayCode" label="شماره انگ آبشده" error={documentErrors.assayCode} required><input readOnly={saleMode && Boolean(selectedStock?.assayCode)} name="assayCode" value={documentForm.assayCode} onChange={updateDocumentField} placeholder="شماره انگ"/></DocumentField>
                  <DocumentField name="laboratoryName" label="نام آزمایشگاه" error={documentErrors.laboratoryName} required><input readOnly={saleMode && Boolean(selectedStock?.laboratoryName)} name="laboratoryName" value={documentForm.laboratoryName} onChange={updateDocumentField} placeholder="نام آزمایشگاه ری‌گیری"/></DocumentField>
                </>}

              </fieldset>
              {separateSetMode && <JewelrySetEditor parts={documentForm.setParts} onChange={setParts => { setDocumentForm(current => ({ ...current, setParts, invoiceCurrentEmpty: false })); setDocumentErrors({}); setFormMessage(null); }} sale={saleMode} documents={documents} prices={savedPrices} errors={documentErrors}/>}
              <fieldset className="document-section"><legend>مبلغ این ردیف</legend>
                {!separateSetMode && <>
                {selectedDocumentType.category !== 'currency' && !miscMode && <>
                  {selectedDocumentType.category !== 'crafted' && <DocumentField name="wagePercent" label="اجرت درصدی" error={documentErrors.wagePercent}><NumberInput name="wagePercent" inputMode="decimal" value={documentForm.wagePercent} onChange={updateDocumentField} placeholder="اختیاری"/></DocumentField>}
                  <DocumentField name="wageFixed" label="اجرت ثابت هر عدد / قطعه (تومان)" error={documentErrors.wageFixed}><NumberInput name="wageFixed" inputMode="decimal" value={documentForm.wageFixed} onChange={updateDocumentField} placeholder="اختیاری"/></DocumentField>
                </>}
                <DocumentField name="otherCosts" label="هزینه‌های دیگر هر واحد (تومان)" error={documentErrors.otherCosts}><NumberInput name="otherCosts" inputMode="decimal" value={documentForm.otherCosts} onChange={updateDocumentField} placeholder="اختیاری"/></DocumentField>
                {!miscMode && <DocumentField name="profitPercent" label={saleMode ? 'درصد سود فروشنده' : 'سود درصدی'} error={documentErrors.profitPercent}><NumberInput name="profitPercent" inputMode="decimal" value={documentForm.profitPercent} onChange={updateDocumentField} placeholder={selectedDocumentType.category === 'crafted' ? 'خالی = ۷٪' : 'مثلاً ۷'}/></DocumentField>}
                {selectedDocumentType.value.endsWith('-sale') && <DocumentField name="discountRial" label="تخفیف ریالی" error={documentErrors.discountRial}><NumberInput name="discountRial" inputMode="numeric" value={documentForm.discountRial} onChange={updateDocumentField} placeholder="تومان"/></DocumentField>}
                </>}


              </fieldset>
              {selectedDocumentType.category === 'crafted' && !separateSetMode && !miscMode && <p className="document-required-note">سود پیش‌فرض کار ساخته ۷٪ است؛ خالی‌گذاشتن فیلد هم ۷٪ محاسبه می‌شود. برای سود متفاوت، درصد دلخواه یا صفر را وارد کنید.</p>}
              {saleMode && <p className="document-required-note">سود فروشنده از مجموع ارزش طلا، اجرت و هزینه‌های این سند محاسبه می‌شود. هزینه‌های عمومی فروشگاه را با نوع سند «هزینه فروشگاه» ثبت کنید.</p>}
              <div className="invoice-draft-actions"><button type="button" className="button button-ghost" data-invoice-add onClick={addInvoiceRow}><Plus size={17}/>{documentForm.invoiceEditingIndex >= 0 ? 'اعمال تغییر ردیف' : 'افزودن جنس به سند'}</button><button type="button" className="button button-ghost" data-invoice-clear onClick={clearInvoiceEditor}>{documentForm.invoiceEditingIndex >= 0 ? 'انصراف از ویرایش ردیف' : 'پاک کردن ورودی فعلی'}</button></div>
              </>}

              <div className="document-preview invoice-draft-total">
                <span>{expenseMode ? 'معادل تومانی هزینه' : 'پیش‌نمایش مبلغ سند'}</span>
                <strong>{Number.isFinite(previewAmount) ? formatNumber(previewAmount) : '—'} <small>تومان</small></strong>
                <small>{expenseMode ? describeDocumentItem(documentPreview) : `${formatNumber(previewRows.length)} ردیف · ${previewRows.map(row => row.itemName).filter(Boolean).join('، ') || 'مشخصات جنس را وارد کنید'}`}</small>
                {expenseMode && <small>{expenseSummary(documentForm)}{!Number.isFinite(previewAmount) && ' · مقدار و نرخ معتبر را وارد کنید.'}</small>}
                {saleMode && <small>سود فروشنده: {formatNumber(previewRows.reduce((sum, row) => sum + documentBreakdown(row).profit, 0))} تومان · تخفیف: {formatNumber(previewRows.reduce((sum, row) => sum + toNumber(row.discountRial), 0))} تومان</small>}
              </div>

              </fieldset>
              {paymentStep && <fieldset className="invoice-payment-step" data-invoice-payment-step disabled={documentSaving || documentLocked}>
                <legend>پرداخت مشتری</legend>
                <p>مبلغ سند با احتساب اجرت، هزینه‌ها و تخفیف محاسبه شد. مشتری چقدر نقد پرداخت کرده است؟</p>
                <dl className="invoice-payment-summary"><div><dt>مبلغ قابل پرداخت</dt><dd data-invoice-payment-total>{formatNumber(paymentPreview.total)} تومان</dd></div><div><dt>تخفیف این سند</dt><dd>{formatNumber(previewRows.reduce((sum, row) => sum + documentBreakdown(row).discount, 0))} تومان</dd></div><div><dt>نرخ تبدیل هر گرم طلای ۱۸ عیار</dt><dd>{formatNumber(paymentPreview.settlementGoldPrice)} تومان</dd></div></dl>
                <DocumentField name="cashPaid" label="مبلغ نقدی پرداخت‌شده (تومان)" error={documentErrors.cashPaid} required><NumberInput name="cashPaid" inputMode="numeric" autoComplete="off" value={documentForm.cashPaid ?? ''} onChange={updateDocumentField} placeholder="اگر پرداختی نشده، صفر وارد کنید"/></DocumentField>
                <button type="button" className="button button-ghost" data-invoice-pay-full onClick={() => updateDocumentField({ target: { name: 'cashPaid', value: String(paymentPreview.total) } })}>کل مبلغ پرداخت شده</button>
                <div className="invoice-payment-result" aria-live="polite"><span>ماندهٔ پرداخت: <strong data-invoice-payment-remainder>{paymentPreview.settlementRemainder == null ? '—' : formatNumber(paymentPreview.settlementRemainder)} تومان</strong></span><span>بدهی گرمی این سند: <strong data-invoice-payment-grams>{paymentPreview.gramDebt == null ? '—' : new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 6 }).format(paymentPreview.gramDebt)} گرم طلای ۱۸ عیار</strong></span></div>
                <p className="document-required-note">ماندهٔ تومان ÷ نرخ هر گرم = بدهی گرمی. این مقدار به حساب مشتری اضافه و در صورتحساب چاپ می‌شود.</p>
                <button type="button" className="button button-ghost" data-invoice-payment-back onClick={() => { setDocumentForm(current => ({ ...current, invoicePaymentStep: false })); setDocumentErrors({}); setFormMessage(null); }}>بازگشت به ردیف‌های سند</button>
              </fieldset>}
              <button className="button button-primary full" type="submit" data-invoice-payment-confirm={paymentStep ? '' : undefined} disabled={documentSaving}><ReceiptText size={17}/> {documentSaving ? 'در حال ذخیره در دیتابیس…' : documentLocked ? 'تلاش دوباره برای ثبت' : expenseMode ? 'ثبت هزینه' : paymentStep ? 'ثبت نهایی و نمایش صورتحساب' : saleMode ? 'محاسبه سند و ثبت پرداخت' : 'ثبت سند'}</button>
            </form>}

            {activeTool === 'search' && <div className="search-ledger">
              <div className="search-controls">
                <label>جستجو در سندها<input value={searchTerm} onChange={event => setSearchTerm(event.target.value)} placeholder="نام طرف حساب، شماره حواله، انگ آبشده یا نوع سکه"/></label>
                <button className="button button-ghost" onClick={() => setSearchTerm('')}>پاک کردن</button>
              </div>
              <div className="document-list">
                {filteredInvoices.length ? filteredInvoices.map(invoice => {
                  const document = invoice.rows[0];
                  return <article className="document-card" key={invoice.id} data-invoice-id={invoice.id}>
                    <div><span>{document.type === 'expense' ? document.typeLabel : `${invoice.direction || document.typeLabel} · ${formatNumber(invoice.rows.length)} ردیف`}{document.invoiceNumber && ` · سند ${formatNumber(document.invoiceNumber)}`}</span><strong>{document.type === 'expense' ? document.expensePayee || 'هزینه فروشگاه' : invoice.customerName}</strong>
                      {invoice.rows.map(row => <div key={row.id}>{row.itemName && <small>{row.itemName}</small>}{row.productCode && <bdi className="document-product-code" dir="ltr">{row.productCode}</bdi>}<small>{row.itemSummary}</small></div>)}
                      {document.type !== 'expense' && <button type="button" className="button button-ghost" data-invoice-view onClick={() => invoice.partnerEntryId ? openDocumentAction(invoice, 'view') : setSelectedInvoice(invoice)}>مشاهده و چاپ سند</button>}
                      {documentActions(invoice)}
                    </div>
                    <div><span>{formatRecordDate(invoice)}</span>
                      {document.type === 'expense' ? <><strong>هزینه: {expenseSummary(document)}</strong>{document.expenseUnit && document.expenseUnit !== 'toman' && <small>معادل ثبت‌شده: {formatNumber(document.amount)} تومان</small>}{expenseRateSummary(document) && <small>{expenseRateSummary(document)}</small>}</> : <>
                        {invoice.partnerRemittance ? <strong>حواله: {formatDebtGrams(invoice.goldDebit + invoice.goldCredit)} گرم ۷۵۰ / {formatNumber(invoice.tomanDebit + invoice.tomanCredit)} تومان</strong> : <strong>مبلغ کل سند: {formatNumber(invoice.amount)} تومان</strong>}
                        {isTradeDocument(document) && <small data-trade-gold-price>{tradeGoldPriceSummary(document)}</small>}
                        {invoice.partnerEntryId ? <><small>بدهکار: {formatDebtGrams(invoice.goldDebit)} گرم · بستانکار: {formatDebtGrams(invoice.goldCredit)} گرم</small><small>مانده سند: {formatDebtGrams(invoice.gramDebt)} گرم ۷۵۰{invoice.partnerRemittance && ` / ${formatNumber(invoice.rialDebt)} تومان`}</small></> : <small>بدهی کل سند: {formatDebtGrams(invoice.gramDebt)} گرم / {formatNumber(invoice.rialDebt)} تومان</small>}
                        {invoice.settlementVersion === 1 && <small>پرداخت نقدی: {formatNumber(invoice.cashPaid)} تومان</small>}
                      </>}
                    </div>
                  </article>;
                }) : <div className="empty-state">سندی برای این جستجو پیدا نشد.</div>}

              </div>
            </div>}

            {activeTool === 'crm' && <CustomerCRM customers={customers} documents={documents} onSave={saveCustomerProfile} readOnly={!has('customers.write')} parseNumber={toNumber}/>}
          </div>
        </div>

      {['register', 'expense'].includes(activeTool) && <details className="account-table-panel recent-documents-details"><summary>{expenseMode ? 'آخرین هزینه‌های فروشگاه' : 'آخرین سندهای مشتری'}</summary>
        <div className="panel-heading">
          <div>
            <span>آخرین سندها</span>
            <p>{expenseMode ? 'خلاصه هزینه‌های ثبت‌شده فروشگاه.' : 'خلاصه خرید، فروش و بدهی مرتبط با هر مشتری.'}</p>
          </div>
        </div>
        <div className="activity-table">
          <div className="activity-row activity-head document-row"><span>شرح</span><span>طرف حساب</span><span>مبلغ (تومان)</span><span>بدهی</span></div>
          {latestDocuments.length ? latestDocuments.map(invoice => {
            const document = invoice.rows[0];
            return <div className="activity-row document-row" key={invoice.id}>
              <span>{document.invoiceNumber ? `سند ${formatNumber(document.invoiceNumber)} · ` : ''}{document.typeLabel} · {invoice.rows.map(row => row.itemName || row.itemSummary).join('، ')}{document.recordedAt && <small className="document-record-time">{formatRecordDate(invoice)}</small>}{document.type === 'expense' ? <small className="document-record-time">{expenseSummary(document)}</small> : <button type="button" className="button button-ghost" data-invoice-view onClick={() => setSelectedInvoice(invoice)}>مشاهده و چاپ</button>}{documentActions(invoice)}</span>
              <span>{invoice.customerName || document.expensePayee || '—'}</span>
              <span>{formatNumber(invoice.amount)}{isTradeDocument(document) && <small className="document-record-time" data-trade-gold-price>{tradeGoldPriceSummary(document)}</small>}</span>
              <b>{document.type === 'expense' ? '—' : `${formatDebtGrams(invoice.gramDebt)} گرم / ${formatNumber(invoice.rialDebt)}`}</b>
            </div>;
          }) : <div className="empty-state inside-table">هنوز سندی ثبت نشده است.</div>}

        </div>
      </details>}
      </div>}
    </div>
    {editingPartnerEntry && <PartnerDocumentDialog key={editingPartnerEntry.id} partner={editingPartner} entry={editingPartnerEntry} username={username} documents={documents} prices={savedPrices} onAction={performPartnerAction} editing={partnerDocumentAction.editing} canEdit={has('partners.write') && (has('documents.write') || (editingPartnerEntry.type === 'settlement' && editingPartnerEntry.paymentMethod === 'remittance' && !editingPartnerEntry.linkedEntryId))} onClose={() => setPartnerDocumentAction(null)} onSaved={() => { setPartnerDocumentAction(null); setStorageMessage('تغییرات سند همکار ذخیره شد و مانده حساب به‌روز شد.'); }}/>}
    <InvoiceDetails invoice={selectedInvoice} onClose={() => setSelectedInvoice(null)} onEdit={selectedInvoice && canChangeDocument(selectedInvoice) ? () => openDocumentAction(selectedInvoice, 'edit') : undefined} onDelete={selectedInvoice && canChangeDocument(selectedInvoice) ? () => openDocumentAction(selectedInvoice, 'delete') : undefined}/>
    {documentAction && <DocumentEditor {...documentAction} customers={customers} onSave={mutateSavedDocument} onClose={() => setDocumentAction(null)}/>}
  </section>
}

function DocumentField({ name, label, error, required, className = '', children }) {
  return <label className={`${className} ${error ? 'field-error' : ''}`}><span className="document-field-label">{label}{required && <span className="required-mark" aria-label="الزامی"> *</span>}</span>{React.cloneElement(children, { 'aria-invalid': error ? true : undefined, 'aria-describedby': error ? `document-error-${name}` : undefined, 'aria-required': required || undefined })}{error && <small id={`document-error-${name}`} className="field-error-text">{error}</small>}</label>;
}
