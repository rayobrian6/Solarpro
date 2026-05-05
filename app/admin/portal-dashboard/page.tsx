'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Sun, RefreshCw, Search, ChevronDown,
  MapPin, Clock, CheckCircle2, Circle,
  AlertCircle, Zap, TrendingUp, Leaf, Shield,
  Star, Award, ArrowRight, Sparkles,
  Home, BarChart3, CalendarCheck, Phone, Mail,
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
  client_name: string | null;
  client_email: string | null;
  owner_name: string;
}

// ─── Stage Definitions ───────────────────────────────────────────────────────

type StageContent = {
  roadmapLabel: string;
  stepLabel: string;
  headline: string;
  subheadline: string;
  description: string;
  happeningNow: string;
  next: string;
  action: string;
  actionIsRequired: boolean;
  icon: string;
  nextStageLabel: string;
};

const STAGE_CONTENT: Record<HomeownerStage, StageContent> = {
  lead_submitted: {
    roadmapLabel:    'Request Received',
    stepLabel:       'Step 1 of 7',
    headline:        'We Got Your Request!',
    subheadline:     'Your solar journey has officially begun.',
    description:     "Welcome to Under the Sun Solar. We've received your information and our team is getting familiar with your home and energy profile. You're one step closer to clean, renewable energy.",
    happeningNow:    'Our team is reviewing your solar inquiry and getting familiar with your home and energy needs.',
    next:            'Our team will reach out to discuss your project and determine the right path forward.',
    action:          "You don't need to do anything right now — we've got it from here.",
    actionIsRequired: false,
    icon:            '📋',
    nextStageLabel:  'Under Review',
  },
  under_review: {
    roadmapLabel:    'Under Review',
    stepLabel:       'Step 2 of 7',
    headline:        "We're Reviewing Your Project",
    subheadline:     'Our experts are analyzing your property and energy needs.',
    description:     "Our solar specialists are reviewing your property details, local utility rates, and energy consumption to design the best possible solar solution for your home. This typically takes 1–2 business days.",
    happeningNow:    "We're reviewing your property details and energy needs to plan the best solar solution.",
    next:            "We'll schedule your site survey once the review is complete.",
    action:          "No action needed right now — sit tight while we do the work.",
    actionIsRequired: false,
    icon:            '🔍',
    nextStageLabel:  'Site Survey',
  },
  site_survey: {
    roadmapLabel:    'Site Survey',
    stepLabel:       'Step 3 of 7',
    headline:        'Your Site Survey is Scheduled',
    subheadline:     'A specialist is coming to your property.',
    description:     "Our certified technician will visit your home to take precise measurements, photograph your roof, assess structural integrity, and gather everything needed for an accurate system design.",
    happeningNow:    "We're gathering the on-site details needed to design your system accurately.",
    next:            'After the survey, your custom system design will begin.',
    action:          "We'll contact you to confirm your appointment window — please be available.",
    actionIsRequired: true,
    icon:            '📐',
    nextStageLabel:  'System Design',
  },
  design: {
    roadmapLabel:    'System Design',
    stepLabel:       'Step 4 of 7',
    headline:        'Designing Your Solar System',
    subheadline:     'Engineers are crafting your custom solar solution.',
    description:     "Our engineering team is creating a fully custom solar design tailored to your home's exact layout, energy usage patterns, local weather, and financial goals. This is where the magic happens.",
    happeningNow:    'Our engineers are creating a custom solar design tailored to your home.',
    next:            'Your proposal will be prepared once the design is finalized.',
    action:          "Nothing needed from you right now — our engineers are hard at work.",
    actionIsRequired: false,
    icon:            '⚡',
    nextStageLabel:  'Proposal Ready',
  },
  proposal: {
    roadmapLabel:    'Proposal Ready',
    stepLabel:       'Step 5 of 7',
    headline:        'Your Proposal is Ready!',
    subheadline:     'Your custom solar plan is waiting for your review.',
    description:     "Your personalized solar proposal is complete! It includes your system specifications, projected energy savings, financing options, incentive eligibility, and everything you need to make an informed decision.",
    happeningNow:    'Your solar proposal has been prepared and is ready for your review.',
    next:            "Once you approve the proposal, we'll move forward with installation planning.",
    action:          'Please review your proposal — contact us with any questions!',
    actionIsRequired: true,
    icon:            '📄',
    nextStageLabel:  'Installation',
  },
  installation: {
    roadmapLabel:    'Installation',
    stepLabel:       'Step 6 of 7',
    headline:        'Installation is Being Prepared',
    subheadline:     'Your solar system is almost a reality.',
    description:     "Your installation is being actively coordinated. Our crew is handling permitting, equipment procurement, and scheduling. We'll handle everything from start to finish — you just need to be home on install day.",
    happeningNow:    "We're coordinating permits, equipment, and your installation crew.",
    next:            "We'll confirm your installation date and walk you through what to expect.",
    action:          "We'll contact you with scheduling details — keep an eye on your phone and email.",
    actionIsRequired: true,
    icon:            '🔧',
    nextStageLabel:  'Complete!',
  },
  completed: {
    roadmapLabel:    'Complete',
    stepLabel:       'Step 7 of 7',
    headline:        'Your Solar Project is Complete! 🎉',
    subheadline:     'Welcome to clean, renewable energy.',
    description:     "Congratulations — your solar system is installed, inspected, and fully operational! You're now generating your own clean energy and protecting yourself from rising utility costs for decades to come.",
    happeningNow:    'Your solar system is live and generating clean energy.',
    next:            'Enjoy your new solar system and the savings that come with it.',
    action:          'No action needed. Your system is up and running — start watching your savings grow!',
    actionIsRequired: false,
    icon:            '🌟',
    nextStageLabel:  '',
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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });
}

function getTimeOfDayGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function estimateMonthlySavings(kw: number | null): number {
  if (!kw) return 0;
  return Math.round(kw * 4.5 * 30 * 0.14);
}
function estimateAnnualSavings(kw: number | null): number {
  return estimateMonthlySavings(kw) * 12;
}
function estimateCO2Offset(kw: number | null): number {
  if (!kw) return 0;
  return Math.round(kw * 4.5 * 365 * 0.85 / 2000);
}

// ─── Animated Counter ────────────────────────────────────────────────────────

function AnimatedNumber({ value, suffix = '', duration = 1200 }: {
  value: number; suffix?: string; duration?: number;
}) {
  const [display, setDisplay] = useState(0);
  const startRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);
  useEffect(() => {
    if (value === 0) return;
    startRef.current = null;
    const animate = (ts: number) => {
      if (!startRef.current) startRef.current = ts;
      const p = Math.min((ts - startRef.current) / duration, 1);
      setDisplay(Math.round((1 - Math.pow(1 - p, 3)) * value));
      if (p < 1) frameRef.current = requestAnimationFrame(animate);
    };
    frameRef.current = requestAnimationFrame(animate);
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); };
  }, [value, duration]);
  return <>{display.toLocaleString()}{suffix}</>;
}

// ─── Progress Ring ────────────────────────────────────────────────────────────

function ProgressRing({ pct }: { pct: number }) {
  const r = 36, circ = 2 * Math.PI * r;
  return (
    <div className="relative w-24 h-24 flex items-center justify-center">
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 88 88" width="88" height="88">
        <circle cx="44" cy="44" r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="5" />
        <circle cx="44" cy="44" r={r} fill="none" stroke="url(#ringGradPD)" strokeWidth="5"
          strokeLinecap="round" strokeDasharray={circ}
          strokeDashoffset={circ - (pct / 100) * circ}
          style={{ transition: 'stroke-dashoffset 1s ease-out' }}
        />
        <defs>
          <linearGradient id="ringGradPD" x1="0%" y1="0%" x2="100%" y2="0%">
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

// ─── Roadmap ─────────────────────────────────────────────────────────────────

function Roadmap({ stage }: { stage: HomeownerStage | null }) {
  const ci = getStageIndex(stage);
  return (
    <>
      {/* Desktop */}
      <div className="hidden md:block">
        <div className="relative flex items-start pt-6 pb-4">
          <div className="absolute top-[34px] left-0 right-0 h-[2px] bg-white/5 z-0" />
          {ROADMAP_STEPS.map((s, i) => {
            const past = i < ci, cur = i === ci;
            const c = STAGE_CONTENT[s];
            return (
              <div key={s} className="flex-1 flex flex-col items-center relative z-10">
                {i > 0 && (
                  <div className={`absolute top-[34px] right-1/2 left-[-50%] h-[2px] z-0 transition-all duration-700 ${
                    past || cur ? 'bg-gradient-to-r from-emerald-500/70 to-emerald-400/50' : 'bg-white/5'
                  }`} />
                )}
                <div className={`relative flex items-center justify-center rounded-full transition-all duration-500 z-10 ${
                  cur  ? 'w-[52px] h-[52px] bg-gradient-to-br from-amber-400 to-amber-600 border-2 border-amber-300/60 shadow-2xl shadow-amber-500/40'
                  : past ? 'w-10 h-10 bg-emerald-500/20 border-2 border-emerald-500/50'
                         : 'w-10 h-10 bg-white/[0.03] border-2 border-white/10'
                }`}>
                  {past ? <CheckCircle2 size={18} className="text-emerald-400" />
                    : cur ? <span className="text-lg leading-none">{c.icon}</span>
                           : <Circle size={16} className="text-white/10" />}
                  {cur && (
                    <>
                      <div className="absolute inset-0 rounded-full bg-amber-500/20 animate-ping scale-[1.7] pointer-events-none" />
                      <div className="absolute inset-[-8px] rounded-full border border-amber-400/20 pointer-events-none" />
                    </>
                  )}
                </div>
                <span className={`mt-3 text-[10px] font-bold text-center leading-tight max-w-[74px] ${
                  cur ? 'text-amber-300' : past ? 'text-emerald-400/70' : 'text-white/20'
                }`}>{c.roadmapLabel}</span>
                {cur  && <span className="mt-1 text-[9px] font-black text-amber-500/60 uppercase tracking-[0.15em]">● NOW</span>}
                {past && <span className="mt-1 text-[9px] font-bold text-emerald-500/40 uppercase tracking-wider">✓ Done</span>}
              </div>
            );
          })}
        </div>
      </div>
      {/* Mobile */}
      <div className="md:hidden space-y-0">
        {ROADMAP_STEPS.map((s, i) => {
          const past = i < ci, cur = i === ci, last = i === ROADMAP_STEPS.length - 1;
          const c = STAGE_CONTENT[s];
          return (
            <div key={s} className="flex items-start gap-3">
              <div className="flex flex-col items-center w-9 flex-shrink-0">
                <div className={`rounded-full flex items-center justify-center border-2 flex-shrink-0 transition-all ${
                  cur  ? 'w-9 h-9 bg-gradient-to-br from-amber-400 to-amber-600 border-amber-300/50 shadow-lg shadow-amber-500/30'
                  : past ? 'w-8 h-8 bg-emerald-500/15 border-emerald-500/40'
                         : 'w-8 h-8 bg-white/5 border-white/10'
                }`}>
                  {past ? <CheckCircle2 size={14} className="text-emerald-400" />
                    : cur ? <span className="text-sm">{c.icon}</span>
                           : <Circle size={14} className="text-white/10" />}
                </div>
                {!last && <div className={`w-[2px] flex-1 min-h-[28px] mt-1 rounded-full ${past ? 'bg-emerald-500/35' : 'bg-white/5'}`} />}
              </div>
              <div className={`pb-5 pt-1 flex-1 ${last ? 'pb-0' : ''}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-sm font-bold ${cur ? 'text-amber-300' : past ? 'text-white/40' : 'text-white/20'}`}>
                    {c.roadmapLabel}
                  </span>
                  {cur  && <span className="text-[9px] font-black bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full uppercase tracking-wider">Current</span>}
                  {past && <span className="text-[9px] font-bold text-emerald-500/50">✓</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ─── Elite Homeowner View ─────────────────────────────────────────────────────

function HomeownerView({ project }: { project: Project }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setTimeout(() => setMounted(true), 100); }, []);

  const stage          = project.homeowner_stage;
  const content        = stage ? STAGE_CONTENT[stage] : null;
  const stageIdx       = getStageIndex(stage);
  const pct            = stage ? Math.round(((stageIdx + 1) / ROADMAP_STEPS.length) * 100) : 0;
  const firstName      = project.client_name?.split(' ')[0] ?? 'there';
  const greeting       = getTimeOfDayGreeting();
  const lastUpdated    = formatDate(project.updated_at);
  const hasSystemSize  = !!project.system_size_kw;
  const monthlySavings = estimateMonthlySavings(project.system_size_kw);
  const annualSavings  = estimateAnnualSavings(project.system_size_kw);
  const co2Tons        = estimateCO2Offset(project.system_size_kw);

  return (
    <div className={`space-y-6 transition-all duration-700 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>

      {/* ── 1. HERO ── */}
      <div className="relative rounded-3xl overflow-hidden border border-white/[0.07] bg-gradient-to-br from-[#111118] via-[#0d0d14] to-[#090910]">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-amber-400/40 to-transparent" />
        <div className="absolute -top-20 -right-20 w-64 h-64 rounded-full bg-amber-500/[0.04] blur-3xl pointer-events-none" />
        <div className="relative px-6 sm:px-10 py-8">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-6">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-500/60 mb-2">✦ Your Solar Project</p>
              <h1 className="text-4xl sm:text-5xl font-black text-white leading-[1.05] tracking-tight">
                {greeting},<br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-300 to-amber-500">{firstName}</span>{' '}
                <span className="inline-block animate-bounce" style={{ animationDuration: '2s' }}>👋</span>
              </h1>
              {project.address && (
                <div className="flex items-center gap-2 mt-4">
                  <div className="w-5 h-5 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center flex-shrink-0">
                    <MapPin size={11} className="text-slate-400" />
                  </div>
                  <span className="text-sm text-slate-300 truncate">{project.address}</span>
                </div>
              )}
              <div className="flex items-center gap-2 mt-2">
                <div className="w-5 h-5 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center flex-shrink-0">
                  <Clock size={10} className="text-slate-500" />
                </div>
                <span className="text-xs text-slate-500">Last updated {lastUpdated}</span>
              </div>
            </div>
            <div className="flex flex-col items-start sm:items-end gap-3 flex-shrink-0">
              {content && (
                <>
                  <div className="inline-flex items-center gap-2 bg-amber-500/12 border border-amber-500/22 rounded-2xl px-4 py-2.5 shadow-lg shadow-amber-500/10">
                    <span className="text-base">{content.icon}</span>
                    <div>
                      <p className="text-xs font-black text-amber-300 leading-none">{content.roadmapLabel}</p>
                      <p className="text-[10px] text-amber-500/60 mt-0.5">{content.stepLabel}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-xs text-emerald-400/70 font-medium">Project active</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Value strip */}
          {hasSystemSize && (
            <div className="mt-7 pt-6 border-t border-white/[0.06] grid grid-cols-3 gap-4">
              <div className="text-center">
                <p className="text-xs text-slate-500 mb-1">Est. Monthly Savings</p>
                <p className="text-2xl font-black text-emerald-400">~$<AnimatedNumber value={monthlySavings} /></p>
              </div>
              <div className="text-center border-x border-white/[0.06]">
                <p className="text-xs text-slate-500 mb-1">System Size</p>
                <p className="text-2xl font-black text-amber-400">{project.system_size_kw} <span className="text-sm font-semibold text-amber-500/60">kW</span></p>
              </div>
              <div className="text-center">
                <p className="text-xs text-slate-500 mb-1">CO₂ Offset / Year</p>
                <p className="text-2xl font-black text-blue-400">~<AnimatedNumber value={co2Tons} suffix=" tons" /></p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── 2. ROADMAP ── */}
      <div className="rounded-3xl border border-white/[0.07] bg-gradient-to-b from-white/[0.03] to-transparent px-6 sm:px-10 py-8">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-lg font-black text-white tracking-tight">Project Roadmap</h2>
            <p className="text-xs text-slate-500 mt-0.5">Your journey from inquiry to clean energy</p>
          </div>
          <ProgressRing pct={pct} />
        </div>
        <Roadmap stage={stage} />
        <div className="mt-6 h-1.5 bg-white/[0.04] rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-emerald-500 via-amber-400 to-amber-500 rounded-full transition-all duration-1000" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex justify-between mt-2">
          <span className="text-[10px] text-slate-600">Request Submitted</span>
          <span className="text-[10px] text-slate-600">System Complete</span>
        </div>
      </div>

      {/* ── 3. CURRENT STAGE ── */}
      {content && (
        <div className="rounded-3xl border border-amber-500/[0.18] bg-gradient-to-br from-amber-500/[0.08] via-amber-500/[0.04] to-transparent px-6 sm:px-10 py-8 relative overflow-hidden">
          <div className="absolute top-0 left-6 right-6 h-px bg-gradient-to-r from-transparent via-amber-500/40 to-transparent" />
          <div className="flex items-center gap-2.5 mb-5">
            <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-xs font-black uppercase tracking-[0.18em] text-amber-500/80">Current Stage</span>
          </div>
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-400/70 mb-1">{content.subheadline}</p>
              <h2 className="text-3xl sm:text-4xl font-black text-white leading-tight">{content.headline}</h2>
              <p className="text-sm text-slate-300/80 leading-relaxed mt-4 max-w-xl">{content.description}</p>
              <div className="flex items-center gap-2 mt-4">
                <div className="w-4 h-4 rounded-full bg-emerald-500/20 flex items-center justify-center">
                  <CheckCircle2 size={10} className="text-emerald-400" />
                </div>
                <span className="text-xs font-semibold text-emerald-400/80">Your project is progressing on schedule</span>
              </div>
            </div>
            {content.nextStageLabel && (
              <div className="flex-shrink-0 lg:w-52">
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">Up Next</p>
                  <div className="flex items-center gap-2">
                    <ArrowRight size={14} className="text-amber-400" />
                    <span className="text-sm font-bold text-white">{content.nextStageLabel}</span>
                  </div>
                  {stageIdx + 1 < ROADMAP_STEPS.length && (
                    <p className="text-xs text-slate-500 mt-1.5">{STAGE_CONTENT[ROADMAP_STEPS[stageIdx + 1]].subheadline}</p>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="h-px bg-white/[0.06] my-6" />
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2.5">Happening Now</p>
              <p className="text-sm text-slate-200 leading-relaxed">{content.happeningNow}</p>
            </div>
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2.5">What Happens Next</p>
              <p className="text-sm text-slate-200 leading-relaxed">{content.next}</p>
            </div>
            <div className={`rounded-2xl border p-4 ${content.actionIsRequired ? 'bg-blue-500/[0.07] border-blue-500/[0.18]' : 'bg-emerald-500/[0.06] border-emerald-500/[0.15]'}`}>
              <div className="flex items-center gap-1.5 mb-2.5">
                {content.actionIsRequired ? <AlertCircle size={11} className="text-blue-400" /> : <CheckCircle2 size={11} className="text-emerald-400" />}
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Your Action</p>
              </div>
              <p className={`text-sm font-semibold leading-relaxed ${content.actionIsRequired ? 'text-blue-200' : 'text-emerald-300'}`}>{content.action}</p>
            </div>
          </div>
        </div>
      )}

      {/* ── 4. PROJECT STATS ── */}
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-3 px-1">Project Details</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { icon: Home,       label: 'Property',    val: project.address ? project.address.split(',')[0] : '—', sub: project.address?.includes(',') ? project.address.split(',').slice(1).join(',').trim() : undefined, color: 'amber',   numVal: null as number | null },
            { icon: Zap,        label: 'System Size', val: hasSystemSize ? null : 'Pending design',    sub: hasSystemSize ? 'kilowatts' : undefined, color: 'amber', numVal: hasSystemSize ? project.system_size_kw : null, numSuffix: ' kW' },
            { icon: BarChart3,  label: 'Stage',       val: content?.roadmapLabel ?? '—',               sub: content?.stepLabel, color: 'violet',  numVal: null as number | null },
            { icon: TrendingUp, label: 'Progress',    val: null,                                        sub: 'toward completion', color: 'emerald', numVal: pct, numSuffix: '%' },
          ].map((item, i) => {
            const colors: Record<string, { bg: string; border: string; icon: string; text: string }> = {
              amber:   { bg: 'bg-amber-500/[0.06]',   border: 'border-amber-500/[0.12]',   icon: 'text-amber-400',   text: 'text-amber-300' },
              violet:  { bg: 'bg-violet-500/[0.05]',  border: 'border-violet-500/[0.12]',  icon: 'text-violet-400',  text: 'text-violet-300' },
              emerald: { bg: 'bg-emerald-500/[0.05]', border: 'border-emerald-500/[0.12]', icon: 'text-emerald-400', text: 'text-emerald-300' },
            };
            const c = colors[item.color];
            const Icon = item.icon;
            return (
              <div key={i} className={`rounded-2xl border ${c.bg} ${c.border} p-4 flex flex-col gap-3`}>
                <div className={`w-9 h-9 rounded-xl ${c.bg} border ${c.border} flex items-center justify-center`}>
                  <Icon size={16} className={c.icon} />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">{item.label}</p>
                  {item.numVal !== null && item.numVal !== undefined ? (
                    <p className={`text-2xl font-black ${c.text}`}>
                      <AnimatedNumber value={item.numVal} suffix={item.numSuffix ?? ''} />
                    </p>
                  ) : (
                    <p className={`text-sm font-bold ${c.text} leading-snug`}>{item.val}</p>
                  )}
                  {item.sub && <p className="text-xs text-slate-500 mt-0.5">{item.sub}</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 5. PROJECTED SAVINGS ── */}
      {hasSystemSize && (
        <div className="rounded-3xl border border-white/[0.07] bg-gradient-to-br from-emerald-500/[0.06] to-transparent px-6 sm:px-10 py-8 relative overflow-hidden">
          <div className="absolute top-0 left-6 right-6 h-px bg-gradient-to-r from-transparent via-emerald-500/30 to-transparent" />
          <div className="flex items-center gap-2 mb-1">
            <Sparkles size={14} className="text-emerald-400" />
            <span className="text-xs font-black uppercase tracking-widest text-emerald-400/70">Projected Impact</span>
          </div>
          <h3 className="text-xl font-black text-white mb-1">Your Solar Savings Estimate</h3>
          <p className="text-xs text-slate-500 mb-6">Based on your {project.system_size_kw} kW system — actual results may vary.</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-2xl bg-emerald-500/[0.07] border border-emerald-500/[0.15] p-5">
              <div className="flex items-center gap-2 mb-3"><TrendingUp size={14} className="text-emerald-400" /><span className="text-xs font-bold text-emerald-400/70 uppercase tracking-wider">Monthly</span></div>
              <p className="text-3xl font-black text-emerald-300">~$<AnimatedNumber value={monthlySavings} /></p>
              <p className="text-xs text-slate-500 mt-1">estimated savings</p>
            </div>
            <div className="rounded-2xl bg-amber-500/[0.07] border border-amber-500/[0.15] p-5">
              <div className="flex items-center gap-2 mb-3"><Award size={14} className="text-amber-400" /><span className="text-xs font-bold text-amber-400/70 uppercase tracking-wider">Annual</span></div>
              <p className="text-3xl font-black text-amber-300">~$<AnimatedNumber value={annualSavings} duration={1500} /></p>
              <p className="text-xs text-slate-500 mt-1">estimated savings</p>
            </div>
            <div className="rounded-2xl bg-blue-500/[0.07] border border-blue-500/[0.15] p-5">
              <div className="flex items-center gap-2 mb-3"><Leaf size={14} className="text-blue-400" /><span className="text-xs font-bold text-blue-400/70 uppercase tracking-wider">CO₂ Offset</span></div>
              <p className="text-3xl font-black text-blue-300">~<AnimatedNumber value={co2Tons} duration={1800} suffix=" tons" /></p>
              <p className="text-xs text-slate-500 mt-1">of carbon per year</p>
            </div>
          </div>
          <p className="text-[11px] text-slate-600 mt-4 flex items-center gap-1.5">
            <Shield size={11} className="text-slate-600" />
            Estimates based on {project.system_size_kw} kW at $0.14/kWh. Advisor will provide exact numbers in proposal.
          </p>
        </div>
      )}

      {/* ── 6. FEATURE TRIO ── */}
      <div className="grid sm:grid-cols-3 gap-3">
        {[
          { icon: Shield,     title: '25-Year Warranty',    desc: 'Industry-leading panel and workmanship warranties protect your investment long-term.',           color: 'border-blue-500/15 bg-blue-500/[0.04]',    ic: 'text-blue-400' },
          { icon: TrendingUp, title: 'Energy Independence', desc: 'Lock in your energy costs and insulate yourself from rising utility rates for decades to come.', color: 'border-emerald-500/15 bg-emerald-500/[0.04]', ic: 'text-emerald-400' },
          { icon: Leaf,       title: 'Clean Energy Impact', desc: 'Power your home with 100% renewable energy and meaningfully reduce your carbon footprint.',      color: 'border-violet-500/15 bg-violet-500/[0.04]',  ic: 'text-violet-400' },
        ].map((item, i) => (
          <div key={i} className={`rounded-2xl border ${item.color} p-5`}>
            <item.icon size={20} className={`${item.ic} mb-3`} />
            <p className="text-sm font-bold text-white mb-1">{item.title}</p>
            <p className="text-xs text-slate-500 leading-relaxed">{item.desc}</p>
          </div>
        ))}
      </div>

      {/* ── 7. CONTACT ── */}
      <div className="rounded-3xl border border-white/[0.07] bg-white/[0.015] px-6 sm:px-10 py-8 relative overflow-hidden">
        <div className="absolute top-0 left-6 right-6 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Star size={13} className="text-amber-400" />
              <h3 className="text-base font-black text-white">Questions? We're Here.</h3>
            </div>
            <p className="text-sm text-slate-500">Contact Under the Sun Solar — your dedicated project team is ready to help.</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 flex-shrink-0">
            <div className="flex items-center gap-3 bg-white/[0.04] border border-white/[0.09] rounded-2xl px-5 py-3.5">
              <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/15 flex items-center justify-center flex-shrink-0">
                <Phone size={14} className="text-amber-400" />
              </div>
              <div>
                <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide">Phone</p>
                <p className="text-sm font-bold text-white">(800) 000-0000</p>
              </div>
            </div>
            <div className="flex items-center gap-3 bg-white/[0.04] border border-white/[0.09] rounded-2xl px-5 py-3.5">
              <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/15 flex items-center justify-center flex-shrink-0">
                <Mail size={14} className="text-amber-400" />
              </div>
              <div>
                <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide">Email</p>
                <p className="text-sm font-bold text-white">hello@underthesun.solar</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-center gap-3 py-4">
        <div className="h-px flex-1 bg-white/[0.04]" />
        <div className="flex items-center gap-1.5 text-[11px] text-white/15">
          <Sun size={11} className="text-amber-500/30" /> Powered by Under the Sun Solar
        </div>
        <div className="h-px flex-1 bg-white/[0.04]" />
      </div>

    </div>
  );
}

// ─── Admin Wrapper ────────────────────────────────────────────────────────────

export default function AdminPortalDashboardPage() {
  const [projects,   setProjects]   = useState<Project[]>([]);
  const [selected,   setSelected]   = useState<Project | null>(null);
  const [filtered,   setFiltered]   = useState<Project[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [search,     setSearch]     = useState('');
  const [showPicker, setShowPicker] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/projects?limit=100');
      if (!res.ok) return;
      const d = await res.json();
      if (d.success) {
        const list: Project[] = d.projects ?? [];
        setProjects(list);
        setFiltered(list);
        if (list.length > 0) setSelected(list[0]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

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
              const s = p.homeowner_stage;
              const c = s ? STAGE_CONTENT[s] : null;
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
                  {c && (
                    <div className="flex items-center gap-1.5 mt-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                      <span className="text-[11px] text-amber-400 font-medium">{c.roadmapLabel}</span>
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
        <HomeownerView key={selected.id} project={selected} />
      ) : (
        <div className="flex items-center justify-center h-64 rounded-2xl border border-white/8 bg-white/2">
          <p className="text-slate-600 text-sm">No projects found.</p>
        </div>
      )}

    </div>
  );
}