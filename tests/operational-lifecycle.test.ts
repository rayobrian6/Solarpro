import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyOperatorReviewAction,
  deriveLeadOpsSummary,
  deriveReleaseReadiness,
  operationalIntelligence,
  stateFromPipelineResult,
} from "@/lib/intake/operationalLifecycle";
import {
  LEAD_OPS_QUEUE_DEFINITIONS,
  resolveOperationalQueue,
} from "@/lib/intake/operationalQueues";
import { evaluateMarketplaceReleaseGate } from "@/lib/network/marketplaceReleaseGate";

const readyOperational = {
  contacted: true,
  qualified: true,
  financing_ready: true,
  approved_for_marketplace: true,
  lifecycle_status: "ready_for_marketplace",
  review_status: "approved_for_marketplace",
};

const qualification = {
  qualification_status: "high_intent",
  lead_score: 86,
  finance_readiness: true,
};

describe("operational lifecycle and marketplace release gate", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it("applies operator review actions as canonical lifecycle transitions", () => {
    const initial = stateFromPipelineResult({
      review_status: "pending_operator_review",
    });
    const contacted = applyOperatorReviewAction(initial, "mark_contacted", {
      adminId: "admin-1",
      notes: "Reached homeowner",
      occurredAt: "2026-01-01T00:00:00Z",
    });
    expect(contacted).toMatchObject({
      lifecycle_status: "operator_contacted",
      review_status: "operator_contacted",
      contacted: true,
    });

    const qualified = applyOperatorReviewAction(contacted, "mark_qualified", {
      adminId: "admin-1",
      occurredAt: "2026-01-01T00:05:00Z",
    });
    expect(qualified).toMatchObject({
      lifecycle_status: "vetted_qualified",
      review_status: "vetted_qualified",
      qualified: true,
    });

    const approved = applyOperatorReviewAction(
      qualified,
      "approve_for_marketplace",
      { adminId: "admin-1", occurredAt: "2026-01-01T00:10:00Z" },
    );
    expect(approved).toMatchObject({
      lifecycle_status: "ready_for_marketplace",
      review_status: "approved_for_marketplace",
      approved_for_marketplace: true,
    });
    expect(approved.action_history).toHaveLength(3);
    expect(approved.action_history?.map((entry) => entry.action)).toEqual([
      "mark_contacted",
      "mark_qualified",
      "approve_for_marketplace",
    ]);
  });

  it("requires operator review, qualification, validation, financing, intent, and explicit approval before release", () => {
    const blocked = deriveReleaseReadiness({
      operational: { contacted: true },
      qualification: { qualification_status: "high_intent" },
      validation: { valid: true },
    });
    expect(blocked.ready).toBe(false);
    expect(blocked.missing).toEqual(
      expect.arrayContaining([
        "financing_readiness_reviewed",
        "approved_for_marketplace",
      ]),
    );

    const ready = deriveReleaseReadiness({
      operational: readyOperational,
      qualification,
      validation: { valid: true },
      screening: { screening_status: "approved" },
    });
    expect(ready).toMatchObject({ ready: true, missing: [] });
  });

  it("hardens marketplace gate beyond live plus screening approval", () => {
    const gate = evaluateMarketplaceReleaseGate({
      id: "opp-1",
      status: "live",
      screening_status: "approved",
      intake_metadata: { operational: readyOperational, qualification },
    });
    expect(gate.ok).toBe(true);

    const blocked = evaluateMarketplaceReleaseGate({
      id: "opp-2",
      status: "live",
      screening_status: "approved",
      intake_metadata: { operational: { contacted: true }, qualification },
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.missing).toContain("approved_for_marketplace");

    const archived = evaluateMarketplaceReleaseGate({
      id: "opp-3",
      status: "live",
      screening_status: "approved",
      intake_metadata: {
        operational: { ...readyOperational, archived: true },
        qualification,
      },
    });
    expect(archived.ok).toBe(false);
    expect(archived.missing).toContain("active_not_archived_or_rejected");

    const simulated = evaluateMarketplaceReleaseGate({
      id: "opp-4",
      status: "live",
      screening_status: "approved",
      intake_metadata: {
        operational: readyOperational,
        qualification,
        is_simulated: true,
      },
    });
    expect(simulated.ok).toBe(false);
    expect(simulated.missing).toContain("not_test_or_simulated");
  });

  it("derives admin operational intelligence fields without a parallel CRM table", () => {
    const intelligence = operationalIntelligence({
      operational: {
        ...readyOperational,
        operator_notes: "Good lead",
        last_contact_timestamp: "2026-01-01T00:00:00Z",
      },
      qualification,
      validation: { valid: true },
      receivedAt: "2026-01-01T00:00:00Z",
    });
    expect(intelligence).toMatchObject({
      qualification_confidence: 86,
      financing_readiness: true,
      estimated_close_quality: "high",
      operator_notes: "Good lead",
      last_contact_timestamp: "2026-01-01T00:00:00Z",
    });
  });
  it("derives Lead Operations queues and summary fields from existing operational state", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
    const { deriveLeadOpsSummary } =
      await import("@/lib/intake/operationalLifecycle");
    const fresh = deriveLeadOpsSummary({
      operational: {
        lifecycle_status: "pending_operator_review",
        review_status: "pending_operator_review",
      },
      reviewStatus: "pending_operator_review",
      readyForReview: true,
      qualificationCompleteness: "complete",
      attachmentCompleteness: "complete",
    });
    expect(fresh).toMatchObject({
      current_queue: "needs_first_contact",
      next_action: "Make first contact attempt",
    });

    const noAnswer = applyOperatorReviewAction(
      stateFromPipelineResult({}),
      "mark_no_answer",
      {
        adminId: "admin-1",
        occurredAt: "2026-01-01T00:00:00Z",
        notes: "Left voicemail",
        details: {
          contact_method: "phone",
          voicemail_left: true,
          follow_up_at: "2026-01-05T15:00",
        },
      },
    );
    const noAnswerSummary = deriveLeadOpsSummary({
      operational: noAnswer,
      reviewStatus: noAnswer.review_status,
      qualificationCompleteness: "complete",
      attachmentCompleteness: "complete",
    });
    expect(noAnswerSummary).toMatchObject({
      current_queue: "no_answer_retry",
      next_follow_up_at: "2026-01-05T15:00",
      contact_attempt_count: 1,
      last_operator_action: "mark_no_answer",
    });

    const callback = applyOperatorReviewAction(
      noAnswer,
      "mark_needs_follow_up",
      {
        adminId: "admin-2",
        occurredAt: "2026-01-01T00:10:00Z",
        notes:
          "Customer asked for a callback in two weeks after reviewing current utility bill.",
        details: {
          requested_callback_at: "2026-01-15T17:30",
          callback_reason: "Reviewing utility bill",
        },
      },
    );
    const callbackSummary = deriveLeadOpsSummary({
      operational: callback,
      reviewStatus: callback.review_status,
      qualificationCompleteness: "complete",
      attachmentCompleteness: "complete",
    });
    expect(callbackSummary.current_queue).toBe("needs_callback");
    expect(callback.follow_up_at).toBe("2026-01-15T17:30");
    expect(callback.callback_reason).toBe("Reviewing utility bill");
    expect(callback.action_history?.at(-1)).toMatchObject({
      action: "mark_needs_follow_up",
      previous_status: "no_answer",
      next_status: "needs_callback",
      follow_up_at: "2026-01-15T17:30",
    });
  });

  it("persists rich financing, qualification, archive, and test lead metadata in action history", () => {
    const initial = stateFromPipelineResult({});
    const financing = applyOperatorReviewAction(
      initial,
      "mark_financing_ready",
      {
        adminId: "admin-1",
        occurredAt: "2026-01-01T01:00:00Z",
        notes: "Financing looks workable",
        details: {
          financing_path: "loan",
          credit_band: "700+",
          income_band: "100k+",
          financing_notes: "Preliminarily finance-ready",
        },
      },
    );
    expect(financing).toMatchObject({
      financing_ready: true,
      financing_path: "loan",
      credit_band: "700+",
    });

    const qualified = applyOperatorReviewAction(financing, "mark_qualified", {
      adminId: "admin-1",
      occurredAt: "2026-01-01T01:05:00Z",
      notes: "Qualified after bill review",
      details: {
        qualification_reason: "High bill and homeowner intent",
        operator_confidence: "high",
        missing_items_resolved: true,
      },
    });
    expect(qualified.action_history?.at(-1)).toMatchObject({
      action: "mark_qualified",
      qualification_reason: "High bill and homeowner intent",
      operator_confidence: "high",
      missing_items_resolved: true,
    });

    const archived = applyOperatorReviewAction(qualified, "archive_lead", {
      adminId: "admin-1",
      occurredAt: "2026-01-01T01:10:00Z",
      notes: "Internal test submission",
      details: { archive_reason: "test lead", is_test_lead: true },
    });
    expect(archived).toMatchObject({
      archived: true,
      is_test_lead: true,
      archive_reason: "test lead",
    });
  });

  it("projects operator assignment, reassignment history, and immutable action audit", () => {
    const initial = stateFromPipelineResult({});
    const assigned = applyOperatorReviewAction(initial, "assign_operator", {
      adminId: "admin-1",
      occurredAt: "2026-01-01T09:00:00Z",
      details: {
        assigned_operator_id: "ops-1",
        assigned_operator_name: "Avery Operator",
      },
    });
    expect(assigned).toMatchObject({
      assigned_operator_id: "ops-1",
      assigned_operator_name: "Avery Operator",
      assigned_at: "2026-01-01T09:00:00Z",
      review_status: "operator_assigned",
    });
    expect(assigned.assignment_history).toHaveLength(1);

    const transferred = applyOperatorReviewAction(
      assigned,
      "transfer_operator",
      {
        adminId: "admin-2",
        occurredAt: "2026-01-01T10:00:00Z",
        details: {
          assigned_operator_id: "ops-2",
          assigned_operator_name: "Blake Closer",
        },
      },
    );
    expect(transferred.assignment_history?.at(-1)).toMatchObject({
      previous_operator_id: "ops-1",
      assigned_operator_id: "ops-2",
      assigned_operator_name: "Blake Closer",
    });
    expect(transferred.action_history?.map((entry) => entry.action)).toEqual([
      "assign_operator",
      "transfer_operator",
    ]);
  });

  it("appends internal notes and contact history without overwriting prior memory", () => {
    const noted = applyOperatorReviewAction(
      stateFromPipelineResult({}),
      "add_internal_note",
      {
        adminId: "admin-1",
        occurredAt: "2026-01-01T11:00:00Z",
        notes: "Homeowner wants evening calls only.",
        details: { note_type: "callback_preference" },
      },
    );
    const contacted = applyOperatorReviewAction(noted, "log_contact_attempt", {
      adminId: "admin-1",
      occurredAt: "2026-01-01T11:15:00Z",
      notes: "Discussed utility bill and roof age.",
      details: {
        contact_method: "phone",
        contact_result: "connected",
        contact_duration_seconds: "420",
        next_step: "Send proposal summary",
      },
    });
    expect(contacted.internal_notes).toHaveLength(1);
    expect(contacted.contact_history).toHaveLength(1);
    expect(contacted.contact_history?.[0]).toMatchObject({
      contact_method: "phone",
      contact_result: "connected",
      duration_seconds: 420,
    });
    expect(contacted.reached_homeowner).toBe(true);
    const summary = deriveLeadOpsSummary({
      operational: contacted,
      readyForReview: true,
      qualificationCompleteness: "complete",
      attachmentCompleteness: "complete",
      receivedAt: "2026-01-01T10:00:00Z",
    });
    expect(summary.latest_note).toBe("Discussed utility bill and roof age.");
    expect(summary.successful_contact_count).toBe(1);
    expect(summary.last_contact_result).toBe("connected");
  });

  it("projects event-first follow-up tasks and overdue callback queues", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T12:00:00Z"));
    const tasked = applyOperatorReviewAction(
      stateFromPipelineResult({}),
      "create_follow_up_task",
      {
        adminId: "admin-1",
        occurredAt: "2026-01-01T09:00:00Z",
        notes: "Call back after spouse reviews proposal.",
        details: {
          task_id: "task-1",
          task_title: "Call homeowner back",
          task_due_at: "2026-01-02T09:00:00Z",
          task_priority: "urgent",
          follow_up_priority: "urgent",
          follow_up_channel: "phone",
        },
      },
    );
    const overdueSummary = deriveLeadOpsSummary({
      operational: tasked,
      readyForReview: true,
      qualificationCompleteness: "complete",
      attachmentCompleteness: "complete",
      receivedAt: "2026-01-01T08:00:00Z",
    });
    expect(overdueSummary).toMatchObject({
      current_queue: "overdue_callbacks",
      overdue: true,
      open_task_count: 1,
      overdue_task_count: 1,
      lead_health: "at_risk",
    });

    const completed = applyOperatorReviewAction(
      tasked,
      "complete_follow_up_task",
      {
        adminId: "admin-1",
        occurredAt: "2026-01-02T12:30:00Z",
        notes: "Task completed after callback.",
        details: { task_id: "task-1" },
      },
    );
    expect(completed.tasks?.[0]).toMatchObject({
      id: "task-1",
      status: "completed",
      completed_at: "2026-01-02T12:30:00Z",
    });
    expect(completed.needs_follow_up).toBe(false);
  });

  it("derives callbacks today, tomorrow, stale, dormant, financing, proposal, and lead health intelligence", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T12:00:00Z"));
    const today = deriveLeadOpsSummary({
      operational: {
        needs_follow_up: true,
        follow_up_at: "2026-01-02T18:00:00Z",
        follow_up_reason: "Customer requested evening callback",
        lifecycle_status: "operator_contacted",
        review_status: "needs_callback",
      },
      qualificationCompleteness: "complete",
      attachmentCompleteness: "complete",
      receivedAt: "2026-01-02T08:00:00Z",
    });
    expect(today.current_queue).toBe("callbacks_today");
    expect(today.callback_bucket).toBe("today");

    const tomorrow = deriveLeadOpsSummary({
      operational: {
        needs_follow_up: true,
        follow_up_at: "2026-01-03T09:00:00Z",
        follow_up_reason: "Tomorrow callback",
      },
      qualificationCompleteness: "complete",
      attachmentCompleteness: "complete",
      receivedAt: "2026-01-02T08:00:00Z",
    });
    expect(tomorrow.current_queue).toBe("callbacks_tomorrow");

    const stale = deriveLeadOpsSummary({
      operational: {
        contacted: true,
        last_contact_timestamp: "2025-12-25T12:00:00Z",
      },
      qualificationCompleteness: "complete",
      attachmentCompleteness: "complete",
      receivedAt: "2025-12-25T12:00:00Z",
    });
    expect(stale.current_queue).toBe("dormant_leads");
    expect(stale.lead_health_reasons).toContain("dormant_no_recent_contact");

    const stage = applyOperatorReviewAction(
      applyOperatorReviewAction(
        stateFromPipelineResult({}),
        "update_financing_stage",
        {
          adminId: "admin-1",
          occurredAt: "2026-01-02T12:00:00Z",
          notes: "Prequal approved.",
          details: { financing_stage: "financing_approved" },
        },
      ),
      "update_proposal_stage",
      {
        adminId: "admin-1",
        occurredAt: "2026-01-02T12:05:00Z",
        notes: "Proposal sent.",
        details: { proposal_stage: "proposal_sent" },
      },
    );
    const stageSummary = deriveLeadOpsSummary({
      operational: stage,
      qualificationCompleteness: "complete",
      attachmentCompleteness: "complete",
      releaseReadiness: {
        operator_reviewed: true,
        qualification_checked: true,
        validation_passed: true,
        financing_readiness_reviewed: true,
        homeowner_intent_verified: true,
        approved_for_marketplace: true,
        ready: true,
        missing: [],
      },
      receivedAt: "2026-01-02T08:00:00Z",
    });
    expect(stage).toMatchObject({
      financing_stage: "financing_approved",
      proposal_stage: "proposal_sent",
      financing_ready: true,
    });
    expect(stageSummary).toMatchObject({
      financing_stage: "financing_approved",
      proposal_stage: "proposal_sent",
      proposal_readiness: "ready",
      contractor_readiness: "ready_for_contractor",
      lead_health: "healthy",
    });
  });

  it("centralizes operational queue definitions and routes reopened document work", () => {
    expect(LEAD_OPS_QUEUE_DEFINITIONS.map((queue) => queue.key)).toEqual(
      expect.arrayContaining([
        "waiting_on_homeowner",
        "waiting_on_documents",
        "proposal_follow_up",
        "dormant_leads",
      ]),
    );
    const resolved = resolveOperationalQueue({
      operational: { review_status: "documents_reopened" },
      reviewStatus: "documents_reopened",
      attachmentCompleteness: "metadata_only",
      qualificationCompleteness: "complete",
      nowMs: new Date("2026-01-02T12:00:00Z").getTime(),
    });
    expect(resolved.current_queue).toBe("waiting_on_documents");
    expect(resolved.next_action).toContain("document");
  });

  it("reopens qualification, financing, callbacks, and documents without deleting workflow memory", () => {
    const base = applyOperatorReviewAction(
      applyOperatorReviewAction(stateFromPipelineResult({}), "mark_contacted", {
        adminId: "admin-1",
        occurredAt: "2026-01-01T09:00:00Z",
      }),
      "mark_qualified",
      { adminId: "admin-1", occurredAt: "2026-01-01T09:05:00Z" },
    );
    const qualification = applyOperatorReviewAction(
      base,
      "reopen_qualification",
      {
        adminId: "admin-2",
        occurredAt: "2026-01-01T10:00:00Z",
        notes: "Income documentation changed",
        details: { workflow_reason: "Income documentation changed" },
      },
    );
    expect(qualification).toMatchObject({
      review_status: "qualification_reopened",
      lifecycle_status: "qualification_in_progress",
      approved_for_marketplace: false,
    });
    expect(
      qualification.action_history?.map((entry) => entry.action),
    ).toContain("mark_qualified");
    expect(qualification.reopen_history?.at(-1)).toMatchObject({
      type: "qualification_reopened",
      summary: "Income documentation changed",
    });

    const financing = applyOperatorReviewAction(
      qualification,
      "reopen_financing",
      {
        adminId: "admin-2",
        occurredAt: "2026-01-01T10:10:00Z",
        details: { workflow_reason: "Credit band needs review" },
      },
    );
    expect(financing).toMatchObject({
      review_status: "financing_reopened",
      financing_ready: false,
    });
    expect(financing.financing_reopen_history).toHaveLength(1);

    const callback = applyOperatorReviewAction(financing, "reopen_callback", {
      adminId: "admin-3",
      occurredAt: "2026-01-01T10:15:00Z",
      details: {
        callback_at: "2026-01-02T14:00:00Z",
        callback_reason: "Homeowner asked for spouse callback",
      },
    });
    expect(callback).toMatchObject({
      review_status: "needs_callback",
      callback_at: "2026-01-02T14:00:00Z",
      needs_follow_up: true,
    });
    expect(callback.callback_history?.at(-1)).toMatchObject({
      type: "callback_reopened",
    });

    const documents = applyOperatorReviewAction(callback, "reopen_documents", {
      adminId: "admin-3",
      occurredAt: "2026-01-01T10:20:00Z",
      details: { workflow_reason: "Updated utility bill needed" },
    });
    expect(documents).toMatchObject({
      review_status: "documents_reopened",
      missing_items_resolved: false,
    });
    expect(documents.workflow_timeline?.length).toBeGreaterThanOrEqual(4);
  });

  it("uses callback_at for overdue routing and exposes callback countdown memory", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-03T12:00:00Z"));
    const summary = deriveLeadOpsSummary({
      operational: {
        needs_follow_up: true,
        callback_at: "2026-01-03T09:00:00Z",
        follow_up_at: "2026-01-05T09:00:00Z",
        callback_reason: "Callback takes precedence",
      },
      qualificationCompleteness: "complete",
      attachmentCompleteness: "complete",
    });
    expect(summary.current_queue).toBe("overdue_callbacks");
    expect(summary.next_follow_up_at).toBe("2026-01-03T09:00:00Z");
    expect(summary.callback_bucket).toBe("overdue");
    expect(summary.callback_countdown).toContain("overdue");
  });

  it("marks dormant leads and reactivates terminal projections without duplicate lead records", () => {
    const archived = applyOperatorReviewAction(
      stateFromPipelineResult({}),
      "archive_lead",
      {
        adminId: "admin-1",
        occurredAt: "2026-01-01T09:00:00Z",
        details: { archive_reason: "Dormant campaign cleanup" },
      },
    );
    const reactivated = applyOperatorReviewAction(archived, "reactivate_lead", {
      adminId: "admin-2",
      occurredAt: "2026-01-02T09:00:00Z",
      details: { workflow_reason: "Homeowner replied" },
    });
    expect(reactivated).toMatchObject({
      archived: false,
      rejected: false,
      review_status: "reactivated",
    });
    expect(reactivated.reactivation_history).toHaveLength(1);

    const dormant = applyOperatorReviewAction(reactivated, "mark_dormant", {
      adminId: "admin-2",
      occurredAt: "2026-01-02T10:00:00Z",
      details: {
        dormant_reason: "Waiting until spring",
        dormant_until: "2026-03-01T09:00:00Z",
      },
    });
    const summary = deriveLeadOpsSummary({
      operational: dormant,
      qualificationCompleteness: "complete",
      attachmentCompleteness: "complete",
    });
    expect(summary.current_queue).toBe("dormant_leads");
    expect(summary.dormant_reason).toBe("Waiting until spring");
    expect(dormant.dormant_history).toHaveLength(1);
  });
});
