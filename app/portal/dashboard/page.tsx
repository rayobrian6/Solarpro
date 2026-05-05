'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sun, MapPin, Zap, LogOut, RefreshCw, CheckCircle2, Circle } from 'lucide-react';

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

interface Client {
  id: string;
  name: string;
  email: string;
}

// ─── Stage Definitions (Hard Spec) ───────────────────────────────────────────

const STAGE_CONTENT: Record<HomeownerStage, {
  title: string;
  description: string;
  happening: string[];
  next: string;
  action: string;
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

function getFirstName(name: string): string {
  return name.split(' ')[0];
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });
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
              {/* Step */}
              <div className="flex flex-col items-center gap-2 flex-shrink-0 w-16">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center border-2 transition-all ${
                  isCurrent
                    ? 'bg-amber-500 border-amber-400 shadow-lg shadow-amber-500/30'
                    : isPast
                    ? 'bg-green-500/20 border-green-500/40'
                    : 'bg-white/3 border-white/10'
                }`}>
                  {isPast ? (
                    <CheckCircle2 size={16} className="text-green-400" />
                  ) : isCurrent ? (
                    <div className="w-3 h-3 rounded-full bg-white" />
                  ) : (
                    <Circle size={16} className="text-white/15" />
                  )}
                </div>
                <span className={`text-[10px] font-medium text-center leading-tight w-full ${
                  isCurrent ? 'text-amber-400 font-semibold' :
                  isPast    ? 'text-white/40' :
                              'text-white/20'
                }`}>
                  {s.label}
                </span>
              </div>

              {/* Connector */}
              {!isLast && (
                <div className={`flex-1 h-0.5 mt-4 rounded-full ${
                  isPast ? 'bg-green-500/30' :
                  isCurrent ? 'bg-white/10' :
                  'bg-white/5'
                }`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function PortalDashboard() {
  const router = useRouter();
  const [client, setClient]     = useState<Client | null>(null);
  const [project, setProject]   = useState<Project | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');

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
      const projects: Project[] = d.projects ?? [];
      const p = projects[0] ?? null;
      setProject(p);

      // Last updated: latest stage history entry or project.updated_at
      if (p) {
        try {
          const hr = await fetch(`/api/portal/stage-history?projectId=${p.id}`);
          const hd = await hr.json();
          if (hd.success && hd.history?.length > 0) {
            setLastUpdated(formatDate(hd.history[0].created_at));
          } else {
            setLastUpdated(formatDate(p.updated_at));
          }
        } catch {
          setLastUpdated(formatDate(p.updated_at));
        }
      }
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

  // ─── Loading ─────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#08090e]">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <RefreshCw size={20} className="animate-spin" />
          <span className="text-sm">Loading your project…</span>
        </div>
      </div>
    );
  }

  // ─── Error ────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#08090e] px-4">
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

  const stage   = project?.homeowner_stage ?? null;
  const content = stage ? STAGE_CONTENT[stage] : null;
  const stageIdx = getStageIndex(stage);
  const pct = stage ? Math.round(((stageIdx + 1) / STAGES.length) * 100) : 0;

  return (
    <div className="min-h-screen bg-[#08090e] text-white">

      {/* Ambient glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[300px] rounded-full bg-amber-500/5 blur-[120px]" />
      </div>

      {/* ── NAV ── */}
      <header className="border-b border-white/5 bg-[#08090e]/80 backdrop-blur-sm sticky top-0 z-20">
        <div className="max-w-3xl mx-auto px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center">
              <Sun size={15} className="text-amber-400" />
            </div>
            <span className="text-sm font-bold tracking-tight">SolarPro</span>
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

      <main className="max-w-3xl mx-auto px-5 py-10 space-y-6 relative z-10">

        {/* ── 1. HEADER ── */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-1">Your Solar Project</p>
          <h1 className="text-3xl font-black text-white leading-tight">
            {client ? `Hi, ${getFirstName(client.name)}` : 'Your Dashboard'}
          </h1>
          {project?.address && (
            <div className="flex items-center gap-1.5 mt-2">
              <MapPin size={12} className="text-slate-500 shrink-0" />
              <span className="text-sm text-slate-400">{project.address}</span>
            </div>
          )}
        </div>

        {/* ── 2. CURRENT STATUS BLOCK ── */}
        {content ? (
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-6 space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-xs font-bold uppercase tracking-widest text-amber-500">Current Status</span>
            </div>
            <h2 className="text-2xl font-black text-white leading-snug">{content.title}</h2>
            <p className="text-slate-300 text-sm leading-relaxed">{content.description}</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-white/8 bg-white/3 p-6">
            <p className="text-slate-400 text-sm">Your project status will appear here once our team gets started.</p>
          </div>
        )}

        {/* ── 3. WHAT IS HAPPENING NOW ── */}
        {content && (
          <div className="rounded-2xl border border-white/8 bg-white/2 p-6 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">What Is Happening Now</h3>
            <ul className="space-y-2.5">
              {content.happening.map((item, i) => (
                <li key={i} className="flex items-start gap-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-1.5 shrink-0" />
                  <span className="text-sm text-slate-300 leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── 4. WHAT HAPPENS NEXT ── */}
        {content && (
          <div className="rounded-2xl border border-white/8 bg-white/2 p-6 space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">What Happens Next</h3>
            <p className="text-sm text-slate-300 leading-relaxed">{content.next}</p>
          </div>
        )}

        {/* ── 5. ACTION REQUIRED ── */}
        {content && (
          <div className="rounded-2xl border border-white/8 bg-white/2 p-5 flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
              <CheckCircle2 size={15} className="text-green-400" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-0.5">Action Required</p>
              <p className="text-sm text-slate-300">{content.action}</p>
            </div>
          </div>
        )}

        {/* ── 6. PROGRESS TRACKER ── */}
        <div className="rounded-2xl border border-white/8 bg-white/2 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Progress</h3>
            <span className="text-xs font-bold text-white">{pct}%</span>
          </div>
          <ProgressTracker stage={stage} />
        </div>

        {/* ── 7. PROJECT DETAILS ── */}
        {project && (
          <div className="rounded-2xl border border-white/8 bg-white/2 p-6 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Project Details</h3>
            <div className="space-y-2">
              {project.system_size_kw && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-400 flex items-center gap-2">
                    <Zap size={13} className="text-amber-400" /> System Size
                  </span>
                  <span className="text-sm font-semibold text-white">{project.system_size_kw} kW</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">Last Updated</span>
                <span className="text-sm font-medium text-white">{lastUpdated ?? formatDate(project.updated_at)}</span>
              </div>
            </div>
          </div>
        )}

        {/* ── NO PROJECT ── */}
        {!project && !loading && (
          <div className="rounded-2xl border border-white/8 bg-white/2 p-10 text-center">
            <Sun size={36} className="text-amber-400/30 mx-auto mb-4" />
            <p className="text-slate-400 text-sm">Your project will appear here once our team sets it up.</p>
          </div>
        )}

        <p className="text-center text-xs text-slate-700 pb-4">
          Questions? Contact your solar advisor.
        </p>

      </main>
    </div>
  );
}