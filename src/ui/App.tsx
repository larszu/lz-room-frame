import { Cable, LayoutGrid, Monitor, Moon, Radio, ScanFace, Sun, SunMoon } from 'lucide-react';
import { useEffect, useState } from 'react';
import signetNavy from '../brand/lzm_signet_navy_1c.svg?raw';
import { desktop } from '../desktop';
import { engine } from '../engine/engine';
import { Control } from './Control';
import { Seg } from './controls';
import { Framing } from './Framing';
import { Layouts } from './Layouts';
import { Live } from './Live';
import { Outputs } from './Outputs';

type View = 'live' | 'framing' | 'layouts' | 'outputs' | 'control';
type Theme = 'auto' | 'light' | 'dark';

const NAV: { id: View; label: string; icon: typeof Monitor }[] = [
  { id: 'live', label: 'Live', icon: Monitor },
  { id: 'framing', label: 'Framing', icon: ScanFace },
  { id: 'layouts', label: 'Layouts', icon: LayoutGrid },
  { id: 'outputs', label: 'Ausgänge', icon: Cable },
  { id: 'control', label: 'Steuerung', icon: Radio },
];

// signet in kit colours only: navy on light, off-white on dark, dot always tally red
const signet = signetNavy
  .replace(/fill="#1D324F"/, 'fill="var(--logo)"')
  .replace(/fill="#1D324F"/, 'fill="#D6402E"');

let started = false;

export function App() {
  const [view, setView] = useState<View>(() => { try { return (localStorage.getItem('lzrf.view') as View) || 'live'; } catch { return 'live'; } });
  const [theme, setTheme] = useState<Theme>(() => { try { return (localStorage.getItem('lzrf.theme') as Theme) || 'auto'; } catch { return 'auto'; } });

  useEffect(() => {
    if (theme === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('lzrf.theme', theme); } catch { /* ignore */ }
  }, [theme]);
  useEffect(() => { try { localStorage.setItem('lzrf.view', view); } catch { /* ignore */ } }, [view]);

  // a room PC comes back the way it was left: control server, input, outputs
  useEffect(() => {
    if (started) return;
    started = true;
    const s = engine.settings;
    desktop?.setControl(s.control);
    const i = s.input;
    if (i.kind === 'device' || (i.kind === 'network' && i.url) || (i.kind === 'file' && i.file)) engine.openInput();
    engine.syncSinks();
  }, []);

  const go = (v: string) => setView((v || 'live') as View);
  return (
    <div className="app">
      <header className="top">
        <div className="brand"><span className="logo" aria-hidden dangerouslySetInnerHTML={{ __html: signet }} /><span className="name">Room Frame</span></div>
        <span className="spacer" />
        <Seg label="Darstellung" icons value={theme} onChange={setTheme} options={[
          { value: 'auto', label: <SunMoon size={16} />, title: 'Automatisch' },
          { value: 'light', label: <Sun size={16} />, title: 'Hell' },
          { value: 'dark', label: <Moon size={16} />, title: 'Dunkel' },
        ]} />
      </header>
      <nav className="nav" aria-label="Bereiche">
        {NAV.map((n) => (
          <button key={n.id} aria-current={view === n.id ? 'page' : undefined} onClick={() => setView(n.id)} title={n.label}>
            <n.icon size={20} strokeWidth={1.75} /><span>{n.label}</span>
          </button>
        ))}
      </nav>
      <main className="main">
        {view === 'live' && <Live go={go} />}
        {view === 'framing' && <Framing />}
        {view === 'layouts' && <Layouts />}
        {view === 'outputs' && <Outputs />}
        {view === 'control' && <Control />}
      </main>
    </div>
  );
}

