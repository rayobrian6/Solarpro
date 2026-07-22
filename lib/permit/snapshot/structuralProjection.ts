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
  StructuralReactionReconciliation,
} from './types';
import { peekSnapshot } from './read';

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
  attachmentCount: number | null;
  attachmentSpacingIn: number | null;
  railTotalFt: number | null;
  railCount: number | null;
  spliceCount: number | null;
  // module footprint (exact catalog dims — never generic 66×40)
  moduleWidthIn: number | null;
  moduleHeightIn: number | null;
  // banner (§12)
  banner: StructuralBanner;
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
}

const STRUCTURAL_BLOCKER_CODES = new Set([
  'STRUCTURAL-FRAMING-UNVERIFIED',
  'ATTACHMENT-CAPACITY-SOURCE-MISSING',
  'FASTENER-CONFIG-MISSING',
  'MIXED-MANUFACTURER-ASSEMBLY-UNSUPPORTED',
  'WIND-SNOW-AUTHORITY-UNRESOLVED',
  'REACTIONS-UNTRACEABLE',
  'STRUCTURAL-REACTION-RECONCILIATION-FAILED',
  'RAIL-QUANTITY-UNTRACEABLE',
  'STRUCTURAL-UTILIZATION-EXCEEDED',
  'SITE-GEOMETRY-MISSING',
  'MODULE-DIMENSIONS-UNVERIFIED',
  'RACKING-CAPACITY-SOURCE-NOT-ARCHIVED',
  'RACKING-CAPACITY-APPLICABILITY-GAP',
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
 *  shows whenever readiness is false OR any structural blocker is present. */
export function structuralBanner(snap: PermitDesignSnapshot | null | undefined): StructuralBanner {
  const blockers = snap?.permitReadiness?.blockers ?? [];
  const structuralBlockers = blockers.filter(b => STRUCTURAL_BLOCKER_CODES.has(b.code));
  const notReady = snap ? snap.permitReadiness.ready === false : false;
  return {
    show: notReady || structuralBlockers.length > 0,
    line1: BANNER_LINE_1,
    line2: BANNER_LINE_2,
    blockers,
    structuralBlockers,
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
  return {
    present: !!snap,
    env,
    checks: st?.checks ?? [],
    attachments: st?.attachments ?? [],
    rails: st?.rails ?? [],
    moduleInstances: mi,
    roofPlaneObjects: geo?.roofPlaneObjects ?? [],
    rackingAssembly: st?.rackingAssembly ?? null,
    engine: st?.engine ?? null,
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
    attachmentCount: st?.attachmentCount ?? null,
    attachmentSpacingIn: st?.attachmentSpacingIn ?? null,
    railTotalFt: st?.railTotalFt ?? null,
    railCount: st?.railCount ?? null,
    spliceCount: st?.spliceCount ?? null,
    moduleWidthIn: mod0?.widthIn ?? null,
    moduleHeightIn: mod0?.heightIn ?? null,
    banner: structuralBanner(snap),
  };
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
