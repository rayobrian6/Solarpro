// ═══════════════════════════════════════════════════════════════════════════
// THE REGISTRY AS A CACHE, LOOKED UP BY IDENTITY — NEVER BY NAME.
//
// `AhjRegistryLookup.byIdentity` deliberately offers no name lookup. A name
// match is a search hint, and hints do not select authorities: 1,739 registry
// rows share an `ahjName` with another row, and "Washington County Building
// Department" names a department in 30 different states.
//
// So this adapter matches ONLY on the stable legal-geography identity backfilled
// onto each row. A row with no `legalIdentity` is invisible here, which is the
// correct behaviour — "we hold no IDENTIFIED record for this government" is a
// true statement, and the resolver turns it into
// BOUNDARY_ESTABLISHED_AHJ_RECORD_MISSING rather than reaching for a neighbour.
// ═══════════════════════════════════════════════════════════════════════════

import { AHJ_NATIONAL, type AhjRecord } from './ahj-national';
import { governmentKey } from './legalGovernmentIdentity';
import { identityKey, type AhjRegistryLookup, type GoverningEntity } from './ahjAuthority';

/** Build the identity index once. Rows without an identity are excluded. */
function buildIndex(rows: readonly AhjRecord[]): Map<string, AhjRecord[]> {
  const ix = new Map<string, AhjRecord[]>();
  for (const r of rows) {
    if (!r.legalIdentity) continue;
    const k = governmentKey(r.legalIdentity);
    ix.set(k, [...(ix.get(k) ?? []), r]);
  }
  return ix;
}

let INDEX: Map<string, AhjRecord[]> | null = null;

/**
 * A lookup over the bundled national registry.
 *
 * `hasOfficialProvenance` reports whether the ROW carries evidence a reviewer
 * could open — a code-adoption source URL and retrieval date. `dataProvenance:
 * 'curated'` does NOT count: it means a human typed the row, and cites nothing.
 * That distinction is what separates AHJ_RECORD_FOUND from AHJ_VERIFIED.
 */
export function createAhjNationalLookup(rows: readonly AhjRecord[] = AHJ_NATIONAL): AhjRegistryLookup {
  const ix = rows === AHJ_NATIONAL ? (INDEX ??= buildIndex(rows)) : buildIndex(rows);
  return {
    byIdentity(e: GoverningEntity) {
      const hits = ix.get(identityKey(e));
      if (!hits || hits.length === 0) return null;
      // Two rows for one government are separate DEPARTMENTS or true duplicates;
      // either way, picking one arbitrarily would be a silent choice. Prefer a
      // row that carries real provenance, then the curated tier, and otherwise
      // take the first deterministically (the table order is stable).
      const best = hits.find(r => r.codeSourceUrl && r.codeRetrievedAtIso)
        ?? hits.find(r => r.dataProvenance === 'curated')
        ?? hits[0];
      return {
        id: best.id,
        name: best.ahjName,
        hasOfficialProvenance: !!(best.codeSourceUrl && best.codeRetrievedAtIso),
      };
    },
  };
}

/** Every government identity the registry can answer for — the denominator of
 *  identity coverage, and the input to duplicate detection. */
export function registryIdentityKeys(rows: readonly AhjRecord[] = AHJ_NATIONAL): string[] {
  return [...buildIndex(rows).keys()];
}
