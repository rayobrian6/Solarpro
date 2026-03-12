/**
 * lib/billParser.ts
 * Stage 2 — Structured extraction from OCR text. No AI, no API calls.
 *
 * Scans raw OCR output for monthly kWh usage patterns and returns a clean
 * structured object with monthlyUsage (Jan–Dec) and annualUsage total.
 *
 * Supported source formats inside the bill:
 *   1. Handwritten / printed monthly lists:
 *        "Jan 555 kWh"  "Feb: 609"  "January 736 NWH"  "JAN 555"
 *   2. Monthly Usage Summary bar graph table (CMP, Eversource, etc.):
 *        Section header: "Your Monthly Usage Summary(kWh)"
 *        Rows:  "Jan  20  24  20"  (month-name + columns, col1 = current year daily avg)
 *        Daily avg × days-in-month → monthly kWh
 *   3. Explicit yearly total lines:
 *        "Total For 2025  6723 kWh"
 *        "Annual usage: 6,723 kWh"
 */

// ── Month metadata ───────────────────────────────────────────────────────────
export const MONTH_ORDER = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
] as const;
export type MonthKey = typeof MONTH_ORDER[number];

export const DAYS_IN_MONTH: Record<MonthKey, number> = {
  jan: 31, feb: 28, mar: 31, apr: 30, may: 31, jun: 30,
  jul: 31, aug: 31, sep: 30, oct: 31, nov: 30, dec: 31,
};

const MONTH_RE_SRC =
  '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?' +
  '|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

// ── Output types ─────────────────────────────────────────────────────────────
export interface MonthlyUsageResult {
  /** Map of month key → monthly kWh (e.g. { jan: 555, feb: 609, ... }) */
  monthlyUsage: Partial<Record<MonthKey, number>>;
  /** Sum of all detected months (or extrapolated annual if < 12 months) */
  annualUsage: number | null;
  /** Number of months with data */
  monthsFound: number;
  /** Source that produced the data */
  source: 'handwritten' | 'bar-graph' | 'annual-line' | 'none';
  /** Raw monthly array aligned to Jan–Dec (0 for missing months) */
  monthlyArray: number[];
}

// ── NWH / KWH normalisation ──────────────────────────────────────────────────
/**
 * Normalise OCR aliases for kWh before all pattern matching.
 * CMP handwritten bills often read as "NWH" or "KWH" (uppercase).
 */
function normalise(text: string): string {
  return text
    .replace(/\bN\.?W\.?H\.?\b/gi, 'kWh')
    .replace(/\bK\.?W\.?H\.?\b/g,  'kWh')
    .replace(/\bkw-h\b/gi,         'kWh');
}

// ── Validate a single monthly kWh value ──────────────────────────────────────
function isValidMonthly(v: number): boolean {
  return v > 0 && v <= 5000;
}

// ── Source 1: Handwritten / printed month lines ──────────────────────────────
/**
 * Match lines like:
 *   "Jan 555 kWh"  "Feb: 609 kWh"  "Jan 555"  "January 736"
 *   "JAN 555 kWh"  "Jan. 555"
 *
 * Requirements:
 *   - 3-digit to 5-digit value (50–50000 after kWh alias normalisation)
 *   - Optional "kWh" suffix
 *
 * Returns a map of { jan: 555, feb: 609, ... } for all months found.
 */
function parseHandwrittenLines(text: string): Partial<Record<MonthKey, number>> {
  const t = normalise(text);
  const pattern = new RegExp(
    `(${MONTH_RE_SRC})[a-z]*[\\s\\.\\:]+([1-9][0-9]{2,4})\\s*(?:kwh)?`,
    'gi',
  );
  const result: Partial<Record<MonthKey, number>> = {};
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(t)) !== null) {
    const key = m[1].slice(0, 3).toLowerCase() as MonthKey;
    const val = parseInt(m[2], 10);
    if (isValidMonthly(val)) result[key] = val;
  }
  return result;
}

// ── Source 2: Monthly Usage Summary bar graph table ──────────────────────────
/**
 * CMP and many other utilities print a table like:
 *
 *   Your Monthly Usage Summary(kWh)
 *   Month  2025  2024  2023
 *   Jan     20    24    20
 *   Feb     24    28    26
 *   ...
 *
 * Where the numbers are DAILY AVERAGES (kWh/day), not monthly totals.
 * We multiply by days-in-month to get actual monthly kWh.
 *
 * Detection strategy:
 *   1. Look for a header line matching "monthly usage summary"
 *   2. After header, scan each line for: MONTH_NAME  NUMBER [optional more numbers]
 *   3. Take the FIRST numeric column as current-year daily avg
 *   4. Accept values 1–200 as plausible daily averages
 *
 * Also handles the case where there is NO header — just month-name + small numbers.
 */
function parseBarGraphTable(text: string): Partial<Record<MonthKey, number>> {
  const result: Partial<Record<MonthKey, number>> = {};
  const lines = text.split('\n');

  // Find where the summary section starts (optional — improves precision)
  let sectionStart = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/monthly\s+usage\s+summary/i.test(lines[i])) {
      sectionStart = i;
      console.log(`[bill-parser] Bar graph section header at line ${i}: "${lines[i].trim()}"`);
      break;
    }
  }

  // Scan lines after section start for month rows
  const rowPat = new RegExp(
    `^\\s*(${MONTH_RE_SRC})[a-z]*\\s+([0-9]{1,3})(?:\\s+[0-9]{1,4})*\\s*$`,
    'i',
  );

  for (let i = sectionStart; i < lines.length; i++) {
    const m = lines[i].match(rowPat);
    if (!m) continue;
    const key = m[1].slice(0, 3).toLowerCase() as MonthKey;
    const val = parseInt(m[2], 10);
    // Daily averages are typically 1–200 kWh/day
    if (val >= 1 && val <= 200) {
      result[key] = val;
    }
  }

  return result;
}

/**
 * Convert daily averages from bar graph to monthly kWh totals.
 */
function dailyAvgToMonthly(
  dailyAvg: Partial<Record<MonthKey, number>>,
): Partial<Record<MonthKey, number>> {
  const result: Partial<Record<MonthKey, number>> = {};
  for (const m of MONTH_ORDER) {
    if (dailyAvg[m] !== undefined) {
      result[m] = Math.round(dailyAvg[m]! * DAYS_IN_MONTH[m]);
    }
  }
  return result;
}

// ── Source 3: Explicit annual total line ─────────────────────────────────────
/**
 * Match lines like:
 *   "Total For 2025  6723 kWh"
 *   "Annual usage: 6,723 kWh"
 *   "12-month total: 6723 kWh"
 *   "Last 12 months: 6,723 kWh"
 */
function parseAnnualLine(text: string): number | null {
  const t = normalise(text);
  const patterns = [
    /total\s+for\s+\d{4}[\s\:]+([0-9,]+)\s*kwh/i,
    /(?:annual|yearly|12[- ]month)\s+(?:usage|consumption|total)[\:\s]+([0-9,]+)\s*kwh/i,
    /(?:last\s+12\s+months?)[\:\s]+([0-9,]+)\s*kwh/i,
    /(?:12[- ]month\s+total)[\:\s]+([0-9,]+)\s*kwh/i,
  ];
  for (const pat of patterns) {
    const m = t.match(pat);
    if (m) {
      const val = parseFloat(m[1].replace(/,/g, ''));
      if (val > 0 && val < 999999) return val;
    }
  }
  return null;
}

// ── Validation ───────────────────────────────────────────────────────────────
/**
 * Validate and clean monthly usage values.
 * Rules:
 *   - Values must be 0–5000 kWh (clamp outliers to null)
 *   - If < 12 months, estimate annual from average of available months
 *   - If a month is 0/missing, leave as 0 (do not interpolate)
 */
function validateAndEstimate(
  monthly: Partial<Record<MonthKey, number>>,
  annualLine: number | null,
): { monthlyArray: number[]; annualUsage: number | null; monthsFound: number } {
  const monthlyArray: number[] = MONTH_ORDER.map(m => {
    const v = monthly[m] ?? 0;
    return isValidMonthly(v) ? v : 0;
  });

  const nonZero = monthlyArray.filter(v => v > 0);
  const monthsFound = nonZero.length;

  // Use explicit annual line if we have one
  if (annualLine && annualLine > 0) {
    return { monthlyArray, annualUsage: annualLine, monthsFound };
  }

  // All 12 months present — sum directly
  if (monthsFound >= 10) {
    return { monthlyArray, annualUsage: monthlyArray.reduce((a, b) => a + b, 0), monthsFound };
  }

  // Partial year — extrapolate from average
  if (monthsFound >= 3) {
    const avg = nonZero.reduce((a, b) => a + b, 0) / nonZero.length;
    return { monthlyArray, annualUsage: Math.round(avg * 12), monthsFound };
  }

  return { monthlyArray, annualUsage: null, monthsFound };
}

// ── Main export ──────────────────────────────────────────────────────────────
/**
 * Parse monthly kWh usage from raw OCR text.
 *
 * Priority:
 *   1. Handwritten/printed month lines (P1) — if ≥ 6 months detected
 *   2. Bar graph table (P2) — if ≥ 6 months detected
 *   3. Partial handwritten (P3) — if < 6 months but ≥ 1
 *   4. Annual line only (P4) — if no monthly data at all
 *
 * Logs [bill-parser] debug lines for every stage.
 */
export function parseMonthlyUsage(text: string): MonthlyUsageResult {
  console.log(`[bill-parser] Input text: ${text.length} chars`);

  // ── P1: Handwritten month lines ──────────────────────────────────────────
  const handwritten = parseHandwrittenLines(text);
  const hwCount = Object.keys(handwritten).length;
  console.log(`[bill-parser] Handwritten months detected: ${hwCount}`, hwCount > 0 ? JSON.stringify(handwritten) : '');

  // ── P2: Bar graph table ───────────────────────────────────────────────────
  const barDailyAvg = parseBarGraphTable(text);
  const barCount = Object.keys(barDailyAvg).length;
  console.log(`[bill-parser] Bar graph rows detected: ${barCount}`, barCount > 0 ? JSON.stringify(barDailyAvg) : '');

  const barMonthly = barCount > 0 ? dailyAvgToMonthly(barDailyAvg) : {};
  if (barCount > 0) {
    console.log('[bill-parser] Bar graph daily-avg → monthly totals:', JSON.stringify(barMonthly));
  }

  // ── P3: Annual line ───────────────────────────────────────────────────────
  const annualLine = parseAnnualLine(text);
  if (annualLine) console.log(`[bill-parser] Annual line detected: ${annualLine} kWh`);

  // ── Choose best source ────────────────────────────────────────────────────
  let chosen: Partial<Record<MonthKey, number>> = {};
  let source: MonthlyUsageResult['source'] = 'none';

  if (hwCount >= 6) {
    chosen = handwritten;
    source = 'handwritten';
  } else if (barCount >= 6) {
    chosen = barMonthly;
    source = 'bar-graph';
  } else if (hwCount >= 1) {
    chosen = handwritten;
    source = 'handwritten';
  }

  const { monthlyArray, annualUsage, monthsFound } = validateAndEstimate(chosen, annualLine);

  // If no monthly data at all but we have an annual line, use that
  const finalAnnual = annualUsage ?? (annualLine ?? null);
  const finalSource: MonthlyUsageResult['source'] =
    source !== 'none' ? source : (annualLine ? 'annual-line' : 'none');

  console.log(`[bill-parser] Result: source=${finalSource}, months=${monthsFound}, annual=${finalAnnual ?? 'n/a'}`);
  if (monthsFound > 0) {
    const obj = Object.fromEntries(MONTH_ORDER.map((m, i) => [m, monthlyArray[i]]));
    console.log('[bill-parser] Monthly usage object:', JSON.stringify(obj));
  }

  return {
    monthlyUsage: chosen,
    annualUsage: finalAnnual,
    monthsFound,
    source: finalSource,
    monthlyArray,
  };
}

// ── System size estimate ─────────────────────────────────────────────────────
/**
 * Estimate solar system size from annual kWh.
 * Uses a standard 1,200 kWh/kW/year production factor (US average).
 * For more accurate estimates, use utility-specific production factors.
 */
export function estimateSystemSize(annualKwh: number): {
  systemSizeKw: number;
  monthlyAverage: number;
} {
  const PRODUCTION_FACTOR = 1200; // kWh/kW/year (US average)
  const systemSizeKw = Math.round((annualKwh / PRODUCTION_FACTOR) * 10) / 10;
  const monthlyAverage = Math.round(annualKwh / 12);
  return { systemSizeKw, monthlyAverage };
}