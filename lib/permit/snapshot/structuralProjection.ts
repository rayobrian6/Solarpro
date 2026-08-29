// ═══════════════════════════════════════════════════════════════════════════
// W3 Phase B — Structural PROJECTION layer.
// The read/format seam every structural renderer consumes. Mirrors the role
// computeSystemProjection plays for electrical: sheets read canonical
// structural facts THROUGH here and never re-derive them.
//
// Rules (Ray, W3 §1/§8):
//   • Values come from the validated PermitDesignSnapshot ONLY.
//   • Missing/unverifiable authority renders HONESTLY (em-dash / UNVERIFIED),
//     never a fabricated number and never a sheet-local literal.
//   • One environmental value class prints identically on every sheet — no
//     `?? 90`, no `|| 115`, no `|| 'C'` in any renderer.
// ═══════════════════════════════════════════════════════════════════════════
import type { PermitInput } from '../types';
import type {
  PermitDesignSnapshot, StructuralEnv, StructuralCheck, AttachmentObject,
  RailObject, ModuleInstance, RoofPlaneObject, RackingAssemblyRecord,
  StructuralEngineResult, StructuralBomRow, StructuralBomReconciliation,
  StructuralReactionReconciliation, FramingObservation, FramingCapacityAuthority,
  EnvironmentalLoadAuthority,
} from './types';
import type { DocumentApplicabilityState } from '@/lib/manufacturer-assets-db';
import { observedFramingLine, observedSourceLabel } from './framingAuthority';
import { environmentalSourceLabel, environmentalStateTag } from './environmentalAuthority';
import { peekSnapshot } from './read';
import { REQUIREMENT_DECLARATIONS } from './releaseGates';
import { deriveReleasePhase, submissionLine, type ReleasePhaseKind } from './releasePhase';
import { projectDocumentAuthority } from './documentAuthority';
import { projectReleaseGates, releasePackageLine, type ReleaseSummary } from './releaseGates';
// TAC WS-17 — ONE definition of "does this requirement gate this sheet?", shared
// with the show/hide gate so a banner's presence and its contents always agree.
import { requirementAffectsSheet } from '../plansetProfile';
import { getMountingSystemById } from '@/lib/mounting-hardware-db';

export const EMDASH = '—';

// ── honest formatters ────────────────────────────────────────────────────────
/** Number → fixed string, or em-dash when the authority is absent (never a 0
 *  fabricated to fill a cell). */
export function fmt(n: number | null | undefined, digits = 0, unit = ''): string {
  if (n == null || !isFinite(n)) return EMDASH;
  const s = digits > 0 ? n.toFixed(digits) : String(Math.round(n));
  return unit ? `${s} ${unit}` : s;
}
export function fmtStr(s: string | null | undefined): string {
  return s == null || s === '' ? EMDASH : s;
}

// ── structural projection surface ────────────────────────────────────────────
export interface StructuralProjection {
  present: boolean;
  env: StructuralEnv | null;
  checks: StructuralCheck[];
  attachments: AttachmentObject[];
  rails: RailObject[];
  moduleInstances: ModuleInstance[];
  roofPlaneObjects: RoofPlaneObject[];
  rackingAssembly: RackingAssemblyRecord | null;
  engine: StructuralEngineResult | null;
  // FRAMING-AUTHORITY GATE — the OBSERVED framing record + the verified CAPACITY
  // authority (null ⇒ UNVERIFIED). Renderers print the OBSERVED FRAMING block +
  // NOT-VERIFIED notice from these; they never treat observation as capacity.
  framingObservation: FramingObservation | null;
  framingCapacityAuthority: FramingCapacityAuthority | null;
  /** true ⇒ no verified framing CAPACITY authority ⇒ no numeric framing capacity /
   *  utilization / PASS / adequate may render. */
  framingUnverified: boolean;
  /** D44 — the existing framing was accepted by a licensed review bound to THIS
   *  build's frozen digest (a PASS-2 release-state fact, outside the design
   *  digest). Distinct from `framingCapacityAuthority`, which is an archived
   *  DOCUMENT and IS a design fact. Renderers that print a capacity NUMBER must
   *  still key on `framingUnverified` / the check; a review accepts the framing,
   *  it does not publish an allowable. */
  framingAcceptedByReview: boolean;
  /** the OBSERVED FRAMING line, e.g. "TRUSS / 2×6 @ 24 IN. O.C. / APPROX. 12 FT SPAN". */
  observedFramingLine: string;
  /** the source label, e.g. "SOURCE: OPERATOR-ENTERED — NOT CAPACITY-VERIFIED". */
  observedFramingSource: string;
  // §10 structural BOM (object-derived rows + reconciliation)
  bom: StructuralBomRow[];
  bomReconciliation: StructuralBomReconciliation | null;
  // §8 attachment-reaction reconciliation (object count / tributary / reactions)
  reactionReconciliation: StructuralReactionReconciliation | null;
  /** §9 — true when a blocking racking-capacity gap is active, so no sheet may
   *  render a capacity PASS from the unverified allowable. */
  capacityGated: boolean;
  // convenience scalars (single-sourced env)
  windSpeedMph: number | null;
  windSource: string | null;
  exposure: string | null;
  riskCategory: string | null;
  groundSnowPsf: number | null;
  roofSnowPsf: number | null;
  asceEdition: string | null;
  // §2 (BAR) — the canonical ENVIRONMENTAL LOAD AUTHORITY + its provenance line.
  // Renderers print the wind/snow values WITH `environmentalSourceLine` (e.g.
  // "SOURCE: OPERATOR-ENTERED — NOT VERIFIED") and NEVER as verified design
  // criteria while `environmentalUnverified` is true.
  environmentalLoadAuthority: EnvironmentalLoadAuthority | null;
  environmentalSourceLine: string;
  /** the COMPACT inline state tag for dense calc sheets (PV-4C value cells). */
  environmentalStateTag: string;
  environmentalUnverified: boolean;
  attachmentCount: number | null;
  attachmentSpacingIn: number | null;
  railTotalFt: number | null;
  railCount: number | null;
  spliceCount: number | null;
  // module footprint (exact catalog dims — never generic 66×40)
  moduleWidthIn: number | null;
  moduleHeightIn: number | null;
  // §14 canonical attachment-spacing authority (design vs maximum-verified)
  spacingAuthority: SpacingAuthority;
  // banner (§12)
  banner: StructuralBanner;
}

// ── §14 CANONICAL ATTACHMENT-SPACING AUTHORITY ────────────────────────────────
// ONE spacing object projected identically onto PV-3 / PV-4C / APP-A / PE-1.
// It separates the DESIGN attachment spacing (the value the layout was drawn to)
// from a MAXIMUM-VERIFIED spacing (an allowable a VERIFIED source establishes for
// the selected assembly + conditions). Until a verified source exists,
// maximumVerifiedSpacingIn is null and no sheet may call the design spacing the
// "maximum allowed" — it renders "DESIGN ATTACHMENT SPACING: N IN. O.C." +
// "PENDING STRUCTURAL VERIFICATION". "MAXIMUM ALLOWED" language appears ONLY when
// verificationState === 'verified'.
export interface SpacingAuthority {
  /** the design attachment spacing the array/rack layout was drawn to (in). */
  designSpacingIn: number | null;
  /** an ALLOWABLE maximum a verified source establishes for the selected
   *  assembly + conditions — null until such a source exists. */
  maximumVerifiedSpacingIn: number | null;
  /** the verified source document establishing the maximum, or null. */
  sourceDocument: string | null;
  /** the roof zone / area the spacing applies to, or null when unresolved. */
  applicableRoofZone: string | null;
  /** the governing load conditions for the spacing, or null when unresolved. */
  loadConditions: string | null;
  /** 'verified' only when a source establishes a maximum for the exact assembly. */
  verificationState: 'verified' | 'unverified';
  /** the ONE design line every sheet prints ("DESIGN ATTACHMENT SPACING: 48 IN. O.C."). */
  designLabel: string;
  /** the status line: "PENDING STRUCTURAL VERIFICATION" (unverified) or
   *  "MAXIMUM ALLOWED: N IN. O.C. (VERIFIED)" (verified). */
  statusLabel: string;
}

/** Project the ONE canonical spacing authority from a structural projection.
 *  Read-only: labels existing canonical fields, performs no engineering calc.
 *  A maximum is 'verified' ONLY when the assembly is NOT capacity-gated AND a
 *  verified rail-span/capacity source is present — never from the bare design 48. */
export function projectSpacingAuthority(proj: StructuralProjection): SpacingAuthority {
  const ra = proj.rackingAssembly as (RackingAssemblyRecord & {
    railSku?: string | null; spanCantileverSource?: string | null;
    assemblyVerification?: { spanSource?: string; overall?: string };
  }) | null;
  const designSpacingIn = proj.attachmentSpacingIn ?? null;
  // A maximum-verified spacing requires a verified span/capacity source for the
  // SELECTED assembly and NOT being capacity-gated. RT-MINI (unpinned rail,
  // unarchived capacity source) is gated ⇒ no verified maximum exists.
  const _spanVerified = ra?.assemblyVerification?.spanSource === 'verified';
  const _hasSpanSource = !!ra?.spanCantileverSource;
  const verified = !proj.capacityGated && _spanVerified && _hasSpanSource;
  const maximumVerifiedSpacingIn = verified ? designSpacingIn : null;
  const sourceDocument = verified ? (ra?.spanCantileverSource ?? null) : null;
  const designStr = designSpacingIn != null ? String(Math.round(designSpacingIn)) : EMDASH;
  return {
    designSpacingIn,
    maximumVerifiedSpacingIn,
    sourceDocument,
    applicableRoofZone: proj.roofPlaneObjects.length > 0 ? 'Array attachment field (all roof planes)' : null,
    loadConditions: proj.windSpeedMph != null
      ? `${fmt(proj.windSpeedMph)} mph wind${proj.roofSnowPsf != null ? ` · ${fmt(proj.roofSnowPsf)} psf roof snow` : ''}${proj.asceEdition ? ` (${proj.asceEdition})` : ''}`
      : null,
    verificationState: verified ? 'verified' : 'unverified',
    designLabel: `DESIGN ATTACHMENT SPACING: ${designStr} IN. O.C.`,
    statusLabel: verified
      ? `MAXIMUM ALLOWED: ${designStr} IN. O.C. (VERIFIED${sourceDocument ? ' — ' + sourceDocument : ''})`
      : 'PENDING STRUCTURAL VERIFICATION',
  };
}

/** Convenience: spacing authority straight from a PermitInput. */
export function projectSpacingAuthorityFromInput(input: PermitInput): SpacingAuthority {
  return projectSpacingAuthority(projectStructuralFromInput(input));
}

/** TAC WS-17 — one active release requirement as a banner row: the message a
 *  sheet prints plus the sheets whose CONTENT the requirement gates. */
export interface BannerRequirement {
  code: string;
  message: string;
  /** snapshot affectedSheets; empty ⇒ package-wide, not any one sheet's */
  sheets: readonly string[];
  // ── 2026-08-28 ───────────────────────────────────────────
  /** the row's severity. It EXISTS on the registry entry and was being dropped
   *  here, so a procurement ADVISORY rendered as an undifferentiated red bullet
   *  — and, on the audited package, as the LONGEST paragraph on the sheet, one
   *  line under a gate line that had just called it an advisory. */
  severity: 'blocking' | 'warning';
  /** the ONE line a construction drawing carries for this requirement
   *  (RequirementDeclaration.sheetLine). Null for a code with no declaration —
   *  the renderer then names the code and points at the record, and NEVER falls
   *  back to `message`, which is the paragraph this field exists to replace. */
  sheetLine: string | null;
}

export interface StructuralBanner {
  /** true ⇒ the sheet must visibly state the package's release state. */
  show: boolean;
  /** the phase LABEL — derived, never a constant. */
  line1: string;
  /** the honest submission line for that phase — derived, never a constant. */
  line2: string;
  /** the phase's one actionable sentence. */
  statement: string;
  /** 'defect' | 'workflow' | 'released' — the renderer takes its palette from
   *  this, so no sheet decides independently whether the package looks alarming.
   *  A package awaiting a signature is a WORKFLOW state, not a defect. */
  kind: ReleasePhaseKind;
  phaseId: string;
  /** the permit-readiness blocker codes/messages driving the banner.
   *  TAC WS-17 — each carries the sheets its authority is projected onto, so a
   *  sheet banner can enumerate ITS OWN requirements instead of the whole
   *  package union. An EMPTY list means package-wide (cover's release status). */
  blockers: BannerRequirement[];
  /** structural-specific subset (framing / capacity / wind-snow / etc.). */
  structuralBlockers: BannerRequirement[];
  /** RGM §4 — the PACKAGE-level release state in GATE semantics. Projected from
   *  the SAME registry (deriveReleaseGateModel), so a sheet banner can state
   *  "7 OPEN RELEASE GATES / 19 UNRESOLVED REQUIREMENTS" instead of the
   *  "19 blockers" phrasing that presented 19 children of 7 root gates as 19
   *  independent engineering failures. Null only when there is no snapshot. */
  releaseSummary: ReleaseSummary | null;
  /** RGM §4 — the pre-rendered package line (single source; see
   *  releasePackageLine). Empty string when there is no snapshot. */
  releasePackageLine: string;
}

const STRUCTURAL_BLOCKER_CODES = new Set([
  'FRAMING-AUTHORITY-UNVERIFIED',    // canonical (framing-authority gate)
  'STRUCTURAL-FRAMING-UNVERIFIED',   // legacy alias
  'ATTACHMENT-CAPACITY-SOURCE-MISSING',
  'FASTENER-CONFIG-MISSING',
  'MIXED-MANUFACTURER-ASSEMBLY-UNSUPPORTED',
  'ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED',   // §2 (BAR) — env-load authority gate
  'WIND-SNOW-AUTHORITY-UNRESOLVED',            // legacy alias (subsumed by the above)
  'REACTIONS-UNTRACEABLE',
  'STRUCTURAL-REACTION-RECONCILIATION-FAILED',
  'RAIL-QUANTITY-UNTRACEABLE',
  'STRUCTURAL-UTILIZATION-EXCEEDED',
  'SITE-GEOMETRY-MISSING',
  'MODULE-DIMENSIONS-UNVERIFIED',
  'RACKING-CAPACITY-SOURCE-NOT-ARCHIVED',
  'RACKING-CAPACITY-APPLICABILITY-GAP',
  'PENDING-RACKING-ASSEMBLY-SELECTION',
  'FASTENER-ASSEMBLY-UNVERIFIED',      // §13 — own fastener-authority code
]);

/** §9 — racking-capacity gap codes that gate a capacity PASS off any sheet. */
export const CAPACITY_GATE_BLOCKER_CODES = new Set([
  'RACKING-CAPACITY-SOURCE-NOT-ARCHIVED',
  'RACKING-CAPACITY-APPLICABILITY-GAP',
  'ATTACHMENT-CAPACITY-SOURCE-MISSING',
]);

// BANNER_LINE_1 / BANNER_LINE_2 are GONE (2026-08-28). They were two constants
// asserted on every gated sheet regardless of the package's actual state:
//   'PENDING STRUCTURAL ENGINEERING REVIEW'  — asserted a STRUCTURAL cause even
//     when the only open requirement was the project name or the code edition;
//   'NOT FOR PERMIT SUBMISSION'              — asserted on a package that was
//     reviewed, signed and released (see the `show` gate below).
// Both now come from the release phase.

/** Compute the §12 banner state from a snapshot's permit readiness. The banner
 *  shows whenever readiness is false OR any structural blocker is present.
 *
 *  W10 (RP-D): `blockers` is the UNION of every ACTIVE release blocker (blocking
 *  + advisory) drawn from the canonical registry — so banner surfaces that were
 *  wrongly showing ONLY structural blockers (structuralBlockers-else-blockers
 *  ternary) now enumerate electrical / code / equipment-identity / document /
 *  project-identity blockers too. `structuralBlockers` remains the structural
 *  subset for the banner's show-gate. Falls back to the back-compat blocker list
 *  when a snapshot predates the registry. */
export function structuralBanner(snap: PermitDesignSnapshot | null | undefined): StructuralBanner {
  const registry = snap?.permitReadiness?.registry;
  // TAC WS-17 — affectedSheets travels WITH the requirement so a sheet banner can
  // print the requirements gating its own content. A pre-registry snapshot has no
  // per-sheet attribution: those rows are package-wide (empty sheets list) and the
  // per-sheet filter falls back to showing everything (see bannerRequirementsForSheet).
  const blockers: BannerRequirement[] = (registry && registry.length)
    ? registry.filter(r => !r.resolved)
      .map(r => ({
        code: r.code,
        message: r.explanation,
        sheets: r.affectedSheets ?? [],
        severity: r.severity === 'warning' ? 'warning' as const : 'blocking' as const,
        sheetLine: REQUIREMENT_DECLARATIONS[r.code]?.sheetLine ?? null,
      }))
    : (snap?.permitReadiness?.blockers ?? []).map(b => ({
        ...b,
        sheets: [] as readonly string[],
        severity: 'blocking' as const,
        sheetLine: REQUIREMENT_DECLARATIONS[b.code]?.sheetLine ?? null,
      }));
  const structuralBlockers = blockers.filter(b => STRUCTURAL_BLOCKER_CODES.has(b.code));
  const notReady = snap ? snap.permitReadiness.ready === false : false;
  // RGM §4 — the gate model is a deterministic projection of the SAME registry
  // this banner reads; nothing is re-derived and no requirement is filtered out.
  const release = snap ? projectReleaseGates(snap) : null;

  // ══ THE SHOW GATE — SEVERITY, NOT MERE PRESENCE ════════════════════
  // This read `notReady || structuralBlockers.length > 0`, and
  // `structuralBlockers` had no severity filter while
  // `STRUCTURAL_BLOCKER_CODES` contains PENDING-RACKING-ASSEMBLY-SELECTION — an
  // ADVISORY that by design never gates `ready`.
  //
  // So a package that was reviewed, signed, sealed and RELEASED still printed
  // 'NOT FOR PERMIT SUBMISSION' across PV-3 and PV-4C, forever, because nobody
  // had pinned a rail part number. That is a false statement on a construction
  // drawing, and it is the direction of error nobody catches: a red banner never
  // looks like a bug.
  //
  // An advisory may DECORATE a banner the package has earned; it may not SUMMON
  // one. Proven both ways in tests/planset/sheet-banner-phase.test.ts.
  const structuralBlocking = structuralBlockers.filter(b => b.severity === 'blocking');

  // The phase is derived from the same release model, so a sheet and the cover
  // can never state different things about one package.
  const phase = release
    ? deriveReleasePhase({
        model: release,
        reviewCoversCurrentDigest: release.issueStatePredicates.professionalReleaseComplete,
        gatePasses: release.issueStatePredicates.readyForPermitSubmission,
        hasDesign: (snap?.derived?.moduleCount ?? 0) > 0,
      })
    : null;

  return {
    show: notReady || structuralBlocking.length > 0,
    line1: phase?.label ?? 'RELEASE STATE NOT ESTABLISHED',
    line2: phase ? submissionLine(phase) : 'NOT FOR PERMIT SUBMISSION',
    statement: phase?.statement ?? '',
    // Fail-closed: with no snapshot to derive a phase from, the sheet reads as a
    // defect rather than quietly reassuring anyone.
    kind: phase?.kind ?? 'defect',
    phaseId: phase?.id ?? 'DESIGN_INCOMPLETE',
    blockers,
    structuralBlockers,
    releaseSummary: release ? release.summary : null,
    releasePackageLine: release ? releasePackageLine(release.summary) : '',
  };
}

/**
 * TAC WS-17 — the requirements a GIVEN sheet's banner must enumerate.
 *
 * The banner used to print `b.blockers` — the whole registry union — on every
 * gated sheet, capped at 8. The audited package therefore repeated one identical
 * eight-item list on PV-1, PV-1B, PV-3 and PV-4C: a site plan told the reviewer
 * about Q-Cable procurement footage, and an attachment detail told them about
 * unmeasured tap conductors. The sheet id was consulted only to decide SHOW or
 * HIDE, never to decide WHAT.
 *
 * A sheet now enumerates the requirements whose authority is projected onto IT
 * (registry affectedSheets, hybrid detail sheets inheriting their base sheet),
 * and states the count of the remaining package-wide ones. Nothing is hidden:
 * the totals are on the cover's release-status block and every requirement is
 * listed in full in the review record / RS-1.
 */
export function bannerRequirementsForSheet(
  b: StructuralBanner,
  sheetId: string | null | undefined,
): { own: BannerRequirement[]; otherCount: number } {
  // No sheet identity (standalone banner render) ⇒ never suppress anything.
  if (!sheetId) return { own: b.blockers, otherCount: 0 };
  const own = b.blockers.filter(r => r.sheets.length > 0 && requirementAffectsSheet(r.sheets, sheetId));
  // A pre-registry snapshot has no attribution at all: showing nothing would be
  // a silent loss, so fall back to the full list exactly as before.
  if (!b.blockers.some(r => r.sheets.length > 0)) return { own: b.blockers, otherCount: 0 };
  return { own, otherCount: b.blockers.length - own.length };
}

/** Build the structural projection from a snapshot (null-safe). */
export function projectStructural(snap: PermitDesignSnapshot | null | undefined): StructuralProjection {
  const st = snap?.structural ?? null;
  const geo = snap?.geometry ?? null;
  const env = st?.env ?? null;
  const mi = geo?.moduleInstances ?? [];
  const mod0 = mi[0] ?? null;
  // §9 — capacity is GATED whenever a blocking racking-capacity gap is active
  // (RT-MINI unverified 600 lb source / applicability). Read both the readiness
  // blockers and the racking-assembly structural-authority gaps (belt + braces).
  const _blockerCodes = new Set((snap?.permitReadiness?.blockers ?? []).map(b => b.code));
  const _rackGaps = ((st?.rackingAssembly as unknown as {
    structuralAuthorityGaps?: { code: string; severity: string }[] } | null)?.structuralAuthorityGaps) ?? [];
  const capacityGated =
    [...CAPACITY_GATE_BLOCKER_CODES].some(c => _blockerCodes.has(c))
    || _rackGaps.some(g => g.severity === 'blocking' && CAPACITY_GATE_BLOCKER_CODES.has(g.code));
  const framingObservation = st?.framingObservation ?? null;
  const framingCapacityAuthority = st?.framingCapacityAuthority ?? null;
  // ── PHASE A / D44 — RELEASE-STATE FRAMING ACCEPTANCE ──────────────────────
  // A licensed review is an APPROVAL of the design, not a property of it, so it
  // is projected in PASS 2 (build.ts, after meta.digest is frozen) and never
  // enters canonicalDigestBody — otherwise the approval moves the digest it
  // approves. `structural.framingCapacityAuthority` therefore stays null when
  // only a review (not an archived DOCUMENT) established capacity, and THIS is
  // the one place that reconciles the two so every renderer agrees.
  const framingReleaseAuthority =
    (snap as { framingReleaseAuthority?: { acceptedByReview?: boolean } } | null | undefined)
      ?.framingReleaseAuthority ?? null;
  const framingAcceptedByReview = framingReleaseAuthority?.acceptedByReview === true;
  const framingUnverified =
    !(framingCapacityAuthority && framingCapacityAuthority.verified === true)
    && !framingAcceptedByReview;
  // The engine ran in PASS 1 and could not know about the approval. Overriding
  // ONLY this flag keeps every computed number untouched — the review accepts
  // the existing framing, it does not change what the engine calculated.
  const _engine = st?.engine ?? null;
  const _engineProjected = (_engine && framingAcceptedByReview)
    ? { ..._engine, engineeringReviewRequired: false }
    : _engine;
  const _base = {
    present: !!snap,
    env,
    checks: st?.checks ?? [],
    attachments: st?.attachments ?? [],
    rails: st?.rails ?? [],
    moduleInstances: mi,
    roofPlaneObjects: geo?.roofPlaneObjects ?? [],
    rackingAssembly: st?.rackingAssembly ?? null,
    engine: _engineProjected,
    framingObservation,
    framingCapacityAuthority,
    framingUnverified,
    framingAcceptedByReview,
    observedFramingLine: observedFramingLine(framingObservation),
    observedFramingSource: observedSourceLabel(framingObservation),
    bom: st?.bom ?? [],
    bomReconciliation: st?.bomReconciliation ?? null,
    reactionReconciliation: st?.reactionReconciliation ?? null,
    capacityGated,
    windSpeedMph: env?.ultimateWindSpeedMph ?? st?.loads.windSpeedMph ?? null,
    windSource: env?.windSpeedSource ?? null,
    exposure: env?.exposureCategory ?? st?.loads.exposure ?? null,
    riskCategory: env?.riskCategory ?? null,
    groundSnowPsf: env?.groundSnowPsf ?? st?.loads.snowPsf ?? null,
    roofSnowPsf: env?.roofSnowPsf ?? null,
    asceEdition: env?.codeAuthority.asceEdition ?? null,
    environmentalLoadAuthority: env?.environmentalLoadAuthority ?? null,
    environmentalSourceLine: environmentalSourceLabel(env?.environmentalLoadAuthority ?? null),
    environmentalStateTag: environmentalStateTag(env?.environmentalLoadAuthority ?? null),
    environmentalUnverified: (env?.environmentalLoadAuthority?.verificationStatus ?? 'unknown') !== 'verified',
    attachmentCount: st?.attachmentCount ?? null,
    attachmentSpacingIn: st?.attachmentSpacingIn ?? null,
    railTotalFt: st?.railTotalFt ?? null,
    railCount: st?.railCount ?? null,
    spliceCount: st?.spliceCount ?? null,
    moduleWidthIn: mod0?.widthIn ?? null,
    moduleHeightIn: mod0?.heightIn ?? null,
    // §14 spacing authority is computed AFTER the base fields it reads.
    spacingAuthority: (undefined as unknown as SpacingAuthority),
    banner: structuralBanner(snap),
  };
  // §14 — fill the canonical spacing authority from the assembled base fields
  // (needs attachmentSpacingIn / capacityGated / rackingAssembly already set).
  _base.spacingAuthority = projectSpacingAuthority(_base as StructuralProjection);
  return _base as StructuralProjection;
}

/** Convenience: project straight from a PermitInput (section renderers that
 *  already hold `input`). Non-throwing — returns an empty projection when the
 *  snapshot is absent (standalone paths), so the sheet can degrade honestly. */
export function projectStructuralFromInput(input: PermitInput): StructuralProjection {
  return projectStructural(peekSnapshot(input));
}

/** Lookup a single check by limit state. */
export function findCheck(
  proj: StructuralProjection, limitState: StructuralCheck['limitState'],
): StructuralCheck | null {
  return proj.checks.find(c => c.limitState === limitState) ?? null;
}

/** Human threshold label for a check ("D/C ≤ 1.00" or "SF ≥ 1.5"). */
export function checkThresholdLabel(c: StructuralCheck): string {
  return c.thresholdKind === 'min-safety-factor'
    ? `SF ${'≥'} ${c.requiredThreshold.toFixed(1)}`
    : `D/C ${'≤'} ${c.requiredThreshold.toFixed(2)}`;
}

/** Pass/fail/pending label for a check (null ⇒ review-required, not a fail). */
export function checkResultLabel(c: StructuralCheck): 'PASS' | 'FAIL' | 'REVIEW REQ.' {
  return c.passes == null ? 'REVIEW REQ.' : c.passes ? 'PASS' : 'FAIL';
}

// ── §12 CANONICAL FASTENER ASSEMBLY ──────────────────────────────────────────
// ONE exact fastener object projected identically onto PV-3, APP-A, PE-1 and
// SCHED. Built from the canonical racking-assembly record (screwLagModel, qty,
// embedment, pilot rule, substrate, source document, verification) plus the
// selected mount's product spec (diameter, length, type). Honest nulls — no
// generic "lag bolt / 5/16 min / stainless" fallback. While the fastener source
// document is unarchived (or the racking capacity is gated) the assembly is
// UNVERIFIED and the PE letter prints "PENDING VERIFIED FASTENER ASSEMBLY".
export interface FastenerAssembly {
  present: boolean;                 // a mount / assembly is selected
  manufacturer: string | null;
  model: string | null;            // fastener product (screwLagModel)
  sku: string | null;
  fastenerType: string | null;     // e.g. 'structural wood screw', 'SS lag'
  diameterIn: number | null;
  diameterLabel: string | null;    // e.g. '5/16'
  lengthIn: number | null;
  qtyPerMount: number | null;
  material: string | null;         // coating/material — honest null when not in record
  headDrive: string | null;        // head/drive — honest null when not in record
  pilotHoleRequired: boolean | null;
  pilotRuleLabel: string;
  embedmentIn: number | null;
  substrate: string | null;        // installation condition / substrate
  rafterDeckMethod: string | null;
  sourceDocument: string | null;   // archived datasheet / capacity source
  verification: 'verified' | 'unverified' | 'pending';
  /** §6 (BAR) — while NOT verified the fastener assembly is NON-ORDERABLE: no
   *  manufacturer/SKU/diameter/length/coating/capacity may render, the calculated
   *  attachment quantity is a DESIGN QUANTITY only, and it is excluded from
   *  procurement totals (the racking/QCABLE non-orderable pattern). The geometry
   *  fields above REMAIN populated (observed) so the exact orderable row auto-
   *  regenerates when FastenerAssembly.verificationStatus === 'verified'. */
  nonOrderable: boolean;
  /** the ONE canonical descriptive line every sheet prints identically. Dimensionless
   *  ('DESIGN QUANTITY — NON-ORDERABLE / PENDING VERIFIED FASTENER ASSEMBLY') while
   *  non-orderable; the full manufacturer/dim line only when verified. */
  line: string;
  /** certification-status label ('PENDING VERIFIED FASTENER ASSEMBLY' unless verified). */
  certLabel: string;
}

/** §6 (BAR) — the ONE canonical non-orderable label. Shown for the fastener line
 *  and quantity while the assembly is not verified. */
export const FASTENER_NON_ORDERABLE_LABEL = 'DESIGN QUANTITY — NON-ORDERABLE / PENDING VERIFIED FASTENER ASSEMBLY';

// A fastener diameter LABEL. Inch products get their inch fraction; METRIC
// products get their metric designation, because printing 0.19685 on a drawing
// is not a size anyone can order or check.
//
// 2026-08-28 — metric was added because the Roof Tech RT-Mini II roof screw is
// an SS304 5.0 mm wood screw, not the 5/16" the catalogue used to claim. (The
// 5/16" on that product is the L-FOOT FLANGE BOLT, a different fastener in a
// different joint; the old record had conflated the two.) With only the inch
// table, the corrected value fell through to a bare decimal.
const _METRIC_FASTENER_MM: ReadonlyArray<readonly [number, string]> = [
  [4.0, 'M4 (4.0 mm)'], [4.5, 'M4.5 (4.5 mm)'], [5.0, 'M5 (5.0 mm)'],
  [5.5, 'M5.5 (5.5 mm)'], [6.0, 'M6 (6.0 mm)'], [8.0, 'M8 (8.0 mm)'],
];
const _fracFast = (v: number | null | undefined): string | null => {
  if (v == null || !isFinite(v)) return null;
  if (v === 0.25) return '1/4';
  if (v === 0.3125) return '5/16';
  if (v === 0.375) return '3/8';
  if (v === 0.5) return '1/2';
  const mm = v * 25.4;
  for (const [m, label] of _METRIC_FASTENER_MM) {
    if (Math.abs(mm - m) < 0.05) return label;
  }
  return String(v);
};

// ═══════════════════════════════════════════════════════════════════════════
// TAC WS-4 — THE ONE FASTENER-VERIFICATION PREDICATE.
//
// Three modules used to decide this independently (rackingAssembly by field
// presence, structuralProjection by presence + any source string,
// structuralBom by presence + source + capacity gating), which is how one
// package printed "VERIFIED FASTENER ASSEMBLY · 5/16" dia · 2.5" min embedment"
// on SCHED/APP-A/PE-1 and "FASTENER ASSEMBLY: … INSTALLATION DETAILS: NOT
// ESTABLISHED" on PV-3. This function is now the only decision; every surface
// consumes its verdict.
//
// WHAT VERIFIES A FASTENER ASSEMBLY:
//   1. the ELEMENTS are complete on the canonical record (model + count +
//      embedment), AND
//   2. a source document exists that is an INSTALLATION/STRUCTURAL class
//      document — a flashing / water-resistance evaluation report (ESR-nnnn) is
//      explicitly NOT fastener authority (the same rule rackingAssembly.ts
//      applies to capacity), AND
//   3. that document's applicability to the SELECTED product is VERIFIED (an
//      RT-MINI II manual never verifies an RT-MINI fastener).
// ═══════════════════════════════════════════════════════════════════════════

/** A flashing/water-resistance evaluation report cited alone is not fastener
 *  authority. Exported for the tests that pin this rule. */
export function isFlashingOnlyEvaluationReport(s: string | null | undefined): boolean {
  return !!s && /\bESR-?\d+\b/i.test(s)
    && !/structural|withdrawal|pull-?out|capacity|installation manual/i.test(s);
}

export interface FastenerVerificationInput {
  elementsComplete: boolean;
  /** the document cited as the fastener's source (datasheet / capacity source). */
  citedSourceDocument: string | null;
  /** the decided applicability of the mount's installation document to the
   *  SELECTED product (from the equipment document authority). */
  documentApplicabilityVerified: boolean;
  /** 2026-08-28 — the racking record's `documentRoles.fastenerAuthority`, when a
   *  document actually FILLS that role: a stamped structural PE letter for the
   *  exact selected model that states the fastener model and count. That is
   *  fastener-installation authority by definition, and it is decided once, in
   *  rackingAssembly, rather than re-derived from a source STRING here.
   *
   *  Its absence changes nothing: the two rules below still decide, and an
   *  ICC-ES flashing report is still refused. */
  fastenerAuthorityDocument?: { established: boolean; documentIdentity: string | null } | null;
}

export interface FastenerVerificationResult {
  verified: boolean;
  /** the document accepted as fastener authority (null when none qualifies). */
  sourceDocument: string | null;
  /** why it is not verified — one canonical sentence every surface may print. */
  reason: string | null;
}

export function resolveFastenerVerification(i: FastenerVerificationInput): FastenerVerificationResult {
  const src = isFlashingOnlyEvaluationReport(i.citedSourceDocument) ? null : (i.citedSourceDocument ?? null);
  // The ELEMENTS still have to be complete — a document naming the fastener does
  // not excuse a record that fails to record it. But once they are, a document
  // that FILLS the fastener-authority role settles both remaining questions
  // (is there a real source, and does it cover this product), because filling
  // the role already required an exact-model match.
  if (i.elementsComplete && i.fastenerAuthorityDocument?.established) {
    return { verified: true, sourceDocument: i.fastenerAuthorityDocument.documentIdentity ?? src, reason: null };
  }
  if (!i.elementsComplete) {
    return { verified: false, sourceDocument: src, reason: 'the fastener element is incomplete (model / count / embedment not all established on the mount record)' };
  }
  if (!src) {
    return {
      verified: false, sourceDocument: null,
      reason: i.citedSourceDocument
        ? `the only cited source (${i.citedSourceDocument}) is a flashing / water-resistance evaluation report, which carries no fastener-installation authority`
        : 'no fastener installation / structural source document is recorded for the mount base',
    };
  }
  if (!i.documentApplicabilityVerified) {
    return { verified: false, sourceDocument: src, reason: 'the cited installation document is not verified as applicable to the SELECTED product version' };
  }
  return { verified: true, sourceDocument: src, reason: null };
}

/** Project the ONE canonical fastener assembly for a permit input. Read-only —
 *  resolves & labels existing canonical fields, performs no engineering calc. */
export function projectFastenerAssembly(input: PermitInput): FastenerAssembly {
  return projectFastenerAssemblyFromSnapshot(
    peekSnapshot(input),
    (input.project as { mountingSystemId?: string }).mountingSystemId,
  );
}

/** PPC §4 — the same canonical fastener assembly, reachable from a SNAPSHOT +
 *  the selected mounting-system id. Added so the SECOND rendering stack
 *  (`lib/drafting`, which holds a snapshot on the RenderContext rather than a
 *  PermitInput) projects the identical object instead of reading the raw
 *  mounting-hardware-db record. `projectFastenerAssembly(input)` delegates here,
 *  so the two stacks cannot diverge. */
export function projectFastenerAssemblyFromSnapshot(
  snap: PermitDesignSnapshot | null | undefined,
  mountingSystemId: string | null | undefined,
  /** TAC WS-4 — an explicitly-supplied document applicability, used INSTEAD of
   *  re-reading the snapshot's document-authority region. Callers that already
   *  hold the decided verdict (projectAttachmentInstallationAuthority) pass it so
   *  one authority object cannot contain two different applicability facts. */
  applicabilityOverride?: { documentApplicabilityVerified: boolean },
): FastenerAssembly {
  const proj = projectStructural(snap);
  const ra = proj.rackingAssembly as (RackingAssemblyRecord & {
    assemblyVerification?: { fastener?: 'verified' | 'pending' | 'unverified' };
  }) | null;
  const mountId = mountingSystemId ?? undefined;
  const mount = mountId ? getMountingSystemById(mountId) : undefined;
  const m = mount?.mount;

  const present = !!(ra || mount);
  const manufacturer = ra?.mountManufacturer ?? mount?.manufacturer ?? null;
  const model = ra?.screwLagModel ?? null;
  const fastenerType = m?.fastenerType ?? (present ? 'SS lag' : null);
  const diameterIn = m?.fastenerDiameterIn != null && m.fastenerDiameterIn > 0 ? m.fastenerDiameterIn : null;
  const diameterLabel = _fracFast(diameterIn);
  const lengthIn = m?.fastenerLengthIn ?? null;
  const qtyPerMount = ra?.screwLagQtyPerMount ?? (m?.fastenersPerMount != null && m.fastenersPerMount > 0 ? m.fastenersPerMount : null);
  const embedmentIn = ra?.embedmentRequirementIn ?? (m?.fastenerEmbedmentIn != null && m.fastenerEmbedmentIn > 0 ? m.fastenerEmbedmentIn : null);
  const pilotHoleRequired = ra?.pilotHoleRequired ?? null;
  const pilotRuleLabel = pilotHoleRequired === false ? 'no pilot hole'
    : pilotHoleRequired === true ? 'pilot hole required'
    : 'pilot rule per manufacturer';
  // TAC WS-5 — THE EMBEDMENT SUBSTRATE IS THE STRUCTURAL MEMBER, never the roof
  // covering. `installationCondition` is the manufacturer's compatible-COVERING
  // list ('asphalt_shingle, wood_shake'); reading it here is what produced
  // "2.5" minimum embedment into asphalt_shingle, wood_shake" on PV-4C.1 /
  // SCHED / APP-A. The canonical embedment target is the attachment object's
  // substrateMember ('rafter 2x6' / 'truss …' / 'unverified-framing'), which is
  // exactly what the structural engine drove the withdrawal check against.
  const _attachSubstrate = (proj.attachments ?? [])
    .map(a => (a as { substrateMember?: string | null }).substrateMember ?? null)
    .find(s => !!s && !/^unverified/i.test(s)) ?? null;
  const substrate = _attachSubstrate;
  /** display-only compatibility (never an embedment claim). */
  const compatibleRoofCoverings: string[] = ra?.compatibleRoofCoverings
    ?? (ra?.installationCondition ? ra.installationCondition.split(',').map(s => s.trim()).filter(Boolean) : []);
  const rafterDeckMethod = ra?.rafterDeckAttachmentMethod ?? m?.attachmentMethod ?? null;
  // Material / head-drive are NOT carried in mounting-hardware-db — honest nulls.
  const material: string | null = null;
  const headDrive: string | null = null;
  // ── TAC WS-4 — THE ONE FASTENER PREDICATE ──────────────────────────────────
  // What counts as a fastener SOURCE DOCUMENT. `iccEsReport` (ESR-3575) is a
  // FLASHING / water-resistance evaluation report — this very file's sibling
  // (rackingAssembly.ts) refuses it as capacity authority in so many words, yet
  // it was accepted here, which is how a "VERIFIED FASTENER ASSEMBLY" line with
  // exact dimensions printed on SCHED / APP-A / PE-1 / PV-4C.1 while PV-3 (the
  // real instruction authority) printed "INSTALLATION DETAILS: NOT ESTABLISHED"
  // on the same package. Only an INSTALLATION / STRUCTURAL document class may
  // establish a fastener assembly, and it must additionally be APPLICABLE to the
  // selected product (an RT-MINI II manual does not verify an RT-MINI fastener).
  // the exact-product document applicability decided ONCE by the build's
  // document authority (the SAME verdict PV-3 / DS-n consume). Absent ⇒ not
  // established — an RT-MINI II manual never verifies an RT-MINI fastener.
  const _docEntry = projectDocumentAuthority(snap, 'racking_detail', mountingSystemId ?? null);
  const _fv = resolveFastenerVerification({
    elementsComplete: ra?.fastenerElementsComplete
      ?? !!(ra?.screwLagModel && ra?.screwLagQtyPerMount != null && ra?.embedmentRequirementIn != null),
    citedSourceDocument: ra?.datasheetSource ?? ra?.capacitySource ?? null,
    documentApplicabilityVerified: applicabilityOverride
      ? applicabilityOverride.documentApplicabilityVerified
      : _docEntry?.applicability?.applicabilityVerified === true,
  });
  const sourceDocument = _fv.sourceDocument;
  const verification: FastenerAssembly['verification'] =
    !present ? 'pending' : (_fv.verified ? 'verified' : 'unverified');

  // §6 (BAR) — the exact manufacturer/SKU/diameter/length/coating/embedment
  // description prints ONLY when verified. While NON-ORDERABLE the line reveals no
  // dimensions (the observed geometry stays in the fields above for regeneration);
  // it prints the DESIGN-QUANTITY / NON-ORDERABLE label instead.
  const nonOrderable = verification !== 'verified';
  const descParts = [
    [manufacturer, model].filter(Boolean).join(' ') || fastenerType || 'Structural fastener',
    diameterLabel ? `${diameterLabel}" dia` : null,
    lengthIn != null ? `× ${lengthIn}"` : null,
    fastenerType,
    qtyPerMount != null ? `${qtyPerMount}/mount` : null,
    embedmentIn != null ? `${embedmentIn}" min embedment` : null,
    pilotRuleLabel,
    substrate ? `substrate: ${substrate}` : null,
  ].filter(Boolean).join(' · ');
  const line = !present
    ? FASTENER_NON_ORDERABLE_LABEL
    : verification === 'verified'
      ? descParts
      : FASTENER_NON_ORDERABLE_LABEL;
  const certLabel = verification === 'verified'
    ? 'VERIFIED FASTENER ASSEMBLY'
    : 'PENDING VERIFIED FASTENER ASSEMBLY';

  return {
    present, manufacturer, model, sku: ra?.mountSku ?? null, fastenerType,
    diameterIn, diameterLabel, lengthIn, qtyPerMount, material, headDrive,
    pilotHoleRequired, pilotRuleLabel, embedmentIn, substrate, rafterDeckMethod,
    sourceDocument, verification, nonOrderable, line, certLabel,
  };
}

// ── PPC §3/§4 — THE ATTACHMENT-INSTALLATION AUTHORITY (one object, both stacks) ─
// The corrective-pass root fix. `lib/permit/sections/*` reached the spacing +
// fastener authorities; `lib/drafting/*` (PV-1 / PV-3) never did — it was fed a
// flat descriptor built from raw mounting-hardware-db reads, which is why PV-3
// printed exact diameters/embedment/torque/pilot instructions (and a pilot rule
// the snapshot NEGATES) while FASTENER-ASSEMBLY-UNVERIFIED and
// EQUIPMENT-DOCUMENT-APPLICABILITY were both active.
//
// This bundle is the ONE thing a drawing/annotation emitter may consume. Exact
// installation instructions (diameter / length / embedment / torque / pilot /
// coating / sealant / screw count / manufacturer instruction) may render ONLY when
// `exactInstructionsAllowed` — i.e. ALL FIVE conditions hold:
//   1 exact SKU selected (mount SKU pinned + rail SKU pinned when rail-based)
//   2 document applicability VERIFIED for the selected product version
//   3 the cited document is ARCHIVED with a recorded content hash
//   4 the fastener assembly itself is VERIFIED
//   5 the selection is carried by the CURRENT digested snapshot (not a sidecar)
// Otherwise the emitter prints `pendingLines` verbatim and banners the detail
// NON-AUTHORITATIVE. The observed geometry stays in `fastener` (so the exact
// instructions auto-regenerate the moment the five conditions clear) — it is just
// not RENDERABLE.
export interface AttachmentInstallationAuthority {
  /** the ONE canonical spacing authority (design value + verification state). */
  spacing: SpacingAuthority;
  /** the ONE canonical fastener assembly (fields observed; display gated). */
  fastener: FastenerAssembly;
  /** manufacturer-document applicability for the cited install document. */
  documentApplicability: {
    /** ECD §8 — the 7-state document verdict (was the binary
     *  'verified' | 'unverified'). Availability is NOT applicability. */
    state: DocumentApplicabilityState;
    /** ECD §8 — the ONE boolean the five install conditions consume. */
    applicabilityVerified: boolean;
    selectedModel: string | null;
    documentProduct: string | null;
    documentTitle: string | null;
  } | null;
  /** per-condition truth (all five must hold for exact instructions). */
  conditions: {
    exactSkuSelected: boolean;
    documentApplicabilityVerified: boolean;
    documentArchivedHashBound: boolean;
    fastenerAssemblyVerified: boolean;
    selectionBoundToCurrentDigest: boolean;
  };
  /** mount-assembly / racking-assembly verification states (honest tri-state). */
  mountAssemblyState: 'verified' | 'pending' | 'unverified';
  rackingAssemblyState: 'verified' | 'pending' | 'unverified';
  /** true ⇒ exact dims/torque/pilot/coating/sealant instructions MAY render. */
  exactInstructionsAllowed: boolean;
  /** Post-AAC (WS-8 alignment) — the ONE state-derived fastener-assembly status
   *  label every non-exact surface prints (drafting stack included, per the PPC
   *  standing rule). While instructions are gated: names the verified element
   *  honestly instead of contradicting the SCHED/APP-A/PE-1 verified line. */
  fastenerStateLabel: string;
  /** Ray's exact PENDING block (empty when exactInstructionsAllowed). */
  pendingLines: string[];
  /** the reference-detail banner (null when exactInstructionsAllowed). */
  referenceDetailBanner: string | null;
  /** 'DESIGN ATTACHMENT SPACING: 48 IN. O.C.' — never a MAX/allowable claim. */
  spacingDesignLine: string;
  /** 'PENDING STRUCTURAL VERIFICATION' (or the verified maximum statement). */
  spacingStatusLine: string;
  /** the ONE combined spacing line every sheet may print verbatim. */
  spacingLine: string;
  /** short in-drawing spacing annotation ('48" O.C. (DESIGN)') — no MAX word. */
  spacingShortLabel: string;
}

/** The non-authoritative reference-detail banner (PPC §4, Ray's wording). */
export const REFERENCE_DETAIL_BANNER =
  'REFERENCE DETAIL: NON-AUTHORITATIVE — DO NOT INSTALL FROM THIS DETAIL';

/** Project the attachment-installation authority from a snapshot + mount id.
 *  Read-only; fail-closed (no snapshot ⇒ nothing may print exact instructions). */
export function projectAttachmentInstallationAuthority(
  snap: PermitDesignSnapshot | null | undefined,
  mountingSystemId: string | null | undefined,
  asset?: { model: string | null; docTitle: string | null } | null,
  applicability?: {
    state: DocumentApplicabilityState;
    applicabilityVerified: boolean;
    documentProduct: string | null;
  } | null,
): AttachmentInstallationAuthority {
  const proj = projectStructural(snap);
  const spacing = proj.spacingAuthority;
  // TAC WS-4 — when the CALLER supplies the document applicability explicitly
  // (the drafting stack does, from the decided document authority), the fastener
  // verdict must be computed against THAT same fact rather than re-reading the
  // snapshot region independently: two different applicability inputs inside one
  // authority object is precisely the split-brain this workstream removes.
  const fastener = projectFastenerAssemblyFromSnapshot(
    snap, mountingSystemId,
    applicability ? { documentApplicabilityVerified: applicability.applicabilityVerified } : undefined,
  );
  const mount = mountingSystemId ? getMountingSystemById(mountingSystemId) : undefined;
  const ra = proj.rackingAssembly as (RackingAssemblyRecord & {
    assemblyVerification?: {
      railSku?: 'verified' | 'pending' | 'unverified';
      fastener?: 'verified' | 'pending' | 'unverified';
      overall?: 'verified' | 'pending';
    };
    capacityProvenance?: { sourceDocument?: { archivedInRepo?: boolean; documentHash?: string | null } };
  }) | null;

  const selectedModel = ra?.mountModel ?? mount?.mount?.model ?? mount?.model ?? null;
  const documentApplicability = applicability
    ? {
        state: applicability.state,
        applicabilityVerified: applicability.applicabilityVerified,
        selectedModel,
        documentProduct: applicability.documentProduct,
        documentTitle: asset?.docTitle ?? null,
      }
    : null;

  // 1 — exact SKU selected. The mount SKU is honestly null on the canonical
  //     record while unpinned (RT-MINI: `mountSku: null`), and a rail-based
  //     assembly additionally needs its rail SKU pinned.
  const _railPending = ra
    ? (ra.railSku == null && (ra.railModel == null || /PENDING/i.test(ra.railModel)))
    : true;
  const exactSkuSelected = !!ra && ra.mountSku != null && !_railPending;
  // 2 — document applicability. No cited document ⇒ nothing authorizes exact
  //     manufacturer instructions either (fail closed).
  const documentApplicabilityVerified = documentApplicability?.applicabilityVerified === true;
  // 3 — archived + hash-bound source document.
  const _srcDoc = ra?.capacityProvenance?.sourceDocument ?? null;
  const documentArchivedHashBound = !!_srcDoc?.archivedInRepo
    && !!_srcDoc?.documentHash && String(_srcDoc.documentHash).trim().length >= 16;
  // 4 — the fastener assembly itself.
  const fastenerAssemblyVerified = fastener.verification === 'verified';
  // 5 — the selection rides on the CURRENT digested snapshot (the record is part
  //     of this snapshot's digest), not a stale sidecar.
  const selectionBoundToCurrentDigest = !!snap?.meta?.digest && !!ra;

  const exactInstructionsAllowed = exactSkuSelected
    && documentApplicabilityVerified
    && documentArchivedHashBound
    && fastenerAssemblyVerified
    && selectionBoundToCurrentDigest;

  const _docLine = documentApplicability
    ? (documentApplicability.applicabilityVerified
        ? `DOCUMENT APPLICABILITY: VERIFIED FOR SELECTED ${fmtStr(selectedModel).toUpperCase()}`
        : `DOCUMENT APPLICABILITY: ${fmtStr(documentApplicability.documentProduct).toUpperCase()} MANUAL NOT VERIFIED FOR SELECTED ${fmtStr(selectedModel).toUpperCase()}`)
    : 'DOCUMENT APPLICABILITY: NO VERSION-EXACT MANUFACTURER DOCUMENT ON FILE';

  // Post-AAC (WS-8 alignment): the fastener status line is STATE-DERIVED.
  // Printing "PENDING VERIFIED SELECTION" while SCHED/APP-A/PE-1 print the
  // verified fastener line would be a cross-sheet contradiction — when the
  // fastener ELEMENT is verified but exact instructions stay gated (SKU /
  // document authority), the label says exactly that. ONE label, consumed by
  // this block AND the lib/drafting descriptor surfaces.
  const fastenerStateLabel = fastenerAssemblyVerified
    ? 'VERIFIED — EXACT INSTALLATION INSTRUCTIONS PENDING DOCUMENT/SKU AUTHORITY'
    : 'PENDING VERIFIED SELECTION';
  const pendingLines = exactInstructionsAllowed ? [] : [
    `FASTENER ASSEMBLY: ${fastenerStateLabel}`,
    'INSTALLATION DETAILS: NOT ESTABLISHED',
    _docLine,
    REFERENCE_DETAIL_BANNER,
  ];

  const _designStr = spacing.designSpacingIn != null
    ? String(Math.round(spacing.designSpacingIn)) : EMDASH;
  const mountAssemblyState: 'verified' | 'pending' | 'unverified' =
    !ra ? 'unverified' : (exactSkuSelected && fastenerAssemblyVerified ? 'verified' : 'pending');
  const rackingAssemblyState: 'verified' | 'pending' | 'unverified' =
    !ra ? 'unverified' : (ra.assemblyVerification?.overall === 'verified' ? 'verified' : 'pending');

  return {
    spacing, fastener, documentApplicability,
    conditions: {
      exactSkuSelected, documentApplicabilityVerified, documentArchivedHashBound,
      fastenerAssemblyVerified, selectionBoundToCurrentDigest,
    },
    mountAssemblyState, rackingAssemblyState,
    exactInstructionsAllowed, fastenerStateLabel, pendingLines,
    referenceDetailBanner: exactInstructionsAllowed ? null : REFERENCE_DETAIL_BANNER,
    spacingDesignLine: spacing.designLabel,
    spacingStatusLine: spacing.statusLabel,
    spacingLine: `${spacing.designLabel} / STATUS: ${spacing.statusLabel}`,
    spacingShortLabel: spacing.verificationState === 'verified'
      ? `${_designStr}" O.C. (VERIFIED)`
      : `${_designStr}" O.C. (DESIGN)`,
  };
}
