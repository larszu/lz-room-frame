import { Plus, Save, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { SHOT_LABEL } from '../engine/framing';
import { LAYOUT_TEMPLATES, STYLE_LABEL } from '../engine/layouts';
import type { Accuracy, SpeakerSource } from '../engine/settings';
import type { LayoutStyle, Mode, Shot, Speed, Transition } from '../engine/types';
import { Card, Field, pct, Seg, Slider, Toggle } from './controls';
import { InputPreview, type DrawMode } from './InputPreview';
import { MODE_LABEL } from './Live';
import { useEngine } from './useEngine';
import { PtzCard } from './Tracking';
import { AudioSpeaker } from './AudioSpeaker';

const SPEED: Record<Speed, string> = { slow: 'Langsam', normal: 'Normal', fast: 'Schnell' };
const TRANS: Record<Transition, string> = { smooth: 'Weich fahren', fade: 'Blende', cut: 'Schnitt' };

export function Framing() {
  const e = useEngine();
  const f = e.settings.framing;
  const s = e.settings;
  const active = s.scenes.find((x) => x.id === s.activeScene);
  const [draw, setDraw] = useState<DrawMode>(null);

  const saveNew = () => {
    const name = `Szene ${s.scenes.length + 1}`;
    const id = `s${Date.now().toString(36)}`;
    e.update((st) => { st.scenes.push({ id, name, framing: { ...st.framing } }); st.activeScene = id; });
  };
  const overwrite = () => e.update((st) => { const sc = st.scenes.find((x) => x.id === st.activeScene); if (sc) sc.framing = { ...st.framing }; });

  return (
    <div className="view">
      <h1>Framing</h1>
      <p className="lead">Wie die Kamera Personen rahmt. Jede Einstellung lässt sich als Szene speichern und über Crestron, Q-SYS oder die Fernbedienung abrufen.</p>
      <div className="cols">
        <Card title="Szene" action={<span className="muted">{active ? active.name : 'keine'}{e.sceneDirty ? ' · geändert' : ''}</span>}>
          <div className="scenes">
            {s.scenes.map((sc, i) => (
              <button key={sc.id} className="scene" aria-pressed={sc.id === s.activeScene} onClick={() => e.recallScene(sc.id)}>{sc.name}<small>{i + 1} · {MODE_LABEL[sc.framing.mode]}</small></button>
            ))}
          </div>
          {active && (
            <Field label="Name">
              <input type="text" value={active.name} onChange={(ev) => e.update((st) => { const sc = st.scenes.find((x) => x.id === st.activeScene); if (sc) sc.name = ev.target.value; })} />
            </Field>
          )}
          <div className="row">
            <button className="btn primary" disabled={!e.sceneDirty || !active} onClick={overwrite}><Save size={18} />Szene speichern</button>
            <button className="btn" onClick={saveNew}><Plus size={18} />Als neue Szene</button>
            {active && <button className="btn ghost" onClick={() => e.update((st) => { st.scenes = st.scenes.filter((x) => x.id !== active.id); st.activeScene = st.scenes[0]?.id ?? null; })}><Trash2 size={18} />Löschen</button>}
          </div>
        </Card>

        <Card title="Bild">
          <Field label="Modus" hint={{
            overview: 'Das ganze Kamerabild, ohne Nachführen.',
            group: 'Ein Ausschnitt, der alle Personen zeigt – wie Auto-Framing.',
            people: 'Jede Person in einer eigenen Kachel. Bei mehr Personen als erlaubt: Gruppe.',
            speaker: 'Wer spricht, ist im Bild. Ohne Sprecher: Gruppe.',
            presenter: 'Folgt einer Person (die größte oder per Steuerung gewählte).',
          }[f.mode]}>
            <Seg label="Modus" value={f.mode} onChange={(m: Mode) => e.setFraming({ mode: m })} options={(Object.keys(MODE_LABEL) as Mode[]).map((m) => ({ value: m, label: MODE_LABEL[m] }))} />
          </Field>
          <Field label="Bildgröße pro Person">
            <Seg label="Bildgröße" value={f.shot} onChange={(v: Shot) => e.setFraming({ shot: v })} options={(Object.keys(SHOT_LABEL) as Shot[]).map((k) => ({ value: k, label: SHOT_LABEL[k] }))} />
          </Field>
          {f.mode === 'people' && (
            <Field label="Raster" hint="Ergibt sich aus der Personenzahl. Eigene Raster unter Layouts.">
              <Seg label="Raster" value={f.style} onChange={(v: LayoutStyle) => e.setFraming({ style: v })} options={(Object.keys(STYLE_LABEL) as LayoutStyle[]).map((k) => ({ value: k, label: STYLE_LABEL[k] }))} />
            </Field>
          )}
          {f.mode !== 'overview' && (
            <Field label="Festes Layout" hint="Gilt für jede Personenzahl – z. B. Gruppe groß mit Nahaufnahme als Bild im Bild.">
              <select value={f.layout ?? ''} onChange={(ev) => e.setFraming({ layout: ev.target.value || null })}>
                <option value="">Keins (nach Modus und Personenzahl)</option>
                <optgroup label="Vorlagen">{LAYOUT_TEMPLATES.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</optgroup>
                {!!s.layouts.length && <optgroup label="Eigene">{s.layouts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</optgroup>}
              </select>
            </Field>
          )}
          <Slider label="Kopfluft" value={f.headroom} min={0} max={0.3} step={0.01} format={pct} onChange={(v) => e.setFraming({ headroom: v })} />
          {(f.mode === 'group' || f.mode === 'people') && <Slider label="Rand um die Gruppe" value={f.padding} min={0} max={0.4} step={0.01} format={pct} onChange={(v) => e.setFraming({ padding: v })} />}
          {f.mode === 'people' && <Slider label="Höchstens Kacheln" value={f.maxPeople} min={1} max={16} step={1} onChange={(v) => e.setFraming({ maxPeople: v })} hint="Mehr Personen im Raum → Gruppenbild" />}
        </Card>

        <Card title="Bewegung">
          <Field label="Geschwindigkeit"><Seg label="Geschwindigkeit" value={f.speed} onChange={(v: Speed) => e.setFraming({ speed: v })} options={(Object.keys(SPEED) as Speed[]).map((k) => ({ value: k, label: SPEED[k] }))} /></Field>
          <Field label="Übergang bei neuem Bild"><Seg label="Übergang" value={f.transition} onChange={(v: Transition) => e.setFraming({ transition: v })} options={(Object.keys(TRANS) as Transition[]).map((k) => ({ value: k, label: TRANS[k] }))} /></Field>
          <Slider label="Ruhezone" value={f.deadband} min={0} max={0.3} step={0.01} format={pct} onChange={(v) => e.setFraming({ deadband: v })} hint="Kleine Bewegungen lösen kein Nachführen aus. Höher = ruhigeres Bild." />
          <Slider label="Halten, wenn jemand nicht erkannt wird" value={f.holdTime} min={0.5} max={10} step={0.5} format={(v) => `${v} s`} onChange={(v) => e.setFraming({ holdTime: v })} hint="Wer sich wegdreht oder kurz verdeckt ist, bleibt so lange im Bild." />
          <Slider label="Schärfegrenze" value={f.maxUpscale} min={1} max={4} step={0.1} format={(v) => `${v.toFixed(1)}×`} onChange={(v) => e.setFraming({ maxUpscale: v })} hint="Höchste Vergrößerung des Kamerabilds. Niedriger = schärfer, aber weiter." />
          {f.mode === 'speaker' && <Slider label="Ohne Sprecher zurück zur Gruppe nach" value={f.speakerFallback} min={1} max={15} step={1} format={(v) => `${v} s`} onChange={(v) => e.setFraming({ speakerFallback: v })} />}
          <Toggle label="Sprecher hervorheben" hint="Rahmen um die Kachel der sprechenden Person" checked={f.highlightSpeaker} onChange={(v) => e.setFraming({ highlightSpeaker: v })} />
          <Toggle label="Namen einblenden" checked={f.showLabels} onChange={(v) => e.setFraming({ showLabels: v })} />
        </Card>
      </div>

      <div className="cols">
        <Card title="Raum" action={<span className="muted">{e.persons.length} erkannt</span>}>
          <p className="muted" style={{ margin: 0 }}>Raumgrenze und Ausschlusszonen halten Personen hinter Glaswänden, im Flur oder auf Bildschirmen aus dem Bild. Ziehen Sie dazu ein Rechteck im Kamerabild.</p>
          <Seg label="Zeichnen" value={draw ?? 'none'} onChange={(v) => setDraw(v === 'none' ? null : (v as DrawMode))} options={[
            { value: 'none', label: 'Ansehen' }, { value: 'boundary', label: 'Raumgrenze' }, { value: 'exclusion', label: 'Ausschlusszone' }, { value: 'speaker', label: 'Sprecherzone' },
          ]} />
          <InputPreview draw={draw} onRect={(r) => e.update((st) => {
            if (draw === 'boundary') st.zones.boundary = r;
            else if (draw === 'exclusion') st.zones.exclusions.push(r);
            else if (draw === 'speaker') st.zones.speakerZones.push({ name: `Zone ${st.zones.speakerZones.length + 1}`, x0: r.x, x1: r.x + r.w });
          })} />
          <div className="row">
            {(s.zones.boundary.w < 1 || s.zones.boundary.h < 1) && <button className="btn" onClick={() => e.update((st) => { st.zones.boundary = { x: 0, y: 0, w: 1, h: 1 }; })}><X size={16} />Raumgrenze aufheben</button>}
            {s.zones.exclusions.map((_, i) => <button key={i} className="btn" onClick={() => e.update((st) => { st.zones.exclusions.splice(i, 1); })}><X size={16} />Ausschluss {i + 1}</button>)}
          </div>
          <Slider label="Mindestgröße des Kopfs" value={s.zones.minHead} min={0} max={0.12} step={0.005} format={pct} onChange={(v) => e.update((st) => { st.zones.minHead = v; })} hint="Anteil an der Bildhöhe. Ignoriert Personen weit hinten oder draußen." />
          <Field label="Erkennung" hint="Genauer findet auch kleine Personen im 4K-Bild, braucht aber mehr Rechenzeit.">
            <Seg label="Erkennung" value={s.accuracy} onChange={(v: Accuracy) => e.update((st) => { st.accuracy = v; })} options={[{ value: 'fast', label: 'Schnell' }, { value: 'accurate', label: 'Genau' }, { value: 'max', label: 'Großer Raum' }]} />
          </Field>
          <Slider label="Erkennungen pro Sekunde" value={s.detectHz} min={1} max={15} step={1} onChange={(v) => e.update((st) => { st.detectHz = v; })} />
        </Card>

        <Card title="Sprecher">
          <Field label="Wer spricht, erkennt …" hint={{
            off: 'Keine Sprechererkennung.',
            auto: 'Ein Mikrofon oder Stereo-Mikrofon: Sprache plus Lippenbewegung, bei Stereo zusätzlich die Richtung. Experimentell.',
            external: 'Das Audiosystem meldet über die Steuerung, welche Sprecherzone aktiv ist (z. B. Q-SYS-Automixer-Gates, Crestron, Tischmikrofone). Am zuverlässigsten.',
          }[s.speaker.source]}>
            <Seg label="Sprechererkennung" value={s.speaker.source} onChange={(v: SpeakerSource) => e.update((st) => { st.speaker.source = v; })} options={[{ value: 'off', label: 'Aus' }, { value: 'auto', label: 'Mikrofon' }, { value: 'external', label: 'Audiosystem' }]} />
          </Field>
          {s.speaker.source === 'auto' && <AudioSpeaker />}
          {s.speaker.source === 'external' && (
            <>
              <p className="muted" style={{ margin: 0 }}>Sprecherzonen im Kamerabild unter „Raum → Sprecherzone" ziehen; Zone 1 ist die zuerst gezogene. Befehl: <code>zone 1 on</code> / <code>zone 1 off</code>.</p>
              <div className="row">
                {s.zones.speakerZones.map((z, i) => (
                  <span key={i} className="row" style={{ gap: 4 }}>
                    <button className="btn" aria-pressed={e.activeZones.has(i + 1)} onClick={() => e.exec(`zone ${i + 1} ${e.activeZones.has(i + 1) ? 'off' : 'on'}`)}>{z.name}</button>
                    <button className="btn icon ghost" aria-label={`${z.name} löschen`} onClick={() => e.update((st) => { st.zones.speakerZones.splice(i, 1); })}><X size={16} /></button>
                  </span>
                ))}
              </div>
            </>
          )}
        </Card>
        <PtzCard />
      </div>
    </div>
  );
}
