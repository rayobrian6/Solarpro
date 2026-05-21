import { beforeEach, describe, expect, it, vi } from "vitest";

const mockLogNetworkEvent = vi.fn();

vi.mock("@/lib/network/attributionTracker", () => ({
  logNetworkEvent: mockLogNetworkEvent,
}));

async function importHelper() {
  return import("@/lib/network/marketplaceInventory");
}

function sqlForQualificationFallback() {
  const calls: Array<{ query: string; values: unknown[] }> = [];
  const sql = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = strings.join(" ");
    calls.push({ query: q, values });
    if (q.includes("FROM intake_events") && q.includes("event_type = 'homeowner_intake'")) {
      return [];
    }
    if (q.includes("FROM intake_events") && q.includes("WHERE id::text")) {
      return [
        {
          id: "11111111-1111-4111-8111-111111111111",
          event_id: "evt-homeowner-1",
          event_type: "homeowner_intake",
          action: "pending_review",
          occurred_at: "2026-05-20T10:00:00.000Z",
          source_system: "homeowner_form",
          source_channel: "web",
          payload: {
            first_name: "Raymond",
            last_name: "O'Brian",
            email: "raymond@example.com",
            phone: "+18476210000",
            property_address: "123 Solar St",
            city: "Pocahontas",
            state: "IL",
            zip: "62275",
            monthly_bill_amount: 744,
            timeline: "asap",
          },
          validation_result: { valid: true, errors: [] },
          pipeline_result: {
            operational: {
              contacted: true,
              qualified: true,
              financing_ready: true,
              approved_for_marketplace: true,
              lifecycle_status: "ready_for_marketplace",
              review_status: "approved_for_marketplace",
            },
          },
        },
      ];
    }
    if (q.includes("event_type = 'homeowner_qualification'")) {
      return [
        {
          payload: {
            original_event_id: "evt-homeowner-1",
            intelligence: {
              qualification_status: "high_intent",
              lead_grade: "A",
              lead_score: 88,
              finance_readiness: true,
            },
          },
        },
      ];
    }
    if (q.includes("FROM network_opportunities") && q.includes("WHERE intake_event_id")) {
      return [];
    }
    if (q.includes("INSERT INTO network_opportunities")) {
      return [{ id: "opp-live-1", status: "live", marketplace_status: "live" }];
    }
    if (q.includes("UPDATE intake_events")) {
      return [];
    }
    return [];
  }) as any;
  sql.calls = calls;
  return sql;
}

function sqlForBillProjectionFallback() {
  const calls: Array<{ query: string; values: unknown[] }> = [];
  const sql = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = strings.join(" ");
    calls.push({ query: q, values });
    if (q.includes("FROM intake_events") && q.includes("event_type = 'homeowner_intake'")) {
      return [];
    }
    if (q.includes("FROM intake_events") && q.includes("WHERE id::text")) {
      return [
        {
          id: "22222222-2222-4222-8222-222222222222",
          event_id: "evt-homeowner-bill",
          event_type: "homeowner_intake",
          action: "pending_review",
          occurred_at: "2026-05-20T11:00:00.000Z",
          source_system: "homeowner_form",
          source_channel: "web",
          payload: {
            first_name: "Bill",
            last_name: "Upload",
            email: "bill@example.com",
            phone: "+18476211111",
            property_address: "456 Solar Ave",
            city: "Austin",
            state: "TX",
            zip: "78701",
            timeline: "1_3_months",
            bill_intelligence: {
              schema_version: "utility-bill-intelligence.v1",
              extraction: { success: true, method: "pdf_text", confidence: 0.94 },
              bill: {
                utility_provider: "Austin Energy",
                monthly_kwh: 1450,
                annual_kwh: 17400,
                total_amount: 264.63,
              },
              marketplace_projection: {
                utility_provider: "Austin Energy",
                monthly_usage_avg_kwh: 1450,
                annual_usage_kwh: 17400,
                utility_rate_per_kwh: 0.1825,
              },
            },
            bill_marketplace_projection: {
              utility_provider: "Austin Energy",
              monthly_usage_avg_kwh: 1450,
              annual_usage_kwh: 17400,
              utility_rate_per_kwh: 0.1825,
              estimated_system_size_kw: 11.7,
              battery_candidate: true,
            },
          },
          validation_result: { valid: true, errors: [] },
          pipeline_result: {
            operational: {
              contacted: true,
              qualified: true,
              financing_ready: true,
              approved_for_marketplace: true,
              lifecycle_status: "ready_for_marketplace",
              review_status: "approved_for_marketplace",
            },
          },
        },
      ];
    }
    if (q.includes("event_type = 'homeowner_qualification'")) {
      return [
        {
          payload: {
            intelligence: {
              qualification_status: "high_intent",
              lead_grade: "A",
              lead_score: 91,
              finance_readiness: true,
            },
          },
        },
      ];
    }
    if (q.includes("FROM network_opportunities") && q.includes("WHERE intake_event_id")) {
      return [];
    }
    if (q.includes("INSERT INTO network_opportunities")) {
      return [{ id: "opp-live-bill", status: "live", marketplace_status: "live" }];
    }
    if (q.includes("UPDATE intake_events")) {
      return [];
    }
    return [];
  }) as any;
  sql.calls = calls;
  return sql;
}

describe("releaseMarketplaceInventoryFromIntake", () => {
  beforeEach(() => {
    vi.resetModules();
    mockLogNetworkEvent.mockReset();
  });

  it("uses linked homeowner qualification intelligence when releasing Lead Operations intake events", async () => {
    const { releaseMarketplaceInventoryFromIntake } = await importHelper();
    const sql = sqlForQualificationFallback();

    const result = await releaseMarketplaceInventoryFromIntake({
      sql,
      intakeEventId: "evt-homeowner-1",
      adminUserId: "admin-1",
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(201);
    expect(result.opportunity.id).toBe("opp-live-1");
    expect(sql.calls.some((call: { query: string }) => call.query.includes("event_type = 'homeowner_qualification'"))).toBe(true);
    const existingLookup = sql.calls.find((call: { query: string }) =>
      call.query.includes("FROM network_opportunities") &&
      call.query.includes("WHERE intake_event_id"),
    );
    const insert = sql.calls.find((call: { query: string }) =>
      call.query.includes("INSERT INTO network_opportunities"),
    );
    expect(existingLookup?.values).toContain("11111111-1111-4111-8111-111111111111");
    expect(existingLookup?.values).not.toContain("evt-homeowner-1");
    expect(insert?.values[0]).toBe("11111111-1111-4111-8111-111111111111");
    expect(insert?.values).not.toContain("evt-homeowner-1");
    expect(mockLogNetworkEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ event_type: "opportunity.release_blocked" }),
    );
  });

  it("uses bill marketplace projection as release fallback for canonical opportunity intelligence fields", async () => {
    const { releaseMarketplaceInventoryFromIntake } = await importHelper();
    const sql = sqlForBillProjectionFallback();

    const result = await releaseMarketplaceInventoryFromIntake({
      sql,
      intakeEventId: "evt-homeowner-bill",
      adminUserId: "admin-1",
    });

    expect(result.ok).toBe(true);
    const insert = sql.calls.find((call: { query: string }) =>
      call.query.includes("INSERT INTO network_opportunities"),
    );
    expect(insert?.values).toContain("Austin Energy");
    expect(insert?.values).toContain(1450);
    expect(insert?.values).toContain(0.1825);
    expect(insert?.values).toContain(11.7);
    expect(insert?.values).toContain(true);
    const parsedJsonValues = (insert?.values ?? [])
      .filter((value: unknown): value is string =>
        typeof value === "string" &&
        value.startsWith("{") &&
        (value.includes("bill_intelligence") || value.includes("bill_marketplace_projection")),
      )
      .map((value: string) => JSON.parse(value));
    const rawPayload = parsedJsonValues.find((value: Record<string, unknown>) =>
      Object.prototype.hasOwnProperty.call(value, "first_name"),
    ) as Record<string, unknown>;
    const intakeMetadata = parsedJsonValues.find((value: Record<string, unknown>) =>
      Object.prototype.hasOwnProperty.call(value, "source_event_id"),
    ) as Record<string, unknown>;

    expect(rawPayload.bill_intelligence).toMatchObject({
      schema_version: "utility-bill-intelligence.v1",
      bill: {
        utility_provider: "Austin Energy",
        annual_kwh: 17400,
      },
      marketplace_projection: {
        annual_usage_kwh: 17400,
        utility_rate_per_kwh: 0.1825,
      },
    });
    expect(rawPayload.bill_marketplace_projection).toMatchObject({
      annual_usage_kwh: 17400,
      estimated_system_size_kw: 11.7,
    });
    expect(intakeMetadata.bill_intelligence).toMatchObject({
      schema_version: "utility-bill-intelligence.v1",
      extraction: { success: true },
    });
    expect(intakeMetadata.bill_marketplace_projection).toMatchObject({
      utility_provider: "Austin Energy",
      monthly_usage_avg_kwh: 1450,
    });
  });
});
