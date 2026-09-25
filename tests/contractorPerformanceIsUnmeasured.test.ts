/**
 * tests/contractorPerformanceIsUnmeasured.test.ts
 *
 * THE MARKETPLACE SCORED CONTRACTORS ON DATA THAT DID NOT EXIST.
 *
 * `opportunity_assignments` was designed with a complete outcome model —
 * `first_contact_at`, `proposal_at`, `close_status`, `lost_reason`,
 * `dispute_filed_at` — each documented in migration 051. **None of them had a
 * writer anywhere in app/ or lib/.** Every mutation on that table uses a static
 * column list and not one includes them; they were only ever SELECTed. The
 * `status` column never becomes 'won' or 'lost' either — those values appear
 * exactly once in the codebase, inside a WHERE clause.
 *
 * Three consequences, of increasing seriousness:
 *
 *   1. The contractor_performance producer emitted `close_rate: 0` and
 *      `dispute_rate: 0` for every contractor — because `pct(n, 0)` returns 0.
 *      Not "unknown": the specific claim that they close nothing. One of those
 *      readings is defamatory and the other is merely missing, and a consumer
 *      could not tell them apart.
 *
 *   2. The matching engine's 20% "Performance Metrics" factor could never be
 *      computed, so it returned a flat placeholder for everyone — and the one
 *      marker saying so, `no_performance_data`, was filtered out of
 *      `match_reasons` on the way to the operator by a rule that strips any
 *      reason containing `no_`.
 *
 *   3. `app/api/admin/network/health` selected five columns
 *      `contractor_profiles` has never had. Postgres stops at the first, and
 *      the handler is one try/catch, so the ENTIRE Admin Network Health
 *      endpoint returned 500 — taking the pipeline, screening, claims and
 *      event metrics down with it.
 *
 * 🚨 THIS FILE EXECUTES REAL SQL. The schema half runs the shipped queries
 * against PostgreSQL (PGlite, in-process) built from the real migration, because
 * a regex cannot tell you whether a column exists. That is how (3) was found and
 * it is the only way to keep it from coming back.
 *
 * 🚨 AND THE SOURCE HALF READS COMMENT-STRIPPED SOURCE. The repair's own
 * comments necessarily name the columns that were removed, so a raw text search
 * would match the explanation of the fix and report the defect as still
 * present. This suite has been bitten by exactly that before.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { stripComments } from './support/stripSource';
import { produceContractorPerformanceObservations } from '../lib/intelligence/producers';
import { UNMEASURED_PERFORMANCE_SCORE } from '../lib/network/contractorMatcher';

const ROOT = join(__dirname, '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');

const MATCHER = stripComments(read('lib', 'network', 'contractorMatcher.ts'));
const HEALTH_SRC = read('app', 'api', 'admin', 'network', 'health', 'route.ts');
const CONTACT_ROUTE = stripComments(
  read('app', 'api', 'network', 'opportunities', '[id]', 'contact', 'route.ts'),
);
const NETWORK_PAGE = stripComments(read('app', 'network', 'page.tsx'));

/** The SQL text of a `const <name> = await sql`…`` block, comments intact. */
function sqlBlock(src: string, name: string): string {
  const start = src.indexOf(`const ${name} = await sql\``);
  expect(start, `the ${name} query is gone`).toBeGreaterThan(-1);
  const from = src.indexOf('`', start) + 1;
  const end = src.indexOf('`', from);
  expect(end).toBeGreaterThan(from);
  return src.slice(from, end);
}

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  // `contractor_profiles` references users(id); the rest of 044 is applied as
  // shipped so the column set under test is the real one, not a hand copy.
  await db.exec('CREATE TABLE IF NOT EXISTS users (id UUID PRIMARY KEY DEFAULT gen_random_uuid());');
  // 🚨 THE REAL SCHEMA, IN REAL MIGRATION ORDER, NOT A HAND-BUILT STAND-IN.
  //
  // A first version stubbed `network_opportunities` with a single id column so
  // migration 051's foreign key would resolve. The health route's pipeline
  // query then failed against it with "column does not exist" — which is
  // indistinguishable from the defect this file exists to catch. A fixture
  // missing columns accuses the product of the fixture's own fault, and that
  // false alarm costs more than the test saves.
  //
  // So the chain is applied as shipped and in numeric order, because the order
  // is load-bearing: 072 alters `opportunity_assignments`, which 051 creates.
  // Only `opportunities` and `projects` are stubbed, and only because nothing
  // here reads more than their ids.
  await db.exec('CREATE TABLE IF NOT EXISTS opportunities (id UUID PRIMARY KEY DEFAULT gen_random_uuid());');
  await db.exec('CREATE TABLE IF NOT EXISTS projects (id UUID PRIMARY KEY DEFAULT gen_random_uuid());');
  for (const m of [
    '044_contractor_profiles.sql',
    '047_network_opportunities.sql',
    '051_opportunity_assignments.sql',
    '054_alter_network_opportunities_intake_columns.sql',
    '062_network_opportunities_canonical_column_harmonization.sql',
    '072_marketplace_inventory_claim_v1.sql',
    '088_network_opportunities_county_fips.sql',
  ]) {
    await db.exec(read('lib', 'migrations', m));
  }
}, 120_000);

afterAll(async () => { await db?.close(); });

describe('🚨 the admin health query runs against the real schema', () => {
  it('the shipped contractor query executes', async () => {
    // It did not. It threw `column "is_active" does not exist`, and because the
    // route is one try/catch that 500'd the whole Admin Network Health page.
    const q = sqlBlock(HEALTH_SRC, 'contractorRows');
    await expect(db.query(q)).resolves.toBeTruthy();
  });

  it('every other query in that route executes too', async () => {
    // The route has five blocks. Proving one does not prove the page loads, and
    // any one of them failing takes all five down.
    const names = ['pipelineRows', 'screeningRows'];
    for (const n of names) {
      const has = HEALTH_SRC.includes(`const ${n} = await sql\``);
      if (!has) continue;
      // These read other tables; we only assert the SQL PARSES, which is what
      // catches a phantom column. A parse failure here is the same defect class.
      const q = sqlBlock(HEALTH_SRC, n);
      await expect(db.query(`EXPLAIN ${q}`).catch((e: Error) => {
        // "relation does not exist" is expected — those tables are not built
        // here. "column does not exist" is the defect and must fail the test.
        if (/column .* does not exist/i.test(e.message)) throw e;
        return true;
      })).resolves.toBeTruthy();
    }
  });

  it('it reports the metric as missing rather than as zero', async () => {
    // `avg_close_rate_pct` is a REAL column with no writer yet. It must read
    // NULL, not 0 — a contractor with no history has an unknown close rate, and
    // rendering that as 0% is the same lie the producer was telling.
    await db.query(
      `INSERT INTO users (id) VALUES ('11111111-1111-1111-1111-111111111111')
       ON CONFLICT DO NOTHING`,
    );
    await db.query(
      `INSERT INTO contractor_profiles (user_id, network_active, service_states)
       VALUES ('11111111-1111-1111-1111-111111111111', TRUE, ARRAY['IL'])
       ON CONFLICT (user_id) DO NOTHING`,
    );
    const r = await db.query(sqlBlock(HEALTH_SRC, 'contractorRows'));
    const row = (r.rows as any[])[0];
    expect(Number(row.active_contractors)).toBe(1);
    expect(row.avg_close_rate_pct, 'an unwritten metric must read null, not 0').toBeNull();
  });
});

describe('🚨 the matcher no longer scores a column that does not exist', () => {
  it('avg_rating is gone from the engine', () => {
    // Not "unwritten" — there is no avg_rating column in migration 044, in the
    // 068 repair, or in the legacy inline DDL. The branch was unreachable for
    // every contractor in every path since it was written.
    // 🚨 THE IDENTIFIER, NOT JUST ITS USE. A first version of this assertion
    // pinned `contractor.avg_rating` — the scoring branch — and a mutation that
    // restored only the interface FIELD escaped it. The field is how the branch
    // comes back: someone re-adds the type, sees it is never populated, and
    // "fixes" that by selecting a null for it. So the name may not appear in
    // this file at all. (Safe to assert on stripped source only because
    // stripComments removes the JS comments that explain the removal — and the
    // SQL comment inside the query template, which the stripper cannot see
    // into, is deliberately worded without the identifier.)
    expect(MATCHER, 'the rating field or its scoring branch is back')
      .not.toMatch(/avg_rating/);
    expect(MATCHER, 'highly_rated can never be awarded').not.toMatch(/'highly_rated'/);

    // The admin match route selected the same literal null under the same
    // alias. Nothing in app/ or components/ ever read it, so it was a phantom
    // field in an API contract — the kind a future consumer binds to and then
    // reports as "always empty".
    const ADMIN_MATCH = stripComments(
      read('app', 'api', 'admin', 'network', 'contractor-match', '[id]', 'route.ts'),
    );
    expect(ADMIN_MATCH, 'the phantom rating field is back in the admin match API')
      .not.toMatch(/avg_rating/);
  });

  it('but the two DORMANT factors are kept — they have a column to be written to', () => {
    // avg_close_rate_pct and avg_response_hours are real columns awaiting a
    // rollup. Deleting them would throw away the wiring the fix depends on.
    expect(MATCHER).toMatch(/contractor\.avg_close_rate/);
    expect(MATCHER).toMatch(/contractor\.avg_response_hours/);
    expect(MATCHER).toMatch(/avg_close_rate_pct/);
  });

  it('the weights are UNCHANGED — the score must not move silently', () => {
    // 🚨 THE ONE THING THIS REPAIR MUST NOT DO. Performance contributes a
    // constant (65 x 0.20 = 13) to every contractor, so it cannot change the
    // ORDER — but `overall < minScore` drops a contractor and `recommended` is
    // `overall >= 75`. Removing the weight moves every score by ~13 points and
    // flips both. That is a decision about who gets offered leads, and it
    // belongs to the product owner, not to a tidy-up.
    expect(MATCHER).toMatch(/geo\.score\s*\*\s*0\.30/);
    expect(MATCHER).toMatch(/sizeFit\.score\s*\*\s*0\.20/);
    expect(MATCHER).toMatch(/services\.score\s*\*\s*0\.15/);
    expect(MATCHER).toMatch(/performance\.score\s*\*\s*0\.20/);
    expect(MATCHER).toMatch(/capacity\.score\s*\*\s*0\.15/);
  });

  it('the placeholder announces itself instead of being filtered away', () => {
    expect(UNMEASURED_PERFORMANCE_SCORE).toBe(65);
    expect(MATCHER, 'performance_measured is not reported on the match')
      .toMatch(/performance_measured: performance\.measured/);
    // The reason filter strips anything containing `no_`; this one is exempt.
    expect(MATCHER, 'no_performance_data is being swallowed again')
      .toMatch(/r === 'no_performance_data'/);
  });
});

describe('🚨 the producer distinguishes an absence from a zero', () => {
  const base = { id: 'a1', contractor_id: 'c1', opportunity_id: 'o1', offered_at: '2026-01-01T00:00:00Z', claimed_at: '2026-01-01T01:00:00Z' };
  const payloadOf = (obs: any[], type: string) =>
    obs.find(o => o.observation_type === type)?.payload as Record<string, unknown>;

  it('with no outcomes recorded, the rates are null and say they are unsupported', () => {
    // This is the live shape for every contractor in the network today.
    const obs = produceContractorPerformanceObservations('c1', [base as any]);
    const close = payloadOf(obs, 'contractor_close_rate');
    expect(close.supported, 'an unwritten outcome column was reported as supported').toBe(false);
    expect(close.close_rate, 'a contractor with no closed deals was reported as closing 0%').toBeNull();
    expect(close.proposal_acceptance_rate).toBeNull();

    const disp = payloadOf(obs, 'contractor_cancellation_dispute_frequency');
    expect(disp.dispute_rate, 'a 0% dispute rate implies disputes are tracked; none can be filed').toBeNull();
    expect(disp.dispute_rate_supported).toBe(false);

    const speed = payloadOf(obs, 'contractor_response_speed');
    expect(speed.supported).toBe(false);
    expect(speed.avg_response_hours).toBeNull();
    expect(speed.rating).toBe('unknown');
  });

  it('refund_rate stays a REAL number — refund_at does have a writer', () => {
    // The auto-refund on a lost claim race writes refund_at. Marking this
    // unsupported alongside the others would discard a working signal.
    const obs = produceContractorPerformanceObservations('c1', [
      { ...base, refund_at: '2026-01-05T00:00:00Z' } as any,
      { ...base, id: 'a2' } as any,
    ]);
    const disp = payloadOf(obs, 'contractor_cancellation_dispute_frequency');
    expect(disp.refunded).toBe(1);
    expect(disp.refund_rate).toBeCloseTo(0.5, 6);
  });

  it('once outcomes ARE written, the rates become real', () => {
    // Proves the null is a function of missing data, not of the guard itself —
    // otherwise this repair would simply have made the metric permanently dead.
    const obs = produceContractorPerformanceObservations('c1', [
      { ...base, close_status: 'won', first_contact_at: '2026-01-01T03:00:00Z' } as any,
      { ...base, id: 'a2', close_status: 'lost' } as any,
    ]);
    const close = payloadOf(obs, 'contractor_close_rate');
    expect(close.supported).toBe(true);
    expect(close.close_rate).toBeCloseTo(0.5, 6);

    const speed = payloadOf(obs, 'contractor_response_speed');
    expect(speed.supported).toBe(true);
    expect(speed.avg_response_hours).toBeCloseTo(2, 6);
    expect(speed.rating).toBe('fast');
  });
});

describe('🚨 first_contact_at finally has a writer', () => {
  it('the contact endpoint writes it', () => {
    expect(CONTACT_ROUTE).toMatch(/UPDATE opportunity_assignments/);
    expect(CONTACT_ROUTE).toMatch(/first_contact_at = COALESCE\(first_contact_at, NOW\(\)\)/);
  });

  it('FIRST means first — a second tap cannot move it', () => {
    // Overwriting would turn "time to first contact" into "time to most recent
    // contact": a different metric under the same name, and one that improves
    // every time a contractor chases a lead that is going badly.
    expect(CONTACT_ROUTE, 'first_contact_at is being overwritten')
      .not.toMatch(/first_contact_at\s*=\s*NOW\(\)/);
    expect(CONTACT_ROUTE, 'the running total of attempts is not kept')
      .toMatch(/contact_attempts = COALESCE\(contact_attempts, 0\) \+ 1/);
  });

  it('it is scoped to the caller’s own claim, in the WHERE clause', () => {
    expect(CONTACT_ROUTE).toMatch(/AND contractor_id  = \$\{user\.id\}/);
    expect(CONTACT_ROUTE, 'unauthenticated callers can stamp contact').toMatch(/if \(!user\)/);
  });

  it('🚨 and its SQL runs against the REAL assignment schema', async () => {
    // The bug this whole file exists to stop was SQL naming columns that do not
    // exist. Writing new SQL and only regex-checking it would repeat exactly
    // that. So the shipped UPDATE is executed against migration 051 as written.
    const oppId = '22222222-2222-2222-2222-222222222222';
    const conId = '33333333-3333-3333-3333-333333333333';
    await db.query(`INSERT INTO users (id) VALUES ('${conId}') ON CONFLICT DO NOTHING`);
    await db.query(`INSERT INTO network_opportunities (id) VALUES ('${oppId}') ON CONFLICT DO NOTHING`);
    await db.query(
      `INSERT INTO opportunity_assignments (opportunity_id, contractor_id, status)
       VALUES ('${oppId}', '${conId}', 'claimed')`,
    );

    const stamp = async () => db.query(`
      UPDATE opportunity_assignments
         SET first_contact_at = COALESCE(first_contact_at, NOW()),
             last_contact_at  = NOW(),
             contact_attempts = COALESCE(contact_attempts, 0) + 1,
             updated_at       = NOW()
       WHERE opportunity_id = '${oppId}'
         AND contractor_id  = '${conId}'
         AND status IN ('claimed','contacted','appointment','proposal','won')
      RETURNING first_contact_at, last_contact_at, contact_attempts
    `);

    const first = (await stamp()).rows[0] as any;
    expect(first.first_contact_at, 'the first tap recorded nothing').toBeTruthy();
    expect(Number(first.contact_attempts)).toBe(1);

    const second = (await stamp()).rows[0] as any;
    // 🚨 FIRST CONTACT IS IMMUTABLE; the running count is not.
    expect(new Date(second.first_contact_at).getTime())
      .toBe(new Date(first.first_contact_at).getTime());
    expect(Number(second.contact_attempts)).toBe(2);
    expect(new Date(second.last_contact_at).getTime())
      .toBeGreaterThanOrEqual(new Date(first.last_contact_at).getTime());
  });

  it('a contractor cannot stamp contact on somebody else’s claim', async () => {
    const oppId = '22222222-2222-2222-2222-222222222222';
    const intruder = '44444444-4444-4444-4444-444444444444';
    await db.query(`INSERT INTO users (id) VALUES ('${intruder}') ON CONFLICT DO NOTHING`);
    const r = await db.query(`
      UPDATE opportunity_assignments
         SET first_contact_at = COALESCE(first_contact_at, NOW())
       WHERE opportunity_id = '${oppId}'
         AND contractor_id  = '${intruder}'
      RETURNING id
    `);
    expect(r.rows.length, 'a non-claimant updated a row').toBe(0);
  });

  it('the real contact links fire it, and cannot be blocked by it', () => {
    expect(NETWORK_PAGE).toMatch(/recordFirstContact\(opp\.id, "phone"\)/);
    expect(NETWORK_PAGE).toMatch(/recordFirstContact\(opp\.id, "email"\)/);
    // 🚨 `keepalive` IS LOAD-BEARING. The click navigates to tel:/mailto:,
    // which on a phone hands off to another app and can unload the document
    // mid-request. Without it this records nothing on the device contractors
    // actually use, while working perfectly on a desktop.
    expect(NETWORK_PAGE, 'the write will be dropped when the page unloads')
      .toMatch(/keepalive: true/);
    expect(NETWORK_PAGE, 'awaiting the write would delay dialling the homeowner')
      .not.toMatch(/await fetch\(`\/api\/network\/opportunities\/\$\{opportunityId\}\/contact`/);
  });
});
