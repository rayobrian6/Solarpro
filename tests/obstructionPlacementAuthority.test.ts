/**
 * tests/obstructionPlacementAuthority.test.ts
 *
 * ONE PHYSICAL VALIDITY AUTHORITY. NO PLACEMENT PATH GETS ITS OWN RULES.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE INSTRUCTION, AND WHAT AN AUDIT FOUND BEHIND IT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   "Manual placement and Auto Layout must share the same physical validity
 *    authority. We already found `addRow` bypassing containment once. Do not
 *    allow another placement path to have different rules."
 *
 * For obstructions the rules were not merely different — there were almost none:
 *
 *   • `placePanelsControlled` is the ONE chokepoint for every 3D placement path
 *     (auto_roof, plane3d, surface_select, add_row, extend_row, single, ground,
 *     fence) and had NO obstruction awareness at all. A grep for
 *     obstruction/keepout across lib/3d/ returned zero matches.
 *   • The only keep-out filter was applied at three 2D call sites, and all
 *     three sit downstream of a `routeLayoutTo3D()` early return — so in 3D
 *     mode, which is where roofs are modelled, none of them ran.
 *   • `keepOutZones` had exactly one writer: the Nearmap AI fetch. The
 *     obstructions a PERSON places live in `placedObstructions` and were never
 *     converted, so a hand-marked chimney was consulted by nothing at all.
 *
 * 🚨 AND BOTH EXISTING TESTS USED THE PANEL CENTRE. A module is ~1.13 m × 1.72 m
 * and a default vent is 0.6 m across. "Is the panel's lat/lng inside the
 * footprint" is true for only a small fraction of the positions where the module
 * physically covers the vent, so a marked vent removed a panel roughly one time
 * in five and the other four times a module went straight through it.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  panelHitsKeepOut, filterPanelsByKeepOut, positionClearsKeepOut,
  clearanceFor, keepOutHalfExtentsM, panelHalfExtentsM, keepOutRing,
  DEFAULT_CLEARANCE_M, FALLBACK_CLEARANCE_M,
} from '@/lib/3d/panelKeepOut';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const LAT = 38.70615, LNG = -90.04625;
const M_PER_DEG_LAT = 111_320;
/** Move `m` metres north of the obstruction. */
const north = (m: number) => LAT + m / M_PER_DEG_LAT;

/** A standard 60-cell residential module, as `PlacedPanel` carries it. */
const MODULE = { widthFeet: 3.72, heightFeet: 5.65 };   // 1.134 m x 1.722 m

const vent = { id: 'v1', lat: LAT, lng: LNG, type: 'vent', radiusM: 0.3, heightM: 0.4 };
const chimney = { id: 'c1', lat: LAT, lng: LNG, type: 'chimney', widthM: 0.9, depthM: 0.6, heightM: 1.2 };

// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 footprint against footprint, not centre against footprint', () => {
  it('a module whose CENTRE is well clear of a vent still hits it', () => {
    // 0.55 m north. The module's centre is outside the 0.3 m vent and outside
    // its 0.15 m clearance — the old centre test said "fine" — but the module
    // extends 0.861 m from its own centre, so it physically covers the vent.
    const p = { id: 'p', lat: north(0.55), lng: LNG, ...MODULE };
    expect(panelHitsKeepOut(p, vent)).toBe(true);
  });

  it('🚨 MUTATION PROOF: the OLD centre test calls that same module clear', () => {
    // This is the defect, reproduced exactly: |dy| = 0.55 m, radius 0.3 m.
    const dyM = 0.55;
    const oldCentreTest = dyM < vent.radiusM;
    expect(oldCentreTest).toBe(false);          // the old answer: no conflict
    expect(panelHitsKeepOut({ id: 'p', lat: north(dyM), lng: LNG, ...MODULE }, vent)).toBe(true);
  });

  it('a module genuinely two metres away is clear', () => {
    expect(panelHitsKeepOut({ id: 'p', lat: north(2), lng: LNG, ...MODULE }, vent)).toBe(false);
  });

  it('a module directly over it is obviously a hit', () => {
    expect(panelHitsKeepOut({ id: 'p', lat: LAT, lng: LNG, ...MODULE }, vent)).toBe(true);
  });

  it('the boundary is the sum of the half-extents, and it is continuous', () => {
    const k = keepOutHalfExtentsM(vent);          // 0.3 + 0.15 clearance
    const p = panelHalfExtentsM(MODULE as never); // 0.567 x 0.861
    const edge = k.halfY + p.halfY;               // ~1.311 m
    expect(panelHitsKeepOut({ id: 'p', lat: north(edge - 0.02), lng: LNG, ...MODULE }, vent)).toBe(true);
    expect(panelHitsKeepOut({ id: 'p', lat: north(edge + 0.02), lng: LNG, ...MODULE }, vent)).toBe(false);
  });

  it('a module with no CAD dimensions falls back to a real module, never to zero', () => {
    // Zero would silently restore the centre-point test this exists to replace.
    const e = panelHalfExtentsM({ lat: 0, lng: 0 } as never);
    expect(e.halfX).toBeGreaterThan(0.5);
    expect(e.halfY).toBeGreaterThan(0.8);
  });
});

describe('clearance is a real distance, and it has a default per type', () => {
  it('🚨 ZERO WAS THE OLD ANSWER FOR EVERYTHING, and it is wrong for all of them', () => {
    for (const t of ['vent', 'vent_pipe', 'plumbing_stack', 'chimney', 'skylight', 'roof_hatch', 'hvac']) {
      expect(DEFAULT_CLEARANCE_M[t], `${t} has no clearance`).toBeGreaterThan(0);
    }
  });

  it('a chimney is kept clearer than a vent — flashing and combustibles', () => {
    expect(DEFAULT_CLEARANCE_M.chimney).toBeGreaterThan(DEFAULT_CLEARANCE_M.vent);
  });

  it('an explicit clearance on the object wins over the type default', () => {
    expect(clearanceFor({ ...vent, clearanceM: 1.5 })).toBe(1.5);
    // Including an explicit zero: an installer may decide a vent needs none.
    expect(clearanceFor({ ...vent, clearanceM: 0 })).toBe(0);
  });

  it('an unknown type gets the fallback, not zero', () => {
    expect(clearanceFor({ lat: 0, lng: 0, type: 'something-new' })).toBe(FALLBACK_CLEARANCE_M);
    expect(clearanceFor({ lat: 0, lng: 0 })).toBe(FALLBACK_CLEARANCE_M);
  });

  it('a bigger clearance removes more', () => {
    const far = { id: 'p', lat: north(1.6), lng: LNG, ...MODULE };
    expect(panelHitsKeepOut(far, vent)).toBe(false);
    expect(panelHitsKeepOut(far, { ...vent, clearanceM: 1.0 })).toBe(true);
  });

  it('a rectangular chimney uses its width and depth, not a radius', () => {
    const k = keepOutHalfExtentsM(chimney);
    expect(k.halfX).toBeCloseTo(0.9 / 2 + DEFAULT_CLEARANCE_M.chimney, 6);
    expect(k.halfY).toBeCloseTo(0.6 / 2 + DEFAULT_CLEARANCE_M.chimney, 6);
  });

  it('the keep-out ring is drawable and matches the half-extents', () => {
    const ring = keepOutRing(chimney);
    expect(ring).toHaveLength(4);
    const k = keepOutHalfExtentsM(chimney);
    expect((ring[2].lat - ring[0].lat) * M_PER_DEG_LAT).toBeCloseTo(k.halfY * 2, 3);
  });
});

describe('the filter every placement path calls', () => {
  const panels = [
    { id: 'over', lat: LAT, lng: LNG, ...MODULE },
    { id: 'near', lat: north(0.55), lng: LNG, ...MODULE },
    { id: 'clear', lat: north(3), lng: LNG, ...MODULE },
  ];

  it('removes what stands on the obstruction and reports it', () => {
    const r = filterPanelsByKeepOut(panels, [vent]);
    expect(r.panels.map(p => p.id)).toEqual(['clear']);
    expect(r.removed.map(p => p.id)).toEqual(['over', 'near']);
  });

  it('with no obstructions it is the identity — and the SAME array', () => {
    // A layout that silently shrinks when nothing was marked would be a
    // regression on every existing design.
    expect(filterPanelsByKeepOut(panels, []).panels).toBe(panels);
    expect(filterPanelsByKeepOut(panels, null).panels).toBe(panels);
  });

  it('an obstruction with no coordinates is ignored rather than removing everything', () => {
    const r = filterPanelsByKeepOut(panels, [{ lat: NaN, lng: NaN } as never]);
    expect(r.panels).toHaveLength(3);
  });

  it('the interactive answer and the batch answer agree', () => {
    // A ghost preview that says "valid" and a commit that deletes the module
    // are two answers to one question.
    for (const p of panels) {
      const batch = filterPanelsByKeepOut([p], [vent]).removed.length > 0;
      const live = !positionClearsKeepOut(p, [vent]).ok;
      expect(live, `disagreement on ${p.id}`).toBe(batch);
    }
  });

  it('the interactive answer names what blocked it', () => {
    expect(positionClearsKeepOut({ lat: LAT, lng: LNG, ...MODULE }, [chimney]).blockedBy).toBe('chimney');
    expect(positionClearsKeepOut({ lat: north(9), lng: LNG, ...MODULE }, [chimney]).ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// THE WIRING — this is what makes it ONE authority rather than one more helper
// ═══════════════════════════════════════════════════════════════════════════

const CONTROL = strip(read('lib/3d/controlLayer.ts'));
const ENGINE = strip(read('components/3d/SolarEngine3D.tsx'));
const STUDIO = strip(read('components/design/DesignStudio.tsx'));

describe('🚨 the chokepoint enforces it, so no 3D path can opt out', () => {
  it('placePanelsControlled filters its own output', () => {
    expect(CONTROL).toMatch(/filterPanelsByKeepOut\(normalizedAll, config\.obstructions\)/);
  });

  it('…AFTER normalisation, so the modules carry their real dimensions', () => {
    const norm = CONTROL.indexOf('const normalizedAll = normalizePanels');
    const filt = CONTROL.indexOf('filterPanelsByKeepOut(normalizedAll');
    expect(norm).toBeGreaterThan(-1);
    expect(filt).toBeGreaterThan(norm);
  });

  it('and it reports what it removed rather than shrinking in silence', () => {
    expect(CONTROL).toMatch(/obstructedCount: keptAfterKeepOut\.removed\.length/);
  });

  it('🚨 EVERY call site in the studio passes the obstruction list', () => {
    // The guard that makes a NEW placement path impossible to add quietly. If
    // this count ever drops, a path has been added that plays by its own rules.
    const calls = (ENGINE.match(/placePanelsControlled\(\{/g) ?? []).length;
    const passes = (ENGINE.match(/obstructions: obstructionsRef\.current/g) ?? []).length;
    expect(calls).toBeGreaterThan(0);
    expect(passes, `${calls} placement call sites but only ${passes} pass obstructions`).toBe(calls);
  });
});

describe('🚨 the obstructions a PERSON marked reach the 2D paths too', () => {
  it('all three 2D filters consult placedObstructions, not only the AI list', () => {
    // `keepOutZones` has exactly one writer — the Nearmap fetch — so before
    // this a hand-marked chimney was honoured by nothing anywhere.
    const uses = (STUDIO.match(/filterPanelsByKeepOut\(/g) ?? []).length;
    expect(uses).toBe(3);
    expect(STUDIO).toMatch(/placedObstructionsRef\.current \?\? \[\]/);
  });

  it('and the AI keep-outs are still applied — both sources, one rule', () => {
    expect(STUDIO).toMatch(/filterPanelsByObstructions\(allNew, keepOutZones\)/);
  });
});

describe('🚨 an obstruction can be selected, and therefore deleted', () => {
  it('a click in select mode picks the obstruction under the cursor', () => {
    // It could be placed and never touched again: no gesture selected one, so
    // "delete this vent" was unreachable and the only way to remove a
    // mis-placed one was to remove every obstruction on the roof.
    expect(ENGINE).toMatch(/function pickObstructionAtScreen/);
    expect(ENGINE).toMatch(/const obsHit = pickObstructionAtScreen\(viewer, screenPos\)/);
  });

  it('…and it is checked BEFORE panels, or it is unclickable where it matters', () => {
    // An obstruction is small, sits on the roof surface and is usually
    // surrounded by modules.
    const at = ENGINE.indexOf('const obsHit = pickObstructionAtScreen');
    const panelAt = ENGINE.indexOf('const picked = pickPanelAtScreen(viewer, screenPos);');
    expect(at).toBeGreaterThan(-1);
    expect(panelAt).toBeGreaterThan(at);
  });

  it('the Delete key removes the selected one through the canonical path', () => {
    expect(ENGINE).toMatch(/onRequestDelete\?\.\('obstruction', selectedObstructionIdRef\.current\)/);
  });

  it('the picker reads the same id the placement path wrote', () => {
    // `[OBS] <id>` where <id> IS the PlacedObstruction id — one fact, read one
    // way, so a tombstone and an entity cannot disagree about which object it is.
    expect(ENGINE).toMatch(/nm\.startsWith\('\[OBS\] '\)/);
    expect(ENGINE).toMatch(/name:\s+`\[OBS\] \$\{obsId\}`/);
  });
});

describe('🚨 a site object shades but does not occupy', () => {
  it('a tree beside the house does not delete the panels under it', () => {
    // Shaded production is a derate, not a no-build. Removing modules under a
    // tree would be a physically false answer and a commercially wrong one.
    const tree = { id: 't', lat: LAT, lng: LNG, type: 'tree', space: 'site' as const, radiusM: 3 };
    expect(panelHitsKeepOut({ id: 'p', lat: LAT, lng: LNG, ...MODULE }, tree)).toBe(false);
  });

  it('…while the identical footprint marked as a ROOF object does', () => {
    const roofThing = { id: 'r', lat: LAT, lng: LNG, type: 'hvac', radiusM: 3 };
    expect(panelHitsKeepOut({ id: 'p', lat: LAT, lng: LNG, ...MODULE }, roofThing)).toBe(true);
  });

  it('absent `space` reads as roof — every obstruction stored before it existed', () => {
    expect(panelHitsKeepOut({ id: 'p', lat: LAT, lng: LNG, ...MODULE }, vent)).toBe(true);
  });
});
