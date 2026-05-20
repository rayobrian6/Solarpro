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
  follow_up_at?: string | null;
  callback_reason?: string | null;
  next_step?: string | null;
  contact_method?: string | null;
  reached_homeowner?: boolean | null;
  voicemail_left?: boolean | null;
  financing_path?: string | null;
  credit_band?: string | null;
  income_band?: string | null;
  financing_notes?: string | null;
  qualification_reason?: string | null;
  operator_confidence?: string | null;
  missing_items_resolved?: boolean | null;
  final_approval_note?: string | null;
  contractor_facing_notes?: string | null;
  rejection_reason?: string | null;
  archive_reason?: string | null;
  is_test_lead?: boolean;
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

export const LEAD_OPS_QUEUES = [
  "new_intake",
  "needs_first_contact",
  "no_answer_retry",
  "needs_callback",
  "qualification_review",
  "financing_review",
  "missing_documents",
  "marketplace_ready",
  "released",
  "rejected",
  "archived",
] as const;

export type LeadOpsQueue = (typeof LEAD_OPS_QUEUES)[number];

export interface LeadOpsSummary {
  current_queue: LeadOpsQueue;
  next_action: string;
  next_follow_up_at: string | null;
  assigned_operator: string | null;
  last_contacted_at: string | null;
  contact_attempt_count: number;
  last_operator_action: string | null;
  release_readiness: ReleaseReadiness | null;
  financing_status: string;
  qualification_status: string;
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
    follow_up_at: str(operational.follow_up_at),
    callback_reason: str(operational.callback_reason),
    next_step: str(operational.next_step),
    contact_method: str(operational.contact_method),
    reached_homeowner:
      operational.reached_homeowner === null ||
      operational.reached_homeowner === undefined
        ? null
        : bool(operational.reached_homeowner),
    voicemail_left:
      operational.voicemail_left === null ||
      operational.voicemail_left === undefined
        ? null
        : bool(operational.voicemail_left),
    financing_path: str(operational.financing_path),
    credit_band: str(operational.credit_band),
    income_band: str(operational.income_band),
    financing_notes: str(operational.financing_notes),
    qualification_reason: str(operational.qualification_reason),
    operator_confidence: str(operational.operator_confidence),
    missing_items_resolved:
      operational.missing_items_resolved === null ||
      operational.missing_items_resolved === undefined
        ? null
        : bool(operational.missing_items_resolved),
    final_approval_note: str(operational.final_approval_note),
    contractor_facing_notes: str(operational.contractor_facing_notes),
    rejection_reason: str(operational.rejection_reason),
    archive_reason: str(operational.archive_reason),
    is_test_lead: bool(operational.is_test_lead),
  };
}

export function applyOperatorReviewAction(
  current: OperationalState,
  action: OperatorReviewAction,
  options: {
    adminId: string;
    notes?: string | null;
    occurredAt?: string;
    details?: Record<string, unknown>;
  },
): OperationalState {
  const occurredAt = options.occurredAt ?? new Date().toISOString();
  const details = isRecord(options.details) ? options.details : {};
  const previousStatus = current.review_status;
  const note = options.notes?.trim() || null;
  const detailString = (key: string) => str(details[key]);
  const detailBool = (key: string): boolean | null =>
    details[key] === null || details[key] === undefined
      ? null
      : bool(details[key]);
  const next: OperationalState = {
    ...current,
    operator_notes: note || current.operator_notes || null,
    last_review_action: action,
    last_reviewed_by: options.adminId,
    last_reviewed_at: occurredAt,
  };

  const followUpAt =
    detailString("follow_up_at") ?? detailString("requested_callback_at");
  if (followUpAt) next.follow_up_at = followUpAt;
  if (detailString("contact_method"))
    next.contact_method = detailString("contact_method");
  if (detailBool("reached_homeowner") !== null)
    next.reached_homeowner = detailBool("reached_homeowner");
  if (detailBool("voicemail_left") !== null)
    next.voicemail_left = detailBool("voicemail_left");
  if (detailString("next_step")) next.next_step = detailString("next_step");
  if (detailString("callback_reason"))
    next.callback_reason = detailString("callback_reason");
  if (detailString("financing_path"))
    next.financing_path = detailString("financing_path");
  if (detailString("credit_band"))
    next.credit_band = detailString("credit_band");
  if (detailString("income_band"))
    next.income_band = detailString("income_band");
  if (detailString("financing_notes"))
    next.financing_notes = detailString("financing_notes");
  if (detailString("qualification_reason"))
    next.qualification_reason = detailString("qualification_reason");
  if (detailString("operator_confidence"))
    next.operator_confidence = detailString("operator_confidence");
  if (detailBool("missing_items_resolved") !== null)
    next.missing_items_resolved = detailBool("missing_items_resolved");
  if (detailString("final_approval_note"))
    next.final_approval_note = detailString("final_approval_note");
  if (detailString("contractor_facing_notes"))
    next.contractor_facing_notes = detailString("contractor_facing_notes");
  if (detailString("rejection_reason"))
    next.rejection_reason = detailString("rejection_reason");
  if (detailString("archive_reason"))
    next.archive_reason = detailString("archive_reason");
  if (detailBool("is_test_lead") !== null)
    next.is_test_lead = detailBool("is_test_lead") ?? false;

  if (action === "mark_contacted") {
    next.lifecycle_status = "operator_contacted";
    next.review_status =
      next.reached_homeowner === false
        ? "contact_attempted"
        : "operator_contacted";
    next.contacted = true;
    next.needs_follow_up = !!next.follow_up_at;
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
    next.review_status = next.callback_reason
      ? "needs_callback"
      : "needs_follow_up";
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

  next.action_history = [
    ...(Array.isArray(current.action_history) ? current.action_history : []),
    {
      action,
      reviewed_by: options.adminId,
      reviewed_at: occurredAt,
      previous_status: previousStatus,
      next_status: next.review_status,
      notes: note,
      follow_up_at: next.follow_up_at ?? null,
      contact_method: next.contact_method ?? null,
      reached_homeowner: next.reached_homeowner ?? null,
      voicemail_left: next.voicemail_left ?? null,
      next_step: next.next_step ?? null,
      callback_reason: next.callback_reason ?? null,
      financing_path: next.financing_path ?? null,
      credit_band: next.credit_band ?? null,
      income_band: next.income_band ?? null,
      financing_notes: next.financing_notes ?? null,
      qualification_reason: next.qualification_reason ?? null,
      operator_confidence: next.operator_confidence ?? null,
      missing_items_resolved: next.missing_items_resolved ?? null,
      final_approval_note: next.final_approval_note ?? null,
      contractor_facing_notes: next.contractor_facing_notes ?? null,
      rejection_reason: next.rejection_reason ?? null,
      archive_reason: next.archive_reason ?? null,
      is_test_lead: next.is_test_lead ?? false,
    },
  ].slice(-50);

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

export function deriveLeadOpsSummary(input: {
  operational?: unknown;
  reviewStatus?: unknown;
  readyForReview?: unknown;
  qualificationCompleteness?: unknown;
  attachmentCompleteness?: unknown;
  releaseReadiness?: ReleaseReadiness | null;
}): LeadOpsSummary {
  const operational = stateFromPipelineResult({
    operational: input.operational,
  });
  const reviewStatus = str(input.reviewStatus) ?? operational.review_status;
  const qualificationCompleteness =
    str(input.qualificationCompleteness) ?? "missing";
  const attachmentCompleteness = str(input.attachmentCompleteness) ?? "missing";
  const releaseReadiness =
    input.releaseReadiness ?? operational.release_readiness ?? null;
  const readyForReview = bool(input.readyForReview);

  let current_queue: LeadOpsQueue = "new_intake";
  let next_action = "Review intake and confirm contact information";

  if (operational.archived || reviewStatus === "archived") {
    current_queue = "archived";
    next_action = "No action — soft archived";
  } else if (
    operational.rejected ||
    operational.bad_lead ||
    ["rejected", "bad_lead"].includes(reviewStatus)
  ) {
    current_queue = "rejected";
    next_action = "No action — rejected";
  } else if (
    operational.lifecycle_status === "marketplace_live" ||
    reviewStatus === "marketplace_live"
  ) {
    current_queue = "released";
    next_action = "Monitor marketplace claim activity";
  } else if (
    operational.approved_for_marketplace ||
    operational.lifecycle_status === "ready_for_marketplace" ||
    reviewStatus === "approved_for_marketplace"
  ) {
    current_queue = "marketplace_ready";
    next_action = releaseReadiness?.ready
      ? "Release through marketplace gate"
      : "Resolve release readiness gaps";
  } else if (
    operational.needs_follow_up &&
    (operational.callback_reason || reviewStatus === "needs_callback")
  ) {
    current_queue = "needs_callback";
    next_action = "Call homeowner at scheduled callback time";
  } else if (reviewStatus === "no_answer") {
    current_queue = "no_answer_retry";
    next_action = "Retry contact attempt";
  } else if (!operational.contacted && readyForReview) {
    current_queue = "needs_first_contact";
    next_action = "Make first contact attempt";
  } else if (attachmentCompleteness !== "complete") {
    current_queue = "missing_documents";
    next_action = "Review or waive utility bill evidence";
  } else if (
    qualificationCompleteness !== "complete" ||
    operational.lifecycle_status === "qualification_in_progress"
  ) {
    current_queue = "qualification_review";
    next_action = "Complete qualification review";
  } else if (!operational.financing_ready) {
    current_queue = "financing_review";
    next_action = "Review financing readiness";
  } else if (!operational.contacted) {
    current_queue = "new_intake";
    next_action = "Triage new intake";
  } else {
    current_queue = "qualification_review";
    next_action = "Advance lead qualification";
  }

  const financing_status = operational.financing_ready
    ? "financing_ready"
    : operational.financing_path
      ? "financing_reviewed"
      : "needs_financing_review";
  const qualification_status = operational.qualified
    ? "qualified"
    : qualificationCompleteness === "complete"
      ? "needs_operator_qualification"
      : "missing_qualification";

  return {
    current_queue,
    next_action,
    next_follow_up_at: operational.follow_up_at ?? null,
    assigned_operator: operational.last_reviewed_by ?? null,
    last_contacted_at: operational.last_contact_timestamp ?? null,
    contact_attempt_count: operational.no_answer_count ?? 0,
    last_operator_action: operational.last_review_action ?? null,
    release_readiness: releaseReadiness,
    financing_status,
    qualification_status,
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
