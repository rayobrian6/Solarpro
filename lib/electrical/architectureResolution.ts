// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE ONE EXPLICIT DECISION — planned here, persisted by the route.
//
// Ray: "If deterministic evidence is insufficient, show: ELECTRICAL CONFIGURATION CONFLICT … One
// explicit decision. Not hidden inference. After Ray resolves it once, persist the canonical
// architecture and provenance permanently."
//
// So this module answers "what exactly would that click write?" as a pure function, and the route
// authenticates, calls it, and writes what it returned. The rule that a resolution never deletes
// equipment lives HERE, where it is tested, not in a handler.
//
// Ray's requirements for the DC answer, verbatim:
//   · "those standalone inverter instances disappear from current design authority"
//   · "old history remains traceable"
//   · "the 37 real modules remain"
//   · "PV strings are re-derived against PW3 PV inputs"
//   · "no module is lost or fabricated"
//
// The first two are what `retiredInverter` is: the selection leaves `inverter`/`inverterId`, which is
// what every design surface reads, and lands in a slot nothing reads for design — with when, why and
// what its origin was judged to be. The third and fifth are why this plan touches NO module field at
// all: module count lives in `layouts.total_panels` and this writes `projects`. The fourth follows
// automatically once the coupling is recorded, because the string sizing already reads the published
// PV input limits off the storage instances.
// ═══════════════════════════════════════════════════════════════════════════

import type { ElectricalProjectModel } from '@/lib/electrical/projectModel';
import type { SolarCoupling } from '@/lib/electrical/serviceTopology';
import {
  provenanceRecord, type EquipmentProvenanceKind, type RetiredEquipmentRecord,
} from '@/lib/electrical/equipmentProvenance';

export type ResolutionRefusal =
  /** Nothing is in conflict — resolving would overwrite a settled project. */
  | 'NOTHING_TO_RESOLVE'
  /** The requested coupling is not one of the answers this conflict has. */
  | 'NOT_AN_OFFERED_CHOICE';

export interface ArchitectureResolutionPlan {
  /** The coupling to record on the graph. */
  coupling: SolarCoupling;
  /**
   * The merge patch for `projects.selected_equipment`.
   *
   * 🚨 `inverter: null` / `inverterId: null` is a RETIREMENT, not a delete: the writer merges
   * shallowly, so these two keys stop being design authority while `retiredInverter` keeps the
   * record. Nothing is removed from the row.
   */
  equipmentPatch: Record<string, unknown>;
  /** One line for the decision log and the audit trail. */
  summary: string;
  /** Did this retire the separate inverter from design authority? */
  retiredExternalInverter: boolean;
}

export type ArchitectureResolutionResult =
  | { ok: true; plan: ArchitectureResolutionPlan }
  | { ok: false; refusal: ResolutionRefusal; message: string };

/**
 * Plan the write for one explicit architecture decision.
 *
 * `now` is a parameter so the plan is a pure function of its inputs — a test asserts the exact
 * bytes, and a clock inside would make that impossible.
 */
export function planArchitectureResolution(
  m: ElectricalProjectModel,
  coupling: SolarCoupling,
  now: Date,
  /**
   * `change`: the installer is deliberately CHANGING a coupling a designer already recorded (System
   * Config's PV connection answer, or a conflict banner on a recorded decision). Without it a
   * recorded decision is refused — the stale-tab guard below. With it the new answer is planned
   * exactly like a first one: a DC answer retires the separate inverter, an AC answer confirms it.
   */
  opts: { change?: boolean } = {},
): ArchitectureResolutionResult {
  // ══════════════════════════════════════════════════════════════════════════
  // 🚨 REFUSE WHEN A HUMAN ALREADY DECIDED — NOT MERELY WHEN NOTHING IS OUTSTANDING.
  //
  // This guard used to read `!m.architectureResolutionRequired`. It was right about the hazard it
  // protects against — a stale browser tab, or a replayed request, overwriting a recorded
  // architecture with whatever it was showing when it loaded — and wrong about the test for it.
  //
  // The moment `projectModel` learned to DERIVE a determined architecture rather than ask an
  // unanswerable question, a project whose coupling is derived could no longer be STATED by the
  // installer at all: the resolution dialog's own endpoint answered NOTHING_TO_RESOLVE. That is a
  // capability regression introduced by a correctness repair, which is precisely the trade Ray
  // ruled out: "Do not remove valid edit paths... Do not solve redundancy by deleting useful
  // engineering capability."
  //
  // A derivation is not a decision. Recording a human decision over a derivation is always an
  // improvement — it is the write that makes the value permanent, attributable, and immune to every
  // future change in the derivation. So the refusal names the state it is actually protecting.
  // ══════════════════════════════════════════════════════════════════════════
  if (m.solarCouplingProvenance.source === 'service-topology' && !opts.change) {
    return {
      ok: false, refusal: 'NOTHING_TO_RESOLVE',
      // Not "the service topology": that is no longer a tab. The PV connection on Inverters & Strings
      // writes the graph (`answerSolarCoupling`), whose PUT records who changed it.
      message: 'A designer already recorded the architecture on this project. Change the PV connection '
        + 'on the Inverters & Strings card in System Config — it writes the service record, which records '
        + 'who changed it.',
    };
  }
  // The answers an outstanding conflict offers; and when none is outstanding, the two couplings
  // this endpoint is entitled to record. `retiresExternalInverter` is a property of the ANSWER and
  // not of the offer — choosing DC coupling retires a separate inverter whichever way the question
  // arrived, and `storage-only` is still not an answer this endpoint accepts.
  const choice = m.architectureChoices.find(c => c.coupling === coupling)
    ?? (coupling === 'dc-coupled-storage' || coupling === 'ac-coupled-inverter'
      ? {
          coupling,
          label: '',
          consequence: '',
          retiresExternalInverter: coupling === 'dc-coupled-storage',
        }
      : undefined);
  if (!choice) {
    return {
      ok: false, refusal: 'NOT_AN_OFFERED_CHOICE',
      message: `'${coupling}' is not one of the answers to this conflict. The offered answers are: `
        + m.architectureChoices.map(c => c.coupling).join(', ') + '.',
    };
  }

  const origin = m.externalInverterOrigin;
  const equipmentPatch: Record<string, unknown> = {};

  if (choice.retiresExternalInverter && m.hasExternalInverter) {
    const retired: RetiredEquipmentRecord = {
      id: m.externalInverterId ?? '',
      record: null,     // filled by the route from the stored row, which holds the full object
      retiredAt: now.toISOString(),
      retiredBecause: 'The installer resolved the electrical architecture to '
        + 'PV DC coupled to storage, so a separate PV inverter is not part of this design.',
      originAtRetirement: {
        kind: origin?.kind ?? 'UNRECORDED',
        basis: origin?.basis ?? '',
        evidence: origin?.evidence ?? [],
      },
    };
    equipmentPatch.inverter = null;
    equipmentPatch.inverterId = null;
    equipmentPatch.retiredInverter = retired;
    // 🚨 AND THE PROVENANCE OF THE *DECISION* IS RECORDED, not of the equipment that just left.
    // The project now states, permanently, that a person chose DC coupling — which is why this
    // conflict can never fire again on this row.
    equipmentPatch.provenance = {
      architecture: provenanceRecord(
        'USER_SELECTED', 'architecture-resolution',
        'The installer resolved an architecture conflict in favour of PV DC coupled to storage.',
        now,
      ),
    };
  } else if (coupling === 'ac-coupled-inverter' && m.hasExternalInverter) {
    // ── The AC answer: the inverter STAYS, and stops being a suggestion. ─────
    //
    // 🚨 THIS IS THE HALF THAT MUST NOT BE SKIPPED. Recording only the coupling would leave the
    // inverter's origin as `AUTO_SUGGESTED_LEGACY` forever, so every surface would keep reporting
    // "suggested automatically — never confirmed" about a product the installer has now explicitly
    // confirmed. The click IS the missing provenance.
    equipmentPatch.provenance = {
      inverter: provenanceRecord(
        'USER_SELECTED', 'architecture-resolution',
        'The installer confirmed this separate PV inverter when resolving an architecture conflict.',
        now,
      ),
      architecture: provenanceRecord(
        'USER_SELECTED', 'architecture-resolution',
        'The installer resolved an architecture conflict in favour of a separate AC PV inverter.',
        now,
      ),
    };
  } else {
    // ── NO SEPARATE INVERTER ON FILE: only the decision is recorded. ─────────
    //
    // 🚨 NEVER AN INVERTER PROVENANCE FOR AN INVERTER THAT DOES NOT EXIST. This branch used to be the
    // AC branch's `else`, so ANY answer here — an AC answer on a job with no inverter yet, even a DC
    // answer with nothing to retire — wrote `provenance.inverter = USER_SELECTED "The installer
    // confirmed this separate PV inverter"`. This route is the only writer of that slot, and its mere
    // presence classifies whatever inverter is written LATER (an ecosystem auto-pick included) as the
    // installer's decision, never AUTO_SUGGESTED_LEGACY — the phantom-inverter class. An inverter
    // chosen later records its own provenance when it is chosen.
    equipmentPatch.provenance = {
      architecture: provenanceRecord(
        'USER_SELECTED', 'architecture-resolution',
        coupling === 'dc-coupled-storage'
          ? 'The installer resolved the electrical architecture to PV DC coupled to storage.'
          : 'The installer recorded that the PV connects through a separate AC PV inverter (none is selected yet).',
        now,
      ),
    };
  }

  return {
    ok: true,
    plan: {
      coupling,
      equipmentPatch,
      summary: `Electrical architecture resolved to ${coupling}`
        + (choice.retiresExternalInverter && m.hasExternalInverter
          ? `; the separate inverter (${m.externalInverterId ?? 'unknown'}) was retired from design `
            + 'authority and kept as history'
          : coupling === 'ac-coupled-inverter' && m.hasExternalInverter
            ? '; the separate inverter is now recorded as the installer’s decision'
            : ''),
      retiredExternalInverter: choice.retiresExternalInverter && m.hasExternalInverter,
    },
  };
}

/** The kinds a resolution may write. Exported so a test can assert nothing else is reachable. */
export const RESOLUTION_WRITES_KINDS: EquipmentProvenanceKind[] = ['USER_SELECTED'];
