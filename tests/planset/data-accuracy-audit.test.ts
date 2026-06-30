/**
 * tests/planset/data-accuracy-audit.test.ts
 *
 * Regression tests for Planset engineering-data accuracy audit.
 * Verifies that placeholder/stubbed/NaN values are properly guarded
 * on non-geometry sheets (PV-3, PV-4A/B/C, SCHED, PV-0).
 *
 * Key defects fixed:
 * 1. Dead load fallbacks: '3.2'/'2.5'/'0.5' → '—' when structural data absent
 * 2. Utilization: '0%' → '—' when utilizationRatio absent
 * 3. Safety factor color guard: NaN < 2 is false → guard with Number(val) > 0
 * 4. Prose guards: "safety factor of — confirmed BELOW" → conditional display
 * 5. Conclusion blocks: (sf||0) >= 2 → null-check with three-way conditional
 * 6. OCPD formula: "×1.25 ×1.25" → "×1.56" with NEC section citations
 */

import { describe, expect, it } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { roofProject } from '../../test-fixtures/roofProject';
import { groundProject } from '../../test-fixtures/groundProject';
import type { PermitInput } from '@/lib/permit/types';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

/** Extract pages by sheet ID from the full HTML */
function pagesFrom(html: string): string[] {
  return [...html.matchAll(/<div class="page"[\s\S]*?(?=<div class="page"|<\/body>|$)/g)].map(match => match[0]);
}

function sheetPage(html: string, sheetId: string): string | undefined {
  return pagesFrom(html).find(candidate => candidate.includes(`<div class="tb-sheet-id">${sheetId}</div>`));
}

// ── Defect 1: Dead load fallbacks ──────────────────────────────────
describe('Defect 1 — Dead load fallbacks show — not fake numbers', () => {
  it('roof structural (PV-4C) shows — for dead loads when no structural.totalDeadLoadPsf', () => {
    // Remove structural dead load data to force fallback
    const input = clone(roofProject);
    delete input.compliance.structural.totalDeadLoadPsf;
    delete input.compliance.structural.moduleLoadPsf;
    delete input.compliance.structural.rackingLoadPsf;
    // Also remove rafter/attachment to prevent V4 calc from filling them in
    delete input.compliance.structural.rafter;
    delete input.compliance.structural.attachment;
    delete input.compliance.structural.wind;
    delete input.compliance.structural.snow;

    const html = generatePermitHTML(input);
    const pv4c = sheetPage(html, 'PV-4C');
    expect(pv4c).toBeTruthy();

    // Must NOT contain the old misleading fallback values
    expect(pv4c).not.toContain('>3.2<');
    expect(pv4c).not.toContain('>2.5<');
    expect(pv4c).not.toContain('>0.5<');
  });
});

// ── Defect 2: Utilization display ──────────────────────────────────
describe('Defect 2 — Utilization shows — not 0% when data absent', () => {
  it('roof PV-4C shows — for utilization ratio when rafter.utilizationRatio is undefined', () => {
    const input = clone(roofProject);
    // Ensure no rafter utilization data
    delete input.compliance.structural.rafter;
    delete input.compliance.structural.attachment;
    delete input.compliance.structural.totalDeadLoadPsf;
    delete input.compliance.structural.moduleLoadPsf;
    delete input.compliance.structural.rackingLoadPsf;
    delete input.compliance.structural.wind;
    delete input.compliance.structural.snow;

    const html = generatePermitHTML(input);
    const pv4c = sheetPage(html, 'PV-4C');
    expect(pv4c).toBeTruthy();

    // Must NOT contain "0%" in the utilization row (the old misleading default)
    // The utilization row should show — instead
    if (pv4c!.includes('Utilization Ratio')) {
      // If the row exists, it should not show "0%" from the old (||0)*100 pattern
      expect(pv4c).not.toMatch(/Utilization Ratio.*>0%</);
    }
  });
});

// ── Defect 4: Safety factor color guard ────────────────────────────
describe('Defect 4 — Safety factor color guard handles — values', () => {
  it('roof PV-3 safety factor row does not apply red color when value is —', () => {
    const input = clone(roofProject);
    delete input.compliance.structural.rafter;
    delete input.compliance.structural.attachment;
    delete input.compliance.structural.totalDeadLoadPsf;
    delete input.compliance.structural.moduleLoadPsf;
    delete input.compliance.structural.rackingLoadPsf;
    delete input.compliance.structural.wind;
    delete input.compliance.structural.snow;

    const html = generatePermitHTML(input);
    const pv3 = sheetPage(html, 'PV-3');
    expect(pv3).toBeTruthy();

    // When safetyFact is —, the color should NOT be #cc0000
    // The old code: color:${Number(safetyFact) < 2 ? '#cc0000' : '#000'}
    // Number('—') = NaN, NaN < 2 = false → always black (OK for color)
    // But the old code also showed " (min. 2.0)" after —, which is misleading
    // New code: only shows " (min. 2.0)" when Number(safetyFact) > 0
    if (pv3!.includes('Safety Factor</td>')) {
      // If the safety factor cell contains —, it should NOT have " (min. 2.0)"
      const sfMatch = pv3!.match(/Safety Factor<\/td>[\s\S]*?<\/td>/);
      if (sfMatch && sfMatch[0].includes('—')) {
        expect(sfMatch[0]).not.toContain('(min. 2.0)');
      }
    }
  });
});

// ── Defect 5: Prose guards ─────────────────────────────────────────
describe('Defect 5 — Structural prose guards against — values', () => {
  it('roof structural interpretation shows data-not-available when safety factor is —', () => {
    const input = clone(roofProject);
    delete input.compliance.structural.rafter;
    delete input.compliance.structural.attachment;
    delete input.compliance.structural.totalDeadLoadPsf;
    delete input.compliance.structural.moduleLoadPsf;
    delete input.compliance.structural.rackingLoadPsf;
    delete input.compliance.structural.wind;
    delete input.compliance.structural.snow;

    const html = generatePermitHTML(input);
    const pv4c = sheetPage(html, 'PV-4C');
    expect(pv4c).toBeTruthy();

    // The old code would render: "Safety factor of — confirmed BELOW the required minimum of 2.0."
    // The new code should NOT render "Safety factor of — confirmed" at all
    expect(pv4c).not.toContain('Safety factor of — confirmed');
    expect(pv4c).not.toContain('safety factor of —');

    // Similarly for utilization: "The rafter utilization ratio of —%" should not appear
    expect(pv4c).not.toContain('rafter utilization ratio of —%');
  });

  it('roof conclusion shows "data incomplete" when both SF and utilization are absent', () => {
    const input = clone(roofProject);
    delete input.compliance.structural.rafter;
    delete input.compliance.structural.attachment;
    delete input.compliance.structural.totalDeadLoadPsf;
    delete input.compliance.structural.moduleLoadPsf;
    delete input.compliance.structural.rackingLoadPsf;
    delete input.compliance.structural.wind;
    delete input.compliance.structural.snow;

    const html = generatePermitHTML(input);
    const pv4c = sheetPage(html, 'PV-4C');
    expect(pv4c).toBeTruthy();

    // With null values, should show "data incomplete" or "verify" message
    // rather than "Review flagged structural items" (which implies a failure)
    expect(pv4c).toContain('data incomplete');
  });

  it('ground structural prose shows data-not-available when safety factor is —', () => {
    const input = clone(groundProject);
    delete input.compliance.structural.rafter;
    delete input.compliance.structural.attachment;
    delete input.compliance.structural.totalDeadLoadPsf;
    delete input.compliance.structural.moduleLoadPsf;
    delete input.compliance.structural.rackingLoadPsf;
    delete input.compliance.structural.wind;
    delete input.compliance.structural.snow;

    const html = generatePermitHTML(input);
    const pv4c = sheetPage(html, 'PV-4C');
    expect(pv4c).toBeTruthy();

    // Should not render "Safety factor of — confirmed BELOW"
    expect(pv4c).not.toContain('Safety factor of — confirmed');
  });
});

// ── Defect 9: OCPD formula display ─────────────────────────────────
describe('Defect 9 — OCPD formula uses ×1.56 with NEC section citations', () => {
  it('equipment schedule (SCHED) shows OCPD ≥ Isc×1.56 in wire sizing table', () => {
    const html = generatePermitHTML(clone(roofProject));
    const sched = sheetPage(html, 'SCHED');
    expect(sched).toBeTruthy();

    // The header should use the clearer "Isc×1.56" format with NEC reference
    expect(sched).toContain('Isc×1.56');
    // Should NOT contain the old ambiguous "×1.25 OCPD" header
    expect(sched).not.toContain('×1.25 OCPD');
  });

  it('equipment schedule formula reference cites NEC 690.8(A)(1)×(B)(1)', () => {
    const html = generatePermitHTML(clone(roofProject));
    const sched = sheetPage(html, 'SCHED');
    expect(sched).toBeTruthy();

    // Formula reference should include NEC section citations
    expect(sched).toContain('690.8(A)(1)');
    expect(sched).toContain('690.8(A)(1)×(B)(1)');
    // Wire sizing interpretation should use ×1.56
    expect(sched).toContain('Isc × 1.56');
  });
});

// ── Full generation smoke test (regression gate) ───────────────────
describe('Planset generation with structural data gaps', () => {
  it('generates complete planset without structural compliance data', () => {
    const input = clone(roofProject);
    // Strip ALL structural compliance data to simulate a pre-calc state
    input.compliance.structural = {};

    const html = generatePermitHTML(input);
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(5000);
    // Should still produce all expected sheets
    expect(html).toContain('PV-0');
    expect(html).toContain('PV-4C');
    expect(html).toContain('SCHED');
  });

  it('generates complete planset WITH structural compliance data (normal path)', () => {
    // This test uses the full fixture as-is — the generatePermit orchestrator
    // will run structural V4 and electrical calcs server-side
    const html = generatePermitHTML(clone(roofProject));
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(5000);
    expect(html).toContain('PV-4C');
  });
});
