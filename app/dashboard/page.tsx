'use client';
import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import AppShell from '@/components/ui/AppShell';
import { useAppStore } from '@/store/appStore';
import { useUser, isAdminRole } from '@/contexts/UserContext';
import {
  Zap, Users, FolderOpen, FileText, TrendingUp,
  ArrowRight, Plus, DollarSign, ChevronRight,
  Home, Sprout, Fence, CheckCircle,
  Shield, AlertTriangle, Target, Clock,
  Activity, BarChart3, Map, Flame, Radio,
  ArrowUpRight, Send, Wrench, Star,
  Truck, Calendar, MapPin, Sun, Loader2,
  Inbox, Search, PenTool, Eye, EyeOff, UserCheck,
  ChevronDown, ChevronUp, X,
  ClipboardList, Phone, Play,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import BillUploadModal from '@/components/onboarding/BillUploadModal';
import FollowUpModal from '@/components/commands/FollowUpModal';
import ScheduleInstallModal from '@/components/commands/ScheduleInstallModal';
import EngineeringReviewModal from '@/components/commands/EngineeringReviewModal';
import DealDecisionModal from '@/components/deals/DealDecisionModal';
import type { Project, Client } from '@/types';
import type { CommandAction, ProjectScheduleItem } from '@/lib/commands/types';
import {
  STAGE_LABELS,
  STAGE_COLORS,
  STAGE_PHASES,
  PROJECT_PIPELINE,
  stageIndex,
  type PipelineStage,
} from '@/lib/operations/pipeline';
import { nextStage } from '@/lib/operations/pipeline';
import { safeArray, safeStr, safeNum } from '@/lib/utils/safeArray';
import {
  getNextStep,
  getActionItems,
  type UrgencyLevel,
  type ActionItem,
} from '@/lib/operations/getNextStep';
import { getPipelineMetrics } from '@/lib/data/getPipelineMetrics';
import dynamic from 'next/dynamic';

// CrewCalendar is client-only (uses Date APIs) — load without SSR
const CrewCalendar = dynamic(() => import('@/components/crew/CrewCalendar'), { ssr: false });

// ══════════════════════════════════════════════════════════════════
// SECTION A: Dashboard Data Maps & Helpers (preserved exactly)
// ══════════════════════════════════════════════════════════════════

const TYPE_ICONS: Record<string, React.ReactNode> = {
  roof:   <Home   size={13} className="text-amber-400" />,
  ground: <Sprout size={13} className="text-teal-400"  />,
  fence:  <Fence  size={13} className="text-purple-400"/>,
};
const STAGE_CFG: Record<string, { label: string; color: string; bg: string; bar: string; next: string }> = {
  lead:      { label: 'Lead',      color: 'text-slate-300',  bg: 'bg-slate-700/40',   bar: 'bg-slate-500',  next: 'Upload Bill'        },
  design:    { label: 'Design',    color: 'text-blue-300',   bg: 'bg-blue-900/30',    bar: 'bg-blue-500',   next: 'Build System'       },
  proposal:  { label: 'Proposal',  color: 'text-amber-300',  bg: 'bg-amber-900/30',   bar: 'bg-amber-500',  next: 'Send Proposal'      },
  approved:  { label: 'Approved',  color: 'text-green-300',  bg: 'bg-green-900/30',   bar: 'bg-green-500',  next: 'Schedule Install'   },
  installed: { label: 'Installed', color: 'text-emerald-300',bg: 'bg-emerald-900/30', bar: 'bg-emerald-400',next: 'Mark Complete'      },
};

// ── PHASE 1: Canonical status normalizer ────────────────────────────────────
// Maps ANY raw project status string → one of 5 canonical pipeline statuses.
// Both Pipeline Control counts and Kanban use this so they always agree.
// Operations pipeline stages (e.g. 'design_complete', 'permit_submitted') are
// mapped to their corresponding simple status bucket.
const STATUS_CANONICAL = ['lead','design','proposal','approved','installed'] as const;
type CanonicalStatus = typeof STATUS_CANONICAL[number];

function normalizeStatus(raw: string | undefined | null): CanonicalStatus {
  if (!raw) return 'lead';
  const s = raw.toLowerCase().trim();
  // Simple statuses — pass through directly
  if (s === 'lead')      return 'lead';
  if (s === 'design')    return 'design';
  if (s === 'proposal')  return 'proposal';
  if (s === 'approved')  return 'approved';
  if (s === 'installed' || s === 'complete') return 'installed';
  // Ops pipeline stages → canonical bucket
  if (s === 'site_assessment' || s === 'design_complete') return 'design';
  if (s === 'proposal_sent')   return 'proposal';
  if (s === 'contract_signed') return 'approved';
  if (s === 'engineering' || s === 'permit_submitted' || s === 'permit_approved' ||
      s === 'install_scheduled' || s === 'installation' || s === 'inspection' || s === 'pto') return 'approved';
  if (s === 'qualified')       return 'lead';
  return 'lead';
}

function getNextAction(p: Project): { label: string; color: string; href: string } {
  if (p.status === 'lead' && !p.billAnalysis)
    return { label: 'Upload Bill', color: 'text-red-400',    href: `/projects/${p.id}?tab=bill`      };
  if (p.status === 'lead')
    return { label: 'Size System', color: 'text-amber-400',  href: `/projects/${p.id}?tab=system`    };
  if (p.status === 'design' && !p.layout)
    return { label: 'Build System', color: 'text-blue-400',  href: `/design?projectId=${p.id}`       };
  if (p.status === 'design')
    return { label: 'Send Proposal', color: 'text-amber-400', href: `/projects/${p.id}`             };
  if (p.status === 'proposal')
    return { label: 'Follow Up Client', color: 'text-amber-400', href: `/projects/${p.id}`           };
  if (p.status === 'approved')
    return { label: 'Schedule Install', color: 'text-green-400', href: `/projects/${p.id}`           };
  return   { label: 'Mark Complete', color: 'text-emerald-400',   href: `/projects/${p.id}`          };
}

function daysSinceUpdate(p: Project): number {
  const d = p.updatedAt || p.createdAt;
  if (!d) return 0;
  try { return Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86400000)); }
  catch { return 0; }
}

// Real urgency: time-based thresholds, not just status
// proposal > 3 days stale = high | approved > 5 days stale = high
// design with no layout = medium | else low
function getUrgency(p: Project): 'high' | 'medium' | 'low' {
  const days = daysSinceUpdate(p);
  if (p.status === 'proposal' && days > 3) return 'high';
  if (p.status === 'approved' && days > 5) return 'high';
  if (p.status === 'design' && !p.layout) return 'medium';
  return 'low';
}

// ══════════════════════════════════════════════════════════════════
// SECTION B: Dashboard Sub-Components (preserved exactly)
// ══════════════════════════════════════════════════════════════════

// PHASE 3: CommandCard supports optional onCtaClick for real API mutations.
// When onCtaClick is provided, the CTA button fires the mutation AND navigates.
// When not provided, the entire card is a plain Link (existing behaviour preserved).
function CommandCard({
  accentColor, icon, count, label, sub, cta, href, pulse = false, onCtaClick,
}: {
  accentColor: string; icon: React.ReactNode; count: string | number;
  label: string; sub: string; cta: string; href: string; pulse?: boolean;
  onCtaClick?: () => void;
}) {
  const inner = (
    <div
      className="relative overflow-hidden rounded-2xl p-5 transition-all duration-200 hover:-translate-y-1 cursor-pointer"
      style={{
        background: 'var(--bg-card)',
        border: `1px solid ${accentColor}33`,
        boxShadow: `0 0 0 1px ${accentColor}18, var(--shadow-card)`,
      }}
    >
      <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl" style={{ background: accentColor }} />
      <div className="flex items-start justify-between mb-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: `${accentColor}18` }}>
          <span style={{ color: accentColor }}>{icon}</span>
        </div>
        {pulse && (
          <span className="flex h-2 w-2 mt-1">
            <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full opacity-75" style={{ background: accentColor }} />
            <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: accentColor }} />
          </span>
        )}
      </div>
      <div className="text-3xl font-black mb-0.5 leading-none" style={{ color: accentColor }}>{count}</div>
      <div className="text-sm font-bold text-white mb-0.5">{label}</div>
      <div className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>{sub}</div>
      <div className="flex items-center gap-1 text-xs font-semibold group-hover:gap-2 transition-all"
        style={{ color: accentColor }}>
        {cta} <ArrowRight size={12} />
      </div>
    </div>
  );

  if (onCtaClick) {
    return (
      <Link href={href} className="block group" onClick={onCtaClick}>
        {inner}
      </Link>
    );
  }
  return <Link href={href} className="block group">{inner}</Link>;
}

function WorkQueueRow({ project, onAction, onDismiss }: {
  project: Project;
  onAction?: (project: Project, actionLabel: string) => void;
  onDismiss?: (project: Project) => void;
}) {
  const action = getNextAction(project);
  const urgency = getUrgency(project);
  const stage = STAGE_CFG[normalizeStatus(project.status)] || STAGE_CFG.lead;
  // All action buttons open the decision modal — navigate-only actions are handled by the card link
  const isModalAction = !!onAction;

  const handleActionClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isModalAction && onAction) {
      onAction(project, action.label);
    } else {
      window.location.href = action.href;
    }
  };

  // Status-keyed border accent for work queue cards
  const statusAccent: Record<string, string> = {
    lead:      'border-slate-600/50',
    design:    'border-blue-700/40',
    proposal:  'border-amber-700/35',
    approved:  'border-emerald-700/35',
    installed: 'border-green-700/35',
  };
  const canonStatus = normalizeStatus(project.status);
  const accentCls = statusAccent[canonStatus] || statusAccent.lead;

  return (
    <div
      className={`group relative flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 cursor-pointer hover:brightness-105 border ${accentCls}`}
      style={{ background: 'rgba(15,23,42,0.70)' }}
    >
      {/* Status accent stripe */}
      <div className={`absolute left-0 top-0 bottom-0 w-0.5 rounded-l-xl ${stage.bar}`} />

      {/* System type icon */}
      <div className={`w-9 h-9 rounded-xl border flex items-center justify-center flex-shrink-0 ${
        project.systemType === 'roof'   ? 'bg-amber-500/12 border-amber-500/20' :
        project.systemType === 'ground' ? 'bg-teal-500/12 border-teal-500/20'   : 'bg-purple-500/12 border-purple-500/20'
      }`}>
        {TYPE_ICONS[project.systemType]}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Link href={`/projects/${project.id}`}
            className="text-sm font-bold text-white truncate hover:text-amber-400 transition-colors"
            onClick={e => e.stopPropagation()}>{project.name}</Link>
          {urgency === 'high' && (
            <span className="flex items-center gap-0.5 text-[10px] text-amber-300 bg-amber-500/12 border border-amber-500/25 px-1.5 py-0.5 rounded-full font-bold">
              ⚡ Hot
            </span>
          )}
          {project.client?.name && project.clientId && (
            <Link href={`/clients/${project.clientId}`}
              className="text-xs text-slate-500 hover:text-amber-300 transition-colors flex-shrink-0"
              onClick={e => e.stopPropagation()}>
              {project.client.name}
            </Link>
          )}
          {project.client?.name && !project.clientId && (
            <span className="text-xs text-slate-500 flex-shrink-0">{project.client.name}</span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${stage.bg} ${stage.color}`}>{stage.label}</span>
          {project.costEstimate?.netCost ? (
            <span className="text-[10px] text-emerald-400 font-semibold">${project.costEstimate.netCost.toLocaleString()}</span>
          ) : null}
          {project.layout?.systemSizeKw ? (
            <span className="text-[10px] text-amber-400/70 font-semibold">{project.layout.systemSizeKw.toFixed(1)} kW</span>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        <button
          className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all hover:brightness-110 border ${action.color}`}
          style={{
            background: isModalAction ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.04)',
            borderColor: isModalAction ? 'rgba(245,158,11,0.30)' : 'rgba(255,255,255,0.06)',
          }}
          onClick={handleActionClick}>{action.label}</button>
        <button
          className="p-1.5 rounded-lg text-slate-500 hover:text-white transition-colors opacity-0 group-hover:opacity-100"
          style={{ background: 'rgba(255,255,255,0.04)' }}
          onClick={handleActionClick}>
          <ArrowRight size={12} />
        </button>
        {onDismiss && (
          <button
            title="Dismiss from queue"
            className="p-1.5 rounded-lg text-slate-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
            style={{ background: 'rgba(255,255,255,0.04)' }}
            onClick={e => { e.preventDefault(); e.stopPropagation(); onDismiss(project); }}>
            <EyeOff size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

function DealRow({ project, rank }: { project: Project; rank: number }) {
  const stage = STAGE_CFG[project.status] || STAGE_CFG.lead;
  const urgency = getUrgency(project);
  return (
    <Link href={`/projects/${project.id}`} className="block group">
      <div className="flex items-center gap-3 p-3 rounded-xl transition-colors hover:bg-slate-700/30">
        <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0"
          style={{
            background: rank === 1 ? 'rgba(245,158,11,0.2)' : 'var(--bg-subtle)',
            color: rank === 1 ? 'var(--accent-amber)' : 'var(--text-muted)'
          }}>{rank}</div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-white truncate group-hover:text-amber-300 transition-colors">
            {project.client?.name || project.name}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${stage.bg} ${stage.color}`}>{stage.label}</span>
            {urgency === 'high' && (
              <span className="text-xs text-amber-400 font-semibold">● Urgent</span>
            )}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          {project.costEstimate?.netCost ? (
            <div className="text-sm font-black text-white">${(project.costEstimate.netCost / 1000).toFixed(0)}k</div>
          ) : project.layout?.systemSizeKw ? (
            <div className="text-sm font-black text-amber-400">{project.layout.systemSizeKw.toFixed(1)} kW</div>
          ) : (
            <div className="text-xs text-slate-600">No data</div>
          )}
          <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {new Date(project.createdAt).toLocaleDateString()}
          </div>
        </div>
      </div>
    </Link>
  );
}

// ══════════════════════════════════════════════════════════════════
// SECTION C: Operations Pipeline Types & Helpers
// ══════════════════════════════════════════════════════════════════

interface PipelineProject {
  id: string;
  name: string;
  address?: string;
  system_size_kw?: number;
  project_status: PipelineStage;
  install_date?: string;
  crew_assigned?: string;
  client_name?: string;
  updated_at?: string;
  is_stalled?: boolean;
  days_in_stage: number;
}

const STALL_THRESHOLD_DAYS = 5;

const STAGE_ICONS: Record<string, React.ReactNode> = {
  lead: <UserCheck size={14} />, site_assessment: <Search size={14} />,
  design_complete: <PenTool size={14} />, proposal_sent: <Send size={14} />,
  contract_signed: <FileText size={14} />, engineering: <Wrench size={14} />,
  permit_submitted: <Clock size={14} />, permit_approved: <Shield size={14} />,
  install_scheduled: <Calendar size={14} />, installation: <Truck size={14} />,
  inspection: <Eye size={14} />, pto: <Zap size={14} />, complete: <Sun size={14} />,
};

const PHASE_ICONS: Record<string, React.ReactNode> = {
  Sales: <Target size={15} />, 'Pre-Install': <FileText size={15} />,
  Installation: <Truck size={15} />, Done: <CheckCircle size={15} />,
};

const URGENCY_COLORS: Record<UrgencyLevel, { text: string; bg: string; border: string; dot: string }> = {
  red:    { text: '#F87171', bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.25)', dot: '#EF4444' },
  yellow: { text: '#FBBF24', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.25)', dot: '#F59E0B' },
  blue:   { text: '#60A5FA', bg: 'rgba(59,130,246,0.06)', border: 'rgba(59,130,246,0.15)', dot: '#3B82F6' },
  green:  { text: '#4ADE80', bg: 'rgba(34,197,94,0.06)',  border: 'rgba(34,197,94,0.15)',  dot: '#22C55E' },
};

const STATUS_TO_STAGE: Record<string, PipelineStage> = {
  lead: 'lead', design: 'design_complete', proposal: 'proposal_sent',
  approved: 'contract_signed', installed: 'complete',
};

function daysSince(dateStr: string | undefined | null): number {
  if (!dateStr) return 0;
  try { return Math.max(0, Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)); }
  catch { return 0; }
}
function fmtDate(d: string | undefined | null): string {
  if (!d) return '';
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch { return ''; }
}
function fmtDateFull(d: string | undefined | null): string {
  if (!d) return '';
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return ''; }
}

function parsePipelineProject(p: any): PipelineProject | null {
  if (!p || typeof p !== 'object' || !p.id) return null;
  const rawStage = safeStr(p.project_status || STATUS_TO_STAGE[p.status] || p.status, 'lead');
  const projectStatus = rawStage as PipelineStage;
  const updatedAt = p.updated_at || p.updatedAt || undefined;
  const daysInStage = daysSince(updatedAt);
  return {
    id: String(p.id), name: safeStr(p.name, 'Untitled Project'),
    address: p.address || p.site_address || undefined,
    system_size_kw: safeNum(p.system_size_kw ?? p.systemSizeKw ?? p.layout?.systemSizeKw, 0) || undefined,
    project_status: projectStatus, install_date: p.install_date || undefined,
    crew_assigned: p.crew_assigned || undefined,
    client_name: p.client?.name || p.client_name || undefined,
    updated_at: updatedAt,
    is_stalled: daysInStage >= STALL_THRESHOLD_DAYS && projectStatus !== 'lead' && projectStatus !== 'complete',
    days_in_stage: daysInStage,
  };
}

function sortByUrgency(projects: PipelineProject[]): PipelineProject[] {
  return [...projects].sort((a, b) => {
    if (a.is_stalled && !b.is_stalled) return -1;
    if (!a.is_stalled && b.is_stalled) return 1;
    if (b.days_in_stage !== a.days_in_stage) return b.days_in_stage - a.days_in_stage;
    if (a.install_date && b.install_date) return new Date(a.install_date).getTime() - new Date(b.install_date).getTime();
    return 0;
  });
}

// ══════════════════════════════════════════════════════════════════
// SECTION D: Operations Sub-Components
// ══════════════════════════════════════════════════════════════════

function InlineInput({ type, placeholder, defaultValue, onSave, onCancel }: {
  type: 'date' | 'text'; placeholder: string; defaultValue: string;
  onSave: (val: string) => void; onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [val, setVal] = useState(defaultValue);
  useEffect(() => { setTimeout(() => ref.current?.focus(), 50); }, []);
  return (
    <div className="flex items-center gap-1.5 mt-2.5" onClick={e => { e.preventDefault(); e.stopPropagation(); }}>
      <input ref={ref} type={type} value={val} onChange={e => setVal(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onSave(val); } if (e.key === 'Escape') { e.preventDefault(); onCancel(); } }}
        placeholder={placeholder}
        className="flex-1 text-xs rounded-lg px-3 py-2 min-w-0 transition-all focus:ring-2"
        style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--accent-color)', outline: 'none' }} />
      <button onClick={e => { e.preventDefault(); e.stopPropagation(); onSave(val); }}
        className="text-[11px] font-bold px-3 py-2 rounded-lg transition-all hover:brightness-110"
        style={{ background: 'var(--accent-color)', color: '#fff' }}>Save</button>
      <button onClick={e => { e.preventDefault(); e.stopPropagation(); onCancel(); }}
        className="text-[11px] px-2 py-2 rounded-lg" style={{ color: 'var(--text-muted)', background: 'var(--bg-secondary)' }}>
        <X size={13} /></button>
    </div>
  );
}

function OpsProjectCard({ proj, onAdvance, onSaveField, busy }: {
  proj: PipelineProject; onAdvance: (id: string) => void;
  onSaveField: (id: string, field: string, value: string) => void; busy: string | null;
}) {
  const router = useRouter();
  const [inlineAction, setInlineAction] = useState<'schedule' | 'crew' | null>(null);
  const [justUpdated, setJustUpdated] = useState(false);
  const isBusy = busy === proj.id;
  const next = nextStage(proj.project_status);
  const step = getNextStep(proj.project_status, proj.updated_at, !!proj.install_date, !!proj.crew_assigned);
  const uc = URGENCY_COLORS[step.urgency];

  const accentHex = proj.is_stalled ? '#EF4444'
    : proj.project_status === 'complete' ? '#22C55E'
    : STAGE_COLORS[proj.project_status]?.includes('blue') ? '#3B82F6'
    : STAGE_COLORS[proj.project_status]?.includes('indigo') ? '#6366F1'
    : STAGE_COLORS[proj.project_status]?.includes('purple') ? '#A855F7'
    : STAGE_COLORS[proj.project_status]?.includes('amber') ? '#F59E0B'
    : STAGE_COLORS[proj.project_status]?.includes('orange') ? '#F97316'
    : STAGE_COLORS[proj.project_status]?.includes('teal') ? '#14B8A6'
    : STAGE_COLORS[proj.project_status]?.includes('emerald') ? '#10B981'
    : STAGE_COLORS[proj.project_status]?.includes('green') ? '#22C55E' : '#64748B';

  useEffect(() => { if (justUpdated) { const t = setTimeout(() => setJustUpdated(false), 1200); return () => clearTimeout(t); } }, [justUpdated]);

  const handleAdvanceClick = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); onAdvance(proj.id); setJustUpdated(true); };
  const handleSave = (field: string, val: string) => { onSaveField(proj.id, field, val); setInlineAction(null); setJustUpdated(true); };

  return (
    <div className={`relative rounded-2xl transition-all duration-200 overflow-hidden group ${justUpdated ? 'ring-2 ring-green-400/40' : ''}`}
      style={{ background: 'var(--bg-card)',
        border: proj.is_stalled ? '1px solid rgba(239,68,68,0.4)' : `1px solid ${accentHex}25`,
        boxShadow: proj.is_stalled ? '0 0 12px rgba(239,68,68,0.1), var(--shadow-card)' : `0 0 0 1px ${accentHex}10, var(--shadow-card)` }}>
      <div className="absolute top-0 left-0 right-0 h-[2px] rounded-t-2xl" style={{ background: proj.is_stalled ? '#EF4444' : accentHex }} />
      {isBusy && (
        <div className="absolute inset-0 rounded-2xl z-10 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(3px)' }}>
          <Loader2 size={18} className="animate-spin text-white" />
        </div>
      )}
      <div className="p-4 cursor-pointer transition-all duration-200 group-hover:bg-[var(--bg-muted)]/30"
        onClick={() => router.push(`/projects/${proj.id}`)}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            {proj.client_name && <div className="text-[10px] font-bold uppercase tracking-wider mb-0.5" style={{ color: accentHex }}>{proj.client_name}</div>}
            <div className="text-[13px] font-bold leading-tight truncate" style={{ color: 'var(--text-primary)' }}>{proj.name}</div>
          </div>
          <ArrowUpRight size={12} className="flex-shrink-0 mt-0.5 opacity-0 group-hover:opacity-60 transition-opacity" style={{ color: 'var(--text-muted)' }} />
        </div>
        {proj.address && (
          <div className="flex items-center gap-1 mt-1.5">
            <MapPin size={10} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <span className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>{proj.address}</span>
          </div>
        )}
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {proj.system_size_kw && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)' }}><Zap size={9} className="inline mr-0.5 -mt-px" style={{ color: '#F59E0B' }} />{proj.system_size_kw.toFixed(1)} kW</span>}
          {proj.install_date && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: 'rgba(59,130,246,0.1)', color: '#60a5fa' }}><Calendar size={9} className="inline mr-0.5 -mt-px" />{fmtDate(proj.install_date)}</span>}
          {proj.crew_assigned && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: 'rgba(34,197,94,0.1)', color: '#4ade80' }}><Users size={9} className="inline mr-0.5 -mt-px" />{proj.crew_assigned}</span>}
        </div>
        {proj.is_stalled && (
          <div className="mt-2.5 rounded-lg px-2.5 py-2 flex items-start gap-2" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)' }}>
            <AlertTriangle size={12} className="text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-[11px] font-bold text-red-400">{proj.days_in_stage}d NO ACTIVITY</div>
              {proj.updated_at && <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>Last update: {fmtDateFull(proj.updated_at)}</div>}
            </div>
          </div>
        )}
        {proj.project_status !== 'complete' && !proj.is_stalled && (
          <div className="mt-2.5 flex items-start gap-2 text-[11px] leading-snug" style={{ color: uc.text }}>
            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1" style={{ background: uc.dot }} />
            <span>{step.label}</span>
          </div>
        )}
      </div>
      {proj.project_status !== 'complete' && (
        <div className="flex items-center gap-1.5 px-4 pb-3 pt-0" onClick={e => e.stopPropagation()}>
          {next && <button onClick={handleAdvanceClick} disabled={isBusy}
            className="text-[10px] font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 transition-all hover:brightness-110 hover:-translate-y-0.5 disabled:opacity-50"
            style={{ background: accentHex, color: '#fff' }} title={`Move to ${STAGE_LABELS[next]}`}>
            <ArrowRight size={10} /> {step.buttonLabel}
          </button>}
          {!proj.install_date && <button onClick={e => { e.preventDefault(); e.stopPropagation(); setInlineAction(inlineAction === 'schedule' ? null : 'schedule'); }} disabled={isBusy}
            className="text-[10px] font-medium px-2.5 py-1.5 rounded-lg transition-all hover:brightness-110 disabled:opacity-50"
            style={{ background: inlineAction === 'schedule' ? '#3B82F6' : 'var(--bg-muted)', color: inlineAction === 'schedule' ? '#fff' : 'var(--text-secondary)', border: '1px solid var(--border-color)' }}>
            <Calendar size={10} className="inline mr-0.5" /> Schedule
          </button>}
          {proj.install_date && !proj.crew_assigned && <button onClick={e => { e.preventDefault(); e.stopPropagation(); setInlineAction(inlineAction === 'crew' ? null : 'crew'); }} disabled={isBusy}
            className="text-[10px] font-medium px-2.5 py-1.5 rounded-lg transition-all hover:brightness-110 disabled:opacity-50"
            style={{ background: inlineAction === 'crew' ? '#22C55E' : 'var(--bg-muted)', color: inlineAction === 'crew' ? '#fff' : 'var(--text-secondary)', border: '1px solid var(--border-color)' }}>
            <Users size={10} className="inline mr-0.5" /> Assign Crew
          </button>}
          {proj.install_date && proj.crew_assigned && <>
            <button onClick={e => { e.preventDefault(); e.stopPropagation(); setInlineAction(inlineAction === 'schedule' ? null : 'schedule'); }} disabled={isBusy}
              className="text-[10px] font-medium px-2.5 py-1.5 rounded-lg transition-all disabled:opacity-50"
              style={{ background: inlineAction === 'schedule' ? accentHex : 'var(--bg-muted)', color: inlineAction === 'schedule' ? '#fff' : 'var(--text-secondary)', border: '1px solid var(--border-color)' }}>
              <Calendar size={10} className="inline mr-0.5" /> Date
            </button>
            <button onClick={e => { e.preventDefault(); e.stopPropagation(); setInlineAction(inlineAction === 'crew' ? null : 'crew'); }} disabled={isBusy}
              className="text-[10px] font-medium px-2.5 py-1.5 rounded-lg transition-all disabled:opacity-50"
              style={{ background: inlineAction === 'crew' ? accentHex : 'var(--bg-muted)', color: inlineAction === 'crew' ? '#fff' : 'var(--text-secondary)', border: '1px solid var(--border-color)' }}>
              <Users size={10} className="inline mr-0.5" /> Crew
            </button>
          </>}
        </div>
      )}
      {inlineAction === 'schedule' && <div className="px-4 pb-3" onClick={e => e.stopPropagation()}>
        <InlineInput type="date" placeholder="Install date" defaultValue={proj.install_date || ''} onSave={v => handleSave('install_date', v)} onCancel={() => setInlineAction(null)} />
      </div>}
      {inlineAction === 'crew' && <div className="px-4 pb-3" onClick={e => e.stopPropagation()}>
        <InlineInput type="text" placeholder="e.g. Team Alpha" defaultValue={proj.crew_assigned || ''} onSave={v => handleSave('crew_assigned', v)} onCancel={() => setInlineAction(null)} />
      </div>}
    </div>
  );
}

// Maps an action label string to the modal type (or null = navigate)
function actionLabelToModalType(action: string): 'follow_up' | 'schedule_install' | 'engineering_review' | null {
  const a = action.toLowerCase();
  if (a.includes('follow')) return 'follow_up';
  if (a.includes('schedule') || a.includes('install')) return 'schedule_install';
  if (a.includes('engineering') || a.includes('permit')) return 'engineering_review';
  return null;
}

function ActionRequiredStrip({ items, onAction }: {
  items: ActionItem[];
  onAction?: (projectId: string, projectName: string, clientName: string | undefined, modalType: 'follow_up' | 'schedule_install' | 'engineering_review') => void;
}) {
  const router = useRouter();
  const hasUrgent = items.some(i => i.urgency === 'red');
  if (items.length === 0) {
    return (
      <div className="rounded-2xl px-5 py-4 flex items-center gap-3"
        style={{ background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.15)' }}>
        <CheckCircle size={18} className="text-green-400 flex-shrink-0" />
        <div>
          <div className="text-sm font-bold" style={{ color: '#4ADE80' }}>All projects on track</div>
          <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>No urgent actions needed right now.</div>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-2xl overflow-hidden" style={{
      background: hasUrgent ? 'rgba(239,68,68,0.04)' : 'var(--bg-card)',
      border: hasUrgent ? '1px solid rgba(239,68,68,0.2)' : '1px solid var(--border-color)',
      boxShadow: hasUrgent ? '0 0 20px rgba(239,68,68,0.06)' : 'var(--shadow-card)' }}>
      <div className="px-5 py-3 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-color)' }}>
        <AlertTriangle size={15} style={{ color: hasUrgent ? '#EF4444' : '#F59E0B' }} />
        <span className="text-sm font-bold" style={{ color: hasUrgent ? '#F87171' : '#FBBF24' }}>ACTION REQUIRED</span>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
          style={{ background: hasUrgent ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)', color: hasUrgent ? '#EF4444' : '#F59E0B' }}>{items.length}</span>
      </div>
      <div className="divide-y" style={{ borderColor: 'var(--border-color)' }}>
        {items.map((item, i) => {
          const uc = URGENCY_COLORS[item.urgency];
          const handleClick = () => {
            if (onAction) {
              onAction(item.projectId, item.projectName, item.clientName, 'follow_up');
            } else {
              router.push(`/projects/${item.projectId}`);
            }
          };
          return (
            <div key={item.projectId + i}
              className="flex items-center gap-3 px-5 py-3 transition-all hover:brightness-95 group"
              style={{ background: i === 0 && hasUrgent ? 'rgba(239,68,68,0.03)' : 'transparent' }}>
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: uc.dot }} />
              {/* Left side: clickable to open modal */}
              <button onClick={handleClick} className="min-w-0 flex-1 text-left">
                <span className="text-[12px] font-bold truncate block" style={{ color: uc.text }}>{item.action}</span>
                <span className="text-[11px] mt-0.5 truncate block" style={{ color: 'var(--text-muted)' }}>{item.clientName || item.projectName}</span>
              </button>
              {item.daysInStage > 0 && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 tabular-nums"
                style={{ background: uc.bg, color: uc.text, border: `1px solid ${uc.border}` }}>{item.daysInStage}d</span>}
              {/* Act button — always opens modal when onAction available */}
              {onAction ? (
                <button onClick={handleClick}
                  className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg flex-shrink-0 transition-all hover:brightness-110"
                  style={{ background: uc.bg, color: uc.text, border: `1px solid ${uc.border}` }}>
                  Act
                </button>
              ) : (
                <button onClick={() => router.push(`/projects/${item.projectId}`)}
                  className="flex-shrink-0 opacity-0 group-hover:opacity-60 transition-opacity">
                  <ChevronRight size={13} style={{ color: 'var(--text-muted)' }} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// SECTION E: Command Item Row (for TODAY'S COMMANDS)
// ══════════════════════════════════════════════════════════════════

const PRIORITY_CFG: Record<string, { color: string; bg: string; border: string }> = {
  critical: { color: '#EF4444', bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.25)' },
  high:     { color: '#F59E0B', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.25)' },
  medium:   { color: '#3B82F6', bg: 'rgba(59,130,246,0.06)', border: 'rgba(59,130,246,0.15)' },
  low:      { color: '#64748B', bg: 'rgba(100,116,139,0.06)', border: 'rgba(100,116,139,0.15)' },
};

const CMD_TYPE_ICONS: Record<string, React.ReactNode> = {
  follow_up:          <Phone size={14} />,
  schedule_install:   <Calendar size={14} />,
  engineering_review: <Wrench size={14} />,
  permit_followup:    <Shield size={14} />,
  inspection:         <Eye size={14} />,
  custom:             <Target size={14} />,
};

const SCHED_TYPE_ICONS: Record<string, React.ReactNode> = {
  install:    <Truck size={13} />,
  site_visit: <MapPin size={13} />,
  inspection: <Eye size={13} />,
  follow_up:  <Phone size={13} />,
  custom:     <Calendar size={13} />,
};

// ══════════════════════════════════════════════════════════════════
// SECTION F: Main Command Center Page
// ══════════════════════════════════════════════════════════════════

export default function CommandCenter() {
  const [showBillUpload, setShowBillUpload] = useState(false);
  const [pipelineFilter, setPipelineFilter] = useState<string>('all');
  const [opsView, setOpsView] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedPhases, setCollapsedPhases] = useState<Set<string>>(new Set());

  // Operations state
  const [opsProjects, setOpsProjects] = useState<PipelineProject[]>([]);
  const [opsLoading, setOpsLoading] = useState(false);
  const [opsError, setOpsError] = useState<string | null>(null);
  const [busyProject, setBusyProject] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);

  // Command Center execution state
  const [commands, setCommands] = useState<CommandAction[]>([]);
  const [commandsLoading, setCommandsLoading] = useState(false);
  const [schedule, setSchedule] = useState<ProjectScheduleItem[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);

  // Modal state
  // Persist dismissed work-queue IDs to localStorage so they survive page refreshes
  const [dismissedQueueIds, setDismissedQueueIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set<string>();
    try {
      const raw = localStorage.getItem('solarpro:dismissedQueueIds');
      return raw ? new Set<string>(JSON.parse(raw) as string[]) : new Set<string>();
    } catch { return new Set<string>(); }
  });

  // Workflow banner — snoozable for 7 days, NOT permanently dismissed
  // Reads a timestamp; if it's older than 7 days (or absent), shows the banner
  const [showWorkflowBanner, setShowWorkflowBanner] = useState(() => {
    if (typeof window === 'undefined') return true;
    try {
      const snoozedUntil = localStorage.getItem('solarpro:workflowBannerSnoozedUntil');
      if (!snoozedUntil) return true;
      return Date.now() > Number(snoozedUntil);
    } catch { return true; }
  });
  const dismissWorkflowBanner = () => {
    setShowWorkflowBanner(false);
    try {
      // Snooze for 7 days from now
      const until = Date.now() + 7 * 24 * 60 * 60 * 1000;
      localStorage.setItem('solarpro:workflowBannerSnoozedUntil', String(until));
    } catch { /* ignore */ }
  };
  const restoreWorkflowBanner = () => {
    setShowWorkflowBanner(true);
    try { localStorage.removeItem('solarpro:workflowBannerSnoozedUntil'); } catch { /* ignore */ }
  };
  const [activeModal, setActiveModal] = useState<{
    type: 'follow_up' | 'schedule_install' | 'engineering_review';
    commandId?: string;
    projectId: string;
    projectName: string;
    clientName?: string;
  } | null>(null);

  // DealDecisionModal — single decision surface for all stage transitions
  const [decisionModal, setDecisionModal] = useState<{
    projectId: string;
    projectName: string;
    clientName?: string;
    currentStage: string;
  } | null>(null);

  // Dashboard data
  const { user: currentUser } = useUser();
  const isAdmin = isAdminRole(currentUser?.role);
  const projects = useAppStore(s => s.projects);
  const clients = useAppStore(s => s.clients);
  const projectsState = useAppStore(s => s.projectsState);
  const clientsState = useAppStore(s => s.clientsState);
  const loadProjects = useAppStore(s => s.loadProjects);
  const loadClients = useAppStore(s => s.loadClients);
  const dashLoading = (projectsState === 'loading' || clientsState === 'loading') && (projects.length === 0 && clients.length === 0);

  useEffect(() => { loadProjects(true); loadClients(true); }, [loadProjects, loadClients]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t); }, [toast]);

  // Ref so handleModalComplete (defined above fetchOpsProjects) can call it
  const fetchOpsProjRef = useRef<(() => void) | null>(null);

  // Fetch commands & schedule on load
  useEffect(() => {
    fetchCommands();
    fetchSchedule();
  }, []);

  // Auto-generate commands after projects load
  useEffect(() => {
    if (projectsState === 'loaded' && projects.length > 0) {
      fetch('/api/commands/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        .then(() => fetchCommands())
        .catch(() => {});
    }
  }, [projectsState, projects.length]);

  // UNIFIED: When store projects update and ops board is open, re-sync ops projects
  // so Pipeline Control counts and Kanban columns always show the same data.
  // NOTE: opsProjects is NOT auto-synced from sales projects store.
  // It is loaded once via fetchOpsProjects() and updated optimistically on stage changes.
  // Auto-syncing caused stage snap-back because the sales store uses legacy status fields.

  async function fetchCommands() {
    try {
      setCommandsLoading(true);
      const res = await fetch('/api/commands?status=pending&limit=10');
      const data = await res.json();
      setCommands(data?.commands || []);
    } catch { setCommands([]); }
    finally { setCommandsLoading(false); }
  }

  async function fetchSchedule() {
    try {
      setScheduleLoading(true);
      const res = await fetch('/api/schedule?days=14&limit=8');
      const data = await res.json();
      setSchedule(data?.schedule || []);
    } catch { setSchedule([]); }
    finally { setScheduleLoading(false); }
  }

  const handleSnoozeCommand = async (id: string) => {
    try {
      await fetch(`/api/commands/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'snooze', snooze_days: 1 }) });
      setCommands(prev => prev.filter(c => c.id !== id));
      setToast({ msg: 'Snoozed +1 day', type: 'ok' });
    } catch { setToast({ msg: 'Failed to snooze', type: 'err' }); }
  };

  const handleCompleteCommand = async (id: string) => {
    try {
      await fetch(`/api/commands/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'complete' }) });
      setCommands(prev => prev.filter(c => c.id !== id));
      setToast({ msg: 'Action completed ✓', type: 'ok' });
    } catch { setToast({ msg: 'Failed to complete', type: 'err' }); }
  };

  const handleModalComplete = () => {
    setActiveModal(null);
    fetchCommands();
    fetchSchedule();
    setToast({ msg: 'Action completed ✓', type: 'ok' });
  };

  // PHASE 3: Real API mutations for CommandBar CTA buttons.
  // touchProjects — bumps updated_at on the N most-stale projects of a given status.
  // This "resolves" urgency by resetting the stale timer.
  const touchProjects = useCallback(async (status: CanonicalStatus, limit = 3) => {
    const targets = projects
      .filter(p => normalizeStatus(p.status) === status)
      .sort((a, b) => daysSinceUpdate(b) - daysSinceUpdate(a))
      .slice(0, limit);
    if (targets.length === 0) return;
    await Promise.allSettled(
      targets.map(p =>
        fetch(`/api/projects/${p.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notes: p.notes ?? '' }),
        })
      )
    );
    loadProjects(true);
  }, [projects, loadProjects]);

  // ── Decision Engine: open DealDecisionModal for any project surface ──
  // Looks up the project's current ops stage from the store so the
  // modal shows only the decisions valid for that stage.
  const openDecisionModal = useCallback((projectId: string, projectName: string, clientName: string | undefined) => {
    // Check both sales projects and ops projects for current stage
    const salesProj = projects.find(p => p.id === projectId);
    const opsProj = opsProjects.find(p => p.id === projectId);
    const currentStage = opsProj?.project_status || (salesProj as any)?.project_status || salesProj?.status || 'lead';
    setDecisionModal({ projectId, projectName, clientName, currentStage });
  }, [projects, opsProjects]);

  // Legacy alias — keeps TODAY'S COMMANDS modals working (command execution != stage transition)
  const openModalForProject = useCallback((projectId: string, projectName: string, clientName: string | undefined, modalType: 'follow_up' | 'schedule_install' | 'engineering_review') => {
    setActiveModal({ type: modalType, projectId, projectName, clientName });
  }, []);

  const openCommandModal = (cmd: CommandAction) => {
    const modalType = cmd.type === 'follow_up' || cmd.type === 'permit_followup' ? 'follow_up'
      : cmd.type === 'schedule_install' ? 'schedule_install'
      : cmd.type === 'engineering_review' ? 'engineering_review'
      : null;
    if (!modalType) {
      // For custom/inspection — just complete directly
      handleCompleteCommand(cmd.id);
      return;
    }
    setActiveModal({
      type: modalType,
      commandId: cmd.id,
      projectId: cmd.project_id,
      projectName: cmd.project_name || 'Project',
      clientName: cmd.client_name || undefined,
    });
  };

  // Fetch ops projects when ops view toggled on
  useEffect(() => {
    if (opsView && opsProjects.length === 0 && !opsLoading) fetchOpsProjects();
  }, [opsView]);

  async function fetchOpsProjects() {
    // Register in ref so handleModalComplete (defined earlier) can call this
    fetchOpsProjRef.current = fetchOpsProjects;
    // ALWAYS fetch from API — never remap from sales store.
    // The sales store uses legacy 'status' field which does not reflect
    // granular project_status pipeline stages set by update-status API.
    try {
      setOpsLoading(true); setOpsError(null);
      const res = await fetch('/api/operations/projects');
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e?.error || `Server ${res.status}`); }
      const data = await res.json().catch(() => null);
      const rawList = data?.data?.projects ?? data?.projects ?? data?.data ?? (Array.isArray(data) ? data : []);
      setOpsProjects(safeArray(rawList).map(parsePipelineProject).filter((p): p is PipelineProject => p !== null));
    } catch (e: unknown) { setOpsError((e as Error)?.message || 'Failed to load'); setOpsProjects([]); }
    finally { setOpsLoading(false); }
  }

  // ——— Operations Actions ———
  const handleAdvance = useCallback(async (projectId: string) => {
    const proj = opsProjects.find(p => p.id === projectId);
    if (!proj) return;
    const next = nextStage(proj.project_status);
    if (!next) return;
    setBusyProject(projectId);
    try {
      const res = await fetch('/api/projects/update-status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, status: next }) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err?.error || `Failed (${res.status})`); }
      setOpsProjects(prev => prev.map(p => p.id === projectId ? { ...p, project_status: next, updated_at: new Date().toISOString(), is_stalled: false, days_in_stage: 0 } : p));
      // Log activity
      fetch('/api/activity', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId, type: 'stage_change', title: `Moved to ${STAGE_LABELS[next]}`, metadata: { from: proj.project_status, to: next } }) }).catch(() => {});
      setToast({ msg: `Moved to ${STAGE_LABELS[next]}`, type: 'ok' });
    } catch (e: unknown) { setToast({ msg: (e as Error)?.message || 'Failed', type: 'err' }); }
    finally { setBusyProject(null); }
  }, [opsProjects]);

  const handleSaveField = useCallback(async (projectId: string, field: string, value: string) => {
    if (!value?.trim()) { setToast({ msg: 'Please enter a value', type: 'err' }); return; }
    setBusyProject(projectId);
    try {
      const res = await fetch(`/api/projects/${projectId}/operations`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [field]: value.trim() }) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err?.error || `Failed (${res.status})`); }
      setOpsProjects(prev => prev.map(p => p.id === projectId ? { ...p, [field]: value.trim() } : p));
      setToast({ msg: field === 'install_date' ? 'Install scheduled' : 'Crew assigned', type: 'ok' });
    } catch (e: unknown) { setToast({ msg: (e as Error)?.message || 'Failed', type: 'err' }); }
    finally { setBusyProject(null); }
  }, []);

  const togglePhase = useCallback((label: string) => {
    setCollapsedPhases(prev => { const n = new Set(prev); if (n.has(label)) n.delete(label); else n.add(label); return n; });
  }, []);

  // ——— Dashboard Computed (canonical source: getPipelineMetrics) ———
  const pm = getPipelineMetrics(projects);
  const { activeRevenue, stalledRevenue, totalRevenue, proposalCount, approvedCount, criticalCount, conversionRate } = pm;
  const awaitingRevenue = pm.awaitingClose;

  // Dashboard-specific metrics not in canonical function
  const totalKw = projects.reduce((s, p) => s + (p.layout?.systemSizeKw || 0), 0);
  const awaitingCount = projects.filter(p => normalizeStatus(p.status) === 'design' && !p.layout).length;
  const readyToAdvance = projects.filter(p => normalizeStatus(p.status) === 'design' && !!p.layout).length;
  const avgSystemKw = projects.length > 0 ? projects.reduce((s, p) => s + (p.layout?.systemSizeKw || 0), 0) / (projects.filter(p => p.layout?.systemSizeKw).length || 1) : 0;

  // PHASE 2: Pipeline Control counts use normalizeStatus() so ops-stage projects
  // (e.g. design_complete, permit_submitted) are bucketed correctly.
  const statusPipeline = (['lead', 'design', 'proposal', 'approved', 'installed'] as CanonicalStatus[]).map(s => ({
    status: s, count: projects.filter(p => normalizeStatus(p.status) === s).length,
  }));

  const workQueue = useMemo(() => [...projects]
    .filter(p => !dismissedQueueIds.has(p.id))
    .sort((a, b) => {
      const o: Record<CanonicalStatus, number> = { proposal: 0, approved: 1, design: 2, lead: 3, installed: 4 };
      return (o[normalizeStatus(a.status)] ?? 5) - (o[normalizeStatus(b.status)] ?? 5);
    })
    .filter(p => pipelineFilter === 'all' || normalizeStatus(p.status) === pipelineFilter)
    .slice(0, 8), [projects, pipelineFilter, dismissedQueueIds]);

  const highValueDeals = useMemo(() => [...projects]
    .filter(p => normalizeStatus(p.status) !== 'installed')
    .sort((a, b) => (b.costEstimate?.netCost || b.layout?.systemSizeKw || 0) - (a.costEstimate?.netCost || a.layout?.systemSizeKw || 0))
    .slice(0, 5), [projects]);

  // Operations computed
  const opsActionItems = useMemo(() => getActionItems(opsProjects), [opsProjects]);
  const opsFiltered = useMemo(() => {
    if (!searchQuery.trim()) return opsProjects;
    const q = searchQuery.toLowerCase();
    return opsProjects.filter(p => p.name.toLowerCase().includes(q) || (p.client_name || '').toLowerCase().includes(q) || (p.address || '').toLowerCase().includes(q) || (p.crew_assigned || '').toLowerCase().includes(q));
  }, [opsProjects, searchQuery]);
  const opsByStage = useCallback((stage: PipelineStage) => sortByUrgency(opsFiltered.filter(p => p.project_status === stage)), [opsFiltered]);

  const opsStats = useMemo(() => {
    const stalled = opsProjects.filter(p => p.is_stalled);
    return { stalled };
  }, [opsProjects]);

  const greeting = () => { const h = new Date().getHours(); if (h < 12) return 'Good morning'; if (h < 17) return 'Good afternoon'; return 'Good evening'; };

  return (
    <AppShell>
      <div className="p-4 sm:p-6 space-y-6 animate-fade-in" style={{ maxWidth: '1800px' }}>

        {/* ══════════ DASHBOARD COMMAND HEADER ══════════ */}
          <div className="rounded-xl border border-slate-700/60 bg-slate-800/60 p-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full flex items-center gap-1"
                    style={{ background: 'var(--accent-green)', color: '#0f172a' }}>
                    <Radio size={9} className="animate-pulse" /> LIVE
                  </span>
                  {isAdmin && (
                    <Link href="/admin" className="text-xs font-semibold px-2.5 py-0.5 rounded-full flex items-center gap-1"
                      style={{ background: 'rgba(245,158,11,0.15)', color: 'var(--accent-amber)', border: '1px solid rgba(245,158,11,0.3)' }}>
                      <Shield size={9} /> Admin
                    </Link>
                  )}
                  {opsStats.stalled.length > 0 && opsView && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1"
                      style={{ background: 'rgba(239,68,68,0.15)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.3)' }}>
                      <AlertTriangle size={8} /> {opsStats.stalled.length} stalled
                    </span>
                  )}
                </div>
                <h1 className="text-xl lg:text-2xl font-black text-white tracking-tight">
                  {greeting()}{currentUser?.name ? `, ${currentUser.name.split(' ')[0]}` : ''}.
                </h1>
                <p className="text-sm text-slate-400 mt-0.5">
                  {dashLoading ? 'Loading pipeline...' : (
                    criticalCount > 0
                      ? `${criticalCount} deal${criticalCount !== 1 ? 's' : ''} need your attention right now.`
                      : `${projects.length} projects · $${(activeRevenue / 1000).toFixed(0)}k active pipeline`
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Workflow guide restore — only visible when banner is hidden */}
                {!showWorkflowBanner && (
                  <button
                    onClick={restoreWorkflowBanner}
                    title="Show workflow guide"
                    className="w-7 h-7 rounded-lg border border-amber-500/20 bg-amber-500/5 text-amber-600 hover:text-amber-400 hover:bg-amber-500/10 transition-colors flex items-center justify-center flex-shrink-0"
                    aria-label="Show workflow guide"
                  >
                    <Play size={10} className="fill-current ml-0.5" />
                  </button>
                )}
                <button onClick={() => setShowBillUpload(true)}
                  data-tour="bill"
                  className="btn-secondary btn-sm flex items-center gap-1.5">
                  <Flame size={14} className="text-amber-400" /> Upload Bill
                </button>
                <Link href="/projects/new" className="btn-primary btn-sm flex items-center gap-1.5">
                  <Plus size={14} /> New Project
                </Link>
              </div>
            </div>
          </div>

          {/* ══════════ WORKFLOW PROCESS BANNER ══════════ */}
          {showWorkflowBanner && (
            <div className="relative rounded-xl border border-amber-500/20 bg-slate-800/60 px-4 py-3 overflow-hidden">
              <div className="absolute inset-0 bg-amber-500/3 pointer-events-none" />
              {/* Dismiss button — snoozes for 7 days */}
              <button
                onClick={dismissWorkflowBanner}
                title="Hide for 7 days"
                className="absolute top-2.5 right-2.5 text-slate-500 hover:text-slate-300 transition-colors p-0.5 rounded"
                aria-label="Hide workflow guide for 7 days"
              >
                <X size={13} />
              </button>
              {/* Header */}
              <div className="flex items-center gap-2 mb-2.5">
                <Play size={11} className="text-amber-400 fill-amber-400" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-amber-500">SolarPro Workflow</span>
                <span className="text-[10px] text-slate-500">— follow these steps for every project</span>
              </div>
              {/* Steps */}
              <div className="flex items-center gap-0 flex-wrap">
                {[
                  { step: 1, label: 'Bill',        sub: 'Upload & analyze',  href: null,         color: 'amber'  },
                  { step: 2, label: 'System',      sub: 'Size the system',   href: null,         color: 'blue'   },
                  { step: 3, label: 'Design',      sub: 'Layout & 3D',       href: '/design',    color: 'violet' },
                  { step: 4, label: 'Engineering', sub: 'Stamp & permits',   href: null,         color: 'teal'   },
                  { step: 5, label: 'Proposal',    sub: 'Generate & share',  href: null,         color: 'emerald'},
                  { step: 6, label: 'Send',        sub: 'E-sign & close',    href: null,         color: 'green'  },
                ].map(({ step, label, sub, href, color }, i, arr) => {
                  const colorMap: Record<string, { dot: string; text: string; badge: string }> = {
                    amber:   { dot: 'bg-amber-400',   text: 'text-amber-300',   badge: 'bg-amber-500/15 border-amber-500/30'   },
                    blue:    { dot: 'bg-blue-400',    text: 'text-blue-300',    badge: 'bg-blue-500/15 border-blue-500/30'    },
                    violet:  { dot: 'bg-violet-400',  text: 'text-violet-300',  badge: 'bg-violet-500/15 border-violet-500/30' },
                    teal:    { dot: 'bg-teal-400',    text: 'text-teal-300',    badge: 'bg-teal-500/15 border-teal-500/30'    },
                    emerald: { dot: 'bg-emerald-400', text: 'text-emerald-300', badge: 'bg-emerald-500/15 border-emerald-500/30'},
                    green:   { dot: 'bg-green-400',   text: 'text-green-300',   badge: 'bg-green-500/15 border-green-500/30'  },
                  };
                  const c = colorMap[color];
                  const inner = (
                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all ${c.badge} ${href ? 'cursor-pointer hover:brightness-125' : ''}`}>
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black text-slate-900 flex-shrink-0 ${c.dot}`}>
                        {step}
                      </div>
                      <div>
                        <div className={`text-xs font-bold leading-none ${c.text}`}>{label}</div>
                        <div className="text-[9px] text-slate-500 mt-0.5 leading-none">{sub}</div>
                      </div>
                    </div>
                  );
                  return (
                    <React.Fragment key={label}>
                      {href ? (
                        <Link href={href}>{inner}</Link>
                      ) : inner}
                      {i < arr.length - 1 && (
                        <ChevronRight size={12} className="text-slate-600 flex-shrink-0 mx-0.5" />
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          )}

          {/* ══════════ FINANCIAL PRESSURE BAR ══════════ */}
          {!dashLoading && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="relative rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
                  <DollarSign size={15} className="text-emerald-400" />
                </div>
                <div>
                  <div className="text-lg font-black text-emerald-400 tabular-nums">${(activeRevenue / 1000).toFixed(0)}k</div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Active Pipeline</div>
                </div>
              </div>
              <div className={`relative rounded-xl border px-4 py-3 flex items-center gap-3 ${awaitingRevenue > 0 ? 'border-amber-500/20 bg-amber-500/5' : 'border-slate-700/40 bg-slate-800/40'}`}>
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${awaitingRevenue > 0 ? 'bg-amber-500/15' : 'bg-slate-700/40'}`}>
                  <Clock size={15} className={awaitingRevenue > 0 ? 'text-amber-400' : 'text-slate-500'} />
                </div>
                <div>
                  <div className="text-lg font-black tabular-nums" style={{ color: awaitingRevenue > 0 ? '#FBBF24' : 'var(--text-muted)' }}>${(awaitingRevenue / 1000).toFixed(0)}k</div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Awaiting Close</div>
                </div>
              </div>
              <div className={`relative rounded-xl border px-4 py-3 flex items-center gap-3 ${stalledRevenue > 0 ? 'border-red-500/20 bg-red-500/5' : 'border-slate-700/40 bg-slate-800/40'}`}>
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${stalledRevenue > 0 ? 'bg-red-500/15' : 'bg-slate-700/40'}`}>
                  <AlertTriangle size={15} className={stalledRevenue > 0 ? 'text-red-400' : 'text-slate-500'} />
                </div>
                <div>
                  <div className="text-lg font-black tabular-nums" style={{ color: stalledRevenue > 0 ? '#F87171' : 'var(--text-muted)' }}>${(stalledRevenue / 1000).toFixed(0)}k</div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Stalled</div>
                </div>
              </div>
            </div>
          )}

          {/* ═══ TODAY'S COMMANDS ═══ */}
        {!dashLoading && (
          <div className="rounded-2xl overflow-hidden"
            style={{ background: 'var(--bg-card)', border: '1px solid rgba(245,158,11,0.2)' }}>
            <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-color)' }}>
              <div className="flex items-center gap-2">
                <Zap size={15} className="text-amber-400" />
                <span className="text-sm font-bold" style={{ color: '#FBBF24' }}>TODAY'S COMMANDS</span>
                {commands.length > 0 && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{ background: 'rgba(245,158,11,0.15)', color: '#F59E0B' }}>{commands.length}</span>}
              </div>
            </div>
            {commands.length > 0 ? (
              <div className="divide-y" style={{ borderColor: 'var(--border-color)' }}>
                {commands.map((cmd, i) => {
                  const pc = PRIORITY_CFG[cmd.priority] || PRIORITY_CFG.medium;
                  return (
                    <div key={cmd.id}
                      className="flex items-center gap-3 px-5 py-3 group transition-all hover:brightness-95">
                      {/* Priority dot + icon */}
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                        style={{ background: pc.bg, border: `1px solid ${pc.border}` }}>
                        <span style={{ color: pc.color }}>{CMD_TYPE_ICONS[cmd.type] || <Target size={14} />}</span>
                      </div>
                      {/* Content — clickable to open modal */}
                      <button onClick={() => openCommandModal(cmd)} className="flex-1 min-w-0 text-left">
                        <div className="text-[13px] font-bold truncate" style={{ color: 'var(--text-primary)' }}>{cmd.title}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] font-medium truncate" style={{ color: 'var(--text-muted)' }}>{cmd.client_name || cmd.project_name}</span>
                          {cmd.due_date && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
                              style={{ background: pc.bg, color: pc.color, border: `1px solid ${pc.border}` }}>
                              {fmtDate(cmd.due_date)}
                            </span>
                          )}
                        </div>
                      </button>
                      {/* Actions */}
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button onClick={() => openCommandModal(cmd)}
                          className="text-[10px] font-bold px-3 py-1.5 rounded-lg transition-all hover:brightness-110 hover:-translate-y-0.5"
                          style={{ background: pc.color, color: '#fff' }}>
                          <Play size={9} className="inline mr-0.5" /> Execute
                        </button>
                        <button onClick={() => handleCompleteCommand(cmd.id)}
                          className="text-[10px] font-medium px-2 py-1.5 rounded-lg transition-all hover:brightness-110"
                          style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}>
                          <CheckCircle size={10} className="inline mr-0.5" /> Done
                        </button>
                        <button onClick={() => handleSnoozeCommand(cmd.id)}
                          className="text-[10px] font-medium px-2 py-1.5 rounded-lg transition-all hover:brightness-110"
                          style={{ background: 'var(--bg-muted)', color: 'var(--text-muted)', border: '1px solid var(--border-color)' }}>
                          +1d
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="px-5 py-6 text-center">
                {commandsLoading ? (
                  <div className="flex items-center justify-center gap-2">
                    <Loader2 size={14} className="animate-spin text-amber-400" />
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Loading commands...</span>
                  </div>
                ) : (
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    <CheckCircle size={16} className="inline mr-1 text-green-400" />
                    All caught up — no pending actions right now.
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ═══ COMMAND BAR (5 Cards) ═══ */}
        {/* ═══ COMMAND BAR (5 Cards) ═══
            PHASE 3: onCtaClick fires real API mutations (touch updatedAt) so
            urgency counters update after the user acts. Cards still navigate. */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <CommandCard accentColor="#EF4444" icon={<AlertTriangle size={18} />}
            count={dashLoading ? '—' : criticalCount} label="Critical Actions" sub="Needs attention now"
            cta="Resolve Now" href="/projects?status=proposal" pulse={criticalCount > 0}
            onCtaClick={() => {
              // Open Decision Engine for most-stale proposal project
              const target = [...projects].filter(p => normalizeStatus(p.status) === 'proposal')
                .sort((a, b) => daysSinceUpdate(b) - daysSinceUpdate(a))[0];
              if (target) openDecisionModal(target.id, target.name, target.client?.name);
              else touchProjects('proposal');
            }} />
          <CommandCard accentColor="#F59E0B" icon={<Clock size={18} />}
            count={dashLoading ? '—' : awaitingCount} label="Awaiting Design" sub="Follow-up required"
            cta="Follow Up" href="/projects?status=design"
            onCtaClick={() => {
              // Open Decision Engine for most-stale design project
              const target = [...projects].filter(p => normalizeStatus(p.status) === 'design')
                .sort((a, b) => daysSinceUpdate(b) - daysSinceUpdate(a))[0];
              if (target) openDecisionModal(target.id, target.name, target.client?.name);
              else touchProjects('design');
            }} />
          <CommandCard accentColor="#22C55E" icon={<CheckCircle size={18} />}
            count={dashLoading ? '—' : readyToAdvance} label="Ready to Advance" sub="Move forward"
            cta="Advance" href="/projects?status=design"
            onCtaClick={() => {
              // Open Decision Engine for most-stale approved project
              const target = [...projects].filter(p => normalizeStatus(p.status) === 'approved')
                .sort((a, b) => daysSinceUpdate(b) - daysSinceUpdate(a))[0];
              if (target) openDecisionModal(target.id, target.name, target.client?.name);
              else touchProjects('design');
            }} />
          <CommandCard accentColor="#3B82F6" icon={<DollarSign size={18} />}
            count={dashLoading ? '—' : `$${(activeRevenue / 1000).toFixed(0)}k`} label="Pipeline Value" sub="Active revenue"
            cta="View Deals" href="/projects" />
          <CommandCard accentColor="#A855F7" icon={<TrendingUp size={18} />}
            count={dashLoading ? '—' : `${conversionRate}%`} label="Conversion Rate" sub="Proposal-to-close ratio"
            cta="Optimize" href="/projects?status=approved"
            onCtaClick={() => {
              // Open Decision Engine for most-stale approved project
              const target = [...projects].filter(p => normalizeStatus(p.status) === 'approved')
                .sort((a, b) => daysSinceUpdate(b) - daysSinceUpdate(a))[0];
              if (target) openDecisionModal(target.id, target.name, target.client?.name);
              else touchProjects('approved');
            }} />
        </div>

        {/* ═══ UPCOMING SCHEDULE ═══ */}
        {schedule.length > 0 && (
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-3">
              <Calendar size={14} className="text-blue-400" />
              <span className="text-sm font-bold text-white">Upcoming Schedule</span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(59,130,246,0.15)', color: '#60A5FA' }}>{schedule.length}</span>
            </div>
            <div className="space-y-1.5">
              {schedule.map(item => (
                <Link key={item.id} href={`/projects/${item.project_id}`}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors hover:bg-slate-700/20 group">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: 'rgba(59,130,246,0.1)' }}>
                    <span className="text-blue-400">{SCHED_TYPE_ICONS[item.type] || <Calendar size={13} />}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                      {fmtDate(item.date)} — <span className="capitalize">{item.type.replace('_', ' ')}</span>
                    </div>
                    <div className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
                      {item.client_name || item.project_name}
                      {item.crew_name && <span style={{ color: item.crew_color || '#4ade80' }}> · 👷 {item.crew_name}</span>}
                    </div>
                  </div>
                  <ChevronRight size={12} className="opacity-0 group-hover:opacity-50 transition-opacity" style={{ color: 'var(--text-muted)' }} />
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* ═══ PIPELINE CONTROL ═══ */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Activity size={14} className="text-amber-400" />
              <span className="text-sm font-bold text-white">Pipeline Control</span>
              {pipelineFilter !== 'all' && (
                <button onClick={() => setPipelineFilter('all')} className="text-xs text-slate-400 hover:text-white transition-colors">(clear filter ×)</button>
              )}
            </div>
            <Link href="/projects" className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1">All Projects <ChevronRight size={12} /></Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
            {statusPipeline.map(({ status, count }) => {
              const cfg = STAGE_CFG[status];
              const isActive = pipelineFilter === status;
              const pct = projects.length > 0 ? (count / projects.length) * 100 : 0;
              return (
                <button key={status} onClick={() => setPipelineFilter(isActive ? 'all' : status)}
                  className="relative rounded-xl p-3 text-center transition-all duration-150 hover:-translate-y-0.5 group"
                  style={{ background: isActive ? `${cfg.bar}22` : 'var(--bg-muted)', border: isActive ? `1px solid ${cfg.bar}55` : '1px solid var(--border-color)' }}>
                  <div className={`text-xl lg:text-2xl font-black transition-colors ${isActive ? cfg.color : 'text-white'}`}>{count}</div>
                  <div className={`text-xs font-semibold mt-0.5 capitalize ${cfg.color}`}>{status}</div>
                  <div className="mt-2 h-1 rounded-full overflow-hidden" style={{ background: 'var(--bg-subtle)' }}>
                    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: cfg.bar }} />
                  </div>
                </button>
              );
            })}
          </div>
          {projects.length > 0 && (
            <div className="flex gap-0.5 mt-3 h-1 rounded-full overflow-hidden">
              {statusPipeline.map(({ status, count }) => {
                const cfg = STAGE_CFG[status]; const pct = (count / projects.length) * 100;
                return pct > 0 ? <div key={status} className="rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: cfg.bar }} /> : null;
              })}
            </div>
          )}
        </div>

        {/* ═══ WORK QUEUE + HIGH VALUE DEALS ═══ */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 card p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-amber-500/15 flex items-center justify-center"><Zap size={13} className="text-amber-400" /></div>
                <span className="text-sm font-bold text-white">Active Work Queue</span>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: 'rgba(245,158,11,0.1)', color: 'var(--accent-amber)' }}>{workQueue.length}</span>
              </div>
              <Link href="/projects" className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1">All <ChevronRight size={12} /></Link>
            </div>
            {dashLoading ? (
              <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="shimmer h-14 rounded-xl" />)}</div>
            ) : workQueue.length === 0 ? (
              <div className="empty-state py-10">
                <FolderOpen size={36} className="empty-state-icon" />
                <p className="empty-state-text">No active projects yet</p>
                <p className="empty-state-sub">Upload a utility bill to auto-create your first client and project in one step</p>
                <button onClick={() => setShowBillUpload(true)} className="btn-primary mt-3 btn-sm"><Flame size={13} /> Upload Bill & Start Project</button>
                <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
                  Or <Link href="/clients/new" className="text-amber-400 hover:text-amber-300 underline">add a client manually</Link> first, then <Link href="/projects/new" className="text-amber-400 hover:text-amber-300 underline">create a project</Link>
                </p>
              </div>
            ) : (
              <div className="space-y-2">{workQueue.map(p => (
                <WorkQueueRow key={p.id} project={p}
                  onAction={(proj, label) => {
                    // All action buttons open the Decision Engine
                    openDecisionModal(proj.id, proj.name, proj.client?.name);
                  }}
                  onDismiss={proj => {
                    setDismissedQueueIds(prev => {
                      const next = new Set([...prev, proj.id]);
                      try { localStorage.setItem('solarpro:dismissedQueueIds', JSON.stringify([...next])); } catch { /* ignore */ }
                      return next;
                    });
                  }} />
              ))}</div>
            )}
          </div>
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: 'rgba(168,85,247,0.15)' }}><Star size={13} className="text-purple-400" /></div>
                <span className="text-sm font-bold text-white">High Value Projects</span>
              </div>
              <Link href="/projects" className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1">All <ChevronRight size={12} /></Link>
            </div>
            {dashLoading ? (
              <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="shimmer h-12 rounded-lg" />)}</div>
            ) : highValueDeals.length === 0 ? (
              <div className="text-center py-8" style={{ color: 'var(--text-muted)' }}><DollarSign size={28} className="mx-auto mb-2 opacity-30" /><p className="text-sm">No high-value projects yet</p></div>
            ) : (
              <div className="space-y-1">{highValueDeals.map((p, i) => <DealRow key={p.id} project={p} rank={i + 1} />)}</div>
            )}
            {totalRevenue > 0 && (
              <div className="mt-4 pt-3 rounded-xl p-3 text-center" style={{ background: 'var(--bg-muted)', borderTop: '1px solid var(--border-color)' }}>
                <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Total Pipeline</div>
                <div className="text-xl font-black" style={{ color: 'var(--accent-amber)' }}>${(totalRevenue / 1000).toFixed(0)}k</div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{totalKw.toFixed(1)} kW across {projects.length} projects</div>
              </div>
            )}
          </div>
        </div>

        {/* ═══ QUICK INTEL STRIP ═══ */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Total Capacity', value: totalKw >= 1000 ? `${(totalKw/1000).toFixed(1)} MW` : `${totalKw.toFixed(1)} kW`, sub: 'Designed systems', icon: <Zap size={16} />, color: 'var(--accent-amber)', colorBg: 'rgba(245,158,11,0.1)' },
            { label: 'Total Clients', value: clients.length, sub: `${clients.filter(c => projects.some(p => p.clientId === c.id)).length} with projects`, icon: <Users size={16} />, color: 'var(--accent-blue)', colorBg: 'rgba(59,130,246,0.1)' },
            { label: 'Avg System Size', value: `${(isNaN(avgSystemKw) ? 0 : avgSystemKw).toFixed(1)} kW`, sub: 'Per designed project', icon: <BarChart3 size={16} />, color: 'var(--accent-teal)', colorBg: 'rgba(20,184,166,0.1)' },
            { label: 'Deals Closed', value: approvedCount, sub: `${proposalCount} total proposals`, icon: <CheckCircle size={16} />, color: 'var(--accent-green)', colorBg: 'rgba(34,197,94,0.1)' },
          ].map(item => (
            <div key={item.label} className="rounded-xl p-4 transition-all duration-150 hover:-translate-y-0.5"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-card)' }}>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-3" style={{ background: item.colorBg }}>
                <span style={{ color: item.color }}>{item.icon}</span>
              </div>
              <div className="text-xl font-black text-white">{dashLoading ? '—' : item.value}</div>
              <div className="text-xs font-semibold uppercase tracking-wider mt-0.5" style={{ color: 'var(--text-secondary)' }}>{item.label}</div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{item.sub}</div>
            </div>
          ))}
        </div>

        {/* ═══ ACTION BAR ═══ */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <button onClick={() => setShowBillUpload(true)}
            className="flex items-center gap-3 p-4 rounded-xl border transition-all hover:-translate-y-0.5 hover:shadow-lg text-left"
            style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)' }}>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(245,158,11,0.15)' }}>
              <Flame size={16} className="text-amber-400" />
            </div>
            <div><div className="text-sm font-bold text-white">Upload Bill</div><div className="text-xs" style={{ color: 'var(--text-muted)' }}>Auto-create client & project</div></div>
            <ArrowRight size={13} className="ml-auto text-amber-400 opacity-60" />
          </button>
          {[
            { label: 'Add Contact', sub: 'New client', href: '/clients/new', icon: <Users size={16} />, accent: 'var(--accent-blue)', bg: 'rgba(59,130,246,0.08)', border: 'rgba(59,130,246,0.25)' },
            { label: 'Build System', sub: 'Design studio', href: '/design', icon: <Map size={16} />, accent: 'var(--accent-teal)', bg: 'rgba(20,184,166,0.08)', border: 'rgba(20,184,166,0.25)' },
            { label: 'Close Deals', sub: 'View proposals', href: '/proposals', icon: <FileText size={16} />, accent: 'var(--accent-purple)', bg: 'rgba(168,85,247,0.08)', border: 'rgba(168,85,247,0.25)' },
          ].map(a => (
            <Link key={a.label} href={a.href}
              className="flex items-center gap-3 p-4 rounded-xl border transition-all hover:-translate-y-0.5 hover:shadow-lg"
              style={{ background: a.bg, border: `1px solid ${a.border}` }}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${a.accent}22` }}>
                <span style={{ color: a.accent }}>{a.icon}</span>
              </div>
              <div><div className="text-sm font-bold text-white">{a.label}</div><div className="text-xs" style={{ color: 'var(--text-muted)' }}>{a.sub}</div></div>
              <ArrowRight size={13} className="ml-auto opacity-40 text-white" />
            </Link>
          ))}
        </div>

        {/* ═══ CREW CALENDAR ═══ */}
        <div className="card p-4">
          <CrewCalendar />
        </div>

        {/* ═══ OPERATIONS BOARD TOGGLE ═══ */}
        <div className="pt-2">
          <button onClick={() => { setOpsView(!opsView); if (!opsView && opsProjects.length === 0) fetchOpsProjects(); }}
            className="w-full card p-4 flex items-center justify-between transition-all hover:brightness-95 cursor-pointer"
            style={{ border: opsView ? '1px solid rgba(34,197,94,0.3)' : '1px solid var(--border-color)' }}>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl" style={{ background: opsView ? 'rgba(34,197,94,0.15)' : 'var(--bg-muted)' }}>
                <ClipboardList size={18} style={{ color: opsView ? '#4ADE80' : 'var(--text-muted)' }} />
              </div>
              <div className="text-left">
                <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                  Operations Board
                </div>
                <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  {opsView ? 'Kanban pipeline with crew assignments, scheduling, and project tracking' : 'Expand to manage crews, schedules, and project execution'}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {opsProjects.length > 0 && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{ background: 'rgba(34,197,94,0.15)', color: '#4ADE80' }}>
                  {opsProjects.length} projects
                </span>
              )}
              {opsView ? <ChevronUp size={16} style={{ color: 'var(--text-muted)' }} /> : <ChevronDown size={16} style={{ color: 'var(--text-muted)' }} />}
            </div>
          </button>
        </div>

        {/* ═══ OPERATIONS BOARD (expandable) ═══ */}
        {opsView && (
          <div className="space-y-5">
            {/* Action Required */}
            {!opsLoading && opsProjects.length > 0 && (
              <ActionRequiredStrip items={opsActionItems}
                onAction={(projectId, projectName, clientName) =>
                  openDecisionModal(projectId, projectName, clientName)
                } />
            )}

            {/* Search */}
            {!opsLoading && opsProjects.length > 3 && (
              <div className="relative">
                <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search projects, clients, crews..."
                  className="w-full text-sm rounded-xl pl-10 pr-4 py-2.5 transition-all focus:ring-2"
                  style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', outline: 'none' }} />
                {searchQuery && <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }}><X size={14} /></button>}
              </div>
            )}

            {/* Kanban */}
            {opsLoading ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[1,2,3,4].map(i => <div key={i} className="rounded-2xl p-4 space-y-3 animate-pulse" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                  <div className="h-3 rounded w-1/3" style={{ background: 'var(--border-color)' }} />
                  <div className="h-4 rounded w-3/4" style={{ background: 'var(--border-color)' }} />
                  <div className="h-3 rounded w-1/2" style={{ background: 'var(--border-color)' }} />
                </div>)}
              </div>
            ) : opsError ? (
              <div className="card p-8 text-center space-y-3">
                <AlertTriangle size={28} className="text-red-400 mx-auto" />
                <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Failed to load operations</div>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{opsError}</div>
                <button onClick={fetchOpsProjects} className="btn-primary btn-sm mx-auto">Try Again</button>
              </div>
            ) : opsProjects.length === 0 ? (
              <div className="card p-8 text-center space-y-3">
                <Inbox size={28} style={{ color: 'var(--text-muted)', opacity: 0.3 }} className="mx-auto" />
                <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>No projects in pipeline yet</div>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Upload a bill or create a project to get started. Projects flow through stages automatically.</div>
              </div>
            ) : (
              <div className="space-y-5">
                {STAGE_PHASES.map(phase => {
                  const phaseProjects = opsFiltered.filter(p => phase.stages.includes(p.project_status));
                  const isCollapsed = collapsedPhases.has(phase.label);
                  const stalledInPhase = phaseProjects.filter(p => p.is_stalled).length;
                  return (
                    <div key={phase.label}>
                      <button onClick={() => togglePhase(phase.label)} className="flex items-center gap-3 mb-3 w-full text-left group">
                        <div className="flex items-center gap-2">
                          <div className="p-1 rounded-md" style={{ background: `${phase.color}15` }}>
                            <span style={{ color: phase.color }}>{PHASE_ICONS[phase.label] || <Activity size={15} />}</span>
                          </div>
                          <span className="text-sm font-bold uppercase tracking-wider" style={{ color: phase.color }}>{phase.label}</span>
                        </div>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full tabular-nums"
                          style={{ background: phaseProjects.length > 0 ? phase.color : 'var(--bg-muted)', color: phaseProjects.length > 0 ? '#fff' : 'var(--text-muted)' }}>{phaseProjects.length}</span>
                        {stalledInPhase > 0 && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(239,68,68,0.15)', color: '#EF4444' }}>{stalledInPhase} stalled</span>}
                        <div className="flex-1 h-px" style={{ background: 'var(--border-color)' }} />
                        {isCollapsed ? <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} /> : <ChevronUp size={14} style={{ color: 'var(--text-muted)' }} />}
                      </button>
                      {!isCollapsed && (
                        <div className="overflow-x-auto pb-2 -mx-1 px-1" style={{ scrollBehavior: 'smooth', scrollbarWidth: 'thin', scrollbarColor: 'var(--border-color) transparent' }}>
                          <div className="flex gap-3" style={{ minWidth: `${phase.stages.length * 250}px` }}>
                            {phase.stages.map(stage => {
                              const sp = opsByStage(stage);
                              const empty = sp.length === 0;
                              return (
                                <div key={stage} className="flex-1 min-w-[230px] max-w-[300px]" style={{ opacity: empty ? 0.5 : 1 }}>
                                  <div className="flex items-center gap-1.5 mb-2 px-1">
                                    <span style={{ color: 'var(--text-muted)' }}>{STAGE_ICONS[stage]}</span>
                                    <span className="text-[11px] font-bold uppercase tracking-wider truncate" style={{ color: 'var(--text-secondary)' }}>{STAGE_LABELS[stage] || stage}</span>
                                    <span className="text-[10px] font-bold font-mono ml-auto px-1.5 py-0.5 rounded-full flex-shrink-0 tabular-nums"
                                      style={{ background: sp.length > 0 ? `${phase.color}20` : 'var(--bg-muted)', color: sp.length > 0 ? phase.color : 'var(--text-muted)' }}>{sp.length}</span>
                                  </div>
                                  <div className="space-y-2.5 rounded-2xl p-2.5 min-h-[120px] transition-colors"
                                    style={{ background: 'var(--bg-secondary)', border: empty ? '1px dashed var(--border-color)' : '1px solid var(--border-color)', borderRadius: 'var(--radius-card)' }}>
                                    {empty ? (
                                      <div className="flex flex-col items-center justify-center py-8 gap-2">
                                        <Inbox size={18} style={{ color: 'var(--text-muted)', opacity: 0.2 }} />
                                        <span className="text-[10px] font-medium" style={{ color: 'var(--text-muted)', opacity: 0.3 }}>No projects</span>
                                      </div>
                                    ) : sp.map(proj => (
                                      <OpsProjectCard key={proj.id} proj={proj} onAdvance={(id) => openDecisionModal(id, opsProjects.find(p => p.id === id)?.name || '', opsProjects.find(p => p.id === id)?.client_name)} onSaveField={handleSaveField} busy={busyProject} />
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

      </div>

      {/* ═══ DEAL DECISION ENGINE ═══ */}
      {/* Intercepts ALL stage-change actions from CommandBar, WorkQueue, ActionStrip */}
      {decisionModal && (
        <DealDecisionModal
          projectId={decisionModal.projectId}
          projectName={decisionModal.projectName}
          clientName={decisionModal.clientName}
          currentStage={decisionModal.currentStage}
          onClose={() => setDecisionModal(null)}
          onComplete={(newStage) => {
            const pid = decisionModal.projectId;
            setDecisionModal(null);
            // Optimistic update — move card immediately in Kanban, no re-fetch needed
            setOpsProjects(prev => prev.map(p => p.id === pid
              ? { ...p, project_status: newStage as any, updated_at: new Date().toISOString(), is_stalled: false, days_in_stage: 0 }
              : p
            ));
            fetchCommands();
            fetchSchedule();
            setToast({ msg: `Moved to ${STAGE_LABELS[newStage] || newStage} ✓`, type: 'ok' });
          }}
        />
      )}

      {/* Bill Upload Modal */}
      {showBillUpload && (
        <BillUploadModal
          onClose={() => setShowBillUpload(false)}
          onComplete={(entities) => {
            setShowBillUpload(false);
            loadProjects(true);
            loadClients(true);
            window.location.href = `/projects/${entities.projectId}`;
          }}
        />
      )}

      {/* Execution Modals */}
      {activeModal?.type === 'follow_up' && (
        <FollowUpModal
          commandId={activeModal.commandId || ''}
          projectId={activeModal.projectId}
          projectName={activeModal.projectName}
          clientName={activeModal.clientName}
          onClose={() => setActiveModal(null)}
          onComplete={handleModalComplete}
        />
      )}
      {activeModal?.type === 'schedule_install' && (
        <ScheduleInstallModal
          commandId={activeModal.commandId}
          projectId={activeModal.projectId}
          projectName={activeModal.projectName}
          clientName={activeModal.clientName}
          onClose={() => setActiveModal(null)}
          onComplete={handleModalComplete}
        />
      )}
      {activeModal?.type === 'engineering_review' && (
        <EngineeringReviewModal
          commandId={activeModal.commandId}
          projectId={activeModal.projectId}
          projectName={activeModal.projectName}
          clientName={activeModal.clientName}
          onClose={() => setActiveModal(null)}
          onComplete={handleModalComplete}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2.5 px-5 py-3 rounded-2xl text-sm font-medium shadow-xl"
          style={{
            background: toast.type === 'ok' ? 'var(--bg-card)' : 'rgba(239,68,68,0.1)',
            color: toast.type === 'ok' ? 'var(--text-primary)' : '#ef4444',
            border: toast.type === 'ok' ? '1px solid var(--accent-green)' : '1px solid rgba(239,68,68,0.3)',
            boxShadow: toast.type === 'ok' ? '0 0 0 1px rgba(34,197,94,0.15), 0 8px 30px rgba(0,0,0,0.3)' : '0 0 0 1px rgba(239,68,68,0.15), 0 8px 30px rgba(0,0,0,0.3)',
            animation: 'slideInUp 0.3s ease-out',
          }}>
          {toast.type === 'ok' ? <CheckCircle size={16} className="text-green-400" /> : <AlertTriangle size={16} />}
          <span className="max-w-xs">{toast.msg}</span>
          <button onClick={() => setToast(null)} className="ml-2 opacity-50 hover:opacity-100 transition-opacity"><X size={14} /></button>
        </div>
      )}
      <style jsx global>{`@keyframes slideInUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`}</style>
    </AppShell>
  );
}