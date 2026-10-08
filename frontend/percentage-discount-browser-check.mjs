import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer, request } from 'node:http';
import { cp, readFile, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { navigateWorkspace } from './browser-navigation.mjs';

// Run after building from frontend. All financial records and Chrome data are disposable.
const origin = 'http://127.0.0.1:4198';
const backendOrigin = 'http://127.0.0.1:8025';
const debugOrigin = 'http://127.0.0.1:9248';
const pause = ms => new Promise(done => setTimeout(done, ms));
const temporary = await mkdtemp(join(tmpdir(), 'zar-percentage-check-'));
const builtFrontend = join(temporary, 'dist');
await cp(resolve('dist'), builtFrontend, { recursive: true });
const username = 'percentage-check-bootstrap';
const password = randomBytes(24).toString('base64url');
const hashed = spawnSync(resolve('../backend/.venv/Scripts/python.exe'), ['-c', 'import sys; from app.security import hash_password; print(hash_password(sys.stdin.read()))'], {
  cwd: resolve('../backend'), input: password, encoding: 'utf8', windowsHide: true,
});
assert.equal(hashed.status, 0, 'Backend password helper works');
const backend = spawn(resolve('../backend/.venv/Scripts/python.exe'), ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8025'], {
  cwd: resolve('../backend'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, DATABASE_URL: `sqlite:///${join(temporary, 'percentage-test.db').replaceAll('\\', '/')}`,
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
    const forwarded = request(`${backendOrigin}${req.url}`, { method: req.method, headers: { ...req.headers, host: '127.0.0.1:8025' } }, upstream => {
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
  await new Promise((done, reject) => { server.once('error', reject); server.listen(4198, '127.0.0.1', done); });
  chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--disable-software-rasterizer', '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=9248', `--user-data-dir=${join(temporary, 'chrome')}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
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
    for (let attempt = 0; attempt < 100; attempt++) { if (await evaluate(`Boolean(${expression})`)) return; await pause(100); }
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
  const editor = '[data-document-action="edit"]';
  const editField = name => `${editor} [name="${name}"]`;
  const fa = value => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 6 }).format(value);
  const normalizeNumber = value => String(value).replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).replace(/[٬,\s]/g, '').replace(/٫/g, '.');
  const numberValue = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).value`).then(normalizeNumber);
  const workspace = async () => (await browserApi('/api/owner/workspace')).body;
  const tool = name => navigateWorkspace(name, { click, evaluate, pause });
  const replaceText = async (selector, text) => {
    await ready(selector);
    await evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});input.focus();input.select();})()`);
    await cdp('Input.insertText', { text });
    await pause(80);
  };
  const includesAmount = async (selector, amount, message) => assert.ok(await evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent.includes(${JSON.stringify(fa(amount))})`), message);
  const card = id => `.document-card[data-invoice-id="${id}"]`;
  const viewInvoice = async id => { await tool('search'); await click(`${card(id)} [data-invoice-view]`); await ready('.invoice-sheet'); };
  const editInvoice = async id => { await tool('search'); await click(`${card(id)} [data-invoice-edit]`); await ready(editor); };
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Fetch.enable', { patterns: [{ urlPattern: '*fonts.googleapis.com*' }, { urlPattern: '*fonts.gstatic.com*' }] });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await go('/register'); await ready('#account-password-confirmation');
  await until(`!document.querySelector('.accounting-submit').disabled`, 'Registration is ready');
  await fill('#account-username', 'percentage-discount-check');
  if (await evaluate(`Boolean(document.querySelector('#account-gallery-name'))`)) await fill('#account-gallery-name', 'گالری آزمون تخفیف');
  await fill('#account-password', password); await fill('#account-password-confirmation', password);
  await click('.accounting-submit'); await ready('.workspace-page');

  const empty = await workspace();
  const ring = { id: 'percentage-ring', category: 'crafted', source: 'opening-inventory', type: 'crafted-purchase', productCode: 'NG-PERCENT-001', itemName: 'انگشتر آزمون تخفیف', craftedKind: 'انگشتر', itemCount: '5', weight: '1', ayar: '750', wagePercent: '0', wageFixed: '0', profitPercent: '0', gramPrice: '6000000', date: '2026-10-01' };
  const seeded = await browserApi('/api/owner/workspace', { method: 'PUT', body: { revision: empty.revision, data: { ...empty.data, documents: [ring], customers: [], openingSetup: { completed: true }, prices: { goldGramPrice: '6000000' } } } });
  assert.equal(seeded.status, 200, JSON.stringify(seeded.body));
  await go('/account'); await ready('.workspace-page'); await tool('register');
  await fill(field('customerName'), 'مشتری آزمون تخفیف درصدی');
  await fill(field('gold18Price'), '6000000'); await fill(field('productCode'), ring.productCode);
  await fill(field('itemCount'), '1'); await fill(field('gramPrice'), '6000000');
  await fill(field('wagePercent'), '0'); await fill(field('wageFixed'), '0');
  await fill(field('otherCosts'), '0'); await fill(field('profitPercent'), '0');
  await fill(field('discountRial'), '100000');
  const beforeSave = await workspace();
  await replaceText(field('discountPercent'), '۱۰۱');
  await click('[data-invoice-add]');
  assert.equal(await evaluate(`document.querySelectorAll('[data-invoice-row]').length`), 0, 'A percentage above 100 cannot be added');
  await click('.document-form button[type="submit"]');
  assert.equal(await evaluate(`Boolean(document.querySelector('[data-invoice-payment-step]'))`), false, 'An invalid discount cannot open payment');
  assert.deepEqual(await workspace(), beforeSave, 'Invalid discount leaves server records unchanged');
  await replaceText(field('discountPercent'), '۱۲٫۵');
  assert.equal(await numberValue(field('discountPercent')), '12.5', 'Persian fractional percent survives real text entry');
  const total = 5150000;
  const discount = 850000;
  await includesAmount('.invoice-draft-total', total, 'Live preview subtracts both percentage and fixed discounts');
  await includesAmount('.invoice-draft-total', discount, 'Live discount summary includes the percentage amount');
  await click('[data-invoice-add]');
  await includesAmount('[data-invoice-row="0"]', total, 'Queued row keeps the same discounted total');
  await click('[data-invoice-edit="0"]');
  assert.equal(await numberValue(field('discountPercent')), '12.5', 'Editing an unsaved row restores its percent');
  await click('[data-invoice-add]');
  await click('.document-form button[type="submit"]'); await ready('[data-invoice-payment-step]');
  await includesAmount('[data-invoice-payment-total]', total, 'Payment uses the discounted amount');
  await fill('[name="cashPaid"]', '0'); await click('[data-invoice-payment-confirm]'); await ready('.invoice-sheet');
  const created = await workspace();
  const sale = created.data.documents.find(row => row.customerName === 'مشتری آزمون تخفیف درصدی');
  assert.ok(sale, 'The discounted sale persists');
  assert.equal(Number(sale.discountPercent), 12.5, 'Server preserves the percentage');
  assert.equal(Number(sale.discountRial), 100000, 'Server preserves the fixed discount');
  assert.equal(Number(sale.amount), total, 'Server amount matches preview and payment');
  assert.equal(Number(sale.settlementRemainder), total, 'Unpaid amount uses discounted total');
  assert.equal(Number(sale.gramDebt), 0.858333, 'Gold debt derives from the discounted amount');
  await includesAmount('[data-invoice-discount]', discount, 'Customer invoice shows both discount amounts together');
  await includesAmount('[data-invoice-total]', total, 'Customer invoice shows discounted total');
  assert.ok(await evaluate(`document.querySelector('[data-invoice-discount-percent]').textContent.includes(${JSON.stringify(`${fa(12.5)}٪`)})`), 'Customer invoice shows the percentage used');
  await cdp('Emulation.setEmulatedMedia', { media: 'print' });
  assert.ok(await evaluate(`['[data-invoice-discount]','[data-invoice-discount-percent]'].every(selector=>{const node=document.querySelector(selector);return getComputedStyle(node).display!=='none'&&node.getBoundingClientRect().height>0;})`), 'Discount amount and percentage remain visible in print');
  await cdp('Emulation.setEmulatedMedia', { media: '' });
  await screenshot('percentage-discount-invoice', '.invoice-sheet');
  const pdf = Buffer.from((await cdp('Page.printToPDF', { printBackground: true, preferCSSPageSize: true })).data, 'base64');
  await writeFile('artifacts/percentage-discount-print.pdf', pdf);
  assert.equal((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length, 1, 'Discounted invoice prints on one page');
  await click('[data-invoice-close]');

  await go('/account'); await ready('.workspace-page');
  await viewInvoice(sale.transactionId);
  await includesAmount('[data-invoice-discount]', discount, 'Reloaded invoice keeps the full discount');
  await includesAmount('[data-invoice-total]', total, 'Reloaded invoice keeps the original amount');
  await click('[data-invoice-close]'); await editInvoice(sale.transactionId);
  assert.equal(await numberValue(editField('discountPercent')), '12.5', 'Saved invoice editor restores the percentage');
  await replaceText(editField('discountPercent'), '۱۰۱');
  await click('[data-confirm-document-action="edit"]');
  await until(`document.querySelector('${editor} .document-edit-error')`, 'Invalid saved edit reports an error');
  assert.deepEqual(await workspace(), created, 'Invalid percentage edit leaves all persisted records unchanged');
  await replaceText(editField('discountPercent'), '۲۰');
  const editedTotal = 4700000;
  await includesAmount('.document-edit-preview', editedTotal, 'Saved invoice editor recalculates percent changes');
  await click('[data-confirm-document-action="edit"]');
  await until(`!document.querySelector('${editor}')`, 'Percentage edit saved');
  const updated = await workspace();
  const editedSale = updated.data.documents.find(row => row.id === sale.id);
  assert.equal(Number(editedSale.discountPercent), 20);
  assert.equal(Number(editedSale.discountRial), 100000);
  assert.equal(Number(editedSale.amount), editedTotal);
  assert.equal(Number(editedSale.gramDebt), 0.783333, 'Changing the percent updates settled gold debt');
  const customer = updated.data.customers.find(row => row.id === sale.customerId);
  assert.equal(Number(customer.gramDebt), 0.783333, 'Customer balance is reconciled with the new discount');
  await go('/account'); await ready('.workspace-page');
  assert.deepEqual(await workspace(), updated, 'Percentage edit survives a fresh page load');
  await viewInvoice(sale.transactionId);
  await includesAmount('[data-invoice-total]', editedTotal, 'Edited invoice prints the newly discounted total');
  await includesAmount('[data-invoice-discount]', 1300000, 'Edited invoice shows new combined discount');
  assert.ok(await evaluate(`document.querySelector('.invoice-sheet').textContent.includes(${JSON.stringify(`${fa(20)}٪`)})`), 'Edited invoice shows the saved new percent');
  assert.equal(errors.length, 0, `No uncaught browser exceptions: ${JSON.stringify(errors)}`);
  console.log('Percentage discount browser checks passed: Persian fractional input; invalid create/edit rejection; combined fixed and percentage preview, payment and persisted totals; row editing; invoice reload and editing; customer debt reconciliation; printed percent and total.');

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
  if (dirname(candidate) === resolve(tmpdir()) && basename(candidate).startsWith('zar-percentage-check-')) {
    try { await rm(candidate, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }); } catch { /* A stopped child may briefly retain its profile lock. */ }
  }
}
