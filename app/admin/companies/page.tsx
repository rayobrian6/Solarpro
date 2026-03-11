'use client';
import { useEffect, useState } from 'react';
import { Building2, RefreshCw, Users, FolderOpen } from 'lucide-react';

export default function AdminCompanies() {
  const [companies, setCompanies] = useState<any[]>([]);
  const [loading, setLoading]     = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      // Derive companies from users grouped by company field
      const res = await fetch('/api/admin/users?limit=500');
      const d = await res.json();
      if (d.success) {
        const map: Record<string, any> = {};
        for (const u of d.users) {
          const co = u.company || 'Unknown';
          if (!map[co]) map[co] = { name: co, users: [], plans: new Set() };
          map[co].users.push(u);
          map[co].plans.add(u.plan);
        }
        const list = Object.values(map).sort((a: any, b: any) => b.users.length - a.users.length);
        setCompanies(list);
      }
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-white">Company / Installer Management</h1>
          <p className="text-sm text-slate-400 mt-1">{companies.length} companies on platform</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 text-xs text-slate-400 hover:text-white border border-white/10 rounded-lg px-3 py-2 transition-all">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="text-center py-16 text-slate-500"><RefreshCw size={18} className="animate-spin inline mr-2" />Loading...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {companies.map((co: any) => {
            const owner = co.users.find((u: any) => u.role === 'super_admin' || u.role === 'admin') || co.users[0];
            const plans = [...co.plans].join(', ');
            const hasFreePass = co.users.some((u: any) => u.is_free_pass);
            return (
              <div key={co.name} className="rounded-xl border border-white/5 bg-white/2 p-5 hover:bg-white/4 transition-colors">
                <div className="flex items-start gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-400 flex-shrink-0">
                    <Building2 size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-white text-sm truncate">{co.name}</div>
                    {owner && <div className="text-xs text-slate-400 truncate">{owner.email}</div>}
                  </div>
                  {hasFreePass && <span className="text-[10px] bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full">⚡ Free Pass</span>}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white/5 rounded-lg p-3 text-center">
                    <div className="text-lg font-black text-white">{co.users.length}</div>
                    <div className="text-[10px] text-slate-500 flex items-center justify-center gap-1"><Users size={9} /> Users</div>
                  </div>
                  <div className="bg-white/5 rounded-lg p-3 text-center">
                    <div className="text-xs font-semibold text-white capitalize">{plans}</div>
                    <div className="text-[10px] text-slate-500">Plan(s)</div>
                  </div>
                </div>
                <div className="mt-3 space-y-1">
                  {co.users.slice(0, 3).map((u: any) => (
                    <div key={u.id} className="flex items-center justify-between text-xs">
                      <span className="text-slate-400 truncate">{u.name}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${u.role === 'admin' || u.role === 'super_admin' ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-500/20 text-slate-500'}`}>
                        {u.role}
                      </span>
                    </div>
                  ))}
                  {co.users.length > 3 && <div className="text-[10px] text-slate-600">+{co.users.length - 3} more</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}