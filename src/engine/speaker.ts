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

export class MicLevel {
  private ctx: AudioContext | null = null;
  private an: AnalyserNode | null = null;
  private buf = new Float32Array(1024);
  private stream: MediaStream | null = null;
  level = 0;

  async start(deviceId: string) {
    this.stop();
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true, video: false });
    this.ctx = new AudioContext();
    this.an = this.ctx.createAnalyser();
    this.an.fftSize = 1024;
    this.ctx.createMediaStreamSource(this.stream).connect(this.an);
  }

  read() {
    if (!this.an) return 0;
    this.an.getFloatTimeDomainData(this.buf);
    let s = 0; for (const v of this.buf) s += v * v;
    const rms = Math.sqrt(s / this.buf.length);
    this.level = this.level * 0.6 + rms * 0.4;
    return this.level;
  }

  stop() { this.stream?.getTracks().forEach((t) => t.stop()); this.ctx?.close().catch(() => {}); this.ctx = null; this.an = null; this.stream = null; }
}

/** Region for the lip measurement of a person (around the head). */
export const mouthRegion = (p: Person): Rect => ({ x: p.head.x - p.head.w * 0.15, y: p.head.y, w: p.head.w * 1.3, h: p.head.h * 1.15 });

/** Lip movement per person → `speaking`, gated by the room microphone. */
export class LipSpeaker {
  private hist = new Map<number, { t: number; v: number }[]>();

  update(persons: Person[], open: (number | null)[], micLevel: number, threshold: number, now: number) {
    const voice = micLevel > threshold;
    persons.forEach((p, i) => {
      const v = open[i];
      if (v === null || v === undefined) { p.speaking *= 0.7; return; }
      const h = (this.hist.get(p.id) ?? []).filter((e) => now - e.t < 1200);
      h.push({ t: now, v });
      this.hist.set(p.id, h);
      const moving = Math.min(1, spread(h.map((e) => e.v)) * 40);
      p.speaking = voice ? moving : p.speaking * 0.7;
    });
    for (const id of this.hist.keys()) if (!persons.some((p) => p.id === id)) this.hist.delete(id);
  }
}
