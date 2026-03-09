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

// ── Extract kWh usage ─────────────────────────────────────────────────────────
function extractKwh(text: string): { monthly?: number; annual?: number } {
  const result: { monthly?: number; annual?: number } = {};

  const monthlyPatterns = [
    /(?:total\s+)?(?:energy\s+)?(?:usage|used|consumption|kwh\s+used)[:\s]+([0-9,]+)\s*kwh/i,
    /([0-9,]+)\s*kwh\s+(?:used|usage|consumed|billed)/i,
    /(?:electric\s+)?(?:usage|consumption)[:\s]+([0-9,]+)\s*(?:kwh|kw-?h)/i,
    /kwh[:\s]+([0-9,]+)/i,
    /([0-9,]+)\s*kw[h-]?\s*@/i,
    /(?:current\s+)?(?:month(?:ly)?\s+)?usage[:\s]+([0-9,]+)/i,
    /(?:billing\s+)?(?:period\s+)?usage[:\s]+([0-9,]+)\s*kwh/i,
    /(?:total\s+)?kwh\s+(?:this\s+(?:month|period))[:\s]+([0-9,]+)/i,
    /(?:electricity\s+)?(?:used\s+this\s+(?:month|period))[:\s]+([0-9,]+)/i,
    /(?:net\s+)?(?:metered\s+)?usage[:\s]+([0-9,]+)\s*kwh/i,
  ];

  for (const pattern of monthlyPatterns) {
    const match = text.match(pattern);
    if (match) {
      const val = parseFloat(match[1].replace(/,/g, ''));
      if (val > 0 && val < 100000) {
        result.monthly = val;
        break;
      }
    }
  }

  const annualPatterns = [
    /(?:annual|yearly|12[- ]month)\s+(?:usage|consumption|average)[:\s]+([0-9,]+)\s*kwh/i,
    /(?:last\s+12\s+months?)[:\s]+([0-9,]+)\s*kwh/i,
    /(?:annual\s+)?(?:total\s+)?(?:usage\s+)?(?:for\s+the\s+year)[:\s]+([0-9,]+)/i,
    /(?:12[- ]month\s+total)[:\s]+([0-9,]+)\s*kwh/i,
  ];

  for (const pattern of annualPatterns) {
    const match = text.match(pattern);
    if (match) {
      const val = parseFloat(match[1].replace(/,/g, ''));
      if (val > 0 && val < 1000000) {
        result.annual = val;
        break;
      }
    }
  }

  return result;
}

// ── Extract 12-month usage history ───────────────────────────────────────────
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
      if (rate > 0.04 && rate < 1.5) return Math.round(rate * 10000) / 10000;
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
    /(?:account\s+(?:name|holder)|customer\s+name|service\s+(?:for|to))[:\s]+([A-Z][a-zA-Z\s,]+?)(?:\n|$)/,
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
  return undefined;
}

// ── Extract service address ───────────────────────────────────────────────────
function extractServiceAddress(text: string): string | undefined {
  const addrPatterns = [
    /(?:service\s+address|premises|property\s+address)[:\s]+([0-9]+[^,\n]+,[^,\n]+,\s*[A-Z]{2}\s+\d{5})/i,
    /(?:service\s+address|premises)[:\s]+([0-9]+\s+[A-Za-z\s]+(?:St|Ave|Blvd|Dr|Rd|Ln|Way|Ct|Pl|Hwy|Pkwy)[.,\s]+[A-Za-z\s]+,\s*[A-Z]{2})/i,
    /(?:service\s+address)[:\s]+([0-9]+\s+.{5,60})/i,
    // Address at start of line: "123 Main St, City, CA 90210"
    /^([0-9]+\s+[A-Za-z\s]+(?:St|Ave|Blvd|Dr|Rd|Ln|Way|Ct|Pl)\b[^,\n]*,[^,\n]+,\s*[A-Z]{2}\s+\d{5})/im,
  ];

  for (const pattern of addrPatterns) {
    const match = text.match(pattern);
    if (match) {
      const addr = match[1].trim();
      if (addr.length > 10 && addr.length < 150) return addr;
    }
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

  const monthlyUsageHistory = extractMonthlyHistory(text);
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

  // Derive annual kWh: use history average if available, else monthly * 12
  let estimatedAnnualKwh = kwhData.annual;
  if (!estimatedAnnualKwh && monthlyUsageHistory && monthlyUsageHistory.length >= 6) {
    const avg = monthlyUsageHistory.reduce((a, b) => a + b, 0) / monthlyUsageHistory.length;
    estimatedAnnualKwh = Math.round(avg * 12);
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
  if (result.electricityRate && (result.electricityRate < 0.04 || result.electricityRate > 1.5)) {
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