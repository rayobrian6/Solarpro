// ═══════════════════════════════════════════════════════════════════════════
// MCC — MACHINE-CLOSURE COMPLETION.
//
// Four repairs, each closing a defect of the SAME class the release-reachability
// phase named: an authority is computed and then discarded, or a fact about the
// ACT OF BUILDING leaks into the identity of the thing built.
//
//   §0  the design digest must not move because time passed
//   §1  a resolver's clearance must reach the record the release gate reads
//   §2  the authoritative project record outranks its stale config mirror
//   §3  the AHJ NAME must come from the same source as the AHJ TYPE
//   §4  a machine-retrieved APN must not be graded as if it were typed in
//
// Nothing here weakens the digest-bound professional-review authority: every
// test that touches release state asserts it still fails closed.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { computeSnapshotDigest } from '@/lib/permit/snapshot/digest';
import { buildProjectLegalAuthority } from '@/lib/permit/snapshot/resolution/jurisdictionAuthority';
import type { RetrievedPropertyIdentity } from '@/lib/providers/property/types';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

// ═══════════════════════════════════════════════════════════════════════════
// §0 — RUN-INSTANT PROVENANCE IS NOT DESIGN CONTENT
// ═══════════════════════════════════════════════════════════════════════════

describe('MCC §0 · the design digest does not move because time passed', () => {
  /** The same design, "built" at two different instants. */
  const snapAt = (instant: string) => ({
    meta: { digest: '', snapshotId: '', schemaVersion: '1.0.0', generatedAtIso: '2026-08-04T12:00:00Z' },
    geometry: { modules: [{ id: 'm1' }] },
    permitReadiness: {
      registry: [{
        code: 'SOME-REQUIREMENT',
        payload: {
          lastResolutionAttempt: instant,
          resolutionEvidence: [{ atIso: instant, source: 'x' }],
        },
      }],
    },
    resolutionAuthority: {
      structuralDocumentRetrieval: { startedAtIso: instant, attempts: [{ retrievedAtIso: instant }] },
      framingRetrieval: { attemptedAtIso: instant },
    },
  }) as unknown as Record<string, unknown>;

  it('two builds of the same design at different instants have the SAME digest', () => {
    const a = computeSnapshotDigest(snapAt('2026-08-04T19:38:52.410Z'));
    const b = computeSnapshotDigest(snapAt('2026-08-04T19:39:11.046Z'));
    expect(a).toBe(b);
  });

  it('a real DESIGN change still moves the digest', () => {
    const base = snapAt('2026-08-04T19:38:52.410Z');
    const changed = { ...clone(base), geometry: { modules: [{ id: 'm1' }, { id: 'm2' }] } };
    expect(computeSnapshotDigest(changed)).not.toBe(computeSnapshotDigest(base));
  });

  it('a null run-instant stays null — absence is not collapsed into a value', () => {
    const withNull = snapAt('2026-08-04T19:38:52.410Z');
    const ra = (withNull.resolutionAuthority as Record<string, Record<string, unknown>>);
    ra.framingRetrieval.attemptedAtIso = null;
    // Distinguishable from the populated case: null ≠ sentinel.
    expect(computeSnapshotDigest(withNull)).not.toBe(computeSnapshotDigest(snapAt('2026-08-04T19:38:52.410Z')));
  });

  it('the LIVE regeneration is deterministic end-to-end (the actual defect)', () => {
    // The live Braidon package produced a different digest on every single
    // regeneration — measured, two consecutive runs, 30 leaf diffs and every one
    // a resolution-attempt timestamp. That made the digest-bound PE approval
    // unusable: approve digest D, regenerate, the approval is "stale".
    const build = () => {
      const input = clone(braidonOriginalAuditFixture) as unknown as Record<string, unknown>;
      input.generatedAtIso = '2026-08-04T12:00:00Z';
      generatePermitHTML(input as never);
      return (input as unknown as { _snapshot: PermitDesignSnapshot })._snapshot.meta.digest;
    };
    expect(build()).toBe(build());
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §1 — A RESOLVER'S CLEARANCE MUST REACH THE RECORD THE GATE READS
// ═══════════════════════════════════════════════════════════════════════════

describe('MCC §1 · registry records carry the lifecycle clearance', () => {
  /** Build with a synthetic resolution state for one requirement code. */
  const buildWith = (states: Record<string, unknown> | null): PermitDesignSnapshot => {
    const input = clone(braidonOriginalAuditFixture) as unknown as Record<string, unknown>;
    input.generatedAtIso = '2026-08-04T12:00:00Z';
    generatePermitHTML(input as never, undefined,
      states ? ({ resolution: { states } } as never) : undefined);
    return (input as unknown as { _snapshot: PermitDesignSnapshot })._snapshot;
  };

  const stateFor = (over: Record<string, unknown>) => ({
    requirementCode: 'MODULE-EXACT-DATASHEET-PENDING',
    resolutionMode: 'AUTO_DERIVED', residualMode: null,
    resolverId: 'module-datasheet-binding@v1', resolverImplemented: true,
    plannedResolverPhase: null, attemptedResolverIds: ['module-datasheet-binding@v1'],
    requiredInputs: [], resolutionEvidence: [], confidence: 1,
    blockingReason: null, reasons: [], retryability: 'NON_RETRYABLE',
    lastResolutionAttempt: '2026-08-04T12:00:00Z', lastResolutionResult: 'RESOLVED',
    cleared: false, resolutionAuditRef: null, ...over,
  });

  const entry = (s: PermitDesignSnapshot) =>
    s.permitReadiness.registry.find(r => r.code === 'MODULE-EXACT-DATASHEET-PENDING');

  it('with no lifecycle the record is unresolved — unchanged behaviour', () => {
    const e = entry(buildWith(null));
    expect(e?.resolved).toBe(false);
    expect(e?.resolutionAuditRef).toBeNull();
  });

  it('cleared WITH an audit reference marks the record resolved and drops the blocker', () => {
    const snap = buildWith({
      'MODULE-EXACT-DATASHEET-PENDING': stateFor({
        cleared: true, resolutionAuditRef: 'AAC-RESOLVER:module-datasheet-binding@v1 document:doc-1 @2026-08-04T12:00:00Z',
      }),
    });
    const e = entry(snap);
    expect(e?.resolved).toBe(true);
    expect(e?.resolutionAuditRef).toMatch(/module-datasheet-binding@v1/);
    expect(snap.permitReadiness.blockers.map(b => b.code)).not.toContain('MODULE-EXACT-DATASHEET-PENDING');
  });

  it('cleared WITHOUT an audit reference is NOT a clearance (fail closed)', () => {
    // Same two-part predicate deriveRequirementStatus applies, so the registry
    // can never claim a resolution the release gate would reject.
    for (const ref of [null, '', '   ']) {
      const e = entry(buildWith({
        'MODULE-EXACT-DATASHEET-PENDING': stateFor({ cleared: true, resolutionAuditRef: ref }),
      }));
      expect(e?.resolved).toBe(false);
      expect(e?.resolutionAuditRef).toBeNull();
    }
  });

  it('an audit reference WITHOUT cleared is not a clearance either', () => {
    const e = entry(buildWith({
      'MODULE-EXACT-DATASHEET-PENDING': stateFor({ cleared: false, resolutionAuditRef: 'AAC-RESOLVER:x @t' }),
    }));
    expect(e?.resolved).toBe(false);
  });

  it('a clearance cannot release the PROFESSIONAL review requirement', () => {
    // Guarding the previous phase: no resolver may stand in for a licensed
    // approval. ENGINEERING-REVIEW-PENDING is decided by decideReviewCoverage.
    const snap = buildWith({
      'ENGINEERING-REVIEW-PENDING': stateFor({
        requirementCode: 'ENGINEERING-REVIEW-PENDING',
        cleared: true, resolutionAuditRef: 'AAC-RESOLVER:not-a-pe @t',
      }),
    });
    expect(snap.certification.engineeringReviewApproved).toBe(false);
    expect(snap.projectAuthority.issueState).toBe('PENDING ENGINEERING REVIEW');
    expect(snap.projectAuthority.issuedForPermitGate.pass).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §3 / §4 — THE PROJECT LEGAL AUTHORITY RECORD
// ═══════════════════════════════════════════════════════════════════════════

const IDENTITY = (over: Partial<RetrievedPropertyIdentity> = {}): RetrievedPropertyIdentity => ({
  normalizedAddress: '3 MELVIN DR, GRANITE CITY, IL, 62040',
  county: 'Madison County', stateFips: '17', countyFips: '17119', censusTract: null,
  parcelId: null, ownerName: null,
  incorporatedPlace: null, countySubdivision: 'Nameoki township', unincorporated: true,
  boundaryLayersResolved: true,
  boundaryEvidence: 'US Census Geocoder returned NO incorporated place, only the minor civil division "Nameoki township"',
  lat: 38.7061678, lng: -90.0461651,
  providerUsed: 'census_geocoder', sourcesQueried: ['census'], proof: 'live-retrieval',
  ...over,
} as RetrievedPropertyIdentity);

const POSTED = (over: Record<string, string | null> = {}) => ({
  address: '3 Melvin Dr Apt A, Granite City, IL 62040',
  city: 'GRANITE CITY', county: 'Madison', stateCode: 'IL',
  apn: '17-2-20-13-04-401-003',
  ahjName: 'City of Granite City Building & Zoning',
  ...over,
});

const COUNTY_AHJ = { ahjId: 'il-madison-county', ahjName: 'Madison County Building & Zoning', ahjType: 'county' } as never;
const CITY_AHJ = { ahjId: 'il-madison-granite-city', ahjName: 'City of Granite City Building & Zoning', ahjType: 'city' } as never;

const build = (over: Record<string, unknown> = {}) => buildProjectLegalAuthority({
  identity: IDENTITY(), posted: POSTED(), ahjRecord: COUNTY_AHJ,
  confidence: 1, resolverId: 'project-authority@v1', ...over,
} as never);

describe('MCC §3 · the AHJ name comes from the source that decided the AHJ type', () => {
  it('a bound COUNTY record supersedes a posted mailing-city AHJ on an unincorporated parcel', () => {
    // THE DEFECT: the consistency guard read `ahjType` from the BOUND record
    // ('county') while the printed name came from `posted` ('City of…'), so the
    // city-vs-unincorporated branch could not fire and the wrong name was
    // stamped VERIFIED — under a basis sentence that simultaneously said the
    // parcel is unincorporated and the county is the authority of record.
    const rec = build();
    expect(rec.fields.ahjName.value).toBe('Madison County Building & Zoning');
    expect(rec.fields.ahjName.state).toBe('verified');
    expect(rec.fields.ahjName.postedValue).toBe('City of Granite City Building & Zoning');
    expect(rec.fields.ahjName.basis).toMatch(/supersedes/);
    expect(rec.fields.fireAuthority.value).toBe('Madison County Building & Zoning');
  });

  it('a CITY record on an unincorporated parcel still raises the conflict, never a silent flip', () => {
    const rec = build({ ahjRecord: CITY_AHJ });
    expect(rec.fields.ahjName.state).toBe('unverified-derived');
    expect(rec.verified).toBe(false);
    expect(rec.confirmationRequired.join(' ')).toMatch(/OUTSIDE any incorporated municipality/);
  });

  it('with the boundary UNRESOLVED the posted value still stands, unverified', () => {
    const rec = build({ identity: IDENTITY({ boundaryLayersResolved: false, boundaryEvidence: null }) });
    expect(rec.fields.ahjName.value).toBe('City of Granite City Building & Zoning');
    expect(rec.fields.ahjName.state).toBe('unverified-derived');
  });

  it('with no bound record the posted value stands — nothing is invented', () => {
    const rec = build({ ahjRecord: null });
    expect(rec.fields.ahjName.value).toBe('City of Granite City Building & Zoning');
  });
});

describe('MCC §4 · a machine-retrieved APN is not graded as a keystroke', () => {
  const CCAO = { apn: '17-2-20-13-04-401-003', source: 'Madison County IL CCAO' };

  it('with NO parcel retrieval the posted APN stays unverified — unchanged behaviour', () => {
    const rec = build();
    expect(rec.fields.apn.state).toBe('unverified-derived');
    expect(rec.verified).toBe(false);
  });

  it('a county-GIS retrieval that AGREES with the record verifies the APN, attributed to that layer', () => {
    const rec = build({ parcelRetrieval: CCAO });
    expect(rec.fields.apn.state).toBe('verified');
    expect(rec.fields.apn.value).toBe('17-2-20-13-04-401-003');
    expect(rec.fields.apn.source).toBe('Madison County IL CCAO');   // never 'census_geocoder'
    expect(rec.fields.apn.basis).toMatch(/Madison County IL CCAO/);
    expect(rec.verified).toBe(true);
  });

  it('a retrieval that CONTRADICTS the record is a conflict, not a silent flip', () => {
    const rec = build({ parcelRetrieval: { ...CCAO, apn: '99-9-99-99-99-999-999' } });
    expect(rec.verified).toBe(false);
    expect(rec.confirmationRequired.join(' ')).toMatch(/the engine may not pick one/);
    expect(rec.fields.apn.state).not.toBe('verified');
  });

  it('a retrieval with no named source cannot verify anything', () => {
    const rec = build({ parcelRetrieval: { apn: CCAO.apn, source: null } });
    expect(rec.fields.apn.state).toBe('unverified-derived');
  });

  it('ATTOM (identity.parcelId) still wins and keeps its own attribution', () => {
    const rec = build({
      identity: IDENTITY({ parcelId: '17-2-20-13-04-401-003', providerUsed: 'attom' }),
      parcelRetrieval: CCAO,
    });
    expect(rec.fields.apn.source).toBe('attom');
  });

  it('a retrieval verifies an APN the project record does not carry at all', () => {
    const rec = build({ posted: POSTED({ apn: null }), parcelRetrieval: CCAO });
    expect(rec.fields.apn.state).toBe('verified');
    expect(rec.fields.apn.value).toBe('17-2-20-13-04-401-003');
  });
});
