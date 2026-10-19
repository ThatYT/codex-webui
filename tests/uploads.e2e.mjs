import { createServer } from 'node:net';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { artifacts, launchOptions } from './browser-runtime.mjs';

const root = resolve(import.meta.dirname, '..');
const fixture = mkdtempSync(join(artifacts, 'upload-test-'));
const probe = createServer();
await new Promise(resolveReady => probe.listen(0, '127.0.0.1', resolveReady));
const port = probe.address().port;
await new Promise(resolveClosed => probe.close(resolveClosed));
const base = `http://127.0.0.1:${port}`;
const server = Bun.spawn(['bun', 'run', 'server.ts'], { cwd: root, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), CODEX_WEBUI_CWD: fixture, CODEX_WEBUI_AUTH_STORE: join(fixture, 'auth.json') }, stdout: 'ignore', stderr: 'ignore' });
let browser;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
    if (attempt > 100) throw new Error('Upload test server did not start');
    await Bun.sleep(100);
  }
  assert.equal((await fetch(`${base}/api/uploads`)).status, 405);
  assert.equal((await fetch(`${base}/api/uploads?name=bad&cwd=${encodeURIComponent(fixture)}`, { method: 'POST', headers: { origin: 'https://evil.invalid' }, body: 'blocked' })).status, 401);
  assert.equal((await fetch(`${base}/api/uploads?name=..%2Fescape&cwd=${encodeURIComponent(fixture)}`, { method: 'POST', body: 'blocked' })).status, 400);
  assert.equal((await fetch(`${base}/api/uploads?name=bad&cwd=%2Fetc`, { method: 'POST', body: 'blocked' })).status, 400);
  assert.equal((await fetch(`${base}/api/uploads?name=huge&cwd=${encodeURIComponent(fixture)}`, { method: 'POST', body: Buffer.alloc(20 * 1024 * 1024 + 1) })).status, 413);

  browser = await chromium.launch(launchOptions());
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__codexWebuiDebug?.state.config.defaultCwd);
  // Exercise the real upload endpoint while recording model inputs instead of
  // submitting test prompts to the user's authenticated model account.
  await page.evaluate(() => {
    const api = globalThis.__codexWebuiDebug;
    api.startNewTask();
    api.state.transport = 'sse';
    window.uploadCalls = [];
    window.uploadFailSend = false;
    const original = window.fetch;
    window.fetch = async (resource, options = {}) => {
      if (new URL(resource, location.href).pathname !== '/api/rpc') return original(resource, options);
      const call = JSON.parse(options.body);
      window.uploadCalls.push(call);
      if (call.method === 'turn/start' && window.uploadFailSend) return Response.json({ type: 'rpc/error', error: 'Upload test send failure' });
      const result = call.method === 'thread/start' ? { thread: { id: 'upload-thread', cwd: api.state.config.defaultCwd, turns: [], canAcceptDirectInput: true } } : call.method === 'thread/list' ? { data: [] } : {};
      return Response.json({ type: 'rpc/result', result });
    };
  });
  const fileChooser = page.waitForEvent('filechooser');
  await page.locator('[data-composer-control="add"]').click();
  await (await fileChooser).setFiles([
    { name: 'notes 中文.txt', mimeType: 'text/plain', buffer: Buffer.from('UPLOAD_READ_TEST\n') },
    { name: 'pixel.png', mimeType: 'image/png', buffer: png },
  ]);
  await page.waitForFunction(() => document.querySelectorAll('.attachment-chip[data-status="ready"]').length === 2);
  await page.screenshot({ path: join(artifacts, 'browser-uploads.png') });
  await page.locator('#prompt').fill('Read the text file and inspect the image.');
  await page.locator('#sendButton').click();
  await page.waitForFunction(() => window.uploadCalls.some(call => call.method === 'turn/start'));
  const first = await page.evaluate(() => window.uploadCalls.find(call => call.method === 'turn/start').params.input);
  assert.match(first[0].text, /notes 中文.txt/);
  const textPath = JSON.parse(first[0].text.split('\n').at(-1).split(': ').slice(1).join(': '));
  assert.equal(readFileSync(textPath, 'utf8'), 'UPLOAD_READ_TEST\n');
  assert.equal(first[1].type, 'localImage');
  assert.deepEqual(readFileSync(first[1].path), png);
  assert.equal(await page.locator('.attachment-chip').count(), 0);

  // Sending an attachment without text is valid; failed sends keep the attachment.
  await page.locator('#attachmentInput').setInputFiles({ name: 'retry.txt', mimeType: 'text/plain', buffer: Buffer.from('retry') });
  await page.waitForSelector('.attachment-chip[data-status="ready"]');
  await page.evaluate(() => { window.uploadFailSend = true; });
  await page.locator('#sendButton').click();
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('Upload test send failure'));
  assert.equal(await page.locator('.attachment-chip[data-status="ready"]').count(), 1);
  await page.evaluate(() => { window.uploadFailSend = false; });
  await page.locator('#sendButton').click();
  await page.waitForFunction(() => document.querySelectorAll('.attachment-chip').length === 0);

  // A failed transfer exposes retry; removing it does not send anything.
  await page.route('**/api/uploads?**', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Simulated upload failure' }) }), { times: 1 });
  await page.locator('#attachmentInput').setInputFiles({ name: 'removed.txt', mimeType: 'text/plain', buffer: Buffer.from('remove') });
  await page.waitForSelector('.attachment-chip[data-status="error"]');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.waitForSelector('.attachment-chip[data-status="ready"]');
  await page.getByRole('button', { name: 'Remove removed.txt' }).click();
  assert.equal(await page.locator('.attachment-chip').count(), 0);
  // The draft cannot submit while a transfer is still pending; New task cancels it.
  await page.route('**/api/uploads?**', async route => { await new Promise(resolveDelay => setTimeout(resolveDelay, 1200)); await route.continue().catch(() => {}); }, { times: 1 });
  const sentBefore = await page.evaluate(() => window.uploadCalls.filter(call => call.method === 'turn/start').length);
  await page.locator('#attachmentInput').setInputFiles({ name: 'pending.txt', mimeType: 'text/plain', buffer: Buffer.from('pending') });
  await page.waitForSelector('.attachment-chip[data-status="uploading"]');
  await page.locator('#sendButton').click();
  assert.equal(await page.evaluate(() => window.uploadCalls.filter(call => call.method === 'turn/start').length), sentBefore);
  await page.locator('#newTask').click();
  assert.equal(await page.locator('.attachment-chip').count(), 0);
  await page.waitForTimeout(1300);
  assert.equal(await page.locator('.attachment-chip').count(), 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ upload: 'text and image bytes verified', inputs: 'server file reference and localImage verified', failedSend: 'attachment retained and resent', failedUpload: 'retry passed', remove: 'passed', security: 'method, cross-origin, traversal, outside project, size limit passed', browserErrors: errors }));
} finally {
  await browser?.close(); server.kill(); await server.exited;
  rmSync(fixture, { recursive: true, force: true });
}
