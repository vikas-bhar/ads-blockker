import { compileNetworkRules, isValidDomain } from './filter-parser.js';

export function compileCustomRules(text, startId = 100000, limit = 1000) {
  return compileNetworkRules(String(text || '').split(/\r?\n/), { limit })
    .map((rule, index) => ({ ...rule, id: startId + index }));
}

export function normalizeDomainList(value) {
  const entries = Array.isArray(value) ? value : String(value || '').split(/\r?\n/);
  return [...new Set(entries.map((entry) => String(entry).trim().toLowerCase().replace(/^\*\./, '').replace(/\.$/, ''))
    .filter((entry) => isValidDomain(entry)))];
}
