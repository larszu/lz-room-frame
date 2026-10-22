// Settings with defaults and built-in scenes. Values follow what meeting-room cameras offer
// (group / people / speaker / presenter, speed slow-normal-fast, padding, dead band).

import type { Framing, Layout, RoomZones, Scene } from './types';
import { DEFAULT_PTZ, type PtzSettings } from './ptz';
import { DEFAULT_ATEM, type AtemSettings } from './atem';

export type Accuracy = 'fast' | 'accurate' | 'max';
export type SpeakerSource = 'off' | 'auto' | 'external';

export interface OutputSettings {
  width: number;
  height: number;
  fps: number;
  background: string;
  gap: number; // px between tiles
  radius: number; // px tile corners
  highlight: string; // speaker frame colour
  window: { enabled: boolean; displayId: number | null };
  ndi: { enabled: boolean; name: string };
  stream: { enabled: boolean; url: string; bitrate: number };
  v4l2: { enabled: boolean; device: string };
}

export interface InputSettings {
  kind: 'device' | 'network' | 'file';
  deviceId: string;
  /** 0 = highest the device offers */
  width: number;
  height: number;
  fps: number;
  url: string;
  file: string;
  mirror: boolean;
}

export interface Settings {
  input: InputSettings;
  framing: Framing;
  zones: RoomZones;
  accuracy: Accuracy;
  detectHz: number;
  speaker: { source: SpeakerSource; micId: string; threshold: number };
  scenes: Scene[];
  activeScene: string | null;
  layouts: Layout[];
  /** person count → custom layout id; missing = auto layout */
  layoutByCount: Record<string, string>;
  output: OutputSettings;
  /** second picture from the same camera: own size and scene, out via NDI and window */
  programB: { enabled: boolean; width: number; height: number; scene: string; ndi: { enabled: boolean; name: string }; window: { enabled: boolean; displayId: number | null } };
  control: { http: number; tcp: number; enabled: boolean };
  ptz: PtzSettings;
  atem: AtemSettings;
  app: { autostart: boolean; startHidden: boolean };
}

export const DEFAULT_FRAMING: Framing = {
  mode: 'people', shot: 'mcu', style: 'grid', headroom: 0.12, padding: 0.15, deadband: 0.08,
  speed: 'normal', transition: 'smooth', holdTime: 3, maxPeople: 9, maxUpscale: 2.5,
  speakerFallback: 4, highlightSpeaker: true, showLabels: false, layout: null,
};

const scene = (id: string, name: string, f: Partial<Framing>): Scene => ({ id, name, framing: { ...DEFAULT_FRAMING, ...f } });

export const BUILTIN_SCENES: Scene[] = [
  scene('group', 'Gruppe', { mode: 'group', speed: 'slow', padding: 0.18 }),
  scene('tiles', 'Kacheln', { mode: 'people', style: 'grid', shot: 'mcu' }),
  scene('tiles-center', 'Kacheln mit Übersicht', { mode: 'people', style: 'center', shot: 'mcu' }),
  scene('speaker', 'Sprecher', { mode: 'speaker', shot: 'mcu', transition: 'fade' }),
  scene('speaker-strip', 'Sprecher + Leiste', { mode: 'people', style: 'speaker', shot: 'mcu' }),
  scene('group-pip', 'Gruppe + Nah als PiP', { mode: 'people', layout: 'tpl-group-pip', transition: 'fade' }),
  scene('presenter', 'Präsentator', { mode: 'presenter', shot: 'medium', speed: 'slow', deadband: 0.12 }),
  scene('overview', 'Übersicht', { mode: 'overview' }),
];

export const DEFAULT_SETTINGS: Settings = {
  input: { kind: 'device', deviceId: '', width: 0, height: 0, fps: 30, url: '', file: '', mirror: false },
  framing: BUILTIN_SCENES[1].framing,
  zones: { boundary: { x: 0, y: 0, w: 1, h: 1 }, exclusions: [], minHead: 0.025, speakerZones: [] },
  accuracy: 'accurate',
  detectHz: 6,
  speaker: { source: 'off', micId: '', threshold: 0.04 },
  scenes: BUILTIN_SCENES,
  activeScene: 'tiles',
  layouts: [],
  layoutByCount: {},
  output: {
    width: 1920, height: 1080, fps: 30, background: '#101114', gap: 4, radius: 0, highlight: '#4FC3F7',
    window: { enabled: false, displayId: null },
    ndi: { enabled: false, name: 'LZ Room Frame' },
    stream: { enabled: false, url: '', bitrate: 6000 },
    v4l2: { enabled: false, device: '/dev/video10' },
  },
  programB: { enabled: false, width: 1080, height: 1920, scene: 'speaker', ndi: { enabled: true, name: 'LZ Room Frame B' }, window: { enabled: false, displayId: null } },
  control: { http: 4197, tcp: 4198, enabled: true },
  ptz: DEFAULT_PTZ,
  atem: DEFAULT_ATEM,
  app: { autostart: false, startHidden: false },
};

/** Deep merge of stored values over the defaults (new settings get their default). */
export function mergeSettings(stored: unknown): Settings {
  const merge = (d: any, s: any): any => {
    if (Array.isArray(d)) return Array.isArray(s) ? s : d;
    if (d && typeof d === 'object') {
      const out: any = { ...d };
      if (s && typeof s === 'object') for (const k of Object.keys(s)) out[k] = k in d ? merge(d[k], s[k]) : s[k];
      return out;
    }
    return s === undefined || s === null || typeof s !== typeof d ? (d === null ? s ?? null : d) : s;
  };
  const out = merge(DEFAULT_SETTINGS, stored) as Settings;
  // scenes stored before a built-in was added: keep the user's, append new built-ins
  for (const b of BUILTIN_SCENES) if (!out.scenes.some((s) => s.id === b.id)) out.scenes.push(b);
  out.scenes = out.scenes.map((s) => ({ ...s, framing: { ...DEFAULT_FRAMING, ...s.framing } }));
  return out;
}

export const OUTPUT_PRESETS: { label: string; w: number; h: number }[] = [
  { label: '720p', w: 1280, h: 720 },
  { label: '1080p', w: 1920, h: 1080 },
  { label: '1440p', w: 2560, h: 1440 },
  { label: '4K UHD', w: 3840, h: 2160 },
  { label: 'Hochformat 1080', w: 1080, h: 1920 },
  { label: 'Quadrat 1080', w: 1080, h: 1080 },
];
