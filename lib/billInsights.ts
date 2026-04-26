/**
 * lib/billInsights.ts — Bill Intelligence Layer (v47.306)
 *
 * SAFE, NON-DESTRUCTIVE enhancement that attaches a `billInsights` object
 * to any parsed BillExtractResult. This module NEVER modifies existing fields.
 *
 * Steps implemented:
 *   1. BillInsights object shape
 *   2. Combined utility detection (keyword scan on raw OCR text)
 *   3. Safe bill-derived rate (monthlyBill / monthlyUsage, validated)
 *   4. Electric subtotal extraction (keyword-matched line sum)
 *   5. Suggested rate decision logic (no override of existing rate)
 *   6. overrideRecommended flag
 *   7. All structured log tags: [BILL_INSIGHTS] [COMBINED_UTILITY] [ELECTRIC_SUBTOTAL]
 *      [BILL_DERIVED_RATE] [SUGGESTED_RATE]
 *
 * RULES:
 *   - Does NOT replace or mutate any existing BillExtractResult field
 *   - Does NOT override the final rate automatically — only suggests
 *   - Returns a full BillInsights object on every call (never throws)
 *   - "low confidence" path returns billInsights.suggestedRate = null and
 *     overrideRecommended = false — safe no-op for existing pipeline
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BillInsights {
  /** True when non-electric utility charges are detected in the raw bill text */
  combinedUtilityDetected: boolean;

  /** List of non-electric service keywords found (e.g. ["water", "gas"]) */
  detectedServices: string[];

  /**
   * Sum of line items matching electric-only keywords.
   * null if extraction was not confident enough to isolate electric charges.
   */
  electricSubtotal: number | null;

  /**
   * totalAmount / monthlyKwh — only set when both exist and result is in [0.05, 0.50].
   * null when data is missing or out of range.
   */
  billDerivedRate: number | null;

  /**
   * Where the suggested rate came from:
   *   "existing"         — no better data found; keep existing pipeline rate
   *   "bill-derived"     — clean single-utility bill: billDerivedRate is reliable
   *   "electric-subtotal"— combined bill: electricSubtotal / monthlyKwh
   */
  rateSource: 'existing' | 'bill-derived' | 'electric-subtotal';

  /** Overall confidence in the bill insights analysis */
  confidence: 'high' | 'medium' | 'low';

  /**
   * Suggested rate in $/kWh.
   * NEVER automatically applied — only available for UI display or manual override.
   * null when confidence is too low or combined utility with no electric subtotal.
   */
  suggestedRate: number | null;

  /**
   * True when the suggested rate differs meaningfully from the current rate
   * AND conditions are safe enough to recommend an override.
   * Must be acted on explicitly — the pipeline never auto-applies this.
   */
  overrideRecommended: boolean;
}

// ─── Keyword lists ────────────────────────────────────────────────────────────

/**
 * Step 2 — Non-electric utility service keywords.
 * Any of these present in the raw bill text indicates a combined utility bill.
 */
const NON_ELECTRIC_KEYWORDS: string[] = [
  'water',
  'sewer',
  'wastewater',
  'stormwater',
  'storm water',
  'natural gas',
  'gas service',
  'gas charge',
  'gas usage',
  'trash',
  'refuse',
  'sanitation',
  'recycling',
  'solid waste',
  'propane',
];

/**
 * Step 4 — Electric-only charge line keywords.
 * Lines containing these are summed to derive electricSubtotal on combined bills.
 * Order matters: more specific patterns first.
 */
const ELECTRIC_KEYWORDS: string[] = [
  'energy charge',
  'kwh charge',
  'power cost',
  'fuel adjustment',
  'fuel cost adjustment',
  'purchased power',
  'electricity charge',
  'electric service',
  'electric charge',
  'distribution charge',
  'transmission charge',
  'generation charge',
  'eca',       // Energy Cost Adjustment
  'electric',  // broad fallback — must be last
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract all dollar amounts from a single text line.
 * Handles formats: $123.45  123.45  1,234.56
 * Returns the largest positive dollar value found on the line.
 */
function extractDollarFromLine(line: string): number | null {
  // Match patterns like $1,234.56 or 1234.56 or 123.45
  const matches = [...line.matchAll(/\$?\s*([\d,]+\.\d{2})\b/g)];
  if (matches.length === 0) return null;

  const values = matches
    .map(m => parseFloat(m[1].replace(/,/g, '')))
    .filter(v => !isNaN(v) && v > 0);

  if (values.length === 0) return null;

  // Return the largest value on the line (avoids picking up small rate figures)
  return Math.max(...values);
}

/**
 * Determine if a rate value is "significantly different" from a reference rate.
 * Threshold: > 15% relative difference.
 */
function ratesDifferSignificantly(suggested: number, current: number): boolean {
  if (current <= 0) return false;
  const pctDiff = Math.abs(suggested - current) / current;
  return pctDiff > 0.15;
}

// ─── Core Engine ─────────────────────────────────────────────────────────────

/**
 * computeBillInsights — Step 1-6 master function
 *
 * @param rawText      Raw OCR/extracted text from the bill
 * @param monthlyBill  totalAmount from BillExtractResult (existing field, not modified)
 * @param monthlyUsage monthlyKwh from BillExtractResult (existing field, not modified)
 * @param currentRate  electricityRate from BillExtractResult (existing field, not modified)
 *
 * @returns BillInsights — always a complete object, never throws
 */
export function computeBillInsights(
  rawText: string,
  monthlyBill: number | undefined | null,
  monthlyUsage: number | undefined | null,
  currentRate: number | undefined | null,
): BillInsights {

  // ── Initialize with safe defaults ─────────────────────────────────────────
  const insights: BillInsights = {
    combinedUtilityDetected: false,
    detectedServices: [],
    electricSubtotal: null,
    billDerivedRate: null,
    rateSource: 'existing',
    confidence: 'high',
    suggestedRate: null,
    overrideRecommended: false,
  };

  // Guard: need at least some raw text to analyze
  const text = (rawText ?? '').toLowerCase();
  if (!text || text.length < 20) {
    console.log('[BILL_INSIGHTS] rawText too short — returning default insights');
    insights.confidence = 'low';
    return insights;
  }

  // ── Step 2: Combined utility detection ────────────────────────────────────
  for (const keyword of NON_ELECTRIC_KEYWORDS) {
    if (text.includes(keyword)) {
      insights.combinedUtilityDetected = true;
      if (!insights.detectedServices.includes(keyword)) {
        insights.detectedServices.push(keyword);
      }
    }
  }

  if (insights.combinedUtilityDetected) {
    console.log(
      `[COMBINED_UTILITY] detected=true services=[${insights.detectedServices.join(', ')}]`
    );
  } else {
    console.log('[COMBINED_UTILITY] detected=false — appears to be electric-only bill');
  }

  // ── Step 3: Bill-derived rate (safe, validated) ───────────────────────────
  const hasBill  = typeof monthlyBill  === 'number' && monthlyBill  > 0;
  const hasUsage = typeof monthlyUsage === 'number' && monthlyUsage > 0;

  if (hasBill && hasUsage) {
    const derivedRate = monthlyBill! / monthlyUsage!;
    // Validate: must be in plausible US electricity rate range [$0.05 – $0.50/kWh]
    if (derivedRate > 0.05 && derivedRate < 0.50) {
      insights.billDerivedRate = Math.round(derivedRate * 10000) / 10000; // 4 decimals
      console.log(
        `[BILL_DERIVED_RATE] derived=$${insights.billDerivedRate.toFixed(4)}/kWh` +
        ` (bill=$${monthlyBill!.toFixed(2)} usage=${monthlyUsage!} kWh)`
      );
    } else {
      console.log(
        `[BILL_DERIVED_RATE] out-of-range=$${derivedRate.toFixed(4)} — not using` +
        ` (bill=$${monthlyBill!.toFixed(2)} usage=${monthlyUsage!} kWh)`
      );
    }
  } else {
    console.log(
      `[BILL_DERIVED_RATE] skipped — missing data` +
      ` (hasBill=${hasBill} hasUsage=${hasUsage})`
    );
  }

  // ── Step 4: Electric subtotal (safe attempt only) ─────────────────────────
  // Only attempt on combined bills — on clean electric bills, totalAmount IS the
  // electric subtotal, so there's no need to parse it again.
  if (insights.combinedUtilityDetected) {
    const lines = rawText.split('\n');
    let electricSum = 0;
    let matchedLineCount = 0;
    const matchedLines: string[] = [];

    for (const line of lines) {
      const lline = line.toLowerCase();
      const isElectricLine = ELECTRIC_KEYWORDS.some(kw => lline.includes(kw));
      if (!isElectricLine) continue;

      // Make sure this line doesn't also contain non-electric keywords
      // (e.g. "gas & electric combined charge" — skip it)
      const hasNonElectric = NON_ELECTRIC_KEYWORDS.some(kw => lline.includes(kw));
      if (hasNonElectric) {
        console.log(`[ELECTRIC_SUBTOTAL] skipping ambiguous line: "${line.trim().slice(0, 80)}"`);
        continue;
      }

      const dollarValue = extractDollarFromLine(line);
      if (dollarValue !== null && dollarValue > 0.5 && dollarValue < 5000) {
        electricSum += dollarValue;
        matchedLineCount++;
        matchedLines.push(`"${line.trim().slice(0, 60)}" => $${dollarValue.toFixed(2)}`);
      }
    }

    if (matchedLineCount > 0 && electricSum > 5) {
      insights.electricSubtotal = Math.round(electricSum * 100) / 100;
      console.log(
        `[ELECTRIC_SUBTOTAL] sum=$${insights.electricSubtotal.toFixed(2)}` +
        ` from ${matchedLineCount} lines: ${matchedLines.slice(0, 5).join(' | ')}`
      );
    } else {
      console.log(
        `[ELECTRIC_SUBTOTAL] not confident — matchedLines=${matchedLineCount}` +
        ` sum=$${electricSum.toFixed(2)} — leaving as null`
      );
    }
  }

  // ── Step 5: Safe rate decision (NEVER replaces existing rate) ─────────────
  if (insights.combinedUtilityDetected) {
    // Combined bill path
    if (insights.electricSubtotal !== null && hasUsage) {
      const subtotalRate = insights.electricSubtotal / monthlyUsage!;
      if (subtotalRate > 0.05 && subtotalRate < 0.50) {
        insights.suggestedRate = Math.round(subtotalRate * 10000) / 10000;
        insights.rateSource = 'electric-subtotal';
        insights.confidence = 'medium'; // medium: subtotal parsing is imperfect
        console.log(
          `[SUGGESTED_RATE] source=electric-subtotal` +
          ` rate=$${insights.suggestedRate.toFixed(4)}/kWh` +
          ` (electricSubtotal=$${insights.electricSubtotal.toFixed(2)} usage=${monthlyUsage} kWh)`
        );
      } else {
        // Subtotal rate out of range — don't use
        insights.suggestedRate = null;
        insights.rateSource = 'existing';
        insights.confidence = 'low';
        console.log(
          `[SUGGESTED_RATE] combined-subtotal-rate-out-of-range=$${subtotalRate.toFixed(4)} — suggestedRate=null`
        );
      }
    } else {
      // Combined bill but no reliable electric subtotal — do NOT use total bill amount
      insights.suggestedRate = null;
      insights.rateSource = 'existing';
      insights.confidence = 'low';
      console.log(
        '[SUGGESTED_RATE] combined-utility with no electric subtotal — ' +
        'refusing to derive rate from mixed total — suggestedRate=null confidence=low'
      );
    }
  } else {
    // Clean electric-only bill path
    if (insights.billDerivedRate !== null) {
      insights.suggestedRate = insights.billDerivedRate;
      insights.rateSource = 'bill-derived';
      insights.confidence = 'high';
      console.log(
        `[SUGGESTED_RATE] source=bill-derived` +
        ` rate=$${insights.suggestedRate.toFixed(4)}/kWh confidence=high`
      );
    } else {
      // No bill/usage data to derive rate from
      insights.suggestedRate = null;
      insights.rateSource = 'existing';
      insights.confidence = monthlyBill && monthlyUsage ? 'medium' : 'low';
      console.log(
        `[SUGGESTED_RATE] electric-only but no valid derived rate — suggestedRate=null`
      );
    }
  }

  // ── Step 6: overrideRecommended flag ──────────────────────────────────────
  // Safe to recommend override only under two specific conditions:
  //   A. Clean electric bill with a derived rate that differs significantly from current
  //   B. Combined bill with a reliable electric subtotal rate
  const hasCurrentRate = typeof currentRate === 'number' && currentRate > 0;
  const hasSuggestedRate = insights.suggestedRate !== null;

  if (!insights.combinedUtilityDetected && hasSuggestedRate && hasCurrentRate) {
    // Condition A: clean bill, meaningful rate difference
    if (ratesDifferSignificantly(insights.suggestedRate!, currentRate!)) {
      insights.overrideRecommended = true;
      console.log(
        `[BILL_INSIGHTS] overrideRecommended=true` +
        ` (current=$${currentRate!.toFixed(4)} suggested=$${insights.suggestedRate!.toFixed(4)}` +
        ` diff=${(Math.abs(insights.suggestedRate! - currentRate!) / currentRate! * 100).toFixed(1)}%)`
      );
    }
  } else if (insights.combinedUtilityDetected && insights.rateSource === 'electric-subtotal' && hasSuggestedRate) {
    // Condition B: combined bill with reliable electric subtotal
    insights.overrideRecommended = true;
    console.log(
      `[BILL_INSIGHTS] overrideRecommended=true` +
      ` (combined-utility electric-subtotal rate=$${insights.suggestedRate!.toFixed(4)})`
    );
  } else {
    console.log(
      `[BILL_INSIGHTS] overrideRecommended=false` +
      ` (combinedUtility=${insights.combinedUtilityDetected}` +
      ` hasSuggested=${hasSuggestedRate}` +
      ` hasCurrentRate=${hasCurrentRate})`
    );
  }

  // ── Final summary log ─────────────────────────────────────────────────────
  console.log(
    `[BILL_INSIGHTS] SUMMARY` +
    ` combinedUtility=${insights.combinedUtilityDetected}` +
    ` services=[${insights.detectedServices.join(',')}]` +
    ` electricSubtotal=${insights.electricSubtotal ?? 'null'}` +
    ` billDerivedRate=${insights.billDerivedRate ?? 'null'}` +
    ` suggestedRate=${insights.suggestedRate ?? 'null'}` +
    ` rateSource=${insights.rateSource}` +
    ` confidence=${insights.confidence}` +
    ` overrideRecommended=${insights.overrideRecommended}`
  );

  return insights;
}