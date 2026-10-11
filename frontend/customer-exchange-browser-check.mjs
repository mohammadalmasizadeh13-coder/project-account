import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer, request } from 'node:http';
import { cp, readFile, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { navigateWorkspace } from './browser-navigation.mjs';
import { persianToIso } from './src/persianDate.js';

// Run after building from frontend. All financial records and Chrome data are disposable.
const origin = 'http://127.0.0.1:4196';
const backendOrigin = 'http://127.0.0.1:8023';
const debugOrigin = 'http://127.0.0.1:9246';
const pause = ms => new Promise(done => setTimeout(done, ms));
const temporary = await mkdtemp(join(tmpdir(), 'zar-customer-details-check-'));
const builtFrontend = join(temporary, 'dist');
await cp(resolve('dist'), builtFrontend, { recursive: true });
const username = 'customer-details-bootstrap';
const password = randomBytes(24).toString('base64url');
const hashed = spawnSync(resolve('../backend/.venv/Scripts/python.exe'), ['-c', 'import sys; from app.security import hash_password; print(hash_password(sys.stdin.read()))'], {
  cwd: resolve('../backend'), input: password, encoding: 'utf8', windowsHide: true,
});
assert.equal(hashed.status, 0, 'Backend password helper works');
const backend = spawn(resolve('../backend/.venv/Scripts/python.exe'), ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8023'], {
  cwd: resolve('../backend'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, DATABASE_URL: `sqlite:///${join(temporary, 'customer-exchange-test.db').replaceAll('\\', '/')}`,
    NOOR_UPLOAD_DIR: join(temporary, 'uploads'), NOOR_OWNER_USERNAME: username, NOOR_OWNER_PASSWORD_HASH: hashed.stdout.trim(),
    NOOR_COOKIE_SECURE: 'false', FRONTEND_ORIGINS: origin, GOLD_RATE_URL: '', GOLD_RATE_TOKEN: '' },
});
let backendLog = '';
let backendError;
backend.on('error', error => { backendError = error; });
backend.stdout.on('data', chunk => { backendLog += chunk.toString(); });
backend.stderr.on('data', chunk => { backendLog += chunk.toString(); });
const server = createServer(async (req, res) => {
  const path = new URL(req.url, origin).pathname;
  if (path.startsWith('/api/')) {
    const forwarded = request(`${backendOrigin}${req.url}`, { method: req.method, headers: { ...req.headers, host: '127.0.0.1:8023' } }, upstream => {
      res.writeHead(upstream.statusCode, upstream.headers); upstream.pipe(res);
    });
    forwarded.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(forwarded); return;
  }
  const asset = path.startsWith('/assets/') ? path.slice(1) : 'index.html';
  const file = resolve(builtFrontend, asset);
  if (!file.startsWith(`${builtFrontend}/`) && !file.startsWith(`${builtFrontend}\\`)) { res.writeHead(404); res.end(); return; }
  try {
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml' })[extname(asset)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
let chrome;
let socket;
let cdp;
let chromeLog = '';
const errors = [];

try {
  let backendReady = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (backendError) throw backendError;
    if (backend.exitCode !== null) throw Error(`Backend exited: ${backendLog}`);
    try { if ((await fetch(`${backendOrigin}/api/health`, { signal: AbortSignal.timeout(1000) })).ok) { backendReady = true; break; } } catch { /* Starting. */ }
    await pause(150);
  }
  assert.ok(backendReady, `Backend starts: ${backendLog}`);
  await new Promise((done, reject) => { server.once('error', reject); server.listen(4196, '127.0.0.1', done); });
  chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--disable-software-rasterizer', '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=9246', `--user-data-dir=${join(temporary, 'chrome')}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let chromeError;
  chrome.on('error', error => { chromeError = error; });
  chrome.stderr.on('data', chunk => { chromeLog += chunk.toString(); });
  let targets;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (chromeError) throw chromeError;
    try { targets = await (await fetch(`${debugOrigin}/json`, { signal: AbortSignal.timeout(1000) })).json(); break; } catch { await pause(150); }
  }
  assert.ok(targets?.some(target => target.type === 'page'), `Chrome starts: ${chromeLog}`);
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((done, reject) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    if (message.method === 'Fetch.requestPaused') cdp('Fetch.fulfillRequest', { requestId: message.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/css' }], body: '' }).catch(error => errors.push(String(error)));
    const waiting = pending.get(message.id);
    if (waiting) { pending.delete(message.id); message.error ? waiting.reject(message.error) : waiting.resolve(message.result); }
  });
  cdp = (method, params = {}) => new Promise((done, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timed out: ${method}`)); }, 15000);
    pending.set(id, { resolve: result => { clearTimeout(timer); done(result); }, reject: error => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until = async (expression, description) => {
    for (let attempt = 0; attempt < 100; attempt++) { if (await evaluate(`(async () => Boolean(await (${expression})))()`)) return; await pause(100); }
    throw Error(`Timed out: ${description || expression}`);
  };
  const ready = selector => until(`document.querySelector(${JSON.stringify(selector)})`, selector);
  const go = async path => { await cdp('Page.navigate', { url: `${origin}${path}` }); await pause(250); };
  const click = async selector => {
    await ready(selector);
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',inline:'center',behavior:'instant'})`);
    await pause(100);
    const point = await evaluate(`(() => { const element=document.querySelector(${JSON.stringify(selector)}); const box=element.getBoundingClientRect(); const x=box.x+box.width/2,y=box.y+box.height/2; const hit=document.elementFromPoint(x,y); return {x,y,visible:box.width>0&&box.height>0&&(element===hit||element.contains(hit))}; })()`);
    assert.ok(point.visible, `Visible click target: ${selector}`);
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await pause(120);
  };
  const fill = async (selector, value) => {
    await ready(selector);
    await evaluate(`(() => { const input=document.querySelector(${JSON.stringify(selector)}); const proto=input.tagName==='SELECT'?HTMLSelectElement.prototype:input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(input,${JSON.stringify(value)}); input.dispatchEvent(new Event(input.tagName==='SELECT'?'change':'input',{bubbles:true})); })()`);
    await pause(45);
  };
  const browserApi = (path, options = {}) => evaluate(`(async () => { const session=await fetch('/api/auth/session').then(r=>r.json()); const options=${JSON.stringify(options)}; const response=await fetch(${JSON.stringify(path)},{...options,headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrfToken||''},...(options.body===undefined?{}:{body:JSON.stringify(options.body)})});return {status:response.status,body:await response.json()};})()`);
  const screenshot = async (name, selector) => {
    await mkdir('artifacts', { recursive: true });
    const originalStyle = selector === '.invoice-sheet' ? await evaluate(`(()=>{const dialog=document.querySelector('.invoice-dialog'),overlay=document.querySelector('.invoice-overlay');const original={dialog:dialog.getAttribute('style'),overlay:overlay.getAttribute('style')};dialog.style.maxHeight='none';dialog.style.overflow='visible';overlay.style.placeItems='start center';dialog.scrollTop=0;return original;})()`) : null;
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'start',behavior:'instant'})`);
    await pause(150);
    const clip = await evaluate(`(()=>{const rect=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:rect.x+scrollX,y:rect.y+scrollY,width:rect.width,height:rect.height,scale:1};})()`);
    const result = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip });
    await writeFile(`artifacts/${name}.png`, Buffer.from(result.data, 'base64'));
    if (originalStyle) await evaluate(`(()=>{const original=${JSON.stringify(originalStyle)};for(const [name,style] of Object.entries(original)){const element=document.querySelector('.invoice-'+name);if(style===null)element.removeAttribute('style');else element.setAttribute('style',style);}})()`);
  };
  const field = name => `.document-form [name="${name}"]`;
  const value = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).value`);
  const text = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent.trim()`);
  const workspace = async () => (await browserApi('/api/owner/workspace')).body;
  const tool = name => navigateWorkspace(name, { click, evaluate, pause });
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Fetch.enable', { patterns: [{ urlPattern: '*fonts.googleapis.com*' }, { urlPattern: '*fonts.gstatic.com*' }] });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await go('/login'); await ready('#account-password');
  await until(`!document.querySelector('.accounting-submit').disabled`, 'Login is ready');
  await fill('#account-username', username);
  await fill('#account-password', password);
  await click('.accounting-submit'); await ready('.workspace-page');


  const initial = await workspace();
  const bracelet = { id: 'exchange-bracelet', category: 'crafted', source: 'opening-inventory', type: 'opening-crafted', productCode: 'NG-EX-001', itemName: 'دستبند معاوضه', craftedKind: 'دستبند', itemCount: '1', weight: '4', ayar: '750', wagePercent: '0', wageFixed: '0', profitPercent: '0', gramPrice: '100000', date: '2026-09-20' };
  const seeded = await browserApi('/api/owner/workspace', { method: 'PUT', body: { revision: initial.revision, data: { ...initial.data, documents: [bracelet], customers: [], openingSetup: { completed: true }, prices: { goldGramPrice: '100000' } } } });
  assert.equal(seeded.status, 200, JSON.stringify(seeded.body));
  await go('/account'); await ready('.workspace-page'); await tool('register');
  await fill('[data-document-type]', 'coin-purchase');
  await fill(field('customerName'), 'مشتری معاوضه');
  await fill(field('date'), '۱۴۰۵/۰۷/۱۷');
  await fill(field('invoiceTime'), '10:25');
  await fill(field('itemName'), 'دو ربع سکه');
  await fill(field('coinType'), 'ربع سکه بانکی ۸۶');
  await fill(field('coinCount'), '2');
  await fill(field('coinPrice'), '100000');
  await fill(field('profitPercent'), '0');
  await click('[data-invoice-add]');
  await fill('[data-document-type]', 'misc-purchase');
  await fill(field('itemName'), 'طلای متفرقه معاوضه');
  await fill(field('weight'), '1');
  await fill(field('ayar'), '750');
  await fill(field('gramPrice'), '100000');
  await click('[data-invoice-add]');
  await fill('[data-document-type]', 'crafted-sale');
  await fill(field('productCode'), bracelet.productCode);
  await fill(field('profitPercent'), '0');
  await click('[data-invoice-add]');
  assert.equal(await evaluate(`document.querySelectorAll('[data-invoice-row]').length`), 3, 'Purchase and sale rows share one draft');
  await go('/account'); await ready('.workspace-page'); await tool('register');
  assert.equal(await evaluate(`document.querySelectorAll('[data-invoice-row]').length`), 3, 'Mixed draft survives reload');
  await click('.document-form button[type="submit"]'); await ready('[data-invoice-payment-step]');
  await fill('[name="cashPaid"]', '20000');
  await click('[data-invoice-payment-confirm]'); await ready('.invoice-sheet');
  const saved = await workspace();
  const rows = saved.data.documents.filter(row => row.customerName === 'مشتری معاوضه').sort((a,b) => a.invoiceLine-b.invoiceLine);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(row => row.type), ['coin-purchase', 'misc-purchase', 'crafted-sale']);
  assert.deepEqual(rows.map(row => row.amount), [200000, 100000, 400000]);
  assert.equal(rows[0].settlementVersion, 3);
  assert.equal(rows[0].gramDebt, .8);
  assert.equal(rows[0].settlementRemainder, 80000);
  assert.equal(new Set(rows.map(row => row.invoiceNumber)).size, 1);
  assert.ok(rows.every(row => row.invoiceTime === '10:25'));
  const customer = saved.data.customers.find(item => item.name === 'مشتری معاوضه');
  assert.equal(customer.gramDebt, .8);
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('[data-invoice-row-direction]'),el=>el.textContent)`), ['دریافت از مشتری', 'دریافت از مشتری', 'تحویل به مشتری']);
  assert.ok((await text('.invoice-sheet')).includes('مابه‌التفاوت قابل دریافت از مشتری'));
  await screenshot('customer-exchange-invoice', '.invoice-sheet');
  const pdf = Buffer.from((await cdp('Page.printToPDF', { printBackground: true, preferCSSPageSize: true })).data, 'base64');
  await writeFile('artifacts/customer-exchange-invoice.pdf', pdf);
  assert.equal((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length, 1, 'Mixed invoice fits on one A5 page');
  await evaluate(`document.querySelector('.invoice-dialog').scrollTop = 0; document.querySelector('.invoice-overlay').scrollTop = 0; window.scrollTo(0,0)`);
  await pause(250);
  await click('.invoice-dialog [data-invoice-edit]'); await ready('.document-editor');
  await fill(`[data-document-row="${rows[2].id}"] [name="gramPrice"]`, '50000');
  await click('[data-confirm-document-action="edit"]');
  await until(`!document.querySelector('.document-editor')`, 'Edit completes');
  const edited = await workspace();
  assert.equal(edited.data.customers.find(item=>item.id===customer.id).gramDebt, -.8);
  await go('/account'); await ready('.workspace-page'); await tool('crm');
  await click(`[data-customer-id="${customer.id}"]`);
  await click(`.crm-history [data-view-invoice="${rows[0].transactionId}"]`); await ready('.invoice-sheet');
  assert.ok((await text('.invoice-sheet')).includes('طلب گرمی مشتری'), 'Signed settlement survives reload and CRM');
  assert.ok((await text('.invoice-sheet')).includes('پرداخت نقدی به مشتری'));
  await click('[data-invoice-close]');
  await tool('search');
  await click(`.document-card[data-invoice-id="${rows[0].transactionId}"] [data-invoice-view]`);
  await click('.invoice-dialog [data-invoice-delete]'); await ready('[data-document-action="delete"]');
  await click('[data-confirm-document-action="delete"]');
  await until(`!document.querySelector('.document-editor')`, 'Delete completes');
  const deleted = await workspace();
  assert.equal(deleted.data.customers.find(item=>item.id===customer.id).gramDebt, 0);
  assert.deepEqual(deleted.data.documents.map(row=>row.id), [bracelet.id]);
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log('Customer exchange browser checks passed: mixed rows, draft reload, net settlement, one invoice, print, signed edit, CRM reload, and complete deletion.');
} catch (error) {
  if (errors.length) console.error('Browser exceptions:', JSON.stringify(errors));
  if (String(error?.message).includes('CDP timed out')) console.error('Chrome diagnostics:', chromeLog.slice(-5000));
  if (cdp && socket?.readyState === WebSocket.OPEN) {
    try { const state = await cdp('Runtime.evaluate', { expression: 'JSON.stringify({path:location.pathname,text:document.body.innerText.slice(-5000)})', returnByValue: true }); console.error('Browser state:', state.result.value); } catch { /* Keep original failure. */ }
  }
  throw error;
} finally {
  if (cdp && socket?.readyState === WebSocket.OPEN) { try { await cdp('Browser.close'); } catch { /* Chrome may close first. */ } }
  socket?.close(); if (chrome?.exitCode === null) chrome.kill();
  if (backend.exitCode === null) backend.kill();
  server.closeAllConnections(); if (server.listening) await new Promise(done => server.close(done));
  const candidate = resolve(temporary);
  if (dirname(candidate) === resolve(tmpdir()) && basename(candidate).startsWith('zar-customer-details-check-')) {
    try { await rm(candidate, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }); } catch { /* A stopped child may briefly retain its profile lock. */ }
  }
}
