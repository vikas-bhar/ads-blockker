import { describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EXT_DIR = path.join(ROOT, 'extension');

function loadFilterParserCode() {
  return fs.readFileSync(path.join(ROOT, 'tools/src/filter-parser.mjs'), 'utf8');
}

function createChromeMock({
  rulesets = {
    ads: [{ id: 1, priority: 1, action: { type: 'block' }, condition: { requestDomains: ['doubleclick.net'] } }],
    domains: [{ id: 1, priority: 1, action: { type: 'block' }, condition: { requestDomains: ['taboola.com'] } }],
    domains_2: [{ id: 1, priority: 1, action: { type: 'block' }, condition: { requestDomains: ['extra-ads.example'] } }],
    domains_3: [{ id: 1, priority: 1, action: { type: 'block' }, condition: { requestDomains: ['tail-ads.example'] } }]
  },
  cosmetic = {
    version: 1,
    global: ['.global-ad', '.shared-banner'],
    domains: {
      'news.example': ['.news-ad'],
      'tripadvisor.*': ['.trip-promo'],
      'gh-site.example': ['.specific-ad']
    },
    exceptions: {
      'news.example': ['.shared-banner']
    },
    generichide: ['gh-site.example'],
    elemhide: ['nohide.example']
  },
  remoteResponses = {},
  rejectAllowAllRequests = false,
  maxStaticRulesets = 4,
  initialEnabledRulesets = null
} = {}) {
  const syncStore = {};
  const localStore = {};
  const dynamicRules = new Map();
  const disabledStaticRules = new Map();
  let enabledRulesets = initialEnabledRulesets ? [...initialEnabledRulesets] : Object.keys(rulesets);
  const listeners = {
    onInstalled: [],
    onStartup: [],
    onChanged: [],
    onMessage: [],
    onAlarm: []
  };
  const badge = { color: '', text: '', actionCount: false };

  const clone = (val) => JSON.parse(JSON.stringify(val));

  const api = {
    runtime: {
      getManifest: () => ({
        name: 'ShieldAd',
        declarative_net_request: {
          rule_resources: Object.keys(rulesets).map((id) => ({ id, enabled: true, path: `rulesets/${id}.json` }))
        }
      }),
      getURL: (rel) => `chrome-extension://test/${rel}`,
      onInstalled: { addListener: (fn) => listeners.onInstalled.push(fn) },
      onStartup: { addListener: (fn) => listeners.onStartup.push(fn) },
      onMessage: { addListener: (fn) => listeners.onMessage.push(fn) }
    },
    storage: {
      sync: {
        get: async (defaults) => {
          if (typeof defaults === 'object' && !Array.isArray(defaults)) {
            const out = {};
            for (const [k, v] of Object.entries(defaults)) out[k] = k in syncStore ? clone(syncStore[k]) : clone(v);
            return out;
          }
          const keys = Array.isArray(defaults) ? defaults : [defaults];
          const out = {};
          for (const k of keys) if (k in syncStore) out[k] = clone(syncStore[k]);
          return out;
        },
        set: async (patch) => {
          const changes = {};
          for (const [k, v] of Object.entries(patch)) {
            changes[k] = { oldValue: syncStore[k], newValue: clone(v) };
            syncStore[k] = clone(v);
          }
          for (const fn of listeners.onChanged) fn(changes, 'sync');
        }
      },
      local: {
        get: async (defaults) => {
          if (typeof defaults === 'object' && !Array.isArray(defaults)) {
            const out = {};
            for (const [k, v] of Object.entries(defaults)) out[k] = k in localStore ? clone(localStore[k]) : clone(v);
            return out;
          }
          const keys = Array.isArray(defaults) ? defaults : [defaults];
          const out = {};
          for (const k of keys) if (k in localStore) out[k] = clone(localStore[k]);
          return out;
        },
        set: async (patch) => {
          const changes = {};
          for (const [k, v] of Object.entries(patch)) {
            changes[k] = { oldValue: localStore[k], newValue: clone(v) };
            localStore[k] = clone(v);
          }
          for (const fn of listeners.onChanged) fn(changes, 'local');
        }
      },
      onChanged: { addListener: (fn) => listeners.onChanged.push(fn) }
    },
    declarativeNetRequest: {
      getDynamicRules: async () => clone([...dynamicRules.values()]),
      updateDynamicRules: async ({ removeRuleIds = [], addRules = [] }) => {
        if (rejectAllowAllRequests && addRules.some((r) => r.action?.type === 'allowAllRequests')) {
          throw new Error('allowAllRequests unsupported');
        }
        const bad = addRules.find((r) => r.condition?.urlFilter?.includes('INVALID_BY_BROWSER'));
        if (bad) throw new Error(`Invalid rule ${bad.id}`);
        for (const id of removeRuleIds) dynamicRules.delete(id);
        for (const rule of addRules) {
          if (dynamicRules.has(rule.id)) throw new Error(`Rule with id ${rule.id} already exists`);
          dynamicRules.set(rule.id, clone(rule));
        }
      },
      getEnabledRulesets: async () => [...enabledRulesets],
      updateEnabledRulesets: async ({ enableRulesetIds = [], disableRulesetIds = [] }) => {
        const next = new Set(enabledRulesets);
        for (const id of disableRulesetIds) next.delete(id);
        for (const id of enableRulesetIds) next.add(id);
        if (next.size > maxStaticRulesets) throw new Error('Static rule quota exceeded');
        enabledRulesets = [...next];
      },
      getDisabledRuleIds: async ({ rulesetId }) => [...(disabledStaticRules.get(rulesetId) || new Set())],
      updateStaticRules: async ({ rulesetId, disableRuleIds = [], enableRuleIds = [] }) => {
        if (!disabledStaticRules.has(rulesetId)) disabledStaticRules.set(rulesetId, new Set());
        const set = disabledStaticRules.get(rulesetId);
        for (const id of disableRuleIds) set.add(id);
        for (const id of enableRuleIds) set.delete(id);
      },
      setExtensionActionOptions: async ({ displayActionCountAsBadgeText }) => {
        badge.actionCount = Boolean(displayActionCountAsBadgeText);
      },
      getMatchedRules: async ({ tabId }) => ({ rulesMatchedInfo: tabId === 7 ? [{}, {}, {}] : [] })
    },
    action: {
      setBadgeBackgroundColor: async ({ color }) => { badge.color = color; },
      setBadgeText: async ({ text }) => { badge.text = text; },
      getBadgeText: async () => badge.text
    },
    alarms: {
      create: () => {},
      onAlarm: { addListener: (fn) => listeners.onAlarm.push(fn) }
    }
  };

  const fetchMock = async (url) => {
    if (url.startsWith('chrome-extension://test/')) {
      const rel = url.replace('chrome-extension://test/', '');
      if (rel === 'cosmetic.json') return { ok: true, status: 200, json: async () => clone(cosmetic) };
      const match = rel.match(/^rulesets\/(.+)\.json$/);
      if (match && rulesets[match[1]]) return { ok: true, status: 200, json: async () => clone(rulesets[match[1]]) };
      return { ok: false, status: 404 };
    }
    for (const [suffix, payload] of Object.entries(remoteResponses)) {
      if (url.includes(suffix)) {
        if (payload === null) return { ok: false, status: 404 };
        return { ok: true, status: 200, json: async () => clone(payload) };
      }
    }
    return { ok: false, status: 404 };
  };

  const sendMessage = (message, sender = {}) => new Promise((resolve) => {
    for (const fn of listeners.onMessage) fn(message, sender, resolve);
  });

  return {
    api,
    fetchMock,
    syncStore,
    localStore,
    dynamicRules,
    disabledStaticRules,
    badge,
    listeners,
    sendMessage,
    getEnabledRulesets: () => [...enabledRulesets]
  };
}

async function bootBackground(mock) {
  const parserSrc = loadFilterParserCode();
  const customSrc = fs.readFileSync(path.join(EXT_DIR, 'custom-rules.js'), 'utf8');
  const bgSrc = fs.readFileSync(path.join(EXT_DIR, 'background.js'), 'utf8');

  const context = vm.createContext({
    chrome: mock.api,
    fetch: mock.fetchMock,
    URL,
    TextEncoder,
    AbortSignal,
    Set,
    Map,
    Array,
    Object,
    String,
    Number,
    Boolean,
    JSON,
    Math,
    Promise,
    Date,
    console,
    setTimeout,
    clearTimeout
  });

  const modules = new Map();
  const linker = (specifier, referencingModule) => {
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(referencingModule.identifier), specifier));
    return modules.get(resolved);
  };

  const parserMod = new vm.SourceTextModule(parserSrc, { identifier: '/ext/filter-parser.js', context });
  modules.set('/ext/filter-parser.js', parserMod);
  await parserMod.link(linker);
  await parserMod.evaluate();

  const customMod = new vm.SourceTextModule(customSrc, { identifier: '/ext/custom-rules.js', context });
  modules.set('/ext/custom-rules.js', customMod);
  await customMod.link(linker);
  await customMod.evaluate();

  const bgMod = new vm.SourceTextModule(bgSrc, { identifier: '/ext/background.js', context });
  modules.set('/ext/background.js', bgMod);
  await bgMod.link(linker);
  await bgMod.evaluate();

  for (const fn of mock.listeners.onInstalled) await fn();
  return { customMod, bgMod };
}

describe('extension custom rules & background runtime', () => {
  it('compiles custom network and cosmetic rules and normalizes allowlist URLs', async () => {
    const mock = createChromeMock();
    const { customMod } = await bootBackground(mock);
    const { compileUserRules, normalizeDomainList } = customMod.namespace;

    const compiled = compileUserRules([
      '! comment',
      '||custom-ad.example^',
      '@@||needed.example^',
      '||forced.example^$important',
      'example.com##.promo-box',
      'example.com#@#.ad',
      'bad.example##+js(nope)',
      '||broken^$unknownmod=1'
    ].join('\n'));

    expect(compiled.networkRules).toHaveLength(3);
    expect(compiled.networkRules[0].priority).toBe(300); // custom @@ allow
    expect(compiled.networkRules[1].priority).toBe(10); // custom block
    expect(compiled.networkRules[2].priority).toBe(450); // custom $important block
    expect(compiled.cosmetic.domains['example.com']).toEqual(['.promo-box']);
    expect(compiled.cosmetic.exceptions['example.com']).toEqual(['.ad']);
    expect(compiled.invalidLines).toEqual(['bad.example##+js(nope)', '||broken^$unknownmod=1']);

    expect(normalizeDomainList(['https://Sub.Example.com/path', '*.Other.org.', '0.0.0.0', 'bad'])).toEqual([
      'sub.example.com',
      'other.org'
    ]);
  });

  it('handles global toggle, site pause with allowAllRequests, and concurrent updates cleanly', async () => {
    const mock = createChromeMock();
    await bootBackground(mock);

    expect(mock.getEnabledRulesets()).toEqual(['ads', 'domains', 'domains_2', 'domains_3']);
    expect(mock.badge.actionCount).toBe(true);

    // Rapid concurrent toggles should serialize without duplicate ID errors
    const [r1, r2] = await Promise.all([
      mock.sendMessage({ type: 'APPLY_SETTINGS', patch: { pausedSites: ['https://news.example/story'] } }),
      mock.sendMessage({ type: 'APPLY_SETTINGS', patch: { enabled: false } })
    ]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);

    expect(mock.getEnabledRulesets()).toEqual([]);
    expect(mock.badge.text).toBe('OFF');
    expect(mock.badge.actionCount).toBe(false);
    const dynOff = [...mock.dynamicRules.values()];
    expect(dynOff.some((r) => r.id === 999999 && r.action.type === 'allow')).toBe(true);
    expect(dynOff.some((r) => r.action.type === 'allowAllRequests' && r.condition.requestDomains.includes('news.example'))).toBe(true);

    const r3 = await mock.sendMessage({ type: 'APPLY_SETTINGS', patch: { enabled: true } });
    expect(r3.ok).toBe(true);
    expect(mock.getEnabledRulesets()).toEqual(['ads', 'domains', 'domains_2', 'domains_3']);
    expect(mock.badge.text).toBe('');
    expect(mock.badge.actionCount).toBe(true);
    expect(mock.dynamicRules.has(999999)).toBe(false);
  });

  it('applies generichide, elemhide, brand.* matching, cosmetic exceptions, and custom cosmetics', async () => {
    const mock = createChromeMock();
    await bootBackground(mock);

    await mock.sendMessage({
      type: 'APPLY_SETTINGS',
      patch: { customRules: 'news.example##.custom-news-ad\n##.custom-global-ad' }
    });

    const newsCosmetic = await mock.sendMessage({ type: 'GET_COSMETIC', hostname: 'www.news.example' });
    expect(newsCosmetic.active).toBe(true);
    expect(newsCosmetic.selectors).toContain('.global-ad');
    expect(newsCosmetic.selectors).toContain('.news-ad');
    expect(newsCosmetic.selectors).toContain('.custom-news-ad');
    expect(newsCosmetic.selectors).toContain('.custom-global-ad');
    expect(newsCosmetic.selectors).not.toContain('.shared-banner');

    const tripCosmetic = await mock.sendMessage({ type: 'GET_COSMETIC', hostname: 'www.tripadvisor.co.uk' });
    expect(tripCosmetic.selectors).toContain('.trip-promo');

    const genericHideCosmetic = await mock.sendMessage({ type: 'GET_COSMETIC', hostname: 'gh-site.example' });
    expect(genericHideCosmetic.selectors).toEqual(['.specific-ad']);

    const elemHideCosmetic = await mock.sendMessage({ type: 'GET_COSMETIC', hostname: 'nohide.example' });
    expect(elemHideCosmetic.selectors).toEqual([]);
  });

  it('stores large custom rules in local overflow without exceeding sync quota and isolates DNR rejections', async () => {
    const mock = createChromeMock();
    await bootBackground(mock);

    const bigRules = Array.from({ length: 350 }, (_, i) => `||custom-tracker-${i}.example.com^`).join('\n');
    const bigRes = await mock.sendMessage({ type: 'APPLY_SETTINGS', patch: { customRules: bigRules } });
    expect(bigRes.ok).toBe(true);
    expect(bigRes.appliedCustom).toBe(true);
    expect(mock.syncStore.customRules).toBe('');
    expect(mock.localStore.customRulesOverflow).toBe(true);
    expect(bigRes.status.customNetworkCount).toBe(350);

    const badRes = await mock.sendMessage({
      type: 'APPLY_SETTINGS',
      patch: { customRules: '*/INVALID_BY_BROWSER/*\n||ok.example^', allowlist: ['trusted.example'] }
    });
    expect(badRes.ok).toBe(true);
    expect(badRes.appliedCustom).toBe(false);
    expect(badRes.status.customRulesError).toContain('Invalid rule');
    // System allowlist rules still applied despite bad custom rule!
    expect([...mock.dynamicRules.values()].some((r) => r.condition.requestDomains?.includes('trusted.example'))).toBe(true);
  });

  it('computes delta updates and disables removed static rules on UPDATE_FILTERS', async () => {
    const mock = createChromeMock({
      remoteResponses: {
        'rulesets/ads.json': [
          { id: 1, priority: 1, action: { type: 'block' }, condition: { requestDomains: ['new-adserver.example'] } }
        ],
        'rulesets/domains.json': [
          { id: 1, priority: 1, action: { type: 'block' }, condition: { requestDomains: ['taboola.com'] } }
        ],
        'rulesets/domains_2.json': null,
        'rulesets/domains_3.json': null,
        'cosmetic.json': { version: 1, global: ['.updated-ad'], domains: {}, exceptions: {}, generichide: [], elemhide: [] }
      }
    });
    await bootBackground(mock);

    const update = await mock.sendMessage({ type: 'UPDATE_FILTERS' });
    expect(update.ok).toBe(true);
    expect(update.count).toBe(1); // only new-adserver.example, not duplicate taboola.com
    expect(update.disabledStaticCount).toBe(1); // doubleclick.net was removed in remote ads.json
    expect(mock.disabledStaticRules.get('ads').has(1)).toBe(true);
    expect([...mock.dynamicRules.values()].some((r) => r.condition.requestDomains?.includes('new-adserver.example'))).toBe(true);

    const cosmetic = await mock.sendMessage({ type: 'GET_COSMETIC', hostname: 'anything.example' });
    expect(cosmetic.selectors).toEqual(['.updated-ad']);
  });

  it('gracefully caps static rulesets on constrained browsers', async () => {
    const mock = createChromeMock({ maxStaticRulesets: 2, initialEnabledRulesets: ['ads'] });
    await bootBackground(mock);
    expect(mock.getEnabledRulesets()).toEqual(['ads', 'domains']);
  });
});

describe('content script cosmetic engine', () => {
  it('installs batched CSS without per-selector scanning, repairs bad batches, and restores hidden elements on toggle off', async () => {
    const contentSrc = fs.readFileSync(path.join(EXT_DIR, 'content.js'), 'utf8');

    class FakeStyleProps {
      constructor() { this.map = new Map(); }
      setProperty(k, v, p = '') { this.map.set(k, { value: v, priority: p }); }
      getPropertyValue(k) { return this.map.get(k)?.value || ''; }
      getPropertyPriority(k) { return this.map.get(k)?.priority || ''; }
      removeProperty(k) { this.map.delete(k); }
    }

    class FakeElement {
      constructor(tag, classes = []) {
        this.nodeType = 1;
        this.tagName = tag;
        this.classes = classes;
        this.dataset = {};
        this.style = new FakeStyleProps();
        this.children = [];
        this.parentElement = null;
        this.isConnected = true;
        this._text = '';
      }
      appendChild(child) {
        child.parentElement = this;
        child.isConnected = true;
        this.children.push(child);
        return child;
      }
      remove() {
        this.isConnected = false;
        if (this.parentElement) {
          this.parentElement.children = this.parentElement.children.filter((c) => c !== this);
        }
      }
      set textContent(val) {
        this._text = val;
        if (this.tagName === 'STYLE') {
          this.sheet = {
            cssRules: val
              ? val.split('\n').filter((line) => !line.includes('::invalid('))
              : []
          };
        }
      }
      get textContent() { return this._text; }
      matches(selector) {
        if (selector.includes('::invalid(')) throw new SyntaxError('Bad selector');
        return selector.split(',').some((part) => {
          const trimmed = part.trim();
          return trimmed.startsWith('.') && this.classes.includes(trimmed.slice(1));
        });
      }
      querySelectorAll(selector) {
        if (selector.includes('::invalid(')) throw new SyntaxError('Bad selector');
        const out = [];
        const walk = (node) => {
          for (const child of node.children) {
            if (selector === '[data-shieldad-hidden]' ? child.dataset.shieldadHidden : child.matches(selector)) {
              out.push(child);
            }
            walk(child);
          }
        };
        walk(this);
        return out;
      }
    }

    const root = new FakeElement('HTML');
    const head = new FakeElement('HEAD');
    const body = new FakeElement('BODY');
    const adEl = new FakeElement('DIV', ['ad-banner']);
    adEl.style.setProperty('display', 'block', 'important');
    const safeEl = new FakeElement('DIV', ['article']);
    root.appendChild(head);
    root.appendChild(body);
    body.appendChild(adEl);
    body.appendChild(safeEl);

    let active = true;
    const storageListeners = [];
    let observerCallback = null;

    class FakeMutationObserver {
      constructor(cb) { observerCallback = cb; }
      observe() {}
      disconnect() {}
    }

    const sandbox = vm.createContext({
      Node: { ELEMENT_NODE: 1 },
      location: { hostname: 'site.example' },
      document: {
        contentType: 'text/html',
        documentElement: root,
        head,
        createElement: (tag) => new FakeElement(tag.toUpperCase())
      },
      MutationObserver: FakeMutationObserver,
      requestAnimationFrame: (fn) => fn(),
      cancelAnimationFrame: () => {},
      chrome: {
        runtime: {
          sendMessage: async () => active
            ? { active: true, selectors: ['.ad-banner', '::invalid(x)'] }
            : { active: false, selectors: [] }
        },
        storage: {
          onChanged: { addListener: (fn) => storageListeners.push(fn) }
        }
      },
      WeakMap,
      Set,
      Array,
      String
    });

    vm.runInContext(contentSrc, sandbox);
    await new Promise((resolve) => setTimeout(resolve, 10));

    const styleEl = head.children.find((el) => el.dataset.shieldad === 'cosmetic');
    expect(styleEl).toBeTruthy();
    expect(styleEl.textContent).toBe('.ad-banner{display:none !important;}');
    expect(adEl.style.getPropertyValue('display')).toBe('none');
    expect(adEl.style.getPropertyPriority('display')).toBe('important');
    expect(safeEl.style.getPropertyValue('display')).toBe('');

    // Page removes style tag -> observer re-attaches it
    styleEl.remove();
    expect(styleEl.isConnected).toBe(false);
    observerCallback([{ removedNodes: [styleEl], addedNodes: [] }]);
    expect(styleEl.isConnected).toBe(true);

    // Protection toggled OFF -> restores original display: block !important!
    active = false;
    for (const fn of storageListeners) fn({ enabled: { oldValue: true, newValue: false } }, 'sync');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(styleEl.textContent).toBe('');
    expect(adEl.style.getPropertyValue('display')).toBe('block');
    expect(adEl.style.getPropertyPriority('display')).toBe('important');
  });
});
