/**
 * tests/ghostModulePreviewAuthority.test.ts
 *
 * THE PREVIEW MUST NOT BE A SECOND PLACEMENT AUTHORITY.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Aurora and OpenSolar float a module under the cursor, already lying on the
 * plane of the face beneath it, so placement is aim-and-click. SolarPro made you
 * place -> look -> undo. That loop is what the ghost kills.
 *
 * 🚨 AND A PREVIEW THAT LIES IS WORSE THAN NO PREVIEW, because the operator aims
 * with it. This repo has already paid for that twice:
 *
 *   • the TREE cursor drew a constant 1.8 m canopy while the Tree preset places
 *     6.0 m — the circle installers aimed with was 36% of the footprint that
 *     appeared, and the Width box moved the tree but not the preview (7542c9b4).
 *   • `showGhostPanel` — the sequential next-slot ghost — computes its own
 *     flat-earth step (`111320`, `Math.cos(lat)`, an azimuth-derived ridge
 *     vector) instead of asking the placement path where the next module goes.
 *     It is a second authority in the same file, and it already shipped one
 *     defect of exactly this kind: it added the mount stack twice, so the ghost
 *     sat one stack ABOVE the module it was previewing.
 *
 * So the rule this file enforces is narrow and mechanical: THE CURSOR GHOST
 * CALLS THE SAME SNAPPER AND ORIENTER THE COMMIT CALLS, and the component that
 * draws it contains no placement maths of its own at all. `ModuleGhost` is
 * handed a pose and draws it; it cannot compute one, so it cannot disagree with
 * the commit.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT CANNOT BE PROVEN HERE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Nothing about how it LOOKS. Software WebGL does not rasterise the Cesium
 * scene: screenshots come back blank and `drillPick` returns zero hits, so a
 * browser acceptance test of this preview cannot work. These are source-level
 * and unit-level guards; the component's own behaviour (what it draws, from
 * what, and what it does when the pose is refused) is proven in
 * tests/moduleGhost.component.test.tsx with a fake viewer.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments, stripCommentsAndStrings } from './support/stripSource';
import { clickTargetPriority } from '@/components/3d/SolarEngine3D';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const ENGINE_RAW = read('components/3d/SolarEngine3D.tsx');
/** For identifier and call-shape scans: prose naming a function must not count. */
const ENGINE = stripCommentsAndStrings(ENGINE_RAW);
/** For literal scans (`'roof'`, `111320`). */
const ENGINE_LIT = stripComments(ENGINE_RAW);

const GHOST_RAW = read('components/3d/panel/ModuleGhost.tsx');
const GHOST = stripCommentsAndStrings(GHOST_RAW);

/**
 * Body of a named function declaration, to its closing brace at the given
 * indent.
 *
 * 🚨 NOT A FIXED-LENGTH SLICE. `stripComments*` blanks comments to WHITESPACE
 * rather than deleting them, so a fixed `slice(i, i + N)` shrinks in real code
 * every time someone adds a comment — which has silently broken guards in this
 * suite before. Anchor on real syntax.
 */
function bodyOf(src: string, name: string, indent = '  '): string {
  const i = src.indexOf(`function ${name}(`);
  expect(i, `function ${name} is gone — renamed or deleted`).toBeGreaterThan(-1);
  const end = src.indexOf(`\n${indent}}`, i);
  expect(end, `could not find the end of ${name}`).toBeGreaterThan(i);
  return src.slice(i, end);
}

// ═══════════════════════════════════════════════════════════════════════════
//  ITEM 1 — one snapper, two call sites
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 the ghost and the commit share ONE snapper/orienter', () => {
  it('the snapper exists and is a plain function of the click', () => {
    expect(ENGINE).toMatch(/function resolveRoofModulePose\(/);
  });

  it('the COMMIT goes through it', () => {
    const body = bodyOf(ENGINE, 'handleRoofClick');
    expect(body, 'handleRoofClick no longer asks the shared snapper where the module goes')
      .toMatch(/resolveRoofModulePose\(/);
  });

  it('🚨 and the commit no longer carries a private copy of the maths', () => {
    // Every one of these moved INTO the snapper. If one comes back here, the
    // ghost and the commit have started answering separately again — which is
    // the whole defect this work exists to prevent.
    const body = bodyOf(ENGINE, 'handleRoofClick');
    expect(body, 'the surface pick is back in the commit path').not.toMatch(/getWorldPosition\(/);
    expect(body, 'the face lookup is back in the commit path').not.toMatch(/planeRenderableAtClick\(/);
    expect(body, 'the normal estimate is back in the commit path').not.toMatch(/computeSurfaceNormal\(/);
  });

  it('the PREVIEW goes through the same snapper, and through the same orienter', () => {
    const body = bodyOf(ENGINE, 'resolveGhostModulePose');
    expect(body, 'the ghost resolver stopped calling the commit snapper — it is now a second authority')
      .toMatch(/resolveRoofModulePose\(/);
    expect(body, 'the ghost stopped using the renderer’s own pose derivation')
      .toMatch(/moduleEntityPose\(/);
  });

  /**
   * 🚨 THE PREVIEW MUST NOT BE PICKED BY THE PICK THAT POSITIONS IT.
   *
   * Found by reading the installed Cesium rather than by reasoning:
   * `SolarEngine3D` sets `scene.pickTranslucentDepth = true` at boot, and
   * `Picking.prototype.pickPositionWorldCoordinates` (1.139.1,
   * Build/CesiumUnminified/Cesium.js) reads that flag SYNCHRONOUSLY and calls
   * `renderTranslucentDepthForPick` when it is set. The ghost is wholly
   * translucent and sits under the cursor, and the snapper resolves its point
   * with `scene.pickPosition` — so the preview would be picked as the surface,
   * the mount stack would be added on top of the ghost's own face, and the ghost
   * would ratchet toward the camera one stack per mouse move.
   *
   * That is a self-referential preview: it drifts while the operator aims with
   * it. Nothing in a browser can catch it here (software WebGL rasterises
   * nothing), so it is caught at source or not at all.
   */
  it('🚨 the ghost resolve excludes TRANSLUCENT depth, and restores it in a finally', () => {
    const body = bodyOf(ENGINE, 'resolveGhostModulePose');
    expect(body, 'the ghost no longer excludes itself from the pick that positions it — it will ratchet')
      .toMatch(/scene\.pickTranslucentDepth = false;/);
    expect(body, 'the flag is not captured before being changed')
      .toMatch(/const pickTranslucentWas = scene\??\.pickTranslucentDepth;/);
    expect(body, 'the flag is not restored in a finally — one early return changes every other tool’s pick for the session')
      .toMatch(/\}\s*finally\s*\{[^}]*scene\.pickTranslucentDepth = pickTranslucentWas;/);
    // And the boot-time setting itself is still what makes this necessary. If it
    // is ever turned off globally, this guard should be revisited, not deleted.
    expect(ENGINE, 'the engine no longer enables translucent depth picking — re-read this guard')
      .toMatch(/viewer\.scene\.pickTranslucentDepth = true;/);
  });

  it('the ghost copies no INERT property from the renderer', () => {
    // `addPanelEntity` passes `disableDepthTestDistance` inside `box: {…}` and
    // `BoxGraphics` has no such property — verified against the installed
    // Cesium.d.ts. Copying it into the preview would copy a no-op and imply it
    // does something, which is how a comment ends up talking a future fix out of
    // existence.
    expect(GHOST, 'the ghost copied the renderer’s inert depth-test property')
      .not.toMatch(/disableDepthTestDistance/);
  });

  it('🚨 the snapper still lifts the module by the MOUNT STACK, on the plane normal', () => {
    // Found by mutation: setting the offset to 0 in the extracted snapper changed
    // nothing that any test could see, and this repo has a ★★★ memory entry
    // titled "ONE roof mount datum — there were six", one of which was a
    // 14 cm-per-reload ratchet. The datum was never covered here while it was
    // inline in the click handler; extracting it is what made it guardable, so it
    // is guarded.
    const body = bodyOf(ENGINE, 'resolveRoofModulePose');
    expect(body, 'the mount stack is no longer consulted — modules will sit ON the deck')
      .toMatch(/const offM = moduleStackHeightM\(mountingSystemIdRef\.current\);/);
    // …and it is applied ALONG THE FACE NORMAL, not added to an altitude. An
    // extrudedHeight-style mistake here tilts the whole array off its own plane.
    expect(body, 'the offset is no longer applied along the plane normal')
      .toMatch(/C\.Cartesian3\.multiplyByScalar\(rp\.n, offM,/);
    // The off-face branch has no plane normal, so it adds the stack to the picked
    // altitude — which is what it has always done.
    expect(body, 'the off-face branch stopped lifting the module at all')
      .toMatch(/height: pHeight \+ offM,/);
  });

  it('🚨 the box axis order is written where BOTH the renderer and the ghost read it', () => {
    // Also found by mutation: swapping (ph, pw) to (pw, ph) draws every module
    // rotated 90 degrees and no unit test can see it — a Cesium box's real extents
    // need a real Cesium (`e2e/panel-above-deck.spec.ts` reasons about the same
    // triple in prose). What makes that survivable is that the renderer and the
    // cursor ghost now read ONE expression, so they turn together and cannot
    // disagree. This pins that expression.
    const body = bodyOf(ENGINE, 'moduleEntityPose');
    expect(body, 'the shared box extents changed shape, or moved out of the orienter')
      .toMatch(/new C\.Cartesian3\(ph, pw, PT\)/);

    // 🚨 AND THE COUNT IS 2, NOT 1, AND THAT IS A FINDING RATHER THAN A PASS.
    //
    // `showGhostPanel` — the next-slot ghost drawn AFTER a placement — packs the
    // same triple itself, because it is a separate preview with its own
    // flat-earth step for where the next module goes. It is the in-repo proof of
    // why the cursor ghost must not work that way, and it is deliberately left
    // alone here: retiring it is its own change, with its own evidence. If a
    // THIRD packer appears, this fails and someone has to justify it.
    const packs = (ENGINE.match(/new C\.Cartesian3\(ph, pw, PT\)/g) ?? []).length;
    expect(packs,
      `the frame-box extents are packed in ${packs} places (expected 2: the shared orienter, and showGhostPanel's separate next-slot preview)`)
      .toBe(2);
    expect(bodyOf(ENGINE, 'showGhostPanel'), 'the second packer is no longer showGhostPanel — re-check this guard')
      .toMatch(/new C\.Cartesian3\(ph, pw, PT\)/);
  });

  it('the orienter has exactly two callers: the renderer and the ghost', () => {
    // A third caller is not forbidden, but it must be looked at: every caller of
    // this is something that decides how a module LIES, and they must agree.
    const calls = (ENGINE.match(/moduleEntityPose\(/g) ?? []).length;
    expect(calls,
      `moduleEntityPose has ${calls} call sites (expected the declaration + renderer + ghost = 3 occurrences)`)
      .toBe(3);
    expect(bodyOf(ENGINE, 'addPanelEntity'), 'the renderer stopped using the shared orienter')
      .toMatch(/moduleEntityPose\(/);
  });
});

describe('🚨 the ghost component cannot compute a placement of its own', () => {
  /**
   * 🚨 THIS IS THE ASSERTION THE WHOLE FEATURE TURNS ON.
   *
   * TreeCursor deliberately duplicated the engine's 3-tier pick chain ("we do
   * NOT import getWorldPosition ... duplicating the chain in 10 lines keeps this
   * component standalone"). That was survivable for a CIRCLE ON THE GROUND and
   * it still shipped the wrong SIZE. A module has a position, a pitch, an
   * azimuth, an in-plane heading and a footprint, and every one of them is a
   * chance for the preview to disagree with the commit.
   *
   * So ModuleGhost takes the answer as a prop. It is a renderer.
   */
  it('does not pick the scene', () => {
    expect(GHOST, 'the ghost picks the scene itself — it must be handed the resolved pose')
      .not.toMatch(/scene\.pick|pickPosition|getPickRay|globe\s*\?\?\.\s*pick|globe\.pick|pickEllipsoid/);
  });

  it('does not resolve a face or a surface normal', () => {
    expect(GHOST).not.toMatch(/planeRenderableAtClick|computeSurfaceNormal|nearestFaceAlongRay|resolvePlacementPoint/);
  });

  it('does not build an orientation', () => {
    // heading/pitch/roll -> quaternion is the ORIENTER's job, and the orienter
    // is the one the renderer uses. A quaternion built here is a second answer
    // to "how does this module lie".
    expect(GHOST, 'the ghost builds its own orientation')
      .not.toMatch(/HeadingPitchRoll|headingPitchRollQuaternion|fromQuaternion/);
  });

  it('does not convert degrees to metres, or metres to degrees', () => {
    // `showGhostPanel`'s flat-earth step is the in-repo example of a preview
    // doing its own geodesy. 111320 / 111132 / Math.cos(lat) have no business
    // in a component that is handed an ECEF position.
    const lit = stripComments(GHOST_RAW);
    expect(lit, 'the ghost is doing its own geodesy').not.toMatch(/111_?320|111_?132/);
    expect(GHOST, 'the ghost is deriving a position from degrees').not.toMatch(/fromDegrees/);
  });

  it('takes the pose from an injected resolver, read through a ref', () => {
    // A prop read directly inside the MOUSE_MOVE closure would be frozen at the
    // render that created the handler — the same mount-frozen-closure trap the
    // engine documents. TreeCursor gets this right for its radius; so must this.
    expect(GHOST).toMatch(/resolvePose/);
    expect(GHOST, 'the resolver is not read through a ref — its closure is frozen at mount')
      .toMatch(/resolveRef\.current/);
  });
});

describe('🚨 the ghost adds no new gesture and no duplicate registration', () => {
  it('the engine still registers exactly the input actions it had', () => {
    // `setInputAction` is a plain assignment into a keyed map: a second
    // registration for the same type on the SAME handler silently deletes the
    // first. The ghost must not have added one.
    const types: string[] = ENGINE.match(/\}, C\.ScreenSpaceEventType\.[A-Z_]+/g) ?? [];
    expect(types.length, 'an input action was added or removed on the engine handlers').toBe(8);
    const moveRegistrations = types.filter(t => t.endsWith('MOUSE_MOVE')).length;
    expect(moveRegistrations, 'a third MOUSE_MOVE registration appeared on the engine handlers').toBe(2);
  });

  it('the ghost registers MOUSE_MOVE and nothing else', () => {
    // A hover owns no press, so it competes with no camera pan. The moment it
    // takes LEFT_DOWN it is a drag and must claim the pointer — see
    // tests/pointerGestureAuthority.test.ts, which already blesses TreeCursor on
    // exactly this basis.
    const registrations = GHOST.match(/ScreenSpaceEventType\.[A-Z_]+/g) ?? [];
    expect(registrations).toEqual(['ScreenSpaceEventType.MOUSE_MOVE']);
    expect((GHOST.match(/setInputAction\(/g) ?? []).length, 'more than one registration in the ghost').toBe(1);
  });

  it('and it is mounted, armed by the module tool', () => {
    expect(ENGINE_LIT).toMatch(/<ModuleGhost/);
    expect(ENGINE_LIT, 'the ghost is not armed by the Roof (module) tool')
      .toMatch(/active=\{placementMode === 'roof'\}/);
    expect(ENGINE_LIT, 'the ghost is not handed the resolver').toMatch(/resolvePose=\{/);
  });

  it('the preview casts no shadow — it is not a real module', () => {
    // A GeometryUpdater defaults `shadows` to DISABLED, so this is belt and
    // braces. It is written explicitly because the opposite mistake (an entity
    // that silently refuses to cast) has cost this repo a session, and a future
    // reader must see that the silence is deliberate here.
    expect(GHOST).toMatch(/ShadowMode\.DISABLED/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  ITEM 2 — pick priority, conditioned on the armed tool
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 a site object stops swallowing clicks on the modules around it', () => {
  /**
   * THE DEFECT, MEASURED.
   *
   * `pickObstructionAtScreen` ran FIRST and unconditionally in the only path
   * that picks a module for selection. Its GPU branch walks up to 12 drill hits
   * looking for an `[OBS] ` name and returns the FIRST one it finds without
   * asking whether anything is in front of it — so a tree behind a module wins
   * the click. Its analytic fallback (the branch that is live under software
   * WebGL, and on any machine without a usable GPU) is a BOUNDING SPHERE of
   * radius `max(max(w,d)/2, h/2)`: for the shipped Tree preset, 6.0 x 6.0 x 8.0,
   * that is 4.0 m. Every click within four metres of a trunk — straight through
   * a module, in any direction — selected the tree, and the branch then called
   * `clearPanelSelection()`, so the module became unselectable, unmovable and
   * undeletable exactly where trees are.
   *
   * That is the same shape as the `[BUILD3D-ROOF]` defect already fixed one
   * screen above it ("a panel in front of the roof wins, in both modes"), and it
   * gets the same resolution: ask whether a module is under the cursor first,
   * and let the site object answer when none is.
   */
  it('the module pick runs BEFORE the site-object pick', () => {
    const body = bodyOf(ENGINE, 'handleSelectClick');
    const panel = body.indexOf('pickPanelAtScreen(viewer, screenPos)');
    const obs = body.indexOf('pickObstructionAtScreen(viewer, screenPos)');
    expect(panel, 'handleSelectClick no longer picks a module').toBeGreaterThan(-1);
    expect(obs, 'handleSelectClick no longer picks a site object').toBeGreaterThan(-1);
    expect(obs, 'the site-object pick is back in front of the module pick — it will swallow module clicks again')
      .toBeGreaterThan(panel);
  });

  it('the site-object pick is GATED by the armed tool, not deleted', () => {
    // 🚨 NOT BY REMOVING ANYTHING FROM THE PICK SET. A tree must stay
    // selectable — clicking bare canopy, with no module under the cursor, still
    // selects it. What changed is only WHO WINS when both answer.
    const body = bodyOf(ENGINE, 'handleSelectClick');
    const panel = body.indexOf('pickPanelAtScreen(viewer, screenPos)');
    const obs = body.indexOf('pickObstructionAtScreen(viewer, screenPos)');
    const gate = body.slice(panel, obs);
    expect(gate, 'the obstruction pick is no longer conditioned on the armed tool')
      .toMatch(/clickTargetPriority\(/);
    expect(body, 'the site object is no longer pickable at all — that is not the fix')
      .toMatch(/pickObstructionAtScreen\(/);
  });

  it('the priority is read from the LIVE armed tool, not a captured variable', () => {
    // handleSelectClick is reached only from a Cesium handler registered once at
    // viewer init, so its closure is frozen at mount. A `placementMode` read
    // here would be the mode the page booted in, for ever.
    const body = bodyOf(ENGINE, 'handleSelectClick');
    expect(body).toMatch(/clickTargetPriority\(modeRef\.current\)/);
  });

  it('one drill-pick per click, not two', () => {
    // `pickPanelAtScreen` walks up to 32 hits. Calling it twice doubles that on
    // every click in the mode people spend all their time in.
    const body = bodyOf(ENGINE, 'handleSelectClick');
    const calls = (body.match(/pickPanelAtScreen\(/g) ?? []).length;
    expect(calls, `pickPanelAtScreen is called ${calls} times in handleSelectClick (paint path + the shared pick = 2)`)
      .toBe(2);
  });
});

describe('clickTargetPriority — the rule, in isolation', () => {
  it('🚨 a site object wins outright when its OWN tool is armed', () => {
    // The requirement is explicit: pick priority conditioned on the armed tool,
    // and an object must still be pickable when its own tool is armed. So with
    // Tree or Add Obstruction armed the object wins even with a module in front
    // of it — that is how a tree standing in the middle of an array stays
    // resizable and deletable.
    expect(clickTargetPriority('tree')).toBe('site-object-first');
    expect(clickTargetPriority('obstruction')).toBe('site-object-first');
  });

  it('every module-facing tool puts the module first', () => {
    for (const mode of ['select', 'roof', 'row', 'snap_panel', 'extend_row', 'add_row',
      'surface_select', 'plane3d', 'auto_roof', 'ground', 'ground_array', 'fence'] as const) {
      expect(clickTargetPriority(mode), `${mode} must put the module first`).toBe('module-first');
    }
  });

  it('an unknown tool puts the module first — the safe default', () => {
    // A new tool that forgets to declare itself must not inherit the defect.
    // Modules are the thing there are hundreds of; a site object is still
    // reachable by clicking a part of it no module covers.
    expect(clickTargetPriority('measure')).toBe('module-first');
    expect(clickTargetPriority('vertex')).toBe('module-first');
  });

  it('🚨 the answers are STRING discriminants', () => {
    // `strict: false` is set in this project's tsconfig, so a boolean
    // discriminated union does NOT narrow and a `true`/`false` return would
    // read as "obstruction? yes/no" at the call site with nothing naming which
    // way round it is. Both answers say what they mean.
    expect(new Set([clickTargetPriority('tree'), clickTargetPriority('select')]))
      .toEqual(new Set(['site-object-first', 'module-first']));
  });
});
