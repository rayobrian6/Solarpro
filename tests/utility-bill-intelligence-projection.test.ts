import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetDbReady, mockParseUtilityBill, mockEnrichBillData, mockEnrichAndPersistOpportunity } = vi.hoisted(() => ({
  mockGetDbReady: vi.fn(),
  mockParseUtilityBill: vi.fn(),
  mockEnrichBillData: vi.fn(),
  mockEnrichAndPersistOpportunity: vi.fn(),
}));

vi.mock("@/lib/db-neon", () => ({ getDbReady: mockGetDbReady }));
vi.mock("@/lib/billPipeline", () => ({
  parseUtilityBill: mockParseUtilityBill,
  mapAiResultToBillExtractResult: vi.fn(),
}));
vi.mock("@/lib/billEnrichment", () => ({ enrichBillData: mockEnrichBillData }));
vi.mock("@/lib/network/opportunityEnrichment", () => ({
  enrichAndPersistOpportunity: mockEnrichAndPersistOpportunity,
}));
vi.mock("@/lib/billClaudeExtractor", () => ({ extractBillWithClaude: vi.fn() }));

type SqlMock = ReturnType<typeof vi.fn> & { calls: Array<{ query: string; values: unknown[] }> };

function makeSql(): SqlMock {
  const calls: Array<{ query: string; values: unknown[] }> = [];
  const sql = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join(" ");
    calls.push({ query, values });

    if (
      query.includes("payload->'bill_intelligence' AS bill_intelligence") &&
      query.includes("payload->'bill_marketplace_projection' AS bill_marketplace_projection")
    ) {
      return [
        {
          bill_intelligence: {
            parser_result: {
              billData: {
                utilityProvider: "Austin Energy",
                monthlyKwh: 1500,
                annualKwh: 18000,
                electricityRate: 0.19,
                extractedFields: ["utilityProvider", "monthlyKwh", "annualKwh"],
              },
            },
            extraction: { extracted_fields: ["utilityProvider", "monthlyKwh", "annualKwh"] },
          },
          bill_marketplace_projection: {
            utility_provider: "Austin Energy",
            monthly_usage_avg_kwh: 1500,
            annual_usage_kwh: 18000,
            utility_rate_per_kwh: 0.19,
            estimated_system_size_kw: 12.1,
          },
          pipeline_bill_intelligence: { status: "completed" },
        },
      ];
    }

    if (query.includes("FROM intake_events") && query.includes("WHERE id::text")) {
      return [
        {
          id: "11111111-1111-4111-8111-111111111111",
          event_id: "evt-bill-existing",
          opportunity_id: "opp-existing-1",
          payload: {
            state: "TX",
            bill_metadata: {
              storage_status: "stored",
              download_url: "https://files.test/bill.pdf",
              content_type: "application/pdf",
              filename: "bill.pdf",
              storage_provider: "test",
            },
          },
          pipeline_result: {},
          source_system: "homeowner_form",
          source_channel: "web",
          funnel_id: null,
          campaign_id: null,
        },
      ];
    }

    return [];
  }) as SqlMock;
  sql.calls = calls;
  return sql;
}

describe("utility bill intelligence projection", () => {
  beforeEach(() => {
    vi.resetModules();
    mockGetDbReady.mockReset();
    mockParseUtilityBill.mockReset();
    mockEnrichBillData.mockReset();
    mockEnrichAndPersistOpportunity.mockReset();
    global.fetch = vi.fn(async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "application/pdf" },
      }),
    ) as typeof fetch;
  });

  it("projects full parsed bill intelligence onto an existing canonical opportunity for Discover", async () => {
    const sql = makeSql();
    mockGetDbReady.mockResolvedValue(sql);
    mockParseUtilityBill.mockResolvedValue({
      success: true,
      extractionMethod: "pdf-parser",
      data: {
        success: true,
        utilityProvider: "Austin Energy",
        monthlyKwh: 1500,
        annualKwh: 18000,
        electricityRate: 0.19,
        totalAmount: 285,
        monthlyUsageHistory: [1480, 1500, 1520],
        confidence: "high",
        extractedFields: ["utilityProvider", "monthlyKwh", "annualKwh", "electricityRate"],
        rawText: "Austin Energy bill with 1500 kWh usage",
      },
    });
    mockEnrichBillData.mockResolvedValue({
      canonicalName: "Austin Energy",
      canonicalId: "utility-austin-energy",
      effectiveRate: 0.19,
      rateSource: "parsed",
      netMetering: true,
    });

    const { ingestUtilityBillIntelligence } = await import("@/lib/intake/utilityBillIntelligence");

    const result = await ingestUtilityBillIntelligence({
      eventId: "evt-bill-existing",
      trigger: "operator_review",
    });

    expect(result.ok).toBe(true);
    const canonicalUpdate = sql.calls.find((call) =>
      call.query.includes("UPDATE network_opportunities") && call.query.includes("WHERE id ="),
    );
    expect(canonicalUpdate).toBeTruthy();
    expect(canonicalUpdate?.query).toContain("raw_payload = jsonb_set");
    expect(canonicalUpdate?.query).toContain("'{bill_intelligence}'");
    expect(canonicalUpdate?.query).toContain("'{bill_marketplace_projection}'");
    expect(canonicalUpdate?.query).toContain("intake_metadata = jsonb_set");

    expect(canonicalUpdate?.values.slice(0, 10)).toEqual([
      "Austin Energy",
      1500,
      18000,
      0.19,
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      true,
      "high_usage,high_utility_rate",
    ]);

    const parsedJsonValues = (canonicalUpdate?.values ?? [])
      .filter((value): value is string => typeof value === "string" && value.startsWith("{"))
      .map((value) => JSON.parse(value) as Record<string, unknown>);
    const intelligencePayload = parsedJsonValues.find((value) => "parser_result" in value);
    const projectionPayload = parsedJsonValues.find(
      (value) => "annual_usage_kwh" in value && !("parser_result" in value),
    );
    expect(intelligencePayload).toMatchObject({
      schema_version: "utility-bill-intelligence.v1",
      bill: { utility_provider: "Austin Energy", annual_kwh: 18000 },
      marketplace_projection: {
        utility_provider: "Austin Energy",
        annual_usage_kwh: 18000,
        utility_rate_per_kwh: 0.19,
      },
    });
    expect(projectionPayload).toMatchObject({
      utility_provider: "Austin Energy",
      monthly_usage_avg_kwh: 1500,
      annual_usage_kwh: 18000,
      utility_rate_per_kwh: 0.19,
    });
    expect(mockEnrichAndPersistOpportunity).toHaveBeenCalledWith(sql, "opp-existing-1", {
      triggeredBy: "system",
      logEvent: true,
    });
  });
});
