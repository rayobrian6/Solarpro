// ═══════════════════════════════════════════════════════════════════════════
// D10 — THE TAP CONDUCTORS ARE THE EDGE BETWEEN THE TAP POINT AND THE FUSED
// DISCONNECT.
//
// `svc-tap-conductors` owns the NEC 705.11(C) ≤10-ft constraint and described
// itself as "Tap point → fused AC disconnect". Its graph edges said otherwise:
//   rsd → tap-conductors → fused-ocpd → tap-point
// putting the constrained span on the PV side of the disconnect.
//
// No consumer walks upstreamObjectId/downstreamObjectId today (every one looks
// objects up by `type`), which is exactly why this survived — and exactly why it
// had to be fixed before any route derivation starts traversing the chain.
//
// These tests pin the corrected chain.
//
// 2026-08-28 MIGRATION - two tests here encoded the OLD DUPLICATE MODEL and were
// rewritten, not relaxed. They asserted `tap.lengthFt === null`,
// `tap.lengthSource === 'unknown'`, a permanently `pending` constraint and a
// permanently open TAP-CONDUCTOR-LENGTH-PENDING. All four were assertions ABOUT
// THE DUPLICATION: `svc-tap-conductors` had to carry null because a SECOND
// object (the DISCO_TO_METER_RUN route segment) carried the real number, and the
// two were kept apart so an estimate could not certify the 10-ft rule.
//
// The span now has ONE physical authority (that route segment) and this object
// is a COMPLIANCE VIEW of it, so "the view carries null" is no longer a property
// worth having - it is the defect. What replaces those assertions is the actual
// lifecycle: a design-constrained span PASSES BY DESIGN and raises nothing; a
// span with positional authority over the limit FAILS and raises the EXCEEDED
// code; a span with no constraint at all is honestly PENDING.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import type { PermitDesignSnapshot, ServiceTopologyObject } from '@/lib/permit/snapshot/types';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

function topology(): ServiceTopologyObject[] {
  const input: any = clone(braidonOriginalAuditFixture);
  input.generatedAtIso = '2026-07-22T12:00:00Z';
  generatePermitHTML(input);
  const snap = input._snapshot as PermitDesignSnapshot;
  return (snap.electrical.serviceTopology ?? []) as ServiceTopologyObject[];
}

const byId = (t: ServiceTopologyObject[], id: string) => t.find(o => o.objectId === id) ?? null;
const byType = (t: ServiceTopologyObject[], ty: string) => t.find(o => o.type === ty) ?? null;

describe('D10 · supply-side tap topology', () => {
  it('is a supply-side design with the full canonical chain present', () => {
    const t = topology();
    for (const ty of ['tap-point', 'tap-conductors', 'fused-ocpd', 'meter', 'service-disconnect']) {
      expect(byType(t, ty), `missing ${ty}`).not.toBeNull();
    }
  });

  it('the tap conductors sit BETWEEN the fused OCPD and the tap point', () => {
    const t = topology();
    const tap = byId(t, 'svc-tap-conductors')!;
    const fused = byId(t, 'svc-fused-ocpd')!;
    const point = byId(t, 'svc-tap-point')!;

    // The constrained span: fused-ocpd → tap-conductors → tap-point
    expect(fused.downstreamObjectId).toBe('svc-tap-conductors');
    expect(tap.upstreamObjectId).toBe('svc-fused-ocpd');
    expect(tap.downstreamObjectId).toBe('svc-tap-point');
    expect(point.upstreamObjectId).toBe('svc-tap-conductors');
  });

  it('the graph edges now agree with the object description', () => {
    const t = topology();
    const tap = byId(t, 'svc-tap-conductors')!;
    // The description names the two endpoints; the edges must reach them.
    expect(tap.description).toMatch(/tap point/i);
    expect(tap.description).toMatch(/fused AC disconnect/i);
    const endpoints = [tap.upstreamObjectId, tap.downstreamObjectId].sort();
    expect(endpoints).toEqual(['svc-fused-ocpd', 'svc-tap-point']);
  });

  it('the ≤10 ft constraint belongs to the tap-conductor edge and nothing else', () => {
    const t = topology();
    const owners = t.filter(o => (o.constraints ?? []).some(c => c.code === 'NEC-705.11(C)-TAP-10FT'));
    expect(owners).toHaveLength(1);
    expect(owners[0].objectId).toBe('svc-tap-conductors');
  });

  it('the compliance view carries NO independent length - it MIRRORS the physical span', () => {
    const input: any = clone(braidonOriginalAuditFixture);
    input.generatedAtIso = '2026-07-22T12:00:00Z';
    generatePermitHTML(input);
    const snap = input._snapshot as PermitDesignSnapshot;
    const t = (snap.electrical.serviceTopology ?? []) as ServiceTopologyObject[];
    const tap = byId(t, 'svc-tap-conductors')!;
    const seg = (snap.electrical.routeSegments ?? []).find(s => s.segmentId === 'DISCO_TO_METER_RUN')!;

    // The view NAMES the physical object it is a view of ...
    expect(tap.physicalRouteSegmentId).toBe('DISCO_TO_METER_RUN');
    // ... and its length fields are that object's, not a second opinion.
    expect(tap.lengthFt).toBe(seg.oneWayFt);
    expect(tap.lengthSource).toBe(seg.lengthSource);
  });

  it('a DESIGN-CONSTRAINED span PASSES BY DESIGN and raises no requirement', () => {
    const input: any = clone(braidonOriginalAuditFixture);
    input.generatedAtIso = '2026-07-22T12:00:00Z';
    generatePermitHTML(input);
    const snap = input._snapshot as PermitDesignSnapshot;
    const seg = (snap.electrical.routeSegments ?? []).find(s => s.segmentId === 'DISCO_TO_METER_RUN')!;

    // The engine fixed the span at the 705.11(C) maximum ...
    expect(seg.lengthSource).toBe('known-design');
    expect(seg.oneWayFt!).toBeLessThanOrEqual(10);
    // ... the constraint passes ...
    const t = (snap.electrical.serviceTopology ?? []) as ServiceTopologyObject[];
    const c = (byId(t, 'svc-tap-conductors')!.constraints ?? [])
      .find(x => x.code === 'NEC-705.11(C)-TAP-10FT')!;
    expect(c.state).toBe('pass');
    expect(c.limitFt).toBe(10);
    // ... and NEITHER tap requirement is raised. A design that constrains the
    // placement is complete; waiting on an as-built measurement of a distance the
    // drawing dictates is not a defect the design has.
    const codes = snap.permitReadiness.registry.map(r => r.code);
    expect(codes).not.toContain('TAP-CONDUCTOR-LENGTH-PENDING');
    expect(codes).not.toContain('TAP-CONDUCTOR-LENGTH-EXCEEDED');
  });

  it('DISCO_TO_METER_RUN is the ONE physical object - the tap is a view, not a second route', () => {
    const input: any = clone(braidonOriginalAuditFixture);
    input.generatedAtIso = '2026-07-22T12:00:00Z';
    generatePermitHTML(input);
    const snap = input._snapshot as PermitDesignSnapshot;
    const segs = snap.electrical.routeSegments ?? [];
    // Exactly ONE route segment covers the disconnect-to-tap span.
    const spans = segs.filter(s => /DISCO_TO_(METER|TAP|POI|MSP)/.test(s.segmentId));
    expect(spans).toHaveLength(1);
    expect(spans[0].segmentId).toBe('DISCO_TO_METER_RUN');
    // No TAP_CONDUCTOR_RUN was introduced as a second physical route.
    expect(segs.some(s => /TAP_CONDUCTOR/.test(s.segmentId))).toBe(false);
    // And exactly ONE physical raceway serves it - one installation, one
    // material quantity (the duplication check the BOM depends on).
    const rwId = spans[0].physicalRacewayId;
    expect(rwId, 'the tap span must declare its physical raceway').toBeTruthy();
    const rw = (snap.electrical.physicalRaceways ?? [])
      .filter(r => r.physicalRacewayId === rwId);
    expect(rw).toHaveLength(1);
    // The tap object is a topology view, never a route segment id.
    const t = (snap.electrical.serviceTopology ?? []) as ServiceTopologyObject[];
    expect(t.some(o => o.objectId === 'DISCO_TO_METER_RUN')).toBe(false);
  });

  it('the utility-owned segment remains EXCLUDED from project route authority', () => {
    const input: any = clone(braidonOriginalAuditFixture);
    input.generatedAtIso = '2026-07-22T12:00:00Z';
    generatePermitHTML(input);
    const snap = input._snapshot as PermitDesignSnapshot;
    const msp = (snap.electrical.routeSegments ?? []).find(s => s.segmentId === 'MSP_TO_UTILITY_RUN');
    if (msp) {
      expect(msp.routeOwnership).toBe('UTILITY_OWNED');
      expect(msp.routeAuthorityApplicability).toBe('EXCLUDED');
    }
  });

  it('the chain is walkable end to end with no dangling edge', () => {
    const t = topology();
    const ids = new Set(t.map(o => o.objectId));
    for (const o of t) {
      if (o.upstreamObjectId) expect(ids.has(o.upstreamObjectId), `${o.objectId}.upstream ${o.upstreamObjectId} missing`).toBe(true);
      if (o.downstreamObjectId) expect(ids.has(o.downstreamObjectId), `${o.objectId}.downstream ${o.downstreamObjectId} missing`).toBe(true);
    }
    // and the edges are mutually consistent
    for (const o of t) {
      if (!o.downstreamObjectId) continue;
      const next = byId(t, o.downstreamObjectId)!;
      expect(next.upstreamObjectId, `${o.objectId} → ${next.objectId} is not reciprocated`).toBe(o.objectId);
    }
  });
});
