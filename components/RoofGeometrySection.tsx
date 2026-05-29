'use client';

/**
 * RoofGeometrySection — ONE clean section for all roof geometry.
 *
 * Replaces the previous 3 separate sections (PhotoVision overlay,
 * UnifiedGeometry overlay, GeometryReconstructionPreview) with a single
 * unified view:
 *
 *   1. Primary photo overlay showing geometry on survey photos
 *   2. "Generate Roof Geometry" button to trigger Pipeline B
 *   3. Simple status/counts
 *   4. Collapsible details for advanced users
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  Layers,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CheckCircle,
  Box,
  Eye,
  ScanLine,
  Home,
} from 'lucide-react';
import {
  UnifiedGeometryOverlayRenderer,
  buildFilesWithUnifiedArtifacts,
} from '@/components/UnifiedGeometryOverlayRenderer';
import type { UnifiedGeometryEvidenceBundle } from '@/lib/siteSurveys/unifiedGeometry/types';

/* ── Types ──────────────────────────────────────────────────────────── */

interface SurveyFile {
  id: string;
  fileUrl: string;
  filename: string;
}

interface RoofGeometrySectionProps {
  surveyId: string;
  files: SurveyFile[];
  /** Pre-existing Pipeline A candidate data (from photo vision) */
  photoVisionCandidateCount?: number;
  /** Callback when user triggers Pipeline B and it succeeds */
  onGeometryGenerated?: () => void;
}

/* ── Pipeline B Status Display ──────────────────────────────────────── */

type PipelineStatus = 'idle' | 'running' | 'completed' | 'failed';

/* ── Component ──────────────────────────────────────────────────────── */

export function RoofGeometrySection({
  surveyId,
  files,
  photoVisionCandidateCount = 0,
  onGeometryGenerated,
}: RoofGeometrySectionProps) {
  // ── State ─────────────────────────────────────────────────────────
  const [unifiedBundle, setUnifiedBundle] = useState<UnifiedGeometryEvidenceBundle | null>(null);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatus>('idle');
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [bundleLoading, setBundleLoading] = useState(true);

  // ── Fetch unified geometry bundle ─────────────────────────────────
  const [authRequired, setAuthRequired] = useState(false);

  const fetchBundle = useCallback(async () => {
    if (!surveyId) return;
    try {
      const res = await fetch(`/api/site-surveys/${surveyId}/unified-geometry/bundle`);
      if (res.status === 401) {
        setAuthRequired(true);
        return;
      }
      const data = await res.json();
      if (data.success && data.bundle) {
        setUnifiedBundle(data.bundle);
      }
    } catch (err) {
      console.warn('[RoofGeometrySection] Failed to fetch unified bundle:', err);
    } finally {
      setBundleLoading(false);
    }
  }, [surveyId]);

  useEffect(() => {
    fetchBundle();
  }, [fetchBundle]);

  // ── Run Pipeline B (Generate Roof Geometry) ──────────────────────
  const runPipelineB = useCallback(async () => {
    setPipelineStatus('running');
    setPipelineError(null);
    try {
      const res = await fetch(
        `/api/site-surveys/${surveyId}/geometry-reconstruction/start`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pipeline: 'full' }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 401) {
          throw new Error('Please log in to generate roof geometry. You need to be authenticated to run this pipeline.');
        }
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      const json = await res.json();
      if (json.error) {
        throw new Error(json.error);
      }
      setPipelineStatus('completed');
      // Refresh the unified bundle to pick up new Pipeline B artifacts
      await fetchBundle();
      onGeometryGenerated?.();
    } catch (err) {
      setPipelineStatus('failed');
      setPipelineError(err instanceof Error ? err.message : 'Unknown error');
    }
  }, [surveyId, fetchBundle, onGeometryGenerated]);

  // ── Also run Pipeline A (Photo Vision) ───────────────────────────
  const runPipelineA = useCallback(async () => {
    setPipelineStatus('running');
    setPipelineError(null);
    try {
      const res = await fetch(
        `/api/site-surveys/${surveyId}/open-source-photo-vision-pass`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 401) {
          throw new Error('Please log in to run photo vision. You need to be authenticated to run this pipeline.');
        }
        throw new Error(body.error || `Photo vision failed (${res.status})`);
      }
      const json = await res.json();
      if (!json.success) {
        throw new Error(json.error || 'Photo vision pass failed to start');
      }
      setPipelineStatus('completed');
      await fetchBundle();
      onGeometryGenerated?.();
    } catch (err) {
      setPipelineStatus('failed');
      setPipelineError(err instanceof Error ? err.message : 'Unknown error');
    }
  }, [surveyId, fetchBundle, onGeometryGenerated]);

  // ── Derived data ──────────────────────────────────────────────────
  const artifacts = unifiedBundle?.artifacts ?? [];
  const pipelineCounts = unifiedBundle?.pipelineCounts ?? { photoVision: 0, geometryRecon: 0 };

  const hasPipelineBData = pipelineCounts.geometryRecon > 0;
  const hasPipelineAData = pipelineCounts.photoVision > 0;
  const hasAnyData = artifacts.length > 0;

  // Count by geometry class
  const classCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of artifacts) {
      counts[a.geometryClass] = (counts[a.geometryClass] ?? 0) + 1;
    }
    return counts;
  }, [artifacts]);

  // Build overlay data
  const filesWithArtifacts = useMemo(
    () => buildFilesWithUnifiedArtifacts(artifacts, files),
    [artifacts, files],
  );

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="rounded-xl border border-slate-700/60 bg-slate-950/40">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/40">
        <div className="flex items-center gap-2">
          <Home size={16} className="text-emerald-400" />
          <h3 className="text-sm font-semibold text-white">Roof Geometry</h3>
          {hasAnyData && (
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
              {artifacts.length} artifacts
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {hasPipelineBData && (
            <span className="flex items-center gap-1 text-[10px] text-emerald-400">
              <CheckCircle size={10} /> Pipeline B
            </span>
          )}
          {hasPipelineAData && !hasPipelineBData && (
            <span className="flex items-center gap-1 text-[10px] text-amber-400">
              <ScanLine size={10} /> Pipeline A only
            </span>
          )}
          {!hasAnyData && !bundleLoading && (
            <span className="text-[10px] text-slate-500">No geometry data yet</span>
          )}
        </div>
      </div>

      <div className="px-4 py-3 space-y-3">
        {/* ── Action Buttons ── */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={runPipelineB}
            disabled={pipelineStatus === 'running'}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600/80 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pipelineStatus === 'running' ? (
              <RefreshCw size={12} className="animate-spin" />
            ) : (
              <Layers size={12} />
            )}
            {pipelineStatus === 'running'
              ? 'Generating roof geometry…'
              : 'Generate Roof Geometry'}
          </button>
          {!hasPipelineAData && (
            <button
              onClick={runPipelineA}
              disabled={pipelineStatus === 'running'}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-300 shadow-sm transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ScanLine size={12} />
              Run Photo Vision (Bounding Boxes)
            </button>
          )}
          {hasAnyData && (
            <button
              onClick={fetchBundle}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900/60 px-2.5 py-1.5 text-[10px] text-slate-400 transition hover:text-slate-200"
            >
              <RefreshCw size={10} />
            </button>
          )}
        </div>

        {/* ── Pipeline Status ── */}
        {pipelineStatus === 'running' && (
          <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-2.5">
            <div className="flex items-center gap-2">
              <RefreshCw size={12} className="animate-spin text-blue-400" />
              <span className="text-[11px] font-semibold text-blue-300">
                Processing… This may take a few minutes.
              </span>
            </div>
          </div>
        )}

        {pipelineStatus === 'failed' && pipelineError && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-2.5">
            <p className="text-[11px] font-semibold text-red-300">Error</p>
            <p className="mt-0.5 text-[10px] text-red-200/70">{pipelineError}</p>
          </div>
        )}

        {/* ── Quick Stats ── */}
        {hasAnyData && (
          <div className="flex flex-wrap gap-2">
            {Object.entries(classCounts).map(([cls, count]) => (
              <span
                key={cls}
                className="rounded-full border border-slate-700/60 bg-slate-900/60 px-2.5 py-1 text-[10px] text-slate-300"
              >
                {cls.replace(/_/g, ' ')}: {count}
              </span>
            ))}
            <span className="rounded-full border border-slate-700/40 bg-slate-900/30 px-2.5 py-1 text-[10px] text-slate-500">
              Source: {hasPipelineBData ? 'Geometry Recon + Photo Vision' : 'Photo Vision (bbox only)'}
            </span>
          </div>
        )}

        {/* ── Info banner when no Pipeline B data ── */}
        {hasPipelineAData && !hasPipelineBData && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5">
            <div className="flex items-start gap-2">
              <AlertTriangle size={12} className="text-amber-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-[10px] font-semibold text-amber-200">
                  Bounding boxes only — click &quot;Generate Roof Geometry&quot; for real roof shapes
                </p>
                <p className="mt-0.5 text-[10px] text-amber-100/60">
                  The current overlay shows bounding boxes from photo vision. Running the geometry
                  reconstruction pipeline will produce actual roof plane polygons.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── Photo + Geometry Overlay ── */}
        {hasAnyData && filesWithArtifacts.length > 0 && (
          <div className="rounded-lg border border-slate-700/40 bg-slate-950/30 p-2">
            <UnifiedGeometryOverlayRenderer
              filesWithArtifacts={filesWithArtifacts}
              selectedFileId={selectedFileId}
              onSelectFile={setSelectedFileId}
              showMockArtifacts={false}
            />
          </div>
        )}

        {/* ── Empty State ── */}
        {!hasAnyData && !bundleLoading && (
          <div className="rounded-lg border border-slate-700/40 bg-slate-900/20 p-6 text-center">
            <Box size={24} className="mx-auto text-slate-600 mb-2" />
            {authRequired ? (
              <p className="text-xs text-slate-400">
                Please log in to view and generate roof geometry data.
              </p>
            ) : (
              <p className="text-xs text-slate-400">
                No roof geometry data yet. Click &quot;Generate Roof Geometry&quot; to analyze
                the survey photos and extract roof plane shapes.
              </p>
            )}
          </div>
        )}

        {/* ── Collapsible Details ── */}
        {hasAnyData && (
          <button
            onClick={() => setDetailsOpen(!detailsOpen)}
            className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-300 transition"
          >
            {detailsOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            {detailsOpen ? 'Hide' : 'Show'} raw artifact details
          </button>
        )}

        {detailsOpen && hasAnyData && (
          <div className="rounded-lg border border-slate-700/40 bg-slate-900/20 p-3 max-h-80 overflow-y-auto">
            <div className="space-y-1.5">
              {artifacts.slice(0, 50).map((artifact, i) => (
                <div
                  key={artifact.id ?? i}
                  className="flex items-center justify-between rounded border border-slate-800 bg-slate-900/50 px-2 py-1.5"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full flex-shrink-0 ${
                        artifact.provenance?.sourcePipeline === 'geometry_recon'
                          ? 'bg-emerald-400'
                          : 'bg-amber-400'
                      }`}
                    />
                    <span className="text-[10px] text-slate-300">
                      {artifact.geometryClass.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] text-slate-500">
                      {artifact.provenance?.sourcePipeline === 'geometry_recon' ? 'Pipeline B' : 'Pipeline A'}
                    </span>
                    {artifact.confidence != null && (
                      <span className="text-[9px] text-slate-500">
                        {Math.round(artifact.confidence)}%
                      </span>
                    )}
                    {artifact.authority?.mockArtifact && (
                      <span className="text-[8px] text-red-400">MOCK</span>
                    )}
                  </div>
                </div>
              ))}
              {artifacts.length > 50 && (
                <p className="text-[9px] text-slate-500 text-center pt-1">
                  …and {artifacts.length - 50} more
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
