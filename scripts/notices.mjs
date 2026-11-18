// Collects the licence texts of everything the app ships into vendor/legal/, which
// electron-builder puts into <resources>/legal (shown under Info → Lizenzen):
//   LICENSE                      the app's own (proprietary) licence
//   THIRD-PARTY-LICENSES.md      overview
//   THIRD-PARTY-NOTICES.txt      full texts: npm packages in the app (main process and the
//                                renderer bundle), models, NDI headers
//   LICENSE.electron.txt, LICENSES.chromium.html  added by electron-builder.cjs (afterExtract)
//   ffmpeg/                      GPL/LGPL/MPL/Apache texts of the bundled ffmpeg + source offer
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'vendor', 'legal');

// bundled into the renderer by Vite (devDependencies, but shipped as code)
const RENDERER = ['react', 'react-dom', 'scheduler', 'lucide-react', '@fontsource-variable/public-sans'];

/** Installed folders of the main process production tree (what electron-builder packs). */
function prodPackages() {
  const out = execFileSync('npm', ['ls', '--omit=dev', '--all', '--parseable'], { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' });
  return out.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && resolve(l) !== ROOT);
}

const MIT = (who) => `MIT License

Copyright (c) ${who}

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

const ISC = (who) => `ISC License

Copyright (c) ${who}

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`;

const APACHE = readFileSync(join(ROOT, 'licenses', 'models', 'Apache-2.0.txt'), 'utf8');

export function licenceText(dir) {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f));
  if (file) return { pkg, text: readFileSync(join(dir, file), 'utf8').trim() };
  const spdx = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type;
  const author = typeof pkg.author === 'string' ? pkg.author : pkg.author?.name;
  if (spdx === 'MIT') return { pkg, text: MIT(author || `the ${pkg.name} authors`) };
  if (spdx === 'ISC') return { pkg, text: ISC(author || `the ${pkg.name} authors`) };
  if (spdx === 'Apache-2.0') return { pkg, text: APACHE.trim() };
  throw new Error(`${pkg.name}: kein Lizenztext und unbekannte Lizenz ${spdx}`);
}

function build() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const dirs = [...new Set([...prodPackages(), ...RENDERER.map((n) => join(ROOT, 'node_modules', n))])];
  const seen = new Set();
  const parts = [`Third-party notices for LZ Room Frame\n${'='.repeat(38)}\n\nOverview: THIRD-PARTY-LICENSES.md. ffmpeg: folder ffmpeg/ (GPLv3, source offer in ffmpeg/SOURCE.txt).`];
  const entries = dirs.map((dir) => {
    if (!existsSync(join(dir, 'package.json'))) throw new Error(`${dir} fehlt`);
    return licenceText(dir);
  }).filter(({ pkg }) => { const k = `${pkg.name}@${pkg.version}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.pkg.name.localeCompare(b.pkg.name));
  for (const { pkg, text } of entries) {
    const spdx = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type ?? '';
    parts.push(`${'-'.repeat(78)}\n${pkg.name} ${pkg.version} (${spdx})${pkg.homepage ? `\n${pkg.homepage}` : ''}\n\n${text}`);
  }
  const models = join(ROOT, 'licenses', 'models');
  parts.push(`${'-'.repeat(78)}\nModels\n\n${readFileSync(join(models, 'README.txt'), 'utf8').trim()}\n\n${readFileSync(join(models, 'MIT-torchreid-osnet.txt'), 'utf8').trim()}\n\nApache License 2.0 (RTMO-s, MediaPipe Face Landmarker, MediaPipe Tasks Vision, ONNX Runtime models):\n\n${APACHE.trim()}`);
  parts.push(`${'-'.repeat(78)}\nFreeType (inside the prebuilt @julusian/freetype2 module, used by atem-connection)\n\nPortions of this software are copyright © The FreeType Project (https://freetype.org). All rights reserved.\nFreeType is used under the FreeType License (FTL), https://freetype.org/license.html.`);
  parts.push(`${'-'.repeat(78)}\nNDI SDK headers (helpers/ndi/ndi-min.h, used to build the NDI helper)\n\n${readFileSync(join(ROOT, 'helpers', 'ndi', 'ndi-sdk-headers-MIT.txt'), 'utf8').trim()}\n\nNDI® is a registered trademark of Vizrt NDI AB. The NDI runtime is not included; it is installed by the user from https://ndi.video.`);
  writeFileSync(join(OUT, 'THIRD-PARTY-NOTICES.txt'), `${parts.join('\n\n')}\n`);
  cpSync(join(ROOT, 'LICENSE'), join(OUT, 'LICENSE.txt'));
  cpSync(join(ROOT, 'THIRD-PARTY-LICENSES.md'), join(OUT, 'THIRD-PARTY-LICENSES.md'));
  cpSync(join(ROOT, 'licenses', 'ffmpeg'), join(OUT, 'ffmpeg'), { recursive: true });
  const manifest = JSON.parse(readFileSync(join(ROOT, 'scripts', 'ffmpeg-builds.json'), 'utf8'));
  const t = Object.values(manifest.targets)[0];
  writeFileSync(join(OUT, 'ffmpeg', 'SOURCE.txt'), `ffmpeg in LZ Room Frame: FFmpeg ${t.version}, ${t.provider}.
Licence: GNU General Public License version 3 (GPL-3.0.txt). ffmpeg runs as a separate program;
LZ Room Frame does not link it.

Corresponding source (GPLv3 section 6): every LZ Room Frame release on
https://github.com/larszu/lz-room-frame/releases carries the exact source archives and the build
script next to the installers. The same files are at ${t.page}
Build script: ${t.buildScript}

${manifest.sources.files.map((s) => `- ${s.name} (${s.for}) sha256 ${s.sha256}`).join('\n')}
`);
  console.log(`Lizenztexte: ${entries.length} Pakete → ${OUT}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) build();
