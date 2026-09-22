// ═══════════════════════════════════════════════════════════════════════════
// THE GABLE AND HIP TOOLS ARE WIRED TO THE SECTION DOMAIN.
//
// The domain is tested elsewhere and thoroughly. What this file protects is the
// WIRING, which is the part that was missing for the whole life of those tools:
// they computed real roof faces and then threw them away.
//
// These are structural guards over a 14,000-line component, so each one carries
// a POSITIVE CONTROL — an assertion that the slice being searched really does
// contain the code it claims to be about. A guard that silently stops covering
// its subject passes for ever, which is the failure mode of every source-text
// assertion, and it has already happened in this repo more than once.
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from './support/stripSource';

const RAW = readFileSync(join(process.cwd(), 'components/3d/SolarEngine3D.tsx'), 'utf8');
// 🚨 COMMENTS STRIPPED. The new code's own comments QUOTE the old behaviour in
// order to explain what changed, so a guard that reads prose would match the
// defect it is meant to forbid.
const ENGINE = stripComments(RAW);

function fnBody(name: string): string {
  const i = ENGINE.indexOf(`function ${name}(`);
  expect(i, `${name} not found in the engine`).toBeGreaterThan(-1);
  // Handlers here are terminated by a catch line that names the function.
  const end = ENGINE.indexOf(`${name}: \${(err as Error).message}`, i);
  if (end > i) return ENGINE.slice(i, end);
  // 🚨 FALL BACK TO THE NEXT FUNCTION, NOT TO A CHARACTER COUNT. This used to
  // return `slice(i, i + 4000)` for a function with no such catch line —
  // `finalizeBlock` is one — so a guard on anything past the four-thousandth
  // character silently searched a truncated body and failed for a reason that
  // had nothing to do with the code. A fixed window is a guess about a
  // function's length.
  const next = ENGINE.indexOf('\n  function ', i + name.length + 10);
  return next > i ? ENGINE.slice(i, next) : ENGINE.slice(i);
}

// ─────────────────────────────────────────────────────────────────────────────

describe('the footprint is traced, not bounding-boxed', () => {
  it.each([
    ['handleGableClick', 'gablePtsRef', 'gable'],
    ['handleHipClick', 'hipPtsRef', 'hip'],
  ])('%s collects FOUR corners and builds a section', (fn, ref, kind) => {
    const body = fnBody(fn);

    // POSITIVE CONTROL: the slice really is this handler.
    expect(body, 'slice is not the handler').toMatch(new RegExp(`${ref}\\.current\\.push\\(pt\\)`));

    // Four, not two.
    expect(body).toMatch(new RegExp(`${ref}\\.current\\.length >= 4`));
    expect(body, 'the two-click gesture must be gone')
      .not.toMatch(new RegExp(`${ref}\\.current\\.length >= 2`));

    // And it hands the traced corners to the domain.
    expect(body).toMatch(new RegExp(`finalizeRoofSection\\(viewer, C, '${kind}'`));
    expect(body).toMatch(new RegExp(`${ref}\\.current\\.slice\\(0, 4\\)`));
  });

  it.each([
    ['handleGableClick', 'computeGableGeometry'],
    ['handleHipClick', 'computeHipGeometry'],
  ])('%s no longer calls the bounding-box math (%s)', (fn, mathFn) => {
    const body = fnBody(fn);
    expect(body.length, 'positive control: the slice has content').toBeGreaterThan(200);
    // 🚨 THE DEFECT ITSELF. computeGableGeometry/computeHipGeometry take two
    // opposite corners and derive everything from min/max lat and lng, so the
    // ridge could only ever run north-south or east-west.
    expect(body).not.toMatch(new RegExp(`${mathFn}\\(`));
  });
});

describe('a section face is registered exactly like a hand-traced one', () => {
  const body = (() => {
    const i = ENGINE.indexOf('function finalizeRoofSection(');
    expect(i, 'finalizeRoofSection not found').toBeGreaterThan(-1);
    return ENGINE.slice(i, ENGINE.indexOf('function cancelSectionTrace(', i));
  })();

  it('positive control: the slice is the finalizer', () => {
    expect(body).toMatch(/buildSectionRoofPlanes\(\{/);
    expect(body.length).toBeGreaterThan(800);
  });

  it('renders through the shared renderer and records all three lookups', () => {
    // Selection, setbacks and the panel grid all read these maps. A face that
    // renders but is not registered is a picture again.
    expect(body).toMatch(/renderPlane3DEntity\(viewer, C, cesiumPts/);
    expect(body).toMatch(/plane3DEntityMap\.current\.set\(/);
    expect(body).toMatch(/plane3DFrameMap\.current\.set\(/);
    expect(body).toMatch(/plane3DCesiumPtsMap\.current\.set\(/);
  });

  it('🚨 EMITS the plane — this is what makes it a design object', () => {
    expect(body).toMatch(/onRoofPlaneCreated\?\.\(b\.plane\)/);
  });

  it('🚨 passes NaN for an unresolved ground elevation, so the domain refuses', () => {
    // `?? 0` here would model the house 136 m underground at a site like
    // Pocahontas IL, and it would look plausible all the way to a permit.
    expect(body).toMatch(/cesiumGroundElevResolvedRef\.current \? cesiumGroundElevRef\.current : NaN/);
    expect(body, 'no silent zero default').not.toMatch(/cesiumGroundElevRef\.current : 0/);
  });

  it('renders NOTHING when the domain refuses, and says why', () => {
    const refusal = body.slice(body.indexOf('if (!outcome.ok'));
    expect(refusal.length, 'positive control: a refusal branch exists').toBeGreaterThan(100);
    const upToReturn = refusal.slice(0, refusal.indexOf('return false;'));
    expect(upToReturn).not.toMatch(/renderPlane3DEntity\(/);
    expect(upToReturn).not.toMatch(/onRoofPlaneCreated/);
    // Every refusal, not the first.
    expect(upToReturn).toMatch(/outcome\.refusals\.map\(/);
  });
});

describe('a half-traced footprint can always be abandoned', () => {
  it('Escape cancels a gable or hip trace in progress', () => {
    const esc = ENGINE.slice(
      ENGINE.indexOf("if (modeRef.current === 'roof_gable' && gablePtsRef.current.length > 0)"),
      ENGINE.indexOf("if (modeRef.current === 'block' && blockPtsRef.current.length > 0)"),
    );
    expect(esc.length, 'positive control: the Escape branch exists').toBeGreaterThan(100);
    expect(esc).toMatch(/cancelSectionTrace\('gable'\)/);
    expect(esc).toMatch(/cancelSectionTrace\('hip'\)/);
  });

  it('right-click cancels one too', () => {
    expect(ENGINE).toMatch(/else if \(modeRef\.current === 'roof_gable'\) \{\s*cancelSectionTrace\('gable'\);/);
    expect(ENGINE).toMatch(/else if \(modeRef\.current === 'roof_hip'\) \{\s*cancelSectionTrace\('hip'\);/);
  });

  it('the cancel clears both the ref and the count', () => {
    const fn = ENGINE.slice(
      ENGINE.indexOf('function cancelSectionTrace('),
      ENGINE.indexOf('function handleGableClick('),
    );
    expect(fn.length).toBeGreaterThan(100);
    expect(fn).toMatch(/gablePtsRef\.current = \[\]/);
    expect(fn).toMatch(/setGablePtCount\(0\)/);
    expect(fn).toMatch(/hipPtsRef\.current = \[\]/);
    expect(fn).toMatch(/setHipPtCount\(0\)/);
  });
});

describe('🚨 the UI does not describe a gesture that no longer exists', () => {
  // The panels used to say "Click eave corner 1 (SW)" and "(NE)", and the chip
  // counted to 2. All three were true of the bounding-box tool and are now
  // false. Copy that lies about the gesture is worse than no copy.
  it('nothing tells the user to click an SW or NE eave corner', () => {
    expect(RAW).not.toMatch(/Click eave corner 1 \(SW\)/);
    expect(RAW).not.toMatch(/click corner 2 \(NE\)/);
  });

  it('the progress chips count to 4', () => {
    expect(RAW).toMatch(/\$\{gablePtCount\}\/4/);
    expect(RAW).toMatch(/\$\{hipPtCount\}\/4/);
    expect(RAW).not.toMatch(/\$\{gablePtCount\}\/2/);
    expect(RAW).not.toMatch(/\$\{hipPtCount\}\/2/);
  });

  it('the tool tips describe a section, and say it survives a save', () => {
    const tips = RAW.slice(RAW.indexOf("mode: 'roof_gable'"), RAW.indexOf("mode: 'tree'"));
    expect(tips.length, 'positive control: the tool defs were found').toBeGreaterThan(200);
    expect(tips).toMatch(/4 footprint corners/);
    expect(tips).toMatch(/save with the design/);
    expect(tips).toMatch(/no 3D coverage/i);
  });

  it('the dead Clear buttons are gone, not left to do nothing', () => {
    // They removed `gableEntitiesRef` / `hipEntitiesRef` contents, which the
    // section path never fills. A button that silently does nothing is a worse
    // answer than no button.
    expect(ENGINE).not.toMatch(/setPlacedGableCount\(0\);\s*setVertexSpecs/);
    expect(ENGINE).not.toMatch(/setPlacedHipCount\(0\);\s*setVertexSpecs/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// THE BLOCK TOOL PRODUCES A DESIGN OBJECT, NOT A PICTURE
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 Block emits a real roof face', () => {
  it('finalizeBlock builds a flat section and emits it, like the other two tools', () => {
    // Its own tooltip reads "Use when Google 3D Tiles has no coverage for this
    // address" — the fallback case this whole pipeline exists for — and it
    // produced only Cesium entities. What it drew never reached the Roof Planes
    // sidebar, took no panels, contributed nothing to the BOM or the planset,
    // and was gone on reload.
    const fn = fnBody('finalizeBlock');

    expect(fn).toMatch(/buildSectionRoofPlanes\(\{/);
    expect(fn).toMatch(/kind: 'flat'/);
    // A flat deck is pitch 0 by definition; anything else would be a shed.
    expect(fn).toMatch(/pitchDeg: 0/);

    // 🚨 THE SAME REFUSAL RULE AS THE OTHER TOOLS. NaN when the pad is
    // unresolved, so the domain declines rather than modelling the building at
    // sea level — which would look plausible all the way to a permit.
    expect(fn).toMatch(/cesiumGroundElevResolvedRef\.current \? cesiumGroundElevRef\.current : NaN/);

    // THE EMIT is what makes it a design object.
    expect(fn).toMatch(/onRoofPlaneCreated\?\.\(b\.plane\)/);
    // …registered in the same three maps as every other face, or selection,
    // setbacks and the panel grid cannot find it.
    expect(fn).toMatch(/plane3DEntityMap\.current\.set\(b\.plane\.id, entityIds\)/);
    expect(fn).toMatch(/plane3DFrameMap\.current\.set\(b\.plane\.id, b\.frame\)/);
    expect(fn).toMatch(/plane3DCesiumPtsMap\.current\.set\(b\.plane\.id, cesiumPts\)/);

    // A refusal must be reported, not swallowed into a success message.
    expect(fn).toMatch(/outcome\.refusals/);
    expect(fn).toMatch(/nothing has been added to the design/i);
  });

  it('the massing prism is still drawn — the section face is added, not swapped in', () => {
    const fn = fnBody('finalizeBlock');
    // The prism is what makes the massing readable; removing it would be a
    // second change wearing this one's clothes.
    expect(fn).toMatch(/blockEntitiesRef\.current\.push\(prismEntity\)/);
    expect(fn).toMatch(/blockHandlesRef\.current\.push\(handleEntity\)/);
  });
});
