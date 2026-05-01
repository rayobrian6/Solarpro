/**
 * lib/billEnrichment.ts — Post-Parse Utility Enrichment Layer
 *
 * Runs AFTER every successful bill parse (Claude or OCR+GPT).
 * Does NOT call Claude, does NOT call any external API.
 * Pure DB + in-memory logic only.
 *
 * What it does:
 *   1. Normalize utility name → canonical ID (COMED_IL, MILFORD_IA, etc.)
 *   2. Upsert utility_policies row:
 *        - If missing → insert with parsed rate + lastSeen
 *        - If exists  → update avgRate if parsed data is better, update lastSeen
 *   3. Validate parsed bill data (rate range, usage plausibility)
 *   4. Fill missing fields from DB (rate fallback, net metering)
 *   5. Return enriched result — caller merges back into BillExtractResult
 *
 * Constraints:
 *   - Never overwrites valid parsed data blindly
 *   - Rate fallback only when parsed rate is missing or out of range
 *   - All DB ops wrapped in try/catch — enrichment failure never blocks parse result
 *   - Lightweight + fast: single DB upsert, no external calls
 */

import { getDbReady } from '@/lib/db-neon';
import { normalizeUtility, type CanonicalUtility } from '@/lib/utilityNormalizer';
import { STATE_UTILITY_FALLBACK } from '@/lib/utilityDetector';
import { computeBillConfidence, type BillConfidenceResult, type RateSourceType } from '@/lib/billConfidence';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BillEnrichmentInput {
  utilityName?: string | null;
  state?: string | null;
  parsedRate?: number | null;       // $/kWh from bill
  monthlyKwh?: number | null;       // current month usage
  annualKwh?: number | null;        // estimated annual
  monthlyHistory?: number[] | null; // 12-month array
  billingPeriodStart?: string | null;
  billingPeriodEnd?: string | null;
}

export interface BillEnrichmentResult {
  // Normalized utility
  canonicalId: string | null;        // e.g. "MILFORD_IA"
  canonicalName: string | null;      // e.g. "Milford Municipal Utilities"
  normalizedState: string | null;

  // Rate resolution
  effectiveRate: number | null;      // final rate to use for sizing
  rateSource: 'parsed' | 'db' | 'canonical' | 'state_fallback' | 'none';
  rateCorrected: boolean;            // true if parsed rate was replaced

  // Net metering
  netMetering: boolean | null;
  netMeteringSource: 'db' | 'canonical' | 'state_fallback' | 'none';

  // Validation flags
  validation: {
    rateValid: boolean;
    rateOutOfRange: boolean;         // outside $0.05–$0.50
    usageValid: boolean;
    usageImplausible: boolean;       // monthly < 50 or > 10000 kWh
    missingMonths: boolean;          // < 3 months in history
    combinedBill: boolean;           // water/sewer detected (electric rate may be lower)
  };

  // DB enrichment log
  dbAction: 'inserted' | 'updated' | 'skipped' | 'failed';
  enrichmentLog: string[];

  // Confidence scoring (computed after enrichment, attached here for upstream use)
  meta: {
    confidence: BillConfidenceResult;
  };
}

// ─── Validation constants ─────────────────────────────────────────────────────

const RATE_MIN = 0.05;   // $/kWh — below this is implausible residential electric rate
const RATE_MAX = 0.50;   // $/kWh — above this is implausible (Hawaii is ~0.40)
const USAGE_MIN = 50;    // kWh/month — below this is likely a parsing error
const USAGE_MAX = 10000; // kWh/month — above this is implausible residential

// ─── Main enrichment function ─────────────────────────────────────────────────

/**
 * enrichBillData — runs after every successful bill parse.
 *
 * Safe to call from bill-upload route. Never throws — all errors
 * are caught and returned in enrichmentLog.
 */
export async function enrichBillData(
  input: BillEnrichmentInput,
): Promise<BillEnrichmentResult> {
  const log: string[] = [];
  const result: BillEnrichmentResult = {
    canonicalId: null,
    canonicalName: null,
    normalizedState: null,
    effectiveRate: null,
    rateSource: 'none',
    rateCorrected: false,
    netMetering: null,
    netMeteringSource: 'none',
    validation: {
      rateValid: true,
      rateOutOfRange: false,
      usageValid: true,
      usageImplausible: false,
      missingMonths: false,
      combinedBill: false,
    },
    dbAction: 'skipped',
    enrichmentLog: log,
    // meta.confidence is computed at the end of enrichBillData() with full context
    meta: {
      confidence: computeBillConfidence({}),  // placeholder — replaced below
    },
  };

  const { utilityName, state, parsedRate, monthlyKwh, annualKwh, monthlyHistory } = input;

  // ── Step 1: Validate parsed data ──────────────────────────────────────────

  // Rate validation
  if (parsedRate !== null && parsedRate !== undefined) {
    if (parsedRate < RATE_MIN || parsedRate > RATE_MAX) {
      result.validation.rateOutOfRange = true;
      result.validation.rateValid = false;
      log.push(`[enrichment] Rate out of range: $${parsedRate}/kWh (valid: $${RATE_MIN}–$${RATE_MAX})`);
    } else {
      log.push(`[enrichment] Rate valid: $${parsedRate}/kWh`);
    }
  }

  // Usage validation
  const effectiveMonthly = monthlyKwh ?? (
    monthlyHistory && monthlyHistory.length > 0
      ? monthlyHistory[monthlyHistory.length - 1]
      : null
  );
  if (effectiveMonthly !== null && effectiveMonthly !== undefined) {
    if (effectiveMonthly < USAGE_MIN || effectiveMonthly > USAGE_MAX) {
      result.validation.usageImplausible = true;
      result.validation.usageValid = false;
      log.push(`[enrichment] Monthly usage implausible: ${effectiveMonthly} kWh`);
    }
  }

  // Monthly history completeness
  const validMonths = monthlyHistory?.filter(v => v > 0) ?? [];
  if (validMonths.length > 0 && validMonths.length < 3) {
    result.validation.missingMonths = true;
    log.push(`[enrichment] Only ${validMonths.length} months of history found (< 3)`);
  }

  // ── Step 2: Normalize utility name ────────────────────────────────────────

  let canonical: CanonicalUtility | null = null;

  if (utilityName) {
    canonical = normalizeUtility(utilityName, state);
    if (canonical) {
      result.canonicalId = canonical.id;
      result.canonicalName = canonical.name;
      result.normalizedState = canonical.state;
      log.push(`[enrichment] Normalized: "${utilityName}" → ${canonical.id}`);
    } else {
      log.push(`[enrichment] No canonical match for: "${utilityName}"`);
    }
  }

  // ── Step 3: Resolve effective rate ────────────────────────────────────────

  // Priority: valid parsed rate → DB rate → canonical rate → state fallback
  const rateIsValid = parsedRate !== null && parsedRate !== undefined
    && parsedRate >= RATE_MIN && parsedRate <= RATE_MAX;

  if (rateIsValid) {
    result.effectiveRate = parsedRate!;
    result.rateSource = 'parsed';
    log.push(`[enrichment] Using parsed rate: $${parsedRate}/kWh`);
  } else {
    // Try DB first
    const dbRate = await fetchRateFromDb(utilityName, state, log);
    if (dbRate !== null) {
      result.effectiveRate = dbRate;
      result.rateSource = 'db';
      result.rateCorrected = parsedRate !== null && parsedRate !== undefined;
      log.push(`[enrichment] Using DB rate: $${dbRate}/kWh${result.rateCorrected ? ` (replaced invalid parsed rate $${parsedRate})` : ''}`);
    } else if (canonical) {
      result.effectiveRate = canonical.avgRate;
      result.rateSource = 'canonical';
      result.rateCorrected = parsedRate !== null && parsedRate !== undefined;
      log.push(`[enrichment] Using canonical rate: $${canonical.avgRate}/kWh for ${canonical.id}`);
    } else if (state && STATE_UTILITY_FALLBACK[state.toUpperCase()]) {
      const stateData = STATE_UTILITY_FALLBACK[state.toUpperCase()];
      result.effectiveRate = stateData.avgRate;
      result.rateSource = 'state_fallback';
      result.rateCorrected = parsedRate !== null && parsedRate !== undefined;
      log.push(`[enrichment] Using state fallback rate: $${stateData.avgRate}/kWh for ${state}`);
    } else {
      log.push(`[enrichment] No rate fallback available`);
    }
  }

  // ── Step 4: Resolve net metering ──────────────────────────────────────────

  if (canonical) {
    result.netMetering = canonical.netMetering;
    result.netMeteringSource = 'canonical';
  } else if (state && STATE_UTILITY_FALLBACK[state.toUpperCase()]) {
    result.netMetering = STATE_UTILITY_FALLBACK[state.toUpperCase()].netMetering;
    result.netMeteringSource = 'state_fallback';
  }

  // ── Step 5: Upsert utility_policies ───────────────────────────────────────

  if (utilityName && utilityName.trim().length >= 3) {
    result.dbAction = await upsertUtilityPolicy({
      utilityName: canonical?.name ?? utilityName,
      canonicalId: canonical?.id ?? null,
      state: canonical?.state ?? state ?? null,
      parsedRate: rateIsValid ? parsedRate! : null,
      netMetering: canonical?.netMetering ?? null,
      log,
    });
  } else {
    log.push(`[enrichment] Skipping DB upsert: no utility name`);
  }

  result.enrichmentLog = log;

  // ── Step 6: Compute confidence score ──────────────────────────────────────
  // Uses fully resolved enrichment context: validated flags, resolved rateSource, usage data.
  const confidence = computeBillConfidence({
    monthlyUsage:     input.monthlyHistory ?? null,
    annualUsage:      input.annualKwh ?? null,
    monthlyKwh:       input.monthlyKwh ?? null,
    costPerKwh:       result.effectiveRate ?? input.parsedRate ?? null,
    rateSource:       result.rateSource as RateSourceType,
    totalBill:        null,  // not available in enrichment input (bill-upload has it)
    hasCustomerName:  false, // not available in enrichment input
    hasUtilityName:   !!(input.utilityName && input.utilityName.trim().length > 0),
    hasServiceAddress: false, // not available in enrichment input
    hasAccountNumber:  false, // not available in enrichment input
    hasBillingPeriod:  !!(input.billingPeriodStart || input.billingPeriodEnd),
    validationFlags: {
      rateOutOfRange:   result.validation.rateOutOfRange,
      rateValid:        result.validation.rateValid,
      usageValid:       result.validation.usageValid,
      usageImplausible: result.validation.usageImplausible,
      missingMonths:    result.validation.missingMonths,
      combinedBill:     result.validation.combinedBill,
    },
  });
  result.meta = { confidence };

  log.forEach(l => console.log(l));
  return result;
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function fetchRateFromDb(
  utilityName: string | null | undefined,
  state: string | null | undefined,
  log: string[],
): Promise<number | null> {
  if (!utilityName) return null;
  try {
    const sql = await getDbReady();
    // Try exact match first, then trigram fuzzy
    const rows = await sql`
      SELECT retail_rate, default_residential_rate
      FROM utility_policies
      WHERE LOWER(TRIM(utility_name)) = LOWER(TRIM(${utilityName}))
        ${state ? sql`AND state = ${state.toUpperCase()}` : sql``}
      LIMIT 1
    `;
    if (rows.length > 0) {
      const rate = (rows[0].retail_rate ?? rows[0].default_residential_rate) as number | null;
      if (rate && rate >= RATE_MIN && rate <= RATE_MAX) {
        log.push(`[enrichment] DB rate found (exact): $${rate}/kWh`);
        return rate;
      }
    }

    // Try trigram fuzzy match if exact fails
    if (state) {
      const fuzzyRows = await sql`
        SELECT retail_rate, default_residential_rate
        FROM utility_policies
        WHERE state = ${state.toUpperCase()}
          AND similarity(LOWER(utility_name), LOWER(${utilityName})) > 0.45
        ORDER BY similarity(LOWER(utility_name), LOWER(${utilityName})) DESC
        LIMIT 1
      `.catch(() => [] as any[]);

      if (fuzzyRows.length > 0) {
        const rate = (fuzzyRows[0].retail_rate ?? fuzzyRows[0].default_residential_rate) as number | null;
        if (rate && rate >= RATE_MIN && rate <= RATE_MAX) {
          log.push(`[enrichment] DB rate found (fuzzy): $${rate}/kWh`);
          return rate;
        }
      }
    }
  } catch (e) {
    log.push(`[enrichment] DB rate fetch failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  return null;
}

interface UpsertInput {
  utilityName: string;
  canonicalId: string | null;
  state: string | null;
  parsedRate: number | null;
  netMetering: boolean | null;
  log: string[];
}

async function upsertUtilityPolicy(input: UpsertInput): Promise<BillEnrichmentResult['dbAction']> {
  const { utilityName, canonicalId, state, parsedRate, netMetering, log } = input;
  try {
    const sql = await getDbReady();
    const now = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // Check if utility already exists (by canonical name or parsed name)
    const existing = await sql`
      SELECT id, retail_rate, last_updated
      FROM utility_policies
      WHERE LOWER(TRIM(utility_name)) = LOWER(TRIM(${utilityName}))
        ${state ? sql`AND state = ${state.toUpperCase()}` : sql``}
      LIMIT 1
    `;

    if (existing.length > 0) {
      // UPDATE: refresh last_seen, update rate only if we have better data
      const currentRate = existing[0].retail_rate as number | null;
      const shouldUpdateRate = parsedRate !== null
        && (currentRate === null || currentRate <= 0);

      if (shouldUpdateRate) {
        await sql`
          UPDATE utility_policies
          SET
            retail_rate   = ${parsedRate},
            last_updated  = ${now},
            updated_at    = NOW(),
            source        = 'bill_parsed'
          WHERE id = ${existing[0].id}
        `;
        log.push(`[enrichment] DB updated: ${utilityName} rate=$${parsedRate}/kWh last_updated=${now}`);
      } else {
        // Just update last_seen timestamp
        await sql`
          UPDATE utility_policies
          SET last_updated = ${now}, updated_at = NOW()
          WHERE id = ${existing[0].id}
        `;
        log.push(`[enrichment] DB touched: ${utilityName} last_updated=${now}`);
      }
      return 'updated';
    } else {
      // INSERT: new utility discovered from bill
      await sql`
        INSERT INTO utility_policies (
          utility_name,
          state,
          country,
          net_metering,
          retail_rate,
          default_residential_rate,
          source,
          last_updated,
          created_at,
          updated_at
        ) VALUES (
          ${utilityName},
          ${state?.toUpperCase() ?? 'US'},
          'US',
          ${netMetering ?? true},
          ${parsedRate},
          ${parsedRate},
          ${'bill_parsed'},
          ${now},
          NOW(),
          NOW()
        )
      `;
      log.push(`[enrichment] DB inserted: new utility "${utilityName}" state=${state ?? 'unknown'} rate=$${parsedRate ?? 'null'}/kWh`);
      return 'inserted';
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.push(`[enrichment] DB upsert failed: ${msg}`);
    return 'failed';
  }
}