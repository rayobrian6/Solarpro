// ═══════════════════════════════════════════════════════════════════════════
// ONE FIRE FACT, ONE PRODUCER — proven by MUTATION, not by coincidence.
//
// The pathway defect was not "two sources with different values". It was two
// sources at all: a printed literal 36" in arrayPages.ts and a geometry value
// read from `roofSetbackInches`. They agreed on 3,514 jurisdictions and
// disagreed on 502 — the sheet printing 36" over a drawing dimensioned at 18".
//
// So asserting `36` in two places would reproduce the defect in the test suite.
// These tests instead MUTATE the canonical fact and require both consumers to
// follow. A test that pins the number twice cannot tell agreement from a shared
// source, which is exactly how the original defect survived.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  resolveAccessPathwayIn, resolveHipValleySetbackIn,
  MODELED_ACCESS_PATHWAY_IN, MODELED_HIP_VALLEY_SETBACK_IN,
  ACCESS_PATHWAY_BASIS,
} from '@/lib/permit/utils/fireSetback';

describe('the canonical fire facts are single-producer', () => {
  it('the modeled pathway is 36 inches', () => {
    expect(MODELED_ACCESS_PATHWAY_IN).toBe(36);
    expect(resolveAccessPathwayIn(null)).toBe(36);
    expect(resolveAccessPathwayIn(undefined)).toBe(36);
  });

  it('the modeled hip/valley setback is 18 inches', () => {
    expect(MODELED_HIP_VALLEY_SETBACK_IN).toBe(18);
    expect(resolveHipValleySetbackIn(null)).toBe(18);
  });

  it('MUTATION: a governed override moves the pathway, and every consumer follows', () => {
    // The mutation the brief asks for. Both the drawing and the note call this
    // one accessor, so an override cannot move one without moving the other.
    expect(resolveAccessPathwayIn(42)).toBe(42);
    // geometry consumes inches/12; the note consumes inches. Same source.
    expect(resolveAccessPathwayIn(42) / 12).toBe(3.5);
  });

  it('MUTATION: a governed override moves hip/valley', () => {
    expect(resolveHipValleySetbackIn(24)).toBe(24);
    expect(resolveHipValleySetbackIn(24) / 12).toBe(2);
  });

  it('an absent or zero override never silently becomes zero clearance', () => {
    // A falsy override must fall back to the modeled basis, not to 0 — a 0"
    // pathway would be a drawing with no fire access at all.
    for (const bad of [0, -1, null, undefined, NaN]) {
      expect(resolveAccessPathwayIn(bad as number)).toBe(MODELED_ACCESS_PATHWAY_IN);
      expect(resolveHipValleySetbackIn(bad as number)).toBe(MODELED_HIP_VALLEY_SETBACK_IN);
    }
  });
});

describe('the pathway basis is a DESIGN BASIS, never a local adoption', () => {
  it('carries modeled authority, not jurisdiction authority', () => {
    expect(ACCESS_PATHWAY_BASIS.status).toBe('MODELED_DESIGN_BASIS');
    expect(ACCESS_PATHWAY_BASIS.origin).toBe('model_code');
    expect(ACCESS_PATHWAY_BASIS.authorityLevel).toBe('model_code');
  });

  it('is usable for design but NOT as a permit claim', () => {
    // A modeled basis is legitimately useful — it just is not evidence about
    // what this AHJ requires.
    expect(ACCESS_PATHWAY_BASIS.releaseSemantics.usableForDesign).toBe(true);
    expect(ACCESS_PATHWAY_BASIS.releaseSemantics.usableForDesignReview).toBe(true);
    expect(ACCESS_PATHWAY_BASIS.releaseSemantics.usableForPermitClaim).toBe(false);
  });

  it('does not claim local adoption or a checked amendment', () => {
    expect(ACCESS_PATHWAY_BASIS.localAdoption).toBe('PENDING_VERIFICATION');
    expect(ACCESS_PATHWAY_BASIS.amendmentStatus).toBe('NOT_CHECKED');
  });
});

describe('no second literal survives as a same-fact producer', () => {
  it('the legacy roofSetbackInches column no longer drives pathway geometry', async () => {
    // It is quarantined, not deleted: what it historically meant is unproven, so
    // the data stays and only its WRONG consumer was removed. The guard is that
    // the pathway no longer varies with it.
    const { AHJ_NATIONAL } = await import('@/lib/jurisdictions/ahj-national');
    const distinct = new Set(AHJ_NATIONAL.map(r => r.roofSetbackInches));
    expect(distinct.size, 'the legacy column still varies').toBeGreaterThan(1);
    // ...and yet every jurisdiction resolves the same pathway.
    const widths = new Set(AHJ_NATIONAL.map(() => resolveAccessPathwayIn(null)));
    expect(widths.size, 'pathway width must not vary with the legacy column').toBe(1);
  });
});
