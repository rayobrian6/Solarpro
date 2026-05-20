import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetUserFromRequest = vi.fn();
const mockGetDbReady = vi.fn();
const mockHandleRouteDbError = vi.fn((_label: string, err: unknown) => {
  throw err;
});
const mockCheckRateLimit = vi.fn();
const mockGetClientIp = vi.fn();
const mockEvaluateContractorEligibility = vi.fn();
const mockLogNetworkEvent = vi.fn();

vi.mock("@/lib/auth", () => ({ getUserFromRequest: mockGetUserFromRequest }));
vi.mock("@/lib/db-neon", () => ({
  getDbReady: mockGetDbReady,
  handleRouteDbError: mockHandleRouteDbError,
  isValidUUID: (id: string) => /^[0-9a-f-]{36}$/i.test(id),
}));
vi.mock("@/lib/rateLimiter", () => ({
  checkRateLimit: mockCheckRateLimit,
  getClientIp: mockGetClientIp,
}));
vi.mock("@/lib/network/contractorEligibility", () => ({
  evaluateContractorEligibility: mockEvaluateContractorEligibility,
}));
vi.mock("@/lib/network/attributionTracker", () => ({
  logNetworkEvent: mockLogNetworkEvent,
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OPP_ID = "22222222-2222-4222-8222-222222222222";
const INELIGIBLE_OPP_ID = "44444444-4444-4444-8444-444444444444";
const ASSIGNMENT_ID = "33333333-3333-4333-8333-333333333333";

function req(url: string, body?: unknown, method = "GET"): any {
  return new Request(url, {
    method,
    headers: {
      "content-type": "application/json",
      cookie: "solarpro_session=test",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const assignedOpportunity = {
  id: OPP_ID,
  source: "solarpro_generated",
  status: "open",
  site_name: null,
  city: "Austin",
  state_code: "TX",
  zip: "78701",
  system_size_kw: 8.5,
  annual_kwh: 12000,
  monthly_kwh_avg: 1000,
  utility_name: "Austin Energy",
  utility_rate_per_kwh: 0.14,
  estimated_system_cost: 24000,
  estimated_payback_yrs: 8,
  roof_material: "asphalt",
  roof_pitch: "5/12",
  roof_condition: null,
  roof_age_years: null,
  stories: null,
  structure_type: null,
  usable_roof_pct: null,
  battery_candidate: false,
  steep_roof: false,
  complex_ahj: false,
  ahj_name: null,
  equipment_ecosystem: null,
  asking_price: 500,
  listing_notes: null,
  expires_at: "2099-01-01T00:00:00Z",
  created_at: "2026-01-01T00:00:00Z",
  creator_company: "SolarPro",
  claim_id: ASSIGNMENT_ID,
  claim_status: "offered",
  claimed_by_user_id: USER_ID,
  marketplace_status: "live",
  marketplace_screening_status: "approved",
  marketplace_auto_decision: "pass",
  marketplace_override_decision: null,
  marketplace_intake_metadata: {
    operational: {
      contacted: true,
      qualified: true,
      financing_ready: true,
      approved_for_marketplace: true,
      lifecycle_status: "ready_for_marketplace",
      review_status: "approved_for_marketplace",
    },
    qualification: {
      qualification_status: "high_intent",
      lead_score: 86,
      finance_readiness: true,
    },
  },
  marketplace_raw_payload: null,
  claim_mode: "exclusive",
  claim_count: 0,
  max_claims: 1,
};

const ineligibleOpportunity = {
  ...assignedOpportunity,
  id: INELIGIBLE_OPP_ID,
  claim_id: null,
  claim_status: null,
  claimed_by_user_id: null,
  city: "Dallas",
  state_code: "TX",
};

const claimedOpportunity = {
  ...assignedOpportunity,
  status: "claimed",
  address: "123 Solar Way",
  claim_status: "claimed",
  price_paid: 500,
  contractor_notes: null,
  outcome: null,
  outcome_notes: null,
  outcome_at: null,
  first_contact_at: null,
  claim_expires_at: "2099-01-01T00:00:00Z",
  claimed_at: "2026-01-01T01:00:00Z",
};

function makeSql(opts: { canonicalRows?: Record<string, unknown>[]; assignmentRows?: Record<string, unknown>[] } = {}) {
  const calls: string[] = [];
  const sql = vi.fn(async (strings: TemplateStringsArray) => {
    const q = strings.join(" ");
    calls.push(q);

    if (q.includes("FROM contractor_profiles")) {
      return [
        {
          service_states: ["TX"],
          equipment_ecosystems: ["enphase"],
          battery_certified: false,
          min_project_kw: null,
          max_project_kw: null,
          network_active: true,
        },
      ];
    }

    if (q.includes("FROM opportunities o") && q.includes("o.status = 'open'"))
      return [];
    if (
      q.includes("SELECT COUNT(*) AS total") &&
      q.includes("FROM opportunities o")
    )
      return [{ total: 0 }];

    if (
      q.includes("SELECT COUNT(*) AS total") &&
      q.includes("FROM opportunity_assignments oa") &&
      q.includes("oa.status IN ('offered','viewed')")
    ) {
      return [{ total: 0 }];
    }

    if (
      q.includes("FROM opportunity_assignments oa") &&
      q.includes("JOIN network_opportunities no") &&
      q.includes("WHERE no.id =") &&
      q.includes("LIMIT 1")
    ) {
      return [
        {
          assignment_id: ASSIGNMENT_ID,
          assignment_status: "offered",
          opportunity_id: OPP_ID,
          opportunity_status: "live",
          asking_price: 500,
          screening_status: "approved",
          auto_decision: "pass",
          override_decision: null,
          intake_metadata: {
            operational: {
              contacted: true,
              qualified: true,
              financing_ready: true,
              approved_for_marketplace: true,
              lifecycle_status: "ready_for_marketplace",
              review_status: "approved_for_marketplace",
            },
            qualification: {
              qualification_status: "high_intent",
              lead_score: 86,
              finance_readiness: true,
            },
          },
        },
      ];
    }

    if (
      q.includes("FROM network_opportunities no") &&
      q.includes("COALESCE(no.marketplace_status, 'not_released') = 'live'")
    ) {
      return opts.canonicalRows ?? [assignedOpportunity];
    }

    if (
      q.includes("FROM opportunity_assignments oa") &&
      q.includes("oa.status IN ('offered','viewed')")
    ) {
      return opts.assignmentRows ?? [];
    }

    if (q.includes("FROM opportunities") && q.includes("WHERE id =")) return [];

    if (
      q.includes("UPDATE opportunity_assignments") &&
      q.includes("SET status = 'claimed'")
    ) {
      return [
        {
          id: ASSIGNMENT_ID,
          opportunity_id: OPP_ID,
          contractor_id: USER_ID,
          status: "claimed",
        },
      ];
    }

    if (q.includes("UPDATE network_opportunities")) {
      return [{ id: OPP_ID, status: "claimed", marketplace_status: "claimed", claim_count: 1 }];
    }

    if (
      q.includes("SELECT") &&
      q.includes("FROM network_opportunities no") &&
      q.includes("WHERE no.id =")
    ) {
      return [claimedOpportunity];
    }

    if (
      q.includes("FROM opportunity_claims c") &&
      q.includes("JOIN opportunities o")
    )
      return [];
    if (
      q.includes("SELECT COUNT(*) AS total") &&
      q.includes("FROM opportunity_claims")
    )
      return [{ total: 0 }];

    if (
      q.includes("FROM opportunity_assignments oa") &&
      q.includes(
        "oa.status IN ('claimed','contacted','appointment','proposal','won')",
      )
    ) {
      return [claimedOpportunity];
    }

    if (
      q.includes("SELECT COUNT(*) AS total") &&
      q.includes("FROM opportunity_assignments") &&
      q.includes(
        "status IN ('claimed','contacted','appointment','proposal','won')",
      )
    ) {
      return [{ total: 1 }];
    }

    return [];
  }) as any;
  sql.calls = calls;
  return sql;
}

describe("contractor network assignment visibility", () => {
  beforeEach(() => {
    vi.resetModules();
    mockGetUserFromRequest
      .mockReset()
      .mockReturnValue({ id: USER_ID, email: "contractor@test.com" });
    mockGetDbReady.mockReset().mockResolvedValue(makeSql());
    mockCheckRateLimit.mockReset().mockResolvedValue({ allowed: true });
    mockGetClientIp.mockReset().mockReturnValue("127.0.0.1");
    mockEvaluateContractorEligibility.mockReset().mockImplementation(async ({ opportunityId }) => ({
      eligible: opportunityId !== INELIGIBLE_OPP_ID,
      reasons: opportunityId === INELIGIBLE_OPP_ID
        ? []
        : [
            "release_gate_passed",
            "contractor_active",
            "territory_state_TX",
            "claim_capacity_available_exclusive",
          ],
      denials: opportunityId === INELIGIBLE_OPP_ID ? ["battery_certification_required"] : [],
      warnings: [],
      contractor_id: USER_ID,
      opportunity_id: opportunityId,
      release_gate_result: { ok: opportunityId !== INELIGIBLE_OPP_ID, missing: [] },
      claim_state: {
        mode: "exclusive",
        max_claims: 1,
        current_claims: 0,
        contractor_has_active_claim: false,
        contractor_has_claimable_offer: opportunityId === OPP_ID,
      },
    }));
    mockLogNetworkEvent.mockReset().mockResolvedValue(undefined);
  });

  it("shows released eligible canonical marketplace inventory in Discover and canonical count", async () => {
    const sql = makeSql();
    mockGetDbReady.mockResolvedValueOnce(sql);
    const { GET } = await import("@/app/api/network/opportunities/route");

    const res = await GET(
      req("https://solarpro.test/api/network/opportunities"),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.total).toBe(1);
    expect(json.opportunities).toEqual([
      expect.objectContaining({
        id: OPP_ID,
        city: "Austin",
        state_code: "TX",
        marketplace_status: "live",
        claim_mode: expect.anything(),
      }),
    ]);
    expect(mockEvaluateContractorEligibility).toHaveBeenCalledWith({
      sql,
      contractorId: USER_ID,
      opportunityId: OPP_ID,
    });
    const canonicalQuery =
      sql.calls.find(
        (q: string) =>
          q.includes("FROM network_opportunities no") &&
          q.includes("COALESCE(no.marketplace_status, 'not_released') = 'live"),
      ) ?? "";
    expect(canonicalQuery).toContain("no.status = 'live'");
    expect(canonicalQuery).toContain("COALESCE(no.claim_count, 0) < GREATEST");
    expect(canonicalQuery).toContain("NOT EXISTS");
    expect(canonicalQuery).toContain("approved_for_marketplace");
    expect(canonicalQuery).toContain("no.screening_status = 'approved'");
    expect(canonicalQuery).toContain("opportunity_screening_queue");
  });

  it("filters ineligible canonical marketplace inventory out of Discover", async () => {
    const sql = makeSql({ canonicalRows: [assignedOpportunity, ineligibleOpportunity] });
    mockGetDbReady.mockResolvedValueOnce(sql);
    const { GET } = await import("@/app/api/network/opportunities/route");

    const res = await GET(req("https://solarpro.test/api/network/opportunities"));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.total).toBe(1);
    expect(json.opportunities.map((opp: { id: string }) => opp.id)).toEqual([OPP_ID]);
    expect(mockEvaluateContractorEligibility).toHaveBeenCalledWith({
      sql,
      contractorId: USER_ID,
      opportunityId: INELIGIBLE_OPP_ID,
    });
  });

  it("claims an assigned network opportunity through the existing contractor claim endpoint", async () => {
    const { POST } =
      await import("@/app/api/network/opportunities/[id]/claim/route");

    const res = await POST(
      req(
        `https://solarpro.test/api/network/opportunities/${OPP_ID}/claim`,
        undefined,
        "POST",
      ),
      { params: { id: OPP_ID } },
    );

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.opportunity).toMatchObject({
      id: OPP_ID,
      address: "123 Solar Way",
      claim_status: "claimed",
    });
    expect(mockEvaluateContractorEligibility).toHaveBeenCalledWith({
      sql: expect.any(Function),
      contractorId: USER_ID,
      opportunityId: OPP_ID,
    });
    expect(mockLogNetworkEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: "assignment.claimed",
        opportunity_id: OPP_ID,
        contractor_id: USER_ID,
      }),
    );
  });

  it("includes claimed network assignments in My Claims and total count", async () => {
    const sql = makeSql();
    mockGetDbReady.mockResolvedValueOnce(sql);
    const { GET } = await import("@/app/api/network/my-claims/route");

    const res = await GET(req("https://solarpro.test/api/network/my-claims"));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.total).toBe(1);
    expect(json.claims).toEqual([
      expect.objectContaining({
        id: OPP_ID,
        address: "123 Solar Way",
        claim_status: "claimed",
        price_paid: 500,
      }),
    ]);
    const claimsQuery =
      sql.calls.find(
        (q: string) =>
          q.includes("FROM opportunity_assignments oa") &&
          q.includes(
            "oa.status IN ('claimed','contacted','appointment','proposal','won')",
          ),
      ) ?? "";
    expect(claimsQuery).toContain("oi.enrichment_payload");
    expect(claimsQuery).toContain("oi.enrichment_completeness");
    expect(claimsQuery).toContain("LEFT JOIN opportunity_intelligence oi");
    expect(claimsQuery).toContain("JOIN network_opportunities no");
    expect(claimsQuery).toContain("oa.contractor_id");
    expect(claimsQuery).not.toContain("opportunity_claims");
  });
});
