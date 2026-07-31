// ═══════════════════════════════════════════════════════════════════════════
// AAC WS-3 (AHJ / adopted codes) + WS-4 (environmental load authority)
//
// ── PROOF LABELLING (the directive requires the distinction, explicitly) ────
//   FIXTURE PROOF — every case in this file. Providers are injected through the
//     WS-3/WS-4 DI seam (`ResolutionDeps.providers`), so no network is touched
//     and the outcomes are deterministic.
//   LIVE PROOF   — recorded separately in `docs/evidence/aac3-live-retrieval-
//     braidon.json` (a real US Census Geocoder + ASCE 7-22 + USGS retrieval for
//     3 MELVIN DR, GRANITE CITY, IL 62040, run 2026-07-27). The property and
//     climate-hazard FIXTURES in lib/providers/*/fixtures.ts are replays of that
//     capture and say so; the code-adoption fixture is a RESPONSE-SHAPE fixture
//     and says so, because AHJ_REGISTRY_TOKEN is not provisioned here.
//
// ── THE AHJ / CODE SET (the directive's 7) ─────────────────────────────────
//   A1  a sourced retrieval establishes AHJ + permit office + adopted NEC/IBC/
//       IRC/IFC + amendments + effective date + source URL + timestamp +
//       boundary evidence + confidence + applicability, persists into the
//       EXISTING codeAuthority / projectAuthority records, and CLEARS with an
//       audit ref. A retrieval-verified record is distinguishable from an
//       operator-typed one.
//   A2  ANTI-VACUITY: a sourceless default cannot clear. No provider, and the
//       curated ahj-national table standing alone, both leave
//       CODE-AUTHORITY-INCOMPLETE open with verifiedBy / sourceHash null.
//   A3  ANTI-VACUITY: utility territory is never AHJ proof.
//   A4  OPERATOR_CONFIRMATION — boundary conflict + incorporated/unincorporated
//       ambiguity, with BOTH candidates and the evidence on the payload.
//   A5  OPERATOR_CONFIRMATION — disagreeing sources (registry vs curated table):
//       both values shown, neither promoted, the edition left null.
//   A6  OPERATOR_CONFIRMATION — overlapping jurisdiction: both authorities named.
//   A7  FAILURE RECORDING — exact provider + endpoint + failure + retryability;
//       a missing token is REQUIRES_INPUT naming the exact env var; a partial
//       retrieval names the missing edition and never infers it.
//
// ── THE ENVIRONMENTAL SET (the directive's 6) ──────────────────────────────
//   V1  the retrieval populates the whole record (provider, tool, edition, query
//       inputs, returned values, retrievedAt, sourceHash, applicability,
//       confidence, overrideHistory), clears with an audit ref, and the
//       CALCULATED — not merely displayed — values derive from it.
//   V2  ANTI-VACUITY: empty evidence cannot clear (no provider / failed
//       retrieval / no exposure category), each with its exact reason.
//   V3  a COORDINATE CHANGE invalidates: an archived source for another point is
//       refused by the gate, re-retrieved, and the invalidation is declared.
//   V4  operator OVERRIDE machinery: value + reason + source + actor + timestamp
//       governs, and the original retrieval is preserved beside it.
//   V5  operator-entered 110 mph / 20 psf vs the retrieval: a MATERIAL
//       disagreement is OPERATOR_CONFIRMATION with both shown and the more
//       conservative value holding — never a silent replacement; a SOURCELESS
//       table value is superseded outright.
//   V6  the retrieval is archived as a climate_hazard_dataset registry row; with
//       migration 113 absent the failure is exact + retryable and no clear is
//       fabricated.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import { runResolutionLifecycle } from '@/lib/permit/snapshot/resolution/lifecycle';
import { createResolverRegistry } from '@/lib/permit/snapshot/resolution/registry';
import {
  PRODUCTION_RESOLVERS, projectAuthorityKeyResolver,
  projectAuthorityResolver, codeAuthorityResolver, environmentalAuthorityResolver,
} from '@/lib/permit/snapshot/resolution/resolvers';
import {
  buildProjectLegalAuthority, buildCodeAdoptionAuthority, missingAdoptionEditions,
  countyAgrees, retrievalSourceHash, ADOPTION_EDITION_KINDS,
} from '@/lib/permit/snapshot/resolution/jurisdictionAuthority';
import {
  buildEnvironmentalRetrievalRecord, toEnvironmentalSourceEvidence, resolveRiskCategory,
  postedValueHasAuthority, WIND_MATERIAL_DELTA_MPH, SNOW_MATERIAL_DELTA_PSF,
} from '@/lib/permit/snapshot/resolution/environmentalRetrieval';
import {
  environmentalSourceVerified, environmentalCoordinatesCover,
  ENVIRONMENTAL_COORDINATE_TOLERANCE_DEG, buildEnvironmentalLoadAuthority,
} from '@/lib/permit/snapshot/environmentalAuthority';
import { buildCodeAuthority } from '@/lib/permit/snapshot/codeAuthority';
import { createFixturePropertyProvider, BRAIDON_PROPERTY_FIXTURE } from '@/lib/providers/property/fixtures';
import { createFixtureHazardProvider, BRAIDON_HAZARD_FIXTURE } from '@/lib/providers/climateHazard/fixtures';
import {
  createFixtureCodeProvider, fixtureCodeAdoption, rawOrangeButtonAhj, CODE_FIXTURE_PROVENANCE,
} from '@/lib/providers/jurisdiction/fixtures';
import { AHJ_REGISTRY_ENDPOINT, mapRegistryToCodeAdoption } from '@/lib/jurisdictions/ahjRegistry';
import { deriveRequirementStatus, REQUIREMENT_DECLARATIONS } from '@/lib/permit/snapshot/releaseGates';
import type { RetrievalProviders, SafeDbRead } from '@/lib/permit/snapshot/resolution/types';
import type { AhjRecord } from '@/lib/jurisdictions/ahj-national';
import type { PermitInput } from '@/lib/permit/types';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
const NOW = '2026-07-27T12:00:00.000Z';
const PID = '4030b664-bebe-433b-a11c-cda05ead2f7d';

/** The Braidon site, as the project record carries it. */
const LAT = 38.7061678, LNG = -90.0461651;

/** Everything DB-backed is absent, which is also the live condition today
 *  (migrations 113/114/115 unrun ⇒ 42P01 on every registry read). */
const OFFLINE: SafeDbRead = async <T>(label: string, _run: () => Promise<T>, failSoftTo: T) => ({
  value: failSoftTo, ok: false,
  error: `${label}: 42P01 relation does not exist [table absent — migration 113/114 not run]`,
});

function braidonInput(over?: (i: any) => void): PermitInput {
  const i = clone(braidonOriginalAuditFixture) as any;
  i.projectId = PID;
  i.project.ahjName = 'Madison County Building & Zoning';
  over?.(i);
  return i as PermitInput;
}

/** The full fixture provider bag (all three answer). */
function bag(over?: Partial<RetrievalProviders>): RetrievalProviders {
  return {
    propertyIdentity: createFixturePropertyProvider({ nowIso: NOW }),
    codeAdoption: createFixtureCodeProvider({ nowIso: NOW }),
    climateHazard: createFixtureHazardProvider({ nowIso: NOW }),
    ...(over ?? {}),
  };
}

async function runLifecycle(input: PermitInput, providers: RetrievalProviders, read: SafeDbRead = OFFLINE) {
  return runResolutionLifecycle(input, { providers, safeDbRead: read, nowIso: NOW });
}

/** A curated in-repo AHJ row, for the corroboration / conflict cases. */
function curated(over?: Partial<AhjRecord>): AhjRecord {
  return {
    id: 'il-madison-county', ahjName: 'Madison County Building & Zoning', ahjType: 'county',
    stateCode: 'IL', stateName: 'Illinois', county: 'Madison', necVersion: '2020',
    windSpeedMph: 110, groundSnowLoadPsf: 20, seismicDesignCategory: 'B',
    localAmendments: ['County amendment 2019-04 — PV rapid shutdown labelling'],
    dataProvenance: 'curated',
    ...(over ?? {}),
  } as unknown as AhjRecord;
}

// ═══════════════════════════════════════════════════════════════════════════
// A1 — a sourced retrieval establishes the authority and clears it
// ═══════════════════════════════════════════════════════════════════════════

describe('AAC WS-3 · A1 · a sourced retrieval establishes AHJ + editions and clears with an audit ref', () => {
  it('the project legal identity resolves from the official boundary determination [FIXTURE PROOF]', async () => {
    const { authority, outcome } = await runLifecycle(braidonInput(), bag());
    const legal = authority.projectLegalAuthority!;
    expect(legal).toBeTruthy();
    // normalised identity, boundary evidence, source, timestamp, hash, confidence
    expect(legal.normalized.address).toBe('3 MELVIN DR, GRANITE CITY, IL, 62040');
    expect(legal.normalized.county).toBe('Madison County');
    expect(legal.normalized.countyFips).toBe('119');
    expect(legal.unincorporated).toBe(true);
    expect(legal.boundaryEvidence).toMatch(/UNINCORPORATED/);
    expect(legal.sourcesQueried[0]).toMatch(/geocoding\.geo\.census\.gov/);
    expect(legal.retrievedAtIso).toBeTruthy();
    expect(legal.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(legal.confidence).toBeGreaterThan(0);
    // the fixture is LABELLED as a fixture, never as live proof
    expect(legal.proof).toBe('fixture');
    expect(legal.fixtureProvenance).toMatch(/FIXTURE PROOF, not live proof/);

    const st = outcome.states['PROJECT-AUTHORITY-UNVERIFIED'];
    expect(st.lastResolutionResult).toBe('RESOLVED');
    expect(st.cleared).toBe(true);
    expect(st.resolutionAuditRef).toMatch(/^AAC-RESOLVER:project-authority@v1/);
    expect(deriveRequirementStatus({ resolved: true, resolutionAuditRef: st.resolutionAuditRef } as never)).not.toBe('OPEN');
  });

  it('the APN is never fabricated: with no parcel source it stays UNKNOWN, not derived', async () => {
    const { authority } = await runLifecycle(braidonInput(), bag());
    const apn = authority.projectLegalAuthority!.fields.apn;
    expect(apn.state).toBe('unknown');
    expect(apn.value).toBeNull();
    expect(apn.basis).toMatch(/only ATTOM does|not inferred/);
    expect(authority.projectLegalAuthority!.chainFailures.join(' ')).toMatch(/ATTOM_API_KEY not set/);
  });

  it('the adopted NEC / IBC / IRC / IFC editions, permit office and amendments come off the retrieval', async () => {
    const { authority, outcome } = await runLifecycle(braidonInput(), bag());
    const code = authority.codeAdoptionAuthority!;
    expect(code.editions.map(e => e.kind)).toEqual(ADOPTION_EDITION_KINDS);
    expect(code.editions.find(e => e.kind === 'nec')!.edition).toBe('2020');
    expect(code.editions.find(e => e.kind === 'ibc')!.edition).toBe('2021');
    expect(code.editions.find(e => e.kind === 'irc')!.edition).toBe('2021');
    expect(code.editions.find(e => e.kind === 'ifc')!.edition).toBe('2021');
    expect(missingAdoptionEditions(code)).toEqual([]);
    // building / electrical / fire authority, permit office, effective date, hash
    expect(code.buildingAhj).toBe('Madison County Building & Zoning');
    expect(code.electricalAhj).toBe(code.buildingAhj);
    expect(code.fireAhj).toBe(code.buildingAhj);
    expect(code.permitOffice.url).toMatch(/madisoncountyil\.gov/);
    expect(code.effectiveDate).toBeTruthy();
    expect(code.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(code.sourcesQueried).toContain(AHJ_REGISTRY_ENDPOINT);
    expect(code.proof).toBe('fixture');
    expect(code.fixtureProvenance).toBe(CODE_FIXTURE_PROVENANCE);

    const st = outcome.states['CODE-AUTHORITY-INCOMPLETE'];
    expect(st.cleared).toBe(true);
    expect(st.resolutionAuditRef).toMatch(/^AAC-RESOLVER:code-authority@v1/);
  });

  it('persists into the EXISTING codeAuthority record — verified, with the RETRIEVAL as verifiedBy (never a person)', () => {
    const rec = buildCodeAuthority({
      ahjRecord: curated(), capturedAtIso: NOW, asceEngineBasis: 'ASCE 7-22',
      codeAdoption: buildCodeAdoptionAuthority({
        adoption: fixtureCodeAdoption(), corroborator: curated(), asceEngineBasis: null,
        confidence: 1, resolverId: 'code-authority@v1', proof: 'fixture',
      }),
    });
    expect(rec.incompleteEditions).toEqual([]);
    expect(rec.verificationStatus).toBe('verified');
    // the machine identity is explicit — a RETRIEVAL, not an operator sign-off
    expect(rec.verifiedBy).toMatch(/^code-authority@v1 · https:\/\/ahjregistry/);
    expect(rec.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rec.recordProvenance).toBe('registry_live_retrieval');
    expect(rec.editions.ibc.source).toBe('ahj-registry-retrieval');
    expect(rec.editions.nec.source).toBe('ahj-registry-retrieval');
    // and it is DISTINGUISHABLE from the operator-typed / table state
    const typed = buildCodeAuthority({ ahjRecord: curated(), capturedAtIso: NOW });
    expect(typed.verificationStatus).toBe('incomplete');
    expect(typed.editions.nec.source).toBe('ahj-record');
    expect(typed.verifiedBy).toBeNull();
  });

  it('persists into the EXISTING projectAuthority record as PER-FIELD states, not one boolean', async () => {
    const input = braidonInput();
    const { authority } = await runLifecycle(input, bag());
    generatePermitHTML(input, undefined, authority);
    const snap = (input as any)._snapshot as PermitDesignSnapshot;
    const v = (snap.projectAuthority as any).authorityVerification;
    expect(v.address).toBe('verified');
    expect(v.municipalBoundary).toBe('verified');
    expect(v.ahjName).toBe('verified');
    expect(v.fireAuthority).toBe('verified');
    expect(v.apn).toBe('unknown');                    // honestly unknown, never verified
    // the retrieved records live in the ONE evidence home AAC-2 established
    const ra = (snap as any).resolutionAuthority;
    expect(ra.projectLegalAuthority.sourceHash).toBe(authority.projectLegalAuthority!.sourceHash);
    expect(ra.codeAdoptionAuthority.sourceHash).toBe(authority.codeAdoptionAuthority!.sourceHash);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A2 — ANTI-VACUITY: a sourceless default cannot clear
// ═══════════════════════════════════════════════════════════════════════════

describe('AAC WS-3 · A2 · anti-vacuity: a sourceless default cannot clear CODE-AUTHORITY-INCOMPLETE', () => {
  it('the curated ahj-national table standing alone leaves every non-NEC edition null and the record incomplete', () => {
    const rec = buildCodeAuthority({ ahjRecord: curated(), capturedAtIso: NOW, codeAdoption: null });
    expect(rec.editions.ibc.edition).toBeNull();
    expect(rec.editions.irc.edition).toBeNull();
    expect(rec.editions.ifc.edition).toBeNull();
    expect(rec.verifiedBy).toBeNull();
    expect(rec.sourceHash).toBeNull();
    expect(rec.verificationStatus).toBe('incomplete');
  });

  it('the curated NEC year is admitted as a CORROBORATOR and can never fill an edition the retrieval lacks', () => {
    const partial = fixtureCodeAdoption({ BuildingCode: { Value: '' }, ResidentialCode: { Value: '' }, FireCode: { Value: '' } });
    const rec = buildCodeAdoptionAuthority({
      adoption: partial, corroborator: curated(), asceEngineBasis: null,
      confidence: 0.6, resolverId: 'code-authority@v1', proof: 'fixture',
    });
    expect(rec.editions.find(e => e.kind === 'nec')!.corroboratedBy).toMatch(/ahj-national:il-madison-county/);
    expect(missingAdoptionEditions(rec).sort()).toEqual(['ibc', 'ifc', 'irc']);
    // the curated table carries an NEC year ONLY, and nothing derives IBC from it
    expect(rec.editions.find(e => e.kind === 'ibc')!.edition).toBeNull();
    const built = buildCodeAuthority({ ahjRecord: curated(), capturedAtIso: NOW, codeAdoption: rec });
    expect(built.verificationStatus).toBe('incomplete');
  });

  it('with NO provider injected the requirement stays open and says PROVIDER-NOT-INJECTED — a different fact from "no record"', async () => {
    const { authority, outcome } = await runLifecycle(braidonInput(), {});
    expect(authority.codeAdoptionAuthority ?? null).toBeNull();
    const st = outcome.states['CODE-AUTHORITY-INCOMPLETE'];
    expect(st.cleared).toBe(false);
    expect(st.resolutionAuditRef).toBeNull();
    expect(st.lastResolutionResult).toBe('SKIPPED');
    expect(st.blockingReason).toMatch(/PROVIDER-NOT-INJECTED/);
    // and the run is still recorded — never silently absent
    expect(st.attemptedResolverIds).toContain('code-authority@v1');
  });

  it('a truthy clearance with NO audit reference can never resolve a requirement (the framework contract)', async () => {
    const { outcome } = await runLifecycle(braidonInput(), {});
    for (const code of ['CODE-AUTHORITY-INCOMPLETE', 'PROJECT-AUTHORITY-UNVERIFIED', 'ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED']) {
      const st = outcome.states[code];
      expect(st.cleared).toBe(false);
      expect(deriveRequirementStatus({ resolved: true, resolutionAuditRef: null } as never)).toBe('OPEN');
    }
    expect(outcome.invariantViolations).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A3 — ANTI-VACUITY: utility territory is never AHJ proof
// ═══════════════════════════════════════════════════════════════════════════

describe('AAC WS-3 · A3 · anti-vacuity: utility territory is never AHJ proof', () => {
  it('the code resolver never reads the utility, and a named utility changes nothing', async () => {
    const withUtility = await runLifecycle(braidonInput(i => { i.project.utilityName = 'Ameren Illinois'; }), {});
    const withNone = await runLifecycle(braidonInput(i => { i.project.utilityName = null; }), {});
    const a = withUtility.outcome.states['CODE-AUTHORITY-INCOMPLETE'];
    const b = withNone.outcome.states['CODE-AUTHORITY-INCOMPLETE'];
    expect(a.cleared).toBe(false);
    expect(b.cleared).toBe(false);
    expect(a.blockingReason).toBe(b.blockingReason);
  });

  it('the utility rides on the code-authority record as UTILITY, and never as an edition source', () => {
    const rec = buildCodeAuthority({
      ahjRecord: curated(), utilityName: 'Ameren Illinois', capturedAtIso: NOW, codeAdoption: null,
    });
    expect(rec.utility.name).toBe('Ameren Illinois');
    expect(rec.verificationStatus).toBe('incomplete');
    for (const k of ['nec', 'ibc', 'irc', 'ifc'] as const) {
      expect(rec.editions[k].source).not.toMatch(/utility/i);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A4 — OPERATOR_CONFIRMATION: boundary conflict / incorporated ambiguity
// ═══════════════════════════════════════════════════════════════════════════

describe('AAC WS-3 · A4 · OPERATOR_CONFIRMATION for a boundary conflict, with both candidates shown', () => {
  it('a county disagreement between the project record and the official source is escalated, never picked', () => {
    const rec = buildProjectLegalAuthority({
      identity: BRAIDON_PROPERTY_FIXTURE,
      posted: { address: '3 MELVIN DR', city: 'Granite City', county: 'St. Clair', stateCode: 'IL', apn: null, ahjName: 'Madison County Building & Zoning' },
      ahjRecord: curated(), confidence: 0.9, resolverId: 'project-authority@v1',
    });
    expect(rec.verified).toBe(false);
    expect(rec.confirmationRequired.length).toBeGreaterThan(0);
    // BOTH candidates present in the payload
    expect(rec.confirmationRequired.join(' ')).toMatch(/St\. Clair/);
    expect(rec.confirmationRequired.join(' ')).toMatch(/Madison County/);
  });

  it('an UNINCORPORATED parcel under a CITY authority is the incorporated/unincorporated ambiguity case', () => {
    const rec = buildProjectLegalAuthority({
      identity: BRAIDON_PROPERTY_FIXTURE,             // unincorporated: true
      posted: { address: '3 MELVIN DR', city: 'Granite City', county: 'Madison', stateCode: 'IL', apn: null, ahjName: 'City of Granite City' },
      ahjRecord: curated({ ahjType: 'city', ahjName: 'City of Granite City' }), confidence: 0.9, resolverId: 'project-authority@v1',
    });
    expect(rec.confirmationRequired.join(' ')).toMatch(/OUTSIDE any incorporated municipality/);
    expect(rec.confirmationRequired.join(' ')).toMatch(/CITY authority/);
    expect(rec.fields.ahjName.state).toBe('unverified-derived');
    expect(rec.verified).toBe(false);
  });

  it('the resolver refuses to clear on a conflict, marks it REQUIRES_INPUT, and puts the evidence on the record', async () => {
    const conflicting = createFixturePropertyProvider({
      nowIso: NOW,
      record: { ...BRAIDON_PROPERTY_FIXTURE, county: 'St. Clair County' },
    });
    const { authority, outcome } = await runLifecycle(
      braidonInput(), bag({ propertyIdentity: conflicting }));
    const st = outcome.states['PROJECT-AUTHORITY-UNVERIFIED'];
    expect(st.cleared).toBe(false);
    expect(st.resolutionAuditRef).toBeNull();
    expect(st.retryability).toBe('REQUIRES_INPUT');
    expect(st.blockingReason).toMatch(/county/i);
    // the RECORD still rides on the bundle — the evidence of the conflict is kept
    expect(authority.projectLegalAuthority!.confirmationRequired.length).toBeGreaterThan(0);
    const ev = st.resolutionEvidence.find(e => e.resolverId === 'project-authority@v1')!;
    expect(ev.operatorAction).toMatch(/Confirm the governing jurisdiction/);
  });

  it('countyAgrees compares the bare name, so "Madison" and "Madison County" are not a false conflict', () => {
    expect(countyAgrees('Madison', 'Madison County')).toBe(true);
    expect(countyAgrees('Madison County', 'Madison')).toBe(true);
    expect(countyAgrees('Madison', 'St. Clair')).toBe(false);
    expect(countyAgrees(null, 'Madison')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A5 — OPERATOR_CONFIRMATION: disagreeing authoritative sources
// ═══════════════════════════════════════════════════════════════════════════

describe('AAC WS-3 · A5 · OPERATOR_CONFIRMATION when two sources state different editions', () => {
  it('a registry NEC 2023 against a curated NEC 2020 is a CONFLICT with both values shown, and no edition is chosen', () => {
    const rec = buildCodeAdoptionAuthority({
      adoption: fixtureCodeAdoption({ ElectricCode: { Value: '2023NEC' } }),
      corroborator: curated({ necVersion: '2020' }),
      asceEngineBasis: null, confidence: 0.9, resolverId: 'code-authority@v1', proof: 'fixture',
    });
    expect(rec.conflicts.length).toBe(1);
    expect(rec.conflicts[0]).toMatch(/2023/);
    expect(rec.conflicts[0]).toMatch(/2020/);
    expect(rec.conflicts[0]).toMatch(/may not choose between disagreeing sources/);
    expect(rec.editions.find(e => e.kind === 'nec')!.conflictsWith).toMatch(/states 2020/);
  });

  it('a CONFLICTED adoption may not populate the code-authority record — the edition stays null', () => {
    const conflicted = buildCodeAdoptionAuthority({
      adoption: fixtureCodeAdoption({ ElectricCode: { Value: '2023NEC' } }),
      corroborator: curated({ necVersion: '2020' }),
      asceEngineBasis: null, confidence: 0.9, resolverId: 'code-authority@v1', proof: 'fixture',
    });
    const built = buildCodeAuthority({ ahjRecord: curated(), capturedAtIso: NOW, codeAdoption: conflicted });
    expect(built.editions.ibc.edition).toBeNull();
    expect(built.verifiedBy).toBeNull();
    expect(built.verificationStatus).toBe('incomplete');
    expect(built.applicabilityNotes.join(' ')).toMatch(/ADOPTION SOURCE CONFLICT/);
  });

  it('the resolver escalates the conflict with both sources and never writes an audit ref', async () => {
    const provider = createFixtureCodeProvider({
      nowIso: NOW, records: [mapRegistryToCodeAdoption(rawOrangeButtonAhj({ ElectricCode: { Value: '2023NEC' } }), {
        retrievedAtIso: NOW, sourceUrl: AHJ_REGISTRY_ENDPOINT, matchCount: 1,
        matchedAhjNames: ['Madison County Building & Zoning'], hintState: 'IL',
      })!],
    });
    const { outcome } = await runLifecycle(
      braidonInput(i => { i.project.ahjRecordId = 'il-madison-county'; }), bag({ codeAdoption: provider }));
    const st = outcome.states['CODE-AUTHORITY-INCOMPLETE'];
    expect(st.cleared).toBe(false);
    expect(st.resolutionAuditRef).toBeNull();
    expect(st.retryability).toBe('REQUIRES_INPUT');
    const ev = st.resolutionEvidence.find(e => e.resolverId === 'code-authority@v1')!;
    expect(ev.operatorAction).toMatch(/confirm the governing edition/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A6 — OPERATOR_CONFIRMATION: overlapping jurisdiction
// ═══════════════════════════════════════════════════════════════════════════

describe('AAC WS-3 · A6 · OPERATOR_CONFIRMATION when two authorities overlap the parcel', () => {
  it('two matching authorities are reported AMBIGUOUS with BOTH named and their editions listed', async () => {
    const two = createFixtureCodeProvider({
      nowIso: NOW,
      records: [
        fixtureCodeAdoption(),
        mapRegistryToCodeAdoption(rawOrangeButtonAhj({
          AHJName: { Value: 'City of Granite City' }, AHJLevelCode: { Value: 'Incorporated' },
          ElectricCode: { Value: '2017NEC' },
        }), { retrievedAtIso: NOW, sourceUrl: AHJ_REGISTRY_ENDPOINT, matchCount: 2, matchedAhjNames: [], hintState: 'IL' })!,
      ],
    });
    const { outcome, authority } = await runLifecycle(braidonInput(), bag({ codeAdoption: two }));
    const st = outcome.states['CODE-AUTHORITY-INCOMPLETE'];
    expect(st.cleared).toBe(false);
    expect(st.retryability).toBe('REQUIRES_INPUT');
    expect(st.blockingReason).toMatch(/Madison County Building & Zoning/);
    expect(st.blockingReason).toMatch(/City of Granite City/);
    expect(st.blockingReason).toMatch(/may not choose between overlapping authorities/);
    // nothing was adopted from an ambiguous answer
    expect(authority.codeAdoptionAuthority ?? null).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A7 — failure recording: exact provider, endpoint, failure, retryability
// ═══════════════════════════════════════════════════════════════════════════

describe('AAC WS-3 · A7 · a failed retrieval records the exact source, the exact failure and the operator step', () => {
  it('a missing AHJ_REGISTRY_TOKEN is REQUIRES_INPUT naming the exact env var and the exact endpoint', async () => {
    const unconfigured = createFixtureCodeProvider({ nowIso: NOW, configured: false });
    const { outcome } = await runLifecycle(braidonInput(), bag({ codeAdoption: unconfigured }));
    const st = outcome.states['CODE-AUTHORITY-INCOMPLETE'];
    expect(st.cleared).toBe(false);
    expect(st.retryability).toBe('REQUIRES_INPUT');
    const ev = st.resolutionEvidence.find(e => e.resolverId === 'code-authority@v1')!;
    expect(ev.failureReason).toMatch(/AHJ_REGISTRY_TOKEN is not set/);
    expect(ev.failureReason).toMatch(/ahjregistry\.myorangebutton\.com/);
    expect(ev.operatorAction).toMatch(/AHJ_REGISTRY_TOKEN/);
    expect(ev.sourceQueried).toBe(AHJ_REGISTRY_ENDPOINT);
  });

  it('a TRANSPORT failure is RETRYABLE and a NO_COVERAGE answer is NON_RETRYABLE — never one collapsed null', async () => {
    const timeout = createFixtureCodeProvider({
      nowIso: NOW, failWith: { kind: 'TRANSPORT', failure: `${AHJ_REGISTRY_ENDPOINT}: TimeoutError signal timed out` },
    });
    const empty = createFixtureCodeProvider({
      nowIso: NOW, failWith: { kind: 'NO_COVERAGE', failure: `${AHJ_REGISTRY_ENDPOINT}: no AHJ record covers 38.706,-90.046` },
    });
    const t = await runLifecycle(braidonInput(), bag({ codeAdoption: timeout }));
    const n = await runLifecycle(braidonInput(), bag({ codeAdoption: empty }));
    expect(t.outcome.states['CODE-AUTHORITY-INCOMPLETE'].retryability).toBe('RETRYABLE');
    expect(n.outcome.states['CODE-AUTHORITY-INCOMPLETE'].retryability).toBe('NON_RETRYABLE');
    expect(t.outcome.states['CODE-AUTHORITY-INCOMPLETE'].blockingReason).toMatch(/TimeoutError/);
  });

  it('a PARTIAL retrieval names the missing edition, never infers it, and does not clear', async () => {
    const partial = createFixtureCodeProvider({
      nowIso: NOW, records: [fixtureCodeAdoption({ FireCode: { Value: '' } })],
    });
    const { authority, outcome } = await runLifecycle(braidonInput(), bag({ codeAdoption: partial }));
    const st = outcome.states['CODE-AUTHORITY-INCOMPLETE'];
    expect(st.cleared).toBe(false);
    expect(st.requiredInputs.join(' ')).toMatch(/IFC adoption for Madison County/);
    // the retrieved editions are STILL on the record — a partial retrieval is
    // better evidence than none, it simply does not clear.
    expect(authority.codeAdoptionAuthority!.editions.find(e => e.kind === 'ibc')!.edition).toBe('2021');
    expect(authority.codeAdoptionAuthority!.editions.find(e => e.kind === 'ifc')!.edition).toBeNull();
  });

  it('the declaration table and the registered resolvers agree (no undeclared or unregistered resolver)', () => {
    const reg = createResolverRegistry(PRODUCTION_RESOLVERS);
    for (const id of ['project-authority@v1', 'code-authority@v1', 'environmental-load-authority@v1']) {
      expect(reg.get(id)).toBeTruthy();
      expect(reg.get(id)!.mode).toBe('AUTO_RETRIEVED');
    }
    expect(REQUIREMENT_DECLARATIONS['CODE-AUTHORITY-INCOMPLETE'].resolverId).toBe('code-authority@v1');
    expect(REQUIREMENT_DECLARATIONS['PROJECT-AUTHORITY-UNVERIFIED'].resolverId).toBe('project-authority@v1');
    expect(REQUIREMENT_DECLARATIONS['ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED'].resolverId).toBe('environmental-load-authority@v1');
    // dependency order: the legal identity is retrieved BEFORE the codes keyed on it
    const ids = PRODUCTION_RESOLVERS.map(r => r.id);
    expect(ids.indexOf('project-authority@v1')).toBeLessThan(ids.indexOf('code-authority@v1'));
    expect(codeAuthorityResolver.requiredInputs).toContain('projectLegalAuthority');
    expect(projectAuthorityResolver.produces).toEqual(['projectLegalAuthority']);
    expect(projectAuthorityKeyResolver.mode).toBe('AUTO_DERIVED');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// V1 — the environmental retrieval populates the record and drives the CALC
// ═══════════════════════════════════════════════════════════════════════════

describe('AAC WS-4 · V1 · the retrieval populates the authority record and the calculation derives from it', () => {
  it('every field the directive enumerates is present and sourced [FIXTURE PROOF]', async () => {
    const { authority, outcome } = await runLifecycle(braidonInput(i => { i.project.windExposure = 'C'; }), bag());
    const r = authority.environmentalRetrieval!;
    expect(r.sourceProvider).toMatch(/ASCE 7 Hazard Tool/);
    expect(r.sourceDocumentOrTool).toMatch(/ASCE 7-22 hazard datasets, Risk Category II \(700-yr MRI wind\)/);
    expect(r.edition).toBe('ASCE 7-22');
    expect(r.queryInputs).toMatchObject({ lat: LAT, lng: LNG, riskCategory: 'II', siteClass: 'D' });
    expect(r.queryInputs.riskCategoryBasis).toMatch(/Table 1\.5-1/);
    expect(r.returnedValues.windSpeedMph).toBe(107.533);
    expect(r.returnedValues.groundSnowLoadPsf).toBe(23.2836);
    expect(r.returnedValues.seismicSdc).toBe('D');
    expect(r.retrievedAtIso).toBe(NOW);
    expect(r.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.applicability).toMatch(/lat 38\.7061678, lng -90\.0461651/);
    expect(r.confidence).toBeGreaterThan(0);
    expect(Array.isArray(r.overrideHistory)).toBe(true);
    // every scalar carries its own endpoint
    expect(r.datasets.map(d => d.sourceUrl).some(u => /gis\.asce\.org/.test(u))).toBe(true);
    expect(r.datasets.map(d => d.sourceUrl).some(u => /earthquake\.usgs\.gov/.test(u))).toBe(true);
    expect(r.proof).toBe('fixture');

    const st = outcome.states['ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED'];
    expect(st.cleared).toBe(true);
    expect(st.resolutionAuditRef).toMatch(/^AAC-RESOLVER:environmental-load-authority@v1/);
  });

  it('the CALCULATED values — not merely the displayed ones — derive from the record', async () => {
    const input = braidonInput(i => { i.project.windExposure = 'C'; });
    const { authority } = await runLifecycle(input, bag());
    // the resolver wrote the governing values back BEFORE the sync build runs
    expect((input.project as any).ahjWindSpeedMph).toBe(107.533);
    expect((input.project as any).ahjGroundSnowPsf).toBe(23.284);
    expect((input.project as any).seismicDesignCategory).toBe('D');
    generatePermitHTML(input, undefined, authority);
    const snap = (input as any)._snapshot as PermitDesignSnapshot;
    const env = (snap.structural as any).env.environmentalLoadAuthority;
    expect(env.ultimateWindSpeedMph).toBe(107.533);
    expect(env.groundSnowLoadPsf).toBe(23.284);
    expect(env.verificationStatus).toBe('verified');
    // the ENGINE ran on the same number — env and the loads mirror agree (V23)
    expect((snap.structural as any).loads.windSpeedMph).toBe(107.533);
    expect(env.windSpeedBasis).toBe('verified-source');
    expect(env.snowLoadBasis).toBe('verified-source');
    expect(env.sourceHash).toBe(authority.environmentalRetrieval!.sourceHash);
  });

  it('the retrieval is what the EXISTING nine-condition gate accepts — the gate is not relaxed', () => {
    const rec = buildEnvironmentalRetrievalRecord({
      hazards: BRAIDON_HAZARD_FIXTURE, resolverId: 'environmental-load-authority@v1', projectId: PID,
      jurisdiction: 'Madison County', addressUsed: '3 MELVIN DR', riskDecision: resolveRiskCategory(null),
      posted: { windSpeedMph: null, groundSnowPsf: null, exposureCategory: 'C', riskCategory: null },
      postedWindOperatorEntered: false, postedSnowOperatorEntered: false,
      siteClass: 'D', confidence: 1, nowIso: NOW,
    });
    const ev = toEnvironmentalSourceEvidence(rec);
    expect(environmentalSourceVerified(ev, 'Madison County', { lat: BRAIDON_HAZARD_FIXTURE.coordinates.lat, lng: BRAIDON_HAZARD_FIXTURE.coordinates.lng })).toBe(true);
    // a live read IS current at the instant it was read, and it says so
    expect(ev.currencyConfirmedAtIso).toBe(NOW);
    expect(rec.currencyBasis).toMatch(/FIXTURE replay|LIVE read/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// V2 — ANTI-VACUITY: empty evidence cannot clear
// ═══════════════════════════════════════════════════════════════════════════

describe('AAC WS-4 · V2 · anti-vacuity: empty evidence cannot clear the environmental authority', () => {
  it('no provider ⇒ the requirement stays open, with PROVIDER-NOT-INJECTED and no record', async () => {
    const { authority, outcome } = await runLifecycle(braidonInput(), {});
    expect(authority.environmentalRetrieval ?? null).toBeNull();
    expect(authority.environmentalSource).toBeNull();
    const st = outcome.states['ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED'];
    expect(st.cleared).toBe(false);
    expect(st.blockingReason).toMatch(/PROVIDER-NOT-INJECTED/);
  });

  it('a failed retrieval records the exact endpoint + failure and clears nothing', async () => {
    const failing = createFixtureHazardProvider({
      nowIso: NOW,
      failWith: { kind: 'NO_COVERAGE', failure: 'ASCE 7-22 hazard retrieval incomplete: ground snow load NOT retrieved' },
    });
    const { outcome } = await runLifecycle(braidonInput(), bag({ climateHazard: failing }));
    const st = outcome.states['ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED'];
    expect(st.cleared).toBe(false);
    expect(st.blockingReason).toMatch(/ground snow load NOT retrieved/);
    const ev = st.resolutionEvidence.find(e => e.resolverId === 'environmental-load-authority@v1')!;
    expect(ev.sourceQueried).toMatch(/gis\.asce\.org/);
    expect(ev.auditRef).toBeNull();
  });

  it('a retrieval with NO exposure category cannot clear — a dataset cannot supply a §26.7 determination', async () => {
    const input = braidonInput(i => { i.project.windExposure = null; i.project.exposureCategory = null; });
    const { authority, outcome } = await runLifecycle(input, bag());
    const st = outcome.states['ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED'];
    expect(st.cleared).toBe(false);
    expect(st.blockingReason).toMatch(/exposure category/i);
    expect(authority.environmentalSource!.coversExposureRisk).toBe(false);
    expect(environmentalSourceVerified(authority.environmentalSource, 'Madison County')).toBe(false);
    // the retrieved values still ride — better than the code default, but not a clear
    expect(authority.environmentalRetrieval!.returnedValues.windSpeedMph).toBe(107.533);
    const ev = st.resolutionEvidence.find(e => e.resolverId === 'environmental-load-authority@v1')!;
    expect(ev.operatorAction).toMatch(/§26\.7 exposure category/);
  });

  it('a bare operator-typed wind/snow with NO source can never verify the record', () => {
    const env = buildEnvironmentalLoadAuthority({
      windSpeedMph: 110, groundSnowPsf: 20, exposureCategory: 'C', riskCategory: 'II',
      windOperatorEntered: true, snowOperatorEntered: true,
      coordinates: { lat: LAT, lng: LNG }, addressUsed: '3 MELVIN DR', projectOrAhj: 'Madison County',
      sourceEvidence: null, capturedAtIso: NOW,
    });
    expect(env.verificationStatus).not.toBe('verified');
    expect(env.windSpeedBasis).toBe('operator-entered');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// V3 — a COORDINATE CHANGE invalidates the prior authority
// ═══════════════════════════════════════════════════════════════════════════

describe('AAC WS-4 · V3 · a coordinate change invalidates the environmental authority', () => {
  it('the gate refuses a source retrieved at a different point, and accepts a sub-tolerance refinement', () => {
    const rec = buildEnvironmentalRetrievalRecord({
      hazards: BRAIDON_HAZARD_FIXTURE, resolverId: 'environmental-load-authority@v1', projectId: PID,
      jurisdiction: 'Madison County', addressUsed: '3 MELVIN DR', riskDecision: resolveRiskCategory(null),
      posted: { windSpeedMph: null, groundSnowPsf: null, exposureCategory: 'C', riskCategory: null },
      postedWindOperatorEntered: false, postedSnowOperatorEntered: false, siteClass: 'D', confidence: 1, nowIso: NOW,
    });
    const ev = toEnvironmentalSourceEvidence(rec);
    const at = rec.queryInputs;
    // the aerial house-centre correction (metres) does NOT invalidate
    expect(environmentalSourceVerified(ev, 'Madison County', { lat: at.lat + 0.0004, lng: at.lng - 0.0004 })).toBe(true);
    // a different site DOES
    expect(environmentalSourceVerified(ev, 'Madison County', { lat: at.lat + 0.05, lng: at.lng })).toBe(false);
    expect(environmentalCoordinatesCover({ lat: at.lat, lng: at.lng }, { lat: at.lat + 0.05, lng: at.lng })).toBe(false);
    expect(ENVIRONMENTAL_COORDINATE_TOLERANCE_DEG).toBe(0.001);
  });

  it('the record itself is coordinate-derived: moving the site produces a DIFFERENT hash and applicability', async () => {
    const a = await runLifecycle(braidonInput(i => { i.project.windExposure = 'C'; }), bag());
    const b = await runLifecycle(braidonInput(i => { i.project.windExposure = 'C'; i.project.lat = LAT + 0.4; }), bag());
    expect(a.authority.environmentalRetrieval!.sourceHash)
      .not.toBe(b.authority.environmentalRetrieval!.sourceHash);
    expect(b.authority.environmentalRetrieval!.applicability).toMatch(/39\.1/);
  });

  it('an ARCHIVED source whose point has moved is REJECTED, re-retrieved, and the invalidation is declared', async () => {
    const input = braidonInput(i => { i.project.windExposure = 'C'; });
    const calls: unknown[] = [];
    const hazard = createFixtureHazardProvider({ nowIso: NOW, calls: calls as never });
    // an archived climate_hazard_dataset for a DIFFERENT site (400 km away)
    const staleArchivedDoc = {
      documentId: 'stale-hazard-doc', dataset: 'ASCE 7-22 Hazard Tool report', versionOrDate: '2024-01-01',
      verificationState: 'verified', archivedInRepo: true, sha256: 'a'.repeat(64),
      coversWindSpeed: true, coversSnowLoad: true, coversExposureRisk: true,
      windSpeedMph: 96, groundSnowPsf: 5, exposureCategory: 'B', riskCategory: 'II',
      coordinates: { lat: 41.88, lng: -87.63 },          // Chicago, not Granite City
      addressUsed: 'a different site', projectApplicability: 'Madison County',
      lookupTimestampIso: '2024-01-01T00:00:00.000Z', currencyConfirmedAtIso: '2024-01-01T00:00:00.000Z',
    };
    const read: SafeDbRead = async <T>(label: string, _r: () => Promise<T>, failSoftTo: T) =>
      label.startsWith('resolveClimateHazardDocument')
        ? { value: staleArchivedDoc as unknown as T, ok: true, error: null }
        : { value: failSoftTo, ok: false, error: `${label}: 42P01 relation does not exist` };

    const { authority, outcome } = await runLifecycle(input, bag({ climateHazard: hazard }), read);
    // the live retrieval RAN despite the archived document being present
    expect(calls.length).toBe(1);
    expect(authority.environmentalRetrieval).toBeTruthy();
    expect(authority.environmentalSource!.windSpeedMph).toBe(107.533);   // not the stale 96
    // and the invalidation NAMES the superseded source
    const inv = outcome.invalidations.map(i => `${i.target} ${i.reason}`).join(' | ');
    expect(inv).toMatch(/stale-hazard-doc/);
    expect(inv).toMatch(/coordinates moved beyond the coverage tolerance/);
  });

  it('an archived source that DOES cover the site is the authority, and no live call is made', async () => {
    const calls: unknown[] = [];
    const hazard = createFixtureHazardProvider({ nowIso: NOW, calls: calls as never });
    const goodDoc = {
      documentId: 'good-hazard-doc', dataset: 'ASCE 7-22 Hazard Tool report', versionOrDate: '2026-01-01',
      verificationState: 'verified', archivedInRepo: true, sha256: 'b'.repeat(64),
      coversWindSpeed: true, coversSnowLoad: true, coversExposureRisk: true,
      windSpeedMph: 107.5, groundSnowPsf: 23.3, exposureCategory: 'C', riskCategory: 'II',
      coordinates: { lat: LAT, lng: LNG }, addressUsed: '3 MELVIN DR',
      projectApplicability: 'Madison County Building & Zoning',
      lookupTimestampIso: '2026-01-01T00:00:00.000Z', currencyConfirmedAtIso: '2026-01-01T00:00:00.000Z',
    };
    const read: SafeDbRead = async <T>(label: string, _r: () => Promise<T>, failSoftTo: T) =>
      label.startsWith('resolveClimateHazardDocument')
        ? { value: goodDoc as unknown as T, ok: true, error: null }
        : { value: failSoftTo, ok: false, error: `${label}: 42P01 relation does not exist` };
    const { authority, outcome } = await runLifecycle(braidonInput(), bag({ climateHazard: hazard }), read);
    expect(calls.length).toBe(0);
    expect(authority.environmentalSource!.documentId).toBe('good-hazard-doc');
    expect(outcome.states['ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED'].cleared).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// V4 — the operator OVERRIDE machinery
// ═══════════════════════════════════════════════════════════════════════════

describe('AAC WS-4 · V4 · an operator override governs, and never destroys the retrieval', () => {
  const properOverride = {
    field: 'ultimateWindSpeedMph' as const, value: 120,
    reason: 'Madison County ordinance 2025-11 requires 120 mph Vult for accessory structures',
    authoritySource: 'Madison County Building & Zoning ordinance 2025-11 §4.2',
    actor: 'r.obrien@solarpro', atIso: '2026-07-26T15:00:00.000Z',
  };

  it('value + reason + authority source + actor + timestamp ⇒ it GOVERNS and the retrieval is preserved', () => {
    const rec = buildEnvironmentalRetrievalRecord({
      hazards: BRAIDON_HAZARD_FIXTURE, resolverId: 'environmental-load-authority@v1', projectId: PID,
      jurisdiction: 'Madison County', addressUsed: '3 MELVIN DR', riskDecision: resolveRiskCategory(null),
      posted: { windSpeedMph: null, groundSnowPsf: null, exposureCategory: 'C', riskCategory: null },
      postedWindOperatorEntered: false, postedSnowOperatorEntered: false,
      operatorOverrides: [properOverride], siteClass: 'D', confidence: 1, nowIso: NOW,
    });
    expect(rec.governing.windSpeedMph).toBe(120);
    // the ORIGINAL retrieval survives, in full
    expect(rec.returnedValues.windSpeedMph).toBe(107.533);
    const entry = rec.overrideHistory.find(h => h.field === 'ultimateWindSpeedMph')!;
    expect(entry.disposition).toBe('governing');
    expect(entry.retrievedValue).toBe(107.533);
    expect(entry.reason).toBe(properOverride.reason);
    expect(entry.authoritySource).toBe(properOverride.authoritySource);
    expect(entry.actor).toBe(properOverride.actor);
    expect(entry.atIso).toBe(properOverride.atIso);
    expect(entry.stricterThanRetrieved).toBe(true);
    // a proper override is not a conflict — it IS the resolution of one
    expect(rec.conflicts).toEqual([]);
  });

  it('an override reaches the resolver through the project record and clears the requirement', async () => {
    const input = braidonInput(i => {
      i.project.windExposure = 'C';
      i.project.environmentalOverrides = [properOverride];
    });
    const { authority, outcome } = await runLifecycle(input, bag());
    expect(authority.environmentalRetrieval!.governing.windSpeedMph).toBe(120);
    expect((input.project as any).ahjWindSpeedMph).toBe(120);
    expect(outcome.states['ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED'].cleared).toBe(true);
    expect(authority.environmentalRetrieval!.returnedValues.windSpeedMph).toBe(107.533);
  });

  it('the exposure category is an override/observation with its OWN basis, never a retrieved value', () => {
    const rec = buildEnvironmentalRetrievalRecord({
      hazards: BRAIDON_HAZARD_FIXTURE, resolverId: 'environmental-load-authority@v1', projectId: PID,
      jurisdiction: 'Madison County', addressUsed: null, riskDecision: resolveRiskCategory(null),
      posted: { windSpeedMph: null, groundSnowPsf: null, exposureCategory: 'B', riskCategory: null },
      postedWindOperatorEntered: false, postedSnowOperatorEntered: false, siteClass: 'D', confidence: 1, nowIso: NOW,
    });
    expect(rec.exposure.category).toBe('B');
    expect(rec.exposure.source).toBe('operator-entered');
    expect(rec.exposure.basis).toMatch(/§26\.7/);
    expect(rec.datasets.some(d => /exposure/i.test(d.label))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// V5 — operator entries vs the retrieval: honest reconciliation
// ═══════════════════════════════════════════════════════════════════════════

describe('AAC WS-4 · V5 · operator-entered values vs the retrieval are reconciled honestly', () => {
  const build = (posted: { wind: number | null; snow: number | null }, prov: 'operator-entered' | 'unprovenanced-table') =>
    buildEnvironmentalRetrievalRecord({
      hazards: BRAIDON_HAZARD_FIXTURE, resolverId: 'environmental-load-authority@v1', projectId: PID,
      jurisdiction: 'Madison County', addressUsed: null, riskDecision: resolveRiskCategory(null),
      posted: { windSpeedMph: posted.wind, groundSnowPsf: posted.snow, exposureCategory: 'C', riskCategory: null },
      postedWindOperatorEntered: true, postedSnowOperatorEntered: true,
      postedWindProvenance: prov, postedSnowProvenance: prov,
      siteClass: 'D', confidence: 1, nowIso: NOW,
    });

  it('a SOURCELESS table value (110 mph / 20 psf) is superseded outright — it never had authority', () => {
    const rec = build({ wind: 110, snow: 20 }, 'unprovenanced-table');
    expect(rec.conflicts).toEqual([]);
    expect(rec.governing.windSpeedMph).toBe(107.533);
    expect(rec.governing.groundSnowLoadPsf).toBe(23.284);
    const w = rec.overrideHistory.find(h => h.field === 'ultimateWindSpeedMph')!;
    expect(w.disposition).toBe('superseded');
    expect(w.reason).toMatch(/no adoption ordinance, no effective date and no hash/);
    expect(w.value).toBe(110);                         // preserved, never lost
    expect(w.retrievedValue).toBe(107.533);
  });

  it('an OPERATOR-ENTERED value that differs MATERIALLY is OPERATOR_CONFIRMATION with both shown', () => {
    const rec = build({ wind: 130, snow: 40 }, 'operator-entered');
    expect(rec.conflicts.length).toBe(2);
    expect(rec.conflicts[0]).toMatch(/130 mph \(operator-entered\)/);
    expect(rec.conflicts[0]).toMatch(/107\.533 mph/);
    expect(rec.conflicts[0]).toMatch(/may not choose between them/);
    // the MORE CONSERVATIVE value holds while it is open — never a silent weakening
    expect(rec.governing.windSpeedMph).toBe(130);
    expect(rec.governing.groundSnowLoadPsf).toBe(40);
    expect(rec.overrideHistory.every(h => h.disposition === 'conflict-pending-confirmation')).toBe(true);
    // and the evidence is NOT verified while two authorities disagree
    expect(toEnvironmentalSourceEvidence(rec).verificationState).toBe('unverified-source-conflict');
    expect(environmentalSourceVerified(toEnvironmentalSourceEvidence(rec), 'Madison County')).toBe(false);
  });

  it('an operator value INSIDE the materiality threshold is a refinement, not a conflict', () => {
    const rec = build({ wind: 110, snow: 25 }, 'operator-entered');   // Δ 2.5 mph / 1.7 psf
    expect(rec.conflicts).toEqual([]);
    expect(rec.governing.windSpeedMph).toBe(107.533);
    expect(WIND_MATERIAL_DELTA_MPH).toBe(5);
    expect(SNOW_MATERIAL_DELTA_PSF).toBe(5);
    expect(postedValueHasAuthority('operator-entered')).toBe(true);
    expect(postedValueHasAuthority('unprovenanced-table')).toBe(false);
    expect(postedValueHasAuthority('engine-default')).toBe(false);
  });

  it('the resolver escalates a material disagreement instead of clearing, with the operator step stated', async () => {
    const input = braidonInput(i => {
      i.project.windExposure = 'C';
      i.project.ahjWindSpeedMph = 130;
      i.project.environmentalValueProvenance = { windSpeedMph: 'operator-entered' };
    });
    const { authority, outcome } = await runLifecycle(input, bag());
    const st = outcome.states['ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED'];
    expect(st.cleared).toBe(false);
    expect(st.resolutionAuditRef).toBeNull();
    expect(st.retryability).toBe('REQUIRES_INPUT');
    expect(st.blockingReason).toMatch(/130 mph/);
    expect(st.blockingReason).toMatch(/107\.533 mph/);
    expect(authority.environmentalRetrieval!.conflicts.length).toBe(1);
    // the design does not weaken while the question is open
    expect((input.project as any).ahjWindSpeedMph).toBe(130);
    const ev = st.resolutionEvidence.find(e => e.resolverId === 'environmental-load-authority@v1')!;
    expect(ev.operatorAction).toMatch(/Record the decision as an override/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// V6 — archival through the document registry
// ═══════════════════════════════════════════════════════════════════════════

describe('AAC WS-4 · V6 · the retrieval is archived as a climate_hazard_dataset registry row', () => {
  it('a successful archival binds the document id onto the evidence and the audit refs', async () => {
    const written: Record<string, unknown>[] = [];
    const read: SafeDbRead = async <T>(label: string, _r: () => Promise<T>, failSoftTo: T) => {
      if (label.startsWith('createDocument(climate_hazard_dataset)')) {
        written.push({ label });
        return { value: { id: 'archived-hazard-row' } as unknown as T, ok: true, error: null };
      }
      return { value: failSoftTo, ok: false, error: `${label}: 42P01 relation does not exist` };
    };
    const { authority, outcome } = await runLifecycle(
      braidonInput(i => { i.project.windExposure = 'C'; }), bag(), read);
    expect(written.length).toBe(1);
    const r = authority.environmentalRetrieval!;
    expect(r.registryArchival).toMatchObject({ attempted: true, documentId: 'archived-hazard-row', failure: null });
    expect(authority.environmentalSource!.documentId).toBe('archived-hazard-row');
    expect(outcome.states['ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED'].resolutionAuditRef)
      .toMatch(/document:archived-hazard-row/);
  });

  it('migration 113 absent ⇒ the exact retryable failure + operator step, and the retrieval still stands on its own hash', async () => {
    const { authority, outcome } = await runLifecycle(
      braidonInput(i => { i.project.windExposure = 'C'; }), bag(), OFFLINE);
    const r = authority.environmentalRetrieval!;
    expect(r.registryArchival.attempted).toBe(true);
    expect(r.registryArchival.documentId).toBeNull();
    expect(r.registryArchival.failure).toMatch(/42P01/);
    expect(r.registryArchival.operatorAction).toMatch(/migration 113/);
    // the snapshot-side archival (hash + evidence) is intact, so the requirement
    // still clears — the missing DB index is a degradation, stated as one.
    expect(authority.environmentalSource!.sha256).toBe(r.sourceHash);
    expect(authority.environmentalSource!.documentId).toMatch(/^env-retrieval:/);
    expect(outcome.states['ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED'].cleared).toBe(true);
    const ev = outcome.states['ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED'].resolutionEvidence
      .find(e => e.resolverId === 'environmental-load-authority@v1')!;
    expect(ev.operatorAction).toMatch(/migration 113/);
  });

  it('the archived document id is content-derived, so regenerating the same site does not duplicate rows', async () => {
    const a = await runLifecycle(braidonInput(i => { i.project.windExposure = 'C'; }), bag());
    const b = await runLifecycle(braidonInput(i => { i.project.windExposure = 'C'; }), bag());
    expect(retrievalSourceHash({ x: 1 })).toBe(retrievalSourceHash({ x: 1 }));
    expect(a.authority.environmentalRetrieval!.sourceHash)
      .toBe(b.authority.environmentalRetrieval!.sourceHash);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CROSS-CUTTING — the no-lifecycle path is byte-identical
// ═══════════════════════════════════════════════════════════════════════════

describe('AAC WS-3 / WS-4 · a run with no retrieval is byte-identical to the pre-AAC behaviour', () => {
  it('generating with NO authority bundle produces the same digest as generating with an all-null one', () => {
    const a = braidonInput();
    generatePermitHTML(a);
    const digestA = ((a as any)._snapshot as PermitDesignSnapshot).meta.digest;
    const b = braidonInput();
    generatePermitHTML(b, undefined, {
      capacityDocument: null, projectJurisdiction: null, manufacturerDocumentsArchived: null,
      digestInvalidatedByLedger: false, framingCapacityDocument: null, framingProjectApplicabilityKey: null,
      cableExtensionSolutions: [], qcableServiceLoopAllowance: null, environmentalSource: null,
      projectLegalAuthority: null, codeAdoptionAuthority: null, environmentalRetrieval: null,
    });
    const digestB = ((b as any)._snapshot as PermitDesignSnapshot).meta.digest;
    expect(digestB).toBe(digestA);
  });

  it('the environmental resolver never runs before the legal identity it is keyed on', () => {
    expect(environmentalAuthorityResolver.requiredInputs).toContain('projectLegalAuthority');
    const ids = PRODUCTION_RESOLVERS.map(r => r.id);
    expect(ids.indexOf('project-authority@v1')).toBeLessThan(ids.indexOf('environmental-load-authority@v1'));
    // the archived-document lookup runs BEFORE the live retrieval (durable cache)
    expect(ids.indexOf('climate-hazard-document@v1')).toBeLessThan(ids.indexOf('environmental-load-authority@v1'));
  });
});
