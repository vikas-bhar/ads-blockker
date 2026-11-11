import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EXT_DIR = path.join(ROOT, 'dist/shieldad-chrome');
const CHROME_BIN = process.env.CHROME_BIN || process.env.PUPPETEER_EXECUTABLE_PATH || [
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].find((candidate) => existsSync(candidate));
if (!CHROME_BIN) {
  throw new Error('Set CHROME_BIN to a full Chrome/Chromium binary (Chrome for Testing) before running test:browser');
}

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const AD_HOSTS = [
  'doubleclick.net',
  'amazon-adsystem.com',
  'pubmatic.com',
  'taboola.com',
  'outbrain.com',
  'openx.net'
];

function startFixtureServer() {
  const hits = new Map();
  const record = (host, pathname) => {
    const key = `${host}${pathname}`;
    hits.set(key, (hits.get(key) || 0) + 1);
  };

  const server = http.createServer((req, res) => {
    const host = (req.headers.host || '127.0.0.1').split(':')[0].toLowerCase();
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    record(host, url.pathname);

    if (url.pathname === '/safe.png') {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
      res.end(PNG_1X1);
      return;
    }

    if (url.pathname.endsWith('.js')) {
      res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' });
      res.end(`window.__loadedScripts = window.__loadedScripts || []; window.__loadedScripts.push(${JSON.stringify(host + url.pathname)});`);
      return;
    }

    if (url.pathname === '/frame.html') {
      const port = server.address().port;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(`<!doctype html><html><body>
        <script src="http://taboola.com:${port}/iframe-ad.js"></script>
        <div id="iframe-ok">iframe</div>
      </body></html>`);
      return;
    }

    const port = server.address().port;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(`<!doctype html><html><head><title>ShieldAd Fixture</title></head><body>
      <div id="cosmetic-global" class="ADBox" style="display:block !important">Global Ad</div>
      <div id="cosmetic-child" class="ob_dual_right">
        <div class="ob_ads_header">Header</div>
        <div id="cosmetic-child-target" class="odb_div">Outbrain Div</div>
      </div>
      <div id="cosmetic-domain" class="ad">Domain Specific Ad</div>
      <div id="cosmetic-ap-specific" class="w-pencil-banner">AndroidPolice Specific</div>
      <div id="cosmetic-custom" class="custom-hidden-slot">Custom Hidden Slot</div>
      <div id="safe-content" class="article-body">Real Article Content</div>
      <img id="safe-img" src="/safe.png" width="16" height="16" alt="ok">
      <script src="/safe.js"></script>
      <script src="http://doubleclick.net:${port}/pixel.js"></script>
      <script src="http://amazon-adsystem.com:${port}/banner.js"></script>
      <script src="http://pubmatic.com:${port}/bid.js"></script>
      <script src="http://taboola.com:${port}/loader.js"></script>
      <script src="http://outbrain.com:${port}/widget.js"></script>
      <script src="http://openx.net:${port}/ad.js"></script>
      <script src="http://custom-blocked.test:${port}/custom.js"></script>
      <iframe id="third-party-frame" src="http://iframe-host.test:${port}/frame.html"></iframe>
      <script>
        setTimeout(() => {
          const el = document.createElement('div');
          el.id = 'late-ad';
          el.className = 'ADBox';
          el.textContent = 'Late Ad';
          document.body.appendChild(el);
        }, 120);
      </script>
    </body></html>`);
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        hits,
        resetHits: () => hits.clear(),
        close: () => new Promise((r) => server.close(r))
      });
    });
  });
}

async function waitForShieldAdWorker(browser) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    for (const target of browser.targets()) {
      if (target.type() !== 'service_worker') continue;
      try {
        const worker = await target.worker();
        if (!worker) continue;
        const name = await worker.evaluate(() => globalThis.chrome?.runtime?.getManifest?.().name || '');
        if (name === 'ShieldAd') return { worker, extensionId: new URL(target.url()).hostname };
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Timed out waiting for ShieldAd MV3 service worker');
}

async function main() {
  const server = await startFixtureServer();
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shieldad-chrome-'));
  const mappedHosts = [
    ...AD_HOSTS,
    'news.shieldad.test',
    'iframe-host.test',
    'custom-blocked.test',
    'www.tripadvisor.co.uk',
    'androidpolice.com'
  ];
  const hostResolverRules = mappedHosts.map((h) => `MAP ${h} 127.0.0.1`).join(',');

  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME_BIN,
      headless: false,
      userDataDir,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        `--disable-extensions-except=${EXT_DIR}`,
        `--load-extension=${EXT_DIR}`,
        `--host-resolver-rules=${hostResolverRules}`
      ]
    });

    const { worker, extensionId } = await waitForShieldAdWorker(browser);
    console.log('ShieldAd worker ready:', extensionId);

    // Wait briefly for onInstalled reconciliation to complete.
    await new Promise((r) => setTimeout(r, 400));

    const enabledRulesets = await worker.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets());
    console.log('Enabled static rulesets:', enabledRulesets);
    assert.deepEqual(
      new Set(enabledRulesets),
      new Set(['ads', 'domains', 'domains_2', 'domains_3']),
      'All 4 static rulesets should be active in Chrome'
    );

    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    // 1. Default blocking on news.shieldad.test
    server.resetHits();
    await page.goto(`http://news.shieldad.test:${server.port}/page.html`, { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 350));

    for (const host of AD_HOSTS) {
      const hostHits = [...server.hits.keys()].filter((k) => k.startsWith(`${host}/`));
      assert.equal(hostHits.length, 0, `Expected ${host} requests to be blocked, saw: ${hostHits.join(', ')}`);
    }
    assert.ok((server.hits.get('news.shieldad.test/safe.js') || 0) >= 1, 'Same-origin safe.js should load');
    assert.ok((server.hits.get('news.shieldad.test/safe.png') || 0) >= 1, 'Same-origin safe.png should load');
    assert.ok((server.hits.get('custom-blocked.test/custom.js') || 0) >= 1, 'Unconfigured custom domain should load initially');

    const states = await page.evaluate(() => ({
      globalAd: getComputedStyle(document.getElementById('cosmetic-global')).display,
      childAd: getComputedStyle(document.getElementById('cosmetic-child-target')).display,
      lateAd: getComputedStyle(document.getElementById('late-ad')).display,
      safeContent: getComputedStyle(document.getElementById('safe-content')).display,
      safeImgLoaded: document.getElementById('safe-img').complete && document.getElementById('safe-img').naturalWidth === 1
    }));
    assert.equal(states.globalAd, 'none', 'Inline-!important .ADBox should be hidden');
    assert.equal(states.childAd, 'none', 'Child combinator .ob_dual_right > .ob_ads_header ~ .odb_div should be hidden');
    assert.equal(states.lateAd, 'none', 'Late-added .ADBox should be hidden');
    assert.notEqual(states.safeContent, 'none', 'Safe content must remain visible');
    assert.equal(states.safeImgLoaded, true, 'Safe image must load');

    const matched = await worker.evaluate(async () => chrome.declarativeNetRequest.getMatchedRules({}));
    console.log('Matched DNR rule count:', matched.rulesMatchedInfo.length);
    assert.ok(matched.rulesMatchedInfo.length >= AD_HOSTS.length, 'DNR must report matched rules for blocked ad hosts');

    // 2. Verify brand.* cosmetic rule (tripadvisor.*)
    await page.goto(`http://www.tripadvisor.co.uk:${server.port}/page.html`, { waitUntil: 'networkidle0' });
    const tripDisplay = await page.evaluate(() => getComputedStyle(document.getElementById('cosmetic-domain')).display);
    assert.equal(tripDisplay, 'none', 'tripadvisor.* cosmetic rule should hide .ad on tripadvisor.co.uk');

    // 3. Verify $generichide on androidpolice.com
    await page.goto(`http://androidpolice.com:${server.port}/page.html`, { waitUntil: 'networkidle0' });
    const apState = await page.evaluate(() => ({
      genericAd: getComputedStyle(document.getElementById('cosmetic-global')).display,
      specificAd: getComputedStyle(document.getElementById('cosmetic-ap-specific')).display
    }));
    assert.notEqual(apState.genericAd, 'none', '$generichide must prevent generic .ADBox hiding on androidpolice.com');
    assert.equal(apState.specificAd, 'none', 'Domain-specific rule must still hide .w-pencil-banner on androidpolice.com');

    // 4. Verify Global OFF restores ads & cosmetics, and Global ON restores blocking
    await worker.evaluate(async () => {
      await chrome.storage.sync.set({ enabled: false });
    });
    await new Promise((r) => setTimeout(r, 400));

    server.resetHits();
    await page.goto(`http://news.shieldad.test:${server.port}/page.html`, { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 250));
    for (const host of AD_HOSTS) {
      const hostHits = [...server.hits.keys()].filter((k) => k.startsWith(`${host}/`));
      assert.ok(hostHits.length >= 1, `Expected ${host} to load when global protection is OFF`);
    }
    const offCosmetic = await page.evaluate(() => getComputedStyle(document.getElementById('cosmetic-global')).display);
    assert.notEqual(offCosmetic, 'none', 'Cosmetic hiding must be disabled when global protection is OFF');

    await worker.evaluate(async () => {
      await chrome.storage.sync.set({ enabled: true });
    });
    await new Promise((r) => setTimeout(r, 400));

    server.resetHits();
    await page.goto(`http://news.shieldad.test:${server.port}/page.html`, { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 250));
    for (const host of AD_HOSTS) {
      const hostHits = [...server.hits.keys()].filter((k) => k.startsWith(`${host}/`));
      assert.equal(hostHits.length, 0, `Expected ${host} to be blocked again after re-enabling`);
    }
    const onCosmetic = await page.evaluate(() => getComputedStyle(document.getElementById('cosmetic-global')).display);
    assert.equal(onCosmetic, 'none', 'Cosmetic hiding must recover after re-enabling');

    // 5. Verify Per-Site Pause uses allowAllRequests so nested third-party iframe ads are also allowed
    await worker.evaluate(async () => {
      await chrome.storage.sync.set({ pausedSites: ['news.shieldad.test'] });
    });
    await new Promise((r) => setTimeout(r, 400));

    server.resetHits();
    await page.goto(`http://news.shieldad.test:${server.port}/page.html`, { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 250));
    assert.ok((server.hits.get('taboola.com/loader.js') || 0) >= 1, 'Paused site main frame ads should load');
    assert.ok((server.hits.get('taboola.com/iframe-ad.js') || 0) >= 1, 'Paused site nested third-party iframe ads should load via allowAllRequests');

    await worker.evaluate(async () => {
      await chrome.storage.sync.set({ pausedSites: [] });
    });
    await new Promise((r) => setTimeout(r, 400));

    // 6. Verify Popup & Options UI and live custom network + cosmetic rule saving
    const popupPage = await browser.newPage();
    popupPage.on('pageerror', (err) => pageErrors.push(`popup: ${err.message}`));
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'networkidle0' });
    const popupTitle = await popupPage.$eval('h1', (el) => el.textContent);
    assert.equal(popupTitle, 'ShieldAd');
    await popupPage.close();

    const optionsPage = await browser.newPage();
    optionsPage.on('pageerror', (err) => pageErrors.push(`options: ${err.message}`));
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'networkidle0' });
    await optionsPage.waitForFunction(() => document.getElementById('statNetwork').textContent !== '—');
    const ruleText = await optionsPage.$eval('#statNetwork', (el) => el.textContent);
    console.log('Options statNetwork:', ruleText);
    assert.ok(Number(ruleText.replace(/,/g, '')) > 90000, `Expected >90,000 active rules in Options, saw ${ruleText}`);

    await optionsPage.$eval('#customRules', (el) => {
      el.value = '||custom-blocked.test^\nnews.shieldad.test##.custom-hidden-slot';
    });
    await optionsPage.click('#save');
    await optionsPage.waitForFunction(() => document.getElementById('saved').textContent.includes('Saved'));
    await optionsPage.close();

    server.resetHits();
    await page.goto(`http://news.shieldad.test:${server.port}/page.html`, { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 250));
    assert.equal(server.hits.get('custom-blocked.test/custom.js') || 0, 0, 'Custom network rule should block custom-blocked.test');
    const customCosmetic = await page.evaluate(() => getComputedStyle(document.getElementById('cosmetic-custom')).display);
    assert.equal(customCosmetic, 'none', 'Custom cosmetic rule should hide .custom-hidden-slot');

    assert.equal(pageErrors.length, 0, `Unexpected page errors: ${pageErrors.join(' | ')}`);
    console.log('ALL REAL CHROME EXTENSION CHECKS PASSED');
  } finally {
    if (browser) await browser.close();
    await server.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
