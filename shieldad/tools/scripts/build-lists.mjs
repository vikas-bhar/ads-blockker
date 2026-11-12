import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compileCosmeticRules,
  compileScriptlets,
  compileStaticRulesets,
  domainFromNetworkFilter,
  parseHostsLine
} from '../src/filter-parser.mjs';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EASYLIST = 'https://raw.githubusercontent.com/easylist/easylist/master';
const UASSETS = 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master';

const SOURCES = {
  easylist: `${EASYLIST}/easylist/easylist_general_block.txt`,
  'easylist-dimensions': `${EASYLIST}/easylist/easylist_general_block_dimensions.txt`,
  'easylist-adservers': `${EASYLIST}/easylist/easylist_adservers.txt`,
  'easylist-specific': `${EASYLIST}/easylist/easylist_specific_block.txt`,
  'easylist-thirdparty': `${EASYLIST}/easylist/easylist_thirdparty.txt`,
  'easylist-allowlist': `${EASYLIST}/easylist/easylist_allowlist.txt`,
  'easylist-allowlist-dimensions': `${EASYLIST}/easylist/easylist_allowlist_dimensions.txt`,
  'easylist-cosmetic': `${EASYLIST}/easylist/easylist_general_hide.txt`,
  'easylist-specific-cosmetic': `${EASYLIST}/easylist/easylist_specific_hide.txt`,
  'easylist-cosmetic-allowlist': `${EASYLIST}/easylist/easylist_allowlist_general_hide.txt`,
  easyprivacy: `${EASYLIST}/easyprivacy/easyprivacy_general.txt`,
  'easyprivacy-specific': `${EASYLIST}/easyprivacy/easyprivacy_specific.txt`,
  'easyprivacy-thirdparty': `${EASYLIST}/easyprivacy/easyprivacy_thirdparty.txt`,
  'easyprivacy-trackingservers': `${EASYLIST}/easyprivacy/easyprivacy_trackingservers.txt`,
  'easyprivacy-trackingservers-general': `${EASYLIST}/easyprivacy/easyprivacy_trackingservers_general.txt`,
  'easyprivacy-trackingservers-thirdparty': `${EASYLIST}/easyprivacy/easyprivacy_trackingservers_thirdparty.txt`,
  'easyprivacy-allowlist': `${EASYLIST}/easyprivacy/easyprivacy_allowlist.txt`,
  'uassets-filters': `${UASSETS}/filters/filters.txt`,
  'uassets-2020': `${UASSETS}/filters/filters-2020.txt`,
  'uassets-2021': `${UASSETS}/filters/filters-2021.txt`,
  'uassets-2022': `${UASSETS}/filters/filters-2022.txt`,
  'uassets-2023': `${UASSETS}/filters/filters-2023.txt`,
  'uassets-2024': `${UASSETS}/filters/filters-2024.txt`,
  'uassets-2025': `${UASSETS}/filters/filters-2025.txt`,
  'uassets-2026': `${UASSETS}/filters/filters-2026.txt`,
  'uassets-general': `${UASSETS}/filters/filters-general.txt`,
  'uassets-mobile': `${UASSETS}/filters/filters-mobile.txt`,
  'uassets-privacy': `${UASSETS}/filters/privacy.txt`,
  'uassets-removeparam': `${UASSETS}/filters/privacy-removeparam.txt`,
  'uassets-badware': `${UASSETS}/filters/badware.txt`,
  'uassets-resource-abuse': `${UASSETS}/filters/resource-abuse.txt`,
  'uassets-quick-fixes': `${UASSETS}/filters/quick-fixes.txt`,
  'uassets-unbreak': `${UASSETS}/filters/unbreak.txt`,
  'uassets-ubol': `${UASSETS}/filters/ubol-filters.txt`,
  'pgl-serverlist': `${UASSETS}/thirdparties/pgl.yoyo.org/as/serverlist`,
  hosts: 'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts'
};

const UASSETS_SOURCES = [
  'uassets-filters', 'uassets-2020', 'uassets-2021', 'uassets-2022', 'uassets-2023',
  'uassets-2024', 'uassets-2025', 'uassets-2026', 'uassets-general', 'uassets-mobile',
  'uassets-privacy', 'uassets-removeparam', 'uassets-badware', 'uassets-resource-abuse',
  'uassets-quick-fixes', 'uassets-unbreak', 'uassets-ubol'
];
const HOSTS_SOURCES = ['hosts', 'pgl-serverlist'];

const PRIORITY_NETWORK_SOURCES = [
  'easylist', 'easylist-dimensions', 'easylist-specific', 'easylist-thirdparty',
  'easylist-allowlist', 'easylist-allowlist-dimensions', 'easyprivacy', 'easyprivacy-specific',
  'easyprivacy-thirdparty', 'easyprivacy-trackingservers', 'easyprivacy-trackingservers-general',
  'easyprivacy-trackingservers-thirdparty', 'easyprivacy-allowlist',
  ...UASSETS_SOURCES
];

const NETWORK_SOURCES = [...PRIORITY_NETWORK_SOURCES, 'easylist-adservers'];
const COSMETIC_SOURCES = ['easylist-cosmetic', 'easylist-specific-cosmetic', 'easylist-cosmetic-allowlist'];
const MAX_DOMAIN_CHUNKS = 8;

function apiFallback(rawUrl) {
  const url = new URL(rawUrl);
  const [owner, repo, branch, ...file] = url.pathname.slice(1).split('/');
  return `https://api.github.com/repos/${owner}/${repo}/contents/${file.join('/')}?ref=${branch}`;
}

async function fetchList(name, url) {
  if (process.env.SHIELDAD_OFFLINE_FIXTURES === '1') {
    const fixture = path.join(ROOT, 'tools/fixtures', `${name}.txt`);
    try {
      const text = await readFile(fixture, 'utf8');
      console.log(`[offline] ${name}: ${fixture}`);
      return text;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return '! Optional component is not needed by the deterministic fixture set.\n';
    }
  }
  const attempts = [
    { url, headers: { 'User-Agent': 'ShieldAd/1.2' } },
    { url: apiFallback(url), headers: { 'User-Agent': 'ShieldAd/1.2', Accept: 'application/vnd.github.raw+json' } }
  ];
  const errors = [];
  for (const attempt of attempts) {
    try {
      let text;
      try {
        const response = await fetch(attempt.url, { headers: attempt.headers, signal: AbortSignal.timeout(45000) });
        if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
        text = await response.text();
      } catch {
        const headers = Object.entries(attempt.headers).flatMap(([key, value]) => ['-H', `${key}: ${value}`]);
        const { stdout } = await execFileAsync('curl', ['-fsSL', '--max-time', '45', ...headers, attempt.url], {
          encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, windowsHide: true
        });
        text = stdout;
      }
      if (text.length < 20) throw new Error('Downloaded list is unexpectedly small');
      console.log(`${name}: ${text.length.toLocaleString()} bytes from ${new URL(attempt.url).hostname}`);
      return text;
    } catch (error) {
      errors.push(`${attempt.url}: ${error.message}`);
    }
  }
  throw new Error(`Unable to download ${name}.\n${errors.join('\n')}`);
}

const downloaded = Object.fromEntries(await Promise.all(
  Object.entries(SOURCES).map(async ([name, url]) => [name, await fetchList(name, url)])
));
const linesFor = (names) => names.flatMap((name) => downloaded[name].split(/\r?\n/));
const priorityNetworkLines = linesFor(PRIORITY_NETWORK_SOURCES);
const adserverLines = downloaded['easylist-adservers'].split(/\r?\n/);
const networkLines = linesFor(NETWORK_SOURCES);
const uAssetsLines = linesFor(UASSETS_SOURCES);
const cosmeticLines = [...networkLines, ...linesFor(COSMETIC_SOURCES)];

const hostsDomains = [];
for (const sourceName of HOSTS_SOURCES) {
  for (const line of downloaded[sourceName].split(/\r?\n/)) {
    const parsed = parseHostsLine(line);
    if (parsed) hostsDomains.push(parsed);
  }
}

const { ads: rules, domainChunks, stats } = compileStaticRulesets({
  priorityNetworkLines,
  adserverLines,
  hostsDomains,
  perRulesetLimit: 29000,
  maxDomainChunks: MAX_DOMAIN_CHUNKS,
  maxRegexRules: 700
});
if (rules.length > 29999) throw new Error('Main static ruleset exceeds the 30,000-rule budget');

// YouTube support hides ad slots and promotional containers only without altering playback.
const youtubeSelectors = [
  'ytd-ad-slot-renderer',
  'ad-slot-renderer',
  'ytw-ad-slot-renderer',
  'ytd-in-feed-ad-layout-renderer',
  'ytd-display-ad-renderer',
  'ytd-banner-promo-renderer',
  'ytd-banner-promo-renderer-background',
  'ytd-statement-banner-renderer',
  'ytd-video-masthead-ad-v3-renderer',
  'ytd-primetime-promo-renderer',
  'ytd-brand-video-shelf-renderer',
  'ytd-brand-video-singleton-renderer',
  'ytd-companion-slot-renderer',
  'ytd-action-companion-ad-renderer',
  'ytd-player-legacy-desktop-watch-ads-renderer',
  'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]',
  'ytd-promoted-sparkles-text-search-renderer',
  'ytd-promoted-sparkles-web-renderer',
  'ytd-search-pyv-renderer',
  '.ytd-promoted-sparkles-web-renderer',
  '.ytd-promoted-video-renderer',
  'ytd-rich-item-renderer:has(> #content > ytd-ad-slot-renderer)',
  'ytd-rich-item-renderer:has(ytd-ad-slot-renderer)',
  'ytd-rich-section-renderer:has(ytd-statement-banner-renderer)',
  'ytd-rich-section-renderer:has(ytd-ad-slot-renderer)',
  'ytd-rich-section-renderer:has(ytd-brand-video-singleton-renderer)',
  'ytd-rich-section-renderer:has(ytd-banner-promo-renderer-background)',
  'ytd-reel-video-renderer:has(ytd-ad-slot-renderer)',
  'grid-shelf-view-model:has(ytd-ad-slot-renderer)',
  'ytd-item-section-renderer:has(> #contents > ytd-ad-slot-renderer:only-child)',
  'yt-mealbar-promo-renderer',
  'ytd-popup-container > tp-yt-paper-dialog:has(yt-mealbar-promo-renderer)',
  '#masthead-ad',
  '#player-ads ytd-player-legacy-desktop-watch-ads-renderer',
  '#player-ads ytd-ad-slot-renderer',
  '#player-ads ytd-companion-slot-renderer',
  '.ytp-ad-overlay-container',
  '.ytp-ad-text-overlay',
  '.ytp-ad-image-overlay',
  '.ytp-ad-action-interstitial',
  '.ytp-ad-avatar-lockup-card',
  '.ytp-ad-feedback-dialog-renderer',
  '.ytp-ad-info-dialog-renderer',
  '.ytp-ad-survey',
  '.ytp-suggested-action > .ytp-suggested-action-badge',
  '.ytp-paid-content-overlay',
  '#shopping-timely-shelf',
  '#sticker-layer',
  'yt-overlay-product-sticker',
  'feed-ad-metadata-view-model',
  'ad-badge-view-model'
];
const mobileYoutubeSelectors = [
  'ytm-ad-slot-renderer',
  'ad-slot-renderer',
  'ytm-promoted-sparkles-web-renderer',
  'ytm-companion-slot',
  'ytm-companion-ad-renderer',
  'ytm-rich-item-renderer:has(ad-slot-renderer)',
  'lazy-list > ad-slot-renderer'
];

const cosmetic = compileCosmeticRules(cosmeticLines);
cosmetic.exceptions['youtube.com'] = [
  ...new Set([
    ...(cosmetic.exceptions['youtube.com'] || []),
    '#player-ads',
    '.video-ads',
    '.ytp-ad-player-overlay',
    '.ytp-ad-player-overlay-layout'
  ])
].sort();
cosmetic.domains['youtube.com'] = [...new Set([...(cosmetic.domains['youtube.com'] || []), ...youtubeSelectors])].sort();
cosmetic.domains['m.youtube.com'] = [...new Set([...(cosmetic.domains['m.youtube.com'] || []), ...mobileYoutubeSelectors])].sort();

const scriptlets = compileScriptlets(uAssetsLines);
const scriptletsDataJs = `globalThis.__shieldadScriptletData = ${JSON.stringify(scriptlets)};\n`;

const domainSet = new Set(hostsDomains);
for (const line of networkLines) {
  const d = domainFromNetworkFilter(line);
  if (d) domainSet.add(d);
}
const domains = [...domainSet].sort();

const rulesetNames = Array.from({ length: MAX_DOMAIN_CHUNKS }, (_, index) => (
  index === 0 ? 'domains.json' : `domains_${index + 1}.json`
));

const output = [
  [path.join(ROOT, 'extension/rulesets/ads.json'), `${JSON.stringify(rules)}\n`],
  [path.join(ROOT, 'extension/cosmetic.json'), `${JSON.stringify(cosmetic)}\n`],
  [path.join(ROOT, 'extension/scriptlets-data.js'), scriptletsDataJs],
  [path.join(ROOT, 'android/app/src/main/assets/blocklist.txt'), `${domains.join('\n')}\n`]
];

await mkdir(path.join(ROOT, 'extension/rulesets'), { recursive: true });
for (let index = 0; index < rulesetNames.length; index += 1) {
  const target = path.join(ROOT, 'extension/rulesets', rulesetNames[index]);
  if (domainChunks[index]?.length) {
    output.push([target, `${JSON.stringify(domainChunks[index])}\n`]);
  } else {
    await rm(target, { force: true });
  }
}

await Promise.all(output.map(async ([filename, contents]) => {
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, contents);
}));

const totalDomainChunkRules = domainChunks.reduce((sum, chunk) => sum + chunk.length, 0);
console.log(
  `Built ${rules.length.toLocaleString()} core rules (${stats.exceptions} allow, ${stats.redirects} redirect, ` +
  `${stats.cspRules} csp, ${stats.removeparams} removeparam, ${stats.regexRules} regex, ` +
  `${stats.conditionalDomains} conditional, ${stats.urlRules} url), ` +
  `${totalDomainChunkRules.toLocaleString()} extra rules across ${domainChunks.length} rulesets, ` +
  `${cosmetic.global.length.toLocaleString()} global + ${Object.keys(cosmetic.procedural).length.toLocaleString()} procedural domains, ` +
  `${Object.keys(scriptlets.domains).length.toLocaleString()} non-YT scriptlet domains, ` +
  `and ${domains.length.toLocaleString()} DNS domains.`
);
