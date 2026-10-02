// ═══════════════════════════════════════════════════════════════════════════
// 🚨 ONE GATE, ONE WORDING — the refusal every production surface returns.
//
// Ray: "Until the conflict is resolved, downstream production surfaces must not pretend STRING
// INVERTER is authoritative. Do not generate a permit-grade SLD from an unresolved architecture
// conflict. SLD/BOM/permit should report ELECTRICAL ARCHITECTURE REQUIRES RESOLUTION rather than
// drawing one of the competing systems."
//
// Four routes have to refuse: the SLD, its PDF, the BOM and the permit. Four copies of a gate is
// four chances for one of them to drift into rendering the losing side — which is the exact shape of
// the defect this is closing, one level up. So the predicate, the code, the message and the payload
// live here, and a route's whole participation is two lines.
//
// 🚨 AND IT BLOCKS ONE CONFLICT, NOT "CONFLICTS". Ray: "Other unrelated project engineering may
// continue." A stale `batteryCount` mirror must not stop a drawing; only the coupling can, because
// only the coupling leaves the renderer with two architectures and no way to choose.
// ═══════════════════════════════════════════════════════════════════════════

import type { ElectricalProjectModel } from '@/lib/electrical/projectModel';

export const ARCHITECTURE_BLOCKED_CODE = 'ELECTRICAL_ARCHITECTURE_REQUIRES_RESOLUTION';

/** The operator-facing line. Ray wrote these words; they are not paraphrased anywhere. */
export const ARCHITECTURE_BLOCKED_MESSAGE = 'ELECTRICAL ARCHITECTURE REQUIRES RESOLUTION';

export interface ArchitectureRefusal {
  success: false;
  code: typeof ARCHITECTURE_BLOCKED_CODE;
  error: typeof ARCHITECTURE_BLOCKED_MESSAGE;
  /** Why, in the operator's words — from the model, so every surface says the same thing. */
  conflicts: ElectricalProjectModel['conflicts'];
  /** The two answers, with what each one would do. */
  choices: ElectricalProjectModel['architectureChoices'];
  /** The equipment the question is about, and where it came from. */
  externalInverter: {
    id: string | null;
    origin: ElectricalProjectModel['externalInverterOrigin'];
  } | null;
  /** Where the decision is recorded. Named so a client never has to hard-code the path. */
  resolveWith: { method: 'POST'; path: '/api/engineering/electrical-architecture' };
  /**
   * 🚨 WHICH ELECTRICAL STATE WAS REFUSED. Without it, "it refused" is unfalsifiable after the fact:
   * the row moves, the operator retries, and nobody can say whether the refusal was about the state
   * they are now looking at.
   */
  electricalRevision: string | null;
}

/**
 * The refusal payload, or null when this project may be drawn.
 *
 * A route's whole use of this module:
 *
 *     const refusal = architectureRefusal(model);
 *     if (refusal) return NextResponse.json(refusal, { status: 409 });
 *
 * 409 rather than 200-with-a-banner: a permit-grade artefact that EXISTS can be printed, attached
 * and submitted by someone who never read the banner. The only safe artefact for an unresolved
 * architecture is no artefact, plus the question.
 */
export function architectureRefusal(
  m: ElectricalProjectModel | null | undefined,
  electricalRevision?: string | null,
): ArchitectureRefusal | null {
  if (!m?.architectureResolutionRequired) return null;
  return {
    success: false,
    code: ARCHITECTURE_BLOCKED_CODE,
    error: ARCHITECTURE_BLOCKED_MESSAGE,
    conflicts: m.conflicts.filter(c => c.code === 'SOLAR_COUPLING_UNRESOLVED'),
    choices: m.architectureChoices,
    externalInverter: m.hasExternalInverter
      ? { id: m.externalInverterId, origin: m.externalInverterOrigin }
      : null,
    resolveWith: { method: 'POST', path: '/api/engineering/electrical-architecture' },
    electricalRevision: electricalRevision ?? null,
  };
}
