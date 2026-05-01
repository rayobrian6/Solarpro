// ============================================================================
// v47.434c — Release history builder
//
// Pure parser over BUILD_FEATURES[] + BUILD_VERSION + BUILD_DATE from
// lib/version.ts. Extracts the version tag and title from each feature
// entry and returns a structured array suitable for JSON serialization by
// GET /api/system/release.
//
// BUILD_FEATURES entries use the convention:
//   "Stage 9.1b (v47.434b) \u2014 Response-Code Patch: <description>"
//
// We parse the leading "(vX.Y...)" version tag and everything after the
// em-dash "\u2014" as the human title. If either is absent, we fall back to
// sensible defaults so malformed entries never crash the endpoint.
// ============================================================================
import { BUILD_VERSION, BUILD_DATE, BUILD_FEATURES } from '@/lib/version';

export interface ReleaseEntry {
  /** Release version tag, e.g. "v47.434c". */
  version: string;
  /** Stage label, e.g. "Stage 9.1c". Empty string if not parseable. */
  stage: string;
  /** Human title, e.g. "Response-Code Patch". */
  title: string;
  /** Short summary (everything after the first colon in the title section). */
  summary: string;
  /** Raw feature-string as stored in BUILD_FEATURES (for debugging). */
  raw: string;
}

export interface ReleaseHistoryPayload {
  service: 'solarpro';
  producerVersion: string;
  buildDate: string;
  latest: ReleaseEntry | null;
  releases: ReleaseEntry[];
  totalCount: number;
  generatedAt: string;
}

// Matches "(v47.434c)" or "(v47.434)" or "(v47.431, READ-ONLY)" — the
// version tag anywhere inside a paren group, tolerant of trailing
// punctuation/qualifiers after a comma.
const VERSION_TAG_RE = /\(\s*(v\d+(?:\.\d+)+[a-z]?)\b[^)]*\)/i;
// Matches "Stage 9.1c" or "Stage 9.1" — the stage label at the start.
const STAGE_RE = /^\s*Stage\s+([0-9a-z.]+)/i;

/**
 * Parse a single BUILD_FEATURES entry into a structured ReleaseEntry.
 * Never throws; falls back to {} with the raw string preserved.
 */
export function parseFeatureEntry(raw: string): ReleaseEntry {
  const versionMatch = raw.match(VERSION_TAG_RE);
  const stageMatch = raw.match(STAGE_RE);

  const version = versionMatch?.[1] ?? '';
  const stage = stageMatch ? `Stage ${stageMatch[1]}` : '';

  // Split on em-dash ("\u2014"). Left side is stage+version header, right
  // side is title + optional ": summary".
  const dashIdx = raw.indexOf('\u2014');
  let afterDash = dashIdx >= 0 ? raw.slice(dashIdx + 1).trim() : raw;

  // Split title from summary on the first colon.
  const colonIdx = afterDash.indexOf(':');
  let title = afterDash;
  let summary = '';
  if (colonIdx >= 0) {
    title = afterDash.slice(0, colonIdx).trim();
    summary = afterDash.slice(colonIdx + 1).trim();
  }

  return {
    version,
    stage,
    title,
    summary,
    raw,
  };
}

/**
 * Build the full release-history payload. Deterministic given BUILD_VERSION +
 * BUILD_FEATURES. Accepts an injectable ISO timestamp for testability and a
 * limit for caller-controlled truncation.
 *
 * @param limit - Max number of entries to return. Default = all entries.
 *                Clamped to [1, BUILD_FEATURES.length].
 * @param nowIso - ISO-8601 generatedAt; defaults to new Date().toISOString().
 */
export function buildReleaseHistory(
  limit: number = BUILD_FEATURES.length,
  nowIso: string = new Date().toISOString(),
): ReleaseHistoryPayload {
  const clamped = Math.max(1, Math.min(limit, BUILD_FEATURES.length));
  const releases = BUILD_FEATURES.slice(0, clamped).map(parseFeatureEntry);

  return {
    service: 'solarpro',
    producerVersion: BUILD_VERSION,
    buildDate: BUILD_DATE,
    latest: releases[0] ?? null,
    releases,
    totalCount: BUILD_FEATURES.length,
    generatedAt: nowIso,
  };
}