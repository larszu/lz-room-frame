// electron-builder config. Signing turns on automatically when CSC_LINK + CSC_KEY_PASSWORD
// are set; without them the build is unsigned. The packaged package.json must not say
// `type: module` (the CommonJS entry would not load) – extraMetadata sets commonjs.
const signed = Boolean(process.env.CSC_LINK);
const { copyFileSync, existsSync } = require('node:fs');
const path = require('node:path');

// ffmpeg is the GPLv3 build of scripts/ffmpeg-builds.json (scripts/ffmpeg-fetch.mjs), licence
// texts and notices come from scripts/notices.mjs. afterPack refuses a package without them:
// electron-builder would skip a missing folder silently and ship the app without its licences.
const FFMPEG = { mac: 'vendor/ffmpeg/darwin-arm64', win: 'vendor/ffmpeg/win32-x64', linux: 'vendor/ffmpeg/linux-x64' };
const resources = (os) => [
  { from: 'docs/integrations', to: 'integrations' },
  { from: FFMPEG[os], to: 'ffmpeg', filter: ['ffmpeg', 'ffmpeg.exe', 'BUILD-INFO.txt'] },
  { from: 'vendor/legal', to: 'legal' },
];

// Electron's own licence texts: on macOS they sit next to the .app in the extracted zip and are
// not part of the bundle, so they go into legal/ before the resources are copied.
function afterExtract(ctx) {
  for (const [from, to] of [['LICENSE', 'LICENSE.electron.txt'], ['LICENSE.electron.txt', 'LICENSE.electron.txt'], ['LICENSES.chromium.html', 'LICENSES.chromium.html']]) {
    const f = path.join(ctx.appOutDir, from);
    if (existsSync(f)) copyFileSync(f, path.join(__dirname, 'vendor', 'legal', to));
  }
}

function afterPack(ctx) {
  const res = ctx.electronPlatformName === 'darwin' ? path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`, 'Contents', 'Resources') : path.join(ctx.appOutDir, 'resources');
  const exe = ctx.electronPlatformName === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  for (const f of [path.join('ffmpeg', exe), path.join('legal', 'LICENSE.txt'), path.join('legal', 'THIRD-PARTY-NOTICES.txt'), path.join('legal', 'LICENSES.chromium.html'), path.join('legal', 'LICENSE.electron.txt'), path.join('legal', 'ffmpeg', 'GPL-3.0.txt'), path.join('legal', 'ffmpeg', 'SOURCE.txt')]) {
    if (!existsSync(path.join(res, f))) throw new Error(`${f} fehlt im Paket – zuerst node scripts/ffmpeg-fetch.mjs <ziel> und node scripts/notices.mjs`);
  }
}

module.exports = {
  appId: 'de.zumpelars.lzroomframe',
  productName: 'LZ Room Frame',
  copyright: `Copyright © ${new Date().getFullYear()} Lars Zumpe`,
  directories: { output: 'release', buildResources: 'build' },
  files: ['dist/**/*', 'electron/**/*', 'helpers/bin/**/*', '!helpers/bin/*.{obj,lib,exp}', 'package.json'],
  extraMetadata: { type: 'commonjs', main: 'electron/main.cjs' },
  // helpers and ffmpeg must be real files outside the archive to be started
  asarUnpack: ['helpers/bin/**'],
  npmRebuild: false,
  afterExtract,
  afterPack,
  mac: {
    extraResources: resources('mac'),
    category: 'public.app-category.video',
    target: [{ target: 'dmg' }, { target: 'zip' }],
    // without a certificate sign ad-hoc; an unsealed bundle is reported as damaged
    identity: signed ? undefined : '-',
    hardenedRuntime: signed,
    extendInfo: {
      NSCameraUsageDescription: 'LZ Room Frame rahmt die Personen im Kamerabild.',
      NSMicrophoneUsageDescription: 'Das Raummikrofon hilft zu erkennen, wer spricht.',
      NSLocalNetworkUsageDescription: 'Steuerung durch Crestron, Q-SYS und NDI im lokalen Netz.',
    },
  },
  win: { target: [{ target: 'nsis', arch: ['x64'] }], extraResources: resources('win') },
  nsis: { license: 'vendor/legal/LICENSE.txt', oneClick: false, allowToChangeInstallationDirectory: true, perMachine: false },
  linux: { extraResources: resources('linux'), target: [{ target: 'AppImage' }, { target: 'deb' }], category: 'AudioVideo', maintainer: 'Lars Zumpe' },
  // the virtual camera; the app loads it with one click (pkexec)
  deb: { recommends: ['v4l2loopback-dkms'] },
  publish: [{ provider: 'github', owner: 'larszu', repo: 'lz-room-frame', releaseType: 'draft' }],
};
