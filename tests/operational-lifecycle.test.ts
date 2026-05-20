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
});
