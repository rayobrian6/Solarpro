// ═══════════════════════════════════════════════════════════════════════════
// ONE ROOF, SIX DESCRIPTIONS — AND ONE MEMBER WITH TWO NAMES
//
// ── THE PITCH ──────────────────────────────────────────────────────────────
// Braidon's roof is two planes: 16.5178° and 18.2491°. Six places converted and
// rounded that independently, so the package described it six ways:
//
//   PV-0 cover / CERT / sheetComposition   3.6:12   (1 decimal)
//   PV-2 site-plan label                   4/12     ← 18.4°, a DIFFERENT roof
//   PV-2 plane table                       17°, 18° (Math.round)
//   PV-1 array parameters                  17–18°   (toFixed(0) range)
//
// A reviewer cannot tell "these sheets disagree about the roof" from "these
// sheets round differently", and one of them WAS wrong: 3.558 printed as 4:12 in
// a box on the site plan.
//
// ── THE MEMBER ─────────────────────────────────────────────────────────────
// The roof is a PRE-ENGINEERED TRUSS. CERT said so, and PV-3's own spec table
// said so ("TRUSS SIZE 2x6 / TRUSS SPACING 24 O.C.") — while the cross-section,
// the callouts and the structural notes on that SAME SHEET hardcoded RAFTER
// eight times. Cutting or notching a truss chord voids its engineering and a
// rafter is site-framed lumber, so the sheet was telling an installer two
// different things about the member they are screwing into.
//
// Three files derived truss-ness independently and did not agree on the test:
// certPages asked only for the declared `framingType`; the other two also
// inferred it from a zero bending moment against a non-zero allowable.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import {
  pitchRatioFromDeg, formatPitchRatio, formatPitchDeg, formatPitchBoth,
  formatPitchRangeDeg, formatPitchPlanLabel, framingMember, PITCH_DECIMALS,
} from '@/lib/structural/roofPitch';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
const input: any = clone(braidonOriginalAuditFixture);
input.plansetProfile = 'design-review';
const html = generatePermitHTML(input) as unknown as string;
const text = html
  .replace(/<[^>]+>/g, ' ')
  .replace(/&deg;/g, '°').replace(/&quot;/g, '"').replace(/&times;/g, '×')
  .replace(/&mdash;/g, '—').replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ');

const PLANES = [16.517622167804127, 18.24908301732976];

describe('one pitch, one precision', () => {
  it('the ratio is derived at the declared precision, not per sheet', () => {
    expect(PITCH_DECIMALS).toBe(1);
    expect(pitchRatioFromDeg(PLANES[0])).toBe(3.6);
    expect(formatPitchRatio(PLANES[0])).toBe('3.6:12');
    expect(formatPitchDeg(PLANES[0])).toBe('16.5°');
    expect(formatPitchBoth(PLANES[0])).toBe('3.6:12 (16.5°)');
  });

  it('the site-plan label no longer states a different roof', () => {
    // The live defect: Math.round(3.558) = 4, printed as "4/12" — which is 18.4°.
    expect(formatPitchPlanLabel(PLANES[0])).toBe('3.6/12');
    expect(text).not.toMatch(/\b4\/12\b/);
    expect(text).not.toMatch(/\b4:12\b/);
  });

  it('the package states exactly ONE rise:12 value', () => {
    const forms = new Set((text.match(/\d+(?:\.\d+)?\s*[:/]\s*12\b/g) ?? [])
      .map(s => s.replace(/\s+/g, '')));
    expect([...forms]).toEqual(['3.6:12']);
  });

  it('and the plane degrees agree everywhere they appear', () => {
    // Both facets, at the one precision. 17° / 18° were the rounded shadows.
    expect(text).toContain('16.5°');
    expect(text).toContain('18.2°');
    expect(text).not.toMatch(/(?<![\d.])17°/);
    expect(text).not.toMatch(/TILT[^A-Za-z]{0,12}18°(?!\.)/);
  });

  it('a multi-plane range is printed at the SAME precision as its members', () => {
    expect(formatPitchRangeDeg(PLANES)).toBe('16.5–18.2°');
    expect(formatPitchRangeDeg([16.5178, 16.5182])).toBe('16.5°');   // collapses when equal
    expect(formatPitchRangeDeg([])).toBeNull();                       // never a default
    expect(text).toContain('16.5–18.2°');
    expect(text).not.toContain('17–18');
  });

  it('nothing invents a pitch when none is on file', () => {
    // arrayPages fell back to `project.roofPitch || 20` — a 20° roof from nothing.
    expect(pitchRatioFromDeg(null)).toBeNull();
    expect(formatPitchRatio(undefined)).toBeNull();
    expect(formatPitchBoth(NaN)).toBeNull();
  });
});

describe('one member, one name', () => {
  it('the determination is made once, and it accepts BOTH tests', () => {
    expect(framingMember({ framingType: 'truss' }).isTruss).toBe(true);
    // the analysis-shaped test the two other copies used and certPages did not
    expect(framingMember({ bendingMoment: 0, allowableBendingMoment: 30 }).isTruss).toBe(true);
    expect(framingMember({ framingType: 'rafter', bendingMoment: 120, allowableBendingMoment: 300 }).isTruss).toBe(false);
    expect(framingMember(null).isTruss).toBe(false);
  });

  it('it says WHY, for the review record', () => {
    expect(framingMember({ framingType: 'truss' }).basis).toMatch(/declares framingType/);
    expect(framingMember({ bendingMoment: 0, allowableBendingMoment: 30 }).basis).toMatch(/no bending demand/);
  });

  it('this roof is a truss, so no drawing calls the member a RAFTER', () => {
    expect(input.compliance.structural.rafter.framingType).toBe('truss');
    // The eight hardcoded PV-3 strings, plus the two on the roof plan.
    expect(text).not.toMatch(/RAFTER/);
    expect(text).toMatch(/TRUSS/);
  });

  it('...and a STICK-framed design gets the other word, from the same record', () => {
    // The rule cuts both ways, and this proves the term FOLLOWS the record rather
    // than having been swapped for a different constant. `project.framingType`
    // is what structuralInput passes to the engine (absent ⇒ auto-detect, which
    // reads 24" O.C. as a truss — which is why Braidon is one).
    const stick: any = clone(braidonOriginalAuditFixture);
    stick.plansetProfile = 'design-review';
    stick.project.framingType = 'rafter';
    stick.project.rafterSpacing = 16;
    generatePermitHTML(stick);
    expect(stick.compliance?.structural?.rafter?.framingType).toBe('rafter');
    const t = (generatePermitHTML(stick) as unknown as string)
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(t).toMatch(/RAFTER/);
    expect(t).not.toMatch(/TRUSS SIZE|TRUSS SPACING/);
  });
});
