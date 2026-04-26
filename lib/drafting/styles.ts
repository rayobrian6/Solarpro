// ============================================================
// SolarPro Drafting Engine — CAD Style System
// lib/drafting/styles.ts
//
// The canonical CSS for all drawing classes.
// Injected into planset HTML once (in the <style> block).
// NO inline styles in SVG. All stroke/fill through classes.
// ============================================================

export const DRAFTING_CSS = `
/* ── CAD Line Weight System ─────────────────────────────────── */

/* Primary structural elements — walls, beams, major outlines */
.line-struct {
  stroke: #000;
  stroke-width: 2.5;
  fill: none;
}

/* PV modules, panel grid lines */
.line-panel {
  stroke: #2255aa;
  stroke-width: 1.5;
  fill: none;
}

/* Dimension lines, extension lines, leaders */
.line-dim {
  stroke: #0055aa;
  stroke-width: 0.8;
  fill: none;
}

/* Hidden / below-grade elements */
.line-hidden {
  stroke: #888;
  stroke-width: 0.8;
  fill: none;
  stroke-dasharray: 4,3;
}

/* Wind load arrows — red for visibility */
.line-wind {
  stroke: #cc0000;
  stroke-width: 1.8;
  fill: none;
}

/* Grade / ground line */
.line-grade {
  stroke: #5C4A20;
  stroke-width: 2.0;
  fill: none;
}

/* Fire setback lines — red dashed */
.line-setbk {
  stroke: #cc0000;
  stroke-width: 1.0;
  fill: none;
  stroke-dasharray: 6,3;
}

/* Conduit path — orange dashed */
.line-conduit {
  stroke: #ff8800;
  stroke-width: 1.5;
  fill: none;
  stroke-dasharray: 8,4;
}

/* ── Drawing Zone Layout ────────────────────────────────────── */

/* Outer flex container for drawing + data zones */
.page-draw {
  display: flex;
  flex-direction: column;
  gap: 0;
  overflow: hidden;
  margin-top: var(--md);
  flex: 1;
}

/* Primary drawing zone — 65-70% of page height */
.draw-zone {
  flex: 0 0 68%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border: var(--border);
  background: #fff;
}

/* Drawing zone header bar */
.draw-zone-hdr {
  background: #000;
  color: #fff;
  font-size: var(--f-sm);
  font-weight: 900;
  padding: 2px var(--xs);
  letter-spacing: 0.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 0;
  text-transform: uppercase;
}

/* SVG container inside drawing zone */
.draw-zone-body {
  flex: 1;
  display: flex;
  align-items: stretch;
  justify-content: stretch;
  overflow: hidden;
  padding: 2px;
}

.draw-zone-body svg {
  width: 100%;
  height: 100%;
  display: block;
}

/* Data zone — 30-35% of page height */
.data-zone {
  flex: 0 0 30%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 0;
  border: var(--border);
  border-top: none;
}

/* ── Callout System ─────────────────────────────────────────── */

/* Numbered callout bubble */
.callout-bubble {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: 1.5px solid #000;
  border-radius: 50%;
  font-size: 8px;
  font-weight: 900;
  background: #fff;
  color: #000;
  flex-shrink: 0;
}

/* Callout row in data zone */
.callout-row {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  padding: 2px var(--xs);
  font-size: var(--f-xs);
  border-bottom: 1px solid #eee;
  line-height: 1.4;
}

/* ── Engineering Table Rules ────────────────────────────────── */
/* Tables ONLY used for: equipment schedule, conductor sizing, calculations */
/* Tables MUST NOT exceed 35% of page height */

.eng-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--f-xs);
}

.eng-table th {
  background: #000;
  color: #fff;
  padding: 2px 4px;
  font-weight: 900;
  font-size: 7px;
  text-align: left;
  letter-spacing: 0.3px;
}

.eng-table td {
  padding: 2px 4px;
  border-bottom: 1px solid #eee;
  font-size: 7px;
}

.eng-table tr:nth-child(even) td {
  background: #f9f9f9;
}

.eng-table tr:last-child td {
  border-bottom: none;
}

/* ── Detail Reference Tags ──────────────────────────────────── */

.detail-tag {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1.5px solid #000;
  border-radius: 50%;
  font-size: 7px;
  font-weight: 900;
}

.detail-tag-num {
  font-size: 9px;
  font-weight: 900;
  line-height: 1;
}

.detail-tag-ref {
  font-size: 6px;
  border-top: 0.5px solid #000;
  padding-top: 1px;
  line-height: 1;
}
`;

// ── CAD Color Tokens ─────────────────────────────────────────
// Use in SVG fill= and stroke= attributes when class isn't
// sufficient (e.g. polygon fills, hatches, backgrounds).

export const CAD_COLORS = {
  // Structure
  structStroke:   '#000000',
  structFill:     'none',

  // Panels / modules
  panelFill:      '#1a3a7a',
  panelStroke:    '#0a1a3a',
  panelCellLine:  '#4466bb',

  // Earth / grade
  earthFill:      '#a08060',
  earthStroke:    '#6b5030',
  gradeStroke:    '#5C4A20',

  // Concrete / masonry
  concreteFill:   '#d0c8b8',
  concreteStroke: '#888888',

  // Steel
  steelFill:      '#888888',
  steelStroke:    '#333333',

  // Dimension
  dimStroke:      '#0055aa',

  // Fire setback
  setbackStroke:  '#cc0000',

  // Conduit
  conduitStroke:  '#ff8800',

  // Wind / load
  windStroke:     '#cc0000',
  loadArrow:      '#666666',

  // Background
  drawBg:         '#fafafa',
  roofBg:         '#f5f7f0',
  groundBg:       '#f0f4e8',
  fenceBg:        '#f4f6ee',

  // Roof surface
  roofFill:       '#e8e0d0',
  roofStroke:     '#555555',
} as const;