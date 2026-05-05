'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, RefreshCw, ExternalLink, CheckCircle, Sun,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────────────

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
  created_at: string;
  updated_at: string;
  client_name: string | null;
  client_email: string | null;
}

interface StageHistoryEntry {
  id: string;
  stage: HomeownerStage;
  created_at: string;
}

// ─── Stage config ────────────────────────────────────────────────────────────

const STAGES: {
  value: HomeownerStage;
  label: string;
  friendlyLabel: string;
  description: string;
  color: string;
  bgLight: string;
}[] = [
  {
    value: 'lead_submitted',
    label: 'Lead Submitted',
    friendlyLabel: 'Request Received',
    description: "We've received your request and will be in touch shortly to get things started.",
    color: 'text-slate-600',
    bgLight: 'bg-slate-100',
  },
  {
    value: 'under_review',
    label: 'Under Review',
    friendlyLabel: 'Under Review',
    description: "Our team is reviewing your project details and assessing the best solar solution for your home.",
    color: 'text-blue-600',
    bgLight: 'bg-blue-50',
  },
  {
    value: 'site_survey',
    label: 'Site Survey',
    friendlyLabel: 'Site Survey',
    description: "A technician will visit your property to measure your roof and assess the installation site.",
    color: 'text-cyan-600',
    bgLight: 'bg-cyan-50',
  },
  {
    value: 'design',
    label: 'Design',
    friendlyLabel: 'System Design',
    description: "We are currently designing your solar system based on your home's layout and energy usage.",
    color: 'text-violet-600',
    bgLight: 'bg-violet-50',
  },
  {
    value: 'proposal',
    label: 'Proposal',
    friendlyLabel: 'Proposal Ready',
    description: "Your custom solar proposal is ready. We'll be reaching out to walk you through the details.",
    color: 'text-amber-600',
    bgLight: 'bg-amber-50',
  },
  {
    value: 'installation',
    label: 'Installation',
    friendlyLabel: 'Installation Scheduled',
    description: "Your installation has been scheduled. Our certified crew will install your system on the agreed date.",
    color: 'text-orange-600',
    bgLight: 'bg-orange-50',
  },
  {
    value: 'completed',
    label: 'Completed',
    friendlyLabel: 'Project Complete',
    description: "Congratulations! Your solar system has been installed and is ready to generate clean energy for your home.",
    color: 'text-green-600',
    bgLight: 'bg-green-50',
  },
];

function getStageMeta(stage: HomeownerStage | null) {
  return STAGES.find(s => s.value === stage) ?? STAGES[0];
}

function getStageIndex(stage: HomeownerStage | null) {
  if (!stage) return -1;
  return STAGES.findIndex(s => s.value === stage);
}

function getFirstName(name: string | null): string | null {
  if (!name) return null;
  return name.split(' ')[0];
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function AdminPortalPreview() {
  const { id } = useParams<{ id: string }>();

  const [project, setProject]   = useState<Project | null>(null);
  const [history, setHistory]   = useState<StageHistoryEntry[]>([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await fetch(`/api/admin/projects/${id}`);
      const d = await res.json();
      if (d.success) {
        setProject(d.project);
        setHistory(d.stageHistory ?? []);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-500">
        <RefreshCw size={16} className="animate-spin mr-2" /> Loading preview…
      </div>
    );
  }

  if (!project) {
    return (
      <div className="text-center py-24 text-slate-500">
        Project not found.{' '}
        <Link href="/admin/projects" className="text-blue-400 hover:underline">Back to projects</Link>
      </div>
    );
  }

  const currentStage = project.homeowner_stage;
  const stageMeta    = getStageMeta(currentStage);
  const stageIdx     = getStageIndex(currentStage);
  const firstName    = getFirstName(project.client_name);

  // Last updated: latest history entry or project.updated_at
  const lastUpdated = history.length > 0
    ? new Date(history[0].created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : new Date(project.updated_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div className="space-y-4 max-w-3xl">

      {/* ── Admin Controls ── */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm">
          <Link
            href={`/admin/projects/${id}`}
            className="text-slate-400 hover:text-white transition-colors flex items-center gap-1"
          >
            <ArrowLeft size={14} /> Back to Project
          </Link>
          <span className="text-slate-600">/</span>
          <span className="text-slate-300">Portal Preview</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-lg transition-all disabled:opacity-50"
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
            Refresh Preview
          </button>
          <Link
            href={`/admin/projects/${id}`}
            className="flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 px-3 py-1.5 rounded-lg transition-all"
          >
            <ExternalLink size={12} />
            Edit Stage
          </Link>
        </div>
      </div>

      {/* ── Admin Notice Banner ── */}
      <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl px-4 py-2.5 flex items-center gap-2 text-xs text-blue-300">
        <span className="font-semibold text-blue-400">Admin Preview</span>
        <span className="text-blue-400/50">·</span>
        This is how the homeowner portal will appear to the client. No data is modified.
      </div>

      {/* ══════════════════════════════════════════════════════════
          PORTAL PREVIEW AREA — mimics homeowner experience
          ══════════════════════════════════════════════════════════ */}
      <div className="bg-white rounded-2xl shadow-xl overflow-hidden">

        {/* Portal Header */}
        <div className="bg-gradient-to-r from-amber-400 to-orange-500 px-8 py-6">
          <div className="flex items-center gap-2 mb-1">
            <Sun size={18} className="text-white/80" />
            <span className="text-white/80 text-sm font-medium tracking-wide uppercase">SolarPro</span>
          </div>
          <h1 className="text-2xl font-bold text-white">
            {firstName ? `Hi ${firstName}, ` : ''}Your Solar Project
          </h1>
          {project.address && (
            <p className="text-white/75 text-sm mt-1">{project.address}</p>
          )}
          {project.system_size_kw && (
            <p className="text-white/60 text-xs mt-0.5">{project.system_size_kw} kW system</p>
          )}
        </div>

        {/* Main Content */}
        <div className="px-8 py-7 space-y-8 bg-gray-50">

          {/* Current Stage */}
          <div className={`rounded-xl p-5 border ${stageMeta.bgLight} border-gray-200`}>
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1">Current Stage</p>
            <p className={`text-2xl font-bold ${stageMeta.color}`}>{stageMeta.friendlyLabel}</p>
            <p className="text-gray-500 text-sm mt-2 leading-relaxed">{stageMeta.description}</p>
          </div>

          {/* Progress Bar */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-4">Your Progress</p>
            {/* Desktop: horizontal stepper */}
            <div className="hidden sm:flex items-center gap-0">
              {STAGES.map((s, i) => {
                const isCompleted = i < stageIdx;
                const isCurrent   = i === stageIdx;
                const isFuture    = i > stageIdx;

                return (
                  <div key={s.value} className="flex items-center flex-1 last:flex-none">
                    {/* Step circle */}
                    <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all ${
                        isCompleted
                          ? 'bg-green-500 border-green-500 text-white'
                          : isCurrent
                          ? 'bg-amber-500 border-amber-500 text-white ring-4 ring-amber-500/20'
                          : 'bg-white border-gray-200 text-gray-300'
                      }`}>
                        {isCompleted
                          ? <CheckCircle size={14} />
                          : <span>{i + 1}</span>
                        }
                      </div>
                      <span className={`text-[9px] font-medium text-center leading-tight max-w-[56px] ${
                        isCurrent   ? 'text-amber-600 font-bold' :
                        isCompleted ? 'text-green-600' :
                        'text-gray-300'
                      }`}>
                        {s.friendlyLabel}
                      </span>
                    </div>
                    {/* Connector line */}
                    {i < STAGES.length - 1 && (
                      <div className={`flex-1 h-0.5 mx-1 rounded ${
                        i < stageIdx ? 'bg-green-400' : 'bg-gray-200'
                      }`} />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Mobile: vertical list */}
            <div className="sm:hidden space-y-2">
              {STAGES.map((s, i) => {
                const isCompleted = i < stageIdx;
                const isCurrent   = i === stageIdx;
                return (
                  <div key={s.value} className={`flex items-center gap-3 px-3 py-2 rounded-lg ${
                    isCurrent ? 'bg-amber-50 border border-amber-200' :
                    isCompleted ? 'opacity-60' : 'opacity-30'
                  }`}>
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                      isCompleted ? 'bg-green-500 text-white' :
                      isCurrent   ? 'bg-amber-500 text-white' :
                      'bg-gray-200 text-gray-400'
                    }`}>
                      {isCompleted ? <CheckCircle size={12} /> : i + 1}
                    </div>
                    <span className={`text-sm font-medium ${
                      isCurrent ? 'text-amber-700' : isCompleted ? 'text-gray-600' : 'text-gray-300'
                    }`}>{s.friendlyLabel}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Last Updated */}
          <div className="flex items-center justify-between pt-2 border-t border-gray-200">
            <p className="text-xs text-gray-400">
              Last updated: <span className="text-gray-600 font-medium">{lastUpdated}</span>
            </p>
            {project.system_size_kw && (
              <p className="text-xs text-gray-400">
                System: <span className="text-gray-600 font-medium">{project.system_size_kw} kW</span>
              </p>
            )}
          </div>

        </div>

        {/* Portal Footer */}
        <div className="bg-white border-t border-gray-100 px-8 py-4 flex items-center justify-between">
          <p className="text-xs text-gray-400">Questions? Contact your project manager.</p>
          <div className="flex items-center gap-1.5 text-xs text-amber-500 font-medium">
            <Sun size={11} />
            SolarPro
          </div>
        </div>

      </div>
      {/* end portal preview */}

    </div>
  );
}