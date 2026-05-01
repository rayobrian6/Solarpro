// ============================================================================
// v47.436 - Survey Ingest: Payload Fetcher
//
// fetchFullPayload() fetches the full survey payload from the partner API
// using a static Bearer token (PARTNER_API_BEARER_TOKEN env var).
//
// Endpoint: GET ${PARTNER_BASE_URL}/api/surveys/{survey_id}
// Auth:     Authorization: Bearer ${PARTNER_API_BEARER_TOKEN}
//
// Returns the parsed JSON body as SurveyRawPayload on success.
// Returns null on any error (network, auth, 404, etc.) - the pipeline
// treats a null rawPayload as a degraded-mode ingest (transform runs with
// stub field values only).
//
// Photo URLs in the payload are /uploads/... paths relative to PARTNER_BASE_URL.
// Use buildPhotoUrl() to construct the full URL before fetching.
// Photo fetches also use the same Bearer token.
//
// Environment variables required:
//   PARTNER_BASE_URL            - e.g. https://survey.partnerapp.com
//   PARTNER_API_BEARER_TOKEN    - static token issued by partner
// ============================================================================

import type { SurveyRawPayload } from './types';

// ---------------------------------------------------------------------------
// fetchFullPayload
//
// Fetches the full survey JSON from:
//   GET {PARTNER_BASE_URL}/api/surveys/{surveyId}
//
// Returns parsed JSON as SurveyRawPayload, or null on any failure.
// Never throws.
// ---------------------------------------------------------------------------
export async function fetchFullPayload(
  surveyId: string,
  traceId: string,
): Promise<SurveyRawPayload | null> {
  const baseUrl = process.env.PARTNER_BASE_URL;
  const bearerToken = process.env.PARTNER_API_BEARER_TOKEN;

  if (!baseUrl) {
    console.warn(
      `[payloadFetcher] traceId=${traceId} PARTNER_BASE_URL not set - skipping fetch`,
    );
    return null;
  }

  if (!bearerToken) {
    console.warn(
      `[payloadFetcher] traceId=${traceId} PARTNER_API_BEARER_TOKEN not set - skipping fetch`,
    );
    return null;
  }

  const url = `${baseUrl}/api/surveys/${encodeURIComponent(surveyId)}`;

  console.log(
    `[payloadFetcher] traceId=${traceId} fetching surveyId=${surveyId} url=${url}`,
  );

  // Enforce an 8-second timeout on the partner API fetch.
  // Without this, a slow/unresponsive partner endpoint eats into Vercel's
  // maxDuration budget and can cause the entire ingest to timeout, leaving
  // webhook_deliveries in 'verified' status permanently.
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), 8_000);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    console.error(
      `[payloadFetcher] traceId=${traceId} ${isTimeout ? 'TIMEOUT (8s)' : 'network error'} fetching surveyId=${surveyId}: ${msg}`,
    );
    return null;
  } finally {
    clearTimeout(timeoutHandle);
  }

  if (!res.ok) {
    console.error(
      `[payloadFetcher] traceId=${traceId} HTTP ${res.status} fetching surveyId=${surveyId}`,
    );
    return null;
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[payloadFetcher] traceId=${traceId} JSON parse error for surveyId=${surveyId}: ${msg}`,
    );
    return null;
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    console.error(
      `[payloadFetcher] traceId=${traceId} unexpected payload shape for surveyId=${surveyId}`,
    );
    return null;
  }

  console.log(
    `[payloadFetcher] traceId=${traceId} fetch OK surveyId=${surveyId} keys=${Object.keys(body as Record<string, unknown>).join(',')}`,
  );

  return body as SurveyRawPayload;
}

// ---------------------------------------------------------------------------
// buildPhotoUrl
//
// Partner photo URLs are /uploads/... paths relative to PARTNER_BASE_URL.
// This function constructs the full URL.
//
// Example:
//   buildPhotoUrl('/uploads/abc123/photo1.jpg')
//   => 'https://survey.partnerapp.com/uploads/abc123/photo1.jpg'
// ---------------------------------------------------------------------------
export function buildPhotoUrl(uploadPath: string): string {
  const baseUrl = (process.env.PARTNER_BASE_URL ?? '').replace(/\/$/, '');
  const path = uploadPath.startsWith('/') ? uploadPath : `/${uploadPath}`;
  return `${baseUrl}${path}`;
}

// ---------------------------------------------------------------------------
// getPhotoFetchHeaders
//
// Returns the Authorization header object needed to fetch /uploads/... URLs.
// Use this when fetching photo assets with the same Bearer token.
// ---------------------------------------------------------------------------
export function getPhotoFetchHeaders(): Record<string, string> {
  const bearerToken = process.env.PARTNER_API_BEARER_TOKEN ?? '';
  return {
    Authorization: `Bearer ${bearerToken}`,
  };
}