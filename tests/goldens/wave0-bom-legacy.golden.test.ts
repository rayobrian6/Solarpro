// ============================================================================
// Wave 0 regression bar — see docs/ARCHITECTURE-per-subsystem-equipment.md
// (§3 Wave 0, Invariant I-1: N=1 byte identity).
//
// Pins generateBOMV4's FULL ordered line-item list for representative LEGACY
// single-system inputs (roof string + roof micro, plus micro fed by real
// computeSystem runs — the permit-path coupling). The projection is a stable
// string per line (stage|category|mfr|model|sku|qty|unit) so any wave that
// changes a quantity, drops a line, reorders stages, or perturbs the nextId()
// allocation on the legacy path fails HERE before it reaches a planset.
// Snapshots live in tests/goldens/__snapshots__/ and are committed.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { generateBOMV4 } from '../../lib/bom-engine-v4';
import { computeSystem } from '../../lib/computed-system';
import { bomStringInput, bomMicroInput, csMicroInput } from './wave0-fixtures';

type Result = ReturnType<typeof generateBOMV4>;

/** Stable full-list projection: one line per item, in engine emission order. */
const lineProjection = (bom: Result): string[] =>
  bom.items.map(i =>
    `${i.stageId}|${i.category}|${i.manufacturer}|${i.model}|${i.partNumber}|${i.quantity}|${i.unit}`,
  );

/** Stage sequence projection (id, order, itemCount). */
const stageProjection = (bom: Result): string[] =>
  bom.stages.map(s => `${s.id}|${s.order}|${s.itemCount}`);

/**
 * nextId() sequence lock: ids are a module-level counter (`bom-v4-NNNN`).
 * The ABSOLUTE offset depends on how many BOMs ran earlier in the process, so
 * we pin the invariant that matters for I-1 byte identity: every generation
 * allocates one id per line, strictly sequential, no gaps, no reuse — i.e. the
 * relative id sequence is 0..N-1 from the first line.
 */
function expectSequentialIds(bom: Result): void {
  const nums = bom.items.map(i => {
    const m = /^bom-v4-(\d{4,})$/.exec(i.id);
    expect(m, `id format: ${i.id}`).toBeTruthy();
    return Number(m![1]);
  });
  for (let k = 1; k < nums.length; k++) {
    expect(nums[k]).toBe(nums[k - 1] + 1);
  }
}

describe('Wave 0 golden — BOM legacy roof STRING (flat input, no runs)', () => {
  const bom = generateBOMV4(bomStringInput());

  it('full ordered line-item list matches the pre-contract snapshot', () => {
    expect(lineProjection(bom)).toMatchSnapshot();
  });

  it('stage sequence matches the pre-contract snapshot', () => {
    expect(stageProjection(bom)).toMatchSnapshot();
    expect(bom.topology).toBe('STRING_INVERTER');
  });

  it('nextId allocation is one-per-line, strictly sequential (I-1)', () => {
    expectSequentialIds(bom);
    expect(bom.totalLineItems).toBe(bom.items.length);
  });
});

describe('Wave 0 golden — BOM legacy roof MICRO (flat input, truck-stock + tools on)', () => {
  const bom = generateBOMV4(bomMicroInput());

  it('full ordered line-item list matches the pre-contract snapshot', () => {
    expect(lineProjection(bom)).toMatchSnapshot();
  });

  it('stage sequence matches the pre-contract snapshot', () => {
    expect(stageProjection(bom)).toMatchSnapshot();
    expect(bom.topology).toBe('MICROINVERTER');
  });

  it('nextId allocation is one-per-line, strictly sequential (I-1)', () => {
    expectSequentialIds(bom);
  });
});

describe('Wave 0 golden — BOM legacy roof MICRO fed by REAL computeSystem runs (permit path)', () => {
  // The permit/BOM route now passes cs.runs into the engine (memory: computeSystem
  // in permit path). Pin that coupled path too — wire/conduit lines derive from
  // sized RunSegments, not the flat fallback.
  const cs = computeSystem(csMicroInput());
  const bom = generateBOMV4({
    ...bomMicroInput(),
    moduleCount: 20, deviceCount: 20, inverterCount: 20, systemKw: 8.4,
    attachmentCount: 40, railSections: 12,
    includeTruckStock: false, includeSuggestedTools: false,
    runs: cs.runs,
  } as Parameters<typeof generateBOMV4>[0]);

  it('full ordered line-item list matches the pre-contract snapshot', () => {
    expect(lineProjection(bom)).toMatchSnapshot();
  });

  it('nextId allocation is one-per-line, strictly sequential (I-1)', () => {
    expectSequentialIds(bom);
  });
});
