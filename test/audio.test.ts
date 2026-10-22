import { describe, expect, it } from 'vitest';
import { fitLine, flatness, gccPhat, ildDb, panToX, stereoPan, voiceLike } from '../src/engine/audio';
import { fuseSpeaking } from '../src/engine/speaker';
import type { Person } from '../src/engine/types';

let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
const noise = (n: number) => Float32Array.from({ length: n }, rnd);
/** voice-like: harmonics of 140 Hz with a little noise */
const voice = (n: number, sr = 48000) => Float32Array.from({ length: n }, (_, i) => [1, 2, 3, 4, 5, 6].reduce((s, h) => s + Math.sin((2 * Math.PI * 140 * h * i) / sr) / h, 0) * 0.3 + rnd() * 0.01);

describe('stereo direction', () => {
  it('GCC-PHAT finds the delay and its sign (left first → positive)', () => {
    const src = noise(2048 + 40);
    const d = 12;
    const L = src.slice(d, d + 2048), R = src.slice(0, 2048); // R lags L by d samples
    const g = gccPhat(L, R, 38);
    expect(g.lag).toBe(d);
    expect(g.peak).toBeGreaterThan(0.3);
    expect(gccPhat(R, L, 38).lag).toBe(-d);
  });
  it('level difference: louder left is positive dB and pans left', () => {
    const s = noise(2048);
    const L = s.map((v) => v * 1), R = s.map((v) => v * 0.5);
    expect(ildDb(L, R)).toBeCloseTo(6.02, 1);
    expect(stereoPan(ildDb(L, R), 0, 38, 0)).toBeLessThan(0);
    expect(stereoPan(-ildDb(L, R), 0, 38, 0)).toBeGreaterThan(0);
  });
  it('time difference pans the same way as level', () => {
    expect(stereoPan(0, 30, 38, 1)).toBeLessThan(0);
    expect(stereoPan(0, -30, 38, 1)).toBeGreaterThan(0);
  });
  it('calibration line maps direction to the picture, swap mirrors it', () => {
    const line = fitLine([{ pan: -0.4, x: 0.2 }, { pan: 0.4, x: 0.8 }])!;
    expect(panToX(0, line, 1, false)).toBeCloseTo(0.5);
    expect(panToX(-0.4, line, 1, false)).toBeCloseTo(0.2);
    expect(panToX(0.4, null, 1, true)).toBeCloseTo(0.3);
    expect(fitLine([{ pan: 0.1, x: 0.5 }])).toBeNull();
  });
});

describe('voice activity', () => {
  it('voice is tonal, white noise is flat', () => {
    expect(flatness(voice(2048))).toBeLessThan(0.45);
    expect(flatness(noise(2048))).toBeGreaterThan(0.45);
    expect(voiceLike(0.1, 0.02, flatness(noise(2048)))).toBe(false);
    expect(voiceLike(0.1, 0.02, flatness(voice(2048)))).toBe(true);
  });
});

describe('fusion', () => {
  const p = (id: number, x: number): Person => ({ id, body: { x, y: 0, w: 100, h: 300 }, head: { x, y: 0, w: 60, h: 80 }, faceSeen: true, firstSeen: 0, lastSeen: 0, hits: 3, speaking: 0 });
  it('stereo direction alone picks the person on that side', () => {
    const ps = [p(1, 200), p(2, 1600)];
    for (let i = 0; i < 4; i++) fuseSpeaking(ps, new Map(), true, 0.85, 1920, 0.5, 0.12);
    expect(ps[1].speaking).toBeGreaterThan(0.5);
    expect(ps[0].speaking).toBeLessThan(0.1);
  });
  it('mono: lips decide; silence fades', () => {
    const ps = [p(1, 200), p(2, 1600)];
    for (let i = 0; i < 4; i++) fuseSpeaking(ps, new Map([[1, 0.9], [2, 0.05]]), true, null, 1920, 0.5, 0.12);
    expect(ps[0].speaking).toBeGreaterThan(0.5);
    const before = ps[0].speaking;
    fuseSpeaking(ps, new Map(), false, null, 1920, 0.5, 0.12);
    expect(ps[0].speaking).toBeLessThan(before);
  });
});
