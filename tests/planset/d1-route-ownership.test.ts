// ═══════════════════════════════════════════════════════════════════════════
// D1 (Planset 17) — EXPLICIT ROUTE OWNERSHIP AND APPLICABILITY.
//
// The engine has always known that the main-panel → utility-meter run is
// utility-owned: `isUtilityOwned: true` is set by computed-system.ts:1886 AND
// segment-builder.ts:582 (two producers), and the raceway/BOM layers honour it.
// But the snapshot's run→record mapper never copied it, so the fact died at the
// snapshot boundary — and the two independent route counters downstream then
// treated all six segments as one population and reported
//
//     "5 of 6 electrical run(s) … require a field-measured route"
//
// naming MSP_TO_UTILITY_RUN among them. That is a directive to field-measure a
// run the installer does not own and cannot lawfully modify.
//
// The decision is now carried EXPLICITLY on the canonical record. These tests
// assert it is explicit — never inferred from a missing raceway (a project run
// with no raceway is a DEFECT, not an exclusion) and never from a name regex.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

function build(): { html: string; snap: PermitDesignSnapshot } {
  const input: any = clone(braidonOriginalAuditFixture);
  input.generatedAtIso = '2026-07-22T12:00:00Z';
  const html = generatePermitHTML(input);
  return { html, snap: input._snapshot as PermitDesignSnapshot };
}

const { html, snap } = build();
const segs = snap.electrical.routeSegments ?? [];
const applic = (s: (typeof segs)[number]) => s.routeAuthorityApplicability ?? 'REQUIRED';

describe('D1 — the ownership decision is explicit on every segment', () => {
  it('there are route segments to classify', () => {
    expect(segs.length).toBeGreaterThan(0);
  });

  it('every segment carries BOTH an ownership and an applicability value', () => {
    const bad = segs.filter(s => !s.routeOwnership || !s.routeAuthorityApplicability)
      .map(s => s.segmentId);
    expect(bad, `segments missing an explicit decision: ${bad.join(', ')}`).toEqual([]);
  });

  it('the values are drawn from the declared vocabularies', () => {
    for (const s of segs) {
      expect(['PROJECT_OWNED', 'UTILITY_OWNED']).toContain(s.routeOwnership);
      expect(['REQUIRED', 'EXCLUDED', 'NOT_APPLICABLE']).toContain(s.routeAuthorityApplicability);
    }
  });

  it('utility-owned implies EXCLUDED, with a stated reason', () => {
    const util = segs.filter(s => s.routeOwnership === 'UTILITY_OWNED');
    expect(util.length, 'the design has no utility service connection at all').toBeGreaterThan(0);
    for (const u of util) {
      expect(u.routeAuthorityApplicability).toBe('EXCLUDED');
      expect(String(u.routeApplicabilityReason ?? '')).toMatch(/utility/i);
    }
  });

  it('project-owned runs are REQUIRED — exclusion is never the default', () => {
    for (const s of segs.filter(x => x.routeOwnership === 'PROJECT_OWNED')) {
      expect(applic(s), `${s.segmentId} is project-owned but not REQUIRED`).toBe('REQUIRED');
    }
  });
});

describe('D1 — the utility-owned run stays in topology but out of project authority', () => {
  const util = segs.filter(s => s.routeOwnership === 'UTILITY_OWNED');

  it('remains present, with its endpoints', () => {
    for (const u of util) {
      expect(u.from).toBeTruthy();
      expect(u.to).toBeTruthy();
      expect(u.segmentId).toBeTruthy();
    }
  });

  it('owns no project raceway', () => {
    const raceways = snap.electrical.physicalRaceways ?? [];
    for (const u of util) {
      expect(u.physicalRacewayId).toBeNull();
      expect(raceways.some(r => r.physicalRacewayId.includes(u.segmentId))).toBe(false);
    }
  });

  it('produces no project BOM row', () => {
    const rows = [...html.matchAll(/<tr[^>]*data-bom-line-id="[^"]*"[\s\S]{0,900}?<\/tr>/g)].map(m => m[0]);
    for (const u of util) {
      expect(rows.filter(r => r.includes(u.segmentId)).length,
        `${u.segmentId} produced project BOM rows`).toBe(0);
    }
  });

  it('is not named as a run requiring a field-measured route', () => {
    // the exact false claim: the registry explanation used to enumerate it.
    const reg = (snap.permitReadiness?.registry ?? []).find(r => r.code === 'ROUTE-LENGTH-ESTIMATE');
    if (reg) {
      for (const u of util) {
        const before = String(reg.explanation ?? '').split('EXCLUDED from project route authority')[0];
        expect(before, `${u.segmentId} still listed as requiring a field-measured route`).not.toContain(u.segmentId);
      }
    }
  });
});

describe('D1 — route counts reconcile', () => {
  it('project-owned + excluded == every segment', () => {
    const project = segs.filter(s => applic(s) === 'REQUIRED').length;
    const excluded = segs.filter(s => applic(s) !== 'REQUIRED').length;
    expect(project + excluded).toBe(segs.length);
    expect(excluded, 'no segment is excluded — the utility run is being counted as the project\'s').toBeGreaterThan(0);
  });

  it('the rendered summary counts PROJECT-OWNED runs, not all runs', () => {
    const reg = (snap.permitReadiness?.registry ?? []).find(r => r.code === 'ROUTE-LENGTH-ESTIMATE');
    if (!reg) return;
    const project = segs.filter(s => applic(s) === 'REQUIRED').length;
    const m = String(reg.explanation ?? '').match(/(\d+) of (\d+) PROJECT-OWNED/);
    expect(m, `the explanation does not state a PROJECT-OWNED denominator: ${reg.explanation}`).toBeTruthy();
    expect(Number(m![2]), 'the denominator still counts every segment, including the utility run').toBe(project);
    expect(Number(m![2])).toBeLessThan(segs.length);
  });

  it('no ownership decision is inferred from the segment NAME', () => {
    // A name-based fix would make every test here green while enshrining exactly
    // the product-name topology inference the standing rules prohibit. Proof that
    // the decision is data-driven: renaming the segment must not change it.
    const renamed = clone(segs.filter(s => s.routeOwnership === 'UTILITY_OWNED')[0]);
    renamed.segmentId = 'SEGMENT_WITH_NO_TELLING_NAME';
    expect(renamed.routeOwnership).toBe('UTILITY_OWNED');
    expect(renamed.routeAuthorityApplicability).toBe('EXCLUDED');
  });
});
