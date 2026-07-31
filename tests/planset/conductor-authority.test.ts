import { describe, it, expect } from 'vitest';
import { buildConductorAuthority, wireGaugeForOcpd } from '@/lib/permit/utils/conductorAuthority';
import { getEGCSize } from '@/lib/manufacturer-specs';
import { necNextStandardOcpd } from '@/lib/permit/utils/helpers';
import { generatePermitHTML } from '@/lib/permit';
import { roofProject } from '../../test-fixtures/roofProject';
import { projectSharedBranchRaceway, projectCanonicalFeeder } from '@/lib/permit/snapshot/electricalProjection';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';

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

  // ── UPDATED by the PPC corrective pass (§1b), 2026-07-26 ────────────────────
  // The retired assertion required the grounding NOTE and the detail SVG to print
  // ONE project-wide EGC value. That premise was itself the defect: both surfaces
  // read the FEEDER grounding object and presented its gauge as a project-wide
  // "EGC minimum" ("Equipment grounding conductor (EGC): #N AWG bare Cu min."),
  // collapsing two of the SIX distinct grounding objects the directive requires
  // kept separate. The single-source requirement is preserved but re-based on the
  // correct object: each surface reads the grounding object for ITS OWN domain,
  // and the two surfaces that describe the IN-RACEWAY domain must agree.
  it('renders DOMAIN-SCOPED EGC values — the in-raceway note and the detail SVG read the SAME raceway object, and no surface prints a project-wide EGC minimum', () => {
    const input = clone();
    const html = generatePermitHTML(input);
    const snap = (input as { _snapshot?: PermitDesignSnapshot })._snapshot!;
    // the retired project-wide claim is gone
    expect(html).not.toMatch(/Equipment grounding conductor \(EGC\):\s*#[\d/]+ AWG bare Cu min/);

    // ── D2 (Planset 17) — this test's TITLE promised "no surface prints a
    // project-wide EGC minimum", but the only assertion for that clause was the
    // regex above, which targets the RETIRED 2026-07-26 wording. It passed while
    // PV-0 printed `DC EGC minimum: #10 AWG per NEC 690.45.` in every profile —
    // a green that proved nothing. The live probe follows.
    //
    // The '#' is OPTIONAL on purpose: the fixtures set wireGauge '10 AWG' (no
    // hash) so the interpolated form rendered `10 AWG`, while the live artifacts
    // hit the `|| '#10 AWG'` fallback. A probe written for one form misses the
    // other, so this matches both.
    const PROJECT_WIDE_EGC = /(?:DC\s+)?EGC\s+minimum\s*:?\s*#?[\d/]+\s*AWG/i;
    expect(html, 'a project-wide EGC minimum is printed somewhere in the package').not.toMatch(PROJECT_WIDE_EGC);

    // NON-VACUITY — the probe must actually fire on the defect it retires,
    // in BOTH rendered forms. Without this the assertion above could be a
    // regex that can never match anything.
    expect('DC EGC minimum: #10 AWG per NEC 690.45.').toMatch(PROJECT_WIDE_EGC);
    expect('DC EGC minimum: 10 AWG per NEC 690.45.').toMatch(PROJECT_WIDE_EGC);
    // …and must NOT fire on the correct replacement wording
    expect('no project-wide EGC minimum applies').not.toMatch(PROJECT_WIDE_EGC);
    expect('NO SEPARATE EGC REQUIRED').not.toMatch(PROJECT_WIDE_EGC);

    // the replacement states the segment-specific truth and points at the schedule
    expect(html).toContain('no project-wide EGC minimum applies');
    expect(html).toContain('PV-4B');
    // note 2 is explicitly scoped to the in-raceway objects, each sized on its own run
    expect(html).toContain('IN-RACEWAY EGCs');
    expect(html).toContain('not a project-wide minimum');
    // the detail SVG label reads the SAME canonical raceway grounding object
    const svg = html.match(/(#[\d/]+ AWG) Cu · 250\.118\/250\.122/);
    expect(svg).toBeTruthy();
    const rwEgc = projectSharedBranchRaceway(snap).egcGauge ?? projectCanonicalFeeder(snap).egcGauge;
    expect(rwEgc).toBeTruthy();
    expect(svg![1]).toBe(rwEgc);
    const noteIdx = html.indexOf('IN-RACEWAY EGCs');
    expect(html.slice(noteIdx, noteIdx + 400)).toContain(rwEgc!);
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
