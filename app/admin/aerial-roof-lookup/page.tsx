'use client';
import React, { useState } from 'react';
import { Satellite, Search, Loader2, MapPin, AlertCircle, CheckCircle2, Ruler, Home } from 'lucide-react';

interface RoofPlane {
  worldPolygon: Array<{ lat: number; lng: number }>;
  areaSqft: number | null;
  pitchDeg: number | null;
  azimuthDeg: number | null;
  roofType: string | null;
  material: string | null;
  confidence: number | null;
  captureDate: string | null;
}
interface LookupResult {
  success: boolean;
  configured?: boolean;
  covered?: boolean;
  coverage?: { surveyCount: number; latestCaptureDate: string | null; hasAiFeatures: boolean } | null;
  resolved?: { lat: number; lng: number; address: string | null };
  planes?: RoofPlane[];
  message?: string;
  error?: string;
}

const COLORS = ['#38bdf8', '#f59e0b', '#34d399', '#f472b6', '#a78bfa', '#fb7185', '#22d3ee', '#facc15'];

function RoofFootprint({ planes }: { planes: RoofPlane[] }) {
  const pts = planes.flatMap(p => p.worldPolygon);
  if (pts.length === 0) return null;
  const lats = pts.map(p => p.lat), lngs = pts.map(p => p.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const W = 640, H = 440, pad = 24;
  const sx = (lng: number) => pad + ((lng - minLng) / ((maxLng - minLng) || 1)) * (W - 2 * pad);
  const sy = (lat: number) => pad + ((maxLat - lat) / ((maxLat - minLat) || 1)) * (H - 2 * pad);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto rounded-xl border border-slate-700/60 bg-slate-950/40">
      {planes.map((p, i) => {
        const c = COLORS[i % COLORS.length];
        const d = p.worldPolygon.map((pt, j) => `${j ? 'L' : 'M'}${sx(pt.lng).toFixed(1)},${sy(pt.lat).toFixed(1)}`).join(' ') + ' Z';
        const cx = p.worldPolygon.reduce((s, pt) => s + sx(pt.lng), 0) / p.worldPolygon.length;
        const cy = p.worldPolygon.reduce((s, pt) => s + sy(pt.lat), 0) / p.worldPolygon.length;
        return (
          <g key={i}>
            <path d={d} fill={`${c}30`} stroke={c} strokeWidth={2} />
            <text x={cx} y={cy} fill={c} fontSize="12" fontWeight="600" textAnchor="middle">
              {p.pitchDeg != null ? `${p.pitchDeg}°` : ''}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function AerialRoofLookupPage() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<LookupResult | null>(null);

  const lookup = async () => {
    if (!query.trim()) return;
    setLoading(true); setData(null);
    try {
      const res = await fetch(`/api/admin/aerial-roof-lookup?address=${encodeURIComponent(query.trim())}`);
      setData(await res.json());
    } catch (e) {
      setData({ success: false, error: (e as Error).message });
    } finally {
      setLoading(false);
    }
  };

  const planes = data?.planes ?? [];

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center gap-3 mb-1">
        <Satellite className="text-sky-400" size={26} />
        <h1 className="text-2xl font-bold text-slate-100">Aerial Roof Lookup</h1>
        <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30">Nearmap AI · eval</span>
      </div>
      <p className="text-sm text-slate-400 mb-5">Type an address — pulls real roof geometry (footprint, pitch, area, material) from licensed aerial imagery where covered.</p>

      <div className="flex gap-2 mb-6">
        <div className="flex-1 relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') lookup(); }}
            placeholder="123 Main St, Edwardsville IL 62025"
            className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-slate-800/70 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500"
          />
        </div>
        <button onClick={lookup} disabled={loading}
          className="px-5 py-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-medium flex items-center gap-2">
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Satellite size={16} />}
          {loading ? 'Looking up…' : 'Look up roof'}
        </button>
      </div>

      {data && !data.success && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200">
          <AlertCircle size={20} className="shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold mb-0.5">{data.configured === false ? 'Nearmap not configured' : 'Lookup failed'}</div>
            <div className="text-sm text-rose-200/80">{data.error}</div>
          </div>
        </div>
      )}

      {data?.success && data.covered === false && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200">
          <MapPin size={20} className="shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold mb-0.5">No Nearmap coverage here</div>
            <div className="text-sm text-amber-200/80">{data.message}</div>
            {data.resolved && <div className="text-xs text-amber-200/60 mt-1">{data.resolved.address} · {data.resolved.lat.toFixed(4)}, {data.resolved.lng.toFixed(4)}</div>}
          </div>
        </div>
      )}

      {data?.success && data.covered && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
              <CheckCircle2 size={14} /> Covered
            </span>
            <span className="text-slate-400">{planes.length} roof{planes.length !== 1 ? 's' : ''} found</span>
            {data.coverage?.latestCaptureDate && <span className="text-slate-500">· latest capture {data.coverage.latestCaptureDate}</span>}
            {data.resolved && <span className="text-slate-500">· {data.resolved.lat.toFixed(4)}, {data.resolved.lng.toFixed(4)}</span>}
          </div>

          {planes.length > 0 && <RoofFootprint planes={planes} />}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {planes.map((p, i) => (
              <div key={i} className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/60">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-3 h-3 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />
                  <span className="font-medium text-slate-200">Roof {i + 1}</span>
                  {p.confidence != null && <span className="ml-auto text-xs text-slate-500">{Math.round(p.confidence * 100)}% conf</span>}
                </div>
                <div className="grid grid-cols-2 gap-y-1.5 text-sm">
                  <span className="text-slate-400 flex items-center gap-1"><Home size={13} /> Area</span>
                  <span className="text-slate-200 text-right">{p.areaSqft != null ? `${p.areaSqft.toLocaleString()} ft²` : '—'}</span>
                  <span className="text-slate-400 flex items-center gap-1"><Ruler size={13} /> Pitch</span>
                  <span className="text-slate-200 text-right">{p.pitchDeg != null ? `${p.pitchDeg}°` : '—'}</span>
                  <span className="text-slate-400">Azimuth</span>
                  <span className="text-slate-500 text-right text-xs">derive (follow-up)</span>
                  <span className="text-slate-400">Type</span>
                  <span className="text-slate-200 text-right">{p.roofType ?? '—'}</span>
                  <span className="text-slate-400">Material</span>
                  <span className="text-slate-200 text-right">{p.material ?? '—'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
