// CI end-to-end check of the Windows virtual camera: register, feed a solid colour like the
// app does, read the camera like Teams would, compare.
import { execFileSync, spawn } from 'node:child_process';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

const bin = join('helpers', 'bin');
console.log(execFileSync(join(bin, 'lz-vcam.exe'), ['--register']).toString());
console.log('probe', execFileSync(join(bin, 'lz-vcam.exe'), ['--probe']).toString().trim());
const feed = spawn(join(bin, 'lz-vcam.exe'), [], { stdio: ['pipe', 'inherit', 'inherit'] });
feed.stdin.on('error', () => {});
feed.on('exit', (c) => { if (c) { console.error(`lz-vcam exited ${c}`); process.exit(1); } });
const w = 1280, h = 720, frame = Buffer.alloc(16 + w * h * 4);
frame.write('LZRF', 0); frame.writeUInt32LE(w, 4); frame.writeUInt32LE(h, 8); frame.writeUInt32LE(30, 12);
for (let i = 16; i < frame.length; i += 4) { frame[i] = 200; frame[i + 1] = 50; frame[i + 2] = 100; frame[i + 3] = 255; }
const timer = setInterval(() => { if (!feed.stdin.writableNeedDrain) feed.stdin.write(frame); }, 33);
await new Promise((r) => setTimeout(r, 3000));
let out = '';
try { out = execFileSync(join(bin, 'vcam-test.exe'), { timeout: 60000 }).toString(); } catch (e) { out = String(e.stdout ?? e); }
console.log(out);
try { console.log(readFileSync(join(process.env.ProgramData, 'LZ Room Frame', 'vcam.log'), 'utf8')); } catch (e) { console.log('no vcam.log', e.message); }
clearInterval(timer); feed.stdin.end();
const res = JSON.parse(out.trim().split('\n').pop());
const near = (a, b) => Math.abs(a - b) <= 12;
if (!res.ok || !near(res.r, 200) || !near(res.g, 50) || !near(res.b, 100)) { console.error('virtual camera check failed'); process.exit(1); }
console.log('virtual camera delivers the fed picture');
process.exit(0);
