// ═══════════════════════════════════════════════════════════════════════════
// LA §5/§6 — TWO DEFECTS THE 12-ITEM LEDGER SURFACED.
//
// §5  `organization_members` (migration 105) is ABSENT on production while
//     migration 118 — the feature's own table — IS applied. The membership
//     query ran UNCONDITIONALLY and the legacy `users.org_id` fallback only ran
//     when it RETURNED NO ROWS, so a THROW skipped the fallback entirely. The
//     field-measurement authority resolved to "could not be read" (which reads
//     as "nobody measured") on both the read AND the write path, so no amount
//     of field work could have closed ROUTE-LENGTH-ESTIMATE.
//
// §6  `buildResolutionAuditRef` embeds a wall-clock instant, and that string
//     lands on the DIGESTED `resolutionAuditRef`. It had never fired because
//     nothing was ever cleared — the first genuine clearance would have been the
//     first one, silently reinstating the nondeterminism MCC §0 removed.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi } from 'vitest';
import { computeSnapshotDigest } from '@/lib/permit/snapshot/digest';
import { buildResolutionAuditRef } from '@/lib/permit/snapshot/resolution/evidence';

// ═══════════════════════════════════════════════════════════════════════════
// §6 — the audit reference must not carry an instant into the digest
// ═══════════════════════════════════════════════════════════════════════════

describe('LA §6 · a clearing audit reference does not destabilise the digest', () => {
  const snapWithRef = (ref: string) => ({
    meta: { digest: '', snapshotId: '', schemaVersion: '1.0.0' },
    geometry: { modules: [{ id: 'm1' }] },
    permitReadiness: {
      registry: [{
        code: 'MODULE-EXACT-DATASHEET-PENDING',
        resolved: true,
        resolutionAuditRef: ref,
        payload: { resolutionEvidence: [{ auditRef: ref, source: 'registry' }] },
      }],
    },
  }) as unknown as Record<string, unknown>;

  const refAt = (atIso: string) => buildResolutionAuditRef({
    resolverId: 'module-datasheet-binding@v1',
    sourceRefs: ['document:doc-400w', 'sha256:abcdef0123456789'],
    atIso,
  });

  it('the SAME clearance at two different instants gives the SAME digest', () => {
    const a = computeSnapshotDigest(snapWithRef(refAt('2026-08-04T19:38:52.410Z')));
    const b = computeSnapshotDigest(snapWithRef(refAt('2026-08-04T19:39:11.046Z')));
    expect(a).toBe(b);
  });

  it('a DIFFERENT bound document still changes the digest (evidence stays covered)', () => {
    const a = computeSnapshotDigest(snapWithRef(refAt('2026-08-04T19:38:52.410Z')));
    const other = buildResolutionAuditRef({
      resolverId: 'module-datasheet-binding@v1',
      sourceRefs: ['document:doc-DIFFERENT', 'sha256:9999999999999999'],
      atIso: '2026-08-04T19:38:52.410Z',
    });
    expect(computeSnapshotDigest(snapWithRef(other))).not.toBe(a);
  });

  it('a DIFFERENT resolver still changes the digest', () => {
    const a = computeSnapshotDigest(snapWithRef(refAt('2026-08-04T19:38:52.410Z')));
    const other = buildResolutionAuditRef({
      resolverId: 'some-other-resolver@v9', sourceRefs: ['document:doc-400w', 'sha256:abcdef0123456789'],
      atIso: '2026-08-04T19:38:52.410Z',
    });
    expect(computeSnapshotDigest(snapWithRef(other))).not.toBe(a);
  });

  it('an UNRESOLVED requirement (null ref) is still distinguishable', () => {
    const cleared = computeSnapshotDigest(snapWithRef(refAt('2026-08-04T19:38:52.410Z')));
    const open = snapWithRef(refAt('2026-08-04T19:38:52.410Z'));
    const reg = ((open.permitReadiness as Record<string, unknown>).registry as Record<string, unknown>[])[0];
    reg.resolved = false; reg.resolutionAuditRef = null;
    expect(computeSnapshotDigest(open)).not.toBe(cleared);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §5 — a missing OPTIONAL membership table degrades to the legacy pointer
// ═══════════════════════════════════════════════════════════════════════════

/** A tagged-template `sql` whose first call throws the given Postgres error. */
function fakeSql(opts: { membersError?: { code: string } | null; orgId?: string | null; ownerId?: string }) {
  const seen: string[] = [];
  return {
    seen,
    sql: (strings: TemplateStringsArray) => {
      const q = strings.join(' ').replace(/\s+/g, ' ').trim();
      seen.push(q);
      if (/FROM projects/i.test(q)) return Promise.resolve([{ user_id: opts.ownerId ?? 'user-1' }]);
      if (/FROM organization_members/i.test(q)) {
        if (opts.membersError) return Promise.reject(Object.assign(new Error('relation does not exist'), opts.membersError));
        return Promise.resolve([]);
      }
      if (/FROM users/i.test(q)) {
        return Promise.resolve(opts.orgId ? [{ org_id: opts.orgId, org_role: 'owner' }] : []);
      }
      return Promise.resolve([]);
    },
  };
}

describe('LA §5 · an absent membership table falls back instead of failing the feature', () => {
  it('42P01 on organization_members still reaches the legacy users.org_id read', async () => {
    const f = fakeSql({ membersError: { code: '42P01' }, orgId: 'org-abc' });
    const { readProjectMeasurements } = await import('@/lib/fieldMeasurement/permitAccess');
    const core = await import('@/lib/db/core');
    const spy = vi.spyOn(core, 'getDbReady').mockResolvedValue(f.sql as never);
    const repo = await import('@/lib/fieldMeasurement/postgresRepository').catch(() => null);
    void repo;
    try {
      await readProjectMeasurements('p1').catch(() => null);
    } finally { spy.mockRestore(); }
    // The legacy pointer read MUST have been attempted — that is the whole fix.
    expect(f.seen.some(q => /FROM users/i.test(q))).toBe(true);
  });

  it('a NON-42P01 database fault still propagates (only absence degrades)', async () => {
    const f = fakeSql({ membersError: { code: '42501' }, orgId: 'org-abc' });
    const { readProjectMeasurements } = await import('@/lib/fieldMeasurement/permitAccess');
    const core = await import('@/lib/db/core');
    const spy = vi.spyOn(core, 'getDbReady').mockResolvedValue(f.sql as never);
    try {
      await expect(readProjectMeasurements('p1')).rejects.toBeTruthy();
    } finally { spy.mockRestore(); }
    expect(f.seen.some(q => /FROM users/i.test(q))).toBe(false);
  });
});
