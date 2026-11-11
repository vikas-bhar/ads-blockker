import { describe, expect, it } from '@jest/globals';
import {
  compileCosmeticRules,
  compileDomainRuleChunks,
  compileDomainRules,
  compileNetworkRules,
  compileStaticRulesets,
  domainFromNetworkFilter,
  hostMatches,
  isValidDnrRule,
  normalizeDomainEntry,
  parseCosmeticControlFilter,
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

  it('ranks $important block rules above normal @@ exceptions', () => {
    const blockImportant = parseNetworkFilter('||forced-ad.example.com^$important');
    const allowNormal = parseNetworkFilter('@@||forced-ad.example.com^');
    const allowImportant = parseNetworkFilter('@@||forced-ad.example.com^$important');
    expect(blockImportant.priority).toBeGreaterThan(allowNormal.priority);
    expect(allowImportant.priority).toBeGreaterThan(blockImportant.priority);
  });

  it('parses option-only rules starting with $ when scoped by domain and rejects unscoped $ rules', () => {
    const scoped = parseNetworkFilter('$third-party,xmlhttprequest,domain=mega4upload.net');
    expect(scoped).toMatchObject({
      action: { type: 'block' },
      condition: {
        domainType: 'thirdParty',
        resourceTypes: ['xmlhttprequest'],
        initiatorDomains: ['mega4upload.net']
      }
    });
    expect(scoped.condition.urlFilter).toBeUndefined();

    expect(parseNetworkFilter('@@$generichide,domain=androidpolice.com|xda-developers.com')).toBeNull();
    expect(parseNetworkFilter('$third-party')).toBeNull();
    expect(parseNetworkFilter('@@$csp=script-src self,domain=example.com')).toBeNull();
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

  it('rejects comments, cosmetics, regex filters, non-ASCII, and unsupported modifiers', () => {
    for (const filter of ['! comment', 'example.com##.ad', '/ads\\/[0-9]+/', '||a.com^$redirect=noop', '||a.com^$badfilter', '||a.com/рeклама']) {
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

  it('validates DNR rules against browser constraints', () => {
    expect(isValidDnrRule({ id: 1, priority: 1, action: { type: 'block' }, condition: { requestDomains: ['ads.example.com'] } })).toBe(true);
    expect(isValidDnrRule({ id: 0, priority: 1, action: { type: 'block' }, condition: { requestDomains: ['ads.example.com'] } })).toBe(false);
    expect(isValidDnrRule({ id: 1, priority: 1, action: { type: 'allowAllRequests' }, condition: { requestDomains: ['example.com'], resourceTypes: ['script'] } })).toBe(false);
    expect(isValidDnrRule({ id: 1, priority: 1, action: { type: 'allowAllRequests' }, condition: { requestDomains: ['example.com'], resourceTypes: ['main_frame', 'sub_frame'] } })).toBe(true);
  });
});

describe('cosmetic, hosts, and multi-ruleset compilation', () => {
  it('parses global, child-combinator, and brand-wildcard cosmetic selectors', () => {
    expect(parseCosmeticFilter('##.advertisement')).toMatchObject({ selector: '.advertisement', domains: [] });
    expect(parseCosmeticFilter('##.ob_dual_right > .ob_ads_header ~ .odb_div')).toMatchObject({
      selector: '.ob_dual_right > .ob_ads_header ~ .odb_div',
      domains: []
    });
    expect(parseCosmeticFilter('cnn.com,tripadvisor.*,bad..domain##.ad')).toMatchObject({
      domains: ['cnn.com', 'tripadvisor.*'],
      selector: '.ad'
    });
    expect(parseCosmeticFilter('example.com,sub.example.com##.sponsor')).toMatchObject({ domains: ['example.com', 'sub.example.com'] });
  });

  it('matches exact, subdomain, and brand.* wildcard hosts safely', () => {
    expect(hostMatches('www.tripadvisor.co.uk', 'tripadvisor.*')).toBe(true);
    expect(hostMatches('tripadvisor.com', 'tripadvisor.*')).toBe(true);
    expect(hostMatches('tripadvisor.attacker.com', 'tripadvisor.*')).toBe(false);
    expect(hostMatches('not-tripadvisor.com', 'tripadvisor.*')).toBe(false);
  });

  it('compiles cosmetic exceptions, global #@#, generichide, and excludes procedural selectors', () => {
    const result = compileCosmeticRules([
      '##.ad', '##.removed-global', '#@#.removed-global',
      'example.com##.banner', 'example.com#@#.ad',
      '~global.example##.ad', 'mixed.example,~excluded.example##.mixed',
      '@@$generichide,domain=androidpolice.com|xda-developers.com',
      '@@||music.amazon.$generichide',
      '@@||safe-site.example^$elemhide',
      'bad.example##+js(alert)', 'bad.example##div:-abp-has(.ad)',
      'bad.example##div:has-text(Sponsored)'
    ], { generatedAt: 'now' });
    expect(result.global).toEqual(['.ad']);
    expect(result.domains['example.com']).toEqual(['.banner']);
    expect(result.exceptions['example.com']).toEqual(['.ad']);
    expect(result.exceptions['global.example']).toEqual(['.ad']);
    expect(result.domains['mixed.example']).toEqual(['.mixed']);
    expect(result.exceptions['excluded.example']).toEqual(['.mixed']);
    expect(result.generichide).toEqual(['androidpolice.com', 'music.amazon.*', 'xda-developers.com']);
    expect(result.elemhide).toEqual(['safe-site.example']);
    expect(parseCosmeticControlFilter('@@$generichide,domain=a.com')).toEqual({ type: 'generichide', domains: ['a.com'] });
  });

  it('compiles domain rules without redundant children regardless of order and rejects IPv4', () => {
    const rules = compileDomainRules([
      'sub.covered.com', 'ads.example.com', 'pixel.ads.example.com',
      'sub.tracker.test', 'tracker.test', 'tracker.test', 'localhost', '0.0.0.0', '0.0.0.1'
    ], { coveredDomains: ['covered.com'] });
    expect(rules.map((rule) => rule.condition.requestDomains[0])).toEqual(['ads.example.com', 'tracker.test']);
    expect(rules.map((rule) => rule.id)).toEqual([1, 2]);
  });

  it('splits large domain lists into ruleset chunks and preserves root coverage in core rules', () => {
    const chunks = compileDomainRuleChunks(['a.example', 'b.example', 'c.example'], { chunkSize: 2, maxChunks: 2 });
    expect(chunks).toHaveLength(2);
    expect(chunks[0].map((r) => r.id)).toEqual([1, 2]);
    expect(chunks[1].map((r) => r.id)).toEqual([1]);

    const compiled = compileStaticRulesets({
      priorityNetworkLines: ['@@||safe.example^', '/ad-banner/*$script', '||tracker.example^$third-party'],
      adserverLines: ['||sub.adnet.com^', '||adnet.com^', '||taboola.com^', '||pubmatic.com^'],
      hostsDomains: ['0.0.0.0', 'sub.pubmatic.com', 'extra-host.example'],
      perRulesetLimit: 5,
      maxDomainChunks: 2
    });
    expect(compiled.ads).toHaveLength(5);
    expect(compiled.domainChunks.flat().map((r) => r.condition.requestDomains[0])).toEqual(['pubmatic.com', 'extra-host.example']);
  });

  it('reads hosts entries and ignores local addresses, IPv4 placeholders, and comments', () => {
    expect(parseHostsLine('0.0.0.0 ads.example.com # comment')).toBe('ads.example.com');
    expect(parseHostsLine('127.0.0.1 tracker.example.com')).toBe('tracker.example.com');
    expect(parseHostsLine('0.0.0.0 localhost')).toBeNull();
    expect(parseHostsLine('0.0.0.0 0.0.0.0')).toBeNull();
    expect(parseHostsLine('0.0.0.0 0.0.0.1')).toBeNull();
    expect(parseHostsLine('# 0.0.0.0 ignored.example.com')).toBeNull();
  });

  it('extracts domain names from URLs and bare hosts cleanly', () => {
    expect(normalizeDomainEntry('https://News.Example.com/article?a=1')).toBe('news.example.com');
    expect(normalizeDomainEntry('*.Example.org.')).toBe('example.org');
    expect(normalizeDomainEntry('0.0.0.0')).toBeNull();
  });

  it('extracts only plain domains for Android', () => {
    expect(domainFromNetworkFilter('||ads.example.com^$third-party')).toBe('ads.example.com');
    expect(domainFromNetworkFilter('*/advertising/*')).toBeNull();
  });
});
