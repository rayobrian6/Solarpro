// ═══════════════════════════════════════════════════════════════════════════
// AAC WS-7 (2026-07-27) — CONDUIT-FILL AUTHORITY (pure).
//
// WS-7 is explicit: "an unexecuted calculation is never field verification".
// Here it was WORSE than unexecuted — the NEC Chapter 9, Table 1 fill IS
// computed by the canonical engine (computed-system.ts: conductor areas, conduit
// areas, per-run `conduitFillPct`, `conduitFillPass`, the Table 1 violation
// emitter) and its result was DISCARDED by four field-name mismatches in one
// projection (audit §2.14). CONDUIT-FILL-PENDING then fired as a FIELD
// VERIFICATION requirement against a calculation that had already run.
//
// This module is the COMPLETENESS + RESULT evaluator that decides the
// requirement. It is the only place that decides it: the build emits the blocker
// iff `cleared === false`, and the derived resolver stage records the same
// verdict as evidence with the audit reference deriveRequirementStatus demands.
//
// It NEVER fabricates a fill. A missing input produces a PRECISE
// REQUIRES_INPUT naming exactly which input is absent.
// ═══════════════════════════════════════════════════════════════════════════

import type { Provenance } from './types';

/** THE NEC fill limit for >2 conductors in a raceway (Chapter 9, Table 1). */
export const NEC_CH9_T1_LIMIT_PCT = 40;
export const NEC_CH9_T1_BASIS = 'NEC Chapter 9, Table 1 (over 2 conductors — 40 % of the raceway interior)';

export interface ConduitFillInputs {
  /** the raceway the fill is computed for (the canonical feeder segment). */
  segmentId: string | null;
  racewayType: string | null;
  racewaySize: string | null;
  /** current-carrying conductors in the raceway. */
  conductorCount: number | null;
  conductorGauge: string | null;
  insulation: string | null;
  egcGauge: string | null;
  /** the adopted NEC edition the fill table is taken from (code authority). */
  codeEdition: string | null;
  /** the COMPUTED Chapter 9 Table 1 result (computeSystem). */
  computedFillPct: number | null;
  /** the computed ≤40 % verdict. */
  computedPass: boolean | null;
}

export interface ConduitFillAuthorityRecord {
  segmentId: string | null;
  racewayType: string | null;
  racewaySize: string | null;
  conductorSet: string | null;
  insulation: string | null;
  codeEdition: string | null;
  fillPct: number | null;
  limitPct: number;
  pass: boolean | null;
  necBasis: string;
  /** 'computed' ⇔ every input was present and the engine produced a number. */
  state: 'computed' | 'incomplete';
  derivation: string;
  provenance: Provenance;
}

export interface ConduitFillEvaluation {
  cleared: boolean;
  missing: string[];
  reasons: string[];
  record: ConduitFillAuthorityRecord;
}

/**
 * Decide the conduit-fill requirement from the canonical engine's own result.
 *
 * CLEARED ⇔ the raceway identity (type + trade size), the conductor set
 * (count + gauge + insulation), the adopted code edition and the COMPUTED
 * Chapter 9 Table 1 percentage are all present. Anything absent is named
 * exactly — and a missing NUMBER is never treated as a field measurement.
 */
export function evaluateConduitFillAuthority(i: ConduitFillInputs): ConduitFillEvaluation {
  const missing: string[] = [];
  const reasons: string[] = [];
  const need = (ok: boolean, field: string, why: string): void => {
    if (!ok) { missing.push(field); reasons.push(why); }
  };

  const type = (i.racewayType ?? '').trim();
  const size = (i.racewaySize ?? '').trim();
  const gauge = (i.conductorGauge ?? '').trim();
  const insul = (i.insulation ?? '').trim();
  const edition = (i.codeEdition ?? '').trim();
  const fill = typeof i.computedFillPct === 'number' && Number.isFinite(i.computedFillPct) ? i.computedFillPct : null;

  need(!!type, 'electrical.feeder.raceway.type', 'no raceway TYPE resolved for the feeder segment — a fill percentage has no denominator without one');
  need(!!size, 'electrical.feeder.raceway.tradeSize', 'no raceway TRADE SIZE resolved for the feeder segment');
  need(i.conductorCount != null && i.conductorCount > 0, 'electrical.feeder.conductorCount', 'no current-carrying conductor count for the feeder raceway');
  need(!!gauge, 'electrical.feeder.conductorGauge', 'no conductor gauge for the feeder raceway');
  need(!!insul, 'electrical.feeder.insulation', 'no conductor insulation type — NEC Chapter 9 Table 5 areas are insulation-specific');
  need(!!edition, 'codeAuthority.editions.nec', 'no ADOPTED NEC edition established — the fill table edition is not fixed');
  need(fill != null, 'electrical.conduitFill.fillPercent', 'the NEC Chapter 9 Table 1 fill was not produced by the canonical electrical engine for this raceway');

  const conductorSet = i.conductorCount != null && gauge
    ? `${i.conductorCount}×${gauge}${insul ? ` ${insul}` : ''}${i.egcGauge ? ` + 1×${i.egcGauge} EGC` : ''}`
    : null;

  const cleared = missing.length === 0;
  const record: ConduitFillAuthorityRecord = {
    segmentId: i.segmentId,
    racewayType: type || null,
    racewaySize: size || null,
    conductorSet,
    insulation: insul || null,
    codeEdition: edition || null,
    fillPct: fill,
    limitPct: NEC_CH9_T1_LIMIT_PCT,
    pass: fill != null ? (typeof i.computedPass === 'boolean' ? i.computedPass : fill <= NEC_CH9_T1_LIMIT_PCT) : null,
    necBasis: NEC_CH9_T1_BASIS,
    state: cleared ? 'computed' : 'incomplete',
    derivation: cleared
      ? `${conductorSet} in ${size} ${type} ⇒ Σ conductor area ÷ raceway interior = ${fill!.toFixed(1)} % `
        + `(limit ${NEC_CH9_T1_LIMIT_PCT} %, ${edition} NEC Chapter 9 Tables 1/4/5) — computed by the canonical electrical engine`
      : `fill NOT established: ${reasons.join('; ')}`,
    provenance: {
      source: 'computeSystem (NEC Ch.9 Tables 1/4/5) via mapComputedSystemToCompliance',
      ref: i.segmentId,
    },
  };
  return { cleared, missing, reasons, record };
}
