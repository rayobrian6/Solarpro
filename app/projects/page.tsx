'use client';
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import AppShell from '@/components/ui/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import Link from 'next/link';
import {
  FolderOpen, Plus, Search, Zap, DollarSign,
  ChevronRight, Trash2, Map, FileText,
  Calendar, User, RefreshCw, AlertCircle, Lock,
  MoreHorizontal, Copy, Archive, ChevronDown,
  CheckSquare, Square, X, Check, AlertTriangle,
  TrendingUp, Clock, Flame, Layers, Home, Trees,
  Shield, Activity, ArrowRight, Sparkles, Grid3x3,
  List, Filter, SortAsc
} from 'lucide-react';
import type { Project, ProjectStatus } from '@/types';
import { useAppStore } from '@/store/appStore';
import { useSubscription } from '@/hooks/useSubscription';
import { useUser } from '@/contexts/UserContext';
import { hasPlatformAccess } from '@/lib/permissions';
import UpgradeModal from '@/components/ui/UpgradeModal';

// ── Status config ─────────────────────────────────────────────────────────────
const STATUS_STEPS: ProjectStatus[] = ['lead', 'design', 'proposal', 'approved', 'installed'];

const STATUS_CONFIG: Record<ProjectStatus, {
  label: string; dot: string; badge: string; next?: ProjectStatus;
  glow: string; ringColor: string; cardBorder: string; cardBg: string; iconColor: string; barColor: string;
}> = {
  lead:      { label: 'Lead',      dot: 'bg-slate-400',   badge: 'bg-slate-700/60 text-slate-300 border-slate-600/40',   next: 'design',
    glow: 'shadow-[0_0_20px_rgba(148,163,184,0.12)]',    ringColor: 'ring-slate-500/30',   cardBorder: 'border-slate-600/50',  cardBg: 'from-slate-800/90 to-slate-900/90',  iconColor: 'text-slate-400', barColor: 'bg-slate-500' },
  design:    { label: 'Design',    dot: 'bg-blue-500',    badge: 'bg-blue-900/60 text-blue-300 border-blue-700/40',       next: 'proposal',
    glow: 'shadow-[0_0_24px_rgba(59,130,246,0.15)]',     ringColor: 'ring-blue-500/30',    cardBorder: 'border-blue-700/40',   cardBg: 'from-slate-800/90 to-blue-950/40',   iconColor: 'text-blue-400',  barColor: 'bg-blue-500' },
  proposal:  { label: 'Proposal',  dot: 'bg-amber-500',   badge: 'bg-amber-900/60 text-amber-300 border-amber-700/40',   next: 'approved',
    glow: 'shadow-[0_0_24px_rgba(245,158,11,0.18)]',     ringColor: 'ring-amber-500/30',   cardBorder: 'border-amber-700/40',  cardBg: 'from-slate-800/90 to-amber-950/30',  iconColor: 'text-amber-400', barColor: 'bg-amber-500' },
  approved:  { label: 'Approved',  dot: 'bg-emerald-500', badge: 'bg-emerald-900/60 text-emerald-300 border-emerald-700/40', next: 'installed',
    glow: 'shadow-[0_0_24px_rgba(16,185,129,0.18)]',     ringColor: 'ring-emerald-500/30', cardBorder: 'border-emerald-700/40', cardBg: 'from-slate-800/90 to-emerald-950/30', iconColor: 'text-emerald-400', barColor: 'bg-emerald-500' },
  installed: { label: 'Installed', dot: 'bg-green-500',   badge: 'bg-green-900/60 text-green-300 border-green-700/40',
    glow: 'shadow-[0_0_24px_rgba(34,197,94,0.15)]',      ringColor: 'ring-green-500/30',   cardBorder: 'border-green-700/40',  cardBg: 'from-slate-800/90 to-green-950/30',  iconColor: 'text-green-400', barColor: 'bg-green-500' },
};

const TYPE_ICONS_JSX: Record<string, React.ReactNode> = {
  roof:   <Home size={18} />,
  ground: <Trees size={18} />,
  fence:  <Layers size={18} />,
};
const TYPE_BG: Record<string, string> = {
  roof:   'bg-amber-500/15 text-amber-400 border-amber-500/20',
  ground: 'bg-teal-500/15 text-teal-400 border-teal-500/20',
  fence:  'bg-purple-500/15 text-purple-400 border-purple-500/20',
};
const TYPE_LABEL: Record<string, string> = { roof: 'Roof Mount', ground: 'Ground Mount', fence: 'Sol Fence' };

// ── Urgency helper ────────────────────────────────────────────────────────────
function getUrgency(p: Project): 'high' | 'medium' | 'low' {
  const daysSince = (Date.now() - new Date(p.updatedAt || p.createdAt).getTime()) / 86400000;
  if (p.status === 'proposal' && daysSince > 5) return 'high';
  if (p.status === 'approved' && daysSince > 3)  return 'high';
  if (p.status === 'lead' && daysSince > 14)      return 'medium';
  if (p.status === 'design' && daysSince > 7)     return 'medium';
  return 'low';
}

function getNextAction(p: Project): { label: string; href: string; color: string; bg: string } {
  switch (p.status) {
    case 'lead':      return { label: 'Start Design',     href: `/design?projectId=${p.id}`, color: 'text-blue-300',    bg: 'bg-blue-500/15 hover:bg-blue-500/25 border-blue-500/30' };
    case 'design':    return { label: 'Create Proposal',  href: `/projects/${p.id}`,          color: 'text-amber-300',   bg: 'bg-amber-500/15 hover:bg-amber-500/25 border-amber-500/30' };
    case 'proposal':  return { label: 'Follow Up',        href: `/projects/${p.id}`,          color: 'text-orange-300',  bg: 'bg-orange-500/15 hover:bg-orange-500/25 border-orange-500/30' };
    case 'approved':  return { label: 'Schedule Install', href: `/projects/${p.id}`,          color: 'text-emerald-300', bg: 'bg-emerald-500/15 hover:bg-emerald-500/25 border-emerald-500/30' };
    case 'installed': return { label: 'View Project',     href: `/projects/${p.id}`,          color: 'text-green-300',   bg: 'bg-green-500/15 hover:bg-green-500/25 border-green-500/30' };
  }
}

// ── Status pipeline progress bar ─────────────────────────────────────────────
function PipelineProgress({ status }: { status: ProjectStatus }) {
  const idx = STATUS_STEPS.indexOf(status);
  return (
    <div className="flex items-center gap-0.5 w-full">
      {STATUS_STEPS.map((s, i) => {
        const cfg = STATUS_CONFIG[s];
        const active = i <= idx;
        return (
          <div
            key={s}
            className={`h-1 flex-1 rounded-full transition-all ${active ? cfg.barColor : 'bg-slate-700/60'} ${i === idx ? 'ring-1 ring-white/20' : ''}`}
          />
        );
      })}
    </div>
  );
}

// ── Status Dropdown ───────────────────────────────────────────────────────────
function StatusDropdown({ project, onStatusChange }: {
  project: Project;
  onStatusChange: (id: string, status: ProjectStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const cfg = STATUS_CONFIG[project.status];

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-all hover:opacity-90 ${cfg.badge}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
        {cfg.label}
        <ChevronDown size={9} className={`transition-transform opacity-60 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1.5 bg-slate-800/95 backdrop-blur-xl border border-slate-700/80 rounded-xl shadow-2xl z-30 overflow-hidden min-w-[150px]">
          <div className="px-3 py-1.5 border-b border-slate-700/50">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Set Status</span>
          </div>
          {STATUS_STEPS.map(s => {
            const sc = STATUS_CONFIG[s];
            return (
              <button
                key={s}
                onClick={e => { e.stopPropagation(); onStatusChange(project.id, s); setOpen(false); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-xs hover:bg-slate-700/60 transition-colors ${s === project.status ? 'text-white bg-slate-700/40' : 'text-slate-300'}`}
              >
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${sc.dot}`} />
                {sc.label}
                {s === project.status && <Check size={11} className="ml-auto text-amber-400" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Action Menu ───────────────────────────────────────────────────────────────
function ActionMenu({ project, onDuplicate, onDelete, onClose }: {
  project: Project;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div ref={ref} className="absolute right-0 top-full mt-1.5 bg-slate-800/95 backdrop-blur-xl border border-slate-700/80 rounded-xl shadow-2xl z-30 overflow-hidden min-w-[170px]">
      <Link href={`/projects/${project.id}`} onClick={onClose}
        className="flex items-center gap-2.5 px-3 py-2.5 text-xs text-slate-300 hover:bg-slate-700/60 hover:text-white transition-colors">
        <ChevronRight size={13} className="text-slate-500" /> View Details
      </Link>
      <Link href={`/design?projectId=${project.id}`} onClick={onClose}
        className="flex items-center gap-2.5 px-3 py-2.5 text-xs text-slate-300 hover:bg-slate-700/60 hover:text-white transition-colors">
        <Map size={13} className="text-slate-500" /> Open Design Studio
      </Link>
      <Link href={`/projects/${project.id}`} onClick={onClose}
        className="flex items-center gap-2.5 px-3 py-2.5 text-xs text-slate-300 hover:bg-slate-700/60 hover:text-white transition-colors">
        <FileText size={13} className="text-slate-500" /> Create Proposal
      </Link>
      <div className="h-px bg-slate-700/50 my-1" />
      <button onClick={e => { e.stopPropagation(); onDuplicate(); onClose(); }}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-slate-300 hover:bg-slate-700/60 hover:text-white transition-colors">
        <Copy size={13} className="text-slate-500" /> Duplicate
      </button>
      <div className="h-px bg-slate-700/50 my-1" />
      <button onClick={e => { e.stopPropagation(); onDelete(); onClose(); }}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors">
        <Trash2 size={13} /> Delete Project
      </button>
    </div>
  );
}

// ── Confirm Delete Modal ──────────────────────────────────────────────────────
// Rendered via portal at document.body so it escapes any overflow/stacking context
function ConfirmDeleteModal({ count, onConfirm, onCancel, loading }: {
  count: number; onConfirm: () => void; onCancel: () => void; loading: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;
  const modal = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-slate-800 border border-slate-700 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
        <div className="w-12 h-12 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-4">
          <Trash2 size={20} className="text-red-400" />
        </div>
        <h3 className="text-white font-bold text-center mb-2">Delete {count === 1 ? 'Project' : `${count} Projects`}?</h3>
        <p className="text-slate-400 text-sm text-center mb-5">This cannot be undone. All project data will be permanently removed.</p>
        <div className="flex gap-3">
          <button onClick={onCancel} disabled={loading} className="btn-secondary flex-1">Cancel</button>
          <button onClick={onConfirm} disabled={loading}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-xl text-sm transition-colors disabled:opacity-60">
            {loading ? <span className="spinner w-4 h-4" /> : <Trash2 size={14} />}
            {loading ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
  return createPortal(modal, document.body);
}

// ── Project Card (the real hero) ──────────────────────────────────────────────
function ProjectCard({
  project, isSelected, onSelect, onStatusChange, updatingStatus,
  actionMenuId, setActionMenuId, onDuplicate, onDelete
}: {
  project: Project;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onStatusChange: (id: string, status: ProjectStatus) => void;
  updatingStatus: string | null;
  actionMenuId: string | null;
  setActionMenuId: (id: string | null) => void;
  onDuplicate: (p: Project) => void;
  onDelete: (id: string) => void;
}) {
  const urgency    = getUrgency(project);
  const nextAction = getNextAction(project);
  const cfg        = STATUS_CONFIG[project.status];
  const menuOpen   = actionMenuId === project.id;

  return (
    <div
      className={`
        relative group overflow-hidden rounded-2xl border transition-all duration-300
        bg-gradient-to-br ${cfg.cardBg}
        ${cfg.cardBorder}
        ${cfg.glow}
        hover:scale-[1.01] hover:shadow-2xl
        ${isSelected ? 'ring-2 ring-amber-500/60 border-amber-500/50' : ''}
        ${urgency === 'high' ? 'ring-1 ring-red-500/20' : ''}
      `}
    >
      {/* Decorative radial glow top-right */}
      <div className={`absolute -top-6 -right-6 w-28 h-28 rounded-full blur-2xl opacity-40 pointer-events-none ${
        project.status === 'approved'  ? 'bg-emerald-500/20' :
        project.status === 'proposal'  ? 'bg-amber-500/20'   :
        project.status === 'design'    ? 'bg-blue-500/20'    :
        project.status === 'installed' ? 'bg-green-500/20'   : 'bg-slate-500/10'
      }`} />

      {/* Top accent stripe */}
      <div className={`absolute top-0 left-0 right-0 h-0.5 ${cfg.barColor} opacity-80`} />

      {/* Card body */}
      <div className="relative p-4">
        {/* Row 1: checkbox + type icon + name + urgency badge + 3-dot menu */}
        <div className="flex items-start gap-3 mb-3">
          {/* Checkbox */}
          <button
            onClick={e => { e.stopPropagation(); onSelect(project.id); }}
            className="mt-0.5 text-slate-600 hover:text-amber-400 transition-colors flex-shrink-0"
          >
            {isSelected
              ? <CheckSquare size={15} className="text-amber-400" />
              : <Square size={15} />}
          </button>

          {/* Type icon tile */}
          <div className={`w-9 h-9 rounded-xl border flex items-center justify-center flex-shrink-0 ${TYPE_BG[project.systemType] || 'bg-slate-700/40 text-slate-400 border-slate-600/40'}`}>
            {TYPE_ICONS_JSX[project.systemType] || <FolderOpen size={16} />}
          </div>

          {/* Name + urgency chips */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Link
                href={`/projects/${project.id}`}
                className="font-bold text-white text-sm hover:text-amber-300 transition-colors leading-tight"
              >
                {project.name}
              </Link>
              {urgency === 'high' && (
                <span className="flex items-center gap-1 text-[10px] text-red-300 bg-red-500/12 border border-red-500/25 px-1.5 py-0.5 rounded-full font-bold">
                  <Flame size={8} /> Hot
                </span>
              )}
              {urgency === 'medium' && (
                <span className="flex items-center gap-1 text-[10px] text-amber-400/80 bg-amber-500/8 border border-amber-500/20 px-1.5 py-0.5 rounded-full">
                  <Clock size={8} /> Stale
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`text-[10px] px-1.5 py-0.5 rounded-md border font-semibold ${TYPE_BG[project.systemType] || ''}`}>
                {TYPE_LABEL[project.systemType] || project.systemType}
              </span>
            </div>
          </div>

          {/* 3-dot menu */}
          <div className="relative flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setActionMenuId(menuOpen ? null : project.id)}
              className="btn-ghost p-1.5 rounded-lg text-slate-500 hover:text-slate-300"
            >
              <MoreHorizontal size={14} />
            </button>
            {menuOpen && (
              <ActionMenu
                project={project}
                onDuplicate={() => onDuplicate(project)}
                onDelete={() => onDelete(project.id)}
                onClose={() => setActionMenuId(null)}
              />
            )}
          </div>
        </div>

        {/* Row 2: Client + date */}
        <div className="flex items-center gap-3 text-xs text-slate-500 mb-3">
          {project.client?.name && (
            <span className="flex items-center gap-1 truncate">
              <User size={10} className="flex-shrink-0" />
              <Link href={`/clients/${project.clientId}`} className="hover:text-slate-300 transition-colors truncate">
                {project.client.name}
              </Link>
            </span>
          )}
          <span className="flex items-center gap-1 flex-shrink-0 ml-auto">
            <Calendar size={10} />
            {new Date(project.updatedAt || project.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        </div>

        {/* Row 3: KPI tiles */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="bg-slate-900/60 rounded-xl border border-slate-700/40 p-2.5 text-center">
            <Zap size={10} className="text-amber-400 mx-auto mb-1" />
            <div className="text-sm font-black text-white tabular-nums">
              {project.layout?.systemSizeKw ? `${project.layout.systemSizeKw.toFixed(1)}` : '—'}
            </div>
            <div className="text-[9px] text-slate-500 uppercase tracking-wide font-semibold mt-0.5">kW</div>
          </div>
          <div className="bg-slate-900/60 rounded-xl border border-slate-700/40 p-2.5 text-center">
            <Activity size={10} className="text-blue-400 mx-auto mb-1" />
            <div className="text-sm font-black text-white tabular-nums">
              {project.production?.annualProductionKwh
                ? `${(project.production.annualProductionKwh / 1000).toFixed(1)}k`
                : '—'}
            </div>
            <div className="text-[9px] text-slate-500 uppercase tracking-wide font-semibold mt-0.5">kWh/yr</div>
          </div>
          <div className="bg-slate-900/60 rounded-xl border border-slate-700/40 p-2.5 text-center">
            <DollarSign size={10} className="text-emerald-400 mx-auto mb-1" />
            <div className="text-sm font-black text-white tabular-nums">
              {project.costEstimate?.netCost
                ? `$${(project.costEstimate.netCost / 1000).toFixed(0)}k`
                : '—'}
            </div>
            <div className="text-[9px] text-slate-500 uppercase tracking-wide font-semibold mt-0.5">net</div>
          </div>
        </div>

        {/* Row 4: Pipeline progress bar */}
        <div className="mb-3">
          <PipelineProgress status={project.status} />
        </div>

        {/* Row 5: Status badge + CTA + quick links */}
        <div className="flex items-center gap-2">
          {updatingStatus === project.id ? (
            <span className="spinner w-4 h-4" />
          ) : (
            <StatusDropdown project={project} onStatusChange={onStatusChange} />
          )}
          <Link
            href={nextAction.href}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${nextAction.bg} ${nextAction.color}`}
          >
            {nextAction.label} <ArrowRight size={10} />
          </Link>
          <Link href={`/design?projectId=${project.id}`}
            className="btn-ghost p-1.5 rounded-lg text-slate-500 hover:text-blue-400 transition-colors" title="Design Studio">
            <Map size={13} />
          </Link>
          <Link href={`/projects/${project.id}`}
            className="btn-ghost p-1.5 rounded-lg text-slate-500 hover:text-amber-400 transition-colors" title="Proposal">
            <FileText size={13} />
          </Link>
        </div>
      </div>
    </div>
  );
}

// ── Project Row (compact list view) ──────────────────────────────────────────
function ProjectRow({
  project, isSelected, onSelect, onStatusChange, updatingStatus,
  actionMenuId, setActionMenuId, onDuplicate, onDelete
}: {
  project: Project;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onStatusChange: (id: string, status: ProjectStatus) => void;
  updatingStatus: string | null;
  actionMenuId: string | null;
  setActionMenuId: (id: string | null) => void;
  onDuplicate: (p: Project) => void;
  onDelete: (id: string) => void;
}) {
  const urgency    = getUrgency(project);
  const nextAction = getNextAction(project);
  const cfg        = STATUS_CONFIG[project.status];
  const menuOpen   = actionMenuId === project.id;

  return (
    <div className={`
      relative flex items-center gap-3 px-4 py-3 group transition-all
      hover:bg-slate-800/60 border-b border-slate-700/30 last:border-b-0
      ${isSelected ? 'bg-amber-500/5 border-l-2 border-l-amber-500/60' : ''}
      ${urgency === 'high' && !isSelected ? 'border-l-2 border-l-red-500/60' : ''}
      ${urgency === 'medium' && !isSelected ? 'border-l-2 border-l-amber-500/30' : ''}
    `}>
      <button onClick={() => onSelect(project.id)} className="text-slate-600 hover:text-amber-400 transition-colors flex-shrink-0">
        {isSelected ? <CheckSquare size={14} className="text-amber-400" /> : <Square size={14} />}
      </button>

      <div className={`w-8 h-8 rounded-lg border flex items-center justify-center flex-shrink-0 ${TYPE_BG[project.systemType] || 'bg-slate-700/40 text-slate-400 border-slate-600/40'}`}>
        {TYPE_ICONS_JSX[project.systemType] || <FolderOpen size={14} />}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Link href={`/projects/${project.id}`} className="font-semibold text-white text-sm hover:text-amber-300 transition-colors">
            {project.name}
          </Link>
          {urgency === 'high' && (
            <span className="flex items-center gap-1 text-[10px] text-red-400 bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 rounded-full font-bold">
              <Flame size={8} /> Hot
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500">
          {project.client?.name && (
            <span className="flex items-center gap-1">
              <User size={9} />
              <Link href={`/clients/${project.clientId}`} className="hover:text-slate-300 transition-colors">
                {project.client.name}
              </Link>
            </span>
          )}
          {project.layout?.systemSizeKw && (
            <span className="flex items-center gap-1 text-amber-400/70">
              <Zap size={9} /> {project.layout.systemSizeKw.toFixed(1)} kW
            </span>
          )}
          <span className="flex items-center gap-1">
            <Calendar size={9} />
            {new Date(project.updatedAt || project.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        </div>
      </div>

      {project.costEstimate?.netCost ? (
        <div className="hidden lg:flex flex-col items-end gap-0.5 flex-shrink-0">
          <div className="text-sm font-bold text-white">${project.costEstimate.netCost.toLocaleString()}</div>
          <div className="text-xs text-slate-500">net cost</div>
        </div>
      ) : null}

      <div className="hidden md:block flex-shrink-0">
        <Link href={nextAction.href}
          className={`text-xs font-semibold ${nextAction.color} hover:opacity-80 transition-opacity flex items-center gap-1`}>
          {nextAction.label} <ChevronRight size={10} />
        </Link>
      </div>

      <div className="flex-shrink-0" onClick={e => e.stopPropagation()}>
        {updatingStatus === project.id ? (
          <span className="spinner w-4 h-4" />
        ) : (
          <StatusDropdown project={project} onStatusChange={onStatusChange} />
        )}
      </div>

      <div className="flex items-center gap-1 flex-shrink-0">
        <Link href={`/design?projectId=${project.id}`}
          className="btn-ghost p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity" title="Design Studio">
          <Map size={13} />
        </Link>
        <Link href={`/projects/${project.id}`}
          className="btn-ghost p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity" title="Create Proposal">
          <FileText size={13} />
        </Link>
        <div className="relative">
          <button
            onClick={e => { e.stopPropagation(); setActionMenuId(menuOpen ? null : project.id); }}
            className="btn-ghost p-1.5 rounded-lg text-slate-500 hover:text-slate-300"
          >
            <MoreHorizontal size={14} />
          </button>
          {menuOpen && (
            <ActionMenu
              project={project}
              onDuplicate={() => onDuplicate(project)}
              onDelete={() => onDelete(project.id)}
              onClose={() => setActionMenuId(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ProjectsPage() {
  const projects       = useAppStore(s => s.projects);
  const projectsState  = useAppStore(s => s.projectsState);
  const projectsError  = useAppStore(s => s.projectsError);
  const loadProjects   = useAppStore(s => s.loadProjects);
  const removeProject  = useAppStore(s => s.removeProject);

  const [search, setSearch]               = useState('');
  const [filterType, setFilterType]       = useState('all');
  const [filterStatus, setFilterStatus]   = useState('all');
  const [sortBy, setSortBy]               = useState<'updated' | 'created' | 'name' | 'size'>('updated');
  const [viewMode, setViewMode]           = useState<'grid' | 'list'>('grid');
  const [upgradeOpen, setUpgradeOpen]     = useState(false);
  const [actionMenuId, setActionMenuId]   = useState<string | null>(null);
  const [selectedIds, setSelectedIds]     = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<{ ids: string[] } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);

  const { plan, loading: subLoading } = useSubscription();
  const { user }       = useUser();
  const isUnlimited    = hasPlatformAccess(user);
  const maxProjects    = (!subLoading && plan === 'starter' && !isUnlimited) ? 2 : null;
  const atProjectLimit = maxProjects !== null && projects.length >= maxProjects;

  useEffect(() => { loadProjects(true); }, [loadProjects]);
  const loading = projectsState === 'loading' && projects.length === 0;

  const filtered = projects
    .filter(p => {
      const matchSearch = p.name.toLowerCase().includes(search.toLowerCase()) ||
        (p.client?.name || '').toLowerCase().includes(search.toLowerCase());
      const matchType   = filterType   === 'all' || p.systemType === filterType;
      const matchStatus = filterStatus === 'all' || p.status     === filterStatus;
      return matchSearch && matchType && matchStatus;
    })
    .sort((a, b) => {
      if (sortBy === 'name')    return a.name.localeCompare(b.name);
      if (sortBy === 'size')    return (b.layout?.systemSizeKw ?? 0) - (a.layout?.systemSizeKw ?? 0);
      if (sortBy === 'created') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime();
    });

  const statusCounts = STATUS_STEPS.reduce((acc, s) => {
    acc[s] = projects.filter(p => p.status === s).length;
    return acc;
  }, {} as Record<string, number>);

  const totalKw    = projects.reduce((s, p) => s + (p.layout?.systemSizeKw    ?? 0), 0);
  const totalValue = projects.reduce((s, p) => s + (p.costEstimate?.netCost   ?? 0), 0);

  const allFilteredSelected = filtered.length > 0 && filtered.every(p => selectedIds.has(p.id));
  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds(prev => { const n = new Set(prev); filtered.forEach(p => n.delete(p.id)); return n; });
    } else {
      setSelectedIds(prev => { const n = new Set(prev); filtered.forEach(p => n.add(p.id)); return n; });
    }
  };
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const handleStatusChange = async (id: string, status: ProjectStatus) => {
    setUpdatingStatus(id);
    try {
      await fetch(`/api/projects/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      await loadProjects(true);
    } catch { alert('Failed to update status'); }
    finally { setUpdatingStatus(null); }
  };

  const handleDuplicate = async (project: Project) => {
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${project.name} (Copy)`, clientId: project.clientId,
          systemType: project.systemType, status: 'lead',
          notes: project.notes, address: project.address,
          lat: project.lat, lng: project.lng,
        }),
      });
      if (res.ok) await loadProjects(true);
    } catch { alert('Failed to duplicate project'); }
  };

  const handleDeleteSingle   = (id: string) => setConfirmDelete({ ids: [id] });
  const handleDeleteSelected = () => { if (selectedIds.size > 0) setConfirmDelete({ ids: Array.from(selectedIds) }); };

  const executeDelete = async () => {
    if (!confirmDelete) return;
    setDeleteLoading(true);
    try {
      const ids = confirmDelete.ids;
      if (ids.length === 1) {
        // Single delete — use existing store action (optimistic UI update)
        await removeProject(ids[0]);
      } else {
        // Bulk delete — single SQL round-trip, avoids N serial fetches timing out
        const res = await fetch('/api/projects/bulk-delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids }),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error || 'Bulk delete failed');
        // Reload projects to reflect server state
        await loadProjects(true);
        if (json.skipped?.length > 0) {
          alert(`${json.deleted.length} project(s) deleted. ${json.skipped.length} could not be deleted (not found or not owned by you).`);
        }
      }
      setSelectedIds(new Set());
      setConfirmDelete(null);
    } catch (e: unknown) {
      alert(`Delete failed: ${(e as Error)?.message || 'Unknown error'}`);
    } finally { setDeleteLoading(false); }
  };

  const sharedCardProps = {
    onSelect: toggleSelect,
    onStatusChange: handleStatusChange,
    updatingStatus,
    actionMenuId,
    setActionMenuId,
    onDuplicate: handleDuplicate,
    onDelete: handleDeleteSingle,
  };

  return (
    <AppShell>
      <div className="p-6 space-y-5 animate-fade-in">
        {/* Modals */}
        {confirmDelete && (
          <ConfirmDeleteModal
            count={confirmDelete.ids.length}
            onConfirm={executeDelete}
            onCancel={() => setConfirmDelete(null)}
            loading={deleteLoading}
          />
        )}
        <UpgradeModal
          isOpen={upgradeOpen}
          onClose={() => setUpgradeOpen(false)}
          title="Project Limit Reached"
          description={`Starter plan is limited to ${maxProjects} projects. Upgrade to Professional for unlimited projects.`}
          requiredPlan="Professional"
        />

        {/* ══════════ COMMAND HEADER ══════════ */}
        <div className="relative overflow-hidden rounded-2xl border border-slate-700/60 bg-gradient-to-br from-slate-800/80 via-slate-800/60 to-slate-900/90 shadow-2xl">
          <div className="absolute -top-12 -right-12 w-56 h-56 bg-blue-500/8 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-8 -left-8 w-40 h-40 bg-amber-500/6 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-blue-500/30 to-transparent" />
          <div className="relative p-5">
            <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-6 h-6 rounded-lg bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
                    <FolderOpen size={12} className="text-blue-400" />
                  </div>
                  <span className="text-xs font-bold text-blue-400 uppercase tracking-widest">Project Pipeline</span>
                  {loading && <RefreshCw size={11} className="text-slate-500 animate-spin" />}
                </div>
                <h1 className="text-2xl font-black text-white tracking-tight">Projects</h1>
                <p className="text-sm text-slate-400 mt-0.5">
                  {loading
                    ? 'Loading pipeline...'
                    : `${projects.length} projects · ${totalKw.toFixed(1)} kW total · $${(totalValue / 1000).toFixed(0)}k pipeline`}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={() => loadProjects(true)} className="btn-ghost p-2 rounded-lg" title="Refresh" disabled={projectsState === 'loading'}>
                  <RefreshCw size={15} className={projectsState === 'loading' ? 'animate-spin' : ''} />
                </button>
                {atProjectLimit ? (
                  <button onClick={() => setUpgradeOpen(true)} className="btn-secondary flex items-center gap-2 opacity-70">
                    <Lock size={14} /> New Project
                    <span className="text-xs text-amber-400 font-normal">({projects.length}/{maxProjects})</span>
                  </button>
                ) : (
                  <Link href="/projects/new" className="btn-primary flex items-center gap-1.5">
                    <Plus size={14} /> New Project
                  </Link>
                )}
              </div>
            </div>

            {/* Status KPI pills */}
            {!loading && projects.length > 0 && (
              <div className="grid grid-cols-5 gap-2">
                {STATUS_STEPS.map(status => {
                  const count    = statusCounts[status] ?? 0;
                  const cfg      = STATUS_CONFIG[status];
                  const isActive = filterStatus === status;
                  return (
                    <button
                      key={status}
                      onClick={() => setFilterStatus(isActive ? 'all' : status)}
                      className={`
                        relative rounded-xl border px-3 py-2.5 text-center transition-all cursor-pointer
                        ${isActive
                          ? `${cfg.cardBorder} ${cfg.glow} bg-slate-800/80`
                          : 'border-slate-700/50 bg-slate-800/40 hover:border-slate-600/70 hover:bg-slate-800/70'}
                      `}
                    >
                      {isActive && <div className={`absolute top-0 left-0 right-0 h-0.5 ${cfg.barColor} rounded-t-xl`} />}
                      <div className="text-xl font-black text-white tabular-nums">{count}</div>
                      <div className={`text-[10px] font-bold capitalize mt-0.5 ${isActive ? cfg.iconColor : 'text-slate-500'}`}>
                        {cfg.label}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Starter limit banner */}
        {atProjectLimit && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex items-center gap-3">
            <Lock size={16} className="text-amber-400 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-amber-300 font-semibold text-sm">Project limit reached ({projects.length}/{maxProjects})</p>
              <p className="text-amber-400/70 text-xs mt-0.5">Upgrade to Professional for unlimited projects.</p>
            </div>
            <button onClick={() => setUpgradeOpen(true)} className="btn-primary btn-sm flex-shrink-0">Upgrade</button>
          </div>
        )}

        {/* Error banner */}
        {projectsError && projects.length > 0 && (
          <div className="banner-warning">
            <AlertCircle size={16} className="text-amber-400 flex-shrink-0" />
            <p className="text-amber-400 text-sm flex-1">Showing cached data — server sync failed: {projectsError}</p>
            <button onClick={() => loadProjects(true)} className="btn-secondary btn-sm">Retry</button>
          </div>
        )}

        {/* ══════════ FILTER + SORT + VIEW TOGGLE BAR ══════════ */}
        <div className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Search projects or clients..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="input pl-9 text-sm"
            />
          </div>
          <select value={filterType}   onChange={e => setFilterType(e.target.value)}   className="select w-auto text-sm">
            <option value="all">All Types</option>
            <option value="roof">Roof Mount</option>
            <option value="ground">Ground Mount</option>
            <option value="fence">Sol Fence</option>
          </select>
          <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)} className="select w-auto text-sm">
            <option value="updated">Recently Updated</option>
            <option value="created">Newest First</option>
            <option value="name">Name A–Z</option>
            <option value="size">Largest System</option>
          </select>
          {/* View toggle */}
          <div className="flex items-center gap-1 bg-slate-800/60 border border-slate-700/60 rounded-xl p-1 flex-shrink-0">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-2 rounded-lg transition-all ${viewMode === 'grid' ? 'bg-slate-700 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}
              title="Card Grid"
            >
              <Grid3x3 size={14} />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-2 rounded-lg transition-all ${viewMode === 'list' ? 'bg-slate-700 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}
              title="List View"
            >
              <List size={14} />
            </button>
          </div>
        </div>

        {/* ══════════ BULK TOOLBAR ══════════ */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 px-4 py-3 bg-amber-500/10 border border-amber-500/30 rounded-xl">
            <CheckSquare size={15} className="text-amber-400" />
            <span className="text-amber-300 font-semibold text-sm">{selectedIds.size} project{selectedIds.size !== 1 ? 's' : ''} selected</span>
            <div className="ml-auto flex items-center gap-2">
              <button onClick={handleDeleteSelected}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 hover:text-red-300 rounded-lg text-xs font-semibold transition-colors">
                <Trash2 size={13} /> Delete Selected
              </button>
              <button onClick={() => setSelectedIds(new Set())} className="btn-ghost p-1.5 rounded-lg text-slate-400">
                <X size={14} />
              </button>
            </div>
          </div>
        )}

        {/* ══════════ CONTENT ══════════ */}
        {loading ? (
          viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {[1, 2, 3, 4, 5, 6].map(i => (
                <div key={i} className="rounded-2xl border border-slate-700/40 bg-slate-800/60 p-4 space-y-3 animate-pulse">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-slate-700/60 rounded-xl" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-slate-700/60 rounded w-3/4" />
                      <div className="h-3 bg-slate-700/40 rounded w-1/2" />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[1,2,3].map(j => <div key={j} className="h-14 bg-slate-700/40 rounded-xl" />)}
                  </div>
                  <div className="h-1.5 bg-slate-700/40 rounded-full" />
                  <div className="h-8 bg-slate-700/40 rounded-lg" />
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <div key={i} className="card p-4 shimmer h-16" />)}
            </div>
          )
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-16 text-center">
            <div className="w-16 h-16 rounded-2xl bg-slate-800 border border-slate-700/60 flex items-center justify-center mx-auto mb-4">
              <FolderOpen size={28} className="text-slate-600" />
            </div>
            <p className="text-slate-400 font-semibold">No projects found</p>
            <p className="text-slate-500 text-sm mt-1">
              {search || filterType !== 'all' || filterStatus !== 'all'
                ? 'Try adjusting your filters'
                : 'Create your first project to get started'}
            </p>
            {!search && filterType === 'all' && filterStatus === 'all' && (
              <Link href="/projects/new" className="btn-primary mt-4 inline-flex">
                <Plus size={16} /> Create Project
              </Link>
            )}
          </div>
        ) : viewMode === 'grid' ? (
          <div>
            <div className="flex items-center gap-3 mb-3">
              <button onClick={toggleSelectAll} className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-300 transition-colors">
                {allFilteredSelected
                  ? <CheckSquare size={13} className="text-amber-400" />
                  : <Square size={13} />}
                <span>{allFilteredSelected ? 'Deselect all' : `Select all ${filtered.length}`}</span>
              </button>
              {filtered.some(p => getUrgency(p) === 'high') && (
                <span className="flex items-center gap-1 text-xs text-red-400">
                  <Flame size={11} /> {filtered.filter(p => getUrgency(p) === 'high').length} need attention
                </span>
              )}
              <span className="text-xs text-slate-600 ml-auto">
                {filtered.length} project{filtered.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filtered.map(project => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  isSelected={selectedIds.has(project.id)}
                  {...sharedCardProps}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-700/50 bg-slate-800/40 overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-700/50 bg-slate-800/50">
              <button onClick={toggleSelectAll} className="text-slate-500 hover:text-slate-300 transition-colors flex-shrink-0">
                {allFilteredSelected ? <CheckSquare size={14} className="text-amber-400" /> : <Square size={14} />}
              </button>
              <span className="text-xs text-slate-500 font-semibold">{filtered.length} project{filtered.length !== 1 ? 's' : ''}</span>
              {filtered.some(p => getUrgency(p) === 'high') && (
                <span className="flex items-center gap-1 text-xs text-red-400 ml-auto">
                  <Flame size={11} /> {filtered.filter(p => getUrgency(p) === 'high').length} need attention
                </span>
              )}
            </div>
            {filtered.map(project => (
              <ProjectRow
                key={project.id}
                project={project}
                isSelected={selectedIds.has(project.id)}
                {...sharedCardProps}
              />
            ))}
            <div className="px-4 py-2.5 border-t border-slate-700/40 bg-slate-800/20 flex items-center justify-between">
              <span className="text-xs text-slate-500">
                {filtered.length} project{filtered.length !== 1 ? 's' : ''}{search || filterType !== 'all' || filterStatus !== 'all' ? ' matching filters' : ''}
              </span>
              {selectedIds.size > 0 && <span className="text-xs text-amber-400 font-semibold">{selectedIds.size} selected</span>}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}