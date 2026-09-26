import { navigateWorkspace } from './browser-navigation.mjs';
import { runJewelrySetChecks } from './jewelry-sets-browser-scenarios.mjs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { isoToPersian, toPersianDigits, todayInTehran } from './src/persianDate.js';

// Run after npm run build. Uses Chrome's built-in debugging protocol, without
// browser-test dependencies. Mouse actions use real CDP pointer dispatch.
const origin = 'http://127.0.0.1:4182';
const debugOrigin = 'http://127.0.0.1:9229';
const account = 'inventory-browser-test';
const storageKey = `zarngarDocuments:${account}`;
const startedAt = Date.now();
const recordedMinute = record => new Intl.DateTimeFormat('fa-IR', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(record.recordedAt));
const assertRecordedAt = (record, description) => {
  assert.match(record.recordedAt ?? '', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, `${description} captures a full ISO timestamp`);
  const timestamp = Date.parse(record.recordedAt);
  assert.ok(timestamp >= startedAt && timestamp <= Date.now(), `${description} captures the actual save time`);
};
const pause = ms => new Promise(resolvePause => setTimeout(resolvePause, ms));
const server = createServer(async (req, res) => {
  const requestPath = new URL(req.url, origin).pathname;
  const assetPath = requestPath.startsWith('/assets/') ? requestPath : '/index.html';
  try {
    const body = await readFile(join('dist', assetPath));
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' })[extname(assetPath)] || 'application/octet-stream');
    res.end(body);
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(4182, '127.0.0.1', resolveListen); });
const profile = await mkdtemp(join(tmpdir(), 'zar-inventory-check-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=9229', `--user-data-dir=${profile}`, 'about:blank',
], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let chromeError;
let chromeLog = '';
chrome.on('error', error => { chromeError = error; });
chrome.stderr.on('data', data => { chromeLog += data.toString(); });
let socket;
let cdp;

try {
  let targets;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (chromeError) throw chromeError;
    try { targets = await (await fetch(`${debugOrigin}/json`, { signal: AbortSignal.timeout(1000) })).json(); break; }
    catch { await pause(150); }
  }
  assert.ok(targets?.some(target => target.type === 'page'), `Chrome debugging starts: ${chromeLog}`);
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => { socket.addEventListener('open', resolveOpen, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let sequence = 0;
  const pending = new Map();
  const errors = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    const request = pending.get(message.id);
    if (request) { pending.delete(message.id); message.error ? request.reject(message.error) : request.resolve(message.result); }
  });
  cdp = (method, params = {}) => new Promise((resolveRequest, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 10_000);
    pending.set(id, {
      resolve: result => { clearTimeout(timeout); resolveRequest(result); },
      reject: error => { clearTimeout(timeout); reject(error); },
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until = async (expression, description) => {
    for (let attempt = 0; attempt < 60; attempt += 1) { if (await evaluate(expression)) return; await pause(100); }
    throw Error(`Timed out: ${description || expression}`);
  };
  const ready = selector => until(`Boolean(document.querySelector(${JSON.stringify(selector)}))`, selector);
  const click = async selector => {
    await ready(selector);
    let point;
    // Fonts and conditional forms can settle after the first scroll. Re-measure
    // the actual pointer target while still requiring a native, unobscured click.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',inline:'center',behavior:'instant'})`);
      await pause(180);
      point = await evaluate(`(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        const box = element.getBoundingClientRect();
        const x = box.left + box.width / 2;
        const y = box.top + box.height / 2;
        const hit = document.elementFromPoint(x, y);
        return {x,y,width:box.width,height:box.height,clickable:Boolean(hit && (element === hit || element.contains(hit)))};
      })()`);
      if (point.clickable) break;
    }
    assert.ok(point.width > 0 && point.height > 0 && point.clickable, `Visible, unobscured native click target: ${selector}: ${JSON.stringify(point)}`);
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await pause(100);
  };
  const fill = async (selector, value) => {
    await ready(selector);
    await evaluate(`(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      const prototype = input.tagName === 'SELECT' ? HTMLSelectElement.prototype : input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype,'value').set.call(input,${JSON.stringify(value)});
      input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input',{bubbles:true}));
    })()`);
    await pause(45);
  };
  const navigate = tool => navigateWorkspace(tool, { click, evaluate, pause });
  const filtersExpanded = () => evaluate(`document.querySelector('[data-toggle-vault-filters]').getAttribute('aria-expanded') === 'true'`);
  const openFilters = async () => {
    if (!(await filtersExpanded())) await click('[data-toggle-vault-filters]');
    assert.equal(await evaluate(`document.querySelector('#vault-filter-panel').hidden`), false, 'opening filters reveals the dedicated panel');
  };
  const applyFilters = async () => {
    await click('[data-apply-vault-filters]');
    assert.equal(await filtersExpanded(), false, 'applying valid filters closes the panel');
  };
  const stored = () => evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)}) || '[]')`);
  const screenshot = async name => {
    await mkdir('artifacts', { recursive: true });
    await evaluate('window.scrollTo({top:0,behavior:"instant"})');
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const metrics = await cdp('Page.getLayoutMetrics');
    const size = metrics.cssContentSize || metrics.contentSize;
    const viewportOnly = name.includes('navigation') || size.height <= (metrics.cssVisualViewport || metrics.visualViewport).clientHeight;
    const result = await cdp('Page.captureScreenshot', viewportOnly ? { format: 'png' } : { format: 'png', captureBeyondViewport: true, clip: { x: size.x, y: size.y, width: size.width, height: size.height, scale: 1 } });
    await writeFile(`artifacts/${name}.png`, Buffer.from(result.data, 'base64'));
  };
  const noOverflow = async label => assert.ok(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), `${label} fits the viewport`);
  const desktopBounds = async label => {
    const bounds = await evaluate(`(() => { const rect = selector => document.querySelector(selector)?.getBoundingClientRect().toJSON(); return {scrollX,scrollWidth:document.documentElement.scrollWidth,width:innerWidth,pageLeft:visualViewport.pageLeft,rail:rect('.workspace-rail'),content:rect('.workspace-content'),page:rect('.workspace-page'),tools:rect('.workspace-tools'),panel:rect('.account-main-panel'),grid:getComputedStyle(document.querySelector('.workspace-page')).gridTemplateColumns,direction:getComputedStyle(document.querySelector('.workspace-page')).direction}; })()`);
    console.log(label, JSON.stringify(bounds));
    assert.ok(bounds.rail.left >= 0 && bounds.rail.right <= bounds.width && bounds.content.left >= -1 && bounds.content.right <= bounds.width + 1, `${label} rail and content fit the viewport: ${JSON.stringify(bounds)}`);
  };
  const today = todayInTehran();
  await cdp('Runtime.enable'); await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: origin }); await ready('.site-shell');
  if (!process.argv.includes('--sets-only')) {
  await evaluate(`localStorage.setItem('zarngarCurrentUser', ${JSON.stringify(account)}); location.reload()`);
  await ready('.workspace-rail'); await navigate('opening'); await ready('.opening-shell');
  await fill('.opening-rate-panel [name="goldGramPrice"]', '۱۰۰');
  await fill('.opening-item-card:first-child .form-grid label:nth-child(1) input', 'النگو مشترک');
  await fill('.opening-item-card:first-child .form-grid label:nth-child(2) input', '۲');
  await fill('.opening-item-card:first-child .form-grid label:nth-child(3) input', '۳');
  await click('.opening-shell button[type="submit"]'); await ready('.opening-shell .form-message.success');
  const opening = (await stored())[0];
  assert.ok(opening.productCode); assert.equal(opening.source, 'opening-inventory');
  assert.equal(opening.gold18Price, undefined, 'opening inventory does not capture a trade gold price');
  assertRecordedAt(opening, 'New opening inventory');
  await navigate('vault'); await ready('.vault-item');
  assert.equal(await evaluate(`document.querySelectorAll('.vault-item').length`), 1);
  const field = name => `.document-form [name="${name}"]`;
  const submit = () => click('.document-form button[type="submit"]');
  const begin = async type => { await navigate('register'); await fill('.document-form select[name="type"]', type); };
  const enter = async values => { for (const [name,value] of Object.entries(values)) await fill(field(name), value); };
  await begin('crafted-purchase');
  assert.equal(await evaluate(`document.querySelector('[name="gold18Price"]').value`), '۱۰۰', 'trade metadata starts with the latest saved gold rate');
  await enter({ customerName: 'فروشنده', itemName: 'النگو مشترک', itemCount: '1', weight: '4', gramPrice: '100', gold18Price: '۱۵۰', ayar: '750', wagePercent: '0' });
  await submit(); await ready('.document-form .form-message.success');
  const purchase = (await stored())[0]; assert.notEqual(purchase.productCode, opening.productCode);
  assertRecordedAt(purchase, 'New purchase');
  assert.equal(purchase.gold18Price, 150, 'manual Persian gold rate is saved as numeric trade metadata');
  assert.equal(purchase.gramPrice, '100', 'trade metadata is independent of the invoice gram price');
  assert.equal(purchase.amount, 400, 'gold reference price does not change the invoice amount');
  await begin('crafted-sale');
  await fill(field('productCode'), toPersianDigits(opening.productCode.toLowerCase()));
  assert.equal(await evaluate(`document.querySelector('[name="weight"]').value`), '۳');
  assert.equal(await evaluate(`document.querySelector('[name="weight"]').readOnly`), true);
  await enter({ customerName: 'خریدار', itemCount: '1' }); await submit(); await ready('.document-form .form-message.success');
  let docs = await stored(); assert.equal(docs[0].inventorySourceId, opening.id); assert.equal(docs[0].productCode, opening.productCode);
  const firstSale = docs[0];
  assertRecordedAt(firstSale, 'New sale');
  assert.equal(firstSale.gold18Price, 100, 'sale captures the latest saved gold rate');
  await navigate('vault');
  const openingSelector = `[data-product-code="${opening.productCode}"]`;
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(openingSelector)}).open`), false, 'vault items stay compact initially');
  await click(`${openingSelector} > .vault-item-summary`);
  assert.ok(await evaluate(`document.querySelector(${JSON.stringify(`${openingSelector} .vault-specifications`)}).innerText.includes(${JSON.stringify(`ساعت ${recordedMinute(opening)}`)})`), 'entry details display the recorded hour and minute');
  await click(`${openingSelector} .vault-item-history > summary`);
  const history = await evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(`${openingSelector} .vault-item-history p`)}), node => node.innerText)`);
  assert.ok(history[0].includes(`ساعت ${recordedMinute(opening)}`), 'entry history displays its precise registration minute');
  assert.ok(history[1].includes(`ساعت ${recordedMinute(firstSale)}`), 'sale history displays its precise registration minute');
  await begin('crafted-sale'); await fill(field('productCode'), opening.productCode);
  await enter({ customerName: 'خریدار', itemCount: '2' }); await submit(); await ready('#stock-code-error');
  assert.equal((await stored()).length, docs.length, 'oversell never changes saved records');
  await fill(field('itemCount'), '1'); await submit(); await ready('.document-form .form-message.success');
  await navigate('vault');
  assert.equal(await evaluate(`Boolean(document.querySelector('[data-product-code="${opening.productCode}"]'))`), false, 'sold out lot leaves active vault');
  assert.equal(await evaluate(`Boolean(document.querySelector('[data-product-code="${purchase.productCode}"]'))`), true, 'same-name lot unaffected');
  await openFilters(); await fill('[aria-label="وضعیت موجودی"]', 'empty'); await applyFilters();
  assert.ok(await evaluate(`document.querySelector('[data-product-code="${opening.productCode}"]').textContent.includes('اتمام موجودی')`));
  await evaluate('location.reload()'); await ready('.workspace-rail'); await navigate('vault');
  assert.equal((await stored()).find(doc => doc.id === opening.id).productCode, opening.productCode);
  await openFilters(); await fill('[aria-label="جستجو در صندوق"]', purchase.productCode); await applyFilters();
  assert.equal(await evaluate(`document.querySelectorAll('.vault-item').length`), 1);
  await click('.vault-item-summary');
  await click('.vault-item .button-primary'); await ready('.stock-picker-picked');
  assert.equal(await evaluate(`document.querySelector('[name="weight"]').value`), '4');
  await fill(field('productCode'), 'ZG-NOT-FOUND');
  assert.equal(await evaluate(`document.querySelector('[name="weight"]').value`), '', 'unknown code clears stale product identity');
  await enter({ customerName:'خریدار' }); await submit(); await ready('#stock-code-error');

  for (const category of ['melted','coin']) {
    await begin(`${category}-purchase`);
    await enter(category === 'melted' ? { customerName:'فروشنده آبشده', itemCount:'2', meltedWeight:'5', meltedAyar:'780', meltedGramPrice:'100', assayCode:'12345', laboratoryName:'آزمایشگاه تهران' } : { customerName:'فروشنده سکه', coinCount:'3', coinPrice:'200' });
    await submit(); await ready('.document-form .form-message.success');
    const source = (await stored())[0];
    assert.equal(source.gold18Price, 100, `${category} purchase captures the gold reference rate`);
    await begin('crafted-sale'); await fill(field('productCode'),source.productCode);
    assert.equal(await evaluate(`document.querySelector('select[name="type"]').value`),`${category}-sale`);
    assert.equal(await evaluate(`document.querySelector('[name="profitPercent"]').value`),'7',`${category} sales default to seven percent`);
    if(category==='melted') {
      assert.equal(await evaluate(`document.querySelector('[name="laboratoryName"]').value`),'آزمایشگاه تهران');
      assert.equal(await evaluate(`document.querySelector('[name="assayCode"]').value`),'12345');
    }
    await enter({ customerName:'خریدار صندوق', [category==='coin'?'coinCount':'itemCount']:'1' });
    await submit(); await ready('.document-form .form-message.success');
    assert.equal((await stored())[0].inventorySourceId,source.id);
    assert.equal((await stored())[0].gold18Price, 100, `${category} sale captures the gold reference rate`);
  }
  await navigate('search'); await fill('.search-controls input',opening.productCode);
  assert.equal(await evaluate(`document.querySelectorAll('.document-card').length`),3,'code search shows entry and both sales');
  assert.equal(await evaluate(`document.querySelectorAll('.document-card [data-trade-gold-price]').length`), 2, 'ledger shows gold snapshots for sales, without adding one to opening inventory');

  // Older unnamed sales are shown for explicit reconciliation, never guessed.
  docs=await stored();
  const historical={...docs.find(doc=>doc.inventorySourceId===opening.id),id:'historical-sale',productCode:'',inventorySourceId:'',itemCount:'1',amount:123,createdAt:'2020-09-01T06:07:08.000Z'};
  delete historical.recordedAt;
  delete historical.gold18Price;
  await evaluate(`localStorage.setItem(${JSON.stringify(storageKey)},${JSON.stringify(JSON.stringify([historical,...docs]))}); location.reload()`);
  await ready('.workspace-rail'); await navigate('vault'); await ready('.vault-legacy');
  assert.deepEqual((await stored()).find(doc => doc.id === historical.id), historical, 'reloading leaves legacy records unchanged and never infers registration time from createdAt');
  await click('.vault-legacy summary'); await fill('.vault-legacy select',purchase.id);
  await click('.vault-legacy-row button');
  await until(`!document.querySelector('.vault-legacy')`,'old sale linked');
  assert.equal((await stored()).find(doc=>doc.id==='historical-sale').amount,123);
  assert.equal((await stored()).find(doc=>doc.id==='historical-sale').recordedAt,undefined,'reconciling an old sale never backfills registration time');
  assert.equal((await stored()).find(doc=>doc.id==='historical-sale').gold18Price,undefined,'reconciling an old sale never backfills the historical gold price');
  assert.equal((await stored()).find(doc=>doc.id==='historical-sale').createdAt,historical.createdAt,'reconciling an old sale preserves its existing metadata');
  await noOverflow('desktop vault'); await screenshot('inventory-desktop');
  await cdp('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:1,mobile:true}); await pause(300);
  await noOverflow('mobile vault'); await screenshot('inventory-mobile');
  await click('.vault-item-summary');
  await noOverflow('mobile item details'); await screenshot('inventory-details-mobile');
  await click('.vault-item .button-primary'); await ready('.stock-picker-picked');
  await noOverflow('mobile stock-linked sale'); await screenshot('inventory-sale-mobile');

  await evaluate(`localStorage.setItem('zarngarCurrentUser','empty-inventory-account'); location.reload()`);
  await ready('.workspace-rail'); await navigate('vault');
  assert.equal(await evaluate(`document.querySelectorAll('.vault-item').length`),0,'account isolation');
  await evaluate(`localStorage.setItem('zarngarCurrentUser',${JSON.stringify(account)}); location.reload()`);
  await ready('.workspace-rail'); await navigate('vault');
  assert.equal(await evaluate(`document.querySelectorAll('.vault-item').length`),2,'remaining coin and melted lots persist');
  // Currency, bank-86 coin variants, costs and current asset equivalents.
  await evaluate(`localStorage.setItem('zarngarCurrentUser','asset-browser-test'); location.reload()`);
  await ready('.workspace-rail'); await navigate('opening'); await ready('.opening-shell');
  await fill('.opening-rate-panel [name="goldGramPrice"]', '100');
  await fill('.opening-rate-panel [name="usdPrice"]', '10');
  await fill('.opening-asset-section:nth-child(4) .opening-item-card label:nth-child(4) input', '۱۰۰٫۵');
  await click('.opening-shell button[type="submit"]'); await ready('.opening-shell .form-message.success');
  const assetDocs = () => evaluate(`JSON.parse(localStorage.getItem('zarngarDocuments:asset-browser-test') || '[]')`);
  const currencyOpening = (await assetDocs())[0];
  assert.equal(currencyOpening.currencyType, 'USD');
  assert.equal(currencyOpening.amount, 1005);
  assert.equal(currencyOpening.gold18Price, undefined, 'currency opening inventory has no trade gold metadata');
  assertRecordedAt(currencyOpening, 'New currency opening inventory');
  await begin('currency-sale'); await fill(field('productCode'), currencyOpening.productCode);
  assert.equal(await evaluate(`document.querySelector('[name="currencyType"]').disabled`), true);
  assert.equal(await evaluate(`document.querySelector('[name="profitPercent"]').value`),'7','currency sales default to seven percent');
  await enter({ customerName: 'خریدار دلار', currencyAmount: '۲۰٫۲۵', profitPercent: '0' });
  await submit(); await ready('.document-form .form-message.success');
  assert.equal((await assetDocs())[0].amount, 202.5);
  assert.equal((await assetDocs())[0].gold18Price, 100, 'currency sale saves the 18-karat gold reference rate');
  await begin('currency-sale'); await fill(field('productCode'), currencyOpening.productCode);
  await enter({ customerName: 'خریدار دلار', currencyAmount: '81' }); await submit(); await ready('#stock-code-error');
  assert.equal((await assetDocs()).length, 2);
  await begin('currency-purchase');
  await enter({ customerName: 'فروشنده یورو', currencyType: 'EUR', currencyRate: '30', currencyAmount: '5' });
  await submit(); await ready('.document-form .form-message.success');
  await begin('crafted-purchase');
  await enter({ customerName: 'فروشنده طلا', itemCount: '2', weight: '2', ayar: '750', gramPrice: '100', wagePercent: '10', wageFixed: '5', otherCosts: '3', profitPercent: '5' });
  await submit(); await ready('.document-form .form-message.success');
  assert.equal((await assetDocs())[0].amount, 478.8);
  for (const coinType of ['امامی بانکی ۸۶', 'نیم سکه بانکی ۸۶', 'ربع سکه بانکی ۸۶', 'سکه یک گرمی بانکی ۸۶']) {
    await begin('coin-purchase');
    await enter({ customerName: 'فروشنده بانکی', coinType, coinCount: '1', coinPrice: '200', wageFixed: '2' });
    await submit(); await ready('.document-form .form-message.success');
    assert.equal((await assetDocs())[0].coinType, coinType);
    assert.equal((await assetDocs())[0].amount, 202);
  }
  const originalAssets = await assetDocs();
  originalAssets.forEach(record => assertRecordedAt(record, `${record.category} ${record.type}`));
  originalAssets.filter(record => record.source !== 'opening-inventory').forEach(record => assert.equal(record.gold18Price, 100, `${record.type} saves the current gold rate`));
  await navigate('pricing');
  await fill('.price-form [name="usdPrice"]', '20');
  await fill('.price-form [name="bankOneGram86Price"]', '300');
  await click('.price-form button[type="submit"]'); await ready('.price-form .form-message.success');
  assert.deepEqual(await assetDocs(), originalAssets, 'repricing preserves original documents');
  await navigate('vault');
  assert.ok(await evaluate(`document.querySelector('.vault-holdings').textContent.includes('۸۰٫۲۵')`));
  assert.ok(await evaluate(`document.querySelector('.vault-holdings').textContent.includes('دلار آمریکا')`));
  assert.ok(await evaluate(`document.querySelector('.asset-totals').textContent.includes('۳۱٬۴۱۸')`), 'rial total includes remaining currency, gold, coin rates and costs');
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('.asset-gold-weights article strong'),element=>element.textContent.trim())`),['۴ گرم','۴ گرم','۴٫۵ گرم','۴٫۷۲۸ گرم'],'physical gold, purity-adjusted gold, wage equivalent and profit equivalent remain separate from coins and currencies');
  await noOverflow('mobile assets'); await screenshot('assets-mobile');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false }); await pause(250);
  await noOverflow('desktop assets'); await screenshot('assets-desktop');
  await evaluate('location.reload()'); await ready('.workspace-rail'); await navigate('vault');
  assert.ok(await evaluate(`document.querySelector('.asset-totals').textContent.includes('۳۱٬۴۱۸')`), 'asset balances persist after reload');

  // Gold metadata records the saved market rate at the transaction time. The
  // invoice calculation can use a different negotiated gram price.
  await navigate('pricing'); await fill('.price-form [name="goldGramPrice"]', '200');
  await click('.price-form button[type="submit"]'); await ready('.price-form .form-message.success');
  assert.deepEqual(await assetDocs(), originalAssets, 'changing the gold rate preserves every original amount and gold snapshot');
  await navigate('search'); await fill('.search-controls input', '');
  const ledgerCards = await evaluate(`Array.from(document.querySelectorAll('.document-card'), card => ({code: card.querySelector('.document-product-code')?.textContent, text: card.textContent, rate: card.querySelector('[data-trade-gold-price]')?.textContent}))`);
  for (const record of originalAssets) {
    const card = ledgerCards.find(card => card.code === record.productCode && card.text.includes(`مبلغ ثبت‌شده: ${new Intl.NumberFormat('fa-IR').format(Math.round(record.amount))} تومان`));
    assert.ok(card, `${record.type} ledger displays its original recorded amount`);
    if (record.source === 'opening-inventory') assert.equal(card.rate, undefined, 'opening inventory ledger has no trade snapshot');
    else assert.equal(card.rate, 'طلای ۱۸ عیار هنگام ثبت: ۱۰۰ تومان / گرم', `${record.type} ledger displays its immutable gold rate`);
  }
  assert.ok(ledgerCards.every(card => !card.text.includes('قیمت جدید')), 'ledger does not display dynamically repriced invoice amounts');
  await noOverflow('desktop transaction gold metadata'); await screenshot('transaction-gold-desktop');
  await navigate('pricing'); await fill('.price-form [name="goldGramPrice"]', '300');
  await begin('crafted-purchase');
  assert.equal(await evaluate(`document.querySelector('[name="gold18Price"]').value`), '200', 'an unsaved pricing draft does not become the transaction gold rate');
  await enter({ customerName: 'فروشنده نرخ جدید', itemName: 'آزمون نرخ هنگام ثبت', itemCount: '1', weight: '1', gramPrice: '100', ayar: '750', wagePercent: '0' });
  await submit(); await ready('.document-form .form-message.success');
  const latestGoldPurchase = (await assetDocs())[0];
  assert.equal(latestGoldPurchase.gold18Price, 200, 'the next purchase captures the latest saved rate');
  assert.equal(latestGoldPurchase.amount, 100, 'the negotiated invoice price stays independent of the gold reference rate');
  assert.deepEqual((await assetDocs()).slice(1), originalAssets, 'new transactions leave previous snapshots intact');
  await begin('expense');
  assert.equal(await evaluate(`Boolean(document.querySelector('[name="gold18Price"]'))`), false, 'expense form does not request trade gold metadata');
  await enter({ description: 'هزینه آزمون', expenseAmount: '25' });
  await submit(); await ready('.document-form .form-message.success');
  assert.equal((await assetDocs())[0].gold18Price, undefined, 'expenses do not save the transaction gold snapshot');
  await evaluate('location.reload()'); await ready('.workspace-rail'); await navigate('search');
  await fill('.search-controls input', latestGoldPurchase.productCode);
  assert.equal(await evaluate(`document.querySelector('[data-trade-gold-price]').textContent`), 'طلای ۱۸ عیار هنگام ثبت: ۲۰۰ تومان / گرم', 'the newly captured rate survives reload');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await pause(250);
  await noOverflow('mobile transaction gold metadata'); await screenshot('transaction-gold-mobile');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false }); await pause(250);

  // A separate account provides exact price/weight boundaries without changing
  // earlier ledger scenarios. Original purchase rates differ from today's rate.
  const filterAccount = 'filter-browser-test';
  const filterStorageKey = `zarngarDocuments:${filterAccount}`;
  const filterEntry = (id, values) => ({
    id, productCode: `ZG-FILTER-${id.toUpperCase()}`, date: today, category: 'crafted',
    type: 'crafted-purchase', typeLabel: 'خرید کار ساخته', customerName: 'فروشنده آزمایشی',
    itemCount: '1', gramPrice: '8000000', ayar: '750', wagePercent: '0', wageFixed: '0',
    otherCosts: '0', profitPercent: '0', ...values,
  });
  const filterEntries = [
    filterEntry('low', { itemName: 'طرح آریا', craftedKind: 'انگشتر', weight: '4', itemCount: '3', wagePercent: '20', wageFixed: '1000000', otherCosts: '1000000', profitPercent: '20' }),
    filterEntry('boundary', { itemName: 'انگشتر کلاسیک', weight: '10' }),
    filterEntry('over', { itemName: 'انگشتر نگین', weight: '10', wageFixed: '1000000' }),
    filterEntry('bracelet', { itemName: 'دستبند ساده', weight: '5' }),
    filterEntry('legacy', { description: 'حلقه قدیمی', weight: '6' }),
    filterEntry('sold', { itemName: 'انگشتر فروخته‌شده', weight: '3' }),
    filterEntry('coin', { category: 'coin', type: 'coin-purchase', coinType: 'امامی', coinCount: '2', coinPrice: '70000000' }),
    filterEntry('quarter', { category: 'coin', type: 'coin-purchase', coinType: 'ربع', coinCount: '1', coinPrice: '15000000' }),
    filterEntry('usd', { category: 'currency', type: 'currency-purchase', currencyType: 'USD', currencyAmount: '1000', currencyRate: '90000' }),
    filterEntry('eur', { category: 'currency', type: 'currency-purchase', currencyType: 'EUR', currencyAmount: '1000', currencyRate: '110000' }),
  ];
  const soldEntry = filterEntries.find(entry => entry.id === 'sold');
  const filterDocuments = [{ ...soldEntry, id: 'sold-sale', type: 'crafted-sale', inventorySourceId: soldEntry.id }, ...filterEntries];
  const filterPrices = { goldGramPrice: '10000000', emamiCoinPrice: '80000000', quarterCoinPrice: '20000000', usdPrice: '100000', eurPrice: '120000' };
  await evaluate(`localStorage.setItem('zarngarCurrentUser',${JSON.stringify(filterAccount)}); localStorage.setItem(${JSON.stringify(filterStorageKey)},${JSON.stringify(JSON.stringify(filterDocuments))}); localStorage.setItem('zarngarPrices:${filterAccount}',${JSON.stringify(JSON.stringify(filterPrices))}); location.reload()`);
  await ready('.workspace-rail'); await navigate('vault'); await ready('.vault-filters input[name="maxPrice"]');
  const filterField = name => `.vault-filters [name="${name}"]`;
  const filterQuery = '[aria-label="جستجو در صندوق"]';
  const visibleCodes = () => evaluate(`Array.from(document.querySelectorAll('.vault-item'), item => item.dataset.productCode).sort()`);
  const expectResults = async (ids, description) => {
    assert.deepEqual(await visibleCodes(), ids.map(id => `ZG-FILTER-${id.toUpperCase()}`).sort(), description);
    assert.ok(await evaluate(`document.querySelector('[data-testid="vault-result-count"]').textContent.includes(${JSON.stringify(toPersianDigits(String(ids.length)))})`), `${description}: visible count updates`);
  };
  const resetFilters = () => click('[data-reset-vault-filters]');
  const updateFilters = async values => {
    await openFilters();
    for (const [name, value] of Object.entries(values)) await fill(filterField(name), value);
    await applyFilters();
  };
  const allAvailable = ['low', 'boundary', 'over', 'bracelet', 'legacy', 'coin', 'quarter', 'usd', 'eur'];
  await expectResults(allAvailable, 'default filters show available lots');
  assert.equal(await filtersExpanded(), false, 'filter controls start collapsed');
  assert.equal(await evaluate(`document.querySelector('#vault-filter-panel').getClientRects().length`), 0, 'collapsed controls take no space in the layout');
  assert.equal(await evaluate(`Boolean(document.querySelector('[data-price-cap]'))`), false, 'suggested price filter is removed');
  const assetTotalsBeforeFiltering = await evaluate(`document.querySelector('.vault-assets').textContent`);
  assert.ok(await evaluate(`document.querySelector('[data-product-code="ZG-FILTER-LOW"] .vault-item-price').textContent.includes('۶۰٬۰۰۰٬۰۰۰')`), 'card uses current per-unit price with wages, costs and profit');
  await openFilters();
  await fill(filterField('craftedKind'), 'انگشتر');
  await fill(filterField('maxPrice'), '۱۰۰٬۰۰۰٬۰۰۰');
  await expectResults(allAvailable, 'editing a filter draft does not change visible results');
  assert.equal(await evaluate(`document.querySelectorAll('[data-clear-vault-filter]').length`), 0, 'draft filters do not become active chips');
  await click('[data-cancel-vault-filters]');
  assert.equal(await filtersExpanded(), false, 'cancel closes the filter panel');
  await openFilters();
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(filterField('maxPrice'))}).value`), '', 'cancel discards the draft price ceiling');
  await fill(filterField('query'), 'آریا');
  await click(filterField('query'));
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await until(`document.querySelector('[data-toggle-vault-filters]').getAttribute('aria-expanded') === 'false'`, 'Escape closes filter panel');
  await expectResults(allAvailable, 'Escape preserves the applied results');
  await updateFilters({ craftedKind: 'انگشتر', maxPrice: '۱۰۰٬۰۰۰٬۰۰۰' });
  await expectResults(['low', 'boundary', 'legacy'], 'explicit price ceiling combines with ring type, exact boundary and multi-quantity lot');
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(filterField('query'))}).value`), '', 'Escape discards the search draft');
  await updateFilters({ minPrice: '۶۰٬۰۰۰٬۰۰۰', maxPrice: '۱۰۰٬۰۰۰٬۰۰۰', category: 'crafted', minWeight: '۴', maxWeight: '۶' });
  await expectResults(['low', 'legacy'], 'Persian price and weight boundaries combine with category and inferred ring type');
  await updateFilters({ query: 'آریا' });
  await expectResults(['low'], 'text search combines with all price, weight and type filters');
  await updateFilters({ query: 'ZG-FILTER-LEGACY' });
  await expectResults(['legacy'], 'code query and old description-only ring classification both work');
  await updateFilters({ query: '' });
  await click('[data-clear-vault-filter="maxWeight"]');
  await expectResults(['low', 'boundary', 'legacy'], 'removing one chip only relaxes its own bound');
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(filterField('maxPrice'))}).value`), '۱۰۰٬۰۰۰٬۰۰۰', 'clearing weight retains the price ceiling');
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(filterField('minWeight'))}).value`), '۴', 'clearing maximum weight retains minimum weight');
  assert.equal(await evaluate(`document.querySelector('.vault-assets').textContent`), assetTotalsBeforeFiltering, 'searching never changes total assets');
  await noOverflow('desktop combined vault filters'); await screenshot('inventory-filters-desktop');
  await openFilters();
  await noOverflow('desktop expanded vault filters'); await screenshot('inventory-filters-open-desktop');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await pause(250);
  await noOverflow('mobile expanded vault filters'); await screenshot('inventory-filters-open-mobile');
  await click('[data-cancel-vault-filters]');
  await noOverflow('mobile collapsed vault filters'); await screenshot('inventory-filters-mobile');

  await updateFilters({ query: 'نام ناموجود' });
  await expectResults([], 'combined search can return no matches');
  await ready('.vault-empty');
  await resetFilters();
  await expectResults(allAvailable, 'reset recovers from no matches');
  for (const name of ['minPrice', 'maxPrice', 'minWeight', 'maxWeight']) assert.equal(await evaluate(`document.querySelector(${JSON.stringify(filterField(name))}).value`), '', `reset clears ${name}`);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(filterQuery)}).value`), '');
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(filterField('category'))}).value`), 'all');
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(filterField('craftedKind'))}).value`), 'all');
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(filterField('status'))}).value`), 'available');
  await updateFilters({ craftedKind: 'انگشتر', maxPrice: '۱۰۰٬۰۰۰٬۰۰۰', status: 'empty' });
  await expectResults(['sold'], 'sold-out status combines with price and ring type');
  await updateFilters({ status: 'all' });
  await expectResults(['low', 'boundary', 'legacy', 'sold'], 'all status includes matching sold-out history');
  await resetFilters();
  await updateFilters({ category: 'coin', coinType: 'امامی', maxPrice: '۸۰٬۰۰۰٬۰۰۰' });
  await expectResults(['coin'], 'coin subtype and per-unit price combine');
  await updateFilters({ category: 'currency', currencyType: 'USD', maxPrice: '۱۰۰٬۰۰۰' });
  await expectResults(['usd'], 'changing group drops an irrelevant coin subtype; currency price is per unit');
  await resetFilters();
  await openFilters();
  await fill(filterField('minPrice'), '۱۰۰'); await fill(filterField('maxPrice'), '۹۹');
  await ready('.vault-filters [role="alert"]');
  assert.ok(await evaluate(`Boolean(document.querySelector('.vault-filters [aria-invalid="true"]'))`), 'reversed price limits identify invalid fields');
  await click('[data-apply-vault-filters]');
  assert.equal(await filtersExpanded(), true, 'invalid price ranges keep the panel open');
  await expectResults(allAvailable, 'invalid price ranges do not replace the applied results');
  await resetFilters();
  await fill(filterField('minWeight'), '۶'); await fill(filterField('maxWeight'), '۴');
  await ready('.vault-filters [role="alert"]');
  assert.ok(await evaluate(`Boolean(document.querySelector('.vault-filters [aria-invalid="true"]'))`), 'reversed weight limits identify invalid fields');
  await click('[data-apply-vault-filters]');
  await expectResults(allAvailable, 'invalid weight ranges do not replace the applied results');
  await resetFilters();
  await fill(filterField('maxPrice'), 'نامعتبر');
  await ready('.vault-filters [role="alert"]');
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(filterField('maxPrice'))}).getAttribute('aria-invalid')`), 'true', 'malformed price input has a visible validation error');
  await click('[data-apply-vault-filters]');
  await expectResults(allAvailable, 'malformed price input cannot affect applied results');
  await resetFilters();
  await applyFilters();

  // Repricing through the actual form must affect both card prices and filters.
  await navigate('pricing'); await fill('.price-form [name="goldGramPrice"]', '20000000');
  await click('.price-form button[type="submit"]'); await ready('.price-form .form-message.success');
  await navigate('vault'); await updateFilters({ craftedKind: 'انگشتر', maxPrice: '۱۰۰٬۰۰۰٬۰۰۰' });
  await expectResults([], 'fresh market rates immediately affect the price ceiling');
  await updateFilters({ maxPrice: '۱۱۷٬۶۰۰٬۰۰۰' });
  await expectResults(['low'], 'new unit price and filter share the same charge-inclusive formula');
  assert.ok(await evaluate(`document.querySelector('[data-product-code="ZG-FILTER-LOW"] .vault-item-price').textContent.includes('۱۱۷٬۶۰۰٬۰۰۰')`), 'card displays the new price used by the filter');
  assert.deepEqual(await evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(filterStorageKey)}))`), filterDocuments, 'filtering and repricing preserve every original document');
  await noOverflow('mobile repriced vault filters');
  await navigate('search'); await fill('.search-controls input', 'ZG-FILTER-LOW');
  assert.equal(await evaluate(`document.querySelector('[data-trade-gold-price]').textContent`), 'طلای ۱۸ عیار هنگام ثبت: ثبت نشده', 'legacy trades explicitly show that their historical gold rate was not recorded');
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(filterStorageKey)})).find(record => record.id === 'low').gold18Price`), undefined, 'legacy gold snapshots are never inferred from invoice prices or new market rates');
  }
  await runJewelrySetChecks({ cdp, evaluate, ready, click, fill, navigate, screenshot, noOverflow, pause });
  assert.equal(errors.length,0,JSON.stringify(errors));
  if (!process.argv.includes('--sets-only')) console.log('Inventory browser checks passed: opening/purchase/sale timestamps and visible minutes; immutable trade-only gold snapshots, manual override, latest saved rate, unchanged original invoice amounts, legacy missing rates; stable product codes, auto-filled sales, partial/full depletion, oversell blocking, archive and search, coin/melted metadata, historical reconciliation, reload/account isolation; collapsed filter panel, draft/apply/cancel/Escape, combined type/price/weight/query/status filters, removed suggestion, Persian numeric input, per-unit/current-rate prices, removable chips, invalid drafts preserving results, reset/no-results recovery, coin/currency subtypes, unchanged saved documents, desktop/mobile layouts.');
} catch (error) {
  if (cdp && socket?.readyState === WebSocket.OPEN) {
    try {
      const diagnostics = await cdp('Runtime.evaluate', { expression: `JSON.stringify({active:document.activeElement?.outerHTML.slice(0,200),form:document.querySelector('.cheque-editor')?.textContent,scrollX,width:innerWidth,rail:document.querySelector('.workspace-rail')?.getBoundingClientRect().toJSON(),content:document.querySelector('.workspace-content')?.getBoundingClientRect().toJSON()})`, returnByValue: true });
      console.error('Browser failure state:', diagnostics.result.value);
    } catch { /* Preserve the original failure. */ }
  }
  throw error;
} finally {
  if (socket?.readyState === WebSocket.OPEN && cdp) {
    try { await cdp('Browser.close'); } catch { /* Browser may close the socket before replying. */ }
  }
  socket?.close();
  if (chrome.exitCode === null) chrome.kill();
  server.closeAllConnections();
  await new Promise(resolveClose => server.close(resolveClose));
  // Only remove the unique temporary profile this script created.
  const resolvedProfile = resolve(profile);
  if (dirname(resolvedProfile) === resolve(tmpdir()) && basename(resolvedProfile).startsWith('zar-inventory-check-')) {
    try { await rm(resolvedProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }); } catch { /* A closing Chrome process may briefly retain a lock. */ }
  }
}
