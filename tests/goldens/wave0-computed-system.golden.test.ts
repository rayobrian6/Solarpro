// ============================================================================
// Wave 0 regression bar — see docs/ARCHITECTURE-per-subsystem-equipment.md
// (§3 Wave 0, Invariant I-1: N=1 byte identity).
//
// Pins computeSystem (lib/computed-system.ts) on legacy micro + legacy string
// inputs: the runs[] id set (UNPREFIXED — Wave 2's computeMultiSystem must
// keep bare ids at N=1), a per-run {id, gauge, lengthFt, conductors}
// projection, acBranchCount, and the key aggregates every consumer reads.
// Snapshots live in tests/goldens/__snapshots__/ and are committed.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { computeSystem, type ComputedSystem } from '../../lib/computed-system';
import { csMicroInput, csStringInput, r6 } from './wave0-fixtures';

function runProjection(cs: ComputedSystem) {
  return cs.runs.map(r => ({
    id: r.id,
    gauge: r.wireGauge,
    lengthFt: r6(r.onewayLengthFt),
    conductors: r.conductorCount,
  }));
}

function aggregateProjection(cs: ComputedSystem) {
  return {
    topology: cs.topology,
    totalPanels: cs.totalPanels,
    totalDcKw: r6(cs.totalDcKw),
    totalAcKw: r6(cs.totalAcKw),
    dcAcRatio: r6(cs.dcAcRatio),
    stringCount: cs.stringCount,
    panelsPerString: cs.panelsPerString,
    microDeviceCount: cs.microDeviceCount,
    acBranchCount: cs.acBranchCount,
    acBranchCurrentA: r6(cs.acBranchCurrentA),
    acBranchOcpdAmps: cs.acBranchOcpdAmps,
    acOutputCurrentA: r6(cs.acOutputCurrentA),
    acContinuousCurrentA: r6(cs.acContinuousCurrentA),
    acOcpdAmps: cs.acOcpdAmps,
    backfeedBreakerAmps: cs.backfeedBreakerAmps,
    interconnectionPass: cs.interconnectionPass,
    rooftopTempAdderC: cs.rooftopTempAdderC,
    errorCount: cs.errorCount,
    isValid: cs.isValid,
  };
}

describe('Wave 0 golden — computeSystem legacy MICRO (20 × IQ8+, roof)', () => {
  const cs = computeSystem(csMicroInput());

  it('runs[] id set is the bare legacy set (no subsystem prefixes)', () => {
    const ids = cs.runs.map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length); // ids unique
    ids.forEach(id => expect(id).not.toContain(':')); // never `${sub}:` prefixed at N=1
    expect(ids).toMatchSnapshot();
  });

  it('per-run {id, gauge, lengthFt, conductors} matches the pre-contract snapshot', () => {
    expect(runProjection(cs)).toMatchSnapshot();
  });

  it('acBranchCount + key aggregates match the pre-contract snapshot', () => {
    expect(cs.acBranchCount).toBeGreaterThan(0);
    expect(aggregateProjection(cs)).toMatchSnapshot();
  });
});

describe('Wave 0 golden — computeSystem legacy STRING (7.6 kW Fronius, 2×10, roof)', () => {
  const cs = computeSystem(csStringInput());

  it('runs[] id set is the bare legacy set (no subsystem prefixes)', () => {
    const ids = cs.runs.map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    ids.forEach(id => expect(id).not.toContain(':'));
    expect(ids).toMatchSnapshot();
  });

  it('per-run {id, gauge, lengthFt, conductors} matches the pre-contract snapshot', () => {
    expect(runProjection(cs)).toMatchSnapshot();
  });

  it('acBranchCount (0 for string) + key aggregates match the pre-contract snapshot', () => {
    expect(cs.acBranchCount).toBe(0);
    expect(aggregateProjection(cs)).toMatchSnapshot();
  });

  it('runMap keys mirror runs[] ids (the ~15 page.tsx runs.find() contract)', () => {
    expect(Object.keys(cs.runMap).sort()).toEqual(cs.runs.map(r => r.id).sort());
  });
});
