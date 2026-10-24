import { Monitor, Moon, SlidersHorizontal, Sun, SunMoon, Wrench } from 'lucide-react';
import { useEffect, useState } from 'react';
import signetNavy from '../brand/lzm_signet_navy_1c.svg?raw';
import { desktop } from '../desktop';
import { engine } from '../engine/engine';
import { Seg } from './controls';
import { Live } from './Live';
import { Pro } from './Pro';
import { Setup } from './Setup';

type View = 'live' | 'setup' | 'pro';
type Theme = 'auto' | 'light' | 'dark';

const NAV: { id: View; label: string; icon: typeof Monitor }[] = [
  { id: 'live', label: 'Live', icon: Monitor },
  { id: 'setup', label: 'Einrichten', icon: Wrench },
  { id: 'pro', label: 'Profi', icon: SlidersHorizontal },
];

// signet in kit colours only: navy on light, off-white on dark, dot always tally red
const signet = signetNavy
  .replace(/fill="#1D324F"/, 'fill="var(--logo)"')
  .replace(/fill="#1D324F"/, 'fill="#D6402E"');

let started = false;

export function App() {
  const [view, setView] = useState<View>(() => {
    // first start without a camera: begin with setting up
    try { const v = localStorage.getItem('lzrf.view') as View; return NAV.some((n) => n.id === v) ? v : engine.settings.input.deviceId || localStorage.getItem('lzrf.view') ? 'live' : 'setup'; } catch { return 'live'; }
  });
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
        {view === 'setup' && <Setup go={go} />}
        {view === 'pro' && <Pro />}
      </main>
    </div>
  );
}

