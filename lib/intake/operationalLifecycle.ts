export const OPERATIONAL_LIFECYCLE = [
  "homeowner_intake",
  "pending_operator_review",
  "operator_contacted",
  "qualification_in_progress",
  "vetted_qualified",
  "ready_for_marketplace",
  "marketplace_live",
  "contractor_claimed",
  "converted",
  "rejected",
  "archived",
] as const;

export type OperationalLifecycleStatus = (typeof OPERATIONAL_LIFECYCLE)[number];

export const OPERATOR_REVIEW_ACTIONS = [
  "mark_contacted",
  "mark_no_answer",
  "mark_bad_lead",
  "mark_qualified",
  "mark_financing_ready",
  "mark_needs_follow_up",
  "approve_for_marketplace",
  "reject_lead",
  "archive_lead",
] as const;

export type OperatorReviewAction = (typeof OPERATOR_REVIEW_ACTIONS)[number];

export interface OperationalState {
  lifecycle_status: OperationalLifecycleStatus;
  review_status: string;
  contacted?: boolean;
  no_answer_count?: number;
  bad_lead?: boolean;
  qualified?: boolean;
  financing_ready?: boolean;
  needs_follow_up?: boolean;
  approved_for_marketplace?: boolean;
  rejected?: boolean;
  archived?: boolean;
  operator_notes?: string | null;
  last_contact_timestamp?: string | null;
  last_review_action?: OperatorReviewAction | string | null;
  last_reviewed_by?: string | null;
  last_reviewed_at?: string | null;
  release_readiness?: ReleaseReadiness;
  action_history?: Array<Record<string, unknown>>;
}

export interface ReleaseReadiness {
  operator_reviewed: boolean;
  qualification_checked: boolean;
  validation_passed: boolean;
  financing_readiness_reviewed: boolean;
  homeowner_intent_verified: boolean;
  approved_for_marketplace: boolean;
  ready: boolean;
  missing: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function bool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string")
    return ["true", "yes", "1"].includes(value.toLowerCase());
  return false;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function isOperatorReviewAction(
  action: unknown,
): action is OperatorReviewAction {
  return (
    typeof action === "string" &&
    (OPERATOR_REVIEW_ACTIONS as readonly string[]).includes(action)
  );
}

export function stateFromPipelineResult(
  pipelineResult: unknown,
): OperationalState {
  const result = isRecord(pipelineResult) ? pipelineResult : {};
  const operational = isRecord(result.operational) ? result.operational : {};
  const lifecycle =
    str(operational.lifecycle_status) ??
    str(result.review_status) ??
    "pending_operator_review";
  const lifecycle_status = (
    OPERATIONAL_LIFECYCLE as readonly string[]
  ).includes(lifecycle)
    ? (lifecycle as OperationalLifecycleStatus)
    : "pending_operator_review";

  return {
    lifecycle_status,
    review_status: str(result.review_status) ?? lifecycle_status,
    contacted: bool(operational.contacted),
    no_answer_count: num(operational.no_answer_count) ?? 0,
    bad_lead: bool(operational.bad_lead),
    qualified: bool(operational.qualified),
    financing_ready: bool(operational.financing_ready),
    needs_follow_up: bool(operational.needs_follow_up),
    approved_for_marketplace: bool(operational.approved_for_marketplace),
    rejected: bool(operational.rejected),
    archived: bool(operational.archived),
    operator_notes: str(operational.operator_notes),
    last_contact_timestamp: str(operational.last_contact_timestamp),
    last_review_action: str(operational.last_review_action),
    last_reviewed_by: str(operational.last_reviewed_by),
    last_reviewed_at: str(operational.last_reviewed_at),
    release_readiness: isRecord(operational.release_readiness)
      ? (operational.release_readiness as unknown as ReleaseReadiness)
      : undefined,
    action_history: Array.isArray(operational.action_history)
      ? (operational.action_history as Array<Record<string, unknown>>)
      : [],
  };
}

export function applyOperatorReviewAction(
  current: OperationalState,
  action: OperatorReviewAction,
  options: { adminId: string; notes?: string | null; occurredAt?: string },
): OperationalState {
  const occurredAt = options.occurredAt ?? new Date().toISOString();
  const next: OperationalState = {
    ...current,
    operator_notes: options.notes?.trim() || current.operator_notes || null,
    last_review_action: action,
    last_reviewed_by: options.adminId,
    last_reviewed_at: occurredAt,
    action_history: [
      ...(Array.isArray(current.action_history) ? current.action_history : []),
      {
        action,
        reviewed_by: options.adminId,
        reviewed_at: occurredAt,
        notes: options.notes?.trim() || null,
      },
    ].slice(-50),
  };

  if (action === "mark_contacted") {
    next.lifecycle_status = "operator_contacted";
    next.review_status = "operator_contacted";
    next.contacted = true;
    next.needs_follow_up = false;
    next.last_contact_timestamp = occurredAt;
  } else if (action === "mark_no_answer") {
    next.lifecycle_status = "operator_contacted";
    next.review_status = "no_answer";
    next.contacted = true;
    next.no_answer_count = (next.no_answer_count ?? 0) + 1;
    next.needs_follow_up = true;
    next.last_contact_timestamp = occurredAt;
  } else if (action === "mark_bad_lead") {
    next.lifecycle_status = "rejected";
    next.review_status = "bad_lead";
    next.bad_lead = true;
    next.rejected = true;
    next.approved_for_marketplace = false;
  } else if (action === "mark_qualified") {
    next.lifecycle_status = "vetted_qualified";
    next.review_status = "vetted_qualified";
    next.qualified = true;
    next.needs_follow_up = false;
  } else if (action === "mark_financing_ready") {
    next.lifecycle_status = next.qualified
      ? "vetted_qualified"
      : "qualification_in_progress";
    next.review_status = "financing_ready";
    next.financing_ready = true;
  } else if (action === "mark_needs_follow_up") {
    next.lifecycle_status = "qualification_in_progress";
    next.review_status = "needs_follow_up";
    next.needs_follow_up = true;
  } else if (action === "approve_for_marketplace") {
    next.lifecycle_status = "ready_for_marketplace";
    next.review_status = "approved_for_marketplace";
    next.approved_for_marketplace = true;
    next.qualified = true;
    next.needs_follow_up = false;
    next.rejected = false;
    next.archived = false;
  } else if (action === "reject_lead") {
    next.lifecycle_status = "rejected";
    next.review_status = "rejected";
    next.rejected = true;
    next.approved_for_marketplace = false;
  } else if (action === "archive_lead") {
    next.lifecycle_status = "archived";
    next.review_status = "archived";
    next.archived = true;
    next.approved_for_marketplace = false;
  }

  return next;
}

export function deriveReleaseReadiness(input: {
  operational?: unknown;
  intake?: unknown;
  qualification?: unknown;
  validation?: unknown;
  screening?: unknown;
}): ReleaseReadiness {
  const operational = stateFromPipelineResult({
    operational: input.operational,
  });
  const intake = isRecord(input.intake) ? input.intake : {};
  const qualification = isRecord(input.qualification)
    ? input.qualification
    : {};
  const validation = isRecord(input.validation) ? input.validation : {};
  const screening = isRecord(input.screening) ? input.screening : {};

  const operator_reviewed = !!(
    operational.contacted ||
    operational.qualified ||
    operational.financing_ready ||
    operational.approved_for_marketplace ||
    operational.last_review_action
  );

  const qualificationStatus =
    str(qualification.qualification_status) ?? str(qualification.lead_grade);
  const qualification_checked =
    !!qualificationStatus || Object.keys(qualification).length > 0;

  const validationErrors = Array.isArray(validation.errors)
    ? validation.errors
    : [];
  const validation_passed =
    validation.valid === true || validationErrors.length === 0;

  const financing_readiness_reviewed =
    operational.financing_ready === true ||
    bool(qualification.finance_readiness);

  const intentScore =
    num(qualification.intent_score) ?? num(qualification.lead_score);
  const intentStatus = str(qualification.qualification_status);
  const homeowner_intent_verified = !!(
    operational.qualified ||
    operational.contacted ||
    (intentScore != null && intentScore >= 60) ||
    ["high_intent", "qualified", "finance_ready"].includes(
      intentStatus ?? "",
    ) ||
    str(intake.timeline)
  );

  const approved_for_marketplace =
    operational.approved_for_marketplace === true;
  const screeningApproved =
    screening.screening_status === "approved" ||
    screening.auto_decision === "pass" ||
    screening.override_decision === "pass";

  const checks = {
    operator_reviewed,
    qualification_checked,
    validation_passed,
    financing_readiness_reviewed,
    homeowner_intent_verified,
    approved_for_marketplace,
  };
  const missing = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);

  return {
    ...checks,
    ready:
      missing.length === 0 &&
      (Object.keys(screening).length === 0 || screeningApproved),
    missing,
  };
}

export function operationalIntelligence(input: {
  operational?: unknown;
  intake?: unknown;
  qualification?: unknown;
  validation?: unknown;
  receivedAt?: unknown;
}): Record<string, unknown> {
  const operational = stateFromPipelineResult({
    operational: input.operational,
  });
  const intake = isRecord(input.intake) ? input.intake : {};
  const qualification = isRecord(input.qualification)
    ? input.qualification
    : {};
  const validation = isRecord(input.validation) ? input.validation : {};
  const receivedAtMs =
    typeof input.receivedAt === "string" || input.receivedAt instanceof Date
      ? new Date(input.receivedAt).getTime()
      : NaN;
  const ageHours = Number.isFinite(receivedAtMs)
    ? Math.max(0, Math.round((Date.now() - receivedAtMs) / 36_000) / 100)
    : null;
  const readiness = deriveReleaseReadiness({
    operational,
    intake,
    qualification,
    validation,
  });
  const leadScore =
    num(qualification.lead_score) ?? num(qualification.intent_score);

  let review_priority: "low" | "normal" | "high" | "urgent" = "normal";
  if (operational.needs_follow_up || (ageHours != null && ageHours >= 24))
    review_priority = "high";
  if (ageHours != null && ageHours >= 72) review_priority = "urgent";
  if (operational.rejected || operational.archived) review_priority = "low";

  return {
    review_priority,
    qualification_confidence: leadScore ?? null,
    financing_readiness:
      operational.financing_ready === true ||
      bool(qualification.finance_readiness),
    estimated_close_quality:
      leadScore != null
        ? leadScore >= 80
          ? "high"
          : leadScore >= 60
            ? "medium"
            : "low"
        : "unknown",
    follow_up_urgency: operational.needs_follow_up
      ? "needed"
      : ageHours != null && ageHours >= 24
        ? "stale"
        : "normal",
    stale_lead_hours: ageHours,
    operator_notes: operational.operator_notes ?? null,
    last_contact_timestamp: operational.last_contact_timestamp ?? null,
    release_readiness: readiness,
  };
}

export function safeOperationalLog(input: {
  eventId?: unknown;
  opportunityId?: unknown;
  action?: unknown;
  fromStatus?: unknown;
  toStatus?: unknown;
  releaseReadiness?: ReleaseReadiness;
}): Record<string, unknown> {
  return {
    event_id: str(input.eventId),
    opportunity_id: str(input.opportunityId),
    action: str(input.action),
    from_status: str(input.fromStatus),
    to_status: str(input.toStatus),
    release_ready: input.releaseReadiness?.ready ?? null,
    release_missing: input.releaseReadiness?.missing ?? [],
  };
}
