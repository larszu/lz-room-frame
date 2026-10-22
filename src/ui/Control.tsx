import { FolderOpen, Send } from 'lucide-react';
import { useState } from 'react';
import { desktop } from '../desktop';
import { HELP } from '../engine/commands';
import { Card, Field, Toggle } from './controls';
import { useDesktopInfo } from './Outputs';
import { useEngine } from './useEngine';

export function Control() {
  const e = useEngine();
  const c = e.settings.control;
  const info = useDesktopInfo();
  const [http, setHttp] = useState(c.http), [tcp, setTcp] = useState(c.tcp);
  const [msg, setMsg] = useState('');
  const [line, setLine] = useState('status');
  const [answer, setAnswer] = useState('');
  const host = info?.addresses[0] ?? '127.0.0.1';

  const apply = async (enabled = c.enabled) => {
    e.update((s) => { s.control = { http, tcp, enabled }; });
    const r = await desktop?.setControl({ http, tcp, enabled });
    setMsg(r ? (r.ok ? 'Übernommen' : `Fehler: ${r.error}`) : '');
  };

  return (
    <div className="view">
      <h1>Steuerung</h1>
      <p className="lead">Szenen und Modi lassen sich von Crestron, Q-SYS, Bitfocus Companion, Stream Deck oder jedem Browser im Netz abrufen.</p>
      <div className="cols">
        <Card title="Zugang">
          {!desktop && <div className="note warn"><p>Die Steuerung gibt es nur in der Desktop-App.</p></div>}
          <Toggle label="Steuerung aus dem Netz erlauben" hint="Aus: nur von diesem Rechner" checked={c.enabled} onChange={(v) => apply(v)} />
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <Field label="HTTP / WebSocket"><input type="number" min={1024} max={65535} value={http} onChange={(ev) => setHttp(Number(ev.target.value))} /></Field>
            <Field label="TCP (Crestron, Q-SYS)"><input type="number" min={1024} max={65535} value={tcp} onChange={(ev) => setTcp(Number(ev.target.value))} /></Field>
          </div>
          <div className="row"><button className="btn primary" onClick={() => apply()}>Ports übernehmen</button><span className="muted">{msg}</span></div>
          {info && (
            <ul style={{ margin: 0, paddingInlineStart: '1.2em', display: 'grid', gap: 4 }}>
              <li>Fernbedienung (Touchpanel, Tablet): <code>http://{host}:{info.httpPort}/</code></li>
              <li>Vorschau-Stream: <code>http://{host}:{info.httpPort}/preview.mjpg</code></li>
              <li>TCP: <code>{host}:{info.tcpPort || '—'}</code>, ein Befehl pro Zeile</li>
              <li>HTTP: <code>http://{host}:{info.httpPort}/api/command?c=scene%201</code></li>
            </ul>
          )}
        </Card>

        <Card title="Befehl testen">
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input type="text" className="mono" value={line} onChange={(ev) => setLine(ev.target.value)} onKeyDown={(ev) => { if (ev.key === 'Enter') setAnswer(e.exec(line)); }} aria-label="Befehl" />
            <button className="btn" onClick={() => setAnswer(e.exec(line))}><Send size={16} />Senden</button>
          </div>
          {answer && <pre className="mono" style={{ whiteSpace: 'pre-wrap', margin: 0, padding: 'var(--space-3)', maxBlockSize: 220, overflow: 'auto' }}>{answer}</pre>}
          <table className="cmds"><tbody>
            {HELP.map((h) => { const [cmd, ...rest] = h.split(/\s{2,}/); return <tr key={h}><td>{cmd}</td><td className="muted">{rest.join(' ')}</td></tr>; })}
          </tbody></table>
        </Card>

        <Card title="Mediensteuerung">
          <p style={{ margin: 0 }}><strong>Q-SYS:</strong> Plugin <code>LZ Room Frame.qplug</code> in Designer laden, IP und Port eintragen. Szenen als Buttons, Modus, Kamera aus, Personenzahl und Sprecherzonen als Steuerpins (z. B. von Automixer-Gates).</p>
          <p style={{ margin: 0 }}><strong>Crestron:</strong> TCP/IP Client auf Port {info?.tcpPort || c.tcp}, Befehle mit <code>\x0D\x0A</code>. Beispielprogramm und SIMPL#-Klasse liegen bei.</p>
          <div className="row">
            <button className="btn" disabled={!desktop} onClick={() => desktop?.showFolder('qsys')}><FolderOpen size={16} />Q-SYS-Plugin</button>
            <button className="btn" disabled={!desktop} onClick={() => desktop?.showFolder('crestron')}><FolderOpen size={16} />Crestron</button>
          </div>
        </Card>

        <Card title="Raumrechner">
          <Toggle label="Mit dem System starten" checked={e.settings.app.autostart} onChange={(v) => { e.update((s) => { s.app.autostart = v; }); desktop?.setAutostart(v, e.settings.app.startHidden); }} disabled={info?.platform === 'linux'} hint={info?.platform === 'linux' ? 'Linux: lz-room-frame.desktop nach ~/.config/autostart kopieren' : undefined} />
          <Toggle label="Versteckt starten" hint="Läuft im Hintergrund, Symbol in der Menü- bzw. Taskleiste" checked={e.settings.app.startHidden} onChange={(v) => { e.update((s) => { s.app.startHidden = v; }); desktop?.setAutostart(e.settings.app.autostart, v); }} />
          <p className="muted" style={{ margin: 0 }}>Beim Start öffnet die App den zuletzt genutzten Eingang, die Szene und die Ausgänge wieder.</p>
        </Card>
      </div>
    </div>
  );
}
