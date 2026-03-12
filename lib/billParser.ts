/**
 * lib/billParser.ts
 * Deterministic, source-ranked utility bill usage extractor.
 *
 * DESIGN PRINCIPLES:
 *   1. Every extracted value carries source metadata (type, text, confidence).
 *   2. Source priority is strict and never reversed by fallback logic.
 *   3. The same input always produces the same output (no randomness, no AI rewrites).
 *   4. OpenAI/LLM may only FILL gaps — never override a stronger source.
 *
 * MONTHLY USAGE PRIORITY (highest → lowest):
 *   P1  Printed monthly table    (explicit month + kWh label, full 12-month)
 *   P2  Handwritten month list   (Jan 555 kWh / NWH — 6+ months)
 *   P3  Monthly usage summary    (Monthly Usage Summary kWh -- use values directly)
 *   P4  Partial handwritten      (< 6 months but ≥ 3 — use with lower confidence)
 *   P5  Annual ÷ 12              (last resort — only if no monthly data at all)
 *
 * ANNUAL USAGE PRIORITY:
 *   A1  Explicit handwritten/printed total ("Total for 2025 6723 kWh")
 *   A2  Sum of P1/P2/P3 monthly values (≥ 10 months present)
 *   A3  Extrapolation from partial monthly (avg × 12, ≥ 3 months)
 *   A4  None — do not guess
 *
 * UTILITY IDENTIFICATION PRIORITY:
 *   U1  Bill header / logo text (printed — highest confidence)
 *   U2  Known alias match in any part of text
 *   U3  Generic "X Electric / X Power / X Energy" pattern
 *   U4  None — do not fall back to location-based in this module
 */

// ── Month metadata ────────────────────────────────────────────────────────────
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

// ── Source evidence types ─────────────────────────────────────────────────────
export type SourceType =
  | 'printed_table'        // Explicit month + kWh column in a printed table
  | 'handwritten_list'     // Handwritten Jan–Dec list with kWh values
  | 'bar_graph_table'      // Monthly Usage Summary table -- monthly kWh totals
  | 'explicit_annual'      // "Total for 2025 6723 kWh" line
  | 'monthly_sum'          // Computed: sum of monthly values
  | 'extrapolated'         // Computed: avg × 12 from partial months
  | 'printed_header'       // Utility name from bill header
  | 'utility_alias'        // Utility name from known alias match
  | 'generic_pattern'      // Utility name from generic regex
  | 'none';

export interface ExtractedValue<T> {
  value: T;
  source_type: SourceType;
  source_text: string;     // The actual text that was matched
  confidence: number;      // 0.0 – 1.0
}

export interface BillParseResult {
  // Utility
  utility: ExtractedValue<string> | null;

  // Monthly usage (Jan–Dec aligned, 0 = missing)
  monthlyArray: number[];
  monthlySource: SourceType;
  monthlyConfidence: number;
  monthsFound: number;
  monthlyEvidence: string;   // Human-readable description of what was found

  // Annual usage
  annual: ExtractedValue<number> | null;
  annualCorroboration: number | null;  // explicit total if monthly sum exists

  // Current month usage (most recent bill period)
  currentMonthKwh: number | null;

  // Rate
  rate: ExtractedValue<number> | null;

  // Debug log lines (deterministic, same input = same log)
  debugLog: string[];
}

// ── NWH / KWH normalisation ───────────────────────────────────────────────────
function normalise(text: string): string {
  return text
    .replace(/\bN\.?W\.?H\.?\b/gi, 'kWh')
    .replace(/\bK\.?W\.?H\.?\b/g,  'kWh')
    .replace(/\bkw-h\b/gi,         'kWh')
    .replace(/\bki[vwN]h?\b/gi,    'kWh')   // Tesseract font artefacts: kivh, kiwh
    .replace(/\bkVVh\b/gi,         'kWh')   // double-V artefact
    .replace(/\bkWFh?\b/gi,        'kWh');  // kWF artefact
}

function isValidMonthly(v: number): boolean {
  return Number.isFinite(v) && v > 0 && v <= 5000;
}

// ── U1/U2/U3: Utility identification ─────────────────────────────────────────
const UTILITY_ALIASES: [RegExp, string][] = [
  [/central\s+maine\s+power|cmp\b/i,                   'Central Maine Power'],
  [/pacific\s+gas\s+(?:and|&)\s+electric|pg&e|pge/i,   'PG&E'],
  [/southern\s+california\s+edison|sce\b/i,             'Southern California Edison'],
  [/san\s+diego\s+gas\s+(?:and|&)\s+electric|sdg&e/i,  'SDG&E'],
  [/florida\s+power\s+(?:and|&)\s+light|fpl\b/i,       'Florida Power & Light'],
  [/duke\s+energy/i,                                    'Duke Energy'],
  [/dominion\s+energy/i,                                'Dominion Energy'],
  [/con\s+edison|consolidated\s+edison/i,               'Con Edison'],
  [/national\s+grid/i,                                  'National Grid'],
  [/xcel\s+energy/i,                                    'Xcel Energy'],
  [/ameren/i,                                           'Ameren'],
  [/comed\b|commonwealth\s+edison/i,                    'ComEd'],
  [/pse&g|public\s+service\s+electric/i,               'PSE&G'],
  [/georgia\s+power/i,                                  'Georgia Power'],
  [/entergy/i,                                          'Entergy'],
  [/centerpoint\s+energy/i,                             'CenterPoint Energy'],
  [/aep\b|american\s+electric\s+power/i,               'AEP'],
  [/eversource/i,                                       'Eversource'],
  [/nv\s+energy/i,                                      'NV Energy'],
  [/rocky\s+mountain\s+power/i,                         'Rocky Mountain Power'],
  [/puget\s+sound\s+energy|pse\b/i,                    'Puget Sound Energy'],
  [/hawaiian\s+electric|heco/i,                         'Hawaiian Electric'],
  [/pepco/i,                                            'Pepco'],
  [/bge\b|baltimore\s+gas/i,                           'BGE'],
  [/ppl\s+electric/i,                                   'PPL Electric'],
  [/peco\b/i,                                           'PECO'],
  [/consumers\s+energy/i,                               'Consumers Energy'],
  [/dte\s+energy/i,                                     'DTE Energy'],
  [/green\s+mountain\s+power/i,                         'Green Mountain Power'],
  [/salt\s+river\s+project|srp\b/i,                    'SRP'],
  [/tucson\s+electric|tep\b/i,                          'Tucson Electric Power'],
  [/arizona\s+public\s+service|aps\b/i,                'APS'],
  [/portland\s+general\s+electric/i,                    'Portland General Electric'],
  [/avista/i,                                           'Avista Utilities'],
  [/idaho\s+power/i,                                    'Idaho Power'],
  [/oncor/i,                                            'Oncor'],
  [/appalachian\s+power/i,                              'Appalachian Power'],
  [/black\s+hills\s+energy/i,                           'Black Hills Energy'],
  [/alliant\s+energy/i,                                 'Alliant Energy'],
  [/midamerican/i,                                      'MidAmerican Energy'],
  [/evergy|westar/i,                                    'Evergy'],
  [/cleco/i,                                            'Cleco'],
];

function extractUtility(text: string, log: string[]): ExtractedValue<string> | null {
  // Log the first 300 chars so we can see what the OCR captured at the top of the bill
  const preview = text.slice(0, 300).replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
  log.push(`[bill-parser] utility detection: first 300 chars = "${preview}"`);

  // U1: Check first 1000 chars (bill header area) — highest confidence.
  // 1000 chars instead of 500 because some OCR engines output logo/noise text before
  // the actual utility name, pushing it past the 500-char mark.
  const header = text.slice(0, 1000);
  for (const [pat, name] of UTILITY_ALIASES) {
    if (pat.test(header)) {
      const matchText = header.match(pat)?.[0] ?? name;
      log.push(`[bill-parser] utility: "${name}" from printed header (U1) — matched: "${matchText}"`);
      return { value: name, source_type: 'printed_header', source_text: matchText, confidence: 0.97 };
    }
  }

  // U2: Search full text for known alias
  for (const [pat, name] of UTILITY_ALIASES) {
    if (pat.test(text)) {
      const matchText = text.match(pat)?.[0] ?? name;
      log.push(`[bill-parser] utility: "${name}" from alias match in full text (U2) — matched: "${matchText}"`);
      return { value: name, source_type: 'utility_alias', source_text: matchText, confidence: 0.85 };
    }
  }

  // U3: Generic pattern — "X Electric / X Power / X Energy"
  // Case-insensitive start (removed [A-Z] anchor that failed on all-caps OCR like "CENTRAL MAINE POWER").
  const genericMatch = text.match(
    /\b([A-Za-z][a-zA-Z\s]{2,30}(?:Electric(?:ity)?|Power|Energy|Light(?:ing)?|Gas|Utilities?|Cooperative))\b/
  );
  if (genericMatch) {
    const name = genericMatch[1].trim();
    if (name.length > 4 && name.length < 60) {
      log.push(`[bill-parser] utility: "${name}" from generic pattern (U3)`);
      return { value: name, source_type: 'generic_pattern', source_text: genericMatch[0], confidence: 0.55 };
    }
  }

  log.push('[bill-parser] utility: not found — no alias or generic pattern matched');
  return null;
}

// ── P1: Printed monthly table ─────────────────────────────────────────────────
/**
 * Matches rows like:
 *   "Jan    555  kWh"
 *   "January  555  kWh"
 *   "Jan    555"     (when in a table context — preceded by kWh column header)
 *
 * This is distinct from P2 (handwritten) by requiring explicit "kWh" suffix OR
 * appearing inside a section with a kWh column header within 5 lines.
 *
 * Returns months AND the matched source texts for evidence logging.
 */
function parsePrintedTable(
  text: string,
  log: string[],
): { months: Partial<Record<MonthKey, number>>; evidence: string[] } {
  const t = normalise(text);
  const evidence: string[] = [];
  const months: Partial<Record<MonthKey, number>> = {};

  // Look for rows explicitly labeled with kWh
  const explicitPat = new RegExp(
    `(${MONTH_RE_SRC})[a-z]*\\s+([1-9][0-9]{0,3}(?:,[0-9]{3})?)\\s+kwh`,
    'gi',
  );
  let m: RegExpExecArray | null;
  while ((m = explicitPat.exec(t)) !== null) {
    const key = m[1].slice(0, 3).toLowerCase() as MonthKey;
    const val = parseInt(m[2].replace(/,/g, ''), 10);
    if (isValidMonthly(val) && val >= 100) {  // printed table values always >= 100 kWh
      months[key] = val;
      evidence.push(m[0].trim());
    }
  }

  const count = Object.keys(months).length;
  log.push(`[bill-parser] P1 printed table: ${count} months${count > 0 ? ' → ' + JSON.stringify(months) : ''}`);
  return { months, evidence };
}

// ── P2: Handwritten month list ────────────────────────────────────────────────
/**
 * Matches lines like:
 *   "Jan 555 kWh"  "Feb: 609"  "January 736"  "JAN 555"
 *   After NWH→kWh normalisation: "Jan 555 NWH" → "Jan 555 kWh"
 *
 * Does NOT require "kWh" suffix — bare "Jan 555" is accepted when value
 * is in the 100–5000 range (avoids matching dates, account numbers, etc.)
 *
 * Returns months AND matched source texts.
 */
function parseHandwrittenList(
  text: string,
  log: string[],
): { months: Partial<Record<MonthKey, number>>; evidence: string[] } {
  const t = normalise(text);
  const evidence: string[] = [];
  const months: Partial<Record<MonthKey, number>> = {};

  // Match: MonthName [optional year like 2024/2025] number [optional kWh]
  // e.g. "Jan 2025  362 kWh"  or  "Jan  362"  or  "January    1,234 kWh"
  // The year (1900-2099) is optional and must be skipped to get the kWh value.
  // IMPORTANT: Must NOT match billing period dates like "Jan 15, 2025" where
  // 15 is a day number, not a kWh value. We detect this by checking if the
  // number is followed by a comma (date separator) or is a plausible day (1-31)
  // without a kWh suffix in a date context.
  const pat = new RegExp(
    `(${MONTH_RE_SRC})[a-z]*` +                          // month name
    `[\\s\\.\\:\\-]+` +                                    // separator
    `(?:(?:19|20)\\d{2}[\\s\\.\\:\\-]+)?` +              // optional year (skip it)
    `([1-9][0-9]{0,2}(?:,[0-9]{3})?)` +                  // kWh value: 10-9999 or 1,234
    `\\s*(?:kwh)?`,                                        // optional kWh suffix
    'gi',
  );
  let m: RegExpExecArray | null;
  while ((m = pat.exec(t)) !== null) {
    const key = m[1].slice(0, 3).toLowerCase() as MonthKey;
    // Remove commas from numbers like "1,234"
    const valStr = m[2].replace(/,/g, '');
    const val = parseInt(valStr, 10);

    // Skip date-like matches: day numbers (1-31) that appear in a date context
    // e.g. "Jan 15, 2025"  -> 15 is a day (comma+year follows)
    //      "Jan 15 2025"   -> 15 followed directly by a 4-digit year
    //      "Jan 15/2025"   -> 15 is a day (slash+year follows)
    // But "Jan 15 kWh" or "Jan 15" at end of line = valid kWh only if clearly labeled
    // Strategy: for values <= 31, require either a kWh suffix in the match OR
    //           confirm no year follows in the text immediately after
    const matchEnd = (m.index ?? 0) + m[0].length;
    const afterMatch = t.slice(matchEnd, matchEnd + 15);
    const hasKwhSuffix = /kwh/i.test(m[0]);
    const yearFollows = /^\s*(?:19|20)\d{2}\b/.test(afterMatch);
    const commaOrSlashYear = /^[,\/]\s*(?:19|20)\d{2}\b/.test(afterMatch.trim());
    // If val is a plausible day number (1-31) AND no kWh suffix AND year follows -> it's a date
    if (val <= 31 && !hasKwhSuffix && (yearFollows || commaOrSlashYear)) continue;

    // Skip values that are clearly years (1900-2099) not already consumed by optional group
    if (val >= 1900 && val <= 2099) continue;

    // kWh values on bills are typically >= 50/month for residential.
    // Values < 50 are almost always day numbers, meter reads, or noise — not monthly kWh.
    // Note: val < 10 case already handled by date-day filter above; extending to 50 here.
    if (val < 50) continue;

    if (isValidMonthly(val)) {
      // Only overwrite if not already set by printed table (P1 takes priority)
      if (months[key] === undefined) {
        months[key] = val;
        evidence.push(m[0].trim());
      }
    }
  }

  const count = Object.keys(months).length;
  log.push(`[bill-parser] P2 handwritten list: ${count} months${count > 0 ? ' → ' + JSON.stringify(months) : ''}`);
  return { months, evidence };
}

// ── P3: Monthly Usage Summary table ───────────────────────────────────────────────
/**
 * CMP and similar utilities print a section like:
 *
 *   Your Monthly Usage Summary(kWh)
 *   Month  2025  2024  2023
 *   Jan     362   324   298
 *   Feb     450   410   389
 *
 * Numbers ARE the monthly kWh totals -- use them directly.
 * The header says "Monthly Usage Summary (kWh)" -- these are monthly totals, NOT daily averages.
 * Valid monthly kWh range: 10-5000.
 *
 * IMPORTANT: Only activate this parser if:
 *   - A "monthly usage summary" header is found in the text
 */
function parseBarGraphTable(
  text: string,
  log: string[],
): { months: Partial<Record<MonthKey, number>>; evidence: string[] } {
  const evidence: string[] = [];
  const months: Partial<Record<MonthKey, number>> = {};
  const lines = text.split('\n');

  // Find section start -- only activate if "monthly usage summary" header found
  let sectionStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/monthly\s+usage\s+summary/i.test(lines[i])) {
      sectionStart = i;
      log.push(`[bill-parser] P3 monthly usage summary header at line ${i}: "${lines[i].trim()}"`);
      break;
    }
  }

  if (sectionStart === -1) {
    log.push('[bill-parser] P3 bar graph: no "Monthly Usage Summary" header found -- skipping');
    return { months: {}, evidence: [] };
  }

  // Scan rows after the header -- each row: MonthName  value [optional extra columns]
  // Accept monthly kWh values 10-5000
  const rowPat = new RegExp(
    `^\\s*(${MONTH_RE_SRC})[a-z]*\\s+([0-9]{1,4})(?:\\s+[0-9]{1,4})*\\s*$`,
    'i',
  );

  for (let i = sectionStart + 1; i < lines.length; i++) {
    const m = lines[i].match(rowPat);
    if (!m) continue;
    const key = m[1].slice(0, 3).toLowerCase() as MonthKey;
    const val = parseInt(m[2], 10);
    // Valid monthly kWh: 10-5000
    if (isValidMonthly(val) && val >= 10) {
      months[key] = val;
      evidence.push(lines[i].trim());
    }
  }

  const count = Object.keys(months).length;

  if (count === 0) {
    log.push('[bill-parser] P3 bar graph: header found but no valid monthly rows');
    return { months: {}, evidence: [] };
  }

  log.push(`[bill-parser] P3 monthly usage summary: ${count} months → ${JSON.stringify(months)}`);
  return { months, evidence };
}

// ── A1: Explicit annual total line ────────────────────────────────────────────
function parseExplicitAnnual(text: string, log: string[]): ExtractedValue<number> | null {
  const t = normalise(text);
  const patterns: [RegExp, string][] = [
    [/total\s+for\s+(\d{4})\s*[\:\s]\s*([0-9,]+)\s*kwh/i,            'total_for_year'],
    [/(annual|yearly)\s+(?:usage|consumption|total)\s*[\:\s]\s*([0-9,]+)\s*kwh/i, 'annual_label'],
    [/last\s+12\s+months?\s*[\:\s]\s*([0-9,]+)\s*kwh/i,              'last_12_months'],
    [/12[- ]month\s+total\s*[\:\s]\s*([0-9,]+)\s*kwh/i,              '12_month_total'],
    [/your\s+(?:average\s+)?(?:daily\s+)?(?:annual\s+)?usage\s+(?:is\s+)?([0-9,]+)\s*kwh/i, 'your_usage'],
  ];

  for (const [pat, label] of patterns) {
    const m = t.match(pat);
    if (m) {
      // For patterns with named groups, the number may be in group 1 or 2
      const numStr = m[2] ?? m[1];
      const val = parseFloat(numStr.replace(/,/g, ''));
      if (val > 100 && val < 999999) {
        log.push(`[bill-parser] A1 explicit annual: ${val} kWh (pattern: ${label}, source: "${m[0].trim()}")`);
        return {
          value: val,
          source_type: 'explicit_annual',
          source_text: m[0].trim(),
          confidence: 0.95,
        };
      }
    }
  }

  log.push('[bill-parser] A1 explicit annual: not found');
  return null;
}

// ── Rate extraction ───────────────────────────────────────────────────────────
/**
 * Extract retail electricity rate from bill text.
 * Returns null if no reliable rate found — do NOT guess.
 * Rates must be $0.05–$0.75/kWh to be plausible retail rates.
 *
 * Patterns are OCR-robust: handle mangled "@" (4, ©, @, at), missing "$",
 * and various bill layouts (CMP, NSTAR, Eversource, National Grid, etc.)
 */
function extractRate(text: string, log: string[]): ExtractedValue<number> | null {
  const t = normalise(text);
  const patterns: [RegExp, string][] = [
    // "Energy Charge: $0.12534 / kWh" or "Rate: $0.198 per kWh"
    [/(?:energy\s+)?(?:charge|rate|price)\s*[:\@]\s*\$?([0-9]+\.[0-9]{2,5})\s*(?:per\s+)?(?:\/\s*)?kwh/i, 'rate_label'],
    // "$0.12534 / kWh" or "$0.198/kWh"
    [/\$([0-9]+\.[0-9]{2,5})\s*(?:per\s+)?(?:\/\s*)?kwh/i, 'dollar_per_kwh'],
    // "kWh @ $0.12534" — OCR-robust: "@" may appear as "4", "©", "a", "@", "at", "©"
    [/kwh\s+[@©a4]\s+\$?([0-9]+\.[0-9]{3,5})/i, 'kwh_at_rate'],
    // "kWh at $0.12534" or "kWh at 0.12534"
    [/kwh\s+at\s+\$?([0-9]+\.[0-9]{3,5})/i, 'kwh_at_word'],
    // "362 kWh  0.12534" — rate immediately after kWh count on same line (CMP format)
    // Must be 3-5 decimal places to distinguish from kWh values
    [/[1-9][0-9]{1,4}\s+kwh\s+([0-9]+\.[0-9]{3,5})/i, 'kwh_inline_rate'],
    // "0.12534 $/kWh" or "0.198 per kWh"
    [/([0-9]+\.[0-9]{3,5})\s*(?:\$\/|per\s+)?kwh/i, 'rate_before_kwh'],
    // Cents: "12.534 ¢/kWh" or "19.8 cents per kWh"
    [/([0-9]+\.[0-9]{1,4})\s*(?:¢|cents?)\s*(?:per\s+)?(?:\/\s*)?kwh/i, 'cents_per_kwh'],
    // "Distribution Charge  0.06543  per kWh" (tabular format)
    [/(?:distribution|supply|generation|delivery)\s+(?:charge|rate|service)\s+([0-9]+\.[0-9]{3,5})\s+per\s+kwh/i, 'line_item_rate'],
  ];

  const candidates: { rate: number; label: string; text: string }[] = [];

  for (const [pat, label] of patterns) {
    const allMatches = [...t.matchAll(new RegExp(pat.source, pat.flags.includes('g') ? pat.flags : pat.flags + 'g'))];
    for (const m of allMatches) {
      let rate = parseFloat(m[1]);
      if (rate > 1) rate = rate / 100; // Convert cents to dollars
      // Retail electricity rates: $0.05–$0.75/kWh
      if (rate >= 0.05 && rate <= 0.75) {
        candidates.push({ rate, label, text: m[0].trim() });
      }
    }
  }

  if (candidates.length === 0) {
    log.push('[bill-parser] rate: not found in bill text — returning null (do not guess)');
    return null;
  }

  // If multiple candidates, prefer higher-specificity patterns (earlier in list = higher specificity)
  // and rates in the $0.08–$0.45 residential range
  const residential = candidates.filter(c => c.rate >= 0.08 && c.rate <= 0.45);
  const best = residential.length > 0 ? residential[0] : candidates[0];

  log.push(`[bill-parser] rate: $${best.rate.toFixed(4)}/kWh (pattern: ${best.label}, text: "${best.text}")`);
  if (candidates.length > 1) {
    log.push(`[bill-parser] rate: ${candidates.length} candidates found — using best: $${best.rate.toFixed(4)}`);
  }
  return {
    value: Math.round(best.rate * 100000) / 100000,
    source_type: 'printed_table',
    source_text: best.text,
    confidence: 0.85,
  };
}

// ── Source selection ──────────────────────────────────────────────────────────
/**
 * Choose the best monthly source using strict priority.
 * Never lets a lower-priority source override a higher one.
 */
function selectBestMonthlySource(
  p1: { months: Partial<Record<MonthKey, number>>; evidence: string[] },
  p2: { months: Partial<Record<MonthKey, number>>; evidence: string[] },
  p3: { months: Partial<Record<MonthKey, number>>; evidence: string[] },
  log: string[],
): {
  months: Partial<Record<MonthKey, number>>;
  source: SourceType;
  confidence: number;
  evidence: string;
} {
  const p1Count = Object.keys(p1.months).length;
  const p2Count = Object.keys(p2.months).length;
  const p3Count = Object.keys(p3.months).length;

  log.push(`[bill-parser] source candidates: P1(printed)=${p1Count}, P2(handwritten)=${p2Count}, P3(bar-graph)=${p3Count}`);

  // P1: printed table with kWh label — most reliable
  if (p1Count >= 6) {
    log.push(`[bill-parser] SELECTED P1 printed table (${p1Count} months)`);
    return {
      months: p1.months,
      source: 'printed_table',
      confidence: 0.95,
      evidence: `Printed monthly table: ${p1.evidence.slice(0, 3).join(', ')}${p1Count > 3 ? '...' : ''}`,
    };
  }

  // P2: handwritten list — high confidence if 6+ months
  if (p2Count >= 6) {
    log.push(`[bill-parser] SELECTED P2 handwritten list (${p2Count} months)`);
    return {
      months: p2.months,
      source: 'handwritten_list',
      confidence: 0.90,
      evidence: `Handwritten month list: ${p2.evidence.slice(0, 3).join(', ')}${p2Count > 3 ? '...' : ''}`,
    };
  }

  // P3: bar graph table — good if 6+ months and section header present
  if (p3Count >= 6) {
    log.push(`[bill-parser] SELECTED P3 bar graph table (${p3Count} months)`);
    return {
      months: p3.months,
      source: 'bar_graph_table',
      confidence: 0.80,
      evidence: `Monthly Usage Summary: ${p3.evidence.slice(0, 3).join(', ')}${p3Count > 3 ? '...' : ''}`,
    };
  }

  // P4: partial handwritten (3–5 months) — lower confidence
  if (p2Count >= 3) {
    log.push(`[bill-parser] SELECTED P2 partial handwritten (${p2Count} months — extrapolating)`);
    return {
      months: p2.months,
      source: 'handwritten_list',
      confidence: 0.60,
      evidence: `Partial handwritten list (${p2Count} months): ${p2.evidence.join(', ')}`,
    };
  }

  // P4: partial printed (3–5 months)
  if (p1Count >= 3) {
    log.push(`[bill-parser] SELECTED P1 partial printed table (${p1Count} months — extrapolating)`);
    return {
      months: p1.months,
      source: 'printed_table',
      confidence: 0.65,
      evidence: `Partial printed table (${p1Count} months): ${p1.evidence.join(', ')}`,
    };
  }

  // Nothing usable
  log.push('[bill-parser] SELECTED none — no monthly source found');
  return { months: {}, source: 'none', confidence: 0, evidence: 'No monthly usage data found' };
}

// ── Annual computation ────────────────────────────────────────────────────────
function computeAnnual(
  monthlyArray: number[],
  monthsFound: number,
  explicitAnnual: ExtractedValue<number> | null,
  log: string[],
): { annual: ExtractedValue<number> | null; corroboration: number | null } {
  const nonZero = monthlyArray.filter(v => v > 0);
  let computedAnnual: number | null = null;
  let computedSource: SourceType = 'none';

  if (monthsFound >= 10) {
    // A2: Full year — sum directly
    computedAnnual = monthlyArray.reduce((a, b) => a + b, 0);
    computedSource = 'monthly_sum';
    log.push(`[bill-parser] A2 computed annual (sum): ${computedAnnual} kWh (${monthsFound} months)`);
  } else if (monthsFound >= 3) {
    // A3: Partial year — extrapolate
    const avg = nonZero.reduce((a, b) => a + b, 0) / nonZero.length;
    computedAnnual = Math.round(avg * 12);
    computedSource = 'extrapolated';
    log.push(`[bill-parser] A3 computed annual (avg×12): ${computedAnnual} kWh (avg=${Math.round(avg)}, ${monthsFound} months)`);
  }

  // Compare explicit vs computed
  if (explicitAnnual && computedAnnual) {
    const diff = Math.abs(explicitAnnual.value - computedAnnual) / computedAnnual;
    if (diff <= 0.05) {
      log.push(`[bill-parser] Annual cross-check: explicit ${explicitAnnual.value} vs computed ${computedAnnual} — diff ${(diff * 100).toFixed(1)}% ✓ corroborated`);
    } else {
      log.push(`[bill-parser] Annual cross-check WARNING: explicit ${explicitAnnual.value} vs computed ${computedAnnual} — diff ${(diff * 100).toFixed(1)}% — using computed (monthly data preferred)`);
    }
    // Prefer computed (monthly sum) when available — more accurate
    return {
      annual: {
        value: computedAnnual,
        source_type: computedSource,
        source_text: `Sum of ${monthsFound} monthly values`,
        confidence: computedSource === 'monthly_sum' ? 0.97 : 0.75,
      },
      corroboration: explicitAnnual.value,
    };
  }

  // Only computed
  if (computedAnnual !== null) {
    return {
      annual: {
        value: computedAnnual,
        source_type: computedSource,
        source_text: `Sum of ${monthsFound} monthly values`,
        confidence: computedSource === 'monthly_sum' ? 0.97 : 0.75,
      },
      corroboration: null,
    };
  }

  // Only explicit annual
  if (explicitAnnual) {
    return { annual: explicitAnnual, corroboration: null };
  }

  log.push('[bill-parser] annual: not determinable');
  return { annual: null, corroboration: null };
}

// ── Current month kWh ─────────────────────────────────────────────────────────
/**
 * Extract the current billing period kWh from text.
 * This is the "this month's usage" value, separate from history.
 */
function extractCurrentMonth(text: string, log: string[]): number | null {
  const t = normalise(text);
  const patterns = [
    // "Energy Charge  362 kWh  $45.23" — most common CMP bill format
    /(?:energy|electric(?:ity)?)\s+(?:charge|usage|used|consumption)\s+([1-9][0-9]{1,4})\s*kwh/i,
    // "362 kWh  @  $0.12534" — rate line
    /([1-9][0-9]{1,4})\s*kwh\s*[@\$]/i,
    // "Usage:  362 kWh" or "Current Usage  362 kWh"
    /(?:current\s+)?(?:energy|electric(?:ity)?\s+)?usage\s*[:\s]+([1-9][0-9]{1,4})\s*kwh/i,
    // "Total kWh Used:  362"
    /total\s+kwh\s+(?:used|billed|consumed)\s*[:\s]+([1-9][0-9]{1,4})/i,
    // "kWh Used  362"
    /kwh\s+(?:used|billed|consumed)\s+([1-9][0-9]{1,4})/i,
    // "362 kWh used"
    /([1-9][0-9]{1,4})\s*kwh\s+(?:used|usage|consumed|billed)/i,
    // "Net metered usage: 362 kWh"
    /(?:net\s+)?(?:metered\s+)?usage\s*[:\s]+([1-9][0-9]{1,4})\s*kwh/i,
    // "Electric Usage  362 kWh" (no label)
    /\belectric(?:ity)?\s+([1-9][0-9]{1,4})\s*kwh/i,
  ];
  for (const pat of patterns) {
    const m = t.match(pat);
    if (m) {
      const val = parseInt(m[1], 10);
      if (isValidMonthly(val)) {
        log.push(`[bill-parser] current month: ${val} kWh (pattern: "${m[0].trim()}")`);
        return val;
      }
    }
  }
  log.push('[bill-parser] current month: not found');
  return null;
}

// ── Main export ───────────────────────────────────────────────────────────────
/**
 * Parse a utility bill OCR text deterministically.
 *
 * Same input → same output, always.
 * No randomness, no AI rewrites of numeric fields.
 *
 * Returns BillParseResult with full source evidence for every field.
 */
export function parseBill(text: string): BillParseResult {
  const log: string[] = [];
  log.push(`[bill-parser] === BEGIN PARSE === text length: ${text.length} chars`);

  // Normalise once — all sub-functions receive original text (they normalise internally)
  // but we log the normalisation effect
  const normText = normalise(text);
  const kwhCount = (normText.match(/kwh/gi) ?? []).length;
  log.push(`[bill-parser] kWh mentions after normalisation: ${kwhCount}`);

  // ── Extract all sources independently ──────────────────────────────────────
  const utility       = extractUtility(text, log);
  const p1            = parsePrintedTable(text, log);
  const p2            = parseHandwrittenList(text, log);
  const p3            = parseBarGraphTable(text, log);
  const explicitAnnual = parseExplicitAnnual(text, log);
  const rate          = extractRate(text, log);
  const currentMonth  = extractCurrentMonth(text, log);

  // ── Select best monthly source ─────────────────────────────────────────────
  const selected = selectBestMonthlySource(p1, p2, p3, log);

  // ── Build monthly array ────────────────────────────────────────────────────
  const monthlyArray = MONTH_ORDER.map(m => {
    const v = selected.months[m] ?? 0;
    return isValidMonthly(v) ? v : 0;
  });
  const monthsFound = monthlyArray.filter(v => v > 0).length;

  // ── Compute annual ─────────────────────────────────────────────────────────
  const { annual, corroboration } = computeAnnual(monthlyArray, monthsFound, explicitAnnual, log);

  // ── Final summary log ──────────────────────────────────────────────────────
  log.push('[bill-parser] === FINAL EXTRACTION RESULT ===');
  log.push(`[bill-parser] utility: ${utility?.value ?? 'unknown'} (${utility?.source_type ?? 'none'}, conf=${utility?.confidence ?? 0})`);
  log.push(`[bill-parser] monthly source: ${selected.source} (${monthsFound} months, conf=${selected.confidence})`);
  log.push(`[bill-parser] annual: ${annual?.value ?? 'n/a'} kWh (${annual?.source_type ?? 'none'})`);
  log.push(`[bill-parser] rate: ${rate ? '$' + rate.value.toFixed(4) + '/kWh' : 'null — not found'}`);
  log.push(`[bill-parser] current month: ${currentMonth ?? 'n/a'} kWh`);
  if (monthsFound > 0) {
    const obj = Object.fromEntries(MONTH_ORDER.map((m, i) => [m, monthlyArray[i]]));
    log.push('[bill-parser] monthly array: ' + JSON.stringify(obj));
  }

  return {
    utility,
    monthlyArray,
    monthlySource: selected.source,
    monthlyConfidence: selected.confidence,
    monthsFound,
    monthlyEvidence: selected.evidence,
    annual,
    annualCorroboration: corroboration ?? null,
    currentMonthKwh: currentMonth,
    rate,
    debugLog: log,
  };
}

// ── Legacy compatibility export ───────────────────────────────────────────────
/**
 * Legacy interface used by extractImageTextSmart() in route.ts
 * to check if OCR text has usable usage data.
 * Returns a simple object compatible with old callers.
 */
export function parseMonthlyUsage(text: string): {
  monthlyUsage: Partial<Record<MonthKey, number>>;
  annualUsage: number | null;
  monthsFound: number;
  source: string;
  monthlyArray: number[];
} {
  const result = parseBill(text);
  return {
    monthlyUsage: Object.fromEntries(
      MONTH_ORDER.map((m, i) => [m, result.monthlyArray[i]])
    ) as Partial<Record<MonthKey, number>>,
    annualUsage: result.annual?.value ?? null,
    monthsFound: result.monthsFound,
    source: result.monthlySource,
    monthlyArray: result.monthlyArray,
  };
}

// ── System size estimate ──────────────────────────────────────────────────────
export function estimateSystemSize(annualKwh: number): {
  systemSizeKw: number;
  monthlyAverage: number;
} {
  const PRODUCTION_FACTOR = 1200;
  const systemSizeKw = Math.round((annualKwh / PRODUCTION_FACTOR) * 10) / 10;
  const monthlyAverage = Math.round(annualKwh / 12);
  return { systemSizeKw, monthlyAverage };
}