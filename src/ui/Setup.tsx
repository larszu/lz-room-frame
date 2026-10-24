// Setting up a room in four steps, each with only what most rooms need. Everything else is
// under "Profi".
import { Check } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { desktop, type Display } from '../desktop';
import { SHOT_LABEL } from '../engine/framing';
import { OUTPUT_PRESETS } from '../engine/settings';
import type { Shot, Speed } from '../engine/types';
import { Field, More, Seg, SinkState, Toggle } from './controls';
import { RoomCard } from './Framing';
import { useDesktopInfo } from './Outputs';
import { SourcePicker } from './SourcePicker';
import { useEngine } from './useEngine';
import { VirtualCamera } from './VirtualCamera';

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: ReactNode }) {
  return (
    <section className="card step">
      <h2><span className={`num${done ? ' done' : ''}`}>{done ? <Check size={16} strokeWidth={2.5} /> : n}</span><span className="grow">{title}</span></h2>
      {children}
    </section>
  );
}

export function Setup({ go }: { go: (v: string) => void }) {
  const e = useEngine();
  const s = e.settings;
  const f = s.framing;
  const o = s.output;
  const info = useDesktopInfo();
  const [displays, setDisplays] = useState<Display[]>([]);
  useEffect(() => { desktop?.displays().then(setDisplays); }, []);
  const [stream, setStream] = useState(o.stream.url);
  const setOut = (fn: (x: typeof o) => void) => e.update((st) => fn(st.output));
  const anyOut = o.window.enabled || o.ndi.enabled || o.stream.enabled || o.v4l2.enabled;
  const shots: Shot[] = ['close', 'mcu', 'medium', 'wide'];

  return (
    <div className="view narrow">
      <h1>Einrichten</h1>
      <p className="lead">Einmal pro Raum. Danach reicht die Ansicht Live.</p>

      <Step n={1} title="Kamera" done={!!e.source.width}>
        <SourcePicker simple />
      </Step>

      <Step n={2} title="Bild" done={!!e.source.width}>
        <Field label="Einstellungsgröße">
          <Seg label="Einstellungsgröße" value={shots.includes(f.shot) ? f.shot : 'mcu'} onChange={(v: Shot) => e.setFraming({ shot: v })} options={shots.map((k) => ({ value: k, label: SHOT_LABEL[k] }))} />
        </Field>
        <Field label="Wie schnell die Kamera folgt">
          <Seg label="Geschwindigkeit" value={f.speed} onChange={(v: Speed) => e.setFraming({ speed: v })} options={[{ value: 'slow', label: 'Ruhig' }, { value: 'normal', label: 'Normal' }, { value: 'fast', label: 'Schnell' }]} />
        </Field>
        <Toggle label="Namen einblenden" checked={f.showLabels} onChange={(v) => e.setFraming({ showLabels: v })} />
        <p className="muted" style={{ margin: 0 }}>Gilt für die gerade gewählte Szene. Szenen bearbeiten, Kopfluft, Übergänge: <button className="btn ghost link" onClick={() => go('pro')}>Profi</button></p>
      </Step>

      <Step n={3} title="Ausgabe" done={anyOut}>
        <p className="muted" style={{ margin: 0 }}>Wohin das fertige Bild geht. Mehreres gleichzeitig ist möglich.</p>
        <Toggle label="Auf einem Bildschirm zeigen" hint="Vollbild, z. B. per HDMI in Raumsystem, Codec oder Capture-Stick" checked={o.window.enabled} onChange={(v) => setOut((x) => { x.window.enabled = v; })} />
        {o.window.enabled && (
          <select aria-label="Bildschirm" value={o.window.displayId ?? ''} onChange={(ev) => setOut((x) => { x.window.displayId = ev.target.value ? Number(ev.target.value) : null; })}>
            <option value="">Zweiter Bildschirm (oder Fenster)</option>
            {displays.map((d) => <option key={d.id} value={d.id}>{d.label} · {d.width} × {d.height}{d.primary ? ' · Hauptbildschirm' : ''}</option>)}
          </select>
        )}
        <Toggle label="Im Netzwerk senden (NDI)" hint="Für Bildmischer, OBS, vMix – und als Kamera in Zoom oder Teams" checked={o.ndi.enabled} disabled={!desktop} onChange={(v) => setOut((x) => { x.ndi.enabled = v; })} />
        {o.ndi.enabled && <SinkState s={e.sinks.ndi} />}
        {o.ndi.enabled && info && !info.ndi.ok && <div className="note warn"><p>Dafür fehlt die kostenlose NDI-Runtime (ndi.video). Danach die App neu starten.</p></div>}
        <Toggle label="Streamen" hint="YouTube, Vimeo oder ein Encoder im Netz" checked={o.stream.enabled} disabled={!desktop} onChange={(v) => setOut((x) => { x.stream.url = stream; x.stream.enabled = v; })} />
        {o.stream.enabled && (
          <>
            <input type="url" aria-label="Stream-Ziel" placeholder="rtmp://…/live/key oder srt://…" value={stream} onChange={(ev) => setStream(ev.target.value)} onBlur={() => setOut((x) => { x.stream.url = stream; })} />
            <SinkState s={e.sinks.stream} />
          </>
        )}
        <VirtualCamera />
        <More label="Format">
          <Field label="Auflösung">
            <select value={`${o.width}x${o.height}`} onChange={(ev) => { const [w, h] = ev.target.value.split('x').map(Number); if (w && h) setOut((x) => { x.width = w; x.height = h; }); }}>
              {!OUTPUT_PRESETS.some((p) => p.w === o.width && p.h === o.height) && <option value={`${o.width}x${o.height}`}>Eigene · {o.width} × {o.height}</option>}
              {OUTPUT_PRESETS.map((p) => <option key={p.label} value={`${p.w}x${p.h}`}>{p.label} · {p.w} × {p.h}</option>)}
            </select>
          </Field>
        </More>
      </Step>

      <Step n={4} title="Raum (optional)">
        <RoomCard simple />
      </Step>

      <div className="row end">
        <button className="btn primary" onClick={() => go('live')}>Fertig – zu Live</button>
      </div>
    </div>
  );
}
