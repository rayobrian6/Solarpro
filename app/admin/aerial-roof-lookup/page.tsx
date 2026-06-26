'use client';
import React, { useState, useRef, useEffect } from 'react';
import 'leaflet/dist/leaflet.css';
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

export default function AerialRoofLookupPage() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<LookupResult | null>(null);
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<{ remove: () => void } | null>(null);

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
  const showMap = !!(data?.success && data.covered && data.resolved);

  // Build the Leaflet map (real Nearmap aerial tiles + AI roof overlay) when results arrive.
  useEffect(() => {
    if (!showMap || !mapEl.current || !data?.resolved) return;
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !mapEl.current) return;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
      const { lat, lng } = data.resolved!;
      const map = L.map(mapEl.current, { center: [lat, lng], zoom: 20, scrollWheelZoom: true });
      mapRef.current = map as unknown as { remove: () => void };
      L.tileLayer('/api/admin/nearmap-tile/{z}/{x}/{y}', {
        maxZoom: 22, maxNativeZoom: 21, minZoom: 16, tileSize: 256,
        attribution: 'Imagery © Nearmap',
      }).addTo(map);
      const bounds: Array<[number, number]> = [];
      planes.forEach((p, i) => {
        const latlngs = p.worldPolygon.map(pt => [pt.lat, pt.lng] as [number, number]);
        latlngs.forEach(ll => bounds.push(ll));
        const c = COLORS[i % COLORS.length];
        L.polygon(latlngs, { color: c, weight: 2.5, fillColor: c, fillOpacity: 0.18 })
          .bindTooltip(`Roof ${i + 1} · ${p.pitchDeg != null ? p.pitchDeg + '°' : '—'}${p.areaSqft ? ' · ' + p.areaSqft.toLocaleString() + ' ft²' : ''}`, { sticky: true })
          .addTo(map);
      });
      if (bounds.length) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 21 });
    })();
    return () => { cancelled = true; if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
  }, [data, showMap]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center gap-3 mb-1">
        <Satellite className="text-sky-400" size={26} />
        <h1 className="text-2xl font-bold text-slate-100">Aerial Roof Lookup</h1>
        <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30">Nearmap AI · eval</span>
      </div>
      <p className="text-sm text-slate-400 mb-5">Type an address — real roof geometry (pitch, area, material) detected from Nearmap aerial imagery, drawn on the actual photo.</p>

      <div className="flex gap-2 mb-6">
        <div className="flex-1 relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') lookup(); }}
            placeholder="3 Melvin Dr, Granite City IL 62040"
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

      {showMap && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
              <CheckCircle2 size={14} /> Covered
            </span>
            <span className="text-slate-400">{planes.length} roof{planes.length !== 1 ? 's' : ''} detected</span>
            {data?.coverage?.latestCaptureDate && <span className="text-slate-500">· imagery {data.coverage.latestCaptureDate}</span>}
          </div>

          <div ref={mapEl} className="w-full rounded-xl border border-slate-700/60 overflow-hidden" style={{ height: 460 }} />
          <p className="text-xs text-slate-500">Hover a roof for its pitch + area. Outlines are Nearmap AI; pitch/area/material are measured. (Box catches a few neighbors — parcel crop is the next refinement.)</p>

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
