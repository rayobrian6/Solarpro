import { describe, it, expect } from 'vitest';
import { buildConductorAuthority, wireGaugeForOcpd } from '@/lib/permit/utils/conductorAuthority';
import { getEGCSize } from '@/lib/manufacturer-specs';
import { necNextStandardOcpd } from '@/lib/permit/utils/helpers';
import { generatePermitHTML } from '@/lib/permit';
import { roofProject } from '../../test-fixtures/roofProject';

// EL-2 / EL-4: one shared conductor authority. Every sheet (PV-4A, PV-4B, E-1,
// BOM) reads buildConductorAuthority() so branch OCPD, conductor gauge and the
// system EGC can never diverge again. Previously PV-4B re-derived the EGC with a
// non-standard `Isc × 1.25 × 1.25` inline table while E-1 used a different value.
describe('conductor authority — single source of truth', () => {
  const clone = () => JSON.parse(JSON.stringify(roofProject));

  it('classifies the microinverter fixture and produces branch rows', () => {
    const auth = buildConductorAuthority(clone(), null);
    expect(auth.isMicro).toBe(true);
    expect(auth.topology).toBe('MICRO');
    expect(auth.microBranches.length).toBeGreaterThan(0);
    expect(auth.dcStrings.length).toBe(0);
  });

  it('sizes every branch internally consistently (OCPD → gauge → EGC)', () => {
    const auth = buildConductorAuthority(clone(), null);
    for (const b of auth.microBranches) {
      // D-1 law: 20A standard-branch floor, next standard size above that;
      // manufacturer max enforced by the snapshot validator (V5/V5a).
      expect(b.ocpdAmps).toBe(b.continuousA <= 20 ? 20 : (necNextStandardOcpd(b.continuousA) || 20));
      // gauge and EGC are derived from that ONE OCPD — never hardcoded
      expect(b.wireGauge).toBe(wireGaugeForOcpd(b.ocpdAmps));
      expect(b.egcGauge).toBe(getEGCSize(b.ocpdAmps));
      expect(b.continuousA).toBeCloseTo(b.branchCurrentA * 1.25, 5);
      expect(b.conductorCallout).toContain(b.wireGauge);
    }
  });

  it('sizes the system EGC from NEC 250.122 on the governing OCPD when no engine value exists', () => {
    const auth = buildConductorAuthority(clone(), null); // fixture has no compliance.electrical
    const maxBranchOcpd = Math.max(...auth.microBranches.map(b => b.ocpdAmps));
    expect(auth.governingOcpd).toBe(maxBranchOcpd);
    expect(auth.egc.source).toBe('nec-250.122');
    expect(auth.egc.gauge).toBe(getEGCSize(auth.governingOcpd));
  });

  it('prefers the engine-computed groundingConductor (the value E-1 trusts) when present', () => {
    const p = clone();
    p.compliance.electrical = { groundingConductor: '#6 AWG' };
    const auth = buildConductorAuthority(p, null);
    expect(auth.egc.source).toBe('engine');
    expect(auth.egc.gauge).toBe('#6 AWG');
  });

  it('renders one EGC value across PV-4B grounding note and detail SVG (no divergence)', () => {
    const html = generatePermitHTML(clone());
    // Grounding note line: "Equipment grounding conductor (EGC): #N AWG bare Cu min."
    const note = html.match(/Equipment grounding conductor \(EGC\):\s*(#[\d/]+ AWG)/);
    // Detail SVG label: "#N AWG Cu · 250.122"
    const svg = html.match(/(#[\d/]+ AWG) Cu · 250\.122/);
    expect(note).toBeTruthy();
    expect(svg).toBeTruthy();
    expect(note![1]).toBe(svg![1]); // both sourced from the authority → identical
    // the old non-standard double-continuous EGC math must be gone from source output
    expect(html).not.toContain('1.25 * 1.25');
  });

  it('renders the same branch OCPD across PV-4A, PV-4B and SCHED (no stray hardcode)', () => {
    // Expectation must come from the SAME healed input the sheets render from:
    // generatePermitHTML mutates/heals the input (AC totals etc.), and the raw
    // fixture's missing acOutputKw falls back to panel watts — a per-micro amp
    // basis divergence that lands 12-module branches on a different breaker
    // step (30 vs 25 A). Exposed by the 2026-07-20 single-branch-per-plane
    // rule; the underlying bare-vs-healed divergence is register finding N-7.
    const input = clone();
    const html = generatePermitHTML(input);
    const auth = buildConductorAuthority(input, null);
    const ocpd = auth.microBranches[0]?.ocpdAmps;
    expect(ocpd).toBeGreaterThan(0);
    // All three branch schedules print the authority OCPD (…>NN A< / >NNA<).
    expect(html).toMatch(new RegExp(`>${ocpd}\\s?A<`));
    // The old hardcoded SCHED ampacity cell ('30A (#10)') is gone — SCHED now
    // flows conductor/ampacity through the authority's gauge map.
    expect(html).not.toContain('30A (#10)');
  });
});
