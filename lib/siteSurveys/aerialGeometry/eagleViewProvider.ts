// ============================================================================
// lib/siteSurveys/aerialGeometry/eagleViewProvider.ts
//
// EagleView aerial geometry provider (pay-per-report, any address incl. rural).
//
// STATUS:
//   ✅ Auth (OAuth2 client-credentials) wired against the real token endpoint.
//   ✅ Authenticated reads (GetAvailableProducts / GetAccountDetails) — used by
//      the connectivity test to prove creds work and fetch the real product IDs.
//   ⏳ Roof geometry: the Measurement Orders API returns summary numbers (area,
//      pitch, facet COUNT, edge lengths, pitch table) but NOT the per-facet
//      polygons we draw — those live in a downloadable report FILE (DXF/JSON)
//      retrieved after a report completes. getRoofFacets() therefore needs the
//      place-order → poll → download-file → parse-file flow, which is built
//      incrementally once a real sandbox report file confirms the geometry format.
//
// Credentials come from env (NEVER hardcoded):
//   EAGLEVIEW_CLIENT_ID, EAGLEVIEW_CLIENT_SECRET   (sandbox app creds on dev)
//   EAGLEVIEW_ENV = 'sandbox' | 'production'        (default 'sandbox')
//   EAGLEVIEW_TOKEN_URL (optional override of the token endpoint)
// ============================================================================

import type {
  AerialGeometryProvider,
  AerialGeometryRequest,
  AerialRoofResult,
  RoofFacet,
} from './types';

// CONFIRMED from the EagleView "Authentication Methods → Auth endpoints" docs.
// Same token endpoint for sandbox + production; tokens valid ~1h (cache + reuse).
const TOKEN_BASE_URL = 'https://apicenter.eagleview.com';
const DEFAULT_TOKEN_PATH = '/oauth2/v1/token';

// Measurement Orders API host (from the Measurement Orders OpenAPI `host`).
// NOTE: this is apicenter.eagleview.com — different from the Imagery API host.
const MEASUREMENT_BASE = {
  sandbox: 'https://sandbox.apicenter.eagleview.com',
  production: 'https://apicenter.eagleview.com',
} as const;

function env(): 'sandbox' | 'production' {
  return process.env.EAGLEVIEW_ENV === 'production' ? 'production' : 'sandbox';
}

function creds(): { id: string; secret: string } | null {
  const id = process.env.EAGLEVIEW_CLIENT_ID;
  const secret = process.env.EAGLEVIEW_CLIENT_SECRET;
  return id && secret ? { id, secret } : null;
}

// ─── Token cache (per server instance) ───────────────────────────────────────
let _token: { value: string; expiresAt: number } | null = null;

/**
 * Get a bearer token via the OAuth2 client-credentials grant. Tokens are
 * short-lived (~1 hour per the docs); cached in-memory with a 60s safety margin.
 */
export async function getEagleViewToken(): Promise<string> {
  const c = creds();
  if (!c) throw new Error('EagleView credentials not configured (EAGLEVIEW_CLIENT_ID / EAGLEVIEW_CLIENT_SECRET).');

  if (_token && _token.expiresAt > Date.now() + 60_000) return _token.value;

  const tokenUrl = process.env.EAGLEVIEW_TOKEN_URL || `${TOKEN_BASE_URL}${DEFAULT_TOKEN_PATH}`;
  const basic = Buffer.from(`${c.id}:${c.secret}`).toString('base64');

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`EagleView token request failed: ${res.status} ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error('EagleView token response missing access_token.');

  _token = {
    value: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
  return _token.value;
}

/** Authenticated GET against the Measurement Orders API, returning parsed JSON. */
export async function eagleViewGet<T = unknown>(path: string): Promise<T> {
  const token = await getEagleViewToken();
  const url = `${MEASUREMENT_BASE[env()]}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`EagleView GET ${path} failed: ${res.status} ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

/** The product catalog (primary/delivery/add-on product IDs needed to place an order). */
export async function getAvailableProducts(): Promise<unknown> {
  return eagleViewGet('/v2/Product/GetAvailableProducts');
}

/** Fetch a completed report's summary measurements by id. */
export async function getReport(reportId: number | string): Promise<unknown> {
  return eagleViewGet(`/v3/Report/GetReport?reportId=${encodeURIComponent(String(reportId))}`);
}

// EagleView report file-type codes (from the Postman collection).
export const EV_FILE_TYPE = {
  MEASUREMENT_JSON: 107, // EV Measurement JSON — the per-facet roof geometry
  DXF: 26,
  XML: 18,
  PDF: 206,
} as const;

/**
 * Fetch a report file's raw text (e.g. the EV Measurement JSON, fileType 107).
 * Returns the raw body so the caller can parse the geometry. Uses
 * GetReportFileAnyFormat so EagleView picks the available format for the type.
 */
export async function getReportFileText(
  reportId: number | string,
  fileType: number = EV_FILE_TYPE.MEASUREMENT_JSON,
): Promise<{ status: number; contentType: string | null; body: string }> {
  const token = await getEagleViewToken();
  const url = `${MEASUREMENT_BASE[env()]}/v1/File/GetReportFileAnyFormat?fileType=${fileType}&reportId=${encodeURIComponent(String(reportId))}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  return {
    status: res.status,
    contentType: res.headers.get('content-type'),
    body: await res.text().catch(() => ''),
  };
}

/**
 * ⏳ PENDING: map a downloaded EagleView roof report FILE (DXF/JSON) into
 * vendor-neutral RoofFacets. The per-facet polygons live in the report file,
 * not the API response — wire this once a real sandbox report file confirms the
 * geometry format.
 */
export function mapMeasurementToFacets(_rawReportFile: unknown): RoofFacet[] {
  throw new Error(
    '[eagleViewProvider] mapMeasurementToFacets not implemented — per-facet geometry ' +
      'lives in the downloadable report file (DXF/JSON); format pending a real sandbox report.',
  );
}

export class EagleViewProvider implements AerialGeometryProvider {
  readonly name = 'eagleview' as const;

  isConfigured(): boolean {
    return creds() !== null;
  }

  apiBase(): string {
    return MEASUREMENT_BASE[env()];
  }

  async getRoofFacets(_req: AerialGeometryRequest): Promise<AerialRoofResult | null> {
    // ⏳ PENDING the full order flow: place a Measurement Order (PlaceOrder) →
    // poll GetReport until complete → download the geometry file (file-links /
    // GetReportFile) → mapMeasurementToFacets(file). Built incrementally after the
    // connectivity test confirms auth + the report file format.
    throw new Error(
      '[eagleViewProvider] getRoofFacets not implemented — auth + product reads are wired; ' +
        'the place-order → download-file → parse flow is pending a real sandbox report file.',
    );
  }
}
