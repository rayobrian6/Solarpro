import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetUserFromRequest = vi.fn();
const mockGetDbReady = vi.fn();
const mockHandleRouteDbError = vi.fn((_label: string, err: unknown) => {
  throw err;
});
const mockCheckRateLimit = vi.fn();
const mockGetClientIp = vi.fn();

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

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OPP_ID = "22222222-2222-4222-8222-222222222222";
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

function makeSql() {
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
      return [{ total: 1 }];
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
      q.includes("FROM opportunity_assignments oa") &&
      q.includes("oa.status IN ('offered','viewed')")
    ) {
      return [assignedOpportunity];
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

    if (q.includes("UPDATE network_opportunities")) return [];

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
  });

  it("includes direct network assignments in the Discover feed and total count", async () => {
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
        claim_status: "offered",
      }),
    ]);
    const assignedQuery =
      sql.calls.find(
        (q: string) =>
          q.includes("FROM opportunity_assignments oa") &&
          q.includes("oa.status IN ('offered','viewed')"),
      ) ?? "";
    expect(assignedQuery).toContain("oi.enrichment_payload");
    expect(assignedQuery).toContain("oi.enrichment_completeness");
    expect(assignedQuery).toContain("LEFT JOIN opportunity_intelligence oi");
    expect(assignedQuery).toContain("approved_for_marketplace");
    expect(assignedQuery).toContain("opportunity_screening_queue");
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
  });
});
