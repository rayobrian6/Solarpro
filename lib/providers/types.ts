// ═══════════════════════════════════════════════════════════════════════════
// AAC WS-3 / WS-4 — THE RETRIEVAL PROVIDER DI SEAM
// ───────────────────────────────────────────────────────────────────────────
// Shape copied VERBATIM from the one DI provider contract the codebase already
// has (`AerialGeometryProvider`, lib/siteSurveys/aerialGeometry/types.ts:68-77):
//
//     readonly name; isConfigured(): boolean; get<Thing>(req): Promise<Result|null>
//
// with ONE deliberate strengthening, mandated by the directive ("Failed retrieval
// reports exact source + exact failure"; "no swallowed retrieval failures"): every
// method returns a RESULT ENVELOPE, never a bare null. `AerialGeometryProvider`
// can collapse a timeout and a genuine no-coverage into the same null because its
// caller only needs "is there geometry"; an AUTHORITY resolver must be able to
// tell a missing token from a missing record from a network failure, because the
// three carry different retryability and different operator actions.
//
// QUOTA DISCIPLINE (nearmapCache, the standing rule from the quota incident:
// metered externals NEVER fail open): every provider declares whether it is
// metered. The three providers implemented here — SunSpec/Orange Button, the US
// Census Geocoder, and the ASCE 7 Hazard Tool's public ArcGIS ImageServers — are
// UNMETERED (free, no per-call quota), so no fail-closed cache gate is required.
// ATTOM *is* metered and is reached only through the existing propertyEnricher
// chain, which already gates on ATTOM_API_KEY and falls through on any failure.
// The durable cache for the hazard retrieval is the archived
// `climate_hazard_dataset` registry document: a site whose hazards are already
// archived is never re-retrieved.
// ═══════════════════════════════════════════════════════════════════════════

/** Why a retrieval did not produce a record. Each maps to a DIFFERENT
 *  retryability + a different (or absent) operator action. */
export type RetrievalFailureKind =
  /** the provider has no credential / is switched off — REQUIRES_INPUT. */
  | 'NOT_CONFIGURED'
  /** the query could not be formed (no coordinates, no address) — REQUIRES_INPUT. */
  | 'INSUFFICIENT_QUERY'
  /** transport failure (timeout, DNS, TLS, non-2xx) — RETRYABLE. */
  | 'TRANSPORT'
  /** 2xx with an unusable body — RETRYABLE. */
  | 'PARSE'
  /** the source answered and genuinely has nothing here — NON_RETRYABLE. */
  | 'NO_COVERAGE'
  /** the source answered with MORE than one authority — OPERATOR_CONFIRMATION. */
  | 'AMBIGUOUS';

export interface RetrievalOk<T> {
  ok: true;
  value: T;
  /** the exact endpoint(s) queried, in call order. */
  sourcesQueried: string[];
  retrievedAtIso: string;
  /** 0..1 — the provider's own confidence in the record. */
  confidence: number;
  failure: null;
  failureKind: null;
  operatorAction: null;
}

export interface RetrievalFailure {
  ok: false;
  value: null;
  sourcesQueried: string[];
  retrievedAtIso: string;
  confidence: 0;
  /** the EXACT failure, source-qualified. Never a generic sentence. */
  failure: string;
  failureKind: RetrievalFailureKind;
  /** the minimal operator action, ONLY when one is genuinely necessary. */
  operatorAction: string | null;
}

export type RetrievalResult<T> = RetrievalOk<T> | RetrievalFailure;

export function retrievalOk<T>(args: {
  value: T; sourcesQueried: string[]; retrievedAtIso: string; confidence: number;
}): RetrievalOk<T> {
  return {
    ok: true, value: args.value, sourcesQueried: args.sourcesQueried,
    retrievedAtIso: args.retrievedAtIso, confidence: args.confidence,
    failure: null, failureKind: null, operatorAction: null,
  };
}

export function retrievalFailure(args: {
  sourcesQueried: string[]; retrievedAtIso: string; failure: string;
  failureKind: RetrievalFailureKind; operatorAction?: string | null;
}): RetrievalFailure {
  return {
    ok: false, value: null, sourcesQueried: args.sourcesQueried,
    retrievedAtIso: args.retrievedAtIso, confidence: 0,
    failure: args.failure, failureKind: args.failureKind,
    operatorAction: args.operatorAction ?? null,
  };
}

/** Retryability for a failure kind — the SAME vocabulary the resolver framework
 *  uses (`RequirementResolutionState.retryability`). A missing env var is not a
 *  retry, it is an input. */
export function retryabilityFor(kind: RetrievalFailureKind): 'RETRYABLE' | 'NON_RETRYABLE' | 'REQUIRES_INPUT' {
  switch (kind) {
    case 'TRANSPORT': case 'PARSE': return 'RETRYABLE';
    case 'NOT_CONFIGURED': case 'INSUFFICIENT_QUERY': case 'AMBIGUOUS': return 'REQUIRES_INPUT';
    case 'NO_COVERAGE': return 'NON_RETRYABLE';
    default: return 'RETRYABLE';
  }
}

/** The common provider contract (the AerialGeometryProvider shape). */
export interface RetrievalProvider {
  readonly name: string;
  /** true when the provider can actually be called (credentials present). A
   *  provider that is not configured must still be CALLED, so the failure is
   *  evidenced rather than silently skipped. */
  isConfigured(): boolean;
  /** false for every provider wired here; true would require the nearmapCache
   *  fail-closed gate before any live call. */
  readonly metered: boolean;
}
