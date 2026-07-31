// ═══════════════════════════════════════════════════════════════════════════
// compliance/collectors/common.mjs
//
// Shared helpers for the 6 evidence collectors (github, vercel, render,
// neon, google-workspace, db-internal). Pure Node 20 ESM, no extra deps.
//
// Exports:
//   nowIso()                            → ISO 8601 timestamp
//   computeSha256(content)             → content hash for addressing
//   withRetry(fn, opts)                → exponential backoff around an async fn
//   getDryRun()                         → boolean: DRY_RUN=1?
//   repoRoot()                          → absolute path to repo root
//   evidencePath(integration, date, fn) → absolute path for an evidence file
//   writeEvidence(integration, date, fn, data, opts)
//                                        → writes JSON/NDJSON, returns the
//                                          repo-relative path it wrote
//   apiFetch(url, init)                 → fetch wrapper with timeout + retry
//
// The collectors are runnable locally and on GitHub Actions. The same
// writeEvidence() helper works in both — it always writes to the local
// working tree, and the GitHub Actions workflow commits the result.
//
// The R2 storage layer that the design doc assumed has been replaced with
// a git-based evidence store per James's 2026-07-30 "no money yet" call.
// See HANDOFF_COMPLIANCE_COLLECTORS.md §"Storage adaptation" for the
// rationale and the manifest update that goes with it.
// ═══════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

// ─────────────────────────────────────────────────────────────────────────
// Paths
// ─────────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Absolute path to the repo root, derived from this file's location
 * (compliance/collectors/common.mjs → two levels up).
 *
 * Falls back to process.cwd() if the layout is unexpected, so a local
 * `node compliance/collectors/github.mjs` from the repo root still works.
 */
export function repoRoot() {
  const candidate = path.resolve(__dirname, '..', '..');
  // Sanity check: the candidate must contain package.json. If not, trust
  // process.cwd() instead.
  if (fs.existsSync(path.join(candidate, 'package.json'))) {
    return candidate;
  }
  return process.cwd();
}

/**
 * Build the absolute path for an evidence file.
 *
 *   compliance/evidence/<integration>/<YYYY-MM-DD>/<filename>
 *
 * `date` defaults to today (UTC). Pass an explicit Date or ISO string for
 * testing. The integration segment is the same key the manifest uses
 * (e.g. "github", "vercel", "render", "neon", "google-workspace", "db").
 */
export function evidencePath(integration, date, filename) {
  if (!integration || typeof integration !== 'string') {
    throw new TypeError('integration must be a non-empty string');
  }
  if (!filename || typeof filename !== 'string') {
    throw new TypeError('filename must be a non-empty string');
  }
  const day = formatDate(date ?? new Date());
  return path.join(
    repoRoot(),
    'compliance',
    'evidence',
    integration,
    day,
    filename,
  );
}

/**
 * YYYY-MM-DD in UTC. Accepts a Date or a parseable string.
 */
export function formatDate(input) {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) {
    throw new TypeError(`formatDate: cannot parse "${input}"`);
  }
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Time + hashing
// ─────────────────────────────────────────────────────────────────────────

/** ISO 8601 timestamp in UTC with millisecond precision. */
export function nowIso() {
  return new Date().toISOString();
}

/**
 * SHA-256 hex digest of a string or Buffer. Used for content addressing
 * the evidence files. Stable across runs.
 */
export function computeSha256(content) {
  const buf = typeof content === 'string'
    ? Buffer.from(content, 'utf8')
    : Buffer.isBuffer(content) ? content : Buffer.from(String(content));
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// ─────────────────────────────────────────────────────────────────────────
// DRY_RUN + retry
// ─────────────────────────────────────────────────────────────────────────

/** True when DRY_RUN=1 (or DRY_RUN=true). Skips real API calls. */
export function getDryRun() {
  const v = process.env.DRY_RUN;
  if (v === undefined || v === null || v === '') return false;
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * Exponential backoff around an async fn.
 *
 *   const data = await withRetry(() => fetchJson(url), {
 *     retries: 3,
 *     baseDelayMs: 500,
 *     onRetry: (err, attempt) => console.warn(`retry ${attempt}: ${err}`),
 *   });
 *
 * Default: 3 retries, 500ms base delay, doubles each time, jittered.
 * Caps total wait at ~6s (500+1000+2000 = 3.5s base, +50% jitter).
 * Throws the last error if all attempts fail.
 */
export async function withRetry(fn, opts = {}) {
  const {
    retries = 3,
    baseDelayMs = 500,
    factor = 2,
    maxDelayMs = 5000,
    onRetry = null,
    shouldRetry = null, // optional (err) => boolean; default: always retry
  } = opts;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;
      if (shouldRetry && !shouldRetry(err)) break;
      const base = Math.min(maxDelayMs, baseDelayMs * Math.pow(factor, attempt));
      // 50–100% jitter so concurrent collectors don't all retry at once.
      const delay = Math.floor(base * (0.5 + Math.random() * 0.5));
      if (onRetry) {
        try { onRetry(err, attempt + 1, delay); } catch { /* swallow */ }
      } else {
        console.warn(
          `[withRetry] attempt ${attempt + 1} failed: ${err?.message ?? err}; ` +
          `retrying in ${delay}ms`,
        );
      }
      await sleep(delay);
    }
  }
  throw lastErr;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────────────────
// writeEvidence
// ─────────────────────────────────────────────────────────────────────────

/**
 * Write an evidence file (JSON or NDJSON) to
 * `compliance/evidence/<integration>/<YYYY-MM-DD>/<filename>`.
 *
 * - `data` is either:
 *     - a single object → written as a pretty-printed JSON file, or
 *     - an array of objects → written as NDJSON (one object per line).
 *   You can force NDJSON by passing `{ ndjson: true, rows: [...] }`.
 * - `dryRun` (default: process.env.DRY_RUN) skips the actual write and
 *   returns the path the file *would* have been written to.
 * - Idempotent: re-running for the same date+filename overwrites the file
 *   with the new content. The manifest hashes are recomputed downstream
 *   by the CI lint if the diff matters.
 *
 * Returns the **repo-relative, forward-slash** path that was written
 * (e.g. `compliance/evidence/github/2026-07-30/branch-protection.json`).
 * This is the path that lands in the manifest's `path_pattern` after
 * the {date} token is substituted, and the path the GitHub Actions
 * workflow uses to stage the commit.
 */
export function writeEvidence(integration, date, filename, data, opts = {}) {
  const dryRun = opts.dryRun ?? getDryRun();
  const abs = evidencePath(integration, date, filename);

  // Determine serialization
  let body;
  let isNdjson = opts.ndjson === true;
  if (!isNdjson && Array.isArray(data) && opts.ndjson !== false) {
    // Heuristic: an array of objects is almost always NDJSON in this
    // pipeline (the db-internal audit-log collector is the prime user).
    // Pass `{ ndjson: false }` to force a single JSON array.
    isNdjson = true;
  }
  if (isNdjson) {
    const rows = Array.isArray(data) ? data : (data?.rows ?? []);
    body = rows.map((row) => JSON.stringify(row)).join('\n');
    if (body.length > 0) body += '\n';
  } else if (data !== undefined && data !== null) {
    body = JSON.stringify(data, null, 2) + '\n';
  } else {
    body = '';
  }

  if (dryRun) {
    // No filesystem write. Log and return the path the file would have
    // gone to. Useful for local CI runs and for the unit tests.
    console.warn(
      `[writeEvidence] DRY_RUN: would write ${abs} (${body.length} bytes)`,
    );
    return toRepoRelative(abs);
  }

  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, 'utf8');
  return toRepoRelative(abs);
}

/**
 * Convert an absolute path under the repo to a forward-slash, repo-
 * relative path. Falls back to the absolute path if it's outside the repo.
 */
export function toRepoRelative(abs) {
  const root = repoRoot();
  const rel = path.relative(root, abs);
  if (rel.startsWith('..')) return abs;
  return rel.split(path.sep).join('/');
}

// ─────────────────────────────────────────────────────────────────────────
// apiFetch — fetch wrapper with timeout + structured error
// ─────────────────────────────────────────────────────────────────────────

/**
 * Thin fetch wrapper:
 * - applies a default 15s timeout (configurable)
 * - parses JSON on 2xx
 * - throws a structured Error on non-2xx with status + body excerpt
 *
 * Intentionally NOT included in withRetry's default path: the caller
 * decides what status codes are retryable (4xx usually aren't; 5xx
 * usually are; 429 is "respect Retry-After").
 */
export async function apiFetch(url, init = {}) {
  const { timeoutMs = 15_000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...rest, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) {
      const excerpt = text.length > 500 ? text.slice(0, 500) + '…' : text;
      const err = new Error(
        `HTTP ${res.status} ${res.statusText} for ${url}\n${excerpt}`,
      );
      err.status = res.status;
      err.body = text;
      throw err;
    }
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      // Non-JSON 2xx — return the text.
      return text;
    }
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Module contract — guard against accidental name drift
// ─────────────────────────────────────────────────────────────────────────

// The tests in compliance/__tests__/validate-collector-output.test.mjs
// import these symbols. If a collector imports a name that isn't here,
// that's a bug — but we can't catch it statically in JS, so this list
// is a documentation contract, not a runtime guard.
export const SHARED_HELPERS = Object.freeze([
  'nowIso',
  'computeSha256',
  'withRetry',
  'getDryRun',
  'repoRoot',
  'evidencePath',
  'formatDate',
  'writeEvidence',
  'toRepoRelative',
  'apiFetch',
  'sleep',
]);
