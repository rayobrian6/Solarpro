// ============================================================================
// v47.435 — producerVersion echo contract drift-guard (updated from v47.434c)
//
// Source-text drift-guard reading app/api/webhooks/survey-complete/route.ts as
// a string and asserting producerVersion: BUILD_VERSION is added to every
// response body emitted by the route.
//
// v47.435 changes vs v47.434c:
//   - Success path now uses reason='INGEST_OK' (was 'INGEST_NOT_IMPLEMENTED_BUT_LOGGED')
//   - New failure path uses reason='INGEST_FAILED_BUT_LOGGED'
//   - Both new paths must also carry producerVersion: BUILD_VERSION
//
// This lives in lib/survey/ (not app/api/*) because vitest.config.ts include
// glob does not cover app/**.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROUTE_PATH = path.resolve(
  __dirname,
  '../..',
  'app/api/webhooks/survey-complete/route.ts',
);
const ROUTE_SRC = readFileSync(ROUTE_PATH, 'utf-8');

describe('v47.435 — producerVersion echo contract', () => {
  it('route imports BUILD_VERSION from lib/version', () => {
    // Must be actually imported (not just referenced in a comment).
    expect(ROUTE_SRC).toMatch(/import\s+\{[^}]*BUILD_VERSION[^}]*\}\s+from\s+['"]@\/lib\/version['"]/);
  });

  it('route imports runIngestPipeline from lib/survey/ingest/ingestPipeline', () => {
    expect(ROUTE_SRC).toMatch(/import\s+\{[^}]*runIngestPipeline[^}]*\}\s+from\s+['"]@\/lib\/survey\/ingest\/ingestPipeline['"]/);
  });

  it('every NextResponse.json response body contains producerVersion: BUILD_VERSION', () => {
    // Count number of NextResponse.json(...) call sites. Each must be
    // followed within the same call by a producerVersion property binding.
    // We use a conservative rule: the route file must contain at least as
    // many occurrences of `producerVersion: BUILD_VERSION` as it contains
    // `NextResponse.json(` (ignoring any NextResponse.json call that is
    // JUST a 304/redirect — survey-complete route has none).
    const jsonCalls = (ROUTE_SRC.match(/NextResponse\.json\s*\(/g) ?? []).length;
    const versionBindings = (ROUTE_SRC.match(/producerVersion:\s*BUILD_VERSION/g) ?? []).length;
    expect(jsonCalls).toBeGreaterThan(0);
    expect(versionBindings).toBeGreaterThanOrEqual(jsonCalls);
  });

  it('success-path 202 (INGEST_OK) response contains producerVersion: BUILD_VERSION', () => {
    // v47.435: success path reason is now 'INGEST_OK' (pipeline ran successfully)
    const anchor = ROUTE_SRC.indexOf("'INGEST_OK'");
    expect(anchor).toBeGreaterThan(-1);
    const window = ROUTE_SRC.slice(anchor, anchor + 1500);
    expect(window).toContain('producerVersion: BUILD_VERSION');
  });

  it('failure-path 202 (INGEST_FAILED_BUT_LOGGED) contains producerVersion: BUILD_VERSION', () => {
    // v47.435: new path — pipeline failed but delivery was accepted+logged
    const anchor = ROUTE_SRC.indexOf("'INGEST_FAILED_BUT_LOGGED'");
    expect(anchor).toBeGreaterThan(-1);
    const window = ROUTE_SRC.slice(anchor, anchor + 1500);
    expect(window).toContain('producerVersion: BUILD_VERSION');
  });

  it('INGEST_NOT_IMPLEMENTED_BUT_LOGGED stub is no longer present (v47.435 replaced it)', () => {
    // Drift-guard: the v47.434 stub reason must be gone now that the real
    // pipeline is wired in. If this fails, someone accidentally reverted the
    // route to the stub version.
    expect(ROUTE_SRC).not.toContain('INGEST_NOT_IMPLEMENTED_BUT_LOGGED');
  });

  it('route calls runIngestPipeline', () => {
    expect(ROUTE_SRC).toContain('runIngestPipeline(');
  });

  it('401 invalid-signature response contains producerVersion: BUILD_VERSION', () => {
    const anchor = ROUTE_SRC.indexOf("'Signature verification failed'");
    expect(anchor).toBeGreaterThan(-1);
    const window = ROUTE_SRC.slice(anchor, anchor + 600);
    expect(window).toContain('producerVersion: BUILD_VERSION');
  });

  it('400 envelope-invalid response contains producerVersion: BUILD_VERSION', () => {
    const anchor = ROUTE_SRC.indexOf("'Envelope invalid'");
    expect(anchor).toBeGreaterThan(-1);
    const window = ROUTE_SRC.slice(anchor, anchor + 600);
    expect(window).toContain('producerVersion: BUILD_VERSION');
  });

  it('500 misconfigured response contains producerVersion: BUILD_VERSION', () => {
    const anchor = ROUTE_SRC.indexOf("'Webhook receiver not configured'");
    expect(anchor).toBeGreaterThan(-1);
    const window = ROUTE_SRC.slice(anchor, anchor + 600);
    expect(window).toContain('producerVersion: BUILD_VERSION');
  });

  it('200 duplicate-delivery response contains producerVersion: BUILD_VERSION', () => {
    const anchor = ROUTE_SRC.indexOf('duplicate: true');
    expect(anchor).toBeGreaterThan(-1);
    const window = ROUTE_SRC.slice(anchor, anchor + 800);
    expect(window).toContain('producerVersion: BUILD_VERSION');
  });

  it('400 body-read failure response contains producerVersion: BUILD_VERSION', () => {
    const anchor = ROUTE_SRC.indexOf("'Could not read request body'");
    expect(anchor).toBeGreaterThan(-1);
    const window = ROUTE_SRC.slice(anchor, anchor + 600);
    expect(window).toContain('producerVersion: BUILD_VERSION');
  });
});