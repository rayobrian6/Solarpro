/**
 * lib/billOcr.ts
 * Utility bill OCR extraction — parses PDF/JPG/PNG electric bills.
 * Uses pattern matching on extracted text to find kWh, rate, provider, address.
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
  // Charges
  totalAmount?: number;
  electricityRate?: number;  // $/kWh
  fixedCharges?: number;
  demandCharge?: number;
  // Derived
  estimatedAnnualKwh?: number;  // monthlyKwh * 12 if annual not available
  estimatedMonthlyBill?: number;
  // Confidence
  confidence: 'high' | 'medium' | 'low';
  extractedFields: string[];
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
];

// ── Extract utility name from text ────────────────────────────────────────────
function extractUtilityName(text: string): string | undefined {
  for (const [pattern, name] of UTILITY_PATTERNS) {
    if (pattern.test(text)) return name;
  }
  // Try to find "X Electric" or "X Power" or "X Energy" patterns
  const genericMatch = text.match(/([A-Z][a-zA-Z\s]+(?:Electric(?:ity)?|Power|Energy|Light|Gas|Utilities?))/);
  if (genericMatch) return genericMatch[1].trim();
  return undefined;
}

// ── Extract kWh usage ─────────────────────────────────────────────────────────
function extractKwh(text: string): { monthly?: number; annual?: number } {
  const result: { monthly?: number; annual?: number } = {};

  // Patterns for monthly kWh
  const monthlyPatterns = [
    /(?:total\s+)?(?:energy\s+)?(?:usage|used|consumption|kwh\s+used)[:\s]+([0-9,]+)\s*kwh/i,
    /([0-9,]+)\s*kwh\s+(?:used|usage|consumed|billed)/i,
    /(?:electric\s+)?(?:usage|consumption)[:\s]+([0-9,]+)\s*(?:kwh|kw-?h)/i,
    /kwh[:\s]+([0-9,]+)/i,
    /([0-9,]+)\s*kw[h-]?\s*@/i,
    /(?:current\s+)?(?:month(?:ly)?\s+)?usage[:\s]+([0-9,]+)/i,
    /(?:billing\s+)?(?:period\s+)?usage[:\s]+([0-9,]+)\s*kwh/i,
    /(?:total\s+)?kwh\s+(?:this\s+(?:month|period))[:\s]+([0-9,]+)/i,
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

  // Patterns for annual kWh
  const annualPatterns = [
    /(?:annual|yearly|12[- ]month)\s+(?:usage|consumption|average)[:\s]+([0-9,]+)\s*kwh/i,
    /(?:last\s+12\s+months?)[:\s]+([0-9,]+)\s*kwh/i,
    /(?:annual\s+)?(?:total\s+)?(?:usage\s+)?(?:for\s+the\s+year)[:\s]+([0-9,]+)/i,
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

// ── Extract electricity rate ──────────────────────────────────────────────────
function extractRate(text: string): number | undefined {
  const ratePatterns = [
    /(?:energy\s+)?(?:charge|rate|price)[:\s]+\$?([0-9]+\.[0-9]{2,4})\s*(?:per\s+)?(?:\/\s*)?kwh/i,
    /\$([0-9]+\.[0-9]{2,4})\s*(?:per\s+)?(?:\/\s*)?kwh/i,
    /([0-9]+\.[0-9]{2,4})\s*(?:¢|cents?)\s*(?:per\s+)?(?:\/\s*)?kwh/i,
    /kwh\s+@\s+\$?([0-9]+\.[0-9]{3,5})/i,
    /(?:unit\s+)?(?:rate|price)[:\s]+([0-9]+\.[0-9]{3,5})/i,
  ];

  for (const pattern of ratePatterns) {
    const match = text.match(pattern);
    if (match) {
      let rate = parseFloat(match[1]);
      // If in cents, convert to dollars
      if (rate > 1) rate = rate / 100;
      if (rate > 0.05 && rate < 1.0) return rate;
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

// ── Extract billing period ────────────────────────────────────────────────────
function extractBillingPeriod(text: string): {
  start?: string; end?: string; days?: number;
} {
  const result: { start?: string; end?: string; days?: number } = {};

  // Date range patterns
  const rangePatterns = [
    /(?:service|billing|bill)\s+(?:period|dates?)[:\s]+([A-Za-z]+\s+\d{1,2},?\s+\d{4})\s*(?:to|-|through)\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
    /(\d{1,2}\/\d{1,2}\/\d{2,4})\s*(?:to|-|through)\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/,
    /(\d{1,2}-\d{1,2}-\d{2,4})\s*(?:to|-|through)\s*(\d{1,2}-\d{1,2}-\d{2,4})/,
  ];

  for (const pattern of rangePatterns) {
    const match = text.match(pattern);
    if (match) {
      result.start = match[1];
      result.end = match[2];
      break;
    }
  }

  // Days in billing period
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
    /(?:service\s+address|premises)[:\s]+([0-9]+\s+[A-Za-z\s]+(?:St|Ave|Blvd|Dr|Rd|Ln|Way|Ct|Pl)[.,\s]+[A-Za-z\s]+,\s*[A-Z]{2})/i,
  ];

  for (const pattern of addrPatterns) {
    const match = text.match(pattern);
    if (match) return match[1].trim();
  }
  return undefined;
}

// ── Extract account number ────────────────────────────────────────────────────
function extractAccountNumber(text: string): string | undefined {
  const acctPatterns = [
    /(?:account\s+(?:number|no\.?|#))[:\s]+([0-9\-\s]{6,20})/i,
    /(?:acct\.?\s*(?:no\.?|#)?)[:\s]+([0-9\-\s]{6,20})/i,
  ];

  for (const pattern of acctPatterns) {
    const match = text.match(pattern);
    if (match) return match[1].trim();
  }
  return undefined;
}

// ── Main parse function ───────────────────────────────────────────────────────
export function parseBillText(text: string): BillExtractResult {
  const extractedFields: string[] = [];

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

  const electricityRate = extractRate(text);
  if (electricityRate) extractedFields.push('electricityRate');

  const totalAmount = extractTotalAmount(text);
  if (totalAmount) extractedFields.push('totalAmount');

  const billingPeriod = extractBillingPeriod(text);
  if (billingPeriod.start) extractedFields.push('billingPeriod');

  // Estimate annual kWh if not directly available
  const estimatedAnnualKwh = kwhData.annual || (kwhData.monthly ? kwhData.monthly * 12 : undefined);

  // Estimate monthly bill from usage and rate
  const estimatedMonthlyBill = totalAmount ||
    (kwhData.monthly && electricityRate ? kwhData.monthly * electricityRate : undefined);

  // Confidence scoring
  let confidence: 'high' | 'medium' | 'low' = 'low';
  if (extractedFields.length >= 4) confidence = 'high';
  else if (extractedFields.length >= 2) confidence = 'medium';

  return {
    success: extractedFields.length > 0,
    customerName,
    serviceAddress,
    utilityProvider,
    accountNumber,
    billingPeriodStart: billingPeriod.start,
    billingPeriodEnd: billingPeriod.end,
    billingDays: billingPeriod.days,
    monthlyKwh: kwhData.monthly,
    annualKwh: kwhData.annual,
    electricityRate,
    totalAmount,
    estimatedAnnualKwh,
    estimatedMonthlyBill,
    confidence,
    extractedFields,
    rawText: text.substring(0, 2000), // first 2000 chars for debugging
  };
}

// ── Validate extracted data ───────────────────────────────────────────────────
export function validateBillData(result: BillExtractResult): {
  valid: boolean;
  warnings: string[];
  errors: string[];
} {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!result.monthlyKwh && !result.annualKwh) {
    errors.push('Could not extract kWh usage from bill');
  }
  if (result.monthlyKwh && (result.monthlyKwh < 50 || result.monthlyKwh > 50000)) {
    warnings.push(`Unusual monthly kWh: ${result.monthlyKwh} — please verify`);
  }
  if (!result.utilityProvider) {
    warnings.push('Could not identify utility provider');
  }
  if (!result.electricityRate) {
    warnings.push('Could not extract electricity rate — will use state average');
  }
  if (result.electricityRate && (result.electricityRate < 0.05 || result.electricityRate > 0.80)) {
    warnings.push(`Unusual electricity rate: $${result.electricityRate}/kWh — please verify`);
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
  };
}