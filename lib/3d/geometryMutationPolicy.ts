/**
 * lib/3d/geometryMutationPolicy.ts
 *
 * WHO IS ALLOWED TO MOVE THE ROOF THE USER TRACED.
 *
 * `lib/3d/abutment.ts` has long carried the rule in this form:
 *
 *   "Horizontal position is NEVER touched — the plan-view footprint the user
 *    traced is theirs, and only the height it sits at is inferred."
 *
 * Read literally that forbids a Move tool outright, and a proposal to build one
 * turned on re-reading it. It was put to the product owner rather than
 * reinterpreted in passing, and the ruling is recorded here because a rule that
 * lives only in one module's prose gets re-derived differently by the next
 * reader.
 *
 * 🚨 THE RULING (Ray, 2026-09-21)
 *
 *   An explicit user gesture MAY move a traced footprint horizontally.
 *
 *   The existing rule is to be read as: INFERENCE AND AUTOMATIC RECONCILIATION
 *   MUST NEVER SILENTLY MOVE THE USER'S TRACED PLAN GEOMETRY. It does not
 *   prohibit the user from deliberately selecting a building section and moving
 *   it.
 *
 *   AUTOMATIC / INFERRED MUTATION  ≠  EXPLICIT USER-AUTHORED MUTATION.
 *
 * That distinction is the whole of this module. It is not a feature flag, a
 * permission check or a capability system, and it must not grow into one. It
 * exists so that every geometry writer has to STATE which kind it is, in a place
 * a reader and a test can both see.
 *
 * WHAT THIS DOES NOT AUTHORISE. The ruling permits the gesture; it does not say
 * the gesture is ready. Horizontal movement stays unbuilt until the section /
 * volume authority, undo, validation and the persistence path can carry it
 * safely — see docs/SOLARPRO-3D-INTERACTION-MODEL.md §10. Encoding the policy
 * ahead of the feature is deliberate: the rule is what the feature must satisfy,
 * so it is written first.
 */

/**
 * Where a geometry mutation came from.
 *
 * `inferred` — the software decided. Abutment snapping, azimuth re-derivation,
 *   corner clustering, restore-time reconstruction, migration backfill, a
 *   resolver reconciling two records. The user did not ask for this specific
 *   change and will not necessarily see it happen.
 *
 * `user-authored` — a person performed a gesture whose WHOLE MEANING is this
 *   change: dragging a selected section, typing a delta into an inspector,
 *   pressing a nudge key. Not "the user pressed a button that ran a routine
 *   that decided to move something" — that is `inferred` wearing a hat.
 */
export type MutationAuthorship = 'inferred' | 'user-authored';

/** A mutation's effect on the plan-view footprint, which is the protected record. */
export type FootprintEffect =
  /** The plan ring is byte-for-byte what it was. Heights may move. */
  | 'preserves-footprint'
  /** The plan ring moves. */
  | 'moves-footprint';

export interface GeometryMutationIntent {
  /** A short name for the operation, for the refusal message. */
  readonly operation: string;
  readonly authorship: MutationAuthorship;
  readonly effect: FootprintEffect;
}

export interface PolicyVerdict {
  readonly allowed: boolean;
  /** Always populated, including when allowed — the reason is the audit record. */
  readonly reason: string;
}

/**
 * The one place the ruling is applied.
 *
 * Deliberately total and deliberately boring: three of the four combinations are
 * allowed, and the fourth — software silently moving a traced footprint — is the
 * one the rule exists to stop.
 */
export function evaluateGeometryMutation(intent: GeometryMutationIntent): PolicyVerdict {
  if (intent.effect === 'preserves-footprint') {
    return {
      allowed: true,
      reason: `${intent.operation}: the plan-view footprint is unchanged`,
    };
  }
  if (intent.authorship === 'user-authored') {
    return {
      allowed: true,
      reason:
        `${intent.operation}: an explicit user gesture may move a traced footprint ` +
        `(Ray 2026-09-21). The footprint is still theirs — they are the one moving it.`,
    };
  }
  return {
    allowed: false,
    reason:
      `${intent.operation}: REFUSED. Inference and automatic reconciliation must never ` +
      `silently move the user's traced plan geometry. If a person deliberately asked for ` +
      `this move, the caller is mislabelled — say 'user-authored' and mean it.`,
  };
}

/**
 * Convenience for the common question, kept as its own name so call sites read
 * as the rule rather than as a boolean expression.
 */
export function mayMoveFootprint(authorship: MutationAuthorship): boolean {
  return evaluateGeometryMutation({
    operation: 'footprint move',
    authorship,
    effect: 'moves-footprint',
  }).allowed;
}
