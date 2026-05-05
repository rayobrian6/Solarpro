'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Sun, MapPin, Zap, LogOut, RefreshCw,
  CheckCircle2, Circle, Clock,
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

interface Client {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

// ─── Stage config ─────────────────────────────────────────────────────────────

const STAGES: {
  value: HomeownerStage;
  label: string;
  description: string;
  color: string;
  bg: string;
  dot: string;
  glow: string;
}[] = [
  {
    value:       'lead_submitted',
    label:       'Request Received',
    description: 'We have received your information and will be in touch shortly.',
    color:       'text-slate-300',
    bg:          'bg-slate-500/15',
    dot:         'bg-slate-400',
    glow:        '',
  },
  {
    value:       'under_review',
    label:       'Under Review',
    description: 'Our team is reviewing your project details and eligibility.',
    color:       'text-blue-300',
    bg:          'bg-blue-500/15',
    dot:         'bg-blue-400',
    glow:        'shadow-blue-500/20',
  },
  {
    value:       'site_survey',
    label:       'Site Survey',
    description: 'A technician will visit your home to assess the installation site.',
    color:       'text-cyan-300',
    bg:          'bg-cyan-500/15',
    dot:         'bg-cyan-400',
    glow:        'shadow-cyan-500/20',
  },
  {
    value:       'design',
    label:       'System Design',
    description: 'Our engineers are designing your custom solar system.',
    color:       'text-violet-300',
    bg:          'bg-violet-500/15',
    dot:         'bg-violet-400',
    glow:        'shadow-violet-500/20',
  },
  {
    value:       'proposal',
    label:       'Proposal Ready',
    description: 'Your custom proposal is ready. Our team will walk you through it.',
    color:       'text-amber-300',
    bg:          'bg-amber-500/15',
    dot:         'bg-amber-400',
    glow:        'shadow-amber-500/20',
  },
  {
    value:       'installation',
    label:       'Installation',
    description: 'Your solar system is being installed. Almost there!',
    color:       'text-orange-300',
    bg:          'bg-orange-500/15',
    dot:         'bg-orange-400',
    glow:        'shadow-orange-500/20',
  },
  {
    value:       'completed',
    label:       'Complete',
    description: 'Your solar system is installed and operational. Welcome to clean energy!',
    color:       'text-green-300',
    bg:          'bg-green-500/15',
    dot:         'bg-green-400',
    glow:        'shadow-green-500/20',
  },
];

function getStageMeta(stage: HomeownerStage | null) {
  return STAGES.find(s => s.value === stage) ?? null;
}

function getStageIndex(stage: HomeownerStage | null) {
  return stage ? STAGES.findIndex(s => s.value === stage) : -1;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────

function ProgressBar({ stage }: { stage: HomeownerStage | null }) {
  const currentIndex = getStageIndex(stage);

  return (
    <div className="w-full">
      {/* Step indicators */}
      <div className="flex items-start">
        {STAGES.map((s, i) => {
          const isPast    = i < currentIndex;
          const isCurrent = i === currentIndex;
          const isFuture  = i > currentIndex;
          const isLast    = i === STAGES.length - 1;

          return (
            <div key={s.value} className="flex items-start flex-1 min-w-0">
              {/* Step */}
              <div className="flex flex-col items-center gap-1.5 relative z-10">
                {/* Icon */}
                <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all ${
                  isCurrent
                    ? `${s.bg} border-current ${s.color} shadow-lg ${s.glow}`
                    : isPast
                    ? 'bg-white/10 border-white/20'
                    : 'bg-white/3 border-white/8'
                }`}>
                  {isCurrent ? (
                    <div className={`w-3 h-3 rounded-full ${s.dot}`} />
                  ) : isPast ? (
                    <CheckCircle2 size={14} className="text-white/60" />
                  ) : (
                    <Circle size={14} className="text-white/15" />
                  )}
                </div>
                {/* Label */}
                <span className={`text-[10px] font-medium text-center leading-tight max-w-[60px] hidden sm:block ${
                  isCurrent ? s.color : isPast ? 'text-white/40' : 'text-white/20'
                }`}>
                  {s.label}
                </span>
              </div>

              {/* Connector */}
              {!isLast && (
                <div className={`flex-1 h-0.5 mt-4 mx-1 rounded-full transition-all ${
                  isPast || isCurrent ? 'bg-white/20' : 'bg-white/5'
                }`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Project Card ─────────────────────────────────────────────────────────────

function ProjectCard({ project }: { project: Project }) {
  const meta         = getStageMeta(project.homeowner_stage);
  const currentIndex = getStageIndex(project.homeowner_stage);
  const pct          = project.homeowner_stage
    ? Math.round(((currentIndex + 1) / STAGES.length) * 100)
    : 0;

  return (
    <div className="rounded-2xl border border-white/8 bg-white/3 overflow-hidden">

      {/* Header */}
      <div className="px-6 pt-6 pb-4 border-b border-white/5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-white truncate">{project.name}</h2>
            {project.address && (
              <div className="flex items-center gap-1.5 mt-1">
                <MapPin size={11} className="text-slate-500 shrink-0" />
                <span className="text-xs text-slate-400 truncate">{project.address}</span>
              </div>
            )}
          </div>
          {project.system_size_kw && (
            <div className="flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg px-2.5 py-1 shrink-0">
              <Zap size={11} className="text-amber-400" />
              <span className="text-xs font-semibold text-amber-300">{project.system_size_kw} kW</span>
            </div>
          )}
        </div>
      </div>

      {/* Current stage callout */}
      <div className="px-6 py-5">
        {meta ? (
          <div className={`rounded-xl ${meta.bg} border border-white/8 px-4 py-4 mb-6`}>
            <div className="flex items-center gap-2 mb-1">
              <div className={`w-2 h-2 rounded-full ${meta.dot} animate-pulse`} />
              <span className={`text-xs font-bold uppercase tracking-widest ${meta.color}`}>
                Current Stage
              </span>
            </div>
            <p className={`text-xl font-black ${meta.color}`}>{meta.label}</p>
            <p className="text-sm text-slate-400 mt-1">{meta.description}</p>
          </div>
        ) : (
          <div className="rounded-xl bg-white/3 border border-white/8 px-4 py-4 mb-6">
            <p className="text-sm text-slate-500 italic">Stage information coming soon.</p>
          </div>
        )}

        {/* Progress bar */}
        <div className="mb-2">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Progress</span>
            <span className="text-xs font-bold text-white">{pct}%</span>
          </div>
          <ProgressBar stage={project.homeowner_stage} />
        </div>
      </div>

      {/* Footer */}
      <div className="px-6 pb-5 pt-1">
        <div className="flex items-center gap-1 text-xs text-slate-600">
          <Clock size={10} />
          <span>Last updated {formatDate(project.updated_at)}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Dashboard Page ──────────────────────────────────────────────────────────

export default function PortalDashboard() {
  const router   = useRouter();
  const [client, setClient]     = useState<Client | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
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
      setProjects(d.projects ?? []);
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
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a0f]">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <RefreshCw size={20} className="animate-spin" />
          <span className="text-sm">Loading your project…</span>
        </div>
      </div>
    );
  }

  // ─── Error ───────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a0f] px-4">
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

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0a0a0f] px-4 py-8 sm:px-6">

      {/* Background glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute top-[-10%] left-1/2 -translate-x-1/2 w-[700px] h-[400px] rounded-full bg-amber-500/4 blur-[140px]" />
      </div>

      <div className="max-w-2xl mx-auto relative z-10 space-y-6">

        {/* Top nav */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
              <Sun size={16} className="text-amber-400" />
            </div>
            <span className="text-sm font-bold text-white">SolarPro</span>
          </div>

          <div className="flex items-center gap-3">
            {client && (
              <span className="text-xs text-slate-500 hidden sm:block">{client.email}</span>
            )}
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-white border border-white/10 hover:border-white/20 rounded-lg px-3 py-1.5 transition-all"
            >
              <LogOut size={12} />
              Sign out
            </button>
          </div>
        </div>

        {/* Welcome */}
        {client && (
          <div>
            <h1 className="text-2xl font-black text-white">
              Hi, {client.name.split(' ')[0]} 👋
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Here's the latest on your solar installation.
            </p>
          </div>
        )}

        {/* Projects */}
        {projects.length === 0 ? (
          <div className="rounded-2xl border border-white/8 bg-white/3 p-8 text-center">
            <Sun size={32} className="text-amber-400/30 mx-auto mb-3" />
            <p className="text-slate-400 text-sm">No projects found yet.</p>
            <p className="text-slate-600 text-xs mt-1">
              Your project will appear here once our team sets it up.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {projects.map(p => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
        )}

        {/* Footer */}
        <p className="text-center text-xs text-slate-700 pb-4">
          Questions? Contact your solar advisor.
        </p>
      </div>
    </div>
  );
}