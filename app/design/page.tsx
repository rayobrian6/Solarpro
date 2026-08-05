'use client';
import React, { useEffect, useState, Suspense } from 'react';
import AppShell from '@/components/ui/AppShell';
import DesignStudio from '@/components/design/DesignStudio';
import AddressAutocomplete, { type AddressSuggestion } from '@/components/ui/AddressAutocomplete';
import { useSearchParams, useRouter } from 'next/navigation';
import type { Project } from '@/types';
import { Map, ArrowLeft, Plus, AlertCircle, RefreshCw, Zap, Loader2, Square, ArrowRight } from 'lucide-react';
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

// ── Quick Launch Panel ──────────────────────────────────────────────────────
function QuickLaunch({ onLaunch }: { onLaunch: (project: Project) => void }) {
  const router = useRouter();
  const [address, setAddress] = useState('');
  const [geocoding, setGeocoding] = useState(false);
  const [error, setError] = useState('');
  // When user picks a suggestion we already have lat/lng — skip re-geocoding
  const [picked, setPicked] = useState<{ lat: number; lng: number } | null>(null);

  const handleSelect = (s: AddressSuggestion) => {
    setAddress(s.short_name || s.display_name);
    setPicked({ lat: s.lat, lng: s.lng });
    setError('');
  };

  // Resolve a project for the given address — uses the picked coords if
  // available, otherwise geocodes the free-form text. Returns null on
  // geocoding failure (caller falls back to US center).
  const resolveProject = async (addr?: string): Promise<Project | null> => {
    const target = addr ?? address;
    if (!target.trim()) { setError('Please enter an address'); return null; }
    setError('');
    if (picked) return makeDemoProject(target, picked.lat, picked.lng);
    setGeocoding(true);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(target)}&mode=autocomplete`);
      const data = await res.json();
      const first = data.success && data.data?.[0];
      if (first) return makeDemoProject(first.short_name || target, first.lat, first.lng);
      return makeDemoProject(target, 39.8283, -98.5795);
    } catch {
      return makeDemoProject(target, 39.8283, -98.5795);
    } finally {
      setGeocoding(false);
    }
  };

  const handleLaunch = async (addr?: string) => {
    const p = await resolveProject(addr);
    if (p) onLaunch(p);
  };

  const handleOutlineFirst = async (addr?: string) => {
    const p = await resolveProject(addr);
    if (p) router.push(`/design/outline?projectId=${p.id}`);
  };

  return (
    <div className="card p-6 border-amber-500/30 bg-amber-500/5">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center">
          <Zap size={16} className="text-amber-400" />
        </div>
        <div>
          <h3 className="font-semibold text-white text-sm">Quick Design Session — No Project Needed</h3>
          <p className="text-slate-400 text-xs">Type an address — suggestions appear as you type</p>
        </div>
      </div>
      <div className="flex gap-2 items-start">
        <AddressAutocomplete
          value={address}
          onChange={v => { setAddress(v); setPicked(null); }}
          onSelect={handleSelect}
          onSubmit={handleLaunch}
          placeholder="Enter any address to open 3D design…"
          className="flex-1"
          loading={geocoding}
          autoFocus
        />
        <button
          onClick={() => handleOutlineFirst()}
          disabled={geocoding || !address.trim()}
          className="btn-secondary px-4 flex items-center gap-2 whitespace-nowrap h-[38px]"
          title="Draw the roof outline first, then continue to the 3D studio"
        >
          <Square size={14} />
          Mark out roof
        </button>
        <button
          onClick={() => handleLaunch()}
          disabled={geocoding || !address.trim()}
          className="btn-primary px-4 flex items-center gap-2 whitespace-nowrap h-[38px]"
        >
          {geocoding ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
          {geocoding ? 'Loading…' : 'Open 3D Design'}
        </button>
      </div>
      {error ? <p className="text-red-400 text-xs mt-2">{error}</p> : null}
      <p className="text-slate-500 text-xs mt-2">
        💡 Pick a suggestion to fly straight to the correct rooftop — no extra searching needed.
        Or click <span className="text-amber-400 font-medium">Mark out roof</span> to draw
        the roof outline first.
      </p>
    </div>
  );
}

function DesignContent({ onQuickLaunch }: { onQuickLaunch?: (p: Project) => void }) {
  const searchParams = useSearchParams();
  const projectId = searchParams.get('projectId');

  // Pre-warm Google Maps session token as early as possible so DesignStudio
  // doesn't have to wait for it when it mounts (reduces initial tile render time).
  useEffect(() => {
    fetch('/api/maps-session').catch(() => {/* silently ignore — DesignStudio will retry */});
  }, []);

  // ✅ Phase 5: Use global store — 3-tier fallback: store → server → localStorage
  const loadActiveProject = useAppStore(s => s.loadActiveProject);
  const loadProjects = useAppStore(s => s.loadProjects);
  const projects = useAppStore(s => s.projects);
  const projectsState = useAppStore(s => s.projectsState);
  const syncProjectToStore = useAppStore(s => s.syncProjectToStore);

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
    // FIX v47.221: sync layout into store cache after save so project page sees it
    const handleDesignSave = (savedLayout: import('@/types').Layout) => {
      const updated = { ...project, layout: savedLayout };
      setProject(updated);
      syncProjectToStore(updated);
    };
    return <DesignStudio project={project} onSave={handleDesignSave} />;
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
        <div className="card p-10 text-center">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-4">
            <Map size={28} className="text-amber-400" />
          </div>
          <p className="text-white font-semibold text-base mb-1">Create your first project to get started</p>
          <p className="text-slate-400 text-sm mb-2 max-w-xs mx-auto">
            Projects save your roof layout, system design, and proposals in one place.
          </p>
          <p className="text-slate-500 text-xs mb-5">
            Tip: use the <span className="text-amber-400 font-medium">Quick Design Session</span> panel above to explore the tool without saving.
          </p>
          <Link href="/projects/new" className="btn-primary inline-flex text-sm">
            <Plus size={14} /> Create Your First Project
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
  const e2eQuickDesign = process.env.NEXT_PUBLIC_E2E === '1' && searchParams.get('e2eQuickDesign') === '1';
  const [activeProject, setActiveProject] = useState<Project | null>(null);

  useEffect(() => {
    if (!e2eQuickDesign || activeProject) return;
    setActiveProject(makeDemoProject('1010 Franklin Ave, St Louis, MO', 38.6657, -90.2266));
  }, [activeProject, e2eQuickDesign]);

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
            Quick Design Session
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
