import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const mockRequireAdminApi = vi.fn();
const mockGetDbReady = vi.fn();
const mockMatchContractors = vi.fn();
const mockLogNetworkEvent = vi.fn();
const mockReleaseMarketplaceInventoryFromIntake = vi.fn();
const mockTransitionMarketplaceInventory = vi.fn();

vi.mock("@/lib/adminAuth", () => ({ requireAdminApi: mockRequireAdminApi }));
vi.mock("@/lib/db-neon", () => ({ getDbReady: mockGetDbReady }));
vi.mock("@/lib/network/contractorMatcher", () => ({
  matchContractors: mockMatchContractors,
}));
vi.mock("@/lib/network/marketplaceInventory", () => ({
  releaseMarketplaceInventoryFromIntake: mockReleaseMarketplaceInventoryFromIntake,
  transitionMarketplaceInventory: mockTransitionMarketplaceInventory,
}));
vi.mock("@/lib/network/attributionTracker", () => ({
  logNetworkEvent: mockLogNetworkEvent,
}));

async function importRoute() {
  return import("@/app/api/admin/network/marketplace/route");
}

function req(body?: unknown, method = "POST"): any {
  return new Request("https://solarpro.test/api/admin/network/marketplace", {
    method,
    headers: {
      "content-type": "application/json",
      cookie: "solarpro_session=test",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function makeSql(
  opts: {
    gate?: Record<string, unknown> | null;
    existingAssignments?: any[];
    listRows?: any[];
    insertRows?: any[];
    failOn?: string;
    failError?: Error & { code?: string; column?: string; detail?: string };
  } = {},
) {
  const calls: string[] = [];
  const sql = vi.fn(async (strings: TemplateStringsArray) => {
    const q = strings.join(" ");
    calls.push(q);
    if (opts.failOn && q.includes(opts.failOn))
      throw opts.failError ?? new Error("mock db failure");
    if (q.includes("WITH assignment_summary"))
      return (
        opts.listRows ?? [
          {
            id: "live-1",
            status: "live",
            screening_status: "approved",
            overall_score: 88,
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
      );
    if (q.includes("SELECT COUNT(*)::int AS total"))
      return [{ total: (opts.listRows ?? [1]).length }];
    if (q.includes("SELECT no.id, no.status, no.screening_status"))
      return opts.gate === undefined
        ? [
            {
              id: "live-1",
              status: "live",
              screening_status: "approved",
              auto_decision: "pass",
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
    if (
      q.includes("FROM opportunity_assignments") &&
      q.includes("status IN ('offered'")
    )
      return opts.existingAssignments ?? [];
    if (q.includes("INSERT INTO opportunity_assignments"))
      return opts.insertRows ?? [{ id: "assignment-1" }];
    return [];
  }) as any;
  sql.calls = calls;
  return sql;
}

describe("/api/admin/network/marketplace", () => {
  beforeEach(() => {
    vi.resetModules();
    mockRequireAdminApi
      .mockReset()
      .mockResolvedValue({
        id: "admin-1",
        role: "admin",
        name: "Admin",
        email: "admin@test.com",
      });
    mockGetDbReady.mockReset().mockResolvedValue(makeSql());
    mockMatchContractors.mockReset().mockResolvedValue({
      opportunity_id: "live-1",
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
    mockReleaseMarketplaceInventoryFromIntake.mockReset().mockResolvedValue({
      ok: true,
      status: 201,
      action: "release",
      opportunity: { id: "released-1", status: "live", marketplace_status: "live" },
      release_gate_result: { ok: true, missing: [] },
    });
    mockTransitionMarketplaceInventory.mockReset().mockResolvedValue({
      ok: true,
      status: 200,
      action: "pause",
      opportunity: { id: "live-1", status: "scored", marketplace_status: "paused" },
      release_gate_result: { ok: true, missing: [] },
    });
  });

  it("rejects unauthenticated callers", async () => {
    mockRequireAdminApi.mockResolvedValueOnce(null);
    const { GET } = await importRoute();
    const res = await GET(req(undefined, "GET"));
    expect(res.status).toBe(403);
  });

  it("lists only live screening-approved opportunities in the query guard", async () => {
    const sql = makeSql({
      listRows: [
        {
          id: "live-1",
          status: "live",
          screening_status: "approved",
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
      ],
    });
    mockGetDbReady.mockResolvedValueOnce(sql);
    const { GET } = await importRoute();
    const res = await GET(req(undefined, "GET"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      opportunities: [{ id: "live-1" }],
    });
    const listQuery =
      sql.calls.find((q: string) => q.includes("WITH assignment_summary")) ??
      "";
    expect(listQuery).toContain("WHERE no.status = 'live'");
    expect(listQuery).toContain("no.screening_status = 'approved'");
    expect(listQuery).toContain("osq.auto_decision = 'pass'");
    expect(listQuery).toContain("osq.override_decision = 'pass'");
    expect(listQuery).toContain("approved_for_marketplace");
    expect(listQuery).toContain("no.location_city AS city");
    expect(listQuery).toContain("no.location_state AS state");
    expect(listQuery).toContain("no.asking_price AS listing_price");
    expect(listQuery).toContain("oi.enrichment_payload");
    expect(listQuery).toContain("oi.enrichment_completeness");
    expect(listQuery).toContain("oi.enrichment_warnings");
    expect(listQuery).not.toContain("no.city");
    expect(listQuery).not.toContain("no.state");
    expect(listQuery).not.toContain("no.listing_price");
    expect(listQuery).not.toContain("homeowner_first_name");
  });

  it("keeps the Marketplace Workbench gate aligned with simulator marketplace_ready logic", () => {
    const marketplaceSource = fs.readFileSync(
      path.join(process.cwd(), "app/api/admin/network/marketplace/route.ts"),
      "utf8",
    );
    const simulatorSource = fs.readFileSync(
      path.join(process.cwd(), "app/api/admin/network/simulator/route.ts"),
      "utf8",
    );
    const readyGate =
      "no.status = 'live' AND (no.screening_status = 'approved' OR osq.auto_decision = 'pass' OR osq.override_decision = 'pass')";
    expect(simulatorSource).toContain(readyGate);
    expect(marketplaceSource).toContain("WHERE no.status = 'live'");
    expect(marketplaceSource).toContain(
      "AND (no.screening_status = 'approved' OR osq.auto_decision = 'pass' OR osq.override_decision = 'pass')",
    );
    expect(marketplaceSource).toContain("approved_for_marketplace");
  });

  it("returns stage-aware Workbench list failures for deployed schema diagnostics", async () => {
    const err = new Error(
      "column oi.enrichment_payload does not exist",
    ) as Error & { code?: string; column?: string };
    err.code = "42703";
    err.column = "enrichment_payload";
    mockGetDbReady.mockResolvedValueOnce(
      makeSql({ failOn: "WITH assignment_summary", failError: err }),
    );
    const { GET } = await importRoute();
    const res = await GET(req(undefined, "GET"));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toMatchObject({
      success: false,
      error: "Marketplace Workbench failed",
      stage: "list_query",
      code: "42703",
      message: "column oi.enrichment_payload does not exist",
      details: { column: "enrichment_payload" },
    });
    expect(JSON.stringify(json)).not.toMatch(/DATABASE_URL|JWT_SECRET|ghp_/);
  });

  it("releases approved intake events through the inventory helper", async () => {
    const { POST } = await importRoute();
    const res = await POST(
      req({
        action: "release_from_intake",
        intake_event_id: "intake-1",
        asking_price: 250,
        listing_notes: "Ready for marketplace",
        expires_days: 14,
        claim_mode: "shared",
        max_claims: 3,
      }),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      success: true,
      ok: true,
      opportunity_id: "released-1",
      opportunity: { id: "released-1", marketplace_status: "live" },
    });
    expect(mockReleaseMarketplaceInventoryFromIntake).toHaveBeenCalledWith({
      sql: expect.any(Function),
      intakeEventId: "intake-1",
      adminUserId: "admin-1",
      askingPrice: 250,
      listingNotes: "Ready for marketplace",
      expiresDays: 14,
      claimMode: "shared",
      maxClaims: 3,
    });
    expect(mockMatchContractors).not.toHaveBeenCalled();
  });

  it("returns explainable release gate failures from inventory release", async () => {
    mockReleaseMarketplaceInventoryFromIntake.mockResolvedValueOnce({
      ok: false,
      status: 409,
      error: "Intake event is not ready for marketplace release",
      release_gate_result: {
        ok: false,
        missing: ["homeowner_contacted", "approved_for_marketplace"],
      },
    });
    const { POST } = await importRoute();
    const res = await POST(
      req({ action: "release_from_intake", intake_event_id: "intake-blocked" }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      success: false,
      error: "Intake event is not ready for marketplace release",
      details: {
        release_gate_result: {
          ok: false,
          missing: ["homeowner_contacted", "approved_for_marketplace"],
        },
      },
    });
  });

  it("routes pause, unrelease, archive, and release through inventory transition helper", async () => {
    const { POST } = await importRoute();
    for (const action of ["pause", "unrelease", "archive", "release"] as const) {
      mockTransitionMarketplaceInventory.mockClear();
      const res = await POST(
        req({ action, opportunity_id: "live-1", reason: `${action} reason` }),
      );
      expect(res.status).toBe(200);
      expect(mockTransitionMarketplaceInventory).toHaveBeenCalledWith({
        sql: expect.any(Function),
        opportunityId: "live-1",
        adminUserId: "admin-1",
        action,
        reason: `${action} reason`,
      });
    }
  });

  it("blocks assignment actions for non-live or unapproved opportunities", async () => {
    mockGetDbReady.mockResolvedValueOnce(
      makeSql({
        gate: { id: "opp-1", status: "scored", screening_status: "approved" },
      }),
    );
    const { POST } = await importRoute();
    const res = await POST(
      req({ action: "create_assignments", opportunity_id: "opp-1" }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/Only live opportunities/);
    expect(mockMatchContractors).not.toHaveBeenCalled();
  });

  it("blocks duplicate active assignment creation", async () => {
    mockGetDbReady.mockResolvedValueOnce(
      makeSql({
        existingAssignments: [
          { id: "assignment-existing", status: "offered", contractor_id: "c1" },
        ],
      }),
    );
    const { POST } = await importRoute();
    const res = await POST(
      req({ action: "create_assignments", opportunity_id: "live-1" }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already has active assignments/);
  });

  it("creates assignments through matcher output and logs network event", async () => {
    const { POST } = await importRoute();
    const res = await POST(
      req({ action: "create_assignments", opportunity_id: "live-1" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      assignments_created: 1,
      total_eligible: 1,
    });
    expect(mockMatchContractors).toHaveBeenCalledWith("live-1", {
      limit: 10,
      minScore: 30,
    });
    expect(mockLogNetworkEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: "assignment.offered",
        event_category: "assignment",
        opportunity_id: "live-1",
      }),
    );
  });

  it("returns a visible conflict when matched contractors do not create assignment rows", async () => {
    mockGetDbReady.mockResolvedValueOnce(makeSql({ insertRows: [] }));
    const { POST } = await importRoute();
    const res = await POST(
      req({ action: "create_assignments", opportunity_id: "live-1" }),
    );
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

  it("logs no eligible contractors when matcher returns no matches", async () => {
    mockMatchContractors.mockResolvedValueOnce({
      opportunity_id: "live-1",
      total_eligible: 0,
      top_match: null,
      matches: [],
      matched_at: "2025-01-01T00:00:00Z",
    });
    const { POST } = await importRoute();
    const res = await POST(
      req({ action: "create_assignments", opportunity_id: "live-1" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      assignments_created: 0,
    });
    expect(mockLogNetworkEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: "assignment.no_eligible_contractors",
      }),
    );
  });
});
