// ============================================================================
// app/admin/topography/page.tsx  — v3: Unified Pipeline Topology + Live Audit
//
// Split layout:
//   LEFT  — tab toggle: "Map" (canonical architecture) | "Pipeline" (evidence detail)
//           | "Legacy" (external iframe reference) | "Partner" | "Surveys"
//   RIGHT — System Integration Panel (live audit, unchanged from v2)
//
// Map and Pipeline tabs show the canonical SolarPro architecture map:
//   Homeowner Intake → Bill Intelligence → Lead Ops → Marketplace
//   → Contractor Claim → Project/Portal/Engineering, plus Survey → 3D
//   → Engineering documents.
//
// Evidence-backed nodes and edges are shown with route/API/table/library
// references, explicit partial/external/blocked status, and copy/export context.
//
// Data source: GET /api/topography/state?projectId=XXX
// If no projectId is provided, right panel shows a project selector prompt.
//
// RULES:
//   - legacy iframe src is preserved (same TOPO_URL) but no longer the default map
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
  ArrowRight, ChevronRight as Arrow, ExternalLink,
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
// PIPELINE TOPOLOGY VIEW — canonical SolarPro architecture map
// ===========================================================================

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
type ArchitectureStatus = 'live' | 'partial' | 'external' | 'legacy' | 'blocked';

interface ArchitectureNode {
  id: string;
  group: string;
  title: string;
  detail: string;
  evidence: string[];
  tables?: string[];
  status: ArchitectureStatus;
  layer: ColorKey;
}

interface ArchitectureEdge {
  from: string;
  to: string;
  label: string;
  status: ArchitectureStatus;
}

const ARCHITECTURE_NODES: ArchitectureNode[] = [
  { id: 'intake', group: 'Entry & Intake', title: 'Homeowner Intake', detail: 'Public review-first estimate funnel persists homeowner submissions without immediately creating marketplace inventory.', evidence: ['/free-solar-estimate', 'POST /api/intake/homeowner', 'lib/intake/homeownerEventIntake.ts'], tables: ['intake_events', 'intake_funnels'], status: 'live', layer: 'solarpro' },
  { id: 'qualification', group: 'Entry & Intake', title: 'Qualification Event', detail: 'Post-submit qualification appends derived intelligence for admin review, scoring, matching, and enrichment.', evidence: ['POST /api/intake/homeowner/qualification'], tables: ['intake_events'], status: 'live', layer: 'solarpro' },
  { id: 'bill', group: 'Bill Intelligence', title: 'Utility Bill Storage + Intelligence', detail: 'Bill attachments use Vercel Blob or local fallback, then OCR/parser/Claude/enrichment/confidence/insights prepare bill intelligence.', evidence: ['/api/bill-upload', '/api/admin/network/intake/bill-intelligence', 'lib/intake/utilityBillAttachment.ts', 'lib/intake/utilityBillIntelligence.ts'], tables: ['project_files', 'projects.bill_data', 'opportunity_intelligence'], status: 'live', layer: 'cloud' },
  { id: 'leadops', group: 'Admin Lead Operations', title: 'Admin Intake Review', detail: 'Admin network control center reviews intake, funnels, enrichment, analytics, health, campaigns, and webhooks before release.', evidence: ['/admin/network', '/api/admin/network/intake', '/api/admin/network/enrichment', '/api/admin/network/health'], tables: ['intake_events', 'enrichment_queue', 'campaign_analytics', 'webhook_ingestion_log'], status: 'live', layer: 'backend' },
  { id: 'marketplace', group: 'Marketplace', title: 'Marketplace Release + Screening', detail: 'Operator release converts approved intake/opportunities into marketplace inventory guarded by screening and release gates.', evidence: ['/api/admin/network/marketplace', 'lib/network/marketplaceInventory.ts', 'lib/network/marketplaceReleaseGate.ts'], tables: ['network_opportunities', 'opportunity_screening_queue', 'opportunity_sources'], status: 'live', layer: 'integration' },
  { id: 'intelligence', group: 'Marketplace', title: 'Opportunity Intelligence + Revenue Projection', detail: 'Marketplace intelligence, enrichment, matching, and revenue projection annotate and prioritize opportunities.', evidence: ['lib/network/marketplaceIntelligence.ts', 'lib/network/marketplaceRevenueProjection.ts', 'lib/network/contractorMatcher.ts'], tables: ['opportunity_intelligence', 'opportunity_assignments', 'network_events'], status: 'live', layer: 'integration' },
  { id: 'contractor', group: 'Contractor Network', title: 'Discovery + Claim', detail: 'Contractors discover live opportunities, maintain profiles, claim jobs, and view assigned/claimed inventory.', evidence: ['/network', '/api/network/opportunities', '/api/network/opportunities/[id]/claim', '/api/network/contractor-profile'], tables: ['contractor_profiles', 'opportunity_claims', 'opportunity_assignments', 'network_opportunities'], status: 'live', layer: 'mobile' },
  { id: 'portal', group: 'Homeowner Portal', title: 'OTP Portal + Dashboard', detail: 'Homeowners access project dashboard, stage state, bill upload, files, proposals, and logout flows.', evidence: ['/portal/dashboard', '/api/portal/dashboard', '/api/portal/bill-upload', '/api/portal/logout'], tables: ['portal_otp_tokens', 'projects', 'project_homeowner_stage_history', 'project_micro_stages'], status: 'live', layer: 'solarpro' },
  { id: 'core', group: 'Core Project/CRM', title: 'Clients, Projects, Layouts, Files, Proposals', detail: 'Canonical CRM/project layer backing project creation, design state, generated artifacts, proposal outputs, and portal surfaces.', evidence: ['/projects', '/proposals', '/api/projects', '/api/project-files', '/api/proposals'], tables: ['clients', 'projects', 'layouts', 'project_files', 'proposals', 'proposal_signatures'], status: 'live', layer: 'db' },
  { id: 'survey', group: 'Survey & Physical Data', title: 'Survey Ingest + project_physical_data', detail: 'Partner/mobile and SolarPro survey paths normalize field data, webhook events, photos, and physical/electrical facts.', evidence: ['/api/auth/authorize', '/api/webhooks/survey-complete', '/api/survey/submit', 'lib/survey/ingest/ingestPipeline.ts'], tables: ['site_surveys', 'site_survey_files', 'project_physical_data', 'webhook_deliveries', 'webhook_ingestion_log'], status: 'live', layer: 'mobile' },
  { id: 'survey-partial', group: 'Survey & Physical Data', title: 'Survey → Engineering Consumption', detail: 'Engineering report reads 4/20 physical-data fields; SystemDefinition/CAD/Permit/Proposal auto-application has source files but no production callers.', evidence: ['lib/topography/getTopographyState.ts', 'lib/engineering/reportGenerator.ts', 'lib/siteSurvey/applyToSystemDefinition.ts', 'lib/siteSurvey/permitIntegration.ts'], tables: ['project_physical_data', 'project_files'], status: 'partial', layer: 'blocked' },
  { id: 'engineering', group: 'Engineering & Documents', title: 'Engineering, SLD, BOM, Permit, Plan Set', detail: 'Engineering APIs calculate topology, BOM, SLD/PDF, permit, plan-set, PVWatts, structural output, sync, and saved artifacts.', evidence: ['/engineering', '/api/engineering/topology', '/api/engineering/bom', '/api/engineering/sld', '/api/engineering/permit', '/api/engineering/plan-set', '/api/engineering/pvwatts'], tables: ['engineering_runs', 'project_hardware', 'project_files', 'productions'], status: 'live', layer: 'engineering' },
  { id: 'maps3d', group: '3D / Maps / Solar Design', title: 'Maps, 3D, Solar Placement', detail: 'Map/session/solar design surfaces and dependencies support visual placement and layout persistence; external iframe remains static/external.', evidence: ['/api/maps-session', '/api/solar', 'Mapbox/Cesium/Three dependencies', TOPO_URL], tables: ['layouts', 'projects'], status: 'partial', layer: 'cloud' },
  { id: 'equipment', group: 'Equipment / Pricing / Utility', title: 'Equipment Registry + Pricing + Utility Policy', detail: 'Equipment registries, user equipment tables, distributor pricing, utility policies, and pricing config feed design, SLD/BOM, and proposal logic.', evidence: ['lib/topology-manager.ts', 'lib/equipment-registry-v4.ts', 'lib/proposal/buildCanonicalProposal.ts'], tables: ['user_equipment_panels', 'user_equipment_inverters', 'user_equipment_batteries', 'user_equipment_mounting', 'distributor_prices', 'utility_policies', 'pricing_config'], status: 'live', layer: 'backend' },
  { id: 'health', group: 'Health / Logging', title: 'Admin Health, Events, Logs', detail: 'Operational visibility comes through admin health, analytics, network events, webhook ingestion logs, and admin activity logs.', evidence: ['/api/admin/network/health', '/api/admin/network/analytics', '/api/admin/network/webhooks'], tables: ['network_events', 'webhook_ingestion_log', 'admin_activity_log', 'campaign_analytics'], status: 'live', layer: 'db' },
  { id: 'external', group: 'External Services', title: 'External AI, Storage, Maps, Payments, Email', detail: 'External integrations appear in source/dependencies and should be marked external rather than treated as SolarPro-owned database systems.', evidence: ['Vercel Blob', 'Claude/OpenAI/OCR hints', 'Google Maps/Solar', 'NREL/PVWATTS', 'Stripe', 'Resend', PARTNER_API_URL], status: 'external', layer: 'cloud' },
];

const ARCHITECTURE_EDGES: ArchitectureEdge[] = [
  { from: 'intake', to: 'qualification', label: 'homeowner submission → qualification lifecycle event', status: 'live' },
  { from: 'qualification', to: 'bill', label: 'bill attachment/intelligence can enrich intake and opportunity context', status: 'live' },
  { from: 'bill', to: 'leadops', label: 'operator-triggered bill intelligence for admin review', status: 'live' },
  { from: 'leadops', to: 'marketplace', label: 'reviewed intake/opportunity → release gate', status: 'live' },
  { from: 'marketplace', to: 'intelligence', label: 'screening, matching, enrichment, projection', status: 'live' },
  { from: 'intelligence', to: 'contractor', label: 'live opportunity discovery and claim', status: 'live' },
  { from: 'contractor', to: 'core', label: 'claims/assignments connect marketplace to project operations', status: 'live' },
  { from: 'portal', to: 'core', label: 'homeowner dashboard reads project, files, proposals, stage state', status: 'live' },
  { from: 'survey', to: 'core', label: 'survey ingest creates/attaches projects and files', status: 'live' },
  { from: 'survey', to: 'survey-partial', label: 'physical data feeds engineering report only partially', status: 'partial' },
  { from: 'survey-partial', to: 'engineering', label: '4/20 survey fields used by engineering report', status: 'partial' },
  { from: 'core', to: 'engineering', label: 'project/layout/equipment → documents and calculations', status: 'live' },
  { from: 'maps3d', to: 'core', label: 'layout and visual design state persists to projects/layouts', status: 'partial' },
  { from: 'equipment', to: 'engineering', label: 'equipment registry resolves topology, accessories, BOM/SLD stages', status: 'live' },
  { from: 'engineering', to: 'portal', label: 'generated artifacts/proposals become portal-visible project outputs', status: 'partial' },
  { from: 'health', to: 'leadops', label: 'events/logs/health inform admin operations', status: 'live' },
  { from: 'external', to: 'bill', label: 'AI/OCR/storage services support bill intelligence', status: 'external' },
  { from: 'external', to: 'maps3d', label: 'maps/solar/PVWATTS providers support design calculations', status: 'external' },
];

function architectureStatusBadge(status: ArchitectureStatus) {
  const cls = status === 'live' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : status === 'partial' ? 'bg-amber-500/15 text-amber-400 border-amber-500/30' : status === 'external' ? 'bg-[#c084fc]/10 text-[#c084fc] border-[#c084fc]/30' : status === 'legacy' ? 'bg-slate-700/60 text-slate-400 border-slate-600/30' : 'bg-red-500/10 text-red-400 border-red-500/30';
  return <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${cls}`}>{status.toUpperCase()}</span>;
}

function buildTopologyExportText() {
  return [
    'SolarPro Canonical Topology Snapshot',
    'Evidence source: Admin Topography audit, app/admin/topography/page.tsx, route/API inventory, migrations, and pipeline library excerpts.',
    '',
    'Nodes:',
    ...ARCHITECTURE_NODES.map(n => `- [${n.status}] ${n.group} / ${n.title}: ${n.detail} Evidence: ${n.evidence.join('; ')}${n.tables ? ` Tables: ${n.tables.join(', ')}` : ''}`),
    '',
    'Edges:',
    ...ARCHITECTURE_EDGES.map(e => `- [${e.status}] ${e.from} -> ${e.to}: ${e.label}`),
    '',
    'Known partial/stale items: external iframe is static; partner map is legacy/reference; survey-to-engineering consumes 4/20 physical fields; SystemDefinition/CAD/Permit/Proposal survey auto-application has source files but no production callers.',
  ].join('\n');
}

function ArchitectureNodeCard({ node }: { node: ArchitectureNode }) {
  const [expanded, setExpanded] = useState(false);
  const c = COLOR[node.layer];
  return (
    <div className={`rounded-xl border ${c.border} ${c.bg} overflow-hidden`}>
      <button className="w-full text-left px-4 py-3 flex items-start justify-between gap-3" onClick={() => setExpanded(v => !v)}>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`text-[9px] font-semibold uppercase tracking-widest ${c.text} opacity-75`}>{node.group}</span>
            {architectureStatusBadge(node.status)}
          </div>
          <div className={`text-sm font-semibold ${c.text}`}>{node.title}</div>
          <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">{node.detail}</p>
        </div>
        {expanded ? <ChevronDown size={13} className="text-slate-500" /> : <ChevronRight size={13} className="text-slate-500" />}
      </button>
      {expanded && (
        <div className="px-4 pb-4 border-t border-white/5 pt-3 space-y-3">
          <div>
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Evidence</p>
            <div className="flex flex-wrap gap-1.5">{node.evidence.map(x => <span key={x} className="text-[9px] font-mono bg-[#070d1e] border border-white/5 text-slate-300 px-2 py-0.5 rounded-full">{x}</span>)}</div>
          </div>
          {node.tables && <div><p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">DB Tables / Fields</p><p className="text-[10px] font-mono text-[#fbbf24]/90 leading-relaxed">{node.tables.join(' · ')}</p></div>}
        </div>
      )}
    </div>
  );
}

function ArchitectureEdgesView() {
  return (
    <div className="rounded-xl border border-slate-700/40 bg-[#0a1020] p-4">
      <h4 className="text-xs font-bold text-white mb-3 uppercase tracking-wide">Canonical Data Flow Edges</h4>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
        {ARCHITECTURE_EDGES.map((edge, i) => (
          <div key={`${edge.from}-${edge.to}-${i}`} className="flex items-center justify-between gap-3 rounded-lg border border-slate-800/80 bg-[#070d1e] px-3 py-2">
            <div className="min-w-0">
              <div className="text-[10px] font-mono text-slate-300 truncate">{edge.from} <span className="text-cyan-400">→</span> {edge.to}</div>
              <div className="text-[10px] text-slate-500 truncate">{edge.label}</div>
            </div>
            {architectureStatusBadge(edge.status)}
          </div>
        ))}
      </div>
    </div>
  );
}

function ArchitectureMapView({ onOpenLegacy }: { onOpenLegacy: () => void }) {
  const columns: Array<{ title: string; nodeIds: string[] }> = [
    { title: 'Acquire', nodeIds: ['intake', 'qualification', 'bill'] },
    { title: 'Operate', nodeIds: ['leadops', 'marketplace', 'intelligence'] },
    { title: 'Fulfill', nodeIds: ['contractor', 'core', 'portal'] },
    { title: 'Design', nodeIds: ['survey', 'survey-partial', 'maps3d'] },
    { title: 'Generate', nodeIds: ['equipment', 'engineering'] },
    { title: 'Observe', nodeIds: ['health', 'external'] },
  ];

  const nodeById: Record<string, ArchitectureNode> = Object.fromEntries(ARCHITECTURE_NODES.map(node => [node.id, node]));
  const primaryFlow = ['intake', 'qualification', 'bill', 'leadops', 'marketplace', 'intelligence', 'contractor', 'core', 'engineering', 'portal'];
  const secondaryFlow = ['survey', 'survey-partial', 'maps3d', 'core', 'engineering'];

  return (
    <div className="h-full overflow-y-auto bg-[#050a17] text-slate-100">
      <div className="min-h-full p-5 xl:p-6">
        <div className="mb-5 rounded-2xl border border-cyan-500/20 bg-gradient-to-r from-cyan-500/10 via-[#7aa2ff]/10 to-[#f472b6]/10 p-4 shadow-[0_0_30px_rgba(34,211,238,0.08)]">
          <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-9 h-9 rounded-xl bg-cyan-500/15 border border-cyan-400/30 flex items-center justify-center">
                  <Network size={17} className="text-cyan-300" />
                </div>
                <div>
                  <h2 className="text-lg font-black text-white tracking-tight">SolarPro Mission Control Topography</h2>
                  <p className="text-[11px] text-cyan-100/70">Canonical architecture map generated from audited routes, APIs, migrations, and libraries.</p>
                </div>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed max-w-4xl">
                Homeowner Intake → Bill Intelligence → Lead Operations → Marketplace Release → Contractor Claim → Core Project/Portal/Engineering, with Survey, 3D/Maps, Equipment, Health, and External Services marked by verified wiring status.
              </p>
            </div>
            <button
              onClick={onOpenLegacy}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-700 bg-slate-900/70 hover:border-slate-500 text-[11px] text-slate-300 hover:text-white transition-all"
            >
              <ExternalLink size={12} /> Legacy iframe reference
            </button>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {(['live', 'partial', 'external', 'legacy', 'blocked'] as ArchitectureStatus[]).map(s => <div key={s}>{architectureStatusBadge(s)}</div>)}
            <span className="text-[10px] text-slate-500">{ARCHITECTURE_NODES.length} nodes · {ARCHITECTURE_EDGES.length} audited edges · default map replaces stale external-only diagram</span>
          </div>
        </div>

        <div className="grid grid-cols-1 2xl:grid-cols-6 xl:grid-cols-3 gap-3 mb-5">
          {columns.map((column) => (
            <section key={column.title} className="rounded-2xl border border-slate-800/80 bg-[#081024] p-3 min-h-[260px]">
              <h3 className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 mb-3">{column.title}</h3>
              <div className="space-y-3">
                {column.nodeIds.map((id) => {
                  const node = nodeById[id];
                  const c = COLOR[node.layer];
                  return (
                    <div key={node.id} className={`relative rounded-xl border ${c.border} ${c.bg} p-3 shadow-sm`}>
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div className={`text-[11px] font-bold leading-snug ${c.text}`}>{node.title}</div>
                        {architectureStatusBadge(node.status)}
                      </div>
                      <p className="text-[10px] text-slate-400 leading-relaxed line-clamp-3">{node.detail}</p>
                      {node.tables && (
                        <p className="mt-2 text-[9px] font-mono text-[#fbbf24]/80 truncate">{node.tables.slice(0, 3).join(' · ')}{node.tables.length > 3 ? ' · …' : ''}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-5">
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
            <h3 className="text-xs font-bold text-emerald-300 uppercase tracking-wide mb-3">Primary Revenue / Operations Flow</h3>
            <div className="flex flex-wrap items-center gap-2">
              {primaryFlow.map((id, i) => (
                <React.Fragment key={id}>
                  <span className="px-2.5 py-1 rounded-lg bg-[#07111f] border border-emerald-500/20 text-[10px] text-emerald-100">{nodeById[id].title}</span>
                  {i < primaryFlow.length - 1 && <ArrowRight size={12} className="text-emerald-500/70" />}
                </React.Fragment>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
            <h3 className="text-xs font-bold text-amber-300 uppercase tracking-wide mb-3">Survey / Design / Engineering Flow</h3>
            <div className="flex flex-wrap items-center gap-2">
              {secondaryFlow.map((id, i) => (
                <React.Fragment key={id}>
                  <span className="px-2.5 py-1 rounded-lg bg-[#07111f] border border-amber-500/20 text-[10px] text-amber-100">{nodeById[id].title}</span>
                  {i < secondaryFlow.length - 1 && <ArrowRight size={12} className="text-amber-500/70" />}
                </React.Fragment>
              ))}
            </div>
            <p className="mt-3 text-[10px] text-amber-200/70">Survey → engineering remains explicitly partial: engineering report consumes 4/20 physical-data fields; survey auto-apply to SystemDefinition/CAD/Permit/Proposal is not production-wired.</p>
          </div>
        </div>

        <ArchitectureEdgesView />
      </div>
    </div>
  );
}

function PipelineTopologyView() {
  const [copied, setCopied] = useState(false);
  const copyTopology = async () => {
    const text = buildTopologyExportText();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('Copy SolarPro topology context:', text);
    }
  };

  const groups = Array.from(new Set(ARCHITECTURE_NODES.map(n => n.group)));

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#060c1a]">
      <div className="flex-shrink-0 px-5 py-4 border-b border-white/5 bg-[#070d1e]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-white tracking-tight">Canonical SolarPro Architecture Topology</h2>
            <p className="text-[11px] text-slate-400 mt-0.5">Homeowner Intake → Bill Intelligence → Lead Ops → Marketplace → Contractor Claim → Project/Portal/Engineering, plus Survey → 3D → Engineering documents.</p>
          </div>
          <button onClick={copyTopology} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30 hover:border-cyan-400/60 text-xs text-cyan-300 hover:text-white transition-all">
            <FileText size={12} /> {copied ? 'Copied' : 'Copy for ChatGPT'}
          </button>
        </div>
        <div className="mt-3 flex items-center gap-3 flex-wrap">
          {(['live', 'partial', 'external', 'legacy', 'blocked'] as ArchitectureStatus[]).map(s => <div key={s}>{architectureStatusBadge(s)}</div>)}
          <span className="text-[10px] text-slate-600">Nodes: {ARCHITECTURE_NODES.length} · Edges: {ARCHITECTURE_EDGES.length} · Evidence-backed audit model</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
          <p className="text-[11px] text-amber-200 leading-relaxed"><span className="font-bold">Audit note:</span> this replaces the stale survey-only pipeline as the canonical Mission Control map. The original map iframe, partner reference tab, surveys/debug tab, and live right-side project integration panel are preserved. Partial and external systems are marked explicitly rather than promoted to live.</p>
        </div>

        {groups.map(group => (
          <section key={group} className="space-y-3">
            <h3 className="text-[11px] font-bold text-slate-300 uppercase tracking-widest flex items-center gap-2"><GitBranch size={12} className="text-cyan-400" />{group}</h3>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              {ARCHITECTURE_NODES.filter(n => n.group === group).map(node => <ArchitectureNodeCard key={node.id} node={node} />)}
            </div>
          </section>
        ))}

        <ArchitectureEdgesView />

        <div className="rounded-xl border border-slate-700/40 bg-[#0a1020] p-4 mb-4">
          <h4 className="text-xs font-bold text-white mb-3 uppercase tracking-wide">Connection Audit Summary</h4>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
            {[
              ['Homeowner intake → intake_events', 'LIVE', 'text-emerald-400'],
              ['Bill intelligence → OCR/parser/AI/enrichment', 'LIVE', 'text-emerald-400'],
              ['Admin review → marketplace release gate', 'LIVE', 'text-emerald-400'],
              ['Marketplace → contractor discovery/claim', 'LIVE', 'text-emerald-400'],
              ['Portal → project/files/proposals/stages', 'LIVE', 'text-emerald-400'],
              ['Survey ingest → project_physical_data', 'LIVE', 'text-emerald-400'],
              ['Engineering topology/BOM/SLD/permit/plan-set', 'LIVE', 'text-emerald-400'],
              ['Survey data → engineering report fields', 'PARTIAL 4/20', 'text-amber-400'],
              ['Survey auto-apply → SystemDefinition/CAD/Permit/Proposal', 'NOT WIRED', 'text-slate-500'],
              ['External iframe and partner map', 'EXTERNAL/REFERENCE', 'text-[#c084fc]'],
            ].map(([label, status, color]) => (
              <div key={label} className="flex items-center justify-between gap-3"><span className="text-[11px] text-slate-400">{label}</span><span className={`text-[9px] font-bold ${color}`}>{status}</span></div>
            ))}
          </div>
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
  code?:             string;   // e.g. 'PARTNER_DB_NOT_CONFIGURED'
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
  const [fixingWebhook, setFixingWebhook]   = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [fixWebhookResult, setFixWebhookResult] = useState<string | null>(null);

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
              <span className="space-y-1">
                <span className="block">✗ {ingestResult.error}</span>
                {ingestResult.code === 'PARTNER_DB_NOT_CONFIGURED' && (
                  <span className="block text-amber-400/80 text-[10px] mt-1">
                    Tip: The partner DB is not reachable from this environment.
                    Use <strong>"⟳ Fix All Defaults"</strong> or{' '}
                    <strong>"⟳ Fix from Webhook Log"</strong> below to reassign
                    existing misowned surveys without needing the partner DB.
                  </span>
                )}
              </span>
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
                      const msg = data.fixed > 0
                        ? `✓ Fixed ${data.fixed} / ${data.total} surveys (scanned ${data.scanned ?? data.total})` 
                        : `– ${data.message ?? `No resolvable surveys found (scanned ${data.scanned ?? 0})`}`;
                      setFixAllResult(msg);
                      setFixingAll(data.fixed > 0 ? 'done' : 'idle');
                      if (data.fixed > 0) await loadData();
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
              {/* v58.20: backfill from webhook_deliveries.raw_body for pre-fix surveys */}
              <button
                disabled={fixingWebhook === 'running'}
                className="text-[10px] px-2.5 py-1 rounded-md bg-violet-600/20 border border-violet-500/30 text-violet-400 hover:bg-violet-600/30 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={async () => {
                  if (!confirm('Scan webhook delivery log and reassign surveys where solarpro_user_id is recorded in the raw webhook body?\n\nThis fixes surveys ingested before the JWT-forwarding fix.')) return;
                  setFixingWebhook('running');
                  setFixWebhookResult(null);
                  try {
                    const res = await fetch('/api/admin/survey-reassign', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ action: 'fix-from-webhook-log' }),
                    });
                    const data = await res.json();
                    if (data.success) {
                      const msg = data.fixed > 0
                        ? `✓ Fixed ${data.fixed} surveys from webhook log`
                        : (data.message ?? '✓ No fixable surveys found in webhook log');
                      setFixWebhookResult(msg);
                      setFixingWebhook('done');
                      if (data.fixed > 0) await loadData();
                    } else {
                      setFixWebhookResult(`⚠ ${data.error}`);
                      setFixingWebhook('error');
                    }
                  } catch (e) {
                    setFixWebhookResult('Network error — check console');
                    setFixingWebhook('error');
                    console.error(e);
                  }
                }}
              >
                {fixingWebhook === 'running' ? '⏳ Scanning…' : '⟳ Fix from Webhook Log'}
              </button>
              {fixWebhookResult && (
                <span className={`text-[10px] font-medium ${fixingWebhook === 'done' ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {fixWebhookResult}
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
                            {/* v58.20: Fix Owner button — shown when survey_meta has a solarpro_user_id claim */}
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
                            {/* v58.20: Manual reassign — always shown for default-owned surveys */}
                            {isDefault && (
                              <button
                                className="text-[10px] px-3 py-1 rounded-md bg-slate-700/60 border border-slate-600/40 text-slate-400 hover:bg-slate-700 hover:text-slate-200 transition-colors font-medium"
                                onClick={async () => {
                                  const email = prompt(
                                    `Manually reassign project "${project.name}" to a SolarPro user.\n` +
                                    `Enter the user's email address:`,
                                  );
                                  if (!email?.trim()) return;
                                  try {
                                    const res = await fetch('/api/admin/survey-reassign', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({
                                        action: 'reassign-to-email',
                                        projectId: project.id,
                                        targetEmail: email.trim(),
                                      }),
                                    });
                                    const data = await res.json();
                                    if (data.success) {
                                      alert(data.alreadyCorrect
                                        ? data.message
                                        : `✓ Reassigned to ${data.newOwnerEmail}`);
                                      loadData();
                                    } else {
                                      alert(`⚠ ${data.error}`);
                                    }
                                  } catch (e) {
                                    alert('Network error — check console');
                                    console.error(e);
                                  }
                                }}
                              >
                                ✎ Reassign to Email…
                              </button>
                            )}
                            {/* Debug Claims - shows what claims are in the webhook log for this survey */}
                            {isDefault && (
                              <button
                                className="text-[10px] px-3 py-1 rounded-md bg-violet-600/20 border border-violet-500/30 text-violet-400 hover:bg-violet-600/30 transition-colors font-medium"
                                onClick={async () => {
                                  try {
                                    const res = await fetch('/api/admin/survey-reassign', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ action: 'debug-claims', projectId: project.id }),
                                    });
                                    const data = await res.json();
                                    if (!data.success) { alert(`⚠ ${data.error}`); return; }
                                    const meta = (data.project.surveyMeta ?? {}) as Record<string,unknown>;
                                    const lines: string[] = [
                                      `Project: ${data.project.name}`,
                                      `survey_meta.solarpro_user_id:    ${meta.solarpro_user_id ?? '(none)'}`,
                                      `survey_meta.solarpro_email:       ${meta.solarpro_email ?? '(none)'}`,
                                      `survey_meta.solarpro_project_id:  ${meta.solarpro_project_id ?? '(none)'}`,
                                      `survey_meta.owner_source:         ${meta.owner_source ?? '(none)'}`,
                                      '',
                                      `Webhook deliveries found: ${data.deliveryCount}`,
                                    ];
                                    (data.webhookDeliveries as Record<string,unknown>[]).forEach((d, i) => {
                                      const c = (d.claims ?? {}) as Record<string,unknown>;
                                      lines.push(`--- Delivery ${i+1} (${d.status}) @ ${d.receivedAt} ---`);
                                      lines.push(`  solarpro_user_id:    ${c.solarpro_user_id ?? '(none)'}`);
                                      lines.push(`  solarpro_email:      ${c.solarpro_email ?? '(none)'}`);
                                      lines.push(`  solarpro_project_id: ${c.solarpro_project_id ?? '(none)'}`);
                                      lines.push('');
                                      lines.push('  --- Partner fields ---');
                                      lines.push(`  project_id:      ${c.project_id ?? '(none)'}`);
                                      lines.push(`  project_name:    ${c.project_name ?? '(none)'}`);
                                      lines.push(`  site_name:       ${c.site_name ?? '(none)'}`);
                                      lines.push(`  inspector_name:  ${c.inspector_name ?? '(none)'}`);
                                      lines.push(`  inspector_email: ${c.inspector_email ?? '(none)'}`);
                                      lines.push(`  user_email:      ${c.user_email ?? '(none)'}`);
                                      lines.push(`  user_id:         ${c.user_id ?? '(none)'}`);
                                      lines.push('');
                                      // Show all remaining fields
                                      const af = (c.allFields ?? {}) as Record<string,unknown>;
                                      const skipKeys = ['solarpro_user_id','solarpro_email','solarpro_project_id','project_id','project_name','site_name','inspector_name','inspector_email','user_email','user_id'];
                                      const afKeys = Object.keys(af).filter(k => !skipKeys.includes(k));
                                      if (afKeys.length > 0) {
                                        lines.push('  --- All other raw_body fields ---');
                                        afKeys.forEach(k => lines.push(`  ${k}: ${af[k] ?? '(none)'}`));
                                      }
                                      lines.push('');
                                    });
                                    if (data.deliveryCount === 0) lines.push('(no webhook_deliveries rows found for this project)');
                                    alert(lines.join('\n'));
                                  } catch (e) {
                                    alert('Network error');
                                    console.error(e);
                                  }
                                }}
                              >
                                ? Debug Claims
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
                          { label: 'Claimed User ID', value: (project.survey_meta?.solarpro_user_id as string) ?? null },
                          { label: 'Owner Fixed',   value: (project.survey_meta?.owner_fixed_by_admin as boolean) ? 'yes — admin fix' : null },
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

type LeftTab = 'map' | 'pipeline' | 'legacy' | 'partner' | 'surveys';

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
              onClick={() => setLeftTab('legacy')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
                leftTab === 'legacy'
                  ? 'bg-[#c084fc]/20 text-[#c084fc] shadow-sm'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <ExternalLink size={10} />
              Legacy
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

          {/* Legacy iframe status (only when legacy tab active) */}
          {leftTab === 'legacy' && (
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
              {ARCHITECTURE_NODES.length} Nodes · {ARCHITECTURE_EDGES.length} Edges
            </span>
          )}
          {/* Legacy badge */}
          {leftTab === 'legacy' && (
            <span className="flex items-center gap-1 text-[10px] bg-[#c084fc]/10 text-[#c084fc] border border-[#c084fc]/20 px-2 py-0.5 rounded-full font-medium">
              <ExternalLink size={9} />
              Legacy external iframe reference
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
          {leftTab === 'legacy' && lastLoaded && !iframeError && (
            <span className="flex items-center gap-1.5 text-[10px] text-slate-500">
              <Clock size={10} />
              {fmtTime(lastLoaded)}
            </span>
          )}
          {leftTab === 'legacy' && (
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

        {/* ── LEFT: Canonical Map, Evidence Pipeline, Legacy iframe, Partner, or Surveys ── */}
        <div className="relative flex-1 overflow-hidden">

          {/* MAP TAB — primary canonical architecture map */}
          <div className={`absolute inset-0 transition-opacity duration-200 ${leftTab === 'map' ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
            <ArchitectureMapView onOpenLegacy={() => setLeftTab('legacy')} />
          </div>


          {/* LEGACY MAP TAB — preserved external iframe reference */}
          <div className={`absolute inset-0 transition-opacity duration-200 ${leftTab === 'legacy' ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
            <div className="relative w-full h-full bg-[#0a0f1e]">
              {iframeLoading && leftTab === 'legacy' && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-[#0a0f1e]">
                  <div className="w-10 h-10 border-2 border-slate-700 border-t-[#c084fc] rounded-full animate-spin" />
                  <p className="text-slate-400 text-sm">Loading legacy external topography iframe…</p>
                </div>
              )}
              {iframeError && leftTab === 'legacy' && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-[#0a0f1e]">
                  <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                    <AlertTriangle size={20} className="text-red-400" />
                  </div>
                  <div className="text-center">
                    <p className="text-white font-semibold text-sm mb-1">Legacy iframe failed to load</p>
                    <p className="text-slate-500 text-xs mb-4">The external topography site may be temporarily unavailable.</p>
                    <button
                      onClick={handleRefresh}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 hover:border-slate-600 text-xs text-slate-300 hover:text-white transition-all mx-auto"
                    >
                      <RefreshCw size={12} /> Try Again
                    </button>
                  </div>
                </div>
              )}
              <div className="absolute top-3 left-3 z-10 rounded-xl border border-[#c084fc]/30 bg-[#070d1e]/90 backdrop-blur px-3 py-2 shadow-lg">
                <p className="text-[10px] font-bold text-[#c084fc] uppercase tracking-wide">Legacy / external reference</p>
                <p className="text-[10px] text-slate-400">Preserved unchanged. Canonical map is now the Map tab.</p>
              </div>
              <iframe
                key={refreshKey}
                ref={iframeRef}
                src={iframeSrc}
                className="w-full h-full border-0"
                onLoad={handleLoad}
                onError={handleError}
                title="SolarPro Legacy External Topography Map"
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