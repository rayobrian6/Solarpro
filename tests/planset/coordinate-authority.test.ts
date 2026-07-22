import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { roofProject } from '../../test-fixtures/roofProject';
import { validatePermitDesignSnapshot, blockingViolations } from '@/lib/permit/snapshot/validate';
import {
  IDENTITY_AFFINE, applyAffine, composeAffine, planRotationAffine, invertAffine, fitAffine,
  transformDigestOf, buildDrawingTransform, coordMetaFor,
  canonicalPointsById, checkRenderParity, scanRenderedObjectIds, checkRenderedIdCoverage,
  parsePlacementManifests,
} from '@/lib/permit/snapshot/coordinateAuthority';
import { CANONICAL_COORDINATE_SYSTEM_ID, type PermitDesignSnapshot, type PlacementManifest } from '@/lib/permit/snapshot/types';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
function realSnapshot(mutate?: (p: any) => void): { snap: PermitDesignSnapshot; html: string } {
  const input = clone(roofProject) as any;
  if (mutate) mutate(input);
  const html = generatePermitHTML(input);
  return { snap: input._snapshot as PermitDesignSnapshot, html };
}

// ── transform math ───────────────────────────────────────────────────────────
describe('W3.1 §2 — affine transform math', () => {
  it('identity leaves points unchanged', () => {
    expect(applyAffine(IDENTITY_AFFINE, { x: 3.5, y: -2 })).toEqual({ x: 3.5, y: -2 });
  });

  it('plan-rotation rotates 90° about the origin', () => {
    const m = planRotationAffine(90, { x: 0, y: 0 });
    const p = applyAffine(m, { x: 1, y: 0 });
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(1, 6);
  });

  it('plan-rotation about a pivot fixes the pivot point', () => {
    const pivot = { x: 5, y: 7 };
    const m = planRotationAffine(37, pivot);
    const p = applyAffine(m, pivot);
    // matrix coefficients are stored at 6-dp (r6) → ~1e-5 residual at the pivot.
    expect(p.x).toBeCloseTo(pivot.x, 4);
    expect(p.y).toBeCloseTo(pivot.y, 4);
  });

  it('composeAffine(outer, inner) == outer(inner(p))', () => {
    const inner = planRotationAffine(20, { x: 1, y: 2 });
    const outer = { a: 2, b: 0, c: 0, d: 2, e: 10, f: -4 }; // scale 2 + translate
    const composed = composeAffine(outer, inner);
    const p = { x: 3, y: -1 };
    const direct = applyAffine(outer, applyAffine(inner, p));
    const viaComposed = applyAffine(composed, p);
    expect(viaComposed.x).toBeCloseTo(direct.x, 6);
    expect(viaComposed.y).toBeCloseTo(direct.y, 6);
  });
});

// ── transform digest ─────────────────────────────────────────────────────────
describe('W3.1 §2 — transform digest', () => {
  it('is deterministic and changes when a parameter changes', () => {
    const t0 = buildDrawingTransform({ transformId: 'DT-X', scope: 'site', kind: 'plan-rotation', rotationDeg: 12, pivot: { x: 1, y: 1 } });
    const t0b = buildDrawingTransform({ transformId: 'DT-X', scope: 'site', kind: 'plan-rotation', rotationDeg: 12, pivot: { x: 1, y: 1 } });
    const t1 = buildDrawingTransform({ transformId: 'DT-X', scope: 'site', kind: 'plan-rotation', rotationDeg: 13, pivot: { x: 1, y: 1 } });
    expect(t0.transformDigest).toBe(t0b.transformDigest);
    expect(t1.transformDigest).not.toBe(t0.transformDigest);
    // revision is bound to the digest (approval-invalidation basis)
    expect(t0.revision).toBe(t0.transformDigest);
    expect(transformDigestOf(t0.matrix, t0.params)).toBe(t0.transformDigest);
  });

  it('identity transform is well-formed and canonical-sourced', () => {
    const t = buildDrawingTransform({ transformId: 'DT-SITE', scope: 'site', kind: 'identity' });
    expect(t.matrix).toEqual(IDENTITY_AFFINE);
    expect(t.fromCoordinateSystemId).toBe(CANONICAL_COORDINATE_SYSTEM_ID);
    expect(coordMetaFor(t, 'plan-ft').coordinateSystemId).toBe(CANONICAL_COORDINATE_SYSTEM_ID);
    expect(coordMetaFor(t, 'plan-ft').transformRevision).toBe(t.revision);
  });
});

// ── render-parity checker (synthetic manifests over the real snapshot) ────────
describe('W3.1 §2 — render-parity checker', () => {
  const { snap } = realSnapshot();
  const transform = snap.geometry.drawingTransforms.find(t => t.transformId === 'DT-SITE')!;
  const viewport = { a: 3, b: 0, c: 0, d: -3, e: 100, f: 400 }; // arbitrary viewport scale/flip/paper
  const canon = canonicalPointsById(snap);
  const moduleIds = [...canon].filter(([, c]) => c.kind === 'module').map(([id]) => id);

  function manifestFor(ids: string[]): PlacementManifest {
    return {
      sheetId: 'PV-1', transformId: 'DT-SITE', viewport,
      entries: ids.map(id => {
        const c = canon.get(id)!;
        const sheet = applyAffine(viewport, applyAffine(transform.matrix, { x: c.x, y: c.y }));
        return { objectId: id, kind: c.kind, canonicalXY: { x: c.x, y: c.y }, sheetXY: sheet };
      }),
    };
  }

  it('a manifest placed via viewport∘transform(canonical) has ZERO parity violations', () => {
    expect(moduleIds.length).toBeGreaterThan(0);
    const v = checkRenderParity(snap, manifestFor(moduleIds), { kinds: ['module'], requireCoverage: true });
    expect(v).toEqual([]);
  });

  it('an invented object id fails (d) — RENDERED-OBJECT-NO-CANONICAL-ID', () => {
    const m = manifestFor(moduleIds.slice(0, 2));
    m.entries.push({ objectId: 'mi-GHOST', kind: 'module', canonicalXY: { x: 0, y: 0 }, sheetXY: { x: 0, y: 0 } });
    const v = checkRenderParity(snap, m, { kinds: ['module'] });
    expect(v.some(x => x.code === 'RENDERED-OBJECT-NO-CANONICAL-ID' && x.objectId === 'mi-GHOST')).toBe(true);
  });

  it('a re-derived coordinate fails — RENDERER-REDERIVED-COORDINATE', () => {
    const m = manifestFor(moduleIds.slice(0, 1));
    m.entries[0].canonicalXY = { x: m.entries[0].canonicalXY.x + 5, y: m.entries[0].canonicalXY.y }; // renderer invented a position
    const v = checkRenderParity(snap, m, { kinds: ['module'] });
    expect(v.some(x => x.code === 'RENDERER-REDERIVED-COORDINATE')).toBe(true);
  });

  it('a sheet coordinate off the transform fails — RENDER-COORD-PARITY-EXCEEDED', () => {
    const m = manifestFor(moduleIds.slice(0, 1));
    m.entries[0].sheetXY = { x: m.entries[0].sheetXY.x + 3, y: m.entries[0].sheetXY.y }; // drawn ≠ transform(canonical)
    const v = checkRenderParity(snap, m, { kinds: ['module'], tolSheet: 0.5 });
    expect(v.some(x => x.code === 'RENDER-COORD-PARITY-EXCEEDED')).toBe(true);
  });

  it('an omitted canonical object fails (e) — CANONICAL-OBJECT-OMITTED (coverage)', () => {
    const v = checkRenderParity(snap, manifestFor(moduleIds.slice(0, moduleIds.length - 1)), { kinds: ['module'], requireCoverage: true });
    expect(v.some(x => x.code === 'CANONICAL-OBJECT-OMITTED')).toBe(true);
  });

  it('an unresolved transformId fails — TRANSFORM-UNRESOLVED', () => {
    const m = manifestFor(moduleIds.slice(0, 1));
    m.transformId = 'DT-NOPE';
    const v = checkRenderParity(snap, m, { kinds: ['module'] });
    expect(v).toEqual([{ code: 'TRANSFORM-UNRESOLVED', detail: expect.any(String) }]);
  });

  it('tolerance: a sub-tolerance sheet delta is accepted', () => {
    const m = manifestFor(moduleIds.slice(0, 1));
    m.entries[0].sheetXY = { x: m.entries[0].sheetXY.x + 0.2, y: m.entries[0].sheetXY.y }; // < 0.5 tol
    expect(checkRenderParity(snap, m, { kinds: ['module'], tolSheet: 0.5 })).toEqual([]);
  });
});

// ── unified canonical frame on the REAL snapshot ─────────────────────────────
describe('W3.1 §2 — unified coordinate frame on the real snapshot', () => {
  const { snap, html } = realSnapshot();

  it('declares the canonical coordinate system + carries drawing transforms', () => {
    expect(snap.geometry.coordinateSystem.id).toBe(CANONICAL_COORDINATE_SYSTEM_ID);
    expect(snap.geometry.drawingTransforms.length).toBeGreaterThan(0);
    expect(snap.geometry.drawingTransforms.some(t => t.transformId === 'DT-SITE')).toBe(true);
    for (const t of snap.geometry.drawingTransforms) {
      expect(t.transformDigest).toBe(transformDigestOf(t.matrix, t.params));
      expect(t.fromCoordinateSystemId).toBe(CANONICAL_COORDINATE_SYSTEM_ID);
    }
  });

  it('EVERY physical object shares the ONE canonical frame (no module-vs-rail split)', () => {
    const objs = [
      ...snap.geometry.moduleInstances.map(m => m.coord),
      ...snap.geometry.roofPlaneObjects.map(p => p.coord),
      ...snap.structural.rails.map(r => r.coord),
      ...snap.structural.attachments.map(a => a.coord),
    ];
    expect(objs.length).toBeGreaterThan(0);
    const ids = new Set(snap.geometry.drawingTransforms.map(t => t.transformId));
    for (const c of objs) {
      expect(c.coordinateSystemId).toBe(CANONICAL_COORDINATE_SYSTEM_ID);
      expect(c.units).toBe('ft');
      expect(ids.has(c.transformId)).toBe(true); // resolvable transform reference
    }
  });

  it('rails + attachments live in the SAME plan-ft frame as the modules (co-located, not an abstract grid)', () => {
    const mods = snap.geometry.moduleInstances;
    if (!mods.length || !snap.structural.attachments.length) return;
    const xs = mods.flatMap(m => m.polygon.points.map(p => p.x));
    const ys = mods.flatMap(m => m.polygon.points.map(p => p.y));
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const padX = (maxX - minX) * 0.75 + 5, padY = (maxY - minY) * 0.75 + 5;
    for (const a of snap.structural.attachments) {
      expect(a.xy.x).toBeGreaterThanOrEqual(minX - padX);
      expect(a.xy.x).toBeLessThanOrEqual(maxX + padX);
      expect(a.xy.y).toBeGreaterThanOrEqual(minY - padY);
      expect(a.xy.y).toBeLessThanOrEqual(maxY + padY);
      expect(a.coord.sourceFrame).toBe(mods[0].coord.sourceFrame);
    }
  });

  it('V21 basis: area invariant uses the RAW polygon; drawnPolygon is display-only', () => {
    const shoelace = (pts: { x: number; y: number }[]) => {
      let s = 0; for (let i = 0; i < pts.length; i++) { const j = (i + 1) % pts.length; s += pts[i].x * pts[j].y - pts[j].x * pts[i].y; } return Math.abs(s / 2);
    };
    for (const mi of snap.geometry.moduleInstances) {
      // raw polygon area == exact catalog footprint (feeds V21)
      expect(shoelace(mi.polygon.points)).toBeCloseTo(mi.areaFt2, 2);
      // drawnPolygon exists, same centroid as raw (position unchanged — no panel moved)
      const cen = (p: { points: { x: number; y: number }[] }) => ({ x: p.points.reduce((s, q) => s + q.x, 0) / 4, y: p.points.reduce((s, q) => s + q.y, 0) / 4 });
      const rc = cen(mi.polygon), dc = cen(mi.drawnPolygon);
      expect(dc.x).toBeCloseTo(rc.x, 2);
      expect(dc.y).toBeCloseTo(rc.y, 2);
    }
  });

  it('the real snapshot passes the coordinate-authority validators (V26–V28)', () => {
    const codes = blockingViolations(validatePermitDesignSnapshot(snap)).map(x => x.invariant);
    expect(codes).not.toContain('V26');
    expect(codes).not.toContain('V27');
    expect(codes).not.toContain('V28');
  });

  it('V28 catches a tampered transform digest', () => {
    const tampered = clone(snap);
    tampered.geometry.drawingTransforms[0].params.rotationDeg = 42; // mutate params without redigest
    const v = validatePermitDesignSnapshot(tampered).filter(x => x.invariant === 'V28');
    expect(v.length).toBeGreaterThan(0);
  });

  it('V26 catches a coordinate-frame split', () => {
    const tampered = clone(snap);
    if (tampered.structural.attachments.length) {
      tampered.structural.attachments[0].coord.coordinateSystemId = 'CS-ABSTRACT-V4-GRID';
      const v = validatePermitDesignSnapshot(tampered).filter(x => x.invariant === 'V26');
      expect(v.length).toBeGreaterThan(0);
    }
  });

  it('live render tags modules + structural objects with canonical data-object-ids (V29 coverage)', () => {
    const ids = scanRenderedObjectIds(html);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.some(id => /^mi-/.test(id))).toBe(true);       // modules tagged
    // every rendered id (modules, rails, attachments, splices) resolves to a canonical object
    expect(checkRenderedIdCoverage(snap, ids).ok).toBe(true);
  });
});

// ── invert/fit math + LIVE placement-manifest parity (the enforced seam) ──────
describe('W3.1 §2 — affine invert + least-squares fit', () => {
  it('invertAffine ∘ affine == identity', () => {
    const m = planRotationAffine(31, { x: 4, y: -3 });
    const p = { x: 7, y: 2 };
    const back = applyAffine(invertAffine(m), applyAffine(m, p));
    expect(back.x).toBeCloseTo(p.x, 4);
    expect(back.y).toBeCloseTo(p.y, 4);
  });

  it('fitAffine recovers a known affine from ≥3 correspondences', () => {
    const truth = { a: 2, b: 0.5, c: -0.3, d: 1.7, e: 12, f: -8 };
    const src = [{ x: 0, y: 0 }, { x: 3, y: 1 }, { x: -2, y: 4 }, { x: 5, y: -1 }];
    const dst = src.map(p => applyAffine(truth, p));
    const fit = fitAffine(src, dst)!;
    (['a', 'b', 'c', 'd', 'e', 'f'] as const).forEach(k => expect(fit[k]).toBeCloseTo(truth[k], 4));
  });

  it('fitAffine returns null when under-determined', () => {
    expect(fitAffine([{ x: 0, y: 0 }, { x: 1, y: 1 }], [{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBeNull();
  });
});

describe('W3.1 §2 — LIVE placement-manifest parity on the rendered planset', () => {
  const { snap, html } = realSnapshot();
  const manifests = parsePlacementManifests(html);

  it('the rendered planset emits a manifest covering modules + rails + feet + splices', () => {
    expect(manifests.length).toBeGreaterThan(0);
    const m = manifests[0];
    expect(m.transformId).toBe('DT-SITE');
    const kinds = new Set(m.entries.map(e => e.kind));
    expect(kinds.has('module')).toBe(true);       // module outlines are projected too
    expect(kinds.has('attachment')).toBe(true);
    expect(kinds.has('rail')).toBe(true);
    // module outlines render as PROJECTED polygons carrying the canonical id
    expect(/<polygon data-object-id="mi-[^"]+"/.test(html)).toBe(true);
  });

  it('every drawn structural object == transform(canonical) within tolerance (V31) + no omission (V30)', () => {
    for (const m of manifests) {
      const v = checkRenderParity(snap, m, { kinds: ['rail', 'attachment', 'splice'], requireCoverage: true, tolSheet: 0.5 });
      expect(v, JSON.stringify(v.slice(0, 3))).toEqual([]);
    }
  });

  it('every drawn MODULE polygon == transform(canonical drawnPolygon) within tolerance (V31)', () => {
    for (const m of manifests) {
      const v = checkRenderParity(snap, m, { kinds: ['module'], tolSheet: 0.5 });
      expect(v, JSON.stringify(v.slice(0, 3))).toEqual([]);
    }
  });

  it('perturbing a drawn MODULE on the LIVE manifest trips V31', () => {
    const m = clone(manifests[0]);
    const mod = m.entries.find(e => e.kind === 'module')!;
    mod.sheetXY = { x: mod.sheetXY.x + 4, y: mod.sheetXY.y };
    const v = checkRenderParity(snap, m, { kinds: ['module'], tolSheet: 0.5 });
    expect(v.some(x => x.code === 'RENDER-COORD-PARITY-EXCEEDED' && x.objectId === mod.objectId)).toBe(true);
  });

  it('perturbing a drawn foot on the LIVE manifest trips V31 (blocking parity)', () => {
    const m = clone(manifests[0]);
    const foot = m.entries.find(e => e.kind === 'attachment')!;
    foot.sheetXY = { x: foot.sheetXY.x + 4, y: foot.sheetXY.y };   // renderer drew off the transform
    const v = checkRenderParity(snap, m, { kinds: ['rail', 'attachment', 'splice'], tolSheet: 0.5 });
    expect(v.some(x => x.code === 'RENDER-COORD-PARITY-EXCEEDED' && x.objectId === foot.objectId)).toBe(true);
  });

  it('dropping a drawn object from the LIVE manifest trips V30 (no-omission)', () => {
    const m = clone(manifests[0]);
    const dropped = m.entries.find(e => e.kind === 'attachment')!.objectId;
    m.entries = m.entries.filter(e => e.objectId !== dropped);
    const v = checkRenderParity(snap, m, { kinds: ['rail', 'attachment', 'splice'], requireCoverage: true, tolSheet: 0.5 });
    expect(v.some(x => x.code === 'CANONICAL-OBJECT-OMITTED' && x.objectId === dropped)).toBe(true);
  });
});
