/**
 * tests/surveyWebhookDeliverySemantics.postgres.test.ts
 *
 * A FAILED DELIVERY MUST NOT CONSUME THE SURVEY EVENT.
 *
 * POST /api/webhooks/survey-complete logs every delivery and dedupes on
 * event_id. The duplicate check used to match ANY row with that event_id — so
 * a delivery that failed the HMAC check (wrong secret, clock skew) or the
 * envelope validation was logged under the event's id, the correctly signed
 * retry got 200 "duplicate", the app backend marked it delivered, and the
 * survey was never ingested.
 *
 * Drives the REAL route with REAL HMAC signing against REAL PostgreSQL
 * (PGlite) using the webhook_deliveries DDL from migrations 011 + 014 (the
 * partial unique index on signature-valid rows). The ingest pipeline is
 * replaced by a recorder that writes the row's outcome the way the real one
 * does ('ingested' / 'failed'), so what is asserted is the delivery
 * semantics, not ingestion.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHmac, randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

let db: PGlite;

function neonShim(pg: PGlite) {
  const run = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = '';
    const params: unknown[] = [];
    strings.forEach((s, i) => {
      text += s;
      if (i < values.length) { params.push(values[i]); text += `$${params.length}`; }
    });
    const r = await pg.query(text, params);
    return r.rows;
  };
  return run as unknown as ReturnType<typeof import('@neondatabase/serverless').neon>;
}

const SECRET = 'test-webhook-secret-0123456789abcdef0123456789';

const ingest = vi.hoisted(() => ({
  calls: [] as string[],
  outcome: 'ingested' as 'ingested' | 'failed',
}));

vi.mock('@/lib/db-neon', () => ({
  getDbReady: async () => neonShim(db),
  isValidUUID: (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
  handleRouteDbError: (_t: string, err: unknown) =>
    new Response(JSON.stringify({ success: false, error: String((err as Error)?.message ?? err) }),
      { status: 503, headers: { 'content-type': 'application/json' } }),
}));
vi.mock('@/lib/survey/ingest/ownerResolver', () => ({
  resolveIngestOwner: async () => ({ ownerId: '11111111-1111-4111-8111-111111111111', ownerSource: 'test' }),
}));
vi.mock('@/lib/survey/ingest/ingestPipeline', () => ({
  runIngestPipeline: async (ctx: { deliveryId: string }) => {
    ingest.calls.push(ctx.deliveryId);
    const sql = neonShim(db);
    if (ingest.outcome === 'ingested') {
      await sql`UPDATE webhook_deliveries SET status = 'ingested', processed_at = now() WHERE id = ${ctx.deliveryId}`;
      return { status: 'ingested', projectId: 'p1', created: false, transformSummary: {} };
    }
    await sql`UPDATE webhook_deliveries SET status = 'failed', error_message = 'boom', processed_at = now() WHERE id = ${ctx.deliveryId}`;
    return { status: 'failed', error: 'boom', code: 'TEST' };
  },
}));

vi.mock('@/lib/adminAuth', () => ({
  requireAdminApi: async () => ({ id: 'admin-1', name: 'A', email: 'a@x.test', role: 'admin' }),
}));
vi.mock('@/lib/rateLimiter', () => ({
  checkRateLimit: async () => ({ allowed: true }),
  getClientIp: () => '127.0.0.1',
}));

const { POST } = await import('@/app/api/webhooks/survey-complete/route');
const { POST: REPLAY } = await import('@/app/api/admin/survey-webhook-log/[id]/replay/route');

const DDL_011 = readFileSync(join(process.cwd(), 'migrations', '011_survey_ingest.sql'), 'utf8');
const DDL_014 = readFileSync(join(process.cwd(), 'migrations', '014_webhook_delivery_idempotency.sql'), 'utf8');

function envelope(eventId: string, over: Record<string, unknown> = {}) {
  return {
    event: 'survey.completed', event_id: eventId, occurred_at: new Date().toISOString(),
    survey_id: 'survey-1', status: 'submitted', completed_at: new Date().toISOString(),
    ...over,
  };
}

function deliver(body: unknown, opts: { secret?: string; eventId?: string; ts?: number } = {}) {
  const raw = JSON.stringify(body);
  const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
  const sig = createHmac('sha256', opts.secret ?? SECRET).update(`${ts}.${raw}`).digest('hex');
  return POST(new Request('http://localhost/api/webhooks/survey-complete', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-survey-signature': `sha256=${sig}`,
      'x-survey-timestamp': ts,
      ...(opts.eventId ? { 'x-survey-event-id': opts.eventId } : {}),
    },
    body: raw,
  }) as never);
}

async function rows(eventId: string) {
  return (await db.query<{ id: string; status: string; signature_valid: boolean }>(
    `SELECT id, status, signature_valid FROM webhook_deliveries WHERE event_id = $1 ORDER BY received_at`, [eventId])).rows;
}

beforeAll(async () => {
  db = await PGlite.create();
  // 011 also alters projects / project_files; give it the two tables it extends.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS projects (id VARCHAR(36) PRIMARY KEY, user_id VARCHAR(36));
    CREATE TABLE IF NOT EXISTS project_files (id VARCHAR(36) PRIMARY KEY, project_id VARCHAR(36));
  `);
  await db.exec(DDL_011.replace(/CREATE EXTENSION[^;]*;/g, ''));
  await db.exec(DDL_014);
  vi.stubEnv('SURVEY_WEBHOOK_SECRET', SECRET);
});
afterAll(async () => { vi.unstubAllEnvs(); await db?.close(); });
beforeEach(async () => {
  await db.exec('DELETE FROM webhook_deliveries');
  ingest.calls = [];
  ingest.outcome = 'ingested';
});

describe('the fixture is the real schema', () => {
  it('migration 014 put the partial unique index on signature-valid rows', async () => {
    const r = await db.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_webhook_deliveries_valid_event_unique'`);
    expect(r.rows[0]?.indexdef).toMatch(/WHERE \(?signature_valid = true\)?/i);
  });
});

describe('🚨 a failed attempt does not consume the event', () => {
  it('a BAD SIGNATURE (wrong secret) → 401; the correctly signed retry is processed', async () => {
    const id = randomUUID();
    const bad = await deliver(envelope(id), { secret: 'the-wrong-secret-xxxxxxxxxxxxxxxxxxxxx', eventId: id });
    expect(bad.status).toBe(401);

    const good = await deliver(envelope(id), { eventId: id });
    expect(good.status).toBe(202);
    const body = await good.json();
    expect(body.duplicate).toBeUndefined();
    expect(ingest.calls).toHaveLength(1);
    expect((await rows(id)).map(r => [r.signature_valid, r.status])).toEqual([[false, 'failed'], [true, 'ingested']]);
  });

  it('a STALE TIMESTAMP (clock skew) → 401; the retry is processed', async () => {
    const id = randomUUID();
    const skewed = await deliver(envelope(id), { eventId: id, ts: Math.floor(Date.now() / 1000) - 3600 });
    expect(skewed.status).toBe(401);
    expect((await deliver(envelope(id), { eventId: id })).status).toBe(202);
    expect(ingest.calls).toHaveLength(1);
  });

  it('a signed but INVALID ENVELOPE → 400; the corrected retry is processed', async () => {
    const id = randomUUID();
    const invalid = await deliver({ ...envelope(id), survey_id: '' }, { eventId: id });
    expect(invalid.status).toBe(400);
    const good = await deliver(envelope(id), { eventId: id });
    expect(good.status).toBe(202);
    expect(ingest.calls).toHaveLength(1);
    // Migration 014 allows ONE signature-valid row: the retry took the failed one over.
    const valid = (await rows(id)).filter(r => r.signature_valid);
    expect(valid).toHaveLength(1);
    expect(valid[0].status).toBe('ingested');
  });

  it('an INGEST FAILURE → the signed retry reprocesses the SAME row', async () => {
    const id = randomUUID();
    ingest.outcome = 'failed';
    expect((await deliver(envelope(id), { eventId: id })).status).toBe(202);
    ingest.outcome = 'ingested';
    const retry = await deliver(envelope(id), { eventId: id });
    expect((await retry.json()).duplicate).toBeUndefined();
    expect(ingest.calls).toHaveLength(2);
    expect(ingest.calls[0]).toBe(ingest.calls[1]);   // same delivery row, re-claimed
    expect((await rows(id)).map(r => r.status)).toEqual(['ingested']);
  });
});

describe('🚨 true duplicates are still stopped', () => {
  it('after a successful ingest, a retry is a 200 duplicate and is NOT reprocessed', async () => {
    const id = randomUUID();
    expect((await deliver(envelope(id), { eventId: id })).status).toBe(202);
    const dup = await deliver(envelope(id), { eventId: id });
    expect(dup.status).toBe(200);
    expect((await dup.json()).duplicate).toBe(true);
    expect(ingest.calls).toHaveLength(1);
  });

  it('a delivery still in flight is a duplicate, not a second ingest', async () => {
    const id = randomUUID();
    await db.query(`INSERT INTO webhook_deliveries (source, event_type, event_id, signature_valid, status, processed_at)
                    VALUES ('survey', 'survey.completed', $1, true, 'verified', now())`, [id]);
    const dup = await deliver(envelope(id), { eventId: id });
    expect(dup.status).toBe(200);
    expect(ingest.calls).toHaveLength(0);
  });

  it('a delivery ABANDONED mid-flight (stale verified) is taken over', async () => {
    const id = randomUUID();
    await db.query(`INSERT INTO webhook_deliveries (source, event_type, event_id, signature_valid, status, processed_at)
                    VALUES ('survey', 'survey.completed', $1, true, 'verified', now() - interval '1 hour')`, [id]);
    expect((await deliver(envelope(id), { eventId: id })).status).toBe(202);
    expect(ingest.calls).toHaveLength(1);
  });

  it('two concurrent signed deliveries of one event ingest ONCE', async () => {
    const id = randomUUID();
    const [a, b] = await Promise.all([deliver(envelope(id), { eventId: id }), deliver(envelope(id), { eventId: id })]);
    expect([a.status, b.status].sort()).toEqual([200, 202]);
    expect(ingest.calls).toHaveLength(1);
  });

  it('a bad-signature delivery AFTER ingestion does not disturb the ingested row', async () => {
    const id = randomUUID();
    expect((await deliver(envelope(id), { eventId: id })).status).toBe(202);
    expect((await deliver(envelope(id), { secret: 'nope-nope-nope-nope-nope-nope-nope-nope', eventId: id })).status).toBe(401);
    expect((await rows(id)).filter(r => r.signature_valid).map(r => r.status)).toEqual(['ingested']);
  });
});

describe('🚨 the admin replay only replays signed deliveries', () => {
  async function replay(deliveryId: string) {
    return REPLAY(new Request(`http://localhost/api/admin/survey-webhook-log/${deliveryId}/replay`, { method: 'POST' }) as never,
      { params: Promise.resolve({ id: deliveryId }) });
  }

  it('an UNSIGNED delivery (body written by whoever sent it) is refused, nothing ingested', async () => {
    const id = randomUUID();
    const forged = envelope(id, { solarpro_user_id: 'someone-elses-user' });
    expect((await deliver(forged, { secret: 'attacker-does-not-know-the-secret-xxxxxx', eventId: id })).status).toBe(401);
    const row = (await rows(id))[0];
    expect(row.signature_valid).toBe(false);
    const res = await replay(row.id);
    expect(res.status).toBe(422);
    expect(ingest.calls).toHaveLength(0);
  });

  it('a signed delivery that failed ingest can still be replayed', async () => {
    const id = randomUUID();
    ingest.outcome = 'failed';
    await deliver(envelope(id), { eventId: id });
    ingest.outcome = 'ingested';
    const row = (await rows(id))[0];
    const res = await replay(row.id);
    expect(res.status).toBeLessThan(300);
    expect(ingest.calls).toHaveLength(2);
  });
});
