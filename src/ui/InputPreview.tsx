// The camera picture with what the engine sees: people (head, number, speaking), the crops
// of the tiles, the room boundary and the zones. In edit mode rectangles are drawn by drag.
import { useEffect, useRef } from 'react';
import { engine } from '../engine/engine';
import { cx } from '../engine/geometry';
import type { Rect } from '../engine/types';

export type DrawMode = null | 'boundary' | 'exclusion' | 'speaker';

export function InputPreview({ draw, onRect, outlines = true }: { draw?: DrawMode; onRect?: (r: Rect) => void; outlines?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  useEffect(() => {
    let raf = 0;
    const paint = () => {
      raf = requestAnimationFrame(paint);
      const c = ref.current; if (!c) return;
      const el = engine.sourceElement, { width: W, height: H } = engine.source;
      const cw = c.clientWidth * devicePixelRatio;
      const ch = W && H ? Math.round(cw * (H / W)) : Math.round(cw * 9 / 16);
      if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
      const g = c.getContext('2d')!;
      g.fillStyle = '#111'; g.fillRect(0, 0, cw, ch);
      if (!el || !W || !H) return;
      const k = cw / W, mirror = engine.settings.input.mirror;
      if (mirror) { g.save(); g.translate(cw, 0); g.scale(-1, 1); g.drawImage(el, 0, 0, cw, ch); g.restore(); } else g.drawImage(el, 0, 0, cw, ch);
      const z = engine.settings.zones, lw = Math.max(1.5, devicePixelRatio * 1.5);
      const nr = (r: Rect) => [r.x * cw, r.y * ch, r.w * cw, r.h * ch] as const;
      // outside the boundary: dimmed
      const b = z.boundary;
      if (b.w < 1 || b.h < 1) {
        g.fillStyle = 'rgba(0,0,0,.55)';
        g.beginPath(); g.rect(0, 0, cw, ch); g.rect(...nr(b)); g.fill('evenodd');
        g.strokeStyle = '#B9C7D8'; g.lineWidth = lw; g.setLineDash([8, 6]); g.strokeRect(...nr(b)); g.setLineDash([]);
      }
      g.fillStyle = 'rgba(214,64,46,.28)'; g.strokeStyle = '#D6402E'; g.lineWidth = lw;
      for (const e of z.exclusions) { g.fillRect(...nr(e)); g.strokeRect(...nr(e)); }
      z.speakerZones.forEach((s, i) => {
        const on = engine.activeZones.has(i + 1);
        g.fillStyle = on ? 'rgba(79,195,247,.22)' : 'rgba(79,195,247,.08)';
        g.fillRect(s.x0 * cw, 0, (s.x1 - s.x0) * cw, ch);
        g.fillStyle = '#4FC3F7'; g.font = `600 ${12 * devicePixelRatio}px system-ui`; g.fillText(s.name || `Zone ${i + 1}`, s.x0 * cw + 6, 16 * devicePixelRatio);
      });
      if (outlines) {
        for (const v of engine.views) {
          const r = v.cam.cur; if (!r || v.tile.role === 'overview') continue;
          g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1 * devicePixelRatio;
          g.strokeRect(r.x * k, r.y * k, r.w * k, r.h * k);
        }
      }
      const order = engine.director.order;
      for (const p of engine.persons) {
        const n = order.indexOf(p.id) + 1;
        const sp = p.speaking > 0.5 || p.id === engine.director.speakerId;
        g.strokeStyle = sp ? '#4FC3F7' : p.faceSeen ? '#7CD992' : '#E6B85C'; g.lineWidth = lw * (sp ? 2 : 1);
        g.strokeRect(p.head.x * k, p.head.y * k, p.head.w * k, p.head.h * k);
        const fs = 13 * devicePixelRatio;
        g.font = `700 ${fs}px system-ui`;
        const label = p.label ? `${n} ${p.label}` : String(n);
        const tw = g.measureText(label).width + fs * 0.8;
        g.fillStyle = 'rgba(0,0,0,.65)'; g.beginPath(); g.roundRect(cx(p.head) * k - tw / 2, p.head.y * k - fs * 1.7, tw, fs * 1.4, fs * 0.4); g.fill();
        g.fillStyle = '#fff'; g.textAlign = 'center'; g.fillText(label, cx(p.head) * k, p.head.y * k - fs * 0.6); g.textAlign = 'left';
      }
      const d = drag.current;
      if (d) {
        g.strokeStyle = '#D6402E'; g.lineWidth = lw * 1.5; g.setLineDash([6, 4]);
        g.strokeRect(Math.min(d.x0, d.x1) * cw, Math.min(d.y0, d.y1) * ch, Math.abs(d.x1 - d.x0) * cw, Math.abs(d.y1 - d.y0) * ch); g.setLineDash([]);
      }
    };
    paint();
    return () => cancelAnimationFrame(raf);
  }, [outlines]);

  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };

  return (
    <canvas
      ref={ref}
      style={{ inlineSize: '100%', display: 'block', borderRadius: 'var(--radius-m)', cursor: draw ? 'crosshair' : 'default', touchAction: draw ? 'none' : 'auto' }}
      aria-label="Kamerabild mit erkannten Personen"
      onPointerDown={(e) => { if (!draw) return; const p = pos(e); drag.current = { x0: p.x, y0: p.y, x1: p.x, y1: p.y }; (e.target as Element).setPointerCapture(e.pointerId); }}
      onPointerMove={(e) => { if (!drag.current) return; const p = pos(e); drag.current.x1 = p.x; drag.current.y1 = p.y; }}
      onPointerUp={() => {
        const d = drag.current; drag.current = null;
        if (!d || !onRect) return;
        const r = { x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1), w: Math.abs(d.x1 - d.x0), h: Math.abs(d.y1 - d.y0) };
        if (r.w > 0.02 && r.h > 0.02) onRect(r);
      }}
    />
  );
}

export function OutputPreview() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current!;
    engine.canvas.setAttribute('aria-label', 'Ausgabebild');
    host.appendChild(engine.canvas);
    return () => { engine.canvas.remove(); };
  }, []);
  return <div ref={ref} />;
}
