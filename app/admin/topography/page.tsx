// ============================================================================
// app/admin/topography/page.tsx  — v3: Unified Pipeline Topology + Live Audit
//
// Split layout:
//   LEFT  — tab toggle: "Map" (original iframe) | "Pipeline" (unified topology)
//   RIGHT — System Integration Panel (live audit, unchanged from v2)
//
// Pipeline tab shows the FULL end-to-end connected flow:
//   Partner Mobile → Partner Backend → Outbound Webhook Queue
//   → SolarPro Ingest → project_physical_data → Engineering Report
//
// Both pipelines (partner app + SolarPro) are shown with their real
// source files, env vars, and live connection status.
//
// Data source: GET /api/topography/state?projectId=XXX
// If no projectId is provided, right panel shows a project selector prompt.
//
// RULES:
//   - iframe src is UNCHANGED (same TOPO_URL)
//   - no writes to DB
//   - no side effects on production routes
// ============================================================================

'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Layers, RefreshCw, Clock, AlertTriangle,
  CheckCircle, XCircle, MinusCircle,
  ChevronDown, ChevronRight, Database, Zap, Home,
  GitBranch, FileText, Cpu, Shield, BarChart2,
  Map, Network, Smartphone, Server, Cloud, Link2,
  ArrowRight, ChevronRight as Arrow,
  Download, Image, MapPin, Camera,
} from 'lucide-react';
import type { TopographyState, FieldUsage } from '@/lib/topography/getTopographyState';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOPO_URL =
  'https://sites.super.myninja.ai/399ee147-1c47-4168-953c-039b63bf656e/a29238b9/index.html';

// Partner app live URL (from PIPELINE_TOPOLOGY.html)
const PARTNER_API_URL = 'https://site-survey-api-bpyz.onrender.com';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type NodeStatus = 'green' | 'yellow' | 'red' | 'unknown';

function statusColor(s: NodeStatus) {
  switch (s) {
    case 'green':  return 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400';
    case 'yellow': return 'bg-amber-500/20 border-amber-500/40 text-amber-400';
    case 'red':    return 'bg-red-500/20 border-red-500/40 text-red-400';
    default:       return 'bg-slate-700/40 border-slate-600/40 text-slate-400';
  }
}

function statusDot(s: NodeStatus) {
  switch (s) {
    case 'green':  return 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]';
    case 'yellow': return 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.6)]';
    case 'red':    return 'bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.6)]';
    default:       return 'bg-slate-500';
  }
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Sub-components (Integration Panel — unchanged from v2)
// ---------------------------------------------------------------------------

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-3 pb-2 border-b border-slate-700/60">
      <span className="text-slate-400">{icon}</span>
      <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-widest">
        {title}
      </span>
    </div>
  );
}

function StatusRow({
  label,
  status,
  note,
}: {
  label: string;
  status: NodeStatus;
  note?: string;
}) {
  const Icon =
    status === 'green'  ? CheckCircle :
    status === 'yellow' ? MinusCircle :
    status === 'red'    ? XCircle :
    MinusCircle;

  const iconColor =
    status === 'green'  ? 'text-emerald-400' :
    status === 'yellow' ? 'text-amber-400' :
    status === 'red'    ? 'text-red-400' :
    'text-slate-500';

  return (
    <div className="flex items-center justify-between py-1.5 border-b border-slate-800/50 last:border-0">
      <span className="text-xs text-slate-400">{label}</span>
      <div className="flex items-center gap-1.5">
        {note && <span className="text-[10px] text-slate-500 italic">{note}</span>}
        <Icon size={13} className={iconColor} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Data Flow Node (Integration Panel)
// ---------------------------------------------------------------------------

interface FlowNodeProps {
  icon: React.ReactNode;
  label: string;
  sublabel?: string;
  status: NodeStatus;
  isLast?: boolean;
}

function FlowNode({ icon, label, sublabel, status, isLast }: FlowNodeProps) {
  return (
    <div className="flex flex-col items-center">
      <div className={`flex items-center gap-2 w-full px-3 py-2 rounded-lg border text-xs font-medium ${statusColor(status)}`}>
        <span>{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="truncate">{label}</div>
          {sublabel && (
            <div className="text-[10px] opacity-70 truncate">{sublabel}</div>
          )}
        </div>
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDot(status)}`} />
      </div>
      {!isLast && (
        <div className="w-px h-3 bg-slate-700" />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Field Utilization Table
// ---------------------------------------------------------------------------

function FieldUtilizationTable({
  fields,
  expanded,
  onToggle,
}: {
  fields: FieldUsage[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const captured = fields.filter((f) => f.captured).length;
  const total = fields.length;

  return (
    <div>
      <button
        onClick={onToggle}
        className="flex items-center justify-between w-full mb-2 group"
      >
        <div className="flex items-center gap-2">
          <BarChart2 size={12} className="text-slate-400" />
          <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-widest">
            Field Utilization
          </span>
          <span className="text-[10px] bg-slate-700/60 text-slate-400 px-1.5 py-0.5 rounded-full">
            {captured}/{total} captured
          </span>
        </div>
        {expanded
          ? <ChevronDown size={12} className="text-slate-500" />
          : <ChevronRight size={12} className="text-slate-500" />
        }
      </button>

      {/* Progress bar */}
      <div className="h-1.5 w-full bg-slate-800 rounded-full mb-2 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-cyan-500 to-emerald-500 rounded-full transition-all duration-500"
          style={{ width: `${(captured / total) * 100}%` }}
        />
      </div>

      {expanded && (
        <div className="space-y-0 border border-slate-800 rounded-lg overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-1.5 bg-slate-800/60">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Field</span>
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide text-right">Captured</span>
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide text-right w-16">Used By Eng</span>
          </div>

          {fields.map((f) => (
            <div
              key={f.field}
              className={`grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-1.5 border-t border-slate-800/50 ${
                f.usedByEngineering ? 'bg-emerald-500/5' : ''
              }`}
            >
              <div className="min-w-0">
                <span className="text-[10px] text-slate-300 truncate block">{f.label}</span>
                <span className="text-[9px] text-slate-600 font-mono">{f.field}</span>
              </div>
              <div className="flex items-center justify-end">
                {f.captured
                  ? <CheckCircle size={11} className="text-emerald-400" />
                  : <XCircle size={11} className="text-red-400/60" />
                }
              </div>
              <div className="flex items-center justify-end w-16">
                {f.usedByEngineering
                  ? <span className="text-[9px] font-semibold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">YES</span>
                  : <span className="text-[9px] text-slate-600 bg-slate-800/40 px-1.5 py-0.5 rounded">—</span>
                }
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Project Selector
// ---------------------------------------------------------------------------

function ProjectSelector({ onSelect }: { onSelect: (id: string) => void }) {
  const [input, setInput] = useState('');

  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 p-6">
      <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
        <Database size={20} className="text-cyan-400" />
      </div>
      <div className="text-center">
        <h3 className="text-sm font-semibold text-white mb-1">Enter Project ID</h3>
        <p className="text-xs text-slate-400 max-w-[200px] leading-relaxed">
          Paste a project UUID to load the system integration audit for that project.
        </p>
      </div>
      <div className="flex gap-2 w-full max-w-[280px]">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && input.trim() && onSelect(input.trim())}
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50"
        />
        <button
          onClick={() => input.trim() && onSelect(input.trim())}
          className="px-3 py-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-xs font-semibold text-cyan-400 hover:bg-cyan-500/25 transition-all"
        >
          Load
        </button>
      </div>
      <p className="text-[10px] text-slate-600">
        Or add ?projectId=UUID to the URL
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Integration Panel — right side, unchanged from v2
// ---------------------------------------------------------------------------

function IntegrationPanel({
  projectId,
  onProjectChange,
}: {
  projectId: string | null;
  onProjectChange: (id: string) => void;
}) {
  const [state, setState] = useState<TopographyState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldTableExpanded, setFieldTableExpanded] = useState(false);

  const load = useCallback(async (pid: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/topography/state?projectId=${encodeURIComponent(pid)}`);
      const json = await res.json() as { success: boolean; data?: TopographyState; error?: string };
      if (!json.success) {
        setError(json.error ?? 'Failed to load state');
        setState(null);
      } else {
        setState(json.data ?? null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
      setState(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (projectId) {
      load(projectId);
    }
  }, [projectId, load]);

  if (!projectId) return <ProjectSelector onSelect={onProjectChange} />;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <div className="w-8 h-8 rounded-full border-2 border-slate-700 border-t-cyan-400 animate-spin" />
        <p className="text-xs text-slate-500">Loading audit state…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
        <AlertTriangle size={20} className="text-red-400" />
        <p className="text-sm font-semibold text-red-400">Failed to load</p>
        <p className="text-xs text-slate-500 font-mono">{error}</p>
        <button
          onClick={() => load(projectId)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-300 hover:border-slate-600 transition-all"
        >
          <RefreshCw size={11} /> Retry
        </button>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-slate-500">No data</p>
      </div>
    );
  }

  const { survey, systemIntegration, engineering, permit, layout } = state;

  const partnerAppStatus: NodeStatus   = 'unknown';
  const webhookStatus: NodeStatus      = survey.legacy ? 'green' : 'red';
  const dbPhysicalStatus: NodeStatus   = survey.legacy ? (survey.fieldsUsedCount >= 10 ? 'green' : 'yellow') : 'red';
  const newPipelineStatus: NodeStatus  = survey.newPipeline ? (survey.newPipelineEnriched ? 'green' : 'yellow') : 'red';
  const systemDefStatus: NodeStatus    = systemIntegration.appliedToSystemDefinition ? 'green' : 'red';
  const cadStatus: NodeStatus          = systemIntegration.usedInCAD ? 'green' : 'red';
  const engineeringStatus: NodeStatus  = systemIntegration.usedInEngineering
    ? (systemIntegration.usedInEngineeringPartial ? 'yellow' : 'green')
    : (engineering.reportExists ? 'yellow' : 'red');
  const permitStatus: NodeStatus       = permit.artifactExists ? 'green' : 'red';

  const engineeringNote = systemIntegration.usedInEngineering
    ? `4/${survey.fieldsTotalCount} fields`
    : engineering.reportExists
      ? 'no survey data'
      : undefined;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-slate-800/80 bg-slate-900/60">
        <div className="flex items-center gap-2">
          <GitBranch size={13} className="text-cyan-400" />
          <span className="text-xs font-semibold text-white">System Integration</span>
          {state.projectName && (
            <span className="text-[10px] text-slate-400 truncate max-w-[120px]" title={state.projectName}>
              — {state.projectName}
            </span>
          )}
        </div>
        <button
          onClick={() => load(projectId)}
          title="Refresh"
          className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-all"
        >
          <RefreshCw size={11} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">

        <div>
          <SectionHeader icon={<Database size={13} />} title="Survey Status" />
          <StatusRow
            label="Legacy Survey (project_physical_data)"
            status={survey.legacy ? 'green' : 'red'}
            note={survey.legacy ? fmtDate(survey.legacyUpdatedAt) : undefined}
          />
          <StatusRow
            label="New Pipeline (project_site_surveys)"
            status={survey.newPipeline
              ? (survey.newPipelineEnriched ? 'green' : 'yellow')
              : 'red'
            }
            note={
              survey.newPipeline
                ? (survey.newPipelineEnriched ? 'enriched' : 'normalized only')
                : undefined
            }
          />
          <StatusRow
            label={`Fields Captured (${survey.fieldsUsedCount}/${survey.fieldsTotalCount})`}
            status={
              survey.fieldsUsedCount === 0 ? 'red' :
              survey.fieldsUsedCount < 10   ? 'yellow' :
              'green'
            }
          />
          {state.layout.exists && (
            <StatusRow
              label={`Layout: ${state.layout.panelCount ?? '?'} panels · ${state.layout.systemType ?? 'unknown'}`}
              status="green"
            />
          )}
        </div>

        <div>
          <SectionHeader icon={<Zap size={13} />} title="Integration Status" />
          <StatusRow
            label="SystemDefinition Override"
            status={systemIntegration.appliedToSystemDefinition ? 'green' : 'red'}
            note={!systemIntegration.appliedToSystemDefinition ? 'not wired' : undefined}
          />
          <StatusRow
            label="CAD Engine"
            status={systemIntegration.usedInCAD ? 'green' : 'red'}
            note={!systemIntegration.usedInCAD ? 'not wired' : undefined}
          />
          <StatusRow
            label="Engineering Report"
            status={engineeringStatus}
            note={engineeringNote}
          />
          <StatusRow
            label="Permit Plan Set"
            status={systemIntegration.usedInPermit ? 'green' : (permit.artifactExists ? 'yellow' : 'red')}
            note={!systemIntegration.usedInPermit
              ? (permit.artifactExists ? `${permit.artifactCount} file(s), survey unused` : 'not wired')
              : undefined
            }
          />
          <StatusRow
            label="Proposal Engine"
            status={systemIntegration.usedInProposal ? 'green' : 'red'}
            note={!systemIntegration.usedInProposal ? 'not wired' : undefined}
          />
        </div>

        <div>
          <SectionHeader icon={<Home size={13} />} title="Data Flow" />
          <div className="space-y-0">
            <FlowNode
              icon={<Cpu size={11} />}
              label="Partner App / Field Device"
              sublabel="/survey/[token]"
              status={partnerAppStatus}
            />
            <FlowNode
              icon={<GitBranch size={11} />}
              label="Webhook Ingest"
              sublabel="POST /api/webhooks/survey-complete"
              status={webhookStatus}
            />
            <FlowNode
              icon={<Database size={11} />}
              label="project_physical_data"
              sublabel={
                survey.legacy
                  ? `${survey.fieldsUsedCount} fields captured`
                  : 'no data yet'
              }
              status={dbPhysicalStatus}
            />
            <FlowNode
              icon={<Database size={11} />}
              label="project_site_surveys"
              sublabel={
                survey.newPipeline
                  ? (survey.newPipelineEnriched ? 'enriched' : 'normalized only')
                  : 'no data yet'
              }
              status={newPipelineStatus}
            />
            <FlowNode
              icon={<GitBranch size={11} />}
              label="SystemDefinition Override"
              sublabel={systemIntegration.appliedToSystemDefinition ? 'applied' : 'applyToSystemDefinition — NOT wired'}
              status={systemDefStatus}
            />
            <FlowNode
              icon={<Home size={11} />}
              label="CAD Engine"
              sublabel={systemIntegration.usedInCAD ? 'survey geometry used' : 'buildCADFromSurvey — NOT wired'}
              status={cadStatus}
            />
            <FlowNode
              icon={<Cpu size={11} />}
              label="Engineering Report"
              sublabel={
                systemIntegration.usedInEngineering
                  ? `4/${survey.fieldsTotalCount} fields · partial`
                  : engineering.reportExists
                    ? 'report exists, survey not feeding it'
                    : 'no report'
              }
              status={engineeringStatus}
            />
            <FlowNode
              icon={<Shield size={11} />}
              label="Permit Plan Set"
              sublabel={
                permit.artifactExists
                  ? `${permit.artifactCount} artifact(s) · permitIntegration NOT wired`
                  : 'permitIntegration — NOT wired'
              }
              status={permitStatus}
            />
            <FlowNode
              icon={<FileText size={11} />}
              label="Proposal"
              sublabel="no survey reads in proposal routes"
              status="red"
              isLast
            />
          </div>
        </div>

        <FieldUtilizationTable
          fields={survey.fieldUsage}
          expanded={fieldTableExpanded}
          onToggle={() => setFieldTableExpanded((v) => !v)}
        />

        {state.errors.length > 0 && (
          <div className="border border-amber-500/20 rounded-lg p-3 bg-amber-500/5">
            <p className="text-[10px] font-semibold text-amber-400 mb-1.5 uppercase tracking-wide">
              State Fetch Warnings
            </p>
            {state.errors.map((e, i) => (
              <p key={i} className="text-[10px] text-amber-400/80 font-mono leading-relaxed">{e}</p>
            ))}
          </div>
        )}

        <div className="border border-slate-800/60 rounded-lg p-3 bg-slate-900/40">
          <p className="text-[10px] text-slate-500 font-mono">
            Project: {state.projectId.slice(0, 8)}…
          </p>
          {state.projectAddress && (
            <p className="text-[10px] text-slate-500 truncate">{state.projectAddress}</p>
          )}
          {state.projectLat != null && state.projectLng != null && (
            <p className="text-[10px] text-slate-500 font-mono">
              {state.projectLat.toFixed(5)}, {state.projectLng.toFixed(5)}
            </p>
          )}
          <p className="text-[10px] text-slate-600 mt-1">
            Fetched: {fmtDate(state.fetchedAt)}
          </p>
        </div>

        <div>
          <button
            onClick={() => onProjectChange('')}
            className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors underline underline-offset-2"
          >
            Load a different project
          </button>
        </div>

      </div>
    </div>
  );
}

// ===========================================================================
// PIPELINE TOPOLOGY VIEW — unified partner + SolarPro pipeline
// ===========================================================================

// Colors matching partner app's PIPELINE_TOPOLOGY.html
const COLOR = {
  mobile:      { bg: 'bg-[#4fd1c5]/10', border: 'border-[#4fd1c5]/30', text: 'text-[#4fd1c5]', dot: 'bg-[#4fd1c5]', glow: 'shadow-[0_0_8px_rgba(79,209,197,0.4)]' },
  backend:     { bg: 'bg-[#7aa2ff]/10', border: 'border-[#7aa2ff]/30', text: 'text-[#7aa2ff]', dot: 'bg-[#7aa2ff]', glow: 'shadow-[0_0_8px_rgba(122,162,255,0.4)]' },
  cloud:       { bg: 'bg-[#c084fc]/10', border: 'border-[#c084fc]/30', text: 'text-[#c084fc]', dot: 'bg-[#c084fc]', glow: 'shadow-[0_0_8px_rgba(192,132,252,0.4)]' },
  db:          { bg: 'bg-[#fbbf24]/10', border: 'border-[#fbbf24]/30', text: 'text-[#fbbf24]', dot: 'bg-[#fbbf24]', glow: 'shadow-[0_0_8px_rgba(251,191,36,0.4)]' },
  integration: { bg: 'bg-[#f472b6]/10', border: 'border-[#f472b6]/30', text: 'text-[#f472b6]', dot: 'bg-[#f472b6]', glow: 'shadow-[0_0_8px_rgba(244,114,182,0.4)]' },
  solarpro:    { bg: 'bg-cyan-500/10',   border: 'border-cyan-500/30',   text: 'text-cyan-400',  dot: 'bg-cyan-400',  glow: 'shadow-[0_0_8px_rgba(34,211,238,0.4)]' },
  engineering: { bg: 'bg-emerald-500/10',border: 'border-emerald-500/30',text: 'text-emerald-400',dot:'bg-emerald-400',glow:'shadow-[0_0_8px_rgba(52,211,153,0.4)]' },
  blocked:     { bg: 'bg-slate-700/20',  border: 'border-slate-600/30',  text: 'text-slate-500',  dot: 'bg-slate-600', glow: '' },
};

type ColorKey = keyof typeof COLOR;

interface PipelineStep {
  num: number;
  layer: ColorKey;
  layerLabel: string;
  title: string;
  detail: string;
  code: string;
  envVars?: string[];
  status: 'live' | 'degraded' | 'blocked' | 'external';
}

const PIPELINE_STEPS: PipelineStep[] = [
  {
    num: 0,
    layer: 'solarpro',
    layerLabel: 'SolarPro · SSO (v60.5)',
    title: 'Identity Handoff · /api/auth/authorize',
    detail: 'OAuth-style authorize endpoint. Mobile app opens /api/auth/authorize?redirect_uri=sitesurvey://login&state=<r>. If user has a session, SolarPro mints HS256 JWT (10 min TTL) with sub, solarpro_user_id, email, name, iat, exp, jti; records jti in mobile_sso_used_jtis (replay protection); 302-redirects to sitesurvey://login?token=<jwt>&state=<r>. SolarPro is the ONLY source of user identity.',
    code: 'app/api/auth/authorize/route.ts\nJWT: HS256 (SOLARPRO_HANDOFF_SECRET ≥ 32 chars)\nAllowlist: AUTHORIZE_ALLOWED_REDIRECTS (default sitesurvey://)\nJTI store: mobile_sso_used_jtis (replay protection)',
    envVars: ['SOLARPRO_HANDOFF_SECRET', 'AUTHORIZE_ALLOWED_REDIRECTS'],
    status: 'live',
  },
  {
    num: 1,
    layer: 'mobile',
    layerLabel: 'Partner · Mobile',
    title: 'Field Survey Captured (w/ bearer JWT)',
    detail: 'Inspector fills survey on mobile app (Expo/React Native). GPS, photos, metadata collected. Stored locally then synced. Every API call to the partner backend carries Authorization: Bearer <jwt> from step 0 — device-supplied user_id is never trusted.',
    code: 'mobile/src/screens/NewSurveyScreen.tsx\nmobile/src/services/SyncManager.ts\nmobile/src/screens/LoginScreen.tsx (SSO button → /api/auth/authorize)',
    status: 'external',
  },
  {
    num: 2,
    layer: 'backend',
    layerLabel: 'Partner · Backend',
    title: 'Survey Persisted + Complete Trigger',
    detail: 'POST /api/surveys (create) → POST /api/surveys/:id/complete. SyncManager now auto-calls /complete after successful sync. Survey row written to PostgreSQL/PostGIS.',
    code: 'backend/src/routes/surveys.ts\nPOST /api/surveys/:id/complete',
    status: 'live',
  },
  {
    num: 3,
    layer: 'db',
    layerLabel: 'Partner · DB',
    title: 'surveys Table + webhook_deliveries',
    detail: 'Survey persisted with metadata JSONB (RoofMountMetadata | GroundMountMetadata | SolarFencingMetadata), PostGIS location. Thin event enqueued in webhook_deliveries.',
    code: 'surveys.metadata: { roof_material, rafter_size,\n  rafter_spacing, roof_age_years, azimuth,\n  soil_type, slope_degrees, ... }\nwebhook_deliveries: pending → delivered',
    status: 'live',
  },
  {
    num: 4,
    layer: 'integration',
    layerLabel: 'Partner · Outbound Webhook',
    title: 'HMAC-Signed Delivery Worker',
    detail: 'Worker runs every 30s. Signs payload with HMAC-SHA256 over "${timestamp}.${rawBody}". Retry schedule: 1→5→30→120→720 min. Delivers thin event to SolarPro.',
    code: 'backend/src/services/webhookService.ts\nPOST ${SOLARPRO_WEBHOOK_URL}/api/webhooks/survey-complete\nHeaders: X-Survey-Signature, X-Survey-Timestamp, X-Survey-Event-Id',
    envVars: ['SOLARPRO_WEBHOOK_URL', 'SURVEY_WEBHOOK_SECRET'],
    status: 'live',
  },
  {
    num: 5,
    layer: 'cloud',
    layerLabel: 'Boundary · Wire',
    title: '⚡ Partner → SolarPro Webhook Boundary',
    detail: 'Thin event crosses the wire. v60.5 payload includes ownership claims: { event, event_id, occurred_at, survey_id, project_id, project_name, inspector_name, site_name, completed_at, solarpro_user_id, solarpro_project_id, solarpro_email }. HMAC verified on arrival. solarpro_user_id drives owner resolution; solarpro_project_id drives ATTACH-vs-CREATE routing in step 9.',
    code: '{\n  \"event\":\"survey.completed\",\n  \"survey_id\":\"uuid\",\n  \"solarpro_user_id\":\"uuid\",          // v60.5 \u2014 from JWT\n  \"solarpro_project_id\":\"uuid|null\",  // v60.5 \u2014 optional\n  \"project_name\":\"...\",\n  \"inspector_name\":\"...\",\n  \"site_name\":\"...\",\n  \"completed_at\":\"ISO\"\n}',
    status: 'live',
  },
  {
    num: 6,
    layer: 'solarpro',
    layerLabel: 'SolarPro · Ingest',
    title: 'Webhook Receiver + HMAC Verify',
    detail: 'POST /api/webhooks/survey-complete. Reads raw body bytes, verifies HMAC-SHA256, checks idempotency via event_id. Inserts webhook_deliveries row with status=verified.',
    code: 'app/api/webhooks/survey-complete/route.ts\nlib/survey/verifyWebhookSignature.ts\nlib/survey/envelopeValidator.ts',
    envVars: ['SURVEY_WEBHOOK_SECRET'],
    status: 'live',
  },
  {
    num: 7,
    layer: 'solarpro',
    layerLabel: 'SolarPro · Ingest',
    title: 'Full Payload Fetch from Partner API',
    detail: 'GET ${PARTNER_BASE_URL}/api/surveys/:id with Bearer token. Returns full survey JSON including category metadata. Falls back to degraded mode (thin event only) on failure.',
    code: 'lib/survey/ingest/payloadFetcher.ts\nGET ${PARTNER_BASE_URL}/api/surveys/${surveyId}\nAuthorization: Bearer ${PARTNER_API_BEARER_TOKEN}',
    envVars: ['PARTNER_BASE_URL', 'PARTNER_API_BEARER_TOKEN'],
    status: 'live',
  },
  {
    num: 8,
    layer: 'solarpro',
    layerLabel: 'SolarPro · Transform',
    title: 'Field Mapping + Enum Normalization',
    detail: 'v1.0 transformer: maps partner metadata fields to SolarPro schema. roof_material → "Asphalt Shingle", rafter_spacing → numeric inches, panel_rating → numeric amps. All values normalized through explicit maps.',
    code: 'lib/survey/ingest/transformLayer.ts\npartner.metadata.roof_material → project_physical_data.roof_material\npartner.metadata.rafter_spacing → rafter_spacing_in (int)\npartner.metadata.roof_age_years → roof_age_years\npartner.metadata.azimuth → [stored in survey_meta JSONB]',
    status: 'live',
  },
  {
    num: 9,
    layer: 'db',
    layerLabel: 'SolarPro · DB Write (v60.5)',
    title: 'projects + project_physical_data — per-event routing',
    detail: 'v60.5 projectLinkResolver decides per-event: if webhook carries solarpro_project_id → ATTACH to the existing project (Case 1, \"survey started from a SolarPro project page\"). If absent → CREATE new project under the SSO user (Case 2, \"user logs into app and starts survey from scratch\"). TRIAGE_QUEUE env override still honoured as ops pause-everything switch. Idempotent ON CONFLICT upsert on survey_external_id; re-deliveries overwrite with latest data. project_files inserted for photos.',
    code: 'lib/survey/ingest/projectLinkResolver.ts  (v60.5 per-event)\nlib/survey/ingest/ingestPipeline.ts\n→ projects (origin=\'survey\', survey_external_id)\n→ project_physical_data (20 fields, source=\'survey\')\n→ project_files (photos, status=\'pending\')',
    envVars: ['SURVEY_PROJECT_LINK_STRATEGY'],
    status: 'live',
  },
  {
    num: 10,
    layer: 'engineering',
    layerLabel: 'SolarPro · Engineering',
    title: 'Engineering Report Generator',
    detail: 'Reads 4/20 physical_data fields: panel_rating_amps (NEC 705.12B calc), rafter_spacing_in (structural), roof_material (load type), interconnection_point (diagram). 16 fields captured but NOT consumed.',
    code: 'lib/engineering/reportGenerator.ts\n→ pd.panel_rating_amps      ✓ used\n→ pd.rafter_spacing_in      ✓ used\n→ pd.roof_material          ✓ used\n→ pd.interconnection_point  ✓ used\n→ pd.roof_pitch             ✗ not consumed\n→ pd.panel_brand            ✗ not consumed\n→ [14 more fields]          ✗ not consumed',
    status: 'degraded',
  },
  {
    num: 11,
    layer: 'blocked',
    layerLabel: 'SolarPro · NOT Wired',
    title: 'SystemDefinition / CAD / Permit / Proposal',
    detail: 'applyToSystemDefinition, buildCADFromSurvey, permitIntegration, electricalFromSurvey — all built in lib/siteSurvey/ (Phase 1-10) but ZERO callers in app/ production routes. Survey data does not flow here.',
    code: 'lib/siteSurvey/applyToSystemDefinition.ts  ✗ 0 callers\nlib/siteSurvey/buildCADFromSurvey.ts       ✗ 0 callers\nlib/siteSurvey/permitIntegration.ts        ✗ 0 callers\nlib/siteSurvey/electricalFromSurvey.ts     ✗ 0 callers',
    status: 'blocked',
  },
];

function statusBadge(status: PipelineStep['status']) {
  switch (status) {
    case 'live':     return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">LIVE</span>;
    case 'degraded': return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30">PARTIAL</span>;
    case 'blocked':  return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-slate-700/60 text-slate-400 border border-slate-600/30">NOT WIRED</span>;
    case 'external': return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[#4fd1c5]/10 text-[#4fd1c5] border border-[#4fd1c5]/30">EXTERNAL</span>;
  }
}

function PipelineStepCard({ step, isLast }: { step: PipelineStep; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const c = COLOR[step.layer];
  const isWire = step.num === 5;

  return (
    <div className="flex gap-3">
      {/* Spine */}
      <div className="flex flex-col items-center flex-shrink-0">
        <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${c.border} ${c.bg} ${c.text} ${step.status === 'live' || step.status === 'external' ? c.glow : ''}`}>
          {step.num}
        </div>
        {!isLast && (
          <div className={`w-px flex-1 mt-1 min-h-[20px] ${isWire ? 'bg-gradient-to-b from-[#f472b6] via-[#c084fc] to-cyan-500' : 'bg-slate-700/60'}`} />
        )}
      </div>

      {/* Card */}
      <div className={`flex-1 mb-3 rounded-xl border ${c.border} ${c.bg} overflow-hidden`}>
        {/* Header */}
        <button
          className="w-full text-left px-4 py-3 flex items-start justify-between gap-2"
          onClick={() => setExpanded(v => !v)}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
              <span className={`text-[9px] font-semibold uppercase tracking-widest ${c.text} opacity-70`}>
                {step.layerLabel}
              </span>
              {statusBadge(step.status)}
            </div>
            <div className={`text-sm font-semibold ${c.text} leading-snug ${isWire ? 'text-base' : ''}`}>
              {step.title}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5 leading-relaxed line-clamp-2">
              {step.detail}
            </div>
          </div>
          <div className="flex-shrink-0 mt-1">
            {expanded
              ? <ChevronDown size={13} className="text-slate-500" />
              : <ChevronRight size={13} className="text-slate-500" />
            }
          </div>
        </button>

        {/* Expanded */}
        {expanded && (
          <div className="px-4 pb-4 border-t border-white/5 pt-3 space-y-3">
            <div className="text-[11px] text-slate-300 leading-relaxed">
              {step.detail}
            </div>
            <pre className={`text-[10px] font-mono rounded-lg p-3 bg-[#070d1e] border border-white/5 ${c.text} opacity-80 leading-relaxed whitespace-pre-wrap break-all overflow-x-auto`}>
              {step.code}
            </pre>
            {step.envVars && step.envVars.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {step.envVars.map(v => (
                  <span key={v} className="text-[9px] font-mono bg-slate-800/80 border border-slate-700/50 text-slate-400 px-2 py-0.5 rounded-full">
                    {v}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Field mapping table — partner → SolarPro
const FIELD_MAP = [
  { from: 'metadata.roof_material',    fromLabel: 'roof_material (enum)',     to: 'roof_material',        toLabel: 'Roof Material',        eng: true  },
  { from: 'metadata.rafter_size',      fromLabel: 'rafter_size (string)',     to: 'rafter_spacing_in',    toLabel: 'Rafter Spacing (in)',   eng: true  },
  { from: 'metadata.rafter_spacing',   fromLabel: 'rafter_spacing (string)',  to: 'rafter_spacing_in',    toLabel: 'Rafter Spacing (in)',   eng: true  },
  { from: 'metadata.roof_age_years',   fromLabel: 'roof_age_years (int)',     to: 'roof_age_years',       toLabel: 'Roof Age (yrs)',        eng: false },
  { from: 'metadata.azimuth',          fromLabel: 'azimuth (float)',          to: 'survey_meta JSONB',    toLabel: '[survey_meta only]',    eng: false },
  { from: 'site_address',              fromLabel: 'site_address',             to: 'address',              toLabel: 'Project Address',       eng: false },
  { from: 'latitude / longitude',      fromLabel: 'lat / lng',                to: 'lat / lng',            toLabel: 'GPS Coordinates',       eng: false },
  { from: 'inspector_name',            fromLabel: 'inspector_name',           to: 'inspector_name',       toLabel: 'Inspector Name',        eng: false },
  { from: 'site_name / project_name',  fromLabel: 'site_name',                to: 'projects.name',        toLabel: 'Project Name',          eng: false },
  { from: 'photos[].remote_url',       fromLabel: 'photo remote_url',         to: 'project_files',        toLabel: 'Project Files',         eng: false },
];

function FieldMappingTable() {
  return (
    <div className="rounded-xl border border-slate-700/40 overflow-hidden">
      <div className="grid grid-cols-[1fr_20px_1fr_auto] gap-0 bg-slate-800/40 px-4 py-2">
        <span className="text-[10px] font-semibold text-[#4fd1c5] uppercase tracking-wide">Partner surveys.{'{field}'}</span>
        <span />
        <span className="text-[10px] font-semibold text-cyan-400 uppercase tracking-wide">SolarPro project_physical_data</span>
        <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide text-right">Eng</span>
      </div>
      {FIELD_MAP.map((row, i) => (
        <div key={i} className={`grid grid-cols-[1fr_20px_1fr_auto] gap-0 px-4 py-2 border-t border-slate-800/50 items-center ${row.eng ? 'bg-emerald-500/5' : ''}`}>
          <div>
            <div className="text-[10px] font-mono text-[#4fd1c5]/80">{row.from}</div>
            <div className="text-[9px] text-slate-600">{row.fromLabel}</div>
          </div>
          <ArrowRight size={10} className="text-slate-600 mx-auto" />
          <div>
            <div className="text-[10px] font-mono text-cyan-400/80">{row.to}</div>
            <div className="text-[9px] text-slate-600">{row.toLabel}</div>
          </div>
          <div className="text-right">
            {row.eng
              ? <span className="text-[9px] font-bold text-emerald-400">✓</span>
              : <span className="text-[9px] text-slate-700">—</span>
            }
          </div>
        </div>
      ))}
    </div>
  );
}

function PipelineTopologyView() {
  const [showFieldMap, setShowFieldMap] = useState(false);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#060c1a]">
      {/* Header */}
      <div className="flex-shrink-0 px-5 py-4 border-b border-white/5 bg-[#070d1e]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-white tracking-tight">
              End-to-End Pipeline Topology
            </h2>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Partner Mobile Sync → Backend → Outbound Webhook → SolarPro Ingest → Engineering
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5 flex-shrink-0 mt-0.5">
            {(['mobile', 'backend', 'cloud', 'db', 'integration', 'solarpro', 'engineering', 'blocked'] as ColorKey[]).map(k => (
              <div key={k} className="flex items-center gap-1">
                <div className={`w-2 h-2 rounded-full ${COLOR[k].dot}`} />
                <span className="text-[9px] text-slate-500 capitalize">{k === 'solarpro' ? 'SolarPro' : k === 'blocked' ? 'Not Wired' : k}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Partner app runtime badge */}
        <div className="mt-3 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 bg-[#0d1633] border border-[#7aa2ff]/20 rounded-lg px-3 py-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-[#7aa2ff] animate-pulse" />
            <span className="text-[10px] text-[#7aa2ff] font-mono">{PARTNER_API_URL}</span>
            <span className="text-[9px] text-slate-600">partner runtime</span>
          </div>
          <div className="flex items-center gap-2 bg-[#0d1633] border border-cyan-500/20 rounded-lg px-3 py-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
            <span className="text-[10px] text-cyan-400 font-mono">solar-pro.app</span>
            <span className="text-[9px] text-slate-600">SolarPro runtime</span>
          </div>
          <div className="flex items-center gap-2 bg-[#0d1633] border border-[#f472b6]/20 rounded-lg px-3 py-1.5">
            <span className="text-[9px] text-[#f472b6]">WEBHOOK_PRE_INGEST_ACCEPT_202=true</span>
          </div>
        </div>
      </div>

      {/* Scrollable steps */}
      <div className="flex-1 overflow-y-auto px-5 py-5">

        {/* Steps */}
        {PIPELINE_STEPS.map((step, i) => (
          <PipelineStepCard
            key={step.num}
            step={step}
            isLast={i === PIPELINE_STEPS.length - 1}
          />
        ))}

        {/* Field Mapping Table */}
        <div className="mt-2 mb-4">
          <button
            onClick={() => setShowFieldMap(v => !v)}
            className="flex items-center gap-2 w-full mb-3 group"
          >
            <div className="flex items-center gap-2 flex-1">
              <Link2 size={13} className="text-cyan-400" />
              <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-widest">
                Field Mapping: Partner → SolarPro
              </span>
              <span className="text-[9px] bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 px-1.5 py-0.5 rounded-full">
                {FIELD_MAP.filter(r => r.eng).length} feed engineering
              </span>
            </div>
            {showFieldMap
              ? <ChevronDown size={13} className="text-slate-500" />
              : <ChevronRight size={13} className="text-slate-500" />
            }
          </button>
          {showFieldMap && <FieldMappingTable />}
        </div>

        {/* Summary verdict */}
        <div className="rounded-xl border border-slate-700/40 bg-[#0a1020] p-4 mb-4">
          <h4 className="text-xs font-bold text-white mb-3 uppercase tracking-wide">Connection Audit Summary</h4>
          <div className="space-y-2">
            {[
              { label: 'Partner mobile → Partner backend', status: 'LIVE', color: 'text-emerald-400' },
              { label: 'Partner backend → webhook_deliveries queue', status: 'LIVE', color: 'text-emerald-400' },
              { label: 'Outbound delivery worker (30s interval)', status: 'LIVE', color: 'text-emerald-400' },
              { label: 'HMAC-SHA256 signing (timestamp.rawBody)', status: 'LIVE', color: 'text-emerald-400' },
              { label: 'SolarPro webhook receiver + HMAC verify', status: 'LIVE', color: 'text-emerald-400' },
              { label: 'Full payload fetch from partner API', status: 'LIVE', color: 'text-emerald-400' },
              { label: 'Transform → project_physical_data upsert', status: 'LIVE', color: 'text-emerald-400' },
              { label: 'Engineering report reads 4/20 fields', status: 'PARTIAL', color: 'text-amber-400' },
              { label: 'SystemDefinition / CAD / Permit / Proposal', status: 'NOT WIRED', color: 'text-slate-500' },
            ].map((row, i) => (
              <div key={i} className="flex items-center justify-between">
                <span className="text-[11px] text-slate-400">{row.label}</span>
                <span className={`text-[9px] font-bold ${row.color}`}>{row.status}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Partner topology link */}
        <div className="rounded-xl border border-[#7aa2ff]/20 bg-[#7aa2ff]/5 p-3 mb-2">
          <p className="text-[10px] text-[#7aa2ff] font-semibold mb-1">Partner App Pipeline Topology</p>
          <p className="text-[10px] text-slate-500 leading-relaxed">
            The partner app ships its own pipeline visualization at <span className="font-mono text-[#7aa2ff]/70">PIPELINE_TOPOLOGY.html</span> (root of repo).
            It covers steps 1–7 (Mobile → Backend → Queue → Delivery → Pre-Ingest Handshake).
            This view extends that with SolarPro steps 8–11.
          </p>
        </div>

      </div>
    </div>
  );
}

// ===========================================================================
// LIVE SURVEY DATA VIEW — Force Ingest + Display
// ===========================================================================

interface IngestedPhoto {
  project_id: string;
  file_url:   string;
  file_name:  string;
  notes:      string | null;
  file_type:  string;
  created_at: string;
}

interface IngestedProject {
  id:               string;
  name:             string;
  address:          string | null;
  lat:              number | null;
  lng:              number | null;
  status:           string;
  user_id:          string | null;
  survey_external_id: string | null;
  created_at:       string;
  photo_count:      number;
  roof_material:    string | null;
  site_address:     string | null;
  ppd_lat:          number | null;
  ppd_lng:          number | null;
  mounting_notes:   string | null;
  structural_notes: string | null;
  source:           string | null;
  photos:           IngestedPhoto[];
  // F-06: Ownership routing
  survey_meta:      Record<string, unknown> | null;
  owner_email:      string | null;
  owner_name:       string | null;
}

interface IngestResponse {
  success:          boolean;
  surveysProcessed?: number;
  photosProcessed?:  number;
  results?:          Array<{
    surveyId:    string;
    siteName:    string;
    address:     string | null;
    action:      'created' | 'updated' | 'skipped';
    projectId:   string | null;
    photosAdded: number;
    error?:      string;
  }>;
  error?: string;
}

interface GetResponse {
  success:  boolean;
  count?:   number;
  projects?: IngestedProject[];
  error?:   string;
}

function LiveSurveyDataView() {
  const [projects, setProjects]       = useState<IngestedProject[]>([]);
  const [loadState, setLoadState]     = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const [ingestState, setIngestState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [loadError, setLoadError]     = useState<string | null>(null);
  const [ingestResult, setIngestResult] = useState<IngestResponse | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [fixingAll, setFixingAll]     = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [fixAllResult, setFixAllResult] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoadState('loading');
    setLoadError(null);
    try {
      const res = await fetch('/api/debug/force-ingest');
      const json = await res.json() as GetResponse;
      if (!json.success) {
        setLoadError(json.error ?? 'Failed to load');
        setLoadState('error');
      } else {
        setProjects(json.projects ?? []);
        setLoadState('loaded');
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Network error');
      setLoadState('error');
    }
  }, []);

  const runIngest = useCallback(async () => {
    setIngestState('running');
    setIngestResult(null);
    try {
      const res = await fetch('/api/debug/force-ingest', { method: 'POST' });
      const json = await res.json() as IngestResponse;
      setIngestResult(json);
      setIngestState(json.success ? 'done' : 'error');
      if (json.success) {
        await loadData();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error';
      setIngestResult({ success: false, error: msg });
      setIngestState('error');
    }
  }, [loadData]);

  useEffect(() => { loadData(); }, [loadData]);

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#060c1a]">

      {/* Header */}
      <div className="flex-shrink-0 px-5 py-4 border-b border-white/5 bg-[#070d1e]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
              <Download size={15} className="text-emerald-400" />
              Live Survey Data
            </h2>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Force ingest from partner DB — supplement live webhook data
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={loadData}
              disabled={loadState === 'loading'}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 hover:border-slate-600 text-xs text-slate-300 hover:text-white transition-all disabled:opacity-50"
            >
              <RefreshCw size={11} className={loadState === 'loading' ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button
              onClick={runIngest}
              disabled={ingestState === 'running'}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 hover:bg-emerald-500/25 text-xs font-semibold text-emerald-400 transition-all disabled:opacity-50"
            >
              {ingestState === 'running' ? (
                <>
                  <RefreshCw size={11} className="animate-spin" />
                  Ingesting…
                </>
              ) : (
                <>
                  <Download size={11} />
                  Force Ingest
                </>
              )}
            </button>
          </div>
        </div>

        {ingestResult && (
          <div className={`mt-3 rounded-lg border px-3 py-2 text-[11px] ${
            ingestResult.success
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
              : 'bg-red-500/10 border-red-500/30 text-red-400'
          }`}>
            {ingestResult.success ? (
              <span>
                ✓ Ingested {ingestResult.surveysProcessed} surveys · {ingestResult.photosProcessed} photos
                {ingestResult.results && (
                  <span className="ml-2 text-emerald-400/70">
                    ({ingestResult.results.filter(r => r.action === 'created').length} new,{' '}
                    {ingestResult.results.filter(r => r.action === 'updated').length} updated)
                  </span>
                )}
              </span>
            ) : (
              <span>✗ {ingestResult.error}</span>
            )}
          </div>
        )}

        
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-4">

        {loadState === 'idle' || loadState === 'loading' ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <div className="w-8 h-8 rounded-full border-2 border-slate-700 border-t-emerald-400 animate-spin" />
            <p className="text-xs text-slate-500">Loading ingested surveys…</p>
          </div>
        ) : loadState === 'error' ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3 text-center">
            <AlertTriangle size={20} className="text-red-400" />
            <p className="text-sm font-semibold text-red-400">Failed to load</p>
            <p className="text-xs text-slate-500 font-mono">{loadError}</p>
            <button
              onClick={loadData}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-300 hover:border-slate-600 transition-all"
            >
              <RefreshCw size={11} /> Retry
            </button>
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3 text-center">
            <div className="w-12 h-12 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center">
              <Database size={20} className="text-slate-500" />
            </div>
            <p className="text-sm font-semibold text-slate-400">No surveys ingested yet</p>
            <p className="text-xs text-slate-500 max-w-[260px] leading-relaxed">
              Click <span className="text-emerald-400 font-semibold">Force Ingest</span> to pull all 11 partner surveys directly from their PostgreSQL database.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Summary bar */}
            <div className="flex items-center gap-4 px-3 py-2 rounded-lg bg-slate-800/40 border border-slate-700/40">
              <div className="text-center">
                <div className="text-lg font-bold text-white">{projects.length}</div>
                <div className="text-[9px] text-slate-500 uppercase tracking-wide">Surveys</div>
              </div>
              <div className="w-px h-8 bg-slate-700" />
              <div className="text-center">
                <div className="text-lg font-bold text-emerald-400">
                  {projects.reduce((s, p) => s + Number(p.photo_count), 0)}
                </div>
                <div className="text-[9px] text-slate-500 uppercase tracking-wide">Photos</div>
              </div>
              <div className="w-px h-8 bg-slate-700" />
              <div className="text-center">
                <div className="text-lg font-bold text-cyan-400">
                  {projects.filter(p => p.ppd_lat != null).length}
                </div>
                <div className="text-[9px] text-slate-500 uppercase tracking-wide">With GPS</div>
              </div>
              <div className="flex-1" />
              <span className="text-[10px] text-emerald-400/70 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                origin=survey
              </span>
              {/* v58.20: bulk-fix all surveys owned by fallback default user */}
              <button
                disabled={fixingAll === 'running'}
                className="text-[10px] px-2.5 py-1 rounded-md bg-blue-600/20 border border-blue-500/30 text-blue-400 hover:bg-blue-600/30 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={async () => {
                  if (!confirm('Reassign ALL surveys currently owned by the fallback default user to their correct owners (based on solarpro_user_id claim)?\n\nThis will update all affected projects at once.')) return;
                  setFixingAll('running');
                  setFixAllResult(null);
                  try {
                    const res = await fetch('/api/admin/survey-reassign', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ action: 'fix-all-defaults' }),
                    });
                    const data = await res.json();
                    if (data.success) {
                      const msg = `✓ Fixed ${data.fixed} / ${data.total} surveys`;
                      setFixAllResult(msg);
                      setFixingAll('done');
                      await loadData();
                    } else {
                      setFixAllResult(`⚠ ${data.error}`);
                      setFixingAll('error');
                    }
                  } catch (e) {
                    setFixAllResult('Network error — check console');
                    setFixingAll('error');
                    console.error(e);
                  }
                }}
              >
                {fixingAll === 'running' ? '⏳ Fixing…' : '⟳ Fix All Defaults'}
              </button>
              {fixAllResult && (
                <span className={`text-[10px] font-medium ${fixingAll === 'done' ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {fixAllResult}
                </span>
              )}
            </div>

            {projects.map((project) => {
              const isExpanded = expandedIds.has(project.id);
              const photoCount = Number(project.photo_count);

              return (
                <div
                  key={project.id}
                  className="rounded-xl border border-slate-700/50 bg-slate-900/50 overflow-hidden"
                >
                  <button
                    className="w-full text-left px-4 py-3 flex items-start justify-between gap-3 hover:bg-slate-800/30 transition-colors"
                    onClick={() => toggleExpand(project.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-sm font-semibold text-white truncate">
                          {project.name}
                        </span>
                        {photoCount > 0 && (
                          <span className="flex items-center gap-1 text-[9px] bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 px-1.5 py-0.5 rounded-full flex-shrink-0">
                            <Camera size={8} />
                            {photoCount} photo{photoCount !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>

                      {(project.site_address ?? project.address) && (
                        <div className="flex items-center gap-1 text-[11px] text-slate-400 truncate">
                          <MapPin size={9} className="flex-shrink-0" />
                          {project.site_address ?? project.address}
                        </div>
                      )}

                      <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                        {project.ppd_lat != null && project.ppd_lng != null && (
                          <span className="text-[10px] font-mono text-slate-500">
                            {Number(project.ppd_lat).toFixed(4)}, {Number(project.ppd_lng).toFixed(4)}
                          </span>
                        )}
                        {project.roof_material && (
                          <span className="text-[10px] text-slate-500">
                            {project.roof_material}
                          </span>
                        )}
                        {project.mounting_notes && (
                          <span className="text-[10px] text-slate-500 truncate max-w-[200px]">
                            {project.mounting_notes}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-[9px] font-mono text-slate-600">
                        {project.id.slice(0, 8)}…
                      </span>
                      {isExpanded
                        ? <ChevronDown size={12} className="text-slate-500" />
                        : <ChevronRight size={12} className="text-slate-500" />
                      }
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-slate-800/60 px-4 py-3 space-y-3">

                      {/* F-06: Ownership badge + Fix Owner button */}
                      {(() => {
                        const meta = project.survey_meta as Record<string, unknown> | null;
                        const ownerSource = (meta?.owner_source as string) ?? null;
                        const solarproUserId = (meta?.solarpro_user_id as string) ?? null;
                        const solarproProjectId = (meta?.solarpro_project_id as string) ?? null;
                        const isDefault = ownerSource === 'default' || (!ownerSource && !solarproUserId);
                        return (
                          <div className="space-y-1.5">
                            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[10px] font-medium ${
                              isDefault
                                ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                                : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                            }`}>
                              <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isDefault ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                              {isDefault ? (
                                <span>⚠ Fallback Owner Used — no handoff JWT claim present</span>
                              ) : (
                                <span>✓ Owner Resolved from Handoff JWT — solarpro_user_id: <span className="font-mono opacity-80">{(solarproUserId ?? '').slice(0, 8)}…</span></span>
                              )}
                              {solarproProjectId && (
                                <span className="opacity-60 ml-1">project: <span className="font-mono">{solarproProjectId.slice(0, 8)}…</span></span>
                              )}
                            </div>
                            {/* v58.20: Fix Owner button — shown when survey_meta has a solarpro_user_id claim
                                 but the project is currently owned by the fallback default user. */}
                            {isDefault && solarproUserId && (
                              <button
                                className="text-[10px] px-3 py-1 rounded-md bg-blue-600/20 border border-blue-500/30 text-blue-400 hover:bg-blue-600/30 transition-colors font-medium"
                                onClick={async () => {
                                  if (!confirm(`Reassign this survey to solarpro_user_id:\n${solarproUserId}\n\nThis will change the project owner. Proceed?`)) return;
                                  try {
                                    const res = await fetch('/api/admin/survey-reassign', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ action: 'fix-one', projectId: project.id }),
                                    });
                                    const data = await res.json();
                                    if (data.success) {
                                      alert(`✓ Reassigned to ${data.newOwnerEmail ?? data.newOwnerId}`);
                                      loadData();
                                    } else {
                                      alert(`⚠ Fix failed: ${data.error}`);
                                    }
                                  } catch (e) {
                                    alert('Network error — check console');
                                    console.error(e);
                                  }
                                }}
                              >
                                → Fix Owner (assign to solarpro_user_id claim)
                              </button>
                            )}
                          </div>
                        );
                      })()}

                      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                        {[
                          { label: 'Project ID',    value: project.id },
                          { label: 'Survey UUID',   value: project.survey_external_id },
                          { label: 'Status',        value: project.status },
                          { label: 'Source',        value: project.source },
                          { label: 'Owner',         value: project.owner_email ?? project.user_id ?? null },
                          { label: 'Owner Source',  value: (project.survey_meta?.owner_source as string) ?? 'default' },
                          { label: 'Roof Material', value: project.roof_material },
                          { label: 'Mounting',      value: project.mounting_notes },
                          { label: 'Notes',         value: project.structural_notes },
                          { label: 'Ingested',      value: project.created_at ? fmtDate(project.created_at) : null },
                        ].filter(r => r.value).map((row, i) => (
                          <div key={i} className="min-w-0">
                            <div className="text-[9px] uppercase tracking-wide text-slate-600 font-semibold">{row.label}</div>
                            <div className={`text-[10px] font-mono truncate ${
                              row.label === 'Owner Source' && row.value === 'default'
                                ? 'text-amber-400'
                                : row.label === 'Owner Source' && row.value === 'claim'
                                ? 'text-emerald-400'
                                : 'text-slate-300'
                            }`} title={row.value ?? ''}>
                              {row.value}
                            </div>
                          </div>
                        ))}
                      </div>

                      {project.photos && project.photos.length > 0 ? (
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <Image size={11} className="text-cyan-400" />
                            <span className="text-[10px] font-semibold text-slate-300 uppercase tracking-wide">
                              Photos ({project.photos.length})
                            </span>
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            {project.photos.map((photo, pi) => (
                              <div key={pi} className="relative group">
                                <a
                                  href={photo.file_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title={photo.file_name}
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={photo.file_url}
                                    alt={photo.notes ?? photo.file_name}
                                    className="w-full aspect-square object-cover rounded-lg border border-slate-700/50 group-hover:border-cyan-500/50 transition-all bg-slate-800"
                                    loading="lazy"
                                    onError={(e) => {
                                      const el = e.currentTarget;
                                      el.style.display = 'none';
                                      const fallback = el.nextElementSibling as HTMLElement | null;
                                      if (fallback) fallback.style.display = 'flex';
                                    }}
                                  />
                                  <div className="hidden w-full aspect-square rounded-lg border border-slate-700/50 bg-slate-800 items-center justify-center">
                                    <Camera size={16} className="text-slate-600" />
                                  </div>
                                </a>
                                {photo.notes && (
                                  <div className="mt-1 text-[9px] text-slate-500 truncate">{photo.notes}</div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : photoCount > 0 ? (
                        <div className="flex items-center gap-2 text-[10px] text-slate-500">
                          <Camera size={10} />
                          {photoCount} photo(s) attached — expand to load
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-[10px] text-slate-600">
                          <Camera size={10} />
                          No photos for this survey
                        </div>
                      )}

                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ===========================================================================
// Main Page Component
// ===========================================================================

type LeftTab = 'map' | 'pipeline' | 'partner' | 'surveys';

export default function AdminTopography() {
  const iframeRef                         = useRef<HTMLIFrameElement>(null);
  const [iframeLoading, setIframeLoading] = useState(true);
  const [iframeError, setIframeError]     = useState(false);
  const [lastLoaded, setLastLoaded]       = useState<Date | null>(null);
  const [refreshKey, setRefreshKey]       = useState(0);
  const [leftTab, setLeftTab]             = useState<LeftTab>('map');
  const [partnerRefreshKey, setPartnerRefreshKey] = useState(0);

  const [projectId, setProjectId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('projectId') ?? null;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (projectId) {
      url.searchParams.set('projectId', projectId);
    } else {
      url.searchParams.delete('projectId');
    }
    window.history.replaceState(null, '', url.toString());
  }, [projectId]);

  const iframeSrc = TOPO_URL;

  const handleLoad = useCallback(() => {
    setIframeLoading(false);
    setIframeError(false);
    setLastLoaded(new Date());
  }, []);

  const handleError = useCallback(() => {
    setIframeLoading(false);
    setIframeError(true);
  }, []);

  const handleRefresh = useCallback(() => {
    setIframeLoading(true);
    setIframeError(false);
    setRefreshKey((k) => k + 1);
  }, []);

  const fmtTime = (d: Date) =>
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div className="-m-8 flex flex-col" style={{ height: 'calc(100vh - 49px)' }}>

      {/* ── Top bar ── */}
      <div className="flex items-center justify-between px-6 py-3 bg-[#0d1424] border-b border-white/5 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <Layers size={15} className="text-amber-400" />
          <span className="text-sm font-semibold text-white">Topography</span>

          {/* Left tab toggle */}
          <div className="flex items-center gap-0.5 ml-2 bg-slate-800/60 border border-slate-700/50 rounded-lg p-0.5">
            <button
              onClick={() => setLeftTab('map')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
                leftTab === 'map'
                  ? 'bg-slate-700 text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <Map size={10} />
              Map
            </button>
            <button
              onClick={() => setLeftTab('pipeline')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
                leftTab === 'pipeline'
                  ? 'bg-slate-700 text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <Network size={10} />
              Pipeline
            </button>
            <button
              onClick={() => setLeftTab('partner')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
                leftTab === 'partner'
                  ? 'bg-[#4fd1c5]/20 text-[#4fd1c5] shadow-sm'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <Smartphone size={10} />
              Partner
            </button>
            <button
              onClick={() => setLeftTab('surveys')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
                leftTab === 'surveys'
                  ? 'bg-emerald-500/20 text-emerald-400 shadow-sm'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <Download size={10} />
              Surveys
            </button>
          </div>

          {/* Map status (only when map tab active) */}
          {leftTab === 'map' && (
            <>
              {iframeLoading && (
                <span className="flex items-center gap-1.5 text-[10px] text-slate-500">
                  <div className="w-3 h-3 border border-slate-600 border-t-amber-400 rounded-full animate-spin" />
                  Loading…
                </span>
              )}
              {!iframeLoading && !iframeError && (
                <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-medium">
                  Live
                </span>
              )}
              {iframeError && (
                <span className="flex items-center gap-1 text-[10px] text-red-400">
                  <AlertTriangle size={10} /> Map failed
                </span>
              )}
            </>
          )}

          {/* Pipeline badge */}
          {leftTab === 'pipeline' && (
            <span className="flex items-center gap-1 text-[10px] bg-[#f472b6]/10 text-[#f472b6] border border-[#f472b6]/20 px-2 py-0.5 rounded-full font-medium">
              <Network size={9} />
              11 Steps · Partner + SolarPro
            </span>
          )}
          {/* Partner badge */}
          {leftTab === 'partner' && (
            <span className="flex items-center gap-1 text-[10px] bg-[#4fd1c5]/10 text-[#4fd1c5] border border-[#4fd1c5]/20 px-2 py-0.5 rounded-full font-medium">
              <Smartphone size={9} />
              Partner App — Unified Topology
            </span>
          )}
          {/* Surveys badge */}
          {leftTab === 'surveys' && (
            <span className="flex items-center gap-1 text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-medium">
              <Download size={9} />
              Live Survey Data — Force Ingest
            </span>
          )}

          <span className="text-slate-700">|</span>

          {projectId ? (
            <span className="flex items-center gap-1 text-[10px] bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 px-2 py-0.5 rounded-full font-medium">
              <GitBranch size={9} />
              Audit Active
            </span>
          ) : (
            <span className="text-[10px] text-slate-500">
              Select project for audit →
            </span>
          )}
        </div>

        <div className="flex items-center gap-4">
          {leftTab === 'map' && lastLoaded && !iframeError && (
            <span className="flex items-center gap-1.5 text-[10px] text-slate-500">
              <Clock size={10} />
              {fmtTime(lastLoaded)}
            </span>
          )}
          {leftTab === 'map' && (
            <button
              onClick={handleRefresh}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 hover:border-slate-600 text-xs text-slate-300 hover:text-white transition-all"
            >
              <RefreshCw size={12} className={iframeLoading ? 'animate-spin' : ''} />
              Refresh Map
            </button>
          )}
          {leftTab === 'partner' && (
            <button
              onClick={() => setPartnerRefreshKey(k => k + 1)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 hover:border-slate-600 text-xs text-slate-300 hover:text-white transition-all"
            >
              <RefreshCw size={12} />
              Refresh
            </button>
          )}
        </div>
      </div>

      {/* ── Split layout ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── LEFT: Map iframe OR Pipeline topology ── */}
        <div className="relative flex-1 overflow-hidden">

          {/* MAP TAB */}
          <div className={`absolute inset-0 transition-opacity duration-200 ${leftTab === 'map' ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
            <div className="relative w-full h-full bg-[#0a0f1e]">
              {iframeLoading && leftTab === 'map' && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-[#0a0f1e]">
                  <div className="w-10 h-10 border-2 border-slate-700 border-t-amber-400 rounded-full animate-spin" />
                  <p className="text-slate-400 text-sm">Loading topography map…</p>
                </div>
              )}
              {iframeError && leftTab === 'map' && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-[#0a0f1e]">
                  <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                    <AlertTriangle size={20} className="text-red-400" />
                  </div>
                  <div className="text-center">
                    <p className="text-white font-semibold text-sm mb-1">Map failed to load</p>
                    <p className="text-slate-500 text-xs mb-4">
                      The topography site may be temporarily unavailable.
                    </p>
                    <button
                      onClick={handleRefresh}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 hover:border-slate-600 text-xs text-slate-300 hover:text-white transition-all mx-auto"
                    >
                      <RefreshCw size={12} /> Try Again
                    </button>
                  </div>
                </div>
              )}
              <iframe
                key={refreshKey}
                ref={iframeRef}
                src={iframeSrc}
                className="w-full h-full border-0"
                onLoad={handleLoad}
                onError={handleError}
                title="SolarPro Topography Map"
                allow="fullscreen"
              />
            </div>
          </div>

          {/* PIPELINE TAB */}
          <div className={`absolute inset-0 transition-opacity duration-200 ${leftTab === 'pipeline' ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
            <PipelineTopologyView />
          </div>

          {/* PARTNER TAB — partner-pipeline-topology.html served from /public */}
          <div className={`absolute inset-0 transition-opacity duration-200 ${leftTab === 'partner' ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
            <div className="relative w-full h-full bg-[#060816]">
              <iframe
                key={`partner-${partnerRefreshKey}`}
                src="/partner-pipeline-topology.html"
                className="w-full h-full border-0"
                title="Partner App — Unified Pipeline Topology"
                allow="fullscreen"
              />
            </div>
          </div>

          {/* SURVEYS TAB — Live Survey Data / Force Ingest */}
          <div className={`absolute inset-0 transition-opacity duration-200 ${leftTab === 'surveys' ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
            <LiveSurveyDataView />
          </div>

        </div>

        {/* ── RIGHT: Integration Panel (unchanged) ── */}
        <div
          className="w-[340px] flex-shrink-0 border-l border-slate-800/80 bg-[#0a0f1c] overflow-hidden flex flex-col"
          style={{ minWidth: '280px', maxWidth: '400px' }}
        >
          <IntegrationPanel
            projectId={projectId}
            onProjectChange={(id) => setProjectId(id || null)}
          />
        </div>

      </div>
    </div>
  );
}