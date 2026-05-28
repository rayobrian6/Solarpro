'use client';

/**
 * GeometryReconstructionPreview — research-spike UI for geometry reconstruction.
 *
 * Displays roof plane, wall plane, and line candidates produced by the
 * geometry reconstruction pipeline (mock or real). All artifacts are
 * review-only operator aids.
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
} from 'lucide-react';
import type {
  GeometryReconstructionResult,
  GeometryReconstructionArtifact,
  RoofPlaneCandidate,
  WallPlaneCandidate,
  LineCandidate,
  JobStatus,
} from '@/lib/siteSurveys/geometryReconstruction';

/* ── Local types ────────────────────────────────────────────────────── */

interface GeometryReconstructionPreviewProps {
  surveyId: string;
  /** Pre-loaded result, if any. */
  initialResult?: GeometryReconstructionResult | null;
}

type ArtifactGroupKey = 'roof_planes' | 'wall_planes' | 'lines' | 'depth_maps' | 'point_clouds' | 'segmentation_masks';

interface GroupedCounts {
  roof_planes: number;
  wall_planes: number;
  lines: number;
  depth_maps: number;
  point_clouds: number;
  segmentation_masks: number;
}

/* ── Helpers ────────────────────────────────────────────────────────── */

function groupArtifacts(artifacts: GeometryReconstructionArtifact[]): GroupedCounts {
  const counts: GroupedCounts = {
    roof_planes: 0,
    wall_planes: 0,
    lines: 0,
    depth_maps: 0,
    point_clouds: 0,
    segmentation_masks: 0,
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
      case 'depth_map':
        counts.depth_maps++;
        break;
      case 'sfm_point_cloud':
        counts.point_clouds++;
        break;
      case 'segmentation_mask':
        counts.segmentation_masks++;
        break;
      case 'plane_candidate':
        // Generic plane — count as roof for UI purposes
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

/* ── Sub-components ─────────────────────────────────────────────────── */

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

/* ── Main component ─────────────────────────────────────────────────── */

export default function GeometryReconstructionPreview({
  surveyId,
  initialResult,
}: GeometryReconstructionPreviewProps) {
  const [result, setResult] = useState<GeometryReconstructionResult | null>(initialResult ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [artifactsExpanded, setArtifactsExpanded] = useState(true);

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
      setResult(json.data as GeometryReconstructionResult);
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
      setResult(json.data as GeometryReconstructionResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [surveyId]);

  const artifacts = result?.artifacts ?? [];
  const grouped = groupArtifacts(artifacts);
  const job = result?.job;

  const roofPlanes = artifacts.filter(
    (a): a is RoofPlaneCandidate => a.artifactType === 'roof_plane_candidate',
  );
  const wallPlanes = artifacts.filter(
    (a): a is WallPlaneCandidate => a.artifactType === 'wall_plane_candidate',
  );
  const lineCandidates = artifacts.filter(
    (a): a is LineCandidate =>
      a.artifactType === 'ridge_line_candidate' ||
      a.artifactType === 'eave_line_candidate' ||
      a.artifactType === 'rake_line_candidate',
  );

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
            <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
              <CountTile label="Roof Planes" count={grouped.roof_planes} color="emerald" />
              <CountTile label="Wall Planes" count={grouped.wall_planes} color="blue" />
              <CountTile label="Lines" count={grouped.lines} color="rose" />
              <CountTile label="Depth Maps" count={grouped.depth_maps} color="amber" />
              <CountTile label="Point Clouds" count={grouped.point_clouds} color="purple" />
              <CountTile label="Seg. Masks" count={grouped.segmentation_masks} color="cyan" />
            </div>
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

              {artifactsExpanded && (
                <div className="space-y-3">
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

                  {/* Line candidates */}
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
                  {(grouped.depth_maps + grouped.point_clouds + grouped.segmentation_masks) > 0 && (
                    <div className="rounded-lg border border-slate-700 bg-slate-900/30 p-2.5">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        Other Artifacts
                      </p>
                      <div className="mt-1 space-y-0.5 text-[10px] text-slate-500">
                        {grouped.depth_maps > 0 && <p>• Depth Maps: {grouped.depth_maps}</p>}
                        {grouped.point_clouds > 0 && <p>• SfM Point Clouds: {grouped.point_clouds}</p>}
                        {grouped.segmentation_masks > 0 && <p>• Segmentation Masks: {grouped.segmentation_masks}</p>}
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
              No reconstruction artifacts yet. Click &quot;Run Mock Reconstruction&quot; to generate test data.
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

/* ── Count tile ─────────────────────────────────────────────────────── */

function CountTile({ label, count, color }: { label: string; count: number; color: string }) {
  const colorMap: Record<string, string> = {
    emerald: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
    blue: 'border-blue-500/20 bg-blue-500/10 text-blue-300',
    rose: 'border-rose-500/20 bg-rose-500/10 text-rose-300',
    amber: 'border-amber-500/20 bg-amber-500/10 text-amber-300',
    purple: 'border-purple-500/20 bg-purple-500/10 text-purple-300',
    cyan: 'border-cyan-500/20 bg-cyan-500/10 text-cyan-300',
  };
  const classes = colorMap[color] ?? colorMap['emerald'];

  return (
    <div className={`rounded-lg border p-2 text-center ${classes}`}>
      <p className="text-lg font-bold">{count}</p>
      <p className="text-[9px] font-medium opacity-70">{label}</p>
    </div>
  );
}
