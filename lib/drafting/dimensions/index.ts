// ============================================================
// SolarPro Drafting Engine — Dimension Engine
// lib/drafting/dimensions/index.ts
//
// Produces fully annotated dimension strings for SVG drawings.
// Supports horizontal and vertical dimensions with:
//   - Extension lines from geometry
//   - Tick marks or arrowheads at each end
//   - Centered label (ft-in format or custom)
// ============================================================

import type { DimensionOptions } from '../types';
import { drawArrowhead, drawText } from '../primitives';

// ── Constants ─────────────────────────────────────────────────
// Black dimension linework — the PE-sealed reference sets draw dims monochrome;
// the old blue read as a UI mockup rather than a CAD sheet (Ray, 2026-07-01).
const DIM_COLOR      = '#000000';
const EXT_OVERSHOOT  = 4;   // px extension lines extend past dim line
const EXT_GAP        = 3;   // px gap between geometry and extension line start
const TICK_HALF      = 5;   // half-length of tick mark
const ARROW_SIZE     = 4;   // arrowhead size

// ── drawDimension ─────────────────────────────────────────────
// Primary dimension function.
// offset > 0 = dimension line drawn outside (above for horiz, left for vert)
// offset < 0 = dimension line drawn inside

export function drawDimension(opts: DimensionOptions): string {
  const els: string[] = [];
  const { x1, y1, x2, y2, offset, label, orientation, style = 'tick' } = opts;

  if (orientation === 'horizontal') {
    // Dim line is horizontal, offset in Y direction
    const dimY = Math.min(y1, y2) - Math.abs(offset);
    const extY1 = Math.min(y1, y2) - EXT_GAP;
    const extY2 = dimY - EXT_OVERSHOOT;

    // Extension line at x1
    els.push(dimLine(x1, extY1, x1, extY2));
    // Extension line at x2
    els.push(dimLine(x2, extY1, x2, extY2));
    // Dimension line
    els.push(dimLine(x1, dimY, x2, dimY));

    if (style === 'arrow') {
      // Arrowheads pointing inward
      els.push(drawArrowhead(x1, dimY, 0, ARROW_SIZE, DIM_COLOR));
      els.push(drawArrowhead(x2, dimY, 180, ARROW_SIZE, DIM_COLOR));
    } else {
      // Tick marks at each end (45° slash)
      els.push(dimTick(x1, dimY, true));
      els.push(dimTick(x2, dimY, true));
    }

    // Label centered on dimension line
    const midX = (x1 + x2) / 2;
    els.push(drawText(midX, dimY - 4, label, {
      anchor: 'middle',
      fontSize: 8,
      fontWeight: 'bold',
      fill: DIM_COLOR,
    }));

  } else {
    // Vertical dimension
    // Dim line is vertical, offset in X direction (negative = left of geometry)
    const dimX = Math.min(x1, x2) - Math.abs(offset);
    const extX1 = Math.min(x1, x2) - EXT_GAP;
    const extX2 = dimX - EXT_OVERSHOOT;

    // Extension lines
    els.push(dimLine(extX1, y1, extX2, y1));
    els.push(dimLine(extX1, y2, extX2, y2));
    // Dimension line
    els.push(dimLine(dimX, y1, dimX, y2));

    if (style === 'arrow') {
      els.push(drawArrowhead(dimX, y1, 90, ARROW_SIZE, DIM_COLOR));
      els.push(drawArrowhead(dimX, y2, 270, ARROW_SIZE, DIM_COLOR));
    } else {
      els.push(dimTick(dimX, y1, false));
      els.push(dimTick(dimX, y2, false));
    }

    // Label: rotated 90° centered on dimension line
    const midY = (y1 + y2) / 2;
    els.push(drawText(dimX - 6, midY, label, {
      anchor: 'middle',
      fontSize: 8,
      fontWeight: 'bold',
      fill: DIM_COLOR,
      rotate: -90,
    }));
  }

  return els.join('');
}

// ── drawLinearDimension ───────────────────────────────────────
// Shorthand for a horizontal dimension above two points.
// Computes label from pixel span × scale.

export function drawLinearDimension(
  x1: number,
  x2: number,
  y: number,           // geometry Y
  offsetUp: number,    // how far above geometry
  label: string
): string {
  return drawDimension({
    x1, y1: y,
    x2, y2: y,
    offset: offsetUp,
    label,
    orientation: 'horizontal',
    style: 'tick',
  });
}

// ── drawVerticalDimension ─────────────────────────────────────
// Shorthand for a vertical dimension to the left of two points.

export function drawVerticalDimension(
  x: number,           // geometry X
  y1: number,
  y2: number,
  offsetLeft: number,  // how far left of geometry
  label: string
): string {
  return drawDimension({
    x1: x, y1,
    x2: x, y2,
    offset: offsetLeft,
    label,
    orientation: 'vertical',
    style: 'tick',
  });
}

// ── drawSpanDimension ─────────────────────────────────────────
// Draws a span annotation: two tick marks connected by a line,
// with a label below. Used for "@ X O.C." patterns.

export function drawSpanDimension(
  x1: number, x2: number,
  y: number,
  label: string,
  labelBelow?: boolean
): string {
  const els: string[] = [];
  const dimY = y + 16;
  els.push(dimLine(x1, y, x1, dimY + 4));
  els.push(dimLine(x2, y, x2, dimY + 4));
  els.push(dimLine(x1, dimY, x2, dimY));
  els.push(dimTick(x1, dimY, true));
  els.push(dimTick(x2, dimY, true));
  const midX = (x1 + x2) / 2;
  els.push(drawText(midX, labelBelow ? dimY + 11 : dimY - 4, label, {
    anchor: 'middle',
    fontSize: 7,
    fontWeight: 'bold',
    fill: DIM_COLOR,
  }));
  return els.join('');
}

// ── drawContinuousDimension ───────────────────────────────────
// Multiple equal or variable spans across a row.
// xPositions: array of x coordinates (at least 2).
// labels: one label per span (length = xPositions.length - 1).

export function drawContinuousDimension(
  xPositions: number[],
  y: number,
  offsetUp: number,
  labels: string[]
): string {
  if (xPositions.length < 2) return '';
  const els: string[] = [];
  const dimY = y - offsetUp;

  // Continuous baseline
  const x0 = xPositions[0];
  const xN = xPositions[xPositions.length - 1];
  els.push(dimLine(x0, dimY, xN, dimY));

  // Extension lines and tick at each position
  xPositions.forEach((x) => {
    els.push(dimLine(x, y - EXT_GAP, x, dimY - EXT_OVERSHOOT));
    els.push(dimTick(x, dimY, true));
  });

  // Label each span
  for (let i = 0; i < xPositions.length - 1; i++) {
    const midX = (xPositions[i] + xPositions[i + 1]) / 2;
    els.push(drawText(midX, dimY - 4, labels[i] || '', {
      anchor: 'middle',
      fontSize: 7,
      fontWeight: 'bold',
      fill: DIM_COLOR,
    }));
  }
  return els.join('');
}

// ── drawOverallDimension ──────────────────────────────────────
// Outer overall dimension (heavier) spanning full extent.
// Typically placed further out than the detail dimensions.

export function drawOverallDimension(
  x1: number,
  x2: number,
  y: number,
  offsetUp: number,
  label: string
): string {
  const els: string[] = [];
  const dimY = y - offsetUp;

  // Heavy extension lines
  els.push(dimLine(x1, y, x1, dimY - EXT_OVERSHOOT));
  els.push(dimLine(x2, y, x2, dimY - EXT_OVERSHOOT));

  // Heavy dim line
  els.push('<line x1="' + x1.toFixed(1) + '" y1="' + dimY.toFixed(1) +
    '" x2="' + x2.toFixed(1) + '" y2="' + dimY.toFixed(1) +
    '" stroke="' + DIM_COLOR + '" stroke-width="1.4"/>');

  // Arrowheads (for overall — more prominent)
  els.push(drawArrowhead(x1, dimY, 0, ARROW_SIZE + 1, DIM_COLOR));
  els.push(drawArrowhead(x2, dimY, 180, ARROW_SIZE + 1, DIM_COLOR));

  // Label
  const midX = (x1 + x2) / 2;
  els.push(drawText(midX, dimY - 5, label, {
    anchor: 'middle',
    fontSize: 9,
    fontWeight: '900',
    fill: DIM_COLOR,
  }));
  return els.join('');
}

// ── drawAngleDimension ────────────────────────────────────────
// Arc-style angle annotation. center at (cx,cy), from angle a1 to a2 (degrees).

export function drawAngleDimension(
  cx: number, cy: number,
  radius: number,
  a1Deg: number, a2Deg: number,
  label: string
): string {
  const els: string[] = [];
  const a1 = a1Deg * Math.PI / 180;
  const a2 = a2Deg * Math.PI / 180;
  const x1 = cx + radius * Math.cos(a1);
  const y1 = cy + radius * Math.sin(a1);
  const x2 = cx + radius * Math.cos(a2);
  const y2 = cy + radius * Math.sin(a2);
  const large = Math.abs(a2Deg - a1Deg) > 180 ? 1 : 0;
  const d = 'M ' + x1.toFixed(1) + ' ' + y1.toFixed(1) +
    ' A ' + radius + ' ' + radius + ' 0 ' + large + ' 1 ' +
    x2.toFixed(1) + ' ' + y2.toFixed(1);
  els.push('<path d="' + d + '" stroke="' + DIM_COLOR +
    '" stroke-width="0.8" fill="none" stroke-dasharray="4,2"/>');
  const midA = (a1 + a2) / 2;
  const lx = cx + (radius + 12) * Math.cos(midA);
  const ly = cy + (radius + 12) * Math.sin(midA);
  els.push(drawText(lx, ly, label, {
    anchor: 'middle', fontSize: 8, fontWeight: 'bold', fill: DIM_COLOR
  }));
  return els.join('');
}

// ── Internal helpers ──────────────────────────────────────────

function dimLine(x1: number, y1: number, x2: number, y2: number): string {
  return '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) +
    '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) +
    '" stroke="' + DIM_COLOR + '" stroke-width="0.8"/>';
}

// Tick mark — small 45° slash at endpoint
function dimTick(x: number, y: number, horizontal: boolean): string {
  if (horizontal) {
    return '<line x1="' + (x - TICK_HALF).toFixed(1) + '" y1="' + (y - TICK_HALF).toFixed(1) +
      '" x2="' + (x + TICK_HALF).toFixed(1) + '" y2="' + (y + TICK_HALF).toFixed(1) +
      '" stroke="' + DIM_COLOR + '" stroke-width="1.2"/>';
  } else {
    // Vertical dim tick is horizontal slash
    return '<line x1="' + (x - TICK_HALF).toFixed(1) + '" y1="' + (y + TICK_HALF).toFixed(1) +
      '" x2="' + (x + TICK_HALF).toFixed(1) + '" y2="' + (y - TICK_HALF).toFixed(1) +
      '" stroke="' + DIM_COLOR + '" stroke-width="1.2"/>';
  }
}