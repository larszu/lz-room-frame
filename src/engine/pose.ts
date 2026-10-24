// From RTMO's body keypoints (COCO order) to the head box the framing works with. Points on
// the face (nose, eyes, ears) are found for half faces at the picture edge, in profile and
// from behind (ears), where a face detector gives up.

import type { Rect } from './types';

/** COCO keypoints: 0 nose, 1/2 eyes, 3/4 ears, 5/6 shoulders. [x, y, score] each. */
export type Keypoints = [number, number, number][];

const MIN = 0.3;

const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

/** Head box from the keypoints, or null when no face point is sure enough. */
export function headFromKeypoints(k: Keypoints): Rect | null {
  const ok = (i: number) => k[i] && k[i][2] >= MIN;
  const face = [0, 1, 2, 3, 4].filter(ok);
  if (!face.length) return null;
  const d = (a: number, b: number) => Math.hypot(k[a][0] - k[b][0], k[a][1] - k[b][1]);
  // head width from whatever pairs are visible; each ratio is the head width per distance
  const sizes: number[] = [];
  if (ok(1) && ok(2)) sizes.push(d(1, 2) * 2.5);
  if (ok(3) && ok(4)) sizes.push(d(3, 4) * 1.15);
  if (ok(5) && ok(6)) sizes.push(d(5, 6) * 0.55);
  if (ok(0) && ok(1)) sizes.push(d(0, 1) * 3.6);
  if (ok(0) && ok(2)) sizes.push(d(0, 2) * 3.6);
  if (ok(1) && ok(3)) sizes.push(d(1, 3) * 2.4);
  if (ok(2) && ok(4)) sizes.push(d(2, 4) * 2.4);
  if (!sizes.length) return null;
  const w = median(sizes), h = w * 1.25;
  const x = face.reduce((s, i) => s + k[i][0], 0) / face.length;
  // eye line sits a little below the middle of the head box (hair above)
  const eyes = [1, 2].filter(ok), ears = [3, 4].filter(ok);
  const line = eyes.length ? eyes : ears.length ? ears : [0];
  const ey = line.reduce((s, i) => s + k[i][1], 0) / line.length + (line[0] === 0 ? -w * 0.15 : 0);
  return { x: x - w / 2, y: ey - h * 0.5, w, h };
}
