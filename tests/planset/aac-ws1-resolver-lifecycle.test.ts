// ═══════════════════════════════════════════════════════════════════════════
// AAC WS-1 — RESOLVER-LIFECYCLE TESTS (the directive's mandated set)
//
//  1. every automatic requirement with a registered resolver records an ATTEMPT
//  2. an UNCALLED resolver cannot finalize a blocker
//  3. EMPTY EVIDENCE cannot clear (the deriveRequirementStatus audit-ref rule)
//  4. FAILURES preserve source queried / exact reason / retryability
//  5. DEPENDENCY INVALIDATION triggers recalculation
//  6. LOOPS ARE BOUNDED (and non-convergence is visible, never silent)
//  7. the snapshot is handed a STABILISED bundle — freeze only after resolution
//  8. the RENDERER cannot resolve, retrieve or mutate
//  + the DI harness seam (fixture provider injection) later phases build on
//  + the declaration table itself (one mode per requirement, with a basis)
//
// NO DB IS TOUCHED: every test injects a `safeDbRead` that never calls its read
// thunk, which is exactly the live condition today (migrations 113/114 unrun ⇒
// 42P01 on every document read).
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  runResolutionLifecycle, MAX_RESOLUTION_ITERATIONS, LIFECYCLE_ID,
  verifyUncalledResolverInvariant, verifyClearedRequirementsHaveEvidence,
  validateResolutionDeclarations, verifyBoundedLifecycle, pendingAutomaticResolvers,
  defaultAuthorityBundle,
} from '@/lib/permit/snapshot/resolution/lifecycle';
import { createResolverRegistry } from '@/lib/permit/snapshot/resolution/registry';
import { PRODUCTION_RESOLVERS } from '@/lib/permit/snapshot/resolution/resolvers';
import {
  buildResolutionAuditRef, resolutionStatePayload, RESOLUTION_RESULT_DISPLAY,
} from '@/lib/permit/snapshot/resolution/evidence';
import { blockerPayloadSchema } from '@/lib/permit/sections/reviewStatus';
import type {
  RequirementResolver, SafeDbRead, ResolutionLifecycleOutcome,
} from '@/lib/permit/snapshot/resolution/types';
import { isAutomaticMode, RESOLUTION_MODES } from '@/lib/permit/snapshot/resolution/types';
import {
  REQUIREMENT_DECLARATIONS, deriveRequirementStatus, validateReleaseGateMap,
} from '@/lib/permit/snapshot/releaseGates';
import { generatePermitHTML } from '@/lib/permit/generatePermit';
import type { PermitInput } from '@/lib/permit/types';

const REPO = join(__dirname, '..', '..');
const read = (rel: string): string => readFileSync(join(REPO, rel), 'utf8');

/** the LIVE condition: every registry table read fails 42P01 (113/114 unrun). */
const offlineRead: SafeDbRead = async <T>(label: string, _run: () => Promise<T>, failSoftTo: T) => ({
  value: failSoftTo, ok: false,
  error: `${label}: 42P01 relation does not exist [table absent — migration 113/114 not run]`,
});

/** a reader that RESOLVES its thunk (fixture providers inject data this way). */
const liveRead: SafeDbRead = async <T>(label: string, run: () => Promise<T>, failSoftTo: T) => {
  try { return { value: await run(), ok: true, error: null }; }
  catch (e) { return { value: failSoftTo, ok: false, error: `${label}: ${String(e)}` }; }
};

function permitInput(over?: Record<string, unknown>): PermitInput {
  return {
    projectId: '4030b664-bebe-433b-a11c-cda05ead2f7d',
    project: {
      projectName: 'FIXTURE PROJECT', address: '1 Test Way', state: 'IL',
      ahjName: 'FIXTURE COUNTY', mountingSystemId: 'rooftech-mini',
      ...(over ?? {}),
    },
    system: { totalPanels: 10 },
  } as unknown as PermitInput;
}

const NOW = '2026-07-27T00:00:00.000Z';

// ═══════════════════════════════════════════════════════════════════════════
// 1 — every automatic requirement with a registered resolver records an attempt
// ═══════════════════════════════════════════════════════════════════════════

describe('AAC WS-1 · lifecycle · attempts', () => {
  it('every requirement claimed by a registered resolver is ATTEMPTED (never NOT_ATTEMPTED)', async () => {
    const { outcome } = await runResolutionLifecycle(permitInput(), { safeDbRead: offlineRead, nowIso: NOW });
    const claimed = new Set(PRODUCTION_RESOLVERS.flatMap(r => r.requirementCodes));
    expect(claimed.size).toBeGreaterThan(0);
    for (const code of claimed) {
      const st = outcome.states[code];
      expect(st, `${code} must have a resolution state`).toBeTruthy();
      expect(st.lastResolutionResult, `${code} was never attempted`).not.toBe('NOT_ATTEMPTED');
      expect(st.attemptedResolverIds.length).toBeGreaterThan(0);
      expect(st.lastResolutionAttempt).toBe(NOW);
      expect(st.resolutionEvidence.length).toBeGreaterThan(0);
    }
    expect(outcome.invariantViolations).toEqual([]);
  });

  it('the lifecycle records EVERY declared requirement, resolver or not', async () => {
    const { outcome } = await runResolutionLifecycle(permitInput(), { safeDbRead: offlineRead, nowIso: NOW });
    for (const code of Object.keys(REQUIREMENT_DECLARATIONS)) {
      expect(outcome.states[code], `${code} missing from the resolution states`).toBeTruthy();
      expect(RESOLUTION_MODES).toContain(outcome.states[code].resolutionMode);
    }
  });

  it('a requirement whose owning resolver is NOT IMPLEMENTED is surfaced loudly, not silently final', async () => {
    const { outcome } = await runResolutionLifecycle(permitInput(), { safeDbRead: offlineRead, nowIso: NOW });
    const pending = pendingAutomaticResolvers(outcome);
    expect(pending.length).toBeGreaterThan(0);           // AAC-2..5 still owe these
    const notImplemented = outcome.evidence.filter(e =>
      e.resolverId === LIFECYCLE_ID && e.outcome === 'NOT_ATTEMPTED');
    expect(notImplemented.length).toBeGreaterThan(0);
    for (const e of notImplemented) {
      expect(e.failureReason).toMatch(/RESOLVER-NOT-IMPLEMENTED/);
      expect(e.failureReason).toMatch(/NOT final/);
    }
    // an unimplemented AUTOMATIC requirement is distinguishable from an
    // attempted-and-unresolved one.
    // The WITNESS moves as the campaign delivers, and that is the point: the
    // invariant is about the DISTINCTION, not about any one code.
    //   CONDUIT-FILL-PENDING was the witness until AAC-4 shipped conduit-fill@v1;
    //   EQUIPMENT-DOCUMENT-APPLICABILITY was the witness until AAC-5 shipped
    //   racking-documents@v1.
    // So the assertion is now structural: EVERY automatic requirement still
    // waiting on a resolver reports NOT_ATTEMPTED with the loud reason, and none
    // of them is presented as a final unresolved blocker.
    const stillPending = Object.values(outcome.states).filter(
      st => !st.resolverImplemented && st.attemptedResolverIds.length === 0
        && (st.resolutionMode === 'AUTO_DERIVED' || st.resolutionMode === 'AUTO_RETRIEVED'));
    expect(stillPending.length).toBe(pending.length);
    for (const st of stillPending) {
      expect(st.lastResolutionResult).toBe('NOT_ATTEMPTED');
      expect(st.blockingReason).toMatch(/RESOLVER-NOT-IMPLEMENTED/);
      expect(st.plannedResolverPhase).toBeTruthy();
    }
    // AAC-5 DELIVERED the document-applicability resolver: it is now attempted
    // and honestly unresolved, never silently final.
    const applicability = outcome.states['EQUIPMENT-DOCUMENT-APPLICABILITY'];
    expect(applicability.resolverImplemented).toBe(true);
    expect(applicability.resolverId).toBe('racking-documents@v1');
    expect(applicability.lastResolutionResult).not.toBe('NOT_ATTEMPTED');
    // AAC-4's own codes are DECLARED implemented (their resolver runs in the
    // synchronous design-geometry stage, not in this async lifecycle).
    const conduit = outcome.states['CONDUIT-FILL-PENDING'];
    expect(conduit.resolverImplemented).toBe(true);
    expect(conduit.resolverId).toBe('conduit-fill@v1');
    const racking = outcome.states['RACKING-CAPACITY-SOURCE-NOT-ARCHIVED'];
    expect(racking.resolverImplemented).toBe(true);
    expect(racking.lastResolutionResult).toBe('FAILED');   // attempted, honestly unresolved
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 — an uncalled resolver cannot finalize a blocker
// ═══════════════════════════════════════════════════════════════════════════

describe('AAC WS-1 · lifecycle · the uncalled-resolver invariant', () => {
  it('FAILS when a registered resolver claims a code the lifecycle never attempted', () => {
    const registry = createResolverRegistry(PRODUCTION_RESOLVERS);
    const fakeOutcome = {
      iterations: 1, stabilized: true, iterationBound: MAX_RESOLUTION_ITERATIONS,
      states: {
        'RACKING-CAPACITY-SOURCE-NOT-ARCHIVED': {
          requirementCode: 'RACKING-CAPACITY-SOURCE-NOT-ARCHIVED',
          resolutionMode: 'AUTO_RETRIEVED', residualMode: null,
          resolverId: 'racking-capacity-document@v1', resolverImplemented: true,
          plannedResolverPhase: null, attemptedResolverIds: [], requiredInputs: [],
          resolutionEvidence: [], confidence: null, blockingReason: null, reasons: [],
          retryability: 'RETRYABLE', lastResolutionAttempt: null,
          lastResolutionResult: 'NOT_ATTEMPTED', cleared: false, resolutionAuditRef: null,
        },
      },
      evidence: [], invalidations: [], executionOrder: [], invariantViolations: [], startedAtIso: NOW,
    } as unknown as ResolutionLifecycleOutcome;
    const errors = verifyUncalledResolverInvariant(fakeOutcome, registry);
    expect(errors.join('\n')).toMatch(/was never called/);
  });

  it('PASSES on a real lifecycle run', async () => {
    const { outcome } = await runResolutionLifecycle(permitInput(), { safeDbRead: offlineRead, nowIso: NOW });
    expect(verifyUncalledResolverInvariant(outcome, createResolverRegistry(PRODUCTION_RESOLVERS))).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 — empty evidence cannot clear
// ═══════════════════════════════════════════════════════════════════════════

describe('AAC WS-1 · anti-vacuity · empty evidence never clears', () => {
  const CODE = 'ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED';

  it('a truthy clearance with NO audit ref does not clear the requirement', async () => {
    const liar: RequirementResolver = {
      id: 'fixture-truthy-no-evidence@v1', mode: 'AUTO_RETRIEVED',
      requirementCodes: [CODE], requiredInputs: [], produces: [],
      description: 'claims cleared with no audit reference',
      async run() {
        return { result: 'RESOLVED', clearance: { cleared: true, missing: [], reasons: [] } };
      },
    };
    const { outcome } = await runResolutionLifecycle(permitInput(), {
      resolvers: [liar], safeDbRead: offlineRead, nowIso: NOW,
    });
    expect(outcome.states[CODE].cleared).toBe(false);
    expect(outcome.states[CODE].resolutionAuditRef).toBeNull();
    // and the release-gate contract agrees: resolved-without-audit-ref stays OPEN
    expect(deriveRequirementStatus({ resolved: true, resolutionAuditRef: null })).toBe('OPEN');
    expect(deriveRequirementStatus({ resolved: true, resolutionAuditRef: '   ' })).toBe('OPEN');
  });

  it('a clearance WITH an audit ref clears, and the audit ref names the resolver + evidence', async () => {
    const honest: RequirementResolver = {
      id: 'fixture-archived-hazard@v1', mode: 'AUTO_RETRIEVED',
      requirementCodes: [CODE], requiredInputs: [], produces: [],
      description: 'fixture: an archived, verified climate-hazard source exists',
      async run(ctx) {
        const refs = ['document:doc-123', 'sha256:abcdef0123456789'];
        return {
          result: 'RESOLVED', clearance: { cleared: true, missing: [], reasons: [] },
          sourceQueried: 'fixture climate-hazard archive', sourceRefs: refs, confidence: 1,
          auditRef: buildResolutionAuditRef({ resolverId: 'fixture-archived-hazard@v1', sourceRefs: refs, atIso: ctx.nowIso }),
        };
      },
    };
    const { outcome } = await runResolutionLifecycle(permitInput(), {
      resolvers: [honest], safeDbRead: offlineRead, nowIso: NOW,
    });
    const st = outcome.states[CODE];
    expect(st.cleared).toBe(true);
    expect(st.resolutionAuditRef).toContain('fixture-archived-hazard@v1');
    expect(st.resolutionAuditRef).toContain('document:doc-123');
    expect(deriveRequirementStatus({ resolved: true, resolutionAuditRef: st.resolutionAuditRef })).toBe('CLEARED');
    expect(verifyClearedRequirementsHaveEvidence(outcome)).toEqual([]);
  });

  it('the validator rejects a CLEARED state carrying no evidence record', () => {
    const bogus = {
      states: {
        X: {
          requirementCode: 'X', cleared: true, resolutionAuditRef: 'AAC-RESOLVER:x@v1 @now',
          resolutionEvidence: [],
        },
      },
    } as unknown as ResolutionLifecycleOutcome;
    expect(verifyClearedRequirementsHaveEvidence(bogus).join('\n')).toMatch(/empty evidence is never proof/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 — failures preserve source / reason / retryability
// ═══════════════════════════════════════════════════════════════════════════

describe('AAC WS-1 · failure persistence', () => {
  it('a failed retrieval records resolver, inputs, source queried, exact reason, retryability, timestamp', async () => {
    const { outcome } = await runResolutionLifecycle(permitInput(), { safeDbRead: offlineRead, nowIso: NOW });
    const e = outcome.evidence.find(x => x.resolverId === 'racking-capacity-document@v1');
    expect(e).toBeTruthy();
    expect(e!.outcome).toBe('FAILED');
    expect(e!.sourceQueried).toMatch(/manufacturer_document_registry/);
    expect(e!.failureReason).toMatch(/42P01/);
    expect(e!.failureReason).toMatch(/migration 113\/114 not run/);
    expect(e!.retryability).toBe('RETRYABLE');          // a table that will exist ⇒ retryable
    expect(e!.atIso).toBe(NOW);
    expect(e!.inputs.mountId).toBe('rooftech-mini');
    expect(e!.operatorAction).toMatch(/document registry/);
  });

  it('a resolver that THROWS is recorded as FAILED with the exact error — the lifecycle never crashes', async () => {
    const boom: RequirementResolver = {
      id: 'fixture-throws@v1', mode: 'AUTO_DERIVED',
      requirementCodes: ['CONDUIT-FILL-PENDING'], requiredInputs: [], produces: [],
      description: 'fixture: throws',
      async run() { throw new Error('provider exploded'); },
    };
    const { outcome } = await runResolutionLifecycle(permitInput(), {
      resolvers: [boom], safeDbRead: offlineRead, nowIso: NOW,
    });
    const st = outcome.states['CONDUIT-FILL-PENDING'];
    expect(st.lastResolutionResult).toBe('FAILED');
    expect(st.blockingReason).toMatch(/provider exploded/);
    expect(st.cleared).toBe(false);
  });

  it('a DB-unavailable run is byte-identical to the pre-lifecycle fail-soft defaults', async () => {
    const { authority } = await runResolutionLifecycle(permitInput(), { safeDbRead: offlineRead, nowIso: NOW });
    const seed = defaultAuthorityBundle();
    expect(authority.capacityDocument).toBeNull();
    expect(authority.manufacturerDocumentsArchived).toBeNull();   // never a hard false
    expect(authority.framingCapacityDocument).toBeNull();
    expect(authority.environmentalSource).toBeNull();
    expect(authority.cableExtensionSolutions).toEqual([]);
    expect(authority.qcableServiceLoopAllowance).toBeNull();
    // the two wired-but-unresolved sockets stay null (wired ≠ stubbed)
    expect(authority.groundingDocumentEvidence).toBeNull();
    expect(authority.framingEngineerReview).toBeNull();
    expect(authority.framingReviewDigest).toBeNull();
    expect(seed.digestInvalidatedByLedger).toBe(false);
    // unknown must NOT satisfy the gate: an unreadable ledger fails closed to true
    expect(authority.digestInvalidatedByLedger).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5 — dependency invalidation triggers recalculation
// ═══════════════════════════════════════════════════════════════════════════

describe('AAC WS-1 · dependency invalidation → recalculation', () => {
  it('a changed input re-dirties its dependents, which RE-RUN in the next iteration', async () => {
    const seen: (string | null)[] = [];
    // registered BEFORE its producer, so iteration 1 runs it with the seed value
    const dependent: RequirementResolver = {
      id: 'fixture-dependent@v1', mode: 'AUTO_RETRIEVED',
      requirementCodes: ['FRAMING-AUTHORITY-UNVERIFIED'],
      requiredInputs: ['projectJurisdiction'], produces: [],
      description: 'fixture: consumes the jurisdiction',
      async run(ctx) {
        seen.push(ctx.authority.projectJurisdiction);
        return { result: 'FAILED', clearance: { cleared: false, missing: [], reasons: ['fixture'] } };
      },
    };
    const producer: RequirementResolver = {
      id: 'fixture-producer@v1', mode: 'AUTO_RETRIEVED',
      requirementCodes: [], requiredInputs: [], produces: ['projectJurisdiction'],
      description: 'fixture: produces the jurisdiction',
      async run() {
        return {
          result: 'RESOLVED', clearance: { cleared: true, missing: [], reasons: [] },
          patch: { projectJurisdiction: 'RESOLVED-AHJ' },
        };
      },
    };
    const { outcome } = await runResolutionLifecycle(permitInput(), {
      resolvers: [dependent, producer], safeDbRead: offlineRead, nowIso: NOW,
    });
    expect(seen).toEqual([null, 'RESOLVED-AHJ']);     // re-ran with the resolved input
    expect(outcome.iterations).toBe(2);
    expect(outcome.stabilized).toBe(true);
    expect(outcome.executionOrder.filter(id => id === 'fixture-dependent@v1')).toHaveLength(2);
  });

  it('AUTO_DERIVED runs BEFORE AUTO_RETRIEVED, so a derived key is available to retrieval in the SAME iteration', async () => {
    const { outcome } = await runResolutionLifecycle(permitInput(), { safeDbRead: offlineRead, nowIso: NOW });
    const derivedIdx = outcome.executionOrder.indexOf('project-authority-key@v1');
    const retrievedIdx = outcome.executionOrder.indexOf('racking-capacity-document@v1');
    expect(derivedIdx).toBeGreaterThanOrEqual(0);
    expect(retrievedIdx).toBeGreaterThan(derivedIdx);
    const e = outcome.evidence.find(x => x.resolverId === 'racking-capacity-document@v1');
    expect(e!.inputs.projectJurisdiction).toBe('FIXTURE COUNTY');
    expect(outcome.iterations).toBe(1);
    expect(outcome.stabilized).toBe(true);
  });

  it('invalidation records ride in the snapshot_digest_invalidations vocabulary and reach the persist seam', async () => {
    const persisted: string[] = [];
    const invalidator: RequirementResolver = {
      id: 'fixture-invalidator@v1', mode: 'AUTO_DERIVED',
      requirementCodes: [], requiredInputs: [], produces: [],
      description: 'fixture: raises an invalidation',
      async run(ctx) {
        return {
          result: 'RESOLVED', clearance: { cleared: true, missing: [], reasons: [] },
          invalidations: [{
            scope: 'snapshot', target: 'equipment.modules[0]', reason: 'canonical module superseded',
            invalidatedBy: 'fixture-invalidator@v1', atIso: ctx.nowIso,
          }],
        };
      },
    };
    const { outcome } = await runResolutionLifecycle(permitInput(), {
      resolvers: [invalidator], safeDbRead: offlineRead, nowIso: NOW,
      persistInvalidation: async rec => { persisted.push(`${rec.scope}:${rec.target}`); },
    });
    expect(outcome.invalidations).toHaveLength(1);
    expect(persisted).toEqual(['snapshot:equipment.modules[0]']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6 — loops are bounded
// ═══════════════════════════════════════════════════════════════════════════

describe('AAC WS-1 · bounded loops', () => {
  it('a non-converging pair terminates at the bound and reports stabilized=false', async () => {
    let n = 0;
    const flipA: RequirementResolver = {
      id: 'fixture-flip-a@v1', mode: 'AUTO_DERIVED', requirementCodes: [],
      requiredInputs: ['framingProjectApplicabilityKey'], produces: ['projectJurisdiction'],
      description: 'fixture: never converges',
      async run() { return { result: 'RESOLVED', clearance: { cleared: true, missing: [], reasons: [] }, patch: { projectJurisdiction: `A${n++}` } }; },
    };
    const flipB: RequirementResolver = {
      id: 'fixture-flip-b@v1', mode: 'AUTO_DERIVED', requirementCodes: [],
      requiredInputs: ['projectJurisdiction'], produces: ['framingProjectApplicabilityKey'],
      description: 'fixture: never converges',
      async run() { return { result: 'RESOLVED', clearance: { cleared: true, missing: [], reasons: [] }, patch: { framingProjectApplicabilityKey: `B${n++}` } }; },
    };
    const { outcome } = await runResolutionLifecycle(permitInput(), {
      resolvers: [flipA, flipB], safeDbRead: offlineRead, nowIso: NOW,
    });
    expect(outcome.iterations).toBe(MAX_RESOLUTION_ITERATIONS);
    expect(outcome.stabilized).toBe(false);              // visible, not silent
    expect(outcome.iterationBound).toBe(MAX_RESOLUTION_ITERATIONS);
    expect(verifyBoundedLifecycle(outcome)).toEqual([]); // exhausting the bound is not itself a violation
  });

  it('the bound is documented on every outcome and never exceeded', async () => {
    const { outcome } = await runResolutionLifecycle(permitInput(), { safeDbRead: offlineRead, nowIso: NOW });
    expect(MAX_RESOLUTION_ITERATIONS).toBe(3);
    expect(outcome.iterationBound).toBe(3);
    expect(outcome.iterations).toBeLessThanOrEqual(outcome.iterationBound);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7 — freeze only after stabilization (the build consumes a STABILISED bundle)
// ═══════════════════════════════════════════════════════════════════════════

describe('AAC WS-1 · freeze only after stabilization', () => {
  it('the bundle is returned only after the loop reaches its fixed point, carrying its own record', async () => {
    const { authority, outcome } = await runResolutionLifecycle(permitInput(), { safeDbRead: offlineRead, nowIso: NOW });
    expect(outcome.stabilized).toBe(true);
    expect(outcome.iterations).toBeGreaterThanOrEqual(1);
    expect(Object.keys(outcome.states).length).toBe(Object.keys(REQUIREMENT_DECLARATIONS).length);
    expect(authority.projectJurisdiction).toBe('FIXTURE COUNTY');
  });

  it('BOTH permit paths resolve authority BEFORE the sync build (GET/POST parity)', () => {
    const src = read('app/api/engineering/permit/route.ts');
    expect(src).toContain('generatePermitHTML(savedInput, undefined, selfHealAuthority)');
    expect(src).toContain('generatePermitHTML(enrichedBody, storedSldSvg, snapshotAuthority)');
    // no call site may omit the resolved authority bundle
    expect(src).not.toMatch(/generatePermitHTML\(\s*[A-Za-z_$][\w$]*\s*\)/);
    // and the GET path must resolve it first
    const resolveIdx = src.indexOf('resolveSnapshotAuthorityInputs(savedInput)');
    const genIdx = src.indexOf('generatePermitHTML(savedInput');
    expect(resolveIdx).toBeGreaterThan(-1);
    expect(genIdx).toBeGreaterThan(resolveIdx);
  });

  it('the snapshot is frozen AFTER the build, and the build is the last consumer of the bundle', () => {
    const src = read('lib/permit/generatePermit.ts');
    const buildIdx = src.indexOf('buildPermitDesignSnapshot(input, cad, {');
    const freezeIdx = src.indexOf('deepFreeze(snapshot)');
    expect(buildIdx).toBeGreaterThan(-1);
    expect(freezeIdx).toBeGreaterThan(buildIdx);
    expect(src).toContain('resolutionStates: snapshotAuthority?.resolution?.states ?? null');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8 — the renderer cannot resolve, retrieve or mutate
// ═══════════════════════════════════════════════════════════════════════════

describe('AAC WS-1 · renderer purity', () => {
  it('generatePermitHTML is SYNCHRONOUS — it cannot await a retrieval', () => {
    expect(generatePermitHTML.constructor.name).toBe('Function');   // not AsyncFunction
    const src = read('lib/permit/generatePermit.ts');
    expect(src).not.toMatch(/\bawait\s/);
  });

  it('the renderer never calls the resolution lifecycle or a resolver', () => {
    const src = read('lib/permit/generatePermit.ts');
    expect(src).not.toMatch(/runResolutionLifecycle\s*\(/);
    expect(src).not.toMatch(/resolveSnapshotAuthorityInputs\s*\(/);
    expect(src).not.toMatch(/resolveSnapshotAuthority\s*\(/);
  });

  it('the renderer never imports the async authority sources (document registry / reconciliation ledger)', () => {
    const src = read('lib/permit/generatePermit.ts');
    expect(src).not.toMatch(/from ['"]@?\/?.*documents\/registry['"]/);
    expect(src).not.toMatch(/from ['"]@?\/?.*reconciliation\/reconcile['"]/);
  });

  it('no sheet section imports the resolver framework', () => {
    // the sections render the snapshot's already-decided verdicts; resolution is
    // an upstream, pre-freeze act.
    const { readdirSync } = require('fs') as typeof import('fs');
    const dir = join(REPO, 'lib', 'permit', 'sections');
    const offenders: string[] = [];
    for (const f of readdirSync(dir).filter(f => f.endsWith('.ts'))) {
      const s = readFileSync(join(dir, f), 'utf8');
      if (/snapshot\/resolution/.test(s) || /documents\/registry/.test(s) || /reconciliation\/reconcile/.test(s)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DI harness seam + the declaration table
// ═══════════════════════════════════════════════════════════════════════════

describe('AAC WS-1 · the payload rides the EXISTING RS-1 machinery, in AUTHORITY language', () => {
  it('renders through the generic component with no FAILURE vocabulary (RGM gate 10)', async () => {
    const { outcome } = await runResolutionLifecycle(permitInput(), { safeDbRead: offlineRead, nowIso: NOW });
    // the same class the rendered-truth harness scans for on a PENDING_AUTHORITY row
    const FAILURE_CLASS = /\b(failed|failure|fails|exceeded|exceeds|non-?compliant|does not comply|violation|rejected|unsafe|defective|inadequate)\b/i;
    for (const st of Object.values(outcome.states)) {
      const p = resolutionStatePayload(st);
      const printed = Object.entries(p)
        .filter(([, v]) => v != null && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'))
        .map(([k, v]) => `${k} ${v}`).join(' · ');
      expect(printed, `${st.requirementCode}: ${printed}`).not.toMatch(FAILURE_CLASS);
    }
    // the MACHINE vocabulary the directive mandates is preserved on the state
    const racking = outcome.states['RACKING-CAPACITY-SOURCE-NOT-ARCHIVED'];
    expect(racking.lastResolutionResult).toBe('FAILED');
    expect(resolutionStatePayload(racking).lastResolutionResult).toBe('ATTEMPTED — NOT ESTABLISHED');
    expect(RESOLUTION_RESULT_DISPLAY.NOT_ATTEMPTED).toBe('NOT YET ATTEMPTED');
  });

  it('every code the payload can reach has a declared RS-1 payload component', () => {
    for (const code of Object.keys(REQUIREMENT_DECLARATIONS)) {
      expect(blockerPayloadSchema(code)).toBeTruthy();     // fail-safe: 'generic'
    }
  });
});

describe('AAC WS-1 · DI harness seam', () => {
  it('a fixture provider can be injected in place of the production resolver set (fixture proof ≠ live proof)', async () => {
    const calls: string[] = [];
    const fixtureProvider: RequirementResolver = {
      id: 'fixture-provider@v1', mode: 'AUTO_RETRIEVED',
      requirementCodes: ['CODE-AUTHORITY-INCOMPLETE'], requiredInputs: ['projectJurisdiction'], produces: [],
      description: 'fixture AHJ provider',
      async run(ctx) {
        const r = await ctx.safeDbRead('fixture-ahj-provider', async () => { calls.push('queried'); return { nec: '2023' }; }, null);
        return {
          result: r.ok ? 'RESOLVED' : 'FAILED',
          clearance: { cleared: false, missing: [], reasons: ['fixture proof only — not a live retrieval'] },
          sourceQueried: 'FIXTURE (dependency-injected AHJ provider)',
        };
      },
    };
    const { outcome } = await runResolutionLifecycle(permitInput(), {
      resolvers: [fixtureProvider], safeDbRead: liveRead, nowIso: NOW,
    });
    expect(calls).toEqual(['queried']);
    const e = outcome.evidence.find(x => x.resolverId === 'fixture-provider@v1')!;
    expect(e.sourceQueried).toMatch(/^FIXTURE/);          // fixture proof is labelled
    expect(outcome.states['CODE-AUTHORITY-INCOMPLETE'].lastResolutionResult).toBe('RESOLVED');
  });

  it('the registry rejects duplicate resolver ids and unknown lookups', () => {
    const reg = createResolverRegistry(PRODUCTION_RESOLVERS);
    expect(reg.get('nope@v1')).toBeNull();
    expect(() => reg.register(PRODUCTION_RESOLVERS[0])).toThrow(/duplicate resolver id/);
    expect(reg.forRequirement('RACKING-CAPACITY-SOURCE-NOT-ARCHIVED').map(r => r.id))
      .toContain('racking-capacity-document@v1');
  });
});

describe('AAC WS-1 · the resolution-mode declaration table', () => {
  it('every declared requirement carries exactly one mode with a stated basis, and the map validates', () => {
    expect(validateReleaseGateMap()).toEqual([]);
    expect(validateResolutionDeclarations(createResolverRegistry(PRODUCTION_RESOLVERS))).toEqual([]);
    for (const [code, d] of Object.entries(REQUIREMENT_DECLARATIONS)) {
      expect(RESOLUTION_MODES, code).toContain(d.resolutionMode);
      expect(d.modeBasis.trim().length, code).toBeGreaterThan(20);
      if (d.resolverId) expect(isAutomaticMode(d.resolutionMode), code).toBe(true);
    }
  });

  it('the audit\'s honest classifications are the declared ones', () => {
    const D = REQUIREMENT_DECLARATIONS;
    // ADMINISTRATIVE: the engine must never rename a user project.
    expect(D['PROJECT-NAME-NONPRODUCTION'].resolutionMode).toBe('OPERATOR_CONFIRMATION');
    expect(D['PROJECT-NAME-NONPRODUCTION'].findingType).toBe('ADMINISTRATIVE_HOLD');
    expect(D['PROJECT-NAME-NONPRODUCTION'].resolverId ?? null).toBeNull();
    // the SPLIT codes carry a residual mode
    expect(D['ROUTE-LENGTH-ESTIMATE'].resolutionMode).toBe('AUTO_DERIVED');
    expect(D['ROUTE-LENGTH-ESTIMATE'].residualMode).toBe('FIELD_VERIFICATION');
    expect(D['FRAMING-AUTHORITY-UNVERIFIED'].residualMode).toBe('PROFESSIONAL_APPROVAL');
    expect(D['MODULE-EXACT-DATASHEET-PENDING'].residualMode).toBe('AUTO_RETRIEVED');
    expect(D['EQUIPMENT-IDENTITY-CONFLICT'].residualMode).toBe('OPERATOR_CONFIRMATION');
    // the legitimately non-automatic survivors
    expect(D['TAP-CONDUCTOR-LENGTH-PENDING'].resolutionMode).toBe('FIELD_VERIFICATION');
    expect(D['ENGINEERING-REVIEW-PENDING'].resolutionMode).toBe('PROFESSIONAL_APPROVAL');
    expect(D['MOUNT-TOPOLOGY-UNKNOWN'].resolutionMode).toBe('OPERATOR_CONFIRMATION');
    // the deterministic ones
    expect(D['CONDUIT-FILL-PENDING'].resolutionMode).toBe('AUTO_DERIVED');
    expect(D['QCABLE-PROCUREMENT-INSUFFICIENT'].resolutionMode).toBe('AUTO_DERIVED');
    expect(D['DESIGNER-OF-RECORD-MISSING'].resolutionMode).toBe('AUTO_DERIVED');
  });

  it('a FIELD_VERIFICATION / PROFESSIONAL_APPROVAL requirement may never declare an auto-resolver', () => {
    for (const [code, d] of Object.entries(REQUIREMENT_DECLARATIONS)) {
      if (d.resolutionMode === 'FIELD_VERIFICATION' || d.resolutionMode === 'PROFESSIONAL_APPROVAL'
        || d.resolutionMode === 'OPERATOR_CONFIRMATION') {
        expect(d.resolverId ?? null, code).toBeNull();
      }
    }
  });
});
