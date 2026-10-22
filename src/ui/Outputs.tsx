import { useEffect, useRef, useState } from 'react';
import { desktop, type Display, type DesktopInfo } from '../desktop';
import { OUTPUT_PRESETS } from '../engine/settings';
import { Card, Field, SinkState, Slider, Toggle } from './controls';
import { useEngine } from './useEngine';
import { AtemCard } from './Tracking';

export function useDesktopInfo() {
  const [info, setInfo] = useState<DesktopInfo | null>(null);
  useEffect(() => { desktop?.info().then(setInfo); }, []);
  return info;
}

export function Outputs() {
  const e = useEngine();
  const o = e.settings.output;
  const info = useDesktopInfo();
  const [displays, setDisplays] = useState<Display[]>([]);
  useEffect(() => { desktop?.displays().then(setDisplays); }, []);
  const set = (fn: (out: typeof o) => void) => e.update((s) => fn(s.output));
  const preset = OUTPUT_PRESETS.find((p) => p.w === o.width && p.h === o.height);
  const [stream, setStream] = useState(o.stream.url);
  const platform = info?.platform ?? (navigator.userAgent.includes('Mac') ? 'darwin' : navigator.userAgent.includes('Windows') ? 'win32' : 'linux');

  return (
    <div className="view">
      <h1>Ausgänge</h1>
      <p className="lead">Das fertige Bild geht gleichzeitig an alle eingeschalteten Ausgänge.</p>
      <div className="cols">
        <Card title="Format">
          <Field label="Auflösung" hint="Frei wählbar – die Kacheln passen sich jedem Seitenverhältnis an.">
            <select value={preset ? `${preset.w}x${preset.h}` : 'custom'} onChange={(ev) => { if (ev.target.value === 'custom') return; const [w, h] = ev.target.value.split('x').map(Number); set((x) => { x.width = w; x.height = h; }); }}>
              {OUTPUT_PRESETS.map((p) => <option key={p.label} value={`${p.w}x${p.h}`}>{p.label} · {p.w} × {p.h}</option>)}
              <option value="custom">Eigene …</option>
            </select>
          </Field>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input type="number" aria-label="Breite" min={160} max={7680} step={2} value={o.width} onChange={(ev) => set((x) => { x.width = Math.max(160, Math.min(7680, Number(ev.target.value) & ~1)); })} />
            <span>×</span>
            <input type="number" aria-label="Höhe" min={90} max={4320} step={2} value={o.height} onChange={(ev) => set((x) => { x.height = Math.max(90, Math.min(4320, Number(ev.target.value) & ~1)); })} />
          </div>
          <Field label="Bildrate">
            <select value={o.fps} onChange={(ev) => set((x) => { x.fps = Number(ev.target.value); })}>{[24, 25, 30, 50, 60].map((f) => <option key={f} value={f}>{f} fps</option>)}</select>
          </Field>
          <Slider label="Abstand zwischen Kacheln" value={o.gap} min={0} max={24} step={1} format={(v) => `${v} px`} onChange={(v) => set((x) => { x.gap = v; })} />
          <Slider label="Ecken" value={o.radius} min={0} max={32} step={1} format={(v) => `${v} px`} onChange={(v) => set((x) => { x.radius = v; })} />
          <div className="row">
            <Field label="Hintergrund"><input type="color" value={o.background} onChange={(ev) => set((x) => { x.background = ev.target.value; })} /></Field>
            <Field label="Sprecher-Rahmen"><input type="color" value={o.highlight} onChange={(ev) => set((x) => { x.highlight = ev.target.value; })} /></Field>
          </div>
        </Card>

        <Card title="Ausgabefenster" action={<Toggle label="" checked={o.window.enabled} onChange={(v) => set((x) => { x.window.enabled = v; })} />}>
          <p className="muted" style={{ margin: 0 }}>Vollbild auf einem Bildschirm oder HDMI-Ausgang. Von dort per Kabel in Crestron, Q-SYS, einen Videocodec oder einen Capture-Stick (USB-Kamera für Zoom und Teams).</p>
          <Field label="Bildschirm">
            <select value={o.window.displayId ?? ''} onChange={(ev) => set((x) => { x.window.displayId = ev.target.value ? Number(ev.target.value) : null; })}>
              <option value="">Zweiter Bildschirm (oder Fenster)</option>
              {displays.map((d) => <option key={d.id} value={d.id}>{d.label} · {d.width} × {d.height}{d.primary ? ' · Hauptbildschirm' : ''}</option>)}
            </select>
          </Field>
        </Card>

        <Card title="NDI" action={<Toggle label="" checked={o.ndi.enabled} disabled={!desktop} onChange={(v) => set((x) => { x.ndi.enabled = v; })} />}>
          <SinkState s={e.sinks.ndi} />
          <Field label="Name der Quelle"><input type="text" value={o.ndi.name} onChange={(ev) => set((x) => { x.ndi.name = ev.target.value; })} /></Field>
          {info && !info.ndi.ok && <div className="note warn"><p>NDI-Runtime fehlt. Kostenlos von <a href="#" onClick={(ev) => { ev.preventDefault(); desktop?.openExternal('https://ndi.video/tools/'); }}>ndi.video</a> installieren, dann die App neu starten.</p></div>}
          {info?.ndi.ok && <p className="muted" style={{ margin: 0 }}>{info.ndi.version}</p>}
        </Card>

        <Card title="Stream" action={<Toggle label="" checked={o.stream.enabled} disabled={!desktop} onChange={(v) => set((x) => { x.stream.url = stream; x.stream.enabled = v; })} />}>
          <SinkState s={e.sinks.stream} />
          <Field label="Ziel" hint="RTMP(S) für YouTube, Vimeo, Restream; SRT oder UDP für Encoder und Decoder im Netz.">
            <input type="url" placeholder="srt://192.0.2.10:9000 oder rtmp://…/live/key" value={stream} onChange={(ev) => setStream(ev.target.value)} onBlur={() => set((x) => { x.stream.url = stream; })} />
          </Field>
          <Slider label="Datenrate" value={o.stream.bitrate} min={1000} max={20000} step={500} format={(v) => `${(v / 1000).toLocaleString('de-DE')} Mbit/s`} onChange={(v) => set((x) => { x.stream.bitrate = v; })} />
          {info && !info.ffmpeg && <div className="note warn"><p>ffmpeg wurde nicht gefunden.</p></div>}
        </Card>

        <ProgramB displays={displays} />
        <AtemCard />

        <Card title="Als Kamera in Zoom, Teams, Meet">
          {platform === 'linux' ? (
            <>
              <Toggle label="Virtuelle Kamera (v4l2loopback)" checked={o.v4l2.enabled} onChange={(v) => set((x) => { x.v4l2.enabled = v; })} />
              <SinkState s={e.sinks.v4l2} />
              <Field label="Gerät" hint={<>Einmalig: <code>sudo modprobe v4l2loopback devices=1 video_nr=10 card_label="LZ Room Frame" exclusive_caps=1</code></>}>
                <input type="text" value={o.v4l2.device} onChange={(ev) => set((x) => { x.v4l2.device = ev.target.value; })} />
              </Field>
            </>
          ) : (
            <ol style={{ margin: 0, paddingInlineStart: '1.2em', display: 'grid', gap: 6 }}>
              <li>NDI oben einschalten.</li>
              <li>{platform === 'darwin' ? <>„NDI Virtual Input" aus den NDI Tools starten und „{o.ndi.name}" wählen.</> : <>„NDI Webcam Input" aus den NDI Tools starten und „{o.ndi.name}" wählen.</>}</li>
              <li>In Zoom, Teams oder Meet die Kamera „NDI Video" wählen.</li>
            </ol>
          )}
          <p className="muted" style={{ margin: 0 }}>In Zoom Rooms und Teams Rooms: das Ausgabefenster über HDMI an den USB-Capture-Eingang des Raumsystems geben, oder NDI an einen NDI-fähigen Codec.</p>
        </Card>
      </div>
    </div>
  );
}

function CanvasView({ canvas }: { canvas: HTMLCanvasElement }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current!;
    canvas.style.cssText = 'display:block;max-inline-size:100%;max-block-size:320px;margin-inline:auto;border-radius:var(--radius-m);background:#000';
    host.appendChild(canvas);
    return () => { canvas.remove(); };
  }, [canvas]);
  return <div ref={ref} />;
}

function ProgramB({ displays }: { displays: Display[] }) {
  const e = useEngine();
  const b = e.settings.programB;
  const set = (fn: (x: typeof b) => void) => e.update((s) => fn(s.programB));
  const preset = OUTPUT_PRESETS.find((p) => p.w === b.width && p.h === b.height);
  return (
    <Card title="Zweite Ausgabe (B)" action={<Toggle label="" checked={b.enabled} onChange={(v) => set((x) => { x.enabled = v; })} />}>
      <p className="muted" style={{ margin: 0 }}>Ein zweites Bild aus derselben Kamera, in eigenem Format und mit eigener Szene – z. B. 9:16 für Social Media oder nur die Nahaufnahme für ein Bild im Bild im Bildmischer.</p>
      {b.enabled && <CanvasView canvas={e.canvasB} />}
      <Field label="Format">
        <select value={preset ? `${preset.w}x${preset.h}` : 'custom'} onChange={(ev) => { if (ev.target.value === 'custom') return; const [w, h] = ev.target.value.split('x').map(Number); set((x) => { x.width = w; x.height = h; }); }}>
          {OUTPUT_PRESETS.map((p) => <option key={p.label} value={`${p.w}x${p.h}`}>{p.label} · {p.w} × {p.h}</option>)}
          <option value="custom">Eigene …</option>
        </select>
      </Field>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <input type="number" aria-label="Breite B" min={160} max={7680} step={2} value={b.width} onChange={(ev) => set((x) => { x.width = Math.max(160, Math.min(7680, Number(ev.target.value) & ~1)); })} />
        <span>×</span>
        <input type="number" aria-label="Höhe B" min={90} max={4320} step={2} value={b.height} onChange={(ev) => set((x) => { x.height = Math.max(90, Math.min(4320, Number(ev.target.value) & ~1)); })} />
      </div>
      <Field label="Szene" hint="Läuft unabhängig von der Hauptausgabe. Befehl: sceneb <Nummer>">
        <select value={b.scene} onChange={(ev) => set((x) => { x.scene = ev.target.value; })}>
          {e.settings.scenes.map((sc, i) => <option key={sc.id} value={sc.id}>{i + 1} · {sc.name}</option>)}
        </select>
      </Field>
      <Toggle label="Als NDI senden" checked={b.ndi.enabled} disabled={!desktop} onChange={(v) => set((x) => { x.ndi.enabled = v; })} />
      {b.ndi.enabled && <><SinkState s={e.sinks.ndiB} /><input type="text" aria-label="NDI-Name B" value={b.ndi.name} onChange={(ev) => set((x) => { x.ndi.name = ev.target.value; })} /></>}
      <Toggle label="Ausgabefenster" checked={b.window.enabled} onChange={(v) => set((x) => { x.window.enabled = v; })} />
      {b.window.enabled && (
        <select aria-label="Bildschirm B" value={b.window.displayId ?? ''} onChange={(ev) => set((x) => { x.window.displayId = ev.target.value ? Number(ev.target.value) : null; })}>
          <option value="">Zweiter Bildschirm (oder Fenster)</option>
          {displays.map((d) => <option key={d.id} value={d.id}>{d.label} · {d.width} × {d.height}</option>)}
        </select>
      )}
    </Card>
  );
}
