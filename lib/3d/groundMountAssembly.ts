// ═══════════════════════════════════════════════════════════════════════════
// A GROUND MOUNT AS ONE PHYSICAL ASSEMBLY.
//
// 🚨 WHY THIS FILE EXISTS. Reported from live use, 2026-09-26: "A placed ground mount is still
// treated as fragmented rows. I can select only one row at a time. I cannot select the entire
// ground mount as one object. I cannot move the entire ground mount." And the ruling that goes
// with it: "Do not invent a parallel grouping system. Finish the existing one."
//
// So this adds NO new selection system and NO new manipulation gesture. `SolarEngine3D` already
// selects a whole group and already has grab-to-move and grab-to-rotate that transform the
// selected set rigidly about a shared centroid; what it lacked was being told that a ground
// mount's group is its ASSEMBLY (`arrayId`) rather than one of its rows (`layoutId`). What it
// also lacked is the arithmetic for the edits that belong to an assembly rather than to a
// module — tilt, row pitch, azimuth, duplicate — which is what lives here.
//
// It is a pure module for the same reason `lib/3d/vertexMove.ts` is: the maths can then be
// proved without a viewer, and software WebGL cannot rasterise a scene in this repo's browser
// tests, so geometry that is only checked on screen is not checked at all.
//
// THE MODEL, which is the one `lib/3d/ground/groundMountRealityEngine.ts` already uses:
//
//     GroundMountArray          one `arrayId`, one anchor, one azimuth, one tilt
//       -> Row[]                `arrayRow`, offset along the ANTI-azimuth axis by row pitch
//         -> Module[]           `col`, offset along the azimuth-90 (rail) axis
//
// A row's position is therefore DERIVED: anchor + (row x pitch) along one axis + (col x step)
// along the other. Every function here preserves that, which is what makes a move rigid.
// ═══════════════════════════════════════════════════════════════════════════

import type { PlacedPanel } from '@/types';

/** Metres per degree of latitude — the same basis the reality engine uses. */
const MPD = 111_320;
const DEG = Math.PI / 180;

export interface AssemblyFrame {
  /** The anchor module: lowest `arrayRow`, then lowest `col`. The assembly's origin. */
  anchor: PlacedPanel;
  /** Degrees. The direction the modules face. */
  azimuthDeg: number;
  /** Degrees from horizontal. */
  tiltDeg: number;
  /** Distinct row indices present, ascending. */
  rows: number[];
  /** Centre-to-centre distance between consecutive rows, in metres. Null when there is one row. */
  rowPitchM: number | null;
}

/** Every panel of one assembly. Ground panels only, and only those carrying this `arrayId`. */
export function assemblyPanels(panels: PlacedPanel[], arrayId: string): PlacedPanel[] {
  return panels.filter(p => p.systemType === 'ground' && p.arrayId === arrayId);
}

/** Every distinct ground-mount assembly id present, in first-seen order. */
export function assemblyIds(panels: PlacedPanel[]): string[] {
  const seen: string[] = [];
  for (const p of panels) {
    if (p.systemType === 'ground' && p.arrayId && !seen.includes(p.arrayId)) seen.push(p.arrayId);
  }
  return seen;
}

const rowOf = (p: PlacedPanel): number => p.arrayRow ?? p.row ?? 0;
const colOf = (p: PlacedPanel): number => p.col ?? 0;

/** Ground distance in metres between two lat/lng, flat-earth at this latitude. */
export function metresBetween(
  a: { lat: number; lng: number }, b: { lat: number; lng: number },
): number {
  const cosLat = Math.cos(((a.lat + b.lat) / 2) * DEG);
  return Math.hypot((a.lat - b.lat) * MPD, (a.lng - b.lng) * MPD * cosLat);
}

/**
 * Read the assembly's frame off its own panels.
 *
 * The anchor is chosen the same way `buildPanelGrid` chooses it — lowest row, then lowest column
 * — so the origin this reports and the origin the reality engine derives are the same point. Row
 * pitch is MEASURED between the leading modules of consecutive rows rather than recomputed from
 * tilt, because an operator may have changed it.
 */
export function assemblyFrame(members: PlacedPanel[]): AssemblyFrame | null {
  if (!members.length) return null;
  const anchor = members.reduce((best, p) => {
    const r = rowOf(p), c = colOf(p), br = rowOf(best), bc = colOf(best);
    if (r < br) return p;
    if (r === br && c < bc) return p;
    return best;
  }, members[0]);
  const rows = [...new Set(members.map(rowOf))].sort((a, b) => a - b);

  let rowPitchM: number | null = null;
  if (rows.length >= 2) {
    const lead = (r: number) =>
      members.filter(p => rowOf(p) === r).sort((a, b) => colOf(a) - colOf(b))[0];
    const a = lead(rows[0]), b = lead(rows[1]);
    if (a && b) rowPitchM = metresBetween(a, b);
  }
  return {
    anchor,
    azimuthDeg: anchor.azimuth ?? 180,
    tiltDeg: anchor.tilt ?? 20,
    rows,
    rowPitchM,
  };
}

/**
 * MOVE THE WHOLE ASSEMBLY RIGIDLY.
 *
 * Ray's requirement: "Move must translate the entire assembly rigidly. Row-relative positions
 * must not change." One lat/lng delta applied to every member does exactly that — no position is
 * re-derived, so nothing can drift relative to anything else.
 */
export function translateAssembly(
  members: PlacedPanel[], dNorthM: number, dEastM: number,
): PlacedPanel[] {
  if (!members.length) return members;
  const cosLat = Math.cos((members[0].lat ?? 0) * DEG) || 1;
  const dLat = dNorthM / MPD;
  const dLng = dEastM / (MPD * cosLat);
  return members.map(p => ({ ...p, lat: p.lat + dLat, lng: p.lng + dLng }));
}

/**
 * ROTATE THE WHOLE ASSEMBLY ABOUT ITS OWN ORIGIN.
 *
 * Ray's requirement: "PASS only if both rows rotate around the same parent origin." So the pivot
 * is the assembly anchor, not each row's own centre — rotating rows individually is what would
 * tear the table apart. Each module's azimuth and heading advance by the same delta, because the
 * modules turn with the structure.
 */
export function rotateAssembly(members: PlacedPanel[], deltaDeg: number): PlacedPanel[] {
  const frame = assemblyFrame(members);
  if (!frame || !deltaDeg) return members;
  const { anchor } = frame;
  const cosLat = Math.cos(anchor.lat * DEG) || 1;
  const th = deltaDeg * DEG;
  const cos = Math.cos(th), sin = Math.sin(th);
  return members.map(p => {
    // Offset from the pivot, in metres.
    const north = (p.lat - anchor.lat) * MPD;
    const east = (p.lng - anchor.lng) * MPD * cosLat;
    // Clockwise in the ground plane, so a positive delta turns the assembly the same way a
    // positive azimuth change points it.
    const north2 = north * cos + east * sin;
    const east2 = -north * sin + east * cos;
    return {
      ...p,
      lat: anchor.lat + north2 / MPD,
      lng: anchor.lng + east2 / (MPD * cosLat),
      azimuth: normalizeDeg((p.azimuth ?? frame.azimuthDeg) + deltaDeg),
      heading: typeof p.heading === 'number' ? p.heading + th : p.heading,
    };
  });
}

/** Point the assembly at an absolute azimuth, turning it about its own origin. */
export function setAssemblyAzimuth(members: PlacedPanel[], azimuthDeg: number): PlacedPanel[] {
  const frame = assemblyFrame(members);
  if (!frame) return members;
  return rotateAssembly(members, normalizeSigned(azimuthDeg - frame.azimuthDeg));
}

/**
 * SET THE ROW PITCH — the centre-to-centre distance between rows.
 *
 * Row 0 holds still and the rows behind it move along the ANTI-azimuth axis, which is the axis
 * the reality engine spaces rows on (`nsAxis` = -cos/-sin of azimuth). Holding row 0 means the
 * assembly grows backwards from its sun-facing edge instead of drifting sideways, which is how
 * the table is actually built.
 */
export function setAssemblyRowPitch(members: PlacedPanel[], pitchM: number): PlacedPanel[] {
  const frame = assemblyFrame(members);
  if (!frame || frame.rows.length < 2 || !(pitchM > 0)) return members;
  const { anchor, azimuthDeg, rows } = frame;
  const cosLat = Math.cos(anchor.lat * DEG) || 1;
  const azRad = azimuthDeg * DEG;
  // Anti-azimuth: from the low/front edge toward the high/back edge.
  const nsLat = -Math.cos(azRad), nsLng = -Math.sin(azRad);
  const current = frame.rowPitchM ?? pitchM;
  const rowIndex = new Map(rows.map((r, i) => [r, i]));
  return members.map(p => {
    const i = rowIndex.get(rowOf(p)) ?? 0;
    if (i === 0) return p;                       // row 0 is the datum
    const delta = (pitchM - current) * i;        // how much further back this row now sits
    return {
      ...p,
      lat: p.lat + (delta * nsLat) / MPD,
      lng: p.lng + (delta * nsLng) / (MPD * cosLat),
    };
  });
}

/**
 * SET THE TILT of every module in the assembly.
 *
 * Tilt is not only a number on a module: the reality engine derives a module's height from it
 * (`originZ + nsM x tan(tilt)`), so changing the tilt without changing the heights would leave
 * the modules on a plane that no longer matches their own angle. Row 0's height is held as the
 * datum and the rows behind it are re-lifted, which is the same shape as the pitch edit and
 * matches how the structure is solved: the front edge sits at a fixed clearance above grade.
 *
 * `pitch` (the render orientation) is kept in step with `tilt`, because they are the same fact
 * expressed twice and a mismatch is how a module ends up drawn at an angle it is not built at.
 */
export function setAssemblyTilt(members: PlacedPanel[], tiltDeg: number): PlacedPanel[] {
  const frame = assemblyFrame(members);
  if (!frame || !(tiltDeg >= 0) || tiltDeg > 89) return members;
  const { anchor, rows } = frame;
  const datumZ = anchor.height ?? 0;
  const pitchM = frame.rowPitchM ?? 0;
  const tanNew = Math.tan(tiltDeg * DEG);
  const rowIndex = new Map(rows.map((r, i) => [r, i]));
  return members.map(p => {
    const i = rowIndex.get(rowOf(p)) ?? 0;
    return {
      ...p,
      tilt: tiltDeg,
      pitch: -(tiltDeg * DEG),
      height: datumZ + i * pitchM * tanNew,
    };
  });
}

/**
 * DUPLICATE THE WHOLE ASSEMBLY.
 *
 * A new `arrayId` — otherwise the copy and the original would be ONE assembly and selecting
 * either would select both, which is the very defect this work exists to remove. Module ids are
 * new for the same reason. Offset along the rail axis (azimuth-90) so the copy lands beside the
 * original rather than on top of it.
 */
export function duplicateAssembly(
  members: PlacedPanel[],
  newArrayId: string,
  opts: { offsetM?: number; idFor?: (p: PlacedPanel, i: number) => string } = {},
): PlacedPanel[] {
  const frame = assemblyFrame(members);
  if (!frame || !members.length) return [];
  const offsetM = opts.offsetM ?? spanAlongRails(members) + 3;
  const azRad = frame.azimuthDeg * DEG;
  // Rail axis = azimuth - 90.
  const ewLat = Math.sin(azRad), ewLng = -Math.cos(azRad);
  const cosLat = Math.cos(frame.anchor.lat * DEG) || 1;
  return members.map((p, i) => ({
    ...p,
    id: opts.idFor ? opts.idFor(p, i) : `${p.id}-copy-${newArrayId}`,
    arrayId: newArrayId,
    lat: p.lat + (offsetM * ewLat) / MPD,
    lng: p.lng + (offsetM * ewLng) / (MPD * cosLat),
  }));
}

/** How wide the assembly is along its rail axis, in metres — used to offset a duplicate clear. */
export function spanAlongRails(members: PlacedPanel[]): number {
  const frame = assemblyFrame(members);
  if (!frame || members.length < 2) return 0;
  const azRad = frame.azimuthDeg * DEG;
  const ewLat = Math.sin(azRad), ewLng = -Math.cos(azRad);
  const cosLat = Math.cos(frame.anchor.lat * DEG) || 1;
  let min = Infinity, max = -Infinity;
  for (const p of members) {
    const north = (p.lat - frame.anchor.lat) * MPD;
    const east = (p.lng - frame.anchor.lng) * MPD * cosLat;
    const along = north * ewLat + east * ewLng;
    if (along < min) min = along;
    if (along > max) max = along;
  }
  return Number.isFinite(min) && Number.isFinite(max) ? max - min : 0;
}

/** Remove one whole assembly, leaving every other panel untouched. */
export function removeAssembly(panels: PlacedPanel[], arrayId: string): PlacedPanel[] {
  return panels.filter(p => !(p.systemType === 'ground' && p.arrayId === arrayId));
}

/** Replace one assembly's members in a full panel list, preserving order of the rest. */
export function replaceAssembly(
  panels: PlacedPanel[], arrayId: string, next: PlacedPanel[],
): PlacedPanel[] {
  const byId = new Map(next.map(p => [p.id, p]));
  const out: PlacedPanel[] = [];
  for (const p of panels) {
    if (p.systemType === 'ground' && p.arrayId === arrayId) {
      const replacement = byId.get(p.id);
      if (replacement) { out.push(replacement); byId.delete(p.id); }
      // A member dropped from `next` is dropped here too — that is how a delete expresses itself.
    } else {
      out.push(p);
    }
  }
  // Anything in `next` that was not already present (a duplicate's members) is appended.
  for (const p of byId.values()) out.push(p);
  return out;
}

function normalizeDeg(d: number): number {
  const m = d % 360;
  return m < 0 ? m + 360 : m;
}
/** The shortest signed turn from 0 to `d`, in (-180, 180]. */
function normalizeSigned(d: number): number {
  let m = normalizeDeg(d);
  if (m > 180) m -= 360;
  return m;
}
