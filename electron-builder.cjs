// electron-builder config. Signing turns on automatically when CSC_LINK + CSC_KEY_PASSWORD
// are set; without them the build is unsigned. The packaged package.json must not say
// `type: module` (the CommonJS entry would not load) – extraMetadata sets commonjs.
module.exports = {
  appId: 'de.zumpelars.lzroomframe',
  productName: 'LZ Room Frame',
  copyright: `Copyright © ${new Date().getFullYear()} Lars Zumpe`,
  directories: { output: 'release', buildResources: 'build' },
  files: ['dist/**/*', 'electron/**/*', 'helpers/bin/**/*', 'package.json'],
  extraMetadata: { type: 'commonjs', main: 'electron/main.cjs' },
  // helpers and ffmpeg must be real files outside the archive to be started
  asarUnpack: ['helpers/bin/**', '**/node_modules/ffmpeg-static/**'],
  npmRebuild: false,
  extraResources: [{ from: 'docs/integrations', to: 'integrations' }],
  mac: {
    category: 'public.app-category.video',
    target: [{ target: 'dmg' }, { target: 'zip' }],
    hardenedRuntime: true,
    extendInfo: {
      NSCameraUsageDescription: 'LZ Room Frame rahmt die Personen im Kamerabild.',
      NSMicrophoneUsageDescription: 'Das Raummikrofon hilft zu erkennen, wer spricht.',
      NSLocalNetworkUsageDescription: 'Steuerung durch Crestron, Q-SYS und NDI im lokalen Netz.',
    },
  },
  win: { target: [{ target: 'nsis', arch: ['x64'] }] },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true, perMachine: false },
  linux: { target: [{ target: 'AppImage' }, { target: 'deb' }], category: 'AudioVideo', maintainer: 'Lars Zumpe' },
  publish: [{ provider: 'github', owner: 'larszu', repo: 'lz-room-frame', releaseType: 'draft' }],
};
