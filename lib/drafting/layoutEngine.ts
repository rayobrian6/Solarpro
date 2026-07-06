// ============================================================
// SolarPro Drafting Engine — Layout Engine
// lib/drafting/layoutEngine.ts
//
// getLayoutForSystem(systemType) — STEP 3
//
// Returns the canonical zone geometry for each system type:
//   FENCE:  75–85% draw zone (elevation is primary)
//   ROOF:   60–70% draw zone (top-down plan is primary)
//   GROUND: split layout   (array plan + row elevation)
//
// All templates MUST use these zones — no hardcoded margins.
// ============================================================

export type SystemType = 'roof' | 'ground_mount' | 'solar_fence';

export interface LayoutZones {
  /** Total canvas dimensions */
  canvas: { width: number; height: number };

  /** Draw zone — where geometry lives (panels, elevation, rows) */
  draw: {
    x: number;       // left edge (pixels)
    y: number;       // top edge (pixels from top of canvas)
    width: number;
    height: number;
  };

  /** Data zone — where the callout schedule / spec table lives */
  data: {
    x: number;
    y: number;
    width: number;
    height: number;
  };

  /** Dimension margins — space reserved for dim lines */
  dims: {
    left: number;    // L1 overall dim
    right: number;   // north arrow / secondary
    top: number;     // below title bar
    bottom: number;  // bottom dim + notes
  };

  /** Title bar height */
  titleH: number;

  /** System type (for consumer validation) */
  systemType: SystemType;
}

// ── Canvas constants ──────────────────────────────────────────────────────────
export const CANVAS_W = 1060;
export const CANVAS_PLAN_H  = 460;   // plan views (PV-2)
export const CANVAS_ELEV_H  = 520;   // elevation/structural views (PV-3)

export const TITLE_H = 22;

// ── Main entry point ──────────────────────────────────────────────────────────

export function getLayoutForSystem(
  systemType: SystemType,
  viewType: 'plan' | 'elevation' | 'structural' = 'plan',
): LayoutZones {
  switch (systemType) {
    case 'solar_fence':
      return fenceLayout(viewType);
    case 'ground_mount':
      return groundLayout(viewType);
    case 'roof':
      return roofLayout(viewType);
    default:
      throw new Error(`[getLayoutForSystem] Unknown systemType: "${systemType}"`);
  }
}

// ── FENCE layout ──────────────────────────────────────────────────────────────
// Elevation is the PRIMARY view (mandatory).
// Draw zone: 78% of canvas width (left), data zone: 22% right.
// Tall canvas for proper above-grade + below-grade structure.

function fenceLayout(viewType: 'plan' | 'elevation' | 'structural'): LayoutZones {
  const H = CANVAS_ELEV_H;   // 520 — fence always uses tall canvas
  const W = CANVAS_W;

  // Dimension margins
  const dimLeft   = 72;   // left dim zone (post spacing, overall)
  const dimRight  = 14;   // right edge clear
  const dimTop    = TITLE_H + 8;
  const dimBottom = 54;   // bottom dim line + notes

  // Draw zone: 78% of usable width
  const usableW = W - dimLeft - dimRight;
  const drawW   = Math.round(usableW * 0.78);   // ~757px
  const dataW   = usableW - drawW;              // ~217px

  const drawX = dimLeft;
  const drawY = dimTop;
  const drawH = H - dimTop - dimBottom;

  const dataX = drawX + drawW + 10;
  const dataY = dimTop;
  const dataH = drawH;

  return {
    canvas:     { width: W, height: H },
    draw:       { x: drawX, y: drawY, width: drawW, height: drawH },
    data:       { x: dataX, y: dataY, width: dataW - 10, height: dataH },
    dims:       { left: dimLeft, right: dimRight, top: dimTop, bottom: dimBottom },
    titleH:     TITLE_H,
    systemType: 'solar_fence',
  };
}

// ── GROUND layout ─────────────────────────────────────────────────────────────
// Array plan (PV-2): row-based grid fills left 65%, data zone right 35%.
// Structural (PV-3): pile elevation fills left 60%, callout zone right 40%.

function groundLayout(viewType: 'plan' | 'elevation' | 'structural'): LayoutZones {
  const isPlan = viewType === 'plan';
  const H = isPlan ? CANVAS_PLAN_H : CANVAS_ELEV_H;
  const W = CANVAS_W;

  const dimLeft   = 68;
  const dimRight  = isPlan ? 50 : 14;
  const dimTop    = TITLE_H + 8;
  const dimBottom = isPlan ? 52 : 48;

  const usableW = W - dimLeft - dimRight;
  const drawFrac = isPlan ? 0.65 : 0.60;
  const drawW   = Math.round(usableW * drawFrac);
  const dataW   = usableW - drawW;

  const drawX = dimLeft;
  const drawY = dimTop;
  const drawH = H - dimTop - dimBottom;

  const dataX = drawX + drawW + 10;
  const dataY = dimTop;
  const dataH = drawH;

  return {
    canvas:     { width: W, height: H },
    draw:       { x: drawX, y: drawY, width: drawW, height: drawH },
    data:       { x: dataX, y: dataY, width: dataW - 12, height: dataH },
    dims:       { left: dimLeft, right: dimRight, top: dimTop, bottom: dimBottom },
    titleH:     TITLE_H,
    systemType: 'ground_mount',
  };
}

// ── ROOF layout ───────────────────────────────────────────────────────────────
// Top-down plan: array fills 65% of canvas width.
// Structural (PV-3): cross-section fills 58%, detail circle + callouts right 42%.

function roofLayout(viewType: 'plan' | 'elevation' | 'structural'): LayoutZones {
  const isPlan = viewType === 'plan';
  // ROOF PLAN canvas matches the PV-2 page draw zone's aspect (~1.15) instead
  // of the generic 2.30 plan strip — the old 1060×460 canvas letterboxed into
  // the tall zone with ~50% blank sheet above/below, which also shrank the
  // roof (and its 5.4px table text) to ~48% of achievable size. Ground/fence
  // plans keep CANVAS_PLAN_H.
  // Structural (PV-3) grew 520→800: the 2.4-aspect canvas letterboxed into
  // the sheet's tall draw zone and the bottom half of PV-3 printed blank.
  // The extra height carries the hardware schedule + roofing notes blocks.
  const H = isPlan ? 920 : (viewType === 'structural' ? 800 : CANVAS_ELEV_H);
  const W = CANVAS_W;

  const dimLeft   = 70;
  const dimRight  = isPlan ? 50  : 240;   // structural needs wide callout zone
  const dimTop    = TITLE_H + 8;
  const dimBottom = isPlan ? 52  : 46;

  const usableW = W - dimLeft - dimRight;
  const drawW   = isPlan ? usableW : Math.round(usableW * 0.58);
  const dataW   = isPlan ? 0 : usableW - drawW;   // plan has no side data zone

  const drawX = dimLeft;
  const drawY = dimTop;
  const drawH = H - dimTop - dimBottom;

  // For roof plan: data zone is the bottom strip (north arrow, notes)
  const dataX = drawX + drawW + (isPlan ? 0 : 10);
  const dataY = isPlan ? (H - dimBottom) : dimTop;
  const dataH = isPlan ? dimBottom : drawH;

  return {
    canvas:     { width: W, height: H },
    draw:       { x: drawX, y: drawY, width: isPlan ? usableW : drawW, height: drawH },
    data:       { x: dataX, y: dataY, width: isPlan ? usableW : dataW - 12, height: dataH },
    dims:       { left: dimLeft, right: dimRight, top: dimTop, bottom: dimBottom },
    titleH:     TITLE_H,
    systemType: 'roof',
  };
}