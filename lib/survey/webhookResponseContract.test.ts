// ============================================================================
// v47.435 — Webhook response contract drift-guard (updated from v47.434b)
//
// Locks the HTTP response contract returned by POST /api/webhooks/survey-complete
// for each of the terminal outcomes. If any caller (partner's queue worker,
// admin UI, observability tooling) is built against these response shapes,
// a PR that changes them will fail this test loudly at CI time.
//
// v47.435 changes vs v47.434b:
//   - Success path reason is now 'INGEST_OK' (pipeline ran) OR
//     'INGEST_FAILED_BUT_LOGGED' (pipeline failed but delivery accepted).
//   - 'INGEST_NOT_IMPLEMENTED_BUT_LOGGED' stub is gone.
//   - runIngestPipeline() is called on the successful verification path.
//   - Response body gains projectId + created + transformSummary on INGEST_OK.
//
// We do NOT mount the real route handler here (that requires a live DB + env
// vars and crosses into integration-test territory). Instead we read the route
// source text and assert the response-shape invariants are preserved verbatim.
// Any structural change to the route's response body must update these
// assertions, which is the intended friction.
//
// File-location note: this test lives in lib/survey/ because the vitest
// config's `include` glob does not cover app/api/**. The source-under-test
// reference is app/api/webhooks/survey-complete/route.ts, resolved by path.
//
// See docs/INTEGRATION_STAGING_REPORT_v1.md §3.4 for the contract text.
// ============================================================================

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROUTE_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'app',
  'api',
  'webhooks',
  'survey-complete',
  'route.ts',
);
const ROUTE_SRC = fs.readFileSync(ROUTE_PATH, 'utf8');

describe('POST /api/webhooks/survey-complete — v47.435 response contract', () => {
  // ─── v47.435 core contract: 202 on successful validation ─────────────────
  //
  // Partner's queue-based worker treats 2xx as "delivered, stop retrying".
  // Both the INGEST_OK and INGEST_FAILED_BUT_LOGGED paths return 202 Accepted.

  it('returns 202 (not 501) on successful HMAC + envelope validation', () => {
    expect(ROUTE_SRC).toMatch(/\{\s*status:\s*202\s*\}/);
    // 501 is no longer used anywhere on the happy path.
    const happyPath501Matches = ROUTE_SRC.match(/status:\s*501/g) ?? [];
    expect(happyPath501Matches.length).toBe(0);
  });

  it("carries reason='INGEST_OK' on the successful pipeline path", () => {
    expect(ROUTE_SRC).toContain("'INGEST_OK'");
  });

  it("carries reason='INGEST_FAILED_BUT_LOGGED' on the pipeline-failed-but-accepted path", () => {
    expect(ROUTE_SRC).toContain("'INGEST_FAILED_BUT_LOGGED'");
  });

  it('stub INGEST_NOT_IMPLEMENTED_BUT_LOGGED is no longer present (replaced by real pipeline)', () => {
    // If this fails, someone reverted the route to the v47.434 stub.
    expect(ROUTE_SRC).not.toContain('INGEST_NOT_IMPLEMENTED_BUT_LOGGED');
  });

  it('marks the response as accepted: true AND success: true on the 202 path', () => {
    // Both fields must be present so clients can branch on either.
    expect(ROUTE_SRC).toMatch(/accepted:\s*true/);
    // The 202-branch blocks should contain success: true assignments.
    const successHits = ROUTE_SRC.match(/success:\s*true/g) ?? [];
    expect(successHits.length).toBeGreaterThanOrEqual(2); // duplicate branch + pipeline branch(es)
  });

  it('includes deliveryId + event.event_id + event.survey_id + event.completed_at', () => {
    // Partner (and admin UI) needs these for correlation with their delivery log.
    expect(ROUTE_SRC).toMatch(/deliveryId,/);
    expect(ROUTE_SRC).toMatch(/event_id:\s*envelope\.event_id/);
    expect(ROUTE_SRC).toMatch(/survey_id:\s*envelope\.survey_id/);
    expect(ROUTE_SRC).toMatch(/completed_at:\s*envelope\.completed_at/);
  });

  it('includes schemaVersion + toleranceSeconds for client self-configuration', () => {
    expect(ROUTE_SRC).toMatch(/schemaVersion:\s*CURRENT_SCHEMA_VERSION/);
    expect(ROUTE_SRC).toMatch(/toleranceSeconds:\s*TIMESTAMP_TOLERANCE_SECONDS/);
  });

  it('INGEST_OK path exposes projectId and created flag', () => {
    const anchor = ROUTE_SRC.indexOf("'INGEST_OK'");
    expect(anchor).toBeGreaterThan(-1);
    const window = ROUTE_SRC.slice(anchor, anchor + 1500);
    expect(window).toContain('projectId');
    expect(window).toContain('created');
  });

  it('INGEST_FAILED_BUT_LOGGED path exposes ingestError and ingestErrorCode', () => {
    const anchor = ROUTE_SRC.indexOf("'INGEST_FAILED_BUT_LOGGED'");
    expect(anchor).toBeGreaterThan(-1);
    const window = ROUTE_SRC.slice(anchor, anchor + 1500);
    expect(window).toContain('ingestError');
    expect(window).toContain('ingestErrorCode');
  });


  // Partner-contract fields: ok + code + top-level event_id
  // These are the fields the partner's queue worker reads directly.
  // Any rename of these fields is a breaking contract change.

  it("carries ok: true on all 202 and 200 responses (partner contract field)", () => {
    // INGEST_OK + INGEST_FAILED_BUT_LOGGED (202) + duplicate (200) must all carry ok: true.
    const okMatches = ROUTE_SRC.match(/ok:\s*true/g) ?? [];
    // Expect at least 3: two 202 paths + one 200 duplicate path
    expect(okMatches.length).toBeGreaterThanOrEqual(3);
  });

  it("carries code: 'ACCEPTED_PRE_INGEST' on all 202 responses (partner contract field)", () => {
    const codeMatches = ROUTE_SRC.match(/'ACCEPTED_PRE_INGEST'/g) ?? [];
    // Must appear in at least 2 places: INGEST_OK block + INGEST_FAILED_BUT_LOGGED block
    expect(codeMatches.length).toBeGreaterThanOrEqual(2);
  });

  it('echoes top-level event_id on 202 responses (partner reads response.event_id, not response.event.event_id)', () => {
    // Partner reads flat response.event_id, not nested response.event.event_id.
    const topLevelHits = ROUTE_SRC.match(/event_id:\s*envelope\.event_id/g) ?? [];
    // Should appear at least twice (INGEST_OK + INGEST_FAILED_BUT_LOGGED)
    expect(topLevelHits.length).toBeGreaterThanOrEqual(2);
  });

  it('echoes top-level event_id on 200 duplicate response (partner contract field)', () => {
    // Partner reads response.event_id on duplicate 200 too.
    expect(ROUTE_SRC).toMatch(/event_id:\s*effectiveEventId/);
  });

  it("carries ok: true on 200 duplicate response (partner contract field)", () => {
    const dupIdx = ROUTE_SRC.indexOf('duplicate: true');
    expect(dupIdx).toBeGreaterThan(-1);
    // Look for ok: true in the surrounding 400-char window around the duplicate block
    const windowStr = ROUTE_SRC.slice(Math.max(0, dupIdx - 400), dupIdx + 400);
    expect(windowStr).toMatch(/ok:\s*true/);
  });

  // ─── Duplicate delivery: still 200, not 202 ───────────────────────────────

  it('returns 200 (not 202) on duplicate event_id', () => {
    expect(ROUTE_SRC).toMatch(/duplicate:\s*true/);
    const duplicateIdx = ROUTE_SRC.indexOf('duplicate: true');
    expect(duplicateIdx).toBeGreaterThan(-1);
    const duplicateBlock = ROUTE_SRC.slice(duplicateIdx, duplicateIdx + 500);
    expect(duplicateBlock).toMatch(/status:\s*200/);
  });

  // ─── Failure paths: unchanged ─────────────────────────────────────────────

  it('still returns 401 on HMAC verification failure', () => {
    expect(ROUTE_SRC).toMatch(/Signature verification failed/);
    const idx = ROUTE_SRC.indexOf('Signature verification failed');
    const failureBlock = ROUTE_SRC.slice(idx, idx + 500);
    expect(failureBlock).toMatch(/status:\s*401/);
  });

  it('still returns 400 on envelope validation failure (post-HMAC)', () => {
    const idx = ROUTE_SRC.indexOf("error: envelopeError");
    expect(idx).toBeGreaterThan(-1);
    const failureBlock = ROUTE_SRC.slice(idx, idx + 300);
    expect(failureBlock).toMatch(/status:\s*400/);
  });

  it('still returns 500 when SURVEY_WEBHOOK_SECRET is not configured', () => {
    expect(ROUTE_SRC).toMatch(/Webhook receiver not configured/);
    const idx = ROUTE_SRC.indexOf('Webhook receiver not configured');
    const failureBlock = ROUTE_SRC.slice(idx, idx + 200);
    expect(failureBlock).toMatch(/status:\s*500/);
  });

  // ─── Observability invariants (unchanged) ─────────────────────────────────

  it('logs every delivery to webhook_deliveries (valid AND invalid)', () => {
    expect(ROUTE_SRC).toMatch(/INSERT INTO webhook_deliveries/);
  });

  it("records delivery status as verified or failed (no new status values pre-pipeline)", () => {
    // The DB INSERT uses verified|failed BEFORE the pipeline runs.
    // The pipeline itself updates the status to 'ingested' or 'failed' post-INSERT.
    expect(ROUTE_SRC).toMatch(
      /deliveryStatus:\s*'verified'\s*\|\s*'failed'\s*=\s*sigResult\.valid\s*&&\s*envelope\s*\?\s*'verified'\s*:\s*'failed'/,
    );
  });

  it('pipeline is wired: runIngestPipeline is called in the route', () => {
    expect(ROUTE_SRC).toContain('runIngestPipeline(');
  });

  // ─── Version references for ops context ──────────────────────────────────

  it('route source references v47.435 so on-call ops see the current version', () => {
    expect(ROUTE_SRC).toMatch(/v47\.435/);
  });

  // ─── Idempotency contract preserved ──────────────────────────────────────

  it('idempotency lookup uses source=survey + event_id', () => {
    // This is the key invariant that lets partner's 5-retry schedule collapse
    // to a single logged delivery even if the first 202 is somehow not seen.
    expect(ROUTE_SRC).toMatch(/source\s*=\s*'survey'\s+AND\s+event_id\s*=\s*\$\{/);
  });
});