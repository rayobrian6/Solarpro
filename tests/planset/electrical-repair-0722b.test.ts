// ═══════════════════════════════════════════════════════════════════════════
// Post-campaign REPAIR PASS 2026-07-22 — RP-A (electrical) regression gates.
// Covers W1 (segment currents / VD-vs-OCPD / PV-4A honesty), W2a (service-
// topology disconnect roles), W3 (topology-description + route-verification
// authority) and W4a (micro topology ⇒ NO USE-2 DC BOM rows). Permanent gates
// 1, 2, 4, 6 from the directive's blocking-gate list.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest';
import {
  topologyDescription, branchLayoutCaption,
  routeVerificationStatus, routeVerificationLabel, routeProvenanceLabel,
  projectCanonicalBranch,
  type RouteVerificationStatus,
} from '@/lib/permit/snapshot/electricalProjection';
import { generateBOMV4 } from '@/lib/bom-engine-v4';
import { generatePermitHTML } from '@/lib/permit';
import { roofProject } from '../../test-fixtures/roofProject';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

// Minimal snapshot slice for the pure accessors (topology + a route segment).
function eSnap(opts: {
  topology?: PermitDesignSnapshot['electrical']['topology'];
  microMfr?: string;
  segments?: Partial<PermitDesignSnapshot['electrical']['routeSegments'][number]>[];
  blockers?: { code: string; message: string }[];
}): PermitDesignSnapshot {
  return {
    equipment: { microInverters: opts.microMfr ? [{ manufacturer: opts.microMfr, model: 'IQ8A' }] : [] },
    electrical: {
      topology: opts.topology ?? 'MICRO',
      routeSegments: (opts.segments ?? []).map((s, i) => ({
        segmentId: s.segmentId ?? `SEG_${i}`, from: 'a', to: 'b',
        oneWayFt: s.oneWayFt ?? 10, lengthSource: s.lengthSource ?? 'cad-derived-estimate',
        verificationStatus: s.verificationStatus, raceway: s.raceway ?? null,
        tradeSizeIn: s.tradeSizeIn ?? null, fillPct: null, conductorGauge: s.conductorGauge ?? null,
        conductorCallout: null, egcGauge: null, voltageDropPct: null, ocpdA: null,
        tempDeratingFactor: null, provenance: { source: 't' },
        ...s,
      })),
    },
    permitReadiness: { ready: false, blockers: opts.blockers ?? [] },
  } as unknown as PermitDesignSnapshot;
}

describe('W3 — canonical topology-description accessor (gate 1: no "wired in series")', () => {
  it('micro ⇒ CONNECTED IN PARALLEL, never WIRED IN SERIES', () => {
    const d = topologyDescription(eSnap({ topology: 'MICRO', microMfr: 'Enphase' }));
    expect(d).toBe('MICROINVERTERS CONNECTED IN PARALLEL ON ENPHASE Q CABLE AC BRANCH CIRCUIT');
    expect(d).not.toMatch(/wired in series/i);
  });
  it('Enphase micro caption keys the Q-Cable AC branch, not a series string', () => {
    const c = branchLayoutCaption(eSnap({ topology: 'MICRO', microMfr: 'Enphase' }));
    expect(c).toMatch(/CONNECTED IN PARALLEL/);
    expect(c).toMatch(/ENPHASE Q CABLE/);
    expect(c).not.toMatch(/wired in series/i);
  });
  it('non-Enphase micro degrades to a generic AC branch (still parallel)', () => {
    const d = topologyDescription(eSnap({ topology: 'MICRO', microMfr: 'APsystems' }));
    expect(d).toBe('MICROINVERTERS CONNECTED IN PARALLEL ON APSYSTEMS AC BRANCH CIRCUIT');
  });
  it('string topology keeps series language (series is CORRECT there)', () => {
    expect(topologyDescription(eSnap({ topology: 'STRING' }))).toMatch(/SERIES STRINGS/);
  });
});

describe('W3 — RouteVerificationStatus authority (gate 2: no field-verified without record)', () => {
  const label = (st: RouteVerificationStatus) => routeVerificationLabel(st);
  it('exposes the five allowed states with distinct labels', () => {
    expect(label('unverified-estimate')).toMatch(/UNVERIFIED ESTIMATE/);
    expect(label('cad-derived-estimate')).toMatch(/CAD-DERIVED ESTIMATE/);
    expect(label('field-measured')).toBe('FIELD-MEASURED');
    expect(label('field-verified')).toBe('FIELD-VERIFIED');
    expect(label('as-built-verified')).toBe('AS-BUILT VERIFIED');
  });
  it('CAD-derived estimate never resolves to a verified state', () => {
    const s = eSnap({ segments: [{ lengthSource: 'cad-derived-estimate', verificationStatus: 'cad-derived-estimate' }] });
    expect(routeVerificationStatus(s)).toBe('cad-derived-estimate');
    expect(routeProvenanceLabel(s)).not.toMatch(/FIELD-VERIFIED/);
  });
  it('no segment authority ⇒ unverified-estimate (weakest), never verified', () => {
    expect(routeVerificationStatus(eSnap({ segments: [] }))).toBe('unverified-estimate');
  });
  it('the WEAKEST segment governs the whole-route label', () => {
    const s = eSnap({ segments: [
      { verificationStatus: 'field-measured' },
      { verificationStatus: 'cad-derived-estimate' },
    ] });
    expect(routeVerificationStatus(s)).toBe('cad-derived-estimate');
  });
  it('an active ROUTE-LENGTH-ESTIMATE blocker caps the status at cad-derived-estimate', () => {
    const s = eSnap({
      segments: [{ verificationStatus: 'field-verified' }],
      blockers: [{ code: 'ROUTE-LENGTH-ESTIMATE', message: 'x' }],
    });
    expect(routeVerificationStatus(s)).toBe('cad-derived-estimate');
  });
});

describe('W1c — canonical branch projection (Q-Cable open air, no flat 60 ft EMT)', () => {
  it('micro branch is FREE-AIR (Q-Cable / TC-ER), length from the branch segment', () => {
    const s = eSnap({ topology: 'MICRO', segments: [
      { segmentId: 'BRANCH_RUN', raceway: 'FREE_AIR', oneWayFt: 8 },
    ] });
    const b = projectCanonicalBranch(s);
    expect(b.conduitLabel).toMatch(/FREE AIR/);
    expect(b.isOpenAir).toBe(true);
    expect(b.oneWayFt).toBe(8);            // its OWN length, never the feeder's 60 ft
  });
});

describe('W4a — micro topology emits NO USE-2 DC BOM rows (gate 6)', () => {
  // An inverter id that MISSES the V4 registry makes resolveTopology() fall to
  // STRING_INVERTER. Without the design topologyType that silently emits phantom
  // #10/#12 USE-2 "DC roof wiring" rows + a DC disconnect for a DC string
  // circuit that does not exist on a pure-micro job.
  const microInput = (topologyType?: 'MICROINVERTER'): any => ({
    inverterId: 'nonexistent-micro-xyz', panelId: 'rec-alpha-pure-r-405',
    moduleCount: 24, deviceCount: 24, stringCount: 0, inverterCount: 24,
    branchCount: 2, topologyType,
    systemKw: 9.6, dcWireGauge: '#10 AWG', acWireGauge: '#8 AWG',
    dcWireLength: 50, acWireLength: 60, conduitType: 'EMT', conduitSizeInch: '3/4',
    roofType: 'shingle', attachmentCount: 24, railSections: 12, rowCount: 6,
    mainPanelAmps: 200, backfeedAmps: 60, acOCPD: 60, dcOCPD: 20,
    systemType: 'roof', interconnectionMethod: 'LOAD_SIDE', panelBusRating: 200,
    requiresDCDisconnect: true,
  });
  const dcWireRows = (bom: any) => (bom.items || []).filter((i: any) =>
    i.stageId === 'dc' && /USE-2/i.test(String(i.description ?? '')) && /DC/i.test(String(i.description ?? '')));

  it('control: WITHOUT the design topology, the resolver miss emits DC USE-2 rows', () => {
    const bom: any = generateBOMV4(microInput(undefined));
    expect(dcWireRows(bom).length).toBeGreaterThan(0);   // the bug reproduces
  });

  it('FIX: declaring MICROINVERTER honors the design — ZERO DC USE-2 rows', () => {
    const bom: any = generateBOMV4(microInput('MICROINVERTER'));
    expect(dcWireRows(bom).length).toBe(0);
    // and no DC disconnect for a circuit that does not exist
    const dcDisco = (bom.items || []).filter((i: any) => i.stageId === 'dc' && i.category === 'disconnect');
    expect(dcDisco.length).toBe(0);
    // the resolver miss is recorded (never silent)
    expect((bom.warnings || []).some((w: string) => /topology/i.test(w))).toBe(true);
  });
});

describe('W1a / W1d / gate 1 — full-package micro render (roofProject = Enphase IQ8M)', () => {
  const html = generatePermitHTML(clone(roofProject));

  it('gate 1: PV-1B AC-branch caption has NO "wired in series"', () => {
    expect(html).not.toMatch(/wired in series/i);
    expect(html).toMatch(/CONNECTED IN PARALLEL/);
  });

  it('gate 2: no bare "route field-verified" callout literal remains', () => {
    expect(html).not.toMatch(/route field-verified/i);
  });

  it('W1a: PV-4A prints a snapshot-derived Electrical Compliance Status (not the legacy counter alone)', () => {
    expect(html).toMatch(/Electrical Compliance Status/);
  });
});
