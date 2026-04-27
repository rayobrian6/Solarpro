// ============================================================
// SLD Symbol System — Engineering Grade v2.0
// IEEE 315 / ANSI Y32.9 / NEC-aligned
// Utility-recognizable, permit-ready
//
// DESIGN SYSTEM:
//   Primary stroke:   2.5px  (enclosures, main conductors)
//   Secondary stroke: 2px    (internal details)
//   Hair stroke:      1px    (fine detail)
//   Bus stroke:       5px    (busbars)
//   Grid unit:        8px
//   Min font:         10px   (all labels readable at 1x)
//   Corner radius:    3px
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
  SW_PRIMARY:   2.5,
  SW_SECONDARY: 2,
  SW_HAIR:      1,
  SW_BUS:       5,
  BLACK:   '#1A1A1A',
  WHITE:   '#FFFFFF',
  GND:     '#1B5E20',
  DC_CLR:  '#BF360C',
  AC_CLR:  '#0D3B7A',
  BAT_CLR: '#1565C0',
  GEN_CLR: '#2E7D32',
  ATS_CLR: '#E65100',
  BUI_ENP: '#0D47A1',
  SUB_CLR: '#6A1B9A',
  GRAY:    '#555555',
  R: 3,
  GRID: 8,
};

// ─── SVG Primitives ──────────────────────────────────────────────────────────
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
  const { sz = 11, fill = T.BLACK, anchor = 'middle', bold = false, italic = false } = opts;
  let s = `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${sz}" fill="${fill}"`;
  if (bold)   s += ' font-weight="bold"';
  if (italic) s += ' font-style="italic"';
  s += `>${text}</text>`;
  return s;
}

// ─── SVG wrapper ─────────────────────────────────────────────────────────────
function svg_wrap(w: number, h: number, content: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="background:#fff;display:block;">${content}</svg>`;
}

// ─── Shared Sub-symbols ──────────────────────────────────────────────────────

/** IEEE 315 ground — 3 descending horizontal lines */
function sym_ground(x: number, y: number, clr = T.GND): string {
  return [
    p_line(x, y,      x, y + 10,   { stroke: clr, sw: T.SW_PRIMARY }),
    p_line(x - 16, y + 10, x + 16, y + 10, { stroke: clr, sw: T.SW_PRIMARY }),
    p_line(x - 11, y + 16, x + 11, y + 16, { stroke: clr, sw: T.SW_SECONDARY }),
    p_line(x - 6,  y + 22, x + 6,  y + 22, { stroke: clr, sw: T.SW_SECONDARY }),
  ].join('');
}

/** Terminal lug: open circle with center dot */
function sym_lug(cx: number, cy: number, clr = T.BLACK): string {
  return p_circle(cx, cy, 5, { fill: T.WHITE, stroke: clr, sw: T.SW_SECONDARY })
       + p_circle(cx, cy, 2, { fill: clr, stroke: clr, sw: 0 });
}

/** Directional filled arrow */
function sym_arrow(x: number, y: number, dir: 'right' | 'left' | 'down' | 'up', clr = T.BLACK, sz = 7): string {
  let d = '';
  if (dir === 'right') d = `M${x},${y - sz/2} L${x + sz},${y} L${x},${y + sz/2}`;
  if (dir === 'left')  d = `M${x},${y - sz/2} L${x - sz},${y} L${x},${y + sz/2}`;
  if (dir === 'down')  d = `M${x - sz/2},${y} L${x},${y + sz} L${x + sz/2},${y}`;
  if (dir === 'up')    d = `M${x - sz/2},${y} L${x},${y - sz} L${x + sz/2},${y}`;
  return p_path(d, { fill: clr, stroke: clr, sw: 1 });
}

/** Sine wave path */
function sym_sine(cx: number, cy: number, w = 32, h = 10): string {
  return p_path(
    `M${cx - w/2},${cy} Q${cx - w/4},${cy - h} ${cx},${cy} Q${cx + w/4},${cy + h} ${cx + w/2},${cy}`,
    { stroke: T.BLACK, sw: T.SW_SECONDARY }
  );
}

/** DC flat bars marker (two parallel horizontal lines) */
function sym_dc_bars(cx: number, cy: number, w = 24): string {
  return p_line(cx - w/2, cy - 5, cx + w/2, cy - 5, { stroke: T.BLACK, sw: T.SW_SECONDARY })
       + p_line(cx - w/2, cy + 5, cx + w/2, cy + 5, { stroke: T.BLACK, sw: T.SW_SECONDARY });
}

/** IEEE 315 fuse: rectangle with leads */
function sym_fuse(cx: number, cy: number, w = 24, h = 12): string {
  return [
    p_line(cx - w/2 - 12, cy, cx - w/2, cy, { sw: T.SW_SECONDARY }),
    p_rect(cx - w/2, cy - h/2, w, h, { sw: T.SW_SECONDARY, r: 2 }),
    p_line(cx + w/2, cy, cx + w/2 + 12, cy, { sw: T.SW_SECONDARY }),
  ].join('');
}

/** Circuit breaker: rectangle + arc inside */
function sym_breaker(cx: number, cy: number, w = 32, h = 22, amps?: number, clr = T.BLACK): string {
  const parts = [
    p_rect(cx - w/2, cy - h/2, w, h, { stroke: clr, sw: T.SW_SECONDARY }),
    p_path(`M${cx - 8},${cy + 5} Q${cx},${cy - 10} ${cx + 8},${cy + 5}`,
      { stroke: clr, sw: T.SW_HAIR }),
  ];
  if (amps) parts.push(
    p_text(cx, cy + h/2 + 13, `${amps}A`, { sz: 11, anchor: 'middle', bold: true, fill: clr })
  );
  return parts.join('');
}

/** Open-blade knife switch (IEEE 315) */
function sym_knife_switch(lx: number, cy: number, sw_w = 52, clr = T.BLACK): string {
  return [
    p_line(lx, cy, lx + 12, cy, { stroke: clr, sw: T.SW_SECONDARY }),
    p_circle(lx + 12, cy, 4, { fill: clr, stroke: clr, sw: 0 }),
    p_line(lx + 12, cy, lx + sw_w - 12, cy - 16, { stroke: clr, sw: T.SW_SECONDARY }),
    p_circle(lx + sw_w - 12, cy, 4, { fill: T.WHITE, stroke: clr, sw: T.SW_SECONDARY }),
    p_line(lx + sw_w - 12, cy, lx + sw_w, cy, { stroke: clr, sw: T.SW_SECONDARY }),
  ].join('');
}

/** Section header bar */
function sym_header(bx: number, by: number, bw: number, text: string, clr = T.BLACK): string {
  return p_rect(bx, by, bw, 20, { fill: clr, stroke: clr, sw: 0, r: T.R })
       + p_text(bx + bw/2, by + 14, text, { sz: 10, fill: T.WHITE, anchor: 'middle', bold: true });
}

/** Voltage domain badge pill */
function sym_domain_badge(rx: number, ty: number, domain: 'AC' | 'DC' | 'BOTH'): string {
  const clr = domain === 'DC' ? T.DC_CLR : domain === 'AC' ? T.AC_CLR : '#444';
  return p_rect(rx - 30, ty + 3, 28, 14, { fill: clr, stroke: 'none', sw: 0, r: 3 })
       + p_text(rx - 16, ty + 13, domain, { sz: 8, fill: T.WHITE, anchor: 'middle', bold: true });
}

/** Busbar: heavy horizontal line with label */
function sym_busbar(x1: number, x2: number, y: number, label?: string, clr = T.BLACK): string {
  const parts = [p_line(x1, y, x2, y, { stroke: clr, sw: T.SW_BUS, cap: 'square' })];
  if (label) parts.push(p_text((x1 + x2)/2, y - 8, label, { sz: 10, anchor: 'middle', bold: true, fill: clr }));
  return parts.join('');
}

// ══════════════════════════════════════════════════════════════════════════════
// SYMBOL DEFINITIONS
// ══════════════════════════════════════════════════════════════════════════════

export const SLD_SYMBOLS: SLDSymbol[] = [

  // ── 1. GROUND ──────────────────────────────────────────────────────────────
  {
    id: 'ground',
    label: 'Ground',
    sub: 'IEEE 315 — EGC / GES / System Ground',
    domain: 'GND',
    badge: 'Always',
    badgeColor: 'blue',
    width: 72,
    height: 64,
    connections: [{ id: 'in', x: 36, y: 0, dir: 'top', domain: 'GND' }],
    labelAnchor: { x: 36, y: 68, anchor: 'middle', baseline: 'hanging' },
    svg: () => svg_wrap(72, 64,
      p_line(36, 0, 36, 12, { stroke: T.GND, sw: T.SW_PRIMARY })
      + sym_ground(36, 12, T.GND)
      + p_text(36, 56, 'GND', { sz: 11, fill: T.GND, anchor: 'middle', bold: true })
    ),
  },

  // ── 2. FUSE ────────────────────────────────────────────────────────────────
  {
    id: 'fuse',
    label: 'Fuse (Inline)',
    sub: 'IEEE 315 — rectangular fuse symbol',
    domain: 'DC',
    badge: 'String only',
    badgeColor: 'green',
    width: 96,
    height: 40,
    connections: [
      { id: 'line', x: 0,  y: 20, dir: 'left',  domain: 'DC' },
      { id: 'load', x: 96, y: 20, dir: 'right', domain: 'DC' },
    ],
    labelAnchor: { x: 48, y: 38, anchor: 'middle', baseline: 'hanging' },
    svg: (opts = {}) => {
      const amps = opts.amps as number | undefined;
      return svg_wrap(96, 40,
        sym_fuse(48, 20, 32, 16)
        + (amps ? p_text(48, 38, `${amps}A`, { sz: 10, fill: T.DC_CLR, anchor: 'middle', bold: true }) : '')
      );
    },
  },

  // ── 3. CIRCUIT BREAKER ─────────────────────────────────────────────────────
  {
    id: 'breaker',
    label: 'Circuit Breaker',
    sub: 'IEEE 315 — rectangle + internal arc',
    domain: 'AC',
    badge: 'Always',
    badgeColor: 'blue',
    width: 96,
    height: 56,
    connections: [
      { id: 'line', x: 0,  y: 28, dir: 'left',  domain: 'AC' },
      { id: 'load', x: 96, y: 28, dir: 'right', domain: 'AC' },
    ],
    labelAnchor: { x: 48, y: 54, anchor: 'middle', baseline: 'hanging' },
    svg: (opts = {}) => {
      const amps = opts.amps as number | undefined;
      return svg_wrap(96, 56,
        p_line(0, 28, 18, 28, { sw: T.SW_SECONDARY })
        + sym_breaker(48, 28, 36, 24, amps)
        + p_line(66, 28, 96, 28, { sw: T.SW_SECONDARY })
      );
    },
  },

  // ── 4. JUNCTION BOX ────────────────────────────────────────────────────────
  {
    id: 'jbox',
    label: 'Junction Box',
    sub: 'DC/AC roof junction — multiple connection points',
    domain: 'BOTH',
    badge: 'Always',
    badgeColor: 'blue',
    width: 120,
    height: 120,
    connections: [
      { id: 'left',   x: 0,   y: 60, dir: 'left',   domain: 'DC', label: 'IN' },
      { id: 'right',  x: 120, y: 60, dir: 'right',  domain: 'DC', label: 'OUT' },
      { id: 'top',    x: 60,  y: 0,  dir: 'top',    domain: 'DC' },
      { id: 'bottom', x: 60,  y: 120, dir: 'bottom', domain: 'DC' },
    ],
    labelAnchor: { x: 60, y: -16, anchor: 'middle', baseline: 'auto' },
    svg: (opts = {}) => {
      const label = (opts.label as string) || 'ROOF J-BOX';
      const sub   = (opts.sub   as string) || 'DC JUNCTION';
      const p: string[] = [];
      p.push(p_rect(10, 10, 100, 100));
      p.push(p_line(20, 28, 100, 100, { sw: T.SW_HAIR }));
      p.push(p_line(100, 28, 20, 100, { sw: T.SW_HAIR }));
      p.push(p_line(0, 60, 10, 60, { sw: T.SW_SECONDARY }));
      p.push(p_line(110, 60, 120, 60, { sw: T.SW_SECONDARY }));
      p.push(sym_lug(10, 60)); p.push(sym_lug(110, 60));
      p.push(sym_header(10, 10, 100, label));
      p.push(p_text(60, 72, sub, { sz: 10, anchor: 'middle', italic: true }));
      return svg_wrap(120, 120, p.join(''));
    },
  },

  // ── 5. PV ARRAY ────────────────────────────────────────────────────────────
  {
    id: 'pv-array',
    label: 'PV Array',
    sub: '2×3 module grid — grouped source block',
    domain: 'DC',
    badge: 'Always',
    badgeColor: 'blue',
    width: 180,
    height: 164,
    connections: [
      { id: 'dc-pos', x: 180, y: 64, dir: 'right', domain: 'DC', label: 'DC+' },
      { id: 'dc-neg', x: 180, y: 88, dir: 'right', domain: 'DC', label: 'DC−' },
      { id: 'egc',    x: 90,  y: 164, dir: 'bottom', domain: 'GND', label: 'EGC' },
    ],
    labelAnchor: { x: 90, y: -20, anchor: 'middle', baseline: 'auto' },
    svg: (opts = {}) => {
      const modules = (opts.modules as number) || 18;
      const watts   = (opts.watts   as number) || 400;
      const model   = (opts.model   as string) || 'MODULE MODEL';
      const dcKw    = ((modules * watts) / 1000).toFixed(2);
      const p: string[] = [];
      p.push(p_rect(0, 0, 180, 140, { r: T.R }));
      p.push(sym_header(0, 0, 180, 'PV ARRAY'));
      p.push(sym_domain_badge(180, 0, 'DC'));
      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 3; col++) {
          const mx = 10 + col * 52;
          const my = 28 + row * 48;
          p.push(p_rect(mx, my, 44, 36, { sw: T.SW_SECONDARY }));
          p.push(p_line(mx, my + 36, mx + 44, my, { sw: T.SW_HAIR }));
        }
      }
      p.push(p_line(168, 64, 180, 64, { stroke: T.DC_CLR, sw: T.SW_PRIMARY }));
      p.push(p_text(160, 61, '+', { sz: 13, fill: T.DC_CLR, bold: true, anchor: 'middle' }));
      p.push(p_line(168, 88, 180, 88, { stroke: T.DC_CLR, sw: T.SW_PRIMARY }));
      p.push(p_text(160, 92, '−', { sz: 13, fill: T.DC_CLR, bold: true, anchor: 'middle' }));
      p.push(sym_arrow(174, 76, 'right', T.DC_CLR));
      p.push(p_line(90, 140, 90, 164, { stroke: T.GND, sw: T.SW_SECONDARY }));
      p.push(p_text(90, 126, `${modules} × ${watts}W = ${dcKw} kW DC`, { sz: 10, anchor: 'middle', fill: T.DC_CLR, bold: true }));
      p.push(p_text(90, 138, model, { sz: 9, anchor: 'middle', italic: true }));
      return svg_wrap(180, 164, p.join(''));
    },
  },

  // ── 6. INVERTER ────────────────────────────────────────────────────────────
  {
    id: 'inverter',
    label: 'Inverter',
    sub: 'DC input → AC output, MPPT inputs, sine wave indicator',
    domain: 'BOTH',
    badge: 'String only',
    badgeColor: 'green',
    width: 210,
    height: 164,
    connections: [
      { id: 'dc-in',  x: 0,   y: 80, dir: 'left',   domain: 'DC',  label: 'DC IN' },
      { id: 'ac-out', x: 210, y: 80, dir: 'right',  domain: 'AC',  label: 'AC OUT' },
      { id: 'egc',    x: 105, y: 164, dir: 'bottom', domain: 'GND', label: 'EGC' },
    ],
    labelAnchor: { x: 105, y: -20, anchor: 'middle', baseline: 'auto' },
    svg: (opts = {}) => {
      const mfr    = (opts.mfr    as string) || 'MANUFACTURER';
      const model  = (opts.model  as string) || 'MODEL NO.';
      const acKw   = (opts.acKw   as number) || 0;
      const acAmps = (opts.acAmps as number) || 0;
      const mppt   = Math.min((opts.mppt as number) || 2, 4);
      const topo   = (opts.topo   as string) || 'STRING INVERTER';
      const p: string[] = [];

      p.push(p_rect(0, 0, 200, 140));
      p.push(sym_header(0, 0, 200, topo));

      // DC / AC domain badges
      p.push(p_rect(4, 24, 30, 14, { fill: T.DC_CLR, stroke: 'none', sw: 0, r: 3 }));
      p.push(p_text(19, 34, 'DC', { sz: 9, fill: T.WHITE, anchor: 'middle', bold: true }));
      p.push(p_rect(166, 24, 30, 14, { fill: T.AC_CLR, stroke: 'none', sw: 0, r: 3 }));
      p.push(p_text(181, 34, 'AC', { sz: 9, fill: T.WHITE, anchor: 'middle', bold: true }));

      // Vertical divider
      p.push(p_line(100, 20, 100, 140, { sw: T.SW_HAIR, dash: '5,4' }));

      // DC side — flat bars
      p.push(sym_dc_bars(42, 80, 32));
      p.push(p_text(42, 100, 'DC', { sz: 12, fill: T.DC_CLR, anchor: 'middle', bold: true }));

      // Center arrow
      p.push(sym_arrow(100, 80, 'right', T.BLACK, 11));

      // AC side — sine wave
      p.push(sym_sine(160, 80, 40, 13));
      p.push(p_text(160, 100, 'AC', { sz: 12, fill: T.AC_CLR, anchor: 'middle', bold: true }));

      // MPPT dots on left edge
      const mpptSpacing = 24;
      const mpptStartY  = 80 - ((mppt - 1) * mpptSpacing) / 2;
      for (let i = 0; i < mppt; i++) {
        const my = mpptStartY + i * mpptSpacing;
        p.push(p_circle(0, my, 5, { fill: T.DC_CLR, stroke: T.DC_CLR, sw: 0 }));
        p.push(p_text(12, my + 4, `MPPT${i + 1}`, { sz: 8, fill: T.DC_CLR, anchor: 'start' }));
        p.push(p_line(5, my, 24, my, { stroke: T.DC_CLR, sw: T.SW_HAIR }));
      }

      // AC output lug + arrow
      p.push(sym_lug(200, 80, T.AC_CLR));
      p.push(p_line(200, 80, 210, 80, { stroke: T.AC_CLR, sw: T.SW_PRIMARY }));
      p.push(sym_arrow(206, 80, 'right', T.AC_CLR, 6));

      // DC input lug
      p.push(sym_lug(0, 80, T.DC_CLR));
      p.push(p_line(-10, 80, 0, 80, { stroke: T.DC_CLR, sw: T.SW_PRIMARY }));

      // EGC
      p.push(p_line(100, 140, 100, 164, { stroke: T.GND, sw: T.SW_SECONDARY }));

      // Labels
      p.push(p_text(100, 115, mfr, { sz: 10, anchor: 'middle', italic: true }));
      p.push(p_text(100, 128, model, { sz: 11, anchor: 'middle', bold: true }));
      if (acKw > 0) {
        p.push(p_text(100, 141, `${acKw} kW AC / ${acAmps}A`, { sz: 10, anchor: 'middle', fill: T.AC_CLR }));
      }

      return svg_wrap(210, 164, p.join(''));
    },
  },

  // ── 7. DC DISCONNECT ───────────────────────────────────────────────────────
  {
    id: 'dc-disconnect',
    label: 'DC Disconnect',
    sub: 'DC DISC — 2-pole fused, polarity marked',
    domain: 'DC',
    badge: 'String only',
    badgeColor: 'green',
    width: 160,
    height: 168,
    connections: [
      { id: 'line-pos', x: 0,   y: 60, dir: 'left',  domain: 'DC', label: 'LINE +' },
      { id: 'line-neg', x: 0,   y: 88, dir: 'left',  domain: 'DC', label: 'LINE −' },
      { id: 'load-pos', x: 160, y: 60, dir: 'right', domain: 'DC', label: 'LOAD +' },
      { id: 'load-neg', x: 160, y: 88, dir: 'right', domain: 'DC', label: 'LOAD −' },
      { id: 'egc',      x: 80,  y: 168, dir: 'bottom', domain: 'GND' },
    ],
    labelAnchor: { x: 80, y: -20, anchor: 'middle', baseline: 'auto' },
    svg: (opts = {}) => {
      const amps  = (opts.amps  as number) || 15;
      const label = (opts.label as string) || '(N) DC DISCONNECT';
      const rsd   = opts.rsd as boolean;
      const p: string[] = [];

      p.push(p_rect(0, 20, 160, 108));
      p.push(sym_header(0, 20, 160, 'DC DISCONNECT'));
      p.push(sym_domain_badge(160, 20, 'DC'));

      p.push(p_text(12, 57, '+', { sz: 13, fill: T.DC_CLR, bold: true, anchor: 'middle' }));
      p.push(p_text(12, 92, '−', { sz: 13, fill: T.DC_CLR, bold: true, anchor: 'middle' }));

      p.push(sym_lug(8, 60, T.DC_CLR)); p.push(p_line(0, 60, 8, 60, { stroke: T.DC_CLR, sw: T.SW_PRIMARY }));
      p.push(sym_lug(8, 88, T.DC_CLR)); p.push(p_line(0, 88, 8, 88, { stroke: T.DC_CLR, sw: T.SW_PRIMARY }));

      p.push(p_line(13, 60, 56, 60, { stroke: T.DC_CLR, sw: T.SW_HAIR }));
      p.push(p_line(13, 88, 56, 88, { stroke: T.DC_CLR, sw: T.SW_HAIR }));
      p.push(p_line(104, 60, 147, 60, { stroke: T.DC_CLR, sw: T.SW_HAIR }));
      p.push(p_line(104, 88, 147, 88, { stroke: T.DC_CLR, sw: T.SW_HAIR }));

      p.push(sym_fuse(80, 60, 36, 14)); p.push(sym_fuse(80, 88, 36, 14));

      p.push(sym_lug(152, 60, T.DC_CLR)); p.push(p_line(152, 60, 160, 60, { stroke: T.DC_CLR, sw: T.SW_PRIMARY }));
      p.push(sym_lug(152, 88, T.DC_CLR)); p.push(p_line(152, 88, 160, 88, { stroke: T.DC_CLR, sw: T.SW_PRIMARY }));

      p.push(p_line(80, 128, 80, 148, { stroke: T.GND, sw: T.SW_SECONDARY }));
      p.push(sym_ground(80, 148, T.GND));

      p.push(p_text(80, 10, label, { sz: 10, anchor: 'middle', bold: true }));
      p.push(p_text(80, 136, `${amps}A FUSED`, { sz: 10, anchor: 'middle', fill: T.DC_CLR }));
      if (rsd) p.push(p_text(80, 160, 'RAPID SHUTDOWN — NEC 690.12', { sz: 8, anchor: 'middle', italic: true, fill: T.GRAY }));

      return svg_wrap(160, 172, p.join(''));
    },
  },

  // ── 8. AC DISCONNECT ───────────────────────────────────────────────────────
  {
    id: 'ac-disconnect',
    label: 'AC Disconnect',
    sub: 'AC DISC — open-blade switch, non-fused',
    domain: 'AC',
    badge: 'Always',
    badgeColor: 'blue',
    width: 160,
    height: 160,
    connections: [
      { id: 'load-a', x: 0,   y: 60, dir: 'left',  domain: 'AC', label: 'LOAD A' },
      { id: 'load-b', x: 0,   y: 88, dir: 'left',  domain: 'AC', label: 'LOAD B' },
      { id: 'line-a', x: 160, y: 60, dir: 'right', domain: 'AC', label: 'LINE A' },
      { id: 'line-b', x: 160, y: 88, dir: 'right', domain: 'AC', label: 'LINE B' },
      { id: 'egc',    x: 80,  y: 160, dir: 'bottom', domain: 'GND' },
    ],
    labelAnchor: { x: 80, y: -20, anchor: 'middle', baseline: 'auto' },
    svg: (opts = {}) => {
      const amps  = (opts.amps  as number) || 30;
      const label = (opts.label as string) || '(N) AC DISCONNECT';
      const p: string[] = [];

      p.push(p_rect(0, 20, 160, 108));
      p.push(sym_header(0, 20, 160, 'AC DISCONNECT'));
      p.push(sym_domain_badge(160, 20, 'AC'));

      [60, 88].forEach(y => {
        p.push(sym_lug(8, y, T.AC_CLR));
        p.push(p_line(0, y, 8, y, { stroke: T.AC_CLR, sw: T.SW_PRIMARY }));
        p.push(sym_knife_switch(8, y, 108, T.AC_CLR));
        p.push(sym_lug(152, y, T.AC_CLR));
        p.push(p_line(116, y, 152, y, { stroke: T.AC_CLR, sw: T.SW_SECONDARY }));
        p.push(p_line(152, y, 160, y, { stroke: T.AC_CLR, sw: T.SW_PRIMARY }));
      });

      p.push(p_line(80, 128, 80, 148, { stroke: T.GND, sw: T.SW_SECONDARY }));
      p.push(sym_ground(80, 148));

      p.push(p_text(80, 10, label, { sz: 10, anchor: 'middle', bold: true }));
      p.push(p_text(80, 136, `${amps}A NON-FUSED`, { sz: 10, anchor: 'middle', fill: T.AC_CLR }));

      return svg_wrap(160, 160, p.join(''));
    },
  },

  // ── 9. FUSED DISCONNECT ────────────────────────────────────────────────────
  {
    id: 'fused-disconnect',
    label: 'Fused Disconnect (AC)',
    sub: 'AC DISC — open-blade switch with inline fuse',
    domain: 'AC',
    badge: 'Optional',
    badgeColor: 'yellow',
    width: 160,
    height: 160,
    connections: [
      { id: 'load-a', x: 0,   y: 60, dir: 'left',  domain: 'AC' },
      { id: 'load-b', x: 0,   y: 88, dir: 'left',  domain: 'AC' },
      { id: 'line-a', x: 160, y: 60, dir: 'right', domain: 'AC' },
      { id: 'line-b', x: 160, y: 88, dir: 'right', domain: 'AC' },
      { id: 'egc',    x: 80,  y: 160, dir: 'bottom', domain: 'GND' },
    ],
    labelAnchor: { x: 80, y: -20, anchor: 'middle', baseline: 'auto' },
    svg: (opts = {}) => {
      const amps = (opts.amps as number) || 30;
      const p: string[] = [];

      p.push(p_rect(0, 20, 160, 108));
      p.push(sym_header(0, 20, 160, 'FUSED DISCONNECT'));
      p.push(sym_domain_badge(160, 20, 'AC'));

      [60, 88].forEach(y => {
        p.push(sym_lug(8, y, T.AC_CLR));
        p.push(p_line(0, y, 8, y, { stroke: T.AC_CLR, sw: T.SW_PRIMARY }));
        p.push(sym_knife_switch(8, y, 76, T.AC_CLR));
        p.push(sym_fuse(120, y, 26, 12));
        p.push(sym_lug(152, y, T.AC_CLR));
        p.push(p_line(133, y, 152, y, { stroke: T.AC_CLR, sw: T.SW_SECONDARY }));
        p.push(p_line(152, y, 160, y, { stroke: T.AC_CLR, sw: T.SW_PRIMARY }));
      });

      p.push(p_line(80, 128, 80, 148, { stroke: T.GND, sw: T.SW_SECONDARY }));
      p.push(sym_ground(80, 148));
      p.push(p_text(80, 10, '(N) FUSED DISCONNECT', { sz: 10, anchor: 'middle', bold: true }));
      p.push(p_text(80, 136, `${amps}A FUSED`, { sz: 10, anchor: 'middle', fill: T.AC_CLR }));

      return svg_wrap(160, 160, p.join(''));
    },
  },

  // ── 10. MSP ────────────────────────────────────────────────────────────────
  {
    id: 'msp',
    label: 'Main Service Panel (MSP)',
    sub: 'Enclosure + main breaker + bus + PV backfed breaker',
    domain: 'AC',
    badge: 'Always',
    badgeColor: 'blue',
    width: 200,
    height: 220,
    connections: [
      { id: 'pv-in',   x: 0,   y: 120, dir: 'left',   domain: 'AC',  label: 'PV IN (BKFD)' },
      { id: 'bus-out', x: 200, y: 96,  dir: 'right',  domain: 'AC',  label: 'BUS OUT' },
      { id: 'egc',     x: 100, y: 220, dir: 'bottom', domain: 'GND' },
    ],
    labelAnchor: { x: 100, y: -20, anchor: 'middle', baseline: 'auto' },
    svg: (opts = {}) => {
      const busAmps  = (opts.busAmps  as number) || 200;
      const mainAmps = (opts.mainAmps as number) || 200;
      const pvAmps   = (opts.pvAmps   as number) || 30;
      const rule120  = (opts.rule120  as string) || 'PASS ✓';
      const clr      = T.AC_CLR;
      const p: string[] = [];

      p.push(p_rect(0, 0, 200, 188, { stroke: clr }));
      p.push(sym_header(0, 0, 200, `MSP  ${busAmps}A BUS / ${mainAmps}A MAIN`, clr));
      p.push(sym_domain_badge(200, 0, 'AC'));

      // Service entry
      p.push(p_line(100, 20, 100, 44, { stroke: clr, sw: T.SW_SECONDARY }));
      p.push(p_text(100, 38, 'SERVICE ENTRANCE', { sz: 8, anchor: 'middle', fill: T.GRAY }));

      // Main breaker
      p.push(sym_breaker(100, 64, 44, 30, mainAmps, clr));
      p.push(p_line(100, 79, 100, 96, { stroke: clr, sw: T.SW_SECONDARY }));

      // Main bus
      p.push(sym_busbar(16, 184, 96, 'MAIN BUS', clr));

      // Bus-out lug right
      p.push(sym_lug(192, 96, clr));
      p.push(p_line(192, 96, 200, 96, { stroke: clr, sw: T.SW_PRIMARY }));

      // PV backfed breaker
      const pvBkX = 148;
      p.push(p_line(pvBkX, 96, pvBkX, 108, { stroke: clr, sw: T.SW_SECONDARY }));
      p.push(sym_breaker(pvBkX, 124, 32, 22, pvAmps, clr));
      p.push(sym_lug(pvBkX, 138, clr));
      p.push(p_line(pvBkX, 135, pvBkX, 138, { stroke: clr, sw: T.SW_SECONDARY }));
      p.push(p_line(0, 138, pvBkX, 138, { stroke: clr, sw: T.SW_SECONDARY }));
      p.push(p_line(0, 120, 0, 138, { stroke: clr, sw: T.SW_PRIMARY }));

      p.push(p_text(pvBkX, 152, 'NEC 705.12(B)', { sz: 8, anchor: 'middle', italic: true, fill: T.GRAY }));
      p.push(p_text(pvBkX, 164, `120%: ${rule120}`, { sz: 10, anchor: 'middle', bold: true, fill: rule120.includes('✓') ? T.GND : '#CC0000' }));

      // EGC
      p.push(p_line(100, 188, 100, 220, { stroke: T.GND, sw: T.SW_SECONDARY }));
      p.push(sym_ground(100, 220));

      p.push(p_text(100, -8, 'MSP / MAIN PANEL', { sz: 12, anchor: 'middle', bold: true }));

      return svg_wrap(200, 232, p.join(''));
    },
  },

  // ── 11. SUBPANEL ───────────────────────────────────────────────────────────
  {
    id: 'subpanel',
    label: 'Subpanel / Backup Panel',
    sub: 'SUB PANEL — critical loads, distinct from MSP',
    domain: 'AC',
    badge: 'hasBackupPanel',
    badgeColor: 'yellow',
    width: 160,
    height: 188,
    connections: [
      { id: 'feed-in', x: 0,  y: 96, dir: 'left',   domain: 'AC', label: 'FEED IN' },
      { id: 'egc',     x: 80, y: 188, dir: 'bottom', domain: 'GND' },
    ],
    labelAnchor: { x: 80, y: -20, anchor: 'middle', baseline: 'auto' },
    svg: (opts = {}) => {
      const amps  = (opts.amps  as number) || 100;
      const brand = (opts.brand as string) || '';
      const clr   = T.SUB_CLR;
      const p: string[] = [];

      p.push(p_rect(0, 0, 160, 160, { stroke: clr }));
      p.push(sym_header(0, 0, 160, 'SUB PANEL', clr));
      p.push(sym_domain_badge(160, 0, 'AC'));

      p.push(p_line(80, 20, 80, 36, { stroke: clr, sw: T.SW_SECONDARY }));
      p.push(p_text(80, 30, 'MAIN', { sz: 9, anchor: 'middle', bold: true, fill: clr }));
      p.push(sym_breaker(80, 54, 40, 26, amps, clr));
      p.push(p_line(80, 67, 80, 84, { stroke: clr, sw: T.SW_SECONDARY }));

      p.push(sym_busbar(12, 148, 84, 'CRIT. LOADS BUS', clr));

      [-28, 0, 28].forEach(off => {
        p.push(p_line(80 + off, 84, 80 + off, 96, { stroke: clr, sw: T.SW_SECONDARY }));
        p.push(sym_breaker(80 + off, 112, 22, 16, undefined, clr));
        p.push(p_line(80 + off, 120, 80 + off, 128, { stroke: clr, sw: T.SW_SECONDARY }));
      });

      p.push(sym_lug(0, 96, clr));
      p.push(p_line(0, 84, 0, 96, { stroke: clr, sw: T.SW_PRIMARY }));

      p.push(p_line(80, 160, 80, 188, { stroke: T.GND, sw: T.SW_SECONDARY }));
      p.push(sym_ground(80, 188, T.GND));

      p.push(p_text(80, -8, 'BACKUP SUB-PANEL', { sz: 12, anchor: 'middle', bold: true, fill: clr }));
      if (brand) p.push(p_text(80, 152, brand, { sz: 9, anchor: 'middle', italic: true }));
      p.push(p_text(80, 164, 'CRITICAL LOADS ONLY', { sz: 9, anchor: 'middle', fill: clr }));

      return svg_wrap(160, 196, p.join(''));
    },
  },

  // ── 12. UTILITY METER ──────────────────────────────────────────────────────
  {
    id: 'utility-meter',
    label: 'Utility Meter',
    sub: 'Circle with kWh — bi-directional meter',
    domain: 'AC',
    badge: 'Always',
    badgeColor: 'blue',
    width: 120,
    height: 248,
    connections: [
      { id: 'line-in',  x: 0,  y: 56, dir: 'left',   domain: 'AC' },
      { id: 'grid-out', x: 60, y: 248, dir: 'bottom', domain: 'AC' },
    ],
    labelAnchor: { x: 60, y: -20, anchor: 'middle', baseline: 'auto' },
    svg: (opts = {}) => {
      const utility = (opts.utility as string) || 'UTILITY';
      const p: string[] = [];

      p.push(p_circle(60, 56, 40));
      p.push(p_text(60, 50, 'kWh', { sz: 14, anchor: 'middle', bold: true }));
      p.push(p_text(60, 65, 'M', { sz: 12, anchor: 'middle' }));
      p.push(p_line(0, 56, 20, 56, { sw: T.SW_PRIMARY }));
      p.push(sym_arrow(16, 56, 'right'));

      p.push(p_line(60, 96, 60, 144, { sw: T.SW_PRIMARY }));
      p.push(sym_arrow(60, 120, 'down'));

      p.push(p_circle(60, 180, 32));
      p.push(p_text(60, 175, 'UTIL', { sz: 11, anchor: 'middle', bold: true }));
      p.push(p_text(60, 189, 'GRID', { sz: 10, anchor: 'middle' }));

      p.push(p_line(60, 212, 60, 226, { sw: T.SW_SECONDARY }));
      p.push(sym_ground(60, 226, T.GND));

      p.push(p_text(60, -10, 'UTILITY METER', { sz: 13, anchor: 'middle', bold: true }));
      p.push(p_text(60, 3, utility, { sz: 11, anchor: 'middle' }));

      return svg_wrap(120, 252, p.join(''));
    },
  },

  // ── 13. BATTERY DC-COUPLED ─────────────────────────────────────────────────
  {
    id: 'battery-dc',
    label: 'Battery — DC-Coupled',
    sub: 'IEC 60617 cell stack — connects on DC bus',
    domain: 'DC',
    badge: 'hasBattery (DC)',
    badgeColor: 'yellow',
    width: 160,
    height: 168,
    connections: [
      { id: 'dc-pos', x: 0,   y: 68,  dir: 'left',   domain: 'DC', label: 'DC+' },
      { id: 'dc-neg', x: 0,   y: 100, dir: 'left',   domain: 'DC', label: 'DC−' },
      { id: 'egc',    x: 80,  y: 168, dir: 'bottom', domain: 'GND' },
    ],
    labelAnchor: { x: 80, y: -20, anchor: 'middle', baseline: 'auto' },
    svg: (opts = {}) => {
      const model = (opts.model as string) || 'BATTERY STORAGE';
      const kwh   = (opts.kwh   as number) || 0;
      const clr   = T.BAT_CLR;
      const p: string[] = [];

      p.push(p_rect(0, 0, 160, 136, { stroke: clr }));
      p.push(sym_header(0, 0, 160, 'DC-COUPLED BATTERY', clr));
      p.push(sym_domain_badge(160, 0, 'DC'));

      // IEC 60617 cell stack: alternating long/short bars
      const cx = 80, cy = 72;
      const cells = [
        { x: cx - 24, h: 32 },
        { x: cx - 12, h: 20 },
        { x: cx,      h: 32 },
        { x: cx + 12, h: 20 },
        { x: cx + 24, h: 32 },
      ];
      cells.forEach(c => p.push(p_line(c.x, cy - c.h/2, c.x, cy + c.h/2, { stroke: clr, sw: 3.5 })));
      p.push(p_text(cx - 36, cy + 6, '−', { sz: 18, bold: true, fill: clr }));
      p.push(p_text(cx + 36, cy + 6, '+', { sz: 18, bold: true, fill: clr }));

      // DC stubs left
      p.push(p_line(0, 68, 8, 68, { stroke: clr, sw: T.SW_PRIMARY }));
      p.push(sym_lug(8, 68, clr));
      p.push(p_text(20, 65, '+', { sz: 13, bold: true, fill: clr, anchor: 'start' }));
      p.push(p_line(0, 100, 8, 100, { stroke: clr, sw: T.SW_PRIMARY }));
      p.push(sym_lug(8, 100, clr));
      p.push(p_text(20, 104, '−', { sz: 13, bold: true, fill: clr, anchor: 'start' }));

      // EGC
      p.push(p_line(80, 136, 80, 168, { stroke: T.GND, sw: T.SW_SECONDARY }));
      p.push(sym_ground(80, 168));

      p.push(p_text(80, -8, 'BATTERY STORAGE', { sz: 12, anchor: 'middle', bold: true, fill: clr }));
      p.push(p_text(80, 114, model.substring(0, 22), { sz: 9, anchor: 'middle', italic: true }));
      if (kwh > 0) p.push(p_text(80, 127, `${kwh} kWh`, { sz: 12, anchor: 'middle', bold: true, fill: clr }));

      return svg_wrap(160, 178, p.join(''));
    },
  },

  // ── 14. BATTERY AC-COUPLED ─────────────────────────────────────────────────
  {
    id: 'battery-ac',
    label: 'Battery — AC-Coupled (ESS)',
    sub: 'IEC 60617 cell stack — AC OUT port on AC bus',
    domain: 'BOTH',
    badge: 'hasBattery (AC)',
    badgeColor: 'yellow',
    width: 160,
    height: 168,
    connections: [
      { id: 'ac-out', x: 80,  y: 168, dir: 'bottom', domain: 'AC',  label: 'AC OUT' },
      { id: 'egc',    x: 0,   y: 84,  dir: 'left',   domain: 'GND' },
    ],
    labelAnchor: { x: 80, y: -20, anchor: 'middle', baseline: 'auto' },
    svg: (opts = {}) => {
      const model     = (opts.model     as string) || 'BATTERY STORAGE';
      const kwh       = (opts.kwh       as number) || 0;
      const backfeedA = (opts.backfeedA as number) || 0;
      const clr       = T.BAT_CLR;
      const p: string[] = [];

      p.push(p_rect(0, 0, 160, 136, { stroke: clr }));
      p.push(sym_header(0, 0, 160, 'AC-COUPLED BATTERY', clr));
      p.push(p_rect(128, 3, 28, 14, { fill: '#444', stroke: 'none', sw: 0, r: 3 }));
      p.push(p_text(142, 13, 'AC/DC', { sz: 7, fill: T.WHITE, anchor: 'middle', bold: true }));

      const cx = 80, cy = 72;
      const cells = [
        { x: cx - 24, h: 32 },
        { x: cx - 12, h: 20 },
        { x: cx,      h: 32 },
        { x: cx + 12, h: 20 },
        { x: cx + 24, h: 32 },
      ];
      cells.forEach(c => p.push(p_line(c.x, cy - c.h/2, c.x, cy + c.h/2, { stroke: clr, sw: 3.5 })));
      p.push(p_text(cx - 36, cy + 6, '−', { sz: 18, bold: true, fill: clr }));
      p.push(p_text(cx + 36, cy + 6, '+', { sz: 18, bold: true, fill: clr }));

      // AC OUT bottom
      p.push(sym_lug(80, 128, T.AC_CLR));
      p.push(p_line(80, 128, 80, 136, { stroke: T.AC_CLR, sw: T.SW_SECONDARY }));
      p.push(p_line(80, 136, 80, 168, { stroke: T.AC_CLR, sw: T.SW_PRIMARY, dash: '8,4' }));
      p.push(sym_arrow(80, 148, 'down', T.AC_CLR));
      p.push(p_text(92, 152, 'AC OUT', { sz: 9, anchor: 'start', fill: T.AC_CLR }));

      p.push(p_text(80, -8, 'BATTERY STORAGE', { sz: 12, anchor: 'middle', bold: true, fill: clr }));
      p.push(p_text(80, 114, model.substring(0, 22), { sz: 9, anchor: 'middle', italic: true }));
      if (kwh > 0)       p.push(p_text(80, 127, `${kwh} kWh`, { sz: 12, anchor: 'middle', bold: true, fill: clr }));
      if (backfeedA > 0) p.push(p_text(80, 158, `${backfeedA}A — NEC 705.12(B)`, { sz: 8, anchor: 'middle', fill: clr }));

      return svg_wrap(160, 178, p.join(''));
    },
  },

  // ── 15. BUI ENPHASE ────────────────────────────────────────────────────────
  {
    id: 'bui-enphase',
    label: 'BUI — Enphase IQ System Controller 3',
    sub: 'GRID + GEN + LOAD + BATTERY ports — dual transfer switch',
    domain: 'AC',
    badge: 'hasBattery (Enphase)',
    badgeColor: 'yellow',
    width: 200,
    height: 188,
    connections: [
      { id: 'grid',    x: 0,   y: 68,  dir: 'left',   domain: 'AC', label: 'GRID IN' },
      { id: 'gen',     x: 0,   y: 116, dir: 'left',   domain: 'AC', label: 'GEN IN' },
      { id: 'load',    x: 200, y: 92,  dir: 'right',  domain: 'AC', label: 'LOAD OUT' },
      { id: 'battery', x: 100, y: 188, dir: 'bottom', domain: 'AC', label: 'BATTERY' },
    ],
    labelAnchor: { x: 100, y: -20, anchor: 'middle', baseline: 'auto' },
    svg: (opts = {}) => {
      const brand  = (opts.brand  as string) || 'Enphase';
      const model  = (opts.model  as string) || 'IQ System Controller 3';
      const amps   = (opts.amps   as number) || 200;
      const hasGen = opts.hasGen as boolean;
      const clr    = T.BUI_ENP;
      const p: string[] = [];

      p.push(p_rect(0, 0, 200, 160, { stroke: clr }));
      p.push(sym_header(0, 0, 200, 'IQ SYSTEM CONTROLLER 3', clr));
      p.push(sym_domain_badge(200, 0, 'AC'));

      // GRID port
      p.push(sym_lug(10, 68, clr));
      p.push(p_text(10, 56, 'GRID', { sz: 9, anchor: 'middle', fill: T.GRAY }));
      p.push(p_line(0, 68, 10, 68, { stroke: clr, sw: T.SW_PRIMARY }));
      p.push(p_line(15, 68, 76, 68, { stroke: clr, sw: T.SW_SECONDARY }));
      p.push(p_circle(15, 68, 4, { fill: clr, stroke: clr, sw: 0 }));
      p.push(p_circle(76, 68, 4, { fill: T.WHITE, stroke: clr, sw: T.SW_SECONDARY }));

      // GEN port
      if (hasGen) {
        p.push(sym_lug(10, 116, T.GEN_CLR));
        p.push(p_text(10, 130, 'GEN', { sz: 9, anchor: 'middle', fill: T.GEN_CLR }));
        p.push(p_line(0, 116, 10, 116, { stroke: T.GEN_CLR, sw: T.SW_PRIMARY }));
        p.push(p_line(15, 116, 48, 96, { stroke: T.GEN_CLR, sw: T.SW_SECONDARY }));
        p.push(p_circle(15, 116, 4, { fill: T.GEN_CLR, stroke: T.GEN_CLR, sw: 0 }));
        p.push(p_circle(76, 116, 4, { fill: T.WHITE, stroke: T.GEN_CLR, sw: T.SW_SECONDARY }));
        p.push(p_line(76, 116, 104, 116, { stroke: clr, sw: T.SW_SECONDARY }));
      }

      // Internal bus
      const busX = 104;
      p.push(p_line(busX, 68, busX, hasGen ? 116 : 92, { stroke: clr, sw: 3.5 }));
      p.push(p_line(76, 68, busX, 68, { stroke: clr, sw: T.SW_SECONDARY }));

      // LOAD port right
      p.push(sym_lug(192, 92, clr));
      p.push(p_text(192, 80, 'LOAD', { sz: 9, anchor: 'middle', fill: T.GRAY }));
      p.push(p_line(busX, 92, 192, 92, { stroke: clr, sw: T.SW_SECONDARY }));
      p.push(p_line(192, 92, 200, 92, { stroke: clr, sw: T.SW_PRIMARY }));
      p.push(sym_arrow(196, 92, 'right', clr, 6));

      // BATTERY port bottom
      p.push(sym_lug(100, 156, clr));
      p.push(p_text(100, 172, 'BATTERY', { sz: 9, anchor: 'middle', fill: clr }));
      p.push(p_line(100, 156, 100, 188, { stroke: clr, sw: T.SW_PRIMARY, dash: '6,3' }));

      p.push(p_text(100, -8, `${brand} ${model}`, { sz: 10, anchor: 'middle', bold: true, fill: clr }));
      p.push(p_text(100, 140, `${amps}A`, { sz: 12, anchor: 'middle', bold: true, fill: clr }));
      p.push(p_text(100, 153, 'NEC 706 / UL 1741-SA', { sz: 8, anchor: 'middle', italic: true }));

      return svg_wrap(200, 196, p.join(''));
    },
  },

  // ── 16. GENERATOR ──────────────────────────────────────────────────────────
  {
    id: 'generator',
    label: 'Standby Generator',
    sub: 'IEEE 315 — circle with G + sine wave, NEC 702',
    domain: 'AC',
    badge: 'generatorKw > 0',
    badgeColor: 'yellow',
    width: 160,
    height: 172,
    connections: [
      { id: 'ac-out', x: 160, y: 80, dir: 'right', domain: 'AC', label: 'GEN OUT' },
      { id: 'egc',    x: 80,  y: 172, dir: 'bottom', domain: 'GND' },
    ],
    labelAnchor: { x: 80, y: -24, anchor: 'middle', baseline: 'auto' },
    svg: (opts = {}) => {
      const brand = (opts.brand as string) || '';
      const model = (opts.model as string) || '';
      const kw    = (opts.kw    as number) || 0;
      const clr   = T.GEN_CLR;
      const p: string[] = [];

      p.push(p_circle(80, 80, 60, { stroke: clr }));
      p.push(p_text(80, 90, 'G', { sz: 36, bold: true, fill: clr, anchor: 'middle' }));
      p.push(sym_sine(80, 110, 40, 11));

      p.push(sym_lug(140, 80, clr));
      p.push(p_line(140, 80, 160, 80, { stroke: clr, sw: T.SW_PRIMARY }));
      p.push(sym_arrow(152, 80, 'right', clr, 7));
      p.push(p_text(142, 68, 'GEN OUT', { sz: 9, anchor: 'start', fill: clr }));

      p.push(p_line(80, 140, 80, 172, { stroke: T.GND, sw: T.SW_SECONDARY }));
      p.push(sym_ground(80, 172));

      p.push(p_text(80, -12, 'STANDBY GENERATOR', { sz: 12, anchor: 'middle', bold: true, fill: clr }));
      if (brand || model) p.push(p_text(80, 0, `${brand} ${model}`.trim(), { sz: 10, anchor: 'middle', fill: clr }));
      if (kw > 0) p.push(p_text(80, 154, `${kw} kW / ${Math.round(kw * 1000 / 240)}A`, { sz: 11, anchor: 'middle', bold: true, fill: clr }));
      p.push(p_text(80, 168, 'NEC 702.5', { sz: 9, anchor: 'middle', italic: true, fill: T.GRAY }));

      return svg_wrap(160, 180, p.join(''));
    },
  },

  // ── 17. ATS ────────────────────────────────────────────────────────────────
  {
    id: 'ats',
    label: 'ATS — Automatic Transfer Switch',
    sub: 'UTIL + GEN inputs, LOAD output — NEC 702.5',
    domain: 'AC',
    badge: 'generatorKw > 0',
    badgeColor: 'yellow',
    width: 200,
    height: 176,
    connections: [
      { id: 'util-in',  x: 0,   y: 60,  dir: 'left',   domain: 'AC', label: 'UTIL IN' },
      { id: 'gen-in',   x: 0,   y: 108, dir: 'left',   domain: 'AC', label: 'GEN IN' },
      { id: 'load-out', x: 200, y: 84,  dir: 'right',  domain: 'AC', label: 'LOAD OUT' },
      { id: 'egc',      x: 100, y: 176, dir: 'bottom', domain: 'GND' },
    ],
    labelAnchor: { x: 100, y: -20, anchor: 'middle', baseline: 'auto' },
    svg: (opts = {}) => {
      const brand  = (opts.brand  as string) || '';
      const amps   = (opts.amps   as number) || 200;
      const clr    = T.ATS_CLR;
      const p: string[] = [];

      p.push(p_rect(0, 0, 200, 148, { stroke: clr }));
      p.push(sym_header(0, 0, 200, 'AUTO TRANSFER SWITCH', clr));
      p.push(sym_domain_badge(200, 0, 'AC'));

      // UTIL lug + closed blade
      p.push(sym_lug(10, 60, clr));
      p.push(p_text(10, 48, 'UTIL', { sz: 9, anchor: 'middle', fill: T.GRAY }));
      p.push(p_line(0, 60, 10, 60, { stroke: clr, sw: T.SW_PRIMARY }));
      p.push(p_line(15, 60, 84, 60, { stroke: clr, sw: T.SW_SECONDARY }));
      p.push(p_circle(15, 60, 4, { fill: clr, stroke: clr, sw: 0 }));
      p.push(p_circle(84, 60, 4, { fill: T.WHITE, stroke: clr, sw: T.SW_SECONDARY }));

      // GEN lug + open blade
      p.push(sym_lug(10, 108, T.GEN_CLR));
      p.push(p_text(10, 122, 'GEN', { sz: 9, anchor: 'middle', fill: T.GEN_CLR }));
      p.push(p_line(0, 108, 10, 108, { stroke: T.GEN_CLR, sw: T.SW_PRIMARY }));
      p.push(p_line(15, 108, 52, 84, { stroke: T.GEN_CLR, sw: T.SW_SECONDARY }));
      p.push(p_circle(15, 108, 4, { fill: T.GEN_CLR, stroke: T.GEN_CLR, sw: 0 }));
      p.push(p_circle(84, 108, 4, { fill: T.WHITE, stroke: T.GEN_CLR, sw: T.SW_SECONDARY }));

      // Internal bus
      const busX = 112;
      p.push(p_line(busX, 60, busX, 108, { stroke: clr, sw: 3.5 }));
      p.push(p_line(84, 60, busX, 60, { stroke: clr, sw: T.SW_SECONDARY }));
      p.push(p_line(84, 108, busX, 108, { stroke: clr, sw: T.SW_SECONDARY }));

      // LOAD lug right
      p.push(sym_lug(192, 84, clr));
      p.push(p_text(192, 72, 'LOAD', { sz: 9, anchor: 'middle', fill: T.GRAY }));
      p.push(p_line(busX, 84, 192, 84, { stroke: clr, sw: T.SW_SECONDARY }));
      p.push(p_line(192, 84, 200, 84, { stroke: clr, sw: T.SW_PRIMARY }));
      p.push(sym_arrow(196, 84, 'right', clr, 6));

      // EGC
      p.push(p_line(100, 148, 100, 176, { stroke: T.GND, sw: T.SW_SECONDARY }));
      p.push(sym_ground(100, 176));

      p.push(p_text(100, -8, 'AUTO TRANSFER SWITCH', { sz: 12, anchor: 'middle', bold: true, fill: clr }));
      if (brand) p.push(p_text(100, 128, brand, { sz: 9, anchor: 'middle', italic: true }));
      p.push(p_text(100, 142, `${amps}A — NEC 702.5`, { sz: 10, anchor: 'middle', bold: true, fill: clr }));

      return svg_wrap(200, 188, p.join(''));
    },
  },

  // ── 18. AC COMBINER ────────────────────────────────────────────────────────
  {
    id: 'ac-combiner',
    label: 'AC Combiner',
    sub: 'Branch breakers → combiner bus → feeder — microinverter',
    domain: 'AC',
    badge: 'Micro only',
    badgeColor: 'purple',
    width: 176,
    height: 152,
    connections: [
      { id: 'branch-1', x: 36,  y: 0,   dir: 'top',   domain: 'AC', label: 'BR-1' },
      { id: 'branch-2', x: 88,  y: 0,   dir: 'top',   domain: 'AC', label: 'BR-2' },
      { id: 'branch-3', x: 140, y: 0,   dir: 'top',   domain: 'AC', label: 'BR-3' },
      { id: 'feeder',   x: 176, y: 108, dir: 'right', domain: 'AC', label: 'FEEDER' },
    ],
    labelAnchor: { x: 88, y: 156, anchor: 'middle', baseline: 'hanging' },
    svg: (opts = {}) => {
      const branches = Math.min((opts.branches as number) || 3, 3);
      const ocpd     = (opts.ocpd     as number) || 20;
      const label    = (opts.label    as string) || 'AC COMBINER';
      const p: string[] = [];

      p.push(p_rect(0, 28, 176, 116));
      p.push(sym_header(0, 28, 176, label));
      p.push(sym_domain_badge(176, 28, 'AC'));

      const bxPositions = [36, 88, 140];
      for (let i = 0; i < branches; i++) {
        const bx = bxPositions[i];
        p.push(p_line(bx, 0, bx, 28, { stroke: T.AC_CLR, sw: T.SW_SECONDARY }));
        p.push(sym_breaker(bx, 64, 26, 18, ocpd, T.AC_CLR));
        p.push(p_line(bx, 73, bx, 108, { stroke: T.AC_CLR, sw: T.SW_SECONDARY }));
      }

      p.push(sym_busbar(12, 164, 108, 'COMBINER BUS', T.AC_CLR));

      p.push(sym_lug(168, 108, T.AC_CLR));
      p.push(p_line(168, 108, 176, 108, { stroke: T.AC_CLR, sw: T.SW_PRIMARY }));
      p.push(sym_arrow(172, 108, 'right', T.AC_CLR, 6));

      p.push(p_text(88, 124, `${branches} branches × ${ocpd}A OCPD`, { sz: 10, anchor: 'middle', fill: T.AC_CLR }));

      return svg_wrap(184, 140, p.join(''));
    },
  },
];

// ─── Export helpers ───────────────────────────────────────────────────────────

export function getSymbol(id: string): SLDSymbol | undefined {
  return SLD_SYMBOLS.find(s => s.id === id);
}

export function renderSymbol(id: string, opts?: Record<string, string | number | boolean>): string {
  const sym = getSymbol(id);
  if (!sym) return `<!-- SLD symbol "${id}" not found -->`;
  return sym.svg(opts);
}

export const LINE_TYPES = {
  AC_CONDUCTOR:  { stroke: T.AC_CLR,  sw: 2.5, dash: undefined,  label: 'AC Conductor in Conduit',       sub: 'THWN-2 — solid 2.5px blue' },
  DC_CONDUCTOR:  { stroke: T.DC_CLR,  sw: 2,   dash: undefined,  label: 'DC Conductor in Conduit',       sub: 'USE-2/PV Wire — solid 2px orange' },
  OPEN_AIR:      { stroke: T.GND,     sw: 2,   dash: '12,6',     label: 'Open Air — PV Wire/THWN-2',     sub: 'NEC 690.31 — long-dash green' },
  EGC:           { stroke: T.GND,     sw: 2,   dash: undefined,  label: 'Equipment Grounding Conductor',  sub: 'NEC 250.122 — solid green' },
  BATTERY_AC:    { stroke: T.BAT_CLR, sw: 2,   dash: '8,4',      label: 'Battery AC-Coupled Connection', sub: 'AC OUT → BUI BATTERY port — dashed blue' },
  GENERATOR_OUT: { stroke: T.GEN_CLR, sw: 2.5, dash: undefined,  label: 'Generator Output Conductor',    sub: 'Gen → BUI GEN port / ATS — solid green' },
  ATS_TRANSFER:  { stroke: T.ATS_CLR, sw: 2.5, dash: undefined,  label: 'ATS Transfer Conductor',        sub: 'ATS LOAD → MSP — solid orange' },
  BACKUP_FEEDER: { stroke: T.SUB_CLR, sw: 2,   dash: undefined,  label: 'Backup Sub-Panel Feeder',       sub: 'BUI LOAD → Sub-Panel — solid purple' },
  COMMUNICATION: { stroke: '#888888', sw: 1.5, dash: '5,4',      label: 'Communication / Control',        sub: 'Signal wiring — short-dash gray' },
} as const;

export const DESIGN_TOKENS = T;