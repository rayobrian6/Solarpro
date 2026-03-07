'use client';
import React, { useEffect, useState, Suspense } from 'react';
import AppShell from '@/components/ui/AppShell';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, FolderOpen, Sun, Layers, Fence, User, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { Client, SystemType } from '@/types';
import { useToast } from '@/components/ui/Toast';
import { useAppStore } from '@/store/appStore';

const SYSTEM_TYPES = [
  {
    type: 'roof' as SystemType,
    label: 'Roof Mount',
    icon: '🏠',
    description: 'Standard rooftop solar installation with panel placement on existing roof surfaces.',
    features: ['Auto roof detection', 'Fire code setbacks', 'Pitch & azimuth optimization', 'Multiple roof planes'],
    color: 'amber',
  },
  {
    type: 'ground' as SystemType,
    label: 'Ground Mount',
    icon: '🌱',
    description: 'Fixed or adjustable tilt ground-mounted array on open land.',
    features: ['Adjustable tilt 0–45°', 'Row spacing optimization', 'Shadow analysis', 'Large-scale arrays'],
    color: 'teal',
  },
  {
    type: 'fence' as SystemType,
    label: 'Sol Fence (Vertical)',
    icon: '🔲',
    description: 'Vertical bifacial fence-integrated solar system for perimeter installations.',
    features: ['90° vertical mounting', 'Bifacial E-W optimization', 'Fence line drawing', 'Dual-sided production'],
    color: 'purple',
  },
];

function NewProjectContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const preselectedClientId = searchParams.get('clientId');

  // ✅ Phase 4: Read clients from global store — always fresh, no independent fetch
  const clients = useAppStore(s => s.clients);
  const clientsState = useAppStore(s => s.clientsState);
  const loadClients = useAppStore(s => s.loadClients);
  const addProject = useAppStore(s => s.addProject);

  const [selectedClient, setSelectedClient] = useState<string>(preselectedClientId || '');
  const [selectedType, setSelectedType] = useState<SystemType | null>(null);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // ✅ Phase 4: Force-refresh clients from server on page visit
  useEffect(() => {
    loadClients(true);
  }, [loadClients]);

  // Auto-generate project name when client + type are selected
  useEffect(() => {
    const client = clients.find(c => c.id === selectedClient);
    if (client && selectedType) {
      setName(`${client.name} - ${SYSTEM_TYPES.find(t => t.type === selectedType)?.label}`);
    }
  }, [selectedClient, selectedType, clients]);

  const handleSubmit = async () => {
    if (!selectedClient || !selectedType || !name) return;
    setSaving(true);
    const toastId = toast.loading('Creating project...', 'Setting up design studio');
    try {
      // ✅ Phase 4: addProject() handles POST → DB → store update → localStorage mirror
      // No more direct fetch() + localSaveProject() — the store owns this flow
      const project = await addProject({
        clientId: selectedClient,
        name,
        systemType: selectedType,
        notes,
      });

      toast.update(toastId, {
        type: 'success',
        title: `Project "${project.name}" created!`,
        message: 'Opening design studio...',
      });
      setTimeout(() => router.push(`/design?projectId=${project.id}`), 600);
    } catch (e: any) {
      console.error('[NewProject] handleSubmit error:', e);
      toast.update(toastId, {
        type: 'error',
        title: 'Project could not be created',
        message: e?.message || 'Please try again. If the problem persists, refresh the page.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell>
      <div className="p-6 max-w-4xl mx-auto animate-fade-in">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/projects" className="btn-ghost p-2 rounded-lg"><ArrowLeft size={18} /></Link>
          <div>
            <h1 className="text-xl font-bold text-white">New Project</h1>
            <p className="text-slate-400 text-sm">Select client and system type to begin</p>
          </div>
        </div>

        <div className="space-y-6">
          {/* Client Selection */}
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <User size={16} className="text-amber-400" />
              <h2 className="font-semibold text-white">Select Client</h2>
            </div>
            {clientsState === 'loading' && clients.length === 0 ? (
              <div className="flex items-center gap-2 py-6 justify-center text-slate-400 text-sm">
                <span className="spinner w-4 h-4" /> Loading clients...
              </div>
            ) : clients.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-slate-400 text-sm">No clients yet.</p>
                <Link href="/clients/new" className="btn-primary mt-3 inline-flex">Add Client First</Link>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {clients.map(client => (
                  <button
                    key={client.id}
                    onClick={() => setSelectedClient(client.id)}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      selectedClient === client.id
                        ? 'border-amber-500/50 bg-amber-500/10'
                        : 'border-slate-700 bg-slate-800/40 hover:border-slate-600'
                    }`}
                  >
                    <div className="font-medium text-white text-sm">{client.name}</div>
                    <div className="text-xs text-slate-400 mt-0.5">{client.city}, {client.state}</div>
                    <div className="text-xs text-amber-400 mt-1">{client.annualKwh.toLocaleString()} kWh/yr</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* System Type Selection */}
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <Sun size={16} className="text-amber-400" />
              <h2 className="font-semibold text-white">Select System Type</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {SYSTEM_TYPES.map(({ type, label, icon, description, features, color }) => (
                <button
                  key={type}
                  onClick={() => setSelectedType(type)}
                  className={`p-4 rounded-xl border text-left transition-all ${
                    selectedType === type
                      ? `border-${color}-500/50 bg-${color}-500/10`
                      : 'border-slate-700 bg-slate-800/40 hover:border-slate-600'
                  }`}
                >
                  <div className="text-3xl mb-2">{icon}</div>
                  <div className="font-semibold text-white text-sm mb-1">{label}</div>
                  <div className="text-xs text-slate-400 mb-3">{description}</div>
                  <ul className="space-y-1">
                    {features.map(f => (
                      <li key={f} className="text-xs text-slate-400 flex items-center gap-1.5">
                        <span className={`w-1 h-1 rounded-full bg-${color}-400 flex-shrink-0`} />
                        {f}
                      </li>
                    ))}
                  </ul>
                  {selectedType === type && (
                    <div className={`mt-3 text-xs font-semibold text-${color}-400 flex items-center gap-1`}>
                      ✓ Selected
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Project Name */}
          {selectedClient && selectedType && (
            <div className="card p-5 animate-fade-in">
              <div className="flex items-center gap-2 mb-4">
                <FolderOpen size={16} className="text-amber-400" />
                <h2 className="font-semibold text-white">Project Details</h2>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="input-label">Project Name *</label>
                  <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Smith Residence - Roof Mount" />
                </div>
                <div>
                  <label className="input-label">Notes (optional)</label>
                  <textarea className="input resize-none" rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any special requirements or notes..." />
                </div>
              </div>
            </div>
          )}

          {/* Submit */}
          <div className="flex justify-end gap-3">
            <Link href="/projects" className="btn-secondary">Cancel</Link>
            <button
              className="btn-primary btn-lg"
              disabled={!selectedClient || !selectedType || !name || saving}
              onClick={handleSubmit}
            >
              {saving ? <><span className="spinner w-4 h-4" /> Creating...</> : <>Create & Open Design Studio <ChevronRight size={16} /></>}
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

export default function NewProjectPage() {
  return (
    <Suspense fallback={<AppShell><div className="flex items-center justify-center h-64"><div className="spinner w-8 h-8" /></div></AppShell>}>
      <NewProjectContent />
    </Suspense>
  );
}