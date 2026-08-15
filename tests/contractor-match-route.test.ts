import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRequireAdminApi = vi.fn();
const mockGetDbReady = vi.fn();
const mockMatchContractors = vi.fn();
const mockLogNetworkEvent = vi.fn();

vi.mock("@/lib/adminAuth", () => ({ requireAdminApi: mockRequireAdminApi }));
vi.mock("@/lib/db-neon", () => ({ getDbReady: mockGetDbReady }));
vi.mock("@/lib/network/contractorMatcher", () => ({
  matchContractors: mockMatchContractors,
}));
vi.mock("@/lib/network/attributionTracker", () => ({
  logNetworkEvent: mockLogNetworkEvent,
}));

async function importRoute() {
  return import("@/app/api/admin/network/contractor-match/[id]/route");
}

function req(body?: unknown, method = "POST"): any {
  return new Request(
    "https://solarpro.test/api/admin/network/contractor-match/opp-1",
    {
      method,
      headers: {
        "content-type": "application/json",
        cookie: "solarpro_session=test",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
}

function makeSql(
  opts: {
    gate?: Record<string, unknown> | null;
    insertRows?: any[];
    oppRows?: any[];
    assignments?: any[];
  } = {},
) {
  const calls: string[] = [];
  const sql = vi.fn(async (strings: TemplateStringsArray) => {
    const q = strings.join(" ");
    calls.push(q);
    if (q.includes("SELECT no.id, no.status, no.screening_status"))
      return opts.gate === undefined
        ? [
            {
              id: "opp-1",
              status: "live",
              screening_status: "approved",
              auto_decision: null,
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
          ]
        : opts.gate
          ? [opts.gate]
          : [];
    if (q.includes("INSERT INTO opportunity_assignments"))
      return opts.insertRows ?? [{ id: "assignment-1" }];
    if (q.includes("FROM network_opportunities WHERE id"))
      return opts.oppRows ?? [{ id: "opp-1", state: "CA", status: "live" }];
    if (q.includes("FROM opportunity_assignments oa"))
      return opts.assignments ?? [];
    if (q.includes("FROM opportunity_intelligence")) return [];
    return [];
  }) as any;
  sql.calls = calls;
  return sql;
}

describe("/api/admin/network/contractor-match/[id]", () => {
  beforeEach(() => {
    vi.resetModules();
    mockRequireAdminApi.mockReset().mockResolvedValue({
      id: "admin-1",
      role: "admin",
      name: "Admin",
      email: "admin@test.com",
    });
    mockGetDbReady.mockReset().mockResolvedValue(makeSql());
    mockMatchContractors.mockReset().mockResolvedValue({
      opportunity_id: "opp-1",
      total_eligible: 1,
      top_match: { contractor_id: "contractor-1", overall_score: 91 },
      matches: [
        {
          contractor_id: "contractor-1",
          company_name: "A Solar",
          overall_score: 91,
          geo_score: 100,
          size_fit_score: 90,
          service_score: 90,
          performance_score: 90,
          capacity_score: 90,
          match_reasons: ["serves_CA"],
          match_concerns: [],
        },
      ],
      matched_at: "2025-01-01T00:00:00Z",
    });
    mockLogNetworkEvent.mockReset().mockResolvedValue(undefined);
  });

  it("GET uses canonical opportunity and contractor profile aliases", async () => {
    const sql = makeSql();
    mockGetDbReady.mockResolvedValueOnce(sql);
    const { GET } = await importRoute();
    const res = await GET(req(undefined, "GET"), { params: Promise.resolve({ id: "opp-1" }) });
    expect(res.status).toBe(200);
    const opportunityQuery =
      sql.calls.find((q: string) =>
        q.includes("FROM network_opportunities WHERE id"),
      ) ?? "";
    expect(opportunityQuery).toContain("location_state AS state");
    expect(opportunityQuery).toContain("location_city AS city");
    expect(opportunityQuery).toContain("homeowner_name");
    expect(opportunityQuery).not.toContain("homeowner_first_name");
    expect(opportunityQuery).not.toContain("homeowner_last_name");
    expect(opportunityQuery).not.toContain("SELECT id, state");

    const assignmentsQuery =
      sql.calls.find((q: string) =>
        q.includes("FROM opportunity_assignments oa"),
      ) ?? "";
    expect(assignmentsQuery).toContain("u.company");
    expect(assignmentsQuery).toContain("cp.profile_complete");
    expect(assignmentsQuery).not.toContain("cp.company_name");
    expect(assignmentsQuery).not.toContain("cp.avg_rating");
    expect(assignmentsQuery).not.toContain("cp.tier");
  });

  it("POST counts actual inserted assignment rows", async () => {
    const { POST } = await importRoute();
    const res = await POST(req({ create_assignments: true }), {
      params: Promise.resolve({ id: "opp-1" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      assignments_created: 1,
      total_eligible: 1,
    });
    expect(mockLogNetworkEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: "assignment.offered",
        data: expect.objectContaining({
          source: "contractor_match",
          assignments_created: 1,
        }),
      }),
    );
  });

  it("POST returns a visible conflict when matches create zero rows", async () => {
    mockGetDbReady.mockResolvedValueOnce(makeSql({ insertRows: [] }));
    const { POST } = await importRoute();
    const res = await POST(req({ create_assignments: true }), {
      params: Promise.resolve({ id: "opp-1" }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      success: false,
      error:
        "Matched contractors were found, but no assignment offers were created",
      details: {
        total_eligible: 1,
        matches_returned: 1,
        assignments_created: 0,
      },
    });
    expect(mockLogNetworkEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: "assignment.offer_insert_skipped",
      }),
    );
  });
});
