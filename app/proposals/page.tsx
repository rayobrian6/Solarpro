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
  Square, ChevronDown, SortAsc, AlertTriangle, X, Check,
  Wind, TreePine, Car, ExternalLink, Info,
} from 'lucide-react';
import Link from 'next/link';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from 'recharts';
import { resolveEquipment, getSystemTypeLabel, getSystemDescription } from '@/lib/systemEquipmentResolver';
import { calculateIncentives } from '@/lib/incentives/stateIncentives';
import { buildArraysFromLayout, buildSystemConfig, getArrayProposalText } from '@/lib/multiArrayEngine';
import { useSubscription } from '@/hooks/useSubscription';
import UpgradeModal from '@/components/ui/UpgradeModal';
import { resolveProposalSystemType, getPanelTypeCounts } from '@/lib/proposalSystemType';
import { buildCanonicalProposal } from '@/lib/proposal/buildCanonicalProposal';
import { deriveEcosystemSummary } from '@/lib/proposal/deriveEcosystemSummary';
import {
  buildUtilityProfile,
  validateProposalTruth,
  validatePanelIntegrity,
  getFailsafeMessage,
  calculateRemainingUtility,
} from '@/lib/proposalTruthEngine';
import {
  GLOBAL_INCENTIVES_CONFIG,
  getIncentivesComplianceMessage,
  getIncentivesDebugLabel,
} from '@/lib/incentivesConfig';
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


  // ── Template A variable aliases (dark design unification) ────────────────────────────
  // Maps Template B's existing cp.* values to variable names used in Template A dark JSX.
  // No new calculations — pure aliases only.
  const selectedPanel            = (proj as any)?.selectedPanel ?? null;
  const layoutSystemSizeKw       = _layoutSystemSizeKwHint;
  const totalPanels              = totalPanelsForGrid;
  const annualEnergyValue        = cp.financial.annualEnergyValue;
  const payoffYear               = cp._meta.payoffYear;
  const solar_payment_monthly    = cp.financial.solarPaymentMonthly;
  const remaining_utility_monthly = cp.financial.utilityBillMonthly;
  const total_energy_cost_monthly = cp.financial.totalMonthlyCost;
  const ownership_delta_monthly  = cp.financial.ownershipDeltaMonthly;
  const resolvedPanelWattage     = cp.panel.wattage;
  const utility_cost_25yr        = cp.truth25yr.utilityCostWithoutSolar;
  const solar_cost_total         = cp.truth25yr.solarCostTotal;
  const remaining_utility_cost_total = cp.truth25yr.remainingUtilityCost;
  const estimated_energy_value_25yr  = cp.truth25yr.estimatedEnergyValue;
  const net_financial_difference_25yr = cp.truth25yr.netFinancialDifference;
  const netDifference_25yr       = cp.truth25yr.netDifference;
  const energyValueBreakdown     = cp.financial.energyValueBreakdown;
  const comparisonChartData      = cp.truth25yr.yearlyFlow.map((yr: any) => ({
    year:         yr.year,
    withoutSolar: yr.cumulative_without_solar,
    withSolar:    yr.cumulative_with_solar,
  }));
  const narrative                = cp._meta.narrative;
  const failsafeMessage          = cp.policy.failsafeMessage;
  const utilityProfile = {
    policy_message:       cp.policy.policyMessage,
    net_metering_summary: cp.policy.netMeteringSummary,
    srec_summary:         cp.policy.srecSummary,
    system_design_guidance: cp.utility.netMeteringType !== 'retail_1to1'
      ? 'Design system to maximize self-consumption. Export credits below retail rate.'
      : 'System designed for full retail net metering credit on all exported energy.',
    is_specific_match:    cp.policy.isSpecificUtilityMatch,
    profile: {
      net_metering_type: cp.utility.netMeteringType,
      srec_available:    cp.policy.srecAvailable,
      utility_id:        cp.utility.provider.toLowerCase().replace(/\s+/g, '_'),
      state:             cp.utility.provider,
    },
  };
  const isFenceSystem            = systemType === 'fence';
  const systemDescription        = getSystemDescription(systemType);
  const tooltipStyle             = { background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', fontSize: '12px' };
  const primaryColor             = branding.brandPrimaryColor || '#f59e0b';
  const panelIntegrity           = validatePanelIntegrity({
    panelSpec: selectedPanel ? {
      manufacturer: selectedPanel.manufacturer || '',
      model:        selectedPanel.model || selectedPanel.name || '',
      wattage:      selectedPanel.wattage ?? 0,
      efficiency:   selectedPanel.efficiency ?? undefined,
    } : null,
    panelCount:   totalPanels,
    systemSizeKw: layoutSystemSizeKw,
  });
  // Canonical validation (mirrors Template A)
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  React.useEffect(() => {
    if (!mounted) return;
    if (cp._meta.hasWarnings) {
      console.warn('[CanonicalPipeline][InstallerPreview] Pipeline warnings:', cp._meta.warnings);
    }
    const _yearlyFlow = cp.truth25yr.yearlyFlow ?? [];
    const _year1Export = _yearlyFlow.length > 0 ? _yearlyFlow[0].exported_kwh : undefined;
    const _validation = validateProposalTruth({
      effectiveFinal,
      annualEnergyValue,
      paybackYears:              payoffYear ?? 0,
      estimatedEnergyValue25yr:  estimated_energy_value_25yr,
      annualProductionKwh:       annualProduction,
      utilityRate,
      energyOffset,
      annualUsageKwh:            annualUsage,
      financeMonthlyPayment,
      remainingUtilityMonthly:   remaining_utility_monthly,
      totalEnergyCostMonthly:    total_energy_cost_monthly,
      panelIntegrity,
      exportRate:           cp.utility.exportRate,
      netMeteringType:      cp.utility.netMeteringType,
      yearlyFlow:           _yearlyFlow,
      exportKwh:            _year1Export,
      productionKwh:        annualProduction,
      escalationSource:     cp.utility.escalationRateSource,
      escalationConfidence: cp.utility.confidence,
    });
    if (!_validation.passed) {
      console.warn('[ProposalTruthEngine][InstallerPreview] Validation issues:', _validation.failures);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  return (
    <div className="flex flex-col bg-slate-950 text-white">
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


      {/* ── Main Content ── */}
      <div id="proposal-document" className="max-w-5xl mx-auto px-4 py-4 space-y-4 print-content">

        {/* Hero Section */}
        <div className="proposal-sec rounded-2xl border border-slate-700/50 overflow-hidden" data-block-id="hero" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)' }}>
          <div className="px-5 py-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-900" style={{ background: primaryColor }}>
                    {systemTypeIcon}
                  </div>
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full border" style={{ color: primaryColor, borderColor: `${primaryColor}40`, background: `${primaryColor}15` }}>
                    {multiArraySystemLabel}
                  </span>
                </div>
                <h1 className="text-2xl font-black text-white mb-1">{proposal.title}</h1>
                {client && (
                  <p className="text-slate-400 text-sm">
                    Prepared for <span className="text-white font-medium">{client.name}</span>
                    {client.address && <span> &middot; {client.address}, {client.city}, {client.state}</span>}
                  </p>
                )}
                <p className="text-slate-500 text-xs mt-1 flex items-center gap-1">
                  <Calendar size={11} />
                  {new Date(proposal.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                </p>
              </div>
              {systemSizeKw > 0 && (
                <div className="text-right flex-shrink-0">
                  <div className="text-5xl font-black leading-none" style={{ color: primaryColor }}>{systemSizeKw.toFixed(1)}</div>
                  <div className="text-slate-300 text-sm font-bold tracking-wide mt-1">kW System</div>
                  {totalPanels > 0 && <div className="text-slate-500 text-xs mt-1">{totalPanels} panels</div>}
                </div>
              )}
            </div>

            {/* Section 3: Key metrics strip — accurate labels, no absolute "savings" language */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
              {[
                { label: 'Annual Production', value: annualProduction > 0 ? `${annualProduction.toLocaleString()} kWh` : '\u2014', icon: <Zap size={15} />, color: 'text-amber-400' },
                {
                  // Section 3: offset label is factual percentage, not absolute claim
                  label: 'Energy Offset',
                  value: energyOffset > 0 ? `~${energyOffset}%` : '\u2014',
                  icon: <Percent size={15} />,
                  color: 'text-emerald-400',
                },
                {
                  // v47.254: breakdown-aware label — shows total from canonical breakdown
                  label: 'Yr 1 Energy Value',
                  value: energyValueBreakdown.total > 0 ? `$${energyValueBreakdown.total.toLocaleString()}` : '\u2014',
                  icon: <DollarSign size={15} />,
                  color: 'text-green-400',
                },
                { label: 'System Payoff', value: payoffYear ? `Year ${payoffYear}` : '\u2014', icon: <TrendingUp size={15} />, color: 'text-blue-400' },
              ].map(m => (
                <div key={m.label} className="bg-slate-800/60 rounded-lg p-2 border border-slate-700/30">
                  <div className={`flex items-center gap-1 ${m.color}`}>{m.icon}<span className="text-xs text-slate-400">{m.label}</span></div>
                  <div className="text-lg font-black text-white">{m.value}</div>
                </div>
              ))}
            </div>

            {/* v47.217: System description — compressed for power page */}
            {systemDescription && (
              <div className="mt-2 px-3 py-2 rounded-lg border border-slate-700/40 bg-slate-800/30">
                <p className="text-slate-500 text-xs leading-snug">
                  <span className="font-semibold text-slate-400">System: </span>
                  {systemDescription}
                </p>
              </div>
            )}

            {/* ── Satellite property image ── */}
            {(() => {
              const hasCoords = clientLat && clientLng &&
                !(clientLat === 33.4484 && clientLng === -112.074);
              if (!hasCoords) return null;
              const GKEY = 'AIzaSyBcXQC-i7s2TJz8PNOM1OhiU-sEhPR41wE';
              const satUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${clientLat},${clientLng}&zoom=19&size=800x320&maptype=satellite&key=${GKEY}`;
              return (
                <div className="mt-3 rounded-xl overflow-hidden border border-slate-700/40 relative" style={{ height: 160 }}>
                  <img
                    src={satUrl}
                    alt="Satellite view of your property"
                    className="w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = 'none'; }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-900/70 to-transparent pointer-events-none" />
                  <div className="absolute bottom-2 left-3 text-white text-xs font-semibold flex items-center gap-1">
                    <MapPin size={11} style={{ color: primaryColor }} />
                    Your Property — system designed for this site
                  </div>
                </div>
              );
            })()}

            {/* Section 7: Fence system production disclaimer */}
            {isFenceSystem && (
              <div className="mt-2 p-2 rounded-lg border border-amber-500/30 bg-amber-500/5">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
                  <p className="text-amber-300/80 text-xs leading-relaxed">
                    <span className="font-semibold text-amber-300">Fence System Note: </span>
                    Production estimates for solar fence systems are approximations. Vertical bifacial panels
                    receive lower solar irradiance than tilted roof or ground-mount installations and are more
                    sensitive to shading, site orientation, and seasonal variation. Actual annual production
                    may differ materially from estimates shown. Consult your installer for a site-specific
                    energy analysis.
                  </p>
                </div>
              </div>
            )}

            {/* ═══ v47.333: POWER PAGE — Inline Financial Framing ═══ */}
            {effectiveFinal > 0 && (
              <div className="mt-3 space-y-2">
                {/* Utility Cost Reality — 2-column layout */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg p-3 border border-red-500/20 bg-red-500/5">
                    <div className="text-xs text-slate-400 mb-0.5">25-Yr Utility Cost (No Solar)</div>
                    <div className="text-xl font-black text-red-400">
                      {utility_cost_25yr > 0 ? `$${utility_cost_25yr.toLocaleString()}` : '\u2014'}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">Projected at {(utilityInflation * 100).toFixed(0)}%/yr increases</div>
                  </div>
                  <div className="rounded-lg p-3 border border-emerald-500/20 bg-emerald-500/5">
                    <div className="text-xs text-slate-400 mb-0.5">Your Solar Investment</div>
                    <div className="text-xl font-black text-emerald-400">
                      ${effectiveFinal.toLocaleString()}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {purchaseMode === 'finance' ? `${financeTermYears}-yr loan` : 'One-time cost'} — you own the energy
                    </div>
                  </div>
                </div>

                {/* Payment Shift — compact single row */}
                {purchaseMode === 'finance' && solar_payment_monthly > 0 && avgMonthlyBillBefore > 0 && (
                  <div className="rounded-lg p-3 border border-slate-600/30 bg-slate-800/40">
                    <div className="text-xs font-semibold text-slate-300 mb-2">What Changes Today</div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-center flex-1">
                        <div className="text-xs text-slate-500">Current Bill</div>
                        <div className="text-lg font-black text-white">${avgMonthlyBillBefore}/mo</div>
                      </div>
                      <div className="text-slate-500 text-sm">→</div>
                      <div className="text-center flex-1">
                        <div className="text-xs text-slate-500">Solar + Utility</div>
                        <div className="text-lg font-black text-white">${total_energy_cost_monthly}/mo</div>
                      </div>
                      <div className="text-slate-500 text-sm">→</div>
                      <div className="text-center flex-1 rounded-lg py-1 px-2" style={{ background: `${primaryColor}15` }}>
                        <div className="text-xs text-slate-400">Toward Ownership</div>
                        <div className="text-lg font-black" style={{ color: primaryColor }}>
                          ${ownership_delta_monthly > 0 ? ownership_delta_monthly : Math.abs(ownership_delta_monthly)}/mo
                        </div>
                      </div>
                    </div>
                    {ownership_delta_monthly > 0 && (
                      <p className="text-xs text-slate-500 mt-1.5 text-center">
                        Redirecting ${ownership_delta_monthly}/mo from utility expense toward energy ownership. Fixed payment — utility rates keep rising.
                      </p>
                    )}
                    {ownership_delta_monthly <= 0 && (
                      <p className="text-xs text-emerald-400/70 mt-1.5 text-center">
                        Immediate monthly savings of ${Math.abs(ownership_delta_monthly)}/mo — and it grows as utility rates increase.
                      </p>
                    )}
                  </div>
                )}

                {/* Cash mode — simple net advantage */}
                {purchaseMode === 'cash' && effectiveFinal > 0 && net_financial_difference_25yr !== 0 && (
                  <div className="rounded-lg p-3 border border-emerald-500/20 bg-emerald-500/5">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs text-slate-400">Est. 25-Year Net Advantage</div>
                        <div className="text-xs text-slate-500 mt-0.5">After system cost vs. paying utility 25 years</div>
                      </div>
                      <div className={`text-xl font-black ${net_financial_difference_25yr >= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {net_financial_difference_25yr >= 0 ? '+' : ''}${Math.round(net_financial_difference_25yr).toLocaleString()}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

          </div>
        </div>

        {/* Section 13: Failsafe message — shown when utility data is unavailable */}
        {failsafeMessage && (
          <div className="proposal-sec rounded-xl p-4 border border-slate-600/30 bg-slate-800/20" data-block-id="failsafe">
            <div className="flex items-start gap-2">
              <Info size={14} className="text-slate-400 flex-shrink-0 mt-0.5" />
              <p className="text-slate-400 text-xs leading-relaxed">{failsafeMessage}</p>
            </div>
          </div>
        )}

        {/* Section 5: Energy Policy Outlook — shown only when policy_effect is at_risk or changing */}
        {utilityProfile.policy_message && (
          <div className="proposal-sec rounded-xl p-4 border border-amber-500/20 bg-amber-500/5" data-block-id="energy-policy">
            <div className="flex items-start gap-2">
              <AlertTriangle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-amber-300 text-xs font-semibold mb-1">Energy Policy Outlook</p>
                <p className="text-amber-300/80 text-xs leading-relaxed">{utilityProfile.policy_message}</p>
              </div>
            </div>
          </div>
        )}

        {/* Investment Section */}
        {effectiveFinal > 0 && (
          <div className="proposal-sec card p-4" data-block-id="cost-vs-value">
            <h2 className="text-base font-black text-white mb-3 flex items-center gap-2">
              <DollarSign size={18} style={{ color: primaryColor }} /> Your Investment
            </h2>

            {/* Purchase mode toggle */}
            <div className="flex gap-1 p-1 bg-slate-800/60 rounded-xl w-fit mb-3 no-print">
              {(['finance', 'cash'] as const).map(mode => (
                <button
                  key={mode}
                  onClick={() => setPurchaseMode(mode)}
                  className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${purchaseMode === mode ? 'text-slate-900' : 'text-slate-400 hover:text-white'}`}
                  style={purchaseMode === mode ? { background: primaryColor } : {}}
                >
                  {mode === 'finance' ? '\u26a1 Finance' : '\ud83d\udcb5 Cash'}
                </button>
              ))}
            </div>

            {purchaseMode === 'finance' ? (
              <>
              {/* ── Section 2: Finance mode — monthly cost truth panel */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <div className="md:col-span-1 rounded-xl p-3 border" style={{ background: `${primaryColor}10`, borderColor: `${primaryColor}30` }}>
                  <div className="text-xs text-slate-400 mb-1">Solar Loan Payment</div>
                  <div className="text-3xl font-black" style={{ color: primaryColor }}>
                    ${solar_payment_monthly > 0 ? solar_payment_monthly.toLocaleString() : '\u2014'}/mo
                  </div>
                  <div className="text-xs text-slate-500 mt-1">{financeTermYears}-yr loan at {((pricingCfg?.loanApr ?? 7.99)).toFixed(2)}% APR</div>

                  {/* Section 2: Monthly cost breakdown — factual, not misleading */}
                  {solar_payment_monthly > 0 && avgMonthlyBillBefore > 0 && (
                    <div className="mt-4 pt-3 border-t border-slate-700/40 space-y-1.5">
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-400">Solar payment</span>
                        <span className="text-white font-medium">${solar_payment_monthly}/mo</span>
                      </div>
                      {remaining_utility_monthly > 0 && (
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-400">Est. remaining utility</span>
                          <span className="text-white font-medium">${remaining_utility_monthly}/mo</span>
                        </div>
                      )}
                      <div className="flex justify-between text-xs border-t border-slate-700/40 pt-1.5">
                        <span className="text-slate-300 font-medium">Total energy cost</span>
                        <span className="text-white font-bold">${total_energy_cost_monthly}/mo</span>
                      </div>
                      <div className="flex justify-between text-xs pt-0.5">
                        <span className="text-slate-400">vs. current bill (~${avgMonthlyBillBefore}/mo)</span>
                        {/* Section 2 & 8: "Initial monthly difference" — never "Monthly savings" unless confirmed negative */}
                        <span className={`font-semibold ${ownership_delta_monthly <= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {ownership_delta_monthly <= 0
                            ? `-$${Math.abs(ownership_delta_monthly)}/mo`
                            : `+$${ownership_delta_monthly}/mo initial`}
                        </span>
                      </div>
                      {ownership_delta_monthly > 0 && (
                        <p className="text-xs text-slate-500 pt-0.5">
                          Initial monthly difference. As utility rates rise, your solar payment stays fixed.
                        </p>
                      )}
                      {ownership_delta_monthly > 0 && (
                        <p className="text-xs text-slate-500 pt-0.5">
                          ${ownership_delta_monthly}/mo is being redirected toward energy ownership rather than utility expense.
                        </p>
                      )}
                    </div>
                  )}
                </div>
                <div className="md:col-span-2 grid grid-cols-2 gap-2">
                  {[
                    { label: 'System Cost', value: `$${effectiveFinal.toLocaleString()}` },
                    { label: 'Current Avg. Monthly Bill', value: `$${avgMonthlyBillBefore}/mo` },
                    // Section 4: label "Est. 25-Yr Energy Value" — not "25-Year Savings"
                    { label: 'Est. 25-Yr Energy Value', value: estimated_energy_value_25yr > 0 ? `$${Math.round(estimated_energy_value_25yr).toLocaleString()}` : '\u2014' }, // v47.254: lump sum retained in grid; breakdown shown in dedicated section below
                    { label: 'System Payoff', value: payoffYear ? `Year ${payoffYear}` : '\u2014' },
                  ].map(item => (
                    <div key={item.label} className="bg-slate-800/40 rounded-xl p-3 border border-slate-700/30">
                      <div className="text-xs text-slate-500 mb-1">{item.label}</div>
                      <div className="text-lg font-black text-white">{item.value}</div>
                    </div>
                  ))}
                </div>
              </div>
              {/* Loan term comparison table — shows 10/15/25-yr payments side by side */}
              {effectiveFinal > 0 && purchaseMode === 'finance' && (
                <div className="mt-3 rounded-xl border border-slate-700/50 overflow-hidden">
                  <div className="px-3 py-2 bg-slate-800/60 border-b border-slate-700/40">
                    <span className="text-xs font-semibold text-slate-300">Loan Term Comparison</span>
                    <span className="text-xs text-slate-500 ml-2">at {((pricingCfg?.loanApr ?? 7.99)).toFixed(2)}% APR</span>
                  </div>
                  <div className="grid grid-cols-3 divide-x divide-slate-700/40">
                    {([10, 15, 25] as const).map(termYears => {
                      const _r = ((pricingCfg?.loanApr ?? 7.99) / 100) / 12;
                      const _n = termYears * 12;
                      const _monthly = effectiveFinal > 0 && _r > 0
                        ? Math.round(effectiveFinal * (_r * Math.pow(1 + _r, _n)) / (Math.pow(1 + _r, _n) - 1))
                        : 0;
                      const _isCurrent = termYears === (pricingCfg?.loanTermYears ?? 25);
                      return (
                        <div key={termYears} className={`px-3 py-2.5 text-center ${_isCurrent ? 'bg-amber-500/10' : ''}`}>
                          <div className={`text-[10px] font-semibold mb-1 ${_isCurrent ? 'text-amber-400' : 'text-slate-500'}`}>
                            {termYears}-Year{_isCurrent ? ' ✓' : ''}
                          </div>
                          <div className={`text-base font-black ${_isCurrent ? 'text-amber-400' : 'text-white'}`}>
                            ${_monthly.toLocaleString()}/mo
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            ${Math.round(_monthly * _n).toLocaleString()} total
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              </>
            ) : (
              // ── Section 1 & 4: Cash mode — no ITC line, clean labels ─────
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {[
                  { label: 'System Cost', value: `$${effectiveFinal.toLocaleString()}`, color: 'text-white' },
                  // Section 4: "Est. 25-Yr Energy Value" — not "25-Year Savings"
                  { label: 'Est. 25-Yr Energy Value', value: estimated_energy_value_25yr > 0 ? `$${Math.round(estimated_energy_value_25yr).toLocaleString()}` : '\u2014', color: 'text-emerald-400' },
                  // Section 4: net_financial_difference_25yr — clearly labeled
                  { label: 'Est. 25-Yr Net Difference', value: net_financial_difference_25yr !== 0 ? `${net_financial_difference_25yr >= 0 ? '+' : ''}$${Math.round(net_financial_difference_25yr).toLocaleString()}` : '\u2014', color: net_financial_difference_25yr >= 0 ? 'text-emerald-400' : 'text-amber-400' },
                ].map(item => (
                  <div key={item.label} className="bg-slate-800/40 rounded-xl p-3 border border-slate-700/30">
                    <div className="text-xs text-slate-500 mb-1">{item.label}</div>
                    <div className={`text-xl font-black ${item.color}`}>{item.value}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* v47.251: Incentives compliance notice — content driven by GLOBAL_INCENTIVES_CONFIG */}
        <div className="proposal-sec card p-3 border border-slate-700/30" data-block-id="incentives-notice">
          <div className="flex items-start gap-2">
            <Info size={14} className="text-slate-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-slate-400 text-xs leading-relaxed">
                {getIncentivesComplianceMessage()}
              </p>
              {process.env.NODE_ENV === 'development' && (
                <p className="text-amber-500 text-xs mt-1 font-mono">
                  [{getIncentivesDebugLabel()}]
                </p>
              )}
            </div>
          </div>
        </div>

        {/* State Incentives — gated by GLOBAL_INCENTIVES_CONFIG.allow_state_incentives (v47.251) */}
        {GLOBAL_INCENTIVES_CONFIG.allow_state_incentives && stateIncentives && stateIncentives.stateIncentives.length > 0 && (
          <div className="proposal-sec card p-4" data-block-id="incentives-srec">
            <h2 className="text-base font-black text-white mb-3 flex items-center gap-2">
              <Award size={18} style={{ color: primaryColor }} /> Available Incentives
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {stateIncentives.stateIncentives.map((inc: any, i: number) => (
                <div key={i} className="rounded-xl p-4 border bg-emerald-500/5 border-emerald-500/20">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-white">{inc.name}</div>
                      {inc.description && <div className="text-xs text-slate-400 mt-1">{inc.description}</div>}
                    </div>
                    <div className="text-sm font-black flex-shrink-0 text-emerald-400">
                      {inc.calculatedValue > 0 ? `$${Math.round(inc.calculatedValue).toLocaleString()}` : 'Eligible'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Section 4: How Your Utility Actually Works — SPEC §10 */}
        <div className="proposal-sec card p-3" data-block-id="utility-profile">
          <h3 className="font-semibold text-white text-sm mb-3 flex items-center gap-2">
            <Zap size={15} style={{ color: primaryColor }} /> How Your Utility Actually Works
          </h3>
          <p className="text-slate-300 text-sm leading-relaxed mb-4">
            {utilityProfile.net_metering_summary}
          </p>

          {/* Export compensation breakdown — SPEC §10 detail rows */}
          <div className="space-y-2">
            {/* Net metering type */}
            <div className="flex items-start justify-between gap-3 py-2 border-b border-slate-700/40">
              <span className="text-xs text-slate-400 font-medium">Export Program</span>
              <span className="text-xs text-slate-200 text-right font-semibold capitalize">
                {({
                  retail_1to1:  'Full Retail Net Metering (NEM)',
                  net_billing:  'Net Billing (NEM 3.0 style)',
                  avoided_cost: 'Avoided Cost Compensation',
                  none:         'No Export Credit',
                } as Record<string, string>)[cp.utility.netMeteringType] ?? cp.utility.netMeteringType}
              </span>
            </div>

            {/* Self-consumption value */}
            <div className="flex items-start justify-between gap-3 py-2 border-b border-slate-700/40">
              <div>
                <span className="text-xs text-slate-400 font-medium">Energy Used In Your Home</span>
                <p className="text-xs text-slate-500 mt-0.5">Offsets your bill at full retail value</p>
              </div>
              <span className="text-xs text-emerald-400 font-bold">${cp.utility.rate.toFixed(3)}/kWh</span>
            </div>

            {/* Export value */}
            {cp.utility.netMeteringType !== 'none' && cp.utility.export_rate_monthly !== null && (
              <div className="flex items-start justify-between gap-3 py-2 border-b border-slate-700/40">
                <div>
                  <span className="text-xs text-slate-400 font-medium">Energy Exported to Grid</span>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {cp.utility.netMeteringType === 'retail_1to1'
                      ? 'Credited at full retail rate (1:1 net metering)'
                      : 'Credited at below-retail export rate'}
                  </p>
                </div>
                <span className={`text-xs font-bold ${
                  cp.utility.export_rate_monthly !== null && cp.utility.export_rate_monthly < cp.utility.rate
                    ? 'text-amber-400'
                    : 'text-emerald-400'
                }`}>
                  ${(cp.utility.export_rate_monthly ?? cp.utility.rate).toFixed(3)}/kWh
                </span>
              </div>
            )}

            {/* Annual true-up excess rate */}
            {cp.utility.true_up_period === 'annual' && cp.utility.export_rate_annual_excess !== null && (
              <div className="flex items-start justify-between gap-3 py-2 border-b border-slate-700/40">
                <div>
                  <span className="text-xs text-slate-400 font-medium">Annual True-Up Excess</span>
                  <p className="text-xs text-slate-500 mt-0.5">Net surplus kWh settled at year-end</p>
                </div>
                <span className="text-xs text-amber-400 font-bold">
                  ${cp.utility.export_rate_annual_excess.toFixed(3)}/kWh
                </span>
              </div>
            )}

            {/* True-up period */}
            <div className="flex items-start justify-between gap-3 py-2 border-b border-slate-700/40">
              <span className="text-xs text-slate-400 font-medium">Settlement Period</span>
              <span className="text-xs text-slate-200 font-semibold capitalize">
                {cp.utility.true_up_period === 'annual'
                  ? 'Annual true-up'
                  : cp.utility.true_up_period === 'monthly'
                  ? 'Monthly settlement'
                  : 'No settlement'}
              </span>
            </div>

            {/* Rate escalation */}
            <div className="flex items-start justify-between gap-3 py-2">
              <div>
                <span className="text-xs text-slate-400 font-medium">Rate Escalation Assumption</span>
                <p className="text-xs text-slate-500 mt-0.5">{cp.utility.escalationRateSourceLabel}</p>
              </div>
              <span className="text-xs text-slate-200 font-semibold">
                {(cp.utility.escalationRate * 100).toFixed(1)}%/yr
              </span>
            </div>
          </div>

          {/* SPEC §11: Export < retail messaging — shown when export rate is below retail */}
          {cp.utility.netMeteringType !== 'retail_1to1' &&
           cp.utility.export_rate_monthly !== null &&
           cp.utility.export_rate_monthly < cp.utility.rate && (
            <div className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <p className="text-xs text-amber-300 font-semibold mb-1">Not all energy is valued equally.</p>
              <p className="text-xs text-amber-200/80 leading-relaxed">
                Energy used directly in your home offsets electricity at full retail value
                (${cp.utility.rate.toFixed(3)}/kWh), while excess energy exported to the grid
                is compensated at a lower rate (${(cp.utility.export_rate_monthly ?? 0).toFixed(3)}/kWh).
                Maximizing self-consumption gives your solar system its best financial return.
              </p>
            </div>
          )}

          {/* System design guidance for non-retail_1to1 */}
          {cp.utility.netMeteringType !== 'retail_1to1' && (
            <div className="mt-3 p-3 rounded-lg bg-slate-800/40 border border-slate-700/30">
              <p className="text-xs text-slate-400 font-medium">System Design Guidance</p>
              <p className="text-xs text-slate-300 mt-1">{utilityProfile.system_design_guidance}</p>
            </div>
          )}

          {!utilityProfile.is_specific_match && (
            <p className="text-xs text-slate-500 mt-2 italic">
              * Based on {utilityProfile.profile.state || 'state'}-level utility data.
              Verify specific net metering terms with your utility.
            </p>
          )}
        </div>

        {/* v47.254: Energy Value Breakdown — Task 3+4+6 */}
        {/* Source: cp.financial.energyValueBreakdown (identity map from yearlyFlow[0]) */}
        {energyValueBreakdown.total > 0 && (
          <div className="proposal-sec card p-3" data-block-id="what-this-means">
            <h3 className="font-semibold text-white text-sm mb-1 flex items-center gap-2">
              <DollarSign size={15} style={{ color: primaryColor }} /> How Your Energy Value Is Calculated
            </h3>
            <p className="text-slate-400 text-xs mb-4 leading-relaxed">
              Energy used in your home offsets electricity at full retail value.
              Exported energy is compensated at your utility’s export rate, which is typically lower.
            </p>
            <div className="space-y-2">
              {/* Self-consumed row */}
              <div className="flex items-center justify-between gap-4 py-2.5 px-3 rounded-lg bg-emerald-500/8 border border-emerald-500/20">
                <div>
                  <div className="text-xs font-semibold text-slate-200">Energy Used In Your Home</div>
                  <div className="text-xs text-slate-500 mt-0.5">Offsets utility bill at full retail rate — highest-value use of your solar</div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-base font-black text-emerald-400">${energyValueBreakdown.selfConsumed.toLocaleString()}</div>
                  <div className="text-xs text-slate-500">yr 1 value</div>
                </div>
              </div>

              {/* Exported row — only shown when export value exists */}
              {energyValueBreakdown.exported > 0 && (
                <div className="flex items-center justify-between gap-4 py-2.5 px-3 rounded-lg bg-blue-500/8 border border-blue-500/20">
                  <div>
                    <div className="text-xs font-semibold text-slate-200">Energy Exported to Grid</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {cp.utility.netMeteringType === 'retail_1to1'
                        ? 'Credited at full retail rate (1:1 net metering)'
                        : 'Credited at your utility’s export rate (below retail)'}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-base font-black text-blue-400">${energyValueBreakdown.exported.toLocaleString()}</div>
                    <div className="text-xs text-slate-500">yr 1 value</div>
                  </div>
                </div>
              )}

              {/* Total row */}
              <div className="flex items-center justify-between gap-4 py-2.5 px-3 rounded-lg bg-slate-800/60 border border-slate-600/30">
                <div>
                  <div className="text-xs font-semibold text-slate-100">Total Year 1 Energy Value</div>
                  <div className="text-xs text-slate-500 mt-0.5">Self-consumption + export credits combined</div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-base font-black text-white">${energyValueBreakdown.total.toLocaleString()}</div>
                  <div className="text-xs text-slate-500">yr 1 total</div>
                </div>
              </div>
            </div>

            {/* System payoff callout — from _meta.payoffYear (iterative model) */}
            {payoffYear && (
              <div className="mt-4 pt-3 border-t border-slate-700/40 flex items-center justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold text-slate-300">System Payoff</div>
                  <div className="text-xs text-slate-500 mt-0.5">{utilityProfile.profile.srec_available ? 'Energy value + state incentives ≥ system cost' : 'When cumulative energy value produced ≥ system cost'}</div>
                </div>
                <div className="text-base font-black text-blue-400">Year {payoffYear}</div>
              </div>
            )}
          </div>
        )}

        {/* Section 4: SREC Program — shown only when srec_available */}
        {utilityProfile.profile.srec_available && utilityProfile.srec_summary && (
          <div className="proposal-sec card p-5 border border-emerald-500/20" data-block-id="srec">
            <h3 className="font-semibold text-white text-sm mb-3 flex items-center gap-2">
              <Award size={15} className="text-emerald-400" /> Solar Performance Credits (SREC)
            </h3>
            <p className="text-slate-300 text-sm leading-relaxed">
              {utilityProfile.srec_summary}
            </p>
          </div>
        )}

        {/* Production + Monthly Bill Chart */}
        {production && mounted && (
          <div className="proposal-sec grid grid-cols-1 lg:grid-cols-2 gap-3" data-block-id="system-summary" data-keep-together="true">
            {/* Monthly Production */}
            <div className="card p-5">
              <h3 className="font-semibold text-white text-sm mb-4 flex items-center gap-2">
                <Sun size={15} style={{ color: primaryColor }} /> Monthly Solar Production
              </h3>
              <div className="flex items-end gap-1 h-20 mb-1">
                {cp.production.monthlyKwh.map((kwh, i) => {
                  const max = Math.max(...cp.production.monthlyKwh, 1);
                  const pct = (kwh / max) * 100;
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1">
                      <div
                        className="w-full rounded-t-sm transition-all"
                        style={{ height: `${pct}%`, background: `${primaryColor}cc` }}
                        title={`${MONTHS[i]}: ${kwh.toLocaleString()} kWh`}
                      />
                      <span className="text-xs text-slate-500">{MONTHS[i].slice(0,1)}</span>
                    </div>
                  );
                })}
              </div>
              <div className="text-center text-xs text-slate-400 mt-1">
                {annualProduction.toLocaleString()} kWh / year total
              </div>
            </div>

            {/* Monthly Bill Before/After */}
            <div className="card p-5">
              <h3 className="font-semibold text-white text-sm mb-4 flex items-center gap-2">
                <DollarSign size={15} className="text-emerald-400" /> Monthly Bill: Before vs After Solar
              </h3>
              <ResponsiveContainer width="100%" height={130}>
                <BarChart data={monthlyBillData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`$${v}`, '']} />
                  <Bar dataKey="before" fill="#ef4444" radius={[3, 3, 0, 0]} name="Before Solar" opacity={0.6} />
                  <Bar dataKey="after" fill="#22c55e" radius={[3, 3, 0, 0]} name="After Solar" opacity={0.8} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Section 8: Offset messaging — shown when offset < 100% */}
        {energyOffset > 0 && energyOffset < 100 && (
          <div className="proposal-sec rounded-xl p-4 border border-blue-500/20 bg-blue-500/5" data-block-id="long-term-outcome">
            <div className="flex items-start gap-2">
              <Zap size={14} className="text-blue-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-blue-300 text-xs font-semibold mb-1">Partial Offset System</p>
                <p className="text-slate-300 text-xs leading-relaxed">
                  This system offsets approximately {energyOffset}% of your annual energy usage.
                  You will still have a reduced utility bill for the remaining {100 - energyOffset}%
                  of your energy needs.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* v47.256: Your Savings Over Time — single green savings curve */}
        {/* Source: projectionData[i].cumulative = cumulative_without_solar - cumulative_with_solar (read-only) */}
        {annualProduction > 0 && mounted && projectionData.length > 0 && (
          <div className="proposal-sec card p-3" data-block-id="financial-timeline" data-keep-together="true">
            {/* Title */}
            <div className="flex items-start justify-between gap-4 mb-3">
              <h3 className="font-semibold text-white text-sm flex items-center gap-2">
                <TrendingUp size={15} style={{ color: primaryColor }} /> Your Savings Over Time
              </h3>
              {/* Final savings callout — Task 3 */}
              {netDifference_25yr > 0 && (
                <div className="text-right flex-shrink-0">
                  <div className="text-xl font-black text-emerald-400">
                    +${Math.round(netDifference_25yr).toLocaleString()}
                  </div>
                  <div className="text-xs text-slate-500">total est. savings</div>
                </div>
              )}
            </div>

            {/* Task 4: Explanation above graph */}
            <p className="text-slate-400 text-xs mb-4 leading-relaxed">
              As utility rates increase over time, your savings grow each year.{' '}
              <span className="text-slate-500">Solar locks in your energy cost while utility prices continue to rise.</span>
            </p>

            {/* Single green savings area chart */}
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={projectionData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="savingsGrowthGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis
                  dataKey="year"
                  tick={{ fill: '#64748b', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  interval={4}
                  tickFormatter={(v: string) => `Yr ${v.replace('Yr ', '')}`}
                />
                <YAxis
                  tick={{ fill: '#64748b', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => v >= 1000 ? `$${(v/1000).toFixed(0)}k` : `$${v}`}
                  width={44}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v: number) => [`$${v.toLocaleString()}`, 'Cumulative Savings']}
                  labelFormatter={(label: string) => `${label}`}
                />
                {/* Task 5: Break-even reference line at payoffYear */}
                {payoffYear && (
                  <ReferenceLine
                    x={`Yr ${payoffYear}`}
                    stroke="#f59e0b"
                    strokeDasharray="4 3"
                    strokeWidth={1.5}
                    label={{
                      value: `Break-even Yr ${payoffYear}`,
                      position: 'insideTopRight',
                      fill: '#f59e0b',
                      fontSize: 9,
                      fontWeight: 600,
                    }}
                  />
                )}
                {/* Single green savings line */}
                <Area
                  type="monotone"
                  dataKey="cumulative"
                  stroke="#22c55e"
                  strokeWidth={2.5}
                  fill="url(#savingsGrowthGrad)"
                  name="Cumulative Savings"
                  dot={false}
                  activeDot={{ r: 4, fill: '#22c55e', stroke: '#0f172a', strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>

            {/* Caption below graph — Task 4 */}
            <p className="text-slate-500 text-xs mt-3 leading-relaxed">
              {purchaseMode === 'finance'
                ? 'While your solar payment may start slightly higher than your current bill, utility rates continue to rise — growing your savings each year.'
                : 'After your one-time investment, solar avoids thousands in future utility costs as rates continue to increase.'}
            </p>
          </div>
        )}

        {/* v47.255: 25-Year Financial Summary — Task 7: de-emphasized large numbers, reordered for clarity */}
        {annualProduction > 0 && utility_cost_25yr > 0 && (
          <div className="proposal-sec card p-3" data-block-id="financial-summary" data-keep-together="true">
            <h3 className="font-semibold text-white text-sm mb-4 flex items-center gap-2">
              <BarChart2 size={15} style={{ color: primaryColor }} /> 25-Year Financial Summary
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {/* Solar Investment — shown first: this is what customer controls */}
              <div className="bg-slate-800/40 rounded-xl p-3 border border-slate-700/30">
                <div className="text-xs text-slate-500 mb-1">Your Solar Investment</div>
                <div className="text-lg font-black text-white">${Math.round(solar_cost_total).toLocaleString()}</div>
                <div className="text-xs text-slate-500 mt-1">
                  {purchaseMode === 'finance' ? `${financeTermYears}-yr loan total` : 'One-time cash purchase'}
                </div>
              </div>

              {/* Remaining utility cost */}
              <div className="bg-slate-800/40 rounded-xl p-3 border border-slate-700/30">
                <div className="text-xs text-slate-500 mb-1">Est. Remaining Utility Bills</div>
                <div className="text-lg font-black text-slate-300">${remaining_utility_cost_total > 0 ? remaining_utility_cost_total.toLocaleString() : '0'}</div>
                <div className="text-xs text-slate-500 mt-1">{energyOffset}% offset — {100 - energyOffset}% still from grid</div>
              </div>

              {/* Net advantage — prominent */}
              <div className="bg-emerald-500/8 rounded-xl p-4 border border-emerald-500/25">
                <div className="text-xs text-slate-400 mb-1">Est. 25-Yr Advantage</div>
                <div className={`text-lg font-black ${net_financial_difference_25yr >= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {net_financial_difference_25yr >= 0
                    ? `+$${Math.round(net_financial_difference_25yr).toLocaleString()}`
                    : `-$${Math.abs(Math.round(net_financial_difference_25yr)).toLocaleString()}`}
                </div>
                <div className="text-xs text-slate-500 mt-1">vs. paying utility rates 25 yrs</div>
              </div>

              {/* Utility cost without solar — de-emphasized, always with context (Task 7) */}
              <div className="bg-slate-800/20 rounded-xl p-4 border border-slate-700/20">
                <div className="text-xs text-slate-600 mb-1">If You Kept Paying Utility Bills</div>
                <div className="text-lg font-black text-slate-500">${utility_cost_25yr.toLocaleString()}</div>
                <div className="text-xs text-slate-600 mt-1">
                  Projected 25-yr cost with {(utilityInflation * 100).toFixed(0)}%/yr rate increases
                </div>
              </div>
            </div>
            <p className="text-slate-600 text-xs mt-3">
              All figures are estimates based on {(utilityInflation * 100).toFixed(0)}% annual utility rate escalation
              and {(panelDegradation * 100).toFixed(1)}%/yr panel degradation. Not a guarantee of future results.
            </p>
          </div>
        )}

        {/* v47.254: Task 2 — Financial Narrative section (from cp._meta.narrative) */}
        {narrative && narrative.fullNarrative && (
          <div className="proposal-sec card p-3" data-block-id="why-this-system" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #0f172a 100%)' }}>
            <h3 className="font-semibold text-white text-sm mb-4 flex items-center gap-2">
              <TrendingUp size={15} style={{ color: primaryColor }} /> Your Financial Story
            </h3>
            <div className="space-y-2">
              {narrative.primaryStory && (
                <p className="text-slate-200 text-sm leading-relaxed">{narrative.primaryStory}</p>
              )}
              {narrative.monthlyImpact && (
                <p className="text-slate-300 text-sm leading-relaxed">{narrative.monthlyImpact}</p>
              )}
              {narrative.payoffStatement && (
                <p className="text-slate-300 text-sm leading-relaxed">{narrative.payoffStatement}</p>
              )}
              {narrative.outcomeStatement && (
                <p className="text-slate-200 text-sm leading-relaxed font-medium">{narrative.outcomeStatement}</p>
              )}
            </div>
          </div>
        )}

        {/* Section 6: Assumptions Block ── */}
        {(annualProduction > 0 || effectiveFinal > 0) && (
          <div className="proposal-sec card p-3 border border-slate-700/30" data-block-id="next-steps">
            <h3 className="font-semibold text-white text-sm mb-4 flex items-center gap-2">
              <Info size={15} className="text-slate-400" /> Proposal Assumptions
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
              {[
                {
                  label: 'Utility Rate',
                  value: `$${utilityRate.toFixed(4)}/kWh`,
                  note: utilityProfile.is_specific_match
                    ? `${utilityProfile.profile.utility_id.replace(/_/g, ' ').toUpperCase()} — verified rate`
                    : 'Current blended rate used for estimates',
                },
                {
                  label: 'Net Metering Type',
                  value: ({
                    retail_1to1:  'Retail-rate (1:1)',
                    net_billing:  'Net billing',
                    avoided_cost: 'Avoided cost',
                    none:         'None',
                  } as Record<string, string>)[utilityProfile.profile.net_metering_type] || 'Retail-rate',
                  note: 'Export compensation structure',
                },
                {
                  label: 'Rate Escalation',
                  value: `${(utilityInflation * 100).toFixed(0)}% / yr`,
                  note: 'Historical avg. utility rate increase assumed',
                },
                {
                  label: 'Production Model',
                  value: 'PVWatts / layout-based',
                  note: 'Based on system design and location data',
                },
                {
                  label: 'Annual Usage',
                  value: annualUsage > 0 ? `${annualUsage.toLocaleString()} kWh` : 'Not provided',
                  note: 'From utility bill analysis',
                },
                {
                  label: 'Energy Offset',
                  value: energyOffset > 0 ? `~${energyOffset}% of annual usage` : 'Not calculated',
                  note: 'Estimated annual production vs. usage',
                },
                ...(purchaseMode === 'finance' ? [{
                  label: 'Loan Terms',
                  value: `${financeTermYears} yr @ ${((pricingCfg?.loanApr ?? 7.99)).toFixed(2)}% APR`,
                  note: 'Subject to lender approval',
                }] : []),
                {
                  label: 'Panel Degradation',
                  value: `${(panelDegradation * 100).toFixed(1)}% / yr`,
                  note: 'Industry standard annual output reduction',
                },
              ].map(a => (
                <div key={a.label} className="bg-slate-800/40 rounded-lg p-3 border border-slate-700/20">
                  <div className="text-slate-400 mb-0.5">{a.label}</div>
                  <div className="text-white font-semibold">{a.value}</div>
                  {a.note && <div className="text-slate-500 text-xs mt-0.5">{a.note}</div>}
                </div>
              ))}
            </div>
            <p className="text-slate-600 text-xs mt-4">
              All financial projections are estimates based on the assumptions above and are not guaranteed.
              Actual production, savings, and costs will vary. This proposal does not constitute tax advice.
              {' '}{getIncentivesComplianceMessage()}
            </p>
          </div>
        )}

        {/* Equipment */}
        <div className="proposal-sec card p-4" data-block-id="equipment">
          <h2 className="text-base font-black text-white mb-3 flex items-center gap-2">
            <Shield size={18} style={{ color: primaryColor }} /> System Equipment
          </h2>
          {/* v47.398 — Ecosystem summary (shown only when confidence is high) */}
          {(() => {
            const ecoSummary = deriveEcosystemSummary({
              panels: (proj as any)?.selectedPanel ? [{
                manufacturer: (proj as any).selectedPanel.manufacturer,
                model: (proj as any).selectedPanel.model || (proj as any).selectedPanel.name,
                ecosystemBrand: (proj as any).selectedPanel.ecosystemBrand,
              }] : [],
              inverters: (proj as any)?.selectedInverter ? [{
                manufacturer: (proj as any).selectedInverter.manufacturer,
                model: (proj as any).selectedInverter.model || (proj as any).selectedInverter.name,
                ecosystemBrand: (proj as any).selectedInverter.ecosystemBrand || (proj as any).selectedInverter.manufacturer,
              }] : [],
              batteries: (proj as any)?.selectedBattery ? [{
                manufacturer: (proj as any).selectedBattery.manufacturer,
                model: (proj as any).selectedBattery.model || (proj as any).selectedBattery.name,
                ecosystemBrand: (proj as any).selectedBattery.ecosystemBrand,
              }] : [],
            });
            if (!ecoSummary.showEcosystemCopy || !ecoSummary.sentence) return null;
            return (
              <div className="mb-4 p-3 rounded-lg bg-gradient-to-r from-indigo-500/5 to-purple-500/5 border border-indigo-500/20">
                <div className="flex items-start gap-2">
                  <div className="w-5 h-5 rounded bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Shield size={11} className="text-indigo-300" />
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">{ecoSummary.sentence}</p>
                </div>
              </div>
            );
          })()}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Panel */}
            <div className="bg-slate-800/40 rounded-xl p-3 border border-slate-700/30">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${primaryColor}20`, color: primaryColor }}>
                  <Sun size={18} />
                </div>
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Solar Panels</span>
              </div>
              <div className="text-sm font-semibold text-white">
                {(proj as any)?.selectedPanel?.model || (proj as any)?.selectedPanel?.name || 'High-efficiency solar panels'}
              </div>
              {/* Section 2: Use resolvedPanelWattage from panelIntegrity — single source of truth */}
              {resolvedPanelWattage > 0 && (
                <div className="text-xs text-slate-400 mt-1">{resolvedPanelWattage}W per panel</div>
              )}
              <div className="text-xs text-emerald-400 mt-2 flex items-center gap-1">
                <CheckCircle size={10} /> 25-yr product warranty
              </div>
            </div>

            {/* Inverter */}
            <div className="bg-slate-800/40 rounded-xl p-3 border border-slate-700/30">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${primaryColor}20`, color: primaryColor }}>
                  <Zap size={18} />
                </div>
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Inverter</span>
              </div>
              <div className="text-sm font-semibold text-white">
                {(proj as any)?.selectedInverter?.model || (proj as any)?.selectedInverter?.name || 'Premium grid-tie inverter'}
              </div>
              {(proj as any)?.selectedInverter?.efficiency && (
                <div className="text-xs text-slate-400 mt-1">{((proj as any).selectedInverter.efficiency * 100).toFixed(1)}% efficiency</div>
              )}
              <div className="text-xs text-emerald-400 mt-2 flex items-center gap-1">
                <CheckCircle size={10} /> 25-yr warranty
              </div>
            </div>

            {/* Racking */}
            <div className="bg-slate-800/40 rounded-xl p-3 border border-slate-700/30">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${primaryColor}20`, color: primaryColor }}>
                  <Shield size={18} />
                </div>
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Mounting System</span>
              </div>
              <div className="text-sm font-semibold text-white">
                {equipment.racking?.rackingBrand
                  ? `${equipment.racking.rackingBrand} ${equipment.racking.rackingModel}`
                  : 'Engineered mounting system'}
              </div>
              {equipment.racking?.tiltRange && (
                <div className="text-xs text-slate-400 mt-1">{equipment.racking.tiltRange}</div>
              )}
              <div className="text-xs text-emerald-400 mt-2 flex items-center gap-1">
                <CheckCircle size={10} /> {equipment.racking?.warranty || '25-yr structural warranty'}
              </div>
            </div>
          </div>
        </div>

        {/* ── Environmental Impact ─────────────────────────────────────────── */}
        {annualProduction > 0 && (() => {
          // EPA eGRID national average: 0.386 kg CO₂ per kWh (2023)
          const CO2_PER_KWH_KG   = 0.386;
          const TREE_KG_CO2_YR   = 21.77;  // avg tree absorbs ~21.77 kg CO₂/yr
          const CAR_KG_CO2_MILE  = 0.404;  // avg car 404g CO₂/mile
          const HOME_KWH_YR      = 10632;  // avg US home annual usage (EIA 2023)
          const annualCO2Kg      = Math.round(annualProduction * CO2_PER_KWH_KG);
          const annualCO2Lbs     = Math.round(annualCO2Kg * 2.205);
          const treesEquiv       = Math.round(annualCO2Kg / TREE_KG_CO2_YR);
          const milesEquiv       = Math.round(annualCO2Kg / CAR_KG_CO2_MILE);
          const homesEquiv       = parseFloat((annualProduction / HOME_KWH_YR).toFixed(1));
          const lifetime25CO2Lbs = Math.round(annualCO2Lbs * 25 * 0.9); // ~10% degradation avg
          return (
            <div className="proposal-sec card p-4" data-block-id="environmental-impact">
              <h3 className="font-semibold text-white text-sm mb-1 flex items-center gap-2">
                <Leaf size={15} className="text-emerald-400" /> Your Environmental Impact
              </h3>
              <p className="text-slate-400 text-xs mb-4">
                Every kWh of solar energy offsets CO₂ that would otherwise come from the grid.
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
                {[
                  {
                    icon: <Wind size={18} className="text-sky-400" />,
                    value: `${annualCO2Lbs.toLocaleString()} lbs`,
                    label: 'CO₂ Avoided / Year',
                    sub: `${annualCO2Kg.toLocaleString()} kg`,
                    color: 'border-sky-500/20 bg-sky-500/5',
                  },
                  {
                    icon: <TreePine size={18} className="text-emerald-400" />,
                    value: `${treesEquiv.toLocaleString()}`,
                    label: 'Trees Equivalent / Year',
                    sub: 'absorbing the same CO₂',
                    color: 'border-emerald-500/20 bg-emerald-500/5',
                  },
                  {
                    icon: <Car size={18} className="text-violet-400" />,
                    value: `${milesEquiv.toLocaleString()}`,
                    label: 'Car Miles Offset / Year',
                    sub: 'not driven equivalent',
                    color: 'border-violet-500/20 bg-violet-500/5',
                  },
                  {
                    icon: <Users size={18} className="text-amber-400" />,
                    value: `${homesEquiv}`,
                    label: 'Homes Powered',
                    sub: 'avg US home annual usage',
                    color: 'border-amber-500/20 bg-amber-500/5',
                  },
                ].map(m => (
                  <div key={m.label} className={`rounded-xl p-3 border ${m.color} text-center`}>
                    <div className="flex justify-center mb-1.5">{m.icon}</div>
                    <div className="text-lg font-black text-white">{m.value}</div>
                    <div className="text-xs text-slate-400 mt-0.5 leading-tight">{m.label}</div>
                    <div className="text-xs text-slate-600 mt-0.5">{m.sub}</div>
                  </div>
                ))}
              </div>
              <div className="rounded-lg px-3 py-2 bg-emerald-500/5 border border-emerald-500/15 flex items-center gap-3">
                <Leaf size={14} className="text-emerald-400 flex-shrink-0" />
                <p className="text-xs text-slate-400">
                  Over 25 years this system will offset an estimated{' '}
                  <span className="text-emerald-400 font-semibold">{lifetime25CO2Lbs.toLocaleString()} lbs of CO₂</span>
                  {' '}— equivalent to planting{' '}
                  <span className="text-emerald-400 font-semibold">{Math.round(treesEquiv * 25 * 0.9).toLocaleString()} trees</span>.
                  Based on EPA eGRID national average emissions factor.
                </p>
              </div>
            </div>
          );
        })()}

        {/* ── What Happens Next — post-sign timeline ────────────────────────── */}
        <div className="proposal-sec card p-4" data-block-id="next-steps-timeline">
          <h3 className="font-semibold text-white text-sm mb-4 flex items-center gap-2">
            <ChevronRight size={15} style={{ color: primaryColor }} /> What Happens After You Sign
          </h3>
          <div className="space-y-0">
            {[
              {
                step: 1,
                title: 'Proposal Signed',
                desc: 'Your installer is notified immediately and will contact you within 24 hours.',
                time: 'Today',
                color: 'text-emerald-400',
                dot: 'bg-emerald-400',
              },
              {
                step: 2,
                title: 'Site Survey',
                desc: 'A technician visits to measure your roof, check your electrical panel, and confirm the design.',
                time: '1–5 business days',
                color: 'text-sky-400',
                dot: 'bg-sky-400',
              },
              {
                step: 3,
                title: 'Permits & Engineering',
                desc: 'Your installer submits permits to the city and files interconnection paperwork with your utility.',
                time: '2–6 weeks',
                color: 'text-violet-400',
                dot: 'bg-violet-400',
              },
              {
                step: 4,
                title: 'Installation Day',
                desc: 'Your system is installed — typically 1–2 days. Panels, wiring, inverter, and monitoring.',
                time: '1–2 days on-site',
                color: 'text-amber-400',
                dot: 'bg-amber-400',
              },
              {
                step: 5,
                title: 'Inspection & Permission to Operate',
                desc: 'City inspection is completed and your utility grants Permission to Operate (PTO). System turns on.',
                time: '1–3 weeks after install',
                color: 'text-orange-400',
                dot: 'bg-orange-400',
              },
              {
                step: 6,
                title: 'You\'re Generating Solar Energy',
                desc: 'Your system is live. Monitor production from your phone and watch your bill drop.',
                time: 'Ongoing',
                color: 'text-green-400',
                dot: 'bg-green-400',
              },
            ].map((s, idx, arr) => (
              <div key={s.step} className="flex gap-3">
                {/* Timeline spine */}
                <div className="flex flex-col items-center flex-shrink-0">
                  <div className={`w-7 h-7 rounded-full border-2 border-slate-700 flex items-center justify-center text-xs font-black ${s.color}`}>
                    {s.step}
                  </div>
                  {idx < arr.length - 1 && (
                    <div className="w-px flex-1 bg-slate-700/50 my-1" />
                  )}
                </div>
                {/* Content */}
                <div className={`pb-${idx < arr.length - 1 ? '4' : '0'} flex-1 min-w-0`}>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className={`text-sm font-semibold ${s.color}`}>{s.title}</span>
                    <span className="text-xs text-slate-500 bg-slate-800/60 px-2 py-0.5 rounded-full border border-slate-700/50">{s.time}</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Why Solar / Trust section */}
        <div className="proposal-sec grid grid-cols-1 md:grid-cols-3 gap-2" data-block-id="trust-performance">
          {[
            { icon: <Shield size={20} />, title: '25-Year Warranty', desc: 'Full coverage on panels, inverter, and mounting system for complete peace of mind.' },
            { icon: <Award size={20} />, title: 'Licensed & Insured', desc: 'Fully licensed installers with comprehensive insurance coverage on every job.' },
            { icon: <Star size={20} />, title: 'Local Expertise', desc: 'Deep knowledge of local utility rules, incentives, and permitting requirements.' },
          ].map(t => (
            <div key={t.title} className="card p-3 text-center">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-3" style={{ background: `${primaryColor}20`, color: primaryColor }}>
                {t.icon}
              </div>
              <div className="font-semibold text-white text-sm mb-1">{t.title}</div>
              <div className="text-xs text-slate-400">{t.desc}</div>
            </div>
          ))}
        </div>


        {/* Testimonial / Company Intro block */}
        <div className="proposal-sec card p-5" data-block-id="testimonial">
          <div className="text-center mb-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-800/60 border border-slate-700/30 mb-3">
              {branding.companyLogoUrl ? (
                <img src={branding.companyLogoUrl} alt={branding.companyName} className="h-5 object-contain" />
              ) : (
                <Sun size={13} style={{ color: primaryColor }} />
              )}
              <span className="text-xs font-semibold text-slate-300">{branding.companyName}</span>
            </div>
            <h2 className="text-lg font-black text-white mb-1">Why Homeowners Choose Us</h2>
            <p className="text-slate-400 text-sm max-w-xl mx-auto">
              We&apos;ve helped hundreds of families take control of their energy costs with clean, locally-installed solar.
            </p>
          </div>

          {/* Testimonial quote */}
          <div className="relative rounded-xl p-4 border border-slate-700/40" style={{ background: `${primaryColor}08` }}>
            <div className="text-3xl leading-none mb-2" style={{ color: primaryColor, opacity: 0.4 }}>&ldquo;</div>
            <p className="text-slate-300 text-sm leading-relaxed italic">
              Going solar was the best decision we made. Our electric bill dropped from $280/month to under $40, and the install crew was professional from start to finish. We&apos;ve already recommended {branding.companyName} to three of our neighbors.
            </p>
            <div className="flex items-center gap-3 mt-3">
              <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-slate-400 text-sm font-bold flex-shrink-0">M</div>
              <div>
                <div className="text-white text-xs font-semibold">Michael R. — Verified Customer</div>
                <div className="flex items-center gap-0.5 mt-0.5">
                  {[1,2,3,4,5].map(s => (
                    <Star key={s} size={10} className="text-amber-400 fill-amber-400" />
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Company details */}
          {(branding.companyAddress || branding.companyPhone || branding.companyWebsite) && (
            <div className="flex flex-wrap items-center justify-center gap-4 mt-4 pt-3 border-t border-slate-700/40">
              {branding.companyAddress && (
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  <MapPin size={11} className="text-slate-600" />
                  {branding.companyAddress}
                </div>
              )}
              {branding.companyPhone && (
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  <Phone size={11} className="text-slate-600" />
                  {branding.companyPhone}
                </div>
              )}
              {branding.companyWebsite && (
                <a href={branding.companyWebsite} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs hover:text-white transition-colors"
                  style={{ color: primaryColor }}>
                  <ExternalLink size={11} />
                  {branding.companyWebsite.replace(/^https?:\/\//, '')}
                </a>
              )}
            </div>
          )}
        </div>

        {/* CTA — Installer Preview (Sign button shown to customers, not here) */}
        <div className="proposal-sec rounded-2xl p-6 text-center border" data-block-id="cta" data-keep-together="true" style={{ background: `${primaryColor}08`, borderColor: `${primaryColor}25` }}>
          {/* Installer Preview badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 text-xs font-semibold mb-4">
            <Eye size={11} />
            Installer Preview — Customers See a Sign Button Here
          </div>
          <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3" style={{ background: `${primaryColor}20`, border: `1px solid ${primaryColor}40` }}>
            <Sun size={22} style={{ color: primaryColor }} />
          </div>
          <h2 className="text-2xl font-black text-white mb-2">Ready to Go Solar?</h2>
          <p className="text-slate-400 text-sm mb-5 max-w-md mx-auto">
            Share this proposal with your customer. They&apos;ll be able to review, sign, and accept it online.
          </p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <button
              onClick={onDownload}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl text-slate-900 font-bold text-sm transition-all hover:opacity-90 active:scale-95"
              style={{ background: primaryColor }}
            >
              <Download size={15} />
              Download PDF
            </button>
            <button
              onClick={handleShare}
              disabled={shareLoading}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl border border-slate-600 text-slate-300 hover:text-white hover:border-slate-500 text-sm font-semibold transition-colors"
            >
              {shareLoading ? <span className="spinner w-4 h-4" /> : <Share2 size={15} />}
              {shareCopied ? 'Link Copied!' : 'Share Proposal'}
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-slate-700/50 pt-4 pb-6 text-center">
          <div className="flex items-center justify-center gap-2 mb-3">
            {branding.companyLogoUrl ? (
              <img src={branding.companyLogoUrl} alt={branding.companyName} className="h-6 object-contain opacity-60" />
            ) : (
              <span className="text-slate-400 font-semibold text-sm">{branding.companyName}</span>
            )}
          </div>
          <div className="flex items-center justify-center gap-4 text-xs text-slate-500 flex-wrap">
            {branding.companyPhone && (
              <span className="flex items-center gap-1"><Phone size={11} />{branding.companyPhone}</span>
            )}
            {branding.companyWebsite && (
              <a href={branding.companyWebsite} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-slate-300">
                <ExternalLink size={11} />{branding.companyWebsite.replace(/^https?:\/\//, '')}
              </a>
            )}
            {branding.companyAddress && (
              <span className="flex items-center gap-1"><MapPin size={11} />{branding.companyAddress}</span>
            )}
          </div>
          {branding.proposalFooterText && (
            <p className="text-slate-600 text-xs mt-3 max-w-2xl mx-auto">{branding.proposalFooterText}</p>
          )}
          <p className="text-slate-700 text-xs mt-4">
            Powered by SolarPro &middot; Proposal generated {new Date(proposal.createdAt).toLocaleDateString()}
          </p>
        </div>
      </div>


      {/* v47.332: PDF Density Optimization Styles */}
      <style>{`
        #proposal-document .proposal-sec {
          margin-bottom: 10px;
        }
        #proposal-document .proposal-sec[data-block-id="hero"] {
          margin-bottom: 8px;
        }
        #proposal-document .proposal-sec .card,
        #proposal-document .proposal-sec.card {
          padding: 14px;
        }
        #proposal-document h2 {
          font-size: 0.95rem;
          margin-bottom: 8px;
        }
        #proposal-document h3 {
          font-size: 0.82rem;
          margin-bottom: 6px;
        }
        @media print {
          #proposal-document .proposal-sec {
            margin-bottom: 8px;
            page-break-inside: avoid;
          }
          #proposal-document {
            padding: 0 !important;
          }
        }
      `}</style>
      {/* Print styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-content { padding: 0 !important; }
          body { background: white !important; color: black !important; }
        }
      `}</style>
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
}
