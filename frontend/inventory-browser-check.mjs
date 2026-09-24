import { navigateWorkspace } from './browser-navigation.mjs';
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
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',inline:'center',behavior:'instant'})`);
    await pause(180);
    const point = await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      const box = element.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      const hit = document.elementFromPoint(x, y);
      return {x,y,width:box.width,height:box.height,clickable:Boolean(hit && (element === hit || element.contains(hit)))};
    })()`);
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
  await evaluate(`localStorage.setItem('zarngarCurrentUser', ${JSON.stringify(account)}); location.reload()`);
  await ready('.workspace-rail'); await navigate('opening'); await ready('.opening-shell');
  await fill('.opening-rate-panel [name="goldGramPrice"]', '۱۰۰');
  await fill('.opening-item-card:first-child .form-grid label:nth-child(1) input', 'النگو مشترک');
  await fill('.opening-item-card:first-child .form-grid label:nth-child(2) input', '۲');
  await fill('.opening-item-card:first-child .form-grid label:nth-child(3) input', '۳');
  await click('.opening-shell button[type="submit"]'); await ready('.opening-shell .form-message.success');
  const opening = (await stored())[0];
  assert.ok(opening.productCode); assert.equal(opening.source, 'opening-inventory');
  await navigate('vault'); await ready('.vault-item');
  assert.equal(await evaluate(`document.querySelectorAll('.vault-item').length`), 1);
  const field = name => `.document-form [name="${name}"]`;
  const submit = () => click('.document-form button[type="submit"]');
  const begin = async type => { await navigate('register'); await fill('.document-form select[name="type"]', type); };
  const enter = async values => { for (const [name,value] of Object.entries(values)) await fill(field(name), value); };
  await begin('crafted-purchase');
  await enter({ customerName: 'فروشنده', itemName: 'النگو مشترک', itemCount: '1', weight: '4', gramPrice: '100', ayar: '750', wagePercent: '0' });
  await submit(); await ready('.document-form .form-message.success');
  const purchase = (await stored())[0]; assert.notEqual(purchase.productCode, opening.productCode);
  await begin('crafted-sale');
  await fill(field('productCode'), toPersianDigits(opening.productCode.toLowerCase()));
  assert.equal(await evaluate(`document.querySelector('[name="weight"]').value`), '۳');
  assert.equal(await evaluate(`document.querySelector('[name="weight"]').readOnly`), true);
  await enter({ customerName: 'خریدار', itemCount: '1' }); await submit(); await ready('.document-form .form-message.success');
  let docs = await stored(); assert.equal(docs[0].inventorySourceId, opening.id); assert.equal(docs[0].productCode, opening.productCode);
  await begin('crafted-sale'); await fill(field('productCode'), opening.productCode);
  await enter({ customerName: 'خریدار', itemCount: '2' }); await submit(); await ready('#stock-code-error');
  assert.equal((await stored()).length, docs.length, 'oversell never changes saved records');
  await fill(field('itemCount'), '1'); await submit(); await ready('.document-form .form-message.success');
  await navigate('vault');
  assert.equal(await evaluate(`Boolean(document.querySelector('[data-product-code="${opening.productCode}"]'))`), false, 'sold out lot leaves active vault');
  assert.equal(await evaluate(`Boolean(document.querySelector('[data-product-code="${purchase.productCode}"]'))`), true, 'same-name lot unaffected');
  await fill('[aria-label="وضعیت موجودی"]', 'empty');
  assert.ok(await evaluate(`document.querySelector('[data-product-code="${opening.productCode}"]').textContent.includes('اتمام موجودی')`));
  await evaluate('location.reload()'); await ready('.workspace-rail'); await navigate('vault');
  assert.equal((await stored()).find(doc => doc.id === opening.id).productCode, opening.productCode);
  await fill('[aria-label="جستجو در صندوق"]', purchase.productCode);
  assert.equal(await evaluate(`document.querySelectorAll('.vault-item').length`), 1);
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
    await begin('crafted-sale'); await fill(field('productCode'),source.productCode);
    assert.equal(await evaluate(`document.querySelector('select[name="type"]').value`),`${category}-sale`);
    if(category==='melted') {
      assert.equal(await evaluate(`document.querySelector('[name="laboratoryName"]').value`),'آزمایشگاه تهران');
      assert.equal(await evaluate(`document.querySelector('[name="assayCode"]').value`),'12345');
    }
    await enter({ customerName:'خریدار صندوق', [category==='coin'?'coinCount':'itemCount']:'1' });
    await submit(); await ready('.document-form .form-message.success');
    assert.equal((await stored())[0].inventorySourceId,source.id);
  }
  await navigate('search'); await fill('.search-controls input',opening.productCode);
  assert.equal(await evaluate(`document.querySelectorAll('.document-card').length`),3,'code search shows entry and both sales');

  // Older unnamed sales are shown for explicit reconciliation, never guessed.
  docs=await stored();
  const historical={...docs.find(doc=>doc.inventorySourceId===opening.id),id:'historical-sale',productCode:'',inventorySourceId:'',itemCount:'1',amount:123};
  await evaluate(`localStorage.setItem(${JSON.stringify(storageKey)},${JSON.stringify(JSON.stringify([historical,...docs]))}); location.reload()`);
  await ready('.workspace-rail'); await navigate('vault'); await ready('.vault-legacy');
  await click('.vault-legacy summary'); await fill('.vault-legacy select',purchase.id);
  await click('.vault-legacy-row button');
  await until(`!document.querySelector('.vault-legacy')`,'old sale linked');
  assert.equal((await stored()).find(doc=>doc.id==='historical-sale').amount,123);
  await noOverflow('desktop vault'); await screenshot('inventory-desktop');
  await cdp('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:1,mobile:true}); await pause(300);
  await noOverflow('mobile vault'); await screenshot('inventory-mobile');
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
  await begin('currency-sale'); await fill(field('productCode'), currencyOpening.productCode);
  assert.equal(await evaluate(`document.querySelector('[name="currencyType"]').disabled`), true);
  await enter({ customerName: 'خریدار دلار', currencyAmount: '۲۰٫۲۵' });
  await submit(); await ready('.document-form .form-message.success');
  assert.equal((await assetDocs())[0].amount, 202.5);
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
  await navigate('pricing');
  await fill('.price-form [name="usdPrice"]', '20');
  await fill('.price-form [name="bankOneGram86Price"]', '300');
  await click('.price-form button[type="submit"]'); await ready('.price-form .form-message.success');
  assert.deepEqual(await assetDocs(), originalAssets, 'repricing preserves original documents');
  await navigate('vault');
  assert.ok(await evaluate(`document.querySelector('.vault-holdings').textContent.includes('۸۰٫۲۵')`));
  assert.ok(await evaluate(`document.querySelector('.vault-holdings').textContent.includes('دلار آمریکا')`));
  assert.ok(await evaluate(`document.querySelector('.asset-totals').textContent.includes('۳۱٬۴۱۸')`), 'rial total includes remaining currency, gold, coin rates and costs');
  await noOverflow('mobile assets'); await screenshot('assets-mobile');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false }); await pause(250);
  await noOverflow('desktop assets'); await screenshot('assets-desktop');
  await evaluate('location.reload()'); await ready('.workspace-rail'); await navigate('vault');
  assert.ok(await evaluate(`document.querySelector('.asset-totals').textContent.includes('۳۱٬۴۱۸')`), 'asset balances persist after reload');
  assert.equal(errors.length,0,JSON.stringify(errors));
  console.log('Inventory browser checks passed: opening/purchases, stable product codes, auto-filled sales, partial and full depletion, oversell blocking, archive and search, coin/melted metadata, explicit historical reconciliation, reload/account isolation, mobile layouts.');
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
