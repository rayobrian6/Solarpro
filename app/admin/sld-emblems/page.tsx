'use client';
import { useState, useCallback } from 'react';
import { Download, Layers, Info, ZoomIn, ZoomOut } from 'lucide-react';
import { SLD_SYMBOLS, LINE_TYPES, DESIGN_TOKENS as T, type SLDSymbol } from '@/lib/sld-symbols';

// ─── Sample opts for preview rendering ────────────────────────────────────────
const PREVIEW_OPTS: Record<string, Record<string, string | number | boolean>> = {
  'jbox':         { label: 'ROOF J-BOX', sub: 'DC JUNCTION' },
  'pv-array':     { modules: 18, watts: 400, model: 'Silfab SIL-R-400' },
  'inverter':     { mfr: 'SolarEdge', model: 'SE7600H-US', acKw: 7.6, acAmps: 32, mppt: 2, topo: 'STRING INVERTER' },
  'dc-disconnect':{ amps: 15, label: '(N) DC DISCONNECT', rsd: true },
  'ac-disconnect':{ amps: 30, label: '(N) AC DISCONNECT' },
  'fused-disconnect': { amps: 30 },
  'msp':          { busAmps: 200, mainAmps: 200, pvAmps: 30, rule120: 'PASS ✓' },
  'subpanel':     { amps: 100, brand: 'Enphase' },
  'utility-meter':{ utility: 'SCE' },
  'battery-dc':   { model: 'Franklin aPower', kwh: 13.6 },
  'battery-ac':   { model: 'Enphase IQ Battery 5P', kwh: 5.0, backfeedA: 20 },
  'bui-enphase':  { brand: 'Enphase', model: 'IQ SC3', amps: 200, hasGen: false },
  'generator':    { brand: 'Generac', model: 'Guardian 14kW', kw: 14 },
  'ats':          { brand: 'Generac', amps: 200 },
  'ac-combiner':  { branches: 3, ocpd: 20, label: 'IQ Combiner 5F' },
};

// ─── Section groupings ────────────────────────────────────────────────────────
const SECTIONS = [
  {
    id: 'primitives',
    label: 'Primitive Symbols',
    description: 'Building blocks used by all composite equipment nodes',
    ids: ['ground', 'fuse', 'breaker', 'jbox'],
  },
  {
    id: 'generation',
    label: 'PV Generation',
    description: 'DC source — always rendered on every diagram',
    ids: ['pv-array'],
  },
  {
    id: 'conversion',
    label: 'Power Conversion',
    description: 'Inverter topologies — string, optimizer, microinverter combiner',
    ids: ['inverter', 'ac-combiner'],
  },
  {
    id: 'disconnects',
    label: 'Disconnecting Means',
    description: 'NEC 690.13 / NEC 230 — all required disconnect variants',
    ids: ['dc-disconnect', 'ac-disconnect', 'fused-disconnect'],
  },
  {
    id: 'panels',
    label: 'Service Panels',
    description: 'MSP and subpanel — interconnection and load-side',
    ids: ['msp', 'subpanel', 'utility-meter'],
  },
  {
    id: 'storage',
    label: 'Battery Storage & ESS',
    description: 'DC-coupled and AC-coupled battery systems, BUI/Gateway',
    ids: ['battery-dc', 'battery-ac', 'bui-enphase'],
  },
  {
    id: 'backup',
    label: 'Backup / Generator',
    description: 'NEC 702 — standby generator and transfer equipment',
    ids: ['generator', 'ats'],
  },
] as const;

const BADGE_STYLES: Record<string, string> = {
  blue:   'bg-blue-500/15 text-blue-400 border border-blue-500/20',
  green:  'bg-green-500/15 text-green-400 border border-green-500/20',
  purple: 'bg-purple-500/15 text-purple-400 border border-purple-500/20',
  yellow: 'bg-amber-500/15 text-amber-400 border border-amber-500/20',
  red:    'bg-red-500/15 text-red-400 border border-red-500/20',
};

const DOMAIN_STYLES: Record<string, string> = {
  AC:   'bg-blue-900/40 text-blue-300',
  DC:   'bg-orange-900/40 text-orange-300',
  BOTH: 'bg-slate-700/60 text-slate-300',
  GND:  'bg-green-900/40 text-green-300',
};

// ─── Connection point renderer ────────────────────────────────────────────────
function ConnectionBadge({ cp }: { cp: { id: string; x: number; y: number; dir: string; domain: string; label?: string } }) {
  const domainColor = cp.domain === 'AC' ? 'text-blue-400' : cp.domain === 'DC' ? 'text-orange-400' : cp.domain === 'GND' ? 'text-green-400' : 'text-slate-400';
  return (
    <div className="flex items-center gap-2 text-[10px]">
      <span className={`font-mono font-bold ${domainColor}`}>{cp.domain}</span>
      <span className="text-slate-500">{cp.label || cp.id}</span>
      <span className="text-slate-600">({cp.x},{cp.y}) {cp.dir}</span>
    </div>
  );
}

// ─── Single emblem card ───────────────────────────────────────────────────────
function EmblemCard({ symbol, zoom, showDetails }: { symbol: SLDSymbol; zoom: number; showDetails: boolean }) {
  const opts = PREVIEW_OPTS[symbol.id] || {};
  const svgStr = symbol.svg(opts);

  return (
    <div className="bg-[#111827] border border-white/8 rounded-xl overflow-hidden hover:border-white/20 transition-all group flex flex-col">
      {/* SVG Preview — white background */}
      <div className="bg-white flex items-center justify-center p-6 min-h-[180px] relative">
        <div
          style={{ transform: `scale(${zoom})`, transformOrigin: 'center', transition: 'transform 0.15s' }}
          dangerouslySetInnerHTML={{ __html: svgStr }}
        />
        {/* Domain pill overlay */}
        <div className={`absolute top-2 left-2 text-[9px] font-bold px-2 py-0.5 rounded-full ${DOMAIN_STYLES[symbol.domain]}`}>
          {symbol.domain}
        </div>
      </div>

      {/* Info panel */}
      <div className="p-4 flex flex-col gap-2 flex-1">
        <div>
          <div className="text-sm font-bold text-slate-100">{symbol.label}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">{symbol.sub}</div>
        </div>

        <span className={`self-start text-[9px] font-bold px-2 py-0.5 rounded-full ${BADGE_STYLES[symbol.badgeColor]}`}>
          {symbol.badge}
        </span>

        {/* Connection points */}
        {showDetails && symbol.connections.length > 0 && (
          <div className="mt-2 pt-2 border-t border-white/5">
            <div className="text-[9px] font-bold text-slate-600 uppercase tracking-widest mb-1.5">Connection Points</div>
            <div className="flex flex-col gap-1">
              {symbol.connections.map(cp => (
                <ConnectionBadge key={cp.id} cp={cp} />
              ))}
            </div>
          </div>
        )}

        {/* Label anchor */}
        {showDetails && (
          <div className="mt-1 text-[9px] text-slate-600">
            <span className="font-bold text-slate-500">Label anchor: </span>
            ({symbol.labelAnchor.x}, {symbol.labelAnchor.y}) {symbol.labelAnchor.anchor}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function SLDEmblemsPage() {
  const [zoom, setZoom] = useState(1);
  const [activeSection, setActiveSection] = useState<string>('all');
  const [showDetails, setShowDetails] = useState(false);

  const symbolMap = Object.fromEntries(SLD_SYMBOLS.map(s => [s.id, s]));

  const visibleSections = activeSection === 'all'
    ? SECTIONS
    : SECTIONS.filter(s => s.id === activeSection);

  // ── Download SVG reference sheet ──────────────────────────────────────────
  const handleDownloadSVG = useCallback(() => {
    const COL_W = 200, PAD = 24, COLS = 4;
    const sections = SECTIONS;
    const parts: string[] = [];
    let y = 70;

    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${COLS * COL_W + PAD * 2}" height="4800" style="background:#fff;font-family:sans-serif;">`);
    parts.push(`<rect width="${COLS * COL_W + PAD * 2}" height="4800" fill="#fff"/>`);
    parts.push(`<text x="${(COLS * COL_W + PAD * 2) / 2}" y="36" text-anchor="middle" font-size="18" font-weight="bold" fill="#111">SolarPro — Engineering-Grade SLD Symbol Set v2.0</text>`);
    parts.push(`<text x="${(COLS * COL_W + PAD * 2) / 2}" y="52" text-anchor="middle" font-size="10" fill="#555">IEEE 315 / ANSI Y32.9 / NEC-aligned — lib/sld-symbols.ts</text>`);
    parts.push(`<line x1="${PAD}" y1="58" x2="${COLS * COL_W + PAD}" y2="58" stroke="#ddd" stroke-width="1"/>`);

    for (const section of sections) {
      y += 20;
      // Section bar
      parts.push(`<rect x="${PAD}" y="${y}" width="${COLS * COL_W}" height="22" rx="2" fill="#1a1a1a"/>`);
      parts.push(`<text x="${PAD + 10}" y="${y + 15}" font-size="10" font-weight="bold" fill="#fff">${section.label.toUpperCase()}</text>`);
      parts.push(`<text x="${PAD + COLS * COL_W - 10}" y="${y + 15}" text-anchor="end" font-size="8" fill="#888">${section.description}</text>`);
      y += 30;

      let col = 0;
      let maxRowH = 0;
      let rowStartY = y;

      for (const id of section.ids) {
        const sym = symbolMap[id];
        if (!sym) continue;
        const opts = PREVIEW_OPTS[id] || {};
        const svgContent = sym.svg(opts)
          .replace(/<svg[^>]*>/, '')
          .replace('</svg>', '');

        const cardX = PAD + col * COL_W;
        const svgH  = sym.height + 30;
        const cardH = svgH + 60;

        parts.push(`<rect x="${cardX}" y="${y}" width="${COL_W - 8}" height="${cardH}" rx="4" fill="#f9f9f9" stroke="#e5e5e5" stroke-width="1"/>`);
        // Domain pill
        const domClr = sym.domain === 'DC' ? '#C84B00' : sym.domain === 'AC' ? '#0A3D7C' : '#444';
        parts.push(`<rect x="${cardX + 6}" y="${y + 5}" width="24" height="10" rx="3" fill="${domClr}"/>`);
        parts.push(`<text x="${cardX + 18}" y="${y + 13}" text-anchor="middle" font-size="6" font-weight="bold" fill="#fff">${sym.domain}</text>`);
        // Nested svg
        parts.push(`<svg x="${cardX + (COL_W - 8 - sym.width) / 2}" y="${y + 18}" width="${sym.width}" height="${sym.height}">${svgContent}</svg>`);
        // Label
        parts.push(`<text x="${cardX + (COL_W - 8) / 2}" y="${y + svgH + 14}" text-anchor="middle" font-size="8" font-weight="bold" fill="#111">${sym.label}</text>`);
        parts.push(`<text x="${cardX + (COL_W - 8) / 2}" y="${y + svgH + 24}" text-anchor="middle" font-size="6.5" fill="#555">${sym.sub.substring(0, 38)}</text>`);
        // Connection count
        parts.push(`<text x="${cardX + (COL_W - 8) / 2}" y="${y + svgH + 36}" text-anchor="middle" font-size="6" fill="#999">${sym.connections.length} connection point${sym.connections.length !== 1 ? 's' : ''}</text>`);

        maxRowH = Math.max(maxRowH, cardH);
        col++;
        if (col >= COLS) {
          col = 0;
          y += maxRowH + 12;
          maxRowH = 0;
          rowStartY = y;
        }
      }
      if (col > 0) {
        y += maxRowH + 12;
      }
    }

    // Wire types section
    y += 20;
    parts.push(`<rect x="${PAD}" y="${y}" width="${COLS * COL_W}" height="22" rx="2" fill="#1a1a1a"/>`);
    parts.push(`<text x="${PAD + 10}" y="${y + 15}" font-size="10" font-weight="bold" fill="#fff">LINE TYPE SYSTEM</text>`);
    y += 30;

    Object.entries(LINE_TYPES).forEach(([, lt]) => {
      const da = lt.dash ? ` stroke-dasharray="${lt.dash}"` : '';
      parts.push(`<line x1="${PAD}" y1="${y + 8}" x2="${PAD + 120}" y2="${y + 8}" stroke="${lt.stroke}" stroke-width="${lt.sw}"${da}/>`);
      parts.push(`<text x="${PAD + 132}" y="${y + 12}" font-size="9" font-weight="bold" fill="#111">${lt.label}</text>`);
      parts.push(`<text x="${PAD + 132}" y="${y + 22}" font-size="7.5" fill="#555">${lt.sub}</text>`);
      y += 32;
    });

    parts.push(`</svg>`);

    const blob = new Blob([parts.join('\n')], { type: 'image/svg+xml' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'solarpro-sld-symbols-v2.svg';
    a.click(); URL.revokeObjectURL(url);
  }, [symbolMap]);

  // ── Download HTML reference ────────────────────────────────────────────────
  const handleDownloadHTML = useCallback(() => {
    const container = document.getElementById('emblem-grid');
    if (!container) return;
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>SolarPro — SLD Symbol Reference v2.0</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Segoe UI',system-ui,sans-serif;background:#0f1117;color:#e2e8f0;padding:32px;}
h1{font-size:20px;font-weight:800;color:#f8fafc;margin-bottom:4px;}
.sub{font-size:12px;color:#64748b;margin-bottom:28px;}
.sec{margin-bottom:36px;}
.sec-title{font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1.2px;border-bottom:1px solid #1e293b;padding-bottom:6px;margin-bottom:4px;}
.sec-desc{font-size:10px;color:#475569;margin-bottom:14px;}
.grid{display:flex;flex-wrap:wrap;gap:12px;}
.card{background:#111827;border:1px solid #1e293b;border-radius:10px;overflow:hidden;min-width:180px;max-width:220px;}
.card-svg{background:white;display:flex;align-items:center;justify-content:center;padding:16px;min-height:160px;}
.card-info{padding:12px;}
.label{font-size:11px;font-weight:700;color:#e2e8f0;margin-bottom:3px;}
.cardsub{font-size:9px;color:#64748b;}
.badge{display:inline-block;font-size:8px;font-weight:700;padding:1px 7px;border-radius:10px;margin-top:6px;}
.badge-blue{background:#1e3a5f;color:#60a5fa;}
.badge-green{background:#1a2e1a;color:#4ade80;}
.badge-purple{background:#2e1a2e;color:#c084fc;}
.badge-yellow{background:#2e2a1a;color:#fbbf24;}
.domain{position:absolute;top:6px;left:6px;font-size:8px;font-weight:700;padding:1px 6px;border-radius:8px;}
.dom-ac{background:#0a3d7c;color:#93c5fd;}
.dom-dc{background:#7c2d12;color:#fdba74;}
.dom-both{background:#374151;color:#d1d5db;}
.dom-gnd{background:#14532d;color:#86efac;}
.wire-row{display:flex;align-items:center;gap:12px;padding:8px 12px;background:#111827;border:1px solid #1e293b;border-radius:8px;margin-bottom:6px;}
.wire-label{font-size:11px;font-weight:600;color:#cbd5e1;}
.wire-sub{font-size:9px;color:#475569;}
</style>
</head>
<body>
<h1>SolarPro — Engineering-Grade SLD Symbol Set v2.0</h1>
<p class="sub">IEEE 315 / ANSI Y32.9 / NEC-aligned · lib/sld-symbols.ts · Permit-ready</p>
${container.innerHTML}
<div class="sec">
<div class="sec-title">Line Type System</div>
${Object.entries(LINE_TYPES).map(([, lt]) => {
  const da = lt.dash ? ` stroke-dasharray="${lt.dash}"` : '';
  return `<div class="wire-row">
  <svg width="120" height="20"><line x1="4" y1="10" x2="116" y2="10" stroke="${lt.stroke}" stroke-width="${lt.sw}"${da}/></svg>
  <div><div class="wire-label">${lt.label}</div><div class="wire-sub">${lt.sub}</div></div>
</div>`;
}).join('')}
</div>
</body>
</html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'solarpro-sld-symbols-v2.html';
    a.click(); URL.revokeObjectURL(url);
  }, []);

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-3">
            <Layers size={22} className="text-amber-400" />
            SLD Symbol System
            <span className="text-xs font-semibold px-2 py-1 bg-amber-500/20 text-amber-400 rounded-full border border-amber-500/30">v2.0 Engineering Grade</span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            IEEE 315 · ANSI Y32.9 · NEC-aligned · Permit-ready ·{' '}
            <code className="text-amber-400 text-xs bg-amber-500/10 px-1.5 py-0.5 rounded">lib/sld-symbols.ts</code>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleDownloadSVG}
            className="flex items-center gap-2 text-xs bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg transition-all font-semibold"
          >
            <Download size={13} /> Download SVG
          </button>
          <button
            onClick={handleDownloadHTML}
            className="flex items-center gap-2 text-xs bg-amber-600 hover:bg-amber-500 text-white px-4 py-2 rounded-lg transition-all font-semibold"
          >
            <Download size={13} /> Download HTML
          </button>
        </div>
      </div>

      {/* ── Info banner ── */}
      <div className="flex items-start gap-3 bg-blue-500/8 border border-blue-500/20 rounded-xl p-4">
        <Info size={15} className="text-blue-400 mt-0.5 flex-shrink-0" />
        <div className="text-xs text-slate-300 leading-relaxed space-y-1">
          <div>
            <strong className="text-white">18 engineering-grade symbols</strong> — each with defined connection points, voltage domain, label anchor, and options API.
            Primary stroke 2px · Secondary 1.5px · Grid-aligned · Scales without distortion.
          </div>
          <div className="flex flex-wrap gap-3 mt-2">
            {[
              { c: 'bg-orange-900/40 text-orange-300', l: 'DC domain' },
              { c: 'bg-blue-900/40 text-blue-300',     l: 'AC domain' },
              { c: 'bg-slate-700/60 text-slate-300',   l: 'BOTH (conversion)' },
              { c: 'bg-green-900/40 text-green-300',   l: 'GND' },
            ].map(d => (
              <span key={d.l} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${d.c}`}>{d.l}</span>
            ))}
          </div>
        </div>
      </div>

      {/* ── Controls ── */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Section filter */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => setActiveSection('all')}
            className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-all ${
              activeSection === 'all'
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                : 'text-slate-400 border border-white/8 hover:text-white hover:bg-white/5'
            }`}
          >All</button>
          {SECTIONS.map(s => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-all ${
                activeSection === s.id
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  : 'text-slate-400 border border-white/8 hover:text-white hover:bg-white/5'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Zoom */}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className={`text-xs px-3 py-1.5 rounded-lg font-semibold border transition-all ${
              showDetails
                ? 'bg-purple-500/20 text-purple-400 border-purple-500/30'
                : 'text-slate-400 border-white/8 hover:bg-white/5'
            }`}
          >
            {showDetails ? 'Hide' : 'Show'} Connection Points
          </button>
          <button onClick={() => setZoom(z => Math.max(0.5, z - 0.25))} className="p-1.5 rounded-lg text-slate-400 hover:text-white border border-white/8 hover:bg-white/5">
            <ZoomOut size={14} />
          </button>
          <span className="text-xs text-slate-500 w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.min(2, z + 0.25))} className="p-1.5 rounded-lg text-slate-400 hover:text-white border border-white/8 hover:bg-white/5">
            <ZoomIn size={14} />
          </button>
        </div>
      </div>

      {/* ── Symbol grid ── */}
      <div id="emblem-grid" className="space-y-10">
        {visibleSections.map(section => (
          <div key={section.id} className="sec">
            <div className="mb-4">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">{section.label}</div>
              <div className="text-[11px] text-slate-600 mt-0.5">{section.description}</div>
            </div>
            <div className="flex flex-wrap gap-4">
              {section.ids.map(id => {
                const sym = symbolMap[id];
                if (!sym) return null;
                return <EmblemCard key={id} symbol={sym} zoom={zoom} showDetails={showDetails} />;
              })}
            </div>
          </div>
        ))}

        {/* Wire types */}
        {(activeSection === 'all' || activeSection === 'wires') && (
          <div className="sec">
            <div className="mb-4">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">Line Type System</div>
              <div className="text-[11px] text-slate-600 mt-0.5">Mandatory — three distinct types: AC solid 2px, DC solid 1.5px, comms dashed</div>
            </div>
            <div className="flex flex-col gap-2.5 max-w-xl">
              {Object.entries(LINE_TYPES).map(([key, lt]) => (
                <div key={key} className="flex items-center gap-4 bg-[#111827] border border-white/8 rounded-xl px-5 py-3">
                  <svg width="120" height="22" viewBox="0 0 120 22" style={{ display: 'block', flexShrink: 0 }}>
                    <line
                      x1="4" y1="11" x2="116" y2="11"
                      stroke={lt.stroke}
                      strokeWidth={lt.sw}
                      strokeDasharray={lt.dash || undefined}
                    />
                  </svg>
                  <div>
                    <div className="text-sm font-semibold text-slate-200">{lt.label}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{lt.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Design tokens reference ── */}
      <div className="rounded-xl border border-white/8 bg-white/2 p-5">
        <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">Design Tokens — <code className="text-amber-400">DESIGN_TOKENS</code></div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {[
            { label: 'Primary Stroke',   value: '2px',       color: 'text-slate-300' },
            { label: 'Secondary Stroke', value: '1.5px',     color: 'text-slate-300' },
            { label: 'Hair Stroke',      value: '0.75px',    color: 'text-slate-300' },
            { label: 'Bus Stroke',       value: '3.5px',     color: 'text-slate-300' },
            { label: 'Corner Radius',    value: '2px',       color: 'text-slate-300' },
            { label: 'Grid Unit',        value: '8px',       color: 'text-slate-300' },
            { label: 'DC Color',         value: T.DC_CLR,    color: 'text-orange-400' },
            { label: 'AC Color',         value: T.AC_CLR,    color: 'text-blue-400' },
            { label: 'GND Color',        value: T.GND,       color: 'text-green-400' },
            { label: 'Battery Color',    value: T.BAT_CLR,   color: 'text-blue-400' },
            { label: 'Generator Color',  value: T.GEN_CLR,   color: 'text-green-400' },
            { label: 'ATS Color',        value: T.ATS_CLR,   color: 'text-orange-400' },
          ].map(tok => (
            <div key={tok.label} className="flex items-center justify-between bg-white/3 rounded-lg px-3 py-2">
              <span className="text-xs text-slate-500">{tok.label}</span>
              <span className={`text-xs font-mono font-bold ${tok.color}`}>{tok.value}</span>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}