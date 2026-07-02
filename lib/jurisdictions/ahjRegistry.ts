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
