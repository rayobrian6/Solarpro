'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Sun, MapPin, LogOut, RefreshCw,
  CheckCircle2, Circle, Clock,
  Phone, Mail, AlertCircle,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

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
  description: string;
  next: string;
  action: string;
  actionIsRequired: boolean;
};

const STAGE_CONTENT: Record<HomeownerStage, StageContent> = {
  lead_submitted: {
    roadmapLabel:     'Request Received',
    headline:         'We Received Your Request',
    description:      'We\'re reviewing your solar inquiry and getting familiar with your home and energy needs.',
    next:             'Next: Our team will reach out to discuss your project and determine the right path forward.',
    action:           'You don\'t need to do anything right now.',
    actionIsRequired: false,
  },
  under_review: {
    roadmapLabel:     'Under Review',
    headline:         'We\'re Reviewing Your Project',
    description:      'We are currently reviewing your property details and energy needs to plan the best solar solution for your home.',
    next:             'Next: We will schedule your site survey once the review is complete.',
    action:           'You don\'t need to do anything right now.',
    actionIsRequired: false,
  },
  site_survey: {
    roadmapLabel:     'Site Survey',
    headline:         'Your Site Survey is Scheduled',
    description:      'We\'re gathering the on-site details needed to design your system accurately. A team member will visit your property.',
    next:             'Next: After the survey, your custom system design will begin.',
    action:           'We\'ll contact you to confirm your appointment window.',
    actionIsRequired: true,
  },
  design: {
    roadmapLabel:     'System Design',
    headline:         'We\'re Designing Your Solar System',
    description:      'Our engineers are creating a custom solar design tailored to your home\'s layout, energy usage, and goals.',
    next:             'Next: Your proposal will be prepared once the design is finalized.',
    action:           'You don\'t need to do anything right now.',
    actionIsRequired: false,
  },
  proposal: {
    roadmapLabel:     'Proposal',
    headline:         'Your Proposal is Ready',
    description:      'Your custom solar proposal has been prepared and is ready for your review. It includes system specs, pricing, and projected savings.',
    next:             'Next: Once you approve the proposal, we\'ll move forward with installation planning.',
    action:           'Please review your proposal and let us know if you have any questions.',
    actionIsRequired: true,
  },
  installation: {
    roadmapLabel:     'Installation',
    headline:         'Your Installation is Being Prepared',
    description:      'Your solar system installation is being planned and scheduled. Our crew will handle everything from permitting to final setup.',
    next:             'Next: We\'ll confirm your installation date and walk you through what to expect.',
    action:           'We\'ll contact you with scheduling details.',
    actionIsRequired: true,
  },
  completed: {
    roadmapLabel:     'Complete',
    headline:         'Your Solar Project is Complete 🎉',
    description:      'Your solar system has been installed and is fully operational. Welcome to clean energy — you\'re officially generating your own power.',
    next:             'Enjoy your new solar system and the savings that come with it.',
    action:           'No action needed. Your system is up and running.',
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

// ─── Roadmap (HERO — dominant, large) ────────────────────────────────────────

function Roadmap({ stage }: { stage: HomeownerStage | null }) {
  const currentIdx = getStageIndex(stage);

  return (
    <>
      {/* Desktop: horizontal */}
      <div className="hidden md:block">
        <div className="relative flex items-start pt-4 pb-2">
          {/* Base track */}
          <div className="absolute top-[28px] left-0 right-0 h-[3px] bg-white/6 z-0" />

          {ROADMAP_STEPS.map((s, i) => {
            const isPast    = i < currentIdx;
            const isCurrent = i === currentIdx;
            const content   = STAGE_CONTENT[s];

            return (
              <div key={s} className="flex-1 flex flex-col items-center relative z-10">
                {/* Filled track segment */}
                {i > 0 && (
                  <div className={`absolute top-[28px] right-1/2 left-[-50%] h-[3px] z-0 transition-all ${
                    isPast || isCurrent
                      ? 'bg-gradient-to-r from-green-500/80 to-green-400/60'
                      : 'bg-white/6'
                  }`} />
                )}

                {/* Node */}
                <div className={`relative flex items-center justify-center rounded-full border-[3px] transition-all z-10 ${
                  isCurrent
                    ? 'w-14 h-14 bg-amber-500 border-amber-300 shadow-2xl shadow-amber-500/50'
                    : isPast
                    ? 'w-12 h-12 bg-green-500/25 border-green-500/60'
                    : 'w-12 h-12 bg-[#0f1119] border-white/10'
                }`}>
                  {isPast
                    ? <CheckCircle2 size={22} className="text-green-400" />
                    : isCurrent
                    ? <div className="w-4 h-4 rounded-full bg-white animate-pulse" />
                    : <Circle size={20} className="text-white/15" />
                  }
                  {isCurrent && (
                    <>
                      <div className="absolute inset-0 rounded-full bg-amber-500/30 animate-ping scale-[1.6] pointer-events-none" />
                      <div className="absolute inset-[-6px] rounded-full border-2 border-amber-400/30 pointer-events-none" />
                    </>
                  )}
                </div>

                {/* Label */}
                <span className={`mt-3 text-xs font-bold text-center leading-tight max-w-[80px] transition-all ${
                  isCurrent ? 'text-amber-300' :
                  isPast    ? 'text-green-400/80' :
                              'text-white/25'
                }`}>
                  {content.roadmapLabel}
                </span>

                {isCurrent && (
                  <span className="mt-1 text-[10px] font-black text-amber-500/70 uppercase tracking-widest">
                    YOU ARE HERE
                  </span>
                )}
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
              <div className="flex flex-col items-center w-10 flex-shrink-0">
                <div className={`rounded-full flex items-center justify-center border-[3px] flex-shrink-0 transition-all ${
                  isCurrent
                    ? 'w-10 h-10 bg-amber-500 border-amber-300 shadow-lg shadow-amber-500/40'
                    : isPast
                    ? 'w-9 h-9 bg-green-500/20 border-green-500/50'
                    : 'w-9 h-9 bg-white/3 border-white/8'
                }`}>
                  {isPast
                    ? <CheckCircle2 size={16} className="text-green-400" />
                    : isCurrent
                    ? <div className="w-3 h-3 rounded-full bg-white animate-pulse" />
                    : <Circle size={16} className="text-white/10" />
                  }
                </div>
                {!isLast && (
                  <div className={`w-[3px] flex-1 min-h-[28px] mt-1 rounded-full ${
                    isPast ? 'bg-green-500/40' : 'bg-white/6'
                  }`} />
                )}
              </div>

              <div className={`pb-5 pt-1.5 flex-1 ${isLast ? 'pb-0' : ''}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-sm font-bold ${
                    isCurrent ? 'text-amber-300' :
                    isPast    ? 'text-white/50' :
                                'text-white/20'
                  }`}>
                    {content.roadmapLabel}
                  </span>
                  {isCurrent && (
                    <span className="text-[9px] font-black bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full uppercase tracking-wider">
                      Current
                    </span>
                  )}
                  {isPast && (
                    <span className="text-[10px] font-bold text-green-500/60">✓</span>
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

  const [client,        setClient]        = useState<Client | null>(null);
  const [projects,      setProjects]      = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [history,       setHistory]       = useState<StageHistory[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState('');

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

  // Loading
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

  // Error
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
              <div className="text-sm font-bold leading-none">Under the Sun Solar</div>
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

      <main className="max-w-4xl mx-auto px-5 sm:px-8 py-10 relative z-10 space-y-10">

        {/* Multi-project switcher */}
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

        {/* ── 1. HEADER ── */}
        {p ? (
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-amber-500/60 mb-3">Your Solar Project</p>
            <h1 className="text-4xl sm:text-5xl font-black text-white leading-tight">
              Hi, {client ? getFirstName(client.name) : 'there'} 👋
            </h1>
            {p.address && (
              <div className="flex items-center gap-2 mt-3">
                <MapPin size={13} className="text-slate-500 shrink-0" />
                <span className="text-sm text-slate-400">{p.address}</span>
              </div>
            )}
            {lastUpdated && (
              <div className="flex items-center gap-2 mt-1.5">
                <Clock size={11} className="text-slate-600 shrink-0" />
                <span className="text-xs text-slate-600">Last updated {lastUpdated}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-3xl border border-white/8 bg-white/2 p-10 text-center">
            <Sun size={40} className="text-amber-400/20 mx-auto mb-4" />
            <p className="text-slate-400">Your project will appear here once our team sets it up.</p>
          </div>
        )}

        {p && (
          <>
            {/* ── 2. ROADMAP (HERO) ── */}
            <div className="rounded-3xl border border-white/8 bg-gradient-to-b from-white/[0.04] to-transparent px-6 sm:px-10 py-8">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-xl font-black text-white">Project Roadmap</h2>
                  <p className="text-xs text-slate-500 mt-0.5">Your journey to solar energy</p>
                </div>
                <div className="text-right">
                  <span className="text-3xl font-black text-white">{pct}%</span>
                  <p className="text-[10px] text-slate-500 uppercase tracking-widest mt-0.5">Complete</p>
                </div>
              </div>

              <Roadmap stage={stage} />

              {/* Progress fill bar */}
              <div className="mt-8 h-2 bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-green-500 via-amber-400 to-amber-500 rounded-full transition-all duration-700"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>

            {/* ── 3. CURRENT STAGE (PRIMARY CONTENT) ── */}
            {content && (
              <div className="rounded-3xl border border-amber-500/20 bg-gradient-to-br from-amber-500/10 to-orange-500/5 px-6 sm:px-10 py-8">
                {/* Label */}
                <div className="flex items-center gap-2 mb-5">
                  <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                  <span className="text-xs font-black uppercase tracking-widest text-amber-500/80">Currently</span>
                </div>

                {/* Big title */}
                <h2 className="text-3xl sm:text-4xl font-black text-white leading-tight mb-5">
                  {content.headline}
                </h2>

                {/* Description */}
                <p className="text-base text-slate-300 leading-relaxed mb-4">
                  {content.description}
                </p>

                {/* Trust signal */}
                <p className="text-sm font-semibold text-green-400/80 mb-6">
                  ✓ Your project is moving forward as expected
                </p>

                {/* Divider */}
                <div className="h-px bg-white/8 mb-6" />

                {/* Next + Action in clean rows */}
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full bg-white/8 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-[10px] font-black text-white/60">→</span>
                    </div>
                    <p className="text-sm text-slate-300 leading-relaxed">{content.next}</p>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                      content.actionIsRequired ? 'bg-blue-500/20' : 'bg-green-500/15'
                    }`}>
                      {content.actionIsRequired
                        ? <AlertCircle size={11} className="text-blue-400" />
                        : <CheckCircle2 size={11} className="text-green-400" />
                      }
                    </div>
                    <p className={`text-sm font-semibold leading-relaxed ${
                      content.actionIsRequired ? 'text-blue-300' : 'text-green-300'
                    }`}>
                      {content.action}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* ── 4. PROJECT SNAPSHOT (SECONDARY) ── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="rounded-xl border border-white/6 bg-white/[0.015] px-4 py-3">
                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-700 mb-1.5">Address</p>
                <p className="text-xs font-semibold text-slate-400 leading-snug">
                  {p.address ? p.address.split(',')[0] : '—'}
                </p>
              </div>

              <div className="rounded-xl border border-white/6 bg-white/[0.015] px-4 py-3">
                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-700 mb-1.5">System Size</p>
                {p.system_size_kw ? (
                  <p className="text-sm font-black text-slate-400">
                    {p.system_size_kw} <span className="text-xs font-semibold text-amber-500/60">kW</span>
                  </p>
                ) : (
                  <p className="text-xs text-slate-600">Pending</p>
                )}
              </div>

              <div className="rounded-xl border border-white/6 bg-white/[0.015] px-4 py-3">
                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-700 mb-1.5">Stage</p>
                <p className="text-xs font-semibold text-slate-400">{content?.roadmapLabel ?? '—'}</p>
              </div>

              <div className="rounded-xl border border-white/6 bg-white/[0.015] px-4 py-3">
                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-700 mb-1.5">Progress</p>
                <p className="text-sm font-black text-slate-400">{pct}<span className="text-xs font-bold text-slate-600">%</span></p>
              </div>
            </div>

            {/* ── 5. CONTACT ── */}
            <div className="rounded-3xl border border-white/8 bg-white/[0.015] px-6 sm:px-10 py-7">
              <h3 className="text-base font-bold text-white mb-1">Questions?</h3>
              <p className="text-sm text-slate-500 mb-5">Contact Under the Sun Solar — we're here to help.</p>
              <div className="flex flex-col sm:flex-row gap-3">
                <a
                  href="tel:+1-800-000-0000"
                  className="flex items-center gap-3 bg-white/4 hover:bg-white/6 border border-white/8 hover:border-white/15 rounded-2xl px-5 py-3.5 transition-all group"
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
                  className="flex items-center gap-3 bg-white/4 hover:bg-white/6 border border-white/8 hover:border-white/15 rounded-2xl px-5 py-3.5 transition-all group"
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
          </>
        )}

        <p className="text-center text-xs text-white/10 pb-4">
          Powered by Under the Sun Solar
        </p>

      </main>
    </div>
  );
}