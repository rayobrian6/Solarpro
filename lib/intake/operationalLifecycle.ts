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
  "assign_operator",
  "transfer_operator",
  "unassign_operator",
  "add_internal_note",
  "log_contact_attempt",
  "create_follow_up_task",
  "complete_follow_up_task",
  "update_financing_stage",
  "update_proposal_stage",
] as const;

export type OperatorReviewAction = (typeof OPERATOR_REVIEW_ACTIONS)[number];

export interface OperationalMemoryEntry extends Record<string, unknown> {
  id: string;
  created_at: string;
  created_by: string;
  type: string;
  summary?: string | null;
}

export interface OperationalTask extends Record<string, unknown> {
  id: string;
  title: string;
  owner_id?: string | null;
  owner_name?: string | null;
  due_at?: string | null;
  priority?: string | null;
  status: "open" | "completed";
  completed_at?: string | null;
  notes?: string | null;
}

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
  assigned_operator_id?: string | null;
  assigned_operator_name?: string | null;
  assigned_at?: string | null;
  assignment_history?: Array<Record<string, unknown>>;
  follow_up_reason?: string | null;
  follow_up_priority?: string | null;
  follow_up_channel?: string | null;
  follow_up_completed_at?: string | null;
  snooze_until?: string | null;
  internal_notes?: OperationalMemoryEntry[];
  contact_history?: OperationalMemoryEntry[];
  tasks?: OperationalTask[];
  financing_stage?: string | null;
  proposal_stage?: string | null;
  contractor_communications?: OperationalMemoryEntry[];
  lead_health?: string | null;
  lead_health_reasons?: string[];
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
  "overdue_callbacks",
  "callbacks_today",
  "callbacks_tomorrow",
  "urgent_financing_follow_up",
  "stale_leads",
  "dormant_leads",
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
  assigned_operator_id: string | null;
  assigned_operator_name: string | null;
  assigned_at: string | null;
  ownership_age_hours: number | null;
  last_touched_by: string | null;
  follow_up_reason: string | null;
  follow_up_priority: string | null;
  follow_up_channel: string | null;
  follow_up_completed_at: string | null;
  snooze_until: string | null;
  callback_bucket: string;
  callback_countdown: string | null;
  overdue: boolean;
  latest_note: string | null;
  last_contact_result: string | null;
  successful_contact_count: number;
  days_since_last_contact: number | null;
  open_task_count: number;
  overdue_task_count: number;
  financing_stage: string;
  proposal_stage: string;
  proposal_readiness: string;
  contractor_readiness: string;
  lead_health: string;
  lead_health_reasons: string[];
  time_since_intake_hours: number | null;
  time_since_last_contact_hours: number | null;
  time_waiting_on_follow_up_hours: number | null;
}

export interface OperatorDashboardSummary {
  leads_assigned_to_me: number;
  callbacks_today: number;
  overdue_callbacks: number;
  financing_reviews_pending: number;
  marketplace_ready_leads: number;
  stale_leads: number;
  proposal_follow_ups: number;
  average_response_time_hours: number | null;
  contact_conversion_rate: number;
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
    assigned_operator_id: str(operational.assigned_operator_id),
    assigned_operator_name: str(operational.assigned_operator_name),
    assigned_at: str(operational.assigned_at),
    assignment_history: Array.isArray(operational.assignment_history)
      ? (operational.assignment_history as Array<Record<string, unknown>>)
      : [],
    follow_up_reason: str(operational.follow_up_reason),
    follow_up_priority: str(operational.follow_up_priority),
    follow_up_channel: str(operational.follow_up_channel),
    follow_up_completed_at: str(operational.follow_up_completed_at),
    snooze_until: str(operational.snooze_until),
    internal_notes: Array.isArray(operational.internal_notes)
      ? (operational.internal_notes as OperationalMemoryEntry[])
      : [],
    contact_history: Array.isArray(operational.contact_history)
      ? (operational.contact_history as OperationalMemoryEntry[])
      : [],
    tasks: Array.isArray(operational.tasks)
      ? (operational.tasks as OperationalTask[])
      : [],
    financing_stage: str(operational.financing_stage),
    proposal_stage: str(operational.proposal_stage),
    contractor_communications: Array.isArray(
      operational.contractor_communications,
    )
      ? (operational.contractor_communications as OperationalMemoryEntry[])
      : [],
    lead_health: str(operational.lead_health),
    lead_health_reasons: Array.isArray(operational.lead_health_reasons)
      ? (operational.lead_health_reasons as string[])
      : [],
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

  const operatorId = detailString("assigned_operator_id") ?? options.adminId;
  const operatorName = detailString("assigned_operator_name") ?? operatorId;
  const memoryId = (type: string) =>
    `${type}_${occurredAt.replace(/[^0-9A-Za-z]/g, "")}`;
  const appendMemory = (
    key: "internal_notes" | "contact_history" | "contractor_communications",
    entry: OperationalMemoryEntry,
  ) => {
    next[key] = [...(Array.isArray(next[key]) ? next[key]! : []), entry].slice(
      -100,
    );
  };
  const noteEntry = (
    type: string,
    summary: string | null,
  ): OperationalMemoryEntry => ({
    id: memoryId(type),
    created_at: occurredAt,
    created_by: options.adminId,
    type,
    summary,
    notes: note,
  });

  if (detailString("follow_up_reason"))
    next.follow_up_reason = detailString("follow_up_reason");
  if (detailString("follow_up_priority"))
    next.follow_up_priority = detailString("follow_up_priority");
  if (detailString("follow_up_channel"))
    next.follow_up_channel = detailString("follow_up_channel");
  if (detailString("follow_up_completed_at"))
    next.follow_up_completed_at = detailString("follow_up_completed_at");
  if (detailString("snooze_until"))
    next.snooze_until = detailString("snooze_until");
  if (detailString("financing_stage"))
    next.financing_stage = detailString("financing_stage");
  if (detailString("proposal_stage"))
    next.proposal_stage = detailString("proposal_stage");

  if (action === "assign_operator" || action === "transfer_operator") {
    const previousOperatorId = next.assigned_operator_id ?? null;
    const previousOperatorName = next.assigned_operator_name ?? null;
    next.assigned_operator_id = operatorId;
    next.assigned_operator_name = operatorName;
    next.assigned_at = occurredAt;
    next.assignment_history = [
      ...(Array.isArray(current.assignment_history)
        ? current.assignment_history
        : []),
      {
        action,
        assigned_by: options.adminId,
        assigned_at: occurredAt,
        previous_operator_id: previousOperatorId,
        previous_operator_name: previousOperatorName,
        assigned_operator_id: operatorId,
        assigned_operator_name: operatorName,
      },
    ].slice(-50);
    next.review_status = "operator_assigned";
  } else if (action === "unassign_operator") {
    const previousOperatorId = next.assigned_operator_id ?? null;
    const previousOperatorName = next.assigned_operator_name ?? null;
    next.assigned_operator_id = null;
    next.assigned_operator_name = null;
    next.assigned_at = null;
    next.assignment_history = [
      ...(Array.isArray(current.assignment_history)
        ? current.assignment_history
        : []),
      {
        action,
        assigned_by: options.adminId,
        assigned_at: occurredAt,
        previous_operator_id: previousOperatorId,
        previous_operator_name: previousOperatorName,
        assigned_operator_id: null,
        assigned_operator_name: null,
      },
    ].slice(-50);
    next.review_status = "operator_unassigned";
  } else if (action === "add_internal_note") {
    appendMemory(
      "internal_notes",
      noteEntry(detailString("note_type") ?? "quick_note", note),
    );
    if (detailString("contractor_facing_notes"))
      appendMemory(
        "contractor_communications",
        noteEntry(
          "contractor_coordination",
          detailString("contractor_facing_notes"),
        ),
      );
    next.review_status = "note_added";
  } else if (action === "log_contact_attempt") {
    const result =
      detailString("contact_result") ??
      (next.reached_homeowner ? "connected" : "no_answer");
    appendMemory("contact_history", {
      ...noteEntry("contact_attempt", note),
      contact_method: next.contact_method ?? detailString("contact_method"),
      contact_result: result,
      duration_seconds: num(details.contact_duration_seconds),
      next_action: next.next_step ?? null,
    });
    next.contacted = true;
    next.last_contact_timestamp = occurredAt;
    if (["connected", "text_reply", "email_reply"].includes(result))
      next.reached_homeowner = true;
    if (
      ["no_answer", "voicemail", "disconnected", "wrong_number"].includes(
        result,
      )
    )
      next.no_answer_count = (next.no_answer_count ?? 0) + 1;
    next.review_status = result;
  } else if (action === "create_follow_up_task") {
    const taskId = detailString("task_id") ?? memoryId("task");
    const dueAt = followUpAt ?? detailString("task_due_at");
    const task: OperationalTask = {
      id: taskId,
      title:
        detailString("task_title") ??
        next.next_step ??
        "Follow up with homeowner",
      owner_id:
        detailString("task_owner_id") ??
        next.assigned_operator_id ??
        operatorId,
      owner_name:
        detailString("task_owner_name") ??
        next.assigned_operator_name ??
        operatorName,
      due_at: dueAt,
      priority:
        detailString("task_priority") ?? next.follow_up_priority ?? "normal",
      status: "open",
      notes: note,
    };
    next.tasks = [...(Array.isArray(next.tasks) ? next.tasks : []), task].slice(
      -100,
    );
    next.needs_follow_up = true;
    if (task.due_at) next.follow_up_at = task.due_at;
    next.review_status = "task_opened";
  } else if (action === "complete_follow_up_task") {
    const taskId = detailString("task_id");
    next.tasks = (Array.isArray(next.tasks) ? next.tasks : []).map((task) =>
      !taskId || task.id === taskId
        ? {
            ...task,
            status: "completed",
            completed_at: occurredAt,
            notes: note ?? task.notes ?? null,
          }
        : task,
    );
    next.follow_up_completed_at = occurredAt;
    next.needs_follow_up = (next.tasks ?? []).some(
      (task) => task.status !== "completed",
    );
    next.review_status = "task_completed";
  } else if (action === "update_financing_stage") {
    next.financing_stage =
      detailString("financing_stage") ??
      next.financing_stage ??
      "financing_review";
    next.financing_ready = ["financing_approved", "cash_purchase"].includes(
      next.financing_stage,
    );
    next.review_status = next.financing_stage;
    if (note) appendMemory("internal_notes", noteEntry("financing_note", note));
  } else if (action === "update_proposal_stage") {
    next.proposal_stage =
      detailString("proposal_stage") ??
      next.proposal_stage ??
      "design_in_progress";
    next.review_status = next.proposal_stage;
    if (note) appendMemory("internal_notes", noteEntry("proposal_note", note));
  } else if (action === "mark_contacted") {
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
      assigned_operator_id: next.assigned_operator_id ?? null,
      assigned_operator_name: next.assigned_operator_name ?? null,
      follow_up_reason: next.follow_up_reason ?? null,
      follow_up_priority: next.follow_up_priority ?? null,
      follow_up_channel: next.follow_up_channel ?? null,
      follow_up_completed_at: next.follow_up_completed_at ?? null,
      snooze_until: next.snooze_until ?? null,
      contact_result: detailString("contact_result"),
      task_title: detailString("task_title"),
      task_due_at: detailString("task_due_at"),
      financing_stage: next.financing_stage ?? null,
      proposal_stage: next.proposal_stage ?? null,
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
  receivedAt?: unknown;
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

  const nowMs = Date.now();
  const parseMs = (value?: string | null) => {
    if (!value) return null;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  };
  const hoursSince = (value?: string | null) => {
    const parsed = parseMs(value);
    return parsed == null
      ? null
      : Math.max(0, Math.round(((nowMs - parsed) / 3_600_000) * 10) / 10);
  };
  const daysSince = (value?: string | null) => {
    const hours = hoursSince(value);
    return hours == null ? null : Math.floor(hours / 24);
  };
  const followUpMs = parseMs(operational.follow_up_at);
  const startOfToday = new Date(nowMs);
  startOfToday.setHours(0, 0, 0, 0);
  const todayMs = startOfToday.getTime();
  const tomorrowMs = todayMs + 86_400_000;
  const dayAfterTomorrowMs = tomorrowMs + 86_400_000;
  const overdue = followUpMs != null && followUpMs < nowMs;
  const callback_bucket =
    followUpMs == null
      ? "unscheduled"
      : overdue
        ? "overdue"
        : followUpMs < tomorrowMs
          ? "today"
          : followUpMs < dayAfterTomorrowMs
            ? "tomorrow"
            : "future";
  const callback_countdown =
    followUpMs == null
      ? null
      : overdue
        ? `${Math.max(1, Math.ceil((nowMs - followUpMs) / 3_600_000))}h overdue`
        : `${Math.max(1, Math.ceil((followUpMs - nowMs) / 3_600_000))}h remaining`;

  const contactHistory = Array.isArray(operational.contact_history)
    ? operational.contact_history
    : [];
  const internalNotes = Array.isArray(operational.internal_notes)
    ? operational.internal_notes
    : [];
  const latestNoteEntry = [...internalNotes, ...contactHistory]
    .sort(
      (first, second) =>
        (parseMs(str(first.created_at)) ?? 0) -
        (parseMs(str(second.created_at)) ?? 0),
    )
    .at(-1);
  const latest_note =
    str(latestNoteEntry?.summary) ?? str(latestNoteEntry?.notes) ?? null;
  const lastContactEntry = contactHistory.at(-1) ?? null;
  const last_contact_result = str(lastContactEntry?.contact_result);
  const successful_contact_count = contactHistory.filter((entry) =>
    ["connected", "text_reply", "email_reply", "appointment_set"].includes(
      str(entry.contact_result) ?? "",
    ),
  ).length;
  const openTasks = (
    Array.isArray(operational.tasks) ? operational.tasks : []
  ).filter((task) => task.status !== "completed");
  const overdue_task_count = openTasks.filter((task) => {
    const due = parseMs(task.due_at);
    return due != null && due < nowMs;
  }).length;
  const contact_attempt_count = Math.max(
    contactHistory.length,
    operational.no_answer_count ?? 0,
  );
  const assigned_operator_name = operational.assigned_operator_name ?? null;
  const assigned_operator_id = operational.assigned_operator_id ?? null;
  const assigned_operator =
    assigned_operator_name ?? operational.last_reviewed_by ?? null;
  const time_since_intake_hours = hoursSince(
    str((input as Record<string, unknown>).receivedAt) ?? null,
  );
  const time_since_last_contact_hours = hoursSince(
    operational.last_contact_timestamp,
  );
  const time_waiting_on_follow_up_hours = operational.needs_follow_up
    ? hoursSince(operational.follow_up_at ?? operational.last_reviewed_at)
    : null;
  const staleLead =
    !operational.approved_for_marketplace &&
    !operational.rejected &&
    !operational.archived &&
    ((time_since_last_contact_hours != null &&
      time_since_last_contact_hours >= 72) ||
      (!operational.contacted &&
        time_since_intake_hours != null &&
        time_since_intake_hours >= 24));
  const dormantLead =
    !operational.approved_for_marketplace &&
    !operational.rejected &&
    !operational.archived &&
    ((time_since_last_contact_hours != null &&
      time_since_last_contact_hours >= 168) ||
      (!operational.contacted &&
        time_since_intake_hours != null &&
        time_since_intake_hours >= 72));
  const urgentFinancingFollowUp =
    operational.follow_up_priority === "urgent" &&
    (operational.financing_stage ?? operational.financing_path ?? "").includes(
      "financ",
    );

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
  } else if (overdue || overdue_task_count > 0) {
    current_queue = "overdue_callbacks";
    next_action = "Work overdue callback or follow-up task immediately";
  } else if (urgentFinancingFollowUp) {
    current_queue = "urgent_financing_follow_up";
    next_action = "Resolve urgent financing follow-up";
  } else if (callback_bucket === "today") {
    current_queue = "callbacks_today";
    next_action = "Complete today's scheduled callback";
  } else if (callback_bucket === "tomorrow") {
    current_queue = "callbacks_tomorrow";
    next_action = "Prepare tomorrow's scheduled callback";
  } else if (dormantLead) {
    current_queue = "dormant_leads";
    next_action = "Revive or archive dormant lead";
  } else if (staleLead) {
    current_queue = "stale_leads";
    next_action = "Refresh stale lead context and contact plan";
  } else if (
    operational.needs_follow_up &&
    (operational.callback_reason ||
      operational.follow_up_reason ||
      reviewStatus === "needs_callback")
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

  const financing_stage =
    operational.financing_stage ?? operational.financing_path ?? "not_started";
  const proposal_stage = operational.proposal_stage ?? "not_started";
  const financing_status = operational.financing_ready
    ? "financing_ready"
    : operational.financing_path || operational.financing_stage
      ? "financing_reviewed"
      : "needs_financing_review";
  const qualification_status = operational.qualified
    ? "qualified"
    : qualificationCompleteness === "complete"
      ? "needs_operator_qualification"
      : "missing_qualification";
  const proposal_readiness = ["proposal_sent", "proposal_accepted"].includes(
    proposal_stage,
  )
    ? "ready"
    : proposal_stage === "not_started"
      ? "not_started"
      : "in_progress";
  const contractor_readiness = releaseReadiness?.ready
    ? "ready_for_contractor"
    : releaseReadiness?.missing?.length
      ? "blocked"
      : "pending";
  const lead_health_reasons = new Set<string>(
    operational.lead_health_reasons ?? [],
  );
  if (overdue) lead_health_reasons.add("callback_overdue");
  if (overdue_task_count > 0) lead_health_reasons.add("task_overdue");
  if (dormantLead) lead_health_reasons.add("dormant_no_recent_contact");
  else if (staleLead) lead_health_reasons.add("stale_no_recent_contact");
  if (releaseReadiness?.ready)
    lead_health_reasons.add("marketplace_release_ready");
  if (successful_contact_count > 0)
    lead_health_reasons.add("homeowner_contacted");
  const lead_health =
    operational.lead_health ??
    (operational.rejected || operational.archived
      ? "closed"
      : overdue || overdue_task_count > 0
        ? "at_risk"
        : dormantLead
          ? "dormant"
          : staleLead
            ? "stale"
            : releaseReadiness?.ready
              ? "healthy"
              : "active");

  return {
    current_queue,
    next_action,
    next_follow_up_at: operational.follow_up_at ?? null,
    assigned_operator,
    last_contacted_at: operational.last_contact_timestamp ?? null,
    contact_attempt_count,
    last_operator_action: operational.last_review_action ?? null,
    release_readiness: releaseReadiness,
    financing_status,
    qualification_status,
    assigned_operator_id,
    assigned_operator_name,
    assigned_at: operational.assigned_at ?? null,
    ownership_age_hours: hoursSince(operational.assigned_at),
    last_touched_by: operational.last_reviewed_by ?? assigned_operator_id,
    follow_up_reason:
      operational.follow_up_reason ?? operational.callback_reason ?? null,
    follow_up_priority: operational.follow_up_priority ?? null,
    follow_up_channel:
      operational.follow_up_channel ?? operational.contact_method ?? null,
    follow_up_completed_at: operational.follow_up_completed_at ?? null,
    snooze_until: operational.snooze_until ?? null,
    callback_bucket,
    callback_countdown,
    overdue,
    latest_note,
    last_contact_result,
    successful_contact_count,
    days_since_last_contact: daysSince(operational.last_contact_timestamp),
    open_task_count: openTasks.length,
    overdue_task_count,
    financing_stage,
    proposal_stage,
    proposal_readiness,
    contractor_readiness,
    lead_health,
    lead_health_reasons: Array.from(lead_health_reasons),
    time_since_intake_hours,
    time_since_last_contact_hours,
    time_waiting_on_follow_up_hours,
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
