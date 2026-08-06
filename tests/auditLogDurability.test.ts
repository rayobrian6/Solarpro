// ═══════════════════════════════════════════════════════════════════════════
// THE DURABLE AUDIT PATH — the outage, and the three things that hid it.
//
// WHAT HAPPENED. Commit d479cbda (2026-07-12) added `actor_organization_id` and
// `resource_owner_organization_id` to `writeAuditLog`'s INSERT, with migration
// 107 to create them. 107 was never applied — the ledger jumps 108 → 119,
// because it predates the registry and sits in the ~27-migration historical
// baseline the global execution gate refuses. From that commit on, every audit
// write from that code inserted 17 columns into a 16-column table and
// PostgreSQL answered `column "actor_organization_id" does not exist`.
//
// The tamper-evident audit_log — the SOC 2 CC7.2 / ISO 27001 A.12.4 control —
// recorded NOTHING from that deployment for weeks, including the governance
// events for migrations 113 and 119.
//
// THREE THINGS HID IT, and this file pins all three closed:
//   1. `writeAuditLog` caught the error and returned bare `null`. The reason
//      never left the function.
//   2. `emitAuditEventAsync` returned bare `{persisted:false}`, so the runner
//      reported AUDIT_PERSISTENCE_FAILED naming no cause. Twice, weeks apart.
//   3. Production still ran the PRE-d479cbda writer, so auth events kept landing
//      and the table never looked dead.
//
// AND THE RULE THE REPAIR ADDS: an audit event is DURABLE FIRST. Losing it is
// strictly worse for the control than recording it without org partitioning, so
// a missing-column schema degrades to a write that still happens, with the org
// ids preserved in metadata and the degradation stated out loud.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/db-ready', () => ({ getDbWithRetry: vi.fn() }));

import { getDbWithRetry } from '@/lib/db-ready';
import {
  writeAuditLogDetailed, resetAuditLogSchemaProbe, auditLogOrgContextStatus,
} from '@/lib/auditLog';

type Call = { text: string; values: unknown[] };

/** A tagged-template SQL double that records what it was asked to run. */
function fakeSql(opts: { orgColumns: boolean; failInsert?: string }) {
  const calls: Call[] = [];
  const fn = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    calls.push({ text, values });
    if (/information_schema\.columns/.test(text)) {
      return [{ n: opts.orgColumns ? 2 : 0 }];
    }
    if (/SELECT entry_hash FROM audit_log/.test(text)) return [];
    if (/INSERT INTO audit_log/.test(text)) {
      if (opts.failInsert) throw new Error(opts.failInsert);
      return [];
    }
    return [];
  };
  return { fn, calls };
}

const ENTRY = {
  category: 'migration' as const,
  action: 'migration_applied' as const,
  actor_id: 'user-1',
  actor_email: null,
  actor_role: null,
  target_type: 'migration',
  target_id: '119',
  description: 'Migration governance event: migration.migration.applied',
  metadata: { migrationIdentifier: '119', durationMs: 121 },
  ip_address: null,
  user_agent: null,
  request_path: null,
  actor_organization_id: null as string | null,
  resource_owner_organization_id: null as string | null,
};

beforeEach(() => { resetAuditLogSchemaProbe(); vi.clearAllMocks(); });

describe('durable audit path · the 107 outage', () => {
  it('1 — with the org columns MISSING the event is still written', async () => {
    const { fn, calls } = fakeSql({ orgColumns: false });
    vi.mocked(getDbWithRetry).mockResolvedValue(fn as never);

    const r = await writeAuditLogDetailed(ENTRY);
    expect(r.persisted).toBe(true);
    expect(r.entryHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.orgContextDegraded).toBe(true);

    // and the INSERT it issued names NEITHER org column — the exact statement
    // that PostgreSQL refused for weeks.
    const insert = calls.find(c => /INSERT INTO audit_log/.test(c.text))!;
    expect(insert.text).not.toMatch(/actor_organization_id/);
    expect(insert.text).not.toMatch(/resource_owner_organization_id/);
  });

  it('2 — with the org columns PRESENT the full ADR-013 shape is used', async () => {
    const { fn, calls } = fakeSql({ orgColumns: true });
    vi.mocked(getDbWithRetry).mockResolvedValue(fn as never);

    const r = await writeAuditLogDetailed({ ...ENTRY, actor_organization_id: '11111111-1111-4111-8111-111111111111' });
    expect(r.persisted).toBe(true);
    expect(r.orgContextDegraded).toBe(false);
    const insert = calls.find(c => /INSERT INTO audit_log/.test(c.text))!;
    expect(insert.text).toMatch(/actor_organization_id/);
    expect(insert.text).toMatch(/resource_owner_organization_id/);
  });

  it('3 — degraded mode PRESERVES the org ids in metadata (nothing is lost)', async () => {
    const { fn, calls } = fakeSql({ orgColumns: false });
    vi.mocked(getDbWithRetry).mockResolvedValue(fn as never);

    await writeAuditLogDetailed({
      ...ENTRY,
      actor_organization_id: '11111111-1111-4111-8111-111111111111',
      resource_owner_organization_id: '22222222-2222-4222-8222-222222222222',
    });
    const insert = calls.find(c => /INSERT INTO audit_log/.test(c.text))!;
    const meta = JSON.parse(insert.values.find(v => typeof v === 'string' && v.startsWith('{')) as string);
    expect(meta.orgContext.actor_organization_id).toBe('11111111-1111-4111-8111-111111111111');
    expect(meta.orgContext.resource_owner_organization_id).toBe('22222222-2222-4222-8222-222222222222');
    expect(meta.orgContext.degraded).toBe(true);
  });

  it('4 — the degraded state is reportable, not merely logged', async () => {
    const { fn } = fakeSql({ orgColumns: false });
    vi.mocked(getDbWithRetry).mockResolvedValue(fn as never);
    expect(auditLogOrgContextStatus().probed).toBe(false);
    await writeAuditLogDetailed(ENTRY);
    const st = auditLogOrgContextStatus();
    expect(st.probed).toBe(true);
    expect(st.orgColumnsPresent).toBe(false);
  });
});

describe('durable audit path · the reason is never discarded', () => {
  it('5 — a failed write returns WHY it failed', async () => {
    const { fn } = fakeSql({ orgColumns: true, failInsert: 'column "actor_organization_id" does not exist' });
    vi.mocked(getDbWithRetry).mockResolvedValue(fn as never);

    const r = await writeAuditLogDetailed(ENTRY);
    expect(r.persisted).toBe(false);
    expect(r.entryHash).toBeNull();
    // THE string that was thrown away for two weeks.
    expect(r.error).toMatch(/actor_organization_id/);
  });

  it('6 — an unreachable database returns its reason too', async () => {
    vi.mocked(getDbWithRetry).mockRejectedValue(new Error('DATABASE_URL is not set'));
    const r = await writeAuditLogDetailed(ENTRY);
    expect(r.persisted).toBe(false);
    expect(r.error).toMatch(/DATABASE_URL/);
  });
});

describe('durable audit path · the fallback cannot itself be defeated', () => {
  it('7 — unserialisable metadata does not throw past the fallback', async () => {
    const { fn } = fakeSql({ orgColumns: false });
    vi.mocked(getDbWithRetry).mockResolvedValue(fn as never);
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;                       // JSON.stringify throws

    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    // It must RETURN a failure, not throw: `computeEntryHash` and
    // `redactMetadata` used to run OUTSIDE the try, so a value like this escaped
    // the very fallback that exists to guarantee an event is never lost.
    const r = await writeAuditLogDetailed({ ...ENTRY, metadata: circular });
    expect(r.persisted).toBe(false);
    expect(r.error).toBeTruthy();
    // and the last-resort line still names the event
    const logged = err.mock.calls.map(c => c.join(' ')).join('\n');
    expect(logged).toMatch(/AUDIT_LOG_FALLBACK/);
    expect(logged).toMatch(/119|migration_applied/);
    err.mockRestore();
  });

  it('8 — a BigInt in metadata is survivable the same way', async () => {
    const { fn } = fakeSql({ orgColumns: false });
    vi.mocked(getDbWithRetry).mockResolvedValue(fn as never);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await writeAuditLogDetailed({ ...ENTRY, metadata: { n: BigInt(1) } as Record<string, unknown> });
    expect(r.persisted).toBe(false);
    expect(r.error).toBeTruthy();
    err.mockRestore();
  });
});
