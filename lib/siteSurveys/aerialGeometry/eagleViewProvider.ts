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
import { parseEagleViewMeasurementJson } from './eagleViewMeasurementParser';

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
 * Map a downloaded EagleView "EV Measurement JSON" report file (fileType 107)
 * into vendor-neutral RoofFacets, anchored at the report's lat/lng. The per-facet
 * polygons live in the report file (POINTS/LINES/FACES), not the API response.
 */
export function mapMeasurementToFacets(rawReportFile: unknown, originLat: number, originLng: number): RoofFacet[] {
  return parseEagleViewMeasurementJson(rawReportFile, originLat, originLng).facets;
}

// ─── Ordering (Phase 1) ──────────────────────────────────────────────────────

// Roof report product IDs (env-overridable). Defaults from the sandbox sample +
// the Postman PlaceOrder example: 110 = "Bid Perfect" roof report.
const EV_PRODUCT = {
  primary: Number(process.env.EAGLEVIEW_PRIMARY_PRODUCT_ID) || 110,
  delivery: Number(process.env.EAGLEVIEW_DELIVERY_PRODUCT_ID) || 8,
  instruction: Number(process.env.EAGLEVIEW_MEASUREMENT_INSTRUCTION) || 3,
};

async function eagleViewPost<T = unknown>(path: string, body: unknown): Promise<T> {
  const token = await getEagleViewToken();
  const url = `${MEASUREMENT_BASE[env()]}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`EagleView POST ${path} failed: ${res.status} ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

/** Place a roof Measurement Order for an address. Returns the new report id. */
export async function placeRoofOrder(req: AerialGeometryRequest): Promise<number> {
  if (!req.address || !req.state || !req.zip) {
    throw new Error('EagleView order requires address, state, and zip.');
  }
  const body = {
    OrderReports: [
      {
        ReportAddresses: [
          {
            Address: req.address, City: req.city ?? '', State: req.state, Zip: req.zip,
            Country: req.country ?? 'US', Latitude: req.lat, Longitude: req.lng, AddressType: 1,
          },
        ],
        PrimaryProductId: EV_PRODUCT.primary,
        DeliveryProductId: EV_PRODUCT.delivery,
        MeasurementInstructionType: EV_PRODUCT.instruction,
        ChangesInLast4Years: false,
      },
    ],
    PromoCode: null, PlaceOrderUser: null, CreditCardData: null,
  };
  const resp = await eagleViewPost<{ OrderId?: number; ReportIds?: number[] }>('/v2/Order/PlaceOrder', body);
  const reportId = resp.ReportIds?.[0];
  if (!reportId) throw new Error('EagleView PlaceOrder returned no report id.');
  return reportId;
}

/** True once the report's measurement-JSON geometry file (type 107) is ready. */
export async function isRoofReportReady(reportId: number | string): Promise<boolean> {
  const r = (await getReport(reportId)) as { DeliveryFilesAvailable?: Array<{ DeliveryFileTypeId?: number }> };
  return (r.DeliveryFilesAvailable ?? []).some((f) => f.DeliveryFileTypeId === EV_FILE_TYPE.MEASUREMENT_JSON);
}

/** Fetch + parse a COMPLETED report into facets (called by the webhook + poller). */
export async function parseRoofFromReport(reportId: number | string): Promise<AerialRoofResult> {
  const r = (await getReport(reportId)) as { Latitude?: number; Longitude?: number };
  const file = await getReportFileText(reportId, EV_FILE_TYPE.MEASUREMENT_JSON);
  const facets = parseEagleViewMeasurementJson(JSON.parse(file.body), Number(r.Latitude) || 0, Number(r.Longitude) || 0).facets;
  return { source: 'eagleview', facets, reportId: String(reportId) };
}

export class EagleViewProvider implements AerialGeometryProvider {
  readonly name = 'eagleview' as const;

  isConfigured(): boolean {
    return creds() !== null;
  }

  apiBase(): string {
    return MEASUREMENT_BASE[env()];
  }

  async getRoofFacets(req: AerialGeometryRequest): Promise<AerialRoofResult | null> {
    const reportId = await placeRoofOrder(req);
    // Bounded poll for completion. Real (multi-hour) reports should instead be
    // finalised by the /api/eagleview/webhook listener calling parseRoofFromReport.
    const maxAttempts = Number(process.env.EAGLEVIEW_POLL_ATTEMPTS) || 6;
    const gapMs = Number(process.env.EAGLEVIEW_POLL_GAP_MS) || 3000;
    for (let i = 0; i < maxAttempts; i++) {
      if (await isRoofReportReady(reportId)) return parseRoofFromReport(reportId);
      if (i < maxAttempts - 1) await new Promise((r) => setTimeout(r, gapMs));
    }
    // Not ready within the poll window — return the order id with no facets so
    // the caller can finalise later via the webhook. Empty facets = "pending".
    return { source: 'eagleview', facets: [], reportId: String(reportId) };
  }
}
