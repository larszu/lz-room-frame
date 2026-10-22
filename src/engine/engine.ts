// The running engine in the renderer: opens the input, runs detection a few times per
// second, lets the director pick the shots, draws the output picture and feeds the outputs
// (output window, NDI / stream / virtual camera through the main process, preview JPEGs for
// the web remote). Settings live here and are stored in localStorage.

import { HELP, findScene, parseCommand } from './commands';
import { detect, detectorStatus } from './detector';
import { Director, type TileView } from './director';
import { LAYOUT_TEMPLATES } from './layouts';
import { ptzAim, ptzDrive, viscaPackets, STOP, type PtzDrive } from './ptz';
import { ssBoxFor, toRaw } from './atem';
import { personCrop, groupCrop, VirtualCamera } from './framing';
import { applyZones, fuseSpeaking, LipSpeaker, mouthRegion } from './speaker';
import { AudioAnalyzer, fitLine, panToX, type AudioReading } from './audio';
import { filterDetections, Tracker } from './tracker';
import { DEFAULT_SETTINGS, mergeSettings, type Settings } from './settings';
import type { Detection, Framing, Layout, Person } from './types';
import { desktop } from '../desktop';

const KEY = 'lzrf.settings.v1';

export interface SourceInfo { width: number; height: number; fps: number; label: string; error: string }

export interface Status {
  scene: string | null;
  sceneName: string;
  mode: Framing['mode'];
  persons: number;
  speaker: number | null;
  fps: number;
  detectMs: number;
  delegate: string;
  source: SourceInfo;
  output: { width: number; height: number };
  privacy: boolean;
  frozen: boolean;
  sinks: Record<string, { on: boolean; ok: boolean; message: string }>;
}

type SourceEl = HTMLVideoElement | HTMLImageElement;

export class Engine {
  settings: Settings;
  readonly canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d', { alpha: false })!;
  private el: SourceEl | null = null;
  private stream: MediaStream | null = null;
  source: SourceInfo = { width: 0, height: 0, fps: 0, label: '', error: '' };
  readonly tracker = new Tracker();
  readonly director = new Director();
  /** program B: a second picture in its own format and scene (e.g. 9:16), same camera and people */
  readonly canvasB = document.createElement('canvas');
  private ctxB = this.canvasB.getContext('2d', { alpha: false })!;
  readonly directorB = new Director();
  viewsB: TileView[] = [];
  /** follows the main person for the ATEM SuperSource box */
  private atemCam = new VirtualCamera();
  private lastAtem = '';
  private lastAtemSent = 0;
  private lastTracking = 0;
  ptzDrive: PtzDrive = STOP;
  private ptzKey = '';
  readonly audio = new AudioAnalyzer();
  audioReading: AudioReading = this.audio.last;
  /** sound direction as picture position 0…1 (stereo), null without */
  audioX: number | null = null;
  private lastAudio = 0;
  /** calibration points collected while one person speaks */
  calibPoints: { pan: number; x: number }[] = [];
  private lips = new LipSpeaker();
  persons: Person[] = [];
  views: TileView[] = [];
  lastDetections: Detection[] = [];
  privacy = false;
  forcedSpeaker: number | null = null;
  presenter: number | null = null;
  activeZones = new Set<number>();
  sinks: Status['sinks'] = {};
  private listeners = new Set<() => void>();
  private timer = 0;
  private lastTick = 0;
  private lastDetect = 0;
  private detecting = false;
  private fpsCount = 0; private fpsT = 0; fps = 0;
  private ws: WebSocket | null = null;
  private outWins: Record<'a' | 'b', { win: Window; ctx: CanvasRenderingContext2D } | null> = { a: null, b: null };
  private preview = document.createElement('canvas');
  private lastPreview = 0;
  private lastEvent = '';
  private version = 0;

  constructor() {
    let stored: unknown = null;
    try { stored = JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { /* fresh start */ }
    this.settings = mergeSettings(stored ?? DEFAULT_SETTINGS);
    this.resize();
    this.loop();
    desktop?.onCommand((line) => this.exec(line));
    this.connectFrames();
    this.applySpeakerSource();
  }

  // ------------------------------------------------------------ state

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getVersion = () => this.version;
  private emit() { this.version++; this.listeners.forEach((f) => f()); }

  update(fn: (s: Settings) => void) {
    const before = JSON.stringify(this.settings.output) + JSON.stringify(this.settings.programB) + JSON.stringify(this.settings.input) + this.settings.speaker.source + this.settings.speaker.micId + this.settings.speaker.channels;
    fn(this.settings);
    try { localStorage.setItem(KEY, JSON.stringify(this.settings)); } catch { /* full or blocked */ }
    const after = JSON.stringify(this.settings.output) + JSON.stringify(this.settings.programB) + JSON.stringify(this.settings.input) + this.settings.speaker.source + this.settings.speaker.micId + this.settings.speaker.channels;
    if (before !== after) { this.resize(); this.syncSinks(); this.applySpeakerSource(); }
    this.emit();
  }

  /** Changing framing parameters by hand detaches from the scene (shown as "geändert"). */
  setFraming(patch: Partial<Framing>) { this.update((s) => { s.framing = { ...s.framing, ...patch }; }); }

  recallScene(id: string) {
    const sc = this.settings.scenes.find((s) => s.id === id);
    if (!sc) return false;
    this.update((s) => { s.framing = { ...sc.framing }; s.activeScene = sc.id; });
    return true;
  }

  get sceneDirty() {
    const sc = this.settings.scenes.find((s) => s.id === this.settings.activeScene);
    return !sc || JSON.stringify(sc.framing) !== JSON.stringify(this.settings.framing);
  }

  status(): Status {
    const sc = this.settings.scenes.find((s) => s.id === this.settings.activeScene);
    const idx = this.director.speakerId !== null ? this.director.order.indexOf(this.director.speakerId) + 1 : 0;
    return {
      scene: this.settings.activeScene, sceneName: sc?.name ?? '', mode: this.settings.framing.mode,
      persons: this.persons.length, speaker: idx || null, fps: this.fps, detectMs: detectorStatus.ms, delegate: detectorStatus.delegate,
      source: this.source, output: { width: this.settings.output.width, height: this.settings.output.height },
      privacy: this.privacy, frozen: this.director.frozen, sinks: this.sinks,
    };
  }

  // ------------------------------------------------------------ input

  async openInput() {
    this.closeInput();
    const inp = this.settings.input;
    this.source = { width: 0, height: 0, fps: 0, label: '', error: '' };
    this.tracker.reset(); this.director.order = [];
    try {
      if (inp.kind === 'device') {
        const v = document.createElement('video');
        v.muted = true; v.playsInline = true;
        // no fixed resolution: ask for the most the device offers unless one was chosen
        const video: MediaTrackConstraints = {
          width: { ideal: inp.width || 4096 }, height: { ideal: inp.height || 2160 }, frameRate: { ideal: inp.fps || 30 },
        };
        if (inp.deviceId) video.deviceId = { exact: inp.deviceId };
        this.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
        v.srcObject = this.stream;
        await v.play();
        const t = this.stream.getVideoTracks()[0], st = t.getSettings();
        this.source = { width: v.videoWidth || st.width || 0, height: v.videoHeight || st.height || 0, fps: Math.round(st.frameRate ?? 0), label: t.label, error: '' };
        this.el = v;
      } else if (inp.kind === 'file') {
        if (!inp.file) throw new Error('Keine Videodatei gewählt');
        const v = document.createElement('video');
        v.muted = true; v.loop = true; v.playsInline = true; v.crossOrigin = 'anonymous'; v.src = inp.file;
        await v.play();
        this.source = { width: v.videoWidth, height: v.videoHeight, fps: 0, label: decodeURIComponent(inp.file.split('/').pop() ?? ''), error: '' };
        this.el = v;
      } else {
        if (!desktop) throw new Error('Netzwerkquellen gibt es nur in der Desktop-App');
        const r = await desktop.network.start(inp.url);
        if (!r.ok) throw new Error(r.error);
        const img = new Image();
        img.crossOrigin = 'anonymous'; // canvas stays readable for the outputs
        img.src = r.url;
        await new Promise<void>((ok, bad) => { img.onload = () => ok(); img.onerror = () => bad(new Error('Netzwerkquelle liefert kein Bild')); });
        this.source = { width: img.naturalWidth, height: img.naturalHeight, fps: 0, label: inp.url.replace(/\/\/[^@/]*@/, '//'), error: '' };
        this.el = img;
      }
    } catch (e) {
      this.source.error = e instanceof Error ? e.message : String(e);
    }
    this.emit();
  }

  closeInput() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.el instanceof HTMLVideoElement) { this.el.pause(); this.el.removeAttribute('src'); this.el.srcObject = null; }
    if (this.el instanceof HTMLImageElement) desktop?.network.stop();
    this.el = null;
  }

  get sourceElement() { return this.el; }

  private srcSize() {
    const el = this.el;
    if (!el) return { W: 0, H: 0 };
    if (el instanceof HTMLVideoElement) return { W: el.videoWidth, H: el.videoHeight };
    return { W: el.naturalWidth, H: el.naturalHeight };
  }

  private applySpeakerSource() {
    const sp = this.settings.speaker;
    if (sp.source === 'auto') this.audio.start(sp.micId, sp.channels === 'stereo').then(() => this.emit());
    else this.audio.stop();
  }

  // ------------------------------------------------------------ loop

  private resize() {
    const o = this.settings.output;
    if (this.canvas.width !== o.width || this.canvas.height !== o.height) { this.canvas.width = o.width; this.canvas.height = o.height; }
    const b = this.settings.programB;
    if (this.canvasB.width !== b.width || this.canvasB.height !== b.height) { this.canvasB.width = b.width; this.canvasB.height = b.height; }
    this.preview.width = 480; this.preview.height = Math.max(1, Math.round((480 * o.height) / o.width));
  }

  private loop = () => {
    const fps = this.settings.output.fps || 30;
    this.timer = window.setTimeout(this.loop, 1000 / fps);
    try { this.tick(); } catch (e) { console.error('tick', e); }
  };

  private tick() {
    const now = performance.now();
    const dt = this.lastTick ? (now - this.lastTick) / 1000 : 1 / 30;
    this.lastTick = now;
    const { W, H } = this.srcSize();
    const s = this.settings;
    if (this.el && W && H) {
      if (W !== this.source.width || H !== this.source.height) { this.source.width = W; this.source.height = H; this.emit(); }
      if (!this.detecting && now - this.lastDetect > 1000 / s.detectHz && (s.framing.mode !== 'overview' || s.ptz.enabled || s.atem.enabled || s.programB.enabled) && !this.privacy) this.runDetection(W, H, now);
      this.views = this.director.update({
        persons: this.persons, framing: s.framing, src: { W, H }, out: { W: s.output.width, H: s.output.height },
        layoutFor: (n) => this.layoutFor(n), layoutById: (id) => this.layoutById(id), now, forcedSpeaker: this.forcedSpeakerId(), presenterId: this.presenterId(),
      });
      for (const v of this.views) v.cam.step(dt, s.framing.speed, { W, H });
      const fb = this.framingB();
      if (s.programB.enabled && fb) {
        this.viewsB = this.directorB.update({
          persons: this.persons, framing: fb, src: { W, H }, out: { W: s.programB.width, H: s.programB.height },
          layoutFor: (n) => this.layoutFor(n), layoutById: (id) => this.layoutById(id), now, forcedSpeaker: this.forcedSpeakerId(), presenterId: this.presenterId(),
        });
        for (const v of this.viewsB) v.cam.step(dt, fb.speed, { W, H });
      }
    }
    if (W && H) { this.followAtem(now, dt, W, H); this.pushTracking(now, W, H); }
    if (s.speaker.source === 'auto' && now - this.lastAudio > 50) this.readAudio(now);
    this.draw(this.ctx, this.views, s.output.width, s.output.height, s.framing, W, H);
    if (s.programB.enabled) this.draw(this.ctxB, this.viewsB, s.programB.width, s.programB.height, this.framingB() ?? s.framing, W, H);
    this.feed(now);
    if (++this.fpsCount && now - this.fpsT > 1000) {
      this.fps = Math.round((this.fpsCount * 1000) / (now - this.fpsT)); this.fpsCount = 0; this.fpsT = now;
      this.event(`persons ${this.persons.length}`);
      this.emit();
    }
  }

  private readAudio(now: number) {
    this.lastAudio = now;
    const sp = this.settings.speaker;
    const r = this.audio.read(sp.threshold);
    this.audioReading = r;
    // uncalibrated and mirrored picture: the sound image is mirrored too
    this.audioX = r.pan === null ? null : panToX(r.pan, sp.calib, sp.width, sp.swap !== (this.settings.input.mirror && !sp.calib));
  }

  /**
   * Calibration: while exactly one person speaks, pair the sound direction with where that
   * person sits. Two or more positions across the room give the line direction → picture.
   */
  addCalibrationPoint(): string {
    const { W } = this.srcSize();
    const r = this.audioReading;
    if (r.pan === null) return 'Keine Richtung: Stereo-Eingang und Sprache nötig';
    const p = this.mainPerson();
    if (!p || !W) return 'Keine Person im Bild';
    const pan = this.settings.speaker.swap ? -r.pan : r.pan;
    this.calibPoints.push({ pan, x: (p.head.x + p.head.w / 2) / W });
    const line = fitLine(this.calibPoints);
    if (line) this.update((s) => { s.speaker.calib = line; });
    else this.emit();
    return line ? `Kalibriert mit ${this.calibPoints.length} Punkten` : 'Punkt 1 gespeichert – jetzt eine Person auf der anderen Seite sprechen lassen';
  }

  resetCalibration() { this.calibPoints = []; this.update((s) => { s.speaker.calib = null; }); }

  /** The person the PiP, the ATEM box and the PTZ follow: speaker, else presenter, else the largest. */
  mainPerson(): Person | null {
    const ps = this.persons;
    const id = this.forcedSpeakerId() ?? this.director.speakerId ?? this.presenterId();
    return ps.find((p) => p.id === id) ?? [...ps].sort((a, b) => b.head.h - a.head.h)[0] ?? null;
  }

  private followAtem(now: number, dt: number, W: number, H: number) {
    const a = this.settings.atem;
    if (!a.enabled || !a.host || !desktop) return;
    const f = this.settings.framing, aspect = 16 / 9;
    const main = this.mainPerson();
    const target = a.follow === 'group' && this.persons.length ? groupCrop(this.persons, f, aspect, { W, H }, null)
      : main ? personCrop(main, f, aspect, { W, H }, null) : { x: 0, y: 0, w: W, h: H };
    this.atemCam.aim(target, a.follow === 'group' ? 'group' : `p${main?.id ?? 0}`, f.deadband, 'smooth');
    this.atemCam.step(dt, f.speed, { W, H });
    const cur = this.atemCam.cur; if (!cur) return;
    const crop = this.settings.input.mirror ? { ...cur, x: W - cur.x - cur.w } : cur; // the ATEM sees the unmirrored camera
    const raw = toRaw(ssBoxFor(crop, W, H, a));
    const key = JSON.stringify(raw);
    if (key !== this.lastAtem && now - this.lastAtemSent > 40) {
      this.lastAtem = key; this.lastAtemSent = now;
      desktop.atem.setBox(a.superSource, a.box, raw);
    }
  }

  /** Tracking data for the control API ("tracking on", GET /api/tracking): normalized, 10/s. */
  private pushTracking(now: number, W: number, H: number) {
    if (!desktop || now - this.lastTracking < 100) return;
    this.lastTracking = now;
    const n = (r: { x: number; y: number; w: number; h: number }) => ({ x: +(r.x / W).toFixed(4), y: +(r.y / H).toFixed(4), w: +(r.w / W).toFixed(4), h: +(r.h / H).toFixed(4) });
    const main = this.mainPerson();
    const order = this.director.order;
    desktop.tracking({
      source: { width: W, height: H, mirrored: this.settings.input.mirror },
      persons: this.persons.map((p) => ({ n: order.indexOf(p.id) + 1, head: n(p.head), speaking: +p.speaking.toFixed(2) })),
      main: main ? order.indexOf(main.id) + 1 : null,
      mainCrop: this.atemCam.cur ? n(this.atemCam.cur) : main ? n(personCrop(main, this.settings.framing, 16 / 9, { W, H }, null)) : null,
      tiles: this.views.map((v) => ({ role: v.tile.role, person: v.personId !== null ? order.indexOf(v.personId) + 1 : null, crop: v.cam.cur ? n(v.cam.cur) : null })),
    });
  }

  private steerPtz(W: number, H: number) {
    const p = this.settings.ptz;
    if (!desktop) return;
    const key = p.enabled && p.host ? `${p.protocol} ${p.host} ${p.port}` : '';
    if (key !== this.ptzKey) { if (this.ptzKey) desktop.ptz.stop(); this.ptzKey = key; desktop.ptz.configure(key ? { protocol: p.protocol, host: p.host, port: p.port } : null); }
    if (!key || this.privacy || this.director.frozen) { if (this.ptzDrive !== STOP) { this.ptzDrive = STOP; if (key) desktop.ptz.stop(); } return; }
    const main = this.mainPerson();
    let aim = ptzAim(this.persons, p, main?.id ?? null);
    if (aim && this.settings.input.mirror) aim = { ...aim, x: W - aim.x };
    const d = ptzDrive(aim, W, H, p);
    const moving = d.pan || d.tilt || d.zoom;
    // moving: resend every round (the main process stops the camera without updates); still: once
    if (moving || this.ptzDrive.pan || this.ptzDrive.tilt || this.ptzDrive.zoom) desktop.ptz.send(viscaPackets(d));
    this.ptzDrive = d;
  }

  /** Framing of program B: its own scene, or the main framing when that scene is gone. */
  framingB(): Framing | null {
    return this.settings.scenes.find((x) => x.id === this.settings.programB.scene)?.framing ?? this.settings.framing;
  }

  private forcedSpeakerId() {
    if (this.forcedSpeaker === null) return null;
    return this.director.order[this.forcedSpeaker - 1] ?? null;
  }
  private presenterId() { return this.presenter === null ? null : this.director.order[this.presenter - 1] ?? null; }

  layoutById(id: string): Layout | null {
    return this.settings.layouts.find((l) => l.id === id) ?? LAYOUT_TEMPLATES.find((l) => l.id === id) ?? null;
  }

  layoutFor(n: number): Layout | null {
    const id = this.settings.layoutByCount[String(n)];
    return (id && this.settings.layouts.find((l) => l.id === id)) || null;
  }

  private async runDetection(W: number, H: number, now: number) {
    this.detecting = true; this.lastDetect = now;
    try {
      const el = this.el!;
      const mirror = this.settings.input.mirror;
      const flip = <T extends { x: number; w: number }>(r: T): T => ({ ...r, x: W - r.x - r.w });
      const sp = this.settings.speaker.source;
      // lip measurement for the people known so far (source coordinates, unmirrored)
      const prev = this.tracker.confirmed();
      const mouths = sp === 'auto' && prev.length ? prev.map((p) => (mirror ? flip(mouthRegion(p)) : mouthRegion(p))) : null;
      const res = await detect(el, W, H, this.settings.accuracy, mouths);
      let dets = res.dets;
      if (mirror) dets = dets.map((d) => ({ ...d, body: flip(d.body), head: d.head && flip(d.head) }));
      dets = filterDetections(dets, this.settings.zones, W, H);
      this.lastDetections = dets;
      const lipScores = sp === 'auto' && res.mouths ? this.lips.update(prev, res.mouths, performance.now()) : new Map<number, number>();
      const persons = this.tracker.update(dets, performance.now(), this.settings.framing.holdTime);
      if (sp === 'auto') {
        const a = this.settings.speaker;
        fuseSpeaking(persons, lipScores, this.audioReading.voice, this.audioX, W, a.lipWeight, 0.12);
      }
      if (sp === 'external') applyZones(persons, this.settings.zones, this.activeZones, W);
      else if (sp === 'off') persons.forEach((p) => (p.speaking = 0));
      this.persons = persons;
      this.steerPtz(W, H);
    } catch (e) {
      detectorStatus.error = e instanceof Error ? e.message : String(e);
      console.warn('detection', e);
    } finally { this.detecting = false; }
  }

  private draw(c: CanvasRenderingContext2D, views: TileView[], OW: number, OH: number, framing: Framing, W: number, H: number) {
    const o = { ...this.settings.output, width: OW, height: OH };
    c.fillStyle = o.background; c.fillRect(0, 0, o.width, o.height);
    if (!this.el || !W || !H || this.privacy) {
      c.fillStyle = '#8a8d94'; c.font = `500 ${Math.round(o.height / 24)}px system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(this.privacy ? 'Kamera aus' : 'Kein Eingang', o.width / 2, o.height / 2);
      return;
    }
    const mirror = this.settings.input.mirror, gap = views.length > 1 ? o.gap : 0;
    for (const v of views) {
      const cam = v.cam.cur; if (!cam) continue;
      const d = { x: v.px.x + gap / 2, y: v.px.y + gap / 2, w: v.px.w - gap, h: v.px.h - gap };
      c.save();
      c.beginPath();
      if (o.radius && views.length > 1) c.roundRect(d.x, d.y, d.w, d.h, o.radius); else c.rect(d.x, d.y, d.w, d.h);
      c.clip();
      const blit = (r: typeof cam, alpha: number) => {
        c.globalAlpha = alpha;
        if (mirror) {
          c.save(); c.translate(d.x + d.w, d.y); c.scale(-1, 1);
          c.drawImage(this.el!, W - r.x - r.w, r.y, r.w, r.h, 0, 0, d.w, d.h);
          c.restore();
        } else c.drawImage(this.el!, r.x, r.y, r.w, r.h, d.x, d.y, d.w, d.h);
      };
      if (v.cam.fade < 1 && v.cam.prev) { blit(v.cam.prev, 1); blit(cam, v.cam.fade); } else blit(cam, 1);
      c.globalAlpha = 1;
      c.restore();
      if (v.highlight) {
        c.strokeStyle = o.highlight; c.lineWidth = Math.max(2, Math.round(o.height / 270));
        c.beginPath(); c.roundRect(d.x + c.lineWidth / 2, d.y + c.lineWidth / 2, d.w - c.lineWidth, d.h - c.lineWidth, o.radius); c.stroke();
      }
      if (framing.showLabels && v.label) {
        const fs = Math.max(12, Math.round(d.h / 14));
        c.font = `600 ${fs}px system-ui, sans-serif`; c.textAlign = 'left'; c.textBaseline = 'middle';
        const tw = c.measureText(v.label).width, pad = fs * 0.5;
        c.fillStyle = 'rgba(0,0,0,.55)'; c.beginPath(); c.roundRect(d.x + pad, d.y + d.h - fs * 2.1, tw + pad * 2, fs * 1.6, fs * 0.4); c.fill();
        c.fillStyle = '#fff'; c.fillText(v.label, d.x + pad * 2, d.y + d.h - fs * 1.3);
      }
    }
  }

  // ------------------------------------------------------------ outputs

  private connectFrames() {
    if (!desktop) return;
    const d = desktop;
    const open = () => d.info().then((info) => {
        const ws = new WebSocket(`ws://127.0.0.1:${info.httpPort}/frames?token=${info.token}`);
        ws.binaryType = 'arraybuffer';
        ws.onopen = () => { this.ws = ws; this.syncSinks(); };
        ws.onmessage = (m) => { try { const s = JSON.parse(String(m.data)); if (s.sinks) { this.sinks = s.sinks; this.emit(); } } catch { /* not status */ } };
        ws.onclose = () => { this.ws = null; setTimeout(open, 1500); };
      }, () => setTimeout(open, 1500));
    open();
  }

  /** Tells the main process which outputs should run. */
  syncSinks() {
    const o = this.settings.output;
    const b = this.settings.programB;
    this.ws?.readyState === 1 && this.ws.send(JSON.stringify({ type: 'sinks', width: o.width, height: o.height, fps: o.fps, ndi: o.ndi, stream: o.stream, v4l2: o.v4l2, ndiB: { enabled: b.enabled && b.ndi.enabled, name: b.ndi.name } }));
    if (o.window.enabled) this.openWindow('a', o.window.displayId); else this.closeWindow('a');
    if (b.enabled && b.window.enabled) this.openWindow('b', b.window.displayId); else this.closeWindow('b');
  }

  private needsFrames() {
    const o = this.settings.output;
    return o.ndi.enabled || o.stream.enabled || o.v4l2.enabled;
  }

  private feed(now: number) {
    for (const k of ['a', 'b'] as const) {
      const w = this.outWins[k], src = k === 'a' ? this.canvas : this.canvasB;
      if (!w) continue;
      if (w.win.closed) {
        this.outWins[k] = null;
        this.update((s) => { if (k === 'a') s.output.window.enabled = false; else s.programB.window.enabled = false; });
        continue;
      }
      const oc = w.ctx.canvas;
      if (oc.width !== src.width || oc.height !== src.height) { oc.width = src.width; oc.height = src.height; }
      w.ctx.drawImage(src, 0, 0);
    }
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return;
    const o = this.settings.output;
    if (this.needsFrames() && ws.bufferedAmount < o.width * o.height * 8) {
      const img = this.ctx.getImageData(0, 0, o.width, o.height);
      const buf = new Uint8Array(16 + img.data.length);
      buf.set([76, 90, 82, 70]); // "LZRF"
      const dv = new DataView(buf.buffer);
      dv.setUint32(4, o.width, true); dv.setUint32(8, o.height, true); dv.setUint32(12, o.fps, true);
      buf.set(img.data, 16);
      ws.send(buf.buffer);
    }
    const b = this.settings.programB;
    if (b.enabled && b.ndi.enabled && ws.bufferedAmount < (o.width * o.height + b.width * b.height) * 8) {
      const img = this.ctxB.getImageData(0, 0, b.width, b.height);
      const buf = new Uint8Array(16 + img.data.length);
      buf.set([76, 90, 82, 66]); // "LZRB"
      const dv = new DataView(buf.buffer);
      dv.setUint32(4, b.width, true); dv.setUint32(8, b.height, true); dv.setUint32(12, o.fps, true);
      buf.set(img.data, 16);
      ws.send(buf.buffer);
    }
    // small JPEG for the web remote and touch panels, 4 per second
    if (now - this.lastPreview > 250 && ws.bufferedAmount < 2e6) {
      this.lastPreview = now;
      const pc = this.preview.getContext('2d')!;
      pc.drawImage(this.canvas, 0, 0, this.preview.width, this.preview.height);
      this.preview.toBlob((b) => b && b.arrayBuffer().then((a) => {
        const buf = new Uint8Array(4 + a.byteLength); buf.set([76, 90, 74, 80]); buf.set(new Uint8Array(a), 4); // "LZJP"
        this.ws?.readyState === 1 && this.ws.send(buf.buffer);
      }), 'image/jpeg', 0.7);
    }
  }

  private openWindow(k: 'a' | 'b', d: number | null) {
    const cur = this.outWins[k];
    if (cur && !cur.win.closed) return;
    const w = window.open('about:blank', k === 'a' ? 'lzrf-output' : 'lzrf-output-b', `lzrfDisplay=${d ?? ''}`);
    if (!w) return;
    w.document.title = k === 'a' ? 'LZ Room Frame – Ausgabe' : 'LZ Room Frame – Ausgabe B';
    w.document.body.style.cssText = 'margin:0;background:#000;overflow:hidden;cursor:none;display:grid;place-items:center;height:100vh';
    const oc = w.document.createElement('canvas');
    oc.style.cssText = 'width:100vw;height:100vh;object-fit:contain';
    w.document.body.appendChild(oc);
    this.outWins[k] = { win: w, ctx: oc.getContext('2d', { alpha: false })! };
  }

  private closeWindow(k: 'a' | 'b') { this.outWins[k]?.win.close(); this.outWins[k] = null; }

  private event(e: string) {
    if (e === this.lastEvent) return;
    this.lastEvent = e;
    desktop?.event(e);
  }

  // ------------------------------------------------------------ control API

  exec(line: string): string {
    const c = parseCommand(line);
    if ('error' in c) return `ERR ${c.error}`;
    const s = this.settings;
    switch (c.kind) {
      case 'scene': {
        const sc = findScene(s.scenes, c.ref);
        if (!sc) return `ERR no scene "${c.ref}"`;
        this.recallScene(sc.id); this.event(`scene ${s.scenes.indexOf(sc) + 1} ${sc.id}`);
        return `OK scene ${s.scenes.indexOf(sc) + 1} ${sc.name}`;
      }
      case 'sceneB': {
        const sc = findScene(s.scenes, c.ref);
        if (!sc) return `ERR no scene "${c.ref}"`;
        this.update((st) => { st.programB.scene = sc.id; });
        return `OK sceneb ${s.scenes.indexOf(sc) + 1} ${sc.name}`;
      }
      case 'mode': this.setFraming({ mode: c.mode }); return `OK mode ${c.mode}`;
      case 'style': this.setFraming({ style: c.style, mode: 'people' }); return `OK style ${c.style}`;
      case 'shot': this.setFraming({ shot: c.shot }); return `OK shot ${c.shot}`;
      case 'speed': this.setFraming({ speed: c.speed }); return `OK speed ${c.speed}`;
      case 'freeze': this.director.frozen = c.on; this.emit(); return `OK freeze ${c.on ? 'on' : 'off'}`;
      case 'privacy': this.privacy = c.on; this.emit(); this.event(`privacy ${c.on ? 'on' : 'off'}`); return `OK privacy ${c.on ? 'on' : 'off'}`;
      case 'speaker': this.forcedSpeaker = c.index; return `OK speaker ${c.index ?? 'none'}`;
      case 'presenter': this.presenter = c.index; return `OK presenter ${c.index ?? 'auto'}`;
      case 'zone': if (c.on) this.activeZones.add(c.index); else this.activeZones.delete(c.index); return `OK zone ${c.index} ${c.on ? 'on' : 'off'}`;
      case 'output': {
        this.update((st) => {
          if (c.target === 'ndib') st.programB.ndi.enabled = c.on;
          else if (c.target === 'windowb') st.programB.window.enabled = c.on;
          else if (c.target === 'b') st.programB.enabled = c.on;
          else st.output[c.target].enabled = c.on;
        });
        return `OK output ${c.target} ${c.on ? 'on' : 'off'}`;
      }
      case 'ptz': this.update((st) => { st.ptz.enabled = c.on; }); return `OK ptz ${c.on ? 'on' : 'off'}`;
      case 'status': return JSON.stringify(this.status());
      case 'scenes': return s.scenes.map((sc, i) => `${i + 1} ${sc.id} ${sc.name}`).join('\n');
      case 'subscribe': return `OK subscribe ${c.on ? 'on' : 'off'}`; // handled per connection in the main process
      case 'help': return HELP.join('\n');
    }
  }

  destroy() { clearTimeout(this.timer); this.closeInput(); this.closeWindow('a'); this.closeWindow('b'); this.audio.stop(); }
}

export const engine = new Engine();
// for diagnosis from the dev tools and kiosk checks
(window as unknown as { lzrfEngine: Engine }).lzrfEngine = engine;
