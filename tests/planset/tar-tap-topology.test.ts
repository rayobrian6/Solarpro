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
// These tests pin the corrected chain AND pin that the repair did not close the
// requirement: the length is still unknown and the constraint is still pending.
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

  it('THE REPAIR DOES NOT CLOSE THE REQUIREMENT — length unknown, constraint pending', () => {
    const t = topology();
    const tap = byId(t, 'svc-tap-conductors')!;
    expect(tap.lengthFt).toBeNull();
    expect(tap.lengthSource).toBe('unknown');
    const c = (tap.constraints ?? []).find(x => x.code === 'NEC-705.11(C)-TAP-10FT')!;
    expect(c.state).toBe('pending');
    expect(c.limitFt).toBe(10);
  });

  it('TAP-CONDUCTOR-LENGTH-PENDING is still an open requirement', () => {
    const input: any = clone(braidonOriginalAuditFixture);
    input.generatedAtIso = '2026-07-22T12:00:00Z';
    generatePermitHTML(input);
    const snap = input._snapshot as PermitDesignSnapshot;
    const reg = snap.permitReadiness.registry;
    const tapReq = reg.find(r => r.code === 'TAP-CONDUCTOR-LENGTH-PENDING');
    expect(tapReq, 'the tap-length requirement must still exist').toBeTruthy();
    expect(tapReq!.resolved).toBe(false);
  });

  it('DISCO_TO_METER_RUN remains a SEPARATE route, not merged with the tap span', () => {
    const input: any = clone(braidonOriginalAuditFixture);
    input.generatedAtIso = '2026-07-22T12:00:00Z';
    generatePermitHTML(input);
    const snap = input._snapshot as PermitDesignSnapshot;
    const segs = snap.electrical.routeSegments ?? [];
    const disco = segs.find(s => s.segmentId === 'DISCO_TO_METER_RUN');
    expect(disco, 'DISCO_TO_METER_RUN must still exist as its own route').toBeTruthy();
    // It is a route segment, not a service-topology tap object.
    const t = topology();
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
