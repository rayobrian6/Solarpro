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

"use client";

import React, { Component, useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import AppShell from "@/components/ui/AppShell";
import {
  ArrowLeft,
  Camera,
  Home,
  Zap,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  RefreshCw,
  CheckCircle,
  Clock,
  Network,
  MapPin,
  User,
  Calendar,
  ImageIcon,
  Shield,
  Sun,
  Layers,
  FileText,
  Wrench,
  Maximize2,
} from "lucide-react";
import type { SiteSurvey, SiteSurveyFile } from "@/lib/db-neon";
import type {
  SurveyEvidenceCategory,
  SurveyEvidenceDomain,
  SurveyEvidenceManifest,
} from "@/lib/survey/evidence/manifest";
import type { ProjectSurveyEvidenceHygieneManifest } from "@/lib/survey/evidence/sessionGrouping";
import type { SurveyEvidenceEngineeringBridge } from "@/lib/survey/evidence/engineeringBridge";
import type { SurveyEvidenceTraceabilityBundle } from "@/lib/survey/evidence/provenance";
import type {
  SurveyV2Payload,
  SurveyElectricalService,
  SurveyRoofConditions,
  SurveyObstructions,
  SurveySiteOverview,
  Obstruction,
  PhotoCategory,
} from "@/lib/survey/v2/types";

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
    typeof p.metadata === "object" && p.metadata !== null
      ? (p.metadata as V1PartnerMetadata)
      : {};

  const parseLat = (v: unknown): number | null => {
    if (typeof v === "number" && isFinite(v)) return v;
    if (typeof v === "string") {
      const n = parseFloat(v);
      if (isFinite(n)) return n;
    }
    return null;
  };

  const parseRafterSpacing = (v: unknown): string | null => {
    if (!v && v !== 0) return null;
    const s = String(v).trim();
    if (!s) return null;
    // Normalize "24in" / "24" / 24 → '24"'
    const num = parseFloat(s.replace(/[^0-9.]/g, ""));
    if (isFinite(num)) return `${num}"`;
    return s;
  };

  const checklist: V1DisplayData["checklist"] = [];
  if (Array.isArray(p.checklist)) {
    for (const item of p.checklist) {
      if (typeof item === "object" && item !== null) {
        const ci = item as V1PartnerChecklist;
        checklist.push({
          label: typeof ci.label === "string" ? ci.label : "Item",
          status: typeof ci.status === "string" ? ci.status : "unknown",
          notes:
            typeof ci.notes === "string" && ci.notes.trim()
              ? ci.notes.trim()
              : null,
        });
      }
    }
  }

  const azimuth =
    typeof meta.azimuth === "number"
      ? meta.azimuth
      : typeof meta.azimuth === "string"
        ? parseFloat(meta.azimuth) || null
        : null;

  const roofAgeYears = (() => {
    const v = meta.roof_age_years;
    if (typeof v === "number" && isFinite(v)) return Math.round(v);
    if (typeof v === "string") {
      const n = parseInt(v, 10);
      return isFinite(n) ? n : null;
    }
    return null;
  })();

  return {
    siteName:
      typeof p.site_name === "string" && p.site_name.trim()
        ? p.site_name.trim()
        : null,
    siteAddress:
      typeof p.site_address === "string" && p.site_address.trim()
        ? p.site_address.trim()
        : null,
    inspectorName:
      typeof p.inspector_name === "string" && p.inspector_name.trim()
        ? p.inspector_name.trim()
        : null,
    surveyDate:
      typeof p.survey_date === "string" && p.survey_date.trim()
        ? p.survey_date.trim()
        : null,
    latitude: parseLat(p.latitude),
    longitude: parseLat(p.longitude),
    categoryName:
      typeof p.category_name === "string" && p.category_name.trim()
        ? p.category_name.trim()
        : null,
    roofMaterial:
      typeof meta.roof_material === "string" && meta.roof_material.trim()
        ? meta.roof_material.trim()
        : null,
    roofAgeYears,
    rafterSpacing: parseRafterSpacing(meta.rafter_spacing),
    rafterSize:
      typeof meta.rafter_size === "string" && meta.rafter_size.trim()
        ? meta.rafter_size.trim()
        : null,
    azimuth: typeof azimuth === "number" && isFinite(azimuth) ? azimuth : null,
    surveyType:
      typeof meta.type === "string" && meta.type.trim()
        ? meta.type.trim()
        : null,
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
  main_panel_open: {
    title: "Main Panel (Open)",
    color: "text-yellow-400",
    icon: <Zap size={13} />,
  },
  main_panel_closed: {
    title: "Main Panel (Closed)",
    color: "text-yellow-400",
    icon: <Zap size={13} />,
  },
  meter: {
    title: "Utility Meter",
    color: "text-blue-400",
    icon: <Zap size={13} />,
  },
  roof_overview: {
    title: "Roof Overview",
    color: "text-amber-400",
    icon: <Home size={13} />,
  },
  roof_detail: {
    title: "Roof Detail",
    color: "text-amber-400",
    icon: <Home size={13} />,
  },
  service_entrance: {
    title: "Service Entrance",
    color: "text-purple-400",
    icon: <Zap size={13} />,
  },
  attic_access: {
    title: "Attic Access",
    color: "text-teal-400",
    icon: <Home size={13} />,
  },
  obstruction: {
    title: "Obstruction",
    color: "text-red-400",
    icon: <AlertTriangle size={13} />,
  },
  additional: {
    title: "Additional",
    color: "text-slate-400",
    icon: <Camera size={13} />,
  },
};

const CATEGORY_ORDER: PhotoCategory[] = [
  "roof_overview",
  "roof_detail",
  "main_panel_open",
  "main_panel_closed",
  "meter",
  "service_entrance",
  "attic_access",
  "obstruction",
  "additional",
];

const UNGROUPED = "__other__";

// ---------------------------------------------------------------------------
// Human-readable display maps
// ---------------------------------------------------------------------------
const ROOF_MATERIAL_LABELS: Record<string, string> = {
  comp_shingle: "Composition Shingle",
  tile_concrete: "Concrete Tile",
  tile_clay: "Clay Tile",
  metal_standing_seam: "Metal Standing Seam",
  metal_r_panel: "Metal R-Panel",
  flat_tpo: "Flat — TPO",
  flat_epdm: "Flat — EPDM",
  flat_torch: "Flat — Torch Down",
  wood_shake: "Wood Shake",
  other: "Other",
};

const ROOF_PITCH_LABELS: Record<string, string> = {
  flat: "Flat (< 2 deg)",
  low: "Low (2-4 deg)",
  standard: "Standard (5-9 deg)",
  steep: "Steep (10-14 deg)",
  very_steep: "Very Steep (15+ deg)",
};

const PANEL_BRAND_LABELS: Record<string, string> = {
  siemens: "Siemens",
  square_d: "Square D",
  eaton: "Eaton",
  cutler_hammer: "Cutler-Hammer",
  ge: "GE",
  federal_pacific: "Federal Pacific",
  zinsco: "Zinsco",
  leviton: "Leviton",
  other: "Other",
};

const METER_SOCKET_LABELS: Record<string, string> = {
  standard: "Standard",
  combo: "Combo Meter-Main",
  "320a": "320A Ringless",
  other: "Other",
};

const INTERCONNECTION_LABELS: Record<string, string> = {
  main_panel: "Main Panel (Line Side)",
  sub_panel: "Sub-Panel",
  load_side: "Load Side Tap",
  supply_side: "Supply Side Tap",
};

const SERVICE_ENTRANCE_LABELS: Record<string, string> = {
  overhead: "Overhead",
  underground: "Underground",
};

const OBSTRUCTION_TYPE_LABELS: Record<string, string> = {
  chimney: "Chimney",
  hvac_unit: "HVAC Unit",
  vent_pipe: "Vent Pipe",
  skylight: "Skylight",
  dormer: "Dormer",
  tree_shade: "Tree / Shade",
  antenna: "Antenna",
  satellite_dish: "Satellite Dish",
  exhaust_fan: "Exhaust Fan",
  solar_tube: "Solar Tube",
  other: "Other",
};

const OBSTRUCTION_LOCATION_LABELS: Record<string, string> = {
  north: "North",
  south: "South",
  east: "East",
  west: "West",
  ridge: "Ridge",
  valley: "Valley",
  center: "Center",
};

// ---------------------------------------------------------------------------
// Helper: format raw value to display string
// ---------------------------------------------------------------------------
function fmtVal(v: unknown, labels?: Record<string, string>): string | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v);
  if (labels && labels[s]) return labels[s];
  return s;
}

function fmtBool(v: boolean | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  return v ? "Yes" : "No";
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
  const isEmpty = value === null || value === undefined || value === "";
  return (
    <div
      className={`flex items-start justify-between gap-3 py-2.5 border-b border-slate-800/50 last:border-0 ${wide ? "col-span-2" : ""}`}
    >
      <span className="text-xs text-slate-500 flex-shrink-0 min-w-[140px]">
        {label}
      </span>
      <span className="text-xs text-right">
        {isEmpty ? (
          <span className="text-slate-600 italic">Not captured</span>
        ) : (
          <span className="text-slate-200">{value}</span>
        )}
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
  iconColor = "text-cyan-400",
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

class SurveyPanelErrorBoundary extends Component<
  { title: string; children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`[SurveyPanelErrorBoundary] ${this.props.title}`, error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <SectionCard
        icon={<AlertTriangle size={14} />}
        title={this.props.title}
        iconColor="text-amber-400"
      >
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3">
          <div className="flex items-center gap-2 text-amber-200">
            <AlertTriangle size={13} />
            <p className="text-xs font-semibold">Panel failed safely</p>
          </div>
          <p className="mt-1 text-[11px] text-amber-100/80">
            {this.state.error.message ||
              "This panel could not render, but the survey page remains available."}
          </p>
        </div>
      </SectionCard>
    );
  }
}

function safeArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

// ---------------------------------------------------------------------------
// 1. PHOTOS section
// ---------------------------------------------------------------------------
function PhotoGroup({
  label,
  files,
}: {
  label: string;
  files: SiteSurveyFile[];
}) {
  const cfg = PHOTO_CATEGORY_META[label];
  const title =
    cfg?.title ??
    (label === UNGROUPED ? "Other Photos" : label.replace(/_/g, " "));
  const color = cfg?.color ?? "text-slate-400";
  const icon = cfg?.icon ?? <Camera size={13} />;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className={color}>{icon}</span>
        <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
          {title}
        </h4>
        <span className="text-xs text-slate-600">({files.length})</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {files.map((file) => (
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
              alt={file.filename ?? file.label ?? "Survey photo"}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              loading="lazy"
            />
            <div
              className="absolute bottom-0 left-0 right-0 px-2 py-1.5
              bg-gradient-to-t from-black/80 to-transparent"
            >
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
          <p className="text-slate-500 text-xs">
            No photos attached to this survey.
          </p>
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
    ...CATEGORY_ORDER.filter((k) => grouped[k]),
    ...Object.keys(grouped).filter(
      (k) => !CATEGORY_ORDER.includes(k as PhotoCategory) && k !== UNGROUPED,
    ),
    ...(grouped[UNGROUPED] ? [UNGROUPED] : []),
  ];

  return (
    <SectionCard
      icon={<ImageIcon size={14} />}
      title={`Photos (${files.length})`}
      iconColor="text-cyan-400"
    >
      <div className="space-y-5 pt-1">
        {sortedGroups.map((label) => (
          <PhotoGroup key={label} label={label} files={grouped[label]} />
        ))}
      </div>
    </SectionCard>
  );
}

const DOMAIN_LABELS: Record<SurveyEvidenceDomain, string> = {
  electrical: "Electrical",
  roof: "Roof",
  site: "Site",
  general: "General",
};

const DOMAIN_COLORS: Record<SurveyEvidenceDomain, string> = {
  electrical: "text-yellow-300 border-yellow-500/20 bg-yellow-500/10",
  roof: "text-amber-300 border-amber-500/20 bg-amber-500/10",
  site: "text-cyan-300 border-cyan-500/20 bg-cyan-500/10",
  general: "text-slate-300 border-slate-500/20 bg-slate-500/10",
};

function evidenceCategoryLabel(category: SurveyEvidenceCategory): string {
  return category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function SurveySessionHygieneViewer({
  hygiene,
  currentSurveyId,
}: {
  hygiene: ProjectSurveyEvidenceHygieneManifest | null | undefined;
  currentSurveyId: string;
}) {
  if (!hygiene || hygiene.surveySubmissionCount <= 1) return null;

  const canonical = hygiene.sessions.find(
    (session) => session.surveyId === hygiene.canonicalSurveyId,
  );
  const historical = hygiene.sessions.filter(
    (session) => session.surveyId !== hygiene.canonicalSurveyId,
  );

  return (
    <SectionCard
      icon={<Layers size={14} />}
      title="Survey Session Duplicate Hygiene v1"
      iconColor="text-cyan-400"
    >
      <div className="space-y-4">
        {hygiene.banner && (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3">
            <div className="flex items-center gap-2 text-amber-200">
              <AlertTriangle size={13} />
              <p className="text-xs font-semibold">{hygiene.banner}</p>
            </div>
            <p className="mt-1 text-[11px] text-amber-100/80">
              Raw uploads are preserved. Required coverage, engineering bridge
              counts, and permit evidence summaries use canonical metadata
              representatives so repeated path walks do not inflate confidence.
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-3">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">
              Survey Submissions
            </p>
            <p className="text-lg font-bold text-white">
              {hygiene.surveySubmissionCount}
            </p>
          </div>
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-3">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">
              Raw Photo Uploads
            </p>
            <p className="text-lg font-bold text-white">
              {hygiene.rawEvidenceCount}
            </p>
          </div>
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3">
            <p className="text-[10px] uppercase tracking-wider text-emerald-300/80">
              Canonical Evidence
            </p>
            <p className="text-lg font-bold text-emerald-100">
              {hygiene.canonicalEvidenceCount}
            </p>
          </div>
          <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-3">
            <p className="text-[10px] uppercase tracking-wider text-cyan-300/80">
              Collapsed Repeats
            </p>
            <p className="text-lg font-bold text-cyan-100">
              {hygiene.collapsedDuplicateEvidenceCount}
            </p>
          </div>
        </div>

        {canonical && (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3">
            <p className="text-[10px] font-semibold text-emerald-300 uppercase tracking-wider">
              Canonical / current survey session
            </p>
            <p className="mt-1 text-xs text-emerald-100 break-all">
              {canonical.surveyId}
              {canonical.surveyId === currentSurveyId
                ? " (currently viewing)"
                : ""}
            </p>
            <p className="text-[11px] text-emerald-100/75">
              {canonical.rawPhotoCount} raw photo(s),{" "}
              {canonical.canonicalEvidenceCount} canonical evidence
              representative(s), technician {canonical.technician ?? "unknown"}.
            </p>
          </div>
        )}

        {historical.length > 0 && (
          <details className="rounded-xl border border-slate-700/60 bg-slate-900/40 p-3">
            <summary className="cursor-pointer text-xs font-semibold text-slate-300">
              Historical repeated survey submissions preserved (
              {historical.length})
            </summary>
            <div className="mt-3 space-y-2">
              {historical.map((session) => (
                <div
                  key={session.surveyId}
                  className="rounded-lg border border-slate-700/50 bg-slate-950/30 p-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] text-slate-300 break-all">
                      {session.surveyId}
                      {session.surveyId === currentSurveyId
                        ? " (currently viewing)"
                        : ""}
                    </p>
                    <span className="text-[9px] uppercase rounded-full border border-amber-500/20 bg-amber-500/10 text-amber-300 px-2 py-0.5">
                      {session.surveySessionDuplicateStatus}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500">
                    {session.rawPhotoCount} raw photo(s),{" "}
                    {session.canonicalEvidenceCount} canonical
                    representative(s), submitted{" "}
                    {session.submittedAt
                      ? new Date(session.submittedAt).toLocaleString()
                      : "unknown time"}
                    .
                  </p>
                </div>
              ))}
            </div>
          </details>
        )}

        {hygiene.evidenceDuplicateGroups.length > 0 && (
          <details className="rounded-xl border border-slate-700/60 bg-slate-900/40 p-3">
            <summary className="cursor-pointer text-xs font-semibold text-slate-300">
              Photo evidence duplicate groups (
              {hygiene.evidenceDuplicateGroups.length})
            </summary>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
              {hygiene.evidenceDuplicateGroups.map((group) => (
                <div
                  key={group.evidenceDuplicateGroupId}
                  className="rounded-lg border border-slate-700/50 bg-slate-950/30 p-2"
                >
                  <p className="text-[11px] font-medium text-slate-200">
                    {evidenceCategoryLabel(group.category)}
                  </p>
                  <p className="text-[10px] text-slate-500">
                    Canonical evidence: {group.canonicalEvidenceId}
                  </p>
                  <p className="text-[10px] text-slate-500">
                    Raw uploads: {group.rawUploadCount}; duplicates collapsed:{" "}
                    {group.duplicateCount}
                  </p>
                  <p className="text-[10px] text-slate-600">
                    Reason: {group.duplicateReason}
                  </p>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </SectionCard>
  );
}

function SurveyTraceabilityViewer({
  traceability,
}: {
  traceability: SurveyEvidenceTraceabilityBundle | null | undefined;
}) {
  if (!traceability) return null;

  return (
    <SectionCard
      icon={<Shield size={14} />}
      title="Evidence Provenance + Requirement Traceability v1"
      iconColor="text-emerald-400"
    >
      <div className="space-y-3">
        <details
          className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-3"
          open
        >
          <summary className="cursor-pointer text-xs font-semibold text-cyan-200">
            Requirement Evidence Traceability
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-2">
            {traceability.requirements.map((requirement) => (
              <div
                key={requirement.requirementCategory}
                className="rounded-lg border border-slate-700/50 bg-slate-950/30 p-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold text-slate-200">
                    {requirement.requirementLabel}
                  </p>
                  <span
                    className={`text-[9px] uppercase rounded-full border px-2 py-0.5 ${requirement.requirementSatisfied ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300" : "border-amber-500/20 bg-amber-500/10 text-amber-300"}`}
                  >
                    {requirement.requirementSatisfied ? "satisfied" : "missing"}
                  </span>
                </div>
                <p className="mt-1 text-[10px] text-slate-500 break-all">
                  Evidence: {requirement.canonicalEvidenceId ?? "none"} |
                  Survey: {requirement.originatingSurveyId ?? "none"} | Bucket:{" "}
                  {requirement.engineeringBucket}
                </p>
                <p className="text-[10px] text-slate-600">
                  Reason: {requirement.selectionReason}
                </p>
              </div>
            ))}
          </div>
        </details>

        <details className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3">
          <summary className="cursor-pointer text-xs font-semibold text-emerald-200">
            Canonical Evidence Provenance
          </summary>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
            {traceability.canonicalEvidence.map((record) => (
              <div
                key={record.canonicalEvidenceId}
                className="rounded-lg border border-slate-700/50 bg-slate-950/30 p-2"
              >
                <p className="text-[11px] font-medium text-slate-200">
                  {record.evidenceCategoryLabel}
                </p>
                <p className="text-[10px] text-slate-500 break-all">
                  Canonical evidence: {record.canonicalEvidenceId}
                </p>
                <p className="text-[10px] text-slate-500">
                  Origin survey: {record.originatingSurveyId} (
                  {record.originatingSurveyCreatedAt
                    ? new Date(
                        record.originatingSurveyCreatedAt,
                      ).toLocaleString()
                    : "unknown time"}
                  )
                </p>
                <p className="text-[10px] text-slate-500">
                  Duplicate group size: {record.duplicateGroupSize} | Confidence
                  source: {record.requirementConfidenceSource}
                </p>
                <p className="text-[10px] text-slate-600">
                  Selection: {record.selectionReason}
                </p>
              </div>
            ))}
          </div>
        </details>

        <details className="rounded-xl border border-indigo-500/20 bg-indigo-500/10 p-3">
          <summary className="cursor-pointer text-xs font-semibold text-indigo-200">
            Survey Lineage
          </summary>
          <div className="mt-3 space-y-2">
            {traceability.surveyLineage.length === 0 ? (
              <p className="text-[11px] text-slate-500">
                No repeated-survey lineage context was attached; canonical
                manifest provenance still identifies originating survey ids.
              </p>
            ) : (
              traceability.surveyLineage.map((record) => (
                <div
                  key={record.surveyId}
                  className="rounded-lg border border-slate-700/50 bg-slate-950/30 p-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] text-slate-300 break-all">
                      {record.surveyId}
                    </p>
                    <span className="text-[9px] uppercase rounded-full border border-indigo-500/20 bg-indigo-500/10 text-indigo-300 px-2 py-0.5">
                      {record.duplicateStatus}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500">
                    {record.rawPhotoCount} raw upload(s) audit-only,{" "}
                    {record.canonicalEvidenceCount} canonical representative(s),
                    submitted{" "}
                    {record.submittedAt
                      ? new Date(record.submittedAt).toLocaleString()
                      : "unknown time"}
                    .
                  </p>
                </div>
              ))
            )}
          </div>
        </details>
      </div>
    </SectionCard>
  );
}

interface PhotoClassificationCandidatePreview {
  fileId: string;
  filename: string | null;
  fileUrl: string;
  currentLabel: string | null;
  currentCategory: SurveyEvidenceCategory;
  suggestedCategory: SurveyEvidenceCategory;
  suggestedLabel: string;
  confidence: "high" | "medium" | "low";
  evidenceSignals: string[];
  rationale: string;
  reviewRequired: boolean;
  openSourceAnalysis: {
    analyzed: boolean;
    qualityScore: number;
    qualityStatus: "good" | "review_required" | "poor" | "unavailable";
    qualityFlags: string[];
    duplicateGroupId: string | null;
    duplicateRank: number | null;
    duplicateGroupSize: number;
    isDuplicateRepresentative: boolean;
    sharpnessScore: number | null;
    brightnessScore: number | null;
    widthPx: number | null;
    heightPx: number | null;
  } | null;
}

interface PhotoClassificationPreviewResponse {
  schemaVersion: "survey_photo_classification_preview_v1";
  mode: string;
  totalPhotoCount: number;
  processedPhotoCount: number;
  skippedPhotoCount: number;
  requestedLimit: number;
  openSourceAnalysisSummary?: {
    analyzedPhotoCount: number;
    duplicateGroupCount: number;
    duplicatePhotoCount: number;
    qualityReviewRequiredCount: number;
    engine: string;
  };
  visionExecuted: boolean;
  categoryCounts: Partial<Record<SurveyEvidenceCategory, number>>;
  candidates: PhotoClassificationCandidatePreview[];
  note: string;
  noAuthorityEnforcement: Record<string, boolean>;
}


interface OpenSourcePhotoVisionStoredCandidate {
  id: string;
  surveyId: string;
  fileId: string;
  toolName: string;
  toolVersion: string;
  runHash: string;
  candidateType: string;
  candidateCategory: string;
  payload: Record<string, unknown>;
  confidence: number;
  limitations: string[];
  reviewStatus: "review_required" | "accepted_review_reference" | "rejected";
  deterministicHash: string;
  thumbnailDataUrl: string | null;
  createdAt: string;
}

interface OpenSourcePhotoVisionBundle {
  schemaVersion: "open_source_photo_vision_stored_bundle_v1";
  surveyId: string;
  toolName: string;
  toolVersion: string;
  candidateCount: number;
  latestRunHash: string | null;
  candidates: OpenSourcePhotoVisionStoredCandidate[];
  authority: {
    reviewOnly: true;
    nonAuthoritative: true;
    canonicalMutationAllowed: false;
    cadMutationAllowed: false;
    permitGenerationAllowed: false;
    bomMutationAllowed: false;
    engineeringWorkflowMutationAllowed: false;
  };
  limitations: string[];
}

interface OpenSourcePhotoVisionRunSummary {
  processedFileCount: number;
  failedFileCount: number;
  candidateCount: number;
  candidateTypeCounts: Record<string, number>;
  unavailableDiagnostics: string[];
  runHash: string;
}

interface OpenSourcePhotoVisionRunResponse {
  summary: OpenSourcePhotoVisionRunSummary;
  stored: OpenSourcePhotoVisionBundle;
  meta: Record<string, boolean>;
}

interface PhotoClassificationApplyDiagnosticsState {
  status: "success" | "conflict" | "error";
  message: string;
  applyRequestFired: boolean;
  httpStatus: number | null;
  requestedCount: number | null;
  acceptedCount: number | null;
  updateCount: number | null;
  updatedCount: number | null;
  persistedCount: number | null;
  rejectedCount: number | null;
  classifiedItems: number | null;
  promotedAiReviewedCount: number | null;
  suppressedDuplicateCount: number | null;
  requiredMissing: string[];
  unmatchedFileIds: string[];
  failedFileIds: string[];
  rowMatchFailures: string[];
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asNullableBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function summarizeRowMatchFailures(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const fileId = typeof record.fileId === "string" ? record.fileId : "unknown";
      const failedPredicates = [
        ["file row", record.fileRowExists],
        ["survey match", record.fileBelongsToRequestedSurvey],
        ["linked survey", record.linkedSurveyRowExists],
        ["linked client", record.linkedClientRowExists],
        ["client user", record.clientBelongsToAuthenticatedUser],
      ]
        .filter(([, passed]) => passed === false)
        .map(([label]) => label);
      return failedPredicates.length > 0
        ? `${fileId}: ${failedPredicates.join(", ")}`
        : `${fileId}: update predicate reported no explicit failed condition`;
    })
    .filter((item): item is string => typeof item === "string");
}

function buildApplyDiagnosticsState(
  status: PhotoClassificationApplyDiagnosticsState["status"],
  message: string,
  diagnostics: Record<string, unknown> | null | undefined,
  lifecycle?: { applyRequestFired?: boolean; httpStatus?: number | null },
): PhotoClassificationApplyDiagnosticsState {
  const persistence =
    diagnostics && typeof diagnostics.persistence === "object"
      ? (diagnostics.persistence as Record<string, unknown>)
      : diagnostics;
  const canonicalCounts =
    diagnostics && typeof diagnostics.canonicalCounts === "object"
      ? (diagnostics.canonicalCounts as Record<string, unknown>)
      : null;
  const persistedSnapshot = Array.isArray(persistence?.persistedLabelSnapshot)
    ? persistence.persistedLabelSnapshot
    : [];
  const failedPersistence = Array.isArray(persistence?.failedPersistence)
    ? persistence.failedPersistence
    : [];

  return {
    status,
    message,
    applyRequestFired:
      lifecycle?.applyRequestFired ??
      asNullableBoolean(persistence?.requestReceived) ??
      false,
    httpStatus: lifecycle?.httpStatus ?? asNullableNumber(persistence?.httpStatus),
    requestedCount: asNullableNumber(persistence?.requestedCount),
    acceptedCount: asNullableNumber(persistence?.acceptedCount),
    updateCount: asNullableNumber(persistence?.updateCount),
    updatedCount: asNullableNumber(persistence?.updatedCount),
    persistedCount: Array.isArray(persistence?.persistedLabelSnapshot)
      ? persistedSnapshot.length
      : asNullableNumber(persistence?.persistedCount),
    rejectedCount: asNullableNumber(persistence?.rejectedCount),
    classifiedItems: asNullableNumber(canonicalCounts?.classifiedItems),
    promotedAiReviewedCount: asNullableNumber(
      canonicalCounts?.promotedAiReviewedCount,
    ),
    suppressedDuplicateCount: asNullableNumber(
      canonicalCounts?.suppressedDuplicateCount,
    ),
    requiredMissing: asStringArray(canonicalCounts?.requiredMissing),
    unmatchedFileIds: asStringArray(persistence?.unmatchedFileIds),
    failedFileIds: failedPersistence
      .map((item) =>
        item && typeof item === "object"
          ? (item as Record<string, unknown>).fileId
          : null,
      )
      .filter((item): item is string => typeof item === "string"),
    rowMatchFailures: summarizeRowMatchFailures(persistence?.rowMatchDiagnostics),
  };
}

function SurveyPhotoClassificationPreviewPanel({
  surveyId,
  manifest,
  onCanonicalDetailRefresh,
}: {
  surveyId: string;
  manifest: SurveyEvidenceManifest | null | undefined;
  onCanonicalDetailRefresh?: (detail: Partial<SurveyDetailData>) => void;
}) {
  const [preview, setPreview] =
    useState<PhotoClassificationPreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applyLoading, setApplyLoading] = useState(false);
  const [applyResult, setApplyResult] = useState<string | null>(null);
  const [applyDiagnostics, setApplyDiagnostics] =
    useState<PhotoClassificationApplyDiagnosticsState | null>(null);
  const uncategorizedCount =
    manifest?.items.filter((item) => item.category === "uncategorized")
      .length ?? 0;
  const classifiedCount = manifest?.summary.classifiedItems ?? 0;
  const totalItems = manifest?.summary.totalItems ?? 0;

  const runPreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/site-surveys/${surveyId}/photo-classification-preview`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ limit: 12 }),
        },
      );
      const json = await res.json();
      if (!json.success) {
        setError(
          [json.error, json.detail].filter(Boolean).join(": ") ||
            "Photo classification preview failed",
        );
        return;
      }
      const nextPreview =
        json.data as PhotoClassificationPreviewResponse | null;
      if (!nextPreview || !Array.isArray(nextPreview.candidates)) {
        setError("Photo classification preview returned an unexpected shape");
        return;
      }
      setPreview(nextPreview);
      setApplyResult(null);
      setApplyDiagnostics(null);
    } catch {
      setError("Network error while running photo classification preview");
    } finally {
      setLoading(false);
    }
  }, [surveyId]);

  const applyReviewed = useCallback(async () => {
    if (!preview) return;
    const items = preview.candidates
      .filter((candidate) => candidate.confidence === "high")
      .filter((candidate) => candidate.suggestedCategory !== "uncategorized")
      .filter(
        (candidate) => candidate.openSourceAnalysis?.qualityStatus === "good",
      )
      .filter(
        (candidate) =>
          candidate.openSourceAnalysis?.isDuplicateRepresentative !== false,
      )
      .map((candidate) => ({
        fileId: candidate.fileId,
        acceptedCategory: candidate.suggestedCategory,
      }));

    if (items.length === 0) {
      const message =
        "No high-confidence, non-duplicate, good-quality labels are ready to apply. Review/override support should handle the remaining photos.";
      setApplyResult(message);
      setApplyDiagnostics(
        buildApplyDiagnosticsState("error", message, {
          requestedCount: preview.candidates.length,
          acceptedCount: 0,
          updateCount: 0,
          updatedCount: 0,
        }),
      );
      return;
    }

    setApplyLoading(true);
    setError(null);
    setApplyResult(
      `Applying ${items.length} high-confidence reviewed label(s)...`,
    );
    setApplyDiagnostics(
      buildApplyDiagnosticsState(
        "success",
        "Apply request sent",
        {
          requestReceived: true,
          requestedCount: preview.candidates.length,
          acceptedCount: items.length,
          updateCount: items.length,
        },
        { applyRequestFired: true, httpStatus: null },
      ),
    );
    try {
      const res = await fetch(
        `/api/site-surveys/${surveyId}/photo-classification-preview/apply`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items }),
        },
      );
      const json = await res.json();
      if (!json.success) {
        const diagnostics = json.diagnostics as
          | Record<string, unknown>
          | null
          | undefined;
        const updateSummary = diagnostics
          ? ` Requested ${diagnostics.requestedCount ?? "n/a"}, accepted ${diagnostics.acceptedCount ?? "n/a"}, attempted ${diagnostics.updateCount ?? "n/a"}, updated ${diagnostics.updatedCount ?? "n/a"}.`
          : "";
        const message = `${json.error || "Failed to apply reviewed classifications"}${updateSummary}`;
        setError(message);
        setApplyResult(message);
        setApplyDiagnostics(
          buildApplyDiagnosticsState(
            res.status === 409 ? "conflict" : "error",
            message,
            diagnostics,
            { applyRequestFired: true, httpStatus: res.status },
          ),
        );
        return;
      }
      const refreshedDetail = json.data?.refreshedDetail as
        | Partial<SurveyDetailData>
        | undefined;
      if (refreshedDetail && onCanonicalDetailRefresh) {
        onCanonicalDetailRefresh(refreshedDetail);
      }
      const diagnostics = json.data?.diagnostics?.canonicalCounts;
      const allDiagnostics = json.data?.diagnostics as
        | Record<string, unknown>
        | null
        | undefined;
      const requiredMissing = Array.isArray(diagnostics?.requiredMissing)
        ? diagnostics.requiredMissing.length
        : null;
      const message = `Applied ${json.data?.appliedCount ?? items.length} reviewed label(s). Canonical manifest recomputed: ${diagnostics?.promotedAiReviewedCount ?? "n/a"} promoted, ${diagnostics?.suppressedDuplicateCount ?? 0} duplicate(s) suppressed${requiredMissing !== null ? `, ${requiredMissing} required categor${requiredMissing === 1 ? "y" : "ies"} still missing` : ""}.`;
      setApplyResult(message);
      setApplyDiagnostics(
        buildApplyDiagnosticsState("success", message, allDiagnostics, {
          applyRequestFired: true,
          httpStatus: res.status,
        }),
      );
    } catch {
      const message = "Network error while applying reviewed classifications";
      setError(message);
      setApplyResult(message);
      setApplyDiagnostics(
        buildApplyDiagnosticsState("error", message, null, {
          applyRequestFired: true,
          httpStatus: null,
        }),
      );
    } finally {
      setApplyLoading(false);
    }
  }, [onCanonicalDetailRefresh, preview, surveyId]);

  const visibleCandidates = safeArray(preview?.candidates).slice(0, 18);
  const nonEmptyCounts = Object.entries(preview?.categoryCounts ?? {})
    .filter(([, count]) => Number(count) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]));

  return (
    <SectionCard
      icon={<ImageIcon size={14} />}
      title="AI Photo Evidence Classification Preview"
      iconColor="text-fuchsia-400"
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/10 p-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-fuchsia-200">
                Operator-triggered vision pass
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                The survey has {totalItems} photo evidence item(s),{" "}
                {classifiedCount} classified, and {uncategorizedCount}{" "}
                uncategorized. This preview can ask the vision model to identify
                meter, MSP, roof overview, wall/equipment location,
                obstructions, and site overview candidates. It is read-only: no
                labels are written, no canonical evidence is mutated, and no
                CAD/permit workflow is triggered.
              </p>
            </div>
            <button
              onClick={runPreview}
              disabled={loading || uncategorizedCount === 0}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-fuchsia-400/30 bg-fuchsia-500/15 px-3 py-2 text-xs font-semibold text-fuchsia-100 transition hover:bg-fuchsia-500/25 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? (
                <div className="spinner w-3 h-3" />
              ) : (
                <RefreshCw size={12} />
              )}
              {loading
                ? "Classifying photos..."
                : "Run AI classification preview"}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <ReadinessPill tone="amber">Preview Only</ReadinessPill>
            <ReadinessPill tone="amber">No DB Writes</ReadinessPill>
            <ReadinessPill tone="slate">No CAD Mutation</ReadinessPill>
            <ReadinessPill tone="slate">No Permit Trigger</ReadinessPill>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-100">
            <div className="flex items-center gap-2 font-semibold">
              <AlertTriangle size={13} /> Classification preview unavailable
            </div>
            <p className="mt-1 text-[11px] text-red-100/80">{error}</p>
          </div>
        )}

        {preview && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
              <div className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-3">
                <p className="text-[10px] uppercase tracking-wider text-slate-500">
                  Processed
                </p>
                <p className="text-lg font-bold text-white">
                  {preview.processedPhotoCount}
                </p>
              </div>
              <div className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-3">
                <p className="text-[10px] uppercase tracking-wider text-slate-500">
                  Total Photos
                </p>
                <p className="text-lg font-bold text-white">
                  {preview.totalPhotoCount}
                </p>
              </div>
              <div className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-3">
                <p className="text-[10px] uppercase tracking-wider text-slate-500">
                  Skipped
                </p>
                <p className="text-lg font-bold text-white">
                  {preview.skippedPhotoCount}
                </p>
              </div>
              <div
                className={`rounded-xl border p-3 ${preview.visionExecuted ? "border-emerald-500/20 bg-emerald-500/10" : "border-amber-500/20 bg-amber-500/10"}`}
              >
                <p className="text-[10px] uppercase tracking-wider opacity-80">
                  Vision
                </p>
                <p className="text-lg font-bold text-white">
                  {preview.visionExecuted ? "ran" : "off"}
                </p>
              </div>
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3">
                <p className="text-[10px] uppercase tracking-wider text-amber-200/80">
                  Authority
                </p>
                <p className="text-lg font-bold text-amber-100">review</p>
              </div>
              <div className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-3">
                <p className="text-[10px] uppercase tracking-wider text-slate-500">
                  OS analyzed
                </p>
                <p className="text-lg font-bold text-white">
                  {preview.openSourceAnalysisSummary?.analyzedPhotoCount ?? 0}
                </p>
              </div>
              <div className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-3">
                <p className="text-[10px] uppercase tracking-wider text-slate-500">
                  Dupes
                </p>
                <p className="text-lg font-bold text-white">
                  {preview.openSourceAnalysisSummary?.duplicatePhotoCount ?? 0}
                </p>
              </div>
              <div className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-3">
                <p className="text-[10px] uppercase tracking-wider text-slate-500">
                  Quality review
                </p>
                <p className="text-lg font-bold text-white">
                  {preview.openSourceAnalysisSummary
                    ?.qualityReviewRequiredCount ?? 0}
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-3">
              <p className="text-[11px] text-slate-400">{preview.note}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  onClick={applyReviewed}
                  disabled={applyLoading || !preview.visionExecuted}
                  className="inline-flex items-center gap-2 rounded-lg border border-emerald-400/30 bg-emerald-500/15 px-3 py-2 text-[11px] font-semibold text-emerald-100 transition hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {applyLoading ? (
                    <div className="spinner w-3 h-3" />
                  ) : (
                    <CheckCircle size={12} />
                  )}
                  Apply high-confidence reviewed labels
                </button>
                <span className="text-[10px] text-slate-500">
                  Applies only high-confidence, good-quality, non-duplicate,
                  non-uncategorized suggestions to existing file labels.
                </span>
              </div>
              {applyResult && (
                <p className="mt-2 text-[11px] text-emerald-200">
                  {applyResult}
                </p>
              )}
              {applyDiagnostics && (
                <div
                  className={`mt-3 rounded-xl border p-3 ${
                    applyDiagnostics.status === "success"
                      ? "border-emerald-500/25 bg-emerald-500/10"
                      : applyDiagnostics.status === "conflict"
                        ? "border-amber-500/25 bg-amber-500/10"
                        : "border-red-500/25 bg-red-500/10"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {applyDiagnostics.status === "success" ? (
                      <CheckCircle size={13} className="text-emerald-300" />
                    ) : (
                      <AlertTriangle size={13} className="text-amber-300" />
                    )}
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-200">
                      Apply lifecycle diagnostics
                    </p>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-300">
                    {applyDiagnostics.message}
                  </p>
                  <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px]">
                    {[
                      [
                        "Request fired",
                        applyDiagnostics.applyRequestFired ? "yes" : "no",
                      ],
                      ["HTTP status", applyDiagnostics.httpStatus],
                      ["Requested", applyDiagnostics.requestedCount],
                      ["Accepted", applyDiagnostics.acceptedCount],
                      ["Attempted", applyDiagnostics.updateCount],
                      ["Updated", applyDiagnostics.updatedCount],
                      ["Persisted", applyDiagnostics.persistedCount],
                      ["Rejected", applyDiagnostics.rejectedCount],
                      ["Classified", applyDiagnostics.classifiedItems],
                      ["Promoted", applyDiagnostics.promotedAiReviewedCount],
                      [
                        "Dupes suppressed",
                        applyDiagnostics.suppressedDuplicateCount,
                      ],
                    ].map(([label, value]) => (
                      <span
                        key={String(label)}
                        className="rounded-lg border border-slate-700/60 bg-slate-950/40 px-2 py-1 text-slate-300"
                      >
                        {label}: <b>{value ?? "n/a"}</b>
                      </span>
                    ))}
                  </div>
                  {(applyDiagnostics.unmatchedFileIds.length > 0 ||
                    applyDiagnostics.failedFileIds.length > 0 ||
                    applyDiagnostics.rowMatchFailures.length > 0 ||
                    applyDiagnostics.requiredMissing.length > 0) && (
                    <div className="mt-3 space-y-1 text-[10px] text-slate-400">
                      {applyDiagnostics.unmatchedFileIds.length > 0 && (
                        <p>
                          Unmatched file IDs:{" "}
                          {applyDiagnostics.unmatchedFileIds.join(", ")}
                        </p>
                      )}
                      {applyDiagnostics.failedFileIds.length > 0 && (
                        <p>
                          Failed persistence IDs:{" "}
                          {applyDiagnostics.failedFileIds.join(", ")}
                        </p>
                      )}
                      {applyDiagnostics.rowMatchFailures.length > 0 && (
                        <p>
                          Row match failures:{" "}
                          {applyDiagnostics.rowMatchFailures.join("; ")}
                        </p>
                      )}
                      {applyDiagnostics.requiredMissing.length > 0 && (
                        <p>
                          Required categories still missing:{" "}
                          {applyDiagnostics.requiredMissing.join(", ")}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {nonEmptyCounts.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {nonEmptyCounts.map(([category, count]) => (
                  <span
                    key={category}
                    className="rounded-full border border-slate-600/50 bg-slate-900/70 px-2 py-1 text-[10px] font-semibold text-slate-300"
                  >
                    {evidenceCategoryLabel(category as SurveyEvidenceCategory)}:{" "}
                    {count}
                  </span>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              {visibleCandidates.map((candidate) => (
                <a
                  key={candidate.fileId}
                  href={candidate.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-xl border border-slate-700/60 bg-slate-900/40 p-3 hover:border-fuchsia-400/40 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-slate-100">
                        {candidate.suggestedLabel}
                      </p>
                      <p className="truncate text-[10px] text-slate-500">
                        {candidate.filename ?? candidate.fileId}
                      </p>
                    </div>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase ${candidate.confidence === "high" ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200" : candidate.confidence === "medium" ? "border-amber-500/25 bg-amber-500/10 text-amber-200" : "border-red-500/25 bg-red-500/10 text-red-200"}`}
                    >
                      {candidate.confidence}
                    </span>
                  </div>
                  <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
                    {candidate.rationale}
                  </p>
                  {(candidate.evidenceSignals ?? []).length > 0 && (
                    <p className="mt-2 text-[10px] text-slate-500">
                      Signals: {(candidate.evidenceSignals ?? []).join(" · ")}
                    </p>
                  )}
                  {candidate.openSourceAnalysis && (
                    <p className="mt-2 text-[10px] text-slate-500">
                      Quality: {candidate.openSourceAnalysis.qualityStatus} (
                      {candidate.openSourceAnalysis.qualityScore}/100) ·
                      Sharpness{" "}
                      {candidate.openSourceAnalysis.sharpnessScore ?? "n/a"} ·
                      Brightness{" "}
                      {candidate.openSourceAnalysis.brightnessScore ?? "n/a"} ·{" "}
                      {candidate.openSourceAnalysis.widthPx ?? "?"}×
                      {candidate.openSourceAnalysis.heightPx ?? "?"}
                      {candidate.openSourceAnalysis.duplicateGroupId
                        ? ` · Duplicate ${candidate.openSourceAnalysis.duplicateRank}/${candidate.openSourceAnalysis.duplicateGroupSize}`
                        : ""}
                      {(candidate.openSourceAnalysis.qualityFlags ?? [])
                        .length > 0
                        ? ` · ${(candidate.openSourceAnalysis.qualityFlags ?? []).join(", ")}`
                        : ""}
                    </p>
                  )}
                  <p className="mt-2 text-[10px] text-slate-600">
                    Current: {evidenceCategoryLabel(candidate.currentCategory)}{" "}
                    → Suggested: {candidate.suggestedLabel}
                    {candidate.reviewRequired ? " · review required" : ""}
                  </p>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}


function candidateCountFor(
  bundle: OpenSourcePhotoVisionBundle | null | undefined,
  fragments: string[],
): number {
  return safeArray(bundle?.candidates).filter((candidate) =>
    fragments.some((fragment) =>
      `${candidate.candidateType} ${candidate.candidateCategory}`
        .toLowerCase()
        .includes(fragment),
    ),
  ).length;
}

function OpenSourcePhotoVisionPassPanel({
  surveyId,
  bundle,
  onDetailRefresh,
}: {
  surveyId: string;
  bundle: OpenSourcePhotoVisionBundle | null | undefined;
  onDetailRefresh?: (detail: Partial<SurveyDetailData>) => void;
}) {
  const [result, setResult] = useState<OpenSourcePhotoVisionRunResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidateFilter, setCandidateFilter] = useState<"both" | "opencv" | "yolo">("both");
  const activeBundle = result?.stored ?? bundle ?? null;
  const allCandidates = safeArray(activeBundle?.candidates);
  const candidates = allCandidates.filter((candidate) => {
    const stage = String(candidate.payload?.stage ?? "");
    const source = String(candidate.payload?.source ?? "");
    const isYolo = candidate.candidateType === "object_detection" || stage.includes("yolo") || source.includes("yolo");
    if (candidateFilter === "yolo") return isYolo;
    if (candidateFilter === "opencv") return !isYolo;
    return true;
  });
  const candidateTypeCounts = candidates.reduce<Record<string, number>>(
    (acc, candidate) => {
      acc[candidate.candidateType] = (acc[candidate.candidateType] ?? 0) + 1;
      return acc;
    },
    {},
  );
  const edgeCount = candidateCountFor(activeBundle, ["edge", "line", "roof"]);
  const equipmentCount = candidateCountFor(activeBundle, ["equipment"]);
  const obstructionCount = candidateCountFor(activeBundle, ["obstruction"]);
  const ocrCount = candidateCountFor(activeBundle, ["ocr"]);
  const thumbnailCandidates = candidates
    .filter((candidate) => Boolean(candidate.thumbnailDataUrl))
    .slice(0, 6);
  const limitationPreview = Array.from(
    new Set([
      ...safeArray(activeBundle?.limitations),
      ...candidates.flatMap((candidate) => safeArray(candidate.limitations)),
    ]),
  ).slice(0, 6);

  const runPass = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/site-surveys/${surveyId}/open-source-photo-vision-pass`,
        { method: "POST", headers: { "Content-Type": "application/json" } },
      );
      const json = await res.json();
      if (!json.success) {
        setError(
          [json.error, json.detail].filter(Boolean).join(": ") ||
            "Open-source photo vision pass failed",
        );
        return;
      }
      const data = json.data as OpenSourcePhotoVisionRunResponse;
      setResult(data);
      onDetailRefresh?.({ openSourcePhotoVision: data.stored });
    } catch {
      setError("Network error while running open-source photo vision pass");
    } finally {
      setLoading(false);
    }
  }, [onDetailRefresh, surveyId]);

  return (
    <SectionCard
      icon={<Layers size={14} />}
      title="Run Open-Source Photo Vision Pass"
      iconColor="text-emerald-400"
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-200">
External OpenCV + YOLO/Supervision worker · actual image bytes · separate from OpenAI preview
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                Sends authorized survey photo URLs to the external Dockerized
                OpenCV + YOLO/Supervision worker, which fetches actual image
                bytes and returns review-only edges, lines, contours, rectangles,
                semantic object detections, thumbnails, confidence, model
                provenance, and availability diagnostics. OCR, Open3D, and
                FreeCAD remain future stages and are not marked complete.
              </p>
            </div>
            <button
              onClick={runPass}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-400/30 bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? <div className="spinner w-3 h-3" /> : <RefreshCw size={12} />}
              {loading ? "Processing photo bytes..." : "Run Open-Source Photo Vision Pass"}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <ReadinessPill tone="amber">Review Only</ReadinessPill>
            <ReadinessPill tone="slate">Non-Authoritative</ReadinessPill>
            <ReadinessPill tone="slate">No CAD Mutation</ReadinessPill>
            <ReadinessPill tone="slate">No Permit/BOM Trigger</ReadinessPill>
            <ReadinessPill tone="emerald">
              {activeBundle ? "Stored CV Candidates Available" : "Available On Demand"}
            </ReadinessPill>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-100">
            <div className="flex items-center gap-2 font-semibold">
              <AlertTriangle size={13} /> Open-source photo vision unavailable
            </div>
            <p className="mt-1 text-[11px] text-red-100/80">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
          {[
            ["Processed", result?.summary.processedFileCount ?? "—"],
            ["Failed", result?.summary.failedFileCount ?? "—"],
            ["Candidates", candidates.length],
            ["Edges/lines", edgeCount],
            ["Equipment", equipmentCount],
            ["Obstructions", obstructionCount],
            ["OCR notes", ocrCount],
            ["Run hash", activeBundle?.latestRunHash ? activeBundle.latestRunHash.slice(0, 8) : "—"],
          ].map(([label, value]) => (
            <div
              key={String(label)}
              className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-3"
            >
              <p className="text-[10px] uppercase tracking-wider text-slate-500">
                {label}
              </p>
              <p className="text-lg font-bold text-white">{value}</p>
            </div>
          ))}
        </div>

        {allCandidates.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-700/60 bg-slate-950/40 p-3">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Overlay filter</span>
            {(["both", "opencv", "yolo"] as const).map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setCandidateFilter(filter)}
                className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-wider transition ${
                  candidateFilter === filter
                    ? "border-emerald-400/50 bg-emerald-500/20 text-emerald-100"
                    : "border-slate-700 bg-slate-900/60 text-slate-400 hover:text-slate-200"
                }`}
              >
                {filter === "both" ? "OpenCV + YOLO" : filter === "opencv" ? "OpenCV candidates" : "YOLO detections"}
              </button>
            ))}
            <span className="text-[10px] text-slate-500">Showing {candidates.length} of {allCandidates.length} persisted review-only candidates.</span>
          </div>
        )}

        {result?.summary.unavailableDiagnostics?.length ? (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-200">
              Unavailable native worker diagnostics
            </p>
            <ul className="mt-2 space-y-1 text-[11px] text-amber-100/85">
              {result.summary.unavailableDiagnostics.slice(0, 5).map((item) => (
                <li key={item}>• {item}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {candidates.length > 0 && (
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-300">
                Candidate categories
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {Object.entries(candidateTypeCounts).map(([type, count]) => (
                  <span
                    key={type}
                    className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-100"
                  >
                    {type}: {count}
                  </span>
                ))}
              </div>
              <div className="mt-3 space-y-2">
                {candidates.slice(0, 6).map((candidate) => (
                  <div
                    key={candidate.id}
                    className="rounded-lg border border-slate-800 bg-slate-900/70 p-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] font-semibold text-slate-200">
                        {candidate.candidateType}
                      </p>
                      <span className="text-[10px] text-emerald-200">
                        {Math.round(candidate.confidence)}%
                      </span>
                    </div>
                    <p className="mt-1 text-[10px] text-slate-500">
                      {candidate.toolName} v{candidate.toolVersion} · {String(candidate.payload?.sourceModel ?? candidate.payload?.source ?? "cv-worker")} · run {candidate.runHash.slice(0, 10)} · REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-300">
                Source thumbnails / overlay-ready candidates
              </p>
              {thumbnailCandidates.length > 0 ? (
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {thumbnailCandidates.map((candidate) => (
                    <div key={candidate.id} className="space-y-1">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={candidate.thumbnailDataUrl ?? ""}
                        alt={`${candidate.candidateType} thumbnail`}
                        className="h-16 w-full rounded-lg border border-slate-700 object-cover"
                      />
                      <p className="truncate text-[9px] text-slate-500">
                        {candidate.fileId.slice(0, 8)} · {candidate.candidateType}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-[11px] text-slate-500">
                  No stored thumbnails yet. Run the pass to generate safe
                  data-URL thumbnails for A-201 and review overlays for A-101.
                </p>
              )}
              {limitationPreview.length > 0 && (
                <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/10 p-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-200">
                    Limitations
                  </p>
                  <ul className="mt-1 space-y-1 text-[10px] text-amber-100/80">
                    {limitationPreview.map((item) => (
                      <li key={item}>• {item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

function SurveyEvidenceViewer({
  manifest,
  bridge,
}: {
  manifest: SurveyEvidenceManifest | null | undefined;
  bridge: SurveyEvidenceEngineeringBridge | null | undefined;
}) {
  if (!manifest) {
    return (
      <SectionCard
        icon={<Shield size={14} />}
        title="Survey Evidence Manifest"
        iconColor="text-cyan-400"
      >
        <p className="text-xs text-slate-500">
          No evidence manifest is available for this survey.
        </p>
      </SectionCard>
    );
  }

  const grouped = manifest.items.reduce<
    Record<SurveyEvidenceDomain, typeof manifest.items>
  >(
    (acc, item) => {
      if (!acc[item.domain]) acc[item.domain] = [];
      acc[item.domain].push(item);
      return acc;
    },
    { electrical: [], roof: [], site: [], general: [] },
  );

  const requiredCoverage = manifest.coverage.filter((group) => group.required);
  const requirementEvaluation = bridge?.requirementEvaluation ?? null;
  const activeRequirements =
    requirementEvaluation?.allRequirements.filter(
      (requirement) => requirement.active,
    ) ?? [];
  const bridgeCounts = {
    electrical: bridge?.electricalEvidence.length ?? 0,
    structural: bridge?.structuralEvidence.length ?? 0,
    roofLayout: bridge?.roofLayoutEvidence.length ?? 0,
    sitePlan: bridge?.sitePlanEvidence.length ?? 0,
  };
  const statusColor =
    manifest.summary.completeness === "sufficient"
      ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/20"
      : manifest.summary.completeness === "partial"
        ? "text-amber-300 bg-amber-500/10 border-amber-500/20"
        : "text-red-300 bg-red-500/10 border-red-500/20";

  return (
    <SectionCard
      icon={<Shield size={14} />}
      title="Survey Evidence Manifest v1"
      iconColor="text-cyan-400"
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-3">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">
              Evidence Items
            </p>
            <p className="text-lg font-bold text-white">
              {manifest.summary.totalItems}
            </p>
          </div>
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-3">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">
              Classified
            </p>
            <p className="text-lg font-bold text-white">
              {manifest.summary.classifiedItems}
            </p>
          </div>
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-3">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">
              Quality Checked
            </p>
            <p className="text-lg font-bold text-white">
              {manifest.summary.qualityCheckedItems}
            </p>
          </div>
          <div className={`rounded-xl border p-3 ${statusColor}`}>
            <p className="text-[10px] uppercase tracking-wider opacity-80">
              Completeness
            </p>
            <p className="text-lg font-bold capitalize">
              {manifest.summary.completeness}
            </p>
          </div>
        </div>

        {manifest.diagnostics && (
          <div className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Canonical promotion diagnostics
            </p>
            <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px]">
              <span className="rounded-lg border border-slate-700/60 bg-slate-900/50 px-2 py-1 text-slate-300">
                Raw photos: <b>{manifest.diagnostics.rawPhotoItemCount}</b>
              </span>
              <span className="rounded-lg border border-slate-700/60 bg-slate-900/50 px-2 py-1 text-slate-300">
                Canonical reps: <b>{manifest.diagnostics.canonicalItemCount}</b>
              </span>
              <span className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-emerald-200">
                Promoted labels:{" "}
                <b>{manifest.diagnostics.promotedAiReviewedCount}</b>
              </span>
              <span className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-amber-200">
                Duplicates suppressed:{" "}
                <b>{manifest.diagnostics.suppressedDuplicateCount}</b>
              </span>
            </div>
            {manifest.diagnostics.requirementReasoning.length > 0 && (
              <div className="mt-2 space-y-1">
                {manifest.diagnostics.requirementReasoning.map((reason) => (
                  <p
                    key={reason.category}
                    className="text-[10px] text-slate-500"
                  >
                    <b
                      className={
                        reason.status === "present"
                          ? "text-emerald-300"
                          : "text-red-300"
                      }
                    >
                      {evidenceCategoryLabel(reason.category)}:
                    </b>{" "}
                    {reason.reason}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        <div>
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
            Required evidence coverage
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {requiredCoverage.map((group) => (
              <div
                key={group.category}
                className={`flex items-center justify-between rounded-lg border px-3 py-2 ${
                  group.status === "present"
                    ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                    : "border-red-500/20 bg-red-500/10 text-red-300"
                }`}
              >
                <span className="text-xs font-medium">
                  {evidenceCategoryLabel(group.category)}
                </span>
                <span className="text-[10px] font-semibold uppercase">
                  {group.status} ({group.count})
                </span>
              </div>
            ))}
          </div>
        </div>

        {bridge && (
          <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-3">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <p className="text-[10px] font-semibold text-cyan-300 uppercase tracking-wider">
                  Engineering bridge
                </p>
                <p className="text-[11px] text-slate-400">
                  Advisory evidence-to-engineering traceability only; CAD
                  automation is not started.
                </p>
              </div>
              <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2 py-1 text-[10px] font-semibold uppercase text-cyan-200">
                {bridge.readiness}
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px]">
              <span className="rounded-lg border border-slate-700/60 bg-slate-950/30 px-2 py-1 text-slate-300">
                Electrical: <b>{bridgeCounts.electrical}</b>
              </span>
              <span className="rounded-lg border border-slate-700/60 bg-slate-950/30 px-2 py-1 text-slate-300">
                Structural: <b>{bridgeCounts.structural}</b>
              </span>
              <span className="rounded-lg border border-slate-700/60 bg-slate-950/30 px-2 py-1 text-slate-300">
                Roof/Layout: <b>{bridgeCounts.roofLayout}</b>
              </span>
              <span className="rounded-lg border border-slate-700/60 bg-slate-950/30 px-2 py-1 text-slate-300">
                Site Plan: <b>{bridgeCounts.sitePlan}</b>
              </span>
            </div>
            <p className="mt-2 text-[10px] text-slate-500">
              CAD automation:{" "}
              <b className="text-slate-300">{bridge.cadAutomationStatus}</b>
            </p>
          </div>
        )}

        {requirementEvaluation && (
          <div className="rounded-xl border border-violet-500/20 bg-violet-500/10 p-3">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <p className="text-[10px] font-semibold text-violet-300 uppercase tracking-wider">
                  Engineering Requirement Registry
                </p>
                <p className="text-[11px] text-slate-400">
                  Central deterministic requirement source of truth; evaluated
                  from canonical evidence and provenance only.
                </p>
              </div>
              <span className="rounded-full border border-violet-400/30 bg-violet-400/10 px-2 py-1 text-[10px] font-semibold uppercase text-violet-200">
                {requirementEvaluation.confidenceSource}
              </span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-[10px]">
              <span className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-emerald-200">
                Satisfied:{" "}
                <b>{requirementEvaluation.satisfiedRequirements.length}</b>
              </span>
              <span className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-amber-200">
                Partial:{" "}
                <b>
                  {requirementEvaluation.partiallySatisfiedRequirements.length}
                </b>
              </span>
              <span className="rounded-lg border border-red-500/20 bg-red-500/10 px-2 py-1 text-red-200">
                Missing:{" "}
                <b>{requirementEvaluation.missingRequirements.length}</b>
              </span>
              <span className="rounded-lg border border-red-500/20 bg-red-500/10 px-2 py-1 text-red-200">
                Blocked:{" "}
                <b>{requirementEvaluation.blockedRequirements.length}</b>
              </span>
              <span className="rounded-lg border border-slate-500/20 bg-slate-500/10 px-2 py-1 text-slate-200">
                Inactive:{" "}
                <b>{requirementEvaluation.inactiveRequirements.length}</b>
              </span>
            </div>

            <div className="mt-3 space-y-2">
              <details
                className="rounded-xl border border-slate-700/60 bg-slate-950/30 p-3"
                open
              >
                <summary className="cursor-pointer text-xs font-semibold text-violet-200">
                  Requirement Satisfaction Summary
                </summary>
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                  {activeRequirements.map((requirement) => (
                    <div
                      key={requirement.requirementId}
                      className="rounded-lg border border-slate-700/50 bg-slate-950/40 p-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] font-semibold text-slate-200">
                          {requirement.humanLabel}
                        </p>
                        <span
                          className={`text-[9px] uppercase rounded-full border px-2 py-0.5 ${
                            requirement.requirementSatisfied
                              ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                              : requirement.missingSeverity === "blocker"
                                ? "border-red-500/20 bg-red-500/10 text-red-300"
                                : "border-amber-500/20 bg-amber-500/10 text-amber-300"
                          }`}
                        >
                          {requirement.status}
                        </span>
                      </div>
                      <p className="mt-1 text-[10px] text-slate-500">
                        Impact: {requirement.readinessImpact} | Severity:{" "}
                        {requirement.missingSeverity} | Canonical count:{" "}
                        {requirement.observedCanonicalEvidenceCount}/
                        {requirement.minimumCanonicalEvidenceCount}
                      </p>
                      <p className="text-[10px] text-slate-600">
                        Required:{" "}
                        {requirement.requiredEvidenceCategories
                          .map(evidenceCategoryLabel)
                          .join(", ") || "none"}{" "}
                        | Optional:{" "}
                        {requirement.optionalEvidenceCategories
                          .map(evidenceCategoryLabel)
                          .join(", ") || "none"}
                      </p>
                    </div>
                  ))}
                </div>
              </details>

              <details className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3">
                <summary className="cursor-pointer text-xs font-semibold text-amber-200">
                  Missing Requirement Analysis
                </summary>
                <div className="mt-3 space-y-2">
                  {requirementEvaluation.missingRequirements.length === 0 &&
                  requirementEvaluation.partiallySatisfiedRequirements
                    .length === 0 ? (
                    <p className="text-[11px] text-amber-100/80">
                      No missing or partially satisfied active registry
                      requirements.
                    </p>
                  ) : (
                    [
                      ...requirementEvaluation.blockedRequirements,
                      ...requirementEvaluation.partiallySatisfiedRequirements,
                      ...requirementEvaluation.missingRequirements.filter(
                        (requirement) =>
                          requirement.readinessImpact !== "blocking",
                      ),
                    ].map((requirement) => (
                      <div
                        key={`${requirement.requirementId}-${requirement.status}`}
                        className="rounded-lg border border-slate-700/50 bg-slate-950/30 p-2"
                      >
                        <p className="text-[11px] font-semibold text-slate-200">
                          {requirement.humanLabel}
                        </p>
                        <p className="text-[10px] text-slate-500">
                          Status: {requirement.status} | Severity:{" "}
                          {requirement.missingSeverity} | Duplicate collapsed:{" "}
                          {requirement.duplicateCollapsed ? "yes" : "no"}
                        </p>
                        <p className="text-[10px] text-slate-600">
                          {requirement.reasoningPath.join(" -> ")}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </details>

              <details className="rounded-xl border border-teal-500/20 bg-teal-500/10 p-3">
                <summary className="cursor-pointer text-xs font-semibold text-teal-200">
                  Requirement Provenance
                </summary>
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                  {activeRequirements.map((requirement) => (
                    <div
                      key={`provenance-${requirement.requirementId}`}
                      className="rounded-lg border border-slate-700/50 bg-slate-950/30 p-2"
                    >
                      <p className="text-[11px] font-semibold text-slate-200">
                        {requirement.humanLabel}
                      </p>
                      <p className="text-[10px] text-slate-500 break-all">
                        Evidence:{" "}
                        {requirement.canonicalEvidenceIds.join(", ") || "none"}
                      </p>
                      <p className="text-[10px] text-slate-500 break-all">
                        Surveys:{" "}
                        {requirement.originatingSurveyIds.join(", ") || "none"}
                      </p>
                      <p className="text-[10px] text-slate-600">
                        Confidence: {requirement.confidenceSource} |
                        Duplicate-collapsed:{" "}
                        {requirement.duplicateCollapsed ? "yes" : "no"}
                      </p>
                    </div>
                  ))}
                </div>
              </details>

              <details className="rounded-xl border border-slate-700/60 bg-slate-950/30 p-3">
                <summary className="cursor-pointer text-xs font-semibold text-slate-300">
                  Inactive Future Capability Flags
                </summary>
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                  {requirementEvaluation.inactiveRequirements.map(
                    (requirement) => (
                      <div
                        key={`inactive-${requirement.requirementId}`}
                        className="rounded-lg border border-slate-700/50 bg-slate-950/30 p-2"
                      >
                        <p className="text-[11px] font-semibold text-slate-200">
                          {requirement.humanLabel}
                        </p>
                        <p className="text-[10px] text-slate-500">
                          Status: {requirement.status}; future flags are
                          informational only.
                        </p>
                        <p className="text-[10px] text-slate-600">
                          OCR:{" "}
                          {requirement.futureCapabilities.supportsOCR
                            ? "documented"
                            : "off"}{" "}
                          | CV:{" "}
                          {requirement.futureCapabilities
                            .supportsCVClassification
                            ? "documented"
                            : "off"}{" "}
                          | CAD:{" "}
                          {requirement.futureCapabilities.supportsCADInference
                            ? "documented"
                            : "off"}{" "}
                          | Semantic:{" "}
                          {requirement.futureCapabilities
                            .supportsSemanticExtraction
                            ? "documented"
                            : "off"}
                        </p>
                      </div>
                    ),
                  )}
                </div>
              </details>
            </div>
          </div>
        )}

        {manifest.warnings.length > 0 && (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3">
            <div className="flex items-center gap-2 mb-2 text-amber-300">
              <AlertTriangle size={13} />
              <p className="text-xs font-semibold">Evidence warnings</p>
            </div>
            <ul className="space-y-1">
              {manifest.warnings.map((warning, i) => (
                <li
                  key={`${warning}-${i}`}
                  className="text-[11px] text-amber-100/80"
                >
                  - {warning}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-4">
          {(Object.keys(grouped) as SurveyEvidenceDomain[]).map((domain) => {
            const items = grouped[domain];
            if (items.length === 0) return null;
            return (
              <div key={domain}>
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider rounded-full border px-2 py-1 ${DOMAIN_COLORS[domain]}`}
                  >
                    {DOMAIN_LABELS[domain]}
                  </span>
                  <span className="text-xs text-slate-600">
                    {items.length} item(s)
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {items.map((item) => (
                    <a
                      key={item.evidenceId}
                      href={item.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-xl border border-slate-700/60 bg-slate-900/40 p-3 hover:border-cyan-500/40 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-200 truncate">
                            {evidenceCategoryLabel(item.category)}
                          </p>
                          <p className="text-[10px] text-slate-500 truncate">
                            {item.submittedCategory ?? "uncategorized"} |{" "}
                            {item.filename ?? item.evidenceId}
                          </p>
                        </div>
                        <span className="text-[9px] uppercase rounded-full border border-cyan-500/20 bg-cyan-500/10 text-cyan-300 px-2 py-0.5">
                          {item.processingStatus}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 mt-3 text-[10px] text-slate-500">
                        <span>
                          AI vision:{" "}
                          <b className="text-slate-300">
                            {item.aiExtractionStatus}
                          </b>
                        </span>
                        <span>
                          Confidence:{" "}
                          <b className="text-slate-300">
                            {item.evidenceConfidence}
                          </b>
                        </span>
                        <span>
                          Blur risk:{" "}
                          <b className="text-slate-300">
                            {item.quality.blurScore ?? "not checked"}
                          </b>
                        </span>
                        <span>
                          Duplicate risk:{" "}
                          <b className="text-slate-300">
                            {item.quality.duplicateScore ?? "not checked"}
                          </b>
                        </span>
                        {item.image.widthPx && item.image.heightPx && (
                          <span className="col-span-2">
                            Image scan:{" "}
                            <b className="text-slate-300">
                              {item.image.widthPx}×{item.image.heightPx}
                            </b>
                            {item.quality.warnings.length > 0
                              ? ` · ${item.quality.warnings.slice(0, 2).join(" · ")}`
                              : ""}
                          </span>
                        )}
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="rounded-xl border border-slate-700/50 bg-slate-950/40 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
            Runtime boundary
          </p>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            v1 now performs Node/sharp open-source photo quality checks and
            duplicate detection on authorized survey photos. AI vision
            classification, YOLO/Supervision object detection, OCR, Claude
            reasoning, Open3D geometry reconstruction, and FreeCAD automation
            remain review-gated worker or future-only stages.
          </p>
        </div>
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// 2. ELECTRICAL section
// ---------------------------------------------------------------------------
function ElectricalSection({ elec }: { elec: SurveyElectricalService }) {
  return (
    <SectionCard
      icon={<Zap size={14} />}
      title="Electrical Service"
      iconColor="text-yellow-400"
    >
      <div className="grid grid-cols-1 md:grid-cols-2">
        <FieldRow
          label="Panel Brand"
          value={fmtVal(elec.panelBrand, PANEL_BRAND_LABELS)}
        />
        <FieldRow
          label="Panel Rating"
          value={elec.panelRating ? `${elec.panelRating}A` : null}
        />
        <FieldRow
          label="Available Slots"
          value={fmtVal(elec.availableBreakerSlots)}
        />
        <FieldRow
          label="Meter Socket Type"
          value={fmtVal(elec.meterSocketType, METER_SOCKET_LABELS)}
        />
        <FieldRow
          label="Interconnection Point"
          value={fmtVal(elec.interconnectionPoint, INTERCONNECTION_LABELS)}
        />
        <FieldRow
          label="Service Entrance"
          value={fmtVal(elec.serviceEntrance, SERVICE_ENTRANCE_LABELS)}
        />
        <FieldRow label="Has Sub-Panel" value={fmtBool(elec.hasSubPanel)} />
        {elec.hasSubPanel && (
          <FieldRow
            label="Sub-Panel Rating"
            value={elec.subPanelRating ? `${elec.subPanelRating}A` : null}
          />
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
    <SectionCard
      icon={<Home size={14} />}
      title="Roof & Mounting"
      iconColor="text-amber-400"
    >
      <div className="grid grid-cols-1 md:grid-cols-2">
        <FieldRow
          label="Roof Material"
          value={fmtVal(roof.roofMaterial, ROOF_MATERIAL_LABELS)}
        />
        <FieldRow
          label="Roof Pitch"
          value={fmtVal(roof.roofPitch, ROOF_PITCH_LABELS)}
        />
        <FieldRow label="Roof Condition" value={fmtVal(roof.roofCondition)} />
        <FieldRow
          label="Rafter Spacing"
          value={roof.rafterSpacing ? `${roof.rafterSpacing}"` : null}
        />
        <FieldRow
          label="Roof Age"
          value={
            roof.roofAgeYears != null ? `${roof.roofAgeYears} years` : null
          }
        />
        <FieldRow label="Attic Access" value={fmtBool(roof.atticAccess)} />
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
    <SectionCard
      icon={<Shield size={14} />}
      title="Obstructions & Layout"
      iconColor="text-red-400"
    >
      <div className="space-y-3">
        {/* Summary row */}
        <div className="grid grid-cols-1 md:grid-cols-2">
          <FieldRow
            label="Estimated Usable Roof"
            value={
              obs.estimatedUsableRoofPct != null
                ? `${obs.estimatedUsableRoofPct}%`
                : null
            }
          />
          <FieldRow
            label="Obstructions Logged"
            value={hasObstructions ? String(obs.obstructions.length) : "None"}
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
                <AlertTriangle
                  size={11}
                  className="text-red-400 mt-0.5 flex-shrink-0"
                />
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
                    <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                      {o.notes}
                    </p>
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
    residential: "Residential",
    commercial: "Commercial",
    industrial: "Industrial",
  };

  return (
    <SectionCard
      icon={<Sun size={14} />}
      title="Site Overview"
      iconColor="text-cyan-400"
    >
      <div className="grid grid-cols-1 md:grid-cols-2">
        <FieldRow label="Site Address" value={fmtVal(site.siteAddress)} />
        <FieldRow label="Project Name" value={fmtVal(site.projectName)} />
        <FieldRow label="Inspector" value={fmtVal(site.inspectorName)} />
        <FieldRow
          label="Structure Type"
          value={fmtVal(site.structureType, STRUCTURE_LABELS)}
        />
        <FieldRow label="Stories" value={fmtVal(site.stories)} />
        {site.latitude != null && site.longitude != null && (
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
    { label: "Access Notes", value: payload.siteOverview?.accessNotes },
    { label: "Mounting Notes", value: payload.roofConditions?.mountingNotes },
    {
      label: "Electrical Notes",
      value: payload.electricalService?.electricalNotes,
    },
    { label: "Setback Notes", value: payload.obstructions?.setbackNotes },
  ].filter((n) => n.value && n.value.trim());

  if (notes.length === 0) return null;

  return (
    <SectionCard
      icon={<FileText size={14} />}
      title="Field Notes"
      iconColor="text-slate-400"
    >
      <div className="space-y-3">
        {notes.map((n) => (
          <div key={n.label}>
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
              {n.label}
            </p>
            <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">
              {n.value}
            </p>
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
        onClick={() => setOpen((o) => !o)}
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
            {data ? JSON.stringify(data, null, 2) : "No data"}
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
    <SectionCard
      icon={<Sun size={14} />}
      title="Site Overview"
      iconColor="text-cyan-400"
    >
      <div className="grid grid-cols-1 md:grid-cols-2">
        <FieldRow label="Site Name" value={d.siteName} />
        <FieldRow label="Site Address" value={d.siteAddress} />
        <FieldRow label="Inspector" value={d.inspectorName} />
        <FieldRow label="Survey Date" value={d.surveyDate} />
        <FieldRow label="Survey Type" value={d.surveyType} />
        <FieldRow label="Category" value={d.categoryName} />
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
  const hasData =
    d.roofMaterial ||
    d.roofAgeYears != null ||
    d.rafterSpacing ||
    d.rafterSize ||
    d.azimuth != null;
  if (!hasData) return null;

  return (
    <SectionCard
      icon={<Home size={14} />}
      title="Roof & Mounting"
      iconColor="text-amber-400"
    >
      <div className="grid grid-cols-1 md:grid-cols-2">
        <FieldRow
          label="Roof Material"
          value={
            d.roofMaterial
              ? (ROOF_MATERIAL_LABELS[d.roofMaterial] ?? d.roofMaterial)
              : null
          }
        />
        <FieldRow
          label="Roof Age"
          value={d.roofAgeYears != null ? `${d.roofAgeYears} years` : null}
        />
        <FieldRow label="Rafter Spacing" value={d.rafterSpacing} />
        <FieldRow label="Rafter Size" value={d.rafterSize} />
        <FieldRow
          label="Azimuth"
          value={d.azimuth != null ? `${d.azimuth}°` : null}
        />
      </div>
    </SectionCard>
  );
}

/** V1 Checklist section — rendered if partner sent checklist items */
function V1ChecklistSection({ items }: { items: V1DisplayData["checklist"] }) {
  if (items.length === 0) return null;

  const STATUS_COLORS: Record<string, string> = {
    pass: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    fail: "text-red-400 bg-red-500/10 border-red-500/20",
    n_a: "text-slate-500 bg-slate-700/30 border-slate-600/20",
    na: "text-slate-500 bg-slate-700/30 border-slate-600/20",
    pending: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  };

  return (
    <SectionCard
      icon={<Wrench size={14} />}
      title="Field Checklist"
      iconColor="text-teal-400"
    >
      <div className="space-y-2">
        {items.map((item, i) => {
          const statusKey = item.status.toLowerCase().replace(/[^a-z]/g, "_");
          const statusCls =
            STATUS_COLORS[statusKey] ?? STATUS_COLORS["pending"];
          return (
            <div
              key={i}
              className="flex items-start gap-3 p-2.5 rounded-lg bg-slate-800/40 border border-slate-700/30"
            >
              <span
                className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border flex-shrink-0 mt-0.5 capitalize ${statusCls}`}
              >
                {item.status}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-200 font-medium">
                  {item.label}
                </p>
                {item.notes && (
                  <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                    {item.notes}
                  </p>
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
// Professional Survey Parser Readiness Panel -- read-only preview/reporting
// ---------------------------------------------------------------------------
type ProfessionalOperatorReadinessState =
  | "blocked"
  | "review_required"
  | "geometry_ready"
  | "cad_preview_ready";

interface ProfessionalReadinessReportPreview {
  schemaVersion: "professional_survey_readiness_report_v1";
  persistenceMode: "read_only_review_report_v1";
  readinessState: ProfessionalOperatorReadinessState;
  labels: {
    surveyDerived: boolean;
    parserDerived: boolean;
    canonicalized: boolean;
    previewOnly: boolean;
    reviewRequired: boolean;
    nonAuthoritative: boolean;
  };
  source: {
    fileCount: number;
    photoCount: number;
    hasSurveyData: boolean;
  };
  evidence: {
    sourceHash: string;
    bundleHash: string;
    systemType: string;
    evidenceItems: unknown[];
    missingRequiredFields: string[];
    warnings: string[];
  };
  canonicalGeometry: {
    geometryHash: string;
    readyForCADInput: boolean;
    roofPlanes: Array<{
      id: string;
      sourceType: string;
      areaM2: number | null;
      isValid: boolean;
      warnings: string[];
    }>;
    groundArrays: unknown[];
    fenceRuns: unknown[];
    obstructions: unknown[];
    setbacks: unknown[];
    blockingIssues: string[];
    warnings: string[];
  };
  cadReadiness: {
    readinessHash: string;
    readinessStatus: string;
    canBuildCADInput: boolean;
    cadInputPreview: unknown | null;
    blockingIssues: string[];
    reviewRequired: string[];
    warnings: string[];
  };
  summaries: {
    systemType: string;
    roofPlaneCount: number;
    obstructionCount: number;
    setbackCount: number;
    canonicalRoofPlaneCount: number;
    invalidCanonicalRoofPlaneCount: number;
    cadPreviewEligible: boolean;
    cadPreviewBuilt: boolean;
    confidenceGaps: string[];
    missingRequiredFields: string[];
    blockingIssues: string[];
    warnings: string[];
  };
  noAuthorityEnforcement: {
    dbWritesAllowed: false;
    cadSolverExecutionAllowed: false;
    productionCADMutationAllowed: false;
    downstreamEngineeringAllowed: false;
    downstreamPermitAllowed: false;
    downstreamBOMAllowed: false;
  };
  deterministicNotes: string[];
}

const PROFESSIONAL_READINESS_META: Record<
  ProfessionalOperatorReadinessState,
  { label: string; cls: string; icon: React.ReactNode; description: string }
> = {
  blocked: {
    label: "Blocked",
    cls: "border-red-500/25 bg-red-500/10 text-red-200",
    icon: <AlertTriangle size={13} />,
    description:
      "Blocking geometry or evidence issues must be resolved before preview use.",
  },
  review_required: {
    label: "Review Required",
    cls: "border-amber-500/25 bg-amber-500/10 text-amber-200",
    icon: <AlertTriangle size={13} />,
    description:
      "Parser output exists, but operator review is required before relying on preview data.",
  },
  geometry_ready: {
    label: "Geometry Ready",
    cls: "border-cyan-500/25 bg-cyan-500/10 text-cyan-200",
    icon: <Layers size={13} />,
    description:
      "Canonicalized geometry is structurally usable for review, without production CAD authority.",
  },
  cad_preview_ready: {
    label: "CAD Preview Ready",
    cls: "border-emerald-500/25 bg-emerald-500/10 text-emerald-200",
    icon: <CheckCircle size={13} />,
    description:
      "A deterministic CAD input preview can be built, but no solver or downstream flow is triggered.",
  },
};

function ReadinessPill({
  children,
  tone = "slate",
}: {
  children: React.ReactNode;
  tone?: "slate" | "cyan" | "amber" | "emerald" | "violet";
}) {
  const cls = {
    slate: "border-slate-600/40 bg-slate-800/50 text-slate-300",
    cyan: "border-cyan-500/25 bg-cyan-500/10 text-cyan-200",
    amber: "border-amber-500/25 bg-amber-500/10 text-amber-200",
    emerald: "border-emerald-500/25 bg-emerald-500/10 text-emerald-200",
    violet: "border-violet-500/25 bg-violet-500/10 text-violet-200",
  }[tone];
  return (
    <span
      className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-wider ${cls}`}
    >
      {children}
    </span>
  );
}

function IssueList({
  title,
  items,
  tone = "amber",
}: {
  title: string;
  items: string[];
  tone?: "amber" | "red" | "slate";
}) {
  if (items.length === 0) return null;
  const cls =
    tone === "red"
      ? "border-red-500/20 bg-red-500/10 text-red-100"
      : tone === "slate"
        ? "border-slate-700/60 bg-slate-950/30 text-slate-300"
        : "border-amber-500/20 bg-amber-500/10 text-amber-100";
  return (
    <div className={`rounded-xl border p-3 ${cls}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wider mb-2">
        {title}
      </p>
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li
            key={`${title}-${item}-${i}`}
            className="text-[11px] leading-relaxed"
          >
            - {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface SurveyCadPreviewSheet {
  sheetId: string;
  sheetNumber: string;
  sheetType: string;
  title: string;
  width: number;
  height: number;
  svg: string;
  layerOrder: string[];
  annotations: string[];
  renderHash: string;
}

interface SurveyCadWorkbenchPreview {
  readiness: {
    readinessState: ProfessionalOperatorReadinessState;
    source: {
      surveyId: string;
      projectId: string | null;
      fileCount: number;
      photoCount: number;
      hasSurveyData: boolean;
    };
    summaries: {
      systemType: string;
      roofPlaneCount: number;
      obstructionCount: number;
      setbackCount: number;
      canonicalRoofPlaneCount: number;
      cadPreviewEligible: boolean;
      cadPreviewBuilt: boolean;
      blockingIssues: string[];
      warnings: string[];
    };
    renderReadiness: {
      state: string;
      renderConfidenceScore: number;
      enabledLayerCount: number;
      blockers: string[];
      reviewItems: string[];
    };
  };
  renderPackage: {
    mode: string;
    sourceSurveyId: string;
    sourceRenderReadinessHash: string;
    packageHash: string;
    summary: {
      sheetCount: number;
      renderReadinessState: string;
      renderConfidenceScore: number;
      enabledRenderLayerCount: number;
      reviewCalloutCount: number;
      renderQualityScore: number;
      renderQualityGrade: string;
      visibleQualityImprovements: string[];
      contractorUsabilityImprovements: string[];
    };
    deterministicNotes: string[];
  };
  sheets: SurveyCadPreviewSheet[];
  defaultSheetNumber: string | null;
}

function SurveyCadWorkbenchPanel({ surveyId }: { surveyId: string }) {
  const [preview, setPreview] = useState<SurveyCadWorkbenchPreview | null>(
    null,
  );
  const [selectedSheetNumber, setSelectedSheetNumber] = useState<string | null>(
    null,
  );
  const [viewerMode, setViewerMode] = useState<"fit" | "wide" | "native">(
    "fit",
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/site-surveys/${surveyId}/cad-render-preview`,
      );
      const json = await res.json();
      if (!json.success) {
        setError(json.error || "Failed to load CAD render preview");
        return;
      }
      const nextPreview = json.data as SurveyCadWorkbenchPreview | null;
      if (
        !nextPreview ||
        !Array.isArray(nextPreview.sheets) ||
        !nextPreview.renderPackage?.summary ||
        !nextPreview.readiness?.summaries
      ) {
        setError("CAD preview returned an unexpected shape");
        return;
      }
      setPreview(nextPreview);
      setSelectedSheetNumber(
        nextPreview.defaultSheetNumber ??
          nextPreview.sheets[0]?.sheetNumber ??
          null,
      );
    } catch {
      setError("Network error while loading CAD render preview");
    } finally {
      setLoading(false);
    }
  }, [surveyId]);

  useEffect(() => {
    if (surveyId) loadPreview();
  }, [surveyId, loadPreview]);

  if (loading) {
    return (
      <SectionCard
        icon={<FileText size={14} />}
        title="Site Survey CAD Workbench — Read-Only Preview"
        iconColor="text-emerald-400"
      >
        <div className="flex items-center gap-2 py-4 text-xs text-slate-500">
          <div className="spinner w-4 h-4" /> Rendering source-truth CAD preview
          package...
        </div>
      </SectionCard>
    );
  }

  if (error || !preview) {
    return (
      <SectionCard
        icon={<FileText size={14} />}
        title="Site Survey CAD Workbench — Read-Only Preview"
        iconColor="text-emerald-400"
      >
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3">
          <div className="flex items-center gap-2 text-amber-200">
            <AlertTriangle size={13} />
            <p className="text-xs font-semibold">CAD preview unavailable</p>
          </div>
          <p className="mt-1 text-[11px] text-amber-100/80">
            {error ?? "No preview package returned."}
          </p>
          <button
            onClick={loadPreview}
            className="mt-3 inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-[11px] text-slate-300"
          >
            <RefreshCw size={11} /> Retry
          </button>
        </div>
      </SectionCard>
    );
  }

  const sheets = safeArray(preview.sheets);
  const selectedSheet =
    sheets.find((sheet) => sheet.sheetNumber === selectedSheetNumber) ??
    sheets[0] ??
    null;
  const readiness =
    PROFESSIONAL_READINESS_META[preview.readiness.readinessState] ??
    PROFESSIONAL_READINESS_META.review_required;
  const source = preview.readiness.source;
  const summary = preview.readiness.summaries;
  const renderSummary = preview.renderPackage.summary;
  const renderReadiness = preview.readiness.renderReadiness;
  const blockingIssues = safeArray(summary.blockingIssues);
  const warnings = safeArray(summary.warnings);
  const renderBlockers = safeArray(renderReadiness.blockers);
  const renderReviewItems = safeArray(renderReadiness.reviewItems);
  const reviewItems = Array.from(
    new Set([
      ...blockingIssues,
      ...warnings,
      ...renderBlockers,
      ...renderReviewItems,
    ]),
  ).slice(0, 8);
  const missingSourceFacts = [
    !source.hasSurveyData
      ? "No structured survey JSON was available to the parser."
      : null,
    source.photoCount === 0
      ? "No survey photos are attached to this survey record."
      : null,
    source.fileCount === 0
      ? "No survey files are attached to this survey record."
      : null,
    summary.canonicalRoofPlaneCount === 0
      ? "No canonical roof planes were parsed from the survey."
      : null,
    summary.obstructionCount === 0
      ? "No obstructions were parsed from the survey."
      : null,
    summary.setbackCount === 0
      ? "No setbacks/fire pathways were parsed from the survey."
      : null,
  ].filter(Boolean) as string[];
  const isFallbackPreview =
    renderSummary.renderQualityScore <= 0 ||
    renderSummary.renderConfidenceScore <= 0 ||
    summary.canonicalRoofPlaneCount === 0 ||
    !summary.cadPreviewEligible ||
    renderBlockers.length > 0 ||
    blockingIssues.length > 0;
  const sourceHealthTone = isFallbackPreview
    ? "border-red-500/25 bg-red-500/10"
    : "border-emerald-500/20 bg-emerald-500/10";

  return (
    <SectionCard
      icon={<FileText size={14} />}
      title="Site Survey CAD Workbench — Read-Only Preview"
      iconColor="text-emerald-400"
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-200">
                Source-truth render workbench
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                This is a non-authoritative SVG preview generated from the
                survey readiness DTO for operator review. It gives us a visible
                CAD-quality checkpoint before any permit package regeneration,
                production CAD mutation, solver execution, or downstream
                engineering/BOM/permit trigger.
              </p>
            </div>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-bold uppercase ${readiness.cls}`}
            >
              {readiness.icon}
              {readiness.label}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-3">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">
              Sheets
            </p>
            <p className="text-lg font-bold text-white">
              {renderSummary.sheetCount}
            </p>
          </div>
          <div
            className={`rounded-xl border p-3 ${renderSummary.renderQualityScore <= 0 ? "border-red-500/25 bg-red-500/10" : "border-slate-700/60 bg-slate-900/50"}`}
          >
            <p className="text-[10px] uppercase tracking-wider text-slate-500">
              Quality
            </p>
            <p className="text-lg font-bold text-white">
              {renderSummary.renderQualityScore}/100
            </p>
          </div>
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-3">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">
              Layers
            </p>
            <p className="text-lg font-bold text-white">
              {renderSummary.enabledRenderLayerCount}
            </p>
          </div>
          <div
            className={`rounded-xl border p-3 ${renderSummary.renderConfidenceScore <= 0 ? "border-red-500/25 bg-red-500/10" : "border-slate-700/60 bg-slate-900/50"}`}
          >
            <p className="text-[10px] uppercase tracking-wider text-slate-500">
              Confidence
            </p>
            <p className="text-lg font-bold text-white">
              {renderSummary.renderConfidenceScore}/100
            </p>
          </div>
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3">
            <p className="text-[10px] uppercase tracking-wider text-amber-200/80">
              Authority
            </p>
            <p className="text-lg font-bold text-amber-100">Preview</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <ReadinessPill tone="emerald">Read Only</ReadinessPill>
          <ReadinessPill tone="amber">No CAD Mutation</ReadinessPill>
          <ReadinessPill tone="amber">No Solver Execution</ReadinessPill>
          <ReadinessPill tone="slate">No Permit Trigger</ReadinessPill>
          <ReadinessPill tone="cyan">Survey Source Traceable</ReadinessPill>
          {isFallbackPreview && (
            <ReadinessPill tone="amber">Fallback Geometry Only</ReadinessPill>
          )}
        </div>

        <div className={`rounded-2xl border p-4 ${sourceHealthTone}`}>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-2">
                {isFallbackPreview ? (
                  <AlertTriangle size={15} className="text-red-300" />
                ) : (
                  <CheckCircle size={15} className="text-emerald-300" />
                )}
                <p
                  className={`text-xs font-bold uppercase tracking-wider ${isFallbackPreview ? "text-red-100" : "text-emerald-100"}`}
                >
                  {isFallbackPreview
                    ? "Source data health: fallback / not CAD-ready"
                    : "Source data health: parsed geometry available"}
                </p>
              </div>
              <p className="mt-2 max-w-3xl text-[11px] leading-relaxed text-slate-300">
                {isFallbackPreview
                  ? "The drawing below is intentionally limited because the parser did not receive enough trustworthy survey geometry to reconstruct the roof/site plan. Treat the sheet as a diagnostic placeholder, not as a usable CAD interpretation."
                  : "The parser found enough source geometry to build a reviewable preview. It is still read-only and non-authoritative until operator approval."}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-[10px]">
              <div className="rounded-lg border border-slate-700/60 bg-slate-950/40 px-3 py-2">
                <p className="text-slate-500">Files</p>
                <p className="text-sm font-bold text-white">
                  {source.fileCount}
                </p>
              </div>
              <div className="rounded-lg border border-slate-700/60 bg-slate-950/40 px-3 py-2">
                <p className="text-slate-500">Photos</p>
                <p className="text-sm font-bold text-white">
                  {source.photoCount}
                </p>
              </div>
              <div className="rounded-lg border border-slate-700/60 bg-slate-950/40 px-3 py-2">
                <p className="text-slate-500">Roof Planes</p>
                <p className="text-sm font-bold text-white">
                  {summary.canonicalRoofPlaneCount}
                </p>
              </div>
            </div>
          </div>
          {(missingSourceFacts.length > 0 || reviewItems.length > 0) && (
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <IssueList
                title="Missing or weak parsed source facts"
                items={missingSourceFacts}
                tone={isFallbackPreview ? "red" : "slate"}
              />
              <IssueList
                title="Parser / render blockers and review notes"
                items={reviewItems}
                tone={isFallbackPreview ? "red" : "amber"}
              />
            </div>
          )}
        </div>

        {sheets.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {sheets.map((sheet) => (
              <button
                key={sheet.sheetNumber}
                onClick={() => setSelectedSheetNumber(sheet.sheetNumber)}
                className={`rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition ${sheet.sheetNumber === selectedSheet?.sheetNumber ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-200" : "border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200"}`}
              >
                {sheet.sheetNumber} · {sheet.title}
              </button>
            ))}
          </div>
        )}

        {selectedSheet && (
          <div className="rounded-2xl border border-slate-700/70 bg-slate-950/50 p-3 overflow-hidden">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-bold text-white">
                  {selectedSheet.sheetNumber} · {selectedSheet.title}
                </p>
                <p className="text-[10px] text-slate-500 break-all">
                  Render hash: {selectedSheet.renderHash}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold uppercase text-emerald-200">
                  {isFallbackPreview
                    ? "diagnostic fallback"
                    : String(
                        renderSummary.renderQualityGrade ?? "preview",
                      ).replace(/_/g, " ")}
                </span>
                <div className="flex rounded-lg border border-slate-700 bg-slate-900 p-0.5">
                  {(["fit", "wide", "native"] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setViewerMode(mode)}
                      className={`rounded-md px-2 py-1 text-[10px] font-semibold uppercase ${viewerMode === mode ? "bg-cyan-500/20 text-cyan-100" : "text-slate-500 hover:text-slate-300"}`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-slate-700/70 bg-slate-900/60 p-2">
              <div className="mb-2 flex items-center gap-2 text-[10px] text-slate-500">
                <Maximize2 size={11} /> Use trackpad/shift-wheel or the bottom
                scrollbar to pan horizontally. Choose Wide/Native if Fit is too
                small.
              </div>
              <div className="max-h-[72vh] overflow-auto rounded-xl bg-white p-2 overscroll-contain">
                <div
                  className={
                    viewerMode === "fit"
                      ? "mx-auto w-full [&_svg]:h-auto [&_svg]:w-full"
                      : viewerMode === "wide"
                        ? "min-w-[1400px] [&_svg]:h-auto [&_svg]:w-[1400px]"
                        : "min-w-max [&_svg]:h-auto"
                  }
                  dangerouslySetInnerHTML={{ __html: selectedSheet.svg }}
                />
              </div>
            </div>
          </div>
        )}

        <details className="rounded-xl border border-slate-700/60 bg-slate-950/30 p-3">
          <summary className="cursor-pointer text-xs font-semibold text-slate-300">
            Layer provenance, review items, and package hashes
          </summary>
          <div className="mt-3 space-y-3 text-[10px] text-slate-500">
            <p className="break-all">
              Package hash:{" "}
              <b className="text-slate-300">
                {preview.renderPackage.packageHash}
              </b>
            </p>
            <p className="break-all">
              Render readiness hash:{" "}
              <b className="text-slate-300">
                {preview.renderPackage.sourceRenderReadinessHash}
              </b>
            </p>
            <p>
              System type:{" "}
              <b className="text-slate-300 capitalize">{summary.systemType}</b>;
              roof planes:{" "}
              <b className="text-slate-300">
                {summary.canonicalRoofPlaneCount}
              </b>
              ; obstructions:{" "}
              <b className="text-slate-300">{summary.obstructionCount}</b>;
              setbacks: <b className="text-slate-300">{summary.setbackCount}</b>
              .
            </p>
            {selectedSheet && (
              <p>
                Visible layer order:{" "}
                <span className="text-slate-400">
                  {safeArray(selectedSheet.layerOrder).join(" → ")}
                </span>
              </p>
            )}
            {reviewItems.length > 0 && (
              <ul className="space-y-1 text-amber-100/80">
                {reviewItems.map((item, i) => (
                  <li key={`${item}-${i}`}>- {item}</li>
                ))}
              </ul>
            )}
          </div>
        </details>
      </div>
    </SectionCard>
  );
}

function ProfessionalReadinessPanel({ surveyId }: { surveyId: string }) {
  const [report, setReport] =
    useState<ProfessionalReadinessReportPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/site-surveys/${surveyId}/professional-readiness`,
      );
      const json = await res.json();
      if (!json.success) {
        setError(json.error || "Failed to load professional readiness report");
        return;
      }
      const nextReport = json.data as ProfessionalReadinessReportPreview | null;
      if (
        !nextReport ||
        !nextReport.summaries ||
        !nextReport.evidence ||
        !nextReport.canonicalGeometry ||
        !nextReport.cadReadiness
      ) {
        setError("Professional readiness returned an unexpected shape");
        return;
      }
      setReport(nextReport);
    } catch {
      setError("Network error while loading professional readiness report");
    } finally {
      setLoading(false);
    }
  }, [surveyId]);

  useEffect(() => {
    if (surveyId) loadReport();
  }, [surveyId, loadReport]);

  if (loading) {
    return (
      <SectionCard
        icon={<Layers size={14} />}
        title="Professional Survey Parser Readiness v1"
        iconColor="text-violet-400"
      >
        <div className="flex items-center gap-2 py-4 text-xs text-slate-500">
          <div className="spinner w-4 h-4" /> Loading read-only parser readiness
          report...
        </div>
      </SectionCard>
    );
  }

  if (error || !report) {
    return (
      <SectionCard
        icon={<Layers size={14} />}
        title="Professional Survey Parser Readiness v1"
        iconColor="text-violet-400"
      >
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3">
          <div className="flex items-center gap-2 text-amber-200">
            <AlertTriangle size={13} />
            <p className="text-xs font-semibold">
              Read-only readiness report unavailable
            </p>
          </div>
          <p className="mt-1 text-[11px] text-amber-100/80">
            {error ?? "No report returned."}
          </p>
          <button
            onClick={loadReport}
            className="mt-3 inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-[11px] text-slate-300"
          >
            <RefreshCw size={11} /> Retry
          </button>
        </div>
      </SectionCard>
    );
  }

  const readiness =
    PROFESSIONAL_READINESS_META[report.readinessState] ??
    PROFESSIONAL_READINESS_META.review_required;
  const blockingIssues = Array.from(
    new Set([
      ...safeArray(report.summaries.blockingIssues),
      ...safeArray(report.canonicalGeometry.blockingIssues),
      ...safeArray(report.cadReadiness.blockingIssues),
    ]),
  );
  const warnings = Array.from(
    new Set([
      ...safeArray(report.summaries.warnings),
      ...safeArray(report.evidence.warnings),
      ...safeArray(report.canonicalGeometry.warnings),
      ...safeArray(report.cadReadiness.warnings),
    ]),
  );
  const reviewRequired = Array.from(
    new Set([
      ...safeArray(report.summaries.confidenceGaps),
      ...safeArray(report.cadReadiness.reviewRequired),
    ]),
  );

  return (
    <SectionCard
      icon={<Layers size={14} />}
      title="Professional Survey Parser Readiness v1"
      iconColor="text-violet-400"
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-violet-500/20 bg-violet-500/10 p-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-violet-200">
                Read-only parser integration
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                Deterministic operator preview generated from survey data and
                uploaded files. This panel is non-authoritative and does not
                persist canonical geometry, execute CAD solving, mutate
                production CAD, or trigger engineering, permit, or BOM flows.
              </p>
            </div>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-bold uppercase ${readiness.cls}`}
            >
              {readiness.icon}
              {readiness.label}
            </span>
          </div>
          <p className="mt-2 text-[11px] text-violet-100/75">
            {readiness.description}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <ReadinessPill tone="cyan">Survey Derived</ReadinessPill>
          <ReadinessPill tone="violet">Parser Derived</ReadinessPill>
          <ReadinessPill tone="cyan">Canonicalized</ReadinessPill>
          <ReadinessPill tone="amber">Preview Only</ReadinessPill>
          <ReadinessPill
            tone={report.labels.reviewRequired ? "amber" : "emerald"}
          >
            {report.labels.reviewRequired ? "Review Required" : "Review Clear"}
          </ReadinessPill>
          <ReadinessPill tone="slate">Non-Authoritative</ReadinessPill>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-3">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">
              System Type
            </p>
            <p className="text-lg font-bold text-white capitalize">
              {report.summaries.systemType}
            </p>
          </div>
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-3">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">
              Evidence Items
            </p>
            <p className="text-lg font-bold text-white">
              {report.evidence.evidenceItems.length}
            </p>
          </div>
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-3">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">
              Roof Planes
            </p>
            <p className="text-lg font-bold text-white">
              {report.summaries.canonicalRoofPlaneCount}
            </p>
          </div>
          <div
            className={`rounded-xl border p-3 ${report.summaries.cadPreviewEligible ? "border-emerald-500/20 bg-emerald-500/10" : "border-amber-500/20 bg-amber-500/10"}`}
          >
            <p className="text-[10px] uppercase tracking-wider text-slate-300/80">
              CAD Preview
            </p>
            <p
              className={`text-lg font-bold ${report.summaries.cadPreviewEligible ? "text-emerald-100" : "text-amber-100"}`}
            >
              {report.summaries.cadPreviewBuilt
                ? "Built"
                : report.summaries.cadPreviewEligible
                  ? "Eligible"
                  : "Not Ready"}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px]">
          <span className="rounded-lg border border-slate-700/60 bg-slate-950/30 px-2 py-1 text-slate-300">
            Photos: <b>{report.source.photoCount}</b>
          </span>
          <span className="rounded-lg border border-slate-700/60 bg-slate-950/30 px-2 py-1 text-slate-300">
            Obstructions: <b>{report.summaries.obstructionCount}</b>
          </span>
          <span className="rounded-lg border border-slate-700/60 bg-slate-950/30 px-2 py-1 text-slate-300">
            Setbacks: <b>{report.summaries.setbackCount}</b>
          </span>
          <span className="rounded-lg border border-slate-700/60 bg-slate-950/30 px-2 py-1 text-slate-300">
            Invalid Geometry:{" "}
            <b>{report.summaries.invalidCanonicalRoofPlaneCount}</b>
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <IssueList
            title="Blocking Issues"
            items={blockingIssues}
            tone="red"
          />
          <IssueList
            title="Missing Required Fields"
            items={report.summaries.missingRequiredFields}
            tone="amber"
          />
          <IssueList
            title="Review / Confidence Gaps"
            items={reviewRequired}
            tone="amber"
          />
          <IssueList
            title="Parser + Geometry Warnings"
            items={warnings}
            tone="slate"
          />
        </div>

        {blockingIssues.length === 0 &&
          report.summaries.missingRequiredFields.length === 0 &&
          reviewRequired.length === 0 &&
          warnings.length === 0 && (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-[11px] text-emerald-100/80">
              No blocking issues, missing required fields, parser warnings, or
              confidence gaps were reported for this preview.
            </div>
          )}

        <details className="rounded-xl border border-slate-700/60 bg-slate-950/30 p-3">
          <summary className="cursor-pointer text-xs font-semibold text-slate-300">
            Deterministic hashes and no-authority enforcement
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-2 text-[10px] text-slate-500">
            <p className="break-all">
              Source hash:{" "}
              <b className="text-slate-300">{report.evidence.sourceHash}</b>
            </p>
            <p className="break-all">
              Evidence bundle hash:{" "}
              <b className="text-slate-300">{report.evidence.bundleHash}</b>
            </p>
            <p className="break-all">
              Canonical geometry hash:{" "}
              <b className="text-slate-300">
                {report.canonicalGeometry.geometryHash}
              </b>
            </p>
            <p className="break-all">
              CAD readiness hash:{" "}
              <b className="text-slate-300">
                {report.cadReadiness.readinessHash}
              </b>
            </p>
            <p className="text-slate-400">
              No authority: DB writes{" "}
              {String(report.noAuthorityEnforcement.dbWritesAllowed)}, CAD
              solver{" "}
              {String(report.noAuthorityEnforcement.cadSolverExecutionAllowed)},
              production CAD mutation{" "}
              {String(
                report.noAuthorityEnforcement.productionCADMutationAllowed,
              )}
              , downstream engineering{" "}
              {String(
                report.noAuthorityEnforcement.downstreamEngineeringAllowed,
              )}
              , permit{" "}
              {String(report.noAuthorityEnforcement.downstreamPermitAllowed)},
              BOM {String(report.noAuthorityEnforcement.downstreamBOMAllowed)}.
            </p>
          </div>
        </details>
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------
function StatusBadge({ status }: { status: SiteSurvey["status"] }) {
  const map: Record<
    SiteSurvey["status"],
    { cls: string; label: string; icon: React.ReactNode }
  > = {
    completed: {
      cls: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25",
      label: "Completed",
      icon: <CheckCircle size={11} />,
    },
    reviewed: {
      cls: "bg-cyan-500/15 text-cyan-400 border border-cyan-500/25",
      label: "Reviewed",
      icon: <CheckCircle size={11} />,
    },
    draft: {
      cls: "bg-amber-500/15 text-amber-400 border border-amber-500/25",
      label: "Draft",
      icon: <Clock size={11} />,
    },
  };
  const cfg = map[status] ?? map.completed;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold ${cfg.cls}`}
    >
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
interface SurveyDetailData {
  survey: SiteSurvey;
  files: SiteSurveyFile[];
  evidenceManifest?: SurveyEvidenceManifest;
  evidenceHygiene?: ProjectSurveyEvidenceHygieneManifest | null;
  evidenceTraceability?: SurveyEvidenceTraceabilityBundle | null;
  evidenceBridge?: SurveyEvidenceEngineeringBridge | null;
  openSourcePhotoVision?: OpenSourcePhotoVisionBundle | null;
}

export default function SurveyDetailPage() {
  const { id: projectId, surveyId } = useParams<{
    id: string;
    surveyId: string;
  }>();

  const [detail, setDetail] = useState<SurveyDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/site-surveys/${surveyId}`);
      const json = await res.json();
      if (!json.success) {
        setError(json.error || "Failed to load survey");
        return;
      }
      setDetail(json.data);
    } catch {
      setError("Network error");
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
          <Link
            href={`/projects/${projectId}`}
            className="btn-ghost p-2 rounded-lg inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white"
          >
            <ArrowLeft size={16} /> Back to Project
          </Link>
          <div className="card p-6 text-center space-y-3">
            <AlertTriangle size={20} className="text-red-400 mx-auto" />
            <p className="text-red-400 text-sm font-medium">
              {error ?? "Survey not found"}
            </p>
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

  const {
    survey,
    files,
    evidenceManifest,
    evidenceHygiene,
    evidenceTraceability,
    evidenceBridge,
    openSourcePhotoVision,
  } = detail;
  // Always show the freshly computed survey detail manifest in the active
  // workbench. Project-level hygiene can lag behind the current survey scan and
  // should not hide photo quality/duplicate analysis from operators.
  const displayedManifest = evidenceManifest;
  const displayedTraceability = evidenceTraceability;
  const displayedBridge = evidenceBridge ?? null;

  // ---------------------------------------------------------------------------
  // Determine payload version:
  //   payload  = SurveyV2Payload | null  (schemaVersion === '2.0')
  //   v1Data   = V1DisplayData | null    (partner payload — all other surveys)
  // Exactly one of these will be non-null for any survey that has surveyData.
  // ---------------------------------------------------------------------------
  const payload: SurveyV2Payload | null = (() => {
    const d = survey.surveyData;
    if (!d || typeof d !== "object") return null;
    const rec = d as Record<string, unknown>;
    if (rec.schemaVersion !== "2.0") return null;
    return rec as unknown as SurveyV2Payload;
  })();

  const v1Data: V1DisplayData | null = (() => {
    if (payload) return null; // v2 — don't extract v1
    const d = survey.surveyData;
    if (!d || typeof d !== "object") return null;
    return extractV1Display(d as Record<string, unknown>);
  })();

  return (
    <AppShell>
      <div className="p-4 md:p-6 space-y-4 animate-fade-in max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-start gap-3">
          <Link
            href={`/projects/${projectId}`}
            className="btn-ghost p-2 rounded-lg mt-0.5 flex-shrink-0"
          >
            <ArrowLeft size={18} />
          </Link>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Camera size={16} className="text-cyan-400" />
              <h1 className="text-lg font-black text-white">Site Survey</h1>
              <StatusBadge status={survey.status} />
              <span className="text-xs text-slate-500 capitalize px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700">
                {survey.source === "standalone"
                  ? "Standalone"
                  : "Project Handoff"}
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
                  <MapPin size={10} />
                  {survey.addressSnapshot}
                </span>
              )}
              <span className="flex items-center gap-1 text-xs text-slate-400">
                <Calendar size={10} />
                {new Date(survey.createdAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
              {survey.inspectorName && (
                <span className="flex items-center gap-1 text-xs text-slate-400">
                  <User size={10} />
                  {survey.inspectorName}
                </span>
              )}
            </div>
          </div>
          <Link
            href={`/admin/engineering-intelligence/project/${projectId}`}
            className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-sky-500/25 bg-sky-500/10 px-3 py-2 text-[11px] font-semibold text-sky-300 transition hover:bg-sky-500/20"
          >
            <Network size={13} /> Intelligence
          </Link>
          <button
            onClick={load}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-all flex-shrink-0"
          >
            <RefreshCw size={13} />
          </button>
        </div>

        {/* 1. Photos — always shown (from site_survey_files) */}
        <PhotosSection files={files} />

        {/* 1b. Survey Session Hygiene — deterministic project-level duplicate grouping */}
        <SurveySessionHygieneViewer
          hygiene={evidenceHygiene}
          currentSurveyId={survey.id}
        />

        {/* 1c. Evidence provenance and requirement traceability */}
        <SurveyTraceabilityViewer traceability={displayedTraceability} />

        {/* 1d. Operator-triggered photo classification preview */}
        <SurveyPanelErrorBoundary title="AI Photo Evidence Classification Preview">
          <SurveyPhotoClassificationPreviewPanel
            surveyId={survey.id}
            manifest={displayedManifest}
            onCanonicalDetailRefresh={(refreshedDetail) => {
              setDetail((current) =>
                current ? { ...current, ...refreshedDetail } : current,
              );
            }}
          />
        </SurveyPanelErrorBoundary>

        {/* 1e. Open-source photo vision worker — actual image bytes, review-only */}
        <SurveyPanelErrorBoundary title="Run Open-Source Photo Vision Pass">
          <OpenSourcePhotoVisionPassPanel
            surveyId={survey.id}
            bundle={openSourcePhotoVision}
            onDetailRefresh={(refreshedDetail) => {
              setDetail((current) =>
                current ? { ...current, ...refreshedDetail } : current,
              );
            }}
          />
        </SurveyPanelErrorBoundary>

        {/* 1f. Survey Evidence Manifest — structured engineering evidence view */}
        <SurveyEvidenceViewer
          manifest={displayedManifest}
          bridge={displayedBridge}
        />

        {/* 1g. CAD workbench — read-only source-truth SVG preview */}
        <SurveyPanelErrorBoundary title="Site Survey CAD Workbench — Read-Only Preview">
          <SurveyCadWorkbenchPanel surveyId={survey.id} />
        </SurveyPanelErrorBoundary>

        {/* 1h. Professional parser readiness — read-only preview/reporting */}
        <SurveyPanelErrorBoundary title="Professional Survey Parser Readiness v1">
          <ProfessionalReadinessPanel surveyId={survey.id} />
        </SurveyPanelErrorBoundary>

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
            <p className="text-xs text-slate-500 italic">
              No survey data available for this record.
            </p>
          </div>
        )}

        {/* 7. Raw data (always available, collapsed by default) */}
        <RawDataSection data={survey.surveyData} />
      </div>
    </AppShell>
  );
}
