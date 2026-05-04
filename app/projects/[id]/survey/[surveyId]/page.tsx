// ============================================================================
// Survey Detail Page — /projects/[id]/survey/[surveyId]
//
// Three sections:
//   1. Photos — grid grouped by label (roof, panel, meter, attic, exterior)
//   2. Key Observations — clean summary of important structured fields
//   3. Full Data — expandable JSON / field list
//
// Auth: session cookie (same as all project pages)
// Pure ASCII, no Unicode in code.
// ============================================================================

'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import AppShell from '@/components/ui/AppShell';
import {
  ArrowLeft, Camera, Home, Zap, ChevronDown, ChevronUp,
  AlertTriangle, RefreshCw, CheckCircle, Clock,
  MapPin, User, Calendar, ImageIcon, Tag,
} from 'lucide-react';
import type { SiteSurvey, SiteSurveyFile } from '@/lib/db-neon';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface SurveyDetailData {
  survey: SiteSurvey;
  files: SiteSurveyFile[];
}

// ---------------------------------------------------------------------------
// Label config for photo groups
// ---------------------------------------------------------------------------
const PHOTO_LABEL_CONFIG: Record<
  string,
  { title: string; color: string; icon: React.ReactNode }
> = {
  roof:     { title: 'Roof',          color: 'text-amber-400',  icon: <Home size={13} /> },
  panel:    { title: 'Electrical Panel', color: 'text-yellow-400', icon: <Zap size={13} /> },
  meter:    { title: 'Meter',         color: 'text-blue-400',   icon: <Zap size={13} /> },
  attic:    { title: 'Attic',         color: 'text-purple-400', icon: <Home size={13} /> },
  exterior: { title: 'Exterior',      color: 'text-teal-400',   icon: <Home size={13} /> },
  utility:  { title: 'Utility Room',  color: 'text-slate-400',  icon: <Zap size={13} /> },
};
const UNGROUPED_LABEL = '__other__';

// ---------------------------------------------------------------------------
// Photo group component
// ---------------------------------------------------------------------------
function PhotoGroup({
  label,
  files,
}: {
  label: string;
  files: SiteSurveyFile[];
}) {
  const cfg = PHOTO_LABEL_CONFIG[label];
  const title = cfg?.title ?? (label === UNGROUPED_LABEL ? 'Other Photos' : label);
  const color = cfg?.color ?? 'text-slate-400';
  const icon  = cfg?.icon ?? <Camera size={13} />;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className={color}>{icon}</span>
        <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">{title}</h4>
        <span className="text-xs text-slate-600">({files.length})</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {files.map(file => (
          <a
            key={file.id}
            href={file.fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="relative group aspect-square rounded-xl overflow-hidden bg-slate-800
              border border-slate-700 hover:border-cyan-500/50 transition-all"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={file.fileUrl}
              alt={file.filename ?? file.label ?? 'Survey photo'}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              loading="lazy"
            />
            {file.label && (
              <div className="absolute bottom-0 left-0 right-0 px-2 py-1
                bg-gradient-to-t from-black/80 to-transparent">
                <span className="text-[9px] text-white/80 font-medium capitalize">
                  {file.label}
                </span>
              </div>
            )}
          </a>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Key observation row
// ---------------------------------------------------------------------------
function ObsRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-slate-800/60 last:border-0">
      <span className="text-xs text-slate-500 flex-shrink-0 w-44">{label}</span>
      <span className="text-xs text-slate-200 text-right">{value ?? <span className="text-slate-600 italic">Not captured</span>}</span>
    </div>
  );
}

function fmtVal(v: unknown): React.ReactNode {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}

// ---------------------------------------------------------------------------
// Key Observations section — pulls important fields from survey_data
// ---------------------------------------------------------------------------
function KeyObservations({ data }: { data: Record<string, unknown> | null }) {
  if (!data) {
    return (
      <div className="card p-5">
        <p className="text-slate-500 text-xs italic">No structured data available for this survey.</p>
      </div>
    );
  }

  // Flatten common nested shapes from the survey V2 payload
  const sd = data as Record<string, unknown>;
  const roof = (sd.roof ?? sd.stepRoof ?? {}) as Record<string, unknown>;
  const elec = (sd.electrical ?? sd.stepElectrical ?? {}) as Record<string, unknown>;
  const site = (sd.siteOverview ?? sd.stepSiteOverview ?? {}) as Record<string, unknown>;

  return (
    <div className="card p-5 space-y-0">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-0 divide-y divide-slate-800/60">
        {/* Roof */}
        <ObsRow label="Roof Material"    value={fmtVal(roof.roofMaterial ?? roof.material ?? sd.roof_material)} />
        <ObsRow label="Roof Pitch"       value={fmtVal(roof.roofPitch ?? roof.pitch ?? sd.roof_pitch)} />
        <ObsRow label="Roof Condition"   value={fmtVal(roof.roofCondition ?? roof.condition ?? sd.roof_condition)} />
        <ObsRow label="Rafter Spacing"   value={fmtVal(roof.rafterSpacing ?? sd.rafter_spacing_in)} />
        <ObsRow label="Roof Age"         value={fmtVal(roof.roofAge ?? sd.roof_age_years)} />
        <ObsRow label="Attic Access"     value={fmtVal(roof.atticAccess ?? sd.attic_access)} />
        {/* Electrical */}
        <ObsRow label="Panel Brand"      value={fmtVal(elec.panelBrand ?? sd.panel_brand)} />
        <ObsRow label="Panel Rating"     value={fmtVal(elec.panelRating ?? sd.panel_rating_amps)} />
        <ObsRow label="Available Slots"  value={fmtVal(elec.availableSlots ?? sd.available_breaker_slots)} />
        <ObsRow label="Service Type"     value={fmtVal(elec.serviceEntranceType ?? sd.service_entrance_type)} />
        <ObsRow label="Has Sub-Panel"    value={fmtVal(elec.hasSubPanel ?? sd.has_sub_panel)} />
        {/* Site */}
        <ObsRow label="Address"          value={fmtVal(site.siteAddress ?? site.address ?? sd.address)} />
        <ObsRow label="Inspector"        value={fmtVal(site.inspectorName ?? sd.inspector_name)} />
        <ObsRow label="Survey Date"      value={fmtVal(site.surveyDate ?? sd.surveyed_at)} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Full Data section — collapsible JSON viewer
// ---------------------------------------------------------------------------
function FullDataSection({ data }: { data: Record<string, unknown> | null }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3.5
          text-sm font-semibold text-slate-300 hover:text-white transition-colors"
      >
        <span>Full Survey Data</span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {open && (
        <div className="border-t border-slate-700/50 px-5 py-4">
          <pre className="text-[10px] text-slate-400 overflow-auto max-h-[400px] leading-relaxed">
            {data ? JSON.stringify(data, null, 2) : 'No data'}
          </pre>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------
function StatusBadge({ status }: { status: SiteSurvey['status'] }) {
  const map: Record<SiteSurvey['status'], { cls: string; label: string; icon: React.ReactNode }> = {
    completed: { cls: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25', label: 'Completed', icon: <CheckCircle size={11} /> },
    reviewed:  { cls: 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/25',         label: 'Reviewed',  icon: <CheckCircle size={11} /> },
    draft:     { cls: 'bg-amber-500/15 text-amber-400 border border-amber-500/25',       label: 'Draft',     icon: <Clock size={11} /> },
  };
  const cfg = map[status] ?? map.completed;
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold ${cfg.cls}`}>
      {cfg.icon}{cfg.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function SurveyDetailPage() {
  const { id: projectId, surveyId } = useParams<{ id: string; surveyId: string }>();

  const [detail, setDetail]  = useState<SurveyDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]    = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/site-surveys/${surveyId}`);
      const json = await res.json();
      if (!json.success) {
        setError(json.error || 'Failed to load survey');
        return;
      }
      setDetail(json.data);
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (surveyId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surveyId]);

  if (loading) {
    return (
      <AppShell>
        <div className="p-6 flex items-center justify-center h-64">
          <div className="spinner w-8 h-8" />
        </div>
      </AppShell>
    );
  }

  if (error || !detail) {
    return (
      <AppShell>
        <div className="p-6 space-y-4">
          <Link href={`/projects/${projectId}`} className="btn-ghost p-2 rounded-lg inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
            <ArrowLeft size={16} /> Back to Project
          </Link>
          <div className="card p-6 text-center space-y-3">
            <AlertTriangle size={20} className="text-red-400 mx-auto" />
            <p className="text-red-400 text-sm font-medium">{error ?? 'Survey not found'}</p>
            <button
              onClick={load}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-300"
            >
              <RefreshCw size={12} /> Retry
            </button>
          </div>
        </div>
      </AppShell>
    );
  }

  const { survey, files } = detail;

  // Group files by label
  const grouped: Record<string, SiteSurveyFile[]> = {};
  for (const f of files) {
    const key = f.label ?? UNGROUPED_LABEL;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(f);
  }

  // Sort: known labels first, then ungrouped
  const knownOrder = ['roof', 'panel', 'meter', 'attic', 'exterior', 'utility'];
  const sortedGroups = [
    ...knownOrder.filter(k => grouped[k]),
    ...Object.keys(grouped).filter(k => !knownOrder.includes(k) && k !== UNGROUPED_LABEL),
    ...(grouped[UNGROUPED_LABEL] ? [UNGROUPED_LABEL] : []),
  ];

  return (
    <AppShell>
      <div className="p-4 md:p-6 space-y-5 animate-fade-in max-w-3xl mx-auto">

        {/* Header */}
        <div className="flex items-start gap-3">
          <Link href={`/projects/${projectId}`} className="btn-ghost p-2 rounded-lg mt-0.5 flex-shrink-0">
            <ArrowLeft size={18} />
          </Link>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Camera size={16} className="text-cyan-400" />
              <h1 className="text-lg font-black text-white">Site Survey</h1>
              <StatusBadge status={survey.status} />
              <span className="text-xs text-slate-500 capitalize px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700">
                {survey.source === 'standalone' ? 'Standalone' : 'Project Handoff'}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              {survey.addressSnapshot && (
                <span className="flex items-center gap-1 text-xs text-slate-400">
                  <MapPin size={10} />{survey.addressSnapshot}
                </span>
              )}
              <span className="flex items-center gap-1 text-xs text-slate-400">
                <Calendar size={10} />{new Date(survey.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
              {survey.inspectorName && (
                <span className="flex items-center gap-1 text-xs text-slate-400">
                  <User size={10} />{survey.inspectorName}
                </span>
              )}
            </div>
          </div>
          <button onClick={load} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-all flex-shrink-0">
            <RefreshCw size={13} />
          </button>
        </div>

        {/* Section 1: Photos */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <ImageIcon size={14} className="text-cyan-400" />
            <h2 className="text-sm font-bold text-white">Photos</h2>
            {files.length > 0 && (
              <span className="text-xs text-slate-500">({files.length} total)</span>
            )}
          </div>

          {files.length === 0 ? (
            <div className="card p-6 text-center">
              <Camera size={20} className="text-slate-600 mx-auto mb-2" />
              <p className="text-slate-500 text-xs">No photos attached to this survey.</p>
            </div>
          ) : (
            <div className="space-y-5">
              {sortedGroups.map(label => (
                <PhotoGroup key={label} label={label} files={grouped[label]} />
              ))}
            </div>
          )}
        </section>

        {/* Section 2: Key Observations */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Tag size={14} className="text-amber-400" />
            <h2 className="text-sm font-bold text-white">Key Observations</h2>
          </div>
          <KeyObservations data={survey.surveyData} />
        </section>

        {/* Section 3: Full Data */}
        <section>
          <FullDataSection data={survey.surveyData} />
        </section>

        {/* Notes */}
        {survey.notes && (
          <div className="card p-4">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Notes</p>
            <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{survey.notes}</p>
          </div>
        )}

      </div>
    </AppShell>
  );
}