'use client';

/**
 * PhotoVisionOverlayRenderer — renders geometric overlays on survey photos.
 *
 * This component displays survey photos with SVG overlay rectangles/lines
 * derived from persisted `open_source_photo_vision_candidates` whose
 * `payload.region` or `payload.bbox` contain `normalized_image_0_1000`
 * geometry.
 *
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 * These overlays are operator review aids only. They must not be used as
 * canonical evidence, CAD geometry, permit input, BOM input, or engineering
 * workflow state.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
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

/* ── Color scheme by category ─────────────────────────────────────────── */

const CATEGORY_COLORS: Record<OverlayFilterCategory, { stroke: string; fill: string; label: string }> = {
  cv: { stroke: '#22d3ee', fill: 'rgba(34,211,238,0.08)', label: 'CV' },
  yolo: { stroke: '#a78bfa', fill: 'rgba(167,139,250,0.08)', label: 'YOLO' },
  ocr: { stroke: '#fbbf24', fill: 'rgba(251,191,36,0.08)', label: 'OCR' },
  other: { stroke: '#94a3b8', fill: 'rgba(148,163,184,0.06)', label: 'Other' },
};

/* ── Component ────────────────────────────────────────────────────────── */

export function PhotoVisionOverlayRenderer({
  filesWithOverlays,
  candidateFilter,
  selectedFileId,
  onSelectFile,
}: {
  filesWithOverlays: FileWithOverlays[];
  candidateFilter: 'both' | 'opencv' | 'yolo' | 'ocr';
  selectedFileId: string | null;
  onSelectFile: (fileId: string | null) => void;
}) {
  // Filter files to only those with drawable overlay candidates
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

/* ── Single photo with SVG overlays ───────────────────────────────────── */

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
