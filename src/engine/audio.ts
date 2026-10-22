// Who speaks, from one microphone or one stereo pair: any audio input of the computer – the
// camera's own sound through an HDMI/SDI capture card (e.g. a mirrorless camera), USB audio,
// a 3.5 mm line or mic jack.
//
// Mono gives no direction: it only says *that* someone speaks; lip movement decides who.
// Stereo adds a rough left-right direction from the level difference (coincident / XY mics)
// and the time difference (spaced mics, GCC-PHAT). No front/back, so the camera should sit
// on the same side as the mic. A two-point calibration maps that direction onto the picture.

/** In-place radix-2 FFT (re, im of length 2^n). */
export function fft(re: Float64Array, im: Float64Array, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

/**
 * Time difference between the channels by GCC-PHAT: lag in samples (positive = the sound
 * reaches the left channel first, i.e. comes from the left) and the peak sharpness 0…1.
 */
export function gccPhat(l: Float32Array, r: Float32Array, maxLag: number): { lag: number; peak: number } {
  let n = 1; while (n < l.length * 2) n <<= 1;
  const lr = new Float64Array(n), li = new Float64Array(n), rr = new Float64Array(n), ri = new Float64Array(n);
  for (let i = 0; i < l.length; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (l.length - 1)); // Hann
    lr[i] = l[i] * w; rr[i] = r[i] * w;
  }
  fft(lr, li); fft(rr, ri);
  // cross spectrum R · conj(L), whitened (PHAT)
  for (let k = 0; k < n; k++) {
    const xr = rr[k] * lr[k] + ri[k] * li[k], xi = ri[k] * lr[k] - rr[k] * li[k];
    const m = Math.hypot(xr, xi) || 1e-12;
    lr[k] = xr / m; li[k] = xi / m;
  }
  fft(lr, li, true);
  let best = 0, bv = -Infinity, sum = 0, cnt = 0;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const v = lr[(lag + n) % n];
    sum += Math.abs(v); cnt++;
    if (v > bv) { bv = v; best = lag; }
  }
  const mean = sum / Math.max(1, cnt);
  return { lag: best, peak: bv > 0 ? Math.min(1, (bv - mean) / (bv + 1e-9)) : 0 };
}

export const rms = (x: Float32Array) => { let s = 0; for (const v of x) s += v * v; return Math.sqrt(s / Math.max(1, x.length)); };

/** Level difference left − right in dB. */
export const ildDb = (l: Float32Array, r: Float32Array) => 20 * Math.log10((rms(l) + 1e-9) / (rms(r) + 1e-9));

/**
 * One direction value −1 (left) … +1 (right) from level and time difference. Coincident
 * (XY, camera-top) mics only differ in level, spaced ones mostly in time; both are mixed.
 */
export function stereoPan(ild: number, lag: number, maxLag: number, peak: number) {
  const fromLevel = Math.max(-1, Math.min(1, -ild / 12));
  const fromTime = maxLag ? Math.max(-1, Math.min(1, -lag / maxLag)) : 0;
  const w = Math.min(1, peak * 1.5); // a sharp correlation peak trusts the time difference
  return fromLevel * (1 - w * 0.6) + fromTime * w * 0.6;
}

/** Least-squares line y = a·x + b through calibration points. */
export function fitLine(pts: { pan: number; x: number }[]): { a: number; b: number } | null {
  if (pts.length < 2) return null;
  const n = pts.length, mx = pts.reduce((s, p) => s + p.pan, 0) / n, my = pts.reduce((s, p) => s + p.x, 0) / n;
  let sxx = 0, sxy = 0;
  for (const p of pts) { sxx += (p.pan - mx) ** 2; sxy += (p.pan - mx) * (p.x - my); }
  if (sxx < 1e-6) return null;
  const a = sxy / sxx;
  return { a, b: my - a * mx };
}

/** Picture position 0…1 for a direction, with or without calibration. */
export function panToX(pan: number, calib: { a: number; b: number } | null, width: number, swap: boolean) {
  const p = swap ? -pan : pan;
  const x = calib ? calib.a * p + calib.b : 0.5 + p * 0.5 * width;
  return Math.max(0, Math.min(1, x));
}

/** How well a person at picture position `x` matches the sound direction (0…1). */
export const directionMatch = (x: number, audioX: number, sigma: number) => Math.exp(-((x - audioX) ** 2) / (2 * sigma * sigma));

/** Simple voice activity: loud enough and not a flat (noise-like) spectrum. */
export function voiceLike(level: number, threshold: number, flatness: number) {
  return level > threshold && flatness < 0.45;
}

/** Spectral flatness 0 (tonal, voice) … 1 (white noise) of a frame. */
export function flatness(x: Float32Array) {
  let n = 1; while (n < x.length) n <<= 1;
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < x.length; i++) re[i] = x[i];
  fft(re, im);
  // speech band ≈ bins for 200 Hz … 4 kHz at 48 kHz with n = 2048 → 8 … 170
  const lo = Math.max(1, Math.round(n / 240)), hi = Math.min(n / 2, Math.round(n / 12));
  let logSum = 0, sum = 0, cnt = 0;
  for (let k = lo; k < hi; k++) { const p = re[k] * re[k] + im[k] * im[k] + 1e-12; logSum += Math.log(p); sum += p; cnt++; }
  return Math.exp(logSum / cnt) / (sum / cnt);
}

export interface AudioReading { level: number; levelL: number; levelR: number; voice: boolean; pan: number | null; confidence: number }

/** Live analysis of one audio input (mono or the first two channels). */
export class AudioAnalyzer {
  private ctx: AudioContext | null = null;
  private an: AnalyserNode[] = [];
  private stream: MediaStream | null = null;
  private bufs: Float32Array[] = [];
  channels = 0;
  /** two channels with identical samples: a mono source sent as stereo (e.g. built-in mics) */
  dualMono = false;
  sampleRate = 48000;
  label = '';
  error = '';
  private pan = 0;
  private panConf = 0;
  last: AudioReading = { level: 0, levelL: 0, levelR: 0, voice: false, pan: null, confidence: 0 };

  async start(deviceId: string, stereo: boolean) {
    this.stop();
    this.error = '';
    try {
      // no echo cancelling, noise suppression or AGC: they mix down and destroy the stereo cues
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: deviceId ? { exact: deviceId } : undefined, channelCount: { ideal: stereo ? 2 : 1 }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: false,
      });
      const t = this.stream.getAudioTracks()[0];
      this.label = t.label;
      this.ctx = new AudioContext();
      this.sampleRate = this.ctx.sampleRate;
      const src = this.ctx.createMediaStreamSource(this.stream);
      const ch = Math.min(2, src.channelCount || t.getSettings().channelCount || 1);
      this.channels = stereo ? ch : 1;
      if (this.channels === 2) {
        const split = this.ctx.createChannelSplitter(2);
        src.connect(split);
        for (let i = 0; i < 2; i++) { const a = this.ctx.createAnalyser(); a.fftSize = 2048; split.connect(a, i); this.an.push(a); }
      } else {
        const a = this.ctx.createAnalyser(); a.fftSize = 2048; src.connect(a); this.an.push(a);
      }
      this.bufs = this.an.map(() => new Float32Array(2048));
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      this.stop(false);
    }
  }

  /** Reads the newest audio frame; call ~20× per second. */
  read(threshold: number): AudioReading {
    if (!this.an.length) return this.last;
    this.an.forEach((a, i) => a.getFloatTimeDomainData(this.bufs[i] as Float32Array<ArrayBuffer>));
    const L = this.bufs[0], R = this.bufs[1] ?? this.bufs[0];
    const levelL = rms(L), levelR = rms(R), level = Math.max(levelL, levelR);
    if (this.channels === 2 && level > 1e-4) {
      let d = 0; for (let i = 0; i < L.length; i += 4) d = Math.max(d, Math.abs(L[i] - R[i]));
      this.dualMono = d < 1e-6;
    }
    const mixed = this.channels === 2 ? L.map((v, i) => (v + R[i]) / 2) : L;
    const voice = voiceLike(level, threshold, flatness(mixed));
    if (this.channels === 2 && voice && !this.dualMono) {
      const maxLag = Math.round(this.sampleRate * 0.0008); // up to ~27 cm spacing
      const g = gccPhat(L, R, maxLag);
      const p = stereoPan(ildDb(L, R), g.lag, maxLag, g.peak);
      this.pan = this.panConf ? this.pan * 0.6 + p * 0.4 : p;
      this.panConf = Math.min(1, this.panConf * 0.7 + 0.3);
    } else this.panConf *= 0.9;
    this.last = { level, levelL, levelR, voice, pan: this.channels === 2 && this.panConf > 0.25 ? this.pan : null, confidence: this.panConf };
    return this.last;
  }

  stop(clearError = true) {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
    this.ctx = null; this.an = []; this.stream = null; this.bufs = []; this.channels = 0;
    if (clearError) this.error = '';
  }
}
