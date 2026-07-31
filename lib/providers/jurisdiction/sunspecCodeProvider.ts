// ═══════════════════════════════════════════════════════════════════════════
// AAC WS-3 — THE LIVE SUNSPEC / ORANGE BUTTON CODE-ADOPTION PROVIDER
// ───────────────────────────────────────────────────────────────────────────
// Wraps `lookupCodeAdoptionFromRegistry` (lib/jurisdictions/ahjRegistry.ts) in
// the shared retrieval envelope, so a missing token, a rejected token, a
// timeout, a no-match and an OVERLAPPING-JURISDICTION result are five
// distinguishable outcomes with five different retryabilities — not one null.
//
// LIVE STATUS IN THIS ENVIRONMENT (2026-07-27): AHJ_REGISTRY_TOKEN is NOT
// provisioned, so the live path returns NOT_CONFIGURED with the exact env-var
// operator action and CODE-AUTHORITY-INCOMPLETE legitimately REMAINS. The
// fixture provider proves the clearing path end-to-end.
// ═══════════════════════════════════════════════════════════════════════════

import {
  lookupCodeAdoptionFromRegistry, AHJ_REGISTRY_ENDPOINT, isRegistryConfigured,
} from '@/lib/jurisdictions/ahjRegistry';
import { retrievalOk, retrievalFailure, type RetrievalResult, type RetrievalFailureKind } from '../types';
import type { CodeAdoptionProvider, CodeAdoptionQuery, RetrievedCodeAdoption } from './types';

const KIND_MAP: Record<string, RetrievalFailureKind> = {
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  NO_COORDINATES: 'INSUFFICIENT_QUERY',
  HTTP_ERROR: 'TRANSPORT',
  NETWORK_ERROR: 'TRANSPORT',
  PARSE_ERROR: 'PARSE',
  NO_MATCH: 'NO_COVERAGE',
};

export interface SunspecCodeProviderOptions {
  nowIso?: string;
  fetchImpl?: typeof fetch;
}

export function createSunspecCodeProvider(opts?: SunspecCodeProviderOptions): CodeAdoptionProvider {
  return {
    name: 'sunspec-orange-button-ahj-registry',
    metered: false,
    isConfigured: () => isRegistryConfigured(),
    async getCodeAdoption(q: CodeAdoptionQuery): Promise<RetrievalResult<RetrievedCodeAdoption>> {
      const retrievedAtIso = opts?.nowIso ?? new Date().toISOString();
      const res = await lookupCodeAdoptionFromRegistry(
        { lat: q.lat ?? undefined, lng: q.lng ?? undefined, address: q.address ?? undefined, stateCode: q.stateCode ?? undefined },
        { nowIso: retrievedAtIso, fetchImpl: opts?.fetchImpl },
      );
      if (!res.ok || !res.record) {
        return retrievalFailure({
          sourcesQueried: [res.sourceUrl], retrievedAtIso,
          failureKind: KIND_MAP[res.failureKind ?? ''] ?? 'TRANSPORT',
          failure: res.failure ?? `${AHJ_REGISTRY_ENDPOINT}: no adoption record`,
          operatorAction: res.operatorAction,
        });
      }
      // OVERLAPPING JURISDICTION — the registry itself says more than one AHJ
      // covers this point. The engine may not pick; the directive names this an
      // OPERATOR_CONFIRMATION case and both candidates are shown.
      if (res.allMatches.length > 1) {
        return retrievalFailure({
          sourcesQueried: [res.sourceUrl], retrievedAtIso, failureKind: 'AMBIGUOUS',
          failure: `${res.sourceUrl}: ${res.allMatches.length} authorities cover this location — `
            + res.allMatches.map(m => `${m.ahjName} [${m.jurisdictionType}] NEC ${m.editions.nec ?? '—'} / IBC ${m.editions.ibc ?? '—'} / IRC ${m.editions.irc ?? '—'} / IFC ${m.editions.ifc ?? '—'}`).join(' ‖ ')
            + '. The engine may not choose between overlapping authorities.',
          operatorAction: 'Confirm which authority has jurisdiction over this parcel (building/electrical/fire may differ) — '
            + 'both candidate records and their adopted editions are shown above.',
        });
      }
      return retrievalOk({
        value: { record: res.record, allMatches: res.allMatches, proof: 'live-retrieval' },
        sourcesQueried: [res.sourceUrl],
        retrievedAtIso,
        // A single authoritative registry match with all four families present is
        // the strong case; each missing family lowers confidence honestly.
        confidence: (() => {
          const e = res.record.editions;
          const present = [e.nec, e.ibc, e.irc, e.ifc].filter(Boolean).length;
          return Math.round((0.5 + 0.125 * present) * 100) / 100;
        })(),
      });
    },
  };
}
