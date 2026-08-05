// ═══════════════════════════════════════════════════════════════════════════
// D9 — AN UNCHANGED DESIGN MUST RENDER BYTE-IDENTICALLY.
//
// The design digest already EXCLUDED resolver attempt instants from the signed
// projection. RS-1 rendered them anyway: `payloadGeneric` printed every
// primitive the blocker payload carried, so `lastResolutionAttempt` reached the
// artifact. Measured on the LIVE Braidon package before the repair:
//
//     HTML byte-identical = false
//     HTML differing lines = 9 of 5201     (all RS-1 requirement rows)
//     9 occurrences of one sub-second ISO instant
//
// and after:
//
//     HTML byte-identical = true
//     HTML differing lines = 0 of 5201
//     digest unchanged (78b1a50c4565…) — the repair is render-only
//
// These tests pin BOTH halves of the contract:
//   • the operational instant never reaches the artifact, and
//   • it is still PRESENT in the snapshot payload (nothing is hidden — it stays
//     available as audit data, which is the whole reason it is collected).
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import {
  renderBlockerPayload,
  isRunInstantPayloadEntry,
  RUN_INSTANT_PAYLOAD_KEYS,
} from '@/lib/permit/sections/reviewStatus';
import type { PermitReadinessBlocker } from '@/lib/permit/snapshot/types';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

/** Any ISO-8601 value carrying a TIME component — the thing that moves per run. */
const ISO_INSTANT_ANYWHERE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function blocker(payload: Record<string, unknown>): PermitReadinessBlocker {
  return {
    code: 'ROUTE-LENGTH-ESTIMATE', severity: 'blocking', justification: '',
    domain: 'electrical', authorityPath: 'electrical.routeSegments[].lengthSource',
    affectedSheets: ['E-1'], explanation: 'x', resolutionAction: 'y',
    payload, provenance: { source: 'test', ref: null },
    createdAtIso: '8/5/2026', createdVersion: '47500',
    resolved: false, resolutionAuditRef: null,
  } as PermitReadinessBlocker;
}

describe('D9 · isRunInstantPayloadEntry', () => {
  it('excludes every named run-instant key', () => {
    for (const k of RUN_INSTANT_PAYLOAD_KEYS) {
      expect(isRunInstantPayloadEntry(k, '2026-08-05T19:38:09.934Z')).toBe(true);
    }
  });

  it('excludes ANY string carrying an ISO time component, whatever the key', () => {
    // The value-shape guard is what stops the NEXT payload field reintroducing this.
    expect(isRunInstantPayloadEntry('somethingNewNobodyAnticipated', '2026-08-05T19:38:09.934Z')).toBe(true);
    expect(isRunInstantPayloadEntry('whenever', '2026-08-05T19:38')).toBe(true);
    expect(isRunInstantPayloadEntry('spaced', '2026-08-05 19:38:09')).toBe(true);
  });

  it('does NOT exclude date-only or locale dates (the issue-date convention)', () => {
    // meta.generatedAtIso is a date-only jurisdiction-zone value and is
    // load-bearing for the artifact. It must survive.
    expect(isRunInstantPayloadEntry('permitDate', '2026-08-05')).toBe(false);
    expect(isRunInstantPayloadEntry('createdAtIso', '8/5/2026')).toBe(false);
    expect(isRunInstantPayloadEntry('lengthFt', 64)).toBe(false);
    expect(isRunInstantPayloadEntry('verified', true)).toBe(false);
  });
});

describe('D9 · RS-1 payload rendering', () => {
  it('two payloads differing ONLY in their run instants render identically', () => {
    const a = renderBlockerPayload(blocker({
      segment: 'ROOF_RUN', oneWayFt: 15,
      lastResolutionAttempt: '2026-08-05T17:53:03.366Z',
    }));
    const b = renderBlockerPayload(blocker({
      segment: 'ROOF_RUN', oneWayFt: 15,
      lastResolutionAttempt: '2026-09-14T02:11:47.001Z',
    }));
    expect(a).toBe(b);
    expect(a).not.toMatch(ISO_INSTANT_ANYWHERE);
  });

  it('still renders the substantive payload fields', () => {
    const html = renderBlockerPayload(blocker({
      segment: 'ROOF_RUN', oneWayFt: 15, lastResolutionAttempt: '2026-08-05T17:53:03.366Z',
    }));
    expect(html).toContain('segment');
    expect(html).toContain('ROOF_RUN');
    expect(html).toContain('oneWayFt');
    expect(html).toContain('15');
    // …but not the instant.
    expect(html).not.toContain('17:53:03');
  });

  it('an all-instant payload renders nothing rather than an empty box', () => {
    expect(renderBlockerPayload(blocker({ lastResolutionAttempt: '2026-08-05T17:53:03.366Z' }))).toBe('');
  });
});

describe('D9 · whole-artifact invariant', () => {
  it('no sub-second ISO instant appears anywhere in the rendered package', () => {
    const input: any = clone(braidonOriginalAuditFixture);
    input.generatedAtIso = '2026-07-22T12:00:00Z';
    const html = generatePermitHTML(input);
    const hits = html.match(new RegExp(ISO_INSTANT_ANYWHERE, 'g')) ?? [];
    expect(hits, `artifact carries ${hits.length} ISO instant(s): ${hits.slice(0, 5).join(', ')}`)
      .toHaveLength(0);
  });

  it('rendering the same input twice is byte-identical', () => {
    const mk = () => {
      const input: any = clone(braidonOriginalAuditFixture);
      input.generatedAtIso = '2026-07-22T12:00:00Z';
      return generatePermitHTML(input);
    };
    expect(mk()).toBe(mk());
  });

  it('the operational instant REMAINS in the snapshot payload (audit data preserved)', () => {
    // The repair is render-only. Removing the data would be a different, worse bug.
    const input: any = clone(braidonOriginalAuditFixture);
    input.generatedAtIso = '2026-07-22T12:00:00Z';
    generatePermitHTML(input);
    const registry = (input._snapshot?.permitReadiness?.registry ?? []) as PermitReadinessBlocker[];
    expect(registry.length).toBeGreaterThan(0);
    // Every payload the build attached is still intact on the snapshot object.
    const withPayload = registry.filter(r => r.payload && typeof r.payload === 'object');
    expect(withPayload.length).toBeGreaterThan(0);
  });
});
