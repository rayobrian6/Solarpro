// ═══════════════════════════════════════════════════════════════════════════
// D4 LIFECYCLE — THE VERIFIED LEGAL JURISDICTION MUST SURVIVE THE HANDOFF.
//
// The previous D4 phase built a canonical LegalJurisdictionAuthority and had
// BOTH jurisdiction resolvers compute it. The verified one never arrived.
//
// THE DISCARDED PATCH. `lib/permit/snapshot/resolution/lifecycle.ts` copies ONLY
// the patch keys a resolver DECLARES:
//
//     for (const k of r.produces) {
//       if (!(k in outcome.patch)) continue;
//       bag[k] = outcome.patch[k];
//     }
//
// `project-authority@v1` returned `legalJurisdiction` in its patch but declared
// `produces: ['projectLegalAuthority']`. The lifecycle therefore threw the
// verified boundary determination away, silently, and the bundle kept the
// DERIVED, unverified value from `project-authority-key@v1`. The live symptom was
// the right AHJ with the wrong provenance and `verificationState: 'unverified'` —
// which, because the archival gate requires 'verified', meant no document could
// ever be archived under the correct authority.
//
// These tests exercise the REAL lifecycle. They do not hand-build a bundle,
// because a hand-built bundle is exactly what would have hidden this.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { runResolutionLifecycle } from '@/lib/permit/snapshot/resolution/lifecycle';
import { PRODUCTION_RESOLVERS } from '@/lib/permit/snapshot/resolution/resolvers';
import { createFixturePropertyProvider } from '@/lib/providers/property/fixtures';
import { createFixtureDocumentRetrievalProvider, ROOF_TECH_DOCUMENT_FIXTURES } from '@/lib/providers/documentRetrieval/fixtures';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import type { PermitInput } from '@/lib/permit/types';
import type { SafeDbRead } from '@/lib/permit/snapshot/resolution/types';

const NOW = '2026-08-05T00:00:00.000Z';
const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

/** the LIVE condition for the document tables: every registry read fails 42P01. */
const OFFLINE: SafeDbRead = async <T,>(label: string, _run: () => Promise<T>, failSoftTo: T) =>
  ({ value: failSoftTo, ok: false, error: `${label}: 42P01 relation does not exist` });

/**
 * The situation that produced the defect: the POSTED record says Granite City,
 * while the parcel is unincorporated and the county is the legal AHJ.
 */
function graniteCityPostedInput(): PermitInput {
  const i: any = clone(braidonOriginalAuditFixture);
  i.generatedAtIso = '2026-07-22T12:00:00Z';
  i.project.city = 'GRANITE CITY';
  // the posted record's own answer — the MAILING-derived authority
  i.project.ahjName = 'City of Granite City Building & Zoning';
  i.project.ahjRecordId = 'il-madison-granite-city';
  i.project.ahjId = 'il-icc';                 // the stale engineering_config value
  i.compliance = { ...(i.compliance ?? {}), jurisdiction: { ahj: 'City of Granite City Building & Zoning' } };
  return i as PermitInput;
}

const providersWithBoundary = () => ({
  propertyIdentity: createFixturePropertyProvider({ nowIso: NOW }),
  documentRetrieval: createFixtureDocumentRetrievalProvider(ROOF_TECH_DOCUMENT_FIXTURES, { nowIso: NOW }),
});
const providersWithoutBoundary = () => ({
  // NO propertyIdentity ⇒ no boundary determination is possible
  documentRetrieval: createFixtureDocumentRetrievalProvider(ROOF_TECH_DOCUMENT_FIXTURES, { nowIso: NOW }),
});

// ═══════════════════════════════════════════════════════════════════════════
// 1 — POSITIVE: the verified value reaches the bundle
// ═══════════════════════════════════════════════════════════════════════════

describe('D4 lifecycle · the VERIFIED legal jurisdiction survives the handoff', () => {
  it('the bundle carries the boundary-verified Madison County authority', async () => {
    const { authority } = await runResolutionLifecycle(graniteCityPostedInput(), {
      providers: providersWithBoundary(), safeDbRead: OFFLINE, nowIso: NOW,
    });
    const lj = authority.legalJurisdiction;
    expect(lj, 'legalJurisdiction must reach the bundle').toBeTruthy();
    expect(lj!.ahjRecordId).toBe('il-madison-county');
    expect(lj!.ahjName).toBe('Madison County Building & Zoning');
    expect(lj!.jurisdictionType).toBe('county');
    expect(lj!.unincorporated).toBe(true);
    expect(lj!.mailingCity).toBe('GRANITE CITY');
    expect(lj!.verificationState).toBe('verified');
  });

  it('THE REGRESSION: the value came from project-authority@v1, not the derived resolver', async () => {
    // This is the assertion that would have failed before the `produces` fix.
    // The derived resolver also produces a Madison County record — with the SAME
    // ids — so asserting the ids alone proves nothing. Provenance is what
    // distinguishes a boundary determination from a table lookup.
    const { authority } = await runResolutionLifecycle(graniteCityPostedInput(), {
      providers: providersWithBoundary(), safeDbRead: OFFLINE, nowIso: NOW,
    });
    const lj = authority.legalJurisdiction!;
    expect(lj.provenance?.source).toBe('project-authority@v1');
    expect(lj.provenance?.source).not.toBe('project-authority-key@v1');
    expect(lj.provenance?.basis).toBeTruthy();
    // the derived record explicitly disclaims being a boundary determination
    expect(lj.provenance?.basis).not.toMatch(/NOT a municipal-boundary determination/);
  });

  it('the posted mailing-derived jurisdiction is retained but is NOT the legal authority', async () => {
    const { authority } = await runResolutionLifecycle(graniteCityPostedInput(), {
      providers: providersWithBoundary(), safeDbRead: OFFLINE, nowIso: NOW,
    });
    // kept for the consumers that legitimately want the project record's answer…
    expect(authority.projectJurisdiction).toBe('City of Granite City Building & Zoning');
    // …and it is emphatically not the legal AHJ.
    expect(authority.legalJurisdiction!.ahjName).not.toBe(authority.projectJurisdiction);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 — DOCUMENT RESOLVER: canonical identity reaches the archival input
// ═══════════════════════════════════════════════════════════════════════════

describe('D4 lifecycle · the document resolver receives the canonical identity', () => {
  it('archival input carries il-madison-county / Madison County, never the mailing city', async () => {
    const { authority } = await runResolutionLifecycle(graniteCityPostedInput(), {
      providers: providersWithBoundary(), safeDbRead: OFFLINE, nowIso: NOW,
    });
    const lj = authority.legalJurisdiction!;
    // What structuralResolvers stamps onto a new document row:
    //   jurisdictionBoundary    := legal.ahjName
    //   jurisdictionAuthorityId := legal.ahjRecordId
    expect(lj.ahjRecordId).toBe('il-madison-county');
    expect(lj.ahjName).toBe('Madison County Building & Zoning');

    // the values that must NEVER reach an archival write
    expect(lj.ahjRecordId).not.toBe('il-icc');
    expect(lj.ahjRecordId).not.toBe('il-madison-granite-city');
    expect(lj.ahjName).not.toMatch(/Granite City/);
    expect(lj.verificationState).toBe('verified');   // an unverified id may not stamp
  });

  it('the racking document resolver DECLARES its dependency on legalJurisdiction', async () => {
    // Not source-ordering luck: the dependency graph must know, so a change to the
    // legal jurisdiction re-dirties the document resolver.
    const r = PRODUCTION_RESOLVERS.find(x => x.id === 'racking-documents@v1')!;
    expect(r.requiredInputs).toContain('legalJurisdiction');
    // and the posted value is no longer an archival dependency
    expect(r.requiredInputs).not.toContain('projectJurisdiction');
  });

  it('project-authority@v1 DECLARES legalJurisdiction so the lifecycle keeps it', async () => {
    const r = PRODUCTION_RESOLVERS.find(x => x.id === 'project-authority@v1')!;
    expect(r.produces).toContain('legalJurisdiction');
    expect(r.produces).toContain('projectLegalAuthority');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 — NEGATIVE: retrieval survives, archival does not
// ═══════════════════════════════════════════════════════════════════════════

describe('D4 lifecycle · without a boundary determination, retrieval runs and archival does not', () => {
  it('retrieval still happens and its evidence is preserved', async () => {
    const { authority } = await runResolutionLifecycle(graniteCityPostedInput(), {
      providers: providersWithoutBoundary(), safeDbRead: OFFLINE, nowIso: NOW,
    });
    const rec = authority.structuralDocumentRetrieval;
    expect(rec, 'the retrieval record must exist').toBeTruthy();
    expect(rec!.attempts.length).toBeGreaterThan(0);
    // the WS-8 evidence contract is intact: address + verdict on every attempt
    for (const a of rec!.attempts) {
      expect(a.url).toMatch(/^https:\/\//);
      expect(['RETRIEVED', 'FAILED', 'SKIPPED']).toContain(a.outcome);
      if (a.outcome === 'RETRIEVED') expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
      else expect(a.failure).toBeTruthy();
    }
    // …including at least one genuine retrieval with its hash
    expect(rec!.attempts.some(a => a.outcome === 'RETRIEVED' && !!a.sha256)).toBe(true);
  });

  it('NO archival is attempted, and the refusal names the missing authority', async () => {
    const { authority } = await runResolutionLifecycle(graniteCityPostedInput(), {
      providers: providersWithoutBoundary(), safeDbRead: OFFLINE, nowIso: NOW,
    });
    const rec = authority.structuralDocumentRetrieval!;
    const retrieved = rec.attempts.filter(a => a.outcome === 'RETRIEVED');
    expect(retrieved.length).toBeGreaterThan(0);
    for (const a of retrieved) {
      expect(a.archival.attempted, 'no archival may be attempted').toBe(false);
      expect(a.archival.documentId).toBeNull();
      expect(String(a.archival.failure ?? '')).toMatch(/ARCHIVAL REFUSED/);
      expect(String(a.archival.operatorAction ?? '')).toMatch(/legal AHJ/i);
    }
  });

  it('the bundle is NOT falsely upgraded — it stays unverified', async () => {
    const { authority } = await runResolutionLifecycle(graniteCityPostedInput(), {
      providers: providersWithoutBoundary(), safeDbRead: OFFLINE, nowIso: NOW,
    });
    const lj = authority.legalJurisdiction;
    // the derived resolver still answers, and still disclaims verification
    expect(lj).toBeTruthy();
    expect(lj!.verificationState).not.toBe('verified');
    expect(lj!.provenance?.source).toBe('project-authority-key@v1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 — THE CONTRACT ITSELF: an undeclared patch key is a defect, not a silence
// ═══════════════════════════════════════════════════════════════════════════

describe('D4 · undeclared patch keys are detected', () => {
  it('EVERY production resolver declares every bundle key it patches', async () => {
    // This is the invariant whose absence let D4 ship. A resolver that computes
    // an authority and forgets to declare it loses that authority silently — the
    // lifecycle drops the key and nothing anywhere reports it.
    const violations: string[] = [];
    for (const r of PRODUCTION_RESOLVERS) {
      const declared = new Set<string>(r.produces as unknown as string[]);
      // Run each resolver against a permissive context and inspect its patch.
      let outcome: any;
      try {
        outcome = await r.run({
          input: graniteCityPostedInput() as any, projectId: 'p-contract',
          authority: {} as never, iteration: 1, nowIso: NOW,
          safeDbRead: OFFLINE as never, providers: providersWithBoundary() as never,
        });
      } catch {
        continue;   // a resolver that throws on a bare context patches nothing
      }
      for (const k of Object.keys(outcome?.patch ?? {})) {
        if (!declared.has(k)) violations.push(`${r.id}: patches undeclared key '${k}'`);
      }
    }
    expect(violations, violations.join(' · ')).toEqual([]);
  });
});
