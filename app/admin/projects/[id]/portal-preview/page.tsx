'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, RefreshCw, ExternalLink, Sun,
  MapPin, Clock, CheckCircle2, Circle,
  AlertCircle, Zap, TrendingUp, Home, Phone, Mail,
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

// ─── Stage Definitions ────────────────────────────────────────────────────────

type StageContent = {
  roadmapLabel: string;
  stepLabel: string;
  headline: string;
  body: string;
  next: string;
  action: string;
  actionIsRequired: boolean;
  icon: string;
};

const STAGE_CONTENT: Record<HomeownerStage, StageContent> = {
  lead_submitted: {
    roadmapLabel: 'Request Received', stepLabel: 'Step 1 of 7',
    headline: 'We got your request.',
    body: "We're getting familiar with your home and energy needs. Your project has been created and we'll be in touch soon.",
    next: "Next: We'll review your project and reach out.",
    action: 'Nothing to do right now.', actionIsRequired: false, icon: '📋',
  },
  under_review: {
    roadmapLabel: 'Under Review', stepLabel: 'Step 2 of 7',
    headline: "We're reviewing your project.",
    body: "We're looking at your home, roof, and energy usage to figure out the right system for you. This usually takes 1–2 business days.",
    next: "Next: We'll schedule your site survey.",
    action: 'Nothing to do right now.', actionIsRequired: false, icon: '🔍',
  },
  site_survey: {
    roadmapLabel: 'Site Survey', stepLabel: 'Step 3 of 7',
    headline: 'Your site survey is coming up.',
    body: "We're sending someone to your home to measure your roof and confirm the setup details.",
    next: "Next: After the visit, we'll start designing your system.",
    action: "Action needed: We'll reach out to confirm your appointment. Please be available.", actionIsRequired: true, icon: '📐',
  },
  design: {
    roadmapLabel: 'System Design', stepLabel: 'Step 4 of 7',
    headline: "We're designing your system.",
    body: "Our team is building a solar layout specifically for your home — size, placement, and output.",
    next: "Next: We'll put together your proposal.",
    action: 'Nothing to do right now.', actionIsRequired: false, icon: '⚡',
  },
  proposal: {
    roadmapLabel: 'Proposal Ready', stepLabel: 'Step 5 of 7',
    headline: 'Your proposal is ready.',
    body: "We've put together your solar plan — system size, estimated savings, and financing options.",
    next: "Next: Once you approve, we'll move to installation.",
    action: 'Action needed: Review your proposal and let us know if you have questions.', actionIsRequired: true, icon: '📄',
  },
  installation: {
    roadmapLabel: 'Installation', stepLabel: 'Step 6 of 7',
    headline: 'Installation is being scheduled.',
    body: "We're handling permits and lining up your crew. You'll hear from us soon with a date.",
    next: "Next: We'll confirm your install date.",
    action: "Action needed: Watch for our call or email with scheduling details.", actionIsRequired: true, icon: '🔧',
  },
  completed: {
    roadmapLabel: 'Complete', stepLabel: 'Step 7 of 7',
    headline: 'Your system is live.',
    body: "Your solar panels are installed and running. You're now generating your own power.",
    next: '',
    action: "You're all set. Enjoy the savings.", actionIsRequired: false, icon: '🌟',
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

function getTimeOfDayGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

// ─── Progress Ring ────────────────────────────────────────────────────────────

function ProgressRing({ pct }: { pct: number }) {
  const r = 36, circ = 2 * Math.PI * r;
  return (
    <div className="relative w-24 h-24 flex items-center justify-center flex-shrink-0">
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 88 88" width="88" height="88">
        <circle cx="44" cy="44" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="5" />
        <circle cx="44" cy="44" r={r} fill="none" stroke="url(#ringGradPP)" strokeWidth="5"
          strokeLinecap="round" strokeDasharray={circ}
          strokeDashoffset={circ - (pct / 100) * circ}
          style={{ transition: 'stroke-dashoffset 1s ease-out' }}
        />
        <defs>
          <linearGradient id="ringGradPP" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="100%" stopColor="#f59e0b" />
          </linearGradient>
        </defs>
      </svg>
      <div className="text-center z-10">
        <p className="text-xl font-black text-white leading-none">{pct}%</p>
        <p className="text-[9px] text-slate-500 uppercase tracking-wider mt-0.5">Done</p>
      </div>
    </div>
  );
}

// ─── Roadmap ──────────────────────────────────────────────────────────────────

function Roadmap({ stage }: { stage: HomeownerStage | null }) {
  const ci = getStageIndex(stage);
  return (
    <>
      <div className="hidden md:block">
        <div className="relative flex items-start pt-8 pb-6">
          <div className="absolute top-[38px] left-0 right-0 h-[2px] bg-white/[0.05] z-0" />
          {ROADMAP_STEPS.map((s, i) => {
            const past = i < ci, cur = i === ci;
            const c = STAGE_CONTENT[s];
            return (
              <div key={s} className="flex-1 flex flex-col items-center relative z-10">
                {i > 0 && (
                  <div className={`absolute top-[38px] right-1/2 left-[-50%] h-[2px] z-0 transition-all duration-700 ${
                    past || cur ? 'bg-gradient-to-r from-emerald-500/60 to-emerald-400/40' : 'bg-white/[0.05]'
                  }`} />
                )}
                <div className={`relative flex items-center justify-center rounded-full transition-all duration-500 z-10 ${
                  cur  ? 'w-[56px] h-[56px] bg-gradient-to-br from-amber-400 to-amber-600 border-2 border-amber-300/50 shadow-xl shadow-amber-500/30'
                  : past ? 'w-10 h-10 bg-emerald-500/15 border-2 border-emerald-500/40'
                         : 'w-10 h-10 bg-white/[0.03] border-2 border-white/[0.08]'
                }`}>
                  {past ? <CheckCircle2 size={18} className="text-emerald-400" />
                    : cur ? <span className="text-xl leading-none">{c.icon}</span>
                           : <Circle size={16} className="text-white/[0.08]" />}
                  {cur && <div className="absolute inset-0 rounded-full bg-amber-500/15 animate-ping scale-[1.6] pointer-events-none" />}
                </div>
                <span className={`mt-3 text-[10px] font-bold text-center leading-tight max-w-[72px] ${
                  cur ? 'text-amber-300' : past ? 'text-emerald-400/60' : 'text-white/15'
                }`}>{c.roadmapLabel}</span>
                {cur  && <span className="mt-1 text-[9px] font-black text-amber-500/50 uppercase tracking-widest">NOW</span>}
                {past && <span className="mt-1 text-[9px] text-emerald-500/35 uppercase tracking-wider">✓</span>}
              </div>
            );
          })}
        </div>
      </div>
      <div className="md:hidden space-y-0">
        {ROADMAP_STEPS.map((s, i) => {
          const past = i < ci, cur = i === ci, last = i === ROADMAP_STEPS.length - 1;
          const c = STAGE_CONTENT[s];
          return (
            <div key={s} className="flex items-start gap-3">
              <div className="flex flex-col items-center w-9 flex-shrink-0">
                <div className={`rounded-full flex items-center justify-center border-2 flex-shrink-0 transition-all ${
                  cur  ? 'w-9 h-9 bg-gradient-to-br from-amber-400 to-amber-600 border-amber-300/40 shadow-lg shadow-amber-500/25'
                  : past ? 'w-8 h-8 bg-emerald-500/10 border-emerald-500/35'
                         : 'w-8 h-8 bg-white/[0.03] border-white/[0.07]'
                }`}>
                  {past ? <CheckCircle2 size={14} className="text-emerald-400" />
                    : cur ? <span className="text-sm">{c.icon}</span>
                           : <Circle size={14} className="text-white/[0.08]" />}
                </div>
                {!last && <div className={`w-[2px] flex-1 min-h-[24px] mt-1 rounded-full ${past ? 'bg-emerald-500/25' : 'bg-white/[0.04]'}`} />}
              </div>
              <div className={`pb-5 pt-1 flex-1 ${last ? 'pb-0' : ''}`}>
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-bold ${cur ? 'text-amber-300' : past ? 'text-white/35' : 'text-white/15'}`}>{c.roadmapLabel}</span>
                  {cur  && <span className="text-[9px] font-black bg-amber-500/15 text-amber-400 px-2 py-0.5 rounded-full uppercase tracking-wider">Now</span>}
                  {past && <span className="text-[9px] text-emerald-500/40">✓</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function AdminPortalPreview() {
  const { id } = useParams<{ id: string }>();
  const [project,    setProject]    = useState<Project | null>(null);
  const [history,    setHistory]    = useState<StageHistoryEntry[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [mounted,    setMounted]    = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const res = await fetch(`/api/admin/projects/${id}`);
      const d = await res.json();
      if (d.success) { setProject(d.project); setHistory(d.stageHistory ?? []); }
    } finally {
      setLoading(false); setRefreshing(false);
      setTimeout(() => setMounted(true), 80);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return (
    <div className="flex items-center justify-center py-24 text-slate-500">
      <RefreshCw size={16} className="animate-spin mr-2" /> Loading preview…
    </div>
  );

  if (!project) return (
    <div className="text-center py-24 text-slate-500">
      Project not found.{' '}
      <Link href="/admin/projects" className="text-blue-400 hover:underline">Back to projects</Link>
    </div>
  );

  const stage       = project.homeowner_stage;
  const content     = stage ? STAGE_CONTENT[stage] : null;
  const stageIdx    = getStageIndex(stage);
  const pct         = stage ? Math.round(((stageIdx + 1) / ROADMAP_STEPS.length) * 100) : 0;
  const firstName   = project.client_name?.split(' ')[0] ?? 'there';
  const greeting    = getTimeOfDayGreeting();
  const lastUpdated = history.length > 0 ? formatDate(history[0].created_at) : formatDate(project.updated_at);

  return (
    <div className="space-y-4">

      {/* Admin Controls */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm">
          <Link href={`/admin/projects/${id}`}
            className="text-slate-400 hover:text-white transition-colors flex items-center gap-1">
            <ArrowLeft size={14} /> Back to Project
          </Link>
          <span className="text-slate-600">/</span>
          <span className="text-slate-300">Portal Preview</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => load(true)} disabled={refreshing}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-lg transition-all disabled:opacity-50">
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> Refresh
          </button>
          <Link href={`/admin/projects/${id}`}
            className="flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 px-3 py-1.5 rounded-lg transition-all">
            <ExternalLink size={12} /> Edit Stage
          </Link>
        </div>
      </div>

      {/* Admin Notice */}
      <div className="bg-blue-500/8 border border-blue-500/15 rounded-xl px-4 py-2.5 flex items-center gap-2 text-xs text-blue-300">
        <span className="font-semibold text-blue-400">Admin Preview</span>
        <span className="text-blue-400/40">·</span>
        This is exactly what {firstName} sees in their portal.
      </div>

      {/* Portal Preview */}
      <div className={`rounded-2xl border border-white/[0.06] bg-[#07070e] overflow-hidden transition-all duration-500 ${mounted ? 'opacity-100' : 'opacity-0'}`}>

        {/* Subtle ambient */}
        <div className="pointer-events-none absolute overflow-hidden rounded-2xl" style={{ inset: 0, zIndex: 0 }}>
          <div className="absolute -top-20 left-1/2 -translate-x-1/2 w-[600px] h-[300px] rounded-full bg-amber-500/[0.02] blur-[100px]" />
        </div>

        {/* Portal Nav */}
        <header className="relative z-10 border-b border-white/[0.05] bg-[#07070e]/95 backdrop-blur-xl px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/15 flex items-center justify-center">
              <Sun size={14} className="text-amber-400" />
            </div>
            <div>
              <div className="text-sm font-bold text-white leading-none">Under the Sun Solar</div>
              <div className="text-[10px] text-slate-600 mt-0.5">Homeowner Portal</div>
            </div>
          </div>
          <div className="flex items-center gap-2 opacity-40 select-none">
            <span className="text-xs text-slate-400 hidden sm:block">{project.client_email ?? 'homeowner@email.com'}</span>
            <span className="text-xs text-slate-600 border border-white/[0.06] rounded-lg px-2 py-1">Sign out</span>
          </div>
        </header>

        {/* Portal Content */}
        <div className="relative z-10 max-w-4xl mx-auto px-5 sm:px-8 py-10 space-y-8">

          {/* ── 1. HEADER ── */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-amber-500/50 mb-3">Your Solar Project</p>
            <h1 className="text-3xl sm:text-4xl font-black text-white leading-tight">
              {greeting},{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-300 to-amber-500">{firstName}</span>
            </h1>
            {project.address && (
              <div className="flex items-center gap-2 mt-3">
                <MapPin size={12} className="text-slate-600 flex-shrink-0" />
                <span className="text-sm text-slate-400">{project.address}</span>
              </div>
            )}
            <div className="flex items-center gap-2 mt-1.5">
              <Clock size={11} className="text-slate-700 flex-shrink-0" />
              <span className="text-xs text-slate-600">Last updated {lastUpdated}</span>
            </div>
          </div>

          {/* ── 2. ROADMAP (dominant) ── */}
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-6 sm:px-10 py-8">
            <div className="flex items-center justify-between mb-1">
              <div>
                <h2 className="text-base font-black text-white">Project Roadmap</h2>
                <p className="text-xs text-slate-600 mt-0.5">Your journey from inquiry to installation</p>
              </div>
              <ProgressRing pct={pct} />
            </div>
            <Roadmap stage={stage} />
            <div className="mt-5 h-1 bg-white/[0.04] rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-emerald-500 to-amber-500 rounded-full transition-all duration-1000" style={{ width: `${pct}%` }} />
            </div>
            <div className="flex justify-between mt-1.5">
              <span className="text-[10px] text-slate-700">Start</span>
              <span className="text-[10px] text-slate-700">Complete</span>
            </div>
          </div>

          {/* ── 3. CURRENT STAGE — single narrative block ── */}
          {content && (
            <div className="rounded-2xl border border-amber-500/[0.12] bg-amber-500/[0.04] px-6 sm:px-10 py-8">
              <div className="flex items-center gap-2 mb-5">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                <span className="text-[10px] font-black uppercase tracking-widest text-amber-500/60">Current Stage</span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-black text-white leading-snug mb-4">
                {content.headline}
              </h2>
              <p className="text-sm text-slate-300 leading-relaxed max-w-2xl">{content.body}</p>
              {content.next && (
                <p className="text-sm text-slate-400 mt-4">{content.next}</p>
              )}
              <div className={`mt-6 inline-flex items-center gap-2.5 rounded-xl px-4 py-2.5 border ${
                content.actionIsRequired
                  ? 'bg-blue-500/[0.08] border-blue-500/[0.15] text-blue-300'
                  : 'bg-emerald-500/[0.07] border-emerald-500/[0.12] text-emerald-300'
              }`}>
                {content.actionIsRequired
                  ? <AlertCircle size={13} className="text-blue-400 flex-shrink-0" />
                  : <CheckCircle2 size={13} className="text-emerald-400 flex-shrink-0" />}
                <span className="text-sm font-medium">{content.action}</span>
              </div>
            </div>
          )}

          {/* ── 4. PROJECT DETAILS (small) ── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-4">
              <div className="flex items-center gap-2 mb-2">
                <Home size={13} className="text-slate-600" />
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Property</p>
              </div>
              <p className="text-sm font-semibold text-white leading-snug">{project.address ? project.address.split(',')[0] : '—'}</p>
              {project.address?.includes(',') && <p className="text-xs text-slate-600 mt-0.5">{project.address.split(',').slice(1).join(',').trim()}</p>}
            </div>
            <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-4">
              <div className="flex items-center gap-2 mb-2">
                <Zap size={13} className="text-slate-600" />
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600">System Size</p>
              </div>
              {project.system_size_kw
                ? <><p className="text-xl font-black text-amber-400">{project.system_size_kw}</p><p className="text-xs text-slate-600">kilowatts</p></>
                : <p className="text-sm text-slate-600">Pending design</p>
              }
            </div>
            <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-4 col-span-2 sm:col-span-1">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp size={13} className="text-slate-600" />
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Progress</p>
              </div>
              <p className="text-xl font-black text-white">{pct}<span className="text-sm font-bold text-slate-600">%</span></p>
              <p className="text-xs text-slate-600">{content?.roadmapLabel ?? '—'} · {content?.stepLabel ?? ''}</p>
            </div>
          </div>

          {/* ── 5. CONTACT ── */}
          <div className="rounded-2xl border border-white/[0.05] bg-white/[0.015] px-6 sm:px-8 py-6">
            <h3 className="text-sm font-bold text-white mb-1">Have a question?</h3>
            <p className="text-xs text-slate-600 mb-5">Reach out to your project team anytime.</p>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex items-center gap-3 bg-white/[0.03] border border-white/[0.07] rounded-xl px-4 py-3">
                <div className="w-7 h-7 rounded-lg bg-amber-500/8 border border-amber-500/12 flex items-center justify-center flex-shrink-0">
                  <Phone size={12} className="text-amber-400" />
                </div>
                <div>
                  <p className="text-[10px] text-slate-600 uppercase tracking-wide">Phone</p>
                  <p className="text-sm font-semibold text-white">(800) 000-0000</p>
                </div>
              </div>
              <div className="flex items-center gap-3 bg-white/[0.03] border border-white/[0.07] rounded-xl px-4 py-3">
                <div className="w-7 h-7 rounded-lg bg-amber-500/8 border border-amber-500/12 flex items-center justify-center flex-shrink-0">
                  <Mail size={12} className="text-amber-400" />
                </div>
                <div>
                  <p className="text-[10px] text-slate-600 uppercase tracking-wide">Email</p>
                  <p className="text-sm font-semibold text-white">hello@underthesun.solar</p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-center gap-3 pt-2 pb-4">
            <div className="h-px flex-1 bg-white/[0.03]" />
            <span className="text-[10px] text-white/10 flex items-center gap-1.5">
              <Sun size={9} className="text-amber-500/20" /> Under the Sun Solar
            </span>
            <div className="h-px flex-1 bg-white/[0.03]" />
          </div>

        </div>
      </div>

    </div>
  );
}