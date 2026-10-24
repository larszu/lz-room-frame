// Keeps people apart over time: matches each new detection to a tracked person (greedy by
// overlap and distance), smooths the boxes a little, confirms new people after a few hits
// (no ghost tiles from a single false detection) and holds lost people for `holdTime`.

import { clamp, cx, cy, inside, iou } from './geometry';
import type { Detection, Person, Rect, RoomZones } from './types';

/** Head estimate when the face detector found none: upper middle of the body box. */
export function headFromBody(b: Rect): Rect {
  const w = Math.min(b.w * 0.5, b.h * 0.3);
  const h = w * 1.25;
  return { x: cx(b) - w / 2, y: b.y + b.h * 0.02, w, h };
}

/**
 * A box cut by the picture edge shows only part of the person: keep the width/height the
 * person had and let the box reach past the edge, anchored at its inner side.
 */
function atEdge(d: Rect, prev: Rect, W: number, H: number): Rect {
  const e = 3, r = { ...d };
  if (d.x <= e && d.w < prev.w) { r.w = prev.w; r.x = d.x + d.w - prev.w; }
  else if (d.x + d.w >= W - e && d.w < prev.w) r.w = prev.w;
  if (d.y + d.h >= H - e && d.h < prev.h) r.h = prev.h;
  return r;
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

  /**
   * `W`/`H` (source size) switch on the picture-edge handling: a box cut by the edge keeps
   * the size the person had, the head keeps its place in it, and a person who is predicted
   * to have left the picture ends at once instead of after `holdTime`.
   */
  update(dets: Detection[], now: number, holdTime: number, W = Infinity, H = Infinity): Person[] {
    const sure = dets.filter((d) => !d.low), unsure = dets.filter((d) => d.low);
    const matched = new Set<Person>();
    // ByteTrack: sure detections first; unsure ones only continue people already tracked
    const free = this.assign(sure, this.persons, matched, now, W, H, 0.3, 2);
    this.assign(unsure, this.persons.filter((p) => !matched.has(p)), matched, now, W, H, 0.4, 1);
    for (const i of free) {
      const d = sure[i];
      this.persons.push({ id: this.nextId++, body: d.body, head: d.head ?? headFromBody(d.body), faceSeen: !!d.head, firstSeen: now, lastSeen: now, hits: 1, speaking: 0 });
    }
    // not seen: move on with the last speed (damped), so a person walking out leaves the picture
    for (const p of this.persons) {
      if (matched.has(p) || p.lastSeen === now) continue;
      const dt = Math.min(now - (p.predicted ?? p.lastSeen), 500);
      p.predicted = now;
      const dx = (p.vx ?? 0) * dt, dy = (p.vy ?? 0) * dt;
      p.body = { ...p.body, x: p.body.x + dx, y: p.body.y + dy };
      p.head = { ...p.head, x: p.head.x + dx, y: p.head.y + dy };
      p.vx = (p.vx ?? 0) * 0.85; p.vy = (p.vy ?? 0) * 0.85;
    }
    const gone = (p: Person) => cx(p.head) < 0 || cx(p.head) > W || cy(p.head) < 0 || cy(p.head) > H;
    this.persons = this.persons.filter((p) => !gone(p) && now - p.lastSeen <= holdTime * 1000 && (p.hits >= this.minHits || now - p.firstSeen < 1500));
    return this.confirmed();
  }

  /** Greedy matching by overlap and distance; returns the detections left over. */
  private assign(dets: Detection[], persons: Person[], matched: Set<Person>, now: number, W: number, H: number, minIou: number, maxDist: number): Set<number> {
    const free = new Set(dets.map((_, i) => i));
    const pairs: { p: Person; i: number; q: number }[] = [];
    for (const p of persons) {
      dets.forEach((d, i) => {
        // the head is steadier than the body box (close to the camera the body jumps between
        // shoulders and half the picture): distance in head widths decides, overlap helps
        const o = iou(p.body, d.body);
        const h = d.head ?? headFromBody(d.body);
        const dist = Math.hypot(cx(p.head) - cx(h), cy(p.head) - cy(h)) / Math.max(p.head.w, h.w, 1);
        if (o > minIou || dist < maxDist) pairs.push({ p, i, q: o - dist * 0.3 });
      });
    }
    pairs.sort((a, b) => b.q - a.q);
    for (const { p, i } of pairs) {
      if (matched.has(p) || !free.has(i)) continue;
      matched.add(p); free.delete(i);
      const d = dets[i];
      const body = atEdge(d.body, p.body, W, H);
      const prev = p.body, prevHead = p.head;
      p.body = lerp(p.body, body, this.smooth);
      let head: Rect;
      if (d.head) head = d.head;
      // no face (half a face at the edge, turned away): the head keeps its place in the body
      else if (p.faceSeen) head = { ...p.head, x: p.head.x + cx(p.body) - cx(prev), y: p.head.y + p.body.y - prev.y };
      else head = headFromBody(body);
      // a face beats an estimate: jump to it the first time, smooth afterwards
      p.head = d.head && !p.faceSeen ? head : lerp(p.head, head, this.smooth);
      p.faceSeen ||= !!d.head;
      const dt = Math.max(1, now - (p.predicted ?? p.lastSeen));
      if (dt < 1000) {
        const lim = (v: number) => clamp(v, -1.5, 1.5); // px/ms, faster is a detection jump
        p.vx = 0.6 * (p.vx ?? 0) + 0.4 * lim((cx(p.head) - cx(prevHead)) / dt);
        p.vy = 0.6 * (p.vy ?? 0) + 0.4 * lim((cy(p.head) - cy(prevHead)) / dt);
      }
      p.lastSeen = now; p.predicted = undefined;
      if (!d.low) p.hits++;
    }
    return free;
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
