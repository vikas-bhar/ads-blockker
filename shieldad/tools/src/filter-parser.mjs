const RESOURCE_OPTIONS = Object.freeze({
  script: 'script',
  image: 'image',
  stylesheet: 'stylesheet',
  font: 'font',
  media: 'media',
  object: 'object',
  subdocument: 'sub_frame',
  document: 'main_frame',
  xmlhttprequest: 'xmlhttprequest',
  websocket: 'websocket',
  ping: 'ping',
  other: 'other'
});

const DNR_RESOURCE_TYPES = new Set([
  'main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font',
  'object', 'xmlhttprequest', 'ping', 'csp_report', 'media',
  'websocket', 'webtransport', 'webbundle', 'other'
]);

const UNSUPPORTED_OPTIONS = new Set([
  'badfilter', 'match-case', 'elemhide', 'generichide', 'genericblock',
  'popup', 'popunder', 'removeparam', 'cookie', 'header'
]);

const PROCEDURAL_SELECTOR = /:(?:has-text|matches-css|matches-path|xpath|upward|remove|style|min-text-length|watch-attr)\b|:-abp-/i;

export function isIpv4(value) {
  if (typeof value !== 'string') return false;
  return /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(value);
}

function validDomain(domain) {
  if (!domain || domain.length > 253 || !/^[a-z0-9._-]+$/i.test(domain)) return false;
  const labels = domain.replace(/^\*\./, '').split('.');
  return labels.every((label) => label.length > 0 && label.length <= 63 && !label.startsWith('-') && !label.endsWith('-'));
}

function validHostDomain(domain) {
  return validDomain(domain) && domain.includes('.') && !isIpv4(domain) && !/\.\d+$/.test(domain);
}

function validCosmeticDomain(domain) {
  if (!domain || domain.length > 253) return false;
  if (validHostDomain(domain)) return true;
  return /^(?:[a-z0-9-]+\.)+\*$/i.test(domain);
}

export function normalizeDomainEntry(input) {
  let value = String(input || '').trim().toLowerCase();
  if (!value) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    try {
      value = new URL(value).hostname.toLowerCase();
    } catch {
      return null;
    }
  }
  value = value.replace(/^\*\./, '').replace(/\.$/, '');
  return validHostDomain(value) ? value : null;
}

export function hostMatches(host, pattern) {
  const cleanHost = String(host || '').trim().toLowerCase().replace(/\.$/, '');
  const cleanPattern = String(pattern || '').trim().toLowerCase().replace(/\.$/, '');
  if (!cleanHost || !cleanPattern) return false;
  if (cleanPattern.endsWith('.*')) {
    const base = cleanPattern.slice(0, -2);
    if (!base) return false;
    const suffixes = [];
    if (cleanHost.startsWith(`${base}.`)) suffixes.push(cleanHost.slice(base.length + 1));
    let from = 0;
    const marker = `.${base}.`;
    while (true) {
      const idx = cleanHost.indexOf(marker, from);
      if (idx < 0) break;
      suffixes.push(cleanHost.slice(idx + marker.length));
      from = idx + 1;
    }
    return suffixes.some((rest) => /^(?:[a-z]{2,24}|(?:co|com|org|net|gov|edu|ac)\.[a-z]{2})$/.test(rest));
  }
  return cleanHost === cleanPattern || cleanHost.endsWith(`.${cleanPattern}`);
}

function splitOptions(filter) {
  const separator = filter.lastIndexOf('$');
  if (separator < 0) return [filter, []];
  return [
    filter.slice(0, separator),
    filter.slice(separator + 1).split(',').map((item) => item.trim().toLowerCase()).filter(Boolean)
  ];
}

function extractDomainOption(value) {
  const included = [];
  const excluded = [];
  for (let entry of value.split('|')) {
    const exclude = entry.startsWith('~');
    if (exclude) entry = entry.slice(1);
    entry = entry.toLowerCase();
    if (!validDomain(entry)) return null;
    (exclude ? excluded : included).push(entry);
  }
  return { included, excluded };
}

/** Parse one Adblock Plus network filter into a declarativeNetRequest-compatible shape. */
export function parseNetworkFilter(input, priorities = {}) {
  if (typeof input !== 'string') return null;
  const original = input.trim();
  if (!original || original.startsWith('!') || original.startsWith('[') || original.includes('##') || original.includes('#@#') || original.includes('#?#')) return null;

  const exception = original.startsWith('@@');
  let filter = exception ? original.slice(2) : original;
  if (!filter || /[^\x20-\x7e]/.test(filter)) return null;
  let options;
  [filter, options] = splitOptions(filter);
  if (filter && filter.startsWith('/') && filter.endsWith('/')) return null;

  const condition = {};
  const resourceTypes = [];
  const excludedResourceTypes = [];
  let important = false;
  let thirdParty;

  for (let option of options) {
    if (!option) continue;
    if (option === 'important') { important = true; continue; }
    if (option.startsWith('redirect') || option.startsWith('csp') || option.startsWith('rewrite')) return null;
    const negated = option.startsWith('~');
    if (negated) option = option.slice(1);
    const valueIndex = option.indexOf('=');
    const name = valueIndex >= 0 ? option.slice(0, valueIndex) : option;
    const value = valueIndex >= 0 ? option.slice(valueIndex + 1) : '';
    if (UNSUPPORTED_OPTIONS.has(name)) return null;

    if (name === 'third-party') {
      thirdParty = negated ? 'firstParty' : 'thirdParty';
      continue;
    }
    if (name === 'all' && !negated) continue;
    if (name === 'domain') {
      if (!value || negated) return null;
      const parsedDomains = extractDomainOption(value);
      if (!parsedDomains) return null;
      if (parsedDomains.included.length) condition.initiatorDomains = [...new Set(parsedDomains.included)];
      if (parsedDomains.excluded.length) condition.excludedInitiatorDomains = [...new Set(parsedDomains.excluded)];
      continue;
    }
    if (RESOURCE_OPTIONS[name]) {
      (negated ? excludedResourceTypes : resourceTypes).push(RESOURCE_OPTIONS[name]);
      continue;
    }
    // Unknown modifier options change ABP semantics; dropping the rule is safer than over-blocking.
    if (valueIndex >= 0 || !['1p', '3p', 'first-party'].includes(name)) return null;
    if (name === '1p' || name === 'first-party') thirdParty = negated ? 'thirdParty' : 'firstParty';
    if (name === '3p') thirdParty = negated ? 'firstParty' : 'thirdParty';
  }

  if (thirdParty) condition.domainType = thirdParty;
  if (resourceTypes.length && excludedResourceTypes.length) return null;
  if (resourceTypes.length) condition.resourceTypes = [...new Set(resourceTypes)];
  if (excludedResourceTypes.length) condition.excludedResourceTypes = [...new Set(excludedResourceTypes)];

  const domainMatch = filter.match(/^\|\|((?:\*\.)?(?:[a-z0-9-]+\.)+[a-z0-9-]+)\^$/i);
  let domainOnly = false;
  if (domainMatch && validHostDomain(domainMatch[1])) {
    condition.requestDomains = [domainMatch[1].replace(/^\*\./, '').toLowerCase()];
    domainOnly = true;
  } else if (!filter) {
    // Empty URL patterns are only safe when explicitly scoped to initiator or request domains.
    if (!condition.initiatorDomains?.length && !condition.requestDomains?.length) return null;
  } else {
    if (filter.includes('##') || filter.includes('#@#') || /[\r\n\0]/.test(filter)) return null;
    if (filter === '*' || filter === '||' || filter === '|') return null;
    condition.urlFilter = filter;
  }

  const blockPriority = priorities.blockPriority ?? 1;
  const importantBlockPriority = priorities.importantBlockPriority ?? 200;
  const allowPriority = priorities.allowPriority ?? 100;
  const importantAllowPriority = priorities.importantAllowPriority ?? 400;

  return {
    exception,
    domainOnly,
    action: { type: exception ? 'allow' : 'block' },
    priority: exception ? (important ? importantAllowPriority : allowPriority) : (important ? importantBlockPriority : blockPriority),
    condition
  };
}

/** Parse @@...$generichide and @@...$elemhide cosmetic control rules. */
export function parseCosmeticControlFilter(input) {
  if (typeof input !== 'string') return null;
  const original = input.trim();
  if (!original.startsWith('@@')) return null;
  const [rawFilter, options] = splitOptions(original.slice(2));
  if (!options.length) return null;
  let type = null;
  const domains = [];
  for (const option of options) {
    if (option === 'generichide' || option === 'elemhide') {
      type = option;
    } else if (option.startsWith('domain=')) {
      const value = option.slice('domain='.length);
      for (const entry of value.split('|')) {
        if (!entry || entry.startsWith('~')) continue;
        const clean = entry.toLowerCase().replace(/^\*\./, '').replace(/\.$/, '');
        if (validCosmeticDomain(clean)) domains.push(clean);
      }
    } else if (!['document', 'third-party', '~third-party', '1p', '3p', 'first-party', '~first-party'].includes(option)) {
      return null;
    }
  }
  if (!type) return null;
  if (rawFilter) {
    const cleanPattern = rawFilter.replace(/^\|\|/, '').replace(/^https?:\/\//i, '').replace(/[\^/*]+$/, '').toLowerCase();
    if (validCosmeticDomain(cleanPattern)) domains.push(cleanPattern);
    else if (/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.$/i.test(cleanPattern)) domains.push(`${cleanPattern}*`);
  }
  return domains.length ? { type, domains: [...new Set(domains)] } : null;
}

/** Parse global, domain-specific, and exception cosmetic filters. */
export function parseCosmeticFilter(input) {
  if (typeof input !== 'string') return null;
  const line = input.trim();
  const exceptionIndex = line.indexOf('#@#');
  const normalIndex = line.indexOf('##');
  const index = exceptionIndex >= 0 ? exceptionIndex : normalIndex;
  if (index < 0) return null;
  const markerLength = exceptionIndex >= 0 ? 3 : 2;
  const selector = line.slice(index + markerLength).trim();
  if (!selector || selector.length > 1000 || selector.startsWith('+js') || PROCEDURAL_SELECTOR.test(selector) || /[{}<\0\r\n]/.test(selector)) return null;
  const domainPart = line.slice(0, index).trim();
  const domains = [];
  const excludedDomains = [];
  if (domainPart) {
    for (let domain of domainPart.split(',')) {
      domain = domain.trim().toLowerCase();
      if (!domain) continue;
      const excluded = domain.startsWith('~');
      if (excluded) domain = domain.slice(1);
      if (!validCosmeticDomain(domain)) {
        if (excluded) return null;
        continue;
      }
      (excluded ? excludedDomains : domains).push(domain);
    }
    if (!domains.length && !excludedDomains.length) return null;
  }
  return { exception: exceptionIndex >= 0, selector, domains, excludedDomains };
}

export function parseHostsLine(input) {
  if (typeof input !== 'string') return null;
  const line = input.split('#')[0].trim();
  if (!line) return null;
  const parts = line.split(/\s+/);
  let domain;
  if (parts.length >= 2 && /^(0\.0\.0\.0|127\.0\.0\.1|::|::1)$/.test(parts[0])) domain = parts[1];
  else if (parts.length === 1 && parts[0].includes('.')) domain = parts[0];
  else return null;
  domain = domain.toLowerCase().replace(/\.$/, '');
  if (['localhost', 'localhost.localdomain', 'local', 'broadcasthost', 'ip6-localhost', 'ip6-loopback'].includes(domain)) return null;
  return validHostDomain(domain) ? domain : null;
}

export function isValidDnrRule(rule) {
  if (!rule || typeof rule !== 'object') return false;
  if (!Number.isInteger(rule.id) || rule.id < 1) return false;
  if (!Number.isInteger(rule.priority) || rule.priority < 1) return false;
  if (!['block', 'allow', 'allowAllRequests', 'upgradeScheme'].includes(rule.action?.type)) return false;
  const cond = rule.condition;
  if (!cond || typeof cond !== 'object') return false;
  if (cond.urlFilter !== undefined) {
    if (typeof cond.urlFilter !== 'string' || !cond.urlFilter.length || /[^\x20-\x7e]/.test(cond.urlFilter)) return false;
  }
  for (const key of ['requestDomains', 'excludedRequestDomains', 'initiatorDomains', 'excludedInitiatorDomains']) {
    if (cond[key] !== undefined) {
      if (!Array.isArray(cond[key]) || !cond[key].length || cond[key].some((d) => !validDomain(d))) return false;
    }
  }
  for (const key of ['resourceTypes', 'excludedResourceTypes']) {
    if (cond[key] !== undefined) {
      if (!Array.isArray(cond[key]) || !cond[key].length || cond[key].some((t) => !DNR_RESOURCE_TYPES.has(t))) return false;
    }
  }
  if (rule.action.type === 'allowAllRequests') {
    if (!cond.resourceTypes?.length || cond.resourceTypes.some((t) => t !== 'main_frame' && t !== 'sub_frame')) return false;
  }
  return Boolean(
    cond.urlFilter || cond.requestDomains?.length || cond.initiatorDomains?.length ||
    cond.excludedInitiatorDomains?.length || cond.resourceTypes?.length || cond.domainType
  );
}

export function compileNetworkRules(lines, { limit = 29000, ...priorities } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 29999) throw new Error('Rule limit must be between 1 and 29,999');
  const candidates = [];
  const seen = new Set();
  for (const line of lines) {
    const parsed = parseNetworkFilter(line, priorities);
    if (!parsed) continue;
    const signature = JSON.stringify([parsed.action, parsed.condition, parsed.priority]);
    if (seen.has(signature)) continue;
    seen.add(signature);
    candidates.push(parsed);
  }
  // Keep every possible exception, prioritize domain rules, and reserve a quarter
  // of the remaining budget for path/wildcard rules that domains cannot replace.
  const exceptions = candidates.filter((rule) => rule.exception);
  const domains = candidates.filter((rule) => !rule.exception && rule.domainOnly);
  const urls = candidates.filter((rule) => !rule.exception && !rule.domainOnly);
  const selected = exceptions.slice(0, limit);
  let remaining = limit - selected.length;
  const urlBudget = Math.min(urls.length, Math.floor(remaining / 4));
  const domainBudget = remaining - urlBudget;
  selected.push(...domains.splice(0, domainBudget), ...urls.splice(0, urlBudget));
  remaining = limit - selected.length;
  selected.push(...[...domains, ...urls].slice(0, remaining));
  return selected.map(({ exception, domainOnly, ...rule }, index) => ({ id: index + 1, ...rule }));
}

function hasAncestor(domain, set, includeSelf = true) {
  let current = includeSelf ? domain : (() => {
    const dot = domain.indexOf('.');
    return dot < 0 ? '' : domain.slice(dot + 1);
  })();
  while (current) {
    if (set.has(current)) return true;
    const dot = current.indexOf('.');
    if (dot < 0) return false;
    current = current.slice(dot + 1);
  }
  return false;
}

export function foldDomains(domains, coveredDomains = []) {
  const covered = new Set(coveredDomains.map((domain) => String(domain).toLowerCase()));
  const candidateSet = new Set();
  const ordered = [];
  for (const entry of domains) {
    const domain = String(entry).trim().toLowerCase().replace(/\.$/, '');
    if (!validHostDomain(domain) || candidateSet.has(domain) || hasAncestor(domain, covered, true)) continue;
    candidateSet.add(domain);
    ordered.push(domain);
  }
  // Filter out subdomains whose parent domain is also present regardless of input order.
  return ordered.filter((domain) => !hasAncestor(domain, candidateSet, false));
}

/** Compile a memory-efficient domain ruleset, skipping domains already covered by a parent. */
export function compileDomainRules(domains, { limit = 29000, coveredDomains = [] } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 29999) throw new Error('Rule limit must be between 1 and 29,999');
  return foldDomains(domains, coveredDomains)
    .slice(0, limit)
    .map((domain, index) => ({ id: index + 1, priority: 1, action: { type: 'block' }, condition: { requestDomains: [domain] } }));
}

/** Partition folded domains across multiple <= 29,999-rule static ruleset chunks. */
export function compileDomainRuleChunks(domains, { chunkSize = 29000, maxChunks = 10, coveredDomains = [] } = {}) {
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > 29999) throw new Error('Chunk size must be between 1 and 29,999');
  const folded = foldDomains(domains, coveredDomains);
  const chunks = [];
  for (let offset = 0; offset < folded.length && chunks.length < maxChunks; offset += chunkSize) {
    const slice = folded.slice(offset, offset + chunkSize);
    chunks.push(slice.map((domain, index) => ({
      id: index + 1,
      priority: 1,
      action: { type: 'block' },
      condition: { requestDomains: [domain] }
    })));
  }
  return chunks;
}

/**
 * Compile high-priority rules (exceptions, URL patterns, conditional rules, and top root
 * domains) into the guaranteed-minimum core ruleset (`ads`), then spill all remaining folded
 * domains across additional <= 29,000-rule rulesets so zero upstream coverage is truncated.
 */
export function compileStaticRulesets({
  priorityNetworkLines = [],
  adserverLines = [],
  hostsDomains = [],
  perRulesetLimit = 29000,
  maxDomainChunks = 3
} = {}) {
  if (!Number.isInteger(perRulesetLimit) || perRulesetLimit < 1 || perRulesetLimit > 29999) {
    throw new Error('Ruleset limit must be between 1 and 29,999');
  }
  const seen = new Set();
  const exceptions = [];
  const urlRules = [];
  const conditionalDomains = [];
  const priorityUncond = [];
  const adserverUncond = [];

  const isUnconditionalDomain = (rule) => (
    !rule.exception &&
    rule.domainOnly &&
    !rule.condition.domainType &&
    !rule.condition.resourceTypes &&
    !rule.condition.excludedResourceTypes &&
    !rule.condition.initiatorDomains &&
    !rule.condition.excludedInitiatorDomains
  );

  const ingest = (lines, uncondTarget) => {
    for (const line of lines) {
      const parsed = parseNetworkFilter(line);
      if (!parsed) continue;
      const signature = JSON.stringify([parsed.action, parsed.condition, parsed.priority]);
      if (seen.has(signature)) continue;
      seen.add(signature);
      if (parsed.exception) exceptions.push(parsed);
      else if (!parsed.domainOnly) urlRules.push(parsed);
      else if (!isUnconditionalDomain(parsed)) conditionalDomains.push(parsed);
      else uncondTarget.push(parsed.condition.requestDomains[0]);
    }
  };

  ingest(priorityNetworkLines, priorityUncond);
  ingest(adserverLines, adserverUncond);

  // Order bulk adserver domains by root-level depth and brevity first so major ad networks
  // land in the core guaranteed ruleset instead of cutting off alphabetically at "L".
  const rankedAdservers = [...new Set(adserverUncond)].sort((a, b) => (
    a.split('.').length - b.split('.').length ||
    a.length - b.length ||
    a.localeCompare(b)
  ));

  const foldedDomains = foldDomains([...priorityUncond, ...rankedAdservers, ...hostsDomains]);
  const coreNonDomain = [...exceptions, ...conditionalDomains, ...urlRules];
  const coreSelected = coreNonDomain.slice(0, perRulesetLimit);
  const coreDomainBudget = Math.max(0, perRulesetLimit - coreSelected.length);
  const coreDomains = foldedDomains.slice(0, coreDomainBudget).map((domain) => ({
    action: { type: 'block' },
    priority: 1,
    condition: { requestDomains: [domain] }
  }));

  const ads = [...coreSelected.map(({ exception, domainOnly, ...rule }) => rule), ...coreDomains]
    .map((rule, index) => ({ id: index + 1, ...rule }));

  const remainingDomains = foldedDomains.slice(coreDomainBudget);
  const domainChunks = compileDomainRuleChunks(remainingDomains, {
    chunkSize: perRulesetLimit,
    maxChunks: maxDomainChunks
  });

  return {
    ads,
    domainChunks,
    stats: {
      exceptions: exceptions.length,
      conditionalDomains: conditionalDomains.length,
      urlRules: urlRules.length,
      totalFoldedDomains: foldedDomains.length
    }
  };
}

export function compileCosmeticRules(lines, { generatedAt = new Date().toISOString() } = {}) {
  const global = new Set();
  const globalExceptions = new Set();
  const domains = new Map();
  const exceptions = new Map();
  const generichide = new Set();
  const elemhide = new Set();
  const add = (map, domain, selector) => {
    if (!map.has(domain)) map.set(domain, new Set());
    map.get(domain).add(selector);
  };
  const serialize = (map) => Object.fromEntries([...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([domain, selectors]) => [domain, [...selectors].sort()]));

  for (const line of lines) {
    const control = parseCosmeticControlFilter(line);
    if (control) {
      const target = control.type === 'elemhide' ? elemhide : generichide;
      for (const domain of control.domains) target.add(domain);
      continue;
    }
    const parsed = parseCosmeticFilter(line);
    if (!parsed) continue;
    if (parsed.exception) {
      if (!parsed.domains.length) {
        globalExceptions.add(parsed.selector);
      } else {
        for (const domain of parsed.domains) add(exceptions, domain, parsed.selector);
      }
      continue;
    }
    if (!parsed.domains.length) global.add(parsed.selector);
    for (const domain of parsed.domains) add(domains, domain, parsed.selector);
    for (const domain of parsed.excludedDomains) add(exceptions, domain, parsed.selector);
  }
  for (const selector of globalExceptions) global.delete(selector);
  return {
    version: 1,
    generatedAt,
    global: [...global].sort(),
    domains: serialize(domains),
    exceptions: serialize(exceptions),
    generichide: [...generichide].sort(),
    elemhide: [...elemhide].sort()
  };
}

export function domainFromNetworkFilter(line) {
  const parsed = parseNetworkFilter(line);
  return parsed?.domainOnly ? parsed.condition.requestDomains[0] : null;
}

export function isValidDomain(domain) {
  return validDomain(domain);
}
