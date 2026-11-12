import { compileUserRules, normalizeDomainList } from './custom-rules.js';
import { hostMatches, isValidDnrRule } from './filter-parser.js';

const api = globalThis.chrome || globalThis.browser;
const DEFAULTS = { enabled: true, pausedSites: [], allowlist: [], customRules: '' };
const RAW_UPDATE_BASE = 'https://raw.githubusercontent.com/vikas-bhar/ads-blockker/main/shieldad/extension';
const API_UPDATE_BASE = 'https://api.github.com/repos/vikas-bhar/ads-blockker/contents/shieldad/extension';
const UPDATE_START = 600000;
const UPDATE_LIMIT = 3500;
const PAUSE_START = 300000;
const ALLOW_START = 400000;
const GLOBAL_OFF_ID = 999999;
const SYNC_CUSTOM_RULE_BYTE_LIMIT = 7000;
const MAX_DISABLED_STATIC_RULES = 4500;
const SCRIPTLET_ID = 'shieldad-scriptlets';
const YOUTUBE_EXCLUDE_MATCHES = [
  '*://youtube.com/*',
  '*://*.youtube.com/*',
  '*://youtube-nocookie.com/*',
  '*://*.youtube-nocookie.com/*',
  '*://youtubekids.com/*',
  '*://*.youtubekids.com/*',
  '*://youtu.be/*',
  '*://*.youtu.be/*'
];

let cosmeticCache;
let cosmeticIndex;
let staticCountCache;
let reconcileChain = Promise.resolve();

function hostFromSender(message, sender) {
  const direct = String(message?.hostname || '').trim().toLowerCase();
  if (direct) return direct;
  for (const candidate of [sender?.url, sender?.tab?.url]) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (/^https?:$/.test(url.protocol) && url.hostname) return url.hostname.toLowerCase();
    } catch {}
  }
  return '';
}

function declaredRulesets() {
  const resources = api.runtime.getManifest?.()?.declarative_net_request?.rule_resources;
  if (Array.isArray(resources) && resources.length) return resources.map((item) => item.id);
  return ['ads', 'domains'];
}

function isListed(host, list) {
  return normalizeDomainList(list).some((domain) => hostMatches(host, domain));
}

async function settings() {
  const [syncValue, localValue] = await Promise.all([
    api.storage.sync.get(DEFAULTS),
    api.storage.local.get({ customRulesOverflow: false, customRulesLocal: '' })
  ]);
  const customRules = localValue.customRulesOverflow && !syncValue.customRules
    ? String(localValue.customRulesLocal || '')
    : String(syncValue.customRules || '');
  return {
    enabled: syncValue.enabled !== false,
    pausedSites: normalizeDomainList(syncValue.pausedSites),
    allowlist: normalizeDomainList(syncValue.allowlist),
    customRules
  };
}

async function saveSettings(patch) {
  const syncPatch = {};
  const localPatch = {};
  if ('enabled' in patch) syncPatch.enabled = Boolean(patch.enabled);
  if ('pausedSites' in patch) syncPatch.pausedSites = normalizeDomainList(patch.pausedSites);
  if ('allowlist' in patch) syncPatch.allowlist = normalizeDomainList(patch.allowlist);
  if ('customRules' in patch) {
    const text = String(patch.customRules || '');
    const byteLength = new TextEncoder().encode(text).length;
    if (byteLength <= SYNC_CUSTOM_RULE_BYTE_LIMIT) {
      syncPatch.customRules = text;
      localPatch.customRulesOverflow = false;
      localPatch.customRulesLocal = '';
    } else {
      syncPatch.customRules = '';
      localPatch.customRulesOverflow = true;
      localPatch.customRulesLocal = text;
    }
  }
  if (Object.keys(localPatch).length) await api.storage.local.set(localPatch);
  if (Object.keys(syncPatch).length) await api.storage.sync.set(syncPatch);
}

function siteAllowRules(domains, startId, priority, includeAllowAll = true) {
  const rules = [];
  const stride = 3;
  normalizeDomainList(domains).slice(0, 100).forEach((domain, index) => {
    const baseId = startId + index * stride;
    rules.push({ id: baseId, priority, action: { type: 'allow' }, condition: { initiatorDomains: [domain] } });
    rules.push({ id: baseId + 1, priority, action: { type: 'allow' }, condition: { requestDomains: [domain] } });
    if (includeAllowAll) {
      rules.push({
        id: baseId + 2,
        priority,
        action: { type: 'allowAllRequests' },
        condition: { requestDomains: [domain], resourceTypes: ['main_frame', 'sub_frame'] }
      });
    }
  });
  return rules;
}

async function buildSystemRules(value, includeAllowAll = true) {
  const rules = [
    ...siteAllowRules(value.pausedSites, PAUSE_START, 5000, includeAllowAll),
    ...siteAllowRules(value.allowlist, ALLOW_START, 4500, includeAllowAll)
  ];
  const stored = await api.storage.local.get({ updatedRules: [] });
  if (Array.isArray(stored.updatedRules)) {
    rules.push(...stored.updatedRules.filter(isValidDnrRule).slice(0, UPDATE_LIMIT));
  }
  if (!value.enabled) {
    rules.push({
      id: GLOBAL_OFF_ID,
      priority: 10000,
      action: { type: 'allow' },
      condition: { urlFilter: '*' }
    });
  }
  return rules;
}

async function enableStaticRulesets(enabled) {
  const declared = declaredRulesets();
  const currentEnabled = await api.declarativeNetRequest.getEnabledRulesets().catch(() => []);
  if (!enabled) {
    if (currentEnabled.length) {
      await api.declarativeNetRequest.updateEnabledRulesets({
        enableRulesetIds: [],
        disableRulesetIds: currentEnabled
      });
    }
    return;
  }
  const missing = declared.filter((id) => !currentEnabled.includes(id));
  if (!missing.length) return;
  try {
    await api.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: missing,
      disableRulesetIds: []
    });
  } catch (error) {
    console.warn('Could not enable all static rulesets at once; applying within quota:', error.message);
    if (!currentEnabled.includes(declared[0])) {
      await api.declarativeNetRequest.updateEnabledRulesets({
        enableRulesetIds: declared.slice(0, 1),
        disableRulesetIds: currentEnabled.filter((id) => id !== declared[0])
      });
    }
    for (const id of declared.slice(1)) {
      if (currentEnabled.includes(id)) continue;
      try {
        await api.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: [id], disableRulesetIds: [] });
      } catch {
        break;
      }
    }
  }
}

function buildExcludeMatches(value) {
  const patterns = new Set(YOUTUBE_EXCLUDE_MATCHES);
  for (const domain of [...value.pausedSites, ...value.allowlist].slice(0, 100)) {
    patterns.add(`*://${domain}/*`);
    patterns.add(`*://*.${domain}/*`);
  }
  return [...patterns];
}

async function reconcileScriptlets(value) {
  if (!api.scripting?.registerContentScripts) return;
  try {
    if (!value.enabled) {
      await api.scripting.unregisterContentScripts({ ids: [SCRIPTLET_ID] }).catch(() => {});
      return;
    }
    const excludeMatches = buildExcludeMatches(value);
    const existing = await api.scripting.getRegisteredContentScripts?.({ ids: [SCRIPTLET_ID] }).catch(() => []);
    const desired = {
      id: SCRIPTLET_ID,
      matches: ['http://*/*', 'https://*/*'],
      excludeMatches,
      js: ['scriptlets-data.js', 'scriptlets.js'],
      runAt: 'document_start',
      allFrames: true,
      world: 'MAIN'
    };
    if (Array.isArray(existing) && existing.length) {
      const prev = existing[0];
      if (JSON.stringify(prev.excludeMatches || []) === JSON.stringify(excludeMatches)) return;
      await api.scripting.unregisterContentScripts({ ids: [SCRIPTLET_ID] }).catch(() => {});
    }
    await api.scripting.registerContentScripts([desired]);
  } catch (error) {
    console.warn('MAIN-world scriptlets unavailable:', error.message);
  }
}

async function configureBadge(enabled = true) {
  try {
    if (!enabled) {
      if (api.declarativeNetRequest.setExtensionActionOptions) {
        await api.declarativeNetRequest.setExtensionActionOptions({ displayActionCountAsBadgeText: false });
      }
      await api.action.setBadgeBackgroundColor({ color: '#6b7972' });
      await api.action.setBadgeText({ text: 'OFF' });
      return;
    }
    await api.action.setBadgeBackgroundColor({ color: '#e34b4b' });
    await api.action.setBadgeText({ text: '' });
    if (api.declarativeNetRequest.setExtensionActionOptions) {
      await api.declarativeNetRequest.setExtensionActionOptions({ displayActionCountAsBadgeText: true });
    }
  } catch (error) {
    console.warn('Action-count badges are not supported by this browser:', error.message);
  }
}

async function setCustomRulesError(message) {
  const current = await api.storage.local.get({ customRulesError: '' });
  if (current.customRulesError !== message) {
    await api.storage.local.set({ customRulesError: message });
  }
}

async function doReconcile() {
  const value = await settings();
  const compiled = compileUserRules(value.customRules);
  const existing = await api.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.map((rule) => rule.id);
  const systemRules = await buildSystemRules(value, true);
  const desiredWithCustom = [...compiled.networkRules, ...systemRules];

  const rulesEqual = (a, b) => a.length === b.length && JSON.stringify(a) === JSON.stringify(b);

  let appliedCustom = true;
  if (!rulesEqual(existing, desiredWithCustom)) {
    try {
      await api.declarativeNetRequest.updateDynamicRules({
        removeRuleIds,
        addRules: desiredWithCustom
      });
      await setCustomRulesError('');
    } catch (error) {
      appliedCustom = false;
      try {
        if (!rulesEqual(existing, systemRules)) {
          await api.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules: systemRules });
        }
        await setCustomRulesError(error.message || 'Custom rule rejected by browser');
      } catch {
        const fallbackSystem = await buildSystemRules(value, false);
        try {
          await api.declarativeNetRequest.updateDynamicRules({
            removeRuleIds,
            addRules: [...compiled.networkRules, ...fallbackSystem]
          });
          appliedCustom = true;
          await setCustomRulesError('');
        } catch (fallbackError) {
          await api.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules: fallbackSystem });
          await setCustomRulesError(fallbackError.message || 'Custom rule rejected by browser');
        }
      }
    }
  } else {
    await setCustomRulesError('');
  }

  await enableStaticRulesets(value.enabled);
  await reconcileScriptlets(value);
  await configureBadge(value.enabled);
  return { appliedCustom, compiled };
}

function reconcileRules() {
  const next = reconcileChain.then(() => doReconcile());
  reconcileChain = next.catch(() => {});
  return next;
}

function indexDomainMap(rawObj, exactMap, wildcardList) {
  for (const [domain, entries] of Object.entries(rawObj || {})) {
    if (!Array.isArray(entries) || !entries.length) continue;
    if (domain.endsWith('.*')) wildcardList.push({ pattern: domain, entries });
    else exactMap.set(domain, entries);
  }
}

function buildCosmeticIndex(list) {
  const index = {
    global: Array.isArray(list.global) ? list.global : [],
    exactDomains: new Map(),
    wildcardDomains: [],
    exactExceptions: new Map(),
    wildcardExceptions: [],
    exactStyles: new Map(),
    wildcardStyles: [],
    exactProcedural: new Map(),
    wildcardProcedural: [],
    generichideExact: new Set(),
    generichideWildcard: [],
    elemhideExact: new Set(),
    elemhideWildcard: []
  };

  indexDomainMap(list.domains, index.exactDomains, index.wildcardDomains);
  indexDomainMap(list.styles, index.exactStyles, index.wildcardStyles);
  indexDomainMap(list.procedural, index.exactProcedural, index.wildcardProcedural);

  for (const [domain, entries] of Object.entries(list.exceptions || {})) {
    if (!Array.isArray(entries) || !entries.length) continue;
    const set = new Set(entries);
    if (domain.endsWith('.*')) index.wildcardExceptions.push({ pattern: domain, entries: set });
    else index.exactExceptions.set(domain, set);
  }
  for (const domain of list.generichide || []) {
    if (domain.endsWith('.*')) index.generichideWildcard.push(domain);
    else index.generichideExact.add(domain);
  }
  for (const domain of list.elemhide || []) {
    if (domain.endsWith('.*')) index.elemhideWildcard.push(domain);
    else index.elemhideExact.add(domain);
  }
  return index;
}

function domainChain(host) {
  const parts = [];
  let current = host;
  while (current) {
    parts.push(current);
    const dot = current.indexOf('.');
    if (dot < 0) break;
    current = current.slice(dot + 1);
  }
  return parts;
}

async function loadCosmeticIndex() {
  if (cosmeticIndex) return cosmeticIndex;
  const stored = await api.storage.local.get(['cosmeticOverride']);
  if (stored.cosmeticOverride) {
    cosmeticCache = stored.cosmeticOverride;
  } else if (!cosmeticCache) {
    cosmeticCache = await fetch(api.runtime.getURL('cosmetic.json')).then((response) => {
      if (!response.ok) throw new Error(`Cosmetic list HTTP ${response.status}`);
      return response.json();
    });
  }
  cosmeticIndex = buildCosmeticIndex(cosmeticCache);
  return cosmeticIndex;
}

function listMatchesHost(host, chain, exactSet, wildcardList) {
  for (const domain of chain) if (exactSet.has(domain)) return true;
  return wildcardList.some((pattern) => hostMatches(host, pattern));
}

function collectMappedEntries(host, chain, exactMap, wildcardList) {
  const out = [];
  for (const domain of chain) {
    const entries = exactMap.get(domain);
    if (entries) out.push(...entries);
  }
  for (const item of wildcardList) {
    if (hostMatches(host, item.pattern)) out.push(...item.entries);
  }
  return out;
}

async function selectorsForHost(hostname, customRulesText) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  const index = await loadCosmeticIndex();
  const chain = domainChain(host);
  const custom = customRulesText ? compileUserRules(customRulesText).cosmetic : null;

  if (listMatchesHost(host, chain, index.elemhideExact, index.elemhideWildcard)) {
    return { selectors: [], styles: [], procedural: [] };
  }
  if (custom?.elemhide?.some((pattern) => hostMatches(host, pattern))) {
    return { selectors: [], styles: [], procedural: [] };
  }

  const generichide = listMatchesHost(host, chain, index.generichideExact, index.generichideWildcard) ||
    Boolean(custom?.generichide?.some((pattern) => hostMatches(host, pattern)));

  const exceptions = new Set();
  for (const domain of chain) {
    const entries = index.exactExceptions.get(domain);
    if (entries) for (const selector of entries) exceptions.add(selector);
  }
  for (const item of index.wildcardExceptions) {
    if (hostMatches(host, item.pattern)) for (const selector of item.entries) exceptions.add(selector);
  }
  if (custom?.exceptions) {
    for (const [domain, entries] of Object.entries(custom.exceptions)) {
      if (hostMatches(host, domain)) for (const selector of entries) exceptions.add(selector);
    }
  }

  const domainSelectors = collectMappedEntries(host, chain, index.exactDomains, index.wildcardDomains);
  if (custom?.domains) {
    for (const [domain, entries] of Object.entries(custom.domains)) {
      if (hostMatches(host, domain)) domainSelectors.push(...entries);
    }
  }

  const styles = collectMappedEntries(host, chain, index.exactStyles, index.wildcardStyles);
  if (custom?.styles) {
    for (const [domain, entries] of Object.entries(custom.styles)) {
      if (hostMatches(host, domain)) styles.push(...entries);
    }
  }

  const procedural = collectMappedEntries(host, chain, index.exactProcedural, index.wildcardProcedural);
  if (custom?.procedural) {
    for (const [domain, entries] of Object.entries(custom.procedural)) {
      if (hostMatches(host, domain)) procedural.push(...entries);
    }
  }

  const customGlobal = custom?.global || [];
  let selectors;
  if (!exceptions.size && !domainSelectors.length && !customGlobal.length) {
    selectors = generichide ? [] : index.global;
  } else {
    const set = new Set();
    if (!generichide) {
      for (const selector of index.global) if (!exceptions.has(selector)) set.add(selector);
      for (const selector of customGlobal) if (!exceptions.has(selector)) set.add(selector);
    }
    for (const selector of domainSelectors) if (!exceptions.has(selector)) set.add(selector);
    selectors = [...set];
  }

  return { selectors, styles, procedural };
}

async function fetchJsonWithFallback(relativePath, optional = false) {
  const attempts = [
    { url: `${RAW_UPDATE_BASE}/${relativePath}`, headers: {} },
    { url: `${API_UPDATE_BASE}/${relativePath}?ref=main`, headers: { Accept: 'application/vnd.github.raw+json' } }
  ];
  let saw404 = false;
  let lastError;
  for (const attempt of attempts) {
    try {
      const response = await fetch(attempt.url, { cache: 'no-store', headers: attempt.headers, signal: AbortSignal.timeout(30000) });
      if (response.status === 404) {
        saw404 = true;
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }
  if (optional && saw404) return null;
  throw lastError || new Error(`Unable to fetch ${relativePath}`);
}

async function readBundledRuleset(id) {
  try {
    const response = await fetch(api.runtime.getURL(`rulesets/${id}.json`));
    if (!response.ok) return [];
    const parsed = await response.json();
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function ruleSignature(rule) {
  return JSON.stringify([rule.action, rule.condition, rule.priority]);
}

async function updateFilters() {
  const declared = declaredRulesets();
  const cosmeticsPromise = fetchJsonWithFallback('cosmetic.json', false);
  const rulesetPromises = declared.map(async (id) => {
    const optional = id !== 'ads' && id !== 'domains';
    const data = await fetchJsonWithFallback(`rulesets/${id}.json`, optional);
    return [id, Array.isArray(data) ? data : null];
  });

  const [cosmetics, ...rulesetEntries] = await Promise.all([cosmeticsPromise, ...rulesetPromises]);
  const remoteByRuleset = Object.fromEntries(rulesetEntries);

  if (!cosmetics || !Array.isArray(cosmetics.global) || !Array.isArray(remoteByRuleset.ads) || !Array.isArray(remoteByRuleset.domains)) {
    throw new Error('Invalid filter update');
  }

  const bundledByRuleset = {};
  await Promise.all(declared.map(async (id) => {
    bundledByRuleset[id] = await readBundledRuleset(id);
  }));

  const bundledSignatures = new Set();
  for (const rules of Object.values(bundledByRuleset)) {
    for (const rule of rules) bundledSignatures.add(ruleSignature(rule));
  }

  const remoteSignatures = new Set();
  const novelAllow = [];
  const novelUrlOrConditional = [];
  const novelDomain = [];
  const seenNovel = new Set();

  for (const rules of Object.values(remoteByRuleset)) {
    if (!Array.isArray(rules)) continue;
    for (const rule of rules) {
      if (!rule?.condition || !['block', 'allow', 'redirect', 'modifyHeaders'].includes(rule.action?.type)) continue;
      const sig = ruleSignature(rule);
      remoteSignatures.add(sig);
      if (bundledSignatures.has(sig) || seenNovel.has(sig)) continue;
      seenNovel.add(sig);
      if (rule.action.type === 'allow') novelAllow.push(rule);
      else if (rule.condition.urlFilter || rule.condition.regexFilter || rule.condition.domainType || rule.condition.resourceTypes || rule.condition.initiatorDomains) {
        novelUrlOrConditional.push(rule);
      } else {
        novelDomain.push(rule);
      }
    }
  }

  const orderedNovel = [...novelAllow, ...novelUrlOrConditional, ...novelDomain];
  const updatedRules = [];
  for (const rule of orderedNovel) {
    if (updatedRules.length >= UPDATE_LIMIT) break;
    const candidate = {
      ...rule,
      id: UPDATE_START + updatedRules.length,
      priority: Math.max(1, Math.min(Number(rule.priority) || 1, 500))
    };
    if (isValidDnrRule(candidate)) updatedRules.push(candidate);
  }

  let disabledStaticCount = 0;
  if (api.declarativeNetRequest.updateStaticRules && api.declarativeNetRequest.getDisabledRuleIds) {
    let remainingDisableBudget = MAX_DISABLED_STATIC_RULES;
    for (const id of declared) {
      if (!remoteByRuleset[id]) continue;
      const localRules = bundledByRuleset[id] || [];
      if (!localRules.length) continue;
      try {
        const currentlyDisabled = new Set(await api.declarativeNetRequest.getDisabledRuleIds({ rulesetId: id }));
        const disableRuleIds = [];
        const enableRuleIds = [];
        for (const rule of localRules) {
          const presentRemotely = remoteSignatures.has(ruleSignature(rule));
          if (!presentRemotely && !currentlyDisabled.has(rule.id) && remainingDisableBudget > 0) {
            disableRuleIds.push(rule.id);
            remainingDisableBudget -= 1;
          } else if (presentRemotely && currentlyDisabled.has(rule.id)) {
            enableRuleIds.push(rule.id);
          }
        }
        if (disableRuleIds.length || enableRuleIds.length) {
          await api.declarativeNetRequest.updateStaticRules({ rulesetId: id, disableRuleIds, enableRuleIds });
        }
        disabledStaticCount += currentlyDisabled.size + disableRuleIds.length - enableRuleIds.length;
      } catch (error) {
        console.warn(`Could not diff static ruleset ${id}:`, error.message);
      }
    }
  }

  const updatedAt = Date.now();
  const remoteRuleCount = Object.values(remoteByRuleset)
    .filter(Array.isArray)
    .reduce((sum, list) => sum + list.length, 0);

  await api.storage.local.set({
    updatedRules,
    cosmeticOverride: cosmetics,
    lastUpdate: updatedAt,
    updateStats: {
      addedCount: updatedRules.length,
      disabledStaticCount,
      remoteRuleCount,
      cosmeticCount: cosmetics.global.length
    }
  });
  cosmeticCache = cosmetics;
  cosmeticIndex = null;
  await reconcileRules();
  return {
    count: updatedRules.length,
    disabledStaticCount,
    remoteRuleCount,
    cosmeticCount: cosmetics.global.length,
    updatedAt
  };
}

async function loadStaticRuleCounts() {
  if (staticCountCache) return staticCountCache;
  const declared = declaredRulesets();
  const entries = await Promise.all(declared.map(async (id) => {
    const list = await readBundledRuleset(id);
    return [id, list.length];
  }));
  staticCountCache = Object.fromEntries(entries);
  return staticCountCache;
}

async function getStatus() {
  const [value, counts, enabledRulesets, dynamicRules, localData, cosmetic] = await Promise.all([
    settings(),
    loadStaticRuleCounts(),
    api.declarativeNetRequest.getEnabledRulesets(),
    api.declarativeNetRequest.getDynamicRules(),
    api.storage.local.get({ lastUpdate: 0, customRulesError: '', updateStats: null }),
    loadCosmeticIndex()
  ]);
  const activeStaticRules = enabledRulesets.reduce((sum, id) => sum + (counts[id] || 0), 0);
  const compiled = compileUserRules(value.customRules);
  return {
    enabled: value.enabled,
    enabledRulesets,
    activeStaticRules,
    dynamicRuleCount: dynamicRules.length,
    totalActiveRules: activeStaticRules + dynamicRules.length,
    cosmeticGlobalCount: cosmetic.global.length,
    cosmeticDomainCount: cosmetic.exactDomains.size + cosmetic.wildcardDomains.length,
    cosmeticProceduralCount: cosmetic.exactProcedural.size + cosmetic.wildcardProcedural.length,
    customNetworkCount: compiled.networkRules.length,
    customCosmeticCount: compiled.cosmetic.global.length
      + Object.values(compiled.cosmetic.domains).reduce((a, b) => a + b.length, 0)
      + Object.values(compiled.cosmetic.styles || {}).reduce((a, b) => a + b.length, 0)
      + Object.values(compiled.cosmetic.procedural || {}).reduce((a, b) => a + b.length, 0),
    customInvalidCount: compiled.invalidLines.length,
    customRulesError: localData.customRulesError || '',
    lastUpdate: localData.lastUpdate || 0,
    updateStats: localData.updateStats || null
  };
}

function isPauseOrAllowMatchedRule(info) {
  const id = info?.rule?.ruleId;
  if (info?.rule?.rulesetId !== '_dynamic') return false;
  return id === GLOBAL_OFF_ID || (id >= PAUSE_START && id < ALLOW_START + 1000);
}

async function getTabStats(tabId) {
  const value = await settings();
  if (!value.enabled) return { blockedCount: 0 };
  if (tabId && api.tabs?.get) {
    try {
      const tab = await api.tabs.get(tabId);
      const host = hostFromSender(null, { url: tab?.url });
      if (host && (isListed(host, value.pausedSites) || isListed(host, value.allowlist))) {
        return { blockedCount: 0 };
      }
    } catch {}
  }

  let badgeCount = 0;
  if (tabId) {
    try {
      const badge = await api.action.getBadgeText({ tabId });
      if (/^\d+$/.test(String(badge || '').trim())) badgeCount = Number(badge);
    } catch {}
    if (api.declarativeNetRequest.getMatchedRules) {
      try {
        const matched = await api.declarativeNetRequest.getMatchedRules({ tabId });
        const count = (matched?.rulesMatchedInfo || []).filter((info) => !isPauseOrAllowMatchedRule(info)).length;
        return { blockedCount: Math.max(badgeCount, count) };
      } catch {}
    }
  }
  return { blockedCount: badgeCount };
}

api.runtime.onInstalled.addListener(async () => {
  const current = await api.storage.sync.get(Object.keys(DEFAULTS));
  const initial = {};
  for (const [key, value] of Object.entries(DEFAULTS)) if (current[key] === undefined) initial[key] = value;
  if (Object.keys(initial).length) await api.storage.sync.set(initial);
  await reconcileRules();
  api.alarms.create('shieldad-weekly-update', { periodInMinutes: 10080 });
});

api.runtime.onStartup.addListener(() => {
  reconcileRules().catch(console.error);
});

api.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'cosmeticOverride' in changes) {
    cosmeticCache = changes.cosmeticOverride.newValue || null;
    cosmeticIndex = null;
  }
  if (area === 'sync' && Object.keys(DEFAULTS).some((key) => key in changes)) {
    if (changes.customRules?.newValue) {
      api.storage.local.set({ customRulesOverflow: false, customRulesLocal: '' }).catch(() => {});
    }
    reconcileRules().catch(console.error);
  }
  if (area === 'local' && ('customRulesLocal' in changes || 'customRulesOverflow' in changes)) {
    reconcileRules().catch(console.error);
  }
});

api.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'shieldad-weekly-update') {
    updateFilters().catch((error) => console.warn('Scheduled update failed:', error.message));
  }
});

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === 'GET_COSMETIC') {
      const value = await settings();
      const host = hostFromSender(message, sender);
      if (!value.enabled || isListed(host, value.pausedSites) || isListed(host, value.allowlist)) {
        return { selectors: [], styles: [], procedural: [], active: false };
      }
      const res = await selectorsForHost(host, value.customRules);
      return { ...res, active: true };
    }
    if (message?.type === 'UPDATE_FILTERS') {
      const result = await updateFilters();
      return { ok: true, ...result };
    }
    if (message?.type === 'GET_SETTINGS') {
      return { ok: true, settings: await settings() };
    }
    if (message?.type === 'APPLY_SETTINGS') {
      await saveSettings(message.patch || {});
      const reconcileResult = await reconcileRules();
      return {
        ok: true,
        settings: await settings(),
        status: await getStatus(),
        appliedCustom: reconcileResult.appliedCustom
      };
    }
    if (message?.type === 'GET_STATUS') {
      return { ok: true, status: await getStatus() };
    }
    if (message?.type === 'GET_TAB_STATS') {
      return { ok: true, ...(await getTabStats(message.tabId)) };
    }
    return { ok: false, error: 'Unknown message' };
  })().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
