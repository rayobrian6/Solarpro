/**
 * tests/sectionEditingWiring.test.ts
 *
 * THE UI IS WIRED TO THE AUTHORITY, AND THE OLD ONE IS GONE.
 *
 * `lib/3d/sectionEditing.ts` is unit-tested directly. What cannot be unit-tested
 * is whether the 14k-line client component actually CALLS it — and the defect
 * being closed here was never in a library. It was a control panel rendering a
 * number no library had produced.
 *
 * So these are structural guards over the source. Each one is verified to FAIL
 * against the pre-change files: run with
 *
 *     SECTION_WIRING_SRC_DIR=<a checkout of commit 7ceab492>
 *
 * and every assertion below must break. A structural guard that passes against
 * the code it was written to forbid is decoration.
 *
 * 🚨 COMMENTS ARE STRIPPED FIRST. This file's own subjects quote the removed
 * code in their comments — `applyBuildingShape` still explains what it replaced,
 * and the deleted `buildingOverrides` left a note naming itself. A guard reading
 * raw source would match those and pass while the code had been reintroduced.
 * tests/autosaveAdversarial.test.ts was bitten by exactly this.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './support/stripSource';

/** Point this at an older checkout to prove the guards can fail. */
const ROOT = process.env.SECTION_WIRING_SRC_DIR || join(__dirname, '..');
const AT_HEAD = !process.env.SECTION_WIRING_SRC_DIR;

const read = (...p: string[]) => stripComments(readFileSync(join(ROOT, ...p), 'utf8'));

const ENGINE = read(...(AT_HEAD ? ['components', '3d', 'SolarEngine3D.tsx'] : ['SolarEngine3D.tsx']));
const STUDIO = read(...(AT_HEAD ? ['components', 'design', 'DesignStudio.tsx'] : ['DesignStudio.tsx']));
const SITE   = read(...(AT_HEAD ? ['components', 'design', 'useSiteDesign.ts'] : ['useSiteDesign.ts']));

/** The body of a named function declaration, up to the next one. */
function bodyOf(src: string, decl: string): string {
  const i = src.indexOf(decl);
  expect(i, `${decl} not found`).toBeGreaterThan(-1);
  const j = src.indexOf('\n  function ', i + decl.length);
  return src.slice(i, j > i ? j : i + 6_000);
}

// ═══════════════════════════════════════════════════════════════════════════
// THE LYING READOUT IS GONE
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 the global wall/pitch counters can no longer reach the screen', () => {
  it('there is no `effectiveWallM` or `effectivePitchDeg` anywhere', () => {
    // These were `selectedFaceId ? overrides.get(id)?.x ?? global : global`, and
    // the override map was never written, so both branches returned the global.
    expect(ENGINE).not.toMatch(/effectiveWallM/);
    expect(ENGINE).not.toMatch(/effectivePitchDeg/);
  });

  it('`buildingOverrides` is not declared — it was declared and never written', () => {
    expect(ENGINE).not.toMatch(/buildingOverrides/);
    expect(ENGINE).not.toMatch(/setBuildingOverrides/);
    expect(ENGINE).not.toMatch(/BuildingFaceOverride/);
  });

  it('🚨 the wall and pitch counters are REFS, so React cannot render them', () => {
    // A value with no React binding cannot appear in JSX by accident. They
    // survive only as the baseline applyBuildingShape subtracts to turn an
    // absolute request into a relative nudge of one standalone face.
    // 🚨 ANCHORED ON THE DECLARATION THAT WAS REMOVED, NOT ON THE CONSTANT.
    // A first version forbade `useState(FLAT_TRACE_EAVE_HEIGHT_M)` outright and
    // failed on `flatTraceEaveHeightM` — a different and entirely legitimate
    // control (the eave height a FLAT trace is built at). Forbidding a shared
    // constant instead of the thing built from it catches the innocent.
    expect(ENGINE).not.toMatch(/\[wallHeightM, setWallHeightM\]/);
    expect(ENGINE).toMatch(/const wallHeightRef = useRef\(FLAT_TRACE_EAVE_HEIGHT_M\)/);
    // …and the sibling it was confused with is still there, untouched.
    expect(ENGINE).toMatch(/\[flatTraceEaveHeightM, setFlatTraceEaveHeightM\] = useState\(FLAT_TRACE_EAVE_HEIGHT_M\)/);
    expect(ENGINE).not.toMatch(/\[buildingPitchDeg, setBuildingPitchDeg\]/);
    expect(ENGINE).toMatch(/const buildingPitchRef = useRef\(25\)/);
  });

  it('`adjustBuilding` is gone — it moved a global on every per-face press', () => {
    expect(ENGINE).not.toMatch(/function adjustBuilding/);
    expect(ENGINE).not.toMatch(/adjustBuilding\(\{/);
  });

  it('no JSX renders a WALLS or PITCH stepper label any more', () => {
    // Anchored on the rendered text, because that is what the user read.
    expect(ENGINE).not.toMatch(/>WALLS</);
    expect(ENGINE).not.toMatch(/>PITCH</);
    // 🚨 `[\s\S]` RATHER THAN THE `s` FLAG — tsc targets below es2018 here and
    // rejects `/s` outright (TS1501), while vitest's transpile accepts it. A
    // pattern that only one of the two toolchains can parse is a guard that
    // fails the build rather than the code.
    expect(ENGINE).not.toMatch(/THIS FACE[\s\S]*ALL FACES|ALL FACES[\s\S]*THIS FACE/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// THE AUTHORITY IS THE ONE THAT RUNS
// ═══════════════════════════════════════════════════════════════════════════

describe('the engine edits sections through lib/3d/sectionEditing', () => {
  it('imports the authority rather than reimplementing it', () => {
    expect(ENGINE).toMatch(/from '@\/lib\/3d\/sectionEditing'/);
    expect(ENGINE).toMatch(/applySectionEdit/);
    expect(ENGINE).toMatch(/measureSection/);
    expect(ENGINE).toMatch(/measureFaceVertical/);
  });

  it('🚨 `editSection` calls the authority, renders its OWN builds, and emits the whole array', () => {
    const fn = bodyOf(ENGINE, 'function editSection(');

    expect(fn).toMatch(/applySectionEdit\(roofPlanesRef\.current/);
    // A refusal must not fall through to a render.
    expect(fn).toMatch(/if \(!outcome\.ok\)/);
    expect(fn).toMatch(/return false;/);

    // 🚨 THE FRAMES COME FROM THE BUILD. Re-fitting a frame from the returned
    // plane gives a subtly different answer, and buildSurfaceGrid places every
    // panel from that frame. `faceBuilds` exists to stop exactly that.
    expect(fn).toMatch(/for \(const b of outcome\.faceBuilds\)/);
    expect(fn).toMatch(/b\.frame/);
    expect(fn).toMatch(/b\.projectedPts/);
    // Prove the forbidden alternative is a real pattern before forbidding it.
    const REFIT = /computePlaneFromPoints3D\s*\(/;
    expect('computePlaneFromPoints3D(').toMatch(REFIT);
    expect(fn, 'editSection must not refit a frame').not.toMatch(REFIT);

    // Faces the section stopped owning must lose their ENTITIES, or they
    // linger as an un-pickable ghost roof.
    expect(fn).toMatch(/outcome\.removedFaceIds/);
    expect(fn).toMatch(/viewer\.entities\.remove\(e\)/);

    // 🚨 …AND IT MUST NOT PRUNE THE RENDER CACHE TO DO IT.
    //
    // The first version of editSection called
    // `plane3DEntityMap.current.delete(goneId)` for each removed face, and
    // tests/planeLifecycleAuthority.test.ts and tests/autosaveAdversarial.test.ts
    // both caught it. A "reconcile deletions" effect that pruned those maps
    // once deleted a user's traced garage: the roofPlanes prop lags the map,
    // and ABSENCE IS NOT INTENT. "Mine is different, an explicit edit named the
    // ids" is the argument that would bring it back, so the ban stays blanket.
    //
    // The prune was also unnecessary: `liveRenderedFaces()` takes membership
    // from `roofPlanesRef.current`, so a face no longer in the design is
    // already invisible to every authority consumer.
    for (const map of ['plane3DEntityMap', 'plane3DFrameMap', 'plane3DCesiumPtsMap']) {
      const PRUNE = new RegExp(`${map}\\.current\\.(delete|clear)\\(`);
      // Prove the pattern can match before trusting a .not.toMatch to mean
      // anything — a guard whose regex cannot fire passes against any source.
      expect(`${map}.current.delete(`).toMatch(PRUNE);
      expect(fn, `editSection must not prune ${map}`).not.toMatch(PRUNE);
    }

    expect(fn).toMatch(/onRoofGeometryReplaced\?\.\(outcome\.planes/);
  });

  it('🚨 `nudgeFaceElevation` REFUSES a face that belongs to a section', () => {
    const fn = bodyOf(ENGINE, 'function nudgeFaceElevation(');
    expect(fn).toMatch(/sectionIdOfFaceId\(faceId\)/);
    expect(fn).toMatch(/if \(sid\)/);
    expect(fn).toMatch(/setSectionRefusal\(/);
    // It must bail BEFORE touching geometry — moving half a gable opens the
    // ridge, which is the compensating edit this whole pass exists to remove.
    const guard = fn.indexOf('if (sid)');
    const apply = fn.indexOf('applyBuildingShape(');
    expect(guard).toBeGreaterThan(-1);
    expect(apply).toBeGreaterThan(guard);
  });

  it('🚨 …and it REFUSES A DETECTION — the native path is protected', () => {
    // "Standalone" alone was the wrong test. A Google/solar_api face has no
    // sectionId and a uuid with no '::', so every native face landed in exactly
    // the branch that rebuilds geometry and persists it — and
    // `deriveAzimuthsFromSharedEdges`' fallback would flip a lone north-facing
    // face to azimuth 180 on the way. An independent native-3D audit caught
    // this in the first version of this function.
    const fn = bodyOf(ENGINE, 'function nudgeFaceElevation(');
    expect(fn).toMatch(/isHandModelledFace\(plane\)/);
    const provenance = fn.indexOf('isHandModelledFace(plane)');
    expect(provenance).toBeGreaterThan(-1);
    expect(fn.indexOf('applyBuildingShape('), 'the gate must precede the rewrite')
      .toBeGreaterThan(provenance);
  });

  it('🚨 the geometry-mutation policy has a call site at last', () => {
    // lib/3d/geometryMutationPolicy.ts encodes Ray's 2026-09-21 ruling — an
    // explicit gesture MAY move a traced footprint, inference may not — and it
    // was enforced NOWHERE. Section move is the first user-authored footprint
    // move in the codebase, so it is the call site the module was written for.
    const AUTH = read(...(AT_HEAD ? ['lib', '3d', 'sectionEditing.ts'] : ['sectionEditing.ts']));
    expect(AUTH).toMatch(/from '\.\/geometryMutationPolicy'/);
    expect(AUTH).toMatch(/evaluateGeometryMutation\(\{/);
    expect(AUTH).toMatch(/authorship: 'user-authored'/);
    expect(AUTH).toMatch(/effect: 'moves-footprint'/);
    // And it must actually branch on the verdict, not just compute one.
    expect(AUTH).toMatch(/if \(!verdict\.allowed\)/);
  });

  it('the inspector is mounted and fed the derived state', () => {
    expect(ENGINE).toMatch(/<SectionInspector/);
    expect(ENGINE).toMatch(/state=\{inspectorState\}/);
    expect(ENGINE).toMatch(/onEdit=\{handleInspectorEdit\}/);
    expect(ENGINE).toMatch(/onNudgeFace=/);
  });

  it('a new selection opens at SECTION level, so the drill-in cannot be sticky', () => {
    const fn = bodyOf(ENGINE, 'function selectRoofFace(');
    expect(fn).toMatch(/setSelectionLevel\('section'\)/);
    expect(fn).toMatch(/setSectionRefusal\(null\)/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// UNDO IS CANONICAL AND THERE IS ONLY ONE OF IT
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 undo restores canonical geometry, and the inert second history is gone', () => {
  it('the SceneState history store is no longer constructed or mounted', () => {
    // It had ZERO dispatch sites, so its buttons were decoration; and its state
    // is primitives plus slider positions, which is render state.
    expect(ENGINE).not.toMatch(/createHistoryStore/);
    expect(ENGINE).not.toMatch(/createEmptySceneState/);
    expect(ENGINE).not.toMatch(/historyStoreRef/);
    expect(ENGINE).not.toMatch(/<UndoRedoToolbar/);
  });

  it('the Undo/Redo chip is bound to the canonical props', () => {
    expect(ENGINE).toMatch(/data-testid=\{`geometry-\$\{key\}`\}/);
    expect(ENGINE).toMatch(/onUndoGeometry/);
    expect(ENGINE).toMatch(/onRedoGeometry/);
  });

  it('the history lives with the array it restores', () => {
    expect(SITE).toMatch(/from '@\/lib\/3d\/geometryHistory'/);
    expect(SITE).toMatch(/const recordGeometry = useCallback/);
    expect(SITE).toMatch(/pushSnapshot\(geometryHistoryRef\.current, label, roofPlanesRef\.current, coalesceKey\)/);
    // Undo adopts CANONICAL planes. No Cesium, no entity, no frame.
    expect(SITE).toMatch(/const undoGeometry = useCallback/);
    expect(SITE).toMatch(/setRoofPlanes\(step\.planes\)/);
    expect(SITE).not.toMatch(/Cesium/);
  });

  it('🚨 history does not cross a site boundary', () => {
    const fn = SITE.slice(SITE.indexOf('const applyBundle = useCallback'), SITE.indexOf('const setActiveKey'));
    expect(fn).toMatch(/emptyHistory\(\)/);
  });

  it('🚨 DesignStudio SNAPSHOTS BEFORE IT ADOPTS', () => {
    const i = STUDIO.indexOf('onRoofGeometryReplaced={');
    expect(i, 'the section-edit channel is not wired').toBeGreaterThan(-1);
    const handler = STUDIO.slice(i, STUDIO.indexOf('onRoofPlanesStitched={', i));

    const record = handler.indexOf('site.recordGeometry(');
    const adopt = handler.indexOf('setRoofPlanes(');
    expect(record, 'the edit is not recorded for undo').toBeGreaterThan(-1);
    expect(adopt).toBeGreaterThan(-1);
    // Recording AFTER adopting stores the thing the user wants back.
    expect(record).toBeLessThan(adopt);

    // And the arriving faces are enriched and stamped like every other face,
    // or the panel grid and the site archive treat them as strangers.
    expect(handler).toMatch(/enrichRoofPlaneWith3DFrame\(enrichRoofPlaneWithLECS\(p\)\)/);
    expect(handler).toMatch(/e\.siteKey = e\.siteKey \|\| owner/);
    expect(handler).toMatch(/if \(e\.section\) e\.section\.siteKey = e\.siteKey/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// THE PLANE SHAPE HAS ONE DECLARATION
// ═══════════════════════════════════════════════════════════════════════════

describe('the engine reads the real RoofPlane type', () => {
  it('🚨 the hand-maintained structural copy of RoofPlane is gone', () => {
    // It listed seventeen fields and was stale: sectionId, sectionFaceKey,
    // section, siteKey and source were all invisible to the engine while
    // DesignStudio (which passes RoofPlane[]) could see them.
    expect(ENGINE).toMatch(/roofPlanes\?: import\('@\/types'\)\.RoofPlane\[\];/);
    expect(ENGINE).not.toMatch(/roofPlanes\?: Array<\{/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// THE GUARDS CAN FAIL
// ═══════════════════════════════════════════════════════════════════════════

describe('positive controls', () => {
  it('stripComments really removes a block comment that would satisfy a guard', () => {
    const src = 'const a = 1;\n/* effectiveWallM buildingOverrides */\nconst b = 2;';
    expect(src).toMatch(/effectiveWallM/);
    expect(stripComments(src)).not.toMatch(/effectiveWallM/);
    expect(stripComments(src)).toMatch(/const b = 2/);
  });

  it('the sources were actually read and are the files we think they are', () => {
    expect(ENGINE.length).toBeGreaterThan(200_000);
    expect(STUDIO.length).toBeGreaterThan(100_000);
    expect(SITE.length).toBeGreaterThan(5_000);
    expect(ENGINE).toMatch(/function applyBuildingShape\(/);
  });
});

describe('🚨 a decision made before the property was named is held, not dropped', () => {
  it('setNativeDisposition parks it and setActiveKey flushes it', () => {
    // Measured in a real browser: opening the studio through the quick-design
    // entry leaves `activeSiteKey` as the empty string, so building a section
    // right away called `withDisposition(map, '', 'custom')`, which returns the
    // map unchanged — "an unresolved site owns no decision". The write vanished
    // and nothing said so, and the app went on believing native acquisition was
    // still permitted for that property.
    expect(SITE).toMatch(/pendingDispositionRef/);

    const setter = SITE.slice(
      SITE.indexOf('const setNativeDisposition = useCallback'),
      SITE.indexOf('return {', SITE.indexOf('const setNativeDisposition = useCallback')),
    );
    expect(setter).toMatch(/if \(!\(activeSiteKeyRef\.current \|\| stateRef\.current\.activeSiteKey\)\)/);
    expect(setter).toMatch(/pendingDispositionRef\.current = d/);

    const flush = SITE.slice(
      SITE.indexOf('const setActiveKey = useCallback'),
      SITE.indexOf('const setNativeDisposition = useCallback'),
    );
    expect(flush, 'setActiveKey must flush the parked decision').toMatch(/pendingDispositionRef\.current/);
    expect(flush).toMatch(/withDisposition\(stateRef\.current\.nativeGeometry, k, d\)/);
    // It must clear the park, or every later key change would refile it.
    expect(flush).toMatch(/pendingDispositionRef\.current = null/);
  });

  it('🚨 the Undo chip is not buried under the other panels', () => {
    // `elementsFromPoint` over the live page found, in front of it: the LiDAR
    // Properties panel (z=60) and the top-left dock (z=51). The chip inherited
    // top:12/left:12/z=50 from the inert toolbar it replaced, so Undo could not
    // be clicked — by a test or by a person. Nobody noticed because the buttons
    // it replaced did nothing at all.
    const i = ENGINE.indexOf('<DraggablePanel id="undo-redo-toolbar"');
    expect(i, 'the undo toolbar is not mounted').toBeGreaterThan(-1);
    const block = ENGINE.slice(i, i + 900);
    expect(block).toMatch(/zIndex=\{62\}/);
    expect(block).toMatch(/zIndex: 62/);
    // And it is no longer in the corner the two docks occupy.
    expect(block).not.toMatch(/top: 12, left: 12/);
  });
});
