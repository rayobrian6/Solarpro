import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRequireAdminApi = vi.fn();
const mockGetDbReady = vi.fn();
const mockLogNetworkEvent = vi.fn();

vi.mock("@/lib/adminAuth", () => ({ requireAdminApi: mockRequireAdminApi }));
vi.mock("@/lib/db-neon", () => ({ getDbReady: mockGetDbReady }));
vi.mock("@/lib/network/attributionTracker", () => ({ logNetworkEvent: mockLogNetworkEvent }));
vi.mock("@/lib/network/opportunityEnrichment", () => ({ enrichAndPersistOpportunity: vi.fn() }));

function req(body: unknown): any {
  return new Request("https://solarpro.test/api/admin/network/opportunities", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      cookie: "solarpro_session=test",
    },
    body: JSON.stringify(body),
  });
}

function makeSql() {
  const calls: string[] = [];
  const sql = vi.fn(async (strings: TemplateStringsArray) => {
    const q = strings.join(" ");
    calls.push(q);

    if (q.includes("SELECT no.id, no.status, no.screening_status")) {
      return [
        {
          id: "opp-1",
          status: "scored",
          screening_status: "approved",
          auto_decision: "pass",
          override_decision: null,
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
          raw_payload: {},
        },
      ];
    }

    if (q.includes("UPDATE network_opportunities SET")) return [];
    return [];
  }) as any;
  sql.calls = calls;
  return sql;
}

describe("/api/admin/network/opportunities publish", () => {
  beforeEach(() => {
    vi.resetModules();
    mockRequireAdminApi.mockReset().mockResolvedValue({ id: "admin-1", role: "admin" });
    mockLogNetworkEvent.mockReset().mockResolvedValue(undefined);
  });

  it("sets canonical marketplace release fields when publishing", async () => {
    const sql = makeSql();
    mockGetDbReady.mockResolvedValueOnce(sql);
    const { PATCH } = await import("@/app/api/admin/network/opportunities/route");

    const res = await PATCH(req({ action: "publish", opportunity_ids: ["opp-1"] }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, results: ["Published: opp-1"] });
    const updateQuery = sql.calls.find((q: string) => q.includes("UPDATE network_opportunities SET")) ?? "";
    expect(updateQuery).toContain("status = 'live'");
    expect(updateQuery).toContain("marketplace_status = 'live'");
    expect(updateQuery).toContain("released_at = COALESCE(released_at, NOW())");
    expect(updateQuery).toContain("released_by = COALESCE(released_by,");
  });
});
