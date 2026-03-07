'use client';
import React, { useEffect, useState } from 'react';
import AppShell from '@/components/ui/AppShell';
import Link from 'next/link';
import {
  FolderOpen, Plus, Search, Sun, Zap, DollarSign,
  ChevronRight, Edit, Trash2, Filter, Map, FileText,
  Calendar, User, RefreshCw, AlertCircle, Lock
} from 'lucide-react';
import type { Project } from '@/types';
import { useAppStore } from '@/store/appStore';
import { useSubscription } from '@/hooks/useSubscription';
import UpgradeModal from '@/components/ui/UpgradeModal';

const STATUS_STEPS = ['lead', 'design', 'proposal', 'approved', 'installed'];
const statusColors: Record<string, string> = {
  lead: 'badge-lead', design: 'badge-design', proposal: 'badge-proposal',
  approved: 'badge-approved', installed: 'badge-installed',
};
const typeColors: Record<string, string> = {
  roof: 'badge-roof', ground: 'badge-ground', fence: 'badge-fence',
};
const typeIcons: Record<string, string> = {
  roof: '🏠', ground: '🌱', fence: '🔲',
};

export default function ProjectsPage() {
  // ✅ Phase 6: Read from global store — single source of truth
  const projects = useAppStore(s => s.projects);
  const projectsState = useAppStore(s => s.projectsState);
  const projectsError = useAppStore(s => s.projectsError);
  const loadProjects = useAppStore(s => s.loadProjects);
  const removeProject = useAppStore(s => s.removeProject);

  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  // Plan gating — Starter: max 2 projects
  const { plan, loading: subLoading } = useSubscription();
  const maxProjects = plan === 'starter' ? 2 : null;
  const atProjectLimit = maxProjects !== null && projects.length >= maxProjects;

  // ✅ Phase 6: Force-refresh from server on every page visit
  useEffect(() => {
    loadProjects(true);
  }, [loadProjects]);

  const loading = projectsState === 'loading' && projects.length === 0;

  const filtered = projects.filter(p => {
    const matchSearch = p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.client?.name || '').toLowerCase().includes(search.toLowerCase());
    const matchType = filterType === 'all' || p.systemType === filterType;
    const matchStatus = filterStatus === 'all' || p.status === filterStatus;
    return matchSearch && matchType && matchStatus;
  });

  // ✅ Phase 8: Delete via store's removeProject (soft delete on server, removes from store + localStorage)
  const handleDelete = async (id: string) => {
    if (!confirm('Delete this project?')) return;
    setDeletingId(id);
    try {
      await removeProject(id);
    } catch (e: any) {
      alert(`Failed to delete project: ${e?.message || 'Unknown error'}`);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <AppShell>
      <div className="p-6 space-y-6 animate-fade-in">
        {/* Upgrade modal */}
        <UpgradeModal
          isOpen={upgradeOpen}
          onClose={() => setUpgradeOpen(false)}
          title="Project Limit Reached"
          description={`Starter plan is limited to ${maxProjects} projects. Upgrade to Professional for unlimited projects.`}
          requiredPlan="Professional"
        />

        {/* Starter limit banner */}
        {atProjectLimit && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex items-center gap-3">
            <Lock size={16} className="text-amber-400 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-amber-300 font-semibold text-sm">Project limit reached ({projects.length}/{maxProjects})</p>
              <p className="text-amber-400/70 text-xs mt-0.5">Starter plan allows up to {maxProjects} projects. Upgrade to Professional for unlimited projects.</p>
            </div>
            <button onClick={() => setUpgradeOpen(true)} className="btn-primary btn-sm flex-shrink-0">Upgrade</button>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Projects</h1>
            <p className="text-slate-400 text-sm mt-0.5">{projects.length} total projects{maxProjects ? ` (${maxProjects} max on Starter)` : ''}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => loadProjects(true)}
              className="btn-ghost p-2 rounded-lg"
              title="Refresh projects"
              disabled={projectsState === 'loading'}
            >
              <RefreshCw size={15} className={projectsState === 'loading' ? 'animate-spin' : ''} />
            </button>
            {atProjectLimit ? (
              <button onClick={() => setUpgradeOpen(true)} className="btn-secondary flex items-center gap-2 opacity-70">
                <Lock size={14} /> New Project
                <span className="text-xs text-amber-400 font-normal">({projects.length}/{maxProjects})</span>
              </button>
            ) : (
              <Link href="/projects/new" className="btn-primary">
                <Plus size={16} /> New Project
              </Link>
            )}
          </div>
        </div>

        {/* Error banner */}
        {projectsError && projects.length > 0 && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 flex items-center gap-3">
            <AlertCircle size={16} className="text-amber-400 flex-shrink-0" />
            <p className="text-amber-400 text-sm flex-1">
              Showing cached data — server sync failed: {projectsError}
            </p>
            <button onClick={() => loadProjects(true)} className="btn-secondary btn-sm">
              Retry
            </button>
          </div>
        )}

        {/* Pipeline Summary */}
        <div className="grid grid-cols-5 gap-2">
          {STATUS_STEPS.map(status => {
            const count = projects.filter(p => p.status === status).length;
            return (
              <button
                key={status}
                onClick={() => setFilterStatus(filterStatus === status ? 'all' : status)}
                className={`card p-3 text-center transition-all hover:border-slate-600 ${filterStatus === status ? 'border-amber-500/40 bg-amber-500/5' : ''}`}
              >
                <div className="text-xl font-bold text-white">{count}</div>
                <div className={`text-xs mt-1 ${statusColors[status]}`}>{status}</div>
              </button>
            );
          })}
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Search projects..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="input pl-9"
            />
          </div>
          <select value={filterType} onChange={e => setFilterType(e.target.value)} className="select w-auto">
            <option value="all">All Types</option>
            <option value="roof">Roof Mount</option>
            <option value="ground">Ground Mount</option>
            <option value="fence">Sol Fence</option>
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="select w-auto">
            <option value="all">All Statuses</option>
            {STATUS_STEPS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>
        </div>

        {/* Projects List */}
        {loading ? (
          <div className="space-y-3">
            {[1,2,3].map(i => <div key={i} className="card p-5 shimmer h-24" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="card p-12 text-center">
            <FolderOpen size={40} className="text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400 font-medium">No projects found</p>
            <Link href="/projects/new" className="btn-primary mt-4 inline-flex">
              <Plus size={16} /> Create Project
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(project => (
              <div key={project.id} className="card-hover p-4 group flex items-center gap-4">
                {/* Type Icon */}
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl flex-shrink-0 ${
                  project.systemType === 'roof' ? 'bg-amber-500/10' :
                  project.systemType === 'ground' ? 'bg-teal-500/10' : 'bg-purple-500/10'
                }`}>
                  {typeIcons[project.systemType]}
                </div>

                {/* Main Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-white text-sm">{project.name}</h3>
                    <span className={typeColors[project.systemType]}>{project.systemType}</span>
                    <span className={statusColors[project.status]}>{project.status}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
                    <span className="flex items-center gap-1"><User size={10} />{project.client?.name}</span>
                    <span className="flex items-center gap-1"><Calendar size={10} />{new Date(project.createdAt).toLocaleDateString()}</span>
                    {project.layout && (
                      <span className="flex items-center gap-1 text-amber-400">
                        <Zap size={10} />{project.layout.systemSizeKw.toFixed(1)} kW
                      </span>
                    )}
                  </div>
                </div>

                {/* Production Info */}
                {project.production && (
                  <div className="hidden md:flex flex-col items-end gap-1 flex-shrink-0">
                    <div className="text-sm font-semibold text-white">
                      {project.production.annualProductionKwh.toLocaleString()} kWh/yr
                    </div>
                    <div className="text-xs text-emerald-400">
                      {project.production.offsetPercentage}% offset
                    </div>
                  </div>
                )}

                {/* Cost */}
                {project.costEstimate && (
                  <div className="hidden lg:flex flex-col items-end gap-1 flex-shrink-0">
                    <div className="text-sm font-semibold text-white">
                      ${project.costEstimate.netCost.toLocaleString()}
                    </div>
                    <div className="text-xs text-slate-400">net cost</div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Link href={`/design?projectId=${project.id}`} className="btn-ghost p-2 rounded-lg" title="Open Design Studio">
                    <Map size={15} />
                  </Link>
                  <Link href={`/proposals?projectId=${project.id}`} className="btn-ghost p-2 rounded-lg" title="Generate Proposal">
                    <FileText size={15} />
                  </Link>
                  <button
                    onClick={() => handleDelete(project.id)}
                    disabled={deletingId === project.id}
                    className="btn-ghost p-2 rounded-lg hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    {deletingId === project.id
                      ? <span className="spinner w-3.5 h-3.5" />
                      : <Trash2 size={15} />
                    }
                  </button>
                  <Link href={`/projects/${project.id}`} className="btn-ghost p-2 rounded-lg">
                    <ChevronRight size={15} />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}