'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Sun, MapPin, Zap, LogOut, RefreshCw,
  CheckCircle2, Circle, Clock, ChevronRight,
  Phone, Mail, AlertCircle, ArrowRight,
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
}

interface StageHistory {
  project_id: string;
  stage: HomeownerStage;
  created_at: string;
}

interface Client {
  id: string;
  name: string;
  email: string;
  phone: string | null;
}

// ─── Stage Definitions ────────────────────────────────────────────────────────

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
    roadmapLabel:     'Request Received',
    headline:         'We Received Your Request',
    now:              "We're reviewing your solar inquiry.",
    next:             'Our team will review your home and energy needs.',
    action:           'No action needed right now.',
    actionIsRequired: false,
  },
  under_review: {
    roadmapLabel:     'Under Review',
    headline:         "We're Reviewing Your Project",
    now:              "We're reviewing your property details and energy needs.",
    next:             "We'll determine the next best step for your project.",
    action:           'No action needed right now.',
    actionIsRequired: false,
  },
  site_survey: {
    roadmapLabel:     'Site Survey',
    headline:         'Your Site Survey is Next',
    now:              "We're gathering the details needed to design your system accurately.",
    next:             'After the survey, your system design can begin.',
    action:           "We'll contact you if scheduling is needed.",
    actionIsRequired: true,
  },
  design: {
    roadmapLabel:     'System Design',
    headline:         "We're Designing Your Solar System",
    now:              "We're creating a custom solar design for your home.",
    next:             'Your proposal will be prepared after the design is complete.',
    action:           'No action needed right now.',
    actionIsRequired: false,
  },
  proposal: {
    roadmapLabel:     'Proposal',
    headline:         'Your Proposal is Ready',
    now:              'Your solar proposal is ready for review.',
    next:             "Once approved, we'll move toward installation planning.",
    action:           'Review your proposal when available.',
    actionIsRequired: true,
  },
  installation: {
    roadmapLabel:     'Installation',
    headline:         'Your Installation is Being Prepared',
    now:              "We're preparing for your solar installation.",
    next:             'Your project will move toward completion after install.',
    action:           "We'll contact you with scheduling details.",
    actionIsRequired: true,
  },
  completed: {
    roadmapLabel:     'Complete',
    headline:         'Your Solar Project is Complete',
    now:              'Your solar project has been completed.',
    next:             'You can enjoy your new solar system.',
    action:           'No action needed.',
    actionIsRequired: false,
  },
};

const ROADMAP_STEPS: HomeownerStage[] = [
  'lead_submitted',
  'under_review',
  'site_survey',
  'design',
  'proposal',
  'installation',
  'completed',
];

function getStageIndex(stage: HomeownerStage | null): number {
  if (!stage) return -1;
  return ROADMAP_STEPS.indexOf(stage);
}

function getFirstName(name: string): string {
  return name.split(' ')[0];
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });
}

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
  });
}

function friendlyStageLabel(stage: HomeownerStage): string {
  return STAGE_CONTENT[stage].roadmapLabel;
}

// ─── Roadmap Component ────────────────────────────────────────────────────────

function Roadmap({ stage }: { stage: HomeownerStage | null }) {
  const currentIdx = getStageIndex(stage);

  return (
    <>
      {/* Desktop: horizontal */}
      <div className="hidden md:block">
        <div className="relative flex items-start">
          {/* Background connector line */}
          <div className="absolute top-5 left-0 right-0 h-0.5 bg-white/6 z-0" />

          {ROADMAP_STEPS.map((s, i) => {
            const isPast    = i < currentIdx;
            const isCurrent = i === currentIdx;
            const isFuture  = i > currentIdx;
            const content   = STAGE_CONTENT[s];

            return (
              <div key={s} className="flex-1 flex flex-col items-center relative z-10">
                {/* Filled connector behind current */}
                {i > 0 && (
                  <div className={`absolute top-5 right-1/2 left-[-50%] h-0.5 z-0 transition-all ${
                    isPast || isCurrent ? 'bg-gradient-to-r from-green-500/60 to-green-500/40' : 'bg-white/6'
                  }`} />
                )}

                {/* Step node */}
                <div className={`relative w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all z-10 ${
                  isCurrent
                    ? 'bg-amber-500 border-amber-300 shadow-xl shadow-amber-500/40 scale-110'
                    : isPast
                    ? 'bg-green-500/20 border-green-500/50'
                    : 'bg-[#0f1119] border-white/10'
                }`}>
                  {isPast
                    ? <CheckCircle2 size={17} className="text-green-400" />
                    : isCurrent
                    ? <div className="w-3 h-3 rounded-full bg-white animate-pulse" />
                    : <Circle size={17} className="text-white/15" />
                  }
                  {/* Glow ring on current */}
                  {isCurrent && (
                    <div className="absolute inset-0 rounded-full bg-amber-500/20 animate-ping scale-150 pointer-events-none" />
                  )}
                </div>

                {/* Label */}
                <span className={`mt-2.5 text-[11px] font-semibold text-center leading-tight max-w-[72px] transition-all ${
                  isCurrent ? 'text-amber-400' :
                  isPast    ? 'text-green-400/70' :
                              'text-white/20'
                }`}>
                  {content.roadmapLabel}
                </span>

                {/* Step number */}
                <span className={`text-[9px] mt-0.5 font-bold ${
                  isCurrent ? 'text-amber-500/60' :
                  isPast    ? 'text-green-500/40' :
                              'text-white/10'
                }`}>
                  STEP {i + 1}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Mobile: vertical */}
      <div className="md:hidden space-y-0">
        {ROADMAP_STEPS.map((s, i) => {
          const isPast    = i < currentIdx;
          const isCurrent = i === currentIdx;
          const isLast    = i === ROADMAP_STEPS.length - 1;
          const content   = STAGE_CONTENT[s];

          return (
            <div key={s} className="flex items-start gap-4">
              {/* Left: node + connector */}
              <div className="flex flex-col items-center w-8 flex-shrink-0">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 flex-shrink-0 transition-all ${
                  isCurrent
                    ? 'bg-amber-500 border-amber-300 shadow-lg shadow-amber-500/30'
                    : isPast
                    ? 'bg-green-500/20 border-green-500/40'
                    : 'bg-white/3 border-white/8'
                }`}>
                  {isPast
                    ? <CheckCircle2 size={14} className="text-green-400" />
                    : isCurrent
                    ? <div className="w-2.5 h-2.5 rounded-full bg-white" />
                    : <Circle size={14} className="text-white/10" />
                  }
                </div>
                {!isLast && (
                  <div className={`w-0.5 flex-1 min-h-[24px] mt-1 rounded-full ${
                    isPast ? 'bg-green-500/30' : 'bg-white/5'
                  }`} />
                )}
              </div>

              {/* Right: label */}
              <div className={`pb-4 pt-1 flex-1 ${isLast ? 'pb-0' : ''}`}>
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-semibold ${
                    isCurrent ? 'text-amber-400' :
                    isPast    ? 'text-white/50' :
                                'text-white/20'
                  }`}>
                    {content.roadmapLabel}
                  </span>
                  {isCurrent && (
                    <span className="text-[9px] font-bold bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full">
                      CURRENT
                    </span>
                  )}
                  {isPast && (
                    <span className="text-[9px] font-bold text-green-500/50">✓ DONE</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function PortalDashboard() {
  const router = useRouter();

  const [client,       setClient]       = useState<Client | null>(null);
  const [projects,     setProjects]     = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [history,      setHistory]      = useState<StageHistory[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/portal/dashboard');
      const d   = await res.json();

      if (d.code === 'PORTAL_AUTH_REQUIRED' || res.status === 401) {
        router.replace('/portal/login');
        return;
      }
      if (!d.success) {
        setError(d.error || 'Failed to load your project.');
        return;
      }

      setClient(d.client);
      const list: Project[] = d.projects ?? [];
      setProjects(list);
      if (list.length > 0) setActiveProject(list[0]);
      setHistory(d.stageHistory ?? []);
    } catch {
      setError('Connection error. Please refresh the page.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLogout = async () => {
    await fetch('/api/portal/logout', { method: 'POST' });
    router.replace('/portal/login');
  };

  // ─── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#09090f]">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-2">
            <Sun size={22} className="text-amber-400" />
          </div>
          <RefreshCw size={16} className="animate-spin" />
          <span className="text-sm">Loading your project…</span>
        </div>
      </div>
    );
  }

  // ─── Error ────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#09090f] px-4">
        <div className="text-center max-w-sm">
          <p className="text-red-400 text-sm mb-4">{error}</p>
          <button
            onClick={load}
            className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white hover:bg-white/10 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  const p        = activeProject;
  const stage    = p?.homeowner_stage ?? null;
  const content  = stage ? STAGE_CONTENT[stage] : null;
  const stageIdx = getStageIndex(stage);
  const pct      = stage ? Math.round(((stageIdx + 1) / ROADMAP_STEPS.length) * 100) : 0;

  // Last updated from history or fallback
  const projectHistory = history.filter(h => h.project_id === p?.id);
  const lastUpdated = projectHistory.length > 0
    ? formatDate(projectHistory[0].created_at)
    : p ? formatDate(p.updated_at) : null;

  return (
    <div className="min-h-screen bg-[#09090f] text-white">

      {/* Ambient glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden z-0">
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[900px] h-[400px] rounded-full bg-amber-500/4 blur-[150px]" />
        <div className="absolute top-1/2 left-1/4 w-[400px] h-[300px] rounded-full bg-blue-500/3 blur-[120px]" />
      </div>

      {/* ── NAV ── */}
      <header className="sticky top-0 z-30 border-b border-white/5 bg-[#09090f]/85 backdrop-blur-md">
        <div className="max-w-4xl mx-auto px-5 sm:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/20 flex items-center justify-center">
              <Sun size={16} className="text-amber-400" />
            </div>
            <div>
              <div className="text-sm font-bold leading-none">SolarPro</div>
              <div className="text-[10px] text-slate-500 mt-0.5">Homeowner Portal</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {client && (
              <span className="text-xs text-slate-500 hidden sm:block">{client.email}</span>
            )}
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-white border border-white/8 hover:border-white/20 rounded-lg px-3 py-1.5 transition-all"
            >
              <LogOut size={12} />
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-5 sm:px-8 py-10 space-y-8 relative z-10">

        {/* ── MULTI-PROJECT SWITCHER ── */}
        {projects.length > 1 && (
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {projects.map(proj => (
              <button
                key={proj.id}
                onClick={() => setActiveProject(proj)}
                className={`flex-shrink-0 text-xs font-medium px-3 py-1.5 rounded-full border transition-all ${
                  activeProject?.id === proj.id
                    ? 'bg-amber-500/20 border-amber-500/30 text-amber-300'
                    : 'bg-white/4 border-white/8 text-slate-400 hover:text-white'
                }`}
              >
                {proj.address ? proj.address.split(',')[0] : proj.name}
              </button>
            ))}
          </div>
        )}

        {/* ── 1. HERO HEADER ── */}
        {p ? (
          <div className="relative rounded-3xl overflow-hidden border border-white/8 bg-gradient-to-br from-[#141420] via-[#10101a] to-[#0d0d14]">
            {/* Decorative top glow */}
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-amber-500/40 to-transparent" />

            <div className="px-6 sm:px-10 py-8">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-amber-500/70 mb-2">Your Solar Project</p>
                  <h1 className="text-3xl sm:text-4xl font-black text-white leading-tight">
                    Hi, {client ? getFirstName(client.name) : 'there'} 👋
                  </h1>
                  {p.address && (
                    <div className="flex items-center gap-2 mt-2.5">
                      <MapPin size={13} className="text-slate-500 shrink-0" />
                      <span className="text-sm text-slate-300">{p.address}</span>
                    </div>
                  )}
                  {lastUpdated && (
                    <div className="flex items-center gap-2 mt-1.5">
                      <Clock size={11} className="text-slate-600 shrink-0" />
                      <span className="text-xs text-slate-500">Last updated {lastUpdated}</span>
                    </div>
                  )}
                </div>

                {/* Stage badge */}
                {content && (
                  <div className="sm:text-right flex-shrink-0">
                    <div className="inline-flex items-center gap-2 bg-amber-500/15 border border-amber-500/25 rounded-2xl px-4 py-2.5">
                      <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                      <span className="text-sm font-bold text-amber-300">{content.roadmapLabel}</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1.5 hidden sm:block">
                      Step {stageIdx + 1} of {ROADMAP_STEPS.length}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-3xl border border-white/8 bg-white/2 p-10 text-center">
            <Sun size={40} className="text-amber-400/20 mx-auto mb-4" />
            <p className="text-slate-400">Your project will appear here once our team sets it up.</p>
          </div>
        )}

        {p && (
          <>
            {/* ── 2. ROADMAP CENTERPIECE ── */}
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

              {/* Progress fill bar */}
              <div className="mt-6 h-1.5 bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-green-500 via-amber-500 to-amber-400 rounded-full transition-all duration-700"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>

            {/* ── 3. CURRENT STAGE PANEL ── */}
            {content && (
              <div className="rounded-3xl border border-amber-500/15 bg-gradient-to-br from-amber-500/8 to-orange-500/4 p-6 sm:p-8">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                  <span className="text-xs font-bold uppercase tracking-widest text-amber-500/80">Current Stage</span>
                </div>
                <h2 className="text-2xl sm:text-3xl font-black text-white mb-3 leading-tight">
                  {content.headline}
                </h2>

                <div className="grid sm:grid-cols-3 gap-4 mt-6">
                  {/* What's happening */}
                  <div className="bg-white/5 border border-white/8 rounded-2xl p-4 space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Happening Now</p>
                    <p className="text-sm text-slate-200 leading-relaxed">{content.now}</p>
                  </div>

                  {/* What's next */}
                  <div className="bg-white/5 border border-white/8 rounded-2xl p-4 space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">What Happens Next</p>
                    <p className="text-sm text-slate-200 leading-relaxed">{content.next}</p>
                  </div>

                  {/* Action */}
                  <div className={`border rounded-2xl p-4 space-y-2 ${
                    content.actionIsRequired
                      ? 'bg-blue-500/8 border-blue-500/20'
                      : 'bg-green-500/6 border-green-500/15'
                  }`}>
                    <div className="flex items-center gap-1.5">
                      {content.actionIsRequired
                        ? <AlertCircle size={11} className="text-blue-400" />
                        : <CheckCircle2 size={11} className="text-green-400" />
                      }
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Action Required</p>
                    </div>
                    <p className={`text-sm font-medium leading-relaxed ${
                      content.actionIsRequired ? 'text-blue-200' : 'text-green-300'
                    }`}>
                      {content.action}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* ── 4. PROJECT SNAPSHOT CARDS ── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-2xl border border-white/8 bg-white/2 p-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-2">Address</p>
                <p className="text-sm font-semibold text-white leading-snug">
                  {p.address ? p.address.split(',')[0] : '—'}
                </p>
                {p.address?.includes(',') && (
                  <p className="text-xs text-slate-500 mt-0.5">
                    {p.address.split(',').slice(1).join(',').trim()}
                  </p>
                )}
              </div>

              <div className="rounded-2xl border border-white/8 bg-white/2 p-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-2">System Size</p>
                {p.system_size_kw ? (
                  <>
                    <p className="text-2xl font-black text-white">{p.system_size_kw}</p>
                    <p className="text-xs text-amber-400 font-semibold">kW</p>
                  </>
                ) : (
                  <p className="text-sm text-slate-500">Pending design</p>
                )}
              </div>

              <div className="rounded-2xl border border-white/8 bg-white/2 p-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-2">Current Stage</p>
                <p className="text-sm font-semibold text-amber-300 leading-snug">
                  {content?.roadmapLabel ?? '—'}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">Step {stageIdx + 1} of 7</p>
              </div>

              <div className="rounded-2xl border border-white/8 bg-white/2 p-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-2">Progress</p>
                <p className="text-2xl font-black text-white">{pct}<span className="text-sm font-bold text-slate-400">%</span></p>
                <div className="h-1 bg-white/5 rounded-full mt-2 overflow-hidden">
                  <div
                    className="h-full bg-amber-500 rounded-full transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            </div>

            {/* ── 5. RECENT ACTIVITY ── */}
            {projectHistory.length > 0 && (
              <div className="rounded-3xl border border-white/8 bg-white/2 p-6 sm:p-8">
                <h3 className="text-base font-bold text-white mb-5">Recent Activity</h3>
                <div className="space-y-0">
                  {projectHistory.slice(0, 5).map((entry, i) => (
                    <div key={i} className="flex items-start gap-4 relative">
                      {/* Connector */}
                      {i < Math.min(projectHistory.length, 5) - 1 && (
                        <div className="absolute left-3.5 top-8 bottom-0 w-px bg-white/6" />
                      )}
                      <div className="w-7 h-7 rounded-full bg-white/5 border border-white/10 flex items-center justify-center flex-shrink-0 z-10">
                        <CheckCircle2 size={13} className="text-green-400" />
                      </div>
                      <div className="flex-1 pb-5">
                        <p className="text-sm font-medium text-white">
                          {friendlyStageLabel(entry.stage)}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {formatDateShort(entry.created_at)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── 6. NEXT STEP CARD ── */}
            {content && stageIdx < ROADMAP_STEPS.length - 1 && (
              <div className="rounded-3xl border border-white/8 bg-white/2 p-6 sm:p-8 flex items-center justify-between gap-4">
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
          </>
        )}

        {/* ── 7. HELP / CONTACT CARD ── */}
        <div className="rounded-3xl border border-white/8 bg-white/2 p-6 sm:p-8">
          <h3 className="text-base font-bold text-white mb-1">Questions?</h3>
          <p className="text-sm text-slate-400 mb-5">Contact Under the Sun Solar — we're here to help.</p>
          <div className="flex flex-col sm:flex-row gap-3">
            <a
              href="tel:+1-800-000-0000"
              className="flex items-center gap-3 bg-white/4 hover:bg-white/7 border border-white/8 hover:border-white/15 rounded-2xl px-5 py-3.5 transition-all group"
            >
              <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/15 flex items-center justify-center">
                <Phone size={14} className="text-amber-400" />
              </div>
              <div>
                <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide">Phone</p>
                <p className="text-sm font-semibold text-white group-hover:text-amber-300 transition-colors">(800) 000-0000</p>
              </div>
            </a>
            <a
              href="mailto:hello@underthesun.solar"
              className="flex items-center gap-3 bg-white/4 hover:bg-white/7 border border-white/8 hover:border-white/15 rounded-2xl px-5 py-3.5 transition-all group"
            >
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

        <p className="text-center text-xs text-white/15 pb-4">
          SolarPro · Powered by Under the Sun Solar
        </p>

      </main>
    </div>
  );
}