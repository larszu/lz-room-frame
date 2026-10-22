// Active speaker, three ways:
//  - external: the room's DSP knows who talks (seat microphones, automixer gates). Q-SYS or
//    Crestron switch speaker zones over the control API; the person in an active zone speaks.
//  - auto: microphone level (voice in the room) combined with lip movement per person
//    (MediaPipe Face Landmarker on the head crop). Experimental – depends on light and angle.
//  - off.

import { cx } from './geometry';
import type { Person, Rect, RoomZones } from './types';

/** Marks people inside active speaker zones as speaking. */
export function applyZones(persons: Person[], zones: RoomZones, active: Set<number>, W: number) {
  for (const p of persons) {
    const x = cx(p.head) / W;
    const on = zones.speakerZones.some((z, i) => active.has(i + 1) && x >= z.x0 && x <= z.x1);
    p.speaking = on ? 1 : 0;
  }
}

/** Standard deviation of the values. */
export function spread(v: number[]) {
  if (v.length < 2) return 0;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
}

/** Region for the lip measurement of a person (around the head). */
export const mouthRegion = (p: Person): Rect => ({ x: p.head.x - p.head.w * 0.15, y: p.head.y, w: p.head.w * 1.3, h: p.head.h * 1.15 });

/** Lip movement per person (0…1), from mouth openness over the last 1.2 s. */
export class LipSpeaker {
  private hist = new Map<number, { t: number; v: number }[]>();

  update(persons: Person[], open: (number | null)[], now: number): Map<number, number> {
    const out = new Map<number, number>();
    persons.forEach((p, i) => {
      const v = open[i];
      if (v === null || v === undefined) return;
      const h = (this.hist.get(p.id) ?? []).filter((e) => now - e.t < 1200);
      h.push({ t: now, v });
      this.hist.set(p.id, h);
      out.set(p.id, Math.min(1, spread(h.map((e) => e.v)) * 40));
    });
    for (const id of this.hist.keys()) if (!persons.some((p) => p.id === id)) this.hist.delete(id);
    return out;
  }
}

/**
 * Speaking score per person from the room sound and the picture: without voice it fades;
 * with voice it mixes lip movement and – with a stereo mic – how well the person sits in
 * the sound direction. Mono or no direction: lips alone.
 */
export function fuseSpeaking(persons: Person[], lips: Map<number, number>, voice: boolean, audioX: number | null, W: number, lipWeight: number, sigma: number) {
  for (const p of persons) {
    if (!voice) { p.speaking *= 0.7; continue; }
    const lip = lips.get(p.id);
    const dir = audioX === null ? null : Math.exp(-(((p.head.x + p.head.w / 2) / W - audioX) ** 2) / (2 * sigma * sigma));
    let s: number;
    if (dir === null) s = lip ?? 0;
    else if (lip === undefined) s = dir;
    else s = lipWeight * lip + (1 - lipWeight) * dir;
    p.speaking = p.speaking * 0.4 + s * 0.6;
  }
}
