'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Sun, MapPin, LogOut, RefreshCw,
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
        <circle cx="44" cy="44" r={r} fill="none" stroke="url(#ringGrad)" strokeWidth="5"
          strokeLinecap="round" strokeDasharray={circ}
          strokeDashoffset={circ - (pct / 100) * circ}
          style={{ transition: 'stroke-dashoffset 1s ease-out' }}
        />
        <defs>
          <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="0%">
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

// ─── CompletedSoFar — the new milestone subsection ───────────────────────────
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

  // suppress unused warning — history kept for potential future use
  void history;

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
      const hasBill = (d.documents ?? []).some((doc: { label: string; file_type?: string }) =>
        doc.label === 'Utility Bill' || doc.file_type === 'utility_bill'
      );
      setBillUploaded(hasBill);
    } catch { setError('Connection error. Please refresh the page.'); }
    finally { setLoading(false); setTimeout(() => setMounted(true), 80); }
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
          <RefreshCw size={13} className="animate-spin" /> Loading your project…
        </span>
      </div>
    </div>
  );

  if (error) return (
    <div className="min-h-screen flex items-center justify-center bg-[#07070e] px-4">
      <div className="text-center max-w-sm">
        <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/15 flex items-center justify-center mx-auto mb-4">
          <AlertCircle size={20} className="text-red-400" />
        </div>
        <p className="text-red-400 text-sm mb-4">{error}</p>
        <button onClick={load} className="px-5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-white hover:bg-white/8 transition-all">Try Again</button>
      </div>
    </div>
  );

  const p           = activeProject;
  const stage       = p?.homeowner_stage ?? null;
  const content     = stage ? STAGE_CONTENT[stage] : null;
  const stageIdx    = getStageIndex(stage);
  const pct         = stage ? Math.round(((stageIdx + 1) / ROADMAP_STEPS.length) * 100) : 0;
  const lastUpdated = p ? formatDate(p.updated_at) : null;
  const greeting    = getTimeOfDayGreeting();
  const firstName   = client ? getFirstName(client.name) : 'there';

  // Micro-stages scoped to the active project
  const projectMicros = microStages.filter(m => activeProject && m.project_id === activeProject.id);

  // Documents scoped to the active project
  const projectDocs = documents.filter(d => activeProject && d.project_id === activeProject.id);

  // Proposals scoped to the active project (most recent first)
  const projectProposals = proposals.filter(pr => activeProject && pr.project_id === activeProject.id);

  // ── ICA / PTO lookup for installation stage ───────────────────────────────
  // Extract state from project address or client.state for Tier 2 fallback.
  // In portal context we don't have utility_id, so we use Tier 2 (state fallback) by default.
  // If a matching Tier-1 profile exists for a known utility (future enhancement), it would
  // override this — for now portal always shows state-level guidance.
  const portalStateCode = (
    (client as any)?.state ||
    (() => {
      const addr = p?.address || '';
      const m = addr.match(/\b([A-Z]{2})\s+\d{5}/i) || addr.match(/,\s*([A-Z]{2})\s*$/i);
      return m ? m[1].toUpperCase() : '';
    })()
  ).toUpperCase().trim().slice(0, 2);
  // Try Tier 1 via any utility name on the proposal (not available in portal — skip for now)
  const portalIcaTier1 = null as ReturnType<typeof getInterconnectionProfile>;  // reserved for future
  void getInterconnectionProfile; // keep import used
  // Tier 2: state fallback — always available when stage is 'installation'
  const portalIcaFallback = portalStateCode ? getStateIcaFallback(portalStateCode) : null;
  const showIcaSection = stage === 'installation' && (portalIcaTier1 || portalIcaFallback);

  return (
    <div className="min-h-screen bg-[#07070e] text-white overflow-x-hidden">

      {/* Subtle ambient */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden z-0">
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[800px] h-[400px] rounded-full bg-amber-500/[0.02] blur-[120px]" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] rounded-full bg-blue-600/[0.015] blur-[100px]" />
      </div>

      {/* NAV */}
      <header className="sticky top-0 z-30 border-b border-white/[0.05] bg-[#07070e]/95 backdrop-blur-xl">
        <div className="max-w-4xl mx-auto px-5 sm:px-8 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/15 flex items-center justify-center">
              <Sun size={14} className="text-amber-400" />
            </div>
            <div>
              <div className="text-sm font-bold text-white leading-none">
                {owner?.company ?? 'Solar Portal'}
              </div>
              <div className="text-[10px] text-slate-600 mt-0.5">Homeowner Portal</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {client && (
              <span className="hidden sm:block text-xs text-slate-600">{client.email}</span>
            )}
            <button onClick={handleLogout} className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-300 border border-white/[0.06] hover:border-white/15 rounded-lg px-3 py-1.5 transition-all">
              <LogOut size={11} /> Sign out
            </button>
          </div>
        </div>
      </header>

      <main className={`max-w-4xl mx-auto px-5 sm:px-8 py-10 relative z-10 space-y-8 transition-all duration-500 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}`}>

        {/* Project switcher */}
        {projects.length > 1 && (
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {projects.map(proj => (
              <button key={proj.id} onClick={() => setActiveProject(proj)}
                className={`flex-shrink-0 text-xs font-medium px-3 py-1.5 rounded-full border transition-all ${activeProject?.id === proj.id ? 'bg-amber-500/15 border-amber-500/25 text-amber-300' : 'bg-white/[0.03] border-white/[0.07] text-slate-500 hover:text-white'}`}>
                {proj.address ? proj.address.split(',')[0] : proj.name}
              </button>
            ))}
          </div>
        )}

        {p ? (
          <>
            {/* ── 1. HEADER ── */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-amber-500/50 mb-3">Your Solar Project</p>
              <h1 className="text-3xl sm:text-4xl font-black text-white leading-tight">
                {greeting},{' '}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-300 to-amber-500">{firstName}</span>
              </h1>
              {p.address && (
                <div className="flex items-center gap-2 mt-3">
                  <MapPin size={12} className="text-slate-600 flex-shrink-0" />
                  <span className="text-sm text-slate-400">{p.address}</span>
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

                {/* ── Completed so far (NEW) ── */}
                <CompletedSoFar stage={stage} microStages={projectMicros} />

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

                {/* Bill upload — only for lead_submitted or under_review */}
                {(p.homeowner_stage === 'lead_submitted' || p.homeowner_stage === 'under_review') && (
                  <div className="mt-6 border-t border-white/[0.05] pt-6">
                    {billUploaded ? (
                      <div className="flex items-center gap-3 rounded-xl bg-emerald-500/[0.06] border border-emerald-500/[0.12] px-4 py-3">
                        <CheckCircle2 size={15} className="text-emerald-400 flex-shrink-0" />
                        <div>
                          <p className="text-sm font-semibold text-emerald-300">Utility bill received ✓</p>
                          <p className="text-xs text-slate-500 mt-0.5">We&apos;re analyzing your energy usage now.</p>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <p className="text-sm font-semibold text-white mb-1">Upload Your Utility Bill</p>
                        <p className="text-xs text-slate-500 mb-4">Upload your electric bill so we can analyze your usage and design the right system.</p>
                        {billUploadErr && (
                          <p className="text-xs text-red-400 mb-3">{billUploadErr}</p>
                        )}
                        <label className={`inline-flex items-center gap-2.5 rounded-xl px-5 py-2.5 border cursor-pointer transition-all ${
                          billUploading
                            ? 'bg-white/[0.02] border-white/[0.06] text-slate-600 cursor-not-allowed'
                            : 'bg-amber-500/[0.08] border-amber-500/[0.15] text-amber-300 hover:bg-amber-500/[0.12] hover:border-amber-500/[0.25]'
                        }`}>
                          <FileCheck size={13} className="flex-shrink-0" />
                          <span className="text-sm font-semibold">
                            {billUploading ? 'Uploading...' : 'Upload Bill'}
                          </span>
                          <input
                            type="file"
                            accept=".pdf,.jpg,.jpeg,.png,.webp"
                            className="hidden"
                            disabled={billUploading}
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file || !p.id) return;
                              setBillUploading(true);
                              setBillUploadErr('');
                              try {
                                const fd = new FormData();
                                fd.append('file', file);
                                fd.append('project_id', p.id);
                                const res = await fetch('/api/portal/bill-upload', { method: 'POST', body: fd });
                                const json = await res.json();
                                if (json.success) {
                                  setBillUploaded(true);
                                  if (json.stageAdvanced) {
                                    await load();
                                  }
                                } else {
                                  setBillUploadErr(json.error || 'Upload failed. Please try again.');
                                }
                              } catch {
                                setBillUploadErr('Connection error. Please try again.');
                              } finally {
                                setBillUploading(false);
                              }
                            }}
                          />
                        </label>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Proposal CTA — shown when stage is 'proposal' and a shared proposal exists ── */}
                {p.homeowner_stage === 'proposal' && projectProposals.length > 0 && (() => {
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
                                You signed on {new Date(prop.signed_at!).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}. Your installer will be in touch to schedule installation.
                              </p>
                              <a
                                href={propUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 mt-3 text-xs text-slate-400 hover:text-white transition-colors"
                              >
                                <ExternalLink size={11} />
                                View proposal again
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
                              <p className="text-sm font-bold text-white">Your proposal is ready to review</p>
                              <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                                {prop.name} — review your system design, pricing, and savings estimate, then sign to move forward.
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
                              View &amp; Sign Proposal
                            </a>
                            <a
                              href={propUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 bg-white/[0.04] border border-white/[0.08] text-slate-300 hover:text-white hover:border-white/[0.15] font-medium text-sm transition-colors"
                            >
                              <TrendingUp size={13} />
                              See your savings
                            </a>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* ── ICA / PTO Roadmap — shown during installation stage ───────── */}
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
                <p className="text-sm font-semibold text-white leading-snug">{p.address ? p.address.split(',')[0] : '—'}</p>
                {p.address?.includes(',') && <p className="text-xs text-slate-600 mt-0.5">{p.address.split(',').slice(1).join(',').trim()}</p>}
              </div>

              <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Zap size={13} className="text-slate-600" />
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600">System Size</p>
                </div>
                {p.system_size_kw
                  ? <><p className="text-xl font-black text-amber-400">{p.system_size_kw}</p><p className="text-xs text-slate-600">kilowatts</p></>
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
                            {doc.doc_type?.replace(/_/g, ' ') ?? 'Document'}
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

          </>
        ) : (
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-16 text-center">
            <div className="w-14 h-14 rounded-2xl bg-amber-500/8 border border-amber-500/12 flex items-center justify-center mx-auto mb-4">
              <Sun size={24} className="text-amber-400/40" />
            </div>
            <h3 className="text-base font-bold text-white mb-2">Your project is being set up</h3>
            <p className="text-sm text-slate-600 max-w-sm mx-auto">It'll appear here within 1 business day of your inquiry.</p>
          </div>
        )}

        <div className="flex items-center justify-center gap-3 pt-2 pb-6">
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