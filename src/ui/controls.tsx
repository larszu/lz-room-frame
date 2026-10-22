// Shared UI building blocks – every view uses these instead of its own fields.
import type { ReactNode } from 'react';

export function Seg<T extends string>({ value, options, onChange, label, icons }: {
  value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; label: string; icons?: boolean;
}) {
  return (
    <div className={`seg${icons ? ' icons' : ''}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} title={o.title} aria-label={o.title} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Slider({ label, value, min, max, step, onChange, format, hint }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => string; hint?: string;
}) {
  const id = `s-${label.replace(/\W+/g, '-')}`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}<output>{format ? format(value) : value}</output></label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

export function Toggle({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="switch">
      <span className="txt">{label}{hint && <small>{hint}</small>}</span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <span className="label">{label}</span>
      {children}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

export function Card({ title, children, action }: { title?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="card">
      {title && <h2><span className="grow">{title}</span>{action}</h2>}
      {children}
    </section>
  );
}

export function SinkState({ s }: { s?: { on: boolean; ok: boolean; message: string } }) {
  if (!s || !s.on) return <span className="status">aus</span>;
  return <span className={`status ${s.ok ? 'ok' : 'err'}`}>{s.message || (s.ok ? 'läuft' : 'Fehler')}</span>;
}

export const pct = (v: number) => `${Math.round(v * 100)} %`;
