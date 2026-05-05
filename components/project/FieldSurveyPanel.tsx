// ============================================================================
// FieldSurveyPanel — Project Physical Data Display
//
// Displays field survey data captured by the ingest pipeline from
// project_physical_data. Read-only. Four card groups:
//   1. Roof / Structure
//   2. Electrical Service
//   3. Constraints & Layout
//   4. Survey Metadata
//
// States:
//   loading  — spinner while fetching
//   no-data  — survey not yet completed → CTA to start survey
//   data     — renders all groups with "Not captured" for null fields
// ============================================================================

'use client';

import React, { useEffect, useState } from 'react';
import {
  Home, Zap, AlertTriangle, ClipboardList,
  CheckCircle, XCircle, Clock, User,
  Camera, RefreshCw,
} from 'lucide-react';
import type { ProjectPhysicalData } from '@/lib/engineering/types';

// ─── Props ────────────────────────────────────────────────────────────────────

interface FieldSurveyPanelProps {
  projectId: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(val: string | number | boolean | null | undefined, unit?: string): React.ReactNode {
  if (val === null || val === undefined || val === '') {
    return <span className="text-slate-600 italic text-xs">Not captured</span>;
  }
  if (typeof val === 'boolean') {
    return val
      ? <span className="flex items-center gap-1 text-emerald-400"><CheckCircle size={11} /> Yes</span>
      : <span className="flex items-center gap-1 text-slate-400"><XCircle size={11} /> No</span>;
  }
  return <span>{String(val)}{unit ? ` ${unit}` : ''}</span>;
}

function fmtDate(val: string | null | undefined): React.ReactNode {
  if (!val) return <span className="text-slate-600 italic text-xs">Not captured</span>;
  try {
    return new Date(val).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  } catch {
    return <span>{val}</span>;
  }
}

interface FieldRowProps {
  label: string;
  value: React.ReactNode;
}

function FieldRow({ label, value }: FieldRowProps) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-slate-800/60 last:border-0">
      <span className="text-xs text-slate-500 flex-shrink-0 w-40">{label}</span>
      <span className="text-xs text-white text-right">{value}</span>
    </div>
  );
}

interface CardGroupProps {
  icon: React.ReactNode;
  title: string;
  accent: string;
  children: React.ReactNode;
}

function CardGroup({ icon, title, accent, children }: CardGroupProps) {
  return (
    <div className="card p-4">
      <div className={`flex items-center gap-2 mb-3 pb-2 border-b border-slate-800`}>
        <span className={accent}>{icon}</span>
        <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">{title}</span>
      </div>
      <div className="space-y-0">
        {children}
      </div>
    </div>
  );
}

// ─── No-data CTA ─────────────────────────────────────────────────────────────

function NoDataState() {
  return (
    <div className="card p-8 text-center space-y-4">
      <div className="w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mx-auto">
        <Camera size={24} className="text-cyan-400" />
      </div>
      <div>
        <h3 className="text-white font-semibold text-sm mb-1">No Field Survey Data</h3>
        <p className="text-slate-400 text-xs max-w-xs mx-auto leading-relaxed">
          Survey data is captured by the field technician using the mobile app
          and automatically appears here once submitted.
        </p>
      </div>
      <p className="text-slate-600 text-xs">
        Engineering uses defaults until real data is captured.
      </p>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function FieldSurveyPanel({ projectId }: FieldSurveyPanelProps) {
  const [data, setData] = useState<ProjectPhysicalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasData, setHasData] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/physical-data`);
      const json = await res.json();
      if (!json.success) {
        setError(json.error || 'Failed to load survey data');
        return;
      }
      setData(json.data ?? null);
      setHasData(json.data !== null);
    } catch (err) {
      setError('Network error loading survey data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (projectId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-500 text-sm">
          <div className="spinner w-5 h-5" />
          Loading survey data…
        </div>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="card p-6 text-center space-y-3">
        <AlertTriangle size={20} className="text-red-400 mx-auto" />
        <p className="text-red-400 text-sm font-medium">Failed to load survey data</p>
        <p className="text-slate-500 text-xs font-mono">{error}</p>
        <button
          onClick={load}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-300 hover:border-slate-600 transition-all"
        >
          <RefreshCw size={12} /> Retry
        </button>
      </div>
    );
  }

  // ── No survey data yet ────────────────────────────────────────────────────
  if (!hasData || !data) {
    return <NoDataState />;
  }

  // ── Survey data present ───────────────────────────────────────────────────

  // Format obstructions list
  const obstructionDisplay = (() => {
    if (!data.obstructions || (data.obstructions as unknown[]).length === 0) {
      return <span className="text-slate-600 italic text-xs">None reported</span>;
    }
    const items = data.obstructions as unknown[];
    return (
      <span className="text-amber-300">
        {items.length} obstruction{items.length !== 1 ? 's' : ''}
      </span>
    );
  })();

  return (
    <div className="space-y-4">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardList size={15} className="text-cyan-400" />
          <span className="text-sm font-semibold text-white">Field Survey Data</span>
          <span className="badge bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 text-xs px-2 py-0.5 rounded-full">
            Captured
          </span>
        </div>
        <button
          onClick={load}
          title="Refresh survey data"
          className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-all"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {/* ── Group 1: Roof / Structure ── */}
      <CardGroup
        icon={<Home size={14} />}
        title="Roof / Structure"
        accent="text-amber-400"
      >
        <FieldRow label="Roof Material"    value={fmt(data.roof_material)} />
        <FieldRow label="Roof Pitch"       value={fmt(data.roof_pitch)} />
        <FieldRow label="Rafter Spacing"   value={fmt(data.rafter_spacing_in, 'in O.C.')} />
        <FieldRow label="Roof Condition"   value={fmt(data.roof_condition)} />
        <FieldRow label="Roof Age"         value={fmt(data.roof_age_years, 'yrs')} />
        <FieldRow label="Attic Access"     value={fmt(data.attic_access)} />
        <FieldRow label="Structure Type"   value={fmt(data.structure_type)} />
        <FieldRow label="Stories"          value={fmt(data.stories)} />
      </CardGroup>

      {/* ── Group 2: Electrical Service ── */}
      <CardGroup
        icon={<Zap size={14} />}
        title="Electrical Service"
        accent="text-yellow-400"
      >
        <FieldRow label="Panel Brand"         value={fmt(data.panel_brand)} />
        <FieldRow label="Panel Rating"        value={fmt(data.panel_rating_amps, 'A')} />
        <FieldRow label="Breaker Slots Avail" value={fmt(data.available_breaker_slots)} />
        <FieldRow label="Meter Socket"        value={fmt(data.meter_socket_type)} />
        <FieldRow label="Interconnection"     value={fmt(data.interconnection_point)} />
        <FieldRow label="Service Entrance"    value={fmt(data.service_entrance_type)} />
        <FieldRow label="Has Sub-Panel"       value={fmt(data.has_sub_panel)} />
        <FieldRow label="Sub-Panel Rating"    value={data.has_sub_panel ? fmt(data.sub_panel_rating_amps, 'A') : <span className="text-slate-600 italic text-xs">N/A</span>} />
      </CardGroup>

      {/* ── Group 3: Constraints & Layout ── */}
      <CardGroup
        icon={<AlertTriangle size={14} />}
        title="Constraints & Layout"
        accent="text-orange-400"
      >
        <FieldRow label="Obstructions"      value={obstructionDisplay} />
        <FieldRow label="Usable Roof"       value={fmt(data.usable_roof_pct, '%')} />
      </CardGroup>

      {/* ── Group 4: Survey Metadata ── */}
      <CardGroup
        icon={<User size={14} />}
        title="Survey Metadata"
        accent="text-slate-400"
      >
        <FieldRow label="Inspector"   value={fmt(data.inspector_name)} />
        <FieldRow label="Survey Date" value={fmtDate(data.surveyed_at)} />
      </CardGroup>

    </div>
  );
}