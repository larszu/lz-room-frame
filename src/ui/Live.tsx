import { CircleCheck, Circle, EyeOff, Pause, Video } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useEngine } from './useEngine';
import { InputPreview, OutputPreview } from './InputPreview';
import { Card, Seg } from './controls';
import { SourcePicker } from './SourcePicker';
import type { Mode } from '../engine/types';

export const MODE_LABEL: Record<Mode, string> = { overview: 'Übersicht', group: 'Gruppe', people: 'Kacheln', speaker: 'Sprecher', presenter: 'Präsentator' };

export function Live({ go }: { go: (v: string) => void }) {
  const e = useEngine();
  const st = e.status();
  const s = e.settings;
  const anyOut = s.output.window.enabled || s.output.ndi.enabled || s.output.stream.enabled || s.output.v4l2.enabled;
  const steps = [
    { done: !!st.source.width, text: 'Kamera wählen', to: '' },
    { done: st.persons > 0, text: 'Personen werden erkannt', to: 'framing' },
    { done: s.activeScene !== 'tiles' || e.sceneDirty, text: 'Eine Szene ausprobieren', to: '' },
    { done: anyOut, text: 'Ausgang einschalten (Fenster, NDI, Stream)', to: 'outputs' },
  ];
  const doneCount = steps.filter((x) => x.done).length;
  const [hideSteps, setHideSteps] = useState(() => { try { return localStorage.getItem('lzrf.steps') === 'done'; } catch { return false; } });
  useEffect(() => {
    if (doneCount === steps.length && !hideSteps) {
      const t = setTimeout(() => { setHideSteps(true); try { localStorage.setItem('lzrf.steps', 'done'); } catch { /* ignore */ } }, 2500);
      return () => clearTimeout(t);
    }
  }, [doneCount, hideSteps, steps.length]);

  return (
    <div className="view">
      <div className="live">
        <div style={{ display: 'grid', gap: 'var(--space-4)', minInlineSize: 0 }}>
          <div className="screen">
            <OutputPreview />
            <div className="badge row">
              <span className={`pill${anyOut ? ' on' : ''}`}>{anyOut ? 'Ausgabe läuft' : 'Vorschau'}</span>
              <span className="pill">{st.sceneName}{e.sceneDirty ? ' · geändert' : ''}</span>
            </div>
            <div className="stats">
              <span className="pill">{st.persons} {st.persons === 1 ? 'Person' : 'Personen'}</span>
              <span className="pill">{s.output.width}×{s.output.height} · {st.fps} fps</span>
            </div>
          </div>
          <Card title="Szenen" action={
            <div className="row">
              <button className="btn danger" aria-pressed={e.privacy} onClick={() => e.exec(`privacy ${e.privacy ? 'off' : 'on'}`)}><EyeOff size={18} />Kamera aus</button>
              <button className="btn" aria-pressed={e.director.frozen} onClick={() => e.exec(`freeze ${e.director.frozen ? 'off' : 'on'}`)}><Pause size={18} />{e.director.frozen ? 'Weiter' : 'Bild halten'}</button>
            </div>
          }>
            <div className="scenes">
              {s.scenes.map((sc, i) => (
                <button key={sc.id} className="scene" aria-pressed={s.activeScene === sc.id} onClick={() => e.recallScene(sc.id)}>
                  {sc.name}<small>{i + 1} · {MODE_LABEL[sc.framing.mode]}</small>
                </button>
              ))}
            </div>
            <div className="row">
              <span className="muted">Modus</span>
              <Seg label="Modus" value={s.framing.mode} onChange={(m) => e.setFraming({ mode: m })} options={(Object.keys(MODE_LABEL) as Mode[]).map((m) => ({ value: m, label: MODE_LABEL[m] }))} />
            </div>
          </Card>
        </div>
        <div style={{ display: 'grid', gap: 'var(--space-4)', minInlineSize: 0 }}>
          <Card title="Kamera" action={<span className="muted">{st.source.width ? `${st.source.width}×${st.source.height}${st.source.fps ? ` · ${st.source.fps} fps` : ''}` : ''}</span>}>
            <InputPreview />
            {st.source.error && <div className="note err"><p>{st.source.error}</p></div>}
            {!!st.source.width && st.source.width < 2560 && s.framing.mode === 'people' && (
              <div className="note warn"><p>Unter 4K werden Kacheln schnell unscharf. Die Schärfegrenze zoomt dann weniger nah heran (Framing → Schärfegrenze).</p></div>
            )}
            <SourcePicker />
          </Card>
          {!hideSteps && (
            <Card title={<>Erste Schritte <span className="muted">{doneCount} von {steps.length}</span></>}>
              <div className="progress"><i style={{ inlineSize: `${(doneCount / steps.length) * 100}%` }} /></div>
              <ul className="checklist">
                {steps.map((x) => (
                  <li key={x.text} className={x.done ? 'done' : ''}>
                    {x.done ? <CircleCheck size={18} /> : <Circle size={18} />}
                    {x.to && !x.done ? <button className="btn ghost" style={{ padding: 0, minBlockSize: 0 }} onClick={() => go(x.to)}>{x.text}</button> : x.text}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <p className="muted row"><Video size={14} />Erkennung {st.detectMs} ms · {st.delegate || 'lädt …'}</p>
        </div>
      </div>
    </div>
  );
}
