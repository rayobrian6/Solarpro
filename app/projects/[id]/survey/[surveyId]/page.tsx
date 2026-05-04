// ============================================================================
// Survey Detail Page -- /projects/[id]/survey/[surveyId]
//
// Data source: GET /api/site-surveys/[surveyId]  (returns SiteSurvey + SiteSurveyFile[])
// The surveyData JSONB is typed as SurveyV2Payload (schemaVersion: '2.0').
//
// Sections (in order):
//   1. Photos     -- grouped by PhotoCategory key from site_survey_files.label
//   2. Electrical -- typed from SurveyElectricalService
//   3. Roof       -- typed from SurveyRoofConditions
//   4. Obstructions -- typed from SurveyObstructions
//   5. Site Overview -- typed from SurveySiteOverview
//   6. Notes      -- accessNotes, mountingNotes, electricalNotes, setbackNotes
//   7. Raw Data   -- collapsible JSON for engineering debug
//
// Rules:
//   - No schema changes
//   - No ingest changes
//   - Data read from getProjectSurveyContext only (via /api/site-surveys/[surveyId])
//   - Photo labels come from site_survey_files.label (category key from Phase 1)
// ============================================================================

'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import AppShell from '@/components/ui/AppShell';
import {
  ArrowLeft, Camera, Home, Zap, ChevronDown, ChevronUp,
  AlertTriangle, RefreshCw, CheckCircle, Clock,
  MapPin, User, Calendar, ImageIcon, Shield,
  TriangleRight, Sun, Layers, FileText,
} from 'lucide-react';
import type { SiteSurvey, SiteSurveyFile } from '@/lib/db-neon';
import type {
  SurveyV2Payload,
  SurveyElectricalService,
  SurveyRoofConditions,
  SurveyObstructions,
  SurveySiteOverview,
  Obstruction,
  PhotoCategory,
} from '@/lib/survey/v2/types';

// ---------------------------------------------------------------------------
// Photo category display config
// Maps the canonical PhotoCategory keys stored in site_survey_files.label
// ---------------------------------------------------------------------------
const PHOTO_CATEGORY_META: Record<
  string,
  { title: string; color: string; icon: React.ReactNode }
> = {
  main_panel_open:   { title: 'Main Panel (Open)',   color: 'text-yellow-400', icon: <Zap size={13} /> },
  main_panel_closed: { title: 'Main Panel (Closed)', color: 'text-yellow-400', icon: <Zap size={13} /> },
  meter:             { title: 'Utility Meter',       color: 'text-blue-400',   icon: <Zap size={13} /> },
  roof_overview:     { title: 'Roof Overview',       color: 'text-amber-400',  icon: <Home size={13} /> },
  roof_detail:       { title: 'Roof Detail',         color: 'text-amber-400',  icon: <Home size={13} /> },
  service_entrance:  { title: 'Service Entrance',    color: 'text-purple-400', icon: <Zap size={13} /> },
  attic_access:      { title: 'Attic Access',        color: 'text-teal-400',   icon: <Home size={13} /> },
  obstruction:       { title: 'Obstruction',         color: 'text-red-400',    icon: <AlertTriangle size={13} /> },
  additional:        { title: 'Additional',          color: 'text-slate-400',  icon: <Camera size={13} /> },
};

const CATEGORY_ORDER: PhotoCategory[] = [
  'roof_overview', 'roof_detail', 'main_panel_open', 'main_panel_closed',
  'meter', 'service_entrance', 'attic_access', 'obstruction', 'additional',
];

const UNGROUPED = '__other__';

// ---------------------------------------------------------------------------
// Human-readable display maps
// ---------------------------------------------------------------------------
const ROOF_MATERIAL_LABELS: Record<string, string> = {
  comp_shingle:       'Composition Shingle',
  tile_concrete:      'Concrete Tile',
  tile_clay:          'Clay Tile',
  metal_standing_seam:'Metal Standing Seam',
  metal_r_panel:      'Metal R-Panel',
  flat_tpo:           'Flat — TPO',
  flat_epdm:          'Flat — EPDM',
  flat_torch:         'Flat — Torch Down',
  wood_shake:         'Wood Shake',
  other:              'Other',
};

const ROOF_PITCH_LABELS: Record<string, string> = {
  flat:      'Flat (< 2 deg)',
  low:       'Low (2-4 deg)',
  standard:  'Standard (5-9 deg)',
  steep:     'Steep (10-14 deg)',
  very_steep:'Very Steep (15+ deg)',
};

const PANEL_BRAND_LABELS: Record<string, string> = {
  siemens:        'Siemens',
  square_d:       'Square D',
  eaton:          'Eaton',
  cutler_hammer:  'Cutler-Hammer',
  ge:             'GE',
  federal_pacific:'Federal Pacific',
  zinsco:         'Zinsco',
  leviton:        'Leviton',
  other:          'Other',
};

const METER_SOCKET_LABELS: Record<string, string> = {
  standard: 'Standard',
  combo:    'Combo Meter-Main',
  '320a':   '320A Ringless',
  other:    'Other',
};

const INTERCONNECTION_LABELS: Record<string, string> = {
  main_panel:  'Main Panel (Line Side)',
  sub_panel:   'Sub-Panel',
  load_side:   'Load Side Tap',
  supply_side: 'Supply Side Tap',
};

const SERVICE_ENTRANCE_LABELS: Record<string, string> = {
  overhead:    'Overhead',
  underground: 'Underground',
};

const OBSTRUCTION_TYPE_LABELS: Record<string, string> = {
  chimney:        'Chimney',
  hvac_unit:      'HVAC Unit',
  vent_pipe:      'Vent Pipe',
  skylight:       'Skylight',
  dormer:         'Dormer',
  tree_shade:     'Tree / Shade',
  antenna:        'Antenna',
  satellite_dish: 'Satellite Dish',
  exhaust_fan:    'Exhaust Fan',
  solar_tube:     'Solar Tube',
  other:          'Other',
};

const OBSTRUCTION_LOCATION_LABELS: Record<string, string> = {
  north: 'North', south: 'South', east: 'East', west: 'West',
  ridge: 'Ridge', valley: 'Valley', center: 'Center',
};

// ---------------------------------------------------------------------------
// Helper: format raw value to display string
// ---------------------------------------------------------------------------
function fmtVal(v: unknown, labels?: Record<string, string>): string | null {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v);
  if (labels && labels[s]) return labels[s];
  return s;
}

function fmtBool(v: boolean | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  return v ? 'Yes' : 'No';
}

// ---------------------------------------------------------------------------
// FieldRow — label + value pair
// ---------------------------------------------------------------------------
function FieldRow({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: React.ReactNode;
  wide?: boolean;
}) {
  const isEmpty = value === null || value === undefined || value === '';
  return (
    <div className={`flex items-start justify-between gap-3 py-2.5 border-b border-slate-800/50 last:border-0 ${wide ? 'col-span-2' : ''}`}>
      <span className="text-xs text-slate-500 flex-shrink-0 min-w-[140px]">{label}</span>
      <span className="text-xs text-right">
        {isEmpty
          ? <span className="text-slate-600 italic">Not captured</span>
          : <span className="text-slate-200">{value}</span>
        }
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SectionCard — wrapper with icon + title
// ---------------------------------------------------------------------------
function SectionCard({
  icon,
  title,
  iconColor = 'text-cyan-400',
  children,
}: {
  icon: React.ReactNode;
  title: string;
  iconColor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-700/50">
        <span className={iconColor}>{icon}</span>
        <h2 className="text-sm font-bold text-white">{title}</h2>
      </div>
      <div className="px-5 py-3">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. PHOTOS section
// ---------------------------------------------------------------------------
function PhotoGroup({ label, files }: { label: string; files: SiteSurveyFile[] }) {
  const cfg  = PHOTO_CATEGORY_META[label];
  const title = cfg?.title ?? (label === UNGROUPED ? 'Other Photos' : label.replace(/_/g, ' '));
  const color = cfg?.color ?? 'text-slate-400';
  const icon  = cfg?.icon  ?? <Camera size={13} />;

  return (
    <div className="space-y-2">
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
            <div className="absolute bottom-0 left-0 right-0 px-2 py-1.5
              bg-gradient-to-t from-black/80 to-transparent">
              <span className="text-[9px] text-white/80 font-medium capitalize">
                {title}
              </span>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

function PhotosSection({ files }: { files: SiteSurveyFile[] }) {
  if (files.length === 0) {
    return (
      <SectionCard icon={<ImageIcon size={14} />} title="Photos">
        <div className="py-6 text-center">
          <Camera size={20} className="text-slate-600 mx-auto mb-2" />
          <p className="text-slate-500 text-xs">No photos attached to this survey.</p>
        </div>
      </SectionCard>
    );
  }

  // Group files by label (= PhotoCategory key from Phase 1)
  const grouped: Record<string, SiteSurveyFile[]> = {};
  for (const f of files) {
    const key = f.label ?? UNGROUPED;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(f);
  }

  // Sort: canonical order first, then unknown keys, then ungrouped
  const sortedGroups = [
    ...CATEGORY_ORDER.filter(k => grouped[k]),
    ...Object.keys(grouped).filter(k => !CATEGORY_ORDER.includes(k as PhotoCategory) && k !== UNGROUPED),
    ...(grouped[UNGROUPED] ? [UNGROUPED] : []),
  ];

  return (
    <SectionCard icon={<ImageIcon size={14} />} title={`Photos (${files.length})`} iconColor="text-cyan-400">
      <div className="space-y-5 pt-1">
        {sortedGroups.map(label => (
          <PhotoGroup key={label} label={label} files={grouped[label]} />
        ))}
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// 2. ELECTRICAL section
// ---------------------------------------------------------------------------
function ElectricalSection({ elec }: { elec: SurveyElectricalService }) {
  return (
    <SectionCard icon={<Zap size={14} />} title="Electrical Service" iconColor="text-yellow-400">
      <div className="grid grid-cols-1 md:grid-cols-2">
        <FieldRow label="Panel Brand"          value={fmtVal(elec.panelBrand, PANEL_BRAND_LABELS)} />
        <FieldRow label="Panel Rating"         value={elec.panelRating ? `${elec.panelRating}A` : null} />
        <FieldRow label="Available Slots"      value={fmtVal(elec.availableBreakerSlots)} />
        <FieldRow label="Meter Socket Type"    value={fmtVal(elec.meterSocketType, METER_SOCKET_LABELS)} />
        <FieldRow label="Interconnection Point" value={fmtVal(elec.interconnectionPoint, INTERCONNECTION_LABELS)} />
        <FieldRow label="Service Entrance"     value={fmtVal(elec.serviceEntrance, SERVICE_ENTRANCE_LABELS)} />
        <FieldRow label="Has Sub-Panel"        value={fmtBool(elec.hasSubPanel)} />
        {elec.hasSubPanel && (
          <FieldRow label="Sub-Panel Rating"   value={elec.subPanelRating ? `${elec.subPanelRating}A` : null} />
        )}
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// 3. ROOF section
// ---------------------------------------------------------------------------
function RoofSection({ roof }: { roof: SurveyRoofConditions }) {
  return (
    <SectionCard icon={<Home size={14} />} title="Roof & Mounting" iconColor="text-amber-400">
      <div className="grid grid-cols-1 md:grid-cols-2">
        <FieldRow label="Roof Material"     value={fmtVal(roof.roofMaterial, ROOF_MATERIAL_LABELS)} />
        <FieldRow label="Roof Pitch"        value={fmtVal(roof.roofPitch, ROOF_PITCH_LABELS)} />
        <FieldRow label="Roof Condition"    value={fmtVal(roof.roofCondition)} />
        <FieldRow label="Rafter Spacing"    value={roof.rafterSpacing ? `${roof.rafterSpacing}"` : null} />
        <FieldRow label="Roof Age"          value={roof.roofAgeYears != null ? `${roof.roofAgeYears} years` : null} />
        <FieldRow label="Attic Access"      value={fmtBool(roof.atticAccess)} />
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// 4. OBSTRUCTIONS section
// ---------------------------------------------------------------------------
function ObstructionsSection({ obs }: { obs: SurveyObstructions }) {
  const hasObstructions = obs.obstructions && obs.obstructions.length > 0;

  return (
    <SectionCard icon={<Shield size={14} />} title="Obstructions & Layout" iconColor="text-red-400">
      <div className="space-y-3">
        {/* Summary row */}
        <div className="grid grid-cols-1 md:grid-cols-2">
          <FieldRow
            label="Estimated Usable Roof"
            value={obs.estimatedUsableRoofPct != null ? `${obs.estimatedUsableRoofPct}%` : null}
          />
          <FieldRow
            label="Obstructions Logged"
            value={hasObstructions ? String(obs.obstructions.length) : 'None'}
          />
        </div>

        {/* Obstruction list */}
        {hasObstructions && (
          <div className="space-y-2 pt-1">
            {obs.obstructions.map((o: Obstruction) => (
              <div
                key={o.id}
                className="flex items-start gap-3 p-2.5 rounded-lg bg-slate-800/50 border border-slate-700/40"
              >
                <AlertTriangle size={11} className="text-red-400 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium text-slate-200">
                      {OBSTRUCTION_TYPE_LABELS[o.type] ?? o.type}
                    </span>
                    <span className="text-[10px] text-slate-500 px-1.5 py-0.5 rounded-full bg-slate-700/50">
                      {OBSTRUCTION_LOCATION_LABELS[o.location] ?? o.location}
                    </span>
                  </div>
                  {o.notes && (
                    <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">{o.notes}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// 5. SITE OVERVIEW section
// ---------------------------------------------------------------------------
function SiteOverviewSection({ site }: { site: SurveySiteOverview }) {
  const STRUCTURE_LABELS: Record<string, string> = {
    residential: 'Residential',
    commercial:  'Commercial',
    industrial:  'Industrial',
  };

  return (
    <SectionCard icon={<Sun size={14} />} title="Site Overview" iconColor="text-cyan-400">
      <div className="grid grid-cols-1 md:grid-cols-2">
        <FieldRow label="Site Address"    value={fmtVal(site.siteAddress)} />
        <FieldRow label="Project Name"    value={fmtVal(site.projectName)} />
        <FieldRow label="Inspector"       value={fmtVal(site.inspectorName)} />
        <FieldRow label="Structure Type"  value={fmtVal(site.structureType, STRUCTURE_LABELS)} />
        <FieldRow label="Stories"         value={fmtVal(site.stories)} />
        {(site.latitude != null && site.longitude != null) && (
          <FieldRow
            label="Coordinates"
            value={`${site.latitude.toFixed(5)}, ${site.longitude.toFixed(5)}`}
          />
        )}
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// 6. NOTES section
// ---------------------------------------------------------------------------
function NotesSection({ payload }: { payload: SurveyV2Payload }) {
  const notes = [
    { label: 'Access Notes',      value: payload.siteOverview?.accessNotes },
    { label: 'Mounting Notes',    value: payload.roofConditions?.mountingNotes },
    { label: 'Electrical Notes',  value: payload.electricalService?.electricalNotes },
    { label: 'Setback Notes',     value: payload.obstructions?.setbackNotes },
  ].filter(n => n.value && n.value.trim());

  if (notes.length === 0) return null;

  return (
    <SectionCard icon={<FileText size={14} />} title="Field Notes" iconColor="text-slate-400">
      <div className="space-y-3">
        {notes.map(n => (
          <div key={n.label}>
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">{n.label}</p>
            <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">{n.value}</p>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// 7. RAW DATA — collapsible for engineering debug
// ---------------------------------------------------------------------------
function RawDataSection({ data }: { data: Record<string, unknown> | null }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3.5
          text-xs font-semibold text-slate-500 hover:text-slate-300 transition-colors"
      >
        <span className="flex items-center gap-2">
          <Layers size={12} />
          Developer: Raw Payload
        </span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
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
    reviewed:  { cls: 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/25',          label: 'Reviewed',  icon: <CheckCircle size={11} /> },
    draft:     { cls: 'bg-amber-500/15 text-amber-400 border border-amber-500/25',        label: 'Draft',     icon: <Clock size={11} /> },
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
interface SurveyDetailData {
  survey: SiteSurvey;
  files: SiteSurveyFile[];
}

export default function SurveyDetailPage() {
  const { id: projectId, surveyId } = useParams<{ id: string; surveyId: string }>();

  const [detail,  setDetail]  = useState<SurveyDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch(`/api/site-surveys/${surveyId}`);
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
  }, [surveyId]);

  useEffect(() => {
    if (surveyId) load();
  }, [surveyId, load]);

  // Loading skeleton
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

  // Extract typed SurveyV2Payload if available
  const payload: SurveyV2Payload | null = (() => {
    const d = survey.surveyData;
    if (!d || typeof d !== 'object') return null;
    const rec = d as Record<string, unknown>;
    if (rec.schemaVersion !== '2.0') return null;
    return rec as unknown as SurveyV2Payload;
  })();

  return (
    <AppShell>
      <div className="p-4 md:p-6 space-y-4 animate-fade-in max-w-3xl mx-auto">

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
              {payload && (
                <span className="text-[10px] text-emerald-400 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                  v2.0
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              {survey.addressSnapshot && (
                <span className="flex items-center gap-1 text-xs text-slate-400">
                  <MapPin size={10} />{survey.addressSnapshot}
                </span>
              )}
              <span className="flex items-center gap-1 text-xs text-slate-400">
                <Calendar size={10} />
                {new Date(survey.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
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

        {/* 1. Photos — always shown (from site_survey_files) */}
        <PhotosSection files={files} />

        {/* Typed V2 sections */}
        {payload ? (
          <>
            {/* 2. Electrical */}
            <ElectricalSection elec={payload.electricalService} />

            {/* 3. Roof */}
            <RoofSection roof={payload.roofConditions} />

            {/* 4. Obstructions */}
            <ObstructionsSection obs={payload.obstructions} />

            {/* 5. Site Overview */}
            <SiteOverviewSection site={payload.siteOverview} />

            {/* 6. Notes */}
            <NotesSection payload={payload} />
          </>
        ) : (
          /* Fallback for v1.0 / partner payloads: show raw key-value summary */
          survey.surveyData && (
            <div className="card p-5 space-y-2">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Survey Data</p>
              <p className="text-xs text-slate-500 italic">
                This survey was submitted with a legacy schema. Structured sections are not available.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 border-t border-slate-800 pt-2">
                {Object.entries(survey.surveyData).slice(0, 20).map(([k, v]) => (
                  <FieldRow key={k} label={k} value={typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')} />
                ))}
              </div>
            </div>
          )
        )}

        {/* 7. Raw data (always available, collapsed by default) */}
        <RawDataSection data={survey.surveyData} />

      </div>
    </AppShell>
  );
}