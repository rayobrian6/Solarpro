'use client';
import React, { useEffect, useState, useCallback } from 'react';
import AppShell from '@/components/ui/AppShell';
import { useParams } from 'next/navigation';
import type { Client, Project } from '@/types';
import { useAppStore } from '@/store/appStore';
import {
  ArrowLeft, Mail, Phone, MapPin, Zap, DollarSign,
  Building2, Plus, Edit, BarChart2, Sun,
  FolderOpen, Map, FileText, ChevronRight, Calendar,
  User, CheckCircle, AlertCircle, Clock, Camera,
  RefreshCw, AlertTriangle, Eye,
  StickyNote, Send, MessageSquare, Trash2, ExternalLink, TrendingUp,
} from 'lucide-react';
import Link from 'next/link';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import type { SiteSurvey } from '@/lib/db-neon';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const STATUS_DOT: Record<string, string> = {
  lead:      'bg-slate-400',
  design:    'bg-blue-500',
  proposal:  'bg-amber-500',
  approved:  'bg-emerald-500',
  installed: 'bg-green-500',
};
const STATUS_BADGE: Record<string, string> = {
  lead:      'bg-slate-700/60 text-slate-300 border border-slate-600/40',
  design:    'bg-blue-900/60 text-blue-300 border border-blue-700/40',
  proposal:  'bg-amber-900/60 text-amber-300 border border-amber-700/40',
  approved:  'bg-emerald-900/60 text-emerald-300 border border-emerald-700/40',
  installed: 'bg-green-900/60 text-green-300 border border-green-700/40',
};
const STATUS_LABEL: Record<string, string> = {
  lead: 'Lead', design: 'Design', proposal: 'Proposal', approved: 'Approved', installed: 'Installed',
};
const TYPE_ICONS: Record<string, string> = { roof: '🏠', ground: '🌱', fence: '🔲' };
const TYPE_BG: Record<string, string> = {
  roof: 'bg-amber-500/10', ground: 'bg-teal-500/10', fence: 'bg-purple-500/10',
};

// ---------------------------------------------------------------------------
// ProposalsSection — shows all proposals linked to this client's projects
// ---------------------------------------------------------------------------
interface ProposalRow {
  id: string;
  project_id: string;
  project_name: string | null;
  title: string | null;
  status: string;
  prepared_date: string | null;
  valid_until: string | null;
  sent_at: string | null;
  sent_to_email: string | null;
  net_cost: number | null;
}

const PROPOSAL_STATUS: Record<string, { label: string; cls: string }> = {
  draft:    { label: 'Draft',    cls: 'bg-slate-700/60 text-slate-300 border border-slate-600/40' },
  sent:     { label: 'Sent',     cls: 'bg-blue-900/60 text-blue-300 border border-blue-700/40' },
  signed:   { label: 'Signed',   cls: 'bg-emerald-900/60 text-emerald-300 border border-emerald-700/40' },
  expired:  { label: 'Expired',  cls: 'bg-red-900/60 text-red-300 border border-red-700/40' },
  declined: { label: 'Declined', cls: 'bg-rose-900/60 text-rose-300 border border-rose-700/40' },
};

function ProposalsSection({ clientId }: { clientId: string }) {
  const [proposals, setProposals] = useState<ProposalRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/proposals`);
      const json = await res.json();
      if (!json.success) { setError(json.error ?? 'Failed to load'); return; }
      setProposals(json.proposals ?? []);
    } catch { setError('Network error'); }
    finally { setLoading(false); }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700/50">
        <div className="flex items-center gap-2">
          <TrendingUp size={15} className="text-violet-400" />
          <span className="font-semibold text-white text-sm">Proposals</span>
          {proposals.length > 0 && (
            <span className="text-xs text-slate-500 font-mono">({proposals.length})</span>
          )}
        </div>
      </div>

      {loading ? (
        <div className="px-5 py-6 text-center text-slate-500 text-sm">
          <RefreshCw size={14} className="animate-spin inline mr-2" />Loading…
        </div>
      ) : error ? (
        <div className="px-5 py-4 text-sm text-red-400">{error}</div>
      ) : proposals.length === 0 ? (
        <div className="px-5 py-6 text-center text-slate-600 text-sm">No proposals yet.</div>
      ) : (
        <div className="divide-y divide-slate-700/40">
          {proposals.map(p => {
            const sc = PROPOSAL_STATUS[p.status] ?? { label: p.status, cls: 'bg-slate-700/60 text-slate-300 border border-slate-600/40' };
            return (
              <div key={p.id} className="flex items-center justify-between px-5 py-3 hover:bg-white/3 transition-colors">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-white truncate">
                      {p.title ?? 'Proposal'}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${sc.cls}`}>
                      {sc.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500 flex-wrap">
                    {p.project_name && (
                      <span className="flex items-center gap-1">
                        <FolderOpen size={9} />{p.project_name}
                      </span>
                    )}
                    {p.net_cost != null && (
                      <span className="text-emerald-400/70">${p.net_cost.toLocaleString()}</span>
                    )}
                    {p.sent_at && (
                      <span className="flex items-center gap-1">
                        <Send size={9} />Sent {new Date(p.sent_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
                <Link
                  href={`/admin/projects/${p.project_id}`}
                  className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors ml-3 flex-shrink-0"
                >
                  <ExternalLink size={11} />View
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NotesSection — add/delete client notes with timestamps
// ---------------------------------------------------------------------------
interface Note {
  id: string;
  note: string;
  created_at: string;
  author_name?: string | null;
}

function NotesSection({ clientId }: { clientId: string }) {
  const [notes, setNotes]     = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText]       = useState('');
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/notes`);
      const json = await res.json();
      if (!json.success) { setError(json.error ?? 'Failed to load'); return; }
      setNotes(json.notes ?? []);
    } catch { setError('Network error'); }
    finally { setLoading(false); }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  const addNote = async () => {
    if (!text.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/notes`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ note: text.trim() }),
      });
      const json = await res.json();
      if (json.success) { setText(''); load(); }
      else setError(json.error ?? 'Failed to add note');
    } catch { setError('Network error'); }
    finally { setSaving(false); }
  };

  const deleteNote = async (noteId: string) => {
    try {
      await fetch(`/api/clients/${clientId}/notes?noteId=${noteId}`, { method: 'DELETE' });
      load();
    } catch { /* silent */ }
  };

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-700/50">
        <StickyNote size={15} className="text-amber-400" />
        <span className="font-semibold text-white text-sm">Notes</span>
        {notes.length > 0 && (
          <span className="text-xs text-slate-500 font-mono">({notes.length})</span>
        )}
      </div>

      {/* Add note */}
      <div className="px-5 py-4 border-b border-slate-700/30 bg-slate-800/20">
        <div className="flex gap-2">
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Add a note… (max 2000 chars)"
            rows={2}
            maxLength={2000}
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/50 resize-none"
          />
          <button
            onClick={addNote}
            disabled={saving || !text.trim()}
            className="flex items-center gap-1.5 text-xs font-semibold text-black bg-amber-500 hover:bg-amber-400 rounded-lg px-3 py-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed self-start mt-0.5"
          >
            {saving ? <RefreshCw size={11} className="animate-spin" /> : <MessageSquare size={11} />}
            Add
          </button>
        </div>
        {error && <p className="text-xs text-red-400 mt-1.5">{error}</p>}
      </div>

      {/* Notes list */}
      {loading ? (
        <div className="px-5 py-5 text-center text-slate-500 text-sm">
          <RefreshCw size={14} className="animate-spin inline mr-2" />Loading…
        </div>
      ) : notes.length === 0 ? (
        <div className="px-5 py-5 text-center text-slate-600 text-sm">No notes yet.</div>
      ) : (
        <div className="divide-y divide-slate-700/30 max-h-64 overflow-y-auto">
          {notes.map(n => (
            <div key={n.id} className="flex items-start gap-3 px-5 py-3 group hover:bg-white/3 transition-colors">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-200 whitespace-pre-wrap break-words">{n.note}</p>
                <p className="text-xs text-slate-600 mt-1">
                  {n.author_name ? `${n.author_name} · ` : ''}
                  {new Date(n.created_at).toLocaleString()}
                </p>
              </div>
              <button
                onClick={() => deleteNote(n.id)}
                className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-all flex-shrink-0 mt-0.5"
                title="Delete note"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SiteSurveysSection — inline survey list for the client page
// ---------------------------------------------------------------------------
function SiteSurveysSection({ clientId }: { clientId: string }) {
  const [surveys, setSurveys]   = useState<SiteSurvey[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/site-surveys`);
      const json = await res.json();
      if (!json.success) { setError(json.error ?? 'Failed to load'); return; }
      setSurveys(json.data ?? []);
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  const statusCls: Record<string, string> = {
    completed: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25',
    reviewed:  'bg-cyan-500/15 text-cyan-400 border border-cyan-500/25',
    draft:     'bg-amber-500/15 text-amber-400 border border-amber-500/25',
  };

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700/50">
        <div className="flex items-center gap-2">
          <Camera size={15} className="text-cyan-400" />
          <h3 className="font-semibold text-white text-sm">Site Surveys</h3>
          {!loading && (
            <span className="text-xs text-slate-500 bg-slate-700/50 px-2 py-0.5 rounded-full">
              {surveys.length}
            </span>
          )}
        </div>
        <button
          onClick={load}
          className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-all"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {/* Body */}
      {loading ? (
        <div className="p-6 flex items-center justify-center">
          <div className="spinner w-5 h-5" />
        </div>
      ) : error ? (
        <div className="p-5 flex items-center gap-3">
          <AlertTriangle size={14} className="text-red-400" />
          <span className="text-xs text-red-400">{error}</span>
        </div>
      ) : surveys.length === 0 ? (
        <div className="p-8 text-center">
          <Camera size={24} className="text-slate-600 mx-auto mb-2" />
          <p className="text-slate-400 text-sm font-medium">No site surveys yet</p>
          <p className="text-slate-500 text-xs mt-1">
            Surveys will appear here once a field tech completes one for this client.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-slate-700/30">
          {surveys.map(s => (
            <div key={s.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-700/20 transition-colors group">
              {/* Status dot */}
              <div className="w-2 h-2 rounded-full flex-shrink-0 bg-emerald-500 mt-0.5" />

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-white truncate">
                    {s.addressSnapshot ?? 'Site Survey'}
                  </span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${statusCls[s.status] ?? statusCls.completed}`}>
                    {s.status.charAt(0).toUpperCase() + s.status.slice(1)}
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700/50 text-slate-400 capitalize">
                    {s.source === 'standalone' ? 'Standalone' : 'Handoff'}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-slate-500 flex-wrap">
                  <span className="flex items-center gap-1">
                    <Calendar size={10} />
                    {new Date(s.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                  {s.projectName && (
                    <span className="flex items-center gap-1 text-amber-400/70">
                      <FolderOpen size={10} /> {s.projectName}
                    </span>
                  )}
                  {s.fileCount !== undefined && s.fileCount > 0 && (
                    <span className="flex items-center gap-1">
                      <Camera size={10} /> {s.fileCount} photo{s.fileCount !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                {s.projectId && (
                  <Link
                    href={`/projects/${s.projectId}/survey/${s.id}`}
                    className="btn-ghost p-1.5 rounded-lg"
                    title="View survey detail"
                  >
                    <Eye size={13} />
                  </Link>
                )}
                {s.projectId && (
                  <Link
                    href={`/projects/${s.projectId}`}
                    className="btn-ghost p-1.5 rounded-lg"
                    title="Go to project"
                  >
                    <ChevronRight size={14} />
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();

  const clients = useAppStore(s => s.clients);
  const loadClients = useAppStore(s => s.loadClients);
  const projects = useAppStore(s => s.projects);
  const loadProjects = useAppStore(s => s.loadProjects);

  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Load projects if needed
    loadProjects(false);

    // Check store first
    const existing = clients.find(c => c.id === id);
    if (existing) {
      setClient(existing);
      setLoading(false);
      return;
    }
    // Fetch from server
    fetch(`/api/clients/${id}`)
      .then(r => r.json())
      .then(d => {
        if (d.success && d.data) {
          setClient(d.data);
          loadClients(true);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id, clients, loadClients, loadProjects]);

  if (loading) return (
    <AppShell>
      <div className="p-6 flex items-center justify-center h-64">
        <div className="spinner w-8 h-8" />
      </div>
    </AppShell>
  );

  if (!client) return (
    <AppShell>
      <div className="p-6 text-center">
        <p className="text-slate-400 mb-4">Client not found</p>
        <Link href="/clients" className="btn-primary">Back to Clients</Link>
      </div>
    </AppShell>
  );

  const chartData = MONTHS.map((month, i) => ({
    month,
    kwh: client.monthlyKwh[i] || 0,
    bill: Math.round((client.monthlyKwh[i] || 0) * client.utilityRate),
  }));

  const recommendedKw = Math.ceil((client.annualKwh / 1400) * 10) / 10;

  // Projects belonging to this client
  const clientProjects = projects.filter(p => p.clientId === id);
  const totalClientKw = clientProjects.reduce((s, p) => s + (p.layout?.systemSizeKw || 0), 0);
  const totalClientRevenue = clientProjects.reduce((s, p) => s + (p.costEstimate?.netCost || 0), 0);

  return (
    <AppShell>
      <div className="p-6 space-y-6 animate-fade-in">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link href="/clients" className="btn-ghost p-2 rounded-lg"><ArrowLeft size={18} /></Link>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-white">{client.name}</h1>
            <p className="text-slate-400 text-sm">{client.city}, {client.state}</p>
          </div>
          <Link href={`/clients/${id}/edit`} className="btn-secondary btn-sm"><Edit size={14} /> Edit</Link>
          <Link href={`/projects/new?clientId=${id}`} className="btn-primary btn-sm"><Plus size={14} /> New Project</Link>
        </div>

        {/* Top 3-column grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Contact Card */}
          <div className="card p-5 space-y-4">
            <h3 className="font-semibold text-white text-sm">Contact Information</h3>
            <div className="space-y-3">
              {[
                { icon: <Mail size={14} />, value: client.email },
                { icon: <Phone size={14} />, value: client.phone },
                { icon: <MapPin size={14} />, value: `${client.address}, ${client.city}, ${client.state} ${client.zip}` },
                { icon: <Building2 size={14} />, value: client.utilityProvider || 'Not specified' },
              ].map((item, i) => (
                <div key={i} className="flex items-start gap-3 text-sm">
                  <span className="text-slate-500 mt-0.5 flex-shrink-0">{item.icon}</span>
                  <span className="text-slate-300">{item.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Energy Stats */}
          <div className="card p-5 space-y-4">
            <h3 className="font-semibold text-white text-sm">Energy Profile</h3>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Annual Usage', value: `${client.annualKwh.toLocaleString()} kWh`, icon: <Zap size={14} />, color: 'text-amber-400' },
                { label: 'Annual Bill',  value: `$${client.annualBill.toLocaleString()}`,   icon: <DollarSign size={14} />, color: 'text-emerald-400' },
                { label: 'Avg Monthly',  value: `${client.averageMonthlyKwh.toLocaleString()} kWh`, icon: <BarChart2 size={14} />, color: 'text-blue-400' },
                { label: 'Utility Rate', value: `$${client.utilityRate}/kWh`,                icon: <DollarSign size={14} />, color: 'text-purple-400' },
              ].map(item => (
                <div key={item.label} className="bg-slate-800/60 rounded-xl p-3">
                  <div className={`flex items-center gap-1.5 mb-1 ${item.color}`}>{item.icon}<span className="text-xs">{item.label}</span></div>
                  <div className="font-bold text-white text-sm">{item.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Recommendation */}
          <div className="card p-5 bg-gradient-to-br from-amber-500/10 to-orange-500/5 border-amber-500/20">
            <div className="flex items-center gap-2 mb-3">
              <Sun size={16} className="text-amber-400" />
              <h3 className="font-semibold text-white text-sm">Solar Recommendation</h3>
            </div>
            <div className="text-3xl font-bold text-amber-400 mb-1">{recommendedKw} kW</div>
            <div className="text-xs text-slate-400 mb-4">Recommended system size</div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between"><span className="text-slate-400">Est. Annual Production</span><span className="text-white">{Math.round(recommendedKw * 1400).toLocaleString()} kWh</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Est. Offset</span><span className="text-emerald-400">~100%</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Est. Annual Savings</span><span className="text-emerald-400">${Math.round(client.annualBill * 0.9).toLocaleString()}</span></div>
            </div>
            <Link href={`/projects/new?clientId=${id}`} className="btn-primary w-full mt-4 text-xs justify-center">
              Start Design →
            </Link>
          </div>
        </div>

        {/* ── Projects Section ── */}
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700/50">
            <div className="flex items-center gap-2">
              <FolderOpen size={16} className="text-amber-400" />
              <h3 className="font-semibold text-white text-sm">Projects</h3>
              <span className="text-xs text-slate-500 bg-slate-700/50 px-2 py-0.5 rounded-full">
                {clientProjects.length}
              </span>
            </div>
            <div className="flex items-center gap-4">
              {clientProjects.length > 0 && (
                <div className="hidden sm:flex items-center gap-4 text-xs text-slate-500">
                  {totalClientKw > 0 && (
                    <span className="flex items-center gap-1 text-amber-400/80">
                      <Zap size={11} />{totalClientKw.toFixed(1)} kW total
                    </span>
                  )}
                  {totalClientRevenue > 0 && (
                    <span className="flex items-center gap-1 text-emerald-400/80">
                      <DollarSign size={11} />${totalClientRevenue.toLocaleString()} pipeline
                    </span>
                  )}
                </div>
              )}
              <Link href={`/projects/new?clientId=${id}`} className="btn-primary btn-sm">
                <Plus size={13} /> New Project
              </Link>
            </div>
          </div>

          {clientProjects.length === 0 ? (
            <div className="p-10 text-center">
              <FolderOpen size={32} className="text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400 font-medium text-sm">No projects yet</p>
              <p className="text-slate-500 text-xs mt-1 mb-4">Create a project to start designing a solar system for {client.name}</p>
              <Link href={`/projects/new?clientId=${id}`} className="btn-primary btn-sm inline-flex">
                <Plus size={14} /> Create First Project
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-slate-700/30">
              {clientProjects.map(project => {
                const daysSince = Math.floor((Date.now() - new Date(project.updatedAt || project.createdAt).getTime()) / 86400000);
                const isStale = daysSince > 7 && project.status !== 'installed';
                return (
                  <div key={project.id} className="flex items-center gap-3 px-5 py-3.5 group hover:bg-slate-700/20 transition-colors">
                    {/* Type icon */}
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-base flex-shrink-0 ${TYPE_BG[project.systemType] || 'bg-slate-700/40'}`}>
                      {TYPE_ICONS[project.systemType] || '📁'}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link href={`/projects/${project.id}`} className="font-semibold text-white text-sm hover:text-amber-300 transition-colors truncate">
                          {project.name}
                        </Link>
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium border flex items-center gap-1 ${STATUS_BADGE[project.status] || ''}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[project.status] || 'bg-slate-400'}`} />
                          {STATUS_LABEL[project.status] || project.status}
                        </span>
                        {isStale && (
                          <span className="flex items-center gap-1 text-xs text-amber-400/70 bg-amber-500/5 border border-amber-500/15 px-1.5 py-0.5 rounded">
                            <Clock size={9} /> {daysSince}d ago
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-slate-500 flex-wrap">
                        <span className="flex items-center gap-1">
                          <Calendar size={10} />
                          {new Date(project.createdAt).toLocaleDateString()}
                        </span>
                        {project.layout?.systemSizeKw && (
                          <span className="flex items-center gap-1 text-amber-400/70">
                            <Zap size={10} />{project.layout.systemSizeKw.toFixed(1)} kW
                          </span>
                        )}
                        {project.production?.annualProductionKwh && (
                          <span>{project.production.annualProductionKwh.toLocaleString()} kWh/yr</span>
                        )}
                        {project.costEstimate?.netCost && (
                          <span className="text-emerald-400/70">${project.costEstimate.netCost.toLocaleString()}</span>
                        )}
                      </div>
                    </div>

                    {/* Quick actions */}
                    <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Link href={`/design?projectId=${project.id}`} className="btn-ghost p-1.5 rounded-lg" title="Design Studio">
                        <Map size={13} />
                      </Link>
                      <Link href={`/projects/${project.id}`} className="btn-ghost p-1.5 rounded-lg" title="Create Proposal (Proposal tab)">
                        <FileText size={13} />
                      </Link>
                      <Link href={`/projects/${project.id}`} className="btn-ghost p-1.5 rounded-lg">
                        <ChevronRight size={14} />
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {clientProjects.length > 0 && (
            <div className="px-5 py-2.5 border-t border-slate-700/50 bg-slate-800/20">
              <Link href={`/projects?clientId=${id}`} className="text-xs text-amber-400 hover:text-amber-300 transition-colors flex items-center gap-1 w-fit">
                View all projects <ChevronRight size={11} />
              </Link>
            </div>
          )}
        </div>

        {/* Site Surveys */}
        <SiteSurveysSection clientId={id} />

        {/* Proposals */}
        <ProposalsSection clientId={id} />

        {/* Notes */}
        <NotesSection clientId={id} />

        {/* Monthly Usage Chart */}
        <div className="card p-5">
          <h3 className="font-semibold text-white mb-4">Monthly Energy Usage & Cost</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="kwh" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="bill" orientation="right" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
              <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', fontSize: '12px' }} />
              <Bar yAxisId="kwh" dataKey="kwh" fill="#f59e0b" radius={[4, 4, 0, 0]} name="kWh" opacity={0.8} />
              <Bar yAxisId="bill" dataKey="bill" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Bill ($)" opacity={0.6} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </AppShell>
  );
}