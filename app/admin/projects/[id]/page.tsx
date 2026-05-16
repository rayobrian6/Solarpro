'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, RefreshCw, CheckCircle, AlertCircle,
  Clock, MapPin, Zap, User, Building2, History, Activity,
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
  status: string;
  origin: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  homeowner_stage: HomeownerStage | null;
  owner_name: string;
  owner_email: string;
  owner_id: string;
  client_name: string | null;
  client_email: string | null;
  client_id: string | null;
}

interface StageHistoryEntry {
  id: string;
  stage: HomeownerStage;
  note: string | null;
  created_at: string;
  changed_by_name: string | null;
  changed_by_email: string | null;
}

interface ActivityEntry {
  id: string;
  type: string;
  title: string;
  details: string | null;
  created_at: string;
}

// ─── Stage config ─────────────────────────────────────────────────────────────

const STAGES: { value: HomeownerStage; label: string; color: string; dot: string }[] = [
  { value: 'lead_submitted',  label: 'Lead Submitted',  color: 'text-slate-400  bg-slate-500/20  border-slate-500/30',  dot: 'bg-slate-400' },
  { value: 'under_review',    label: 'Under Review',    color: 'text-blue-400   bg-blue-500/20   border-blue-500/30',   dot: 'bg-blue-400' },
  { value: 'site_survey',     label: 'Site Survey',     color: 'text-cyan-400   bg-cyan-500/20   border-cyan-500/30',   dot: 'bg-cyan-400' },
  { value: 'design',          label: 'Design',          color: 'text-violet-400 bg-violet-500/20 border-violet-500/30', dot: 'bg-violet-400' },
  { value: 'proposal',        label: 'Proposal',        color: 'text-amber-400  bg-amber-500/20  border-amber-500/30',  dot: 'bg-amber-400' },
  { value: 'installation',    label: 'Installation',    color: 'text-orange-400 bg-orange-500/20 border-orange-500/30', dot: 'bg-orange-400' },
  { value: 'completed',       label: 'Completed',       color: 'text-green-400  bg-green-500/20  border-green-500/30',  dot: 'bg-green-400' },
];

function stageMeta(stage: HomeownerStage | null) {
  return STAGES.find(s => s.value === stage) ?? null;
}

function stageIndex(stage: HomeownerStage | null) {
  return stage ? STAGES.findIndex(s => s.value === stage) : -1;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function AdminProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const router  = useRouter();

  const [project, setProject]         = useState<Project | null>(null);
  const [history, setHistory]         = useState<StageHistoryEntry[]>([]);
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [selectedStage, setSelectedStage] = useState<HomeownerStage | ''>('');
  const [note, setNote]               = useState('');
  const [toast, setToast]             = useState<{ msg: string; ok: boolean } | null>(null);
  const [activity, setActivity]       = useState<ActivityEntry[]>([]);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/projects/${id}`);
      const d   = await res.json();
      if (d.success) {
        setProject(d.project);
        setHistory(d.stageHistory ?? []);
        setSelectedStage(d.project.homeowner_stage ?? '');
        // #15 FIX: Load activity feed for this project
        fetch(`/api/activity?project_id=${id}&limit=20`)
          .then(r => r.json())
          .then(ad => { if (ad.activity) setActivity(ad.activity); })
          .catch(() => {});
      } else {
        showToast(d.error || 'Failed to load project', false);
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const saveStage = async () => {
    if (!selectedStage) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/projects/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'set-stage', stage: selectedStage, note: note.trim() || null }),
      });
      const d = await res.json();
      if (d.success) {
        showToast('✓ Stage updated');
        setNote('');
        load();
      } else {
        showToast(d.error || 'Failed to update stage', false);
      }
    } finally {
      setSaving(false);
    }
  };

  const currentMeta  = stageMeta(project?.homeowner_stage ?? null);
  const currentIndex = stageIndex(project?.homeowner_stage ?? null);

  // ─── Loading ─────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-500">
        <RefreshCw size={18} className="animate-spin mr-2" />
        Loading project...
      </div>
    );
  }

  if (!project) {
    return (
      <div className="text-center py-24 text-slate-500">
        Project not found.
        <button onClick={() => router.push('/admin/projects')} className="ml-2 text-amber-400 hover:underline">
          Back to Projects
        </button>
      </div>
    );
  }

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 max-w-4xl">

      {/* Back + header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/admin/projects')}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 className="text-2xl font-black text-white">{project.name}</h1>
            <p className="text-xs text-slate-500 font-mono mt-0.5">{project.id}</p>
          </div>
        </div>
        <a
          href={`/admin/projects/${project.id}/portal-preview`}
          className="flex items-center gap-2 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/25 text-amber-400 px-4 py-2 rounded-lg text-sm font-medium transition-all"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>
          Portal Preview
        </a>
      </div>

      {/* Info grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

        {/* Owner */}
        <div className="rounded-xl border border-white/5 bg-white/2 p-4">
          <div className="flex items-center gap-2 text-xs text-slate-500 mb-3">
            <User size={12} /> Owner
          </div>
          <p className="text-sm font-semibold text-white">{project.owner_name}</p>
          <p className="text-xs text-slate-400 mt-0.5">{project.owner_email}</p>
        </div>

        {/* Client */}
        <div className="rounded-xl border border-white/5 bg-white/2 p-4">
          <div className="flex items-center gap-2 text-xs text-slate-500 mb-3">
            <Building2 size={12} /> Client
          </div>
          {project.client_name ? (
            <>
              <p className="text-sm font-semibold text-white">{project.client_name}</p>
              <p className="text-xs text-slate-400 mt-0.5">{project.client_email ?? '—'}</p>
            </>
          ) : (
            <p className="text-sm text-slate-500 italic">No client linked</p>
          )}
        </div>

        {/* Project info */}
        <div className="rounded-xl border border-white/5 bg-white/2 p-4">
          <div className="flex items-center gap-2 text-xs text-slate-500 mb-3">
            <Zap size={12} /> System
          </div>
          <p className="text-sm font-semibold text-white">
            {project.system_size_kw ? `${project.system_size_kw} kW` : '—'}
          </p>
          {project.address && (
            <div className="flex items-start gap-1 mt-1">
              <MapPin size={10} className="text-slate-500 mt-0.5 shrink-0" />
              <p className="text-xs text-slate-400 leading-tight">{project.address}</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Homeowner Stage Panel ─────────────────────────────────────────── */}
      <div className="rounded-xl border border-white/10 bg-white/2 p-6 space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-white">Homeowner Stage</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Controls what the homeowner sees in their portal.
              This is <span className="text-amber-400 font-medium">separate</span> from the internal ops pipeline.
            </p>
          </div>
          {currentMeta && (
            <span className={`text-xs px-3 py-1 rounded-full font-semibold border ${currentMeta.color}`}>
              {currentMeta.label}
            </span>
          )}
          {!currentMeta && (
            <span className="text-xs px-3 py-1 rounded-full font-semibold border border-slate-500/30 bg-slate-500/10 text-slate-400">
              Not set
            </span>
          )}
        </div>

        {/* Stage progress bar */}
        <div className="flex items-center gap-0">
          {STAGES.map((s, i) => {
            const isActive   = i === currentIndex;
            const isPast     = i < currentIndex;
            const isLast     = i === STAGES.length - 1;
            return (
              <div key={s.value} className="flex items-center flex-1 min-w-0">
                <div className="flex flex-col items-center gap-1 flex-shrink-0">
                  <div className={`w-3 h-3 rounded-full border-2 transition-all ${
                    isActive ? `${s.dot} border-white scale-125` :
                    isPast   ? `${s.dot} border-transparent opacity-60` :
                               'bg-slate-700 border-slate-600'
                  }`} />
                  <span className={`text-[9px] font-medium whitespace-nowrap hidden md:block ${
                    isActive ? 'text-white' : isPast ? 'text-slate-500' : 'text-slate-600'
                  }`}>
                    {s.label}
                  </span>
                </div>
                {!isLast && (
                  <div className={`h-0.5 flex-1 mx-1 rounded-full ${i < currentIndex ? 'bg-white/20' : 'bg-white/5'}`} />
                )}
              </div>
            );
          })}
        </div>

        {/* Set stage controls */}
        <div className="border-t border-white/5 pt-4 space-y-3">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Update Stage</p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {STAGES.map(s => (
              <button
                key={s.value}
                onClick={() => setSelectedStage(s.value)}
                className={`px-3 py-2 rounded-lg text-xs font-medium border transition-all text-left ${
                  selectedStage === s.value
                    ? `${s.color} ring-1 ring-offset-0 ring-white/20`
                    : 'border-white/10 text-slate-400 hover:border-white/20 hover:text-white bg-transparent'
                }`}
              >
                <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${s.dot}`} />
                {s.label}
              </button>
            ))}
          </div>

          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Optional note (e.g. 'Site survey scheduled for Thursday')"
            rows={2}
            maxLength={500}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/50 resize-none"
          />

          <div className="flex items-center gap-3">
            <button
              onClick={saveStage}
              disabled={!selectedStage || saving || selectedStage === project.homeowner_stage}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? <RefreshCw size={13} className="animate-spin" /> : <CheckCircle size={13} />}
              {saving ? 'Saving...' : 'Save Stage'}
            </button>
            {selectedStage === project.homeowner_stage && selectedStage && (
              <span className="text-xs text-slate-500">Already set to this stage</span>
            )}
          </div>
        </div>
      </div>

      {/* ── Homeowner Portal ─────────────────────────────────────────────── */}
      <div className="rounded-xl border border-white/5 bg-white/2 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-white">Homeowner Portal</h2>
          <button
            onClick={() => {
              const url = `${window.location.origin}/portal/login`;
              navigator.clipboard.writeText(url).then(() => showToast('Portal link copied'));
            }}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white border border-white/10 hover:border-white/20 rounded-lg px-3 py-1.5 transition-all"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
            Copy Portal Link
          </button>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between py-2 border-b border-white/5">
            <span className="text-xs text-slate-500">Login email</span>
            <span className="text-xs text-white font-medium">
              {project.client_email ?? <span className="text-slate-600 italic">No client linked</span>}
            </span>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-xs text-slate-500">Portal stage shown</span>
            {project.homeowner_stage ? (
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
                stageMeta(project.homeowner_stage)?.color ?? 'text-slate-400 bg-slate-500/20 border-slate-500/30'
              }`}>
                {stageMeta(project.homeowner_stage)?.label ?? project.homeowner_stage}
              </span>
            ) : (
              <span className="text-xs text-slate-600 italic">Not set</span>
            )}
          </div>
        </div>
      </div>

      {/* ── Stage History ─────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-white/5 bg-white/2 p-5">
        <div className="flex items-center gap-2 mb-4">
          <History size={14} className="text-slate-500" />
          <h2 className="text-sm font-bold text-white">Stage History</h2>
          <span className="text-xs text-slate-600">({history.length})</span>
        </div>

        {history.length === 0 ? (
          <p className="text-xs text-slate-600 italic">No stage changes yet.</p>
        ) : (
          <div className="space-y-3">
            {history.map(entry => {
              const meta = stageMeta(entry.stage);
              return (
                <div key={entry.id} className="flex items-start gap-3">
                  <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${meta?.dot ?? 'bg-slate-500'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${meta?.color ?? 'text-slate-400 bg-slate-500/20 border-slate-500/30'}`}>
                        {meta?.label ?? entry.stage}
                      </span>
                      {entry.changed_by_name && (
                        <span className="text-xs text-slate-500">by {entry.changed_by_name}</span>
                      )}
                      <span className="text-xs text-slate-600">
                        {new Date(entry.created_at).toLocaleString()}
                      </span>
                    </div>
                    {entry.note && (
                      <p className="text-xs text-slate-400 mt-1 italic">"{entry.note}"</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Activity Feed ─────────────────────────────────────────────────────── */}
      {activity.length > 0 && (
        <div className="rounded-xl border border-white/5 bg-white/2 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Activity size={14} className="text-slate-500" />
            <h2 className="text-sm font-bold text-white">Activity Feed</h2>
            <span className="text-xs text-slate-600">({activity.length})</span>
          </div>
          <div className="space-y-3">
            {activity.map(entry => (
              <div key={entry.id} className="flex items-start gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-slate-600 mt-2 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-slate-300">{entry.title}</span>
                    <span className="text-xs text-slate-600">
                      {new Date(entry.created_at).toLocaleString()}
                    </span>
                  </div>
                  {entry.details && (
                    <p className="text-xs text-slate-500 mt-0.5 truncate">{entry.details}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Meta row */}
      <div className="flex items-center gap-4 text-xs text-slate-600 pb-2">
        <div className="flex items-center gap-1">
          <Clock size={10} />
          Created {new Date(project.created_at).toLocaleString()}
        </div>
        <div className="flex items-center gap-1">
          <Clock size={10} />
          Updated {new Date(project.updated_at).toLocaleString()}
        </div>
        {project.deleted_at && (
          <span className="text-red-400">Deleted {new Date(project.deleted_at).toLocaleString()}</span>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium shadow-xl ${
          toast.ok
            ? 'bg-green-500/20 border border-green-500/30 text-green-400'
            : 'bg-red-500/20 border border-red-500/30 text-red-400'
        }`}>
          {toast.ok ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}