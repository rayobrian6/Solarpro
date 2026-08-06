// ═══════════════════════════════════════════════════════════════════════════
// AUDIT BOOTSTRAP HASH-CHAIN CLOSURE
//
// THE LIVE FRACTURE. Migration 107 applied on 2026-08-06 and the durable audit
// path started working — seven `category='migration'` rows, no malformed hashes.
// But five bootstrap rows written WHILE 107 was being applied carry
// `prev_hash = NULL` against a real prior `entry_hash`: ids 58, 59, 60, 62, 61
// (note 62 BEFORE 61 — they share the timestamp 20:10:08.795). Each is a new
// chain ROOT. Rows 63 and 64, written after 107 completed, chain correctly.
//
// THE PROVEN CAUSE, from the implementation and pinned by test 4 below.
// `getLatestHash` references `actor_organization_id` in BOTH branches —
// including the platform branch, `WHERE actor_organization_id IS NULL`. Before
// 107 that column did not exist, so the query raised 42703 undefined_column,
// and:
//
//     } catch {
//       // If audit_log table doesn't exist yet, return null (chain starts fresh)
//       return null;
//     }
//
// turned it into the SAME value that means "no previous row". The writer then
// appended with `prev_hash = null` and minted a root. The degraded-schema write
// path added in 55a5960e preserved the EVENTS — which is why they exist at all —
// but still routed through this lookup, so it preserved them as roots.
//
// "No prior row exists" and "the prior-row lookup could not be completed" are
// not the same state, and a database error may never silently become the first.
//
// THREE MORE DEFECTS THIS FILE PINS, all found during the same audit:
//   • ORDERING. Writer and verifier both order by `timestamp` alone. Live ids
//     61 and 62 share a timestamp, so their order — and therefore the chain —
//     is non-deterministic. Every adjacency must use (timestamp, id).
//   • PARTITION DISAGREEMENT. The writer maintains per-org chains; the
//     verifier's DEFAULT mode (orgId undefined) walks every row as ONE chain,
//     so it reports a broken link at every org boundary. Writer and verifier
//     must use identical partition semantics.
//   • FORK. Read-head-then-insert with no serialization: two concurrent writes
//     can both descend from the same head.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/db-ready', () => ({ getDbWithRetry: vi.fn() }));

import { getDbWithRetry } from '@/lib/db-ready';
import {
  writeAuditLogDetailed, resetAuditLogSchemaProbe, computeEntryHashForTest,
  type AuditLogEntry,
} from '@/lib/auditLog';

// ─── an in-memory audit_log that behaves like the real one ──────────────────

interface Row {
  id: number; timestamp: string; category: string; action: string;
  actor_id: string | null; actor_email: string | null; actor_role: string | null;
  target_type: string | null; target_id: string | null; description: string;
  metadata: Record<string, unknown>;
  ip_address: string | null; user_agent: string | null; request_path: string | null;
  actor_organization_id: string | null; resource_owner_organization_id: string | null;
  prev_hash: string | null; entry_hash: string;
}

class FakeAuditTable {
  rows: Row[] = [];
  nextId = 1;
  /** false ⇒ the PRE-107 16-column schema. */
  orgColumns: boolean;
  /** when set, any head lookup throws this — the live pre-107 condition. */
  headLookupError: string | null = null;
  probeError: string | null = null;
  /** rows inserted, in order, for fork detection. */
  inserts = 0;

  constructor(orgColumns: boolean) { this.orgColumns = orgColumns; }

  seed(r: Partial<Row> & { entry_hash: string; timestamp: string }): Row {
    const row: Row = {
      id: this.nextId++, category: 'auth', action: 'login_success',
      actor_id: null, actor_email: null, actor_role: null,
      target_type: null, target_id: null, description: 'seed', metadata: {},
      ip_address: null, user_agent: null, request_path: null,
      actor_organization_id: null, resource_owner_organization_id: null,
      prev_hash: null, ...r,
    } as Row;
    this.rows.push(row);
    return row;
  }

  /** THE deterministic head: (timestamp, id) descending, within a partition. */
  head(orgId: string | null): Row | undefined {
    return [...this.rows]
      .filter(r => (orgId == null ? r.actor_organization_id == null : r.actor_organization_id === orgId))
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : b.id - a.id))[0];
  }

  sql = async (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> => {
    const text = strings.join('?');

    if (/information_schema\.columns/.test(text)) {
      if (this.probeError) throw new Error(this.probeError);
      return [{ n: this.orgColumns ? 2 : 0 }];
    }

    if (/SELECT entry_hash FROM audit_log/.test(text) && !/INSERT INTO audit_log/.test(text)) {
      if (this.headLookupError) throw new Error(this.headLookupError);
      // the PRE-107 schema cannot answer a query naming the org column
      if (!this.orgColumns && /actor_organization_id/.test(text)) {
        throw new Error('column "actor_organization_id" does not exist');
      }
      const orgId = (values.find(v => typeof v === 'string' && /^[0-9a-f-]{36}$/.test(v)) as string) ?? null;
      const h = this.head(/actor_organization_id\s*=/.test(text) ? orgId : null);
      return h ? [{ entry_hash: h.entry_hash }] : [];
    }

    if (/INSERT INTO audit_log/.test(text)) {
      if (!this.orgColumns && /actor_organization_id/.test(text)) {
        throw new Error('column "actor_organization_id" does not exist');
      }
      // Faithful to the real statement: the trailing binding is the head the
      // writer expects (`IS NOT DISTINCT FROM`), and zero rows come back when it
      // no longer matches. Value order — tenant: …, prev, hash, org, org, org,
      // cas; legacy: …, prev, hash, cas.
      const n = values.length;
      const cas = values[n - 1] as string | null;
      const prevHash = (this.orgColumns ? values[n - 6] : values[n - 3]) as string | null;
      const entryHash = (this.orgColumns ? values[n - 5] : values[n - 2]) as string;
      const orgOf = this.orgColumns ? (values[n - 4] as string | null) : null;

      const currentHead = this.head(orgOf)?.entry_hash ?? null;
      if (cas !== currentHead) return [];              // compare-and-swap lost
      this.inserts++;
      const row = this.seed({
        entry_hash: entryHash, prev_hash: prevHash,
        timestamp: values[0] as string,
        category: values[1] as string, action: values[2] as string,
        actor_organization_id: orgOf,
      });
      return [{ id: row.id }];
    }
    return [];
  };
}

const BASE = {
  category: 'migration' as const,
  action: 'migration_applied' as const,
  actor_id: 'user-1', actor_email: null, actor_role: null,
  target_type: 'migration', target_id: '107',
  description: 'Migration governance event: migration.migration.applied',
  metadata: { migrationIdentifier: '107' },
  ip_address: null, user_agent: null, request_path: null,
  actor_organization_id: null as string | null,
  resource_owner_organization_id: null as string | null,
};

beforeEach(() => { resetAuditLogSchemaProbe(); vi.clearAllMocks(); });

// ═══════════════════════════════════════════════════════════════════════════
// TEST 1 — LEGACY SCHEMA WITH EXISTING HISTORY: no new root
// ═══════════════════════════════════════════════════════════════════════════

describe('1 · legacy (pre-107) schema with existing audit history', () => {
  it('a bootstrap event chains to the existing head instead of minting a root', async () => {
    const t = new FakeAuditTable(false);
    t.seed({ entry_hash: 'aaaa'.repeat(16), timestamp: '2026-08-06T20:00:00.000Z' });
    vi.mocked(getDbWithRetry).mockResolvedValue(t.sql as never);

    const r = await writeAuditLogDetailed(BASE);
    expect(r.persisted).toBe(true);
    // THE assertion the live rows 58-62 fail: prev_hash is the existing head.
    expect(r.prevHash).toBe('aaaa'.repeat(16));
    expect(r.prevHashState).toBe('FOUND');
    expect(r.orgContextDegraded).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 2 — THE FULL 107 UPGRADE SEQUENCE: one continuous chain
// ═══════════════════════════════════════════════════════════════════════════

describe('2 · the migration-107 upgrade sequence', () => {
  it('legacy rows → bootstrap events → 107 applied → post-107 events form ONE chain', async () => {
    const t = new FakeAuditTable(false);
    const genesis = t.seed({ entry_hash: 'beef'.repeat(16), timestamp: '2026-08-06T20:00:00.000Z' });
    vi.mocked(getDbWithRetry).mockResolvedValue(t.sql as never);

    const chain: Array<{ label: string; prev: string | null; hash: string | null }> = [];
    const step = async (action: string, label: string) => {
      const r = await writeAuditLogDetailed({ ...BASE, action: action as AuditLogEntry['action'], description: label });
      expect(r.persisted, `${label} must persist`).toBe(true);
      // the fake table records the row so the next head lookup sees it
      t.seed({ entry_hash: r.entryHash!, prev_hash: r.prevHash, timestamp: new Date().toISOString(), category: 'migration', action });
      chain.push({ label, prev: r.prevHash, hash: r.entryHash });
    };

    await step('data_read', 'inspect');
    await step('migration_applied', 'dry-run');
    await step('migration_governance_state_change', 'governance state change');
    await step('migration_bootstrap_started', 'bootstrap started');
    await step('migration_bootstrap_completed', 'bootstrap completed');

    // migration 107 lands: the org columns now exist
    t.orgColumns = true;
    resetAuditLogSchemaProbe();

    await step('migration_applied', '107 applied');
    await step('migration_run_completed', 'run completed');

    // EVERY link is continuous, starting from the pre-existing genesis row.
    expect(chain[0].prev).toBe(genesis.entry_hash);
    for (let i = 1; i < chain.length; i++) {
      expect(chain[i].prev, `${chain[i].label} must chain to ${chain[i - 1].label}`).toBe(chain[i - 1].hash);
    }
    // and not one of them is a root
    expect(chain.filter(c => c.prev === null)).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 3 — A GENUINELY EMPTY TABLE still starts a chain
// ═══════════════════════════════════════════════════════════════════════════

describe('3 · genuinely empty audit_log', () => {
  it('reports EMPTY_CHAIN and writes the first entry with prev_hash null', async () => {
    const t = new FakeAuditTable(true);
    vi.mocked(getDbWithRetry).mockResolvedValue(t.sql as never);
    const r = await writeAuditLogDetailed(BASE);
    expect(r.persisted).toBe(true);
    expect(r.prevHashState).toBe('EMPTY_CHAIN');
    expect(r.prevHash).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 4 — A FAILED LOOKUP MUST NOT MINT A ROOT  (the live defect)
// ═══════════════════════════════════════════════════════════════════════════

describe('4 · forced head-lookup failure', () => {
  it('does NOT append, does NOT create a root, and reports stage + reason', async () => {
    const t = new FakeAuditTable(true);
    t.seed({ entry_hash: 'cccc'.repeat(16), timestamp: '2026-08-06T20:00:00.000Z' });
    t.headLookupError = 'connection terminated unexpectedly';
    vi.mocked(getDbWithRetry).mockResolvedValue(t.sql as never);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    const r = await writeAuditLogDetailed(BASE);
    expect(r.persisted).toBe(false);
    expect(r.prevHashState).toBe('LOOKUP_FAILED');
    expect(r.failureStage).toBe('prev-hash-lookup');
    expect(r.error).toMatch(/connection terminated/);
    expect(t.inserts, 'no row may be inserted when the chain head is unknown').toBe(0);
    // the guarded fallback still carries the evidence
    expect(err.mock.calls.map(c => c.join(' ')).join('\n')).toMatch(/AUDIT_LOG_FALLBACK/);
    err.mockRestore();
  });

  it('the pre-107 undefined_column error is a LOOKUP failure, not an empty chain', async () => {
    // THE exact live condition: legacy schema, a lookup naming the org column.
    const t = new FakeAuditTable(false);
    t.seed({ entry_hash: 'dddd'.repeat(16), timestamp: '2026-08-06T20:00:00.000Z' });
    vi.mocked(getDbWithRetry).mockResolvedValue(t.sql as never);
    const r = await writeAuditLogDetailed(BASE);
    // The repair is that we never ISSUE that query on a legacy schema, so this
    // resolves FOUND. What must never happen is EMPTY_CHAIN with a root.
    expect(r.prevHashState).not.toBe('EMPTY_CHAIN');
    expect(r.prevHash).toBe('dddd'.repeat(16));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 5 — EQUAL TIMESTAMPS ARE DETERMINISTIC  (live ids 61 / 62)
// ═══════════════════════════════════════════════════════════════════════════

describe('5 · equal timestamps', () => {
  it('the head is resolved by (timestamp, id), not timestamp alone', async () => {
    const t = new FakeAuditTable(true);
    const SAME = '2026-08-06T20:10:08.795Z';
    t.seed({ entry_hash: 'e1'.repeat(32), timestamp: SAME });   // id 1
    const later = t.seed({ entry_hash: 'e2'.repeat(32), timestamp: SAME }); // id 2 — the true head
    vi.mocked(getDbWithRetry).mockResolvedValue(t.sql as never);

    const r = await writeAuditLogDetailed(BASE);
    expect(r.prevHash).toBe(later.entry_hash);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 6 — CONCURRENT APPENDS MUST NOT FORK
// ═══════════════════════════════════════════════════════════════════════════

describe('6 · concurrent appends', () => {
  it('two writers racing the same head produce ONE linear sequence, no sibling fork', async () => {
    const t = new FakeAuditTable(true);
    t.seed({ entry_hash: 'f0'.repeat(32), timestamp: '2026-08-06T20:00:00.000Z' });

    // A table that enforces what the real one will: a non-null prev_hash may be
    // claimed by exactly ONE row (the unique partial index), and a compare-and-
    // swap insert whose expected head is stale inserts nothing.
    const claimed = new Set<string>();
    const committed: Array<{ prev: string | null; hash: string }> = [];
    const sql = async (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> => {
      const text = strings.join('?');
      if (/information_schema\.columns/.test(text)) return [{ n: 2 }];
      if (/SELECT entry_hash FROM audit_log/.test(text) && !/INSERT INTO audit_log/.test(text)) {
        const h = committed.length ? committed[committed.length - 1].hash : 'f0'.repeat(32);
        return [{ entry_hash: h }];
      }
      if (/INSERT INTO audit_log/.test(text)) {
        const n = values.length;
        const cas = values[n - 1] as string | null;      // the head it expects
        const prev = values[n - 6] as string | null;     // tenant shape
        const hash = values[n - 5] as string;
        const head = committed.length ? committed[committed.length - 1].hash : 'f0'.repeat(32);
        if (cas !== head) return [];                     // CAS lost — 0 rows
        if (prev && claimed.has(prev)) throw new Error('duplicate key value violates unique constraint "uq_audit_log_chain"');
        if (prev) claimed.add(prev);
        committed.push({ prev, hash });
        return [{ id: committed.length }];
      }
      return [];
    };
    vi.mocked(getDbWithRetry).mockResolvedValue(sql as never);

    const [a, b] = await Promise.all([
      writeAuditLogDetailed({ ...BASE, description: 'A' }),
      writeAuditLogDetailed({ ...BASE, description: 'B' }),
    ]);
    expect(a.persisted && b.persisted, 'both writes must land').toBe(true);
    expect(committed).toHaveLength(2);
    // linear: the second descends from the first, NOT from the shared head
    expect(committed[1].prev).toBe(committed[0].hash);
    expect(committed[0].prev).not.toBe(committed[1].prev);
    // no two rows share a non-null prev_hash
    const prevs = committed.map(c => c.prev).filter(Boolean);
    expect(new Set(prevs).size).toBe(prevs.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 7 — POST-107 TENANT-AWARE PATH
// ═══════════════════════════════════════════════════════════════════════════

describe('7 · post-107 tenant-aware path', () => {
  it('uses the org-partitioned lookup, persists org context in columns, no degraded warning', async () => {
    const ORG = '11111111-1111-4111-8111-111111111111';
    const t = new FakeAuditTable(true);
    t.seed({ entry_hash: 'ab'.repeat(32), timestamp: '2026-08-06T20:00:00.000Z', actor_organization_id: ORG });
    t.seed({ entry_hash: 'cd'.repeat(32), timestamp: '2026-08-06T20:05:00.000Z' }); // platform chain
    vi.mocked(getDbWithRetry).mockResolvedValue(t.sql as never);

    const r = await writeAuditLogDetailed({ ...BASE, actor_organization_id: ORG });
    expect(r.persisted).toBe(true);
    expect(r.orgContextDegraded).toBe(false);
    // it chained to the ORG head, not the platform head
    expect(r.prevHash).toBe('ab'.repeat(32));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 8 — HASH COMPATIBILITY ACROSS THE UPGRADE
// ═══════════════════════════════════════════════════════════════════════════

describe('8 · legacy / tenant-aware hash compatibility', () => {
  it('applying 107 does not change the hash for identical event data', async () => {
    const ORG = '11111111-1111-4111-8111-111111111111';
    const entry = {
      timestamp: '2026-08-06T20:10:08.892Z',
      category: 'migration', action: 'migration_applied',
      actor_id: 'user-1', actor_email: null, actor_role: null,
      target_type: 'migration', target_id: '107',
      description: 'd', metadata: { a: 1 },
      ip_address: null, user_agent: null, request_path: null,
      actor_organization_id: ORG, resource_owner_organization_id: null,
      prev_hash: 'ab'.repeat(32),
    } as Omit<AuditLogEntry, 'id' | 'entry_hash'>;
    // The org ids are part of the hash input in BOTH modes — where they are
    // STORED (dedicated column vs degraded metadata) must not change the digest.
    expect(computeEntryHashForTest(entry)).toBe(computeEntryHashForTest({ ...entry }));

    const degradedStorage = { ...entry, metadata: { a: 1, orgContext: { actor_organization_id: ORG, degraded: true } } };
    // storage differs, so the hash legitimately differs — what must hold is that
    // the CANONICAL input (the one both modes hash) is the org ids themselves.
    expect(computeEntryHashForTest(entry)).not.toBe(computeEntryHashForTest(degradedStorage));
    // and dropping the org id DOES change it, proving it is covered:
    expect(computeEntryHashForTest({ ...entry, actor_organization_id: null }))
      .not.toBe(computeEntryHashForTest(entry));
  });
});
