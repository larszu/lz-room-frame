// Keeps people apart over time: matches each new detection to a tracked person (greedy by
// overlap and distance), smooths the boxes a little, confirms new people after a few hits
// (no ghost tiles from a single false detection) and holds lost people for `holdTime`.

import { cx, cy, inside, iou } from './geometry';
import type { Detection, Person, Rect, RoomZones } from './types';

/** Head estimate when the face detector found none: upper middle of the body box. */
export function headFromBody(b: Rect): Rect {
  const w = Math.min(b.w * 0.5, b.h * 0.3);
  const h = w * 1.25;
  return { x: cx(b) - w / 2, y: b.y + b.h * 0.02, w, h };
}

const lerp = (a: Rect, b: Rect, k: number): Rect => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, w: a.w + (b.w - a.w) * k, h: a.h + (b.h - a.h) * k });

/** Drops detections outside the room boundary, in an excluded zone or too small (far away, behind glass). */
export function filterDetections(dets: Detection[], zones: RoomZones, W: number, H: number): Detection[] {
  return dets.filter((d) => {
    const head = d.head ?? headFromBody(d.body);
    const px = cx(head) / W, py = cy(head) / H;
    if (!inside(px, py, zones.boundary)) return false;
    if (zones.exclusions.some((z) => inside(px, py, z))) return false;
    return head.h / H >= zones.minHead;
  });
}

export class Tracker {
  persons: Person[] = [];
  private nextId = 1;
  /** detections needed before a person shows up */
  minHits = 2;
  /** box smoothing per detection, 0 = frozen, 1 = raw */
  smooth = 0.55;

  update(dets: Detection[], now: number, holdTime: number): Person[] {
    const free = new Set(dets.map((_, i) => i));
    // pairs sorted by quality: overlap first, then centre distance relative to size
    const pairs: { p: Person; i: number; q: number }[] = [];
    for (const p of this.persons) {
      dets.forEach((d, i) => {
        const o = iou(p.body, d.body);
        const dist = Math.hypot(cx(p.body) - cx(d.body), cy(p.body) - cy(d.body)) / Math.max(p.body.w, d.body.w, 1);
        if (o > 0.15 || dist < 0.6) pairs.push({ p, i, q: o - dist * 0.5 });
      });
    }
    pairs.sort((a, b) => b.q - a.q);
    const matched = new Set<Person>();
    for (const { p, i } of pairs) {
      if (matched.has(p) || !free.has(i)) continue;
      matched.add(p); free.delete(i);
      const d = dets[i];
      p.body = lerp(p.body, d.body, this.smooth);
      const head = d.head ?? headFromBody(d.body);
      // a face beats an estimate: jump to it the first time, smooth afterwards
      p.head = d.head && !p.faceSeen ? head : lerp(p.head, head, this.smooth);
      p.faceSeen ||= !!d.head;
      p.lastSeen = now; p.hits++;
    }
    for (const i of free) {
      const d = dets[i];
      this.persons.push({ id: this.nextId++, body: d.body, head: d.head ?? headFromBody(d.body), faceSeen: !!d.head, firstSeen: now, lastSeen: now, hits: 1, speaking: 0 });
    }
    this.persons = this.persons.filter((p) => now - p.lastSeen <= holdTime * 1000 && (p.hits >= this.minHits || now - p.firstSeen < 1500));
    return this.confirmed();
  }

  confirmed() { return this.persons.filter((p) => p.hits >= this.minHits); }

  reset() { this.persons = []; }
}

/**
 * Stable tile order: people keep their place while they stay, new people are inserted by
 * their position from left to right. Re-sorting on every move would swap tiles all the time.
 */
export function stableOrder(prev: number[], persons: Person[]): number[] {
  const byId = new Map(persons.map((p) => [p.id, p]));
  const order = prev.filter((id) => byId.has(id));
  const fresh = persons.filter((p) => !order.includes(p.id)).sort((a, b) => cx(a.head) - cx(b.head));
  for (const p of fresh) {
    let at = order.findIndex((id) => cx(byId.get(id)!.head) > cx(p.head));
    if (at < 0) at = order.length;
    order.splice(at, 0, p.id);
  }
  return order;
}

/** Order from left to right as seen now (used when the set of people changes). */
export const leftToRight = (persons: Person[]) => [...persons].sort((a, b) => cx(a.head) - cx(b.head)).map((p) => p.id);
