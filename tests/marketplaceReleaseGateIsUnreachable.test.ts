/**
 * tests/marketplaceReleaseGateIsUnreachable.test.ts
 *
 * NO LEAD COULD EVER REACH THE CONTRACTOR MARKETPLACE, BY ANY PATH.
 *
 * `network_opportunities` carries TWO disjoint column vocabularies. The
 * CANONICAL one is what the governed migration chain in `lib/migrations/`
 * (047 + 054 + 062 + 072 + 088 + 089) builds, and therefore what the live table
 * has: `location_city`, `location_state`, `location_zip`, `homeowner_name`,
 * `monthly_bill_amount`, `utility_provider`, `duplicate_flag`, `square_feet`,
 * `asking_price`, `intake_metadata`.
 *
 * A LEGACY vocabulary — `state`, `city`, `listing_price`, `consent_given`,
 * `is_duplicate_flagged`, `square_feet_living`, `property_type`,
 * `homeowner_first_name` — exists ONLY inside the secret-gated inline DDL at
 * `app/api/migrate/route.ts`, and in NO migration file. `lib/migrations/manifest.ts`
 * states the legacy `migrations/` directory is not scanned. So every one of those
 * names is a phantom: SQL naming it fails with Postgres 42703 on the live schema.
 *
 * Five places spoke the phantom vocabulary, and together they closed the
 * marketplace end to end:
 *
 *   F1. The admin Approve / Release-to-Marketplace writer UPDATEd `listing_price`
 *       and 500'd before writing anything. It is the ONLY production writer of
 *       the marketplace visibility gate, so the manual release path was shut.
 *       It also awaited `scoreAndPersistOpportunity` BEFORE the release write, so
 *       any scoring or enrichment failure vetoed the release as well.
 *
 *   F2. The screening queue SELECT read `no.state` / `no.city` and 500'd — and
 *       the admin UI renders a 500 as "Queue is empty". An operational backlog
 *       looked exactly like a clean desk, which is worse than an error, because
 *       nobody investigates a clean desk.
 *
 *   F3. The 10-step screening pipeline read `state` while intake wrote
 *       `location_state`, so step 3 (address) and step 4 (service area) failed
 *       for EVERY lead — grade F, "invalid_address, outside_service_area" — on a
 *       perfect Illinois address. `auto_decision = 'pass'` is one of only two
 *       ways to open the marketplace gate, and F1 was the other one.
 *
 *   F4. Both paid-acquisition INSERTs named phantom columns AND a `status` value
 *       the CHECK constraint forbids ('new' is not in the enum). Every Google
 *       Ads / Meta / partner-webhook lead was accepted, logged as an intake
 *       event, and produced no opportunity row. The only trace was a
 *       console.warn that blamed "a pending migration 089" — which has in fact
 *       shipped (`lib/migrations/089_intake_idempotency_key.sql`), so the
 *       message actively misdirected whoever read it.
 *
 *   F5. Two Screening Queue counters read `stats.pending_screening` /
 *       `stats.running_screening`; the endpoint emitted `pending` / `running`.
 *       Two tiles showed a bold 0 forever beside three that showed real numbers.
 *
 * 🚨 THIS FILE EXECUTES REAL SQL AGAINST REAL POSTGRES. The migration chain is
 * applied as shipped, in numeric order, into PGlite (in-process, no credential),
 * and the REAL route handlers and REAL pipeline functions run against it through
 * a Neon-shaped tagged-template adapter. A regex cannot tell you whether a column
 * exists; only Postgres can. Every assertion below except the two explicitly
 * labelled SOURCE SCAN is behavioural.
 *
 * 🚨 AND THE FIXTURE IS THE REAL CHAIN, NOT A HAND COPY. A fixture missing a
 * column accuses the product of the fixture's own fault, and that false alarm
 * costs more than the test saves.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { stripComments } from './support/stripSource';

const ROOT = join(__dirname, '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');

// ── Mocks: ONLY the collaborators that are not the subject ──────────────────
// Everything that touches network_opportunities stays REAL, because the whole
// point is to run the shipped SQL against the shipped schema.
const mockRequireAdminApi = vi.fn();
const mockLogNetworkEvent = vi.fn();
let enrichmentShouldThrow = false;

vi.mock('@/lib/adminAuth', () => ({ requireAdminApi: mockRequireAdminApi }));
vi.mock('@/lib/rateLimitGuard', () => ({
  rateLimitGuard: async () => ({ blocked: false, response: null }),
}));
vi.mock('@/lib/network/attributionTracker', () => ({
  logNetworkEvent: mockLogNetworkEvent,
}));
vi.mock('@/lib/db-neon', () => ({ getDbReady: async () => sqlTag }));
// Kept REAL, but with a switch so a FAILING scorer/enricher can be proven unable
// to veto the release write (F1's second half).
vi.mock('@/lib/network/opportunityEnrichment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/network/opportunityEnrichment')>();
  return {
    ...actual,
    enrichAndPersistOpportunity: async (...args: Parameters<typeof actual.enrichAndPersistOpportunity>) => {
      if (enrichmentShouldThrow) throw new Error('simulated enrichment outage');
      return actual.enrichAndPersistOpportunity(...args);
    },
  };
});

// ── The Neon-shaped adapter over real Postgres ─────────────────────────────
// The @neondatabase/serverless driver is a tagged template that parameterizes
// every interpolation. This reproduces that contract exactly, so the SQL TEXT
// the product ships is the SQL text Postgres parses — which is the only way a
// phantom column can still be caught.
let db: PGlite;

function toParam(value: unknown): unknown {
  if (value === undefined) return null;
  if (Array.isArray(value)) {
    // The driver serializes a JS array to a Postgres array literal.
    return `{${value.map((v) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`;
  }
  return value;
}

async function sqlTag(strings: TemplateStringsArray, ...values: unknown[]) {
  let text = '';
  strings.forEach((chunk, i) => {
    text += chunk;
    if (i < values.length) text += `$${i + 1}`;
  });
  const res = await db.query(text, values.map(toParam));
  return res.rows as Array<Record<string, unknown>>;
}

/** Direct, unparameterized access for fixture setup and for reading rows back. */
const q = async (text: string) => (await db.query(text)).rows as any[];

const ADMIN_ID = '11111111-1111-1111-1111-111111111111';
const CONTRACTOR_ID = '22222222-2222-2222-2222-222222222222';

beforeAll(async () => {
  db = new PGlite();
  // Only `users`, `opportunities` and `projects` are stubbed, and only because
  // nothing here reads more than their ids.
  await db.exec('CREATE TABLE IF NOT EXISTS users (id UUID PRIMARY KEY DEFAULT gen_random_uuid());');
  await db.exec('CREATE TABLE IF NOT EXISTS opportunities (id UUID PRIMARY KEY DEFAULT gen_random_uuid());');
  await db.exec('CREATE TABLE IF NOT EXISTS projects (id UUID PRIMARY KEY DEFAULT gen_random_uuid());');
  // 🚨 THE GOVERNED CHAIN, AS SHIPPED, IN NUMERIC ORDER. The order is
  // load-bearing: 063 repairs the queue 049 creates, 072 alters the opportunity
  // 047 creates, 089 adds the idempotency key the intake INSERT conflicts on.
  for (const m of [
    '044_contractor_profiles.sql',
    '047_network_opportunities.sql',
    '048_opportunity_sources.sql',
    '049_opportunity_screening_queue.sql',
    '050_opportunity_intelligence.sql',
    '051_opportunity_assignments.sql',
    '054_alter_network_opportunities_intake_columns.sql',
    '055_intake_events.sql',
    '062_network_opportunities_canonical_column_harmonization.sql',
    '063_opportunity_screening_queue_repair.sql',
    '064_opportunity_intelligence_repair.sql',
    '066_intake_events_repair.sql',
    '069_opportunity_sources_repair.sql',
    '070_opportunity_intelligence_enrichment.sql',
    '072_marketplace_inventory_claim_v1.sql',
    '088_network_opportunities_county_fips.sql',
    '089_intake_idempotency_key.sql',
  ]) {
    await db.exec(read('lib', 'migrations', m));
  }

  await q(`INSERT INTO users (id) VALUES ('${ADMIN_ID}'), ('${CONTRACTOR_ID}') ON CONFLICT DO NOTHING`);
  await q(`INSERT INTO contractor_profiles (user_id, network_active, service_states)
           VALUES ('${CONTRACTOR_ID}', TRUE, ARRAY['IL'])
           ON CONFLICT (user_id) DO NOTHING`);
}, 180_000);

afterAll(async () => { await db?.close(); });

beforeEach(() => {
  enrichmentShouldThrow = false;
  mockRequireAdminApi.mockReset().mockResolvedValue({ id: ADMIN_ID, role: 'admin' });
  mockLogNetworkEvent.mockReset().mockResolvedValue(undefined);
});

/** A canonical, perfectly-qualified Illinois lead. Canonical columns only. */
async function insertCanonicalLead(tag: string): Promise<string> {
  const rows = await q(`
    INSERT INTO network_opportunities (
      source_type, status,
      homeowner_name, homeowner_email, homeowner_phone,
      first_name, last_name, email, phone,
      address, address_line1,
      location_city, location_state, location_zip, zip,
      monthly_bill_amount, utility_provider,
      roof_age_years, structure_type, source_channel
    ) VALUES (
      'google_ads', 'intake',
      'Dana ${tag}', 'dana.${tag}@example.test', '+1312555${tag}',
      'Dana', '${tag}', 'dana.${tag}@example.test', '+1312555${tag}',
      '${tag} West Madison Drive', '${tag} West Madison Drive',
      'Chicago', 'IL', '60601', '60601',
      265.00, 'ComEd',
      8, 'single_family', 'paid_search'
    ) RETURNING id
  `);
  return rows[0].id as string;
}

const patchReq = (body: unknown) =>
  new Request('https://solarpro.test/api/admin/network/screening', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: 'solarpro_session=test' },
    body: JSON.stringify(body),
  }) as any;

const getReq = (qs = '?limit=15') =>
  new Request(`https://solarpro.test/api/admin/network/screening${qs}`, {
    headers: { cookie: 'solarpro_session=test' },
  }) as any;

// ════════════════════════════════════════════════════════════════════════════
// F1 — the only production writer of the marketplace visibility gate
// ════════════════════════════════════════════════════════════════════════════
describe('🚨 F1 — admin Approve reaches the database instead of 500ing', () => {
  it('Approve returns 200 and actually flips the gate', async () => {
    // It returned 500. `listing_price` is a phantom column, so the UPDATE threw
    // 42703 and the handler's single try/catch swallowed it — BEFORE the
    // screening_status / status writes further down. Nothing was written at all.
    const oppId = await insertCanonicalLead('1001');
    const { PATCH } = await import('@/app/api/admin/network/screening/route');

    const res = await PATCH(patchReq({ opportunity_id: oppId, action: 'approve' }));
    expect(res.status, 'Approve still 500s — nothing can be released').toBe(200);

    const [row] = await q(
      `SELECT screening_status, status, asking_price, opportunity_score, opportunity_grade
         FROM network_opportunities WHERE id = '${oppId}'`,
    );
    expect(row.screening_status).toBe('approved');
    expect(row.status).toBe('scored');
    // asking_price is the column EVERY reader uses — /marketplace aliases it as
    // `no.asking_price AS listing_price`, so the phantom write was never even
    // the source of the number anybody saw.
    expect(row.asking_price, 'the price the marketplace reads was never written').not.toBeNull();
    expect(Number(row.opportunity_score)).toBeGreaterThan(0);
  });

  it('a scoring/enrichment failure cannot veto the release write', async () => {
    // The release write used to sit BEHIND `await scoreAndPersistOpportunity`.
    // An enrichment outage therefore had the same effect as a refusal: the
    // operator's decision was discarded and the lead stayed invisible.
    const oppId = await insertCanonicalLead('1002');
    await q(`INSERT INTO opportunity_screening_queue (opportunity_id, pipeline_status, auto_decision)
             VALUES ('${oppId}', 'completed', 'needs_review')`);
    enrichmentShouldThrow = true;
    const { PATCH } = await import('@/app/api/admin/network/screening/route');

    const res = await PATCH(patchReq({ opportunity_id: oppId, action: 'approve' }));
    expect(res.status, 'a scoring outage still vetoes the operator').toBe(200);

    const [row] = await q(
      `SELECT screening_status, status FROM network_opportunities WHERE id = '${oppId}'`,
    );
    expect(row.screening_status, 'the approval was lost to a scoring failure').toBe('approved');
    expect(row.status).toBe('scored');

    const [queued] = await q(
      `SELECT override_decision FROM opportunity_screening_queue WHERE opportunity_id = '${oppId}'`,
    );
    expect(queued?.override_decision).toBe('pass');
  });

  it('the release still reports WHY the score is missing when scoring failed', async () => {
    // Surviving a scoring failure must not mean pretending it did not happen —
    // that would be the "0 means unknown" lie in a new costume.
    const oppId = await insertCanonicalLead('1003');
    enrichmentShouldThrow = true;
    const { PATCH } = await import('@/app/api/admin/network/screening/route');
    const res = await PATCH(patchReq({ opportunity_id: oppId, action: 'approve' }));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.scoring_error, 'the swallowed scoring failure is invisible to the operator')
      .toBeTruthy();
  });

  it('SOURCE SCAN: the phantom price column is gone from the writer', () => {
    // Stated plainly: this one assertion is a source scan, because "no column
    // named listing_price is written" is a claim about absence and Postgres can
    // only demonstrate presence. Comments are stripped first — the repair's own
    // comment necessarily names the column it removed, and a raw text search
    // would match that explanation and report the defect as still present.
    const SRC = stripComments(read('app', 'api', 'admin', 'network', 'screening', 'route.ts'));
    expect(SRC, 'the phantom price column is back in the writer').not.toMatch(/listing_price/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// F2 — the queue SELECT, and the empty-desk illusion
// ════════════════════════════════════════════════════════════════════════════
describe('🚨 F2 — the screening queue lists rows instead of 500ing', () => {
  it('GET returns the queue with the response keys the admin UI binds to', async () => {
    const oppId = await insertCanonicalLead('2001');
    await q(`INSERT INTO opportunity_screening_queue (opportunity_id, pipeline_status, auto_decision, confidence_score)
             VALUES ('${oppId}', 'completed', 'pass', 91)`);
    const { GET } = await import('@/app/api/admin/network/screening/route');

    const res = await GET(getReq());
    expect(res.status, 'the queue endpoint still 500s and the UI shows "Queue is empty"').toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    const row = (body.queue as any[]).find((r) => r.opportunity_id === oppId);
    expect(row, 'the row exists in the database but not in the response').toBeTruthy();

    // 🚨 THE RESPONSE KEYS ARE THE CONTRACT. app/admin/network/page.tsx reads
    // row.state and row.homeowner_first_name / row.homeowner_last_name, so the
    // canonical columns must be ALIASED, not renamed in the payload.
    expect(row.state, 'the State column renders blank').toBe('IL');
    expect(row.city).toBe('Chicago');
    expect(row.homeowner_first_name, 'the Homeowner column renders blank').toBe('Dana');
    expect(row.homeowner_last_name).toBe('2001');
    expect(row.pipeline_status).toBe('completed');
  });

  it('a homeowner_name-only lead still renders a name', async () => {
    // Two writers are live and both are canonical: the intake pipeline writes
    // first_name/last_name, while the simulator and contractor-shared paths
    // write the single homeowner_name. Reading only one of them blanks the other
    // half of the queue, which is the same silent-blank failure in miniature.
    const rows = await q(`
      INSERT INTO network_opportunities (source_type, status, homeowner_name, location_state, address)
      VALUES ('contractor_shared', 'intake', 'Priya Raman', 'IL', '77 North Clark Drive')
      RETURNING id`);
    const oppId = rows[0].id as string;
    await q(`INSERT INTO opportunity_screening_queue (opportunity_id, pipeline_status)
             VALUES ('${oppId}', 'pending')`);
    const { GET } = await import('@/app/api/admin/network/screening/route');

    const body = await (await GET(getReq('?limit=50'))).json();
    const row = (body.queue as any[]).find((r) => r.opportunity_id === oppId);
    expect(row.homeowner_first_name).toBe('Priya');
    expect(row.homeowner_last_name).toBe('Raman');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// F3 — the pipeline, and step 4's fabricated "true"
// ════════════════════════════════════════════════════════════════════════════
describe('🚨 F3 — a perfect Illinois lead passes automated screening', () => {
  it('auto_decision is pass, not a grade-F "invalid_address, outside_service_area"', async () => {
    // Every lead came back fail. The address was perfect; the pipeline was
    // reading `state`, which the table does not have, so step 3 saw no state and
    // step 4 matched no service area. `pass` is one of only two ways to open the
    // marketplace gate, so automated release was unreachable.
    const oppId = await insertCanonicalLead('3001');
    const { runScreeningPipeline } = await import('@/lib/network/screeningPipeline');

    const result = await runScreeningPipeline(oppId);
    expect(result.auto_decision, `still failing: ${result.auto_decision_reason}`).toBe('pass');
    expect(result.fail_reasons).toEqual([]);
    expect(result.steps.step3.status).toBe('passed');
    expect(result.steps.step3.data.address_valid).toBe(true);
    expect(result.steps.step4.status).toBe('passed');
    expect(result.steps.step4.data.matched_state).toBe('IL');
    expect(result.steps.step10.data.grade, 'a perfect lead was graded F').not.toBe('F');

    // The canonical utility and bill values have to reach the steps that price
    // the lead, or step 5 and step 8 silently fall back to defaults.
    expect(result.steps.step5.data.utility_name).toBe('ComEd');
    expect(result.steps.step8.data.credit_tier).toBe('good');

    const [row] = await q(`SELECT status FROM network_opportunities WHERE id = '${oppId}'`);
    expect(row.status, 'a passing lead was left unscored').toBe('scored');
  });

  it('step 4 MEASURES the contractors nearby instead of asserting zero', async () => {
    const oppId = await insertCanonicalLead('3002');
    const { runScreeningPipeline } = await import('@/lib/network/screeningPipeline');
    const result = await runScreeningPipeline(oppId);

    expect(result.steps.step4.data.active_contractors_nearby).toBe(1);
    expect(result.steps.step4.data.supported).toBe(true);
    const [row] = await q(
      `SELECT step4_in_service_area, step4_active_contractors_nearby
         FROM opportunity_screening_queue WHERE opportunity_id = '${oppId}'`,
    );
    expect(row.step4_in_service_area).toBe(true);
    expect(Number(row.step4_active_contractors_nearby)).toBe(1);
  });

  it('🚨 an UNMEASURABLE contractor count persists NULL, not a fabricated zero', async () => {
    // It used to persist `in_service_area: true, active_contractors_nearby: 0`
    // whenever the check threw — the old outer catch hardcoded the true and the
    // `?? 0` at the persistence site supplied the zero. Neither is a default:
    // they are fabricated measurements, the specific claim "we serve this
    // address and no contractor is near it", asserted by a query that failed.
    //
    // The state lookup is local and still a real measurement here (IL is served,
    // and that stays `true`); only the count is unknown, and it must read null.
    const oppId = await insertCanonicalLead('3003');
    await q('ALTER TABLE contractor_profiles RENAME TO contractor_profiles_offline');
    try {
      const { runScreeningPipeline } = await import('@/lib/network/screeningPipeline');
      const result = await runScreeningPipeline(oppId);
      expect(result.steps.step4.data.supported, 'an unmeasurable check reported itself as measured').toBe(false);
      expect(result.steps.step4.data.active_contractors_nearby, 'a fabricated zero').toBeNull();
      expect(result.steps.step4.data.in_service_area, 'a real state measurement was thrown away').toBe(true);
      // An outage must not start rejecting leads.
      expect(result.steps.step4.status).toBe('passed');

      const [row] = await q(
        `SELECT step4_in_service_area, step4_active_contractors_nearby, step4_data
           FROM opportunity_screening_queue WHERE opportunity_id = '${oppId}'`,
      );
      expect(row.step4_in_service_area).toBe(true);
      expect(row.step4_active_contractors_nearby, 'the fabricated zero was persisted').toBeNull();
      expect(row.step4_data.supported).toBe(false);
      expect(row.step4_data.note).toBe('contractor_count_unavailable');
    } finally {
      await q('ALTER TABLE contractor_profiles_offline RENAME TO contractor_profiles');
    }
  });

  it('🚨 a lead with NO state reads unknown, not "outside our service area"', async () => {
    // With no state there is nothing to look up, so `false` would be a
    // conclusion drawn from absent data. It reads null — and still does not
    // auto-pass, because an unconfirmed service area is not a confirmed one.
    const rows = await q(`
      INSERT INTO network_opportunities (source_type, status, homeowner_email, homeowner_phone,
        address, monthly_bill_amount)
      VALUES ('google_ads', 'intake', 'nostate@example.test', '+13125558888',
        '41 Unknown Parkway', 210)
      RETURNING id`);
    const oppId = rows[0].id as string;
    const { runScreeningPipeline } = await import('@/lib/network/screeningPipeline');
    const result = await runScreeningPipeline(oppId);

    expect(result.steps.step4.data.in_service_area, 'absent data was reported as a measured "no"').toBeNull();
    expect(result.steps.step4.data.matched_state).toBeNull();
    expect(result.steps.step4.data.supported).toBe(false);
    expect(result.auto_decision, 'an unconfirmed service area auto-passed').not.toBe('pass');

    const [row] = await q(
      `SELECT step4_in_service_area FROM opportunity_screening_queue WHERE opportunity_id = '${oppId}'`,
    );
    expect(row.step4_in_service_area, 'the fabricated false was persisted').toBeNull();
  });

  it('and it still FAILS a genuinely out-of-area lead', async () => {
    // Proves the repair did not simply make step 4 incapable of refusing —
    // otherwise the fix would have opened the gate to everyone.
    const rows = await q(`
      INSERT INTO network_opportunities (source_type, status, homeowner_email, homeowner_phone,
        address, location_city, location_state, location_zip, monthly_bill_amount)
      VALUES ('google_ads', 'intake', 'ov@example.test', '+13125559999',
        '9 Rue Lafayette', 'Lyon', 'ZZ', '69001', 240)
      RETURNING id`);
    const oppId = rows[0].id as string;
    const { runScreeningPipeline } = await import('@/lib/network/screeningPipeline');
    const result = await runScreeningPipeline(oppId);
    expect(result.steps.step4.status).toBe('failed');
    expect(result.fail_reasons).toContain('outside_service_area');
    expect(result.auto_decision).toBe('fail');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// F4 — paid acquisition produced zero sellable leads
// ════════════════════════════════════════════════════════════════════════════
describe('🚨 F4 — a webhook lead actually becomes an opportunity row', () => {
  const payload = (tag: string) => ({
    first_name: 'Marcus',
    last_name: tag,
    email: `marcus.${tag}@example.test`,
    phone: `+1773555${tag}`,
    address_line1: `${tag} South Wabash Drive`,
    city: 'Chicago',
    state: 'IL',
    zip: '60605',
    county: 'Cook',
    monthly_bill_amount: 310,
    square_feet: 2400,
    roof_age_years: 6,
    property_type: 'single_family',
    home_ownership: 'own',
    consent_given: true,
    notes: 'Requested an evening callback.',
    source_system: 'google_ads',
    source_channel: 'paid_search',
    gclid: `gclid-${tag}`,
  });

  it('the INSERT succeeds and the canonical columns carry the data', async () => {
    // It never succeeded. Five phantom columns (`city`, `state`,
    // `property_type`, `square_feet_living`, `is_duplicate_flagged`) plus
    // `consent_given` and `notes`, plus `status = 'new'` — which the CHECK
    // constraint from migration 047 forbids outright. Both INSERTs, primary and
    // fallback. Paid spend generated zero sellable leads.
    const { runIntakePipeline } = await import('@/lib/intake/intakePipeline');
    const result = await runIntakePipeline(payload('4001') as any, {
      source_system: 'google_ads',
      idempotency_key: 'idem-4001',
      skip_enrichment: true,
    });

    expect(result.action, `intake still fails: ${result.validation_errors.join('; ')}`).toBe('created');
    expect(result.opportunity_id).toBeTruthy();

    const [row] = await q(`SELECT * FROM network_opportunities WHERE id = '${result.opportunity_id}'`);
    expect(row.location_city).toBe('Chicago');
    expect(row.location_state).toBe('IL');
    expect(row.location_zip).toBe('60605');
    expect(Number(row.square_feet)).toBe(2400);
    expect(row.duplicate_flag).toBe(false);
    // 'new' is not in migration 047's status enum; 'intake' is its documented
    // "just received, not yet screened" value and is the table default.
    expect(row.status).toBe('intake');
    expect(row.intake_idempotency_key).toBe('idem-4001');
    // Fields with no canonical column of their own are preserved in the jsonb,
    // not dropped — consent is a legal record, not a nice-to-have.
    expect(row.intake_metadata.consent_given).toBe(true);
    expect(row.intake_metadata.notes).toBe('Requested an evening callback.');
    expect(row.intake_metadata.property_type).toBe('single_family');
  });

  it('a redelivered webhook is deduped by the unique index, not duplicated', async () => {
    const { runIntakePipeline } = await import('@/lib/intake/intakePipeline');
    const opts = { source_system: 'google_ads', idempotency_key: 'idem-4002', skip_enrichment: true };
    const first = await runIntakePipeline(payload('4002') as any, opts);
    expect(first.action).toBe('created');
    const second = await runIntakePipeline(payload('4002') as any, opts);
    expect(second.action).toBe('duplicate_blocked');
    expect(second.opportunity_id).toBe(first.opportunity_id);

    const rows = await q(`SELECT id FROM network_opportunities WHERE intake_idempotency_key = 'idem-4002'`);
    expect(rows.length, 'the retried delivery created a second opportunity').toBe(1);
  });

  it('🚨 a schema mismatch SURFACES instead of masquerading as a pending migration', async () => {
    // The `catch (colErr)` was unconditional, so ANY insert failure was
    // reported as "idempotency column missing, plain insert" and retried
    // against an INSERT that shared the same phantom columns. The one trace of
    // a total intake outage was a warning naming the wrong cause — and naming a
    // migration (089) that has in fact shipped.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await q('ALTER TABLE network_opportunities DROP COLUMN square_feet');
    try {
      const { runIntakePipeline } = await import('@/lib/intake/intakePipeline');
      const result = await runIntakePipeline(payload('4003') as any, {
        source_system: 'google_ads',
        idempotency_key: 'idem-4003',
        skip_enrichment: true,
      });
      expect(result.action).toBe('error');
      const misattributed = warn.mock.calls
        .map((c) => c.map(String).join(' '))
        .filter((m) => /idempotency column missing/i.test(m));
      expect(misattributed, 'a real schema break is still blamed on migration 089')
        .toEqual([]);
    } finally {
      await q('ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS square_feet INTEGER');
      warn.mockRestore();
    }
  });

  it('but the genuine idempotency fallback still works', async () => {
    // Narrowing the catch must not delete the fallback it was written for. On a
    // database where 089 has genuinely not been applied, intake must still land.
    await q('DROP INDEX IF EXISTS uq_network_opportunities_intake_idempotency');
    await q('ALTER TABLE network_opportunities DROP COLUMN intake_idempotency_key');
    try {
      const { runIntakePipeline } = await import('@/lib/intake/intakePipeline');
      const result = await runIntakePipeline(payload('4004') as any, {
        source_system: 'google_ads',
        idempotency_key: 'idem-4004',
        skip_enrichment: true,
      });
      expect(result.action, 'intake broke on a pre-089 database').toBe('created');
      const [row] = await q(`SELECT location_state, status FROM network_opportunities WHERE id = '${result.opportunity_id}'`);
      expect(row.location_state).toBe('IL');
      expect(row.status).toBe('intake');
    } finally {
      await db.exec(read('lib', 'migrations', '089_intake_idempotency_key.sql'));
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// F5 — the two counters that read keys nobody emitted
// ════════════════════════════════════════════════════════════════════════════
describe('🚨 F5 — the Pending and Running tiles show real numbers', () => {
  it('the endpoint emits the *_screening names the tiles read', async () => {
    // Chosen direction: rename the SQL ALIASES to match the vocabulary
    // /api/admin/network/health already publishes (pending_screening,
    // running_screening), rather than changing the page. Two endpoints now
    // describe the same queue with the same words, and the page — the only
    // consumer of this one — needed no edit at all.
    const oppId = await insertCanonicalLead('5001');
    await q(`INSERT INTO opportunity_screening_queue (opportunity_id, pipeline_status)
             VALUES ('${oppId}', 'pending')`);
    const { GET } = await import('@/app/api/admin/network/screening/route');
    const body = await (await GET(getReq('?limit=1'))).json();

    expect(body.stats.pending_screening, 'the Pending tile still reads undefined → 0')
      .toBeDefined();
    expect(Number(body.stats.pending_screening)).toBeGreaterThan(0);
    expect(body.stats.running_screening, 'the Running tile still reads undefined → 0')
      .toBeDefined();
    // The three tiles that always worked must keep working.
    expect(body.stats.auto_passed).toBeDefined();
    expect(body.stats.auto_failed).toBeDefined();
    expect(body.stats.needs_review).toBeDefined();
  });

  it('SOURCE SCAN: the page still binds to those same two names', () => {
    // Stated plainly: this is a source scan. The tile is inside a 6000-line
    // client component and rendering it would test React, not the vocabulary.
    // Its job is to fail if somebody later renames one side of the pair.
    const PAGE = stripComments(read('app', 'admin', 'network', 'page.tsx'));
    expect(PAGE).toMatch(/stats\.pending_screening/);
    expect(PAGE).toMatch(/stats\.running_screening/);
  });
});
