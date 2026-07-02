// ============================================================
// Equipment locator — places utility meter / MSP / AC disconnect
// on the PV-1 aerial from the best available evidence.
//
// SOURCE HIERARCHY (provenance is always carried to the sheet):
//   1. 'survey_photo_gps' — a labeled survey photo (label contains
//      meter/msp/main/disconnect) WITH EXIF GPS. Exact placement.
//      (Survey apps must keep location + label captures for this
//      tier to fire — the pipeline is ready when the data is.)
//   2. 'street_side_heuristic' — service equipment overwhelmingly
//      hangs on the street-facing wall near a front corner. The
//      street bearing is derived from the geocoded address point
//      (which sits on the street frontage) vs the building
//      centroid. Placement is labeled APPROX — FIELD VERIFY.
//
// Pure + unit-tested. All coordinates are REAL lat/lng.
// ============================================================

export interface LocatedEquipment {
  kind: 'utility_meter' | 'msp' | 'ac_disconnect';
  lat: number;
  lng: number;
  provenance: 'survey_photo_gps' | 'street_side_heuristic';
}

export interface SurveyPhotoHint {
  label?: string | null;
  gps?: { lat: number; lng: number } | null;
}

interface LatLng { lat: number; lng: number }

const KIND_PATTERNS: Array<{ kind: LocatedEquipment['kind']; re: RegExp }> = [
  { kind: 'utility_meter', re: /meter|utility/i },
  { kind: 'msp',           re: /msp|main.?panel|service.?panel|breaker/i },
  { kind: 'ac_disconnect', re: /disconnect|ac.?disco/i },
];

/**
 * Snap a point to the nearest point on the building outline. Photo GPS is
 * where the SURVEYOR stood (a few meters off the wall, phone accuracy on
 * top) — the equipment itself hangs ON the wall, so the marker belongs on
 * the ring. Only snaps within `maxM` (default 15 m); beyond that the fix is
 * suspect (stale cached position) and the raw point is returned unchanged.
 */
export function snapToBuildingRing(p: LatLng, ring: LatLng[], maxM = 15): LatLng {
  if ((ring?.length ?? 0) < 2) return p;
  const cosLat = Math.cos(p.lat * Math.PI / 180);
  const toXY = (v: LatLng) => ({ x: (v.lng - p.lng) * 111320 * cosLat, y: (v.lat - p.lat) * 111320 });
  let best: { d: number; x: number; y: number } | null = null;
  for (let i = 0; i < ring.length; i++) {
    const a = toXY(ring[i]), b = toXY(ring[(i + 1) % ring.length]);
    const abx = b.x - a.x, aby = b.y - a.y;
    const len2 = abx * abx + aby * aby;
    // p is the origin in this frame, so the projection of p onto AB is:
    const t = len2 > 0 ? Math.max(0, Math.min(1, (-a.x * abx - a.y * aby) / len2)) : 0;
    const qx = a.x + t * abx, qy = a.y + t * aby;
    const d = Math.hypot(qx, qy);
    if (!best || d < best.d) best = { d, x: qx, y: qy };
  }
  if (!best || best.d > maxM) return p;
  return {
    lat: p.lat + best.y / 111320,
    lng: p.lng + best.x / (111320 * cosLat),
  };
}

/**
 * Locate service equipment. `buildingRing` is the building outline (real GPS —
 * e.g. all roof-plane vertices), `streetPin` the geocoded address point.
 */
export function locateEquipment(
  buildingRing: LatLng[],
  streetPin: LatLng | null,
  surveyPhotos: SurveyPhotoHint[] = [],
): LocatedEquipment[] {
  const out: LocatedEquipment[] = [];
  const found = new Set<string>();
  const snapRing = (buildingRing ?? []).filter(v => isFinite(v?.lat) && isFinite(v?.lng));

  // ── Tier 1: labeled survey photos with GPS ──
  for (const p of surveyPhotos) {
    if (!p?.gps || !isFinite(p.gps.lat) || !isFinite(p.gps.lng) || !p.label) continue;
    for (const { kind, re } of KIND_PATTERNS) {
      if (!found.has(kind) && re.test(p.label)) {
        const snapped = snapToBuildingRing({ lat: p.gps.lat, lng: p.gps.lng }, snapRing);
        out.push({ kind, lat: snapped.lat, lng: snapped.lng, provenance: 'survey_photo_gps' });
        found.add(kind);
      }
    }
  }
  if (found.size === KIND_PATTERNS.length) return out;

  // ── Tier 2: street-side wall heuristic ──
  const ring = (buildingRing ?? []).filter(v => isFinite(v?.lat) && isFinite(v?.lng));
  if (ring.length < 3) return out;
  const cLat = ring.reduce((s, v) => s + v.lat, 0) / ring.length;
  const cLng = ring.reduce((s, v) => s + v.lng, 0) / ring.length;
  const cosLat = Math.cos(cLat * Math.PI / 180);

  // street direction (unit vector, meters-frame). Falls back to south.
  let sx = 0, sy = -1;
  if (streetPin && isFinite(streetPin.lat) && isFinite(streetPin.lng)) {
    const dx = (streetPin.lng - cLng) * 111320 * cosLat;
    const dy = (streetPin.lat - cLat) * 111320;
    const d = Math.hypot(dx, dy);
    if (d > 1) { sx = dx / d; sy = dy / d; }
  }

  // building bbox → the wall whose outward normal best matches the street
  // direction; equipment goes at that wall's midpoint, nudged toward a corner.
  const lats = ring.map(v => v.lat), lngs = ring.map(v => v.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const midLat = (minLat + maxLat) / 2, midLng = (minLng + maxLng) / 2;
  const walls: Array<{ n: [number, number]; mid: LatLng; along: [number, number] }> = [
    { n: [0, 1],  mid: { lat: maxLat, lng: midLng }, along: [1, 0] },   // north wall
    { n: [0, -1], mid: { lat: minLat, lng: midLng }, along: [1, 0] },   // south wall
    { n: [1, 0],  mid: { lat: midLat, lng: maxLng }, along: [0, 1] },   // east wall
    { n: [-1, 0], mid: { lat: midLat, lng: minLng }, along: [0, 1] },   // west wall
  ];
  const wall = walls.reduce((best, w) =>
    (w.n[0] * sx + w.n[1] * sy) > (best.n[0] * sx + best.n[1] * sy) ? w : best, walls[0]);

  // place along the wall: meter 1/4 from a corner, MSP beside it (inside the
  // same wall), AC disconnect adjacent to the meter per NEC "within 10 ft".
  const place = (alongM: number, outM: number): LatLng => ({
    lat: wall.mid.lat + (wall.along[1] * alongM + wall.n[1] * outM) / 111320,
    lng: wall.mid.lng + (wall.along[0] * alongM + wall.n[0] * outM) / (111320 * cosLat),
  });
  const halfWallM = Math.max(
    2,
    (wall.along[0] !== 0
      ? (maxLng - minLng) * 111320 * cosLat
      : (maxLat - minLat) * 111320) / 2,
  );
  const cornerOffset = -halfWallM * 0.5;   // quarter-point of the wall
  for (const [kind, along] of [
    ['utility_meter', cornerOffset],
    ['msp', cornerOffset + 1.2],
    ['ac_disconnect', cornerOffset - 1.2],
  ] as Array<[LocatedEquipment['kind'], number]>) {
    if (!found.has(kind)) {
      const p = place(along, 0.4);
      out.push({ kind, lat: p.lat, lng: p.lng, provenance: 'street_side_heuristic' });
    }
  }
  return out;
}
