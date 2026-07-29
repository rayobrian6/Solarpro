// lib/documents/registry.ts
// W4 §8 — Canonical manufacturer/authority document registry: DB CRUD + the
// resolver that engines call to obtain a VERIFIED document covering the exact
// equipment + installation condition.
//
// The single rule: engineering values may cite ONLY a document that is
// verification_state 'verified' AND status 'current' AND whose applicability
// covers the exact selected equipment (+ installation condition where required).
// findVerifiedDocument enforces this; anything else resolves to null.

import { getDbReady } from '@/lib/db/core';
import { randomUUID } from 'node:crypto';
import {
  type RegistryDocument,
  type ExtractedEngineeringClaims,
  type DocumentResolverCriteria,
  type DocumentClass,
  isDocumentClass,
  isVerificationState,
  isDocumentStatus,
} from './types';
import type { RackingCapacityDocumentEvidence } from '@/lib/permit/snapshot/rackingAssembly';
import type { FramingCapacityDocumentEvidence } from '@/lib/permit/snapshot/framingAuthority';
import type { CableExtensionDocumentEvidence, CableExtensionSolution } from '@/lib/permit/snapshot/types';
import type { EnvironmentalLoadSourceEvidence } from '@/lib/permit/snapshot/environmentalAuthority';

// ── Row ⇄ record mapping ──────────────────────────────────────────────────────

function parseClaims(raw: unknown): ExtractedEngineeringClaims | null {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw as ExtractedEngineeringClaims;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as ExtractedEngineeringClaims; } catch { return null; }
  }
  return null;
}

function rowToDocument(r: any): RegistryDocument {
  return {
    id: r.id,
    documentClass: r.document_class,
    manufacturerOrIssuer: r.manufacturer_or_issuer,
    equipmentId: r.equipment_id ?? null,
    equipmentModelApplicability: r.equipment_model_applicability ?? null,
    title: r.title,
    revision: r.revision ?? null,
    documentDate: r.document_date ?? null,
    archivedFileIdentity: r.archived_file_identity ?? null,
    archivedInRepo: !!r.archived_in_repo,
    sha256: r.sha256 ?? null,
    source: r.source ?? null,
    jurisdictionBoundary: r.jurisdiction_boundary ?? null,
    applicabilityNotes: r.applicability_notes ?? null,
    status: r.status,
    supersedesId: r.supersedes_id ?? null,
    supersededById: r.superseded_by_id ?? null,
    extractedClaims: parseClaims(r.extracted_claims),
    verificationState: r.verification_state,
    reviewer: r.reviewer ?? null,
    verifiedBy: r.verified_by ?? null,
    verifiedAt: r.verified_at ?? null,
    verificationNotes: r.verification_notes ?? null,
    createdBy: r.created_by ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ── Input validation (pure) ───────────────────────────────────────────────────

export interface DocumentInput {
  id?: string;
  documentClass: string;
  manufacturerOrIssuer: string;
  equipmentId?: string | null;
  equipmentModelApplicability?: string | null;
  title: string;
  revision?: string | null;
  documentDate?: string | null;
  archivedFileIdentity?: string | null;
  archivedInRepo?: boolean;
  sha256?: string | null;
  source?: string | null;
  jurisdictionBoundary?: string | null;
  applicabilityNotes?: string | null;
  status?: string;
  supersedesId?: string | null;
  extractedClaims?: ExtractedEngineeringClaims | null;
  verificationState?: string;
  reviewer?: string | null;
  createdBy?: string | null;
}

export interface ValidationResult { ok: boolean; error?: string; }

const SHA256_RE = /^[0-9a-f]{64}$/i;

/** Validate a document input. Pure — no DB. */
export function validateDocumentInput(input: DocumentInput): ValidationResult {
  if (!input.documentClass || !isDocumentClass(input.documentClass)) {
    return { ok: false, error: `documentClass must be one of the §8 classes; got '${input.documentClass}'` };
  }
  if (!input.manufacturerOrIssuer || !input.manufacturerOrIssuer.trim()) {
    return { ok: false, error: 'manufacturerOrIssuer is required' };
  }
  if (!input.title || !input.title.trim()) return { ok: false, error: 'title is required' };
  if (input.status && !isDocumentStatus(input.status)) {
    return { ok: false, error: `status must be current|superseded|draft|withdrawn; got '${input.status}'` };
  }
  if (input.verificationState && !isVerificationState(input.verificationState)) {
    return { ok: false, error: `verificationState must be unverified|in_review|verified|rejected; got '${input.verificationState}'` };
  }
  // Integrity: an archived document MUST carry a SHA-256; a SHA-256 must be valid.
  if (input.archivedInRepo && !input.sha256) {
    return { ok: false, error: 'archivedInRepo=true requires a sha256 of the archived file' };
  }
  if (input.sha256 && !SHA256_RE.test(input.sha256)) {
    return { ok: false, error: 'sha256 must be a 64-char hex digest' };
  }
  // A document cannot be verified without being archived + hashed (no verifying a phantom).
  if (input.verificationState === 'verified' && !(input.archivedInRepo && input.sha256)) {
    return { ok: false, error: 'a document cannot be verified unless it is archived with a sha256' };
  }
  return { ok: true };
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

/** Insert a document (draft/unverified by default). Returns the created record. */
export async function createDocument(input: DocumentInput): Promise<RegistryDocument> {
  const v = validateDocumentInput(input);
  if (!v.ok) throw new Error(v.error);
  const sql = await getDbReady();
  const id = input.id ?? randomUUID();
  const claimsJson = input.extractedClaims ? JSON.stringify(input.extractedClaims) : null;
  const [row] = await sql`
    INSERT INTO manufacturer_document_registry (
      id, document_class, manufacturer_or_issuer, equipment_id, equipment_model_applicability,
      title, revision, document_date, archived_file_identity, archived_in_repo, sha256,
      source, jurisdiction_boundary, applicability_notes, status, supersedes_id,
      extracted_claims, verification_state, reviewer, created_by
    ) VALUES (
      ${id}, ${input.documentClass}, ${input.manufacturerOrIssuer}, ${input.equipmentId ?? null},
      ${input.equipmentModelApplicability ?? null}, ${input.title}, ${input.revision ?? null},
      ${input.documentDate ?? null}, ${input.archivedFileIdentity ?? null},
      ${input.archivedInRepo ?? false}, ${input.sha256 ?? null}, ${input.source ?? null},
      ${input.jurisdictionBoundary ?? null}, ${input.applicabilityNotes ?? null},
      ${input.status ?? 'draft'}, ${input.supersedesId ?? null}, ${claimsJson},
      ${input.verificationState ?? 'unverified'}, ${input.reviewer ?? null}, ${input.createdBy ?? null}
    )
    RETURNING *
  `;
  // Mark a superseded predecessor.
  if (input.supersedesId) {
    await sql`
      UPDATE manufacturer_document_registry
      SET status = 'superseded', superseded_by_id = ${id}, updated_at = now()
      WHERE id = ${input.supersedesId}
    `;
  }
  return rowToDocument(row);
}

export async function listDocuments(filter?: {
  documentClass?: string | null;
  equipmentId?: string | null;
  status?: string | null;
  verificationState?: string | null;
}): Promise<RegistryDocument[]> {
  const sql = await getDbReady();
  const dc = filter?.documentClass ?? null;
  const eq = filter?.equipmentId ?? null;
  const st = filter?.status ?? null;
  const vs = filter?.verificationState ?? null;
  const rows = await sql`
    SELECT * FROM manufacturer_document_registry
    WHERE (${dc}::text IS NULL OR document_class = ${dc})
      AND (${eq}::text IS NULL OR equipment_id = ${eq})
      AND (${st}::text IS NULL OR status = ${st})
      AND (${vs}::text IS NULL OR verification_state = ${vs})
    ORDER BY document_class, manufacturer_or_issuer, created_at DESC
  `;
  return rows.map(rowToDocument);
}

export async function getDocument(id: string): Promise<RegistryDocument | null> {
  const sql = await getDbReady();
  const [row] = await sql`SELECT * FROM manufacturer_document_registry WHERE id = ${id} LIMIT 1`;
  return row ? rowToDocument(row) : null;
}

/** Set verification state. Verifying requires the doc already be archived+hashed. */
export async function setVerification(
  id: string,
  verificationState: string,
  verifiedBy: string,
  notes?: string | null,
): Promise<RegistryDocument | null> {
  if (!isVerificationState(verificationState)) throw new Error(`invalid verificationState '${verificationState}'`);
  const sql = await getDbReady();
  const existing = await getDocument(id);
  if (!existing) return null;
  if (verificationState === 'verified' && !(existing.archivedInRepo && existing.sha256)) {
    throw new Error('cannot verify a document that is not archived with a sha256');
  }
  const verifiedAt = verificationState === 'verified' ? new Date().toISOString() : null;
  const [row] = await sql`
    UPDATE manufacturer_document_registry
    SET verification_state = ${verificationState},
        verified_by = ${verificationState === 'verified' ? verifiedBy : null},
        verified_at = ${verifiedAt},
        verification_notes = ${notes ?? null},
        updated_at = now()
    WHERE id = ${id}
    RETURNING *
  `;
  return row ? rowToDocument(row) : null;
}

// ── Resolver ────────────────────────────────────────────────────────────────

/**
 * Return the ONE verified, current document that covers the requested equipment
 * (+ optional installation condition), or null. Engines call this before citing
 * any manufacturer/authority engineering value.
 *
 * Enforcement is at the DB (verified + current) AND in code (exact equipment
 * match, structural-claim requirement). When multiple qualify, the most recently
 * created wins — but a plain timestamp NEVER silently overrides equipment/claim
 * mismatch; those are filtered out first.
 */
export async function findVerifiedDocument(
  criteria: DocumentResolverCriteria,
): Promise<RegistryDocument | null> {
  const sql = await getDbReady();
  const classes = Array.isArray(criteria.documentClass) ? criteria.documentClass : [criteria.documentClass];
  const eqId = criteria.equipmentId ?? null;
  const model = criteria.equipmentModel ?? null;
  const rows = await sql`
    SELECT * FROM manufacturer_document_registry
    WHERE document_class = ANY(${classes as string[]}::text[])
      AND status = 'current'
      AND verification_state = 'verified'
      AND (
        (${eqId}::text IS NOT NULL AND equipment_id = ${eqId})
        OR (${model}::text IS NOT NULL AND equipment_model_applicability IS NOT NULL
            AND lower(equipment_model_applicability) LIKE '%' || lower(${model}) || '%')
      )
    ORDER BY created_at DESC
  `;
  const docs = rows.map(rowToDocument);
  return pickVerifiedDocument(docs, criteria);
}

/** PURE candidate filter — testable without a DB. Applies the exact-equipment
 *  and structural-claim requirements the SQL cannot fully express. */
export function pickVerifiedDocument(
  candidates: RegistryDocument[],
  criteria: DocumentResolverCriteria,
): RegistryDocument | null {
  const classes = Array.isArray(criteria.documentClass) ? criteria.documentClass : [criteria.documentClass];
  const eqId = criteria.equipmentId ?? null;
  const model = (criteria.equipmentModel ?? '').trim().toLowerCase();
  const wantStructural = criteria.requireStructuralCapacity === true;
  const jur = (criteria.jurisdiction ?? '').trim().toLowerCase();

  const matches = candidates.filter(d => {
    if (!(classes as string[]).includes(d.documentClass)) return false;
    if (d.status !== 'current') return false;
    if (d.verificationState !== 'verified') return false;
    // Must be archived + hashed to be citable.
    if (!(d.archivedInRepo && d.sha256)) return false;
    // Exact equipment coverage: by id OR by model substring.
    const idHit = !!eqId && d.equipmentId === eqId;
    const modelHit = !!model && !!d.equipmentModelApplicability
      && d.equipmentModelApplicability.toLowerCase().includes(model);
    if (!idHit && !modelHit) return false;
    if (wantStructural) {
      const s = d.extractedClaims?.structural;
      if (!s || s.hasStructuralCapacityClaim !== true) return false;
      if (!(s.asdAllowableLbs != null && s.asdAllowableLbs > 0)) return false;
    }
    // FRAMING-AUTHORITY GATE — require a framing-capacity claim + exact project
    // applicability. A generic BCSI table (no framing claim) never resolves here.
    if (criteria.requireFramingCapacity === true) {
      const fr = d.extractedClaims?.framing;
      if (!fr || fr.hasFramingCapacityClaim !== true) return false;
      const key = (criteria.projectApplicabilityKey ?? '').trim().toLowerCase();
      const applic = (fr.projectApplicability ?? d.applicabilityNotes ?? '').toLowerCase();
      if (key) { if (!applic.includes(key)) return false; }
      else if (!applic) return false;   // must carry explicit project applicability
    }
    // BAR §2 — require a climate-hazard claim covering wind + snow + exposure/risk
    // for the exact project, with an explicit currency review. A generic
    // brochure/table with no per-project extract never resolves here.
    if (criteria.requireEnvironmentalHazard === true) {
      const en = d.extractedClaims?.environmental;
      if (!en) return false;
      if (!(en.coversWindSpeed === true && en.coversSnowLoad === true && en.coversExposureRisk === true)) return false;
      if (!(en.windSpeedMph != null && en.groundSnowPsf != null)) return false;
      if (!en.currencyConfirmedAtIso) return false;
      const key = (criteria.projectApplicabilityKey ?? '').trim().toLowerCase();
      const applic = (en.projectApplicability ?? d.applicabilityNotes ?? '').toLowerCase();
      if (key) { if (!applic.includes(key)) return false; }
      else if (!applic) return false;
    }
    if (jur) {
      const dj = (d.extractedClaims?.structural?.jurisdiction ?? d.jurisdictionBoundary ?? '').toLowerCase();
      if (!dj.includes(jur)) return false;
    }
    return true;
  });
  if (matches.length === 0) return null;
  // Newest created wins among genuine matches.
  matches.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return matches[0];
}

// ── Adapter: registry document → RT-MINI clearance evidence ───────────────────

/**
 * Convert a resolved registry document into the evidence shape consumed by
 * lib/permit/snapshot/rackingAssembly.evaluateRackingCapacityClearance. Returns
 * null when the document is missing structural claims (so a non-structural doc
 * can never accidentally clear a structural blocker).
 */
export function toRackingClearanceEvidence(
  doc: RegistryDocument | null | undefined,
): RackingCapacityDocumentEvidence | null {
  if (!doc) return null;
  const s = doc.extractedClaims?.structural;
  return {
    documentId: doc.id,
    documentClass: doc.documentClass,
    documentIdentity: doc.title,
    verificationState: doc.verificationState,
    status: doc.status,
    archivedInRepo: doc.archivedInRepo,
    sha256: doc.sha256,
    hasStructuralCapacityClaim: s?.hasStructuralCapacityClaim === true,
    exactModel: s?.exactModel ?? doc.equipmentModelApplicability ?? null,
    fastenerModel: s?.fastenerModel ?? null,
    fastenerCount: s?.fastenerCount ?? null,
    substrate: s?.substrate ?? null,
    rafterDeckCondition: s?.rafterDeckCondition ?? null,
    embedmentIn: s?.embedmentIn ?? null,
    railLFootAssembly: s?.railLFootAssembly ?? null,
    loadBasis: s?.loadBasis ?? null,
    adjustmentFactors: s?.adjustmentFactors ?? null,
    jurisdiction: s?.jurisdiction ?? doc.jurisdictionBoundary ?? null,
    asdAllowableLbs: s?.asdAllowableLbs ?? null,
    revisionOrDate: doc.revision ?? doc.documentDate ?? null,
  };
}

/**
 * High-level: resolve the verified structural document that clears the RT-MINI
 * racking blockers for a given mount, or null. This is what the closer wires
 * into build.ts (async) and passes to buildRackingAssembly via
 * { capacityDocument }.
 */
export async function resolveRackingCapacityDocument(args: {
  equipmentId?: string | null;
  mountModel?: string | null;
  jurisdiction?: string | null;
}): Promise<RackingCapacityDocumentEvidence | null> {
  const doc = await findVerifiedDocument({
    documentClass: ['structural_pe_letter', 'evaluation_report'],
    equipmentId: args.equipmentId ?? null,
    equipmentModel: args.mountModel ?? null,
    jurisdiction: args.jurisdiction ?? null,
    requireStructuralCapacity: true,
  });
  return toRackingClearanceEvidence(doc);
}

// ── Adapter: registry document → FRAMING-AUTHORITY capacity evidence ──────────

/**
 * Convert a resolved registry document into the evidence shape consumed by
 * lib/permit/snapshot/framingAuthority.resolveFramingCapacityAuthority. Returns
 * null when the document carries no framing capacity claim (so a non-framing doc
 * can never accidentally clear the FRAMING-AUTHORITY-UNVERIFIED blocker).
 */
export function toFramingClearanceEvidence(
  doc: RegistryDocument | null | undefined,
): FramingCapacityDocumentEvidence | null {
  if (!doc) return null;
  const f = doc.extractedClaims?.framing;
  return {
    documentId: doc.id,
    documentClass: doc.documentClass,
    documentIdentity: doc.title,
    sha256: doc.sha256,
    verificationState: doc.verificationState,
    status: doc.status,
    archivedInRepo: doc.archivedInRepo,
    issuer: doc.manufacturerOrIssuer ?? null,
    revisionOrDate: doc.revision ?? doc.documentDate ?? null,
    projectApplicability: f?.projectApplicability ?? doc.applicabilityNotes ?? doc.equipmentModelApplicability ?? null,
    memberOrTrussIdentity: f?.memberOrTrussIdentity ?? null,
    designLoads: f?.designLoads ?? null,
    allowableCapacities: f?.allowableCapacities ?? null,
    bearingConditions: f?.bearingConditions ?? null,
    deflectionLimits: f?.deflectionLimits ?? null,
    engineerOrManufacturerVerification: f?.engineerOrManufacturerVerification ?? null,
    hasFramingCapacityClaim: f?.hasFramingCapacityClaim === true,
  };
}

/**
 * High-level: resolve the verified, project-applicable framing-capacity document
 * (truss design drawing / manufacturer structural calc / stamped analysis) that
 * clears the FRAMING-AUTHORITY-UNVERIFIED blocker, or null. This is what
 * generatePermit wires in (async) and passes to buildStructuralAuthority via
 * { framingCapacityDocument }.
 */
export async function resolveFramingCapacityDocument(args: {
  equipmentId?: string | null;
  projectApplicabilityKey?: string | null;
  jurisdiction?: string | null;
}): Promise<FramingCapacityDocumentEvidence | null> {
  const doc = await findVerifiedDocument({
    documentClass: ['truss_design_drawing', 'manufacturer_structural_calc', 'stamped_structural_analysis'],
    equipmentId: args.equipmentId ?? null,
    equipmentModel: args.projectApplicabilityKey ?? null,
    jurisdiction: args.jurisdiction ?? null,
    requireFramingCapacity: true,
    projectApplicabilityKey: args.projectApplicabilityKey ?? null,
  });
  return toFramingClearanceEvidence(doc);
}

// ── Adapter: registry document → BAR §2 CLIMATE-HAZARD source evidence ─────────

/**
 * Convert a resolved climate-hazard registry document into the
 * EnvironmentalLoadSourceEvidence shape consumed by
 * buildEnvironmentalLoadAuthority. Returns null for a missing document so
 * ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED keeps firing (fail-closed). Every
 * value comes from the DOCUMENT's own extracted claims — never from an operator
 * entry — so a resolved-but-incomplete extract still evaluates to unverified in
 * environmentalSourceVerified().
 */
export function toEnvironmentalLoadSourceEvidence(
  doc: RegistryDocument | null | undefined,
): EnvironmentalLoadSourceEvidence | null {
  if (!doc) return null;
  const en = doc.extractedClaims?.environmental ?? {};
  const lat = en.lat ?? null, lng = en.lng ?? null;
  // Post-AAC seismic repair — the archived retrieval writes its seismic results
  // into the `values` claim bag (toRegistryClaims), not the `environmental` one.
  // Read both so the verified archived document can source the canonical
  // seismic result; never invent a value when neither bag carries one.
  const vals = ((doc.extractedClaims as unknown as { values?: Record<string, unknown> })?.values ?? {}) as {
    seismicSdc?: string | null; seismicSs?: number | null; seismicS1?: number | null; siteClass?: string | null;
  };
  const _seisSdc = (en as { seismicSdc?: string | null }).seismicSdc ?? vals.seismicSdc ?? null;
  return {
    documentId: doc.id,
    dataset: en.dataset ?? doc.manufacturerOrIssuer ?? doc.title ?? null,
    versionOrDate: doc.revision ?? doc.documentDate ?? null,
    verificationState: doc.verificationState,
    archivedInRepo: doc.archivedInRepo,
    sha256: doc.sha256,
    coversWindSpeed: en.coversWindSpeed === true,
    coversSnowLoad: en.coversSnowLoad === true,
    coversExposureRisk: en.coversExposureRisk === true,
    coversSeismic: _seisSdc != null && _seisSdc !== '',
    seismicSdc: _seisSdc,
    seismicSs: (en as { seismicSs?: number | null }).seismicSs ?? vals.seismicSs ?? null,
    seismicS1: (en as { seismicS1?: number | null }).seismicS1 ?? vals.seismicS1 ?? null,
    seismicSiteClass: (en as { seismicSiteClass?: string | null }).seismicSiteClass ?? vals.siteClass ?? null,
    windSpeedMph: en.windSpeedMph ?? null,
    groundSnowPsf: en.groundSnowPsf ?? null,
    exposureCategory: en.exposureCategory ?? null,
    riskCategory: en.riskCategory ?? null,
    coordinates: (lat != null || lng != null) ? { lat, lng } : null,
    addressUsed: en.addressUsed ?? null,
    projectApplicability: en.projectApplicability ?? doc.applicabilityNotes ?? null,
    lookupTimestampIso: en.lookupTimestampIso ?? null,
    currencyConfirmedAtIso: en.currencyConfirmedAtIso ?? null,
  };
}

/**
 * BAR §2 — resolve the VERIFIED, project-applicable climate-hazard source (ASCE 7
 * Hazard-Tool report / AHJ climate ordinance extract) that can construct a
 * VERIFIED EnvironmentalLoadAuthority, or null. This is what the async caller
 * (resolveSnapshotAuthorityInputs) wires in and threads to
 * buildPermitDesignSnapshot via { environmentalSource }.
 *
 * Nothing is archived today, so on live this resolves to null ⇒ operator-entered
 * wind/snow stay OBSERVATION/OVERRIDE ⇒ ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED.
 */
export async function resolveClimateHazardDocument(args: {
  projectApplicabilityKey?: string | null;
  jurisdiction?: string | null;
}): Promise<EnvironmentalLoadSourceEvidence | null> {
  const doc = await findVerifiedDocument({
    documentClass: ['climate_hazard_dataset'],
    equipmentId: null,
    equipmentModel: args.projectApplicabilityKey ?? null,
    jurisdiction: args.jurisdiction ?? null,
    requireEnvironmentalHazard: true,
    projectApplicabilityKey: args.projectApplicabilityKey ?? null,
  });
  return toEnvironmentalLoadSourceEvidence(doc);
}

// ── Adapter: registry document → §Q CABLE-EXTENSION document evidence ──────────

/** Convert a resolved registry document into the CableExtensionDocumentEvidence
 *  shape consumed by evaluateCableExtensionClearance. Returns null for a missing
 *  document (so nothing clears the Q-Cable procurement blocker by accident). */
export function toCableExtensionEvidence(
  doc: RegistryDocument | null | undefined,
  coversExtensionSku?: string | null,
): CableExtensionDocumentEvidence | null {
  if (!doc) return null;
  const v = (doc.extractedClaims?.values ?? {}) as Record<string, unknown>;
  return {
    documentId: doc.id,
    documentClass: doc.documentClass,
    documentIdentity: doc.title,
    verificationState: doc.verificationState,
    status: doc.status,
    archivedInRepo: doc.archivedInRepo,
    sha256: doc.sha256,
    coversExtensionSku: (typeof v.coversExtensionSku === 'string' ? v.coversExtensionSku : null)
      ?? coversExtensionSku ?? doc.equipmentModelApplicability ?? null,
    compatibleSystem: (typeof v.compatibleSystem === 'string' ? v.compatibleSystem : null)
      ?? doc.applicabilityNotes ?? null,
    revisionOrDate: doc.revision ?? doc.documentDate ?? null,
  };
}

/**
 * §Q — resolve the canonical Q-Cable procurement-deficit resolution solutions for
 * a design. A solution is emitted ONLY when an operator-selected extension product
 * SKU is backed by a VERIFIED, current, archived manufacturer document (combiner /
 * UL-listing document class). No selection ⇒ empty ⇒ the QCABLE-PROCUREMENT-
 * INSUFFICIENT blocker stays firing on a short design. Fail-soft on DB error.
 *
 * NOTE: this resolves the DOCUMENT authority only. The remaining clearance
 * conditions (quantity/location, drawings/schedules/BOM representation, VD/install
 * recalculation, added-length ≥ deficit) come from the operator selection record;
 * with none wired today the returned array is empty. evaluateCableExtensionClearance
 * (pure) is the single gate that decides whether a solution actually clears.
 */
export async function resolveCableExtensionSolutions(args: {
  selectedExtensionSkus?: string[] | null;
  jurisdiction?: string | null;
  /** AAC WS-5 — the operator SELECTION record per SKU (quantity, placement,
   *  representation, VD recalculation, added length). Absent fields are carried
   *  through UNSET so `evaluateCableExtensionClearance` names exactly which
   *  condition is missing — a partially-complete solution is REPORTED, never
   *  fabricated into a clearing one. */
  selections?: Record<string, CableExtensionSelectionRecord> | null;
}): Promise<CableExtensionSolution[]> {
  const skus = (args.selectedExtensionSkus ?? []).filter(s => typeof s === 'string' && s.trim().length > 0);
  if (skus.length === 0) return [];   // no operator selection ⇒ no solution
  const out: CableExtensionSolution[] = [];
  for (const sku of skus) {
    const doc = await findVerifiedDocument({
      documentClass: ['combiner_documentation', 'ul_listing'],
      equipmentId: null,
      equipmentModel: sku,
      jurisdiction: args.jurisdiction ?? null,
    });
    // AAC WS-5 / audit §7.2 — THE NEVER-PUSHES DEFECT. This loop used to
    // `continue` on a null document and then fall out of the function without a
    // single `out.push(...)` on ANY path, so it returned `[]` under all inputs
    // and the blocker it gates was unclearable through every wired path. The
    // registry-backed solution is now CONSTRUCTED here from the resolved
    // document + the operator selection record, with every unmet condition left
    // FALSE/NULL so the pure evaluator (evaluateCableExtensionClearance) is
    // still the single gate that decides whether it clears anything.
    if (!doc) continue;
    const sel = args.selections?.[sku] ?? null;
    out.push({
      solutionId: `ext-${sku}`,
      kind: sel?.kind ?? 'verified-jumper-extension',
      selectedSku: sku,
      quantity: sel?.quantity ?? null,
      addedLengthFt: sel?.addedLengthFt ?? null,
      locations: sel?.locations ?? [],
      compatibilityVerified: sel?.compatibilityVerified === true,
      compatibleSystemNote: sel?.compatibleSystemNote ?? doc.applicabilityNotes ?? null,
      manufacturerDocument: toCableExtensionEvidence(doc, sku),
      representedInDrawings: sel?.representedInDrawings === true,
      representedInSchedules: sel?.representedInSchedules === true,
      representedInBom: sel?.representedInBom === true,
      vdInstallationRecalculated: sel?.vdInstallationRecalculated === true,
      note: sel?.note ?? null,
      provenance: {
        source: 'resolveCableExtensionSolutions (manufacturer_document_registry + operator selection record)',
        ref: doc.id,
      },
      selected: sel?.selected === true,
      manufacturer: doc.manufacturerOrIssuer ?? null,
      cableSegmentIds: sel?.cableSegmentIds ?? [],
      applicability: doc.applicabilityNotes ?? null,
      verificationState: doc.verificationState === 'verified' ? 'verified' : 'pending-document',
      bomLineIds: sel?.bomLineIds ?? [],
    });
  }
  return out;
}

/** AAC WS-5 — the operator-side half of a cable-extension solution. Every field
 *  is optional: what is absent stays absent, and the pure clearance evaluator
 *  names it. Nothing here is ever defaulted to a satisfying value. */
export interface CableExtensionSelectionRecord {
  kind?: CableExtensionSolution['kind'];
  quantity?: number | null;
  addedLengthFt?: number | null;
  locations?: string[];
  cableSegmentIds?: string[];
  compatibilityVerified?: boolean;
  compatibleSystemNote?: string | null;
  representedInDrawings?: boolean;
  representedInSchedules?: boolean;
  representedInBom?: boolean;
  vdInstallationRecalculated?: boolean;
  selected?: boolean;
  note?: string | null;
  bomLineIds?: string[];
}
