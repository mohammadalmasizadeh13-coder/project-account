import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer, request } from 'node:http';
import { cp, readFile, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { navigateWorkspace } from './browser-navigation.mjs';

// Run after building from frontend. All financial records and Chrome data are disposable.
const origin = 'http://127.0.0.1:4195';
const backendOrigin = 'http://127.0.0.1:8022';
const debugOrigin = 'http://127.0.0.1:9245';
const pause = ms => new Promise(done => setTimeout(done, ms));
const temporary = await mkdtemp(join(tmpdir(), 'zar-document-check-'));
const builtFrontend = join(temporary, 'dist');
await cp(resolve('dist'), builtFrontend, { recursive: true });
const username = 'document-check-bootstrap';
const password = randomBytes(24).toString('base64url');
const hashed = spawnSync(resolve('../backend/.venv/Scripts/python.exe'), ['-c', 'import sys; from app.security import hash_password; print(hash_password(sys.stdin.read()))'], {
  cwd: resolve('../backend'), input: password, encoding: 'utf8', windowsHide: true,
});
assert.equal(hashed.status, 0, 'Backend password helper works');
const backend = spawn(resolve('../backend/.venv/Scripts/python.exe'), ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8022'], {
  cwd: resolve('../backend'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, DATABASE_URL: `sqlite:///${join(temporary, 'documents-test.db').replaceAll('\\', '/')}`,
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
    const forwarded = request(`${backendOrigin}${req.url}`, { method: req.method, headers: { ...req.headers, host: '127.0.0.1:8022' } }, upstream => {
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
  await new Promise((done, reject) => { server.once('error', reject); server.listen(4195, '127.0.0.1', done); });
  chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--disable-software-rasterizer', '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=9245', `--user-data-dir=${join(temporary, 'chrome')}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
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
  const normalizeNumber = value => String(value).replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).replace(/[٬,\s]/g, '').replace(/٫/g, '.');
  const numberValue = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).value`).then(normalizeNumber);
  const workspace = async () => (await browserApi('/api/owner/workspace')).body;
  const tool = name => navigateWorkspace(name, { click, evaluate, pause });
  const resize = async (width, height = 1100) => {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await pause(150);
  };
  const replaceText = async (selector, text) => {
    await ready(selector);
    await evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});input.focus();input.select();})()`);
    await cdp('Input.insertText', { text });
    await pause(80);
  };
  const key = async (key, code, windowsVirtualKeyCode) => {
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
    await pause(70);
  };
  const checkInventory = async (id, expected) => {
    await tool('vault');
    await ready(`[data-inventory-id="${id}"]`);
    const remaining = await evaluate(`(()=>{const item=document.querySelector('[data-inventory-id="${id}"]');return Array.from(item.querySelectorAll('dt')).find(node=>node.textContent==='موجودی')?.nextElementSibling.textContent;})()`);
    assert.equal(normalizeNumber(remaining).split('عدد')[0], String(expected), 'Inventory reflects the saved document quantity');
  };
  const card = id => `.document-card[data-invoice-id="${id}"]`;
  const openAction = async (id, action) => {
    await tool('search');
    await click(`${card(id)} [data-invoice-${action}]`);
    await ready(`[data-document-action="${action}"]`);
  };
  const saveEdit = async () => {
    await click('[data-confirm-document-action="edit"]');
    await until(`!document.querySelector('${editor}')`, 'Document edit saved');
  };
  const confirmDelete = async () => {
    await click('[data-confirm-document-action="delete"]');
    await until(`!document.querySelector('[data-document-action="delete"]')`, 'Document deletion saved');
  };
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Fetch.enable', { patterns: [{ urlPattern: '*fonts.googleapis.com*' }, { urlPattern: '*fonts.gstatic.com*' }] });
  await resize(1440);
  await go('/register'); await ready('#account-password-confirmation');
  await until(`!document.querySelector('.accounting-submit').disabled`, 'Registration is ready');
  await fill('#account-username', 'document-regression');
  await fill('#account-gallery-name', 'گالری آزمون ویرایش');
  await fill('#account-password', password); await fill('#account-password-confirmation', password);
  await click('.accounting-submit'); await ready('.workspace-page');

  const empty = await workspace();
  const ring = { id: 'edit-ring', category: 'crafted', source: 'opening-inventory', type: 'crafted-purchase', productCode: 'NG-EDIT-001', itemName: 'انگشتر آزمون ویرایش', craftedKind: 'انگشتر', itemCount: '5', weight: '1.25', ayar: '750', wagePercent: '0', wageFixed: '0', profitPercent: '0', gramPrice: '6000000', date: '2026-09-20' };
  const bangle = { ...ring, id: 'edit-bangle', productCode: 'NG-EDIT-002', itemName: 'النگو آزمون ویرایش', craftedKind: 'النگو', itemCount: '2', weight: '0.75' };
  const seeded = await browserApi('/api/owner/workspace', { method: 'PUT', body: { revision: empty.revision, data: { ...empty.data, documents: [ring, bangle], customers: [], openingSetup: { completed: true }, prices: { goldGramPrice: '6000000' } } } });
  assert.equal(seeded.status, 200, JSON.stringify(seeded.body));
  await go('/account'); await ready('.workspace-page'); await tool('register');

  // Exercise real text entry and caret movement rather than only React value setters.
  const price = field('gold18Price');
  await replaceText(price, '');
  for (const digit of '1234567') await cdp('Input.insertText', { text: digit });
  await pause(80);
  assert.match(await evaluate(`document.querySelector(${JSON.stringify(price)}).value`), /^[۱1][,٬][۲2][۳3][۴4][,٬][۵5][۶6][۷7]$/, 'Thousands group while the user types');
  await evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(price)});input.setSelectionRange(3,3);})()`);
  await cdp('Input.insertText', { text: '9' }); await pause(80);
  assert.equal(await numberValue(price), '12934567', 'Insertion in the middle keeps digit order');
  assert.equal(await evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(price)});return input.selectionStart<input.value.length;})()`), true, 'Formatting does not send the caret to the end');
  await key('Backspace', 'Backspace', 8);
  assert.equal(await numberValue(price), '1234567', 'Backspace removes the inserted digit');
  await evaluate(`document.querySelector(${JSON.stringify(price)}).setSelectionRange(2,2)`);
  await key('Backspace', 'Backspace', 8);
  assert.equal(await numberValue(price), '234567', 'Backspace beside a grouping comma removes a digit');
  await replaceText(price, '1234567');
  await evaluate(`document.querySelector(${JSON.stringify(price)}).setSelectionRange(1,1)`);
  await key('Delete', 'Delete', 46);
  assert.equal(await numberValue(price), '134567', 'Forward delete beside a grouping comma removes a digit');
  await replaceText(price, '۱۲٬۳۴۵٬۶۷۸٫۵۰');
  assert.equal(await numberValue(price), '12345678.50', 'Pasted Persian digits, grouping and decimal precision survive');
  assert.match(await evaluate(`document.querySelector(${JSON.stringify(price)}).value`), /[,٬]/, 'Pasted prices remain grouped');
  await replaceText(price, '6000000');
  await fill(field('customerName'), 'مشتری آزمون ویرایش');
  await fill(field('productCode'), ring.productCode); await fill(field('itemCount'), '2');
  await fill(field('gramPrice'), '6000000'); await fill(field('wagePercent'), '0');
  await fill(field('wageFixed'), '0'); await fill(field('profitPercent'), '0');
  await click('[data-invoice-add]');
  await fill(field('productCode'), bangle.productCode); await fill(field('itemCount'), '1');
  await fill(field('gramPrice'), '6000000'); await fill(field('wagePercent'), '0');
  await fill(field('wageFixed'), '0'); await fill(field('profitPercent'), '0');
  await click('[data-invoice-add]');
  await click('.document-form button[type="submit"]'); await ready('[data-invoice-payment-step]');
  await replaceText('[name="cashPaid"]', '10500000');
  assert.match(await evaluate(`document.querySelector('[name="cashPaid"]').value`), /[,٬]/, 'Payment amounts group during entry');
  await click('[data-invoice-payment-confirm]'); await ready('.invoice-sheet');
  await click('[data-invoice-close]');
  const created = await workspace();
  const saleRows = created.data.documents.filter(row => row.customerName === 'مشتری آزمون ویرایش').sort((a, b) => a.invoiceLine - b.invoiceLine);
  assert.equal(saleRows.length, 2);
  assert.equal(saleRows.reduce((total, row) => total + Number(row.amount), 0), 19500000);
  assert.equal(Number(saleRows[0].gramDebt), 1.5);
  const invoiceId = saleRows[0].transactionId;
  const customerId = saleRows[0].customerId;
  await checkInventory(ring.id, 3);

  // Cancelling either operation leaves the server revision and every ledger record unchanged.
  await openAction(invoiceId, 'edit');
  assert.equal(await evaluate(`document.querySelectorAll('${editor} [data-document-row]').length`), 2, 'Editor contains every invoice row');
  await fill(editField('note'), 'این تغییر نباید ثبت شود');
  await click('[data-document-action-cancel]');
  assert.deepEqual(await workspace(), created, 'Cancel edit keeps the original ledger');
  await openAction(invoiceId, 'delete');
  await click('[data-document-action-cancel]');
  assert.deepEqual(await workspace(), created, 'Cancel delete keeps the original ledger');

  await openAction(invoiceId, 'edit');
  const rowField = name => `${editor} [data-document-row="${saleRows[0].id}"] [name="${name}"]`;
  await fill(rowField('itemCount'), '1');
  await replaceText(editField('cashPaid'), '6000000');
  assert.equal(await numberValue(editField('settlementGoldPrice')), '6000000');
  await fill(editField('note'), 'ویرایش تعداد و پرداخت نقدی');
  await evaluate(`document.querySelector('${editor}').scrollTop=0`);
  await screenshot('document-editor-desktop', editor);
  await resize(390, 844);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true, 'Mobile document editor does not overflow the page');
  await evaluate(`document.querySelector('${editor}').scrollTop=0`);
  await screenshot('document-editor-mobile', editor);
  await evaluate(`document.querySelector('[data-confirm-document-action="edit"]').scrollIntoView({block:'center',behavior:'instant'})`);
  assert.equal(await evaluate(`(()=>{const button=document.querySelector('[data-confirm-document-action="edit"]'),rect=button.getBoundingClientRect();return rect.top>=0&&rect.bottom<=innerHeight;})()`), true, 'Mobile users can scroll to save changes');
  await screenshot('document-editor-mobile-save', editor);
  await resize(1440);
  await saveEdit();
  const changed = await workspace();
  const changedRows = changed.data.documents.filter(row => row.transactionId === invoiceId).sort((a, b) => a.invoiceLine - b.invoiceLine);
  assert.equal(changedRows.length, 2);
  assert.deepEqual(changedRows.map(row => row.id), saleRows.map(row => row.id), 'Editing preserves document identities');
  assert.equal(changedRows[0].invoiceNumber, saleRows[0].invoiceNumber, 'Editing preserves the issued invoice number');
  assert.equal(changedRows.reduce((total, row) => total + Number(row.amount), 0), 12000000);
  assert.equal(Number(changedRows[0].cashPaid), 6000000);
  assert.equal(Number(changedRows[0].gramDebt), 1);
  assert.equal(Number(changedRows[1].gramDebt), 0, 'Invoice debt is counted only once');
  const changedCustomer = changed.data.customers.find(customer => customer.id === customerId);
  assert.equal(Number(changedCustomer.gramDebt), 1, 'Customer debt replaces the previous invoice contribution');
  assert.equal(changedCustomer.purchases.length, 2, 'Customer history updates without duplicate rows');
  await checkInventory(ring.id, 4);
  await go('/account'); await ready('.workspace-page');
  assert.deepEqual(await workspace(), changed, 'Reload retains the edited server ledger');
  await openAction(invoiceId, 'edit');
  assert.equal(await numberValue(rowField('itemCount')), '1', 'Editor reopens the persisted quantity');
  assert.equal(await numberValue(editField('cashPaid')), '6000000', 'Editor reopens the persisted payment');
  await click('[data-document-action-cancel]');
  await openAction(invoiceId, 'delete'); await confirmDelete();
  const deleted = await workspace();
  assert.equal(deleted.data.documents.some(row => row.transactionId === invoiceId), false, 'Delete removes every invoice row atomically');
  const clearedCustomer = deleted.data.customers.find(customer => customer.id === customerId);
  assert.equal(Number(clearedCustomer.gramDebt), 0, 'Deleting reverses customer debt');
  assert.equal(clearedCustomer.purchases.length, 0, 'Deleting removes only the invoice history contribution');
  await checkInventory(ring.id, 5); await checkInventory(bangle.id, 2);

  await tool('expense');
  await fill(field('description'), 'هزینه آزمون ویرایش');
  await fill(field('expenseUnit'), 'currency'); await fill(field('expenseCurrency'), 'USD');
  await fill(field('expenseAmount'), '2'); await replaceText(field('expenseRate'), '100000');
  await fill(field('expensePayee'), 'دریافت‌کننده هزینه');
  await click('.document-form button[type="submit"]');
  await until(`document.querySelector('.form-message.success')`, 'Expense saved');
  const withExpense = await workspace();
  const expense = withExpense.data.documents.find(row => row.type === 'expense');
  assert.equal(Number(expense.amount), 200000);
  const expenseId = expense.transactionId || expense.id;
  await openAction(expenseId, 'edit');
  await fill(editField('expenseUnit'), 'gold');
  await fill(editField('expenseAmount'), '0.5'); await fill(editField('expenseGoldPurity'), '750');
  await replaceText(editField('expenseRate'), '6000000');
  await fill(editField('description'), 'هزینه اصلاح‌شده با طلا');
  await saveEdit();
  const updatedExpense = await workspace();
  const savedExpense = updatedExpense.data.documents.find(row => row.id === expense.id);
  assert.equal(savedExpense.expenseUnit, 'gold');
  assert.equal(Number(savedExpense.expenseAmount), 0.5);
  assert.equal(Number(savedExpense.expenseRate), 6000000);
  assert.equal(Number(savedExpense.amount), 3000000, 'Expense equivalent is recomputed from the edited saved units and rate');
  assert.equal(savedExpense.description, 'هزینه اصلاح‌شده با طلا');
  assert.deepEqual(updatedExpense.data.customers, deleted.data.customers, 'Expense edits do not affect customer balances');
  await go('/account'); await ready('.workspace-page');
  assert.deepEqual(await workspace(), updatedExpense, 'Reload retains the expense edit');
  await openAction(expenseId, 'edit');
  await fill(editField('expenseUnit'), 'currency');
  assert.equal(await evaluate(`document.querySelector('${editor} [name="expenseCurrency"]').value`), 'USD', 'Switching to currency shows the default dollar selection');
  await fill(editField('expenseAmount'), '2');
  await replaceText(editField('expenseRate'), '100000');
  await saveEdit();
  const currencyExpenseState = await workspace();
  const currencyExpense = currencyExpenseState.data.documents.find(row => row.id === expense.id);
  assert.equal(currencyExpense.expenseUnit, 'currency');
  assert.equal(currencyExpense.expenseCurrency, 'USD', 'The untouched default currency selection is included in the saved edit');
  assert.equal(Number(currencyExpense.expenseAmount), 2);
  assert.equal(Number(currencyExpense.expenseRate), 100000);
  assert.equal(Number(currencyExpense.amount), 200000, 'Switching back from gold to currency recomputes the saved equivalent');
  await go('/account'); await ready('.workspace-page');
  assert.deepEqual(await workspace(), currencyExpenseState, 'Default currency selection persists after reload');
  await openAction(expenseId, 'delete'); await confirmDelete();
  const final = await workspace();
  assert.equal(final.data.documents.some(row => row.id === expense.id), false, 'Expense is deleted');
  assert.deepEqual(final.data.documents, deleted.data.documents, 'Unrelated stock entries survive expense changes');
  await go('/account'); await ready('.workspace-page');
  assert.deepEqual(await workspace(), final, 'Deletion persists after reload');
  assert.equal(errors.length, 0, `No uncaught browser exceptions: ${JSON.stringify(errors)}`);
  console.log('Document editing browser checks passed: live grouping, Persian pasted amounts, decimal precision and caret movement; whole-invoice edit/delete/cancellation; payment, customer debt/history and inventory reconciliation; expense unit/rate edits; reload persistence; desktop/mobile editor.');
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
  if (dirname(candidate) === resolve(tmpdir()) && basename(candidate).startsWith('zar-document-check-')) {
    try { await rm(candidate, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }); } catch { /* A stopped child may briefly retain its profile lock. */ }
  }
}
