'use client';
import React, { useEffect, useState } from 'react';
import AppShell from '@/components/ui/AppShell';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Save, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { NotFoundState } from '@/components/ui/NotFoundState';
import type { Client } from '@/types';
import { useAppStore } from '@/store/appStore';
import AddressAutocomplete, { type AddressSuggestion } from '@/components/ui/AddressAutocomplete';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function EditClientPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  // ✅ Phase 6: Use store's updateClientInStore — handles PUT → DB → store update → localStorage
  const updateClientInStore = useAppStore(s => s.updateClientInStore);
  const clients = useAppStore(s => s.clients);

  const [client, setClient] = useState<Client | null>(null);
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check store first
    const existing = clients.find(c => c.id === id);
    if (existing) {
      setClient(existing);
      setForm(existing);
      return;
    }
    // Fall back to direct fetch
    fetch(`/api/clients/${id}`)
      .then(r => r.json())
      .then(d => {
        if (d.success && d.data) {
          setClient(d.data);
          setForm(d.data);
        }
      });
  }, [id, clients]);

  const set = (k: string, v: any) => setForm((prev: any) => ({ ...prev, [k]: v }));

  // When user picks an address suggestion, resolve full location and populate fields
  const handleAddressSelect = async (suggestion: AddressSuggestion) => {
    const picked = suggestion.short_name || suggestion.display_name;
    set('address', picked);
    try {
      const res = await fetch('/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: picked }),
      });
      const geo = await res.json();
      if (geo.success && geo.location) {
        const loc = geo.location;
        setForm((prev: any) => ({
          ...prev,
          address: picked,
          city: loc.city || prev.city,
          state: loc.stateCode || prev.state,
          zip: loc.zip || prev.zip,
        }));
      }
    } catch {}
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      // ✅ updateClientInStore: PUT → DB → updates store → updates localStorage mirror
      await updateClientInStore(id, form);
      router.push(`/clients/${id}`);
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  if (!client) return (
    <AppShell>
      {clients.length > 0 ? (
        <NotFoundState
          title="Client not found"
          message="This client may have been deleted or the link is incorrect."
          backHref="/clients"
          backLabel="Back to Clients"
        />
      ) : (
        <div className="p-6 flex items-center justify-center h-64">
          <div className="spinner w-8 h-8" />
        </div>
      )}
    </AppShell>
  );

  return (
    <AppShell>
      <div className="p-6 max-w-2xl mx-auto space-y-6 animate-fade-in">
        <div className="flex items-center gap-3">
          <Link href={`/clients/${id}`} className="btn-ghost p-2 rounded-lg"><ArrowLeft size={18} /></Link>
          <h1 className="text-xl font-bold text-white">Edit Client</h1>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-red-400 text-sm">
            <AlertTriangle size={13} className="inline -mt-px mr-1" /> {error}
          </div>
        )}

        <div className="card p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2"><label className="input-label">Full Name</label><input className="input" value={form.name || ''} onChange={e => set('name', e.target.value)} /></div>
            <div><label className="input-label">Email</label><input className="input" type="email" value={form.email || ''} onChange={e => set('email', e.target.value)} /></div>
            <div><label className="input-label">Phone</label><input className="input" value={form.phone || ''} onChange={e => set('phone', e.target.value)} /></div>
            <div className="col-span-2"><label className="input-label">Address</label><AddressAutocomplete value={form.address || ''} onChange={v => set('address', v)} onSelect={handleAddressSelect} placeholder="Start typing an address..." inputClassName="text-sm" /></div>
            <div><label className="input-label">City</label><input className="input" value={form.city || ''} onChange={e => set('city', e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="input-label">State</label><input className="input" value={form.state || ''} onChange={e => set('state', e.target.value.toUpperCase())} maxLength={2} /></div>
              <div><label className="input-label">ZIP</label><input className="input" value={form.zip || ''} onChange={e => set('zip', e.target.value)} /></div>
            </div>
            <div><label className="input-label">Utility Provider</label><input className="input" value={form.utilityProvider || ''} onChange={e => set('utilityProvider', e.target.value)} /></div>
            <div><label className="input-label">Utility Rate ($/kWh)</label><input className="input" type="number" step="0.001" value={form.utilityRate || ''} onChange={e => {
              const rate = parseFloat(e.target.value) || 0;
              set('utilityRate', rate);
              const annualKwh = (form.monthlyKwh || []).reduce((s: number, v: number) => s + v, 0) || form.annualKwh || 0;
              if (rate > 0 && annualKwh > 0) set('annualBill', Math.round(annualKwh * rate));
            }} /></div>
          </div>
          <div>
            <label className="input-label">Monthly kWh Usage</label>
            <div className="grid grid-cols-4 gap-2">
              {MONTHS.map((month, i) => (
                <div key={month}>
                  <label className="text-xs text-slate-500 mb-1 block">{month}</label>
                  <input className="input text-center text-xs" type="number" value={form.monthlyKwh?.[i] || 0}
                    onChange={e => {
                      const arr = [...(form.monthlyKwh || Array(12).fill(0))];
                      arr[i] = parseFloat(e.target.value) || 0;
                      const annualKwh = arr.reduce((s: number, v: number) => s + v, 0);
                      const rate = parseFloat(form.utilityRate) || 0;
                      set('monthlyKwh', arr);
                      set('annualKwh', annualKwh);
                      set('averageMonthlyKwh', Math.round(annualKwh / 12));
                      if (rate > 0) set('annualBill', Math.round(annualKwh * rate));
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Link href={`/clients/${id}`} className="btn-secondary">Cancel</Link>
            <button onClick={handleSave} disabled={saving} className="btn-primary">
              {saving ? <><span className="spinner w-4 h-4" /> Saving...</> : <><Save size={14} /> Save Changes</>}
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}