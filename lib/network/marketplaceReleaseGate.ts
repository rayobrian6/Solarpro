import {
  deriveReleaseReadiness,
  safeOperationalLog,
  stateFromPipelineResult,
  type ReleaseReadiness,
} from "@/lib/intake/operationalLifecycle";

export interface MarketplaceGateRow {
  id?: unknown;
  status?: unknown;
  screening_status?: unknown;
  auto_decision?: unknown;
  override_decision?: unknown;
  intake_metadata?: unknown;
  raw_payload?: unknown;
  qualification_intelligence?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function releaseGateMetadata(row: MarketplaceGateRow) {
  const intakeMetadata = isRecord(row.intake_metadata)
    ? row.intake_metadata
    : {};
  const rawPayload = isRecord(row.raw_payload) ? row.raw_payload : {};
  const operationalSource = isRecord(intakeMetadata.operational)
    ? intakeMetadata.operational
    : isRecord(rawPayload.operational)
      ? rawPayload.operational
      : {};
  const qualification = isRecord(row.qualification_intelligence)
    ? row.qualification_intelligence
    : isRecord(intakeMetadata.qualification)
      ? intakeMetadata.qualification
      : isRecord(rawPayload.qualification)
        ? rawPayload.qualification
        : {};

  return {
    intakeMetadata,
    rawPayload,
    operational: stateFromPipelineResult({ operational: operationalSource }),
    qualification,
  };
}

export function evaluateMarketplaceReleaseGate(row: MarketplaceGateRow): {
  approvedScreening: boolean;
  releaseReadiness: ReleaseReadiness;
  ok: boolean;
  missing: string[];
} {
  const metadata = releaseGateMetadata(row);
  const approvedScreening =
    row.screening_status === "approved" ||
    row.auto_decision === "pass" ||
    row.override_decision === "pass";
  const releaseReadiness = deriveReleaseReadiness({
    operational: metadata.operational,
    intake: metadata.intakeMetadata,
    qualification: metadata.qualification,
    screening: {
      screening_status: row.screening_status,
      auto_decision: row.auto_decision,
      override_decision: row.override_decision,
    },
  });
  const missing = [...releaseReadiness.missing];
  if (!approvedScreening) missing.push("screening_approved");
  return {
    approvedScreening,
    releaseReadiness,
    ok: approvedScreening && releaseReadiness.ready,
    missing,
  };
}

export function marketplaceGateError(row: MarketplaceGateRow): string {
  const gate = evaluateMarketplaceReleaseGate(row);
  if (gate.ok) return "";
  return `Marketplace release blocked: ${gate.missing.join(", ") || "release gate incomplete"}`;
}

export function marketplaceVisibilitySqlCondition(alias = "no"): string {
  return `${alias}.intake_metadata->'operational'->>'approved_for_marketplace' = 'true'`;
}

export function logMarketplaceGate(
  tag:
    | "[MARKETPLACE RELEASE GATE]"
    | "[MARKETPLACE VISIBILITY]"
    | "[CONTRACTOR CLAIM FLOW]",
  row: MarketplaceGateRow,
  action?: string,
) {
  const gate = evaluateMarketplaceReleaseGate(row);
  console.info(tag, {
    ...safeOperationalLog({
      opportunityId: stringValue(row.id),
      action,
      fromStatus: stringValue(row.status),
      toStatus: gate.ok ? "release_gate_passed" : "release_gate_blocked",
      releaseReadiness: gate.releaseReadiness,
    }),
    approved_screening: gate.approvedScreening,
  });
  return gate;
}
