import { describe, it, expect } from 'vitest';
import { buildComputedRunsForPermit } from '../../lib/permit/utils/computedRuns';
import { generateCADLayout } from '../../lib/cad/cadEngine';
import { roofProject } from '../../test-fixtures/roofProject';

// The wire-sizing engine (computeSystem) now runs in the permit path with REAL
// deriveRunLengths(cad) geometry, and its sized RunSegment[] feeds the BOM's
// per-segment path — replacing the flat "60 ft × 4 conductors" default that
// printed the same length for every circuit on PV-4B.
describe('buildComputedRunsForPermit', () => {
  const mk = () => {
    const input: any = JSON.parse(JSON.stringify(roofProject));
    const cad = generateCADLayout(input);
    return { input, cad };
  };

  it('produces sized per-segment runs with plausible gauges (no phantom 4/0 on a 5 kW micro)', () => {
    const { input, cad } = mk();
    const runs = buildComputedRunsForPermit(input, cad as any)!;
    expect(runs.length).toBeGreaterThanOrEqual(4);
    const feeder = runs.find(r => r.id === 'COMBINER_TO_DISCO_RUN')!;
    // 5 kW micro → ~20.8 A continuous → a small feeder, NEVER 4/0. (Two prior
    // mapping bugs: system-kW passed as per-DEVICE inverterAcKw, and system amps
    // as per-device inverterAcCurrentMax — each inflated the feeder ~12×.)
    expect(feeder.continuousCurrent).toBeLessThan(40);
    expect(['#10 AWG', '#8 AWG', '#6 AWG']).toContain(feeder.wireGauge);
    // Utility service conductors are flagged so the BOM excludes them.
    const svc = runs.find(r => r.id === 'MSP_TO_UTILITY_RUN');
    if (svc) expect(svc.isUtilityOwned).toBe(true);
  });

  it('run lengths come from CAD geometry, not one flat default', () => {
    const { input, cad } = mk();
    const runs = buildComputedRunsForPermit(input, cad as any)!;
    const lengths = runs.filter(r => !r.isUtilityOwned).map(r => r.onewayLengthFt);
    // Not all identical (the old flat path used ONE length for everything).
    expect(new Set(lengths).size).toBeGreaterThan(1);
    lengths.forEach(l => expect(l).toBeGreaterThan(0));
  });

  it('fails soft: returns null when panels are absent (BOM keeps its flat fallback)', () => {
    const { input, cad } = mk();
    input.system.totalPanels = 0;
    (cad as any).totalPanels = 0;
    expect(buildComputedRunsForPermit(input, cad as any)).toBeNull();
  });
});
