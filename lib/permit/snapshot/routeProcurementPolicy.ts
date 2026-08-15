// lib/permit/snapshot/routeProcurementPolicy.ts
// WS-5 §13 — SEPARATING THE LENGTH A CONDUCTOR IS SIZED ON FROM THE LENGTH IT IS
// BOUGHT AT, AND STATING EVERY FOOT OF THE DIFFERENCE.
//
// A conductor is SIZED on the run it actually covers and PURCHASED with slack.
// Those are two numbers. When they are one number the design is wrong in one of
// two directions: either the voltage drop is computed against a padded length
// (a pessimistic result presented as the real one) or the BOM orders the bare
// run length (a truck that arrives short). `calculationLengthFt` and
// `procurementLengthFt` are the two names, and this module is the documented
// bridge between them.
//
// EVERY ALLOWANCE IS ITEMISED WITH A REASON. WS-5 §13 forbids "one undocumented
// percentage globally" and the reason is visible in this repo's own history:
// lib/bom/deriveRunLengths.ts multiplies every heuristic run by a single
// `SLACK_FACTOR = 1.15` with no statement of what the 15% is FOR — terminations?
// slack? waste? all three? — and that number then flows into `onewayLengthFt`,
// which the snapshot uses as the CALCULATION length. See LEGACY_GLOBAL_SLACK
// below: this module names that defect rather than repeating it, and does not
// silently restate any existing number.
//
// SCOPE, STATED PLAINLY. This policy is applied where WS-5 introduces a NEW
// number: a field-measured route length, which is a bare physical distance with
// no allowance baked in. It is NOT retro-applied to the CAD estimate path,
// because those engine lengths already carry the legacy 1.15 and re-applying an
// allowance on top would double-count. The estimate path therefore reports its
// procurement length AS the engine's number, labelled with the legacy basis, so
// the defect is visible in the data instead of hidden by a second correction.

export interface ProcurementAllowance {
  /** stable id, so a sheet or a test can name one allowance. */
  id: 'termination' | 'service-loop' | 'route-slack' | 'waste-cut';
  label: string;
  /** either a fixed number of feet or a multiplier — never both. */
  kind: 'fixed-ft' | 'multiplier';
  value: number;
  /** WHY this allowance exists. Printed with the derivation. */
  basis: string;
}

/**
 * The itemised allowances applied to a FIELD-MEASURED route length.
 *
 * These are ordinary electrical-installation practice, and each is stated so a
 * reviewer can disagree with a specific one rather than with an opaque 15%:
 *   • TERMINATION — conductor consumed inside each enclosure making up to the
 *     terminals. Two ends, ~1 ft each; a fixed quantity, not a percentage,
 *     because it does not grow with the run.
 *   • SERVICE LOOP — a single documented loop at the equipment end so a future
 *     re-termination does not require re-pulling the run.
 *   • ROUTE SLACK — the difference between the measured centre-line and the
 *     path the conductor actually takes around supports, offsets and bends.
 *     Proportional, because a longer route has more of them.
 *   • WASTE/CUT — reel cut loss. Proportional and small.
 *
 * The two multipliers compose (1.05 × 1.03 ≈ 1.0815), so the total proportional
 * allowance on a measured run is about 8.15% plus 3 ft fixed — deliberately
 * LESS than the legacy blanket 15%, because a MEASURED route needs no allowance
 * for being an estimate.
 */
export const FIELD_MEASURED_ALLOWANCES: readonly ProcurementAllowance[] = [
  {
    id: 'termination', label: 'Termination allowance', kind: 'fixed-ft', value: 2,
    basis: '~1 ft of conductor consumed inside each of the two enclosures making up to the terminals. Fixed, '
      + 'not proportional: it does not grow with the length of the run.',
  },
  {
    id: 'service-loop', label: 'Service loop', kind: 'fixed-ft', value: 1,
    basis: 'One documented service loop at the equipment end so a future re-termination does not require re-pulling '
      + 'the run. One loop, not one per end.',
  },
  {
    id: 'route-slack', label: 'Route slack', kind: 'multiplier', value: 1.05,
    basis: 'The measured centre-line distance is shorter than the path the conductor takes around supports, offsets '
      + 'and bends. Proportional, because a longer route has proportionally more of them.',
  },
  {
    id: 'waste-cut', label: 'Waste / cut allowance', kind: 'multiplier', value: 1.03,
    basis: 'Reel cut loss. Proportional and small; it is a yield figure, not a design margin.',
  },
];

/**
 * THE DEFECT THIS MODULE REFUSES TO REPEAT — named so it is tracked rather than
 * inherited. lib/bom/deriveRunLengths.ts:44 applies `SLACK_FACTOR = 1.15` to
 * every heuristic run length and stores the RESULT in `onewayLengthFt`, which
 * lib/permit/snapshot/build.ts then uses as `calculationLengthFt`. So on the CAD
 * estimate path the voltage drop is computed against a procurement-padded
 * number, and the 15% is not decomposed into what it is for.
 *
 * WS-5 does not change those numbers: separating them would move every existing
 * voltage-drop percentage and every BOM footage on every project, which is a
 * different workstream with its own regression surface. What WS-5 does is (a)
 * stop the FIELD path inheriting the conflation, and (b) label the legacy path
 * honestly wherever it is projected, so the next reader sees a documented open
 * defect instead of a number that looks derived.
 */
export const LEGACY_GLOBAL_SLACK = {
  factor: 1.15,
  appliedIn: 'lib/bom/deriveRunLengths.ts (SLACK_FACTOR)',
  flowsInto: 'RouteSegmentRecord.oneWayFt → calculationLengthFt on every CAD-estimate segment',
  defect:
    'A single undocumented 15% is applied to every heuristic run length and is then consumed as the CALCULATION '
    + 'length, so estimate-path voltage drop is computed against a procurement-padded number and the 15% is never '
    + 'decomposed into termination / service loop / route slack / waste. WS-5 does not restate these numbers — '
    + 'unwinding them moves every existing VD result and BOM footage — but it does not extend the conflation to the '
    + 'field-measured path, and it labels the legacy basis wherever it is projected.',
} as const;

export interface ProcurementDerivation {
  calculationLengthFt: number;
  procurementLengthFt: number;
  /** the composed multiplier actually applied (1 when none). */
  wasteFactor: number;
  /** the id of the allowance policy used. */
  policy: 'field-measured@v1' | 'legacy-global-slack@1.15';
  /** the itemised allowances, in application order (empty for the legacy path). */
  allowances: readonly ProcurementAllowance[];
  /** one sentence a sheet can print. */
  derivation: string;
}

/**
 * Derive the procurement length for a FIELD-MEASURED route. Pure.
 * Multipliers compose first, then the fixed feet are added, then the result is
 * rounded UP: you cannot buy a fraction of a foot of conductor, and rounding
 * down is how a truck arrives short.
 */
export function deriveFieldMeasuredProcurement(calculationLengthFt: number): ProcurementDerivation {
  const multipliers = FIELD_MEASURED_ALLOWANCES.filter(a => a.kind === 'multiplier');
  const fixed = FIELD_MEASURED_ALLOWANCES.filter(a => a.kind === 'fixed-ft');
  const factor = multipliers.reduce((f, a) => f * a.value, 1);
  const fixedFt = fixed.reduce((s, a) => s + a.value, 0);
  const procurement = Math.ceil(calculationLengthFt * factor + fixedFt);
  return {
    calculationLengthFt,
    procurementLengthFt: procurement,
    wasteFactor: Math.round(factor * 10000) / 10000,
    policy: 'field-measured@v1',
    allowances: FIELD_MEASURED_ALLOWANCES,
    derivation:
      `${calculationLengthFt} ft measured × ${multipliers.map(a => `${a.value} (${a.label.toLowerCase()})`).join(' × ')} `
      + `+ ${fixedFt} ft (${fixed.map(a => a.label.toLowerCase()).join(' + ')}) `
      + `= ${procurement} ft ordered. Every allowance is itemised in routeProcurementPolicy.FIELD_MEASURED_ALLOWANCES.`,
  };
}

/**
 * The CAD-estimate path's honest report of itself. The engine length already
 * carries the legacy blanket 15%, so no further allowance is applied — the
 * procurement quantity IS that number, and the derivation says where the padding
 * came from rather than implying it was itemised.
 */
export function describeLegacyEstimateProcurement(engineLengthFt: number): ProcurementDerivation {
  return {
    calculationLengthFt: engineLengthFt,
    procurementLengthFt: Math.ceil(engineLengthFt),
    wasteFactor: 1,
    policy: 'legacy-global-slack@1.15',
    allowances: [],
    derivation:
      `${engineLengthFt} ft as derived by the engine, which has ALREADY applied a blanket `
      + `${LEGACY_GLOBAL_SLACK.factor}× slack (${LEGACY_GLOBAL_SLACK.appliedIn}). No further allowance is applied here — `
      + 'doing so would double-count. The blanket factor is not decomposed into termination / service loop / route '
      + 'slack / waste, and it is also consumed as the CALCULATION length: a documented open defect, not a derivation.',
  };
}
