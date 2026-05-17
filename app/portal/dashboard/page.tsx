'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Sun, MapPin, LogOut, RefreshCw,
  CheckCircle2, Circle, Clock,
  Phone, Mail, AlertCircle, Zap,
  TrendingUp, Home, ExternalLink, PenLine,
  Info, CheckCircle, ChevronRight, Star,
  Activity, Leaf, Battery, BarChart3, User, Sparkles,
  FileText, Download, Gift, Copy, Link2,
} from 'lucide-react';
import {
  getInterconnectionProfile,
  getStateIcaFallback,
} from '@/lib/utilityInterconnection';

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

interface PortalDocument {
  project_id: string;
  doc_type: string;
  label: string;
  uploaded_at: string;
}

interface MicroStageEvent {
  project_id: string;
  micro_stage: string;
  created_at: string;
}

interface Client {
  id: string;
  name: string;
  email: string;
  phone: string | null;
}

interface Owner {
  name:    string | null;
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

// ─── Stage Content ────────────────────────────────────────────────────────────

type StageContent = {
  roadmapLabel:     string;
  stepNum:          number;
  headline:         string;
  body:             string;
  next:             string;
  action:           string;
  actionIsRequired: boolean;
  emoji:            string;
};

// Phase 4: milestone-weighted progress (sums to 100)
const STAGE_WEIGHTS: Record<HomeownerStage, number> = {
  lead_submitted: 10,
  under_review:   15,
  site_survey:    15,
  design:         20,
  proposal:       15,
  installation:   20,
  completed:       5,
};

// Phase 1: homeowner-friendly activity feed labels
const MICRO_STAGE_ACTIVITY: Record<string, string> = {
  lead_created:             'Your project was created',
  project_created:          'Project file opened',
  bill_uploaded:            'Your utility bill was received',
  bill_parsed:              'Your energy usage was analyzed',
  usage_calculated:         'Energy needs calculated',
  pre_design_complete:      'Initial review completed',
  survey_scheduled:         'Your home visit was scheduled',
  survey_started:           'Site visit is in progress',
  survey_photos_uploaded:   'Site photos were captured',
  survey_submitted:         'Site visit report submitted',
  survey_reviewed:          'Site visit results reviewed',
  layout_started:           'Your system layout was started',
  layout_completed:         'Solar panel layout finalized',
  engineering_started:      'System design is underway',
  engineering_completed:    'System design completed',
  sld_generated:            'Electrical design completed',
  planset_generated:        'Installation plans completed',
  final_proposal_generated: 'Your proposal was prepared',
  proposal_sent:            'Your proposal was sent to you',
  proposal_viewed:          'You reviewed your proposal',
  proposal_approved:        'Proposal approved — great choice!',
  contract_sent:            'Your agreement was sent',
  contract_viewed:          'You reviewed your agreement',
  contract_signed:          "You signed — you're locked in!",
  permit_submitted:         'Permit application filed with your city',
  permit_approved:          'Permit approved — installation cleared',
  install_scheduled:        'Your installation date is confirmed',
  install_started:          'Installation crew arrived at your home',
  install_completed:        'Installation completed',
  inspection_passed:        'Inspection passed — all clear',
  pto_submitted:            'Grid connection request submitted',
  pto_approved:             'Grid connection approved',
  system_live:              '🎉 Your solar system is live!',
  monitoring_active:        'Energy monitoring activated',
};

// Concise chip labels inside the stage card
const MICRO_STAGE_LABELS: Record<string, string> = {
  lead_created:             'Project opened',
  project_created:          'Project created',
  bill_uploaded:            'Utility bill received',
  bill_parsed:              'Usage analyzed',
  usage_calculated:         'Usage calculated',
  pre_design_complete:      'Review completed',
  survey_scheduled:         'Visit scheduled',
  survey_started:           'Visit started',
  survey_photos_uploaded:   'Photos received',
  survey_submitted:         'Survey submitted',
  survey_reviewed:          'Survey reviewed',
  layout_started:           'Layout started',
  layout_completed:         'Layout finalized',
  engineering_started:      'Design underway',
  engineering_completed:    'Design complete',
  sld_generated:            'Electrical design done',
  planset_generated:        'Plans complete',
  final_proposal_generated: 'Proposal prepared',
  proposal_sent:            'Proposal sent',
  proposal_viewed:          'Proposal viewed',
  proposal_approved:        'Proposal approved',
  contract_sent:            'Agreement sent',
  contract_viewed:          'Agreement viewed',
  contract_signed:          'Agreement signed',
  permit_submitted:         'Permit filed',
  permit_approved:          'Permit approved',
  install_scheduled:        'Date confirmed',
  install_started:          'Install started',
  install_completed:        'Install done',
  inspection_passed:        'Inspection passed',
  pto_submitted:            'Grid filed',
  pto_approved:             'Grid approved',
  system_live:              'System live',
  monitoring_active:        'Monitoring active',
};

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
  'lead_submitted', 'under_review', 'site_survey', 'design', 'proposal', 'installation', 'completed',
];

const STAGE_CONTENT: Record<HomeownerStage, StageContent> = {
  lead_submitted: {
    roadmapLabel: 'Request Received', stepNum: 1,
    headline: 'We received your request.',
    body: "We've created your project and our team is getting familiar with your home and energy needs. You'll hear from us soon.",
    next: "We'll review your project and reach out shortly.",
    action: 'Nothing to do right now — sit tight!',
    actionIsRequired: false, emoji: '📋',
  },
  under_review: {
    roadmapLabel: 'Under Review', stepNum: 2,
    headline: "We're reviewing your project.",
    body: "Our team is analyzing your home, roof, and energy profile to determine the right solar system for you. This typically takes 1–2 business days.",
    next: "We'll schedule a visit to your home.",
    action: 'Nothing to do right now.',
    actionIsRequired: false, emoji: '🔍',
  },
  site_survey: {
    roadmapLabel: 'Home Visit', stepNum: 3,
    headline: "We're visiting your home.",
    body: "A technician will visit your property to take measurements and confirm the details needed to build you an accurate solar design.",
    next: "After the visit, we'll begin designing your system.",
    action: "We'll reach out to confirm your appointment time. Please be available.",
    actionIsRequired: true, emoji: '🏠',
  },
  design: {
    roadmapLabel: 'Designing Your System', stepNum: 4,
    headline: "We're designing your solar system.",
    body: "Our team is building a custom solar plan for your home — optimizing panel placement, system size, and projected energy output.",
    next: "We'll deliver your complete proposal.",
    action: 'Nothing to do right now.',
    actionIsRequired: false, emoji: '⚡',
  },
  proposal: {
    roadmapLabel: 'Proposal Ready', stepNum: 5,
    headline: 'Your proposal is ready.',
    body: "We've put together your complete solar plan — system size, estimated annual savings, financing options, and available incentives.",
    next: "Once you approve, we move straight to installation.",
    action: "Review your proposal and sign when you're ready.",
    actionIsRequired: true, emoji: '📄',
  },
  installation: {
    roadmapLabel: 'Installation', stepNum: 6,
    headline: 'Your installation is being planned.',
    body: "We're handling permits and lining up your installation crew. Everything is in motion — you'll receive a confirmed date soon.",
    next: "We'll reach out to confirm your installation date.",
    action: "Watch for our call or email with scheduling details.",
    actionIsRequired: true, emoji: '🔧',
  },
  completed: {
    roadmapLabel: 'System Live', stepNum: 7,
    headline: 'Your solar system is live! 🎉',
    body: "Your panels are installed, inspected, and generating clean energy right now. Welcome to energy independence.",
    next: '',
    action: "You're all set. Enjoy the savings.",
    actionIsRequired: false, emoji: '🌟',
  },
};

// Phase 2: what the proposal will include (shown during design stage)
const PROPOSAL_PREVIEW_ITEMS = [
  'Estimated annual energy production for your home',
  'Projected utility bill savings over 25 years',
  'Available federal and state incentives & rebates',
  'Battery backup options and pricing',
  'Custom system layout designed for your roof',
  'Flexible financing options',
];

// ─── Utility helpers ──────────────────────────────────────────────────────────

function getStageIndex(stage: HomeownerStage | null): number {
  if (!stage) return -1;
  return ROADMAP_STEPS.indexOf(stage);
}

// Phase 4: milestone-weighted progress — not a simple linear percentage
function calcWeightedProgress(stage: HomeownerStage | null): number {
  if (!stage) return 0;
  const idx = getStageIndex(stage);
  if (idx < 0) return 0;
  let pct = 0;
  for (let i = 0; i < idx; i++) pct += STAGE_WEIGHTS[ROADMAP_STEPS[i]];
  pct += Math.round(STAGE_WEIGHTS[stage] / 2); // half the current stage = "in progress"
  return Math.min(pct, 100);
}

function getFirstName(n: string): string { return n.split(' ')[0]; }

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min  = Math.floor(diff / 60_000);
  const hr   = Math.floor(min / 60);
  const day  = Math.floor(hr / 24);
  if (min < 2)  return 'Just now';
  if (min < 60) return `${min}m ago`;
  if (hr  < 24) return `${hr}h ago`;
  if (day < 2)  return 'Yesterday';
  if (day < 7)  return `${day} days ago`;
  return formatDate(iso);
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

// Phase 5: rough benefit estimates from kW size
function calcBenefits(kw: number | null) {
  if (!kw || kw <= 0) return null;
  const annualKwh     = Math.round(kw * 1400);
  const annualSavings = Math.round(annualKwh * 0.135);
  const co2Tons       = Math.round((annualKwh * 0.386) / 1000 * 10) / 10;
  const treesEq       = Math.round(co2Tons * 16.5);
  return { annualKwh, annualSavings, co2Tons, treesEq };
}

// ─── Progress Arc ─────────────────────────────────────────────────────────────

function ProgressArc({ pct, stage }: { pct: number; stage: HomeownerStage | null }) {
  const r = 52, circ = 2 * Math.PI * r;
  const complete = stage === 'completed';
  return (
    <div className="relative flex flex-col items-center justify-center flex-shrink-0" style={{ width: 136, height: 136 }}>
      <svg className="-rotate-90 absolute inset-0" viewBox="0 0 128 128" width="136" height="136">
        <circle cx="64" cy="64" r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="7" />
        <circle cx="64" cy="64" r={r} fill="none"
          stroke={complete ? '#10b981' : 'url(#arcG)'}
          strokeWidth="7" strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ - (pct / 100) * circ}
          style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1)' }}
        />
        <defs>
          <linearGradient id="arcG" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#fcd34d" />
          </linearGradient>
        </defs>
      </svg>
      <div className="relative z-10 text-center">
        {complete
          ? <Star size={26} className="text-emerald-400 mx-auto" />
          : <>
              <span className="text-[28px] font-black text-white leading-none">{pct}</span>
              <span className="text-sm font-bold text-amber-400">%</span>
              <p className="text-[9px] text-slate-500 uppercase tracking-widest mt-0.5">complete</p>
            </>
        }
      </div>
    </div>
  );
}

// ─── Step Timeline ────────────────────────────────────────────────────────────

function StepTimeline({ stage }: { stage: HomeownerStage | null }) {
  const ci = getStageIndex(stage);
  return (
    <>
      {/* Desktop */}
      <div className="hidden md:flex items-start relative pt-2 pb-1">
        {ROADMAP_STEPS.map((s, i) => {
          const done = i < ci, cur = i === ci, fut = i > ci;
          const c = STAGE_CONTENT[s];
          return (
            <div key={s} className="flex-1 flex flex-col items-center relative">
              {i > 0 && <div className={`absolute top-[18px] right-1/2 w-1/2 h-[2px] ${done || cur ? 'bg-amber-500/50' : 'bg-white/[0.07]'}`} />}
              {i < ROADMAP_STEPS.length - 1 && <div className={`absolute top-[18px] left-1/2 w-1/2 h-[2px] ${done ? 'bg-amber-500/50' : 'bg-white/[0.07]'}`} />}
              <div className={`relative z-10 flex items-center justify-center rounded-full border-2 transition-all duration-500 ${
                cur  ? 'w-10 h-10 bg-amber-500 border-amber-400 shadow-lg shadow-amber-500/40'
                : done ? 'w-8 h-8 bg-emerald-500/20 border-emerald-500/60'
                       : 'w-8 h-8 bg-white/[0.03] border-white/[0.1]'
              }`}>
                {done ? <CheckCircle2 size={15} className="text-emerald-400" />
                  : cur ? <span className="text-base leading-none">{c.emoji}</span>
                        : <span className="text-xs font-black text-white/20">{i + 1}</span>}
                {cur && <span className="absolute inset-0 rounded-full bg-amber-500/20 animate-ping" />}
              </div>
              <span className={`mt-2.5 text-[10px] font-bold text-center leading-tight px-1 max-w-[72px] ${
                cur ? 'text-amber-300' : done ? 'text-emerald-400/70' : fut ? 'text-white/20' : 'text-white/20'
              }`}>{c.roadmapLabel}</span>
              {cur && <span className="mt-0.5 text-[9px] font-black text-amber-500/50 uppercase tracking-widest">NOW</span>}
            </div>
          );
        })}
      </div>

      {/* Mobile */}
      <div className="md:hidden space-y-0">
        {ROADMAP_STEPS.map((s, i) => {
          const done = i < ci, cur = i === ci, last = i === ROADMAP_STEPS.length - 1;
          const c = STAGE_CONTENT[s];
          return (
            <div key={s} className="flex items-start gap-3">
              <div className="flex flex-col items-center w-8 flex-shrink-0">
                <div className={`rounded-full flex items-center justify-center border-2 flex-shrink-0 ${
                  cur  ? 'w-8 h-8 bg-amber-500 border-amber-400 shadow-md shadow-amber-500/30'
                  : done ? 'w-7 h-7 bg-emerald-500/15 border-emerald-500/40'
                        : 'w-7 h-7 bg-white/[0.03] border-white/[0.08]'
                }`}>
                  {done ? <CheckCircle2 size={13} className="text-emerald-400" />
                    : cur ? <span className="text-xs">{c.emoji}</span>
                          : <span className="text-[9px] font-black text-white/15">{i + 1}</span>}
                </div>
                {!last && <div className={`w-px flex-1 min-h-[20px] my-1 rounded-full ${done ? 'bg-emerald-500/25' : 'bg-white/[0.05]'}`} />}
              </div>
              <div className={`pb-4 pt-1 flex-1 ${last ? 'pb-0' : ''}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-sm font-semibold ${cur ? 'text-amber-300' : done ? 'text-white/30' : 'text-white/15'}`}>
                    {c.roadmapLabel}
                  </span>
                  {cur && <span className="text-[9px] font-black bg-amber-500/15 text-amber-400 px-2 py-0.5 rounded-full uppercase tracking-wider">Now</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ─── Milestone Chips ──────────────────────────────────────────────────────────

function MilestoneChips({ stage, microStages }: { stage: HomeownerStage; microStages: MicroStageEvent[] }) {
  const keys = STAGE_MICRO_MAP[stage] ?? [];
  const done = new Set(microStages.map(m => m.micro_stage));
  const completed = keys.filter(k => done.has(k)).slice(0, 5);
  if (!completed.length) return null;
  return (
    <div className="mt-5 pt-5 border-t border-white/[0.06]">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-600 mb-3">Completed so far</p>
      <div className="flex flex-wrap gap-2">
        {completed.map(k => (
          <span key={k} className="inline-flex items-center gap-1.5 text-xs bg-emerald-500/[0.07] border border-emerald-500/[0.15] text-emerald-300 rounded-full px-3 py-1 font-medium">
            <CheckCircle2 size={10} className="text-emerald-400 flex-shrink-0" />
            {MICRO_STAGE_LABELS[k] ?? k}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Phase 1: Recent Activity ─────────────────────────────────────────────────

interface ActivityItem { key: string; label: string; created_at: string; }

function RecentActivity({ microStages, stageHistory }: { microStages: MicroStageEvent[]; stageHistory: StageHistory[] }) {
  const microItems: ActivityItem[] = microStages
    .filter(m => MICRO_STAGE_ACTIVITY[m.micro_stage])
    .map(m => ({ key: m.micro_stage + m.created_at, label: MICRO_STAGE_ACTIVITY[m.micro_stage], created_at: m.created_at }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 8);

  const stageItems: ActivityItem[] = stageHistory
    .filter(h => STAGE_CONTENT[h.stage])
    .map(h => ({ key: h.stage + h.created_at, label: `Milestone reached: ${STAGE_CONTENT[h.stage].roadmapLabel}`, created_at: h.created_at }))
    .slice(0, 5);

  const items = microItems.length > 0 ? microItems : stageItems;
  if (!items.length) return null;

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.015] overflow-hidden">
      <div className="px-6 sm:px-8 pt-5 pb-4 flex items-center gap-3 border-b border-white/[0.04]">
        <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/15 flex items-center justify-center flex-shrink-0">
          <Activity size={13} className="text-amber-400" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-white leading-none">Recent Activity</h3>
          <p className="text-xs text-slate-600 mt-0.5">Your project is actively moving forward</p>
        </div>
      </div>
      <div className="divide-y divide-white/[0.03]">
        {items.map((item, i) => (
          <div key={item.key} className="flex items-start gap-3.5 px-6 sm:px-8 py-3.5">
            <div className="flex flex-col items-center flex-shrink-0 pt-1">
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${i === 0 ? 'bg-amber-400' : 'bg-emerald-500/60'}`} />
              {i < items.length - 1 && <div className="w-px flex-1 min-h-[16px] mt-1.5 bg-white/[0.05]" />}
            </div>
            <div className="flex-1 min-w-0 pb-0.5">
              <p className={`text-sm leading-snug ${i === 0 ? 'text-white font-medium' : 'text-slate-300'}`}>{item.label}</p>
              <p className="text-[11px] text-slate-600 mt-0.5">{formatRelative(item.created_at)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Phase 2: Proposal Anticipation ──────────────────────────────────────────

function ProposalAnticipation({ systemSizeKw }: { systemSizeKw: number | null }) {
  return (
    <div className="rounded-2xl border border-amber-500/[0.12] bg-gradient-to-br from-amber-500/[0.05] to-transparent overflow-hidden">
      <div className="px-6 sm:px-8 pt-6 pb-6">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={14} className="text-amber-400" />
          <span className="text-[10px] font-black uppercase tracking-widest text-amber-500/60">Coming Up Next</span>
        </div>
        <h3 className="text-lg font-black text-white mb-1.5">Your proposal is almost ready.</h3>
        <p className="text-sm text-slate-400 leading-relaxed mb-5">
          Once our team finishes designing your system
          {systemSizeKw ? ` (estimated ${systemSizeKw} kW)` : ''}, you'll receive a
          complete solar plan built specifically for your home. Here's what to expect:
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {PROPOSAL_PREVIEW_ITEMS.map((item, i) => (
            <div key={i} className="flex items-start gap-2.5">
              <CheckCircle2 size={13} className="text-amber-400 flex-shrink-0 mt-0.5" />
              <span className="text-sm text-slate-300 leading-snug">{item}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Phase 3: Project Team ────────────────────────────────────────────────────

function ProjectTeam({ owner }: { owner: Owner }) {
  const hasContact = owner.phone || owner.email;
  if (!hasContact && !owner.name && !owner.company) return null;

  const initials = owner.name
    ? owner.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : owner.company ? owner.company.slice(0, 2).toUpperCase() : 'SP';

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.015] px-6 sm:px-8 py-6">
      <div className="flex items-center gap-2 mb-5">
        <User size={13} className="text-slate-500" />
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Your Project Team</span>
      </div>

      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500/20 to-amber-600/10 border border-amber-500/20 flex items-center justify-center flex-shrink-0">
          <span className="text-sm font-black text-amber-300">{initials}</span>
        </div>
        <div className="flex-1 min-w-0">
          {owner.name && <p className="text-base font-bold text-white leading-tight">{owner.name}</p>}
          {owner.company && <p className="text-xs text-amber-400/70 mt-0.5">{owner.company}</p>}
          <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
            Your dedicated solar specialist. Reach out any time — we're here to make this easy for you.
          </p>
        </div>
      </div>

      {hasContact && (
        <div className="flex flex-col sm:flex-row gap-2.5 mt-5">
          {owner.phone && (
            <a href={`tel:${owner.phone}`}
              className="flex items-center gap-2.5 bg-white/[0.03] hover:bg-white/[0.05] border border-white/[0.07] hover:border-amber-500/20 rounded-xl px-4 py-2.5 transition-all group flex-1">
              <div className="w-7 h-7 rounded-lg bg-amber-500/8 border border-amber-500/12 flex items-center justify-center flex-shrink-0">
                <Phone size={12} className="text-amber-400" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] text-slate-600 uppercase tracking-wide">Call</p>
                <p className="text-sm font-semibold text-white group-hover:text-amber-300 transition-colors truncate">{owner.phone}</p>
              </div>
            </a>
          )}
          {owner.email && (
            <a href={`mailto:${owner.email}`}
              className="flex items-center gap-2.5 bg-white/[0.03] hover:bg-white/[0.05] border border-white/[0.07] hover:border-amber-500/20 rounded-xl px-4 py-2.5 transition-all group flex-1">
              <div className="w-7 h-7 rounded-lg bg-amber-500/8 border border-amber-500/12 flex items-center justify-center flex-shrink-0">
                <Mail size={12} className="text-amber-400" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] text-slate-600 uppercase tracking-wide">Email</p>
                <p className="text-sm font-semibold text-white group-hover:text-amber-300 transition-colors truncate">{owner.email}</p>
              </div>
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Phase 5: Projected System Benefits ──────────────────────────────────────

function ProjectedBenefits({ systemSizeKw, stage }: { systemSizeKw: number | null; stage: HomeownerStage | null }) {
  const benefits = calcBenefits(systemSizeKw);
  if (!benefits || getStageIndex(stage) < 2) return null;

  const metrics = [
    { icon: Zap,        label: 'Est. Annual Production', value: benefits.annualKwh.toLocaleString(),     unit: 'kWh per year',     color: 'amber'   },
    { icon: TrendingUp, label: 'Est. Annual Savings',    value: `$${benefits.annualSavings.toLocaleString()}`, unit: 'per year', color: 'emerald' },
    { icon: Leaf,       label: 'Carbon Offset',          value: benefits.co2Tons.toLocaleString(),        unit: 'tons CO₂ / yr',    color: 'teal'    },
    { icon: BarChart3,  label: 'Equivalent Trees',        value: benefits.treesEq.toLocaleString(),       unit: 'trees / year',     color: 'emerald' },
  ] as const;

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.015] overflow-hidden">
      <div className="px-6 sm:px-8 pt-5 pb-4 border-b border-white/[0.04] flex items-center gap-3">
        <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/15 flex items-center justify-center flex-shrink-0">
          <TrendingUp size={13} className="text-emerald-400" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-white leading-none">Projected System Benefits</h3>
          <p className="text-xs text-slate-600 mt-0.5">Estimated based on your {systemSizeKw} kW system</p>
        </div>
      </div>
      <div className="grid grid-cols-2 divide-x divide-y divide-white/[0.04]">
        {metrics.map((m, i) => (
          <div key={i} className="px-5 py-4">
            <div className="flex items-center gap-1.5 mb-2">
              <m.icon size={11} className={m.color === 'amber' ? 'text-amber-400' : m.color === 'emerald' ? 'text-emerald-400' : 'text-teal-400'} />
              <span className="text-[10px] text-slate-500 uppercase tracking-wide">{m.label}</span>
            </div>
            <p className={`text-lg font-black leading-none ${m.color === 'amber' ? 'text-amber-300' : m.color === 'emerald' ? 'text-emerald-300' : 'text-teal-300'}`}>{m.value}</p>
            <p className="text-[10px] text-slate-600 mt-0.5">{m.unit}</p>
          </div>
        ))}
      </div>
      <div className="px-6 sm:px-8 py-3 border-t border-white/[0.04]">
        <p className="text-[10px] text-slate-600 leading-relaxed">
          Estimates based on average US solar irradiance and utility rates. Actual results will vary based on your location, usage, and system placement.
        </p>
      </div>
    </div>
  );
}

// ─── Document Vault ───────────────────────────────────────────────
// Shows files the homeowner uploaded (utility bills + portal uploads).

function DocumentVault({ documents }: { documents: PortalDocument[] }) {
  if (documents.length === 0) return null;

  function fmtDate(iso: string): string {
    try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
    catch { return ''; }
  }

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.01] px-6 sm:px-8 py-6">
      <div className="flex items-center gap-2 mb-4">
        <FileText size={14} className="text-blue-400/60" />
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Your Documents</span>
      </div>
      <div className="space-y-2">
        {documents.map((doc, i) => (
          <div key={i} className="flex items-center gap-3 rounded-xl bg-white/[0.02] border border-white/[0.04] px-4 py-3">
            <div className="w-8 h-8 rounded-lg bg-blue-500/[0.08] border border-blue-500/[0.12] flex items-center justify-center flex-shrink-0">
              <FileText size={13} className="text-blue-400/50" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-white truncate">{doc.label}</p>
              <p className="text-[10px] text-slate-600">{fmtDate(doc.uploaded_at)}</p>
            </div>
            <Download size={13} className="text-slate-600 flex-shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Referral Link Generator ────────────────────────────────────────────
// Only shown after install_scheduled or completed.

const REFERRAL_ELIGIBLE_STAGES: string[] = ['install_scheduled', 'completed'];

function ReferralSection({
  stage, ownerCompany, clientName,
}: {
  stage: HomeownerStage | null;
  ownerCompany: string | null;
  clientName: string;
}) {
  if (!stage || !REFERRAL_ELIGIBLE_STAGES.includes(stage)) return null;

  const [copied, setCopied] = useState(false);

  const base = typeof window !== 'undefined'
    ? window.location.origin
    : (process.env.NEXT_PUBLIC_BASE_URL ?? '');
  const safeRef = encodeURIComponent(clientName.split(' ')[0] ?? 'friend');
  const referralUrl = `${base}/portal?ref=${safeRef}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(referralUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      const input = document.createElement('input');
      input.value = referralUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  }

  return (
    <div className="rounded-2xl border border-amber-500/[0.15] bg-amber-500/[0.02] px-6 sm:px-8 py-6">
      <div className="flex items-center gap-2 mb-1">
        <Gift size={13} className="text-amber-400/60" />
        <span className="text-[10px] font-black uppercase tracking-widest text-amber-500/60">Refer a Neighbor</span>
      </div>
      <h3 className="text-base font-black text-white mb-1">Love your solar? Share it.</h3>
      <p className="text-sm text-slate-400 leading-relaxed mb-4">
        Share your referral link with friends and neighbors.
        {ownerCompany ? ` ${ownerCompany} would love to help your community go solar.` : ''}
      </p>
      <div className="flex items-center gap-2">
        <div className="flex-1 flex items-center gap-2 rounded-xl bg-white/[0.03] border border-white/[0.06] px-3 py-2 min-w-0">
          <Link2 size={11} className="text-slate-600 flex-shrink-0" />
          <span className="text-[11px] text-slate-500 truncate font-mono">{referralUrl}</span>
        </div>
        <button
          onClick={copyLink}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl font-bold text-xs transition-all flex-shrink-0"
          style={{
            background: copied ? 'rgba(34,197,94,0.15)' : 'rgba(245,158,11,0.12)',
            color: copied ? '#4ade80' : '#fbbf24',
            border: copied ? '1px solid rgba(34,197,94,0.2)' : '1px solid rgba(245,158,11,0.2)',
          }}
        >
          {copied ? <CheckCircle size={11} /> : <Copy size={11} />}
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

// ─── Phase 6: Monitoring Foundation (completed stage only) ───────────────────
// Architecture ready — populated by live monitoring integration in a future release.

function MonitoringFoundation({ stage }: { stage: HomeownerStage | null }) {
  if (stage !== 'completed') return null;
  return (
    <div className="rounded-2xl border border-emerald-500/[0.12] bg-emerald-500/[0.02] px-6 sm:px-8 py-6">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        <span className="text-[10px] font-black uppercase tracking-widest text-emerald-500/60">Live System</span>
      </div>
      <h3 className="text-lg font-black text-white mb-2">Your system is generating power.</h3>
      <p className="text-sm text-slate-400 leading-relaxed mb-5">
        Real-time energy production data, battery status, and savings tracking will appear here as your monitoring activates.
      </p>
      <div className="grid grid-cols-3 gap-3">
        {[
          { icon: Zap,        label: 'Production',  value: '— kW',  sub: 'Live output' },
          { icon: Battery,    label: 'Battery',     value: '—%',    sub: 'Charge level' },
          { icon: TrendingUp, label: 'Savings',     value: '$—',    sub: 'This month' },
        ].map((item, i) => (
          <div key={i} className="rounded-xl bg-white/[0.02] border border-white/[0.05] px-3 py-3 text-center">
            <item.icon size={14} className="text-slate-600 mx-auto mb-2" />
            <p className="text-sm font-black text-slate-500">{item.value}</p>
            <p className="text-[9px] text-slate-700 uppercase tracking-wide mt-0.5">{item.sub}</p>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-slate-700 mt-4 leading-relaxed">
        Monitoring data typically activates within 24–48 hours of your system going live.
      </p>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function PortalDashboard() {
  const router = useRouter();
  const [client,        setClient]        = useState<Client | null>(null);
  const [owner,         setOwner]         = useState<Owner | null>(null);
  const [projects,      setProjects]      = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [history,       setHistory]       = useState<StageHistory[]>([]);
  const [documents,     setDocuments]     = useState<PortalDocument[]>([]);
  const [microStages,   setMicroStages]   = useState<MicroStageEvent[]>([]);
  const [proposals,     setProposals]     = useState<PortalProposal[]>([]);
  const [billUploaded,  setBillUploaded]  = useState(false);
  const [billUploading, setBillUploading] = useState(false);
  const [billUploadErr, setBillUploadErr] = useState('');
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState('');
  const [mounted,       setMounted]       = useState(false);


  const load = async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/portal/dashboard');
      const d   = await res.json();
      if (d.code === 'PORTAL_AUTH_REQUIRED' || res.status === 401) { router.replace('/portal/login'); return; }
      if (!d.success) { setError(d.error || 'Failed to load your project.'); return; }
      setClient(d.client);
      setOwner(d.owner ?? null);
      const list: Project[] = d.projects ?? [];
      setProjects(list);
      if (list.length > 0) setActiveProject(list[0]);
      setHistory(d.stageHistory ?? []);
      setDocuments(d.documents ?? []);
      setMicroStages(d.microStages ?? []);
      setProposals(d.proposals ?? []);
      setBillUploaded((d.documents ?? []).some((doc: { label: string; file_type?: string }) =>
        doc.label === 'Utility Bill' || doc.file_type === 'utility_bill'
      ));
    } catch { setError('Connection error. Please refresh the page.'); }
    finally   { setLoading(false); setTimeout(() => setMounted(true), 60); }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLogout = async () => {
    await fetch('/api/portal/logout', { method: 'POST' });
    router.replace('/portal/login');
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-[#07070e]">
      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/15 flex items-center justify-center">
            <Sun size={24} className="text-amber-400" />
          </div>
          <div className="absolute inset-0 rounded-2xl bg-amber-500/10 animate-ping" />
        </div>
        <span className="text-sm text-slate-600 flex items-center gap-2">
          <RefreshCw size={13} className="animate-spin" /> Loading your portal…
        </span>
      </div>
    </div>
  );

  if (error) return (
    <div className="min-h-screen flex items-center justify-center bg-[#07070e] px-4">
      <div className="text-center max-w-sm">
        <AlertCircle size={32} className="text-red-400 mx-auto mb-4" />
        <p className="text-red-400 text-sm mb-4">{error}</p>
        <button onClick={load} className="px-5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-white hover:bg-white/8 transition-all">Try Again</button>
      </div>
    </div>
  );

  const p                = activeProject;
  const stage            = p?.homeowner_stage ?? null;
  const content          = stage ? STAGE_CONTENT[stage] : null;
  const pct              = calcWeightedProgress(stage);
  const firstName        = client ? getFirstName(client.name) : 'there';
  const greeting         = getGreeting();
  const projectMicros    = microStages.filter(m => p && m.project_id === p.id);
  const projectProposals = proposals.filter(pr => p && pr.project_id === p.id);
  const projectHistory   = history.filter(h => p && h.project_id === p.id);
  const isComplete       = stage === 'completed';

  // ICA / PTO (installation stage)
  const stateCode = (
    (client as any)?.state ||
    (() => {
      const m = (p?.address ?? '').match(/\b([A-Z]{2})\s+\d{5}/i) || (p?.address ?? '').match(/,\s*([A-Z]{2})\s*$/i);
      return m ? m[1].toUpperCase() : '';
    })()
  ).toUpperCase().trim().slice(0, 2);
  const icaTier1   = null as ReturnType<typeof getInterconnectionProfile>;
  void getInterconnectionProfile;
  const icaFallback = stateCode ? getStateIcaFallback(stateCode) : null;
  const showIca     = stage === 'installation' && (icaTier1 || icaFallback);

  return (
    <div className="min-h-screen bg-[#07070e] text-white overflow-x-hidden">

      {/* Ambient */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden z-0">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[900px] h-[500px] rounded-full bg-amber-500/[0.025] blur-[140px]" />
        <div className="absolute bottom-0 right-0 w-[500px] h-[500px] rounded-full bg-blue-600/[0.012] blur-[120px]" />
      </div>

      {/* Nav */}
      <header className="sticky top-0 z-30 border-b border-white/[0.05] bg-[#07070e]/95 backdrop-blur-xl">
        <div className="max-w-3xl mx-auto px-5 sm:px-8 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/15 flex items-center justify-center">
              <Sun size={14} className="text-amber-400" />
            </div>
            <div>
              <p className="text-sm font-bold text-white leading-none">{owner?.company ?? 'Solar Portal'}</p>
              <p className="text-[10px] text-slate-600 mt-0.5">Homeowner Portal</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {client && <span className="hidden sm:block text-xs text-slate-600">{client.email}</span>}
            <button onClick={handleLogout}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 border border-white/[0.06] hover:border-white/15 rounded-lg px-3 py-1.5 transition-all">
              <LogOut size={11} /> Sign out
            </button>
          </div>
        </div>
      </header>

      <main className={`max-w-3xl mx-auto px-5 sm:px-8 py-10 relative z-10 transition-all duration-500 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>

        {/* Project switcher */}
        {projects.length > 1 && (
          <div className="flex items-center gap-2 overflow-x-auto pb-1 mb-8">
            {projects.map(proj => (
              <button key={proj.id} onClick={() => setActiveProject(proj)}
                className={`flex-shrink-0 text-xs font-medium px-3 py-1.5 rounded-full border transition-all ${
                  activeProject?.id === proj.id
                    ? 'bg-amber-500/15 border-amber-500/25 text-amber-300'
                    : 'bg-white/[0.03] border-white/[0.07] text-slate-500 hover:text-white'
                }`}>
                {proj.address ? proj.address.split(',')[0] : proj.name}
              </button>
            ))}
          </div>
        )}

        {p ? (
          <div className="space-y-5">

            {/* ══ HERO ════════════════════════════════════════════════════ */}
            <div className="rounded-2xl overflow-hidden border border-white/[0.06] bg-gradient-to-br from-white/[0.03] via-white/[0.015] to-transparent">
              <div className={`h-1 transition-all duration-1000 ${isComplete ? 'bg-gradient-to-r from-emerald-500 to-teal-400' : 'bg-gradient-to-r from-amber-500 to-amber-400'}`}
                style={{ width: `${pct}%` }} />

              <div className="px-6 sm:px-8 pt-7 pb-6">
                <div className="flex items-start justify-between gap-6">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold uppercase tracking-widest text-amber-500/50 mb-2">Your Solar Project</p>
                    <h1 className="text-3xl sm:text-4xl font-black text-white leading-tight tracking-tight">
                      {greeting},{' '}
                      <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-300 to-amber-500">{firstName}</span>
                    </h1>
                    {p.address && (
                      <div className="flex items-center gap-1.5 mt-3">
                        <MapPin size={11} className="text-slate-600 flex-shrink-0" />
                        <span className="text-sm text-slate-400 truncate">{p.address}</span>
                      </div>
                    )}
                    {p.updated_at && (
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <Clock size={10} className="text-slate-700 flex-shrink-0" />
                        <span className="text-xs text-slate-600">Last updated {formatDate(p.updated_at)}</span>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2.5 mt-5">
                      {p.system_size_kw && (
                        <div className="flex items-center gap-2 rounded-xl bg-amber-500/[0.07] border border-amber-500/[0.12] px-3.5 py-2">
                          <Zap size={12} className="text-amber-400 flex-shrink-0" />
                          <span className="text-sm font-black text-amber-300">{p.system_size_kw}</span>
                          <span className="text-xs text-amber-500/60">kW system</span>
                        </div>
                      )}
                      {content && (
                        <div className="flex items-center gap-2 rounded-xl bg-white/[0.03] border border-white/[0.07] px-3.5 py-2">
                          <Home size={12} className="text-slate-500 flex-shrink-0" />
                          <span className="text-sm font-medium text-slate-300">Step {content.stepNum} of 7</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="hidden sm:block flex-shrink-0">
                    <ProgressArc pct={pct} stage={stage} />
                  </div>
                </div>
              </div>

              <div className="px-6 sm:px-8 pb-7 border-t border-white/[0.04] pt-6">
                <div className="flex items-center justify-between mb-5">
                  <p className="text-xs font-black uppercase tracking-widest text-slate-500">Your Journey</p>
                  <span className="sm:hidden text-sm font-black text-amber-400">{pct}% complete</span>
                </div>
                <StepTimeline stage={stage} />
                <div className="mt-5 h-1.5 bg-white/[0.04] rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-1000 ${isComplete ? 'bg-emerald-500' : 'bg-gradient-to-r from-amber-500 to-amber-400'}`}
                    style={{ width: `${pct}%` }} />
                </div>
              </div>
            </div>

            {/* ══ CURRENT STAGE ═══════════════════════════════════════════ */}
            {content && stage && (
              <div className={`rounded-2xl border px-6 sm:px-8 py-7 ${
                isComplete              ? 'border-emerald-500/[0.15] bg-emerald-500/[0.03]'
                : content.actionIsRequired ? 'border-blue-500/[0.15] bg-blue-500/[0.03]'
                                         : 'border-amber-500/[0.12] bg-amber-500/[0.03]'
              }`}>
                <div className="flex items-center gap-2 mb-4">
                  <div className={`w-2 h-2 rounded-full animate-pulse ${isComplete ? 'bg-emerald-400' : content.actionIsRequired ? 'bg-blue-400' : 'bg-amber-400'}`} />
                  <span className={`text-[10px] font-black uppercase tracking-widest ${isComplete ? 'text-emerald-500/70' : content.actionIsRequired ? 'text-blue-500/70' : 'text-amber-500/70'}`}>
                    {content.actionIsRequired ? 'Your Attention Needed' : isComplete ? 'All Done' : 'In Progress'} · {content.roadmapLabel}
                  </span>
                </div>
                <h2 className="text-2xl sm:text-3xl font-black text-white leading-snug mb-3">{content.headline}</h2>
                <p className="text-sm text-slate-300 leading-relaxed max-w-xl">{content.body}</p>
                <MilestoneChips stage={stage} microStages={projectMicros} />
                <div className="mt-5 space-y-2.5">
                  {content.next && (
                    <div className="flex items-start gap-2.5">
                      <ChevronRight size={14} className="text-slate-600 mt-0.5 flex-shrink-0" />
                      <p className="text-sm text-slate-400">{content.next}</p>
                    </div>
                  )}
                  <div className={`inline-flex items-center gap-2.5 rounded-xl px-4 py-2.5 border ${
                    content.actionIsRequired ? 'bg-blue-500/[0.08] border-blue-500/[0.18] text-blue-300'
                    : isComplete            ? 'bg-emerald-500/[0.08] border-emerald-500/[0.18] text-emerald-300'
                                            : 'bg-emerald-500/[0.07] border-emerald-500/[0.12] text-emerald-300'
                  }`}>
                    {content.actionIsRequired
                      ? <AlertCircle size={13} className="text-blue-400 flex-shrink-0" />
                      : <CheckCircle2 size={13} className="text-emerald-400 flex-shrink-0" />}
                    <span className="text-sm font-medium">{content.action}</span>
                  </div>
                </div>

                {/* Bill upload */}
                {(stage === 'lead_submitted' || stage === 'under_review') && (
                  <div className="mt-6 border-t border-white/[0.05] pt-6">
                    {billUploaded ? (
                      <div className="flex items-center gap-3 rounded-xl bg-emerald-500/[0.06] border border-emerald-500/[0.12] px-4 py-3">
                        <CheckCircle2 size={15} className="text-emerald-400 flex-shrink-0" />
                        <div>
                          <p className="text-sm font-semibold text-emerald-300">Utility bill received ✓</p>
                          <p className="text-xs text-slate-500 mt-0.5">We're reviewing your energy usage now.</p>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <p className="text-sm font-bold text-white mb-1">Upload Your Utility Bill</p>
                        <p className="text-xs text-slate-500 mb-4">Share your electric bill so we can accurately size your solar system.</p>
                        {billUploadErr && <p className="text-xs text-red-400 mb-3">{billUploadErr}</p>}
                        <label className={`inline-flex items-center gap-2.5 rounded-xl px-5 py-2.5 border cursor-pointer transition-all ${
                          billUploading
                            ? 'bg-white/[0.02] border-white/[0.06] text-slate-600 cursor-not-allowed'
                            : 'bg-amber-500/[0.08] border-amber-500/[0.15] text-amber-300 hover:bg-amber-500/[0.12] hover:border-amber-500/[0.25]'
                        }`}>
                          <CheckCircle2 size={13} className="flex-shrink-0" />
                          <span className="text-sm font-semibold">{billUploading ? 'Uploading...' : 'Upload Bill'}</span>
                          <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden" disabled={billUploading}
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file || !p.id) return;
                              setBillUploading(true); setBillUploadErr('');
                              try {
                                const fd = new FormData();
                                fd.append('file', file);
                                fd.append('project_id', p.id);
                                const res = await fetch('/api/portal/bill-upload', { method: 'POST', body: fd });
                                const json = await res.json();
                                if (json.success) {
                                  setBillUploaded(true);
                                  if (json.stageAdvanced) await load();
                                } else { setBillUploadErr(json.error || 'Upload failed. Please try again.'); }
                              } catch { setBillUploadErr('Connection error. Please try again.'); }
                              finally   { setBillUploading(false); }
                            }}
                          />
                        </label>
                      </div>
                    )}
                  </div>
                )}

                {/* Proposal CTA */}
                {(stage === 'proposal' || projectProposals.some(pr => !!pr.signed_at)) && projectProposals.length > 0 && (() => {
                  const prop = projectProposals[0];
                  const propUrl = `/proposals/view/${prop.id}?token=${prop.share_token}`;
                  return (
                    <div className="mt-6 border-t border-white/[0.05] pt-6">
                      {prop.signed_at ? (
                        <div className="rounded-2xl bg-emerald-500/[0.06] border border-emerald-500/[0.15] p-5">
                          <div className="flex items-start gap-3">
                            <CheckCircle2 size={18} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-bold text-emerald-300">Proposal Signed ✓</p>
                              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                                Signed on {new Date(prop.signed_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}. Your installer will reach out to schedule installation.
                              </p>
                              <a href={propUrl} target="_blank" rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 mt-3 text-xs text-slate-400 hover:text-white transition-colors">
                                <ExternalLink size={11} /> View your signed proposal
                              </a>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-2xl bg-amber-500/[0.07] border border-amber-500/[0.18] p-5">
                          <div className="flex items-start gap-3 mb-4">
                            <div className="w-9 h-9 rounded-xl bg-amber-500/[0.15] border border-amber-500/[0.2] flex items-center justify-center flex-shrink-0">
                              <PenLine size={15} className="text-amber-400" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-bold text-white">Your proposal is ready to review</p>
                              <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                                {prop.name} — review your system design, savings estimate, and sign when you're ready.
                              </p>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <a href={propUrl} target="_blank" rel="noopener noreferrer"
                              className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-black font-bold text-sm transition-colors shadow-lg shadow-amber-500/20">
                              <PenLine size={13} /> View &amp; Sign Proposal
                            </a>
                            <a href={propUrl} target="_blank" rel="noopener noreferrer"
                              className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 bg-white/[0.04] border border-white/[0.08] text-slate-300 hover:text-white hover:border-white/[0.15] font-medium text-sm transition-colors">
                              <TrendingUp size={13} /> See your savings
                            </a>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* ══ PHASE 2: PROPOSAL ANTICIPATION (design stage) ═══════════ */}
            {stage === 'design' && <ProposalAnticipation systemSizeKw={p.system_size_kw} />}

            {/* ══ PHASE 1: RECENT ACTIVITY ════════════════════════════════ */}
            <RecentActivity microStages={projectMicros} stageHistory={projectHistory} />

            {/* ══ PHASE 5: PROJECTED BENEFITS ════════════════════════════ */}
            <ProjectedBenefits systemSizeKw={p.system_size_kw} stage={stage} />

            {/* ══ ICA / PTO (installation) ════════════════════════════════ */}
            {showIca && (icaTier1 || icaFallback) && (() => {
              const t1 = icaTier1, t2 = icaFallback;
              const steps   = t1 ? t1.pto_steps : (t2?.generic_steps ?? []);
              const icaTime = t1 ? `${t1.ica_approval_days_min}–${t1.ica_approval_days_max} business days` : t2 ? `${t2.typical_ica_days_min}–${t2.typical_ica_days_max} business days` : null;
              const ptoTime = t1 ? `${t1.pto_days_min}–${t1.pto_days_max} business days` : t2 ? `${t2.typical_pto_days_min}–${t2.typical_pto_days_max} business days` : null;
              const uUrl    = t1?.application_url ?? null;
              const rUrl    = t2?.rules_url ?? null;
              const lbl     = t1 ? t1.utility_name : t2 ? `${t2.state_name} (${t2.regulatory_body})` : null;
              return (
                <div className="rounded-2xl border border-violet-500/[0.12] bg-violet-500/[0.03] px-6 sm:px-8 py-6">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-violet-500/60">Utility Approval</span>
                  </div>
                  <h3 className="text-lg font-black text-white mb-1">What happens next with your utility</h3>
                  {lbl && (
                    <p className="text-xs text-slate-400 mb-4 flex items-center gap-1.5">
                      <Info size={11} className="text-slate-500 flex-shrink-0" />
                      {t1 ? `Process specific to ${lbl}` : `Typical process — ${lbl}`}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2 mb-5">
                    {icaTime && (
                      <div className="flex items-center gap-1.5 rounded-full px-3 py-1 bg-violet-500/10 border border-violet-500/20">
                        <Clock size={11} className="text-violet-400" />
                        <span className="text-xs text-violet-300 font-medium">Grid approval: {icaTime}</span>
                      </div>
                    )}
                    {ptoTime && (
                      <div className="flex items-center gap-1.5 rounded-full px-3 py-1 bg-emerald-500/10 border border-emerald-500/20">
                        <CheckCircle size={11} className="text-emerald-400" />
                        <span className="text-xs text-emerald-300 font-medium">System turn-on: {ptoTime}</span>
                      </div>
                    )}
                    {(uUrl || rUrl) && (
                      <a href={uUrl ?? rUrl ?? '#'} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1.5 rounded-full px-3 py-1 bg-sky-500/10 border border-sky-500/20 hover:bg-sky-500/20 transition-colors">
                        <ExternalLink size={11} className="text-sky-400" />
                        <span className="text-xs text-sky-300 font-medium">{uUrl ? 'Utility portal' : 'State guidelines'}</span>
                      </a>
                    )}
                  </div>
                  {steps.length > 0 && (
                    <div className="space-y-0">
                      {steps.map((step, idx) => (
                        <div key={idx} className="flex gap-3">
                          <div className="flex flex-col items-center flex-shrink-0">
                            <div className="w-6 h-6 rounded-full border-2 border-violet-500/30 flex items-center justify-center text-xs font-black text-violet-400">{idx + 1}</div>
                            {idx < steps.length - 1 && <div className="w-px flex-1 bg-violet-500/20 my-1" />}
                          </div>
                          <div className={`${idx < steps.length - 1 ? 'pb-3' : ''} flex-1 min-w-0`}>
                            <p className="text-xs text-slate-300 leading-relaxed">{step}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-4 rounded-lg px-3 py-2 bg-slate-800/40 border border-slate-700/30">
                    <p className="text-xs text-slate-500 leading-relaxed">Your installer manages this entire process on your behalf — no action needed from you.</p>
                  </div>
                </div>
              );
            })()}

            {/* ══ DOCUMENT VAULT ════════════════════════════════════════════ */}
            <DocumentVault documents={documents} />

            {/* ══ REFERRAL LINK GENERATOR ═════════════════════════════════ */}
            <ReferralSection
              stage={stage}
              ownerCompany={owner?.company ?? null}
              clientName={client?.name ?? ''}
            />

            {/* ══ PHASE 6: MONITORING FOUNDATION (completed) ══════════════ */}
            <MonitoringFoundation stage={stage} />

            {/* ══ PHASE 3: PROJECT TEAM ════════════════════════════════════ */}
            {owner && <ProjectTeam owner={owner} />}

          </div>
        ) : (
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-16 text-center">
            <div className="w-16 h-16 rounded-2xl bg-amber-500/8 border border-amber-500/12 flex items-center justify-center mx-auto mb-5">
              <Sun size={28} className="text-amber-400/40" />
            </div>
            <h3 className="text-lg font-bold text-white mb-2">Your project is being set up</h3>
            <p className="text-sm text-slate-600 max-w-sm mx-auto">It'll appear here within 1 business day of your inquiry.</p>
          </div>
        )}

        <div className="flex items-center justify-center gap-3 pt-8 pb-4">
          <div className="h-px flex-1 bg-white/[0.03]" />
          <span className="text-[10px] text-white/10 flex items-center gap-1.5">
            <Sun size={9} className="text-amber-500/20" /> {owner?.company ?? 'Solar Portal'}
          </span>
          <div className="h-px flex-1 bg-white/[0.03]" />
        </div>
      </main>
    </div>
  );
}
