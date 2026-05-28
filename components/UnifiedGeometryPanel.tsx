// ============================================================================
// components/UnifiedGeometryPanel.tsx
//
// UNIFIED GEOMETRY PANEL — replaces the split Pipeline A/B UI with a single
// unified flow showing ALL geometry artifacts with authority state badges.
//
// This is the UI counterpart to the unified geometry pipeline. It:
//   1. Fetches the UnifiedGeometryEvidenceBundle from the API
//   2. Displays all artifacts in a unified, filterable list
//   3. Shows authority state badges with color coding
//   4. Provides promote/review actions per artifact
//   5. Supports bulk "Promote to CAD" and "Lock for CAD" actions
//   6. Visibly labels mock artifacts with red badges and strikethrough
//
// AUTHORITY STATE COLORS:
//   raw_evidence         → gray
//   derived_review_only  → yellow/amber
//   reviewed_candidate   → blue
//   promoted_canonical   → green
//   cad_safe             → emerald
//   MOCK                 → red (with strikethrough)
// ============================================================================

"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  ChevronDown,
  ChevronUp,
  Shield,
  AlertTriangle,
  CheckCircle,
  Eye,
  Lock,
  ArrowUpCircle,
  RefreshCw,
  Filter,
  Layers,
  Zap,
  Home,
  Mountain,
  Network,
  ScanLine,
  Box,
  Crosshair,
  Target,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Section } from "@/components/ui/Section";
import type {
  UnifiedGeometryArtifact,
  UnifiedGeometryEvidenceBundle,
  UnifiedGeometryClass,
} from "@/lib/siteSurveys/unifiedGeometry/types";
import type { UnifiedGeometryAuthorityState } from "@/lib/siteSurveys/unifiedGeometry/authority";

// ── Props ──────────────────────────────────────────────────────────────────

interface UnifiedGeometryPanelProps {
  /** Survey ID to fetch geometry for */
  surveyId: string;
  /** Whether to show the panel in compact mode (fewer details per artifact) */
  compact?: boolean;
  /** Optional className for the outer container */
  className?: string;
}

// ── Authority State Badge Config ───────────────────────────────────────────

const AUTHORITY_BADGE_CONFIG: Record<UnifiedGeometryAuthorityState, {
  label: string;
  variant: "default" | "primary" | "success" | "warning" | "danger" | "info" | "approved" | "installed";
  dot?: boolean;
}> = {
  raw_evidence:         { label: "Raw Evidence",    variant: "default",  dot: true },
  derived_review_only:  { label: "Review Only",     variant: "warning",  dot: true },
  reviewed_candidate:   { label: "Reviewed",        variant: "info",     dot: true },
  promoted_canonical:   { label: "Canonical",       variant: "approved", dot: true },
  cad_safe:             { label: "CAD Safe",        variant: "installed", dot: true },
};

// ── Geometry Class Icons ───────────────────────────────────────────────────

const GEOMETRY_CLASS_CONFIG: Record<UnifiedGeometryClass, { label: string; icon: React.ReactNode }> = {
  roof_plane:         { label: "Roof Plane",   icon: <Home size={14} /> },
  wall_plane:         { label: "Wall Plane",   icon: <Layers size={14} /> },
  roof_line:          { label: "Roof Line",    icon: <ScanLine size={14} /> },
  obstruction:        { label: "Obstruction",  icon: <AlertTriangle size={14} /> },
  electrical_node:    { label: "Electrical",   icon: <Zap size={14} /> },
  segmentation_mask:  { label: "Segmentation", icon: <Box size={14} /> },
  depth_map:          { label: "Depth Map",    icon: <Mountain size={14} /> },
  point_cloud:        { label: "Point Cloud",  icon: <Crosshair size={14} /> },
  vanishing_point:    { label: "Vanishing Pt", icon: <Target size={14} /> },
  consensus_plane:    { label: "Consensus",    icon: <Layers size={14} /> },
  ground_plane:       { label: "Ground",       icon: <Mountain size={14} /> },
  unknown:            { label: "Unknown",      icon: <X size={14} /> },
};

// ── Authority State Badge Component ────────────────────────────────────────

function AuthorityBadge({ state, isMock }: { state: UnifiedGeometryAuthorityState; isMock: boolean }) {
  if (isMock) {
    return (
      <Badge variant="danger" size="xs" dot>
        <span className="line-through">MOCK</span>
      </Badge>
    );
  }

  const config = AUTHORITY_BADGE_CONFIG[state];
  return (
    <Badge variant={config.variant} size="xs" dot={config.dot}>
      {config.label}
    </Badge>
  );
}

// ── Geometry Class Badge ───────────────────────────────────────────────────

function GeometryClassBadge({ geometryClass }: { geometryClass: UnifiedGeometryClass }) {
  const config = GEOMETRY_CLASS_CONFIG[geometryClass] ?? GEOMETRY_CLASS_CONFIG.unknown;
  return (
    <Badge variant="default" size="xs" icon={config.icon}>
      {config.label}
    </Badge>
  );
}

// ── Pipeline Source Badge ──────────────────────────────────────────────────

function PipelineSourceBadge({ source }: { source: string }) {
  const variant = source === "photo_vision" ? "info" : source === "geometry_recon" ? "roof" : "default";
  const label = source === "photo_vision" ? "Photo Vision"
    : source === "geometry_recon" ? "Geometry Recon"
    : source === "manual" ? "Manual"
    : source === "merged" ? "Merged"
    : source === "mock" ? "Mock"
    : source;

  return <Badge variant={variant} size="xs">{label}</Badge>;
}

// ── Filter State ───────────────────────────────────────────────────────────

interface FilterState {
  authorityStates: Set<UnifiedGeometryAuthorityState>;
  geometryClasses: Set<UnifiedGeometryClass>;
  sourcePipelines: Set<string>;
  showMocks: boolean;
  searchTerm: string;
}

const DEFAULT_FILTER: FilterState = {
  authorityStates: new Set(),
  geometryClasses: new Set(),
  sourcePipelines: new Set(),
  showMocks: true,
  searchTerm: "",
};

// ── Artifact Row Component ─────────────────────────────────────────────────

interface ArtifactRowProps {
  artifact: UnifiedGeometryArtifact;
  onPromote: (artifactId: string, targetState: UnifiedGeometryAuthorityState) => void;
  promoting: boolean;
}

function ArtifactRow({ artifact, onPromote, promoting }: ArtifactRowProps) {
  const [expanded, setExpanded] = useState(false);
  const isMock = artifact.authority.mockArtifact;

  // Determine what promotion actions are available
  const canPromoteToDerived = artifact.authority.state === "raw_evidence" && !isMock;
  const canPromoteToReviewed = artifact.authority.state === "derived_review_only" && !isMock;
  const canPromoteToCanonical = artifact.authority.state === "reviewed_candidate" && !isMock;
  const canPromoteToCadSafe = artifact.authority.state === "promoted_canonical" && !isMock;

  return (
    <div
      className={`group border rounded-lg p-3 transition-colors ${
        isMock
          ? "border-red-800/40 bg-red-950/20"
          : "border-[var(--border-color)] hover:border-[var(--border-color-hover)]"
      }`}
    >
      {/* Header row */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Expand/collapse toggle */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex-shrink-0 p-0.5 rounded hover:bg-white/5 transition-colors"
        >
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        {/* Authority badge */}
        <AuthorityBadge state={artifact.authority.state} isMock={isMock} />

        {/* Geometry class badge */}
        <GeometryClassBadge geometryClass={artifact.geometryClass} />

        {/* Pipeline source */}
        <PipelineSourceBadge source={artifact.provenance.sourcePipeline} />

        {/* Label */}
        <span className={`text-sm truncate flex-1 min-w-[80px] ${isMock ? "line-through text-red-400/70" : ""}`}>
          {artifact.label || artifact.id.slice(0, 8)}
        </span>

        {/* Confidence */}
        <span className="text-xs text-[var(--text-muted)] flex-shrink-0">
          {Math.round(artifact.confidence)}%
        </span>

        {/* Review state indicator */}
        {artifact.reviewState === "accepted" && (
          <CheckCircle size={14} className="text-green-400 flex-shrink-0" />
        )}
        {artifact.reviewState === "rejected" && (
          <X size={14} className="text-red-400 flex-shrink-0" />
        )}

        {/* Promote action */}
        {canPromoteToDerived && (
          <button
            onClick={() => onPromote(artifact.id, "derived_review_only")}
            disabled={promoting}
            className="flex-shrink-0 px-2 py-0.5 text-xs rounded bg-amber-900/40 text-amber-300 border border-amber-700/30 hover:bg-amber-900/60 transition-colors disabled:opacity-50"
          >
            Promote
          </button>
        )}
        {canPromoteToReviewed && (
          <button
            onClick={() => onPromote(artifact.id, "reviewed_candidate")}
            disabled={promoting}
            className="flex-shrink-0 px-2 py-0.5 text-xs rounded bg-blue-900/40 text-blue-300 border border-blue-700/30 hover:bg-blue-900/60 transition-colors disabled:opacity-50"
          >
            Review
          </button>
        )}
        {canPromoteToCanonical && (
          <button
            onClick={() => onPromote(artifact.id, "promoted_canonical")}
            disabled={promoting}
            className="flex-shrink-0 px-2 py-0.5 text-xs rounded bg-green-900/40 text-green-300 border border-green-700/30 hover:bg-green-900/60 transition-colors disabled:opacity-50"
          >
            Promote to CAD
          </button>
        )}
        {canPromoteToCadSafe && (
          <button
            onClick={() => onPromote(artifact.id, "cad_safe")}
            disabled={promoting}
            className="flex-shrink-0 px-2 py-0.5 text-xs rounded bg-emerald-900/40 text-emerald-300 border border-emerald-700/30 hover:bg-emerald-900/60 transition-colors disabled:opacity-50"
          >
            Lock for CAD
          </button>
        )}
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="mt-2 pt-2 border-t border-[var(--border-color)] space-y-1.5 text-xs text-[var(--text-muted)]">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <div><span className="text-[var(--text-primary)]">ID:</span> {artifact.id}</div>
            <div><span className="text-[var(--text-primary)]">Survey:</span> {artifact.surveyId}</div>
            <div><span className="text-[var(--text-primary)]">Created:</span> {new Date(artifact.provenance.createdAt).toLocaleString()}</div>
            <div><span className="text-[var(--text-primary)]">Pipeline:</span> {artifact.provenance.sourcePipeline} / {artifact.provenance.toolName}</div>
            {artifact.obstructionSubtype && (
              <div><span className="text-[var(--text-primary)]">Subtype:</span> {artifact.obstructionSubtype}</div>
            )}
            {artifact.electricalSubtype && (
              <div><span className="text-[var(--text-primary)]">Subtype:</span> {artifact.electricalSubtype}</div>
            )}
            {artifact.pitchDegrees != null && (
              <div><span className="text-[var(--text-primary)]">Pitch:</span> {artifact.pitchDegrees}°</div>
            )}
            {artifact.azimuthDegrees != null && (
              <div><span className="text-[var(--text-primary)]">Azimuth:</span> {artifact.azimuthDegrees}°</div>
            )}
            {artifact.areaSqM != null && (
              <div><span className="text-[var(--text-primary)]">Area:</span> {artifact.areaSqM.toFixed(1)} m²</div>
            )}
          </div>

          {/* Authority details */}
          <div className="mt-1.5 pt-1.5 border-t border-[var(--border-color)]">
            <span className="text-[var(--text-primary)] font-medium">Authority:</span>{" "}
            <span className="font-mono">{artifact.authority.state}</span>
            {artifact.authority.reviewOnly && <span className="ml-1 text-amber-400">(review-only)</span>}
            {artifact.authority.cadConsumable && <span className="ml-1 text-emerald-400">(CAD-consumable)</span>}
            {artifact.authority.cadMutationAllowed && <span className="ml-1 text-emerald-400">(CAD-mutable)</span>}
          </div>

          {/* Limitations */}
          {artifact.limitations.length > 0 && (
            <div className="mt-1.5 pt-1.5 border-t border-[var(--border-color)]">
              <span className="text-[var(--text-primary)] font-medium">Limitations:</span>{" "}
              {artifact.limitations.join("; ")}
            </div>
          )}

          {/* Review state */}
          <div className="mt-1.5 pt-1.5 border-t border-[var(--border-color)]">
            <span className="text-[var(--text-primary)] font-medium">Review:</span>{" "}
            {artifact.reviewState === "review_required" && "Required"}
            {artifact.reviewState === "accepted" && "Accepted"}
            {artifact.reviewState === "rejected" && "Rejected"}
            {artifact.reviewNotes && <span className="ml-1">— {artifact.reviewNotes}</span>}
          </div>

          {/* Source file IDs */}
          {artifact.provenance.sourceFileIds.length > 0 && (
            <div className="mt-1.5 pt-1.5 border-t border-[var(--border-color)]">
              <span className="text-[var(--text-primary)] font-medium">Source Files:</span>{" "}
              {artifact.provenance.sourceFileIds.join(", ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main UnifiedGeometryPanel Component ────────────────────────────────────

export function UnifiedGeometryPanel({ surveyId, compact = false, className = "" }: UnifiedGeometryPanelProps) {
  const [bundle, setBundle] = useState<UnifiedGeometryEvidenceBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [promoting, setPromoting] = useState(false);
  const [filter, setFilter] = useState<FilterState>(DEFAULT_FILTER);

  // ── Fetch bundle ─────────────────────────────────────────────────────
  const fetchBundle = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/site-surveys/${surveyId}/unified-geometry/bundle`);
      const data = await res.json();
      if (data.success) {
        setBundle(data.bundle);
      } else {
        setError(data.error || "Failed to load geometry bundle");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [surveyId]);

  useEffect(() => {
    fetchBundle();
  }, [fetchBundle]);

  // ── Promote artifact ─────────────────────────────────────────────────
  const handlePromote = useCallback(async (artifactId: string, targetState: UnifiedGeometryAuthorityState) => {
    setPromoting(true);
    try {
      const res = await fetch(`/api/site-surveys/${surveyId}/unified-geometry/promote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artifactIds: [artifactId],
          targetState,
        }),
      });
      const data = await res.json();
      if (data.success && data.promoted?.length > 0) {
        // Re-fetch the bundle to update the UI
        await fetchBundle();
      } else if (data.failed?.length > 0) {
        setError(`Promotion failed: ${data.failed[0].error}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Promotion failed");
    } finally {
      setPromoting(false);
    }
  }, [surveyId, fetchBundle]);

  // ── Bulk promote ─────────────────────────────────────────────────────
  const handleBulkPromote = useCallback(async (targetState: UnifiedGeometryAuthorityState) => {
    if (!bundle) return;

    // Find all artifacts that can be promoted to the target state
    const eligibleIds = bundle.artifacts
      .filter(a => {
        if (a.authority.mockArtifact) return false;
        if (a.reviewState === "rejected") return false;
        const transitions: Record<string, UnifiedGeometryAuthorityState[]> = {
          raw_evidence: ["derived_review_only", "reviewed_candidate"],
          derived_review_only: ["reviewed_candidate"],
          reviewed_candidate: ["promoted_canonical"],
          promoted_canonical: ["cad_safe"],
          cad_safe: [],
        };
        return transitions[a.authority.state]?.includes(targetState);
      })
      .map(a => a.id);

    if (eligibleIds.length === 0) return;

    setPromoting(true);
    try {
      const res = await fetch(`/api/site-surveys/${surveyId}/unified-geometry/promote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artifactIds: eligibleIds,
          targetState,
        }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchBundle();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk promotion failed");
    } finally {
      setPromoting(false);
    }
  }, [surveyId, bundle, fetchBundle]);

  // ── Filtered artifacts ───────────────────────────────────────────────
  const filteredArtifacts = useMemo(() => {
    if (!bundle) return [];

    let result = bundle.artifacts;

    if (filter.authorityStates.size > 0) {
      result = result.filter(a => filter.authorityStates.has(a.authority.state));
    }
    if (filter.geometryClasses.size > 0) {
      result = result.filter(a => filter.geometryClasses.has(a.geometryClass));
    }
    if (filter.sourcePipelines.size > 0) {
      result = result.filter(a => filter.sourcePipelines.has(a.provenance.sourcePipeline));
    }
    if (!filter.showMocks) {
      result = result.filter(a => !a.authority.mockArtifact);
    }
    if (filter.searchTerm) {
      const term = filter.searchTerm.toLowerCase();
      result = result.filter(a =>
        a.label.toLowerCase().includes(term) ||
        a.id.toLowerCase().includes(term) ||
        a.geometryClass.includes(term)
      );
    }

    return result;
  }, [bundle, filter]);

  // ── Summary counts ───────────────────────────────────────────────────
  const authorityCounts = useMemo(() => {
    if (!bundle) return {} as Record<UnifiedGeometryAuthorityState, number>;
    const counts = { raw_evidence: 0, derived_review_only: 0, reviewed_candidate: 0, promoted_canonical: 0, cad_safe: 0 } as Record<UnifiedGeometryAuthorityState, number>;
    for (const a of bundle.artifacts) {
      counts[a.authority.state]++;
    }
    return counts;
  }, [bundle]);

  const mockCount = useMemo(() => {
    if (!bundle) return 0;
    return bundle.artifacts.filter(a => a.authority.mockArtifact).length;
  }, [bundle]);

  // ── Loading state ────────────────────────────────────────────────────
  if (loading && !bundle) {
    return (
      <Card className={className}>
        <div className="flex items-center gap-2 text-[var(--text-muted)]">
          <RefreshCw size={16} className="animate-spin" />
          <span className="text-sm">Loading geometry artifacts...</span>
        </div>
      </Card>
    );
  }

  // ── Error state ──────────────────────────────────────────────────────
  if (error && !bundle) {
    return (
      <Card variant="danger" className={className}>
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} className="text-red-400" />
          <span className="text-sm">{error}</span>
          <button
            onClick={fetchBundle}
            className="ml-auto px-2 py-0.5 text-xs rounded bg-red-900/40 text-red-300 border border-red-700/30 hover:bg-red-900/60 transition-colors"
          >
            Retry
          </button>
        </div>
      </Card>
    );
  }

  // ── Empty state ──────────────────────────────────────────────────────
  if (bundle && bundle.artifacts.length === 0) {
    return (
      <Card className={className}>
        <div className="text-center py-6">
          <Layers size={24} className="mx-auto text-[var(--text-muted)] mb-2" />
          <p className="text-sm text-[var(--text-muted)]">No geometry artifacts found for this survey.</p>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Run the Photo Vision or Geometry Reconstruction pipeline first.
          </p>
        </div>
      </Card>
    );
  }

  // ── Main render ──────────────────────────────────────────────────────
  return (
    <div className={className}>
      <Section
        title="Unified Geometry"
        subtitle="All geometry artifacts from both pipelines — Photo Vision + Geometry Reconstruction"
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={fetchBundle}
              disabled={loading}
              className="p-1.5 rounded hover:bg-white/5 transition-colors disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        }
      >
        {/* ── Authority Summary Bar ──────────────────────────────────── */}
        <div className="flex items-center gap-2 flex-wrap">
          {Object.entries(authorityCounts).map(([state, count]) => {
            const config = AUTHORITY_BADGE_CONFIG[state as UnifiedGeometryAuthorityState];
            return count > 0 ? (
              <button
                key={state}
                onClick={() => {
                  setFilter(prev => {
                    const next = { ...prev };
                    const states = new Set(prev.authorityStates);
                    if (states.has(state as UnifiedGeometryAuthorityState)) {
                      states.delete(state as UnifiedGeometryAuthorityState);
                    } else {
                      states.add(state as UnifiedGeometryAuthorityState);
                    }
                    next.authorityStates = states;
                    return next;
                  });
                }}
                className="transition-transform hover:scale-105"
              >
                <Badge variant={config.variant} size="sm" dot>
                  {config.label}: {count}
                </Badge>
              </button>
            ) : null;
          })}
          {mockCount > 0 && (
            <Badge variant="danger" size="sm" dot>
              <span className="line-through">MOCK</span>: {mockCount}
            </Badge>
          )}
        </div>

        {/* ── Bulk Actions ───────────────────────────────────────────── */}
        {bundle && (
          <div className="flex items-center gap-2 flex-wrap">
            {authorityCounts.reviewed_candidate > 0 && (
              <button
                onClick={() => handleBulkPromote("promoted_canonical")}
                disabled={promoting}
                className="px-3 py-1 text-xs rounded bg-green-900/40 text-green-300 border border-green-700/30 hover:bg-green-900/60 transition-colors disabled:opacity-50 flex items-center gap-1"
              >
                <ArrowUpCircle size={12} />
                Promote to CAD ({authorityCounts.reviewed_candidate})
              </button>
            )}
            {authorityCounts.promoted_canonical > 0 && (
              <button
                onClick={() => handleBulkPromote("cad_safe")}
                disabled={promoting}
                className="px-3 py-1 text-xs rounded bg-emerald-900/40 text-emerald-300 border border-emerald-700/30 hover:bg-emerald-900/60 transition-colors disabled:opacity-50 flex items-center gap-1"
              >
                <Lock size={12} />
                Lock for CAD ({authorityCounts.promoted_canonical})
              </button>
            )}
          </div>
        )}

        {/* ── Filter Controls ────────────────────────────────────────── */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
            <Filter size={12} />
            <span>Filter:</span>
          </div>
          <input
            type="text"
            placeholder="Search artifacts..."
            value={filter.searchTerm}
            onChange={e => setFilter(prev => ({ ...prev, searchTerm: e.target.value }))}
            className="px-2 py-0.5 text-xs bg-[var(--bg-input)] border border-[var(--border-color)] rounded text-[var(--text-primary)] placeholder-[var(--text-muted)] w-40"
          />
          <label className="flex items-center gap-1 text-xs text-[var(--text-muted)] cursor-pointer">
            <input
              type="checkbox"
              checked={filter.showMocks}
              onChange={e => setFilter(prev => ({ ...prev, showMocks: e.target.checked }))}
              className="rounded"
            />
            Show mocks
          </label>
        </div>

        {/* ── Error Banner ───────────────────────────────────────────── */}
        {error && bundle && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-red-900/20 border border-red-700/30 text-red-300 text-xs">
            <AlertTriangle size={12} />
            {error}
            <button onClick={() => setError(null)} className="ml-auto">✕</button>
          </div>
        )}

        {/* ── Pipeline Summary ───────────────────────────────────────── */}
        {bundle && (
          <div className="flex items-center gap-4 text-xs text-[var(--text-muted)]">
            <span>
              <Shield size={12} className="inline mr-1" />
              Total: {bundle.artifacts.length}
            </span>
            <span>Photo Vision: {bundle.pipelineCounts.photoVision}</span>
            <span>Geometry Recon: {bundle.pipelineCounts.geometryRecon}</span>
            {bundle.pipelineCounts.mock > 0 && (
              <span className="text-red-400">Mock: {bundle.pipelineCounts.mock}</span>
            )}
            <span className="ml-auto">
              Showing {filteredArtifacts.length} of {bundle.artifacts.length}
            </span>
          </div>
        )}

        {/* ── Artifact List ──────────────────────────────────────────── */}
        <div className="space-y-1.5 max-h-[600px] overflow-y-auto pr-1">
          {filteredArtifacts.map(artifact => (
            <ArtifactRow
              key={artifact.id}
              artifact={artifact}
              onPromote={handlePromote}
              promoting={promoting}
            />
          ))}
          {filteredArtifacts.length === 0 && bundle && bundle.artifacts.length > 0 && (
            <div className="text-center py-4 text-sm text-[var(--text-muted)]">
              No artifacts match the current filters.
            </div>
          )}
        </div>

        {/* ── CAD Readiness Indicator ────────────────────────────────── */}
        {bundle && authorityCounts.cad_safe > 0 && (
          <Card variant="success" padding="sm">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle size={16} className="text-green-400" />
              <span className="text-green-300 font-medium">
                {authorityCounts.cad_safe} artifact{authorityCounts.cad_safe !== 1 ? "s" : ""} ready for CAD
              </span>
            </div>
          </Card>
        )}
      </Section>
    </div>
  );
}

export default UnifiedGeometryPanel;
