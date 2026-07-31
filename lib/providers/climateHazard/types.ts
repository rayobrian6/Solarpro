// ═══════════════════════════════════════════════════════════════════════════
// AAC WS-4 — CLIMATE-HAZARD RETRIEVAL PROVIDER (the contract)
// ───────────────────────────────────────────────────────────────────────────
// The audit (§2.6) found the EnvironmentalLoadAuthority RECORD already satisfies
// WS-4 completely — "Only the *retrieval* and *archival* are missing. Do not
// rebuild the record." This module is that missing retrieval, expressed as the
// same DI provider contract the aerial stack uses, so a test injects a
// deterministic fixture and production injects the live ASCE 7 Hazard Tool.
//
// WHAT A HAZARD DATASET CAN AND CANNOT SUPPLY (binding, so nothing is fabricated):
//   • wind speed        — RETRIEVABLE. A mapped basic wind speed V, specific to
//                         the ASCE edition and the risk category (the MRI).
//   • ground snow load  — RETRIEVABLE. ASCE 7-22 maps pg per risk category.
//   • seismic           — RETRIEVABLE (USGS ASCE 7 web service) for a stated site
//                         class; SDC follows from Sds/Sd1 + risk category.
//   • elevation         — RETRIEVABLE (USGS EPQS + the ASCE snow DEM).
//   • RISK CATEGORY     — NOT a mapped value. It is an occupancy classification
//                         (ASCE 7 Table 1.5-1) and is a QUERY INPUT here: the
//                         returned wind/snow are specific to it, so the record
//                         covers the risk-category basis explicitly.
//   • EXPOSURE CATEGORY — NOT a mapped value and NOT supplied by the ASCE Hazard
//                         Tool. ASCE 7 §26.7 is a surface-roughness determination
//                         made by the designer for the terrain upwind of the site.
//                         It therefore travels on the record with its OWN basis
//                         and, where operator-entered, is audited as an override.
//                         It is never invented here.
// ═══════════════════════════════════════════════════════════════════════════

import type { RetrievalProvider, RetrievalResult } from '../types';

export const ASCE_EDITIONS = ['7-10', '7-16', '7-22'] as const;
export type AsceEdition = (typeof ASCE_EDITIONS)[number];

export const RISK_CATEGORIES = ['I', 'II', 'III', 'IV'] as const;
export type RiskCategory = (typeof RISK_CATEGORIES)[number];

export function isRiskCategory(x: unknown): x is RiskCategory {
  return typeof x === 'string' && (RISK_CATEGORIES as readonly string[]).includes(x.trim().toUpperCase());
}

/** Normalise '2', 'II', 'Risk Category II', 'ii' → 'II'. Returns null for an
 *  unrecognised token — never a default. */
export function normalizeRiskCategory(raw: unknown): RiskCategory | null {
  if (raw == null) return null;
  const s = String(raw).trim().toUpperCase().replace(/^RISK\s*(CATEGORY|CAT\.?)\s*/, '').trim();
  if (isRiskCategory(s)) return s as RiskCategory;
  const arabic: Record<string, RiskCategory> = { '1': 'I', '2': 'II', '3': 'III', '4': 'IV' };
  return arabic[s] ?? null;
}

/** ASCE 7-16/7-22 basic-wind-speed MRI by risk category (ASCE 7-22 Fig. 26.5-1
 *  A-D / 7-16 Fig. 26.5-1 A-D). This is the code's OWN mapping of risk category
 *  to mean recurrence interval — not a heuristic. */
export const WIND_MRI_BY_RISK: Record<RiskCategory, number> = { I: 300, II: 700, III: 1700, IV: 3000 };

export interface HazardQuery {
  lat: number;
  lng: number;
  /** the ASCE edition the STRUCTURAL ENGINE is running under — the hazard values
   *  must come from the SAME edition the calculation cites. */
  asceEdition: AsceEdition;
  riskCategory: RiskCategory;
  /** the address the coordinates came from, recorded on the evidence. */
  addressUsed?: string | null;
  /** ASCE 7 site class for the seismic query (default D per ASCE 7 §11.4.3 when
   *  no geotechnical report establishes one; recorded explicitly either way). */
  siteClass?: string | null;
}

/** One retrieved scalar with the exact service that produced it. */
export interface HazardDatum {
  /** e.g. 'basic wind speed V (700-yr MRI)'. */
  label: string;
  value: number | string | null;
  unit: string | null;
  /** the exact endpoint queried. */
  sourceUrl: string;
  /** the dataset identity, e.g. 'ASCE 7-22 Fig. 26.5-1B (w2022_mri700)'. */
  dataset: string;
}

export interface RetrievedHazards {
  asceEdition: AsceEdition;
  riskCategory: RiskCategory;
  /** the MRI the wind value was retrieved at (derived from the risk category by
   *  the code's own table, recorded so the basis is auditable). */
  windMriYears: number;
  /** basic wind speed V, mph, 3-s gust — the raster value, UNROUNDED. */
  windSpeedMph: number | null;
  /** ground snow load pg, psf — the raster value, UNROUNDED. */
  groundSnowLoadPsf: number | null;
  /** seismic parameters, when the seismic service covers the site. */
  seismic: {
    referenceDocument: string;
    siteClass: string;
    ss: number | null; s1: number | null; sds: number | null; sd1: number | null;
    /** seismic design category. */
    sdc: string | null;
  } | null;
  /** site elevation, feet above NAVD88/NAD83 per the queried service. */
  elevationFt: number | null;
  coordinates: { lat: number; lng: number };
  addressUsed: string | null;
  /** every scalar retrieved, with its own service — THE evidence trail. */
  data: HazardDatum[];
  /** whether this record came from a live call or a documented fixture. Printed
   *  on the evidence so fixture proof is never mistaken for live proof. */
  proof: 'live-retrieval' | 'fixture';
  /** for a fixture: where the values were captured from + when. */
  fixtureProvenance?: string | null;
}

export interface ClimateHazardProvider extends RetrievalProvider {
  getHazards(q: HazardQuery): Promise<RetrievalResult<RetrievedHazards>>;
}
