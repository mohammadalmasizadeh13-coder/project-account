import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer, request } from 'node:http';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { navigateWorkspace } from './browser-navigation.mjs';

// Run after building from frontend. Accounts, financial records and browser data are disposable.
const origin = 'http://127.0.0.1:4197';
const backendOrigin = 'http://127.0.0.1:8024';
const debugOrigin = 'http://127.0.0.1:9247';
const temporary = await mkdtemp(join(tmpdir(), 'zar-gallery-print-check-'));
const built = join(temporary, 'dist');
const pause = ms => new Promise(done => setTimeout(done, ms));
await cp(resolve('dist'), built, { recursive: true });
const backend = spawn(resolve('../backend/.venv/Scripts/python.exe'), ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8024'], {
  cwd: resolve('../backend'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, DATABASE_URL: `sqlite:///${join(temporary, 'gallery-test.db').replaceAll('\\', '/')}`,
    NOOR_UPLOAD_DIR: join(temporary, 'uploads'), NOOR_OWNER_USERNAME: '', NOOR_OWNER_PASSWORD_HASH: '',
    NOOR_COOKIE_SECURE: 'false', FRONTEND_ORIGINS: origin, GOLD_RATE_URL: '', GOLD_RATE_TOKEN: '' },
});
let backendLog = '', chromeLog = '', backendError;
backend.on('error', error => { backendError = error; });
backend.stdout.on('data', chunk => { backendLog += chunk; });
backend.stderr.on('data', chunk => { backendLog += chunk; });
let registrationRequests = 0;
const server = createServer(async (req, res) => {
  const path = new URL(req.url, origin).pathname;
  if (path.startsWith('/api/')) {
    if (path === '/api/auth/register' && req.method === 'POST') registrationRequests++;
    const forwarded = request(`${backendOrigin}${req.url}`, { method: req.method, headers: req.headers }, upstream => {
      res.writeHead(upstream.statusCode, upstream.headers); upstream.pipe(res);
    });
    forwarded.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(forwarded); return;
  }
  const file = resolve(built, path.startsWith('/assets/') ? path.slice(1) : 'index.html');
  if (!file.startsWith(`${built}/`) && !file.startsWith(`${built}\\`)) { res.writeHead(404); res.end(); return; }
  try {
    res.writeHead(200, { 'Content-Type': { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml' }[extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
let chrome, socket, cdp;
const exceptions = [];
try {
  let healthy = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (backendError) throw backendError;
    if (backend.exitCode !== null) throw Error(`Backend exited: ${backendLog}`);
    try { if ((await fetch(`${backendOrigin}/api/health`, { signal: AbortSignal.timeout(1000) })).ok) { healthy = true; break; } } catch {}
    await pause(150);
  }
  assert.ok(healthy, backendLog);
  await new Promise((done, reject) => { server.once('error', reject); server.listen(4197, '127.0.0.1', done); });
  chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--disable-software-rasterizer', '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=9247', `--user-data-dir=${join(temporary, 'chrome')}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let chromeError;
  chrome.on('error', error => { chromeError = error; });
  chrome.stderr.on('data', chunk => { chromeLog += chunk; });
  let targets;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (chromeError) throw chromeError;
    try { targets = await (await fetch(`${debugOrigin}/json`, { signal: AbortSignal.timeout(1000) })).json(); break; } catch { await pause(150); }
  }
  assert.ok(targets?.some(target => target.type === 'page'), chromeLog);
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((done, reject) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  const pending = new Map(); let sequence = 0;
  cdp = (method, params = {}) => new Promise((done, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve: value => { clearTimeout(timer); done(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
    if (message.method === 'Fetch.requestPaused') cdp('Fetch.fulfillRequest', { requestId: message.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/css' }], body: '' }).catch(error => exceptions.push(String(error)));
    const waiting = pending.get(message.id);
    if (waiting) { pending.delete(message.id); message.error ? waiting.reject(message.error) : waiting.resolve(message.result); }
  });
  const evaluate = async expression => {
    const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until = async (expression, description = expression) => {
    for (let attempt = 0; attempt < 100; attempt++) { if (await evaluate(`Boolean(${expression})`)) return; await pause(100); }
    throw Error(`Timed out: ${description}`);
  };
  const ready = selector => until(`document.querySelector(${JSON.stringify(selector)})`, selector);
  const go = async path => { await cdp('Page.navigate', { url: `${origin}${path}` }); await pause(250); };
  const fill = async (selector, value) => {
    await ready(selector);
    await evaluate(`(() => { const input=document.querySelector(${JSON.stringify(selector)}); const proto=input.tagName==='SELECT'?HTMLSelectElement.prototype:input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(input,${JSON.stringify(value)}); input.dispatchEvent(new Event(input.tagName==='SELECT'?'change':'input',{bubbles:true})); })()`);
    await pause(45);
  };
  const click = async selector => {
    await ready(selector);
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);
    await pause(80);
    const point = await evaluate(`(() => { const element=document.querySelector(${JSON.stringify(selector)}),box=element.getBoundingClientRect(); const x=box.x+box.width/2,y=box.y+box.height/2,hit=document.elementFromPoint(x,y); return {x,y,visible:box.width>0&&box.height>0&&(element===hit||element.contains(hit)),disabled:element.disabled}; })()`);
    assert.ok(point.visible && !point.disabled, `Clickable: ${selector}`);
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await pause(120);
  };
  const browserApi = (path, options = {}) => evaluate(`(async () => { const session=await fetch('/api/auth/session').then(r=>r.json()); const options=${JSON.stringify(options)}; const response=await fetch(${JSON.stringify(path)},{...options,headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrfToken||''},...(options.body===undefined?{}:{body:JSON.stringify(options.body)})});return {status:response.status,body:await response.json()};})()`);
  const workspace = async () => (await browserApi('/api/owner/workspace')).body;
  const tool = name => navigateWorkspace(name, { click, evaluate, pause });
  const field = name => `.document-form [name="${name}"]`;
  const gallerySelector = '[data-invoice-gallery-name]';
  const galleryText = () => evaluate(`document.querySelector(${JSON.stringify(gallerySelector)})?.textContent.trim()`);
  const screenshot = async name => {
    await mkdir('artifacts', { recursive: true });
    const shot = await cdp('Page.captureScreenshot', { format: 'png' });
    await writeFile(`artifacts/${name}.png`, Buffer.from(shot.data, 'base64'));
  };
  const seedStock = async suffix => {
    const before = await workspace();
    const ring = { id: `gallery-ring-${suffix}`, category: 'crafted', source: 'opening-inventory', type: 'crafted-purchase', productCode: `NG-GALLERY-${suffix}`, itemName: 'انگشتر آزمون نام گالری', craftedKind: 'انگشتر', itemCount: '5', weight: '1', ayar: '750', wagePercent: '0', wageFixed: '0', profitPercent: '0', gramPrice: '6000000', date: '2026-10-08' };
    const seeded = await browserApi('/api/owner/workspace', { method: 'PUT', body: { revision: before.revision, data: { ...before.data, documents: [ring], customers: [], openingSetup: { completed: true }, prices: { goldGramPrice: '6000000' } } } });
    assert.equal(seeded.status, 200, JSON.stringify(seeded.body));
    await go('/account'); await ready('.workspace-page');
    return ring;
  };
  const createSale = async (stock, customerName, expectedGallery, lineCount = 1) => {
    await tool('register');
    await fill(field('customerName'), customerName);
    if (lineCount > 1) {
      for (const [name, value] of [['customerPhone', '09120000000'], ['customerAddress', 'تهران، خیابان آزمایشی، پلاک ۱۲']]) {
        if (await evaluate(`Boolean(document.querySelector(${JSON.stringify(field(name))}))`)) await fill(field(name), value);
      }
    }
    await fill(field('gold18Price'), '6000000');
    for (let line = 0; line < lineCount; line++) {
      await fill(field('productCode'), stock.productCode);
      await fill(field('itemCount'), '1'); await fill(field('gramPrice'), '6000000');
      await fill(field('wagePercent'), '0'); await fill(field('wageFixed'), '0'); await fill(field('profitPercent'), '0');
      if (lineCount > 1) await click('[data-invoice-add]');
    }
    await click('.document-form button[type="submit"]'); await ready('[data-invoice-payment-step]');
    await fill('[name="cashPaid"]', String(6000000 * lineCount)); await click('[data-invoice-payment-confirm]');
    await ready(gallerySelector);
    assert.equal(await galleryText(), expectedGallery, 'The invoice displays this account gallery');
    assert.equal(await evaluate(`document.querySelector('.invoice-sheet').textContent.includes('ZARNEGAR')`), false, 'The document does not substitute the app name for the gallery');
    const saved = await workspace();
    const rows = saved.data.documents.filter(item => item.customerName === customerName);
    assert.equal(rows.length, lineCount, 'Every invoice row is stored');
    assert.ok(rows.every(row => row.galleryName === expectedGallery), 'The gallery name is saved on every issued document row');
    return rows[0];
  };
  const reopenInvoice = async row => {
    await tool('crm'); await click(`[data-customer-id="${row.customerId}"]`);
    await ready('.crm-history'); await click(`.crm-history [data-view-invoice="${row.transactionId}"]`);
    await ready(gallerySelector);
  };
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Fetch.enable', { patterns: [{ urlPattern: '*fonts.googleapis.com*' }, { urlPattern: '*fonts.gstatic.com*' }] });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await go('/register'); await ready('#account-gallery-name');
  await until(`!document.querySelector('.accounting-submit').disabled`);
  await fill('#account-username', 'gallery-alpha'); await fill('#account-password', 'gallery-alpha-test-password');
  await fill('#account-password-confirmation', 'gallery-alpha-test-password');
  assert.equal(await evaluate(`document.querySelector('#account-gallery-name').required`), true);
  await click('.accounting-submit');
  assert.equal(registrationRequests, 0, 'A missing gallery cannot create an account');
  assert.equal(await evaluate(`document.querySelector('#account-gallery-name').validity.valueMissing`), true);
  const alphaGallery = 'گالری آفتاب';
  await fill('#account-gallery-name', `  ${alphaGallery}  `); await click('.accounting-submit');
  await ready('.workspace-page');
  assert.equal((await browserApi('/api/auth/session')).body.user.galleryName, alphaGallery, 'Registration persists the trimmed gallery name');
  const stock = await seedStock('ALPHA');
  const first = await createSale(stock, 'مشتری گالری آفتاب', alphaGallery, 4);

  // Test the print media even when the browser is explicitly asked to print backgrounds.
  await cdp('Emulation.setEmulatedMedia', { media: 'print' });
  assert.equal(await evaluate(`getComputedStyle(document.documentElement).backgroundColor`), 'rgba(0, 0, 0, 0)', 'The page canvas adds no background ink');
  const printState = await evaluate(`(() => {
    const sheet=document.querySelector('.invoice-sheet');
    const visible=element=>{const style=getComputedStyle(element);return style.display!=='none'&&style.visibility!=='hidden'&&element.getClientRects().length>0;};
    const elements=[sheet,...sheet.querySelectorAll('*')].filter(visible);
    const transparent=color=>['rgba(0, 0, 0, 0)','transparent'].includes(color);
    const decorated=elements.filter(element=>{const style=getComputedStyle(element);return !transparent(style.backgroundColor)||style.backgroundImage!=='none'||style.boxShadow!=='none'||['Top','Right','Bottom','Left'].some(side=>parseFloat(style['border'+side+'Width'])>0&&style['border'+side+'Style']!=='none'&&!transparent(style['border'+side+'Color']));});
    const colored=elements.filter(element=>[...element.childNodes].some(node=>node.nodeType===Node.TEXT_NODE&&node.textContent.trim())&&getComputedStyle(element).color!=='rgb(0, 0, 0)');
    return {decorated:decorated.map(element=>element.className||element.tagName),colored:colored.map(element=>element.className||element.tagName),graphics:[...sheet.querySelectorAll('svg,img,canvas')].filter(visible).length,galleryVisible:visible(sheet.querySelector('[data-invoice-gallery-name]')),totalVisible:visible(sheet.querySelector('[data-invoice-total]')),controlsVisible:visible(document.querySelector('.invoice-controls')),rows:sheet.querySelectorAll('[data-invoice-detail-line]').length};
  })()`);
  assert.deepEqual(printState.decorated, [], 'Printed invoice contains no backgrounds, borders or shadows');
  assert.deepEqual(printState.colored, [], 'Printed text is black');
  assert.equal(printState.graphics, 0, 'Preprinted paper receives no decorative graphics');
  assert.equal(printState.galleryVisible, true); assert.equal(printState.totalVisible, true);
  assert.equal(printState.controlsVisible, false); assert.equal(printState.rows, 4);
  const pdf = Buffer.from((await cdp('Page.printToPDF', { printBackground: true, preferCSSPageSize: true })).data, 'base64');
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/gallery-text-only-print.pdf', pdf);
  const pdfText = pdf.toString('latin1');
  if ((pdfText.match(/\/Type\s*\/Page\b/g) || []).length !== 1) {
    await cdp('Emulation.setDeviceMetricsOverride', { width: 506, height: 1000, deviceScaleFactor: 1, mobile: false });
    console.error('A5 section dimensions:', await evaluate(`Object.fromEntries(['.invoice-sheet','.invoice-heading','.invoice-customer-details','.invoice-items','.invoice-bottom','.invoice-footer'].map(selector=>{const element=document.querySelector(selector);if(!element)return [selector,null];const rect=element.getBoundingClientRect();return [selector,{top:rect.top,height:rect.height,bottom:rect.bottom}]}))`));
    await screenshot('gallery-text-only-print-overflow');
  }
  assert.equal((pdfText.match(/\/Type\s*\/Page\b/g) || []).length, 1, 'A four-item invoice fits one A5 page');
  const mediaBox = pdfText.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
  assert.ok(mediaBox, 'The PDF declares its page dimensions');
  assert.ok(Math.abs(Number(mediaBox[1]) - 148 / 25.4 * 72) < 2 && Math.abs(Number(mediaBox[2]) - 210 / 25.4 * 72) < 2, 'Printed pages are A5 portrait (148 × 210 mm)');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 506, height: 900, deviceScaleFactor: 1, mobile: false });
  assert.deepEqual(await evaluate(`(() => { const sheet=document.querySelector('.invoice-sheet').getBoundingClientRect();return [...document.querySelectorAll('.invoice-row-total,[data-invoice-total]')].filter(element=>{const range=document.createRange();range.selectNodeContents(element);return [...range.getClientRects()].some(rect=>rect.left<sheet.left-1||rect.right>sheet.right+1);}).map(element=>element.textContent); })()`), [], 'Every printed numeric total fits inside the A5 sheet');
  await screenshot('gallery-text-only-print');
  await evaluate(`document.querySelector('[data-invoice-gallery-name]').textContent=${JSON.stringify('گالری طلای آفتاب '.repeat(9).slice(0, 120))}`);
  assert.equal(await evaluate(`(() => { const element=document.querySelector('[data-invoice-gallery-name]'),sheet=document.querySelector('.invoice-sheet').getBoundingClientRect(),range=document.createRange();range.selectNodeContents(element);return [...range.getClientRects()].every(rect=>rect.left>=sheet.left-1&&rect.right<=sheet.right+1); })()`), true, 'A maximum-length gallery name wraps inside the A5 sheet');
  await screenshot('gallery-long-name-print');
  await evaluate(`document.querySelector('[data-invoice-gallery-name]').textContent=${JSON.stringify(alphaGallery)}`);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await evaluate(`(() => { const body=document.querySelector('.invoice-items tbody'),first=body.querySelector('[data-invoice-detail-line]'); for(let line=0;line<20;line++){const row=first.cloneNode(true);row.dataset.printOnlyCopy='';body.append(row);} })()`);
  const longPdf = Buffer.from((await cdp('Page.printToPDF', { printBackground: true, preferCSSPageSize: true })).data, 'base64');
  assert.ok((longPdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length > 1, 'Long invoices continue onto extra pages');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.invoice-dialog')).maxHeight`), 'none', 'Printed long invoices are not clipped by the dialog');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.invoice-items thead')).display`), 'table-header-group');
  await evaluate(`document.querySelectorAll('[data-print-only-copy]').forEach(row=>row.remove())`);
  await cdp('Emulation.setEmulatedMedia', { media: '' });
  await fill('[data-invoice-print-offset-x]', '2'); await fill('[data-invoice-print-offset-y]', '-1');
  await cdp('Emulation.setEmulatedMedia', { media: 'print' });
  const offsets = await evaluate(`(() => { const style=getComputedStyle(document.querySelector('.invoice-sheet'));return {left:parseFloat(style.left),top:parseFloat(style.top)}; })()`);
  assert.ok(Math.abs(offsets.left - 2 * 96 / 25.4) < .1 && Math.abs(offsets.top + 96 / 25.4) < .1, 'The print calibration moves text by the chosen millimeters');
  await cdp('Emulation.setEmulatedMedia', { media: '' });
  await click('[data-invoice-close]');

  const renamedGallery = 'گالری آفتاب نو';
  await tool('settings'); await click('[data-settings-tab="profile"]');
  await fill('[data-gallery-profile] [name="galleryName"]', renamedGallery); await click('[data-gallery-save]');
  let renamed = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    if ((await browserApi('/api/auth/session')).body.user.galleryName === renamedGallery) { renamed = true; break; }
    await pause(100);
  }
  assert.ok(renamed, 'Owner settings persist the gallery name');
  await go('/account'); await ready('.workspace-page'); await reopenInvoice(first);
  assert.equal(await galleryText(), alphaGallery, 'Reopening an older document retains its issued gallery name');
  assert.equal(await evaluate(`document.querySelector('[data-invoice-print-offset-x]').value`), '2', 'Print calibration survives reopening and reload');
  assert.equal(await evaluate(`document.querySelector('[data-invoice-print-offset-y]').value`), '-1');
  await click('[data-invoice-close]');
  await createSale(stock, 'مشتری پس از تغییر نام گالری', renamedGallery);
  await click('[data-invoice-close]');
  const alphaWorkspace = await workspace();
  await click('[aria-label="خروج از حساب"]'); await ready('.accounting-hero');

  const betaGallery = 'گالری مهتاب';
  await go('/register'); await ready('#account-gallery-name');
  await until(`!document.querySelector('.accounting-submit').disabled`);
  await fill('#account-gallery-name', betaGallery); await fill('#account-username', 'gallery-beta');
  await fill('#account-password', 'gallery-beta-test-password'); await fill('#account-password-confirmation', 'gallery-beta-test-password');
  await click('.accounting-submit'); await ready('.workspace-page');
  assert.equal((await workspace()).data.documents.length, 0, 'A second account starts with an independent ledger');
  assert.equal((await browserApi('/api/auth/session')).body.user.galleryName, betaGallery);
  const betaStock = await seedStock('BETA');
  await createSale(betaStock, 'مشتری گالری مهتاب', betaGallery);
  assert.equal(await evaluate(`document.querySelector('[data-invoice-print-offset-x]').value`), '0', 'Print calibration is independent for each account');
  await click('[data-invoice-close]');
  await click('[aria-label="خروج از حساب"]'); await ready('.accounting-hero');
  await go('/login'); await ready('#account-username');
  assert.equal(await evaluate(`Boolean(document.querySelector('#account-gallery-name'))`), false, 'Login needs only the existing account credentials');
  await fill('#account-username', 'gallery-alpha'); await fill('#account-password', 'gallery-alpha-test-password');
  await click('.accounting-submit'); await ready('.workspace-page');
  assert.equal((await browserApi('/api/auth/session')).body.user.galleryName, renamedGallery, 'Other accounts cannot change the saved gallery name');
  assert.deepEqual(await workspace(), alphaWorkspace, 'The first account ledger remains unchanged');
  await reopenInvoice(first); assert.equal(await galleryText(), alphaGallery);
  await click('[data-invoice-close]');

  // Reproduce a ledger written before gallery snapshots existed, only in this disposable DB.
  const accountId = (await browserApi('/api/auth/session')).body.user.accountId;
  const legacyFixture = spawnSync(resolve('../backend/.venv/Scripts/python.exe'), ['-c', `import json, sqlite3, sys
connection = sqlite3.connect(sys.argv[1])
row = connection.execute('SELECT data FROM noor_workspace WHERE account_id = ?', (sys.argv[2],)).fetchone()
data = json.loads(row[0])
def remove_gallery(value):
    if isinstance(value, dict):
        value.pop('galleryName', None)
        for child in value.values(): remove_gallery(child)
    elif isinstance(value, list):
        for child in value: remove_gallery(child)
remove_gallery(data)
connection.execute('UPDATE noor_workspace SET data = ?, revision = revision + 1 WHERE account_id = ?', (json.dumps(data), sys.argv[2]))
connection.commit()
connection.close()`, join(temporary, 'gallery-test.db'), accountId], { windowsHide: true, encoding: 'utf8' });
  assert.equal(legacyFixture.status, 0, legacyFixture.stderr);
  await go('/account'); await ready('.workspace-page'); await reopenInvoice(first);
  assert.equal(await galleryText(), renamedGallery, 'A legacy invoice without a snapshot uses the gallery from the authenticated account in CRM');
  await click('[data-invoice-close]');

  await tool('partner-remittance'); await click('[data-partner-new]');
  await fill('[data-partner-profile] [name="name"]', 'همکار آزمون چاپ'); await click('[data-partner-save]');
  await ready('[data-partner-settlement-form]');
  await fill('[data-partner-settlement-form] [name="direction"]', 'credit');
  await fill('[data-partner-settlement-form] [name="goldAmount"]', '10');
  await fill('[data-partner-settlement-form] [name="reference"]', 'آزمون چاپ حواله');
  await click('[data-partner-payment-save]');
  await until(`document.querySelector('.partner-crm .form-message.success')`);
  const remittance = (await workspace()).data.partners[0].entries.at(-1);
  assert.equal(remittance.galleryName, renamedGallery, 'Partner remittances store the account gallery');
  await tool('search'); await click(`[data-invoice-id="${remittance.transactionId}"] [data-invoice-view]`);
  await ready('[data-partner-document-dialog]'); assert.equal(await galleryText(), renamedGallery);
  await evaluate('window.print=()=>{}'); await click('[data-partner-document-dialog] [data-invoice-print]');
  await cdp('Emulation.setEmulatedMedia', { media: 'print' });
  assert.equal(await evaluate(`getComputedStyle(document.documentElement).backgroundColor`), 'rgba(0, 0, 0, 0)', 'The partner page canvas adds no background ink');
  const partnerPrint = await evaluate(`(() => { const statement=document.querySelector('.partner-statement'); const visible=element=>getComputedStyle(element).display!=='none'&&getComputedStyle(element).visibility!=='hidden'&&element.getClientRects().length>0; const elements=[statement,...statement.querySelectorAll('*')].filter(visible); const transparent=color=>['rgba(0, 0, 0, 0)','transparent'].includes(color);const bad=elements.filter(element=>{const style=getComputedStyle(element);return style.color!=='rgb(0, 0, 0)'||!transparent(style.backgroundColor)||style.backgroundImage!=='none'||style.boxShadow!=='none'||['Top','Right','Bottom','Left'].some(side=>parseFloat(style['border'+side+'Width'])>0&&style['border'+side+'Style']!=='none'&&!transparent(style['border'+side+'Color']));});return {bad:bad.map(element=>element.className||element.tagName),gallery:visible(statement.querySelector('[data-invoice-gallery-name]')),graphics:[...statement.querySelectorAll('svg,img')].filter(visible).length,controls:[...document.querySelectorAll('.partner-screen-only')].some(visible)}; })()`);
  assert.deepEqual(partnerPrint.bad, [], 'Partner printed documents contain only plain black text');
  assert.equal(partnerPrint.gallery, true); assert.equal(partnerPrint.graphics, 0); assert.equal(partnerPrint.controls, false);
  const partnerPdf = Buffer.from((await cdp('Page.printToPDF', { printBackground: true, preferCSSPageSize: true })).data, 'base64');
  await writeFile('artifacts/gallery-partner-remittance-print.pdf', partnerPdf);
  assert.equal((partnerPdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length, 1, 'Partner remittance fits one printed page');
  const partnerMediaBox = partnerPdf.toString('latin1').match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
  assert.ok(partnerMediaBox && Math.abs(Number(partnerMediaBox[1]) - 148 / 25.4 * 72) < 2 && Math.abs(Number(partnerMediaBox[2]) - 210 / 25.4 * 72) < 2, `Partner document prints A5 portrait too: ${partnerMediaBox?.[0]}`);
  await cdp('Emulation.setEmulatedMedia', { media: '' });
  await click('[data-partner-document-close]');
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  console.log('Gallery/print browser checks passed: required signup gallery, persisted account names, owner profile rename, issued snapshots and legacy fallback, account isolation, black text without printed graphics/backgrounds/borders, customer and partner A5 PDFs, long invoice pagination and saved account-specific print calibration.');
} catch (error) {
  if (String(error?.message).includes('CDP timeout')) console.error('Chrome diagnostics:', chromeLog.slice(-5000));
  if (cdp && socket?.readyState === WebSocket.OPEN) {
    try { const result = await cdp('Runtime.evaluate', { expression: 'JSON.stringify({path:location.pathname,text:document.body.innerText.slice(-4500)})', returnByValue: true }); console.error('Browser state:', result.result.value); } catch {}
  }
  throw error;
} finally {
  if (cdp && socket?.readyState === WebSocket.OPEN) { try { await cdp('Browser.close'); } catch {} }
  socket?.close(); if (chrome?.exitCode === null) chrome.kill();
  if (backend.exitCode === null) backend.kill();
  server.closeAllConnections(); if (server.listening) await new Promise(done => server.close(done));
  const candidate = resolve(temporary);
  if (dirname(candidate) === resolve(tmpdir()) && basename(candidate).startsWith('zar-gallery-print-check-')) {
    try { await rm(candidate, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }); } catch { /* Child shutdown can briefly retain the disposable profile lock. */ }
  }
}
