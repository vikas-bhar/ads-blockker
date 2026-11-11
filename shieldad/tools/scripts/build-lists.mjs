import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compileCosmeticRules,
  compileStaticRulesets,
  domainFromNetworkFilter,
  parseHostsLine
} from '../src/filter-parser.mjs';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EASYLIST = 'https://raw.githubusercontent.com/easylist/easylist/master';
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
  hosts: 'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts'
};
const PRIORITY_NETWORK_SOURCES = [
  'easylist', 'easylist-dimensions', 'easylist-specific', 'easylist-thirdparty',
  'easylist-allowlist', 'easylist-allowlist-dimensions', 'easyprivacy', 'easyprivacy-specific',
  'easyprivacy-thirdparty', 'easyprivacy-trackingservers', 'easyprivacy-trackingservers-general',
  'easyprivacy-trackingservers-thirdparty', 'easyprivacy-allowlist'
];
const NETWORK_SOURCES = [...PRIORITY_NETWORK_SOURCES, 'easylist-adservers'];
const COSMETIC_SOURCES = ['easylist-cosmetic', 'easylist-specific-cosmetic', 'easylist-cosmetic-allowlist'];

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
    { url, headers: { 'User-Agent': 'ShieldAd/1.1' } },
    { url: apiFallback(url), headers: { 'User-Agent': 'ShieldAd/1.1', Accept: 'application/vnd.github.raw+json' } }
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
        // Some CI images provide a custom CA to curl but not to Node. curl uses the
        // system trust store and provides an equivalent, timeout-bounded transport.
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
const cosmeticLines = [...networkLines, ...linesFor(COSMETIC_SOURCES)];

const hostsDomains = [];
for (const line of downloaded.hosts.split(/\r?\n/)) {
  const parsed = parseHostsLine(line);
  if (parsed) hostsDomains.push(parsed);
}

const { ads: rules, domainChunks, stats } = compileStaticRulesets({
  priorityNetworkLines,
  adserverLines,
  hostsDomains,
  perRulesetLimit: 29000,
  maxDomainChunks: 3
});
if (rules.length > 29999) throw new Error('Main static ruleset exceeds the 30,000-rule budget');

const youtubeSelectors = [
  'ytd-ad-slot-renderer',
  'ytd-in-feed-ad-layout-renderer',
  'ytd-display-ad-renderer',
  'ytd-banner-promo-renderer',
  'ytd-statement-banner-renderer',
  'ytd-video-masthead-ad-v3-renderer',
  'ytd-primetime-promo-renderer',
  'ytd-companion-slot-renderer',
  'ytd-action-companion-ad-renderer',
  'ytd-promoted-sparkles-text-search-renderer',
  'ytd-search-pyv-renderer',
  '.ytd-promoted-sparkles-web-renderer',
  '.ytd-promoted-video-renderer',
  '.ytp-ad-player-overlay',
  '.ytp-ad-player-overlay-instream-info',
  '#masthead-ad',
  '#player-ads'
];
const cosmetic = compileCosmeticRules(cosmeticLines);
const youtube = new Set([...(cosmetic.domains['youtube.com'] || []), ...youtubeSelectors]);
cosmetic.domains['youtube.com'] = [...youtube].sort();

const domainSet = new Set(hostsDomains);
for (const line of networkLines) {
  const d = domainFromNetworkFilter(line);
  if (d) domainSet.add(d);
}
const domains = [...domainSet].sort();

const domainFiles = ['domains.json', 'domains_2.json', 'domains_3.json'].map((filename, index) => [
  path.join(ROOT, 'extension/rulesets', filename),
  `${JSON.stringify(domainChunks[index] || [])}\n`
]);

const output = [
  [path.join(ROOT, 'extension/rulesets/ads.json'), `${JSON.stringify(rules)}\n`],
  ...domainFiles,
  [path.join(ROOT, 'extension/cosmetic.json'), `${JSON.stringify(cosmetic)}\n`],
  [path.join(ROOT, 'android/app/src/main/assets/blocklist.txt'), `${domains.join('\n')}\n`]
];
await Promise.all(output.map(async ([filename, contents]) => {
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, contents);
}));

const totalDomainChunkRules = domainChunks.reduce((sum, chunk) => sum + chunk.length, 0);
console.log(
  `Built ${rules.length.toLocaleString()} core rules (${stats.exceptions} allow, ${stats.conditionalDomains} conditional, ${stats.urlRules} url), ` +
  `${totalDomainChunkRules.toLocaleString()} extra domain rules across ${domainChunks.length} rulesets, ` +
  `${cosmetic.global.length.toLocaleString()} global cosmetic selectors (${cosmetic.generichide.length} generichide), ` +
  `and ${domains.length.toLocaleString()} DNS domains.`
);
