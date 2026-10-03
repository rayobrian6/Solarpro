'use client';

// ═══════════════════════════════════════════════════════════════════════════
// ENGINEERING SUMMARY — the engineered project in compact tiles.
//
// Ray (System Config UX correction V3): "ENGINEERING SUMMARY: compact tiles PANELS · PV DC · PV AC
// (N/A — DC coupled) · STRINGS · STORAGE · ESS OUTPUT · GATEWAYS (+ SERVICE), each with a subtle
// provenance chip, details behind [?]." Within one screen the installer understands the system.
//
// Every value is a `summaryFacts` line from `buildSystemConfigInterview` — read from its owner, never
// recomputed here. Every fact renders exactly once, with `summary-fact-<slug>` on its value: a fact no
// tile names (or whose tile has no primary fact) is listed under the tiles rather than dropped.
// ═══════════════════════════════════════════════════════════════════════════

import React from 'react';
import type { SummaryFact } from '@/lib/electrical/systemConfigInterview';
import { ProvenanceChip } from '@/components/engineering/systemConfig/ItemEditor';

/** The testid slug of a fact: "ESS max continuous AC output" → "ess-max-continuous-ac-output". */
export const factSlug = (label: string) => label.toLowerCase().replace(/[^a-z]+/g, '-');

/** The tiles, in order: the tile's name, the fact it shows, and the facts it carries beneath. */
export const SUMMARY_TILES: ReadonlyArray<{ tile: string; fact: string; sub?: string[] }> = [
  { tile: 'PANELS', fact: 'PV modules' },
  { tile: 'PV DC', fact: 'PV DC size' },
  { tile: 'PV AC', fact: 'PV AC output', sub: ['PV inverter'] },
  { tile: 'STRINGS', fact: 'PV strings', sub: ['PV architecture'] },
  { tile: 'STORAGE', fact: 'Storage' },
  { tile: 'ESS OUTPUT', fact: 'ESS max continuous AC output' },
  { tile: 'GATEWAYS', fact: 'Backup controllers' },
  { tile: 'SERVICE', fact: 'Service', sub: ['Distribution'] },
];

function FactValue({ f, className }: { f: SummaryFact; className: string }) {
  return <span className={className} data-testid={`summary-fact-${factSlug(f.label)}`}>{f.value}</span>;
}

export function EngineeringSummaryFacts({ facts }: { facts: ReadonlyArray<SummaryFact> }) {
  const byLabel = new Map(facts.map(f => [f.label, f]));
  const shown = new Set<string>();
  const tiles = SUMMARY_TILES.flatMap(t => {
    const f = byLabel.get(t.fact);
    if (!f) return [];
    shown.add(f.label);
    const subs = (t.sub ?? []).map(l => byLabel.get(l)).filter((x): x is SummaryFact => !!x);
    for (const s of subs) shown.add(s.label);
    return [{ ...t, f, subs }];
  });
  const rest = facts.filter(f => !shown.has(f.label));
  return (
    <div data-testid="engineering-summary-facts" className="mb-3 space-y-1.5">
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 xl:grid-cols-2">
        {tiles.map(({ tile, f, subs }) => (
          <div key={tile} data-testid={`summary-tile-${factSlug(tile)}`} data-source={f.source}
               className="min-w-0 rounded-lg border border-slate-700/50 bg-slate-900/70 px-2 py-1.5">
            <div className="flex items-center gap-1">
              <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">{tile}</span>
              <span className="ml-auto cursor-help select-none rounded-full border border-slate-700 px-1 text-[9px] font-black text-slate-500"
                    title={[`${f.label}: ${f.value} — ${f.source}`, ...subs.map(s => `${s.label}: ${s.value} — ${s.source}`)].join('\n')}
                    aria-label={`${f.label} details`}>?</span>
            </div>
            <FactValue f={f} className="block break-words text-[13px] font-black leading-tight text-slate-100" />
            {subs.map(s => (
              <div key={s.label} className="mt-0.5 truncate text-[10px] text-slate-400" title={`${s.label} — ${s.source}`}>
                <span className="text-slate-500">{s.label}: </span>
                <FactValue f={s} className="text-slate-300" />
              </div>
            ))}
            <div className="mt-1"><ProvenanceChip source={f.source} compact /></div>
          </div>
        ))}
      </div>
      {rest.length > 0 ? (
        <dl data-testid="summary-facts-rest" className="rounded-lg border border-slate-700/30 bg-slate-900/40 px-2 py-1">
          {rest.map(f => (
            <div key={f.label} className="flex items-baseline justify-between gap-2 py-0.5">
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{f.label}</dt>
              <dd className="flex items-baseline gap-1.5 text-right">
                <FactValue f={f} className="text-[11px] font-bold text-slate-100" />
                <ProvenanceChip source={f.source} compact />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

export default EngineeringSummaryFacts;
