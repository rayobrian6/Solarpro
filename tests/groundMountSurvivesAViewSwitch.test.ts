// ═══════════════════════════════════════════════════════════════════════════
// 🚨 A GROUND MOUNT SPLIT ITS ROWS APART ON A 3D → 2D → 3D VIEW SWITCH.
//
// Ray, first hand: he built ground mounts in 3D and they looked like coherent arrays; he
// switched to 2D to check Nearmap imagery; on returning to 3D the rows had separated.
//
// HIS HYPOTHESIS WAS THAT THE VIEW TRANSITION REPROJECTS ROWS INDEPENDENTLY. It does not —
// the view transition is innocent, and that matters, because a fix aimed at the transition
// would have been the render offset he explicitly ruled out. The real defect is upstream:
//
//   1. `lib/3d/ground/groundMountRealityEngine.ts` computes `correctedPanels` — a
//      deterministic grid its own comment calls "deterministic, drift-free", with
//      "Renderer MUST use these instead of raw planeEngine panel positions".
//   2. `placeGroundArrayRow` in components/3d/SolarEngine3D.tsx applied that correction to a
//      LOCAL array (`panelsToRender`) and handed it to `addPanelEntity` — so the Cesium
//      ENTITIES were correct and the panel OBJECTS kept their raw pre-grid lat/lng.
//   3. It then did `return panels` — the raw ones. All three call sites put that return value
//      straight into `groundArrayRowsRef.current`, `finalizeGroundArray` commits it through
//      `onPanelsChange`, and that is what gets persisted. The canonical geometry was never
//      corrected.
//   4. `show3D ? <SolarEngine3D/> : …` in components/design/DesignStudio.tsx is a CONDITIONAL
//      MOUNT. Switching to 2D unmounts the component and resets `lastRenderedPanelsRef` to
//      `[]`; switching back takes `renderAllPanels`' full-rebuild branch
//      (`prev.length === 0 && panelList.length > 0`), which draws each stored panel with no
//      racking solve and no correction.
//
// So nothing moved on the way out. The stored geometry had been wrong since it was committed,
// and the remount stopped hiding it.
//
// WHAT THIS FILE PROVES, and why it is the right invariant to test without a browser:
// after the fix the committed geometry IS the deterministic grid, so a remount re-deriving
// from it must produce the same geometry. That is exactly "3D → 2D → 3D is logically
// equivalent within numerical tolerance", and it is a property of the engine plus the commit
// path, not of Cesium. The browser test in e2e/ drives the real view switch on top of this.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildGroundRacking,
  type GroundPanel,
  type BuildRackingOptions,
  PW_PORTRAIT, PH_PORTRAIT,
} from '@/lib/3d/ground/groundMountRealityEngine';

const ROOT = join(__dirname, '..');

/** Metres per degree of latitude, the engine's own constant basis. */
const MPD = 111_320;
const SITE_LAT = 39.7817;
const SITE_LNG = -89.6501;

/**
 * A multi-row ground mount as the placement flow produces it: panels carrying RAW positions
 * with row/col indices, before the grid correction. Row offsets are deliberately given a
 * small per-row error — which is what the deterministic grid exists to remove, and what
 * re-rendering from raw state puts back on screen.
 */
function rawGroundArray(rows: number, cols: number, opts: { rowJitterM?: number } = {}): GroundPanel[] {
  const jitter = opts.rowJitterM ?? 0;
  const out: GroundPanel[] = [];
  const rowDepth = PH_PORTRAIT * Math.cos(20 * Math.PI / 180);
  const colStep = PW_PORTRAIT + 0.02;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Raw placement walks north per row and east per column, plus the per-row error.
      const nsM = r * rowDepth + rowDepth / 2 + r * jitter;
      const ewM = c * colStep + colStep / 2;
      out.push({
        id: `gp-${r}-${c}`,
        lat: SITE_LAT + nsM / MPD,
        lng: SITE_LNG + ewM / (MPD * Math.cos(SITE_LAT * Math.PI / 180)),
        height: 200 + nsM * Math.tan(20 * Math.PI / 180),
        tilt: 20,
        azimuth: 180,
        arrayRow: r,
        col: c,
        row: r,
        systemType: 'ground',
        orientation: 'portrait',
        wattage: 440,
      });
    }
  }
  return out;
}

const solve = (panels: GroundPanel[], over: Partial<BuildRackingOptions> = {}) =>
  buildGroundRacking({
    style: 'pipe',
    panels,
    basePlaneZ: 200,
    tiltDeg: 20,
    azimuthDeg: 180,
    orientation: 'portrait',
    ...over,
  } as BuildRackingOptions);

/** Metres between two panels, flat-earth at this site — good to well under a mm here. */
function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const dNS = (a.lat - b.lat) * MPD;
  const dEW = (a.lng - b.lng) * MPD * Math.cos(SITE_LAT * Math.PI / 180);
  return Math.hypot(dNS, dEW);
}

describe('🚨 PRECONDITION — the reality engine really does publish a corrected grid', () => {
  it('correctedPanels covers every panel and keeps their ids', () => {
    // Without this the invariant tests below could pass vacuously.
    const raw = rawGroundArray(3, 5);
    const r = solve(raw);
    expect(r.correctedPanels.length, 'the engine returned no corrected grid').toBe(raw.length);
    expect(new Set(r.correctedPanels.map(p => p.id)))
      .toEqual(new Set(raw.map(p => p.id)));
  });

  it('and the raw input really is off the grid — otherwise there is nothing to correct', () => {
    // 4 cm of per-row error, i.e. 12 cm by the fourth row. Small enough to be invisible on a
    // single row and large enough to read as "the rows have separated" across four.
    const raw = rawGroundArray(4, 4, { rowJitterM: 0.04 });
    const corrected = solve(raw).correctedPanels;
    const moved = raw.filter(p => {
      const c = corrected.find(cp => cp.id === p.id)!;
      return metresBetween(p, c) > 0.005;
    });
    expect(moved.length, 'the corrected grid is identical to the raw input — the fixture is inert')
      .toBeGreaterThan(0);
  });
});

describe('🚨 3D → 2D → 3D: re-deriving the committed geometry does not move it', () => {
  it('🚨 the grid is IDEMPOTENT — this is the whole view-switch invariant', () => {
    // A remount re-derives from whatever was committed. If the committed geometry is the
    // grid's own output, re-deriving must return it unchanged — so the switch cannot move
    // anything. Before the fix the committed geometry was the RAW input, and re-deriving
    // moved every panel.
    const raw = rawGroundArray(4, 6, { rowJitterM: 0.04 });
    const first = solve(raw).correctedPanels;
    const second = solve(first).correctedPanels;
    expect(second.length).toBe(first.length);
    for (const a of first) {
      const b = second.find(p => p.id === a.id)!;
      const moved = metresBetween(a, b);
      expect(moved, `${a.id} moved ${(moved * 1000).toFixed(2)} mm on the second derivation`)
        .toBeLessThan(0.001);
      expect(Math.abs(a.height - b.height),
        `${a.id} changed height by ${((a.height - b.height) * 1000).toFixed(2)} mm`)
        .toBeLessThan(0.001);
    }
  });

  it('🚨 and it is stable over FIVE round trips, not just one', () => {
    // 3D → 2D → 3D → 2D → 3D. A per-derivation drift of a fraction of a millimetre would
    // accumulate; a fixed point does not.
    let panels = rawGroundArray(3, 5, { rowJitterM: 0.04 });
    const afterFirst = solve(panels).correctedPanels;
    panels = afterFirst;
    for (let i = 0; i < 5; i++) panels = solve(panels).correctedPanels;
    for (const a of afterFirst) {
      const b = panels.find(p => p.id === a.id)!;
      expect(metresBetween(a, b), `${a.id} drifted over five round trips`).toBeLessThan(0.001);
    }
  });

  it('🚨 rows stay evenly pitched — a row does not move relative to the array', () => {
    // Ray's acceptance wording: "verify no row moves relative to the array or other rows".
    const corrected = solve(rawGroundArray(4, 4, { rowJitterM: 0.04 })).correctedPanels;
    const rowLead = (r: number) =>
      corrected.filter(p => p.arrayRow === r).sort((a, b) => (a.col ?? 0) - (b.col ?? 0))[0];
    const gaps: number[] = [];
    for (let r = 1; r < 4; r++) gaps.push(metresBetween(rowLead(r), rowLead(r - 1)));
    for (const g of gaps) {
      expect(Math.abs(g - gaps[0]),
        `row pitch varies across the array: ${gaps.map(x => x.toFixed(4)).join(', ')} m`)
        .toBeLessThan(0.001);
    }
  });

  it('🚨 every panel in a row stays collinear — the row itself does not bend', () => {
    const corrected = solve(rawGroundArray(3, 6, { rowJitterM: 0.04 })).correctedPanels;
    for (let r = 0; r < 3; r++) {
      const row = corrected.filter(p => p.arrayRow === r).sort((a, b) => (a.col ?? 0) - (b.col ?? 0));
      const steps: number[] = [];
      for (let i = 1; i < row.length; i++) steps.push(metresBetween(row[i], row[i - 1]));
      for (const s of steps) {
        expect(Math.abs(s - steps[0]), `row ${r} column spacing is uneven`).toBeLessThan(0.001);
      }
    }
  });

  it('a single-row array is stable too — the degenerate case', () => {
    const one = solve(rawGroundArray(1, 8)).correctedPanels;
    const again = solve(one).correctedPanels;
    for (const a of one) {
      expect(metresBetween(a, again.find(p => p.id === a.id)!)).toBeLessThan(0.001);
    }
  });
});

describe('🚨 tilt, azimuth and row-spacing changes re-derive cleanly', () => {
  it('a tilt change moves the array once and then holds', () => {
    // Ray's list includes "tilt change" and "row-spacing change". The property is the same:
    // one deliberate move, then a fixed point — not drift on every subsequent view switch.
    const raw = rawGroundArray(3, 4, { rowJitterM: 0.04 });
    const at20 = solve(raw, { tiltDeg: 20 }).correctedPanels;
    const at30 = solve(at20, { tiltDeg: 30 }).correctedPanels;
    const at30Again = solve(at30, { tiltDeg: 30 }).correctedPanels;
    // The tilt change is allowed to move things...
    expect(at30.some(p => Math.abs(p.height - at20.find(q => q.id === p.id)!.height) > 0.001),
      'a 10° tilt change moved nothing — the fixture is not exercising tilt').toBe(true);
    // ...but re-deriving at the SAME tilt must not.
    for (const a of at30) {
      const b = at30Again.find(p => p.id === a.id)!;
      expect(metresBetween(a, b), `${a.id} moved on a no-op re-derivation after a tilt change`)
        .toBeLessThan(0.001);
      expect(Math.abs(a.height - b.height)).toBeLessThan(0.001);
    }
  });

  it('a non-cardinal azimuth is stable — the axes are derived, not hardcoded to south', () => {
    const raw = rawGroundArray(3, 4, { rowJitterM: 0.04 });
    const at215 = solve(raw, { azimuthDeg: 215 }).correctedPanels;
    const again = solve(at215, { azimuthDeg: 215 }).correctedPanels;
    for (const a of at215) {
      expect(metresBetween(a, again.find(p => p.id === a.id)!),
        `${a.id} moved at azimuth 215°`).toBeLessThan(0.001);
    }
  });
});

describe('🚨 the commit path returns what was drawn', () => {
  /** `placeGroundArrayRow` only — not the whole 16k-line component. */
  const placeRowBody = () => {
    const src = readFileSync(join(ROOT, 'components', '3d', 'SolarEngine3D.tsx'), 'utf8');
    const from = src.indexOf('function placeGroundArrayRow(');
    expect(from, 'placeGroundArrayRow is gone — this suite is asserting nothing').toBeGreaterThan(-1);
    const to = src.indexOf('function finalizeGroundArray(', from);
    expect(to, 'could not find the end of placeGroundArrayRow').toBeGreaterThan(from);
    // Comments quote the defect verbatim, so strip them before asserting on the code.
    return src.slice(from, to)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  };

  it('🚨 it returns the corrected panels, not the raw ones', () => {
    const body = placeRowBody();
    expect(body, 'placeGroundArrayRow still returns the raw panels, so the committed geometry is uncorrected')
      .not.toMatch(/\breturn\s+panels\s*;/);
    expect(body, 'the corrected panels are not what is returned').toMatch(/\breturn\s+panelsToRender\s*;/);
  });

  it('🚨 the shared-plane fix writes corrected positions into row STATE, not only the entity', () => {
    // Re-rendering an entity at a corrected position while the object behind it keeps the old
    // one is the shape of the whole defect, repeated for the earlier rows.
    const body = placeRowBody();
    expect(body, 'existing rows are re-rendered but their state is left uncorrected')
      .toMatch(/groundArrayRowsRef\.current\s*=\s*groundArrayRowsRef\.current\.map/);
  });
});
