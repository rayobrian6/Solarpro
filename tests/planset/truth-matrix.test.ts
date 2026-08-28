// Cross-sheet TRUTH MATRIX (Deliverable E, W2 activation of the V9 feeder
// class): renders the full package once and asserts every printed instance of
// each ACTIVATED value class equals the snapshot authority. Classes convert
// from "measured by evidence" to "asserted here" as their wave lands.
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { roofProject } from '../../test-fixtures/roofProject';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';

const input: any = JSON.parse(JSON.stringify(roofProject));
const html = generatePermitHTML(input);
const snap: PermitDesignSnapshot = input._snapshot;
const pages = html.split(/<div class="page"[ >]/).slice(1);

const instancesOf = (re: RegExp) => {
  const out: number[] = [];
  for (const p of pages) for (const m of p.matchAll(re)) out.push(Number(m[1]));
  return out;
};

describe('truth matrix — activated classes (W2)', () => {
  it('snapshot exists and is the render authority', () => {
    expect(snap?.meta?.snapshotId).toMatch(/^PDS-/);
    expect(snap.electrical.engineOfRecord).toBe('computeSystem');
  });

  it('feeder/backfeed OCPD: every printed instance equals snapshot.electrical.feeder.ocpdA', () => {
    const authority = snap.electrical.feeder.ocpdA;
    expect(authority).toBeGreaterThan(0);
    const printed = instancesOf(/(\d+)A\s*(?:PV\s*BREAKER|FUSED\s*(?:—|-|&mdash;)\s*TAP OCPD|BACKFEED)/gi);
    expect(printed.length).toBeGreaterThan(0);
    for (const v of printed) expect(v).toBe(authority);
  });

  it('branch OCPDs: no printed branch breaker exceeds the manufacturer max', () => {
    const inv = snap.equipment.microInverters[0];
    if (!inv) return;
    const printed = instancesOf(/microinverter<\/td>[\s\S]{0,220}?fw7">(\d+)A/gi);
    for (const v of printed) expect(v).toBeLessThanOrEqual(inv.spec.maxBranchOcpdA);
  });

  it('module count: every "N modules" instance equals the snapshot count', () => {
    const printed = instancesOf(/(\d+)\s+modules\b/gi);
    expect(printed.length).toBeGreaterThan(0);
    for (const v of printed) expect(v).toBe(snap.derived.moduleCount);
  });

  it('D-4: the fabricated dwelling-load calculation is gone', () => {
    expect(html).not.toContain('220.82(B)(1)');
    expect(html).not.toMatch(/assumed from \d+A service/);
    expect(html).not.toMatch(/5-ton|3-ton/);
    expect(html).toContain('Not provided — no verified dwelling load inputs on file');
  });

  it('W2.1: canonical=computeSystem; classified parity carried; no unresolved rows', () => {
    expect(snap.electrical.engineOfRecord).toBe('computeSystem');
    expect(snap.electrical.parity.checks.length).toBeGreaterThan(0);
    for (const c of snap.electrical.parity.checks) {
      expect(c.classification, `${c.name} must be classified`).toBeTruthy();
      expect(c.resolution, `${c.name} must carry a resolution`).toBeTruthy();
    }
    expect(snap.electrical.parity.unresolved).toEqual([]);
  });

  it('W2.1: grounding is per-purpose objects — no invented conductors', () => {
    const g = snap.electrical.groundingObjects;
    expect(g.find(x => x.purpose === 'feeder-egc')?.conductorSize).toBeTruthy();
    const gec = g.find(x => x.purpose === 'gec');
    expect(gec?.required).toBe(false);
    expect(gec?.conductorSize).toBeNull();
  });

  it('W2.1: route-length authority — every segment has a length + source; estimates block permit-ready', () => {
    expect(snap.electrical.routeSegments.length).toBeGreaterThan(0);
    for (const r of snap.electrical.routeSegments) expect(r.lengthSource).toBeTruthy();
    expect(snap.permitReadiness.ready).toBe(false);
    // 2026-08-28 ROUTE-BOUND MIGRATION - ROUTE-LENGTH-ESTIMATE no longer fires on
    // this fixture: the DESIGN bounds each un-routed run. Nothing was relaxed -
    // an unbounded run still blocks and the BOM quantity is still ESTIMATED.
    // See tests/planset/route-length-bound.test.ts.
    // An estimate no longer blocks BY ITSELF - an UNBOUNDED estimate does. Every
    // estimate-grade run here carries a stated design maximum instead.
    expect(snap.permitReadiness.blockers.some(b => b.code === 'ROUTE-LENGTH-ESTIMATE')).toBe(false);
    const est = snap.electrical.routeSegments.filter(r =>
      r.lengthSource === 'cad-derived-estimate'
      && (r.routeAuthorityApplicability ?? 'REQUIRED') === 'REQUIRED');
    expect(est.length).toBeGreaterThan(0);
    for (const r of est) expect(r.lengthBoundState, r.segmentId).toBe('bounded');
  });

  it('V15: engine thermal basis matches the snapshot (no legacy -10C regime)', () => {
    expect(snap.project.thermal.provenance.note ?? '').not.toContain('MISMATCH');
    expect(input._engineThermal?.designTempMin).toBe(snap.project.thermal.designTempMinC);
  });
});
