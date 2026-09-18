/**
 * components/3d/measure/measurements.tsx
 *
 * Cesium rendering helpers for the v66 Measurements + Ruler tools.
 *
 * No React state — the caller (SolarEngine3D.tsx) holds the measurements[]
 * array and the ruler ref, and calls these to translate measurement
 * records into Cesium entities and back.
 *
 * Visual style mirrors the pre-existing single-pair handleMeasureClick so
 * the look is consistent across the legacy 'measure' tool and the new
 * 'measurements' + 'ruler' tools:
 *   - polyline: cyan #00ffff, alpha 0.9, width 2
 *   - endpoint dots: cyan #00ffff, pixelSize 10, black outline
 *   - label: white text, black outline, dark navy background (#001a33 @ 0.85),
 *     FILL_AND_OUTLINE, no depth test (always visible)
 *   - label is at the midpoint, lifted +0.3 m so it doesn't sink into the line
 *
 * Aurora parity:
 *   - Units in feet, decimal under 10', integer above
 *   - Composite "12.4'\n(horiz 12.3')" when heights differ
 */

import {
  type Measurement,
  type LngLatH,
  formatMeasurementLabel,
} from '@/lib/3d/measureMath';

const COLOR_LINE_CSS  = '#00ffff';
const COLOR_LINE_ALPHA = 0.9;
const LABEL_BG_RGBA   = [0, 0.1, 0.2, 0.85] as const;
const DOT_PIXEL_SIZE  = 10;
const LINE_WIDTH      = 2;
const VERTICAL_LIFT_M = 0.3;

export interface MeasurementEntityBundle {
  polyline: any;
  dotA: any;
  dotB: any;
  label: any;
}

function lineColor(C: any): any {
  const base = C.Color.fromCssColorString(COLOR_LINE_CSS);
  return base.withAlpha(COLOR_LINE_ALPHA);
}

function dotColor(C: any): any {
  return C.Color.fromCssColorString(COLOR_LINE_CSS);
}

function labelBgColor(C: any): any {
  return new C.Color(LABEL_BG_RGBA[0], LABEL_BG_RGBA[1], LABEL_BG_RGBA[2], LABEL_BG_RGBA[3]);
}

function safeCartesian3(C: any, lng: number, lat: number, h: number): any {
  if (!isFinite(lat) || !isFinite(lng) || !isFinite(h)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  try {
    const c = C.Cartesian3.fromDegrees(lng, lat, h);
    if (!c || !isFinite(c.x) || !isFinite(c.y) || !isFinite(c.z)) return null;
    return c;
  } catch {
    return null;
  }
}

function midpoint(a: LngLatH, b: LngLatH): LngLatH {
  return {
    lat: (a.lat + b.lat) / 2,
    lng: (a.lng + b.lng) / 2,
    h:   (a.h + b.h) / 2 + VERTICAL_LIFT_M,
  };
}

export function renderMeasurement(
  viewer: any,
  C: any,
  m: Measurement,
): MeasurementEntityBundle | null {
  if (!viewer || !C) return null;

  const posA = safeCartesian3(C, m.a.lng, m.a.lat, m.a.h + VERTICAL_LIFT_M);
  const posB = safeCartesian3(C, m.b.lng, m.b.lat, m.b.h + VERTICAL_LIFT_M);
  if (!posA || !posB) return null;

  let polyline: any;
  let dotA: any;
  let dotB: any;
  let label: any;

  try {
    polyline = viewer.entities.add({
      polyline: {
        positions: [posA, posB],
        width: LINE_WIDTH,
        material: lineColor(C),
        clampToGround: false,
        arcType: C.ArcType.NONE,
      },
    });

    dotA = viewer.entities.add({
      position: posA,
      point: {
        pixelSize: DOT_PIXEL_SIZE,
        color: dotColor(C),
        outlineColor: C.Color.BLACK,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });

    dotB = viewer.entities.add({
      position: posB,
      point: {
        pixelSize: DOT_PIXEL_SIZE,
        color: dotColor(C),
        outlineColor: C.Color.BLACK,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });

    const mid = midpoint(m.a, m.b);
    const midPos = safeCartesian3(C, mid.lng, mid.lat, mid.h);
    if (midPos) {
      label = viewer.entities.add({
        position: midPos,
        label: {
          text: formatMeasurementLabel(m),
          font: '13px sans-serif',
          fillColor: C.Color.WHITE,
          outlineColor: C.Color.BLACK,
          outlineWidth: 2,
          style: C.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: C.VerticalOrigin.BOTTOM,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          showBackground: true,
          backgroundColor: labelBgColor(C),
          backgroundPadding: new C.Cartesian2(8, 5),
        },
      });
    }
  } catch {
    removeMeasurementBundle(viewer, { polyline, dotA, dotB, label });
    return null;
  }

  return { polyline, dotA, dotB, label };
}

export function removeMeasurementBundle(viewer: any, bundle: MeasurementEntityBundle | null | undefined): void {
  if (!viewer || !bundle) return;
  for (const e of [bundle.polyline, bundle.dotA, bundle.dotB, bundle.label]) {
    if (e) {
      try { viewer.entities.remove(e); } catch { /* ignore */ }
    }
  }
}

export function renderRulerPreview(
  viewer: any,
  C: any,
  anchor: LngLatH,
  cursor: LngLatH,
  prev: any,
): any {
  if (!viewer || !C) return null;
  const posA = safeCartesian3(C, anchor.lng, anchor.lat, anchor.h + VERTICAL_LIFT_M);
  const posB = safeCartesian3(C, cursor.lng, cursor.lat, cursor.h + VERTICAL_LIFT_M);
  if (!posA || !posB) return null;

  if (prev) {
    try { viewer.entities.remove(prev); } catch { /* ignore */ }
  }

  try {
    return viewer.entities.add({
      polyline: {
        positions: [posA, posB],
        width: LINE_WIDTH,
        material: lineColor(C),
        clampToGround: false,
        arcType: C.ArcType.NONE,
      },
    });
  } catch {
    return null;
  }
}
