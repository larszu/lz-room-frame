// Detection off the main thread, so the output keeps its frame rate: RTMO-s finds people
// with their body keypoints (whole picture plus overlapping tiles), the head comes from the
// face keypoints, OSNet gives each person an appearance vector (same person back after
// leaving the picture), and on request the Face Landmarker measures how far each mouth is
// open (speaker detection).

import { FaceLandmarker } from '@mediapipe/tasks-vision';
import * as ort from 'onnxruntime-web/webgpu';
import { coverage, nms } from './geometry';
import { headFromKeypoints, type Keypoints } from './pose';
import type { Accuracy } from './settings';
import type { Detection, Rect } from './types';

export interface DetectRequest { bitmap: ImageBitmap; W: number; H: number; acc: Accuracy; base: string; mouths: Rect[] | null }
export interface DetectResult { dets: Detection[]; mouths: (number | null)[] | null; ms: number; delegate: string; error?: string }

const SIZE = 640;

let models: Promise<{ pose: ort.InferenceSession; reid: ort.InferenceSession | null; delegate: string }> | null = null;
let landmarker: Promise<FaceLandmarker> | null = null;

function getModels(base: string) {
  models ??= (async () => {
    ort.env.wasm.wasmPaths = `${base}ort/`;
    // threads need a cross-origin isolated page (SharedArrayBuffer)
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
    ort.env.logLevel = 'error';
    const open = async (file: string, ep: 'webgpu' | 'wasm') => ort.InferenceSession.create(`${base}models/${file}`, { executionProviders: [ep], graphOptimizationLevel: 'all' });
    let delegate = 'GPU', pose: ort.InferenceSession;
    try { pose = await open('rtmo-s.onnx', 'webgpu'); } catch (e) { console.warn('detector: WebGPU unavailable, using CPU', e); delegate = 'CPU'; pose = await open('rtmo-s.onnx', 'wasm'); }
    // the small re-identification model runs on the CPU: no GPU round trip for a few crops
    const reid = await open('osnet_ain_x0_25.onnx', 'wasm').catch((e) => { console.warn('detector: no re-identification', e); return null; });
    return { pose, reid, delegate };
  })();
  models.catch(() => { models = null; });
  return models;
}

let factory: unknown = null;
/** MediaPipe removes self.ModuleFactory after each model: set it again before every create. */
const arm = () => { (self as unknown as { ModuleFactory: unknown }).ModuleFactory = factory; };

function getLandmarker(base: string, delegate: string) {
  landmarker ??= (async () => {
    // the WASM glue is loaded here instead of by MediaPipe (its importScripts path leaves
    // ModuleFactory unset in this worker); an empty loader path makes MediaPipe skip it
    const glue = await (await fetch(`${base}mediapipe/vision_wasm_internal.js`)).text();
    factory = new Function(`${glue}\nreturn ModuleFactory;`)();
    const fileset = { wasmLoaderPath: '', wasmBinaryPath: `${base}mediapipe/vision_wasm_internal.wasm` };
    arm();
    return FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `${base}models/face_landmarker.task`, delegate: delegate === 'GPU' ? 'GPU' : 'CPU' }, runningMode: 'IMAGE', numFaces: 1,
    });
  })();
  landmarker.catch(() => { landmarker = null; });
  return landmarker;
}

const scratch = new OffscreenCanvas(SIZE, SIZE);
const sctx = scratch.getContext('2d', { willReadFrequently: true })!;

function crop(src: ImageBitmap, r: Rect, maxW: number) {
  const k = Math.min(1, maxW / r.w);
  scratch.width = Math.max(1, Math.round(r.w * k)); scratch.height = Math.max(1, Math.round(r.h * k));
  sctx.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, scratch.width, scratch.height);
  return 1 / k;
}

/** Overlapping tiles per accuracy, always including the whole picture. */
export function detectionTiles(W: number, H: number, acc: Accuracy): Rect[] {
  const tiles: Rect[] = [{ x: 0, y: 0, w: W, h: H }];
  const grid = acc === 'fast' ? null : acc === 'accurate' ? [2, 1] : [3, 2];
  if (!grid) return tiles;
  const [c, r] = grid, ov = 0.15;
  const tw = W / (c - (c - 1) * ov), th = H / (r - (r - 1) * ov);
  for (let j = 0; j < r; j++) for (let i = 0; i < c; i++) tiles.push({ x: i * tw * (1 - ov), y: j * th * (1 - ov), w: tw, h: th });
  return tiles;
}

const input = new Float32Array(3 * SIZE * SIZE);

/** RTMO on one tile: letterboxed into 640×640 (grey 114 padding, BGR, 0…255). */
async function poseTile(pose: ort.InferenceSession, src: ImageBitmap, t: Rect) {
  const k = Math.min(SIZE / t.w, SIZE / t.h);
  const w = Math.round(t.w * k), h = Math.round(t.h * k);
  scratch.width = SIZE; scratch.height = SIZE;
  sctx.fillStyle = 'rgb(114,114,114)'; sctx.fillRect(0, 0, SIZE, SIZE);
  sctx.drawImage(src, t.x, t.y, t.w, t.h, 0, 0, w, h);
  const px = sctx.getImageData(0, 0, SIZE, SIZE).data;
  const n = SIZE * SIZE;
  for (let i = 0; i < n; i++) { input[i] = px[i * 4 + 2]; input[n + i] = px[i * 4 + 1]; input[2 * n + i] = px[i * 4]; }
  const out = await pose.run({ input: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]) });
  const dets = out.dets.data as Float32Array, kps = out.keypoints.data as Float32Array;
  const res: { body: Rect; score: number; kp: Keypoints }[] = [];
  for (let i = 0; i < out.dets.dims[1]; i++) {
    const score = dets[i * 5 + 4];
    if (score < 0.15) continue;
    const at = (v: number, o: number) => o + v / k;
    const body = { x: at(dets[i * 5], t.x), y: at(dets[i * 5 + 1], t.y), w: (dets[i * 5 + 2] - dets[i * 5]) / k, h: (dets[i * 5 + 3] - dets[i * 5 + 1]) / k };
    const kp: Keypoints = [];
    for (let j = 0; j < 17; j++) { const o = (i * 17 + j) * 3; kp.push([at(kps[o], t.x), at(kps[o + 1], t.y), kps[o + 2]]); }
    res.push({ body, score, kp });
  }
  return res;
}

const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];

/** OSNet appearance vectors (L2-normalised) for the body boxes, 256×128 crops, RGB. */
async function embed(reid: ort.InferenceSession, src: ImageBitmap, boxes: Rect[]): Promise<Float32Array[]> {
  if (!boxes.length) return [];
  const RW = 128, RH = 256, n = RW * RH;
  const data = new Float32Array(boxes.length * 3 * n);
  boxes.forEach((b, j) => {
    const x = Math.max(0, b.x), y = Math.max(0, b.y);
    const w = Math.min(src.width, b.x + b.w) - x, h = Math.min(src.height, b.y + b.h) - y;
    scratch.width = RW; scratch.height = RH;
    if (w > 1 && h > 1) sctx.drawImage(src, x, y, w, h, 0, 0, RW, RH);
    const px = sctx.getImageData(0, 0, RW, RH).data;
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) data[j * 3 * n + c * n + i] = (px[i * 4 + c] / 255 - MEAN[c]) / STD[c];
  });
  const out = await reid.run({ input: new ort.Tensor('float32', data, [boxes.length, 3, RH, RW]) });
  const e = out.emb.data as Float32Array, d = out.emb.dims[1];
  return boxes.map((_, j) => {
    const v = e.slice(j * d, (j + 1) * d);
    let len = 0; for (let i = 0; i < d; i++) len += v[i] * v[i];
    len = Math.sqrt(len) || 1;
    for (let i = 0; i < d; i++) v[i] /= len;
    return v;
  });
}

let reidRound = 0;

async function run(q: DetectRequest): Promise<DetectResult> {
  const t0 = performance.now();
  const { pose, reid, delegate } = await getModels(q.base);
  const { bitmap: src, W } = q;
  const k = src.width / W; // the bitmap may be smaller than the source
  const found: (Detection & { kp: Keypoints })[] = [];
  for (const t of detectionTiles(src.width, src.height, q.acc)) {
    for (const d of await poseTile(pose, src, t)) {
      const b = d.body;
      // people cut off at an inner tile edge are found whole in a neighbour or the full picture
      const cut = t.w < src.width && ((b.x - t.x < 2 && t.x > 0) || (t.x + t.w - b.x - b.w < 2 && t.x + t.w < src.width - 1));
      if (b.w < 8 || b.h < 8 || cut) continue;
      found.push({ body: b, head: headFromKeypoints(d.kp), score: d.score, kp: d.kp });
    }
  }
  // a tile sees part of a person as a person of its own: drop boxes mostly inside a surer one
  const people = nms(found, 0.45).filter((p, i, all) => !all.some((o, j) => j !== i && o.score >= p.score && o.body.w * o.body.h > p.body.w * p.body.h && coverage(p.body, o.body) > 0.7));
  // unsure: may continue a tracked person (half at the edge, motion blur), never starts one;
  // RTMO scores a clearly visible person at 0.9 and more
  for (const p of people) if (p.score < 0.6 || !p.head) p.low = true;

  // appearance for re-identification: every person, a few per round when there are many
  if (reid && people.length) {
    const max = 8, start = people.length > max ? (reidRound++ * max) % people.length : 0;
    const pick = Array.from({ length: Math.min(max, people.length) }, (_, i) => people[(start + i) % people.length]).filter((p) => !p.low);
    const embs = await embed(reid, src, pick.map((p) => p.body));
    pick.forEach((p, i) => (p.emb = embs[i]));
  }

  const toSrc = (r: Rect): Rect => ({ x: r.x / k, y: r.y / k, w: r.w / k, h: r.h / k });
  const dets: Detection[] = people.map(({ kp: _kp, ...p }) => ({ ...p, body: toSrc(p.body), head: p.head && toSrc(p.head) }));

  let mouths: (number | null)[] | null = null;
  if (q.mouths) {
    const lm = await getLandmarker(q.base, delegate);
    mouths = q.mouths.map((m) => {
      const r = { x: m.x * k, y: m.y * k, w: m.w * k, h: m.h * k };
      if (r.w < 8 || r.h < 8) return null;
      crop(src, r, 192);
      const pts = lm.detect(scratch).faceLandmarks[0];
      if (!pts) return null;
      const faceH = Math.hypot(pts[10].x - pts[152].x, pts[10].y - pts[152].y) || 1;
      return Math.hypot(pts[13].x - pts[14].x, pts[13].y - pts[14].y) / faceH;
    });
  }
  src.close();
  return { dets, mouths, ms: Math.round(performance.now() - t0), delegate };
}

self.onmessage = async (ev: MessageEvent<DetectRequest>) => {
  try { (self as unknown as Worker).postMessage(await run(ev.data)); }
  catch (e) { ev.data.bitmap.close?.(); (self as unknown as Worker).postMessage({ dets: [], mouths: null, ms: 0, delegate: '', error: String(e) } satisfies DetectResult); }
};
