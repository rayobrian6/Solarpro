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
import { OVERLAY_Z } from '@/lib/3d/overlayLayers';

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
    // 🚨 TWO FUNCTIONS NOW, AND THE SPLIT IS THE POINT. `editSection` asks the
    // authority; `adoptGeometryOutcome` renders, pushes history and brings the
    // panels. The pipeline was extracted so the new per-face pitch edit reuses
    // it rather than growing a second, 90%-identical copy of the side effects —
    // which is how "the panels went inside the house" shipped twice. Both are
    // asserted here so neither half can drift out from under the other.
    const ask = bodyOf(ENGINE, 'function editSection(');
    const fn = bodyOf(ENGINE, 'function adoptGeometryOutcome(');
    expect(ask).toMatch(/adoptGeometryOutcome\(/);

    expect(ask).toMatch(/applySectionEdit\(roofPlanesRef\.current/);
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
    expect(fn, 'the adoption pipeline must not refit a frame').not.toMatch(REFIT);

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
    // 🚨 THE SNAPSHOT CARRIES THE PROVIDER DECISION TOO. Every section face
    // files `custom` for the property, so an undo that restored only the roof
    // left the property permanently custom with nothing able to clear it.
    // 🚨 AND THE DELETION LEDGER, for the same reason one step further on: a
    // tombstone that outlives its undo puts the face back on screen and filters
    // it out again on the next reload — which looks like it worked.
    expect(SITE).toMatch(/pushSnapshot\(\s*\n\s*geometryHistoryRef\.current, label, roofPlanesRef\.current, coalesceKey,\s*\n\s*nativeDispositionRef\.current,[\s\S]{0,900}?\)\)/);
    expect(SITE).toMatch(/deletionLedgerRef\.current,/);
    // Undo adopts CANONICAL planes. No Cesium, no entity, no frame.
    //
    // 🚨 RE-ANCHORED ON THE INDIRECTION, NOT DELETED. This asserted
    // `setRoofPlanes(step.planes)` inside undoGeometry. The adoption now goes
    // through `applyRestoredGeometry`, which also brings the panels back — so
    // the old literal is gone and the INVARIANT is not. What matters is that
    // the restored planes are adopted, canonically, which is asserted here and
    // in the undo-panel guard below.
    expect(SITE).toMatch(/const undoGeometry = useCallback/);
    expect(SITE).toMatch(/applyRestoredGeometry\(step\.planes,/);
    expect(SITE).toMatch(/setRoofPlanes\(restored\)/);
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

describe('🚨 a decision names the property it is about', () => {
  it('setNativeDisposition takes a site key, and refuses out loud without one', () => {
    // Three versions of this, each worse than the last, all measured:
    //
    //   1. filed against `activeSiteKey`, which is '' when the studio opens, so
    //      `withDisposition` dropped it and the app went on believing native
    //      acquisition was permitted for a house somebody had just hand-built;
    //   2. PARKED and flushed on the next `setActiveKey` — inert, because the
    //      memo recomputed and overwrote the ref on the same tick;
    //   3. and when it did flush it carried NO SITE IDENTITY, so pressing
    //      "Draw Manually Instead" and then changing address filed 'rejected'
    //      against the NEIGHBOUR. Marking a house the installer never looked at
    //      is worse than losing the decision.
    //
    // The caller knows which house is on screen. It passes the key.
    expect(SITE).toContain('setNativeDisposition = useCallback((d: NativeGeometryDisposition, siteKey?: string)');
    // 🚨 ONE KEY EXPRESSION, SHARED WITH THE READ. The write used this literal
    // while the memo read `activeSiteKey` alone, so on a project whose
    // coordinates never resolve the write filed the decision and the next
    // render overwrote the ref with 'undecided'. Both now call one function.
    expect(SITE).toContain('const dispositionKeyOf = useCallback((explicit?: string) =>');
    expect(SITE).toContain("explicit || activeSiteKeyRef.current || stateRef.current.activeSiteKey || ''");
    expect(SITE).toContain('const key = dispositionKeyOf(siteKey);');
    expect(SITE).toContain('if (!key) {');
    expect(SITE).toContain('console.warn(');

    // The parking is gone, in both halves.
    expect(SITE).not.toContain('pendingDispositionRef');

    // …and every caller names the property.
    //
    // 🚨 COUNTED WITH THE COMMENTS STRIPPED. The prose around these call sites
    // quotes the function name repeatedly, and an earlier version of this guard
    // counted those too — a guard satisfied by a comment about itself.
    const studioCode = STUDIO.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    const calls = studioCode.match(/setNativeDisposition\(/g) ?? [];
    // Six writers, and the audit that found this subsystem unreachable is why
    // there are now six rather than three: 'accepted' had NO writer at all, and
    // 'rejected' lived only inside a banner that the confirm click unmounts,
    // taking the app's only way to say "Google does not govern this property"
    // with it. 'undecided' is new too — it is the escape from 'custom', which
    // one stray traced section could set and nothing could clear.
    expect(calls.length, 'expected six call sites').toBe(6);
    expect(studioCode).toContain("setNativeDisposition('custom', enrichedPlane.siteKey)");
    // Every one of the other four names the property explicitly — a decision
    // filed against an empty key is dropped, and a decision filed against the
    // NEXT property to resolve marks the neighbour's house.
    // 🚨 NAMING THE PROPERTY IS THE POINT; THE SPELLING IS NOT.
    //
    // This required the second argument to be literally
    // `activeSiteKeyRef.current`, so it failed the moment a call site computed
    // the key into a local first -- which "Draw Manually Instead" now must,
    // because its rejection is deferred into a closure that runs only if the
    // deletion actually commits. The key is still the same expression; it just
    // has a name. What must never happen is a call with NO second argument,
    // which is what filed a decision against the neighbour's house.
    const named = studioCode.match(
      /setNativeDisposition\('(custom|rejected|accepted|undecided)',\s*[A-Za-z_$]/g) ?? [];
    // Six, not five: the widened pattern accepts any named expression, so it
    // now also matches the `enrichedPlane.siteKey` call that the narrow version
    // could not see and that the `toContain` above checks by name. Every call
    // site names its property, which is the property under test.
    expect(named.length, 'every call site must name the property').toBe(calls.length);
    expect(named.length).toBe(6);
    expect(studioCode, 'a disposition is filed with no property at all')
      .not.toMatch(/setNativeDisposition\('(custom|rejected|accepted|undecided)'\s*\)/);
    // The deferred one derives its key the same way as every other.
    expect(studioCode).toMatch(/const rejectKey = activeSiteKeyRef\.current/);
    // And all five states that a human can decide have a writer.
    for (const d of ['custom', 'rejected', 'accepted', 'undecided']) {
      expect(studioCode, `no writer for '${d}'`).toContain(`setNativeDisposition('${d}'`);
    }
  });

  it('🚨 the Undo chip is not buried under the other panels', () => {
    // `elementsFromPoint` over the live page found, in front of it: the LiDAR
    // Properties panel (z=60) and the top-left dock (z=51). The chip inherited
    // top:12/left:12/z=50 from the inert toolbar it replaced, so Undo could not
    // be clicked — by a test or by a person. Nobody noticed because the buttons
    // it replaced did nothing at all.
    const i = ENGINE.indexOf('<DraggablePanel id="undo-redo-toolbar"');
    expect(i, 'the undo toolbar is not mounted').toBeGreaterThan(-1);
    // Wide enough to reach the style object past the note that explains why
    // the chip sits where it does — the window used to be 900 and the
    // explanation pushed the anchor out of it.
    const block = ENGINE.slice(i, i + 2400);
    // 🚨 THE INVARIANT, NOT THE NUMBER. This used to pin `zIndex={62}` and
    // `zIndex: 62` literally. Those numbers were right when they were written
    // and said nothing about WHY: a later audit found eighteen more controls
    // buried the same way, and the order is now declared once, by role, in
    // `lib/3d/overlayLayers.ts`. Pinning a literal would have forced that file
    // to keep 62 for ever or this guard to be deleted — and the guard is the
    // point. So it asserts the thing the chip needs: a named layer that
    // outranks the two docks that buried it.
    expect(block, 'the undo chip picked a bare number instead of a named layer')
      .toMatch(/zIndex=\{OVERLAY_Z\.[A-Z_]+\}/);
    expect(OVERLAY_Z.ACTION, 'the undo chip no longer outranks the docks that buried it')
      .toBeGreaterThan(OVERLAY_Z.DOCK);
    expect(OVERLAY_Z.ACTION, 'the undo chip is under the LiDAR panel again')
      .toBeGreaterThan(OVERLAY_Z.DATA);
    expect(block, 'the undo chip is no longer on OVERLAY_Z.ACTION')
      .toMatch(/id="undo-redo-toolbar"\s+zIndex=\{OVERLAY_Z\.ACTION\}/);
    // And it is no longer in the corner the two docks occupy.
    expect(block).not.toMatch(/top: 12, left: 12/);
    // 🚨 NOR ON TOP OF THE "REPORT A BUG" BUTTON. That button is
    // `fixed bottom-4 left-4 z-[60]` in DesignStudio and owns the bottom ~52 px
    // of this corner. At `bottom: 12` the two overlap, and whichever wins the
    // other is unclickable — measured both ways round. Clearing it vertically
    // is the only outcome where both work.
    expect(block, 'the undo chip is back on top of the Report a Bug button')
      .not.toMatch(/bottom: 12, left: 12/);
    const bottom = /bottom: (\d+), left: 12/.exec(block);
    expect(bottom, 'the undo chip is no longer anchored bottom-left').toBeTruthy();
    expect(Number(bottom![1]), 'the undo chip overlaps the Report a Bug button again')
      .toBeGreaterThanOrEqual(56);
  });
});

describe('🚨 the panels come with the roof', () => {
  it('editSection repositions them, and does not leave the library uncalled', () => {
    // lib/3d/geometryHistory.ts spent a whole audit cycle "fully built, fully
    // tested and imported by nothing". A repositioning pass that nothing calls
    // would be the same defect: the unit tests would be green and the array
    // would still end up inside the house.
    // 🚨 ANCHORED ON `adoptGeometryOutcome`, NOT ON `editSection`.
    // The render/history/panel pipeline was extracted so that the new
    // per-face pitch edit goes through the SAME side effects rather than
    // growing its own 90%-identical copy — which is how "the panels went
    // inside the house" shipped twice. The invariant is unchanged; its
    // home moved, and the guard below proves `editSection` still routes
    // through it.
    const fn = bodyOf(ENGINE, 'function adoptGeometryOutcome(');
    expect(bodyOf(ENGINE, 'function editSection(')).toMatch(/adoptGeometryOutcome\(/);
    expect(bodyOf(ENGINE, 'function editFacePitch(')).toMatch(/adoptGeometryOutcome\(/);
    expect(fn).toMatch(/repositionPanelsForPlanes\(/);
    expect(fn).toMatch(/panelsRef\.current/);
    expect(fn).toMatch(/onPanelsChange\(moved\.panels\)/);

    // It must pass the OLD planes as the source frame. Passing the new ones for
    // both would map every panel through an identity and move nothing, while
    // reporting success.
    expect(fn).toMatch(/repositionPanelsForPlanes\(\s*held,\s*roofPlanesRef\.current \?\? \[\],\s*outcome\.planes/);

    // An orphan must reach the user. A panel standing on a face that no longer
    // exists, reported to nobody, is the "reports success" class again.
    expect(fn).toMatch(/moved\.orphaned\.length > 0/);
    expect(fn).toMatch(/setSectionRefusal\(/);
  });

  it('…and the repositioning happens AFTER the roof is emitted', () => {
    // The parent snapshots for undo when the roof arrives; panels must follow
    // that, not precede it, or an undo restores a roof whose panels were
    // already moved for the next state.
    const fn = bodyOf(ENGINE, 'function adoptGeometryOutcome(');
    const roof = fn.indexOf('onRoofGeometryReplaced?.(outcome.planes');
    const panels = fn.indexOf('repositionPanelsForPlanes(');
    expect(roof).toBeGreaterThan(-1);
    expect(panels).toBeGreaterThan(roof);
  });
});

describe('🚨 the selected LEVEL is visible in the scene, not just in the panel', () => {
  it('every roof-face highlight goes through faceIsInSelection', () => {
    // The highlight was `activeFaceId === planeId` at seven separate call
    // sites, so exactly ONE face lit up while the inspector read
    // "Garage · Hip roof · 4 faces" and its controls moved all four. The user
    // could not see what they were about to edit, and the picture disagreed
    // with the panel beside it — the same class as the WALLS readout, in
    // geometry instead of in a number.
    expect(ENGINE).toMatch(/function faceIsInSelection\(/);

    // Prove the forbidden pattern is a real one before forbidding it: a
    // `.not.toMatch` whose regex cannot fire passes against any source.
    const SINGLE = /activeFaceId === (planeId|plane\.id|id|pid|rp\.id|rf\.id|b\.faceId)/;
    expect('const isSelected = activeFaceId === planeId;').toMatch(SINGLE);
    expect(ENGINE, 'a highlight is still comparing against one face id').not.toMatch(SINGLE);

    // It must consult the LEVEL, or it would light the whole section even when
    // the user has deliberately drilled into one face.
    const fn = bodyOf(ENGINE, 'function faceIsInSelection(');
    expect(fn).toMatch(/selectionLevel !== 'section'/);
    expect(fn).toMatch(/sectionIdOfFaceId\(/);

    // …and the re-render must actually run when the level changes.
    expect(ENGINE).toMatch(/\[activeFaceId, selectionLevel, panelPlaneKey\]/);
  });
});

describe('🚨 undo brings the panels back too', () => {
  it('a restored roof repositions the array, symmetrically with the edit', () => {
    // `editSection` moves the array when the roof moves. An undo that restored
    // only the roof would be that defect in reverse: the geometry returns to
    // where it was and the modules stay where the edit had put them — a foot
    // ABOVE the roof instead of a foot below it.
    expect(SITE).toMatch(/from '@\/lib\/3d\/sectionEditing'/);
    expect(SITE).toMatch(/const applyRestoredGeometry = useCallback/);

    const fn = SITE.slice(
      SITE.indexOf('const applyRestoredGeometry = useCallback'),
      SITE.indexOf('const undoGeometry = useCallback'),
    );
    expect(fn).toMatch(/repositionPanelsForPlanes\(held, from, restored\)/);
    // The roof must be adopted before the panels are mapped onto it, and the
    // OLD planes must be the source frame — passing `restored` twice would map
    // every panel through an identity and move nothing while reporting success.
    expect(fn).toMatch(/const from = roofPlanesRef\.current \?\? \[\]/);

    // Both directions go through it. Redo has exactly the same obligation.
    for (const which of ['undoGeometry', 'redoGeometry']) {
      // 🚨 THE WINDOW ENDS WHERE THE FUNCTION DOES, NOT AT A MAGIC NUMBER.
      //
      // It was 500, then 1400, and it needed raising again the moment undo and
      // redo took on the destructive authorization — each time because the body
      // grew, and each time the failure looked like a regression in behaviour
      // rather than in the ruler. A slice that ends at the next declaration
      // cannot rot that way, and the coverage assertion below still proves the
      // window reaches the end rather than trusting that it does.
      const start = SITE.indexOf(`const ${which} = useCallback`);
      expect(start, `${which} is gone`).toBeGreaterThan(-1);
      const nextDecl = SITE.indexOf('\n  const ', start + 40);
      const body = SITE.slice(start, nextDecl > start ? nextDecl : start + 4000);
      expect(body, `the ${which} window does not cover the function`).toMatch(/return step\.label;/);
      // 🚨 THE SECOND ARGUMENT IS NOT COSMETIC. A DELETE step has already put
      // the exact panels back — repositioning them would map modules onto a
      // face that did not move, and `repositionPanelsForPlanes` matching a
      // restored face against a live roof that no longer contains it would
      // orphan the array. Every other step still repositions, as before.
      expect(body, `${which} must not adopt planes without its panels`).toMatch(/applyRestoredGeometry\(step\.planes, verbatim\)/);
      expect(body, `${which} must restore the panels a deletion took`).toMatch(/restorePanelsVerbatim\(step\.panels\)/);
      expect(body).not.toMatch(/setRoofPlanes\(step\.planes\)/);
    }
  });
});

describe('🚨 a control that cannot move the geometry is not offered', () => {
  it('the sidebar Slope slider and Direction buttons are read-only for a 3D-backed face', () => {
    // Both wrote `plane.pitch` / `plane.azimuth` and nothing else. For a face
    // carrying origin3D + ecefFrame3D — every face traced in 3D, and every
    // building-section face — `resolvePlaneGeometry` takes the FRAME ahead of
    // those scalars, so the roof, the deck, the panel grid and the shading kept
    // the old slope while the permit, the structural engine and the drawings
    // read the new number.
    //
    // An audit measured a 22° → 45° drag producing a byte-identical 24-panel
    // layout while the scalar read 45 and the true tilt stayed 22.243°.
    expect(STUDIO).toContain('{(plane.origin3D && plane.ecefFrame3D) ? (');
    expect(STUDIO).toContain('{(plane.origin3D && plane.ecefFrame3D) ? null : (');

    // The read-only branch reports the MEASURED value and says where to change it.
    const i = STUDIO.indexOf('{(plane.origin3D && plane.ecefFrame3D) ? (');
    const block = STUDIO.slice(i, i + 2_600);   // widened: the advice now carries its own rationale
    expect(block).toMatch(/measured/);
    expect(block).toMatch(/set its pitch in the inspector/);

    // 🚨 AND THE SLIDER SURVIVES FOR A 2D-ONLY FACE. A "Tag This Roof Plane"
    // face has no frame, so `computeEcefFrameForLegacyPlane` derives its
    // geometry FROM the scalar — the control is honest there, and removing it
    // outright would take away the only way to set that face's pitch.
    expect(STUDIO).toContain('type="range" min={0} max={45} step={1}');
    expect(STUDIO).toContain("p.id === plane.id ? { ...p, pitch: Number(e.target.value) } : p");
  });
});

describe('🚨 "Selected height" edits the block that is selected', () => {
  it('selection wins, with the last-placed block as the fallback', () => {
    // `setSelectedBlockId` fired when a person grabbed a block's handle and
    // `selectedBlockId` was read NOWHERE. The control labelled "Selected
    // height" read and wrote `lastPlacedBlockId` instead: draw the house, draw
    // the garage, grab the HOUSE's handle, drag the slider — the GARAGE changed
    // height and the house did not move.
    expect(ENGINE).toContain('const blockId = selectedBlockId || lastPlacedBlockId!;');
    expect(ENGINE).toContain("{placementMode === 'block' && (selectedBlockId || lastPlacedBlockId) ?");
    // The label tells the truth about which one it is acting on.
    expect(ENGINE).toContain("{selectedBlockId ? 'Selected height' : 'Last block height'}");
  });

  it('🚨 and the handle moves to a COORDINATE, not to a bare height', () => {
    // Both call sites built `new Cartesian3(cur.x, cur.y, v + 0.3)` — keeping
    // the block's ECEF x and y, which are millions of metres, and replacing z
    // with a metres-above-ground number. That writes the handle ~3,969 km
    // toward the equatorial plane, so it vanishes and the block can no longer
    // be grabbed. The same defect was measured in the drag handler.
    const fn = bodyOf(ENGINE, 'function setBlockHeight(');
    expect(fn).toMatch(/Cartographic\.fromCartesian\(cur\)/);
    // Built from the handle's own lat/lng plus a height — through
    // `safeCartesian3`, which also refuses a non-finite coordinate rather than
    // writing a NaN position that silently removes the handle.
    expect(fn).toMatch(/safeCartesian3\(\s*\n?\s*C, C\.Math\.toDegrees\(carto\.longitude\), C\.Math\.toDegrees\(carto\.latitude\)/);

    // 🚨 AND IT PIVOTS ON THE HANDLE, NOT ON THE BLOCK. A Cesium polygon entity
    // has no `position` at all — the creation path says so where it tags the
    // prism with `__centroidCart` instead — so the old `if (handle &&
    // block.position)` guard was never true and the handle never moved for ANY
    // height change. An audit found it while looking for something smaller.
    expect(fn).toMatch(/if \(handle\?\.position\)/);
    expect(fn).not.toMatch(/block\.position/);

    // 🚨 AND THE PREVIOUS HEIGHT IS READ BEFORE IT IS OVERWRITTEN. The read
    // used to come after the `set`, so `prior` was always the NEW height and
    // the arithmetic cancelled to "leave the handle where it is".
    const readAt = fn.indexOf('blockHeightOverridesRef.current.get(blockId)');
    const writeAt = fn.indexOf('blockHeightOverridesRef.current.set(blockId');
    expect(readAt).toBeGreaterThan(-1);
    expect(writeAt).toBeGreaterThan(-1);
    expect(readAt, 'the prior height must be read before it is overwritten').toBeLessThan(writeAt);

    // 🚨 THE GUARD EXCLUDES `cur.z + …`, DELIBERATELY. A first version banned
    // `new C.Cartesian3(cur.x, cur.y,` outright and caught a DIFFERENT line
    // that adds a delta to the existing z — a relative shift, not a height
    // substitution. Forbidding the shape instead of the mistake catches the
    // innocent. (That line was separately wrong for shifting along ECEF z
    // rather than the local vertical, and is fixed; the fallback it keeps for a
    // null normal is what this lookahead permits.)
    const BARE = /new C\.Cartesian3\(cur\.x, cur\.y, (?!cur\.z)/;
    expect('new C.Cartesian3(cur.x, cur.y, v + 0.3)').toMatch(BARE);
    expect('new C.Cartesian3(cur.x, cur.y, cur.z + delta)').not.toMatch(BARE);
    expect(ENGINE, 'a bare-height handle position is back').not.toMatch(BARE);
  });
});
