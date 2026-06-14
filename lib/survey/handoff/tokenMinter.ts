// ============================================================================
// v47.438 - Survey Handoff: Token Minter
//
// mintHandoffToken() creates a signed HS256 JWT that SolarPro passes to the
// partner mobile app via the handoff launch URL:
//
//   https://survey.partnerapp.com/new-survey?token=<jwt>
//
// Algorithm:  HS256
// Secret:     SOLARPRO_HANDOFF_SECRET env var
// TTL:        HANDOFF_TOKEN_TTL_SECONDS env var (default: 600)
//
// Required claims:
//   jti         - unique token ID (crypto random UUID)
//   project_id  - SolarPro project UUID, OR "__standalone__" for field-
//                 worker self-initiated surveys (no project pre-selected).
//
// Recommended claims (include when available):
//   project_name, site_name, site_address, inspector_name,
//   category_id, category_name, notes,
//   latitude, longitude, gps_accuracy, metadata
//
// v47.438 adds:
//   standalone  - boolean, true when minted via /api/survey/standalone-handoff.
//                 project_id will be "__standalone__" in this case.
//                 The survey app will show a client/project picker on Step 1.
//
// Standard fields:
//   iat - issued-at (seconds since epoch)
//   exp - expiry (iat + ttl)
//
// buildHandoffUrl() wraps mintHandoffToken() and returns the full launch URL.
//
// Environment variables required:
//   SOLARPRO_HANDOFF_SECRET       - shared HS256 secret (min 32 chars)
//   PARTNER_BASE_URL              - e.g. https://survey.partnerapp.com
//   HANDOFF_TOKEN_TTL_SECONDS     - optional, default 600
//   STANDALONE_HANDOFF_TTL_SECONDS - optional, default 86400 (24h for standalone)
// ============================================================================

import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { STANDALONE_PROJECT_ID } from '../v2/types';

// ---------------------------------------------------------------------------
// HandoffTokenPayload - the claims included in the handoff JWT.
// ---------------------------------------------------------------------------
export interface HandoffTokenPayload {
  // Required. Use STANDALONE_PROJECT_ID ("__standalone__") when no project
  // has been selected yet (field worker self-initiated survey).
  project_id: string;

  // v47.438: standalone flag. Set to true when minting for self-initiated
  // surveys. The survey app uses this to show the client/project picker.
  standalone?: boolean;

  // SSO identity - SolarPro user who initiated the handoff
  // Used by the partner app to auto-provision / match accounts
  solarpro_user_id?: string;
  solarpro_email?: string;
  solarpro_name?: string;
  // Ownership routing - partner stores this on the survey record so the
  // webhook payload carries it back to SolarPro for owner resolution (F-06).
  solarpro_project_id?: string;

  // Recommended - include when available on the project record
  project_name?: string;
  site_name?: string;
  site_address?: string;
  inspector_name?: string;
  category_id?: string;
  category_name?: string;
  notes?: string;
  latitude?: number;
  longitude?: number;
  gps_accuracy?: number;
  metadata?: Record<string, unknown>;
  // QW-2: Pre-fill structure type and stories from project data
  structure_type?: string;
  stories?: string;
}

// ---------------------------------------------------------------------------
// MintHandoffTokenResult
// ---------------------------------------------------------------------------
export type MintHandoffTokenResult =
  | { ok: true; token: string; jti: string; exp: number }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// mintHandoffToken
//
// Signs a HS256 JWT with the required + recommended claims.
// Returns { ok: true, token, jti, exp } on success.
// Returns { ok: false, error } if env vars are missing or signing fails.
// Never throws.
//
// For standalone surveys, pass { project_id: STANDALONE_PROJECT_ID, standalone: true }.
// The TTL is longer (24h by default via STANDALONE_HANDOFF_TTL_SECONDS) to
// accommodate field workers who may start a survey much later in the day.
// ---------------------------------------------------------------------------
export function mintHandoffToken(
  payload: HandoffTokenPayload,
): MintHandoffTokenResult {
  const secret = process.env.SOLARPRO_HANDOFF_SECRET;
  if (!secret) {
    return {
      ok: false,
      error: 'SOLARPRO_HANDOFF_SECRET is not set',
    };
  }
  if (secret.length < 32) {
    return {
      ok: false,
      error: 'SOLARPRO_HANDOFF_SECRET must be at least 32 characters',
    };
  }

  // Standalone surveys get a longer TTL (24h default) since the field worker
  // may be out all day. Project-specific surveys keep the short default (10min).
  const isStandalone = payload.standalone === true || payload.project_id === STANDALONE_PROJECT_ID;
  const defaultTtl = isStandalone ? 86400 : 600;
  const envKey = isStandalone ? 'STANDALONE_HANDOFF_TTL_SECONDS' : 'HANDOFF_TOKEN_TTL_SECONDS';
  const ttl = parseInt(process.env[envKey] ?? String(defaultTtl), 10);
  const safeTtl = Number.isFinite(ttl) && ttl > 0 ? ttl : defaultTtl;

  const jti = randomUUID();
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + safeTtl;

  // Build claims - only include defined values
  const claims: Record<string, unknown> = {
    jti,
    iat,
    exp,
    project_id: payload.project_id,
  };

  // Include standalone flag when true
  if (isStandalone) {
    claims['standalone'] = true;
  }

  const optionalFields: (keyof HandoffTokenPayload)[] = [
    'solarpro_user_id',
    'solarpro_email',
    'solarpro_name',
    'solarpro_project_id',
    'project_name',
    'site_name',
    'site_address',
    'inspector_name',
    'category_id',
    'category_name',
    'notes',
    'latitude',
    'longitude',
    'gps_accuracy',
    'metadata',
    'structure_type',  // QW-2: pre-fill from project data
    'stories',         // QW-2: pre-fill from project data
  ];

  for (const field of optionalFields) {
    if (payload[field] !== undefined && payload[field] !== null) {
      claims[field] = payload[field];
    }
  }

  let token: string;
  try {
    // Sign with HS256. noTimestamp=true because we set iat manually above.
    token = jwt.sign(claims, secret, {
      algorithm: 'HS256',
      noTimestamp: true,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `JWT signing failed: ${msg}` };
  }

  return { ok: true, token, jti, exp };
}

// ---------------------------------------------------------------------------
// buildHandoffUrl
//
// Builds the full partner launch URL with the signed JWT as the token param.
//
// Returns the URL string on success, or throws if env vars are missing or
// signing fails (so callers can surface the error to the user).
// ---------------------------------------------------------------------------
export function buildHandoffUrl(payload: HandoffTokenPayload): string {
  const baseUrl = process.env.PARTNER_BASE_URL;
  if (!baseUrl) {
    throw new Error('PARTNER_BASE_URL is not set');
  }

  const result = mintHandoffToken(payload);
  if (!result.ok) {
    const errResult = result as { ok: false; error: string };
    throw new Error(`Handoff token mint failed: ${errResult.error}`);
  }

  const base = baseUrl.replace(/\/$/, '');
  return `${base}/api/handoff/${encodeURIComponent(result.token)}`;
}

// ---------------------------------------------------------------------------
// buildStandaloneDeepLink
//
// v47.438: Builds a sitesurvey://new-survey deep link for standalone surveys.
// Used by POST /api/survey/standalone-handoff.
// ---------------------------------------------------------------------------
export function buildStandaloneDeepLink(token: string): string {
  return `sitesurvey://new-survey?token=${encodeURIComponent(token)}`;
}

// ---------------------------------------------------------------------------
// verifyHandoffToken
//
// Verifies and decodes a handoff JWT. Used in submit route, lookup-data,
// and admin tooling. Returns the decoded payload or null if invalid/expired.
// ---------------------------------------------------------------------------
export function verifyHandoffToken(
  token: string,
): HandoffTokenPayload & { jti: string; iat: number; exp: number } | null {
  const secret = process.env.SOLARPRO_HANDOFF_SECRET;
  if (!secret) return null;

  try {
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
    if (typeof decoded !== 'object' || decoded === null) return null;
    return decoded as HandoffTokenPayload & { jti: string; iat: number; exp: number };
  } catch {
    return null;
  }
}