// ═══════════════════════════════════════════════════════════════════════════
// AAC WS-1 — THE RESOLVERS REGISTERED TODAY (stub-free wiring of what EXISTS)
// ───────────────────────────────────────────────────────────────────────────
// Every resolver here performs REAL work: it derives a value from project data,
// or it queries a real source through the shared guarded reader. Nothing here is
// a placeholder that always returns unresolved.
//
// WHAT IS DELIBERATELY ABSENT: the DOMAIN resolvers (canonical equipment, AHJ /
// code adoption, ASCE 7 climate hazard, conduit fill, Q-Cable topology, designer
// personnel, rail selection, document ingestion). They arrive in AAC-2..AAC-5.
// Their requirement codes carry `resolverId: null` in REQUIREMENT_DECLARATIONS,
// which the lifecycle surfaces LOUDLY as RESOLVER-NOT-IMPLEMENTED evidence — it
// is never presented as a silently-final blocker, and the closure doc will show
// that count reach zero by AAC-6.
// ═══════════════════════════════════════════════════════════════════════════

import {
  resolveRackingCapacityDocument, resolveFramingCapacityDocument,
  resolveCableExtensionSolutions, resolveClimateHazardDocument,
  findVerifiedDocument, listDocuments,
} from '@/lib/documents/registry';
import {
  listActiveInvalidations, readProjectEquipmentStores, reconcileEquipmentIdentity,
  findAppliedReconciliation,
} from '@/lib/reconciliation/reconcile';
import { getMountingSystemById } from '@/lib/mounting-hardware-db';
// D4 — the curated jurisdiction resolution. No provider, no network: the same
// derivation the pure snapshot build uses for codeAuthority.ahjRecordId.
import { resolveAhjRecordTraced } from '../codeAuthority';
import type {
  RequirementResolver, ResolverContext, ResolverOutcome, ResolutionInvalidation,
  LegalJurisdictionAuthority,
} from './types';
import { buildResolutionAuditRef, documentSourceRefs } from './evidence';
import {
  collectModuleSelectionCandidates, decideCanonicalSelection, buildCanonicalEquipmentAuthority,
  reconciliationSources, applyCanonicalEquipmentToInput, findSupersededLeaks,
  EQUIPMENT_IDENTITY_DEPENDENTS, RECONCILE_FIELD_BY_IDENTITY, SYSTEM_RESOLVER_ACTOR,
  supersededMirrorRecords, persistedSupersededCandidates,
  type StoredEquipmentRecord,
} from './equipmentSelection';
import {
  evaluateModuleDatasheetBinding, MODULE_DATASHEET_DOCUMENT_CLASS, moduleSourceIsEstablished,
} from './datasheetBinding';
// CMDA — THE canonical module applicability authority.
import {
  evaluateModuleDatasheetApplicability, type ModuleDatasheetApplicabilityAuthority,
} from '../moduleDocumentAuthority';
// CMEI — THE canonical module identity: one accessor, one boundary.
import { materialiseModuleIdentity, resolveFleetModuleIdentities } from '@/lib/equipment/moduleIdentity';
import {
  resolveProjectPersonnel, unavailablePersonnelAuthority,
} from '@/lib/personnel/store';
import { PERSONNEL_ROLE_LABEL, type ProjectPersonnelAuthority } from '@/lib/personnel/types';
// AAC WS-3 / WS-4 — the retrieval resolvers (re-exported so every existing
// importer of this module sees the full production set from one place).
import {
  projectAuthorityResolver, codeAuthorityResolver, environmentalAuthorityResolver,
} from './jurisdictionResolvers';
export {
  projectAuthorityResolver, codeAuthorityResolver, environmentalAuthorityResolver,
} from './jurisdictionResolvers';
// AAC WS-8 — the structural separation resolvers (same re-export discipline).
import {
  rackingDocumentRetrievalResolver, rackingAssemblySelectionResolver,
  framingCapacityRetrievalResolver, engineeringReviewRecordResolver,
} from './structuralResolvers';
export {
  rackingDocumentRetrievalResolver, rackingAssemblySelectionResolver,
  framingCapacityRetrievalResolver, engineeringReviewRecordResolver,
} from './structuralResolvers';
// WS-5 — the field route measurement read (migration 118). Read-only: it is the
// resolver half of a workflow whose WRITE half is the authenticated API.
import { fieldRouteMeasurementResolver } from './fieldMeasurementResolver';
import {
  findManufacturerDatasheet, toRegistryDocumentFromCatalogue,
} from '@/lib/documents/manufacturerDatasheetCatalogue';
export { fieldRouteMeasurementResolver } from './fieldMeasurementResolver';

const DOC_REGISTRY_SOURCE = 'manufacturer_document_registry (lib/documents/registry, migration 113)';
const LEDGER_SOURCE = 'snapshot_digest_invalidations (lib/reconciliation/reconcile, migration 114)';

/** The minimal operator action for a missing archived document (directive: state
 *  one only when it is GENUINELY necessary — no ingestion path exists in-repo
 *  yet, so archiving + verifying the document is the honest next step today). */
const ARCHIVE_ACTION = 'Archive + verify the source document through the document registry (file + SHA-256 + revision + current status + extracted claims + jurisdiction).';

// ═══════════════════════════════════════════════════════════════════════════
// AUTO_DERIVED — deterministic from existing project data.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The jurisdiction / applicability KEYS every retrieval resolver depends on.
 * Pure and deterministic (the derivation that already lived inline at
 * authorityInputs.ts:72-73 and :112). Registering it makes the dependency
 * EXPLICIT: a change to the jurisdiction re-dirties every document lookup, which
 * is what makes the lifecycle a loop rather than a single pass.
 */
export const projectAuthorityKeyResolver: RequirementResolver = {
  id: 'project-authority-key@v1',
  mode: 'AUTO_DERIVED',
  requirementCodes: [],
  requiredInputs: [],
  produces: ['projectJurisdiction', 'framingProjectApplicabilityKey', 'legalJurisdiction'],
  description: 'Derives the AHJ/jurisdiction boundary and the project applicability key from the posted project record, and establishes the CANONICAL legal AHJ from the curated jurisdiction table.',
  async run(ctx: ResolverContext): Promise<ResolverOutcome> {
    const proj = (ctx.input.project ?? {}) as Record<string, unknown>;
    const jurisdiction: string | null =
      ((ctx.input.compliance?.jurisdiction as Record<string, unknown> | undefined)?.ahj as string | undefined)
      ?? (proj.ahjName as string | undefined)
      ?? (proj.state as string | undefined)
      ?? null;

    // ── D4 — THE CANONICAL LEGAL AHJ, ESTABLISHED HERE AND NOWHERE LATER ────
    // `jurisdiction` above is the POSTED record's answer. For the live Braidon
    // project that is "City of Granite City Building & Zoning" — the MAILING
    // city — while the parcel sits in unincorporated Madison County. Stamping a
    // manufacturer document from it is how all four live registry rows came to
    // carry the wrong governing authority.
    //
    // The retrieval resolvers that could correct it do not reliably run: BOTH
    // `project-authority@v1` (needs a property-identity provider) and
    // `code-authority@v1` (early-returns when the adoption retrieval finds no
    // coverage) exit before publishing anything. On the live path neither
    // reaches its patch, which is why the correction never propagated.
    //
    // `resolveAhjRecordTraced` needs no provider and no network. It is the same
    // resolution the pure snapshot build already uses to produce
    // `codeAuthority.ahjRecordId`, and it applies the boundary rule directly: a
    // postal city is not a jurisdiction, so an unincorporated parcel resolves to
    // the COUNTY record. Deriving it here — in the AUTO_DERIVED resolver that
    // runs FIRST — makes the legal AHJ a precondition available to every
    // document resolver, rather than an accident of retrieval ordering.
    const _traced = resolveAhjRecordTraced({
      ahjRecordId: (proj.ahjRecordId as string | undefined) ?? (proj.ahjId as string | undefined) ?? null,
      ahjName: (proj.ahjName as string | undefined) ?? null,
      stateCode: (proj.state as string | undefined) ?? null,
      county: (proj.county as string | undefined) ?? null,
      city: (proj.city as string | undefined) ?? null,
      address: (proj.address as string | undefined) ?? null,
    });
    const _rec = _traced.record;
    // ⚠ THIS DERIVATION IS NEVER 'verified'. It resolves a curated-table record
    // from hints; it does NOT perform a municipal-boundary determination. Its
    // match methods are 'explicit-record-id' | 'stored-ahj-name' |
    // 'incorporated-city' | 'address-parse' | 'unresolved' — every one of which
    // can be wrong in the exact way this defect was wrong. `explicit-record-id`
    // is the most dangerous of them: on the live Braidon project the stored
    // engineering_config carries `ahjId: 'il-icc'`, a stale value that would
    // resolve "explicitly" to the wrong authority.
    //
    // So this publishes the legal AHJ for VISIBILITY and for the name-comparison
    // fallback, and deliberately marks it UNVERIFIED. Only a real boundary
    // determination (project-authority@v1, which sets 'verified') may authorise
    // archiving a jurisdiction-bound document. An unverified derivation stamping
    // a document is precisely the class of defect D4 exists to remove.
    const legalJurisdiction: LegalJurisdictionAuthority | null = _rec
      ? {
          ahjRecordId: _rec.id,
          ahjName: _rec.ahjName,
          jurisdictionType: (_rec.ahjType as LegalJurisdictionAuthority['jurisdictionType']) ?? null,
          stateCode: _rec.stateCode ?? ((proj.state as string | undefined) ?? null),
          county: _rec.county ?? ((proj.county as string | undefined) ?? null),
          unincorporated: _traced.incorporated == null ? null : !_traced.incorporated,
          // the MAILING city, kept separate so display never reaches for the legal name
          mailingCity: (proj.city as string | undefined) ?? null,
          provenance: {
            source: 'project-authority-key@v1',
            ref: `ahj-national:${_rec.id}`,
            basis: `curated jurisdiction table · match method '${_traced.matchMethod}' `
              + '· NOT a municipal-boundary determination',
          },
          verificationState: 'unverified',
        }
      : null;
    const applicabilityKey: string | null =
      ctx.projectId ?? (proj.apn as string | undefined) ?? (proj.address as string | undefined) ?? null;
    const missing: string[] = [];
    if (!jurisdiction) missing.push('project.ahjName | project.state | compliance.jurisdiction.ahj');
    if (!applicabilityKey) missing.push('projectId | project.apn | project.address');
    return {
      result: missing.length ? 'FAILED' : 'RESOLVED',
      clearance: {
        cleared: missing.length === 0,
        missing,
        reasons: missing.length ? ['the project record carries no jurisdiction / applicability key'] : [],
      },
      patch: { projectJurisdiction: jurisdiction, framingProjectApplicabilityKey: applicabilityKey, legalJurisdiction },
      sourceQueried: 'PermitInput.project (posted record)',
      sourceRefs: ['provenance:permit-input#project'],
      retryability: missing.length ? 'REQUIRES_INPUT' : 'NON_RETRYABLE',
      failureReason: missing.length ? `no jurisdiction/applicability key on the project record (${missing.join('; ')})` : null,
      confidence: missing.length ? 0 : 1,
      inputsRecorded: { jurisdiction, applicabilityKey, projectId: ctx.projectId },
    };
  },
};

/**
 * The INVALIDATION half (audit §5 Seam 3): the active
 * snapshot_digest_invalidations rows for this project. Deterministic from
 * existing project data. Fail-soft direction is deliberately INVERTED — an
 * unreadable ledger resolves to `true` (invalidated), because "unknown" must
 * never satisfy the review-coverage precondition (authorityInputs.ts:105).
 */
export const digestInvalidationLedgerResolver: RequirementResolver = {
  id: 'digest-invalidation-ledger@v1',
  mode: 'AUTO_DERIVED',
  requirementCodes: [],
  requiredInputs: [],
  produces: ['digestInvalidatedByLedger', 'digestInvalidations'],
  description: 'Reads the active snapshot_digest_invalidations rows for the project (the review-coverage precondition).',
  async run(ctx: ResolverContext): Promise<ResolverOutcome> {
    if (!ctx.projectId) {
      return {
        result: 'SKIPPED',
        clearance: { cleared: false, missing: ['projectId'], reasons: ['no projectId on the permit input — the ledger cannot be scoped'] },
        patch: { digestInvalidatedByLedger: false, digestInvalidations: [] },
        sourceQueried: LEDGER_SOURCE,
        retryability: 'REQUIRES_INPUT',
        failureReason: 'no projectId — the invalidation ledger cannot be queried',
        confidence: null,
      };
    }
    const read = await ctx.safeDbRead(
      'listActiveInvalidations',
      () => listActiveInvalidations(ctx.projectId as string),
      null as unknown[] | null,
    );
    // fail-soft INVERTED: unreadable ⇒ conservative `true`.
    const rows = read.ok ? (Array.isArray(read.value) ? read.value : []) : null;
    const invalidated = rows == null ? true : rows.length > 0;
    // PRR §2 — project the ROWS, not just their count. The count alone was a
    // permanent latch: the writer records `digest: null` and nothing in the
    // codebase ever sets `superseded_at`, so one reconciliation blocked every
    // future approval on that project forever. reviewCoverage.invalidationApplies
    // scopes each row to the digest (or the approval instant) it actually names.
    const facts = rows == null ? null : rows.map((r) => {
      const row = r as Record<string, unknown>;
      const at = row.invalidated_at ?? row.invalidatedAt ?? null;
      return {
        digest: (row.digest as string | null) ?? null,
        scope: (row.scope as string | null) ?? null,
        invalidatedAtIso: at == null ? null : (at instanceof Date ? at.toISOString() : String(at)),
        reason: (row.reason as string | null) ?? null,
      };
    });
    return {
      result: read.ok ? 'RESOLVED' : 'FAILED',
      clearance: {
        cleared: read.ok,
        missing: read.ok ? [] : ['snapshot_digest_invalidations'],
        reasons: read.ok ? [] : ['the invalidation ledger is unreadable — the review-coverage precondition is fail-closed to INVALIDATED'],
      },
      patch: { digestInvalidatedByLedger: invalidated, digestInvalidations: facts },
      sourceQueried: LEDGER_SOURCE,
      sourceRefs: ['authority:reconciliation.snapshot_digest_invalidations'],
      retryability: read.ok ? 'NON_RETRYABLE' : 'RETRYABLE',
      failureReason: read.error,
      confidence: read.ok ? 1 : null,
      inputsRecorded: { projectId: ctx.projectId, activeRowCount: rows == null ? null : rows.length },
    };
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// AUTO_RETRIEVED — authoritative document retrieval through lib/documents.
// (Today these are registry LOOKUPS; AAC-3/4/5 add the ingestion + provider
// retrieval behind the same resolver ids.)
// ═══════════════════════════════════════════════════════════════════════════

export const rackingCapacityDocumentResolver: RequirementResolver = {
  id: 'racking-capacity-document@v1',
  mode: 'AUTO_RETRIEVED',
  requirementCodes: [
    'RACKING-CAPACITY-SOURCE-NOT-ARCHIVED',
    'RACKING-CAPACITY-APPLICABILITY-GAP',
    // PHASE A / D33 — FASTENER-ASSEMBLY-UNVERIFIED was declared here and is
    // NEVER fed by this resolver: the fastener predicate reads
    // `ra.datasheetSource ?? ra.capacitySource` (structuralProjection.ts:494-511),
    // which are compiled-in catalogue strings this resolver does not touch. A
    // `cleared: true` with an audit ref would therefore have stamped
    // `resolved: true` (build.ts:1978) on a record the emitter still pushes —
    // a false clear standing in for a requirement that, at HEAD, has no writer
    // at all. Phase B gives the fastener predicate a real document-backed
    // writer; until then this resolver must not claim it.
  ],
  requiredInputs: ['projectJurisdiction'],
  produces: ['capacityDocument', 'manufacturerDocumentsArchived'],
  description: 'Resolves the VERIFIED, current, archived racking-capacity document (PE letter / evaluation report) for the selected mount.',
  async run(ctx: ResolverContext): Promise<ResolverOutcome> {
    const proj = (ctx.input.project ?? {}) as Record<string, unknown>;
    const mountId = (proj.mountingSystemId as string | undefined) ?? null;
    const mount = mountId ? getMountingSystemById(mountId) : null;
    const jurisdiction = ctx.authority.projectJurisdiction;
    const read = await ctx.safeDbRead(
      'resolveRackingCapacityDocument',
      () => resolveRackingCapacityDocument({ equipmentId: mountId, mountModel: mount?.model ?? null, jurisdiction }),
      null,
    );
    // NOTE — the SHIPPED manufacturer structural catalogue is deliberately NOT
    // consulted here. This resolver's job is to report the REGISTRY RETRIEVAL
    // faithfully, and folding a second source into its outcome would make a DB
    // outage change the evidence it records (the transient-resolver and
    // outage-resilience invariants both depend on it not doing that).
    //
    // The catalogue is a PURE, in-repo product-master table, so it resolves
    // inside buildRackingAssembly instead — which is the digest-covered
    // evaluation, resolves identically online and offline, and is the path the
    // frozen fixtures take. See lib/documents/manufacturerStructuralCatalogue.ts.
    const doc = read.value;
    const refs = documentSourceRefs(doc);
    return {
      result: !read.ok ? 'FAILED' : doc ? 'RESOLVED' : 'FAILED',
      clearance: {
        cleared: doc != null,
        missing: doc ? [] : ['a structural_pe_letter / evaluation_report covering the exact mount model + jurisdiction, from the operator\'s document registry or the shipped manufacturer catalogue'],
        // ── TR — THE MATERIAL REASON DOES NOT DEPEND ON HOW THE LOOKUP WENT ──
        // This sentence reaches `blockingReason` → the registry payload → the
        // DESIGN DIGEST. It is therefore stated so that it is equally true when
        // the registry answered "none" and when the registry could not be
        // reached: either way NO capacity authority is established, the
        // requirement is open, the gate is closed and the drawings are the same.
        // WHY the lookup did not answer is operational — it travels verbatim on
        // `failureReason` / `retryability` below into
        // `snapshot.resolverAttemptEvidence`, which the digest does not read.
        // Interpolating `read.error` here (what this did) meant a one-second
        // registry blip re-worded a digested field and invalidated the PE's
        // digest-bound approval of an unchanged design.
        reasons: doc ? [] : ['no VERIFIED, current, archived, structurally-claiming capacity document is ESTABLISHED for the selected mount in this jurisdiction'],
      },
      // doc ⇒ archived true; no doc ⇒ UNRESOLVED (null), never a hard false.
      patch: { capacityDocument: doc, manufacturerDocumentsArchived: doc != null ? true : null },
      sourceQueried: DOC_REGISTRY_SOURCE,
      sourceRefs: refs,
      retryability: !read.ok ? 'RETRYABLE' : doc ? 'NON_RETRYABLE' : 'REQUIRES_INPUT',
      failureReason: read.ok ? (doc ? null : 'no matching verified capacity document') : read.error,
      operatorAction: doc ? null : ARCHIVE_ACTION,
      confidence: doc ? 1 : 0,
      auditRef: doc ? buildResolutionAuditRef({ resolverId: 'racking-capacity-document@v1', sourceRefs: refs, atIso: ctx.nowIso }) : null,
      inputsRecorded: { mountId, mountModel: mount?.model ?? null, jurisdiction },
    };
  },
};

export const framingCapacityDocumentResolver: RequirementResolver = {
  id: 'framing-capacity-document@v1',
  mode: 'AUTO_RETRIEVED',
  requirementCodes: ['FRAMING-AUTHORITY-UNVERIFIED'],
  requiredInputs: ['projectJurisdiction', 'framingProjectApplicabilityKey'],
  produces: ['framingCapacityDocument'],
  description: 'Resolves the VERIFIED, project-applicable framing-capacity document (truss drawing / mfr calc / stamped analysis).',
  async run(ctx: ResolverContext): Promise<ResolverOutcome> {
    const key = ctx.authority.framingProjectApplicabilityKey;
    const jurisdiction = ctx.authority.projectJurisdiction;
    const read = await ctx.safeDbRead(
      'resolveFramingCapacityDocument',
      () => resolveFramingCapacityDocument({ equipmentId: null, projectApplicabilityKey: key, jurisdiction }),
      null,
    );
    const doc = read.value;
    const refs = documentSourceRefs(doc);
    return {
      result: !read.ok ? 'FAILED' : doc ? 'RESOLVED' : 'FAILED',
      clearance: {
        cleared: doc != null,
        missing: doc ? [] : ['manufacturer_document_registry: truss_design_drawing | manufacturer_structural_calc | stamped_structural_analysis covering this building'],
        // TR — material reason, independent of the attempt outcome.
        reasons: doc ? [] : ['no VERIFIED, current, archived framing-capacity document is ESTABLISHED for this exact building — operator-entered framing geometry is OBSERVATION, never capacity'],
      },
      patch: { framingCapacityDocument: doc },
      sourceQueried: DOC_REGISTRY_SOURCE,
      sourceRefs: refs,
      retryability: !read.ok ? 'RETRYABLE' : doc ? 'NON_RETRYABLE' : 'REQUIRES_INPUT',
      failureReason: read.ok ? (doc ? null : 'no matching verified framing-capacity document') : read.error,
      operatorAction: doc ? null : ARCHIVE_ACTION,
      confidence: doc ? 1 : 0,
      auditRef: doc ? buildResolutionAuditRef({ resolverId: 'framing-capacity-document@v1', sourceRefs: refs, atIso: ctx.nowIso }) : null,
      inputsRecorded: { projectApplicabilityKey: key, jurisdiction },
    };
  },
};

export const climateHazardDocumentResolver: RequirementResolver = {
  id: 'climate-hazard-document@v1',
  mode: 'AUTO_RETRIEVED',
  requirementCodes: ['ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED'],
  requiredInputs: ['projectJurisdiction', 'framingProjectApplicabilityKey'],
  produces: ['environmentalSource'],
  description: 'Resolves the VERIFIED, project-applicable climate-hazard source (ASCE 7 Hazard-Tool report / AHJ climate ordinance extract).',
  async run(ctx: ResolverContext): Promise<ResolverOutcome> {
    const proj = (ctx.input.project ?? {}) as Record<string, unknown>;
    const jurisdiction = ctx.authority.projectJurisdiction;
    // the SAME applicability key the pure gate checks, so the DB filter and the
    // pure gate can never disagree (authorityInputs.ts:138-147).
    const key = jurisdiction
      ?? (proj.apn as string | undefined)
      ?? (proj.address as string | undefined)
      ?? ctx.authority.framingProjectApplicabilityKey;
    const read = await ctx.safeDbRead(
      'resolveClimateHazardDocument',
      () => resolveClimateHazardDocument({ projectApplicabilityKey: key, jurisdiction }),
      null,
    );
    const doc = read.value;
    const refs = documentSourceRefs(doc);
    return {
      result: !read.ok ? 'FAILED' : doc ? 'RESOLVED' : 'FAILED',
      clearance: {
        cleared: doc != null,
        missing: doc ? [] : ['manufacturer_document_registry: climate_hazard_dataset covering this site (wind + snow + exposure/risk, currency-reviewed)'],
        // TR — material reason, independent of the attempt outcome (see the
        // racking-capacity resolver above for the full rationale).
        reasons: doc ? [] : ['no ARCHIVED climate-hazard source is ESTABLISHED for this exact site — operator-entered wind/snow are an OBSERVATION/OVERRIDE and can never clear it'],
      },
      patch: { environmentalSource: doc },
      sourceQueried: DOC_REGISTRY_SOURCE,
      sourceRefs: refs,
      retryability: !read.ok ? 'RETRYABLE' : doc ? 'NON_RETRYABLE' : 'REQUIRES_INPUT',
      failureReason: read.ok ? (doc ? null : 'no matching archived climate-hazard source') : read.error,
      operatorAction: doc ? null : ARCHIVE_ACTION,
      confidence: doc ? 1 : 0,
      auditRef: doc ? buildResolutionAuditRef({ resolverId: 'climate-hazard-document@v1', sourceRefs: refs, atIso: ctx.nowIso }) : null,
      inputsRecorded: { projectApplicabilityKey: key ?? null, jurisdiction },
    };
  },
};

export const cableExtensionSolutionsResolver: RequirementResolver = {
  id: 'cable-extension-solutions@v1',
  mode: 'AUTO_RETRIEVED',
  requirementCodes: ['QCABLE-PROCUREMENT-INSUFFICIENT'],
  requiredInputs: ['projectJurisdiction'],
  produces: ['cableExtensionSolutions'],
  description: 'Resolves VERIFIED listed cable-extension solutions for an operator-selected extension SKU (the DOCUMENT half of the Q-Cable deficit clearance).',
  async run(ctx: ResolverContext): Promise<ResolverOutcome> {
    const proj = (ctx.input.project ?? {}) as Record<string, unknown>;
    const skus = Array.isArray(proj.cableExtensionSkus) ? (proj.cableExtensionSkus as string[]) : [];
    const jurisdiction = ctx.authority.projectJurisdiction;
    // AAC WS-5 — the operator SELECTION record per SKU travels with the project;
    // the resolver hands it to the registry so a resolved document becomes a
    // real (possibly incomplete, never fabricated) solution object.
    const selections = (proj.cableExtensionSelections ?? null) as Record<string, never> | null;
    const read = await ctx.safeDbRead(
      'resolveCableExtensionSolutions',
      () => resolveCableExtensionSolutions({ selectedExtensionSkus: skus, jurisdiction, selections }),
      [],
    );
    const solutions = read.value ?? [];
    return {
      result: !read.ok ? 'FAILED' : solutions.length ? 'RESOLVED' : 'FAILED',
      clearance: {
        cleared: solutions.length > 0,
        missing: solutions.length ? [] : (skus.length
          ? ['manufacturer_document_registry: a verified listed-extension document for the selected SKU']
          : ['project.cableExtensionSkus (no listed extension product selected)']),
        // TR — material reason, independent of the attempt outcome.
        reasons: solutions.length ? [] : [skus.length
          ? 'the selected extension SKUs have no VERIFIED listed document ESTABLISHED — a documented solution cannot be constructed'
          : 'no listed cable-extension product is selected (project.cableExtensionSkus is empty), so there is no extension DOCUMENT for this resolver to resolve. The alternate-stock / raw-stock / dead-drop / rebranch option space IS evaluated deterministically — by qcable-solution@v1, which owns QCABLE-PROCUREMENT-INSUFFICIENT and states the governing unresolved reason'],
      },
      patch: { cableExtensionSolutions: solutions },
      sourceQueried: DOC_REGISTRY_SOURCE,
      retryability: !read.ok ? 'RETRYABLE' : 'REQUIRES_INPUT',
      failureReason: read.ok ? (solutions.length ? null : 'no verified cable-extension solution resolvable') : read.error,
      operatorAction: null,
      confidence: solutions.length ? 1 : 0,
      auditRef: null,     // a document alone never clears the deficit (the pure gate decides)
      inputsRecorded: { selectedExtensionSkuCount: skus.length, jurisdiction },
    };
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// AAC WS-2 — CANONICAL EQUIPMENT SELECTION (AUTO_DERIVED)
// ───────────────────────────────────────────────────────────────────────────
// Ray's user-authority mandate (2026-07-27) SUPERSEDES the old standing rule
// that EQUIPMENT-IDENTITY-CONFLICT may only be cleared by an operator: a valid
// CURRENT explicit user selection IS the reconciliation authority. This resolver
// (1) reads the canonical store the permit POST never read, (2) ranks every
// candidate through the WS-2 precedence lattice with real provenance, (3) when
// ONE explicit current selection dominates a stale/legacy/generated record it
// AUTO-RECONCILES through the EXISTING transactional machinery
// (reconcileEquipmentIdentity — same audit row, same digest-invalidation ledger
// rows as the operator path, actor 'system-resolver'), and (4) re-pins the
// permit input to the canonical identity so BOM / datasheet binding / electrical
// + structural calculations rebuild from it.
//
// It NEVER auto-picks between two genuinely active explicit selections: that
// stays OPERATOR_CONFIRMATION with the exact reason, both directions tested.
// If migration 114's tables are absent the reconciliation cannot be recorded, so
// the resolution is UNRESOLVED with the exact retryable failure — never a
// clear without an audit row.
// ═══════════════════════════════════════════════════════════════════════════

const RECON_TABLE_SOURCE = 'equipment_reconciliation_audit + snapshot_digest_invalidations (migration 114)';
const EQUIPMENT_STORE_SOURCE = 'projects.selected_equipment + engineering_config.subSystems (migration 101 / §1.1 map)';

export const canonicalEquipmentResolver: RequirementResolver = {
  id: 'canonical-equipment-selection@v1',
  mode: 'AUTO_DERIVED',
  requirementCodes: ['EQUIPMENT-IDENTITY-CONFLICT'],
  requiredInputs: [],
  produces: ['canonicalEquipment'],
  description: 'Ranks every equipment-identity source through the WS-2 precedence lattice, auto-reconciles a stale record to the current explicit user selection, and re-pins the permit input to the canonical identity.',
  async run(ctx: ResolverContext): Promise<ResolverOutcome> {
    // ── 1. the canonical store (the permit POST never read it — audit Path 1) ──
    const storeRead = ctx.projectId
      ? await ctx.safeDbRead(
          'readProjectEquipmentStores',
          () => readProjectEquipmentStores(ctx.projectId as string),
          null as StoredEquipmentRecord | null,
        )
      : { value: null as StoredEquipmentRecord | null, ok: false, error: 'no projectId on the permit input — the canonical equipment store cannot be read' };

    const candidates = collectModuleSelectionCandidates({ input: ctx.input, stored: storeRead.value });
    const verdict = decideCanonicalSelection(candidates, 'module');
    const inputsRecorded: Record<string, string | number | boolean | null> = {
      projectId: ctx.projectId,
      candidateCount: candidates.length,
      canonicalStoreReadable: storeRead.ok,
      canonicalValue: verdict.canonical?.value ?? null,
      canonicalTier: verdict.canonical?.tier ?? null,
      supersededCount: verdict.superseded.length,
      genuinelyActiveConflicts: verdict.unresolvedActive.length,
    };

    // ── 2. nothing usable ⇒ SKIPPED, honestly ─────────────────────────────
    if (!verdict.canonical) {
      return {
        result: 'SKIPPED',
        clearance: { cleared: false, missing: ['a resolvable module identity in any store or in the posted design'], reasons: [verdict.basis] },
        patch: { canonicalEquipment: buildCanonicalEquipmentAuthority({ verdict }) },
        sourceQueried: EQUIPMENT_STORE_SOURCE,
        retryability: 'REQUIRES_INPUT',
        failureReason: verdict.reasons.join(' · ') || 'no equipment-identity candidate resolved',
        confidence: null,
        inputsRecorded,
      };
    }

    // ── 3. no divergence ⇒ one identity everywhere; nothing to reconcile ───
    if (!verdict.divergent) {
      const refs = [`provenance:${verdict.canonical.provenance.path}`, `authority:canonical-equipment#${verdict.canonical.value}`];
      return {
        result: 'RESOLVED',
        clearance: { cleared: true, missing: [], reasons: [] },
        patch: { canonicalEquipment: buildCanonicalEquipmentAuthority({ verdict }) },
        sourceQueried: EQUIPMENT_STORE_SOURCE,
        sourceRefs: refs,
        retryability: 'NON_RETRYABLE',
        failureReason: null,
        confidence: 1,
        auditRef: buildResolutionAuditRef({ resolverId: 'canonical-equipment-selection@v1', sourceRefs: refs, atIso: ctx.nowIso }),
        inputsRecorded,
      };
    }

    // ── 4. TWO GENUINELY ACTIVE selections ⇒ OPERATOR_CONFIRMATION, always ──
    if (verdict.operatorConfirmationRequired) {
      return {
        result: 'FAILED',
        clearance: {
          cleared: false,
          missing: verdict.unresolvedActive.map(c => `${c.provenance.path} (an explicit selection that is not superseded)`),
          reasons: [
            'two genuinely active equipment selections disagree — the engine may not choose between them',
            ...verdict.reasons,
          ],
        },
        patch: { canonicalEquipment: buildCanonicalEquipmentAuthority({ verdict }) },
        sourceQueried: EQUIPMENT_STORE_SOURCE,
        sourceRefs: [`provenance:${verdict.canonical.provenance.path}`],
        retryability: 'REQUIRES_INPUT',
        failureReason: `two genuinely active equipment selections disagree: ${verdict.reasons.join(' · ')}`,
        operatorAction: 'Choose the module of record in Admin → Reconciliation (the choice, the reason and the superseded value are recorded immutably).',
        confidence: 0,
        auditRef: null,
        inputsRecorded,
      };
    }

    // ── 4b. AAC-7 §1(a) — ALREADY RECONCILED ⇒ write NOTHING ────────────────
    // Every persisted store of record now agrees; the only divergence left is in
    // the POSTED REQUEST BODY, which is not a store — it is re-pinned in memory
    // below. Writing another audit row here is what made repeat generation churn
    // the ledger (a new equipment_reconciliation_audit row + two
    // snapshot_digest_invalidations rows per generation, and a registry that
    // could differ between two consecutive runs because run 1 changed what run 2
    // read). The requirement still needs an audit REFERENCE to clear, so it cites
    // the row the original reconciliation already wrote.
    const persistedDivergent = persistedSupersededCandidates(verdict);
    if (persistedDivergent.length === 0) {
      const prior = ctx.projectId
        ? await ctx.safeDbRead(
            'findAppliedReconciliation',
            () => findAppliedReconciliation(
              ctx.projectId as string,
              RECONCILE_FIELD_BY_IDENTITY.module,
              verdict.canonical!.value as string,
            ),
            null,
          )
        : { value: null, ok: false, error: 'no projectId' };
      const repinOnly = applyCanonicalEquipmentToInput(ctx.input, verdict.canonical.value as string, { nowIso: ctx.nowIso });
      const authorityIdem = buildCanonicalEquipmentAuthority({
        verdict,
        reconciliation: prior.value
          ? {
              auditId: prior.value.id,
              actor: prior.value.operatorId,
              reason: 'the persisted stores were already reconciled to this canonical identity — this generation re-pinned the posted design and wrote nothing',
              reconciledAtIso: prior.value.reconciledAt,
              invalidationCount: 0,
            }
          : null,
        rebuiltRecords: repinOnly.changed,
      });
      const idemLeaks = findSupersededLeaks(ctx.input, authorityIdem);
      const idemRefs = [
        ...(prior.value ? [`authority:equipment_reconciliation_audit#${prior.value.id}`] : []),
        `provenance:${verdict.canonical.provenance.path}`,
        `authority:canonical-equipment#${verdict.canonical.value}`,
      ];
      if (idemLeaks.length) {
        return {
          result: 'FAILED',
          clearance: { cleared: false, missing: idemLeaks, reasons: [`a superseded equipment record is still present in the active design: ${idemLeaks.join('; ')}`] },
          patch: { canonicalEquipment: authorityIdem },
          sourceQueried: EQUIPMENT_STORE_SOURCE,
          sourceRefs: idemRefs,
          retryability: 'RETRYABLE',
          failureReason: `superseded selection leaked into the active snapshot at ${idemLeaks.join('; ')}`,
          confidence: 0,
          auditRef: null,
          inputsRecorded,
        };
      }
      return {
        result: 'RESOLVED',
        clearance: { cleared: true, missing: [], reasons: [] },
        patch: { canonicalEquipment: authorityIdem },
        sourceQueried: EQUIPMENT_STORE_SOURCE,
        sourceRefs: idemRefs,
        retryability: 'NON_RETRYABLE',
        failureReason: null,
        confidence: 1,
        auditRef: buildResolutionAuditRef({ resolverId: 'canonical-equipment-selection@v1', sourceRefs: idemRefs, atIso: ctx.nowIso }),
        inputsRecorded: {
          ...inputsRecorded,
          alreadyReconciled: true,
          priorReconciliationAuditId: prior.value?.id ?? null,
          rebuiltRecordCount: repinOnly.changed.length,
        },
      };
    }

    // ── 5. ONE current explicit selection + stale PERSISTED record(s) ⇒
    //    AUTO-RECONCILE through the EXISTING transactional machinery: audit row +
    //    canonical update + the superseded-mirror re-alignment + the two
    //    invalidation ledger rows. Same trail as the operator path; only the
    //    actor differs, and it says so.
    const reason = `AAC WS-2 automatic reconciliation: ${verdict.basis}`;
    const sources = reconciliationSources(verdict);
    const mirrors = supersededMirrorRecords(verdict);
    const recon = await ctx.safeDbRead(
      'reconcileEquipmentIdentity',
      () => reconcileEquipmentIdentity({
        projectId: ctx.projectId as string,
        conflictField: RECONCILE_FIELD_BY_IDENTITY.module,
        subsystemKey: verdict.superseded.find(s => s.subsystemKey)?.subsystemKey ?? null,
        sources,
        chosenSource: verdict.canonical.reconciliationSource,
        reason,
        operatorId: SYSTEM_RESOLVER_ACTOR,
        operatorName: 'AAC canonical-equipment resolver (automatic reconciliation of a superseded record)',
      }, { realign: mirrors }),
      null,
    );

    if (!recon.ok || !recon.value) {
      // The DERIVATION is certain; the RECORD could not be written. No audit row
      // ⇒ no clearance (deriveRequirementStatus contract). Exact + retryable.
      return {
        result: 'FAILED',
        clearance: {
          cleared: false,
          missing: [RECON_TABLE_SOURCE],
          reasons: [
            'the canonical selection is determined, but the reconciliation could not be RECORDED — a reconciliation without its immutable audit row is not a resolution',
            verdict.basis,
          ],
        },
        patch: { canonicalEquipment: buildCanonicalEquipmentAuthority({ verdict }) },
        sourceQueried: RECON_TABLE_SOURCE,
        retryability: 'RETRYABLE',
        failureReason: recon.error ?? 'reconcileEquipmentIdentity returned no result',
        operatorAction: 'Run migration 114 through the governed console (Admin → System Tools → Migrations), then regenerate — the reconciliation records itself automatically.',
        confidence: 0,
        auditRef: null,
        inputsRecorded,
      };
    }

    // ── 6. RECORDED ⇒ re-pin the input + declare the invalidations ─────────
    const repin = applyCanonicalEquipmentToInput(ctx.input, verdict.canonical.value as string, { nowIso: ctx.nowIso });
    const authority = buildCanonicalEquipmentAuthority({
      verdict,
      reconciliation: {
        auditId: recon.value.auditId,
        actor: SYSTEM_RESOLVER_ACTOR,
        reason,
        reconciledAtIso: recon.value.reconciledAt,
        invalidationCount: recon.value.invalidations.length,
      },
      // the PERSISTED mirrors the transaction re-aligned are rebuilt records too —
      // naming them here is what makes the next generation's "already reconciled"
      // verdict auditable rather than merely quiet.
      rebuiltRecords: [
        ...repin.changed,
        ...(recon.value.realignedMirrors ?? []).map(m => m.path),
      ],
    });
    const leaks = findSupersededLeaks(ctx.input, authority);
    const refs = [
      `authority:equipment_reconciliation_audit#${recon.value.auditId}`,
      `provenance:${verdict.canonical.provenance.path}`,
    ];
    const invalidations: ResolutionInvalidation[] = EQUIPMENT_IDENTITY_DEPENDENTS.map(d => ({
      scope: d.scope, target: d.target, reason: d.reason,
      invalidatedBy: `canonical-equipment-selection@v1#${recon.value!.auditId}`, atIso: ctx.nowIso,
    }));

    if (leaks.length) {
      // A superseded value still present in the active input is a framework
      // defect, not a resolution. Refuse the clear and say exactly where.
      return {
        result: 'FAILED',
        clearance: { cleared: false, missing: leaks, reasons: [`a superseded equipment record is still present in the active design: ${leaks.join('; ')}`] },
        patch: { canonicalEquipment: authority },
        sourceQueried: RECON_TABLE_SOURCE,
        sourceRefs: refs,
        retryability: 'RETRYABLE',
        failureReason: `superseded selection leaked into the active snapshot at ${leaks.join('; ')}`,
        confidence: 0,
        auditRef: null,
        invalidations,
        inputsRecorded,
      };
    }

    return {
      result: 'RESOLVED',
      clearance: { cleared: true, missing: [], reasons: [] },
      patch: { canonicalEquipment: authority },
      sourceQueried: RECON_TABLE_SOURCE,
      sourceRefs: refs,
      retryability: 'NON_RETRYABLE',
      failureReason: null,
      confidence: 1,
      auditRef: buildResolutionAuditRef({ resolverId: 'canonical-equipment-selection@v1', sourceRefs: refs, atIso: ctx.nowIso }),
      invalidations,
      inputsRecorded: {
        ...inputsRecorded,
        reconciliationAuditId: recon.value.auditId,
        rebuiltRecordCount: repin.changed.length,
        persistedSupersededCount: persistedDivergent.length,
        mirrorsRealigned: (recon.value.realignedMirrors ?? []).length,
      },
    };
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// AAC WS-2 — MODULE EXACT-DATASHEET BINDING (AUTO_DERIVED half)
// ───────────────────────────────────────────────────────────────────────────
// Runs AFTER the canonical selection (requiredInputs: canonicalEquipment), so it
// evaluates the CANONICAL module, not a stale one. The derived half compares the
// selected wattage against the range the document title already states (the
// comparison audit §2.5 found missing) and the retrieval half attempts the
// registry binding. A covering SERIES sheet is not the exact-wattage BINDING, so
// the requirement legitimately remains — with the attempted retrieval and the
// precisely-named missing document on the record. Actually FETCHING the exact
// datasheet is AAC-3/AAC-5's provider work, behind this same resolver id.
// ═══════════════════════════════════════════════════════════════════════════

export const moduleDatasheetBindingResolver: RequirementResolver = {
  id: 'module-datasheet-binding@v1',
  mode: 'AUTO_DERIVED',
  requirementCodes: ['MODULE-EXACT-DATASHEET-PENDING'],
  requiredInputs: ['canonicalEquipment'],
  produces: ['moduleDatasheetBinding'],
  description: 'Re-runs exact-wattage datasheet resolution against the canonical module: compares the selected wattage to the document range and attempts the registry binding.',
  async run(ctx: ResolverContext): Promise<ResolverOutcome> {
    // The registry lookup is performed per distinct module, through the shared
    // guard, and its result (or exact failure) is recorded on each coverage row.
    // ══ CMDA — ONE ROW IN, ONE CANONICAL VERDICT OUT ═══════════════════════
    // The lookup requests module COVERAGE, not merely a model-shaped match, and
    // it keeps the WHOLE registry row: identity, hash, verification state,
    // verifier and the structured module claims all travel together into
    // `evaluateModuleDatasheetApplicability`. Reducing the row to `{id}` here —
    // which is what this did — is precisely how a document's identity came to be
    // cited while its coverage was never checked.
    const lookups = new Map<string, {
      boundDocumentId: string | null;
      failure: string | null;
      applicability: ModuleDatasheetApplicabilityAuthority;
    }>();
    // ── CMEI — THE IDENTITY IS RESOLVED BY THE ONE ACCESSOR ─────────────────
    // A previous pass asserted here that `applyCanonicalEquipmentToInput` had
    // "already re-pinned" the canonical id onto every string. THAT WAS FALSE:
    // it is called from only two places, both inside DIVERGENT branches of
    // `canonical-equipment-selection@v1` (:582, :683). The ordinary
    // no-divergence branch (:520-534), SKIPPED and OPERATOR_CONFIRMATION all
    // return without re-pinning, so on most real projects `panelId` was written
    // only if the posted body already carried it.
    //
    // `materialiseModuleIdentity` below closes that gap unconditionally, and
    // `resolveFleetModuleIdentities` is the ONE accessor every consumer uses.
    // Keying by the resolved panelId is what makes a re-pin propagate without
    // any subsystem rematching a model string.
    materialiseModuleIdentity(ctx.input);
    const identities = resolveFleetModuleIdentities(ctx.input.system);
    const canonical = ctx.authority.canonicalEquipment?.canonical ?? null;
    for (const [, idn] of identities) {
      const model = idn.model ?? '';
      if (!model) continue;
      const equipmentId = idn.panelId
        ?? (canonical && canonical.model === model ? canonical.catalogId ?? null : null);
      const watts = idn.watts ?? (canonical && canonical.model === model ? canonical.ratedWatts ?? null : null);
      const read = await ctx.safeDbRead(
        `findVerifiedDocument(${MODULE_DATASHEET_DOCUMENT_CLASS}, ${model})`,
        () => findVerifiedDocument({
          documentClass: MODULE_DATASHEET_DOCUMENT_CLASS,
          equipmentId,
          equipmentModel: model,
          selectedWatts: watts,
          requireModuleDatasheetCoverage: true,
        }),
        null,
      );
      // ── SHIPPED CATALOGUE RESOLVES *BELOW* THE OPERATOR ROW ────────────────
      // 2026-08-29 — the pure build path already consults SolarPro's own shipped
      // datasheet catalogue when no governed registry row exists
      // (equipmentProjection.ts). This resolver did not, so it recomputed the
      // verdict from the database alone and OVERWROTE the pure answer: on any
      // deployment with no archived Qcells row — which is every deployment — the
      // async path reopened MODULE-EXACT-DATASHEET-PENDING that the product had
      // already closed with a document it ships.
      //
      // That is the failure mode the racking letter taught us: a fact the
      // product OWNS must not depend on a database row existing. An
      // operator-archived row still wins; the catalogue only answers when there
      // is none. It is projected into the same RegistryDocument shape and graded
      // by the same evaluator, so no predicate is weakened — class, status,
      // archived bytes, SHA-256, governed verification, an explicit coverage
      // claim and the electrical + mechanical specs are all still required.
      //
      // PRECEDENCE IS "NO ROW AT ALL", NOT "NO QUALIFYING ROW". This is the
      // whole difficulty: `findVerifiedDocument` returns null both when the
      // registry is EMPTY and when an operator's row exists but was revoked, is
      // superseded, or does not cover the selected wattage. Falling back on the
      // second case would let a shipped catalogue overturn a deliberate operator
      // refusal — a revoked verification would stop reopening the requirement,
      // which is precisely the check CMDA 12 / 13c exist to make. So the
      // catalogue answers only when NOTHING is on file for this module in any
      // state, exactly as the pure path does (it consults the catalogue only
      // when the canonical authority produced no verdict at all).
      const registryDoc = read.ok ? read.value : null;
      let doc = registryDoc;
      if (!doc) {
        // The probe is an EXACT equality query on `equipment_id` — never a
        // substring test on the model string, which is the construction CMEI
        // bans for module identity and the reason four separate matchers once
        // existed. With no equipment id to scope by we ask whether the class is
        // empty outright: conservative, and it errs toward leaving the
        // requirement open.
        const anyRow = await ctx.safeDbRead(
          `listDocuments(${MODULE_DATASHEET_DOCUMENT_CLASS}${equipmentId ? `, ${equipmentId}` : ''})`,
          () => listDocuments({ documentClass: MODULE_DATASHEET_DOCUMENT_CLASS, equipmentId }),
          [] as Awaited<ReturnType<typeof listDocuments>>,
        );
        // FAIL CLOSED ON AN UNREADABLE REGISTRY. `anyRow.ok === false` means we
        // could not look — not that nothing is there — and substituting the
        // catalogue on that basis would let a database outage overturn a
        // revoked verification. Only a SUCCESSFUL read returning no row
        // licenses the shipped document to answer.
        const provenEmpty = anyRow.ok && anyRow.value.length === 0;
        if (provenEmpty) {
          doc = toRegistryDocumentFromCatalogue(findManufacturerDatasheet({ equipmentId, model }));
        }
      }
      const applicability = evaluateModuleDatasheetApplicability({
        selected: {
          equipmentId,
          manufacturer: canonical && canonical.model === model ? canonical.manufacturer ?? null : null,
          model,
          watts,
        },
        document: doc,
      });
      lookups.set(model, {
        boundDocumentId: doc ? doc.id : null,
        failure: read.ok
          ? (applicability.clears ? null : applicability.refusals.join(' · ') || applicability.basis)
          : read.error,
        applicability,
      });
    }

    const binding = evaluateModuleDatasheetBinding(ctx.input, ({ model }) =>
      lookups.get(model) ?? {
        boundDocumentId: null,
        failure: 'no lookup performed for this model',
        applicability: null,
      });

    // D8 — the bound rule is not restated here; it lives in datasheetBinding.
    const pending = binding.modules.filter(m => !moduleSourceIsEstablished(m));
    const inputsRecorded: Record<string, string | number | boolean | null> = {
      canonicalModule: ctx.authority.canonicalEquipment?.canonical?.model ?? null,
      moduleCount: binding.modules.length,
      boundCount: binding.boundModels.length,
      rangeCoveredCount: binding.modules.filter(m => m.state === 'RANGE-COVERED').length,
      rangeNotCoveredCount: binding.modules.filter(m => m.state === 'RANGE-NOT-COVERED').length,
    };

    if (!binding.modules.length) {
      return {
        result: 'SKIPPED',
        clearance: { cleared: false, missing: ['a module model on the posted fleet'], reasons: [binding.basis] },
        patch: { moduleDatasheetBinding: binding },
        sourceQueried: `${DOC_REGISTRY_SOURCE} · manufacturer-assets-db`,
        retryability: 'REQUIRES_INPUT',
        failureReason: 'no module model is present in the fleet — datasheet coverage cannot be evaluated',
        confidence: null,
        inputsRecorded,
      };
    }

    if (binding.allBound) {
      // D8 — every ref is a REGISTRY document id. The old fallback minted
      // `document:asset#<model>` for a module whose only evidence was an
      // unhashed static asset, and that ref went into a resolution audit ref —
      // a citation naming something that cannot be cited. `allBound` now
      // guarantees a bound document id for every module, so the fallback is
      // unreachable; it is removed rather than left as an invitation.
      const refs = binding.modules.map(m => `document:${m.registryLookup.boundDocumentId}`);
      return {
        result: 'RESOLVED',
        clearance: { cleared: true, missing: [], reasons: [] },
        patch: { moduleDatasheetBinding: binding },
        sourceQueried: `${DOC_REGISTRY_SOURCE} · manufacturer-assets-db`,
        sourceRefs: refs,
        retryability: 'NON_RETRYABLE',
        failureReason: null,
        confidence: 1,
        auditRef: buildResolutionAuditRef({ resolverId: 'module-datasheet-binding@v1', sourceRefs: refs, atIso: ctx.nowIso }),
        inputsRecorded,
      };
    }

    return {
      result: 'FAILED',
      clearance: {
        cleared: false,
        missing: pending.map(m => m.missingDocument ?? `exact-wattage datasheet for ${m.moduleModel}`),
        reasons: pending.map(m => `${m.moduleModel}: ${m.basis}`),
      },
      patch: { moduleDatasheetBinding: binding },
      sourceQueried: `${DOC_REGISTRY_SOURCE} · manufacturer-assets-db`,
      // Every attempt is on the record, including the ones that found nothing.
      sourceRefs: pending.map(m => `provenance:module-datasheet-lookup#${m.moduleModel}:${m.state}`),
      retryability: 'RETRYABLE',
      failureReason: pending
        .map(m => `${m.moduleModel}: ${m.registryLookup.failure ?? 'no binding'} (${m.state})`)
        .join(' · '),
      operatorAction: null,
      confidence: 0,
      auditRef: null,     // a covering SERIES sheet is not the exact-wattage binding
      inputsRecorded,
    };
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// AAC WS-6 — DESIGNER / PERSONNEL OF RECORD (AUTO_DERIVED)
// ───────────────────────────────────────────────────────────────────────────
// The designer is a CONFIGURATION fact. Asking for it on every project is the
// exact violation the mandate names. This resolver reads the personnel store
// (migration 115), resolves the DESIGNER role (project override > org default >
// user default), and populates project.designer — which is the single field every
// downstream consumer already reads (cover DESIGNER row, CERT designer field +
// revision "by", PV-4C installed-by, projectAuthority.designer, the SLD adapter).
//
// HARD BOUNDARY, enforced by AUTO_POPULATABLE_ROLES and asserted by tests: it
// populates designer / preparer / reviewer ONLY. It never writes an engineer of
// record, a licence, a signature, a seal or a digest-bound approval, and it never
// substitutes a vendor name for a missing designer.
// ═══════════════════════════════════════════════════════════════════════════

const PERSONNEL_STORE_SOURCE = 'personnel_roles + project_personnel_assignments (migration 115)';
const PERSONNEL_MIGRATION_ACTION =
  'Run migration 115 through the governed console (Admin → System Tools → Migrations), then set the designer in System Config (Admin → Personnel).';
const PERSONNEL_CONFIG_ACTION =
  'Set the designer of record once in System Config (Admin → Personnel) — it then populates every project automatically.';

export const projectPersonnelResolver: RequirementResolver = {
  id: 'project-personnel-designer@v1',
  mode: 'AUTO_DERIVED',
  requirementCodes: ['DESIGNER-OF-RECORD-MISSING'],
  requiredInputs: [],
  produces: ['projectPersonnel'],
  description: 'Resolves the configured personnel roles (designer / preparer / reviewer) and populates the project record\'s designer — never an engineer of record, licence, signature or seal.',
  async run(ctx: ResolverContext): Promise<ResolverOutcome> {
    const proj = ctx.input.project as Record<string, unknown>;
    const typed = typeof proj.designer === 'string' ? proj.designer.trim() : '';

    const read = ctx.projectId
      ? await ctx.safeDbRead(
          'resolveProjectPersonnel',
          () => resolveProjectPersonnel(ctx.projectId as string, typed || null),
          null as ProjectPersonnelAuthority | null,
        )
      : { value: null as ProjectPersonnelAuthority | null, ok: false, error: 'no projectId on the permit input — the personnel store cannot be scoped' };

    const authority = read.value ?? unavailablePersonnelAuthority(ctx.projectId, read.error ?? 'personnel store unavailable');
    const designer = authority.roles.designer ?? null;
    const inputsRecorded: Record<string, string | number | boolean | null> = {
      projectId: ctx.projectId,
      projectRecordDesigner: typed || null,
      storeReadable: read.ok,
      resolvedDesignerSource: designer?.source ?? null,
      orgId: authority.scope.orgId,
      populatedRoles: authority.populatedRoles.join(', ') || null,
    };

    if (designer) {
      // PROPAGATION: one write, every consumer. Only the DESIGNER role is
      // written onto the project record; the licensed roles are never touched.
      proj.designer = designer.personName;
      const refs = [
        `authority:personnel.designer#${designer.recordId ?? 'project-record'}`,
        `provenance:${designer.path}`,
      ];
      return {
        result: 'RESOLVED',
        clearance: { cleared: true, missing: [], reasons: [] },
        patch: { projectPersonnel: authority },
        sourceQueried: designer.source === 'project-record' ? 'permit-input#project.designer' : PERSONNEL_STORE_SOURCE,
        sourceRefs: refs,
        retryability: 'NON_RETRYABLE',
        failureReason: null,
        confidence: 1,
        auditRef: buildResolutionAuditRef({ resolverId: 'project-personnel-designer@v1', sourceRefs: refs, atIso: ctx.nowIso }),
        invalidations: designer.source === 'project-record' ? [] : [
          { scope: 'snapshot', target: 'projectAuthority.designer / title blocks / CERT', reason: `designer of record populated from configuration (${designer.source})`, invalidatedBy: 'project-personnel-designer@v1', atIso: ctx.nowIso },
        ],
        inputsRecorded: { ...inputsRecorded, designerName: designer.personName, designerRoleLabel: PERSONNEL_ROLE_LABEL.designer },
      };
    }

    // No configured designer. Two DIFFERENT facts, reported differently.
    const storeAbsent = authority.storeUnavailable;
    return {
      result: 'FAILED',
      clearance: {
        cleared: false,
        missing: [storeAbsent ? PERSONNEL_STORE_SOURCE : 'personnel_roles: a default row for role \'designer\' in this scope'],
        reasons: [storeAbsent
          ? 'the personnel-roles store could not be read — no designer of record is established, and no vendor default may be substituted'
          : 'no designer is configured for this organisation / user, and none is assigned to this project'],
      },
      patch: { projectPersonnel: authority },
      sourceQueried: PERSONNEL_STORE_SOURCE,
      retryability: storeAbsent ? 'RETRYABLE' : 'REQUIRES_INPUT',
      failureReason: storeAbsent
        ? (authority.storeError ?? 'personnel store unavailable')
        : 'no configured designer for this scope (roster carries no active default for the designer role)',
      operatorAction: storeAbsent ? PERSONNEL_MIGRATION_ACTION : PERSONNEL_CONFIG_ACTION,
      confidence: 0,
      auditRef: null,
      inputsRecorded,
    };
  },
};

/** The production resolver set, in dependency order. */
export const PRODUCTION_RESOLVERS: readonly RequirementResolver[] = [
  projectAuthorityKeyResolver,
  digestInvalidationLedgerResolver,
  // WS-3 — the legal identity is retrieved FIRST among the retrieval resolvers:
  // the normalised county + boundary + coordinates it establishes are what the
  // code-adoption and hazard retrievals are keyed on.
  projectAuthorityResolver,
  codeAuthorityResolver,
  // WS-2 runs FIRST among the domain resolvers: the canonical identity is the
  // input every downstream record rebuilds from (audit §2.4 "must run FIRST").
  canonicalEquipmentResolver,
  moduleDatasheetBindingResolver,
  projectPersonnelResolver,
  rackingCapacityDocumentResolver,
  framingCapacityDocumentResolver,
  climateHazardDocumentResolver,
  // WS-4 — the LIVE hazard retrieval runs AFTER the archived-document lookup: an
  // archived, currency-reviewed document outranks a fresh retrieval and is also
  // the durable cache, so an archived site is never re-retrieved.
  environmentalAuthorityResolver,
  cableExtensionSolutionsResolver,
  // ── AAC WS-8 — STRUCTURAL SEPARATION. Ordered AFTER the registry lookups
  //    (racking-capacity-document / framing-capacity-document) so an already
  //    archived, verified document is the durable cache and is never re-fetched,
  //    and after the canonical equipment resolver so the rail trace reasons over
  //    the canonical mount. ────────────────────────────────────────────────
  rackingAssemblySelectionResolver,
  engineeringReviewRecordResolver,
  rackingDocumentRetrievalResolver,
  framingCapacityRetrievalResolver,
  // ── WS-5 — FIELD ROUTE MEASUREMENTS. Last among the AUTO_DERIVED set: it
  //    reads a store nothing else in the lifecycle writes, and what it produces
  //    is consumed by the pure build (route length authority) rather than by
  //    another resolver, so nothing depends on it running earlier.
  fieldRouteMeasurementResolver,
];
