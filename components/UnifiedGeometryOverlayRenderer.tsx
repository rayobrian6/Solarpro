'use client';

/**
 * UnifiedGeometryOverlayRenderer — renders unified geometry artifacts as SVG
 * overlays on survey photos.
 *
 * Unlike PhotoVisionOverlayRenderer (which renders Pipeline A bounding boxes),
 * this component renders the FULL geometry from UnifiedGeometryArtifact instances:
 *   - `polygon` → SVG <polygon> with filled semi-transparent regions
 *   - `lineSegment` → SVG <line> with colored stroke
 *   - `bbox` → SVG <rect> fallback when polygon is not available
 *
 * Color scheme is by geometryClass:
 *   - roof_plane       → green fill
 *   - wall_plane       → blue fill
 *   - roof_line        → yellow/orange stroke
 *   - obstruction      → pink/red fill
 *   - electrical_node  → purple fill
 *   - consensus_plane  → teal fill
 *   - other            → gray
 *
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 */

import { useState, useRef, useCallback } from 'react';
import {
  normalizedRegionToSvgPercent,
  normalizedLineToSvgPercent,
  normalizedPolygonToSvgPercent,
  type SvgPercentRect,
  type SvgPercentLine,
  type SvgPercentPolygon,
} from '@/lib/assistedEvidenceSources/overlayCoordinateConversion';
import type {
  UnifiedGeometryArtifact,
  UnifiedGeometryClass,
  GeometryLineSegment,
  SegmentationBackend,
  FacadeSubtype,
  SiteContextSubtype,
  UnifiedConditionFlag,
} from '@/lib/siteSurveys/unifiedGeometry/types';
import {
  FACADE_SEGMENTATION_CLASSES,
  SITE_CONTEXT_SEGMENTATION_CLASSES,
  ELECTRICAL_SEGMENTATION_CLASSES,
  OCCLUDER_SEGMENTATION_CLASSES,
  CONDITION_SEGMENTATION_CLASSES,
  type SegmentationClass,
} from '@/lib/siteSurveys/geometryReconstruction/types';

/* ── Types ────────────────────────────────────────────────────────────── */

/** A survey file with its associated unified geometry artifacts. */
export interface FileWithUnifiedArtifacts {
  fileId: string;
  fileUrl: string;
  filename: string | null;
  artifacts: UnifiedGeometryArtifact[];
}

/* ── Color scheme by geometry class ──────────────────────────────────── */

const GEOMETRY_CLASS_OVERLAY_COLORS: Record<
  UnifiedGeometryClass,
  { stroke: string; fill: string; label: string }
> = {
  roof_plane: {
    stroke: '#34d399',
    fill: 'rgba(52,211,153,0.12)',
    label: 'Roof Plane',
  },
  wall_plane: {
    stroke: '#60a5fa',
    fill: 'rgba(96,165,250,0.10)',
    label: 'Wall Plane',
  },
  roof_line: {
    stroke: '#fbbf24',
    fill: 'rgba(251,191,36,0.06)',
    label: 'Roof Line',
  },
  obstruction: {
    stroke: '#f472b6',
    fill: 'rgba(244,114,182,0.10)',
    label: 'Obstruction',
  },
  electrical_node: {
    stroke: '#a78bfa',
    fill: 'rgba(167,139,250,0.10)',
    label: 'Electrical',
  },
  segmentation_mask: {
    stroke: '#22d3ee',
    fill: 'rgba(34,211,238,0.08)',
    label: 'Segmentation',
  },
  depth_map: {
    stroke: '#6b7280',
    fill: 'rgba(107,114,128,0.06)',
    label: 'Depth',
  },
  point_cloud: {
    stroke: '#6b7280',
    fill: 'rgba(107,114,128,0.06)',
    label: 'Point Cloud',
  },
  vanishing_point: {
    stroke: '#f59e0b',
    fill: 'rgba(245,158,11,0.10)',
    label: 'Vanishing Pt',
  },
  consensus_plane: {
    stroke: '#2dd4bf',
    fill: 'rgba(45,212,191,0.12)',
    label: 'Consensus',
  },
  ground_plane: {
    stroke: '#84cc16',
    fill: 'rgba(132,204,22,0.08)',
    label: 'Ground',
  },
  unknown: {
    stroke: '#94a3b8',
    fill: 'rgba(148,163,184,0.06)',
    label: '?',
  },
};

/**
 * Override colors for segmentation_mask artifacts based on backend.
 * SAM 2 masks get a distinct emerald green to differentiate them from
 * Canny edge-detection masks (which keep the default cyan).
 */
const SEGMENTATION_BACKEND_COLORS: Record<SegmentationBackend, { stroke: string; fill: string; label: string }> = {
  sam2: {
    stroke: '#10b981',     // emerald green — SAM 2 produces real ML masks
    fill: 'rgba(16,185,129,0.15)',
    label: 'SAM 2 Segmentation',
  },
  canny: {
    stroke: '#22d3ee',     // cyan — Canny edge detection (fallback)
    fill: 'rgba(34,211,238,0.08)',
    label: 'Canny Segmentation',
  },
};

/**
 * Per-segmentationClass color map for fine-grained visual distinction.
 * Used when geometryClass === 'segmentation_mask' and a segmentationClass is available.
 * Falls back to SEGMENTATION_BACKEND_COLORS if no per-class entry exists.
 *
 * Color scheme:
 *   Facade:      warm ambers/oranges (building envelope features)
 *   Site context: greens/browns (ground-level features)
 *   Electrical:  purples (electrical infrastructure)
 *   Occluder:    grays, dashed (things blocking the view)
 *   Condition:   reds (quality/safety issues)
 *   Legacy:      original colors
 */
const SEGMENTATION_CLASS_COLORS: Partial<Record<SegmentationClass, { stroke: string; fill: string; label: string }>> = {
  // Legacy
  roof:       { stroke: '#34d399', fill: 'rgba(52,211,153,0.12)',  label: 'Roof' },
  wall:       { stroke: '#60a5fa', fill: 'rgba(96,165,250,0.10)',  label: 'Wall' },
  sky:        { stroke: '#38bdf8', fill: 'rgba(56,189,248,0.06)',  label: 'Sky' },
  tree:       { stroke: '#22c55e', fill: 'rgba(34,197,94,0.10)',   label: 'Tree' },
  ground:     { stroke: '#a3e635', fill: 'rgba(163,230,53,0.08)',  label: 'Ground' },
  obstruction:{ stroke: '#f472b6', fill: 'rgba(244,114,182,0.10)', label: 'Obstruction' },
  equipment:  { stroke: '#c084fc', fill: 'rgba(192,132,252,0.10)', label: 'Equipment' },
  // Facade
  siding:      { stroke: '#d97706', fill: 'rgba(217,119,6,0.10)',  label: 'Siding' },
  window:      { stroke: '#3b82f6', fill: 'rgba(59,130,246,0.12)', label: 'Window' },
  door:        { stroke: '#7c3aed', fill: 'rgba(124,58,237,0.10)', label: 'Door' },
  garage_door: { stroke: '#6d28d9', fill: 'rgba(109,40,217,0.10)', label: 'Garage Door' },
  fascia:      { stroke: '#b45309', fill: 'rgba(180,83,9,0.08)',   label: 'Fascia' },
  soffit:      { stroke: '#92400e', fill: 'rgba(146,64,14,0.08)',  label: 'Soffit' },
  gutter:      { stroke: '#78716c', fill: 'rgba(120,113,108,0.10)',label: 'Gutter' },
  downspout:   { stroke: '#57534e', fill: 'rgba(87,83,78,0.10)',   label: 'Downspout' },
  porch:       { stroke: '#a16207', fill: 'rgba(161,98,7,0.08)',   label: 'Porch' },
  deck:        { stroke: '#854d0e', fill: 'rgba(133,77,14,0.08)',  label: 'Deck' },
  steps:       { stroke: '#ca8a04', fill: 'rgba(202,138,4,0.08)',  label: 'Steps' },
  railing:     { stroke: '#eab308', fill: 'rgba(234,179,8,0.08)',  label: 'Railing' },
  // Site context
  grass:                       { stroke: '#4ade80', fill: 'rgba(74,222,128,0.06)', label: 'Grass' },
  overgrown_grass:             { stroke: '#16a34a', fill: 'rgba(22,163,74,0.08)',  label: 'Overgrown Grass' },
  sidewalk:                    { stroke: '#9ca3af', fill: 'rgba(156,163,175,0.06)',label: 'Sidewalk' },
  driveway:                    { stroke: '#78716c', fill: 'rgba(120,113,108,0.06)',label: 'Driveway' },
  gravel:                      { stroke: '#a8a29e', fill: 'rgba(168,162,158,0.06)',label: 'Gravel' },
  fence:                       { stroke: '#92400e', fill: 'rgba(146,64,14,0.08)',  label: 'Fence' },
  bushes:                      { stroke: '#15803d', fill: 'rgba(21,128,61,0.08)',  label: 'Bushes' },
  vegetation_touching_structure:{ stroke: '#dc2626', fill: 'rgba(220,38,38,0.10)', label: 'Veg. Touching Structure' },
  // Electrical/solar
  utility_meter:       { stroke: '#a855f7', fill: 'rgba(168,85,247,0.10)', label: 'Utility Meter' },
  main_service_panel:  { stroke: '#7c3aed', fill: 'rgba(124,58,237,0.10)', label: 'Main Panel' },
  disconnect:          { stroke: '#6d28d9', fill: 'rgba(109,40,217,0.10)', label: 'Disconnect' },
  conduit:             { stroke: '#8b5cf6', fill: 'rgba(139,92,246,0.08)', label: 'Conduit' },
  inverter:            { stroke: '#c084fc', fill: 'rgba(192,132,252,0.10)',label: 'Inverter' },
  battery:             { stroke: '#e879f9', fill: 'rgba(232,121,249,0.10)',label: 'Battery' },
  ac_unit:             { stroke: '#f472b6', fill: 'rgba(244,114,182,0.10)',label: 'AC Unit' },
  existing_solar_panel:{ stroke: '#fbbf24', fill: 'rgba(251,191,36,0.12)', label: 'Existing Solar' },
  // Occluder (gray, dashed — blocks view of structure)
  car:                { stroke: '#6b7280', fill: 'rgba(107,114,128,0.04)',label: 'Car' },
  truck:              { stroke: '#6b7280', fill: 'rgba(107,114,128,0.04)',label: 'Truck' },
  trailer:            { stroke: '#6b7280', fill: 'rgba(107,114,128,0.04)',label: 'Trailer' },
  person:             { stroke: '#6b7280', fill: 'rgba(107,114,128,0.04)',label: 'Person' },
  ladder:             { stroke: '#6b7280', fill: 'rgba(107,114,128,0.04)',label: 'Ladder' },
  trash_can:          { stroke: '#6b7280', fill: 'rgba(107,114,128,0.04)',label: 'Trash Can' },
  tools:              { stroke: '#6b7280', fill: 'rgba(107,114,128,0.04)',label: 'Tools' },
  temporary_materials:{ stroke: '#6b7280', fill: 'rgba(107,114,128,0.04)',label: 'Temp Materials' },
  // Condition (red flags — safety/quality issues)
  moss:            { stroke: '#ef4444', fill: 'rgba(239,68,68,0.10)', label: 'Moss' },
  algae:           { stroke: '#f87171', fill: 'rgba(248,113,113,0.08)',label: 'Algae' },
  damaged_siding:  { stroke: '#dc2626', fill: 'rgba(220,38,38,0.12)',  label: 'Damaged Siding' },
  blocked_access:  { stroke: '#b91c1c', fill: 'rgba(185,28,28,0.12)',  label: 'Blocked Access' },
  muddy_work_area: { stroke: '#991b1b', fill: 'rgba(153,27,27,0.12)',  label: 'Muddy Work Area' },
};

/**
 * Whether a segmentation class should render with dashed lines (occluder styling).
 */
function isOccluderClass(cls: SegmentationClass): boolean {
  return OCCLUDER_SEGMENTATION_CLASSES.has(cls);
}

/**
 * Whether a segmentation class is a condition flag (render with warning badge).
 */
function isConditionClass(cls: SegmentationClass): boolean {
  return CONDITION_SEGMENTATION_CLASSES.has(cls);
}


/**
 * Per-subtype styling for roof_line artifacts — DEFAULT (review-friendly) mode.
 * Thin, subtle lines that don't obscure the underlying photo.
 * Stroke widths are calibrated for SVG viewBox="0 0 100 100" (percentage coords):
 *   0.3 = 0.3% of image width — thin evidence line, review-friendly
 */
const ROOF_LINE_SUBTYPE_STYLES_DEFAULT: Record<
  string,
  { stroke: string; strokeWidth: number; strokeDasharray: string; label: string }
> = {
  ridge: {
    stroke: '#fb923c',    // vibrant orange — ridges are the most important line
    strokeWidth: 0.4,
    strokeDasharray: 'none',
    label: 'Ridge',
  },
  eave: {
    stroke: '#fbbf24',    // bright yellow — eaves are second most important
    strokeWidth: 0.35,
    strokeDasharray: 'none',
    label: 'Eave',
  },
  rake: {
    stroke: '#f59e0b',    // amber — rakes connect ridge to eave
    strokeWidth: 0.3,
    strokeDasharray: '1.5,0.8',
    label: 'Rake',
  },
  hip: {
    stroke: '#f97316',    // orange — hip lines
    strokeWidth: 0.4,
    strokeDasharray: '2,1',
    label: 'Hip',
  },
  valley: {
    stroke: '#ef4444',    // red — valleys are critical for drainage
    strokeWidth: 0.4,
    strokeDasharray: '1,1',
    label: 'Valley',
  },
  wall_vertical: {
    stroke: '#60a5fa',    // blue — wall edges
    strokeWidth: 0.3,
    strokeDasharray: '0.8,0.8',
    label: 'Wall Edge',
  },
};

/**
 * Per-subtype styling for roof_line artifacts — DEBUG mode.
 * Thick, highly visible lines for inspecting all raw line candidates.
 * Only shown when the user explicitly enables "Show debug roof-line candidates".
 */
const ROOF_LINE_SUBTYPE_STYLES_DEBUG: Record<
  string,
  { stroke: string; strokeWidth: number; strokeDasharray: string; label: string }
> = {
  ridge: {
    stroke: '#fb923c',
    strokeWidth: 1.5,
    strokeDasharray: 'none',
    label: 'Ridge',
  },
  eave: {
    stroke: '#fbbf24',
    strokeWidth: 1.2,
    strokeDasharray: 'none',
    label: 'Eave',
  },
  rake: {
    stroke: '#f59e0b',
    strokeWidth: 1.0,
    strokeDasharray: '4,2',
    label: 'Rake',
  },
  hip: {
    stroke: '#f97316',
    strokeWidth: 1.2,
    strokeDasharray: '6,3',
    label: 'Hip',
  },
  valley: {
    stroke: '#ef4444',
    strokeWidth: 1.2,
    strokeDasharray: '3,3',
    label: 'Valley',
  },
  wall_vertical: {
    stroke: '#60a5fa',
    strokeWidth: 1.0,
    strokeDasharray: '2,2',
    label: 'Wall Edge',
  },
};

/** Default roof line style when subtype is unknown — thin for review mode */
const DEFAULT_ROOF_LINE_STYLE = {
  stroke: '#fbbf24',
  strokeWidth: 0.3,
  strokeDasharray: '0.8,0.8',
  label: 'Roof Line',
};

/** Default roof line style for debug mode when subtype is unknown */
const DEFAULT_ROOF_LINE_STYLE_DEBUG = {
  stroke: '#fbbf24',
  strokeWidth: 1.0,
  strokeDasharray: '2,2',
  label: 'Roof Line',
};

/** Minimum confidence for a roof_line artifact to be rendered in the overlay
 *  when debug mode is active. Lower threshold shows all candidates. */
const MIN_ROOF_LINE_CONFIDENCE = 40;

/** Minimum confidence for a roof_line to be shown in default (non-debug) mode.
 *  Higher threshold so the default view only shows trusted geometry. */
const MIN_ROOF_LINE_CONFIDENCE_DEFAULT_MODE = 60;

/** Maximum number of roof_line artifacts to render per file in default mode. */
const MAX_ROOF_LINES_PER_FILE_DEFAULT = 20;

/** Maximum number of roof_line artifacts to render per file in debug mode. */
const MAX_ROOF_LINES_PER_FILE_DEBUG = 100;

/** Minimum distance (in normalized 0-1000 units) between line midpoints
 *  to consider them non-duplicate. Lines closer than this are near-duplicates. */
const DUPLICATE_LINE_MIN_DISTANCE = 40;

/** Minimum angle difference (degrees) between two lines at similar positions
 *  to consider them non-duplicate. */
const DUPLICATE_LINE_MIN_ANGLE_DIFF = 15;
const NORMALIZED_IMAGE_MAX = 1000;
const MAX_NON_BACKGROUND_POLYGON_AREA_RATIO = 0.95;

function warnInvalidOverlayGeometry(artifact: UnifiedGeometryArtifact, reason: string): void {
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.warn('[UnifiedGeometryOverlayRenderer] Skipping invalid overlay polygon', {
      artifactId: artifact.id,
      geometryClass: artifact.geometryClass,
      segmentationClass: artifact.segmentationClass,
      reason,
    });
  }
}

function clampNormalized(value: number): number {
  return Math.min(NORMALIZED_IMAGE_MAX, Math.max(0, value));
}

function polygonArea(vertices: Array<{ x: number; y: number }>): number {
  let sum = 0;
  for (let i = 0; i < vertices.length; i += 1) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

function sanitizePolygonVertices(
  artifact: UnifiedGeometryArtifact,
  vertices: Array<{ x: number; y: number; coordinateSystem?: string }>,
): Array<{ x: number; y: number; coordinateSystem: 'normalized_image_0_1000' }> | null {
  if (!Array.isArray(vertices) || vertices.length < 3) {
    warnInvalidOverlayGeometry(artifact, 'polygon has fewer than 3 points');
    return null;
  }

  const validVertices: Array<{ x: number; y: number; coordinateSystem: 'normalized_image_0_1000' }> = [];
  let sawOutOfBounds = false;

  for (const vertex of vertices) {
    if (!Number.isFinite(vertex.x) || !Number.isFinite(vertex.y)) {
      warnInvalidOverlayGeometry(artifact, 'polygon contains NaN or Infinity coordinates');
      return null;
    }

    if (vertex.x < 0 || vertex.x > NORMALIZED_IMAGE_MAX || vertex.y < 0 || vertex.y > NORMALIZED_IMAGE_MAX) {
      sawOutOfBounds = true;
    }

    const clamped = {
      x: clampNormalized(vertex.x),
      y: clampNormalized(vertex.y),
      coordinateSystem: 'normalized_image_0_1000' as const,
    };

    const previous = validVertices[validVertices.length - 1];
    if (!previous || previous.x !== clamped.x || previous.y !== clamped.y) {
      validVertices.push(clamped);
    }
  }

  if (validVertices.length > 2) {
    const first = validVertices[0];
    const last = validVertices[validVertices.length - 1];
    if (first.x === last.x && first.y === last.y) validVertices.pop();
  }

  if (validVertices.length < 3) {
    warnInvalidOverlayGeometry(artifact, 'polygon collapsed below 3 unique points after clamping');
    return null;
  }

  const xs = validVertices.map(v => v.x);
  const ys = validVertices.map(v => v.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  const bboxAreaRatio = (width * height) / (NORMALIZED_IMAGE_MAX * NORMALIZED_IMAGE_MAX);
  const areaRatio = polygonArea(validVertices) / (NORMALIZED_IMAGE_MAX * NORMALIZED_IMAGE_MAX);
  const isBackgroundLike = artifact.segmentationClass === 'sky' || artifact.segmentationClass === 'ground' || artifact.geometryClass === 'ground_plane';

  if (!isBackgroundLike && areaRatio > MAX_NON_BACKGROUND_POLYGON_AREA_RATIO) {
    warnInvalidOverlayGeometry(artifact, `polygon area too large: ${areaRatio.toFixed(3)}`);
    return null;
  }

  if (!isBackgroundLike && sawOutOfBounds && bboxAreaRatio > MAX_NON_BACKGROUND_POLYGON_AREA_RATIO) {
    warnInvalidOverlayGeometry(artifact, 'out-of-bounds polygon spans nearly the full image');
    return null;
  }

  return validVertices;
}

/* ── Near-duplicate roof line detection ────────────────────────────────────── */

/**
 * Compute the midpoint of a line segment (from artifact.lineSegment).
 * Returns null if the artifact has no lineSegment.
 */
function lineMidpoint(a: UnifiedGeometryArtifact): { x: number; y: number } | null {
  if (!a.lineSegment) return null;
  return {
    x: (a.lineSegment.start.x + a.lineSegment.end.x) / 2,
    y: (a.lineSegment.start.y + a.lineSegment.end.y) / 2,
  };
}

/**
 * Compute the angle of a line segment in degrees (0-180, undirected).
 * Returns null if the artifact has no lineSegment.
 */
function lineAngleDeg(a: UnifiedGeometryArtifact): number | null {
  if (!a.lineSegment) return null;
  const dx = a.lineSegment.end.x - a.lineSegment.start.x;
  const dy = a.lineSegment.end.y - a.lineSegment.start.y;
  let angle = Math.atan2(-dy, dx) * (180 / Math.PI);
  if (angle < 0) angle += 180;
  return angle % 180;
}

/**
 * Euclidean distance between two 2D points.
 */
function pointDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Given an array of roof_line artifacts sorted by confidence (descending),
 * remove near-duplicate lines. A line is a duplicate if another higher-confidence
 * line of the same subtype has a midpoint within DUPLICATE_LINE_MIN_DISTANCE
 * and an angle within DUPLICATE_LINE_MIN_ANGLE_DIFF.
 *
 * Returns a new array with duplicates removed.
 */
function deduplicateRoofLines(lines: UnifiedGeometryArtifact[]): UnifiedGeometryArtifact[] {
  if (lines.length <= 1) return lines;

  const kept: UnifiedGeometryArtifact[] = [];
  const keptMeta: Array<{ mid: { x: number; y: number }; angle: number; subtype: string | null }> = [];

  for (const line of lines) {
    const mid = lineMidpoint(line);
    const angle = lineAngleDeg(line);
    if (!mid || angle === null) {
      kept.push(line);
      continue;
    }

    const subtype = line.lineSubtype ?? null;
    let isDuplicate = false;

    for (const existing of keptMeta) {
      if (existing.subtype !== subtype) continue;

      const dist = pointDistance(mid, existing.mid);
      if (dist > DUPLICATE_LINE_MIN_DISTANCE) continue;

      let angleDiff = Math.abs(angle - existing.angle);
      if (angleDiff > 90) angleDiff = 180 - angleDiff;
      if (angleDiff < DUPLICATE_LINE_MIN_ANGLE_DIFF) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      kept.push(line);
      keptMeta.push({ mid, angle, subtype });
    }
  }

  return kept;
}

/* ── Geometry extraction helpers ─────────────────────────────────────── */

/**
 * Extract the SVG-renderable geometry from a UnifiedGeometryArtifact.
 * Priority: polygon > bbox-derived polygon > bbox rect. Also extracts lineSegment.
 *
 * For roof_plane and wall_plane artifacts that have a bbox but no polygon,
 * we derive a 4-vertex polygon from the bbox so they render as filled
 * polygon shapes instead of just rectangular outlines.
 */
function extractArtifactGeometry(artifact: UnifiedGeometryArtifact): {
  polygonSvg: SvgPercentPolygon | null;
  rectSvg: SvgPercentRect | null;
  lineSvg: SvgPercentLine | null;
} {
  let polygonSvg: SvgPercentPolygon | null = null;
  let rectSvg: SvgPercentRect | null = null;
  let lineSvg: SvgPercentLine | null = null;

  // Polygon (from Pipeline B segmentation/consensus, or Pipeline A with derived polygon)
  if (
    artifact.polygon &&
    Array.isArray(artifact.polygon.vertices) &&
    artifact.polygon.vertices.length >= 3
  ) {
    const safeVertices = sanitizePolygonVertices(artifact, artifact.polygon.vertices);
    polygonSvg = safeVertices ? normalizedPolygonToSvgPercent(safeVertices) : null;
  }

  // Bounding box — either as fallback rect, or derive polygon for plane artifacts
  if (!polygonSvg && artifact.bbox) {
    const isPlane =
      artifact.geometryClass === 'roof_plane' ||
      artifact.geometryClass === 'wall_plane' ||
      artifact.geometryClass === 'consensus_plane' ||
      artifact.geometryClass === 'ground_plane';

    if (isPlane) {
      // Derive a 4-vertex polygon from the bbox for plane-type artifacts
      // This makes them render as filled polygon shapes instead of just outlines
      const b = artifact.bbox;
      const derivedVertices = [
        { x: b.x, y: b.y },
        { x: b.x + b.width, y: b.y },
        { x: b.x + b.width, y: b.y + b.height },
        { x: b.x, y: b.y + b.height },
      ];
      const safeVertices = sanitizePolygonVertices(artifact, derivedVertices);
      polygonSvg = safeVertices ? normalizedPolygonToSvgPercent(safeVertices) : null;
    } else {
      // Non-plane artifacts: render as rect
      rectSvg = normalizedRegionToSvgPercent({
        x: artifact.bbox.x,
        y: artifact.bbox.y,
        width: artifact.bbox.width,
        height: artifact.bbox.height,
        coordinateSystem: 'normalized_image_0_1000',
      });
    }
  }

  // Line segment
  if (artifact.lineSegment) {
    const seg = artifact.lineSegment as GeometryLineSegment;
    lineSvg = normalizedLineToSvgPercent({
      x1: seg.start.x,
      y1: seg.start.y,
      x2: seg.end.x,
      y2: seg.end.y,
      orientation: 'diagonal' as const,
      strength: 1,
      coordinateSystem: 'normalized_image_0_1000',
    });
  }

  return { polygonSvg, rectSvg, lineSvg };
}

/* ── Main component ──────────────────────────────────────────────────── */

export function UnifiedGeometryOverlayRenderer({
  filesWithArtifacts,
  selectedFileId,
  onSelectFile,
  geometryClassFilter,
  showMockArtifacts = false,
  showDebugRoofLines = false,
  maxArtifactsPerFile = 200,
}: {
  filesWithArtifacts: FileWithUnifiedArtifacts[];
  selectedFileId: string | null;
  onSelectFile: (fileId: string | null) => void;
  /** Which geometry classes to show. Empty set = show all. */
  geometryClassFilter?: Set<UnifiedGeometryClass>;
  /** Whether to show mock artifacts. Default false. */
  showMockArtifacts?: boolean;
  /** Whether to show all roof-line candidates with thick debug rendering.
   *  Default false: only high-confidence, deduplicated lines shown thin. */
  showDebugRoofLines?: boolean;
  /** Max artifacts to render per file for performance. */
  maxArtifactsPerFile?: number;
}) {
  // Select style tables based on debug mode
  const ROOF_LINE_SUBTYPE_STYLES = showDebugRoofLines
    ? ROOF_LINE_SUBTYPE_STYLES_DEBUG
    : ROOF_LINE_SUBTYPE_STYLES_DEFAULT;
  const activeDefaultLineStyle = showDebugRoofLines
    ? DEFAULT_ROOF_LINE_STYLE_DEBUG
    : DEFAULT_ROOF_LINE_STYLE;

  // Effective confidence threshold and cap based on debug mode
  const effectiveMinConfidence = showDebugRoofLines
    ? MIN_ROOF_LINE_CONFIDENCE                    // 40 — show all candidates
    : MIN_ROOF_LINE_CONFIDENCE_DEFAULT_MODE;      // 60 — only trusted lines
  const effectiveMaxLines = showDebugRoofLines
    ? MAX_ROOF_LINES_PER_FILE_DEBUG               // 100
    : MAX_ROOF_LINES_PER_FILE_DEFAULT;            // 20

  // Filter and cap artifacts per file
  const filesWithDrawable = filesWithArtifacts
    .map((fw) => {
      let filtered = fw.artifacts.filter((a) => {
        // Skip mocks unless enabled
        if (a.authority?.mockArtifact && !showMockArtifacts) return false;
        // Skip if no drawable geometry at all
        if (!a.polygon && !a.bbox && !a.lineSegment) return false;
        // Apply class filter
        if (geometryClassFilter && geometryClassFilter.size > 0 && !geometryClassFilter.has(a.geometryClass))
          return false;
        // Filter low-confidence roof lines using effective threshold
        if (a.geometryClass === 'roof_line' && (a.confidence ?? 0) < effectiveMinConfidence) return false;
        return true;
      });

      // Deduplicate and cap roof lines per file
      let roofLinesInFile = filtered.filter(a => a.geometryClass === 'roof_line');
      const nonLineArtifacts = filtered.filter(a => a.geometryClass !== 'roof_line');

      if (roofLinesInFile.length > 0) {
        // Sort by confidence descending (highest confidence first)
        roofLinesInFile.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));

        // Remove near-duplicate lines (same subtype, similar position & angle)
        if (!showDebugRoofLines) {
          roofLinesInFile = deduplicateRoofLines(roofLinesInFile);
        }

        // Cap to max per file (keep highest confidence)
        if (roofLinesInFile.length > effectiveMaxLines) {
          roofLinesInFile = roofLinesInFile.slice(0, effectiveMaxLines);
        }
      }

      // Rebuild filtered list: non-line artifacts first, then capped roof lines
      const rebuiltFiltered = [...nonLineArtifacts, ...roofLinesInFile];
      const totalDrawable = rebuiltFiltered.length;
      const capped = rebuiltFiltered.slice(0, maxArtifactsPerFile);
      return { ...fw, artifacts: capped, totalDrawable, wasCapped: totalDrawable > maxArtifactsPerFile };
    })
    .filter((fw) => fw.artifacts.length > 0);

  if (filesWithDrawable.length === 0) {
    return (
      <div className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-4 text-center">
        <p className="text-[11px] text-slate-500">
          No unified geometry artifacts with drawable geometry.
        </p>
        <p className="text-[10px] text-slate-600 mt-1">
          Run the Geometry Reconstruction pipeline (Pipeline B) to generate roof plane polygons.
        </p>
      </div>
    );
  }

  const activeFile = selectedFileId
    ? filesWithDrawable.find((f) => f.fileId === selectedFileId)
    : filesWithDrawable[0];

  return (
    <div className="space-y-3">
      {/* File selector strip */}
      {filesWithDrawable.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {filesWithDrawable.map((fw) => (
            <button
              key={fw.fileId}
              type="button"
              onClick={() => onSelectFile(fw.fileId === selectedFileId ? null : fw.fileId)}
              className={`rounded-lg border px-2 py-1 text-[9px] font-medium transition ${
                fw.fileId === (activeFile?.fileId ?? '')
                  ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-100'
                  : 'border-slate-700 bg-slate-900/60 text-slate-400 hover:text-slate-200'
              }`}
            >
              {(fw.filename ?? fw.fileId).slice(0, 20)}
              <span className="ml-1 text-slate-500">
                ({fw.artifacts.length}{fw.wasCapped ? `/${fw.totalDrawable}` : ''})
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Overlay image viewer */}
      {activeFile && (
        <PhotoWithUnifiedOverlays
          fileUrl={activeFile.fileUrl}
          filename={activeFile.filename}
          artifacts={activeFile.artifacts}
          showDebugRoofLines={showDebugRoofLines}
        />
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 px-1">
        {(Object.keys(GEOMETRY_CLASS_OVERLAY_COLORS) as UnifiedGeometryClass[])
          .filter((cls) =>
            filesWithDrawable.some((fw) =>
              fw.artifacts.some((a) => a.geometryClass === cls),
            ),
          )
          .flatMap((cls) => {
            const color = GEOMETRY_CLASS_OVERLAY_COLORS[cls];
            const count = filesWithDrawable.reduce(
              (sum, fw) => sum + fw.artifacts.filter((a) => a.geometryClass === cls).length,
              0,
            );
            // For roof_line, expand into per-subtype legend entries
            if (cls === 'roof_line') {
              const subtypes = new Set<string>();
              filesWithDrawable.forEach(fw =>
                fw.artifacts
                  .filter(a => a.geometryClass === 'roof_line' && a.lineSubtype)
                  .forEach(a => subtypes.add(a.lineSubtype!))
              );
              const entries = subtypes.size > 0
                ? Array.from(subtypes).map(sub => {
                    const style = ROOF_LINE_SUBTYPE_STYLES[sub] ?? activeDefaultLineStyle;
                    const subCount = filesWithDrawable.reduce(
                      (sum, fw) => sum + fw.artifacts.filter(
                        a => a.geometryClass === 'roof_line' && a.lineSubtype === sub
                      ).length, 0
                    );
                    return (
                      <div key={`roof_line-${sub}`} className="flex items-center gap-1.5">
                        <span
                          className="inline-block h-2.5 w-5 rounded-sm"
                          style={{ backgroundColor: style.stroke }}
                        />
                        <span className="text-[9px] text-slate-400">
                          {style.label} ({subCount})
                        </span>
                      </div>
                    );
                  })
                : [(
                    <div key="roof_line-default" className="flex items-center gap-1.5">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-sm border"
                        style={{ borderColor: color.stroke, backgroundColor: color.fill }}
                      />
                      <span className="text-[9px] text-slate-400">
                        {color.label} ({count})
                      </span>
                    </div>
                  )];
              return entries;
            }
            // For segmentation_mask, expand into per-backend legend entries (SAM 2 vs Canny)
            if (cls === 'segmentation_mask') {
              const backends = new Set<SegmentationBackend | null>();
              filesWithDrawable.forEach(fw =>
                fw.artifacts
                  .filter(a => a.geometryClass === 'segmentation_mask')
                  .forEach(a => backends.add(a.segmentationBackend ?? null))
              );
              const entries = Array.from(backends).map(be => {
                const beColor = be && SEGMENTATION_BACKEND_COLORS[be]
                  ? SEGMENTATION_BACKEND_COLORS[be]
                  : color;
                const beCount = filesWithDrawable.reduce(
                  (sum, fw) => sum + fw.artifacts.filter(
                    a => a.geometryClass === 'segmentation_mask' && (a.segmentationBackend ?? null) === be
                  ).length, 0
                );
                const beLabel = be === 'sam2'
                  ? 'SAM 2 Seg'
                  : be === 'canny'
                    ? 'Canny Seg'
                    : 'Segmentation';
                return (
                  <div key={`segmentation_mask-${be ?? 'unknown'}`} className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-sm border"
                      style={{ borderColor: beColor.stroke, backgroundColor: beColor.fill }}
                    />
                    <span className="text-[9px] text-slate-400">
                      {beLabel} ({beCount})
                    </span>
                  </div>
                );
              });
              return entries;
            }
            return [(
              <div key={cls} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm border"
                  style={{ borderColor: color.stroke, backgroundColor: color.fill }}
                />
                <span className="text-[9px] text-slate-400">
                  {color.label} ({count})
                </span>
              </div>
            )];
          })}
      </div>

      {/* Debug toggle for roof-line candidates */}
      <div className="flex items-center gap-2 px-1 mt-1">
        <label className="flex items-center gap-1.5 cursor-pointer group">
          <span
            className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[9px] font-medium transition ${
              showDebugRoofLines
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                : 'bg-slate-800/50 text-slate-500 border border-slate-700/40'
            }`}
            title={showDebugRoofLines
              ? 'Debug mode: showing all roof-line candidates with thick rendering. Duplicates and low-confidence lines are visible.'
              : 'Default mode: only high-confidence, deduplicated roof lines shown thin. Toggle in parent component to see all candidates.'
            }
          >
            {showDebugRoofLines ? '🔍 Debug: All line candidates' : '📏 Review: Trusted lines only'}
          </span>
        </label>
        {showDebugRoofLines && (
          <span className="text-[8px] text-amber-400/60">
            Thick lines = debug mode. Low-conf & duplicates visible.
          </span>
        )}
      </div>
    </div>
  );
}

/* ── Single photo with SVG overlays from unified artifacts ─────────────────────── */

function PhotoWithUnifiedOverlays({
  fileUrl,
  filename,
  artifacts,
  showDebugRoofLines = false,
}: {
  fileUrl: string;
  filename: string | null;
  artifacts: UnifiedGeometryArtifact[];
  /** Whether to use thick debug rendering for roof lines. */
  showDebugRoofLines?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [imgNatural, setImgNatural] = useState<{ w: number; h: number } | null>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  // Select style tables based on debug mode
  const activeSubtypeStyles = showDebugRoofLines
    ? ROOF_LINE_SUBTYPE_STYLES_DEBUG
    : ROOF_LINE_SUBTYPE_STYLES_DEFAULT;
  const activeDefaultStyle = showDebugRoofLines
    ? DEFAULT_ROOF_LINE_STYLE_DEBUG
    : DEFAULT_ROOF_LINE_STYLE;

  const handleImgLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setImgNatural({ w: img.naturalWidth, h: img.naturalHeight });
  }, []);

  // Pre-compute overlay geometry for each artifact
  const overlayElements: Array<{
    artifact: UnifiedGeometryArtifact;
    color: { stroke: string; fill: string; label: string };
    polygonSvg: SvgPercentPolygon | null;
    rectSvg: SvgPercentRect | null;
    lineSvg: SvgPercentLine | null;
  }> = [];

  for (const artifact of artifacts) {
    // Color selection priority:
    //   1. Per-segmentationClass color (most specific)
    //   2. Per-backend color (SAM 2 vs Canny)
    //   3. Per-geometryClass default
    const isSegMask = artifact.geometryClass === 'segmentation_mask';
    const segClass = artifact.segmentationClass as SegmentationClass | null;
    const defaultColor = GEOMETRY_CLASS_OVERLAY_COLORS[artifact.geometryClass] ?? GEOMETRY_CLASS_OVERLAY_COLORS.unknown;
    // Try per-class color first, then backend color, then geometry class default
    const perClassColor = isSegMask && segClass && SEGMENTATION_CLASS_COLORS[segClass]
      ? SEGMENTATION_CLASS_COLORS[segClass]
      : null;
    const backendColor = isSegMask && artifact.segmentationBackend && SEGMENTATION_BACKEND_COLORS[artifact.segmentationBackend]
      ? SEGMENTATION_BACKEND_COLORS[artifact.segmentationBackend]
      : null;
    const color = perClassColor ?? backendColor ?? defaultColor;
    const geometry = extractArtifactGeometry(artifact);
    overlayElements.push({
      artifact,
      color,
      ...geometry,
    });
  }

  return (
    <div
      ref={containerRef}
      className="relative rounded-xl overflow-hidden border border-emerald-500/30 bg-slate-900"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={fileUrl}
        alt={filename ?? 'Survey photo with geometry overlays'}
        onLoad={handleImgLoad}
        className="w-full h-auto block"
        loading="lazy"
      />

      {/* SVG overlay layer */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ mixBlendMode: 'normal' }}
      >
        {overlayElements.map((entry, idx) => {
          const isHovered = hoveredIdx === idx;
          const isRoofLine = entry.artifact.geometryClass === 'roof_line';
          // Per-subtype roof line styling — thin in review mode, thick in debug mode
          const lineSubtype = entry.artifact.lineSubtype ?? null;
          const lineStyle = isRoofLine && lineSubtype
            ? (activeSubtypeStyles[lineSubtype] ?? activeDefaultStyle)
            : isRoofLine
              ? activeDefaultStyle
              : null;
          const strokeWidth = isHovered
            ? lineStyle
              ? lineStyle.strokeWidth + 1.0
              : 0.6
            : lineStyle
              ? lineStyle.strokeWidth
              : 0.35;
          const lineStroke = lineStyle?.stroke ?? entry.color.stroke;
          const lineDash = lineStyle?.strokeDasharray ?? 'none';
          const fillOpacity = isHovered ? 0.2 : undefined;
          const strokeDash = entry.artifact.authority?.mockArtifact ? '1,1'
            : entry.artifact.isOccluder ? '6,3'  // Dashed lines for occluders
            : 'none';
          // Condition flag badge: show ⚠ for condition annotations
          const hasConditionFlags = entry.artifact.conditionFlags && entry.artifact.conditionFlags.length > 0;
          const isOccluderMask = entry.artifact.isOccluder === true;

          return (
            <g key={entry.artifact.id}>
              {/* Polygon (real roof geometry from Pipeline B) */}
              {entry.polygonSvg && (
                <polygon
                  points={entry.polygonSvg.points}
                  fill={isRoofLine ? 'none' : entry.color.stroke}
                  fillOpacity={fillOpacity ?? (isRoofLine ? 0 : 0.12)}
                  stroke={lineStroke}
                  strokeWidth={strokeWidth}
                  strokeDasharray={lineDash}
                  style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                  onMouseEnter={() => setHoveredIdx(idx)}
                  onMouseLeave={() => setHoveredIdx(null)}
                />
              )}

              {/* Bounding box (fallback when no polygon) */}
              {!entry.polygonSvg && entry.rectSvg && (
                <rect
                  x={entry.rectSvg.x}
                  y={entry.rectSvg.y}
                  width={entry.rectSvg.width}
                  height={entry.rectSvg.height}
                  fill={isRoofLine ? 'none' : entry.color.stroke}
                  fillOpacity={fillOpacity ?? (isRoofLine ? 0 : 0.06)}
                  stroke={lineStroke}
                  strokeWidth={strokeWidth}
                  strokeDasharray={lineDash}
                  rx={0.2}
                  style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                  onMouseEnter={() => setHoveredIdx(idx)}
                  onMouseLeave={() => setHoveredIdx(null)}
                />
              )}

              {/* Line segment - thick colored lines for roof edges */}
              {entry.lineSvg && (() => {
                const isRL = entry.artifact.geometryClass === 'roof_line';
                const lSub = entry.artifact.lineSubtype ?? null;
                const ls = isRL && lSub
                  ? (activeSubtypeStyles[lSub] ?? activeDefaultStyle)
                  : isRL
                    ? activeDefaultStyle
                    : null;
                const lsColor = ls?.stroke ?? entry.color.stroke;
                const lsWidth = ls
                  ? (isHovered ? ls.strokeWidth + 1.0 : ls.strokeWidth)
                  : (isHovered ? 0.8 : 0.5);
                const lsDash = ls?.strokeDasharray ?? strokeDash;
                return (
                  <g>
                    {/* Outer glow / outline — only in debug mode for visibility on any background */}
                    {showDebugRoofLines && (
                      <line
                        x1={entry.lineSvg.x1}
                        y1={entry.lineSvg.y1}
                        x2={entry.lineSvg.x2}
                        y2={entry.lineSvg.y2}
                        stroke="rgba(0,0,0,0.5)"
                        strokeWidth={lsWidth + 0.5}
                        strokeLinecap="round"
                        style={{ pointerEvents: 'none' }}
                      />
                    )}
                    {/* Main colored line */}
                    <line
                      x1={entry.lineSvg.x1}
                      y1={entry.lineSvg.y1}
                      x2={entry.lineSvg.x2}
                      y2={entry.lineSvg.y2}
                      stroke={lsColor}
                      strokeWidth={lsWidth}
                      strokeDasharray={lsDash}
                      strokeLinecap="round"
                      style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                      onMouseEnter={() => setHoveredIdx(idx)}
                      onMouseLeave={() => setHoveredIdx(null)}
                    />
                  </g>
                );
              })()}
            </g>
          );
        })}
      </svg>

      {/* Hover tooltip — rich details for plane and line artifacts */}
      {hoveredIdx !== null && overlayElements[hoveredIdx] && (() => {
        const entry = overlayElements[hoveredIdx];
        const a = entry.artifact;
        const isRoofPlane = a.geometryClass === 'roof_plane' || a.geometryClass === 'wall_plane' || a.geometryClass === 'consensus_plane';
        const isRoofLine = a.geometryClass === 'roof_line';
        const lineStyle = isRoofLine && a.lineSubtype
          ? (activeSubtypeStyles[a.lineSubtype] ?? activeDefaultStyle)
          : null;

        return (
          <div className="absolute bottom-2 left-2 right-2 rounded-lg border border-slate-700 bg-slate-900/95 p-2 backdrop-blur-sm z-10">
            {/* Header row: class + confidence + badges */}
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="inline-block h-2 w-2 rounded-sm flex-shrink-0"
                style={{ backgroundColor: lineStyle?.stroke ?? entry.color.stroke }}
              />
              <span className="text-[10px] font-semibold text-slate-200">
                {isRoofPlane && a.roofPlaneId
                  ? `${a.geometryClass.replace(/_/g, ' ')} #${a.roofPlaneId.replace(/solar-plane-/, '')}`
                  : a.geometryClass.replace(/_/g, ' ')}
              </span>
              <span className="text-[10px] text-slate-500">
                {Math.round(a.confidence)}% conf
              </span>
              {a.lineSubtype && (
                <span className="text-[9px] text-amber-300 border border-amber-500/30 rounded px-1">
                  {lineStyle?.label ?? a.lineSubtype}
                </span>
              )}
              {a.planeType && (
                <span className="text-[9px] text-emerald-300 border border-emerald-500/30 rounded px-1">
                  {a.planeType}
                </span>
              )}
              {a.authority?.mockArtifact ? (
                <span className="text-[9px] text-red-300 border border-red-500/30 rounded px-1">
                  MOCK
                </span>
              ) : (
                <span className="text-[9px] text-slate-400 border border-slate-600/30 rounded px-1">
                  {a.authority?.state?.replace(/_/g, ' ') ?? 'unknown'}
                </span>
              )}
              {/* Occluder badge */}
              {a.isOccluder && (
                <span className="text-[9px] text-gray-400 border border-gray-500/30 rounded px-1">
                  OCCLUDER
                </span>
              )}
              {/* Condition flag badges */}
              {a.conditionFlags && a.conditionFlags.map((flag, fi) => (
                <span key={fi} className="text-[9px] text-red-300 border border-red-500/30 rounded px-1">
                  ⚠ {flag.replace(/_/g, ' ')}
                </span>
              ))}
              {/* Segmentation class badge for segmentation_mask */}
              {a.geometryClass === 'segmentation_mask' && a.segmentationClass && (
                <span className="text-[9px] text-cyan-300 border border-cyan-500/30 rounded px-1">
                  {a.segmentationClass.replace(/_/g, ' ')}
                </span>
              )}
              {/* Facade/site context subtype badges */}
              {a.facadeSubtype && (
                <span className="text-[9px] text-amber-300 border border-amber-500/30 rounded px-1">
                  {a.facadeSubtype.replace(/_/g, ' ')}
                </span>
              )}
              {a.siteContextSubtype && (
                <span className="text-[9px] text-lime-300 border border-lime-500/30 rounded px-1">
                  {a.siteContextSubtype.replace(/_/g, ' ')}
                </span>
              )}
            </div>

            {/* Plane-specific details: pitch, azimuth, area, vertices */}
            {isRoofPlane && (
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[9px] text-slate-400">
                {a.pitchDegrees != null && (
                  <span className="text-slate-300">Pitch: <span className="text-emerald-300">{a.pitchDegrees}°</span></span>
                )}
                {a.azimuthDegrees != null && (
                  <span className="text-slate-300">Azimuth: <span className="text-emerald-300">{a.azimuthDegrees}°</span></span>
                )}
                {a.areaSqM != null && (
                  <span className="text-slate-300">Area: <span className="text-emerald-300">{a.areaSqM.toFixed(1)} m²</span></span>
                )}
                {a.polygon?.vertices != null && (
                  <span className="text-slate-300">Vertices: <span className="text-slate-200">{a.polygon.vertices.length}</span></span>
                )}
                {a.inlierCount != null && (
                  <span className="text-slate-300">Inliers: <span className="text-slate-200">{a.inlierCount}/{a.totalPoints}</span></span>
                )}
                {a.consensusPhotoCount != null && (
                  <span className="text-slate-300">Photos: <span className="text-slate-200">{a.consensusPhotoCount}</span></span>
                )}
                {a.isSynthetic && (
                  <span className="text-amber-400">⚠ Synthetic</span>
                )}
              </div>
            )}

            {/* Line-specific details: subtype, confidence, length */}
            {isRoofLine && (
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[9px] text-slate-400">
                {a.lineSubtype && (
                  <span className="text-slate-300">Type: <span className="text-amber-300">{lineStyle?.label ?? a.lineSubtype}</span></span>
                )}
                <span className="text-slate-300">Confidence: <span className="text-amber-300">{Math.round(a.confidence)}%</span></span>
                {a.estimatedLengthM != null && (
                  <span className="text-slate-300">Length: <span className="text-amber-300">{a.estimatedLengthM.toFixed(1)} m</span></span>
                )}
                {a.isSynthetic && (
                  <span className="text-amber-400">⚠ Synthetic</span>
                )}
              </div>
            )}

            {/* Non-plane/non-line: generic details */}
            {!isRoofPlane && !isRoofLine && (
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[9px] text-slate-500">
                {a.segmentationBackend && (
                  <span className="text-slate-300">
                    Backend: <span className={a.segmentationBackend === 'sam2' ? 'text-emerald-300' : 'text-cyan-300'}>
                      {a.segmentationBackend === 'sam2' ? 'SAM 2' : 'Canny'}
                    </span>
                  </span>
                )}
                {a.areaSqM != null && (
                  <span>Area: {a.areaSqM.toFixed(1)} m²</span>
                )}
                {a.estimatedLengthM != null && (
                  <span>Length: {a.estimatedLengthM.toFixed(1)} m</span>
                )}
                {a.isSynthetic && (
                  <span className="text-amber-400">⚠ Synthetic</span>
                )}
              </div>
            )}

            <p className="mt-0.5 text-[9px] text-slate-600">
              Source: {a.provenance?.sourcePipeline ?? 'unknown'} / {a.provenance?.toolName ?? 'unknown'} · REVIEW-ONLY / NON-AUTHORITATIVE
            </p>
          </div>
        );
      })()}
    </div>
  );
}

/**
 * Build `FileWithUnifiedArtifacts[]` from unified artifacts and survey files.
 * Groups artifacts by their source file ID and attaches file metadata.
 */
export function buildFilesWithUnifiedArtifacts(
  artifacts: UnifiedGeometryArtifact[],
  surveyFiles: Array<{ id: string; fileUrl: string; filename: string | null }>,
): FileWithUnifiedArtifacts[] {
  const fileMap = new Map(surveyFiles.map((f) => [f.id, f]));

  const grouped = new Map<string, FileWithUnifiedArtifacts>();
  for (const artifact of artifacts) {
    // An artifact may be associated with one or more source files.
    // Use the first sourceFileId as the primary grouping key.
    const fileId = artifact.provenance?.sourceFileIds?.[0];
    if (!fileId) continue; // Skip artifacts with no file association

    if (!grouped.has(fileId)) {
      const surveyFile = fileMap.get(fileId);
      grouped.set(fileId, {
        fileId,
        fileUrl: surveyFile?.fileUrl ?? '',
        filename: surveyFile?.filename ?? null,
        artifacts: [],
      });
    }
    grouped.get(fileId)!.artifacts.push(artifact);
  }

  return Array.from(grouped.values());
}
