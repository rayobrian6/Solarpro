// ═══════════════════════════════════════════════════════════════════════════
// ECD §8 — THE APP-A EQUIPMENT-LISTING CONCLUSION (docs/ENGINE-CLOSURE-DIRECTIVE
// .md §8, docs/ECD-ROOT-CAUSE-MAP.md W2-C).
//
// APP-A closed the "Manufacturer Data Sheets — On File" block with a bare
// renderer literal:
//
//     All equipment is CEC Listed, UL Listed, and approved for grid interconnection.
//
// No registry read, no requirement check, no gate — on a package carrying OPEN
// equipment-identity, equipment-document-applicability, racking-selection and
// capacity-document requirements. A blanket approval sentence is exactly what
// gate 14 forbids.
//
// The conclusion is now DERIVED from the canonical release-gate registry: the
// sentence states NOT-YET-ESTABLISHED while any requirement in the LISTING /
// DOCUMENT-APPLICABILITY scope is open, and it can only become positive when the
// scope is clear. It is a projection (pure, read-only) — it never resolves,
// clears or re-scores a requirement, so the §11 architecture freeze holds.
// ═══════════════════════════════════════════════════════════════════════════
import type { PermitDesignSnapshot } from './types';
import { projectReleaseGates, type ReleaseRequirement } from './releaseGates';

/** The requirement codes that bear on "is the selected equipment listed, and is
 *  the document that establishes it applicable to what we selected?".
 *
 *  Scoped deliberately and narrowly to equipment identity + equipment/assembly
 *  DOCUMENT authority. Route lengths, conduit fill and project-administrative
 *  holds are NOT in scope: they say nothing about equipment listing, and folding
 *  them in would make the sentence unfalsifiable rather than informative. */
export const EQUIPMENT_LISTING_SCOPE_CODES: readonly string[] = [
  // RG-2 equipment reconciliation / equipment documents
  'EQUIPMENT-IDENTITY-CONFLICT',
  'MODULE-EXACT-DATASHEET-PENDING',
  'EQUIPMENT-DOCUMENT-UNVERIFIED',
  // RG-4 the SELECTED ASSEMBLY and the documents that establish it
  'EQUIPMENT-DOCUMENT-APPLICABILITY',
  'PENDING-RACKING-ASSEMBLY-SELECTION',
  'RACKING-CAPACITY-SOURCE-NOT-ARCHIVED',
  'RACKING-CAPACITY-APPLICABILITY-GAP',
  'RACKING-CAPACITY-ULTIMATE-BASIS-REFUSED',
  'ATTACHMENT-CAPACITY-SOURCE-MISSING',
  'MIXED-MANUFACTURER-ASSEMBLY-UNSUPPORTED',
  'FASTENER-ASSEMBLY-UNVERIFIED',
  'FASTENER-CONFIG-MISSING',
  'MODULE-DIMENSIONS-UNVERIFIED',
  // RG-5/6 the LISTED cable assembly's own grounding document authority
  'QCABLE-GROUNDING-AUTHORITY-UNVERIFIED',
] as const;

/** ECD §8 — the mandated NOT-ESTABLISHED sentence (directive wording, verbatim). */
export const EQUIPMENT_LISTING_NOT_ESTABLISHED_SENTENCE =
  'EQUIPMENT LISTING AND DOCUMENT APPLICABILITY NOT YET ESTABLISHED FOR THE COMPLETE '
  + 'SELECTED ASSEMBLY — SEE RS-1';

/** The ONLY positive conclusion, and only when the scope is demonstrably clear. */
export const EQUIPMENT_LISTING_ESTABLISHED_SENTENCE =
  'EQUIPMENT LISTING AND DOCUMENT APPLICABILITY ESTABLISHED FOR THE COMPLETE SELECTED '
  + 'ASSEMBLY FROM THE VERIFIED DOCUMENT REGISTRY — SEE RS-1';

export interface EquipmentListingConclusion {
  /** true only when NO in-scope requirement is open AND a registry was read. */
  established: boolean;
  /** the ONE sentence APP-A prints. Never a renderer literal. */
  sentence: string;
  /** the OPEN in-scope requirement codes, in registry order. */
  openCodes: string[];
  /** the OPEN in-scope codes whose severity is advisory (counted separately). */
  openAdvisoryCodes: string[];
  /** the release-gate ids those open requirements roll up to (for the SEE RS-1). */
  openGateIds: string[];
  /** honest state when no snapshot/registry was available to read. */
  registryRead: boolean;
  snapshotId: string | null;
  snapshotDigest: string | null;
}

/** Derive the conclusion from the canonical release-gate registry. Pure. */
export function projectEquipmentListingConclusion(
  snap: PermitDesignSnapshot | null | undefined,
): EquipmentListingConclusion {
  const registryRead = !!snap?.meta?.snapshotId;
  const model = projectReleaseGates(snap ?? null);
  const inScope = (r: ReleaseRequirement): boolean =>
    r.status === 'OPEN' && EQUIPMENT_LISTING_SCOPE_CODES.includes(r.requirementCode);
  const open = model.requirements.filter(inScope);
  const blocking = open.filter(r => r.severity !== 'warning' && r.findingType !== 'ADVISORY');
  const advisory = open.filter(r => r.severity === 'warning' || r.findingType === 'ADVISORY');
  // FAIL CLOSED: no registry ⇒ nothing is established.
  const established = registryRead && blocking.length === 0;
  return {
    established,
    sentence: established
      ? EQUIPMENT_LISTING_ESTABLISHED_SENTENCE
      : EQUIPMENT_LISTING_NOT_ESTABLISHED_SENTENCE,
    openCodes: open.map(r => r.requirementCode),
    openAdvisoryCodes: advisory.map(r => r.requirementCode),
    openGateIds: [...new Set(open.map(r => r.gateId))],
    registryRead,
    snapshotId: snap?.meta?.snapshotId ?? null,
    snapshotDigest: snap?.meta?.digest ?? null,
  };
}
