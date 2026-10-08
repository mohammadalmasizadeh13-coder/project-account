import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, request } from 'node:http';
import { cp, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { checkPartnerDocumentActions } from './partner-document-browser-scenarios.mjs';

// Disposable database, isolated browser profile, and real UI/API interactions.
const origin = 'http://127.0.0.1:4203';
const backendOrigin = 'http://127.0.0.1:8033';
const debugOrigin = 'http://127.0.0.1:9263';
const temporary = await mkdtemp(join(tmpdir(), 'zar-partner-actions-check-'));
const built = join(temporary, 'dist');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
await cp(resolve(process.env.PARTNER_BUILD_DIR || 'dist'), built, { recursive: true });
await mkdir(resolve('artifacts'), { recursive: true });
const backend = spawn(resolve('../backend/.venv/Scripts/python.exe'), ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8033'], {
  cwd: resolve('../backend'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, DATABASE_URL: `sqlite:///${join(temporary, 'test.db').replaceAll('\\', '/')}`, NOOR_OWNER_USERNAME: '', NOOR_OWNER_PASSWORD_HASH: '', NOOR_COOKIE_SECURE: 'false', FRONTEND_ORIGINS: origin, NOOR_UPLOAD_DIR: join(temporary, 'uploads') },
});
let backendLog = '', browserLog = '';
backend.stdout.on('data', data => { backendLog += data; });
backend.stderr.on('data', data => { backendLog += data; });
const server = createServer(async (req, res) => {
  const path = new URL(req.url, origin).pathname;
  if (path.startsWith('/api/')) {
    const forwarded = request(`${backendOrigin}${req.url}`, { method: req.method, headers: req.headers }, upstream => {
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
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(4203, '127.0.0.1', resolve); });
  chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--disable-software-rasterizer', '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=9263', `--user-data-dir=${join(temporary, 'chrome')}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
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
  await checkPartnerDocumentActions({ cdp, evaluate, ready, until, go, fill, click, resize, screenshot, workspace });
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
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
  if (dirname(candidate) === resolve(tmpdir()) && basename(candidate).startsWith('zar-partner-actions-check-')) {
    try { await rm(candidate, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }); } catch {}
  }
}
