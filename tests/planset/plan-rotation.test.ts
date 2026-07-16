// ═══════════════════════════════════════════════════════════════
// GLOBAL PLAN ROTATION — the "cocking everything to the side" repair.
//
// PV-1 drew with inconsistent per-layer rotations (modules axis-square via an
// independent 15° snap, roof outline at its true bearing, fence/ground at yet
// other angles — Stowell's truly-E-W fence at ~13° from a deskew that pooled
// non-roof panels). The repair: ONE plan angle from the dominant roof axis,
// applied to EVERY drawn layer in fake-degree space; the north arrow turns by
// the same constant; deskewArrayToTrue is scoped to roof panels.
// ═══════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import {
  computePlanTiltDeg, choosePlanRotationDeg, rotateFakePt, rotateAzimuthDeg,
  northArrowRotationDeg, rotateSiteContext, type SiteContext, type FakePt,
} from '@/lib/drafting/templates/roofSiteContext';
import { rotateHybridOverlays, type HybridOverlays } from '@/lib/drafting/templates/hybridOverlay';
import { drawRoofPlan } from '@/lib/drafting/templates/roof';
import { deskewArrayToTrue } from '@/lib/permit/utils/deskewArrayToTrue';

const DEG = Math.PI / 180;

/** Rectangle ring (fake-degrees = ft) centered at (cx,cy), w along x, h along
 *  y, rotated tiltDeg CCW about its center. */
function rectRing(cx: number, cy: number, w: number, h: number, tiltDeg: number): FakePt[] {
  const c = Math.cos(tiltDeg * DEG), s = Math.sin(tiltDeg * DEG);
  return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => ({
    lng: cx + x * c - y * s,
    lat: cy + x * s + y * c,
  }));
}

/** Angle (deg CCW from +x/east, fake-degree plane) of a→b. */
function segAngle(a: FakePt, b: FakePt): number {
  return Math.atan2(b.lat - a.lat, b.lng - a.lng) / DEG;
}

/** Fold an angle distance to [0,45] against the nearest axis multiple of 90. */
function offAxis(deg: number): number {
  const m = ((deg % 90) + 90) % 90;
  return Math.min(m, 90 - m);
}

// ── Angle derivation: dominant-axis snap ────────────────────────────────────

describe('computePlanTiltDeg', () => {
  it('recovers the tilt of a rotated rectangular building', () => {
    const planes = [{ vertices: rectRing(60, 60, 44, 75, 8) }];
    expect(computePlanTiltDeg(planes)).toBeCloseTo(8, 1);
  });

  it('uses the DOMINANT axis across facets (two gable halves agree)', () => {
    const planes = [
      { vertices: rectRing(60, 45, 70, 18, -6.5) },
      { vertices: rectRing(60, 63, 70, 18, -6.5) },
    ];
    expect(computePlanTiltDeg(planes)).toBeCloseTo(-6.5, 1);
  });

  it('axis-aligned building → EXACT identity (0, not epsilon)', () => {
    expect(computePlanTiltDeg([{ vertices: rectRing(60, 60, 44, 75, 0) }])).toBe(0);
    // sub-threshold trace noise also snaps to identity
    expect(computePlanTiltDeg([{ vertices: rectRing(60, 60, 44, 75, 0.3) }])).toBe(0);
  });

  it('folds mod 90 — a 84° "tilt" is a 6°-off-vertical long axis', () => {
    const planes = [{ vertices: rectRing(60, 60, 20, 70, 84) }];
    expect(computePlanTiltDeg(planes)).toBeCloseTo(-6, 1);
  });
});

// ── Squaring choice: fill the window better ─────────────────────────────────

describe('choosePlanRotationDeg', () => {
  const tallBuilding = rectRing(60, 60, 30, 90, 10);   // long axis ~vertical

  it('minimal rotation when it fits as well (square-ish window)', () => {
    expect(choosePlanRotationDeg(10, tallBuilding, 500, 500)).toBeCloseTo(-10, 6);
  });

  it('turns the long axis onto the long window axis when that fills better', () => {
    // Wide, short window: long-axis-horizontal (alt = 80°) wins.
    expect(choosePlanRotationDeg(10, tallBuilding, 1200, 320)).toBeCloseTo(80, 6);
  });

  it('identity tilt stays identity regardless of window', () => {
    expect(choosePlanRotationDeg(0, tallBuilding, 1200, 320)).toBe(0);
  });
});

// ── The transform itself: bearings + all-layer consistency ─────────────────

describe('rotateFakePt / rotateAzimuthDeg', () => {
  const pivot = { lat: 60, lng: 60 };

  it('a rotated segment turns by exactly the plan angle', () => {
    const a = { lat: 20, lng: 30 }, b = { lat: 25, lng: 90 };
    const before = segAngle(a, b);
    const after = segAngle(rotateFakePt(a, -6.51, pivot), rotateFakePt(b, -6.51, pivot));
    expect(after - before).toBeCloseTo(-6.51, 6);
  });

  it('compass azimuth transforms consistently with the point transform', () => {
    // Bearing A points (sin A, cos A) in (lng, lat); rotate that direction and
    // re-measure — must equal rotateAzimuthDeg(A, rot).
    for (const az of [0, 84, 174, 264, 300]) {
      for (const rot of [-6.51, 12, -90]) {
        const tip = { lat: 60 + Math.cos(az * DEG), lng: 60 + Math.sin(az * DEG) };
        const tipR = rotateFakePt(tip, rot, pivot);
        const measured = ((Math.atan2(tipR.lng - 60, tipR.lat - 60) / DEG) + 360) % 360;
        expect(measured).toBeCloseTo(rotateAzimuthDeg(az, rot), 6);
      }
    }
  });

  it('ALL-LAYER CONSISTENCY: fence-vs-building bearing difference is preserved', () => {
    // Stowell shape: building long edge at +6.5°, fence at -1.0° (truly ~E-W).
    const bldA = { lat: 40, lng: 40 }, bldB = rotateFakePt({ lat: 40, lng: 110 }, 6.5, { lat: 40, lng: 40 });
    const fenA = { lat: 120, lng: 90 }, fenB = rotateFakePt({ lat: 120, lng: 153 }, -1.0, { lat: 120, lng: 90 });
    const diffBefore = segAngle(fenA, fenB) - segAngle(bldA, bldB);
    const rot = -6.5;
    const diffAfter =
      segAngle(rotateFakePt(fenA, rot, { lat: 60, lng: 60 }), rotateFakePt(fenB, rot, { lat: 60, lng: 60 })) -
      segAngle(rotateFakePt(bldA, rot, { lat: 60, lng: 60 }), rotateFakePt(bldB, rot, { lat: 60, lng: 60 }));
    expect(diffAfter).toBeCloseTo(diffBefore, 6);
    // and the building lands square while the fence keeps its real offset
    expect(offAxis(segAngle(rotateFakePt(bldA, rot, { lat: 60, lng: 60 }), rotateFakePt(bldB, rot, { lat: 60, lng: 60 })))).toBeCloseTo(0, 6);
  });

  it('identity rotation is a true no-op', () => {
    const p = { lat: 12.34, lng: 56.78 };
    expect(rotateFakePt(p, 0, pivot)).toEqual(p);
    expect(rotateAzimuthDeg(84, 0)).toBe(84);
  });
});

describe('northArrowRotationDeg', () => {
  it('is wired to the SAME angle constant (screen sign flip only)', () => {
    expect(northArrowRotationDeg(-6.51)).toBeCloseTo(6.51, 6);
    expect(northArrowRotationDeg(80)).toBeCloseTo(-80, 6);
    expect(northArrowRotationDeg(0)).toBe(0);
  });
});

// ── Layer rotators: site context + hybrid overlays ─────────────────────────

describe('rotateSiteContext / rotateHybridOverlays', () => {
  const pivot = { lat: 60, lng: 60 };

  it('rotates every site layer and preserves segment lengths (pure)', () => {
    const site: SiteContext = {
      parcel: rectRing(60, 60, 200, 150, 0),
      roads: [{ name: 'OLD ALTON RD', klass: 'road', pts: [{ lat: 160, lng: 0 }, { lat: 160, lng: 200 }] }],
      buildings: [rectRing(120, 100, 30, 20, 0)],
      driveways: [], paved: [], roadSurfaces: [], lawn: [], trees: [],
      equipment: [{ kind: 'msp', pt: { lat: 50, lng: 40 }, provenance: 'test' }],
      source: 'test', hasNearmap: false, streetName: 'OLD ALTON RD', apn: null,
    };
    const parcelEdgeLen = Math.hypot(site.parcel![1].lng - site.parcel![0].lng, site.parcel![1].lat - site.parcel![0].lat);
    const out = rotateSiteContext(site, -6.5, pivot);
    // every layer turned by the same angle
    expect(segAngle(out.roads[0].pts[0], out.roads[0].pts[1])).toBeCloseTo(-6.5, 6);
    expect(segAngle(out.parcel![0], out.parcel![1])).toBeCloseTo(-6.5, 6);
    expect(segAngle(out.buildings[0][0], out.buildings[0][1])).toBeCloseTo(-6.5, 6);
    // rigid: lengths preserved
    expect(Math.hypot(out.parcel![1].lng - out.parcel![0].lng, out.parcel![1].lat - out.parcel![0].lat)).toBeCloseTo(parcelEdgeLen, 6);
    // pure: input untouched
    expect(site.roads[0].pts[0]).toEqual({ lat: 160, lng: 0 });
    // identity short-circuits to the same object
    expect(rotateSiteContext(site, 0, pivot)).toBe(site);
  });

  it('rotates fence line + ground rings/slats by the same angle (pure)', () => {
    const hyb: HybridOverlays = {
      ground: [{
        ring: rectRing(150, 40, 34, 11, 4.8),
        rowLines: [[{ lat: 38, lng: 135 }, { lat: 38, lng: 165 }]],
        // per-module division lines (required since the PLP realism pass)
        cellLines: [[{ lat: 36, lng: 140 }, { lat: 44, lng: 140 }]],
        labelPt: { lat: 50, lng: 150 }, label: 'GROUND MOUNT — 20 MOD',
      }],
      fence: [{
        line: [{ lat: 120, lng: 90 }, { lat: 118.9, lng: 153 }],
        labelPt: { lat: 119.5, lng: 121.5 }, label: 'SOLAR FENCE — 17 MOD',
      }],
      allPts: [{ lat: 120, lng: 90 }, { lat: 118.9, lng: 153 }],
    };
    const fenceBefore = segAngle(hyb.fence[0].line[0], hyb.fence[0].line[1]);
    const slatBefore = segAngle(hyb.ground[0].ring[0], hyb.ground[0].ring[1]);
    const out = rotateHybridOverlays(hyb, -6.5, pivot);
    expect(segAngle(out.fence[0].line[0], out.fence[0].line[1])).toBeCloseTo(fenceBefore - 6.5, 6);
    expect(segAngle(out.ground[0].ring[0], out.ground[0].ring[1])).toBeCloseTo(slatBefore - 6.5, 6);
    expect(segAngle(out.ground[0].rowLines[0][0], out.ground[0].rowLines[0][1])).toBeCloseTo(-6.5, 6);
    // cellLines rotate rigidly with the rest of the ground shape (was 90° before)
    expect(segAngle(out.ground[0].cellLines[0][0], out.ground[0].cellLines[0][1])).toBeCloseTo(90 - 6.5, 6);
    // pure + identity
    expect(hyb.fence[0].line[0]).toEqual({ lat: 120, lng: 90 });
    expect(rotateHybridOverlays(hyb, 0, pivot)).toBe(hyb);
  });
});

// ── deskewArrayToTrue scope: roof-lattice only ──────────────────────────────

describe('deskewArrayToTrue hybrid scope', () => {
  it('never moves fence/ground panels (the ~15.6° Stowell cluster rotation)', () => {
    // Roof grid on a plane + fence/ground panels with NO planeId (prod shape).
    const roof: any[] = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
      roof.push({ lat: 38.7 + r * 1.5 / 111320, lng: -90 + c * 1.1 / 88000, azimuth: 84, row: r, col: c, planeId: 'p1' });
    }
    const fence = Array.from({ length: 5 }, (_, i) => ({
      lat: 38.7005, lng: -90.0005 + i * 1.1 / 88000, azimuth: 180, row: 0, col: i, systemType: 'fence',
    }));
    const ground = Array.from({ length: 4 }, (_, i) => ({
      lat: 38.7008, lng: -90.001 + i * 1.1 / 88000, azimuth: 175, row: 0, col: i, systemType: 'ground',
    }));
    const fenceBefore = fence.map(p => ({ ...p }));
    const groundBefore = ground.map(p => ({ ...p }));
    deskewArrayToTrue({ project: { roofPlanes: [{ id: 'p1', azimuth: 84 }], panelPositions: [...roof, ...fence, ...ground] } });
    fence.forEach((p, i) => {
      expect(p.lat).toBe(fenceBefore[i].lat);
      expect(p.lng).toBe(fenceBefore[i].lng);
      expect(p.azimuth).toBe(fenceBefore[i].azimuth);
    });
    ground.forEach((p, i) => {
      expect(p.lat).toBe(groundBefore[i].lat);
      expect(p.lng).toBe(groundBefore[i].lng);
      expect(p.azimuth).toBe(groundBefore[i].azimuth);
    });
  });
});

// ── Integration: drawRoofPlan renders every layer through ONE transform ────

/** Minimal DraftingInput for drawRoofPlan (fake-degree geometry, ft units).
 *  Long axis VERTICAL (Stowell-like ridge): the plan draw window is taller
 *  than wide (left table column reserved), so minimal rotation wins the fill
 *  choice deterministically. */
function makeInput(tiltDeg: number) {
  const plane = {
    id: 'p1',
    vertices: rectRing(120, 80, 34, 80, tiltDeg),
    pitch: 25,
    azimuth: rotateAzimuthDeg(90, tiltDeg),   // east-facing plane, tilted with the building
  };
  const panels = [0, 1, 2].map(i => {
    const base = { lat: 66 + i * 10, lng: 116 };
    const p = rotateFakePt(base, tiltDeg, { lat: 80, lng: 120 });
    return { id: `m${i}`, ...p, azimuth: plane.azimuth, orientation: 'portrait', row: i, col: 0 };
  });
  return {
    project: {
      roofPlanes: [plane],
      panelPositions: panels,
      roofPitch: 25,
      panelLengthIn: 66, panelWidthIn: 40,
    },
    layout: {},
    engineering: { totalPanels: panels.length, totalDcKw: 1.2, totalAcKw: 1.2, panelWatts: 400 },
  } as any;
}

function planeEdgesFromSvg(svg: string): Array<[FakePt, FakePt]> {
  const m = svg.match(/<polygon points="([^"]+)" fill="#ffffff" stroke="none"\/>/);
  expect(m, 'plane fill polygon present').toBeTruthy();
  const pts = m![1].trim().split(/\s+/).map(s => {
    const [x, y] = s.split(',').map(Number);
    return { lng: x, lat: y };   // screen coords; segAngle works on lng/lat fields
  });
  return pts.map((p, i) => [p, pts[(i + 1) % pts.length]] as [FakePt, FakePt]);
}

function roseAngle(svg: string): number {
  const m = svg.match(/class="north-rose" transform="rotate\((-?[\d.]+)/);
  expect(m, 'north-rose group present').toBeTruthy();
  return Number(m![1]);
}

describe('drawRoofPlan — one global transform end-to-end', () => {
  it('single system: tilted building draws square + north arrow turns by the same angle', () => {
    const svg = drawRoofPlan(makeInput(10));
    for (const [a, b] of planeEdgesFromSvg(svg)) {
      if (Math.hypot(b.lng - a.lng, b.lat - a.lat) < 2) continue;
      expect(offAxis(segAngle(a, b))).toBeLessThan(0.6);
    }
    // plan rotation −10° (CCW fake space) → north arrow +10° clockwise on screen
    expect(roseAngle(svg)).toBeCloseTo(10, 1);
  });

  it('single system: axis-aligned building = identity (no rotation, north up)', () => {
    const svg = drawRoofPlan(makeInput(0));
    expect(roseAngle(svg)).toBe(0);
    for (const [a, b] of planeEdgesFromSvg(svg)) {
      if (Math.hypot(b.lng - a.lng, b.lat - a.lat) < 2) continue;
      expect(offAxis(segAngle(a, b))).toBeLessThan(0.3);
    }
  });

  it('hybrid: fence rides the SAME rotation — building/fence bearing gap preserved on the sheet', () => {
    const input = makeInput(10);
    const originLat = 38.7, originLng = -90.0;
    // Truly E-W fence (real lat/lng, prod shape), sitting in the roof's column
    // so the subject bbox stays tall → the fill choice stays minimal-rotation.
    const fencePanels = Array.from({ length: 6 }, (_, i) => ({
      lat: 38.7002, lng: -89.999685 + i * 0.0000403, azimuth: 180, row: 0,
    }));
    const cad: any = {
      systemType: 'roof', totalPanels: 9, totalDcKw: 3.6, warnings: [], solveMs: 0,
      originLat, originLng, panelWidthM: 1.016, panelHeightM: 1.676,
      hybrid: { sections: [{ key: 'fence', originLat, originLng, totalPanels: 6, dcKw: 2.4, panels: fencePanels }] },
    };
    const svg = drawRoofPlan(input, null, cad);
    // building square
    for (const [a, b] of planeEdgesFromSvg(svg)) {
      if (Math.hypot(b.lng - a.lng, b.lat - a.lat) < 2) continue;
      expect(offAxis(segAngle(a, b))).toBeLessThan(0.6);
    }
    // fence line drawn at the plan-rotation angle (screen y-down: +10°),
    // i.e. its true bearing offset from the now-square building is intact.
    const fm = svg.match(/<line x1="([\d.-]+)" y1="([\d.-]+)" x2="([\d.-]+)" y2="([\d.-]+)" stroke="#1a7a3a"/);
    expect(fm, 'fence line present').toBeTruthy();
    const [x1, y1, x2, y2] = fm!.slice(1).map(Number);
    const screenDeg = Math.atan2(y2 - y1, x2 - x1) / DEG;
    const fold = ((screenDeg % 180) + 180) % 180;
    expect(Math.min(Math.abs(fold - 10), Math.abs(fold - 170))).toBeLessThan(1);
    // north arrow — same constant again
    expect(roseAngle(svg)).toBeCloseTo(10, 1);
  });
});
