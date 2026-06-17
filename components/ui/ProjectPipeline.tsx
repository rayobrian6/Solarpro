'use client';
import React, { useEffect, useState, useRef } from 'react';
import { ChevronDown, Check, Home, Trees, Layers } from 'lucide-react';
import type { Project, ProjectStatus } from '@/types';

// ── Status step order ────────────────────────────────────────────────────────
export const STATUS_STEPS: ProjectStatus[] = ['lead', 'design', 'proposal', 'approved', 'installed'];

// ── Status config ────────────────────────────────────────────────────────────
export const STATUS_CONFIG: Record<ProjectStatus, {
  label: string; dot: string; badge: string; next?: ProjectStatus;
  ringColor: string; cardBorder: string; iconColor: string; barColor: string;
}> = {
  lead:      { label: 'Lead',      dot: 'bg-slate-400',   badge: 'bg-slate-700/60 text-slate-300 border-slate-600/40',   next: 'design',
    ringColor: 'ring-slate-500/30',   cardBorder: 'border-slate-600/50',  iconColor: 'text-slate-400', barColor: 'bg-slate-500' },
  design:    { label: 'Design',    dot: 'bg-blue-500',    badge: 'bg-blue-900/60 text-blue-300 border-blue-700/40',       next: 'proposal',
    ringColor: 'ring-blue-500/30',    cardBorder: 'border-blue-700/40',   iconColor: 'text-blue-400',  barColor: 'bg-blue-500' },
  proposal:  { label: 'Proposal',  dot: 'bg-amber-500',   badge: 'bg-amber-900/60 text-amber-300 border-amber-700/40',   next: 'approved',
    ringColor: 'ring-amber-500/30',   cardBorder: 'border-amber-700/40',  iconColor: 'text-amber-400', barColor: 'bg-amber-500' },
  approved:  { label: 'Approved',  dot: 'bg-emerald-500', badge: 'bg-emerald-900/60 text-emerald-300 border-emerald-700/40', next: 'installed',
    ringColor: 'ring-emerald-500/30', cardBorder: 'border-emerald-700/40', iconColor: 'text-emerald-400', barColor: 'bg-emerald-500' },
  installed: { label: 'Installed', dot: 'bg-green-500',   badge: 'bg-green-900/60 text-green-300 border-green-700/40',
    ringColor: 'ring-green-500/30',   cardBorder: 'border-green-700/40',  iconColor: 'text-green-400', barColor: 'bg-green-500' },
};

// ── Type icons / styling ─────────────────────────────────────────────────────
export const TYPE_ICONS_JSX: Record<string, React.ReactNode> = {
  roof:   <Home size={18} />,
  ground: <Trees size={18} />,
  fence:  <Layers size={18} />,
};
export const TYPE_BG: Record<string, string> = {
  roof:   'bg-amber-500/15 text-amber-400 border-amber-500/20',
  ground: 'bg-teal-500/15 text-teal-400 border-teal-500/20',
  fence:  'bg-purple-500/15 text-purple-400 border-purple-500/20',
};
export const TYPE_LABEL: Record<string, string> = { roof: 'Roof Mount', ground: 'Ground Mount', fence: 'Sol Fence' };

// ── Urgency helper ───────────────────────────────────────────────────────────
export function getUrgency(p: Project): 'high' | 'medium' | 'low' {
  const daysSince = (Date.now() - new Date(p.updatedAt || p.createdAt).getTime()) / 86400000;
  if (p.status === 'proposal' && daysSince > 5) return 'high';
  if (p.status === 'approved' && daysSince > 3)  return 'high';
  if (p.status === 'lead' && daysSince > 14)      return 'medium';
  if (p.status === 'design' && daysSince > 7)     return 'medium';
  return 'low';
}

// ── Next-action helper ───────────────────────────────────────────────────────
export function getNextAction(p: Project): { label: string; href: string; color: string; bg: string } {
  switch (p.status) {
    case 'lead':      return { label: 'Start Design',     href: `/design?projectId=${p.id}`, color: 'text-blue-300',    bg: 'bg-blue-500/15 hover:bg-blue-500/25 border-blue-500/30' };
    case 'design':    return { label: 'Create Proposal',  href: `/projects/${p.id}`,          color: 'text-amber-300',   bg: 'bg-amber-500/15 hover:bg-amber-500/25 border-amber-500/30' };
    case 'proposal':  return { label: 'Follow Up',        href: `/projects/${p.id}`,          color: 'text-orange-300',  bg: 'bg-orange-500/15 hover:bg-orange-500/25 border-orange-500/30' };
    case 'approved':  return { label: 'Schedule Install', href: `/projects/${p.id}`,          color: 'text-emerald-300', bg: 'bg-emerald-500/15 hover:bg-emerald-500/25 border-emerald-500/30' };
    case 'installed': return { label: 'View Project',     href: `/projects/${p.id}`,          color: 'text-green-300',   bg: 'bg-green-500/15 hover:bg-green-500/25 border-green-500/30' };
  }
}

// ── Pipeline progress bar ────────────────────────────────────────────────────
export function PipelineProgress({ status }: { status: ProjectStatus }) {
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

// ── Status Dropdown ─────────────────────────────────────────────────────────
export function StatusDropdown({ project, onStatusChange }: {
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
      {open ? (
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
                {s === project.status ? <Check size={11} className="ml-auto text-amber-400" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
