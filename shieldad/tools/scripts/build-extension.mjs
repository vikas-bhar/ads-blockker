import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE = path.join(ROOT, 'extension');
const DIST = path.join(ROOT, 'dist');
const FILES = ['background.js', 'background.html', 'content.js', 'custom-rules.js', 'popup.html', 'popup.css', 'popup.js', 'options.html', 'options.css', 'options.js', 'cosmetic.json'];

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}
function icon(size) {
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 4); row[0] = 0;
    for (let x = 0; x < size; x += 1) {
      const nx = (x + .5) / size; const ny = (y + .5) / size;
      const width = ny < .23 ? .37 : .37 * Math.max(0, 1 - (ny - .23) / .72);
      const shield = ny >= .07 && ny <= .92 && Math.abs(nx - .5) <= width;
      const checkA = Math.abs(ny - (.48 + (nx - .31) * .72)) < .045 && nx >= .29 && nx <= .47;
      const checkB = Math.abs(ny - (.66 - (nx - .47) * .9)) < .045 && nx >= .44 && nx <= .73;
      const offset = 1 + x * 4;
      if (shield && (checkA || checkB)) { row[offset] = 255; row[offset + 1] = 255; row[offset + 2] = 255; row[offset + 3] = 255; }
      else if (shield) { row[offset] = 19; row[offset + 1] = 122; row[offset + 2] = 77; row[offset + 3] = 255; }
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

const rules = JSON.parse(await readFile(path.join(SOURCE, 'rulesets/ads.json'), 'utf8'));
if (!Array.isArray(rules) || !rules.length || rules.length > 29999) throw new Error('Run npm run build-lists first; ads.json must contain 1–29,999 rules');
if (new Set(rules.map((rule) => rule.id)).size !== rules.length) throw new Error('Duplicate DNR rule IDs');
await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });
await mkdir(path.join(SOURCE, 'icons'), { recursive: true });
for (const size of [16, 32, 48, 128]) await writeFile(path.join(SOURCE, `icons/icon-${size}.png`), icon(size));

for (const browser of ['chrome', 'firefox']) {
  const target = path.join(DIST, `shieldad-${browser}`);
  await mkdir(path.join(target, 'rulesets'), { recursive: true });
  await mkdir(path.join(target, 'icons'), { recursive: true });
  for (const file of FILES) await copyFile(path.join(SOURCE, file), path.join(target, file));
  await copyFile(path.join(ROOT, 'tools/src/filter-parser.mjs'), path.join(target, 'filter-parser.js'));
  await copyFile(path.join(SOURCE, 'rulesets/ads.json'), path.join(target, 'rulesets/ads.json'));
  for (const size of [16, 32, 48, 128]) await copyFile(path.join(SOURCE, `icons/icon-${size}.png`), path.join(target, `icons/icon-${size}.png`));
  const manifest = await readFile(path.join(SOURCE, `manifest.${browser}.json`), 'utf8');
  JSON.parse(manifest);
  await writeFile(path.join(target, 'manifest.json'), manifest);
  const archive = path.join(DIST, `shieldad-${browser}-1.0.0.zip`);
  const zipped = spawnSync('zip', ['-q', '-r', archive, '.'], { cwd: target, stdio: 'inherit' });
  if (zipped.status !== 0) throw new Error(`Could not package ${browser} extension`);
  console.log(`Built ${target} and ${archive}`);
}
