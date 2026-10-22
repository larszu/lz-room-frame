// Outputs fed with raw RGBA frames from the renderer: NDI (helper lz-ndi-send), a stream
// (ffmpeg → RTMP / SRT / RTSP / UDP) and the Linux virtual camera (ffmpeg → v4l2loopback).
// A slow output skips frames instead of piling them up.
const { spawn, execFileSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

function helperPath(name) {
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  const base = app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked', 'helpers', 'bin') : path.join(__dirname, '..', 'helpers', 'bin');
  return path.join(base, exe);
}

function ffmpegPath() {
  try {
    let p = require('ffmpeg-static');
    if (p && app.isPackaged) p = p.replace('app.asar', 'app.asar.unpacked');
    if (p && existsSync(p)) return p;
  } catch { /* not installed */ }
  return 'ffmpeg';
}

function hasFfmpeg() {
  try { execFileSync(ffmpegPath(), ['-version'], { stdio: 'ignore', timeout: 5000 }); return true; } catch { return false; }
}

function probeNdi() {
  const p = helperPath('lz-ndi-send');
  if (!existsSync(p)) return { ok: false, error: 'NDI-Helfer fehlt in diesem Build' };
  try { return JSON.parse(execFileSync(p, ['--probe'], { timeout: 5000 }).toString().trim()); }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
}

/** Output format and arguments for a stream URL. */
function streamArgs(url, fps, bitrate) {
  const enc = ['-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p', '-g', String(fps * 2), '-b:v', `${bitrate}k`, '-maxrate', `${bitrate}k`, '-bufsize', `${bitrate * 2}k`];
  if (/^rtmps?:/i.test(url)) return [...enc, '-f', 'flv', url];
  // SRT/UDP receivers join mid-stream: repeat SPS/PPS with every keyframe
  const ts = [...enc, '-x264-params', 'repeat-headers=1', '-f', 'mpegts', url];
  if (/^srt:/i.test(url)) return ts;
  if (/^rtsp:/i.test(url)) return [...enc, '-f', 'rtsp', '-rtsp_transport', 'tcp', url];
  if (/^(udp|rtp):/i.test(url)) return ts;
  return null;
}

class Sink {
  constructor(name) { this.name = name; this.proc = null; this.key = ''; this.state = { on: false, ok: false, message: '' }; this.busy = false; }
  start(cmd, args, key) {
    if (this.proc && this.key === key) return;
    this.stop();
    this.key = key;
    this.state = { on: true, ok: true, message: 'läuft' };
    let err = '';
    const p = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    this.proc = p;
    p.stderr.on('data', (d) => { err = (err + d.toString()).slice(-600); });
    p.stdin.on('error', () => {});
    p.on('error', (e) => { this.state = { on: true, ok: false, message: e.code === 'ENOENT' ? `${path.basename(cmd)} nicht gefunden` : e.message }; this.onChange?.(); });
    p.on('exit', (code) => {
      if (this.proc !== p) return;
      this.proc = null; this.key = '';
      const last = err.trim().split('\n').pop() || '';
      this.state = { on: true, ok: false, message: code ? `beendet (${code}) ${last}`.trim() : 'beendet' };
      this.onChange?.();
    });
    this.onChange?.();
  }
  write(buf) {
    const p = this.proc;
    if (!p || !p.stdin.writable) return;
    if (p.stdin.writableNeedDrain) return; // skip: the output is slower than the picture
    p.stdin.write(buf);
  }
  stop() {
    const p = this.proc; this.proc = null; this.key = '';
    if (p) { try { p.stdin.end(); } catch { /* gone */ } setTimeout(() => { try { p.kill(); } catch { /* gone */ } }, 1500); }
    this.state = { on: false, ok: false, message: '' };
  }
}

class Sinks {
  constructor() {
    this.ndi = new Sink('ndi'); this.ndiB = new Sink('ndiB'); this.stream = new Sink('stream'); this.v4l2 = new Sink('v4l2');
    this.cfg = null;
    for (const s of this.all()) s.onChange = () => this.onChange?.();
  }
  all() { return [this.ndi, this.ndiB, this.stream, this.v4l2]; }
  /** cfg: { width, height, fps, ndi: {enabled,name}, stream: {enabled,url,bitrate}, v4l2: {enabled,device} } */
  configure(cfg) {
    this.cfg = cfg;
    const { width: w, height: h, fps } = cfg;
    const raw = ['-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-r', String(fps), '-i', '-'];
    if (cfg.ndi?.enabled) this.ndi.start(helperPath('lz-ndi-send'), [cfg.ndi.name || 'LZ Room Frame'], `${cfg.ndi.name}`);
    else this.ndi.stop();
    if (cfg.ndiB?.enabled) this.ndiB.start(helperPath('lz-ndi-send'), [cfg.ndiB.name || 'LZ Room Frame B'], `${cfg.ndiB.name}`);
    else this.ndiB.stop();
    const sargs = cfg.stream?.enabled ? streamArgs(cfg.stream.url || '', fps, cfg.stream.bitrate || 6000) : null;
    if (cfg.stream?.enabled && !sargs) { this.stream.stop(); this.stream.state = { on: true, ok: false, message: 'Adresse muss mit rtmp://, rtmps://, srt://, rtsp://, udp:// oder rtp:// beginnen' }; }
    else if (sargs) this.stream.start(ffmpegPath(), [...raw, ...sargs], `${w}x${h}@${fps} ${cfg.stream.url} ${cfg.stream.bitrate}`);
    else this.stream.stop();
    if (cfg.v4l2?.enabled && process.platform === 'linux') this.v4l2.start(ffmpegPath(), [...raw, '-pix_fmt', 'yuv420p', '-f', 'v4l2', cfg.v4l2.device || '/dev/video10'], `${w}x${h}@${fps} ${cfg.v4l2.device}`);
    else { this.v4l2.stop(); if (cfg.v4l2?.enabled) this.v4l2.state = { on: true, ok: false, message: 'Nur unter Linux (v4l2loopback)' }; }
    this.onChange?.();
  }
  /** One frame: 16-byte header "LZRF" w h fps + RGBA. */
  frame(buf) {
    const c = this.cfg; if (!c) return;
    if (buf[3] === 0x42) { // "LZRB": program B; the helper reads "LZRF" frames
      if (this.ndiB.proc) { buf[3] = 0x46; this.ndiB.write(buf); }
      return;
    }
    const w = buf.readUInt32LE(4), h = buf.readUInt32LE(8);
    if (this.ndi.proc) this.ndi.write(buf);
    if (w !== c.width || h !== c.height) return; // ffmpeg outputs need the configured size
    const pixels = buf.subarray(16);
    if (this.stream.proc) this.stream.write(pixels);
    if (this.v4l2.proc) this.v4l2.write(pixels);
  }
  status() { return { ndi: this.ndi.state, ndiB: this.ndiB.state, stream: this.stream.state, v4l2: this.v4l2.state }; }
  stopAll() { for (const s of this.all()) s.stop(); }
}

/** Network inputs (RTSP, SRT, HTTP, NDI via ffmpeg's libndi is not in static builds) → MJPEG for the renderer. */
class NetworkInput {
  constructor() { this.proc = null; this.clients = new Set(); this.frame = null; this.buf = Buffer.alloc(0); }
  start(url) {
    this.stop();
    if (!/^(rtsp|rtsps|srt|rtmp|rtmps|http|https|udp|rtp):\/\//i.test(url)) return { ok: false, error: 'Adresse muss mit rtsp://, srt://, rtmp://, http(s)://, udp:// oder rtp:// beginnen' };
    const args = ['-hide_banner', '-loglevel', 'error', '-fflags', 'nobuffer', '-flags', 'low_delay'];
    if (/^rtsp/i.test(url)) args.push('-rtsp_transport', 'tcp');
    args.push('-i', url, '-an', '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '3', '-');
    const p = spawn(ffmpegPath(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc = p;
    p.stdout.on('data', (d) => this.onData(d));
    p.on('error', () => {});
    return { ok: true };
  }
  onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      const s = this.buf.indexOf(Buffer.from([0xff, 0xd8]));
      if (s < 0) { this.buf = Buffer.alloc(0); return; }
      const e = this.buf.indexOf(Buffer.from([0xff, 0xd9]), s + 2);
      if (e < 0) { if (s > 0) this.buf = this.buf.subarray(s); return; }
      const jpg = this.buf.subarray(s, e + 2);
      this.buf = this.buf.subarray(e + 2);
      this.frame = Buffer.from(jpg);
      for (const res of this.clients) writePart(res, this.frame);
    }
  }
  serve(res) {
    res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=lzrf', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    this.clients.add(res);
    if (this.frame) writePart(res, this.frame);
    res.on('close', () => this.clients.delete(res));
  }
  stop() { if (this.proc) { try { this.proc.kill(); } catch { /* gone */ } } this.proc = null; this.frame = null; this.buf = Buffer.alloc(0); }
}

function writePart(res, jpg) {
  if (res.writableNeedDrain) return;
  res.write(`--lzrf\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpg.length}\r\n\r\n`);
  res.write(jpg); res.write('\r\n');
}

module.exports = { Sinks, NetworkInput, probeNdi, hasFfmpeg, writePart };
