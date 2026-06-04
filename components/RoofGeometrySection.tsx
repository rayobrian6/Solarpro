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

import React, { useState, useCallback, useEffect, useMemo, useRef, Component } from 'react';
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
  Sun,
  Cpu,
  Zap,
  Camera,
  XCircle,
  Clock,
  SkipForward,
  Shapes,
} from 'lucide-react';
import {
  UnifiedGeometryOverlayRenderer,
  buildFilesWithUnifiedArtifacts,
} from '@/components/UnifiedGeometryOverlayRenderer';
import type {
  UnifiedGeometryArtifact,
  UnifiedGeometryEvidenceBundle,
} from '@/lib/siteSurveys/unifiedGeometry/types';

/* ── Types ──────────────────────────────────────────────────────────── */

/** Mirrors the PhotoSegmentationResult from runSegmentationWorker.ts */
type PhotoSegmentationStatus =
  | 'sam2_success'
  | 'sam2_failed'
  | 'skipped_budget'
  | 'skipped_timeout'
  | 'skipped_warmup'
  | 'skipped_not_configured';

interface PhotoSegmentationResult {
  fileId: string;
  filename: string | null;
  label: string | null;
  status: PhotoSegmentationStatus;
  maskCount: number;
  reason: string | null;
}

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

const EMPTY_ARTIFACTS: UnifiedGeometryArtifact[] = [];

/* ── Error boundary for the overlay renderer ────────────────────────────── */
interface OverlayErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class OverlayErrorBoundary extends Component<
  { children: React.ReactNode },
  OverlayErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): OverlayErrorBoundaryState {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-3">
          <p className="text-[11px] text-red-300 font-medium">
            Overlay rendering failed
          </p>
          <p className="text-[10px] text-red-400/60 mt-1">
            {this.state.error?.message ?? 'Unknown error'}. Try refreshing the page.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
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
  const [generationSummary, setGenerationSummary] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [showDebugRoofLines, setShowDebugRoofLines] = useState(false);
  const [bundleLoading, setBundleLoading] = useState(true);
  const [bundleMode, setBundleMode] = useState<'stats' | 'overlay'>('stats');
  const [overlayArtifactsByFile, setOverlayArtifactsByFile] = useState<Map<string, UnifiedGeometryArtifact[]>>(new Map());
  // Ref to access the cache inside callbacks without adding it to dependency arrays
  const overlayCacheRef = useRef(overlayArtifactsByFile);
  overlayCacheRef.current = overlayArtifactsByFile;

  // Clear per-photo overlay cache when surveyId changes (prevents stale data)
  useEffect(() => {
    setOverlayArtifactsByFile(new Map());
  }, [surveyId]);
  const [overlayLoading, setOverlayLoading] = useState(false);
  const [pipelineCLoading, setPipelineCLoading] = useState(false);
  const [pipelineCError, setPipelineCError] = useState<string | null>(null);
  const [pipelineCNoCoverage, setPipelineCNoCoverage] = useState(false);
  const [pipelineBackend, setPipelineBackend] = useState<'sam2' | 'canny' | null>(null);
  const [pipelineCSummary, setPipelineCSummary] = useState<string | null>(null);
  const [googleSolarApiConfigured, setGoogleSolarApiConfigured] = useState<boolean | null>(null); // null = unknown
  const [photoResults, setPhotoResults] = useState<PhotoSegmentationResult[]>([]);
  const [budgetExhaustedReason, setBudgetExhaustedReason] = useState<string | null>(null);

  // ── Fetch unified geometry bundle ─────────────────────────────────
  const [authRequired, setAuthRequired] = useState(false);

  const fetchBundle = useCallback(async (mode: 'stats' | 'overlay' = 'stats') => {
    if (!surveyId) return;
    setBundleLoading(true);
    try {
      const res = await fetch(`/api/site-surveys/${surveyId}/unified-geometry/bundle?mode=${mode}`, {
        credentials: 'include',
      });
      if (res.status === 401) {
        setAuthRequired(true);
        return;
      }
      if (res.status === 413) {
        let errorMsg = 'Response too large. Try refreshing — the survey data will load in stats mode by default.';
        try {
          const errData = await res.json();
          if (errData.error) errorMsg = errData.error;
        } catch { /* use default message */ }
        setPipelineError(errorMsg);
        setBundleLoading(false);
        return;
      }

      // ── Defensive JSON parsing ──
      // The bundle response can be very large (~30+ MB with many segmentation
      // masks). If any geometry_data JSONB value contains an unescaped character
      // (newline, raw backslash, etc.), res.json() will throw "Unterminated
      // string" or similar. We catch that, log a helpful diagnostic, and fall
      // back to showing the error in the UI rather than crashing silently.
      let data: any;
      try {
        data = await res.json();
      } catch (jsonErr) {
        const msg = jsonErr instanceof Error ? jsonErr.message : String(jsonErr);
        console.error('[RoofGeometrySection] JSON parse error in bundle response:', msg);

        // Attempt to read the raw text to diagnose where the malformed JSON is
        let rawSnippet = '(could not read body)';
        try {
          // res.body was already consumed by the failed res.json(), but we can
          // try cloning — if the response is too large this may also fail.
          // We skip this for now since the body is already consumed.
        } catch { /* ignore */ }

        setPipelineError(
          `Failed to parse geometry data from server: ${msg}. ` +
          `This may be caused by corrupted geometry data in the database. ` +
          `Try refreshing — if the error persists, the survey's geometry data may need to be re-generated.`
        );
        setBundleLoading(false);
        return;
      }

      if (data.success && data.bundle) {
        setUnifiedBundle(data.bundle);
        setBundleMode(mode);
      }
      // Capture pipeline configuration status (e.g., whether Google Solar API key is set)
      if (data.pipelineConfig) {
        setGoogleSolarApiConfigured(data.pipelineConfig.googleSolarApi ?? null);
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

  // ── Fetch per-photo overlay data (polygon vertices for one photo) ────────
  // This is the key mechanism for making polygon rendering the default:
  // - On mount, we fetch ?mode=stats (fast, small — gives counts/bbox for all photos)
  // - When a photo is selected, we auto-fetch ?mode=overlay&fileId=... for that photo
  // - Per-photo responses are ~1-2MB instead of ~33MB for all photos
  // - Previously loaded photo polygons are cached in overlayArtifactsByFile
  const fetchPhotoOverlay = useCallback(async (fileId: string) => {
    if (!surveyId || !fileId) return;
    // Skip if already cached for this file
    if (overlayCacheRef.current.has(fileId)) return;
    // Skip if we already loaded all overlay data (bundleMode === 'overlay' without fileId)
    if (bundleMode === 'overlay') return;

    setOverlayLoading(true);
    try {
      const res = await fetch(
        `/api/site-surveys/${surveyId}/unified-geometry/bundle?mode=overlay&fileId=${fileId}`,
        { credentials: 'include' },
      );
      if (res.status === 401) {
        setAuthRequired(true);
        return;
      }

      let data: any;
      try {
        data = await res.json();
      } catch (jsonErr) {
        const msg = jsonErr instanceof Error ? jsonErr.message : String(jsonErr);
        console.warn('[RoofGeometrySection] JSON parse error in per-photo overlay response:', msg);
        return; // silent fail — the stats-mode bbox data is still showing
      }

      if (data.success && data.bundle?.artifacts) {
        // Cache the overlay artifacts for this specific file
        setOverlayArtifactsByFile(prev => {
          const next = new Map(prev);
          next.set(fileId, data.bundle.artifacts);
          return next;
        });
      }
    } catch (err) {
      console.warn('[RoofGeometrySection] Failed to fetch per-photo overlay:', err);
    } finally {
      setOverlayLoading(false);
    }
  }, [surveyId, bundleMode]); // overlayCacheRef excluded — ref access avoids re-creation

  // ── Auto-load overlay data when a photo is selected ────────────────────────
  // When the user clicks on a photo in the overlay renderer, we automatically
  // fetch the detailed polygon data for that photo. This makes polygon rendering
  // the default experience without any manual button click.
  useEffect(() => {
    if (selectedFileId && bundleMode === 'stats') {
      fetchPhotoOverlay(selectedFileId);
    }
  }, [selectedFileId, bundleMode, fetchPhotoOverlay]);

  // NOTE: loadAllOverlayData callback removed — the "Load All Polygons" button
  // was removed because it could exceed Vercel's 4.5MB response limit.
  // Per-photo overlay auto-load (fetchPhotoOverlay) provides the same
  // functionality safely by loading one photo at a time.


  // ── Run Pipeline B (Generate Roof Geometry) ──────────────────────────────────────────────
  // Pipeline B is async: POST /start → 202 { jobId } → poll GET /status
  // If the server returns 200 (mock pipeline / backward compat), handle inline completion.
  const runPipelineB = useCallback(async () => {
    setPipelineStatus('running');
    setPipelineError(null);
    setGenerationSummary(null);
    setPhotoResults([]);
    setBudgetExhaustedReason(null);

    try {
      const res = await fetch(
        `/api/site-surveys/${surveyId}/geometry-reconstruction/start`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
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

      // ── Async flow (202): job created, poll /status until completed/failed ──────
      // This is the primary flow for real pipelines (full, segmentation_only, etc.)
      if (res.status === 202 || json.status === 'queued') {
        const jobId = json.jobId;
        if (!jobId) {
          throw new Error('Server returned async response but no jobId for polling.');
        }

        const POLL_INTERVAL_MS = 3000;
        const POLL_TIMEOUT_MS = 600000;
        const startTime = Date.now();

        setGenerationSummary('Pipeline B queued — waiting for execution to start…');

        while (Date.now() - startTime < POLL_TIMEOUT_MS) {
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

          const statusRes = await fetch(
            `/api/site-surveys/${surveyId}/geometry-reconstruction/status?jobId=${jobId}`,
            { credentials: 'include' },
          );

          if (!statusRes.ok) {
            console.warn('[runPipelineB] Status poll failed, retrying…');
            continue;
          }

          const statusJson = await statusRes.json();

          const stage = statusJson.currentStage ?? '';
          const progress = typeof statusJson.progress === 'number' ? statusJson.progress : null;
          const stageLabel = stage.replace(/_/g, ' ');
          setGenerationSummary(
            `Pipeline B running — stage: ${stageLabel}${progress !== null ? ` (${Math.round(progress * 100)}%)` : ''}…`,
          );

          if (statusJson.status === 'completed') {
            const artifactCount = typeof statusJson.artifactCount === 'number'
              ? statusJson.artifactCount
              : Array.isArray(statusJson.artifacts)
                ? statusJson.artifacts.length
                : null;
            const grouped = statusJson.groupedArtifactCounts as Record<string, number> | undefined;
            const planeCount = grouped?.consensus_plane_candidate ?? grouped?.consensus_plane ?? 0;
            const segCount = grouped?.semantic_segmentation_mask ?? 0;
            const lineCount = grouped?.roof_line_candidate ?? grouped?.roof_line ?? 0;

            setGenerationSummary(
              `Pipeline B completed with ${artifactCount ?? '?'} artifacts` +
              (segCount ? `, ${segCount} segmentation masks` : '') +
              (lineCount ? `, ${lineCount} roof lines` : '') +
              (planeCount ? `, ${planeCount} consensus planes` : '') +
              '.',
            );
            setPipelineStatus('completed');
            await fetchBundle();
            onGeometryGenerated?.();
            return;
          }

          if (statusJson.status === 'failed') {
            throw new Error(
              statusJson.error || 'Pipeline B execution failed. Check the job for partial results.',
            );
          }

          if (statusJson.warning) {
            console.warn(`[runPipelineB] ${statusJson.warning}`);
          }
        }

        throw new Error(
          'Pipeline B did not complete within 10 minutes. The job may still be running — refresh the page to check.',
        );
      }

      // ── Inline completion (200): backward compat for mock pipeline ──────────
      if (json.status === 'completed' || res.status === 200) {
        const artifactCount = typeof json.summary?.rawArtifactCount === 'number'
          ? json.summary.rawArtifactCount
          : null;
        const stageCount = Array.isArray(json.pipelineStages) ? json.pipelineStages.length : null;
        const polygonCount = typeof json.summary?.rawPolygonArtifactCount === 'number'
          ? json.summary.rawPolygonArtifactCount
          : null;
        const consensusCount = typeof json.summary?.rawConsensusPlaneCount === 'number'
          ? json.summary.rawConsensusPlaneCount
          : null;

        // Capture SAM 2 backend info
        if (json.summary?.segmentationBackend === 'sam2' || json.summary?.segmentationBackend === 'canny') {
          setPipelineBackend(json.summary.segmentationBackend);
        }
        // Capture per-photo segmentation results
        if (Array.isArray(json.summary?.photoResults)) {
          setPhotoResults(json.summary.photoResults);
        }
        if (json.summary?.budgetExhaustedReason) {
          setBudgetExhaustedReason(json.summary.budgetExhaustedReason);
        }

        setGenerationSummary(
          `Pipeline B completed${artifactCount != null ? ` with ${artifactCount} artifacts` : ''}${stageCount != null ? ` across ${stageCount} stages` : ''}${polygonCount != null ? `, including ${polygonCount} polygon artifacts` : ''}${consensusCount != null ? ` and ${consensusCount} consensus planes` : ''}.`,
        );
        setPipelineStatus('completed');
        await fetchBundle();
        onGeometryGenerated?.();
        return;
      }

      // ── Unexpected response ──────────────────────────────────────────────
      throw new Error(
        `Unexpected response from /start: status=${res.status}, json.status=${json.status}`,
      );
    } catch (err) {
      setPipelineStatus('failed');
      setPipelineError(err instanceof Error ? err.message : 'Unknown error');
    }
  }, [surveyId, fetchBundle, onGeometryGenerated]);
  // ── Also run Pipeline A (Photo Vision) ───────────────────────────
  const runPipelineA = useCallback(async () => {
    setPipelineStatus('running');
    setPipelineError(null);
    setGenerationSummary(null);
    try {
      const res = await fetch(
        `/api/site-surveys/${surveyId}/open-source-photo-vision-pass`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
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

  // ── Run Pipeline C (Google Solar API) ─────────────────────────────────
  // The server auto-resolves lat/lng from the survey's project data,
  // so no user prompt is needed. If the project has no geocoded address,
  // the server returns a helpful error message.
  const runPipelineC = useCallback(async () => {
    setPipelineCLoading(true);
    setPipelineCError(null);
    setPipelineCSummary(null);
    setPipelineCNoCoverage(false);
    setPipelineStatus('running');
    setPipelineError(null);
    setGenerationSummary(null);
    try {
      // No window.prompt() — the server auto-resolves coordinates from the
      // survey's project. If the project has no geocoded lat/lng, the server
      // returns a clear error explaining what to do.
      const res = await fetch(
        `/api/site-surveys/${surveyId}/google-solar-api`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({}), // lat/lng auto-resolved server-side
        },
      );

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 401) {
          throw new Error('Please log in to use the Google Solar API.');
        }
        if (res.status === 503) {
          throw new Error('Google Solar API is not configured on this server. Ask your administrator to set the GOOGLE_SOLAR_API_KEY environment variable.');
        }
        if (res.status === 400 && body.code === 'NO_COORDINATES') {
          throw new Error(body.error || "No coordinates found for this survey's project. Enter the project address first to geocode it.");
        }
        // Handle "no coverage" — Google Solar API has no data for this area
        if (res.status === 404 && body.code === 'NO_COVERAGE') {
          setPipelineCNoCoverage(true);
          setPipelineCError(body.guidance || body.error || 'The Google Solar API does not have coverage for this area.');
          setPipelineStatus('idle');
          return; // Don't set pipelineStatus to 'failed' — this isn't a bug, it's a coverage limitation
        }
        throw new Error(body.error || `Request failed (${res.status})`);
      }

      const json = await res.json();
      if (!json.success) {
        throw new Error(json.error || 'Google Solar API call failed');
      }

      const summary = json.summary ?? {};
      const planeCount = summary.roofPlaneCount ?? 0;
      const lineCount = summary.roofLineCount ?? 0;
      const polygonCount = summary.polygonCount ?? 0;
      const imageryInfo = json.imageryInfo;

      const dataSource = summary.dataSource ?? 'api';
      const cacheHit = summary.cacheHit ?? false;
      const dataSourceLabel = dataSource === 'cache' ? ' (cached — no API call needed!)' : dataSource === 'pre_fetched' ? ' (pre-fetched data reused)' : '';

      setPipelineCSummary(
        `Pipeline C (Google Solar API) completed: ${planeCount} roof planes with ${polygonCount} polygon outlines, ${lineCount} inferred roof lines${dataSourceLabel}.${
          imageryInfo?.date ? ` Imagery from ${imageryInfo.date}.` : ''
        }`,
      );
      setPipelineStatus('completed');
      setGenerationSummary(
        `Google Solar API returned ${planeCount} real roof plane polygons — no more bounding boxes!`,
      );
      // Refresh the unified bundle to pick up new Pipeline C artifacts
      await fetchBundle();
      onGeometryGenerated?.();
    } catch (err) {
      setPipelineStatus('failed');
      setPipelineCError(err instanceof Error ? err.message : 'Unknown error');
      setPipelineError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setPipelineCLoading(false);
    }
  }, [surveyId, fetchBundle, onGeometryGenerated]);

  // ── Derived data ──────────────────────────────────────────────────
  // ── Merge per-photo overlay data into the base bundle ────────────────────
  // In stats mode, segmentation mask vertices are stripped (empty arrays).
  // When per-photo overlay data is fetched (?mode=overlay&fileId=...), those
  // artifacts have full polygon vertices. We merge them by replacing
  // stats-mode artifacts with their overlay counterparts (matched by ID).
  const mergedArtifacts = useMemo(() => {
    const base = unifiedBundle?.artifacts ?? EMPTY_ARTIFACTS;

    // If no per-photo overlay data cached, return base as-is
    if (overlayArtifactsByFile.size === 0) return base;

    // Build a lookup map of overlay artifacts by ID
    const overlayById = new Map<string, UnifiedGeometryArtifact>();
    for (const [, arts] of overlayArtifactsByFile) {
      for (const a of arts) {
        if (a.id) overlayById.set(a.id, a);
      }
    }

    // If no overlay artifacts found (unlikely), return base
    if (overlayById.size === 0) return base;

    // Replace stats-mode artifacts with their overlay counterparts
    return base.map(a => {
      const overlay = a.id ? overlayById.get(a.id) : undefined;
      return overlay ?? a;
    });
  }, [unifiedBundle?.artifacts, overlayArtifactsByFile]);

  const artifacts = mergedArtifacts;
  const pipelineCounts = unifiedBundle?.pipelineCounts ?? { photoVision: 0, geometryRecon: 0, googleSolarApi: 0, obstructionRegistration: 0, manual: 0, merged: 0, mock: 0 };

  const hasPipelineBData = pipelineCounts.geometryRecon > 0;
  const hasPipelineAData = pipelineCounts.photoVision > 0;
  const hasPipelineCData = pipelineCounts.googleSolarApi > 0;
  const hasAnyData = artifacts.length > 0;
  const polygonArtifactCount = artifacts.filter((a) => a.polygon?.vertices?.length).length;
  const consensusPlaneCount = artifacts.filter((a) => a.geometryClass === 'consensus_plane').length;

  // Count by geometry class
  const classCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of artifacts) {
      counts[a.geometryClass] = (counts[a.geometryClass] ?? 0) + 1;
    }
    return counts;
  }, [artifacts]);

  // Geometry stats summary for the stats panel
  const geometryStats = useMemo(() => {
    const planes = artifacts.filter(a => a.geometryClass === 'roof_plane' || a.geometryClass === 'wall_plane' || a.geometryClass === 'consensus_plane');
    const lines = artifacts.filter(a => a.geometryClass === 'roof_line');
    const segMasks = artifacts.filter(a => a.geometryClass === 'segmentation_mask');

    // Pass 3E: Participation breakdown for segmentation masks
    const participatingMasks = segMasks.filter(a => a.excludeFromGeometry !== true);
    const excludedMasks = segMasks.filter(a => a.excludeFromGeometry === true);
    const partialMasks = participatingMasks.filter(a =>
      a.geometryParticipation && Object.values(a.geometryParticipation).some(v => v === false)
    );

    // Confidence stats
    const confidences = artifacts.map(a => a.confidence).filter(c => c != null);
    const avgConfidence = confidences.length > 0
      ? confidences.reduce((sum, c) => sum + c, 0) / confidences.length
      : null;

    // Pitch stats (for roof planes)
    const pitches = planes.map(a => a.pitchDegrees).filter(p => p != null) as number[];
    const pitchRange = pitches.length > 0
      ? { min: Math.min(...pitches), max: Math.max(...pitches) }
      : null;

    // Azimuth stats (for roof planes)
    const azimuths = planes.map(a => a.azimuthDegrees).filter(a => a != null) as number[];
    const azimuthRange = azimuths.length > 0
      ? { min: Math.min(...azimuths), max: Math.max(...azimuths) }
      : null;

    // Total area
    const totalAreaSqM = planes.reduce((sum, a) => sum + (a.areaSqM ?? 0), 0);

    // Line subtype breakdown
    const lineSubtypes: Record<string, number> = {};
    for (const l of lines) {
      const sub = l.lineSubtype ?? 'unclassified';
      lineSubtypes[sub] = (lineSubtypes[sub] ?? 0) + 1;
    }

    // Avg line confidence
    const lineConfidences = lines.map(a => a.confidence).filter(c => c != null);
    const avgLineConfidence = lineConfidences.length > 0
      ? lineConfidences.reduce((sum, c) => sum + c, 0) / lineConfidences.length
      : null;

    // Total estimated line length
    const totalLineLengthM = lines.reduce((sum, a) => sum + (a.estimatedLengthM ?? 0), 0);

    return {
      planeCount: planes.length,
      lineCount: lines.length,
      segMaskCount: segMasks.length,
      participatingMaskCount: participatingMasks.length,
      excludedMaskCount: excludedMasks.length,
      partialMaskCount: partialMasks.length,
      avgConfidence,
      pitchRange,
      azimuthRange,
      totalAreaSqM,
      lineSubtypes,
      avgLineConfidence,
      totalLineLengthM,
    };
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
              {pipelineBackend === 'sam2' && (
                <span className="flex items-center gap-0.5 rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-300">
                  <Zap size={8} /> SAM 2
                </span>
              )}
              {pipelineBackend === 'canny' && (
                <span className="flex items-center gap-0.5 rounded-full bg-slate-500/20 px-1.5 py-0.5 text-[9px] font-medium text-slate-400">
                  <Cpu size={8} /> Canny
                </span>
              )}
            </span>
          )}
          {hasPipelineCData && (
            <span className="flex items-center gap-1 text-[10px] text-amber-400">
              <Sun size={10} /> Pipeline C (Solar API)
            </span>
          )}
          {hasPipelineAData && !hasPipelineBData && !hasPipelineCData && (
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
          <button
            onClick={runPipelineA}
            disabled={pipelineStatus === 'running'}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-300 shadow-sm transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ScanLine size={12} />
            Run Photo Vision (Bounding Boxes)
          </button>
          <button
            onClick={runPipelineC}
            disabled={pipelineStatus === 'running' || pipelineCLoading || googleSolarApiConfigured === false || pipelineCNoCoverage}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600/80 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
            title={
              pipelineCNoCoverage
                ? 'Google Solar API has no coverage for this area. Use Pipeline B (Generate Roof Geometry) instead.'
                : googleSolarApiConfigured === false
                  ? 'Google Solar API key not configured — ask your admin to set GOOGLE_SOLAR_API_KEY'
                  : googleSolarApiConfigured === null
                    ? 'Checking API configuration…'
                    : 'Use Google Solar API to get real roof polygon shapes from aerial imagery'
            }
          >
            {pipelineCLoading ? (
              <RefreshCw size={12} className="animate-spin" />
            ) : pipelineCNoCoverage ? (
              <AlertTriangle size={12} className="opacity-60" />
            ) : googleSolarApiConfigured === false ? (
              <Sun size={12} className="opacity-50" />
            ) : (
              <Sun size={12} />
            )}
            {pipelineCLoading ? 'Fetching Solar API…' : pipelineCNoCoverage ? 'Solar API (No Coverage)' : googleSolarApiConfigured === false ? 'Solar API (No Key)' : 'Google Solar API (Real Shapes)'}
          </button>
          {hasAnyData && (
            <button
              onClick={() => fetchBundle()}
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
                {generationSummary || 'Processing… This may take a few minutes.'}
              </span>
            </div>
          </div>
        )}

        {pipelineStatus === 'completed' && generationSummary && (
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-2.5">
            <p className="text-[11px] font-semibold text-emerald-300">Geometry generated</p>
            <p className="mt-0.5 text-[10px] text-emerald-100/70">{generationSummary}</p>
          </div>
        )}

        {pipelineStatus === 'failed' && pipelineError && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-2.5">
            <p className="text-[11px] font-semibold text-red-300">Error</p>
            <p className="mt-0.5 text-[10px] text-red-200/70">{pipelineError}</p>
          </div>
        )}

        {/* ── Pipeline C (Solar API) Status ── */}
        {pipelineCSummary && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-2.5">
            <p className="text-[11px] font-semibold text-amber-300">Solar API Result</p>
            <p className="mt-0.5 text-[10px] text-amber-100/70">{pipelineCSummary}</p>
          </div>
        )}
        {pipelineCNoCoverage && pipelineCError && (
          <div className="rounded-lg border border-slate-600/30 bg-slate-800/50 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle size={14} className="text-slate-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-[11px] font-semibold text-slate-300">
                  Google Solar API — No Coverage for This Area
                </p>
                <p className="mt-1 text-[10px] text-slate-400 leading-relaxed">
                  {pipelineCError}
                </p>
                <div className="mt-2">
                  <button
                    onClick={runPipelineB}
                    disabled={pipelineStatus === 'running'}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600/80 px-3 py-1.5 text-[10px] font-semibold text-white shadow-sm transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {pipelineStatus === 'running' ? (
                      <RefreshCw size={10} className="animate-spin" />
                    ) : (
                      <Layers size={10} />
                    )}
                    Generate Roof Geometry Instead
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        {pipelineCError && !pipelineCNoCoverage && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5">
            <div className="flex items-start gap-2">
              <AlertTriangle size={12} className="text-amber-400 mt-0.5 flex-shrink-0" />
              <p className="text-[10px] text-amber-200/70">{pipelineCError}</p>
            </div>
          </div>
        )}

        {/* ── Per-Photo Segmentation Status ── */}
        {photoResults.length > 0 && (
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
            <div className="flex items-center gap-2 mb-2">
              <Camera size={12} className="text-emerald-400" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400">Photo Segmentation Status</span>
              <span className="text-[9px] text-emerald-300/60">
                {photoResults.filter(r => r.status === 'sam2_success').length}/{photoResults.length} SAM 2 success
              </span>
            </div>

            {/* Summary counts */}
            <div className="flex flex-wrap gap-1.5 mb-2">
              {(() => {
                const successCount = photoResults.filter(r => r.status === 'sam2_success').length;
                const failedCount = photoResults.filter(r => r.status === 'sam2_failed').length;
                const skippedBudget = photoResults.filter(r => r.status === 'skipped_budget').length;
                const skippedTimeout = photoResults.filter(r => r.status === 'skipped_timeout').length;
                const skippedWarmup = photoResults.filter(r => r.status === 'skipped_warmup').length;
                const skippedNotConfig = photoResults.filter(r => r.status === 'skipped_not_configured').length;
                return (
                  <>
                    {successCount > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[9px] font-medium text-emerald-300">
                        <CheckCircle size={8} /> {successCount} SAM 2
                      </span>
                    )}
                    {failedCount > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[9px] font-medium text-red-300">
                        <XCircle size={8} /> {failedCount} failed
                      </span>
                    )}
                    {skippedBudget > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[9px] font-medium text-amber-300">
                        <SkipForward size={8} /> {skippedBudget} budget
                      </span>
                    )}
                    {skippedTimeout > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/15 px-2 py-0.5 text-[9px] font-medium text-orange-300">
                        <Clock size={8} /> {skippedTimeout} timeout
                      </span>
                    )}
                    {skippedWarmup > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-500/15 px-2 py-0.5 text-[9px] font-medium text-slate-300">
                        <AlertTriangle size={8} /> {skippedWarmup} warm-up fail
                      </span>
                    )}
                    {skippedNotConfig > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-500/15 px-2 py-0.5 text-[9px] font-medium text-slate-400">
                        <Cpu size={8} /> {skippedNotConfig} no SAM 2 URL
                      </span>
                    )}
                  </>
                );
              })()}
            </div>

            {budgetExhaustedReason && (
              <p className="text-[9px] text-amber-300/60 mb-2">Budget reason: {budgetExhaustedReason}</p>
            )}

            {/* Per-photo list -- successes first, then failures, then skips */}
            <div className="max-h-40 overflow-y-auto space-y-1">
              {(() => {
                const sorted = [...photoResults].sort((a, b) => {
                  const order: Record<string, number> = {
                    sam2_success: 0,
                    sam2_failed: 1,
                    skipped_budget: 2,
                    skipped_timeout: 3,
                    skipped_warmup: 4,
                    skipped_not_configured: 5,
                  };
                  return (order[a.status] ?? 9) - (order[b.status] ?? 9);
                });
                return sorted.map((pr) => {
                  const isSuccess = pr.status === 'sam2_success';
                  const isFailed = pr.status === 'sam2_failed';
                  const isSkip = pr.status.startsWith('skipped_');
                  const icon = isSuccess
                    ? <CheckCircle size={10} className="text-emerald-400 flex-shrink-0" />
                    : isFailed
                      ? <XCircle size={10} className="text-red-400 flex-shrink-0" />
                      : <SkipForward size={10} className="text-slate-400 flex-shrink-0" />;
                  const label = pr.label
                    ? pr.label.replace(/_/g, ' ')
                    : pr.filename ?? pr.fileId.slice(0, 8);
                  const statusLabel = pr.status.replace(/_/g, ' ');
                  const rowBg = isSuccess
                    ? 'bg-emerald-500/5 border border-emerald-500/10'
                    : isFailed
                      ? 'bg-red-500/5 border border-red-500/10'
                      : 'bg-slate-800/30 border border-slate-700/30';
                  const textColor = isSuccess
                    ? 'text-emerald-200'
                    : isFailed
                      ? 'text-red-200'
                      : 'text-slate-400';
                  return (
                    <div
                      key={pr.fileId}
                      className={"flex items-center gap-2 rounded px-2 py-1 text-[10px] " + rowBg}
                    >
                      {icon}
                      <span className={"truncate flex-1 " + textColor}>{label}</span>
                      {isSuccess && pr.maskCount > 0 && (
                        <span className="text-[9px] text-emerald-400/60">{pr.maskCount} mask{pr.maskCount !== 1 ? 's' : ''}</span>
                      )}
                      {!isSuccess && (
                        <span className="text-[9px] text-slate-500">{statusLabel}</span>
                      )}
                      {pr.reason && (
                        <span className="text-[9px] text-slate-500 truncate max-w-[200px]" title={pr.reason}>{pr.reason}</span>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
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
              Polygons: {polygonArtifactCount}
            </span>
            <span className="rounded-full border border-slate-700/40 bg-slate-900/30 px-2.5 py-1 text-[10px] text-slate-500">
              Consensus planes: {consensusPlaneCount}
            </span>
            <span className="rounded-full border border-slate-700/40 bg-slate-900/30 px-2.5 py-1 text-[10px] text-slate-500">
              Source: {hasPipelineCData ? 'Google Solar API + ' : ''}{hasPipelineBData ? 'Geometry Recon + ' : ''}Photo Vision
            </span>
          </div>
        )}

        {/* ── Geometry Stats Summary Panel ── */}
        {hasAnyData && (geometryStats.planeCount > 0 || geometryStats.lineCount > 0) && (
          <div className="rounded-lg border border-slate-700/40 bg-slate-900/30 p-3">
            <div className="flex items-center gap-2 mb-2">
              <Eye size={12} className="text-slate-400" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Geometry Stats</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {/* Total planes */}
              <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-2">
                <p className="text-[9px] text-emerald-400/70 uppercase tracking-wider">Planes</p>
                <p className="text-lg font-bold text-emerald-300">{geometryStats.planeCount}</p>
                {geometryStats.totalAreaSqM > 0 && (
                  <p className="text-[9px] text-emerald-400/50">{geometryStats.totalAreaSqM.toFixed(1)} m² total</p>
                )}
              </div>
              {/* Total lines */}
              <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-2.5 py-2">
                <p className="text-[9px] text-amber-400/70 uppercase tracking-wider">Roof Lines</p>
                <p className="text-lg font-bold text-amber-300">{geometryStats.lineCount}</p>
                {geometryStats.totalLineLengthM > 0 && (
                  <p className="text-[9px] text-amber-400/50">{geometryStats.totalLineLengthM.toFixed(1)} m total</p>
                )}
              </div>
              {/* Avg confidence */}
              <div className="rounded-md border border-blue-500/20 bg-blue-500/5 px-2.5 py-2">
                <p className="text-[9px] text-blue-400/70 uppercase tracking-wider">Avg Confidence</p>
                <p className="text-lg font-bold text-blue-300">{geometryStats.avgConfidence != null ? `${Math.round(geometryStats.avgConfidence)}%` : '—'}</p>
                {geometryStats.avgLineConfidence != null && geometryStats.lineCount > 0 && (
                  <p className="text-[9px] text-blue-400/50">Lines: {Math.round(geometryStats.avgLineConfidence)}%</p>
                )}
              </div>
              {/* Pitch / Azimuth range */}
              <div className="rounded-md border border-violet-500/20 bg-violet-500/5 px-2.5 py-2">
                <p className="text-[9px] text-violet-400/70 uppercase tracking-wider">Pitch / Azimuth</p>
                {geometryStats.pitchRange ? (
                  <p className="text-sm font-bold text-violet-300">{geometryStats.pitchRange.min}°–{geometryStats.pitchRange.max}°</p>
                ) : (
                  <p className="text-sm font-bold text-slate-500">—</p>
                )}
                {geometryStats.azimuthRange ? (
                  <p className="text-[9px] text-violet-400/50">Az: {geometryStats.azimuthRange.min}°–{geometryStats.azimuthRange.max}°</p>
                ) : null}
              </div>
            </div>

            {/* Line subtype breakdown (if any roof lines) */}
            {geometryStats.lineCount > 0 && Object.keys(geometryStats.lineSubtypes).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {Object.entries(geometryStats.lineSubtypes).map(([sub, count]) => (
                  <span
                    key={sub}
                    className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[9px] text-amber-300"
                  >
                    {sub.replace(/_/g, ' ')}: {count}
                  </span>
                ))}
              </div>
            )}

            {/* Pass 3E: Segmentation mask participation breakdown */}
            {geometryStats.segMaskCount > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2 py-0.5 text-[9px] text-cyan-300">
                  Masks: {geometryStats.segMaskCount}
                </span>
                <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[9px] text-emerald-300">
                  Geometry: {geometryStats.participatingMaskCount}
                </span>
                {geometryStats.excludedMaskCount > 0 && (
                  <span className="rounded-full border border-orange-500/20 bg-orange-500/10 px-2 py-0.5 text-[9px] text-orange-300">
                    Excluded: {geometryStats.excludedMaskCount}
                  </span>
                )}
                {geometryStats.partialMaskCount > 0 && (
                  <span className="rounded-full border border-yellow-500/20 bg-yellow-500/10 px-2 py-0.5 text-[9px] text-yellow-300">
                    Partial: {geometryStats.partialMaskCount}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Info banner when no Pipeline B/C data ── */}
        {hasPipelineAData && !hasPipelineBData && !hasPipelineCData && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5">
            <div className="flex items-start gap-2">
              <AlertTriangle size={12} className="text-amber-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-[10px] font-semibold text-amber-200">
                  Bounding boxes only — use &quot;Google Solar API&quot; for real roof shapes
                </p>
                <p className="mt-0.5 text-[10px] text-amber-100/60">
                  The current overlay shows bounding boxes from photo vision. The Google Solar API
                  button fetches actual roof plane polygons with pitch, azimuth, and area data
                  from aerial imagery. Click &quot;Generate Roof Geometry&quot; for the reconstruction
                  pipeline alternative.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── Photo + Geometry Overlay ── */}
        {hasAnyData && filesWithArtifacts.length > 0 && (
          <div className="rounded-lg border border-slate-700/40 bg-slate-950/30 p-2">
            {/* Debug roof-line toggle & polygon detail toggle */}
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <button
                type="button"
                onClick={() => setShowDebugRoofLines(!showDebugRoofLines)}
                className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-[9px] font-medium transition ${
                  showDebugRoofLines
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30'
                    : 'bg-slate-800/50 text-slate-500 border border-slate-700/40 hover:text-slate-300'
                }`}
                title={showDebugRoofLines
                  ? 'Currently showing ALL roof-line candidates with thick debug rendering. Click to return to review-friendly thin lines.'
                  : 'Currently showing only high-confidence, deduplicated roof lines. Click to show ALL candidates with thick debug rendering.'
                }
              >
                {showDebugRoofLines ? (
                  <>🔍 Debug Lines: ON (showing all candidates)</>
                ) : (
                  <>📋 Show Debug Roof-Line Candidates</>
                )}
              </button>
              {showDebugRoofLines && (
                <span className="text-[8px] text-amber-400/60">
                  Thick lines visible. Low-confidence & duplicate lines shown.
                </span>
              )}
              {/* Per-photo overlay status indicator */}
              {bundleMode === 'stats' && overlayArtifactsByFile.size === 0 && !overlayLoading && selectedFileId && (
                <span className="inline-flex items-center gap-1 text-[9px] text-slate-500">
                  <Shapes size={10} />
                  Click a photo to load polygons
                </span>
              )}
              {bundleMode === 'stats' && overlayLoading && (
                <span className="inline-flex items-center gap-1 text-[9px] text-cyan-400 animate-pulse">
                  <Shapes size={10} />
                  Loading polygons...
                </span>
              )}
              {bundleMode === 'stats' && overlayArtifactsByFile.size > 0 && !overlayLoading && (
                <span className="inline-flex items-center gap-1 text-[9px] text-cyan-400/60">
                  <Shapes size={10} />
                  Polygons loaded for {overlayArtifactsByFile.size} photo{overlayArtifactsByFile.size !== 1 ? 's' : ''}
                </span>
              )}
              {bundleMode === 'overlay' && (
                <span className="inline-flex items-center gap-1 text-[9px] text-cyan-400/60">
                  <Shapes size={10} />
                  All polygon detail loaded
                </span>
              )}
              {/* Load All Polygons button removed — per-photo overlay makes it unnecessary and it could exceed Vercel 4.5MB limit */}
            </div>
            <OverlayErrorBoundary>
              <UnifiedGeometryOverlayRenderer
                filesWithArtifacts={filesWithArtifacts}
                selectedFileId={selectedFileId}
                onSelectFile={setSelectedFileId}
                showMockArtifacts={true}
                showDebugRoofLines={showDebugRoofLines}
              />
            </OverlayErrorBoundary>
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
                          : artifact.provenance?.sourcePipeline === 'google_solar_api'
                            ? 'bg-amber-400'
                            : 'bg-blue-400'
                      }`}
                    />
                    <span className="text-[10px] text-slate-300">
                      {artifact.geometryClass.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] text-slate-500">
                      {artifact.provenance?.sourcePipeline === 'google_solar_api' ? 'Pipeline C' : artifact.provenance?.sourcePipeline === 'geometry_recon' ? 'Pipeline B' : 'Pipeline A'}
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
