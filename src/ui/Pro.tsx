// Everything for integrators, unchanged: scenes in detail, layouts, all outputs, control.
import { useState } from 'react';
import { Control } from './Control';
import { Seg } from './controls';
import { Framing } from './Framing';
import { Layouts } from './Layouts';
import { Outputs } from './Outputs';

type Tab = 'framing' | 'layouts' | 'outputs' | 'control';

export function Pro() {
  const [tab, setTab] = useState<Tab>(() => { try { return (localStorage.getItem('lzrf.pro') as Tab) || 'framing'; } catch { return 'framing'; } });
  const pick = (t: Tab) => { setTab(t); try { localStorage.setItem('lzrf.pro', t); } catch { /* ignore */ } };
  return (
    <div className="view">
      <Seg label="Profi-Bereich" value={tab} onChange={pick} options={[
        { value: 'framing', label: 'Szenen & Framing' }, { value: 'layouts', label: 'Layouts' }, { value: 'outputs', label: 'Alle Ausgänge' }, { value: 'control', label: 'Steuerung' },
      ]} />
      {tab === 'framing' && <Framing />}
      {tab === 'layouts' && <Layouts />}
      {tab === 'outputs' && <Outputs />}
      {tab === 'control' && <Control />}
    </div>
  );
}
