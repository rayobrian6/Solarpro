/**
 * lib/utilityMatcher.ts
 * Utility name normalization + fuzzy matching against the utilities DB.
 *
 * Priority:
 *  P1 — Exact match (case-insensitive) in utility_policies
 *  P2 — pg_trgm similarity > 0.45 in utility_policies
 *  P3 — Normalize + scan STATE_UTILITY_FALLBACK major-utility list (substring match)
 *  P4 — Return null (caller uses national default)
 *
 * Auto-insert: if a parsed name matches with P3 but has no DB row, insert it
 * as a pending row with source='auto_discovered' so an admin can enrich it later.
 */

import { getDb } from '@/lib/db-neon';
import { STATE_UTILITY_FALLBACK } from '@/lib/utilityDetector';

// ── Noise words stripped during normalization ──────────────────────────────
const NOISE_WORDS = new Set([
  'company', 'co', 'corp', 'corporation', 'inc', 'incorporated',
  'llc', 'ltd', 'limited', 'electric', 'electrical', 'electricity',
  'power', 'energy', 'utilities', 'utility', 'service', 'services',
  'light', 'lights', 'gas', 'and', 'the', 'of', '&',
]);

/**
 * Normalize a utility name for comparison:
 *  - lower-case
 *  - remove punctuation except spaces
 *  - collapse multiple spaces
 *  - remove common noise words
 */
export function normalizeUtilityName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')   // strip punctuation
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(w => w.length > 0 && !NOISE_WORDS.has(w))
    .join(' ');
}

export interface MatchedUtility {
  id: string;
  utilityName: string;
  state: string;
  defaultResidentialRate: number | null;
  netMetering: boolean;
  source: 'db_exact' | 'db_fuzzy' | 'state_fallback' | 'auto_discovered';
  similarity?: number;
}

/**
 * Try to match a parsed utility name against the DB + state fallback data.
 *
 * @param parsedName   Raw utility name from OCR/LLM (e.g. "CENTRAL MAINE POWER CO.")
 * @param stateCode    2-letter state code from geocoder (e.g. "ME"), used for P3 fallback
 * @returns            Matched utility record, or null if no match found
 */
export async function matchUtility(
  parsedName: string | null | undefined,
  stateCode: string | null | undefined,
): Promise<MatchedUtility | null> {
  if (!parsedName || parsedName.trim().length < 3) return null;

  const normalized = normalizeUtilityName(parsedName);
  if (!normalized) return null;

  const sql = getDb();

  // ── P1: Exact match (case-insensitive) ──────────────────────────────────
  try {
    const exactRows = await sql`
      SELECT id, utility_name, state, default_residential_rate, net_metering, source
      FROM utility_policies
      WHERE LOWER(TRIM(utility_name)) = LOWER(TRIM(${parsedName}))
      LIMIT 1
    `;
    if (exactRows.length > 0) {
      const r = exactRows[0];
      return {
        id: r.id as string,
        utilityName: r.utility_name as string,
        state: r.state as string,
        defaultResidentialRate: r.default_residential_rate as number | null,
        netMetering: (r.net_metering as boolean) ?? true,
        source: 'db_exact',
      };
    }
  } catch (e) {
    console.warn('[utilityMatcher] P1 exact query failed:', e instanceof Error ? e.message : e);
  }

  // ── P2: pg_trgm fuzzy match (similarity > 0.45) ──────────────────────────
  // State filter applied when available to reduce false positives
  try {
    // Try with pg_trgm first; if extension not installed this will throw
    const fuzzyRows = stateCode
      ? await sql`
          SELECT id, utility_name, state, default_residential_rate, net_metering, source,
                 similarity(LOWER(utility_name), LOWER(${parsedName})) AS sim
          FROM utility_policies
          WHERE state = ${stateCode}
            AND similarity(LOWER(utility_name), LOWER(${parsedName})) > 0.45
          ORDER BY sim DESC
          LIMIT 1
        `
      : await sql`
          SELECT id, utility_name, state, default_residential_rate, net_metering, source,
                 similarity(LOWER(utility_name), LOWER(${parsedName})) AS sim
          FROM utility_policies
          WHERE similarity(LOWER(utility_name), LOWER(${parsedName})) > 0.45
          ORDER BY sim DESC
          LIMIT 1
        `;

    if (fuzzyRows.length > 0) {
      const r = fuzzyRows[0];
      return {
        id: r.id as string,
        utilityName: r.utility_name as string,
        state: r.state as string,
        defaultResidentialRate: r.default_residential_rate as number | null,
        netMetering: (r.net_metering as boolean) ?? true,
        source: 'db_fuzzy',
        similarity: r.sim as number,
      };
    }
  } catch (e) {
    console.warn('[utilityMatcher] P2 fuzzy query failed (pg_trgm may not be installed):', e instanceof Error ? e.message : e);
  }

  // ── P3: STATE_UTILITY_FALLBACK — substring/token match ───────────────────
  // Search the known-major-utility lists in the state fallback data
  const fallbackEntry = stateCode ? STATE_UTILITY_FALLBACK[stateCode] : null;
  if (fallbackEntry?.majorUtilities) {
    // Try to find a known utility whose normalized name tokens appear in the parsed name
    const parsedNorm = normalized; // already normalized above

    for (const knownName of fallbackEntry.majorUtilities) {
      const knownNorm = normalizeUtilityName(knownName);
      if (!knownNorm) continue;

      // Match if normalized known name tokens are all present in parsed name,
      // or parsed name tokens are all present in known name
      const knownTokens = knownNorm.split(' ').filter(t => t.length > 2);
      const parsedTokens = parsedNorm.split(' ').filter(t => t.length > 2);

      const knownInParsed = knownTokens.length > 0 && knownTokens.every(t => parsedNorm.includes(t));
      const parsedInKnown = parsedTokens.length > 0 && parsedTokens.every(t => knownNorm.includes(t));

      if (knownInParsed || parsedInKnown) {
        // Found a match in state fallback — check if a DB row exists for this name
        // If not, auto-insert as pending
        const autoId = await ensureUtilityRow(knownName, stateCode!, fallbackEntry.avgRate);
        return {
          id: autoId,
          utilityName: knownName,
          state: stateCode!,
          defaultResidentialRate: fallbackEntry.avgRate,
          netMetering: fallbackEntry.netMetering ?? true,
          source: 'state_fallback',
        };
      }
    }
  }

  // ── P4: Auto-discover — insert the raw parsed name as pending ────────────
  // Only do this if we have a stateCode so the record is at least state-scoped
  if (stateCode && parsedName.trim().length >= 5) {
    try {
      const discoveredId = await ensureUtilityRow(parsedName.trim(), stateCode, null, true);
      const fallbackRate = fallbackEntry?.avgRate ?? null;
      return {
        id: discoveredId,
        utilityName: parsedName.trim(),
        state: stateCode,
        defaultResidentialRate: fallbackRate,
        netMetering: true,
        source: 'auto_discovered',
      };
    } catch (e) {
      console.warn('[utilityMatcher] P4 auto-discover insert failed:', e instanceof Error ? e.message : e);
    }
  }

  return null;
}

/**
 * Ensure a utility_policies row exists for the given name+state.
 * Uses INSERT ... ON CONFLICT DO NOTHING so it's safe to call repeatedly.
 * Returns the row's id.
 */
async function ensureUtilityRow(
  utilityName: string,
  state: string,
  defaultRate: number | null,
  isAutoDiscovered = false,
): Promise<string> {
  const sql = getDb();
  const source = isAutoDiscovered ? 'auto_discovered' : 'state_fallback';

  // Try to find existing row first
  const existing = await sql`
    SELECT id FROM utility_policies
    WHERE LOWER(TRIM(utility_name)) = LOWER(TRIM(${utilityName}))
      AND state = ${state}
    LIMIT 1
  `;
  if (existing.length > 0) return existing[0].id as string;

  // Insert new row
  const inserted = await sql`
    INSERT INTO utility_policies
      (utility_name, state, country, net_metering, default_residential_rate, source)
    VALUES
      (${utilityName}, ${state}, 'US', true, ${defaultRate ?? null}, ${source})
    ON CONFLICT DO NOTHING
    RETURNING id
  `;

  if (inserted.length > 0) return inserted[0].id as string;

  // Race condition — row was inserted by another request, fetch it
  const refetch = await sql`
    SELECT id FROM utility_policies
    WHERE LOWER(TRIM(utility_name)) = LOWER(TRIM(${utilityName}))
      AND state = ${state}
    LIMIT 1
  `;
  return refetch[0]?.id as string ?? '';
}