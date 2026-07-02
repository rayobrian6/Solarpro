'use client';
import { useEffect, useState, useCallback } from 'react';
import { DollarSign, Users, Armchair, RefreshCw, CreditCard } from 'lucide-react';

type Sub = {
  id: string; status: string; plan: string; seats: number; amount: number;
  email: string; name: string; created: number; renewsAt: number | null;
};
type Stats = { mrr: number; activeCount: number; totalSeats: number; total: number };

const STATUS_CLS: Record<string, string> = {
  active: 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30',
  trialing: 'text-sky-300 bg-sky-500/15 border-sky-500/30',
  past_due: 'text-amber-300 bg-amber-500/15 border-amber-500/30',
  canceled: 'text-slate-400 bg-white/5 border-white/10',
  unpaid: 'text-rose-300 bg-rose-500/15 border-rose-500/30',
};
const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const date = (ts: number | null) => (ts ? new Date(ts * 1000).toLocaleDateString() : '—');

export default function BillingPage() {
  const [subs, setSubs] = useState<Sub[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/admin/billing');
      const data = await res.json();
      if (data.success) { setSubs(data.subs); setStats(data.stats); }
      else setError(data.error || data.message || 'Failed to load billing');
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const Kpi = ({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string | number; accent: string }) => (
    <div className="rounded-xl bg-[#0d1424] border border-white/5 p-4 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${accent}`}>{icon}</div>
      <div>
        <div className="text-2xl font-bold text-white leading-none">{value}</div>
        <div className="text-[11px] text-slate-500 mt-1 uppercase tracking-wide">{label}</div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2"><CreditCard size={22} className="text-emerald-400" /> Billing</h1>
          <p className="text-sm text-slate-400 mt-1">Live subscriptions, seats &amp; revenue — straight from Stripe.</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm text-white transition-colors">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={<DollarSign size={18} className="text-emerald-400" />} accent="bg-emerald-500/15" label="MRR" value={stats ? money(stats.mrr) : '—'} />
        <Kpi icon={<CreditCard size={18} className="text-sky-400" />} accent="bg-sky-500/15" label="Active subs" value={stats?.activeCount ?? '—'} />
        <Kpi icon={<Armchair size={18} className="text-violet-400" />} accent="bg-violet-500/15" label="Extra seats sold" value={stats?.totalSeats ?? '—'} />
        <Kpi icon={<Users size={18} className="text-amber-400" />} accent="bg-amber-500/15" label="Total subs" value={stats?.total ?? '—'} />
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">
          {error}{error.includes('STRIPE') && ' — set the Stripe keys on this deployment.'}
        </div>
      ) : null}

      {loading ? (
        <div className="text-center text-slate-500 py-16">Loading subscriptions…</div>
      ) : subs.length === 0 && !error ? (
        <div className="text-center py-16 rounded-xl border border-dashed border-white/10 text-slate-500">No subscriptions yet.</div>
      ) : (
        <div className="rounded-xl border border-white/5 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-slate-400 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left font-medium px-4 py-3">Account</th>
                <th className="text-left font-medium px-4 py-3">Plan</th>
                <th className="text-right font-medium px-4 py-3">Seats</th>
                <th className="text-right font-medium px-4 py-3">$/mo</th>
                <th className="text-left font-medium px-4 py-3">Status</th>
                <th className="text-left font-medium px-4 py-3">Renews</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {subs.map((s) => (
                <tr key={s.id} className="hover:bg-white/5">
                  <td className="px-4 py-3">
                    <div className="text-white">{s.name || s.email || '—'}</div>
                    {s.name && s.email ? <div className="text-xs text-slate-500">{s.email}</div> : null}
                  </td>
                  <td className="px-4 py-3 text-slate-300">{s.plan}</td>
                  <td className="px-4 py-3 text-right text-slate-300">{s.seats > 0 ? `+${s.seats}` : '—'}</td>
                  <td className="px-4 py-3 text-right font-semibold text-white">{money(s.amount)}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${STATUS_CLS[s.status] || 'text-slate-400 bg-white/5 border-white/10'}`}>{s.status}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-400">{date(s.renewsAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-600">Tip: an account showing <span className="text-violet-300">+1</span> (or more) under Seats means extra-seat billing is working — that's the $29/seat add-on charging.</p>
    </div>
  );
}
