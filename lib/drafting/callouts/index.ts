// ============================================================
// SolarPro Drafting Engine — Callout System
// lib/drafting/callouts/index.ts
//
// Numbered callout bubbles, leader lines, and detail tags.
// All geometry is precise — tied to real drawing coordinates.
// ============================================================

import type { CalloutOptions, LeaderOptions } from '../types';
import { drawText } from '../primitives';

// ── Constants ─────────────────────────────────────────────────
const BUBBLE_STROKE     = '#000';
const BUBBLE_FILL       = '#fff';
const BUBBLE_SW         = 1.5;
const LEADER_COLOR      = '#000';
const LEADER_SW         = 0.8;
const DEFAULT_R         = 10;
const DETAIL_TAG_STROKE = '#000';

// ── drawCallout ───────────────────────────────────────────────
// Numbered circle callout bubble.
// Place cx,cy AT the callout target (the geometry point being labeled).
// The bubble is drawn centered at cx,cy.

export function drawCallout(opts: CalloutOptions): string {
  const { cx, cy, number, r = DEFAULT_R } = opts;
  const els: string[] = [];

  // Bubble circle
  els.push(
    '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) +
    '" r="' + r + '" fill="' + BUBBLE_FILL +
    '" stroke="' + BUBBLE_STROKE + '" stroke-width="' + BUBBLE_SW + '"/>'
  );

  // Number centered in bubble
  els.push(drawText(cx, cy + 3.5, String(number), {
    anchor:     'middle',
    fontSize:   r < 9 ? 7 : 9,
    fontWeight: '900',
    fill:       '#000',
  }));

  return els.join('');
}

// ── drawLeaderLine ────────────────────────────────────────────
// Leader line from callout bubble edge to geometry target.
// x1,y1 = bubble edge point (start)
// x2,y2 = geometry target (end — where small dot is placed)

export function drawLeaderLine(opts: LeaderOptions): string {
  const { x1, y1, x2, y2 } = opts;
  const els: string[] = [];

  // Leader line
  els.push(
    '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) +
    '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) +
    '" stroke="' + LEADER_COLOR + '" stroke-width="' + LEADER_SW + '"/>'
  );

  // Small dot at geometry target
  els.push(
    '<circle cx="' + x2.toFixed(1) + '" cy="' + y2.toFixed(1) +
    '" r="2" fill="' + LEADER_COLOR + '"/>'
  );

  return els.join('');
}

// ── drawCalloutWithLeader ─────────────────────────────────────
// Combined: bubble at (bx,by) with leader pointing to (tx,ty).
// The leader connects from bubble edge toward the target.

export function drawCalloutWithLeader(
  bx: number, by: number,        // bubble center
  tx: number, ty: number,        // target geometry point
  number: number,
  r: number = DEFAULT_R
): string {
  const els: string[] = [];

  // Compute edge point on bubble toward target
  const dx = tx - bx;
  const dy = ty - by;
  const dist = Math.sqrt(dx * dx + dy * dy);
  let edgeX = bx, edgeY = by;
  if (dist > 0.1) {
    edgeX = bx + (r + 1) * (dx / dist);
    edgeY = by + (r + 1) * (dy / dist);
  }

  // Leader line first (behind bubble)
  if (dist > r + 2) {
    els.push(drawLeaderLine({ x1: edgeX, y1: edgeY, x2: tx, y2: ty }));
  }

  // Bubble on top
  els.push(drawCallout({ cx: bx, cy: by, number, r }));

  return els.join('');
}

// ── drawCalloutGroup ──────────────────────────────────────────
// Draws a row of callout bubbles at fixed Y, evenly spaced.
// Used for quick labeling across the top of a drawing.
// Returns array of {x,y} positions for use in leader placement.

export function drawCalloutGroup(
  startX: number,
  y: number,
  spacing: number,
  count: number,
  r: number = DEFAULT_R
): { svg: string; positions: Array<{ x: number; y: number }> } {
  const els: string[] = [];
  const positions: Array<{ x: number; y: number }> = [];

  for (let i = 0; i < count; i++) {
    const cx = startX + i * spacing;
    const cy = y;
    positions.push({ x: cx, y: cy });
    els.push(drawCallout({ cx, cy, number: i + 1, r }));
  }

  return { svg: els.join(''), positions };
}

// ── drawDetailTag ─────────────────────────────────────────────
// Engineering detail reference tag (circle with slash line).
// top text = detail number, bottom text = sheet reference.

export function drawDetailTag(
  cx: number, cy: number,
  detailNum: string,
  sheetRef: string,
  r: number = 14
): string {
  const els: string[] = [];

  // Outer circle
  els.push(
    '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) +
    '" r="' + r + '" fill="#fff" stroke="' + DETAIL_TAG_STROKE + '" stroke-width="1.2"/>'
  );

  // Horizontal divider
  els.push(
    '<line x1="' + (cx - r).toFixed(1) + '" y1="' + cy.toFixed(1) +
    '" x2="' + (cx + r).toFixed(1) + '" y2="' + cy.toFixed(1) +
    '" stroke="' + DETAIL_TAG_STROKE + '" stroke-width="0.8"/>'
  );

  // Top: detail number
  els.push(drawText(cx, cy - 2, detailNum, {
    anchor: 'middle', fontSize: 8, fontWeight: '900', fill: '#000'
  }));

  // Bottom: sheet reference
  els.push(drawText(cx, cy + 10, sheetRef, {
    anchor: 'middle', fontSize: 7, fill: '#555'
  }));

  return els.join('');
}

// ── drawSectionCutLine ────────────────────────────────────────
// Section cut line with arrows and label (e.g. "A-A").
// x1,y1 to x2,y2 defines the cut line.

export function drawSectionCutLine(
  x1: number, y1: number,
  x2: number, y2: number,
  label: string
): string {
  const els: string[] = [];
  const DIM_COLOR = '#000';

  // Cut line (heavy chain line)
  els.push(
    '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) +
    '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) +
    '" stroke="' + DIM_COLOR + '" stroke-width="1.5" stroke-dasharray="12,4,2,4"/>'
  );

  // Arrows at each end (perpendicular to cut direction)
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len > 0) {
    const nx = -dy / len, ny = dx / len;  // normal direction
    // Arrow at start
    els.push(arrowAt(x1, y1, nx, ny, 8));
    // Arrow at end
    els.push(arrowAt(x2, y2, nx, ny, 8));
  }

  // Label circle at start
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  els.push(
    '<circle cx="' + midX.toFixed(1) + '" cy="' + (midY - 16).toFixed(1) +
    '" r="10" fill="#fff" stroke="#000" stroke-width="1"/>'
  );
  els.push(drawText(midX, midY - 12, label, {
    anchor: 'middle', fontSize: 8, fontWeight: '900', fill: '#000'
  }));

  return els.join('');
}

// ── drawRevisionCloud ─────────────────────────────────────────
// Simple revision cloud (arc bumps around a rectangle).

export function drawRevisionCloud(
  x: number, y: number,
  w: number, h: number,
  tag: string
): string {
  const els: string[] = [];
  const r = 8;
  const path: string[] = [];

  // Top edge arcs (left to right)
  for (let i = x; i < x + w - r; i += r * 2) {
    path.push('M ' + i + ',' + y);
    path.push('A ' + r + ',' + r + ' 0 0 1 ' + Math.min(i + r * 2, x + w) + ',' + y);
  }
  // Right edge arcs
  for (let j = y; j < y + h - r; j += r * 2) {
    path.push('M ' + (x + w) + ',' + j);
    path.push('A ' + r + ',' + r + ' 0 0 1 ' + (x + w) + ',' + Math.min(j + r * 2, y + h));
  }

  els.push('<path d="' + path.join(' ') + '" stroke="#cc0000" stroke-width="1.2" fill="none" stroke-dasharray="3,2"/>');
  els.push(drawText(x + 4, y - 4, tag, {
    anchor: 'start', fontSize: 7, fill: '#cc0000', fontWeight: 'bold'
  }));

  return els.join('');
}

// ── drawWindArrow ─────────────────────────────────────────────
// Wind pressure arrow — thick red with label.
// direction: 'left'|'right'|'up'|'down'
// Drawn at (x,y), arrow tip points in direction.

export function drawWindArrow(
  x: number, y: number,
  length: number,
  direction: 'left' | 'right' | 'up' | 'down',
  label?: string
): string {
  const els: string[] = [];
  let x2 = x, y2 = y;
  let textX = x, textY = y;
  let textAnchor: 'start' | 'middle' | 'end' = 'start';

  switch (direction) {
    case 'right':
      x2 = x + length; textX = x - 4; textY = y - 4; textAnchor = 'end'; break;
    case 'left':
      x2 = x - length; textX = x + 4; textY = y - 4; textAnchor = 'start'; break;
    case 'down':
      y2 = y + length; textX = x + 4; textY = y - 4; break;
    case 'up':
      y2 = y - length; textX = x + 4; textY = y + length + 10; break;
  }

  // Arrow shaft
  els.push(
    '<line x1="' + x.toFixed(1) + '" y1="' + y.toFixed(1) +
    '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) +
    '" stroke="#cc0000" stroke-width="2.5" class="line-wind"/>'
  );

  // Arrowhead at tip (x2,y2)
  const angleDeg = direction === 'right' ? 0 :
    direction === 'left' ? 180 :
    direction === 'down' ? 90 : 270;
  els.push(arrowFilled(x2, y2, angleDeg, 7, '#cc0000'));

  // Label
  if (label) {
    els.push(drawText(textX, textY, label, {
      anchor: textAnchor, fontSize: 7, fontWeight: 'bold', fill: '#cc0000'
    }));
  }

  return els.join('');
}

// ── Internal helpers ──────────────────────────────────────────

function arrowAt(x: number, y: number, nx: number, ny: number, size: number): string {
  const pts =
    (x + nx * size).toFixed(1) + ',' + (y + ny * size).toFixed(1) + ' ' +
    (x - nx * size * 0.4 + ny * size * 0.4).toFixed(1) + ',' +
    (y - ny * size * 0.4 - nx * size * 0.4).toFixed(1) + ' ' +
    (x - nx * size * 0.4 - ny * size * 0.4).toFixed(1) + ',' +
    (y - ny * size * 0.4 + nx * size * 0.4).toFixed(1);
  return '<polygon points="' + pts + '" fill="#000"/>';
}

function arrowFilled(x: number, y: number, angleDeg: number, size: number, fill: string): string {
  const rad = angleDeg * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const back = size * 2.2;
  const side = size * 0.7;
  const pts =
    x.toFixed(1) + ',' + y.toFixed(1) + ' ' +
    (x - back * cos + side * sin).toFixed(1) + ',' + (y - back * sin - side * cos).toFixed(1) + ' ' +
    (x - back * cos - side * sin).toFixed(1) + ',' + (y - back * sin + side * cos).toFixed(1);
  return '<polygon points="' + pts + '" fill="' + fill + '" stroke="none"/>';
}