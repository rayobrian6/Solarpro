// ═══════════════════════════════════════════════════════════════════════════
// TAC WS-19 — THE INTERNAL (NEON) AHJ / ADOPTED-CODE REGISTRY.
//
// The registry the website advertises is the bundled TypeScript table
// (lib/jurisdictions/ahj-national.ts) — NEC-only, no ordinance, no dates, no
// hashes. The only adopted-code path was the EXTERNAL SunSpec/Orange Button
// registry behind AHJ_REGISTRY_TOKEN, which made an external credential the
// PRIMARY prerequisite for code authority. This module inverts the precedence:
//
//   1. SolarPro Neon ahj_registry (migration 117)   — evidence-carrying rows
//   2. (archived authority evidence — the same rows, retained from prior runs)
//   3. external SunSpec/Orange Button retrieval      — fallback + enrichment
//   4. governed operator verification                — genuine-conflict path
//
// RESEARCH ONCE → RETAIN CENTRALLY: every ADMITTED external retrieval is
// upserted here (provenance 'retrieved', payload hash + source URL), and the
// curated in-code row is retained on a miss (provenance 'seeded-unprovenanced')
// so the registry itself documents what is known and exactly what is missing.
//
// GATE SEMANTICS ARE UNCHANGED. codeAuthority.ts still requires zero-null
// editions + verifiedBy + sourceHash for 'verified'. A seeded-unprovenanced
// row is NEVER served as adoption authority (the provider refuses it) — it can
// therefore never clear CODE-AUTHORITY-INCOMPLETE, exactly like the in-code
// table it copies.
// ═══════════════════════════════════════════════════════════════════════════

import { getDbReady } from '@/lib/db/core';
import type { RegistryCodeAdoption } from '@/lib/jurisdictions/ahjRegistry';
import { retrievalOk, retrievalFailure, type RetrievalResult } from '@/lib/providers/types';
import type { CodeAdoptionProvider, CodeAdoptionQuery, RetrievedCodeAdoption } from '@/lib/providers/jurisdiction/types';

export type AhjRegistryProvenance = 'seeded-unprovenanced' | 'retrieved' | 'operator-verified';

export interface AhjRegistryRow {
  id: string;
  stateCode: string;
  county: string | null;
  city: string | null;
  ahjName: string;
  jurisdictionType: string;
  externalAhjId: string | null;
  editions: { nec: string | null; ibc: string | null; irc: string | null; ifc: string | null };
  rawEditions: Record<string, string | null> | null;
  localAmendments: string[];
  effectiveDate: string | null;
  sourceUrl: string | null;
  sourceSha256: string | null;
  provenance: AhjRegistryProvenance;
  verifiedBy: string | null;
  verifiedAtIso: string | null;
  retrievedAtIso: string | null;
  rawPayload: unknown;
  enrichmentAttempts: Array<{ atIso: string; source: string; outcome: string; note?: string }>;
  permitOffice: { name: string | null; phone: string | null; email: string | null; url: string | null; address: string | null } | null;
  engineeringReviewRequirements: string[];
  notes: string | null;
}

const _json = <T,>(v: unknown, fallback: T): T => {
  if (v == null) return fallback;
  if (typeof v !== 'string') return v as T;
  try { return JSON.parse(v) as T; } catch { return fallback; }
};

function rowToRecord(row: Record<string, unknown>): AhjRegistryRow {
  const iso = (v: unknown): string | null => v == null ? null : new Date(v as string).toISOString();
  return {
    id: String(row.id),
    stateCode: String(row.state_code ?? ''),
    county: (row.county as string) ?? null,
    city: (row.city as string) ?? null,
    ahjName: String(row.ahj_name ?? ''),
    jurisdictionType: String(row.jurisdiction_type ?? 'unknown'),
    externalAhjId: (row.external_ahj_id as string) ?? null,
    editions: {
      nec: (row.nec_edition as string) ?? null,
      ibc: (row.ibc_edition as string) ?? null,
      irc: (row.irc_edition as string) ?? null,
      ifc: (row.ifc_edition as string) ?? null,
    },
    rawEditions: _json(row.raw_editions, null),
    localAmendments: _json(row.local_amendments, []),
    effectiveDate: (row.effective_date as string) ?? null,
    sourceUrl: (row.source_url as string) ?? null,
    sourceSha256: (row.source_sha256 as string) ?? null,
    provenance: (row.provenance as AhjRegistryProvenance) ?? 'seeded-unprovenanced',
    verifiedBy: (row.verified_by as string) ?? null,
    verifiedAtIso: iso(row.verified_at),
    retrievedAtIso: iso(row.retrieved_at),
    rawPayload: _json(row.raw_payload, null),
    enrichmentAttempts: _json(row.enrichment_attempts, []),
    permitOffice: _json(row.permit_office, null),
    engineeringReviewRequirements: _json(row.engineering_review_requirements, []),
    notes: (row.notes as string) ?? null,
  };
}

const norm = (s: string | null | undefined): string | null => {
  const v = (s ?? '').trim().toLowerCase()
    .replace(/\s+county$/, '').replace(/\s+/g, ' ');
  return v || null;
};

/** Find the best-matching registry row for a jurisdiction query. County match
 *  is the primary key for unincorporated parcels; a city match wins when the
 *  parcel is inside an incorporated municipality (the caller's legal-authority
 *  record decides which query fields are posted — this store never guesses
 *  incorporation itself). */
export async function findAhjRegistryRow(q: {
  stateCode: string | null; county?: string | null; city?: string | null;
}): Promise<{ match: AhjRegistryRow | null; allMatches: AhjRegistryRow[]; matchMethod: string | null }> {
  if (!q.stateCode) return { match: null, allMatches: [], matchMethod: null };
  const sql = await getDbReady();
  const state = q.stateCode.trim().toUpperCase();
  const rows = await sql`
    SELECT * FROM ahj_registry WHERE UPPER(state_code) = ${state}
  `;
  const all = (rows as Record<string, unknown>[]).map(rowToRecord);
  const county = norm(q.county);
  const city = norm(q.city);
  // city-level authority first (incorporated parcel), then county authority.
  const cityMatches = city ? all.filter(r => norm(r.city) === city) : [];
  if (cityMatches.length) {
    return { match: cityMatches[0], allMatches: cityMatches, matchMethod: 'state+city' };
  }
  const countyMatches = county
    ? all.filter(r => norm(r.county) === county && !norm(r.city))
    : [];
  if (countyMatches.length) {
    return { match: countyMatches[0], allMatches: countyMatches, matchMethod: 'state+county' };
  }
  return { match: null, allMatches: [], matchMethod: null };
}

/** A row is ADOPTION AUTHORITY only when it carries the evidence envelope the
 *  code-authority gate demands: an evidence-bearing provenance, a source, a
 *  payload hash and an attribution. Seeded rows NEVER qualify. */
export function rowCarriesAdoptionEvidence(r: AhjRegistryRow): boolean {
  return (r.provenance === 'retrieved' || r.provenance === 'operator-verified')
    && !!r.sourceUrl
    && !!r.sourceSha256
    && !!(r.verifiedBy || r.retrievedAtIso)
    && !!(r.editions.nec || r.editions.ibc || r.editions.irc || r.editions.ifc);
}

/** Project a registry row into the RegistryCodeAdoption shape the code-authority
 *  builder consumes (same contract as an external retrieval). */
export function rowToCodeAdoption(r: AhjRegistryRow): RegistryCodeAdoption {
  return {
    ahjName: r.ahjName,
    ahjCode: r.externalAhjId,
    ahjId: r.id,
    jurisdictionType: (['city', 'county', 'state', 'special_district'].includes(r.jurisdictionType)
      ? r.jurisdictionType : 'unknown') as RegistryCodeAdoption['jurisdictionType'],
    stateCode: r.stateCode,
    county: r.county,
    city: r.city,
    editions: { ...r.editions },
    rawEditions: {
      ElectricCode: r.rawEditions?.ElectricCode ?? null,
      BuildingCode: r.rawEditions?.BuildingCode ?? null,
      ResidentialCode: r.rawEditions?.ResidentialCode ?? null,
      FireCode: r.rawEditions?.FireCode ?? null,
    },
    permitOffice: r.permitOffice ?? { name: null, phone: null, email: null, url: null, address: null },
    engineeringReviewRequirements: r.engineeringReviewRequirements,
    lastUpdatedIso: r.effectiveDate,
    retrievedAtIso: r.retrievedAtIso ?? r.verifiedAtIso ?? new Date(0).toISOString(),
    sourceUrl: r.sourceUrl ?? 'solarpro:ahj_registry',
    matchCount: 1,
    matchedAhjNames: [r.ahjName],
  };
}

/** Upsert a record into the central registry (research-once → retain
 *  centrally). Provenance ladder is monotonic: a 'seeded-unprovenanced' write
 *  never downgrades a 'retrieved' or 'operator-verified' row, and a
 *  'retrieved' write never downgrades 'operator-verified'. */
export async function upsertAhjRegistryRow(input: {
  id: string;
  stateCode: string; county?: string | null; city?: string | null;
  ahjName: string; jurisdictionType?: string | null; externalAhjId?: string | null;
  editions: { nec?: string | null; ibc?: string | null; irc?: string | null; ifc?: string | null };
  rawEditions?: Record<string, string | null> | null;
  localAmendments?: string[] | null;
  effectiveDate?: string | null;
  sourceUrl?: string | null; sourceSha256?: string | null;
  provenance: AhjRegistryProvenance;
  verifiedBy?: string | null; verifiedAtIso?: string | null; retrievedAtIso?: string | null;
  rawPayload?: unknown;
  permitOffice?: AhjRegistryRow['permitOffice'];
  engineeringReviewRequirements?: string[] | null;
  notes?: string | null;
  enrichmentAttempt?: { atIso: string; source: string; outcome: string; note?: string } | null;
}): Promise<AhjRegistryRow> {
  const sql = await getDbReady();
  const RANK: Record<AhjRegistryProvenance, number> = {
    'seeded-unprovenanced': 0, 'retrieved': 1, 'operator-verified': 2,
  };
  const existingRows = await sql`SELECT * FROM ahj_registry WHERE id = ${input.id} LIMIT 1`;
  const existing = (existingRows as Record<string, unknown>[])[0]
    ? rowToRecord((existingRows as Record<string, unknown>[])[0]) : null;

  const attempts = [
    ...(existing?.enrichmentAttempts ?? []),
    ...(input.enrichmentAttempt ? [input.enrichmentAttempt] : []),
  ];

  if (existing && RANK[input.provenance] < RANK[existing.provenance]) {
    // Never downgrade evidence — only append the enrichment attempt.
    if (input.enrichmentAttempt) {
      await sql`
        UPDATE ahj_registry SET enrichment_attempts = ${JSON.stringify(attempts)}, updated_at = now()
        WHERE id = ${input.id}
      `;
    }
    return (await findById(input.id))!;
  }

  await sql`
    INSERT INTO ahj_registry (
      id, state_code, county, city, ahj_name, jurisdiction_type, external_ahj_id,
      nec_edition, ibc_edition, irc_edition, ifc_edition, raw_editions,
      local_amendments, effective_date, source_url, source_sha256, provenance,
      verified_by, verified_at, retrieved_at, raw_payload, enrichment_attempts,
      permit_office, engineering_review_requirements, notes
    ) VALUES (
      ${input.id}, ${input.stateCode.toUpperCase()}, ${input.county ?? null}, ${input.city ?? null},
      ${input.ahjName}, ${input.jurisdictionType ?? 'unknown'}, ${input.externalAhjId ?? null},
      ${input.editions.nec ?? null}, ${input.editions.ibc ?? null}, ${input.editions.irc ?? null},
      ${input.editions.ifc ?? null}, ${input.rawEditions ? JSON.stringify(input.rawEditions) : null},
      ${JSON.stringify(input.localAmendments ?? [])}, ${input.effectiveDate ?? null},
      ${input.sourceUrl ?? null}, ${input.sourceSha256 ?? null}, ${input.provenance},
      ${input.verifiedBy ?? null}, ${input.verifiedAtIso ?? null}, ${input.retrievedAtIso ?? null},
      ${input.rawPayload != null ? JSON.stringify(input.rawPayload) : null},
      ${JSON.stringify(attempts)},
      ${input.permitOffice ? JSON.stringify(input.permitOffice) : null},
      ${JSON.stringify(input.engineeringReviewRequirements ?? [])}, ${input.notes ?? null}
    )
    ON CONFLICT (id) DO UPDATE SET
      state_code = EXCLUDED.state_code, county = EXCLUDED.county, city = EXCLUDED.city,
      ahj_name = EXCLUDED.ahj_name, jurisdiction_type = EXCLUDED.jurisdiction_type,
      external_ahj_id = COALESCE(EXCLUDED.external_ahj_id, ahj_registry.external_ahj_id),
      nec_edition = COALESCE(EXCLUDED.nec_edition, ahj_registry.nec_edition),
      ibc_edition = COALESCE(EXCLUDED.ibc_edition, ahj_registry.ibc_edition),
      irc_edition = COALESCE(EXCLUDED.irc_edition, ahj_registry.irc_edition),
      ifc_edition = COALESCE(EXCLUDED.ifc_edition, ahj_registry.ifc_edition),
      raw_editions = COALESCE(EXCLUDED.raw_editions, ahj_registry.raw_editions),
      local_amendments = EXCLUDED.local_amendments,
      effective_date = COALESCE(EXCLUDED.effective_date, ahj_registry.effective_date),
      source_url = COALESCE(EXCLUDED.source_url, ahj_registry.source_url),
      source_sha256 = COALESCE(EXCLUDED.source_sha256, ahj_registry.source_sha256),
      provenance = EXCLUDED.provenance,
      verified_by = COALESCE(EXCLUDED.verified_by, ahj_registry.verified_by),
      verified_at = COALESCE(EXCLUDED.verified_at, ahj_registry.verified_at),
      retrieved_at = COALESCE(EXCLUDED.retrieved_at, ahj_registry.retrieved_at),
      raw_payload = COALESCE(EXCLUDED.raw_payload, ahj_registry.raw_payload),
      enrichment_attempts = EXCLUDED.enrichment_attempts,
      permit_office = COALESCE(EXCLUDED.permit_office, ahj_registry.permit_office),
      engineering_review_requirements = EXCLUDED.engineering_review_requirements,
      notes = COALESCE(EXCLUDED.notes, ahj_registry.notes),
      updated_at = now()
  `;
  return (await findById(input.id))!;
}

export async function findById(id: string): Promise<AhjRegistryRow | null> {
  const sql = await getDbReady();
  const rows = await sql`SELECT * FROM ahj_registry WHERE id = ${id} LIMIT 1`;
  const row = (rows as Record<string, unknown>[])[0];
  return row ? rowToRecord(row) : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// THE INTERNAL PROVIDER (precedence slot 1)
// ═══════════════════════════════════════════════════════════════════════════

export function createInternalAhjRegistryProvider(opts?: { nowIso?: string }): CodeAdoptionProvider {
  return {
    name: 'solarpro-internal-ahj-registry',
    metered: false,
    isConfigured: () => true,   // the internal registry needs no credential
    async getCodeAdoption(q: CodeAdoptionQuery): Promise<RetrievalResult<RetrievedCodeAdoption>> {
      const retrievedAtIso = opts?.nowIso ?? new Date().toISOString();
      const source = 'solarpro:ahj_registry (migration 117)';
      try {
        const { match, allMatches, matchMethod } = await findAhjRegistryRow({
          stateCode: q.stateCode, county: q.county, city: q.city,
        });
        const evidenced = allMatches.filter(rowCarriesAdoptionEvidence);
        if (!match || evidenced.length === 0) {
          return retrievalFailure({
            sourcesQueried: [source], retrievedAtIso,
            failureKind: 'NO_COVERAGE',
            failure: match
              ? `${source}: row '${match.id}' exists but carries no adoption evidence `
                + `(provenance=${match.provenance}) — a seeded/unprovenanced row may never establish an adopted edition.`
              : `${source}: no registry row for ${q.stateCode ?? '?'}/${q.county ?? q.city ?? '?'}.`,
            operatorAction: 'Record the adopted editions with their ordinance/official source in Admin → AHJ Registry '
              + '(governed operator verification), or configure the external retrieval fallback.',
          });
        }
        if (evidenced.length > 1) {
          return retrievalFailure({
            sourcesQueried: [source], retrievedAtIso, failureKind: 'AMBIGUOUS',
            failure: `${source}: ${evidenced.length} evidence-carrying authorities match this location — `
              + evidenced.map(r => `${r.ahjName} [${r.jurisdictionType}]`).join(' ‖ ')
              + '. The engine may not choose between overlapping authorities.',
            operatorAction: 'Confirm which authority has jurisdiction over this parcel.',
          });
        }
        const row = evidenced[0];
        const record = rowToCodeAdoption(row);
        return retrievalOk({
          value: {
            record,
            allMatches: [record],
            proof: 'internal-registry',
            fixtureProvenance: `ahj_registry:${row.id} (${row.provenance}; match=${matchMethod})`,
          },
          sourcesQueried: [source],
          retrievedAtIso,
          confidence: (() => {
            const e = row.editions;
            const present = [e.nec, e.ibc, e.irc, e.ifc].filter(Boolean).length;
            return Math.round((0.5 + 0.125 * present) * 100) / 100;
          })(),
        });
      } catch (err: unknown) {
        return retrievalFailure({
          sourcesQueried: [source], retrievedAtIso, failureKind: 'TRANSPORT',
          failure: `${source}: ${err instanceof Error ? err.message : String(err)}`,
          operatorAction: 'If the table is missing (42P01): run migration 117 through the governed console (Admin → System Tools → Migrations).',
        });
      }
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// THE COMPOSITE PROVIDER — internal first, external fallback.
// ═══════════════════════════════════════════════════════════════════════════

/** Try each provider in order; the first OK answers. On total failure the
 *  failure message aggregates EVERY provider's reason, so "set the external
 *  token" is presented as ONE option among the internal-registry paths, never
 *  as the primary prerequisite. */
export function createCompositeCodeAdoptionProvider(providers: CodeAdoptionProvider[]): CodeAdoptionProvider {
  return {
    name: 'code-adoption-composite(' + providers.map(p => p.name).join(' → ') + ')',
    metered: false,
    isConfigured: () => providers.some(p => p.isConfigured()),
    async getCodeAdoption(q: CodeAdoptionQuery): Promise<RetrievalResult<RetrievedCodeAdoption>> {
      const failures: Array<{ name: string; res: RetrievalResult<RetrievedCodeAdoption> & { ok: false } }> = [];
      for (const p of providers) {
        const res = await p.getCodeAdoption(q);
        if (res.ok) return res;
        failures.push({ name: p.name, res: res as RetrievalResult<RetrievedCodeAdoption> & { ok: false } });
        // A genuine boundary ambiguity is an operator question, not a reason to
        // consult a weaker source.
        if (res.failureKind === 'AMBIGUOUS') return res;
      }
      const last = failures[failures.length - 1]?.res;
      return retrievalFailure({
        sourcesQueried: failures.flatMap(f => f.res.sourcesQueried),
        retrievedAtIso: last?.retrievedAtIso ?? new Date().toISOString(),
        failureKind: failures[0]?.res.failureKind === 'NO_COVERAGE' && last?.failureKind === 'NOT_CONFIGURED'
          ? 'NO_COVERAGE' : (last?.failureKind ?? 'TRANSPORT'),
        failure: failures.map(f => `[${f.name}] ${f.res.failure}`).join(' ‖ '),
        operatorAction: failures.map(f => f.res.operatorAction).filter(Boolean).join(' — OR — ') || null,
      });
    },
  };
}
