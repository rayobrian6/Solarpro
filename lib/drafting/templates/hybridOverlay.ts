// ═══════════════════════════════════════════════════════════════
// Hybrid site-plan overlays — Phase 1 of multi-system support.
//
// Ray: "I am hoping the top down aerial view of the property gets
// all of the variety from roof to ground and fence."
//
// For a hybrid CADModel (cad.hybrid present) this draws the GROUND
// arrays and FENCE runs into the ROOF plan's fake-degree frame so the
// one top-down site plan shows every system on the property.
//
// REGISTRATION RULE (Stowell repair, 2026-07-11): overlays are built
// from the REAL designed panel positions carried on
// cad.hybrid.sections[].panels — never from a solver's synthesized
// local geometry. The synthetic path drew a 6-wide grid box at a
// corner-anchored origin, which put the ground array somewhere Ray
// never placed it. The solver-geometry projection survives only as a
// fallback for models built before sections carried panels.
//
// Pure geometry: no drawing here beyond shape lists; roof.ts renders.
// ═══════════════════════════════════════════════════════════════

import type { CADModel } from '@/lib/cad/types';
import { xyToLatLng } from '@/lib/cad/geometry';
import { latLngToFakeDeg, rotateFakePt } from './roofSiteContext';

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

type SectionPanel = { lat: number; lng: number; azimuth?: number; row?: number; arrayId?: string };

const M_PER_DEG_LAT = 111_320;

/** Equirectangular local meters around a reference lat/lng. */
function toLocalM(p: { lat: number; lng: number }, refLat: number, refLng: number) {
  const cosLat = Math.cos(refLat * Math.PI / 180);
  return { x: (p.lng - refLng) * M_PER_DEG_LAT * cosLat, y: (p.lat - refLat) * M_PER_DEG_LAT };
}
function fromLocalM(x: number, y: number, refLat: number, refLng: number) {
  const cosLat = Math.cos(refLat * Math.PI / 180);
  return { lat: refLat + y / M_PER_DEG_LAT, lng: refLng + x / (M_PER_DEG_LAT * cosLat) };
}

/** Principal-axis angle (radians) of a point cloud via covariance. */
function principalAngle(pts: Array<{ x: number; y: number }>): number {
  if (pts.length < 2) return 0;
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of pts) {
    const dx = p.x - mx, dy = p.y - my;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  return 0.5 * Math.atan2(2 * sxy, sxx - syy);
}

/** Oriented bounding ring (closed, 5 pts) around panel CENTERS, inflated by
 *  half-module margins so the ring hugs the real array footprint. */
function orientedRing(
  local: Array<{ x: number; y: number }>,
  refLat: number, refLng: number,
  inflateAlongM: number, inflateAcrossM: number,
  baseOriginLat: number, baseOriginLng: number,
): { ring: FakePt[]; topMid: FakePt } {
  const th = principalAngle(local);
  const cos = Math.cos(-th), sin = Math.sin(-th);
  const rot = local.map(p => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }));
  const minX = Math.min(...rot.map(p => p.x)) - inflateAlongM;
  const maxX = Math.max(...rot.map(p => p.x)) + inflateAlongM;
  const minY = Math.min(...rot.map(p => p.y)) - inflateAcrossM;
  const maxY = Math.max(...rot.map(p => p.y)) + inflateAcrossM;
  const corners = [
    { x: minX, y: minY }, { x: maxX, y: minY },
    { x: maxX, y: maxY }, { x: minX, y: maxY },
    { x: minX, y: minY },
  ];
  const cosB = Math.cos(th), sinB = Math.sin(th);
  const toFakePt = (p: { x: number; y: number }): FakePt => {
    const world = { x: p.x * cosB - p.y * sinB, y: p.x * sinB + p.y * cosB };
    const ll = fromLocalM(world.x, world.y, refLat, refLng);
    return latLngToFakeDeg(ll.lat, ll.lng, baseOriginLat, baseOriginLng);
  };
  // Label anchor: midpoint of the top (max-Y) edge, nudged 2 m out.
  const topMid = toFakePt({ x: (minX + maxX) / 2, y: maxY + 2 });
  return { ring: corners.map(toFakePt), topMid };
}

export function buildHybridOverlays(
  cad: CADModel,
  baseOriginLat: number,
  baseOriginLng: number,
): HybridOverlays | null {
  if (!cad.hybrid) return null;

  const out: HybridOverlays = { ground: [], fence: [], allPts: [] };

  // Half-module margins from the model's module dims (fallback: typical 60-cell).
  const modW = cad.panelWidthM  > 0.2 ? cad.panelWidthM  : 1.134;
  const modH = cad.panelHeightM > 0.2 ? cad.panelHeightM : 1.722;
  const halfLong = Math.max(modW, modH) / 2;
  const halfShort = Math.min(modW, modH) / 2;

  const section = (key: 'ground' | 'fence') =>
    cad.hybrid!.sections.find(s => s.key === key);

  // ── GROUND — real designed positions ─────────────────────────────
  const gSec = section('ground');
  const gPanels = (gSec?.panels ?? []) as SectionPanel[];
  if (gPanels.length > 0) {
    const refLat = gPanels.reduce((s, p) => s + p.lat, 0) / gPanels.length;
    const refLng = gPanels.reduce((s, p) => s + p.lng, 0) / gPanels.length;
    // One ring per designed row/array group — each ring sits exactly on its row.
    const groups = new Map<string, SectionPanel[]>();
    for (const p of gPanels) {
      const k = p.arrayId ?? 'ground';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(p);
    }
    // The client payload often drops the per-row layoutId (arrayId undefined →
    // one blob group). Recover the designed rows geometrically: within each
    // group, cluster on the minor-axis projection — a gap wider than a module
    // separates rows. Two thin slats ON the real rows beats one fat box.
    const rowSplit = (grp: SectionPanel[]): SectionPanel[][] => {
      if (grp.length < 4) return [grp];
      const loc = grp.map(p => toLocalM(p, refLat, refLng));
      const th = principalAngle(loc);
      const minor = grp.map((p, i) => ({
        p, t: -loc[i].x * Math.sin(th) + loc[i].y * Math.cos(th),
      })).sort((a, b) => a.t - b.t);
      const rows: SectionPanel[][] = [[minor[0].p]];
      for (let i = 1; i < minor.length; i++) {
        if (minor[i].t - minor[i - 1].t > Math.max(modH * 0.75, 0.6)) rows.push([]);
        rows[rows.length - 1].push(minor[i].p);
      }
      return rows;
    };
    const rowGroups = [...groups.values()].flatMap(rowSplit);
    groups.clear();
    rowGroups.forEach((g, i) => groups.set(`row-${i}`, g));
    let labelPt: FakePt | null = null;
    const rowLines: Array<[FakePt, FakePt]> = [];
    const rings: FakePt[][] = [];
    for (const grp of groups.values()) {
      const local = grp.map(p => toLocalM(p, refLat, refLng));
      const { ring, topMid } = orientedRing(
        local, refLat, refLng, halfLong, halfShort, baseOriginLat, baseOriginLng);
      rings.push(ring);
      // Northernmost group's top edge anchors the section label.
      if (!labelPt || topMid.lat > labelPt.lat) labelPt = topMid;
      out.allPts.push(...ring);
    }
    const [first, ...rest] = rings;
    out.ground.push({
      ring: first, rowLines,
      labelPt: labelPt!,
      label: `GROUND MOUNT — ${gPanels.length} MOD`,
    });
    for (const r of rest) out.ground.push({ ring: r, rowLines: [], labelPt: r[0], label: '' });
  } else if (gSec && cad.ground?.arrays?.length) {
    // Legacy fallback: project the solver's local geometry via the section origin.
    legacyGround(cad, gSec, baseOriginLat, baseOriginLng, out);
  }

  // ── FENCE — real designed positions ──────────────────────────────
  const fSec = section('fence');
  const fPanels = (fSec?.panels ?? []) as SectionPanel[];
  if (fPanels.length > 0) {
    const refLat = fPanels.reduce((s, p) => s + p.lat, 0) / fPanels.length;
    const refLng = fPanels.reduce((s, p) => s + p.lng, 0) / fPanels.length;
    const local = fPanels.map(p => toLocalM(p, refLat, refLng));
    const th = principalAngle(local);
    const ux = Math.cos(th), uy = Math.sin(th);
    // Project centers onto the fence axis; endpoints = extremes + half module.
    const ts = local.map(p => p.x * ux + p.y * uy);
    const tMin = Math.min(...ts) - halfShort, tMax = Math.max(...ts) + halfShort;
    const mkPt = (t: number): FakePt => {
      const ll = fromLocalM(t * ux, t * uy, refLat, refLng);
      return latLngToFakeDeg(ll.lat, ll.lng, baseOriginLat, baseOriginLng);
    };
    const a = mkPt(tMin), b = mkPt(tMax);
    const lengthFt = Math.round((tMax - tMin) * 3.28084);
    out.fence.push({
      line: [a, b],
      labelPt: { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 },
      label: `SOLAR FENCE — ${fPanels.length} MOD · ${lengthFt}' L.F.`,
    });
    out.allPts.push(a, b);
  } else if (fSec && cad.fence?.segments?.length) {
    legacyFence(cad, fSec, baseOriginLat, baseOriginLng, out);
  }

  return (out.ground.length || out.fence.length) ? out : null;
}

/** Rotate the hybrid overlays through the SAME global plan rotation the roof
 *  plan applies to every other layer (see roofSiteContext.computePlanTiltDeg).
 *  Pure — fresh points throughout (allPts alias ring points in the builder). */
export function rotateHybridOverlays(
  h: HybridOverlays,
  angleDeg: number,
  pivot: FakePt,
): HybridOverlays {
  if (angleDeg === 0) return h;
  const r = (p: FakePt) => rotateFakePt(p, angleDeg, pivot);
  return {
    ground: h.ground.map(g => ({
      ...g,
      ring: g.ring.map(r),
      rowLines: g.rowLines.map(([a, b]) => [r(a), r(b)] as [FakePt, FakePt]),
      labelPt: r(g.labelPt),
    })),
    fence: h.fence.map(f => ({
      ...f,
      line: [r(f.line[0]), r(f.line[1])] as [FakePt, FakePt],
      labelPt: r(f.labelPt),
    })),
    allPts: h.allPts.map(r),
  };
}

// ── Legacy solver-geometry projections (pre-panels sections only) ──────────

type Sec = NonNullable<CADModel['hybrid']>['sections'][number];

function usableOrigin(sec: Sec): boolean {
  return isFinite(sec.originLat) && isFinite(sec.originLng)
    && !(Math.abs(sec.originLat) < 0.01 && Math.abs(sec.originLng) < 0.01);
}

function legacyGround(cad: CADModel, sec: Sec, baseLat: number, baseLng: number, out: HybridOverlays): void {
  if (!usableOrigin(sec)) return;
  const toFake = (xM: number, yM: number): FakePt => {
    const ll = xyToLatLng(xM, yM, sec.originLat, sec.originLng);
    return latLngToFakeDeg(ll.lat, ll.lng, baseLat, baseLng);
  };
  for (const arr of cad.ground!.arrays) {
    const w = arr.dimensions?.arrayWidthM || 1;
    const d = arr.dimensions?.arrayDepthM || 1;
    const x0 = arr.originX, y0 = arr.originY;
    const ring = [
      toFake(x0, y0), toFake(x0 + w, y0),
      toFake(x0 + w, y0 + d), toFake(x0, y0 + d),
      toFake(x0, y0),
    ];
    const rowLines: Array<[FakePt, FakePt]> = (arr.rows ?? []).map(r =>
      [toFake(r.x, r.y), toFake(r.x + r.widthM, r.y)] as [FakePt, FakePt]);
    out.ground.push({
      ring, rowLines,
      labelPt: toFake(x0 + w / 2, y0 + d + 3),
      label: `GROUND MOUNT — ${arr.panels?.length || 0} MOD`,
    });
    out.allPts.push(...ring);
  }
}

function legacyFence(cad: CADModel, sec: Sec, baseLat: number, baseLng: number, out: HybridOverlays): void {
  if (!usableOrigin(sec)) return;
  const toFake = (xM: number, yM: number): FakePt => {
    const ll = xyToLatLng(xM, yM, sec.originLat, sec.originLng);
    return latLngToFakeDeg(ll.lat, ll.lng, baseLat, baseLng);
  };
  for (const seg of cad.fence!.segments) {
    const a = toFake(seg.startX, seg.startY);
    const b = toFake(seg.endX, seg.endY);
    const lengthFt = Math.round((seg.lengthM || 0) * 3.28084);
    out.fence.push({
      line: [a, b],
      labelPt: { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 },
      label: `SOLAR FENCE — ${seg.panelCount || 0} MOD · ${lengthFt}' L.F.`,
    });
    out.allPts.push(a, b);
  }
}
