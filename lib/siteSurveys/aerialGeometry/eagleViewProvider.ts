// ============================================================================
// lib/siteSurveys/aerialGeometry/eagleViewProvider.ts
//
// EagleView aerial geometry provider (pay-per-report, any address incl. rural).
//
// STATUS:
//   ✅ Auth (OAuth2 client-credentials) is wired against the real EagleView base
//      URLs taken from the developer docs.
//   ⏳ getRoofFacets() is NOT YET COMPLETE — the Property Data / Measurement
//      Orders endpoint paths and their response shapes still need to be mapped
//      from the downloaded EagleView API doc / Postman collection. The mapping
//      stub (mapMeasurementToFacets) is the single place that work lands.
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

// Base URLs from the EagleView developer docs (sandbox vs production).
const TOKEN_BASE_URL = 'https://apicenter.eagleview.com';
const API_BASE = {
  sandbox: 'https://sandbox.apis.eagleview.com',
  production: 'https://apis.eagleview.com',
} as const;

// CONFIRMED from the EagleView "Authentication Methods → Auth endpoints" docs:
//   Authorization: https://apicenter.eagleview.com/oauth2/v1/authorize
//   Token:         https://apicenter.eagleview.com/oauth2/v1/token   (← used here)
//   Revoke:        https://apicenter.eagleview.com/oauth2/v1/revoke
// Same endpoints for sandbox + production. Tokens are valid 1 hour (cache + reuse).
// Client Credentials is the correct grant for our backend (no end-user) app.
const DEFAULT_TOKEN_PATH = '/oauth2/v1/token';

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

/**
 * ⏳ PENDING API DOC: map an EagleView measurement/property response into
 * vendor-neutral RoofFacets. This is the ONLY piece left once we read the
 * downloaded API doc — EagleView returns per-facet roof geometry (pitch,
 * azimuth, area, outline); convert each to a RoofFacet (polygon in WGS84 lat/lng).
 */
export function mapMeasurementToFacets(_raw: unknown): RoofFacet[] {
  throw new Error(
    '[eagleViewProvider] mapMeasurementToFacets not implemented — pending EagleView ' +
      'Property Data / Measurement Orders response schema from the API doc.',
  );
}

export class EagleViewProvider implements AerialGeometryProvider {
  readonly name = 'eagleview' as const;

  isConfigured(): boolean {
    return creds() !== null;
  }

  apiBase(): string {
    return API_BASE[env()];
  }

  async getRoofFacets(_req: AerialGeometryRequest): Promise<AerialRoofResult | null> {
    // ⏳ PENDING: once the Property Data / Measurement Orders endpoint paths and
    // response shapes are confirmed from the API doc:
    //   1. const token = await getEagleViewToken();
    //   2. fetch `${this.apiBase()}/<property-or-measurement-endpoint>` with the
    //      address/lat-lng and Authorization: Bearer ${token};
    //   3. return { source: 'eagleview', facets: mapMeasurementToFacets(json), ... }.
    throw new Error(
      '[eagleViewProvider] getRoofFacets not implemented — auth is wired; the ' +
        'Property Data / Measurement Orders fetch + mapping is pending the EagleView API doc.',
    );
  }
}
