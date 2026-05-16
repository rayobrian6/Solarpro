'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Sun, MapPin, LogOut, RefreshCw,
  CheckCircle2, Circle, Clock,
  Phone, Mail, AlertCircle, Zap,
  TrendingUp, Home, FileCheck, ExternalLink, PenLine,
  Info, CheckCircle, ChevronRight, Star,
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

// ─── Stage Definitions ────────────────────────────────────────────────────────

type StageContent = {
  roadmapLabel:     string;
  stepNum:          number;
  headline:         string;
  body:             string;
  next:             string;
  action:           string;
  actionIsRequired: boolean;
  emoji:            string;
  color:            'amber' | 'blue' | 'emerald' | 'violet';
};

const MICRO_STAGE_LABELS: Record<string, string> = {
  lead_created:             'Project opened',
  project_created:          'Project created',
  bill_uploaded:            'Utility bill received',
  bill_parsed:              'Energy usage analyzed',
  usage_calculated:         'Usage calculated',
  pre_design_complete:      'Pre-design completed',
  survey_scheduled:         'Survey scheduled',
  survey_started:           'Site visit in progress',
  survey_photos_uploaded:   'Site photos received',
  survey_submitted:         'Survey submitted',
  survey_reviewed:          'Survey reviewed',
  layout_started:           'Layout in progress',
  layout_completed:         'Layout completed',
  engineering_started:      'Engineering underway',
  engineering_completed:    'Engineering complete',
  sld_generated:            'Electrical diagram done',
  planset_generated:        'Plan set complete',
  final_proposal_generated: 'Proposal prepared',
  proposal_sent:            'Proposal sent to you',
  proposal_viewed:          'Proposal reviewed',
  proposal_approved:        'Proposal approved',
  contract_sent:            'Contract sent',
  contract_viewed:          'Contract reviewed',
  contract_signed:          'Contract signed',
  permit_submitted:         'Permit application filed',
  permit_approved:          'Permit approved',
  install_scheduled:        'Install date confirmed',
  install_started:          'Installation underway',
  install_completed:        'Installation complete',
  inspection_passed:        'Inspection passed',
  pto_submitted:            'Grid connection filed',
  pto_approved:             'Grid connection approved',
  system_live:              'System is live',
  monitoring_active:        'Monitoring activated',
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
    roadmapLabel: 'Request Received', stepNum: 1,
    headline: 'We got your request.',
    body: "We're getting familiar with your home and energy needs. Your project has been created and we'll be in touch soon.",
    next: "We'll review your project and reach out shortly.",
    action: 'Nothing to do right now.',
    actionIsRequired: false, emoji: '📋', color: 'amber',
  },
  under_review: {
    roadmapLabel: 'Under Review', stepNum: 2,
    headline: "We're reviewing your project.",
    body: "We're analyzing your home, roof, and energy usage to size the right system for you. This usually takes 1–2 business days.",
    next: "We'll schedule your site survey.",
    action: 'Nothing to do right now.',
    actionIsRequired: false, emoji: '🔍', color: 'amber',
  },
  site_survey: {
    roadmapLabel: 'Site Survey', stepNum: 3,
    headline: 'Your site survey is coming up.',
    body: "We're sending a technician to your home to measure your roof and verify all setup details — this ensures your system design is accurate.",
    next: "We'll start designing your system right after the visit.",
    action: "We'll reach out to confirm your appointment. Please be available.",
    actionIsRequired: true, emoji: '📐', color: 'blue',
  },
  design: {
    roadmapLabel: 'System Design', stepNum: 4,
    headline: "We're designing your system.",
    body: "Our engineers are building a custom solar layout for your home — optimizing panel placement, system size, and projected output.",
    next: "We'll put together your proposal.",
    action: 'Nothing to do right now.',
    actionIsRequired: false, emoji: '⚡', color: 'amber',
  },
  proposal: {
    roadmapLabel: 'Proposal Ready', stepNum: 5,
    headline: 'Your proposal is ready.',
    body: "We've built your complete solar plan — including system size, estimated annual savings, and your financing options.",
    next: "Once you approve, we move to installation.",
    action: 'Review your proposal below and let us know if you have questions.',
    actionIsRequired: true, emoji: '📄', color: 'amber',
  },
  installation: {
    roadmapLabel: 'Installation', stepNum: 6,
    headline: 'Installation is being scheduled.',
    body: "We're pulling permits and coordinating your installation crew. Everything is moving forward — you'll hear from us soon with a confirmed date.",
    next: "We'll confirm your install date.",
    action: "Watch for our call or email with scheduling details.",
    actionIsRequired: true, emoji: '🔧', color: 'blue',
  },
  completed: {
    roadmapLabel: 'Complete', stepNum: 7,
    headline: 'Your system is live. 🎉',
    body: "Your solar panels are installed, inspected, and generating clean power. Welcome to energy independence.",
    next: '',
    action: "You're all set. Enjoy the savings.",
    actionIsRequired: false, emoji: '🌟', color: 'emerald',
  },
};

function getStageIndex(stage: HomeownerStage | null): number {
  if (!stage) return -1;
  return ROADMAP_STEPS.indexOf(stage);
}
function getFirstName(name: string): string { return name.split(' ')[0]; }
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

// ─── Progress Arc ─────────────────────────────────────────────────────────────

function ProgressArc({ pct, stage }: { pct: number; stage: HomeownerStage | null }) {
  const r = 52, circ = 2 * Math.PI * r;
  const isComplete = stage === 'completed';
  return (
    <div className="relative flex flex-col items-center justify-center" style={{ width: 140, height: 140 }}>
      <svg className="-rotate-90 absolute inset-0" viewBox="0 0 128 128" width="140" height="140">
        <circle cx="64" cy="64" r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="7" />
        <circle cx="64" cy="64" r={r} fill="none"
          stroke={isComplete ? '#10b981' : 'url(#arcGrad)'}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ - (pct / 100) * circ}
          style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1)' }}
        />
        <defs>
          <linearGradient id="arcGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#fbbf24" />
          </linearGradient>
        </defs>
      </svg>
      <div className="relative z-10 text-center">
        {isComplete
          ? <Star size={28} className="text-emerald-400 mx-auto" />
          : <>
              <span className="text-3xl font-black text-white leading-none">{pct}</span>
              <span className="text-sm font-bold text-amber-400">%</span>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest mt-0.5">complete</p>
            </>
        }
      </div>
    </div>
  );
}

// ─── Step Timeline ─────────────────────────────────────────────────────────────

function StepTimeline({ stage }: { stage: HomeownerStage | null }) {
  const ci = getStageIndex(stage);
  return (
    <>
      {/* Desktop horizontal */}
      <div className="hidden md:flex items-start relative pt-2 pb-1 gap-0">
        {ROADMAP_STEPS.map((s, i) => {
          const done = i < ci, cur = i === ci, future = i > ci;
          const c = STAGE_CONTENT[s];
          return (
            <div key={s} className="flex-1 flex flex-col items-center relative group">
              {/* connector left */}
              {i > 0 && (
                <div className={`absolute top-[18px] right-1/2 w-1/2 h-[2px] ${done || cur ? 'bg-amber-500/50' : 'bg-white/[0.07]'}`} />
              )}
              {/* connector right */}
              {i < ROADMAP_STEPS.length - 1 && (
                <div className={`absolute top-[18px] left-1/2 w-1/2 h-[2px] ${done ? 'bg-amber-500/50' : 'bg-white/[0.07]'}`} />
              )}
              {/* dot */}
              <div className={`relative z-10 flex items-center justify-center rounded-full border-2 transition-all duration-500 ${
                cur    ? 'w-10 h-10 bg-amber-500 border-amber-400 shadow-lg shadow-amber-500/40'
                : done  ? 'w-8 h-8 bg-emerald-500/20 border-emerald-500/60'
                        : 'w-8 h-8 bg-white/[0.03] border-white/[0.1]'
              }`}>
                {done
                  ? <CheckCircle2 size={15} className="text-emerald-400" />
                  : cur
                  ? <span className="text-base leading-none">{c.emoji}</span>
                  : <span className="text-xs font-black text-white/20">{i + 1}</span>
                }
                {cur && <span className="absolute inset-0 rounded-full bg-amber-500/20 animate-ping" />}
              </div>
              {/* label */}
              <span className={`mt-2.5 text-[10px] font-bold text-center leading-tight px-1 max-w-[72px] ${
                cur ? 'text-amber-300' : done ? 'text-emerald-400/70' : future ? 'text-white/20' : 'text-white/20'
              }`}>{c.roadmapLabel}</span>
              {cur && <span className="mt-0.5 text-[9px] font-black text-amber-500/50 uppercase tracking-widest">NOW</span>}
            </div>
          );
        })}
      </div>

      {/* Mobile vertical */}
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
  if (completed.length === 0) return null;
  return (
    <div className="mt-5 pt-5 border-t border-white/[0.06]">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-600 mb-3">Completed this stage</p>
      <div className="flex flex-wrap gap-2">
        {completed.map(key => (
          <span key={key} className="inline-flex items-center gap-1.5 text-xs bg-emerald-500/[0.07] border border-emerald-500/[0.15] text-emerald-300 rounded-full px-3 py-1 font-medium">
            <CheckCircle2 size={10} className="text-emerald-400 flex-shrink-0" />
            {MICRO_STAGE_LABELS[key] ?? key}
          </span>
        ))}
      </div>
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
    finally { setLoading(false); setTimeout(() => setMounted(true), 60); }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLogout = async () => {
    await fetch('/api/portal/logout', { method: 'POST' });
    router.replace('/portal/login');
  };

  // ── Loading ──
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

  const p            = activeProject;
  const stage        = p?.homeowner_stage ?? null;
  const content      = stage ? STAGE_CONTENT[stage] : null;
  const stageIdx     = getStageIndex(stage);
  const pct          = stage ? Math.round(((stageIdx + 1) / ROADMAP_STEPS.length) * 100) : 0;
  const firstName    = client ? getFirstName(client.name) : 'there';
  const greeting     = getGreeting();
  const projectMicros   = microStages.filter(m => p && m.project_id === p.id);
  const projectDocs     = documents.filter(d => p && d.project_id === p.id);
  const projectProposals = proposals.filter(pr => p && pr.project_id === p.id);
  const isComplete   = stage === 'completed';

  // ICA / PTO
  const portalStateCode = (
    (client as any)?.state ||
    (() => {
      const addr = p?.address || '';
      const m = addr.match(/\b([A-Z]{2})\s+\d{5}/i) || addr.match(/,\s*([A-Z]{2})\s*$/i);
      return m ? m[1].toUpperCase() : '';
    })()
  ).toUpperCase().trim().slice(0, 2);
  const portalIcaTier1 = null as ReturnType<typeof getInterconnectionProfile>;
  void getInterconnectionProfile;
  const portalIcaFallback = portalStateCode ? getStateIcaFallback(portalStateCode) : null;
  const showIcaSection = stage === 'installation' && (portalIcaTier1 || portalIcaFallback);

  return (
    <div className="min-h-screen bg-[#07070e] text-white overflow-x-hidden">

      {/* Ambient glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden z-0">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[900px] h-[500px] rounded-full bg-amber-500/[0.025] blur-[140px]" />
        <div className="absolute bottom-0 right-0 w-[500px] h-[500px] rounded-full bg-blue-600/[0.012] blur-[120px]" />
      </div>

      {/* ── NAV ── */}
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
                className={`flex-shrink-0 text-xs font-medium px-3 py-1.5 rounded-full border transition-all ${activeProject?.id === proj.id ? 'bg-amber-500/15 border-amber-500/25 text-amber-300' : 'bg-white/[0.03] border-white/[0.07] text-slate-500 hover:text-white'}`}>
                {proj.address ? proj.address.split(',')[0] : proj.name}
              </button>
            ))}
          </div>
        )}

        {p ? (
          <div className="space-y-5">

            {/* ══ HERO BLOCK ══════════════════════════════════════════════ */}
            <div className="rounded-2xl overflow-hidden border border-white/[0.06] bg-gradient-to-br from-white/[0.03] via-white/[0.015] to-transparent">
              {/* Top strip */}
              <div className={`h-1 w-full ${isComplete ? 'bg-gradient-to-r from-emerald-500 to-teal-400' : 'bg-gradient-to-r from-amber-500 to-amber-400'}`} style={{ width: `${pct}%` }} />

              <div className="px-6 sm:px-8 pt-7 pb-6">
                <div className="flex items-start justify-between gap-6">
                  {/* Left: greeting + address */}
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

                    {/* Quick stats row */}
                    <div className="flex flex-wrap gap-3 mt-5">
                      {p.system_size_kw && (
                        <div className="flex items-center gap-2 rounded-xl bg-amber-500/[0.07] border border-amber-500/[0.12] px-3.5 py-2">
                          <Zap size={13} className="text-amber-400 flex-shrink-0" />
                          <div>
                            <span className="text-base font-black text-amber-300">{p.system_size_kw}</span>
                            <span className="text-xs text-amber-500/60 ml-1">kW system</span>
                          </div>
                        </div>
                      )}
                      {content && (
                        <div className="flex items-center gap-2 rounded-xl bg-white/[0.03] border border-white/[0.07] px-3.5 py-2">
                          <Home size={13} className="text-slate-500 flex-shrink-0" />
                          <span className="text-sm text-slate-300 font-medium">Step {content.stepNum} of 7</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right: progress ring */}
                  <div className="flex-shrink-0 hidden sm:block">
                    <ProgressArc pct={pct} stage={stage} />
                  </div>
                </div>
              </div>

              {/* ── STEP TIMELINE ── */}
              <div className="px-6 sm:px-8 pb-7 border-t border-white/[0.04] pt-6">
                <div className="flex items-center justify-between mb-5">
                  <p className="text-xs font-black uppercase tracking-widest text-slate-500">Your Journey</p>
                  <span className="sm:hidden text-sm font-black text-amber-400">{pct}% done</span>
                </div>
                <StepTimeline stage={stage} />

                {/* Progress bar */}
                <div className="mt-5 h-1.5 bg-white/[0.04] rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-1000 ${isComplete ? 'bg-emerald-500' : 'bg-gradient-to-r from-amber-500 to-amber-400'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            </div>

            {/* ══ CURRENT STAGE CARD ══════════════════════════════════════ */}
            {content && stage && (
              <div className={`rounded-2xl border px-6 sm:px-8 py-7 ${
                isComplete
                  ? 'border-emerald-500/[0.15] bg-emerald-500/[0.03]'
                  : content.actionIsRequired
                  ? 'border-blue-500/[0.15] bg-blue-500/[0.03]'
                  : 'border-amber-500/[0.12] bg-amber-500/[0.03]'
              }`}>
                {/* Stage badge */}
                <div className="flex items-center gap-2 mb-4">
                  <div className={`w-2 h-2 rounded-full animate-pulse ${isComplete ? 'bg-emerald-400' : content.actionIsRequired ? 'bg-blue-400' : 'bg-amber-400'}`} />
                  <span className={`text-[10px] font-black uppercase tracking-widest ${isComplete ? 'text-emerald-500/70' : content.actionIsRequired ? 'text-blue-500/70' : 'text-amber-500/70'}`}>
                    {content.actionIsRequired ? 'Action Needed' : 'In Progress'} · {content.roadmapLabel}
                  </span>
                </div>

                {/* Headline */}
                <h2 className="text-2xl sm:text-3xl font-black text-white leading-snug mb-3">
                  {content.headline}
                </h2>

                {/* Body */}
                <p className="text-sm text-slate-300 leading-relaxed max-w-xl">{content.body}</p>

                {/* Milestone chips */}
                <MilestoneChips stage={stage} microStages={projectMicros} />

                {/* Next + Action */}
                <div className="mt-5 space-y-2.5">
                  {content.next && (
                    <div className="flex items-start gap-2.5">
                      <ChevronRight size={14} className="text-slate-600 mt-0.5 flex-shrink-0" />
                      <p className="text-sm text-slate-400">{content.next}</p>
                    </div>
                  )}
                  <div className={`inline-flex items-center gap-2.5 rounded-xl px-4 py-2.5 border ${
                    content.actionIsRequired
                      ? 'bg-blue-500/[0.08] border-blue-500/[0.18] text-blue-300'
                      : isComplete
                      ? 'bg-emerald-500/[0.08] border-emerald-500/[0.18] text-emerald-300'
                      : 'bg-emerald-500/[0.07] border-emerald-500/[0.12] text-emerald-300'
                  }`}>
                    {content.actionIsRequired
                      ? <AlertCircle size={13} className="text-blue-400 flex-shrink-0" />
                      : <CheckCircle2 size={13} className="text-emerald-400 flex-shrink-0" />}
                    <span className="text-sm font-medium">{content.action}</span>
                  </div>
                </div>

                {/* ── Bill upload ── */}
                {(p.homeowner_stage === 'lead_submitted' || p.homeowner_stage === 'under_review') && (
                  <div className="mt-6 border-t border-white/[0.05] pt-6">
                    {billUploaded ? (
                      <div className="flex items-center gap-3 rounded-xl bg-emerald-500/[0.06] border border-emerald-500/[0.12] px-4 py-3">
                        <CheckCircle2 size={15} className="text-emerald-400 flex-shrink-0" />
                        <div>
                          <p className="text-sm font-semibold text-emerald-300">Utility bill received ✓</p>
                          <p className="text-xs text-slate-500 mt-0.5">We're analyzing your energy usage now.</p>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <p className="text-sm font-bold text-white mb-1">Upload Your Utility Bill</p>
                        <p className="text-xs text-slate-500 mb-4">Share your electric bill so we can size your system correctly.</p>
                        {billUploadErr && <p className="text-xs text-red-400 mb-3">{billUploadErr}</p>}
                        <label className={`inline-flex items-center gap-2.5 rounded-xl px-5 py-2.5 border cursor-pointer transition-all ${
                          billUploading
                            ? 'bg-white/[0.02] border-white/[0.06] text-slate-600 cursor-not-allowed'
                            : 'bg-amber-500/[0.08] border-amber-500/[0.15] text-amber-300 hover:bg-amber-500/[0.12] hover:border-amber-500/[0.25]'
                        }`}>
                          <FileCheck size={13} className="flex-shrink-0" />
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
                                } else {
                                  setBillUploadErr(json.error || 'Upload failed. Please try again.');
                                }
                              } catch {
                                setBillUploadErr('Connection error. Please try again.');
                              } finally { setBillUploading(false); }
                            }}
                          />
                        </label>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Proposal CTA ── */}
                {(p.homeowner_stage === 'proposal' || projectProposals.some(pr => !!pr.signed_at)) && projectProposals.length > 0 && (() => {
                  const prop = projectProposals[0];
                  const propUrl = `/proposals/view/${prop.id}?token=${prop.share_token}`;
                  const isSigned = !!prop.signed_at;
                  return (
                    <div className="mt-6 border-t border-white/[0.05] pt-6">
                      {isSigned ? (
                        <div className="rounded-2xl bg-emerald-500/[0.06] border border-emerald-500/[0.15] p-5">
                          <div className="flex items-start gap-3">
                            <CheckCircle2 size={18} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-bold text-emerald-300">Proposal Signed ✓</p>
                              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                                You signed on {new Date(prop.signed_at!).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}. Your installer will be in touch to schedule installation.
                              </p>
                              <a href={propUrl} target="_blank" rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 mt-3 text-xs text-slate-400 hover:text-white transition-colors">
                                <ExternalLink size={11} /> View proposal again
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
                                {prop.name} — review your system design, pricing, and savings estimate.
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

            {/* ══ ICA / PTO ═══════════════════════════════════════════════ */}
            {showIcaSection && (portalIcaTier1 || portalIcaFallback) && (() => {
              const tier1 = portalIcaTier1;
              const tier2 = portalIcaFallback;
              const steps = tier1 ? tier1.pto_steps : (tier2?.generic_steps ?? []);
              const icaTime = tier1 ? `${tier1.ica_approval_days_min}–${tier1.ica_approval_days_max} biz days` : tier2 ? `${tier2.typical_ica_days_min}–${tier2.typical_ica_days_max} biz days` : null;
              const ptoTime = tier1 ? `${tier1.pto_days_min}–${tier1.pto_days_max} biz days` : tier2 ? `${tier2.typical_pto_days_min}–${tier2.typical_pto_days_max} biz days` : null;
              const portalUrl = tier1?.application_url ?? null;
              const rulesUrl  = tier2?.rules_url ?? null;
              const tierLabel = tier1 ? tier1.utility_name : tier2 ? `${tier2.state_name} (${tier2.regulatory_body})` : null;
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
                  <div className="flex flex-wrap gap-2 mb-5">
                    {icaTime && (
                      <div className="flex items-center gap-1.5 rounded-full px-3 py-1 bg-violet-500/10 border border-violet-500/20">
                        <Clock size={11} className="text-violet-400" />
                        <span className="text-xs text-violet-300 font-medium">Interconnection: {icaTime}</span>
                      </div>
                    )}
                    {ptoTime && (
                      <div className="flex items-center gap-1.5 rounded-full px-3 py-1 bg-emerald-500/10 border border-emerald-500/20">
                        <CheckCircle size={11} className="text-emerald-400" />
                        <span className="text-xs text-emerald-300 font-medium">PTO (turn-on): {ptoTime}</span>
                      </div>
                    )}
                    {portalUrl && (
                      <a href={portalUrl} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1.5 rounded-full px-3 py-1 bg-sky-500/10 border border-sky-500/20 hover:bg-sky-500/20 transition-colors">
                        <ExternalLink size={11} className="text-sky-400" />
                        <span className="text-xs text-sky-300 font-medium">Utility portal</span>
                      </a>
                    )}
                    {!portalUrl && rulesUrl && (
                      <a href={rulesUrl} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1.5 rounded-full px-3 py-1 bg-sky-500/10 border border-sky-500/20 hover:bg-sky-500/20 transition-colors">
                        <ExternalLink size={11} className="text-sky-400" />
                        <span className="text-xs text-sky-300 font-medium">State rules</span>
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
                          <div className={`pb-${idx < steps.length - 1 ? '3' : '0'} flex-1 min-w-0`}>
                            <p className="text-xs text-slate-300 leading-relaxed">{step}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-4 rounded-lg px-3 py-2 bg-slate-800/40 border border-slate-700/30">
                    <p className="text-xs text-slate-500 leading-relaxed">
                      {tier1 ? `Your installer handles most of this on your behalf.` : `Your installer handles the interconnection and PTO process for you.`}
                    </p>
                  </div>
                </div>
              );
            })()}

            {/* ══ DOCUMENTS ═══════════════════════════════════════════════ */}
            {projectDocs.length > 0 && (
              <div className="rounded-2xl border border-white/[0.06] bg-white/[0.015] overflow-hidden">
                <div className="px-6 sm:px-8 pt-5 pb-4 flex items-center gap-3 border-b border-white/[0.05]">
                  <div className="w-7 h-7 rounded-lg bg-blue-500/10 border border-blue-500/15 flex items-center justify-center">
                    <FileCheck size={13} className="text-blue-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-bold text-white">Your Documents</h3>
                    <p className="text-xs text-slate-600 mt-0.5">{projectDocs.length} file{projectDocs.length !== 1 ? 's' : ''} on your project</p>
                  </div>
                </div>
                <div className="divide-y divide-white/[0.04]">
                  {projectDocs.map((doc, i) => (
                    <div key={i} className="flex items-center justify-between px-6 sm:px-8 py-3.5 hover:bg-white/[0.02] transition-colors">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-7 h-7 rounded-lg bg-emerald-500/8 border border-emerald-500/15 flex items-center justify-center flex-shrink-0">
                          <CheckCircle2 size={12} className="text-emerald-400" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-white leading-none truncate">{doc.label}</p>
                          <p className="text-[10px] text-slate-600 mt-0.5 uppercase tracking-wide">{doc.doc_type?.replace(/_/g, ' ') ?? 'Document'}</p>
                        </div>
                      </div>
                      <p className="text-xs text-slate-600 flex-shrink-0 ml-4">
                        {new Date(doc.uploaded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ══ CONTACT ══════════════════════════════════════════════════ */}
            {(owner?.phone || owner?.email) && (
              <div className="rounded-2xl border border-white/[0.06] bg-white/[0.015] px-6 sm:px-8 py-6">
                <h3 className="text-sm font-bold text-white mb-1">Questions? We're here.</h3>
                <p className="text-xs text-slate-600 mb-5">Reach out to your project team anytime.</p>
                <div className="flex flex-col sm:flex-row gap-3">
                  {owner.phone && (
                    <a href={`tel:${owner.phone}`}
                      className="flex items-center gap-3 bg-white/[0.03] hover:bg-white/[0.05] border border-white/[0.07] hover:border-white/[0.12] rounded-xl px-4 py-3 transition-all group flex-1">
                      <div className="w-8 h-8 rounded-lg bg-amber-500/8 border border-amber-500/12 flex items-center justify-center flex-shrink-0">
                        <Phone size={13} className="text-amber-400" />
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-600 uppercase tracking-wide">Call Us</p>
                        <p className="text-sm font-semibold text-white group-hover:text-amber-300 transition-colors">{owner.phone}</p>
                      </div>
                    </a>
                  )}
                  {owner.email && (
                    <a href={`mailto:${owner.email}`}
                      className="flex items-center gap-3 bg-white/[0.03] hover:bg-white/[0.05] border border-white/[0.07] hover:border-white/[0.12] rounded-xl px-4 py-3 transition-all group flex-1">
                      <div className="w-8 h-8 rounded-lg bg-amber-500/8 border border-amber-500/12 flex items-center justify-center flex-shrink-0">
                        <Mail size={13} className="text-amber-400" />
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-600 uppercase tracking-wide">Email Us</p>
                        <p className="text-sm font-semibold text-white group-hover:text-amber-300 transition-colors">{owner.email}</p>
                      </div>
                    </a>
                  )}
                </div>
              </div>
            )}

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
