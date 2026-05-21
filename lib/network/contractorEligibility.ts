import { getDbReady } from "@/lib/db-neon";
import { evaluateMarketplaceReleaseGate } from "@/lib/network/marketplaceReleaseGate";

type SqlClient = Awaited<ReturnType<typeof getDbReady>>;

export interface ContractorEligibilityResult {
  eligible: boolean;
  reasons: string[];
  denials: string[];
  warnings: string[];
  contractor_id: string;
  opportunity_id: string;
  release_gate_result?: ReturnType<typeof evaluateMarketplaceReleaseGate>;
  claim_state?: {
    mode: "exclusive" | "shared";
    max_claims: number;
    current_claims: number;
    contractor_has_active_claim: boolean;
    contractor_has_claimable_offer: boolean;
  };
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return ["true", "1", "yes", "y"].includes(value.toLowerCase());
  return false;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizedState(value: unknown): string | null {
  const state = asString(value)?.toUpperCase();
  return state ? state.slice(0, 2) : null;
}

function normalizedZip(value: unknown): string | null {
  const zip = asString(value)?.replace(/[^0-9]/g, "");
  return zip ? zip.slice(0, 5) : null;
}

function containsNormalized(values: string[], target: string | null): boolean {
  if (!target) return false;
  return values.map((value) => value.toUpperCase()).includes(target.toUpperCase());
}

function projectLeadType(opportunity: Record<string, unknown>): "residential" | "commercial" {
  const rawPayload = asRecord(opportunity.raw_payload);
  const intakeMetadata = asRecord(opportunity.intake_metadata);
  const direct = asString(opportunity.lead_type) ?? asString(opportunity.project_type) ?? asString(rawPayload.lead_type) ?? asString(rawPayload.project_type) ?? asString(intakeMetadata.lead_type) ?? asString(intakeMetadata.project_type);
  return direct?.toLowerCase().includes("commercial") ? "commercial" : "residential";
}

function exclusionConfig(profile: Record<string, unknown>, opportunity: Record<string, unknown>) {
  const profileRules = asRecord(profile.match_rules);
  const metadata = asRecord(opportunity.intake_metadata);
  const routing = asRecord(metadata.routing);
  return {
    excludedContractors: [...asStringArray(metadata.excluded_contractor_ids), ...asStringArray(routing.excluded_contractor_ids)],
    excludedStates: asStringArray(profileRules.excluded_states),
    excludedZips: asStringArray(profileRules.excluded_zips),
    blacklistedOpportunityIds: asStringArray(profileRules.blacklisted_opportunity_ids),
  };
}

export async function evaluateContractorEligibility({
  sql,
  contractorId,
  opportunityId,
}: {
  sql: SqlClient;
  contractorId: string;
  opportunityId: string;
}): Promise<ContractorEligibilityResult> {
  const reasons: string[] = [];
  const denials: string[] = [];
  const warnings: string[] = [];

  const contractorRows = await sql`
    SELECT
      cp.user_id,
      cp.service_states,
      cp.service_zips,
      cp.battery_certified,
      cp.commercial_capable,
      cp.roofing_capable,
      cp.steep_roof_capable,
      cp.ev_charger_capable,
      cp.generator_capable,
      cp.min_project_kw,
      cp.max_project_kw,
      cp.total_installs,
      cp.avg_close_rate_pct,
      cp.avg_response_hours,
      cp.inspection_pass_rate,
      cp.profile_complete,
      cp.network_active,
      CASE WHEN cp.profile_complete THEN 'preferred' ELSE 'standard' END AS tier,
      '{}'::jsonb AS match_rules
    FROM contractor_profiles cp
    WHERE cp.user_id = ${contractorId}
    LIMIT 1
  `;
  const contractor = contractorRows[0] as Record<string, unknown> | undefined;
  if (!contractor) return { eligible: false, reasons, denials: ["contractor_profile_missing"], warnings, contractor_id: contractorId, opportunity_id: opportunityId };

  const opportunityRows = await sql`
    SELECT
      no.id,
      no.status,
      COALESCE(no.marketplace_status, 'live') AS marketplace_status,
      no.claim_mode,
      no.max_claims,
      no.claim_count,
      no.location_state,
      no.location_zip,
      no.estimated_system_size_kw,
      no.battery_candidate,
      no.steep_roof_flag,
      no.screening_status,
      no.intake_metadata,
      no.raw_payload,
      CASE
        WHEN BOOL_OR(osq.auto_decision = 'pass') THEN 'pass'
        ELSE (ARRAY_AGG(osq.auto_decision ORDER BY osq.created_at DESC NULLS LAST) FILTER (WHERE osq.auto_decision IS NOT NULL))[1]
      END AS auto_decision,
      CASE
        WHEN BOOL_OR(osq.override_decision = 'pass') THEN 'pass'
        ELSE (ARRAY_AGG(osq.override_decision ORDER BY osq.created_at DESC NULLS LAST) FILTER (WHERE osq.override_decision IS NOT NULL))[1]
      END AS override_decision
    FROM network_opportunities no
    LEFT JOIN opportunity_screening_queue osq ON osq.opportunity_id = no.id
    WHERE no.id = ${opportunityId}
    GROUP BY
      no.id,
      no.status,
      no.marketplace_status,
      no.claim_mode,
      no.max_claims,
      no.claim_count,
      no.location_state,
      no.location_zip,
      no.estimated_system_size_kw,
      no.battery_candidate,
      no.steep_roof_flag,
      no.screening_status,
      no.intake_metadata,
      no.raw_payload
    LIMIT 1
  `;
  const opportunity = opportunityRows[0] as Record<string, unknown> | undefined;
  if (!opportunity) return { eligible: false, reasons, denials: ["opportunity_missing"], warnings, contractor_id: contractorId, opportunity_id: opportunityId };

  const assignmentRows = await sql`
    SELECT
      COUNT(*) FILTER (WHERE status IN ('claimed','contacted','appointment','proposal','won'))::int AS active_claim_count,
      COUNT(*) FILTER (WHERE contractor_id = ${contractorId} AND status IN ('claimed','contacted','appointment','proposal','won'))::int AS contractor_active_claim_count,
      COUNT(*) FILTER (WHERE contractor_id = ${contractorId} AND status IN ('offered','viewed'))::int AS contractor_claimable_offer_count
    FROM opportunity_assignments
    WHERE opportunity_id = ${opportunityId}
  `;
  const assignmentState = assignmentRows[0] as Record<string, unknown> | undefined;

  const status = asString(opportunity.status);
  const storedMarketplaceStatus = asString(opportunity.marketplace_status) ?? "live";
  const terminalMarketplaceStatuses = new Set(["paused", "archived", "withdrawn", "rejected"]);
  const marketplaceStatus =
    status === "live" && !terminalMarketplaceStatuses.has(storedMarketplaceStatus)
      ? "live"
      : storedMarketplaceStatus;
  const releaseGateOpportunity = {
    ...opportunity,
    marketplace_status: marketplaceStatus,
  };
  const releaseGate = evaluateMarketplaceReleaseGate(releaseGateOpportunity);
  if (!releaseGate.ok) denials.push(`release_gate_failed:${releaseGate.missing.join(",")}`);
  else reasons.push("release_gate_passed");

  if (status !== "live" && status !== "claimed") denials.push(`opportunity_status_${status ?? "unknown"}`);
  else reasons.push(`opportunity_status_${status}`);
  if (marketplaceStatus !== "live" && marketplaceStatus !== "claimed") denials.push(`marketplace_status_${storedMarketplaceStatus}`);
  else if (marketplaceStatus !== storedMarketplaceStatus) reasons.push(`marketplace_status_recovered_${storedMarketplaceStatus}`);
  else reasons.push(`marketplace_status_${marketplaceStatus}`);

  if (!asBool(contractor.network_active)) denials.push("contractor_inactive");
  else reasons.push("contractor_active");

  const serviceStates = asStringArray(contractor.service_states).map((state) => state.toUpperCase());
  const serviceZips = asStringArray(contractor.service_zips).map((zip) => normalizedZip(zip) ?? zip);
  const opportunityState = normalizedState(opportunity.location_state);
  const opportunityZip = normalizedZip(opportunity.location_zip);
  if (serviceZips.length > 0 && opportunityZip && containsNormalized(serviceZips, opportunityZip)) reasons.push(`territory_zip_${opportunityZip}`);
  else if (serviceStates.length > 0 && opportunityState && containsNormalized(serviceStates, opportunityState)) reasons.push(`territory_state_${opportunityState}`);
  else denials.push("territory_mismatch");

  const leadType = projectLeadType(opportunity);
  if (leadType === "commercial" && !asBool(contractor.commercial_capable)) denials.push("commercial_capability_required");
  else reasons.push(`lead_type_${leadType}`);

  if (asBool(opportunity.battery_candidate) && !asBool(contractor.battery_certified)) denials.push("battery_certification_required");
  else if (asBool(opportunity.battery_candidate)) reasons.push("battery_certified");

  if (asBool(opportunity.steep_roof_flag) && !asBool(contractor.steep_roof_capable)) denials.push("steep_roof_capability_required");
  else if (asBool(opportunity.steep_roof_flag)) reasons.push("steep_roof_capable");

  const projectKw = asNumber(opportunity.estimated_system_size_kw);
  const minKw = asNumber(contractor.min_project_kw);
  const maxKw = asNumber(contractor.max_project_kw);
  if (projectKw !== null && minKw !== null && projectKw < minKw) denials.push("below_min_project_kw");
  if (projectKw !== null && maxKw !== null && projectKw > maxKw) denials.push("above_max_project_kw");
  if (!denials.includes("below_min_project_kw") && !denials.includes("above_max_project_kw")) reasons.push("capacity_project_size_ok");

  const tier = asString(contractor.tier) ?? "standard";
  if (!asBool(contractor.profile_complete)) warnings.push("contractor_profile_incomplete_standard_tier");
  reasons.push(`tier_${tier}`);

  const exclusions = exclusionConfig(contractor, opportunity);
  if (containsNormalized(exclusions.excludedContractors, contractorId)) denials.push("contractor_excluded_for_opportunity");
  if (opportunityState && containsNormalized(exclusions.excludedStates, opportunityState)) denials.push("contractor_state_blacklisted");
  if (opportunityZip && containsNormalized(exclusions.excludedZips, opportunityZip)) denials.push("contractor_zip_blacklisted");
  if (containsNormalized(exclusions.blacklistedOpportunityIds, opportunityId)) denials.push("opportunity_blacklisted_for_contractor");
  if (!["contractor_excluded_for_opportunity", "contractor_state_blacklisted", "contractor_zip_blacklisted", "opportunity_blacklisted_for_contractor"].some((key) => denials.includes(key))) reasons.push("no_blacklist_or_exclusion_hit");

  const mode = asString(opportunity.claim_mode) === "shared" ? "shared" : "exclusive";
  const maxClaims = Math.max(1, Math.floor(asNumber(opportunity.max_claims) ?? 1));
  const activeClaimCount = Math.max(0, Math.floor(asNumber(assignmentState?.active_claim_count) ?? asNumber(opportunity.claim_count) ?? 0));
  const contractorActiveClaimCount = Math.max(0, Math.floor(asNumber(assignmentState?.contractor_active_claim_count) ?? 0));
  const contractorOfferCount = Math.max(0, Math.floor(asNumber(assignmentState?.contractor_claimable_offer_count) ?? 0));

  if (contractorActiveClaimCount > 0) denials.push("contractor_already_claimed_opportunity");
  else reasons.push("contractor_has_no_active_claim");

  if (mode === "exclusive" && activeClaimCount >= 1) denials.push("exclusive_opportunity_already_claimed");
  if (mode === "shared" && activeClaimCount >= maxClaims) denials.push("shared_claim_capacity_full");
  if (!denials.includes("exclusive_opportunity_already_claimed") && !denials.includes("shared_claim_capacity_full")) reasons.push(`claim_capacity_available_${mode}`);

  if (contractorOfferCount > 0) reasons.push("contractor_has_claimable_offer");
  else warnings.push("contractor_has_no_preissued_offer_claim_allowed_by_eligibility_v1");

  return {
    eligible: denials.length === 0,
    reasons,
    denials,
    warnings,
    contractor_id: contractorId,
    opportunity_id: opportunityId,
    release_gate_result: releaseGate,
    claim_state: {
      mode,
      max_claims: maxClaims,
      current_claims: activeClaimCount,
      contractor_has_active_claim: contractorActiveClaimCount > 0,
      contractor_has_claimable_offer: contractorOfferCount > 0,
    },
  };
}
