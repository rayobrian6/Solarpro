'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Sun, MapPin, Zap, RefreshCw, CheckCircle2, Circle,
  ChevronRight, Search,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Stage Definitions ────────────────────────────────────────────────────────

const STAGE_CONTENT: Record<HomeownerStage, {
  title: string;
  description: string;
  happening: string[];
  next: string;
  action: string;
  color: string;
  bg: string;
  dot: string;
}> = {
  lead_submitted: {
    title:       'We Received Your Request',
    description: "We've received your solar inquiry and are reviewing your information.",
    happening: [
      'Your request has been logged in our system',
      'A project coordinator is being assigned to your account',
      'Initial eligibility review is underway',
    ],
    next:   'Our team will reach out to you shortly to confirm next steps.',
    action: 'No action is needed from you at this time.',
    color:  'text-slate-300',
    bg:     'bg-slate-500/10',
    dot:    'bg-slate-400',
  },
  under_review: {
    title:       "We're Reviewing Your Project",
    description: 'Our team is reviewing your property and energy needs.',
    happening: [
      'Reviewing your property details',
      'Assessing your energy usage and goals',
      'Determining the best solar solution for your home',
    ],
    next:   'We will schedule a site survey to assess your property in person.',
    action: 'No action is needed from you at this time.',
    color:  'text-blue-300',
    bg:     'bg-blue-500/10',
    dot:    'bg-blue-400',
  },
  site_survey: {
    title:       'Your Site Survey is Being Scheduled',
    description: "We're coordinating your site survey to gather details about your home.",
    happening: [
      'Coordinating technician availability',
      'Preparing for an on-site evaluation of your roof',
      'Reviewing satellite imagery of your property',
    ],
    next:   'A technician will visit your home to conduct the site survey.',
    action: 'No action is needed from you at this time.',
    color:  'text-cyan-300',
    bg:     'bg-cyan-500/10',
    dot:    'bg-cyan-400',
  },
  design: {
    title:       "We're Designing Your System",
    description: 'We are creating a custom solar system for your home.',
    happening: [
      'Reviewing your roof layout and dimensions',
      'Optimizing panel placement for maximum output',
      'Finalizing your system size and configuration',
    ],
    next:   'You will receive your solar proposal within the next few days.',
    action: 'No action is needed from you at this time.',
    color:  'text-violet-300',
    bg:     'bg-violet-500/10',
    dot:    'bg-violet-400',
  },
  proposal: {
    title:       'Your Proposal is Ready',
    description: 'Your solar proposal is ready for review.',
    happening: [
      'Your custom proposal has been prepared',
      'System specifications and pricing are finalized',
      'Our team is ready to walk you through the details',
    ],
    next:   'A member of our team will contact you to review your proposal.',
    action: 'No action is needed from you at this time.',
    color:  'text-amber-300',
    bg:     'bg-amber-500/10',
    dot:    'bg-amber-400',
  },
  installation: {
    title:       'Your Installation is Scheduled',
    description: 'We are preparing for your solar installation.',
    happening: [
      'Equipment has been ordered for your system',
      'Installation crew is being assigned',
      'Permits and approvals are being coordinated',
    ],
    next:   'Our installation crew will arrive on the scheduled date to install your system.',
    action: 'No action is needed from you at this time.',
    color:  'text-orange-300',
    bg:     'bg-orange-500/10',
    dot:    'bg-orange-400',
  },
  completed: {
    title:       'Your Project is Complete',
    description: 'Your solar system is installed and complete.',
    happening: [
      'Your solar system has been fully installed',
      'Final inspection has been completed',
      'Your system is generating clean energy',
    ],
    next:   'Welcome to clean energy! Monitor your system performance with your provider app.',
    action: 'No action is needed from you at this time.',
    color:  'text-green-300',
    bg:     'bg-green-500/10',
    dot:    'bg-green-400',
  },
};

const STAGES: { value: HomeownerStage; label: string }[] = [
  { value: 'lead_submitted', label: 'Request Received' },
  { value: 'under_review',   label: 'Under Review'     },
  { value: 'site_survey',    label: 'Site Survey'       },
  { value: 'design',         label: 'System Design'     },
  { value: 'proposal',       label: 'Proposal'          },
  { value: 'installation',   label: 'Installation'      },
  { value: 'completed',      label: 'Complete'          },
];

function getStageIndex(stage: HomeownerStage | null) {
  if (!stage) return -1;
  return STAGES.findIndex(s => s.value === stage);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });
}

function getFirstName(name: string | null): string {
  if (!name) return 'there';
  return name.split(' ')[0];
}

// ─── Progress Tracker ─────────────────────────────────────────────────────────

function ProgressTracker({ stage }: { stage: HomeownerStage | null }) {
  const currentIdx = getStageIndex(stage);
  return (
    <div className="w-full overflow-x-auto">
      <div className="flex items-start min-w-[480px]">
        {STAGES.map((s, i) => {
          const isPast    = i < currentIdx;
          const isCurrent = i === currentIdx;
          const isLast    = i === STAGES.length - 1;
          return (
            <div key={s.value} className="flex items-start flex-1">
              <div className="flex flex-col items-center gap-2 flex-shrink-0 w-16">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center border-2 transition-all ${
                  isCurrent
                    ? 'bg-amber-500 border-amber-400 shadow-lg shadow-amber-500/30'
                    : isPast
                    ? 'bg-green-500/20 border-green-500/40'
                    : 'bg-white/3 border-white/10'
                }`}>
                  {isPast    ? <CheckCircle2 size={16} className="text-green-400" />
                  : isCurrent ? <div className="w-3 h-3 rounded-full bg-white" />
                              : <Circle size={16} className="text-white/15" />}
                </div>
                <span className={`text-[10px] font-medium text-center leading-tight w-full ${
                  isCurrent ? 'text-amber-400 font-semibold' :
                  isPast    ? 'text-white/40' : 'text-white/20'
                }`}>{s.label}</span>
              </div>
              {!isLast && (
                <div className={`flex-1 h-0.5 mt-4 rounded-full ${
                  isPast    ? 'bg-green-500/30' :
                  isCurrent ? 'bg-white/10' : 'bg-white/5'
                }`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Dashboard Preview (per project) ─────────────────────────────────────────

function HomeownerDashboardView({ project }: { project: Project }) {
  const stage   = project.homeowner_stage;
  const content = stage ? STAGE_CONTENT[stage] : null;
  const stageIdx = getStageIndex(stage);
  const pct = stage ? Math.round(((stageIdx + 1) / STAGES.length) * 100) : 0;
  const firstName = getFirstName(project.client_name);

  return (
    <div className="space-y-5">

      {/* Homeowner Header */}
      <div className="rounded-2xl bg-gradient-to-r from-amber-500/20 to-orange-500/10 border border-amber-500/20 px-6 py-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-amber-500/70 mb-1">Your Solar Project</p>
        <h2 className="text-2xl font-black text-white">Hi, {firstName} 👋</h2>
        {project.address && (
          <div className="flex items-center gap-1.5 mt-1.5">
            <MapPin size={12} className="text-amber-400/60 shrink-0" />
            <span className="text-sm text-amber-100/60">{project.address}</span>
          </div>
        )}
        {project.system_size_kw && (
          <div className="flex items-center gap-1.5 mt-1">
            <Zap size={11} className="text-amber-400/60 shrink-0" />
            <span className="text-xs text-amber-100/50">{project.system_size_kw} kW system</span>
          </div>
        )}
      </div>

      {/* Current Status Block */}
      {content ? (
        <div className={`rounded-2xl border border-white/8 ${content.bg} p-6 space-y-2`}>
          <div className="flex items-center gap-2 mb-1">
            <div className={`w-2 h-2 rounded-full ${content.dot} animate-pulse`} />
            <span className="text-xs font-bold uppercase tracking-widest text-white/40">Current Status</span>
          </div>
          <h3 className={`text-xl font-black ${content.color}`}>{content.title}</h3>
          <p className="text-slate-300 text-sm leading-relaxed">{content.description}</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-white/8 bg-white/2 p-6">
          <p className="text-slate-500 text-sm italic">No stage set yet.</p>
        </div>
      )}

      {/* What Is Happening Now */}
      {content && (
        <div className="rounded-2xl border border-white/8 bg-white/2 p-5 space-y-3">
          <h4 className="text-xs font-bold uppercase tracking-widest text-slate-500">What Is Happening Now</h4>
          <ul className="space-y-2">
            {content.happening.map((item, i) => (
              <li key={i} className="flex items-start gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-1.5 shrink-0" />
                <span className="text-sm text-slate-300 leading-relaxed">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* What Happens Next */}
      {content && (
        <div className="rounded-2xl border border-white/8 bg-white/2 p-5 space-y-1.5">
          <h4 className="text-xs font-bold uppercase tracking-widest text-slate-500">What Happens Next</h4>
          <p className="text-sm text-slate-300 leading-relaxed">{content.next}</p>
        </div>
      )}

      {/* Action Required */}
      {content && (
        <div className="rounded-2xl border border-white/8 bg-white/2 p-4 flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
            <CheckCircle2 size={15} className="text-green-400" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-0.5">Action Required</p>
            <p className="text-sm text-slate-300">{content.action}</p>
          </div>
        </div>
      )}

      {/* Progress Tracker */}
      <div className="rounded-2xl border border-white/8 bg-white/2 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold uppercase tracking-widest text-slate-500">Progress</h4>
          <span className="text-xs font-bold text-white">{pct}%</span>
        </div>
        <ProgressTracker stage={stage} />
      </div>

      {/* Project Details */}
      <div className="rounded-2xl border border-white/8 bg-white/2 p-5 space-y-2">
        <h4 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-3">Project Details</h4>
        {project.system_size_kw && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-400 flex items-center gap-2">
              <Zap size={12} className="text-amber-400" /> System Size
            </span>
            <span className="text-sm font-semibold text-white">{project.system_size_kw} kW</span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-400">Last Updated</span>
          <span className="text-sm font-medium text-white">{formatDate(project.updated_at)}</span>
        </div>
      </div>

      <p className="text-center text-xs text-white/20 pb-2">Questions? Contact your solar advisor.</p>
    </div>
  );
}

// ─── Admin Wrapper Page ───────────────────────────────────────────────────────

export default function AdminPortalDashboardPage() {
  const [projects, setProjects]   = useState<Project[]>([]);
  const [filtered, setFiltered]   = useState<Project[]>([]);
  const [selected, setSelected]   = useState<Project | null>(null);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');

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
    <div className="space-y-4">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-white">Homeowner Portal Dashboard</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            View the dashboard exactly as a homeowner sees it. Select a project to preview.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white bg-white/5 hover:bg-white/8 border border-white/10 px-3 py-1.5 rounded-lg transition-all disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-500">
          <RefreshCw size={16} className="animate-spin mr-2" /> Loading projects…
        </div>
      ) : (
        <div className="flex gap-5 items-start">

          {/* ── Left: Project List ── */}
          <div className="w-72 flex-shrink-0 space-y-2">
            {/* Search */}
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search projects…"
                className="w-full bg-white/4 border border-white/8 rounded-lg pl-8 pr-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/40"
              />
            </div>

            {/* List */}
            <div className="space-y-1 max-h-[calc(100vh-220px)] overflow-y-auto pr-1">
              {filtered.length === 0 && (
                <p className="text-xs text-slate-600 px-2 py-4 text-center">No projects found.</p>
              )}
              {filtered.map(p => {
                const stage   = p.homeowner_stage;
                const content = stage ? STAGE_CONTENT[stage] : null;
                const isActive = selected?.id === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => setSelected(p)}
                    className={`w-full text-left px-3 py-3 rounded-xl border transition-all ${
                      isActive
                        ? 'bg-amber-500/10 border-amber-500/25 text-white'
                        : 'bg-white/2 border-white/6 text-slate-400 hover:bg-white/5 hover:border-white/10'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className={`text-sm font-semibold truncate ${isActive ? 'text-white' : 'text-slate-300'}`}>
                          {p.client_name ?? p.name}
                        </p>
                        {p.address && (
                          <p className="text-xs text-slate-500 truncate mt-0.5">{p.address}</p>
                        )}
                        {content && (
                          <div className="flex items-center gap-1 mt-1.5">
                            <div className={`w-1.5 h-1.5 rounded-full ${content.dot}`} />
                            <span className={`text-[10px] font-medium ${content.color}`}>
                              {content.title.length > 28 ? content.title.slice(0, 28) + '…' : content.title}
                            </span>
                          </div>
                        )}
                        {!content && (
                          <span className="text-[10px] text-slate-600 mt-1 block">No stage set</span>
                        )}
                      </div>
                      {isActive && <ChevronRight size={14} className="text-amber-400 shrink-0 mt-0.5" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Right: Dashboard Preview ── */}
          <div className="flex-1 min-w-0">
            {selected ? (
              <div>
                {/* Admin label */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2 bg-blue-500/10 border border-blue-500/20 rounded-lg px-3 py-1.5">
                    <Sun size={12} className="text-blue-400" />
                    <span className="text-xs text-blue-300 font-medium">
                      Previewing: {selected.client_name ?? selected.name}
                    </span>
                  </div>
                  <a
                    href={`/admin/projects/${selected.id}`}
                    className="text-xs text-slate-400 hover:text-white border border-white/8 hover:border-white/20 rounded-lg px-3 py-1.5 transition-all"
                  >
                    Edit Project →
                  </a>
                </div>
                <HomeownerDashboardView project={selected} />
              </div>
            ) : (
              <div className="flex items-center justify-center h-64 rounded-2xl border border-white/8 bg-white/2">
                <p className="text-slate-600 text-sm">Select a project from the list to preview.</p>
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}