/// <reference types="node" />
// The shipped ffmpeg must stay redistributable, and every licence the app ships must be found.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM build script
import { checkFlags } from '../scripts/ffmpeg-fetch.mjs';
// @ts-expect-error plain ESM build script
import { licenceText } from '../scripts/notices.mjs';

const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'scripts', 'ffmpeg-builds.json'), 'utf8'));

describe('licences', () => {
  it('rejects a nonfree ffmpeg build', () => {
    expect(checkFlags(new Set(['--enable-gpl', '--enable-libsrt', '--enable-libx264', '--enable-nonfree']))).toContain('--enable-nonfree (nicht weitergebbar)');
    expect(checkFlags(new Set(['--enable-gpl', '--enable-libsrt', '--enable-libx264']))).toEqual([]);
  });
  it('has a pinned build for every installer and the sources for the release', () => {
    for (const t of ['darwin-arm64', 'win32-x64', 'linux-x64']) expect(manifest.targets[t].files[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.sources.files.map((f: { name: string }) => f.name)).toContain('ffmpeg-9.0.2.tar.xz');
  });
  it('finds a licence text for packages without a licence file', () => {
    expect(licenceText(join(__dirname, '..', 'node_modules', 'onnxruntime-web')).text).toMatch(/MIT License/);
  });
  it('ships the licence texts the notices point to', () => {
    for (const f of ['GPL-3.0.txt', 'MPL-2.0-srt.txt', 'FFmpeg-LICENSE.md']) expect(existsSync(join(__dirname, '..', 'licenses', 'ffmpeg', f))).toBe(true);
  });
});
