// ═══════════════════════════════════════════════════════════════
// De-skew the array to TRUE lines (Ray 2026-07-06: "the arrays are
// slightly askewed and not recognizing lines of trueness").
//
// Hand-traced roof planes carry a few degrees of azimuth noise. On Melvin the
// four planes read 3.2° / 180.1° / 273.2° / 89.4° instead of clean 0/180/270/90,
// and — worse — the noise isn't uniform: the WEST plane's panel grid sits 3.1°
// off true while the other three are under 0.8°. So one cluster looks visibly
// crooked while the rest look fine.
//
// This squares the whole array to true, ONCE, at the source (so PV-1, PV-2, the
// string plan, everything draws it identically):
//   1. AZIMUTH — snap each plane's + panel's azimuth to the building's cardinal
//      grid, so every module RECTANGLE draws true (0/90/180/270 for a square
//      building).
//   2. POSITION — measure each plane's own grid tilt from its row/col structure
//      and rotate that plane's panels about their centroid to remove it, so the
//      rows/columns land on true horizontal/vertical LINES.
//
// It de-skews only — same panels, same count, same arrangement, same symmetry;
// a plane already square barely moves. A genuinely rotated building (all planes
// consistently off cardinal) is preserved, not force-snapped. Deterministic,
// mutates in place, never throws.
// ═══════════════════════════════════════════════════════════════

import { computeModuleAzimuthGrid, snapModuleAzimuth } from './moduleAzimuthGrid';
import { classifyPanel } from './subSystems';

const DEG = Math.PI / 180;

interface DPanel { lat: number; lng: number; azimuth?: number; row?: number; col?: number; planeId?: string; systemType?: string; placementType?: string; [k: string]: unknown; }
interface DPlane { id?: string; azimuth?: number; [k: string]: unknown; }

/** Fold an angle (deg) to the signed distance from its nearest multiple of 90. */
function foldTo90(a: number): number {
  return ((a % 90) + 135) % 90 - 45;
}

/**
 * Grid tilt (deg, signed, in [-45,45)) of a plane's panels from the cardinal
 * grid — averaged from the column-adjacent and row-adjacent panel vectors.
 * Returns 0 when there aren't enough adjacent pairs to measure.
 */
function planeGridTilt(panels: DPanel[], cosLat: number): number {
  let cx = 0, cy = 0, cn = 0, rx = 0, ry = 0, rn = 0;
  for (const a of panels) {
    for (const b of panels) {
      if (a === b || a.row == null || a.col == null || b.row == null || b.col == null) continue;
      if (a.row === b.row && b.col - a.col === 1) { cx += (b.lng - a.lng) * cosLat; cy += (b.lat - a.lat); cn++; }
      if (a.col === b.col && b.row - a.row === 1) { rx += (b.lng - a.lng) * cosLat; ry += (b.lat - a.lat); rn++; }
    }
  }
  const parts: number[] = [];
  if (cn) parts.push(foldTo90(Math.atan2(cy, cx) / DEG));
  if (rn) parts.push(foldTo90(Math.atan2(ry, rx) / DEG));
  return parts.length ? parts.reduce((s, v) => s + v, 0) / parts.length : 0;
}

export interface DeskewResult {
  changed: boolean;
  planes: Array<{ planeId: string; azSnapped: boolean; tiltDeg: number; correctedDeg: number }>;
}

/**
 * Regularize an array to true lines in place. Only touches azimuths and panel
 * positions; count/arrangement unchanged.
 */
export function deskewArrayToTrue(input: {
  project?: { roofPlanes?: DPlane[]; panelPositions?: DPanel[] };
}): DeskewResult {
  const out: DeskewResult = { changed: false, planes: [] };
  const planes = input?.project?.roofPlanes ?? [];
  // ROOF SCOPE (Stowell plan-rotation repair, 2026-07-12): de-skew is a ROOF-
  // grid operation — planeGridTilt measures the roof's row/col lattice against
  // the building's cardinal grid. Fence + ground panels carry no planeId, so a
  // hybrid design pooled them all into one '_' group whose mixed "grid tilt"
  // rotated the WHOLE fence+ground cluster ~15.6° about a shared centroid
  // (Stowell: a truly E-W fence drew ~13° tilted on PV-1, and both clusters
  // translated off their designed spots). Non-roof panels keep their designed
  // positions/azimuths — their own sheets + the site-plan overlay draw them.
  const panels = (input?.project?.panelPositions ?? []).filter(p => classifyPanel(p) === 'roof');
  if (panels.length < 2) return out;

  const cosLat = Math.cos((panels[0].lat) * DEG);

  // ── 1. Azimuth → building cardinal grid ──────────────────────────────────
  const off = computeModuleAzimuthGrid(panels.map(p => p.azimuth as number).filter(a => isFinite(a as number)));
  const azChanged = new Map<string, boolean>();
  for (const pl of planes) {
    const s = snapModuleAzimuth(pl.azimuth as number, off);
    if (isFinite(s) && s !== pl.azimuth) { pl.azimuth = s; out.changed = true; azChanged.set(pl.id ?? '_', true); }
  }
  for (const p of panels) {
    const s = snapModuleAzimuth(p.azimuth as number, off);
    if (isFinite(s) && s !== p.azimuth) { p.azimuth = s; out.changed = true; }
  }

  // ── 2. Position → true grid, per plane ───────────────────────────────────
  const byPlane = new Map<string, DPanel[]>();
  for (const p of panels) {
    const k = p.planeId ?? '_';
    let arr = byPlane.get(k);
    if (!arr) { arr = []; byPlane.set(k, arr); }
    arr.push(p);
  }

  // Target grid tilt: 0 (true cardinal) when the building is near-square;
  // otherwise the DOMINANT plane's tilt, so a genuinely rotated building keeps
  // its rotation and we only correct planes that disagree with it.
  let domId = '', domN = -1;
  for (const [k, arr] of byPlane) if (arr.length > domN) { domN = arr.length; domId = k; }
  const domTilt = planeGridTilt(byPlane.get(domId) ?? [], cosLat);
  const target = Math.abs(domTilt) <= 5 ? 0 : domTilt;

  for (const [planeId, arr] of byPlane) {
    const tilt = planeGridTilt(arr, cosLat);
    const correct = tilt - target;                       // how much to rotate OUT
    out.planes.push({ planeId, azSnapped: !!azChanged.get(planeId), tiltDeg: tilt, correctedDeg: correct });
    if (Math.abs(correct) < 0.05) continue;              // already true — leave it
    const th = -correct * DEG;
    const cLat = arr.reduce((s, m) => s + m.lat, 0) / arr.length;
    const cLng = arr.reduce((s, m) => s + m.lng, 0) / arr.length;
    const ct = Math.cos(th), st = Math.sin(th);
    for (const m of arr) {
      const E = (m.lng - cLng) * cosLat, N = m.lat - cLat;
      const E2 = E * ct - N * st, N2 = E * st + N * ct;
      m.lng = cLng + E2 / cosLat;
      m.lat = cLat + N2;
    }
    out.changed = true;
  }

  return out;
}
