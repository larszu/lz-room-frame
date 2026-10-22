import type { Rect } from './types';

export const cx = (r: Rect) => r.x + r.w / 2;
export const cy = (r: Rect) => r.y + r.h / 2;
export const area = (r: Rect) => Math.max(0, r.w) * Math.max(0, r.h);
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function iou(a: Rect, b: Rect) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  const i = w * h;
  return i / (area(a) + area(b) - i);
}

/** Share of `a` that lies inside `b`. */
export function coverage(a: Rect, b: Rect) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.max(1e-9, area(a));
}

export function union(rs: Rect[]): Rect | null {
  if (!rs.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rs) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export const inside = (px: number, py: number, r: Rect) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;

export const scaleRect = (r: Rect, sx: number, sy = sx): Rect => ({ x: r.x * sx, y: r.y * sy, w: r.w * sx, h: r.h * sy });

/**
 * Grows `r` to the aspect ratio `aspect` (w / h) around its centre, then fits it into the
 * frame W × H: shifted inside, and scaled down (keeping the aspect) when it is larger.
 */
export function fitAspect(r: Rect, aspect: number, W: number, H: number): Rect {
  let w = r.w, h = r.h;
  if (w / h < aspect) w = h * aspect; else h = w / aspect;
  if (w > W) { w = W; h = w / aspect; }
  if (h > H) { h = H; w = h * aspect; }
  const x = clamp(cx(r) - w / 2, 0, W - w);
  const y = clamp(cy(r) - h / 2, 0, H - h);
  return { x, y, w, h };
}

/** Non-maximum suppression on [rect, score] pairs. */
export function nms<T extends { body: Rect; score: number }>(items: T[], thr = 0.5): T[] {
  const sorted = [...items].sort((a, b) => b.score - a.score);
  const out: T[] = [];
  for (const it of sorted) if (!out.some((o) => iou(o.body, it.body) > thr || coverage(it.body, o.body) > 0.85)) out.push(it);
  return out;
}
