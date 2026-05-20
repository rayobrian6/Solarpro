import { describe, expect, it } from "vitest";
import {
  applyOperatorReviewAction,
  deriveReleaseReadiness,
  operationalIntelligence,
  stateFromPipelineResult,
} from "@/lib/intake/operationalLifecycle";
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
          follow_up_at: "2026-01-02T15:00",
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
      next_follow_up_at: "2026-01-02T15:00",
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
});
