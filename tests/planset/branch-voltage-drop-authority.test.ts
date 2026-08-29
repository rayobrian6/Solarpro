// R5 - EACH BRANCH'S DROP IS DERIVED FROM THAT BRANCH (2026-08-29)
//
// PV-4B/PV-4B.1 printed an IDENTICAL 0.08% voltage drop for all three AC
// branches, beside three different lengths (64 / 63.2 / 39.3 ft) and three
// different currents (16.0 / 14.5 / 14.5 A) taken from the per-branch model.
// `branches.forEach` read ONE shared BRANCH_RUN segment for the percentage while
// the length and current columns came from the per-branch cable path - one row
// assembled from two incompatible sources. Each row still carried its own
// "PROVISIONAL PASS - 0.08% <= 2.0%", so the margin claimed was not the margin
// the branch has: the true drop is ~1.2-1.8%, close enough to the 2% criterion
// that the difference matters.
//
// The shared segment's own percentage was computed from a length that appeared
// nowhere on the sheet: build.ts moves the LENGTH onto that segment from the
// cable paths and never recomputes the percentage - the exact failure the
// field-measurement block was written to prevent ("THE PERCENTAGE IS RECOMPUTED,
// NOT RETAINED").
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import { recalculateRouteVoltageDrop } from '@/lib/permit/snapshot/routeVoltageDropRecalc';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
const input: any = clone(braidonOriginalAuditFixture);
input.plansetProfile = 'design-review';
const HTML: string = generatePermitHTML(input) as unknown as string;
const TEXT = HTML.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

describe('three branches, three drops', () => {
  it('the branch drops are not all the same number', () => {
    const vds = [...TEXT.matchAll(/(\d+\.\d+)% \/ \u2264?2%/g)].map(m => m[1]);
    expect(vds.length, 'branch rows carry a drop').toBeGreaterThanOrEqual(3);
    expect(new Set(vds.slice(0, 3)).size, `identical drops: ${vds.slice(0, 3).join(', ')}`).toBeGreaterThan(1);
  });

  it('and the shared 0.08% is gone', () => {
    expect(TEXT).not.toMatch(/0\.08%/);
  });

  it('each drop reproduces from that branch length and current', () => {
    // 42.9 ft at 20 A continuous through the Q-Cable's #12 conductors.
    const r = recalculateRouteVoltageDrop({
      lengthFt: 42.9, continuousCurrentA: 20, operatingCurrentA: 16,
      conductorGauge: '#12 AWG', systemVoltage: 240,
    });
    expect(r.voltageDropPct).toBeCloseTo(1.416, 2);
    expect(TEXT).toMatch(/1\.42% \/ \u2264?2%/);
  });

  it('a drop that cannot be computed is INDETERMINATE, never a pass', () => {
    const r = recalculateRouteVoltageDrop({
      lengthFt: null, continuousCurrentA: 20, operatingCurrentA: 16,
      conductorGauge: '#12 AWG', systemVoltage: 240,
    });
    expect(r.voltageDropPct).toBeNull();
    expect(r.derivation).toMatch(/INDETERMINATE, never a pass/);
  });
});
