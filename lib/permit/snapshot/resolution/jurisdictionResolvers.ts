// ═══════════════════════════════════════════════════════════════════════════
// AAC WS-3 + WS-4 — THE THREE RETRIEVAL RESOLVERS
//   project-authority@v1            (WS-3, AUTO_RETRIEVED)
//   code-authority@v1               (WS-3, AUTO_RETRIEVED)
//   environmental-load-authority@v1 (WS-4, AUTO_RETRIEVED)
//
// Each performs REAL retrieval through an injected provider. None is a
// placeholder that always returns unresolved. Each:
//   • records the EXACT source queried and, on failure, the EXACT failure plus
//     the minimal operator action (an env var where that is genuinely the fix);
//   • writes an audit reference ONLY when it actually established the authority
//     (the deriveRequirementStatus contract — no ref ⇒ the requirement stays OPEN);
//   • escalates a GENUINE source disagreement to OPERATOR_CONFIRMATION with both
//     sources shown, and never picks;
//   • declares the dependents it invalidates so the lifecycle recomputes them.
// ═══════════════════════════════════════════════════════════════════════════

import { resolveAhjRecord } from '../codeAuthority';
import { environmentalCoordinatesCover } from '../environmentalAuthority';
import { createDocument } from '@/lib/documents/registry';
import { retryabilityFor } from '@/lib/providers/types';
import { normalizeRiskCategory, type AsceEdition } from '@/lib/providers/climateHazard/types';
import { AHJ_REGISTRY_ENDPOINT, AHJ_REGISTRY_TOKEN_ACTION } from '@/lib/jurisdictions/ahjRegistry';
import { upsertAhjRegistryRow } from '@/lib/jurisdictions/internalAhjRegistry';
import type {
  RequirementResolver, ResolverContext, ResolverOutcome, ResolutionInvalidation,
  LegalJurisdictionAuthority,
} from './types';
import { buildResolutionAuditRef } from './evidence';
import { materialRetrievalReason } from './authorityProjection';
// OAR — accepted authority outlives a failed refresh.
import {
  readRetainedLegalAuthority, isRefreshOutage, sameLegalAuthority,
  type LegalAuthorityRetentionState,
} from './retainedAuthority';
import {
  buildProjectLegalAuthority, buildCodeAdoptionAuthority, missingAdoptionEditions,
} from './jurisdictionAuthority';
import {
  buildEnvironmentalRetrievalRecord, toEnvironmentalSourceEvidence, toRegistryClaims,
  archivalDocumentId, resolveRiskCategory,
  type OperatorEnvironmentalOverride, type PostedEnvironmentalProvenance,
} from './environmentalRetrieval';

/** The ASCE edition the structural engine runs under. Single-sourced with
 *  build.ts:774 (`ASCE 7-22`) — the hazard values MUST come from the same
 *  edition the calculation cites, so this constant is deliberately shared. */
export const STRUCTURAL_ASCE_EDITION: AsceEdition = '7-22';

/** ASCE 7 §11.4.3 default site class when no geotechnical investigation exists.
 *  Recorded on the record as a query input, never presented as measured. */
export const DEFAULT_SITE_CLASS = 'D';

const proj = (ctx: ResolverContext) => (ctx.input.project ?? {}) as Record<string, any>;

const str = (v: unknown): string | null => {
  const s = (v ?? '').toString().trim();
  return s ? s : null;
};
const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const POSTED_PROVENANCES: PostedEnvironmentalProvenance[] =
  ['operator-entered', 'ahj-published', 'unprovenanced-table', 'engine-default', 'absent'];

/** Read the route's provenance stamp for a posted environmental value. An
 *  UNSTAMPED body (a harness, a saved permit_input.json from before the stamp
 *  existed) keeps the historical reading: a present value is operator-entered.
 *  It is never upgraded to an authority it cannot demonstrate. */
function asPostedProvenance(stamp: string | undefined, value: number | null): PostedEnvironmentalProvenance {
  if (value == null) return 'absent';
  const s = (stamp ?? '') as PostedEnvironmentalProvenance;
  return POSTED_PROVENANCES.includes(s) ? s : 'operator-entered';
}

// ═══════════════════════════════════════════════════════════════════════════
// WS-3 §1 — PROJECT LEGAL AUTHORITY
// ───────────────────────────────────────────────────────────────────────────
// Audit §2.2: the ATTOM → Census → Nominatim chain already existed and the
// permit path never called it, so PROJECT-AUTHORITY-UNVERIFIED fired from the
// literal `false` at build.ts:1024. This is that call.
//
// It does NOT overwrite the project's lat/lng. The aerial pipeline deliberately
// owns those (the 2026-06-30 "aerial-correct-house" ruling: the stored geocode
// was one house off and was corrected downstream). The retrieved coordinates are
// recorded on the authority record as the geocoder's own answer and are used
// only as a FALLBACK when the project carries none.
// ═══════════════════════════════════════════════════════════════════════════

export const projectAuthorityResolver: RequirementResolver = {
  id: 'project-authority@v1',
  mode: 'AUTO_RETRIEVED',
  requirementCodes: ['PROJECT-AUTHORITY-UNVERIFIED'],
  requiredInputs: [],
  // ── D4 LIFECYCLE — DECLARE WHAT YOU PATCH, OR THE LIFECYCLE DROPS IT ─────
  // `legalJurisdiction` was computed here and placed in the outcome patch, but
  // it was NOT declared. lifecycle.ts copies only declared keys:
  //     for (const k of r.produces) { if (!(k in outcome.patch)) continue; … }
  // so the verified boundary determination was discarded on every run, silently,
  // and the bundle kept the DERIVED value from project-authority-key@v1. Because
  // the archival gate requires 'verified', no document could ever be archived
  // under the correct authority.
  //
  // The failure paths below (no provider, retrieval failed) deliberately do NOT
  // patch this key. Omitting it leaves the derived value in place — which is the
  // honest posture, since this resolver could not determine a boundary. Patching
  // `null` there would destroy a usable (if unverified) authority and leave the
  // name-comparison fallback with nothing to compare.
  produces: ['projectLegalAuthority', 'legalJurisdiction'],
  description: 'Retrieves the project\'s legal identity (normalised address, parcel/APN, county + FIPS, municipal boundary) from an official source, establishes the per-field verification states, and publishes the CANONICAL legal jurisdiction authority.',
  async run(ctx: ResolverContext): Promise<ResolverOutcome> {
    const p = proj(ctx);
    const provider = ctx.providers.propertyIdentity ?? null;
    const posted = {
      address: str(p.address), city: str(p.city), county: str(p.county),
      stateCode: str(p.state), apn: str(p.apn), ahjName: str(p.ahjName) ?? str((ctx.input.compliance?.jurisdiction as any)?.ahj),
    };
    // ── OAR — WHAT THIS PROJECT ALREADY ACCEPTED ────────────────────────────
    // Read BEFORE the provider is called, so a refresh that cannot complete has
    // something governed to fall back to. Null unless the last governed run
    // accepted a VERIFIED jurisdiction carrying a stable ahjRecordId — retention
    // never promotes an unverified record (D4).
    const retained = readRetainedLegalAuthority(ctx.input);
    const inputsRecorded: Record<string, string | number | boolean | null> = {
      postedAddress: posted.address, postedCity: posted.city, postedCounty: posted.county,
      postedState: posted.stateCode, postedApn: posted.apn, postedAhjName: posted.ahjName,
      providerInjected: !!provider,
      retainedAuthorityId: retained?.jurisdiction.ahjRecordId ?? null,
    };

    /** Carry the accepted authority forward unchanged and say why. The
     *  requirement stays CLOSED because the authority is established — what
     *  failed was a refresh, and a refresh is not the authority. */
    const retainOutcome = (
      state: LegalAuthorityRetentionState,
      r: NonNullable<typeof retained>,
      attemptFailure: string | null,
      sourceQueried: string | null,
      retryability: 'RETRYABLE' | 'REQUIRES_INPUT' | 'NON_RETRYABLE',
    ): ResolverOutcome => {
      // The project record is restored from the accepted authority too, so the
      // SHEETS keep naming the governing jurisdiction rather than reverting to
      // the mailing city the posted record carries.
      p.ahjName = r.jurisdiction.ahjName ?? p.ahjName;
      p.ahjRecordId = r.jurisdiction.ahjRecordId ?? p.ahjRecordId;
      return {
        result: 'RESOLVED',
        clearance: { cleared: true, missing: [], reasons: [] },
        patch: { projectLegalAuthority: r.record, legalJurisdiction: r.jurisdiction },
        sourceQueried,
        sourceRefs: r.jurisdiction.provenance?.ref ? [r.jurisdiction.provenance.ref] : [],
        retryability,
        // OPERATIONAL only — it never reaches the digested reason (TR §3b).
        failureReason: attemptFailure,
        operatorAction: null,
        confidence: null,
        // The audit reference names the RETAINED evidence, not this run's
        // attempt: what clears the requirement is the governed determination
        // that is still standing, and the reference must point at it.
        auditRef: buildResolutionAuditRef({
          resolverId: 'project-authority@v1',
          sourceRefs: [r.jurisdiction.provenance?.ref ?? `authority:ahj#${r.jurisdiction.ahjRecordId}`],
          atIso: ctx.nowIso,
        }),
        inputsRecorded: { ...inputsRecorded, retentionState: state },
      };
    };

    if (!provider) {
      // A provider that is ABSENT is not an outage — but it is equally not a
      // finding about the parcel, and an authority already accepted stands.
      if (retained) {
        return retainOutcome('REFRESH_FAILED_RETAINED', retained,
          'PROVIDER-NOT-INJECTED: the property-identity provider bag is empty for this run; the accepted legal authority was retained.',
          null, 'RETRYABLE');
      }
      return {
        result: 'SKIPPED',
        clearance: { cleared: false, missing: ['a property-identity provider'], reasons: ['PROVIDER-NOT-INJECTED: no property-identity provider is available to this run — the legal identity was NOT retrieved, and this is not a finding about the project'] },
        sourceQueried: null,
        retryability: 'RETRYABLE',
        failureReason: 'PROVIDER-NOT-INJECTED: the property-identity provider bag is empty for this run.',
        confidence: null,
        inputsRecorded: { ...inputsRecorded, retentionState: 'NO_RETAINED_AUTHORITY' },
      };
    }

    const res = await provider.getPropertyIdentity({
      addressLine1: posted.address, city: posted.city, state: posted.stateCode,
      zip: str(p.zip), lat: num(p.lat), lng: num(p.lng),
    });

    if (!res.ok) {
      // ── OAR — A TRANSPORT FAILURE DOES NOT UNMAKE A DETERMINATION ─────────
      // Measured before this guard existed: forcing Census to time out flipped
      // the accepted authority from "Madison County Building & Zoning
      // [verified]" to "City of Granite City Building & Zoning [unverified]" —
      // the MAILING city seeded by project-authority-key@v1 — reopened
      // PROJECT-AUTHORITY-UNVERIFIED, re-stamped the rendered sheets and blocked
      // document archival, all from a one-second outage.
      //
      // Retention is deliberately NOT applied to NO_COVERAGE or AMBIGUOUS: those
      // are the source ANSWERING about this parcel, and masking a real "this is
      // no longer that jurisdiction" as an outage is the failure mode this must
      // never introduce. See `isRefreshOutage`.
      if (retained && isRefreshOutage(res.failureKind)) {
        return retainOutcome('REFRESH_FAILED_RETAINED', retained, res.failure,
          res.sourcesQueried.join(' · ') || provider.name,
          retryabilityFor(res.failureKind));
      }
      return {
        result: 'FAILED',
        clearance: {
          cleared: false,
          missing: ['an official-source match for the installation address'],
          // ── TR — A TRANSPORT FAILURE IS NOT A FACT ABOUT THIS PARCEL ───────
          // `reasons` reaches `blockingReason` → the registry payload → the
          // DESIGN DIGEST. Interpolating the provider's failure string here made
          // two different wordings of the SAME temporary Census outage produce
          // two different digests for one unchanged design (found live: three of
          // twenty read-only runs). But the SAME string also carries genuine
          // answers about this site — NO_COVERAGE, AMBIGUOUS — so it is split by
          // KIND, not thrown away. The exact provider text, the endpoints queried
          // and the retryability are preserved either way on `failureReason` /
          // `sourceQueried` / `retryability`, which land in
          // `snapshot.resolverAttemptEvidence` — outside the digest.
          reasons: [materialRetrievalReason({
            failureKind: res.failureKind,
            providerFailure: `${provider.name}: ${res.failure}`,
            whenOperational: 'the project LEGAL identity is NOT ESTABLISHED — no official-source match for the installation address was retrieved',
          })],
        },
        sourceQueried: res.sourcesQueried.join(' · ') || provider.name,
        sourceRefs: res.sourcesQueried.map(u => `provenance:${u}`),
        retryability: retryabilityFor(res.failureKind),
        failureReason: res.failure,
        operatorAction: res.operatorAction,
        confidence: 0,
        auditRef: null,
        inputsRecorded: {
          ...inputsRecorded,
          // NO_COVERAGE / AMBIGUOUS reach here even when a retained authority
          // exists: the source ANSWERED, so this is a finding about the parcel,
          // not an outage, and it is surfaced rather than absorbed.
          retentionState: retained ? 'AUTHORITY_CONFLICT' : 'NO_RETAINED_AUTHORITY',
        },
      };
    }

    // KDP WS-12 — resolve the AHJ record UNDER the boundary determination this
    // retrieval just produced. `res.value` carries the official incorporated /
    // unincorporated finding, so the record is DERIVED from the evidence rather
    // than guessed from geography and then audited against it. Without this the
    // municipal-first hint chain could bind a city record to a parcel the Census
    // place layer puts outside every municipality — which the reconciliation
    // below would then (correctly) raise as a conflict requiring an operator.
    const ahjRecord = resolveAhjRecord({
      ahjRecordId: str(p.ahjRecordId) ?? str(p.ahjId),
      stateCode: posted.stateCode, county: posted.county, city: posted.city, address: posted.address,
      boundary: {
        resolved: res.value.boundaryLayersResolved === true,
        unincorporated: res.value.unincorporated,
        incorporatedPlace: res.value.incorporatedPlace,
      },
    });
    // MCC §4 — the county-GIS parcel retrieval the permit pipeline already
    // performed (lib/aerial/parcelBoundary.ts → aerialData.parcel). It carries
    // the publishing layer in `source`; route.ts copies only the bare `apn`
    // onto project.apn, so without this the retrieval reaches the grader
    // stripped of its provenance and is graded as if it were typed in.
    const _parcel = (ctx.input as { aerialData?: { parcel?: { apn?: string | null; source?: string | null } } })
      ?.aerialData?.parcel ?? null;
    const parcelRetrieval = _parcel?.apn
      ? { apn: String(_parcel.apn), source: _parcel.source ? String(_parcel.source) : null }
      : null;
    const record = buildProjectLegalAuthority({
      identity: res.value, posted, ahjRecord, confidence: res.confidence, resolverId: 'project-authority@v1',
      parcelRetrieval,
    });

    // PROPAGATION — fill the project record from the retrieval where it was
    // EMPTY. An existing value is never silently overwritten; a disagreement is
    // already recorded as confirmationRequired above.
    const propagated: string[] = [];
    if (!posted.county && record.normalized.county) { p.county = record.normalized.county; propagated.push('county'); }
    if (!posted.apn && record.fields.apn.state === 'verified' && record.fields.apn.value) { p.apn = record.fields.apn.value; propagated.push('apn'); }
    if (num(p.lat) == null && record.normalized.lat != null) { p.lat = record.normalized.lat; propagated.push('lat'); }
    if (num(p.lng) == null && record.normalized.lng != null) { p.lng = record.normalized.lng; propagated.push('lng'); }
    // KDP WS-12 — a STALE AHJ NAME beside a live boundary determination.
    //
    // The project record is enriched with an AHJ name derived from the MAILING
    // address, and a mailing city is not a jurisdiction: the live Census
    // determination for the Braidon parcel returns no incorporated place at all
    // (minor civil division "Nameoki township"), so Madison County is the AHJ of
    // record — while `project.ahjName` still said "City of Granite City Building
    // & Zoning". Both values then travelled through the package: one on the
    // project record, the other on the code authority.
    //
    // This is NOT the "never overwrite an operator value" case. The stored name
    // is a machine enrichment, the boundary determination is official evidence
    // for the same field, and the ahjName reconciliation above already raises a
    // genuine city-vs-county disagreement as confirmationRequired. So where the
    // boundary layer resolved AND the bound record disagrees with the stored
    // name, the record wins and the correction is recorded rather than silent.
    if (record.fields.municipalBoundary.state === 'verified' && ahjRecord?.ahjName) {
      const _stored = str(p.ahjName);
      const _n = (x: string) => x.trim().toLowerCase().replace(/\s+/g, ' ');
      if (_stored && _n(_stored) !== _n(ahjRecord.ahjName)) {
        p.ahjName = ahjRecord.ahjName;
        p.ahjRecordId = ahjRecord.id;
        propagated.push(`ahjName (superseded "${_stored}" — ${record.boundaryEvidence})`);
      } else if (!_stored) {
        p.ahjName = ahjRecord.ahjName; p.ahjRecordId = ahjRecord.id; propagated.push('ahjName');
      }
    }

    // ── D4 — PUBLISH THE CANONICAL LEGAL JURISDICTION ONTO THE BUNDLE ───────
    // This resolver has always KNOWN the legal AHJ — it corrects `p.ahjName` and
    // `p.ahjRecordId` a few lines above. What it never did was put that answer
    // where a downstream document resolver could reach it: it patched only
    // `projectLegalAuthority`, while `authority.projectJurisdiction` kept the
    // posted, mailing-derived value frozen by `project-authority-key@v1`. The
    // lifecycle stabilises in one iteration, so the correction never propagated,
    // and every manufacturer document was stamped with the mailing city.
    //
    // `verificationState` is deliberately conservative: only a VERIFIED municipal
    // boundary may stamp a document. Anything else and the document resolver
    // refuses rather than guessing — see structuralResolvers.
    const _legalVerified = record.fields.municipalBoundary.state === 'verified'
      && record.fields.ahjName.state === 'verified';
    const legalJurisdiction: LegalJurisdictionAuthority = {
      ahjRecordId: str(p.ahjRecordId) ?? ahjRecord?.id ?? null,
      ahjName: str(p.ahjName) ?? ahjRecord?.ahjName ?? null,
      jurisdictionType: (ahjRecord?.ahjType as LegalJurisdictionAuthority['jurisdictionType']) ?? null,
      stateCode: str(p.state) ?? record.normalized.stateFips ?? null,
      county: record.normalized.county ?? str(p.county) ?? null,
      unincorporated: record.unincorporated,
      // The MAILING city stays a first-class, separately-named fact so address
      // display never has to reach for the legal name.
      mailingCity: posted.city ?? str(p.city) ?? null,
      provenance: {
        source: 'project-authority@v1',
        ref: `authority:project-legal#${record.sourceHash.slice(0, 16)}`,
        basis: record.boundaryEvidence,
      },
      verificationState: record.confirmationRequired.length
        ? 'conflict'
        : (_legalVerified ? 'verified' : 'unverified'),
    };

    const refs = [
      `authority:project-legal#${record.sourceHash.slice(0, 16)}`,
      ...res.sourcesQueried.map(u => `provenance:${u}`),
      `sha256:${record.sourceHash.slice(0, 16)}`,
    ];
    const invalidations: ResolutionInvalidation[] = propagated.length
      ? [{ scope: 'snapshot', target: `projectAuthority + codeAuthority (county/APN propagated: ${propagated.join(', ')})`, reason: 'the project legal identity was established from an official source', invalidatedBy: 'project-authority@v1', atIso: ctx.nowIso }]
      : [];

    // ── OAR — CLASSIFY THE REFRESH AGAINST WHAT WAS ALREADY ACCEPTED ─────────
    // A completed refresh is the governed path by which authority may change, so
    // nothing here blocks a change — it names it. Same authority ⇒ nothing moves.
    // A different VERIFIED determination supersedes (the digest moves and D11
    // handles the approval). A refresh that is NOT itself verified must never
    // quietly displace one that was: that is surfaced as a conflict below.
    const _refreshVerified = legalJurisdiction.verificationState === 'verified'
      && !!legalJurisdiction.ahjRecordId;
    const retentionState: LegalAuthorityRetentionState = !retained
      ? 'NO_RETAINED_AUTHORITY'
      : sameLegalAuthority(retained.jurisdiction, legalJurisdiction)
        ? 'REFRESH_SUCCEEDED_SAME_AUTHORITY'
        : (_refreshVerified ? 'REFRESH_SUCCEEDED_CHANGED_AUTHORITY' : 'AUTHORITY_CONFLICT');

    const recorded = {
      ...inputsRecorded,
      providerUsed: record.providerUsed,
      normalizedAddress: record.normalized.address,
      retrievedCounty: record.normalized.county,
      countyFips: record.normalized.countyFips,
      incorporatedPlace: record.normalized.incorporatedPlace,
      unincorporated: record.unincorporated,
      propagatedFields: propagated.join(', ') || null,
      retentionState,
    } as Record<string, string | number | boolean | null>;

    // ── OAR — AN UNGOVERNED REFRESH MAY NOT DISPLACE A GOVERNED AUTHORITY ────
    // The refresh completed but did not establish a verified determination, and
    // it names a different jurisdiction from the one this project accepted.
    // Neither side is adopted: the accepted identity is KEPT (so no document is
    // stamped from a guess and the sheets do not silently change jurisdiction)
    // and the state is recorded as a conflict, which is material and leaves the
    // requirement open for an operator.
    if (retained && retentionState === 'AUTHORITY_CONFLICT') {
      const conflictReason =
        `the accepted legal authority for this project is '${retained.jurisdiction.ahjName}' `
        + `(${retained.jurisdiction.ahjRecordId}), and this refresh returned `
        + `'${legalJurisdiction.ahjName ?? 'an unnamed authority'}' at verification state `
        + `'${legalJurisdiction.verificationState}'. Neither is adopted automatically — an operator must determine `
        + 'which authority governs this parcel.';
      return {
        result: 'FAILED',
        clearance: { cleared: false, missing: ['an operator determination of the governing legal authority'], reasons: [conflictReason] },
        patch: {
          projectLegalAuthority: record,
          legalJurisdiction: { ...retained.jurisdiction, verificationState: 'conflict' },
        },
        sourceQueried: res.sourcesQueried.join(' · '),
        sourceRefs: refs,
        retryability: 'REQUIRES_INPUT',
        failureReason: conflictReason,
        operatorAction: 'Confirm the governing legal authority for this parcel in the project record, then regenerate.',
        confidence: record.confidence,
        auditRef: null,
        inputsRecorded: recorded,
      };
    }

    // GENUINE AMBIGUITY ⇒ OPERATOR_CONFIRMATION, never an engine choice.
    if (record.confirmationRequired.length) {
      return {
        result: 'FAILED',
        clearance: { cleared: false, missing: record.confirmationRequired, reasons: record.confirmationRequired },
        patch: { projectLegalAuthority: record, legalJurisdiction },
        sourceQueried: res.sourcesQueried.join(' · '),
        sourceRefs: refs,
        retryability: 'REQUIRES_INPUT',
        failureReason: `boundary / jurisdiction conflict: ${record.confirmationRequired.join(' · ')}`,
        operatorAction: 'Confirm the governing jurisdiction for this parcel — both the official boundary determination and the project record\'s value are shown above.',
        confidence: record.confidence,
        auditRef: null,
        invalidations,
        inputsRecorded: recorded,
      };
    }

    if (!record.verified) {
      const unverified = Object.entries(record.fields)
        .filter(([, f]) => f.state === 'unverified-derived')
        .map(([k, f]) => `${k}: ${f.basis}`);
      return {
        result: 'FAILED',
        clearance: { cleared: false, missing: unverified, reasons: unverified },
        patch: { projectLegalAuthority: record, legalJurisdiction },
        sourceQueried: res.sourcesQueried.join(' · '),
        sourceRefs: refs,
        retryability: 'RETRYABLE',
        failureReason: `the retrieval did not verify every legal-identity field: ${unverified.join(' · ')}`,
        operatorAction: record.fields.apn.state === 'unverified-derived'
          ? 'Set ATTOM_API_KEY so the parcel/APN can be confirmed against the assessor record, then regenerate.'
          : null,
        confidence: record.confidence,
        auditRef: null,
        invalidations,
        inputsRecorded: recorded,
      };
    }

    return {
      result: 'RESOLVED',
      clearance: { cleared: true, missing: [], reasons: [] },
      patch: { projectLegalAuthority: record, legalJurisdiction },
      sourceQueried: res.sourcesQueried.join(' · '),
      sourceRefs: refs,
      retryability: 'NON_RETRYABLE',
      failureReason: null,
      confidence: record.confidence,
      auditRef: buildResolutionAuditRef({ resolverId: 'project-authority@v1', sourceRefs: refs, atIso: ctx.nowIso }),
      invalidations,
      inputsRecorded: recorded,
    };
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// WS-3 §2 — CODE ADOPTION AUTHORITY
// ───────────────────────────────────────────────────────────────────────────
// Audit §2.1 / §7.5: the registry response ALREADY carried BuildingCode,
// ResidentialCode and FireCode and the mapper discarded them. Fixed in
// ahjRegistry.ts; this resolver consumes them.
//
// THE UTILITY IS NEVER ADMITTED. `project.utilityName` is not read here and
// cannot influence the outcome: which utility serves the meter says nothing
// about which building code the jurisdiction enforces.
// ═══════════════════════════════════════════════════════════════════════════

export const codeAuthorityResolver: RequirementResolver = {
  id: 'code-authority@v1',
  mode: 'AUTO_RETRIEVED',
  requirementCodes: ['CODE-AUTHORITY-INCOMPLETE'],
  requiredInputs: ['projectLegalAuthority', 'projectJurisdiction'],
  produces: ['codeAdoptionAuthority'],
  description: 'Retrieves the adopted NEC / IBC / IRC / IFC editions, the permit office and the local amendments for the project\'s AHJ, corroborated against the curated record and escalated on disagreement.',
  async run(ctx: ResolverContext): Promise<ResolverOutcome> {
    const p = proj(ctx);
    const provider = ctx.providers.codeAdoption ?? null;
    const legal = ctx.authority.projectLegalAuthority ?? null;
    // Prefer the RETRIEVED coordinates/county where the legal resolver produced
    // them; fall back to the posted record.
    const lat = num(p.lat) ?? legal?.normalized.lat ?? null;
    const lng = num(p.lng) ?? legal?.normalized.lng ?? null;
    const county = legal?.normalized.county ?? str(p.county);
    const inputsRecorded: Record<string, string | number | boolean | null> = {
      lat, lng, county, city: str(p.city), stateCode: str(p.state),
      providerInjected: !!provider,
      providerConfigured: provider ? provider.isConfigured() : null,
      legalAuthorityVerified: legal?.verified ?? null,
    };

    if (!provider) {
      return {
        result: 'SKIPPED',
        clearance: { cleared: false, missing: ['a code-adoption provider'], reasons: ['PROVIDER-NOT-INJECTED: no code-adoption provider is available to this run — the adopted editions were NOT retrieved'] },
        sourceQueried: null,
        retryability: 'RETRYABLE',
        failureReason: 'PROVIDER-NOT-INJECTED: the code-adoption provider bag is empty for this run.',
        confidence: null,
        inputsRecorded,
      };
    }

    const res = await provider.getCodeAdoption({
      lat, lng, address: str(p.address), stateCode: str(p.state), county, city: str(p.city),
    });

    if (!res.ok) {
      // TAC WS-19 — RESEARCH ONCE, RETAIN CENTRALLY even on failure: the
      // central ahj_registry keeps (a) the curated in-code row for this
      // jurisdiction as 'seeded-unprovenanced' (documenting exactly which code
      // fields exist and which are missing — it can never clear anything) and
      // (b) an appended enrichment-attempt entry recording what was tried and
      // why it failed. Fail-soft: a missing table never blocks the run.
      const _corr = resolveAhjRecord({
        ahjRecordId: str(p.ahjRecordId) ?? str(p.ahjId),
        stateCode: str(p.state), county, city: str(p.city), address: str(p.address),
      });
      if (_corr) {
        await ctx.safeDbRead('ahjRegistry.retainSeed', () => upsertAhjRegistryRow({
          id: _corr.id,
          stateCode: _corr.stateCode, county: _corr.county || null, city: _corr.city || null,
          ahjName: _corr.ahjName, jurisdictionType: _corr.ahjType ?? 'unknown',
          editions: {
            nec: _corr.necVersion ?? null, ibc: _corr.ibcVersion ?? null,
            irc: _corr.ircVersion ?? null, ifc: _corr.ifcVersion ?? null,
          },
          provenance: 'seeded-unprovenanced',
          notes: 'Seeded from lib/jurisdictions/ahj-national.ts (' + (_corr.dataProvenance ?? 'curated')
            + ') — no ordinance, no effective date, no hash; may never establish an adopted edition.',
          enrichmentAttempt: {
            atIso: ctx.nowIso, source: provider.name,
            outcome: res.failureKind ?? 'FAILED', note: (res.failure ?? '').slice(0, 300),
          },
        }), null);
      }
      const ambiguous = res.failureKind === 'AMBIGUOUS';
      return {
        result: 'FAILED',
        clearance: {
          cleared: false,
          missing: ambiguous
            ? ['an operator determination of which overlapping authority governs this parcel']
            : ['an adopted-code retrieval carrying the IBC / IRC / IFC editions for this jurisdiction'],
          // TR — split by failure KIND (see project-authority). AMBIGUOUS names
          // BOTH overlapping authorities and their editions; that is a design
          // finding and must stay in the digest. A timeout must not.
          reasons: [materialRetrievalReason({
            failureKind: res.failureKind,
            providerFailure: res.failure,
            whenOperational: 'the adopted code editions are NOT ESTABLISHED — no adopted-code retrieval carrying the IBC / IRC / IFC editions was obtained for this jurisdiction',
          })],
        },
        sourceQueried: res.sourcesQueried.join(' · ') || AHJ_REGISTRY_ENDPOINT,
        sourceRefs: res.sourcesQueried.map(u => `provenance:${u}`),
        retryability: retryabilityFor(res.failureKind),
        failureReason: res.failure,
        operatorAction: res.operatorAction
          ?? (res.failureKind === 'NOT_CONFIGURED' ? AHJ_REGISTRY_TOKEN_ACTION : null),
        confidence: 0,
        auditRef: null,
        inputsRecorded,
      };
    }

    // The curated in-repo record — a CORROBORATOR ONLY (it has no ordinance, no
    // effective date and no hash, so it can never establish an edition alone).
    const corroborator = resolveAhjRecord({
      ahjRecordId: str(p.ahjRecordId) ?? str(p.ahjId),
      stateCode: str(p.state), county, city: str(p.city), address: str(p.address),
    });
    const record = buildCodeAdoptionAuthority({
      adoption: res.value.record,
      corroborator,
      asceEngineBasis: null,   // the structural engine supplies ASCE (build.ts)
      confidence: res.confidence,
      resolverId: 'code-authority@v1',
      proof: res.value.proof,
      fixtureProvenance: res.value.fixtureProvenance ?? null,
    });

    // TAC WS-19 — RESEARCH ONCE → RETAIN CENTRALLY: an ADMITTED external
    // retrieval (conflict checks below still gate what the SNAPSHOT accepts) is
    // persisted to SolarPro's own ahj_registry with its payload hash + source,
    // so the NEXT project in this jurisdiction resolves from the internal
    // registry without the external token. Internal-registry answers are not
    // re-written (they came from this table). Fail-soft.
    if (res.value.proof === 'live-retrieval') {
      const adopted = res.value.record;
      const _slug = (s: string | null | undefined): string =>
        (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const _rowId = corroborator?.id
        ?? `${(adopted.stateCode ?? 'xx').toLowerCase()}-${_slug(adopted.county) || 'x'}-${_slug(adopted.city) || _slug(adopted.ahjName) || 'ahj'}`;
      await ctx.safeDbRead('ahjRegistry.retainRetrieval', () => upsertAhjRegistryRow({
        id: _rowId,
        stateCode: adopted.stateCode ?? str(p.state) ?? 'XX',
        county: adopted.county, city: adopted.city,
        ahjName: adopted.ahjName, jurisdictionType: adopted.jurisdictionType,
        externalAhjId: adopted.ahjId ?? adopted.ahjCode ?? null,
        editions: { ...adopted.editions },
        rawEditions: adopted.rawEditions as unknown as Record<string, string | null>,
        localAmendments: record.localAmendments,
        effectiveDate: adopted.lastUpdatedIso,
        sourceUrl: adopted.sourceUrl,
        sourceSha256: record.sourceHash,
        provenance: 'retrieved',
        verifiedBy: record.verifiedBy,
        retrievedAtIso: record.retrievedAtIso,
        rawPayload: adopted,
        permitOffice: adopted.permitOffice,
        engineeringReviewRequirements: adopted.engineeringReviewRequirements,
        enrichmentAttempt: { atIso: ctx.nowIso, source: provider.name, outcome: 'RETRIEVED' },
      }), null);
    }

    const refs = [
      `authority:code-adoption#${record.sourceHash.slice(0, 16)}`,
      `provenance:${AHJ_REGISTRY_ENDPOINT}`,
      `sha256:${record.sourceHash.slice(0, 16)}`,
    ];
    const recorded: Record<string, string | number | boolean | null> = {
      ...inputsRecorded,
      ahjName: record.ahjName,
      nec: record.editions.find(e => e.kind === 'nec')?.edition ?? null,
      ibc: record.editions.find(e => e.kind === 'ibc')?.edition ?? null,
      irc: record.editions.find(e => e.kind === 'irc')?.edition ?? null,
      ifc: record.editions.find(e => e.kind === 'ifc')?.edition ?? null,
      corroborator: corroborator ? `ahj-national:${corroborator.id}` : null,
      proof: record.proof,
    };
    const invalidations: ResolutionInvalidation[] = [{
      scope: 'snapshot',
      target: 'codeAuthority.editions → PV-0 / CERT / PE-1 / PV-4A code literals, fire setbacks (IFC), structural basis',
      reason: 'adopted code editions established from a retrieval',
      invalidatedBy: 'code-authority@v1', atIso: ctx.nowIso,
    }];

    // GENUINE SOURCE DISAGREEMENT ⇒ OPERATOR_CONFIRMATION with BOTH shown.
    if (record.conflicts.length) {
      return {
        result: 'FAILED',
        clearance: { cleared: false, missing: ['an operator determination of the governing adopted edition'], reasons: record.conflicts },
        patch: { codeAdoptionAuthority: record },
        sourceQueried: res.sourcesQueried.join(' · '),
        sourceRefs: refs,
        retryability: 'REQUIRES_INPUT',
        failureReason: record.conflicts.join(' · '),
        operatorAction: 'Two authoritative sources state different adopted editions — confirm the governing edition with the permit office. Both values and both sources are recorded above.',
        confidence: record.confidence,
        auditRef: null,
        invalidations,
        inputsRecorded: recorded,
      };
    }

    const missing = missingAdoptionEditions(record);
    if (missing.length) {
      return {
        result: 'FAILED',
        clearance: {
          cleared: false,
          missing: missing.map(k => `${k.toUpperCase()} adoption for ${record.ahjName} (the registry record carries no ${k.toUpperCase()} enumeration)`),
          reasons: [`the retrieval established ${record.editions.filter(e => e.edition).map(e => `${e.kind.toUpperCase()} ${e.edition}`).join(', ') || 'no edition'} `
            + `but carries no adoption for ${missing.map(k => k.toUpperCase()).join(', ')} — no edition is inferred and the curated table may not fill the gap`],
        },
        patch: { codeAdoptionAuthority: record },
        sourceQueried: res.sourcesQueried.join(' · '),
        sourceRefs: refs,
        retryability: 'REQUIRES_INPUT',
        failureReason: `adopted edition not established for ${missing.map(k => k.toUpperCase()).join(', ')} at ${record.ahjName}`,
        operatorAction: `Obtain the ${missing.map(k => k.toUpperCase()).join('/')} adoption from ${record.permitOffice.url ?? record.ahjName} and archive the adoption ordinance through the document registry.`,
        confidence: record.confidence,
        auditRef: null,
        invalidations,
        inputsRecorded: recorded,
      };
    }

    return {
      result: 'RESOLVED',
      clearance: { cleared: true, missing: [], reasons: [] },
      patch: { codeAdoptionAuthority: record },
      sourceQueried: res.sourcesQueried.join(' · '),
      sourceRefs: refs,
      retryability: 'NON_RETRYABLE',
      failureReason: null,
      confidence: record.confidence,
      auditRef: buildResolutionAuditRef({ resolverId: 'code-authority@v1', sourceRefs: refs, atIso: ctx.nowIso }),
      invalidations,
      inputsRecorded: recorded,
    };
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// WS-4 — ENVIRONMENTAL LOAD AUTHORITY (retrieval)
// ───────────────────────────────────────────────────────────────────────────
// Runs AFTER `climate-hazard-document@v1` (the archived-document lookup) and is
// a NO-OP when that already produced a verified source: an archived, reviewed
// document outranks a fresh retrieval and is also the durable cache, so a site
// whose hazards are archived is never re-retrieved.
//
// It WRITES THE RETRIEVED VALUES ONTO THE PROJECT RECORD before the structural
// engine runs, so the CALCULATED wind/snow — not merely the displayed ones —
// derive from the authority record. The superseded posted values are preserved
// in `overrideHistory`; nothing is silently lost.
// ═══════════════════════════════════════════════════════════════════════════

const ARCHIVE_FAILURE_ACTION =
  'Run migration 113 through the governed console (Admin → System Tools → Migrations) so the retrieval is also '
  + 'indexed as a climate_hazard_dataset registry document. The retrieval itself is unaffected — it is archived on '
  + 'the snapshot with its own SHA-256 — but the durable registry copy is missing until the table exists.';

export const environmentalAuthorityResolver: RequirementResolver = {
  id: 'environmental-load-authority@v1',
  mode: 'AUTO_RETRIEVED',
  requirementCodes: ['ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED'],
  requiredInputs: ['projectJurisdiction', 'projectLegalAuthority', 'environmentalSource'],
  produces: ['environmentalSource', 'environmentalRetrieval'],
  description: 'Retrieves the site wind speed, ground snow load, seismic parameters and elevation from the ASCE 7 hazard datasets, archives the retrieval, and makes the displayed AND calculated design values derive from it.',
  async run(ctx: ResolverContext): Promise<ResolverOutcome> {
    const p = proj(ctx);
    const provider = ctx.providers.climateHazard ?? null;
    const legal = ctx.authority.projectLegalAuthority ?? null;
    const jurisdiction = ctx.authority.projectJurisdiction;
    const lat = num(p.lat) ?? legal?.normalized.lat ?? null;
    const lng = num(p.lng) ?? legal?.normalized.lng ?? null;
    const addressUsed = legal?.normalized.address ?? str(p.address);

    // ── an ARCHIVED, currency-reviewed document may already cover this site ──
    // COORDINATE INVALIDATION (directive WS-4, mandated test): an archived source
    // is the authority ONLY while the project's coordinates are still the ones it
    // was retrieved at. A parcel re-geocode / house-centre correction that moves
    // the site beyond the tolerance INVALIDATES it, and the retrieval re-runs
    // rather than a stale point being reported as the site's design basis.
    const archived = ctx.authority.environmentalSource ?? null;
    const archivedCovers = archived
      ? environmentalCoordinatesCover(archived.coordinates, { lat, lng })
      : false;
    if (archived && archivedCovers) {
      // DEFERRAL, not a downgrade. The document resolver already established the
      // authority and wrote its own audit reference; this resolver performed no
      // retrieval, so its RESULT is SKIPPED — but it must carry the SAME
      // clearance forward, because the lifecycle applies each resolver's verdict
      // to the shared requirement state in execution order and a later SKIP must
      // never un-clear what an earlier resolver proved.
      const deferRefs = [
        `document:${archived.documentId}`,
        ...(archived.sha256 ? [`sha256:${archived.sha256.slice(0, 16)}`] : []),
      ];
      return {
        result: 'SKIPPED',
        clearance: { cleared: true, missing: [], reasons: [] },
        sourceQueried: 'manufacturer_document_registry (climate_hazard_dataset)',
        sourceRefs: deferRefs,
        retryability: 'NON_RETRYABLE',
        failureReason: null,
        confidence: null,
        // the audit reference names the DOCUMENT resolver, which is what actually
        // established the authority — never this resolver, which retrieved nothing.
        auditRef: buildResolutionAuditRef({
          resolverId: 'climate-hazard-document@v1 (deferred to by environmental-load-authority@v1: an archived, '
            + 'currency-reviewed source already covers this site, so no live retrieval was performed)',
          sourceRefs: deferRefs, atIso: ctx.nowIso,
        }),
        inputsRecorded: { archivedDocumentPresent: true, archivedCoversCoordinates: true, lat, lng },
      };
    }
    /** Set when an archived source was REJECTED because the site moved. */
    const staleArchived = archived && !archivedCovers
      ? `${archived.documentId} (retrieved at ${archived.coordinates?.lat ?? '—'},${archived.coordinates?.lng ?? '—'})`
      : null;

    const riskDecision = resolveRiskCategory(normalizeRiskCategory(p.riskCategory));
    // WHERE the posted wind/snow came from — the difference between "an authority
    // disagrees with the retrieval" and "a sourceless default was refined". The
    // permit route stamps this (route.ts, AAC WS-4); a body that carries no stamp
    // falls back to the historical operator-entered / engine-default split.
    const provStamp = (p.environmentalValueProvenance ?? {}) as Record<string, string | undefined>;
    const windProvenance = asPostedProvenance(provStamp.windSpeedMph, num(p.ahjWindSpeedMph));
    const snowProvenance = asPostedProvenance(provStamp.groundSnowPsf, num(p.ahjGroundSnowPsf));
    const inputsRecorded: Record<string, string | number | boolean | null> = {
      lat, lng, asceEdition: `ASCE ${STRUCTURAL_ASCE_EDITION}`,
      riskCategory: riskDecision.value, riskCategorySource: riskDecision.source,
      postedWindSpeedMph: num(p.ahjWindSpeedMph), postedGroundSnowPsf: num(p.ahjGroundSnowPsf),
      postedWindProvenance: windProvenance, postedSnowProvenance: snowProvenance,
      postedExposure: str(p.windExposure) ?? str(p.exposureCategory),
      staleArchivedSourceRejected: staleArchived,
      providerInjected: !!provider,
      providerConfigured: provider ? provider.isConfigured() : null,
    };

    if (!provider) {
      return {
        result: 'SKIPPED',
        clearance: { cleared: false, missing: ['a climate-hazard provider'], reasons: ['PROVIDER-NOT-INJECTED: no climate-hazard provider is available to this run — no hazard service was queried'] },
        sourceQueried: null,
        retryability: 'RETRYABLE',
        failureReason: 'PROVIDER-NOT-INJECTED: the climate-hazard provider bag is empty for this run.',
        confidence: null,
        inputsRecorded,
      };
    }
    if (lat == null || lng == null) {
      return {
        result: 'FAILED',
        clearance: { cleared: false, missing: ['project coordinates (lat/lng)'], reasons: ['the hazard rasters are indexed by coordinate and the project carries none'] },
        sourceQueried: provider.name,
        retryability: 'REQUIRES_INPUT',
        failureReason: 'no site coordinates on the project record — the ASCE hazard datasets cannot be queried.',
        operatorAction: 'Geocode the installation address so the project carries lat/lng, then regenerate.',
        confidence: 0,
        inputsRecorded,
      };
    }

    const res = await provider.getHazards({
      lat, lng,
      asceEdition: STRUCTURAL_ASCE_EDITION,
      riskCategory: riskDecision.value,
      addressUsed,
      siteClass: DEFAULT_SITE_CLASS,
    });

    if (!res.ok) {
      return {
        result: 'FAILED',
        clearance: {
          cleared: false,
          missing: ['an ASCE 7 hazard retrieval or an archived climate_hazard_dataset covering this site'],
          // TR — split by failure KIND (see project-authority). A NO_COVERAGE
          // answer ("ground snow load NOT retrieved") is a fact about this site
          // and stays; a timeout is not and does not.
          reasons: [materialRetrievalReason({
            failureKind: res.failureKind,
            providerFailure: `${provider.name}: ${res.failure}`,
            whenOperational: 'the environmental-load authority is NOT ESTABLISHED — no ASCE 7 hazard retrieval or archived climate-hazard dataset was obtained for this site',
          })],
        },
        sourceQueried: res.sourcesQueried.join(' · ') || provider.name,
        sourceRefs: res.sourcesQueried.map(u => `provenance:${u}`),
        retryability: retryabilityFor(res.failureKind),
        failureReason: res.failure,
        operatorAction: res.operatorAction,
        confidence: 0,
        auditRef: null,
        inputsRecorded,
      };
    }

    // ── build the record (posted values captured BEFORE any write-back) ─────
    const postedWind = num(p.ahjWindSpeedMph);
    const postedSnow = num(p.ahjGroundSnowPsf);
    const overrides = Array.isArray(p.environmentalOverrides)
      ? (p.environmentalOverrides as OperatorEnvironmentalOverride[])
      : [];
    const record = buildEnvironmentalRetrievalRecord({
      hazards: res.value,
      resolverId: 'environmental-load-authority@v1',
      projectId: ctx.projectId,
      jurisdiction,
      addressUsed,
      posted: {
        windSpeedMph: postedWind, groundSnowPsf: postedSnow,
        exposureCategory: str(p.windExposure) ?? str(p.exposureCategory),
        riskCategory: normalizeRiskCategory(p.riskCategory),
      },
      postedWindOperatorEntered: postedWind != null,
      postedSnowOperatorEntered: postedSnow != null,
      postedWindProvenance: windProvenance,
      postedSnowProvenance: snowProvenance,
      operatorOverrides: overrides,
      riskDecision,
      siteClass: DEFAULT_SITE_CLASS,
      confidence: res.confidence,
      nowIso: ctx.nowIso,
    });

    // ── ARCHIVAL through lib/documents (fail-soft; migration 113 may be unrun) ─
    const docId = archivalDocumentId(record);
    const claims = toRegistryClaims(record) as Record<string, unknown>;
    const archive = await ctx.safeDbRead(
      'createDocument(climate_hazard_dataset)',
      () => createDocument({
        id: docId,
        documentClass: 'climate_hazard_dataset',
        manufacturerOrIssuer: record.sourceProvider,
        equipmentModelApplicability: record.applicability,
        title: `${record.sourceDocumentOrTool} — ${addressUsed ?? `${lat},${lng}`}`,
        revision: record.edition,
        documentDate: record.retrievedAtIso.slice(0, 10),
        archivedFileIdentity: `snapshot:resolutionAuthority.environmentalRetrieval#${record.sourceHash.slice(0, 16)}`,
        archivedInRepo: true,
        sha256: record.sourceHash,
        source: record.datasets.map(d => d.sourceUrl).join(' · '),
        jurisdictionBoundary: jurisdiction,
        applicabilityNotes: record.applicability,
        status: 'current',
        extractedClaims: claims as never,
        // ── D5 — MACHINE VERIFICATION, DECLARED AS SUCH ────────────────────
        // This row stays terminally verified (RG-3 must not regress): retrieving
        // a published ASCE 7 hazard dataset at a coordinate is objective and
        // reproducible, which is precisely what `climate_hazard_dataset` is
        // allowed to be machine-verified for.
        //
        // What changes is that the machine now SAYS SO. Previously the resolver
        // id went into `reviewer` — the ASSIGNED-reviewer column — and
        // `createDocument` never wrote `verified_by` at all, so the row read as
        // "verified by nobody". A resolver must never be indistinguishable from
        // a human verifier.
        verificationState: 'verified',
        verificationActor: record.resolverId,
        verificationActorKind: 'resolver',
        verificationBasis: 'MACHINE_GOVERNMENT_DATASET_RETRIEVAL',
        reviewer: record.resolverId,
        createdBy: record.resolverId,
      }),
      null,
    );
    record.registryArchival = {
      attempted: true,
      documentId: archive.ok && archive.value ? archive.value.id : null,
      failure: archive.ok ? null : archive.error,
      operatorAction: archive.ok ? null : ARCHIVE_FAILURE_ACTION,
    };

    const evidence = toEnvironmentalSourceEvidence(record);

    // The evidence must satisfy the EXISTING nine-condition gate. If it does not
    // (e.g. no exposure category is stated anywhere), the requirement does NOT
    // clear and the missing piece is named — the gate is never relaxed.
    const gaps: string[] = [];
    if (!evidence.coversWindSpeed) gaps.push('the retrieval returned no basic wind speed');
    if (!evidence.coversSnowLoad) gaps.push('the retrieval returned no ground snow load');
    if (!evidence.coversExposureRisk) {
      gaps.push('no ASCE 7 §26.7 exposure category is stated for this site — a hazard dataset cannot supply it '
        + '(it is a designer determination of the upwind surface roughness), so the environmental authority is incomplete');
    }

    // ── WRITE-BACK: the CALCULATION derives from the record, not just the
    //    display. This runs before generatePermit computes the structural runs.
    const writeBack: string[] = [];
    if (record.governing.windSpeedMph != null && p.ahjWindSpeedMph !== record.governing.windSpeedMph) {
      p.ahjWindSpeedMph = record.governing.windSpeedMph; writeBack.push('ahjWindSpeedMph');
    }
    if (record.governing.groundSnowLoadPsf != null && p.ahjGroundSnowPsf !== record.governing.groundSnowLoadPsf) {
      p.ahjGroundSnowPsf = record.governing.groundSnowLoadPsf; writeBack.push('ahjGroundSnowPsf');
    }
    if (!str(p.riskCategory)) { p.riskCategory = record.governing.riskCategory; writeBack.push('riskCategory'); }
    // Post-AAC seismic repair — the old write went to `seismicDesignCategory`,
    // a field NOTHING in production reads (the cover reads `seismicCategory`),
    // and was fill-if-empty, so even a matching name would have lost to the
    // (now retired) table seed. Write the field the sheets actually read,
    // unconditionally — same overwrite discipline as wind/snow above. The
    // legacy name is kept in sync for the recorded evidence only.
    if (record.returnedValues.seismicSdc && p.seismicCategory !== record.returnedValues.seismicSdc) {
      p.seismicCategory = record.returnedValues.seismicSdc; writeBack.push('seismicCategory');
    }
    if (record.returnedValues.seismicSdc && p.seismicDesignCategory !== record.returnedValues.seismicSdc) {
      p.seismicDesignCategory = record.returnedValues.seismicSdc; writeBack.push('seismicDesignCategory');
    }

    const refs = [
      `authority:environmental-load#${record.sourceHash.slice(0, 16)}`,
      ...(record.registryArchival.documentId ? [`document:${record.registryArchival.documentId}`] : []),
      `sha256:${record.sourceHash.slice(0, 16)}`,
      ...record.datasets.map(d => `provenance:${d.sourceUrl}`),
    ];
    const recorded: Record<string, string | number | boolean | null> = {
      ...inputsRecorded,
      retrievedWindSpeedMph: record.returnedValues.windSpeedMph,
      retrievedGroundSnowPsf: record.returnedValues.groundSnowLoadPsf,
      retrievedSeismicSdc: record.returnedValues.seismicSdc,
      retrievedElevationFt: record.returnedValues.elevationFt,
      governingWindSpeedMph: record.governing.windSpeedMph,
      governingGroundSnowPsf: record.governing.groundSnowLoadPsf,
      exposureCategory: record.exposure.category,
      exposureSource: record.exposure.source,
      overrideHistoryCount: record.overrideHistory.length,
      conflictCount: record.conflicts.length,
      archivedDocumentId: record.registryArchival.documentId,
      archivalFailure: record.registryArchival.failure,
      projectFieldsRewritten: writeBack.join(', ') || null,
      proof: record.proof,
    };
    const invalidations: ResolutionInvalidation[] = [{
      scope: 'snapshot',
      target: 'structural.env (wind/snow) → structural-engine-v4 utilisation → PE-1 / PV-4C / fence engine / digest',
      reason: `environmental design values established from a ${record.proof} ASCE ${STRUCTURAL_ASCE_EDITION} hazard retrieval`,
      invalidatedBy: 'environmental-load-authority@v1', atIso: ctx.nowIso,
    }];
    // COORDINATE INVALIDATION — a rejected stale source is declared explicitly so
    // the dependents rebuilt from it are named, not merely implied.
    if (staleArchived) {
      invalidations.push({
        scope: 'snapshot',
        target: `environmental load authority (superseded archived source ${staleArchived})`,
        reason: `the project's coordinates moved beyond the coverage tolerance of the archived source — `
          + `it no longer covers ${lat},${lng} and was re-retrieved`,
        invalidatedBy: 'environmental-load-authority@v1', atIso: ctx.nowIso,
      });
    }

    // ── GENUINE SOURCE DISAGREEMENT ⇒ OPERATOR_CONFIRMATION with BOTH shown ──
    // An authority-carrying project value that materially differs from the
    // retrieval is not silently replaced. The more conservative value governs
    // (so the calculation never weakens while the question is open) and the
    // requirement stays OPEN with no audit reference.
    if (record.conflicts.length) {
      return {
        result: 'FAILED',
        clearance: {
          cleared: false,
          missing: ['an operator determination of the governing environmental design value'],
          reasons: record.conflicts,
        },
        patch: { environmentalSource: evidence, environmentalRetrieval: record },
        sourceQueried: res.sourcesQueried.join(' · '),
        sourceRefs: refs,
        retryability: 'REQUIRES_INPUT',
        failureReason: record.conflicts.join(' · '),
        operatorAction: 'Two sources state different environmental design values — confirm the governing value. Record '
          + 'the decision as an override (value + reason + authority source + actor), which preserves the retrieval '
          + 'beside it. Both values and both sources are on the record above.',
        confidence: record.confidence,
        auditRef: null,
        invalidations,
        inputsRecorded: recorded,
      };
    }

    if (gaps.length) {
      return {
        result: 'FAILED',
        clearance: { cleared: false, missing: gaps, reasons: gaps },
        // the retrieval STILL rides on the bundle: its values are better than the
        // code default and the record is the evidence of what was established.
        patch: { environmentalSource: evidence, environmentalRetrieval: record },
        sourceQueried: res.sourcesQueried.join(' · '),
        sourceRefs: refs,
        retryability: 'REQUIRES_INPUT',
        failureReason: `the hazard retrieval succeeded but the environmental authority is incomplete: ${gaps.join(' · ')}`,
        operatorAction: !evidence.coversExposureRisk
          ? 'State the ASCE 7 §26.7 exposure category for this site on the project (B / C / D per the upwind surface roughness).'
          : null,
        confidence: record.confidence,
        auditRef: null,
        invalidations,
        inputsRecorded: recorded,
      };
    }

    return {
      result: 'RESOLVED',
      clearance: { cleared: true, missing: [], reasons: [] },
      patch: { environmentalSource: evidence, environmentalRetrieval: record },
      sourceQueried: res.sourcesQueried.join(' · '),
      sourceRefs: refs,
      retryability: 'NON_RETRYABLE',
      failureReason: null,
      operatorAction: record.registryArchival.failure ? record.registryArchival.operatorAction : null,
      confidence: record.confidence,
      auditRef: buildResolutionAuditRef({ resolverId: 'environmental-load-authority@v1', sourceRefs: refs, atIso: ctx.nowIso }),
      invalidations,
      inputsRecorded: recorded,
    };
  },
};
