// ═══════════════════════════════════════════════════════════════════════════
// 🚨 DOES THE FINGERPRINT ACTUALLY MOVE WHEN THE ELECTRICAL PROJECT MOVES?
//
// Ray: "generate SLD at revision A / change canonical electrical project → revision B / old SLD
// remains historical / UI says SLD OUT OF DATE / REGENERATE. Do not silently display revision A as
// current revision B."
//
// A staleness badge is only as good as the fingerprint behind it, and a fingerprint that misses a
// fact is WORSE than none: it reports a changed project as current, with a green badge saying so.
// So this file is adversarial about the two ways it could be blind.
//
//   1. A FACT THAT DOES NOT MOVE IT. Every canonical electrical fact is mutated one at a time and
//      the revision must change. `a-passing-guard-can-be-blind` — a test that only checks "the
//      revision is a string" passes against a function returning a constant.
//   2. A COLLISION THE HASH'S OWN SHAPE INVITES. `stableEngineeringStateHash` SORTS and
//      DEDUPLICATES its inputs and drops empty ones — it was written for sets of ids. That is a
//      real hazard for this use, not a theoretical one, and the `key=value` discipline in
//      `revisionInputs` is what neutralises it. Proven here, not asserted in a comment.
//
// And the inverse, which matters just as much: a save/reload must NOT move it. If serialising a
// graph to JSONB and parsing it back changes the fingerprint, every sheet reads STALE after every
// page load, and a badge nobody can keep green is a badge everybody learns to ignore.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  electricalRevision, revisionInputs, electricalArtifactFreshness, freshnessLabel,
  ELECTRICAL_REVISION_PREFIX,
} from '@/lib/electrical/revision';
import { resolveElectricalProject } from '@/lib/electrical/projectModel';
import { buildRaysIntendedJob } from '@/lib/electrical/fixtures/tesla400aTwoGateway';
import { serialiseServiceTopology, parseServiceTopology } from '@/lib/db/serviceTopology';
import type { ServiceTopology } from '@/lib/electrical/serviceTopology';

const job = () => buildRaysIntendedJob().topology;

/** The real job, resolved the way production resolves it. */
function modelOf(t: ServiceTopology | null, moduleCount = 72) {
  return resolveElectricalProject({
    topology: t, selectedEquipment: { inverterId: null, moduleCount },
  });
}
const revOf = (t: ServiceTopology | null, moduleCount = 72) => electricalRevision(modelOf(t, moduleCount));

describe('the revision names the electrical state', () => {
  it('is prefixed and stable for the same project', () => {
    const a = revOf(job());
    expect(a.startsWith(ELECTRICAL_REVISION_PREFIX + '-')).toBe(true);
    expect(revOf(job())).toBe(a);
  });

  it('🚨 survives a save and a reload — or the badge is red on every page load', () => {
    const t = job();
    const roundTripped = parseServiceTopology(
      JSON.parse(JSON.stringify(serialiseServiceTopology(t))),
    )!.topology;
    expect(revOf(roundTripped), 'serialise → parse moved the fingerprint').toBe(revOf(t));
  });

  it('a project with no graph has its own revision, not an error', () => {
    const r = electricalRevision(resolveElectricalProject({
      topology: null, selectedEquipment: { inverterId: 'enphase-iq8plus', moduleCount: 30 },
    }));
    expect(r.startsWith(ELECTRICAL_REVISION_PREFIX + '-')).toBe(true);
    expect(r).not.toBe(revOf(job()));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 EVERY FACT MOVES IT. One mutation per case, each the smallest change that an engineer would
// call a change to the drawing.
// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 every canonical electrical fact moves the revision', () => {
  const base = revOf(job());

  /** Mutate the job and assert the fingerprint moved. */
  const moves = (what: string, mutate: (t: ServiceTopology) => ServiceTopology, modules = 72) => {
    it(what, () => {
      const mutated = mutate(job());
      expect(revOf(mutated, modules), `${what} did NOT move the revision`).not.toBe(base);
    });
  };

  moves('the service rating', t => ({ ...t, service: { ...t.service, ratedAmps: 200 } }));
  moves('the service rating going absent', t => ({ ...t, service: { ...t.service, ratedAmps: null } }));
  moves('the available fault current', t => ({ ...t, service: { ...t.service, availableFaultCurrentA: 12000 } }));
  moves('the service voltage', t => ({ ...t, service: { ...t.service, voltage: 208 } }));
  moves('the recorded solar coupling', t => ({ ...t, solarCoupling: 'ac-coupled-inverter' }));

  // 🚨 THE ONE RAY NAMED. A switch beside a conductor interrupts nothing; re-routed inline it
  // interrupts the path. Same device, same rating, completely different drawing.
  moves('a device moving inline onto a different node', t => ({
    ...t,
    devices: t.devices.map((d, i) => i === 0 ? { ...d, inlineOnNodeId: 'some-other-node' } : d),
  }));
  moves('a device rating', t => ({
    ...t, devices: t.devices.map((d, i) => i === 0 ? { ...d, ratedAmps: 125 } : d),
  }));
  moves('a device gaining a role', t => ({
    ...t,
    devices: t.devices.map((d, i) => i === 0 ? { ...d, roles: [...d.roles, 'ess-disconnect' as const] } : d),
  }));
  moves('a device being deleted', t => ({ ...t, devices: t.devices.slice(1) }));

  moves('a branch rating', t => ({
    ...t, branches: t.branches.map((b, i) => i === 0 ? { ...b, ratedAmps: 150 } : b),
  }));
  moves('a branch OCPD', t => ({
    ...t, branches: t.branches.map((b, i) => i === 0 ? { ...b, ocpdAmps: 175 } : b),
  }));

  moves('a panel busbar', t => ({
    ...t, panels: t.panels.map((p, i) => i === 0 ? { ...p, busbarRatingA: 225 } : p),
  }));
  moves('a panel becoming backed up', t => ({
    ...t, panels: t.panels.map((p, i) => i === 0 ? { ...p, backedUp: !p.backedUp } : p),
  }));

  // 🚨 THE REAL JOB'S CENTRAL QUANTITY. 4 PW3 → 3 PW3 is mutation 9's change, and it must be
  // visible in the fingerprint or a 4-battery sheet survives a 3-battery project.
  moves('dropping a Powerwall', t => {
    const gone = t.storage[t.storage.length - 1].id;
    return {
      ...t,
      storage: t.storage.filter(s => s.id !== gone),
      domains: t.domains.map(d => ({ ...d, storageUnitIds: d.storageUnitIds.filter(x => x !== gone) })),
    };
  });
  moves('a storage unit changing product', t => ({
    ...t, storage: t.storage.map((s, i) => i === 0 ? { ...s, productId: 'tesla-powerwall-2' } : s),
  }));
  moves('a storage output configuration', t => ({
    ...t,
    storage: t.storage.map((s, i) => i === 0 ? { ...s, outputConfigKw: 5.8, continuousOutputA: 24, ocpdA: 30 } : s),
  }));
  moves('a storage unit losing its PV inputs — the coupling evidence', t => ({
    ...t, storage: t.storage.map(s => ({ ...s, pvInputLimits: null })),
  }));
  moves('the DC PV capacity on a cabinet', t => ({
    ...t, storage: t.storage.map((s, i) => i === 0 ? { ...s, pvDcStcKw: 9.9 } : s),
  }));

  // 🚨 WHERE THE CABINETS LAND. Generation panel vs. gateway panelboard vs. backed-up busbar is the
  // difference the whole slice is about.
  moves('the storage connection arrangement', t => ({
    ...t, domains: t.domains.map((d, i) => i === 0 ? { ...d, storageConnection: 'gateway-panelboard' as const } : d),
  }));
  moves('a gateway changing product', t => ({
    ...t,
    domains: t.domains.map((d, i) => i === 0
      ? { ...d, gateway: { ...d.gateway, productId: 'tesla-backup-gateway-2' } } : d),
  }));
  moves('a gateway rating', t => ({
    ...t,
    domains: t.domains.map((d, i) => i === 0
      ? { ...d, gateway: { ...d.gateway, continuousRatingA: 100 } } : d),
  }));
  moves('a domain moving to another branch', t => ({
    ...t, domains: t.domains.map((d, i) => i === 0 ? { ...d, branchId: t.branches[1].id } : d),
  }));
  moves('a domain being deleted', t => ({ ...t, domains: t.domains.slice(1) }));

  // 225, not 125 — the fixture's generation panels are ALREADY 125 A MLO, and asserting against
  // the value already there would have been a mutation that mutates nothing.
  moves('a generation/combiner panel busbar', t => ({
    ...t,
    aggregationPanels: t.aggregationPanels.map((a, i) => i === 0 ? { ...a, busbarRatingA: 225 } : a),
  }));
  moves('a generation panel input OCPD', t => ({
    ...t,
    aggregationPanels: t.aggregationPanels.map((a, i) => i === 0
      ? { ...a, inputs: a.inputs.map((inp, j) => j === 0 ? { ...inp, ocpdA: 40 } : inp) } : a),
  }));
  moves('a generation panel being removed', t => ({ ...t, aggregationPanels: t.aggregationPanels.slice(1) }));
  moves('a generation panel output OCPD', t => ({
    ...t,
    aggregationPanels: t.aggregationPanels.map((a, i) => i === 0 ? { ...a, outputOcpdA: 90 } : a),
  }));
  moves('a generation panel changing what it feeds', t => ({
    ...t,
    aggregationPanels: t.aggregationPanels.map((a, i) => i === 0 ? { ...a, feedsNodeId: 'elsewhere' } : a),
  }));

  moves('a point of interconnection changing relationship', t => ({
    ...t,
    pointsOfInterconnection: t.pointsOfInterconnection.map((p, i) =>
      i === 0 ? { ...p, relationship: 'supply-side' as const } : p),
  }));
  moves('a POI OCPD', t => ({
    ...t,
    pointsOfInterconnection: t.pointsOfInterconnection.map((p, i) => i === 0 ? { ...p, ocpdA: 225 } : p),
  }));

  moves('the DER arrangement decision', t => ({
    ...t,
    interconnection: { ...t.interconnection, derArrangement: 'common-aggregation' as const },
  }));
  moves('meter collar being selected', t => ({
    ...t, interconnection: { ...t.interconnection, meterCollarSelected: true },
  }));
  // `false`, not `true` — the fixture already records true (ComEd requires isolation on this job).
  moves('the utility isolation requirement changing', t => ({
    ...t, interconnection: { ...t.interconnection, externalDerIsolationRequired: false },
  }));

  moves('the recorded service demand', t => ({ ...t, calculatedServiceDemandA: 180 }));

  // 🚨 FOUND BY THIS TEST, AND IT WAS A REAL GAP, NOT A TEST BUG.
  //
  // `moduleCount` was an input the resolver CONSUMED (it decides the storage-only case) and never
  // exposed, so the fingerprint could not see it: a project going from 72 modules to 36 produced
  // the same revision, and a 72-module sheet kept a green CURRENT badge against it. The model now
  // returns `moduleCount` and the revision covers it.
  it('🚨 the module count moves it — the resolver reads it, so the fingerprint must see it', () => {
    expect(revOf(job(), 36)).not.toBe(base);
    expect(revOf(job(), 0)).not.toBe(base);
    expect(revOf(job(), 0)).not.toBe(revOf(job(), 36));
  });

  it('🚨 a conflict appearing moves it', () => {
    // The same graph, but the catalogue now claims an inverter: a real persisted conflict. A sheet
    // generated while the project agreed with itself must not read as current once it does not.
    const conflicted = resolveElectricalProject({
      topology: job(), selectedEquipment: { inverterId: 'enphase-iq8plus', moduleCount: 72 },
    });
    expect(conflicted.conflicts.length, 'the fixture stopped conflicting').toBeGreaterThan(0);
    expect(electricalRevision(conflicted)).not.toBe(base);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 AND THE INVERSE — what must NOT move it.
// ═══════════════════════════════════════════════════════════════════════════
describe('cosmetic change does not move the revision', () => {
  it('relabelling a branch, a panel and a device leaves the fingerprint alone', () => {
    const t = job();
    const relabelled: ServiceTopology = {
      ...t,
      branches: t.branches.map(b => ({ ...b, label: b.label + ' (renamed)' })),
      panels: t.panels.map(p => ({ ...p, label: 'MAIN ' + p.label })),
      devices: t.devices.map(d => ({ ...d, label: d.label.toUpperCase(), locationNote: 'north wall' })),
      domains: t.domains.map(d => ({ ...d, label: 'System ' + d.id })),
    };
    expect(revOf(relabelled), 'a rename marked every sheet in the project stale').toBe(revOf(t));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE HASH'S OWN SHAPE IS A HAZARD. Proven, not assumed.
// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 the key=value discipline neutralises sort + dedup + empty-drop', () => {
  it('every input is labelled key=value — nothing is a bare value', () => {
    const inputs = revisionInputs(modelOf(job()));
    expect(inputs.length).toBeGreaterThan(40);
    const unlabelled = inputs.filter(s => !/^[^=]+=/.test(s));
    expect(unlabelled, 'a bare value can be reordered or deduplicated away').toEqual([]);
  });

  it('no input is empty — the hash DROPS empty strings', () => {
    const inputs = revisionInputs(modelOf(job()));
    expect(inputs.filter(s => s.length === 0)).toEqual([]);
  });

  it('🚨 swapping two ratings between different facts does not collide', () => {
    // Bare values would hash identically here: {200, 400} sorted is {200, 400} either way. The
    // labels are the only thing that makes these two projects distinguishable.
    const t = job();
    const a: ServiceTopology = {
      ...t,
      service: { ...t.service, ratedAmps: 400 },
      branches: t.branches.map((b, i) => i === 0 ? { ...b, ratedAmps: 200 } : b),
    };
    const b: ServiceTopology = {
      ...t,
      service: { ...t.service, ratedAmps: 200 },
      branches: t.branches.map((x, i) => i === 0 ? { ...x, ratedAmps: 400 } : x),
    };
    expect(revOf(a)).not.toBe(revOf(b));
  });

  it('🚨 two devices rated the same do not collapse into one', () => {
    // The dedup hazard, directly. Rating device[1] the same as device[0] must still differ from
    // DELETING device[1] — a Set over bare ratings cannot tell those apart.
    const t = job();
    if (t.devices.length < 2) throw new Error('fixture needs two devices for this proof');
    const sameRating: ServiceTopology = {
      ...t,
      devices: t.devices.map((d, i) => i === 1 ? { ...d, ratedAmps: t.devices[0].ratedAmps } : d),
    };
    const deleted: ServiceTopology = { ...t, devices: t.devices.filter((_, i) => i !== 1) };
    expect(revOf(sameRating)).not.toBe(revOf(deleted));
  });

  it('two storage units with identical specs do not collapse', () => {
    const t = job();
    const three: ServiceTopology = { ...t, storage: t.storage.slice(0, 3) };
    const four = t;
    expect(revOf(three)).not.toBe(revOf(four));
    // And the inputs genuinely carry one entry per unit, keyed by id.
    const inputs = revisionInputs(modelOf(four));
    const productLines = inputs.filter(s => /^sto\[.+\]\.productId=/.test(s));
    expect(productLines.length).toBe(four.storage.length);
  });
});

describe('freshness', () => {
  it('matching revisions are CURRENT', () => {
    expect(electricalArtifactFreshness('ELEC-abc12345', 'ELEC-abc12345')).toBe('CURRENT');
    expect(freshnessLabel('CURRENT')).toBe('Current');
  });

  it('🚨 a different revision is STALE, and the label says REGENERATE', () => {
    expect(electricalArtifactFreshness('ELEC-abc12345', 'ELEC-deadbeef')).toBe('STALE');
    expect(freshnessLabel('STALE')).toContain('OUT OF DATE');
    expect(freshnessLabel('STALE')).toContain('REGENERATE');
  });

  it('🚨 an UNSTAMPED artifact is not reported as current', () => {
    // Every sheet generated before this stamp existed lands here. Calling it CURRENT would be the
    // same silent pretence the audit found.
    for (const absent of [null, undefined, '']) {
      expect(electricalArtifactFreshness(absent, 'ELEC-deadbeef')).toBe('UNSTAMPED');
    }
    expect(freshnessLabel('UNSTAMPED')).toContain('REGENERATE');
  });

  it('a real end-to-end stale case: generate at A, change the project, compare', () => {
    const atA = revOf(job());
    const changed = job();
    changed.service.ratedAmps = 200;
    const atB = electricalRevision(modelOf(changed));
    expect(electricalArtifactFreshness(atA, atB)).toBe('STALE');
    expect(electricalArtifactFreshness(atA, atA)).toBe('CURRENT');
  });
});
