/**
 * lib/billOcr.ts
 * Utility bill OCR extraction — parses PDF/JPG/PNG electric bills.
 * Uses pattern matching on extracted text to find kWh, rate, provider, address.
 * Falls back to GPT-4o-mini when regex confidence is low.
 */

export interface BillExtractResult {
  success: boolean;
  // Customer info
  customerName?: string;
  serviceAddress?: string;
  // Utility info
  utilityProvider?: string;
  accountNumber?: string;
  // Billing period
  billingPeriodStart?: string;
  billingPeriodEnd?: string;
  billingDays?: number;
  // Usage
  monthlyKwh?: number;
  annualKwh?: number;        // if shown on bill
  monthlyUsageHistory?: number[];  // up to 12 months of usage
  // Charges
  totalAmount?: number;
  electricityRate?: number;  // $/kWh
  fixedCharges?: number;
  demandCharge?: number;     // $/kW or $ for commercial bills
  demandKw?: number;         // peak demand in kW
  // Tiered usage
  tier1Kwh?: number;
  tier2Kwh?: number;
  tier1Rate?: number;
  tier2Rate?: number;
  // Bill type
  billType?: 'electric' | 'gas' | 'combined' | 'unknown';
  gasUsageTherm?: number;    // therms for gas bills
  // Derived
  estimatedAnnualKwh?: number;  // monthlyKwh * 12 if annual not available
  estimatedMonthlyBill?: number;
  // Confidence
  confidence: 'high' | 'medium' | 'low';
  extractedFields: string[];
  usedLlmFallback?: boolean;
  rawText?: string;
  error?: string;
}

// ── Known utility name patterns ───────────────────────────────────────────────
const UTILITY_PATTERNS: [RegExp, string][] = [
  [/pacific\s+gas\s+(?:and|&)\s+electric|pg&e|pge/i, 'PG&E'],
  [/southern\s+california\s+edison|sce\b/i, 'Southern California Edison'],
  [/san\s+diego\s+gas\s+(?:and|&)\s+electric|sdg&e/i, 'SDG&E'],
  [/los\s+angeles\s+dept\s+of\s+water|ladwp/i, 'LADWP'],
  [/florida\s+power\s+(?:and|&)\s+light|fpl\b/i, 'Florida Power & Light'],
  [/duke\s+energy/i, 'Duke Energy'],
  [/dominion\s+energy/i, 'Dominion Energy'],
  [/con\s+edison|consolidated\s+edison/i, 'Con Edison'],
  [/national\s+grid/i, 'National Grid'],
  [/xcel\s+energy/i, 'Xcel Energy'],
  [/ameren/i, 'Ameren'],
  [/comed\b|commonwealth\s+edison/i, 'ComEd'],
  [/pse&g|public\s+service\s+electric/i, 'PSE&G'],
  [/georgia\s+power/i, 'Georgia Power'],
  [/entergy/i, 'Entergy'],
  [/oncor/i, 'Oncor'],
  [/centerpoint\s+energy/i, 'CenterPoint Energy'],
  [/aep\b|american\s+electric\s+power/i, 'AEP'],
  [/eversource/i, 'Eversource'],
  [/nv\s+energy/i, 'NV Energy'],
  [/rocky\s+mountain\s+power/i, 'Rocky Mountain Power'],
  [/puget\s+sound\s+energy|pse\b/i, 'Puget Sound Energy'],
  [/hawaiian\s+electric|heco/i, 'Hawaiian Electric'],
  [/pepco/i, 'Pepco'],
  [/bge\b|baltimore\s+gas/i, 'BGE'],
  [/ppl\s+electric/i, 'PPL Electric'],
  [/peco\b/i, 'PECO'],
  [/consumers\s+energy/i, 'Consumers Energy'],
  [/dte\s+energy/i, 'DTE Energy'],
  [/cleco/i, 'Cleco'],
  [/westar|evergy/i, 'Evergy'],
  [/midamerican/i, 'MidAmerican Energy'],
  [/alliant\s+energy/i, 'Alliant Energy'],
  [/tva\b|tennessee\s+valley/i, 'TVA'],
  [/appalachian\s+power/i, 'Appalachian Power'],
  [/black\s+hills\s+energy/i, 'Black Hills Energy'],
  [/green\s+mountain\s+power/i, 'Green Mountain Power'],
  [/central\s+maine\s+power/i, 'Central Maine Power'],
  [/salt\s+river\s+project|srp\b/i, 'SRP'],
  [/tucson\s+electric|tep\b/i, 'Tucson Electric Power'],
  [/arizona\s+public\s+service|aps\b/i, 'APS'],
  [/pacific\s+power/i, 'Pacific Power'],
  [/portland\s+general\s+electric|pge\b/i, 'Portland General Electric'],
  [/puget\s+sound\s+energy/i, 'Puget Sound Energy'],
  [/avista/i, 'Avista Utilities'],
  [/idaho\s+power/i, 'Idaho Power'],
  [/nevada\s+power/i, 'Nevada Power'],
  [/el\s+paso\s+electric/i, 'El Paso Electric'],
  [/southwestern\s+electric\s+cooperative/i, 'Southwestern Electric Cooperative'],
  [/southwestern\s+public\s+service|sps\b/i, 'Southwestern Public Service'],
];

// ── Detect bill type (electric vs gas vs combined) ────────────────────────────
function detectBillType(text: string): 'electric' | 'gas' | 'combined' | 'unknown' {
  const hasElectric = /\bkwh\b|kilowatt.?hour|electric(?:ity)?\s+(?:usage|charge|service)/i.test(text);
  const hasGas = /\btherm\b|\bccf\b|\bcubic\s+feet\b|natural\s+gas\s+(?:usage|charge|service)/i.test(text);
  if (hasElectric && hasGas) return 'combined';
  if (hasElectric) return 'electric';
  if (hasGas) return 'gas';
  return 'unknown';
}

// ── Extract utility name ──────────────────────────────────────────────────────
function extractUtilityName(text: string): string | undefined {
  for (const [pattern, name] of UTILITY_PATTERNS) {
    if (pattern.test(text)) return name;
  }
  // Generic fallback: "X Electric" / "X Power" / "X Energy" / "X Utilities"
  const genericMatch = text.match(/([A-Z][a-zA-Z\s]{2,30}(?:Electric(?:ity)?|Power|Energy|Light(?:ing)?|Gas|Utilities?|Cooperative|Coop\b))/);
  if (genericMatch) {
    const name = genericMatch[1].trim();
    if (name.length > 4 && name.length < 60) return name;
  }
  return undefined;
}

// ── Extract kWh usage ───────────────────────────────────────────────────────
// Priority 1: Handwritten month lines        (Jan 555 NWH)
// Priority 2: Monthly Usage Summary table    (Jan 20 24 20 — col1 = current year)
// Priority 3: Yearly total line              (Total For 2025 6723 kWh)
function extractKwh(text: string): { monthly?: number; annual?: number; monthlyHistory?: number[] } {
  const result: { monthly?: number; annual?: number; monthlyHistory?: number[] } = {};

  const MONTH_ORDER = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  // Normalise handwritten / OCR kWh aliases before all pattern matching
  const t = text
    .replace(/\bN\.?W\.?H\.?\b/gi, 'kWh')
    .replace(/\bK\.?W\.?H\.?\b/g,  'kWh')
    .replace(/\bkw-h\b/gi,         'kWh');

  console.log(`[bill-upload] OCR text length: ${text.length} chars`);

  // ── PRIORITY 1: Handwritten month lines ───────────────────────────────────
  // "Jan 555 kWh"  "Feb 609 kWh" (after NWH normalisation)
  const MONTH_RE_SRC = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  const handwrittenPat = new RegExp(`(${MONTH_RE_SRC})[a-z]*[\\s\\.\\:]+([1-9][0-9]{2,4})\\s*kwh`, 'gi');
  const handwrittenMonths: Record<string, number> = {};
  let hwMatch: RegExpExecArray | null;
  while ((hwMatch = handwrittenPat.exec(t)) !== null) {
    const key = hwMatch[1].slice(0, 3).toLowerCase();
    const val = parseInt(hwMatch[2], 10);
    if (val > 50 && val < 50000) handwrittenMonths[key] = val;
  }
  const hwCount = Object.keys(handwrittenMonths).length;
  console.log(`[bill-upload] Handwritten months detected: ${hwCount}`, hwCount > 0 ? JSON.stringify(handwrittenMonths) : '');

  // ── PRIORITY 2: Monthly Usage Summary bar graph table ─────────────────
  // Rows: "Jan  20  24  20"  (month-name + 1-3 year columns, col1 = current year)
  // Values are daily averages (1–200) — we multiply by days-in-month to get monthly kWh
  const barGraphMonths: Record<string, number> = {};
  const hasSummaryHeader = /monthly\s+usage\s+summary/i.test(text);
  console.log(`[bill-upload] Bar graph section header found: ${hasSummaryHeader}`);

  const barRowPat = new RegExp(
    `^\\s*(${MONTH_RE_SRC})[a-z]*\\s+([0-9]{1,3})(?:\\s+[0-9]{1,4})*\\s*$`,
    'gim'
  );
  let barMatch: RegExpExecArray | null;
  while ((barMatch = barRowPat.exec(text)) !== null) {
    const key = barMatch[1].slice(0, 3).toLowerCase();
    const val = parseInt(barMatch[2], 10);
    if (val >= 0 && val <= 200) barGraphMonths[key] = val;
  }
  const barCount = Object.keys(barGraphMonths).length;
  console.log(`[bill-upload] Bar graph rows detected: ${barCount}`, barCount > 0 ? JSON.stringify(barGraphMonths) : '');

  // ── Choose source and build history ───────────────────────────────────────
  let chosenMonths: Record<string, number> | null = null;
  let sourceLabel = 'none';

  if (hwCount >= 6) {
    chosenMonths = handwrittenMonths;
    sourceLabel = 'handwritten';
  } else if (barCount >= 6) {
    // Convert daily averages → monthly totals
    const converted: Record<string, number> = {};
    MONTH_ORDER.forEach((m, i) => {
      if (barGraphMonths[m] !== undefined) {
        converted[m] = Math.round(barGraphMonths[m] * DAYS_IN_MONTH[i]);
      }
    });
    chosenMonths = converted;
    sourceLabel = 'bar-graph';
    console.log('[bill-upload] Bar graph daily-avg → monthly totals:', JSON.stringify(converted));
  } else if (hwCount > 0) {
    chosenMonths = handwrittenMonths;
    sourceLabel = `handwritten-partial(${hwCount})`;
  }

  if (chosenMonths && Object.keys(chosenMonths).length > 0) {
    const history = MONTH_ORDER.map(m => chosenMonths![m] ?? 0);
    result.monthlyHistory = history;

    const nonZero = history.filter(v => v > 0);
    const lastNonZero = [...history].reverse().find(v => v > 0);
    if (lastNonZero) result.monthly = lastNonZero;

    if (nonZero.length >= 10) {
      result.annual = history.reduce((a, b) => a + b, 0);
    } else if (nonZero.length >= 3) {
      result.annual = Math.round((nonZero.reduce((a, b) => a + b, 0) / nonZero.length) * 12);
    }

    const monthObj = Object.fromEntries(MONTH_ORDER.map((m, i) => [m, history[i]]));
    console.log('[bill-upload] Parsed monthly usage object:', JSON.stringify(monthObj));
    console.log(`[bill-upload] Yearly usage computed: ${result.annual ?? 'n/a'} kWh (${nonZero.length} months, source: ${sourceLabel})`);
  }

  // ── PRIORITY 3: Explicit yearly total line ─────────────────────────────────
  if (!result.annual) {
    const annualPatterns = [
      /total\s+for\s+\d{4}[\s\:]+([0-9,]+)\s*kwh/i,
      /(?:annual|yearly|12[- ]month)\s+(?:usage|consumption|average)[\:\s]+([0-9,]+)\s*kwh/i,
      /(?:last\s+12\s+months?)[\:\s]+([0-9,]+)\s*kwh/i,
      /(?:12[- ]month\s+total)[\:\s]+([0-9,]+)\s*kwh/i,
      /^([0-9,]{4,})\s*kwh\s*$/im,
    ];
    for (const pat of annualPatterns) {
      const m = t.match(pat);
      if (m) {
        const val = parseFloat(m[1].replace(/,/g, ''));
        if (val > 0 && val < 1000000) {
          result.annual = val;
          console.log(`[bill-upload] Yearly total from explicit line: ${val} kWh`);
          break;
        }
      }
    }
  }

  // ── PDF/text bill explicit monthly label fallback ──────────────────────────
  if (!result.monthly) {
    const monthlyPatterns = [
      /energy\s+([0-9,]+)\s*kwh\s*@/i,
      /([1-9][0-9,]{2,})\s*kwh\s+\d+\s*days/i,
      /kwh\s+usage[^0-9]*(?:\d+\s+)?([0-9,]{3,})/i,
      /(?:total\s+)?(?:energy\s+)?(?:usage|used|consumption|kwh\s+used)[\:\s]+([0-9,]+)\s*kwh/i,
      /([0-9,]+)\s*kwh\s+(?:used|usage|consumed|billed)/i,
      /(?:electric\s+)?(?:usage|consumption)[\:\s]+([0-9,]+)\s*(?:kwh|kw-?h)/i,
      /([0-9,]+)\s*kwh\s*@/i,
      /(?:billing\s+)?(?:period\s+)?usage[\:\s]+([0-9,]+)\s*kwh/i,
      /(?:net\s+)?(?:metered\s+)?usage[\:\s]+([0-9,]+)\s*kwh/i,
    ];
    for (const pat of monthlyPatterns) {
      const m = t.match(pat);
      if (m) {
        const val = parseFloat(m[1].replace(/,/g, ''));
        if (val > 0 && val < 100000) { result.monthly = val; break; }
      }
    }
  }

  return result;
}

// ── extractDailyAvgTable (backward-compat stub) ───────────────────────────────────────
function extractDailyAvgTable(text: string): number[] | undefined {
  const lines = text.split('\n').map(l => l.replace(/\t/g, ' ').replace(/ {2,}/g, ' ').trim());
  const yearRowPattern = /^[^0-9]*(\d{4})\s+([\d\s]+)$/;
  const candidates: { year: number; values: number[]; nonZero: number }[] = [];
  for (const line of lines) {
    const m = line.match(yearRowPattern);
    if (!m) continue;
    const year = parseInt(m[1]);
    if (year < 2015 || year > 2030) continue;
    const nums = m[2].trim().split(/\s+/).map(Number).filter(n => !isNaN(n));
    if (nums.length < 10 || nums.length > 14) continue;
    if (nums.some(n => n > 500)) continue;
    const nonZero = nums.filter(n => n > 0).length;
    if (nonZero < 2) continue;
    const padded = [...nums.slice(0, 12), ...Array(Math.max(0, 12 - nums.length)).fill(0)];
    candidates.push({ year, values: padded, nonZero });
  }
  if (candidates.length === 0) return undefined;
  candidates.sort((a, b) => b.year - a.year || b.nonZero - a.nonZero);
  return candidates[0].values;
}

function extractMonthlyHistory(text: string): number[] | undefined {
  // Pattern: month labels followed by kWh values in a table/chart
  // e.g. "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec\n1200 980 1100 ..."
  const monthAbbrevs = /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/gi;
  const monthMatches = text.match(monthAbbrevs);
  if (!monthMatches || monthMatches.length < 6) return undefined;

  // Try to find a sequence of 6–12 numbers near month labels
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (monthAbbrevs.test(lines[i])) {
      // Look for numbers on same line or next line
      const numLine = lines[i].match(/([0-9,]+)/g) || (lines[i + 1] || '').match(/([0-9,]+)/g);
      if (numLine && numLine.length >= 6) {
        const vals = numLine
          .map(n => parseFloat(n.replace(/,/g, '')))
          .filter(v => v > 50 && v < 50000);
        if (vals.length >= 6) return vals.slice(0, 12);
      }
    }
  }

  // Alternative: look for "Month: NNN kWh" repeated patterns
  const monthKwhPattern = /(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[^0-9]*([0-9,]+)\s*kwh/gi;
  const history: number[] = [];
  let m;
  while ((m = monthKwhPattern.exec(text)) !== null) {
    const val = parseFloat(m[1].replace(/,/g, ''));
    if (val > 50 && val < 50000) history.push(val);
  }
  if (history.length >= 6) return history.slice(0, 12);

  return undefined;
}

// ── Extract electricity rate ──────────────────────────────────────────────────
function extractRate(text: string): number | undefined {
  const ratePatterns = [
    /(?:energy\s+)?(?:charge|rate|price)[:\s]+\$?([0-9]+\.[0-9]{2,4})\s*(?:per\s+)?(?:\/\s*)?kwh/i,
    /\$([0-9]+\.[0-9]{2,4})\s*(?:per\s+)?(?:\/\s*)?kwh/i,
    /([0-9]+\.[0-9]{2,4})\s*(?:¢|cents?)\s*(?:per\s+)?(?:\/\s*)?kwh/i,
    /kwh\s+@\s+\$?([0-9]+\.[0-9]{3,5})/i,
    /(?:unit\s+)?(?:rate|price)[:\s]+([0-9]+\.[0-9]{3,5})/i,
    /(?:energy\s+)?(?:charge\s+)?(?:rate)[:\s]+([0-9]+\.[0-9]{4,6})/i,
  ];

  for (const pattern of ratePatterns) {
    const match = text.match(pattern);
    if (match) {
      let rate = parseFloat(match[1]);
      if (rate > 1) rate = rate / 100; // cents → dollars
      if (rate > 0.01 && rate < 1.5) return Math.round(rate * 10000) / 10000;
    }
  }
  return undefined;
}

// ── Extract tiered usage ──────────────────────────────────────────────────────
function extractTieredUsage(text: string): {
  tier1Kwh?: number; tier2Kwh?: number;
  tier1Rate?: number; tier2Rate?: number;
} {
  const result: { tier1Kwh?: number; tier2Kwh?: number; tier1Rate?: number; tier2Rate?: number } = {};

  // Tier 1 kWh
  const t1kwh = text.match(/tier\s*1[^0-9]*([0-9,]+)\s*kwh/i);
  if (t1kwh) result.tier1Kwh = parseFloat(t1kwh[1].replace(/,/g, ''));

  // Tier 2 kWh
  const t2kwh = text.match(/tier\s*2[^0-9]*([0-9,]+)\s*kwh/i);
  if (t2kwh) result.tier2Kwh = parseFloat(t2kwh[1].replace(/,/g, ''));

  // Tier 1 rate
  const t1rate = text.match(/tier\s*1[^$]*\$?([0-9]+\.[0-9]{3,5})\s*(?:\/\s*)?kwh/i);
  if (t1rate) {
    let r = parseFloat(t1rate[1]);
    if (r > 1) r = r / 100;
    if (r > 0.04 && r < 1.5) result.tier1Rate = r;
  }

  // Tier 2 rate
  const t2rate = text.match(/tier\s*2[^$]*\$?([0-9]+\.[0-9]{3,5})\s*(?:\/\s*)?kwh/i);
  if (t2rate) {
    let r = parseFloat(t2rate[1]);
    if (r > 1) r = r / 100;
    if (r > 0.04 && r < 1.5) result.tier2Rate = r;
  }

  return result;
}

// ── Extract demand charge ─────────────────────────────────────────────────────
function extractDemandCharge(text: string): { charge?: number; kw?: number } {
  const result: { charge?: number; kw?: number } = {};

  // Demand charge amount
  const chargePatterns = [
    /demand\s+charge[:\s]+\$([0-9,]+\.[0-9]{2})/i,
    /\$([0-9,]+\.[0-9]{2})\s+demand\s+charge/i,
    /(?:peak\s+)?demand[:\s]+\$([0-9,]+\.[0-9]{2})/i,
  ];
  for (const p of chargePatterns) {
    const m = text.match(p);
    if (m) {
      const val = parseFloat(m[1].replace(/,/g, ''));
      if (val > 0 && val < 100000) { result.charge = val; break; }
    }
  }

  // Peak demand in kW
  const kwPatterns = [
    /(?:peak\s+)?demand[:\s]+([0-9.]+)\s*kw\b/i,
    /(?:measured\s+)?demand[:\s]+([0-9.]+)\s*kw/i,
    /([0-9.]+)\s*kw\s+(?:peak\s+)?demand/i,
  ];
  for (const p of kwPatterns) {
    const m = text.match(p);
    if (m) {
      const val = parseFloat(m[1]);
      if (val > 0 && val < 10000) { result.kw = val; break; }
    }
  }

  return result;
}

// ── Extract gas usage ─────────────────────────────────────────────────────────
function extractGasUsage(text: string): number | undefined {
  const patterns = [
    /(?:gas\s+)?(?:usage|used|consumption)[:\s]+([0-9,]+)\s*(?:therms?|thm)/i,
    /([0-9,]+)\s*(?:therms?|thm)\s+(?:used|usage|consumed)/i,
    /(?:ccf|cubic\s+feet)[:\s]+([0-9,]+)/i,
    /([0-9,]+)\s*ccf/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const val = parseFloat(m[1].replace(/,/g, ''));
      if (val > 0 && val < 100000) return val;
    }
  }
  return undefined;
}

// ── Extract total amount ──────────────────────────────────────────────────────
function extractTotalAmount(text: string): number | undefined {
  const totalPatterns = [
    /(?:total\s+)?(?:amount\s+)?(?:due|owed|billed)[:\s]+\$([0-9,]+\.[0-9]{2})/i,
    /(?:current\s+)?(?:charges?|bill)[:\s]+\$([0-9,]+\.[0-9]{2})/i,
    /(?:please\s+pay)[:\s]+\$([0-9,]+\.[0-9]{2})/i,
    /total[:\s]+\$([0-9,]+\.[0-9]{2})/i,
    /\$([0-9,]+\.[0-9]{2})\s+(?:total|due|owed)/i,
    /(?:new\s+charges?)[:\s]+\$([0-9,]+\.[0-9]{2})/i,
    /(?:balance\s+due)[:\s]+\$([0-9,]+\.[0-9]{2})/i,
  ];

  for (const pattern of totalPatterns) {
    const match = text.match(pattern);
    if (match) {
      const val = parseFloat(match[1].replace(/,/g, ''));
      if (val > 0 && val < 100000) return val;
    }
  }
  return undefined;
}

// ── Extract fixed charges ─────────────────────────────────────────────────────
function extractFixedCharges(text: string): number | undefined {
  const patterns = [
    /(?:customer|service|basic|fixed|base)\s+charge[:\s]+\$([0-9,]+\.[0-9]{2})/i,
    /(?:monthly\s+)?(?:service\s+)?(?:fee|charge)[:\s]+\$([0-9,]+\.[0-9]{2})/i,
    /\$([0-9,]+\.[0-9]{2})\s+(?:customer|service|basic|fixed)\s+charge/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const val = parseFloat(m[1].replace(/,/g, ''));
      if (val > 0 && val < 500) return val;
    }
  }
  return undefined;
}

// ── Extract billing period ────────────────────────────────────────────────────
function extractBillingPeriod(text: string): {
  start?: string; end?: string; days?: number;
} {
  const result: { start?: string; end?: string; days?: number } = {};

  const rangePatterns = [
    /(?:service|billing|bill)\s+(?:period|dates?)[:\s]+([A-Za-z]+\s+\d{1,2},?\s+\d{4})\s*(?:to|-|through)\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
    /(\d{1,2}\/\d{1,2}\/\d{2,4})\s*(?:to|-|through)\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/,
    /(\d{1,2}-\d{1,2}-\d{2,4})\s*(?:to|-|through)\s*(\d{1,2}-\d{1,2}-\d{2,4})/,
    /(?:from)[:\s]+([A-Za-z]+\s+\d{1,2},?\s+\d{4})\s*(?:to|-|through)\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
  ];

  for (const pattern of rangePatterns) {
    const match = text.match(pattern);
    if (match) {
      result.start = match[1];
      result.end = match[2];
      break;
    }
  }

  const daysMatch = text.match(/(\d{2,3})\s*(?:billing\s+)?days?/i);
  if (daysMatch) {
    const days = parseInt(daysMatch[1]);
    if (days >= 25 && days <= 35) result.days = days;
  }

  return result;
}

// ── Extract customer name ─────────────────────────────────────────────────────
function extractCustomerName(text: string): string | undefined {
  const namePatterns = [
    // "Customer Name MARSHA A CARPENTER Account" — no colon, stops at next label
    /customer\s+name\s+([A-Z][A-Z\s]+?)(?:\s+Account|\s+Billing|\s+Service|\s*$)/i,
    /(?:account\s+(?:name|holder)|customer\s+name|service\s+(?:for|to))[:\s]+([A-Z][a-zA-Z\s,]+?)(?:\s{2,}|\n|$)/,
    /(?:bill(?:ed)?\s+to|invoice\s+to)[:\s]+([A-Z][a-zA-Z\s,]+?)(?:\n|$)/,
    /(?:name)[:\s]+([A-Z][a-zA-Z\s,]{2,40})(?:\n|$)/,
  ];

  for (const pattern of namePatterns) {
    const match = text.match(pattern);
    if (match) {
      const name = match[1].trim();
      if (name.length > 2 && name.length < 60) return name;
    }
  }

  // Fallback: bare ALL-CAPS name on its own line (e.g. "WAYNE R ALLEN")
  // Common in CMP, Eversource, National Grid where name appears without a label.
  // Must be 2-4 words, all caps, no digits, not a known header/section word.
  const SKIP_WORDS = /^(?:ACCOUNT|SERVICE|INVOICE|AMOUNT|DATE|BALANCE|TOTAL|PAYMENT|PLEASE|CENTRAL|POWER|ENERGY|ELECTRIC|YOUR|PAGE|AND|FOR|THE|NEW|OLD|CURRENT|PRIOR|NON|CMP|AVANGRID)$/;
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    // 2–4 all-caps words (including middle initial like "R"), no digits
    const allCapsName = trimmed.match(/^([A-Z]{2,}(?:\s+[A-Z]{1,2}(?:\s+[A-Z]{2,})?)?)$/);
    if (allCapsName) {
      const words = trimmed.split(/\s+/);
      if (words.length >= 2 && words.length <= 4 && !words.some(w => SKIP_WORDS.test(w))) {
        return trimmed
          .split(/\s+/)
          .map(w => w.charAt(0) + w.slice(1).toLowerCase())
          .join(' ');
      }
    }
  }

  return undefined;
}

// ── Extract service address ───────────────────────────────────────────────────
function extractServiceAddress(text: string): string | undefined {
  const addrPatterns = [
    // Full address with zip: "Service Address: 123 Main St, City, IL 62246"
    /(?:service\s+address|premises|property\s+address)[:\s]+([0-9]+[^,\n]+,[^,\n]+,\s*[A-Z]{2}\s+\d{5})/i,
    // Address with state but no zip
    /(?:service\s+address|premises)[:\s]+([0-9]+\s+[A-Za-z\s]+(?:St|Ave|Blvd|Dr|Rd|Ln|Way|Ct|Pl|Hwy|Pkwy)[.,\s]+[A-Za-z\s]+,\s*[A-Z]{2})/i,
    // Mailing block all-caps: "1016 FRANKLIN ST POCAHONTAS IL 62275-3123"
    /([0-9]+\s+[A-Z][A-Z\s]+(?:ST|AVE|BLVD|DR|RD|LN|WAY|CT|PL|HWY)\s+[A-Z][A-Z\s]+[A-Z]{2}\s+\d{5}(?:-\d{4})?)/,
    // Service address stopping at known section labels
    /(?:service\s+address)[:\s]+([0-9]+\s+[A-Z][A-Z\s,]+?)(?:\s+Service\s+Location|\s+Rate\s+Schedule|\s+Meter\s+No|\s{3,}|$)/i,
    // Address at start of line with comma-separated city/state/zip
    /^([0-9]+\s+[A-Za-z\s]+(?:St|Ave|Blvd|Dr|Rd|Ln|Way|Ct|Pl)\b[^,\n]*,[^,\n]+,\s*[A-Z]{2}\s+\d{5})/im,
  ];

  for (const pattern of addrPatterns) {
    const match = text.match(pattern);
    if (match) {
      const addr = match[1].trim().replace(/\n/g, ', ').replace(/\s{2,}/g, ' ');
      if (addr.length > 10 && addr.length < 150) return addr;
    }
  }

  // Fallback: multi-line address block without label
  // "827 WATERVILLE RD\nSKOWHEGAN ME 04976"  (CMP / National Grid style)
  // Line 1: number + street name + street type
  // Line 2: city + 2-letter state + zip
  const multiLineMatch = text.match(
    /([0-9]+\s+[A-Z][A-Z0-9 ]{2,40}(?:ST|AVE|BLVD|DR|RD|LN|WAY|CT|PL|HWY|PKWY|TERR?|CIRCLE|CIR|COURT|TRAIL|TRL|PLACE|PLZ))\s*\n\s*([A-Z][A-Z ]{2,30}[A-Z]{2}\s+\d{5}(?:-\d{4})?)/
  );
  if (multiLineMatch) {
    const addr = `${multiLineMatch[1].trim()}, ${multiLineMatch[2].trim()}`;
    if (addr.length > 10 && addr.length < 150) return addr;
  }

  return undefined;
}

// ── Extract account number ────────────────────────────────────────────────────
function extractAccountNumber(text: string): string | undefined {
  const acctPatterns = [
    /(?:account\s+(?:number|no\.?|#))[:\s]+([0-9\-\s]{6,20})/i,
    /(?:acct\.?\s*(?:no\.?|#)?)[:\s]+([0-9\-\s]{6,20})/i,
    /(?:account)[:\s]+([0-9]{6,20})/i,
  ];

  for (const pattern of acctPatterns) {
    const match = text.match(pattern);
    if (match) return match[1].trim();
  }
  return undefined;
}

// ── Main regex parse function ─────────────────────────────────────────────────
export function parseBillText(text: string): BillExtractResult {
  const extractedFields: string[] = [];

  const billType = detectBillType(text);

  const utilityProvider = extractUtilityName(text);
  if (utilityProvider) extractedFields.push('utilityProvider');

  const customerName = extractCustomerName(text);
  if (customerName) extractedFields.push('customerName');

  const serviceAddress = extractServiceAddress(text);
  if (serviceAddress) extractedFields.push('serviceAddress');

  const accountNumber = extractAccountNumber(text);
  if (accountNumber) extractedFields.push('accountNumber');

  const kwhData = extractKwh(text);
  if (kwhData.monthly) extractedFields.push('monthlyKwh');
  if (kwhData.annual) extractedFields.push('annualKwh');

  // Prefer history from daily-avg table (extractKwh) over the month-label scanner
  // extractDailyAvgTable reconstructs actual monthly kWh from daily avg × days
  const monthlyUsageHistory =
    (kwhData.monthlyHistory && kwhData.monthlyHistory.length >= 6)
      ? kwhData.monthlyHistory
      : extractMonthlyHistory(text);
  if (monthlyUsageHistory) extractedFields.push('monthlyUsageHistory');

  const electricityRate = extractRate(text);
  if (electricityRate) extractedFields.push('electricityRate');

  const totalAmount = extractTotalAmount(text);
  if (totalAmount) extractedFields.push('totalAmount');

  const fixedCharges = extractFixedCharges(text);
  if (fixedCharges) extractedFields.push('fixedCharges');

  const billingPeriod = extractBillingPeriod(text);
  if (billingPeriod.start) extractedFields.push('billingPeriod');

  const tiered = extractTieredUsage(text);
  if (tiered.tier1Kwh || tiered.tier1Rate) extractedFields.push('tieredUsage');

  const demand = extractDemandCharge(text);
  if (demand.charge || demand.kw) extractedFields.push('demandCharge');

  const gasUsageTherm = billType !== 'electric' ? extractGasUsage(text) : undefined;
  if (gasUsageTherm) extractedFields.push('gasUsage');

  // Derive annual kWh:
  //   1. Explicit annual from bill text
  //   2. Sum of full 12-month history (daily-avg table reconstruction)
  //   3. Average of partial history × 12
  //   4. Monthly × 12 fallback
  let estimatedAnnualKwh = kwhData.annual;
  if (!estimatedAnnualKwh && monthlyUsageHistory && monthlyUsageHistory.length >= 6) {
    const nonZero = monthlyUsageHistory.filter(v => v > 0);
    if (nonZero.length >= 10) {
      // Near-complete year — sum directly
      estimatedAnnualKwh = monthlyUsageHistory.reduce((a, b) => a + b, 0);
    } else if (nonZero.length >= 3) {
      // Partial year — extrapolate from average
      const avg = nonZero.reduce((a, b) => a + b, 0) / nonZero.length;
      estimatedAnnualKwh = Math.round(avg * 12);
    }
  }
  if (!estimatedAnnualKwh && kwhData.monthly) {
    estimatedAnnualKwh = kwhData.monthly * 12;
  }

  const estimatedMonthlyBill = totalAmount ||
    (kwhData.monthly && electricityRate ? kwhData.monthly * electricityRate : undefined);

  // Confidence scoring
  let confidence: 'high' | 'medium' | 'low' = 'low';
  if (extractedFields.length >= 4) confidence = 'high';
  else if (extractedFields.length >= 2) confidence = 'medium';

  return {
    success: extractedFields.length > 0,
    billType,
    customerName,
    serviceAddress,
    utilityProvider,
    accountNumber,
    billingPeriodStart: billingPeriod.start,
    billingPeriodEnd: billingPeriod.end,
    billingDays: billingPeriod.days,
    monthlyKwh: kwhData.monthly,
    annualKwh: kwhData.annual,
    monthlyUsageHistory,
    electricityRate,
    totalAmount,
    fixedCharges,
    demandCharge: demand.charge,
    demandKw: demand.kw,
    tier1Kwh: tiered.tier1Kwh,
    tier2Kwh: tiered.tier2Kwh,
    tier1Rate: tiered.tier1Rate,
    tier2Rate: tiered.tier2Rate,
    gasUsageTherm,
    estimatedAnnualKwh,
    estimatedMonthlyBill,
    confidence,
    extractedFields,
    rawText: text.substring(0, 2000),
  };
}

// ── LLM fallback using GPT-4o-mini ───────────────────────────────────────────
export async function parseBillTextWithLLM(text: string): Promise<BillExtractResult> {
  // Always run regex first (fast, free, no latency)
  const regexResult = parseBillText(text);

  // Only call LLM if confidence is low AND OpenAI key is configured
  if (regexResult.confidence !== 'low' || !process.env.OPENAI_API_KEY) {
    return regexResult;
  }

  console.log('[billOcr] Low confidence — attempting LLM fallback');

  try {
    // Use fetch directly to avoid webpack bundling issues with openai SDK
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        max_tokens: 500,
        messages: [
          {
            role: 'system',
            content: `You are a utility bill data extractor. Extract structured data from utility bill text and return ONLY valid JSON with these fields (use null for missing):\n{\n  "monthlyKwh": number or null,\n  "annualKwh": number or null,\n  "electricityRate": number ($/kWh) or null,\n  "totalAmount": number ($) or null,\n  "utilityProvider": string or null,\n  "serviceAddress": string or null,\n  "customerName": string or null,\n  "accountNumber": string or null,\n  "billingPeriodStart": string or null,\n  "billingPeriodEnd": string or null,\n  "demandCharge": number ($) or null,\n  "billType": "electric" | "gas" | "combined" | "unknown"\n}\nOnly extract values clearly present in the text. Do not guess.`,
          },
          {
            role: 'user',
            content: `Extract data from this utility bill:\n\n${text.substring(0, 4000)}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`OpenAI API error ${res.status}: ${errBody.slice(0, 200)}`);
    }

    const completion = await res.json();
    const raw = completion.choices[0]?.message?.content || '{}';
    const llm = JSON.parse(raw);

    // Merge: regex values take precedence, LLM fills gaps
    const merged: BillExtractResult = {
      ...regexResult,
      monthlyKwh: regexResult.monthlyKwh ?? (llm.monthlyKwh || undefined),
      annualKwh: regexResult.annualKwh ?? (llm.annualKwh || undefined),
      electricityRate: regexResult.electricityRate ?? (llm.electricityRate || undefined),
      totalAmount: regexResult.totalAmount ?? (llm.totalAmount || undefined),
      utilityProvider: regexResult.utilityProvider ?? (llm.utilityProvider || undefined),
      serviceAddress: regexResult.serviceAddress ?? (llm.serviceAddress || undefined),
      customerName: regexResult.customerName ?? (llm.customerName || undefined),
      accountNumber: regexResult.accountNumber ?? (llm.accountNumber || undefined),
      billingPeriodStart: regexResult.billingPeriodStart ?? (llm.billingPeriodStart || undefined),
      billingPeriodEnd: regexResult.billingPeriodEnd ?? (llm.billingPeriodEnd || undefined),
      demandCharge: regexResult.demandCharge ?? (llm.demandCharge || undefined),
      billType: regexResult.billType !== 'unknown' ? regexResult.billType : (llm.billType || 'unknown'),
      usedLlmFallback: true,
    };

    // Recalculate derived fields
    merged.estimatedAnnualKwh = merged.annualKwh ||
      (merged.monthlyUsageHistory?.length
        ? Math.round(merged.monthlyUsageHistory.reduce((a, b) => a + b, 0) / merged.monthlyUsageHistory.length * 12)
        : merged.monthlyKwh ? merged.monthlyKwh * 12 : undefined);

    merged.estimatedMonthlyBill = merged.totalAmount ||
      (merged.monthlyKwh && merged.electricityRate ? merged.monthlyKwh * merged.electricityRate : undefined);

    // Recount extracted fields
    const newFields: string[] = [];
    if (merged.utilityProvider) newFields.push('utilityProvider');
    if (merged.customerName) newFields.push('customerName');
    if (merged.serviceAddress) newFields.push('serviceAddress');
    if (merged.accountNumber) newFields.push('accountNumber');
    if (merged.monthlyKwh) newFields.push('monthlyKwh');
    if (merged.annualKwh) newFields.push('annualKwh');
    if (merged.electricityRate) newFields.push('electricityRate');
    if (merged.totalAmount) newFields.push('totalAmount');
    if (merged.billingPeriodStart) newFields.push('billingPeriod');
    if (merged.demandCharge) newFields.push('demandCharge');
    merged.extractedFields = newFields;

    // Upgrade confidence
    if (newFields.length >= 4) merged.confidence = 'high';
    else if (newFields.length >= 2) merged.confidence = 'medium';
    merged.success = newFields.length > 0;

    console.log('[billOcr] LLM fallback extracted', newFields.length, 'fields, confidence:', merged.confidence);
    return merged;

  } catch (err: any) {
    console.warn('[billOcr] LLM fallback failed:', err.message);
    return regexResult;
  }
}

// ── AI Structured Extraction Fallback ─────────────────────────────────────────
/**
 * extractBillDataWithAI()
 *
 * Called when parseBillText() extracts ZERO fields from OCR text.
 * Sends raw OCR text to OpenAI with a structured JSON schema prompt.
 * Uses semantic detection rather than rigid label matching.
 *
 * Returns the exact BillExtractResult fields that were successfully extracted.
 * Usage fields (kWh) are NOT overridden by the main parseBill() deterministic
 * parser — this function only fills structural fields when regex finds nothing.
 */
export async function extractBillDataWithAI(
  ocrText: string,
  existingResult: BillExtractResult,
): Promise<BillExtractResult> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    console.log('[billOcr] AI fallback skipped — no OPENAI_API_KEY');
    return existingResult;
  }

  if (!ocrText || ocrText.trim().length < 20) {
    console.log('[billOcr] AI fallback skipped — OCR text too short');
    return existingResult;
  }

  console.log(`[billOcr] AI structured extraction fallback — text length: ${ocrText.length}`);

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        max_tokens: 600,
        messages: [
          {
            role: 'system',
            content: `You are an expert utility bill parser. Extract structured data from OCR text of an electric utility bill.

Return ONLY valid JSON matching this schema (use null for any field not found):
{
  "utility": "string — utility company name (e.g. 'Central Maine Power', 'Eversource')",
  "account_number": "string — account or customer number",
  "customer_name": "string — customer/account holder name",
  "service_address": "string — service/property address",
  "billing_period_start": "string — start date of billing period (ISO or readable)",
  "billing_period_end": "string — end date of billing period",
  "kwh_usage": "number — electricity usage in kWh for this billing period (most recent month)",
  "annual_kwh": "number — annual or 12-month total kWh if shown",
  "electricity_rate": "number — cost per kWh in dollars (e.g. 0.15 not 15)",
  "bill_total": "number — total amount due in dollars",
  "bill_type": "electric | gas | combined | unknown"
}

Rules:
- Use semantic reasoning — labels may be absent or OCR-garbled
- For kWh: look for numbers followed by kWh, KWH, NWH, or similar
- For rate: look for $/kWh patterns or cents-per-kWh (convert cents to dollars)
- For address: look for street numbers, city/state/zip patterns
- Do NOT guess values not present in the text
- Return null for any field you cannot confidently identify`,
          },
          {
            role: 'user',
            content: `Extract data from this utility bill OCR text:

${ocrText.substring(0, 4000)}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.warn(`[billOcr] AI fallback HTTP ${res.status}: ${errBody.slice(0, 200)}`);
      return existingResult;
    }

    const completion = await res.json();
    const raw = completion.choices?.[0]?.message?.content || '{}';
    let ai: Record<string, any> = {};
    try { ai = JSON.parse(raw); } catch { ai = {}; }

    console.log('[billOcr] AI extraction result:', JSON.stringify(ai));

    // Merge AI results into existing — AI fills gaps, never overrides existing values
    const merged: BillExtractResult = {
      ...existingResult,
      utilityProvider:    existingResult.utilityProvider    ?? (ai.utility          || undefined),
      accountNumber:      existingResult.accountNumber      ?? (ai.account_number   || undefined),
      customerName:       existingResult.customerName       ?? (ai.customer_name    || undefined),
      serviceAddress:     existingResult.serviceAddress     ?? (ai.service_address  || undefined),
      billingPeriodStart: existingResult.billingPeriodStart ?? (ai.billing_period_start || undefined),
      billingPeriodEnd:   existingResult.billingPeriodEnd   ?? (ai.billing_period_end   || undefined),
      monthlyKwh:         existingResult.monthlyKwh         ?? (ai.kwh_usage > 0 ? ai.kwh_usage : undefined),
      annualKwh:          existingResult.annualKwh          ?? (ai.annual_kwh > 0 ? ai.annual_kwh : undefined),
      electricityRate:    existingResult.electricityRate    ?? (ai.electricity_rate > 0 ? ai.electricity_rate : undefined),
      totalAmount:        existingResult.totalAmount        ?? (ai.bill_total > 0 ? ai.bill_total : undefined),
      billType:           (existingResult.billType !== 'unknown' ? existingResult.billType : (ai.bill_type || 'unknown')) as BillExtractResult['billType'],
      usedLlmFallback: true,
    };

    // Recalculate estimatedAnnualKwh
    merged.estimatedAnnualKwh =
      merged.annualKwh ??
      (merged.monthlyUsageHistory?.length
        ? Math.round(merged.monthlyUsageHistory.reduce((a, b) => a + b, 0) / merged.monthlyUsageHistory.length * 12)
        : merged.monthlyKwh ? merged.monthlyKwh * 12 : existingResult.estimatedAnnualKwh);

    // Rebuild extractedFields
    const newFields: string[] = [];
    if (merged.utilityProvider)    newFields.push('utilityProvider');
    if (merged.customerName)       newFields.push('customerName');
    if (merged.serviceAddress)     newFields.push('serviceAddress');
    if (merged.accountNumber)      newFields.push('accountNumber');
    if (merged.monthlyKwh)         newFields.push('monthlyKwh');
    if (merged.annualKwh)          newFields.push('annualKwh');
    if (merged.monthlyUsageHistory?.length) newFields.push('monthlyUsageHistory');
    if (merged.electricityRate)    newFields.push('electricityRate');
    if (merged.totalAmount)        newFields.push('totalAmount');
    if (merged.billingPeriodStart) newFields.push('billingPeriod');
    merged.extractedFields = newFields;

    // Upgrade confidence based on fields found
    if (newFields.length >= 4)      merged.confidence = 'high';
    else if (newFields.length >= 2) merged.confidence = 'medium';
    else if (newFields.length >= 1) merged.confidence = 'low';
    merged.success = newFields.length > 0;

    console.log(`[billOcr] AI fallback: ${newFields.length} fields — ${newFields.join(', ')} — confidence: ${merged.confidence}`);
    return merged;

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[billOcr] AI structured extraction failed:', msg);
    return existingResult;
  }
}


// ── Validate extracted data ───────────────────────────────────────────────────
export function validateBillData(result: BillExtractResult): {
  valid: boolean;
  warnings: string[];
  errors: string[];
} {
  const warnings: string[] = [];
  const errors: string[] = [];

  // Gas-only bill — can't size solar from gas usage
  if (result.billType === 'gas') {
    errors.push('This appears to be a gas-only bill. Please upload your electric utility bill to size a solar system.');
    return { valid: false, warnings, errors };
  }

  if (!result.monthlyKwh && !result.annualKwh && !result.estimatedAnnualKwh) {
    errors.push('Could not extract kWh usage from bill. Please verify this is an electric utility bill.');
  }
  if (result.monthlyKwh && (result.monthlyKwh < 50 || result.monthlyKwh > 50000)) {
    warnings.push(`Unusual monthly kWh: ${result.monthlyKwh} — please verify`);
  }
  if (!result.utilityProvider) {
    warnings.push('Could not identify utility provider — will use location-based detection');
  }
  if (!result.electricityRate) {
    warnings.push('Could not extract electricity rate — will use state average');
  }
  if (result.electricityRate && (result.electricityRate < 0.01 || result.electricityRate > 1.5)) {
    warnings.push(`Unusual electricity rate: $${result.electricityRate}/kWh — please verify`);
  }
  if (result.billType === 'combined') {
    warnings.push('Combined electric + gas bill detected — only electric usage used for solar sizing');
  }
  if (result.demandCharge) {
    warnings.push('Demand charges detected — commercial rate structure may affect solar ROI calculations');
  }
  if (result.usedLlmFallback) {
    warnings.push('Some fields were extracted using AI assistance — please verify the data below');
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
  };
}