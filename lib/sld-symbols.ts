// ============================================================
// SLD Symbol System — Engineering Grade v2.0
// IEEE 315 / ANSI Y32.9 / NEC-aligned
// Utility-recognizable, permit-ready
//
// DESIGN SYSTEM:
//   Primary stroke:   2px   (enclosures, main conductors)
//   Secondary stroke: 1.5px (internal details, labels)
//   Hair stroke:      0.75px (fine detail)
//   Grid unit:        8px
//   Max corner radius: 2px
//
// CONNECTION POINTS: { x, y, dir: 'left'|'right'|'top'|'bottom' }
// VOLTAGE DOMAIN:    'AC' | 'DC' | 'BOTH' | 'GND'
// ============================================================

export interface ConnectionPoint {
  id: string;
  x: number;
  y: number;
  dir: 'left' | 'right' | 'top' | 'bottom';
  domain: 'AC' | 'DC' | 'GND' | 'COM';
  label?: string;
}

export interface LabelAnchor {
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
  baseline: 'auto' | 'hanging' | 'middle';
}

export interface SLDSymbol {
  id: string;
  label: string;
  sub: string;
  domain: 'AC' | 'DC' | 'BOTH' | 'GND';
  badge: string;
  badgeColor: 'blue' | 'green' | 'purple' | 'yellow' | 'red';
  width: number;
  height: number;
  connections: ConnectionPoint[];
  labelAnchor: LabelAnchor;
  svg: (opts?: Record<string, string | number | boolean>) => string;
}

// ─── Design Tokens ────────────────────────────────────────────────────────────
const T = {
  // Strokes
  SW_PRIMARY:   2,
  SW_SECONDARY: 1.5,
  SW_HAIR:      0.75,
  SW_BUS:       3.5,
  // Colors
  BLACK:   '#1A1A1A',
  WHITE:   '#FFFFFF',
  GND:     '#005500',
  DC_CLR:  '#C84B00',   // warm orange — DC domain
  AC_CLR:  '#0A3D7C',   // deep blue  — AC domain
  BAT_CLR: '#1565C0',   // battery blue
  GEN_CLR: '#2E7D32',   // generator green
  ATS_CLR: '#E65100',   // ATS orange
  BUI_ENP: '#0D47A1',   // Enphase blue
  BUI_TSL: '#CC0000',   // Tesla red
  BUI_GEN: '#1565C0',   // Generic BUI blue
  SUB_CLR: '#6A1B9A',   // subpanel purple
  // Geometry
  R: 2,                 // corner radius
  GRID: 8,              // grid unit
};

// ─── SVG Primitives ───────────────────────────────────────────────────────────
function p_rect(x: number, y: number, w: number, h: number,
  opts: { fill?: string; stroke?: string; sw?: number; r?: number } = {}): string {
  const { fill = T.WHITE, stroke = T.BLACK, sw = T.SW_PRIMARY, r = T.R } = opts;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
}
function p_line(x1: number, y1: number, x2: number, y2: number,
  opts: { stroke?: string; sw?: number; dash?: string; cap?: string } = {}): string {
  const { stroke = T.BLACK, sw = T.SW_PRIMARY, dash, cap } = opts;
  let s = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${sw}"`;
  if (dash) s += ` stroke-dasharray="${dash}"`;
  if (cap)  s += ` stroke-linecap="${cap}"`;
  s += '/>';
  return s;
}
function p_circle(cx: number, cy: number, r: number,
  opts: { fill?: string; stroke?: string; sw?: number } = {}): string {
  const { fill = T.WHITE, stroke = T.BLACK, sw = T.SW_PRIMARY } = opts;
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
}
function p_path(d: string,
  opts: { fill?: string; stroke?: string; sw?: number; dash?: string } = {}): string {
  const { fill = 'none', stroke = T.BLACK, sw = T.SW_PRIMARY, dash } = opts;
  let s = `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"`;
  if (dash) s += ` stroke-dasharray="${dash}"`;
  s += '/>';
  return s;
}
function p_text(x: number, y: number, text: string,
  opts: { sz?: number; fill?: string; anchor?: string; bold?: boolean; italic?: boolean } = {}): string {
  const { sz = 7, fill = T.BLACK, anchor = 'middle', bold = false, italic = false } = opts;
  let s = `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${sz}" fill="${fill}"`;
  if (bold)   s += ' font-weight="bold"';
  if (italic) s += ' font-style="italic"';
  s += `>${text}</text>`;
  return s;
}
function p_tspan(x: number, y: number, lines: string[],
  opts: { sz?: number; fill?: string; anchor?: string; bold?: boolean; lh?: number } = {}): string {
  const { sz = 6.5, fill = T.BLACK, anchor = 'middle', bold = false, lh = 9 } = opts;
  const spans = lines.map((l, i) =>
    `<tspan x="${x}" dy="${i === 0 ? 0 : lh}">${l}</tspan>`).join('');
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${sz}" fill="${fill}"${bold ? ' font-weight="bold"' : ''}>${spans}</text>`;
}

// ─── Shared Sub-symbols ───────────────────────────────────────────────────────

/** IEEE 315 ground — 3 descending horizontal lines */
function sym_ground(x: number, y: number, clr = T.GND): string {
  return [
    p_line(x, y, x, y + 8,   { stroke: clr, sw: T.SW_PRIMARY }),
    p_line(x - 10, y + 8,  x + 10, y + 8,  { stroke: clr, sw: T.SW_PRIMARY }),
    p_line(x - 7,  y + 13, x + 7,  y + 13, { stroke: clr, sw: T.SW_SECONDARY }),
    p_line(x - 4,  y + 18, x + 4,  y + 18, { stroke: clr, sw: T.SW_SECONDARY }),
  ].join('');
}

/** Terminal lug: open circle with center dot */
function sym_lug(cx: number, cy: number, clr = T.BLACK): string {
  return p_circle(cx, cy, 3.5, { fill: T.WHITE, stroke: clr, sw: T.SW_SECONDARY })
       + p_circle(cx, cy, 1.2, { fill: clr, stroke: clr, sw: 0 });
}

/** Directional arrow on a conductor */
function sym_arrow(x: number, y: number, dir: 'right' | 'left' | 'down', clr = T.BLACK, sz = 5): string {
  let d = '';
  if (dir === 'right') d = `M${x},${y - sz / 2} L${x + sz},${y} L${x},${y + sz / 2}`;
  if (dir === 'left')  d = `M${x},${y - sz / 2} L${x - sz},${y} L${x},${y + sz / 2}`;
  if (dir === 'down')  d = `M${x - sz / 2},${y} L${x},${y + sz} L${x + sz / 2},${y}`;
  return p_path(d, { fill: clr, stroke: clr, sw: 1 });
}

/** Sine wave path centered at (cx, cy) */
function sym_sine(cx: number, cy: number, w = 20, h = 7): string {
  return p_path(
    `M${cx - w / 2},${cy} Q${cx - w / 4},${cy - h} ${cx},${cy} Q${cx + w / 4},${cy + h} ${cx + w / 2},${cy}`,
    { stroke: T.BLACK, sw: T.SW_SECONDARY }
  );
}

/** DC flat line marker */
function sym_dc_line(cx: number, cy: number, w = 18): string {
  return p_line(cx - w / 2, cy, cx + w / 2, cy, { stroke: T.BLACK, sw: T.SW_SECONDARY });
}

/** Fuse: IEEE 315 rectangle with leads */
function sym_fuse(cx: number, cy: number, w = 16, h = 8): string {
  return [
    p_line(cx - w / 2 - 8, cy, cx - w / 2, cy, { sw: T.SW_SECONDARY }),
    p_rect(cx - w / 2, cy - h / 2, w, h, { sw: T.SW_SECONDARY }),
    p_line(cx + w / 2, cy, cx + w / 2 + 8, cy, { sw: T.SW_SECONDARY }),
  ].join('');
}

/** Circuit breaker: rectangle + arc */
function sym_breaker(cx: number, cy: number, w = 20, h = 14, amps?: number, clr = T.BLACK): string {
  const parts = [
    p_rect(cx - w / 2, cy - h / 2, w, h, { stroke: clr, sw: T.SW_SECONDARY }),
    p_path(`M${cx - 5},${cy + 3} Q${cx},${cy - 6} ${cx + 5},${cy + 3}`,
      { stroke: clr, sw: T.SW_HAIR }),
  ];
  if (amps) parts.push(p_text(cx, cy - h / 2 - 3, `${amps}A`, { sz: 5.5, anchor: 'middle', bold: true, fill: clr }));
  return parts.join('');
}

/** Open-blade knife switch (IEEE 315) */
function sym_knife_switch(lx: number, cy: number, w = 40, clr = T.BLACK): string {
  return [
    p_line(lx, cy, lx + 10, cy, { stroke: clr, sw: T.SW_SECONDARY }),
    p_circle(lx + 10, cy, 3, { fill: clr, stroke: clr, sw: 0 }),
    p_line(lx + 10, cy, lx + w - 10, cy - 12, { stroke: clr, sw: T.SW_SECONDARY }),
    p_circle(lx + w - 10, cy, 3, { fill: T.WHITE, stroke: clr, sw: T.SW_SECONDARY }),
    p_line(lx + w - 10, cy, lx + w, cy, { stroke: clr, sw: T.SW_SECONDARY }),
  ].join('');
}

/** Callout circle */
function sym_callout(cx: number, cy: number, n: number): string {
  return p_circle(cx, cy, 10, { fill: T.WHITE, stroke: T.BLACK, sw: T.SW_SECONDARY })
       + p_text(cx, cy + 4, String(n), { sz: 8, bold: true, anchor: 'middle' });
}

/** Section header label for a box */
function sym_header(bx: number, by: number, bw: number, text: string, clr = T.BLACK): string {
  return p_rect(bx, by, bw, 14, { fill: clr, stroke: clr, sw: 0, r: T.R })
       + p_text(bx + bw / 2, by + 10, text, { sz: 5.5, fill: T.WHITE, anchor: 'middle', bold: true });
}

/** Voltage domain badge (small pill top-right of enclosure) */
function sym_domain_badge(rx: number, ty: number, domain: 'AC' | 'DC' | 'BOTH'): string {
  const clr = domain === 'DC' ? T.DC_CLR : domain === 'AC' ? T.AC_CLR : '#444';
  return p_rect(rx - 22, ty + 3, 20, 9, { fill: clr, stroke: 'none', sw: 0, r: 2 })
       + p_text(rx - 12, ty + 10, domain, { sz: 5, fill: T.WHITE, anchor: 'middle', bold: true });
}

/** Busbar: heavy horizontal line */
function sym_busbar(x1: number, x2: number, y: number, label?: string, clr = T.BLACK): string {
  const p = [p_line(x1, y, x2, y, { stroke: clr, sw: T.SW_BUS })];
  if (label) p.push(p_text((x1 + x2) / 2, y - 5, label, { sz: 5.5, anchor: 'middle', bold: true, fill: clr }));
  return p.join('');
}

// ─── SVG wrapper ─────────────────────────────────────────────────────────────
function svg_wrap(w: number, h: number, content: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="background:#fff;display:block;">${content}</svg>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SYMBOL DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════════

export const SLD_SYMBOLS: SLDSymbol[] = [

  // ─────────────────────────────────────────────────────────────────────────
  // 1. GROUND
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'ground',
    label: 'Ground',
    sub: 'IEEE 315 — EGC / GES / System Ground',
    domain: 'GND',
    badge: 'Always',
    badgeColor: 'blue',
    width: 48,
    height: 40,
    connections: [{ id: 'in', x: 24, y: 0, dir: 'top', domain: 'GND' }],
    labelAnchor: { x: 24, y: 44, anchor: 'middle', baseline: 'hanging' },
    svg: () => svg_wrap(48, 40,
      p_line(24, 0, 24, 8, { stroke: T.GND, sw: T.SW_PRIMARY })
      + sym_ground(24, 8, T.GND)
    ),
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 2. FUSE (inline)
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'fuse',
    label: 'Fuse (Inline)',
    sub: 'IEEE 315 — rectangular fuse symbol',
    domain: 'DC',
    badge: 'String only',
    badgeColor: 'green',
    width: 64,
    height: 32,
    connections: [
      { id: 'line', x: 0, y: 16, dir: 'left', domain: 'DC' },
      { id: 'load', x: 64, y: 16, dir: 'right', domain: 'DC' },
    ],
    labelAnchor: { x: 32, y: 30, anchor: 'middle', baseline: 'hanging' },
    svg: () => svg_wrap(64, 32,
      sym_fuse(32, 16)
    ),
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 3. CIRCUIT BREAKER
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'breaker',
    label: 'Circuit Breaker',
    sub: 'IEEE 315 — rectangle + internal arc',
    domain: 'AC',
    badge: 'Always',
    badgeColor: 'blue',
    width: 64,
    height: 40,
    connections: [
      { id: 'line', x: 0, y: 20, dir: 'left', domain: 'AC' },
      { id: 'load', x: 64, y: 20, dir: 'right', domain: 'AC' },
    ],
    labelAnchor: { x: 32, y: 38, anchor: 'middle', baseline: 'hanging' },
    svg: (opts = {}) => svg_wrap(64, 40,
      sym_breaker(32, 20, 24, 16, opts.amps as number | undefined)
    ),
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 4. JUNCTION BOX
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'jbox',
    label: 'Junction Box',
    sub: 'DC/AC roof junction — multiple connection points',
    domain: 'BOTH',
    badge: 'Always',
    badgeColor: 'blue',
    width: 80,
    height: 80,
    connections: [
      { id: 'left',   x: 0,  y: 40, dir: 'left',   domain: 'DC',  label: 'IN' },
      { id: 'right',  x: 80, y: 40, dir: 'right',  domain: 'DC',  label: 'OUT' },
      { id: 'top',    x: 40, y: 0,  dir: 'top',    domain: 'DC' },
      { id: 'bottom', x: 40, y: 80, dir: 'bottom', domain: 'DC' },
    ],
    labelAnchor: { x: 40, y: -14, anchor: 'middle', baseline: 'auto' },
    svg: (opts = {}) => {
      const label = (opts.label as string) || 'ROOF J-BOX';
      const sub   = (opts.sub   as string) || 'DC JUNCTION';
      const p: string[] = [];
      p.push(p_rect(8, 8, 64, 64));
      // X cross
      p.push(p_line(16, 16, 64, 64, { sw: T.SW_HAIR }));
      p.push(p_line(64, 16, 16, 64, { sw: T.SW_HAIR }));
      // Lugs
      p.push(sym_lug(8, 40)); p.push(sym_lug(72, 40));
      // Stubs
      p.push(p_line(0, 40, 8, 40, { sw: T.SW_SECONDARY }));
      p.push(p_line(72, 40, 80, 40, { sw: T.SW_SECONDARY }));
      // Header
      p.push(sym_header(8, 8, 64, label));
      p.push(p_text(40, 52, sub, { sz: 6, anchor: 'middle', italic: true }));
      return svg_wrap(80, 80, p.join(''));
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 5. PV ARRAY BLOCK
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'pv-array',
    label: 'PV Array',
    sub: '2×3 module grid — grouped source block',
    domain: 'DC',
    badge: 'Always',
    badgeColor: 'blue',
    width: 120,
    height: 104,
    connections: [
      { id: 'dc-pos', x: 120, y: 36, dir: 'right', domain: 'DC', label: 'DC+' },
      { id: 'dc-neg', x: 120, y: 52, dir: 'right', domain: 'DC', label: 'DC−' },
      { id: 'egc',    x: 60,  y: 104, dir: 'bottom', domain: 'GND', label: 'EGC' },
    ],
    labelAnchor: { x: 60, y: -20, anchor: 'middle', baseline: 'auto' },
    svg: (opts = {}) => {
      const modules = (opts.modules as number) || 18;
      const watts   = (opts.watts   as number) || 400;
      const model   = (opts.model   as string) || 'MODULE MODEL';
      const dcKw    = ((modules * watts) / 1000).toFixed(2);
      const p: string[] = [];
      // Outer enclosure
      p.push(p_rect(0, 16, 120, 88, { r: T.R }));
      // Header
      p.push(sym_header(0, 16, 120, 'PV ARRAY'));
      // Domain badge
      p.push(sym_domain_badge(120, 16, 'DC'));
      // 2×3 module grid
      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 3; col++) {
          const mx = 8  + col * 34;
          const my = 38 + row * 30;
          // Module rectangle + diagonal (IEEE/IEC)
          p.push(p_rect(mx, my, 28, 22, { sw: T.SW_SECONDARY }));
          p.push(p_line(mx, my + 22, mx + 28, my, { sw: T.SW_HAIR }));
        }
      }
      // DC output stubs + polarity
      p.push(p_line(112, 36, 120, 36, { stroke: T.DC_CLR, sw: T.SW_PRIMARY }));
      p.push(p_text(106, 33, '+', { sz: 7, fill: T.DC_CLR, bold: true, anchor: 'middle' }));
      p.push(p_line(112, 52, 120, 52, { stroke: T.DC_CLR, sw: T.SW_PRIMARY }));
      p.push(p_text(106, 55, '−', { sz: 7, fill: T.DC_CLR, bold: true, anchor: 'middle' }));
      // Arrow
      p.push(sym_arrow(116, 44, 'right', T.DC_CLR));
      // EGC stub
      p.push(p_line(60, 104, 60, 112, { stroke: T.GND, sw: T.SW_SECONDARY }));
      // Labels below
      p.push(p_text(60, 110, `${modules} × ${watts}W — ${dcKw} kW DC`, { sz: 6, anchor: 'middle', fill: T.DC_CLR, bold: true }));
      p.push(p_text(60, 120, model, { sz: 5.5, anchor: 'middle', italic: true }));
      return svg_wrap(120, 124, p.join(''));
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 6. INVERTER (STRING / HYBRID)
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'inverter',
    label: 'Inverter',
    sub: 'DC input → AC output, MPPT inputs, sine wave indicator',
    domain: 'BOTH',
    badge: 'String only',
    badgeColor: 'green',
    width: 128,
    height: 104,
    connections: [
      { id: 'dc-in',  x: 0,   y: 44, dir: 'left',   domain: 'DC',  label: 'DC IN' },
      { id: 'ac-out', x: 128, y: 44, dir: 'right',  domain: 'AC',  label: 'AC OUT' },
      { id: 'egc',    x: 64,  y: 104, dir: 'bottom', domain: 'GND', label: 'EGC' },
    ],
    labelAnchor: { x: 64, y: -20, anchor: 'middle', baseline: 'auto' },
    svg: (opts = {}) => {
      const mfr    = (opts.mfr    as string) || 'MANUFACTURER';
      const model  = (opts.model  as string) || 'MODEL NO.';
      const acKw   = (opts.acKw   as number) || 0;
      const acAmps = (opts.acAmps as number) || 0;
      const mppt   = (opts.mppt   as number) || 2;
      const topo   = (opts.topo   as string) || 'STRING INVERTER';
      const p: string[] = [];

      // Enclosure
      p.push(p_rect(0, 0, 128, 88));
      p.push(sym_header(0, 0, 128, topo));

      // Domain badges
      p.push(p_rect(2, 18, 18, 9, { fill: T.DC_CLR, stroke: 'none', sw: 0, r: 2 }));
      p.push(p_text(11, 25, 'DC', { sz: 5, fill: T.WHITE, anchor: 'middle', bold: true }));
      p.push(p_rect(108, 18, 18, 9, { fill: T.AC_CLR, stroke: 'none', sw: 0, r: 2 }));
      p.push(p_text(117, 25, 'AC', { sz: 5, fill: T.WHITE, anchor: 'middle', bold: true }));

      // Vertical divider (DC | AC)
      p.push(p_line(64, 14, 64, 88, { sw: T.SW_HAIR, dash: '3,3' }));

      // DC side — flat line indicator
      p.push(sym_dc_line(26, 44, 18));
      p.push(p_text(26, 54, 'DC', { sz: 6.5, fill: T.DC_CLR, anchor: 'middle', bold: true }));

      // Conversion arrow
      p.push(p_line(38, 44, 88, 44, { sw: T.SW_PRIMARY }));
      p.push(sym_arrow(76, 44, 'right'));

      // AC side — sine wave
      p.push(sym_sine(104, 44, 22, 8));
      p.push(p_text(104, 54, 'AC', { sz: 6.5, fill: T.AC_CLR, anchor: 'middle', bold: true }));

      // MPPT input dots (left side, evenly spaced)
      const mpptSpacing = 16;
      const mpptStartY  = 44 - ((mppt - 1) * mpptSpacing) / 2;
      for (let i = 0; i < mppt; i++) {
        const my = mpptStartY + i * mpptSpacing;
        p.push(p_circle(0, my, 3.5, { fill: T.DC_CLR, stroke: T.DC_CLR, sw: 0 }));
        p.push(p_text(8, my + 3, `MPPT${i + 1}`, { sz: 4.5, fill: T.DC_CLR, anchor: 'start' }));
        p.push(p_line(3.5, my, 20, my, { stroke: T.DC_CLR, sw: T.SW_HAIR }));
      }

      // AC output lug right
      p.push(sym_lug(128, 44, T.AC_CLR));
      p.push(p_line(128, 44, 136, 44, { stroke: T.AC_CLR, sw: T.SW_PRIMARY }));

      // DC input lug left
      p.push(sym_lug(0, 44, T.DC_CLR));
      p.push(p_line(-8, 44, 0, 44, { stroke: T.DC_CLR, sw: T.SW_PRIMARY }));

      // EGC bottom
      p.push(p_line(64, 88, 64, 104, { stroke: T.GND, sw: T.SW_SECONDARY }));

      // Manufacturer / model / specs
      p.push(p_text(64, 68, mfr,   { sz: 6, anchor: 'middle', italic: true }));
      p.push(p_text(64, 76, model, { sz: 7, anchor: 'middle', bold: true }));
      if (acKw > 0) {
        p.push(p_text(64, 84, `${acKw} kW AC / ${acAmps}A`, { sz: 6, anchor: 'middle', fill: T.AC_CLR }));
      }

      return svg_wrap(144, 116, p.join(''));
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 7. DC DISCONNECT
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'dc-disconnect',
    label: 'DC Disconnect',
    sub: 'DC DISC — 2-pole fused, polarity marked',
    domain: 'DC',
    badge: 'String only',
    badgeColor: 'green',
    width: 96,
    height: 80,
    connections: [
      { id: 'line-pos', x: 0,  y: 32, dir: 'left',  domain: 'DC', label: 'LINE +' },
      { id: 'line-neg', x: 0,  y: 48, dir: 'left',  domain: 'DC', label: 'LINE −' },
      { id: 'load-pos', x: 96, y: 32, dir: 'right', domain: 'DC', label: 'LOAD +' },
      { id: 'load-neg', x: 96, y: 48, dir: 'right', domain: 'DC', label: 'LOAD −' },
      { id: 'egc',      x: 48, y: 80, dir: 'bottom', domain: 'GND' },
    ],
    labelAnchor: { x: 48, y: -20, anchor: 'middle', baseline: 'auto' },
    svg: (opts = {}) => {
      const amps  = (opts.amps  as number) || 15;
      const label = (opts.label as string) || '(N) DC DISCONNECT';
      const rsd   = opts.rsd as boolean;
      const p: string[] = [];

      p.push(p_rect(0, 8, 96, 64));
      p.push(sym_header(0, 8, 96, 'DC DISC'));
      p.push(sym_domain_badge(96, 8, 'DC'));

      // LINE lugs + stubs
      p.push(sym_lug(6, 32, T.DC_CLR)); p.push(p_line(0, 32, 6, 32, { stroke: T.DC_CLR, sw: T.SW_PRIMARY }));
      p.push(sym_lug(6, 48, T.DC_CLR)); p.push(p_line(0, 48, 6, 48, { stroke: T.DC_CLR, sw: T.SW_PRIMARY }));

      // Polarity labels
      p.push(p_text(14, 30, '+', { sz: 7, fill: T.DC_CLR, bold: true, anchor: 'start' }));
      p.push(p_text(14, 54, '−', { sz: 7, fill: T.DC_CLR, bold: true, anchor: 'start' }));

      // Fuses
      p.push(sym_fuse(48, 32)); p.push(sym_fuse(48, 48));

      // LOAD lugs + stubs
      p.push(sym_lug(90, 32, T.DC_CLR)); p.push(p_line(90, 32, 96, 32, { stroke: T.DC_CLR, sw: T.SW_PRIMARY }));
      p.push(sym_lug(90, 48, T.DC_CLR)); p.push(p_line(90, 48, 96, 48, { stroke: T.DC_CLR, sw: T.SW_PRIMARY }));

      // Internal wires to fuse
      p.push(p_line(9.5, 32, 32, 32, { stroke: T.DC_CLR, sw: T.SW_HAIR }));
      p.push(p_line(9.5, 48, 32, 48, { stroke: T.DC_CLR, sw: T.SW_HAIR }));
      p.push(p_line(64, 32, 86, 32,  { stroke: T.DC_CLR, sw: T.SW_HAIR }));
      p.push(p_line(64, 48, 86, 48,  { stroke: T.DC_CLR, sw: T.SW_HAIR }));

      // EGC stub
      p.push(p_line(48, 72, 48, 80, { stroke: T.GND, sw: T.SW_SECONDARY }));
      p.push(sym_ground(48, 80, T.GND));

      // Labels
      p.push(p_text(48, -8, label, { sz: 7, anchor: 'middle', bold: true }));
      p.push(p_text(48, 82, `${amps}A FUSED`, { sz: 6, anchor: 'middle', fill: T.DC_CLR }));
      if (rsd) p.push(p_text(48, 91, 'RAPID SHUTDOWN — NEC 690.12', { sz: 5.5, anchor: 'middle', italic: true }));

      return svg_wrap(96, 100, p.join(''));
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 8. AC DISCONNECT
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'ac-disconnect',
    label: 'AC Disconnect',
    sub: 'AC DISC — open-blade switch, non-fused',
    domain: 'AC',
    badge: 'Always',
    badgeColor: 'blue',
    width: 96,
    height: 80,
    connections: [
      { id: 'load-a', x: 0,  y: 32, dir: 'left',  domain: 'AC', label: 'LOAD A' },
      { id: 'load-b', x: 0,  y: 48, dir: 'left',  domain: 'AC', label: 'LOAD B' },
      { id: 'line-a', x: 96, y: 32, dir: 'right', domain: 'AC', label: 'LINE A' },
      { id: 'line-b', x: 96, y: 48, dir: 'right', domain: 'AC', label: 'LINE B' },
      { id: 'egc',    x: 48, y: 80, dir: 'bottom', domain: 'GND' },
    ],
    labelAnchor: { x: 48, y: -20, anchor: 'middle', baseline: 'auto' },
    svg: (opts = {}) => {
      const amps  = (opts.amps  as number) || 30;
      const label = (opts.label as string) || '(N) AC DISCONNECT';
      const p: string[] = [];

      p.push(p_rect(0, 8, 96, 64));
      p.push(sym_header(0, 8, 96, 'AC DISC'));
      p.push(sym_domain_badge(96, 8, 'AC'));

      // Two knife switches
      [32, 48].forEach(y => {
        p.push(sym_lug(6, y, T.AC_CLR));
        p.push(p_line(0, y, 6, y, { stroke: T.AC_CLR, sw: T.SW_PRIMARY }));
        p.push(sym_knife_switch(6, y, 60, T.AC_CLR));
        p.push(sym_lug(90, y, T.AC_CLR));
        p.push(p_line(66, y, 90, y, { stroke: T.AC_CLR, sw: T.SW_SECONDARY }));
        p.push(p_line(90, y, 96, y, { stroke: T.AC_CLR, sw: T.SW_PRIMARY }));
      });

      // EGC
      p.push(p_line(48, 72, 48, 80, { stroke: T.GND, sw: T.SW_SECONDARY }));
      p.push(sym_ground(48, 80));

      // Labels
      p.push(p_text(48, -8, label, { sz: 7, anchor: 'middle', bold: true }));
      p.push(p_text(48, 82, `${amps}A NON-FUSED`, { sz: 6, anchor: 'middle', fill: T.AC_CLR }));

      return svg_wrap(96, 100, p.join(''));
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 9. FUSED DISCONNECT (AC)
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'fused-disconnect',
    label: 'Fused Disconnect (AC)',
    sub: 'AC DISC — open-blade switch with inline fuse',
    domain: 'AC',
    badge: 'Optional',
    badgeColor: 'yellow',
    width: 96,
    height: 80,
    connections: [
      { id: 'load-a', x: 0,  y: 32, dir: 'left',  domain: 'AC' },
      { id: 'load-b', x: 0,  y: 48, dir: 'left',  domain: 'AC' },
      { id: 'line-a', x: 96, y: 32, dir: 'right', domain: 'AC' },
      { id: 'line-b', x: 96, y: 48, dir: 'right', domain: 'AC' },
      { id: 'egc',    x: 48, y: 80, dir: 'bottom', domain: 'GND' },
    ],
    labelAnchor: { x: 48, y: -20, anchor: 'middle', baseline: 'auto' },
    svg: (opts = {}) => {
      const amps = (opts.amps as number) || 30;
      const p: string[] = [];

      p.push(p_rect(0, 8, 96, 64));
      p.push(sym_header(0, 8, 96, 'FUSED DISC'));
      p.push(sym_domain_badge(96, 8, 'AC'));

      [32, 48].forEach(y => {
        p.push(sym_lug(6, y, T.AC_CLR));
        p.push(p_line(0, y, 6, y, { stroke: T.AC_CLR, sw: T.SW_PRIMARY }));
        // knife switch (shorter)
        p.push(sym_knife_switch(6, y, 44, T.AC_CLR));
        // inline fuse after switch
        p.push(sym_fuse(74, y, 12, 7));
        p.push(sym_lug(90, y, T.AC_CLR));
        p.push(p_line(80, y, 90, y, { stroke: T.AC_CLR, sw: T.SW_SECONDARY }));
        p.push(p_line(90, y, 96, y, { stroke: T.AC_CLR, sw: T.SW_PRIMARY }));
      });

      p.push(p_line(48, 72, 48, 80, { stroke: T.GND, sw: T.SW_SECONDARY }));
      p.push(sym_ground(48, 80));
      p.push(p_text(48, -8, '(N) FUSED DISCONNECT', { sz: 7, anchor: 'middle', bold: true }));
      p.push(p_text(48, 82, `${amps}A FUSED`, { sz: 6, anchor: 'middle', fill: T.AC_CLR }));

      return svg_wrap(96, 100, p.join(''));
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 10. MAIN SERVICE PANEL (MSP)
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'msp',
    label: 'Main Service Panel (MSP)',
    sub: 'Enclosure + main breaker + bus + PV backfed breaker',
    domain: 'AC',
    badge: 'Always',
    badgeColor: 'blue',
    width: 128,
    height: 128,
    connections: [
      { id: 'pv-in',   x: 0,   y: 64, dir: 'left',   domain: 'AC',  label: 'PV IN (BKFD)' },
      { id: 'bus-out', x: 128, y: 56, dir: 'right',  domain: 'AC',  label: 'BUS OUT' },
      { id: 'egc',     x: 64,  y: 128, dir: 'bottom', domain: 'GND' },
    ],
    labelAnchor: { x: 64, y: -20, anchor: 'middle', baseline: 'auto' },
    svg: (opts = {}) => {
      const busAmps  = (opts.busAmps  as number) || 200;
      const mainAmps = (opts.mainAmps as number) || 200;
      const pvAmps   = (opts.pvAmps   as number) || 30;
      const rule120  = (opts.rule120  as string) || 'PASS ✓';
      const clr      = T.AC_CLR;
      const p: string[] = [];

      p.push(p_rect(0, 0, 128, 112, { stroke: clr }));
      p.push(sym_header(0, 0, 128, `MSP ${busAmps}A BUS / ${mainAmps}A MAIN`, clr));
      p.push(sym_domain_badge(128, 0, 'AC'));

      // Main breaker
      p.push(sym_breaker(64, 32, 28, 16, mainAmps, clr));

      // Main bus (heavy)
      p.push(sym_busbar(8, 120, 56, 'MAIN BUS', clr));
      p.push(p_line(64, 40, 64, 56, { stroke: clr, sw: T.SW_SECONDARY }));

      // PV backfed breaker (load-side tap)
      const pvBkX = 80;
      p.push(p_line(pvBkX, 56, pvBkX, 68, { stroke: clr, sw: T.SW_SECONDARY }));
      p.push(sym_breaker(pvBkX, 76, 20, 12, pvAmps, clr));
      p.push(sym_lug(pvBkX, 90, clr));
      p.push(p_line(pvBkX, 82, pvBkX, 87, { stroke: clr, sw: T.SW_SECONDARY }));
      p.push(p_line(0, 90, pvBkX, 90, { stroke: clr, sw: T.SW_SECONDARY }));
      p.push(p_line(0, 64, 0, 90, { stroke: clr, sw: T.SW_PRIMARY }));
      p.push(p_text(pvBkX, 100, `NEC 705.12(B)`, { sz: 5, anchor: 'middle', italic: true }));
      p.push(p_text(pvBkX, 108, `120% RULE: ${rule120}`, { sz: 5, anchor: 'middle', bold: true, fill: rule120.includes('✓') ? '#005500' : '#CC0000' }));

      // Bus out lug (right)
      p.push(sym_lug(120, 56, clr));
      p.push(p_line(120, 56, 128, 56, { stroke: clr, sw: T.SW_PRIMARY }));

      // EGC / neutral bar
      p.push(p_line(64, 112, 64, 128, { stroke: T.GND, sw: T.SW_SECONDARY }));
      p.push(sym_ground(64, 128));

      p.push(p_text(64, -8, `MSP / MAIN PANEL`, { sz: 7.5, anchor: 'middle', bold: true }));

      return svg_wrap(128, 148, p.join(''));
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 11. SUBPANEL
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'subpanel',
    label: 'Subpanel / Backup Panel',
    sub: 'SUB PANEL — critical loads, distinct from MSP',
    domain: 'AC',
    badge: 'hasBackupPanel',
    badgeColor: 'yellow',
    width: 96,
    height: 104,
    connections: [
      { id: 'feed-in', x: 0,  y: 56, dir: 'left',   domain: 'AC', label: 'FEED IN' },
      { id: 'egc',     x: 48, y: 104, dir: 'bottom', domain: 'GND' },
    ],
    labelAnchor: { x: 48, y: -20, anchor: 'middle', baseline: 'auto' },
    svg: (opts = {}) => {
      const amps  = (opts.amps  as number) || 100;
      const brand = (opts.brand as string) || '';
      const clr   = T.SUB_CLR;
      const p: string[] = [];

      p.push(p_rect(0, 0, 96, 88, { stroke: clr }));
      p.push(sym_header(0, 0, 96, 'SUB PANEL', clr));
      p.push(sym_domain_badge(96, 0, 'AC'));

      // Main breaker
      p.push(sym_breaker(48, 26, 24, 14, amps, clr));
      p.push(p_text(48, 20, 'MAIN', { sz: 5, anchor: 'middle', bold: true, fill: clr }));

      // Bus
      p.push(sym_busbar(8, 88, 46, 'CRIT. LOADS BUS', clr));
      p.push(p_line(48, 33, 48, 46, { stroke: clr, sw: T.SW_SECONDARY }));

      // 3 branch breakers
      [-22, 0, 22].forEach(off => {
        p.push(p_line(48 + off, 46, 48 + off, 56, { stroke: clr, sw: T.SW_SECONDARY }));
        p.push(sym_breaker(48 + off, 63, 14, 10, undefined, clr));
      });

      // Feed-in lug left
      p.push(sym_lug(0, 56, clr));
      p.push(p_line(0, 46, 0, 56, { stroke: clr, sw: T.SW_PRIMARY }));

      // EGC
      p.push(p_line(48, 88, 48, 104, { stroke: T.GND, sw: T.SW_SECONDARY }));
      p.push(sym_ground(48, 104, T.GND));

      p.push(p_text(48, -8, 'BACKUP SUB-PANEL', { sz: 7.5, anchor: 'middle', bold: true, fill: clr }));
      if (brand) p.push(p_text(48, 97, brand, { sz: 5.5, anchor: 'middle', italic: true }));
      p.push(p_text(48, 106, 'CRITICAL LOADS ONLY', { sz: 5.5, anchor: 'middle', fill: clr }));

      return svg_wrap(96, 120, p.join(''));
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 12. UTILITY METER
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'utility-meter',
    label: 'Utility Meter',
    sub: 'Circle with kWh — bi-directional meter',
    domain: 'AC',
    badge: 'Always',
    badgeColor: 'blue',
    width: 80,
    height: 160,
    connections: [
      { id: 'line-in',  x: 0,  y: 32, dir: 'left',   domain: 'AC' },
      { id: 'grid-out', x: 40, y: 160, dir: 'bottom', domain: 'AC' },
    ],
    labelAnchor: { x: 40, y: -16, anchor: 'middle', baseline: 'auto' },
    svg: (opts = {}) => {
      const utility = (opts.utility as string) || 'UTILITY';
      const p: string[] = [];

      // Meter circle
      p.push(p_circle(40, 32, 28));
      p.push(p_text(40, 30, 'kWh', { sz: 8, anchor: 'middle', bold: true }));
      p.push(p_text(40, 40, 'M', { sz: 7, anchor: 'middle' }));
      // Entry wire
      p.push(p_line(0, 32, 12, 32, { sw: T.SW_PRIMARY }));

      // Arrow in
      p.push(sym_arrow(8, 32, 'right'));

      // Wire to grid circle
      p.push(p_line(40, 60, 40, 96, { sw: T.SW_PRIMARY }));
      p.push(sym_arrow(40, 80, 'down'));

      // Grid circle (utility)
      p.push(p_circle(40, 112, 20));
      p.push(p_text(40, 108, 'UTIL', { sz: 6, anchor: 'middle', bold: true }));
      p.push(p_text(40, 118, 'GRID', { sz: 5.5, anchor: 'middle' }));

      // Wire + ground
      p.push(p_line(40, 132, 40, 144, { sw: T.SW_SECONDARY }));
      p.push(sym_ground(40, 144, T.GND));

      // Labels
      p.push(p_text(40, -6, 'UTILITY METER', { sz: 7.5, anchor: 'middle', bold: true }));
      p.push(p_text(40, 4, utility, { sz: 6.5, anchor: 'middle' }));
      p.push(p_text(40, 164, 'UTILITY GRID', { sz: 6.5, anchor: 'middle', bold: true }));
      p.push(p_text(40, 173, utility, { sz: 6, anchor: 'middle', italic: true }));

      return svg_wrap(80, 180, p.join(''));
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 13. BATTERY — DC-COUPLED
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'battery-dc',
    label: 'Battery — DC-Coupled',
    sub: 'IEC 60617 cell stack — connects on DC bus',
    domain: 'DC',
    badge: 'hasBattery (DC)',
    badgeColor: 'yellow',
    width: 104,
    height: 96,
    connections: [
      { id: 'dc-pos', x: 0,   y: 40, dir: 'left',   domain: 'DC', label: 'DC+' },
      { id: 'dc-neg', x: 0,   y: 56, dir: 'left',   domain: 'DC', label: 'DC−' },
      { id: 'egc',    x: 52,  y: 96, dir: 'bottom', domain: 'GND' },
    ],
    labelAnchor: { x: 52, y: -20, anchor: 'middle', baseline: 'auto' },
    svg: (opts = {}) => {
      const model = (opts.model as string) || 'BATTERY STORAGE';
      const kwh   = (opts.kwh   as number) || 0;
      const clr   = T.BAT_CLR;
      const p: string[] = [];

      p.push(p_rect(0, 0, 104, 80, { stroke: clr }));
      p.push(sym_header(0, 0, 104, 'DC-COUPLED BATTERY', clr));
      p.push(sym_domain_badge(104, 0, 'DC'));

      // IEC 60617 cell stack (3 cells)
      const cx = 52, cy = 42;
      for (let i = 0; i < 3; i++) {
        const lx = cx - 14 + i * 10;
        p.push(p_line(lx, cy - 12, lx, cy + 12, { stroke: clr, sw: 2.5 }));
        if (i < 2) p.push(p_line(lx + 5, cy - 7, lx + 5, cy + 7, { stroke: clr, sw: 1.5 }));
      }
      p.push(p_text(cx - 22, cy + 4, '−', { sz: 10, bold: true, fill: clr }));
      p.push(p_text(cx + 22, cy + 4, '+', { sz: 10, bold: true, fill: clr }));

      // DC +/- stubs
      p.push(p_line(0, 40, 6, 40, { stroke: clr, sw: T.SW_PRIMARY }));
      p.push(sym_lug(6, 40, clr));
      p.push(p_text(14, 38, '+', { sz: 7, bold: true, fill: clr, anchor: 'start' }));
      p.push(p_line(0, 56, 6, 56, { stroke: clr, sw: T.SW_PRIMARY }));
      p.push(sym_lug(6, 56, clr));
      p.push(p_text(14, 59, '−', { sz: 7, bold: true, fill: clr, anchor: 'start' }));

      // EGC
      p.push(p_line(52, 80, 52, 96, { stroke: T.GND, sw: T.SW_SECONDARY }));
      p.push(sym_ground(52, 96));

      // Labels
      p.push(p_text(52, -8, 'BATTERY STORAGE', { sz: 7.5, anchor: 'middle', bold: true, fill: clr }));
      p.push(p_text(52, 90, model.substring(0, 24), { sz: 5.5, anchor: 'middle', italic: true }));
      if (kwh > 0) p.push(p_text(52, 99, `${kwh} kWh`, { sz: 6.5, anchor: 'middle', bold: true, fill: clr }));

      return svg_wrap(104, 108, p.join(''));
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 14. BATTERY — AC-COUPLED (ESS)
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'battery-ac',
    label: 'Battery — AC-Coupled (ESS)',
    sub: 'IEC 60617 cell stack — AC OUT port connects on AC bus',
    domain: 'BOTH',
    badge: 'hasBattery (AC)',
    badgeColor: 'yellow',
    width: 104,
    height: 96,
    connections: [
      { id: 'ac-out', x: 52,  y: 96, dir: 'bottom', domain: 'AC',  label: 'AC OUT' },
      { id: 'egc',    x: 0,   y: 48, dir: 'left',   domain: 'GND' },
    ],
    labelAnchor: { x: 52, y: -20, anchor: 'middle', baseline: 'auto' },
    svg: (opts = {}) => {
      const model     = (opts.model     as string) || 'BATTERY STORAGE';
      const kwh       = (opts.kwh       as number) || 0;
      const backfeedA = (opts.backfeedA as number) || 0;
      const clr       = T.BAT_CLR;
      const p: string[] = [];

      p.push(p_rect(0, 0, 104, 80, { stroke: clr }));
      p.push(sym_header(0, 0, 104, 'AC-COUPLED BATTERY', clr));

      // Domain badge both
      p.push(p_rect(82, 3, 20, 9, { fill: '#555', stroke: 'none', sw: 0, r: 2 }));
      p.push(p_text(92, 10, 'AC/DC', { sz: 4.5, fill: T.WHITE, anchor: 'middle', bold: true }));

      // IEC cell stack
      const cx = 52, cy = 42;
      for (let i = 0; i < 3; i++) {
        const lx = cx - 14 + i * 10;
        p.push(p_line(lx, cy - 12, lx, cy + 12, { stroke: clr, sw: 2.5 }));
        if (i < 2) p.push(p_line(lx + 5, cy - 7, lx + 5, cy + 7, { stroke: clr, sw: 1.5 }));
      }
      p.push(p_text(cx - 22, cy + 4, '−', { sz: 10, bold: true, fill: clr }));
      p.push(p_text(cx + 22, cy + 4, '+', { sz: 10, bold: true, fill: clr }));

      // AC OUT lug (bottom)
      p.push(sym_lug(52, 76, T.AC_CLR));
      p.push(p_line(52, 76, 52, 80, { stroke: T.AC_CLR, sw: T.SW_SECONDARY }));
      p.push(p_line(52, 80, 52, 96, { stroke: T.AC_CLR, sw: T.SW_PRIMARY }));
      p.push(p_text(52, 88, 'AC OUT', { sz: 4, anchor: 'middle', fill: T.AC_CLR }));
      p.push(sym_arrow(52, 86, 'down', T.AC_CLR));

      // Labels
      p.push(p_text(52, -8, 'BATTERY STORAGE', { sz: 7.5, anchor: 'middle', bold: true, fill: clr }));
      p.push(p_text(52, 99, model.substring(0, 24), { sz: 5.5, anchor: 'middle', italic: true }));
      if (kwh > 0)       p.push(p_text(52, 108, `${kwh} kWh`, { sz: 6.5, anchor: 'middle', bold: true, fill: clr }));
      if (backfeedA > 0) p.push(p_text(52, 117, `${backfeedA}A BACKFEED — NEC 705.12(B)`, { sz: 5.5, anchor: 'middle', fill: clr }));

      return svg_wrap(104, 120, p.join(''));
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 15. BUI — ENPHASE IQ SC3
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'bui-enphase',
    label: 'BUI — Enphase IQ System Controller 3',
    sub: 'GRID + GEN + LOAD + BATTERY ports — dual transfer switch',
    domain: 'AC',
    badge: 'hasBattery (Enphase)',
    badgeColor: 'yellow',
    width: 128,
    height: 112,
    connections: [
      { id: 'grid',    x: 0,   y: 40, dir: 'left',   domain: 'AC', label: 'GRID IN' },
      { id: 'gen',     x: 0,   y: 72, dir: 'left',   domain: 'AC', label: 'GEN IN' },
      { id: 'load',    x: 128, y: 56, dir: 'right',  domain: 'AC', label: 'LOAD OUT' },
      { id: 'battery', x: 64,  y: 112, dir: 'bottom', domain: 'AC', label: 'BATTERY' },
    ],
    labelAnchor: { x: 64, y: -20, anchor: 'middle', baseline: 'auto' },
    svg: (opts = {}) => {
      const brand  = (opts.brand  as string) || 'Enphase';
      const model  = (opts.model  as string) || 'IQ System Controller 3';
      const amps   = (opts.amps   as number) || 200;
      const hasGen = opts.hasGen as boolean;
      const clr    = T.BUI_ENP;
      const p: string[] = [];

      p.push(p_rect(0, 0, 128, 96, { stroke: clr }));
      p.push(sym_header(0, 0, 128, 'IQ SYSTEM CONTROLLER 3', clr));
      p.push(sym_domain_badge(128, 0, 'AC'));

      // GRID lug
      p.push(sym_lug(8, 40, clr));
      p.push(p_text(8, 32, 'GRID', { sz: 4.5, anchor: 'middle', fill: '#555' }));
      p.push(p_line(0, 40, 8, 40, { stroke: clr, sw: T.SW_PRIMARY }));

      // GEN lug
      if (hasGen) {
        p.push(sym_lug(8, 72, T.GEN_CLR));
        p.push(p_text(8, 82, 'GEN', { sz: 4.5, anchor: 'middle', fill: T.GEN_CLR }));
        p.push(p_line(0, 72, 8, 72, { stroke: T.GEN_CLR, sw: T.SW_PRIMARY }));
      }

      // GRID blade closed
      p.push(p_line(11, 40, 50, 40, { stroke: clr, sw: T.SW_SECONDARY }));
      p.push(p_circle(11, 40, 2.5, { fill: clr, stroke: clr, sw: 0 }));
      p.push(p_circle(50, 40, 2.5, { fill: T.WHITE, stroke: clr, sw: T.SW_SECONDARY }));

      // GEN blade open
      if (hasGen) {
        p.push(p_line(11, 72, 34, 60, { stroke: T.GEN_CLR, sw: T.SW_SECONDARY }));
        p.push(p_circle(11, 72, 2.5, { fill: T.GEN_CLR, stroke: T.GEN_CLR, sw: 0 }));
        p.push(p_circle(50, 72, 2.5, { fill: T.WHITE, stroke: T.GEN_CLR, sw: T.SW_SECONDARY }));
      }

      // Internal bus
      const busX = 66;
      p.push(p_line(busX, 40, busX, hasGen ? 72 : 56, { stroke: clr, sw: 2.5 }));
      p.push(p_line(50, 40, busX, 40, { stroke: clr, sw: T.SW_SECONDARY }));
      if (hasGen) p.push(p_line(50, 72, busX, 72, { stroke: clr, sw: T.SW_SECONDARY }));

      // LOAD port right
      p.push(sym_lug(120, 56, clr));
      p.push(p_text(120, 48, 'LOAD', { sz: 4.5, anchor: 'middle', fill: '#555' }));
      p.push(p_line(busX, 56, 120, 56, { stroke: clr, sw: T.SW_SECONDARY }));
      p.push(p_line(120, 56, 128, 56, { stroke: clr, sw: T.SW_PRIMARY }));
      p.push(sym_arrow(124, 56, 'right', clr));

      // BATTERY port bottom
      p.push(sym_lug(64, 92, clr));
      p.push(p_text(64, 104, 'BATTERY', { sz: 4.5, anchor: 'middle', fill: clr }));
      p.push(p_line(64, 92, 64, 96, { stroke: clr, sw: T.SW_SECONDARY }));
      p.push(p_line(64, 96, 64, 112, { stroke: clr, sw: T.SW_PRIMARY, dash: '5,2' }));

      // Labels
      p.push(p_text(64, -8, `${brand} ${model}`, { sz: 7, anchor: 'middle', bold: true, fill: clr }));
      p.push(p_text(64, 106, `${amps}A`, { sz: 6, anchor: 'middle', bold: true, fill: clr }));
      p.push(p_text(64, 114, 'NEC 706 / NEC 230.82 / UL 1741-SA', { sz: 5, anchor: 'middle', italic: true }));

      return svg_wrap(128, 124, p.join(''));
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 16. GENERATOR
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'generator',
    label: 'Standby Generator',
    sub: 'IEEE 315 — circle with G + sine wave, NEC 702',
    domain: 'AC',
    badge: 'generatorKw > 0',
    badgeColor: 'yellow',
    width: 96,
    height: 96,
    connections: [
      { id: 'ac-out', x: 96, y: 48, dir: 'right', domain: 'AC', label: 'GEN OUT' },
      { id: 'egc',    x: 48, y: 96, dir: 'bottom', domain: 'GND' },
    ],
    labelAnchor: { x: 48, y: -24, anchor: 'middle', baseline: 'auto' },
    svg: (opts = {}) => {
      const brand = (opts.brand as string) || '';
      const model = (opts.model as string) || '';
      const kw    = (opts.kw    as number) || 0;
      const clr   = T.GEN_CLR;
      const p: string[] = [];

      p.push(p_circle(48, 48, 36, { stroke: clr }));
      p.push(p_text(48, 52, 'G', { sz: 18, bold: true, fill: clr, anchor: 'middle' }));
      // Sine wave inside
      p.push(sym_sine(48, 62, 18, 5));

      // GEN OUT lug
      p.push(sym_lug(84, 48, clr));
      p.push(p_line(84, 48, 96, 48, { stroke: clr, sw: T.SW_PRIMARY }));
      p.push(sym_arrow(90, 48, 'right', clr));
      p.push(p_text(85, 41, 'GEN OUT', { sz: 4, anchor: 'start', fill: clr }));

      // EGC
      p.push(p_line(48, 84, 48, 96, { stroke: T.GND, sw: T.SW_SECONDARY }));
      p.push(sym_ground(48, 96));

      // Labels
      p.push(p_text(48, -12, 'STANDBY GENERATOR', { sz: 7.5, anchor: 'middle', bold: true, fill: clr }));
      if (brand || model) p.push(p_text(48, -2, `${brand} ${model}`.trim(), { sz: 6.5, anchor: 'middle', fill: clr }));
      if (kw > 0) p.push(p_text(48, 100, `${kw} kW / ${Math.round(kw * 1000 / 240)}A`, { sz: 6.5, anchor: 'middle', bold: true, fill: clr }));
      p.push(p_text(48, 110, 'NEC 702.5 — TRANSFER EQUIP. REQ.', { sz: 5.5, anchor: 'middle', italic: true, fill: clr }));

      return svg_wrap(96, 120, p.join(''));
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 17. ATS — AUTOMATIC TRANSFER SWITCH
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'ats',
    label: 'ATS — Automatic Transfer Switch',
    sub: 'UTIL + GEN inputs, LOAD output — NEC 702.5',
    domain: 'AC',
    badge: 'generatorKw > 0',
    badgeColor: 'yellow',
    width: 120,
    height: 96,
    connections: [
      { id: 'util-in', x: 0,   y: 32, dir: 'left',   domain: 'AC', label: 'UTIL IN' },
      { id: 'gen-in',  x: 0,   y: 64, dir: 'left',   domain: 'AC', label: 'GEN IN' },
      { id: 'load-out', x: 120, y: 48, dir: 'right',  domain: 'AC', label: 'LOAD OUT' },
      { id: 'egc',     x: 60,  y: 96, dir: 'bottom', domain: 'GND' },
    ],
    labelAnchor: { x: 60, y: -20, anchor: 'middle', baseline: 'auto' },
    svg: (opts = {}) => {
      const brand  = (opts.brand  as string) || '';
      const amps   = (opts.amps   as number) || 200;
      const clr    = T.ATS_CLR;
      const p: string[] = [];

      p.push(p_rect(0, 0, 120, 80, { stroke: clr }));
      p.push(sym_header(0, 0, 120, 'AUTO TRANSFER SWITCH', clr));
      p.push(sym_domain_badge(120, 0, 'AC'));

      // UTIL lug
      p.push(sym_lug(8, 32, clr));
      p.push(p_text(8, 24, 'UTIL', { sz: 4.5, anchor: 'middle', fill: '#555' }));
      p.push(p_line(0, 32, 8, 32, { stroke: clr, sw: T.SW_PRIMARY }));

      // GEN lug
      p.push(sym_lug(8, 64, T.GEN_CLR));
      p.push(p_text(8, 74, 'GEN', { sz: 4.5, anchor: 'middle', fill: T.GEN_CLR }));
      p.push(p_line(0, 64, 8, 64, { stroke: T.GEN_CLR, sw: T.SW_PRIMARY }));

      // UTIL blade — closed
      p.push(p_line(11, 32, 52, 32, { stroke: clr, sw: T.SW_SECONDARY }));
      p.push(p_circle(11, 32, 2.5, { fill: clr, stroke: clr, sw: 0 }));
      p.push(p_circle(52, 32, 2.5, { fill: T.WHITE, stroke: clr, sw: T.SW_SECONDARY }));

      // GEN blade — open (angled)
      p.push(p_line(11, 64, 36, 52, { stroke: T.GEN_CLR, sw: T.SW_SECONDARY }));
      p.push(p_circle(11, 64, 2.5, { fill: T.GEN_CLR, stroke: T.GEN_CLR, sw: 0 }));
      p.push(p_circle(52, 64, 2.5, { fill: T.WHITE, stroke: T.GEN_CLR, sw: T.SW_SECONDARY }));

      // Internal bus
      const busX = 68;
      p.push(p_line(busX, 32, busX, 64, { stroke: clr, sw: 2.5 }));
      p.push(p_line(52, 32, busX, 32, { stroke: clr, sw: T.SW_SECONDARY }));
      p.push(p_line(52, 64, busX, 64, { stroke: clr, sw: T.SW_SECONDARY }));

      // LOAD lug right
      p.push(sym_lug(112, 48, clr));
      p.push(p_text(112, 40, 'LOAD', { sz: 4.5, anchor: 'middle', fill: '#555' }));
      p.push(p_line(busX, 48, 112, 48, { stroke: clr, sw: T.SW_SECONDARY }));
      p.push(p_line(112, 48, 120, 48, { stroke: clr, sw: T.SW_PRIMARY }));
      p.push(sym_arrow(116, 48, 'right', clr));

      // EGC
      p.push(p_line(60, 80, 60, 96, { stroke: T.GND, sw: T.SW_SECONDARY }));
      p.push(sym_ground(60, 96));

      // Labels
      p.push(p_text(60, -8, 'AUTO TRANSFER SWITCH', { sz: 7.5, anchor: 'middle', bold: true, fill: clr }));
      if (brand) p.push(p_text(60, 88, brand, { sz: 5.5, anchor: 'middle', italic: true }));
      p.push(p_text(60, 97, `${amps}A RATED`, { sz: 6, anchor: 'middle', bold: true, fill: clr }));
      p.push(p_text(60, 106, 'NEC 702.5 — AUTO TRANSFER', { sz: 5.5, anchor: 'middle', italic: true, fill: clr }));

      return svg_wrap(120, 116, p.join(''));
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 18. AC COMBINER (microinverter)
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'ac-combiner',
    label: 'AC Combiner',
    sub: 'Branch breakers → combiner bus → feeder — microinverter',
    domain: 'AC',
    badge: 'Micro only',
    badgeColor: 'purple',
    width: 112,
    height: 96,
    connections: [
      { id: 'branch-1', x: 24,  y: 0,  dir: 'top',   domain: 'AC', label: 'BR-1' },
      { id: 'branch-2', x: 56,  y: 0,  dir: 'top',   domain: 'AC', label: 'BR-2' },
      { id: 'branch-3', x: 88,  y: 0,  dir: 'top',   domain: 'AC', label: 'BR-3' },
      { id: 'feeder',   x: 112, y: 64, dir: 'right', domain: 'AC', label: 'FEEDER' },
    ],
    labelAnchor: { x: 56, y: 100, anchor: 'middle', baseline: 'hanging' },
    svg: (opts = {}) => {
      const branches = (opts.branches as number) || 3;
      const ocpd     = (opts.ocpd     as number) || 20;
      const label    = (opts.label    as string) || 'AC COMBINER';
      const p: string[] = [];

      p.push(p_rect(0, 16, 112, 72));
      p.push(sym_header(0, 16, 112, label));
      p.push(sym_domain_badge(112, 16, 'AC'));

      // Branch breakers (up to 3 shown)
      const bxPositions = [24, 56, 88];
      for (let i = 0; i < Math.min(branches, 3); i++) {
        const bx = bxPositions[i];
        p.push(p_line(bx, 0, bx, 16, { stroke: T.AC_CLR, sw: T.SW_SECONDARY }));
        p.push(sym_breaker(bx, 38, 16, 10, ocpd, T.AC_CLR));
        p.push(p_line(bx, 44, bx, 64, { stroke: T.AC_CLR, sw: T.SW_SECONDARY }));
      }

      // Combiner bus
      p.push(sym_busbar(8, 104, 64, 'COMBINER BUS', T.AC_CLR));

      // Feeder lug
      p.push(sym_lug(104, 64, T.AC_CLR));
      p.push(p_line(104, 64, 112, 64, { stroke: T.AC_CLR, sw: T.SW_PRIMARY }));
      p.push(sym_arrow(108, 64, 'right', T.AC_CLR));

      p.push(p_text(56, 102, `${branches} branches / ${ocpd}A OCPD ea.`, { sz: 6, anchor: 'middle', fill: T.AC_CLR }));

      return svg_wrap(120, 112, p.join(''));
    },
  },
];

// ─── Export helpers ───────────────────────────────────────────────────────────

/** Get a symbol by ID */
export function getSymbol(id: string): SLDSymbol | undefined {
  return SLD_SYMBOLS.find(s => s.id === id);
}

/** Render a symbol with options, returns SVG string */
export function renderSymbol(id: string, opts?: Record<string, string | number | boolean>): string {
  const sym = getSymbol(id);
  if (!sym) return `<!-- SLD symbol "${id}" not found -->`;
  return sym.svg(opts);
}

/** Line type system */
export const LINE_TYPES = {
  AC_CONDUCTOR:    { stroke: T.AC_CLR,  sw: 2,   dash: undefined, label: 'AC Conductor in Conduit',       sub: 'THWN-2 — solid 2px blue' },
  DC_CONDUCTOR:    { stroke: T.DC_CLR,  sw: 1.5, dash: undefined, label: 'DC Conductor in Conduit',       sub: 'USE-2/PV Wire — solid 1.5px orange' },
  OPEN_AIR:        { stroke: T.GND,     sw: 1.5, dash: '10,5',    label: 'Open Air — PV Wire/THWN-2',     sub: 'NEC 690.31 — long-dash green' },
  EGC:             { stroke: T.GND,     sw: 1.5, dash: undefined, label: 'Equipment Grounding Conductor',  sub: 'NEC 250.122 — solid green' },
  BATTERY_AC:      { stroke: T.BAT_CLR, sw: 1.5, dash: '6,3',    label: 'Battery AC-Coupled Connection', sub: 'AC OUT → BUI BATTERY port — dashed blue' },
  GENERATOR_OUT:   { stroke: T.GEN_CLR, sw: 2,   dash: undefined, label: 'Generator Output Conductor',    sub: 'Gen → BUI GEN port / ATS — solid green' },
  ATS_TRANSFER:    { stroke: T.ATS_CLR, sw: 2,   dash: undefined, label: 'ATS Transfer Conductor',        sub: 'ATS LOAD → MSP — solid orange' },
  BACKUP_FEEDER:   { stroke: T.SUB_CLR, sw: 1.5, dash: undefined, label: 'Backup Sub-Panel Feeder',       sub: 'BUI LOAD → Sub-Panel — solid purple' },
  COMMUNICATION:   { stroke: '#888888', sw: 1,   dash: '4,3',    label: 'Communication / Control',        sub: 'Signal wiring — short-dash gray' },
} as const;

export const DESIGN_TOKENS = T;