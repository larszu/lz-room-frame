// Detection off the main thread, so the output keeps its frame rate: EfficientDet-Lite0
// finds people (whole picture plus overlapping tiles), BlazeFace the head inside each person,
// and on request the Face Landmarker measures how far each mouth is open (speaker detection).

import { FaceDetector, FaceLandmarker, ObjectDetector } from '@mediapipe/tasks-vision';
import { iou, nms } from './geometry';
import type { Accuracy } from './settings';
import type { Detection, Rect } from './types';

export interface DetectRequest { bitmap: ImageBitmap; W: number; H: number; acc: Accuracy; base: string; mouths: Rect[] | null }
export interface DetectResult { dets: Detection[]; mouths: (number | null)[] | null; ms: number; delegate: string; error?: string }

let models: Promise<{ obj: ObjectDetector; face: FaceDetector; delegate: string; fileset: { wasmLoaderPath: string; wasmBinaryPath: string } }> | null = null;
let landmarker: Promise<FaceLandmarker> | null = null;
let factory: unknown = null;
/** MediaPipe removes self.ModuleFactory after each model: set it again before every create. */
const arm = () => { (self as unknown as { ModuleFactory: unknown }).ModuleFactory = factory; };

function getModels(base: string) {
  models ??= (async () => {
    // the WASM glue is loaded here instead of by MediaPipe (its importScripts path leaves
    // ModuleFactory unset in this worker); an empty loader path makes MediaPipe skip it
    const glue = await (await fetch(`${base}mediapipe/vision_wasm_internal.js`)).text();
    factory = new Function(`${glue}\nreturn ModuleFactory;`)();
    const fileset = { wasmLoaderPath: '', wasmBinaryPath: `${base}mediapipe/vision_wasm_internal.wasm` };
    const make = async (delegate: 'GPU' | 'CPU') => ({
      obj: (arm(), await ObjectDetector.createFromOptions(fileset, { baseOptions: { modelAssetPath: `${base}models/efficientdet_lite0.tflite`, delegate }, runningMode: 'IMAGE', scoreThreshold: 0.3, maxResults: 25, categoryAllowlist: ['person'] })),
      face: (arm(), await FaceDetector.createFromOptions(fileset, { baseOptions: { modelAssetPath: `${base}models/blaze_face_short_range.tflite`, delegate }, runningMode: 'IMAGE', minDetectionConfidence: 0.45 })),
      delegate, fileset,
    });
    try { return await make('GPU'); } catch (e) { console.warn('detector: GPU unavailable, using CPU', e); return make('CPU'); }
  })();
  models.catch(() => { models = null; });
  return models;
}

function getLandmarker(base: string) {
  landmarker ??= getModels(base).then((m) => (arm(), FaceLandmarker.createFromOptions(m.fileset, {
    baseOptions: { modelAssetPath: `${base}models/face_landmarker.task`, delegate: m.delegate as 'GPU' | 'CPU' }, runningMode: 'IMAGE', numFaces: 1,
  })));
  landmarker.catch(() => { landmarker = null; });
  return landmarker;
}

const scratch = new OffscreenCanvas(1, 1);
const sctx = scratch.getContext('2d')!;

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

let faceRound = 0;

async function run(q: DetectRequest): Promise<DetectResult> {
  const t0 = performance.now();
  const { obj, face, delegate } = await getModels(q.base);
  const { bitmap: src, W, H } = q;
  const k = src.width / W; // the bitmap may be smaller than the source
  const found: Detection[] = [];
  for (const t of detectionTiles(src.width, src.height, q.acc)) {
    const s = crop(src, t, 640);
    for (const d of obj.detect(scratch).detections) {
      const b = d.boundingBox; if (!b) continue;
      const body = { x: t.x + b.originX * s, y: t.y + b.originY * s, w: b.width * s, h: b.height * s };
      // people cut off at an inner tile edge are found whole in a neighbour or the full picture
      const cut = t.w < src.width && ((body.x - t.x < 2 && t.x > 0) || (t.x + t.w - body.x - body.w < 2 && t.x + t.w < src.width - 1));
      if (body.w < 8 || body.h < 8 || cut) continue;
      found.push({ body, head: null, score: d.categories[0]?.score ?? 0.5 });
    }
  }
  // a tile sees part of a person as a person of its own: drop boxes mostly inside a surer one
  const inner = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)) / (a.w * a.h);
  const people = nms(found, 0.45).filter((p, i, all) => !all.some((q, j) => j !== i && q.score >= p.score && q.body.w * q.body.h > p.body.w * p.body.h && inner(p.body, q.body) > 0.7));
  const maxFaces = 12;
  const start = people.length > maxFaces ? (faceRound++ * maxFaces) % people.length : 0;
  for (let i = 0; i < Math.min(maxFaces, people.length); i++) {
    const p = people[(start + i) % people.length];
    const side = Math.max(p.body.w, p.body.h * 0.45);
    const r: Rect = { x: Math.max(0, p.body.x + p.body.w / 2 - side / 2), y: Math.max(0, p.body.y - side * 0.08), w: 0, h: 0 };
    r.w = Math.min(side, src.width - r.x); r.h = Math.min(side, src.height - r.y);
    if (r.w < 16 || r.h < 16) continue;
    const s = crop(src, r, 256);
    let best: Rect | null = null, bs = 0;
    for (const d of face.detect(scratch).detections) {
      const b = d.boundingBox; if (!b) continue;
      const sc = d.categories[0]?.score ?? 0;
      if (sc > bs) { bs = sc; best = { x: r.x + b.originX * s, y: r.y + b.originY * s, w: b.width * s, h: b.height * s }; }
    }
    // BlazeFace boxes run brow to chin: add forehead and hair
    if (best) p.head = { x: best.x - best.w * 0.08, y: best.y - best.h * 0.32, w: best.w * 1.16, h: best.h * 1.36 };
  }
  // two body boxes around the same person (nested detections) find the same face: keep one
  const unique = people.filter((p, i) => !p.head || !people.some((q, j) => j !== i && q.head && iou(p.head!, q.head) > 0.35 && (q.score > p.score || (q.score === p.score && j < i))));
  // without a face a box needs more certainty, and close to the camera (big box) a real
  // person shows a face: big faceless boxes are mostly furniture
  const sure = unique.filter((p) => p.head || (p.score >= 0.4 && (p.body.h < src.height * 0.5 || p.score >= 0.85)));
  people.length = 0; people.push(...sure);
  // close to the camera (webcam, head and shoulders) the person detector often finds nobody
  // or no head: faces in the whole picture fill both gaps
  const fs = crop(src, { x: 0, y: 0, w: src.width, h: src.height }, 640);
  for (const d of face.detect(scratch).detections) {
    const b = d.boundingBox; if (!b) continue;
    const f = { x: b.originX * fs, y: b.originY * fs, w: b.width * fs, h: b.height * fs };
    const head = { x: f.x - f.w * 0.08, y: f.y - f.h * 0.32, w: f.w * 1.16, h: f.h * 1.36 };
    if (people.some((p) => p.head && iou(p.head, head) > 0.2)) continue;
    const owner = people.find((p) => !p.head && head.x + head.w / 2 > p.body.x && head.x + head.w / 2 < p.body.x + p.body.w && head.y >= p.body.y - head.h && head.y < p.body.y + p.body.h * 0.5);
    if (owner) { owner.head = head; continue; }
    if ((d.categories[0]?.score ?? 0) < 0.8) continue; // a face alone needs to be certain
    const bw = head.w * 3, bh = Math.min(src.height - head.y, head.h * 4);
    people.push({ body: { x: head.x + head.w / 2 - bw / 2, y: head.y, w: bw, h: Math.max(head.h, bh) }, head, score: d.categories[0]?.score ?? 0.5 });
  }
  const toSrc = (r: Rect): Rect => ({ x: r.x / k, y: r.y / k, w: r.w / k, h: r.h / k });
  const dets = people.map((p) => ({ ...p, body: toSrc(p.body), head: p.head && toSrc(p.head) }));

  let mouths: (number | null)[] | null = null;
  if (q.mouths) {
    const lm = await getLandmarker(q.base);
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
  catch (e) { ev.data.bitmap.close?.(); (self as unknown as Worker).postMessage({ dets: [], mouths: null, ms: 0, delegate: '', error: `${e} [importScripts: ${typeof (self as { importScripts?: unknown }).importScripts}, ModuleFactory: ${typeof (self as { ModuleFactory?: unknown }).ModuleFactory}]` } satisfies DetectResult); }
};
