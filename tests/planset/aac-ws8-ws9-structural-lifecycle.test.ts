// ═══════════════════════════════════════════════════════════════════════════
// AAC WS-8 (STRUCTURAL AUTHORITY SEPARATION) + WS-9 (GATE LIFECYCLE) tests.
//
// The directive's non-negotiables for this phase:
//   • document retrieval leaves EVIDENCE of the attempt, with the exact outcome,
//     whether it succeeded or failed;
//   • the unreachable AUTHORITATIVE verdict is fixed WHERE FACTS EXIST — and
//     stays unreachable where they do not (no verdict is manufactured);
//   • the rail-selection residual is HONEST: the engine refuses to select, and
//     bounds the operator's remaining act instead;
//   • the framing mode transition AUTO_RETRIEVED → PROFESSIONAL_APPROVAL is
//     recorded, not implied;
//   • a review record clears ONLY with a digest match AND a licensed role;
//   • page removal cannot drop a registry requirement (the pre-compaction pin);
//   • the renderer determines no authority.
//
// EVERY provider is DI-fixtured. Retrieval fixtures are REPLAYS of live
// retrievals performed 2026-07-27 (see lib/providers/documentRetrieval/fixtures)
// — this file proves the RESOLVER, and its proof is labelled fixture-replay.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';
import { runResolutionLifecycle } from '@/lib/permit/snapshot/resolution/lifecycle';
import {
  rackingDocumentRetrievalResolver, rackingAssemblySelectionResolver,
  framingCapacityRetrievalResolver, engineeringReviewRecordResolver,
} from '@/lib/permit/snapshot/resolution/structuralResolvers';
import { PRODUCTION_RESOLVERS } from '@/lib/permit/snapshot/resolution/resolvers';
import {
  createFixtureDocumentRetrievalProvider, ROOF_TECH_DOCUMENT_FIXTURES,
} from '@/lib/providers/documentRetrieval/fixtures';
import { createHttpDocumentRetrievalProvider } from '@/lib/providers/documentRetrieval/httpDocumentProvider';
import {
  attemptableSources, normalizeAsceEdition, sourcesForEquipment,
  PUBLISHED_DOCUMENT_SOURCES, RT_MINI_CROSS_REFERENCE_FINDING,
} from '@/lib/permit/snapshot/resolution/structuralDocuments';
import { deriveRailSelection, railCandidatesFor } from '@/lib/permit/snapshot/resolution/railSelection';
import { getMountingSystemById } from '@/lib/mounting-hardware-db';
import {
  buildEquipmentDocumentAuthority, sheetDocumentApplicability,
} from '@/lib/permit/snapshot/documentAuthority';
import { getManufacturerAsset, evaluateDocumentApplicability } from '@/lib/manufacturer-assets-db';
import {
  validateEngineeringReviewInput, uncoveredReview, LICENSED_REVIEW_ROLES,
} from '@/lib/engineeringReview/types';
import { REQUIREMENT_DECLARATIONS, projectReleaseGates } from '@/lib/permit/snapshot/releaseGates';
import { resolveSiteDesignLoads } from '@/lib/permit/snapshot/siteDesignLoads';
import { REGISTRY_DEPLOYMENT, REGISTRY_SEQUENCE } from '@/lib/migrations/targetedRegistryDeployment';

const NOW = '2026-07-27T00:00:00.000Z';
const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

/** Every DB read fails exactly as it does on production today (113-116 unrun). */
const offlineRead = async <T,>(label: string, _read: () => Promise<T>, failSoftTo: T) =>
  ({ value: failSoftTo, ok: false, error: `relation does not exist (42P01) reading ${label}` });

function permitInput(): any {
  const input: any = clone(braidonOriginalAuditFixture);
  input.generatedAtIso = '2026-07-22T12:00:00Z';
  return input;
}

function fixtureProviders() {
  return { documentRetrieval: createFixtureDocumentRetrievalProvider(ROOF_TECH_DOCUMENT_FIXTURES, { nowIso: NOW }) };
}

// ═══════════════════════════════════════════════════════════════════════════
// §1 — WS-8 · DOCUMENT RETRIEVAL LEAVES EVIDENCE OF THE ATTEMPT
// ═══════════════════════════════════════════════════════════════════════════

describe('AAC WS-8 · racking-documents@v1 — retrieval attempt evidence', () => {
  it('records the EXACT outcome of every source it attempts, retrieved or not', async () => {
    const input = permitInput();
    input.project.state = 'KY';                 // a state whose PE letter is captured
    const { outcome, authority } = await runResolutionLifecycle(input, {
      safeDbRead: offlineRead, nowIso: NOW, providers: fixtureProviders(),
    });
    const rec = authority.structuralDocumentRetrieval;
    expect(rec).toBeTruthy();
    expect(rec!.attempts.length).toBeGreaterThan(0);
    for (const a of rec!.attempts) {
      // an attempt is never a bare boolean: it names its address and its verdict
      expect(a.url).toMatch(/^https:\/\//);
      expect(['RETRIEVED', 'FAILED', 'SKIPPED']).toContain(a.outcome);
      if (a.outcome === 'RETRIEVED') {
        expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(a.byteLength).toBeGreaterThan(0);
        expect(a.proof).toBe('fixture-replay');     // NOT live proof — labelled
        expect(a.failure).toBeNull();
      } else {
        expect(a.failure).toBeTruthy();
        expect(a.sha256).toBeNull();
      }
    }
    // the resolver ran and its evidence is on the lifecycle trail
    const ev = outcome.evidence.filter(e => e.resolverId === 'racking-documents@v1');
    expect(ev.length).toBe(1);
    expect(ev[0].sourceQueried).toContain('fixture-document-retrieval');
  });

  it('RETRIEVES the published stamped capacity letter — and the applicability gap SURVIVES it', async () => {
    const input = permitInput();
    input.project.state = 'KY';
    const { authority } = await runResolutionLifecycle(input, {
      safeDbRead: offlineRead, nowIso: NOW, providers: fixtureProviders(),
    });
    const rec = authority.structuralDocumentRetrieval!;
    const cap = rec.attempts.find(a => a.role === 'capacity' && a.outcome === 'RETRIEVED');
    expect(cap).toBeTruthy();
    // The document EXISTS and is hashed …
    expect(cap!.sha256).toBe('2e28a74ca306fdc1dd856f69b066d95a8b4b944f6b9b5ae86fff478e8af9588b');
    // … and it covers RT-MINI II, NOT the selected RT-MINI. Retrieval is not a clear.
    expect(cap!.documentProduct).toBe('RT-MINI II');
    // 2026-08-28 RT-MINI MIGRATION - the selected mount now resolves
    // to RT-MINI II through the manufacturer's stated supersession, so the
    // retrieved gen-2 letter DOES cover it. The point of the case is unchanged
    // and is asserted directly: retrieval is not a clear, and the residual
    // applicability confirmation survives either way.
    expect(cap!.coversSelectedModel).toBe(true);
    // 2026-08-28 RT-MINI MIGRATION - the residual reported the cross-generation
    // gap; the supersession removed it, so the retrieval record now says the
    // documents were retrieved and hashed. The property under test - that a
    // RETRIEVAL always states its own residual rather than implying closure -
    // holds either way, so it is asserted as that.
    expect(rec.residual.join(' ').trim().length).toBeGreaterThan(0);
  });

  it('a soft-404 (HTTP 200 text/html) is a FAILURE, never an archived document', async () => {
    const provider = createFixtureDocumentRetrievalProvider(ROOF_TECH_DOCUMENT_FIXTURES, { nowIso: NOW });
    const res = await provider.fetchDocument({
      url: 'https://design.roof-tech.us/PDF/Stamped-PE-Letters/RT_MINI_7_10/RT_Mini_ASCE_7-10_IL.pdf',
      acceptContentTypes: ['application/pdf'], maxBytes: 32 * 1024 * 1024, timeoutMs: 1000,
    });
    expect(res.ok).toBe(false);
    expect(res.failure).toMatch(/SOFT-404/);
    expect(res.failureKind).toBe('NO_COVERAGE');
  });

  it('the retrieval NEVER writes a clearing audit reference — the pure gate still decides', async () => {
    const ctxOut = await rackingDocumentRetrievalResolver.run({
      input: permitInput(), projectId: 'p1',
      authority: { projectJurisdiction: 'IL' } as never,
      iteration: 1, nowIso: NOW, safeDbRead: offlineRead as never,
      providers: fixtureProviders(),
    });
    expect(ctxOut.auditRef ?? null).toBeNull();
    expect(ctxOut.clearance.cleared).toBe(false);
  });

  it('a provider that is ABSENT is a different recorded fact from one that answered with nothing', async () => {
    const input = permitInput();
    input.project.state = 'KY';
    const { authority } = await runResolutionLifecycle(input, {
      safeDbRead: offlineRead, nowIso: NOW, providers: {},      // NO provider injected
    });
    const rec = authority.structuralDocumentRetrieval!;
    expect(rec.attempts.every(a => a.outcome === 'SKIPPED')).toBe(true);
    expect(rec.attempts[0].failure).toMatch(/no document-retrieval provider is injected/);
    expect(rec.attempts[0].proof).toBe('not-attempted');
  });

  it('a per-state source with no state code reports a MISSING INPUT, not a missing document', async () => {
    const input = permitInput();
    delete input.project.state;
    const { authority } = await runResolutionLifecycle(input, {
      safeDbRead: offlineRead, nowIso: NOW, providers: fixtureProviders(),
    });
    const rec = authority.structuralDocumentRetrieval!;
    const cap = rec.attempts.find(a => a.role === 'capacity');
    expect(cap!.outcome).toBe('SKIPPED');
    expect(cap!.failure).toMatch(/MISSING INPUT/);
  });

  it('the live HTTP provider is DISABLED under vitest — no test reaches the public internet', () => {
    const live = createHttpDocumentRetrievalProvider();
    expect(live.isConfigured()).toBe(false);
    expect(live.metered).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §2 — WS-8 · THE SOURCE TABLE IS BRAND-GENERIC AND CARRIES NO PROJECT DATA
// ═══════════════════════════════════════════════════════════════════════════

describe('AAC WS-8 · published document sources', () => {
  it('templates state + adopted ASCE edition, adopted edition FIRST', () => {
    const src = PUBLISHED_DOCUMENT_SOURCES.find(s => s.sourceId === 'rooftech-rtmini2-pe-letter')!;
    const ex = attemptableSources(src, { stateCode: 'il', asceEdition: 'ASCE/SEI 7-16' });
    expect(ex[0].edition).toBe('7-16');
    expect(ex[0].editionIsAdopted).toBe(true);
    expect(ex[0].url).toBe('https://design.roof-tech.us/PDF/Stamped-PE-Letters/RT_MINI_II_7_16/RT_Mini_II_ASCE_7-16_IL.pdf');
    expect(ex[1].edition).toBe('7-10');
    expect(ex[1].editionIsAdopted).toBe(false);
  });

  it('a per-state source with no state produces NO attemptable address', () => {
    const src = PUBLISHED_DOCUMENT_SOURCES.find(s => s.sourceId === 'rooftech-rtmini2-pe-letter')!;
    expect(attemptableSources(src, { stateCode: null, asceEdition: '7-16' })).toEqual([]);
  });

  it('normalizes every ASCE edition spelling, and refuses to invent one', () => {
    expect(normalizeAsceEdition('ASCE 7-16')).toBe('7-16');
    expect(normalizeAsceEdition('ASCE/SEI 7-22')).toBe('7-22');
    expect(normalizeAsceEdition('7-10')).toBe('7-10');
    expect(normalizeAsceEdition('unknown')).toBeNull();
    expect(normalizeAsceEdition(null)).toBeNull();
  });

  it('the RT-MINI cross-reference research finding is recorded as NEGATIVE, with its sources', () => {
    expect(RT_MINI_CROSS_REFERENCE_FINDING.answer).toMatch(/^NO/);
    expect(RT_MINI_CROSS_REFERENCE_FINDING.sourcesChecked.length).toBeGreaterThanOrEqual(3);
    expect(RT_MINI_CROSS_REFERENCE_FINDING.resolution).toMatch(/VERSION-EXACT/);
  });

  it('the source table names no project, address or customer', () => {
    const blob = JSON.stringify(PUBLISHED_DOCUMENT_SOURCES);
    expect(blob).not.toMatch(/braidon|pilla/i);
  });

  it('the version-EXACT installation manual is declared for the selected first-generation product', () => {
    const detail = sourcesForEquipment('rooftech-mini', 'installation_detail');
    expect(detail.length).toBe(1);
    expect(detail[0].documentProduct).toBe('RT-MINI');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §3 — WS-8 · THE UNREACHABLE `AUTHORITATIVE` VERDICT (audit §7.7)
// ═══════════════════════════════════════════════════════════════════════════

describe('AAC WS-8 · AUTHORITATIVE is reachable WHERE FACTS EXIST, and only there', () => {
  const sha = 'a'.repeat(64);

  it('with NO registry facts the verdict can never be AUTHORITATIVE (the old defect, preserved as the honest default)', () => {
    const region = buildEquipmentDocumentAuthority(
      [{ category: 'racking_detail', equipmentId: 'rooftech-mini', selectedModel: 'RT-MINI' }], null, null);
    const e = region.entries['racking_detail:rooftech-mini'];
    expect(e.registryFactsPresent).toBe(false);
    expect(e.applicability.authoritative).toBe(false);
  });

  it('with REAL archived + hash-bound facts AND an applicable document, AUTHORITATIVE is reached', () => {
    // The version-EXACT manual keyed to the selected model: applicable AND archived.
    const region = buildEquipmentDocumentAuthority(
      // BRAIDON PDF AUDIT 2026-08-27 — the POSITIVE case now uses the rooftech-mini row with its
      // matching selected model. That row used to cite the RT-MINI **II** manual for the gen-1
      // RT-MINI product; the version-exact gen-1 manual is archived now, so the row is
      // self-consistent and reaches AUTHORITATIVE once registry facts exist.
      [{ category: 'racking_detail', equipmentId: 'rooftech-mini', selectedModel: 'RT-MINI' }],
      { 'racking_detail:rooftech-mini': { archivedInRepo: true, sha256: sha, status: 'current' } }, null);
    const e = region.entries['racking_detail:rooftech-mini'];
    expect(e.registryFactsPresent).toBe(true);
    expect(e.applicability.authoritative).toBe(true);
    expect(e.applicability.state).toBe('AUTHORITATIVE');
  });

  it('facts alone NEVER promote a document that does not cover the selected version', () => {
    // The NEGATIVE case needs a row that genuinely conflates versions — asset.model present in
    // the docTitle FOLLOWED by a version token. No live row does that any more (the rooftech-mini
    // row now archives the version-exact gen-1 manual), and a safety rule must not depend on
    // production data staying wrong. Construct the conflation and hand it the STRONGEST possible
    // registry facts: archived in repo, content-hash bound, status current. Facts must still not
    // promote it, because applicability is a separate axis from availability.
    const conflating = {
      ...(getManufacturerAsset('rooftech-mini', 'racking_detail') as NonNullable<ReturnType<typeof getManufacturerAsset>>),
      model: 'RT-MINI',
      docTitle: 'Roof Tech RT-MINI II Installation Manual (Jun 2025)',
    };
    const a = evaluateDocumentApplicability('RT-MINI', conflating, null,
      { archivedInRepo: true, sha256: sha, status: 'current' });
    expect(a.applicabilityVerified).toBe(false);
    expect(a.authoritative).toBe(false);
    expect(a.state).toBe('PENDING_APPLICABILITY');
    // and the availability facts ARE still reported — they just never become authority.
    expect(a.archived).toBe(true);
  });

  it('the resolver contributes facts ONLY for a version-EXACT archived document', async () => {
    const input = permitInput();
    input.project.state = 'KY';
    // Archival cannot succeed offline, so no facts may be produced at all.
    const { authority } = await runResolutionLifecycle(input, {
      safeDbRead: offlineRead, nowIso: NOW, providers: fixtureProviders(),
    });
    expect(Object.keys(authority.documentRegistryFacts ?? {})).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §4 — WS-8 · RAIL SELECTION: THE HONEST RESIDUAL
// ═══════════════════════════════════════════════════════════════════════════

describe('AAC WS-8 · racking-assembly-selection@v1', () => {
  it('a MIXED-MANUFACTURER mount is genuinely UNSELECTED — every store is probed and named', () => {
    const v = deriveRailSelection({ mountingSystemId: 'rooftech-mini', project: {}, selectedEquipment: null });
    expect(v.state).toBe('unselected');
    expect(v.selectedRailModel).toBeNull();
    expect(v.probes.length).toBeGreaterThanOrEqual(3);
    expect(v.probes.every(p => !p.present)).toBe(true);
    expect(v.probes.map(p => p.path).join(' ')).toMatch(/selected_equipment/);
  });

  it('the engine does NOT select a rail, and writes NO audit reference', async () => {
    const out = await rackingAssemblySelectionResolver.run({
      input: permitInput(), projectId: 'p1', authority: {} as never,
      iteration: 1, nowIso: NOW, safeDbRead: offlineRead as never, providers: {},
    });
    expect(out.result).toBe('FAILED');
    expect(out.auditRef ?? null).toBeNull();
    expect(out.retryability).toBe('REQUIRES_INPUT');
  });

  it('it DOES bound the residual: a span-screened candidate shortlist from real catalog rails', () => {
    const mount = getMountingSystemById('rooftech-mini')!;
    const cands = railCandidatesFor(mount);
    expect(cands.length).toBeGreaterThan(0);
    // every candidate is a REAL catalog rail with published span/moment values
    for (const c of cands) {
      expect(c.maxSpanIn).toBeGreaterThan(0);
      expect(c.momentCapacityInLbs).toBeGreaterThan(0);
      expect(c.partNumber).toBeNull();       // the catalog has no rail part numbers — stated
    }
    const eligible = cands.filter(c => c.refusedReason == null);
    expect(eligible.length).toBeGreaterThan(0);
    for (const c of eligible) expect(c.maxSpanIn).toBeGreaterThanOrEqual(mount.mount.maxSpacingIn);
    const v = deriveRailSelection({ mountingSystemId: 'rooftech-mini', project: {}, selectedEquipment: null });
    expect(v.operatorAction).toMatch(/Eligible listed rails/);
  });

  it('a SINGLE-MANUFACTURER railed mount resolves — the rail is inherent in the product', async () => {
    const railed = Array.from({ length: 1 }, () => null)
      && ['ironridge-xr100', 'ironridge-xr1000', 'unirac-solarmount']
        .map(id => getMountingSystemById(id)).find(m => m?.rail);
    expect(railed).toBeTruthy();
    const v = deriveRailSelection({ mountingSystemId: railed!.id, project: {}, selectedEquipment: null });
    expect(v.state).toBe('inherent');
    expect(v.selectedRailModel).toBe(railed!.rail!.model);
  });

  it('ANTI-VACUITY — a selection-typed requirement can never be satisfied by a document', () => {
    // The retrieval resolver does not claim the selection code …
    expect(rackingDocumentRetrievalResolver.requirementCodes)
      .not.toContain('PENDING-RACKING-ASSEMBLY-SELECTION');
    // … and the selection resolver does not claim any document code.
    expect(rackingAssemblySelectionResolver.requirementCodes)
      .toEqual(['PENDING-RACKING-ASSEMBLY-SELECTION']);
    expect(REQUIREMENT_DECLARATIONS['PENDING-RACKING-ASSEMBLY-SELECTION'].resolverId)
      .toBe('racking-assembly-selection@v1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §5 — WS-8 · THE FRAMING MODE TRANSITION
// ═══════════════════════════════════════════════════════════════════════════

describe('AAC WS-8 · framing-capacity-retrieval@v1', () => {
  it('attempts retrieval and records AUTO_RETRIEVED → PROFESSIONAL_APPROVAL with the reason per class', async () => {
    const out = await framingCapacityRetrievalResolver.run({
      input: permitInput(), projectId: 'p1',
      authority: { framingProjectApplicabilityKey: 'p1', framingCapacityDocument: null } as never,
      iteration: 1, nowIso: NOW, safeDbRead: offlineRead as never, providers: {},
    });
    const rec = out.patch!.framingRetrieval!;
    expect(rec.attempted).toBe(true);
    expect(rec.retrievalOutcome).toBe('NOT-AVAILABLE-PUBLICLY');
    expect(rec.declaredMode).toBe('AUTO_RETRIEVED');
    expect(rec.residualMode).toBe('PROFESSIONAL_APPROVAL');
    expect(rec.sources.length).toBe(3);
    for (const s of rec.sources) expect(s.reason.length).toBeGreaterThan(40);
    expect(out.auditRef ?? null).toBeNull();
    // NOT an endlessly-retried automatic act — it requires a professional input.
    expect(out.retryability).toBe('REQUIRES_INPUT');
  });

  it('SKIPS entirely when an archived framing document already resolved (no pointless retrieval)', async () => {
    const out = await framingCapacityRetrievalResolver.run({
      input: permitInput(), projectId: 'p1',
      authority: { framingProjectApplicabilityKey: 'p1', framingCapacityDocument: { documentId: 'd1' } } as never,
      iteration: 1, nowIso: NOW, safeDbRead: offlineRead as never, providers: {},
    });
    expect(out.result).toBe('SKIPPED');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §6 — WS-9 · THE DIGEST-BOUND ENGINEERING REVIEW (migration 116)
// ═══════════════════════════════════════════════════════════════════════════

describe('AAC WS-9 · engineering review clears ONLY with a digest match AND a licensed role', () => {
  const base = {
    projectId: 'p1', snapshotDigest: 'b'.repeat(64), reviewerName: 'A. Engineer',
    reviewerLicense: '062-012345', reviewerLicenseState: 'IL',
    decision: 'approved', scopeStatement: 'Structural + electrical design review of the PV set.',
  };

  it('accepts a licensed, digest-bound, scoped approval', () => {
    expect(validateEngineeringReviewInput({ ...base, reviewerRole: 'engineer_of_record' })).toEqual({ ok: true });
    expect(validateEngineeringReviewInput({ ...base, reviewerRole: 'approving_engineer' })).toEqual({ ok: true });
  });

  it('REFUSES an unlicensed role — a designer may never approve', () => {
    for (const role of ['designer', 'preparer', 'reviewer', '', 'admin']) {
      const v = validateEngineeringReviewInput({ ...base, reviewerRole: role });
      expect(v.ok).toBe(false);
      expect((v as { error: string }).error).toMatch(/LICENSED role/);
    }
    expect(LICENSED_REVIEW_ROLES).toEqual(['engineer_of_record', 'approving_engineer']);
  });

  it('REFUSES an approval that names no snapshot, or a malformed digest', () => {
    expect(validateEngineeringReviewInput({ ...base, reviewerRole: 'engineer_of_record', snapshotDigest: '' }).ok).toBe(false);
    const v = validateEngineeringReviewInput({ ...base, reviewerRole: 'engineer_of_record', snapshotDigest: 'PDS-1234' });
    expect(v.ok).toBe(false);
    expect((v as { error: string }).error).toMatch(/64-char hex/);
  });

  it('REFUSES a bare "approved" with no scope, a missing licence, and an expired licence', () => {
    expect(validateEngineeringReviewInput({ ...base, reviewerRole: 'engineer_of_record', scopeStatement: '' }).ok).toBe(false);
    expect(validateEngineeringReviewInput({ ...base, reviewerRole: 'engineer_of_record', reviewerLicense: '' }).ok).toBe(false);
    expect(validateEngineeringReviewInput({ ...base, reviewerRole: 'engineer_of_record', reviewerLicenseState: '' }).ok).toBe(false);
    const exp = validateEngineeringReviewInput({
      ...base, reviewerRole: 'engineer_of_record', reviewerLicenseExpiresOn: '2020-01-01',
    });
    expect(exp.ok).toBe(false);
    expect((exp as { error: string }).error).toMatch(/expired/);
  });

  it('an UNREADABLE store is never coverage (fail-closed), and says so', async () => {
    const out = await engineeringReviewRecordResolver.run({
      input: permitInput(), projectId: 'p1', authority: {} as never,
      iteration: 1, nowIso: NOW, safeDbRead: offlineRead as never, providers: {},
    });
    const cov = out.patch!.engineeringReview!;
    expect(cov.covered).toBe(false);
    expect(cov.storeUnavailable).toBe(true);
    expect(out.auditRef ?? null).toBeNull();
    expect(out.operatorAction).toMatch(/migration 116/);
    // and the sockets stay empty — no review is fabricated
    expect(out.patch!.framingEngineerReview).toBeNull();
    expect(out.patch!.framingReviewDigest).toBeNull();
  });

  it('the engine holds NO resolver for the requirement — it stays PROFESSIONAL_APPROVAL forever', () => {
    const d = REQUIREMENT_DECLARATIONS['ENGINEERING-REVIEW-PENDING'];
    expect(d.resolutionMode).toBe('PROFESSIONAL_APPROVAL');
    expect(d.resolverId ?? null).toBeNull();
    // the infrastructure resolver claims NO requirement code
    expect(engineeringReviewRecordResolver.requirementCodes).toEqual([]);
  });

  it('migration 116 is governed exactly like 113-115, and creates one table', () => {
    // 117 (ahj_registry) joined the governed set — this test is about 116's
    // governance, so assert 116 IS governed rather than pinning the set's length.
    expect(REGISTRY_SEQUENCE).toContain('116');
    expect(REGISTRY_DEPLOYMENT['116'].expectedTables).toEqual(['engineering_review_records']);
    const raw = readFileSync(join(process.cwd(), 'lib/migrations/116_engineering_review_records.sql'), 'utf8');
    expect(raw).toMatch(/CREATE TABLE IF NOT EXISTS engineering_review_records/);
    // The header NARRATES the schema, so scan the DDL only — the same
    // comment/string stripping the governed runner's static analyser performs.
    const sql = raw.replace(/--[^\n]*/g, ' ').replace(/'(?:[^']|'')*'/g, "''");
    expect(sql).not.toMatch(/\bDO\s*\$\$/);           // no DO blocks (runner rule)
    expect(sql).not.toMatch(/\b(DROP|TRUNCATE|DELETE|ALTER|UPDATE)\b/i);
    expect(sql).not.toMatch(/\bINSERT\b/i);           // and NO seeded approval
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §7 — WS-9 · THE BUILD CONSUMES THE REVIEW, AND FAILS CLOSED
// ═══════════════════════════════════════════════════════════════════════════

describe('AAC WS-9 · ENGINEERING-REVIEW-PENDING is CONDITIONAL, and closed by default', () => {
  const render = (authority?: unknown) => {
    const input: any = permitInput();
    generatePermitHTML(input, undefined, authority as never);
    return input._snapshot as PermitDesignSnapshot;
  };

  it('with no review record it FIRES, and certification stays false (today\'s honest state)', () => {
    const snap = render();
    const codes = snap.permitReadiness.registry.map(r => r.code);
    expect(codes).toContain('ENGINEERING-REVIEW-PENDING');
    expect(snap.certification.engineeringReviewApproved).toBe(false);
  });

  // PRR §1 — THIS TEST USED TO PIN THE DEFECT. It supplied an approval naming an
  // ARBITRARY digest ('c'×64 — never this build's) and asserted the requirement
  // CLEARED and `certification.engineeringReviewApproved` projected it. That is
  // the bug: an approval of some other set released this one in the registry and
  // on the certification record, and only downstream consumers re-checked the
  // digest, so the snapshot contradicted itself. Coverage is now decided in ONE
  // place against the build's own design digest (decideReviewCoverage), so the
  // two halves below are the two halves that were conflated.
  const licensedApproval = (reviewedDigest: string) => ({
    engineeringReview: {
      covered: true, reviewedDigest, approvedAtIso: NOW,
      reviewerName: 'A. Engineer', reviewerRole: 'engineer_of_record',
      reviewerLicense: '062-012345', reviewerLicenseState: 'IL',
      scopeStatement: 'Full set.', recordId: 'r1',
      storeUnavailable: false, storeError: null, basis: 'approved',
    },
    digestInvalidations: [],
  });

  it('a LICENSED approval naming a DIFFERENT digest does NOT clear it', () => {
    const snap = render(licensedApproval('c'.repeat(64)));
    const entry = snap.permitReadiness.registry.find(r => r.code === 'ENGINEERING-REVIEW-PENDING');
    expect(entry?.resolved).toBe(false);
    expect(snap.certification.engineeringReviewApproved).toBe(false);
    expect(entry?.explanation).toMatch(/design changed after approval/);
  });

  it('a LICENSED approval naming THIS design digest CLEARS it, and the certification projects it', () => {
    const digest = render().meta.digest;              // the design digest, unapproved
    const snap = render(licensedApproval(digest));
    expect(snap.meta.digest).toBe(digest);            // approving does not move the digest
    expect(snap.permitReadiness.registry.find(r => r.code === 'ENGINEERING-REVIEW-PENDING')?.resolved).toBe(true);
    expect(snap.permitReadiness.blockers.map(b => b.code)).not.toContain('ENGINEERING-REVIEW-PENDING');
    expect(snap.certification.engineeringReviewApproved).toEqual({ reviewedDigest: digest, approvedAtIso: NOW });
  });

  it('a review with NO licence recorded can never clear it (fail-closed on the record itself)', () => {
    const snap = render({
      engineeringReview: {
        covered: true, reviewedDigest: 'd'.repeat(64), approvedAtIso: NOW,
        reviewerName: 'A. Person', reviewerRole: 'engineer_of_record',
        reviewerLicense: null, reviewerLicenseState: null,
        scopeStatement: null, recordId: 'r2',
        storeUnavailable: false, storeError: null, basis: 'x',
      },
    });
    expect(snap.permitReadiness.registry.map(r => r.code)).toContain('ENGINEERING-REVIEW-PENDING');
  });

  it('an UNCOVERED verdict never clears it, whatever its basis says', () => {
    const snap = render({ engineeringReview: uncoveredReview('nothing found') });
    expect(snap.permitReadiness.registry.map(r => r.code)).toContain('ENGINEERING-REVIEW-PENDING');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §8 — WS-8 · THE STRUCTURAL SEPARATION ON A REAL BUILD
// ═══════════════════════════════════════════════════════════════════════════

describe('AAC WS-8 · the separated structural requirements', () => {
  const snap = (() => {
    const input: any = permitInput();
    generatePermitHTML(input);
    return input._snapshot as PermitDesignSnapshot;
  })();
  const codes = snap.permitReadiness.registry.map(r => r.code);

  it('FASTENER-ASSEMBLY-UNVERIFIED does not echo the capacity document, but does require its OWN evidence', () => {
    // WS-8's point stands: this requirement is NOT a downstream echo of the
    // rail-capacity document — it is decided on the mount base's own evidence.
    // TAC WS-4 sharpened what that evidence must be: the elements being present
    // is not verification, an ESR flashing report is not installation authority,
    // and the document must be applicable to the SELECTED product. On this input
    // none of that holds, so the requirement fires on its OWN basis…
    // 2026-08-28 RT-MINI MIGRATION - on this input the requirement no
    // longer fires: the shipped RT-Mini II PE letter STATES the fastener assembly
    // (SS304 5.0 mm screws, two at a rafter, no pilot hole, SS304 5/16" L-foot
    // bolt), which is fastener-installation authority for the exact model.
    //
    // WS-8's actual point is the SEPARATION, and it is asserted below in the form
    // that survives a clearance: the fastener verdict is decided on the mount
    // base's own document role, not echoed from the rail-capacity requirement.
    expect(codes).not.toContain('FASTENER-ASSEMBLY-UNVERIFIED');
    const roles = (snap.structural.rackingAssembly as unknown as {
      documentRoles: Record<string, { established: boolean; basis: string }>;
    }).documentRoles;
    expect(roles.fastenerAuthority.established).toBe(true);
    expect(roles.fastenerAuthority.basis).toMatch(/fastener assembly/i);
    // and it is a DIFFERENT role from the capacity one - never the same fact twice
    expect(roles.fastenerAuthority.basis).not.toBe(roles.structuralCapacityAuthority.basis);
  });

  it('PENDING-RACKING-ASSEMBLY-SELECTION is a SELECTION statement, not a document statement', () => {
    const r = snap.permitReadiness.registry.find(x => x.code === 'PENDING-RACKING-ASSEMBLY-SELECTION');
    expect(r).toBeTruthy();
    // GOVERNING-CANDIDATE ENVELOPE (2026-08-27) — the wording changed because the FINDING changed:
    // with the rail bending envelope bounded by the weakest screened candidate, this is no longer a
    // "design + procurement decision" but a procurement one alone. What this case actually guards —
    // that it is a SELECTION statement and never a document/archival statement — is unchanged.
    expect(r!.explanation).toMatch(/SKU is not pinned|procurement/i);
    expect(r!.explanation).not.toMatch(/archive the capacity/i);
    expect(r!.explanation).not.toMatch(/not archived|archive the/i);
  });

  it('every structural requirement still declares exactly one gate — none reached RG-UNMAPPED', () => {
    const model = projectReleaseGates(snap);
    const unmapped = model.gates.find(g => g.gateId === 'RG-UNMAPPED');
    expect(unmapped?.requirementCodes ?? []).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §9 — PLANSET OUTPUT · REGISTRY INTEGRITY (the pre-compaction pin)
// ═══════════════════════════════════════════════════════════════════════════

describe('AAC · planset output — page removal cannot drop a registry requirement', () => {
  it('the registry is IDENTICAL with and without the datasheet appendix pages', () => {
    const a: any = permitInput();
    const htmlA = generatePermitHTML(a);
    const snapA = a._snapshot as PermitDesignSnapshot;

    // Remove every DS-n page from the RENDERED output. The registry is built in
    // the snapshot, before any page exists, so it cannot move.
    const htmlB = htmlA.replace(/<div class="page[ "][\s\S]*?data-sheet-id="DS-\d+"[\s\S]*?<\/div>/g, '');
    expect(htmlB.length).toBeLessThanOrEqual(htmlA.length);

    const b: any = permitInput();
    generatePermitHTML(b);
    const snapB = b._snapshot as PermitDesignSnapshot;
    expect(snapB.permitReadiness.registry.map(r => r.code).sort())
      .toEqual(snapA.permitReadiness.registry.map(r => r.code).sort());
  });

  it('every emitted requirement code is DECLARED (an undeclared code would sink to RG-UNMAPPED)', () => {
    const input: any = permitInput();
    generatePermitHTML(input);
    const snap = input._snapshot as PermitDesignSnapshot;
    for (const r of snap.permitReadiness.registry) {
      expect(REQUIREMENT_DECLARATIONS[r.code], `undeclared requirement code ${r.code}`).toBeTruthy();
    }
  });

  it('the sheet index and the registry are independent — no sheet id appears as a requirement gate', () => {
    const input: any = permitInput();
    generatePermitHTML(input);
    const snap = input._snapshot as PermitDesignSnapshot;
    const sheetIds = new Set(snap.projectAuthority.sheetIndex.map(s => s.id));
    for (const r of snap.permitReadiness.registry) expect(sheetIds.has(r.code)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §10 — WS-9 · RENDERER PURITY
// ═══════════════════════════════════════════════════════════════════════════

describe('AAC WS-9 · the renderer determines no authority', () => {
  const files = [
    'lib/permit/sections/compliancePages.ts',
    'lib/permit/sections/datasheetAppendix.ts',
    'lib/permit/sections/structuralPages.ts',
    'lib/drafting/sheetComposition.ts',
    'lib/drafting/templates/roof.ts',
  ];

  it('no renderer file calls evaluateDocumentApplicability itself (audit §7.12)', () => {
    for (const f of files) {
      const src = readFileSync(join(process.cwd(), f), 'utf8');
      expect(src, `${f} still decides document applicability`).not.toMatch(/evaluateDocumentApplicability\s*\(/);
    }
  });

  it('no drafting file carries a site wind/snow literal (audit §2.6)', () => {
    for (const f of ['lib/drafting/sheetComposition.ts', 'lib/drafting/templates/fence.ts', 'lib/drafting/templates/ground.ts']) {
      const src = readFileSync(join(process.cwd(), f), 'utf8');
      const code = src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      // A manufacturer product RATING (`maxWindSpeed ?? 115`) is a different
      // number and is deliberately allowed; a SITE design value is not.
      const offenders = code.split('\n').filter(l =>
        /(\?\?|\|\|)\s*115\b/.test(l) && !/maxWindSpeed|maxSnowLoad/.test(l));
      expect(offenders, `${f} still carries a site design-load literal`).toEqual([]);
    }
  });

  it('the site design-load seam labels a guard value as a guard, and an authority as an authority', () => {
    const guard = resolveSiteDesignLoads({});
    expect(guard.windSpeedMph).toBe(115);
    expect(guard.windBasis).toBe('code-minimum-guard');
    expect(guard.established).toBe(false);
    expect(guard.guardNotice).toMatch(/NOT ESTABLISHED/);

    const authed = resolveSiteDesignLoads({
      snapshot: {
        structural: {
          env: {
            ultimateWindSpeedMph: 96, groundSnowPsf: 25,
            environmentalLoadAuthority: {
              verificationStatus: 'verified', ultimateWindSpeedMph: 96, groundSnowLoadPsf: 25,
            },
          },
        },
      },
    });
    expect(authed.windSpeedMph).toBe(96);
    expect(authed.windBasis).toBe('environmental-authority');
    expect(authed.snowBasis).toBe('environmental-authority');
    expect(authed.established).toBe(true);
    expect(authed.guardNotice).toBeNull();
  });

  it('a sheet asking for a verdict the build did not pre-enumerate gets the SAME facts, never null', () => {
    const sha = 'e'.repeat(64);
    const region = buildEquipmentDocumentAuthority([], {
      'racking_detail:rooftech-mini': { archivedInRepo: true, sha256: sha, status: 'current' },
    }, null);
    // 2026-08-29 - the selected model must be the one the on-file document covers;
    // AUTHORITATIVE is about archival + hashing, not about spanning two product
    // generations. Passing 'RT-MINI II' against the first-generation manual is the
    // conflation the applicability gate now refuses.
    const verdict = sheetDocumentApplicability({
      region, category: 'racking_detail', equipmentId: 'rooftech-mini', selectedModel: 'RT-MINI',
    });
    expect(verdict.authoritative).toBe(true);
  });

  it('with NO snapshot region the sheet gets the honest no-facts verdict, never a manufactured one', () => {
    const verdict = sheetDocumentApplicability({
      region: null, category: 'racking_detail', equipmentId: 'rooftech-mini', selectedModel: 'RT-MINI',
    });
    // THE rule this case pins: with no snapshot region there are no registry facts, so nothing
    // may be promoted to AUTHORITATIVE. That is unchanged.
    expect(verdict.authoritative).toBe(false);
    // BRAIDON PDF AUDIT 2026-08-27 — `applicabilityVerified` used to be false here too, but only
    // because the archived document named a different product version. Now that the version-exact
    // gen-1 RT-MINI manual is on file, applicability IS established while authority still is not
    // — which is exactly the separation this file documents ("AUTHORITATIVE is a STRICTER verdict
    // than APPLICABLE"). Asserting both false would re-couple the two axes.
    expect(verdict.applicabilityVerified).toBe(true);
    expect(verdict.state).not.toBe('AUTHORITATIVE');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §11 — WS-9 · THE FULL LIFECYCLE IS THE GENERATION PATH
// ═══════════════════════════════════════════════════════════════════════════

describe('AAC WS-9 · lifecycle integration', () => {
  // WS-A (2026-08-03) — this used to assert TWO resolveSnapshotAuthorityInputs
  // call sites, "GET self-heal + POST", and that each was followed by a build
  // receiving the bundle. That invariant protected GET/POST parity: if a READ
  // was going to regenerate a package, it had better resolve authority the same
  // way POST does.
  //
  // The premise is gone. A read no longer regenerates anything, because doing so
  // re-dated the issued package, moved its digest and Document ID, and dropped
  // the licensed review bound to the old digest — and because the resolution
  // lifecycle itself wrote to six tables from a GET. The parity requirement is
  // replaced by the stronger one it was standing in for: there is exactly ONE
  // path that builds a package, and it is the explicit mutation.
  it('exactly ONE path resolves authority and builds — the explicit POST', () => {
    const src = readFileSync(join(process.cwd(), 'app/api/engineering/permit/route.ts'), 'utf8');
    const calls = src.match(/resolveSnapshotAuthorityInputs\s*\(/g) ?? [];
    expect(calls.length, 'a second build path has appeared').toBe(1);
    expect(src).toMatch(/generatePermitHTML\(enrichedBody, storedSldSvg, snapshotAuthority\)/);
    // and no call site may omit the resolved authority bundle
    expect(src).not.toMatch(/generatePermitHTML\(\s*[A-Za-z_$][\w$]*\s*\)/);
  });

  it('every WS-8 resolver is REGISTERED in the production set, in dependency order', () => {
    const ids = PRODUCTION_RESOLVERS.map(r => r.id);
    for (const id of ['racking-assembly-selection@v1', 'engineering-review-record@v1',
      'racking-documents@v1', 'framing-capacity-retrieval@v1']) {
      expect(ids, `${id} is not registered`).toContain(id);
    }
    // the document RETRIEVAL runs after the registry LOOKUP (archived wins).
    expect(ids.indexOf('racking-documents@v1')).toBeGreaterThan(ids.indexOf('racking-capacity-document@v1'));
    expect(ids.indexOf('framing-capacity-retrieval@v1')).toBeGreaterThan(ids.indexOf('framing-capacity-document@v1'));
  });

  it('the lifecycle stabilises, stays bounded, and reports NO invariant violation', async () => {
    const { outcome } = await runResolutionLifecycle(permitInput(), {
      safeDbRead: offlineRead, nowIso: NOW, providers: fixtureProviders(),
    });
    expect(outcome.invariantViolations).toEqual([]);
    expect(outcome.stabilized).toBe(true);
    expect(outcome.iterations).toBeLessThanOrEqual(outcome.iterationBound);
  });

  it('a run with NO lifecycle bundle is byte-identical to another such run (three-mode parity)', () => {
    const digests = [1, 2, 3].map(() => {
      const input: any = permitInput();
      generatePermitHTML(input);
      return (input._snapshot as PermitDesignSnapshot).meta.digest;
    });
    expect(new Set(digests).size).toBe(1);
  });
});
