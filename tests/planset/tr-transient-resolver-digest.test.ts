// ═══════════════════════════════════════════════════════════════════════════
// TR — TRANSIENT RESOLVER DIGEST DRIFT.
//
// THE DEFECT. An unchanged permit design received a different digest because a
// transient resolver retrieval outcome changed. Proven by deterministic
// injection through the REAL lifecycle against the live stored Braidon design,
// with the clock FIXED so the transient outcome was the only variable:
//
//   forcing `safeDbRead('resolveRackingCapacityDocument')` to fail transiently
//   moved the snapshot digest and 31 of the artifact's 5201 lines, while the
//   accepted authority, the release verdict and all twelve gates were identical.
//   The ENTIRE canonical-body leaf diff was six paths:
//     permitReadiness.registry[4|6|7].payload.resolutionEvidence[0].failureReason
//     permitReadiness.registry[4|6|7].payload.resolutionEvidence[0].retryability
//   and two DIFFERENT wordings of the SAME temporary failure produced two
//   DIFFERENT digests.
//
// That is MCC §0's defect through a door MCC §0 did not close. RUN_INSTANT_KEYS
// excludes WHEN a resolver ran; nothing excluded WHAT the resolver recorded
// about the attempt. A PE approves digest D, the registry blips for one second
// on the next regeneration, the digest is D′, and the approval is dropped as
// stale by the very mechanism built to protect it.
//
// WHAT RUNS FOR REAL HERE: runResolutionLifecycle (the production resolver set,
// through the real `safeDbRead` DI seam) → generatePermitHTML →
// buildPermitDesignSnapshot → computeSnapshotDigest → projectReleaseGates →
// decideReviewCoverage → the RS-1 renderer. The ONLY substituted things are the
// authority SOCKETS — which is precisely where a transient failure originates.
//
// THE ANTI-VACUITY GUARD is §A: it sweeps EVERY safeDbRead label the production
// lifecycle actually issues, failing each one in turn with two different error
// wordings, and demands ONE digest across the whole sweep. A future resolver
// that routes a transport error into a digested field fails this test rather
// than silently re-opening the defect.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';
import { computeSnapshotDigest, canonicalDigestBody } from '@/lib/permit/snapshot/digest';
import { resolveSnapshotAuthorityInputs } from '@/lib/permit/snapshot/authorityInputs';
import { projectReleaseGates } from '@/lib/permit/snapshot/releaseGates';
import { decideReviewCoverage } from '@/lib/permit/snapshot/reviewCoverage';
import { renderBlockerPayload } from '@/lib/permit/sections/reviewStatus';
import { projectResolvedAuthority } from '@/lib/permit/snapshot/resolution/authorityProjection';
import type { SafeDbRead } from '@/lib/permit/snapshot/resolution/types';
import type { EngineeringReviewCoverage } from '@/lib/engineeringReview/types';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');
const NOW = '2026-08-06T12:00:00.000Z';

/** The controlled design. ONE stored design for every case below, so any digest
 *  movement is attributable to the injected variable and nothing else. */
function controlledInput(mutate: (input: Record<string, unknown>) => void = () => {}): Record<string, unknown> {
  const input = clone(braidonOriginalAuditFixture) as unknown as Record<string, unknown>;
  input.generatedAtIso = NOW;
  input.projectId = 'c0ffee00-0000-4000-8000-0000000000t1'.replace('t', 'a');
  const p = input.project as Record<string, unknown>;
  p.projectName = 'TR CONTROLLED TRANSIENT FIXTURE';
  p.designer = 'Dana Reyes';
  mutate(input);
  return input;
}

interface Inject {
  /** substring of the safeDbRead label to fail. */
  failLabel?: string | null;
  failMessage?: string;
  /** fail the FIRST call only, then let it through (retry proof). */
  failOnceOnly?: boolean;
}

/** The REAL guard, with an injected TRANSIENT failure. Every non-injected read
 *  behaves exactly as production's `safeDbRead` does with no database: it fails
 *  soft to the caller's blocker-firing value and reports the exact error. */
function injectedRead(inj: Inject): SafeDbRead {
  let fired = 0;
  return async <T,>(label: string, read: () => Promise<T>, failSoftTo: T) => {
    if (inj.failLabel && label.includes(inj.failLabel)) {
      const shouldFail = !inj.failOnceOnly || fired === 0;
      fired++;
      if (shouldFail) return { value: failSoftTo, ok: false, error: `${label}: ${inj.failMessage}` };
    }
    try {
      return { value: await read(), ok: true, error: null };
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string } | null;
      return { value: failSoftTo, ok: false, error: `${label}: ${e?.code ? `${e.code} ` : ''}${e?.message ?? String(err)}` };
    }
  };
}

interface Built {
  snap: PermitDesignSnapshot;
  html: string;
  htmlSha: string;
  digest: string;
  labels: string[];
}

/** THE REAL ENGINE, end to end. */
async function build(
  inj: Inject = {},
  opts: {
    mutate?: (input: Record<string, unknown>) => void;
    review?: EngineeringReviewCoverage;
    stamp?: string;
    /** overrides applied to the resolved authority BUNDLE (the sockets). */
    authority?: (a: Record<string, unknown>) => void;
  } = {},
): Promise<Built> {
  const input = controlledInput(opts.mutate);
  if (opts.stamp) input.generatedAtIso = opts.stamp;
  const labels: string[] = [];
  const inner = injectedRead(inj);
  const read: SafeDbRead = async (label, r, failSoftTo) => { labels.push(label); return inner(label, r, failSoftTo); };
  const authority = await resolveSnapshotAuthorityInputs(input as never, {
    safeDbRead: read, nowIso: opts.stamp ?? NOW, providers: {},
  });
  const bag = authority as unknown as Record<string, unknown>;
  if (opts.review) {
    bag.engineeringReview = opts.review;
    // The authority LEDGER read fails soft to `null` with no database, and null
    // means FAIL CLOSED (an unreadable invalidation ledger never releases a
    // package). A test that wants to exercise a LIVE approval must therefore
    // supply the ledger answer too — an EMPTY active-invalidation set.
    bag.digestInvalidations = [];
    bag.digestInvalidatedByLedger = false;
  }
  opts.authority?.(bag);
  const html = generatePermitHTML(input as never, undefined, authority as never);
  const snap = (input as unknown as { _snapshot: PermitDesignSnapshot })._snapshot;
  return { snap, html, htmlSha: sha(html), digest: snap.meta.digest, labels };
}

const openBlocking = (s: PermitDesignSnapshot): string[] =>
  s.permitReadiness.registry.filter(r => r.severity === 'blocking' && !r.resolved).map(r => r.code).sort();
const unresolved = (s: PermitDesignSnapshot): string[] =>
  s.permitReadiness.registry.filter(r => !r.resolved).map(r => r.code).sort();
const gateState = (s: PermitDesignSnapshot): string =>
  JSON.stringify(projectReleaseGates(s).gates.map(g => [g.gateId, g.status]));

/** Every leaf of the CANONICAL DIGEST BODY that differs — the diagnostic that
 *  turns "the digest moved" into "this path moved". */
function bodyLeafDiff(a: PermitDesignSnapshot, b: PermitDesignSnapshot): string[] {
  const walk = (v: unknown, p = '', out: Map<string, string> = new Map()): Map<string, string> => {
    if (v && typeof v === 'object') {
      if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`, out));
      else for (const [k, x] of Object.entries(v)) walk(x, p ? `${p}.${k}` : k, out);
      return out;
    }
    out.set(p, JSON.stringify(v));
    return out;
  };
  const la = walk(canonicalDigestBody(a as never)), lb = walk(canonicalDigestBody(b as never));
  const out: string[] = [];
  for (const k of new Set([...la.keys(), ...lb.keys()])) if (la.get(k) !== lb.get(k)) out.push(`${k}: ${la.get(k)} → ${lb.get(k)}`);
  return out.sort();
}

// ═══════════════════════════════════════════════════════════════════════════
// §A — THE ANTI-VACUITY SWEEP. Every real label, failed in turn, twice over.
// ═══════════════════════════════════════════════════════════════════════════

describe('TR §A · no safeDbRead label can move the digest by failing transiently', () => {
  it('sweeps EVERY label the production lifecycle issues and yields ONE digest', async () => {
    const baseline = await build();
    // the labels the REAL production resolver set actually issues on this design
    const labels = [...new Set(baseline.labels)];
    expect(labels.length, 'the sweep must exercise real labels, not an empty list').toBeGreaterThan(5);

    const digests = new Map<string, string[]>();
    const htmls = new Map<string, string[]>();
    digests.set(baseline.digest, ['<clean>']);
    htmls.set(baseline.htmlSha, ['<clean>']);

    for (const label of labels) {
      for (const [tag, message] of [
        ['wording#1', 'ETIMEDOUT connection timed out after 30000ms'],
        ['wording#2', 'ECONNRESET socket hang up while reading (attempt 3)'],
      ] as const) {
        const b = await build({ failLabel: label, failMessage: message });
        // accepted authority unchanged ⇒ the release conclusion must be unchanged
        expect(openBlocking(b.snap), `${label} ${tag} changed the open blocking set`).toEqual(openBlocking(baseline.snap));
        expect(b.snap.permitReadiness.ready, `${label} ${tag} changed the release verdict`).toBe(baseline.snap.permitReadiness.ready);
        digests.set(b.digest, [...(digests.get(b.digest) ?? []), `${label} ${tag}`]);
        htmls.set(b.htmlSha, [...(htmls.get(b.htmlSha) ?? []), `${label} ${tag}`]);
      }
    }

    if (digests.size !== 1) {
      const offender = [...digests.entries()].find(([d]) => d !== baseline.digest)!;
      const b = await build({ failLabel: offender[1][0].split(' ')[0], failMessage: 'ETIMEDOUT connection timed out after 30000ms' });
      throw new Error(
        `${digests.size} distinct digests across the transient sweep. First offender: ${offender[1].join(', ')}\n`
        + `CANONICAL BODY LEAF DIFF:\n  ${bodyLeafDiff(baseline.snap, b.snap).join('\n  ')}`);
    }
    expect(digests.size, 'one design, one digest').toBe(1);
    expect(htmls.size, 'one design, one signed artifact').toBe(1);
  }, 600_000);

  // ── the PROVIDER half of the sweep ──────────────────────────────────────
  // The `safeDbRead` sweep above would not have caught this, and the live 20-run
  // observation is what found it: `project-authority@v1` interpolated the Census
  // provider's failure string straight into `clearance.reasons`, which is
  // `blockingReason`, which is digested. A transient Census outage with two
  // different messages would have produced two different digests for one
  // unchanged design — the same defect, one door further along.
  it('two different PROVIDER failure wordings produce ONE digest and ONE artifact', async () => {
    const failing = (name: string, message: string): Record<string, unknown> => ({
      name, isConfigured: () => true, metered: false,
      getPropertyIdentity: async () => ({ ok: false, failureKind: 'TRANSPORT', failure: message, sourcesQueried: ['https://geocoding.example/onelineaddress'], operatorAction: null, value: null }),
      getAdoptedCodes: async () => ({ ok: false, failureKind: 'TRANSPORT', failure: message, sourcesQueried: ['https://ahj.example/registry'], operatorAction: null, value: null }),
      getHazards: async () => ({ ok: false, failureKind: 'TRANSPORT', failure: message, sourcesQueried: ['https://hazards.example/asce'], operatorAction: null, value: null }),
      fetchDocument: async () => ({ ok: false, failureKind: 'TRANSPORT', failure: message, sourcesQueried: [], operatorAction: null, value: null }),
    });
    const bag = (message: string): Record<string, unknown> => ({
      propertyIdentity: failing('census-property-identity', message),
      codeAdoption: failing('sunspec-ahj-registry', message),
      climateHazard: failing('asce-hazard-tool', message),
      documentRetrieval: failing('http-document-retrieval', message),
    });
    const a = await buildWithProviders(bag('ETIMEDOUT connection timed out after 30000ms'));
    const b = await buildWithProviders(bag('ECONNRESET socket hang up (attempt 4)'));
    // the RELEASE conclusion is identical — every provider is down in both runs
    expect(openBlocking(a.snap)).toEqual(openBlocking(b.snap));
    expect(bodyLeafDiff(a.snap, b.snap)).toEqual([]);
    expect(a.digest).toBe(b.digest);
    expect(a.html).toBe(b.html);
    // …and the two different failures are still on the record, still different
    expect(JSON.stringify(a.snap.resolverAttemptEvidence)).toContain('ETIMEDOUT');
    expect(JSON.stringify(b.snap.resolverAttemptEvidence)).toContain('ECONNRESET');
  }, 600_000);
});

/** Build with an explicit provider bag (the sweep above uses the empty bag). */
async function buildWithProviders(providers: Record<string, unknown>): Promise<Built> {
  const input = controlledInput();
  const labels: string[] = [];
  const inner = injectedRead({});
  const read: SafeDbRead = async (label, r, failSoftTo) => { labels.push(label); return inner(label, r, failSoftTo); };
  const authority = await resolveSnapshotAuthorityInputs(input as never, {
    safeDbRead: read, nowIso: NOW, providers: providers as never,
  });
  const html = generatePermitHTML(input as never, undefined, authority as never);
  const snap = (input as unknown as { _snapshot: PermitDesignSnapshot })._snapshot;
  return { snap, html, htmlSha: sha(html), digest: snap.meta.digest, labels };
}

// ═══════════════════════════════════════════════════════════════════════════
// §B — THE TWELVE REQUIRED CASES
// ═══════════════════════════════════════════════════════════════════════════

describe('TR §B · required cases', () => {
  it('1. twenty unchanged generations produce ONE digest, ONE artifact, one gate state', async () => {
    const runs: Built[] = [];
    for (let i = 0; i < 20; i++) runs.push(await build());
    expect(new Set(runs.map(r => r.digest)).size, 'unique snapshot digests').toBe(1);
    expect(new Set(runs.map(r => r.htmlSha)).size, 'unique HTML digests').toBe(1);
    expect(new Set(runs.map(r => r.html.length)).size, 'HTML byte counts').toBe(1);
    expect(new Set(runs.map(r => gateState(r.snap))).size, 'gate states').toBe(1);
    expect(new Set(runs.map(r => unresolved(r.snap).join('|'))).size, 'unresolved requirement sets').toBe(1);
    // byte-identical, not merely equal-hashing
    for (const r of runs) expect(r.html).toBe(runs[0].html);
  }, 600_000);

  it('2. two different TEMPORARY failures with unchanged accepted authority ⇒ same digest, verdict and artifact', async () => {
    const L = 'resolveRackingCapacityDocument';   // the injection that reproduced the defect
    const a = await build({ failLabel: L, failMessage: 'ETIMEDOUT connection timed out after 30000ms' });
    const b = await build({ failLabel: L, failMessage: 'ECONNRESET socket hang up while reading' });
    expect(bodyLeafDiff(a.snap, b.snap)).toEqual([]);
    expect(a.digest).toBe(b.digest);
    expect(a.snap.permitReadiness.ready).toBe(b.snap.permitReadiness.ready);
    expect(gateState(a.snap)).toBe(gateState(b.snap));
    expect(a.html).toBe(b.html);
    // …and the DIFFERING operational evidence is still there, differing.
    const ea = JSON.stringify(a.snap.resolverAttemptEvidence?.byRequirement);
    const eb = JSON.stringify(b.snap.resolverAttemptEvidence?.byRequirement);
    expect(ea).toContain('ETIMEDOUT');
    expect(eb).toContain('ECONNRESET');
    expect(ea).not.toBe(eb);
  }, 300_000);

  it('3. a retry sequence (fail→succeed) matches succeed-first, with the attempt history preserved apart', async () => {
    const L = 'resolveRackingCapacityDocument';
    const first = await build();
    const retried = await build({ failLabel: L, failMessage: 'ETIMEDOUT (attempt 1 of 2)', failOnceOnly: true });
    expect(bodyLeafDiff(first.snap, retried.snap)).toEqual([]);
    expect(retried.digest).toBe(first.digest);
    expect(retried.html).toBe(first.html);
    expect(JSON.stringify(retried.snap.resolverAttemptEvidence)).toContain('ETIMEDOUT (attempt 1 of 2)');
    expect(JSON.stringify(first.snap.resolverAttemptEvidence)).not.toContain('ETIMEDOUT');
  }, 300_000);

  it('4. an ACCEPTED AUTHORITY value change moves the digest and makes the approval stale (D11)', async () => {
    const base = await build();
    const D = base.digest;
    const changed = await build({}, { mutate: i => { (i.project as Record<string, unknown>).rafterSize = '2x10'; } });
    expect(changed.digest).not.toBe(D);
    // an approval bound to D no longer covers the changed design
    const still = decideReviewCoverage({ coverage: approvalOf(D), designDigest: changed.digest, invalidations: [] });
    expect(still.covers).toBe(false);
    expect(still.refusals.join(' ')).toMatch(/different design digest/);
  }, 300_000);

  it('5. a MATERIAL resolver conclusion flipping unresolved→resolved moves the digest, the gates and the requirements together', async () => {
    // NOT the approval — PRR §4 owns that, and its answer is that an approval
    // must NOT move the digest it approves. This is a genuine RESOLVER
    // conclusion: the racking capacity authority goes from "not established" to
    // "established by this verified, archived, exactly-applicable document".
    // DESIGNER-OF-RECORD-MISSING, owned by `project-personnel@v1`: with no
    // designer of record the authority is NOT ESTABLISHED and the requirement is
    // open; with one it is ESTABLISHED and the requirement closes.
    const open = await build({}, { mutate: i => { (i.project as Record<string, unknown>).designer = ''; } });
    const closed = await build();   // the controlled fixture carries a designer
    expect(open.digest, 'a material conclusion must move the digest').not.toBe(closed.digest);
    expect(unresolved(open.snap)).toContain('DESIGNER-OF-RECORD-MISSING');
    expect(unresolved(closed.snap)).not.toContain('DESIGNER-OF-RECORD-MISSING');
    // the requirement projection and the gate projection move CONSISTENTLY.
    // NOTE the gate's own STATUS is deliberately not asserted to flip: a root
    // gate stays OPEN while any sibling requirement is open, and several are.
    // What must move together is the requirement's status inside the gate model
    // and the model's summary counts.
    const reqOf = (s: PermitDesignSnapshot, code: string) =>
      projectReleaseGates(s).requirements.find(r => r.requirementCode === code) ?? null;
    expect(reqOf(open.snap, 'DESIGNER-OF-RECORD-MISSING')?.status).toBe('OPEN');
    // an ESTABLISHED authority emits no blocker at all, so the requirement
    // leaves the registry and the gate model together — never one without the
    // other, which is the consistency under test.
    expect(reqOf(closed.snap, 'DESIGNER-OF-RECORD-MISSING')).toBeNull();
    expect(JSON.stringify(projectReleaseGates(open.snap).summary))
      .not.toBe(JSON.stringify(projectReleaseGates(closed.snap).summary));
  }, 300_000);

  it('6. the same model with a different accepted document / SHA-256 moves the digest', async () => {
    // SAME selected mount, SAME everything else — only the ACCEPTED capacity
    // document changes. Both are complete, verified documents: this is not
    // "document vs no document", it is document A vs document B.
    const doc = (id: string, sha: string) => ({
      documentId: id, documentClass: 'structural_capacity_report',
      documentIdentity: `Roof Tech capacity report ${id}`,
      verificationState: 'verified', status: 'current', archivedInRepo: true, sha256: sha,
      hasStructuralCapacityClaim: true, exactModel: 'RT-MINI',
      fastenerModel: 'RT-MINI lag', fastenerCount: 1, substrate: 'rafter',
      rafterDeckCondition: '2x6 rafter @ 24 in o.c.', embedmentIn: 2.5,
      railLFootAssembly: 'rail-less', loadBasis: 'ASD allowable',
      adjustmentFactors: { Cd: 1.6, Ct: 1.0 }, jurisdiction: 'IL',
      asdAllowableLbs: 380, revisionOrDate: 'Rev 3 — 2026-02-01',
    });
    const a = await build({}, { authority: bag => { bag.capacityDocument = doc('doc-cap-A', 'a'.repeat(64)); } });
    const b = await build({}, { authority: bag => { bag.capacityDocument = doc('doc-cap-B', 'b'.repeat(64)); } });
    expect(a.digest, 'a different accepted document must move the digest').not.toBe(b.digest);
    // and a different SHA on the SAME document id moves it too
    const c = await build({}, { authority: bag => { bag.capacityDocument = doc('doc-cap-A', 'c'.repeat(64)); } });
    expect(c.digest).not.toBe(a.digest);
  }, 300_000);

  it('7. the transient failure detail stays reachable through the audit container', async () => {
    const b = await build({ failLabel: 'resolveRackingCapacityDocument', failMessage: 'ETIMEDOUT connection timed out after 30000ms' });
    const bundle = b.snap.resolverAttemptEvidence;
    expect(bundle, 'the operational container must exist when a lifecycle ran').toBeTruthy();
    const blob = JSON.stringify(bundle);
    expect(blob).toContain('ETIMEDOUT connection timed out after 30000ms');
    expect(blob).toContain('resolveRackingCapacityDocument');
    // retryability + attempt count + attempt instant are preserved, per requirement
    const anyReq = Object.values(bundle!.byRequirement)[0];
    expect(anyReq).toHaveProperty('retryability');
    expect(anyReq).toHaveProperty('attemptCount');
    expect(anyReq).toHaveProperty('lastResolutionAttempt');
    expect(anyReq.evidence.length).toBeGreaterThan(0);
    // …and NONE of it is in the digest body
    expect(JSON.stringify(canonicalDigestBody(b.snap as never))).not.toContain('ETIMEDOUT');
  }, 300_000);

  it('8. equipment.*.datasheet.capturedAtIso still MOVES the digest (the D11 broad-exclusion guard)', async () => {
    const a = await build();
    const raw = clone(a.snap) as unknown as Record<string, unknown>;
    let hit = 0;
    const walk = (v: unknown): void => {
      if (!v || typeof v !== 'object') return;
      const o = v as Record<string, unknown>;
      const ds = o.datasheet as Record<string, unknown> | undefined;
      if (ds && typeof ds === 'object' && 'capturedAtIso' in ds) { ds.capturedAtIso = '2031-01-01T00:00:00.000Z'; hit++; }
      for (const x of Object.values(o)) walk(x);
    };
    walk(raw);
    expect(hit, 'the fixture must actually carry a datasheet capture date').toBeGreaterThan(0);
    expect(computeSnapshotDigest(raw)).not.toBe(computeSnapshotDigest(clone(a.snap) as never));
  }, 300_000);

  it('9. cross-day regeneration keeps ONE digest while the displayed issue date may differ (regression guard)', async () => {
    const jul = await build({}, { stamp: '2026-07-30T12:00:00.000Z' });
    const aug = await build({}, { stamp: '2026-08-06T12:00:00.000Z' });
    const jan = await build({}, { stamp: '2027-01-01T12:00:00.000Z' });
    expect(new Set([jul.digest, aug.digest, jan.digest]).size).toBe(1);
    expect(jul.snap.meta.generatedAtIso).not.toBe(jan.snap.meta.generatedAtIso);
  }, 300_000);

  it('10. a real design mutation (+5 W per module) moves the digest', async () => {
    const a = await build();
    const b = await build({}, {
      mutate: i => {
        for (const inv of ((i.system as Record<string, unknown>)?.inverters as Record<string, unknown>[] ?? [])) {
          for (const s of ((inv?.strings as Record<string, unknown>[]) ?? [])) {
            if (typeof s?.panelWatts === 'number') s.panelWatts = (s.panelWatts as number) + 5;
          }
        }
      },
    });
    expect(b.digest).not.toBe(a.digest);
  }, 300_000);

  it('11. approve D, regenerate with DIFFERENT transient evidence ⇒ digest is still D and the approval is still current', async () => {
    const base = await build();
    const D = base.digest;
    const approval = approvalOf(D);
    // the no-op regeneration: same design, a transient registry failure this time
    const again = await build(
      { failLabel: 'resolveRackingCapacityDocument', failMessage: 'ECONNRESET socket hang up while reading' });
    expect(again.digest).toBe(D);
    const decision = decideReviewCoverage({ coverage: approval, designDigest: again.digest, invalidations: [] });
    expect(decision.covers, 'the approval must survive a transient blip').toBe(true);
    expect(decision.reviewedDigest).toBe(D);
  }, 300_000);

  it('12. every consumer reads the SAME frozen canonical value — no independent recomputation', async () => {
    const b = await build();
    const registry = b.snap.permitReadiness.registry;

    // (a) the canonical value is produced ONCE and frozen
    expect(Object.isFrozen(b.snap)).toBe(true);
    expect(Object.isFrozen(registry)).toBe(true);
    const withPayload = registry.filter(r => r.payload && typeof r.payload === 'object');
    expect(withPayload.length, 'the fixture must carry resolution payloads').toBeGreaterThan(0);
    for (const r of withPayload) {
      expect(Object.isFrozen(r)).toBe(true);
      expect(Object.isFrozen(r.payload)).toBe(true);
    }

    // (b) the RENDERER receives that same frozen instance — identity, not equality
    const rec = withPayload[0];
    const payloadRef = rec.payload;
    expect(b.snap.permitReadiness.registry.find(r => r.code === rec.code)!.payload).toBe(payloadRef);
    expect(() => renderBlockerPayload(rec)).not.toThrow();

    // (c) the RELEASE-GATE projection reads that same frozen registry, and is a
    //     pure projection of it: projecting twice yields the identical model.
    const g1 = projectReleaseGates(b.snap);
    const g2 = projectReleaseGates(b.snap);
    expect(JSON.stringify(g1)).toBe(JSON.stringify(g2));
    expect(g1.requirements.map(r => r.requirementCode).sort())
      .toEqual(registry.map(r => r.code).sort());
    for (const r of g1.requirements) expect(r.snapshotDigest).toBe(b.snap.meta.digest);

    // (d) the DIGEST reads THAT SAME canonical value and does not recompute it.
    //     A serialization boundary makes object identity impossible inside the
    //     hash (the body is normalised into a fresh tree), so the property proved
    //     here is the one the identity would have carried: the body's payload is
    //     value-identical to the stored frozen payload — it is a projection OF
    //     it, not a second computation from the raw resolution state.
    const body = canonicalDigestBody(b.snap as never) as Record<string, unknown>;
    const bodyRegistry = (body.permitReadiness as Record<string, unknown>).registry as Record<string, unknown>[];
    const idx = registry.indexOf(rec);
    expect(bodyRegistry[idx].payload).toEqual(payloadRef);

    //     …and the operational container is genuinely inert: it is not a key of
    //     the digest body at all, and deleting it leaves the digest untouched.
    expect(Object.keys(body)).not.toContain('resolverAttemptEvidence');
    expect(b.snap.resolverAttemptEvidence, 'the container must actually be populated').toBeTruthy();
    const withoutEvidence = clone(b.snap) as unknown as Record<string, unknown>;
    delete withoutEvidence.resolverAttemptEvidence;
    expect(computeSnapshotDigest(withoutEvidence))
      .toBe(computeSnapshotDigest(clone(b.snap) as unknown as Record<string, unknown>));

    // (d2) APPROVAL COVERAGE reads the one stored digest — not a recomputation.
    expect(decideReviewCoverage({
      coverage: approvalOf(b.snap.meta.digest), designDigest: b.snap.meta.digest, invalidations: [],
    }).covers).toBe(true);

    // (e) the RESOLVER-DERIVED half of every payload is exactly the projection's
    //     shape. A blocker may add its OWN structured detail (route segment ids
    //     and the like) — that is design data, not resolver attempt evidence —
    //     but no payload may carry an operational field, on any record.
    const projectionKeys = Object.keys(projectResolvedAuthority({
      requirementCode: rec.code, resolutionMode: 'AUTO_DERIVED', residualMode: null,
      resolverId: null, resolverImplemented: false, plannedResolverPhase: null,
      attemptedResolverIds: [], requiredInputs: [], resolutionEvidence: [], confidence: null,
      blockingReason: null, reasons: [], retryability: 'RETRYABLE',
      lastResolutionAttempt: null, lastResolutionResult: 'NOT_ATTEMPTED', cleared: false,
      resolutionAuditRef: null,
    }));
    for (const k of projectionKeys) expect(Object.keys(payloadRef as object)).toContain(k);
    const RETIRED_OPERATIONAL = [
      'resolutionEvidence', 'resolutionEvidenceCount', 'attemptedResolvers',
      'retryability', 'resolutionConfidence', 'lastResolutionAttempt',
    ];
    for (const r of registry) {
      for (const k of RETIRED_OPERATIONAL) {
        expect(Object.keys((r.payload ?? {}) as object), `${r.code} still carries ${k}`).not.toContain(k);
      }
    }
  }, 300_000);
});

/** An ACTIVE, licensed, scoped approval of `digest`. */
function approvalOf(digest: string): EngineeringReviewCoverage {
  return {
    covered: true,
    reviewedDigest: digest,
    approvedAtIso: '2026-08-04T10:00:00.000Z',
    reviewerName: 'Jordan Vale, PE',
    reviewerRole: 'engineer_of_record',
    reviewerLicense: '062-071234',
    reviewerLicenseState: 'IL',
    scopeStatement: 'Structural and electrical review of the complete permit set.',
    recordId: 'rec-tr-0001',
    // A.1.1 §2 — review without seal; this suite is about digest drift.
    sealRecordId: null, sealArtifactSha256: null, sealedAtIso: null,
    sealLicenseState: null, sealVerified: false,
    storeUnavailable: false,
    storeError: null,
    basis: `Jordan Vale, PE approved design digest ${digest.slice(0, 12)}…`,
  };
}
