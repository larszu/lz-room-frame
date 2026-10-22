// Speaker detection from one audio input: mono (voice + lips) or stereo (plus direction).
import { Crosshair, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Field, Seg, Slider, Toggle } from './controls';
import { useEngine } from './useEngine';

function Meter({ label, value }: { label: string; value: number }) {
  const db = value > 0 ? 20 * Math.log10(value) : -90;
  const w = Math.max(0, Math.min(1, (db + 60) / 60));
  return (
    <div className="row" style={{ flexWrap: 'nowrap', gap: 8 }}>
      <span className="muted" style={{ inlineSize: 14 }}>{label}</span>
      <div className="progress" style={{ flex: 1 }}><i style={{ inlineSize: `${w * 100}%`, transition: 'none' }} /></div>
    </div>
  );
}

export function AudioSpeaker() {
  const e = useEngine();
  const sp = e.settings.speaker;
  const set = (fn: (x: typeof sp) => void) => e.update((s) => fn(s.speaker));
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [msg, setMsg] = useState('');
  const [, tick] = useState(0);
  useEffect(() => {
    const load = () => navigator.mediaDevices?.enumerateDevices().then((d) => { setInputs(d.filter((x) => x.kind === 'audioinput')); setCams(d.filter((x) => x.kind === 'videoinput')); }).catch(() => {});
    load();
    navigator.mediaDevices?.addEventListener('devicechange', load);
    const t = setInterval(() => tick((n) => n + 1), 100); // meters
    return () => { navigator.mediaDevices?.removeEventListener('devicechange', load); clearInterval(t); };
  }, []);
  const camGroup = cams.find((c) => c.deviceId === e.settings.input.deviceId)?.groupId;
  const r = e.audioReading;
  const stereo = sp.channels === 'stereo';

  return (
    <>
      <Field label="Audioquelle" hint="Kameraton über die Capture-Karte (z. B. DSLM per HDMI), USB-Audio, Klinke am Rechner oder das Raummikrofon. Echo- und Rauschunterdrückung sind aus, damit Stereo erhalten bleibt.">
        <select value={sp.micId} onChange={(ev) => set((x) => { x.micId = ev.target.value; })}>
          <option value="">Standardeingang</option>
          {inputs.filter((m) => m.deviceId !== 'default').map((m, i) => (
            <option key={m.deviceId || i} value={m.deviceId}>{m.label || `Eingang ${i + 1}`}{camGroup && m.groupId === camGroup ? ' · Ton der gewählten Kamera' : ''}</option>
          ))}
        </select>
      </Field>
      {e.audio.error && <div className="note err"><p>{e.audio.error}</p></div>}
      <Field label="Kanäle" hint={stereo
        ? 'Stereo: Richtung aus Pegel- und Laufzeitunterschied, dazu Lippenbewegung. Mikrofon nahe der Kamera aufstellen, links muss im Bild links sein.'
        : 'Mono: erkennt, dass jemand spricht; wer es ist, entscheidet die Lippenbewegung.'}>
        <Seg label="Kanäle" value={sp.channels} onChange={(v) => set((x) => { x.channels = v; })} options={[{ value: 'mono', label: 'Mono' }, { value: 'stereo', label: 'Stereo' }]} />
      </Field>
      {stereo && (e.audio.channels === 1 || e.audio.dualMono) && <div className="note warn"><p>{e.audio.dualMono ? 'Beide Kanäle sind gleich: Die Quelle ist Mono.' : 'Diese Quelle liefert nur einen Kanal.'} Ohne Richtung arbeitet die Erkennung wie Mono.</p></div>}
      <div style={{ display: 'grid', gap: 4 }}>
        <Meter label={stereo ? 'L' : ''} value={r.levelL} />
        {stereo && <Meter label="R" value={r.levelR} />}
        <span className={`status ${r.voice ? 'ok' : ''}`}>{r.voice ? 'Sprache' : 'still'}{e.audioX !== null ? ` · Richtung ${Math.round(e.audioX * 100)} %` : ''}</span>
      </div>
      <Slider label="Sprachschwelle" value={sp.threshold} min={0.002} max={0.2} step={0.002} format={(v) => v.toFixed(3)} onChange={(v) => set((x) => { x.threshold = v; })} hint="Knapp über dem Grundrauschen des Raums einstellen." />
      {stereo && (
        <>
          <Slider label="Lippen gegenüber Richtung" value={sp.lipWeight} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)} % Lippen`} onChange={(v) => set((x) => { x.lipWeight = v; })} />
          <Toggle label="Links und rechts tauschen" checked={sp.swap} onChange={(v) => set((x) => { x.swap = v; })} />
          {!sp.calib && <Slider label="Stereobreite" value={sp.width} min={0.3} max={1.5} step={0.05} format={(v) => v.toFixed(2)} onChange={(v) => set((x) => { x.width = v; })} hint="Ohne Kalibrierung: wie weit die Richtung über das Bild reicht." />}
          <Field label="Kalibrierung" hint="Eine Person links spricht → Punkt setzen; eine Person rechts spricht → Punkt setzen. Danach stimmt die Richtung mit dem Bild überein.">
            <div className="row">
              <button className="btn" disabled={!e.audioReading.voice} onClick={() => setMsg(e.addCalibrationPoint())}><Crosshair size={16} />Punkt setzen</button>
              {(sp.calib || e.calibPoints.length > 0) && <button className="btn ghost" onClick={() => { e.resetCalibration(); setMsg(''); }}><RotateCcw size={16} />Zurücksetzen</button>}
              <span className="muted">{msg || (sp.calib ? 'kalibriert' : 'nicht kalibriert')}</span>
            </div>
          </Field>
        </>
      )}
    </>
  );
}
