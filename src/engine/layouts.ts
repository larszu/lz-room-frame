// Tile layouts. Auto layouts follow the number of people; custom layouts are drawn by the
// user and can be assigned to a person count. All rects are normalized to the output.

import type { Layout, LayoutStyle, Tile } from './types';

export const STYLE_LABEL: Record<LayoutStyle, string> = {
  grid: 'Raster',
  center: 'Raster mit Mittelbild',
  speaker: 'Sprecher groß + Leiste',
  strip: 'Übersicht + Leiste',
};

/** Columns × rows of an equal grid per person count. */
export function gridShape(n: number): [number, number] {
  if (n <= 1) return [1, 1];
  if (n === 2) return [2, 1];
  if (n === 3) return [3, 1];
  if (n === 4) return [2, 2];
  if (n <= 6) return [3, 2];
  if (n <= 8) return [4, 2];
  if (n === 9) return [3, 3];
  if (n <= 12) return [4, 3];
  if (n <= 16) return [4, 4];
  return [5, Math.ceil(n / 5)];
}

/** Equal grid; a short last row is centred. */
export function gridTiles(n: number, area = { x: 0, y: 0, w: 1, h: 1 }, role: Tile['role'] = 'person'): Tile[] {
  const [c, r] = gridShape(n);
  const w = area.w / c, h = area.h / r;
  const out: Tile[] = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / c), inRow = row === r - 1 ? n - row * c : c;
    const col = i - row * c;
    const off = ((c - inRow) * w) / 2;
    out.push({ x: area.x + off + col * w, y: area.y + row * h, w, h, role });
  }
  return out;
}

/**
 * Overview in the middle, people around it (like the "7 tiles with center view" of
 * meeting-room cameras): a k × k grid, top row and right column hold people, the rest is
 * the overview. Up to 3 people go into a column beside the overview.
 */
function centerTiles(n: number): Tile[] {
  if (n <= 0) return [{ x: 0, y: 0, w: 1, h: 1, role: 'overview' }];
  if (n <= 3) {
    const side = 1 / 3, ph = 1 / Math.max(n, 2);
    const tiles: Tile[] = [{ x: 0, y: 0, w: 1 - side, h: 1, role: 'overview' }];
    for (let i = 0; i < n; i++) tiles.push({ x: 1 - side, y: i * ph + (1 - n * ph) / 2, w: side, h: ph, role: 'person' });
    return tiles;
  }
  const k = n <= 7 ? 4 : n <= 9 ? 5 : 6;
  if (2 * k - 1 < n) return gridTiles(n);
  const s = 1 / k;
  const tiles: Tile[] = [{ x: 0, y: s, w: (k - 1) * s, h: (k - 1) * s, role: 'overview' }];
  const cells: [number, number][] = [];
  for (let i = 0; i < k; i++) cells.push([i, 0]);
  for (let j = 1; j < k; j++) cells.push([k - 1, j]);
  for (let i = 0; i < n; i++) tiles.push({ x: cells[i][0] * s, y: cells[i][1] * s, w: s, h: s, role: 'person' });
  return tiles;
}

function speakerTiles(n: number): Tile[] {
  if (n <= 1) return [{ x: 0, y: 0, w: 1, h: 1, role: 'speaker' }];
  const others = Math.min(n - 1, 6);
  const sh = 0.25, w = 1 / Math.max(others, 4);
  const tiles: Tile[] = [{ x: 0, y: 0, w: 1, h: 1 - sh, role: 'speaker' }];
  const off = (1 - others * w) / 2;
  for (let i = 0; i < others; i++) tiles.push({ x: off + i * w, y: 1 - sh, w, h: sh, role: 'person' });
  return tiles;
}

function stripTiles(n: number): Tile[] {
  if (n <= 0) return [{ x: 0, y: 0, w: 1, h: 1, role: 'overview' }];
  const count = Math.min(n, 8);
  const sh = count <= 4 ? 0.3 : 0.22, w = 1 / Math.max(count, 3);
  const tiles: Tile[] = [{ x: 0, y: 0, w: 1, h: 1 - sh, role: 'overview' }];
  const off = (1 - count * w) / 2;
  for (let i = 0; i < count; i++) tiles.push({ x: off + i * w, y: 1 - sh, w, h: sh, role: 'person' });
  return tiles;
}

/** Auto layout for `n` people in the given style. 0 people → overview. */
export function autoLayout(n: number, style: LayoutStyle): Layout {
  let tiles: Tile[];
  if (n <= 0) tiles = [{ x: 0, y: 0, w: 1, h: 1, role: 'overview' }];
  else if (style === 'center') tiles = centerTiles(n);
  else if (style === 'speaker') tiles = speakerTiles(n);
  else if (style === 'strip') tiles = stripTiles(n);
  else tiles = gridTiles(n);
  return { id: `auto-${style}-${n}`, name: `${STYLE_LABEL[style]} · ${n}`, tiles };
}

/** Person tiles a layout offers (speaker tiles count as one). */
export const personSlots = (l: Layout) => l.tiles.filter((t) => t.role === 'person').length;

/** Templates to start a custom layout from. */
export const LAYOUT_TEMPLATES: Layout[] = [
  { id: 'tpl-2x2', name: '2 × 2', tiles: gridTiles(4) },
  { id: 'tpl-3x3', name: '3 × 3', tiles: gridTiles(9) },
  { id: 'tpl-center7', name: '7 + Mittelbild', tiles: centerTiles(7) },
  { id: 'tpl-pip', name: 'Bild im Bild', tiles: [{ x: 0, y: 0, w: 1, h: 1, role: 'speaker' }, { x: 0.72, y: 0.04, w: 0.24, h: 0.24, role: 'overview' }] },
  { id: 'tpl-side', name: 'Übersicht + Spalte', tiles: centerTiles(3) },
  { id: 'tpl-group-pip', name: 'Gruppe + Nah als PiP', tiles: [{ x: 0, y: 0, w: 1, h: 1, role: 'group' }, { x: 0.66, y: 0.62, w: 0.3, h: 0.3, role: 'main' }] },
  { id: 'tpl-main-pip', name: 'Nah + Gruppe als PiP', tiles: [{ x: 0, y: 0, w: 1, h: 1, role: 'main' }, { x: 0.66, y: 0.62, w: 0.3, h: 0.3, role: 'group' }] },
  { id: 'tpl-vertical', name: 'Hochformat: Nah über Gruppe', tiles: [{ x: 0, y: 0, w: 1, h: 0.6, role: 'main' }, { x: 0, y: 0.6, w: 1, h: 0.4, role: 'group' }] },
];

/** Snap a value to a grid of `steps` per unit. */
export const snap = (v: number, steps: number) => Math.round(v * steps) / steps;

export function cloneLayout(l: Layout, id: string, name: string): Layout {
  return { id, name, tiles: l.tiles.map((t) => ({ ...t })) };
}
