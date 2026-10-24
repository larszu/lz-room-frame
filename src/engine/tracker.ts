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

export function cosine(a: Float32Array, b: Float32Array) {
  let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Running mean of two unit vectors, normalised again. */
function blend(a: Float32Array, b: Float32Array, k = 0.1) {
  const v = new Float32Array(a.length); let len = 0;
  for (let i = 0; i < a.length; i++) { v[i] = a[i] * (1 - k) + b[i] * k; len += v[i] * v[i]; }
  len = Math.sqrt(len) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= len;
  return v;
}

/** `r` scaled around its centre so its width stays within 0.75…1.33 of `w`. */
function sized(r: Rect, w: number): Rect {
  const k = clamp(r.w, w * 0.75, w * 1.33) / r.w;
  return { x: cx(r) - (r.w * k) / 2, y: cy(r) - (r.h * k) / 2, w: r.w * k, h: r.h * k };
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
    const free = this.assign(sure, this.persons, matched, now, W, H, 0.3, 1.5);
    // a sure box far from every prediction (fast movement, wrong prediction) first takes over
    // someone just lost nearby before it becomes a new person
    const rest = [...free];
    const taken = this.assign(rest.map((i) => sure[i]), this.persons.filter((p) => !matched.has(p) && now - p.lastSeen > 150), matched, now, W, H, 0.1, 4);
    const fresh = rest.filter((_, j) => taken.has(j));
    this.assign(unsure, this.persons.filter((p) => !matched.has(p)), matched, now, W, H, 0.5, 0.8);
    for (const i of fresh) {
      const d = sure[i];
      // someone who was here before gets their id and name back (same tile, same label)
      const back = d.emb ? this.recall(d.emb, now) : null;
      this.persons.push({
        id: back?.id ?? this.nextId++, label: back?.label, body: d.body, head: d.head ?? headFromBody(d.body), faceSeen: !!d.head,
        firstSeen: now, lastSeen: now, hits: back ? this.minHits : 1, speaking: 0, emb: d.emb,
      });
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
    // left the picture: the head centre is out, or, not seen any more, the head is mostly out
    const out = (p: Person, m: number) => cx(p.head) < m || cx(p.head) > W - m || cy(p.head) < m || cy(p.head) > H - m;
    const gone = (p: Person) => out(p, 0) || (now - p.lastSeen > 300 && out(p, p.head.w * 0.25));
    const keep = (p: Person) => !gone(p) && now - p.lastSeen <= holdTime * 1000 && (p.hits >= this.minHits || now - p.firstSeen < 1500);
    for (const p of this.persons) if (!keep(p) && p.emb && p.hits >= this.minHits) this.gallery.set(p.id, { id: p.id, label: p.label, emb: p.emb, at: now });
    this.persons = this.persons.filter(keep);
    // two tracks on one head (a duplicate after a jump): keep the older one
    this.persons = this.persons.filter((p) => !this.persons.some((q) => q !== p && q.firstSeen < p.firstSeen && iou(q.head, p.head) > 0.3 && now - q.lastSeen < 500));
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
        // compare with where the head should be by now (fast movement between two detections)
        const ahead = Math.min(now - p.lastSeen, 500);
        const px = cx(p.head) + (p.vx ?? 0) * ahead, py = cy(p.head) + (p.vy ?? 0) * ahead;
        const dist = Math.hypot(px - cx(h), py - cy(h)) / Math.max(p.head.w, 1);
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
      // a head does not change its size by half within a fraction of a second
      if (d.head) head = p.faceSeen ? sized(d.head, p.head.w) : d.head;
      // no face (half a face at the edge, turned away): the head keeps its place in the body
      else if (p.faceSeen) head = { ...p.head, x: p.head.x + cx(p.body) - cx(prev), y: p.head.y + p.body.y - prev.y };
      else head = headFromBody(body);
      // a face beats an estimate: jump to it the first time, smooth afterwards
      p.head = d.head && !p.faceSeen ? head : lerp(p.head, head, this.smooth);
      p.faceSeen ||= !!d.head;
      const dt = Math.max(1, now - (p.predicted ?? p.lastSeen));
      if (dt < 1000 && !d.low) { // unsure boxes jump too much for a speed
        const lim = (v: number) => clamp(v, -1.5, 1.5); // px/ms, faster is a detection jump
        p.vx = 0.6 * (p.vx ?? 0) + 0.4 * lim((cx(p.head) - cx(prevHead)) / dt);
        p.vy = 0.6 * (p.vy ?? 0) + 0.4 * lim((cy(p.head) - cy(prevHead)) / dt);
      }
      if (d.emb) p.emb = p.emb ? blend(p.emb, d.emb) : d.emb;
      p.lastSeen = now; p.predicted = undefined;
      if (!d.low) p.hits++;
    }
    return free;
  }

  /** People who left, by id, with their appearance: recognised when they come back. */
  private gallery = new Map<number, { id: number; label?: string; emb: Float32Array; at: number }>();
  /** how similar (cosine) a new person must look to someone who left */
  reidMin = 0.65;
  /** how long someone who left is remembered, ms */
  reidKeep = 10 * 60_000;

  private recall(emb: Float32Array, now: number) {
    let best: { id: number; label?: string } | null = null, bs = 0, second = 0;
    for (const g of this.gallery.values()) {
      if (now - g.at > this.reidKeep) { this.gallery.delete(g.id); continue; }
      if (this.persons.some((p) => p.id === g.id)) continue;
      const s = cosine(emb, g.emb);
      if (s > bs) { second = bs; bs = s; best = g; } else if (s > second) second = s;
    }
    // two people who look alike: better a new tile than the wrong name
    if (!best || bs < this.reidMin || bs - second < 0.05) return null;
    this.gallery.delete(best.id);
    return best;
  }

  confirmed() { return this.persons.filter((p) => p.hits >= this.minHits); }

  reset() { this.persons = []; this.gallery.clear(); }
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
