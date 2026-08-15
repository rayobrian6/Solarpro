// lib/fieldMeasurement/verificationPolicy.ts
// WS-5 — THE ONE PLACE THAT DECIDES WHETHER A MEASUREMENT MAY BE VERIFIED.
//
// THE DEFECT THIS PREVENTS: an API route that receives POST …/verify and sets
// `verificationState = 'VERIFIED'`. That route would be correct about the HTTP
// and wrong about everything else — it would not have asked whether the route is
// the project's to measure, whether there is evidence, whether the verifier is
// the person who recorded the number, or whether this tenant permits that. Each
// of those is a real refusal, and each has to be stated as a REASON so the
// operator learns what is missing instead of seeing a bare 403.
//
// THE DECISION IS A RECORD, NOT A BOOLEAN. `verificationMode` is part of the
// verdict and is persisted with the transition. That is the difference between
// "we allowed this" and "we allowed this BECAUSE the tenant holds an explicit
// self-verification policy" — and only the second can be audited later.
//
// SELF-VERIFICATION IS OFF BY DEFAULT AND CANNOT BE INFERRED. The default rule
// is `measuredByUserId !== verifiedByUserId`. A tenant may lift it, but only by
// holding an explicit policy, and when it is lifted the mode says so. There is
// no code path that decides after the fact that a same-user verification "must
// have been" authorized.

import type { MeasurementActor } from './capabilities';
import type { EvidenceResolution } from './evidence';
import {
  isMeasurementMethod, MAX_MEASURED_LENGTH_FT, MIN_MEASURED_LENGTH_FT,
  type FieldRouteMeasurement, type RouteApplicabilityFact, type VerificationMode,
} from './types';
import { routeAcceptsProjectMeasurement } from './types';

export interface FieldMeasurementVerificationDecision {
  allowed: boolean;
  /** every refusal, in evaluation order. Empty when allowed. */
  reasons: string[];
  verificationMode: VerificationMode | null;
  evidenceSufficient: boolean;
  routeApplicable: boolean;
  /** the checks that PASSED — so an audit record shows what was actually
   *  evaluated, not merely that nothing objected. */
  satisfied: string[];
  /** true when verification is proceeding on a documented authorised exception
   *  rather than on an attachment. Always visible; never a silent path. */
  usedEvidenceException: boolean;
}

export interface VerificationPolicyInput {
  measurement: FieldRouteMeasurement;
  actor: MeasurementActor;
  route: RouteApplicabilityFact;
  evidence: EvidenceResolution;
  /** the reviewer's notes for this verification (may be required — see §4). */
  verificationNotes: string | null;
  /** a documented reason to verify with no attachment. Null in the normal case. */
  authorizedExceptionReason: string | null;
  /** the verification instant (server-supplied). */
  nowIso: string;
}

/** Minimum length of a written justification that is actually a justification.
 *  "ok", "yes" and "-" are not documented exceptions. */
const MIN_WRITTEN_REASON_CHARS = 12;

/**
 * Evaluate the whole policy. PURE — every input is already resolved, so the same
 * inputs always produce the same verdict and the verdict can be recorded as
 * evidence.
 */
export function evaluateVerificationPolicy(
  input: VerificationPolicyInput,
): FieldMeasurementVerificationDecision {
  const { measurement: m, actor, route, evidence } = input;
  const reasons: string[] = [];
  const satisfied: string[] = [];

  // ── 1. THE ROUTE MUST BE THE PROJECT'S TO MEASURE ────────────────────────
  const applicable = routeAcceptsProjectMeasurement(route);
  const routeApplicable = applicable.ok === true;
  if (applicable.ok !== true) reasons.push(applicable.reason);
  else satisfied.push(`route '${route.segmentId}' is PROJECT_OWNED and route authority is REQUIRED`);

  // ── 2. THE RECORD MUST BE IN A STATE THAT CAN BE VERIFIED ────────────────
  if (m.verificationState !== 'REPORTED_UNVERIFIED') {
    reasons.push(
      m.verificationState === 'VERIFIED'
        ? 'this measurement is already VERIFIED — re-verifying would overwrite a verification in place; supersede it instead'
        : `a ${m.verificationState} measurement cannot be verified — its history is retained, but it carries no authority`,
    );
  } else {
    satisfied.push('the record is REPORTED_UNVERIFIED and is eligible for a verification transition');
  }

  // ── 3. THE MEASUREMENT ITSELF MUST BE COMPLETE ───────────────────────────
  if (!(Number.isFinite(m.measuredLengthFt) && m.measuredLengthFt >= MIN_MEASURED_LENGTH_FT && m.measuredLengthFt <= MAX_MEASURED_LENGTH_FT)) {
    reasons.push(`measured length ${m.measuredLengthFt} ft is outside the defensible range [${MIN_MEASURED_LENGTH_FT}, ${MAX_MEASURED_LENGTH_FT}] ft`);
  } else {
    satisfied.push(`measured length ${m.measuredLengthFt} ft is positive and within engineering bounds`);
  }
  if (!isMeasurementMethod(m.measurementMethod)) {
    reasons.push(`measurement method '${String(m.measurementMethod)}' is not a recognised method`);
  } else {
    satisfied.push(`measurement method ${m.measurementMethod} is recorded`);
  }
  if (!m.measuredByUserId) {
    reasons.push('no measured-by identity is recorded — an anonymous measurement cannot be verified');
  } else {
    satisfied.push('a measured-by identity is recorded');
  }
  if (!m.measuredAt || Number.isNaN(Date.parse(m.measuredAt))) {
    reasons.push('no valid measurement timestamp is recorded');
  } else {
    satisfied.push(`measurement timestamp ${m.measuredAt} is recorded`);
  }

  // ── 4. EVIDENCE, OR A DOCUMENTED AUTHORISED EXCEPTION ────────────────────
  // Evidence is re-resolved at THIS moment, not trusted from record time: an
  // attachment that has since been deleted or moved out of the project stops
  // satisfying the policy.
  const exception = (input.authorizedExceptionReason ?? '').trim();
  const usedEvidenceException = !evidence.sufficient && exception.length > 0;
  const evidenceSufficient = evidence.sufficient;

  if (evidence.storeError) {
    reasons.push(`the evidence store could not be read (${evidence.storeError}) — an unreadable attachment store is not evidence`);
  } else if (evidence.sufficient) {
    satisfied.push(`${evidence.validIds.length} evidence attachment(s) resolved in this project`);
    if (evidence.invalid.length > 0) {
      // Not a refusal — the valid ones stand — but it must be visible.
      satisfied.push(`${evidence.invalid.length} referenced attachment(s) did not resolve and were not counted as evidence`);
    }
  } else if (exception.length >= MIN_WRITTEN_REASON_CHARS) {
    satisfied.push('no attachment; verification proceeds on a DOCUMENTED authorised exception');
  } else if (exception.length > 0) {
    reasons.push(
      `the authorised exception reason is too short to be a documented reason (${exception.length} chars, minimum ${MIN_WRITTEN_REASON_CHARS})`,
    );
  } else {
    reasons.push(
      'no evidence attachment resolved for this measurement and no documented authorised exception was supplied'
      + (evidence.invalid.length ? ` (${evidence.invalid.length} referenced attachment(s) failed: ${evidence.invalid.map(i => `${i.attachmentId} — ${i.reason}`).join('; ')})` : ''),
    );
  }

  // ── 5. THE VERIFIER, AND THE MODE THAT EXPLAINS WHY THEY MAY ─────────────
  // The capability + project-access gates are asserted by requireCapability
  // before this policy runs; what is decided HERE is the separation-of-duties
  // question, which capability alone does not answer.
  let verificationMode: VerificationMode | null = null;
  if (actor.userId && actor.userId !== m.measuredByUserId) {
    verificationMode = 'INDEPENDENT_REVIEW';
    satisfied.push('the verifier is not the person who recorded the measurement (independent review)');
  } else if (actor.allowAuthorizedSelfVerification) {
    verificationMode = 'AUTHORIZED_SELF_VERIFICATION';
    satisfied.push('the verifier recorded this measurement, and this tenant holds an explicit authorized-self-verification policy');
  } else {
    reasons.push(
      'the verifier is the person who recorded this measurement, and this tenant does not hold an explicit '
      + 'authorized-self-verification policy — recording is not verification',
    );
  }

  // ── 6. WRITTEN NOTES WHERE THE POLICY REQUIRES THEM ──────────────────────
  // Required for the two paths where the verification rests on judgement rather
  // than on a second pair of eyes plus an artefact: a self-verification, and a
  // verification with no attachment. In both cases the notes ARE the record of
  // what was checked.
  const notes = (input.verificationNotes ?? '').trim();
  const notesRequired = verificationMode === 'AUTHORIZED_SELF_VERIFICATION' || usedEvidenceException;
  if (notesRequired && notes.length < MIN_WRITTEN_REASON_CHARS) {
    reasons.push(
      verificationMode === 'AUTHORIZED_SELF_VERIFICATION'
        ? `a self-verification requires written verification notes (minimum ${MIN_WRITTEN_REASON_CHARS} characters) stating what was checked`
        : `a verification on an authorised exception requires written verification notes (minimum ${MIN_WRITTEN_REASON_CHARS} characters)`,
    );
  } else if (notes.length > 0) {
    satisfied.push('written verification notes are recorded');
  }

  // ── 7. THE VERIFICATION INSTANT ──────────────────────────────────────────
  if (!input.nowIso || Number.isNaN(Date.parse(input.nowIso))) {
    reasons.push('no valid verification timestamp was supplied by the server');
  } else {
    satisfied.push(`verification timestamp ${input.nowIso} is server-supplied`);
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    // A mode is only carried on an ALLOWED decision. Returning a mode beside a
    // refusal is how "we allowed this because…" gets reconstructed later from a
    // decision that never happened.
    verificationMode: reasons.length === 0 ? verificationMode : null,
    evidenceSufficient,
    routeApplicable,
    satisfied,
    usedEvidenceException,
  };
}
