import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compileCosmeticRules,
  compileNetworkRules,
  domainFromNetworkFilter,
  parseHostsLine
} from '../src/filter-parser.mjs';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCES = {
  easylist: 'https://raw.githubusercontent.com/easylist/easylist/master/easylist/easylist_general_block.txt',
  'easylist-cosmetic': 'https://raw.githubusercontent.com/easylist/easylist/master/easylist/easylist_general_hide.txt',
  easyprivacy: 'https://raw.githubusercontent.com/easylist/easylist/master/easyprivacy/easyprivacy_general.txt',
  hosts: 'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts'
};

function apiFallback(rawUrl) {
  const url = new URL(rawUrl);
  const [owner, repo, branch, ...file] = url.pathname.slice(1).split('/');
  return `https://api.github.com/repos/${owner}/${repo}/contents/${file.join('/')}?ref=${branch}`;
}

async function fetchList(name, url) {
  if (process.env.SHIELDAD_OFFLINE_FIXTURES === '1') {
    const fixture = path.join(ROOT, 'tools/fixtures', `${name}.txt`);
    console.log(`[offline] ${name}: ${fixture}`);
    return readFile(fixture, 'utf8');
  }
  const attempts = [
    { url, headers: { 'User-Agent': 'ShieldAd/1.0' } },
    { url: apiFallback(url), headers: { 'User-Agent': 'ShieldAd/1.0', Accept: 'application/vnd.github.raw+json' } }
  ];
  const errors = [];
  for (const attempt of attempts) {
    try {
      let text;
      try {
        const response = await fetch(attempt.url, { headers: attempt.headers, signal: AbortSignal.timeout(45000) });
        if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
        text = await response.text();
      } catch (fetchError) {
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

const [easylist, easylistCosmetic, easyprivacy, hosts] = await Promise.all(
  Object.entries(SOURCES).map(([name, url]) => fetchList(name, url))
);
const networkLines = `${easylist}\n${easyprivacy}`.split(/\r?\n/);
const cosmeticLines = `${easylist}\n${easylistCosmetic}\n${easyprivacy}`.split(/\r?\n/);
const rules = compileNetworkRules(networkLines, { limit: 29000 });
if (rules.length > 29999) throw new Error('Static ruleset exceeds the 30,000-rule budget');

const youtubeSelectors = [
  'ytd-ad-slot-renderer',
  'ytd-display-ad-renderer',
  '.ytd-promoted-sparkles-web-renderer',
  '.ytd-promoted-video-renderer',
  '.ytp-ad-player-overlay',
  '.ytp-ad-player-overlay-instream-info'
];
const cosmetic = compileCosmeticRules(cosmeticLines);
const youtube = new Set([...(cosmetic.domains['youtube.com'] || []), ...youtubeSelectors]);
cosmetic.domains['youtube.com'] = [...youtube].sort();

const domainSet = new Set();
for (const line of hosts.split(/\r?\n/)) {
  const domain = parseHostsLine(line);
  if (domain) domainSet.add(domain);
}
for (const line of networkLines) {
  const domain = domainFromNetworkFilter(line);
  if (domain) domainSet.add(domain);
}
const domains = [...domainSet].sort();

const output = [
  [path.join(ROOT, 'extension/rulesets/ads.json'), `${JSON.stringify(rules)}\n`],
  [path.join(ROOT, 'extension/cosmetic.json'), `${JSON.stringify(cosmetic)}\n`],
  [path.join(ROOT, 'android/app/src/main/assets/blocklist.txt'), `${domains.join('\n')}\n`]
];
await Promise.all(output.map(async ([filename, contents]) => {
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, contents);
}));

console.log(`Built ${rules.length.toLocaleString()} network rules, ${cosmetic.global.length.toLocaleString()} global cosmetic selectors, and ${domains.length.toLocaleString()} DNS domains.`);
