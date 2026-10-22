import { describe, expect, it } from 'vitest';
import { findScene, parseCommand } from '../src/engine/commands';
import { Director } from '../src/engine/director';
import { groupCrop, personCrop, VirtualCamera } from '../src/engine/framing';
import { fitAspect, iou } from '../src/engine/geometry';
import { autoLayout, gridShape, personSlots } from '../src/engine/layouts';
import { BUILTIN_SCENES, DEFAULT_FRAMING, mergeSettings } from '../src/engine/settings';
import { filterDetections, stableOrder, Tracker } from '../src/engine/tracker';
import type { Detection, Person, Rect } from '../src/engine/types';

const W = 3840, H = 2160;
const det = (x: number, y = 600, w = 300, h = 700): Detection => ({ body: { x, y, w, h }, head: { x: x + 90, y, w: 120, h: 150 }, score: 0.9 });
const person = (id: number, x: number): Person => ({ id, body: { x, y: 600, w: 300, h: 700 }, head: { x: x + 90, y: 600, w: 120, h: 150 }, faceSeen: true, firstSeen: 0, lastSeen: 0, hits: 5, speaking: 0 });
const inside = (r: Rect) => r.x >= -1e-6 && r.y >= -1e-6 && r.x + r.w <= W + 1e-6 && r.y + r.h <= H + 1e-6;

describe('geometry', () => {
  it('fits a rect to an aspect inside the frame', () => {
    const r = fitAspect({ x: 3700, y: 100, w: 400, h: 400 }, 16 / 9, W, H);
    expect(r.w / r.h).toBeCloseTo(16 / 9);
    expect(inside(r)).toBe(true);
  });
  it('iou', () => {
    expect(iou({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 10, h: 10 })).toBe(1);
    expect(iou({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 10, h: 10 })).toBe(0);
  });
});

describe('tracker', () => {
  it('keeps ids, confirms after two hits and holds lost people', () => {
    const t = new Tracker();
    expect(t.update([det(100), det(2000)], 0, 3)).toHaveLength(0);
    const ps = t.update([det(110), det(2010)], 100, 3);
    expect(ps.map((p) => p.id)).toEqual([1, 2]);
    expect(t.update([det(2020)], 200, 3).map((p) => p.id)).toEqual([1, 2]); // 1 held
    expect(t.update([det(2030)], 3500, 3).map((p) => p.id)).toEqual([2]); // 1 dropped after 3 s
  });
  it('does not confirm a one-off false detection', () => {
    const t = new Tracker();
    t.update([det(100)], 0, 3);
    expect(t.update([], 2000, 3)).toHaveLength(0);
    expect(t.persons).toHaveLength(0);
  });
  it('filters by boundary, exclusion zones and head size', () => {
    const zones = { boundary: { x: 0, y: 0, w: 0.8, h: 1 }, exclusions: [{ x: 0, y: 0, w: 0.1, h: 1 }], minHead: 0.05, speakerZones: [] };
    const out = filterDetections([det(100), det(1500), det(3500), { ...det(2000), head: { x: 2000, y: 600, w: 40, h: 50 } }], zones, W, H);
    expect(out.map((d) => d.body.x)).toEqual([1500]);
  });
  it('stable order inserts new people by position and keeps the old ones in place', () => {
    expect(stableOrder([], [person(1, 2000), person(2, 100)])).toEqual([2, 1]);
    // 2 walked to the right of 1: no swap
    expect(stableOrder([2, 1], [person(1, 2000), person(2, 2500)])).toEqual([2, 1]);
    expect(stableOrder([2, 1], [person(1, 2000), person(2, 100), person(3, 1000)])).toEqual([2, 3, 1]);
  });
});

describe('framing', () => {
  it('person crop: tile aspect, inside the frame, headroom above the head', () => {
    const p = person(1, 1800);
    const r = personCrop(p, DEFAULT_FRAMING, 16 / 9, { W, H }, null);
    expect(r.w / r.h).toBeCloseTo(16 / 9);
    expect(inside(r)).toBe(true);
    expect(r.y).toBeLessThan(p.head.y);
    expect(p.head.y - r.y).toBeCloseTo(DEFAULT_FRAMING.headroom * r.h, 0);
  });
  it('sharpness guard zooms out instead of enlarging too much', () => {
    const p = person(1, 1800);
    const tile = { w: 1920, h: 1080 };
    const r = personCrop(p, { ...DEFAULT_FRAMING, shot: 'close', maxUpscale: 1.5 }, 16 / 9, { W, H }, tile);
    expect(1080 / r.h).toBeLessThanOrEqual(1.5 + 1e-6);
  });
  it('group crop holds every head', () => {
    const ps = [person(1, 200), person(2, 3300)];
    const r = groupCrop(ps, DEFAULT_FRAMING, 16 / 9, { W, H }, null);
    for (const p of ps) { expect(p.head.x).toBeGreaterThanOrEqual(r.x); expect(p.head.x + p.head.w).toBeLessThanOrEqual(r.x + r.w); }
  });
  it('virtual camera keeps still inside the dead band and settles on a new target', () => {
    const cam = new VirtualCamera();
    const a = { x: 1000, y: 500, w: 960, h: 540 };
    cam.aim(a, 'p1', 0.1, 'smooth');
    cam.aim({ ...a, x: 1040 }, 'p1', 0.1, 'smooth'); // 4 % – ignored
    expect(cam.target!.x).toBe(1000);
    cam.aim({ ...a, x: 1400 }, 'p1', 0.1, 'smooth');
    for (let i = 0; i < 300; i++) cam.step(1 / 30, 'normal', { W, H });
    expect(cam.cur!.x).toBeCloseTo(1400, 0);
  });
  it('cut jumps to a new subject', () => {
    const cam = new VirtualCamera();
    cam.aim({ x: 0, y: 0, w: 960, h: 540 }, 'p1', 0.1, 'cut');
    cam.aim({ x: 2000, y: 0, w: 960, h: 540 }, 'p2', 0.1, 'cut');
    expect(cam.cur!.x).toBe(2000);
  });
});

describe('layouts', () => {
  it('auto grid has one person tile per person, all inside the output and not overlapping', () => {
    for (let n = 1; n <= 16; n++) {
      const l = autoLayout(n, 'grid');
      expect(personSlots(l)).toBe(n);
      for (const t of l.tiles) { expect(t.x).toBeGreaterThanOrEqual(-1e-9); expect(t.x + t.w).toBeLessThanOrEqual(1 + 1e-9); expect(t.y + t.h).toBeLessThanOrEqual(1 + 1e-9); }
      for (let i = 0; i < l.tiles.length; i++) for (let j = i + 1; j < l.tiles.length; j++) expect(iou(l.tiles[i], l.tiles[j])).toBeLessThan(1e-9);
    }
  });
  it('center style: 7 people = 7 tiles around a centre overview (4 × 4)', () => {
    const l = autoLayout(7, 'center');
    expect(personSlots(l)).toBe(7);
    const ov = l.tiles.find((t) => t.role === 'overview')!;
    expect(ov.w).toBeCloseTo(0.75); expect(ov.h).toBeCloseTo(0.75);
  });
  it('grid shapes', () => {
    expect(gridShape(4)).toEqual([2, 2]);
    expect(gridShape(5)).toEqual([3, 2]);
    expect(gridShape(9)).toEqual([3, 3]);
  });
});

describe('director', () => {
  const base = { framing: DEFAULT_FRAMING, src: { W, H }, out: { W: 1920, H: 1080 }, layoutFor: () => null, forcedSpeaker: null, presenterId: null };
  it('people mode: a tile per person, overview without people, group above maxPeople', () => {
    const d = new Director();
    expect(d.update({ ...base, persons: [], now: 0 }).map((v) => v.tile.role)).toEqual(['overview']);
    expect(d.update({ ...base, persons: [person(1, 100), person(2, 2000)], now: 1 }).map((v) => v.personId)).toEqual([1, 2]);
    const many = Array.from({ length: 10 }, (_, i) => person(i + 1, i * 350));
    expect(d.update({ ...base, persons: many, now: 2, framing: { ...DEFAULT_FRAMING, maxPeople: 9 } }).map((v) => v.tile.role)).toEqual(['group']);
  });
  it('speaker mode follows the forced speaker', () => {
    const d = new Director();
    const ps = [person(1, 100), person(2, 2000)];
    const v = d.update({ ...base, persons: ps, now: 0, framing: { ...DEFAULT_FRAMING, mode: 'speaker' }, forcedSpeaker: 2 });
    expect(v[0].personId).toBe(2);
  });
  it('uses a custom layout for its person count', () => {
    const d = new Director();
    const custom = { id: 'c', name: 'c', tiles: [{ x: 0, y: 0, w: 1, h: 0.5, role: 'person' as const }, { x: 0, y: 0.5, w: 1, h: 0.5, role: 'overview' as const }] };
    const v = d.update({ ...base, persons: [person(1, 100)], now: 0, layoutFor: (n) => (n === 1 ? custom : null) });
    expect(v.map((x) => x.tile.role)).toEqual(['person', 'overview']);
  });
});

describe('commands', () => {
  it('parses the protocol', () => {
    expect(parseCommand('scene 2')).toEqual({ kind: 'scene', ref: '2' });
    expect(parseCommand('PRESET Kacheln mit Übersicht')).toEqual({ kind: 'scene', ref: 'Kacheln mit Übersicht' });
    expect(parseCommand('mode tiles')).toEqual({ kind: 'mode', mode: 'people' });
    expect(parseCommand('zone 3 on')).toEqual({ kind: 'zone', index: 3, on: true });
    expect(parseCommand('speaker none')).toEqual({ kind: 'speaker', index: null });
    expect(parseCommand('output ndi off')).toEqual({ kind: 'output', target: 'ndi', on: false });
    expect(parseCommand('privacy maybe')).toHaveProperty('error');
    expect(parseCommand('jump')).toHaveProperty('error');
  });
  it('finds scenes by number, id and name', () => {
    expect(findScene(BUILTIN_SCENES, '1')?.id).toBe('group');
    expect(findScene(BUILTIN_SCENES, 'speaker')?.id).toBe('speaker');
    expect(findScene(BUILTIN_SCENES, 'präsentator')?.id).toBe('presenter');
  });
});

describe('settings', () => {
  it('merges stored settings over defaults and keeps new defaults', () => {
    const s = mergeSettings({ output: { width: 1280 }, scenes: [{ id: 'mine', name: 'Meine', framing: { mode: 'group' } }] });
    expect(s.output.width).toBe(1280);
    expect(s.output.height).toBe(1080);
    expect(s.scenes[0].framing.shot).toBe(DEFAULT_FRAMING.shot);
    expect(s.scenes.some((x) => x.id === 'group')).toBe(true);
    expect(s.output.window.displayId).toBeNull();
  });
});
