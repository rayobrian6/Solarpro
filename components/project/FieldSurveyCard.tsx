// ============================================================================
// FieldSurveyCard -- Field Survey summary card for the Project page
//
// Data source: GET /api/projects/[id]/survey-context  (ProjectSurveyContext)
// Single fetch returns: surveys[], latest survey, files, typed V2 payload.
//
// Two states:
//   STATE 1 -- No survey: informational message (survey comes from mobile app)
//   STATE 2 -- Survey exists: summary card with View Survey link
//
// Read-only. Survey data arrives via webhook from mobile app.
// SolarPro does not initiate surveys.
// ============================================================================

'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Camera, RefreshCw, CheckCircle, Clock,
  AlertTriangle, Eye,
  MapPin, User, Calendar, ImageIcon, ArrowRight,
} from 'lucide-react';
import type { SiteSurvey, SiteSurveyFile } from '@/lib/db-neon';
import type { SurveyV2Payload } from '@/lib/survey/v2/types';

// ---------------------------------------------------------------------------
// ProjectSurveyContext shape (mirrors lib/survey/getProjectSurveyContext.ts)
// ---------------------------------------------------------------------------
interface ProjectSurveyContext {
  surveys: SiteSurvey[];
  latest: SiteSurvey | null;
  files: SiteSurveyFile[];
  payload: SurveyV2Payload | null;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface FieldSurveyCardProps {
  projectId: string;
}

// ---------------------------------------------------------------------------
// Status display helpers
// ---------------------------------------------------------------------------
const STATUS_CONFIG: Record<
  SiteSurvey['status'],
  { label: string; icon: React.ReactNode; cls: string }
> = {
  completed: {
    label: 'Completed',
    icon: <CheckCircle size={11} />,
    cls: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25',
  },
  reviewed: {
    label: 'Reviewed',
    icon: <CheckCircle size={11} />,
    cls: 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/25',
  },
  draft: {
    label: 'Draft',
    icon: <Clock size={11} />,
    cls: 'bg-amber-500/15 text-amber-400 border border-amber-500/25',
  },
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// NoSurveyState -- shown when no survey exists yet
// ---------------------------------------------------------------------------
function NoSurveyState() {
  return (
    <div className="card p-6">
      {/* Header row */}
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
          <Camera size={15} className="text-cyan-400" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-white">Site Survey</h3>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider">Field Data Collection</p>
        </div>
      </div>

      {/* Body */}
      <div className="py-4 text-center space-y-2 border-t border-b border-slate-800">
        <p className="text-slate-300 text-sm font-medium">No site survey completed yet</p>
        <p className="text-slate-500 text-xs max-w-sm mx-auto leading-relaxed">
          Survey data is captured by the field technician using the mobile app
          and automatically appears here once submitted.
        </p>
      </div>

      <p className="text-slate-600 text-xs mt-4">
        Engineering uses estimated defaults until real field data is captured.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SurveyExistsCard -- summary when survey record(s) exist
// ---------------------------------------------------------------------------
function SurveyExistsCard({
  survey,
  fileCount,
  projectId,
}: {
  survey: SiteSurvey;
  fileCount: number;
  projectId: string;
}) {
  const statusCfg = STATUS_CONFIG[survey.status] ?? STATUS_CONFIG.completed;

  return (
    <div className="card p-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <Camera size={15} className="text-emerald-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">Site Survey</h3>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider">Field Data Captured</p>
          </div>
        </div>
        {/* Status badge */}
        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold ${statusCfg.cls}`}>
          {statusCfg.icon}
          {statusCfg.label}
        </span>
      </div>

      {/* Source backlink banner */}
      <div className="flex items-center gap-2 px-3 py-2 mb-3 rounded-lg bg-cyan-500/5 border border-cyan-500/15">
        <CheckCircle size={11} className="text-cyan-400 flex-shrink-0" />
        <span className="text-[11px] text-slate-400 flex-1 min-w-0">
          Engineering data populated from this survey on {formatDate(survey.createdAt)}
          {survey.inspectorName ? ` by ${survey.inspectorName}` : ''}
        </span>
        <Link
          href={`/projects/${projectId}/survey/${survey.id}`}
          className="flex items-center gap-1 text-[11px] font-semibold text-cyan-400 hover:text-cyan-300 transition-colors flex-shrink-0"
        >
          View <ArrowRight size={10} />
        </Link>
      </div>

      {/* Key metadata */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        {survey.addressSnapshot && (
          <div className="col-span-2 flex items-start gap-2 p-2.5 rounded-lg bg-slate-800/60 border border-slate-700/40">
            <MapPin size={12} className="text-slate-400 mt-0.5 flex-shrink-0" />
            <span className="text-xs text-slate-300 leading-relaxed">{survey.addressSnapshot}</span>
          </div>
        )}
        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-800/60 border border-slate-700/40">
          <Calendar size={12} className="text-slate-400 flex-shrink-0" />
          <div>
            <p className="text-[9px] text-slate-500 uppercase tracking-wider">Date</p>
            <p className="text-xs text-slate-200 font-medium">{formatDate(survey.createdAt)}</p>
          </div>
        </div>
        {survey.inspectorName && (
          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-800/60 border border-slate-700/40">
            <User size={12} className="text-slate-400 flex-shrink-0" />
            <div>
              <p className="text-[9px] text-slate-500 uppercase tracking-wider">Inspector</p>
              <p className="text-xs text-slate-200 font-medium truncate max-w-[90px]">{survey.inspectorName}</p>
            </div>
          </div>
        )}
        {fileCount > 0 && (
          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-800/60 border border-slate-700/40">
            <ImageIcon size={12} className="text-slate-400 flex-shrink-0" />
            <div>
              <p className="text-[9px] text-slate-500 uppercase tracking-wider">Photos</p>
              <p className="text-xs text-slate-200 font-medium">{fileCount}</p>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 flex-wrap pt-3 border-t border-slate-800">
        <Link
          href={`/projects/${projectId}/survey/${survey.id}`}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-cyan-500/15 border border-cyan-500/30
            hover:border-cyan-500/60 text-xs font-semibold text-cyan-400 transition-all hover:bg-cyan-500/25"
        >
          <Eye size={12} />
          View Survey
        </Link>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FieldSurveyCard -- main export
// ---------------------------------------------------------------------------
export default function FieldSurveyCard({ projectId }: FieldSurveyCardProps) {
  const [context, setContext] = useState<ProjectSurveyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch(`/api/projects/${projectId}/survey-context`);
      const json = await res.json();
      if (!json.success) {
        setError(json.error || 'Failed to load surveys');
        return;
      }
      setContext(json.data as ProjectSurveyContext);
    } catch {
      setError('Network error loading surveys');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (projectId) load();
  }, [projectId, load]);

  // Loading skeleton
  if (loading) {
    return (
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-lg bg-slate-800 animate-pulse" />
          <div className="space-y-1">
            <div className="h-3 w-24 bg-slate-800 rounded animate-pulse" />
            <div className="h-2 w-16 bg-slate-800/60 rounded animate-pulse" />
          </div>
        </div>
        <div className="h-16 bg-slate-800/40 rounded-lg animate-pulse" />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-3">
          <Camera size={14} className="text-slate-500" />
          <span className="text-sm font-semibold text-slate-400">Site Survey</span>
        </div>
        <div className="flex items-center gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
          <AlertTriangle size={13} className="text-red-400 flex-shrink-0" />
          <span className="text-xs text-red-400">{error}</span>
          <button
            onClick={load}
            className="ml-auto p-1 rounded hover:bg-red-500/20 text-red-400 transition-colors"
          >
            <RefreshCw size={11} />
          </button>
        </div>
      </div>
    );
  }

  // No survey yet
  if (!context?.latest) {
    return <NoSurveyState />;
  }

  return (
    <SurveyExistsCard
      survey={context.latest}
      fileCount={context.files.length}
      projectId={projectId}
    />
  );
}