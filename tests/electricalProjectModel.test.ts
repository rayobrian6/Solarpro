// ═══════════════════════════════════════════════════════════════════════════
// 🚨 ONE MODEL, AND WHAT IT DOES WITH A PROJECT THAT CONTRADICTS ITSELF.
//
// `docs/ELECTRICAL-AUTHORITY-MAP.md` proved the live defect was not a rendering bug: three
// persisted stores held overlapping facts with no reconciliation and no precedence, so every
// consumer inferred its own answer and the drawing ended up with two architectures on it.
//
// Ray's canonicalization rules, verbatim:
//
//   A. No explicit external inverter + Tesla PW3 topology + missing `solarCoupling` — "If the
//      persisted evidence is sufficient and non-contradictory, canonicalize to the appropriate
//      coupling with recorded provenance. Do not let a default inverter manufacture Enphase."
//   B. Explicit persisted Enphase equipment + Tesla DC-coupled topology — "That is a real persisted
//      conflict. Do not silently choose either side. Surface an electrical-configuration conflict
//      requiring resolution."
//   C. Partial legacy project — "Missing service rating or another required field must not
//      delete/discard the graph."
//
// These are mutations 1–6 of the twelve he listed.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  resolveElectricalProject, hasElectricalConflict,
} from '@/lib/electrical/projectModel';
import { buildRaysIntendedJob } from '@/lib/electrical/fixtures/tesla400aTwoGateway';
import { serialiseServiceTopology, parseServiceTopology } from '@/lib/db/serviceTopology';
import type { ServiceTopology } from '@/lib/electrical/serviceTopology';

/** The real job as it is persisted TODAY — with the coupling recorded. */
const current = () => buildRaysIntendedJob().topology;

/**
 * The same job as it was persisted BEFORE `solarCoupling` existed: schema v3, no coupling.
 * This is Ray's actual saved project, and it is the input case A exists for.
 */
function legacyNoCoupling(): ServiceTopology {
  const stored = JSON.parse(JSON.stringify(serialiseServiceTopology(current())));
  delete stored.topology.solarCoupling;
  stored.schemaVersion = 3;
  return parseServiceTopology(stored)!.topology;
}

describe('🚨 CASE A — unambiguous evidence canonicalises once, with provenance', () => {
  it('a pre-coupling Tesla project resolves to DC coupled, and says why', () => {
    const t = legacyNoCoupling();
    expect(t.solarCoupling ?? null, 'the fixture is not actually legacy').toBeNull();

    const m = resolveElectricalProject({
      topology: t,
      // No separate inverter has ever been selected — which is the honest state of a DC-coupled job.
      selectedEquipment: { inverterId: null, moduleCount: 72 },
    });

    expect(m.solarCoupling).toBe('dc-coupled-storage');
    expect(m.solarCouplingProvenance.source).toBe('derived');
    // 🚨 THE REASON IS READABLE, not a shrug. It names both halves of the evidence.
    expect(m.solarCouplingProvenance.basis).toContain('no separate PV inverter');
    expect(m.solarCouplingProvenance.basis).toContain('PV inputs');
    expect(m.conflicts).toEqual([]);

    // 🚨 AND IT IS CANONICALISED ONCE, NOT INFERRED FOREVER. Ray: "Treat that as a
    // migration/canonicalization test, not as permission to infer forever."
    expect(m.canonicalizationPatch).toEqual({ solarCoupling: 'dc-coupled-storage' });
  });

  it('a project that HAS chosen an inverter resolves to AC coupled — Tesla does not delete Enphase', () => {
    // Ray: "Do not assume Tesla storage always eliminates Enphase because legitimate AC-coupled
    // Tesla installations exist." Storage present, inverter present, no coupling recorded.
    const m = resolveElectricalProject({
      topology: legacyNoCoupling(),
      selectedEquipment: { inverterId: 'enphase-iq8plus', inverterType: 'micro', moduleCount: 37 },
    });
    expect(m.solarCoupling).toBe('ac-coupled-inverter');
    expect(m.hasExternalInverter).toBe(true);
    expect(m.conflicts).toEqual([]);
    expect(m.canonicalizationPatch).toEqual({ solarCoupling: 'ac-coupled-inverter' });
  });

  it('no modules at all resolves to storage-only', () => {
    const m = resolveElectricalProject({
      topology: legacyNoCoupling(),
      selectedEquipment: { inverterId: null, moduleCount: 0 },
    });
    expect(m.solarCoupling).toBe('storage-only');
    expect(m.canonicalizationPatch).toEqual({ solarCoupling: 'storage-only' });
  });

  it('🚨 insufficient evidence derives NOTHING — it does not guess', () => {
    // Modules placed, no inverter selected, and storage that publishes no PV input. Nothing in the
    // project settles where the strings go, and inventing an answer here is the exact habit this
    // module exists to end.
    const t = legacyNoCoupling();
    const noPvInputs: ServiceTopology = {
      ...t,
      storage: t.storage.map(u => ({ ...u, pvInputLimits: null })),
    };
    const m = resolveElectricalProject({
      topology: noPvInputs,
      selectedEquipment: { inverterId: null, moduleCount: 30 },
    });
    expect(m.solarCoupling).toBeNull();
    expect(m.canonicalizationPatch).toBeNull();
    expect(m.solarCouplingProvenance.basis).toContain('does not settle it');
  });
});

describe('🚨 CASE B — a real persisted conflict is surfaced, never merged', () => {
  it('explicit Enphase equipment beside a DC-coupled graph raises a conflict', () => {
    const m = resolveElectricalProject({
      topology: current(),                                   // records dc-coupled-storage
      selectedEquipment: { inverterId: 'enphase-iq8plus', inverterType: 'micro', moduleCount: 37 },
    });

    expect(hasElectricalConflict(m)).toBe(true);
    const c = m.conflicts.find(x => x.fact === 'How the PV is coupled')!;
    expect(c).toBeTruthy();
    // Both sides are stated, in the operator's words, with their source named.
    expect(c.claims.map(x => x.source).sort())
      .toEqual(['selected-equipment', 'service-topology']);
    expect(c.question).toContain('separate AC PV inverter');

    // 🚨 AND NOTHING IS WRITTEN AWAY. A canonicalisation patch here would make the disagreement
    // invisible by persisting one side of it.
    expect(m.canonicalizationPatch).toBeNull();
  });

  it('a conflict about the PV does not stop the rest of the model resolving', () => {
    // The service engineering has nothing to do with the argument about the inverter.
    const m = resolveElectricalProject({
      topology: current(),
      selectedEquipment: { inverterId: 'enphase-iq8plus', moduleCount: 37 },
    });
    expect(m.serviceRatedAmps).toBe(400);
    expect(m.storage.invertingUnitCount).toBe(4);
    expect(m.storage.gatewayCount).toBe(2);
    expect(m.storage.perSystemGenerationPanelCount).toBe(2);
  });

  it('a stale battery count is a conflict against the graph, not a second opinion', () => {
    const m = resolveElectricalProject({
      topology: current(),
      selectedEquipment: { inverterId: null, batteryCount: 0, moduleCount: 72 },
    });
    const c = m.conflicts.find(x => x.fact === 'How many storage units this project has')!;
    expect(c).toBeTruthy();
    expect(c.claims.find(x => x.source === 'selected-equipment')!.says).toContain('0');
    // The graph still answers — four units, not zero.
    expect(m.storage.invertingUnitCount).toBe(4);
    expect(m.storage.provenance.source).toBe('service-topology');
  });
});

describe('🚨 CASE C — a partial project keeps everything it has', () => {
  it('no service rating: the graph survives and the engineering is partial', () => {
    const t = current();
    const partial: ServiceTopology = { ...t, service: { ...t.service, ratedAmps: null } };
    const m = resolveElectricalProject({
      topology: partial, selectedEquipment: { inverterId: null, moduleCount: 72 },
    });

    expect(m.serviceRatedAmps).toBeNull();
    expect(m.serviceProvenance.source).toBe('none');
    expect(m.serviceProvenance.basis).toContain('NOT_EVALUATED');
    // Everything that does not depend on the rating is still answered.
    expect(m.storage.invertingUnitCount).toBe(4);
    expect(m.storage.perSystemGenerationPanelCount).toBe(2);
    expect(m.solarCoupling).toBe('dc-coupled-storage');
    expect(m.conflicts).toEqual([]);
  });

  it('an explicit engineering override outranks the graph, and says so', () => {
    const m = resolveElectricalProject({
      topology: current(),
      selectedEquipment: null,
      engineeringConfig: { serviceRatedAmpsOverride: 320 },
    });
    expect(m.serviceRatedAmps).toBe(320);
    expect(m.serviceProvenance.source).toBe('engineering-config');
  });

  it('no graph at all: the catalogue selection is all there is, and it says that', () => {
    const m = resolveElectricalProject({
      topology: null,
      selectedEquipment: { inverterId: 'enphase-iq8plus', batteryCount: 2, moduleCount: 30 },
    });
    expect(m.topology).toBeNull();
    expect(m.storage.invertingUnitCount).toBe(2);
    expect(m.storage.provenance.source).toBe('selected-equipment');
    expect(m.solarCoupling).toBe('ac-coupled-inverter');
  });
});

describe('🚨 the model persists nothing and composes everything', () => {
  it('resolving twice from the same stores gives the same answer', () => {
    const input = {
      topology: current(),
      selectedEquipment: { inverterId: null, moduleCount: 72 },
    };
    const a = resolveElectricalProject(input);
    const b = resolveElectricalProject(input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('the resolver mutates none of its inputs', () => {
    const t = current();
    const before = JSON.stringify(t);
    resolveElectricalProject({ topology: t, selectedEquipment: { inverterId: 'x' } });
    expect(JSON.stringify(t), 'the resolver wrote back into the topology').toBe(before);
  });

  it('🚨 it reads no catalogue — the same answer on the server and in the browser', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(__dirname, '..', 'lib', 'electrical', 'projectModel.ts'), 'utf8');
    const code = src.split('\n')
      .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
    // A catalogue lookup here would make the model depend on which catalogue version is loaded,
    // and the instances already carry everything it needs.
    expect(code).not.toContain('equipment-db');
    expect(code).not.toContain('getBatteryById');
    expect(code).not.toContain('MICROINVERTERS');
  });
});
