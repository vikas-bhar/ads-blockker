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

const UNSUPPORTED_OPTIONS = new Set([
  'badfilter', 'match-case', 'elemhide', 'generichide', 'genericblock',
  'popup', 'popunder', 'removeparam', 'cookie', 'header'
]);

function validDomain(domain) {
  if (!domain || domain.length > 253 || !/^[a-z0-9._-]+$/i.test(domain)) return false;
  const labels = domain.replace(/^\*\./, '').split('.');
  return labels.every((label) => label.length > 0 && label.length <= 63 && !label.startsWith('-') && !label.endsWith('-'));
}

function splitOptions(filter) {
  const separator = filter.lastIndexOf('$');
  if (separator < 1) return [filter, []];
  return [filter.slice(0, separator), filter.slice(separator + 1).split(',').map((item) => item.trim().toLowerCase()).filter(Boolean)];
}

/** Parse one Adblock Plus network filter into a declarativeNetRequest-compatible shape. */
export function parseNetworkFilter(input) {
  if (typeof input !== 'string') return null;
  const original = input.trim();
  if (!original || original.startsWith('!') || original.startsWith('[') || original.includes('##') || original.includes('#@#')) return null;

  const exception = original.startsWith('@@');
  let filter = exception ? original.slice(2) : original;
  if (!filter) return null;
  let options;
  [filter, options] = splitOptions(filter);
  if (!filter || (filter.startsWith('/') && filter.endsWith('/'))) return null;

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
      const included = [];
      const excluded = [];
      for (let entry of value.split('|')) {
        const exclude = entry.startsWith('~');
        if (exclude) entry = entry.slice(1);
        entry = entry.toLowerCase();
        if (!validDomain(entry)) return null;
        (exclude ? excluded : included).push(entry);
      }
      if (included.length) condition.initiatorDomains = [...new Set(included)];
      if (excluded.length) condition.excludedInitiatorDomains = [...new Set(excluded)];
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

  const domainMatch = filter.match(/^\|\|((?:\*\.)?(?:[a-z0-9-]+\.)*[a-z0-9-]+)\^$/i);
  let domainOnly = false;
  if (domainMatch && validDomain(domainMatch[1])) {
    condition.requestDomains = [domainMatch[1].replace(/^\*\./, '').toLowerCase()];
    domainOnly = true;
  } else {
    if (filter.includes('##') || filter.includes('#@#') || /[\r\n\0]/.test(filter)) return null;
    condition.urlFilter = filter;
  }

  return {
    exception,
    domainOnly,
    action: { type: exception ? 'allow' : 'block' },
    priority: exception ? (important ? 200 : 100) : (important ? 20 : 1),
    condition
  };
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
  if (!selector || selector.length > 1000 || selector.startsWith('+js') || selector.includes(':-abp-') || /[{}<>\0\r\n]/.test(selector)) return null;
  const domainPart = line.slice(0, index).trim();
  const domains = [];
  const excludedDomains = [];
  if (domainPart) {
    for (let domain of domainPart.split(',')) {
      domain = domain.trim().toLowerCase();
      const excluded = domain.startsWith('~');
      if (excluded) domain = domain.slice(1);
      if (!validDomain(domain)) return null;
      (excluded ? excludedDomains : domains).push(domain);
    }
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
  return validDomain(domain) && domain.includes('.') ? domain : null;
}

export function compileNetworkRules(lines, { limit = 29000 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 29999) throw new Error('Rule limit must be between 1 and 29,999');
  const candidates = [];
  const seen = new Set();
  for (const line of lines) {
    const parsed = parseNetworkFilter(line);
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

/** Compile a memory-efficient domain ruleset, skipping domains already covered by a parent. */
export function compileDomainRules(domains, { limit = 29000, coveredDomains = [] } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 29999) throw new Error('Rule limit must be between 1 and 29,999');
  const covered = new Set(coveredDomains.map((domain) => String(domain).toLowerCase()));
  const seen = new Set();
  const hasParent = (domain, set) => {
    let current = domain;
    while (true) {
      if (set.has(current)) return true;
      const dot = current.indexOf('.');
      if (dot < 0) return false;
      current = current.slice(dot + 1);
    }
  };
  const rules = [];
  for (const entry of domains) {
    const domain = String(entry).trim().toLowerCase().replace(/\.$/, '');
    if (!validDomain(domain) || !domain.includes('.') || hasParent(domain, covered) || hasParent(domain, seen)) continue;
    seen.add(domain);
    rules.push({ id: rules.length + 1, priority: 1, action: { type: 'block' }, condition: { requestDomains: [domain] } });
    if (rules.length === limit) break;
  }
  return rules;
}

export function compileCosmeticRules(lines, { generatedAt = new Date().toISOString() } = {}) {
  const global = new Set();
  const domains = new Map();
  const exceptions = new Map();
  const add = (map, domain, selector) => {
    if (!map.has(domain)) map.set(domain, new Set());
    map.get(domain).add(selector);
  };
  const serialize = (map) => Object.fromEntries([...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([domain, selectors]) => [domain, [...selectors].sort()]));

  for (const line of lines) {
    const parsed = parseCosmeticFilter(line);
    if (!parsed) continue;
    if (parsed.exception) {
      for (const domain of parsed.domains) add(exceptions, domain, parsed.selector);
      continue;
    }
    if (!parsed.domains.length) global.add(parsed.selector);
    for (const domain of parsed.domains) add(domains, domain, parsed.selector);
    for (const domain of parsed.excludedDomains) add(exceptions, domain, parsed.selector);
  }
  return { version: 1, generatedAt, global: [...global].sort(), domains: serialize(domains), exceptions: serialize(exceptions) };
}

export function domainFromNetworkFilter(line) {
  const parsed = parseNetworkFilter(line);
  return parsed?.domainOnly ? parsed.condition.requestDomains[0] : null;
}

export function isValidDomain(domain) {
  return validDomain(domain);
}
