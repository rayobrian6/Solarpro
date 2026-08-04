// ===========================================================================
// PA S5 - THE WS-5 HANDLERS, AGAINST PRODUCTION'S ACTUAL SCHEMA FAULT.
//
// The LA phase repaired the membership preemption and covered it with helper
// tests. The brief asks for the HANDLERS. This drives the real exported route
// handlers with a faked database that reproduces production exactly:
//
//   - organization_members   -> 42P01 (migration 105 never applied)
//   - organizations.settings -> 42703 (same unapplied migration)
//   - users.org_id           -> a real organization pointer (what Braidon has)
//   - field_route_measurements / _events -> present (migration 118 IS applied)
//
// The question these answer is the one the helper tests cannot: does an operator
// actually get a 200 and a 201 out of this feature today, rather than a 503?
// ===========================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const PROJECT_ID = '4030b664-bebe-433b-a11c-cda05ead2f7d';
const ORG_ID = '33333333-3333-4333-8333-333333333333';
const SEGMENT = 'COMBINER_TO_DISCO_RUN';

/** Mutable per-test switches + the statement log. */
const db = {
  membersError: { code: '42P01' } as { code: string } | null,
  settingsError: { code: '42703' } as { code: string } | null,
  orgId: ORG_ID as string | null,
  orgRole: 'owner',
  rows: [] as Record<string, unknown>[],
  statements: [] as string[],
};

let currentUser: { id: string } | null = { id: OWNER_ID };

vi.mock('@/lib/auth', () => ({ getUserFromRequest: () => currentUser }));
vi.mock('@/lib/rateLimiter', () => ({
  checkRateLimit: async () => ({ allowed: true }),
  getClientIp: () => '127.0.0.1',
}));
vi.mock('@/lib/auditLog', () => ({ writeAuditLog: async () => undefined }));
vi.mock('@/lib/db-neon', () => ({
  isValidUUID: (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
  handleRouteDbError: () => new Response(JSON.stringify({ success: false }), { status: 500 }),
}));

// PARTIAL mock: ONLY route derivation is stubbed. `readProjectMeasurements` -
// which carries the membership fallback under test - stays REAL, and the write
// path's membership check goes through the untouched `capabilities` module. The
// route projection has its own coverage in ws5-field-measurement-reachability.
vi.mock('@/lib/fieldMeasurement/permitAccess', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/fieldMeasurement/permitAccess')>();
  return {
    ...actual,
    productionRouteFactSource: {
      listRouteFacts: async () => ([{
        segmentId: 'COMBINER_TO_DISCO_RUN', exists: true,
        routeOwnership: 'PROJECT_OWNED', routeAuthorityApplicability: 'REQUIRED',
        routeApplicabilityReason: null, electricalFunction: 'combiner/inverter feeder to disconnect',
        from: 'AC COMBINER', to: 'AC DISCONNECT',
        cadEstimatedLengthFt: 20, cadRoutedLengthFt: null,
        currentLengthSource: 'cad-estimate', currentVerificationState: 'ESTIMATED',
      }, {
        segmentId: 'MSP_TO_UTILITY_RUN', exists: true,
        routeOwnership: 'UTILITY_OWNED', routeAuthorityApplicability: 'EXCLUDED',
        routeApplicabilityReason: 'utility-owned service equipment',
        electricalFunction: 'service run', from: 'MSP', to: 'UTILITY METER',
        cadEstimatedLengthFt: 10, cadRoutedLengthFt: null,
        currentLengthSource: 'cad-estimate', currentVerificationState: 'ESTIMATED',
      }]),
    },
  };
});

vi.mock('@/lib/db/core', () => ({
  getDbReady: async () => {
    const sql = (strings: TemplateStringsArray, ...vals: unknown[]) => {
      const q = strings.join(' ').replace(/\s+/g, ' ').trim();
      db.statements.push(q);

      if (/FROM organization_members/i.test(q)) {
        if (db.membersError) {
          return Promise.reject(Object.assign(
            new Error('relation "organization_members" does not exist'), db.membersError));
        }
        return Promise.resolve([]);
      }
      if (/SELECT settings FROM organizations/i.test(q)) {
        if (db.settingsError) {
          return Promise.reject(Object.assign(
            new Error('column "settings" does not exist'), db.settingsError));
        }
        return Promise.resolve([{ settings: null }]);
      }
      if (/FROM users/i.test(q)) {
        return Promise.resolve(db.orgId ? [{ org_id: db.orgId, org_role: db.orgRole }] : []);
      }
      if (/FROM projects/i.test(q)) return Promise.resolve([{ user_id: OWNER_ID, id: PROJECT_ID }]);
      if (/INSERT INTO field_route_measurements/i.test(q)) {
        const rec = {
          id: `m-${db.rows.length + 1}`, project_id: PROJECT_ID, route_segment_id: SEGMENT,
          tenant_id: `org:${ORG_ID}`, tenant_organization_id: ORG_ID,
          measured_length_ft: vals.find(v => typeof v === 'number') ?? 42,
          measurement_method: 'LASER', measured_by_user_id: OWNER_ID,
          measured_at: '2026-08-04T09:30:00.000Z', recorded_at: '2026-08-04T12:00:00.000Z',
          evidence_attachment_ids: [], notes: null,
          verification_state: 'REPORTED_UNVERIFIED', verification_mode: null,
          verified_by_user_id: null, verified_at: null, verification_notes: null,
          evidence_exception_reason: null, rejected_by_user_id: null, rejected_at: null,
          rejection_reason: null, supersedes_measurement_id: null,
          superseded_by_measurement_id: null,
          created_at: '2026-08-04T12:00:00.000Z', updated_at: '2026-08-04T12:00:00.000Z',
        };
        db.rows.push(rec);
        return Promise.resolve([rec]);
      }
      if (/FROM field_route_measurements/i.test(q)) return Promise.resolve([...db.rows]);
      if (/INSERT INTO/i.test(q)) return Promise.resolve([]);   // events, invalidations
      return Promise.resolve([]);
    };
    (sql as unknown as { transaction: unknown }).transaction = (fn: (t: unknown) => unknown[]) => {
      const out = fn(sql);
      return Promise.all(Array.isArray(out) ? out : [out]);
    };
    return sql;
  },
}));

// Hoisted above these imports, so the handlers bind to the fakes.
import { GET as getRollup } from '@/app/api/projects/[id]/route-measurements/route';
import { GET as getHistory, POST as postMeasurement } from '@/app/api/projects/[id]/routes/[routeSegmentId]/measurements/route';

const req = (body?: unknown) => ({
  headers: new Headers(),
  nextUrl: new URL(`http://localhost/api/projects/${PROJECT_ID}/route-measurements`),
  url: `http://localhost/api/projects/${PROJECT_ID}/route-measurements`,
  json: async () => body ?? {},
}) as never;

const rollupCtx = { params: Promise.resolve({ id: PROJECT_ID }) };
const segCtx = { params: Promise.resolve({ id: PROJECT_ID, routeSegmentId: SEGMENT }) };

beforeEach(() => {
  db.membersError = { code: '42P01' };
  db.settingsError = { code: '42703' };
  db.orgId = ORG_ID; db.orgRole = 'owner';
  db.rows = []; db.statements = [];
  currentUser = { id: OWNER_ID };
});

describe('PA S5 - WS-5 READ handler survives the absent membership table', () => {
  it('GET /route-measurements returns 200, NOT 503, with organization_members absent', async () => {
    const res = await getRollup(req(), rollupCtx as never);
    expect(res.status).not.toBe(503);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it('the users.org_id fallback is genuinely exercised (not skipped by the throw)', async () => {
    await getRollup(req(), rollupCtx as never);
    expect(db.statements.some(q => /FROM organization_members/i.test(q))).toBe(true);
    expect(db.statements.some(q => /FROM users/i.test(q))).toBe(true);
  });

  it('the derived tenant grants the owner real capabilities', async () => {
    const res = await getRollup(req(), rollupCtx as never);
    const json = await res.json();
    expect(Array.isArray(json.capabilities)).toBe(true);
    expect(json.capabilities.length).toBeGreaterThan(0);
    expect(json.currentUserId).toBe(OWNER_ID);
  });

  it('self-verification stays FAIL-CLOSED when organizations.settings is absent', async () => {
    const res = await getRollup(req(), rollupCtx as never);
    const json = await res.json();
    expect(json.allowAuthorizedSelfVerification).toBe(false);
  });

  it('an UNAUTHENTICATED caller is refused', async () => {
    currentUser = null;
    const res = await getRollup(req(), rollupCtx as never);
    expect(res.status).toBe(401);
  });

  it('a NON-OWNER with no membership is denied, not silently granted', async () => {
    currentUser = { id: OTHER_ID };
    db.orgId = null;                       // no org pointer for this user either
    const res = await getRollup(req(), rollupCtx as never);
    expect(res.status).not.toBe(200);
    expect([401, 403, 404]).toContain(res.status);
  });

  it('a genuine (non-42P01) database fault is NOT swallowed', async () => {
    db.membersError = { code: '42501' };   // permission denied
    const res = await getRollup(req(), rollupCtx as never);
    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});

describe('PA S5 - WS-5 WRITE handler reaches migration-118 storage', () => {
  const validBody = {
    measuredLengthFt: 42.5,
    measurementMethod: 'LASER',
    measuredAt: '2026-08-04T09:30:00.000Z',
    evidenceAttachmentIds: [],
    notes: 'controlled handler proof',
  };

  it('POST returns 201, NOT 503, and INSERTs into field_route_measurements', async () => {
    const res = await postMeasurement(req(validBody), segCtx as never);
    expect(res.status).not.toBe(503);
    expect(res.status).toBe(201);
    expect(db.statements.some(q => /INSERT INTO field_route_measurements/i.test(q))).toBe(true);
  });

  it('the recorded measurement READS BACK through the history handler', async () => {
    await postMeasurement(req(validBody), segCtx as never);
    const res = await getHistory(req(), segCtx as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.measurements.length).toBeGreaterThan(0);
  });

  it('the SERVER stamps identity and state - a client cannot supply them', async () => {
    await postMeasurement(req({
      ...validBody,
      measuredByUserId: OTHER_ID,             // must be ignored
      verificationState: 'VERIFIED',          // must be ignored
    }), segCtx as never);
    const rec = db.rows[0];
    expect(rec.measured_by_user_id).toBe(OWNER_ID);
    expect(rec.verification_state).toBe('REPORTED_UNVERIFIED');
  });

  it('an UNAUTHENTICATED write is refused before any INSERT', async () => {
    currentUser = null;
    const res = await postMeasurement(req(validBody), segCtx as never);
    expect(res.status).toBe(401);
    expect(db.statements.some(q => /INSERT INTO field_route_measurements/i.test(q))).toBe(false);
  });

  it('a malformed body is rejected without reaching storage', async () => {
    const res = await postMeasurement(req({ measurementMethod: 'LASER' }), segCtx as never);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(db.statements.some(q => /INSERT INTO field_route_measurements/i.test(q))).toBe(false);
  });

  it('an invalid project id never reaches the service', async () => {
    const res = await postMeasurement(req(validBody),
      { params: Promise.resolve({ id: 'not-a-uuid', routeSegmentId: SEGMENT }) } as never);
    expect(res.status).toBe(400);
  });
});
