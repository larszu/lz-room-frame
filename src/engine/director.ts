// The director decides what each tile shows: picks the layout for the mode and person count,
// gives people their tiles in a stable order, chooses the active speaker with hysteresis and
// falls back to the group shot where meeting-room cameras do (too many people, no speaker).

import { autoLayout, personSlots } from './layouts';
import { fullFrame, groupCrop, personCrop, VirtualCamera, type FrameSize } from './framing';
import { stableOrder } from './tracker';
import type { Framing, Layout, Person, Rect, Tile } from './types';

export interface TileView {
  tile: Tile;
  /** output pixels */
  px: Rect;
  cam: VirtualCamera;
  subject: string;
  personId: number | null;
  highlight: boolean;
  label: string;
}

export interface DirectorInput {
  persons: Person[];
  framing: Framing;
  src: FrameSize;
  out: FrameSize;
  /** custom layouts per person count */
  layoutFor: (n: number) => Layout | null;
  /** resolves a fixed layout id of the framing */
  layoutById?: (id: string) => Layout | null;
  now: number;
  /** a speaker set from outside (control API), wins over detection */
  forcedSpeaker: number | null;
  /** presenter mode: the person to follow, if one was picked */
  presenterId: number | null;
}

export class Director {
  cams: VirtualCamera[] = [];
  order: number[] = [];
  speakerId: number | null = null;
  private speakerSince = 0;
  private lastSpeech = 0;
  private candidate: { id: number; since: number } | null = null;
  layout: Layout = autoLayout(0, 'grid');
  /** frozen: keep the current shots (control API "freeze on") */
  frozen = false;

  private chooseSpeaker(ps: Person[], now: number, forced: number | null) {
    if (forced !== null && ps.some((p) => p.id === forced)) { this.speakerId = forced; this.lastSpeech = now; return; }
    const loud = ps.filter((p) => p.speaking > 0.5).sort((a, b) => b.speaking - a.speaking)[0];
    if (loud) {
      this.lastSpeech = now;
      if (loud.id === this.speakerId) { this.candidate = null; return; }
      // a new speaker has to talk for 0.6 s, and the current one keeps the shot for at least 2 s
      if (!this.candidate || this.candidate.id !== loud.id) this.candidate = { id: loud.id, since: now };
      if (now - this.candidate.since > 600 && now - this.speakerSince > 2000) {
        this.speakerId = loud.id; this.speakerSince = now; this.candidate = null;
      }
    }
    if (this.speakerId !== null && !ps.some((p) => p.id === this.speakerId)) this.speakerId = null;
  }

  update(inp: DirectorInput): TileView[] {
    const { framing: f, src, out, now } = inp;
    this.order = stableOrder(this.order, inp.persons);
    const byId = new Map(inp.persons.map((p) => [p.id, p]));
    const ordered = this.order.map((id) => byId.get(id)!).filter(Boolean);
    this.chooseSpeaker(ordered, now, inp.forcedSpeaker);
    const speakerLost = now - this.lastSpeech > f.speakerFallback * 1000;
    const speaker = this.speakerId !== null && !speakerLost ? byId.get(this.speakerId) ?? null : null;

    if (!this.frozen) this.layout = this.pickLayout(inp, ordered, speaker);
    const views: TileView[] = [];
    let slot = 0;
    const speakerInLayout = this.layout.tiles.some((t) => t.role === 'speaker');
    const people = speakerInLayout && speaker ? ordered.filter((p) => p.id !== speaker.id) : ordered;
    this.layout.tiles.forEach((tile, i) => {
      const px = { x: tile.x * out.W, y: tile.y * out.H, w: tile.w * out.W, h: tile.h * out.H };
      const aspect = px.w / px.h;
      const tilePx = { w: px.w, h: px.h };
      const cam = (this.cams[i] ??= new VirtualCamera());
      let subject = 'overview', target: Rect, personId: number | null = null, label = '';
      if (tile.role === 'person') {
        const p = people[slot++];
        if (p) { subject = `p${p.id}`; personId = p.id; target = personCrop(p, f, aspect, src, tilePx); label = p.label ?? `Person ${this.order.indexOf(p.id) + 1}`; }
        else target = groupCrop(ordered, f, aspect, src, tilePx);
      } else if (tile.role === 'speaker') {
        if (speaker) { subject = `p${speaker.id}`; personId = speaker.id; target = personCrop(speaker, f, aspect, src, tilePx); label = speaker.label ?? ''; }
        else { subject = 'group'; target = ordered.length ? groupCrop(ordered, f, aspect, src, tilePx) : fullFrame(aspect, src); }
      } else if (tile.role === 'main') {
        const p = speaker ?? (inp.presenterId !== null ? byId.get(inp.presenterId) : undefined) ?? [...ordered].sort((a, b) => b.head.h - a.head.h)[0];
        if (p) { subject = `p${p.id}`; personId = p.id; target = personCrop(p, f, aspect, src, tilePx); label = p.label ?? ''; }
        else target = fullFrame(aspect, src);
      } else if (tile.role === 'group') {
        subject = 'group'; target = ordered.length ? groupCrop(ordered, f, aspect, src, tilePx) : fullFrame(aspect, src);
      } else target = fullFrame(aspect, src);
      if (inp.framing.mode === 'presenter' && tile.role === 'speaker') {
        const p = (inp.presenterId !== null && byId.get(inp.presenterId)) || [...ordered].sort((a, b) => b.head.h - a.head.h)[0];
        if (p) { subject = `p${p.id}`; personId = p.id; target = personCrop(p, f, aspect, src, tilePx); label = p.label ?? ''; }
      }
      if (!this.frozen) cam.aim(target!, subject, f.deadband, f.transition);
      views.push({ tile, px, cam, subject, personId, highlight: f.highlightSpeaker && personId !== null && personId === speaker?.id && this.layout.tiles.length > 1, label });
    });
    this.cams.length = this.layout.tiles.length;
    return views;
  }

  private pickLayout(inp: DirectorInput, ordered: Person[], speaker: Person | null): Layout {
    const f = inp.framing, n = ordered.length;
    const single = (role: Tile['role']): Layout => ({ id: `single-${role}`, name: role, tiles: [{ x: 0, y: 0, w: 1, h: 1, role }] });
    const fixed = f.layout && inp.layoutById?.(f.layout);
    if (fixed && f.mode !== 'overview') return fixed;
    switch (f.mode) {
      case 'overview': return single('overview');
      case 'group': return n ? single('group') : single('overview');
      case 'speaker': return speaker || n ? single('speaker') : single('overview');
      case 'presenter': return n ? single('speaker') : single('overview');
      case 'people': {
        if (n === 0) return single('overview');
        if (n > f.maxPeople) return single('group');
        const custom = inp.layoutFor(n);
        if (custom) return custom;
        const l = autoLayout(n, f.style);
        // speaker style without a speaker yet: plain grid
        if (f.style === 'speaker' && !speaker) return autoLayout(n, 'grid');
        return personSlots(l) || l.tiles.length ? l : single('group');
      }
    }
  }
}
