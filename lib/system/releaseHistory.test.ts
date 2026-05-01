// ============================================================================
// v47.434c — Release history builder + parser tests
// ============================================================================
import { describe, it, expect } from 'vitest';
import {
  parseFeatureEntry,
  buildReleaseHistory,
} from './releaseHistory';
import { BUILD_VERSION, BUILD_DATE, BUILD_FEATURES } from '@/lib/version';

describe('v47.434c — parseFeatureEntry', () => {
  it('extracts version tag, stage, title, summary from a standard entry', () => {
    const raw =
      'Stage 9.1b (v47.434b) \u2014 Response-Code Patch: terminal response changes from 501 to 202';
    const parsed = parseFeatureEntry(raw);
    expect(parsed.version).toBe('v47.434b');
    expect(parsed.stage).toBe('Stage 9.1b');
    expect(parsed.title).toBe('Response-Code Patch');
    expect(parsed.summary).toContain('terminal response changes');
    expect(parsed.raw).toBe(raw);
  });

  it('handles entries with multiple dashes by taking everything after the FIRST em-dash', () => {
    const raw =
      'Stage 9.1a (v47.434a) \u2014 Partner Wire-Format Compatibility Patch: accept ISO-8601 \u2014 dual-mode';
    const parsed = parseFeatureEntry(raw);
    expect(parsed.version).toBe('v47.434a');
    expect(parsed.title).toBe('Partner Wire-Format Compatibility Patch');
    expect(parsed.summary).toContain('ISO-8601');
  });

  it('returns empty version/stage when tags are absent, preserves raw', () => {
    const raw = 'Some free-form note without any tags';
    const parsed = parseFeatureEntry(raw);
    expect(parsed.version).toBe('');
    expect(parsed.stage).toBe('');
    expect(parsed.raw).toBe(raw);
  });

  it('handles entry with version tag but no colon-separated summary', () => {
    const raw = 'Stage 8.1 (v47.432) \u2014 BOM dead-code deletion';
    const parsed = parseFeatureEntry(raw);
    expect(parsed.version).toBe('v47.432');
    expect(parsed.stage).toBe('Stage 8.1');
    expect(parsed.title).toBe('BOM dead-code deletion');
    expect(parsed.summary).toBe('');
  });

  it('parses EVERY entry in the real BUILD_FEATURES array without throwing', () => {
    for (const raw of BUILD_FEATURES) {
      expect(() => parseFeatureEntry(raw)).not.toThrow();
      const parsed = parseFeatureEntry(raw);
      expect(parsed.raw).toBe(raw);
    }
  });

  it('recent BUILD_FEATURES entries (Stage-formatted) have parseable version tags', () => {
    // Historical entries from before v47.432 use a title-only format without
    // a (vX.Y) version tag. That's intentional — the Stage-based parseable
    // format was introduced with v47.432 and is enforced by the bump
    // scripts going forward. Here we only assert that ENTRIES WHICH
    // CONTAIN "(vX.Y)" in their raw text parse cleanly.
    for (const raw of BUILD_FEATURES) {
      if (!/\(\s*v\d+\.\d+/.test(raw)) continue; // legacy title-only, skip
      const parsed = parseFeatureEntry(raw);
      expect(parsed.version).toMatch(/^v\d+\.\d+[a-z]?$/);
    }
  });

  it('at least the 5 most recent BUILD_FEATURES entries are Stage-formatted with version tags', () => {
    // Invariant: the bump scripts (bump_version_vXXX.py) always prepend a
    // Stage-formatted entry. Once we have 5+ Stage-formatted entries at the
    // head of the array, this assertion keeps that invariant locked.
    const recent = BUILD_FEATURES.slice(0, 5);
    for (const raw of recent) {
      const parsed = parseFeatureEntry(raw);
      expect(parsed.version).toMatch(/^v\d+\.\d+[a-z]?$/);
    }
  });

  it('first real BUILD_FEATURES entry version === BUILD_VERSION', () => {
    // Contract: BUILD_FEATURES[0] is the current release, ordering enforced
    // by the bump script.
    const parsed = parseFeatureEntry(BUILD_FEATURES[0]);
    expect(parsed.version).toBe(BUILD_VERSION);
  });
});

describe('v47.434c — buildReleaseHistory', () => {
  const FIXED_NOW = '2026-04-23T18:00:00.000Z';

  it('identity block reflects BUILD_VERSION / BUILD_DATE', () => {
    const h = buildReleaseHistory(5, FIXED_NOW);
    expect(h.service).toBe('solarpro');
    expect(h.producerVersion).toBe(BUILD_VERSION);
    expect(h.buildDate).toBe(BUILD_DATE);
  });

  it('default limit returns all BUILD_FEATURES entries', () => {
    const h = buildReleaseHistory(undefined, FIXED_NOW);
    expect(h.releases).toHaveLength(BUILD_FEATURES.length);
    expect(h.totalCount).toBe(BUILD_FEATURES.length);
  });

  it('respects explicit limit', () => {
    const h = buildReleaseHistory(3, FIXED_NOW);
    expect(h.releases).toHaveLength(3);
    expect(h.totalCount).toBe(BUILD_FEATURES.length);
  });

  it('clamps limit to [1, BUILD_FEATURES.length]', () => {
    const h0 = buildReleaseHistory(0, FIXED_NOW);
    expect(h0.releases).toHaveLength(1);

    const hNeg = buildReleaseHistory(-5, FIXED_NOW);
    expect(hNeg.releases).toHaveLength(1);

    const hHuge = buildReleaseHistory(99999, FIXED_NOW);
    expect(hHuge.releases).toHaveLength(BUILD_FEATURES.length);
  });

  it('latest === releases[0]', () => {
    const h = buildReleaseHistory(5, FIXED_NOW);
    expect(h.latest).toEqual(h.releases[0]);
  });

  it('latest.version === BUILD_VERSION (drift-guard between lib/version.ts and BUILD_FEATURES[0])', () => {
    const h = buildReleaseHistory(1, FIXED_NOW);
    expect(h.latest?.version).toBe(BUILD_VERSION);
  });

  it('releases are in chronological DESC order (newest first) by parse order in BUILD_FEATURES', () => {
    const h = buildReleaseHistory(undefined, FIXED_NOW);
    // BUILD_FEATURES is prepended on each bump — first element is newest.
    // We don't assert strict version comparison (minor/patch letters make
    // that tricky) but we do assert BUILD_VERSION is at index 0.
    expect(h.releases[0].version).toBe(BUILD_VERSION);
  });

  it('generatedAt is passed through uninspected', () => {
    const h = buildReleaseHistory(5, FIXED_NOW);
    expect(h.generatedAt).toBe(FIXED_NOW);
  });

  it('determinism: same input (BUILD_VERSION+BUILD_FEATURES+same limit) yields equal payloads', () => {
    const a = buildReleaseHistory(3, '2026-01-01T00:00:00.000Z');
    const b = buildReleaseHistory(3, '2099-12-31T23:59:59.999Z');
    const strip = (p: ReturnType<typeof buildReleaseHistory>) => {
      const { generatedAt: _, ...rest } = p;
      return JSON.stringify(rest);
    };
    expect(strip(a)).toBe(strip(b));
  });

  it('totalCount is always BUILD_FEATURES.length regardless of limit', () => {
    for (const lim of [1, 3, 10, 50, 9999]) {
      const h = buildReleaseHistory(lim, FIXED_NOW);
      expect(h.totalCount).toBe(BUILD_FEATURES.length);
    }
  });
});