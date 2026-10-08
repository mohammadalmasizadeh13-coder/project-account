import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, request } from 'node:http';
import { cp, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { navigateWorkspace } from './browser-navigation.mjs';

// Disposable database, isolated browser profile, and real UI/API interactions.
const origin = 'http://127.0.0.1:4193';
const backendOrigin = 'http://127.0.0.1:8019';
const debugOrigin = 'http://127.0.0.1:9241';
const temporary = await mkdtemp(join(tmpdir(), 'zar-accounting-check-'));
const built = join(temporary, 'dist');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
await cp(resolve('dist'), built, { recursive: true });
await mkdir(resolve('artifacts'), { recursive: true });
const backend = spawn(resolve('../backend/.venv/Scripts/python.exe'), ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8019'], {
  cwd: resolve('../backend'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, DATABASE_URL: `sqlite:///${join(temporary, 'test.db').replaceAll('\\', '/')}`, NOOR_OWNER_USERNAME: '', NOOR_OWNER_PASSWORD_HASH: '', NOOR_COOKIE_SECURE: 'false', FRONTEND_ORIGINS: origin, NOOR_UPLOAD_DIR: join(temporary, 'uploads') },
});
let backendLog = '', browserLog = '';
backend.stdout.on('data', data => { backendLog += data; });
backend.stderr.on('data', data => { backendLog += data; });
const requests = [];
let dropNextInvoiceResponse = false;
let dropNextExpenseResponse = false;
const server = createServer(async (req, res) => {
  const path = new URL(req.url, origin).pathname;
  if (path.startsWith('/api/')) {
    const entry = { path, method: req.method };
    requests.push(entry);
    if (path === '/api/owner/workspace' && req.method === 'PUT') {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => { entry.body = JSON.parse(Buffer.concat(chunks).toString()); });
    }
    const forwarded = request(`${backendOrigin}${req.url}`, { method: req.method, headers: req.headers }, upstream => {
      if (dropNextInvoiceResponse && req.method === 'POST' && /\/partners\/[^/]+\/invoices$/.test(path) && upstream.statusCode >= 200 && upstream.statusCode < 300) {
        dropNextInvoiceResponse = false;
        upstream.resume(); upstream.on('end', () => {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ detail: 'پاسخ ثبت دریافت نشد؛ همان ثبت را بازیابی کنید.' }));
        }); return;
      }
      if (dropNextExpenseResponse && req.method === 'PUT' && path === '/api/owner/workspace' && upstream.statusCode >= 200 && upstream.statusCode < 300) {
        dropNextExpenseResponse = false;
        upstream.resume(); upstream.on('end', () => {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ detail: 'پاسخ ثبت هزینه دریافت نشد؛ همان ثبت را بازیابی کنید.' }));
        }); return;
      }
      res.writeHead(upstream.statusCode, upstream.headers); upstream.pipe(res);
    });
    forwarded.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(forwarded); return;
  }
  try {
    const file = path.startsWith('/assets/') ? join(built, path.slice(1)) : join(built, 'index.html');
    const content = await readFile(file);
    res.writeHead(200, { 'Content-Type': { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.webp': 'image/webp' }[extname(file)] || 'application/octet-stream' });
    res.end(content);
  } catch { res.writeHead(404); res.end(); }
});
let chrome, socket, cdp, evaluate;
const exceptions = [];
try {
  let healthy = false;
  for (let count = 0; count < 80; count++) {
    if (backend.exitCode !== null) throw Error(`Backend failed: ${backendLog}`);
    try { if ((await fetch(`${backendOrigin}/api/health`, { signal: AbortSignal.timeout(600) })).ok) { healthy = true; break; } } catch {}
    await pause(150);
  }
  assert.ok(healthy, backendLog);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(4193, '127.0.0.1', resolve); });
  chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=9241', `--user-data-dir=${join(temporary, 'chrome')}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  chrome.stderr.on('data', data => { browserLog += data; });
  let targets;
  for (let count = 0; count < 50; count++) {
    try { targets = await (await fetch(`${debugOrigin}/json`, { signal: AbortSignal.timeout(600) })).json(); break; } catch { await pause(150); }
  }
  assert.ok(targets?.some(target => target.type === 'page'), browserLog);
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  const pending = new Map(); let sequence = 0;
  cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve: value => { clearTimeout(timeout); resolve(value); }, reject: value => { clearTimeout(timeout); reject(value); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
    if (message.method === 'Fetch.requestPaused') cdp('Fetch.fulfillRequest', { requestId: message.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/css' }], body: '' }).catch(error => exceptions.push(String(error)));
    if (message.method === 'Page.javascriptDialogOpening') cdp('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
    const waiting = pending.get(message.id);
    if (waiting) { pending.delete(message.id); message.error ? waiting.reject(message.error) : waiting.resolve(message.result); }
  });
  evaluate = async expression => {
    const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until = async (expression, description = expression) => {
    for (let count = 0; count < 100; count++) { if (await evaluate(`Boolean(${expression})`)) return; await pause(100); }
    throw Error(`Timed out: ${description}`);
  };
  const ready = selector => until(`document.querySelector(${JSON.stringify(selector)})`, selector);
  const go = async path => { await cdp('Page.navigate', { url: `${origin}${path}` }); await pause(300); };
  const fill = async (selector, value) => {
    await ready(selector);
    await evaluate(`(() => {const input=document.querySelector(${JSON.stringify(selector)}); const proto=input.tagName==='SELECT'?HTMLSelectElement.prototype:input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(input,${JSON.stringify(value)}); input.dispatchEvent(new Event(input.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);
    await pause(40);
  };
  const click = async selector => {
    await ready(selector);
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);
    await pause(90);
    const box = await evaluate(`(() => { const el=document.querySelector(${JSON.stringify(selector)}), b=el.getBoundingClientRect(); return {x:b.x+b.width/2,y:b.y+b.height/2,visible:!!(b.width&&b.height),disabled:el.disabled};})()`);
    assert.ok(box.visible && !box.disabled, `Clickable: ${selector}`);
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await pause(100);
  };
  const resize = async (width, height = 1000) => { await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 }); await pause(250); };
  const screenshot = async (name, selector = '') => {
    await evaluate(selector ? `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'start',behavior:'instant'})` : 'window.scrollTo(0,0)'); await pause(150);
    const clip = selector ? await evaluate(`(() => {const rect=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:rect.x+scrollX,y:rect.y+scrollY,width:rect.width,height:rect.height,scale:1};})()`) : null;
    const result = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !!selector, ...(clip ? { clip } : {}) });
    await writeFile(resolve(`artifacts/${name}.png`), Buffer.from(result.data, 'base64'));
  };
  const workspace = () => evaluate(`fetch('/api/owner/workspace').then(r=>r.json())`);
  const savedPartnerPreview = async () => {
    await ready('[data-partner-document-dialog] [data-invoice-print]');
    await ready('[data-partner-document-dialog] [data-invoice-edit]');
    assert.equal(await evaluate(`Boolean(document.querySelector('[data-partner-document-dialog] [data-partner-invoice], [data-partner-document-dialog] [data-partner-settlement-form]'))`), false, 'Saved partner document shows its preview');
    await click('[data-partner-document-close]');
    await until(`!document.querySelector('[data-partner-document-dialog]')`);
  };
  const tool = async name => {
    if (name !== 'partner-invoice') return navigateWorkspace(name, { click, evaluate, pause });
    await navigateWorkspace('entries', { click, evaluate, pause });
    const genericEntry = await evaluate(`Boolean(document.querySelector('[data-tool="partner-invoice"]'))`);
    await click(genericEntry ? '[data-tool="partner-invoice"]' : '[data-tool="partner-crafted-purchase"]');
  };
  const entryTypes = {
    customer: ['crafted-sale', 'misc-purchase', 'coin-sale', 'coin-purchase', 'melted-sale', 'melted-purchase', 'currency-sale', 'currency-purchase'],
    store: ['expense'],
    partner: ['partner-crafted-purchase', 'partner-melted-purchase', 'partner-coin-purchase', 'partner-remittance'],
  };
  const assertEntryScope = async scope => {
    await ready(`[data-document-scope="${scope}"]`);
    assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('[data-document-scope]'), element => element.dataset.documentScope)`), [scope], 'Only the selected group has an open document form');
    const options = await evaluate(`Array.from(document.querySelectorAll('[data-document-type] option'), option => option.value).filter(Boolean)`);
    if (scope === 'partner') {
      assert.ok(entryTypes.partner.every(type => options.includes(type)), 'Partner entry retains purchase and remittance choices');
      assert.ok(options.every(type => type.startsWith('partner-')), 'Partner document choices stay inside their group');
    } else assert.deepEqual(options, entryTypes[scope], `${scope} document choices stay inside their group`);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth+1'), true, `${scope} entry has no page overflow`);
  };
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Fetch.enable', { patterns: [{ urlPattern: '*fonts.googleapis.com*' }, { urlPattern: '*fonts.gstatic.com*' }] });
  await resize(1440); await go('/'); await ready('.accounting-hero');
  assert.equal(await evaluate(`document.querySelectorAll('a[href="/register"]').length>0`), true);
  assert.equal(await evaluate(`document.querySelector('[class*="storefront"]')!==null`), false);
  await screenshot('accounting-desktop');
  await resize(390, 844); await screenshot('accounting-mobile');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth+1'), true, 'Mobile landing has no overflow');
  await go('/account'); await ready('#account-username');
  await until(`location.pathname==='/login'`);
  await go('/register'); await ready('#account-password-confirmation');
  await until(`!document.querySelector('.accounting-submit').disabled`);
  await fill('#account-gallery-name', 'گالری حساب آلفا'); await fill('#account-username', 'alpha-account'); await fill('#account-password', 'browser-password-alpha'); await fill('#account-password-confirmation', 'incorrect-confirmation');
  await click('.accounting-submit');
  await until(`document.querySelector('[role="alert"]')?.textContent.includes('یکسان')`);
  await fill('#account-password-confirmation', 'browser-password-alpha'); await screenshot('accounting-registration');
  await click('.accounting-submit'); await ready('.workspace-page');
  await until(`location.pathname==='/account'`);
  const alphaEmpty = await workspace();
  assert.equal(alphaEmpty.data.documents.length, 0);
  assert.equal(alphaEmpty.data.customers.length, 0);
  await resize(1440); await tool('register');
  await assertEntryScope('customer');
  const initialCustomerDraft = await evaluate(`JSON.parse(localStorage.getItem('noor-accounting-draft:v1:alpha-account:document'))`);
  const retiredPurchase = {
    ...initialCustomerDraft.form, type: 'crafted-purchase', customerName: 'فروشنده پیش‌نویس قدیمی',
    itemName: 'انگشتر پیش‌نویس قدیمی', craftedKind: 'انگشتر', itemCount: '1', weight: '2', ayar: '750',
    gramPrice: '7500000', gold18Price: '7500000', wagePercent: '0', wageFixed: '0', profitPercent: '0',
    invoiceRows: [], invoiceCurrentEmpty: false, invoiceEditingIndex: -1,
  };
  for (const nested of [false, true]) {
    const form = nested
      ? { ...retiredPurchase, type: 'misc-purchase', itemName: '', weight: '', invoiceRows: [{ ...retiredPurchase }], invoiceCurrentEmpty: true }
      : retiredPurchase;
    const draft = { version: 1, requestId: null, form };
    await evaluate(`localStorage.setItem('noor-accounting-draft:v1:alpha-account:document', ${JSON.stringify(JSON.stringify(draft))})`);
    await go('/account'); await ready('.workspace-page'); await tool('register');
    await assertEntryScope('customer');
    if (!nested) assert.equal(await evaluate(`document.querySelector('[data-document-type]').value`), '', 'Retired purchase is not silently changed into a sale');
    await click('.document-form button[type="submit"]');
    await until(`document.querySelector('.document-form .form-message.error')?.textContent.includes('قابل ثبت نیست')`);
    assert.equal(await evaluate(`document.querySelector('[data-document-type]').getAttribute('aria-invalid')`), 'true', 'The retired type is identified as the invalid field');
    assert.deepEqual(await workspace(), alphaEmpty, 'A restored customer crafted purchase cannot change the ledger');
    await click('[data-invoice-add]');
    await until(`document.querySelector('.document-form .form-message.error')?.textContent.includes('قابل ثبت نیست')`);
    assert.deepEqual(await workspace(), alphaEmpty, 'A retired purchase cannot be added as a new invoice row');
    const preserved = await evaluate(`JSON.parse(localStorage.getItem('noor-accounting-draft:v1:alpha-account:document'))`);
    for (const key of ['type', 'customerName', 'itemName', 'weight', 'gramPrice']) assert.equal(preserved.form[key], retiredPurchase[key], `Blocked legacy draft retains ${key}`);
    assert.equal(preserved.form.invoiceRows.length, nested ? 1 : 0, 'Blocking does not discard a saved invoice row or add another');
    if (nested) assert.equal(preserved.form.invoiceRows[0].type, 'crafted-purchase', 'The retired saved row remains available for explicit removal');
  }
  await evaluate(`localStorage.setItem('noor-accounting-draft:v1:alpha-account:document', ${JSON.stringify(JSON.stringify(initialCustomerDraft))})`);
  await go('/account'); await ready('.workspace-page'); await tool('register');
  await assertEntryScope('customer');
  await fill('.document-form select[name="type"]', 'misc-purchase');
  await fill('.document-form input[name="customerName"]', 'فروشنده طلای دست‌دوم');
  await fill('.document-form input[name="gold18Price"]', '7500000');
  await fill('.document-form input[name="itemName"]', 'طلای متفرقه آزمایشی');
  await fill('.document-form input[name="weight"]', '۱۰');
  await fill('.document-form input[name="ayar"]', '۱۰۰۱');
  await fill('.document-form input[name="gramPrice"]', '7500000');
  await fill('.document-form input[name="itemCount"]', '۲');
  await click('.document-form button[type="submit"]');
  await until(`document.querySelector('[name="ayar"]')?.getAttribute('aria-invalid')==='true'`);
  assert.equal((await workspace()).data.documents.length, 0, 'Invalid purity does not save');
  await fill('.document-form input[name="ayar"]', '۷۴۰');
  assert.ok((await evaluate(`document.querySelector('[data-misc-weight750]').value`)).includes('۹'));
  await go('/account'); await ready('.workspace-page'); await tool('register');
  assert.equal(await evaluate(`document.querySelector('.document-form select[name="type"]').value`), 'misc-purchase', 'Reload restores misc draft');
  await click('.document-form button[type="submit"]');
  await until(`document.querySelector('.form-message.success')?.textContent.includes('ثبت شد')`, 'Misc purchase stored');
  const alphaSaved = await workspace();
  assert.equal(alphaSaved.data.documents.length, 1);
  const misc = alphaSaved.data.documents[0];
  assert.equal(misc.type, 'misc-purchase');
  assert.ok(Math.abs(misc.weight750 - 10*740/750) < 1e-6);
  assert.ok(Math.abs(misc.itemWeight - 2*10*740/750) < 1e-6);
  assert.equal(misc.amount, 148000000);
  assert.equal(Number(misc.profitPercent), 0);
  assert.equal(alphaSaved.data.customers.length, 1);
  await tool('vault'); await ready('.vault-heading'); await screenshot('accounting-misc-vault');
  assert.ok(await evaluate(`document.body.innerText.includes('متفرقه') && document.body.innerText.includes('۷۵۰')`));
  await click('.vault-heading-actions .button-ghost');
  await assertEntryScope('partner');
  assert.equal(await evaluate(`document.querySelector('[data-document-type]').value`), 'partner-crafted-purchase', 'New purchases from the vault open the partner form');
  assert.deepEqual(await workspace(), alphaSaved, 'Opening partner registration does not change saved customer purchases');
  await tool('settings');
  assert.equal(await evaluate(`document.querySelector('[data-settings-tab="storefront"]')!==null`), false);
  await click('[aria-label="خروج از حساب"]'); await ready('.accounting-hero');
  await go('/register'); await ready('#account-password-confirmation'); await until(`!document.querySelector('.accounting-submit').disabled`);
  await fill('#account-gallery-name', 'گالری حساب بتا'); await fill('#account-username', 'alpha-account'); await fill('#account-password', 'browser-password-beta'); await fill('#account-password-confirmation', 'browser-password-beta');
  await click('.accounting-submit'); await until(`document.querySelector('[role="alert"]')?.textContent.includes('قبلاً')`);
  await fill('#account-username', 'beta-account'); await click('.accounting-submit'); await ready('.workspace-page');
  const betaEmpty = await workspace();
  assert.equal(betaEmpty.data.documents.length, 0);
  assert.equal(betaEmpty.data.customers.length, 0);
  assert.equal(betaEmpty.data.partners?.length || 0, 0);
  await tool('register');
  assert.equal(await evaluate(`document.querySelector('.document-form input[name="customerName"]').value`), '', 'No previous account draft');
  const legacyExpenseDraft = { version: 1, requestId: null, form: { type: 'expense', description: 'پیش‌نویس هزینه نسخه قبل', expenseUnit: 'toman', expenseAmount: '۱۲۳', expensePayee: 'پیک حساب دوم' } };
  await evaluate(`localStorage.removeItem('noor-accounting-draft:v1:beta-account:expense'); localStorage.setItem('noor-accounting-draft:v1:beta-account:document', ${JSON.stringify(JSON.stringify(legacyExpenseDraft))})`);
  await go('/account'); await ready('.workspace-page'); await tool('register');
  await assertEntryScope('customer');
  assert.equal(await evaluate(`document.querySelector('.document-form [name="customerName"]').value`), '', 'A legacy expense draft cannot open as a customer document');
  await tool('expense'); await assertEntryScope('store');
  assert.equal(await evaluate(`document.querySelector('.document-form [name="description"]').value`), legacyExpenseDraft.form.description, 'The old shared expense draft moves to store registration');
  assert.equal(await evaluate(`document.querySelector('.document-form [name="expenseAmount"]').value`), '123', 'Legacy expense migration retains entered values');
  await go('/account'); await ready('.workspace-page'); await tool('expense');
  assert.equal(await evaluate(`document.querySelector('.document-form [name="description"]').value`), legacyExpenseDraft.form.description, 'Migrated expense survives another reload');
  await click('[aria-label="خروج از حساب"]'); await ready('.accounting-hero');
  await go('/owner/login'); await ready('#account-username'); await until(`!document.querySelector('.accounting-submit').disabled`);
  await fill('#account-username', 'alpha-account'); await fill('#account-password', 'browser-password-alpha'); await click('.accounting-submit'); await ready('.workspace-page');
  assert.equal((await workspace()).data.documents[0].id, misc.id, 'Login restores own ledger');
  await tool('register');
  await fill('.document-form [name="customerName"]', 'پیش‌نویس مشتری محفوظ');
  await fill('.document-form [name="note"]', 'یادداشت پیش‌نویس مشتری');
  await tool('expense'); await assertEntryScope('store');
  assert.equal(await evaluate(`document.querySelector('.document-form [name="description"]').value`), '', 'Store drafts remain isolated between accounts');
  await fill('.document-form [name="description"]', 'هزینه ارسال اسناد');
  await fill('.document-form [name="expenseAmount"]', '۱۲۳۰۰۰');
  await fill('.document-form [name="expensePayee"]', 'پیک فروشگاه');
  assert.equal(await evaluate(`Boolean(document.querySelector('.document-form [name="customerName"]'))`), false, 'Store expense does not show customer fields');
  await tool('register'); await assertEntryScope('customer');
  assert.equal(await evaluate(`document.querySelector('.document-form [name="customerName"]').value`), 'پیش‌نویس مشتری محفوظ', 'Opening an expense preserves the customer draft');
  await tool('expense');
  assert.equal(await evaluate(`document.querySelector('.document-form [name="description"]').value`), 'هزینه ارسال اسناد', 'Returning from customer registration preserves the expense draft');
  await go('/account'); await ready('.workspace-page'); await tool('register');
  await assertEntryScope('customer');
  assert.equal(await evaluate(`document.querySelector('.document-form [name="customerName"]').value`), 'پیش‌نویس مشتری محفوظ', 'Reload restores the customer draft independently');
  assert.equal(await evaluate(`document.querySelector('.document-form [name="note"]').value`), 'یادداشت پیش‌نویس مشتری', 'Reload preserves all customer header fields');
  await tool('expense'); await assertEntryScope('store');
  assert.equal(await evaluate(`document.querySelector('.document-form [name="description"]').value`), 'هزینه ارسال اسناد', 'Reload restores the expense draft independently');
  assert.equal(await evaluate(`document.querySelector('.document-form [name="expenseAmount"]').value`), '123,000', 'Reload preserves the entered expense amount');
  await tool('partner-invoice'); await assertEntryScope('partner');
  await ready('[data-partner-new]');
  await click('[data-partner-new]');
  await fill('[data-partner-profile] [name="name"]', 'بنکداری آزمایشی');
  await fill('[data-partner-profile] [name="phone"]', '09120000000');
  await click('[data-partner-save]');
  await until(`document.querySelector('[data-partner-select]')?.value`);
  const partnerId = (await workspace()).data.partners[0].id;
  await ready('[data-partner-invoice]');
  assert.ok(await evaluate(`document.querySelector('[data-document-scope="partner"]')?.contains(document.querySelector('[data-partner-invoice]'))`), 'Supplier purchase belongs to partner registration');
  await fill('[data-partner-invoice] [name="externalInvoiceNumber"]', '3054');
  await fill('[data-partner-invoice] [name="gold18Price"]', '5000000');
  await fill('[data-partner-line="0"] [name="itemName"]', 'دستبند خرید از همکار');
  await fill('[data-partner-line="0"] [name="itemCount"]', '۲');
  await fill('[data-partner-line="0"] [name="weight"]', '۱۰');
  await fill('[data-partner-line="0"] [name="ayar"]', '۷۵۰');
  await fill('[data-partner-line="0"] [name="wagePercent"]', '۱۰');
  await fill('[data-partner-line="0"] [name="wageFixedUnit"]', 'rial');
  await fill('[data-partner-line="0"] [name="wageFixed"]', '۵۰۰۰۰۰۰');
  await fill('[data-partner-line="0"] [name="profitPercent"]', '۳');
  await until(`document.querySelector('[data-partner-preview-gold-debit]')?.textContent.includes('۱۱٫۵۳۶')`);
  await fill('[data-partner-line="0"] [name="profitPercent"]', '۵');
  await until(`document.querySelector('[data-partner-preview-gold-debit]')?.textContent.includes('۱۱٫۷۶')`);
  await screenshot('accounting-partner-invoice', '[data-partner-invoice]');
  dropNextInvoiceResponse = true;
  await click('[data-partner-invoice-save]');
  await until(`document.querySelector('[data-partner-retry]') && !document.querySelector('[data-partner-retry]').disabled`);
  await until(`document.querySelector('.partner-notice.error') || document.querySelector('.partner-crm [role="alert"]')`, 'Uncertain invoice shows retry error');
  const committed = await workspace();
  assert.equal(committed.data.partners[0].entries.length, 1, 'Invoice committed before response loss');
  assert.equal(committed.data.partners[0].goldBalance, 11.76);
  assert.equal(committed.data.partners[0].tomanBalance, 0);
  const postedLine = committed.data.partners[0].entries[0].lines[0];
  assert.equal(postedLine.fixedLaborGold, 0.2, 'Rial labor converted using frozen toman gold rate');
  assert.equal(postedLine.profitGold, 0.56, 'Editable five percent profit on principal and labor');
  assert.equal(committed.data.documents.length, 2);
  assert.equal(committed.data.customers.length, 1, 'Supplier is separate from customers');
  const supplierStock = committed.data.documents.find(document => document.partnerId === partnerId);
  assert.ok(supplierStock, 'Supplier invoice creates stock');
  assert.ok(Math.abs(Number(supplierStock.weight)*Number(supplierStock.itemCount)-10)<1e-9, 'Stock excludes labor and profit and counts total weight once');
  await go('/account'); await ready('.workspace-page'); await tool('register');
  await assertEntryScope('customer');
  assert.equal(await evaluate(`Boolean(document.querySelector('[data-partner-retry]'))`), false, 'A pending supplier invoice cannot replace customer registration');
  assert.equal(await evaluate(`document.querySelector('.document-form [name="customerName"]').value`), 'پیش‌نویس مشتری محفوظ', 'Pending supplier recovery preserves the customer draft');
  await tool('partner-invoice'); await assertEntryScope('partner');
  assert.equal(await evaluate(`document.querySelector('[data-document-type]').value`), 'partner-crafted-purchase', 'Reload keeps the supplier entry type');
  await click('[data-partner-retry]');
  await until(`!document.querySelector('[data-partner-retry]')`);
  await savedPartnerPreview();
  const replayed = await workspace();
  assert.equal(replayed.data.partners[0].entries.length, 1, 'Replay cannot duplicate debt');
  assert.equal(replayed.data.documents.length, 2, 'Replay cannot duplicate stock');
  await tool('crm'); await click('[data-crm-group="partners"]');
  await click('[data-partner-settlement]');
  await fill('[data-partner-settlement-form] [name="paymentMethod"]', 'gold');
  await fill('[data-partner-settlement-form] [name="goldAmount"]', '۱۱٫۷۶');
  await fill('[data-partner-settlement-form] [name="counterpartyName"]', 'تحویل‌گیرنده طلا');
  await fill('[data-partner-settlement-form] [name="reference"]', 'سند ۳۳');
  await click('[data-partner-payment-save]'); await savedPartnerPreview(); await ready('[data-partner-statement]');
  const settled = await workspace();
  assert.equal(settled.data.partners[0].goldBalance, 0);
  assert.equal(settled.data.partners[0].entries.length, 2);
  assert.equal(settled.data.partners[0].entries[1].reference, 'سند ۳۳');
  await screenshot('accounting-partner-statement', '.partner-profile');
  await resize(390, 844); await screenshot('accounting-partner-mobile', '.partner-profile');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth+1'), true, 'Partner CRM has no mobile page overflow');
  await resize(1440);
  await evaluate(`document.body.classList.add('partner-print-open')`);
  const printable = await cdp('Page.printToPDF', { printBackground: true, preferCSSPageSize: true });
  const pdf = Buffer.from(printable.data, 'base64');
  await writeFile(resolve('artifacts/accounting-partner-statement.pdf'), pdf);
  assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length, 1, 'Sample statement prints on one page without blank pages');
  await cdp('Emulation.setEmulatedMedia', { media: 'print' }); await resize(794, 1123);
  await screenshot('accounting-partner-print');
  await cdp('Emulation.setEmulatedMedia', { media: '' }); await resize(1440);
  await evaluate(`document.body.classList.remove('partner-print-open')`);
  await tool('partner-invoice'); await assertEntryScope('partner'); await fill('[data-document-type]', 'partner-coin-purchase');
  await fill('[data-partner-invoice] [name="gold18Price"]', '5000000');
  await fill('[data-partner-line="0"] [name="itemName"]', 'سکه همکار');
  await fill('[data-partner-line="0"] [name="coinCount"]', '۲');
  await fill('[data-partner-line="0"] [name="coinPrice"]', '25000000');
  await fill('[data-partner-line="0"] [name="profitPercent"]', '۰');
  await click('[data-partner-invoice-save]');
  await until(`document.querySelector('.partner-crm .form-message.success')?.textContent.includes('انجام شد')`);
  await savedPartnerPreview();
  assert.equal((await workspace()).data.partners[0].goldBalance, 10, 'Coin purchase becomes gold debt');
  await fill('[data-document-type]', 'partner-melted-purchase');
  await fill('[data-partner-invoice] [name="gold18Price"]', '5000000');
  await fill('[data-partner-line="0"] [name="itemName"]', 'آب‌شده همکار');
  await fill('[data-partner-line="0"] [name="meltedWeight"]', '۱۰');
  await fill('[data-partner-line="0"] [name="meltedAyar"]', '۷۴۰');
  await fill('[data-partner-line="0"] [name="meltedFee"]', '21659000');
  await fill('[data-partner-line="0"] [name="assayCode"]', '12345');
  await fill('[data-partner-line="0"] [name="laboratoryName"]', 'آزمایشگاه تست');
  await fill('[data-partner-line="0"] [name="profitPercent"]', '۰');
  await click('[data-partner-invoice-save]');
  await until(`document.querySelector('.partner-crm .form-message.success')?.textContent.includes('انجام شد')`);
  await savedPartnerPreview();
  const beforeRemittance = await workspace();
  assert.equal(beforeRemittance.data.partners[0].goldBalance, 19.866667, 'Melted purchase converts lower purity to 750');
  assert.equal(beforeRemittance.data.customers.length, 1);
  await fill('[data-document-type]', 'partner-remittance'); await ready('[data-partner-remittance-placeholder], [data-partner-settlement-form]');
  if (await evaluate(`Boolean(document.querySelector('[data-partner-remittance-placeholder]'))`)) {
    assert.equal(await evaluate(`document.querySelector('[data-partner-document-entry] button[type="submit"]') !== null`), false, 'Remittance placeholder has no financial submit');
  }
  assert.equal((await workspace()).revision, beforeRemittance.revision, 'Opening remittance cannot post a ledger entry');
  await screenshot('accounting-partner-remittance', '[data-partner-document-entry]');
  await assertEntryScope('partner');
  await tool('register'); await assertEntryScope('customer');
  assert.equal(await evaluate(`document.querySelector('.document-form [name="customerName"]').value`), 'پیش‌نویس مشتری محفوظ', 'Customer draft survives supplier entry');
  assert.equal(await evaluate(`document.querySelector('.recent-documents-details').textContent.includes('دستبند خرید از همکار')`), false, 'Customer recent documents exclude supplier purchases');
  await tool('expense'); await assertEntryScope('store');
  assert.equal(await evaluate(`document.querySelector('.document-form [name="description"]').value`), 'هزینه ارسال اسناد', 'Supplier entry and recovery preserve the independent expense draft');
  await resize(390, 844); await assertEntryScope('store'); await screenshot('accounting-store-expense-mobile', '[data-document-scope="store"]');
  const beforeExpense = await workspace();
  const readExpenseDrafts = () => evaluate(`({ customer: JSON.parse(localStorage.getItem('noor-accounting-draft:v1:alpha-account:document')), expense: JSON.parse(localStorage.getItem('noor-accounting-draft:v1:alpha-account:expense')) })`);
  const beforeExpenseDrafts = await readExpenseDrafts();
  const expenseRequestStart = requests.length;
  dropNextExpenseResponse = true;
  await click('.document-form button[type="submit"]');
  await until(`document.querySelector('.document-form .form-message.error') && document.querySelector('[data-retry-commit]') && !document.querySelector('[data-retry-commit]').disabled`);
  assert.equal(dropNextExpenseResponse, false, 'The expense commits before its acknowledgment is lost');
  assert.equal(await evaluate(`Boolean(document.querySelector('.document-form .form-message.success'))`), false, 'Expense success waits for server acknowledgment');
  const pendingExpenseDrafts = await readExpenseDrafts();
  assert.ok(pendingExpenseDrafts.expense.requestId, 'Unconfirmed expense keeps a durable retry identity');
  assert.deepEqual(pendingExpenseDrafts.expense.form, beforeExpenseDrafts.expense.form, 'Unconfirmed expense retains every form value');
  assert.deepEqual(pendingExpenseDrafts.customer, beforeExpenseDrafts.customer, 'The customer draft is unchanged by the expense request');
  const expenseRecovery = await evaluate(`JSON.parse(localStorage.getItem('noor:pending-workspace:v1:alpha-account'))`);
  assert.equal(expenseRecovery.body.requestId, pendingExpenseDrafts.expense.requestId, 'Expense draft and recovery refer to the same request');
  const committedExpense = await workspace();
  assert.equal(committedExpense.data.documents.length, beforeExpense.data.documents.length + 1, 'The expense exists once despite the lost response');
  await tool('register');
  assert.equal(await evaluate(`Boolean(document.querySelector('[data-document-scope="customer"]'))`), false, 'Pending expense blocks opening customer registration');
  await tool('partner-invoice');
  assert.equal(await evaluate(`Boolean(document.querySelector('[data-document-scope="partner"]'))`), false, 'Pending expense blocks opening partner registration');
  assert.deepEqual(await readExpenseDrafts(), pendingExpenseDrafts, 'Blocked cross-group navigation cannot replace either draft or the expense request identity');
  assert.deepEqual(await workspace(), committedExpense, 'Blocked navigation makes no financial changes');
  await tool('home'); await go('/account'); await ready('.workspace-page'); await tool('expense'); await assertEntryScope('store');
  assert.deepEqual(await readExpenseDrafts(), pendingExpenseDrafts, 'Reload retains the pending expense and independent customer draft');
  assert.equal(await evaluate(`document.querySelector('.document-form [name="expenseAmount"]').value`), '123,000', 'Reopening pending expense restores its amount');
  assert.equal(await evaluate(`document.querySelector('.document-form [name="expenseAmount"]').matches(':disabled')`), true, 'Pending expense stays locked to its original payload');
  await click('.document-form button[type="submit"]');
  await until(`document.querySelector('.document-form .form-message.success') && !document.querySelector('[data-retry-commit]')`);
  const afterExpense = await workspace();
  assert.deepEqual(afterExpense, committedExpense, 'Retry acknowledges the same expense without another document or revision');
  const expenseWrites = requests.slice(expenseRequestStart).filter(entry => entry.path === '/api/owner/workspace' && entry.method === 'PUT');
  assert.equal(expenseWrites.length, 2, 'Expense save and its one retry issue exactly two requests');
  assert.deepEqual(expenseWrites[1].body, expenseWrites[0].body, 'Expense retry replays the exact revision, payload and request identity');
  assert.equal(expenseWrites[1].body.requestId, pendingExpenseDrafts.expense.requestId);
  assert.equal(afterExpense.data.documents.length, beforeExpense.data.documents.length + 1, 'Store registration saves one expense');
  assert.equal(afterExpense.data.documents[0].type, 'expense');
  assert.equal(afterExpense.data.documents[0].amount, 123000);
  assert.deepEqual(afterExpense.data.documents.slice(1), beforeExpense.data.documents, 'Saving store expense preserves all customer and partner documents');
  assert.deepEqual(afterExpense.data.customers, beforeExpense.data.customers, 'Store expense does not change customer balances');
  assert.deepEqual(afterExpense.data.partners, beforeExpense.data.partners, 'Store expense does not change partner balances');
  await tool('register'); await assertEntryScope('customer');
  assert.equal(await evaluate(`document.querySelector('.document-form [name="customerName"]').value`), 'پیش‌نویس مشتری محفوظ', 'Saving expense cannot clear the customer draft');
  assert.equal(await evaluate(`document.querySelector('.recent-documents-details').textContent.includes('هزینه ارسال اسناد')`), false, 'Customer recent documents exclude store expenses');
  await go('/account'); await ready('.workspace-page'); await tool('register');
  assert.equal(await evaluate(`document.querySelector('.document-form [name="customerName"]').value`), 'پیش‌نویس مشتری محفوظ', 'Customer draft survives reload after expense acknowledgment');
  assert.equal(await evaluate(`document.querySelector('.document-form [name="note"]').value`), 'یادداشت پیش‌نویس مشتری', 'Expense acknowledgment preserves the complete customer header');
  await tool('expense'); await assertEntryScope('store');
  assert.equal(await evaluate(`document.querySelector('.document-form [name="description"]').value`), '', 'Confirmed expense clears only its own draft');
  await tool('partner-remittance'); await assertEntryScope('partner'); await ready('[data-partner-remittance-placeholder], [data-partner-settlement-form]');
  await resize(1440);
  await click('[aria-label="خروج از حساب"]'); await ready('.accounting-hero');
  await go('/login'); await ready('#account-username'); await until(`!document.querySelector('.accounting-submit').disabled`);
  await fill('#account-username', 'beta-account'); await fill('#account-password', 'browser-password-beta'); await click('.accounting-submit'); await ready('.workspace-page');
  assert.equal((await workspace()).data.partners.length, 0, 'Second account cannot read first account partners');
  for (const path of ['/api/public/products', '/api/public/gallery', '/api/public/contact']) assert.equal((await fetch(`${backendOrigin}${path}`)).status, 404);
  assert.equal(requests.some(item => item.path.startsWith('/api/public/')), false, 'Accounting pages never request a public catalog');
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  console.log('Accounting browser checks passed: scoped customer/store/partner forms, retired customer crafted purchases blocked with drafts preserved, vault purchases routed to partners, independent drafts and legacy expense migration, isolated accounts, misc750, supplier crafted/melted/coin purchase, editable profit and rial labor in gold, durable replay, payments, remittance navigation, mobile/print, retired storefront.');
} catch (error) {
  if (evaluate) { try { console.error('Browser state:', await evaluate(`JSON.stringify({path:location.pathname,text:document.body.innerText.slice(-4500)})`)); } catch {} }
  if (exceptions.length) console.error('Browser exceptions:', JSON.stringify(exceptions));
  throw error;
} finally {
  if (cdp && socket?.readyState === WebSocket.OPEN) { try { await cdp('Browser.close'); } catch {} }
  socket?.close();
  if (chrome?.exitCode === null) chrome.kill();
  if (backend.exitCode === null) backend.kill();
  server.closeAllConnections();
  if (server.listening) await new Promise(resolve => server.close(resolve));
  const candidate = resolve(temporary);
  if (dirname(candidate) === resolve(tmpdir()) && basename(candidate).startsWith('zar-accounting-check-')) {
    try { await rm(candidate, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }); } catch {}
  }
}
