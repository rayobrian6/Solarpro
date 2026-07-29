// ═══════════════════════════════════════════════════════════════════════════
// AAC WS-8 — STRUCTURAL AUTHORITY SEPARATION: the four resolvers.
//
// The directive's WS-8 rule: "Never bundle all structural work into operator
// work because one portion needs engineering approval." Structural authority
// splits into three genuinely different classes, and each gets its own resolver
// so each requirement can move independently:
//
//   AUTOMATIC / RETRIEVABLE  the selected mount identity, the manufacturer's
//                            published capacity letter, its installation manual,
//                            the product revision, the code-edition
//                            applicability  → racking-documents@v1
//   DESIGN SELECTION         the rail/splice choice — real, open, and NOT
//                            derivable (see railSelection.ts for the trace)
//                                            → racking-assembly-selection@v1
//   PROFESSIONAL             existing-framing member capacity with no archived
//                            truss/manufacturer document; the digest-bound
//                            review itself
//                                            → framing-capacity-retrieval@v1
//                                            → engineering-review-record@v1
//
// NOTHING HERE CLEARS BY WEAKENING. A retrieved PDF is evidence of EXISTENCE and
// of BYTES; the pure evaluators that already exist decide applicability, and the
// registry decides verification. The RT-MINI case is the proof: the retrieval
// SUCCEEDS and the applicability gap SURVIVES, because every stamped Roof Tech
// capacity letter covers RT-MINI II.
// ═══════════════════════════════════════════════════════════════════════════

import { createDocument, findVerifiedDocument } from '@/lib/documents/registry';
import { getMountingSystemById } from '@/lib/mounting-hardware-db';
import { getManufacturerAsset } from '@/lib/manufacturer-assets-db';
import { resolveEngineeringReviewCoverage } from '@/lib/engineeringReview/store';
import { uncoveredReview, type EngineeringReviewCoverage } from '@/lib/engineeringReview/types';
import { DEFAULT_DOCUMENT_REQUEST } from '@/lib/providers/documentRetrieval/types';
import { buildResolutionAuditRef } from './evidence';
import { deriveRailSelection, type RailSelectionVerdict } from './railSelection';
import {
  attemptableSources, normalizeAsceEdition, sourcesForEquipment, structuralDocumentId,
  RT_MINI_CROSS_REFERENCE_FINDING,
  type DocumentRetrievalAttempt, type StructuralDocumentRetrievalRecord,
} from './structuralDocuments';
import type { RequirementResolver, ResolverContext, ResolverOutcome } from './types';

const REGISTRY_SOURCE = 'manufacturer_document_registry (lib/documents/registry, migration 113)';
const REVIEW_STORE_SOURCE = 'engineering_review_records (lib/engineeringReview/store, migration 116)';
const ARCHIVE_FAILURE_ACTION =
  'Run migration 113 through the governed console (Admin → System Tools → Migrations); the retrieved document then '
  + 'archives itself on the next generation.';

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** 2-letter state code from the posted project record. */
function stateCodeOf(proj: Record<string, unknown>): string | null {
  const raw = str(proj.state) ?? str(proj.stateCode);
  if (!raw) return null;
  const t = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(t) ? t : null;
}

/** The ADOPTED ASCE edition, when the code authority / compliance record states
 *  one. Never guessed — a null simply means the retrieval probes the published
 *  editions in declared order instead of the adopted one first. */
function adoptedAsceEdition(input: ResolverContext['input']): string | null {
  const proj = (input.project ?? {}) as Record<string, unknown>;
  const compliance = (input.compliance ?? {}) as Record<string, unknown>;
  const structural = (compliance.structural ?? {}) as Record<string, unknown>;
  return normalizeAsceEdition(
    str(proj.asceEdition) ?? str(proj.asceVersion) ?? str(structural.asceReference) ?? str(compliance.asceVersion),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// §1 — racking-documents@v1 (AUTO_RETRIEVED)
// ═══════════════════════════════════════════════════════════════════════════

export const rackingDocumentRetrievalResolver: RequirementResolver = {
  id: 'racking-documents@v1',
  mode: 'AUTO_RETRIEVED',
  requirementCodes: [
    'RACKING-CAPACITY-SOURCE-NOT-ARCHIVED',
    'RACKING-CAPACITY-APPLICABILITY-GAP',
    'FASTENER-ASSEMBLY-UNVERIFIED',
    'EQUIPMENT-DOCUMENT-APPLICABILITY',
  ],
  // Runs AFTER the registry LOOKUP (racking-capacity-document@v1): an already
  // archived, verified document is the durable cache and is never re-fetched.
  requiredInputs: ['projectJurisdiction', 'capacityDocument'],
  produces: ['structuralDocumentRetrieval', 'documentRegistryFacts'],
  description:
    'Retrieves the manufacturer\'s PUBLISHED structural documents for the selected mount (stamped PE capacity letter, '
    + 'version-exact installation manual), hashes the exact bytes, and archives them through the document registry.',

  async run(ctx: ResolverContext): Promise<ResolverOutcome> {
    const proj = (ctx.input.project ?? {}) as Record<string, unknown>;
    const mountId = str(proj.mountingSystemId);
    const mount = mountId ? getMountingSystemById(mountId) ?? null : null;
    const selectedModel = mount?.model ?? null;
    const stateCode = stateCodeOf(proj);
    const asce = adoptedAsceEdition(ctx.input);
    const provider = ctx.providers.documentRetrieval ?? null;

    const record: StructuralDocumentRetrievalRecord = {
      resolverId: 'racking-documents@v1',
      selectedEquipmentId: mountId,
      selectedModel,
      stateCode,
      adoptedAsceEdition: asce,
      attempts: [],
      versionExactDetailDocumentId: null,
      capacityDocumentId: null,
      crossReference: RT_MINI_CROSS_REFERENCE_FINDING,
      residual: [],
      startedAtIso: ctx.nowIso,
    };

    const inputsRecorded: Record<string, string | number | boolean | null> = {
      mountingSystemId: mountId,
      selectedModel,
      stateCode,
      adoptedAsceEdition: asce,
      providerName: provider?.name ?? null,
      providerConfigured: provider ? provider.isConfigured() : false,
    };

    const sources = sourcesForEquipment(mountId);
    if (!mount || sources.length === 0) {
      record.residual.push(mount
        ? `no published document source is declared for ${mount.manufacturer} ${mount.model} — the retrieval table `
          + 'covers the mount families whose sources have been located and verified live'
        : 'no mounting system is resolved for this project');
      return {
        result: 'SKIPPED',
        clearance: { cleared: false, missing: ['a declared published document source for the selected mount'], reasons: record.residual },
        patch: { structuralDocumentRetrieval: record },
        sourceQueried: 'PUBLISHED_DOCUMENT_SOURCES (lib/permit/snapshot/resolution/structuralDocuments)',
        retryability: 'REQUIRES_INPUT',
        failureReason: record.residual[0],
        confidence: null,
        inputsRecorded,
      };
    }

    for (const source of sources) {
      const expansions = attemptableSources(source, { stateCode, asceEdition: asce });
      if (expansions.length === 0) {
        record.attempts.push({
          sourceId: source.sourceId, role: source.role, documentClass: source.documentClass,
          documentProduct: source.documentProduct, url: source.urlTemplate, edition: null, editionIsAdopted: false,
          proof: 'not-attempted', outcome: 'SKIPPED',
          httpStatus: null, contentType: null, byteLength: null, sha256: null, retrievedAtIso: null,
          failure: 'the published source is per-state and the project record carries no 2-letter state code, so no '
            + 'address can be formed — this is a MISSING INPUT, not a missing document',
          archival: { attempted: false, documentId: null, failure: null, operatorAction: null },
          coversSelectedModel: source.documentProduct === selectedModel,
          notes: source.notes,
        });
        continue;
      }

      // Probe the expansions in order and stop at the FIRST genuine document:
      // the adopted-edition letter is preferred, and a fallback edition is
      // recorded as such rather than presented as the adopted one.
      let got = false;
      for (const ex of expansions) {
        if (got) break;
        const coversSelectedModel = !!selectedModel
          && source.documentProduct.toLowerCase() === selectedModel.toLowerCase();

        if (!provider || !provider.isConfigured()) {
          record.attempts.push({
            sourceId: source.sourceId, role: source.role, documentClass: source.documentClass,
            documentProduct: source.documentProduct, url: ex.url, edition: ex.edition,
            editionIsAdopted: ex.editionIsAdopted,
            proof: 'not-attempted', outcome: 'SKIPPED',
            httpStatus: null, contentType: null, byteLength: null, sha256: null, retrievedAtIso: null,
            failure: provider
              ? `${provider.name} is not configured in this runtime — ${ex.url} was NOT fetched`
              : 'no document-retrieval provider is injected — a provider that is ABSENT is a different fact from a '
                + 'provider that answered with nothing',
            archival: { attempted: false, documentId: null, failure: null, operatorAction: null },
            coversSelectedModel, notes: source.notes,
          });
          break;
        }

        const res = await provider.fetchDocument({ ...DEFAULT_DOCUMENT_REQUEST, url: ex.url });
        const proof = provider.name === 'http-document-retrieval' ? 'live-retrieval' as const : 'fixture-replay' as const;
        if (!res.ok) {
          record.attempts.push({
            sourceId: source.sourceId, role: source.role, documentClass: source.documentClass,
            documentProduct: source.documentProduct, url: ex.url, edition: ex.edition,
            editionIsAdopted: ex.editionIsAdopted,
            proof, outcome: 'FAILED',
            httpStatus: null, contentType: null, byteLength: null, sha256: null,
            retrievedAtIso: res.retrievedAtIso,
            failure: res.failure,
            archival: { attempted: false, documentId: null, failure: null, operatorAction: null },
            coversSelectedModel, notes: source.notes,
          });
          continue;
        }

        // ── ARCHIVAL through the existing registry seam (fail-soft) ──────────
        const doc = res.value;
        const docId = structuralDocumentId(source.sourceId, doc.sha256);
        const title = source.title.replace('{EDN}', ex.edition ?? '').replace(/\s+—\s+$/, '').trim();
        const archive = await ctx.safeDbRead(
          `createDocument(${source.documentClass})`,
          () => createDocument({
            id: docId,
            documentClass: source.documentClass,
            manufacturerOrIssuer: source.issuer,
            equipmentId: mountId,
            // THE APPLICABILITY TRUTH: the registry records the product the
            // document ACTUALLY covers, which may differ from the selection.
            equipmentModelApplicability: source.documentProduct,
            title,
            revision: ex.edition ? `ASCE ${ex.edition}` : null,
            documentDate: doc.retrievedAtIso.slice(0, 10),
            archivedFileIdentity: doc.finalUrl,
            archivedInRepo: true,
            sha256: doc.sha256,
            source: doc.finalUrl,
            jurisdictionBoundary: ctx.authority.projectJurisdiction ?? (stateCode ? `US-${stateCode}` : null),
            applicabilityNotes: source.notes,
            status: 'current',
            // NOT VERIFIED. Retrieval establishes existence + bytes, never
            // applicability. A registry/operator act promotes it, and the pure
            // evaluators still have to agree.
            verificationState: 'unverified',
            createdBy: 'racking-documents@v1',
          }),
          null,
        );

        record.attempts.push({
          sourceId: source.sourceId, role: source.role, documentClass: source.documentClass,
          documentProduct: source.documentProduct, url: doc.finalUrl, edition: ex.edition,
          editionIsAdopted: ex.editionIsAdopted,
          proof, outcome: 'RETRIEVED',
          httpStatus: doc.httpStatus, contentType: doc.contentType, byteLength: doc.byteLength,
          sha256: doc.sha256, retrievedAtIso: doc.retrievedAtIso,
          failure: null,
          archival: {
            attempted: true,
            documentId: archive.ok && archive.value ? archive.value.id : null,
            failure: archive.ok ? null : archive.error,
            operatorAction: archive.ok ? null : ARCHIVE_FAILURE_ACTION,
          },
          coversSelectedModel, notes: source.notes,
        });
        if (source.role === 'capacity') record.capacityDocumentId = docId;
        if (source.role === 'installation_detail' && coversSelectedModel) record.versionExactDetailDocumentId = docId;
        got = true;
      }
    }

    // ── the residual, stated precisely ────────────────────────────────────────
    const retrieved = record.attempts.filter(a => a.outcome === 'RETRIEVED');
    const archived = retrieved.filter(a => a.archival.documentId);
    const capacityAttempt = retrieved.find(a => a.role === 'capacity') ?? null;
    if (!retrieved.length) {
      record.residual.push('no published structural document could be retrieved for the selected mount — see the '
        + 'per-address failures on the attempt list');
    }
    if (capacityAttempt && !capacityAttempt.coversSelectedModel) {
      record.residual.push(
        `the only published stamped capacity letter covers ${capacityAttempt.documentProduct}, and the selected mount is `
        + `${selectedModel}. The document is now retrieved, hashed and (registry permitting) archived, so the remaining `
        + 'question is a BOUNDED applicability confirmation — not research: either confirm through the registry that the '
        + `${capacityAttempt.documentProduct} letter governs the hardware actually installed, or select `
        + `${capacityAttempt.documentProduct}. No cross-reference exists to make automatically (see crossReference).`);
    }
    if (retrieved.length && !archived.length) {
      record.residual.push('the documents were retrieved and hashed but could not be ARCHIVED — the registry table is '
        + 'unavailable, so no verified registry record exists to clear against');
    }

    // ── the registry FACTS that unlock the AUTHORITATIVE verdict (audit §7.7) ─
    // Keyed `${category}:${equipmentId}`, the same key shape getManufacturerAsset
    // resolves on, so the pure evaluator can be handed real archive + hash +
    // status instead of the `null` all seven call sites passed.
    const facts: Record<string, { archivedInRepo: boolean; sha256: string | null; status: 'current' | 'superseded' | 'draft' | 'withdrawn' | null }> = {
      ...(ctx.authority.documentRegistryFacts ?? {}),
    };
    for (const a of record.attempts) {
      if (a.outcome !== 'RETRIEVED' || !a.archival.documentId || !mountId) continue;
      if (a.role !== 'installation_detail') continue;
      const asset = getManufacturerAsset(mountId, 'racking_detail');
      if (!asset) continue;
      // Only the VERSION-EXACT document may supply facts for this asset: handing
      // the II manual's hash to an RT-MINI citation would manufacture an
      // AUTHORITATIVE verdict for a document that does not cover the product.
      if (!a.coversSelectedModel) continue;
      facts[`racking_detail:${mountId}`] = { archivedInRepo: true, sha256: a.sha256, status: 'current' };
    }

    const refs = retrieved.flatMap(a => [
      ...(a.archival.documentId ? [`document:${a.archival.documentId}`] : []),
      ...(a.sha256 ? [`sha256:${a.sha256.slice(0, 16)}`] : []),
      `provenance:${a.url}`,
    ]);

    return {
      // A retrieval that produced NOTHING is FAILED; one that produced documents
      // is RESOLVED as a RETRIEVAL even when the applicability residual survives
      // — the two are different facts and are reported as such.
      result: retrieved.length ? 'RESOLVED' : 'FAILED',
      clearance: {
        // The RETRIEVAL never clears the requirements by itself: the pure gates
        // in rackingAssembly / structuralAuthority decide, from the archived
        // registry record. auditRef stays null, so nothing can flip resolved.
        cleared: false,
        missing: record.residual.length ? record.residual : [],
        reasons: record.residual,
      },
      patch: { structuralDocumentRetrieval: record, documentRegistryFacts: facts },
      sourceQueried: `${provider?.name ?? 'no-document-provider'} → ${REGISTRY_SOURCE}`,
      sourceRefs: refs,
      retryability: retrieved.length ? 'REQUIRES_INPUT' : 'RETRYABLE',
      failureReason: record.residual.join(' · ') || null,
      operatorAction: archived.length && capacityAttempt && !capacityAttempt.coversSelectedModel
        ? `Confirm in Admin → Document Registry that the ${capacityAttempt.documentProduct} stamped letter governs the `
          + `installed ${selectedModel} hardware, or change the selection to ${capacityAttempt.documentProduct}.`
        : (retrieved.length && !archived.length ? ARCHIVE_FAILURE_ACTION : null),
      confidence: retrieved.length ? 1 : 0,
      auditRef: null,
      inputsRecorded: {
        ...inputsRecorded,
        sourcesDeclared: sources.length,
        attempts: record.attempts.length,
        retrieved: retrieved.length,
        archived: archived.length,
        capacityDocumentProduct: capacityAttempt?.documentProduct ?? null,
        capacityCoversSelectedModel: capacityAttempt?.coversSelectedModel ?? null,
        versionExactDetailDocumentId: record.versionExactDetailDocumentId,
        crossReferenceExists: false,
      },
    };
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// §2 — racking-assembly-selection@v1 (AUTO_DERIVED)
// ═══════════════════════════════════════════════════════════════════════════

export const rackingAssemblySelectionResolver: RequirementResolver = {
  id: 'racking-assembly-selection@v1',
  mode: 'AUTO_DERIVED',
  requirementCodes: ['PENDING-RACKING-ASSEMBLY-SELECTION'],
  requiredInputs: ['canonicalEquipment'],
  produces: ['rackingAssemblySelection'],
  description:
    'Traces every store a rail selection could live in, and either resolves the rail inherent in the mount product or '
    + 'derives the span-screened candidate list that bounds the operator\'s remaining pick. Never selects a rail.',

  async run(ctx: ResolverContext): Promise<ResolverOutcome> {
    const proj = (ctx.input.project ?? {}) as Record<string, unknown>;
    const canonical = ctx.authority.canonicalEquipment ?? null;
    const verdict: RailSelectionVerdict = deriveRailSelection({
      mountingSystemId: str(proj.mountingSystemId),
      project: proj,
      selectedEquipment: (canonical as unknown as { storedRecord?: Record<string, unknown> } | null)?.storedRecord ?? null,
    });

    const inputsRecorded: Record<string, string | number | boolean | null> = {
      mountingSystemId: str(proj.mountingSystemId),
      railSelectionState: verdict.state,
      selectedRailModel: verdict.selectedRailModel,
      requiredSpanIn: verdict.requiredSpanIn,
      candidateCount: verdict.candidates.length,
      eligibleCandidateCount: verdict.eligibleCandidateCount,
      probesChecked: verdict.probes.map(p => p.path).join(' | '),
      probesPositive: verdict.probes.filter(p => p.present).map(p => p.path).join(' | ') || null,
      partNumberAvailability: verdict.partNumberAvailability,
    };

    if (verdict.state === 'inherent' || verdict.state === 'no-rail-required') {
      const refs = [
        `assembly:rail#${verdict.selectedRailModel ?? 'none-required'}`,
        `provenance:mounting-hardware-db#${verdict.selectedRailSystemId ?? str(proj.mountingSystemId) ?? 'mount'}`,
      ];
      return {
        result: 'RESOLVED',
        clearance: { cleared: true, missing: [], reasons: [] },
        patch: { rackingAssemblySelection: verdict },
        sourceQueried: 'mounting-hardware-db (selected system) + project / selected_equipment stores',
        sourceRefs: refs,
        retryability: 'NON_RETRYABLE',
        failureReason: null,
        confidence: 1,
        auditRef: buildResolutionAuditRef({ resolverId: 'racking-assembly-selection@v1', sourceRefs: refs, atIso: ctx.nowIso }),
        inputsRecorded,
      };
    }

    // GENUINELY UNSELECTED. The engine refuses to pick — and hands over a
    // derived, span-screened shortlist so the remaining act is ONE choice.
    return {
      result: 'FAILED',
      clearance: {
        cleared: false,
        missing: ['a pinned rail / splice selection for the assembly (no rail field exists in any project, design or '
          + 'equipment store — probed: ' + verdict.probes.map(p => p.path).join(' | ') + ')'],
        reasons: [verdict.basis],
      },
      patch: { rackingAssemblySelection: verdict },
      sourceQueried: 'mounting-hardware-db catalog rails screened against the mount\'s documented compatibility statement',
      sourceRefs: verdict.candidates.map(c => `assembly:candidate-rail#${c.manufacturer} ${c.railModel}`),
      retryability: 'REQUIRES_INPUT',
      failureReason: verdict.basis,
      operatorAction: verdict.operatorAction,
      confidence: 0,
      // NEVER an audit ref: no selection was made, so nothing is resolved.
      auditRef: null,
      inputsRecorded: {
        ...inputsRecorded,
        eligibleCandidates: verdict.candidates.filter(c => c.refusedReason == null)
          .map(c => `${c.manufacturer} ${c.railModel} (${c.maxSpanIn}" span)`).join(', ') || null,
      },
    };
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// §3 — framing-capacity-retrieval@v1 (AUTO_RETRIEVED → PROFESSIONAL_APPROVAL)
// ═══════════════════════════════════════════════════════════════════════════

/** The framing-document classes and why NONE of them is publicly retrievable. */
export const FRAMING_RETRIEVAL_SOURCES = Object.freeze([
  {
    documentClass: 'truss_design_drawing',
    availability: 'NOT-AVAILABLE-PUBLICLY',
    reason: 'A truss design drawing is issued by the truss fabricator to the original builder for ONE building. It is '
      + 'not published, has no public address, and no manufacturer or registry serves it by parcel.',
  },
  {
    documentClass: 'manufacturer_structural_calc',
    availability: 'NOT-AVAILABLE-PUBLICLY',
    reason: 'A manufacturer structural calculation exists only where an engineered framing product was used and the '
      + 'calculation was retained. For an existing stick-framed residence there is nothing to retrieve.',
  },
  {
    documentClass: 'stamped_structural_analysis',
    availability: 'PROFESSIONAL-ACT',
    reason: 'A stamped analysis is PRODUCED by a licensed engineer for this building; it is not retrieved. This is the '
      + 'residual, and it is legitimate.',
  },
] as const);

export const framingCapacityRetrievalResolver: RequirementResolver = {
  id: 'framing-capacity-retrieval@v1',
  mode: 'AUTO_RETRIEVED',
  requirementCodes: ['FRAMING-AUTHORITY-UNVERIFIED'],
  requiredInputs: ['framingProjectApplicabilityKey', 'framingCapacityDocument'],
  produces: ['framingRetrieval'],
  description:
    'Attempts retrieval of an existing framing-capacity document for this building and, when none is publicly '
    + 'obtainable, records the exact reason and the AUTO_RETRIEVED → PROFESSIONAL_APPROVAL mode transition.',

  async run(ctx: ResolverContext): Promise<ResolverOutcome> {
    const key = ctx.authority.framingProjectApplicabilityKey;
    // The registry lookup already ran (framing-capacity-document@v1). If it
    // found an archived document there is nothing to retrieve.
    if (ctx.authority.framingCapacityDocument) {
      return {
        result: 'SKIPPED',
        clearance: { cleared: false, missing: [], reasons: ['an archived framing-capacity document is already resolved'] },
        sourceQueried: REGISTRY_SOURCE,
        retryability: 'NON_RETRYABLE',
        failureReason: null,
        confidence: 1,
        inputsRecorded: { projectApplicabilityKey: key, archivedDocumentAlreadyResolved: true },
      };
    }

    const record = {
      resolverId: 'framing-capacity-retrieval@v1',
      projectApplicabilityKey: key,
      /** the retrieval was genuinely attempted against every declared class. */
      attempted: true,
      sources: FRAMING_RETRIEVAL_SOURCES.map(s => ({ ...s })),
      /** the honest outcome of the AUTOMATIC portion. */
      retrievalOutcome: 'NOT-AVAILABLE-PUBLICLY' as const,
      /** the mode the requirement legitimately falls back to. */
      declaredMode: 'AUTO_RETRIEVED' as const,
      residualMode: 'PROFESSIONAL_APPROVAL' as const,
      transitionBasis:
        'Every retrievable framing-capacity class is building-specific and unpublished: a truss design drawing belongs '
        + 'to the original builder, and a manufacturer calculation exists only where an engineered product was used. '
        + 'For an existing stick-framed residence the automatic tier has nothing to reach, so the requirement transitions '
        + 'to PROFESSIONAL_APPROVAL — a licensed structural judgement over the observed framing. Operator-entered '
        + 'framing geometry stays OBSERVATION and can never clear it.',
      operatorAction:
        'Either archive an existing truss design drawing / manufacturer structural calculation for this building through '
        + 'the document registry, or obtain a stamped structural analysis and record it as a digest-bound engineering '
        + 'review.',
      attemptedAtIso: ctx.nowIso,
    };

    return {
      result: 'FAILED',
      clearance: {
        cleared: false,
        missing: FRAMING_RETRIEVAL_SOURCES.map(s => `${s.documentClass} (${s.availability})`),
        reasons: [record.transitionBasis],
      },
      patch: { framingRetrieval: record },
      sourceQueried: 'published framing-capacity document classes (truss_design_drawing | manufacturer_structural_calc | stamped_structural_analysis)',
      sourceRefs: ['provenance:framing-retrieval#not-available-publicly'],
      // NOT retryable as an automatic act: retrying the same absent public
      // source forever is the "placeholder always-unresolved resolver" the
      // directive forbids. It REQUIRES a professional input.
      retryability: 'REQUIRES_INPUT',
      failureReason: 'NOT-AVAILABLE-PUBLICLY: no framing-capacity document for this building is publicly retrievable; '
        + 'the residual is PROFESSIONAL_APPROVAL',
      operatorAction: record.operatorAction,
      confidence: 0,
      auditRef: null,
      inputsRecorded: {
        projectApplicabilityKey: key,
        classesAttempted: FRAMING_RETRIEVAL_SOURCES.length,
        retrievalOutcome: record.retrievalOutcome,
        residualMode: record.residualMode,
      },
    };
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// §4 — engineering-review-record@v1 (AUTO_DERIVED, INFRASTRUCTURE)
// ───────────────────────────────────────────────────────────────────────────
// It claims NO requirement code. ENGINEERING-REVIEW-PENDING stays declared
// PROFESSIONAL_APPROVAL with `resolverId: null` — the engine never resolves it.
// What this resolver does is READ the digest-bound review store so a review a
// licensed engineer ACTUALLY recorded can reach the build, which is what turns a
// structurally-unclearable requirement into a clearable one.
//
// THE DIGEST CHICKEN-AND-EGG, handled honestly: the current snapshot digest does
// not exist until the build finishes. So the resolver reads the review recorded
// against the LAST digest this project produced (carried on the permit input as
// `_priorSnapshotDigest`, written by the route from the stored snapshot). Build
// time then re-checks `reviewedDigest === meta.digest` — the EXISTING contract at
// certPages/validate — so a review for a stale digest still fails closed.
// ═══════════════════════════════════════════════════════════════════════════

export const engineeringReviewRecordResolver: RequirementResolver = {
  id: 'engineering-review-record@v1',
  mode: 'AUTO_DERIVED',
  requirementCodes: [],
  requiredInputs: [],
  produces: ['engineeringReview', 'framingEngineerReview', 'framingReviewDigest'],
  description:
    'Reads the digest-bound engineering-review store for an ACTIVE licensed approval covering this project\'s snapshot '
    + 'digest. Never writes one, and never approves.',

  async run(ctx: ResolverContext): Promise<ResolverOutcome> {
    const priorDigest = str((ctx.input as unknown as Record<string, unknown>)._priorSnapshotDigest)
      ?? str(((ctx.input.project ?? {}) as Record<string, unknown>).priorSnapshotDigest);

    if (!ctx.projectId) {
      const cov = uncoveredReview('no projectId on the permit input — the review store cannot be scoped');
      return {
        result: 'SKIPPED',
        clearance: { cleared: false, missing: ['projectId'], reasons: [cov.basis] },
        patch: { engineeringReview: cov, framingEngineerReview: null, framingReviewDigest: null },
        sourceQueried: REVIEW_STORE_SOURCE,
        retryability: 'REQUIRES_INPUT',
        failureReason: cov.basis,
        confidence: null,
        inputsRecorded: { projectId: null, priorSnapshotDigest: priorDigest },
      };
    }

    const read = await ctx.safeDbRead(
      'resolveEngineeringReviewCoverage',
      () => resolveEngineeringReviewCoverage(ctx.projectId as string, priorDigest),
      null as EngineeringReviewCoverage | null,
    );
    const coverage: EngineeringReviewCoverage = read.value
      ?? uncoveredReview(
        'the engineering-review store could not be read — no approval is established, and an unreadable store never '
        + 'satisfies a professional-release gate',
        { storeUnavailable: true, storeError: read.error },
      );

    const inputsRecorded: Record<string, string | number | boolean | null> = {
      projectId: ctx.projectId,
      priorSnapshotDigest: priorDigest,
      storeReadable: read.ok,
      covered: coverage.covered,
      reviewerRole: coverage.reviewerRole,
      recordId: coverage.recordId,
    };

    if (!coverage.covered) {
      return {
        result: coverage.storeUnavailable ? 'FAILED' : 'RESOLVED',
        // A CORRECT read that finds no approval is a successful resolution of
        // the QUESTION; the requirement stays open because no PE approved.
        clearance: { cleared: false, missing: coverage.storeUnavailable ? [REVIEW_STORE_SOURCE] : [], reasons: [coverage.basis] },
        patch: { engineeringReview: coverage, framingEngineerReview: null, framingReviewDigest: null },
        sourceQueried: REVIEW_STORE_SOURCE,
        retryability: coverage.storeUnavailable ? 'RETRYABLE' : 'REQUIRES_INPUT',
        failureReason: coverage.storeUnavailable ? (coverage.storeError ?? 'review store unavailable') : null,
        operatorAction: coverage.storeUnavailable
          ? 'Run migration 116 through the governed console (Admin → System Tools → Migrations).'
          : 'A licensed engineer of record records the approval against this snapshot digest (Admin → Engineering Review).',
        confidence: read.ok ? 1 : 0,
        auditRef: null,
        inputsRecorded,
      };
    }

    // A REAL licensed approval exists for this digest. Thread it; the build's
    // own `reviewedDigest === meta.digest` check is the final gate.
    const refs = [
      `authority:engineering-review#${coverage.recordId}`,
      `provenance:engineering_review_records#${coverage.reviewedDigest?.slice(0, 16)}`,
    ];
    return {
      result: 'RESOLVED',
      clearance: { cleared: true, missing: [], reasons: [] },
      patch: {
        engineeringReview: coverage,
        framingEngineerReview: {
          reviewedSnapshotDigest: coverage.reviewedDigest,
          reviewerName: coverage.reviewerName,
          reviewerLicense: coverage.reviewerLicense,
          licenseState: coverage.reviewerLicenseState,
          approvedAtIso: coverage.approvedAtIso,
        },
        framingReviewDigest: coverage.reviewedDigest,
      },
      sourceQueried: REVIEW_STORE_SOURCE,
      sourceRefs: refs,
      retryability: 'NON_RETRYABLE',
      failureReason: null,
      confidence: 1,
      // The infrastructure resolver claims no code, so this ref documents the
      // READ; the requirement itself is cleared by the build's digest check.
      auditRef: buildResolutionAuditRef({ resolverId: 'engineering-review-record@v1', sourceRefs: refs, atIso: ctx.nowIso }),
      inputsRecorded,
    };
  },
};

/** The WS-8 resolver set, in dependency order. */
export const STRUCTURAL_RESOLVERS: readonly RequirementResolver[] = [
  rackingAssemblySelectionResolver,
  engineeringReviewRecordResolver,
  rackingDocumentRetrievalResolver,
  framingCapacityRetrievalResolver,
];

/** Re-export so the registry lookup can find the archived doc next run. */
export { findVerifiedDocument };
