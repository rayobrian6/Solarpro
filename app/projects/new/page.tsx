'use client';
import React, { useEffect, useState, Suspense } from 'react';
import AppShell from '@/components/ui/AppShell';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, FolderOpen, Sun, Layers, Fence, User, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { Client, SystemType } from '@/types';
import { useToast } from '@/components/ui/Toast';
import { useAppStore } from '@/store/appStore';
import { MapPin, Upload, Zap, Building2, Loader2, CheckCircle } from 'lucide-react';
import BillUploadFlow from '@/components/onboarding/BillUploadFlow';

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
  const [showBillUpload, setShowBillUpload] = useState(false);
  const [address, setAddress] = useState('');
  const [geocoding, setGeocoding] = useState(false);
  const [locationData, setLocationData] = useState<{
    city: string; county: string; state: string; stateCode: string;
    zip: string; lat: number; lng: number;
  } | null>(null);
  const [utilityData, setUtilityData] = useState<{
    utilityName: string; avgRatePerKwh: number; netMeteringEligible: boolean;
  } | null>(null);
  const [billSystemKw, setBillSystemKw] = useState<number | null>(null);

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

  // Auto-geocode address and detect utility
  const handleAddressBlur = async () => {
    if (!address.trim() || geocoding) return;
    setGeocoding(true);
    try {
      const res = await fetch('/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      const geo = await res.json();
      if (geo.success && geo.location) {
        setLocationData(geo.location);
        // Auto-detect utility
        const uRes = await fetch('/api/utility-detect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lat: geo.location.lat,
            lng: geo.location.lng,
            stateCode: geo.location.stateCode,
            city: geo.location.city,
          }),
        });
        const uData = await uRes.json();
        if (uData.success && uData.utility) {
          setUtilityData(uData.utility);
        }
      }
    } catch {}
    setGeocoding(false);
  };

  const handleBillUploadComplete = (result: any) => {
    if (result.locationData) setLocationData(result.locationData);
    if (result.utilityData) setUtilityData(result.utilityData);
    if (result.systemKw) setBillSystemKw(result.systemKw);
    if (result.billData?.serviceAddress) setAddress(result.billData.serviceAddress);
    setShowBillUpload(false);
    toast.success('Bill processed!', 'Location, utility, and system size auto-populated');
  };

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
        address: address || undefined,
        lat: locationData?.lat,
        lng: locationData?.lng,
        stateCode: locationData?.stateCode,
        city: locationData?.city,
        county: locationData?.county,
        zip: locationData?.zip,
        utilityName: utilityData?.utilityName,
        utilityRatePerKwh: utilityData?.avgRatePerKwh,
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

                {/* ── Bill Upload Shortcut ── */}
                <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Upload size={15} className="text-amber-400" />
                      <div>
                        <p className="text-white text-sm font-medium">Upload Electric Bill</p>
                        <p className="text-slate-400 text-xs">Auto-detect utility, location &amp; system size</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowBillUpload(!showBillUpload)}
                      className="btn-secondary text-xs py-1.5 px-3"
                    >
                      {showBillUpload ? 'Hide' : 'Upload Bill'}
                    </button>
                  </div>
                  {showBillUpload && (
                    <div className="mt-4">
                      <BillUploadFlow
                        onComplete={handleBillUploadComplete}
                        onClose={() => setShowBillUpload(false)}
                      />
                    </div>
                  )}
                </div>

                {/* ── Project Address ── */}
                <div>
                  <label className="input-label flex items-center gap-1">
                    <MapPin size={12} className="text-slate-400" /> Project Address
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={address}
                      onChange={e => setAddress(e.target.value)}
                      onBlur={handleAddressBlur}
                      placeholder="123 Main St, City, ST 12345"
                      className="input pr-8"
                    />
                    {geocoding && (
                      <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-amber-400 animate-spin" />
                    )}
                    {locationData && !geocoding && (
                      <CheckCircle size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-400" />
                    )}
                  </div>
                  {locationData && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className="inline-flex items-center gap-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2 py-0.5 text-xs text-emerald-300">
                        <MapPin size={10} /> {locationData.city}, {locationData.stateCode} {locationData.zip}
                      </span>
                      {utilityData && (
                        <span className="inline-flex items-center gap-1 bg-blue-500/10 border border-blue-500/20 rounded-full px-2 py-0.5 text-xs text-blue-300">
                          <Zap size={10} /> {utilityData.utilityName} · ${utilityData.avgRatePerKwh.toFixed(3)}/kWh
                        </span>
                      )}
                      {utilityData?.netMeteringEligible && (
                        <span className="inline-flex items-center gap-1 bg-amber-500/10 border border-amber-500/20 rounded-full px-2 py-0.5 text-xs text-amber-300">
                          ✓ Net Metering Eligible
                        </span>
                      )}
                    </div>
                  )}
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