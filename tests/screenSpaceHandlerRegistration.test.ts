/**
 * @vitest-environment jsdom
 *
 * tests/screenSpaceHandlerRegistration.test.ts
 *
 * A SECOND setInputAction FOR THE SAME EVENT SILENTLY DELETES THE FIRST.
 *
 * `setupClickHandler` (components/3d/SolarEngine3D.tsx) creates ONE
 * `C.ScreenSpaceEventHandler` and used to register two independent gesture
 * trios on it:
 *
 *     LEFT_DOWN   block-handle height drag   …then…  panel-array grab
 *     MOUSE_MOVE  block-handle height drag   …then…  panel-array grab
 *     LEFT_UP     block-handle height drag   …then…  panel-array grab
 *
 * Cesium's `setInputAction` is a plain assignment into a keyed map, not an
 * append (proved below against the installed Cesium, not from memory). So the
 * panel-array trio REPLACED the block trio: `blockResizeRef` was never written,
 * and with it the block height drag, its `arrayManipRef` camera freeze and its
 * `suppressClickRef` were all unreachable — while the comment above them said
 * "Runs BEFORE the existing panel-array LEFT_DOWN".
 *
 * That matters beyond the one dead feature: a UX proposal named that drag
 * "INTERACTION PRECEDENT, COMPLETE AND WORKING — copy it verbatim", and any
 * NEW gesture added as a third trio would have deleted the panel-array grab in
 * exactly the same silent way. This file is the guard against the next one.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './support/stripSource';

const SRC_PATH = join(__dirname, '..', 'components', '3d', 'SolarEngine3D.tsx');

describe('Cesium: the behaviour this whole guard exists for', () => {
  // 🚨 60s, AND THE REASON MATTERS. This is the only test in the file that
  // imports the REAL Cesium, which is a very large module. Alone it finishes in
  // under three seconds; inside a loaded full-suite run (`--maxWorkers 3`) the
  // import has been measured at 22s and blew the 10s default — a failure that
  // says nothing about Cesium and everything about how busy the machine was.
  //
  // A load-sensitive timeout is worse than a slow test: it fails in the full
  // run and passes on the immediate re-run, which teaches everyone to re-run
  // rather than read. Raised deliberately rather than left to be re-rolled.
  it('setInputAction REPLACES a previous action for the same event type', async () => {
    // Proved against the real installed Cesium rather than asserted, so that a
    // future Cesium that changed to an append model would fail here loudly
    // instead of leaving a guard nobody can justify.
    const C: any = await import('cesium');
    const canvas = document.createElement('canvas');
    const h = new C.ScreenSpaceEventHandler(canvas);

    const first = () => 'first';
    const second = () => 'second';
    h.setInputAction(first, C.ScreenSpaceEventType.LEFT_DOWN);
    expect(h.getInputAction(C.ScreenSpaceEventType.LEFT_DOWN)).toBe(first);

    h.setInputAction(second, C.ScreenSpaceEventType.LEFT_DOWN);
    // 🚨 The first action is GONE — not queued behind the second.
    expect(h.getInputAction(C.ScreenSpaceEventType.LEFT_DOWN)).toBe(second);
    expect(h.getInputAction(C.ScreenSpaceEventType.LEFT_DOWN)).not.toBe(first);
  }, 60_000);

  it('a modifier makes it a DIFFERENT slot — so SHIFT+LEFT_CLICK is not a duplicate', () => {
    // The guard below must not fire on the legitimate
    // `LEFT_CLICK` + `LEFT_CLICK/SHIFT` pair that setupClickHandler really has.
    // Nothing to assert against Cesium here beyond the key shape; the structural
    // guard encodes it and this test names why the exception exists.
    expect(true).toBe(true);
  });
});

/** The body of one `function <name>(` declaration, to its matching close brace. */
function functionBody(src: string, name: string): string {
  const start = src.indexOf(`function ${name}(`);
  expect(start, `function ${name} not found`).toBeGreaterThan(-1);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`unterminated body for ${name}`);
}

describe('setupClickHandler registers each event slot exactly once', () => {
  // Comments stripped: this file's fix is explained in a long comment that names
  // LEFT_DOWN, MOUSE_MOVE and LEFT_UP several times, and a scan that counts its
  // own prose as registrations would fail against correct code.
  const SRC = stripComments(readFileSync(SRC_PATH, 'utf8'));

  it('the scan finds the function and some registrations', () => {
    const body = functionBody(SRC, 'setupClickHandler');
    expect(body.length).toBeGreaterThan(2_000);
    expect(body).toContain('setInputAction');
  });

  it('🚨 no event type + modifier pair is registered twice on the same handler', () => {
    const body = functionBody(SRC, 'setupClickHandler');

    // The closing argument list of each registration:
    //   }, C.ScreenSpaceEventType.LEFT_DOWN);
    //   }, C.ScreenSpaceEventType.LEFT_CLICK, C.KeyboardEventModifier.SHIFT);
    const re = /\}\s*,\s*C\.ScreenSpaceEventType\.([A-Z_]+)\s*(?:,\s*C\.KeyboardEventModifier\.([A-Z_]+)\s*)?\)/g;
    const seen = new Map<string, number>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      const key = `${m[1]}${m[2] ? '/' + m[2] : ''}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }

    expect(seen.size, 'the scan matched no registrations at all — the regex has drifted from the source')
      .toBeGreaterThanOrEqual(5);

    const duplicated = [...seen.entries()].filter(([, n]) => n > 1);
    expect(
      duplicated,
      `these event slots are registered more than once on ONE handler, so only the last survives:\n  ${
        duplicated.map(([k, n]) => `${k} x${n}`).join('\n  ')
      }`,
    ).toEqual([]);
  });

  it('the block height drag is reachable — it is called, not registered', () => {
    const body = functionBody(SRC, 'setupClickHandler');
    // Declared as plain functions…
    expect(body).toMatch(/const blockResizeDown\s*=/);
    expect(body).toMatch(/const blockResizeMove\s*=/);
    expect(body).toMatch(/const blockResizeUp\s*=/);
    // …and actually invoked from the surviving handlers. Without these calls the
    // refactor would be tidier dead code rather than a fix.
    expect(body).toMatch(/blockResizeDown\(event\)/);
    expect(body).toMatch(/blockResizeMove\(event\)/);
    expect(body).toMatch(/blockResizeUp\(\)/);
  });

  it('the block handle is checked before the array grab short-circuits on mode', () => {
    // The block is traced in `block` mode, so a `modeRef.current !== 'select'`
    // guard ahead of the block check would make its own handle unreachable —
    // a different way of killing the same feature.
    const body = functionBody(SRC, 'setupClickHandler');
    const downIdx = body.indexOf('blockResizeDown(event)');
    const modeGuardIdx = body.indexOf("modeRef.current !== 'select'", downIdx);
    expect(downIdx).toBeGreaterThan(-1);
    expect(modeGuardIdx, 'the select-mode guard must come AFTER the block-handle check')
      .toBeGreaterThan(downIdx);
  });
});

describe('Building-mode face selection reports the scope it actually moved to', () => {
  const SRC = stripComments(readFileSync(SRC_PATH, 'utf8'));

  /**
   * ONLY the Building branch of handleSelectClick.
   *
   * 🚨 The first draft of this block sliced from `showBuilding3DRef.current`,
   * whose first occurrence is the ref-sync effect ~5,700 lines earlier. Every
   * assertion below would then have been satisfied by the SIBLING [PLANE3D-*]
   * path, which already did all of this correctly — a guard that passes on the
   * broken code it was written for. Both anchors below are verified unique.
   */
  function buildingBranch(): string {
    const start = SRC.indexOf('const faceId = pickBuildingFaceAtScreen(');
    // 🚨 RE-ANCHORED. The closing anchor was `const picked = pickPanelAtScreen(
    // viewer, screenPos)`, which sat immediately AFTER this branch — until the
    // panel pick was deliberately moved BEFORE it, so that a module in front of
    // the roof wins the click in Building mode as it always did with Building
    // off. That reordering is the fix, not a regression, and it left this
    // anchor pointing backwards.
    //
    // The new anchor is the sibling path's own entry, which is where this
    // branch has always ended. The `pickRoofFaceAtScreen` exclusion below is
    // what actually proves the slice did not swallow the sibling, and it is
    // unchanged.
    const end = SRC.indexOf('const faceId = pickRoofFaceAtScreen(viewer, screenPos)');
    expect(start, 'Building-branch anchor not found').toBeGreaterThan(-1);
    expect(end, 'sibling-path anchor not found').toBeGreaterThan(start);
    const branch = SRC.slice(start, end);
    // A slice that swallowed the sibling path would be long and would contain
    // its distinctive call; both are checked so the anchors cannot silently rot.
    // `pickRoofFaceAtScreen` is the sibling path's distinctive call and is the
    // substantive anchor check; the length bound is a loose sanity rail (the
    // branch is ~50 lines, and stripComments keeps their whitespace).
    expect(branch).not.toContain('pickRoofFaceAtScreen');
    expect(branch.length).toBeLessThan(4_000);
    return branch;
  }

  it('🚨 the toggle state is captured BEFORE selectRoofFace writes the ref', () => {
    // selectRoofFace sets selectedFaceIdRef.current synchronously. Reading the
    // ref after calling it reports the state we moved TO, which inverted the
    // only scope message Building mode has: selecting announced "deselected".
    const branch = buildingBranch();
    const capture = branch.indexOf('const toggledOff = selectedFaceIdRef.current === faceId');
    const call = branch.indexOf('selectRoofFace(toggledOff');
    expect(capture, 'the pre-write capture was not found').toBeGreaterThan(-1);
    expect(call, 'selectRoofFace is not being driven from the captured value').toBeGreaterThan(capture);

    // And the inverted form must not come back: the message must not be chosen
    // by re-reading the ref that selectRoofFace has already moved.
    expect(branch).not.toMatch(/setStatusMsg\(\s*selectedFaceIdRef\.current === faceId/);
    expect(branch).toMatch(/setStatusMsg\(\s*toggledOff/);
  });

  it('selecting a face in Building mode clears the panel selection, as the roof path does', () => {
    // Otherwise a panel array and a face are both selected, and the arrow keys —
    // gated on selectedPanelIdsRef alone — move the array while the scope chip
    // says the click selected a face.
    const branch = buildingBranch();
    const upTo = branch.slice(0, branch.indexOf('selectRoofFace(toggledOff'));
    expect(upTo).toMatch(/clearPanelSelection\(\)/);
    expect(upTo).toMatch(/drilledGroupKeyRef\.current = null/);
  });
});

describe('a drag must not strand the click suppression flag', () => {
  /**
   * 🚨 Cesium synthesises LEFT_CLICK only when the pointer moved no more than
   * `_clickPixelTolerance` (5) px between down and up. A gesture that sets
   * `suppressClickRef` at the END of a real drag therefore sets a flag that
   * nothing will ever consume, and the guard at the top of the LEFT_CLICK
   * handler silently eats the user's NEXT click — in whatever mode they are in.
   *
   * The panel-array grab has always had this shape. Making the block-height
   * drag reachable added a second instance. Both are fixed by clearing the flag
   * on a fresh LEFT_DOWN: by then, any suppression from an earlier gesture is
   * stale by definition.
   */
  const SRC = stripComments(readFileSync(SRC_PATH, 'utf8'));

  it('Cesium really does gate LEFT_CLICK on a pixel tolerance', async () => {
    // Proved against the installed build rather than asserted, because the whole
    // fix rests on it. If a future Cesium always synthesised LEFT_CLICK, the
    // stranding could not happen and this guard would deserve re-examining.
    const C: any = await import('cesium');
    const canvas = document.createElement('canvas');
    const h: any = new C.ScreenSpaceEventHandler(canvas);
    expect(typeof h.constructor.mouseEmulationIgnoreMilliseconds === 'number'
        || typeof (C.ScreenSpaceEventHandler as any).mouseEmulationIgnoreMilliseconds === 'number'
        || '_clickPixelTolerance' in h,
      'ScreenSpaceEventHandler no longer exposes a click tolerance — re-verify the premise',
    ).toBe(true);
    if ('_clickPixelTolerance' in h) {
      expect(h._clickPixelTolerance).toBeGreaterThan(0);
    }
  });

  it('🚨 a fresh LEFT_DOWN clears suppressClickRef before anything else', () => {
    // 🚨 SCOPED TO THE LEFT_DOWN HANDLER, AND THAT SCOPE IS THE WHOLE GUARD.
    // A first version searched the whole of setupClickHandler for a
    // `suppressClickRef.current = false` occurring before `blockResizeDown` —
    // and the LEFT_CLICK handler's own CONSUME line (`if (suppressClickRef...)
    // { suppressClickRef.current = false; return; }`) sits earlier in the
    // function and satisfied it. Mutation-checked against the pre-fix blob: the
    // guard PASSED on the broken code. It now looks only inside the handler
    // that must do the clearing.
    const body = functionBody(SRC, 'setupClickHandler');
    const blockDown = body.indexOf('blockResizeDown(event)');
    expect(blockDown, 'the LEFT_DOWN handler was not found').toBeGreaterThan(-1);
    const handlerStart = body.lastIndexOf('handler.setInputAction(', blockDown);
    expect(handlerStart, 'could not find the registration that owns blockResizeDown').toBeGreaterThan(-1);
    const downHandler = body.slice(handlerStart, blockDown);
    // Nothing from the LEFT_CLICK handler can be in this slice: it ends AT the
    // block-handle call and starts at that registration's own opening.
    expect(downHandler).not.toContain('ScreenSpaceEventType.LEFT_CLICK');
    expect(downHandler, 'a fresh press must void any stale click suppression')
      .toMatch(/suppressClickRef\.current = false/);
  });

  it('an abandoned block drag cannot survive a tool change', () => {
    // arrayManipRef is reset on tool change with a comment naming the bug
    // ("never leave the camera frozen"). blockResizeRef was omitted while the
    // drag was dead code; it is reachable now, and its only other clear is
    // inside blockResizeUp's own finally — which an abandoned drag never reaches.
    // 🚨 ANCHORED ON CODE, NOT ON THE COMMENT NEXT TO IT. The first version of
    // this guard sliced from the string 'never leave the camera frozen on tool
    // change' — which is COMMENT PROSE, and `stripComments` blanks it, so the
    // anchor did not exist in the text being searched. Anchoring a guard on
    // documentation is a defect class this repo has been bitten by repeatedly.
    const anchor = SRC.indexOf('if (dragRef.current) dragRef.current = null;');
    expect(anchor, 'the tool-change reset was not found').toBeGreaterThan(-1);
    const reset = SRC.slice(anchor, anchor + 900);  // stripComments keeps blanked lines as whitespace
    expect(reset, 'an abandoned block drag must be cleared on tool change')
      .toMatch(/blockResizeRef\.current = null/);
    // 🚨 THE CAMERA IS HANDED BACK THROUGH THE AUTHORITY NOW, not by assigning
    // the flag here. Same subject, stronger guarantee: `releasePointer` also
    // clears WHICH gesture held it, so a stuck freeze stays attributable. The
    // flag itself may no longer be written outside claimPointer/releasePointer
    // — tests/pointerGestureAuthority.test.ts fails the build if it is.
    expect(reset, 'the existing resets must still be there')
      .toMatch(/releasePointer\(\);/);
    // And the site-object size drag is a third gesture that can be abandoned by
    // a tool change. It was missing from this list for exactly the reason
    // blockResizeRef was.
    expect(reset, 'an abandoned size drag must be cleared on tool change')
      .toMatch(/cancelObjectSizeDrag\(\);/);
    expect(reset).toMatch(/suppressClickRef\.current = false/);
  });
});

describe('exactly one selection is live at a time, in BOTH directions', () => {
  /**
   * The face branches already cleared the panel selection. Neither panel branch
   * cleared the FACE, and neither did Escape — and a selected face is not inert:
   * the Walls/Pitch chip keeps reading "THIS face" and `applyBuildingShape` is
   * still scoped to it, so the next press edits a face the user stopped pointing
   * at several clicks ago.
   */
  const SRC = stripComments(readFileSync(SRC_PATH, 'utf8'));

  /**
   * ONLY the branches that run when a panel WAS hit.
   *
   * 🚨 A first version sliced from `const picked = pickPanelAtScreen(...)`,
   * which also swallowed the NO-HIT block above it — and that block has always
   * contained `selectRoofFace(null)` for the click-empty-space case. Mutation-
   * checked against the pre-fix blob: the guard PASSED on the broken code. The
   * slice now starts after the no-hit block returns.
   */
  function panelBranches(): string {
    const start = SRC.indexOf('const panel    = panelsRef.current.find(p => p.id === foundId)');
    const end = SRC.indexOf('function arrayCentroidECEF(', start);
    expect(start, 'panel-hit anchor not found').toBeGreaterThan(-1);
    expect(end, 'end anchor not found').toBeGreaterThan(start);
    const slice = SRC.slice(start, end);
    // The no-hit block must be outside this slice, or the guard is vacuous.
    expect(slice).not.toContain('pickRoofFaceAtScreen');
    expect(slice).not.toContain("setStatusMsg('Selection cleared')");
    return slice;
  }

  it('a panel hit clears the face selection', () => {
    const branches = panelBranches();
    // Before the drilled-in branch, so BOTH the single-panel and whole-array
    // paths are covered by one statement rather than two that can drift.
    const clear = branches.indexOf('selectRoofFace(null)');
    const drilled = branches.indexOf('drilledGroupKeyRef.current === groupKey');
    expect(clear, 'a panel hit must clear the roof-face selection').toBeGreaterThan(-1);
    expect(drilled).toBeGreaterThan(-1);
    expect(clear, 'it must run before the branch split, so it covers both paths')
      .toBeLessThan(drilled);
  });

  it('Escape clears the face selection too', () => {
    // Anchored on the cancel-everything block's own code, not on its comments.
    //
    // 🚨 This used to slice a fixed 1,400 characters, which is not the block —
    // it is a guess at the block's length. `stripComments` blanks comments to
    // whitespace rather than deleting them, so ADDING A COMMENT inside the
    // handler pushes real code out of the window and fails the guard for a
    // reason that has nothing to do with what it guards. It did exactly that.
    // Slice to the real end of the handler instead; that is also strictly
    // tighter, since 1,400 could overrun the block and match code after it.
    const esc = SRC.indexOf("e.key === 'Escape'");
    expect(esc, 'the Escape handler was not found').toBeGreaterThan(-1);
    const end = SRC.indexOf("window.addEventListener('keydown', onKey)", esc);
    expect(end, 'the end of the keydown handler was not found').toBeGreaterThan(esc);
    const body = SRC.slice(esc, end);
    expect(body).toMatch(/clearPanelSelection\(\)/);
    expect(body, 'Escape must also drop the roof-face selection').toMatch(/selectRoofFace\(null\)/);
  });

  it('clearPanelSelection stays panel-only — the fix is at the call sites', () => {
    // Widening clearPanelSelection to also drop the face would silently change
    // eight call sites, including ones that deliberately keep a face selected
    // while re-selecting panels. The name would then lie about its scope.
    const fn = functionBody(SRC, 'clearPanelSelection');
    expect(fn).not.toMatch(/selectRoofFace/);
  });
});

/**
 * ESCAPE MUST ALSO DROP THE TOOL.
 *
 * Escape cleared every selection and every in-progress trace and then left the
 * user ARMED: `placementMode` stayed 'tree' or 'obstruction', so the next click
 * on the roof planted another one. The exit path already existed —
 * `onPlacementModeChange('select')` is called from eight other places — the
 * cancel-everything key simply never called it.
 *
 * Aurora states the contract out loud in its own tutorial ("hit escape on your
 * keyboard to escape tree mode"). One rule, no hidden state: after Escape the
 * mode is ALWAYS 'select'.
 *
 * The guard is a COUNT, not a substring. The handler has early `return`s for a
 * half-traced gable and hip, so "it calls exitToolMode somewhere" is satisfied
 * by code that still strands the user on two of its three paths. Every exit
 * from the block must go through it.
 */
describe('Escape returns the tool to select on EVERY path', () => {
  const SRC = stripComments(readFileSync(SRC_PATH, 'utf8'));

  /** The Escape branch only, from its key test to the listener registration. */
  function escapeBlock(): string {
    const start = SRC.indexOf("e.key === 'Escape'");
    expect(start, 'the Escape handler was not found').toBeGreaterThan(-1);
    const end = SRC.indexOf("window.addEventListener('keydown', onKey)", start);
    expect(end, 'the end of the keydown handler was not found').toBeGreaterThan(start);
    const slice = SRC.slice(start, end);
    // Positive control: the slice really is the cancel-everything block.
    expect(slice).toMatch(/clearGhostPanel\(\)/);
    // And it must NOT have swallowed the Enter branch above it, or the
    // return-count arithmetic below would be measuring the wrong thing.
    expect(slice).not.toMatch(/finalizeGroundArray\(\)/);
    return slice;
  }

  it('exitToolMode is a real exit — it reads the ref and writes select', () => {
    const block = escapeBlock();
    // Reading `modeRef.current` and not `placementMode`: this handler is
    // installed once at viewer init, so a state read here is frozen forever.
    expect(block, 'exitToolMode must guard on the LIVE mode ref')
      .toMatch(/const exitToolMode = \(\) => \{\s*if \(modeRef\.current !== 'select'\) onPlacementModeChange\('select'\);/);
  });

  it('every exit from the Escape block goes through exitToolMode', () => {
    const block = escapeBlock();
    const calls   = (block.match(/exitToolMode\(\);/g)  || []).length;
    const returns = (block.match(/\breturn;/g)          || []).length;
    expect(returns, 'the early returns for a half-traced gable/hip are gone — re-check this guard')
      .toBe(2);
    expect(calls, `each of the ${returns} early returns needs its own exitToolMode(), plus one at the end`)
      .toBe(returns + 1);
    // Each early return must be IMMEDIATELY preceded by the call, not merely
    // have one somewhere in the block.
    for (const m of block.matchAll(/\breturn;/g)) {
      const before = block.slice(Math.max(0, m.index - 60), m.index);
      expect(before, 'an early return escapes without dropping the tool')
        .toMatch(/exitToolMode\(\);\s*$/);
    }
  });

  it('the block still ends by dropping the tool', () => {
    const block = escapeBlock();
    expect(block, 'the fall-through path must drop the tool last')
      .toMatch(/clearGhostPanel\(\);\s*exitToolMode\(\);/);
  });
});
