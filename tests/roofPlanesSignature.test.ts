/**
 * tests/roofPlanesSignature.test.ts
 *
 * Regression cover for v66: "a traced roof is never saved unless you also
 * touch a panel."
 *
 * The original defect was NOT in the save payload — that always carried
 * roofPlanes. It was in the dedup signature and the effect dependencies, which
 * covered panels + electrical only. So:
 *   • tracing a face with no panels never scheduled a save, and
 *   • editing a face's pitch after placing panels produced an UNCHANGED
 *     signature, so the save returned early.
 *
 * These tests pin the signature's contract. The "old behaviour" test below is
 * the one that matters: it reconstructs the pre-fix signature and demonstrates
 * it cannot tell two materially different designs apart.
 */

import { describe, it, expect } from 'vitest';
import { roofPlanesSignature, layoutSignature, SIGNED_FIELDS } from '@/lib/roofPlanesSignature';
import type { RoofPlane } from '@/types';

function plane(over: Partial<RoofPlane> = {}): RoofPlane {
  return {
    id: 'plane-1',
    vertices: [
      { lat: 38.8, lng: -89.5 },
      { lat: 38.8001, lng: -89.5 },
      { lat: 38.8001, lng: -89.4999 },
      { lat: 38.8, lng: -89.4999 },
    ],
    pitch: 22,
    azimuth: 180,
    area: 60,
    usableArea: 52,
    ...over,
  } as RoofPlane;
}

describe('roofPlanesSignature', () => {
  it('is stable for the same planes in the same order', () => {
    const a = [plane(), plane({ id: 'plane-2', azimuth: 0 })];
    const b = [plane(), plane({ id: 'plane-2', azimuth: 0 })];
    expect(roofPlanesSignature(a)).toBe(roofPlanesSignature(b));
  });

  it('returns a stable empty marker for no planes', () => {
    expect(roofPlanesSignature([])).toBe('[]');
    expect(roofPlanesSignature(undefined)).toBe('[]');
    expect(roofPlanesSignature(null)).toBe('[]');
  });

  // ── The two edits that used to vanish on reload ────────────────────────────

  it('changes when a face pitch is edited — the edit that used to be lost', () => {
    const before = [plane({ pitch: 22 })];
    const after = [plane({ pitch: 26 })];
    expect(roofPlanesSignature(after)).not.toBe(roofPlanesSignature(before));
  });

  it('changes when a face is traced onto an empty design', () => {
    expect(roofPlanesSignature([plane()])).not.toBe(roofPlanesSignature([]));
  });

  it('changes when a face azimuth is edited', () => {
    expect(roofPlanesSignature([plane({ azimuth: 90 })]))
      .not.toBe(roofPlanesSignature([plane({ azimuth: 270 })]));
  });

  it('changes when a face is confirmed', () => {
    expect(roofPlanesSignature([plane({ confirmed: true })]))
      .not.toBe(roofPlanesSignature([plane({ confirmed: false })]));
  });

  it('changes when a vertex moves', () => {
    const moved = plane();
    moved.vertices = [...moved.vertices];
    moved.vertices[0] = { lat: 38.80005, lng: -89.5 };
    expect(roofPlanesSignature([moved])).not.toBe(roofPlanesSignature([plane()]));
  });

  it('changes when edge types are classified (step 7 writes these)', () => {
    expect(roofPlanesSignature([plane({ edgeTypes: ['ridge', 'rake', 'eave', 'rake'] })]))
      .not.toBe(roofPlanesSignature([plane()]));
  });

  it('treats plane ORDER as meaningful — the sidebar and planset number faces by it', () => {
    const p1 = plane({ id: 'a' });
    const p2 = plane({ id: 'b' });
    expect(roofPlanesSignature([p1, p2])).not.toBe(roofPlanesSignature([p2, p1]));
  });

  // ── The other half of the contract: no spurious saves ──────────────────────

  it('does NOT change when only derived 3D fields differ', () => {
    // polygon3D / localFrame3D are recomputed float arrays. If they entered the
    // signature, FP noise between rebuilds would write to the DB every 3s.
    const a = plane();
    const b = plane();
    a.polygon3D = [{ x: 1.00000001, y: 2, z: 3 }];
    b.polygon3D = [{ x: 1.00000002, y: 2, z: 3 }];
    a.area = 60.0000001;
    b.area = 60.0000002;
    expect(roofPlanesSignature([a])).toBe(roofPlanesSignature([b]));
  });

  // ── The guard against this bug returning ───────────────────────────────────

  it('signs every field the per-face editor can write', () => {
    // If you add a user-editable, persisted field to RoofPlane and do not add
    // it to SIGNED_FIELDS, edits to it will not trigger a save and will be lost
    // on reload. That is the v66 bug, returning. Add the field to SIGNED_FIELDS
    // (and to this list) rather than deleting the assertion.
    const editableInSidebar = ['pitch', 'azimuth', 'orientation', 'confirmed'];
    for (const f of editableInSidebar) {
      expect(SIGNED_FIELDS).toContain(f);
    }
    // Identity and geometry must be signed too, or a re-trace looks unchanged.
    expect(SIGNED_FIELDS).toContain('id');
    expect(SIGNED_FIELDS).toContain('vertices');
  });

  // ── Proof the OLD signature could not do this ──────────────────────────────

  it('OLD pre-v66 signature could not tell a pitch edit from no change at all', () => {
    // Reconstruct the exact pre-fix signature: panels + electrical, no roof.
    const oldSignature = (panels: unknown[], electrical: unknown) =>
      JSON.stringify(panels) + '|' + JSON.stringify(electrical ?? null);

    const panels = [{ id: 'p1', lat: 38.8, lng: -89.5 }];
    const electrical = { topology: 'string' };

    const beforeEdit = oldSignature(panels, electrical);
    const afterEdit = oldSignature(panels, electrical); // user changed pitch 22 -> 26

    // The old signature is blind: identical, so saveLayoutToDB returned early
    // and the pitch edit never reached the database.
    expect(afterEdit).toBe(beforeEdit);

    // The new signature folds roof geometry in, so the same edit is visible.
    const newBefore = beforeEdit + '|' + roofPlanesSignature([plane({ pitch: 22 })]);
    const newAfter = afterEdit + '|' + roofPlanesSignature([plane({ pitch: 26 })]);
    expect(newAfter).not.toBe(newBefore);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// layoutSignature — the whole-layout dedup signature.
//
// Three defects lived in the four hand-rolled copies of this string:
//   1. `generatedAt` was signed, so the dedup could NEVER fire while a design
//      had panels. Every scheduled autosave POSTed, and the layout route runs
//      syncProjectPipeline() synchronously whenever the layout has panels.
//   2. The two restore SEEDS signed two parts while the two WRITERS signed
//      three, so a restored layout never compared equal to its own content.
//   3. The beacon carried a comment saying "Shared helper, one definition"
//      directly above a hand-rolled copy of the string.
// ═══════════════════════════════════════════════════════════════════════════

describe('layoutSignature', () => {
  const panels = [{ id: 'p1', lat: 38.8, lng: -89.5 }];
  const planes = [plane()];

  /** The electrical object as DesignStudio.buildDesignElectrical() emits it —
   *  the timestamp is stamped fresh on every call (DesignStudio.tsx:790). */
  const electricalAt = (iso: string) => ({
    topology: 'string',
    modulesPerString: 10,
    rackingId: 'rack-1',
    generatedAt: iso,
  });

  it('is identical for the same content signed at two different times', () => {
    // THE BUG. buildDesignElectrical() restamps generatedAt on every call, so
    // these two describe an identical design built one second apart.
    const a = layoutSignature({ panels, designElectrical: electricalAt('2026-09-19T12:00:00.000Z'), roofPlanes: planes });
    const b = layoutSignature({ panels, designElectrical: electricalAt('2026-09-19T12:00:01.000Z'), roofPlanes: planes });
    expect(b).toBe(a);
  });

  it('OLD inline signature restamped on every call, so the dedup was dead code', () => {
    // Reconstruct the exact pre-fix string from DesignStudio.tsx.
    const oldSignature = (p: unknown, e: unknown, rp: RoofPlane[]) =>
      JSON.stringify(p) + '|' + JSON.stringify(e ?? null) + '|' + roofPlanesSignature(rp);

    const a = oldSignature(panels, electricalAt('2026-09-19T12:00:00.000Z'), planes);
    const b = oldSignature(panels, electricalAt('2026-09-19T12:00:01.000Z'), planes);

    // Nothing about the design changed, yet the signatures differ — so
    // `if (sig === lastSavedPanelsRef.current) return;` could never be true.
    expect(b).not.toBe(a);
  });

  it('still changes when the electrical design genuinely changes', () => {
    const a = layoutSignature({ panels, designElectrical: { ...electricalAt('T'), modulesPerString: 10 }, roofPlanes: planes });
    const b = layoutSignature({ panels, designElectrical: { ...electricalAt('T'), modulesPerString: 12 }, roofPlanes: planes });
    expect(b).not.toBe(a);
  });

  it('still changes when a panel moves and when a roof face is edited', () => {
    const base = layoutSignature({ panels, designElectrical: electricalAt('T'), roofPlanes: planes });
    expect(layoutSignature({ panels: [{ id: 'p1', lat: 38.9, lng: -89.5 }], designElectrical: electricalAt('T'), roofPlanes: planes })).not.toBe(base);
    expect(layoutSignature({ panels, designElectrical: electricalAt('T'), roofPlanes: [plane({ pitch: 26 })] })).not.toBe(base);
  });

  // ── The seed/writer parity that defect 2 broke ────────────────────────────

  it('a restore seed equals the first save of that same restored content', () => {
    // What the restore effect seeds after reading the layout back...
    const seed = layoutSignature({ panels, designElectrical: electricalAt('2026-09-19T12:00:00.000Z'), roofPlanes: planes });
    // ...and what saveLayoutToDB computes on the first tick, having rebuilt
    // the electrical design (new timestamp) from unchanged state.
    const firstSave = layoutSignature({ panels, designElectrical: electricalAt('2026-09-19T12:00:05.000Z'), roofPlanes: planes });
    expect(firstSave).toBe(seed);
  });

  it('OLD two-part seed could never equal the three-part writer signature', () => {
    const oldSeed = JSON.stringify(panels) + '|' + JSON.stringify(electricalAt('T'));
    const oldWriter = JSON.stringify(panels) + '|' + JSON.stringify(electricalAt('T')) + '|' + roofPlanesSignature(planes);
    expect(oldWriter).not.toBe(oldSeed);
  });

  // ── Empty-roof handling, which the payload fix depends on ─────────────────

  it('distinguishes "had faces" from "user cleared every face"', () => {
    const withRoof = layoutSignature({ panels, designElectrical: electricalAt('T'), roofPlanes: planes });
    const cleared = layoutSignature({ panels, designElectrical: electricalAt('T'), roofPlanes: [] });
    // Clearing the roof must schedule a save — the route merges with
    // `roofPlanes ?? existing`, so [] is what actually clears the stored roof.
    expect(cleared).not.toBe(withRoof);
  });

  it('treats absent and empty electrical identically', () => {
    expect(layoutSignature({ panels, designElectrical: undefined, roofPlanes: [] }))
      .toBe(layoutSignature({ panels, designElectrical: null, roofPlanes: [] }));
  });

  it('signs an empty layout stably', () => {
    expect(layoutSignature({})).toBe(layoutSignature({ panels: [], designElectrical: null, roofPlanes: [] }));
  });
});
