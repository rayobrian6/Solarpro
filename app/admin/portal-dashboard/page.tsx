'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Sun, MapPin, RefreshCw, Search, ChevronDown,
  CheckCircle2, Circle, Clock,
  Phone, Mail, AlertCircle, Zap,
  TrendingUp, Home, FileCheck, ExternalLink, PenLine,
  Info, CheckCircle,
} from 'lucide-react';
import {
  getInterconnectionProfile,
  getStateIcaFallback,
} from '@/lib/utilityInterconnection';

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

interface ProjectDocument {
  file_type?: string;
  label: string;
  uploaded_at: string;
}

interface MicroStageEvent {
  micro_stage: string;
  created_at: string;
}

interface Owner {
  phone:   string | null;
  email:   string | null;
  company: string | null;
}

interface PortalProposal {
  id:               string;
  project_id:       string;
  name:             string;
  share_token:      string;
  share_expires_at: string | null;
  signed_at:        string | null;
}

// ─── Stage Definitions ───────────────────────────────────────────────────────

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

// ─── Human-readable micro-stage labels (homeowner-facing ONLY) ───────────────
// Rules: no technical names, no timestamps, plain English, max ~4 words

const MICRO_STAGE_LABELS: Record<string, string> = {
  // lead_submitted
  lead_created:             'Project opened',
  project_created:          'Project created',
  // under_review
  bill_uploaded:            'Utility bill received',
  bill_parsed:              'Energy usage analyzed',
  usage_calculated:         'Usage calculated',
  pre_design_complete:      'Pre-design completed',
  // site_survey
  survey_scheduled:         'Survey appointment set',
  survey_started:           'Site visit in progress',
  survey_photos_uploaded:   'Site photos uploaded',
  survey_submitted:         'Survey submitted',
  survey_reviewed:          'Survey reviewed',
  // design
  layout_started:           'System layout started',
  layout_completed:         'System layout completed',
  engineering_started:      'Engineering underway',
  engineering_completed:    'Engineering completed',
  sld_generated:            'Electrical diagram created',
  planset_generated:        'Plan set completed',
  // proposal
  final_proposal_generated: 'Proposal prepared',
  proposal_sent:            'Proposal sent to you',
  proposal_viewed:          'Proposal reviewed',
  proposal_approved:        'Proposal approved',
  contract_sent:            'Contract sent',
  contract_viewed:          'Contract reviewed',
  contract_signed:          'Contract signed',
  // installation
  permit_submitted:         'Permit application filed',
  permit_approved:          'Permit approved',
  install_scheduled:        'Installation date set',
  install_started:          'Installation underway',
  install_completed:        'Installation complete',
  inspection_passed:        'Inspection passed',
  pto_submitted:            'Grid connection filed',
  pto_approved:             'Grid connection approved',
  // completed
  system_live:              'System is live',
  monitoring_active:        'Monitoring activated',
};

// Which micro-stages belong to each homeowner stage
const STAGE_MICRO_MAP: Record<HomeownerStage, string[]> = {
  lead_submitted: ['lead_created', 'project_created'],
  under_review:   ['bill_uploaded', 'bill_parsed', 'usage_calculated', 'pre_design_complete'],
  site_survey:    ['survey_scheduled', 'survey_started', 'survey_photos_uploaded', 'survey_submitted', 'survey_reviewed'],
  design:         ['layout_started', 'layout_completed', 'engineering_started', 'engineering_completed', 'sld_generated', 'planset_generated'],
  proposal:       ['final_proposal_generated', 'proposal_sent', 'proposal_viewed', 'proposal_approved', 'contract_sent', 'contract_viewed', 'contract_signed'],
  installation:   ['permit_submitted', 'permit_approved', 'install_scheduled', 'install_started', 'install_completed', 'inspection_passed', 'pto_submitted', 'pto_approved'],
  completed:      ['system_live', 'monitoring_active'],
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

const STAGE_CONTENT: Record<HomeownerStage, StageContent> = {
  lead_submitted: {
    roadmapLabel:    'Request Received',
    stepLabel:       'Step 1 of 7',
    headline:        'We got your request.',
    body:            "We're getting familiar with your home and energy needs. Your project has been created and we'll be in touch soon.",
    next:            "Next: We'll review your project and reach out.",
    action:          'Nothing to do right now.',
    actionIsRequired: false,
    icon:            '📋',
  },
  under_review: {
    roadmapLabel:    'Under Review',
    stepLabel:       'Step 2 of 7',
    headline:        "We're reviewing your project.",
    body:            "We're looking at your home, roof, and energy usage to figure out the right system for you. This usually takes 1–2 business days.",
    next:            "Next: We'll schedule your site survey.",
    action:          'Nothing to do right now.',
    actionIsRequired: false,
    icon:            '🔍',
  },
  site_survey: {
    roadmapLabel:    'Site Survey',
    stepLabel:       'Step 3 of 7',
    headline:        'Your site survey is coming up.',
    body:            "We're sending someone to your home to measure your roof and confirm the setup details. This lets us build an accurate design.",
    next:            "Next: After the visit, we'll start designing your system.",
    action:          "Action needed: We'll reach out to confirm your appointment. Please be available.",
    actionIsRequired: true,
    icon:            '📐',
  },
  design: {
    roadmapLabel:    'System Design',
    stepLabel:       'Step 4 of 7',
    headline:        "We're designing your system.",
    body:            "Our team is building a solar layout specifically for your home — size, placement, and output are all being worked out.",
    next:            "Next: We'll put together your proposal.",
    action:          'Nothing to do right now.',
    actionIsRequired: false,
    icon:            '⚡',
  },
  proposal: {
    roadmapLabel:    'Proposal Ready',
    stepLabel:       'Step 5 of 7',
    headline:        'Your proposal is ready.',
    body:            "We've put together your solar plan — system size, estimated savings, and your financing options are all included.",
    next:            "Next: Once you approve, we'll move to installation.",
    action:          'Action needed: Review your proposal and let us know if you have questions.',
    actionIsRequired: true,
    icon:            '📄',
  },
  installation: {
    roadmapLabel:    'Installation',
    stepLabel:       'Step 6 of 7',
    headline:        'Installation is being scheduled.',
    body:            "We're handling permits and lining up your crew. Everything is moving forward — you'll hear from us soon with a date.",
    next:            "Next: We'll confirm your install date.",
    action:          "Action needed: Watch for our call or email with scheduling details.",
    actionIsRequired: true,
    icon:            '🔧',
  },
  completed: {
    roadmapLabel:    'Complete',
    stepLabel:       'Step 7 of 7',
    headline:        'Your system is live.',
    body:            "Your solar panels are installed and running. You're now generating your own power.",
    next:            '',
    action:          "You're all set. Enjoy the savings.",
    actionIsRequired: false,
    icon:            '🌟',
  },
};

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
        <circle cx="44" cy="44" r={r} fill="none" stroke="url(#ringGradAdmin)" strokeWidth="5"
          strokeLinecap="round" strokeDasharray={circ}
          strokeDashoffset={circ - (pct / 100) * circ}
          style={{ transition: 'stroke-dashoffset 1s ease-out' }}
        />
        <defs>
          <linearGradient id="ringGradAdmin" x1="0%" y1="0%" x2="100%" y2="0%">
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
                  {past
                    ? <CheckCircle2 size={18} className="text-emerald-400" />
                    : cur
                    ? <span className="text-xl leading-none">{c.icon}</span>
                    : <Circle size={16} className="text-white/[0.08]" />}
                  {cur && (
                    <div className="absolute inset-0 rounded-full bg-amber-500/15 animate-ping scale-[1.6] pointer-events-none" />
                  )}
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
      {/* Mobile */}
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
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-sm font-bold ${cur ? 'text-amber-300' : past ? 'text-white/35' : 'text-white/15'}`}>
                    {c.roadmapLabel}
                  </span>
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

// ─── CompletedSoFar — milestone subsection ───────────────────────────────────
// Shows only completed micro-stages for the CURRENT stage, max 4, no timestamps

function CompletedSoFar({
  stage,
  microStages,
}: {
  stage: HomeownerStage;
  microStages: MicroStageEvent[];
}) {
  const stageKeys  = STAGE_MICRO_MAP[stage] ?? [];
  const completedSet = new Set(microStages.map(m => m.micro_stage));

  // Only completed items that belong to this stage, preserve natural order, max 4
  const completed = stageKeys
    .filter(key => completedSet.has(key))
    .slice(0, 4);

  if (completed.length === 0) return null;

  return (
    <div className="mt-6 border-t border-white/[0.05] pt-6">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3">
        Completed so far
      </p>
      <ul className="flex flex-col gap-2">
        {completed.map((key) => (
          <li key={key} className="flex items-center gap-2.5">
            <span className="text-emerald-400 text-sm leading-none flex-shrink-0">✔</span>
            <span className="text-sm text-slate-300 leading-none">
              {MICRO_STAGE_LABELS[key] ?? key}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── HomeownerView — exact mirror of homeowner portal ────────────────────────

function HomeownerView({
  project,
  documents,
  microStages,
  owner,
  proposals,
  clientState,
}: {
  project: Project;
  documents: ProjectDocument[];
  microStages: MicroStageEvent[];
  owner: Owner | null;
  proposals: PortalProposal[];
  clientState: string | null;
}) {
  const stage       = project.homeowner_stage;
  const content     = stage ? STAGE_CONTENT[stage] : null;
  const stageIdx    = getStageIndex(stage);
  const pct         = stage ? Math.round(((stageIdx + 1) / ROADMAP_STEPS.length) * 100) : 0;
  const lastUpdated = project ? formatDate(project.updated_at) : null;
  const greeting    = getTimeOfDayGreeting();
  const firstName   = project.client_name ? getFirstName(project.client_name) : 'there';

  // Documents scoped to this project
  const projectDocs = documents;

  // Proposals for this project (most recent first)
  const projectProposals = proposals;

  // ── ICA / PTO lookup for installation stage ───────────────────────────────
  const portalStateCode = (
    clientState ||
    (() => {
      const addr = project.address || '';
      const m = addr.match(/\b([A-Z]{2})\s+\d{5}/i) || addr.match(/,\s*([A-Z]{2})\s*$/i);
      return m ? m[1].toUpperCase() : '';
    })()
  ).toUpperCase().trim().slice(0, 2);

  const portalIcaTier1 = null as ReturnType<typeof getInterconnectionProfile>; // reserved
  void getInterconnectionProfile; // keep import used
  const portalIcaFallback = portalStateCode ? getStateIcaFallback(portalStateCode) : null;
  const showIcaSection = stage === 'installation' && (portalIcaTier1 || portalIcaFallback);

  // ── Bill received check (display-only for admin) ──────────────────────────
  const billReceived = projectDocs.some(d =>
    d.label === 'Utility Bill' || d.file_type === 'utility_bill'
  );

  return (
    <div className="space-y-8">

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
        {lastUpdated && (
          <div className="flex items-center gap-2 mt-1.5">
            <Clock size={11} className="text-slate-700 flex-shrink-0" />
            <span className="text-xs text-slate-600">Last updated {lastUpdated}</span>
          </div>
        )}
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
          <div
            className="h-full bg-gradient-to-r from-emerald-500 to-amber-500 rounded-full transition-all duration-1000"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex justify-between mt-1.5">
          <span className="text-[10px] text-slate-700">Start</span>
          <span className="text-[10px] text-slate-700">Complete</span>
        </div>
      </div>

      {/* ── 3. CURRENT STAGE — single narrative block ── */}
      {content && stage && (
        <div className="rounded-2xl border border-amber-500/[0.12] bg-amber-500/[0.04] px-6 sm:px-10 py-8">
          <div className="flex items-center gap-2 mb-5">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-[10px] font-black uppercase tracking-widest text-amber-500/60">Current Stage</span>
          </div>

          {/* Stage title */}
          <h2 className="text-2xl sm:text-3xl font-black text-white leading-snug mb-4">
            {content.headline}
          </h2>

          {/* Stage description */}
          <p className="text-sm text-slate-300 leading-relaxed max-w-2xl">
            {content.body}
          </p>

          {/* ── Completed so far ── */}
          <CompletedSoFar stage={stage} microStages={microStages} />

          {/* Next step */}
          {content.next && (
            <p className="text-sm text-slate-400 mt-6">
              {content.next}
            </p>
          )}

          {/* Action */}
          <div className={`mt-4 inline-flex items-center gap-2.5 rounded-xl px-4 py-2.5 border ${
            content.actionIsRequired
              ? 'bg-blue-500/[0.08] border-blue-500/[0.15] text-blue-300'
              : 'bg-emerald-500/[0.07] border-emerald-500/[0.12] text-emerald-300'
          }`}>
            {content.actionIsRequired
              ? <AlertCircle size={13} className="text-blue-400 flex-shrink-0" />
              : <CheckCircle2 size={13} className="text-emerald-400 flex-shrink-0" />}
            <span className="text-sm font-medium">{content.action}</span>
          </div>

          {/* Bill status — only for lead_submitted or under_review */}
          {(project.homeowner_stage === 'lead_submitted' || project.homeowner_stage === 'under_review') && (
            <div className="mt-6 border-t border-white/[0.05] pt-6">
              {billReceived ? (
                <div className="flex items-center gap-3 rounded-xl bg-emerald-500/[0.06] border border-emerald-500/[0.12] px-4 py-3">
                  <CheckCircle2 size={15} className="text-emerald-400 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-emerald-300">Utility bill received ✓</p>
                    <p className="text-xs text-slate-500 mt-0.5">We&apos;re analyzing your energy usage now.</p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 rounded-xl bg-white/[0.03] border border-white/[0.08] px-4 py-3">
                  <Circle size={15} className="text-slate-600 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-slate-400">Utility bill not yet received</p>
                    <p className="text-xs text-slate-600 mt-0.5">The homeowner can upload their bill from their portal.</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Proposal CTA — shown when stage is 'proposal' and a shared proposal exists ── */}
          {project.homeowner_stage === 'proposal' && projectProposals.length > 0 && (() => {
            const prop = projectProposals[0];
            const propUrl = `/proposals/view/${prop.id}?token=${prop.share_token}`;
            const isSigned = !!prop.signed_at;
            return (
              <div className="mt-6 border-t border-white/[0.05] pt-6">
                {isSigned ? (
                  /* Already signed — show confirmation */
                  <div className="rounded-2xl bg-emerald-500/[0.06] border border-emerald-500/[0.15] p-5">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 size={18} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-emerald-300">Proposal Signed ✓</p>
                        <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                          Signed on {new Date(prop.signed_at!).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}. Installation scheduling is next.
                        </p>
                        <a
                          href={propUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 mt-3 text-xs text-slate-400 hover:text-white transition-colors"
                        >
                          <ExternalLink size={11} />
                          View proposal
                        </a>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Not yet signed — primary CTA */
                  <div className="rounded-2xl bg-amber-500/[0.07] border border-amber-500/[0.18] p-5">
                    <div className="flex items-start gap-3 mb-4">
                      <div className="w-8 h-8 rounded-xl bg-amber-500/[0.15] border border-amber-500/[0.2] flex items-center justify-center flex-shrink-0">
                        <PenLine size={14} className="text-amber-400" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-white">Proposal ready — awaiting homeowner signature</p>
                        <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                          {prop.name} — review your system design, pricing, and savings estimate.
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <a
                        href={propUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-black font-bold text-sm transition-colors"
                      >
                        <ExternalLink size={13} />
                        View Proposal
                      </a>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* ── ICA / PTO Roadmap — shown during installation stage ───────────── */}
      {showIcaSection && (portalIcaTier1 || portalIcaFallback) && (() => {
        const tier1 = portalIcaTier1;
        const tier2 = portalIcaFallback;
        const steps = tier1
          ? tier1.pto_steps
          : (tier2?.generic_steps ?? []);
        const icaTime = tier1
          ? `${tier1.ica_approval_days_min}–${tier1.ica_approval_days_max} business days`
          : tier2
            ? `${tier2.typical_ica_days_min}–${tier2.typical_ica_days_max} business days`
            : null;
        const ptoTime = tier1
          ? `${tier1.pto_days_min}–${tier1.pto_days_max} business days`
          : tier2
            ? `${tier2.typical_pto_days_min}–${tier2.typical_pto_days_max} business days`
            : null;
        const portalUrl = tier1?.application_url ?? null;
        const rulesUrl  = tier2?.rules_url ?? null;
        const tierLabel = tier1
          ? tier1.utility_name
          : tier2
            ? `${tier2.state_name} (${tier2.regulatory_body})`
            : null;
        return (
          <div className="rounded-2xl border border-violet-500/[0.12] bg-violet-500/[0.03] px-6 sm:px-8 py-6">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
              <span className="text-[10px] font-black uppercase tracking-widest text-violet-500/60">Interconnection &amp; PTO</span>
            </div>
            <h3 className="text-lg font-black text-white mb-1">Utility Approval Process</h3>
            {tierLabel && (
              <p className="text-xs text-slate-400 mb-4 flex items-center gap-1.5">
                <Info size={11} className="text-slate-500 flex-shrink-0" />
                {tier1 ? `Steps specific to ${tierLabel}` : `Typical steps — ${tierLabel}`}
              </p>
            )}
            {/* Timeline badges */}
            {(icaTime || ptoTime) && (
              <div className="flex flex-wrap gap-2 mb-5">
                {icaTime && (
                  <div className="flex items-center gap-1.5 rounded-full px-3 py-1 bg-violet-500/10 border border-violet-500/20">
                    <Clock size={11} className="text-violet-400" />
                    <span className="text-xs text-violet-300 font-medium">Interconnection approval: {icaTime}</span>
                  </div>
                )}
                {ptoTime && (
                  <div className="flex items-center gap-1.5 rounded-full px-3 py-1 bg-emerald-500/10 border border-emerald-500/20">
                    <CheckCircle size={11} className="text-emerald-400" />
                    <span className="text-xs text-emerald-300 font-medium">PTO (system turn-on): {ptoTime}</span>
                  </div>
                )}
                {portalUrl && (
                  <a
                    href={portalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 rounded-full px-3 py-1 bg-sky-500/10 border border-sky-500/20 hover:bg-sky-500/20 transition-colors"
                  >
                    <ExternalLink size={11} className="text-sky-400" />
                    <span className="text-xs text-sky-300 font-medium">Utility portal</span>
                  </a>
                )}
                {!portalUrl && rulesUrl && (
                  <a
                    href={rulesUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 rounded-full px-3 py-1 bg-sky-500/10 border border-sky-500/20 hover:bg-sky-500/20 transition-colors"
                  >
                    <ExternalLink size={11} className="text-sky-400" />
                    <span className="text-xs text-sky-300 font-medium">State rules</span>
                  </a>
                )}
              </div>
            )}
            {/* Steps */}
            {steps.length > 0 && (
              <div className="space-y-0">
                {steps.map((step, idx) => (
                  <div key={idx} className="flex gap-3">
                    <div className="flex flex-col items-center flex-shrink-0">
                      <div className="w-6 h-6 rounded-full border-2 border-violet-500/30 flex items-center justify-center text-xs font-black text-violet-400">
                        {idx + 1}
                      </div>
                      {idx < steps.length - 1 && (
                        <div className="w-px flex-1 bg-violet-500/20 my-1" />
                      )}
                    </div>
                    <div className={`pb-${idx < steps.length - 1 ? '3' : '0'} flex-1 min-w-0`}>
                      <p className="text-xs text-slate-300 leading-relaxed">{step}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-4 rounded-lg px-3 py-2 bg-slate-800/40 border border-slate-700/30">
              <p className="text-xs text-slate-500 leading-relaxed">
                {tier1
                  ? `Steps specific to ${tier1.utility_name}. Your installer handles most of this on your behalf.`
                  : tier2
                    ? `Typical steps for utilities regulated by the ${tier2.regulatory_body}. Your installer handles most of this for you.`
                    : 'Your installer handles the interconnection and PTO process. This timeline is typical.'
                }
              </p>
            </div>
          </div>
        );
      })()}

      {/* ── 4. PROJECT DETAILS (small stats) ── */}
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

      {/* ── 5. DOCUMENTS RECEIVED (standalone, clean) ── */}
      {projectDocs.length > 0 && (
        <div className="rounded-2xl border border-white/[0.05] bg-white/[0.015] px-6 sm:px-8 py-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-6 h-6 rounded-lg bg-blue-500/10 border border-blue-500/15 flex items-center justify-center">
              <FileCheck size={11} className="text-blue-400" />
            </div>
            <h3 className="text-sm font-bold text-white">Documents Received</h3>
            <span className="ml-auto text-[10px] text-slate-600">{projectDocs.length} file{projectDocs.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="flex flex-col gap-1.5">
            {projectDocs.map((doc, i) => (
              <div key={i} className="flex items-center justify-between rounded-xl bg-white/[0.02] border border-white/[0.04] px-3 py-2.5">
                <div className="flex items-center gap-2.5">
                  <div className="w-5 h-5 rounded-md bg-emerald-500/10 border border-emerald-500/15 flex items-center justify-center flex-shrink-0">
                    <CheckCircle2 size={10} className="text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-white leading-none">{doc.label}</p>
                    <p className="text-[9px] text-slate-600 mt-0.5 uppercase tracking-wide">
                      {doc.file_type?.replace(/_/g, ' ') ?? 'Document'}
                    </p>
                  </div>
                </div>
                <p className="text-[10px] text-slate-600 flex-shrink-0 ml-3">
                  {new Date(doc.uploaded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 6. CONTACT ── */}
      {(owner?.phone || owner?.email) && (
        <div className="rounded-2xl border border-white/[0.05] bg-white/[0.015] px-6 sm:px-8 py-6">
          <h3 className="text-sm font-bold text-white mb-1">Have a question?</h3>
          <p className="text-xs text-slate-600 mb-5">Reach out to your project team anytime.</p>
          <div className="flex flex-col sm:flex-row gap-3">
            {owner.phone && (
              <a href={`tel:${owner.phone}`}
                className="flex items-center gap-3 bg-white/[0.03] hover:bg-white/[0.05] border border-white/[0.07] hover:border-white/[0.12] rounded-xl px-4 py-3 transition-all group">
                <div className="w-7 h-7 rounded-lg bg-amber-500/8 border border-amber-500/12 flex items-center justify-center flex-shrink-0">
                  <Phone size={12} className="text-amber-400" />
                </div>
                <div>
                  <p className="text-[10px] text-slate-600 uppercase tracking-wide">Phone</p>
                  <p className="text-sm font-semibold text-white group-hover:text-amber-300 transition-colors">{owner.phone}</p>
                </div>
              </a>
            )}
            {owner.email && (
              <a href={`mailto:${owner.email}`}
                className="flex items-center gap-3 bg-white/[0.03] hover:bg-white/[0.05] border border-white/[0.07] hover:border-white/[0.12] rounded-xl px-4 py-3 transition-all group">
                <div className="w-7 h-7 rounded-lg bg-amber-500/8 border border-amber-500/12 flex items-center justify-center flex-shrink-0">
                  <Mail size={12} className="text-amber-400" />
                </div>
                <div>
                  <p className="text-[10px] text-slate-600 uppercase tracking-wide">Email</p>
                  <p className="text-sm font-semibold text-white group-hover:text-amber-300 transition-colors">{owner.email}</p>
                </div>
              </a>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center justify-center gap-3 pt-2 pb-4">
        <div className="h-px flex-1 bg-white/[0.03]" />
        <span className="text-[10px] text-white/10 flex items-center gap-1.5">
          <Sun size={9} className="text-amber-500/20" /> {owner?.company ?? 'Solar Portal'}
        </span>
        <div className="h-px flex-1 bg-white/[0.03]" />
      </div>

    </div>
  );
}

// ─── Admin Wrapper ────────────────────────────────────────────────────────────

export default function AdminHomeownerDashboardPage() {
  const [projects,    setProjects]    = useState<Project[]>([]);
  const [selected,    setSelected]    = useState<Project | null>(null);
  const [documents,   setDocuments]   = useState<ProjectDocument[]>([]);
  const [microStages, setMicroStages] = useState<MicroStageEvent[]>([]);
  const [owner,       setOwner]       = useState<Owner | null>(null);
  const [proposals,   setProposals]   = useState<PortalProposal[]>([]);
  const [clientState, setClientState] = useState<string | null>(null);
  const [filtered,    setFiltered]    = useState<Project[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [docLoading,  setDocLoading]  = useState(false);
  const [search,      setSearch]      = useState('');
  const [showPicker,  setShowPicker]  = useState(false);

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
    } finally { setLoading(false); }
  }, []);

  const loadProjectDetail = useCallback(async (projectId: string) => {
    setDocLoading(true);
    setDocuments([]);
    setMicroStages([]);
    setOwner(null);
    setProposals([]);
    setClientState(null);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}`);
      if (!res.ok) return;
      const d = await res.json();
      if (d.success) {
        setDocuments(d.documents ?? []);
        setMicroStages(d.microStages ?? []);
        setOwner(d.owner ?? null);
        setProposals(d.proposals ?? []);
        setClientState(d.clientState ?? null);
        if (d.project) {
          setSelected(prev => prev?.id === projectId ? { ...prev, ...d.project } : prev);
        }
      }
    } finally { setDocLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (selected?.id) loadProjectDetail(selected.id); }, [selected?.id, loadProjectDetail]);

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
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-white">Homeowner Dashboard</h1>
          <p className="text-xs text-slate-500 mt-0.5">Preview the exact homeowner portal experience for any project.</p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white bg-white/5 border border-white/10 px-3 py-1.5 rounded-lg transition-all disabled:opacity-50 flex-shrink-0">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="relative">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input type="text" value={search}
              onChange={e => { setSearch(e.target.value); setShowPicker(true); }}
              onFocus={() => setShowPicker(true)}
              placeholder="Search projects to preview…"
              className="w-full bg-white/4 border border-white/8 rounded-lg pl-8 pr-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/40"
            />
          </div>
          {selected && (
            <button onClick={() => setShowPicker(v => !v)}
              className="flex items-center gap-2 bg-white/4 border border-white/8 hover:border-white/15 rounded-lg px-3 py-2 text-sm text-slate-300 transition-all">
              <Sun size={13} className="text-amber-400" />
              {selected.client_name ?? selected.name}
              <ChevronDown size={13} className="text-slate-500" />
            </button>
          )}
        </div>
        {showPicker && filtered.length > 0 && (
          <div className="absolute top-full mt-1 left-0 w-96 max-h-72 overflow-y-auto bg-[#0f1119] border border-white/10 rounded-xl shadow-2xl z-50"
            onMouseLeave={() => { if (!search) setShowPicker(false); }}>
            {filtered.slice(0, 20).map(p => {
              const s = p.homeowner_stage;
              const c = s ? STAGE_CONTENT[s] : null;
              return (
                <button key={p.id} onClick={() => { setSelected(p); setShowPicker(false); setSearch(''); }}
                  className={`w-full text-left px-4 py-3 hover:bg-white/5 transition-all border-b border-white/4 last:border-0 ${selected?.id === p.id ? 'bg-amber-500/8' : ''}`}>
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

      {selected && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 bg-blue-500/8 border border-blue-500/15 rounded-lg px-3 py-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
            <span className="text-xs text-blue-300 font-medium">Admin Preview — {selected.client_name ?? selected.name}</span>
            {docLoading && <RefreshCw size={10} className="text-blue-400 animate-spin ml-1" />}
          </div>
          <a href={`/admin/projects/${selected.id}`}
            className="text-xs text-slate-400 hover:text-white border border-white/8 hover:border-white/15 rounded-lg px-3 py-1.5 transition-all">
            Edit Project →
          </a>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-500">
          <RefreshCw size={16} className="animate-spin mr-2" /> Loading projects…
        </div>
      ) : selected ? (
        <HomeownerView
          key={selected.id}
          project={selected}
          documents={documents}
          microStages={microStages}
          owner={owner}
          proposals={proposals}
          clientState={clientState}
        />
      ) : (
        <div className="flex items-center justify-center h-64 rounded-2xl border border-white/8 bg-white/2">
          <p className="text-slate-600 text-sm">No projects found.</p>
        </div>
      )}
    </div>
  );
}
