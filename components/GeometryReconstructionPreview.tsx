'use client';

/**
 * GeometryReconstructionPreview — research-spike UI for geometry reconstruction.
 *
 * Displays roof plane, wall plane, line, segmentation mask, depth map,
 * and consensus plane candidates produced by the geometry reconstruction
 * pipeline (mock or real). All artifacts are review-only operator aids.
 *
 * V2 adds: toggle filters, provenance display, new artifact card types.
 *
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 */

import { useState, useCallback } from 'react';
import {
  AlertTriangle,
  Box,
  Eye,
  Layers,
  RefreshCw,
  Shield,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronUp,
  Triangle,
  Minus,
  Hexagon,
  Mountain,
  Scan,
  GitMerge,
  Filter,
} from 'lucide-react';
import type {
  GeometryReconstructionResult,
  GeometryReconstructionArtifact,
  RoofPlaneCandidate,
  WallPlaneCandidate,
  LineCandidate,
  SemanticSegmentationMask,
  StructuralLineCandidate,
  DepthMap,
  ConsensusPlaneCandidate,
  JobStatus,
} from '@/lib/siteSurveys/geometryReconstruction';

/* ── Local types ────────────────────────────────────────────────────────── */

interface GeometryReconstructionPreviewProps {
  surveyId: string;
  /** Pre-loaded result, if any. */
  initialResult?: GeometryReconstructionResult | null;
}

type ArtifactGroupKey =
  | 'roof_planes'
  | 'wall_planes'
  | 'lines'
  | 'structural_lines'
  | 'depth_maps'
  | 'point_clouds'
  | 'segmentation_masks'
  | 'vanishing_points'
  | 'consensus_planes';

interface GroupedCounts {
  roof_planes: number;
  wall_planes: number;
  lines: number;
  structural_lines: number;
  depth_maps: number;
  point_clouds: number;
  segmentation_masks: number;
  vanishing_points: number;
  consensus_planes: number;
}

type ToggleKey =
  | 'roof_planes'
  | 'wall_planes'
  | 'lines'
  | 'structural_lines'
  | 'segmentation_masks'
  | 'depth_maps'
  | 'consensus_planes';

/* ── Helpers ────────────────────────────────────────────────────────────── */

function groupArtifacts(artifacts: GeometryReconstructionArtifact[]): GroupedCounts {
  const counts: GroupedCounts = {
    roof_planes: 0,
    wall_planes: 0,
    lines: 0,
    structural_lines: 0,
    depth_maps: 0,
    point_clouds: 0,
    segmentation_masks: 0,
    vanishing_points: 0,
    consensus_planes: 0,
  };
  for (const a of artifacts) {
    switch (a.artifactType) {
      case 'roof_plane_candidate':
        counts.roof_planes++;
        break;
      case 'wall_plane_candidate':
        counts.wall_planes++;
        break;
      case 'ridge_line_candidate':
      case 'eave_line_candidate':
      case 'rake_line_candidate':
        counts.lines++;
        break;
      case 'structural_line_candidate':
        counts.structural_lines++;
        break;
      case 'depth_map':
        counts.depth_maps++;
        break;
      case 'sfm_point_cloud':
        counts.point_clouds++;
        break;
      case 'segmentation_mask':
        counts.segmentation_masks++;
        break;
      case 'semantic_segmentation_mask':
        counts.segmentation_masks++;
        break;
      case 'vanishing_point':
        counts.vanishing_points++;
        break;
      case 'consensus_plane_candidate':
        counts.consensus_planes++;
        break;
      case 'plane_candidate':
        counts.roof_planes++;
        break;
    }
  }
  return counts;
}

function statusColor(status: JobStatus): string {
  switch (status) {
    case 'completed':
      return 'text-emerald-400';
    case 'running':
      return 'text-blue-400';
    case 'queued':
      return 'text-slate-400';
    case 'failed':
      return 'text-red-400';
    case 'cancelled':
      return 'text-amber-400';
  }
}

function statusIcon(status: JobStatus) {
  switch (status) {
    case 'completed':
      return <CheckCircle size={12} className="text-emerald-400" />;
    case 'running':
      return <RefreshCw size={12} className="text-blue-400 animate-spin" />;
    case 'queued':
      return <Layers size={12} className="text-slate-400" />;
    case 'failed':
      return <XCircle size={12} className="text-red-400" />;
    case 'cancelled':
      return <AlertTriangle size={12} className="text-amber-400" />;
  }
}

function formatLineType(artifactType: string): string {
  switch (artifactType) {
    case 'ridge_line_candidate':
      return 'Ridge';
    case 'eave_line_candidate':
      return 'Eave';
    case 'rake_line_candidate':
      return 'Rake';
    default:
      return artifactType;
  }
}

function formatStructuralLineType(lineType: string): string {
  switch (lineType) {
    case 'ridge':
      return 'Ridge';
    case 'eave':
      return 'Eave';
    case 'rake':
      return 'Rake';
    case 'wall_vertical':
      return 'Wall Vertical';
    case 'hip':
      return 'Hip';
    case 'valley':
      return 'Valley';
    default:
      return lineType;
  }
}

/* ── Sub-components ─────────────────────────────────────────────────────── */

function ReviewOnlyBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-300 ring-1 ring-amber-500/30">
      <Shield size={9} />
      Review-Only
    </span>
  );
}

function NonAuthoritativeBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-500/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-400 ring-1 ring-slate-500/30">
      <Eye size={9} />
      Non-Authoritative
    </span>
  );
}

function NoCadMutationBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-red-300/80 ring-1 ring-red-500/25">
      <XCircle size={9} />
      No CAD Mutation
    </span>
  );
}

function ProvenanceBadge({ workerVersion }: { workerVersion?: string }) {
  if (!workerVersion) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-700/50 px-1.5 py-0.5 text-[8px] font-mono text-slate-400 ring-1 ring-slate-600/50">
      v{workerVersion}
    </span>
  );
}

function StageTimingsRow({ timings }: { timings?: Record<string, number> }) {
  if (!timings || Object.keys(timings).length === 0) return null;
  const entries = Object.entries(timings).filter(([k]) => k !== 'total');
  if (entries.length === 0) return null;
  return (
    <div className="mt-1 text-[8px] text-slate-500">
      {entries.map(([stage, ms]) => (
        <span key={stage} className="mr-2">
          {stage}: {ms.toFixed(1)}ms
        </span>
      ))}
    </div>
  );
}

function RoofPlaneCard({ candidate, index }: { candidate: RoofPlaneCandidate; index: number }) {
  return (
    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Triangle size={12} className="text-emerald-400" />
          <span className="text-[11px] font-semibold text-emerald-300">
            Roof Plane #{index + 1}
          </span>
        </div>
        <span className="text-[10px] text-slate-400">
          conf: {candidate.confidence}%
        </span>
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px] text-slate-400">
        <span>Slope: {candidate.slopeDegrees.toFixed(1)}°</span>
        <span>Aspect: {candidate.aspectDegrees.toFixed(1)}°</span>
        <span>Inliers: {candidate.inlierCount}/{candidate.totalPoints}</span>
        <span>Lines: {candidate.associatedLineIds.length}</span>
      </div>
      {candidate.limitations.length > 0 && (
        <div className="mt-1.5 rounded border border-amber-500/10 bg-amber-500/5 px-1.5 py-1">
          <p className="text-[9px] text-amber-300/70">{candidate.limitations[0]}</p>
        </div>
      )}
    </div>
  );
}

function WallPlaneCard({ candidate, index }: { candidate: WallPlaneCandidate; index: number }) {
  return (
    <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Box size={12} className="text-blue-400" />
          <span className="text-[11px] font-semibold text-blue-300">
            Wall Plane #{index + 1}
          </span>
        </div>
        <span className="text-[10px] text-slate-400">
          conf: {candidate.confidence}%
        </span>
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px] text-slate-400">
        {candidate.estimatedHeightM != null && (
          <span>Height: {candidate.estimatedHeightM.toFixed(1)}m</span>
        )}
        {candidate.facingDirection && (
          <span>Facing: {candidate.facingDirection}</span>
        )}
        <span>Inliers: {candidate.inlierCount}/{candidate.totalPoints}</span>
        <span>Lines: {candidate.associatedLineIds.length}</span>
      </div>
      {candidate.limitations.length > 0 && (
        <div className="mt-1.5 rounded border border-amber-500/10 bg-amber-500/5 px-1.5 py-1">
          <p className="text-[9px] text-amber-300/70">{candidate.limitations[0]}</p>
        </div>
      )}
    </div>
  );
}

function LineCard({ candidate, index }: { candidate: LineCandidate; index: number }) {
  const lineLabel = formatLineType(candidate.artifactType);
  const lineColor =
    candidate.artifactType === 'ridge_line_candidate'
      ? 'text-rose-300'
      : candidate.artifactType === 'eave_line_candidate'
        ? 'text-cyan-300'
        : 'text-purple-300';
  const borderColor =
    candidate.artifactType === 'ridge_line_candidate'
      ? 'border-rose-500/20 bg-rose-500/5'
      : candidate.artifactType === 'eave_line_candidate'
        ? 'border-cyan-500/20 bg-cyan-500/5'
        : 'border-purple-500/20 bg-purple-500/5';

  return (
    <div className={`rounded-lg border p-2.5 ${borderColor}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Minus size={12} className={lineColor} />
          <span className={`text-[11px] font-semibold ${lineColor}`}>
            {lineLabel} Line #{index + 1}
          </span>
        </div>
        <span className="text-[10px] text-slate-400">
          conf: {candidate.confidence}%
        </span>
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px] text-slate-400">
        {candidate.estimatedLengthM != null && (
          <span>Length: {candidate.estimatedLengthM.toFixed(2)}m</span>
        )}
        <span>Start: [{candidate.startPoint.map((v) => v.toFixed(1)).join(', ')}]</span>
        <span>End: [{candidate.endPoint.map((v) => v.toFixed(1)).join(', ')}]</span>
      </div>
      {candidate.limitations.length > 0 && (
        <div className="mt-1.5 rounded border border-amber-500/10 bg-amber-500/5 px-1.5 py-1">
          <p className="text-[9px] text-amber-300/70">{candidate.limitations[0]}</p>
        </div>
      )}
    </div>
  );
}

/* ── NEW V2 CARDS ── */

function SegmentationMaskCard({ candidate, index }: { candidate: SemanticSegmentationMask; index: number }) {
  return (
    <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Scan size={12} className="text-cyan-400" />
          <span className="text-[11px] font-semibold text-cyan-300">
            {candidate.segmentationClass} Mask #{index + 1}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <ProvenanceBadge workerVersion={candidate.workerVersion} />
          <span className="text-[10px] text-slate-400">
            conf: {candidate.confidence}%
          </span>
        </div>
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px] text-slate-400">
        <span>Class: {candidate.segmentationClass}</span>
        <span>Vertices: {candidate.polygon.length}</span>
        <span>File: {candidate.fileId}</span>
      </div>
      <StageTimingsRow timings={candidate.stageTimings} />
      {candidate.limitations.length > 0 && (
        <div className="mt-1.5 rounded border border-amber-500/10 bg-amber-500/5 px-1.5 py-1">
          <p className="text-[9px] text-amber-300/70">{candidate.limitations[0]}</p>
        </div>
      )}
    </div>
  );
}

function StructuralLineCard({ candidate, index }: { candidate: StructuralLineCandidate; index: number }) {
  const lineLabel = formatStructuralLineType(candidate.lineType);
  const lineColor =
    candidate.lineType === 'ridge' ? 'text-rose-300' :
    candidate.lineType === 'eave' ? 'text-cyan-300' :
    candidate.lineType === 'wall_vertical' ? 'text-orange-300' :
    'text-purple-300';
  const borderColor =
    candidate.lineType === 'ridge' ? 'border-rose-500/20 bg-rose-500/5' :
    candidate.lineType === 'eave' ? 'border-cyan-500/20 bg-cyan-500/5' :
    candidate.lineType === 'wall_vertical' ? 'border-orange-500/20 bg-orange-500/5' :
    'border-purple-500/20 bg-purple-500/5';

  return (
    <div className={`rounded-lg border p-2.5 ${borderColor}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Minus size={12} className={lineColor} />
          <span className={`text-[11px] font-semibold ${lineColor}`}>
            {lineLabel} #{index + 1}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <ProvenanceBadge workerVersion={candidate.workerVersion} />
          <span className="text-[10px] text-slate-400">
            conf: {candidate.confidence}%
          </span>
        </div>
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px] text-slate-400">
        <span>Type: {candidate.lineType}</span>
        <span>File: {candidate.fileId}</span>
        <span>Start: ({candidate.start.x.toFixed(0)}, {candidate.start.y.toFixed(0)})</span>
        <span>End: ({candidate.end.x.toFixed(0)}, {candidate.end.y.toFixed(0)})</span>
      </div>
      <StageTimingsRow timings={candidate.stageTimings} />
      {candidate.limitations.length > 0 && (
        <div className="mt-1.5 rounded border border-amber-500/10 bg-amber-500/5 px-1.5 py-1">
          <p className="text-[9px] text-amber-300/70">{candidate.limitations[0]}</p>
        </div>
      )}
    </div>
  );
}

function DepthMapCard({ candidate, index }: { candidate: DepthMap; index: number }) {
  return (
    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Mountain size={12} className="text-amber-400" />
          <span className="text-[11px] font-semibold text-amber-300">
            Depth Map #{index + 1}
          </span>
        </div>
        <span className="text-[10px] text-slate-400">
          conf: {candidate.confidence}%
        </span>
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px] text-slate-400">
        <span>Resolution: {candidate.width}×{candidate.height}</span>
        <span>Metric: {candidate.depthMetric}</span>
        <span>File: {candidate.fileId}</span>
      </div>
      {candidate.limitations.length > 0 && (
        <div className="mt-1.5 rounded border border-amber-500/10 bg-amber-500/5 px-1.5 py-1">
          <p className="text-[9px] text-amber-300/70">{candidate.limitations[0]}</p>
        </div>
      )}
    </div>
  );
}

function ConsensusPlaneCard({ candidate, index }: { candidate: ConsensusPlaneCandidate; index: number }) {
  return (
    <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Hexagon size={12} className="text-violet-400" />
          <span className="text-[11px] font-semibold text-violet-300">
            Consensus {candidate.planeType === 'roof' ? 'Roof' : 'Wall'} #{index + 1}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <ProvenanceBadge workerVersion={candidate.workerVersion} />
          <span className="text-[10px] text-slate-400">
            conf: {candidate.confidence}%
          </span>
        </div>
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px] text-slate-400">
        {candidate.estimatedPitch != null && (
          <span>Pitch: {candidate.estimatedPitch}°</span>
        )}
        {candidate.estimatedAzimuth != null && (
          <span>Azimuth: {candidate.estimatedAzimuth}°</span>
        )}
        <span>Photos: {candidate.consensusPhotoCount}</span>
        <span>Vertices: {candidate.polygon.length}</span>
        <span>Normal: ({candidate.normalVector.x.toFixed(2)}, {candidate.normalVector.y.toFixed(2)}, {candidate.normalVector.z.toFixed(2)})</span>
      </div>
      {/* Source file provenance */}
      {candidate.sourceFileIds.length > 0 && (
        <div className="mt-1 text-[9px] text-slate-500">
          Sources: {candidate.sourceFileIds.join(', ')}
        </div>
      )}
      <StageTimingsRow timings={candidate.stageTimings} />
      {candidate.limitations.length > 0 && (
        <div className="mt-1.5 rounded border border-amber-500/10 bg-amber-500/5 px-1.5 py-1">
          <p className="text-[9px] text-amber-300/70">{candidate.limitations[0]}</p>
        </div>
      )}
    </div>
  );
}

/* ── Toggle filter ──────────────────────────────────────────────────────── */

function ToggleFilters({
  toggles,
  onToggle,
  counts,
}: {
  toggles: Record<ToggleKey, boolean>;
  onToggle: (key: ToggleKey) => void;
  counts: GroupedCounts;
}) {
  const items: { key: ToggleKey; label: string; color: string; icon: typeof Eye }[] = [
    { key: 'segmentation_masks', label: 'Masks', color: 'cyan', icon: Scan },
    { key: 'structural_lines', label: 'Lines', color: 'rose', icon: Minus },
    { key: 'roof_planes', label: 'Roof Planes', color: 'emerald', icon: Triangle },
    { key: 'wall_planes', label: 'Wall Planes', color: 'blue', icon: Box },
    { key: 'depth_maps', label: 'Depth', color: 'amber', icon: Mountain },
    { key: 'consensus_planes', label: 'Consensus', color: 'violet', icon: Hexagon },
    { key: 'lines', label: 'Legacy Lines', color: 'purple', icon: GitMerge },
  ];

  return (
    <div className="mb-3 flex flex-wrap gap-1.5">
      <div className="flex items-center gap-1 mr-1">
        <Filter size={10} className="text-slate-500" />
        <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">Filter:</span>
      </div>
      {items.map(({ key, label, color, icon: Icon }) => {
        const active = toggles[key];
        const count = counts[key];
        if (count === 0 && !active) return null;
        const colorMap: Record<string, string> = {
          emerald: active ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300' : 'bg-slate-800/50 border-slate-700 text-slate-500',
          blue: active ? 'bg-blue-500/20 border-blue-500/40 text-blue-300' : 'bg-slate-800/50 border-slate-700 text-slate-500',
          rose: active ? 'bg-rose-500/20 border-rose-500/40 text-rose-300' : 'bg-slate-800/50 border-slate-700 text-slate-500',
          amber: active ? 'bg-amber-500/20 border-amber-500/40 text-amber-300' : 'bg-slate-800/50 border-slate-700 text-slate-500',
          purple: active ? 'bg-purple-500/20 border-purple-500/40 text-purple-300' : 'bg-slate-800/50 border-slate-700 text-slate-500',
          cyan: active ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300' : 'bg-slate-800/50 border-slate-700 text-slate-500',
          violet: active ? 'bg-violet-500/20 border-violet-500/40 text-violet-300' : 'bg-slate-800/50 border-slate-700 text-slate-500',
        };
        const classes = colorMap[color] ?? colorMap['emerald'];
        return (
          <button
            key={key}
            onClick={() => onToggle(key)}
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[9px] font-semibold transition ${classes}`}
          >
            <Icon size={9} />
            {label}
            <span className="opacity-70">({count})</span>
          </button>
        );
      })}
    </div>
  );
}

/* ── Main component ─────────────────────────────────────────────────────── */

export default function GeometryReconstructionPreview({
  surveyId,
  initialResult,
}: GeometryReconstructionPreviewProps) {
  const [result, setResult] = useState<GeometryReconstructionResult | null>(initialResult ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [artifactsExpanded, setArtifactsExpanded] = useState(true);

  // V2: Toggle state for artifact type filters
  const [toggles, setToggles] = useState<Record<ToggleKey, boolean>>({
    roof_planes: true,
    wall_planes: true,
    lines: true,
    structural_lines: true,
    segmentation_masks: true,
    depth_maps: true,
    consensus_planes: true,
  });

  const handleToggle = useCallback((key: ToggleKey) => {
    setToggles((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const runMockReconstruction = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/site-surveys/${surveyId}/geometry-reconstruction/mock`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      const json = await res.json();
      // API returns result fields at top level (success, schemaVersion, job, artifacts, …)
      setResult((json.data ?? json) as GeometryReconstructionResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [surveyId]);

  const runFullPipeline = useCallback(async () => {
    setLoading(true);
    setError(null);
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
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      const json = await res.json();
      setResult((json.data ?? json) as GeometryReconstructionResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [surveyId]);

  const loadArtifacts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/site-surveys/${surveyId}/geometry-reconstruction/artifacts`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      const json = await res.json();
      // API returns result fields at top level (success, schemaVersion, job, artifacts, …)
      setResult((json.data ?? json) as GeometryReconstructionResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [surveyId]);

  const artifacts = result?.artifacts ?? [];
  const grouped = groupArtifacts(artifacts);
  const job = result?.job;

  // Filtered artifacts by toggle state
  const roofPlanes = toggles.roof_planes
    ? artifacts.filter((a): a is RoofPlaneCandidate => a.artifactType === 'roof_plane_candidate')
    : [];
  const wallPlanes = toggles.wall_planes
    ? artifacts.filter((a): a is WallPlaneCandidate => a.artifactType === 'wall_plane_candidate')
    : [];
  const lineCandidates = toggles.lines
    ? artifacts.filter(
        (a): a is LineCandidate =>
          a.artifactType === 'ridge_line_candidate' ||
          a.artifactType === 'eave_line_candidate' ||
          a.artifactType === 'rake_line_candidate',
      )
    : [];
  const segmentationMasks = toggles.segmentation_masks
    ? artifacts.filter((a): a is SemanticSegmentationMask => a.artifactType === 'semantic_segmentation_mask')
    : [];
  const structuralLines = toggles.structural_lines
    ? artifacts.filter((a): a is StructuralLineCandidate => a.artifactType === 'structural_line_candidate')
    : [];
  const depthMaps = toggles.depth_maps
    ? artifacts.filter((a): a is DepthMap => a.artifactType === 'depth_map')
    : [];
  const consensusPlanes = toggles.consensus_planes
    ? artifacts.filter((a): a is ConsensusPlaneCandidate => a.artifactType === 'consensus_plane_candidate')
    : [];

  const hasVisibleArtifacts =
    roofPlanes.length + wallPlanes.length + lineCandidates.length +
    segmentationMasks.length + structuralLines.length + depthMaps.length +
    consensusPlanes.length > 0;

  return (
    <div className="rounded-xl border border-violet-500/20 bg-slate-950/60">
      {/* Header */}
      <div
        className="flex cursor-pointer items-center justify-between px-4 py-3"
        onClick={() => setExpanded(!expanded)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setExpanded(!expanded); }}
      >
        <div className="flex items-center gap-2">
          <Layers size={14} className="text-violet-400" />
          <h3 className="text-xs font-semibold text-violet-300">
            Geometry Reconstruction Preview
          </h3>
          <ReviewOnlyBadge />
        </div>
        {expanded ? (
          <ChevronUp size={14} className="text-slate-500" />
        ) : (
          <ChevronDown size={14} className="text-slate-500" />
        )}
      </div>

      {expanded && (
        <div className="border-t border-violet-500/10 px-4 py-3">
          {/* Authority disclaimer */}
          <div className="mb-3 rounded-lg border border-amber-500/20 bg-amber-500/10 p-2.5">
            <div className="flex items-center gap-1.5">
              <AlertTriangle size={12} className="text-amber-400" />
              <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-200">
                Review-Only / Non-Authoritative / Not CAD Geometry
              </p>
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-amber-100/70">
              These artifacts are operator review aids only. They cannot mutate CAD, permits,
              BOM, or engineering workflows. No downstream system should treat these as
              authoritative geometry.
            </p>
          </div>

          {/* Badges row */}
          <div className="mb-3 flex flex-wrap gap-2">
            <ReviewOnlyBadge />
            <NonAuthoritativeBadge />
            <NoCadMutationBadge />
          </div>

          {/* Action buttons */}
          <div className="mb-3 flex flex-wrap gap-2">
            <button
              onClick={runFullPipeline}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600/80 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? (
                <RefreshCw size={12} className="animate-spin" />
              ) : (
                <Layers size={12} />
              )}
              Run Full Pipeline (Real Geometry)
            </button>
            <button
              onClick={runMockReconstruction}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600/80 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? (
                <RefreshCw size={12} className="animate-spin" />
              ) : (
                <Layers size={12} />
              )}
              Run Mock Reconstruction
            </button>
            <button
              onClick={loadArtifacts}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-[11px] font-semibold text-slate-300 shadow-sm transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw size={12} />
              Reload Artifacts
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-3 rounded-lg border border-red-500/20 bg-red-500/10 p-2.5">
              <p className="text-[11px] font-semibold text-red-300">Error</p>
              <p className="mt-0.5 text-[10px] text-red-200/70">{error}</p>
            </div>
          )}

          {/* Job status */}
          {job && (
            <div className="mb-3 rounded-lg border border-slate-700 bg-slate-900/50 p-2.5">
              <div className="flex items-center gap-2">
                {statusIcon(job.status)}
                <span className={`text-[11px] font-semibold ${statusColor(job.status)}`}>
                  Job {job.status}
                </span>
                <span className="text-[10px] text-slate-500">
                  Pipeline: {job.pipeline}
                </span>
              </div>
              <div className="mt-1 text-[10px] text-slate-500">
                Created: {new Date(job.createdAt).toLocaleString()}
                {job.completedAt && (
                  <> · Completed: {new Date(job.completedAt).toLocaleString()}</>
                )}
              </div>
            </div>
          )}

          {/* Artifact counts */}
          {artifacts.length > 0 && (
            <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
              <CountTile label="Roof Planes" count={grouped.roof_planes} color="emerald" />
              <CountTile label="Wall Planes" count={grouped.wall_planes} color="blue" />
              <CountTile label="Lines" count={grouped.lines + grouped.structural_lines} color="rose" />
              <CountTile label="Depth Maps" count={grouped.depth_maps} color="amber" />
              <CountTile label="Seg. Masks" count={grouped.segmentation_masks} color="cyan" />
              {grouped.consensus_planes > 0 && (
                <CountTile label="Consensus" count={grouped.consensus_planes} color="violet" />
              )}
            </div>
          )}

          {/* V2: Toggle filters */}
          {artifacts.length > 0 && (
            <ToggleFilters toggles={toggles} onToggle={handleToggle} counts={grouped} />
          )}

          {/* Artifact details */}
          {artifacts.length > 0 && (
            <div>
              <button
                className="mb-2 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-300"
                onClick={() => setArtifactsExpanded(!artifactsExpanded)}
              >
                {artifactsExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                Artifact Details ({artifacts.length})
              </button>

              {artifactsExpanded && hasVisibleArtifacts && (
                <div className="space-y-3">
                  {/* Segmentation masks */}
                  {segmentationMasks.length > 0 && (
                    <div>
                      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-cyan-300">
                        Segmentation Masks ({segmentationMasks.length})
                      </p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {segmentationMasks.map((m, i) => (
                          <SegmentationMaskCard key={`segmask-${i}`} candidate={m} index={i} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Structural lines */}
                  {structuralLines.length > 0 && (
                    <div>
                      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-rose-300">
                        Structural Lines ({structuralLines.length})
                      </p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {structuralLines.map((sl, i) => (
                          <StructuralLineCard key={`strline-${i}`} candidate={sl} index={i} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Roof planes */}
                  {roofPlanes.length > 0 && (
                    <div>
                      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                        Roof Plane Candidates ({roofPlanes.length})
                      </p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {roofPlanes.map((rp, i) => (
                          <RoofPlaneCard key={`roof-${i}`} candidate={rp} index={i} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Wall planes */}
                  {wallPlanes.length > 0 && (
                    <div>
                      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-blue-300">
                        Wall Plane Candidates ({wallPlanes.length})
                      </p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {wallPlanes.map((wp, i) => (
                          <WallPlaneCard key={`wall-${i}`} candidate={wp} index={i} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Depth maps */}
                  {depthMaps.length > 0 && (
                    <div>
                      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300">
                        Depth Maps ({depthMaps.length})
                      </p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {depthMaps.map((dm, i) => (
                          <DepthMapCard key={`depth-${i}`} candidate={dm} index={i} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Consensus planes */}
                  {consensusPlanes.length > 0 && (
                    <div>
                      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-violet-300">
                        Consensus Planes ({consensusPlanes.length})
                      </p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {consensusPlanes.map((cp, i) => (
                          <ConsensusPlaneCard key={`consensus-${i}`} candidate={cp} index={i} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Legacy line candidates */}
                  {lineCandidates.length > 0 && (
                    <div>
                      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-rose-300">
                        Line Candidates ({lineCandidates.length})
                      </p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {lineCandidates.map((lc, i) => (
                          <LineCard key={`line-${i}`} candidate={lc} index={i} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Other artifacts summary */}
                  {(grouped.point_clouds + grouped.vanishing_points) > 0 && (
                    <div className="rounded-lg border border-slate-700 bg-slate-900/30 p-2.5">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        Other Artifacts
                      </p>
                      <div className="mt-1 space-y-0.5 text-[10px] text-slate-500">
                        {grouped.point_clouds > 0 && <p>• SfM Point Clouds: {grouped.point_clouds}</p>}
                        {grouped.vanishing_points > 0 && <p>• Vanishing Points: {grouped.vanishing_points}</p>}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Empty state */}
          {!job && !loading && !error && (
            <p className="text-[11px] text-slate-500 italic">
              No reconstruction artifacts yet. Click "Run Mock Reconstruction" to generate test data.
            </p>
          )}

          {/* Bottom disclaimer */}
          {artifacts.length > 0 && (
            <div className="mt-3 border-t border-slate-800 pt-2">
              <p className="text-[9px] text-slate-600">
                All artifacts carry review-only authority. cadMutationAllowed={String(result?.authority.cadMutationAllowed ?? false)}.{' '}
                permitGenerationAllowed={String(result?.authority.permitGenerationAllowed ?? false)}.{' '}
                bomMutationAllowed={String(result?.authority.bomMutationAllowed ?? false)}.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Count tile ─────────────────────────────────────────────────────────── */

function CountTile({ label, count, color }: { label: string; count: number; color: string }) {
  const colorMap: Record<string, string> = {
    emerald: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
    blue: 'border-blue-500/20 bg-blue-500/10 text-blue-300',
    rose: 'border-rose-500/20 bg-rose-500/10 text-rose-300',
    amber: 'border-amber-500/20 bg-amber-500/10 text-amber-300',
    purple: 'border-purple-500/20 bg-purple-500/10 text-purple-300',
    cyan: 'border-cyan-500/20 bg-cyan-500/10 text-cyan-300',
    violet: 'border-violet-500/20 bg-violet-500/10 text-violet-300',
  };
  const classes = colorMap[color] ?? colorMap['emerald'];

  return (
    <div className={`rounded-lg border p-2 text-center ${classes}`}>
      <p className="text-lg font-bold">{count}</p>
      <p className="text-[9px] font-medium opacity-70">{label}</p>
    </div>
  );
}
