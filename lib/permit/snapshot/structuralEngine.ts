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
import type { StructuralCheck, StructuralEngineResult, LimitState } from './types';
import type { StructuralResultV4, StructuralInputV4 } from '@/lib/structural-engine-v4';
import { MIN_ATTACHMENT_SF } from '@/lib/structural/attachmentCapacity';

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

/** Framing is VERIFIED only when the operator supplied every authority the
 *  rafter/truss capacity depends on. Any default ⇒ unverified (review required).*/
export function isFramingVerified(f: FramingInputs): boolean {
  return !!(f.framingType && f.rafterSize && f.rafterSpacing && f.rafterSpecies && f.rafterSpan);
}

export function runSnapshotStructuralEngine(
  result: StructuralResultV4 | null | undefined,
  input: StructuralInputV4 | null | undefined,
  framing: FramingInputs,
): StructuralEngineOutput {
  const prov = { source: 'snapshot structural engine (over canonical objects)' };
  const framingVerified = isFramingVerified(framing);

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

  // ── §8 framing-capacity limit state — HONEST ────────────────────────────
  const reviewReasons: string[] = [];
  if (framingVerified) {
    checks.push({
      checkId: 'chk-framing-capacity',
      limitState: 'framing-capacity',
      demand: round(raf.bendingMomentDemandFtLbs), capacity: round(raf.bendingMomentCapacityFtLbs),
      dcRatio: round(raf.overallUtilization), safetyFactor: null,
      requiredThreshold: 1.0, thresholdKind: 'max-dc-ratio',
      passes: raf.overallUtilization <= 1.0,
      governingSource: `structural-engine-v4 rafterAnalysis (${raf.framingType} ${raf.size} @ ${raf.spacingIn}" ${raf.species})`,
      provenance: prov,
    });
  } else {
    const missing: string[] = [];
    if (!framing.framingType) missing.push('framing type');
    if (!framing.rafterSize) missing.push('rafter/truss size');
    if (!framing.rafterSpacing) missing.push('member spacing');
    if (!framing.rafterSpecies) missing.push('species/grade');
    if (!framing.rafterSpan) missing.push('clear span');
    reviewReasons.push(
      `Roof framing UNVERIFIED — ${missing.join(', ')} defaulted. The V4 rafter/truss capacity `
      + `is computed from NDS/BCSI defaults and is NOT engineering authority; a licensed structural `
      + `review of the existing framing is required before permit submission.`);
    checks.push({
      checkId: 'chk-framing-capacity',
      limitState: 'framing-capacity',
      demand: null, capacity: null, dcRatio: null, safetyFactor: null,
      requiredThreshold: 1.0, thresholdKind: 'max-dc-ratio',
      passes: null,
      governingSource: 'ENGINEERING REVIEW REQUIRED — framing size/spacing/species/span not verified '
        + '(V4 default truss/rafter capacity is not authority)',
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
