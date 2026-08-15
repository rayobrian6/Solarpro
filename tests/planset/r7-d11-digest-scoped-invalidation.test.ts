// ═══════════════════════════════════════════════════════════════════════════
// D11 — DIGEST-SCOPED INVALIDATION.
//
// THE PREMISE THE WHOLE LEDGER RESTS ON. `invalidationApplies` matches a row
// against a design digest: a row naming digest D invalidates an approval of D.
// That is only meaningful if an UNCHANGED DESIGN HAS ONE DIGEST. It does not.
//
// DEFECT 1 — THE DIGEST MOVES WITH THE CALENDAR. `meta.generatedAtIso` is the
// resolved jurisdiction-zone issue date and it is DIGESTED. `generatePermit.ts`
// overwrites `project.date` with that date on every render, so an unchanged
// design regenerates to a different digest the next day. A PE approves digest D
// today; tomorrow the same design is D′ and the approval is dropped as stale by
// the mechanism built to protect it. This is MCC §0's defect exactly — a fact
// about the ACT OF BUILDING leaking into the identity of the thing built — which
// MCC closed for sub-second run-instants while the calendar date walked through
// the same door. The archived Braidon snapshot reads 7/30/2026 against a live
// 8/6/2026, with different digests and no design change between them.
//
// DEFECT 2 — ONE LEDGER, TWO WRITERS, TWO BEHAVIOURS. `reconcile.ts` records the
// PRE-change digest (`knownSnapshot?.digest`), which is the form
// `invalidationApplies` can scope. `InvalidationSink.invalidate` has no digest
// parameter AT ALL, so the field-measurement sink writes `digest: null` by
// construction — a blunt time watermark that invalidates EVERY approval on the
// project made at or before it, including approvals for designs the measurement
// never touched.
//
// DEFECT 3 — AN INVALIDATION CAN NEVER BE LIFTED. `superseded_at` /
// `superseded_by` exist in migration 114 and `listActiveInvalidations` filters
// on them, but NOTHING in the codebase writes them. There is no path by which a
// rebuilt, re-reviewed design clears its own invalidation.
//
// WHAT MUST NOT HAPPEN: the live NULL-digest rows must never be backfilled with
// a reconstructed digest. Their pre-change digests were never captured, and
// inventing one is fabricated authority. They stay legacy watermarks.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { computeSnapshotDigest } from '@/lib/permit/snapshot/digest';
import { invalidationApplies, type DigestInvalidationFact } from '@/lib/permit/snapshot/reviewCoverage';
import {
  planInvalidationSupersession, classifyInvalidationRow,
} from '@/lib/reconciliation/invalidationLedger';

// ═══════════════════════════════════════════════════════════════════════════
// 1 — THE DIGEST IDENTIFIES THE DESIGN, NOT THE DAY IT WAS BUILT
// ═══════════════════════════════════════════════════════════════════════════

const baseSnapshot = (over: Record<string, unknown> = {}) => ({
  meta: {
    snapshotId: '', digest: '', schemaVersion: '1.0.0', engineVersion: '47500',
    generatedAtIso: '2026-08-05', generatedAtPrecision: 'date',
    generatedAtBasis: 'reformatted', projectId: 'p1', designVersionId: null,
    ...(over.meta as Record<string, unknown> ?? {}),
  },
  design: { panels: 31, moduleModel: 'Q.PEAK DUO BLK ML-G10+ 400W', ...(over.design as Record<string, unknown> ?? {}) },
  permitReadiness: {
    registry: [{ code: 'X', createdAtIso: '2026-08-05', payload: { lastResolutionAttempt: '2026-08-05T10:00:00.000Z' } }],
    ...(over.permitReadiness as Record<string, unknown> ?? {}),
  },
});

describe('D11 · an unchanged design has ONE digest', () => {
  it('1 — the calendar date does not change the digest', () => {
    const monday = baseSnapshot();
    const tuesday = baseSnapshot({
      meta: { generatedAtIso: '2026-08-06' },
      permitReadiness: { registry: [{ code: 'X', createdAtIso: '2026-08-06', payload: { lastResolutionAttempt: '2026-08-06T10:00:00.000Z' } }] },
    });
    expect(computeSnapshotDigest(tuesday)).toBe(computeSnapshotDigest(monday));
  });

  it('2 — nor does an injected ISO INSTANT differing only in time', () => {
    const a = baseSnapshot({ meta: { generatedAtIso: '2026-08-05T09:00:00.000Z', generatedAtPrecision: 'instant' } });
    const b = baseSnapshot({ meta: { generatedAtIso: '2026-08-05T23:59:59.999Z', generatedAtPrecision: 'instant' } });
    expect(computeSnapshotDigest(b)).toBe(computeSnapshotDigest(a));
  });

  it('3 — nor does the PRECISION or BASIS of the stamp', () => {
    const a = baseSnapshot();
    const b = baseSnapshot({ meta: { generatedAtPrecision: 'instant', generatedAtBasis: 'the caller injected an ISO instant' } });
    expect(computeSnapshotDigest(b)).toBe(computeSnapshotDigest(a));
  });

  it('4 — but a real DESIGN change still moves it (the exclusion is narrow)', () => {
    const a = baseSnapshot();
    const b = baseSnapshot({ design: { panels: 32 } });
    expect(computeSnapshotDigest(b)).not.toBe(computeSnapshotDigest(a));
  });

  it('5 — and the engine version still moves it (a rebuild is a different build)', () => {
    const a = baseSnapshot();
    const b = baseSnapshot({ meta: { engineVersion: '47501' } });
    expect(computeSnapshotDigest(b)).not.toBe(computeSnapshotDigest(a));
  });

  // ── the revision-history rule, and the bug it hid ────────────────────────
  // The auto-generated current revision is dated with the LOCALISED issue date
  // ('7/30/2026') while `meta.generatedAtIso` may be an injected ISO instant
  // ('2026-07-30T12:00:00.000Z'). The first cut of this exclusion compared the
  // revision date against the meta stamp, so on every frozen-clock build it
  // silently never matched and the digest went on moving with the calendar.
  // Measured on live Braidon: 4 builds across 7/30/2026, 8/6/2026 and 1/1/2027
  // produced 3 distinct digests until this was compared against issueDate.
  const withAuthority = (issueDate: string, stamp: string, history: Array<{ rev: string; date: string }>) => ({
    ...baseSnapshot({ meta: { generatedAtIso: stamp, generatedAtPrecision: 'instant' } }),
    projectAuthority: { issueDate, capturedAtIso: stamp, revisionHistory: history },
  });

  it('6 — the revision row THIS build stamped does not move the digest', () => {
    const a = withAuthority('7/30/2026', '2026-07-30T12:00:00.000Z', [{ rev: 'A', date: '7/30/2026' }]);
    const b = withAuthority('1/1/2027', '2027-01-01T12:00:00.000Z', [{ rev: 'A', date: '1/1/2027' }]);
    expect(computeSnapshotDigest(b)).toBe(computeSnapshotDigest(a));
  });

  it('7 — but a HISTORICAL revision still does (it is real provenance)', () => {
    const a = withAuthority('1/1/2027', '2027-01-01T12:00:00.000Z',
      [{ rev: 'A', date: '6/1/2026' }, { rev: 'B', date: '1/1/2027' }]);
    const b = withAuthority('1/1/2027', '2027-01-01T12:00:00.000Z',
      [{ rev: 'A', date: '6/2/2026' }, { rev: 'B', date: '1/1/2027' }]);
    expect(computeSnapshotDigest(b)).not.toBe(computeSnapshotDigest(a));
  });

  it('8 — a document capture date is NOT a build stamp and still moves it', () => {
    // `equipment.*.datasheet.capturedAtIso` shares its key name with the build
    // stamps. Excluding by KEY would have deleted real document provenance from
    // the digest; the exclusion is by PATH for exactly this reason.
    const withDoc = (captured: string) => ({
      ...baseSnapshot(),
      equipment: { modules: [{ datasheet: { capturedAtIso: captured } }] },
    });
    expect(computeSnapshotDigest(withDoc('2026-07-30T00:00:00.000Z')))
      .not.toBe(computeSnapshotDigest(withDoc('2026-08-06T00:00:00.000Z')));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 — ROW CLASSIFICATION: A LEGACY WATERMARK IS NOT A SCOPED INVALIDATION
// ═══════════════════════════════════════════════════════════════════════════

const row = (o: Partial<DigestInvalidationFact> = {}): DigestInvalidationFact => ({
  digest: null, scope: 'snapshot', invalidatedAtIso: '2026-08-05T12:00:00.000Z',
  reason: 'field measurement recorded', ...o,
});

describe('D11 · the two kinds of ledger row are distinguishable', () => {
  it('6 — a row naming a digest is DIGEST-SCOPED', () => {
    expect(classifyInvalidationRow(row({ digest: 'a'.repeat(64) })).kind).toBe('digest-scoped');
  });

  it('7 — a NULL-digest row is a TIME WATERMARK, and says what that costs', () => {
    const c = classifyInvalidationRow(row());
    expect(c.kind).toBe('time-watermark');
    expect(c.basis).toMatch(/every approval|at or before/i);
  });

  it('8 — a watermark cannot be upgraded by inventing a digest', () => {
    // The live rows never captured a pre-change digest. Reconstructing one is
    // fabricated authority, so there is deliberately no such operation: the
    // classification is a READ of what the row says, never a repair of it.
    const c = classifyInvalidationRow(row());
    expect(c.digest).toBeNull();
    expect(c.supersedableByRebuild).toBe(false);
  });

  it('9 — a digest-scoped row IS supersedable by a rebuild that re-covers it', () => {
    expect(classifyInvalidationRow(row({ digest: 'b'.repeat(64) })).supersedableByRebuild).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 — SUPERSESSION: AN INVALIDATION CAN BE LIFTED, BY THE RIGHT THING ONLY
// ═══════════════════════════════════════════════════════════════════════════

describe('D11 · superseded_at becomes writable, under a stated rule', () => {
  const DIGEST_OLD = 'a'.repeat(64);
  const DIGEST_NEW = 'c'.repeat(64);

  it('10 — a new approval covering the REBUILT digest supersedes rows naming the OLD one', () => {
    const plan = planInvalidationSupersession({
      rows: [
        { id: 'r1', digest: DIGEST_OLD, invalidatedAtIso: '2026-08-05T12:00:00.000Z' },
        { id: 'r2', digest: DIGEST_NEW, invalidatedAtIso: '2026-08-05T12:00:00.000Z' },
      ],
      rebuiltDigest: DIGEST_NEW,
      approvalRef: 'review-9f2c',
      atIso: '2026-08-06T09:00:00.000Z',
    });
    expect(plan.supersede.map(s => s.id)).toEqual(['r1']);
    expect(plan.supersede[0].supersededBy).toBe('review-9f2c');
    expect(plan.retained.map(r => r.id)).toEqual(['r2']);
  });

  it('11 — a row naming the digest being approved is NOT superseded by that approval', () => {
    // Otherwise an approval would clear the very invalidation raised against it.
    const plan = planInvalidationSupersession({
      rows: [{ id: 'r1', digest: DIGEST_NEW, invalidatedAtIso: '2026-08-05T12:00:00.000Z' }],
      rebuiltDigest: DIGEST_NEW, approvalRef: 'review-9f2c', atIso: '2026-08-06T09:00:00.000Z',
    });
    expect(plan.supersede).toEqual([]);
    expect(plan.retained.map(r => r.id)).toEqual(['r1']);
    expect(plan.retainedReasons['r1']).toMatch(/names the digest being approved/i);
  });

  it('12 — a NULL-digest watermark is NEVER auto-superseded by a rebuild', () => {
    const plan = planInvalidationSupersession({
      rows: [{ id: 'r1', digest: null, invalidatedAtIso: '2026-08-05T12:00:00.000Z' }],
      rebuiltDigest: DIGEST_NEW, approvalRef: 'review-9f2c', atIso: '2026-08-06T09:00:00.000Z',
    });
    expect(plan.supersede).toEqual([]);
    expect(plan.retainedReasons['r1']).toMatch(/watermark|no digest/i);
  });

  it('13 — an approval recorded BEFORE the invalidation supersedes nothing', () => {
    const plan = planInvalidationSupersession({
      rows: [{ id: 'r1', digest: DIGEST_OLD, invalidatedAtIso: '2026-08-06T12:00:00.000Z' }],
      rebuiltDigest: DIGEST_NEW, approvalRef: 'review-9f2c', atIso: '2026-08-06T09:00:00.000Z',
    });
    expect(plan.supersede).toEqual([]);
    expect(plan.retainedReasons['r1']).toMatch(/did not exist when it was made/i);
  });

  it('14 — the plan is a PLAN: it names every row and never silently drops one', () => {
    const rows = [
      { id: 'r1', digest: DIGEST_OLD, invalidatedAtIso: '2026-08-05T12:00:00.000Z' },
      { id: 'r2', digest: null, invalidatedAtIso: '2026-08-05T12:00:00.000Z' },
      { id: 'r3', digest: DIGEST_NEW, invalidatedAtIso: '2026-08-05T12:00:00.000Z' },
    ];
    const plan = planInvalidationSupersession({ rows, rebuiltDigest: DIGEST_NEW, approvalRef: 'x', atIso: '2026-08-06T09:00:00.000Z' });
    expect(plan.supersede.length + plan.retained.length).toBe(rows.length);
    for (const r of plan.retained) expect(plan.retainedReasons[r.id]).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 — THE READER STILL BEHAVES (the PRR contract is not weakened)
// ═══════════════════════════════════════════════════════════════════════════

describe('D11 · the existing reader contract is unchanged', () => {
  const D = 'a'.repeat(64);
  it('15 — a row naming the digest still invalidates it', () => {
    expect(invalidationApplies([row({ digest: D })], D, '2026-08-06T10:00:00Z').invalidated).toBe(true);
  });
  it('16 — a row naming a DIFFERENT digest still does not', () => {
    expect(invalidationApplies([row({ digest: 'b'.repeat(64) })], D, '2026-08-06T10:00:00Z').invalidated).toBe(false);
  });
  it('17 — a watermark still invalidates approvals at or before it, and not after', () => {
    expect(invalidationApplies([row()], D, '2026-08-05T11:00:00.000Z').invalidated).toBe(true);
    expect(invalidationApplies([row()], D, '2026-08-05T13:00:00.000Z').invalidated).toBe(false);
  });
  it('18 — an unreadable ledger still never releases', () => {
    expect(invalidationApplies(null, D, '2026-08-06T10:00:00Z').invalidated).toBe(true);
  });
});
