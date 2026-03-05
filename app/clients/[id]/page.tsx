'use client';
import React, { useEffect, useState } from 'react';
import AppShell from '@/components/ui/AppShell';
import { useParams, useRouter } from 'next/navigation';
import type { Client } from '@/types';
import { useAppStore } from '@/store/appStore';
import {
  ArrowLeft, Mail, Phone, MapPin, Zap, DollarSign,
  Building2, Plus, Edit, BarChart2, Sun, RefreshCw
} from 'lucide-react';
import Link from 'next/link';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();

  // ✅ Phase 6: Read from global store — 3-tier fallback (store → server → localStorage)
  const loadActiveProject = useAppStore(s => s.loadActiveProject);
  const clients = useAppStore(s => s.clients);
  const loadClients = useAppStore(s => s.loadClients);

  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // First check if client is already in store
    const existing = clients.find(c => c.id === id);
    if (existing) {
      setClient(existing);
      setLoading(false);
      return;
    }
    // Otherwise fetch from server (which also updates the store)
    fetch(`/api/clients/${id}`)
      .then(r => r.json())
      .then(d => {
        if (d.success && d.data) {
          setClient(d.data);
          // Refresh store so this client appears everywhere
          loadClients(true);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id, clients, loadClients]);

  if (loading) return <AppShell><div className="p-6 flex items-center justify-center h-64"><div className="spinner w-8 h-8" /></div></AppShell>;
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
                { label: 'Annual Bill', value: `$${client.annualBill.toLocaleString()}`, icon: <DollarSign size={14} />, color: 'text-emerald-400' },
                { label: 'Avg Monthly', value: `${client.averageMonthlyKwh.toLocaleString()} kWh`, icon: <BarChart2 size={14} />, color: 'text-blue-400' },
                { label: 'Utility Rate', value: `$${client.utilityRate}/kWh`, icon: <DollarSign size={14} />, color: 'text-purple-400' },
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