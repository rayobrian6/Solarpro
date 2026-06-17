/**
 * lib/billConfidence.ts — Bill Parse Confidence Scoring
 *
 * Lightweight, deterministic confidence scoring for parsed + enriched bill data.
 * No external calls. No DB access. Runs synchronously in <1ms.
 *
 * Scoring dimensions:
 *   - usage:        based on months of data available
 *   - rate:         based on where the rate came from (parsed > DB > canonical > state)
 *   - completeness: based on which key fields are present
 *   - overall:      weighted average of the three dimensions
 *
 * Integration contract:
 *   computeBillConfidence(input) → BillConfidenceResult
 *   Attach to result.meta.confidence — additive only, never modifies existing fields.
 *
 * Scoring constants:
 *   high   = 1.0
 *   medium = 0.6
 *   low    = 0.3
 */

// ── Types ──────────────────────────────────────────────────────────────────

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export type RateSourceType =
  | 'parsed'
  | 'db'
  | 'canonical'
  | 'state_fallback'
  | 'state'       // alias used in some paths
  | 'national'
  | 'national_default'
  | 'none'
  | string;       // forward-compatible — unknown sources treated as low

export interface BillConfidenceInput {
  // Usage data
  monthlyUsage?: number[] | null;       // monthly kWh history array
  annualUsage?: number | null;          // annual kWh (direct or estimated)
  monthlyKwh?: number | null;           // single month kWh

  // Rate data
  costPerKwh?: number | null;           // $/kWh
  rateSource?: RateSourceType | null;   // where the rate came from

  // Bill totals
  totalBill?: number | null;            // total dollar amount on bill

  // Presence flags — for completeness scoring
  hasCustomerName?: boolean;
  hasUtilityName?: boolean;
  hasServiceAddress?: boolean;
  hasAccountNumber?: boolean;
  hasBillingPeriod?: boolean;

  // Validation flags from enrichment
  validationFlags?: {
    rateOutOfRange?: boolean;
    rateValid?: boolean;
    usageValid?: boolean;
    usageImplausible?: boolean;
    missingMonths?: boolean;
    combinedBill?: boolean;
  } | null;
}

export interface BillConfidenceResult {
  overall: number;            // 0.0–1.0
  usage: ConfidenceLevel;
  rate: ConfidenceLevel;
  completeness: ConfidenceLevel;
  // Diagnostics (for logging only — not sent to frontend)
  _debug: {
    monthsFound: number;
    hasAnnual: boolean;
    rateSource: string;
    rateInRange: boolean;
    fieldsPresent: number;
    fieldsMissing: number;
  };
}

// ── Scoring constants ──────────────────────────────────────────────────────

const SCORE: Record<ConfidenceLevel, number> = {
  high:   1.0,
  medium: 0.6,
  low:    0.3,
};

// Rate sources ranked: high confidence sources
const HIGH_RATE_SOURCES: RateSourceType[] = ['parsed'];
const MEDIUM_RATE_SOURCES: RateSourceType[] = ['db', 'canonical'];
const LOW_RATE_SOURCES: RateSourceType[] = ['state_fallback', 'state', 'national', 'national_default', 'none'];

// ── Core scoring functions ─────────────────────────────────────────────────

/**
 * scoreUsage — based on months of history available
 *
 * HIGH:   ≥ 10 months OR annualUsage directly present
 * MEDIUM: 4–9 months
 * LOW:    < 4 months OR no usage data at all
 */
function scoreUsage(input: BillConfidenceInput): {
  level: ConfidenceLevel;
  monthsFound: number;
  hasAnnual: boolean;
} {
  const history = input.monthlyUsage ?? [];
  const validMonths = history.filter(v => typeof v === 'number' && v > 0);
  const monthsFound = validMonths.length;
  const hasAnnual = (input.annualUsage ?? 0) > 0;

  let level: ConfidenceLevel;
  if (hasAnnual || monthsFound >= 10) {
    level = 'high';
  } else if (monthsFound >= 4) {
    level = 'medium';
  } else {
    level = 'low';
  }

  return { level, monthsFound, hasAnnual };
}

/**
 * scoreRate — based on rate source and validation flags
 *
 * HIGH:   rateSource === 'parsed' AND rate is within valid range
 * MEDIUM: rateSource is 'db' or 'canonical'
 * LOW:    rateSource is state/national fallback, unknown, or rate is out of range
 */
function scoreRate(input: BillConfidenceInput): {
  level: ConfidenceLevel;
  rateInRange: boolean;
  rateSource: string;
} {
  const rateSource = (input.rateSource ?? 'none') as string;
  const rateOutOfRange = input.validationFlags?.rateOutOfRange === true;
  const rateValid = input.validationFlags?.rateValid !== false; // default true if not set
  const hasRate = (input.costPerKwh ?? 0) > 0;

  // If rate is explicitly flagged out of range, cap at low
  if (rateOutOfRange || !rateValid) {
    return { level: 'low', rateInRange: false, rateSource };
  }

  // Validate the actual value, not mere presence — an implausible parsed rate
  // (e.g. $0.003 or $2.50/kWh) must not score 'high' just because it exists and
  // no validation flags were supplied.
  const cpk = input.costPerKwh ?? 0;
  const rateInRange = hasRate && cpk >= 0.05 && cpk <= 0.50;

  let level: ConfidenceLevel;
  if (HIGH_RATE_SOURCES.includes(rateSource as RateSourceType) && rateInRange) {
    level = 'high';
  } else if (MEDIUM_RATE_SOURCES.includes(rateSource as RateSourceType)) {
    level = 'medium';
  } else {
    // state/national/unknown/none
    level = 'low';
  }

  return { level, rateInRange, rateSource };
}

/**
 * scoreCompleteness — based on key field presence
 *
 * Fields scored (1 point each):
 *   customer name, utility name, service address, account number, billing period
 *
 * HIGH:   all 5 present (0 missing)
 * MEDIUM: 3–4 present (1–2 missing)
 * LOW:    ≤ 2 present (≥ 3 missing)
 */
function scoreCompleteness(input: BillConfidenceInput): {
  level: ConfidenceLevel;
  fieldsPresent: number;
  fieldsMissing: number;
} {
  const fields = [
    input.hasCustomerName  ?? false,
    input.hasUtilityName   ?? false,
    input.hasServiceAddress ?? false,
    input.hasAccountNumber ?? false,
    input.hasBillingPeriod ?? false,
  ];

  const fieldsPresent = fields.filter(Boolean).length;
  const fieldsMissing = fields.length - fieldsPresent;

  let level: ConfidenceLevel;
  if (fieldsMissing === 0) {
    level = 'high';
  } else if (fieldsMissing <= 2) {
    level = 'medium';
  } else {
    level = 'low';
  }

  return { level, fieldsPresent, fieldsMissing };
}

// ── Main export ────────────────────────────────────────────────────────────

/**
 * computeBillConfidence — main entry point.
 *
 * Runs synchronously in < 1ms. Safe to call anywhere.
 * Returns a BillConfidenceResult that can be attached to result.meta.confidence.
 */
export function computeBillConfidence(
  input: BillConfidenceInput,
): BillConfidenceResult {
  const usageResult       = scoreUsage(input);
  const rateResult        = scoreRate(input);
  const completenessResult = scoreCompleteness(input);

  // overall = arithmetic mean of the 3 dimension scores
  const overall = parseFloat((
    (SCORE[usageResult.level] + SCORE[rateResult.level] + SCORE[completenessResult.level]) / 3
  ).toFixed(3));

  return {
    overall,
    usage:        usageResult.level,
    rate:         rateResult.level,
    completeness: completenessResult.level,
    _debug: {
      monthsFound:  usageResult.monthsFound,
      hasAnnual:    usageResult.hasAnnual,
      rateSource:   rateResult.rateSource,
      rateInRange:  rateResult.rateInRange,
      fieldsPresent: completenessResult.fieldsPresent,
      fieldsMissing: completenessResult.fieldsMissing,
    },
  };
}

/**
 * confidenceFromBillExtractResult — convenience wrapper that takes a
 * BillExtractResult-shaped object and builds the BillConfidenceInput for you.
 *
 * Used in bill-upload route to avoid manually mapping every field.
 */
export function confidenceFromBillExtractResult(bill: {
  monthlyUsageHistory?:  number[] | null;
  annualKwh?:            number | null;
  estimatedAnnualKwh?:   number | null;
  monthlyKwh?:           number | null;
  electricityRate?:      number | null;
  totalAmount?:          number | null;
  customerName?:         string | null;
  utilityProvider?:      string | null;
  serviceAddress?:       string | null;
  accountNumber?:        string | null;
  billingPeriodStart?:   string | null;
  billingPeriodEnd?:     string | null;
}, enrichmentRateSource?: RateSourceType | null): BillConfidenceResult {
  return computeBillConfidence({
    monthlyUsage:    bill.monthlyUsageHistory ?? null,
    annualUsage:     bill.annualKwh ?? bill.estimatedAnnualKwh ?? null,
    monthlyKwh:      bill.monthlyKwh ?? null,
    costPerKwh:      bill.electricityRate ?? null,
    rateSource:      enrichmentRateSource ?? (bill.electricityRate ? 'parsed' : 'none'),
    totalBill:       bill.totalAmount ?? null,
    hasCustomerName:   !!bill.customerName,
    hasUtilityName:    !!bill.utilityProvider,
    hasServiceAddress: !!bill.serviceAddress,
    hasAccountNumber:  !!bill.accountNumber,
    hasBillingPeriod:  !!(bill.billingPeriodStart || bill.billingPeriodEnd),
    validationFlags:   null, // populated by enrichment if available
  });
}