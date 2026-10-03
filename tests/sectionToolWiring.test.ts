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

// ═══════════════════════════════════════════════════════════════════════════
// A BLOCK BECOMES A VISIBLE FIVE-POINT GABLE HOUSE
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 the "New block eave" input reaches the Block', () => {
  it('finalizeBlock reads it through a ref, not the state its mount-time handler closed over', () => {
    // Right-click finishes a Block from the Cesium handler registered ONCE at
    // mount, so `newBlockEaveHeightM` there is the mount default. A live probe
    // set the input to 4, drew a Block and got a 6 m section (s15).
    const fn = fnBody('finalizeBlock');
    expect(fn, 'positive control: the slice is the Block finalizer').toMatch(/kind: 'flat'/);
    expect(fn).toMatch(/const eaveHeightM = newBlockEaveHeightMRef\.current;/);
    expect(fn, 'the stale state read is back').not.toMatch(/=\s*newBlockEaveHeightM\s*;/);
  });

  it('…and the ref follows the input', () => {
    expect(ENGINE).toMatch(
      /useEffect\(\(\) => \{ newBlockEaveHeightMRef\.current = newBlockEaveHeightM; \}, \[newBlockEaveHeightM\]\);/);
  });
});

describe('🚨 the walls come on when a section is made or changes roof type', () => {
  it('a Block turns them on once its section is built — and not when the section was refused', () => {
    const fn = fnBody('finalizeBlock');
    const okAt = fn.indexOf('if (outcome.ok && outcome.faceBuilds.length > 0)');
    const elseAt = fn.indexOf('} else {', okAt);
    expect(okAt, 'positive control: the success branch exists').toBeGreaterThan(-1);
    expect(elseAt).toBeGreaterThan(okAt);
    expect(fn.slice(okAt, elseAt)).toMatch(/showBuildingWalls\(/);
    // A refused Block has no section, so there are no walls to show.
    expect(fn.slice(elseAt)).not.toMatch(/showBuildingWalls\(/);
  });

  it('a Gable or Hip turns them on after its faces are emitted, and not on a refusal', () => {
    const i = ENGINE.indexOf('function finalizeRoofSection(');
    const body = ENGINE.slice(i, ENGINE.indexOf('function cancelSectionTrace(', i));
    expect(body.length, 'positive control').toBeGreaterThan(800);
    const refusal = body.slice(body.indexOf('if (!outcome.ok'), body.indexOf('for (const b of outcome.faceBuilds)'));
    expect(refusal.length, 'positive control: the refusal branch').toBeGreaterThan(100);
    expect(refusal).not.toMatch(/showBuildingWalls\(/);
    const success = body.slice(body.indexOf('onRoofPlaneCreated?.(b.plane)'));
    expect(success).toMatch(/showBuildingWalls\(/);
  });

  it('editSection turns them on when the edit changed the roof kind — decided by the tested rule', () => {
    // The decision itself is behavioural-tested in tests/sectionViewRules.test.ts.
    // What this guards is that the engine asks THAT rule, with the kind read
    // BEFORE the edit through the authority's own lookup.
    const fn = fnBody('editSection');
    expect(fn, 'positive control').toMatch(/applySectionEdit\(/);
    const kindAt = fn.indexOf('const kindBefore = sectionKindOf(roofPlanesRef.current, sectionId)');
    const editAt = fn.indexOf('applySectionEdit(');
    expect(kindAt, 'the kind is no longer read through sectionKindOf').toBeGreaterThan(-1);
    expect(kindAt, 'the kind must be read before the edit').toBeLessThan(editAt);
    expect(fn).toMatch(/if \(ok && editChangedRoofKind\(kindBefore, outcome\)\) \{\s*showBuildingWalls\(/);
    // 🚨 THE HAND-ROLLED LOOKUP IS GONE. It read the first face's record and
    // could disagree with the authority — see sectionKindOf.
    expect(ENGINE).not.toMatch(/function sectionKindIn\(/);
  });

  it('turning them on is the toggle itself — the same state the 🏚 Building button flips', () => {
    const fn = fnBody('showBuildingWalls');
    expect(fn).toMatch(/showBuilding3DRef\.current = true;/);
    expect(fn).toMatch(/setShowBuilding3D\(true\)/);
  });
});

describe('🚨 a Block prism steps aside while its section’s walls are drawn', () => {
  it('the Building effect syncs the prisms on every toggle AND every roof change', () => {
    const at = ENGINE.indexOf('syncBlockPrismVisibility(showBuilding3D);');
    expect(at, 'the Building effect no longer syncs the prisms').toBeGreaterThan(-1);
    const effectEnd = ENGINE.indexOf('}, [', at);
    expect(ENGINE.slice(effectEnd, effectEnd + 120))
      .toMatch(/\}, \[showBuilding3D, showRoofTexture, simHour, roofPlanes, selectedFaceId, stage\]\)/);
  });

  it('each prism (and its handle) is shown or hidden by the tested rule, blockPrismHidden', () => {
    // The rule — refused section shown, walled section hidden while Building
    // is on, deleted section hidden — is behavioural-tested in
    // tests/sectionViewRules.test.ts.
    const fn = fnBody('syncBlockPrismVisibility');
    expect(fn).toMatch(/for \(const prism of blockEntitiesRef\.current\)/);
    expect(fn).toMatch(/const hidden = blockPrismHidden\(planes, sid, buildingOn\)/);
    expect(fn).toMatch(/prism\.show = !hidden/);
    expect(fn).toMatch(/handle\.show = !hidden/);
    // The prism is tagged with its section only once the section was built.
    const block = fnBody('finalizeBlock');
    const okAt = block.indexOf('if (outcome.ok && outcome.faceBuilds.length > 0)');
    expect(block.slice(okAt, block.indexOf('} else {', okAt)))
      .toMatch(/\(prismEntity as any\)\.__sectionId = sectionId/);
  });
});

describe('🚨 the inspector is handed the studio’s new-roof pitch', () => {
  it('<SectionInspector> receives roofPitchDeg, the number the Gable and Hip tools build with', () => {
    const at = ENGINE.indexOf('<SectionInspector');
    expect(at).toBeGreaterThan(-1);
    const el = ENGINE.slice(at, ENGINE.indexOf('/>', ENGINE.indexOf('onDelete={(scope)', at)));
    expect(el, 'positive control: the slice is the inspector element').toMatch(/onEdit=\{handleInspectorEdit\}/);
    expect(el).toMatch(/newRoofPitchDeg=\{roofPitchDeg\}/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SLICE 1 REVIEW FIXES
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 a kind change keeps the section selected, so its orphan notice survives', () => {
  it('adoptGeometryOutcome moves the selection by the tested rule BEFORE it raises the notice', () => {
    // Live probe p04c: Block, Fill Roof (36 modules on ::deck), select the deck,
    // Roof: Gable. The notice "36 panels sat on a roof face that this change
    // removed" was shown at 53929 ms and GONE at 53986 ms, the inspector read
    // "Nothing selected", and the modules sat inside the attic. The selection
    // effect cleared the dead ::deck id and selectRoofFace(null) cleared the
    // notice with it. selectionAfterRebuild is behavioural-tested in
    // tests/sectionViewRules.test.ts.
    const fn = fnBody('adoptGeometryOutcome');
    const refusedAt = fn.indexOf('if (!outcome.ok)');
    const moveAt = fn.indexOf('selectionAfterRebuild(selectedFaceIdRef.current, outcome)');
    const noticeAt = fn.indexOf('sat on a roof face that this change removed');
    expect(refusedAt, 'positive control: the slice is the adoption pipeline').toBeGreaterThan(-1);
    expect(noticeAt, 'positive control: the orphan notice is in the slice').toBeGreaterThan(-1);
    expect(moveAt, 'the selection no longer follows the section').toBeGreaterThan(refusedAt);
    // Selecting clears the refusal line, so the move must come first.
    expect(moveAt, 'selecting after the notice wipes it').toBeLessThan(noticeAt);
    expect(fn).toMatch(/if \(stillSelected !== selectedFaceIdRef\.current\) selectRoofFace\(stillSelected\)/);
  });

  it('selectRoofFace still clears a stale refusal — which is exactly why the order above matters', () => {
    expect(fnBody('selectRoofFace')).toMatch(/setSectionRefusal\(null\)/);
  });
});

describe('🚨 the status line belongs to the action that caused the redraw', () => {
  it('renderBuildingExtrusion only writes the status line when announcing', () => {
    // A Block placed read "⚠ 1 of 1 face(s) are FLAT" and "Change roof to
    // Gable" became "2 faces · 6 walls" — the redraw overwrote the action.
    const fn = fnBody('renderBuildingExtrusion');
    expect(fn, 'positive control').toMatch(/buildWalls\(faces, groundElevM\)/);
    const calls = fn.match(/setStatusMsg\(/g) ?? [];
    const guarded = fn.match(/if \(announce\) setStatusMsg\(/g) ?? [];
    expect(calls.length, 'positive control: the empty-state and summary lines').toBeGreaterThanOrEqual(2);
    expect(guarded.length, 'an unguarded setStatusMsg is back').toBe(calls.length);
    expect(fn).toMatch(/const announce = opts\.announce === true;/);
  });

  it('only the 🏚 Building button announces; the effect reads that once', () => {
    expect(ENGINE).toMatch(
      /onClick=\{\(\) => \{ announceBuildingRef\.current = true; setShowBuilding3D\(v => !v\); \}\}/);
    expect((ENGINE.match(/announceBuildingRef\.current = true/g) ?? []).length,
      'something other than the Building button announces').toBe(1);
    const at = ENGINE.indexOf('syncBlockPrismVisibility(showBuilding3D);');
    const effect = ENGINE.slice(at, ENGINE.indexOf('}, [', at));
    expect(effect).toMatch(/const announce = announceBuildingRef\.current;\s*announceBuildingRef\.current = false;/);
    expect(effect).toMatch(/renderBuildingExtrusion\(viewer, C, \{ announce \}\)/);
    // Every other caller redraws in silence.
    const others = ENGINE.match(/renderBuildingExtrusion\(viewer, C\)/g) ?? [];
    expect(others.length, 'positive control: adoption, Square Up and Building shape redraw it').toBeGreaterThanOrEqual(3);
  });

  it('a face level by design is not counted as ⚠ FLAT', () => {
    const fn = fnBody('renderBuildingExtrusion');
    expect(fn).toMatch(
      /if \(orient\.tiltDeg < LEVEL_TILT_DEG && !isLevelByDesign\(planeById\.get\(f\.id\)\)\) flatFaceCount\+\+;/);
  });

  it('the Block hint and the kind-change message are still what those actions say', () => {
    expect(fnBody('finalizeBlock')).toMatch(/Roof → Gable makes it a/);
    expect(fnBody('handleInspectorEdit')).toMatch(/the walls are on so you can see the house/);
  });
});
