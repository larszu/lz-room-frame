// Main-thread side of the detection worker (detector.worker.ts). The source frame goes over
// as an ImageBitmap (at most 3840 px wide), so the output loop never waits for the models.

import type { Accuracy } from './settings';
import type { DetectRequest, DetectResult } from './detector.worker';
import type { Detection, Rect } from './types';

export const detectorStatus = { delegate: '', error: '', ms: 0 };

const worker = new Worker(new URL('./detector.worker.ts', import.meta.url), { type: 'module' });
let waiting: ((r: DetectResult) => void) | null = null;
worker.onmessage = (ev: MessageEvent<DetectResult>) => { const w = waiting; waiting = null; w?.(ev.data); };
worker.onerror = (ev) => { detectorStatus.error = ev.message; const w = waiting; waiting = null; w?.({ dets: [], mouths: null, ms: 0, delegate: '', error: ev.message }); };

export async function detect(src: CanvasImageSource, W: number, H: number, acc: Accuracy, mouths: Rect[] | null = null): Promise<{ dets: Detection[]; mouths: (number | null)[] | null }> {
  if (waiting) return { dets: [], mouths: null };
  const k = Math.min(1, 3840 / W);
  const bitmap = await createImageBitmap(src as ImageBitmapSource, k < 1 ? { resizeWidth: Math.round(W * k), resizeHeight: Math.round(H * k), resizeQuality: 'medium' } : {});
  const base = new URL('.', location.href).href;
  const res = await new Promise<DetectResult>((ok) => {
    waiting = ok;
    worker.postMessage({ bitmap, W, H, acc, base, mouths } satisfies DetectRequest, [bitmap]);
  });
  detectorStatus.ms = res.ms;
  if (res.delegate) detectorStatus.delegate = res.delegate;
  detectorStatus.error = res.error ?? '';
  if (res.error) throw new Error(res.error);
  return { dets: res.dets, mouths: res.mouths };
}
