// "Als Kamera in Teams, Zoom, Meet": the virtual camera with its one-time setup.
import { useEffect, useState } from 'react';
import { desktop, type VcamStatus } from '../desktop';
import { SinkState, Toggle } from './controls';
import { useEngine } from './useEngine';

export function VirtualCamera() {
  const e = useEngine();
  const o = e.settings.output;
  const [st, setSt] = useState<VcamStatus | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { desktop?.vcam.status().then(setSt); }, []);
  const on = (v: boolean) => e.update((s) => { s.output.v4l2.enabled = v; });
  const setup = async () => {
    if (!desktop) return;
    setBusy(true);
    const r = await desktop.vcam.setup();
    setBusy(false); setSt(r);
    if (r.ok) on(true);
  };

  if (!desktop) return <p className="muted" style={{ margin: 0 }}>Als Kamera in Teams oder Zoom gibt es nur in der Desktop-App.</p>;
  const ready = !!st?.ok;
  return (
    <>
      <Toggle label="Als Kamera in Teams, Zoom, Meet" hint={ready ? 'Dort die Kamera „LZ Room Frame“ wählen' : st?.error} checked={o.v4l2.enabled && ready} disabled={!ready} onChange={on} />
      {o.v4l2.enabled && ready && <SinkState s={e.sinks.v4l2} />}
      {st && !st.ok && st.setup && (
        <div className="note">
          <p>Einmalig einrichten. Das System fragt dazu nach dem Admin-Passwort.</p>
          <button className="btn primary" disabled={busy} onClick={setup} style={{ marginBlockStart: 'var(--space-2)' }}>{busy ? 'Wird eingerichtet …' : 'Kamera einrichten'}</button>
        </div>
      )}
      {st?.install && (
        <div className="note">
          <p>Erst einmal im Terminal installieren, dann hier einrichten:</p>
          <p><code>{st.install}</code></p>
          <button className="btn ghost link" onClick={() => desktop?.vcam.status().then(setSt)}>Erneut prüfen</button>
        </div>
      )}
    </>
  );
}
