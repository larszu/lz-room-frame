import { describe, expect, it } from 'vitest';
import { ssBoxFor, toRaw, FRAME_W } from '../src/engine/atem';
import { DEFAULT_PTZ, ptzAim, ptzDrive, viscaPackets } from '../src/engine/ptz';
import type { Person } from '../src/engine/types';

const W = 1920, H = 1080;
const person = (x: number, y: number, h = 100): Person => ({ id: 1, body: { x, y, w: h, h: h * 4 }, head: { x, y, w: h * 0.8, h }, faceSeen: true, firstSeen: 0, lastSeen: 0, hits: 3, speaking: 0 });

describe('ptz', () => {
  it('keeps still when the target is centred and sized', () => {
    const shotH = 100 * 5; // medium
    const p = person(W / 2 - 40, H / 2 - shotH / 2 + DEFAULT_PTZ.headroom * shotH, 100);
    const d = ptzDrive(ptzAim([p], { ...DEFAULT_PTZ, shot: 'medium' }, null), W, H, { ...DEFAULT_PTZ, zoom: false });
    expect(d).toEqual({ pan: 0, tilt: 0, zoom: 0 });
  });
  it('pans right towards a person on the right, never faster than maxSpeed', () => {
    const d = ptzDrive(ptzAim([person(1800, 400)], DEFAULT_PTZ, null), W, H, DEFAULT_PTZ);
    expect(d.pan).toBeGreaterThan(0);
    expect(d.pan).toBeLessThanOrEqual(DEFAULT_PTZ.maxSpeed);
  });
  it('zooms in on a small centred person, out when the target is too big', () => {
    expect(ptzDrive({ x: W / 2, y: H / 2, h: H * 0.3 }, W, H, DEFAULT_PTZ).zoom).toBeGreaterThan(0);
    expect(ptzDrive({ x: W / 2, y: H / 2, h: H * 1.6 }, W, H, DEFAULT_PTZ).zoom).toBeLessThan(0);
  });
  it('stops without a target', () => {
    expect(ptzDrive(null, W, H, DEFAULT_PTZ)).toEqual({ pan: 0, tilt: 0, zoom: 0 });
  });
  it('VISCA bytes: pan right / tilt up, zoom tele, stop', () => {
    const [pt, z] = viscaPackets({ pan: 1, tilt: 0.5, zoom: 1 });
    expect(pt).toEqual([0x81, 0x01, 0x06, 0x01, 0x18, 0x0a, 0x02, 0x01, 0xff]);
    expect(z).toEqual([0x81, 0x01, 0x04, 0x07, 0x27, 0xff]);
    const [s, zs] = viscaPackets({ pan: 0, tilt: 0, zoom: 0 });
    expect(s.slice(6, 8)).toEqual([0x03, 0x03]);
    expect(zs[4]).toBe(0x00);
  });
});

describe('atem supersource box', () => {
  it('full picture at size 1 sits centred with no crop', () => {
    const b = ssBoxFor({ x: 0, y: 0, w: W, h: H }, W, H, { boxX: 0, boxY: 0, boxWidth: 32 });
    expect(b).toMatchObject({ x: 0, y: 0, size: 1, cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0 });
  });
  it('a quarter crop shows at native size with its visible centre where asked', () => {
    const crop = { x: 960, y: 0, w: 480, h: 270 }; // right of centre, top
    const s = { boxX: 8, boxY: -4.5, boxWidth: 8 };
    const b = ssBoxFor(crop, W, H, s);
    expect(b.size).toBe(1);
    const visibleW = (FRAME_W - b.cropLeft - b.cropRight) * b.size;
    expect(visibleW).toBeCloseTo(8);
    expect(b.x + ((b.cropLeft - b.cropRight) / 2) * b.size).toBeCloseTo(8);
    expect(b.y + ((b.cropBottom - b.cropTop) / 2) * b.size).toBeCloseTo(-4.5);
  });
  it('never enlarges and converts to protocol units', () => {
    const b = ssBoxFor({ x: 900, y: 500, w: 192, h: 108 }, W, H, { boxX: 0, boxY: 0, boxWidth: 16 });
    expect(b.size).toBe(1);
    const r = toRaw(b);
    expect(r.size).toBe(1000);
    expect(Number.isInteger(r.cropLeft)).toBe(true);
  });
});
