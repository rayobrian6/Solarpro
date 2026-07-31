// ═══════════════════════════════════════════════════════════════════════════
// AAC WS-3 — DETERMINISTIC CODE-ADOPTION FIXTURES
// ───────────────────────────────────────────────────────────────────────────
// ⚠ FIXTURE PROOF ONLY, AND SAY SO. Unlike the climate-hazard and property
// fixtures — both captured from real live calls in this environment on
// 2026-07-27 — the SunSpec / Orange Button registry could NOT be called: it
// requires AHJ_REGISTRY_TOKEN, which is not provisioned here.
//
// So these records are NOT a replay of a live retrieval and are NOT presented as
// one. They are a RESPONSE-SHAPE fixture: the Orange Button field names and the
// scalar `{ Value: … }` wrapping are taken from the open-source registry server
// (jakl/ahj-registry) and from the contract already documented at the top of
// lib/jurisdictions/ahjRegistry.ts. The EDITION VALUES in them are illustrative
// test inputs chosen to exercise the resolver, and every fixture record is
// stamped `proof: 'fixture'` with `fixtureProvenance` saying exactly that.
//
// NOTHING in production reads this file. No fixture value can reach a planset:
// the resolver only ever accepts a record from the provider it was given, and
// the production provider is the live registry client.
//
// TO OBTAIN LIVE PROOF: email support@sunspec.org for a free token, set
// AHJ_REGISTRY_TOKEN, and regenerate. The resolver then retrieves the real
// adopted editions and CODE-AUTHORITY-INCOMPLETE clears with live provenance.
// ═══════════════════════════════════════════════════════════════════════════

import { retrievalOk, retrievalFailure, type RetrievalResult, type RetrievalFailureKind } from '../types';
import { mapRegistryToCodeAdoption, AHJ_REGISTRY_ENDPOINT, type RegistryCodeAdoption } from '@/lib/jurisdictions/ahjRegistry';
import type { CodeAdoptionProvider, CodeAdoptionQuery, RetrievedCodeAdoption } from './types';

const FIXTURE_AT = '2026-07-27T20:50:00.000Z';

export const CODE_FIXTURE_PROVENANCE =
  'RESPONSE-SHAPE FIXTURE (not a live capture): AHJ_REGISTRY_TOKEN is not provisioned in this environment, so the '
  + 'SunSpec/Orange Button registry was never called. Field names and the {Value:…} wrapping follow the open-source '
  + 'registry server contract; the edition values are test inputs. FIXTURE PROOF, NOT LIVE PROOF.';

/** A raw Orange Button AHJ payload in the registry's own shape. */
export function rawOrangeButtonAhj(over?: Record<string, unknown>): Record<string, unknown> {
  return {
    AHJName: { Value: 'Madison County Building & Zoning' },
    AHJCode: { Value: 'IL-MADISON-CO' },
    AHJID: { Value: 'ob-il-madison-county' },
    AHJLevelCode: { Value: 'CountySubdivision' },
    ElectricCode: { Value: '2020NEC' },
    BuildingCode: { Value: '2021IBC' },
    ResidentialCode: { Value: '2021IRC' },
    FireCode: { Value: '2021IFC' },
    Address: {
      AddressLine1: { Value: '157 N MAIN ST' },
      City: { Value: 'Edwardsville' },
      County: { Value: 'Madison' },
      StateProvince: { Value: 'IL' },
    },
    Contacts: [{ WorkPhone: { Value: '(618) 692-6280' }, URL: { Value: 'https://www.madisoncountyil.gov/departments/building_and_zoning/' } }],
    EngineeringReviewRequirements: [
      { EngineeringReviewType: { Value: 'StructuralEngineeringReview' }, Description: { Value: 'Stamped structural letter for roof-mounted PV' } },
    ],
    LastUpdated: { Value: '2025-11-14' },
    ...(over ?? {}),
  };
}

export function fixtureCodeAdoption(over?: Record<string, unknown>, matchCount = 1): RegistryCodeAdoption {
  const rec = mapRegistryToCodeAdoption(rawOrangeButtonAhj(over), {
    retrievedAtIso: FIXTURE_AT,
    sourceUrl: AHJ_REGISTRY_ENDPOINT,
    matchCount,
    matchedAhjNames: ['Madison County Building & Zoning'],
    hintState: 'IL',
  });
  if (!rec) throw new Error('fixtureCodeAdoption: the fixture payload did not map');
  return rec;
}

export interface FixtureCodeProviderOptions {
  /** the AHJ(s) the query resolves to. >1 ⇒ the overlapping-jurisdiction case. */
  records?: RegistryCodeAdoption[];
  failWith?: { kind: RetrievalFailureKind; failure: string; operatorAction?: string | null };
  configured?: boolean;
  nowIso?: string;
  calls?: CodeAdoptionQuery[];
}

export function createFixtureCodeProvider(opts?: FixtureCodeProviderOptions): CodeAdoptionProvider {
  const configured = opts?.configured !== false;
  return {
    name: 'sunspec-orange-button-ahj-registry (fixture)',
    metered: false,
    isConfigured: () => configured,
    async getCodeAdoption(q: CodeAdoptionQuery): Promise<RetrievalResult<RetrievedCodeAdoption>> {
      opts?.calls?.push(q);
      const retrievedAtIso = opts?.nowIso ?? FIXTURE_AT;
      if (!configured) {
        return retrievalFailure({
          sourcesQueried: [], retrievedAtIso, failureKind: 'NOT_CONFIGURED',
          failure: `${AHJ_REGISTRY_ENDPOINT}: AHJ_REGISTRY_TOKEN is not set — the SunSpec/Orange Button AHJ Registry was NOT queried.`,
          operatorAction: 'Set AHJ_REGISTRY_TOKEN (free token from support@sunspec.org), then regenerate.',
        });
      }
      if (opts?.failWith) {
        return retrievalFailure({
          sourcesQueried: [AHJ_REGISTRY_ENDPOINT], retrievedAtIso,
          failureKind: opts.failWith.kind, failure: opts.failWith.failure,
          operatorAction: opts.failWith.operatorAction ?? null,
        });
      }
      const records = opts?.records ?? [fixtureCodeAdoption()];
      if (records.length > 1) {
        return retrievalFailure({
          sourcesQueried: [AHJ_REGISTRY_ENDPOINT], retrievedAtIso, failureKind: 'AMBIGUOUS',
          failure: `${AHJ_REGISTRY_ENDPOINT}: ${records.length} authorities cover this location — `
            + records.map(m => `${m.ahjName} [${m.jurisdictionType}] NEC ${m.editions.nec ?? '—'} / IBC ${m.editions.ibc ?? '—'} / IRC ${m.editions.irc ?? '—'} / IFC ${m.editions.ifc ?? '—'}`).join(' ‖ ')
            + '. The engine may not choose between overlapping authorities.',
          operatorAction: 'Confirm which authority has jurisdiction over this parcel.',
        });
      }
      return retrievalOk({
        value: { record: records[0], allMatches: records, proof: 'fixture', fixtureProvenance: CODE_FIXTURE_PROVENANCE },
        sourcesQueried: [AHJ_REGISTRY_ENDPOINT], retrievedAtIso,
        confidence: (() => {
          const e = records[0].editions;
          const present = [e.nec, e.ibc, e.irc, e.ifc].filter(Boolean).length;
          return Math.round((0.5 + 0.125 * present) * 100) / 100;
        })(),
      });
    },
  };
}
