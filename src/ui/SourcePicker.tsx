import { FolderOpen, Play, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { desktop } from '../desktop';
import { Field, Seg, Toggle } from './controls';
import { useEngine } from './useEngine';

const RES = [
  { v: '0x0', label: 'Höchste verfügbare' },
  { v: '3840x2160', label: '3840 × 2160 (4K)' },
  { v: '2560x1440', label: '2560 × 1440' },
  { v: '1920x1080', label: '1920 × 1080' },
  { v: '1280x720', label: '1280 × 720' },
];

export function SourcePicker() {
  const e = useEngine();
  const inp = e.settings.input;
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [url, setUrl] = useState(inp.url);
  const refresh = useCallback(async () => {
    try { setDevices((await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput')); } catch { setDevices([]); }
  }, []);
  useEffect(() => {
    refresh();
    navigator.mediaDevices?.addEventListener('devicechange', refresh);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', refresh);
  }, [refresh]);

  const open = async () => { await e.openInput(); refresh(); };
  const set = (patch: Partial<typeof inp>) => e.update((s) => { s.input = { ...s.input, ...patch }; });

  return (
    <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
      <Seg label="Art des Eingangs" value={inp.kind} onChange={(k) => set({ kind: k })} options={[
        { value: 'device', label: 'Kamera / Capture' }, { value: 'network', label: 'Netzwerk' }, { value: 'file', label: 'Videodatei' },
      ]} />
      {inp.kind === 'device' && (
        <>
          <Field label="Gerät" hint="USB-Kameras, HDMI- und SDI-Capture-Karten (UVC, Magewell, Blackmagic, AJA …) erscheinen hier.">
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <select value={inp.deviceId} onChange={(ev) => set({ deviceId: ev.target.value })}>
                <option value="">Standardkamera</option>
                {devices.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Kamera ${i + 1}`}</option>)}
              </select>
              <button className="btn icon" onClick={refresh} title="Geräte neu suchen" aria-label="Geräte neu suchen"><RefreshCw size={18} /></button>
            </div>
          </Field>
          <div className="cols" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
            <Field label="Auflösung">
              <select value={`${inp.width}x${inp.height}`} onChange={(ev) => { const [w, h] = ev.target.value.split('x').map(Number); set({ width: w, height: h }); }}>
                {RES.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}
              </select>
            </Field>
            <Field label="Bildrate">
              <select value={inp.fps} onChange={(ev) => set({ fps: Number(ev.target.value) })}>
                {[24, 25, 30, 50, 60].map((f) => <option key={f} value={f}>{f} fps</option>)}
              </select>
            </Field>
          </div>
        </>
      )}
      {inp.kind === 'network' && (
        <Field label="Adresse" hint={desktop ? 'RTSP von PTZ- und IP-Kameras, SRT, RTMP, HTTP-MJPEG oder UDP.' : 'Netzwerkquellen gibt es nur in der Desktop-App.'}>
          <input type="url" placeholder="rtsp://kamera/stream1" value={url} onChange={(ev) => setUrl(ev.target.value)} onBlur={() => set({ url })} />
        </Field>
      )}
      {inp.kind === 'file' && (
        <Field label="Videodatei" hint="Zum Testen und Einrichten ohne Kamera.">
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input type="text" readOnly value={inp.file ? decodeURIComponent(inp.file.split('/').pop() ?? '') : ''} placeholder="Keine Datei" />
            <button className="btn" disabled={!desktop} onClick={async () => { const f = await desktop?.openVideoFile(); if (f) set({ file: f }); }}><FolderOpen size={18} />Wählen</button>
          </div>
        </Field>
      )}
      <Toggle label="Spiegeln" hint="Für Kameras, die über Kopf oder spiegelverkehrt liefern" checked={inp.mirror} onChange={(v) => set({ mirror: v })} />
      <div className="row end">
        <button className="btn primary" onClick={() => { if (inp.kind === 'network') set({ url }); open(); }}><Play size={18} />{e.source.width ? 'Eingang neu öffnen' : 'Eingang öffnen'}</button>
      </div>
    </div>
  );
}
