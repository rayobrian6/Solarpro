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
  monthly_bill_amount: 744,
  homeowner_status: "own",
  timeline: "asap",
  finance_readiness: true,
  lead_grade: "A",
  qualification_status: "high_intent",
  estimated_income_band: "50k_100k",
  estimated_credit_band: "680_719",
  sunlight_confidence: "full_sun",
  property_type: "single_family",
  battery_interest: "yes",
  preferred_contact_method: "phone",
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
  listing_notes: "Released contractor-facing notes",
  expires_at: "2099-01-01T00:00:00Z",
  created_at: "2026-01-01T00:00:00Z",
  creator_company: "SolarPro",
  claim_id: ASSIGNMENT_ID,
  claim_status: "offered",
  claimed_by_user_id: USER_ID,
  marketplace_lifecycle_status: "live",
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

function makeSql(opts: { canonicalRows?: Record<string, unknown>[]; legacyRows?: Record<string, unknown>[]; assignmentRows?: Record<string, unknown>[] } = {}) {
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

    if (
      q.includes("SELECT COUNT(*) AS total") &&
      q.includes("FROM opportunities o")
    )
      return [{ total: opts.legacyRows?.length ?? 0 }];
    if (q.includes("FROM opportunities o") && q.includes("o.status = 'open'"))
      return opts.legacyRows ?? [];

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
      q.includes("COALESCE(no.marketplace_status, 'live') NOT IN")
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
        listing_notes: "Released contractor-facing notes",
        monthly_bill_amount: 744,
        homeowner_status: "own",
        timeline: "asap",
        finance_readiness: true,
        lead_grade: "A",
        qualification_status: "high_intent",
        estimated_income_band: "50k_100k",
        estimated_credit_band: "680_719",
        sunlight_confidence: "full_sun",
        property_type: "single_family",
        battery_interest: "yes",
        preferred_contact_method: "phone",
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
          q.includes("COALESCE(no.marketplace_status, 'live') NOT IN")
      ) ?? "";
    expect(canonicalQuery).toContain("COALESCE(no.listing_notes, no.screening_notes) AS listing_notes");
    expect(canonicalQuery).toContain("no.monthly_bill_amount");
    expect(canonicalQuery).toContain("no.homeowner_ownership AS homeowner_status");
    expect(canonicalQuery).toContain("no.homeowner_timeline AS timeline");
    expect(canonicalQuery).toContain("no.opportunity_grade AS lead_grade");
    expect(canonicalQuery).toContain("preferred_contact_method");
    expect(canonicalQuery).toContain("AS estimated_offset_pct");
    expect(canonicalQuery).not.toContain("no.offset_percentage");
    expect(canonicalQuery).toContain("no.status = 'live'");
    expect(canonicalQuery).not.toContain("COALESCE(no.claim_count, 0) < GREATEST");
    expect(canonicalQuery).toContain("NOT EXISTS");
    expect(canonicalQuery).toContain("archived");
    expect(canonicalQuery).toContain("rejected");
    expect(canonicalQuery).toContain("is_test");
    expect(canonicalQuery).toContain("is_simulated");
    expect(canonicalQuery).not.toContain("approved_for_marketplace");
    expect(canonicalQuery).toContain("no.screening_status = 'approved'");
    expect(canonicalQuery).toContain("opportunity_screening_queue");
    expect(canonicalQuery).toContain("auto_decision = 'pass'");
    expect(canonicalQuery).toContain("override_decision = 'pass'");
  });

  it("normalizes legacy Discover opportunities with marketplace intelligence for card rendering", async () => {
    const legacyOpportunity = {
      id: "66666666-6666-4666-8666-666666666666",
      source: "contractor_shared",
      status: "open",
      site_name: "Legacy Shared Lead",
      city: "Mesa",
      state_code: "AZ",
      zip: "85201",
      system_size_kw: 7.25,
      annual_kwh: 9800,
      monthly_kwh_avg: 817,
      utility_name: "SRP",
      utility_rate_per_kwh: 0.16,
      estimated_system_cost: 21400,
      estimated_payback_yrs: 7.5,
      roof_material: "tile",
      roof_pitch: "4/12",
      roof_condition: "good",
      roof_age_years: 8,
      battery_candidate: true,
      steep_roof: false,
      complex_ahj: false,
      ahj_name: "Mesa",
      equipment_ecosystem: null,
      asking_price: 300,
      listing_notes: "Legacy shared opportunity",
      expires_at: "2099-01-01T00:00:00Z",
      created_at: "2026-01-01T00:00:00Z",
      creator_company: "Partner Solar",
    };
    const sql = makeSql({ canonicalRows: [], legacyRows: [legacyOpportunity] });
    mockGetDbReady.mockResolvedValueOnce(sql);
    const { GET } = await import("@/app/api/network/opportunities/route");

    const res = await GET(req("https://solarpro.test/api/network/opportunities"));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.total).toBe(1);
    expect(json.opportunities).toHaveLength(1);
    expect(json.opportunities[0]).toEqual(expect.objectContaining({
      id: legacyOpportunity.id,
      marketplace_intelligence: expect.objectContaining({
        revenue: expect.objectContaining({
          estimated_project_value: expect.objectContaining({ value: 21400 }),
          estimated_system_size_kw: expect.objectContaining({ value: 7.25 }),
          annual_usage_kwh: expect.objectContaining({ value: 9800 }),
          utility_rate_per_kwh: expect.objectContaining({ value: 0.16 }),
          utility_provider: expect.objectContaining({ value: "SRP" }),
        }),
        narrative: expect.objectContaining({
          headline: expect.any(String),
        }),
        badges: expect.any(Array),
      }),
    }));
  });

  it("does not hide live canonical inventory solely because marketplace_status is stale on recovered rows", async () => {
    const recoveredMarketplaceOpportunity = {
      ...assignedOpportunity,
      marketplace_status: "unreleased",
    };
    const sql = makeSql({ canonicalRows: [recoveredMarketplaceOpportunity] });
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
      opportunityId: OPP_ID,
    });
  });

  it("returns two enhanced released bill-intelligence opportunities in Discover", async () => {
    const enhancedOne = {
      ...assignedOpportunity,
      id: OPP_ID,
      claim_id: null,
      claim_status: null,
      claimed_by_user_id: null,
      city: "Phoenix",
      state_code: "AZ",
      utility_name: "APS",
      marketplace_status: "live",
      marketplace_intake_metadata: {
        operational: {},
        qualification: {},
        bill_intelligence: {
          parser_result: {
            billData: {
              utilityName: "APS",
              annualKwh: "20100",
              costPerKwh: "0.19",
              monthlyUsageHistory: ["1600", null, "bad", 1750],
              extractedFields: ["utilityName", "annualKwh"],
            },
            metadata: { parserMethod: "pdf_text", claudeModel: "claude-test" },
          },
          marketplace_projection: {
            utility_provider: "APS",
            annual_usage_kwh: 20100,
            monthly_usage_avg_kwh: 1675,
            utility_rate_per_kwh: 0.19,
            estimated_system_size_kw: 13.4,
          },
        },
      },
      marketplace_raw_payload: {
        bill_intelligence: {
          extraction: { status: "complete", confidence_label: "high", confidence: "0.93" },
          parser_result: {
            billData: {
              utilityName: "APS",
              annualKwh: "20100",
              costPerKwh: "0.19",
              monthlyUsageHistory: ["1600", null, "bad", 1750],
              extractedFields: ["utilityName", "annualKwh"],
            },
          },
        },
      },
    };
    const enhancedTwo = {
      ...enhancedOne,
      id: "55555555-5555-4555-8555-555555555555",
      city: "Tucson",
      utility_name: "TEP",
      marketplace_raw_payload: {
        bill_intelligence: {
          bill: {
            utility_provider: "TEP",
            monthly_usage_history: [900, "950", undefined, -1],
            bill_type: "electric",
          },
        },
      },
    };
    const sql = makeSql({ canonicalRows: [enhancedOne, enhancedTwo] });
    mockGetDbReady.mockResolvedValueOnce(sql);
    const { GET } = await import("@/app/api/network/opportunities/route");

    const res = await GET(req("https://solarpro.test/api/network/opportunities"));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.total).toBe(2);
    expect(json.opportunities.map((opp: { id: string }) => opp.id)).toEqual([
      OPP_ID,
      "55555555-5555-4555-8555-555555555555",
    ]);
    expect(json.opportunities[0].marketplace_intelligence.bill_visuals).toMatchObject({
      months_found: 2,
      monthly_usage_history: [1600, 1750],
      confidence_label: "high",
    });
    expect(json.opportunities[1].marketplace_intelligence.bill_visuals).toMatchObject({
      months_found: 2,
      monthly_usage_history: [900, 950],
      bill_type: "electric",
    });
  });

  it("does not hide live canonical inventory solely because summary claim_count is stale", async () => {
    const staleClaimCountOpportunity = {
      ...assignedOpportunity,
      claim_count: 1,
      max_claims: 1,
    };
    const sql = makeSql({ canonicalRows: [staleClaimCountOpportunity] });
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
      opportunityId: OPP_ID,
    });
  });

  it("filters ineligible canonical marketplace inventory out of Discover", async () => {
    const sql = makeSql({ canonicalRows: [assignedOpportunity, ineligibleOpportunity] });
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
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
    expect(infoSpy).toHaveBeenCalledWith(
      "[MARKETPLACE VISIBILITY DENIED]",
      expect.objectContaining({
        id: INELIGIBLE_OPP_ID,
        contractor_id: USER_ID,
        denials: ["battery_certification_required"],
      }),
    );
    infoSpy.mockRestore();
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
      { params: Promise.resolve({ id: OPP_ID }) },
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
