'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  Phone, Mail, Globe, MapPin, RefreshCw, PhoneOff, ThumbsUp, RotateCcw,
  DollarSign, X, Star, LogOut, BookOpen, Clock,
} from 'lucide-react';

type Call = { at: string; by?: string; action: string; note?: string | null };
type Lead = {
  id: string; company_name: string; contact_name: string | null;
  email: string | null; phone: string | null; website: string | null;
  city: string | null; state: string | null; rating: number | null; review_count: number | null;
  quality_score: number | null; stage: string; notes: string | null;
  metadata?: { dossier?: { whyCall?: string; opener?: string; facts?: string[] }; calls?: Call[] } | null;
};
type View = 'active' | 'won' | 'dead';

function tierOf(s: number | null) {
  const v = s ?? 0;
  if (v >= 70) return { label: '🔥 Hot', cls: 'text-rose-300 bg-rose-500/15 border-rose-500/30' };
  if (v >= 40) return { label: 'Warm', cls: 'text-amber-300 bg-amber-500/15 border-amber-500/30' };
  return { label: 'Cold', cls: 'text-sky-300 bg-sky-500/15 border-sky-500/30' };
}
const ACTION_LABEL: Record<string, string> = {
  called: 'no answer', interested: 'interested', callback: 'callback', sold: 'SOLD', not_interested: 'not interested',
};

export default function LeadDeskBoard({ name }: { name: string }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [view, setView] = useState<View>('active');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [counts, setCounts] = useState<{ qualified: number; contacted: number; signed_up: number }>({ qualified: 0, contacted: 0, signed_up: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/lead-desk?view=${view}`);
      const data = await res.json();
      if (data.success) {
        setLeads(data.leads);
        const bs = data.stats?.byStage || {};
        setCounts({ qualified: bs.qualified || 0, contacted: bs.contacted || 0, signed_up: bs.signed_up || 0 });
      }
    } finally { setLoading(false); }
  }, [view]);

  useEffect(() => { load(); }, [load]);

  async function disposition(id: string, action: string) {
    setBusy(id);
    try {
      await fetch(`/api/lead-desk/${id}/disposition`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, note: notes[id] || '' }),
      });
      setNotes((n) => { const x = { ...n }; delete x[id]; return x; });
      load();
    } finally { setBusy(null); }
  }

  const Tab = ({ v, label, n }: { v: View; label: string; n?: number }) => (
    <button onClick={() => setView(v)}
      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${view === v ? 'bg-amber-500/20 text-amber-300' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}>
      {label}{typeof n === 'number' ? <span className="ml-1.5 opacity-60">{n}</span> : null}
    </button>
  );

  return (
    <div className="min-h-screen bg-[#0a0f1e] text-white">
      {/* Top bar */}
      <div className="sticky top-0 z-10 bg-[#0d1424] border-b border-white/5 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-500 flex items-center justify-center"><Phone size={16} className="text-black" /></div>
          <div>
            <div className="text-sm font-bold">SolarPro Lead Desk</div>
            <div className="text-[11px] text-slate-500">Signed in as {name}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-sm"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh</button>
          <a href="/dashboard" className="text-slate-500 hover:text-white" title="Exit"><LogOut size={16} /></a>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-5 space-y-4">
        {/* KPIs */}
        <div className="grid grid-cols-3 gap-3">
          {[['To call', counts.qualified, 'text-amber-400'], ['In progress', counts.contacted, 'text-sky-400'], ['Sold', counts.signed_up, 'text-emerald-400']].map(([l, v, c]) => (
            <div key={l as string} className="rounded-xl bg-[#0d1424] border border-white/5 p-4">
              <div className={`text-2xl font-bold ${c}`}>{v as number}</div>
              <div className="text-[11px] text-slate-500 uppercase tracking-wide mt-1">{l as string}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-white/5 pb-2">
          <Tab v="active" label="Call list" />
          <Tab v="won" label="Sold" />
          <Tab v="dead" label="Dead" />
        </div>

        {/* Tickets */}
        {loading ? (
          <div className="text-center text-slate-500 py-20">Loading your leads…</div>
        ) : leads.length === 0 ? (
          <div className="text-center py-20 rounded-xl border border-dashed border-white/10 text-slate-500">
            {view === 'active' ? 'No leads to call right now. Ask your admin to run the floor.' : view === 'won' ? 'No sales yet — go get one!' : 'Nothing in the dead pile.'}
          </div>
        ) : (
          <div className="space-y-3">
            {leads.map((p) => {
              const t = tierOf(p.quality_score);
              const d = p.metadata?.dossier;
              const lastCall = p.metadata?.calls?.[p.metadata.calls.length - 1];
              return (
                <div key={p.id} className="rounded-xl bg-[#0d1424] border border-white/5 p-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-white">{p.company_name}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${t.cls}`}>{t.label}</span>
                        {p.stage === 'contacted' ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30">in progress</span> : null}
                      </div>
                      <div className="text-xs text-slate-500 flex items-center gap-1 mt-1">
                        <MapPin size={11} />{[p.city, p.state].filter(Boolean).join(', ') || '—'}
                        {p.rating != null ? <span className="ml-2 flex items-center gap-1"><Star size={11} className="text-amber-400 fill-amber-400" />{p.rating}{p.review_count != null && ` (${p.review_count})`}</span> : null}
                      </div>
                    </div>
                    {/* Contact — the point of the desk */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {p.phone ? <a href={`tel:${p.phone}`} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 text-sm font-semibold hover:bg-emerald-500/25"><Phone size={14} /> {p.phone}</a> : null}
                      {p.email ? <a href={`mailto:${p.email}`} className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-white/5 text-sky-300 text-xs hover:bg-white/10"><Mail size={13} /></a> : null}
                      {p.website ? <a href={p.website.startsWith('http') ? p.website : `https://${p.website}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-white/5 text-slate-300 text-xs hover:bg-white/10"><Globe size={13} /></a> : null}
                    </div>
                  </div>

                  {/* Dossier — what to say */}
                  {d && (d.whyCall || d.opener) ? (
                    <div className="mt-3 rounded-lg bg-violet-500/10 border border-violet-500/20 p-3 text-[12px] space-y-1">
                      {d.whyCall ? <div className="text-violet-300 font-semibold flex items-center gap-1.5"><BookOpen size={13} /> {d.whyCall}</div> : null}
                      {d.opener ? <div className="text-slate-300 italic">&ldquo;{d.opener}&rdquo;</div> : null}
                      {d.facts && d.facts.length > 0 ? <ul className="text-slate-400 list-disc list-inside">{d.facts.map((f, i) => <li key={i}>{f}</li>)}</ul> : null}
                    </div>
                  ) : null}

                  {lastCall && (
                    <div className="mt-2 text-[11px] text-slate-500 flex items-center gap-1.5">
                      <Clock size={11} /> Last: <span className="text-slate-400">{ACTION_LABEL[lastCall.action] || lastCall.action}</span>
                      {lastCall.note && <>— &ldquo;{lastCall.note}&rdquo;</>} {lastCall.by ? <span className="opacity-60">by {lastCall.by}</span> : null}
                    </div>
                  )}

                  {/* Disposition */}
                  {view === 'active' ? (
                    <div className="mt-3 flex items-center gap-2 flex-wrap">
                      <input value={notes[p.id] || ''} onChange={(e) => setNotes((n) => ({ ...n, [p.id]: e.target.value }))}
                        placeholder="call note…" className="flex-1 min-w-[140px] px-3 py-1.5 rounded-lg bg-[#0a0f1e] border border-white/10 text-xs focus:outline-none focus:border-amber-500/40" />
                      <button disabled={busy === p.id} onClick={() => disposition(p.id, 'called')} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/5 text-slate-300 text-xs hover:bg-white/10 disabled:opacity-50"><PhoneOff size={13} /> No answer</button>
                      <button disabled={busy === p.id} onClick={() => disposition(p.id, 'interested')} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-sky-500/15 text-sky-300 text-xs hover:bg-sky-500/25 disabled:opacity-50"><ThumbsUp size={13} /> Interested</button>
                      <button disabled={busy === p.id} onClick={() => disposition(p.id, 'callback')} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-500/15 text-amber-300 text-xs hover:bg-amber-500/25 disabled:opacity-50"><RotateCcw size={13} /> Callback</button>
                      <button disabled={busy === p.id} onClick={() => disposition(p.id, 'sold')} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 text-xs font-bold hover:bg-emerald-500/30 disabled:opacity-50"><DollarSign size={13} /> Sold</button>
                      <button disabled={busy === p.id} onClick={() => disposition(p.id, 'not_interested')} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/5 text-slate-500 text-xs hover:text-rose-400 hover:bg-rose-500/10 disabled:opacity-50"><X size={13} /> Dead</button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
