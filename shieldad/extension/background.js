import { compileCustomRules, normalizeDomainList } from './custom-rules.js';

const api = globalThis.chrome || globalThis.browser;
const DEFAULTS = { enabled: true, pausedSites: [], allowlist: [], customRules: '' };
const ALL_RESOURCES = ['main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest', 'ping', 'media', 'websocket', 'other'];
const UPDATE_BASE = 'https://raw.githubusercontent.com/vikas-bhar/ads-blockker/main/shieldad/extension';
const UPDATE_START = 600000;
const UPDATE_LIMIT = 3500;
const PAUSE_START = 300000;
const ALLOW_START = 400000;
const GLOBAL_OFF_ID = 999999;
let cosmeticCache;

const hostMatches = (host, domain) => host === domain || host.endsWith(`.${domain}`);
const isListed = (host, list) => normalizeDomainList(list).some((domain) => hostMatches(host, domain));

async function settings() {
  const value = await api.storage.sync.get(DEFAULTS);
  return { ...DEFAULTS, ...value, pausedSites: normalizeDomainList(value.pausedSites), allowlist: normalizeDomainList(value.allowlist) };
}

function allowRule(id, priority, condition) {
  return { id, priority, action: { type: 'allow' }, condition: { ...condition, resourceTypes: ALL_RESOURCES } };
}

async function dynamicRulesFor(value) {
  const rules = compileCustomRules(value.customRules);
  normalizeDomainList(value.pausedSites).slice(0, 100).forEach((domain, index) => {
    rules.push(allowRule(PAUSE_START + index * 2, 5000, { initiatorDomains: [domain] }));
    rules.push(allowRule(PAUSE_START + index * 2 + 1, 5000, { requestDomains: [domain] }));
  });
  normalizeDomainList(value.allowlist).slice(0, 100).forEach((domain, index) => {
    rules.push(allowRule(ALLOW_START + index * 2, 4500, { initiatorDomains: [domain] }));
    rules.push(allowRule(ALLOW_START + index * 2 + 1, 4500, { requestDomains: [domain] }));
  });
  const stored = await api.storage.local.get({ updatedRules: [] });
  if (Array.isArray(stored.updatedRules)) rules.push(...stored.updatedRules.slice(0, UPDATE_LIMIT));
  if (!value.enabled) rules.push(allowRule(GLOBAL_OFF_ID, 10000, { urlFilter: '*' }));
  return rules;
}

async function reconcileRules() {
  const value = await settings();
  const rules = await dynamicRulesFor(value);
  const existing = await api.declarativeNetRequest.getDynamicRules();
  await api.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((rule) => rule.id),
    addRules: rules
  });
  await api.declarativeNetRequest.updateEnabledRulesets({
    enableRulesetIds: value.enabled ? ['ads'] : [],
    disableRulesetIds: value.enabled ? [] : ['ads']
  });
}

async function loadCosmetic() {
  const stored = await api.storage.local.get(['cosmeticOverride']);
  if (stored.cosmeticOverride) return stored.cosmeticOverride;
  if (!cosmeticCache) {
    cosmeticCache = await fetch(api.runtime.getURL('cosmetic.json')).then((response) => {
      if (!response.ok) throw new Error(`Cosmetic list HTTP ${response.status}`);
      return response.json();
    });
  }
  return cosmeticCache;
}

async function updateFilters() {
  const [rulesResponse, cosmeticResponse] = await Promise.all([
    fetch(`${UPDATE_BASE}/rulesets/ads.json`, { cache: 'no-store' }),
    fetch(`${UPDATE_BASE}/cosmetic.json`, { cache: 'no-store' })
  ]);
  if (!rulesResponse.ok || !cosmeticResponse.ok) throw new Error('Filter server is unavailable');
  const downloaded = await rulesResponse.json();
  const cosmetics = await cosmeticResponse.json();
  if (!Array.isArray(downloaded) || !cosmetics || !Array.isArray(cosmetics.global)) throw new Error('Invalid filter update');
  const updatedRules = downloaded.slice(0, UPDATE_LIMIT).map((rule, index) => ({
    ...rule,
    id: UPDATE_START + index,
    priority: Math.max(1, Math.min(Number(rule.priority) || 1, 500))
  }));
  if (updatedRules.some((rule) => !rule.condition || !['block', 'allow'].includes(rule.action?.type))) throw new Error('Invalid network rules');
  await api.storage.local.set({ updatedRules, cosmeticOverride: cosmetics, lastUpdate: Date.now() });
  cosmeticCache = cosmetics;
  await reconcileRules();
  return updatedRules.length;
}

async function configureBadge() {
  try {
    await api.action.setBadgeBackgroundColor({ color: '#e34b4b' });
    if (api.declarativeNetRequest.setExtensionActionOptions) {
      await api.declarativeNetRequest.setExtensionActionOptions({ displayActionCountAsBadgeText: true });
    }
  } catch (error) {
    console.warn('Action-count badges are not supported by this browser:', error.message);
  }
}

api.runtime.onInstalled.addListener(async () => {
  const current = await api.storage.sync.get(Object.keys(DEFAULTS));
  const initial = {};
  for (const [key, value] of Object.entries(DEFAULTS)) if (current[key] === undefined) initial[key] = value;
  if (Object.keys(initial).length) await api.storage.sync.set(initial);
  await reconcileRules();
  await configureBadge();
  api.alarms.create('shieldad-weekly-update', { periodInMinutes: 10080 });
});
api.runtime.onStartup.addListener(() => { reconcileRules().catch(console.error); configureBadge(); });
api.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && Object.keys(DEFAULTS).some((key) => key in changes)) reconcileRules().catch(console.error);
});
api.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'shieldad-weekly-update') updateFilters().catch((error) => console.warn('Scheduled update failed:', error.message));
});

api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message?.type === 'GET_COSMETIC') {
      const value = await settings();
      const host = String(message.hostname || '').toLowerCase();
      if (!value.enabled || isListed(host, value.pausedSites) || isListed(host, value.allowlist)) return { selectors: [] };
      const list = await loadCosmetic();
      const exceptions = new Set();
      const selectors = new Set();
      for (const [domain, entries] of Object.entries(list.exceptions || {})) {
        if (hostMatches(host, domain)) for (const selector of entries) exceptions.add(selector);
      }
      for (const selector of list.global || []) if (!exceptions.has(selector)) selectors.add(selector);
      for (const [domain, entries] of Object.entries(list.domains || {})) {
        if (hostMatches(host, domain)) for (const selector of entries) if (!exceptions.has(selector)) selectors.add(selector);
      }
      return { selectors: [...selectors] };
    }
    if (message?.type === 'UPDATE_FILTERS') {
      const count = await updateFilters();
      return { ok: true, count, updatedAt: Date.now() };
    }
    if (message?.type === 'GET_SETTINGS') return { ok: true, settings: await settings() };
    return { ok: false, error: 'Unknown message' };
  })().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
