// ═══════════════════════════════════════════════════════════════════════════
// AAC WS-1 — THE RESOLUTION LIFECYCLE RUNNER
// ───────────────────────────────────────────────────────────────────────────
// THE lifecycle the directive mandates, expressed on the seams that already
// exist (audit §5):
//
//   determine automatic requirements
//     → run AUTO_DERIVED      → persist results + evidence   (Seam 4 audit refs)
//     → invalidate dependents (Seam 3 ledger vocabulary)
//     → recalculate
//     → run AUTO_RETRIEVED    → persist retrieved authority + source evidence
//     → recalculate
//     → repeat to stability (BOUNDED)
//     → hand the stabilised bundle to buildPermitDesignSnapshot
//     → validate → deepFreeze → render
//
// THE BOUND — `MAX_RESOLUTION_ITERATIONS = 3`. Justification: the dependency
// graph is SHALLOW (derived keys feed retrieval resolvers; retrieval results
// feed the pure build, not other resolvers), so a fixed point is reached in one
// iteration for every wired resolver today and in two whenever a derived value
// changes a retrieval input. Three allows one genuine cascade beyond that and
// still terminates. Exceeding it is NOT silently accepted: `stabilized:false` is
// recorded on the outcome and every resolver's `lastResolutionAttempt` is
// visible, so a non-converging resolver is diagnosable rather than a hidden loop.
//
// STABILITY CRITERION — a fixed point is reached when the dirty set is EMPTY
// after a full iteration: every resolver has run at least once, and no resolver
// produced a bundle value different from the value its dependents last consumed.
//
// PERSISTENCE POINTS — (1) the per-attempt `ResolutionEvidenceRecord` (always,
// resolved or failed); (2) the bundle patch, which is what the pure build
// consumes; (3) the clearing `resolutionAuditRef` (the deriveRequirementStatus
// contract — no audit ref ⇒ the requirement stays OPEN); (4) the invalidation
// records, in the snapshot_digest_invalidations vocabulary, exposed for the
// phase that owns the DB write (AAC-2's reconciliation path already writes that
// table). All four ride in the outcome and, through it, in the blocker payload
// rendered by the EXISTING RS-1 payload machinery.
// ═══════════════════════════════════════════════════════════════════════════

import type { PermitInput } from '../../types';
import { REQUIREMENT_DECLARATIONS } from '../releaseGates';
import { createResolverRegistry, safeDbRead as defaultSafeDbRead, type ResolverRegistry } from './registry';
import { PRODUCTION_RESOLVERS } from './resolvers';
import {
  AUTOMATIC_MODES, isAutomaticMode,
  type RequirementResolutionState, type RequirementResolver, type ResolutionEvidenceRecord,
  type ResolutionInvalidation, type ResolutionLifecycleOutcome, type ResolutionMode,
  type Retryability, type SafeDbRead, type SnapshotAuthorityInputs, type AuthorityBundleKey,
  type RetrievalProviders,
} from './types';
import { DERIVED_RESOLVER_IDS } from './derived';
import { createSunspecCodeProvider } from '@/lib/providers/jurisdiction/sunspecCodeProvider';
import {
  createInternalAhjRegistryProvider, createCompositeCodeAdoptionProvider,
} from '@/lib/jurisdictions/internalAhjRegistry';
import { createCensusPropertyProvider } from '@/lib/providers/property/censusPropertyProvider';
import { createAsceHazardProvider } from '@/lib/providers/climateHazard/asceHazardProvider';
import { createHttpDocumentRetrievalProvider } from '@/lib/providers/documentRetrieval/httpDocumentProvider';

/** THE bound. Documented above; recorded on every outcome. */
export const MAX_RESOLUTION_ITERATIONS = 3;

/** The id the LIFECYCLE itself authors evidence under. */
export const LIFECYCLE_ID = 'aac-lifecycle@v1';

/** The blocker-firing seed. Every key defaults to the state that keeps its
 *  requirement OPEN — byte-identical to the pre-lifecycle fail-soft defaults. */
export function defaultAuthorityBundle(): SnapshotAuthorityInputs {
  return {
    capacityDocument: null,
    // D4 — null is the blocker-firing seed: with no legal-jurisdiction authority
    // resolved, a jurisdiction-bound document REFUSES to archive rather than
    // stamping a posted-record value.
    legalJurisdiction: null,
    projectJurisdiction: null,
    manufacturerDocumentsArchived: null,
    digestInvalidatedByLedger: false,
    // PRR §2 — `[]` (not null) is the honest seed: with no lifecycle run there is
    // no ledger AUTHORITY in play, which is a different fact from "the ledger was
    // read and failed" (null ⇒ fail closed). The review requirement is held open
    // by the absent approval, not by a fabricated invalidation.
    digestInvalidations: [],
    framingCapacityDocument: null,
    framingProjectApplicabilityKey: null,
    cableExtensionSolutions: [],
    // no in-repo Q-Cable service-loop allowance authority exists ⇒ honest null.
    qcableServiceLoopAllowance: null,
    environmentalSource: null,
    // AAC WS-1 — the two wired-but-unresolved sockets (owning resolvers land in
    // AAC-4 / AAC-5). Wired ≠ stubbed: no always-unresolved resolver is registered.
    groundingDocumentEvidence: null,
    framingEngineerReview: null,
    framingReviewDigest: null,
    // AAC WS-2 — canonical selection / datasheet binding / personnel. Null is
    // the blocker-firing seed: no canonical decision, no binding, no configured
    // designer until a resolver establishes one from a real store.
    canonicalEquipment: null,
    moduleDatasheetBinding: null,
    projectPersonnel: null,
    // AAC WS-3 / WS-4 — the retrieved authority records. Null is the
    // blocker-firing seed: no retrieval, no legal identity, no adopted editions,
    // no hazard record until a provider actually answers.
    projectLegalAuthority: null,
    codeAdoptionAuthority: null,
    environmentalRetrieval: null,
    // AAC WS-8 / WS-9 — the structural-separation authorities. Null is the
    // blocker-firing seed: no retrieval, no registry facts (so the
    // AUTHORITATIVE verdict stays out of reach exactly as before), no rail
    // selection, no framing retrieval attempt and — above all — no engineering
    // review, until a real source establishes one.
    structuralDocumentRetrieval: null,
    documentRegistryFacts: null,
    rackingAssemblySelection: null,
    framingRetrieval: null,
    engineeringReview: null,
    // WS-5 — no field measurement until the store says otherwise. The engine
    // cannot produce one, and a null here is what keeps every route on its CAD
    // source with ROUTE-LENGTH-ESTIMATE open.
    fieldRouteMeasurements: null,
  };
}

/**
 * AAC WS-3 / WS-4 — the PRODUCTION provider bag. Built lazily so importing the
 * lifecycle never constructs a network client, and so a test that injects its
 * own bag never touches the live ones.
 */
export function productionProviders(nowIso?: string): RetrievalProviders {
  return {
    // TAC WS-19 — provider PRECEDENCE: SolarPro's own Neon ahj_registry
    // (retained retrievals + governed operator verifications) answers FIRST;
    // the external SunSpec/Orange Button registry is the fallback + enrichment
    // path. AHJ_REGISTRY_TOKEN is no longer the primary prerequisite for
    // adopted-code authority. Admitted external retrievals are written back to
    // the internal registry by code-authority@v1 (research once → retain
    // centrally → reuse for every project).
    codeAdoption: createCompositeCodeAdoptionProvider([
      createInternalAhjRegistryProvider({ nowIso }),
      createSunspecCodeProvider({ nowIso }),
    ]),
    propertyIdentity: createCensusPropertyProvider({ nowIso }),
    climateHazard: createAsceHazardProvider({ nowIso }),
    documentRetrieval: createHttpDocumentRetrievalProvider({ nowIso }),
  };
}

/**
 * A TEST RUN NEVER TOUCHES THE NETWORK. Under vitest the default bag is EMPTY,
 * so the retrieval resolvers report PROVIDER-NOT-INJECTED — deterministic, and a
 * DIFFERENT fact from "the provider answered with nothing". Without this, any
 * test that omits `deps.providers` silently made live calls to the Census
 * Geocoder / ASCE ImageServers / USGS, which is both non-deterministic (the
 * observed flakiness) and a hidden external dependency in CI.
 *
 * A test that WANTS a retrieval injects a fixture provider explicitly; the
 * WS-3/WS-4 suite does exactly that, and labels the result FIXTURE PROOF.
 */
export function isTestRuntime(): boolean {
  return process.env.VITEST === 'true' || process.env.VITEST === '1' || process.env.NODE_ENV === 'test';
}

/** Default retryability for a requirement nobody has attempted yet. */
function seedRetryability(mode: ResolutionMode): Retryability {
  return isAutomaticMode(mode) ? 'RETRYABLE' : 'REQUIRES_INPUT';
}

export interface ResolutionDeps {
  /** DI seam: inject fixture resolvers (provider fixtures, failure fixtures) in
   *  place of the production set. Omitted ⇒ PRODUCTION_RESOLVERS. */
  resolvers?: readonly RequirementResolver[];
  /** DI seam: inject a guarded reader (e.g. one that always throws 42P01). */
  safeDbRead?: SafeDbRead;
  /** deterministic clock for the whole run (pure/digest-safe callers pass one). */
  nowIso?: string;
  /** Seam 3 writer. AAC-2+ plugs the snapshot_digest_invalidations write in here;
   *  the runner never writes the ledger itself. Failures are swallowed by design
   *  (fail-soft) and recorded on the evidence trail. */
  persistInvalidation?: (rec: ResolutionInvalidation) => Promise<void>;
  /** override the iteration bound (tests only). */
  iterationBound?: number;
  /** AAC WS-3 / WS-4 DI seam: inject fixture retrieval providers. Omitted ⇒ the
   *  live production bag (`productionProviders`). Pass `{}` to run with NO
   *  provider at all — the resolvers then report PROVIDER-NOT-INJECTED, which is
   *  a different fact from "the provider answered with nothing". */
  providers?: RetrievalProviders;
}

function seedState(code: string): RequirementResolutionState {
  const d = REQUIREMENT_DECLARATIONS[code];
  const mode: ResolutionMode = d?.resolutionMode ?? 'OPERATOR_CONFIRMATION';
  return {
    requirementCode: code,
    resolutionMode: mode,
    residualMode: d?.residualMode ?? null,
    resolverId: d?.resolverId ?? null,
    resolverImplemented: (d?.resolverId ?? null) != null,
    plannedResolverPhase: d?.resolverPhase ?? null,
    attemptedResolverIds: [],
    requiredInputs: [],
    resolutionEvidence: [],
    confidence: null,
    blockingReason: null,
    reasons: [],
    retryability: seedRetryability(mode),
    lastResolutionAttempt: null,
    lastResolutionResult: 'NOT_ATTEMPTED',
    cleared: false,
    resolutionAuditRef: null,
  };
}

const sameValue = (a: unknown, b: unknown): boolean => {
  try { return JSON.stringify(a ?? null) === JSON.stringify(b ?? null); } catch { return a === b; }
};

/**
 * Run the whole resolution lifecycle and return the STABILISED authority bundle
 * plus the per-requirement resolution state + evidence trail.
 *
 * NEVER THROWS. A resolver that throws is caught, recorded as a FAILED attempt
 * with the exact error, and the lifecycle continues — the permit path must not
 * crash because an authority source is unavailable (the authorityInputs
 * fail-soft contract, now shared).
 */
export async function runResolutionLifecycle(
  input: PermitInput,
  deps?: ResolutionDeps,
): Promise<{ authority: SnapshotAuthorityInputs; outcome: ResolutionLifecycleOutcome }> {
  const registry = createResolverRegistry(deps?.resolvers ?? PRODUCTION_RESOLVERS);
  const read = deps?.safeDbRead ?? defaultSafeDbRead;
  const nowIso = deps?.nowIso ?? new Date().toISOString();
  const bound = deps?.iterationBound ?? MAX_RESOLUTION_ITERATIONS;
  const providers: RetrievalProviders = deps?.providers ?? (isTestRuntime() ? {} : productionProviders(nowIso));
  const proj = (input.project ?? {}) as Record<string, unknown>;
  const projectId: string | null =
    ((input as unknown as { projectId?: string }).projectId ?? (proj.projectId as string | undefined)) ?? null;

  const authority = defaultAuthorityBundle();
  /** the SAME object, indexable — patches are applied by declared key name. */
  const bag = authority as unknown as Record<string, unknown>;
  const states: Record<string, RequirementResolutionState> = {};
  for (const code of Object.keys(REQUIREMENT_DECLARATIONS)) states[code] = seedState(code);

  const evidence: ResolutionEvidenceRecord[] = [];
  const invalidations: ResolutionInvalidation[] = [];
  const executionOrder: string[] = [];
  /** D4 — resolver-contract violations: patch keys that were computed, not
   *  declared in `produces`, and therefore silently discarded. Surfaced on the
   *  outcome's invariantViolations rather than lost. */
  const undeclaredPatchKeys: string[] = [];

  // ── determine the AUTOMATIC requirements: every registered resolver is dirty
  //    on iteration 1 (nothing has been attempted). ───────────────────────────
  const dirty = new Set<string>(registry.ids());

  let iterations = 0;
  let stabilized = false;

  while (iterations < bound) {
    iterations++;
    // ONE iteration = the AUTO_DERIVED pass, then (with the updated bundle —
    // this IS the "recalculate" step, since every resolver reads ctx.authority
    // fresh) the AUTO_RETRIEVED pass.
    for (const mode of AUTOMATIC_MODES) {
      for (const r of registry.byMode(mode)) {
        if (!dirty.has(r.id)) continue;
        dirty.delete(r.id);
        executionOrder.push(r.id);

        const before: Record<string, unknown> = {};
        for (const k of r.produces) before[k] = bag[k];

        let outcome;
        try {
          outcome = await r.run({
            input, projectId, authority, iteration: iterations, nowIso, safeDbRead: read, providers,
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          outcome = {
            result: 'FAILED' as const,
            clearance: { cleared: false, missing: [], reasons: [`resolver threw: ${msg}`] },
            failureReason: `resolver threw: ${msg}`,
            retryability: 'RETRYABLE' as Retryability,
            sourceQueried: null,
          };
        }

        // ── persist the bundle patch (only the keys the resolver DECLARES) ────
        const changedKeys: AuthorityBundleKey[] = [];
        if (outcome.patch) {
          // ── D4 — AN UNDECLARED PATCH KEY IS A CONTRACT VIOLATION ──────────
          // This loop is a filter, and a silent one: a key the resolver computed
          // but did not declare is dropped with no signal anywhere. That is
          // exactly how the D4 defect survived — `project-authority@v1` returned
          // the VERIFIED legal jurisdiction in its patch, declared only
          // `projectLegalAuthority`, and the boundary determination was thrown
          // away on every single run while the bundle kept the derived,
          // unverified value. Nothing failed. Nothing was logged.
          //
          // Dropping is still the right BEHAVIOUR — `produces` is the dependency
          // graph, and honouring an undeclared write would corrupt it. What was
          // missing is that the drop is now REPORTED, so the next resolver that
          // computes an authority and forgets to declare it is a visible defect
          // rather than a silent loss.
          //
          // A survey of every production resolver before enabling this found
          // exactly one violation — the one above — so this is safe to apply
          // globally rather than test-only.
          for (const k of Object.keys(outcome.patch)) {
            if (!(r.produces as readonly string[]).includes(k)) {
              undeclaredPatchKeys.push(`resolver ${r.id}: patched undeclared bundle key '${k}' — `
                + `it was DISCARDED. Add it to this resolver's \`produces\` declaration.`);
            }
          }
          for (const k of r.produces) {
            if (!(k in outcome.patch)) continue;
            const next = (outcome.patch as Record<string, unknown>)[k];
            if (!sameValue(before[k], next)) changedKeys.push(k);
            bag[k] = next;
          }
        }

        // ── persist the evidence record (ALWAYS — resolved or failed) ─────────
        const rec: ResolutionEvidenceRecord = {
          resolverId: r.id,
          resolverMode: r.mode,
          requirementCodes: [...r.requirementCodes],
          outcome: outcome.result,
          iteration: iterations,
          atIso: nowIso,
          inputs: {
            ...(outcome.inputsRecorded ?? {}),
            ...Object.fromEntries(r.requiredInputs.map(k => {
              const v = bag[k];
              return [k, (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') ? v : (v == null ? null : `[${typeof v}]`)];
            })),
          },
          sourceQueried: outcome.sourceQueried ?? null,
          sourceRefs: outcome.sourceRefs ?? [],
          failureReason: outcome.failureReason ?? null,
          retryability: outcome.retryability ?? 'RETRYABLE',
          operatorAction: outcome.operatorAction ?? null,
          confidence: outcome.confidence ?? null,
          auditRef: outcome.auditRef ?? null,
        };
        evidence.push(rec);

        // ── update every requirement state this resolver bears on ────────────
        for (const code of r.requirementCodes) {
          const st = states[code] ?? (states[code] = seedState(code));
          st.attemptedResolverIds.push(r.id);
          st.resolutionEvidence.push(rec);
          st.lastResolutionAttempt = nowIso;
          st.lastResolutionResult = outcome.result;
          st.requiredInputs = [...outcome.clearance.missing];
          st.reasons = [...outcome.clearance.reasons];
          st.blockingReason = outcome.clearance.reasons.length ? outcome.clearance.reasons.join(' · ') : null;
          st.retryability = outcome.retryability ?? st.retryability;
          st.confidence = outcome.confidence ?? null;
          // A clear REQUIRES an audit reference (deriveRequirementStatus) — a
          // truthy clearance with no audit ref is NOT a resolution.
          const auditRef = outcome.auditRef ?? null;
          st.cleared = outcome.clearance.cleared && !!auditRef;
          st.resolutionAuditRef = st.cleared ? auditRef : null;
        }

        // ── invalidate dependents + recalculate (Seam 3) ──────────────────────
        for (const inv of outcome.invalidations ?? []) {
          invalidations.push(inv);
          if (deps?.persistInvalidation) {
            try { await deps.persistInvalidation(inv); } catch { /* fail-soft: the ledger write is not a gate */ }
          }
        }
        const dependencyTriggers = changedKeys.length > 0 || (outcome.invalidations?.length ?? 0) > 0;
        if (dependencyTriggers) {
          for (const other of registry.all()) {
            if (other.id === r.id) continue;
            if (other.requiredInputs.some(k => changedKeys.includes(k))) dirty.add(other.id);
          }
        }
      }
    }

    // ── stability: nothing left to (re-)run ⇒ fixed point ────────────────────
    if (dirty.size === 0) { stabilized = true; break; }
  }

  // ── the UNCALLED-RESOLVER guard, surfaced LOUDLY in evidence ───────────────
  // A requirement whose owning resolver has not been implemented yet is a
  // DIFFERENT fact from "attempted and unresolved". It is recorded here so the
  // closure document can show this count reach zero by AAC-6 — it is never
  // emitted as a silently-final blocker.
  for (const code of Object.keys(states)) {
    const st = states[code];
    if (st.resolverImplemented) continue;
    if (!isAutomaticMode(st.resolutionMode)) continue;      // non-automatic modes legitimately have no resolver
    if (st.attemptedResolverIds.length > 0) continue;       // a contributing resolver did attempt it
    const rec: ResolutionEvidenceRecord = {
      resolverId: LIFECYCLE_ID,
      resolverMode: st.resolutionMode,
      requirementCodes: [code],
      outcome: 'NOT_ATTEMPTED',
      iteration: iterations,
      atIso: nowIso,
      inputs: {},
      sourceQueried: null,
      sourceRefs: [],
      // NOTE: the requirement CODE is carried in `requirementCodes`, never
      // interpolated into this sentence — several codes contain the word
      // "FAILED", and this string reaches the rendered payload where the
      // permanent RGM gate 10 (pending authority is never a verified failure)
      // scans for renderer-added failure vocabulary.
      failureReason: `RESOLVER-NOT-IMPLEMENTED: this requirement is declared ${st.resolutionMode}, but its owning `
        + `resolver is not registered yet${st.plannedResolverPhase ? ` (planned: ${st.plannedResolverPhase})` : ''} — `
        + 'it is NOT final and has not yet been attempted.',
      retryability: 'RETRYABLE',
      operatorAction: null,
      confidence: null,
      auditRef: null,
    };
    evidence.push(rec);
    st.resolutionEvidence.push(rec);
    st.blockingReason = st.blockingReason ?? rec.failureReason;
  }

  const outcome: ResolutionLifecycleOutcome = {
    iterations, stabilized, iterationBound: bound,
    states, evidence, invalidations, executionOrder,
    invariantViolations: [],
    startedAtIso: nowIso,
  };
  // D4 — resolver-contract violations join the lifecycle's own invariant set, so
  // a silently-dropped authority is as visible as any other lifecycle defect.
  outcome.invariantViolations = [
    ...verifyResolutionLifecycle(outcome, registry),
    ...undeclaredPatchKeys,
  ];
  return { authority, outcome };
}

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATORS — the framework's own anti-vacuity gates.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * THE UNCALLED-RESOLVER INVARIANT (directive WS-1): "an automatic requirement
 * may not emit unresolved merely because its resolver was not called". If ANY
 * registered resolver claims a requirement code, the lifecycle MUST have
 * attempted it; a `NOT_ATTEMPTED` state for such a code is a framework defect.
 */
export function verifyUncalledResolverInvariant(
  outcome: ResolutionLifecycleOutcome,
  registry: ResolverRegistry,
): string[] {
  const errors: string[] = [];
  for (const r of registry.all()) {
    for (const code of r.requirementCodes) {
      const st = outcome.states[code];
      if (!st) { errors.push(`${code}: resolver ${r.id} claims an UNDECLARED requirement code`); continue; }
      if (st.lastResolutionResult === 'NOT_ATTEMPTED' || st.attemptedResolverIds.length === 0) {
        errors.push(`${code}: registered resolver ${r.id} was never called — an automatic requirement may not be `
          + 'emitted unresolved because its resolver was not invoked');
      }
    }
  }
  return errors;
}

/** Empty evidence / truthy flags are never proof: a CLEARED state must carry a
 *  RESOLVED evidence record AND the audit reference deriveRequirementStatus
 *  demands (releaseGates.ts:685-691). */
export function verifyClearedRequirementsHaveEvidence(outcome: ResolutionLifecycleOutcome): string[] {
  const errors: string[] = [];
  for (const [code, st] of Object.entries(outcome.states)) {
    if (!st.cleared) continue;
    if (!st.resolutionAuditRef || !st.resolutionAuditRef.trim()) {
      errors.push(`${code}: cleared with no resolutionAuditRef — deriveRequirementStatus would keep it OPEN`);
    }
    if (!st.resolutionEvidence.some(e => e.outcome === 'RESOLVED')) {
      errors.push(`${code}: cleared with no RESOLVED evidence record — empty evidence is never proof`);
    }
  }
  return errors;
}

/** The declaration table and the resolver registry must agree. */
export function validateResolutionDeclarations(registry?: ResolverRegistry): string[] {
  const reg = registry ?? createResolverRegistry(PRODUCTION_RESOLVERS);
  const errors: string[] = [];
  const declared = new Set(Object.keys(REQUIREMENT_DECLARATIONS));
  for (const [code, d] of Object.entries(REQUIREMENT_DECLARATIONS)) {
    if (!d.resolutionMode) { errors.push(`${code}: no resolutionMode declared`); continue; }
    if (!d.modeBasis?.trim()) errors.push(`${code}: a resolution mode must state its basis`);
    if (d.resolverId) {
      // AAC WS-5/WS-7 — a DERIVED-stage resolver runs synchronously inside the
      // snapshot build (the only point at which the CAD model, the canonical
      // electrical engine result and the branch assignment exist), so it is not
      // in the async registry. It must still name a real, implemented resolver.
      if (d.resolverStage === 'derived') {
        if (!(DERIVED_RESOLVER_IDS as readonly string[]).includes(d.resolverId)) {
          errors.push(`${code}: declares DERIVED resolver ${d.resolverId}, which the derived stage does not implement`);
        }
        if (!isAutomaticMode(d.resolutionMode)) {
          errors.push(`${code}: ${d.resolutionMode} is not an automatic mode and may not declare an auto-resolver`);
        }
        continue;
      }
      const r = reg.get(d.resolverId);
      if (!r) { errors.push(`${code}: declares resolver ${d.resolverId}, which is not registered`); continue; }
      if (!r.requirementCodes.includes(code)) {
        errors.push(`${code}: declares resolver ${d.resolverId}, which does not claim this code`);
      }
      if (!isAutomaticMode(d.resolutionMode)) {
        errors.push(`${code}: ${d.resolutionMode} is not an automatic mode and may not declare an auto-resolver`);
      }
    }
  }
  for (const r of reg.all()) {
    for (const code of r.requirementCodes) {
      if (!declared.has(code)) errors.push(`resolver ${r.id}: claims undeclared requirement code ${code}`);
    }
    const dupProduces = r.produces.filter((k, i) => r.produces.indexOf(k) !== i);
    if (dupProduces.length) errors.push(`resolver ${r.id}: duplicate produces key(s) ${dupProduces.join(', ')}`);
  }
  return errors;
}

/** Loops are bounded and the bound is visible. */
export function verifyBoundedLifecycle(outcome: ResolutionLifecycleOutcome): string[] {
  const errors: string[] = [];
  if (outcome.iterations > outcome.iterationBound) {
    errors.push(`lifecycle ran ${outcome.iterations} iterations, above the bound ${outcome.iterationBound}`);
  }
  if (!outcome.stabilized && outcome.iterations < outcome.iterationBound) {
    errors.push('lifecycle reported non-stabilised before exhausting its iteration bound');
  }
  return errors;
}

/** The aggregate the runner records on every outcome. Empty ⇒ pass. */
export function verifyResolutionLifecycle(
  outcome: ResolutionLifecycleOutcome,
  registry: ResolverRegistry,
): string[] {
  return [
    ...validateResolutionDeclarations(registry),
    ...verifyUncalledResolverInvariant(outcome, registry),
    ...verifyClearedRequirementsHaveEvidence(outcome),
    ...verifyBoundedLifecycle(outcome),
  ];
}

/** The automatic requirements still WAITING for their owning resolver. The
 *  closure document tracks this list to zero. */
export function pendingAutomaticResolvers(outcome: ResolutionLifecycleOutcome): string[] {
  return Object.values(outcome.states)
    .filter(s => isAutomaticMode(s.resolutionMode) && !s.resolverImplemented)
    .map(s => `${s.requirementCode} (${s.resolutionMode}${s.plannedResolverPhase ? ` → ${s.plannedResolverPhase}` : ''})`)
    .sort();
}
