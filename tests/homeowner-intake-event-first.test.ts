import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetDbReady = vi.fn();
const mockRequireAdminApi = vi.fn();
const mockBlobPut = vi.hoisted(() => vi.fn());
const mockRunUtilityBillIntelligenceAsync = vi.hoisted(() => vi.fn());
const mockIngestUtilityBillIntelligence = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db-neon", () => ({ getDbReady: mockGetDbReady }));
vi.mock("@/lib/adminAuth", () => ({ requireAdminApi: mockRequireAdminApi }));
vi.mock("@vercel/blob", () => ({ put: mockBlobPut }));
vi.mock("@/lib/intake/utilityBillIntelligence", () => ({
  runUtilityBillIntelligenceAsync: mockRunUtilityBillIntelligenceAsync,
  ingestUtilityBillIntelligence: mockIngestUtilityBillIntelligence,
}));

async function importHomeownerRoute() {
  return import("@/app/api/intake/homeowner/route");
}

async function importAdminFeedRoute() {
  return import("@/app/api/admin/network/intake/route");
}

async function importAdminBillIntelligenceRoute() {
  return import("@/app/api/admin/network/intake/bill-intelligence/route");
}

function postReq(body: unknown, init: RequestInit = {}): any {
  return new Request("https://solarpro.test/api/intake/homeowner", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-real-ip": `203.0.113.${Math.floor(Math.random() * 200) + 1}`,
      ...(init.headers || {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function multipartHomeownerReq(
  payload: Record<string, unknown>,
  file: File,
): any {
  const formData = new FormData();
  formData.append("payload", JSON.stringify(payload));
  formData.append("utility_bill", file);
  return new Request("https://solarpro.test/api/intake/homeowner", {
    method: "POST",
    headers: {
      "x-real-ip": `198.51.100.${Math.floor(Math.random() * 200) + 1}`,
    },
    body: formData,
  });
}

function pdfUploadFile(name = "utility bill.pdf"): File {
  return new File([Buffer.from("%PDF-1.7\nmock utility bill\n%%EOF")], name, {
    type: "application/pdf",
  });
}

function jpegUploadFile(name = "Braidon Bill.jiff", type = "image/jiff"): File {
  return new File(
    [
      Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
      ]),
    ],
    name,
    { type },
  );
}

function adminReq(
  url = "https://solarpro.test/api/admin/network/intake?page=1&limit=25",
): any {
  return new Request(url, {
    method: "GET",
    headers: { cookie: "solarpro_session=test" },
  });
}

function adminPostReq(url: string, body: Record<string, unknown>): any {
  return new Request(url, {
    method: "POST",
    headers: {
      cookie: "solarpro_session=test",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function makeSql(
  opts: {
    failOn?: string;
    failError?: Error & { code?: string; column?: string; detail?: string };
  } = {},
) {
  const queries: string[] = [];
  const values: any[][] = [];
  const sql = vi.fn(async (strings: TemplateStringsArray, ...vals: any[]) => {
    const q = strings.join(" ");
    queries.push(q);
    values.push(vals);
    if (opts.failOn && q.includes(opts.failOn))
      throw opts.failError ?? new Error("mock db failure");
    if (q.includes("FROM intake_funnels"))
      return [
        {
          id: "funnel-1",
          campaign_id: "campaign-1",
          require_phone: true,
          require_address: true,
          is_active: true,
        },
      ];
    if (q.includes("INSERT INTO intake_events")) return [];
    if (q.includes("SELECT *, COUNT(*) OVER() AS __total"))
      return [
        {
          id: "evt_homeowner_test",
          intake_record_type: "intake_event",
          event_id: "evt_homeowner_test",
          opportunity_id: null,
          status: "pending_review",
          first_name: "Ada",
          last_name: "Lovelace",
          email: "ada@example.com",
          phone: "+14155551212",
          address_line1: "123 Solar Way",
          city: "Austin",
          state: "TX",
          zip: "78701",
          source_system: "homeowner_form",
          source_channel: "web",
          monthly_bill_amount: 350,
          event_type: "homeowner_intake",
          review_status: "pending_operator_review",
          received_at: "2025-01-01T00:00:00Z",
          source_funnel: "free-solar-estimate",
          ready_for_review: true,
          needs_missing_data: [],
          qualification_skipped: false,
          bill_attachment_metadata_only: true,
          validation_warning: [],
          enrichment_status: "pending_review",
          qualification_event_id: "qual_evt_homeowner_test",
          qualification_status: "high_intent",
          lead_grade: "A",
          finance_readiness: true,
          battery_readiness: true,
          estimated_income_band: "100k_150k",
          estimated_credit_band: "680_719",
          sunlight_confidence: "full_sun",
          property_type: "single_family",
          qualification_intelligence: {
            qualification_status: "high_intent",
            lead_grade: "A",
            finance_readiness: true,
            battery_readiness: true,
            contractor_summary: "A-Grade Opportunity\n\n• $350 utility bill",
            normalized: {
              estimated_income_band: "100k_150k",
              estimated_credit_band: "680_719",
              sunlight_confidence: "full_sun",
              property_type: "single_family",
            },
          },
          qualification_payload: { original_event_id: "evt_homeowner_test" },
          utility_provider: "Austin Energy",
          battery_interest: "yes",
          homeowner_status: "own",
          preferred_contact_method: "text",
          timeline: "1_3_months",
          roof_age: "8",
          bill_metadata: {
            filename: "bill.pdf",
            size_bytes: 71524,
            content_type: "application/pdf",
            storage_status: "metadata_only_not_uploaded",
            accessible_url: null,
          },
          bill_intelligence: {
            schema_version: "utility-bill-intelligence.v1",
            generated_at: "2025-01-01T00:01:00Z",
            extraction: { success: true, method: "ocr", confidence: 0.88 },
            bill: { monthly_kwh: 1450, annual_kwh: 17400, total_amount: 264.63 },
          },
          bill_marketplace_projection: {
            utility_provider: "Austin Energy",
            monthly_usage_avg_kwh: 1450,
            annual_usage_kwh: 17400,
            utility_rate_per_kwh: 0.1825,
            estimated_system_size_kw: 11.7,
            estimated_annual_savings: 2490.44,
            battery_candidate: true,
          },
          pipeline_result: {
            bill_intelligence: {
              status: "completed",
              trigger: "homeowner_intake",
              duration_ms: 742,
            },
          },
          intake_metadata: {
            utility_provider: "Austin Energy",
            battery_interest: "yes",
            homeowner_status: "own",
            preferred_contact_method: "text",
            timeline: "1_3_months",
            roof_age: "8",
            notes: "Homeowner notes: wants backup power",
            bill_attachment_metadata_only: true,
          },
          created_at: "2025-01-01T00:00:00Z",
          __total: 1,
        },
      ];
    if (q.includes("COUNT(*) FILTER"))
      return [
        {
          today_count: 1,
          week_count: 1,
          month_count: 1,
          total_all_time: 1,
          debug_hidden_count: 0,
          pending_review_count: 1,
        },
      ];
    if (q.includes("SELECT action, COUNT(*)"))
      return [{ action: "pending_review", count: 1 }];
    if (q.includes("CONCAT(COALESCE(source_system"))
      return [
        {
          source_system: "homeowner_form",
          source_channel: "web",
          source: "homeowner_form/web",
          count: 1,
          clean_count: 1,
        },
      ];
    if (q.includes("COUNT(*) AS total_events"))
      return [
        {
          total_events: 1,
          validation_failures: 0,
          created: 1,
          blocked: 0,
          flagged: 0,
          malformed: 0,
          errors: 0,
        },
      ];
    return [];
  }) as any;
  sql.queries = queries;
  sql.values = values;
  return sql;
}

const validPayload = {
  first_name: "Ada",
  last_name: "Lovelace",
  phone: "(415) 555-1212",
  email: "Ada@Example.com",
  address_line1: "123 Solar Way",
  property_address: "123 Solar Way",
  city: "Austin",
  state: "TX",
  zip: "78701",
  monthly_bill_amount: "350",
  average_monthly_bill: "350",
  utility_provider: "Austin Energy",
  battery_interest: "yes",
  homeowner_status: "own",
  home_ownership: "own",
  preferred_contact_method: "text",
  timeline: "1_3_months",
  roof_age: "8",
  uploaded_bill_filename: "bill.pdf",
  uploaded_bill_size_bytes: 71524,
  uploaded_bill_content_type: "application/pdf",
  source_channel: "web",
  funnel_slug: "free-solar-estimate",
  utm_source: "google",
  utm_medium: "cpc",
  utm_campaign: "spring",
  utm_content: "hero",
  utm_term: "solar estimate",
  gclid: "gclid-123",
  fbclid: "fbclid-123",
  consent_given: true,
};

describe("homeowner intake event-first flow", () => {
  beforeEach(() => {
    vi.resetModules();
    mockGetDbReady.mockReset().mockResolvedValue(makeSql());
    mockRequireAdminApi.mockReset().mockResolvedValue({
      id: "admin-1",
      role: "admin",
      email: "admin@test.com",
    });
    mockBlobPut.mockReset().mockResolvedValue({
      url: "https://blob.solarpro.test/intake/utility-bills/free-solar-estimate/evt/file.jpg",
      downloadUrl:
        "https://blob.solarpro.test/intake/utility-bills/free-solar-estimate/evt/file.jpg?download=1",
    });
    mockRunUtilityBillIntelligenceAsync.mockReset();
    mockIngestUtilityBillIntelligence.mockReset().mockResolvedValue({
      ok: true,
      projected: {
        utility_provider: "Austin Energy",
        monthly_usage_avg_kwh: 1450,
        annual_usage_kwh: 17400,
        utility_rate_per_kwh: 0.1825,
        estimated_system_size_kw: 11.7,
        estimated_annual_savings: 2490.44,
        battery_candidate: true,
      },
      opportunity_id: null,
      intelligence: {
        schema_version: "utility-bill-intelligence.v1",
        extraction: {
          method: "claude-3-5-sonnet",
          parser_path: "claude-image",
          confidence_label: "high",
          extracted_fields: ["utilityProvider", "monthlyKwh"],
        },
        parser_result: {
          success: true,
          extractionMethod: "claude-3-5-sonnet",
          parserPath: "claude-image",
          elapsedMs: 1234,
          billData: {
            confidence: "high",
            extractedFields: ["utilityProvider", "monthlyKwh"],
            utilityProvider: "Austin Energy",
            monthlyKwh: 1450,
          },
          extractionEvidence: {
            monthlySource: "claude-image",
            monthsFound: 12,
          },
          claude: {
            status: "complete",
            model: "claude-sonnet-4-5-20250929",
            inputType: "image",
            validationFlags: {},
          },
        },
      },
      parser_result: {
        success: true,
        extractionMethod: "claude-3-5-sonnet",
        parserPath: "claude-image",
        elapsedMs: 1234,
      },
    });
    vi.unstubAllEnvs();
  });

  it("persists valid homeowner submissions only to canonical intake_events and returns an event reference", async () => {
    const sql = makeSql();
    mockGetDbReady.mockResolvedValue(sql);
    const { POST } = await importHomeownerRoute();
    const res = await POST(postReq(validPayload));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({
      success: true,
      opportunity_id: null,
      review_status: "pending_operator_review",
    });
    expect(json.event_id).toMatch(/^evt_homeowner_/);
    expect(
      sql.queries.some((q: string) => q.includes("INSERT INTO intake_events")),
    ).toBe(true);
    expect(
      sql.queries.some((q: string) =>
        q.includes("INSERT INTO network_opportunities"),
      ),
    ).toBe(false);
    expect(
      sql.queries.some((q: string) =>
        q.includes("INSERT INTO opportunity_sources"),
      ),
    ).toBe(false);
    expect(
      sql.queries.some((q: string) =>
        q.includes("INSERT INTO enrichment_queue"),
      ),
    ).toBe(false);

    const insertIndex = sql.queries.findIndex((q: string) =>
      q.includes("INSERT INTO intake_events"),
    );
    const payloadJson = sql.values[insertIndex].find(
      (v: unknown) =>
        typeof v === "string" && v.includes("canonical_review_flow"),
    ) as string;
    expect(payloadJson).toContain("Austin Energy");
    const parsedPayload = JSON.parse(payloadJson);
    expect(parsedPayload.monthly_bill_amount).toBe(350);
    expect(parsedPayload.average_monthly_bill).toBe("350");
    expect(parsedPayload.bill_metadata).toMatchObject({
      filename: "bill.pdf",
      size_bytes: 71524,
      content_type: "application/pdf",
      storage_status: "metadata_only_not_uploaded",
      accessible_url: null,
    });
    expect(parsedPayload.bill_attachment_metadata_only).toBe(true);
    expect(parsedPayload.monthly_bill_amount).not.toBe(
      parsedPayload.bill_metadata.size_bytes,
    );
    expect(payloadJson).toContain("bill.pdf");
    expect(payloadJson).toContain("gclid-123");
    expect(sql.values[insertIndex]).toContain("pending_review");
    expect(sql.values[insertIndex]).toContain("google");
    expect(sql.values[insertIndex]).toContain("fbclid-123");
  });

  it("does not drop a homeowner intake when production bill storage is not configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    const sql = makeSql();
    mockGetDbReady.mockResolvedValue(sql);
    const { POST } = await importHomeownerRoute();

    const res = await POST(
      multipartHomeownerReq(validPayload, pdfUploadFile("Braidon Bill.pdf")),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({
      success: true,
      opportunity_id: null,
      review_status: "pending_operator_review",
    });
    const insertIndex = sql.queries.findIndex((q: string) =>
      q.includes("INSERT INTO intake_events"),
    );
    expect(insertIndex).toBeGreaterThan(-1);
    const payloadJson = sql.values[insertIndex].find(
      (v: unknown) =>
        typeof v === "string" && v.includes("canonical_review_flow"),
    ) as string;
    const parsedPayload = JSON.parse(payloadJson);
    expect(parsedPayload.bill_attachment_metadata_only).toBe(true);
    expect(parsedPayload.bill_metadata).toMatchObject({
      filename: "Braidon Bill.pdf",
      content_type: "application/pdf",
      storage_status: "metadata_only_not_uploaded",
      upload_transport: "multipart_file_storage_failed",
      accessible_url: null,
      download_url: null,
    });
  });

  it("stores multipart .jiff uploads as Blob-backed attachment metadata when storage is configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "test_blob_token");
    const sql = makeSql();
    mockGetDbReady.mockResolvedValue(sql);
    const { POST } = await importHomeownerRoute();

    const res = await POST(
      multipartHomeownerReq(
        validPayload,
        jpegUploadFile("Braidon Bill.jiff", "image/jiff"),
      ),
    );

    expect(res.status).toBe(200);
    expect(mockBlobPut).toHaveBeenCalledTimes(1);
    expect(mockBlobPut.mock.calls[0][0]).toMatch(/Braidon-Bill\.jpg$/i);
    expect(mockBlobPut.mock.calls[0][2]).toMatchObject({
      access: "public",
      contentType: "image/jpeg",
      token: "test_blob_token",
    });
    const insertIndex = sql.queries.findIndex((q: string) =>
      q.includes("INSERT INTO intake_events"),
    );
    expect(insertIndex).toBeGreaterThan(-1);
    const payloadJson = sql.values[insertIndex].find(
      (v: unknown) =>
        typeof v === "string" && v.includes("canonical_review_flow"),
    ) as string;
    const parsedPayload = JSON.parse(payloadJson);
    expect(parsedPayload.bill_attachment_metadata_only).toBe(false);
    expect(parsedPayload.bill_metadata).toMatchObject({
      filename: "Braidon Bill.jiff",
      content_type: "image/jpeg",
      original_content_type: "image/jiff",
      detected_content_type: "image/jpeg",
      file_extension: "jpg",
      storage_status: "stored",
      storage_provider: "vercel_blob",
      accessible_url:
        "https://blob.solarpro.test/intake/utility-bills/free-solar-estimate/evt/file.jpg",
      download_url:
        "https://blob.solarpro.test/intake/utility-bills/free-solar-estimate/evt/file.jpg?download=1",
    });
    expect(mockRunUtilityBillIntelligenceAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: expect.stringMatching(/^evt_homeowner_/),
        trigger: "homeowner_intake",
        billMetadata: expect.objectContaining({
          filename: "Braidon Bill.jiff",
          storage_status: "stored",
          storage_provider: "vercel_blob",
        }),
      }),
    );
  });

  it("does not block arbitrary unknown utility bill files solely because of MIME type", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "test_blob_token");
    const sql = makeSql();
    mockGetDbReady.mockResolvedValue(sql);
    const { POST } = await importHomeownerRoute();

    const res = await POST(
      multipartHomeownerReq(
        validPayload,
        new File(
          ["not a pdf but still homeowner-provided bill evidence"],
          "Braidon Bill.fff",
          { type: "application/octet-stream" },
        ),
      ),
    );

    expect(res.status).toBe(200);
    expect(mockBlobPut).toHaveBeenCalledTimes(1);
    expect(mockBlobPut.mock.calls[0][0]).toMatch(/Braidon-Bill\.fff$/i);
    expect(mockBlobPut.mock.calls[0][2]).toMatchObject({
      access: "public",
      contentType: "application/octet-stream",
      token: "test_blob_token",
    });
    const insertIndex = sql.queries.findIndex((q: string) =>
      q.includes("INSERT INTO intake_events"),
    );
    expect(insertIndex).toBeGreaterThan(-1);
    const payloadJson = sql.values[insertIndex].find(
      (v: unknown) =>
        typeof v === "string" && v.includes("canonical_review_flow"),
    ) as string;
    const parsedPayload = JSON.parse(payloadJson);
    expect(parsedPayload.bill_attachment_metadata_only).toBe(false);
    expect(parsedPayload.bill_metadata).toMatchObject({
      filename: "Braidon Bill.fff",
      content_type: "application/octet-stream",
      original_content_type: "application/octet-stream",
      detected_content_type: null,
      file_extension: "fff",
      storage_status: "stored",
      storage_provider: "vercel_blob",
    });
  });

  it("records invalid homeowner payloads as validation_failed intake_events with clear public details", async () => {
    const sql = makeSql();
    mockGetDbReady.mockResolvedValue(sql);
    const { POST } = await importHomeownerRoute();
    const res = await POST(
      postReq({ ...validPayload, email: "not-an-email", phone: "123" }),
    );
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("Please check your information and try again.");
    expect(json.event_id).toMatch(/^evt_homeowner_/);
    expect(json.details.join(" ")).toMatch(
      /Invalid email format|Invalid phone format/,
    );
    const insertIndex = sql.queries.findIndex((q: string) =>
      q.includes("INSERT INTO intake_events"),
    );
    expect(sql.values[insertIndex]).toContain("validation_failed");
    expect(sql.values[insertIndex]).toContain("VALIDATION_FAILED");
    expect(
      sql.queries.some((q: string) =>
        q.includes("INSERT INTO network_opportunities"),
      ),
    ).toBe(false);
  });

  it("admin intake feed is admin-gated and includes event-first rows in the existing feed response shape", async () => {
    const sql = makeSql();
    mockGetDbReady.mockResolvedValue(sql);
    const { GET } = await importAdminFeedRoute();

    mockRequireAdminApi.mockResolvedValueOnce(null);
    const denied = await GET(adminReq());
    expect(denied.status).toBe(401);

    mockRequireAdminApi.mockResolvedValueOnce({
      id: "admin-1",
      role: "admin",
      email: "admin@test.com",
    });
    const res = await GET(
      adminReq(
        "https://solarpro.test/api/admin/network/intake?debug=1&search=Austin&page=1&limit=25",
      ),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ success: true, total: 1 });
    expect(json.opportunities[0]).toMatchObject({
      intake_record_type: "intake_event",
      opportunity_id: null,
      event_id: "evt_homeowner_test",
      status: "pending_review",
      utility_provider: "Austin Energy",
      battery_interest: "yes",
      homeowner_status: "own",
      preferred_contact_method: "text",
      timeline: "1_3_months",
      roof_age: "8",
      qualification_status: "high_intent",
      lead_grade: "A",
      finance_readiness: true,
      battery_readiness: true,
      estimated_income_band: "100k_150k",
      estimated_credit_band: "680_719",
      sunlight_confidence: "full_sun",
      property_type: "single_family",
      bill_metadata: {
        filename: "bill.pdf",
        size_bytes: 71524,
        storage_status: "metadata_only_not_uploaded",
      },
      bill_intelligence: {
        schema_version: "utility-bill-intelligence.v1",
      },
      bill_marketplace_projection: {
        utility_provider: "Austin Energy",
        annual_usage_kwh: 17400,
        estimated_system_size_kw: 11.7,
        battery_candidate: true,
      },
    });
    expect(json.opportunities[0].intake_metadata).toMatchObject({
      utility_provider: "Austin Energy",
      battery_interest: "yes",
    });
    expect(json.opportunities[0].intake_metadata.notes).toContain(
      "Homeowner notes",
    );
    expect(json.opportunities[0].qualification_intelligence).toMatchObject({
      qualification_status: "high_intent",
      lead_grade: "A",
      finance_readiness: true,
      battery_readiness: true,
    });

    const feedQuery =
      sql.queries.find((q: string) => q.includes("WITH opportunity_rows AS")) ??
      "";
    expect(feedQuery).toContain("FROM network_opportunities no");
    expect(feedQuery).toContain("marketplace_live");
    expect(feedQuery).toContain("COALESCE(no.source_system, no.source_type)");
    expect(feedQuery).toContain("no.source_system IS NOT NULL OR no.source_type IS NOT NULL");
    expect(feedQuery).toContain("FROM intake_events ie");
    expect(feedQuery).toContain("ie.opportunity_id IS NULL");
    expect(feedQuery).toContain("ie.event_type = 'homeowner_intake'");
    expect(feedQuery).toContain("qie.event_type = 'homeowner_qualification'");
    expect(feedQuery).toContain("qie.original_event_id = ie.event_id");
    expect(feedQuery).toContain("qualification_intelligence");
    expect(feedQuery).toContain("debug_visible");
    expect(feedQuery).toContain("ready_for_review");
    expect(feedQuery).toContain("needs_missing_data");
    expect(feedQuery).toContain("qualification_skipped");
    expect(feedQuery).toContain("bill_attachment_metadata_only");
    expect(feedQuery).toContain("AS bill_intelligence");
    expect(feedQuery).toContain("AS bill_marketplace_projection");
    expect(feedQuery).toContain("ie.payload->'bill_intelligence'");
    expect(feedQuery).toContain("ie.payload->'bill_marketplace_projection'");
    expect(feedQuery).toContain("BETWEEN 0 AND 10000");
  });

  it("admin intake feed query uses canonical opportunity columns so event-first rows are not blocked by legacy schema names", async () => {
    const sql = makeSql();
    mockGetDbReady.mockResolvedValue(sql);
    const { GET } = await importAdminFeedRoute();

    const res = await GET(
      adminReq(
        "https://solarpro.test/api/admin/network/intake?page=1&limit=25",
      ),
    );
    expect(res.status).toBe(200);

    const feedQuery =
      sql.queries.find((q: string) => q.includes("WITH opportunity_rows AS")) ??
      "";
    const statsQuery =
      sql.queries.find((q: string) => q.includes("COUNT(*) FILTER")) ?? "";

    expect(feedQuery).toContain("COALESCE(no.first_name, SPLIT_PART(no.homeowner_name, ' ', 1)) AS first_name");
    expect(feedQuery).toContain("COALESCE(no.email, no.homeowner_email) AS email");
    expect(feedQuery).toContain("COALESCE(no.phone, no.homeowner_phone) AS phone");
    expect(feedQuery).toContain("COALESCE(no.address_line1, no.address) AS address_line1");
    expect(feedQuery).toContain("WHEN COALESCE(no.raw_payload->>'monthly_bill_amount', no.raw_payload->>'monthly_bill', '') ~ '^[0-9]+(\\.[0-9]+)?$'");
    expect(feedQuery).toContain("THEN COALESCE(no.raw_payload->>'monthly_bill_amount', no.raw_payload->>'monthly_bill')::numeric");
    expect(feedQuery).toContain("jsonb_build_object(");
    expect(feedQuery).toContain("COALESCE(no.intake_metadata, '{}'::jsonb) AS intake_metadata");
    expect(feedQuery).toContain("COALESCE(no.intake_metadata->'qualification', '{}'::jsonb) AS qualification_intelligence");
    expect(feedQuery).not.toContain("'{}'::jsonb AS pipeline_result");
    expect(feedQuery).not.toContain("'{}'::jsonb AS intake_metadata");
    expect(feedQuery).not.toContain("'{}'::jsonb AS qualification_intelligence");
    expect(feedQuery).toContain("no.location_city AS city");
    expect(feedQuery).toContain("no.location_state AS state");
    expect(feedQuery).toContain("marketplace_live");
    expect(feedQuery).toContain("COALESCE(no.source_system, no.source_type)");
    expect(feedQuery).toContain("COALESCE(no.location_zip, no.zip) AS zip");
    expect(feedQuery).toContain("no.duplicate_flag AS is_duplicate");
    expect(feedQuery).toContain("no.duplicate_flag AS is_duplicate_flagged");
    expect(feedQuery).toContain("no.utility_provider AS utility_name");
    expect(feedQuery).toContain(
      "no.utility_rate_per_kwh AS electricity_rate_kwh",
    );
    expect(feedQuery).not.toContain("no.city,");
    expect(feedQuery).not.toContain("no.state,");
    expect(feedQuery).not.toContain("no.is_duplicate_flagged");
    expect(feedQuery).not.toContain("no.utility_name");
    expect(statsQuery).toContain("no.duplicate_flag AS is_duplicate_flagged");
    expect(statsQuery).not.toContain("no.is_duplicate_flagged");
  });

  it("returns stage-aware admin intake feed diagnostics for deployed schema errors", async () => {
    const err = new Error("column no.city does not exist") as Error & {
      code?: string;
      column?: string;
      detail?: string;
    };
    err.code = "42703";
    err.column = "city";
    err.detail = "Missing deployed column";
    mockGetDbReady.mockResolvedValue(
      makeSql({ failOn: "WITH opportunity_rows AS", failError: err }),
    );

    const { GET } = await importAdminFeedRoute();
    const res = await GET(
      adminReq(
        "https://solarpro.test/api/admin/network/intake?page=1&limit=25",
      ),
    );
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toMatchObject({
      success: false,
      error: "Intake Feed failed",
      stage: "feed_query",
      code: "42703",
      message: "column no.city does not exist",
      details: { column: "city", detail: "Missing deployed column" },
    });
    expect(JSON.stringify(json)).not.toMatch(/DATABASE_URL|JWT_SECRET|ghp_/);
  });



  it("admin bill intelligence retry route is admin-gated and calls the canonical intake adapter", async () => {
    const { POST } = await importAdminBillIntelligenceRoute();

    mockRequireAdminApi.mockResolvedValueOnce(null);
    const denied = await POST(
      adminPostReq(
        "https://solarpro.test/api/admin/network/intake/bill-intelligence",
        { event_id: "evt_homeowner_test" },
      ),
    );
    expect(denied.status).toBe(401);

    mockRequireAdminApi.mockResolvedValueOnce({
      id: "admin-1",
      role: "admin",
      email: "admin@test.com",
    });
    const res = await POST(
      adminPostReq(
        "https://solarpro.test/api/admin/network/intake/bill-intelligence",
        { event_id: "evt_homeowner_test" },
      ),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({
      success: true,
      status: "completed",
      opportunity_id: null,
      projected: {
        utility_provider: "Austin Energy",
        annual_usage_kwh: 17400,
        estimated_system_size_kw: 11.7,
      },
      parser_result: {
        success: true,
        extractionMethod: "claude-3-5-sonnet",
        parserPath: "claude-image",
        elapsedMs: 1234,
      },
      intelligence: {
        schema_version: "utility-bill-intelligence.v1",
      },
    });
    expect(mockIngestUtilityBillIntelligence).toHaveBeenCalledTimes(1);
    expect(mockIngestUtilityBillIntelligence).toHaveBeenCalledWith({
      eventId: "evt_homeowner_test",
      trigger: "operator_review",
    });
  });

  it("utility bill intelligence adapter preserves dashboard parser parity for stored image bills", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "lib/intake/utilityBillIntelligence.ts"),
      "utf8",
    );

    expect(source).toContain('import { extractBillWithClaude } from "@/lib/billClaudeExtractor"');
    expect(source).toContain("parseStoredBillWithDashboardParity");
    expect(source).toContain('isImageMimeType(mimeType) && process.env.ANTHROPIC_API_KEY');
    expect(source).toContain('extractBillWithClaude({ imageBuffer: buffer, mimeType }');
    expect(source).toContain("mapAiResultToBillExtractResult");
    expect(source).toContain('parserPath: "claude-image"');
    expect(source).toContain("const pipelineResult = await parseUtilityBill(buffer, mimeType)");
    expect(source).toContain("parser_result: input.parserResult");
  });

  it("admin bill intelligence retry route reports canonical adapter skip reasons", async () => {
    mockIngestUtilityBillIntelligence.mockResolvedValueOnce({
      ok: false,
      reason: "no_stored_bill",
    });
    const { POST } = await importAdminBillIntelligenceRoute();

    const res = await POST(
      adminPostReq(
        "https://solarpro.test/api/admin/network/intake/bill-intelligence",
        { event_id: "evt_homeowner_metadata_only" },
      ),
    );

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json).toMatchObject({
      success: false,
      status: "skipped",
      reason: "no_stored_bill",
    });
  });

  it("admin Intake Feed UI surfaces API errors instead of silently rendering an empty feed", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/admin/network/page.tsx"),
      "utf8",
    );
    const section = source.slice(
      source.indexOf("function IntakeFeedSection()"),
      source.indexOf("// ── Enrichment Queue Section"),
    );
    expect(section).toContain(
      "const [error, setError] = useState<string | null>(null)",
    );
    expect(section).toContain("if (!res.ok || !data.success)");
    expect(section).toContain("Intake Feed API error");
    expect(section).toContain(
      "Unable to load Intake Feed. See the API error above.",
    );
    expect(section).toContain(
      "!loading && !error && visibleLeads.length === 0",
    );
  });

  it("admin Intake Feed UI renders submitted form payload details instead of only sparse summary columns", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/admin/network/page.tsx"),
      "utf8",
    );
    const section = source.slice(
      source.indexOf("function IntakeFeedSection()"),
      source.indexOf("// ── Enrichment Queue Section"),
    );
    expect(section).toContain("Expand Details");
    expect(section).toContain("formDetailsFor");
    expect(section).toContain("Utility Provider");
    expect(section).toContain("lead.utility_provider");
    expect(section).toContain("Battery Interest");
    expect(section).toContain("lead.battery_interest");
    expect(section).toContain("Homeowner Status");
    expect(section).toContain("lead.homeowner_status");
    expect(section).toContain("Preferred Contact");
    expect(section).toContain("lead.preferred_contact_method");
    expect(section).toContain("Timeline");
    expect(section).toContain("lead.timeline");
    expect(section).toContain("Roof Age Years");
    expect(section).toContain("lead.roof_age");
    expect(section).toContain("Operational Notes");
    expect(section).toContain(`metadataText(lead, "notes")`);
    expect(section).toContain("bill_metadata");
    expect(section).toContain("Average Monthly Bill");
    expect(section).toContain("Utility Bill Evidence");
    expect(section).toContain("Metadata only — file was not uploaded/stored");
    expect(section).toContain("Stored attachment available");
    expect(section).toContain("Open Bill");
    expect(section).toContain("Download Bill");
    expect(section).toContain("No retrievable bill file is available for");
    expect(section).toContain("this intake. The homeowner selected a");
    expect(section).toContain("BLOB_READ_WRITE_TOKEN");
    expect(section).toContain("bill uploads create Open Bill / Download");
    expect(section).toContain("Bill links");
    expect(section).toContain("Utility Bill File Size Bytes");
    expect(section).toContain("Bill Intelligence");
    expect(section).toContain("billIntelligenceFor");
    expect(section).toContain("bill_marketplace_projection");
    expect(section).toContain("Run Bill Parse");
    expect(section).toContain("Retry Bill Parse");
    expect(section).toContain('fetch("/api/admin/network/intake/bill-intelligence"');
    expect(section).toContain("Parse output remains on the intake event");
    expect(section).toContain("Monthly Avg kWh");
    expect(section).toContain("Estimated System kW");
    expect(section).toContain("Dashboard Parser Output");
    expect(section).toContain("Parser Evidence");
    expect(section).toContain("Raw Text Sample");
    expect(section).toContain("parser_result");
    expect(section).toContain("parserPath");
    expect(section).not.toContain("['Bill Size'");
  });

  it("admin Intake Feed UI exposes operator workflow controls without bypassing immutable review events", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/admin/network/page.tsx"),
      "utf8",
    );
    const section = source.slice(
      source.indexOf("function IntakeFeedSection()"),
      source.indexOf("// ── Enrichment Queue Section"),
    );
    expect(section).toContain("Operator workflow controls");
    expect(section).toContain("mark_contacted");
    expect(section).toContain("mark_no_answer");
    expect(section).toContain("mark_needs_follow_up");
    expect(section).toContain("assign_operator");
    expect(section).toContain("transfer_operator");
    expect(section).toContain("add_internal_note");
    expect(section).toContain("log_contact_attempt");
    expect(section).toContain("create_follow_up_task");
    expect(section).toContain("complete_follow_up_task");
    expect(section).toContain("update_financing_stage");
    expect(section).toContain("update_proposal_stage");
    expect(section).toContain("mark_financing_ready");
    expect(section).toContain("mark_qualified");
    expect(section).toContain("approve_for_marketplace");
    expect(section).toContain("release_to_marketplace");
    expect(section).toContain("Release to Marketplace");
    expect(section).toContain("reject_lead");
    expect(section).toContain("archive_lead");
    expect(section).toContain('fetch("/api/admin/network/intake"');
  });

  it("admin Intake Feed release button reuses canonical marketplace release path", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/admin/network/page.tsx"),
      "utf8",
    );
    const section = source.slice(
      source.indexOf("function IntakeFeedSection()"),
      source.indexOf("// ── Enrichment Queue Section"),
    );
    expect(section).toContain("Release to Marketplace");
    expect(section).toContain("canReleaseToMarketplace");
    expect(section).toContain('lead.current_queue === "marketplace_ready"');
    expect(section).toContain("lead.release_readiness?.ready === true");
    expect(section).toContain('fetch("/api/admin/network/marketplace"');
    expect(section).toContain('action: "release_from_intake"');
    expect(section).toContain("intake_event_id: eventId");
    expect(section).toContain("claim_mode: claimMode");
    expect(section).toContain("expires_days: expiresDays");
    expect(section).not.toContain("/api/admin/network/release");
  });

  it("canonical intake release accepts Lead Operations event_id identifiers", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "lib/network/marketplaceInventory.ts"),
      "utf8",
    );
    const releaseSection = source.slice(
      source.indexOf("export async function releaseMarketplaceInventoryFromIntake"),
      source.indexOf("export async function transitionMarketplaceInventory"),
    );
    expect(releaseSection).toContain("WHERE id::text = ${intakeEventId}");
    expect(releaseSection).toContain("OR event_id = ${intakeEventId}");
    expect(releaseSection).toContain("event_type = 'homeowner_qualification'");
    expect(releaseSection).toContain("payload->>'original_event_id'");
    expect(releaseSection).toContain("qualificationFromPayload");
    expect(releaseSection).toContain("SET opportunity_id = ${opportunity.id as string}");
  });

  it("admin Intake Feed UI labels event review relationship and readiness signals", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/admin/network/page.tsx"),
      "utf8",
    );
    const section = source.slice(
      source.indexOf("function IntakeFeedSection()"),
      source.indexOf("// ── Enrichment Queue Section"),
    );
    expect(section).toContain("Intake Event ID");
    expect(section).toContain("Event Type");
    expect(section).toContain("Review Status");
    expect(section).toContain("Opportunity ID");
    expect(section).toContain("Not converted");
    expect(section).toContain("Ready for Review");
    expect(section).toContain("Needs Missing Data");
    expect(section).toContain("Qualification Skipped");
    expect(section).toContain("Bill Attachment Metadata Only");
    expect(section).toContain("Validation Warning");
  });
  it("admin Intake Feed renders Lead Operations queues, action modals, timelines, and debug disclosure", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/admin/network/page.tsx"),
      "utf8",
    );
    const section = source.slice(
      source.indexOf("function IntakeFeedSection()"),
      source.indexOf("// ── Enrichment Queue Section"),
    );
    expect(section).toContain("Lead Operations Queues");
    expect(section).toContain("LEAD_QUEUE_DEFINITIONS");
    const queueSource = fs.readFileSync(
      path.join(process.cwd(), "lib/intake/operationalQueues.ts"),
      "utf8",
    );
    expect(source).toContain("LEAD_OPS_QUEUE_DEFINITIONS");
    expect(source).toContain("@/lib/intake/operationalQueues");
    expect(queueSource).toContain("Needs Callback");
    expect(queueSource).toContain("Overdue Callbacks");
    expect(queueSource).toContain("Callbacks Today");
    expect(queueSource).toContain("Urgent Financing Follow-Up");
    expect(queueSource).toContain("Stale Leads");
    expect(queueSource).toContain("Missing Documents");
    expect(queueSource).toContain("Marketplace Ready");
    expect(queueSource).toContain("resolveOperationalQueue");
    expect(section).toContain("includeTestLeads");
    expect(section).toContain("openActionModal");
    expect(section).toContain("Save operator_review event");
    expect(section).toContain("follow_up_at");
    expect(section).toContain("requested_callback_at");
    expect(section).toContain("callback_reason");
    expect(section).toContain("financing_path");
    expect(section).toContain("qualification_reason");
    expect(section).toContain("final_approval_note");
    expect(section).toContain("rejection_reason");
    expect(section).toContain("archive_reason");
    expect(section).toContain("assigned_operator_id");
    expect(section).toContain("assigned_operator_name");
    expect(section).toContain("contact_result");
    expect(section).toContain("task_title");
    expect(section).toContain("task_due_at");
    expect(section).toContain("financing_stage");
    expect(section).toContain("proposal_stage");
    expect(section).toContain("Operator ID");
    expect(section).toContain("Latest Note / Contact");
    expect(section).toContain("Tasks / Release");
    expect(section).toContain("Mark as test lead");
    expect(section).toContain("Immutable Activity Timeline");
    expect(section).toContain("Debug Details");
    expect(section).toContain("Expand Details");
    expect(section).not.toContain("runOperatorAction");
  });

  it("admin Intake API validates structured operator review fields and projects queue summary fields", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/api/admin/network/intake/route.ts"),
      "utf8",
    );
    expect(source).toContain("sanitizeOperatorDetails");
    expect(source).toContain("requiredOperatorFields");
    expect(source).toContain("Missing required operator review fields");
    expect(source).toContain("Marketplace release readiness is incomplete");
    expect(source).toContain("deriveLeadOpsSummary");
    expect(source).toContain("current_queue");
    expect(source).toContain("next_follow_up_at");
    expect(source).toContain("contact_attempt_count");
    expect(source).toContain("operator_dashboard");
    expect(source).toContain("assigned_operator_id");
    expect(source).toContain("follow_up_priority");
    expect(source).toContain("contact_result");
    expect(source).toContain("task_title");
    expect(source).toContain("financing_stage");
    expect(source).toContain("proposal_stage");
    expect(source).toContain("lead_health");
    expect(source).toContain("operatorDetails");
    expect(source).toContain("release_checklist");
  });
});
