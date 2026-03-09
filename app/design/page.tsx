'use client';
import React, { useEffect, useState, Suspense } from 'react';
import AppShell from '@/components/ui/AppShell';
import DesignStudio from '@/components/design/DesignStudio';
import { useSearchParams } from 'next/navigation';
import type { Project } from '@/types';
import { Map, ArrowLeft, Plus, AlertCircle, RefreshCw, Zap, MapPin, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useAppStore } from '@/store/appStore';

// ── Quick-launch demo project (no DB required) ──────────────────────────────
function makeDemoProject(address: string, lat: number, lng: number): Project {
  return {
    id: 'demo-' + Date.now(),
    userId: 'demo',
    clientId: undefined,
    client: undefined,
    name: 'Quick Design — ' + (address || 'Demo Site'),
    status: 'lead',
    systemType: 'roof',
    notes: 'Quick-launch demo project',
    address,
    lat,
    lng,
    systemSizeKw: undefined,
    layout: undefined,
    production: undefined,
    costEstimate: undefined,
    selectedPanel: undefined,
    selectedInverter: undefined,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as Project;
}

// ── Quick Launch Panel ───────────────────────────────────────────────────────
function QuickLaunch({ onLaunch }: { onLaunch: (project: Project) => void }) {
  const [address, setAddress] = useState('');
  const [geocoding, setGeocoding] = useState(false);
  const [error, setError] = useState('');

  const handleLaunch = async () => {
    if (!address.trim()) { setError('Please enter an address'); return; }
    setGeocoding(true);
    setError('');
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(address)}&mode=search`);
      const data = await res.json();
      if (data.success && data.results?.[0]) {
        const r = data.results[0];
        onLaunch(makeDemoProject(address, r.lat, r.lng));
      } else if (data.lat && data.lng) {
        onLaunch(makeDemoProject(address, data.lat, data.lng));
      } else {
        // Launch with a default center — design studio will let user search
        onLaunch(makeDemoProject(address, 39.8283, -98.5795));
      }
    } catch {
      // Still launch — design studio has its own address search
      onLaunch(makeDemoProject(address, 39.8283, -98.5795));
    } finally {
      setGeocoding(false);
    }
  };

  return (
    <div className="card p-6 border-amber-500/30 bg-amber-500/5">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center">
          <Zap size={16} className="text-amber-400" />
        </div>
        <div>
          <h3 className="font-semibold text-white text-sm">Quick Launch — No Project Needed</h3>
          <p className="text-slate-400 text-xs">Jump straight into 3D design with just an address</p>
        </div>
      </div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={address}
            onChange={e => setAddress(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLaunch()}
            placeholder="Enter any address to open 3D design..."
            className="input pl-8 text-sm w-full"
          />
        </div>
        <button
          onClick={handleLaunch}
          disabled={geocoding}
          className="btn-primary px-4 flex items-center gap-2 whitespace-nowrap"
        >
          {geocoding ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
          {geocoding ? 'Loading...' : 'Open 3D Design'}
        </button>
      </div>
      {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
      <p className="text-slate-500 text-xs mt-2">
        💡 You can also search for any address inside the design studio after it opens.
      </p>
    </div>
  );
}

function DesignContent({ onQuickLaunch }: { onQuickLaunch?: (p: Project) => void }) {
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

  // Error state — project not found: show quick launch instead of dead end
  if (projectId && error) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <div className="card p-8 max-w-lg w-full space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
              <AlertCircle size={20} className="text-red-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Project Not Found</h2>
              <p className="text-slate-400 text-sm">{error}</p>
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={handleRetry} className="btn-secondary flex items-center gap-2 text-sm">
              <RefreshCw size={13} /> Retry
            </button>
            <Link href="/projects" className="btn-secondary text-sm">Back to Projects</Link>
            <Link href="/projects/new" className="btn-primary text-sm flex items-center gap-1">
              <Plus size={13} /> New Project
            </Link>
          </div>
          {/* Quick launch even when project not found */}
          <div className="border-t border-slate-700/50 pt-4">
            <QuickLaunch onLaunch={p => onQuickLaunch ? onQuickLaunch(p) : setProject(p)} />
          </div>
        </div>
      </div>
    );
  }

  // Project loaded — open design studio
  if (project) {
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
          <p className="text-slate-400 text-sm">Select a project or jump straight into 3D design</p>
        </div>
      </div>

      {/* ── Quick Launch (always visible at top) ── */}
      <div className="mb-6">
        <QuickLaunch onLaunch={p => onQuickLaunch ? onQuickLaunch(p) : setProject(p)} />
      </div>

      {isLoadingProjects ? (
        <div className="card p-12 text-center">
          <div className="spinner w-8 h-8 mx-auto mb-3" />
          <p className="text-slate-400 text-sm">Loading projects...</p>
        </div>
      ) : projects.length === 0 ? (
        <div className="card p-8 text-center">
          <Map size={36} className="text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400 font-medium text-sm">No saved projects yet</p>
          <p className="text-slate-500 text-xs mt-1 mb-4">Use Quick Launch above to open 3D design, or create a project to save your work.</p>
          <Link href="/projects/new" className="btn-primary inline-flex text-sm">
            <Plus size={14} /> Create Project
          </Link>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm font-semibold text-slate-300">Saved Projects</h2>
            <span className="text-xs text-slate-500">({projects.length})</span>
          </div>
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
        </>
      )}
    </div>
  );
}

function DesignPageInner() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get('projectId');
  const [activeProject, setActiveProject] = useState<Project | null>(null);

  // When a quick-launch project is set, show full-screen design studio
  if (activeProject) {
    return (
      <div className="h-screen flex flex-col bg-slate-950">
        <div className="flex items-center gap-3 px-4 py-2 bg-slate-900 border-b border-slate-700/50">
          <button onClick={() => setActiveProject(null)} className="btn-ghost p-1.5 rounded-lg">
            <ArrowLeft size={16} />
          </button>
          <span className="text-xs text-slate-400">Design Studio</span>
          <span className="text-xs text-amber-400 ml-1">— {activeProject.name}</span>
          <span className="ml-auto text-xs text-slate-500 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">
            Quick Launch (unsaved)
          </span>
        </div>
        <div className="flex-1 min-h-0">
          <DesignStudio project={activeProject} />
        </div>
      </div>
    );
  }

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
      <DesignContent onQuickLaunch={setActiveProject} />
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