import { Camera, EyeOff, LayoutGrid, Maximize, Mic, Pause, Play, Presentation, Users } from 'lucide-react';
import { useEngine } from './useEngine';
import { InputPreview, OutputPreview } from './InputPreview';
import type { Mode } from '../engine/types';

export const MODE_LABEL: Record<Mode, string> = { overview: 'Übersicht', group: 'Gruppe', people: 'Kacheln', speaker: 'Sprecher', presenter: 'Präsentator' };
const MODE_ICON: Record<Mode, typeof Users> = { overview: Maximize, group: Users, people: LayoutGrid, speaker: Mic, presenter: Presentation };
const MODE_HINT: Record<Mode, string> = {
  overview: 'Ganzes Kamerabild',
  group: 'Alle im Bild',
  people: 'Jede Person eine Kachel',
  speaker: 'Wer spricht',
  presenter: 'Folgt einer Person',
};

/** The one view for running a meeting: the picture, the scenes, privacy. */
export function Live({ go }: { go: (v: string) => void }) {
  const e = useEngine();
  const st = e.status();
  const s = e.settings;
  const anyOut = s.output.window.enabled || s.output.ndi.enabled || s.output.stream.enabled || s.output.v4l2.enabled;
  const hasCam = !!st.source.width;

  return (
    <div className="view">
      <div className="live">
        <div className="stack">
          <div className="screen">
            <OutputPreview />
            {!hasCam && (
              <div className="empty">
                <Camera size={32} />
                <p>{st.source.error || 'Noch keine Kamera verbunden.'}</p>
                <button className="btn primary" onClick={async () => { await e.openInput(); if (!e.source.width) go('setup'); }}>Kamera verbinden</button>
                <button className="btn ghost link" style={{ color: '#fff' }} onClick={() => go('setup')}>Andere Kamera wählen</button>
              </div>
            )}
            {hasCam && (
              <div className="badge row">
                <span className={`pill${anyOut ? ' on' : ''}`}>{anyOut ? 'Wird gesendet' : 'Nur Vorschau'}</span>
                {e.privacy && <span className="pill on">Kamera aus</span>}
                {e.director.frozen && <span className="pill">Bild gehalten</span>}
              </div>
            )}
          </div>

          <section aria-label="Bild wählen" className="scenes big">
            {s.scenes.map((sc) => {
              const Icon = MODE_ICON[sc.framing.mode];
              return (
                <button key={sc.id} className="scene" title={MODE_HINT[sc.framing.mode]} aria-pressed={s.activeScene === sc.id} onClick={() => e.recallScene(sc.id)}>
                  <Icon size={22} strokeWidth={1.75} />
                  <span>{sc.name}</span>
                </button>
              );
            })}
          </section>

          <div className="row actions">
            <button className="btn danger" aria-pressed={e.privacy} onClick={() => e.exec(`privacy ${e.privacy ? 'off' : 'on'}`)}>
              {e.privacy ? <><Play size={18} />Kamera wieder an</> : <><EyeOff size={18} />Kamera aus</>}
            </button>
            <button className="btn" aria-pressed={e.director.frozen} onClick={() => e.exec(`freeze ${e.director.frozen ? 'off' : 'on'}`)}>
              {e.director.frozen ? <><Play size={18} />Weiter folgen</> : <><Pause size={18} />Bild anhalten</>}
            </button>
          </div>
        </div>

        <aside className="stack">
          <section className="card">
            <h2><span className="grow">Kamera</span><span className="muted">{st.persons === 1 ? '1 Person' : `${st.persons} Personen`}</span></h2>
            <InputPreview outlines={false} />
            <p className="muted" style={{ margin: 0 }}>{hasCam ? st.source.label : 'Nicht verbunden'}</p>
            {!anyOut && hasCam && (
              <div className="note">
                <p>Das Bild wird noch nirgends hin gesendet.</p>
                <button className="btn ghost link" onClick={() => go('setup')}>Ausgabe einrichten</button>
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
