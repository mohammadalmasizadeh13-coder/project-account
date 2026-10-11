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
  env: { ...process.env, DATABASE_URL: `sqlite:///${join(temporary, 'customer-details-test.db').replaceAll('\\', '/')}`,
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
  const birthDateInput = '۱۳۷۰/۰۱/۰۲';
  const identity = {
    customerName: 'مشتری مشخصات کامل', customerPhone: '09123456789',
    customerBirthDate: persianToIso(birthDateInput), customerNationalId: '0012345678',
    customerAddress: 'تهران، خیابان آزمون\nپلاک ۱۲، واحد ۳',
  };
  const paymentMethod = 'بخشی کارت به کارت به حساب فروشگاه\nباقی مبلغ با چک شماره ۱۲۳ در پایان ماه';
  const checkSheet = async (customerIdentity = identity, paymentText = paymentMethod) => {
    await ready('.invoice-sheet');
    assert.ok((await text('.invoice-customer')).includes(customerIdentity.customerName), 'The buyer or seller name stays in the invoice header');
    for (const selector of ['.invoice-item-code', '.invoice-customer-details', '[data-invoice-customer-phone]', '[data-invoice-customer-birth-date]', '[data-invoice-customer-national-id]', '[data-invoice-customer-address]', '[data-invoice-payment-method]']) {
      assert.equal(await evaluate(`document.querySelectorAll('.invoice-sheet '+${JSON.stringify(selector)}).length`), 0, `${selector} is absent from the customer invoice`);
    }
    const sheet = await text('.invoice-sheet');
    assert.ok(!sheet.includes(paymentText), 'Saved free-text payment instructions stay off the customer invoice');
    assert.ok(!sheet.includes('NG-ID-001') && !sheet.includes('NG-ID-002'), 'Internal product codes stay off the customer invoice');
    assert.ok((await text('.invoice-footer')).includes('محاسبه تمامی کار های ساخته با احتساب ۷ درصد میباشد'), 'The requested crafted-work notice appears at the bottom');
  };
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Fetch.enable', { patterns: [{ urlPattern: '*fonts.googleapis.com*' }, { urlPattern: '*fonts.gstatic.com*' }] });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await go('/login'); await ready('#account-password');
  await until(`!document.querySelector('.accounting-submit').disabled`, 'Login is ready');
  await fill('#account-username', username);
  await fill('#account-password', password);
  await click('.accounting-submit'); await ready('.workspace-page');

  const initial = await workspace();
  const ring = { id: 'identity-ring', category: 'crafted', source: 'opening-inventory', type: 'crafted-purchase', productCode: 'NG-ID-001', itemName: 'انگشتر آزمون مشخصات', craftedKind: 'انگشتر', itemCount: '5', weight: '1.25', ayar: '750', wagePercent: '0', wageFixed: '0', profitPercent: '0', gramPrice: '6000000', date: '2026-09-20' };
  const bangle = { ...ring, id: 'identity-bangle', productCode: 'NG-ID-002', itemName: 'النگو آزمون مشخصات', craftedKind: 'النگو', itemCount: '2', weight: '0.75' };
  const seeded = await browserApi('/api/owner/workspace', { method: 'PUT', body: { revision: initial.revision, data: { ...initial.data, documents: [ring, bangle], customers: [], openingSetup: { completed: true }, prices: { goldGramPrice: '6000000' } } } });
  assert.equal(seeded.status, 200, JSON.stringify(seeded.body));
  await go('/account'); await ready('.workspace-page'); await tool('register');
  for (const [key, supplied] of Object.entries(identity)) await fill(field(key), key === 'customerBirthDate' ? birthDateInput : key === 'customerNationalId' ? '۰۰۱۲۳۴۵۶۷۸' : supplied);
  await fill(field('productCode'), ring.productCode);
  await fill(field('profitPercent'), '0');
  await fill(field('gold18Price'), '6000000');
  await fill(field('customerBirthDate'), '1370/13/40');
  await click('[data-invoice-add]');
  assert.equal(await evaluate(`document.querySelectorAll('[data-invoice-row]').length`), 0, 'An invalid optional birthday cannot silently disappear from the saved customer');
  assert.equal(await evaluate(`document.querySelector('[name="customerBirthDate"]').getAttribute('aria-invalid')`), 'true');
  await fill(field('customerBirthDate'), birthDateInput);
  await click('[data-invoice-add]');
  await fill(field('productCode'), bangle.productCode);
  await fill(field('profitPercent'), '0');
  await click('[data-invoice-add]');
  assert.equal(await evaluate(`document.querySelectorAll('[data-invoice-row]').length`), 2);
  await click('.document-form button[type="submit"]'); await ready('[data-invoice-payment-step]');
  assert.equal(await evaluate(`document.querySelector('[name="paymentMethod"]').tagName`), 'TEXTAREA', 'Payment instructions accept free text');
  await fill('[name="paymentMethod"]', paymentMethod);
  await fill('[name="cashPaid"]', '1000000');
  await click('[data-invoice-payment-back]');
  await until(`!document.querySelector('[data-invoice-payment-step]')`, 'Return to invoice rows');
  assert.equal(await value(field('customerName')), identity.customerName);
  assert.equal(await value(field('customerAddress')), identity.customerAddress);
  assert.equal(await evaluate(`document.querySelectorAll('[data-invoice-row]').length`), 2, 'Going back retains the full draft');
  await go('/account'); await ready('.workspace-page'); await tool('register');
  assert.equal(await evaluate(`document.querySelectorAll('[data-invoice-row]').length`), 2, 'Reload restores all draft rows');
  assert.equal(await value(field('customerBirthDate')), birthDateInput, 'Reload restores the Persian birthday');
  assert.equal(await value(field('customerAddress')), identity.customerAddress, 'Reload restores the multiline address');
  await click('.document-form button[type="submit"]'); await ready('[data-invoice-payment-step]');
  assert.equal(await value('[name="paymentMethod"]'), paymentMethod, 'Reload and the payment step retain arbitrary payment text');
  await click('[data-invoice-payment-confirm]');
  await checkSheet();
  assert.ok(await text('[data-invoice-cash-paid]'), 'The cash settlement amount stays visible');
  assert.equal(await evaluate(`document.querySelector('[data-invoice-settlement-rate]').previousElementSibling.textContent.trim()`), 'نرخ هر گرم طلای ۱۸ عیار', 'The settlement rate uses the customer-facing gold-rate label');
  const saved = await workspace();
  const rows = saved.data.documents.filter(row => row.customerName === identity.customerName).sort((a, b) => a.invoiceLine - b.invoiceLine);
  assert.equal(rows.length, 2, 'Both rows save together');
  for (const row of rows) {
    for (const [key, expected] of Object.entries(identity)) assert.equal(row[key], expected, `Each saved row retains ${key}`);
    assert.equal(row.paymentMethod, paymentMethod);
  }
  const customer = saved.data.customers.find(item => item.name === identity.customerName);
  assert.ok(customer, 'The new customer receives a profile');
  for (const [key, documentKey] of Object.entries({ phone: 'customerPhone', birthDate: 'customerBirthDate', address: 'customerAddress', nationalId: 'customerNationalId' })) assert.equal(customer[key], identity[documentKey]);
  await screenshot('customer-details-invoice-desktop', '.invoice-sheet');
  await cdp('Emulation.setEmulatedMedia', { media: 'print' });
  await checkSheet();
  for (const selector of ['.invoice-customer', '[data-invoice-cash-paid]', '[data-invoice-settlement-rate]', '[data-invoice-total]', '.invoice-footer']) {
    assert.ok(await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});return el.getBoundingClientRect().height>0&&getComputedStyle(el).visibility!=='hidden';})()`), `${selector} remains visible in print`);
  }
  await cdp('Emulation.setEmulatedMedia', { media: '' });
  const pdf = Buffer.from((await cdp('Page.printToPDF', { printBackground: true, preferCSSPageSize: true })).data, 'base64');
  await writeFile('artifacts/customer-details-invoice-print.pdf', pdf);
  assert.equal((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length, 1, 'The complete two-row invoice fits on one A5 page');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Customer details fit the mobile viewport');
  await screenshot('customer-details-invoice-mobile', '.invoice-dialog');
  await click('[data-invoice-close]');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });

  await go('/account'); await ready('.workspace-page'); await tool('crm');
  await click(`[data-customer-id="${customer.id}"]`);
  await click('.crm-account-details summary');
  assert.ok((await text('.crm-facts')).includes(identity.customerNationalId), 'CRM displays the national ID');
  await click(`.crm-history [data-view-invoice="${rows[0].transactionId}"]`); await checkSheet();
  await click('[data-invoice-close]');
  await click('.crm-edit-button');
  assert.equal(await value('.crm-editor [name="nationalId"]'), identity.customerNationalId, 'CRM can edit the saved national ID');
  await fill('.crm-editor [name="nationalId"]', '۰۰۹۸۷۶۵۴۳۲');
  await click('.crm-editor button[type="submit"]');
  await until(`!document.querySelector('.crm-editor')`, 'CRM edit saves');
  await until(`fetch('/api/owner/workspace').then(response => response.json()).then(saved => saved.data.customers.some(item => item.id === ${JSON.stringify(customer.id)} && item.nationalId === '0098765432'))`, 'CRM edit is acknowledged by the server');
  const changedProfile = await workspace();
  const updatedCustomer = changedProfile.data.customers.find(item => item.id === customer.id);
  assert.equal(updatedCustomer.nationalId, '0098765432');
  for (const key of ['phone', 'birthDate', 'address', 'gramDebt', 'rialDebt']) assert.equal(updatedCustomer[key], customer[key], `CRM preserves ${key}`);
  await click(`.crm-history [data-view-invoice="${rows[0].transactionId}"]`); await checkSheet();
  await click('[data-invoice-close]');
  await tool('register');
  await fill(field('customerId'), customer.id);
  assert.equal(await value(field('customerName')), identity.customerName);
  assert.equal(await value(field('customerPhone')), identity.customerPhone);
  assert.equal(await value(field('customerBirthDate')), birthDateInput);
  assert.equal(await value(field('customerNationalId')), '0098765432', 'Selecting an existing customer fills the latest profile');
  assert.equal(await value(field('customerAddress')), identity.customerAddress);
  await fill(field('customerId'), '');
  for (const key of Object.keys(identity)) assert.equal(await value(field(key)), '', `Selecting a new customer clears ${key}`);
  await fill('[data-document-type]', 'coin-purchase');
  const purchaseCustomer = { ...identity, customerName: 'مشتری خرید با مشخصات', customerNationalId: '0033333333' };
  for (const [key, supplied] of Object.entries(purchaseCustomer)) await fill(field(key), key === 'customerBirthDate' ? birthDateInput : supplied);
  const purchasePayment = 'واریز به حساب فروشنده\nشماره پیگیری ۴۵۶';
  assert.equal(await evaluate(`document.querySelector('.document-form [name="paymentMethod"]').tagName`), 'TEXTAREA', 'Purchase also has a free text payment field');
  await fill(field('paymentMethod'), purchasePayment);
  await fill(field('itemName'), 'سکه آزمون مشخصات خرید');
  await fill(field('coinCount'), '1'); await fill(field('coinPrice'), '200000');
  await fill(field('gold18Price'), '6000000');
  await click('.document-form button[type="submit"]');
  await until(`document.querySelector('.document-form .form-message.success')`, 'Purchase saves');
  const purchased = await workspace();
  const purchase = purchased.data.documents.find(row => row.customerName === purchaseCustomer.customerName);
  assert.ok(purchase, 'A purchase with a new customer saves');
  assert.equal(purchase.paymentMethod, purchasePayment);
  for (const [key, supplied] of Object.entries(purchaseCustomer)) assert.equal(purchase[key], supplied);
  await tool('search');
  await click(`.document-card[data-invoice-id="${purchase.transactionId}"] [data-invoice-view]`);
  await checkSheet(purchaseCustomer, purchasePayment);
  await click('[data-invoice-close]');
  assert.equal(errors.length, 0, `No uncaught browser exceptions: ${JSON.stringify(errors)}`);
  console.log('Customer details browser checks passed: customer entry, draft reload, saved private customer/payment details, CRM editing, buyer/seller names and settlement amounts, hidden internal invoice details, requested footer notice, desktop/mobile display and A5 print.');

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
