/** @vitest-environment jsdom */
/**
 * tests/undoNeverOrphansSilently.test.tsx
 *
 * AN UNDO COULD LEAVE MODULES BEHIND AND SAY NOTHING.
 *
 * `applyRestoredGeometry` repositions the live array onto the roof an undo just
 * restored — correct, because `PlacedPanel.lat/lng/height` is absolute while
 * `planeId` only says which face a module belongs to, so an undo that restored
 * the roof alone would leave the modules a foot above it.
 *
 * `repositionPanelsForPlanes` returns `{ panels, moved, orphaned }`. It reports
 * orphans because a panel whose face is not in the restored roof CANNOT be placed
 * and is deliberately left where it is rather than guessed onto a neighbour. That
 * is the right call.
 *
 * 🚨 BUT NOTHING READ `orphaned`. The code's own comment says "the caller
 * surfaces it" — and on the undo path there is no such caller. So an undo could
 * move most of the array and leave some modules behind, producing an array in two
 * pieces, with no log, no status line and no refusal. The forward path is held to
 * the opposite standard: a cull reports its count in the status line and offers
 * Undo.
 *
 * This matters most in exactly the case just repaired elsewhere: a reshape whose
 * undo grew a face back could not place the modules nearest the shrunken edge,
 * and the array came back torn — three modules exact, twenty-one displaced, with
 * nearest-neighbour spacing collapsing below a module's own width. Modules
 * physically overlapping, on a roof, in a permit drawing. That specific gesture
 * no longer repositions at all; this closes the general case behind it, for any
 * future undo that legitimately does.
 *
 * WHAT IS ASSERTED: the count reaches the user through the channel that already
 * exists. `undoGeometry` returns a label, and the engine puts it in the status
 * line (`setStatusMsg('↶ Undone — ' + label)`, on an element with `role="status"`
 * and `aria-live="polite"`). So no new API and no new UI: the label says it.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderHook, act } from '@testing-library/react';
import { stripComments } from './support/stripSource';
import type { PlacedPanel, RoofPlane } from '@/types';

const ROOT = join(__dirname, '..');
const HOOK = stripComments(
  readFileSync(join(ROOT, 'components', 'design', 'useSiteDesign.ts'), 'utf8'));

const { useSiteDesign } = await import('@/components/design/useSiteDesign');

/** A minimal face with a real 3D frame, at Granite City. */
function face(id: string, lat: number, lng: number): RoofPlane {
  return {
    id, pitch: 20, azimuth: 180,
    vertices: [
      { lat, lng },
      { lat: lat + 0.00008, lng },
      { lat: lat + 0.00008, lng: lng + 0.00008 },
      { lat, lng: lng + 0.00008 },
    ],
  } as unknown as RoofPlane;
}

function panel(id: string, planeId: string, lat: number, lng: number): PlacedPanel {
  return {
    id, planeId, lat, lng, height: 100, tilt: 20, azimuth: 180,
    wattage: 400, widthM: 1.13, heightM: 1.72, row: 0, col: 0,
  } as unknown as PlacedPanel;
}

describe('🚨 the orphan count is read at all', () => {
  it('🚨 applyRestoredGeometry consults `orphaned`, not only `moved`', () => {
    // 🚨 SCOPED TO THE FUNCTION BODY, and to a USE rather than a mention. The
    // word `orphaned` appears in this file's prose and in the type it destructures
    // from, and neither is the code acting on it — the same trap that let a
    // parameter type satisfy a guard about a rule earlier today.
    const i = HOOK.indexOf('const applyRestoredGeometry = useCallback(');
    expect(i, 'applyRestoredGeometry moved — this guard is blind').toBeGreaterThan(-1);
    const end = HOOK.indexOf('}, []);', i);
    expect(end).toBeGreaterThan(i);
    const body = HOOK.slice(i, end);
    expect(body, 'the orphan count is still discarded — an undo can tear the array in silence')
      .toMatch(/moved\.orphaned/);
  });

  it('and it returns what it found, rather than logging into the void', () => {
    // A console line is not surfacing it. The count has to leave the function.
    const i = HOOK.indexOf('const applyRestoredGeometry = useCallback(');
    const end = HOOK.indexOf('}, []);', i);
    const body = HOOK.slice(i, end);
    expect(body, 'nothing returns the orphan count to the caller')
      .toMatch(/return\s*\{[^}]*orphaned/);
  });

  it('🚨 and BOTH undo and redo put it in the label the user sees', () => {
    // The engine renders this return value: setStatusMsg('↶ Undone — ' + label).
    // Redo repositions through the same path, so it has the same obligation.
    for (const fn of ['const undoGeometry = useCallback(', 'const redoGeometry = useCallback(']) {
      const i = HOOK.indexOf(fn);
      expect(i, `${fn} moved — this guard is blind`).toBeGreaterThan(-1);
      const end = HOOK.indexOf('}, []);', i);
      const body = HOOK.slice(i, end);
      expect(body, `${fn} drops the orphan count before the user could see it`)
        .toMatch(/orphan/i);
    }
  });
});

describe('🚨 and it is true when the hook actually runs', () => {
  it('a clean undo says nothing about orphans', () => {
    // POSITIVE CONTROL. The label must stay clean in the ordinary case, or the
    // warning becomes wallpaper and nobody reads the one that matters.
    const r = renderHook(() => useSiteDesign());
    const f = face('r0', 38.67, -90.15);
    act(() => {
      r.result.current.setRoofPlanes([f]);
      r.result.current.setPanels([panel('p0', 'r0', 38.67004, -90.15004)]);
    });
    act(() => { r.result.current.recordGeometry('Nudge'); });
    act(() => { r.result.current.setRoofPlanes([face('r0', 38.67, -90.15)]); });

    let label: string | null = null;
    act(() => { label = r.result.current.undoGeometry(); });
    expect(label).toBe('Nudge');
    expect(String(label)).not.toMatch(/orphan|could not be placed/i);
  });

  it('🚨 an undo that cannot place a module SAYS SO in the label', () => {
    // The orphan case: the step restores a roof that does not contain the face a
    // live module names, so that module cannot be repositioned and is left where
    // it is. Before this change the label was the bare step name and the torn
    // array was silent.
    const r = renderHook(() => useSiteDesign());
    act(() => {
      r.result.current.setRoofPlanes([face('r0', 38.67, -90.15)]);
      r.result.current.setPanels([panel('p0', 'r0', 38.67004, -90.15004)]);
    });
    // Record a step whose roof is a DIFFERENT face, so restoring it leaves the
    // live panel's face absent.
    act(() => { r.result.current.recordGeometry('Replace face'); });
    act(() => {
      r.result.current.setRoofPlanes([face('r1', 38.6702, -90.1502)]);
      r.result.current.setPanels([panel('p0', 'r1', 38.67024, -90.15024)]);
    });

    let label: string | null = null;
    act(() => { label = r.result.current.undoGeometry(); });
    expect(label, 'the undo reported nothing').not.toBeNull();
    expect(String(label),
      'a module could not be placed and the label did not say so')
      .toMatch(/could not be placed/i);

    // 🚨 AND IT SAYS HOW MANY. This assertion exists because the phrase alone was
    // not enough: `orphaned` is the LIST OF PANEL IDS, not a count, and the first
    // implementation compared the array to a number and interpolated it directly.
    // `['p0'] > 0` is false, so the notice could never fire — and where it did,
    // it read "p0 modules could not be placed". The phrase-only assertion passed
    // on all of that. tsc caught it; this is what should have.
    expect(String(label),
      'the label does not name a NUMBER of modules — check it is not printing an id')
      .toMatch(/\b1 module\b/);
    expect(String(label)).not.toMatch(/p0 module/);
  });

  it('the label still names the step — the warning is added, not substituted', () => {
    // A warning that replaces the step name tells the user what went wrong and
    // loses what they just undid.
    const r = renderHook(() => useSiteDesign());
    act(() => {
      r.result.current.setRoofPlanes([face('r0', 38.67, -90.15)]);
      r.result.current.setPanels([panel('p0', 'r0', 38.67004, -90.15004)]);
    });
    act(() => { r.result.current.recordGeometry('Replace face'); });
    act(() => {
      r.result.current.setRoofPlanes([face('r1', 38.6702, -90.1502)]);
      r.result.current.setPanels([panel('p0', 'r1', 38.67024, -90.15024)]);
    });
    let label: string | null = null;
    act(() => { label = r.result.current.undoGeometry(); });
    expect(String(label)).toMatch(/Replace face/);
  });

  it('a step that carries its panels verbatim never repositions, so it never orphans', () => {
    // The path the reshape fix put every stitched gesture on. It must stay silent
    // — a warning here would appear on every corner drag and mean nothing.
    const r = renderHook(() => useSiteDesign());
    act(() => {
      r.result.current.setRoofPlanes([face('r0', 38.67, -90.15)]);
      r.result.current.setPanels([panel('p0', 'r0', 38.67004, -90.15004)]);
    });
    act(() => { r.result.current.recordGeometryWithPanels('Reshape roof'); });
    act(() => {
      r.result.current.setRoofPlanes([face('r1', 38.6702, -90.1502)]);
      r.result.current.setPanels([panel('p0', 'r1', 38.67024, -90.15024)]);
    });
    let label: string | null = null;
    act(() => { label = r.result.current.undoGeometry(); });
    expect(label).toBe('Reshape roof');
    expect(String(label)).not.toMatch(/could not be placed/i);
  });
});
