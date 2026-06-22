// ============================================================
// SolarTRACE overlay — enrich an AhjRecord with real NREL SolarTRACE data
// ============================================================
// SERVER-ONLY. lib/jurisdictions/solartrace.ts is ~650KB of real per-AHJ permitting
// data (NREL SolarTRACE v9-9-2025) — do NOT import it into anything that reaches the
// client bundle (e.g. the engineering page imports searchAhj from ahj-national, which
// is 'use client'; that's why the overlay lives here and is applied in API routes only).
//
// Overlays REAL measured fields onto a record: online/instant (SolarAPP+) permitting,
// median permit cost, median permit days, SolSmart designation, review requirements.

import type { AhjRecord } from './ahj-national';
import { SOLARTRACE } from './solartrace';

// Normalization — MUST match the generator (_tmp_gen_solartrace.py norm/is_county/key):
// lowercase, drop parentheticals, then pop ALL trailing Census-descriptor words, join,
// strip non-alphanumerics. Applied identically to both sides so keys line up.
const ST_SUFFIX = new Set([
  'city', 'town', 'village', 'borough', 'cdp', 'municipality', 'county', 'parish',
  'township', 'gov', 'government', 'metropolitan', 'metro', 'consolidated', 'urban',
]);

function stNorm(name: string): string {
  const s = (name || '').toLowerCase().trim().replace(/\(.*?\)/g, '');
  const words = s.split(/\s+/).filter(Boolean);
  while (words.length && ST_SUFFIX.has(words[words.length - 1].replace(/[^a-z]/g, ''))) {
    words.pop();
  }
  return words.join('').replace(/[^a-z0-9]/g, '');
}

/** Build the SolarTRACE lookup key for one of our AHJ records. */
export function solarTraceKeyForRecord(r: AhjRecord): string {
  const isCounty = r.ahjType === 'county' || /unincorporated/i.test(r.city || '');
  const base = (isCounty ? r.county : r.city) || r.city || '';
  return `${(r.stateCode || '').toUpperCase()}|${stNorm(base)}|${isCounty ? 'C' : 'P'}`;
}

function pushUnique(arr: string[], v: string) {
  if (v && !arr.includes(v)) arr.push(v);
}

/**
 * Return a copy of the record enriched with real SolarTRACE permitting data where a
 * clean (state, place|county) match exists. Returns the record unchanged otherwise.
 * SolarTRACE measures the permit PROCESS (online/instant/cost/days/reviews), so those
 * real values take precedence; identity/code fields (NEC, setbacks, contacts) are left
 * to the curated/registry/code-logic layers.
 */
export function enrichWithSolarTrace(r: AhjRecord): AhjRecord {
  const e = SOLARTRACE[solarTraceKeyForRecord(r)];
  if (!e) return r;

  const out: AhjRecord = { ...r };
  const special = [...(r.specialRequirements || [])];

  if (typeof e.onlinePermitting === 'boolean') out.onlinePermitting = e.onlinePermitting;
  if (e.instantPermitting) {
    out.onlinePermitting = true;
    out.expeditedAvailable = true;
    pushUnique(special, `Instant online permitting available${e.instantPlatform ? ` (${e.instantPlatform})` : ''}`);
  }
  if (typeof e.medianPermitCostUsd === 'number') {
    out.typicalPermitFee = `$${e.medianPermitCostUsd.toLocaleString()}`;
    out.feeStructure = 'Median permit cost (NREL SolarTRACE)';
  }
  if (typeof e.medianPermitDays === 'number') out.typicalPermitDays = e.medianPermitDays;
  if (e.solSmart) pushUnique(special, `SolSmart ${e.solSmart} designated jurisdiction`);
  if (e.numInspections) pushUnique(special, `Inspections required: ${e.numInspections}`);

  out.specialRequirements = special;
  const note = 'Permit-process data: NREL SolarTRACE (v9-9-2025).';
  out.notes = r.notes ? `${r.notes} ${note}` : note;
  return out;
}
