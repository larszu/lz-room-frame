// PTZ auto-tracking and the ATEM SuperSource follow – both use the detected people, one
// moves a real camera, the other a crop inside the switcher.
import { useEffect, useState } from 'react';
import { desktop } from '../desktop';
import { SHOT_LABEL } from '../engine/framing';
import { PTZ_PORTS, type PtzProtocol, type PtzSettings } from '../engine/ptz';
import type { AtemSettings } from '../engine/atem';
import type { Shot } from '../engine/types';
import { Card, Field, pct, Seg, Slider, Toggle } from './controls';
import { useEngine } from './useEngine';

function useRemoteState(get?: () => Promise<{ ok: boolean; message: string }>) {
  const [st, setSt] = useState<{ ok: boolean; message: string } | null>(null);
  useEffect(() => {
    if (!get) return;
    const t = setInterval(() => get().then(setSt), 1000);
    return () => clearInterval(t);
  }, [get]);
  return st;
}

export function PtzCard() {
  const e = useEngine();
  const p = e.settings.ptz;
  const set = (fn: (x: PtzSettings) => void) => e.update((s) => fn(s.ptz));
  const st = useRemoteState(desktop?.ptz.status);
  const d = e.ptzDrive;
  return (
    <Card title="PTZ-Kamera nachführen" action={<Toggle label="" checked={p.enabled} disabled={!desktop} onChange={(v) => set((x) => { x.enabled = v; })} />}>
      <p className="muted" style={{ margin: 0 }}>Das Bild der PTZ-Kamera ist der Eingang; die Erkennung schwenkt, neigt und zoomt die Kamera wie ein eingebautes Auto-Tracking. Gefolgt wird der Hauptperson (Sprecher, sonst Präsentator, sonst die größte Person) oder der Gruppe.</p>
      <Field label="Protokoll">
        <Seg label="Protokoll" value={p.protocol} onChange={(v: PtzProtocol) => set((x) => { x.protocol = v; x.port = PTZ_PORTS[v]; })} options={[
          { value: 'sony-udp', label: 'VISCA over IP (UDP)' }, { value: 'visca-tcp', label: 'VISCA TCP' }, { value: 'visca-udp', label: 'VISCA UDP' },
        ]} />
      </Field>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <Field label="Kamera-IP"><input type="text" placeholder="192.168.0.50" value={p.host} onChange={(ev) => set((x) => { x.host = ev.target.value.trim(); })} /></Field>
        <Field label="Port"><input type="number" value={p.port} onChange={(ev) => set((x) => { x.port = Number(ev.target.value); })} /></Field>
      </div>
      <p className="muted" style={{ margin: 0 }}>Sony, Panasonic (VISCA-Modus), BirdDog, Avonic: UDP 52381. PTZOptics, Lumens, Marshall, AVer: TCP 5678 oder UDP 1259.</p>
      <Field label="Folgen"><Seg label="Folgen" value={p.target} onChange={(v) => set((x) => { x.target = v; })} options={[{ value: 'main', label: 'Hauptperson' }, { value: 'group', label: 'Gruppe' }]} /></Field>
      <Field label="Bildgröße"><Seg label="Bildgröße PTZ" value={p.shot} onChange={(v: Shot) => set((x) => { x.shot = v; })} options={(Object.keys(SHOT_LABEL) as Shot[]).map((k) => ({ value: k, label: SHOT_LABEL[k] }))} /></Field>
      <Slider label="Ruhezone" value={p.deadband} min={0.02} max={0.3} step={0.01} format={pct} onChange={(v) => set((x) => { x.deadband = v; })} />
      <Slider label="Reaktion" value={p.gain} min={0.2} max={2} step={0.1} format={(v) => v.toFixed(1)} onChange={(v) => set((x) => { x.gain = v; })} />
      <Slider label="Höchstgeschwindigkeit" value={p.maxSpeed} min={0.1} max={1} step={0.05} format={pct} onChange={(v) => set((x) => { x.maxSpeed = v; })} />
      <Toggle label="Zoom nachführen" checked={p.zoom} onChange={(v) => set((x) => { x.zoom = v; })} />
      <div className="row">
        <Toggle label="Schwenk umkehren" checked={p.invertPan} onChange={(v) => set((x) => { x.invertPan = v; })} />
        <Toggle label="Neigung umkehren" checked={p.invertTilt} onChange={(v) => set((x) => { x.invertTilt = v; })} />
      </div>
      {p.enabled && <p className="muted" style={{ margin: 0 }}>{st?.message || '—'} · Schwenk {d.pan.toFixed(2)} · Neigung {d.tilt.toFixed(2)} · Zoom {d.zoom.toFixed(2)}</p>}
    </Card>
  );
}

export function AtemCard() {
  const e = useEngine();
  const a = e.settings.atem;
  const set = (fn: (x: AtemSettings) => void) => e.update((s) => fn(s.atem));
  const st = useRemoteState(desktop?.atem.status);
  useEffect(() => { desktop?.atem.configure(a.enabled ? a.host : ''); }, [a.enabled, a.host]);
  return (
    <Card title="ATEM: Bild im Bild folgt" action={<Toggle label="" checked={a.enabled} disabled={!desktop} onChange={(v) => set((x) => { x.enabled = v; })} />}>
      <p className="muted" style={{ margin: 0 }}>Die Kamera liegt auch direkt am ATEM. Eine SuperSource-Box zeigt sie beschnitten auf die Hauptperson, und der Ausschnitt folgt ihr. Der ATEM rechnet das Bild, ohne zusätzliche Verzögerung. Die Box vergrößert nicht über 1:1; für größere Nahaufnahmen die Zweite Ausgabe (B) als Eingang in den ATEM geben.</p>
      <Field label="ATEM-IP"><input type="text" placeholder="192.168.10.240" value={a.host} onChange={(ev) => set((x) => { x.host = ev.target.value.trim(); })} /></Field>
      {a.enabled && <span className={`status ${st?.ok ? 'ok' : 'warn'}`}>{st?.message || 'verbinde …'}</span>}
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <Field label="SuperSource">
          <select value={a.superSource} onChange={(ev) => set((x) => { x.superSource = Number(ev.target.value); })}>{[0, 1].map((i) => <option key={i} value={i}>{i + 1}</option>)}</select>
        </Field>
        <Field label="Box">
          <select value={a.box} onChange={(ev) => set((x) => { x.box = Number(ev.target.value); })}>{[0, 1, 2, 3].map((i) => <option key={i} value={i}>{i + 1}</option>)}</select>
        </Field>
      </div>
      <Field label="Folgen"><Seg label="ATEM folgt" value={a.follow} onChange={(v) => set((x) => { x.follow = v; })} options={[{ value: 'main', label: 'Hauptperson' }, { value: 'group', label: 'Gruppe' }]} /></Field>
      <Slider label="Box waagerecht" value={a.boxX} min={-16} max={16} step={0.25} format={(v) => v.toFixed(2)} onChange={(v) => set((x) => { x.boxX = v; })} />
      <Slider label="Box senkrecht" value={a.boxY} min={-9} max={9} step={0.25} format={(v) => v.toFixed(2)} onChange={(v) => set((x) => { x.boxY = v; })} />
      <Slider label="Boxbreite" value={a.boxWidth} min={2} max={32} step={0.5} format={(v) => v.toFixed(1)} onChange={(v) => set((x) => { x.boxWidth = v; })} hint="In ATEM-Einheiten: das Bild ist 32 breit und 18 hoch, die Mitte ist 0 / 0." />
      <p className="muted" style={{ margin: 0 }}>Für andere Mischer oder eigene Skripte: Befehl <code>tracking on</code> liefert zehnmal pro Sekunde Zeilen <code>TRK {'{…}'}</code> mit Köpfen und Ausschnitten (0…1); dazu <code>GET /api/tracking</code>.</p>
    </Card>
  );
}
