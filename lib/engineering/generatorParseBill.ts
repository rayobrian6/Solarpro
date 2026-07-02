// Heuristic parser for US electric utility bills.
//
// Returns a structured result with every field nullable. The UI shows
// which fields were extracted and which were missed, so the user knows
// when the heuristic didn't catch something.
//
// Designed for noisy text — pastes, PDF text extraction, photocopied
// text with weird whitespace. Heuristics are conservative: when in
// doubt, return null rather than guess wrong.

export type BillParseResult = {
  /** Total energy used in the billing period, in kWh. */
  kWh: number | null;
  /** Peak (or maximum) demand during the period, in kW. Null on residential bills that don't meter demand. */
  peakKw: number | null;
  /** Effective rate per kWh in USD. Null if not stated. */
  ratePerKWh: number | null;
  /** Billing period start, as the user wrote it. */
  billingPeriodStart: string | null;
  /** Billing period end, as the user wrote it. */
  billingPeriodEnd: string | null;
  /** Total amount due / current charges, in USD. */
  totalCostUsd: number | null;
  /** Which fields were successfully extracted. */
  found: {
    kWh: boolean;
    peakKw: boolean;
    ratePerKWh: boolean;
    billingPeriod: boolean;
    totalCost: boolean;
  };
  /** The cleaned text the parser operated on (helpful for debugging). */
  cleaned: string;
};

const MIN_KWH = 50; // a real home uses at least 50 kWh/month; filters rate-per-kWh noise
const MIN_PEAK_KW = 0.5; // below this is almost certainly not a demand reading

export function parseBill(input: string): BillParseResult {
  const cleaned = input.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").trim();

  const kWh = extractKWh(cleaned);
  const peakKw = extractPeakKw(cleaned);
  const ratePerKWh = extractRatePerKWh(cleaned, kWh, peakKw);
  const { start, end } = extractBillingPeriod(cleaned);
  const totalCostUsd = extractTotalCost(cleaned, kWh, ratePerKWh);

  return {
    kWh,
    peakKw,
    ratePerKWh,
    billingPeriodStart: start,
    billingPeriodEnd: end,
    totalCostUsd,
    found: {
      kWh: kWh !== null,
      peakKw: peakKw !== null,
      ratePerKWh: ratePerKWh !== null,
      billingPeriod: start !== null && end !== null,
      totalCost: totalCostUsd !== null,
    },
    cleaned,
  };
}

function extractKWh(text: string): number | null {
  // Find every "NNN kWh" / "NNN KWH" / "NNN kW h" token. Filter to plausible
  // monthly usage values (>= MIN_KWH). If multiple match, take the largest —
  // a real bill's "total usage" number dominates incidental mentions.
  const re = /(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\s*(?:kWh|KWH|kW\s*h|KW\s*H)\b/gi;
  const candidates: Array<{ value: number; index: number }> = [];
  for (const m of text.matchAll(re)) {
    const value = parseFloat(m[1].replace(/,/g, ""));
    if (value >= MIN_KWH) candidates.push({ value, index: m.index ?? 0 });
  }
  if (candidates.length === 0) return null;
  // Prefer the FIRST match that follows "usage" / "used" / "consumption" — that's
  // the official number. Fall back to largest if no contextual hint.
  const ctxRe = /(?:usage|used|consumption|consumed|kWh used)\b[^.\n]{0,40}?(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\s*(?:kWh|KWH)/gi;
  const ctxMatch = ctxRe.exec(text);
  if (ctxMatch) {
    const v = parseFloat(ctxMatch[1].replace(/,/g, ""));
    if (v >= MIN_KWH) return v;
  }
  return candidates.reduce((a, b) => (b.value > a.value ? b : a)).value;
}

function extractPeakKw(text: string): number | null {
  // Peak demand is labeled: "demand", "peak", "maximum demand", "billing demand".
  // We require a proximity hint to avoid matching "$0.12 per kWh" as peak = 0.12.
  // Match a number followed by "kW" (NOT "kWh") within ~50 chars after a demand label.
  const demandLabels = /(?:peak\s+demand|maximum\s+demand|billing\s+demand|demand\b|kW\s+demand|kw\s+demand)/i;

  // Walk the text, find every demand-label position, then look ahead for "NNN kW" (not kWh).
  const labelRe = /(?:peak\s+demand|maximum\s+demand|billing\s+demand|\bdemand\b|kW\s+demand|kw\s+demand)/gi;
  const labels = [...text.matchAll(labelRe)];

  for (const label of labels) {
    const start = label.index ?? 0;
    const slice = text.slice(start, start + 80);
    // Match NNN kW but not kWh.
    const k = slice.match(/(\d+(?:\.\d+)?)\s*kW\b(?!\s*h)/i);
    if (k) {
      const v = parseFloat(k[1]);
      if (v >= MIN_PEAK_KW) return v;
    }
  }

  // Fallback: dedicated table cell pattern. e.g. "Demand 8.2 kW  8.2"
  const tableRe = /\bdemand[\s:]+(\d+(?:\.\d+)?)\s*kW\b(?!\s*h)/i;
  const t = tableRe.exec(text);
  if (t) {
    const v = parseFloat(t[1]);
    if (v >= MIN_PEAK_KW) return v;
  }

  return null;
}

function extractRatePerKWh(
  text: string,
  kWh: number | null,
  peakKw: number | null
): number | null {
  // Look for explicit rate: "$0.12 per kWh" or "$0.12/kWh"
  const explicit = text.match(/\$\s*(\d+(?:\.\d+)+)\s*(?:\/|per\s+)\s*kWh/i);
  if (explicit) return parseFloat(explicit[1]);

  // Derive from total / kWh when both are known and peakKw is null (so we
  // don't confuse energy-only with demand-included rates). If peakKw is set,
  // the bill has demand charges and the total includes both — skip derivation.
  if (kWh !== null && peakKw === null) {
    // Try to find any currency amount in proximity to a total / amount due line
    // and divide by kWh. Caller will do this in extractTotalCost.
  }
  return null;
}

function extractBillingPeriod(text: string): {
  start: string | null;
  end: string | null;
} {
  // Common forms:
  //   "Billing period: 09/15/2024 - 10/14/2024"
  //   "Service from Sep 15 to Oct 14, 2024"
  //   "Statement period: 09/15/2024 to 10/14/2024"
  //   "For service from 09/15/2024 to 10/14/2024"
  // We accept any label followed by two dates separated by dash, "to", or "through".
  const labelRe =
    /(?:billing\s+period|service\s+period|statement\s+period|service\s+from|for\s+service\s+from|billing\s+dates?|statement\s+dates?)\s*[:\-]?\s*([^\n]{8,60})/i;
  const m = labelRe.exec(text);
  if (!m) return { start: null, end: null };
  const segment = m[1];

  // Try "DATE to DATE" / "DATE - DATE" / "DATE through DATE"
  const split = segment.split(/\s+(?:to|through|thru|-|–|—)\s+/i);
  if (split.length >= 2) {
    return { start: split[0].trim(), end: split[1].trim() };
  }
  return { start: null, end: null };
}

function extractTotalCost(
  text: string,
  kWh: number | null,
  ratePerKWh: number | null
): number | null {
  // Look for an amount near a "total" / "amount due" / "current charges" label.
  const labels = [
    /(?:total\s+amount\s+due|amount\s+due|current\s+charges|new\s+charges|total\s+charges|total\s+billed|balance\s+due)\s*[:\-]?\s*\$\s*(\d{1,4}(?:,\d{3})*(?:\.\d{2}))/i,
    /(?:total|amount\s+due|charges)\s*[:\-]?\s*\$\s*(\d{1,4}(?:,\d{3})*(?:\.\d{2}))/i,
  ];

  for (const re of labels) {
    const m = re.exec(text);
    if (m) return parseFloat(m[1].replace(/,/g, ""));
  }

  // Fallback: pick the largest dollar amount in the text that's plausibly
  // a monthly total. Skip rates (per-kWh) and per-line items.
  if (ratePerKWh === null) {
    const all = [...text.matchAll(/\$\s*(\d{1,4}(?:,\d{3})*(?:\.\d{2}))/g)]
      .map((m) => parseFloat(m[1].replace(/,/g, "")))
      .filter((v) => v >= 10 && v <= 5000);
    if (all.length > 0) return Math.max(...all);
  }
  return null;
}
