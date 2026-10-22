// Copies the MediaPipe WASM runtime to public/mediapipe and fetches the detection models to
// public/models (once, cached), so the app works offline and without a CDN.
import { cpSync, existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const from = join('node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const wasm = join('public', 'mediapipe');
mkdirSync(wasm, { recursive: true });
for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm']) {
  cpSync(join(from, f), join(wasm, f));
}

const base = 'https://storage.googleapis.com/mediapipe-models';
const models = {
  'efficientdet_lite0.tflite': `${base}/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite`,
  'blaze_face_short_range.tflite': `${base}/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite`,
  'face_landmarker.task': `${base}/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
};
mkdirSync(join('public', 'models'), { recursive: true });
for (const [name, url] of Object.entries(models)) {
  const to = join('public', 'models', name);
  if (existsSync(to) && statSync(to).size > 10000) continue;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  writeFileSync(to, Buffer.from(await res.arrayBuffer()));
  console.log(`model ${name} → public/models`);
}
