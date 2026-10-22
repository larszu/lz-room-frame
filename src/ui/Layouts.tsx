import { Copy, Plus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { autoLayout, cloneLayout, LAYOUT_TEMPLATES, snap, STYLE_LABEL } from '../engine/layouts';
import type { Layout, LayoutStyle, Tile, TileRole } from '../engine/types';
import { Card, Field, Seg } from './controls';
import { useEngine } from './useEngine';

const ROLE: Record<TileRole, string> = { person: 'Person', main: 'Hauptperson', speaker: 'Sprecher', overview: 'Übersicht', group: 'Gruppe' };

export function LayoutThumb({ l, pressed, onClick, caption }: { l: Layout; pressed?: boolean; onClick?: () => void; caption: string }) {
  return (
    <button className="thumb" aria-pressed={pressed} onClick={onClick} type="button">
      <span className="lay">{l.tiles.map((t, i) => <i key={i} className={t.role} style={{ left: `${t.x * 100}%`, top: `${t.y * 100}%`, width: `${t.w * 100}%`, height: `${t.h * 100}%` }} />)}</span>
      {caption}
    </button>
  );
}

function Editor({ layout, onChange, aspect }: { layout: Layout; onChange: (l: Layout) => void; aspect: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState(0);
  const op = useRef<{ i: number; kind: 'move' | 'size'; px: number; py: number; t: Tile } | null>(null);
  const steps = 12;
  const tile = layout.tiles[sel];

  const move = (ev: React.PointerEvent) => {
    const o = op.current; if (!o) return;
    const r = ref.current!.getBoundingClientRect();
    const dx = (ev.clientX - o.px) / r.width, dy = (ev.clientY - o.py) / r.height;
    const tiles = layout.tiles.map((t) => ({ ...t }));
    const t = tiles[o.i];
    if (o.kind === 'move') {
      t.x = Math.min(1 - t.w, Math.max(0, snap(o.t.x + dx, steps)));
      t.y = Math.min(1 - t.h, Math.max(0, snap(o.t.y + dy, steps)));
    } else {
      t.w = Math.min(1 - t.x, Math.max(1 / steps, snap(o.t.w + dx, steps)));
      t.h = Math.min(1 - t.y, Math.max(1 / steps, snap(o.t.h + dy, steps)));
    }
    onChange({ ...layout, tiles });
  };

  return (
    <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
      <div ref={ref} className="editor" style={{ aspectRatio: String(aspect), backgroundSize: `${100 / steps}% ${100 / steps}%` }}
        onPointerMove={move} onPointerUp={() => { op.current = null; }} onPointerCancel={() => { op.current = null; }}>
        {layout.tiles.map((t, i) => (
          <div key={i} className={`t${i === sel ? ' sel' : ''}`}
            style={{ left: `${t.x * 100}%`, top: `${t.y * 100}%`, width: `${t.w * 100}%`, height: `${t.h * 100}%`,
              background: t.role === 'overview' ? 'color-mix(in oklab, var(--stahlblau) 55%, var(--surface-2))' : t.role === 'group' ? 'color-mix(in oklab, #C8892B 45%, var(--surface-2))' : 'color-mix(in oklab, var(--accent) 35%, var(--surface-2))' }}
            onPointerDown={(ev) => { setSel(i); ref.current!.setPointerCapture(ev.pointerId); op.current = { i, kind: 'move', px: ev.clientX, py: ev.clientY, t: { ...t } }; }}>
            {ROLE[t.role]}{t.role === 'person' ? ` ${layout.tiles.slice(0, i + 1).filter((x) => x.role === 'person').length}` : ''}
            <span className="h" onPointerDown={(ev) => { ev.stopPropagation(); setSel(i); ref.current!.setPointerCapture(ev.pointerId); op.current = { i, kind: 'size', px: ev.clientX, py: ev.clientY, t: { ...t } }; }} />
          </div>
        ))}
      </div>
      <div className="row">
        {tile && <Seg label="Inhalt der Kachel" value={tile.role} onChange={(role) => onChange({ ...layout, tiles: layout.tiles.map((t, i) => (i === sel ? { ...t, role } : t)) })}
          options={(Object.keys(ROLE) as TileRole[]).map((r) => ({ value: r, label: ROLE[r] }))} />}
        <button className="btn" onClick={() => { onChange({ ...layout, tiles: [...layout.tiles, { x: 0, y: 0, w: 0.25, h: 0.25, role: 'person' }] }); setSel(layout.tiles.length); }}><Plus size={16} />Kachel</button>
        {tile && <button className="btn ghost" onClick={() => { onChange({ ...layout, tiles: layout.tiles.filter((_, i) => i !== sel) }); setSel(0); }}><Trash2 size={16} />Kachel entfernen</button>}
      </div>
      <p className="muted" style={{ margin: 0 }}>Kacheln ziehen zum Verschieben, Ecke unten rechts zum Vergrößern. Raster: 12 × 12. Personen füllen die Personen-Kacheln von links nach rechts.</p>
    </div>
  );
}

export function Layouts() {
  const e = useEngine();
  const s = e.settings;
  const [style, setStyle] = useState<LayoutStyle>(s.framing.style);
  const [editId, setEditId] = useState<string | null>(s.layouts[0]?.id ?? null);
  const edit = s.layouts.find((l) => l.id === editId) ?? null;
  const aspect = s.output.width / s.output.height;

  const add = (from: Layout) => {
    const id = `l${Date.now().toString(36)}`;
    e.update((st) => { st.layouts.push(cloneLayout(from, id, `Eigenes Layout ${st.layouts.length + 1}`)); });
    setEditId(id);
  };
  const save = (l: Layout) => e.update((st) => { st.layouts = st.layouts.map((x) => (x.id === l.id ? l : x)); });

  return (
    <div className="view">
      <h1>Layouts</h1>
      <p className="lead">Das Raster ergibt sich aus der Zahl der Personen. Für einzelne Personenzahlen lässt sich ein eigenes Layout festlegen.</p>
      <Card title="Automatische Raster" action={
        <button className="btn primary" disabled={s.framing.style === style && s.framing.mode === 'people'} onClick={() => e.setFraming({ style, mode: 'people' })}>Dieses Raster verwenden</button>
      }>
        <Seg label="Rasterart" value={style} onChange={setStyle} options={(Object.keys(STYLE_LABEL) as LayoutStyle[]).map((k) => ({ value: k, label: STYLE_LABEL[k] }))} />
        <div className="thumbs">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <LayoutThumb key={n} l={autoLayout(n, style)} caption={`${n} ${n === 1 ? 'Person' : 'Personen'}`} />)}
        </div>
      </Card>
      <div className="cols">
        <Card title="Eigene Layouts">
          <div className="row"><span className="muted">Neu aus Vorlage:</span>{LAYOUT_TEMPLATES.map((t) => <button key={t.id} className="btn" onClick={() => add(t)}><Plus size={16} />{t.name}</button>)}</div>
          {!s.layouts.length && <p className="muted" style={{ margin: 0 }}>Noch keine eigenen Layouts. Eine Vorlage wählen und anpassen.</p>}
          <div className="thumbs">
            {s.layouts.map((l) => <LayoutThumb key={l.id} l={l} caption={l.name} pressed={l.id === editId} onClick={() => setEditId(l.id)} />)}
          </div>
          {edit && (
            <>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <input type="text" value={edit.name} aria-label="Name des Layouts" onChange={(ev) => save({ ...edit, name: ev.target.value })} />
                <button className="btn icon" title="Duplizieren" aria-label="Duplizieren" onClick={() => add(edit)}><Copy size={18} /></button>
                <button className="btn icon" title="Löschen" aria-label="Layout löschen" onClick={() => {
                  e.update((st) => { st.layouts = st.layouts.filter((x) => x.id !== edit.id); for (const k of Object.keys(st.layoutByCount)) if (st.layoutByCount[k] === edit.id) delete st.layoutByCount[k]; });
                  setEditId(null);
                }}><Trash2 size={18} /></button>
              </div>
              <Editor layout={edit} onChange={save} aspect={aspect} />
            </>
          )}
        </Card>
        <Card title="Layout je Personenzahl">
          <p className="muted" style={{ margin: 0 }}>Gilt im Modus Kacheln. „Automatisch" nimmt das gewählte Raster.</p>
          <div className="cols" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 'var(--space-2)' }}>
            {Array.from({ length: 12 }, (_, i) => String(i + 1)).map((n) => (
              <Field key={n} label={`${n} ${n === '1' ? 'Person' : 'Personen'}`}>
                <select value={s.layoutByCount[n] ?? ''} onChange={(ev) => e.update((st) => { if (ev.target.value) st.layoutByCount[n] = ev.target.value; else delete st.layoutByCount[n]; })}>
                  <option value="">Automatisch</option>
                  {s.layouts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </Field>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
