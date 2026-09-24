/**
 * tests/mountFrozenClosure.test.ts
 *
 * A CESIUM CLICK HANDLER CANNOT READ REACT STATE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT COST
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `setupClickHandler(viewer, C)` is called exactly once, from the viewer-init
 * effect. The arrow function it hands to Cesium's `setInputAction` therefore
 * closes over the MOUNT render and keeps that scope for the life of the page —
 * and so does every `handleXClick` it dispatches to, because those are plain
 * functions declared in the component body.
 *
 * So a `useState` variable read inside one of those handlers is not the current
 * value. It is the value that existed before the user had chosen anything.
 *
 * 🚨 MEASURED IN A LIVE BROWSER. Arming the Tree tool sets the size state to
 * 6.0 × 6.0 × 8.0 m and the right-hand sliders show 6.0. The click read the
 * mount values — 0.6 × 0.6 × 1.0, the generic block defaults — and
 * `clampToPreset` raised the 0.6 to the tree preset's `minFootprintM` of 1.0.
 * A tree WAS placed; it was 1 m across instead of 6.
 *
 * That is not cosmetic. `canopyRadiusM` is half the footprint, so every shade
 * result for that tree was computed on a sixth of a canopy, and the number went
 * on into production and PVWatts. The sliders and the placed object disagreed,
 * and the sliders were the ones telling the truth.
 *
 * The fix mirrors the three values into `obstructionSizeRef` from an effect, so
 * a path added later — a new slider, a new preset, a restore — cannot
 * reintroduce the split by forgetting to update a second place.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const ENGINE = fs.readFileSync(
  path.join(process.cwd(), 'components/3d/SolarEngine3D.tsx'),
  'utf8',
);

/** The body of a top-level `function name(...)` declared in the component. */
function bodyOf(name: string): string {
  const at = ENGINE.indexOf(`function ${name}(`);
  expect(at, `${name} is gone`).toBeGreaterThan(-1);
  // Every handler in this file is declared at two-space indent, so the next
  // two-space `function ` declaration ends this one. Cheap, and it cannot run
  // away to the end of a 16k-line file the way a brace counter can.
  const next = ENGINE.indexOf('\n  function ', at + 1);
  const end = next === -1 ? ENGINE.length : next;
  const body = ENGINE.slice(at, end);
  expect(body.length, `${name} body looks collapsed — the extractor is wrong`)
    .toBeGreaterThan(200);
  return body;
}

describe('🚨 handleObstructionClick reads the armed size from a ref, not from state', () => {
  const body = bodyOf('handleObstructionClick');

  it('does not read the three size useState variables', () => {
    // These are the exact identifiers that made the tree 1 m wide.
    for (const stale of [
      'newObstructionWidthM',
      'newObstructionDepthM',
      'newObstructionHeightM',
    ]) {
      expect(
        body.includes(stale),
        `handleObstructionClick reads ${stale} — it runs inside a handler registered ` +
        `once at mount, so that is the value from before the user chose anything`,
      ).toBe(false);
    }
  });

  it('reads obstructionSizeRef.current instead', () => {
    expect(body, 'the armed size no longer comes from a ref')
      .toContain('obstructionSizeRef.current');
  });

  it('and feeds exactly that into clampToPreset', () => {
    const at = body.indexOf('clampToPreset(');
    expect(at, 'clampToPreset is no longer called — the preset bounds are not applied')
      .toBeGreaterThan(-1);
    const call = body.slice(at, body.indexOf(')', at) + 1);
    // The three arguments after `preset` must be the ref-derived ones.
    expect(call, `clampToPreset is called with something other than the armed size: ${call}`)
      .toMatch(/clampToPreset\(\s*preset\s*,\s*armedSize\.widthM\s*,\s*armedSize\.depthM\s*,\s*armedSize\.heightM\s*\)/);
  });
});

describe('🚨 the ref that backs it is kept in step with the state', () => {
  it('is declared with the same three defaults the state uses', () => {
    const at = ENGINE.indexOf('const obstructionSizeRef = useRef');
    expect(at, 'obstructionSizeRef is gone').toBeGreaterThan(-1);
    const decl = ENGINE.slice(at, ENGINE.indexOf('});', at));
    // Seeding it with anything else would make the FIRST click disagree with the
    // sliders — the same defect, one render earlier.
    expect(decl).toContain('DEFAULT_OBSTRUCTION_FOOTPRINT_W_M');
    expect(decl).toContain('DEFAULT_OBSTRUCTION_FOOTPRINT_D_M');
    expect(decl).toContain('DEFAULT_OBSTRUCTION_HEIGHT_M');
  });

  it('🚨 is mirrored by an effect that depends on all three values', () => {
    const at = ENGINE.indexOf('obstructionSizeRef.current = {');
    expect(at, 'nothing writes obstructionSizeRef — it can only ever hold the defaults')
      .toBeGreaterThan(-1);
    const depsAt = ENGINE.indexOf('}, [', at);
    expect(depsAt, 'the mirror is not an effect — nothing re-runs it').toBeGreaterThan(at);
    const deps = ENGINE.slice(depsAt, ENGINE.indexOf(']);', depsAt));
    // A missing dependency here is the same bug wearing a different hat: the ref
    // would hold whatever it had when some OTHER value last changed.
    for (const d of ['newObstructionWidthM', 'newObstructionDepthM', 'newObstructionHeightM']) {
      expect(deps, `${d} is written into the ref but is not a dependency — the ref goes stale`)
        .toContain(d);
    }
  });
});

describe('🚨 the Gable and Hip sliders reach the geometry they claim to set', () => {
  // These two were INERT. `finalizeRoofSection` is reached only from
  // handleGableClick / handleHipClick, so it saw 22° and 6 m for the life of the
  // page however the sliders were moved — and the status line, rendered in
  // render scope, printed the value the user had chosen. Tracing at 40° said
  // "Pitch 40°" and built 22°, then persisted it onto the RoofPlanes.
  const body = bodyOf('finalizeRoofSection');

  it('builds the section from the refs, not the state', () => {
    expect(body, 'the eave height is read from state again — the slider is inert')
      .toContain('eaveHeightM: newRoofEaveHeightMRef.current');
    expect(body, 'the pitch is read from state again — the slider is inert')
      .toContain('pitchDeg: roofPitchDegRef.current');
  });

  it('🚨 and nothing in the section path still reads the raw state', () => {
    // Including the log and status strings: printing the state while the
    // geometry used the ref is the same lie pointing the other way.
    for (const stale of ['roofPitchDeg', 'newRoofEaveHeightM']) {
      const raw = new RegExp(`\\b${stale}\\b(?!Ref)`);
      expect(
        raw.test(body),
        `the gable/hip section path still reads ${stale} directly`,
      ).toBe(false);
    }
  });
});

describe('🚨 a placed panel carries the module that is selected NOW', () => {
  it('createPanel stamps the wattage from selectedPanelRef', () => {
    const body = bodyOf('createPanel');
    expect(
      /selectedPanel\?\.wattage/.test(body),
      'createPanel reads the selectedPanel PROP — panels placed with the Roof ' +
      'tool get the module that was selected when the 3D view mounted, while the ' +
      'HUD shows the current one',
    ).toBe(false);
    expect(body, 'the wattage no longer comes from the ref')
      .toContain('selectedPanelRef.current?.wattage');
  });
});

describe('🚨 a fire setback is the one configured now, not at mount', () => {
  it('no imperative path reads the fireSetbacks prop directly', () => {
    // Render scope may read the prop — it SHOULD, so the panel shows the truth.
    // Everything reached from a click handler must read the ref.
    const raw = [...ENGINE.matchAll(/fireSetbacks\?\./g)].length;
    const renderScopeReads = [...ENGINE.matchAll(/prev\.fireSetbacks|next\.fireSetbacks/g)].length;
    expect(
      raw - renderScopeReads,
      'a placement or fill path still reads the fireSetbacks prop — moving the ' +
      'Edge Setback slider, or applying an AHJ’s real figures, will change the ' +
      'panel and nothing else',
    ).toBe(0);
  });

  it('the ref is mirrored by an effect on the prop', () => {
    expect(ENGINE, 'fireSetbacksRef is never updated — it holds the mount value for ever')
      .toMatch(/useEffect\(\(\) => \{ fireSetbacksRef\.current = fireSetbacks; \}, \[fireSetbacks\]\);/);
  });
});

describe('🚨 a block can be resized more than once', () => {
  // `__centroidCart` is written at creation as ground + the eave height the
  // block was built with, and `blockResizeMove` recovers the ground from it as
  // `carto.height - startHeightM`. That identity holds only while the anchor
  // describes the CURRENT top. Nothing used to update it on drag end, so the
  // second drag mis-placed the handle by exactly the height the first added —
  // a block taken 6 m → 20 m put its knob 14 m below its own roof. The block
  // stayed correct, so the only visible effect was the handle burying itself;
  // after that `blockResizeDown` could never arm again, because it only arms on
  // a `block-handle-` pick.
  it('the drag re-syncs the anchor it will read next time', () => {
    const at = ENGINE.indexOf('const blockResizeUp');
    expect(at, 'blockResizeUp is gone').toBeGreaterThan(-1);
    const body = ENGINE.slice(at, ENGINE.indexOf('\n    const ', at + 20));
    expect(
      body,
      'blockResizeUp does not rewrite __centroidCart — the second drag on any ' +
      'block will bury its own grab handle inside the building, and the height ' +
      'can never be dragged again without a reload',
    ).toContain('__centroidCart');
    // It must be rebuilt from the anchor's own lat/lng at the NEW top, not
    // assigned a bare height (that was a separate defect on this same line:
    // a height is not an ECEF z).
    expect(body, 'the new anchor is not built from the old one’s coordinates')
      .toContain('C.Cartesian3.fromRadians(carto.longitude, carto.latitude, groundM + finalHeightM)');
  });
});

describe('🚨 the premise: the click handler really is registered only once', () => {
  it('setupClickHandler has exactly one call site', () => {
    const calls = [...ENGINE.matchAll(/^\s*setupClickHandler\(/gm)];
    expect(
      calls.length,
      'setupClickHandler is called more than once — if it is now re-registered on ' +
      'every render this whole file of assertions is arguing about nothing, and the ' +
      'ref indirection above should be revisited rather than silently kept',
    ).toBe(1);
  });

  it('and the armed object TYPE was already a ref, for the same reason', () => {
    // Pre-existing, and the calibration for everything above: the preset was
    // moved to a ref when the tool state and the placed object disagreed about
    // what was armed. The size is the same fact about the same handler.
    expect(bodyOf('handleObstructionClick')).toContain('obstructionPresetRef.current');
  });
});
