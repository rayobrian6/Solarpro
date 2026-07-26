// ═══════════════════════════════════════════════════════════════════════════
// W4 §8/§9/§12 — ASYNC snapshot-authority resolver (closer wiring).
//
// buildPermitDesignSnapshot is a PURE, SYNCHRONOUS, deterministic build (its
// output digest must be reproducible). The manufacturer-document registry
// (lib/documents) and the digest-invalidation ledger (lib/reconciliation) are
// ASYNC database reads. This helper runs in the ONE genuinely-async path — the
// permit POST route — BEFORE the sync build, resolves those authorities, and
// threads the result into buildPermitDesignSnapshot's opts. FAIL-SOFT: a
// DB-unavailable test/harness run resolves everything to the pre-wiring
// defaults (no document ⇒ RT-MINI blockers stay; docs-archived null ⇒ the
// ISSUED-FOR-PERMIT gate is not satisfied), so generation never crashes and the
// snapshot digest is unchanged when no verified document exists.
// ═══════════════════════════════════════════════════════════════════════════
import type { PermitInput } from '../types';
import type { RackingCapacityDocumentEvidence } from './rackingAssembly';
import type { FramingCapacityDocumentEvidence } from './framingAuthority';
import type { CableExtensionSolution } from './types';
import type { QCableServiceLoopAllowance } from './procurementSufficiency';
import type { EnvironmentalLoadSourceEvidence } from './environmentalAuthority';
import { resolveRackingCapacityDocument, resolveFramingCapacityDocument, resolveCableExtensionSolutions, resolveClimateHazardDocument } from '@/lib/documents/registry';
import { listActiveInvalidations } from '@/lib/reconciliation/reconcile';
import { getMountingSystemById } from '@/lib/mounting-hardware-db';

/** The authority inputs resolved async and threaded into the sync build. */
export interface SnapshotAuthorityInputs {
  /** VERIFIED racking-capacity document for the selected mount (or null). */
  capacityDocument: RackingCapacityDocumentEvidence | null;
  /** project jurisdiction / AHJ applicability boundary. */
  projectJurisdiction: string | null;
  /** required manufacturer documents archived. null ⇒ unresolved (DB unavailable
   *  or no matching verified document) ⇒ ISSUED-FOR-PERMIT precondition NOT
   *  satisfied. Only `true` when a verified document was actually resolved. */
  manufacturerDocumentsArchived: boolean | null;
  /** a snapshot_digest_invalidations ledger entry forces the review-coverage
   *  precondition false. Unavailable ⇒ conservative `true` (unknown must not
   *  satisfy the gate). */
  digestInvalidatedByLedger: boolean;
  /** FRAMING-AUTHORITY GATE — the VERIFIED, project-applicable framing-capacity
   *  document (truss drawing / mfr calc / stamped analysis) or null. Fail-soft to
   *  null ⇒ FRAMING-AUTHORITY-UNVERIFIED stays firing (the honest Braidon outcome). */
  framingCapacityDocument: FramingCapacityDocumentEvidence | null;
  /** the exact project/building applicability key the framing document must cover. */
  framingProjectApplicabilityKey: string | null;
  /** §Q — canonical Q-Cable procurement-deficit resolution solutions, each backed
   *  by a VERIFIED manufacturer document. Empty until an operator selects an
   *  extension product AND its verified document is archived ⇒
   *  QCABLE-PROCUREMENT-INSUFFICIENT stays firing (the honest live outcome today). */
  cableExtensionSolutions: CableExtensionSolution[];
  /** §Q — a DOCUMENTED Q-Cable service-loop / transition allowance. STRICTER-ONLY:
   *  a documented allowance RAISES the sufficiency threshold and can NEVER clear a
   *  deficit (clearing is exclusively `evaluateCableExtensionClearance`). No such
   *  allowance rule is archived in-repo, so this resolves to null today and the
   *  allowance stays an honest 0 with provenance `no-allowance-authority-recorded`. */
  qcableServiceLoopAllowance: QCableServiceLoopAllowance | null;
  /** BAR §2 — the VERIFIED, project-applicable climate-hazard source (ASCE 7
   *  Hazard-Tool report / AHJ climate ordinance extract) that can construct a
   *  VERIFIED EnvironmentalLoadAuthority. Fail-soft to null ⇒ operator-entered
   *  wind/snow remain OBSERVATION/OVERRIDE ⇒ ENVIRONMENTAL-LOAD-AUTHORITY-
   *  UNVERIFIED keeps firing (the honest live outcome today — nothing archived). */
  environmentalSource: EnvironmentalLoadSourceEvidence | null;
}

/** Resolve the async document + ledger authority for a permit input. Never
 *  throws — every DB read is guarded and fails soft to the not-satisfied state.
 *  Migrations 113 (manufacturer_document_registry) / 114
 *  (equipment_reconciliation_audit + snapshot_digest_invalidations) are NOT yet
 *  run by Ray, so in production today both reads currently resolve to the
 *  fail-soft defaults (no document; conservative ledger unknown). */
export async function resolveSnapshotAuthorityInputs(input: PermitInput): Promise<SnapshotAuthorityInputs> {
  const proj = (input.project ?? {}) as Record<string, any>;
  const jurisdiction: string | null =
    (input.compliance?.jurisdiction as any)?.ahj ?? proj.ahjName ?? proj.state ?? null;
  const mountId: string | null = proj.mountingSystemId ?? null;
  const mount = mountId ? getMountingSystemById(mountId) : null;

  // ── §9 racking-capacity document (clears RT-MINI blockers only when verified
  //    AND it covers the exact assembly). Fail-soft to null. ──────────────────
  let capacityDocument: RackingCapacityDocumentEvidence | null = null;
  let manufacturerDocumentsArchived: boolean | null = null;
  try {
    capacityDocument = await resolveRackingCapacityDocument({
      equipmentId: mountId,
      mountModel: mount?.model ?? null,
      jurisdiction,
    });
    // reachable read: a resolved verified document ⇒ archived true; no matching
    // document ⇒ unresolved (null) — the resolver only checks racking, not the
    // full required-document set, so we do not assert a hard `false`.
    manufacturerDocumentsArchived = capacityDocument != null ? true : null;
  } catch {
    // DB unavailable (migration 113 not run / harness) ⇒ unresolved.
    capacityDocument = null;
    manufacturerDocumentsArchived = null;
  }

  // ── §12 digest-invalidation ledger. Unavailable ⇒ conservative true. ────────
  let digestInvalidatedByLedger = false;
  const projectId: string | null = (input as any).projectId ?? proj.projectId ?? null;
  if (projectId) {
    try {
      const invalidations = await listActiveInvalidations(projectId);
      digestInvalidatedByLedger = Array.isArray(invalidations) && invalidations.length > 0;
    } catch {
      digestInvalidatedByLedger = true; // 'unknown' must NOT satisfy the gate
    }
  }

  // ── FRAMING-AUTHORITY GATE — the verified, project-applicable framing-capacity
  //    document. Fail-soft to null (no document ⇒ FRAMING-AUTHORITY-UNVERIFIED
  //    keeps firing). The exact-project applicability key is the project id. ────
  const framingProjectApplicabilityKey: string | null = projectId ?? proj.apn ?? proj.address ?? null;
  let framingCapacityDocument: FramingCapacityDocumentEvidence | null = null;
  try {
    framingCapacityDocument = await resolveFramingCapacityDocument({
      equipmentId: null,
      projectApplicabilityKey: framingProjectApplicabilityKey,
      jurisdiction,
    });
  } catch {
    framingCapacityDocument = null;
  }

  // ── §Q Q-Cable procurement-deficit resolution solutions. Fail-soft to []. A
  //    solution is emitted ONLY when an operator-selected extension product has a
  //    VERIFIED manufacturer document; none exist today ⇒ empty ⇒ the deficit
  //    blocker stays firing on a short design. ───────────────────────────────────
  let cableExtensionSolutions: CableExtensionSolution[] = [];
  try {
    cableExtensionSolutions = await resolveCableExtensionSolutions({
      selectedExtensionSkus: Array.isArray(proj.cableExtensionSkus) ? proj.cableExtensionSkus : [],
      jurisdiction,
    });
  } catch {
    cableExtensionSolutions = [];
  }

  // ── BAR §2 climate-hazard source. The applicability key is the SAME boundary
  //    the pure gate checks (environmentalSourceVerified compares the document's
  //    projectApplicability against the project/AHJ), so the DB filter and the
  //    pure gate can never disagree. Fail-soft to null ⇒ operator-entered
  //    wind/snow stay unverified ⇒ ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED. ──────
  let environmentalSource: EnvironmentalLoadSourceEvidence | null = null;
  try {
    environmentalSource = await resolveClimateHazardDocument({
      projectApplicabilityKey: jurisdiction ?? proj.apn ?? proj.address ?? projectId,
      jurisdiction,
    });
  } catch {
    environmentalSource = null;   // DB unavailable (migration 113 not run / harness)
  }

  return {
    capacityDocument, projectJurisdiction: jurisdiction, manufacturerDocumentsArchived,
    digestInvalidatedByLedger, framingCapacityDocument, framingProjectApplicabilityKey,
    cableExtensionSolutions,
    // no in-repo Q-Cable service-loop allowance authority exists ⇒ honest null.
    qcableServiceLoopAllowance: null,
    environmentalSource,
  };
}
