import { describe, expect, it, vi } from "vitest";
import { deriveMarketplaceBadges } from "@/lib/network/marketplaceBadges";
import { deriveMarketplaceConfidence } from "@/lib/network/marketplaceConfidence";
import { buildMarketplaceIntelligence } from "@/lib/network/marketplaceIntelligence";
import { buildMarketplaceNarrative } from "@/lib/network/marketplaceNarratives";
import { evaluateMarketplaceReleaseGate } from "@/lib/network/marketplaceReleaseGate";
import { deriveMarketplaceRevenueProjection } from "@/lib/network/marketplaceRevenueProjection";
import { derivePurchaseBehavior } from "@/lib/network/purchaseBehavior";

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
        extractedFields: [
          "utilityProvider",
          "annualKwh",
          "monthlyUsageHistory",
        ],
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
    expect(confidence.reasons).toContain(
      "Verified stored utility bill evidence",
    );
    expect(confidence.reasons).toContain(
      "Real parsed bill intelligence available",
    );
  });

  it("emits only badges backed by input evidence", () => {
    vi.setSystemTime(new Date("2025-01-02T00:00:00Z"));
    const releaseGate = evaluateMarketplaceReleaseGate(gateRow());
    const confidence = deriveMarketplaceConfidence({
      releaseGate,
      annualUsageKwh: 18000,
      utilityProvider: "PG&E",
      utilityRatePerKwh: 0.21,
    });
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
    const badges = deriveMarketplaceBadges({
      releaseGate,
      annualUsageKwh: 18000,
      utilityRatePerKwh: 0.21,
    });
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
    expect(narrative.bullets).toContain(
      "Homeowner-entered monthly bill: $255.",
    );
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
    expect(JSON.stringify(projection)).not.toContain(
      "marketplace_intake_metadata",
    );
  });
});

describe("marketplace purchase and revenue expansion", () => {
  it("adds deterministic purchase, financing, complexity, value, and score projections", () => {
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
      estimated_income_band: "high",
      estimated_credit_band: "good",
      battery_candidate: true,
      roof_material: "composition_shingle",
      roof_pitch: "4/12",
      roof_condition: "good",
      roof_age_years: 8,
      stories: 1,
      usable_roof_pct: 78,
      complex_ahj: false,
      steep_roof: false,
      created_at: "2025-01-01T18:00:00Z",
      claim_mode: "shared",
      claim_count: 1,
      max_claims: 3,
      marketplace_lifecycle_status: "live",
      marketplace_screening_status: "approved",
      marketplace_intake_metadata: intakeMetadata,
      marketplace_raw_payload: {},
    });

    expect(projection.purchase_profile.purchase_method_label).toMatch(
      /Loan|Financing/,
    );
    expect(projection.purchase_profile.readiness_label).toContain(
      "financing signal present",
    );
    expect(projection.project_value.project_value_range).toMatchObject({
      min: 37800,
      max: 46200,
      unit: "usd",
    });
    expect(projection.project_value.basis).toContain(
      "stored project value estimate",
    );
    expect(projection.financing.disclaimers[0]).toContain(
      "not a credit approval",
    );
    expect(projection.financing.score).toBeGreaterThanOrEqual(70);
    expect(projection.sales_complexity.label).toContain("sales complexity");
    expect(projection.install_complexity.profitability_label).toContain(
      "Install profile",
    );
    expect(projection.opportunity_score.score).toBeGreaterThan(60);
    expect(projection.opportunity_score.reasons).toContain(
      "Project value range available",
    );
    expect(projection.revenue.projection.project_value_range).toMatchObject({
      min: 36000,
      max: 46000,
      midpoint: 40700,
      unit: "usd",
    });
    expect(projection.revenue.projection.financed_payment_range?.label).toBe(
      "Estimated financed monthly payment range",
    );
    expect(projection.revenue.projection.ppa_lease_payment_range).toMatchObject(
      {
        unit: "usd",
        label: "Estimated PPA/lease utility replacement payment range",
      },
    );
    expect(
      projection.revenue.projection.battery_attachment_value,
    ).toMatchObject({
      min: 12000,
      max: 18000,
      unit: "usd",
    });
    expect(projection.revenue.projection.gross_opportunity_label).toMatch(
      /opportunity/i,
    );
    expect(projection.purchase_behavior.tags).toEqual(
      expect.arrayContaining([
        "financing-friendly",
        "payment-sensitive",
        "battery-ready",
        "fast-close",
      ]),
    );
    expect(projection.purchase_behavior.disclaimers[0]).toContain(
      "not credit underwriting",
    );
    expect(projection.financing.disclaimers[0]).toContain(
      "not a credit approval or loan quote",
    );
    expect(JSON.stringify(projection)).not.toContain("apr");
    expect(JSON.stringify(projection)).not.toContain("monthly_payment");
  });

  it("projects explicit PPA or lease preference without converting it into loan financing", () => {
    const projection = buildMarketplaceIntelligence({
      ...gateRow(),
      purchase_intent: "ppa_or_lease",
      finance_readiness: true,
      marketplace_intake_metadata: {
        ...intakeMetadata,
        operational: {
          ...intakeMetadata.operational,
          financing_ready: true,
        },
        qualification: {
          ...intakeMetadata.qualification,
          finance_readiness: true,
          normalized: {
            purchase_intent: "ppa_or_lease",
          },
        },
      },
      marketplace_raw_payload: {},
    });

    expect(projection.evidence.qualification.purchase_intent).toBe(
      "ppa_or_lease",
    );
    expect(projection.purchase_profile.likely_purchase_method).toBe(
      "lease_or_ppa",
    );
    expect(projection.purchase_profile.purchase_method_label).toBe(
      "Lease/PPA possible",
    );
    expect(projection.purchase_profile.readiness_label).toContain(
      "ppa or lease preference",
    );
    expect(projection.purchase_profile.purchase_method_label).not.toContain(
      "Loan",
    );
    expect(projection.badges.map((badge) => badge.label)).not.toContain(
      "Financing Ready",
    );
    expect(projection.financing.likelihood_label).toBe(
      "PPA/lease preference selected",
    );
    expect(projection.financing.payment_readiness_label).toBe(
      "Third-party ownership path selected",
    );
    expect(projection.purchase_behavior.tags).toEqual(
      expect.arrayContaining(["PPA candidate", "lease-friendly"]),
    );
    expect(projection.revenue.projection.payment_profile_label).toContain(
      "estimated PPA/lease payment",
    );
    expect(projection.release.missing).not.toContain("financing_readiness");
  });

  it("degrades gracefully without inventing purchase economics", () => {
    const projection = buildMarketplaceIntelligence({
      id: "opp-limited",
      status: "live",
      marketplace_status: "live",
      marketplace_lifecycle_status: "live",
      marketplace_screening_status: "approved",
      city: "Austin",
      state_code: "TX",
      marketplace_intake_metadata: {},
      marketplace_raw_payload: {},
    });

    expect(projection.project_value.project_value_range).toBeNull();
    expect(projection.revenue.projection.project_value_range).toBeNull();
    expect(projection.revenue.projection.financed_payment_range).toBeNull();
    expect(projection.revenue.projection.ppa_lease_payment_range).toBeNull();
    expect(projection.revenue.projection.missing).toEqual(
      expect.arrayContaining([
        "Estimated system size or annual usage required",
        "Project value required for financed payment range",
      ]),
    );
    expect(projection.purchase_behavior.primary_behavior).toBe("undetermined");
    expect(projection.project_value.value_label).toBe(
      "Project value awaiting validation",
    );
    expect(projection.purchase_profile.purchase_method_label).toBe(
      "Purchase method undetermined",
    );
    expect(projection.financing.likelihood_label).toBe(
      "Financing likelihood awaiting validation",
    );
    expect(projection.install_complexity.label).toBe(
      "Install complexity awaiting site validation",
    );
    expect(projection.opportunity_score.cautions).toEqual(
      expect.arrayContaining(["Project value unavailable"]),
    );
  });
});

describe("canonical marketplace revenue projection engine", () => {
  it("uses deterministic Illinois state pricing and approximate payment ranges", () => {
    const projection = deriveMarketplaceRevenueProjection({
      stateCode: "IL",
      estimatedSystemSizeKw: 15,
      batteryInterest: "backup",
      purchaseIntent: "ppa_or_lease",
      utilityProvider: "Ameren Illinois",
      utilityRatePerKwh: 0.18,
      monthlyBillAmount: 315,
      annualUsageKwh: 21000,
      estimatedOffsetPct: 100,
    });

    expect(projection.pricing_assumption).toMatchObject({
      state_code: "IL",
      low_price_per_watt: 2.8,
      market_price_per_watt: 3,
      premium_price_per_watt: 3.2,
    });
    expect(projection.project_value_range).toMatchObject({
      min: 42000,
      midpoint: 45000,
      max: 48000,
      unit: "usd",
    });
    expect(projection.financed_payment_range?.min).toBeGreaterThan(250);
    expect(projection.ppa_lease_payment_range?.min).toBeGreaterThan(200);
    expect(projection.battery_attachment_value).toMatchObject({
      min: 12000,
      max: 18000,
    });
    expect(projection.disclaimers.join(" ")).toContain(
      "not a contractor quote",
    );
    expect(JSON.stringify(projection)).not.toContain("dealer_fee");
  });

  it("degrades without fabricating impossible payment outputs", () => {
    const projection = deriveMarketplaceRevenueProjection({ stateCode: "ZZ" });

    expect(projection.pricing_assumption.state_code).toBe("ZZ");
    expect(projection.project_value_range).toBeNull();
    expect(projection.financed_payment_range).toBeNull();
    expect(projection.ppa_lease_payment_range).toBeNull();
    expect(projection.gross_opportunity_tier).toBe("unknown");
    expect(projection.missing).toEqual(
      expect.arrayContaining([
        "Estimated system size or annual usage required",
        "Monthly bill or annual savings required for PPA/lease payment range",
      ]),
    );
  });
});

describe("canonical purchase behavior classifier", () => {
  it("classifies sales behavior without underwriting language", () => {
    const releaseGate = evaluateMarketplaceReleaseGate(gateRow());
    const revenueProjection = deriveMarketplaceRevenueProjection({
      stateCode: "CA",
      estimatedSystemSizeKw: 12,
      batteryCandidate: true,
      purchaseIntent: "financing",
      monthlyBillAmount: 255,
      annualUsageKwh: 18000,
      utilityRatePerKwh: 0.21,
    });
    const marketplace = buildMarketplaceIntelligence({
      ...gateRow(),
      purchase_intent: "financing",
      finance_readiness: true,
      timeline: "1_3_months",
      qualification_status: "qualified",
      lead_grade: "A",
      monthly_bill_amount: 255,
      annual_kwh: 18000,
      utility_rate_per_kwh: 0.21,
      battery_candidate: true,
      marketplace_intake_metadata: intakeMetadata,
      marketplace_raw_payload: {},
    });

    const behavior = derivePurchaseBehavior({
      releaseGate,
      purchaseProfile: marketplace.purchase_profile,
      revenueProjection,
      purchaseIntent: "financing",
      timeline: "1_3_months",
      batteryCandidate: true,
      monthlyBillAmount: 255,
      annualUsageKwh: 18000,
      utilityRatePerKwh: 0.21,
      qualificationStatus: "qualified",
      leadGrade: "A",
    });

    expect(behavior.tags).toEqual(
      expect.arrayContaining([
        "financing-friendly",
        "payment-sensitive",
        "battery-ready",
        "fast-close",
        "premium-upgrade candidate",
      ]),
    );
    expect(behavior.sales_fit_score).toBeGreaterThan(60);
    expect(behavior.disclaimers[0]).toContain("not credit underwriting");
    expect(JSON.stringify(behavior)).not.toContain("approved");
  });
});
