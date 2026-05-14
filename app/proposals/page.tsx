'use client';
import React, { useEffect, useState, Suspense, useRef } from 'react';
import AppShell from '@/components/ui/AppShell';
import { useSearchParams } from 'next/navigation';
import type { Project, Proposal, ProposalStatus } from '@/types';
import {
  FileText, Plus, Download, Share2, Eye, FolderOpen,
  CheckCircle, Clock, XCircle, ArrowLeft, Printer,
  Sun, Zap, DollarSign, Leaf, TrendingUp, Shield,
  Star, Phone, Mail, MapPin, Calendar, Award,
  ChevronRight, BarChart2, Home, Sprout, Fence, Users,
  Settings, Percent, Tag, Lock, Search, Filter, Trash2,
  Archive, Copy, Pencil, MoreHorizontal, CheckSquare,
  Square, ChevronDown, SortAsc, AlertTriangle, X, Check
} from 'lucide-react';
import Link from 'next/link';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { resolveEquipment, getSystemTypeLabel } from '@/lib/systemEquipmentResolver';
import { calculateIncentives } from '@/lib/incentives/stateIncentives';
import { buildArraysFromLayout, buildSystemConfig, getArrayProposalText } from '@/lib/multiArrayEngine';
import { useSubscription } from '@/hooks/useSubscription';
import UpgradeModal from '@/components/ui/UpgradeModal';
import { resolveProposalSystemType, getPanelTypeCounts } from '@/lib/proposalSystemType';
import { buildCanonicalProposal } from '@/lib/proposal/buildCanonicalProposal';
import { UtilityRateGraph } from '@/components/proposal/UtilityRateGraph';
import { UtilityCostProjectionChart } from '@/components/proposal/UtilityCostProjectionChart';


const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// States with active SREC/TREC/performance-payment markets in our incentive DB.
// Only include states where calculateIncentives() actually returns an srec/trec entry.
// Removed: NY (uses VDER tariff, no classic SREC), NC (no SREC), MI (no SREC),
//          MO (no SREC), VA (developing — not in DB), IN (no SREC).
// Sources: DSIRE 2024, SEIA state policy map, our stateIncentives.ts DB.
const SREC_STATES = new Set([
  'DC', 'MA', 'MD', 'NJ', 'PA', 'OH', 'IL', 'DE', 'CT', 'RI',
]);
const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ── Status config ────────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<ProposalStatus, { label: string; color: string; dot: string; badge: string }> = {
  draft:    { label: 'Draft',    color: 'text-slate-400',   dot: 'bg-slate-500',   badge: 'bg-slate-700/60 text-slate-300 border border-slate-600/40' },
  sent:     { label: 'Sent',     color: 'text-blue-400',    dot: 'bg-blue-500',    badge: 'bg-blue-900/60 text-blue-300 border border-blue-700/40' },
  viewed:   { label: 'Viewed',   color: 'text-purple-400',  dot: 'bg-purple-500',  badge: 'bg-purple-900/60 text-purple-300 border border-purple-700/40' },
  signed:   { label: 'Signed',   color: 'text-emerald-400', dot: 'bg-emerald-500', badge: 'bg-emerald-900/60 text-emerald-300 border border-emerald-700/40' },
  accepted: { label: 'Accepted', color: 'text-green-400',   dot: 'bg-green-500',   badge: 'bg-green-900/60 text-green-300 border border-green-700/40' },
  rejected: { label: 'Rejected', color: 'text-red-400',     dot: 'bg-red-500',     badge: 'bg-red-900/60 text-red-300 border border-red-700/40' },
  archived: { label: 'Archived', color: 'text-slate-500',   dot: 'bg-slate-600',   badge: 'bg-slate-800/80 text-slate-500 border border-slate-700/40' },
};

function StatusBadge({ status }: { status: ProposalStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.draft;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${cfg.badge}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

// ── Confirm Delete Modal ─────────────────────────────────────────────────────
function ConfirmDeleteModal({
  count, onConfirm, onCancel, loading,
}: { count: number; onConfirm: () => void; onCancel: () => void; loading: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-red-500/15 border border-red-500/30 flex items-center justify-center flex-shrink-0">
            <AlertTriangle size={18} className="text-red-400" />
          </div>
          <div>
            <div className="font-black text-white text-base">Delete {count > 1 ? `${count} Proposals` : 'Proposal'}?</div>
            <div className="text-slate-400 text-xs mt-0.5">This action cannot be undone.</div>
          </div>
        </div>
        <p className="text-sm text-slate-400 mb-5 leading-relaxed">
          {count > 1
            ? `You are about to permanently delete ${count} proposals. All data will be lost.`
            : 'This proposal will be permanently deleted. You cannot recover it.'}
        </p>
        <div className="flex gap-3">
          <button onClick={onCancel} disabled={loading} className="flex-1 btn-secondary py-2.5 text-sm">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={loading} className="flex-1 bg-red-600 hover:bg-red-500 text-white font-bold py-2.5 px-4 rounded-xl text-sm transition-colors flex items-center justify-center gap-2">
            {loading ? <><span className="spinner w-4 h-4" /> Deleting...</> : <><Trash2 size={14} /> Delete</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Inline Rename Input ──────────────────────────────────────────────────────
function RenameInput({ current, onSave, onCancel }: { current: string; onSave: (v: string) => void; onCancel: () => void }) {
  const [val, setVal] = useState(current);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return (
    <form onSubmit={e => { e.preventDefault(); if (val.trim()) onSave(val.trim()); }} className="flex items-center gap-2 flex-1">
      <input
        ref={ref}
        value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => e.key === 'Escape' && onCancel()}
        className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
      />
      <button type="submit" className="p-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"><Check size={13} /></button>
      <button type="button" onClick={onCancel} className="p-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"><X size={13} /></button>
    </form>
  );
}

// ── Row Action Menu ──────────────────────────────────────────────────────────
function ActionMenu({
  proposal, onRename, onDuplicate, onArchive, onDelete, onClose,
}: {
  proposal: Proposal;
  onRename: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div ref={ref} className="absolute right-0 top-8 z-30 w-48 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl overflow-hidden">
      <button onClick={() => { onRename(); onClose(); }} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-slate-300 hover:bg-slate-700 transition-colors text-left">
        <Pencil size={13} className="text-slate-400" /> Rename
      </button>
      <button onClick={() => { onDuplicate(); onClose(); }} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-slate-300 hover:bg-slate-700 transition-colors text-left">
        <Copy size={13} className="text-slate-400" /> Duplicate
      </button>
      <div className="h-px bg-slate-700 my-0.5" />
      {proposal.status !== 'archived' && (
        <button onClick={() => { onArchive(); onClose(); }} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-slate-300 hover:bg-slate-700 transition-colors text-left">
          <Archive size={13} className="text-slate-400" /> Archive
        </button>
      )}
      <button onClick={() => { onDelete(); onClose(); }} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors text-left">
        <Trash2 size={13} /> Delete
      </button>
    </div>
  );
}

// ── Status Change Dropdown ────────────────────────────────────────────────────
function StatusDropdown({ onSelect, onClose }: { onSelect: (s: ProposalStatus) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);
  const statuses: ProposalStatus[] = ['draft', 'sent', 'viewed', 'signed', 'accepted', 'rejected', 'archived'];
  return (
    <div ref={ref} className="absolute left-0 top-8 z-30 w-44 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl overflow-hidden">
      {statuses.map(s => {
        const cfg = STATUS_CONFIG[s];
        return (
          <button key={s} onClick={() => { onSelect(s); onClose(); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 transition-colors text-left">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
            {cfg.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Main ProposalContent ─────────────────────────────────────────────────────
function ProposalContent() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get('projectId');
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [activeProposal, setActiveProposal] = useState<Proposal | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'preview'>('list');
  // v47.245: fetch live project whenever activeProposal changes, so noItc is always current
  // (projectId param is only set when navigating from project page, not from Proposals sidebar)
  React.useEffect(() => {
    if (activeProposal?.projectId && !projectId) {
      fetch(`/api/projects/${activeProposal.projectId}`)
        .then(r => r.json())
        .then(d => { if (d.data) setProject(d.data); })
        .catch(() => {});
    }
  }, [activeProposal?.projectId, projectId]);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  // Plan gating — Starter = preview only (no generate, no download, no e-sign)
  const { can, loading: subLoading, isFreePass, role } = useSubscription();
  const isAdmin = role === 'admin' || role === 'super_admin'; // v47.258: role gate for admin-only tools
  const canGenerate = subLoading ? true : can('proposalEsigning');
  const isPreviewOnly = !canGenerate;

  // ── Shared branding + pricing ─────────────────────────────────────────────
  // Fetched ONCE in ProposalContent and passed as props to ProposalPreview.
  // This prevents redundant API calls every time the user opens a preview.
  const [sharedPricingCfg, setSharedPricingCfg] = React.useState<any>(null);
  const [sharedBranding, setSharedBranding] = React.useState<{
    companyName: string;
    companyLogoUrl: string | null;
    companyWebsite: string | null;
    companyAddress: string | null;
    companyPhone: string | null;
    brandPrimaryColor: string;
    proposalFooterText: string | null;
  }>({
    companyName: 'SolarPro',
    companyLogoUrl: null,
    companyWebsite: null,
    companyAddress: null,
    companyPhone: null,
    brandPrimaryColor: '#f59e0b',
    proposalFooterText: null,
  });

  React.useEffect(() => {
    fetch('/api/pricing')
      .then(r => r.json())
      .then(d => { if (d.success) setSharedPricingCfg(d.data); })
      .catch(() => {});
    fetch('/api/settings/branding')
      .then(r => r.json())
      .then(d => {
        if (d.success && d.data) {
          setSharedBranding({
            companyName: d.data.companyName || 'SolarPro',
            companyLogoUrl: d.data.companyLogoUrl || null,
            companyWebsite: d.data.companyWebsite || null,
            companyAddress: d.data.companyAddress || null,
            companyPhone: d.data.companyPhone || null,
            brandPrimaryColor: d.data.brandPrimaryColor || '#f59e0b',
            proposalFooterText: d.data.proposalFooterText || null,
          });
        }
      })
      .catch(() => {});
  }, []);


  // ── Command center state ──────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [showArchived, setShowArchived] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'value' | 'viewed'>('newest');
  const [confirmDelete, setConfirmDelete] = useState<{ ids: string[] } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [clearTestLoading, setClearTestLoading] = useState(false);
  const [adminClickCount, setAdminClickCount] = useState(0);
  const showAdminTools = isAdmin && adminClickCount >= 3; // v47.258: only admins can unlock clear test data

  useEffect(() => {
    const load = async () => {
      if (projectId) {
        const [projRes, propRes] = await Promise.all([
          fetch(`/api/projects/${projectId}`).then(r => r.json()),
          fetch(`/api/proposals?projectId=${projectId}`).then(r => r.json()),
        ]);
        setProject(projRes.data);
        setProposals(propRes.data || []);
      } else {
        const res = await fetch('/api/proposals');
        const data = await res.json();
        setProposals(data.data || []);
      }
      setLoading(false);
    };
    load();
  }, [projectId]);

  const generateProposal = async () => {
    if (!projectId) return;
    setGenerating(true);
    try {
      const res = await fetch('/api/proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, preparedBy: sharedBranding?.companyName || 'SolarPro Design Team' }),
      });
      const data = await res.json();
      if (data.success) {
        setProposals(prev => [data.data, ...prev]);
        setActiveProposal(data.data);
        setViewMode('preview');
      }
    } finally {
      setGenerating(false);
    }
  };

  const handleDownloadPDF = async (proposal: Proposal) => {
    const { generateProposalPDF } = await import('@/lib/proposalPDF');
    await generateProposalPDF(proposal);
  };

  // ── API helpers ───────────────────────────────────────────────────────────
  const updateStatus = async (id: string, status: ProposalStatus) => {
    await fetch(`/api/proposals/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    setProposals(prev => prev.map(p => p.id === id ? { ...p, status } : p));
  };

  const renameProposal = async (id: string, title: string) => {
    await fetch(`/api/proposals/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    setProposals(prev => prev.map(p => p.id === id ? { ...p, title } : p));
    setRenameId(null);
  };

  const duplicateProposal = async (proposal: Proposal) => {
    if (!proposal.projectId) return;
    const res = await fetch('/api/proposals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: proposal.projectId, preparedBy: proposal.preparedBy || sharedBranding?.companyName || 'SolarPro Design Team' }),
    });
    const data = await res.json();
    if (data.success) setProposals(prev => [data.data, ...prev]);
  };

  const archiveProposal = async (id: string) => {
    await updateStatus(id, 'archived');
  };

  const deleteProposals = async (ids: string[]) => {
    setDeleteLoading(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      let ok = false;
      if (ids.length === 1) {
        const res = await fetch(`/api/proposals/${ids[0]}`, {
          method: 'DELETE',
          signal: controller.signal,
        });
        ok = res.ok;
      } else {
        const chunks: string[][] = [];
        for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));
        let allOk = true;
        for (const chunk of chunks) {
          const res = await fetch('/api/proposals/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'delete', ids: chunk }),
            signal: controller.signal,
          });
          if (!res.ok) { allOk = false; break; }
        }
        ok = allOk;
      }
      if (ok) {
        setProposals(prev => prev.filter(p => !ids.includes(p.id)));
        setSelectedIds(new Set());
        setConfirmDelete(null);
      } else {
        setConfirmDelete(null);
        alert('Delete failed. Please try again.');
      }
    } catch (err) {
      setConfirmDelete(null);
      if ((err as Error).name !== 'AbortError') {
        alert('Delete failed. Please check your connection and try again.');
      }
    } finally {
      clearTimeout(timeout);
      setDeleteLoading(false);
    }
  };

  const bulkArchive = async () => {
    const ids = [...selectedIds];
    try {
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));
      for (const chunk of chunks) {
        await fetch('/api/proposals/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'archive', ids: chunk }),
        });
      }
      setProposals(prev => prev.map(p => ids.includes(p.id) ? { ...p, status: 'archived' as ProposalStatus } : p));
      setSelectedIds(new Set());
    } catch {
      alert('Archive failed. Please try again.');
    }
  };

  const bulkSetStatus = async (status: ProposalStatus) => {
    const ids = [...selectedIds];
    try {
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));
      for (const chunk of chunks) {
        await fetch('/api/proposals/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'status', ids: chunk, status }),
        });
      }
      setProposals(prev => prev.map(p => ids.includes(p.id) ? { ...p, status } : p));
      setSelectedIds(new Set());
      setBulkStatusOpen(false);
    } catch {
      alert('Status update failed. Please try again.');
    }
  };

  const clearTestData = async () => {
    if (!window.confirm('Delete all proposals with 0 views? This cannot be undone.')) return;
    setClearTestLoading(true);
    try {
      const res = await fetch('/api/proposals/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear_test' }),
      });
      const data = await res.json();
      if (data.success) {
        setProposals(prev => prev.filter(p => p.viewCount > 0));
        alert(`Cleared ${data.deleted} test proposals.`);
      }
    } finally {
      setClearTestLoading(false);
    }
  };

  // ── Selection helpers ─────────────────────────────────────────────────────
  const toggleSelect = (id: string) => setSelectedIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredProposals.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredProposals.map(p => p.id)));
    }
  };

  // ── Filter + Search + Sort ────────────────────────────────────────────────
  const filteredProposals = proposals
    .filter(p => {
      if (!showArchived && p.status === 'archived') return false;
      if (filterStatus !== 'all' && p.status !== filterStatus) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const clientName = p.project?.client?.name?.toLowerCase() ?? '';
        const projName = p.project?.name?.toLowerCase() ?? '';
        const address = (p.project?.address ?? p.project?.client?.address ?? '').toLowerCase();
        const title = p.title.toLowerCase();
        if (!clientName.includes(q) && !projName.includes(q) && !address.includes(q) && !title.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'newest') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (sortBy === 'oldest') return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      if (sortBy === 'viewed') return b.viewCount - a.viewCount;
      if (sortBy === 'value') {
        const va = a.project?.costEstimate?.cashPrice ?? 0;
        const vb = b.project?.costEstimate?.cashPrice ?? 0;
        return vb - va;
      }
      return 0;
    });

  // ── Status counts for filter pills ───────────────────────────────────────
  const statusCounts = proposals.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="spinner w-8 h-8" />
    </div>
  );

  if (viewMode === 'preview' && activeProposal) {
    // FIX v47.223/224: proposals are immutable snapshots — use frozen project data when available.
    // Only fall back to live project for backward compat (old proposals without snapshot).
    // A snapshot exists when data_json.project was saved at creation time (v47.222+).
    const hasSnapshot = !!(activeProposal.project?.layout || activeProposal.project?.production);
    // v47.243: always merge live project.noItc so toggling ITC takes effect immediately
    // without needing to regenerate the proposal. Other fields use frozen snapshot when available.
    const enrichedProposal = hasSnapshot
      ? {
          ...activeProposal,
          project: activeProposal.project
            ? { ...activeProposal.project, noItc: project?.noItc ?? activeProposal.project.noItc ?? false }
            : activeProposal.project,
        }
      : (project ? { ...activeProposal, project } : activeProposal); // old proposal — use live data
    // FIX v47.224: use frozen pricingSnapshot when available so financials don't change
    // if admin updates pricing config after the proposal was generated.
    const frozenPricing = activeProposal.pricingSnapshot ?? sharedPricingCfg;
    return (
      <ProposalPreview
        proposal={enrichedProposal}
        onBack={() => setViewMode('list')}
        onDownload={() => handleDownloadPDF(activeProposal)}
        isPreviewOnly={isPreviewOnly}
        onUpgrade={() => setUpgradeOpen(true)}
        initialPricingCfg={frozenPricing}
        initialBranding={sharedBranding}
      />
    );
  }

  return (
    <div className="p-6 space-y-4 animate-fade-in">
      {/* Upgrade modal */}
      <UpgradeModal
        isOpen={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        title="Proposal Generation Locked"
        description="Generating and downloading proposals requires Professional plan or above. Starter plan allows preview only."
        requiredPlan="Professional"
      />

      {/* Confirm Delete Modal */}
      {confirmDelete && (
        <ConfirmDeleteModal
          count={confirmDelete.ids.length}
          onConfirm={() => deleteProposals(confirmDelete.ids)}
          onCancel={() => setConfirmDelete(null)}
          loading={deleteLoading}
        />
      )}

      {/* ══════════ PROPOSALS COMMAND HEADER ══════════ */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-700/60 bg-gradient-to-br from-slate-800/80 via-slate-800/60 to-slate-900/80 p-5 shadow-xl">
        <div className="absolute -top-10 -right-10 w-48 h-48 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-amber-500/20 to-transparent" />
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div
            className="cursor-default select-none"
            onClick={() => setAdminClickCount(c => c + 1)}
            title="Proposals"
          >
            <div className="flex items-center gap-2 mb-1">
              <FileText size={13} className="text-amber-400" />
              <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider">Proposal Engine</span>
            </div>
            <h1 className="text-2xl font-black text-white tracking-tight">Proposals</h1>
            <p className="text-sm text-slate-400 mt-0.5">
              {project ? `Project: ${project.name}` : `${proposals.length} total · ${proposals.filter(p => p.status !== 'archived').length} active`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {showAdminTools && (
              <button
                onClick={clearTestData}
                disabled={clearTestLoading}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-bold hover:bg-red-500/20 transition-colors"
                title="Admin: Delete all proposals with 0 views"
              >
                <Trash2 size={12} /> {clearTestLoading ? 'Clearing…' : 'Clear Test Data'}
              </button>
            )}
            {!showArchived ? (
              <button onClick={() => setShowArchived(true)} className="text-xs text-slate-500 hover:text-slate-300 transition-colors px-2 py-1.5">
                Show Archived {statusCounts['archived'] ? `(${statusCounts['archived']})` : ''}
              </button>
            ) : (
              <button onClick={() => setShowArchived(false)} className="text-xs text-slate-400 hover:text-slate-200 transition-colors px-2 py-1.5">
                Hide Archived
              </button>
            )}
            {isPreviewOnly && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-300">
                <Lock size={12} /> Preview Only — <button onClick={() => setUpgradeOpen(true)} className="underline font-semibold hover:text-amber-200">Upgrade to generate</button>
              </div>
            )}
            {projectId && !isPreviewOnly && (
              <button onClick={generateProposal} disabled={generating} className="btn-primary">
                {generating ? <><span className="spinner w-4 h-4" /> Generating…</> : <><Plus size={16} /> Generate Proposal</>}
              </button>
            )}
            {projectId && isPreviewOnly && (
              <button onClick={() => setUpgradeOpen(true)} className="btn-secondary opacity-60 cursor-not-allowed" disabled>
                <Lock size={14} /> Generate Proposal
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Search + Filter Bar ── */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          <input
            type="text"
            placeholder="Search client, project, address…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-slate-800/60 border border-slate-700/60 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500/40"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
              <X size={13} />
            </button>
          )}
        </div>

        {/* Status filter */}
        <div className="relative">
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="appearance-none bg-slate-800/60 border border-slate-700/60 rounded-xl pl-3 pr-8 py-2.5 text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500/40 cursor-pointer"
          >
            <option value="all">All Status</option>
            {(Object.keys(STATUS_CONFIG) as ProposalStatus[]).map(s => (
              <option key={s} value={s}>{STATUS_CONFIG[s].label} {statusCounts[s] ? `(${statusCounts[s]})` : ''}</option>
            ))}
          </select>
          <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
        </div>

        {/* Sort */}
        <div className="relative">
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as typeof sortBy)}
            className="appearance-none bg-slate-800/60 border border-slate-700/60 rounded-xl pl-3 pr-8 py-2.5 text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500/40 cursor-pointer"
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
            <option value="value">Highest Value</option>
            <option value="viewed">Most Viewed</option>
          </select>
          <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
        </div>
      </div>

      {/* ── Bulk Action Toolbar ── */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 bg-amber-500/10 border border-amber-500/30 rounded-xl">
          <span className="text-amber-300 text-sm font-bold flex-shrink-0">{selectedIds.size} selected</span>
          <div className="h-4 w-px bg-amber-500/30" />
          <button
            onClick={() => setConfirmDelete({ ids: [...selectedIds] })}
            className="flex items-center gap-1.5 text-xs font-semibold text-red-400 hover:text-red-300 transition-colors px-2 py-1.5 rounded-lg hover:bg-red-500/10"
          >
            <Trash2 size={12} /> Delete Selected
          </button>
          <button
            onClick={bulkArchive}
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors px-2 py-1.5 rounded-lg hover:bg-slate-700"
          >
            <Archive size={12} /> Archive Selected
          </button>
          <div className="relative">
            <button
              onClick={() => setBulkStatusOpen(v => !v)}
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors px-2 py-1.5 rounded-lg hover:bg-slate-700"
            >
              <CheckSquare size={12} /> Change Status <ChevronDown size={11} />
            </button>
            {bulkStatusOpen && (
              <StatusDropdown
                onSelect={bulkSetStatus}
                onClose={() => setBulkStatusOpen(false)}
              />
            )}
          </div>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="ml-auto text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── Proposal List ── */}
      {filteredProposals.length === 0 ? (
        <div className="card p-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mx-auto mb-4">
            <FileText size={28} className="text-blue-400" />
          </div>
          {proposals.length === 0 ? (
            <>
              <p className="text-white font-semibold text-lg mb-1">No proposals yet</p>
              {projectId ? (
                <>
                  <p className="text-slate-400 text-sm mb-6">Generate a professional proposal for this project</p>
                  {isPreviewOnly ? (
                    <button onClick={() => setUpgradeOpen(true)} className="btn-secondary inline-flex gap-2 opacity-70">
                      <Lock size={14} /> Upgrade to Generate Proposals
                    </button>
                  ) : (
                    <button onClick={generateProposal} className="btn-primary inline-flex">
                      <Plus size={16} /> Generate First Proposal
                    </button>
                  )}
                </>
              ) : (
                <>
                  <p className="text-slate-500 text-sm mt-1">Open a project to generate proposals</p>
                  <Link href="/projects" className="btn-secondary mt-4 inline-flex items-center gap-2 text-sm">
                    <FolderOpen size={14} /> Browse Projects
                  </Link>
                </>
              )}
            </>
          ) : (
            <>
              <p className="text-white font-semibold text-lg mb-1">No proposals match your filters</p>
              <p className="text-slate-400 text-sm mb-4">Try adjusting your search or filter criteria</p>
              <button onClick={() => { setSearchQuery(''); setFilterStatus('all'); }} className="btn-secondary inline-flex gap-2">
                <X size={14} /> Clear Filters
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="card overflow-hidden">
          {/* Table header */}
          <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-700/50 bg-slate-800/40">
            <button
              onClick={toggleSelectAll}
              className="text-slate-500 hover:text-slate-300 transition-colors flex-shrink-0"
              title={selectedIds.size === filteredProposals.length ? 'Deselect all' : 'Select all'}
            >
              {selectedIds.size === filteredProposals.length && filteredProposals.length > 0
                ? <CheckSquare size={15} className="text-amber-400" />
                : <Square size={15} />}
            </button>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex-1">Proposal</span>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide w-24 text-center hidden md:block">Status</span>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide w-16 text-center hidden lg:block">Views</span>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide w-28 text-right hidden md:block">Actions</span>
          </div>

          {/* Rows */}
          <div className="divide-y divide-slate-700/30">
            {filteredProposals.map(proposal => {
              const isSelected = selectedIds.has(proposal.id);
              const isRenaming = renameId === proposal.id;
              const menuOpen = actionMenuId === proposal.id;
              const client = proposal.project?.client;
              const cost = proposal.project?.costEstimate as any;
              const systemValue = cost?.cashPrice ?? cost?.grossCost ?? 0;
              const clientName = client?.name ?? proposal.project?.name ?? '—';
              const address = proposal.project?.address
                ? `${proposal.project.address}${proposal.project.city ? `, ${proposal.project.city}` : ''}${proposal.project.stateCode ? `, ${proposal.project.stateCode}` : ''}`
                : client?.address ? `${client.address}, ${client.city}` : null;

              return (
                <div
                  key={proposal.id}
                  className={`group flex items-center gap-3 px-5 py-4 transition-all hover:bg-slate-800/50 ${isSelected ? 'bg-amber-500/5' : ''}`}
                >
                  {/* Checkbox */}
                  <button
                    onClick={() => toggleSelect(proposal.id)}
                    className="text-slate-600 hover:text-amber-400 transition-colors flex-shrink-0"
                  >
                    {isSelected
                      ? <CheckSquare size={15} className="text-amber-400" />
                      : <Square size={15} className="group-hover:text-slate-400 transition-colors" />}
                  </button>

                  {/* Icon */}
                  <div className={`w-10 h-10 rounded-xl border flex items-center justify-center flex-shrink-0 transition-colors ${
                    proposal.status === 'signed' || proposal.status === 'accepted' ? 'bg-emerald-500/10 border-emerald-500/20' :
                    proposal.status === 'sent' ? 'bg-blue-500/10 border-blue-500/20' :
                    proposal.status === 'viewed' ? 'bg-purple-500/10 border-purple-500/20' :
                    proposal.status === 'rejected' ? 'bg-red-500/10 border-red-500/20' :
                    proposal.status === 'archived' ? 'bg-slate-700/40 border-slate-700/60' :
                    'bg-slate-700/40 border-slate-700/60'
                  }`}>
                    <FileText size={16} className={
                      proposal.status === 'signed' || proposal.status === 'accepted' ? 'text-emerald-400' :
                      proposal.status === 'sent' ? 'text-blue-400' :
                      proposal.status === 'viewed' ? 'text-purple-400' :
                      proposal.status === 'rejected' ? 'text-red-400' :
                      'text-slate-400'
                    } />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    {isRenaming ? (
                      <RenameInput
                        current={proposal.title}
                        onSave={(v) => renameProposal(proposal.id, v)}
                        onCancel={() => setRenameId(null)}
                      />
                    ) : (
                      <>
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-bold text-white text-sm truncate">{clientName}</span>
                          {systemValue > 0 && (
                            <span className="text-xs text-slate-500 flex-shrink-0">${systemValue.toLocaleString()}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {address && <span className="text-xs text-slate-500 truncate max-w-[200px]">{address}</span>}
                          {address && <span className="text-slate-700">·</span>}
                          <span className="text-xs text-slate-600 flex items-center gap-1 flex-shrink-0">
                            <Calendar size={9} />
                            {new Date(proposal.preparedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </span>
                          <span className="text-slate-700">·</span>
                          <span className="text-xs text-slate-600 truncate flex-shrink-0">#{proposal.id?.substring(0, 8).toUpperCase()}</span>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Status badge */}
                  <div className="w-24 flex justify-center flex-shrink-0 hidden md:flex">
                    <div className="relative">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setStatusDropdownOpen(prev => prev && actionMenuId === proposal.id ? false : true);
                          setActionMenuId(proposal.id);
                        }}
                        className="hover:opacity-80 transition-opacity"
                        title="Click to change status"
                      >
                        <StatusBadge status={proposal.status} />
                      </button>
                    </div>
                  </div>

                  {/* View count */}
                  <div className="w-16 flex-shrink-0 hidden lg:flex items-center justify-center">
                    <span className="flex items-center gap-1 text-xs text-slate-500">
                      <Eye size={11} /> {proposal.viewCount}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => { setActiveProposal(proposal); setViewMode('preview'); }}
                      className="btn-primary btn-sm"
                    >
                      <Eye size={12} /> Preview
                    </button>
                    {isPreviewOnly ? (
                      <button onClick={() => setUpgradeOpen(true)} className="btn-secondary btn-sm opacity-50" title="Upgrade to download PDF">
                        <Lock size={12} />
                      </button>
                    ) : (
                      <button onClick={() => handleDownloadPDF(proposal)} className="btn-secondary btn-sm" title="Download PDF">
                        <Download size={12} />
                      </button>
                    )}
                    {/* More menu */}
                    <div className="relative">
                      <button
                        onClick={() => setActionMenuId(prev => prev === proposal.id ? null : proposal.id)}
                        className="btn-ghost p-1.5 rounded-lg text-slate-500 hover:text-slate-300"
                      >
                        <MoreHorizontal size={15} />
                      </button>
                      {menuOpen && (
                        <ActionMenu
                          proposal={proposal}
                          onRename={() => setRenameId(proposal.id)}
                          onDuplicate={() => duplicateProposal(proposal)}
                          onArchive={() => archiveProposal(proposal.id)}
                          onDelete={() => setConfirmDelete({ ids: [proposal.id] })}
                          onClose={() => setActionMenuId(null)}
                        />
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div className="px-5 py-3 border-t border-slate-700/50 bg-slate-800/20 flex items-center justify-between">
            <span className="text-xs text-slate-500">
              {filteredProposals.length} proposal{filteredProposals.length !== 1 ? 's' : ''}{searchQuery || filterStatus !== 'all' ? ' matching filters' : ''}
            </span>
            {selectedIds.size > 0 && (
              <span className="text-xs text-amber-400 font-semibold">{selectedIds.size} selected</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Beautiful Proposal Preview ──────────────────────────────────────────────
function ProposalPreview({ proposal, onBack, onDownload, isPreviewOnly = false, onUpgrade, initialPricingCfg, initialBranding }: {
  proposal: Proposal; onBack: () => void; onDownload: () => void;
  isPreviewOnly?: boolean; onUpgrade?: () => void;
  initialPricingCfg?: any;
  initialBranding?: {
    companyName: string; companyLogoUrl: string | null; companyWebsite: string | null;
    companyAddress: string | null; companyPhone: string | null;
    brandPrimaryColor: string; proposalFooterText: string | null;
  };
}) {
  const proj = proposal.project;
  const client = proj?.client;
  const production = proj?.production;
  const cost = proj?.costEstimate as any;
  const layout = proj?.layout;

  // Pricing config from DB (fetched on mount)
  // ── Use pre-loaded branding/pricing from parent (no redundant fetches) ────────
  // Falls back to local fetch only if props were not provided (e.g. standalone use).
  const [pricingCfg, setPricingCfg] = useState<any>(initialPricingCfg ?? null);
  const defaultBranding = {
    companyName: 'SolarPro', companyLogoUrl: null, companyWebsite: null,
    companyAddress: null, companyPhone: null, brandPrimaryColor: '#f59e0b',
    proposalFooterText: null,
  };
  const [branding, setBranding] = useState(initialBranding ?? defaultBranding);

  // Sync if parent loads data after mount (race condition safety)
  useEffect(() => { if (initialPricingCfg) setPricingCfg(initialPricingCfg); }, [initialPricingCfg]);
  useEffect(() => { if (initialBranding)   setBranding(initialBranding);     }, [initialBranding]);

  // Fallback: fetch locally if parent never provided values
  useEffect(() => {
    if (!initialPricingCfg) {
      fetch('/api/pricing').then(r => r.json()).then(d => { if (d.success) setPricingCfg(d.data); }).catch(() => {});
    }
    if (!initialBranding) {
      fetch('/api/settings/branding').then(r => r.json()).then(d => {
        if (d.success && d.data) setBranding({
          companyName:        d.data.companyName        || 'SolarPro',
          companyLogoUrl:     d.data.companyLogoUrl     || null,
          companyWebsite:     d.data.companyWebsite     || null,
          companyAddress:     d.data.companyAddress     || null,
          companyPhone:       d.data.companyPhone       || null,
          brandPrimaryColor:  d.data.brandPrimaryColor  || '#f59e0b',
          proposalFooterText: d.data.proposalFooterText || null,
        });
      }).catch(() => {});
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Shareable link state
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);

  // v47.245: ITC toggle — lives in the toolbar so it works from any navigation path
  const [noItc, setNoItc] = useState<boolean>((proposal.project as any)?.noItc ?? false);
  // Sync if proposal prop changes (e.g. parent re-fetches live project)
  useEffect(() => { setNoItc((proposal.project as any)?.noItc ?? false); }, [proposal.project]);
  const handleToggleNoItc = async (val: boolean) => {
    setNoItc(val);
    if (proposal.projectId) {
      try {
        await fetch(`/api/projects/${proposal.projectId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ noItc: val }),
        });
      } catch {}
    }
  };

  const handleShare = async () => {
    setShareLoading(true);
    try {
      // Generate a shareable token via API
      const res = await fetch(`/api/proposals/${proposal.id}/share`, { method: 'POST' });
      const data = await res.json();
      if (data.success && data.shareUrl) {
        setShareLink(data.shareUrl);
        await navigator.clipboard.writeText(data.shareUrl);
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 3000);
      } else {
        // Fallback: copy current URL (include shareToken if available)
        const token = proposal.shareToken ? `?token=${proposal.shareToken}` : '';
        const url = `${window.location.origin}/proposals/view/${proposal.id}${token}`;
        setShareLink(url);
        await navigator.clipboard.writeText(url);
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 3000);
      }
    } catch {
      const token = proposal.shareToken ? `?token=${proposal.shareToken}` : '';
      const url = `${window.location.origin}/proposals/view/${proposal.id}${token}`;
      setShareLink(url);
    } finally {
      setShareLoading(false);
    }
  };

  // Sales override state
  const [showOverrides, setShowOverrides] = useState(false);
  const [overridePpw, setOverridePpw]         = useState<string>('');
  const [overrideMargin, setOverrideMargin]   = useState<string>('');
  const [overrideFinal, setOverrideFinal]     = useState<string>('');

  // Compute effective pricing — priority: sales override > stored costEstimate > live calc
  // Fall back to project.systemSizeKw if layout not yet placed (preliminary mode)
  // _layoutSystemSizeKwHint: passed to pipeline as hint only — NOT used for display.
  // After pipeline runs, systemSizeKw is overridden with cp.panel.systemSizeKw (canonical).
  const _layoutSystemSizeKwHint = (layout?.systemSizeKw && layout.systemSizeKw > 0)
    ? layout.systemSizeKw
    : ((proj as any)?.systemSizeKw ?? 0);
  const storedCashPrice = cost?.cashPrice ?? cost?.grossCost ?? 0;
  // FIX v47.219: System type resolution — layout > project > name-keyword override > fallback
  // ── System type resolution (v47.220) ─────────────────────────────────────
  // Priority: panel data → layout.systemType → proj.systemType → name scan → 'roof'
  // Safe, additive, display-layer only. Falls back gracefully at every level.
  const systemType: string = resolveProposalSystemType({
    panels:           layout?.panels,
    layoutSystemType: layout?.systemType,
    projSystemType:   proj?.systemType,
    projectName:      proj?.name,
  });
  // Debug log — panel counts + resolution chain visible in browser console
  if (typeof window !== 'undefined') {
    const _panelCounts = getPanelTypeCounts(layout?.panels || []);
    console.log('[PROPOSAL systemType v47.220]', {
      proposalId:      proposal.id,
      projectName:     proj?.name,
      panelCounts:     _panelCounts,
      typedPanels:     (layout?.panels || []).filter((p: import('@/types').PlacedPanel) => p.placementType || p.systemType).length,
      totalPanels:     (layout?.panels || []).length,
      layoutSysType:   layout?.systemType,
      projSysType:     proj?.systemType,
      resolved:        systemType,
    });
  }

  // Live price-per-watt from admin pricing config
  const livePpw = pricingCfg
    ? (({
        roof:    pricingCfg.roofPricePerWatt    ?? pricingCfg.pricePerWatt ?? 3.10,
        ground:  pricingCfg.groundPricePerWatt  ?? pricingCfg.pricePerWatt ?? 2.35,
        fence:   pricingCfg.fencePricePerWatt   ?? pricingCfg.pricePerWatt ?? 4.25,
        carport: pricingCfg.carportPricePerWatt ?? pricingCfg.pricePerWatt ?? 3.75,
      } as Record<string, number>)[systemType] ?? pricingCfg.pricePerWatt ?? 3.10)
    : 3.10;

  const liveCalculatedPrice = _layoutSystemSizeKwHint > 0 ? Math.round(_layoutSystemSizeKwHint * 1000 * livePpw) : 0;
  const baseCashPrice = storedCashPrice > 0 ? storedCashPrice : liveCalculatedPrice;

  const effectiveFinal = overrideFinal ? parseFloat(overrideFinal) : baseCashPrice;

  // ITC rate — current law: Inflation Reduction Act (IRA, P.L. 117-169).
  // Residential §25D: 30% through 2032, 26% in 2033, 22% in 2034, 0% after.
  // Commercial §48E: 30% (configurable via admin pricing config).
  // Admin can override via pricingCfg.itcRateResidential / itcRateCommercial.
  // NOTE: P.L. 119-21 referenced in old comments is a hypothetical future bill
  // that has NOT been enacted. Do not treat it as current law.
  const isCommercial = pricingCfg?.isCommercial ?? false;
  // Pre-pipeline ITC estimate (used only for bootstrap payback below; canonical values come from cp.financial)
  const _preItcRate   = isCommercial
    ? (pricingCfg?.itcRateCommercial ?? 30)
    : (pricingCfg?.itcRateResidential ?? 30); // IRA §25D — 30% current law
  const _preItcAmount = Math.round(effectiveFinal * _preItcRate / 100);
  const _preEffectiveNet = effectiveFinal - _preItcAmount;

  const effectivePpw = overridePpw
    ? parseFloat(overridePpw)
    : (_layoutSystemSizeKwHint > 0 ? parseFloat((effectiveFinal / (_layoutSystemSizeKwHint * 1000)).toFixed(2)) : (cost?.pricePerWatt ?? livePpw));

  // Savings — use stored values or estimate
  // FIX v47.12 Issue 4: use effectiveUtilityRate (set below after utilityRate computed) — reference same priority chain
  const annualSavings   = cost?.annualSavings   ?? Math.round((production?.annualProductionKwh ?? 0) * (((proj as any)?.utilityRatePerKwh && (proj as any).utilityRatePerKwh > 0.10) ? (proj as any).utilityRatePerKwh : (client?.utilityRate ?? 0.13)));
  const paybackYears    = cost?.paybackYears    ?? (annualSavings > 0 ? parseFloat((_preEffectiveNet / annualSavings).toFixed(1)) : 0);
  const lifetimeSavings = cost?.lifetimeSavings ?? 0;

  // State incentives — computed from project stateCode
  // Priority: proj.stateCode > client.state > extract from project address
  const projectStateCode = (
    (proj as any)?.stateCode ||
    client?.state ||
    ''
  ).toUpperCase().trim().slice(0, 2);
  // Use annualProductionKwh for SREC calculation — fall back to estimate from system size
  const annualKwhForIncentives = (production?.annualProductionKwh ?? 0) > 0
    ? production!.annualProductionKwh
    : _layoutSystemSizeKwHint > 0 ? Math.round(_layoutSystemSizeKwHint * 1250) : 0;
  const incentiveCalc = projectStateCode && (_layoutSystemSizeKwHint > 0 || annualKwhForIncentives > 0)
    ? calculateIncentives(projectStateCode, effectiveFinal, _layoutSystemSizeKwHint, annualKwhForIncentives, !isCommercial, systemType)
    : null;
  // Normalize to a consistent shape for the UI
  // IMPORTANT: Only CASH incentives (ITC, tax credits, rebates) reduce net cost.
  // Property/sales tax exemptions and SRECs are non-cash benefits shown separately.
  const CASH_INCENTIVE_TYPES = ['federal_itc', 'state_tax_credit', 'state_rebate', 'utility_rebate', 'performance_payment'];
  const NON_CASH_INCENTIVE_TYPES = ['property_tax_exemption', 'sales_tax_exemption', 'srec', 'trec', 'net_metering', 'loan_program'];
  // Recalculate SREC value using annualKwhForIncentives if it was 0 in incentiveCalc
  // (can happen when effectiveFinal=0 but kWh-based income is still valid)
  const stateIncentives = incentiveCalc ? {
    stateIncentives: incentiveCalc.state.map((s: any) => ({
      ...s,
      name: s.incentiveName,
      type: s.type,
      description: s.notes || s.description,
      calculatedValue: s.calculatedValue,
      isCash: CASH_INCENTIVE_TYPES.includes(s.type),
      isNonCash: NON_CASH_INCENTIVE_TYPES.includes(s.type),
      stackable: true,
    })),
    cashStateValue: incentiveCalc.cashTotal - incentiveCalc.federal.calculatedValue,
    totalStateValue: incentiveCalc.state.reduce((sum: number, s: any) => sum + s.calculatedValue, 0),
    federalValue: incentiveCalc.federal.calculatedValue,
    cashTotal: incentiveCalc.cashTotal,
    totalCombinedValue: incentiveCalc.total,
    netSystemCost: incentiveCalc.netSystemCost,
    solarFriendlyRating: 3,
    notes: incentiveCalc.summary,
  } : null;


  // ── Canonical pipeline (v47.239) ─────────────────────────────────────────────────────────────────────────────
  // buildCanonicalProposal() is the ONLY place financial calculations live.
  // All downstream variables are remapped from cp.* — no inline math below this block.
  // Use selectedPanel already embedded in the project object (no server-side db call needed)
  const _selectedPanel = (proj as any)?.selectedPanel ?? null;

  // v47.183 — Honesty vars ─────────────────────────────────────────────
  // purchaseMode: 'finance' | 'cash' — toggled by user
  const [purchaseMode, setPurchaseMode] = React.useState<'finance' | 'cash'>('finance');

  const cp = buildCanonicalProposal({
    panelSpec: _selectedPanel ? {
      manufacturer: _selectedPanel.manufacturer,
      model:        _selectedPanel.model,
      wattage:      _selectedPanel.wattage,
      efficiency:   _selectedPanel.efficiency,
      width:        _selectedPanel.width,
      height:       _selectedPanel.height,
    } : null,
    panelCount:            (layout as any)?.totalPanels ?? 0,
    layoutSystemSizeKw:    _layoutSystemSizeKwHint,  // hint only — pipeline overrides with (count×wattage)/1000
    annualProductionKwh:   production?.annualProductionKwh ?? 0,
    monthlyProductionKwh:  production?.monthlyProductionKwh ?? [],
    utilityName:           (proj as any)?.utilityName ?? (client as any)?.utilityName ?? '',
    stateCode:             (proj as any)?.stateCode ?? client?.state ?? '',
    clientState:           client?.state ?? '',
    // v48.4: Tier 1 — direct bill-extracted rate (primary: enriched, fallback: raw OCR)
    parsedBillRate:        (proj as any)?.billData?._utilityRatePerKwh
                             ?? (proj as any)?.billData?.electricityRate
                             ?? undefined,
    utilityRateOverride:   (proj as any)?.utilityRatePerKwh,
    clientUtilityRate:     client?.utilityRate,
    dbUtilityRate:         proposal.dbUtilityRate ?? undefined,
    annualUsageKwh:        client?.annualKwh ?? 0,
    systemType,
    storedCashPrice:       storedCashPrice,
    roofPricePerWatt:      pricingCfg?.roofPricePerWatt,
    groundPricePerWatt:    pricingCfg?.groundPricePerWatt,
    fencePricePerWatt:     pricingCfg?.fencePricePerWatt,
    carportPricePerWatt:   pricingCfg?.carportPricePerWatt,
    defaultPricePerWatt:   pricingCfg?.pricePerWatt,
    loanApr:               pricingCfg?.loanApr,
    loanTermYears:         pricingCfg?.loanTermYears,
    purchaseMode,
    isCommercial:          pricingCfg?.isCommercial ?? false,
    noItc:                 noItc,   // v47.245: from toolbar toggle state (live, no re-render needed)
  });

  // ─── Rule 1: systemSizeKw LOCKED to canonical (panel.count × panel.wattage / 1000) ───
  // Overrides layout.systemSizeKw which is only a hint passed to the pipeline.
  // All downstream display uses this single canonical value.
  // (Pre-cp systemSizeKw was used only as layoutSystemSizeKw input hint — now replaced.)
  const systemSizeKw = cp.panel.systemSizeKw;  // CANONICAL — (count × wattage) / 1000
  const systemSizeW  = systemSizeKw * 1000;    // derived from canonical only

  // Remap canonical output → local variable names used by JSX
  const utilityRate          = cp.utility.rate;
  const utilityInflation     = cp.utility.escalationRate;
  const panelDegradation     = 0.005; // display constant — actual degradation lives in pipeline
  const monthlyBillData      = cp.truth25yr.monthlyBillChart;
  const projectionData       = cp.truth25yr.projectionChart;
  const totalLifetimeSavings = cp.truth25yr.projectionChart[24]?.cumulative ?? 0;
  // Net 25-yr savings = utility cost avoided minus total system cost (cash basis)
  const netSavings25yr = Math.max(0, Math.round(cp.truth25yr.netDifference));

  // ── Energy offset ────────────────────────────────────────────────────────────────────────
  const annualProduction = production?.annualProductionKwh ?? 0;
  const annualUsage      = client?.annualKwh ?? 0;
  const energyOffset     = annualUsage > 0
    ? Math.min(Math.round((annualProduction / annualUsage) * 100), 100)
    : (production?.offsetPercentage ?? 0);

  // ── Equipment resolver ────────────────────────────────────────────────────────────────────────
  const equipment       = resolveEquipment(systemType);
  const racking         = equipment.racking;

  const systemTypeLabel = getSystemTypeLabel(systemType);
  const systemTypeIcon  = { roof: <Home size={16} />, ground: <Sprout size={16} />, fence: <Fence size={16} />, carport: <Sun size={16} /> }[systemType] ?? <Home size={16} />;

  const maxMonthly = production ? Math.max(...production.monthlyProductionKwh) : 1;

  // ── Financing calculator (amortization, no external API) ────────────────────────────────────────────────
  // ── Canonical financial remaps ───────────────────────────────────────────────
  const financeApr            = cp.financial.financeApr;
  const financeTermYears      = cp.financial.financeTermYears;
  const financeTermMonths     = cp.financial.financeTermMonths;
  const financeMonthlyPayment = cp.financial.solarPaymentMonthly;
  const avgMonthlyBillBefore  = cp.financial.currentMonthlyBill;
  const financeUnderBill      = financeMonthlyPayment > 0 && financeMonthlyPayment <= avgMonthlyBillBefore * 1.10;


  // Energy savings only — from canonical pipeline
  const energySavingsOnly = cp.financial.annualEnergyValue;

  // SREC/IL income separately — pulled from stateIncentives if available
  const srecAnnualIncome = (() => {
    if (!stateIncentives) return 0;
    const srecInc = stateIncentives.stateIncentives.find((s: any) =>
      s.type === 'srec' || s.type === 'trec' || s.type === 'performance_payment'
    );
    if (!srecInc) return 0;
    // 15-year total → annualized
    return Math.round((srecInc.calculatedValue ?? 0) / 15);
  })();

  // ITC from canonical pipeline (overrides inline calc)
  const itcRate   = cp.financial.itcRate;
  const itcAmount = cp.financial.itcAmount;
  const effectiveNet = cp.financial.netCost;

  // Base payback: from canonical pipeline (uses net-of-ITC cost)
  const basePaybackYears = cp.financial.paybackYears;

  // Adjusted payback: with SREC income factored in
  const adjustedPaybackYears = (energySavingsOnly + srecAnnualIncome) > 0
    ? parseFloat((cp.financial.netCost / (energySavingsOnly + srecAnnualIncome)).toFixed(1))
    : basePaybackYears;

  // Break-even year for financing: when cumulative utility avoided >= cumulative loan payments
  const financeBreakEvenYear = (() => {
    if (financeMonthlyPayment <= 0) return null;
    let cumUtility = 0;
    let cumPayment = 0;
    for (let i = 0; i < 25; i++) {
      cumUtility += energySavingsOnly * Math.pow(1 + utilityInflation, i);
      cumPayment += financeMonthlyPayment * 12;
      if (cumUtility >= cumPayment) return i + 1;
    }
    return null;
  })();

  // Is financing payment higher than current utility bill?
  // v47.340: use TOTAL energy cost (solar + remaining utility) vs current bill for truth
  const totalEnergyCostMonthly = cp.financial.totalMonthlyCost;
  const paymentExceedsBill = financeMonthlyPayment > 0 && totalEnergyCostMonthly > avgMonthlyBillBefore;
  // Monthly net impact: positive = saving, negative = paying more
  const monthlyNetImpact = avgMonthlyBillBefore - totalEnergyCostMonthly;
  // ─────────────────────────────────────────────────────────────────────

  // ── Panel count for visual grid ────────────────────────────────────────────────────────────────────────
  // Panel grid: canonical count (cp.panel.count) is authoritative; layout.totalPanels as fallback
  const totalPanelsForGrid = cp.panel.count > 0
    ? cp.panel.count
    : (layout?.totalPanels && layout.totalPanels > 0)
      ? layout.totalPanels
      : systemSizeKw > 0 ? Math.ceil(systemSizeKw / 0.44) : 0;

  // ── Multi-array system config ─────────────────────────────────────────────
  const clientLat = (client as any)?.lat ?? 33.4484;
  const clientLng = (client as any)?.lng ?? -112.074;
  // Use stored arrayBreakdown (from cost) when available; otherwise derive from layout
  const storedArrayBreakdown = (cost as any)?.arrayBreakdown as Array<{
    id: string; type: string; label: string;
    panelCount: number; arraySizeKw: number; annualKwh: number; bifacialGain: number;
  }> | undefined;
  const derivedArrays = layout
    ? buildArraysFromLayout(layout as any, clientLat, clientLng)
    : [];
  const systemConfig = buildSystemConfig(derivedArrays);
  const isHybridSystem = systemConfig.isHybrid;
  const hasMultipleArrayTypes = systemConfig.arrayTypes.length > 1;
  const arrayProposalText = getArrayProposalText(systemConfig);
  // Override systemTypeLabel for hybrid systems
  const multiArraySystemLabel = isHybridSystem ? 'Hybrid System' : systemTypeLabel;

  return (
    <div className="flex flex-col">
      {/* ── Toolbar ── */}
      <div className="flex items-center gap-3 px-6 py-3 bg-slate-900 border-b border-slate-700/50 no-print sticky top-0 z-10">
        <button onClick={onBack} className="btn-ghost p-2 rounded-lg flex items-center gap-2 text-sm">
          <ArrowLeft size={15} /> Back
        </button>
        <div className="w-px h-5 bg-slate-700" />
        <span className="text-sm font-medium text-white truncate">{proposal.title}</span>
        <div className="ml-auto flex gap-2">
          {isPreviewOnly ? (
            <button onClick={onUpgrade} className="btn-secondary btn-sm opacity-60 flex items-center gap-1.5" title="Upgrade to download">
              <Lock size={13} /> Download PDF
            </button>
          ) : (
            <button onClick={onDownload} className="btn-primary btn-sm"><Download size={13} /> Download PDF</button>
          )}
          <button onClick={handleShare} disabled={shareLoading} className="btn-secondary btn-sm flex items-center gap-1.5">
            {shareLoading ? <span className="spinner w-3 h-3" /> : <Share2 size={13} />}
            {shareCopied ? 'Link Copied!' : 'Share'}
          </button>
          {shareLink && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-xs text-emerald-300 max-w-xs">
              <span className="truncate">{shareLink}</span>
            </div>
          )}
          <button onClick={() => window.print()} className="btn-secondary btn-sm hidden md:flex"><Printer size={13} /> Print</button>
          {/* ITC toggle — right in toolbar so it works from any navigation path */}
          <button
            onClick={() => handleToggleNoItc(!noItc)}
            title={noItc ? 'ITC hidden — click to show' : 'ITC shown — click to hide'}
            className={`btn-sm hidden md:flex items-center gap-1.5 font-medium transition-all ${noItc ? 'btn-ghost text-red-400 hover:text-red-300' : 'btn-ghost text-emerald-400 hover:text-emerald-300'}`}
          >
            <span className="text-xs">{noItc ? '⛔ ITC: Off' : '✅ ITC: On'}</span>
          </button>
          <button onClick={() => setShowOverrides((v: boolean) => !v)} className="btn-ghost btn-sm hidden md:flex text-slate-500 hover:text-slate-300" title="Sales Rep Controls">
            <Settings size={13} />
          </button>
        </div>
      </div>

      {/* ── Document ── */}
      <div className="bg-slate-950 p-4 md:p-8">
        <div id="proposal-document" className="max-w-4xl mx-auto bg-white text-slate-900 rounded-2xl overflow-hidden shadow-2xl shadow-black/50">

          {/* ── True Page System styles (v47.330) ── */}
          <style>{`
            /* ============================================
               TRUE PAGE SYSTEM
               PDF pages are built by the compositor.
               CSS page-break rules are REMOVED.
               These styles only affect print preview.
            ============================================ */

            /* v47.340: Exact Page Fit for PDF Export */
            @page {
              size: Letter;
              margin: 0.4in;
            }

            @media print {
              html, body {
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
                color-adjust: exact !important;
                margin: 0;
                padding: 0;
              }
              .no-print { display: none !important; }
              .pdf-page {
                page-break-after: always;
                break-after: page;
              }
            }

            /* Hard page container — exact Letter dimensions */
            .pdf-page {
              width: 816px;         /* 8.5in at 96dpi */
              height: 1056px;       /* 11in at 96dpi */
              padding: 38px;        /* 0.4in margins */
              box-sizing: border-box;
              background: white;
              display: flex;
              flex-direction: column;
              justify-content: flex-start;
              overflow: hidden;
              position: relative;
              page-break-after: always;
              break-after: page;
            }

            .pdf-page .page-content {
              display: flex;
              flex-direction: column;
              gap: 0;
              flex: 1;
              max-height: 980px;    /* USABLE_H */
              overflow: hidden;
            }

            /* No-split protection for charts and critical blocks */
            .no-split,
            [data-keep-together="true"] {
              page-break-inside: avoid !important;
              break-inside: avoid !important;
            }

            /* Force white background on sections inside pages */
            .pdf-page .proposal-sec {
              background: white !important;
              color: #1e293b !important;
              overflow: hidden;
            }

            /* Dark blocks stay dark */
            .pdf-page .bg-slate-900,
            .pdf-page .from-slate-900 {
              /* Allowed — card-level dark backgrounds */
            }

            .proposal-sec {
              position: relative;
            }

            /* v47.340: Density Optimization */
            .proposal-sec h2 {
              font-size: 1.05rem;
            }
            .proposal-sec h3 {
              font-size: 0.88rem;
            }
            .proposal-sec .gap-5 { gap: 10px; }
            .proposal-sec .gap-4 { gap: 8px; }
            .proposal-sec .p-6 { padding: 14px; }
            .proposal-sec .p-5 { padding: 12px; }
            .proposal-sec .rounded-2xl { border-radius: 10px; }

            /* Chart max-height enforcement */
            .recharts-wrapper { max-height: 220px !important; }
            svg.recharts-surface { max-height: 220px !important; }
          `}</style>

          {/* ════════════════════════════════════════
              1. HERO SECTION
          ════════════════════════════════════════ */}
          <div className="relative bg-slate-900 text-white overflow-hidden proposal-sec proposal-sec-hero" data-block-id="hero">
            {/* Background — clean solid */}
            <div className="absolute inset-0">
              <div className="absolute inset-0 opacity-[0.03]"
                style={{
                  backgroundImage: 'linear-gradient(#f59e0b 1px, transparent 1px), linear-gradient(90deg, #f59e0b 1px, transparent 1px)',
                  backgroundSize: '40px 40px'
                }}
              />
            </div>

            <div className="relative z-10 p-4 md:p-5">
              {/* Branding header */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  {branding.companyLogoUrl ? (
                    <img src={branding.companyLogoUrl} alt={branding.companyName} className="h-10 max-w-[160px] object-contain" />
                  ) : (
                    <>
                      <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: branding.brandPrimaryColor }}>
                        <Sun size={24} className="text-slate-900" />
                      </div>
                      <div>
                        <div className="font-black text-xl tracking-tight">{branding.companyName}</div>
                        <div className="text-sm font-medium" style={{ color: branding.brandPrimaryColor }}>Solar Energy Proposal</div>
                      </div>
                    </>
                  )}
                </div>
                <div className="text-right text-sm text-slate-400">
                  <div>#{proposal.id?.substring(0, 8).toUpperCase()}</div>
                  <div>{new Date(proposal.preparedDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
                  {branding.companyPhone && <div className="mt-1">{branding.companyPhone}</div>}
                  {branding.companyWebsite && <div><a href={branding.companyWebsite} style={{ color: branding.brandPrimaryColor }}>{branding.companyWebsite.replace(/^https?:\/\//, '')}</a></div>}
                </div>
              </div>

              {/* Client + headline */}
              <div className="mb-2">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500 text-slate-900 text-xs font-bold mb-2">
                  <Star size={11} /> Custom Solar Proposal — Prepared for You
                </div>
                <div className="text-slate-400 text-base mb-2 font-medium">
                  {client?.name || 'Homeowner'} &nbsp;·&nbsp;
                  {proj?.address
                    ? `${proj.address}${proj.city ? `, ${proj.city}` : ''}${proj.stateCode ? `, ${proj.stateCode}` : ''}${proj.zip ? ` ${proj.zip}` : ''}`
                    : client?.address ? `${client.address}, ${client.city}, ${client.state}` : ''}
                </div>
                <h1 className="text-2xl md:text-3xl font-black mb-1 leading-tight">
                  Turn Your Electric Bill<br />
                  <span style={{ color: branding.brandPrimaryColor }}>Into Ownership</span>
                </h1>
                {energyOffset > 0 && (
                  <p className="text-slate-300 text-base font-light leading-relaxed max-w-2xl">
                    Eliminate up to <span className="font-black text-white text-xl">{energyOffset}%</span> of your electric bill and lock in energy costs for{' '}
                    <span className="font-black text-white">25+ years</span>
                  </p>
                )}
              </div>

              {/* Hero metric cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-1">
                {[
                  {
                    label: 'System Size',
                    value: systemSizeKw > 0 ? `${systemSizeKw.toFixed(1)} kW` : '—',
                    icon: <Zap size={16} />,
                    color: 'border-blue-400 bg-blue-950',
                  },
                  {
                    label: 'Annual Production',
                    value: annualProduction > 0
                      ? `${annualProduction.toLocaleString()} kWh`
                      : systemSizeKw > 0 ? `${Math.round(systemSizeKw * 1250).toLocaleString()} kWh` : '—',
                    icon: <Sun size={16} />,
                    color: 'border-amber-400 bg-amber-950',
                  },
                  {
                    label: 'Energy Offset',
                    value: energyOffset > 0 ? `${energyOffset}%` : '—',
                    icon: <Percent size={16} />,
                    color: 'border-emerald-400 bg-emerald-950',
                  },
                  {
                    label: 'Total Investment',
                    value: effectiveFinal > 0 ? `$${effectiveFinal.toLocaleString()}` : '—',
                    icon: <DollarSign size={16} />,
                    color: 'border-purple-400 bg-purple-950',
                  },
                ].map(item => (
                  <div key={item.label} className={`rounded-lg p-2 border ${item.color} `}>
                    <div className="text-slate-400 mb-0.5">{item.icon}</div>
                    <div className="text-xs text-slate-400 uppercase tracking-wide mb-0.5">{item.label}</div>
                    <div className="font-black text-lg text-white leading-tight">{item.value}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Truth Confidence Indicator */}
          {cp._meta.truthConfidence && (
            <div className="px-6 pt-2 pb-0">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border"
                style={{
                  backgroundColor: cp._meta.truthConfidence === 'VERIFIED' ? '#dcfce7' :
                                   cp._meta.truthConfidence === 'PARTIAL'   ? '#fef9c3' : '#f1f5f9',
                  borderColor:     cp._meta.truthConfidence === 'VERIFIED' ? '#86efac' :
                                   cp._meta.truthConfidence === 'PARTIAL'   ? '#fde047' : '#cbd5e1',
                  color:           cp._meta.truthConfidence === 'VERIFIED' ? '#166534' :
                                   cp._meta.truthConfidence === 'PARTIAL'   ? '#854d0e' : '#475569',
                }}>
                <span>{cp._meta.truthConfidence === 'VERIFIED' ? '✓' : cp._meta.truthConfidence === 'PARTIAL' ? '◑' : '~'}</span>
                <span>Data Quality: {cp._meta.truthConfidence}</span>
                {cp._meta.truthConfidence === 'ESTIMATED' && (
                  <span className="font-normal opacity-80"> — projections are estimates</span>
                )}
                {cp._meta.truthConfidence === 'PARTIAL' && (
                  <span className="font-normal opacity-80"> — utility estimated, bill-derived rate used</span>
                )}
              </div>
            </div>
          )}

          {/* ════════════════════════════════════════
              2. WHAT THIS MEANS
          ════════════════════════════════════════ */}
          {(() => {
            const annualBillAmt = client?.annualBill && client.annualBill > 0
              ? client.annualBill
              : monthlyBillData.reduce((s, m) => s + m.before, 0);
            // Canonical 25yr without-solar cost from pipeline (replaces inline Math.pow)
            const lifetimeUtility = cp.truth25yr.utilityCostWithoutSolar;
            const postSolarAnnual = monthlyBillData.reduce((s, m) => s + m.after, 0);
            if (annualBillAmt === 0) return null;
            return (
              <div className="px-5 py-3 md:px-6 border-b border-slate-100 proposal-sec section-intro bg-white" data-block-id="what-this-means">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-7 h-7 rounded-lg bg-red-50 border border-red-100 flex items-center justify-center">
                    <TrendingUp size={14} className="text-red-500" />
                  </div>
                  <h2 className="text-base font-black text-slate-800 uppercase tracking-wide">What This Means For You</h2>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                  <div className="md:col-span-2 bg-red-50 border border-red-200 rounded-xl p-4">
                    <div className="text-xs font-bold text-red-500 uppercase tracking-wide mb-2">Without Solar — The True Cost</div>
                    <div className="text-4xl font-black text-red-700 mb-1 leading-none">${lifetimeUtility.toLocaleString()}</div>
                    <div className="text-sm text-red-600 font-medium mb-3">paid to the utility over 25 years</div>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      You are currently spending approximately{' '}
                      <strong className="text-slate-800">${annualBillAmt.toLocaleString()}/year</strong> on electricity.
                      With 3% annual rate increases, that adds up to <strong className="text-red-700">${lifetimeUtility.toLocaleString()}+</strong> over the next 25 years — money paid to the utility with nothing to show for it.
                    </p>
                  </div>
                  <div className="bg-emerald-50 border border-emerald-300 rounded-xl p-4 flex flex-col justify-center text-center">
                    <div className="text-xs font-bold text-emerald-600 uppercase tracking-wide mb-2">With This System</div>
                    <div className="text-4xl font-black text-emerald-700 mb-1 leading-none">
                      ${postSolarAnnual > 0 ? postSolarAnnual.toLocaleString() : '0'}/yr
                    </div>
                    <div className="text-sm text-emerald-600 font-medium mb-3">estimated remaining utility bill/year (before financing)</div>
                    <div className="text-xs text-slate-500">You own the power. You control the cost.</div>
                  </div>
                </div>

                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-500 flex items-center justify-center flex-shrink-0">
                    <Lock size={18} className="text-white" />
                  </div>
                  <div>
                    <div className="font-bold text-amber-800 text-sm">Lock in your energy costs today.</div>
                    <div className="text-xs text-amber-700 mt-0.5">Energy rates rise every year — going solar now protects your budget for decades.</div>
                  </div>
                </div>

                {/* v47.183 — 3-Part Financial Reality */}
                <div className="mt-4 space-y-3">
                  {/* Sub-section A: What Changes Today */}
                  <div className="border border-slate-200 rounded-xl p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-5 h-5 rounded-md bg-blue-100 flex items-center justify-center text-xs font-black text-blue-700">1</div>
                      <span className="font-bold text-slate-800 text-sm">What Changes Today</span>
                    </div>

                    {/* PRIMARY: Net Monthly Difference — reframed as ownership investment */}
                    <div className={`rounded-xl p-3 mb-2 border-2 text-center ${paymentExceedsBill ? 'bg-amber-50 border-amber-400' : 'bg-emerald-50 border-emerald-400'}`}>
                      <div className={`text-xs font-black uppercase tracking-wide mb-1 ${paymentExceedsBill ? 'text-amber-600' : 'text-emerald-600'}`}>
                        {paymentExceedsBill ? 'Monthly Investment Difference' : 'Net Monthly Difference'}
                      </div>
                      <div className={`text-3xl font-black mb-1 ${paymentExceedsBill ? 'text-amber-700' : 'text-emerald-700'}`}>
                        {financeMonthlyPayment > 0 && avgMonthlyBillBefore > 0
                          ? (paymentExceedsBill
                              ? `$${Math.abs(monthlyNetImpact)}/mo toward ownership`
                              : `−$${Math.abs(monthlyNetImpact)}/mo`)
                          : '—'}
                      </div>
                      <div className={`text-sm font-medium ${paymentExceedsBill ? 'text-amber-700' : 'text-emerald-700'}`}>
                        {paymentExceedsBill
                          ? `This is not an extra cost — it’s the portion of your payment that builds equity in your energy system instead of paying the utility.`
                          : `Your solar payment is ~$${Math.abs(monthlyNetImpact)}/mo less than your current utility bill.`
                        }
                      </div>
                    </div>

                    {/* Secondary: Payment breakdown grid */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-slate-50 border border-slate-200 rounded-lg p-2 text-center">
                        <div className="text-xs text-slate-500 font-bold uppercase mb-0.5">Current Bill</div>
                        <div className="text-lg font-black text-slate-700">
                          ${avgMonthlyBillBefore > 0 ? avgMonthlyBillBefore.toLocaleString() : '—'}/mo
                        </div>
                        <div className="text-xs text-red-500 mt-0.5">rises ~3%/year</div>
                      </div>
                      <div className="bg-slate-50 border border-slate-200 rounded-lg p-2 text-center">
                        <div className="text-xs text-slate-500 font-bold uppercase mb-0.5">Solar Payment</div>
                        <div className="text-lg font-black text-slate-700">
                          ${financeMonthlyPayment > 0 ? financeMonthlyPayment.toLocaleString() : '—'}/mo
                        </div>
                        <div className="text-xs text-blue-600 mt-0.5">fixed — never changes</div>
                      </div>
                    </div>

                    {/* Core reframe line */}
                    <div className="mt-2 bg-slate-900 rounded-lg px-3 py-2 text-center">
                      <p className="text-xs text-slate-300 leading-relaxed">
                        <span className="text-amber-400 font-bold">You’re not just paying for electricity</span>
                        {' '}— you’re replacing a rising bill with a fixed asset you own.
                      </p>
                    </div>

                    {/* Cashflow Reality Block */}
                    <div className="mt-2 border border-indigo-200 bg-indigo-50 rounded-lg p-3">
                      <div className="text-xs font-black uppercase text-indigo-700 mb-3 tracking-wide">Monthly Cashflow Reality</div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="text-center">
                          <div className="text-xs text-slate-500 mb-1">Solar Payment</div>
                          <div className="text-base font-black text-slate-800">${financeMonthlyPayment > 0 ? financeMonthlyPayment.toLocaleString() : '\u2014'}</div>
                          <div className="text-xs text-blue-600">fixed</div>
                        </div>
                        <div className="text-center">
                          <div className="text-xs text-slate-500 mb-1">Energy Produced</div>
                          <div className="text-base font-black text-emerald-700">${cp.financial.annualEnergyValue > 0 ? Math.round(cp.financial.annualEnergyValue / 12).toLocaleString() : '\u2014'}/mo</div>
                          <div className="text-xs text-emerald-600">value generated</div>
                        </div>
                        <div className="text-center">
                          <div className="text-xs text-slate-500 mb-1">Net Position</div>
                          {cp.financial.annualEnergyValue > 0 && financeMonthlyPayment > 0 ? (
                            <div className={`text-base font-black ${Math.round(cp.financial.annualEnergyValue / 12) >= financeMonthlyPayment ? 'text-emerald-700' : 'text-amber-700'}`}>
                              {Math.round(cp.financial.annualEnergyValue / 12) >= financeMonthlyPayment
                                ? `+$${(Math.round(cp.financial.annualEnergyValue / 12) - financeMonthlyPayment).toLocaleString()}`
                                : `-$${(financeMonthlyPayment - Math.round(cp.financial.annualEnergyValue / 12)).toLocaleString()}`}
                            </div>
                          ) : <div className="text-base font-black text-slate-400">\u2014</div>}
                          <div className="text-xs text-slate-500">value vs payment</div>
                        </div>
                      </div>
                      {cp.offset.isPartialOffset && (
                        <p className="text-xs text-slate-600 mt-3 pt-3 border-t border-indigo-200 leading-relaxed">
                          This system offsets ~{cp.offset.percentage}% of your energy usage. You will continue to receive a reduced utility bill for the remaining {cp.offset.remainingPercentage}% of usage.
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Sub-section B: What Changes Over Time */}
                  <div className="border border-slate-200 rounded-xl p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-5 h-5 rounded-md bg-amber-100 flex items-center justify-center text-xs font-black text-amber-700">2</div>
                      <span className="font-bold text-slate-800 text-sm">What Changes Over Time</span>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm py-1.5 border-b border-slate-100">
                        <span className="text-slate-600">Utility escalation rate</span>
                        <span className="font-bold text-red-600">+3%/year (historical avg)</span>
                      </div>
                      <div className="flex items-center justify-between text-sm py-1.5 border-b border-slate-100">
                        <span className="text-slate-600">Your solar payment</span>
                        <span className="font-bold text-blue-700">Fixed — never increases</span>
                      </div>
                      {/* SYSTEM PAYBACK — energy cost recovered */}
                      <div className="flex items-center justify-between text-sm py-1.5 border-b border-slate-100">
                        <div>
                          <span className="text-slate-700 font-semibold">🔵 Full System Payback</span>
                          <div className="text-xs text-slate-400 mt-0.5">Year your cumulative savings = system cost</div>
                        </div>
                        <span className="font-black text-blue-700 text-base">{basePaybackYears} yrs</span>
                      </div>
                      {/* CASH FLOW BREAK-EVEN — gradual crossover, no fixed year */}
                      <div className="flex items-start justify-between text-sm py-1.5 border-b border-slate-100">
                        <div className="flex-1">
                          <span className="text-slate-700 font-semibold">🟡 Monthly Cost Crossover</span>
                          <div className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                            Crossover happens gradually as utility rates increase — not a fixed year.
                            You start building savings immediately through energy production, even if your monthly payment is slightly higher at first.
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-sm py-1.5">
                        <span className="text-slate-600">After full payback (Year {basePaybackYears})</span>
                        <span className="font-bold text-emerald-700">{energyOffset >= 100 ? 'Energy cost essentially eliminated' : `~${energyOffset}% of energy cost offset`}</span>
                      </div>
                    </div>
                  </div>

                </div>
              </div>
            );
          })()}


          {/* ════════════════════════════════════════
              2b. LONG-TERM OUTCOME (REINFORCEMENT)
          ════════════════════════════════════════ */}
          <div className="px-5 py-3 md:px-6 border-b border-slate-100 proposal-sec" data-block-id="long-term-outcome">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center">
                <TrendingUp size={16} className="text-amber-600" />
              </div>
              <h2 className="text-base font-black text-slate-800 uppercase tracking-wide">Your Long-Term Outcome</h2>
            </div>
            <p className="text-xs text-slate-500 mb-2 ml-10">
              Here is what your investment looks like over the full system lifetime.
            </p>
            <div className="bg-slate-900 rounded-lg p-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center">
                  <div className="text-xl font-black text-amber-400">${netSavings25yr > 0 ? netSavings25yr.toLocaleString() : '—'}</div>
                  <div className="text-xs text-slate-400 mt-1">25-year net savings</div>
                </div>
                <div className="text-center">
                  <div className="text-xl font-black text-emerald-400">{basePaybackYears}</div>
                  <div className="text-xs text-slate-400 mt-1">year system payoff</div>
                </div>
                <div className="text-center">
                  <div className="text-xl font-black text-blue-400">{25 - Math.round(basePaybackYears)}</div>
                  <div className="text-xs text-slate-400 mt-1">years of free energy</div>
                </div>
              </div>
            </div>
          </div>

          {/* ═══════════════════════════════════════
              PUNCH PAGE: SAVINGS IMPACT
          ═══════════════════════════════════════ */}
          <div className="bg-slate-900 text-white proposal-sec py-20 px-8 text-center" data-block-id="savings-punch" data-keep-together="true">
            <div className="max-w-lg mx-auto">
              <div className="text-sm font-black text-amber-400 uppercase tracking-[0.3em] mb-6">25-Year Net Savings</div>
              <div className="text-8xl font-black text-white mb-6 leading-none">
                ${netSavings25yr > 0 ? netSavings25yr.toLocaleString() : '—'}
              </div>
              <p className="text-lg text-slate-400">
                This is what ownership creates.
              </p>
            </div>
          </div>

          {/* ════════════════════════════════════════
              3. SYSTEM SUMMARY
          ════════════════════════════════════════ */}
          <div className="px-5 py-3 md:px-6 border-b border-slate-100 proposal-sec" data-block-id="system-summary">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center">
                <Sun size={16} className="text-amber-600" />
              </div>
              <h2 className="text-lg font-black text-slate-900">Your Custom System</h2>
            </div>
            <p className="text-sm text-slate-500 mb-1 ml-10">
              This system is custom-designed for your home and energy usage — sized to match your actual consumption patterns.
            </p>
            {annualProduction > 0 && annualUsage > 0 && (
              <div className="ml-10 mb-6 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
                <Zap size={14} className="text-emerald-600 flex-shrink-0" />
                <span>
                  Based on your actual energy usage of <strong>{annualUsage.toLocaleString()} kWh/year</strong>, this system is designed to offset approximately <strong>{energyOffset}%</strong> of your electricity — <strong>{annualProduction.toLocaleString()} kWh</strong> generated annually.
                </span>
              </div>
            )}
            {annualProduction > 0 && annualUsage === 0 && (
              <div className="ml-10 mb-6 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
                <Zap size={14} className="text-emerald-600 flex-shrink-0" />
                <span>This {systemSizeKw.toFixed(1)} kW system is projected to generate <strong>{annualProduction.toLocaleString()} kWh</strong> annually — designed to dramatically reduce your electricity costs from day one.</span>
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              {[
                {
                  icon: systemTypeIcon,
                  label: 'System Type',
                  value: multiArraySystemLabel,
                  color: 'bg-amber-50 text-amber-700 border-amber-200',
                },
                {
                  icon: <Zap size={18} />,
                  label: 'Total Size',
                  value: systemSizeKw > 0 ? `${systemSizeKw.toFixed(2)} kW` : '—',
                  color: 'bg-blue-50 text-blue-700 border-blue-200',
                },
                {
                  icon: <Sun size={18} />,
                  label: 'Panel Count',
                  value: (layout?.totalPanels && layout.totalPanels > 0)
                    ? `${layout.totalPanels} panels`
                    : systemSizeKw > 0 ? `${Math.ceil(systemSizeKw / 0.44)} panels` : '—',
                  color: 'bg-orange-50 text-orange-700 border-orange-200',
                },
                {
                  icon: <TrendingUp size={18} />,
                  label: 'Annual Production',
                  value: annualProduction > 0
                    ? `${annualProduction.toLocaleString()} kWh`
                    : systemSizeKw > 0 ? `${Math.round(systemSizeKw * 1250).toLocaleString()} kWh` : '—',
                  color: 'bg-green-50 text-green-700 border-green-200',
                },
              ].map(item => (
                <div key={item.label} className={`rounded-xl p-4 border ${item.color}`}>
                  <div className="mb-2 opacity-70">{item.icon}</div>
                  <div className="text-xs uppercase tracking-wide opacity-60 mb-1">{item.label}</div>
                  <div className="font-bold text-base">{item.value}</div>
                </div>
              ))}
            </div>


            {/* ── Multi-array breakdown (shown for hybrid / multi-mount systems) ── */}
            {(isHybridSystem || storedArrayBreakdown) && (() => {
              const displayArrays = storedArrayBreakdown ?? derivedArrays.map(a => ({
                id: a.id, type: a.type, label: a.label ?? a.type,
                panelCount: a.panelCount, arraySizeKw: a.arraySizeKw,
                annualKwh: a.annualKwh, bifacialGain: a.bifacialGain,
              }));
              if (!displayArrays || displayArrays.length === 0) return null;
              const ARRAY_COLORS: Record<string, string> = {
                roof:    'bg-blue-50 border-blue-200 text-blue-800',
                ground:  'bg-emerald-50 border-emerald-200 text-emerald-800',
                fence:   'bg-amber-50 border-amber-200 text-amber-800',
                carport: 'bg-purple-50 border-purple-200 text-purple-800',
              };
              const ARRAY_ICONS: Record<string, string> = {
                roof: '🏠', ground: '🌱', fence: '🔆', carport: '🚗',
              };
              const totalArrayKwh = displayArrays.reduce((s: number, a: any) => s + (a.annualKwh ?? 0), 0);
              return (
                <div className="mb-6 bg-white border border-slate-200 rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-6 h-6 rounded bg-slate-100 flex items-center justify-center text-sm">⚡</div>
                    <span className="text-sm font-bold text-slate-800">Your System Includes</span>
                    <span className="ml-auto text-xs text-slate-400 font-medium">
                      {displayArrays.reduce((s: number, a: any) => s + (a.panelCount ?? 0), 0)} panels total
                    </span>
                  </div>
                  {/* System Configuration summary */}
                  <div className="mb-3 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                    <div className="text-xs font-black text-slate-600 uppercase tracking-wide mb-2">System Configuration</div>
                    <div className="flex flex-wrap gap-3">
                      {displayArrays.filter((a: any) => a.type === 'roof').map((a: any) => (
                        <div key={a.id} className="flex items-center gap-1.5 text-xs bg-blue-50 border border-blue-200 rounded-lg px-3 py-1.5">
                          <span>🏠</span>
                          <span className="font-semibold text-blue-700">Roof: {a.arraySizeKw.toFixed(1)} kW</span>
                        </div>
                      ))}
                      {displayArrays.filter((a: any) => a.type === 'fence').map((a: any) => (
                        <div key={a.id} className="flex items-center gap-1.5 text-xs bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
                          <span>🌞</span>
                          <span className="font-semibold text-amber-700">SOL Fence: {a.arraySizeKw.toFixed(1)} kW</span>
                        </div>
                      ))}
                      {displayArrays.filter((a: any) => a.type === 'ground').map((a: any) => (
                        <div key={a.id} className="flex items-center gap-1.5 text-xs bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5">
                          <span>🌱</span>
                          <span className="font-semibold text-emerald-700">Ground: {a.arraySizeKw.toFixed(1)} kW</span>
                        </div>
                      ))}
                      {displayArrays.filter((a: any) => a.type === 'carport').map((a: any) => (
                        <div key={a.id} className="flex items-center gap-1.5 text-xs bg-purple-50 border border-purple-200 rounded-lg px-3 py-1.5">
                          <span>🚗</span>
                          <span className="font-semibold text-purple-700">Carport: {a.arraySizeKw.toFixed(1)} kW</span>
                        </div>
                      ))}
                      <div className="flex items-center gap-1.5 text-xs bg-slate-900 rounded-lg px-3 py-1.5">
                        <span className="font-black text-white">Total: {displayArrays.reduce((s: number, a: any) => s + a.arraySizeKw, 0).toFixed(1)} kW</span>
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-slate-500 leading-relaxed">
                      Your system can be optimized across roof, ground, and property line (SOL Fence) to maximize production and aesthetics.
                    </div>
                  </div>
                  <div className="space-y-3">
                    {displayArrays.map((arr: any) => {
                      const pct = totalArrayKwh > 0 ? Math.round((arr.annualKwh / totalArrayKwh) * 100) : 0;
                      const colorCls = ARRAY_COLORS[arr.type] ?? ARRAY_COLORS.roof;
                      const icon = ARRAY_ICONS[arr.type] ?? '🔆';
                      return (
                        <div key={arr.id} className={`rounded-xl border p-4 ${colorCls}`}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <span className="text-base">{icon}</span>
                              <div>
                                <div className="font-bold text-sm">{arr.label}</div>
                                <div className="text-xs opacity-70 mt-0.5">
                                  {arr.panelCount} panels &bull; {arr.arraySizeKw.toFixed(2)} kW
                                  {arr.type === 'fence' && arr.bifacialGain > 1.0 && (
                                    <span className="ml-2 font-semibold">
                                      &bull; Bifacial +{Math.round((arr.bifacialGain - 1) * 100)}%
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="font-black text-base">{arr.annualKwh.toLocaleString()} kWh/yr</div>
                              <div className="text-xs opacity-60">{pct}% of total</div>
                            </div>
                          </div>
                          <div className="mt-2 w-full bg-white/50 rounded-full h-1.5 overflow-hidden">
                            <div className="h-full rounded-full bg-current opacity-40" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-sm">
                    <span className="text-slate-500 font-medium">Total System Size</span>
                    <span className="font-black text-slate-900">
                      {systemSizeKw.toFixed(1)} kW &mdash; {totalArrayKwh > 0 ? totalArrayKwh.toLocaleString() : (annualProduction > 0 ? annualProduction.toLocaleString() : Math.round(systemSizeKw * 1250).toLocaleString())} kWh/yr
                    </span>
                  </div>
                </div>
              );
            })()}

            {/* ── Hybrid / fence / ground dynamic proposal language ── */}
            {arrayProposalText && (
              <div className="mb-6 bg-slate-800 rounded-xl p-5 text-white">
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center shrink-0 mt-0.5">
                    <Zap size={16} className="text-amber-400" />
                  </div>
                  <p className="text-sm leading-relaxed text-slate-200">{arrayProposalText}</p>
                </div>
              </div>
            )}

            {/* Offset bar */}
            {energyOffset > 0 && (
              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-slate-700">Energy Offset</span>
                  <span className="text-2xl font-black text-emerald-700">{energyOffset}%</span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-4 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(energyOffset, 100)}%`,
                      background: 'linear-gradient(90deg, #10b981, #059669)',
                    }}
                  />
                </div>
                <div className="flex justify-between text-xs text-slate-400 mt-1.5">
                  <span>0%</span>
                  <span className="text-emerald-600 font-semibold">
                    {energyOffset >= 100 ? 'Full offset — energy independence achieved' : `${energyOffset}% of your usage covered`}
                  </span>
                  <span>100%</span>
                </div>
              </div>
            )}

            {/* Production monthly chart */}
            {production && (
              <div className="mt-5 bg-white border border-slate-200 rounded-xl p-5">
                <div className="text-sm font-semibold text-slate-700 mb-3">Estimated Monthly Production (kWh)</div>
                <div className="flex items-end gap-1 h-24 mb-2">
                  {production.monthlyProductionKwh.map((kwh: number, i: number) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                      <div
                        className="w-full rounded-t-sm"
                        style={{
                          height: `${(kwh / maxMonthly) * 88}px`,
                          background: 'linear-gradient(to top, #f59e0b, #fbbf24)',
                        }}
                        title={`${MONTHS[i]}: ${kwh.toLocaleString()} kWh`}
                      />
                      <span className="text-slate-400" style={{ fontSize: '8px' }}>{MONTHS[i][0]}</span>
                    </div>
                  ))}
                </div>
                <div className="text-xs text-slate-400 text-center">
                  Peak month: {MONTHS[production.monthlyProductionKwh.indexOf(Math.max(...production.monthlyProductionKwh))]} — {Math.max(...production.monthlyProductionKwh).toLocaleString()} kWh
                </div>
              </div>
            )}
          </div>

          {/* ══════════════════════════════════════════
              3b. YOUR UTILITY PROFILE
          ══════════════════════════════════════════ */}
          {cp.utility && (
            <div className="px-5 py-3 md:px-6 border-b border-slate-100 proposal-sec" data-block-id="utility-profile">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center">
                  <Zap size={16} className="text-blue-600" />
                </div>
                <h2 className="text-lg font-black text-slate-900">Your Utility Profile</h2>
              </div>

              {/* Panel validation stamp */}
              {cp.panel.count > 0 && cp.panel.wattage > 0 && (
                <div className="flex items-center gap-2 mb-2 px-3 py-1.5 bg-green-50 border border-green-200 rounded-xl w-fit">
                  <span className="text-green-700 text-xs font-bold">✓ System Verified:</span>
                  <span className="text-green-800 text-xs">{cp.panel.count} panels × {cp.panel.wattage}W = {cp.panel.systemSizeKw.toFixed(2)} kW</span>
                </div>
              )}

              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                  <div className="text-xs text-slate-500 mb-1">Utility Provider</div>
                  <div className="text-sm font-bold text-slate-900">{cp.utility.provider}</div>
                </div>

                <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                  <div className="text-xs text-slate-500 mb-1">Current Rate</div>
                  <div className="text-sm font-bold text-slate-900">${cp.utility.rate.toFixed(3)}/kWh</div>
                </div>

                <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                  <div className="text-xs text-slate-500 mb-1">Annual Usage</div>
                  <div className="text-sm font-bold text-slate-900">{cp.utility.annualUsageKwh.toLocaleString()} kWh</div>
                </div>

                <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                  <div className="text-xs text-slate-500 mb-1">Rate Escalation</div>
                  <div className="text-sm font-bold text-orange-600">{(cp.utility.escalationRate * 100).toFixed(1)}%/yr avg</div>
                  <div className="text-xs text-slate-400 mt-0.5">{cp.utility.escalationRateSourceLabel}</div>
                  {cp.utility.escalationRateSource === 'fallback_unverified' && (
                    <div className="mt-2 flex items-start gap-1.5 px-2 py-1.5 bg-amber-50 border border-amber-200 rounded-lg">
                      <span className="text-amber-500 text-xs mt-0.5">⚠</span>
                      <span className="text-xs text-amber-700 leading-snug">
                        Utility escalation is estimated using regional averages due to unavailable provider-specific data.
                      </span>
                    </div>
                  )}
                </div>

                <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                  <div className="text-xs text-slate-500 mb-1">Net Metering</div>
                  <div className="text-sm font-bold text-slate-900">{cp.utility.netMeteringType !== "none" ? "Available" : "Not Available"}</div>
                </div>

                {cp.utility.exportRate > 0 && (
                  <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                    <div className="text-xs text-slate-500 mb-1">Export Rate</div>
                    <div className="text-sm font-bold text-green-600">${cp.utility.exportRate.toFixed(3)}/kWh</div>
                  </div>
                )}

                {cp.policy?.srecAvailable && (
                  <div className="bg-green-50 rounded-lg p-3 border border-green-100 col-span-2 md:col-span-1">
                    <div className="text-xs text-green-700 mb-1">SREC Program</div>
                    <div className="text-sm font-bold text-green-800">{cp.policy.srecProgramName || "Active"}</div>
                    {cp.policy.srecPricePerMwh > 0 && (
                      <div className="text-xs text-green-600 mt-1">${cp.policy.srecPricePerMwh}/MWh</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ════════════════════════════════════════
              4. COST VS VALUE
          ════════════════════════════════════════ */}
          {(cost || effectiveFinal > 0) && (
            <div className="px-5 py-3 md:px-6 border-b border-slate-100 proposal-sec bg-slate-50" data-block-id="cost-vs-value" data-keep-together="true">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-lg bg-green-50 border border-green-100 flex items-center justify-center">
                  <BarChart2 size={16} className="text-green-600" />
                </div>
                <h2 className="text-lg font-black text-slate-900">Cost vs. Value — The Full Picture</h2>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                {/* LEFT — Paying the utility */}
                <div className="bg-red-50 border border-red-200 rounded-2xl p-6">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-7 h-7 rounded-lg bg-red-100 flex items-center justify-center">
                      <TrendingUp size={14} className="text-red-600" />
                    </div>
                    <div className="font-black text-red-800 text-sm uppercase tracking-wide">Keep Paying the Utility</div>
                  </div>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center py-2 border-b border-red-100">
                      <span className="text-sm text-slate-600">Current Annual Bill</span>
                      <span className="font-black text-red-700 text-lg">
                        ${(client?.annualBill && client.annualBill > 0
                          ? client.annualBill
                          : monthlyBillData.reduce((s, m) => s + m.before, 0)).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-2 border-b border-red-100">
                      <span className="text-sm text-slate-600">10-Year Utility Cost</span>
                      <span className="font-bold text-red-600">
                        ${Math.round(cp.truth25yr.projectionChart.slice(0,10).reduce((s, y) => s + y.savings, 0)).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-2">
                      <span className="text-sm font-bold text-slate-700">25-Year Utility Cost</span>
                      <span className="font-black text-red-700 text-3xl">
                        ${cp.truth25yr.utilityCostWithoutSolar.toLocaleString()}+
                      </span>
                    </div>
                  </div>
                  <div className="mt-4 text-xs text-red-500 italic">Assumes {Math.round(cp.utility.escalationRate * 100)}% annual utility rate increase ({cp.utility.escalationRateSourceLabel}). Nothing owned at end.</div>
                </div>

                {/* RIGHT — Own your power */}
                <div className="bg-emerald-50 border border-emerald-300 rounded-2xl p-6">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center">
                      <Shield size={14} className="text-emerald-600" />
                    </div>
                    <div className="font-black text-emerald-800 text-sm uppercase tracking-wide">Own Your Power</div>
                  </div>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center py-2 border-b border-emerald-100">
                      <span className="text-sm text-slate-600">System Investment</span>
                      <span className="font-black text-slate-800 text-lg">${effectiveFinal.toLocaleString()}</span>
                    </div>
                    <div className="flex flex-col py-2 border-b border-emerald-100 gap-0.5">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-slate-600">Energy Produced Value (Year 1)</span>
                        <span className="font-bold text-emerald-700">
                          ${(projectionData[0]?.savings ?? annualSavings).toLocaleString()}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 leading-relaxed">
                        This represents the value of electricity your system generates — separate from your financing payment.
                      </div>
                    </div>
                    <div className="flex justify-between items-center py-2 border-b border-emerald-100">
                      <span className="text-sm text-slate-600">Payback Period</span>
                      <span className="font-bold text-blue-700">{paybackYears} years</span>
                    </div>
                    <div className="flex justify-between items-center py-2">
                      <span className="text-sm font-bold text-slate-700">25-Year Net Savings</span>
                      <span className="font-black text-emerald-700 text-3xl">
                        ${Math.max(0, Math.round(cp.truth25yr.netDifference)).toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <div className="mt-4 text-xs text-emerald-600 italic">{energyOffset >= 100 ? 'After payoff, your electricity cost is essentially eliminated.' : `After payoff, this system offsets ${energyOffset}% of your usage — reducing (not eliminating) ongoing utility costs.`}</div>
                </div>
              </div>

              {/* 25-yr projection chart */}
              {production && projectionData.length > 0 && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
                  <div className="text-sm font-semibold text-slate-700 mb-1">Cumulative Savings — 25 Year Projection</div>
                  <div className="text-xs text-slate-400 mb-3">Solar savings stack every year while utility bills keep climbing</div>
                  <div className="flex items-end gap-0.5 h-24 mb-2">
                    {projectionData.map((d, i) => (
                      <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                        <div
                          className="w-full rounded-t-sm"
                          style={{
                            height: `${(d.cumulative / (projectionData[24]?.cumulative || 1)) * 90}px`,
                            background: 'linear-gradient(to top, #10b981, #34d399)',
                          }}
                          title={`Year ${i + 1}: $${d.cumulative.toLocaleString()} cumulative`}
                        />
                        {(i + 1) % 5 === 0 && (
                          <span className="text-slate-400" style={{ fontSize: '8px' }}>Yr{i+1}</span>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Year 1: ${(projectionData[0]?.cumulative ?? 0).toLocaleString()}</span>
                    <span className="text-emerald-600 font-black text-base">${netSavings25yr.toLocaleString()} net savings</span>
                    <span className="text-slate-400">Year 25</span>
                  </div>
                </div>
              )}
            </div>
          )}

              {/* ── Utility Rate Graph ── */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 mt-6">
                <div className="text-sm font-semibold text-slate-700 mb-1">Electricity Rate — History & Projection</div>
                <p className="text-xs text-slate-400 mb-1">
                  This chart shows how electricity rates from {cp.utility.provider} have changed over time and are projected to increase at approximately {Math.round(cp.utility.escalationRate * 100)}% per year ({cp.utility.escalationRateSourceLabel}).
                </p>
                {cp.utility.rateHistory[0]?.estimated && (
                  <p className="text-xs text-amber-500 italic mb-3">Historical data unavailable — projection based on regional averages.</p>
                )}
                <UtilityRateGraph utility={cp.utility} financial={cp.financial} />

                {/* Cumulative 25-Year Cost Projection */}
                <div className="mt-8 pt-6 border-t border-slate-100">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-7 h-7 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center">
                      <TrendingUp size={14} className="text-indigo-600" />
                    </div>
                    <h3 className="text-base font-black text-slate-900">25-Year Cumulative Cost: Solar vs. No Solar</h3>
                  </div>
                  <UtilityCostProjectionChart
                    utility={cp.utility}
                    financial={cp.financial}
                    truth25yr={cp.truth25yr}
                    panelDegradation={0.005}
                  />
                </div>
              </div>

          {/* 4b. FINANCING ENGINE — AFFORDABLE MONTHLY OPTIONS */}
          {financeMonthlyPayment > 0 && (
            <div className="px-5 py-3 md:px-6 border-b border-slate-100 proposal-sec" data-block-id="what-changes-today">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center">
                  <DollarSign size={16} className="text-blue-600" />
                </div>
                <h2 className="text-lg font-black text-slate-900">Affordable Monthly Options</h2>
              </div>
              <p className="text-sm text-slate-500 mb-3 ml-10">
                You don’t have to pay cash upfront — most homeowners choose financing to lock in a fixed energy payment and build long-term ownership.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center">
                  <div className="text-xs font-bold text-red-500 uppercase tracking-wide mb-3">Current Estimated Utility Bill</div>
                  <div className="text-6xl font-black text-red-700 mb-2 leading-none">
                    ${avgMonthlyBillBefore > 0 ? avgMonthlyBillBefore.toLocaleString() : '—'}
                  </div>
                  <div className="text-sm text-red-600 font-medium mb-3">per month</div>
                  <div className="text-xs text-red-500 bg-red-100 rounded-lg px-3 py-2">
                    ↑ Energy rates rise every year — you own nothing at the end
                  </div>
                </div>

                <div className="bg-emerald-50 border border-emerald-400 rounded-2xl p-6 text-center relative">
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-emerald-600 text-white text-xs font-black px-3 py-1 rounded-full">
                    RECOMMENDED
                  </div>
                  <div className="text-xs font-bold text-emerald-600 uppercase tracking-wide mb-3">Estimated Solar Payment</div>
                  <div className="text-6xl font-black text-emerald-700 mb-2 leading-none">
                    ${financeMonthlyPayment.toLocaleString()}
                  </div>
                  <div className="text-sm text-emerald-600 font-medium mb-3">per month</div>
                  <div className="text-xs text-emerald-700 bg-emerald-100 rounded-lg px-3 py-2">
                    ✓ Fixed rate — you own the system
                  </div>
                </div>
              </div>

              <div className={`rounded-2xl p-5 text-center mb-4 ${financeUnderBill ? 'bg-emerald-600' : 'bg-blue-600'} text-white`}>
                {financeUnderBill ? (
                  <>
                    <div className="font-black text-xl mb-1">💚 Little to No Increase Over Your Current Bill</div>
                    <div className="text-sm font-medium opacity-90">
                      Your estimated solar payment is <strong>${financeMonthlyPayment}/mo</strong> — comparable to what you’re already paying the utility, but now you own the system.
                    </div>
                  </>
                ) : (
                  <>
                    <div className="font-black text-xl mb-1">🔒 Lock In a Stable, Predictable Energy Payment</div>
                    <div className="text-sm font-medium opacity-90">
                      At <strong>${financeMonthlyPayment}/mo</strong>, your solar payment is fixed — while utility rates keep rising. Lock in pricing now before programs change.
                    </div>
                  </>
                )}
              </div>

              <div className="text-xs text-slate-400 text-center">
                Estimated at {(financeApr * 100).toFixed(2)}% APR over {financeTermYears} years on ${effectiveFinal.toLocaleString()} system cost. Rates subject to lender approval. No prepayment penalty.
              </div>
            </div>
          )}

          {/* 4c. FINANCIAL TIMELINE — HOW YOUR INVESTMENT EVOLVES */}
          {(financeMonthlyPayment > 0 || effectiveFinal > 0) && (
            <div className="px-5 py-3 md:px-6 border-b border-slate-100 proposal-sec bg-amber-50" data-block-id="financial-timeline" data-keep-together="true">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center">
                  <TrendingUp size={16} className="text-indigo-600" />
                </div>
                <h2 className="text-lg font-black text-slate-900">How Your Investment Evolves Over Time</h2>
              </div>
              <p className="text-sm text-slate-500 mb-3 ml-10">
                Solar is a long-term play. Here’s what the journey looks like from day one to full ownership.
              </p>

              {/* 3-Phase Timeline — Horizontal */}
              <div className="grid grid-cols-3 gap-2">

                {/* PHASE 1 — TODAY */}
                <div className="border border-amber-200 rounded-xl p-3 bg-amber-50/30">
                  <div className="flex items-center gap-1.5 mb-2">
                    <div className="w-6 h-6 rounded-full bg-amber-100 border-2 border-amber-400 flex items-center justify-center text-xs font-black text-amber-700">1</div>
                    <span className="text-xs font-black text-amber-700 uppercase">Today</span>
                  </div>
                  <div className="font-bold text-amber-800 text-xs mb-1 leading-snug">
                    Own your energy from day one
                    {paymentExceedsBill && <span className="ml-1 text-[10px] bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded-full font-bold">Slightly higher</span>}
                  </div>
                  <p className="text-[11px] text-slate-600 leading-snug">
                    {paymentExceedsBill
                      ? `Solar payment ($${financeMonthlyPayment}/mo) replaces a rising bill. Fixed rate, full ownership.`
                      : `Solar payment ($${financeMonthlyPayment > 0 ? financeMonthlyPayment : effectiveFinal}/mo) comparable to current bill. Building equity from day one.`
                    }
                  </p>
                </div>

                {/* PHASE 2 — MID TERM */}
                <div className="border border-blue-200 rounded-xl p-3 bg-blue-50/30">
                  <div className="flex items-center gap-1.5 mb-2">
                    <div className="w-6 h-6 rounded-full bg-blue-100 border-2 border-blue-400 flex items-center justify-center text-xs font-black text-blue-700">2</div>
                    <span className="text-xs font-black text-blue-700 uppercase">Mid-Term</span>
                  </div>
                  <div className="font-bold text-blue-800 text-xs mb-1 leading-snug">
                    Rates rise — yours stays fixed
                  </div>
                  <p className="text-[11px] text-slate-600 leading-snug">
                    Utility rates climb ~3%/yr. Your solar payment never changes. The gap widens in your favor every year.
                  </p>
                </div>

                {/* PHASE 3 — LONG TERM */}
                <div className="border border-emerald-300 rounded-xl p-3 bg-emerald-50/30">
                  <div className="flex items-center gap-1.5 mb-2">
                    <div className="w-6 h-6 rounded-full bg-emerald-100 border-2 border-emerald-500 flex items-center justify-center text-xs font-black text-emerald-700">3</div>
                    <span className="text-xs font-black text-emerald-700 uppercase">Long-Term</span>
                  </div>
                  <div className="font-bold text-emerald-800 text-xs mb-1 leading-snug">
                    System paid off — energy free
                  </div>
                  <p className="text-[11px] text-slate-600 leading-snug">
                    After ~{basePaybackYears} yrs, {energyOffset >= 100 ? 'electricity cost eliminated.' : `${energyOffset}% offset.`}{' '}
                    Net savings: <strong className="text-emerald-700">${netSavings25yr > 0 ? netSavings25yr.toLocaleString() : '—'}</strong>.
                    {adjustedPaybackYears < basePaybackYears ? ` ${projectStateCode} incentives may accelerate payoff.` : ''}
                  </p>
                </div>

              </div>
            </div>
          )}

          {/* ════════════════════════════════════════
              5. INCENTIVES & SREC
          ════════════════════════════════════════ */}
          <div className="px-5 py-3 md:px-6 border-b border-slate-100 proposal-sec" data-block-id="incentives-srec">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center">
                <Award size={16} className="text-emerald-600" />
              </div>
              <div>
                <h2 className="text-lg font-black text-slate-900">Incentives & Additional Income</h2>
                <p className="text-xs text-slate-500 mt-0.5">Programs available for {projectStateCode || 'your state'}</p>
              </div>
            </div>

            {/* IL / SREC-state: lead with SREC income */}
            {SREC_STATES.has((projectStateCode || '').toUpperCase()) && (
              <div className="mb-5">
                <div className="bg-emerald-50 border border-emerald-300 rounded-2xl p-6 mb-4">
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-black bg-emerald-600 text-white">
                          {projectStateCode} PROGRAM
                        </span>
                        <span className="text-xs text-emerald-700 font-semibold">Additional Income — Paid To You</span>
                      </div>
                      <h3 className="text-2xl font-black text-emerald-800 mb-2">
                        {projectStateCode === 'IL'
                          ? 'Illinois Shines (Adjustable Block Program)'
                          : projectStateCode === 'NJ' ? 'NJ Successor Solar Incentive (SuSI)'
                          : projectStateCode === 'MA' ? 'Massachusetts SMART Program'
                          : 'Solar Renewable Energy Credits (SRECs)'}
                      </h3>
                      <p className="text-sm text-slate-600 leading-relaxed mb-3">
                        {projectStateCode === 'IL'
                          ? 'Illinois offers one of the strongest solar income programs in the country. Through the Adjustable Block Program (Illinois Shines), you receive a 15-year Renewable Energy Credit (REC) payment — income paid directly to you for producing clean energy.'
                          : `Your state rewards solar producers with credits earned for every 1,000 kWh generated. These are sold to utilities required to meet Renewable Portfolio Standards — creating a second income stream beyond electricity savings.`}
                      </p>
                      {production && production.annualProductionKwh > 0 && stateIncentives && (() => {
                        const srecInc = stateIncentives.stateIncentives.find((s: any) => s.type === 'srec' || s.type === 'trec' || s.type === 'performance_payment');
                        return srecInc ? (
                          <div className="bg-white/80 border border-emerald-300 rounded-xl p-4">
                            <div className="text-xs font-black text-emerald-700 uppercase tracking-wide mb-1">
                              📊 Your Estimated {projectStateCode} Program Income
                            </div>
                            <div className="flex items-baseline gap-3 mb-1">
                              <div className="text-3xl font-black text-emerald-700">
                                ${srecInc.calculatedValue.toLocaleString()}
                              </div>
                              <div className="text-sm text-emerald-600 font-semibold">
                                total over 15 years
                              </div>
                            </div>
                            <div className="flex items-center gap-2 mb-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5">
                              <span className="text-xs text-emerald-700 font-bold">Annual equivalent:</span>
                              <span className="text-sm font-black text-emerald-800">
                                ~${Math.round(srecInc.calculatedValue / 15).toLocaleString()}/year
                              </span>
                            </div>
                            <div className="text-xs text-slate-500 leading-relaxed">
                              This income is paid over time based on system production and program structure.
                              It is <strong>separate</strong> from your base energy savings and not included in payback calculations.
                            </div>
                            <div className="text-xs text-slate-400 mt-1">
                              Based on {production.annualProductionKwh.toLocaleString()} kWh/yr annual production
                            </div>
                          </div>
                        ) : (
                          <div className="bg-white/80 border border-emerald-300 rounded-xl p-4">
                            <div className="text-xs font-black text-emerald-700 uppercase tracking-wide mb-1">📊 SREC Income Potential</div>
                            <div className="text-2xl font-black text-emerald-700">
                              ~{Math.floor(production.annualProductionKwh / 1000)} SRECs/year
                            </div>
                            <div className="text-xs text-slate-500 mt-1">
                              Based on {production.annualProductionKwh.toLocaleString()} kWh/yr production. Consult your installer for current market rates.
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                    <div className="flex-shrink-0 text-center bg-emerald-100 rounded-xl p-4 hidden md:block">
                      <div className="text-3xl mb-1">💰</div>
                      <div className="text-xs font-black text-emerald-700">Extra Income</div>
                      <div className="text-xs text-emerald-600">Paid to you</div>
                    </div>
                  </div>
                </div>

                {/* ITC — federal credit summary — only shown when client qualifies */}
                {itcRate > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4">
                  <div className="flex items-start gap-3">
                    <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Shield size={14} className="text-blue-600" />
                    </div>
                    <div>
                      <div className="font-bold text-blue-800 text-sm mb-1">
                        {isCommercial ? 'Commercial Investment Tax Credit (IRC §48E)' : '30% Federal Solar Tax Credit (IRC §25D)'}
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        {isCommercial
                          ? `The commercial Investment Tax Credit (IRC §48E) provides a 30% credit for qualifying projects. Prevailing wage and apprenticeship requirements apply for the full credit. Consult a tax professional.`
                          : `The Inflation Reduction Act provides a 30% federal tax credit on the full cost of your solar installation through 2032. ${projectStateCode ? `${projectStateCode} also offers additional state programs listed above.` : 'Your state may offer additional incentives listed above.'} Consult a tax professional to confirm eligibility.`
                        }
                      </p>
                    </div>
                  </div>
                </div>
                )}
              </div>
            )}

            {/* Non-SREC states: show incentives normally */}
            {!SREC_STATES.has((projectStateCode || '').toUpperCase()) && stateIncentives && stateIncentives.stateIncentives.length > 0 && (
              <div className="space-y-3 mb-5">
                {stateIncentives.stateIncentives.slice(0, 5).map((inc: any, i: number) => (
                  <div key={i} className="bg-white border border-slate-200 rounded-xl p-4 flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${
                          inc.type === 'state_tax_credit' ? 'bg-blue-100 text-blue-700' :
                          inc.type === 'state_rebate' ? 'bg-emerald-100 text-emerald-700' :
                          inc.type === 'srec' ? 'bg-amber-100 text-amber-700' :
                          inc.type === 'property_tax_exemption' ? 'bg-purple-100 text-purple-700' :
                          'bg-slate-100 text-slate-700'
                        }`}>
                          {inc.type.replace(/_/g, ' ').toUpperCase()}
                        </span>
                      </div>
                      <div className="font-semibold text-slate-800 text-sm">{inc.name}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{inc.description}</div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      {inc.isCash ? (
                        <><div className="text-lg font-black text-emerald-700">${(inc.calculatedValue || 0).toLocaleString()}</div><div className="text-xs text-slate-400">cash savings</div></>
                      ) : inc.type === 'srec' || inc.type === 'trec' ? (
                        <><div className="text-lg font-black text-amber-600">${(inc.calculatedValue || 0).toLocaleString()}</div><div className="text-xs text-slate-400">est. income</div></>
                      ) : (
                        <><div className="text-lg font-black text-purple-600">Ongoing</div><div className="text-xs text-slate-400">tax benefit</div></>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Tax exemptions always shown */}
            {stateIncentives && (() => {
              const exemptions = stateIncentives.stateIncentives.filter((s: any) =>
                s.type === 'property_tax_exemption' || s.type === 'sales_tax_exemption'
              );
              if (exemptions.length === 0) return null;
              return (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
                  {exemptions.map((ex: any, i: number) => (
                    <div key={i} className="bg-purple-50 border border-purple-200 rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-lg">{ex.type === 'property_tax_exemption' ? '🏠' : '🛒'}</span>
                        <div className="font-bold text-purple-800 text-sm">{ex.name}</div>
                      </div>
                      <div className="text-xs text-slate-600">{ex.description || ex.notes}</div>
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* Federal ITC notice — only shown when client qualifies (itcRate > 0) */}
            {itcRate > 0 && (
            <div className={`mt-5 rounded-xl p-4 border ${isCommercial ? 'bg-blue-50 border-blue-200' : 'bg-slate-50 border-slate-200'}`}>
              {isCommercial ? (
                <div className="flex items-start gap-3">
                  <span className="text-base">✅</span>
                  <div>
                    <div className="font-bold text-blue-800 text-sm">30% Commercial ITC Available (IRC §48E)</div>
                    <p className="text-xs text-slate-600 mt-0.5">Construction must begin before July 4, 2026. Prevailing wage requirements apply for full credit. Consult a tax professional.</p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3">
                  <span className="text-base">✅</span>
                  <div>
                    <div className="font-bold text-emerald-700 text-sm">30% Federal Solar Tax Credit Available (IRC §25D)</div>
                    <p className="text-xs text-slate-500 mt-0.5">The Inflation Reduction Act (IRA) provides a 30% federal tax credit for residential solar installations through 2032. This applies to the full system cost including installation. Consult a tax professional to confirm eligibility.</p>
                    <p className="text-xs text-slate-400 mt-1">Source: IRA, P.L. 117-169 (Aug 16, 2022) · IRC §25D · Consult your tax advisor</p>
                  </div>
                </div>
              )}
            </div>
            )}

            {/* ── Net Metering Benefit (always shown when NEM type is known) ── */}
            {cp.utility.netMeteringType && cp.utility.netMeteringType !== 'none' && (
              <div className="mt-4 bg-sky-50 border border-sky-200 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <span className="text-base">⚡</span>
                  <div>
                    <div className="font-bold text-sky-800 text-sm">Net Metering — Export Compensation</div>
                    <p className="text-xs text-slate-600 mt-0.5">
                      {cp.utility.netMeteringType === 'retail_1to1'
                        ? `Under ${cp.utility.provider}'s net metering policy, excess power you export to the grid is credited at the full retail rate ($${cp.utility.exportRate.toFixed(3)}/kWh) — maximizing your savings when production exceeds usage.`
                        : cp.utility.netMeteringType === 'net_billing' || cp.utility.netMeteringType === 'nem3'
                        ? `Under ${cp.utility.provider}'s net billing policy, exported power is credited at the avoided cost rate ($${cp.utility.exportRate.toFixed(3)}/kWh). Self-consumption maximizes your return.`
                        : `${cp.utility.provider} compensates exported solar energy at $${cp.utility.exportRate.toFixed(3)}/kWh under their current net energy policy.`}
                    </p>
                    {cp.policy.netMeteringSummary && (
                      <p className="text-xs text-sky-600 mt-1 font-medium">{cp.policy.netMeteringSummary}</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ── SREC Placeholder (if state supports but not in SREC_STATES block above) ── */}
            {cp.policy.srecAvailable && !SREC_STATES.has((projectStateCode || '').toUpperCase()) && (
              <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <span className="text-base">📊</span>
                  <div>
                    <div className="font-bold text-amber-800 text-sm">
                      Solar Renewable Energy Credits (SRECs) — {projectStateCode}
                    </div>
                    <p className="text-xs text-slate-600 mt-0.5">
                      {cp.policy.srecSummary || `Your state has an active SREC market. For every 1,000 kWh your system produces, you earn one SREC that can be sold to utilities required to meet renewable energy standards — creating an additional income stream beyond electricity savings.`}
                    </p>
                    <p className="text-xs text-amber-600 mt-1">
                      Estimated value: ~${cp.policy.srecPricePerMwh}/MWh · Consult your installer for current market rates.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* ── Incentives Not Included Notice ── */}
            {!cp.policy.incentivesAllowed && (
              <div className="mt-4 bg-slate-50 border border-slate-200 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <span className="text-base">ℹ️</span>
                  <div>
                    <div className="font-bold text-slate-700 text-sm">Incentives Not Included in This Proposal</div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {cp.policy.policyMessage || 'Incentive programs for this location are currently at-risk or unavailable. Your savings are calculated conservatively based on energy production value only — no incentive assumptions are included.'}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ════════════════════════════════════════
              6. EQUIPMENT (ENHANCED)
          ════════════════════════════════════════ */}
          {layout && (
            <div className="px-5 py-3 md:px-6 border-b border-slate-100 proposal-sec bg-slate-50" data-block-id="equipment">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center">
                  <Shield size={16} className="text-blue-600" />
                </div>
                <h2 className="text-lg font-black text-slate-900">Equipment Built to Last</h2>
              </div>
              <p className="text-sm text-slate-500 mb-3 ml-10">
                25-Year Performance Warranty · Tier 1 high-efficiency panels · Engineered for local weather conditions
              </p>

              <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5 mb-5">
                <div className="grid grid-cols-3 gap-4 text-center">
                  {[
                    { icon: '🛡️', title: '25-Year Warranty', sub: 'Performance guaranteed' },
                    { icon: '⚡', title: 'Tier 1 Panels', sub: 'Top-rated efficiency' },
                    { icon: '🌦️', title: 'Weather Ready', sub: 'Engineered for your climate' },
                  ].map(item => (
                    <div key={item.title}>
                      <div className="text-2xl mb-1">{item.icon}</div>
                      <div className="font-bold text-blue-800 text-sm">{item.title}</div>
                      <div className="text-xs text-slate-500">{item.sub}</div>
                    </div>
                  ))}
                </div>
              </div>

                          </div>
          )}


          {/* 6b. TRUST LAYER — BUILT FOR LONG-TERM PERFORMANCE */}
          <div className="px-5 py-3 md:px-6 border-b border-slate-100 proposal-sec" data-block-id="trust-performance" data-keep-together="true">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center">
                <Shield size={16} className="text-blue-600" />
              </div>
              <h2 className="text-lg font-black text-slate-900">Built for Long-Term Performance</h2>
            </div>
            <p className="text-sm text-slate-500 mb-3 ml-10">
              Every component is selected and engineered specifically for {projectStateCode === 'IL' ? 'Illinois climate conditions — including freeze-thaw cycles, heavy snow loads, and summer heat' : 'your local climate conditions — built to perform through whatever weather comes'}.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-5">
              <div className="bg-amber-50 border-t-4 border-amber-400 rounded-2xl p-5 text-center shadow-sm">
                <div className="text-4xl mb-3">🛡️</div>
                <div className="font-black text-amber-800 text-lg mb-1">25-Year Warranty</div>
                <div className="text-sm text-slate-600 leading-relaxed">Full performance guarantee on panels, inverters, and mounting hardware. If anything underperforms, it’s covered.</div>
              </div>
              <div className="bg-blue-50 border-t-4 border-blue-400 rounded-2xl p-5 text-center shadow-sm">
                <div className="text-4xl mb-3">⭐</div>
                <div className="font-black text-blue-800 text-lg mb-1">Tier 1 Equipment</div>
                <div className="text-sm text-slate-600 leading-relaxed">Only Bloomberg NEF Tier 1 panels — independently rated for financial stability, manufacturing quality, and field performance.</div>
              </div>
              <div className="bg-emerald-50 border-t-4 border-emerald-400 rounded-2xl p-5 text-center shadow-sm">
                <div className="text-4xl mb-3">🌤️</div>
                <div className="font-black text-emerald-800 text-lg mb-1">Local Climate Engineering</div>
                <div className="text-sm text-slate-600 leading-relaxed">
                  {projectStateCode === 'IL'
                    ? 'Designed specifically for Illinois: optimized for Midwest sun angles, rated for snow loads, and built to handle temperature extremes.'
                    : 'System design accounts for your local sun angle, weather patterns, and seasonal production variability.'}
                </div>
              </div>
            </div>

            <div className="bg-slate-900 rounded-2xl p-5 grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
              {[
                { label: 'Panel Warranty', value: '25 Years', sub: 'Performance guaranteed' },
                { label: 'Inverter Warranty', value: '12–25 Yrs', sub: 'Brand dependent' },
                { label: 'Racking Warranty', value: '25 Years', sub: 'Structural & finish' },
                { label: 'Annual Degradation', value: '<0.5%', sub: 'Industry leading' },
              ].map(item => (
                <div key={item.label}>
                  <div className="font-black text-amber-400 text-xl mb-0.5">{item.value}</div>
                  <div className="text-white text-xs font-semibold">{item.label}</div>
                  <div className="text-slate-500 text-xs">{item.sub}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ════════════════════════════════════════
              6c. WHY THIS SYSTEM WAS DESIGNED THIS WAY
          ════════════════════════════════════════ */}
          <div className="px-5 py-3 md:px-6 border-b border-slate-100 proposal-sec" data-block-id="why-this-system">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center">
                <Zap size={16} className="text-indigo-600" />
              </div>
              <h2 className="text-lg font-black text-slate-900">Why This System Was Designed This Way</h2>
            </div>
            <p className="text-sm text-slate-500 mb-3 ml-10">
              Every decision in this system design has a reason — here is the logic behind it.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">

              {/* Offset Reasoning */}
              <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-2xl">⚡</span>
                  <div className="font-black text-indigo-800 text-sm uppercase tracking-wide">Offset Reasoning</div>
                </div>
                {cp.offset.percentage >= 100 ? (
                  <p className="text-sm text-slate-700 leading-relaxed">
                    This system is sized to offset <strong>100% of your annual usage</strong> ({cp.utility.annualUsageKwh.toLocaleString()} kWh/yr).
                    Full offset maximizes long-term savings and eliminates your utility bill after payoff.
                  </p>
                ) : (
                  <p className="text-sm text-slate-700 leading-relaxed">
                    This system is sized to offset <strong>{cp.offset.percentage}% of your annual usage</strong> ({cp.utility.annualUsageKwh.toLocaleString()} kWh/yr).
                    The remaining {cp.offset.remainingPercentage}% reflects {cp.offset.percentage < 70 ? 'available space or shading constraints at your property' : 'site-specific limitations — the system captures the maximum viable production for your property'}.
                  </p>
                )}
              </div>

              {/* System Type Reasoning */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-2xl">{systemType === 'fence' ? '🌿' : systemType === 'ground' ? '🌱' : systemType === 'carport' ? '🅿️' : '🏠'}</span>
                  <div className="font-black text-slate-700 text-sm uppercase tracking-wide">System Type</div>
                </div>
                <p className="text-sm text-slate-700 leading-relaxed">
                  {systemType === 'fence'
                    ? <><strong>SOL Fence</strong> — generates power at ground level using bifacial panels that capture light from both sides. No roof dependency. Adds privacy and security while producing clean energy.</>
                    : systemType === 'ground'
                    ? <><strong>Ground-mount</strong> — maximizes panel orientation and avoids roof constraints. Allows optimal tilt and azimuth alignment for your location.</>
                    : systemType === 'carport'
                    ? <><strong>Carport system</strong> — uses overhead canopy space, generating power while providing covered parking. No roof modification required.</>
                    : <><strong>Roof-mount</strong> — most cost-effective and minimally invasive option. Panel placement optimized for maximum sun exposure based on your roof geometry and orientation.</>
                  }
                </p>
              </div>

              {/* Constraints */}
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-2xl">📐</span>
                  <div className="font-black text-amber-800 text-sm uppercase tracking-wide">Design Constraints</div>
                </div>
                <div className="space-y-2 text-sm text-slate-700">
                  <div className="flex items-start gap-2">
                    <span className="text-amber-500 font-bold mt-0.5">→</span>
                    <span><strong>{cp.panel.count} panels × {cp.panel.wattage}W</strong> = {cp.panel.systemSizeKw.toFixed(2)} kW{cp.panel.bifacial ? ' (bifacial)' : ''}</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-amber-500 font-bold mt-0.5">→</span>
                    <span>Sized to {cp.offset.percentage < 100 ? `${cp.offset.percentage}% offset — limited by available install area` : 'full offset — sized to match your usage'}</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-amber-500 font-bold mt-0.5">→</span>
                    <span>Degradation modeled at {systemType === 'fence' ? '0.4' : '0.5'}%/yr</span>
                  </div>
                  {cp._meta.payoffYear && (
                    <div className="flex items-start gap-2">
                      <span className="text-emerald-500 font-bold mt-0.5">✓</span>
                      <span>Projected payoff in Year {cp._meta.payoffYear} — within the panel warranty period</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ════════════════════════════════════════
              7. SYSTEM LAYOUT PREVIEW
          ════════════════════════════════════════ */}
          <div className="px-5 py-3 md:px-6 border-b border-slate-100 proposal-sec" data-block-id="layout-preview" data-keep-together="true">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center">
                <Home size={16} className="text-indigo-600" />
              </div>
              <div>
                <h2 className="text-lg font-black text-slate-900">Your System Design</h2>
                <div className="inline-flex items-center gap-1 ml-0 mt-0.5">
                  <span className="inline-block px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold">SITE-SPECIFIC</span>
                </div>
              </div>
            </div>
            <div className="mb-5 bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3 text-sm text-indigo-800 leading-relaxed">
              <strong>Digitally modeled for your property:</strong> Your system is digitally modeled on your exact home using satellite data and 3D design tools — ensuring accurate placement, production, and aesthetics. Final engineering is completed after site verification before installation.
            </div>

            {/* Multi-array visual layout for hybrid/multi-type systems */}
            {isHybridSystem && (() => {
              const displayArrays2 = (storedArrayBreakdown ?? derivedArrays.map(a => ({
                id: a.id, type: a.type, label: a.label ?? a.type,
                panelCount: a.panelCount, arraySizeKw: a.arraySizeKw, annualKwh: a.annualKwh,
              })));
              if (!displayArrays2 || displayArrays2.length < 2) return null;
              const MOUNT_STYLES: Record<string, { bg: string; border: string; panel: string; label: string }> = {
                roof:    { bg: 'from-blue-50 to-blue-100',    border: 'border-blue-200',    panel: 'bg-blue-500',    label: 'Roof' },
                ground:  { bg: 'from-emerald-50 to-green-100', border: 'border-emerald-200', panel: 'bg-emerald-500', label: 'Ground' },
                fence:   { bg: 'from-amber-50 to-yellow-100', border: 'border-amber-200',    panel: 'bg-amber-500',   label: 'SOL Fence' },
                carport: { bg: 'from-purple-50 to-violet-100', border: 'border-purple-200', panel: 'bg-purple-500',  label: 'Carport' },
              };
              return (
                <div className="mb-6">
                  <div className="text-sm font-bold text-slate-700 mb-3">Array Layout by Mount Type</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {displayArrays2.map((arr: any) => {
                      const style = MOUNT_STYLES[arr.type] ?? MOUNT_STYLES.roof;
                      const cols = Math.min(Math.ceil(Math.sqrt(arr.panelCount * 1.5)), 12);
                      return (
                        <div key={arr.id} className={`rounded-xl border ${style.border} bg-gradient-to-br ${style.bg} p-4`}>
                          <div className="flex items-center justify-between mb-3">
                            <span className="font-bold text-sm text-slate-800">{arr.label}</span>
                            <span className="text-xs text-slate-500">{arr.panelCount} panels &bull; {arr.arraySizeKw.toFixed(2)} kW</span>
                          </div>
                          <div
                            className="grid gap-0.5"
                            style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
                          >
                            {Array.from({ length: Math.min(arr.panelCount, 80) }).map((_: unknown, idx: number) => (
                              <div
                                key={idx}
                                className={`${style.panel} rounded-sm opacity-80`}
                                style={{ aspectRatio: arr.type === 'fence' ? '0.45/1' : '1/1.6', minWidth: 0 }}
                              />
                            ))}
                            {arr.panelCount > 80 && (
                              <div className="col-span-full text-center text-xs text-slate-500 mt-1">
                                +{arr.panelCount - 80} more panels
                              </div>
                            )}
                          </div>
                          <div className="mt-2 text-xs text-slate-600 font-medium">
                            {arr.annualKwh.toLocaleString()} kWh/yr estimated
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Design: satellite image of property OR custom engineering card */}
            {(() => {
              // Build a Google Maps Static API satellite URL from client lat/lng
              const hasCoords = clientLat && clientLng && !(clientLat === 33.4484 && clientLng === -112.074);
              const satelliteUrl = hasCoords
                ? `https://maps.googleapis.com/maps/api/staticmap?center=${clientLat},${clientLng}&zoom=19&size=800x400&maptype=satellite&key=AIzaSyD-dummy-key-placeholder`
                : null;

              // System stats badge row (always shown)
              const statsRow = (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                  {[
                    { label: 'Total Panels', value: `${totalPanelsForGrid > 0 ? totalPanelsForGrid : '—'}`, icon: '☀️', color: 'bg-amber-50 border-amber-200 text-amber-700' },
                    { label: 'System Size', value: `${systemSizeKw.toFixed(1)} kW`, icon: '⚡', color: 'bg-blue-50 border-blue-200 text-blue-700' },
                    { label: 'System Type', value: multiArraySystemLabel, icon: '🏠', color: 'bg-indigo-50 border-indigo-200 text-indigo-700' },
                    { label: 'Tilt', value: racking.tiltRange || 'Optimized', icon: '📐', color: 'bg-slate-50 border-slate-200 text-slate-700' },
                  ].map(item => (
                    <div key={item.label} className={`rounded-xl p-3 border text-center ${item.color}`}>
                      <div className="text-xl mb-1">{item.icon}</div>
                      <div className="font-black text-lg">{item.value}</div>
                      <div className="text-xs opacity-70">{item.label}</div>
                    </div>
                  ))}
                </div>
              );

              return (
                <div className="bg-white border-2 border-indigo-200 rounded-2xl p-6">
                  {statsRow}

                  {/* Property image: satellite if coords available, else custom engineering card */}
                  {hasCoords ? (
                    <div className="rounded-2xl overflow-hidden border-2 border-slate-300 mb-3 relative">
                      <img
                        src={`https://maps.googleapis.com/maps/api/staticmap?center=${clientLat},${clientLng}&zoom=19&size=800x400&maptype=satellite&key=AIzaSyD-dummy-key-placeholder`}
                        alt="Satellite view of your property"
                        className="w-full object-cover"
                        style={{ height: '220px' }}
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-900/60 to-transparent pointer-events-none" />
                      <div className="absolute bottom-3 left-3 right-3 text-white text-xs font-bold">
                        📍 Your Property — system designed specifically for this site
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-2xl border-2 border-dashed border-indigo-200 bg-indigo-50/50 p-8 text-center mb-3">
                      <div className="text-4xl mb-3">🛰️</div>
                      <div className="font-black text-indigo-800 text-base mb-1">Site-Specific Design</div>
                      <div className="text-sm text-slate-500 max-w-sm mx-auto">
                        Satellite imagery and 3D roof modeling will be used to finalize panel placement for your exact property.
                      </div>
                    </div>
                  )}

                  {/* Custom engineering badge */}
                  <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 text-center">
                    <div className="inline-flex items-center gap-2 bg-indigo-600 text-white text-xs font-black px-3 py-1 rounded-full mb-2">
                      ✅ Custom Engineered for Your Property
                    </div>
                    <div className="text-sm text-slate-700 leading-relaxed">
                      This system is designed specifically for your home. Final panel placement is optimized after site verification using 3D modeling and shading analysis.
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* ════════════════════════════════════════
              8. SOL FENCE ADD-ON (CONDITIONAL)
          ════════════════════════════════════════ */}
          {(systemType === 'fence' || systemType === 'roof' || systemType === 'ground' || (proj?.name || '').toLowerCase().includes('fence') || (proj?.name || '').toLowerCase().includes('sol fence') || (totalPanelsForGrid > 0 && totalPanelsForGrid < 16)) && (
            <div className="px-5 py-3 md:px-6 border-b border-slate-100 proposal-sec" data-block-id="sol-fence" data-keep-together="true">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center">
                  <Fence size={16} className="text-amber-600" />
                </div>
                <h2 className="text-lg font-black text-slate-900">Unlock Additional Power From Your Property</h2>
                <div className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 border border-amber-300 text-amber-700 text-xs font-bold">
                  Advanced System Expansion Option
                </div>
              </div>
              <p className="text-sm text-slate-600 mb-5 ml-10 leading-relaxed">
                Most systems are limited by roof space. This option allows you to generate more power using unused property areas — giving you an advantage most homeowners don’t have access to.
              </p>

              <div className="bg-amber-50 border border-amber-300 rounded-2xl p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-400/30 text-amber-700 text-xs font-bold mb-3">
                      <Fence size={11} /> SOL Fence — Property-Line Power
                    </div>
                    <p className="text-sm text-slate-700 leading-relaxed mb-3">
                      Your roof isn’t your only solar real estate. The <strong>SOL Fence system</strong> turns your property line into a clean energy source — generating power at ground level without any dependency on roof space, orientation, or shading.
                    </p>
                    <p className="text-sm text-slate-600 leading-relaxed mb-4">
                      Built with high-efficiency <strong>bifacial panels</strong> that capture light from both sides, SOL Fence reduces your reliance on the roof-mounted system and diversifies your production across your entire property.
                    </p>
                    <div className="space-y-2">
                      {[
                        { icon: '⚡', text: 'Generates power at ground level — no roof required' },
                        { icon: '🔒', text: 'Adds privacy & security to your property' },
                        { icon: '🌿', text: 'Uses bifacial panels — captures reflected light too' },
                        { icon: '🏡', text: 'Enhances property value and curb appeal' },
                      ].map(item => (
                        <div key={item.text} className="flex items-start gap-2 text-sm">
                          <span>{item.icon}</span>
                          <span className="text-slate-600">{item.text}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-col justify-center items-center text-center bg-white/60 rounded-xl border border-amber-200 p-6">
                    <div className="text-4xl mb-3">🌞</div>
                    <div className="font-black text-amber-700 text-lg mb-2">SOL Fence</div>
                    <div className="text-sm text-slate-600 mb-4">Power + Privacy + Security</div>
                    <div className="bg-amber-500 text-white font-bold text-sm px-5 py-2.5 rounded-xl mb-2">
                      Expand Your System with SOL Fence
                    </div>
                    <div className="text-xs text-amber-700">
                      Programs may change — lock in your expanded system now
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ════════════════════════════════════════
              9. FINANCIAL SUMMARY
          ════════════════════════════════════════ */}
          {cost && (
            <div className="px-5 py-3 md:px-6 border-b border-slate-100 proposal-sec" data-block-id="financial-summary" data-keep-together="true">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 rounded-lg bg-green-50 border border-green-100 flex items-center justify-center">
                  <DollarSign size={16} className="text-green-600" />
                </div>
                <h2 className="text-lg font-black text-slate-900">Financial Summary</h2>
                {/* v47.183 Cash vs Finance toggle */}
                {financeMonthlyPayment > 0 && (
                  <div className="ml-auto flex items-center gap-1 bg-slate-100 rounded-xl p-1 no-print">
                    <button
                      onClick={() => setPurchaseMode('finance')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${purchaseMode === 'finance' ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      Financing
                    </button>
                    <button
                      onClick={() => setPurchaseMode('cash')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${purchaseMode === 'cash' ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      Cash Purchase
                    </button>
                  </div>
                )}
              </div>
              {/* Mode context banner */}
              {financeMonthlyPayment > 0 && (
                <div className={`mb-5 rounded-xl px-4 py-3 text-sm ${purchaseMode === 'cash' ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' : paymentExceedsBill ? 'bg-amber-50 border border-amber-200 text-amber-800' : 'bg-blue-50 border border-blue-200 text-blue-800'}`}>
                  {purchaseMode === 'cash' ? (
                    <>
                      <strong>💵 Cash Purchase:</strong> You own the system outright from day one. Immediate energy savings start immediately — no monthly payment, maximum long-term value.
                    </>
                  ) : paymentExceedsBill ? (
                    <>
                      <strong>📊 Financing Note:</strong> Your estimated solar payment (${financeMonthlyPayment}/mo) is initially higher than your current utility bill (${avgMonthlyBillBefore}/mo). Your payment is <strong>fixed</strong> while utility rates rise ~3%/year. Long-term savings build over time.
                    </>
                  ) : (
                    <>
                      <strong>✅ Financing:</strong> Your estimated solar payment (${financeMonthlyPayment}/mo) is comparable to your current bill. You start offsetting costs immediately while building equity in an asset you own.
                    </>
                  )}
                </div>
              )}

              {/* Social proof line */}
              {financeMonthlyPayment > 0 && (
                <div className="mb-5 text-center text-xs text-slate-500 italic">
                  Most homeowners in similar situations choose this option to lock in predictable costs and protect against rising utility rates.
                </div>
              )}

              {/* Sales Override Panel (internal only) */}
              <div className="no-print mb-5" style={{ display: showOverrides ? undefined : 'none' }}>
                <div className="bg-slate-100 border border-slate-200 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Settings size={14} className="text-slate-500" />
                    <span className="text-sm font-bold text-slate-700">Sales Rep Pricing Controls</span>
                    <button onClick={() => setShowOverrides(false)} className="ml-auto text-xs text-blue-600">Hide</button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1"><Tag size={11} className="inline mr-1" />Override Price Per Watt</label>
                      <input type="number" step="0.05" min="1" max="10"
                        placeholder={`Default: $${(cost?.pricePerWatt ?? 3.10).toFixed(2)}/W`}
                        value={overridePpw}
                        onChange={e => { setOverridePpw(e.target.value); if (e.target.value && systemSizeW > 0) setOverrideFinal(String(Math.round(parseFloat(e.target.value) * systemSizeW))); }}
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1"><Percent size={11} className="inline mr-1" />Override Margin %</label>
                      <input type="number" step="1" min="0" max="80" placeholder="Default: 40%"
                        value={overrideMargin} onChange={e => setOverrideMargin(e.target.value)}
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1"><DollarSign size={11} className="inline mr-1" />Override Final Price ($)</label>
                      <input type="number" step="100" min="0"
                        placeholder={`Default: $${baseCashPrice.toLocaleString()}`}
                        value={overrideFinal}
                        onChange={e => { setOverrideFinal(e.target.value); if (e.target.value && systemSizeW > 0) setOverridePpw(String((parseFloat(e.target.value) / systemSizeW).toFixed(2))); }}
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    {cost?.internalProfit !== undefined && (
                      <div className="md:col-span-3 bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-4 gap-4 text-center">
                        <div><div className="text-xs text-slate-400 mb-1">Revenue</div><div className="font-black text-slate-800">${effectiveFinal.toLocaleString()}</div></div>
                        <div><div className="text-xs text-slate-400 mb-1">Est. Cost</div><div className="font-black text-slate-800">${(cost?.internalCost ?? cost?.estimatedCost ?? 0).toLocaleString()}</div></div>
                        <div><div className="text-xs text-slate-400 mb-1">Gross Profit</div><div className={`font-black ${(effectiveFinal - (cost?.internalCost ?? 0)) > 0 ? 'text-emerald-600' : 'text-red-600'}`}>${(effectiveFinal - (cost?.internalCost ?? cost?.estimatedCost ?? 0)).toLocaleString()}</div></div>
                        <div><div className="text-xs text-slate-400 mb-1">Margin %</div><div className={`font-black ${(effectiveFinal - (cost?.internalCost ?? 0)) / effectiveFinal * 100 > 20 ? 'text-emerald-600' : 'text-amber-600'}`}>{effectiveFinal > 0 ? (((effectiveFinal - (cost?.internalCost ?? cost?.estimatedCost ?? 0)) / effectiveFinal) * 100).toFixed(1) : '0'}%</div></div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Key summary cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="border border-slate-200 rounded-2xl p-4 text-center">
                  <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">System Investment</div>
                  <div className="text-3xl font-black text-slate-900">${effectiveFinal.toLocaleString()}</div>
                  <div className="text-xs text-slate-400 mt-1">{itcRate > 0 ? 'before incentives' : 'total system cost'}</div>
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 text-center">
                  <div className="text-xs font-bold text-blue-600 uppercase tracking-wide mb-1">Price Per Watt</div>
                  <div className="text-2xl font-black text-blue-700">${effectivePpw.toFixed(2)}/W</div>
                  <div className="text-xs text-blue-500 mt-1">{systemSizeKw.toFixed(1)} kW system</div>
                </div>
                <div className={`rounded-2xl p-4 text-center border ${paymentExceedsBill ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'}`}>
                  <div className={`text-xs font-semibold uppercase tracking-wide mb-1 ${paymentExceedsBill ? 'text-amber-500' : 'text-emerald-600'}`}>
                    Monthly Energy Value Produced
                  </div>
                  <div className={`text-xl font-bold ${paymentExceedsBill ? 'text-amber-700' : 'text-emerald-700'}`}>
                    ${energySavingsOnly > 0 ? Math.round(energySavingsOnly / 12).toLocaleString() : '—'}/mo
                  </div>
                  <div className={`text-xs mt-1 leading-relaxed ${paymentExceedsBill ? 'text-amber-500' : 'text-emerald-500'}`}>
                    Your system generates this in electricity — reducing power you need to buy from the utility.
                  </div>
                </div>
                <div className="bg-purple-50 border border-purple-200 rounded-2xl p-4 text-center">
                  <div className="text-xs font-semibold text-purple-600 uppercase tracking-wide mb-1">Estimated Long-Term Value</div>
                  <div className="text-xl font-bold text-purple-700">${netSavings25yr > 0 ? netSavings25yr.toLocaleString() : '—'}</div>
                  <div className="text-xs text-purple-500 mt-1">25-yr net savings (cash)</div>
                </div>
              </div>

              {/* Itemized breakdown */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h4 className="font-bold text-slate-700 text-sm mb-3">Investment Breakdown</h4>
                  <div className="space-y-2">
                    {cost?.lineItems && cost.lineItems.length > 0 ? (
                      <>
                        {cost.lineItems.map((item: any) => (
                          <div key={item.type} className="py-2 border-b border-slate-100">
                            <div className="flex justify-between text-sm">
                              <span className="font-semibold text-slate-700">{item.label}</span>
                              <span className="font-bold text-slate-900">${item.subtotal.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between text-xs text-slate-400 mt-0.5">
                              <span>{item.panelCount} panels × ${item.pricePerPanel.toLocaleString()}/panel</span>
                              <span>${(item.pricePerPanel / (pricingCfg?.defaultPanelWattage ?? 440)).toFixed(2)}/W</span>
                            </div>
                          </div>
                        ))}
                        {cost.fixedCosts > 0 && (
                          <div className="flex justify-between text-sm py-2 border-b border-slate-100">
                            <span className="text-slate-500">Fixed Project Cost</span>
                            <span className="font-medium text-slate-700">${cost.fixedCosts.toLocaleString()}</span>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="py-2 border-b border-slate-100">
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-600">System Installation ({systemSizeKw.toFixed(1)} kW)</span>
                          <span className="font-medium text-slate-900">${effectiveFinal.toLocaleString()}</span>
                        </div>
                      </div>
                    )}
                    <div className="flex justify-between text-sm font-bold py-2 border-b border-slate-200">
                      <span>Total Cash Price</span>
                      <span>${effectiveFinal.toLocaleString()}</span>
                    </div>
                    {/* ITC line — only shown when client qualifies (itcRate > 0) */}
                    {itcRate > 0 && (
                      <div className="flex justify-between text-sm py-2 border-b border-slate-100">
                        <span className="text-slate-500">{isCommercial ? 'Commercial' : 'Federal'} ITC ({itcRate}%)</span>
                        <span className="text-emerald-600 font-bold">-${itcAmount.toLocaleString()}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-base font-black py-3 bg-amber-50 rounded-xl px-3 border border-amber-200 mt-2">
                      <span>{itcRate > 0 ? 'Net Investment' : 'Total Investment'}</span>
                      <span className="text-amber-700">${effectiveNet.toLocaleString()}</span>
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="font-bold text-slate-700 text-sm mb-3">Return on Investment</h4>
                  <div className="space-y-3">
                    {/* Energy savings only — never includes SREC */}
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                      <div className="text-center mb-2">
                        <div className="text-5xl font-black text-emerald-700">${energySavingsOnly.toLocaleString()}</div>
                        <div className="text-sm text-emerald-600 font-medium">Annual Energy Savings</div>
                        <div className="text-xs text-slate-400 mt-1">electricity offset only ({energyOffset}% of usage)</div>
                      </div>
                      {srecAnnualIncome > 0 && (
                        <div className="mt-2 pt-2 border-t border-emerald-100 flex items-center justify-between text-sm">
                          <span className="text-slate-500">+ {projectStateCode} program income</span>
                          <span className="font-bold text-amber-600">+${srecAnnualIncome.toLocaleString()}/yr est.</span>
                        </div>
                      )}
                    </div>
                    {/* Two payback values — reduced visual weight per UX guidelines */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center">
                        <div className="text-lg font-bold text-slate-600">{basePaybackYears} yrs</div>
                        <div className="text-xs text-slate-500">base payoff</div>
                        <div className="text-xs text-slate-400 mt-0.5">energy savings only</div>
                      </div>
                      {/* Second payback cell — only shown when state incentives reduce payback */}
                      {adjustedPaybackYears < basePaybackYears && (
                      <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center">
                        <div className="text-lg font-bold text-slate-600">
                          {adjustedPaybackYears} yrs
                        </div>
                        <div className="text-xs text-slate-500">w/ incentives</div>
                        <div className="text-xs text-slate-400 mt-0.5">incl. state programs</div>
                      </div>
                      )}
                    </div>
                    {/* Monthly impact — increased emphasis */}
                    {financeMonthlyPayment > 0 && (
                      <div className={`rounded-xl p-3 text-center border-2 ${paymentExceedsBill ? 'bg-amber-50 border-amber-300' : 'bg-emerald-50 border-emerald-300'}`}>
                        <div className={`text-xs font-bold uppercase tracking-wide mb-1 ${paymentExceedsBill ? 'text-amber-600' : 'text-emerald-600'}`}>
                          Monthly Net Impact
                        </div>
                        <div className={`text-2xl font-black ${paymentExceedsBill ? 'text-amber-700' : 'text-emerald-700'}`}>
                          {monthlyNetImpact >= 0 ? '−' : '+'} ${Math.abs(monthlyNetImpact)}/mo
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {paymentExceedsBill ? 'initially higher, gap closes as rates rise' : 'vs. current utility bill'}
                        </div>
                        <div className="mt-2 pt-2 border-t border-current/10 text-xs text-slate-500 leading-relaxed italic">
                          This is your investment into ownership — replacing a bill that never ends with an asset you control.
                        </div>
                      </div>
                    )}
                    <div className="bg-slate-900 rounded-xl p-4 text-center border border-amber-500/20">
                      <div className="text-xs text-amber-400 font-bold uppercase tracking-wide mb-1">Long-Term Outcome</div>
                      <div className="text-xl font-black text-amber-400">${netSavings25yr.toLocaleString()}</div>
                      <div className="text-sm text-white font-semibold mt-0.5">25-Year Net Savings</div>
                      <div className="text-xs text-slate-400 mt-1">{energyOffset >= 100 ? 'After payoff, your electricity cost is essentially eliminated — this system fully offsets your usage.' : `After payoff, this system offsets ${energyOffset}% of your usage — remaining grid cost is significantly reduced.`}</div>
                      {srecAnnualIncome > 0 && (
                        <div className="mt-2 pt-2 border-t border-slate-700 text-xs text-amber-300">
                          + ${(srecAnnualIncome * 15).toLocaleString()} est. {projectStateCode} program income (separate)
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ════════════════════════════════════════
              10. NEXT STEPS (REWRITTEN WITH URGENCY)
          ════════════════════════════════════════ */}
          <div className="px-5 py-3 md:px-6 border-b border-slate-100 proposal-sec bg-indigo-50" data-block-id="next-steps">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center">
                <ChevronRight size={16} className="text-blue-600" />
              </div>
              <h2 className="text-lg font-black text-slate-900">Your Path to Energy Ownership</h2>
            </div>
            <p className="text-sm text-slate-500 mb-3 ml-10">
              Energy rates continue to rise — locking in now protects your future costs.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              {[
                {
                  step: '1',
                  title: 'Lock In Your System',
                  desc: 'Approve this proposal to secure your pricing and place in the installation queue.',
                  icon: <Lock size={18} className="text-amber-500" />,
                  color: 'border-amber-200 bg-amber-50',
                },
                {
                  step: '2',
                  title: 'Finalize System Design',
                  desc: 'Our engineers complete your custom 3D roof design and panel placement plan.',
                  icon: <Home size={18} className="text-blue-500" />,
                  color: 'border-blue-200 bg-blue-50',
                },
                {
                  step: '3',
                  title: 'Confirm Site & Schedule',
                  desc: 'We confirm measurements on-site and lock in your installation date.',
                  icon: <MapPin size={18} className="text-emerald-500" />,
                  color: 'border-emerald-200 bg-emerald-50',
                },
                {
                  step: '4',
                  title: 'Installation & Go Live',
                  desc: 'Certified team installs your system. You start saving from day one.',
                  icon: <Zap size={18} className="text-purple-500" />,
                  color: 'border-purple-200 bg-purple-50',
                },
              ].map(item => (
                <div key={item.step} className={`rounded-xl p-4 border ${item.color} relative`}>
                  <div className="absolute -top-2 -left-2 w-7 h-7 rounded-full bg-slate-800 text-white font-black text-xs flex items-center justify-center shadow">
                    {item.step}
                  </div>
                  <div className="mb-2 mt-1">{item.icon}</div>
                  <h4 className="font-bold text-slate-900 text-sm mb-1">{item.title}</h4>
                  <p className="text-xs text-slate-500 leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>

            {/* Urgency banner */}
            <div className="bg-amber-500 rounded-2xl p-5 text-white text-center">
              <div className="font-black text-xl mb-1">⚡ Energy Rates Rise Every Year</div>
              <div className="text-sm font-medium opacity-90">
                Every month you wait is another month paying the utility. Lock in your system now and start owning your energy.
              </div>
            </div>
          </div>

          {/* 10b. DECISION SIMPLIFIER — YOUR TWO OPTIONS */}
          <div className="px-5 py-3 md:px-6 border-b border-slate-100 proposal-sec" data-block-id="why-customers-choose">
            <div className="text-center mb-6">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 border border-slate-200 text-slate-600 text-xs font-bold mb-3">
                <ChevronRight size={11} /> The Decision
              </div>
              <p className="text-sm text-red-600 font-semibold mb-2">
                Every month you delay, you continue paying into a system you will never own.
              </p>
              <h2 className="text-3xl font-black text-slate-900">Your Two Options</h2>
              <p className="text-sm text-slate-500 mt-2">Every month, you’re choosing one of these two paths.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div className="bg-red-50 border border-red-200 rounded-2xl p-6">
                <div className="text-center mb-3">
                  <div className="font-black text-red-800 text-2xl">Keep Paying the Utility</div>
                  <div className="text-sm text-red-600 font-medium mt-1">The default path</div>
                </div>
                <div className="space-y-3">
                  <div className="space-y-2 text-sm text-slate-700">
                    <div className="flex justify-between py-1 border-b border-red-100">
                      <span className="text-slate-500">Monthly utility bill</span>
                      <span className="font-bold text-red-700">${avgMonthlyBillBefore.toLocaleString()}/mo</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-red-100">
                      <span className="text-slate-500">Rate escalation</span>
                      <span className="font-bold text-red-700">+{Math.round(cp.utility.escalationRate * 100)}%/yr (est.)</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-slate-500">25-year total cost</span>
                      <span className="font-bold text-red-700">${cp.truth25yr.utilityCostWithoutSolar.toLocaleString()}</span>
                    </div>
                  </div>
                </div>
                <div className="mt-4 bg-red-100 rounded-xl p-3 text-center">
                  <div className="font-black text-red-700 text-3xl">
                    ${cp.truth25yr.utilityCostWithoutSolar > 0 ? cp.truth25yr.utilityCostWithoutSolar.toLocaleString() : '—'}
                  </div>
                  <div className="text-xs text-red-600 mt-0.5 font-bold uppercase tracking-wide">Pay forever — own nothing</div>
                </div>
              </div>

              <div className="bg-emerald-50 border border-emerald-400 rounded-2xl p-6 relative">
                <div className="absolute -top-3 right-4 bg-emerald-600 text-white text-xs font-black px-3 py-1 rounded-full">
                  SMART CHOICE
                </div>
                <div className="text-center mb-3">
                  <div className="font-black text-emerald-800 text-2xl">Own Your Power</div>
                  <div className="text-sm text-emerald-600 font-medium mt-1">The ownership path</div>
                </div>
                <div className="space-y-3">
                  <div className="space-y-2 text-sm text-slate-700">
                    <div className="flex justify-between py-1 border-b border-emerald-100">
                      <span className="text-slate-500">Monthly payment</span>
                      <span className="font-bold text-emerald-700">${cp.financial.solarPaymentMonthly > 0 ? cp.financial.solarPaymentMonthly.toLocaleString() : '—'}/mo (fixed)</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-emerald-100">
                      <span className="text-slate-500">Payback period</span>
                      <span className="font-bold text-emerald-700">~{paybackYears} years</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-emerald-100">
                      <span className="text-slate-500">Energy offset</span>
                      <span className="font-bold text-emerald-700">{energyOffset}%</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-slate-500">25-yr net savings</span>
                      <span className="font-bold text-emerald-700">${cp.truth25yr.netDifference > 0 ? Math.round(cp.truth25yr.netDifference).toLocaleString() : '—'}</span>
                    </div>
                  </div>
                </div>
                <div className="mt-4 bg-emerald-100 rounded-xl p-3 text-center">
                  <div className="font-black text-emerald-700 text-3xl">
                    ${netSavings25yr > 0 ? netSavings25yr.toLocaleString() : '—'}
                  </div>
                  <div className="text-xs text-emerald-600 mt-0.5 font-bold uppercase tracking-wide">Own forever — save $${netSavings25yr > 0 ? netSavings25yr.toLocaleString() : '0'}</div>
                </div>
              </div>
            </div>

            <div className="bg-slate-900 rounded-2xl p-5 text-center text-white">
              <div className="font-black text-2xl mb-1">Both paths have a cost. <span className="text-amber-400">One builds equity.</span></div>
              <div className="text-slate-300 text-sm">
                The only real decision is whether you continue renting your power — or start owning it.
                {paymentExceedsBill && (
                  <span className="block mt-2 text-amber-300 text-xs">
                    Note: Your initial solar payment may be slightly higher than your current bill. As utility rates rise ~3%/year, the gap closes — your solar payment never changes.
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* ════════════════════════════════════════
              10c. DECISION SUMMARY — YOUR FINANCIAL OUTCOME
          ════════════════════════════════════════ */}
          <div className="px-5 py-2 md:px-6 border-b border-slate-100 proposal-sec bg-slate-50" data-block-id="decision-summary" data-keep-together="true">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center">
                <DollarSign size={16} className="text-emerald-600" />
              </div>
              <h2 className="text-lg font-black text-slate-900">Your Financial Outcome — The Full Picture</h2>
            </div>

            {/* Narrative block */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 mb-6 shadow-sm">
              <div className="text-xs font-black text-slate-400 uppercase tracking-wide mb-3">Financial Story</div>
              <p className="text-base text-slate-800 leading-relaxed font-medium">
                {cp._meta.narrative.primaryStory}
              </p>
              <p className="text-sm text-slate-600 mt-3 leading-relaxed">
                {cp._meta.narrative.monthlyImpact}
              </p>
              <p className="text-sm text-slate-600 mt-2 leading-relaxed">
                {cp._meta.narrative.payoffStatement}
              </p>
            </div>

            {/* Three-column outcome summary */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">

              {/* Column 1: What you are paying now */}
              <div className="bg-red-50 border border-red-200 rounded-2xl p-5">
                <div className="text-xs font-black text-red-600 uppercase tracking-wide mb-3">What You're Paying Now</div>
                <div className="space-y-2">
                  <div className="flex justify-between items-center py-1 border-b border-red-100">
                    <span className="text-xs text-slate-500">Monthly utility bill</span>
                    <span className="font-bold text-red-700">${cp.financial.currentMonthlyBill.toLocaleString()}/mo</span>
                  </div>
                  <div className="flex justify-between items-center py-1 border-b border-red-100">
                    <span className="text-xs text-slate-500">Rate escalation</span>
                    <span className="font-bold text-red-600">+{Math.round(cp.utility.escalationRate * 100)}%/yr</span>
                  </div>
                  <div className="flex justify-between items-center py-1">
                    <span className="text-xs font-bold text-slate-600">25-yr utility cost</span>
                    <span className="font-black text-red-700 text-xl">${cp.truth25yr.utilityCostWithoutSolar.toLocaleString()}</span>
                  </div>
                </div>
                <div className="mt-3 text-xs text-red-500 italic">Nothing owned at the end.</div>
              </div>

              {/* Column 2: What changes today */}
              <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5">
                <div className="text-xs font-black text-blue-600 uppercase tracking-wide mb-3">What Changes Today</div>
                <div className="space-y-2">
                  {cp.financial.solarPaymentMonthly > 0 && (
                    <div className="flex justify-between items-center py-1 border-b border-blue-100">
                      <span className="text-xs text-slate-500">Solar payment</span>
                      <span className="font-bold text-blue-700">${cp.financial.solarPaymentMonthly.toLocaleString()}/mo (fixed)</span>
                    </div>
                  )}
                  <div className="flex justify-between items-center py-1 border-b border-blue-100">
                    <span className="text-xs text-slate-500">Remaining utility</span>
                    <span className="font-bold text-blue-700">${cp.financial.utilityBillMonthly.toLocaleString()}/mo</span>
                  </div>
                  <div className="flex justify-between items-center py-1 border-b border-blue-100">
                    <span className="text-xs text-slate-500">Energy offset</span>
                    <span className="font-bold text-blue-700">{cp.offset.percentage}%</span>
                  </div>
                  <div className="flex justify-between items-center py-1">
                    <span className="text-xs font-bold text-slate-600">System cost</span>
                    <span className="font-black text-slate-800 text-xl">${cp.financial.systemCost.toLocaleString()}</span>
                  </div>
                </div>
                <div className="mt-3 text-xs text-blue-600 italic">Fixed payment. Ownership from day one.</div>
              </div>

              {/* Column 3: Net outcome */}
              <div className="bg-emerald-50 border border-emerald-300 rounded-2xl p-5 relative">
                <div className="absolute -top-3 right-4 bg-emerald-600 text-white text-xs font-black px-3 py-1 rounded-full">NET OUTCOME</div>
                <div className="text-xs font-black text-emerald-700 uppercase tracking-wide mb-3 mt-1">25-Year Result</div>
                <div className="space-y-2">
                  <div className="flex justify-between items-center py-1 border-b border-emerald-100">
                    <span className="text-xs text-slate-500">Utility cost avoided</span>
                    <span className="font-bold text-emerald-700">${cp.truth25yr.utilityCostWithoutSolar.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-center py-1 border-b border-emerald-100">
                    <span className="text-xs text-slate-500">System cost (total)</span>
                    <span className="font-bold text-slate-700">${(cp.truth25yr.solarCostTotal + cp.truth25yr.remainingUtilityCost).toLocaleString()}</span>
                  </div>
                  {cp._meta.payoffYear && (
                    <div className="flex justify-between items-center py-1 border-b border-emerald-100">
                      <span className="text-xs text-slate-500">Payoff year</span>
                      <span className="font-bold text-indigo-700">Year {cp._meta.payoffYear}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-center py-1">
                    <span className="text-xs font-black text-slate-700">Net savings</span>
                    <span className="font-black text-emerald-700 text-2xl">+${Math.max(0, Math.round(cp.truth25yr.netDifference)).toLocaleString()}</span>
                  </div>
                </div>
                <div className="mt-3 text-xs text-emerald-600 italic font-medium">+ Ownership of your energy production asset.</div>
              </div>
            </div>

            {/* Summary statement */}
            <div className="bg-slate-900 rounded-2xl p-5 text-white">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                <div>
                  <div className="text-xs font-black text-slate-400 uppercase tracking-wide mb-2">The Decision in Plain Numbers</div>
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-red-400 text-sm font-bold">You are currently paying:</span>
                      <span className="text-white font-black text-sm">${cp.financial.currentMonthlyBill.toLocaleString()}/mo → ${cp.truth25yr.utilityCostWithoutSolar.toLocaleString()} over 25 yrs to the utility</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-blue-400 text-sm font-bold">This system:</span>
                      <span className="text-white font-black text-sm">Costs ${cp.financial.systemCost.toLocaleString()} and produces ${Math.round(cp.truth25yr.estimatedEnergyValue).toLocaleString()} in value</span>
                    </div>
                  </div>
                </div>
                <div className="text-center md:text-right">
                  <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">Net outcome</div>
                  <div className="text-4xl font-black text-emerald-400">+${Math.max(0, Math.round(cp.truth25yr.netDifference)).toLocaleString()}</div>
                  <div className="text-slate-300 text-sm mt-1">in savings + ownership of your energy</div>
                </div>
              </div>
            </div>
          </div>

          {/* CTA integrated with decision summary */}
          <div className="relative bg-slate-900 text-white overflow-hidden proposal-sec" data-block-id="cta" data-keep-together="true">


            <div className="relative z-10 p-5 md:p-8 text-center">


              <h2 className="text-3xl md:text-4xl font-black mb-2">
                Your Home Is Ready for<br />
                <span className="text-amber-400">Energy Ownership.</span>
              </h2>
              <p className="text-slate-400 text-sm mb-4 max-w-lg mx-auto">
                Custom-designed for your home. Built on current rates.{' '}
                <strong className="text-amber-300">Waiting increases cost and reduces incentives.</strong>
              </p>

              {/* Urgency notice above CTA */}
              <p className="text-amber-400 text-sm font-bold mb-3 max-w-lg mx-auto">
                Rates and incentives change. This pricing is based on today’s programs.
              </p>

              {/* Trust statement */}
              <p className="text-slate-400 text-xs mb-4 max-w-md mx-auto">
                No obligation. You review and approve the final design before installation.
              </p>

              <div className="text-xl font-bold text-white mb-4">
                You're one decision away from locking this in.
              </div>

              <div className="flex flex-col sm:flex-row gap-3 justify-center mb-4">
                <button className="inline-flex items-center gap-2 px-12 py-5 rounded-2xl font-black text-2xl text-slate-900 hover:opacity-90 transition-opacity" style={{ backgroundColor: branding.brandPrimaryColor || '#f59e0b' }}>
                  <Lock size={20} /> Lock In My System & Pricing
                </button>
                <button className="inline-flex items-center gap-2 px-12 py-5 rounded-2xl font-bold text-xl border-2 border-slate-500 text-white hover:border-slate-300 transition-colors">
                  <Phone size={18} /> Schedule Final Design Review
                </button>
              </div>

              {/* Risk removal line */}
              <div className="mb-4 text-slate-400 text-xs">
                No obligation. Final design is completed before installation.
              </div>

              {/* Contact info */}
              <div className="flex flex-col sm:flex-row items-center justify-center gap-6 text-sm text-slate-400">
                {branding.companyPhone && (
                  <div className="flex items-center gap-2"><Phone size={14} />{branding.companyPhone}</div>
                )}
                {branding.companyWebsite && (
                  <div className="flex items-center gap-2"><ChevronRight size={14} /><a href={branding.companyWebsite} className="hover:text-white transition-colors">{branding.companyWebsite.replace(/^https?:\/\//, '')}</a></div>
                )}
                {branding.companyAddress && (
                  <div className="flex items-center gap-2"><MapPin size={14} />{branding.companyAddress}</div>
                )}
              </div>
            </div>
          </div>

          {/* ── Footer ── */}
          <div className="p-6 text-white text-center text-xs" style={{ background: '#0f172a' }}>
            <div className="flex items-center justify-center gap-3 mb-3">
              {branding.companyLogoUrl ? (
                <img src={branding.companyLogoUrl} alt={branding.companyName} className="h-8 object-contain brightness-0 invert" />
              ) : (
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: branding.brandPrimaryColor }}>
                    <Sun size={16} className="text-slate-900" />
                  </div>
                  <span className="font-black">{branding.companyName}</span>
                </div>
              )}
            </div>
            {branding.proposalFooterText && (
              <p className="text-slate-300 mb-2">{branding.proposalFooterText}</p>
            )}
            <p className="text-slate-500">Production estimates based on NREL PVWatts data. Actual results may vary.{itcRate > 0 ? ' Federal tax credit eligibility subject to individual tax situation. IRA §25D (P.L. 117-169) provides 30% residential ITC through 2032. Consult a qualified tax advisor.' : ''}</p>
            <p className="text-slate-600 mt-1">Prepared by {proposal.preparedBy} · Valid until {new Date(proposal.validUntil).toLocaleDateString()}</p>
          </div>

        </div>
      </div>
    </div>
  );
}



export default function ProposalsPage() {
  return (
    <AppShell>
      <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="spinner w-8 h-8" /></div>}>
        <ProposalContent />
      </Suspense>
    </AppShell>
  );

              {/* ── Equipment Page Break: Warranty ↑ | Specs ↓ ── */}
              <div className="border-t-2 border-slate-200 mt-6 pt-6" style={{ pageBreakBefore: 'always', breakBefore: 'page' }}>
                <div className="text-xs font-black text-slate-500 uppercase tracking-wide mb-4 flex items-center gap-2">
                  <Shield size={12} className="text-blue-600" /> Detailed Equipment Specifications
                </div>
              </div>

}