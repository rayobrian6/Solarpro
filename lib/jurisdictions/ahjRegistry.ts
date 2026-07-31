// ============================================================
// Live SunSpec / Orange Button AHJ Registry client
// ============================================================
// The AHJ Registry (ahjregistry.myorangebutton.com, open-source, NREL-founded +
// crowd-sourced) is the industry-standard source of REAL per-AHJ data — the same
// registry Aurora / Blu Banyan / SolarAPP+ use. It holds codes enforced
// (building/fire/electrical/residential editions), contacts, address, and required
// engineering reviews.
//
// API (verified from the open-source server, jakl/ahj-registry):
//   POST https://ahjregistry.myorangebutton.com/api/v1/ahj/
//   Authorization: Token <AHJ_REGISTRY_TOKEN>
//   body: { Location: { Latitude:{Value}, Longitude:{Value} }, Address?: {...} }
//   → { results: [ { AHJName, ElectricCode, FireCode, BuildingCode, ResidentialCode,
//                    Address, Contacts[], EngineeringReviewRequirements[] } ] }
//   (Orange Button taxonomy — scalar fields are wrapped as { Value: ... }.)
//
// Get a free token from support@sunspec.org and set AHJ_REGISTRY_TOKEN. With NO
// token (or on ANY error / no match) every function here returns null, so callers
// fall back to the static curated + code-logic database — behavior is then
// identical to having no live registry at all (zero risk).
//
// ⚠ The lat/lng request path is exercised by the open-source server code; the exact
// OB field PATHS in the response should be re-confirmed against a real response once
// a token is provisioned (the mapper below is defensive and fails safe).

import type { AhjRecord } from './ahj-national';
import { JURISDICTION_DATA } from './necVersions';

const REGISTRY_URL = 'https://ahjregistry.myorangebutton.com/api/v1/ahj/';
const TIMEOUT_MS = 8000;

export interface RegistryQuery {
  address?: string;
  lat?: number;
  lng?: number;
  stateCode?: string;   // hint, used to seed code-logic defaults if the registry omits state
}

/** Unwrap an Orange Button scalar, which may be a raw value or { Value: ... }. */
function ob(field: unknown): string | undefined {
  if (field == null) return undefined;
  if (typeof field === 'string') return field || undefined;
  if (typeof field === 'number') return String(field);
  if (typeof field === 'object' && 'Value' in (field as Record<string, unknown>)) {
    const v = (field as Record<string, unknown>).Value;
    return v == null ? undefined : String(v);
  }
  return undefined;
}

/** Parse an Orange Button code enumeration (e.g. "2020NEC", "2021 IFC") → NEC year. */
function obNecYear(field: unknown): AhjRecord['necVersion'] | null {
  const s = ob(field);
  if (!s) return null;
  const m = s.match(/20(17|20|23)/);
  return m ? (('20' + m[1]) as AhjRecord['necVersion']) : null;
}

/**
 * AAC WS-3 — parse ANY Orange Button code enumeration into its adopted EDITION
 * YEAR. The registry encodes these as e.g. `2021IBC`, `2018 IRC`, `2021IFC`.
 *
 * THE DEFECT THIS FIXES (audit §7.5, `ahjRegistry.ts:83`): the mapper extracted
 * `ElectricCode` only, because `AhjRecord` had nowhere to put the other three —
 * so `BuildingCode`, `ResidentialCode` and `FireCode`, **the exact editions
 * CODE-AUTHORITY-INCOMPLETE is blocked on**, arrived in the response and were
 * thrown away. They are retained now (both on the AhjRecord as optional fields
 * and, with full provenance, on the RegistryCodeAdoption record below).
 *
 * NO INFERENCE: an unparseable / absent field returns null. A NEC year is never
 * used to derive an IBC/IRC/IFC year, and a state default is never substituted
 * for a local adoption.
 */
export function obCodeEdition(field: unknown): string | null {
  const s = ob(field);
  if (!s) return null;
  // NO trailing \b: the registry's own encoding is `2021IBC` / `2020NEC`, where
  // the year runs straight into the code name with no word boundary between
  // them. A trailing \b silently matched nothing on the registry's real format.
  const m = s.match(/(?:19|20)\d{2}/);
  return m ? m[0] : null;
}

/** The FULL adopted-code payload the registry returns for one AHJ — the record
 *  the AAC WS-3 code-authority resolver consumes. Every field is the registry's
 *  own statement; nothing is defaulted, inferred or back-filled. */
export interface RegistryCodeAdoption {
  ahjName: string;
  ahjCode: string | null;
  ahjId: string | null;
  jurisdictionType: 'city' | 'county' | 'state' | 'special_district' | 'unknown';
  stateCode: string | null;
  county: string | null;
  city: string | null;
  /** adopted edition YEARS, exactly as enumerated by the registry (null = the
   *  registry carries no adoption for that code family — never inferred). */
  editions: { nec: string | null; ibc: string | null; irc: string | null; ifc: string | null };
  /** the raw registry enumerations, kept verbatim for the evidence trail. */
  rawEditions: { ElectricCode: string | null; BuildingCode: string | null; ResidentialCode: string | null; FireCode: string | null };
  /** the permitting office of record. */
  permitOffice: { name: string | null; phone: string | null; email: string | null; url: string | null; address: string | null };
  /** engineering-review requirements the AHJ declares. */
  engineeringReviewRequirements: string[];
  /** the AHJ's own last-update stamp where the registry provides one. */
  lastUpdatedIso: string | null;
  /** ISO timestamp of the RETRIEVAL (not of the adoption). */
  retrievedAtIso: string;
  /** the exact endpoint queried. */
  sourceUrl: string;
  /** how many AHJs the query matched — >1 is a genuine boundary ambiguity. */
  matchCount: number;
  /** every matched AHJ name, so a boundary conflict can be SHOWN, not guessed. */
  matchedAhjNames: string[];
}

/** Map a raw Orange Button AHJ object → the FULL code-adoption record (all four
 *  code families retained). Returns null when the payload is unusable. */
export function mapRegistryToCodeAdoption(
  raw: unknown,
  meta: { retrievedAtIso: string; sourceUrl: string; matchCount: number; matchedAhjNames: string[]; hintState?: string },
): RegistryCodeAdoption | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, any>;
  const ahjName = ob(r.AHJName) ?? ob(r.AHJCode);
  if (!ahjName) return null;
  const addr = (r.Address ?? {}) as Record<string, any>;
  const contact = firstContact(r);
  const county = ob(addr.County) ?? null;
  const city = ob(addr.City) ?? null;
  const stateCode = (ob(addr.StateProvince) ?? meta.hintState ?? '').toUpperCase().slice(0, 2) || null;
  const level = (ob(r.AHJLevelCode) ?? '').toLowerCase();
  const jurisdictionType: RegistryCodeAdoption['jurisdictionType'] =
    level.includes('county') ? 'county'
      : level.includes('state') ? 'state'
        : level.includes('city') || level.includes('municipal') ? 'city'
          : (city ? 'city' : county ? 'county' : 'unknown');
  return {
    ahjName,
    ahjCode: ob(r.AHJCode) ?? null,
    ahjId: ob(r.AHJID) ?? ob(r.AHJPK) ?? null,
    jurisdictionType,
    stateCode, county, city,
    editions: {
      nec: obCodeEdition(r.ElectricCode),
      ibc: obCodeEdition(r.BuildingCode),
      irc: obCodeEdition(r.ResidentialCode),
      ifc: obCodeEdition(r.FireCode),
    },
    rawEditions: {
      ElectricCode: ob(r.ElectricCode) ?? null,
      BuildingCode: ob(r.BuildingCode) ?? null,
      ResidentialCode: ob(r.ResidentialCode) ?? null,
      FireCode: ob(r.FireCode) ?? null,
    },
    permitOffice: {
      name: ob(r.BuildingCodeNotes) ?? ahjName,
      phone: ob(contact?.WorkPhone) ?? ob(contact?.MobilePhone) ?? ob(contact?.Phone) ?? null,
      email: ob(contact?.Email) ?? null,
      url: ob(contact?.URL) ?? ob(contact?.Website) ?? null,
      address: ob(addr.AddressLine1) ?? null,
    },
    engineeringReviewRequirements: Array.isArray(r.EngineeringReviewRequirements)
      ? r.EngineeringReviewRequirements
          .map((x: any) => ob(x.EngineeringReviewType) ?? ob(x.Description))
          .filter(Boolean) as string[]
      : [],
    lastUpdatedIso: ob(r.LastUpdated) ?? null,
    retrievedAtIso: meta.retrievedAtIso,
    sourceUrl: meta.sourceUrl,
    matchCount: meta.matchCount,
    matchedAhjNames: meta.matchedAhjNames,
  };
}

function firstContact(r: Record<string, any>): Record<string, any> | null {
  const list = r.Contacts ?? r.contact_set;
  return Array.isArray(list) && list.length > 0 ? list[0] : null;
}

/**
 * Map a raw Orange Button AHJ object → our AhjRecord. Real registry fields
 * (name, codes, contacts, required reviews) win; structural/setback fields the
 * registry does NOT carry come from the adopted-code table (real code logic),
 * mirroring applyCodeBasis() in ahj-national.ts. Returns null if unusable.
 */
export function mapRegistryToAhjRecord(raw: unknown, hintState?: string): AhjRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, any>;

  const ahjName = ob(r.AHJName) ?? ob(r.AHJCode);
  if (!ahjName) return null;

  const addr = (r.Address ?? {}) as Record<string, any>;
  const stateCode = (ob(addr.StateProvince) ?? hintState ?? '').toUpperCase().slice(0, 2);
  if (!/^[A-Z]{2}$/.test(stateCode)) return null;

  const code = JURISDICTION_DATA[stateCode];
  const necFromRegistry = obNecYear(r.ElectricCode);
  const necVersion: AhjRecord['necVersion'] =
    necFromRegistry ?? code?.necVersion ?? '2020';
  // AAC WS-3 FIX (audit §7.5) — the registry's Building / Residential / Fire code
  // enumerations used to be DISCARDED here. They are the exact editions
  // CODE-AUTHORITY-INCOMPLETE blocks on, so they are retained. Null when the
  // registry carries no adoption for that family — never inferred from the NEC
  // year and never defaulted from the state table.
  const ibcVersion = obCodeEdition(r.BuildingCode);
  const ircVersion = obCodeEdition(r.ResidentialCode);
  const ifcVersion = obCodeEdition(r.FireCode);

  const contact = firstContact(r);
  const reviews: string[] = Array.isArray(r.EngineeringReviewRequirements)
    ? r.EngineeringReviewRequirements
        .map((x: any) => ob(x.EngineeringReviewType) ?? ob(x.Description))
        .filter(Boolean)
    : [];

  const county = ob(addr.County) ?? '';
  const city = ob(addr.City) ?? ob(addr.AddressLine1) ?? ahjName;
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const id = `${stateCode.toLowerCase()}-${slug(county) || 'x'}-${slug(city) || 'ahj'}`;

  return {
    id,
    stateCode,
    stateName: code?.stateName ?? stateCode,
    county,
    city,
    ahjName,
    ahjType: county && !city ? 'county' : 'city',
    phone: ob(contact?.WorkPhone) ?? ob(contact?.MobilePhone) ?? ob(contact?.Phone),
    email: ob(contact?.Email),
    website: ob(contact?.URL) ?? ob(contact?.Website),
    address: ob(addr.AddressLine1),
    necVersion,
    // AAC WS-3 — retained, no longer discarded (see obCodeEdition above).
    ibcVersion, ircVersion, ifcVersion,
    codeSourceUrl: REGISTRY_URL,
    codeRetrievedAtIso: new Date().toISOString(),
    localAmendments: code?.localAmendments ?? [],
    permitRequired: true,
    permitAuthority: ahjName,
    onlinePermitting: false,
    expeditedAvailable: false,
    typicalPermitFee: code?.typicalPermitFee ?? '$150–$500',
    feeStructure: 'Contact AHJ — see registry',
    typicalPlanCheckDays: 10,
    typicalPermitDays: code?.typicalPermitDays ?? 15,
    inspectionRequired: true,
    inspectionAuthority: ahjName,
    utilityName: code?.interconnectionAuthority ?? 'Local Utility',
    interconnectionProgram: 'Net Metering',
    interconnectionDays: code?.interconnectionDays ?? 30,
    netMeteringAvailable: true,
    // Fire setbacks are code-driven (real logic), never from the registry.
    roofSetbackInches: code?.roofSetbackInches ?? 36,
    ridgeSetbackInches: code?.ridgeSetbackInches ?? 18,
    valleySetbackInches: 18,
    eaveSetbackInches: 0,
    hipRoofSetbackInches: 18,
    pathwayWidthInches: 36,
    // Wind/snow/seismic belong to the site (ASCE 7 by lat/lng), not the AHJ —
    // left at conservative placeholders; the structural engine computes per-site.
    windSpeedMph: 115,
    groundSnowLoadPsf: 0,
    seismicDesignCategory: 'D',
    specialRequirements: reviews,
    planSetRequirements: [],
    rapidShutdownRequired: true,
    rapidShutdownStandard: code ? `NEC 690.12 (${necVersion})` : 'NEC 690.12',
    notes: 'Live data from the SunSpec/Orange Button AHJ Registry.',
    dataProvenance: 'registry_live',
  };
}

/**
 * Look up the real AHJ for a location from the live registry. Returns null when
 * no token is configured, the request fails, or no AHJ matches — callers then
 * fall back to the static database.
 */
export async function lookupAhjFromRegistry(q: RegistryQuery): Promise<AhjRecord | null> {
  const token = process.env.AHJ_REGISTRY_TOKEN;
  if (!token) return null;
  if (q.lat == null && q.lng == null && !q.address) return null;

  try {
    const body: Record<string, unknown> = {};
    if (q.lat != null && q.lng != null) {
      body.Location = { Latitude: { Value: q.lat }, Longitude: { Value: q.lng } };
    }
    if (q.address) body.Address = { AddressLine1: { Value: q.address } };

    const res = await fetch(REGISTRY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Token ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;

    const data = await res.json();
    const results = Array.isArray(data?.results)
      ? data.results
      : Array.isArray(data)
        ? data
        : [];
    if (results.length === 0) return null;

    return mapRegistryToAhjRecord(results[0], q.stateCode);
  } catch {
    return null; // fail-safe: any network/parse error → static fallback
  }
}

export const isRegistryConfigured = (): boolean => !!process.env.AHJ_REGISTRY_TOKEN;

// ═══════════════════════════════════════════════════════════════════════════
// AAC WS-3 — CODE-ADOPTION RETRIEVAL WITH AN EXPLICIT, NON-SWALLOWED FAILURE
// ───────────────────────────────────────────────────────────────────────────
// `lookupAhjFromRegistry` above returns null on ANY failure — correct for the
// fallback-to-static-table caller, and USELESS for an authority resolver, which
// must report the EXACT source and the EXACT failure (directive WS-3: "Failed
// retrieval reports exact source + exact failure"). This function never throws
// and never collapses distinguishable failures into null.
// ═══════════════════════════════════════════════════════════════════════════

export const AHJ_REGISTRY_ENDPOINT = REGISTRY_URL;

/** The env-var operator action stated verbatim on a NOT_CONFIGURED failure. */
export const AHJ_REGISTRY_TOKEN_ACTION =
  'Set AHJ_REGISTRY_TOKEN (free token from support@sunspec.org) in the deployment environment, then regenerate — '
  + 'the adopted NEC/IBC/IRC/IFC editions are retrieved automatically. Until then no adoption authority exists for '
  + 'this jurisdiction and the sourceless AHJ table may not substitute for one.';

export type RegistryFailureKind =
  | 'NOT_CONFIGURED'      // no token — REQUIRES_INPUT (an env var, not a retry)
  | 'NO_COORDINATES'      // nothing to query with
  | 'HTTP_ERROR'          // the endpoint answered non-2xx
  | 'NETWORK_ERROR'       // timeout / DNS / TLS
  | 'PARSE_ERROR'         // 2xx with an unusable body
  | 'NO_MATCH';           // the registry has no AHJ at this location

export interface RegistryLookupResult {
  ok: boolean;
  record: RegistryCodeAdoption | null;
  /** every AHJ the query matched (>1 ⇒ a genuine boundary ambiguity the caller
   *  must escalate to OPERATOR_CONFIRMATION, never silently take [0]). */
  allMatches: RegistryCodeAdoption[];
  failureKind: RegistryFailureKind | null;
  /** the EXACT failure, source-qualified. Null only when ok. */
  failure: string | null;
  /** the endpoint actually queried — recorded even on failure. */
  sourceUrl: string;
  /** the minimal operator action, ONLY when one is genuinely necessary. */
  operatorAction: string | null;
  retrievedAtIso: string;
}

/**
 * Retrieve the FULL adopted-code payload for a location. Returns every match so
 * the caller can detect overlapping jurisdictions rather than silently taking the
 * first row (the directive's OPERATOR_CONFIRMATION case).
 */
export async function lookupCodeAdoptionFromRegistry(
  q: RegistryQuery,
  opts?: { nowIso?: string; fetchImpl?: typeof fetch },
): Promise<RegistryLookupResult> {
  const retrievedAtIso = opts?.nowIso ?? new Date().toISOString();
  const base = { record: null, allMatches: [] as RegistryCodeAdoption[], sourceUrl: REGISTRY_URL, retrievedAtIso };
  const token = process.env.AHJ_REGISTRY_TOKEN;
  if (!token) {
    return {
      ...base, ok: false, failureKind: 'NOT_CONFIGURED',
      failure: `${REGISTRY_URL}: AHJ_REGISTRY_TOKEN is not set — the SunSpec/Orange Button AHJ Registry was NOT queried.`,
      operatorAction: AHJ_REGISTRY_TOKEN_ACTION,
    };
  }
  if (q.lat == null && q.lng == null && !q.address) {
    return {
      ...base, ok: false, failureKind: 'NO_COORDINATES',
      failure: `${REGISTRY_URL}: neither coordinates nor an address are available on the project record — the registry cannot be queried.`,
      operatorAction: 'Geocode the installation address (the permit route already geocodes; a missing coordinate means the address did not resolve).',
    };
  }
  const doFetch = opts?.fetchImpl ?? fetch;
  try {
    const body: Record<string, unknown> = {};
    if (q.lat != null && q.lng != null) body.Location = { Latitude: { Value: q.lat }, Longitude: { Value: q.lng } };
    if (q.address) body.Address = { AddressLine1: { Value: q.address } };
    const res = await doFetch(REGISTRY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Token ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      return {
        ...base, ok: false, failureKind: 'HTTP_ERROR',
        failure: `${REGISTRY_URL}: HTTP ${res.status} ${res.statusText || ''}`.trim(),
        operatorAction: res.status === 401 || res.status === 403
          ? 'AHJ_REGISTRY_TOKEN was rejected by the registry — re-issue the token (support@sunspec.org) and update the deployment environment.'
          : null,
      };
    }
    let data: any;
    try { data = await res.json(); }
    catch (e) {
      return { ...base, ok: false, failureKind: 'PARSE_ERROR', failure: `${REGISTRY_URL}: response body is not JSON (${(e as Error).message})`, operatorAction: null };
    }
    const results: unknown[] = Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : [];
    if (results.length === 0) {
      return {
        ...base, ok: false, failureKind: 'NO_MATCH',
        failure: `${REGISTRY_URL}: the registry returned no AHJ for this location (lat=${q.lat ?? '—'}, lng=${q.lng ?? '—'}).`,
        operatorAction: null,
      };
    }
    const names = results
      .map(x => (x && typeof x === 'object' ? (ob((x as Record<string, any>).AHJName) ?? ob((x as Record<string, any>).AHJCode)) : undefined))
      .filter(Boolean) as string[];
    const meta = { retrievedAtIso, sourceUrl: REGISTRY_URL, matchCount: results.length, matchedAhjNames: names, hintState: q.stateCode };
    const mapped = results.map(x => mapRegistryToCodeAdoption(x, meta)).filter(Boolean) as RegistryCodeAdoption[];
    if (mapped.length === 0) {
      return { ...base, ok: false, failureKind: 'PARSE_ERROR', failure: `${REGISTRY_URL}: ${results.length} result(s) returned but none carried an AHJName/AHJCode.`, operatorAction: null };
    }
    return { ok: true, record: mapped[0], allMatches: mapped, failureKind: null, failure: null, sourceUrl: REGISTRY_URL, operatorAction: null, retrievedAtIso };
  } catch (err: unknown) {
    const e = err as { name?: string; message?: string };
    const kind: RegistryFailureKind = e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'NETWORK_ERROR' : 'NETWORK_ERROR';
    return {
      ...base, ok: false, failureKind: kind,
      failure: `${REGISTRY_URL}: ${e?.name ?? 'Error'} ${e?.message ?? String(err)}`.trim(),
      operatorAction: null,
    };
  }
}
