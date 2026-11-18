// Taken from lz-scopes (scripts/ffmpeg-fetch.mjs), same build and the same checks.
/**
 * Fetches the redistributable ffmpeg build of scripts/ffmpeg-builds.json into
 * vendor/ffmpeg/<target>/ and checks it:
 *   - SHA-256 of every download against the manifest
 *   - configure line: no --enable-nonfree, and libsrt and libx264 present
 *
 *   node scripts/ffmpeg-fetch.mjs                     host target (darwin-arm64, win32-x64, linux-x64)
 *   node scripts/ffmpeg-fetch.mjs win32-x64           any target, from any OS (no lipo needed)
 *   node scripts/ffmpeg-fetch.mjs --source            source archives (release assets) → vendor/ffmpeg/sources/
 *
 * Downloads are cached in vendor/ffmpeg/cache/. Research and licence duties:
 * https://github.com/larszu/lz-scopes/blob/main/docs/research/ffmpeg-lizenz.md
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'scripts', 'ffmpeg-builds.json'), 'utf8'));
const VENDOR = join(ROOT, 'vendor', 'ffmpeg');
const CACHE = join(VENDOR, 'cache');

/** vendor/ffmpeg/<target> for this machine (same rule as electron/sinks.cjs). */
export function hostTarget(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`;
}

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

async function download(url, sha) {
  mkdirSync(CACHE, { recursive: true });
  const file = join(CACHE, `${sha.slice(0, 12)}-${basename(new URL(url).pathname)}`);
  if (existsSync(file) && sha256(file) === sha) return file;
  console.log(`ffmpeg: lade ${url}`);
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  const got = sha256(file);
  if (got !== sha) { rmSync(file); throw new Error(`${url}: SHA-256 ${got}, erwartet ${sha}`); }
  return file;
}

function extract(archive, dir) {
  if (/\.tar\.xz$/.test(archive)) execFileSync('tar', ['-xJf', archive, '-C', dir]);
  // Windows: the system bsdtar reads zip; Git Bash's GNU tar (often first in PATH) does not
  else if (process.platform === 'win32') execFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', archive, '-C', dir]);
  else execFileSync('unzip', ['-q', '-o', archive, '-d', dir]);
}

/** Configure flags found in the binaries (the string is in ffmpeg itself or, shared, in avutil). */
export function configureFlags(files) {
  const flags = new Set();
  for (const f of files) {
    const text = readFileSync(f).toString('latin1');
    for (const m of text.matchAll(/--enable-[a-z0-9_-]+/g)) flags.add(m[0]);
  }
  return flags;
}

export function checkFlags(flags) {
  const problems = [];
  if (flags.has('--enable-nonfree')) problems.push('--enable-nonfree (nicht weitergebbar)');
  for (const need of ['--enable-gpl', '--enable-libsrt', '--enable-libx264']) if (!flags.has(need)) problems.push(`${need} fehlt`);
  return problems;
}

async function fetchTarget(target) {
  const spec = MANIFEST.targets[target];
  if (!spec) throw new Error(`unbekanntes Ziel ${target} (${Object.keys(MANIFEST.targets).join(', ')})`);
  const out = join(VENDOR, target);
  const stamp = JSON.stringify(spec);
  if (existsSync(join(out, 'BUILD.json')) && JSON.parse(readFileSync(join(out, 'BUILD.json'), 'utf8')).stamp === stamp) return out;
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const taken = [];
  for (const f of spec.files) {
    const archive = await download(f.url, f.sha256);
    const tmp = mkdtempSync(join(VENDOR, 'x-'));
    try {
      extract(archive, tmp);
      for (const [name, from] of Object.entries(f.take)) {
        if (name.includes('*')) {
          const dir = join(tmp, dirname(from)), re = new RegExp(`^${basename(from).replace(/\./g, '\\.').replace(/\*/g, '.*')}$`);
          const hits = readdirSync(dir).filter((n) => re.test(n));
          if (!hits.length) throw new Error(`${from} fehlt im Archiv`);
          for (const n of hits) { copyFileSync(join(dir, n), join(out, n)); taken.push(join(out, n)); }
        } else {
          if (!existsSync(join(tmp, from))) throw new Error(`${from} fehlt im Archiv`);
          copyFileSync(join(tmp, from), join(out, name));
          taken.push(join(out, name));
        }
      }
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  }
  for (const f of taken) chmodSync(f, 0o755);
  const problems = checkFlags(configureFlags(taken));
  if (problems.length) { rmSync(out, { recursive: true, force: true }); throw new Error(`${target}: ${problems.join(', ')}`); }
  writeFileSync(join(out, 'BUILD.json'), JSON.stringify({ target, version: spec.version, provider: spec.provider, page: spec.page, buildScript: spec.buildScript, files: spec.files.map((f) => ({ url: f.url, sha256: f.sha256 })), stamp }, null, 2));
  console.log(`ffmpeg ${spec.version} (${target}) → ${out}`);
  return out;
}

export async function fetchFfmpeg(target = hostTarget()) {
  return fetchTarget(target);
}

/** All source archives of MANIFEST.sources into vendor/ffmpeg/sources/ (for the release). */
export async function fetchSources() {
  const out = join(VENDOR, 'sources');
  rmSync(out, { recursive: true, force: true }); // no stale archives of an earlier build in the release
  mkdirSync(out, { recursive: true });
  for (const s of MANIFEST.sources.files) {
    const dest = join(out, s.name);
    if (s.sha256) { copyFileSync(await download(s.url, s.sha256), dest); continue; }
    console.log(`ffmpeg: lade ${s.url}`);
    const r = await fetch(s.url, { redirect: 'follow' });
    if (!r.ok) throw new Error(`${s.url}: HTTP ${r.status}`);
    writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
  }
  console.log(`Quelltext → ${out}`);
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  try {
    if (args.includes('--source')) await fetchSources();
    const targets = args.filter((a) => !a.startsWith('--'));
    if (!args.includes('--source') || targets.length) for (const t of targets.length ? targets : [hostTarget()]) await fetchFfmpeg(t);
  } catch (e) {
    console.error(`ffmpeg-fetch: ${e.message}`);
    process.exit(1);
  }
}
