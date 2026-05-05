'use client';

import { useEffect, useState, useCallback } from 'react';
import { Sun, RefreshCw, Search, ChevronDown } from 'lucide-react';

// ─── Shared types ─────────────────────────────────────────────────────────────

type HomeownerStage =
  | 'lead_submitted'
  | 'under_review'
  | 'site_survey'
  | 'design'
  | 'proposal'
  | 'installation'
  | 'completed';

interface Project {
  id: string;
  name: string;
  address: string | null;
  system_size_kw: number | null;
  homeowner_stage: HomeownerStage | null;
  updated_at: string;
  created_at: string;
  client_name: string | null;
  client_email: string | null;
  owner_name: string;
}

// ─── Stage content (same as portal) ──────────────────────────────────────────

type StageContent = {
  roadmapLabel: string;
  headline: string;
  now: string;
  next: string;
  action: string;
  actionIsRequired: boolean;
};

const STAGE_CONTENT: Record<HomeownerStage, StageContent> = {
  lead_submitted: {
    roadmapLabel: 'Request Received', headline: 'We Received Your Request',
    now: "We're reviewing your solar inquiry.",
    next: 'Our team will review your home and energy needs.',
    action: 'No action needed right now.', actionIsRequired: false,
  },
  under_review: {
    roadmapLabel: 'Under Review', headline: "We're Reviewing Your Project",
    now: "We're reviewing your property details and energy needs.",
    next: "We'll determine the next best step for your project.",
    action: 'No action needed right now.', actionIsRequired: false,
  },
  site_survey: {
    roadmapLabel: 'Site Survey', headline: 'Your Site Survey is Next',
    now: "We're gathering the details needed to design your system accurately.",
    next: 'After the survey, your system design can begin.',
    action: "We'll contact you if scheduling is needed.", actionIsRequired: true,
  },
  design: {
    roadmapLabel: 'System Design', headline: "We're Designing Your Solar System",
    now: "We're creating a custom solar design for your home.",
    next: 'Your proposal will be prepared after the design is complete.',
    action: 'No action needed right now.', actionIsRequired: false,
  },
  proposal: {
    roadmapLabel: 'Proposal', headline: 'Your Proposal is Ready',
    now: 'Your solar proposal is ready for review.',
    next: "Once approved, we'll move toward installation planning.",
    action: 'Review your proposal when available.', actionIsRequired: true,
  },
  installation: {
    roadmapLabel: 'Installation', headline: 'Your Installation is Being Prepared',
    now: "We're preparing for your solar installation.",
    next: 'Your project will move toward completion after install.',
    action: "We'll contact you with scheduling details.", actionIsRequired: true,
  },
  completed: {
    roadmapLabel: 'Complete', headline: 'Your Solar Project is Complete',
    now: 'Your solar project has been completed.',
    next: 'You can enjoy your new solar system.',
    action: 'No action needed.', actionIsRequired: false,
  },
};

const ROADMAP_STEPS: HomeownerStage[] = [
  'lead_submitted', 'under_review', 'site_survey', 'design',
  'proposal', 'installation', 'completed',
];

function getStageIndex(stage: HomeownerStage | null): number {
  if (!stage) return -1;
  return ROADMAP_STEPS.indexOf(stage);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── Roadmap ─────────────────────────────────────────────────────────────────

import { CheckCircle2, Circle, AlertCircle, ArrowRight, MapPin, Zap, Clock, Phone, Mail, ChevronRight } from 'lucide-react';

function Roadmap({ stage }: { stage: HomeownerStage | null }) {
  const currentIdx = getStageIndex(stage);
  return (
    <>
      {/* Desktop */}
      <div className="hidden md:block">
        <div className="relative flex items-start">
          <div className="absolute top-5 left-0 right-0 h-0.5 bg-white/6 z-0" />
          {ROADMAP_STEPS.map((s, i) => {
            const isPast = i < currentIdx;
            const isCurrent = i === currentIdx;
            const content = STAGE_CONTENT[s];
            return (
              <div key={s} className="flex-1 flex flex-col items-center relative z-10">
                {i > 0 && (
                  <div className={`absolute top-5 right-1/2 left-[-50%] h-0.5 z-0 ${
                    isPast || isCurrent ? 'bg-gradient-to-r from-green-500/60 to-green-500/40' : 'bg-white/6'
                  }`} />
                )}
                <div className={`relative w-10 h-10 rounded-full flex items-center justify-center border-2 z-10 transition-all ${
                  isCurrent ? 'bg-amber-500 border-amber-300 shadow-xl shadow-amber-500/40 scale-110'
                  : isPast   ? 'bg-green-500/20 border-green-500/50'
                             : 'bg-[#0f1119] border-white/10'
                }`}>
                  {isPast    ? <CheckCircle2 size={17} className="text-green-400" />
                  : isCurrent ? <div className="w-3 h-3 rounded-full bg-white animate-pulse" />
                              : <Circle size={17} className="text-white/15" />}
                  {isCurrent && <div className="absolute inset-0 rounded-full bg-amber-500/20 animate-ping scale-150 pointer-events-none" />}
                </div>
                <span className={`mt-2.5 text-[11px] font-semibold text-center leading-tight max-w-[72px] ${
                  isCurrent ? 'text-amber-400' : isPast ? 'text-green-400/70' : 'text-white/20'
                }`}>{content.roadmapLabel}</span>
                <span className={`text-[9px] mt-0.5 font-bold ${
                  isCurrent ? 'text-amber-500/60' : isPast ? 'text-green-500/40' : 'text-white/10'
                }`}>STEP {i + 1}</span>
              </div>
            );
          })}
        </div>
      </div>
      {/* Mobile */}
      <div className="md:hidden space-y-0">
        {ROADMAP_STEPS.map((s, i) => {
          const isPast = i < currentIdx;
          const isCurrent = i === currentIdx;
          const isLast = i === ROADMAP_STEPS.length - 1;
          const content = STAGE_CONTENT[s];
          return (
            <div key={s} className="flex items-start gap-4">
              <div className="flex flex-col items-center w-8 flex-shrink-0">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 flex-shrink-0 ${
                  isCurrent ? 'bg-amber-500 border-amber-300 shadow-lg shadow-amber-500/30'
                  : isPast   ? 'bg-green-500/20 border-green-500/40'
                             : 'bg-white/3 border-white/8'
                }`}>
                  {isPast    ? <CheckCircle2 size={14} className="text-green-400" />
                  : isCurrent ? <div className="w-2.5 h-2.5 rounded-full bg-white" />
                              : <Circle size={14} className="text-white/10" />}
                </div>
                {!isLast && <div className={`w-0.5 flex-1 min-h-[24px] mt-1 rounded-full ${isPast ? 'bg-green-500/30' : 'bg-white/5'}`} />}
              </div>
              <div className={`pb-4 pt-1 flex-1 ${isLast ? 'pb-0' : ''}`}>
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-semibold ${isCurrent ? 'text-amber-400' : isPast ? 'text-white/50' : 'text-white/20'}`}>
                    {content.roadmapLabel}
                  </span>
                  {isCurrent && <span className="text-[9px] font-bold bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full">CURRENT</span>}
                  {isPast    && <span className="text-[9px] font-bold text-green-500/50">✓ DONE</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ─── HomeownerView: the actual dashboard ─────────────────────────────────────

function HomeownerView({ project }: { project: Project }) {
  const stage    = project.homeowner_stage;
  const content  = stage ? STAGE_CONTENT[stage] : null;
  const stageIdx = getStageIndex(stage);
  const pct      = stage ? Math.round(((stageIdx + 1) / ROADMAP_STEPS.length) * 100) : 0;
  const firstName = project.client_name?.split(' ')[0] ?? 'there';
  const lastUpdated = formatDate(project.updated_at);

  return (
    <div className="space-y-6">

      {/* Hero Header */}
      <div className="relative rounded-3xl overflow-hidden border border-white/8 bg-gradient-to-br from-[#141420] via-[#10101a] to-[#0d0d14]">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-amber-500/40 to-transparent" />
        <div className="px-6 sm:px-8 py-7">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-amber-500/70 mb-2">Your Solar Project</p>
              <h1 className="text-3xl font-black text-white leading-tight">Hi, {firstName} 👋</h1>
              {project.address && (
                <div className="flex items-center gap-2 mt-2.5">
                  <MapPin size={13} className="text-slate-500 shrink-0" />
                  <span className="text-sm text-slate-300">{project.address}</span>
                </div>
              )}
              <div className="flex items-center gap-2 mt-1.5">
                <Clock size={11} className="text-slate-600 shrink-0" />
                <span className="text-xs text-slate-500">Last updated {lastUpdated}</span>
              </div>
            </div>
            {content && (
              <div className="flex-shrink-0">
                <div className="inline-flex items-center gap-2 bg-amber-500/15 border border-amber-500/25 rounded-2xl px-4 py-2.5">
                  <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                  <span className="text-sm font-bold text-amber-300">{content.roadmapLabel}</span>
                </div>
                <p className="text-xs text-slate-500 mt-1.5">Step {stageIdx + 1} of {ROADMAP_STEPS.length}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Roadmap */}
      <div className="rounded-3xl border border-white/8 bg-gradient-to-b from-white/3 to-white/[0.01] p-6 sm:p-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-lg font-black text-white">Project Roadmap</h2>
            <p className="text-xs text-slate-500 mt-0.5">Your journey from inquiry to installation</p>
          </div>
          <div className="text-right">
            <span className="text-2xl font-black text-white">{pct}%</span>
            <p className="text-[10px] text-slate-500 uppercase tracking-widest mt-0.5">Complete</p>
          </div>
        </div>
        <Roadmap stage={stage} />
        <div className="mt-6 h-1.5 bg-white/5 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-green-500 via-amber-500 to-amber-400 rounded-full transition-all duration-700" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* Current Stage Panel */}
      {content && (
        <div className="rounded-3xl border border-amber-500/15 bg-gradient-to-br from-amber-500/8 to-orange-500/4 p-6 sm:p-8">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-xs font-bold uppercase tracking-widest text-amber-500/80">Current Stage</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-black text-white mb-5 leading-tight">{content.headline}</h2>
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="bg-white/5 border border-white/8 rounded-2xl p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">Happening Now</p>
              <p className="text-sm text-slate-200 leading-relaxed">{content.now}</p>
            </div>
            <div className="bg-white/5 border border-white/8 rounded-2xl p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">What Happens Next</p>
              <p className="text-sm text-slate-200 leading-relaxed">{content.next}</p>
            </div>
            <div className={`border rounded-2xl p-4 ${content.actionIsRequired ? 'bg-blue-500/8 border-blue-500/20' : 'bg-green-500/6 border-green-500/15'}`}>
              <div className="flex items-center gap-1.5 mb-2">
                {content.actionIsRequired ? <AlertCircle size={11} className="text-blue-400" /> : <CheckCircle2 size={11} className="text-green-400" />}
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Action Required</p>
              </div>
              <p className={`text-sm font-medium leading-relaxed ${content.actionIsRequired ? 'text-blue-200' : 'text-green-300'}`}>
                {content.action}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Snapshot Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-white/8 bg-white/2 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-2">Address</p>
          <p className="text-sm font-semibold text-white leading-snug">{project.address ? project.address.split(',')[0] : '—'}</p>
          {project.address?.includes(',') && <p className="text-xs text-slate-500 mt-0.5">{project.address.split(',').slice(1).join(',').trim()}</p>}
        </div>
        <div className="rounded-2xl border border-white/8 bg-white/2 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-2">System Size</p>
          {project.system_size_kw ? (
            <><p className="text-2xl font-black text-white">{project.system_size_kw}</p><p className="text-xs text-amber-400 font-semibold">kW</p></>
          ) : (
            <p className="text-sm text-slate-500">Pending design</p>
          )}
        </div>
        <div className="rounded-2xl border border-white/8 bg-white/2 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-2">Stage</p>
          <p className="text-sm font-semibold text-amber-300">{content?.roadmapLabel ?? '—'}</p>
          <p className="text-xs text-slate-500 mt-0.5">Step {stageIdx + 1} of 7</p>
        </div>
        <div className="rounded-2xl border border-white/8 bg-white/2 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-2">Progress</p>
          <p className="text-2xl font-black text-white">{pct}<span className="text-sm font-bold text-slate-400">%</span></p>
          <div className="h-1 bg-white/5 rounded-full mt-2 overflow-hidden">
            <div className="h-full bg-amber-500 rounded-full" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      {/* Next Step Card */}
      {content && stageIdx < ROADMAP_STEPS.length - 1 && (
        <div className="rounded-3xl border border-white/8 bg-white/2 p-6 flex items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">What Happens Next</p>
            <p className="text-base font-semibold text-white leading-snug">{content.next}</p>
            {stageIdx + 1 < ROADMAP_STEPS.length && (
              <div className="flex items-center gap-1.5 mt-2">
                <ArrowRight size={11} className="text-amber-400" />
                <span className="text-xs text-amber-400 font-medium">
                  Up next: {STAGE_CONTENT[ROADMAP_STEPS[stageIdx + 1]].roadmapLabel}
                </span>
              </div>
            )}
          </div>
          <ChevronRight size={20} className="text-white/20 flex-shrink-0" />
        </div>
      )}

      {/* Contact Card */}
      <div className="rounded-3xl border border-white/8 bg-white/2 p-6 sm:p-8">
        <h3 className="text-base font-bold text-white mb-1">Questions?</h3>
        <p className="text-sm text-slate-400 mb-5">Contact Under the Sun Solar — we're here to help.</p>
        <div className="flex flex-col sm:flex-row gap-3">
          <a href="tel:+1-800-000-0000" className="flex items-center gap-3 bg-white/4 hover:bg-white/7 border border-white/8 rounded-2xl px-5 py-3.5 transition-all group">
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/15 flex items-center justify-center">
              <Phone size={14} className="text-amber-400" />
            </div>
            <div>
              <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide">Phone</p>
              <p className="text-sm font-semibold text-white group-hover:text-amber-300 transition-colors">(800) 000-0000</p>
            </div>
          </a>
          <a href="mailto:hello@underthesun.solar" className="flex items-center gap-3 bg-white/4 hover:bg-white/7 border border-white/8 rounded-2xl px-5 py-3.5 transition-all group">
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/15 flex items-center justify-center">
              <Mail size={14} className="text-amber-400" />
            </div>
            <div>
              <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide">Email</p>
              <p className="text-sm font-semibold text-white group-hover:text-amber-300 transition-colors">hello@underthesun.solar</p>
            </div>
          </a>
        </div>
      </div>

    </div>
  );
}

// ─── Admin Wrapper ────────────────────────────────────────────────────────────

export default function AdminPortalDashboardPage() {
  const [projects,  setProjects]  = useState<Project[]>([]);
  const [selected,  setSelected]  = useState<Project | null>(null);
  const [filtered,  setFiltered]  = useState<Project[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState('');
  const [showPicker, setShowPicker] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/projects?limit=100');
      const d   = await res.json();
      if (d.success) {
        const list: Project[] = d.projects ?? [];
        setProjects(list);
        setFiltered(list);
        if (list.length > 0 && !selected) setSelected(list[0]);
      }
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const q = search.toLowerCase();
    if (!q) { setFiltered(projects); return; }
    setFiltered(projects.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.client_name?.toLowerCase().includes(q) ||
      p.address?.toLowerCase().includes(q)
    ));
  }, [search, projects]);

  return (
    <div className="space-y-5">

      {/* Admin controls bar */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-white">Portal Dashboard Preview</h1>
          <p className="text-xs text-slate-500 mt-0.5">Viewing the homeowner experience. Select a project below.</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white bg-white/5 border border-white/10 px-3 py-1.5 rounded-lg transition-all disabled:opacity-50 flex-shrink-0"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Project picker */}
      <div className="relative">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={e => { setSearch(e.target.value); setShowPicker(true); }}
              onFocus={() => setShowPicker(true)}
              placeholder="Search projects to preview…"
              className="w-full bg-white/4 border border-white/8 rounded-lg pl-8 pr-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/40"
            />
          </div>
          {selected && (
            <button
              onClick={() => setShowPicker(v => !v)}
              className="flex items-center gap-2 bg-white/4 border border-white/8 hover:border-white/15 rounded-lg px-3 py-2 text-sm text-slate-300 transition-all"
            >
              <Sun size={13} className="text-amber-400" />
              {selected.client_name ?? selected.name}
              <ChevronDown size={13} className="text-slate-500" />
            </button>
          )}
        </div>

        {/* Dropdown */}
        {showPicker && filtered.length > 0 && (
          <div
            className="absolute top-full mt-1 left-0 w-96 max-h-72 overflow-y-auto bg-[#0f1119] border border-white/10 rounded-xl shadow-2xl z-50"
            onMouseLeave={() => { if (!search) setShowPicker(false); }}
          >
            {filtered.slice(0, 20).map(p => {
              const stage   = p.homeowner_stage;
              const content = stage ? STAGE_CONTENT[stage] : null;
              return (
                <button
                  key={p.id}
                  onClick={() => { setSelected(p); setShowPicker(false); setSearch(''); }}
                  className={`w-full text-left px-4 py-3 hover:bg-white/5 transition-all border-b border-white/4 last:border-0 ${
                    selected?.id === p.id ? 'bg-amber-500/8' : ''
                  }`}
                >
                  <p className="text-sm font-semibold text-white">{p.client_name ?? p.name}</p>
                  {p.address && <p className="text-xs text-slate-500 mt-0.5 truncate">{p.address}</p>}
                  {content && (
                    <div className="flex items-center gap-1.5 mt-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                      <span className="text-[11px] text-amber-400 font-medium">{content.roadmapLabel}</span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Admin preview badge */}
      {selected && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 bg-blue-500/8 border border-blue-500/15 rounded-lg px-3 py-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
            <span className="text-xs text-blue-300 font-medium">
              Admin Preview — {selected.client_name ?? selected.name}
            </span>
          </div>
          <a
            href={`/admin/projects/${selected.id}`}
            className="text-xs text-slate-400 hover:text-white border border-white/8 hover:border-white/15 rounded-lg px-3 py-1.5 transition-all"
          >
            Edit Project →
          </a>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-500">
          <RefreshCw size={16} className="animate-spin mr-2" /> Loading projects…
        </div>
      ) : selected ? (
        <HomeownerView project={selected} />
      ) : (
        <div className="flex items-center justify-center h-64 rounded-2xl border border-white/8 bg-white/2">
          <p className="text-slate-600 text-sm">No projects found.</p>
        </div>
      )}

    </div>
  );
}