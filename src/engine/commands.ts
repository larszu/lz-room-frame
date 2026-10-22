// Control protocol, one command per line (TCP, HTTP, WebSocket). Same commands everywhere,
// so a Crestron TCP client, a Q-SYS plugin and a Companion button all send the same text.
// Answers: "OK …" or "ERR …"; `status` answers one JSON line.

import type { LayoutStyle, Mode, Shot, Speed } from './types';

export type Command =
  | { kind: 'scene'; ref: string }
  | { kind: 'sceneB'; ref: string }
  | { kind: 'mode'; mode: Mode }
  | { kind: 'style'; style: LayoutStyle }
  | { kind: 'shot'; shot: Shot }
  | { kind: 'speed'; speed: Speed }
  | { kind: 'freeze'; on: boolean }
  | { kind: 'speaker'; index: number | null }
  | { kind: 'zone'; index: number; on: boolean }
  | { kind: 'presenter'; index: number | null }
  | { kind: 'output'; target: 'window' | 'ndi' | 'stream' | 'v4l2' | 'b' | 'ndib' | 'windowb'; on: boolean }
  | { kind: 'privacy'; on: boolean }
  | { kind: 'ptz'; on: boolean }
  | { kind: 'status' }
  | { kind: 'scenes' }
  | { kind: 'subscribe'; on: boolean }
  | { kind: 'help' };

const MODES: Record<string, Mode> = { overview: 'overview', group: 'group', people: 'people', tiles: 'people', speaker: 'speaker', presenter: 'presenter' };
const STYLES: Record<string, LayoutStyle> = { grid: 'grid', center: 'center', speaker: 'speaker', strip: 'strip' };
const SHOTS: Record<string, Shot> = { close: 'close', mcu: 'mcu', medium: 'medium', cowboy: 'cowboy', wide: 'wide' };
const SPEEDS: Record<string, Speed> = { slow: 'slow', normal: 'normal', fast: 'fast' };

const onOff = (v: string | undefined): boolean | null => {
  const s = (v ?? '').toLowerCase();
  if (['on', '1', 'true', 'ein'].includes(s)) return true;
  if (['off', '0', 'false', 'aus'].includes(s)) return false;
  return null;
};

export const HELP = [
  'scene <number|id|name>      recall a scene (alias: preset)',
  'mode overview|group|people|speaker|presenter',
  'style grid|center|speaker|strip',
  'shot close|mcu|medium|cowboy|wide',
  'speed slow|normal|fast',
  'freeze on|off               hold the current shots',
  'privacy on|off              black picture (camera off)',
  'ptz on|off                  PTZ camera follows the main person',
  'tracking on|off             TRK lines with normalized tracking data (TCP/WebSocket)',
  'speaker <n>|none            person n (1 = leftmost tile) is the speaker',
  'zone <n> on|off             speaker zone n (seat microphone) is active',
  'presenter <n>|auto          presenter mode follows person n',
  'sceneb <number|id|name>     scene of output B (second format)',
  'output window|ndi|stream|v4l2|b|ndib|windowb on|off',
  'status | scenes | subscribe on|off | help',
];

export function parseCommand(line: string): Command | { error: string } {
  const parts = line.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { error: 'empty command' };
  const [cmd, a, b] = [parts[0].toLowerCase(), parts[1], parts[2]];
  const rest = parts.slice(1).join(' ');
  switch (cmd) {
    case 'scene': case 'preset': case 'recall':
      return rest ? { kind: 'scene', ref: rest } : { error: 'scene needs a number, id or name' };
    case 'sceneb':
      return rest ? { kind: 'sceneB', ref: rest } : { error: 'sceneb needs a number, id or name' };
    case 'mode': return MODES[a?.toLowerCase()] ? { kind: 'mode', mode: MODES[a.toLowerCase()] } : { error: `unknown mode "${a ?? ''}"` };
    case 'style': case 'layout': return STYLES[a?.toLowerCase()] ? { kind: 'style', style: STYLES[a.toLowerCase()] } : { error: `unknown style "${a ?? ''}"` };
    case 'shot': return SHOTS[a?.toLowerCase()] ? { kind: 'shot', shot: SHOTS[a.toLowerCase()] } : { error: `unknown shot "${a ?? ''}"` };
    case 'speed': return SPEEDS[a?.toLowerCase()] ? { kind: 'speed', speed: SPEEDS[a.toLowerCase()] } : { error: `unknown speed "${a ?? ''}"` };
    case 'freeze': case 'privacy': case 'ptz': {
      const on = onOff(a);
      return on === null ? { error: `${cmd} needs on|off` } : { kind: cmd, on };
    }
    case 'speaker': case 'presenter': {
      const s = (a ?? '').toLowerCase();
      if (['none', 'off', 'auto', '0'].includes(s)) return { kind: cmd, index: null };
      const n = Number(s);
      return Number.isInteger(n) && n > 0 ? { kind: cmd, index: n } : { error: `${cmd} needs a person number or none` };
    }
    case 'zone': {
      const n = Number(a), on = onOff(b);
      return Number.isInteger(n) && n > 0 && on !== null ? { kind: 'zone', index: n, on } : { error: 'zone needs <number> on|off' };
    }
    case 'output': {
      const t = a?.toLowerCase(), on = onOff(b);
      if (!['window', 'ndi', 'stream', 'v4l2', 'b', 'ndib', 'windowb'].includes(t ?? '') || on === null) return { error: 'output needs window|ndi|stream|v4l2|b|ndib|windowb on|off' };
      return { kind: 'output', target: t as 'window', on };
    }
    case 'status': case 'scenes': case 'help': return { kind: cmd };
    case 'subscribe': { const on = onOff(a ?? 'on'); return on === null ? { error: 'subscribe on|off' } : { kind: 'subscribe', on }; }
    default: return { error: `unknown command "${cmd}" (try: help)` };
  }
}

/** Finds a scene by 1-based number, id or name (case-insensitive). */
export function findScene<T extends { id: string; name: string }>(scenes: T[], ref: string): T | undefined {
  const n = Number(ref);
  if (Number.isInteger(n) && n >= 1 && n <= scenes.length) return scenes[n - 1];
  const r = ref.toLowerCase();
  return scenes.find((s) => s.id.toLowerCase() === r) ?? scenes.find((s) => s.name.toLowerCase() === r);
}
