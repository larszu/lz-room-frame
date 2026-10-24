import { describe, expect, it } from 'vitest';
import { ssBoxFor, toRaw, FRAME_W } from '../src/engine/atem';
import { DEFAULT_PTZ, ptzAim, ptzDrive, viscaPackets } from '../src/engine/ptz';
import type { Person } from '../src/engine/types';
import { Tracker } from '../src/engine/tracker';
import { headFromKeypoints } from '../src/engine/pose';

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

describe('Tracker at the picture edge', () => {
  const det = (x: number, w = 200, low = false) => ({ body: { x, y: 100, w, h: 500 }, head: low ? null : { x: x + 60, y: 110, w: 80, h: 100 }, score: 0.9, low });

  it('unsure boxes never start a person but continue one', () => {
    const t = new Tracker();
    t.update([det(500, 200, true)], 0, 3, 1920, 1080);
    t.update([det(500, 200, true)], 100, 3, 1920, 1080);
    expect(t.confirmed()).toHaveLength(0);
    t.update([det(500)], 200, 3, 1920, 1080);
    t.update([det(500)], 300, 3, 1920, 1080);
    t.update([det(505, 200, true)], 400, 3, 1920, 1080);
    expect(t.confirmed()).toHaveLength(1);
    expect(t.confirmed()[0].lastSeen).toBe(400);
  });

  it('keeps the size of a person cut by the edge and ends when they walk out', () => {
    const t = new Tracker();
    let x = 1500, now = 0;
    for (; x <= 1720; x += 40, now += 100) t.update([det(x)], now, 3, 1920, 1080);
    // half out: the detector sees only the part inside the picture, without a face
    t.update([det(1800, 120, true)], now, 3, 1920, 1080); now += 100;
    expect(t.confirmed()[0].body.w).toBeGreaterThan(180);
    // nothing detected any more: the prediction carries them out well before holdTime
    for (let i = 0; i < 20 && t.confirmed().length; i++, now += 100) t.update([], now, 3, 1920, 1080);
    expect(t.confirmed()).toHaveLength(0);
    expect(now).toBeLessThan(2800);
  });
});

describe('Tracker re-identification', () => {
  const unit = (seed: number) => { const v = new Float32Array(8); v[seed % 8] = 1; v[(seed + 1) % 8] = 0.3; const l = Math.hypot(...v); return v.map((x) => x / l); };
  const det = (x: number, emb: Float32Array) => ({ body: { x, y: 100, w: 200, h: 500 }, head: { x: x + 60, y: 110, w: 80, h: 100 }, score: 0.9, emb });

  it('gives a person who comes back their id and label', () => {
    const t = new Tracker();
    for (let now = 0; now < 500; now += 100) t.update([det(800, unit(1))], now, 1, 1920, 1080);
    const id = t.confirmed()[0].id; t.confirmed()[0].label = 'Anna';
    for (let now = 500; now < 3000; now += 100) t.update([], now, 1, 1920, 1080);
    expect(t.confirmed()).toHaveLength(0);
    t.update([det(300, unit(1))], 3000, 1, 1920, 1080);
    expect(t.confirmed()[0]).toMatchObject({ id, label: 'Anna' });
  });

  it('gives someone who looks different a new id', () => {
    const t = new Tracker();
    for (let now = 0; now < 500; now += 100) t.update([det(800, unit(1))], now, 1, 1920, 1080);
    const id = t.confirmed()[0].id;
    for (let now = 500; now < 3000; now += 100) t.update([], now, 1, 1920, 1080);
    for (let now = 3000; now < 3300; now += 100) t.update([det(300, unit(5))], now, 1, 1920, 1080);
    expect(t.confirmed()[0].id).not.toBe(id);
  });
});

describe('head from RTMO keypoints', () => {
  const kp = (pts: [number, number, number][]): [number, number, number][] => [...pts, ...Array.from({ length: 17 - pts.length }, () => [0, 0, 0] as [number, number, number])];

  it('places the head around the face points (webcam, frontal)', () => {
    const h = headFromKeypoints(kp([[1048, 1016, 0.96], [1179, 858, 0.99], [915, 865, 1], [1342, 768, 0.63], [757, 782, 0.87]]))!;
    expect(h.x + h.w / 2).toBeGreaterThan(950); expect(h.x + h.w / 2).toBeLessThan(1150);
    expect(h.w).toBeGreaterThan(550); expect(h.w).toBeLessThan(800);
    expect(h.y).toBeLessThan(858);
  });

  it('finds a half face at the picture edge (nose and one eye)', () => {
    const h = headFromKeypoints(kp([[885, 934, 0.82], [954, 843, 0.25], [858, 828, 0.72], [1076, 784, 0.01], [824, 792, 0.05]]));
    expect(h).not.toBeNull();
  });

  it('gives no head without sure face points', () => {
    expect(headFromKeypoints(kp([[0, 0, 0.1], [0, 0, 0.1], [0, 0, 0.2], [0, 0, 0], [0, 0, 0]]))).toBeNull();
  });
});
