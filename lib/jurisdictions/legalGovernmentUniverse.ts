// ═══════════════════════════════════════════════════════════════════════════
// THE NATIONAL LEGAL-GOVERNMENT UNIVERSE.
//
// ── WHY THIS EXISTS ───────────────────────────────────────────────────────
// SolarPro's ~4,000-row AHJ registry is a PERMITTING-AUTHORITY layer, not the
// national universe of governments. Treating it as the universe is what made
// "we have no record" indistinguishable from "no government exists", and that
// ambiguity is what let a mailing city, a neighbouring municipality or a county
// stand in for the real authority.
//
// This module is the layer beneath it: every legally relevant entity the United
// States actually has, from authoritative federal data, so the resolver can ask
//
//     which governments exist at this coordinate?
//
// separately from
//
//     which of them administers this permit scope?
//
// ── A STATISTICAL GEOGRAPHY IS NOT A GOVERNMENT ───────────────────────────
// The universe deliberately INCLUDES statistical entities — 12,454 Census
// Designated Places and 5,255 Census County Divisions — flagged
// STATISTICAL_ONLY. They are here so the system can say "that is a CDP, it has
// no government" rather than "unknown", which is a materially different and far
// more useful answer. A CDP may inform address context and geocoding. It may
// never become a permitting authority because its name matched a mailing
// address.
//
// ── THE UNIVERSE IS NOT THE AUTHORITY ─────────────────────────────────────
// Knowing that Nameoki Township exists and is an active government says NOTHING
// about whether it issues building permits — Illinois townships generally do
// not. That determination belongs to the delegation policy, which is governed
// evidence, not to this file. Do not read ACTIVE as "is an AHJ".
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type LegalEntityKind =
  | 'state'
  | 'county'                    // a general-purpose county government
  | 'county-equivalent'         // parish, census area, district — county level, varying law
  | 'municipio'                 // Puerto Rico: the general-purpose local government
  | 'borough'                   // Alaska borough, and PA/NJ/CT municipal boroughs
  | 'independent-city'          // a city that is ALSO a county-equivalent
  | 'consolidated-government'   // one government wearing city and county hats
  | 'incorporated-place'        // ordinary municipality (city, village)
  | 'town'                      // a town — the general-purpose government in New England
  | 'township'                  // township / MCD
  | 'mcd'                       // other minor civil division
  | 'census-designated-place'   // ⚠ STATISTICAL. Never a government.
  | 'census-county-division'    // ⚠ STATISTICAL. Never a government.
  | 'other-government';

/** Whether the entity is a functioning government TODAY. */
export type GovernmentStatus =
  | 'ACTIVE'            // functioning government (Census FUNCSTAT A, B, C, G)
  | 'SUPERSEDED'        // legally exists, functions held by a successor (N, I)
  | 'DISSOLVED'
  | 'STATISTICAL_ONLY'  // never a government (S) or a hierarchy filler (F)
  | 'UNKNOWN';

export interface LegalGovernmentEntity {
  /** stable key: `<kind-prefix>:<geoid>` — never a name. */
  id: string;
  entityKind: LegalEntityKind;
  canonicalName: string;
  stateFips: string;
  /** 5-digit national county FIPS, where the entity is county-level or below. */
  countyFips?: string;
  /** 7-digit place GEOID. */
  placeGeoid?: string;
  /** 10-digit county-subdivision GEOID. */
  cousubGeoid?: string;
  governmentStatus: GovernmentStatus;
  /** the raw Census functional-status code, kept so a grading decision is
   *  auditable rather than baked in. */
  governmentFunctionStatus: string;
  /** the raw Census class code — C1/C7/H1/T1/Z5 etc. */
  governmentClass: string;
  source: { dataset: string; vintage: string; sourceKey: string };
}

/** Kinds that can hold permitting authority. Statistical kinds cannot, ever. */
export const GOVERNING_KINDS: readonly LegalEntityKind[] = [
  'state', 'county', 'county-equivalent', 'municipio', 'borough',
  'independent-city', 'consolidated-government', 'incorporated-place',
  'town', 'township', 'mcd', 'other-government',
];
export const STATISTICAL_KINDS: readonly LegalEntityKind[] = [
  'census-designated-place', 'census-county-division',
];

export function isStatisticalOnly(e: LegalGovernmentEntity): boolean {
  return e.governmentStatus === 'STATISTICAL_ONLY'
    || (STATISTICAL_KINDS as readonly string[]).includes(e.entityKind);
}

/** Can this entity be considered as a permitting authority AT ALL? Being able to
 *  is not the same as being one — see the delegation policy. */
export function canHoldAuthority(e: LegalGovernmentEntity): boolean {
  return e.governmentStatus === 'ACTIVE' && !isStatisticalOnly(e);
}

// ── Loading ───────────────────────────────────────────────────────────────
// The universe is a compact generated TSV rather than a TypeScript module:
// 72,063 entities as source would be a multi-megabyte bundle, and this data is
// regenerated from federal files rather than hand-edited. Regenerate with
//     npm run gov:ingest-national -- --write

export const UNIVERSE_FILE = 'national-government-universe.tsv';

let CACHE: LegalGovernmentEntity[] | null = null;
let BY_ID: Map<string, LegalGovernmentEntity> | null = null;

function universePath(): string {
  return join(process.cwd(), 'data', 'census', UNIVERSE_FILE);
}

/** Columns, in order. Kept narrow deliberately: this is an identity backbone. */
const COLS = ['id', 'entityKind', 'canonicalName', 'stateFips', 'countyFips',
  'placeGeoid', 'cousubGeoid', 'governmentStatus', 'governmentFunctionStatus',
  'governmentClass', 'sourceKey'] as const;

export function loadUniverse(vintageMeta?: { dataset: string; vintage: string }): LegalGovernmentEntity[] {
  if (CACHE) return CACHE;
  const raw = readFileSync(universePath(), 'utf8');
  const lines = raw.split('\n');
  const meta = JSON.parse(lines[0].replace(/^#\s*/, '')) as { dataset: string; vintage: string };
  const out: LegalGovernmentEntity[] = [];
  for (let i = 2; i < lines.length; i++) {
    const l = lines[i];
    if (!l) continue;
    const f = l.split('\t');
    const rec: Record<string, string> = {};
    COLS.forEach((c, j) => { rec[c] = f[j] ?? ''; });
    out.push({
      id: rec.id,
      entityKind: rec.entityKind as LegalEntityKind,
      canonicalName: rec.canonicalName,
      stateFips: rec.stateFips,
      countyFips: rec.countyFips || undefined,
      placeGeoid: rec.placeGeoid || undefined,
      cousubGeoid: rec.cousubGeoid || undefined,
      governmentStatus: rec.governmentStatus as GovernmentStatus,
      governmentFunctionStatus: rec.governmentFunctionStatus,
      governmentClass: rec.governmentClass,
      source: { dataset: vintageMeta?.dataset ?? meta.dataset, vintage: vintageMeta?.vintage ?? meta.vintage, sourceKey: rec.sourceKey },
    });
  }
  CACHE = out;
  return out;
}

export function universeById(id: string): LegalGovernmentEntity | null {
  if (!BY_ID) {
    BY_ID = new Map();
    for (const e of loadUniverse()) BY_ID.set(e.id, e);
  }
  return BY_ID.get(id) ?? null;
}

/** Every entity in a state, by kind. Used by the coverage audit. */
export function universeByState(stateFips: string): LegalGovernmentEntity[] {
  return loadUniverse().filter(e => e.stateFips === stateFips);
}

/** Reset the memoised universe — tests only. */
export function __resetUniverseCache(): void { CACHE = null; BY_ID = null; }
