// PTZ auto-tracking: the people detected in the PTZ camera's own picture steer its pan, tilt
// and zoom, like the "AI tracking" of modern PTZ cameras. A proportional controller with a
// dead band: inside it the camera keeps still, outside it moves faster the further off the
// target is. Speeds are -1…1 here; the main process turns them into VISCA.

import { cx, union } from './geometry';
import { SHOT_FACTOR } from './framing';
import type { Person, Shot } from './types';

export type PtzProtocol = 'sony-udp' | 'visca-tcp' | 'visca-udp';
export type PtzTarget = 'main' | 'group';

export interface PtzSettings {
  enabled: boolean;
  protocol: PtzProtocol;
  host: string;
  port: number;
  target: PtzTarget;
  shot: Shot;
  headroom: number;
  /** share of the half picture inside which the camera keeps still */
  deadband: number;
  /** 0.2 … 2: how hard it reacts */
  gain: number;
  /** top speed share, 0.1 … 1 */
  maxSpeed: number;
  zoom: boolean;
  invertPan: boolean;
  invertTilt: boolean;
}

export const DEFAULT_PTZ: PtzSettings = {
  enabled: false, protocol: 'sony-udp', host: '', port: 52381, target: 'main', shot: 'medium', headroom: 0.12,
  deadband: 0.08, gain: 0.8, maxSpeed: 0.6, zoom: true, invertPan: false, invertTilt: false,
};

export const PTZ_PORTS: Record<PtzProtocol, number> = { 'sony-udp': 52381, 'visca-tcp': 5678, 'visca-udp': 1259 };

export interface PtzDrive { pan: number; tilt: number; zoom: number }
export const STOP: PtzDrive = { pan: 0, tilt: 0, zoom: 0 };

/** Where the shot should sit: centre and height in source pixels. */
export function ptzAim(ps: Person[], s: Pick<PtzSettings, 'target' | 'shot' | 'headroom'>, mainId: number | null) {
  if (!ps.length) return null;
  if (s.target === 'group' && ps.length > 1) {
    const u = union(ps.map((p) => p.head))!;
    const h = Math.max(u.h * SHOT_FACTOR.medium, (u.w * 9) / 16 * 1.25);
    return { x: u.x + u.w / 2, y: u.y - s.headroom * h + h / 2, h };
  }
  const p = ps.find((q) => q.id === mainId) ?? [...ps].sort((a, b) => b.head.h - a.head.h)[0];
  const h = p.head.h * SHOT_FACTOR[s.shot];
  return { x: cx(p.head), y: p.head.y - s.headroom * h + h / 2, h };
}

const shape = (err: number, db: number, gain: number, max: number) => {
  const a = Math.abs(err);
  if (a < db) return 0;
  return Math.sign(err) * Math.min(max, (a - db) * gain * 2 + 0.05);
};

/** Speeds that bring the aim point to the picture centre and the shot height to the picture height. */
export function ptzDrive(aim: { x: number; y: number; h: number } | null, W: number, H: number, s: PtzSettings): PtzDrive {
  if (!aim) return STOP;
  const ex = (aim.x - W / 2) / (W / 2), ey = (aim.y - H / 2) / (H / 2);
  let pan = shape(ex, s.deadband, s.gain, s.maxSpeed);
  let tilt = -shape(ey, s.deadband * 1.3, s.gain, s.maxSpeed); // picture y runs down, tilt up is positive
  if (s.invertPan) pan = -pan;
  if (s.invertTilt) tilt = -tilt;
  let zoom = 0;
  if (s.zoom) {
    const ratio = aim.h / H; // < 1: target smaller than wanted → zoom in
    // zoom in only when roughly centred, zoom out at once when the target leaves the picture
    if (ratio < 0.8 && Math.abs(ex) < 0.35 && Math.abs(ey) < 0.35) zoom = Math.min(1, (0.8 - ratio) * 1.5 + 0.1) * s.maxSpeed;
    else if (ratio > 1.15 || Math.abs(ex) > 0.8) zoom = -Math.min(1, Math.max(ratio - 1.15, Math.abs(ex) - 0.8) * 1.5 + 0.15) * s.maxSpeed;
  }
  const r = (v: number) => Math.round(v * 20) / 20 || 0; // no -0
  return { pan: r(pan), tilt: r(tilt), zoom: r(zoom) };
}

/** VISCA bytes for a drive: pan-tilt drive and zoom (camera address 1). */
export function viscaPackets(d: PtzDrive): number[][] {
  const ps = Math.max(1, Math.round(Math.abs(d.pan) * 0x18)), ts = Math.max(1, Math.round(Math.abs(d.tilt) * 0x14));
  const pdir = d.pan > 0 ? 0x02 : d.pan < 0 ? 0x01 : 0x03;
  const tdir = d.tilt > 0 ? 0x01 : d.tilt < 0 ? 0x02 : 0x03;
  const zp = Math.min(7, Math.round(Math.abs(d.zoom) * 7));
  const z = d.zoom > 0 ? 0x20 | zp : d.zoom < 0 ? 0x30 | zp : 0x00;
  return [[0x81, 0x01, 0x06, 0x01, ps, ts, pdir, tdir, 0xff], [0x81, 0x01, 0x04, 0x07, z, 0xff]];
}
