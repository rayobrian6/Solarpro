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
import { observedFramingLine, observedSourceLabel } from './framingAuthority';
import { environmentalSourceLabel, environmentalStateTag } from './environmentalAuthority';
import { peekSnapshot } from './read';
import { projectReleaseGates, releasePackageLine, type ReleaseSummary } from './releaseGates';
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

export interface StructuralBanner {
  /** true ⇒ the planset must visibly print the PENDING / NOT-FOR-SUBMISSION lines. */
  show: boolean;
  line1: string;   // 'PENDING STRUCTURAL ENGINEERING REVIEW'
  line2: string;   // 'NOT FOR PERMIT SUBMISSION'
  /** the permit-readiness blocker codes/messages driving the banner. */
  blockers: { code: string; message: string }[];
  /** structural-specific subset (framing / capacity / wind-snow / etc.). */
  structuralBlockers: { code: string; message: string }[];
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

export const BANNER_LINE_1 = 'PENDING STRUCTURAL ENGINEERING REVIEW';
export const BANNER_LINE_2 = 'NOT FOR PERMIT SUBMISSION';

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
  const blockers = (registry && registry.length)
    ? registry.filter(r => !r.resolved).map(r => ({ code: r.code, message: r.explanation }))
    : (snap?.permitReadiness?.blockers ?? []);
  const structuralBlockers = blockers.filter(b => STRUCTURAL_BLOCKER_CODES.has(b.code));
  const notReady = snap ? snap.permitReadiness.ready === false : false;
  // RGM §4 — the gate model is a deterministic projection of the SAME registry
  // this banner reads; nothing is re-derived and no requirement is filtered out.
  const release = snap ? projectReleaseGates(snap) : null;
  return {
    show: notReady || structuralBlockers.length > 0,
    line1: BANNER_LINE_1,
    line2: BANNER_LINE_2,
    blockers,
    structuralBlockers,
    releaseSummary: release ? release.summary : null,
    releasePackageLine: release ? releasePackageLine(release.summary) : '',
  };
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
  const framingUnverified = !(framingCapacityAuthority && framingCapacityAuthority.verified === true);
  const _base = {
    present: !!snap,
    env,
    checks: st?.checks ?? [],
    attachments: st?.attachments ?? [],
    rails: st?.rails ?? [],
    moduleInstances: mi,
    roofPlaneObjects: geo?.roofPlaneObjects ?? [],
    rackingAssembly: st?.rackingAssembly ?? null,
    engine: st?.engine ?? null,
    framingObservation,
    framingCapacityAuthority,
    framingUnverified,
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

const _fracFast = (v: number | null | undefined): string | null =>
  v == null || !isFinite(v) ? null
    : v === 0.25 ? '1/4' : v === 0.3125 ? '5/16' : v === 0.375 ? '3/8' : v === 0.5 ? '1/2' : String(v);

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
  const substrate = ra?.installationCondition ?? null;
  const rafterDeckMethod = ra?.rafterDeckAttachmentMethod ?? m?.attachmentMethod ?? null;
  // Material / head-drive are NOT carried in mounting-hardware-db — honest nulls.
  const material: string | null = null;
  const headDrive: string | null = null;
  const sourceDocument = ra?.datasheetSource ?? ra?.capacitySource ?? mount?.iccEsReport ?? null;

  const vFast = ra?.assemblyVerification?.fastener;
  const verification: FastenerAssembly['verification'] =
    !present ? 'pending'
      : (proj.capacityGated ? 'unverified'
        : (vFast === 'verified' && !!sourceDocument ? 'verified' : 'unverified'));

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
    state: 'verified' | 'unverified';
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
  applicability?: { state: 'verified' | 'unverified'; documentProduct: string | null } | null,
): AttachmentInstallationAuthority {
  const proj = projectStructural(snap);
  const spacing = proj.spacingAuthority;
  const fastener = projectFastenerAssemblyFromSnapshot(snap, mountingSystemId);
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
  const documentApplicabilityVerified = documentApplicability?.state === 'verified';
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
    ? (documentApplicability.state === 'verified'
        ? `DOCUMENT APPLICABILITY: VERIFIED FOR SELECTED ${fmtStr(selectedModel).toUpperCase()}`
        : `DOCUMENT APPLICABILITY: ${fmtStr(documentApplicability.documentProduct).toUpperCase()} MANUAL NOT VERIFIED FOR SELECTED ${fmtStr(selectedModel).toUpperCase()}`)
    : 'DOCUMENT APPLICABILITY: NO VERSION-EXACT MANUFACTURER DOCUMENT ON FILE';

  const pendingLines = exactInstructionsAllowed ? [] : [
    'FASTENER ASSEMBLY: PENDING VERIFIED SELECTION',
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
    exactInstructionsAllowed, pendingLines,
    referenceDetailBanner: exactInstructionsAllowed ? null : REFERENCE_DETAIL_BANNER,
    spacingDesignLine: spacing.designLabel,
    spacingStatusLine: spacing.statusLabel,
    spacingLine: `${spacing.designLabel} / STATUS: ${spacing.statusLabel}`,
    spacingShortLabel: spacing.verificationState === 'verified'
      ? `${_designStr}" O.C. (VERIFIED)`
      : `${_designStr}" O.C. (DESIGN)`,
  };
}
