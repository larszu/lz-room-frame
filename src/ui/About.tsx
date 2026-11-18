// Info: version, licence, third-party components and trademarks. The full texts ship with the
// app (<resources>/legal, scripts/notices.mjs); in a browser the links go to GitHub.
import { ExternalLink, FolderOpen } from 'lucide-react';
import { desktop } from '../desktop';
import { Card } from './controls';
import { useDesktopInfo } from './Outputs';

const REPO = 'https://github.com/larszu/lz-room-frame';

const PARTS: [string, string, string][] = [
  ['RTMO-s (OpenMMLab MMPose)', 'Apache-2.0', 'Personen und Körperpunkte'],
  ['OSNet-AIN x0.25 (Torchreid)', 'MIT', 'Wiedererkennen'],
  ['MediaPipe Tasks Vision, Face Landmarker', 'Apache-2.0', 'Lippen, wer spricht'],
  ['ONNX Runtime Web', 'MIT', 'rechnet die Modelle'],
  ['FFmpeg (eigener Build mit x264, x265, libsrt, mbedTLS, zlib)', 'GPL-3.0', 'Streams, Netzwerk-Eingänge, Linux-Kamera'],
  ['atem-connection, FreeType', 'MIT, FTL', 'ATEM-Steuerung'],
  ['Electron, Chromium', 'MIT, BSD u. a.', 'App-Gerüst'],
  ['React, Lucide, ws', 'MIT, ISC', 'Oberfläche, Steuerung'],
  ['Public Sans', 'OFL-1.1', 'Schrift'],
];

export function About() {
  const info = useDesktopInfo();
  const open = (url: string) => (desktop ? desktop.openExternal(url) : window.open(url, '_blank', 'noopener'));
  const link = (label: string, url: string) => <button className="btn ghost link" onClick={() => open(url)}>{label}</button>;

  return (
    <div className="view narrow">
      <h1>Info</h1>
      <p className="lead">LZ Room Frame{info ? ` ${info.version}` : ''} · © 2026 Lars Zumpe, Lars Zumpe Medienproduktion</p>

      <Card title="Lizenz">
        <p style={{ margin: 0 }}>Proprietär und kostenlos nutzbar, auch geschäftlich. Der Quellcode ist öffentlich zum Lesen, Prüfen und Melden von Fehlern, aber nicht Open Source.</p>
        <p className="muted" style={{ margin: 0 }}>Nur mit schriftlicher Zustimmung: weitergeben, verkaufen, verändern, Teile in anderen Projekten verwenden, als Dienst für Dritte anbieten. Ohne Gewährleistung; es gilt deutsches Recht.</p>
        <div className="row">
          {desktop && <button className="btn" onClick={() => desktop?.showFolder('legal')}><FolderOpen size={16} />Lizenztexte öffnen</button>}
          <button className="btn" onClick={() => open(`${REPO}/blob/main/LICENSE`)}><ExternalLink size={16} />Lizenz auf GitHub</button>
        </div>
      </Card>

      <Card title="Komponenten Dritter">
        <p className="muted" style={{ margin: 0 }}>Sie behalten ihre eigenen Lizenzen. Die vollständigen Texte liegen der App bei.</p>
        <table className="cmds">
          <tbody>{PARTS.map(([name, lic, use]) => <tr key={name}><td>{lic}</td><td>{name}<br /><span className="muted">{use}</span></td></tr>)}</tbody>
        </table>
        <p className="muted" style={{ margin: 0 }}>FFmpeg läuft als eigenes Programm. Quelltext und Build-Skript hängen an jedem Release: {link('Releases', `${REPO}/releases`)}</p>
      </Card>

      <Card title="Marken">
        <p className="muted" style={{ margin: 0 }}>NDI® ist eine eingetragene Marke der Vizrt NDI AB ({link('ndi.video', 'https://ndi.video')}); die NDI-Runtime ist nicht enthalten. ATEM ist eine Marke von Blackmagic Design. Q-SYS ist eine Marke von QSC, Crestron eine Marke von Crestron Electronics. Logo und Signet der Lars Zumpe Medienproduktion sind nicht frei verwendbar.</p>
      </Card>

      <Card title="Kontakt">
        <p className="muted" style={{ margin: 0 }}>{link('zumpelars.de', 'https://zumpelars.de')} · {link('Impressum', 'https://zumpelars.de/impressum/')} · Fehler und Ideen: {link('Issues', `${REPO}/issues`)}</p>
      </Card>
    </div>
  );
}
