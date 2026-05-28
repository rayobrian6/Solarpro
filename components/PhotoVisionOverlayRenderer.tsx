'use client';

/**
 * PhotoVisionOverlayRenderer — renders geometric overlays on survey photos.
 *
 * This component displays survey photos with SVG overlay rectangles/lines
 * derived from persisted `open_source_photo_vision_candidates` whose
 * `payload.region` or `payload.bbox` contain `normalized_image_0_1000`
 * geometry.
 *
 * Supports two overlay modes:
 *   - "raw"     — renders persisted candidates directly (for debugging)
 *   - "refined" — renders the geometry refinement pipeline output (cleaner,
 *                 deduplicated, classified, scored)
 *
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 * These overlays are operator review aids only. They must not be used as
 * canonical evidence, CAD geometry, permit input, BOM input, or engineering
 * workflow state.
 */

import { useState, useRef, useCallback } from 'react';
import {
  extractDrawableRegion,
  extractDrawableLine,
  hasDrawableGeometry,
  normalizedRegionToSvgPercent,
  normalizedLineToSvgPercent,
  classifyCandidateForFilter,
  candidatesPassOverlayFilter,
  type OverlayFilterCategory,
} from '@/lib/assistedEvidenceSources/overlayCoordinateConversion';
import type { RefinedCandidate, RefinedGeometryClass } from '@/lib/assistedEvidenceSources/geometryRefinement';

/* ── Types ────────────────────────────────────────────────────────────── */

interface OverlayCandidate {
  id: string;
  fileId: string;
  candidateType: string;
  candidateCategory: string;
  payload: Record<string, unknown>;
  confidence: number;
  reviewStatus: string;
  thumbnailDataUrl: string | null;
}

interface FileWithOverlays {
  fileId: string;
  fileUrl: string;
  filename: string | null;
  candidates: OverlayCandidate[];
}

/** A file grouped with its refined candidates for the refined overlay mode. */
export interface FileWithRefinedOverlays {
  fileId: string;
  fileUrl: string;
  filename: string | null;
  refinedCandidates: RefinedCandidate[];
}

/** Overlay display mode: raw candidates or refined geometry preview. */
export type OverlayMode = 'raw' | 'refined';

/* ── Color scheme by category (raw mode) ─────────────────────────────── */

const CATEGORY_COLORS: Record<OverlayFilterCategory, { stroke: string; fill: string; label: string }> = {
  cv: { stroke: '#22d3ee', fill: 'rgba(34,211,238,0.08)', label: 'CV' },
  yolo: { stroke: '#a78bfa', fill: 'rgba(167,139,250,0.08)', label: 'YOLO' },
  ocr: { stroke: '#fbbf24', fill: 'rgba(251,191,36,0.08)', label: 'OCR' },
  other: { stroke: '#94a3b8', fill: 'rgba(148,163,184,0.06)', label: 'Other' },
};

/* ── Color scheme by geometry class (refined mode) ────────────────────── */

const GEOMETRY_CLASS_COLORS: Record<RefinedGeometryClass, { stroke: string; fill: string; label: string }> = {
  probable_roof_plane: { stroke: '#34d399', fill: 'rgba(52,211,153,0.10)', label: 'Roof' },
  probable_wall_plane: { stroke: '#60a5fa', fill: 'rgba(96,165,250,0.10)', label: 'Wall' },
  probable_equipment: { stroke: '#f472b6', fill: 'rgba(244,114,182,0.10)', label: 'Equip' },
  probable_obstruction: { stroke: '#fb923c', fill: 'rgba(251,146,60,0.10)', label: 'Obstruct' },
  probable_ground_noise: { stroke: '#6b7280', fill: 'rgba(107,114,128,0.06)', label: 'Noise' },
  probable_text_label: { stroke: '#fbbf24', fill: 'rgba(251,191,36,0.08)', label: 'Text' },
  unknown: { stroke: '#94a3b8', fill: 'rgba(148,163,184,0.06)', label: '?' },
};

/* ── Main component ───────────────────────────────────────────────────── */

export function PhotoVisionOverlayRenderer({
  filesWithOverlays,
  refinedFilesWithOverlays,
  candidateFilter,
  overlayMode,
  selectedFileId,
  onSelectFile,
}: {
  filesWithOverlays: FileWithOverlays[];
  refinedFilesWithOverlays: FileWithRefinedOverlays[];
  candidateFilter: 'both' | 'opencv' | 'yolo' | 'ocr';
  overlayMode: OverlayMode;
  selectedFileId: string | null;
  onSelectFile: (fileId: string | null) => void;
}) {
  if (overlayMode === 'refined') {
    return (
      <RefinedOverlayView
        refinedFiles={refinedFilesWithOverlays}
        selectedFileId={selectedFileId}
        onSelectFile={onSelectFile}
      />
    );
  }

  // ── Raw mode ──
  const filesWithDrawableCandidates = filesWithOverlays
    .map((fw) => ({
      ...fw,
      candidates: fw.candidates.filter(
        (c) =>
          hasDrawableGeometry(c.payload) &&
          candidatesPassOverlayFilter(c.candidateType, c.payload, candidateFilter),
      ),
    }))
    .filter((fw) => fw.candidates.length > 0);

  if (filesWithDrawableCandidates.length === 0) {
    return (
      <div className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-4 text-center">
        <p className="text-[11px] text-slate-500">
          No candidates with drawable geometry match the current filter.
        </p>
      </div>
    );
  }

  const activeFile = selectedFileId
    ? filesWithDrawableCandidates.find((f) => f.fileId === selectedFileId)
    : filesWithDrawableCandidates[0];

  return (
    <div className="space-y-3">
      {/* File selector strip */}
      {filesWithDrawableCandidates.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {filesWithDrawableCandidates.map((fw) => (
            <button
              key={fw.fileId}
              type="button"
              onClick={() => onSelectFile(fw.fileId === selectedFileId ? null : fw.fileId)}
              className={`rounded-lg border px-2 py-1 text-[9px] font-medium transition ${
                fw.fileId === (activeFile?.fileId ?? '')
                  ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-100'
                  : 'border-slate-700 bg-slate-900/60 text-slate-400 hover:text-slate-200'
              }`}
            >
              {(fw.filename ?? fw.fileId).slice(0, 20)}
              <span className="ml-1 text-slate-500">({fw.candidates.length})</span>
            </button>
          ))}
        </div>
      )}

      {/* Overlay image viewer */}
      {activeFile && (
        <PhotoWithOverlays
          fileUrl={activeFile.fileUrl}
          filename={activeFile.filename}
          candidates={activeFile.candidates}
          candidateFilter={candidateFilter}
        />
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 px-1">
        {(['cv', 'yolo', 'ocr'] as OverlayFilterCategory[]).map((cat) => {
          const color = CATEGORY_COLORS[cat];
          const count = filesWithDrawableCandidates.reduce(
            (sum, fw) =>
              sum +
              fw.candidates.filter(
                (c) => classifyCandidateForFilter(c.candidateType, c.payload) === cat,
              ).length,
            0,
          );
          if (count === 0) return null;
          return (
            <div key={cat} className="flex items-center gap-1.5">
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

/* ── Refined overlay view ─────────────────────────────────────────────── */

function RefinedOverlayView({
  refinedFiles,
  selectedFileId,
  onSelectFile,
}: {
  refinedFiles: FileWithRefinedOverlays[];
  selectedFileId: string | null;
  onSelectFile: (fileId: string | null) => void;
}) {
  const filesWithCandidates = refinedFiles.filter((f) => f.refinedCandidates.length > 0);

  if (filesWithCandidates.length === 0) {
    return (
      <div className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-4 text-center">
        <p className="text-[11px] text-slate-500">
          No refined geometry candidates available. Run the pipeline with raw candidates first.
        </p>
      </div>
    );
  }

  const activeFile = selectedFileId
    ? filesWithCandidates.find((f) => f.fileId === selectedFileId)
    : filesWithCandidates[0];

  return (
    <div className="space-y-3">
      {/* File selector strip */}
      {filesWithCandidates.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {filesWithCandidates.map((fw) => (
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
              <span className="ml-1 text-slate-500">({fw.refinedCandidates.length})</span>
            </button>
          ))}
        </div>
      )}

      {/* Refined overlay image viewer */}
      {activeFile && (
        <PhotoWithRefinedOverlays
          fileUrl={activeFile.fileUrl}
          filename={activeFile.filename}
          refinedCandidates={activeFile.refinedCandidates}
        />
      )}

      {/* Legend for geometry classes */}
      <div className="flex flex-wrap items-center gap-3 px-1">
        {(Object.keys(GEOMETRY_CLASS_COLORS) as RefinedGeometryClass[]).map((cls) => {
          const color = GEOMETRY_CLASS_COLORS[cls];
          const count = filesWithCandidates.reduce(
            (sum, fw) => sum + fw.refinedCandidates.filter((c) => c.geometryClass === cls).length,
            0,
          );
          if (count === 0) return null;
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

/* ── Single photo with SVG overlays (raw mode) ────────────────────────── */

function PhotoWithOverlays({
  fileUrl,
  filename,
  candidates,
  candidateFilter,
}: {
  fileUrl: string;
  filename: string | null;
  candidates: OverlayCandidate[];
  candidateFilter: 'both' | 'opencv' | 'yolo' | 'ocr';
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [imgNatural, setImgNatural] = useState<{ w: number; h: number } | null>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const handleImgLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setImgNatural({ w: img.naturalWidth, h: img.naturalHeight });
  }, []);

  // Compute overlay elements
  const overlayElements: Array<{
    candidate: OverlayCandidate;
    category: OverlayFilterCategory;
    regionSvg?: { x: number; y: number; width: number; height: number };
    lineSvg?: { x1: number; y1: number; x2: number; y2: number };
    ocrText?: string;
  }> = [];

  for (const candidate of candidates) {
    const category = classifyCandidateForFilter(candidate.candidateType, candidate.payload);
    const entry: (typeof overlayElements)[number] = { candidate, category };

    const region = extractDrawableRegion(candidate.payload);
    if (region) {
      entry.regionSvg = normalizedRegionToSvgPercent(region);
    }

    const line = extractDrawableLine(candidate.payload);
    if (line) {
      entry.lineSvg = normalizedLineToSvgPercent(line);
    }

    // Extract OCR text for tooltip
    if (candidate.candidateType === 'ocr_text') {
      const p = candidate.payload;
      entry.ocrText = String(
        p.ocrText ?? p.cleanedText ?? p.text ?? '',
      ).slice(0, 120);
    }

    overlayElements.push(entry);
  }

  return (
    <div
      ref={containerRef}
      className="relative rounded-xl overflow-hidden border border-slate-700/60 bg-slate-900"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={fileUrl}
        alt={filename ?? 'Survey photo with overlays'}
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
          const color = CATEGORY_COLORS[entry.category];
          const isHovered = hoveredIdx === idx;
          const isReviewRequired = entry.candidate.reviewStatus === 'review_required';
          const strokeDash = isReviewRequired ? '1.5,1' : 'none';
          const strokeWidth = isHovered ? 0.6 : 0.35;
          const fillOpacity = isHovered ? 0.15 : 0.06;

          return (
            <g key={entry.candidate.id}>
              {/* Region rectangle */}
              {entry.regionSvg && (
                <rect
                  x={entry.regionSvg.x}
                  y={entry.regionSvg.y}
                  width={entry.regionSvg.width}
                  height={entry.regionSvg.height}
                  fill={color.stroke}
                  fillOpacity={fillOpacity}
                  stroke={color.stroke}
                  strokeWidth={strokeWidth}
                  strokeDasharray={strokeDash}
                  style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                  onMouseEnter={() => setHoveredIdx(idx)}
                  onMouseLeave={() => setHoveredIdx(null)}
                />
              )}
              {/* Line */}
              {entry.lineSvg && (
                <line
                  x1={entry.lineSvg.x1}
                  y1={entry.lineSvg.y1}
                  x2={entry.lineSvg.x2}
                  y2={entry.lineSvg.y2}
                  stroke={color.stroke}
                  strokeWidth={strokeWidth}
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
              style={{ backgroundColor: CATEGORY_COLORS[overlayElements[hoveredIdx].category].stroke }}
            />
            <span className="text-[10px] font-semibold text-slate-200">
              {overlayElements[hoveredIdx].candidate.candidateType.replace(/_/g, ' ')}
            </span>
            <span className="text-[10px] text-slate-500">
              {Math.round(overlayElements[hoveredIdx].candidate.confidence)}% confidence
            </span>
            {overlayElements[hoveredIdx].candidate.reviewStatus === 'review_required' && (
              <span className="text-[9px] text-amber-300 border border-amber-500/30 rounded px-1">
                REVIEW
              </span>
            )}
          </div>
          {overlayElements[hoveredIdx].ocrText && (
            <p className="mt-1 text-[10px] text-amber-200 italic">
              &ldquo;{overlayElements[hoveredIdx].ocrText}&rdquo;
            </p>
          )}
          {overlayElements[hoveredIdx].regionSvg && (
            <p className="mt-0.5 text-[9px] text-slate-500">
              Region: ({overlayElements[hoveredIdx].regionSvg!.x.toFixed(1)}, {overlayElements[hoveredIdx].regionSvg!.y.toFixed(1)}) {overlayElements[hoveredIdx].regionSvg!.width.toFixed(1)}×{overlayElements[hoveredIdx].regionSvg!.height.toFixed(1)}% &middot; REVIEW-ONLY / NON-AUTHORITATIVE
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Single photo with SVG overlays (refined mode) ────────────────────── */

function PhotoWithRefinedOverlays({
  fileUrl,
  filename,
  refinedCandidates,
}: {
  fileUrl: string;
  filename: string | null;
  refinedCandidates: RefinedCandidate[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [imgNatural, setImgNatural] = useState<{ w: number; h: number } | null>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const handleImgLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setImgNatural({ w: img.naturalWidth, h: img.naturalHeight });
  }, []);

  // Compute overlay elements from refined candidates
  const overlayElements: Array<{
    candidate: RefinedCandidate;
    color: { stroke: string; fill: string; label: string };
    regionSvg: { x: number; y: number; width: number; height: number };
  }> = [];

  for (const rc of refinedCandidates) {
    const color = GEOMETRY_CLASS_COLORS[rc.geometryClass] ?? GEOMETRY_CLASS_COLORS.unknown;
    const regionSvg = normalizedRegionToSvgPercent(rc.region);
    overlayElements.push({ candidate: rc, color, regionSvg });
  }

  return (
    <div
      ref={containerRef}
      className="relative rounded-xl overflow-hidden border border-emerald-500/30 bg-slate-900"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={fileUrl}
        alt={filename ?? 'Survey photo with refined overlays'}
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
          const strokeWidth = isHovered ? 0.7 : 0.4;
          const fillOpacity = isHovered ? 0.18 : 0.08;

          return (
            <g key={entry.candidate.id}>
              <rect
                x={entry.regionSvg.x}
                y={entry.regionSvg.y}
                width={entry.regionSvg.width}
                height={entry.regionSvg.height}
                fill={entry.color.stroke}
                fillOpacity={fillOpacity}
                stroke={entry.color.stroke}
                strokeWidth={strokeWidth}
                rx={0.2}
                style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
              />
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
              {overlayElements[hoveredIdx].candidate.geometryClass.replace(/_/g, ' ')}
            </span>
            <span className="text-[10px] text-slate-500">
              Score: {(overlayElements[hoveredIdx].candidate.geometryScore * 100).toFixed(0)}%
            </span>
            <span className="text-[10px] text-slate-500">
              Conf: {Math.round(overlayElements[hoveredIdx].candidate.confidence)}%
            </span>
            <span className="text-[9px] text-emerald-300 border border-emerald-500/30 rounded px-1">
              REFINED
            </span>
          </div>
          <p className="mt-0.5 text-[9px] text-slate-500">
            Sources: {overlayElements[hoveredIdx].candidate.sourceIds.length} &middot;{' '}
            {overlayElements[hoveredIdx].candidate.candidateType.replace(/_/g, ' ')} &middot;{' '}
            REVIEW-ONLY / NON-AUTHORITATIVE
          </p>
          {overlayElements[hoveredIdx].candidate.refinementNotes.length > 0 && (
            <p className="mt-0.5 text-[9px] text-slate-600">
              {overlayElements[hoveredIdx].candidate.refinementNotes.slice(0, 3).join(' · ')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Build `FileWithOverlays[]` from the full candidate list and survey files.
 * Groups candidates by `fileId` and attaches the `fileUrl`/`filename` from
 * the survey files list. Candidates without a matching survey file still
 * appear (using their stored `fileUrl` from the candidate payload) so that
 * overlays are never lost.
 */
export function buildFilesWithOverlays(
  candidates: OverlayCandidate[],
  surveyFiles: Array<{ id: string; fileUrl: string; filename: string | null }>,
): FileWithOverlays[] {
  const fileMap = new Map(surveyFiles.map((f) => [f.id, f]));

  const grouped = new Map<string, FileWithOverlays>();
  for (const candidate of candidates) {
    if (!grouped.has(candidate.fileId)) {
      const surveyFile = fileMap.get(candidate.fileId);
      grouped.set(candidate.fileId, {
        fileId: candidate.fileId,
        fileUrl: surveyFile?.fileUrl ?? String(candidate.payload?.sourceFileUrl ?? ''),
        filename: surveyFile?.filename ?? String(candidate.payload?.sourceFilename ?? null),
        candidates: [],
      });
    }
    grouped.get(candidate.fileId)!.candidates.push(candidate);
  }

  return Array.from(grouped.values());
}

/**
 * Build `FileWithRefinedOverlays[]` from refined candidates and survey files.
 * Groups refined candidates by `fileId` and attaches file metadata.
 */
export function buildFilesWithRefinedOverlays(
  refinedCandidates: RefinedCandidate[],
  surveyFiles: Array<{ id: string; fileUrl: string; filename: string | null }>,
): FileWithRefinedOverlays[] {
  const fileMap = new Map(surveyFiles.map((f) => [f.id, f]));

  const grouped = new Map<string, FileWithRefinedOverlays>();
  for (const rc of refinedCandidates) {
    if (!grouped.has(rc.fileId)) {
      const surveyFile = fileMap.get(rc.fileId);
      grouped.set(rc.fileId, {
        fileId: rc.fileId,
        fileUrl: surveyFile?.fileUrl ?? '',
        filename: surveyFile?.filename ?? null,
        refinedCandidates: [],
      });
    }
    grouped.get(rc.fileId)!.refinedCandidates.push(rc);
  }

  return Array.from(grouped.values());
}
