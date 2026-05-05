'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Sun, RefreshCw, Search, ChevronDown,
  MapPin, Clock, CheckCircle2, Circle,
  AlertCircle, Zap, TrendingUp, Home, Phone, Mail,
  FileCheck,
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

interface ProjectDocument {
  file_type?: string;
  label: string;
  uploaded_at: string;
}

// ─── Label normalizer (mirrors lib/normalizeDocumentLabel) ───────────────────

const LABEL_MAP: Array<[RegExp, string]> = [
  [/\butility[_\s-]?bill[_\s-]?summary\b/i, 'Utility Bill'],
  [/\butility[_\s-]?bill\b/i,               'Utility Bill'],
  [/\bbill\b/i,                              'Utility Bill'],
  [/\broof[_\s-]?photo/i,                   'Roof Photos'],
  [/\bmain[_\s-]?panel/i,                   'Main Panel Photos'],
  [/\bsite[_\s-]?survey/i,                  'Site Survey'],
  [/\bcontract\b/i,                          'Contract'],
  [/\bproposal\b/i,                          'Proposal'],
  [/\bpermit\b/i,                            'Permit'],
  [/\binspection\b/i,                        'Inspection Report'],
];

function normalizeLabel(raw: string): string {
  for (const [pattern, label] of LABEL_MAP) {
    if (pattern.test(raw)) return label;
  }
  return raw.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
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

// ─── Homeowner View ───────────────────────────────────────────────────────────

function HomeownerView({ project, documents }: { project: Project; documents: ProjectDocument[] }) {
  const stage       = project.homeowner_stage;
  const content     = stage ? STAGE_CONTENT[stage] : null;
  const stageIdx    = getStageIndex(stage);
  const pct         = stage ? Math.round(((stageIdx + 1) / ROADMAP_STEPS.length) * 100) : 0;
  const firstName   = project.client_name?.split(' ')[0] ?? 'there';
  const greeting    = getTimeOfDayGreeting();
  const lastUpdated = formatDate(project.updated_at);

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
        <div className="flex items-center gap-2 mt-1.5">
          <Clock size={11} className="text-slate-700 flex-shrink-0" />
          <span className="text-xs text-slate-600">Last updated {lastUpdated}</span>
        </div>
      </div>

      {/* ── 2. ROADMAP ── */}
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

      {/* ── 3. CURRENT STAGE ── */}
      {content && (
        <div className="rounded-2xl border border-amber-500/[0.12] bg-amber-500/[0.04] px-6 sm:px-10 py-8">
          <div className="flex items-center gap-2 mb-5">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-[10px] font-black uppercase tracking-widest text-amber-500/60">Current Stage</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-black text-white leading-snug mb-4">
            {content.headline}
          </h2>
          <p className="text-sm text-slate-300 leading-relaxed max-w-2xl">
            {content.body}
          </p>
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

      {/* ── 4. PROJECT DETAILS ── */}
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

      {/* ── 5. YOUR DOCUMENTS ── */}
      <div className="rounded-2xl border border-white/[0.05] bg-white/[0.015] px-6 sm:px-8 py-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-6 h-6 rounded-lg bg-emerald-500/10 border border-emerald-500/15 flex items-center justify-center">
            <FileCheck size={12} className="text-emerald-400" />
          </div>
          <h3 className="text-sm font-bold text-white">Your Documents</h3>
        </div>
        {documents.length === 0 ? (
          <p className="text-xs text-slate-600 py-2">No documents uploaded yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {documents.map((doc, i) => (
              <div key={i} className="flex items-center justify-between rounded-xl bg-white/[0.02] border border-white/[0.04] px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-md bg-emerald-500/10 border border-emerald-500/15 flex items-center justify-center flex-shrink-0">
                    <CheckCircle2 size={11} className="text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-white">{normalizeLabel(doc.label)}</p>
                    <p className="text-[10px] text-slate-600 uppercase tracking-wide mt-0.5">
                      {doc.file_type === 'utility_bill' ? 'Utility Bill' : 'Document'} · Received
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-slate-600">
                    {new Date(doc.uploaded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 6. CONTACT ── */}
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
  );
}

// ─── Admin Wrapper ────────────────────────────────────────────────────────────

export default function AdminHomeownerDashboardPage() {
  const [projects,   setProjects]   = useState<Project[]>([]);
  const [selected,   setSelected]   = useState<Project | null>(null);
  const [documents,  setDocuments]  = useState<ProjectDocument[]>([]);
  const [filtered,   setFiltered]   = useState<Project[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [docLoading, setDocLoading] = useState(false);
  const [search,     setSearch]     = useState('');
  const [showPicker, setShowPicker] = useState(false);

  // Load all projects (for picker)
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

  // Load per-project detail (documents + stage history)
  const loadProjectDetail = useCallback(async (projectId: string) => {
    setDocLoading(true);
    setDocuments([]);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}`);
      if (!res.ok) return;
      const d = await res.json();
      if (d.success) {
        setDocuments(d.documents ?? []);
        // Also update the selected project with fresh homeowner_stage
        if (d.project) {
          setSelected(prev => prev?.id === projectId ? { ...prev, ...d.project } : prev);
        }
      }
    } finally { setDocLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // When selected project changes, fetch its detail
  useEffect(() => {
    if (selected?.id) loadProjectDetail(selected.id);
  }, [selected?.id, loadProjectDetail]);

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

      {/* Admin bar */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-white">Homeowner Dashboard</h1>
          <p className="text-xs text-slate-500 mt-0.5">Preview the homeowner experience for any project.</p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white bg-white/5 border border-white/10 px-3 py-1.5 rounded-lg transition-all disabled:opacity-50 flex-shrink-0">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Project picker */}
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

      {/* Preview badge */}
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
        <HomeownerView key={selected.id} project={selected} documents={documents} />
      ) : (
        <div className="flex items-center justify-center h-64 rounded-2xl border border-white/8 bg-white/2">
          <p className="text-slate-600 text-sm">No projects found.</p>
        </div>
      )}

    </div>
  );
}