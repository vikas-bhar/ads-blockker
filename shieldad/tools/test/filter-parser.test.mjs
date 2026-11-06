import { describe, expect, it } from '@jest/globals';
import {
  compileCosmeticRules,
  compileDomainRules,
  compileNetworkRules,
  domainFromNetworkFilter,
  parseCosmeticFilter,
  parseHostsLine,
  parseNetworkFilter
} from '../src/filter-parser.mjs';

describe('network filter parser', () => {
  it('converts ||domain^ to a prioritized requestDomains rule', () => {
    expect(parseNetworkFilter('||ads.example.com^')).toMatchObject({
      domainOnly: true,
      action: { type: 'block' },
      condition: { requestDomains: ['ads.example.com'] }
    });
  });

  it('retains URL wildcards and separators', () => {
    const rule = parseNetworkFilter('||cdn.example.com/*/banners?*^');
    expect(rule.domainOnly).toBe(false);
    expect(rule.condition.urlFilter).toBe('||cdn.example.com/*/banners?*^');
  });

  it('converts @@ exceptions to higher-priority allow rules', () => {
    const rule = parseNetworkFilter('@@||allowed.example.com^');
    expect(rule.action.type).toBe('allow');
    expect(rule.exception).toBe(true);
    expect(rule.priority).toBeGreaterThan(parseNetworkFilter('||allowed.example.com^').priority);
  });

  it('maps script, image and xmlhttprequest options', () => {
    expect(parseNetworkFilter('||ads.example.com^$script,image,xmlhttprequest').condition.resourceTypes)
      .toEqual(['script', 'image', 'xmlhttprequest']);
  });

  it('maps third-party and first-party options', () => {
    expect(parseNetworkFilter('||ads.example.com^$third-party').condition.domainType).toBe('thirdParty');
    expect(parseNetworkFilter('||ads.example.com^$~third-party').condition.domainType).toBe('firstParty');
  });

  it('maps included and excluded initiator domains', () => {
    const condition = parseNetworkFilter('/advert/*$domain=foo.com|bar.com|~www.bar.com,script').condition;
    expect(condition.initiatorDomains).toEqual(['foo.com', 'bar.com']);
    expect(condition.excludedInitiatorDomains).toEqual(['www.bar.com']);
    expect(condition.resourceTypes).toEqual(['script']);
  });

  it('rejects comments, cosmetics, regex filters, and unsupported modifiers', () => {
    for (const filter of ['! comment', 'example.com##.ad', '/ads\\/[0-9]+/', '||a.com^$redirect=noop', '||a.com^$badfilter']) {
      expect(parseNetworkFilter(filter)).toBeNull();
    }
  });

  it('deduplicates and caps rules without dropping exceptions', () => {
    const lines = ['@@||safe.example^', '||ads.example^', '||ads.example^'];
    for (let i = 0; i < 100; i += 1) lines.push(`/banner-${i}/*`);
    const rules = compileNetworkRules(lines, { limit: 20 });
    expect(rules).toHaveLength(20);
    expect(rules[0].action.type).toBe('allow');
    expect(new Set(rules.map((rule) => rule.id)).size).toBe(20);
  });

  it('reserves space for URL patterns while prioritizing domain rules', () => {
    const lines = [];
    for (let i = 0; i < 50; i += 1) lines.push(`||ads-${i}.example.com^`);
    for (let i = 0; i < 50; i += 1) lines.push(`/banner-${i}/*`);
    const rules = compileNetworkRules(lines, { limit: 20 });
    expect(rules).toHaveLength(20);
    expect(rules.filter((rule) => rule.condition.requestDomains)).toHaveLength(15);
    expect(rules.filter((rule) => rule.condition.urlFilter)).toHaveLength(5);
  });

  it('accepts the all resource option without narrowing the rule', () => {
    expect(parseNetworkFilter('||ads.example.com^$all').condition).toEqual({ requestDomains: ['ads.example.com'] });
  });
});

describe('cosmetic and hosts parsing', () => {
  it('parses global and per-domain cosmetic selectors', () => {
    expect(parseCosmeticFilter('##.advertisement')).toMatchObject({ selector: '.advertisement', domains: [] });
    expect(parseCosmeticFilter('example.com,sub.example.com##.sponsor')).toMatchObject({ domains: ['example.com', 'sub.example.com'] });
  });

  it('compiles cosmetic exceptions and excludes procedural selectors', () => {
    const result = compileCosmeticRules([
      '##.ad', 'example.com##.banner', 'example.com#@#.ad',
      '~global.example##.ad', 'mixed.example,~excluded.example##.mixed',
      'bad.example##+js(alert)', 'bad.example##div:-abp-has(.ad)'
    ], { generatedAt: 'now' });
    expect(result.global).toEqual(['.ad']);
    expect(result.domains['example.com']).toEqual(['.banner']);
    expect(result.exceptions['example.com']).toEqual(['.ad']);
    expect(result.exceptions['global.example']).toEqual(['.ad']);
    expect(result.domains['mixed.example']).toEqual(['.mixed']);
    expect(result.exceptions['excluded.example']).toEqual(['.mixed']);
  });

  it('compiles domain rules without redundant children or covered domains', () => {
    const rules = compileDomainRules([
      'sub.covered.com', 'ads.example.com', 'pixel.ads.example.com',
      'tracker.test', 'tracker.test', 'localhost'
    ], { coveredDomains: ['covered.com'] });
    expect(rules.map((rule) => rule.condition.requestDomains[0])).toEqual(['ads.example.com', 'tracker.test']);
    expect(rules.map((rule) => rule.id)).toEqual([1, 2]);
  });

  it('reads hosts entries and ignores local addresses and comments', () => {
    expect(parseHostsLine('0.0.0.0 ads.example.com # comment')).toBe('ads.example.com');
    expect(parseHostsLine('127.0.0.1 tracker.example.com')).toBe('tracker.example.com');
    expect(parseHostsLine('0.0.0.0 localhost')).toBeNull();
    expect(parseHostsLine('# 0.0.0.0 ignored.example.com')).toBeNull();
  });

  it('extracts only plain domains for Android', () => {
    expect(domainFromNetworkFilter('||ads.example.com^$third-party')).toBe('ads.example.com');
    expect(domainFromNetworkFilter('*/advertising/*')).toBeNull();
  });
});
