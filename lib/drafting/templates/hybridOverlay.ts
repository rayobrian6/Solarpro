// ═══════════════════════════════════════════════════════════════
// Hybrid site-plan overlays — Phase 1 of multi-system support.
//
// Ray: "I am hoping the top down aerial view of the property gets
// all of the variety from roof to ground and fence."
//
// For a hybrid CADModel (cad.hybrid present) this projects the GROUND
// arrays and FENCE segments into the ROOF plan's fake-degree frame so
// the one top-down site plan shows every system on the property.
// Each grafted section's local XY is relative to ITS OWN origin
// (cad.hybrid.sections) — we invert to lat/lng with the section
// origin, then forward-project with the BASE (roof) origin.
//
// Pure geometry: no drawing here beyond shape lists; roof.ts renders.
// ═══════════════════════════════════════════════════════════════

import type { CADModel } from '@/lib/cad/types';
import { xyToLatLng } from '@/lib/cad/geometry';
import { latLngToFakeDeg } from './roofSiteContext';

interface FakePt { lat: number; lng: number }

export interface HybridGroundShape {
  ring: FakePt[];                 // outer array rectangle (closed)
  rowLines: Array<[FakePt, FakePt]>;
  labelPt: FakePt;
  label: string;                  // e.g. "GROUND MOUNT — 20 MOD"
}

export interface HybridFenceShape {
  line: [FakePt, FakePt];
  labelPt: FakePt;
  label: string;                  // e.g. "SOLAR FENCE — 20 MOD · 160 L.F."
}

export interface HybridOverlays {
  ground: HybridGroundShape[];
  fence: HybridFenceShape[];
  /** Every projected point — the fit window must INCLUDE these (they are
   *  subject matter, not context). */
  allPts: FakePt[];
}

export function buildHybridOverlays(
  cad: CADModel,
  baseOriginLat: number,
  baseOriginLng: number,
): HybridOverlays | null {
  if (!cad.hybrid) return null;
  // A sub-solver that synthesized geometry without real GPS reports origin
  // (0,0) — projecting local meters from the equator would land the overlay
  // millions of feet away and explode the fit window. Skip such sections.
  const secOrigin = (key: 'roof' | 'ground' | 'fence') => {
    const sec = cad.hybrid!.sections.find(s => s.key === key);
    if (!sec || !isFinite(sec.originLat) || !isFinite(sec.originLng)
      || (Math.abs(sec.originLat) < 0.01 && Math.abs(sec.originLng) < 0.01)) return undefined;
    return sec;
  };

  const toFake = (xM: number, yM: number, o: { originLat: number; originLng: number }): FakePt => {
    const ll = xyToLatLng(xM, yM, o.originLat, o.originLng);
    return latLngToFakeDeg(ll.lat, ll.lng, baseOriginLat, baseOriginLng);
  };

  const out: HybridOverlays = { ground: [], fence: [], allPts: [] };

  // ── Ground arrays: outer rect + row lines ─────────────────────────
  const gSec = secOrigin('ground');
  if (gSec && cad.ground?.arrays?.length) {
    for (const arr of cad.ground.arrays) {
      const w = arr.dimensions?.arrayWidthM || 1;
      const d = arr.dimensions?.arrayDepthM || 1;
      const x0 = arr.originX, y0 = arr.originY;
      const ring = [
        toFake(x0, y0, gSec), toFake(x0 + w, y0, gSec),
        toFake(x0 + w, y0 + d, gSec), toFake(x0, y0 + d, gSec),
        toFake(x0, y0, gSec),
      ];
      const rowLines: Array<[FakePt, FakePt]> = (arr.rows ?? []).map(r =>
        [toFake(r.x, r.y, gSec), toFake(r.x + r.widthM, r.y, gSec)] as [FakePt, FakePt]);
      const shape: HybridGroundShape = {
        ring, rowLines,
        labelPt: toFake(x0 + w / 2, y0 + d + 3, gSec),
        label: `GROUND MOUNT — ${arr.panels?.length || arr.dimensions?.rowCount * arr.dimensions?.panelsPerRow || 0} MOD`,
      };
      out.ground.push(shape);
      out.allPts.push(...ring);
    }
  }

  // ── Fence segments: heavy line + label ────────────────────────────
  const fSec = secOrigin('fence');
  if (fSec && cad.fence?.segments?.length) {
    for (const seg of cad.fence.segments) {
      const a = toFake(seg.startX, seg.startY, fSec);
      const b = toFake(seg.endX, seg.endY, fSec);
      const lengthFt = Math.round((seg.lengthM || 0) * 3.28084);
      out.fence.push({
        line: [a, b],
        labelPt: { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 },
        label: `SOLAR FENCE — ${seg.panelCount || 0} MOD · ${lengthFt}' L.F.`,
      });
      out.allPts.push(a, b);
    }
  }

  return (out.ground.length || out.fence.length) ? out : null;
}
