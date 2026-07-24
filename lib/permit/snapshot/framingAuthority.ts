// ═══════════════════════════════════════════════════════════════════════════
// FRAMING-AUTHORITY GATE (2026-07-23) — the OBSERVATION-vs-CAPACITY split.
//
// Ray's ruling (docs/FRAMING-AUTHORITY-GATE-DIRECTIVE.md): operator-entered or
// field-observed data may establish OBSERVED geometry / material descriptions but
// may NEVER independently prove framing CAPACITY. Two canonical records:
//
//   A. FramingObservation      — built from the operator-entered project fields
//      (source 'operator-entered', honest nulls for observer/timestamp).
//   B. FramingCapacityAuthority — constructed ONLY from a verified + archived,
//      project-applicable document resolved THROUGH lib/documents (truss design
//      drawing / manufacturer structural calc / stamped analysis) OR a licensed-
//      engineer review record bound to the CURRENT snapshot digest. A generic
//      BCSI table, operator-entered dimensions, or assumed species/grade can
//      NEVER construct one — those inform PRELIMINARY modeling only.
//
// Pure — no DB. The DB/registry resolution lives in lib/documents (findVerified-
// Document + resolveFramingCapacityDocument); this module turns the resolved
// EVIDENCE into the canonical authority record (mirrors rackingAssembly's
// evaluateRackingCapacityClearance shape).
// ═══════════════════════════════════════════════════════════════════════════
import type {
  FramingObservation, FramingObservationSource, FramingCapacityAuthority, Provenance,
} from './types';

// ── OBSERVATION ──────────────────────────────────────────────────────────────

export interface FramingObservationInput {
  source?: FramingObservationSource | null;
  framingType?: string | null;
  rafterSize?: string | null;          // nominal member size (e.g. '2x6')
  rafterSpacing?: number | null;
  rafterSpecies?: string | null;
  rafterSpan?: number | null;
  roofCovering?: string | null;
  bearingObservations?: string | null;
  confidence?: 'high' | 'medium' | 'low' | null;
  observer?: string | null;
  observedAtIso?: string | null;
  evidenceRefs?: string[];
}

const norm = (s: string | null | undefined): string | null => {
  const v = (s ?? '').toString().trim();
  return v && v.toLowerCase() !== 'unknown' ? v : null;
};
const numOrNull = (n: number | null | undefined): number | null =>
  n == null || !isFinite(Number(n)) ? null : Number(n);

/**
 * Build the OBSERVED framing record from operator-entered project fields. Returns
 * null when there is no observation at all. `source` defaults to 'operator-entered'
 * (a bare DB row); observer/observedAt are honest-null when the source did not
 * record them (the live Braidon row lacks both) — never fabricated.
 */
export function buildFramingObservation(
  input: FramingObservationInput | null | undefined,
): FramingObservation | null {
  const i = input ?? {};
  const framingType = norm(i.framingType);
  const size = norm(i.rafterSize);
  const spacing = numOrNull(i.rafterSpacing);
  const species = norm(i.rafterSpecies);
  const span = numOrNull(i.rafterSpan);
  const covering = norm(i.roofCovering);
  const bearing = norm(i.bearingObservations);
  const any = !!(framingType || size || spacing != null || species || span != null || covering || bearing);
  if (!any) return null;
  const geometryComplete = !!(framingType && size && spacing != null && species && span != null);
  const source: FramingObservationSource = i.source ?? 'operator-entered';
  const observer = norm(i.observer);
  const observedAtIso = i.observedAtIso ?? null;
  return {
    source,
    framingType, nominalMemberSizeIn: size, spacingIn: spacing,
    apparentSpeciesGrade: species, measuredSpanFt: span,
    roofCovering: covering, bearingObservations: bearing,
    confidence: i.confidence ?? null,
    observer, observedAtIso,
    evidenceRefs: i.evidenceRefs ?? [],
    geometryComplete,
    provenance: {
      source: 'framing-authority gate — observation',
      note: `OBSERVED framing geometry (source: ${source}) — NOT capacity-verified. `
        + (observer && observedAtIso ? '' : 'observer/timestamp absent on the source row (honest null). ')
        + 'Operator-entered completeness is OBSERVATION, never capacity authority.',
    },
  } satisfies FramingObservation;
}

/** A short human line for the OBSERVED FRAMING block, e.g.
 *  "TRUSS / 2×6 @ 24 IN. O.C. / APPROX. 12 FT SPAN" (honest omission of nulls). */
export function observedFramingLine(obs: FramingObservation | null | undefined): string {
  if (!obs) return 'FRAMING NOT OBSERVED';
  const parts: string[] = [];
  if (obs.framingType) parts.push(obs.framingType.toUpperCase());
  const geom: string[] = [];
  if (obs.nominalMemberSizeIn) geom.push(obs.nominalMemberSizeIn.replace(/x/i, '×').toUpperCase());
  if (obs.spacingIn != null) geom.push(`@ ${obs.spacingIn} IN. O.C.`);
  if (geom.length) parts.push(geom.join(' '));
  if (obs.measuredSpanFt != null) parts.push(`APPROX. ${obs.measuredSpanFt} FT SPAN`);
  if (obs.apparentSpeciesGrade) parts.push(obs.apparentSpeciesGrade.toUpperCase());
  return parts.length ? parts.join(' / ') : 'FRAMING GEOMETRY NOT OBSERVED';
}

/** The source label rendered under the OBSERVED FRAMING line. */
export function observedSourceLabel(obs: FramingObservation | null | undefined): string {
  const src = obs?.source ?? 'operator-entered';
  const label = src === 'operator-entered' ? 'OPERATOR-ENTERED'
    : src === 'site-survey' ? 'SITE SURVEY'
    : src === 'field-measurement' ? 'FIELD MEASUREMENT'
    : 'PHOTO EVIDENCE';
  return `SOURCE: ${label} — NOT CAPACITY-VERIFIED`;
}

// ── CAPACITY AUTHORITY ───────────────────────────────────────────────────────

/** The ONLY registry document classes that can construct a FramingCapacity-
 *  Authority. A generic BCSI screening table is NOT one of these. */
export const FRAMING_CAPACITY_DOCUMENT_CLASSES = [
  'truss_design_drawing',
  'manufacturer_structural_calc',
  'stamped_structural_analysis',
] as const;
export type FramingCapacityDocumentClass = (typeof FRAMING_CAPACITY_DOCUMENT_CLASSES)[number];

export function isFramingCapacityDocumentClass(c: string | null | undefined): c is FramingCapacityDocumentClass {
  return !!c && (FRAMING_CAPACITY_DOCUMENT_CLASSES as readonly string[]).includes(c);
}

/** Evidence for the ARCHIVED-DOCUMENT path — the shape lib/documents projects
 *  from a resolved RegistryDocument (registry.toFramingClearanceEvidence). */
export interface FramingCapacityDocumentEvidence {
  documentId: string;
  documentClass: string;                 // must be a framing-capacity class
  documentIdentity: string;
  sha256: string | null;
  verificationState: string;             // must be 'verified'
  status: string;                        // must be 'current'
  archivedInRepo: boolean;               // must be true
  issuer: string | null;
  revisionOrDate: string | null;
  /** the exact project/building this document is applicable to. */
  projectApplicability: string | null;
  memberOrTrussIdentity: string | null;
  designLoads: string | null;
  allowableCapacities: string | null;
  bearingConditions: string | null;
  deflectionLimits: string | null;
  engineerOrManufacturerVerification: string | null;
  /** true only when the document actually STATES a framing (member/truss)
   *  capacity. A roof-covering / flashing report sets this false. */
  hasFramingCapacityClaim: boolean;
}

/** Evidence for the ENGINEER-REVIEW path — a licensed engineer's review record. */
export interface FramingEngineerReviewEvidence {
  reviewedSnapshotDigest: string | null;   // MUST equal the current snapshot digest
  reviewerName: string | null;
  reviewerLicense: string | null;
  licenseState: string | null;
  approvedAtIso: string | null;
}

export interface FramingCapacityAuthorityInput {
  documentEvidence?: FramingCapacityDocumentEvidence | null;
  reviewEvidence?: FramingEngineerReviewEvidence | null;
  /** the CURRENT snapshot digest — the engineer-review binding is validated
   *  against this. Absent ⇒ the review path CANNOT verify (fail-closed). */
  currentDigest?: string | null;
  /** the exact project/building applicability key the document must cover. When
   *  omitted, any archived document carrying an explicit applicability string is
   *  accepted (lib/documents already matched it upstream). */
  projectApplicabilityKey?: string | null;
}

function applicabilityCovers(docApplic: string | null, key: string | null | undefined): boolean {
  if (!key) return !!docApplic;              // must at least carry explicit applicability
  if (!docApplic) return false;
  return docApplic.toLowerCase().includes(String(key).toLowerCase());
}

/**
 * Resolve the ONE verified FramingCapacityAuthority, or null. Pure — testable
 * without a DB. Clears ONLY via a verified+archived+applicable framing-capacity
 * document, or a digest-bound licensed-engineer review. Generic BCSI, operator
 * completeness, and assumed species/grade all return null (preliminary only).
 */
export function resolveFramingCapacityAuthority(
  input: FramingCapacityAuthorityInput,
): FramingCapacityAuthority | null {
  // (1) ARCHIVED DOCUMENT — framing-capacity class, verified+current+archived+
  //     hashed, actually claims a framing capacity, covers the exact project.
  const d = input.documentEvidence ?? null;
  if (d
    && isFramingCapacityDocumentClass(d.documentClass)
    && d.verificationState === 'verified'
    && d.status === 'current'
    && d.archivedInRepo === true
    && !!d.sha256
    && d.hasFramingCapacityClaim === true
    && applicabilityCovers(d.projectApplicability, input.projectApplicabilityKey)) {
    const prov: Provenance = {
      source: 'framing-authority gate — lib/documents capacity resolver',
      note: `verified + archived ${d.documentClass} (${d.documentId}) covering ${d.projectApplicability ?? 'the project'}`,
    };
    return {
      kind: 'archived-document', verified: true, verifiedAtIso: null,
      documentId: d.documentId, documentClass: d.documentClass, documentHash: d.sha256,
      issuer: d.issuer, revisionOrDate: d.revisionOrDate,
      projectApplicability: d.projectApplicability, memberOrTrussIdentity: d.memberOrTrussIdentity,
      designLoads: d.designLoads, allowableCapacities: d.allowableCapacities,
      bearingConditions: d.bearingConditions, deflectionLimits: d.deflectionLimits,
      engineerOrManufacturerVerification: d.engineerOrManufacturerVerification,
      reviewedSnapshotDigest: null, reviewerName: null, reviewerLicense: null,
      provenance: prov,
    } satisfies FramingCapacityAuthority;
  }
  // (2) ENGINEER REVIEW — licensed engineer's review bound to the CURRENT digest.
  const r = input.reviewEvidence ?? null;
  if (r
    && !!r.reviewedSnapshotDigest
    && !!input.currentDigest
    && r.reviewedSnapshotDigest === input.currentDigest
    && !!r.reviewerLicense) {
    const who = `${r.reviewerName ?? 'licensed engineer'} (${r.reviewerLicense}${r.licenseState ? `, ${r.licenseState}` : ''})`;
    return {
      kind: 'engineer-review', verified: true, verifiedAtIso: r.approvedAtIso ?? null,
      documentId: null, documentClass: null, documentHash: null,
      issuer: r.reviewerName, revisionOrDate: r.approvedAtIso,
      projectApplicability: null, memberOrTrussIdentity: null,
      designLoads: null, allowableCapacities: null, bearingConditions: null, deflectionLimits: null,
      engineerOrManufacturerVerification: who,
      reviewedSnapshotDigest: r.reviewedSnapshotDigest, reviewerName: r.reviewerName, reviewerLicense: r.reviewerLicense,
      provenance: {
        source: 'framing-authority gate — digest-bound engineer review',
        note: `review covers the current snapshot digest ${String(input.currentDigest).slice(0, 12)}…`,
      },
    } satisfies FramingCapacityAuthority;
  }
  // Generic BCSI / operator completeness / assumed grade / no evidence → NO authority.
  return null;
}
