'use client';
import React, { useEffect, useState, Suspense } from 'react';
import AppShell from '@/components/ui/AppShell';
import DesignStudio from '@/components/design/DesignStudio';
import { useSearchParams } from 'next/navigation';
import type { Project } from '@/types';
import { Map, ArrowLeft, Plus, AlertCircle, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useAppStore } from '@/store/appStore';

function DesignContent() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get('projectId');

  // ✅ Phase 5: Use global store — 3-tier fallback: store → server → localStorage
  const loadActiveProject = useAppStore(s => s.loadActiveProject);
  const loadProjects = useAppStore(s => s.loadProjects);
  const projects = useAppStore(s => s.projects);
  const projectsState = useAppStore(s => s.projectsState);

  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (projectId) {
      // ✅ Phase 5: loadActiveProject checks store first, then server, then localStorage
      // This guarantees the project is found even after navigation or cold start
      setLoading(true);
      setError(null);
      loadActiveProject(projectId)
        .then(p => {
          if (p) {
            setProject(p);
          } else {
            setError(`Project not found. It may have been deleted or the link is invalid.`);
          }
          setLoading(false);
        })
        .catch(err => {
          setError(err?.message || 'Failed to load project');
          setLoading(false);
        });
    } else {
      // No projectId — show project selector, force-refresh list
      loadProjects(true).finally(() => setLoading(false));
    }
  }, [projectId, loadActiveProject, loadProjects]);

  const handleRetry = () => {
    if (projectId) {
      setLoading(true);
      setError(null);
      loadActiveProject(projectId)
        .then(p => {
          setProject(p);
          if (!p) setError('Project not found after retry.');
        })
        .catch(err => setError(err?.message || 'Failed to load project'))
        .finally(() => setLoading(false));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="spinner w-10 h-10 mx-auto mb-3" />
          <p className="text-slate-400">Loading design studio...</p>
        </div>
      </div>
    );
  }

  // Error state — project not found
  if (projectId && error) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <div className="card p-8 max-w-md w-full text-center space-y-4">
          <div className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto">
            <AlertCircle size={24} className="text-red-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white mb-1">Project Not Found</h2>
            <p className="text-slate-400 text-sm">{error}</p>
            <p className="text-slate-500 text-xs mt-2">Project ID: {projectId}</p>
          </div>
          <div className="flex gap-3 justify-center">
            <button
              onClick={handleRetry}
              className="btn-secondary flex items-center gap-2"
            >
              <RefreshCw size={14} /> Retry
            </button>
            <Link href="/projects" className="btn-primary">
              Back to Projects
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Project loaded — open design studio
  if (projectId && project) {
    return <DesignStudio project={project} />;
  }

  // Project selector (no projectId in URL)
  const isLoadingProjects = projectsState === 'loading' && projects.length === 0;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
          <Map size={18} className="text-amber-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">Design Studio</h1>
          <p className="text-slate-400 text-sm">Select a project to open in the design studio</p>
        </div>
      </div>

      {isLoadingProjects ? (
        <div className="card p-12 text-center">
          <div className="spinner w-8 h-8 mx-auto mb-3" />
          <p className="text-slate-400 text-sm">Loading projects...</p>
        </div>
      ) : projects.length === 0 ? (
        <div className="card p-12 text-center">
          <Map size={40} className="text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400 font-medium">No projects yet</p>
          <Link href="/projects/new" className="btn-primary mt-4 inline-flex">
            <Plus size={16} /> Create First Project
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map(p => (
            <Link
              key={p.id}
              href={`/design?projectId=${p.id}`}
              className="card-hover p-4 group"
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl mb-3 ${
                p.systemType === 'roof' ? 'bg-amber-500/10' :
                p.systemType === 'ground' ? 'bg-teal-500/10' : 'bg-purple-500/10'
              }`}>
                {p.systemType === 'roof' ? '🏠' : p.systemType === 'ground' ? '🌱' : '🔲'}
              </div>
              <h3 className="font-semibold text-white text-sm group-hover:text-amber-300 transition-colors">{p.name}</h3>
              <p className="text-xs text-slate-400 mt-1">{p.client?.name}</p>
              <div className="flex items-center gap-2 mt-3">
                <span className={`badge ${p.systemType === 'roof' ? 'badge-roof' : p.systemType === 'ground' ? 'badge-ground' : 'badge-fence'}`}>
                  {p.systemType}
                </span>
                <span className={`badge badge-${p.status}`}>{p.status}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function DesignPageInner() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get('projectId');

  if (projectId) {
    // Full-screen design studio (no AppShell)
    return (
      <div className="h-screen flex flex-col bg-slate-950">
        <div className="flex items-center gap-3 px-4 py-2 bg-slate-900 border-b border-slate-700/50">
          <Link href="/projects" className="btn-ghost p-1.5 rounded-lg">
            <ArrowLeft size={16} />
          </Link>
          <span className="text-xs text-slate-400">Design Studio</span>
        </div>
        <div className="flex-1 min-h-0">
          <DesignContent />
        </div>
      </div>
    );
  }

  return (
    <AppShell>
      <DesignContent />
    </AppShell>
  );
}

export default function DesignPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen bg-slate-950"><div className="spinner w-8 h-8" /></div>}>
      <DesignPageInner />
    </Suspense>
  );
}