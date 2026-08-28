// ═══════════════════════════════════════════════════════════════════════════
// OAR — OUTAGE-RESILIENT AUTHORITY RETENTION.
//
// TWO DEFECTS, both "a refresh could not complete" being treated as "this is not
// established", and both silently replacing accepted authority with something
// weaker.
//
// A · LEGAL JURISDICTION. Measured on the real path with Census forced to time
//     out, one unchanged design:
//        legalJurisdiction  "Madison County Building & Zoning" [verified]
//                        →  "City of Granite City Building & Zoning" [unverified]
//        resolutionAuthority.projectLegalAuthority   PRESENT → NULL
//        project.ahjName (RENDERED)   Madison County → City of Granite City
//     Granite City is the MAILING city that `project-authority-key@v1` seeds from
//     the posted record. So the outage did not merely reopen a requirement and
//     move the digest — it re-stamped the package with the wrong jurisdiction and
//     (via `legalUsable`) blocked document archival. D4's defect, at runtime,
//     driven by transport health.
//
// B · REGISTRY DOCUMENTS. `racking-documents@v1` built its candidate pool only
//     from attempts that RETRIEVED in THIS run, so one timeout emptied it and
//     `selectEquipmentDocument` fell REGISTRY_CANDIDATE → STATIC_ASSET: an
//     unhashed render cache cited in place of the archived document already on
//     file. Measured: 111 canonical-body leaf paths moved.
//
// THE RULE UNDER TEST: accepted durable authority > temporary retrieval health.
// And its limit — retention is NOT promotion, and a source that ANSWERS
// (NO_COVERAGE, AMBIGUOUS, a revoked verification, a changed hash) is a finding
// that must still move everything it should.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';
import { resolveSnapshotAuthorityInputs } from '@/lib/permit/snapshot/authorityInputs';
import { projectReleaseGates } from '@/lib/permit/snapshot/releaseGates';
import { computeSnapshotDigest, canonicalDigestBody } from '@/lib/permit/snapshot/digest';
import { decideReviewCoverage } from '@/lib/permit/snapshot/reviewCoverage';
import { selectEquipmentDocument } from '@/lib/permit/snapshot/documentAuthority';
import {
  readRetainedLegalAuthority, isGovernedLegalAuthority, isRefreshOutage,
  isUsableRegistryAuthority, registryRowToIdentity,
} from '@/lib/permit/snapshot/resolution/retainedAuthority';
import { createFixturePropertyProvider } from '@/lib/providers/property/fixtures';
import type { SafeDbRead } from '@/lib/permit/snapshot/resolution/types';
import type { RegistryDocument } from '@/lib/documents/types';
import type { EngineeringReviewCoverage } from '@/lib/engineeringReview/types';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');
const NOW = '2026-08-06T12:00:00.000Z';

/** The DB is never touched: every read fails soft, exactly as production does
 *  with no database. Registry rows are injected per-test where a test needs them. */
const offlineRead: SafeDbRead = async (_l, _r, failSoftTo) =>
  ({ value: failSoftTo, ok: false, error: 'offline (test)' });

/** A guarded read that answers `listDocuments(equipment:…)` with real rows and
 *  fails everything else soft — the production shape of "the registry is
 *  readable, the network is not". */
function registryRead(rows: RegistryDocument[]): SafeDbRead {
  return async (label, _r, failSoftTo) => {
    if (label.startsWith('listDocuments(equipment:')) return { value: rows as never, ok: true, error: null };
    return { value: failSoftTo, ok: false, error: 'offline (test)' };
  };
}

// ── providers ────────────────────────────────────────────────────────────────
const failingProperty = (message: string, kind = 'TRANSPORT'): Record<string, unknown> => ({
  name: 'census-property-identity', isConfigured: () => true, metered: false,
  getPropertyIdentity: async () => ({
    ok: false, value: null, sourcesQueried: ['https://geocoding.geo.census.gov/onelineaddress'],
    retrievedAtIso: NOW, confidence: 0, failure: message, failureKind: kind, operatorAction: null,
  }),
});
const failingDocumentRetrieval = (message: string): Record<string, unknown> => ({
  name: 'http-document-retrieval', isConfigured: () => true, metered: false,
  fetchDocument: async () => ({
    ok: false, value: null, sourcesQueried: [], retrievedAtIso: NOW, confidence: 0,
    failure: message, failureKind: 'TRANSPORT', operatorAction: null,
  }),
});

// ── a durable registry row for the live mount ────────────────────────────────
const MOUNT_ID = 'rooftech-mini';
function registryRow(over: Partial<RegistryDocument> = {}): RegistryDocument {
  return {
    id: 'doc-rooftech-rtmini-install-manual-2f6035586e94',
    documentClass: 'racking_installation_manual' as RegistryDocument['documentClass'],
    manufacturerOrIssuer: 'Roof Tech, Inc.',
    equipmentId: MOUNT_ID,
    equipmentModelApplicability: 'RT-MINI',
    title: 'Roof Tech RT-MINI Installation Manual (Jan 2021)',
    revision: null, documentDate: '2026-07-28',
    archivedFileIdentity: 'https://design.roof-tech.us/PDF/Installation-Manuals/Installation-Manual-RT-MINI.pdf',
    archivedInRepo: true,
    sha256: '2f6035586e948758ff1892f2775a1a6905120750eaf2158f206a2155687486be',
    source: 'https://design.roof-tech.us/PDF/Installation-Manuals/Installation-Manual-RT-MINI.pdf',
    jurisdictionBoundary: 'Madison County Building & Zoning',
    jurisdictionAuthorityId: 'il-madison-county',
    applicabilityNotes: null,
    status: 'current' as RegistryDocument['status'],
    supersedesId: null, supersededById: null, extractedClaims: null,
    verificationState: 'unverified' as RegistryDocument['verificationState'],
    reviewer: null, verifiedBy: null, verifiedAt: null, verificationNotes: null,
    createdBy: 'test', createdAt: NOW, updatedAt: NOW,
    ...over,
  } as RegistryDocument;
}

interface Built { snap: PermitDesignSnapshot; html: string; htmlSha: string; digest: string; states: Record<string, { lastResolutionResult: string; cleared: boolean; resolutionEvidence: { failureReason: string | null; inputs: Record<string, unknown> }[] }> }

async function build(opts: {
  providers?: Record<string, unknown>;
  read?: SafeDbRead;
  priorSnapshot?: unknown;
  mutate?: (input: Record<string, unknown>) => void;
} = {}): Promise<Built> {
  const input = clone(braidonOriginalAuditFixture) as unknown as Record<string, unknown>;
  input.generatedAtIso = NOW;
  input.projectId = 'c0ffee00-0000-4000-8000-00000000000a';
  const p = input.project as Record<string, unknown>;
  p.projectName = 'OAR CONTROLLED FIXTURE';
  p.designer = 'Dana Reyes';
  if (opts.priorSnapshot) input._priorSnapshot = opts.priorSnapshot;
  opts.mutate?.(input);
  const authority = await resolveSnapshotAuthorityInputs(input as never, {
    safeDbRead: opts.read ?? offlineRead,
    nowIso: NOW,
    providers: (opts.providers ?? { propertyIdentity: createFixturePropertyProvider({ nowIso: NOW }) }) as never,
  });
  const html = generatePermitHTML(input as never, undefined, authority as never);
  const snap = (input as unknown as { _snapshot: PermitDesignSnapshot })._snapshot;
  return {
    snap, html, htmlSha: sha(html), digest: snap.meta.digest,
    states: (authority as { resolution?: { states: Built['states'] } }).resolution?.states ?? {},
  };
}

const legal = (s: PermitDesignSnapshot) => s.resolutionAuthority?.legalJurisdiction ?? null;
const unresolved = (s: PermitDesignSnapshot): string[] =>
  s.permitReadiness.registry.filter(r => !r.resolved).map(r => r.code).sort();
const gateState = (s: PermitDesignSnapshot): string =>
  JSON.stringify(projectReleaseGates(s).gates.map(g => [g.gateId, g.status]));
const bodyDiff = (a: PermitDesignSnapshot, b: PermitDesignSnapshot): string[] => {
  const walk = (v: unknown, p = '', out: Map<string, string> = new Map()): Map<string, string> => {
    if (v && typeof v === 'object') {
      if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`, out));
      else for (const [k, x] of Object.entries(v)) walk(x, p ? `${p}.${k}` : k, out);
      return out;
    }
    out.set(p, JSON.stringify(v)); return out;
  };
  const la = walk(canonicalDigestBody(a as never)), lb = walk(canonicalDigestBody(b as never));
  const out: string[] = [];
  for (const k of new Set([...la.keys(), ...lb.keys()])) if (la.get(k) !== lb.get(k)) out.push(`${k}: ${la.get(k)} → ${lb.get(k)}`);
  return out.sort();
};

// ═══════════════════════════════════════════════════════════════════════════
// §A — LEGAL JURISDICTION
// ═══════════════════════════════════════════════════════════════════════════

describe('OAR §A · a Census outage does not unmake a legal determination', () => {
  it('0. the baseline actually establishes a VERIFIED county authority (anti-vacuity)', async () => {
    const ok = await build();
    expect(isGovernedLegalAuthority(legal(ok.snap))).toBe(true);
    expect(legal(ok.snap)!.ahjRecordId).toBe('il-madison-county');
    expect(legal(ok.snap)!.verificationState).toBe('verified');
    expect(unresolved(ok.snap)).not.toContain('PROJECT-AUTHORITY-UNVERIFIED');
    // and it is readable back as retained authority
    expect(readRetainedLegalAuthority({ _priorSnapshot: ok.snap })).toBeTruthy();
  }, 300_000);

  it('1. NO retained authority + Census outage ⇒ nothing fabricated, requirement open, failure kept', async () => {
    const b = await build({ providers: { propertyIdentity: failingProperty('ETIMEDOUT connection timed out after 30000ms') } });
    expect(isGovernedLegalAuthority(legal(b.snap))).toBe(false);
    expect(unresolved(b.snap)).toContain('PROJECT-AUTHORITY-UNVERIFIED');
    expect(b.states['PROJECT-AUTHORITY-UNVERIFIED'].cleared).toBe(false);
    expect(JSON.stringify(b.snap.resolverAttemptEvidence)).toContain('ETIMEDOUT');
  }, 300_000);

  it('2. RETAINED verified authority + Census outage ⇒ same authority, digest, gates and artifact', async () => {
    const ok = await build();
    const out = await build({
      providers: { propertyIdentity: failingProperty('ETIMEDOUT connection timed out after 30000ms') },
      priorSnapshot: ok.snap,
    });
    expect(bodyDiff(ok.snap, out.snap)).toEqual([]);
    expect(out.digest).toBe(ok.digest);
    expect(out.html).toBe(ok.html);
    expect(legal(out.snap)).toEqual(legal(ok.snap));
    expect(unresolved(out.snap)).toEqual(unresolved(ok.snap));
    expect(gateState(out.snap)).toBe(gateState(ok.snap));
    // the RENDERED jurisdiction did not revert to the mailing city
    expect(out.snap.project.ahj.name).toBe(ok.snap.project.ahj.name);
    expect(out.html).not.toContain('City of Granite City Building &amp; Zoning');
    // the outage is still on the record
    expect(JSON.stringify(out.snap.resolverAttemptEvidence)).toContain('ETIMEDOUT');
    expect(JSON.stringify(ok.snap.resolverAttemptEvidence)).not.toContain('ETIMEDOUT');
  }, 300_000);

  it('3. two different outage wordings ⇒ one digest, one artifact, differing attempt evidence', async () => {
    const ok = await build();
    const a = await build({ providers: { propertyIdentity: failingProperty('ETIMEDOUT connection timed out after 30000ms') }, priorSnapshot: ok.snap });
    const b = await build({ providers: { propertyIdentity: failingProperty('ECONNRESET socket hang up (attempt 4)') }, priorSnapshot: ok.snap });
    expect(bodyDiff(a.snap, b.snap)).toEqual([]);
    expect(a.digest).toBe(b.digest);
    expect(a.html).toBe(b.html);
    expect(JSON.stringify(a.snap.resolverAttemptEvidence)).toContain('ETIMEDOUT');
    expect(JSON.stringify(b.snap.resolverAttemptEvidence)).toContain('ECONNRESET');
  }, 300_000);

  it('4. Census SUCCEEDS with the same authority ⇒ same identity, same digest', async () => {
    const first = await build();
    const again = await build({ priorSnapshot: first.snap });
    expect(again.digest).toBe(first.digest);
    expect(legal(again.snap)).toEqual(legal(first.snap));
    expect(again.states['PROJECT-AUTHORITY-UNVERIFIED'].resolutionEvidence[0].inputs.retentionState)
      .toBe('REFRESH_SUCCEEDED_SAME_AUTHORITY');
  }, 300_000);

  it('5. Census returns a genuinely DIFFERENT authority ⇒ no silent overwrite', async () => {
    const first = await build();
    // A retained authority naming a different jurisdiction than the refresh will.
    const priorOther = clone(first.snap) as unknown as { resolutionAuthority: Record<string, unknown> };
    (priorOther.resolutionAuthority.legalJurisdiction as Record<string, unknown>).ahjRecordId = 'il-some-other-county';
    (priorOther.resolutionAuthority.legalJurisdiction as Record<string, unknown>).ahjName = 'Some Other County Building & Zoning';
    const refreshed = await build({ priorSnapshot: priorOther });
    // the refresh IS verified, so it supersedes through the governed path…
    expect(refreshed.states['PROJECT-AUTHORITY-UNVERIFIED'].resolutionEvidence[0].inputs.retentionState)
      .toBe('REFRESH_SUCCEEDED_CHANGED_AUTHORITY');
    expect(legal(refreshed.snap)!.ahjRecordId).toBe('il-madison-county');
    // …and a digest bound to the OTHER authority does not survive it (D11)
    const priorDigest = 'a'.repeat(64);
    expect(decideReviewCoverage({ coverage: approvalOf(priorDigest), designDigest: refreshed.digest, invalidations: [] }).covers).toBe(false);
  }, 300_000);

  it('5b. an UNVERIFIED refresh may not displace a governed authority — it surfaces a conflict', async () => {
    const ok = await build();
    // NO_COVERAGE: the source ANSWERED, so this is a finding, never an outage.
    const answered = await build({
      providers: { propertyIdentity: failingProperty('census: no address match for 1010 Franklin St', 'NO_COVERAGE') },
      priorSnapshot: ok.snap,
    });
    expect(isRefreshOutage('NO_COVERAGE')).toBe(false);
    expect(answered.states['PROJECT-AUTHORITY-UNVERIFIED'].cleared).toBe(false);
    expect(unresolved(answered.snap)).toContain('PROJECT-AUTHORITY-UNVERIFIED');
    expect(answered.digest).not.toBe(ok.digest);
  }, 300_000);

  it('6. an UNVERIFIED stored jurisdiction is NOT retained as verified authority (D4)', async () => {
    const ok = await build();
    for (const state of ['unverified', 'conflict', 'unresolved']) {
      const tainted = clone(ok.snap) as unknown as { resolutionAuthority: Record<string, unknown> };
      (tainted.resolutionAuthority.legalJurisdiction as Record<string, unknown>).verificationState = state;
      expect(readRetainedLegalAuthority({ _priorSnapshot: tainted }), state).toBeNull();
    }
    // …nor one whose backing record was never verified
    const unbacked = clone(ok.snap) as unknown as { resolutionAuthority: Record<string, unknown> };
    (unbacked.resolutionAuthority.projectLegalAuthority as Record<string, unknown>).verified = false;
    expect(readRetainedLegalAuthority({ _priorSnapshot: unbacked })).toBeNull();
    // …and retention must therefore NOT clear the requirement on an outage
    const b = await build({
      providers: { propertyIdentity: failingProperty('ETIMEDOUT connection timed out') },
      priorSnapshot: unbacked,
    });
    expect(unresolved(b.snap)).toContain('PROJECT-AUTHORITY-UNVERIFIED');
  }, 300_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// §B — REGISTRY DOCUMENT AUTHORITY
// ═══════════════════════════════════════════════════════════════════════════

describe('OAR §B · a retrieval timeout does not downgrade an accepted registry document', () => {
  it('7. registry row on file + retrieval timeout ⇒ same document, hash, states and digest', async () => {
    const rows = [registryRow()];
    const withRetrieval = await build({ read: registryRead(rows) });
    const withTimeout = await build({
      read: registryRead(rows),
      providers: {
        propertyIdentity: createFixturePropertyProvider({ nowIso: NOW }),
        documentRetrieval: failingDocumentRetrieval('ETIMEDOUT connection timed out after 30000ms'),
      },
    });
    const sel = (b: Built) =>
      b.snap.equipmentDocumentAuthority?.entries?.[`racking_detail:${MOUNT_ID}`]?.selectedDocument ?? null;
    expect(sel(withTimeout), 'a document must be selected at all').toBeTruthy();
    expect(sel(withTimeout)!.documentId).toBe(rows[0].id);
    expect(sel(withTimeout)!.sha256).toBe(rows[0].sha256);
    expect(sel(withTimeout)!.tier).not.toBe('STATIC_ASSET');
    expect(sel(withTimeout)!.verificationState).toBe('unverified');   // never promoted
    expect(sel(withTimeout)).toEqual(sel(withRetrieval));
    expect(bodyDiff(withRetrieval.snap, withTimeout.snap)).toEqual([]);
    expect(withTimeout.digest).toBe(withRetrieval.digest);
    expect(withTimeout.html).toBe(withRetrieval.html);
    expect(JSON.stringify(withTimeout.snap.resolverAttemptEvidence)).toContain('ETIMEDOUT');
  }, 300_000);

  it('8. NO registry row + retrieval timeout ⇒ nothing fabricated, requirement unresolved', async () => {
    const b = await build({
      read: registryRead([]),
      providers: {
        propertyIdentity: createFixturePropertyProvider({ nowIso: NOW }),
        documentRetrieval: failingDocumentRetrieval('ETIMEDOUT connection timed out'),
      },
    });
    const sel = b.snap.equipmentDocumentAuthority?.entries?.[`racking_detail:${MOUNT_ID}`]?.selectedDocument ?? null;
    expect(sel?.documentId ?? null).toBeNull();
    // 2026-08-28 RT-MINI MIGRATION - the scenario's premise was "no
    // document exists anywhere". SolarPro now SHIPS the stamped RT-Mini II
    // Illinois PE letter, archived and hashed in-repo, so the capacity
    // requirement resolves from it - offline, because the catalogue is a pure
    // in-repo table and never touches the network.
    //
    // The invariant this case exists for is NOTHING IS FABRICATED, and that is
    // what is asserted now: with no registry row and a dead retrieval, no
    // registry document is selected, and the capacity that IS published traces to
    // an archived hash rather than to the failed retrieval.
    const ra = b.snap.structural.rackingAssembly as unknown as {
      documentRoles: Record<string, { established: boolean; documentId: string | null; documentHash: string | null }>;
    };
    const cap = ra.documentRoles.structuralCapacityAuthority;
    expect(cap.documentId).toMatch(/^mfr-struct:/);
    expect(cap.documentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(b.snap.resolverAttemptEvidence)).toContain('ETIMEDOUT');
  }, 300_000);

  it('9. the registry document HASH changes ⇒ digest moves', async () => {
    const a = await build({ read: registryRead([registryRow()]) });
    const b = await build({ read: registryRead([registryRow({ sha256: 'f'.repeat(64) })]) });
    expect(b.digest).not.toBe(a.digest);
  }, 300_000);

  it('10. verification REVOKED / document WITHDRAWN is material, never masked as an outage', async () => {
    const a = await build({ read: registryRead([registryRow({ verificationState: 'verified' as RegistryDocument['verificationState'] })]) });
    const revoked = await build({ read: registryRead([registryRow({ verificationState: 'unverified' as RegistryDocument['verificationState'] })]) });
    expect(revoked.digest).not.toBe(a.digest);
    // a WITHDRAWN row is not usable authority at all — it leaves the pool
    expect(isUsableRegistryAuthority(registryRowToIdentity(registryRow({ status: 'withdrawn' as RegistryDocument['status'] })))).toBe(false);
    expect(isUsableRegistryAuthority(registryRowToIdentity(registryRow({ archivedInRepo: false })))).toBe(false);
    expect(isUsableRegistryAuthority(registryRowToIdentity(registryRow({ sha256: null })))).toBe(false);
    const withdrawn = await build({ read: registryRead([registryRow({ status: 'withdrawn' as RegistryDocument['status'] })]) });
    const sel = withdrawn.snap.equipmentDocumentAuthority?.entries?.[`racking_detail:${MOUNT_ID}`]?.selectedDocument ?? null;
    expect(sel?.documentId ?? null).toBeNull();
    expect(withdrawn.digest).not.toBe(a.digest);
  }, 300_000);

  it('11. retrieval success and retrieval timeout over the SAME accepted facts agree', async () => {
    const rows = [registryRow()];
    const success = await build({ read: registryRead(rows) });
    const timeout = await build({
      read: registryRead(rows),
      providers: {
        propertyIdentity: createFixturePropertyProvider({ nowIso: NOW }),
        documentRetrieval: failingDocumentRetrieval('ECONNRESET socket hang up'),
      },
    });
    expect(timeout.digest).toBe(success.digest);
    expect(timeout.html).toBe(success.html);
    expect(JSON.stringify(timeout.snap.resolverAttemptEvidence))
      .not.toBe(JSON.stringify(success.snap.resolverAttemptEvidence));
  }, 300_000);

  it('11b. the precedence rule itself: an accepted registry row outranks a static asset', () => {
    const candidate = registryRowToIdentity(registryRow());
    const withRegistry = selectEquipmentDocument({
      selectedModel: 'RT-MINI', candidates: [candidate],
      staticAsset: { id: 'asset-1', docTitle: 'RT-MINI II manual', sourceUrl: 'https://x/ii.pdf', model: 'RT-MINI II' },
    });
    expect(withRegistry.tier).toBe('REGISTRY_CANDIDATE');
    expect(withRegistry.documentId).toBe(candidate.documentId);
    const withoutRegistry = selectEquipmentDocument({
      selectedModel: 'RT-MINI', candidates: [],
      staticAsset: { id: 'asset-1', docTitle: 'RT-MINI II manual', sourceUrl: 'https://x/ii.pdf', model: 'RT-MINI II' },
    });
    expect(withoutRegistry.tier).toBe('STATIC_ASSET');   // ← what a timeout used to produce
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §C — CROSS-SYSTEM CONSISTENCY + THE EARLIER REGRESSIONS
// ═══════════════════════════════════════════════════════════════════════════

describe('OAR §C · one frozen authority value, and no earlier guarantee regressed', () => {
  it('12. digest, gates, approval coverage and the rendered citation read ONE frozen value', async () => {
    const b = await build({ read: registryRead([registryRow()]) });
    const snap = b.snap;

    // the accepted authority is frozen, once
    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.resolutionAuthority)).toBe(true);
    const jurisdiction = legal(snap)!;
    expect(Object.isFrozen(jurisdiction)).toBe(true);
    // …and the identity the SHEETS name is that same accepted authority
    expect(snap.project.ahj.name).toBe(jurisdiction.ahjName);
    // the sheets escape `&`, so compare the escaped form
    expect(b.html).toContain(String(jurisdiction.ahjName).replace(/&/g, '&amp;'));

    // the selected document is decided ONCE and frozen; renderers read it
    const entry = snap.equipmentDocumentAuthority.entries[`racking_detail:${MOUNT_ID}`];
    expect(Object.isFrozen(entry.selectedDocument)).toBe(true);
    // re-running the pure precedence rule over the SAME frozen candidate pool
    // reproduces the stored selection — it is a projection of it, not a rival
    const pool = snap.equipmentDocumentAuthority.registryDocuments[`racking_detail:${MOUNT_ID}`] ?? [];
    const reselected = selectEquipmentDocument({
      selectedModel: snap.equipment.mount?.model ?? null,
      candidates: pool,
      staticAsset: null,
    });
    expect(reselected.documentId).toBe(entry.selectedDocument.documentId);
    expect(reselected.sha256).toBe(entry.selectedDocument.sha256);

    // gates project from the same frozen registry, twice identically
    expect(JSON.stringify(projectReleaseGates(snap))).toBe(JSON.stringify(projectReleaseGates(snap)));
    // approval coverage reads the one stored digest
    expect(decideReviewCoverage({ coverage: approvalOf(snap.meta.digest), designDigest: snap.meta.digest, invalidations: [] }).covers).toBe(true);
    // the operational container still does not participate in the digest
    expect(Object.keys(canonicalDigestBody(snap as never) as object)).not.toContain('resolverAttemptEvidence');
  }, 300_000);

  it('13. the earlier drift guarantees still hold', async () => {
    const ok = await build();
    // cross-day stability (D11)
    const later = await build({ mutate: i => { i.generatedAtIso = '2027-01-01T12:00:00.000Z'; } });
    expect(later.digest).toBe(ok.digest);
    // datasheet capture provenance still MATERIAL (the anti-broad-exclusion guard)
    const raw = clone(ok.snap) as unknown as Record<string, unknown>;
    let hit = 0;
    const walk = (v: unknown): void => {
      if (!v || typeof v !== 'object') return;
      const o = v as Record<string, unknown>;
      const ds = o.datasheet as Record<string, unknown> | undefined;
      if (ds && typeof ds === 'object' && 'capturedAtIso' in ds) { ds.capturedAtIso = '2031-01-01T00:00:00.000Z'; hit++; }
      for (const x of Object.values(o)) walk(x);
    };
    walk(raw);
    expect(hit).toBeGreaterThan(0);
    expect(computeSnapshotDigest(raw)).not.toBe(computeSnapshotDigest(clone(ok.snap) as never));
    // transient wording still excluded, material failureKind still honoured
    expect(isRefreshOutage('TRANSPORT')).toBe(true);
    expect(isRefreshOutage('PARSE')).toBe(true);
    expect(isRefreshOutage('NO_COVERAGE')).toBe(false);
    expect(isRefreshOutage('AMBIGUOUS')).toBe(false);
    expect(isRefreshOutage('NOT_CONFIGURED')).toBe(false);
  }, 300_000);
});

function approvalOf(digest: string): EngineeringReviewCoverage {
  return {
    covered: true, reviewedDigest: digest, approvedAtIso: '2026-08-04T10:00:00.000Z',
    reviewerName: 'Jordan Vale, PE', reviewerRole: 'engineer_of_record',
    reviewerLicense: '062-071234', reviewerLicenseState: 'IL',
    scopeStatement: 'Structural and electrical review of the complete permit set.',
    recordId: 'rec-oar-0001',
    // A.1.1 §2 — review without seal; this suite is about outage retention, not
    // the seal precondition.
    sealRecordId: null, sealArtifactSha256: null, sealedAtIso: null,
    sealLicenseState: null, sealVerified: false,
    storeUnavailable: false, storeError: null,
    basis: `Jordan Vale, PE approved design digest ${digest.slice(0, 12)}…`,
  };
}
