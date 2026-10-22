// From a person (or a group) to a crop of the source picture, and a virtual camera that
// moves calmly towards it: dead band against fidgeting, a critically damped spring against
// jerks, and a sharpness guard that never enlarges the source more than `maxUpscale`.

import { clamp, cx, fitAspect, union } from './geometry';
import type { Framing, Person, Rect, Shot, Speed } from './types';

/** Crop height as a multiple of the head height, per shot size. */
export const SHOT_FACTOR: Record<Shot, number> = { close: 2.4, mcu: 3.6, medium: 5, cowboy: 7, wide: 10 };

export const SHOT_LABEL: Record<Shot, string> = { close: 'Nah (Kopf)', mcu: 'Brustbild', medium: 'Halbnah', cowboy: 'Amerikanisch', wide: 'Halbtotale' };

/** Spring stiffness (rad/s) per speed. */
export const SPEED_OMEGA: Record<Speed, number> = { slow: 1.6, normal: 3.2, fast: 6.5 };

export interface FrameSize { W: number; H: number }

/** Smallest crop that still keeps `maxUpscale` for a tile of `tileW × tileH` output pixels. */
export function minCrop(tileW: number, tileH: number, maxUpscale: number) {
  return { w: tileW / Math.max(1, maxUpscale), h: tileH / Math.max(1, maxUpscale) };
}

function guard(r: Rect, aspect: number, tilePx: { w: number; h: number } | null, maxUpscale: number, src: FrameSize): Rect {
  if (!tilePx) return fitAspect(r, aspect, src.W, src.H);
  const m = minCrop(tilePx.w, tilePx.h, maxUpscale);
  if (r.h >= m.h) return fitAspect(r, aspect, src.W, src.H);
  const grow = m.h / r.h;
  const g = { x: cx(r) - (r.w * grow) / 2, y: r.y - (r.h * (grow - 1)) * 0.25, w: r.w * grow, h: r.h * grow };
  return fitAspect(g, aspect, src.W, src.H);
}

/** Crop for one person at the shot size, with headroom. */
export function personCrop(p: Person, f: Pick<Framing, 'shot' | 'headroom' | 'maxUpscale'>, aspect: number, src: FrameSize, tilePx: { w: number; h: number } | null): Rect {
  const h = p.head.h * SHOT_FACTOR[f.shot];
  const w = h * aspect;
  const top = p.head.y - f.headroom * h;
  return guard({ x: cx(p.head) - w / 2, y: top, w, h }, aspect, tilePx, f.maxUpscale, src);
}

/** Crop that holds the whole group, each at a loose shot, plus padding. */
export function groupCrop(ps: Person[], f: Pick<Framing, 'padding' | 'headroom' | 'maxUpscale'>, aspect: number, src: FrameSize, tilePx: { w: number; h: number } | null): Rect {
  const boxes = ps.map((p) => {
    const h = p.head.h * SHOT_FACTOR.medium;
    return { x: p.head.x - p.head.w * 0.9, y: p.head.y - f.headroom * h, w: p.head.w * 2.8, h };
  });
  const u = union(boxes);
  if (!u) return { x: 0, y: 0, w: src.W, h: src.H };
  const pad = f.padding;
  const r = { x: u.x - u.w * pad / 2, y: u.y - u.h * pad / 4, w: u.w * (1 + pad), h: u.h * (1 + pad / 2) };
  return guard(r, aspect, tilePx, f.maxUpscale, src);
}

export const fullFrame = (aspect: number, src: FrameSize): Rect => fitAspect({ x: 0, y: 0, w: src.W, h: src.H }, aspect, src.W, src.H);

/**
 * A virtual camera: position, size and their velocities. `target` is what it should show,
 * `step(dt)` moves it there with a critically damped spring.
 */
export class VirtualCamera {
  cur: Rect | null = null;
  target: Rect | null = null;
  private v = { x: 0, y: 0, w: 0, h: 0 };
  /** id of what the camera shows (person id, 'group' …) – a change means a new shot */
  subject: string | null = null;
  /** 0…1 fade-in of a new shot (fade transition) */
  fade = 1;
  prev: Rect | null = null;

  /** Sets a new target. Inside the dead band the camera keeps still. */
  aim(next: Rect, subject: string, deadband: number, transition: Framing['transition']) {
    if (!this.cur || !this.target) { this.cur = { ...next }; this.target = { ...next }; this.subject = subject; return; }
    if (subject !== this.subject) {
      this.subject = subject;
      if (transition === 'cut') { this.cur = { ...next }; this.target = { ...next }; this.v = { x: 0, y: 0, w: 0, h: 0 }; return; }
      if (transition === 'fade') { this.prev = { ...this.cur }; this.fade = 0; this.cur = { ...next }; this.target = { ...next }; this.v = { x: 0, y: 0, w: 0, h: 0 }; return; }
      this.target = { ...next };
      return;
    }
    const t = this.target;
    const moved = Math.max(Math.abs(cx(next) - cx(t)) / t.w, Math.abs(next.y + next.h / 2 - (t.y + t.h / 2)) / t.h);
    const zoomed = Math.abs(next.h - t.h) / t.h;
    if (moved > deadband || zoomed > deadband * 1.5) this.target = { ...next };
  }

  step(dt: number, speed: Speed, src: FrameSize) {
    if (!this.cur || !this.target) return;
    if (this.fade < 1) this.fade = Math.min(1, this.fade + dt / 0.35);
    const w0 = SPEED_OMEGA[speed];
    const c = this.cur as unknown as Record<string, number>, t = this.target as unknown as Record<string, number>, v = this.v as unknown as Record<string, number>;
    const d = Math.min(dt, 0.1);
    for (const k of ['x', 'y', 'w', 'h']) {
      const a = w0 * w0 * (t[k] - c[k]) - 2 * w0 * v[k];
      v[k] += a * d;
      c[k] += v[k] * d;
    }
    // stay inside the picture
    this.cur.w = clamp(this.cur.w, 8, src.W); this.cur.h = clamp(this.cur.h, 8, src.H);
    this.cur.x = clamp(this.cur.x, 0, src.W - this.cur.w); this.cur.y = clamp(this.cur.y, 0, src.H - this.cur.h);
  }

  reset() { this.cur = this.target = this.prev = null; this.subject = null; this.fade = 1; this.v = { x: 0, y: 0, w: 0, h: 0 }; }
}
