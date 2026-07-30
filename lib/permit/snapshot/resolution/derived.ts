// ═══════════════════════════════════════════════════════════════════════════
// AAC WS-5 / WS-7 — THE DERIVED (DESIGN-GEOMETRY) RESOLVER STAGE.
//
// WHY A SECOND STAGE, AND WHY IT IS NOT A SECOND FRAMEWORK
// ────────────────────────────────────────────────────────
// The async lifecycle (`resolution/lifecycle.ts`) runs in the ONE genuinely
// async seam — the permit route, BEFORE generation — because its resolvers query
// stores and providers. The electrical + Q-Cable requirements are a different
// class: they are DETERMINISTIC CALCULATIONS FROM THE DESIGN GEOMETRY, and the
// design geometry (the CAD model, the canonical electrical engine result, the
// layout's module instances and branch assignment) does not exist until the
// snapshot build is running. The directive's own lifecycle puts them exactly
// here: "deterministic calculations from design geometry → propagate
// configuration → recalculate → retry resolvers → build the REMAINING registry".
// The registry is built at the END of the snapshot build, so a resolver that
// runs during the build still precedes it.
//
// So this stage runs SYNCHRONOUSLY inside the build, on the same framework
// types: the same `ClearanceResult`, the same `ResolutionEvidenceRecord`, the
// same `buildResolutionAuditRef` contract (a clear with no audit reference is
// not a resolution — releaseGates.deriveRequirementStatus keeps it OPEN), and
// the same `RequirementResolutionState` shape the RS-1 payload machinery already
// renders. Its states MERGE with the async lifecycle's states; nothing is
// duplicated and no requirement is resolved in two places.
//
// EVERY resolver here performs real work. There is no placeholder.
// ═══════════════════════════════════════════════════════════════════════════

import { buildResolutionAuditRef } from './evidence';
import type {
  ClearanceResult, RequirementResolutionState, ResolutionEvidenceRecord,
  ResolutionMode, ResolutionResult, Retryability,
} from './types';
import { REQUIREMENT_DECLARATIONS } from '../releaseGates';
import type { ConduitFillEvaluation } from '../conduitFillAuthority';
import type {
  PhysicalRacewayRecord, ProcurementSufficiency, QCableSolutionEvaluation, QCableTopology,
  RouteSegmentRecord,
} from '../types';

/** The ids the DERIVED stage owns. `validateResolutionDeclarations` accepts a
 *  declaration that names one of these without demanding it in the async
 *  registry (it runs in the build, not in the route's async lifecycle). */
export const DERIVED_RESOLVER_IDS = [
  'conduit-fill@v1',
  'route-length@v1',
  'raceway-authority@v1',
  'qcable-topology@v1',
  'qcable-solution@v1',
] as const;
export type DerivedResolverId = (typeof DERIVED_RESOLVER_IDS)[number];

export interface DerivedResolverAttempt {
  resolverId: DerivedResolverId;
  mode: ResolutionMode;
  /** the codes this attempt bears on; the OWNER writes the audit ref. */
  requirementCodes: string[];
  result: ResolutionResult;
  clearance: ClearanceResult;
  /** true ⇔ this resolver OWNS the code (only an owner may clear it). */
  owns: boolean;
  sourceQueried: string;
  sourceRefs: string[];
  inputs: Record<string, string | number | boolean | null>;
  failureReason: string | null;
  retryability: Retryability;
  operatorAction: string | null;
  confidence: number | null;
  /** the residual mode when the automatic portion resolved but a genuine
   *  field/professional remainder survives (the SPLIT codes). */
  residualMode?: ResolutionMode | null;
}

export interface DerivedResolutionOutcome {
  states: Record<string, RequirementResolutionState>;
  evidence: ResolutionEvidenceRecord[];
  attempts: DerivedResolverAttempt[];
  /** requirement codes the stage CLEARED (with an audit reference). */
  clearedCodes: string[];
}

export interface DerivedResolutionContext {
  /** deterministic timestamp (the snapshot's own capture time — never Date.now). */
  nowIso: string;
  /** WS-7 — the conduit-fill completeness + result evaluation. */
  conduitFill: ConduitFillEvaluation | null;
  /** the canonical route segments (post-derivation). */
  routeSegments: RouteSegmentRecord[];
  physicalRaceways: PhysicalRacewayRecord[];
  /** true ⇔ the canonical feeder segment resolved a raceway type. */
  feederRacewayResolved: boolean;
  /** micro design ⇒ the branch raceway model is evaluated. */
  isMicro: boolean;
  /** the branch-raceway ambiguity verdict computed from the segment objects. */
  branchRacewayAmbiguous: boolean;
  branchRacewayReasons: string[];
  /** segment ids that resolve to more than one raceway type/size. */
  racewaySegmentConflicts: string[];
  /** WS-5 — the deterministic topology object (null for non-micro). */
  qcableTopology: QCableTopology | null;
  /** WS-5 — the option-space evaluation (null when no topology). */
  qcableEvaluation: QCableSolutionEvaluation | null;
  /** the sufficiency authority AFTER the evaluation was consumed. */
  procurementSufficiency: ProcurementSufficiency | null;
}

const ROUTE_GEOMETRY_SOURCES: RouteSegmentRecord['lengthSource'][] = ['cad-route', 'field-measurement'];

/** THE derived stage. Pure: identical inputs ⇒ identical states + evidence. */
export function runDerivedResolutionStage(ctx: DerivedResolutionContext): DerivedResolutionOutcome {
  const attempts: DerivedResolverAttempt[] = [];

  // ── WS-7 · conduit-fill@v1 (AUTO_DERIVED) ─────────────────────────────────
  if (ctx.conduitFill) {
    const cf = ctx.conduitFill;
    attempts.push({
      resolverId: 'conduit-fill@v1',
      mode: 'AUTO_DERIVED',
      requirementCodes: ['CONDUIT-FILL-PENDING'],
      owns: true,
      result: cf.cleared ? 'RESOLVED' : 'FAILED',
      clearance: { cleared: cf.cleared, missing: cf.missing, reasons: cf.reasons },
      sourceQueried: 'computeSystem NEC Ch.9 Tables 1/4/5 (canonical electrical engine)',
      sourceRefs: [
        `provenance:electrical.conduitFillAuthority#${cf.record.segmentId ?? 'feeder'}`,
        `authority:${cf.record.necBasis}`,
      ],
      inputs: {
        segmentId: cf.record.segmentId,
        racewayType: cf.record.racewayType,
        racewaySize: cf.record.racewaySize,
        conductorSet: cf.record.conductorSet,
        insulation: cf.record.insulation,
        codeEdition: cf.record.codeEdition,
        fillPct: cf.record.fillPct,
        limitPct: cf.record.limitPct,
        pass: cf.record.pass,
      },
      failureReason: cf.cleared ? null : cf.reasons.join(' · '),
      retryability: cf.cleared ? 'NON_RETRYABLE' : 'REQUIRES_INPUT',
      operatorAction: cf.cleared ? null
        : 'Supply the missing raceway / conductor / code-edition input named above; the fill itself is computed, never measured.',
      confidence: cf.cleared ? 1 : 0,
    });
  }

  // ── route-length@v1 (AUTO_DERIVED for the geometry-derived segments;
  //    FIELD_VERIFICATION residual for the runs genuinely absent from CAD) ────
  {
    const segs = ctx.routeSegments;
    const resolved = segs.filter(s => ROUTE_GEOMETRY_SOURCES.includes(s.lengthSource));
    const residual = segs.filter(s => !ROUTE_GEOMETRY_SOURCES.includes(s.lengthSource));
    const cleared = segs.length > 0 && residual.length === 0;
    attempts.push({
      resolverId: 'route-length@v1',
      mode: 'AUTO_DERIVED',
      residualMode: cleared ? null : 'FIELD_VERIFICATION',
      requirementCodes: ['ROUTE-LENGTH-ESTIMATE'],
      owns: true,
      result: cleared ? 'RESOLVED' : 'FAILED',
      clearance: {
        cleared,
        missing: residual.map(s => `electrical.routeSegments[${s.segmentId}].lengthSource (${s.electricalFunction ?? 'run'})`),
        reasons: cleared ? [] : [
          `${resolved.length} of ${segs.length} segment(s) are derived from real geometry`
          + (resolved.length ? ` (${resolved.map(s => s.segmentId).join(', ')})` : '')
          + `; ${residual.length} run(s) have no routed geometry in the CAD model and require a field-measured route: `
          + residual.map(s => `${s.segmentId} — ${s.electricalFunction ?? 'run'}`).join('; '),
        ],
      },
      sourceQueried: 'canonical layout geometry (module coordinates / branch cable paths) + computeSystem run model',
      sourceRefs: resolved.map(s => `provenance:electrical.routeSegments#${s.segmentId}`),
      inputs: {
        segmentCount: segs.length,
        geometryDerivedSegments: resolved.map(s => s.segmentId).join(', ') || null,
        residualSegments: residual.map(s => s.segmentId).join(', ') || null,
      },
      failureReason: cleared ? null
        : `${residual.length} run(s) genuinely absent from the CAD route model: ${residual.map(s => s.segmentId).join(', ')}`,
      retryability: cleared ? 'NON_RETRYABLE' : 'REQUIRES_INPUT',
      operatorAction: cleared ? null
        : 'Record a field-measured (or CAD-routed) length for the named runs only — the branch cable path is already geometry-derived.',
      confidence: segs.length ? Math.round((resolved.length / segs.length) * 100) / 100 : 0,
    });
  }

  // ── raceway-authority@v1 (AUTO_DERIVED) — the three RG-5 raceway codes,
  //    each decided from the engine's own segment / raceway objects. ──────────
  {
    const feederReasons = ctx.feederRacewayResolved ? [] : ['the canonical feeder segment carries no raceway type'];
    const conflictReasons = ctx.racewaySegmentConflicts.length
      ? [`segment id(s) ${ctx.racewaySegmentConflicts.join(', ')} resolve to more than one raceway type/size`] : [];
    const branchReasons = ctx.isMicro && ctx.branchRacewayAmbiguous ? ctx.branchRacewayReasons : [];
    const codes = ['FEEDER-RACEWAY-AUTHORITY', 'RACEWAY-SEGMENT-CONFLICT',
      ...(ctx.isMicro ? ['BRANCH-RACEWAY-AUTHORITY'] : [])];
    const allReasons = [...feederReasons, ...conflictReasons, ...branchReasons];
    attempts.push({
      resolverId: 'raceway-authority@v1',
      mode: 'AUTO_DERIVED',
      requirementCodes: codes,
      owns: true,
      result: allReasons.length === 0 ? 'RESOLVED' : 'FAILED',
      clearance: {
        cleared: allReasons.length === 0,
        missing: [
          ...(ctx.feederRacewayResolved ? [] : ['electrical.feeder.conduit.type']),
          ...(ctx.racewaySegmentConflicts.length ? ['electrical.routeSegments[].raceway (one raceway per physical run)'] : []),
          ...(branchReasons.length ? ['electrical.physicalRaceways[branch home-run]'] : []),
        ],
        reasons: allReasons,
      },
      sourceQueried: 'computeSystem run segments + physicalRaceways (canonical raceway objects)',
      sourceRefs: ctx.physicalRaceways.map(r => `provenance:electrical.physicalRaceways#${r.physicalRacewayId}`),
      inputs: {
        feederRacewayResolved: ctx.feederRacewayResolved,
        physicalRacewayCount: ctx.physicalRaceways.length,
        conflictingSegmentIds: ctx.racewaySegmentConflicts.join(', ') || null,
        branchRacewayAmbiguous: ctx.isMicro ? ctx.branchRacewayAmbiguous : null,
      },
      failureReason: allReasons.length ? allReasons.join(' · ') : null,
      retryability: allReasons.length ? 'RETRYABLE' : 'NON_RETRYABLE',
      operatorAction: null,
      confidence: allReasons.length ? 0 : 1,
    });
  }

  // ── WS-5 · qcable-topology@v1 (AUTO_DERIVED, contributor) ──────────────────
  if (ctx.qcableTopology) {
    const t = ctx.qcableTopology;
    const complete = t.geometryCoverage === 'geometry-derived';
    attempts.push({
      resolverId: 'qcable-topology@v1',
      mode: 'AUTO_DERIVED',
      requirementCodes: ['QCABLE-PROCUREMENT-INSUFFICIENT'],
      owns: false,                     // it FEEDS the solution resolver; it never clears
      result: complete ? 'RESOLVED' : 'FAILED',
      clearance: {
        cleared: complete,
        missing: complete ? [] : t.fieldDependentPortion,
        reasons: complete ? [] : ['the cable topology is not fully geometry-derived — see the field-dependent portion'],
      },
      sourceQueried: 'canonical layout geometry (module centres, roof-plane ids, row indices, branch assignment) + brand trunk-cable catalog',
      sourceRefs: [`provenance:electrical.qcableTopology#${t.sku ?? 'cable'}`],
      inputs: {
        sku: t.sku,
        branchCount: t.totals.branchCount,
        dropCount: t.totals.dropCount,
        connectorSpacingFt: t.connectorSpacingFt,
        installedLengthFt: t.totals.installedLengthFt,
        requiredLengthFt: t.totals.requiredLengthFt,
        orderedSections: t.totals.orderedSections,
        procurementLengthFt: t.totals.procurementLengthFt,
        dropBasisProcurementLengthFt: t.totals.dropBasisProcurementLengthFt,
        rowTransitions: t.totals.rowTransitionCount,
        arrayTransitions: t.totals.arrayTransitionCount,
        deadDrops: t.totals.deadDropCount,
        geometryCoverage: t.geometryCoverage,
      },
      failureReason: complete ? null : t.fieldDependentPortion.join(' · '),
      retryability: complete ? 'NON_RETRYABLE' : 'REQUIRES_INPUT',
      operatorAction: null,
      confidence: t.confidence,
    });
  }

  // ── WS-5 · qcable-solution@v1 (AUTO_DERIVED, owner) ────────────────────────
  if (ctx.qcableEvaluation && ctx.procurementSufficiency) {
    const ev = ctx.qcableEvaluation;
    const ps = ctx.procurementSufficiency;
    const cleared = !ps.insufficient;
    const adopted = ev.options.find(o => o.adopted) ?? null;
    const recommended = ev.options.find(o => o.optionId === ev.recommendedOptionId) ?? null;
    attempts.push({
      resolverId: 'qcable-solution@v1',
      mode: 'AUTO_DERIVED',
      requirementCodes: ['QCABLE-PROCUREMENT-INSUFFICIENT'],
      owns: true,
      result: cleared ? 'RESOLVED' : 'FAILED',
      clearance: {
        cleared,
        missing: cleared ? [] : ev.options.filter(o => !o.viable).map(o => `${o.optionId}: ${o.blockingReasons[0] ?? 'not viable'}`),
        reasons: cleared ? [] : [ev.unresolvedReason ?? 'no complete solution established'],
      },
      sourceQueried: 'Q-Cable topology + brand trunk-cable catalog (listed variants, raw stock, dead-drop rule) + document-registry extension solutions',
      sourceRefs: [
        `provenance:electrical.procurementSufficiency#${ps.assemblyId ?? 'assembly'}`,
        ...(adopted ? adopted.evidenceRefs : []),
      ],
      inputs: {
        sizingRequirementFt: ev.sizingRequirementFt,
        currentProcurementFt: ev.currentProcurementFt,
        measuredDeficitFt: ev.measuredDeficitFt,
        optionsEvaluated: ev.options.length,
        viableOptions: ev.options.filter(o => o.viable).map(o => o.optionId).join(', ') || null,
        recommendedOptionId: ev.recommendedOptionId,
        adoptedOptionId: ev.adoptedOptionId,
        resultingProcurementFt: ps.procurementLengthFt,
      },
      failureReason: cleared ? null : (ev.unresolvedReason ?? 'no complete solution established'),
      retryability: cleared ? 'NON_RETRYABLE' : 'REQUIRES_INPUT',
      operatorAction: cleared ? null : (recommended?.requiresAction ?? null),
      confidence: cleared ? 1 : 0,
    });
  }

  // ── fold the attempts into states + evidence (framework contract) ──────────
  const states: Record<string, RequirementResolutionState> = {};
  const evidence: ResolutionEvidenceRecord[] = [];
  const clearedCodes: string[] = [];

  for (const a of attempts) {
    const auditRef = (a.owns && a.clearance.cleared)
      ? buildResolutionAuditRef({ resolverId: a.resolverId, sourceRefs: a.sourceRefs, atIso: ctx.nowIso })
      : null;
    const rec: ResolutionEvidenceRecord = {
      resolverId: a.resolverId,
      resolverMode: a.mode,
      requirementCodes: [...a.requirementCodes],
      outcome: a.result,
      iteration: 1,
      atIso: ctx.nowIso,
      inputs: a.inputs,
      sourceQueried: a.sourceQueried,
      sourceRefs: a.sourceRefs,
      failureReason: a.failureReason,
      retryability: a.retryability,
      operatorAction: a.operatorAction,
      confidence: a.confidence,
      auditRef,
    };
    evidence.push(rec);

    for (const code of a.requirementCodes) {
      const d = REQUIREMENT_DECLARATIONS[code];
      const st = states[code] ?? (states[code] = {
        requirementCode: code,
        resolutionMode: d?.resolutionMode ?? 'AUTO_DERIVED',
        residualMode: d?.residualMode ?? null,
        resolverId: d?.resolverId ?? a.resolverId,
        resolverImplemented: true,
        plannedResolverPhase: d?.resolverPhase ?? null,
        attemptedResolverIds: [],
        requiredInputs: [],
        resolutionEvidence: [],
        confidence: null,
        blockingReason: null,
        reasons: [],
        retryability: a.retryability,
        lastResolutionAttempt: null,
        lastResolutionResult: 'NOT_ATTEMPTED',
        cleared: false,
        resolutionAuditRef: null,
      });
      st.attemptedResolverIds.push(a.resolverId);
      st.resolutionEvidence.push(rec);
      st.lastResolutionAttempt = ctx.nowIso;
      // a CONTRIBUTOR never overwrites the owner's verdict.
      if (a.owns) {
        st.lastResolutionResult = a.result;
        st.requiredInputs = [...a.clearance.missing];
        st.reasons = [...a.clearance.reasons];
        st.blockingReason = a.clearance.reasons.length ? a.clearance.reasons.join(' · ') : null;
        st.retryability = a.retryability;
        st.confidence = a.confidence;
        if (a.residualMode !== undefined) st.residualMode = a.residualMode;
        // THE audit-ref contract: a truthy clearance with no audit reference is
        // NOT a resolution (releaseGates.deriveRequirementStatus keeps it OPEN).
        st.cleared = a.clearance.cleared && !!auditRef;
        st.resolutionAuditRef = st.cleared ? auditRef : null;
        if (st.cleared) clearedCodes.push(code);
      } else if (st.lastResolutionResult === 'NOT_ATTEMPTED') {
        st.lastResolutionResult = a.result === 'RESOLVED' ? 'NOT_ATTEMPTED' : a.result;
        if (!st.blockingReason && a.failureReason) st.blockingReason = a.failureReason;
      }
    }
  }

  return { states, evidence, attempts, clearedCodes };
}

/**
 * Merge the DERIVED stage's states over the async lifecycle's states. The derived
 * stage runs LATER (it has the design geometry), so for a code it OWNS its
 * verdict wins; the async attempt's evidence is PRESERVED on the merged state so
 * both attempts stay on the record.
 */
export function mergeResolutionStates(
  asyncStates: Record<string, RequirementResolutionState> | null | undefined,
  derived: Record<string, RequirementResolutionState>,
): Record<string, RequirementResolutionState> {
  const out: Record<string, RequirementResolutionState> = { ...(asyncStates ?? {}) };
  for (const [code, d] of Object.entries(derived)) {
    const prior = out[code];
    out[code] = prior
      ? {
          ...d,
          attemptedResolverIds: [...prior.attemptedResolverIds, ...d.attemptedResolverIds],
          resolutionEvidence: [...prior.resolutionEvidence, ...d.resolutionEvidence],
        }
      : d;
  }
  return out;
}
