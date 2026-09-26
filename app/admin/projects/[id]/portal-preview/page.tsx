'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, RefreshCw, ExternalLink, Sun, ClipboardList, Search, Ruler, FileOutput, Wrench, Star,
  MapPin, Clock, CheckCircle2, Circle,
  AlertCircle, Zap, TrendingUp, Home, Phone, Mail,
} from 'lucide-react';

import {
  STAGE_CONTENT,
  ROADMAP_STEPS,
  getStageIndex,
  stageStepLabel,
  type HomeownerStage,
} from '@/lib/portal/stageContent';

// ─── Types ────────────────────────────────────────────────────────────────────

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
//
// 🚨 A THIRD HARDCODED COPY OF THE CUSTOMER'S STAGE COPY WAS HERE, AND IT WAS
//    THE MOST DANGEROUS OF THE THREE.
//
// This page is what a rep opens while ON THE PHONE with the homeowner, under a
// banner that used to read "This is exactly what <name> sees in their portal."
// It was not. Every stage differed in wording, the step name differed
// ("Site Survey" vs the portal's "Home Visit", "Complete" vs "System Live"), and
// none of the things the customer can actually act on were rendered at all — no
// proposal link, no bill-upload prompt, no documents, no install date. A rep
// reading this aloud describes a screen the customer is not looking at.
//
// The prose now comes from lib/portal/stageContent.ts, the same table the portal
// renders and the stage-advance email sends. The ICON stays local — it is
// presentation, and this page uses lucide components where the portal uses an
// emoji.
//
// The "exactly what they see" claim is GONE rather than restated, because this
// page still does not render the portal's real components and a claim a page
// cannot honour is worse than no claim. See the Admin Preview notice below.

const STAGE_ICON: Record<HomeownerStage, React.ReactNode> = {
  lead_submitted: <ClipboardList size={18} />,
  under_review:   <Search size={18} />,
  site_survey:    <Ruler size={18} />,
  design:         <Zap size={18} />,
  proposal:       <FileOutput size={18} />,
  installation:   <Wrench size={18} />,
  completed:      <Star size={18} />,
};

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
                {i > 0 ? (
                  <div className={`absolute top-[38px] right-1/2 left-[-50%] h-[2px] z-0 transition-all duration-700 ${
                    past || cur ? 'bg-gradient-to-r from-emerald-500/60 to-emerald-400/40' : 'bg-white/[0.05]'
                  }`} />
                ) : null}
                <div className={`relative flex items-center justify-center rounded-full transition-all duration-500 z-10 ${
                  cur  ? 'w-[56px] h-[56px] bg-gradient-to-br from-amber-400 to-amber-600 border-2 border-amber-300/50 shadow-xl shadow-amber-500/30'
                  : past ? 'w-10 h-10 bg-emerald-500/15 border-2 border-emerald-500/40'
                         : 'w-10 h-10 bg-white/[0.03] border-2 border-white/[0.08]'
                }`}>
                  {past ? <CheckCircle2 size={18} className="text-emerald-400" />
                    : cur ? <span className="text-xl leading-none">{STAGE_ICON[s]}</span>
                           : <Circle size={16} className="text-white/[0.08]" />}
                  {cur ? <div className="absolute inset-0 rounded-full bg-amber-500/15 animate-ping scale-[1.6] pointer-events-none" /> : null}
                </div>
                <span className={`mt-3 text-[10px] font-bold text-center leading-tight max-w-[72px] ${
                  cur ? 'text-amber-300' : past ? 'text-emerald-400/60' : 'text-white/15'
                }`}>{c.roadmapLabel}</span>
                {cur ? <span className="mt-1 text-[9px] font-black text-amber-500/50 uppercase tracking-widest">NOW</span> : null}
                {past ? <span className="mt-1 text-[9px] text-emerald-500/35 uppercase tracking-wider">✓</span> : null}
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
                    : cur ? <span className="text-sm">{STAGE_ICON[s]}</span>
                           : <Circle size={14} className="text-white/[0.08]" />}
                </div>
                {!last ? <div className={`w-[2px] flex-1 min-h-[24px] mt-1 rounded-full ${past ? 'bg-emerald-500/25' : 'bg-white/[0.04]'}`} /> : null}
              </div>
              <div className={`pb-5 pt-1 flex-1 ${last ? 'pb-0' : ''}`}>
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-bold ${cur ? 'text-amber-300' : past ? 'text-white/35' : 'text-white/15'}`}>{c.roadmapLabel}</span>
                  {cur ? <span className="text-[9px] font-black bg-amber-500/15 text-amber-400 px-2 py-0.5 rounded-full uppercase tracking-wider">Now</span> : null}
                  {past ? <span className="text-[9px] text-emerald-500/40">✓</span> : null}
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

      {/* Admin Notice
          🚨 IT SAID "This is exactly what {firstName} sees in their portal." IT
          WAS NOT. Same stage, different words (three hardcoded tables), a
          different step name, and none of the things the homeowner can act on —
          their proposal link, the bill-upload prompt, their documents, their
          confirmed install date. A rep trusted that sentence on a live call.
          The stage copy below now comes from the portal's own authority
          (lib/portal/stageContent.ts), so the WORDS match. The page still does
          not render the portal's components, so the claim does not return until
          it does. */}
      <div className="bg-blue-500/8 border border-blue-500/15 rounded-xl px-4 py-2.5 flex items-start gap-2 text-xs text-blue-300">
        <span className="font-semibold text-blue-400 flex-shrink-0">Admin Preview</span>
        <span className="text-blue-400/40 flex-shrink-0">·</span>
        <span>
          {firstName}&apos;s current stage and the exact wording their portal shows for it.
          This is <span className="font-semibold">not</span> the full portal — their
          proposal, documents, install date and upload prompts are not reproduced here.
          Open their portal to see everything they see.
        </span>
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
            {project.address ? (
              <div className="flex items-center gap-2 mt-3">
                <MapPin size={12} className="text-slate-600 flex-shrink-0" />
                <span className="text-sm text-slate-400">{project.address}</span>
              </div>
            ) : null}
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
          {content ? (
            <div className="rounded-2xl border border-amber-500/[0.12] bg-amber-500/[0.04] px-6 sm:px-10 py-8">
              <div className="flex items-center gap-2 mb-5">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                <span className="text-[10px] font-black uppercase tracking-widest text-amber-500/60">Current Stage</span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-black text-white leading-snug mb-4">
                {content.headline}
              </h2>
              <p className="text-sm text-slate-300 leading-relaxed max-w-2xl">{content.body}</p>
              {content.next ? (
                <p className="text-sm text-slate-400 mt-4">{content.next}</p>
              ) : null}
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
          ) : null}

          {/* ── 4. PROJECT DETAILS (small) ── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-4">
              <div className="flex items-center gap-2 mb-2">
                <Home size={13} className="text-slate-600" />
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Property</p>
              </div>
              <p className="text-sm font-semibold text-white leading-snug">{project.address ? project.address.split(',')[0] : '—'}</p>
              {project.address?.includes(',') ? <p className="text-xs text-slate-600 mt-0.5">{project.address.split(',').slice(1).join(',').trim()}</p> : null}
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
              <p className="text-xs text-slate-600">{content?.roadmapLabel ?? '—'} · {stage ? stageStepLabel(stage) : ''}</p>
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