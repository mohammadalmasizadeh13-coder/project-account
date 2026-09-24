import { runWorkspaceChecks } from './workspace-browser-scenarios.mjs';
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
const origin = 'http://127.0.0.1:4190';
const debugOrigin = 'http://127.0.0.1:9233';
const account = 'workspace-browser-test';
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
await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(4190, '127.0.0.1', resolveListen); });
const profile = await mkdtemp(join(tmpdir(), 'zar-inventory-check-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=9233', `--user-data-dir=${profile}`, 'about:blank',
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
  await runWorkspaceChecks({ cdp, evaluate, ready, click, fill, navigate, screenshot, noOverflow, pause, errors });
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
