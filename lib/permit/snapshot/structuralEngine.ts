// ═══════════════════════════════════════════════════════════════════════════
// W3 §8/§9 — Structural engine over the CANONICAL physical objects.
// Computes dead loads, attachment reactions/capacity checks and rail
// span/bending checks from the V4 engine-of-record result. Produces one
// StructuralCheck per limit state (demand, capacity, D/C, SF, threshold,
// pass, governing source).
//
// FRAMING HONESTY (Braidon): when framing size/spacing/species/span authority
// is insufficient (all defaulted), the framing-capacity limit state is emitted
// as NOT VERIFIABLE (passes:null) and engineeringReviewRequired is set — the V4
// rafter/truss capacity (computed off the fabricated TRUSS_CAPACITY_PSF/NDS
// defaults) is NEVER reported as a verified pass. No generic truss table.
// ═══════════════════════════════════════════════════════════════════════════
import type {
  StructuralCheck, StructuralEngineResult, LimitState, AttachmentObject, StructuralEnv,
  FramingCapacityAuthority,
} from './types';
import type { StructuralResultV4, StructuralInputV4 } from '@/lib/structural-engine-v4';
import { MIN_ATTACHMENT_SF, ASD_WIND_FACTOR } from '@/lib/structural/attachmentCapacity';

export interface FramingInputs {
  framingType?: string | null;
  rafterSize?: string | null;
  rafterSpacing?: number | null;
  rafterSpecies?: string | null;
  rafterSpan?: number | null;
}

export interface StructuralEngineOutput {
  engine: StructuralEngineResult;
  checks: StructuralCheck[];
  framingVerified: boolean;
}

/** FRAMING-AUTHORITY GATE (2026-07-23): framing is VERIFIED **only** when a
 *  FramingCapacityAuthority record exists (a verified + archived project-applicable
 *  document, or a digest-bound licensed-engineer review). Operator-entered field
 *  COMPLETENESS is OBSERVATION, never capacity authority — a fully-typed truss /
 *  2x6 / 24" / DF-L / 12 ft does NOT verify on its own. */
export function isFramingVerified(capacityAuthority: FramingCapacityAuthority | null | undefined): boolean {
  return !!(capacityAuthority && capacityAuthority.verified === true);
}

export function runSnapshotStructuralEngine(
  result: StructuralResultV4 | null | undefined,
  input: StructuralInputV4 | null | undefined,
  /** operator-entered / observed framing geometry — PRELIMINARY modeling input
   *  ONLY (describes the OBSERVED member; never verifies capacity). */
  framing: FramingInputs,
  /** the verified framing CAPACITY authority (or null). This — NOT `framing`
   *  completeness — decides verification (Ray's ruling). */
  capacityAuthority?: FramingCapacityAuthority | null,
): StructuralEngineOutput {
  const prov = { source: 'snapshot structural engine (over canonical objects)' };
  const framingVerified = isFramingVerified(capacityAuthority);

  if (!result || !input) {
    return {
      framingVerified,
      checks: [],
      engine: {
        moduleDeadLoadLbs: null, rackingDeadLoadLbs: null, addedDeadLoadPsf: null,
        distributedRoofLoadPsf: null, totalRailLoadLbsPerFt: null,
        governingUtilization: null, governingLimitState: null, passes: null,
        engineeringReviewRequired: true,
        reviewReasons: ['structural engine result unavailable — no roof analysis was produced'],
        provenance: prov,
      },
    };
  }

  const ml = result.mountLayout;
  const ra = result.railAnalysis;
  const raf = result.rafterAnalysis;
  const wind = result.wind;
  const checks: StructuralCheck[] = [];

  // ── §9 attachment uplift (ASD; verified regardless of framing) ──────────
  const attSf = ml.safetyFactor;
  const attDc = ml.mountCapacityLbs > 0 ? ml.upliftPerMountLbs / ml.mountCapacityLbs : null;
  checks.push({
    checkId: 'chk-attachment-uplift',
    limitState: 'attachment-uplift',
    demand: round(ml.upliftPerMountLbs), capacity: round(ml.mountCapacityLbs),
    dcRatio: round(attDc), safetyFactor: round(attSf),
    requiredThreshold: MIN_ATTACHMENT_SF, thresholdKind: 'min-safety-factor',
    passes: attSf >= MIN_ATTACHMENT_SF,
    governingSource: 'structural-engine-v4 calcMountLayout + attachmentCapacity (ASD, Ω-normalized allowable)',
    // W7 — one stated load basis; demand and allowable are BOTH ASD (never an
    // ASD-reaction-vs-strength-pressure comparison).
    loadBasis: {
      designMethod: 'ASD',
      windPressureBasis: `ASCE 7-22 §26/29 C&C, GOVERNING corner (Zone 3) applied uniformly — conservative screening envelope; net uplift ${round(wind?.netUpliftPressurePsf)} psf`,
      loadCombination: '0.6D + 0.6W (uplift)',
      zonePressurePsf: round(wind?.netUpliftPressurePsf),
      tributaryAreaFt2: round(ml.tributaryAreaPerMountFt2),
      reactionLbs: round(ml.upliftPerMountLbs),
      capacityBasis: 'ASD allowable (Ω-normalized; ultimate refused per attachmentCapacity)',
      adjustments: `0.6 ASD wind factor on demand; per-mount tributary ${round(ml.tributaryAreaPerMountFt2)} ft²`,
      tributaryModel: 'uniform CONSERVATIVE SCREENING ENVELOPE — full interior tributary charged at every mount (end mounts included)',
    },
    provenance: prov,
  });

  // ── §9 rail bending + span (only when a rail spec exists) ───────────────
  if (ra) {
    checks.push({
      checkId: 'chk-rail-bending',
      limitState: 'rail-bending',
      demand: round(ra.momentDemandInLbs), capacity: round(ra.momentCapacityInLbs),
      dcRatio: round(ra.utilizationRatio), safetyFactor: null,
      requiredThreshold: 1.0, thresholdKind: 'max-dc-ratio',
      passes: ra.utilizationRatio <= 1.0,
      governingSource: 'structural-engine-v4 analyzeRail (rail momentCapacity, mounting-hardware-db)',
      provenance: prov,
    });
    const spanDc = ra.maxAllowedSpanIn > 0 ? ra.railSpanIn / ra.maxAllowedSpanIn : null;
    checks.push({
      checkId: 'chk-rail-span',
      limitState: 'rail-span',
      demand: round(ra.railSpanIn), capacity: round(ra.maxAllowedSpanIn),
      dcRatio: round(spanDc), safetyFactor: null,
      requiredThreshold: 1.0, thresholdKind: 'max-dc-ratio',
      passes: ra.railSpanIn <= ra.maxAllowedSpanIn,
      governingSource: 'structural-engine-v4 analyzeRail (manufacturer maxSpanIn)',
      provenance: prov,
    });
  }

  // ── FRAMING-CAPACITY limit state — OBSERVATION vs CAPACITY AUTHORITY ─────
  // Verified ONLY when a FramingCapacityAuthority exists (archived applicable
  // document or digest-bound engineer review). Operator-entered geometry is
  // OBSERVATION and produces NO verdict — the framing check renders PRELIMINARY /
  // NON-AUTHORITATIVE (passes:null, no numeric capacity). The added-PV-load calcs
  // below are unaffected either way.
  const reviewReasons: string[] = [];
  if (framingVerified) {
    checks.push({
      checkId: 'chk-framing-capacity',
      limitState: 'framing-capacity',
      demand: round(raf.bendingMomentDemandFtLbs), capacity: round(raf.bendingMomentCapacityFtLbs),
      dcRatio: round(raf.overallUtilization), safetyFactor: null,
      requiredThreshold: 1.0, thresholdKind: 'max-dc-ratio',
      passes: raf.overallUtilization <= 1.0,
      governingSource: `verified framing CAPACITY authority (${capacityAuthority?.kind}${
        capacityAuthority?.documentClass ? ` — ${capacityAuthority.documentClass}` : ''}) `
        + `over rafterAnalysis (${raf.framingType} ${raf.size} @ ${raf.spacingIn}" ${raf.species})`,
      provenance: prov,
    });
  } else {
    reviewReasons.push(
      'EXISTING FRAMING CAPACITY NOT VERIFIED — no project-specific structural authority '
      + '(archived truss design drawing / manufacturer capacity calc / stamped analysis, or a '
      + 'licensed-engineer review bound to the current snapshot digest) establishes the existing '
      + 'framing capacity. Operator-entered / observed framing geometry is OBSERVATION only and does '
      + 'NOT verify capacity; the code-default rafter/truss capacity is NOT engineering authority. A '
      + 'project-specific structural review is required before permit submission.');
    checks.push({
      checkId: 'chk-framing-capacity',
      limitState: 'framing-capacity',
      // PRELIMINARY / NON-AUTHORITATIVE — no numeric framing capacity, no verdict.
      demand: null, capacity: null, dcRatio: null, safetyFactor: null,
      requiredThreshold: 1.0, thresholdKind: 'max-dc-ratio',
      passes: null,
      governingSource: 'PROJECT-SPECIFIC STRUCTURAL REVIEW REQUIRED — no verified framing capacity '
        + 'authority (operator-entered / observed geometry is not capacity authority; the code-default '
        + 'truss/rafter capacity is PRELIMINARY / NON-AUTHORITATIVE)',
      provenance: prov,
    });
  }

  // ── loads ───────────────────────────────────────────────────────────────
  const n = input.panelCount || 0;
  const moduleDeadLoadLbs = n * (input.panelWeightLbs || 0);
  const rackingDeadLoadLbs = n * (input.rackingWeightPerPanelLbs ?? 0);
  const tribWidthFt = (result.arrayGeometry.railSpacingIn / 2) / 12;
  const totalRailLoadLbsPerFt = raf.totalLoadPsf * tribWidthFt;

  // Governing utilization = max D/C over VERIFIED checks (framing excluded when
  // unverified — an unverifiable limit state cannot be the governing pass/fail).
  const verified = checks.filter(c => c.dcRatio != null);
  const governing = verified.reduce<StructuralCheck | null>(
    (best, c) => (best == null || (c.dcRatio ?? 0) > (best.dcRatio ?? 0)) ? c : best, null);
  const engineeringReviewRequired = !framingVerified || reviewReasons.length > 0;
  const anyVerifiedFail = checks.some(c => c.passes === false);

  const engine: StructuralEngineResult = {
    moduleDeadLoadLbs: round(moduleDeadLoadLbs),
    rackingDeadLoadLbs: round(rackingDeadLoadLbs),
    addedDeadLoadPsf: round(result.addedDeadLoadPsf),
    distributedRoofLoadPsf: round(raf.totalLoadPsf),
    totalRailLoadLbsPerFt: round(totalRailLoadLbsPerFt),
    governingUtilization: round(governing?.dcRatio ?? null),
    governingLimitState: (governing?.limitState as LimitState) ?? null,
    // Cannot certify PASS while framing is unverified — honest null, not a green.
    passes: engineeringReviewRequired ? null : !anyVerifiedFail,
    engineeringReviewRequired,
    reviewReasons,
    provenance: prov,
  };

  return { engine, checks, framingVerified };
}

function round(n: number | null | undefined): number | null {
  if (n == null || !isFinite(n)) return null;
  return Math.round(n * 1000) / 1000;
}

// ═══════════════════════════════════════════════════════════════════════════
// §8 — ATTACHMENT-REACTION RECONCILIATION.
//
// The package showed 636.48 ft² array area, 55.95 psf net uplift and 64
// attachments but printed 369 lb/attachment — three numbers from three models
// that never closed (a reader multiplying area × psf ÷ count expects ~556 lb;
// the 0.6 ASD factor and the per-mount tributary model both intervene). This
// reconciliation makes the relationship EXPLICIT and auditable, and BLOCKS when
// the canonical objects do not reconcile with the applied load:
//
//   • object count            — the canonical attachment objects must equal the
//     engine reaction-model mount count (the count the per-attachment reaction
//     was computed against). A divergence means the printed per-attachment load
//     is not traceable to the object set.
//   • Σ tributary vs array area — the per-mount tributary areas must at least
//     COVER the canonical module footprint (Σ ModuleInstance.areaFt2). The
//     uniform per-mount tributary is a CONSERVATIVE DESIGN envelope: every mount,
//     including the two end mounts per rail, is charged a FULL interior tributary
//     (s × w) even though an end mount physically carries a half-tributary — so
//     Σ tributary is EXPECTED to exceed the array area, more so on small / edge-
//     dominated arrays. The reconciliation therefore blocks when Σ < area (load
//     LOST → under-design) or when Σ is grossly above area (a doubled/duplicated
//     object model), and treats the conservative overcount in between as OK and
//     documented — it never falsely asserts equality where the design model is
//     legitimately conservative.
//   • Σ reactions vs applied × area — per limit state (uplift 0.6·W, snow, dead),
//     Σ per-attachment reaction must ENVELOPE applied pressure × array area
//     (same coverage rule: the conservative design sum ≥ the equilibrium load).
//
// Nothing is tuned to match: the per-attachment reactions stay exactly as the
// engine of record computed them; the reconciliation reports the closure and
// blocks on a genuine non-closure (lost load, gross error, or count mismatch).
// ═══════════════════════════════════════════════════════════════════════════

// W7 — the flat 3.0 "reconciliation band" is replaced by SEPARATE, principled
// validations (no single loose ceiling that would pass 2–3× object duplication):
//
//   • LOST-LOAD FLOOR (REACTION_CLOSURE_LOWER) — Σ tributary / Σ reactions must
//     COVER the array footprint / applied load. Below this ⇒ load lost ⇒
//     under-design. Hard floor.
//   • DUPLICATE-AREA GUARD (ENVELOPE_MAX_RATIO) — the CONSERVATIVE SCREENING
//     ENVELOPE charges every mount (end mounts included) a FULL interior
//     tributary. The theoretical maximum of that model is the all-end-mount
//     degenerate case: each mount charged a full tributary where it physically
//     carries half ⇒ ratio → 2.0. A ratio ABOVE 2× therefore cannot come from
//     the envelope's end-mount overcount — it signals duplicated / doubled
//     objects (a real object-model error). Small epsilon so the degenerate
//     one-span rail is not false-flagged.
//   • COUNT AGREEMENT — canonical attachment objects === engine reaction-model
//     mount count (hard for rail-based; informational for geometry-derived
//     direct-mount).
//   • EXACT-CLOSURE tolerance would apply only to a TRUE per-position geometric
//     model; this package uses the labeled screening envelope, so the envelope
//     bounds above govern (documented, intentional Σ ≥ area overage).
export const REACTION_CLOSURE_LOWER = 0.98;
/** Duplicate/doubled-object ceiling (see above). 2.0 = the all-end-mount
 *  degenerate limit of the uniform full-interior-tributary screening envelope. */
export const ENVELOPE_MAX_RATIO = 2.05;
/** @deprecated retained for the schedule footer's displayed band; equals the
 *  duplicate-area guard. The former flat 3.0 gross-error ceiling is removed. */
export const REACTION_CLOSURE_UPPER = ENVELOPE_MAX_RATIO;

export interface ReactionReconCheck {
  name: string;
  limitState: LimitState | 'geometry' | 'count' | 'snow' | 'dead';
  expected: number | null;   // applied load × array area (or array area / model count)
  actual: number | null;     // Σ over canonical attachment objects
  ratio: number | null;      // actual / expected
  ok: boolean;
  basis: string;
}

export interface StructuralReactionReconciliation {
  ok: boolean;
  present: boolean;
  attachmentCount: number;
  reactionModelCount: number | null;   // engine mount count the reactions were computed against
  arrayAreaFt2: number | null;         // Σ canonical module footprint areas
  tributarySumFt2: number | null;      // Σ attachment tributary areas
  appliedUpliftPsfAsd: number | null;  // 0.6 × net C&C uplift (ASD demand basis)
  appliedSnowPsf: number | null;
  appliedDeadPsf: number | null;
  upliftReactionSumLbs: number | null;
  snowReactionSumLbs: number | null;
  deadReactionSumLbs: number | null;
  tolerance: { lower: number; upper: number };
  checks: ReactionReconCheck[];
  note: string;
}

const rr3 = (n: number | null | undefined): number | null =>
  (n == null || !isFinite(n)) ? null : Math.round(n * 1000) / 1000;

/**
 * Reconcile the canonical attachment reactions back to the applied load (§8).
 * Pure: reads the attachment objects, the module footprints (array area), the
 * structural env (applied pressures) and the engine result (reaction-model mount
 * count). Returns `present:false` (ok:true) for non-roof / object-less systems so
 * it never fabricates a failure where there is no attachment model.
 */
export function reconcileReactions(
  attachments: AttachmentObject[],
  /** Array footprint SCOPED to the modules these attachments support (Σ areaFt2
   *  of the supported instances) — NOT all module instances, so a hybrid roof
   *  run (roof-scoped attachments) reconciles against the roof modules, never the
   *  whole multi-sub-array footprint. Computed by the caller. */
  scopedArrayAreaFt2: number,
  env: StructuralEnv | null | undefined,
  engineMountCount: number | null | undefined,
  addedDeadLoadPsf: number | null | undefined,
  /** true when the engine reaction model covers the SAME module scope as the
   *  supplied array area. On a hybrid the roof run is roof-scoped while the module
   *  objects span every sub-array, so the AREA cross-checks would compare
   *  mismatched scopes — they are then INFORMATIONAL (never blocking), exactly as
   *  the §10 BOM reconciliation caveats the V4 producer. The object-COUNT check
   *  stays a hard invariant regardless. Defaults to true (single-system). */
  scopeMatched = true,
): StructuralReactionReconciliation {
  const tol = { lower: REACTION_CLOSURE_LOWER, upper: REACTION_CLOSURE_UPPER };
  const empty = (note: string): StructuralReactionReconciliation => ({
    ok: true, present: false, attachmentCount: attachments.length,
    reactionModelCount: engineMountCount ?? null, arrayAreaFt2: null, tributarySumFt2: null,
    appliedUpliftPsfAsd: null, appliedSnowPsf: null, appliedDeadPsf: null,
    upliftReactionSumLbs: null, snowReactionSumLbs: null, deadReactionSumLbs: null,
    tolerance: tol, checks: [], note,
  });
  if (attachments.length === 0) return empty('no canonical attachment objects — reaction reconciliation not applicable');

  const arrayAreaFt2 = scopedArrayAreaFt2;
  const tributarySum = attachments.reduce((s, a) => s + (a.tributaryAreaFt2 ?? 0), 0);
  const upliftSum = attachments.reduce((s, a) => s + (a.upliftReactionLbs ?? 0), 0);
  const snowSum = attachments.reduce((s, a) => s + (a.snowReactionLbs ?? 0), 0);
  const deadSum = attachments.reduce((s, a) => s + (a.deadReactionLbs ?? 0), 0);

  const appliedUpliftAsd = env?.upliftPressurePsf != null ? ASD_WIND_FACTOR * env.upliftPressurePsf : null;
  const appliedSnow = env?.roofSnowPsf ?? null;
  const appliedDead = addedDeadLoadPsf ?? null;

  const checks: ReactionReconCheck[] = [];
  // W7 — SEPARATE validations, not one flat band. Area/reaction closure is a hard
  // check only when the reaction model and the array-area scope match; otherwise
  // it is informational (documented hybrid caveat).
  const floorOk = (ratio: number | null): boolean =>
    !scopeMatched || (ratio != null && isFinite(ratio) && ratio >= tol.lower);
  const ceilOk = (ratio: number | null): boolean =>
    !scopeMatched || (ratio != null && isFinite(ratio) && ratio <= ENVELOPE_MAX_RATIO);
  const envelopeOk = (ratio: number | null): boolean => floorOk(ratio) && ceilOk(ratio);

  // (1) object count vs the engine reaction-model mount count. HARD for a
  // rail-based array (attachments === engine calcMountLayout mountCount). For a
  // rail-LESS / direct-mount array the attachment count is geometry-derived
  // (per-module mount points), NOT the engine rail-grid count, so the comparison
  // is informational there — its area check (Σ tributary === array area exactly)
  // is the authority.
  const directMount = attachments.some(a => a.railId === '' || a.supportedModuleId != null);
  checks.push({
    name: 'attachment-count-vs-reaction-model', limitState: 'count',
    expected: engineMountCount ?? null, actual: attachments.length,
    ratio: engineMountCount ? rr3(attachments.length / engineMountCount) : null,
    ok: directMount || engineMountCount == null ? true : attachments.length === engineMountCount,
    basis: directMount
      ? 'direct-mount: attachment count is geometry-derived (per-module mount points), not the engine rail-grid count — informational'
      : 'canonical attachment objects === engine calcMountLayout mountCount (per-attachment reaction basis)',
  });

  // (2a) LOST-LOAD FLOOR — Σ tributary must COVER the array footprint (Σ ≥ area).
  const tribRatio = arrayAreaFt2 > 0 ? tributarySum / arrayAreaFt2 : null;
  checks.push({
    name: 'tributary-lost-load-floor', limitState: 'geometry',
    expected: rr3(arrayAreaFt2), actual: rr3(tributarySum), ratio: rr3(tribRatio),
    ok: floorOk(tribRatio),
    basis: 'lost-load prevention: Σ attachment.tributaryAreaFt2 must COVER the module footprint (Σ ≥ array area). '
      + 'The uniform CONSERVATIVE SCREENING ENVELOPE charges a full interior tributary at every mount, so Σ ≥ area is intentional.',
  });
  // (2b) DUPLICATE-AREA GUARD — Σ tributary must not exceed the envelope's
  // all-end-mount theoretical limit (≈2× area); above ⇒ doubled/duplicated objects.
  checks.push({
    name: 'tributary-duplicate-area-guard', limitState: 'geometry',
    expected: rr3(arrayAreaFt2 * ENVELOPE_MAX_RATIO), actual: rr3(tributarySum), ratio: rr3(tribRatio),
    ok: ceilOk(tribRatio),
    basis: `duplicate-area prevention: Σ tributary ≤ ${ENVELOPE_MAX_RATIO}× array area. The screening envelope's `
      + 'end-mount overcount tops out at the all-end-mount 2× degenerate; a ratio above that signals duplicated attachment objects, not conservatism.',
  });

  // (3) Σ uplift reaction envelopes 0.6·W × array area (ASD demand basis).
  const expUplift = appliedUpliftAsd != null ? appliedUpliftAsd * arrayAreaFt2 : null;
  const upRatio = expUplift && expUplift > 0 ? upliftSum / expUplift : null;
  checks.push({
    name: 'uplift-reactions-vs-applied', limitState: 'attachment-uplift',
    expected: rr3(expUplift), actual: rr3(upliftSum), ratio: rr3(upRatio),
    ok: appliedUpliftAsd == null ? true : envelopeOk(upRatio),
    basis: 'Σ upliftReactionLbs envelopes 0.6·(net C&C uplift psf) × array area (screening envelope: ≥ applied, ≤ 2×)',
  });

  // (4) Σ snow reaction envelopes roof snow psf × array area.
  const expSnow = appliedSnow != null ? appliedSnow * arrayAreaFt2 : null;
  const snowRatio = expSnow && expSnow > 0 ? snowSum / expSnow : null;
  if (appliedSnow != null && appliedSnow > 0) {
    checks.push({
      name: 'snow-reactions-vs-applied', limitState: 'snow',
      expected: rr3(expSnow), actual: rr3(snowSum), ratio: rr3(snowRatio),
      ok: envelopeOk(snowRatio),
      basis: 'Σ snowReactionLbs envelopes roof snow psf × array area (screening envelope: ≥ applied, ≤ 2×)',
    });
  }

  // (5) Σ dead reaction envelopes added dead psf × array area.
  const expDead = appliedDead != null ? appliedDead * arrayAreaFt2 : null;
  const deadRatio = expDead && expDead > 0 ? deadSum / expDead : null;
  if (appliedDead != null && appliedDead > 0) {
    checks.push({
      name: 'dead-reactions-vs-applied', limitState: 'dead',
      expected: rr3(expDead), actual: rr3(deadSum), ratio: rr3(deadRatio),
      ok: envelopeOk(deadRatio),
      basis: 'Σ deadReactionLbs envelopes added dead-load psf × array area (screening envelope: ≥ applied, ≤ 2×)',
    });
  }

  const ok = checks.every(c => c.ok);
  const scopeNote = scopeMatched ? '' : ' Array/reaction closure is INFORMATIONAL here: the roof reaction '
    + 'model scope differs from the module-object scope (hybrid roof run is roof-scoped) — the object-count '
    + 'check remains the hard invariant.';
  return {
    ok, present: true,
    attachmentCount: attachments.length, reactionModelCount: engineMountCount ?? null,
    arrayAreaFt2: rr3(arrayAreaFt2), tributarySumFt2: rr3(tributarySum),
    appliedUpliftPsfAsd: rr3(appliedUpliftAsd), appliedSnowPsf: rr3(appliedSnow), appliedDeadPsf: rr3(appliedDead),
    upliftReactionSumLbs: rr3(upliftSum), snowReactionSumLbs: rr3(snowSum), deadReactionSumLbs: rr3(deadSum),
    tolerance: tol, checks,
    note: ok
      ? `Reactions reconcile under the CONSERVATIVE SCREENING ENVELOPE: ${attachments.length} attachments, Σ design `
        + `tributary ${rr3(tributarySum)} ft² covers the array footprint ${rr3(arrayAreaFt2)} ft² (×${rr3(tribRatio)}). `
        + `This is NOT an exact geometric closure: every mount — end mounts included — is charged a FULL interior `
        + `tributary, so Σ ≥ area is intentional and documented. Validated by separate checks (lost-load floor Σ ≥ area; `
        + `duplicate-area guard Σ ≤ ${ENVELOPE_MAX_RATIO}× area; per-limit-state reaction envelope; object-count agreement) `
        + `— not a single loose band.${scopeNote}`
      : `Reactions DO NOT reconcile with the applied load — ${checks.filter(c => !c.ok).map(c => c.name).join(', ')}. `
        + `The per-attachment reaction is not traceable to the canonical object set / array footprint `
        + `(load lost below the footprint, a gross object-model overcount, or an object-count mismatch).`,
  };
}
