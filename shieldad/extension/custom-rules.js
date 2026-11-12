import {
  compileCosmeticRules,
  compileNetworkRules,
  isValidDnrRule,
  normalizeDomainEntry,
  parseCosmeticControlFilter,
  parseCosmeticFilter,
  parseExtendedCosmeticFilter,
  parseNetworkFilter
} from './filter-parser.js';

const CUSTOM_PRIORITIES = {
  blockPriority: 10,
  importantBlockPriority: 450,
  redirectPriority: 55,
  importantRedirectPriority: 475,
  allowPriority: 300,
  importantAllowPriority: 500
};

export function compileCustomRules(text, startId = 100000, limit = 1000) {
  return compileNetworkRules(String(text || '').split(/\r?\n/), { limit, ...CUSTOM_PRIORITIES })
    .map((rule, index) => ({ ...rule, id: startId + index }))
    .filter(isValidDnrRule);
}

export function compileUserRules(text, { startId = 100000, networkLimit = 1000 } = {}) {
  const lines = String(text || '').split(/\r?\n/);
  const networkLines = [];
  const cosmeticLines = [];
  const invalidLines = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('!') || line.startsWith('[')) continue;
    if (parseCosmeticControlFilter(line)) {
      cosmeticLines.push(line);
      continue;
    }
    if (line.includes('##') || line.includes('#@#') || line.includes('#?#') || line.includes('#@?#')) {
      if (parseCosmeticFilter(line) || parseExtendedCosmeticFilter(line)) cosmeticLines.push(line);
      else invalidLines.push(line);
      continue;
    }
    const parsedNet = parseNetworkFilter(line, CUSTOM_PRIORITIES);
    if (parsedNet && !parsedNet.badfilter) {
      networkLines.push(line);
    } else {
      invalidLines.push(line);
    }
  }

  const networkRules = compileNetworkRules(networkLines, { limit: networkLimit, ...CUSTOM_PRIORITIES })
    .map((rule, index) => ({ ...rule, id: startId + index }))
    .filter(isValidDnrRule);

  const cosmetic = compileCosmeticRules(cosmeticLines);
  return { networkRules, cosmetic, invalidLines };
}

export function normalizeDomainList(value) {
  const entries = Array.isArray(value) ? value : String(value || '').split(/\r?\n/);
  const normalized = [];
  for (const entry of entries) {
    const domain = normalizeDomainEntry(entry);
    if (domain) normalized.push(domain);
  }
  return [...new Set(normalized)];
}
