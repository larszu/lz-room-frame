// Copies the MediaPipe WASM runtime to public/mediapipe and fetches the detection models to
// public/models (once, cached), so the app works offline and without a CDN.
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const from = join('node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const wasm = join('public', 'mediapipe');
mkdirSync(wasm, { recursive: true });
for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm']) {
  cpSync(join(from, f), join(wasm, f));
}

// ONNX Runtime (WebGPU, else WASM) for RTMO and the re-identification model
const ort = join('public', 'ort');
mkdirSync(ort, { recursive: true });
for (const f of readdirSync(join('node_modules', 'onnxruntime-web', 'dist')).filter((f) => /^ort-wasm-.*\.(mjs|wasm)$/.test(f))) {
  cpSync(join('node_modules', 'onnxruntime-web', 'dist', f), join(ort, f));
}

const base = 'https://storage.googleapis.com/mediapipe-models';
const models = {
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

// RTMO-s (OpenMMLab, Apache-2.0): people with 17 body keypoints in one pass. Comes as a zip.
const rtmo = join('public', 'models', 'rtmo-s.onnx');
if (!(existsSync(rtmo) && statSync(rtmo).size > 1e6)) {
  const res = await fetch('https://download.openmmlab.com/mmpose/v1/projects/rtmo/onnx_sdk/rtmo-s_8xb32-600e_body7-640x640-dac2bf74_20231211.zip');
  if (!res.ok) throw new Error(`rtmo-s: HTTP ${res.status}`);
  const zip = join(tmpdir(), `lzrf-rtmo-${process.pid}.zip`), out = join(tmpdir(), `lzrf-rtmo-${process.pid}`);
  writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  mkdirSync(out, { recursive: true });
  // bsdtar (macOS, Windows) reads zip, GNU tar (Linux) does not: unzip there
  try { execFileSync('tar', ['-xf', zip, '-C', out], { stdio: 'ignore' }); } catch { execFileSync('unzip', ['-o', '-q', zip, '-d', out]); }
  cpSync(join(out, 'end2end.onnx'), rtmo);
  console.log('model rtmo-s.onnx → public/models');
}
