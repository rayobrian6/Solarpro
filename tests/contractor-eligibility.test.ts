import { beforeEach, describe, expect, it, vi } from "vitest";

async function importEligibility() {
  return import("@/lib/network/contractorEligibility");
}

const CONTRACTOR_ID = "11111111-1111-4111-8111-111111111111";
const OPP_ID = "22222222-2222-4222-8222-222222222222";

function operationalMetadata() {
  return {
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
  };
}

function makeSql({ contractor = {}, opportunity = {}, assignments = {} }: { contractor?: Record<string, unknown> | null; opportunity?: Record<string, unknown> | null; assignments?: Record<string, unknown> } = {}) {
  const calls: string[] = [];
  const sql = vi.fn(async (strings: TemplateStringsArray) => {
    const q = strings.join(" ");
    calls.push(q);
    if (q.includes("FROM contractor_profiles cp")) {
      if (contractor === null) return [];
      return [{ user_id: CONTRACTOR_ID, service_states: ["TX"], service_zips: [], battery_certified: true, commercial_capable: false, steep_roof_capable: true, min_project_kw: null, max_project_kw: 20, total_installs: 12, avg_close_rate_pct: 35, avg_response_hours: 4, inspection_pass_rate: 98, profile_complete: true, network_active: true, tier: "preferred", match_rules: {}, ...contractor }];
    }
    if (q.includes("FROM network_opportunities no")) {
      if (opportunity === null) return [];
      return [{ id: OPP_ID, status: "live", marketplace_status: "live", claim_mode: "exclusive", max_claims: 1, claim_count: 0, location_state: "TX", location_zip: "78701", estimated_system_size_kw: 8.5, battery_candidate: false, steep_roof_flag: false, screening_status: "approved", intake_metadata: operationalMetadata(), raw_payload: {}, auto_decision: "pass", override_decision: null, ...opportunity }];
    }
    if (q.includes("FROM opportunity_assignments")) return [{ active_claim_count: 0, contractor_active_claim_count: 0, contractor_claimable_offer_count: 1, ...assignments }];
    return [];
  }) as any;
  sql.calls = calls;
  return sql;
}

describe("evaluateContractorEligibility", () => {
  beforeEach(() => vi.resetModules());

  it("allows an active contractor in territory with available claim capacity", async () => {
    const { evaluateContractorEligibility } = await importEligibility();
    const result = await evaluateContractorEligibility({ sql: makeSql(), contractorId: CONTRACTOR_ID, opportunityId: OPP_ID });
    expect(result.eligible).toBe(true);
    expect(result.denials).toEqual([]);
    expect(result.reasons).toEqual(expect.arrayContaining(["release_gate_passed", "contractor_active", "territory_state_TX", "claim_capacity_available_exclusive", "no_blacklist_or_exclusion_hit"]));
    expect(result.claim_state).toMatchObject({ mode: "exclusive", max_claims: 1, current_claims: 0, contractor_has_claimable_offer: true });
  });

  it("recovers stale marketplace_status before release-gate evaluation for live published opportunities", async () => {
    const { evaluateContractorEligibility } = await importEligibility();
    const result = await evaluateContractorEligibility({
      sql: makeSql({
        opportunity: {
          marketplace_status: "unreleased",
          screening_status: null,
          auto_decision: null,
          override_decision: null,
          intake_metadata: {},
          raw_payload: {},
        },
      }),
      contractorId: CONTRACTOR_ID,
      opportunityId: OPP_ID,
    });
    expect(result.eligible).toBe(true);
    expect(result.denials).toEqual([]);
    expect(result.reasons).toContain("release_gate_passed");
    expect(result.reasons).toContain("marketplace_status_recovered_unreleased");
    expect(result.release_gate_result?.ok).toBe(true);
  });

  it("does not recover intentionally paused marketplace inventory", async () => {
    const { evaluateContractorEligibility } = await importEligibility();
    const result = await evaluateContractorEligibility({
      sql: makeSql({ opportunity: { marketplace_status: "paused" } }),
      contractorId: CONTRACTOR_ID,
      opportunityId: OPP_ID,
    });
    expect(result.eligible).toBe(false);
    expect(result.denials).toContain("marketplace_status_paused");
  });

  it("denies inactive, out-of-territory, full exclusive opportunities with explanations", async () => {
    const { evaluateContractorEligibility } = await importEligibility();
    const result = await evaluateContractorEligibility({ sql: makeSql({ contractor: { network_active: false, service_states: ["CA"] }, assignments: { active_claim_count: 1, contractor_claimable_offer_count: 0 } }), contractorId: CONTRACTOR_ID, opportunityId: OPP_ID });
    expect(result.eligible).toBe(false);
    expect(result.denials).toEqual(expect.arrayContaining(["contractor_inactive", "territory_mismatch", "exclusive_opportunity_already_claimed"]));
    expect(result.warnings).toContain("contractor_has_no_preissued_offer_claim_allowed_by_eligibility_v1");
  });

  it("denies required credentials such as battery certification", async () => {
    const { evaluateContractorEligibility } = await importEligibility();
    const result = await evaluateContractorEligibility({ sql: makeSql({ contractor: { battery_certified: false }, opportunity: { battery_candidate: true } }), contractorId: CONTRACTOR_ID, opportunityId: OPP_ID });
    expect(result.eligible).toBe(false);
    expect(result.denials).toContain("battery_certification_required");
  });

  it("prefers any passing screening queue decision when evaluating canonical opportunities", async () => {
    const { evaluateContractorEligibility } = await importEligibility();
    const sql = makeSql();

    await evaluateContractorEligibility({ sql, contractorId: CONTRACTOR_ID, opportunityId: OPP_ID });

    const opportunityQuery = sql.calls.find((q: string) => q.includes("FROM network_opportunities no")) ?? "";
    expect(opportunityQuery).toContain("BOOL_OR(osq.auto_decision = 'pass')");
    expect(opportunityQuery).toContain("BOOL_OR(osq.override_decision = 'pass')");
    expect(opportunityQuery).toContain("ARRAY_AGG(osq.auto_decision ORDER BY osq.created_at DESC NULLS LAST)");
    expect(opportunityQuery).toContain("ARRAY_AGG(osq.override_decision ORDER BY osq.created_at DESC NULLS LAST)");
    expect(opportunityQuery).toContain("GROUP BY");
  });
});
