// ═══════════════════════════════════════════════════════════════════════════
// D12 — RAIL SELECTION: SOMEWHERE FOR THE ANSWER TO LAND.
//
// WHAT WS-8 ALREADY GOT RIGHT, and this does not disturb: for a mixed-
// manufacturer mount the rail is GENUINELY UNSELECTED, choosing one is a design
// + procurement decision, and the engine may not make it. `deriveRailSelection`
// therefore refuses to pick and instead hands over a span-screened shortlist so
// the remaining act is ONE choice.
//
// THE DEFECT: there was nowhere to record that choice. Every store was probed
// and none has a rail slot — `PermitInput.project` carries `mountingSystemId`
// only, `SelectedEquipment` carries panel / inverter / mounting / battery,
// `engineering_config.subSystems` carries no rail. So
// PENDING-RACKING-ASSEMBLY-SELECTION was structurally unclosable: an operator
// could read the shortlist and had no way to answer it. That is not honesty, it
// is a missing feature — the same finding migration 116 answered for
// ENGINEERING-REVIEW-PENDING and 118 for ROUTE-LENGTH-ESTIMATE.
//
// AND PROBE 2 WAS BLIND. `structuralResolvers.ts:496` reads
//
//     (canonical as unknown as { storedRecord?: Record<string, unknown> } | null)?.storedRecord
//
// and `CanonicalEquipmentAuthority` has NO `storedRecord` property — the
// `as unknown` cast hides it from the compiler. Probe 2 was fed `null`
// unconditionally, so `projects.selected_equipment.rail*` reported "absent"
// whatever the store held. Adding a rail field alone would NOT have made it
// work; the cast had to be fixed independently, and it is fixed here.
//
// WHAT A PIN MUST SATISFY — enforced by the service, never by an API route and
// never by a renderer:
//   • only a rail the mount's OWN documented compatibility statement admits;
//   • that covers the mount's attachment spacing, OR carries an explicit,
//     stated span authority to override it;
//   • with an actor, a kind, an instant and a REASON;
//   • superseding the previous selection rather than overwriting it.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { deriveRailSelection } from '@/lib/permit/snapshot/resolution/railSelection';
import {
  planRailPin, planRailUnpin, readRailSelection, railSelectionPatch,
  type RailSelectionStore,
} from '@/lib/railSelection/service';

const NOW = '2026-08-06T12:00:00.000Z';
const ACTOR = { id: 'user-dana', kind: 'user' as const };

/** the live Braidon mount: rail-based, carries no rail of its own. */
const MOUNT = 'rooftech-mini';

const verdictFor = (mountingSystemId: string | null, store: RailSelectionStore | null = null) =>
  deriveRailSelection({
    mountingSystemId,
    project: {},
    selectedEquipment: store ? { railSelection: store } : null,
  });

// ═══════════════════════════════════════════════════════════════════════════
// 1 — THE SHORTLIST IS REAL, AND IT BOUNDS THE PIN
// ═══════════════════════════════════════════════════════════════════════════

describe('D12 · a pin is bounded by the derived shortlist', () => {
  it('1 — the live mixed-manufacturer mount is unselected with eligible candidates', () => {
    const v = verdictFor(MOUNT);
    expect(v.state).toBe('unselected');
    expect(v.eligibleCandidateCount).toBeGreaterThan(0);
  });

  it('2 — an ELIGIBLE candidate can be pinned', () => {
    const v = verdictFor(MOUNT);
    const pick = v.candidates.find(c => c.refusedReason == null)!;
    const r = planRailPin({
      verdict: v, mountingSystemId: MOUNT, railSystemId: pick.systemId,
      actor: ACTOR, atIso: NOW, basis: 'distributor stocks this rail and the splice hardware', current: null,
    });
    expect(r.ok).toBe(true);
    expect(r.next.active!.railModel).toBe(pick.railModel);
    expect(r.next.active!.selectedBy).toBe('user-dana');
    expect(r.next.active!.spanAuthority.coversSpan).toBe(true);
    // the catalog holds NO rail part numbers — it is stated, never invented
    expect(r.next.active!.railSku).toBeNull();
  });

  it('3 — a rail the mount does NOT admit is refused', () => {
    const v = verdictFor(MOUNT);
    const r = planRailPin({
      verdict: v, mountingSystemId: MOUNT, railSystemId: 'some-unlisted-system',
      actor: ACTOR, atIso: NOW, basis: 'cheaper', current: null,
    });
    expect(r.ok).toBe(false);
    expect(r.refusals.map(x => x.code)).toContain('RAIL_NOT_A_CANDIDATE');
  });

  it('4 — a SPAN-REFUSED candidate needs explicit span authority, not a flag', () => {
    const v = verdictFor(MOUNT);
    const refused = v.candidates.find(c => c.refusedReason != null);
    if (!refused) return;                       // no span-refused candidate on this mount
    const bare = planRailPin({
      verdict: v, mountingSystemId: MOUNT, railSystemId: refused.systemId,
      actor: ACTOR, atIso: NOW, basis: 'preferred brand', current: null,
    });
    expect(bare.ok).toBe(false);
    expect(bare.refusals.map(x => x.code)).toContain('SPAN_NOT_COVERED');

    const overridden = planRailPin({
      verdict: v, mountingSystemId: MOUNT, railSystemId: refused.systemId,
      actor: ACTOR, atIso: NOW, basis: 'preferred brand', current: null,
      spanOverride: { reason: 'attachment spacing reduced to 32in on this roof', authority: 'PE letter 2026-08-04, J. Rivera PE IL-062-041234' },
    });
    expect(overridden.ok).toBe(true);
    expect(overridden.next.active!.spanAuthority.coversSpan).toBe(false);
    expect(overridden.next.active!.spanOverride!.authority).toMatch(/PE letter/);
  });

  it('5 — a REASON is required; a pin with no stated basis is refused', () => {
    const v = verdictFor(MOUNT);
    const pick = v.candidates.find(c => c.refusedReason == null)!;
    const r = planRailPin({
      verdict: v, mountingSystemId: MOUNT, railSystemId: pick.systemId,
      actor: ACTOR, atIso: NOW, basis: '   ', current: null,
    });
    expect(r.ok).toBe(false);
    expect(r.refusals.map(x => x.code)).toContain('BASIS_REQUIRED');
  });

  it('6 — a mount whose rail is INHERENT has nothing to pin', () => {
    const inherent = deriveRailSelection({ mountingSystemId: 'ironridge-xr100', project: {}, selectedEquipment: null });
    if (inherent.state !== 'inherent') return;
    const r = planRailPin({
      verdict: inherent, mountingSystemId: 'ironridge-xr100', railSystemId: 'ironridge-xr100',
      actor: ACTOR, atIso: NOW, basis: 'x', current: null,
    });
    expect(r.ok).toBe(false);
    expect(r.refusals.map(x => x.code)).toContain('RAIL_NOT_SELECTABLE');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 — HISTORY IS SUPERSEDED, NEVER OVERWRITTEN
// ═══════════════════════════════════════════════════════════════════════════

describe('D12 · a re-pin supersedes', () => {
  const firstPin = () => {
    const v = verdictFor(MOUNT);
    const elig = v.candidates.filter(c => c.refusedReason == null);
    const r = planRailPin({
      verdict: v, mountingSystemId: MOUNT, railSystemId: elig[0].systemId,
      actor: ACTOR, atIso: NOW, basis: 'first choice', current: null,
    });
    return { v, elig, store: r.ok ? r.next : null };
  };

  it('7 — the previous selection is kept, with its value intact', () => {
    const { v, elig, store } = firstPin();
    if (!store || elig.length < 2) return;
    const r = planRailPin({
      verdict: v, mountingSystemId: MOUNT, railSystemId: elig[1].systemId,
      actor: { id: 'user-sam', kind: 'user' }, atIso: '2026-08-07T09:00:00.000Z',
      basis: 'distributor substitution', current: store,
    });
    expect(r.ok).toBe(true);
    expect(r.next.active!.railModel).toBe(elig[1].railModel);
    expect(r.next.superseded).toHaveLength(1);
    expect(r.next.superseded[0].railModel).toBe(elig[0].railModel);
    expect(r.next.superseded[0].selectedBy).toBe('user-dana');
  });

  it('8 — unpinning keeps the history too', () => {
    const { store } = firstPin();
    if (!store) return;
    const r = planRailUnpin({ current: store, actor: ACTOR, atIso: NOW, reason: 'design changed to a rail-less mount' });
    expect(r.ok).toBe(true);
    expect(r.next.active).toBeNull();
    expect(r.next.superseded).toHaveLength(1);
  });

  it('9 — unpinning nothing is refused, not silently accepted', () => {
    const r = planRailUnpin({ current: null, actor: ACTOR, atIso: NOW, reason: 'x' });
    expect(r.ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 — THE STORE ROUND-TRIPS, AND PROBE 2 CAN SEE IT
// ═══════════════════════════════════════════════════════════════════════════

describe('D12 · the selection is readable from the equipment store', () => {
  const pinned = () => {
    const v = verdictFor(MOUNT);
    const pick = v.candidates.find(c => c.refusedReason == null)!;
    const r = planRailPin({
      verdict: v, mountingSystemId: MOUNT, railSystemId: pick.systemId,
      actor: ACTOR, atIso: NOW, basis: 'stocked', current: null,
    });
    return r.ok ? r.next : null;
  };

  it('10 — the patch is a merge-patch on selected_equipment, needing NO migration', () => {
    const store = pinned()!;
    const patch = railSelectionPatch(store);
    expect(Object.keys(patch)).toEqual(['railSelection']);
    expect(readRailSelection(patch)!.active!.railModel).toBe(store.active!.railModel);
  });

  it('11 — reading a store with no rail selection is null, never a guess', () => {
    expect(readRailSelection(null)).toBeNull();
    expect(readRailSelection({ panelId: 'x' })).toBeNull();
    expect(readRailSelection({ railSelection: { active: null, superseded: [] } })!.active).toBeNull();
  });

  it('12 — PROBE 2 SEES IT (the phantom cast is fixed)', () => {
    const store = pinned()!;
    const v = deriveRailSelection({
      mountingSystemId: MOUNT, project: {}, selectedEquipment: railSelectionPatch(store),
    });
    const probe = v.probes.find(p => p.path.includes('selected_equipment'))!;
    expect(probe.present).toBe(true);
    expect(probe.value).toBe(store.active!.railModel);
  });

  it('13 — and the verdict becomes SELECTED, so the requirement can close', () => {
    const store = pinned()!;
    const v = deriveRailSelection({
      mountingSystemId: MOUNT, project: {}, selectedEquipment: railSelectionPatch(store),
    });
    expect(v.state).toBe('selected');
    expect(v.selectedRailModel).toBe(store.active!.railModel);
    expect(v.operatorAction).toBeNull();
  });

  it('14 — a selection for a DIFFERENT mount does not satisfy this assembly', () => {
    const store = pinned()!;
    const moved: RailSelectionStore = {
      ...store,
      active: { ...store.active!, mountingSystemId: 'some-other-mount' },
    };
    const v = deriveRailSelection({
      mountingSystemId: MOUNT, project: {}, selectedEquipment: railSelectionPatch(moved),
    });
    expect(v.state).toBe('unselected');
    expect(v.basis).toMatch(/different mount|another mount/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 — THE PIN REACHES THE ASSEMBLY, THE BOM AND THE SHEETS
// ═══════════════════════════════════════════════════════════════════════════

describe('D12 · a pinned rail is the specified rail, end to end', () => {
  const pinnedVerdict = () => {
    const v = verdictFor(MOUNT);
    const pick = v.candidates.find(c => c.refusedReason == null)!;
    const r = planRailPin({
      verdict: v, mountingSystemId: MOUNT, railSystemId: pick.systemId,
      actor: ACTOR, atIso: NOW, basis: 'distributor stock', current: null,
    });
    return deriveRailSelection({
      mountingSystemId: MOUNT, project: {}, selectedEquipment: railSelectionPatch(r.next!),
    });
  };

  it('15 — the assembly record names the rail instead of PENDING SELECTION', async () => {
    const { buildRackingAssembly } = await import('@/lib/permit/snapshot/rackingAssembly');
    const { getMountingSystemById } = await import('@/lib/mounting-hardware-db');
    const mount = getMountingSystemById(MOUNT)!;
    const v = pinnedVerdict();

    const before = buildRackingAssembly(mount, {})!;
    expect(before.railModel).toMatch(/PENDING RACKING ASSEMBLY SELECTION/);
    expect(before.assemblyVerification?.railSku).toBe('pending');

    const after = buildRackingAssembly(mount, { pinnedRail: v.pinned })!;
    expect(after.railModel).toBe(v.pinned!.railModel);
    expect(after.railManufacturer).toBe(v.pinned!.manufacturer);
    expect(after.assemblyVerification?.railSku).toBe('verified');
    // the catalog still has no rail part number, and one is not invented
    expect(after.railSku).toBeNull();
  });

  it('16 — a rail pinned under a SPAN OVERRIDE stays pending, not verified', async () => {
    const { buildRackingAssembly } = await import('@/lib/permit/snapshot/rackingAssembly');
    const { getMountingSystemById } = await import('@/lib/mounting-hardware-db');
    const mount = getMountingSystemById(MOUNT)!;
    const v = pinnedVerdict();
    const overridden = buildRackingAssembly(mount, {
      pinnedRail: { ...v.pinned!, coversSpan: false, spanOverrideAuthority: 'PE letter 2026-08-04' },
    })!;
    // the rail IS specified — the record names it …
    expect(overridden.railModel).toBe(v.pinned!.railModel);
    // … but the catalog does not corroborate the span, so the element is not
    // reported verified on the strength of a document this repo never evaluated.
    expect(overridden.assemblyVerification?.railSku).toBe('pending');
  });

  it('17 — a pin cannot override a mount that carries its OWN rail', async () => {
    const { buildRackingAssembly } = await import('@/lib/permit/snapshot/rackingAssembly');
    const { getAllMountingSystems } = await import('@/lib/mounting-hardware-db');
    const own = getAllMountingSystems().find(s => s.rail && (s.systemType === 'rail_based' || s.systemType === 'standing_seam'));
    if (!own) return;
    const forced = buildRackingAssembly(own, {
      pinnedRail: {
        manufacturer: 'Someone Else', railModel: 'NOT-THE-PRODUCT-RAIL', railSku: null,
        selectedBy: 'user-x', selectedAtIso: NOW, basis: 'x', coversSpan: true, spanOverrideAuthority: null,
      },
    })!;
    expect(forced.railModel).toBe(own.rail!.model);
    expect(forced.railModel).not.toBe('NOT-THE-PRODUCT-RAIL');
  });
});
