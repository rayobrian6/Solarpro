// ═══════════════════════════════════════════════════════════════════════════
// complianceState — THE ONE shared tri-state compliance projection (§2, closeout
// 2026-07-23). Before this, every sheet decided PASS/FAIL/PENDING inline: SCHED
// printed an UNCONDITIONAL "✓" on every AC branch row, E-1 had no verdict column,
// PV-4B duplicated fill/VD ternaries per cell, and a blank/pending required value
// still rendered a green PASS. There was no single result object, so a hole
// (null fill, unmeasured tap length, estimate-only route) could silently PASS.
//
// This module is a PURE, DETERMINISTIC evaluator with a FAIL-CLOSED contract:
//   • PASS                        — every required value is present + finite AND
//                                    every hard check passes.
//   • FAIL                        — a hard check DEFINITIVELY fails (a present
//                                    value violates the rule, e.g. fill > 40%).
//   • PENDING-REVIEW-REQUIRED     — a required value is null/undefined/NaN/blank/
//                                    non-finite, OR an authority is pending
//                                    (route length not field-verified, fill not
//                                    computed, equipment/tap not resolved), OR a
//                                    hard check is unknown (pass === null).
//
// A FAIL always dominates a PENDING (a real violation is worse than a hole). No
// required value can ever be blank AND PASS (gate 3). Consumed by E-1's sectioned
// physical schedule, PV-4A's branch rating summary, the SCHED branch Status
// column, and exported for RS-1 / the evidence harness (round-2 wiring points).
// ═══════════════════════════════════════════════════════════════════════════

export type TriState = 'PASS' | 'FAIL' | 'PENDING-REVIEW-REQUIRED';

export interface ComplianceResult {
  state: TriState;
  /** short reason — the governing failure/pending condition (empty on a clean PASS). */
  reason: string;
  /** every required field that was blank/non-finite (drives PENDING). */
  missing: string[];
  /** every explicit pending-authority reason (drives PENDING). */
  pending: string[];
  /** every hard check that DEFINITIVELY failed (drives FAIL). */
  failures: string[];
}

/** A definitive pass/fail check. `pass === null` means the check could not be
 *  evaluated (missing input) → PENDING, never a silent PASS. */
export interface ComplianceCheck {
  label: string;
  pass: boolean | null;
}

/** A required value that MUST be present + finite/non-blank for a verdict to be
 *  reachable. A missing one forces PENDING-REVIEW-REQUIRED (never PASS). */
export interface RequiredValue {
  label: string;
  value: unknown;
  /** when true the value must additionally be a finite number (NaN/∞ → missing). */
  numeric?: boolean;
}

export interface ComplianceInput {
  requiredValues?: RequiredValue[];
  checks?: ComplianceCheck[];
  /** authority-pending reasons (route length not verified, fill not computed,
   *  equipment/tap unresolved). Any entry → PENDING-REVIEW-REQUIRED. */
  pending?: string[];
}

/** A value counts as "present" when it is not null/undefined, not a blank string,
 *  and (when numeric) a finite number. Fail-closed on every degenerate input. */
function isPresent(v: unknown, numeric?: boolean): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '' || /^(—|-|n\/?a|pending|tbd)$/i.test(t)) return false;
    if (numeric) { const n = Number(t); return Number.isFinite(n); }
    return true;
  }
  if (numeric) return false;
  return true;
}

/**
 * Evaluate ONE tri-state compliance result. Pure — identical input → identical
 * output. FAIL-CLOSED: any blank/pending required value or unknown check yields
 * PENDING-REVIEW-REQUIRED; a definitive violation yields FAIL; only an all-present,
 * all-passing set yields PASS.
 */
export function evaluateCompliance(input: ComplianceInput): ComplianceResult {
  const missing: string[] = [];
  for (const rv of input.requiredValues ?? []) {
    if (!isPresent(rv.value, rv.numeric)) missing.push(rv.label);
  }
  const failures: string[] = [];
  const unknownChecks: string[] = [];
  for (const c of input.checks ?? []) {
    if (c.pass === false) failures.push(c.label);
    else if (c.pass === null) unknownChecks.push(c.label);
  }
  const pending = [...(input.pending ?? []), ...missing.map(m => `${m} unresolved`), ...unknownChecks.map(u => `${u} not evaluable`)];

  // FAIL dominates: a present value that violates a rule is worse than a hole.
  if (failures.length > 0) {
    return { state: 'FAIL', reason: failures[0], missing, pending, failures };
  }
  if (pending.length > 0) {
    return { state: 'PENDING-REVIEW-REQUIRED', reason: pending[0], missing, pending, failures };
  }
  return { state: 'PASS', reason: '', missing, pending, failures };
}

// ── Rendering helpers (single source for every sheet's verdict glyph/label) ──

export const COMPLIANCE_LABEL: Record<TriState, string> = {
  'PASS': '✓ PASS',
  'FAIL': '✗ FAIL',
  'PENDING-REVIEW-REQUIRED': 'PENDING — REVIEW REQ’D',
};

export const COMPLIANCE_COLOR: Record<TriState, string> = {
  'PASS': '#127a3e',
  'FAIL': '#cc0000',
  'PENDING-REVIEW-REQUIRED': '#cc6600',
};

/** Short label form ('✓ PASS' | '✗ FAIL' | 'PENDING — REVIEW REQ’D'). */
export function complianceLabel(r: ComplianceResult | TriState): string {
  return COMPLIANCE_LABEL[typeof r === 'string' ? r : r.state];
}

/** Inline HTML badge — the SAME glyph/color every sheet's Status cell renders. */
export function complianceBadge(r: ComplianceResult | TriState, opts?: { title?: string }): string {
  const state = typeof r === 'string' ? r : r.state;
  const title = opts?.title ?? (typeof r === 'string' ? '' : r.reason);
  const t = title ? ` title="${String(title).replace(/"/g, '&quot;')}"` : '';
  return `<span class="mono fw7" style="color:${COMPLIANCE_COLOR[state]}"${t}>${COMPLIANCE_LABEL[state]}</span>`;
}
