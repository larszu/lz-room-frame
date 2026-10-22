// Tracking data into a Blackmagic ATEM: a SuperSource box shows the camera (same input as
// ours) cropped to the tracked person, and the crop follows them. The ATEM does the picture,
// we only send numbers – no extra video path, no added delay.
//
// SuperSource units (as in lz-switcher-motion): the frame is 32 × 18 units, x/y are the
// centre of the whole (uncropped) scaled source with y up, size 0.07…1, crops per side in
// source units (0…32 left/right, 0…18 top/bottom). A box never enlarges: size ≤ 1, so the
// crop appears at most at its native size.

import type { Rect } from './types';

export const FRAME_W = 32;
export const FRAME_H = 18;

export interface AtemSettings {
  enabled: boolean;
  host: string;
  superSource: number; // 0-based
  box: number; // 0…3
  follow: 'main' | 'group';
  /** visible box centre and width in frame units */
  boxX: number;
  boxY: number;
  boxWidth: number;
}

export const DEFAULT_ATEM: AtemSettings = { enabled: false, host: '', superSource: 0, box: 0, follow: 'main', boxX: 8, boxY: -4.5, boxWidth: 14 };

export interface SsBox { x: number; y: number; size: number; cropped: boolean; cropTop: number; cropBottom: number; cropLeft: number; cropRight: number }

/**
 * Box settings that show the source region `crop` (source pixels of a W × H picture) with its
 * visible centre at (boxX, boxY) and `boxWidth` wide – or smaller when that would enlarge.
 */
export function ssBoxFor(crop: Rect, W: number, H: number, s: Pick<AtemSettings, 'boxX' | 'boxY' | 'boxWidth'>): SsBox {
  const wN = crop.w / W;
  const cropLeft = (crop.x / W) * FRAME_W, cropRight = (1 - (crop.x + crop.w) / W) * FRAME_W;
  const cropTop = (crop.y / H) * FRAME_H, cropBottom = (1 - (crop.y + crop.h) / H) * FRAME_H;
  const size = Math.min(1, Math.max(0.07, s.boxWidth / (FRAME_W * wN)));
  // visible centre = x + (cropLeft − cropRight)/2 · size ; y + (cropBottom − cropTop)/2 · size
  const x = s.boxX - ((cropLeft - cropRight) / 2) * size;
  const y = s.boxY - ((cropBottom - cropTop) / 2) * size;
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  return { x: r3(x), y: r3(y), size: r3(size), cropped: true, cropTop: r3(cropTop), cropBottom: r3(cropBottom), cropLeft: r3(cropLeft), cropRight: r3(cropRight) };
}

/** atem-connection raw units: x/y × 100, size and crops × 1000. */
export function toRaw(b: SsBox) {
  return {
    x: Math.round(b.x * 100), y: Math.round(b.y * 100), size: Math.round(b.size * 1000), cropped: b.cropped,
    cropTop: Math.round(b.cropTop * 1000), cropBottom: Math.round(b.cropBottom * 1000), cropLeft: Math.round(b.cropLeft * 1000), cropRight: Math.round(b.cropRight * 1000),
  };
}
