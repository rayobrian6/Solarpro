import { describe, expect, it, vi } from "vitest";
import { deriveMarketplaceBadges } from "@/lib/network/marketplaceBadges";
import { deriveMarketplaceConfidence } from "@/lib/network/marketplaceConfidence";
import { buildMarketplaceIntelligence } from "@/lib/network/marketplaceIntelligence";
import { buildMarketplaceNarrative } from "@/lib/network/marketplaceNarratives";
import { evaluateMarketplaceReleaseGate } from "@/lib/network/marketplaceReleaseGate";

const intakeMetadata = {
  monthly_bill_amount: 255,
  utility_provider: "PG&E",
  timeline: "1_3_months",
  homeowner_financing_interest: true,
  qualification: {
    qualification_status: "qualified",
    lead_grade: "A",
    finance_readiness: true,
  },
  operational: {
    contacted: true,
    qualified: true,
    financing_ready: true,
    approved_for_marketplace: true,
  },
  bill_metadata: {
    storage_status: "stored",
    filename: "utility-bill.pdf",
    storage_provider: "s3",
  },
  bill_intelligence: {
    parser_result: {
      billData: {
        utilityName: "PG&E",
        annualKwh: 18000,
        costPerKwh: 0.21,
        totalAmount: 260,
        monthlyUsageHistory: [1500, 1480, 1520],
        confidence: "high",
        extractedFields: ["utilityProvider", "annualKwh", "monthlyUsageHistory"],
        billType: "electric",
      },
    },
    marketplace_projection: {
      annual_usage_kwh: 18000,
      monthly_usage_avg_kwh: 1500,
      utility_rate_per_kwh: 0.21,
      estimated_system_size_kw: 12.4,
      utility_provider: "PG&E",
    },
  },
  bill_marketplace_projection: {
    annual_usage_kwh: 18000,
    monthly_usage_avg_kwh: 1500,
    utility_rate_per_kwh: 0.21,
    estimated_system_size_kw: 12.4,
    utility_provider: "PG&E",
  },
};

function gateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "opp-123",
    status: "live",
    screening_status: "approved",
    intake_metadata: intakeMetadata,
    raw_payload: {},
    ...overrides,
  };
}

describe("marketplace revenue intelligence helpers", () => {
  it("derives confidence from real release gate and bill evidence", () => {
    const releaseGate = evaluateMarketplaceReleaseGate(gateRow());
    const confidence = deriveMarketplaceConfidence({
      releaseGate,
      annualUsageKwh: 18000,
      utilityProvider: "PG&E",
      utilityRatePerKwh: 0.21,
      enrichmentCompleteness: 0.8,
    });

    expect(confidence.level).toBe("high");
    expect(confidence.reasons).toContain("Verified stored utility bill evidence");
    expect(confidence.reasons).toContain("Real parsed bill intelligence available");
  });

  it("emits only badges backed by input evidence", () => {
    vi.setSystemTime(new Date("2025-01-02T00:00:00Z"));
    const releaseGate = evaluateMarketplaceReleaseGate(gateRow());
    const confidence = deriveMarketplaceConfidence({ releaseGate, annualUsageKwh: 18000, utilityProvider: "PG&E", utilityRatePerKwh: 0.21 });
    const badges = deriveMarketplaceBadges({
      releaseGate,
      confidence,
      leadGrade: "A",
      qualificationStatus: "qualified",
      financeReadiness: true,
      homeownerStatus: "owner_occupied",
      timeline: "1_3_months",
      batteryCandidate: true,
      sunlightConfidence: "high",
      annualUsageKwh: 18000,
      utilityRatePerKwh: 0.21,
      createdAt: "2025-01-01T18:00:00Z",
      claimMode: "shared",
      claimCount: 1,
      maxClaims: 3,
    });

    expect(badges.map((badge) => badge.label)).toEqual(
      expect.arrayContaining([
        "Verified Bill",
        "Bill Parsed",
        "Utility Verified",
        "AI Qualified",
        "Financing Ready",
        "Fast Timeline",
        "High Usage",
        "Premium Rate",
      ]),
    );
    expect(badges.every((badge) => badge.reason && badge.source)).toBe(true);
    vi.useRealTimers();
  });

  it("builds deterministic narrative without inventing unavailable facts", () => {
    const releaseGate = evaluateMarketplaceReleaseGate(gateRow());
    const badges = deriveMarketplaceBadges({ releaseGate, annualUsageKwh: 18000, utilityRatePerKwh: 0.21 });
    const narrative = buildMarketplaceNarrative({
      city: "Fresno",
      stateCode: "CA",
      estimatedProjectValue: 42000,
      estimatedSystemSizeKw: 12.4,
      annualUsageKwh: 18000,
      monthlyBillAmount: 255,
      utilityProvider: "PG&E",
      utilityRatePerKwh: 0.21,
      badges,
      releaseGate,
    });

    expect(narrative.summary).toContain("Fresno, CA");
    expect(narrative.summary).toContain("$42,000 estimated project");
    expect(narrative.bullets).toContain("Homeowner-entered monthly bill: $255.");
    expect(narrative.source_note).toContain("deterministic");
  });

  it("builds contractor-safe projection with source-separated homeowner and parsed bill values", () => {
    const projection = buildMarketplaceIntelligence({
      ...gateRow(),
      city: "Fresno",
      state_code: "CA",
      estimated_system_cost: 42000,
      estimated_annual_savings: 3100,
      estimated_offset_pct: 94,
      estimated_payback_yrs: 7.2,
      system_size_kw: 11.8,
      annual_kwh: 17500,
      monthly_kwh_avg: 1458,
      utility_rate_per_kwh: 0.2,
      utility_name: "PG&E",
      monthly_bill_amount: 255,
      homeowner_status: "owner_occupied",
      timeline: "1_3_months",
      finance_readiness: true,
      lead_grade: "A",
      qualification_status: "qualified",
      battery_candidate: true,
      created_at: "2025-01-01T18:00:00Z",
      claim_mode: "shared",
      claim_count: 1,
      max_claims: 3,
      marketplace_lifecycle_status: "live",
      marketplace_screening_status: "approved",
      marketplace_intake_metadata: intakeMetadata,
      marketplace_raw_payload: {},
    });

    expect(projection.revenue.monthly_bill_amount).toMatchObject({
      value: 255,
      source: "homeowner_entered",
    });
    expect(projection.revenue.annual_usage_kwh).toMatchObject({
      value: 17500,
      source: "estimated",
    });
    expect(projection.evidence.parsed_bill.annual_usage_kwh).toBe(18000);
    expect(projection.evidence.source_separation).toEqual({
      homeowner_values_preserved: true,
      parsed_bill_values_do_not_overwrite_homeowner_intake: true,
    });
    expect(projection.bill_visuals).toMatchObject({
      confidence_label: "high",
      months_found: 3,
      monthly_usage_history: [1500, 1480, 1520],
      extracted_fields: ["utilityProvider", "annualKwh", "monthlyUsageHistory"],
      bill_type: "electric",
    });
    expect(JSON.stringify(projection)).not.toContain("marketplace_raw_payload");
    expect(JSON.stringify(projection)).not.toContain("marketplace_intake_metadata");
  });
});
