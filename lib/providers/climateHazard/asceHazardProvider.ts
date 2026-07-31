// ═══════════════════════════════════════════════════════════════════════════
// AAC WS-4 — THE LIVE ASCE 7 HAZARD-TOOL PROVIDER
// ───────────────────────────────────────────────────────────────────────────
// WHAT THE ASCE HAZARD TOOL ACTUALLY IS (investigated 2026-07-27, not assumed):
//
//   ascehazardtool.org is a Dojo/ArcGIS client (asce7hazardtool.online 301s to
//   it). It has NO documented REST API of its own. Its app config
//   (`/app/js/config/config.js`) names the ArcGIS services it reads, and the
//   HAZARD RASTERS are PUBLIC, unauthenticated ArcGIS ImageServers on
//   `https://gis.asce.org/arcgis/rest/services/...` supporting the standard
//   `identify` operation. Only the ancillary `ASCE_Loading_locked/MapServer`
//   (state snow case-study zones, rain, tsunami tables) requires an ArcGIS token
//   — it answers `{"error":{"code":499,"message":"Token Required"}}`.
//
//   So the wind and snow values ARE live-retrievable with no key. Verified by
//   direct call on 2026-07-27 (see fixtures.ts for the captured Braidon values).
//
//   Seismic is NOT on gis.asce.org; the authoritative service is the USGS
//   ASCE 7 web service (earthquake.usgs.gov/ws/designmaps/asce7-16.json), which
//   is public and returns Ss/S1/Sds/Sd1/SDC. Elevation comes from the USGS
//   Elevation Point Query Service (epqs.nationalmap.gov), corroborated by ASCE's
//   own snow DEM (s2022_Elevation, metres).
//
//   ATC "Hazards by Location" (hazards.atcouncil.org) was checked as a secondary
//   corroborator and is CURRENTLY SUSPENDED ("Website Suspended" / api.atcouncil.org
//   does not resolve), so it is deliberately NOT wired. Adding a dead host would
//   be a swallowed failure by construction.
//
// UNMETERED: all four services are free and quota-free, so the nearmapCache
// fail-closed gate does not apply. The DURABLE cache is the archived
// `climate_hazard_dataset` registry document — the resolver looks that up FIRST
// and only calls out when no archived record covers the site.
//
// NEVER FABRICATES: a service that does not answer produces a FAILURE with the
// exact endpoint and the exact error. Wind and snow are both REQUIRED; seismic
// and elevation are corroborators and their absence degrades confidence rather
// than failing the retrieval.
// ═══════════════════════════════════════════════════════════════════════════

import {
  retrievalOk, retrievalFailure, type RetrievalResult,
} from '../types';
import {
  WIND_MRI_BY_RISK,
  type AsceEdition, type ClimateHazardProvider, type HazardDatum, type HazardQuery,
  type RetrievedHazards, type RiskCategory,
} from './types';

const GIS = 'https://gis.asce.org/arcgis/rest/services';
const USGS_SEISMIC = 'https://earthquake.usgs.gov/ws/designmaps';
const USGS_EPQS = 'https://epqs.nationalmap.gov/v1/json';
const TIMEOUT_MS = 12000;

/** The ImageServer that carries the basic wind speed for an edition + risk
 *  category. ASCE 7-22 rasters are per-MRI (w2022_mriNNN); 7-16 rasters are per
 *  MRI too (wind2016_NNN). 7-10 uses the ABC category rasters, which are NOT
 *  risk-category-indexed the same way — unsupported here rather than approximated. */
export function windServiceFor(edition: AsceEdition, risk: RiskCategory): string | null {
  const mri = WIND_MRI_BY_RISK[risk];
  if (edition === '7-22') return `${GIS}/ASCE722/w2022_mri${mri}/ImageServer`;
  if (edition === '7-16') return `${GIS}/ASCE/wind2016_${mri}/ImageServer`;
  return null;
}

/** The ImageServer that carries the ground snow load. ASCE 7-22 publishes pg per
 *  risk category (s2022_RiskCategoryN). ASCE 7-16's snow grid lives behind the
 *  token-locked MapServer, so 7-16 snow is NOT live-retrievable and is reported
 *  as a precise coverage failure rather than substituted from 7-22. */
export function snowServiceFor(edition: AsceEdition, risk: RiskCategory): string | null {
  if (edition !== '7-22') return null;
  const n = { I: 1, II: 2, III: 3, IV: 4 }[risk];
  return `${GIS}/ASCE722/s2022_RiskCategory${n}/ImageServer`;
}

const ELEVATION_SERVICE = `${GIS}/ASCE722/s2022_Elevation/ImageServer`;

interface IdentifyOutcome { value: number | null; error: string | null; }

async function identify(
  serviceUrl: string, lat: number, lng: number, fetchImpl: typeof fetch,
): Promise<IdentifyOutcome> {
  const qs = new URLSearchParams({
    geometry: JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint',
    returnGeometry: 'false',
    f: 'json',
  });
  try {
    const res = await fetchImpl(`${serviceUrl}/identify?${qs.toString()}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return { value: null, error: `HTTP ${res.status} ${res.statusText || ''}`.trim() };
    const j = await res.json() as { value?: unknown; error?: { message?: string } };
    if (j?.error) return { value: null, error: `service error: ${j.error.message ?? 'unknown'}` };
    const raw = j?.value;
    // ArcGIS returns the pixel as a STRING; 'NoData' outside coverage.
    if (raw == null || raw === 'NoData') return { value: null, error: 'NoData (outside raster coverage)' };
    const n = Number(raw);
    return Number.isFinite(n) ? { value: n, error: null } : { value: null, error: `unparseable pixel value '${String(raw)}'` };
  } catch (err: unknown) {
    const e = err as { name?: string; message?: string };
    return { value: null, error: `${e?.name ?? 'Error'} ${e?.message ?? String(err)}`.trim() };
  }
}

async function fetchSeismic(
  lat: number, lng: number, risk: RiskCategory, siteClass: string, edition: AsceEdition, fetchImpl: typeof fetch,
): Promise<{ value: RetrievedHazards['seismic']; url: string; error: string | null }> {
  // The USGS service publishes asce7-16 and asce7-22 endpoints; 7-22 seismic
  // adopts the 2022 multi-period spectra. Use the matching edition where the
  // service has one, else the nearest PUBLISHED edition, recorded verbatim in
  // `referenceDocument` so the record never claims an edition it did not query.
  const doc = edition === '7-10' ? 'asce7-10' : edition === '7-22' ? 'asce7-22' : 'asce7-16';
  const url = `${USGS_SEISMIC}/${doc}.json?latitude=${lat}&longitude=${lng}&riskCategory=${risk}&siteClass=${encodeURIComponent(siteClass)}&title=solarpro-permit`;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow' });
    if (!res.ok) return { value: null, url, error: `HTTP ${res.status}` };
    const j = await res.json() as { response?: { data?: Record<string, unknown> } };
    const d = j?.response?.data;
    if (!d) return { value: null, url, error: 'no response.data in the USGS payload' };
    const num = (k: string): number | null => {
      const v = d[k];
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
    };
    return {
      value: {
        referenceDocument: doc.toUpperCase().replace('ASCE', 'ASCE '),
        siteClass,
        ss: num('ss'), s1: num('s1'), sds: num('sds'), sd1: num('sd1'),
        sdc: typeof d.sdc === 'string' ? d.sdc : null,
      },
      url, error: null,
    };
  } catch (err: unknown) {
    const e = err as { name?: string; message?: string };
    return { value: null, url, error: `${e?.name ?? 'Error'} ${e?.message ?? String(err)}`.trim() };
  }
}

async function fetchElevationFt(
  lat: number, lng: number, fetchImpl: typeof fetch,
): Promise<{ value: number | null; url: string; error: string | null }> {
  const url = `${USGS_EPQS}?x=${lng}&y=${lat}&units=Feet&wkid=4326&includeDate=false`;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return { value: null, url, error: `HTTP ${res.status}` };
    const j = await res.json() as { value?: unknown };
    const n = Number(j?.value);
    return Number.isFinite(n) ? { value: n, url, error: null } : { value: null, url, error: 'no numeric elevation in the EPQS payload' };
  } catch (err: unknown) {
    const e = err as { name?: string; message?: string };
    return { value: null, url, error: `${e?.name ?? 'Error'} ${e?.message ?? String(err)}`.trim() };
  }
}

export interface AsceHazardProviderOptions {
  fetchImpl?: typeof fetch;
  nowIso?: string;
  /** hard switch — set CLIMATE_HAZARD_RETRIEVAL_DISABLED=1 to stop every live
   *  call (the NEARMAP_AI_CACHE_ONLY precedent). The resolver then reports
   *  NOT_CONFIGURED with the exact operator action, never a silent skip. */
  disabled?: boolean;
}

export const CLIMATE_HAZARD_DISABLED_ACTION =
  'CLIMATE_HAZARD_RETRIEVAL_DISABLED is set — unset it to allow the ASCE 7 Hazard-Tool retrieval, '
  + 'or archive a climate_hazard_dataset document for this site through the document registry.';

/**
 * THE live provider. Unmetered, key-free, and fails LOUDLY with the exact
 * endpoint and error for every scalar it could not obtain.
 */
export function createAsceHazardProvider(opts?: AsceHazardProviderOptions): ClimateHazardProvider {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  return {
    name: 'asce-7-hazard-tool (gis.asce.org ImageServers + USGS ASCE 7 / EPQS)',
    metered: false,
    isConfigured(): boolean {
      if (opts?.disabled) return false;
      return process.env.CLIMATE_HAZARD_RETRIEVAL_DISABLED !== '1';
    },
    async getHazards(q: HazardQuery): Promise<RetrievalResult<RetrievedHazards>> {
      const retrievedAtIso = opts?.nowIso ?? new Date().toISOString();
      if (!this.isConfigured()) {
        return retrievalFailure({
          sourcesQueried: [], retrievedAtIso, failureKind: 'NOT_CONFIGURED',
          failure: 'ASCE 7 Hazard-Tool retrieval is disabled by CLIMATE_HAZARD_RETRIEVAL_DISABLED=1 — no hazard service was queried.',
          operatorAction: CLIMATE_HAZARD_DISABLED_ACTION,
        });
      }
      if (!Number.isFinite(q.lat) || !Number.isFinite(q.lng)) {
        return retrievalFailure({
          sourcesQueried: [], retrievedAtIso, failureKind: 'INSUFFICIENT_QUERY',
          failure: 'no site coordinates — the hazard rasters are indexed by lat/lng and cannot be queried without them.',
          operatorAction: 'Geocode the installation address so the project carries lat/lng, then regenerate.',
        });
      }
      const windUrl = windServiceFor(q.asceEdition, q.riskCategory);
      const snowUrl = snowServiceFor(q.asceEdition, q.riskCategory);
      const sources: string[] = [];
      const data: HazardDatum[] = [];
      const problems: string[] = [];

      // ── wind (REQUIRED) ────────────────────────────────────────────────────
      let windSpeedMph: number | null = null;
      const mri = WIND_MRI_BY_RISK[q.riskCategory];
      if (!windUrl) {
        problems.push(`no public ASCE ${q.asceEdition} basic-wind-speed raster exists for risk category ${q.riskCategory} `
          + '(ASCE 7-10 publishes category A/B/C maps, not per-MRI rasters) — no value substituted');
      } else {
        sources.push(windUrl);
        const w = await identify(windUrl, q.lat, q.lng, fetchImpl);
        if (w.error) problems.push(`${windUrl}: ${w.error}`);
        windSpeedMph = w.value;
        data.push({
          label: `basic wind speed V (${mri}-yr MRI, Risk Category ${q.riskCategory})`,
          value: w.value, unit: 'mph', sourceUrl: windUrl,
          dataset: `ASCE ${q.asceEdition} basic wind speed raster (${windUrl.split('/').slice(-2, -1)[0]})`,
        });
      }

      // ── ground snow (REQUIRED) ─────────────────────────────────────────────
      let groundSnowLoadPsf: number | null = null;
      if (!snowUrl) {
        problems.push(`the ASCE ${q.asceEdition} ground-snow grid is not published as a public ImageServer `
          + '(ASCE 7-16/7-10 snow lives behind the token-locked ASCE_Loading_locked MapServer) — no value substituted '
          + 'and no other edition\'s value borrowed');
      } else {
        sources.push(snowUrl);
        const s = await identify(snowUrl, q.lat, q.lng, fetchImpl);
        if (s.error) problems.push(`${snowUrl}: ${s.error}`);
        groundSnowLoadPsf = s.value;
        data.push({
          label: `ground snow load pg (Risk Category ${q.riskCategory})`,
          value: s.value, unit: 'psf', sourceUrl: snowUrl,
          dataset: `ASCE ${q.asceEdition} ground snow load raster (s2022_RiskCategory${{ I: 1, II: 2, III: 3, IV: 4 }[q.riskCategory]})`,
        });
      }

      // Wind AND snow are the two values the authority record must carry. Either
      // one missing is a genuine coverage failure — never a substituted default.
      if (windSpeedMph == null || groundSnowLoadPsf == null) {
        return retrievalFailure({
          sourcesQueried: sources, retrievedAtIso, failureKind: sources.length === 0 ? 'INSUFFICIENT_QUERY' : 'NO_COVERAGE',
          failure: `ASCE ${q.asceEdition} hazard retrieval incomplete at ${q.lat},${q.lng}: `
            + `${windSpeedMph == null ? 'basic wind speed NOT retrieved' : `V=${windSpeedMph} mph`}; `
            + `${groundSnowLoadPsf == null ? 'ground snow load NOT retrieved' : `pg=${groundSnowLoadPsf} psf`}. `
            + problems.join(' · '),
          operatorAction: 'Archive an ASCE 7 Hazard-Tool report (or the AHJ climate/design-criteria ordinance) for this site '
            + 'through the document registry, with wind + snow + the exposure/risk basis, a SHA-256, and a recorded currency review.',
        });
      }

      // ── seismic (corroborator) ─────────────────────────────────────────────
      const siteClass = (q.siteClass ?? 'D').trim() || 'D';
      const seis = await fetchSeismic(q.lat, q.lng, q.riskCategory, siteClass, q.asceEdition, fetchImpl);
      sources.push(seis.url);
      if (seis.error) problems.push(`${seis.url}: ${seis.error}`);
      if (seis.value) {
        data.push({ label: `seismic Ss / S1 / SDS / SD1 / SDC (site class ${siteClass})`,
          value: seis.value.sdc, unit: 'SDC', sourceUrl: seis.url,
          dataset: `USGS ${seis.value.referenceDocument} design maps web service` });
      }

      // ── elevation (corroborator, two independent services) ─────────────────
      const epqs = await fetchElevationFt(q.lat, q.lng, fetchImpl);
      sources.push(epqs.url);
      if (epqs.error) problems.push(`${epqs.url}: ${epqs.error}`);
      let elevationFt = epqs.value;
      if (elevationFt == null) {
        sources.push(ELEVATION_SERVICE);
        const dem = await identify(ELEVATION_SERVICE, q.lat, q.lng, fetchImpl);
        if (dem.error) problems.push(`${ELEVATION_SERVICE}: ${dem.error}`);
        // the ASCE snow DEM is in METRES.
        elevationFt = dem.value == null ? null : Math.round(dem.value * 3.28084 * 10) / 10;
        if (elevationFt != null) {
          data.push({ label: 'site elevation', value: elevationFt, unit: 'ft', sourceUrl: ELEVATION_SERVICE, dataset: 'ASCE 7-22 snow DEM (s2022_Elevation, metres → ft)' });
        }
      } else {
        data.push({ label: 'site elevation', value: elevationFt, unit: 'ft', sourceUrl: epqs.url, dataset: 'USGS 3DEP Elevation Point Query Service' });
      }

      // Confidence: both required values retrieved = 0.9; each corroborator adds.
      let confidence = 0.9;
      if (seis.value?.sdc) confidence += 0.05;
      if (elevationFt != null) confidence += 0.05;
      confidence = Math.round(Math.min(1, confidence) * 100) / 100;

      const value: RetrievedHazards = {
        asceEdition: q.asceEdition,
        riskCategory: q.riskCategory,
        windMriYears: mri,
        windSpeedMph, groundSnowLoadPsf,
        seismic: seis.value,
        elevationFt,
        coordinates: { lat: q.lat, lng: q.lng },
        addressUsed: q.addressUsed ?? null,
        data,
        proof: 'live-retrieval',
      };
      return retrievalOk({ value, sourcesQueried: sources, retrievedAtIso, confidence });
    },
  };
}
