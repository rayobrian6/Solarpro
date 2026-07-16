// ============================================================================
// Wave 0 regression bar — see docs/ARCHITECTURE-per-subsystem-equipment.md
// (Invariant I-10: behavior-change quarantine; §1.7 "All deliberate NEC
// behavior changes gate strictly on N>1 subsystems present — never on tag
// presence").
//
// A TAGGED single-subsystem project — every panel stamped roof, plus a
// subSystems map with ONLY roof whose canonical id-tuple (panelId, inverterId,
// topology, mountingId, batteryId) EQUALS the legacy mirror — must produce
// IDENTICAL BOM + computeSystem output to the equivalent UNTAGGED legacy
// project. GREEN today (tags are unknown fields, ignored); after Wave 1+ this
// is the no-behavior-change guard for every wave: migrate-on-load synthesis +
// auto-save write-back must never change a single-system project's numbers
// (P3's verified fatal flaw — tag-presence gates defeated by auto-save).
// ============================================================================

import { describe, it, expect } from 'vitest';
import { generateBOMV4 } from '../../lib/bom-engine-v4';
import { computeSystem } from '../../lib/computed-system';
import { runElectricalCalc } from '../../lib/electrical-calc';
import {
  bomMicroInput, bomStringInput, csMicroInput, csStringInput, ecStringInput,
  stripVolatile,
} from './wave0-fixtures';

// The post-normalizer tagged shape (per I-10: "post-normalizer, not raw"):
// the single-entry subSystems map whose id-tuple equals the legacy mirror.
const ROOF_SUBSYSTEM_MAP = {
  roof: {
    key: 'roof',
    panelId: 'rec-alpha-pure-r-405',      // = mirror panelId
    inverterId: 'enphase-iq8plus',        // = mirror inverterId (micro fixtures)
    topology: 'micro',
    mountingId: 'ironridge-xr100',        // = mirror rackingId
    batteryId: null,
    source: 'migration',
    updatedAt: '2026-07-11T00:00:00.000Z',
  },
};

/** Tag any input object the way ensureSubSystemShape() will (extra fields only). */
function tagged<T extends object>(input: T, topology: string, inverterId: string, panelId: string): T {
  return {
    ...input,
    subSystemKey: 'roof',
    subSystems: {
      roof: { ...ROOF_SUBSYSTEM_MAP.roof, topology, inverterId, panelId },
    },
  } as T;
}

const bomProjection = (bom: ReturnType<typeof generateBOMV4>) => ({
  lines: bom.items.map(i =>
    `${i.stageId}|${i.category}|${i.manufacturer}|${i.model}|${i.partNumber}|${i.quantity}|${i.unit}|${i.required}`),
  stages: bom.stages.map(s => `${s.id}|${s.order}|${s.itemCount}`),
  topology: bom.topology,
  warnings: bom.warnings,
  complianceNotes: bom.complianceNotes,
});

describe('I-10 — tagged single-subsystem ≡ untagged legacy (BOM)', () => {
  it('roof MICRO: identical line list, stage sequence, and id-allocation count', () => {
    const untagged = generateBOMV4(bomMicroInput());
    const taggedBom = generateBOMV4(
      tagged(bomMicroInput(), 'micro', 'enphase-iq8plus', 'rec-alpha-pure-r-405'));
    expect(bomProjection(taggedBom)).toEqual(bomProjection(untagged));
    // Same number of nextId() draws — the byte-identity precondition (I-1).
    expect(taggedBom.items.length).toBe(untagged.items.length);
  });

  it('roof STRING: identical line list and stage sequence', () => {
    const untagged = generateBOMV4(bomStringInput());
    const taggedBom = generateBOMV4(
      tagged(bomStringInput(), 'string', 'fronius-primo-8.2', 'rec-alpha-pure-r-405'));
    expect(bomProjection(taggedBom)).toEqual(bomProjection(untagged));
  });
});

describe('I-10 — tagged single-subsystem ≡ untagged legacy (computeSystem)', () => {
  it('roof MICRO: full ComputedSystem deep-equal (volatile timestamps stripped)', () => {
    const untagged = stripVolatile(computeSystem(csMicroInput()));
    const taggedCs = stripVolatile(computeSystem(
      tagged(csMicroInput(), 'micro', 'enphase-iq8plus', 'tesla-tsp-420')));
    expect(taggedCs).toEqual(untagged);
  });

  it('roof STRING: full ComputedSystem deep-equal, run ids stay unprefixed', () => {
    const untagged = stripVolatile(computeSystem(csStringInput()));
    const taggedCs = stripVolatile(computeSystem(
      tagged(csStringInput(), 'string', 'fronius-primo-8.2', 'tesla-tsp-420')));
    expect(taggedCs).toEqual(untagged);
    taggedCs.runs.forEach(r => expect(r.id).not.toContain(':'));
  });
});

describe('I-10 — tagged single-subsystem ≡ untagged legacy (electrical-calc)', () => {
  it('roof STRING: identical result when inverters carry subSystemKey tags', () => {
    const untagged = stripVolatile(runElectricalCalc(ecStringInput()));
    const input = ecStringInput();
    const taggedInput = {
      ...input,
      inverters: input.inverters.map(inv => ({ ...inv, subSystemKey: 'roof' })),
      subSystems: ROOF_SUBSYSTEM_MAP,
    } as typeof input;
    const taggedRes = stripVolatile(runElectricalCalc(taggedInput));
    expect(taggedRes).toEqual(untagged);
  });
});
