const RESOURCE_OPTIONS = Object.freeze({
  script: 'script',
  image: 'image',
  stylesheet: 'stylesheet',
  css: 'stylesheet',
  font: 'font',
  media: 'media',
  object: 'object',
  subdocument: 'sub_frame',
  frame: 'sub_frame',
  document: 'main_frame',
  doc: 'main_frame',
  xmlhttprequest: 'xmlhttprequest',
  xhr: 'xmlhttprequest',
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
  'match-case', 'elemhide', 'generichide', 'genericblock',
  'popup', 'popunder', 'cookie', 'header', 'rewrite',
  'redirect-rule', 'replace', 'webrtc', 'cname', 'inline-script', 'inline-font'
]);

export const REDIRECT_RESOURCES = Object.freeze({
  noopjs: '/resources/noop.js',
  'noop.js': '/resources/noop.js',
  empty: '/resources/noop.txt',
  none: '/resources/noop.txt',
  nooptext: '/resources/noop.txt',
  'noop.txt': '/resources/noop.txt',
  noopcss: '/resources/noop.css',
  'noop.css': '/resources/noop.css',
  noopframe: '/resources/noop.html',
  'noop.html': '/resources/noop.html',
  'noopvast-3.0': '/resources/noop.xml',
  '1x1.gif': '/resources/1x1.gif',
  '1x1-transparent.gif': '/resources/1x1.gif',
  '2x2.png': '/resources/2x2.png',
  '2x2-transparent.png': '/resources/2x2.png',
  '32x32.png': '/resources/2x2.png',
  '32x32-transparent.png': '/resources/2x2.png',
  'noopmp3-0.1s': '/resources/noop.mp3',
  'noop-0.1s.mp3': '/resources/noop.mp3',
  'noop-1s.mp4': '/resources/noop.mp4',
  'noopmp4-1s': '/resources/noop.mp4',
  'google-ima.js': '/resources/google-ima.js',
  'ima3.js': '/resources/google-ima.js',
  'googletagservices_gpt.js': '/resources/gpt.js',
  'googletagservices.com/tag/js/gpt.js': '/resources/gpt.js',
  'googletagmanager_gtm.js': '/resources/gtm.js',
  'googletagmanager.com/gtm.js': '/resources/gtm.js',
  'google-analytics.com/analytics.js': '/resources/analytics.js',
  'google-analytics_analytics.js': '/resources/analytics.js',
  'googlesyndication_adsbygoogle.js': '/resources/adsbygoogle.js',
  'googlesyndication.com/pagead/js/adsbygoogle.js': '/resources/adsbygoogle.js',
  'amazon_apstag.js': '/resources/apstag.js',
  'amazon-adsystem.com/aax2/apstag.js': '/resources/apstag.js',
  'prebid-ads.js': '/resources/prebid.js',
  'nobab2.js': '/resources/fuckadblock.js',
  'fuckadblock.js-3.2.0': '/resources/fuckadblock.js',
  'fingerprint2.js': '/resources/fingerprint2.js',
  fingerprintjs2: '/resources/fingerprint2.js',
  fingerprintjs3: '/resources/fingerprint2.js',
  'popads.net.js': '/resources/noop.js',
  'hd-main.js': '/resources/noop.js'
});

const SCRIPTLET_ALIASES = Object.freeze({
  set: 'set',
  'set-constant': 'set',
  aopr: 'aopr',
  'abort-on-property-read': 'aopr',
  aopw: 'aopw',
  'abort-on-property-write': 'aopw',
  acs: 'acs',
  'abort-current-inline-script': 'acs',
  nowoif: 'nowoif',
  'no-window-open-if': 'nowoif',
  nostif: 'nostif',
  'no-setTimeout-if': 'nostif',
  'setTimeout-defuser': 'nostif',
  aeld: 'aeld',
  'prevent-addEventListener': 'aeld',
  'no-fetch-if': 'no-fetch-if',
  'prevent-fetch': 'no-fetch-if',
  'no-xhr-if': 'no-xhr-if',
  'prevent-xhr': 'no-xhr-if',
  'nano-sib': 'nano-sib',
  'nano-setInterval-booster': 'nano-sib',
  'nano-stb': 'nano-stb',
  'nano-setTimeout-booster': 'nano-stb',
  'noeval-if': 'noeval-if',
  'prevent-eval-if': 'noeval-if',
  ra: 'ra',
  'remove-attr': 'ra',
  nowebrtc: 'nowebrtc'
});

const YOUTUBE_HOST_RE = /^(?:.*\.)?(?:youtube\.com|youtube-nocookie\.com|youtubekids\.com|youtu\.be|googlevideo\.com)$/i;
const PROCEDURAL_SELECTOR = /:(?:has-text|matches-css(?:-before|-after)?|matches-path|matches-attr|xpath|upward|remove|style|min-text-length|watch-attr)\b|:-abp-(?:has|contains)/i;
const SAFE_CSS_PROP_RE = /^[a-z-]+\s*:\s*[^;{}<>]+$/i;

export function isYouTubeHost(domain) {
  return YOUTUBE_HOST_RE.test(String(domain || '').trim().replace(/^~/, '').replace(/\.$/, ''));
}

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

function findRegexEnd(str, start = 0) {
  for (let i = start + 1; i < str.length; i += 1) {
    if (str[i] === '\\') { i += 1; continue; }
    if (str[i] === '/') return i;
  }
  return -1;
}

function splitFilterOptionsList(rawOptions) {
  const items = [];
  let current = '';
  let inRegex = false;
  for (let i = 0; i < rawOptions.length; i += 1) {
    const ch = rawOptions[i];
    if (ch === '\\' && i + 1 < rawOptions.length) {
      current += ch + rawOptions[i + 1];
      i += 1;
      continue;
    }
    if (ch === '/' && (inRegex || /(?:^|=)$/.test(current))) {
      inRegex = !inRegex;
      current += ch;
      continue;
    }
    if (ch === ',' && !inRegex) {
      const trimmed = current.trim();
      if (trimmed) items.push(trimmed);
      current = '';
      continue;
    }
    current += ch;
  }
  const tail = current.trim();
  if (tail) items.push(tail);
  return items;
}

function splitOptions(filter) {
  if (filter.startsWith('/')) {
    const end = findRegexEnd(filter, 0);
    if (end > 0) {
      if (filter[end + 1] === '$') {
        return [filter.slice(0, end + 1), splitFilterOptionsList(filter.slice(end + 2))];
      }
      if (end === filter.length - 1) return [filter, []];
    }
  }
  // Find the options separator '$' outside regex option values (like removeparam=/^a$/).
  for (let i = 0; i < filter.length; i += 1) {
    if (filter[i] === '$' && (i === 0 || filter[i - 1] !== '\\')) {
      const candidate = filter.slice(i + 1);
      if (/^[a-z0-9~]/i.test(candidate)) {
        return [filter.slice(0, i), splitFilterOptionsList(candidate)];
      }
    }
  }
  return [filter, []];
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

export function isSafeRe2Pattern(pattern) {
  if (typeof pattern !== 'string' || !pattern.length || pattern.length > 260) return false;
  if (/[^\x20-\x7e]/.test(pattern)) return false;
  if (/\(\?[=!<]|\(\?<[a-zA-Z0-9_]+>|\\[1-9]|\{\d+,\d*\}[+*?]|(\+\+|\*\+|\?\+)/.test(pattern)) return false;
  // Reject repeated complex character-class chains or large {N,M} expansions that exceed Chrome's 2KB RE2 limit.
  if (/(\[[^\]]+\]|\([^)]+\))(?:\*|\+|\{\d+,?\d*\}){2,}/.test(pattern)) return false;
  if ((pattern.match(/\[[^\]]+\]/g) || []).length > 14) return false;
  let braceTotal = 0;
  for (const m of pattern.matchAll(/\{(\d+)(?:,(\d*))?\}/g)) {
    const bound = Number(m[2] || m[1]);
    if (bound > 20) return false;
    braceTotal += bound;
    if (braceTotal > 36) return false;
  }
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

function parseRemoveparamValues(rawValue) {
  if (!rawValue || rawValue.startsWith('~')) return null;
  if (/^[A-Za-z0-9_.-]+$/.test(rawValue)) return [rawValue];
  if (rawValue.startsWith('/') && rawValue.endsWith('/') && rawValue.length > 2) {
    let body = rawValue.slice(1, -1);
    if (body.startsWith('^')) body = body.slice(1);
    if (body.endsWith('$')) body = body.slice(0, -1);
    if (body.startsWith('(?:') && body.endsWith(')')) body = body.slice(3, -1);
    else if (body.startsWith('(') && body.endsWith(')')) body = body.slice(1, -1);
    const parts = body.split('|');
    if (parts.length && parts.every((p) => /^[A-Za-z0-9_.-]+$/.test(p))) {
      return [...new Set(parts)];
    }
  }
  return null;
}

function resolveRedirectPath(rawTarget, resourceTypes) {
  if (!rawTarget) return null;
  const clean = rawTarget.split(':')[0].trim().toLowerCase();
  if (clean === 'empty' || clean === 'none') {
    if (resourceTypes.includes('script')) return '/resources/noop.js';
    if (resourceTypes.includes('stylesheet')) return '/resources/noop.css';
    if (resourceTypes.includes('image')) return '/resources/1x1.gif';
    if (resourceTypes.includes('sub_frame')) return '/resources/noop.html';
    return '/resources/noop.txt';
  }
  return REDIRECT_RESOURCES[clean] || null;
}

function sanitizeCspValue(raw) {
  const value = String(raw || '').trim();
  if (!value || value.length > 512 || /[\r\n\0]/.test(value) || /[^\x20-\x7e]/.test(value)) return null;
  return value;
}

/** Parse one Adblock Plus / uBO network filter into a declarativeNetRequest-compatible shape. */
export function parseNetworkFilter(input, priorities = {}) {
  if (typeof input !== 'string') return null;
  const original = input.trim();
  if (
    !original ||
    original.startsWith('!') ||
    original.startsWith('#') ||
    original.startsWith('[') ||
    original.includes('##') ||
    original.includes('#@#') ||
    original.includes('#?#') ||
    original.includes('#@?#') ||
    original.includes('#$#') ||
    original.includes('#@$#') ||
    original.includes('#%#') ||
    original.includes('#@%#') ||
    original.includes('$$') ||
    original.includes('$@$')
  ) {
    return null;
  }

  const exception = original.startsWith('@@');
  let filter = exception ? original.slice(2) : original;
  if (!filter || /[^\x20-\x7e]/.test(filter)) return null;

  let options;
  [filter, options] = splitOptions(filter);

  const isRegexRaw = filter.startsWith('/') && filter.endsWith('/') && filter.length > 2;
  let regexPattern = null;
  if (isRegexRaw) {
    regexPattern = filter.slice(1, -1);
    if (!isSafeRe2Pattern(regexPattern)) return null;
  }

  const condition = {};
  const resourceTypes = [];
  const excludedResourceTypes = [];
  let important = false;
  let thirdParty;
  let badfilter = false;
  let redirectTarget = null;
  let removeparams = null;
  let cspValue = null;

  for (let rawOpt of options) {
    if (!rawOpt) continue;
    const eqIdx = rawOpt.indexOf('=');
    const rawName = (eqIdx >= 0 ? rawOpt.slice(0, eqIdx) : rawOpt).trim().toLowerCase();
    const rawVal = eqIdx >= 0 ? rawOpt.slice(eqIdx + 1).trim() : '';

    if (rawName === 'important') { important = true; continue; }
    if (rawName === 'badfilter') { badfilter = true; continue; }
    if (rawName === 'redirect') {
      if (!rawVal) return null;
      redirectTarget = rawVal;
      continue;
    }
    if (rawName === 'removeparam') {
      const parsedParams = parseRemoveparamValues(rawVal);
      if (!parsedParams) return null;
      removeparams = parsedParams;
      continue;
    }
    if (rawName === 'csp') {
      if (exception && !rawVal) return null;
      const cleanCsp = sanitizeCspValue(rawVal);
      if (!cleanCsp) return null;
      cspValue = cleanCsp;
      continue;
    }

    const negated = rawName.startsWith('~');
    const name = negated ? rawName.slice(1) : rawName;
    if (UNSUPPORTED_OPTIONS.has(name)) return null;

    if (name === 'third-party' || name === '3p' || name === 'strict3p') {
      thirdParty = negated ? 'firstParty' : 'thirdParty';
      continue;
    }
    if (name === '1p' || name === 'first-party' || name === 'strict1p') {
      thirdParty = negated ? 'thirdParty' : 'firstParty';
      continue;
    }
    if (name === 'all' && !negated) continue;
    if (name === 'domain' || name === 'from') {
      if (!rawVal || negated) return null;
      const parsedDomains = extractDomainOption(rawVal);
      if (!parsedDomains) return null;
      if (parsedDomains.included.length) {
        condition.initiatorDomains = [...new Set([...(condition.initiatorDomains || []), ...parsedDomains.included])];
      }
      if (parsedDomains.excluded.length) {
        condition.excludedInitiatorDomains = [...new Set([...(condition.excludedInitiatorDomains || []), ...parsedDomains.excluded])];
      }
      continue;
    }
    if (name === 'to') {
      if (!rawVal || negated) return null;
      const parsedTo = extractDomainOption(rawVal);
      if (!parsedTo) return null;
      if (parsedTo.included.length) {
        condition.requestDomains = [...new Set([...(condition.requestDomains || []), ...parsedTo.included])];
      }
      if (parsedTo.excluded.length) {
        condition.excludedRequestDomains = [...new Set([...(condition.excludedRequestDomains || []), ...parsedTo.excluded])];
      }
      continue;
    }
    if (name === 'denyallow') {
      if (!rawVal || negated) return null;
      const parsedDenyAllow = extractDomainOption(rawVal);
      if (!parsedDenyAllow || parsedDenyAllow.excluded.length || !parsedDenyAllow.included.length) return null;
      condition.excludedRequestDomains = [...new Set([...(condition.excludedRequestDomains || []), ...parsedDenyAllow.included])];
      continue;
    }
    if (RESOURCE_OPTIONS[name]) {
      (negated ? excludedResourceTypes : resourceTypes).push(RESOURCE_OPTIONS[name]);
      continue;
    }
    return null;
  }

  if (redirectTarget && (removeparams || cspValue)) return null;
  if (removeparams && cspValue) return null;
  if (exception && cspValue) return null;

  if (thirdParty) condition.domainType = thirdParty;
  if (resourceTypes.length && excludedResourceTypes.length) return null;
  if (resourceTypes.length) condition.resourceTypes = [...new Set(resourceTypes)];
  if (excludedResourceTypes.length) condition.excludedResourceTypes = [...new Set(excludedResourceTypes)];

  let domainOnly = false;
  if (regexPattern) {
    condition.regexFilter = regexPattern;
  } else {
    const domainMatch = filter.match(/^\|\|((?:\*\.)?(?:[a-z0-9-]+\.)+[a-z0-9-]+)\^$/i);
    if (domainMatch && validHostDomain(domainMatch[1]) && !condition.requestDomains?.length) {
      condition.requestDomains = [domainMatch[1].replace(/^\*\./, '').toLowerCase()];
      domainOnly = true;
    } else if (!filter) {
      const hasScopedTarget = Boolean(
        condition.initiatorDomains?.length || condition.requestDomains?.length || removeparams
      );
      if (!hasScopedTarget) return null;
    } else if (filter === '*') {
      const hasScopedWildcard = Boolean(
        condition.requestDomains?.length ||
        (condition.initiatorDomains?.length && condition.excludedRequestDomains?.length) ||
        removeparams
      );
      if (!hasScopedWildcard) return null;
    } else {
      if (filter.includes('##') || filter.includes('#@#') || filter.includes('#?#') || filter.includes('#@?#') || /\s/.test(filter) || /[\r\n\0]/.test(filter)) return null;
      if (filter === '||' || filter === '|' || filter.startsWith('#')) return null;
      condition.urlFilter = filter;
    }
  }

  const blockPriority = priorities.blockPriority ?? 1;
  const importantBlockPriority = priorities.importantBlockPriority ?? 200;
  const redirectPriority = priorities.redirectPriority ?? 50;
  const importantRedirectPriority = priorities.importantRedirectPriority ?? 250;
  const allowPriority = priorities.allowPriority ?? 100;
  const importantAllowPriority = priorities.importantAllowPriority ?? 400;

  let action;
  let priority;
  let kind = 'block';

  if (exception) {
    action = { type: 'allow' };
    priority = important ? importantAllowPriority : allowPriority;
    kind = 'allow';
  } else if (redirectTarget) {
    const extensionPath = resolveRedirectPath(redirectTarget, condition.resourceTypes || []);
    if (!extensionPath) return null;
    action = { type: 'redirect', redirect: { extensionPath } };
    priority = important ? importantRedirectPriority : redirectPriority;
    kind = 'redirect';
  } else if (removeparams) {
    if (!condition.resourceTypes && !condition.excludedResourceTypes) {
      condition.resourceTypes = ['main_frame', 'sub_frame', 'xmlhttprequest'];
    }
    action = {
      type: 'redirect',
      redirect: { transform: { queryTransform: { removeParams: removeparams } } }
    };
    priority = priorities.removeparamPriority ?? 1;
    kind = 'removeparam';
  } else if (cspValue) {
    if (!condition.resourceTypes && !condition.excludedResourceTypes) {
      condition.resourceTypes = ['main_frame', 'sub_frame'];
    }
    action = {
      type: 'modifyHeaders',
      responseHeaders: [{ header: 'content-security-policy', operation: 'append', value: cspValue }]
    };
    priority = important ? importantBlockPriority : blockPriority;
    kind = 'csp';
  } else {
    action = { type: 'block' };
    priority = important ? importantBlockPriority : blockPriority;
    kind = 'block';
  }

  return {
    exception,
    domainOnly,
    badfilter,
    isRegex: Boolean(condition.regexFilter),
    kind,
    action,
    priority,
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
    const low = option.toLowerCase();
    if (low === 'generichide' || low === 'elemhide') {
      type = low;
    } else if (low.startsWith('domain=')) {
      const value = low.slice('domain='.length);
      for (const entry of value.split('|')) {
        if (!entry || entry.startsWith('~')) continue;
        const clean = entry.toLowerCase().replace(/^\*\./, '').replace(/\.$/, '');
        if (validCosmeticDomain(clean)) domains.push(clean);
      }
    } else if (!['document', 'doc', 'third-party', '~third-party', '1p', '3p', 'first-party', '~first-party'].includes(low)) {
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

function splitCosmeticDomainPart(domainPart) {
  const domains = [];
  const excludedDomains = [];
  if (!domainPart) return { domains, excludedDomains };
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
  return { domains, excludedDomains };
}

/** Parse global, domain-specific, and exception CSS cosmetic filters. */
export function parseCosmeticFilter(input) {
  if (typeof input !== 'string') return null;
  const line = input.trim();
  if (line.includes('#?#') || line.includes('#@?#')) return null;
  const exceptionIndex = line.indexOf('#@#');
  const normalIndex = line.indexOf('##');
  const index = exceptionIndex >= 0 ? exceptionIndex : normalIndex;
  if (index < 0) return null;
  const markerLength = exceptionIndex >= 0 ? 3 : 2;
  const selector = line.slice(index + markerLength).trim();
  if (!selector || selector.length > 1000 || selector.startsWith('+js') || PROCEDURAL_SELECTOR.test(selector) || /[{}<\0\r\n]/.test(selector)) return null;
  const parsedDomains = splitCosmeticDomainPart(line.slice(0, index).trim());
  if (!parsedDomains) return null;
  return { exception: exceptionIndex >= 0, selector, ...parsedDomains };
}

function findBalancedParen(str, openIdx) {
  let depth = 0;
  let inRegex = false;
  for (let i = openIdx; i < str.length; i += 1) {
    const ch = str[i];
    if (ch === '\\' && i + 1 < str.length) { i += 1; continue; }
    if (ch === '/' && inRegex) {
      if (/^[gimsuy]*\s*\)/.test(str.slice(i + 1))) inRegex = false;
      continue;
    }
    if (ch === '/' && depth === 1 && (str[i - 1] === '(' || /[:=]/.test(str[i - 1]))) {
      // Only enter regex mode if a closing `/` followed by optional flags and `)` exists ahead.
      let foundRegexClose = false;
      for (let k = i + 1; k < str.length; k += 1) {
        if (str[k] === '\\') { k += 1; continue; }
        if (str[k] === '/' && /^[gimsuy]*\s*\)/.test(str.slice(k + 1))) {
          foundRegexClose = true;
          break;
        }
      }
      if (foundRegexClose) {
        inRegex = true;
        continue;
      }
    }
    if (inRegex) continue;
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function sanitizeStyleBlock(cssText) {
  const clean = String(cssText || '').trim();
  if (!clean || clean.length > 600 || /[{}\0\r\n]|expression\s*\(|@import|url\s*\(/i.test(clean)) return null;
  const decls = clean.split(';').map((d) => d.trim()).filter(Boolean);
  if (!decls.length || !decls.every((d) => SAFE_CSS_PROP_RE.test(d))) return null;
  return decls.join('; ') + ';';
}

function parseRegexOrLiteral(arg) {
  const trimmed = arg.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('/') && trimmed.lastIndexOf('/') > 0) {
    const last = trimmed.lastIndexOf('/');
    const pattern = trimmed.slice(1, last);
    const flags = trimmed.slice(last + 1);
    if (!/^[gimsuy]*$/.test(flags)) return null;
    try {
      new RegExp(pattern, flags);
      return { pattern, flags: flags.replace(/[gy]/g, '') };
    } catch {
      return null;
    }
  }
  return { literal: trimmed };
}

/**
 * Parse :style(...) native overrides and domain-scoped procedural cosmetic filters
 * (:has-text, :-abp-contains, :upward, :remove, :matches-path, :matches-css*, :matches-attr,
 * :min-text-length, :xpath, :-abp-has).
 */
export function parseExtendedCosmeticFilter(input) {
  if (typeof input !== 'string') return null;
  const line = input.trim();
  if (!line || line.startsWith('!') || line.startsWith('[') || line.includes('##+js') || line.includes('#@#+js')) return null;

  let marker = null;
  let idx = -1;
  for (const candidate of ['#@?#', '#?#', '#@#', '##']) {
    const pos = line.indexOf(candidate);
    if (pos >= 0 && (idx < 0 || pos < idx)) {
      idx = pos;
      marker = candidate;
    }
  }
  if (!marker || idx < 0) return null;
  const exception = marker === '#@#' || marker === '#@?#';
  const rawBody = line.slice(idx + marker.length).trim();
  if (!rawBody || rawBody.length > 1200 || /[<\0\r\n]/.test(rawBody)) return null;

  const domainPart = line.slice(0, idx).trim();
  const parsedDomains = splitCosmeticDomainPart(domainPart);
  if (!parsedDomains || !parsedDomains.domains.length) return null;

  // Handle pure CSS selector + trailing :style(...) without procedural ops.
  const styleOnlyMatch = rawBody.match(/^(.*):style\(([^()]+)\)$/);
  if (styleOnlyMatch && !PROCEDURAL_SELECTOR.test(styleOnlyMatch[1]) && !exception) {
    const selector = styleOnlyMatch[1].trim();
    const css = sanitizeStyleBlock(styleOnlyMatch[2]);
    if (selector && css && !/[{}]/.test(selector)) {
      return { kind: 'style', selector, css, ...parsedDomains };
    }
  }

  if (!PROCEDURAL_SELECTOR.test(rawBody) || exception) return null;

  // Parse left-to-right chain of base CSS selector + procedural operators.
  const opTokenRe = /:(has-text|:-abp-contains|matches-path|matches-css-before|matches-css-after|matches-css|matches-attr|min-text-length|upward|remove|style|xpath|-abp-has)\(/gi;
  // Normalize :-abp-contains / :-abp-has prefixes for matching.
  const firstOpMatch = rawBody.match(/:(?:has-text|matches-css(?:-before|-after)?|matches-path|matches-attr|min-text-length|upward|remove|style|xpath|-abp-has|-abp-contains)\(/i);
  if (!firstOpMatch) return null;

  let cursor = firstOpMatch.index;
  let base = rawBody.slice(0, cursor).trim();
  if (base.endsWith(':not(') || base.endsWith(':has(')) return null;
  if (!base) base = '*';

  const ops = [];
  let action = { type: 'hide' };

  while (cursor < rawBody.length) {
    if (rawBody[cursor] !== ':') return null;
    const parenIdx = rawBody.indexOf('(', cursor);
    if (parenIdx < 0) return null;
    const opName = rawBody.slice(cursor + 1, parenIdx).toLowerCase();
    const endIdx = findBalancedParen(rawBody, parenIdx);
    if (endIdx < 0) return null;
    const arg = rawBody.slice(parenIdx + 1, endIdx).trim();
    cursor = endIdx + 1;

    if (opName === 'remove') {
      if (arg) return null;
      action = { type: 'remove' };
    } else if (opName === 'style') {
      const css = sanitizeStyleBlock(arg);
      if (!css) return null;
      action = { type: 'style', css };
    } else if (opName === 'has-text' || opName === '-abp-contains') {
      const matcher = parseRegexOrLiteral(arg);
      if (!matcher) return null;
      ops.push({ op: 'has-text', ...matcher });
    } else if (opName === 'matches-path') {
      const matcher = parseRegexOrLiteral(arg);
      if (!matcher) return null;
      ops.push({ op: 'matches-path', ...matcher });
    } else if (opName === 'matches-css' || opName === 'matches-css-before' || opName === 'matches-css-after') {
      const colon = arg.indexOf(':');
      if (colon <= 0) return null;
      const prop = arg.slice(0, colon).trim().toLowerCase();
      const valMatcher = parseRegexOrLiteral(arg.slice(colon + 1));
      if (!prop || !valMatcher) return null;
      ops.push({ op: opName, prop, ...valMatcher });
    } else if (opName === 'matches-attr') {
      const eq = arg.indexOf('=');
      if (eq <= 0) return null;
      const attr = arg.slice(0, eq).trim();
      const valArg = arg.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      const valMatcher = parseRegexOrLiteral(valArg);
      if (!attr || !valMatcher) return null;
      ops.push({ op: 'matches-attr', attr, ...valMatcher });
    } else if (opName === 'min-text-length') {
      const minLen = Number(arg);
      if (!Number.isFinite(minLen) || minLen < 0) return null;
      ops.push({ op: 'min-text-length', min: minLen });
    } else if (opName === 'upward') {
      if (/^\d+$/.test(arg)) {
        const steps = Number(arg);
        if (steps < 1 || steps > 25) return null;
        ops.push({ op: 'upward', steps });
      } else if (arg) {
        ops.push({ op: 'upward', selector: arg });
      } else {
        return null;
      }
    } else if (opName === 'xpath') {
      if (!arg) return null;
      ops.push({ op: 'xpath', expr: arg });
    } else if (opName === '-abp-has') {
      if (!arg || PROCEDURAL_SELECTOR.test(arg)) return null;
      ops.push({ op: 'has', selector: arg });
    } else {
      return null;
    }

    // Allow simple trailing sibling/descendant combinator selector after procedural op?
    const rest = rawBody.slice(cursor).trim();
    if (rest && !rest.startsWith(':')) {
      if (PROCEDURAL_SELECTOR.test(rest)) return null;
      ops.push({ op: 'query', combinatorSelector: rest });
      break;
    }
    cursor = rawBody.length - rest.length;
  }

  void opTokenRe;
  if (!ops.length && action.type === 'hide') return null;
  return { kind: 'procedural', base, ops, action, ...parsedDomains };
}

function splitScriptletArgs(inner) {
  const args = [];
  let current = '';
  let inRegex = false;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (ch === '\\' && i + 1 < inner.length) {
      const next = inner[i + 1];
      if (next === ',') {
        current += ',';
        i += 1;
        continue;
      }
      current += ch + next;
      i += 1;
      continue;
    }
    if (ch === '/' && (inRegex || current.trim() === '')) {
      inRegex = !inRegex;
      current += ch;
      continue;
    }
    if (ch === ',' && !inRegex) {
      args.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim() || args.length) args.push(current.trim());
  return args;
}

/**
 * Parse domain-scoped ##+js(...) and #@#+js(...) scriptlets while explicitly excluding
 * all YouTube domains to enforce ad-slot-only / non-circumvention policy.
 */
export function parseScriptletFilter(input) {
  if (typeof input !== 'string') return null;
  const line = input.trim();
  const excIdx = line.indexOf('#@#+js(');
  const addIdx = line.indexOf('##+js(');
  const exception = excIdx >= 0;
  const idx = exception ? excIdx : addIdx;
  if (idx <= 0 || !line.endsWith(')')) return null;

  const markerLen = exception ? 7 : 6;
  const inner = line.slice(idx + markerLen, -1).trim();
  if (!inner) return null;
  const parts = splitScriptletArgs(inner);
  const rawName = (parts[0] || '').trim();
  const name = SCRIPTLET_ALIASES[rawName];
  if (!name) return null;

  const parsedDomains = splitCosmeticDomainPart(line.slice(0, idx).trim());
  if (!parsedDomains) return null;
  const domains = parsedDomains.domains.filter((d) => !isYouTubeHost(d));
  if (!domains.length) return null;

  return {
    exception,
    name,
    args: parts.slice(1),
    domains,
    excludedDomains: parsedDomains.excludedDomains
  };
}

export function compileScriptlets(lines) {
  const actionMap = new Map();
  const actions = [];
  const exceptionsByDomain = new Map();
  const domainRules = new Map();

  const addAction = (name, args) => {
    const entry = [name, ...args];
    const sig = JSON.stringify(entry);
    if (!actionMap.has(sig)) {
      actionMap.set(sig, actions.length);
      actions.push(entry);
    }
    return sig;
  };

  const parsedEntries = [];
  for (const line of lines) {
    const parsed = parseScriptletFilter(line);
    if (!parsed) continue;
    const sig = addAction(parsed.name, parsed.args);
    if (parsed.exception) {
      for (const domain of parsed.domains) {
        if (!exceptionsByDomain.has(domain)) exceptionsByDomain.set(domain, new Set());
        exceptionsByDomain.get(domain).add(sig);
      }
    } else {
      parsedEntries.push({ ...parsed, sig });
    }
  }

  for (const entry of parsedEntries) {
    const actionId = actionMap.get(entry.sig);
    for (const domain of entry.domains) {
      if (isYouTubeHost(domain)) continue;
      if (exceptionsByDomain.get(domain)?.has(entry.sig)) continue;
      if (!domainRules.has(domain)) domainRules.set(domain, []);
      const list = domainRules.get(domain);
      if (!list.includes(actionId)) list.push(actionId);
    }
  }

  return {
    actions,
    domains: Object.fromEntries([...domainRules.entries()].sort(([a], [b]) => a.localeCompare(b)))
  };
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
  const actionType = rule.action?.type;
  if (!['block', 'allow', 'allowAllRequests', 'upgradeScheme', 'redirect', 'modifyHeaders'].includes(actionType)) return false;

  if (actionType === 'redirect') {
    const r = rule.action.redirect;
    if (!r || typeof r !== 'object') return false;
    const hasPath = typeof r.extensionPath === 'string' && r.extensionPath.startsWith('/');
    const hasUrl = typeof r.url === 'string' && r.url.length > 0;
    const hasRemoveParams = Array.isArray(r.transform?.queryTransform?.removeParams) && r.transform.queryTransform.removeParams.length > 0;
    if (!hasPath && !hasUrl && !hasRemoveParams) return false;
  }

  if (actionType === 'modifyHeaders') {
    const rh = rule.action.responseHeaders;
    if (!Array.isArray(rh) || !rh.length) return false;
    if (rh.some((h) => !h.header || !['append', 'set', 'remove'].includes(h.operation))) return false;
  }

  const cond = rule.condition;
  if (!cond || typeof cond !== 'object') return false;
  if (cond.urlFilter !== undefined) {
    if (typeof cond.urlFilter !== 'string' || !cond.urlFilter.length || /[^\x21-\x7e]/.test(cond.urlFilter)) return false;
  }
  if (cond.regexFilter !== undefined) {
    if (!isSafeRe2Pattern(cond.regexFilter)) return false;
  }
  if (cond.urlFilter && cond.regexFilter) return false;

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
  if (actionType === 'allowAllRequests') {
    if (!cond.resourceTypes?.length || cond.resourceTypes.some((t) => t !== 'main_frame' && t !== 'sub_frame')) return false;
  }
  return Boolean(
    cond.urlFilter || cond.regexFilter || cond.requestDomains?.length || cond.initiatorDomains?.length ||
    cond.excludedInitiatorDomains?.length || cond.excludedRequestDomains?.length ||
    cond.resourceTypes?.length || cond.domainType
  );
}

export function compileNetworkRules(lines, { limit = 29000, ...priorities } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 29999) throw new Error('Rule limit must be between 1 and 29,999');
  const parsedList = [];
  const badfilterKeys = new Set();
  for (const line of lines) {
    const parsed = parseNetworkFilter(line, priorities);
    if (!parsed) continue;
    const key = JSON.stringify([parsed.action, parsed.condition]);
    if (parsed.badfilter) {
      badfilterKeys.add(key);
      continue;
    }
    parsedList.push({ ...parsed, _bfKey: key });
  }

  const candidates = [];
  const seen = new Set();
  for (const parsed of parsedList) {
    if (badfilterKeys.has(parsed._bfKey)) continue;
    const signature = JSON.stringify([parsed.action, parsed.condition, parsed.priority]);
    if (seen.has(signature)) continue;
    seen.add(signature);
    candidates.push(parsed);
  }

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
  return selected.map(({ exception, domainOnly, badfilter, isRegex, kind, _bfKey, ...rule }, index) => ({ id: index + 1, ...rule }));
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
  return ordered.filter((domain) => !hasAncestor(domain, candidateSet, false));
}

export function compileDomainRules(domains, { limit = 29000, coveredDomains = [] } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 29999) throw new Error('Rule limit must be between 1 and 29,999');
  return foldDomains(domains, coveredDomains)
    .slice(0, limit)
    .map((domain, index) => ({ id: index + 1, priority: 1, action: { type: 'block' }, condition: { requestDomains: [domain] } }));
}

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

function canonicalBadfilterSignature(parsed) {
  return JSON.stringify([parsed.kind, parsed.condition, parsed.action.redirect?.extensionPath || '']);
}

/**
 * Compile priority network rules (exceptions, redirects, CSP headers, conditional rules,
 * removeparam, URL/regex rules) alongside ranked root ad/tracking domains into the core
 * guaranteed ruleset (`ads`, <=29,000), spilling overflow rules and remaining folded
 * domains cleanly across up to `maxDomainChunks` extra rulesets without dropping coverage.
 */
export function compileStaticRulesets({
  priorityNetworkLines = [],
  adserverLines = [],
  hostsDomains = [],
  perRulesetLimit = 29000,
  maxDomainChunks = 8,
  maxRegexRules = 700
} = {}) {
  if (!Number.isInteger(perRulesetLimit) || perRulesetLimit < 1 || perRulesetLimit > 29999) {
    throw new Error('Ruleset limit must be between 1 and 29,999');
  }

  const badfilterKeys = new Set();
  const parsedPriority = [];
  const parsedAdservers = [];

  for (const line of priorityNetworkLines) {
    const parsed = parseNetworkFilter(line);
    if (!parsed) continue;
    const bfKey = canonicalBadfilterSignature(parsed);
    if (parsed.badfilter) badfilterKeys.add(bfKey);
    else parsedPriority.push({ ...parsed, bfKey });
  }
  for (const line of adserverLines) {
    const parsed = parseNetworkFilter(line);
    if (!parsed) continue;
    const bfKey = canonicalBadfilterSignature(parsed);
    if (parsed.badfilter) badfilterKeys.add(bfKey);
    else parsedAdservers.push({ ...parsed, bfKey });
  }

  const seen = new Set();
  const exceptions = [];
  const redirects = [];
  const cspRules = [];
  const removeparams = [];
  const conditionalDomains = [];
  const urlRules = [];
  const regexRules = [];
  const priorityUncond = [];
  const adserverUncond = [];

  const isUnconditionalDomain = (rule) => (
    rule.kind === 'block' &&
    rule.domainOnly &&
    !rule.condition.domainType &&
    !rule.condition.resourceTypes &&
    !rule.condition.excludedResourceTypes &&
    !rule.condition.initiatorDomains &&
    !rule.condition.excludedInitiatorDomains &&
    !rule.condition.excludedRequestDomains
  );

  // Merge removeparam rules sharing identical condition and priority into fewer DNR rules.
  const removeparamBuckets = new Map();

  const ingest = (items, uncondTarget) => {
    for (const parsed of items) {
      if (badfilterKeys.has(parsed.bfKey)) continue;
      if (parsed.kind === 'removeparam') {
        const condSig = JSON.stringify([parsed.priority, parsed.condition]);
        if (!removeparamBuckets.has(condSig)) {
          removeparamBuckets.set(condSig, { condition: parsed.condition, params: new Set(), priority: parsed.priority });
        }
        for (const p of parsed.action.redirect.transform.queryTransform.removeParams) {
          removeparamBuckets.get(condSig).params.add(p);
        }
        continue;
      }

      const signature = JSON.stringify([parsed.action, parsed.condition, parsed.priority]);
      if (seen.has(signature)) continue;
      seen.add(signature);

      if (parsed.isRegex) {
        if (regexRules.length < maxRegexRules) regexRules.push(parsed);
        continue;
      }
      if (parsed.exception) exceptions.push(parsed);
      else if (parsed.kind === 'redirect') redirects.push(parsed);
      else if (parsed.kind === 'csp') cspRules.push(parsed);
      else if (parsed.kind === 'removeparam') removeparams.push(parsed);
      else if (!parsed.domainOnly) urlRules.push(parsed);
      else if (!isUnconditionalDomain(parsed)) conditionalDomains.push(parsed);
      else uncondTarget.push(parsed.condition.requestDomains[0]);
    }
  };

  ingest(parsedPriority, priorityUncond);
  ingest(parsedAdservers, adserverUncond);

  for (const bucket of removeparamBuckets.values()) {
    const params = [...bucket.params];
    for (let i = 0; i < params.length; i += 200) {
      removeparams.push({
        action: { type: 'redirect', redirect: { transform: { queryTransform: { removeParams: params.slice(i, i + 200) } } } },
        priority: bucket.priority,
        condition: bucket.condition
      });
    }
  }

  const rankedAdservers = [...new Set(adserverUncond)].sort((a, b) => (
    a.split('.').length - b.split('.').length ||
    a.length - b.length ||
    a.localeCompare(b)
  ));

  const foldedDomains = foldDomains([...priorityUncond, ...rankedAdservers, ...hostsDomains]);
  const stripMeta = ({ exception, domainOnly, badfilter, isRegex, kind, bfKey, ...rule }) => rule;

  // Prioritize critical rules and reserve at least 8,000 slots in `ads` for top root ad domains.
  const orderedNonDomain = [
    ...exceptions,
    ...redirects,
    ...cspRules,
    ...conditionalDomains,
    ...regexRules,
    ...urlRules,
    ...removeparams
  ].map(stripMeta);

  const reservedDomainSlots = Math.min(
    foldedDomains.length,
    Math.min(8000, Math.floor(perRulesetLimit * 0.4))
  );
  const nonDomainCoreBudget = Math.max(0, perRulesetLimit - reservedDomainSlots);
  const coreNonDomain = orderedNonDomain.slice(0, nonDomainCoreBudget);
  const overflowNonDomain = orderedNonDomain.slice(nonDomainCoreBudget);

  const coreDomainBudget = Math.max(0, perRulesetLimit - coreNonDomain.length);
  const coreDomains = foldedDomains.slice(0, coreDomainBudget).map((domain) => ({
    action: { type: 'block' },
    priority: 1,
    condition: { requestDomains: [domain] }
  }));

  const ads = [...coreNonDomain, ...coreDomains].map((rule, index) => ({ id: index + 1, ...rule }));

  const remainingRules = [
    ...overflowNonDomain,
    ...foldedDomains.slice(coreDomainBudget).map((domain) => ({
      action: { type: 'block' },
      priority: 1,
      condition: { requestDomains: [domain] }
    }))
  ];

  const domainChunks = [];
  for (let offset = 0; offset < remainingRules.length && domainChunks.length < maxDomainChunks; offset += perRulesetLimit) {
    domainChunks.push(
      remainingRules.slice(offset, offset + perRulesetLimit).map((rule, index) => ({ id: index + 1, ...rule }))
    );
  }

  return {
    ads,
    domainChunks,
    stats: {
      exceptions: exceptions.length,
      redirects: redirects.length,
      cspRules: cspRules.length,
      removeparams: removeparams.length,
      regexRules: regexRules.length,
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
  const styles = new Map();
  const procedural = new Map();
  const generichide = new Set();
  const elemhide = new Set();

  const add = (map, domain, value) => {
    if (!map.has(domain)) map.set(domain, new Set());
    map.get(domain).add(value);
  };
  const serialize = (map) => Object.fromEntries(
    [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([domain, vals]) => [domain, [...vals].sort()])
  );

  for (const line of lines) {
    const control = parseCosmeticControlFilter(line);
    if (control) {
      const target = control.type === 'elemhide' ? elemhide : generichide;
      for (const domain of control.domains) target.add(domain);
      continue;
    }

    const parsed = parseCosmeticFilter(line);
    if (parsed) {
      if (parsed.exception) {
        if (!parsed.domains.length) globalExceptions.add(parsed.selector);
        else for (const domain of parsed.domains) add(exceptions, domain, parsed.selector);
        continue;
      }
      if (!parsed.domains.length) global.add(parsed.selector);
      for (const domain of parsed.domains) add(domains, domain, parsed.selector);
      for (const domain of parsed.excludedDomains) add(exceptions, domain, parsed.selector);
      continue;
    }

    const ext = parseExtendedCosmeticFilter(line);
    if (!ext) continue;
    if (ext.kind === 'style') {
      for (const domain of ext.domains) {
        if (!styles.has(domain)) styles.set(domain, new Map());
        styles.get(domain).set(ext.selector, ext.css);
      }
    } else if (ext.kind === 'procedural') {
      const entry = { b: ext.base, o: ext.ops, a: ext.action };
      const sig = JSON.stringify(entry);
      for (const domain of ext.domains) {
        if (!procedural.has(domain)) procedural.set(domain, new Map());
        procedural.get(domain).set(sig, entry);
      }
    }
  }

  for (const selector of globalExceptions) global.delete(selector);

  const serializedStyles = Object.fromEntries(
    [...styles.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([domain, map]) => [domain, [...map.entries()].map(([selector, css]) => ({ s: selector, c: css }))])
  );

  const serializedProcedural = Object.fromEntries(
    [...procedural.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([domain, map]) => [domain, [...map.values()]])
  );

  return {
    version: 2,
    generatedAt,
    global: [...global].sort(),
    domains: serialize(domains),
    exceptions: serialize(exceptions),
    styles: serializedStyles,
    procedural: serializedProcedural,
    generichide: [...generichide].sort(),
    elemhide: [...elemhide].sort()
  };
}

export function domainFromNetworkFilter(line) {
  const parsed = parseNetworkFilter(line);
  if (
    !parsed ||
    !parsed.domainOnly ||
    parsed.exception ||
    parsed.badfilter ||
    parsed.kind !== 'block' ||
    (parsed.condition.domainType && parsed.condition.domainType !== 'thirdParty') ||
    parsed.condition.initiatorDomains ||
    parsed.condition.excludedInitiatorDomains ||
    parsed.condition.resourceTypes ||
    parsed.condition.excludedResourceTypes
  ) {
    return null;
  }
  return parsed.condition.requestDomains[0];
}

export function isValidDomain(domain) {
  return validDomain(domain);
}
