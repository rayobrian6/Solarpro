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
} from '@/lib/siteSurveys/unifiedGeometry/types';

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
    polygonSvg = normalizedPolygonToSvgPercent(artifact.polygon.vertices);
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
      polygonSvg = normalizedPolygonToSvgPercent(derivedVertices);
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
  maxArtifactsPerFile = 200,
}: {
  filesWithArtifacts: FileWithUnifiedArtifacts[];
  selectedFileId: string | null;
  onSelectFile: (fileId: string | null) => void;
  /** Which geometry classes to show. Empty set = show all. */
  geometryClassFilter?: Set<UnifiedGeometryClass>;
  /** Whether to show mock artifacts. Default false. */
  showMockArtifacts?: boolean;
  /** Max artifacts to render per file for performance. */
  maxArtifactsPerFile?: number;
}) {
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
        return true;
      });
      const totalDrawable = filtered.length;
      const capped = filtered.slice(0, maxArtifactsPerFile);
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
          .map((cls) => {
            const color = GEOMETRY_CLASS_OVERLAY_COLORS[cls];
            const count = filesWithDrawable.reduce(
              (sum, fw) => sum + fw.artifacts.filter((a) => a.geometryClass === cls).length,
              0,
            );
            return (
              <div key={cls} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm border"
                  style={{ borderColor: color.stroke, backgroundColor: color.fill }}
                />
                <span className="text-[9px] text-slate-400">
                  {color.label} ({count})
                </span>
              </div>
            );
          })}
      </div>
    </div>
  );
}

/* ── Single photo with SVG overlays from unified artifacts ──────────── */

function PhotoWithUnifiedOverlays({
  fileUrl,
  filename,
  artifacts,
}: {
  fileUrl: string;
  filename: string | null;
  artifacts: UnifiedGeometryArtifact[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [imgNatural, setImgNatural] = useState<{ w: number; h: number } | null>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

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
    const color = GEOMETRY_CLASS_OVERLAY_COLORS[artifact.geometryClass] ?? GEOMETRY_CLASS_OVERLAY_COLORS.unknown;
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
          const strokeWidth = isHovered
            ? isRoofLine
              ? 0.8
              : 0.6
            : isRoofLine
              ? 0.5
              : 0.35;
          const fillOpacity = isHovered ? 0.2 : undefined;
          const strokeDash = entry.artifact.authority?.mockArtifact ? '1,1' : 'none';

          return (
            <g key={entry.artifact.id}>
              {/* Polygon (real roof geometry from Pipeline B) */}
              {entry.polygonSvg && (
                <polygon
                  points={entry.polygonSvg.points}
                  fill={entry.color.stroke}
                  fillOpacity={fillOpacity ?? 0.12}
                  stroke={entry.color.stroke}
                  strokeWidth={strokeWidth}
                  strokeDasharray={strokeDash}
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
                  fill={entry.color.stroke}
                  fillOpacity={fillOpacity ?? 0.06}
                  stroke={entry.color.stroke}
                  strokeWidth={strokeWidth}
                  strokeDasharray={strokeDash}
                  rx={0.2}
                  style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                  onMouseEnter={() => setHoveredIdx(idx)}
                  onMouseLeave={() => setHoveredIdx(null)}
                />
              )}

              {/* Line segment */}
              {entry.lineSvg && (
                <line
                  x1={entry.lineSvg.x1}
                  y1={entry.lineSvg.y1}
                  x2={entry.lineSvg.x2}
                  y2={entry.lineSvg.y2}
                  stroke={entry.color.stroke}
                  strokeWidth={isHovered ? 0.8 : 0.5}
                  strokeDasharray={strokeDash}
                  style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                  onMouseEnter={() => setHoveredIdx(idx)}
                  onMouseLeave={() => setHoveredIdx(null)}
                />
              )}
            </g>
          );
        })}
      </svg>

      {/* Hover tooltip */}
      {hoveredIdx !== null && overlayElements[hoveredIdx] && (
        <div className="absolute bottom-2 left-2 right-2 rounded-lg border border-slate-700 bg-slate-900/95 p-2 backdrop-blur-sm z-10">
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2 w-2 rounded-sm"
              style={{ backgroundColor: overlayElements[hoveredIdx].color.stroke }}
            />
            <span className="text-[10px] font-semibold text-slate-200">
              {overlayElements[hoveredIdx].artifact.geometryClass.replace(/_/g, ' ')}
            </span>
            <span className="text-[10px] text-slate-500">
              {Math.round(overlayElements[hoveredIdx].artifact.confidence)}% conf
            </span>
            {overlayElements[hoveredIdx].artifact.lineSubtype && (
              <span className="text-[9px] text-amber-300 border border-amber-500/30 rounded px-1">
                {overlayElements[hoveredIdx].artifact.lineSubtype}
              </span>
            )}
            {overlayElements[hoveredIdx].artifact.planeType && (
              <span className="text-[9px] text-emerald-300 border border-emerald-500/30 rounded px-1">
                {overlayElements[hoveredIdx].artifact.planeType}
              </span>
            )}
            {overlayElements[hoveredIdx].artifact.authority?.mockArtifact ? (
              <span className="text-[9px] text-red-300 border border-red-500/30 rounded px-1">
                MOCK
              </span>
            ) : (
              <span className="text-[9px] text-slate-400 border border-slate-600/30 rounded px-1">
                {overlayElements[hoveredIdx].artifact.authority?.state?.replace(/_/g, ' ') ?? 'unknown'}
              </span>
            )}
          </div>

          {/* Extra details */}
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[9px] text-slate-500">
            {overlayElements[hoveredIdx].artifact.pitchDegrees != null && (
              <span>Pitch: {overlayElements[hoveredIdx].artifact.pitchDegrees}°</span>
            )}
            {overlayElements[hoveredIdx].artifact.azimuthDegrees != null && (
              <span>Azimuth: {overlayElements[hoveredIdx].artifact.azimuthDegrees}°</span>
            )}
            {overlayElements[hoveredIdx].artifact.areaSqM != null && (
              <span>Area: {overlayElements[hoveredIdx].artifact.areaSqM.toFixed(1)} m²</span>
            )}
            {overlayElements[hoveredIdx].artifact.estimatedLengthM != null && (
              <span>Length: {overlayElements[hoveredIdx].artifact.estimatedLengthM.toFixed(1)} m</span>
            )}
            {overlayElements[hoveredIdx].artifact.inlierCount != null && (
              <span>Inliers: {overlayElements[hoveredIdx].artifact.inlierCount}/{overlayElements[hoveredIdx].artifact.totalPoints}</span>
            )}
            {overlayElements[hoveredIdx].artifact.consensusPhotoCount != null && (
              <span>Photos: {overlayElements[hoveredIdx].artifact.consensusPhotoCount}</span>
            )}
            {overlayElements[hoveredIdx].artifact.isSynthetic && (
              <span className="text-amber-400">⚠ Synthetic</span>
            )}
          </div>

          <p className="mt-0.5 text-[9px] text-slate-600">
            Source: {overlayElements[hoveredIdx].artifact.provenance?.sourcePipeline ?? 'unknown'} / {overlayElements[hoveredIdx].artifact.provenance?.toolName ?? 'unknown'} · REVIEW-ONLY / NON-AUTHORITATIVE
          </p>
        </div>
      )}
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
