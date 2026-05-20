export const LEAD_OPS_QUEUE_DEFINITIONS = [
  { key: "new_intake", label: "New Intake" },
  { key: "needs_first_contact", label: "Needs First Contact" },
  { key: "no_answer_retry", label: "No Answer Retry" },
  { key: "needs_callback", label: "Needs Callback" },
  { key: "waiting_on_homeowner", label: "Waiting on Homeowner" },
  { key: "waiting_on_documents", label: "Waiting on Documents" },
  { key: "overdue_callbacks", label: "Overdue Callbacks" },
  { key: "callbacks_today", label: "Callbacks Today" },
  { key: "callbacks_tomorrow", label: "Callbacks Tomorrow" },
  { key: "urgent_financing_follow_up", label: "Urgent Financing Follow-Up" },
  { key: "stale_leads", label: "Stale Leads" },
  { key: "dormant_leads", label: "Dormant Leads" },
  { key: "qualification_review", label: "Qualification Review" },
  { key: "financing_review", label: "Financing Review" },
  { key: "proposal_follow_up", label: "Proposal Follow-Up" },
  { key: "missing_documents", label: "Missing Documents" },
  { key: "marketplace_ready", label: "Marketplace Ready" },
  { key: "released", label: "Released" },
  { key: "rejected", label: "Rejected" },
  { key: "archived", label: "Archived" },
] as const;

export const LEAD_OPS_QUEUES = LEAD_OPS_QUEUE_DEFINITIONS.map(
  (queue) => queue.key,
) as [
  "new_intake",
  "needs_first_contact",
  "no_answer_retry",
  "needs_callback",
  "waiting_on_homeowner",
  "waiting_on_documents",
  "overdue_callbacks",
  "callbacks_today",
  "callbacks_tomorrow",
  "urgent_financing_follow_up",
  "stale_leads",
  "dormant_leads",
  "qualification_review",
  "financing_review",
  "proposal_follow_up",
  "missing_documents",
  "marketplace_ready",
  "released",
  "rejected",
  "archived",
];

export type LeadOpsQueue = (typeof LEAD_OPS_QUEUES)[number];

export interface OperationalQueueTiming {
  callback_at: string | null;
  follow_up_at: string | null;
  dormant_until: string | null;
  callback_bucket: string;
  callback_countdown: string | null;
  overdue: boolean;
  stale_lead: boolean;
  dormant_lead: boolean;
  overdue_task_count: number;
  open_task_count: number;
  time_since_intake_hours: number | null;
  time_since_last_contact_hours: number | null;
  time_waiting_on_follow_up_hours: number | null;
}

export interface OperationalQueueInput {
  operational: {
    lifecycle_status?: string | null;
    review_status?: string | null;
    contacted?: boolean | null;
    no_answer_count?: number | null;
    bad_lead?: boolean | null;
    qualified?: boolean | null;
    financing_ready?: boolean | null;
    needs_follow_up?: boolean | null;
    approved_for_marketplace?: boolean | null;
    rejected?: boolean | null;
    archived?: boolean | null;
    follow_up_at?: string | null;
    callback_at?: string | null;
    callback_reason?: string | null;
    follow_up_reason?: string | null;
    follow_up_priority?: string | null;
    last_contact_timestamp?: string | null;
    last_reviewed_at?: string | null;
    financing_stage?: string | null;
    financing_path?: string | null;
    proposal_stage?: string | null;
    dormant_until?: string | null;
    dormant_reason?: string | null;
    tasks?: Array<{ status?: string | null; due_at?: string | null }> | null;
  };
  reviewStatus?: string | null;
  readyForReview?: boolean;
  qualificationCompleteness?: string | null;
  attachmentCompleteness?: string | null;
  releaseReadiness?: { ready?: boolean | null } | null;
  receivedAt?: string | null;
  nowMs?: number;
}

export interface ResolvedOperationalQueue {
  current_queue: LeadOpsQueue;
  next_action: string;
  timing: OperationalQueueTiming;
}

function parseMs(value?: string | null): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function hoursSince(nowMs: number, value?: string | null): number | null {
  const parsed = parseMs(value);
  return parsed == null
    ? null
    : Math.max(0, Math.round(((nowMs - parsed) / 3_600_000) * 10) / 10);
}

function resolveCallbackTiming(input: {
  callbackAt: string | null;
  followUpAt: string | null;
  dormantUntil: string | null;
  nowMs: number;
  overdueTaskCount: number;
  openTaskCount: number;
  timeSinceIntakeHours: number | null;
  timeSinceLastContactHours: number | null;
  timeWaitingOnFollowUpHours: number | null;
  staleLead: boolean;
  dormantLead: boolean;
}): OperationalQueueTiming {
  const scheduledAt = input.callbackAt ?? input.followUpAt;
  const scheduledMs = parseMs(scheduledAt);
  const startOfToday = new Date(input.nowMs);
  startOfToday.setHours(0, 0, 0, 0);
  const todayMs = startOfToday.getTime();
  const tomorrowMs = todayMs + 86_400_000;
  const dayAfterTomorrowMs = tomorrowMs + 86_400_000;
  const overdue = scheduledMs != null && scheduledMs < input.nowMs;
  const callback_bucket =
    scheduledMs == null
      ? "unscheduled"
      : overdue
        ? "overdue"
        : scheduledMs < tomorrowMs
          ? "today"
          : scheduledMs < dayAfterTomorrowMs
            ? "tomorrow"
            : "future";
  const callback_countdown =
    scheduledMs == null
      ? null
      : overdue
        ? `${Math.max(1, Math.ceil((input.nowMs - scheduledMs) / 3_600_000))}h overdue`
        : `${Math.max(1, Math.ceil((scheduledMs - input.nowMs) / 3_600_000))}h remaining`;

  return {
    callback_at: input.callbackAt,
    follow_up_at: input.followUpAt,
    dormant_until: input.dormantUntil,
    callback_bucket,
    callback_countdown,
    overdue,
    stale_lead: input.staleLead,
    dormant_lead: input.dormantLead,
    overdue_task_count: input.overdueTaskCount,
    open_task_count: input.openTaskCount,
    time_since_intake_hours: input.timeSinceIntakeHours,
    time_since_last_contact_hours: input.timeSinceLastContactHours,
    time_waiting_on_follow_up_hours: input.timeWaitingOnFollowUpHours,
  };
}

export function resolveOperationalQueue(
  input: OperationalQueueInput,
): ResolvedOperationalQueue {
  const operational = input.operational;
  const nowMs = input.nowMs ?? Date.now();
  const reviewStatus = input.reviewStatus ?? operational.review_status ?? null;
  const qualificationCompleteness =
    input.qualificationCompleteness ?? "missing";
  const attachmentCompleteness = input.attachmentCompleteness ?? "missing";
  const callbackAt = operational.callback_at ?? null;
  const followUpAt = operational.follow_up_at ?? null;
  const dormantUntil = operational.dormant_until ?? null;
  const openTasks = (operational.tasks ?? []).filter(
    (task) => task.status !== "completed",
  );
  const overdueTaskCount = openTasks.filter((task) => {
    const due = parseMs(task.due_at);
    return due != null && due < nowMs;
  }).length;
  const timeSinceIntakeHours = hoursSince(nowMs, input.receivedAt ?? null);
  const timeSinceLastContactHours = hoursSince(
    nowMs,
    operational.last_contact_timestamp ?? null,
  );
  const timeWaitingOnFollowUpHours = operational.needs_follow_up
    ? hoursSince(nowMs, followUpAt ?? operational.last_reviewed_at ?? null)
    : null;
  const staleLead =
    !operational.approved_for_marketplace &&
    !operational.rejected &&
    !operational.archived &&
    ((timeSinceLastContactHours != null && timeSinceLastContactHours >= 72) ||
      (!operational.contacted &&
        timeSinceIntakeHours != null &&
        timeSinceIntakeHours >= 24));
  const dormantLead =
    !operational.approved_for_marketplace &&
    !operational.rejected &&
    !operational.archived &&
    (!!operational.dormant_reason ||
      (dormantUntil != null &&
        (parseMs(dormantUntil) == null || parseMs(dormantUntil)! >= nowMs)) ||
      (timeSinceLastContactHours != null && timeSinceLastContactHours >= 168) ||
      (!operational.contacted &&
        timeSinceIntakeHours != null &&
        timeSinceIntakeHours >= 72));
  const timing = resolveCallbackTiming({
    callbackAt,
    followUpAt,
    dormantUntil,
    nowMs,
    overdueTaskCount,
    openTaskCount: openTasks.length,
    timeSinceIntakeHours,
    timeSinceLastContactHours,
    timeWaitingOnFollowUpHours,
    staleLead,
    dormantLead,
  });
  const urgentFinancingFollowUp =
    operational.follow_up_priority === "urgent" &&
    (operational.financing_stage ?? operational.financing_path ?? "").includes(
      "financ",
    );

  if (operational.archived || reviewStatus === "archived") {
    return {
      current_queue: "archived",
      next_action: "No action — soft archived",
      timing,
    };
  }
  if (
    operational.rejected ||
    operational.bad_lead ||
    ["rejected", "bad_lead"].includes(reviewStatus ?? "")
  ) {
    return {
      current_queue: "rejected",
      next_action: "No action — rejected",
      timing,
    };
  }
  if (
    operational.lifecycle_status === "marketplace_live" ||
    reviewStatus === "marketplace_live"
  ) {
    return {
      current_queue: "released",
      next_action: "Monitor marketplace claim activity",
      timing,
    };
  }
  if (
    operational.approved_for_marketplace ||
    operational.lifecycle_status === "ready_for_marketplace" ||
    reviewStatus === "approved_for_marketplace"
  ) {
    return {
      current_queue: "marketplace_ready",
      next_action: input.releaseReadiness?.ready
        ? "Release through marketplace gate"
        : "Resolve release readiness gaps",
      timing,
    };
  }
  if (timing.overdue || overdueTaskCount > 0) {
    return {
      current_queue: "overdue_callbacks",
      next_action: "Work overdue callback or follow-up task immediately",
      timing,
    };
  }
  if (dormantLead) {
    return {
      current_queue: "dormant_leads",
      next_action: "Revive or archive dormant lead",
      timing,
    };
  }
  if (urgentFinancingFollowUp) {
    return {
      current_queue: "urgent_financing_follow_up",
      next_action: "Resolve urgent financing follow-up",
      timing,
    };
  }
  if (timing.callback_bucket === "today") {
    return {
      current_queue: "callbacks_today",
      next_action: "Complete today's scheduled callback",
      timing,
    };
  }
  if (timing.callback_bucket === "tomorrow") {
    return {
      current_queue: "callbacks_tomorrow",
      next_action: "Prepare tomorrow's scheduled callback",
      timing,
    };
  }
  if (staleLead) {
    return {
      current_queue: "stale_leads",
      next_action: "Refresh stale lead context and contact plan",
      timing,
    };
  }
  if (
    operational.needs_follow_up &&
    (operational.callback_reason ||
      operational.follow_up_reason ||
      reviewStatus === "needs_callback")
  ) {
    return {
      current_queue: "needs_callback",
      next_action: "Call homeowner at scheduled callback time",
      timing,
    };
  }
  if (reviewStatus === "documents_reopened") {
    return {
      current_queue: "waiting_on_documents",
      next_action: "Collect reopened document requirements",
      timing,
    };
  }
  if (attachmentCompleteness !== "complete") {
    return {
      current_queue: "missing_documents",
      next_action: "Review or waive utility bill evidence",
      timing,
    };
  }
  if (reviewStatus === "qualification_reopened") {
    return {
      current_queue: "qualification_review",
      next_action: "Rework qualification review",
      timing,
    };
  }
  if (reviewStatus === "financing_reopened") {
    return {
      current_queue: "financing_review",
      next_action: "Rework financing readiness",
      timing,
    };
  }
  if (
    operational.proposal_stage &&
    !["not_started", "proposal_accepted"].includes(operational.proposal_stage)
  ) {
    return {
      current_queue: "proposal_follow_up",
      next_action: "Follow up on active proposal work",
      timing,
    };
  }
  if (reviewStatus === "no_answer") {
    return {
      current_queue: "no_answer_retry",
      next_action: "Retry contact attempt",
      timing,
    };
  }
  if (!operational.contacted && input.readyForReview) {
    return {
      current_queue: "needs_first_contact",
      next_action: "Make first contact attempt",
      timing,
    };
  }
  if (
    qualificationCompleteness !== "complete" ||
    operational.lifecycle_status === "qualification_in_progress"
  ) {
    return {
      current_queue: "qualification_review",
      next_action: "Complete qualification review",
      timing,
    };
  }
  if (!operational.financing_ready) {
    return {
      current_queue: "financing_review",
      next_action: "Review financing readiness",
      timing,
    };
  }
  if (!operational.contacted) {
    return {
      current_queue: "new_intake",
      next_action: "Triage new intake",
      timing,
    };
  }
  return {
    current_queue: "qualification_review",
    next_action: "Advance lead qualification",
    timing,
  };
}
