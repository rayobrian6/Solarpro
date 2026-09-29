// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE SCREEN'S MODEL IS A PROJECTION, NOT A SECOND ENGINE.
//
// Ray: "Do not create a second simplified service model merely to make the screen easier. The
// visual builder edits the exact canonical graph." · "Preserve the NOT_EVALUATED engineering
// conclusion... The UI can translate NOT_EVALUATED into Needs input for normal users. Do not change
// the engineering conclusion itself."
//
// So the tests that matter here are not "does the summary say 400 A". They are:
//   · every number the overview reports is the canonical one, and
//   · nothing the overview does can make an unknown look like a pass, and
//   · the preset that says "two 200 A main panels" builds exactly what a person building it by
//     hand would build — because a convenience that diverges is a second authority.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  buildServiceOverview, conclusionWord,
} from '@/lib/electrical/topologyOverview';
import {
  buildServiceFromPreset, addBranchWithPanel, DISTRIBUTION_PRESETS, DISCONNECT_ROLES,
} from '@/lib/electrical/topologyPresets';
import {
  createServiceTopology, addServiceBranch, addPanel, addBackupDomain, addProtectiveDevice,
  setInterconnection, updateBranch, updateService, updateDomain, setDomainEquipment,
} from '@/lib/electrical/topologyAuthoring';
import {
  evaluateServiceTopology, type ServiceTopology,
} from '@/lib/electrical/serviceTopology';

function raysJob(): ServiceTopology {
  let t = buildServiceFromPreset({ ratedAmps: 400, distribution: 'two-main-panels' }).topology;
  for (const p of t.panels) {
    const branch = t.branches.find(b => (b.panelIds ?? []).includes(p.id))!;
    t = addBackupDomain(t, {
      branchId: branch.id, panelIds: [p.id],
      gatewayProductId: 'tesla-backup-gateway-3',
      storageProductIds: ['tesla-powerwall-3'],
      expansionProductIds: ['tesla-powerwall-3-expansion'],
    }).topology;
  }
  return t;
}

describe('🚨 the summary bar tells Ray whether SolarPro understood the system', () => {
  const t = raysJob();
  const o = buildServiceOverview(t);

  it('reports the system in the numbers an electrician would check', () => {
    expect(o.summary.serviceAmps).toBe(400);
    expect(o.summary.phaseLabel).toBe('120/240 V split phase');
    expect(o.summary.branchCount).toBe(2);
    expect(o.summary.panelCount).toBe(2);
    expect(o.summary.domainCount).toBe(2);
    expect(o.summary.gatewayCount).toBe(2);
    expect(o.summary.invertingUnitCount).toBe(2);
    expect(o.summary.expansionUnitCount).toBe(2);
    expect(o.summary.usableKwh).toBeCloseTo(54, 6);
    // 🚨 TWO INVERTING UNITS, NOT FOUR. The expansions add energy, never current.
    expect(o.summary.continuousOutputA).toBeCloseTo(96, 6);
  });

  it('🚨 every figure is READ from the canonical evaluation, not recomputed', () => {
    const ev = evaluateServiceTopology(t);
    expect(o.summary.usableKwh).toBe(ev.storageSummary.totalUsableKwh);
    expect(o.summary.continuousOutputA).toBe(ev.storageSummary.totalContinuousOutputA);
    expect(o.site.conclusion).toBe(ev.overall);
  });
});

describe('🚨 the overview cannot turn an unknown into a pass', () => {
  it('the site conclusion IS the canonical overall, on every shape it is given', () => {
    const shapes: ServiceTopology[] = [
      raysJob(),
      createServiceTopology({ ratedAmps: 200 }),
      buildServiceFromPreset({ ratedAmps: 400, distribution: 'one-main-panel' }).topology,
      // Over-allocated: a proven FAIL, which must stay a FAIL through the projection.
      (() => {
        let t = buildServiceFromPreset({ ratedAmps: 200, distribution: 'two-main-panels' }).topology;
        t = updateBranch(t, t.branches[0].id, { ratedAmps: 400 });
        return t;
      })(),
    ];
    for (const t of shapes) {
      expect(buildServiceOverview(t).site.conclusion).toBe(evaluateServiceTopology(t).overall);
    }
  });

  it('the wording is a LABEL — it never feeds back into a decision', () => {
    expect(conclusionWord('PASS')).toBe('Ready');
    expect(conclusionWord('NOT_EVALUATED')).toBe('Needs input');
    expect(conclusionWord('FAIL')).toBe('Fails');
    // And the model keeps its own vocabulary.
    const o = buildServiceOverview(raysJob());
    expect(['PASS', 'FAIL', 'NOT_EVALUATED']).toContain(o.site.conclusion);
  });

  it('a FAIL outranks the unknowns at every level', () => {
    let t = buildServiceFromPreset({ ratedAmps: 200, distribution: 'two-main-panels' }).topology;
    t = updateBranch(t, t.branches[0].id, { ratedAmps: 400 });
    expect(buildServiceOverview(t).site.conclusion).toBe('FAIL');
  });
});

describe('🚨 the 400 A split is visible without reading an engineering sentence', () => {
  it('names what is allocated, what is not, and the action that closes it', () => {
    let t = buildServiceFromPreset({ ratedAmps: 400, distribution: 'two-main-panels' }).topology;
    // Half built: one 200 A branch on a 400 A service — Ray's screenshot.
    t = { ...t, branches: t.branches.slice(0, 1), panels: t.panels.slice(0, 1) };
    const a = buildServiceOverview(t).allocation;
    expect(a.ratedAmps).toBe(400);
    expect(a.allocatedAmps).toBe(200);
    expect(a.unallocatedAmps).toBe(200);
    expect(a.overAllocatedAmps).toBe(0);
    expect(a.suggestedBranchAmps).toBe(200);
    expect(a.suggestedBranchCount).toBe(1);

    // Taking the action closes it.
    const done = addBranchWithPanel(t, a.suggestedBranchAmps!).topology;
    const b = buildServiceOverview(done).allocation;
    expect(b.unallocatedAmps).toBe(0);
    expect(b.suggestedBranchAmps).toBeNull();
  });

  it('over-allocation is reported as over-allocation, not as a negative remainder', () => {
    let t = buildServiceFromPreset({ ratedAmps: 200, distribution: 'two-main-panels' }).topology;
    t = updateBranch(t, t.branches[0].id, { ratedAmps: 300 });
    const a = buildServiceOverview(t).allocation;
    expect(a.unallocatedAmps).toBe(0);
    expect(a.overAllocatedAmps).toBe(200);
  });

  it('no suggestion is offered when the remainder is not a whole branch', () => {
    let t = buildServiceFromPreset({ ratedAmps: 400, distribution: 'two-main-panels' }).topology;
    t = updateService(t, { ratedAmps: 500 });
    expect(buildServiceOverview(t).allocation.suggestedBranchAmps).toBeNull();
  });
});

describe('🚨 NEEDS INPUT names the thing and knows where it lives', () => {
  const t = raysJob();
  const o = buildServiceOverview(t);

  it('lists each requirement once, in installer words', () => {
    const keys = o.requiredInputs.map(r => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    const fault = o.requiredInputs.find(r => r.key === 'service.availableFaultCurrentA')!;
    expect(fault.label).toBe('Available fault current at the service');
    expect(fault.focus).toEqual({ kind: 'service', nodeId: 'service', field: 'availableFaultCurrentA' });
  });

  it('🚨 every requirement points at a node that actually exists on this graph', () => {
    const ids = new Set<string>([
      'service', 'interconnection',
      ...t.branches.map(b => b.id), ...t.panels.map(p => p.id), ...t.domains.map(d => d.id),
    ]);
    for (const r of o.requiredInputs) {
      expect(ids.has(r.focus.nodeId), `${r.key} → ${r.focus.nodeId}`).toBe(true);
    }
  });

  it('names the manufacturer document rather than a generic "not evaluated"', () => {
    const doc = o.requiredInputs.find(r => r.key.startsWith('manufacturer-document:'))!;
    expect(doc.label).toBe('Manufacturer multi-gateway metering document');
  });

  it('a panel field asked inside a domain scope resolves to the PANEL, not the domain', () => {
    const bus = o.requiredInputs.find(r => r.key === 'panel.busbarRatingA');
    // Ray's job states both bus ratings, so this requirement is absent — the check is that when it
    // IS raised, it lands on a panel.
    let bare = buildServiceFromPreset({ ratedAmps: 400, distribution: 'two-main-panels' }).topology;
    bare = { ...bare, panels: bare.panels.map(p => ({ ...p, busbarRatingA: null })) };
    bare = addBackupDomain(bare, {
      branchId: bare.branches[0].id, panelIds: [bare.panels[0].id],
      gatewayProductId: 'tesla-backup-gateway-3', storageProductIds: ['tesla-powerwall-3'],
    }).topology;
    const r = buildServiceOverview(bare).requiredInputs.find(x => x.key === 'panel.busbarRatingA')!;
    expect(r.focus.kind).toBe('panel');
    expect(bare.panels.some(p => p.id === r.focus.nodeId)).toBe(true);
    expect(bus).toBeUndefined();
  });

  it('🚨 the domain card says what the sheet draws on its CTs', () => {
    // The multi-gateway document is scoped 'site' in the engineering and drawn per domain on the
    // sheet. The domain headline says the same thing, so the operator is not left connecting a
    // site-level sentence to the CTs in front of them.
    for (const d of t.domains) {
      expect(o.domains[d.id].conclusion).toBe('NOT_EVALUATED');
    }
    const single = buildServiceFromPreset({ ratedAmps: 200, distribution: 'one-main-panel' }).topology;
    const oneDomain = addBackupDomain(single, {
      branchId: single.branches[0].id, panelIds: [single.panels[0].id],
      gatewayProductId: 'tesla-backup-gateway-3', storageProductIds: ['tesla-powerwall-3'],
    }).topology;
    // One gateway ⇒ no multi-gateway document requirement at all.
    expect(buildServiceOverview(oneDomain).requiredInputs
      .some(r => r.key.startsWith('manufacturer-document:'))).toBe(false);
  });
});

describe('🚨 the preset is a shortcut, not an authority', () => {
  it('"two 200 A main panels" builds exactly what building it by hand builds', () => {
    const preset = buildServiceFromPreset({ ratedAmps: 400, distribution: 'two-main-panels' }).topology;

    let byHand = createServiceTopology({ ratedAmps: 400 });
    for (let i = 0; i < 2; i++) {
      const b = addServiceBranch(byHand, { ratedAmps: 200 });
      const p = addPanel(b.topology, { busbarRatingA: 200, mainBreakerA: 200 });
      byHand = updateBranch(p.topology, b.branch.id, { panelIds: [p.panel.id] });
    }
    expect(preset).toEqual(byHand);
  });

  it('🚨 what it SAYS it will build is what it builds — at every service size', () => {
    for (const p of DISTRIBUTION_PRESETS) {
      for (const amps of [100, 125, 150, 200, 320, 400, 500, 600, 800]) {
        const text = p.describe(amps);
        expect(text.length).toBeGreaterThan(10);
        if (!p.branches) continue;
        const built = buildServiceFromPreset({ ratedAmps: amps, distribution: p.id }).topology;
        expect(built.branches).toHaveLength(p.branches);
        // The sentence quotes the rating the graph actually gets. 500 A ÷ 3 is where a rounded
        // description and a floored build stop agreeing.
        expect(text, `${p.id} @ ${amps} A`).toContain(`${built.branches[0].ratedAmps} A`);
      }
    }
  });

  it('a non-integer split leaves the remainder UNASSIGNED rather than inventing a rating', () => {
    const t = buildServiceFromPreset({ ratedAmps: 400, distribution: 'three-main-panels' }).topology;
    expect(t.branches.map(b => b.ratedAmps)).toEqual([133, 133, 133]);
    // And the overview says so, instead of the screen implying the service is fully described.
    expect(buildServiceOverview(t).allocation.unallocatedAmps).toBe(1);
  });

  it('the four disconnect roles are described where they sit, in one place', () => {
    expect(DISCONNECT_ROLES.map(r => r.role)).toEqual([
      'service-disconnect', 'der-isolation-disconnect', 'gateway-isolation', 'ess-disconnect',
    ]);
    for (const r of DISCONNECT_ROLES) {
      expect(r.where.length).toBeGreaterThan(10);
      expect(r.purpose.length).toBeGreaterThan(20);
    }
  });
});

describe('🚨 editing a node edits the canonical graph', () => {
  it('re-equipping a domain goes back through the catalogue, and drops what it replaced', () => {
    const t = raysJob();
    const before = t.storage.length;
    const r = setDomainEquipment(t, t.domains[0].id, {
      storageProductIds: ['tesla-powerwall-3', 'tesla-powerwall-3'],
      expansionProductIds: ['tesla-powerwall-3-expansion'],
    });
    // Domain A now has two inverting units and one expansion; domain B is untouched.
    const units = r.topology.storage.filter(u => u.id.startsWith('domain-1-'));
    expect(units.filter(u => u.role === 'inverter-unit')).toHaveLength(2);
    expect(units.filter(u => u.role === 'energy-expansion')).toHaveLength(1);
    // 🚨 THE OLD UNITS ARE GONE. Left behind, the BOM would count batteries no domain owns.
    expect(r.topology.storage.filter(u => u.id === 'domain-1-ess-1')).toHaveLength(1);
    expect(r.topology.storage).toHaveLength(before - 2 + 3);
    expect(r.topology.domains[1]).toEqual(t.domains[1]);
  });

  it('a domain re-equipped with an expansion and no host names the problem instead of attaching it',
    () => {
      const t = raysJob();
      const r = setDomainEquipment(t, t.domains[0].id, {
        storageProductIds: [],
        expansionProductIds: ['tesla-powerwall-3-expansion'],
      });
      expect(r.unresolved.join(' ')).toMatch(/no host inverter unit/i);
      const exp = r.topology.storage.find(u => u.id === 'domain-1-exp-1')!;
      expect(exp.attachedToUnitId ?? null).toBeNull();
      // And the engineering FAILS it rather than the screen quietly accepting it.
      expect(evaluateServiceTopology(r.topology).checks
        .find(c => c.id === 'storage.expansion-has-a-host')!.conclusion).toBe('FAIL');
    });

  it('the point of connection is editable and changes what the engineering says', () => {
    const t = raysJob();
    const before = evaluateServiceTopology(t).checks.find(c => c.id === 'domain.busbar-705-12')!;
    expect(before.requires).toContain('domain.storageConnection');
    const after = updateDomain(t, t.domains[0].id, { storageConnection: 'gateway-panelboard' });
    const check = evaluateServiceTopology(after).checks.find(c => c.id === 'domain.busbar-705-12')!;
    // Still NOT_EVALUATED, and now for the RIGHT reason: the governing limit is the
    // manufacturer's, which SolarPro does not hold.
    expect(check.conclusion).toBe('NOT_EVALUATED');
    expect(check.requires!.some(r => r.startsWith('manufacturer-limit:'))).toBe(true);
  });

  it('interconnection facts the project constrains survive being recorded', () => {
    const t = setInterconnection(raysJob(), {
      meterCollarPermitted: false, meterCollarSelected: false,
      externalDerIsolationRequired: true,
    });
    const withDevice = addProtectiveDevice(t, {
      label: 'Utility DER isolation disconnect', roles: ['der-isolation-disconnect'],
      ratedAmps: 400, lockableOpen: true, visibleOpen: true,
    }).topology;
    const check = evaluateServiceTopology(withDevice).checks
      .find(c => c.id === 'interconnection.der-isolation')!;
    expect(check.conclusion).toBe('PASS');
    // Without the device, the same requirement FAILS — not "not evaluated".
    expect(evaluateServiceTopology(t).checks
      .find(c => c.id === 'interconnection.der-isolation')!.conclusion).toBe('FAIL');
  });
});
