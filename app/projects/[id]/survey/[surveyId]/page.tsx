// ============================================================================
// Survey Detail Page -- /projects/[id]/survey/[surveyId]
//
// Data source: GET /api/site-surveys/[surveyId]  (returns SiteSurvey + SiteSurveyFile[])
// The surveyData JSONB is typed as SurveyV2Payload (schemaVersion: '2.0') for v2
// surveys, or a flat partner payload (v1.0) for Render / mobile-app surveys.
//
// Sections (in order):
//   1. Photos     -- grouped by PhotoCategory key from site_survey_files.label
//   2. Electrical -- typed from SurveyElectricalService (v2) or metadata (v1)
//   3. Roof       -- typed from SurveyRoofConditions (v2) or metadata (v1)
//   4. Obstructions -- typed from SurveyObstructions (v2 only; v1 shows checklist)
//   5. Site Overview -- typed from SurveySiteOverview (v2) or top-level fields (v1)
//   6. Notes      -- accessNotes, mountingNotes, electricalNotes, setbackNotes
//   7. Raw Data   -- collapsible JSON for engineering debug
//
// Rules:
//   - No schema changes
//   - No ingest changes
//   - Data read from getProjectSurveyContext only (via /api/site-surveys/[surveyId])
//   - Photo labels come from site_survey_files.label (category key from Phase 1)
//   - v1.0 partner payloads (schemaVersion missing) are displayed using
//     V1PartnerPayload extraction — no "legacy schema" fallback shown.
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
  Sun, Layers, FileText, Wrench,
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
// V1 partner payload type (Render / site-survey-api)
// Shape confirmed from transformLayer.ts extractPhysicalDataLegacy + extractFilesLegacy
// ---------------------------------------------------------------------------
interface V1PartnerMetadata {
  type?: string;
  azimuth?: number | string;
  rafter_size?: string;
  rafter_spacing?: string | number;
  roof_age_years?: number | string;
  roof_material?: string;
  [key: string]: unknown;
}

interface V1PartnerPhoto {
  id?: string;
  label?: string;
  file_path?: string;
  url?: string;
  mime_type?: string;
  captured_at?: string;
  [key: string]: unknown;
}

interface V1PartnerChecklist {
  label?: string;
  status?: string;
  notes?: string;
  [key: string]: unknown;
}

interface V1PartnerPayload {
  schemaVersion?: undefined; // v1.0 never has this set to '2.0'
  id?: string;
  site_name?: string;
  site_address?: string;
  latitude?: number | string;
  longitude?: number | string;
  inspector_name?: string;
  survey_date?: string;
  category_name?: string;
  metadata?: V1PartnerMetadata;
  photos?: V1PartnerPhoto[];
  checklist?: V1PartnerChecklist[];
  [key: string]: unknown;
}

// Normalized display shape extracted from a V1PartnerPayload
interface V1DisplayData {
  siteName: string | null;
  siteAddress: string | null;
  inspectorName: string | null;
  surveyDate: string | null;
  latitude: number | null;
  longitude: number | null;
  categoryName: string | null;
  // Roof / mounting
  roofMaterial: string | null;
  roofAgeYears: number | null;
  rafterSpacing: string | null;
  rafterSize: string | null;
  azimuth: number | null;
  surveyType: string | null;
  // Checklist items
  checklist: Array<{ label: string; status: string; notes: string | null }>;
}

// ---------------------------------------------------------------------------
// extractV1Display — maps flat partner payload → normalized V1DisplayData.
// Defensive: never throws, always returns null values on missing fields.
// ---------------------------------------------------------------------------
function extractV1Display(raw: Record<string, unknown>): V1DisplayData {
  const p = raw as V1PartnerPayload;
  const meta: V1PartnerMetadata =
    (typeof p.metadata === 'object' && p.metadata !== null)
      ? (p.metadata as V1PartnerMetadata)
      : {};

  const parseLat = (v: unknown): number | null => {
    if (typeof v === 'number' && isFinite(v)) return v;
    if (typeof v === 'string') { const n = parseFloat(v); if (isFinite(n)) return n; }
    return null;
  };

  const parseRafterSpacing = (v: unknown): string | null => {
    if (!v && v !== 0) return null;
    const s = String(v).trim();
    if (!s) return null;
    // Normalize "24in" / "24" / 24 → '24"'
    const num = parseFloat(s.replace(/[^0-9.]/g, ''));
    if (isFinite(num)) return `${num}"`;
    return s;
  };

  const checklist: V1DisplayData['checklist'] = [];
  if (Array.isArray(p.checklist)) {
    for (const item of p.checklist) {
      if (typeof item === 'object' && item !== null) {
        const ci = item as V1PartnerChecklist;
        checklist.push({
          label:  typeof ci.label  === 'string' ? ci.label  : 'Item',
          status: typeof ci.status === 'string' ? ci.status : 'unknown',
          notes:  typeof ci.notes  === 'string' && ci.notes.trim() ? ci.notes.trim() : null,
        });
      }
    }
  }

  const azimuth = typeof meta.azimuth === 'number'
    ? meta.azimuth
    : typeof meta.azimuth === 'string' ? parseFloat(meta.azimuth) || null : null;

  const roofAgeYears = (() => {
    const v = meta.roof_age_years;
    if (typeof v === 'number' && isFinite(v)) return Math.round(v);
    if (typeof v === 'string') { const n = parseInt(v, 10); return isFinite(n) ? n : null; }
    return null;
  })();

  return {
    siteName:      typeof p.site_name    === 'string' && p.site_name.trim()    ? p.site_name.trim()    : null,
    siteAddress:   typeof p.site_address === 'string' && p.site_address.trim() ? p.site_address.trim() : null,
    inspectorName: typeof p.inspector_name === 'string' && p.inspector_name.trim() ? p.inspector_name.trim() : null,
    surveyDate:    typeof p.survey_date  === 'string' && p.survey_date.trim()  ? p.survey_date.trim()  : null,
    latitude:      parseLat(p.latitude),
    longitude:     parseLat(p.longitude),
    categoryName:  typeof p.category_name === 'string' && p.category_name.trim() ? p.category_name.trim() : null,
    roofMaterial:  typeof meta.roof_material === 'string' && meta.roof_material.trim() ? meta.roof_material.trim() : null,
    roofAgeYears,
    rafterSpacing: parseRafterSpacing(meta.rafter_spacing),
    rafterSize:    typeof meta.rafter_size === 'string' && meta.rafter_size.trim() ? meta.rafter_size.trim() : null,
    azimuth:       typeof azimuth === 'number' && isFinite(azimuth) ? azimuth : null,
    surveyType:    typeof meta.type === 'string' && meta.type.trim() ? meta.type.trim() : null,
    checklist,
  };
}

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
// V1 SECTIONS — rendered when surveyData is a v1.0 partner payload
// ---------------------------------------------------------------------------

/** V1 Site Info section */
function V1SiteSection({ d }: { d: V1DisplayData }) {
  return (
    <SectionCard icon={<Sun size={14} />} title="Site Overview" iconColor="text-cyan-400">
      <div className="grid grid-cols-1 md:grid-cols-2">
        <FieldRow label="Site Name"       value={d.siteName} />
        <FieldRow label="Site Address"    value={d.siteAddress} />
        <FieldRow label="Inspector"       value={d.inspectorName} />
        <FieldRow label="Survey Date"     value={d.surveyDate} />
        <FieldRow label="Survey Type"     value={d.surveyType} />
        <FieldRow label="Category"        value={d.categoryName} />
        {d.latitude != null && d.longitude != null && (
          <FieldRow
            label="Coordinates"
            value={`${d.latitude.toFixed(5)}, ${d.longitude.toFixed(5)}`}
          />
        )}
      </div>
    </SectionCard>
  );
}

/** V1 Roof & Mounting section */
function V1RoofSection({ d }: { d: V1DisplayData }) {
  // Only render if at least one field has data
  const hasData = d.roofMaterial || d.roofAgeYears != null || d.rafterSpacing || d.rafterSize || d.azimuth != null;
  if (!hasData) return null;

  return (
    <SectionCard icon={<Home size={14} />} title="Roof & Mounting" iconColor="text-amber-400">
      <div className="grid grid-cols-1 md:grid-cols-2">
        <FieldRow label="Roof Material"  value={d.roofMaterial ? (ROOF_MATERIAL_LABELS[d.roofMaterial] ?? d.roofMaterial) : null} />
        <FieldRow label="Roof Age"       value={d.roofAgeYears != null ? `${d.roofAgeYears} years` : null} />
        <FieldRow label="Rafter Spacing" value={d.rafterSpacing} />
        <FieldRow label="Rafter Size"    value={d.rafterSize} />
        <FieldRow label="Azimuth"        value={d.azimuth != null ? `${d.azimuth}°` : null} />
      </div>
    </SectionCard>
  );
}

/** V1 Checklist section — rendered if partner sent checklist items */
function V1ChecklistSection({ items }: { items: V1DisplayData['checklist'] }) {
  if (items.length === 0) return null;

  const STATUS_COLORS: Record<string, string> = {
    pass:    'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    fail:    'text-red-400 bg-red-500/10 border-red-500/20',
    n_a:     'text-slate-500 bg-slate-700/30 border-slate-600/20',
    na:      'text-slate-500 bg-slate-700/30 border-slate-600/20',
    pending: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  };

  return (
    <SectionCard icon={<Wrench size={14} />} title="Field Checklist" iconColor="text-teal-400">
      <div className="space-y-2">
        {items.map((item, i) => {
          const statusKey = item.status.toLowerCase().replace(/[^a-z]/g, '_');
          const statusCls = STATUS_COLORS[statusKey] ?? STATUS_COLORS['pending'];
          return (
            <div
              key={i}
              className="flex items-start gap-3 p-2.5 rounded-lg bg-slate-800/40 border border-slate-700/30"
            >
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border flex-shrink-0 mt-0.5 capitalize ${statusCls}`}>
                {item.status}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-200 font-medium">{item.label}</p>
                {item.notes && (
                  <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">{item.notes}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </SectionCard>
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

  // ---------------------------------------------------------------------------
  // Determine payload version:
  //   payload  = SurveyV2Payload | null  (schemaVersion === '2.0')
  //   v1Data   = V1DisplayData | null    (partner payload — all other surveys)
  // Exactly one of these will be non-null for any survey that has surveyData.
  // ---------------------------------------------------------------------------
  const payload: SurveyV2Payload | null = (() => {
    const d = survey.surveyData;
    if (!d || typeof d !== 'object') return null;
    const rec = d as Record<string, unknown>;
    if (rec.schemaVersion !== '2.0') return null;
    return rec as unknown as SurveyV2Payload;
  })();

  const v1Data: V1DisplayData | null = (() => {
    if (payload) return null; // v2 — don't extract v1
    const d = survey.surveyData;
    if (!d || typeof d !== 'object') return null;
    return extractV1Display(d as Record<string, unknown>);
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
              {v1Data && (
                <span className="text-[10px] text-slate-400 px-2 py-0.5 rounded-full bg-slate-700/40 border border-slate-600/30">
                  Field Survey
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

        {/* ------------------------------------------------------------------ */}
        {/* Typed V2 sections                                                   */}
        {/* ------------------------------------------------------------------ */}
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
        ) : v1Data ? (
          /* ------------------------------------------------------------------ */
          /* V1 partner payload sections (Render / mobile-app surveys)          */
          /* ------------------------------------------------------------------ */
          <>
            {/* Site info */}
            <V1SiteSection d={v1Data} />

            {/* Roof & mounting (only shown if metadata fields are present) */}
            <V1RoofSection d={v1Data} />

            {/* Field checklist (if partner sent one) */}
            <V1ChecklistSection items={v1Data.checklist} />
          </>
        ) : (
          /* No surveyData at all — show empty state */
          <div className="card p-5 text-center">
            <p className="text-xs text-slate-500 italic">No survey data available for this record.</p>
          </div>
        )}

        {/* 7. Raw data (always available, collapsed by default) */}
        <RawDataSection data={survey.surveyData} />

      </div>
    </AppShell>
  );
}