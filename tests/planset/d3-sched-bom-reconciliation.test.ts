// ═══════════════════════════════════════════════════════════════════════════
// D3 (Planset 17) — CANONICAL-TO-RENDERED BOM RECONCILIATION.
//
// The BOM derivation was never broken. `emitRacewayConduitBom` loops over every
// derived physical raceway and always did: in the FULL profile all three
// project-owned raceways appear with their fittings. What was broken was
// COMPOSITION — the compact profiles (permit AND design-review) suppressed the
// SCHED continuation sheets while the primary sheet capped at
// SCHED_BOM_ROWS_FIRST, so 38 of 48 canonical procurement lines never reached
// the artifact a reviewer holds, and no population total was emitted to compare
// against. The schedule silently omitted four fifths of itself.
//
// Every gate that could have caught it was blind:
//   • the ECD procurement gates count rows off the BOM ARRAY, not the sheet;
//   • aac-ws10 asserted `not.toContain('CONTINUED ON NEXT SHEET')`, which the
//     truncation SATISFIED;
//   • page-fit passes trivially when the rows are simply not there.
//
// So the invariant is stated here directly, against the RENDERED artifact:
// the set of BOM row ids on the sheets equals the canonical set, exactly once
// each, under every profile.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import { buildSheetManifest } from '@/lib/permit/sheetManifest';
import { schedBomRowCount, schedContPageCount, SCHED_BOM_ROWS_FIRST } from '@/lib/permit/sections/structuralPages';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';

type Pkg = { html: string; snap: PermitDesignSnapshot; input: any };
const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

function render(profile?: 'permit' | 'full' | 'design-review'): Pkg {
  const input: any = clone(braidonOriginalAuditFixture);
  input.generatedAtIso = '2026-07-22T12:00:00Z';
  if (profile) input.plansetProfile = profile;
  const html = generatePermitHTML(input);
  return { html, snap: input._snapshot as PermitDesignSnapshot, input };
}

/** every BOM row id the artifact actually renders, in document order. */
const renderedRowIds = (html: string): string[] =>
  [...html.matchAll(/data-bom-line-id="([^"]+)"/g)].map(m => m[1]);

const sheetIds = (h: string): string[] =>
  [...h.matchAll(/tb-sheet-id">\s*([^<]+?)\s*</g)].map(m => m[1]);

const PROFILES = ['full', 'permit', 'design-review'] as const;
const PKG: Record<string, Pkg> = Object.fromEntries(PROFILES.map(p => [p, render(p)]));

describe('D3 — every canonical BOM row reaches the artifact, on every profile', () => {
  for (const p of PROFILES) {
    it(`${p}: renders rows, each exactly once`, () => {
      const ids = renderedRowIds(PKG[p].html);
      expect(ids.length, `${p}: no BOM rows rendered at all`).toBeGreaterThan(0);
      const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
      expect(dupes, `${p}: rows rendered on more than one sheet: ${[...new Set(dupes)].join(', ')}`).toEqual([]);
    });
  }

  it('the compact profiles render the SAME row set as the internal package', () => {
    const full = new Set(renderedRowIds(PKG.full.html));
    for (const p of ['permit', 'design-review'] as const) {
      const got = new Set(renderedRowIds(PKG[p].html));
      const missing = [...full].filter(id => !got.has(id));
      const extra = [...got].filter(id => !full.has(id));
      expect(missing, `${p} is MISSING ${missing.length} canonical BOM rows: ${missing.slice(0, 12).join(', ')}`).toEqual([]);
      expect(extra, `${p} renders ${extra.length} rows the internal package does not: ${extra.slice(0, 12).join(', ')}`).toEqual([]);
    }
  });

  it('a compact profile is not shorter BY ROWS — only by sheets', () => {
    // the exact symptom: 10 rendered against 48 canonical.
    const full = renderedRowIds(PKG.full.html).length;
    for (const p of ['permit', 'design-review'] as const) {
      expect(renderedRowIds(PKG[p].html).length,
        `${p} renders fewer BOM rows than the internal package — this is the D3 truncation`,
      ).toBe(full);
    }
  });
});

describe('D3 — every project-owned raceway is represented, utility-owned is not', () => {
  const PROJECT_OWNED = ['RW-BRANCH-HOMERUN', 'RW-COMBINER_TO_DISCO_RUN', 'RW-DISCO_TO_METER_RUN'];

  for (const p of PROFILES) {
    it(`${p}: all three project-owned raceways appear in the rendered schedule`, () => {
      for (const rw of PROJECT_OWNED) {
        expect(PKG[p].html, `${p}: ${rw} has no rendered rows`).toContain(rw);
      }
    });
  }

  it('no rendered row references the utility-owned service run', () => {
    // MSP_TO_UTILITY_RUN is utility-owned service equipment: it produces no
    // project raceway object and must produce no project procurement row.
    for (const p of PROFILES) {
      const rows = [...PKG[p].html.matchAll(/<tr[^>]*data-bom-line-id="[^"]*"[\s\S]{0,900}?<\/tr>/g)].map(m => m[0]);
      const bad = rows.filter(r => /MSP_TO_UTILITY/.test(r));
      expect(bad.length, `${p}: ${bad.length} BOM row(s) reference the utility-owned run`).toBe(0);
    }
  });
});

describe('D3 — continuation is deterministic, and only present when needed', () => {
  for (const p of PROFILES) {
    it(`${p}: sheet index contains every SCHED continuation that renders`, () => {
      const rendered = sheetIds(PKG[p].html).filter(i => /^SCHED-\d+$/.test(i));
      const indexed = PKG[p].snap.projectAuthority.sheetIndex
        .map(s => s.id).filter(i => /^SCHED-\d+$/.test(i));
      expect(indexed, `${p}: sheet index and rendered pages disagree on SCHED continuations`).toEqual(rendered);
    });
  }

  it('continuation ids are contiguous from SCHED-2', () => {
    for (const p of PROFILES) {
      const cont = sheetIds(PKG[p].html).filter(i => /^SCHED-\d+$/.test(i));
      expect(cont).toEqual(Array.from({ length: cont.length }, (_u, i) => `SCHED-${i + 2}`));
    }
  });

  it('the final schedule conclusion appears exactly once per package', () => {
    for (const p of PROFILES) {
      const n = PKG[p].html.split('PAGE CONCLUSION — EQUIPMENT SCHEDULE').length - 1;
      expect(n, `${p}: the equipment-schedule conclusion appears ${n} times`).toBe(1);
    }
  });

  // Asserted against the COUNT FUNCTION and the MANIFEST rather than by shrinking
  // a fixture: the permit path recomputes the BOM from the design (bomForPermit),
  // so overriding `input.bom` does not change what the package schedules. The
  // contract that actually governs "no continuation when it fits" lives here.
  it('a BOM that fits one sheet requires no continuation sheet', () => {
    expect(schedContPageCount([] as never)).toBe(0);
    const short = Array.from({ length: SCHED_BOM_ROWS_FIRST }, (_u, i) => ({
      category: 'conduit', description: `row ${i}`, quantity: 1, unit: 'ea',
    })) as never;
    expect(schedBomRowCount(short)).toBe(SCHED_BOM_ROWS_FIRST);
    expect(schedContPageCount(short), 'a BOM at exactly the first-sheet cap must not paginate').toBe(0);
  });

  it('the manifest emits no SCHED continuation when the count is zero', () => {
    for (const profile of ['permit', 'design-review', 'full'] as const) {
      const ids = buildSheetManifest({
        pv1Title: 'A', pv3Title: 'B', profile,
        datasheets: [{ id: 'DS-1', title: 'x' }], schedContCount: 0,
      }).map(s => s.id);
      expect(ids.filter(i => /^SCHED-\d+$/.test(i)), `${profile} emitted continuations for a 0 count`).toEqual([]);
      expect(ids).toContain('SCHED');
    }
  });
});
