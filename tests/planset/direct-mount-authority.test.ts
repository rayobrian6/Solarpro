// ═══════════════════════════════════════════════════════════════════════════
// W4 §10 — DIRECT-MOUNT / RAIL-LESS COORDINATE AUTHORITY
// Rail-less products (systemType 'rail_less' in mounting-hardware-db) must carry
// canonical attachment objects + CS-SITE-PLAN-FT coordinates just like rail-
// based systems — derived at snapshot BUILD time from module geometry × the
// product attachment pattern, with EMPTY rail objects (no phantom rails). BOM
// mount/fastener quantities derive from the attachment objects; missing geometry
// blocks permit-ready.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { roofProject } from '../../test-fixtures/roofProject';
import { getMountingSystemById } from '@/lib/mounting-hardware-db';
import {
  buildStructuralAuthority, type StructuralAuthorityCtx,
} from '@/lib/permit/snapshot/structuralAuthority';
import { deriveStructuralBom, reconcileStructuralBom } from '@/lib/permit/snapshot/structuralBom';
import {
  applyAffine, canonicalPointsById, checkRenderParity, parsePlacementManifests,
} from '@/lib/permit/snapshot/coordinateAuthority';
import { validatePermitDesignSnapshot, blockingViolations } from '@/lib/permit/snapshot/validate';
import { CANONICAL_COORDINATE_SYSTEM_ID, type PermitDesignSnapshot, type PlacementManifest } from '@/lib/permit/snapshot/types';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

// Genuinely rail-less DIRECT-MOUNT product (Tesla Panel Mount — Comp Rafter Base
// lags directly into the rafter; NO rail). The NAME deliberately trips the
// legacy `isRailless` renderer flag so the test proves the procedural direct-
// mount placement is GONE and mounts project from the canonical snapshot.
function raillessSnapshot(): { snap: PermitDesignSnapshot; html: string } {
  const input = clone(roofProject) as any;
  input.project.mountingSystemId = 'tesla-panel-mount-comp-rafter';
  input.project.mountingSystem = 'Tesla Rail-Less Panel Mount';
  const html = generatePermitHTML(input);
  return { snap: input._snapshot as PermitDesignSnapshot, html };
}

describe('W4 §10 — direct-mount canonical attachment objects', () => {
  const { snap } = raillessSnapshot();
  const atts = snap.structural.attachments;
  const gi = snap.geometry.moduleInstances;

  it('the selected product is genuinely rail-less in mounting-hardware-db', () => {
    const sys = getMountingSystemById('tesla-panel-mount-comp-rafter');
    expect(sys?.systemType).toBe('rail_less');
    expect(sys?.rail).toBeUndefined();                 // no rail spec on a rail-less product
  });

  it('rail objects are EMPTY (no phantom rails) but attachment objects exist', () => {
    expect(snap.structural.rails).toEqual([]);
    expect(atts.length).toBeGreaterThan(0);
    expect(gi.length).toBeGreaterThan(0);
    // per-module mount points: Tesla maxSpacing 72" over a ~67-71" module → 2 per
    // long edge × 2 edges = 4 mounts/module.
    expect(atts.length).toBe(gi.length * 4);
  });

  it('every attachment carries a canonical CS-SITE-PLAN-FT coordinate + plane + fastener spec', () => {
    for (const a of atts) {
      expect(a.coord.coordinateSystemId).toBe(CANONICAL_COORDINATE_SYSTEM_ID);
      expect(a.coord.transformId).toBe('DT-SITE');
      expect(Number.isFinite(a.xy.x) && Number.isFinite(a.xy.y)).toBe(true);
      expect(a.roofPlaneId).toBeTruthy();
      expect(a.railId).toBe('');                        // honest: no rail
      expect(a.attachmentMethod).toBe('l_foot_lag');
      expect(a.fastenerCount).toBe(1);                  // Tesla Comp Rafter: 1 lag/mount
    }
  });

  it('every module references its supporting attachments (module→attachment relation carried)', () => {
    const supported = new Set(atts.map(a => (a as any).supportedModuleId));
    for (const m of gi) {
      expect(supported.has(m.instanceId)).toBe(true);
      const own = atts.filter(a => (a as any).supportedModuleId === m.instanceId);
      expect(own.length).toBe(4);
    }
  });

  it('the snapshot has NO structural blocking-invariant violations from the direct-mount objects', () => {
    const violations = validatePermitDesignSnapshot(snap);
    const structural = blockingViolations(violations).filter(v =>
      /^V(22|25|26|27|10)$/.test(v.invariant) && /structural|attachment|rail/i.test(v.authorityPath));
    expect(structural).toEqual([]);
  });
});

describe('W4 §10 — BOM + reconciliation derive from the attachment objects', () => {
  const { snap } = raillessSnapshot();
  const bom = snap.structural.bom;
  const atts = snap.structural.attachments;

  it('mount qty = attachment count; fastener qty = Σ fastenerCount; no rail/splice/clamp rows', () => {
    const row = (k: string) => bom.find(r => r.key === k);
    expect(row('mounts')?.qty).toBe(atts.length);
    expect(row('lagBolts')?.qty).toBe(atts.reduce((s, a) => s + (a.fastenerCount ?? 0), 0));
    expect(row('bondingClips')?.qty).toBe(snap.geometry.moduleInstances.length);
    // rail-based rows are OMITTED for a rail-less array
    expect(row('rails')).toBeUndefined();
    expect(row('railSplices')).toBeUndefined();
    expect(row('midClamps')).toBeUndefined();
    expect(row('endClamps')).toBeUndefined();
    expect(row('mountingBolts')).toBeUndefined();
    // every emitted row carries an auditable source
    for (const r of bom) expect(r.sourceObjectIds !== undefined || r.aggregation !== undefined).toBe(true);
  });

  it('reconciliation passes on the object-internal basis and does NOT fire rail/splice checks', () => {
    const recon = snap.structural.bomReconciliation;
    expect(recon.ok).toBe(true);
    expect(recon.basis).toBe('object-internal');
    const names = recon.checks.map(c => c.name);
    expect(names).toContain('mounts-vs-attachment-objects');
    expect(names).toContain('fasteners-vs-attachment-method');
    expect(names.some(n => /rails-vs|splices-vs|clamps-vs/.test(n))).toBe(false);
  });

  it('deriveStructuralBom returns [] when there are no attachments (honest empty)', () => {
    expect(deriveStructuralBom({ rails: [], attachments: [], moduleInstances: [], rackingAssembly: null })).toEqual([]);
    const recon = reconcileStructuralBom([], { rails: [], attachments: [], moduleInstances: [], rackingAssembly: null });
    expect(recon).toEqual({ ok: true, basis: 'no-structural-objects', checks: [] });
  });
});

describe('W4 §10 — render parity for direct-mount attachments (no rails)', () => {
  const { snap, html } = raillessSnapshot();

  it('the full planset renders without a parity (V29/V30/V31) throw', () => {
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(20_000);
    // canonical attachment feet are drawn with their data-object-id
    expect(html).toContain('data-object-id="att-dm-');
  });

  it('a manifest placed via viewport∘DT-SITE(canonical) has ZERO attachment parity violations', () => {
    const transform = snap.geometry.drawingTransforms.find(t => t.transformId === 'DT-SITE')!;
    const viewport = { a: 4, b: 0, c: 0, d: -4, e: 120, f: 500 };
    const canon = canonicalPointsById(snap);
    const attIds = [...canon].filter(([, c]) => c.kind === 'attachment').map(([id]) => id);
    expect(attIds.length).toBeGreaterThan(0);
    const manifest: PlacementManifest = {
      sheetId: 'PV-1', transformId: 'DT-SITE', viewport,
      entries: attIds.map(id => {
        const c = canon.get(id)!;
        return { objectId: id, kind: c.kind, canonicalXY: { x: c.x, y: c.y },
                 sheetXY: applyAffine(viewport, applyAffine(transform.matrix, { x: c.x, y: c.y })) };
      }),
    };
    const v = checkRenderParity(snap, manifest, { kinds: ['rail', 'attachment', 'splice'], requireCoverage: true });
    expect(v).toEqual([]);   // no-rails coverage handled; every attachment covered + on-transform
  });

  it('a perturbed direct-mount sheet coordinate fails RENDER-COORD-PARITY-EXCEEDED', () => {
    const transform = snap.geometry.drawingTransforms.find(t => t.transformId === 'DT-SITE')!;
    const viewport = { a: 4, b: 0, c: 0, d: -4, e: 120, f: 500 };
    const canon = canonicalPointsById(snap);
    const attIds = [...canon].filter(([, c]) => c.kind === 'attachment').map(([id]) => id).slice(0, 3);
    const entries = attIds.map(id => {
      const c = canon.get(id)!;
      return { objectId: id, kind: c.kind, canonicalXY: { x: c.x, y: c.y },
               sheetXY: applyAffine(viewport, applyAffine(transform.matrix, { x: c.x, y: c.y })) };
    });
    entries[0].sheetXY = { x: entries[0].sheetXY.x + 3, y: entries[0].sheetXY.y };   // renderer re-placed it
    const v = checkRenderParity(snap, { sheetId: 'PV-1', transformId: 'DT-SITE', viewport, entries },
      { kinds: ['attachment'] });
    expect(v.some(x => x.code === 'RENDER-COORD-PARITY-EXCEEDED')).toBe(true);
  });
});

describe('W4 §10 — missing direct-mount geometry blocks permit-ready', () => {
  // A rail-less roof system with NO structural engine run cannot resolve load-
  // bearing attachment geometry → honest DIRECT-MOUNT-GEOMETRY-MISSING blocker
  // (the old blanket rail-less gap is gone; this fires ONLY when truly missing).
  function ctx(): StructuralAuthorityCtx {
    const sys = getMountingSystemById('tesla-panel-mount-comp-rafter')!;
    const moduleRecord: any = {
      recordId: 'mod-1', catalogId: 'tesla-panel', manufacturer: 'Tesla', model: 'S', sku: null,
      datasheet: { revision: null, sourceUrl: null, capturedAtIso: null, assetId: null },
      verified: true,
      spec: { wattsStc: 430, voc: 41.7, isc: 13.8, vmp: null, imp: null, tempCoeffVocPctC: null,
              lengthIn: 70.9, widthIn: 41.7, thicknessIn: 1.4, weightLbs: 44, ulListing: null },
      provenance: { source: 'test' },
    };
    const geoModules = Array.from({ length: 6 }, (_, i) => ({
      moduleId: `m-${i + 1}`, planeKey: 'plane-1', row: Math.floor(i / 3), col: i % 3,
      orientation: 'portrait', lat: 33.4484 + i * 1e-5, lng: -112.074 + i * 1e-5,
    }));
    return {
      isRoofSystem: true, moduleRecord, geoModules, microUnits: [],
      roofPlanes: [{ planeId: 'plane-1', pitchDeg: 22, azimuthDeg: 180, moduleCount: 6 }],
      cadPlanes: [], mountSystem: sys,
      structuralRuns: null,                              // ← no engine result → geometry unresolved
      framing: { framingType: null, rafterSize: null, rafterSpacing: null, rafterSpecies: null, rafterSpan: null },
      windValuePresent: false, snowValuePresent: false,
      windSpeedMph: null, exposure: null, snowPsf: null, riskCategory: null, meanRoofHeightFt: null,
      asceEdition: 'ASCE 7-22', asceSource: 'default', ahjRidgeSetbackIn: null, roofCovering: null, fenceWind: null,
    };
  }

  it('builds module instances but no attachments, and fires DIRECT-MOUNT-GEOMETRY-MISSING', () => {
    const b = buildStructuralAuthority(ctx());
    expect(b.moduleInstances.length).toBe(6);
    expect(b.attachments).toEqual([]);
    expect(b.rails).toEqual([]);
    expect(b.blockers.map(x => x.code)).toContain('DIRECT-MOUNT-GEOMETRY-MISSING');
    expect(b.blockers.map(x => x.code)).not.toContain('REACTIONS-UNTRACEABLE');
  });
});
