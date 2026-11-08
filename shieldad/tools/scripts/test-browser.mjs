import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EXTENSION = path.join(ROOT, 'dist/shieldad-chrome');
const executablePath = process.env.CHROME_BIN || [
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].find((candidate) => existsSync(candidate));
if (!executablePath) throw new Error('Set CHROME_BIN to a full Chrome/Chromium executable for the extension integration test');
if (!existsSync(path.join(EXTENSION, 'manifest.json'))) throw new Error('Run npm run build:extension before the browser integration test');

const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const requests = [];
const server = http.createServer((request, response) => {
  const host = request.headers.host || '';
  requests.push({ host, url: request.url });
  if (request.url === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(`<!doctype html><html><head><title>ShieldAd integration</title></head><body>
      <div id="static-ad" class="ad-slot">STATIC AD</div>
      <main id="safe-content">SAFE CONTENT</main>
      <script>
        window.imageResults = {};
        function loadImage(name, url) {
          return new Promise((resolve) => {
            const image = new Image();
            image.id = name;
            image.onload = () => { window.imageResults[name] = 'loaded'; document.body.appendChild(image); resolve(); };
            image.onerror = () => { window.imageResults[name] = 'blocked'; document.body.appendChild(image); resolve(); };
            image.src = url;
          });
        }
        window.imagesDone = Promise.all([
          loadImage('safe-image', '/safe.png'),
          loadImage('doubleclick-image', 'http://doubleclick.net:${server.address().port}/pixel.png'),
          loadImage('amazon-image', 'http://amazon-adsystem.com:${server.address().port}/pixel.png')
        ]);
        setTimeout(() => {
          const late = document.createElement('div');
          late.id = 'ad-slot';
          late.textContent = 'LATE AD';
          document.body.appendChild(late);
        }, 50);
      </script>
    </body></html>`);
    return;
  }
  response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
  response.end(pixel);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const profile = await mkdtemp(path.join(os.tmpdir(), 'shieldad-chrome-'));
let browser;
try {
  const mappedHosts = ['safe.test', 'doubleclick.net', 'amazon-adsystem.com']
    .map((host) => `MAP ${host} 127.0.0.1`).join(', ');
  browser = await puppeteer.launch({
    executablePath,
    headless: process.env.SHIELDAD_HEADFUL !== '1',
    userDataDir: profile,
    dumpio: process.env.SHIELDAD_BROWSER_LOG === '1',
    ignoreDefaultArgs: ['--disable-extensions', '--disable-component-extensions-with-background-pages'],
    args: [
      '--no-sandbox', '--no-proxy-server', '--disable-dev-shm-usage',
      `--host-resolver-rules=${mappedHosts}`,
      `--disable-extensions-except=${EXTENSION}`,
      `--load-extension=${EXTENSION}`
    ]
  });
  let extensionTarget;
  try {
    extensionTarget = await browser.waitForTarget(
      (target) => target.type() === 'service_worker' && target.url().endsWith('/background.js'),
      { timeout: 20000 }
    );
  } catch (error) {
    console.error('Extension service worker not found. Browser targets:', browser.targets().map((target) => ({ type: target.type(), url: target.url() })));
    throw error;
  }
  const extensionId = new URL(extensionTarget.url()).hostname;
  let worker = await extensionTarget.worker();
  const initial = await worker.evaluate(async () => ({
    enabledRulesets: await chrome.declarativeNetRequest.getEnabledRulesets(),
    availableStaticRules: await chrome.declarativeNetRequest.getAvailableStaticRuleCount(),
    dynamicRules: (await chrome.declarativeNetRequest.getDynamicRules()).length,
    settings: await chrome.storage.sync.get({ enabled: true, pausedSites: [], allowlist: [] })
  }));
  console.log('Initial extension state:', JSON.stringify(initial));
  assert.deepEqual([...initial.enabledRulesets].sort(), ['ads', 'domains'], 'Both static rulesets must load and remain enabled');
  assert.equal(initial.settings.enabled, true, 'Protection must start enabled');

  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(`http://safe.test:${port}/`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => Object.keys(window.imageResults || {}).length === 3, { timeout: 15000 });
  await new Promise((resolve) => setTimeout(resolve, 750));
  const result = await page.evaluate(() => ({
    images: window.imageResults,
    staticAdDisplay: getComputedStyle(document.getElementById('static-ad')).display,
    lateAdDisplay: getComputedStyle(document.getElementById('ad-slot'))?.display,
    safeContentDisplay: getComputedStyle(document.getElementById('safe-content')).display
  }));
  const matchedTarget = browser.targets().find((target) => target.type() === 'service_worker' && target.url().includes(extensionId));
  if (matchedTarget) worker = await matchedTarget.worker();
  else {
    const extensionPage = await browser.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/popup.html`);
    const awakened = await browser.waitForTarget((target) => target.type() === 'service_worker' && target.url().includes(extensionId));
    worker = await awakened.worker();
    await extensionPage.close();
  }
  const matched = await worker.evaluate(async () => chrome.declarativeNetRequest.getMatchedRules({}));
  const evidence = { ...result, requests, matchedRules: matched.rulesMatchedInfo, pageErrors };
  console.log('Browser evidence:', JSON.stringify(evidence, null, 2));

  assert.equal(result.images['safe-image'], 'loaded', 'Same-site resources must not be overblocked');
  assert.equal(result.images['doubleclick-image'], 'blocked', 'The domains ruleset must block doubleclick.net');
  assert.equal(result.images['amazon-image'], 'blocked', 'The ads ruleset must block amazon-adsystem.com');
  assert.equal(result.staticAdDisplay, 'none', 'Initial cosmetic ads must be hidden');
  assert.equal(result.lateAdDisplay, 'none', 'Late-added cosmetic ads must be hidden');
  assert.notEqual(result.safeContentDisplay, 'none', 'Safe page content must remain visible');
  assert.equal(requests.some((entry) => entry.host.startsWith('doubleclick.net:')), false, 'Blocked doubleclick request must not reach the server');
  assert.equal(requests.some((entry) => entry.host.startsWith('amazon-adsystem.com:')), false, 'Blocked Amazon ad request must not reach the server');
  assert.equal(pageErrors.length, 0, `Content script errors: ${pageErrors.join('; ')}`);
  console.log('PASS: real Chrome blocked both ad domains, hid initial and late cosmetic ads, and allowed safe content.');
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
