/**
 * lib/billClaudeExtractor.ts — Claude 3.5 Sonnet Multimodal Bill Extraction Engine
 *
 * Replaces gpt-4o-mini text-only extraction with Claude 3.5 Sonnet vision extraction.
 * Claude receives the bill as a BASE64 IMAGE directly — no OCR pre-processing needed.
 *
 * Why Claude 3.5 Sonnet over GPT-4o for this task:
 *   - Superior chart/graph reading: accurately extracts values from bar charts
 *   - Better table parsing across non-standard utility layouts
 *   - Stronger structured output adherence with complex nested JSON
 *   - More reliable null-vs-guess behavior (never hallucinates bill data)
 *
 * Architecture:
 *   Input:  image buffer (PDF page rasterized, PNG, JPG, JFIF) OR raw text string
 *   Output: AiBillData (same interface as existing aiExtractBillData — drop-in)
 *
 * Integration:
 *   - Called by billPipeline.ts as the primary AI extraction step
 *   - Falls back gracefully to existing GPT-4o-mini path if ANTHROPIC_API_KEY not set
 *   - Preserves full backward compatibility with BillExtractResult shape
 *
 * Validation (per spec):
 *   - annualMismatch: sum(monthlyUsage) vs annualUsage delta > 5%
 *   - costOutOfRange: costPerKwh outside $0.05–$0.80
 *   - totalBillInvalid: totalBill not positive/non-zero
 *   - missingBillingPeriod: no {start, end} pair found
 *
 * Status tagging:
 *   complete  — customerName, address, utility, monthlyUsage, totalBill all non-null
 *   partial   — at least utility AND (monthlyUsage OR annualUsage) non-null
 *   failed    — everything else
 */

import type { AiBillData } from '@/lib/billPipeline';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ClaudeValidationFlags {
  annualMismatch: boolean;       // sum(monthly) vs annual delta > 5%
  costOutOfRange: boolean;       // costPerKwh outside $0.05–$0.80
  totalBillInvalid: boolean;     // totalBill missing or <= 0
  missingBillingPeriod: boolean; // no billing period found
}

export type ClaudeExtractionStatus = 'complete' | 'partial' | 'failed';

export interface ClaudeExtractionResult {
  status: ClaudeExtractionStatus;
  validationFlags: ClaudeValidationFlags;
  data: AiBillData;
  rawClaudeOutput: string;       // for audit logging
  model: string;                 // which model version was used
  inputType: 'image' | 'text';   // whether Claude received image or text
}

// ─── System Prompt ──────────────────────────────────────────────────────────────

const BILL_PARSER_SYSTEM_PROMPT = `You are an expert utility bill parsing engine for SolarPro, a solar installation platform operating across all 50 US states and internationally.

Your job is to extract structured energy usage and billing data from utility bills in any format — digital PDFs, scans, photos, screenshots. Bills come from every US utility company and beyond.

EXTRACTION RULES:
1. Extract ALL fields you can find with high confidence
2. Return null for any field you cannot determine with confidence — NEVER guess or infer
3. Read bar graphs and line charts directly — extract the numeric values from each bar/point
4. Parse tables, even non-standard layouts
5. Handle multi-column bills by reading all columns before concluding
6. For billing dates in MM/DD/YY format: 07/18/25 = 2025-07-18

MONTHLY USAGE EXTRACTION (critical):
- Look for a usage history section, bar chart, or 12-month table
- Each bar or row represents one month — extract ALL months shown, oldest to newest
- Output as a 12-element array, null-pad if fewer months shown
- If only current month shown (no history), put that value in the array at the correct position
- A typical residential monthly bill is 300–4,000 kWh

CURRENT MONTH kWh (total_kwh):
Priority order:
1. "Billable Usage (kWh)" or "Billable Usage" line
2. "Total Usage", "Electric Usage", "kWh Used", "kWh This Period"
3. Meter reading difference (current minus previous)
IGNORE: average daily usage (e.g. "23 kWh/day"), prior year values, numbers under 100 unless the bill is genuinely tiny

COST EXTRACTION (total_cost):
Priority order:
1. "Current Electric Charges" or "Current Charges"
2. "Total Current Charges"
3. "Amount Due" ONLY if no separate current charges line exists
IGNORE: Balance Forward, Previous Balance, Account Balance (may include prior unpaid amounts)

RATE EXTRACTION (electricity_rate):
- Express in dollars per kWh (e.g. 0.125 for 12.5 cents/kWh)
- Convert cents to dollars if shown as cents

SUPPLY vs DELIVERY:
- supply_charges: the generation/supply portion of the bill
- delivery_charges: the distribution/delivery portion

Return ONLY a valid JSON object matching this exact schema. No explanation, no markdown, no code blocks — just the raw JSON:

{
  "customerName": "string or null",
  "address": "string — service/property address (not mailing address) or null",
  "utility": "string — utility company name (e.g. Dominion Energy, PG&E, Duke Energy) or null",
  "state": "string — 2-letter state code (e.g. VA, CA) or null",
  "monthlyUsage": "array of 12 numbers oldest-to-newest, null-padded, or null if no history shown",
  "annualUsage": "number — total annual kWh if explicitly shown, or null",
  "peakMonth": "string — month name of highest usage (e.g. July) or null",
  "costPerKwh": "number in dollars (e.g. 0.125) or null",
  "totalBill": "number in dollars — current period charges only, or null",
  "supplyCharges": "number or null",
  "deliveryCharges": "number or null",
  "rateStructure": "fixed or tiered or TOU or null",
  "billingPeriods": [{"start": "YYYY-MM-DD", "end": "YYYY-MM-DD"}],
  "total_kwh": "number — current month kWh usage or null",
  "monthly_kwh": "same as monthlyUsage array — oldest to newest or null",
  "total_cost": "same as totalBill or null",
  "electricity_rate": "same as costPerKwh in dollars or null",
  "utility_name": "same as utility or null",
  "billing_period_start": "YYYY-MM-DD or null",
  "billing_period_end": "YYYY-MM-DD or null",
  "customer_name": "same as customerName or null",
  "service_address": "same as address or null",
  "account_number": "string or null",
  "bill_type": "electric or gas or combined or unknown"
}`;

// ─── Main extraction function ───────────────────────────────────────────────────

/**
 * extractBillWithClaude — Primary entry point
 *
 * Accepts either:
 *   - imageBuffer + mimeType: sends image directly to Claude (best path — no OCR loss)
 *   - rawText: sends extracted text to Claude (fallback when image unavailable)
 *
 * Returns ClaudeExtractionResult with status tag and validation flags.
 * If ANTHROPIC_API_KEY is not set, returns null so caller can fall back to GPT.
 */
export async function extractBillWithClaude(
  input: { imageBuffer: Buffer; mimeType: string } | { rawText: string },
  options?: { timeoutMs?: number },
): Promise<ClaudeExtractionResult | null> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    console.log('[claudeExtractor] ANTHROPIC_API_KEY not set — skipping Claude extraction');
    return null;
  }

  const timeoutMs = options?.timeoutMs ?? 45000;
  const inputType = 'imageBuffer' in input ? 'image' : 'text';

  console.log(`[claudeExtractor] Starting extraction inputType=${inputType} timeout=${timeoutMs}ms`);

  try {
    const rawOutput = await Promise.race([
      callClaudeAPI(input, anthropicKey),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`[claudeExtractor] Claude API timed out after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);

    console.log(`[claudeExtractor] Raw output length=${rawOutput.length}`);
    console.log(`[claudeExtractor] Raw output preview: ${rawOutput.slice(0, 300)}`);

    const parsed = parseClaudeOutput(rawOutput);
    const aiBillData = mapToAiBillData(parsed);
    const validationFlags = validateExtraction(parsed);
    const status = computeStatus(parsed);

    console.log(`[claudeExtractor] Result: status=${status} utility=${aiBillData.utility_name} kwh=${aiBillData.total_kwh} months=${aiBillData.monthly_kwh?.length ?? 0} cost=${aiBillData.total_cost}`);
    console.log(`[claudeExtractor] Validation: annualMismatch=${validationFlags.annualMismatch} costOutOfRange=${validationFlags.costOutOfRange} totalBillInvalid=${validationFlags.totalBillInvalid} missingBillingPeriod=${validationFlags.missingBillingPeriod}`);

    return {
      status,
      validationFlags,
      data: aiBillData,
      rawClaudeOutput: rawOutput,
      model: 'claude-sonnet-4-5-20250929',
      inputType,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[claudeExtractor] Extraction failed: ${msg}`);
    return null;
  }
}

// ─── Claude API call ────────────────────────────────────────────────────────────

async function callClaudeAPI(
  input: { imageBuffer: Buffer; mimeType: string } | { rawText: string },
  apiKey: string,
): Promise<string> {
  // Build the user message content
  const messageContent: object[] = [];

  if ('imageBuffer' in input) {
    // Image path: send bill as base64 image — Claude reads layout, charts, tables directly
    const { imageBuffer, mimeType } = input;

    // Normalize mime type to what Claude accepts
    const claudeMime = normalizeMimeType(mimeType);

    // Claude's max image size is 5MB base64 (~3.75MB raw). Warn but don't fail.
    const base64 = imageBuffer.toString('base64');
    const base64SizeKb = Math.round(base64.length / 1024);
    console.log(`[claudeExtractor] Image size: ${base64SizeKb}KB base64 mime=${claudeMime}`);

    if (base64.length > 5 * 1024 * 1024) {
      console.warn(`[claudeExtractor] Image base64 is ${base64SizeKb}KB — may exceed Claude's 5MB limit`);
    }

    messageContent.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: claudeMime,
        data: base64,
      },
    });

    messageContent.push({
      type: 'text',
      text: 'Extract all bill data from this utility bill image. Return ONLY the JSON object as instructed.',
    });
  } else {
    // Text path: send extracted text to Claude for structured interpretation
    const { rawText } = input;
    console.log(`[claudeExtractor] Text input length=${rawText.length}`);

    messageContent.push({
      type: 'text',
      text: `Extract all bill data from this utility bill text. Return ONLY the JSON object as instructed.\n\n${rawText.slice(0, 8000)}`,
    });
  }

  const requestBody = {
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 2048,
    system: BILL_PARSER_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: messageContent,
      },
    ],
  };

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(40000),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`Claude API HTTP ${response.status}: ${errorBody.slice(0, 200)}`);
  }

  const responseData = await response.json();

  // Extract text from Claude's response
  const content = responseData?.content;
  if (!Array.isArray(content) || content.length === 0) {
    throw new Error('Claude API returned empty content array');
  }

  const textBlock = content.find((block: any) => block.type === 'text');
  if (!textBlock?.text) {
    throw new Error('Claude API returned no text block in content');
  }

  return textBlock.text.trim();
}

// ─── Output parsing ─────────────────────────────────────────────────────────────

function parseClaudeOutput(raw: string): Record<string, any> {
  // Claude sometimes wraps JSON in markdown code blocks despite instructions
  // Strip ```json ... ``` or ``` ... ``` wrappers if present
  let cleaned = raw.trim();

  const jsonBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    cleaned = jsonBlockMatch[1].trim();
  }

  // Try to find a JSON object if there's surrounding text
  if (!cleaned.startsWith('{')) {
    const jsonStart = cleaned.indexOf('{');
    const jsonEnd = cleaned.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd > jsonStart) {
      cleaned = cleaned.slice(jsonStart, jsonEnd + 1);
    }
  }

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.warn(`[claudeExtractor] JSON parse failed: ${e instanceof Error ? e.message : e}`);
    console.warn(`[claudeExtractor] Attempted to parse: ${cleaned.slice(0, 300)}`);
    return {};
  }
}

// ─── Map Claude output → AiBillData ────────────────────────────────────────────

/**
 * mapToAiBillData — converts Claude's JSON output to the AiBillData interface
 * used throughout billPipeline.ts. Handles both the spec's schema fields
 * AND the legacy fields (total_kwh, monthly_kwh, etc.) that Claude returns.
 */
function mapToAiBillData(parsed: Record<string, any>): AiBillData {
  // Utility name — try both field names
  const utilityName = safeString(parsed.utility_name ?? parsed.utility);

  // Customer name
  const customerName = safeString(parsed.customer_name ?? parsed.customerName);

  // Service address
  const serviceAddress = safeString(parsed.service_address ?? parsed.address);

  // Account number
  const accountNumber = safeString(parsed.account_number);

  // Billing dates — try legacy fields first, then spec fields
  const bpStart = parseBillingDate(parsed.billing_period_start ?? parsed.billingPeriods?.[0]?.start ?? null);
  const bpEnd = parseBillingDate(parsed.billing_period_end ?? parsed.billingPeriods?.[0]?.end ?? null);

  // Current month kWh — try both field names
  const totalKwh = safePositiveNumber(parsed.total_kwh ?? parsed.annualUsage ?? null);

  // Monthly usage array — try both field names, validate each value
  const monthlyRaw = parsed.monthly_kwh ?? parsed.monthlyUsage ?? null;
  const monthlyKwh = parseMonthlyArray(monthlyRaw);

  // Total bill cost — try both field names
  const totalCost = safePositiveNumber(parsed.total_cost ?? parsed.totalBill ?? null);

  // Electricity rate — try both field names, normalize to $/kWh
  const rawRate = parsed.electricity_rate ?? parsed.costPerKwh ?? null;
  const electricityRate = safeRate(rawRate);

  // Bill type
  const billType = parseBillType(parsed.bill_type);

  return {
    utility_name: utilityName,
    billing_period_start: bpStart,
    billing_period_end: bpEnd,
    total_kwh: totalKwh,
    monthly_kwh: monthlyKwh,
    total_cost: totalCost,
    electricity_rate: electricityRate,
    account_number: accountNumber,
    customer_name: customerName,
    service_address: serviceAddress,
    bill_type: billType,
  };
}

// ─── Validation (per spec) ──────────────────────────────────────────────────────

function validateExtraction(parsed: Record<string, any>): ClaudeValidationFlags {
  // annualMismatch: sum(monthlyUsage) vs annualUsage delta > 5%
  let annualMismatch = false;
  const monthlyArr = parseMonthlyArray(parsed.monthly_kwh ?? parsed.monthlyUsage ?? null);
  const annualUsage = safePositiveNumber(parsed.annualUsage ?? null);
  if (monthlyArr !== null && annualUsage !== null) {
    const monthlySum = monthlyArr.reduce((a, b) => a + b, 0);
    const delta = Math.abs(monthlySum - annualUsage) / annualUsage;
    if (delta > 0.05) {
      annualMismatch = true;
      console.warn(`[claudeExtractor] annualMismatch: sum(monthly)=${monthlySum} vs annual=${annualUsage} delta=${(delta * 100).toFixed(1)}%`);
    }
  }

  // costOutOfRange: costPerKwh outside $0.05–$0.80
  const rate = safeRate(parsed.electricity_rate ?? parsed.costPerKwh ?? null);
  const costOutOfRange = rate !== null && (rate < 0.05 || rate > 0.80);
  if (costOutOfRange) {
    console.warn(`[claudeExtractor] costOutOfRange: rate=${rate} is outside $0.05–$0.80`);
  }

  // totalBillInvalid: missing or <= 0
  const totalBill = safePositiveNumber(parsed.total_cost ?? parsed.totalBill ?? null);
  const totalBillInvalid = totalBill === null || totalBill <= 0;

  // missingBillingPeriod: no billing period found
  const bpStart = parseBillingDate(parsed.billing_period_start ?? parsed.billingPeriods?.[0]?.start ?? null);
  const bpEnd = parseBillingDate(parsed.billing_period_end ?? parsed.billingPeriods?.[0]?.end ?? null);
  const missingBillingPeriod = bpStart === null && bpEnd === null;

  return { annualMismatch, costOutOfRange, totalBillInvalid, missingBillingPeriod };
}

// ─── Status computation (per spec) ─────────────────────────────────────────────

function computeStatus(parsed: Record<string, any>): ClaudeExtractionStatus {
  const customerName = safeString(parsed.customer_name ?? parsed.customerName);
  const address = safeString(parsed.service_address ?? parsed.address);
  const utility = safeString(parsed.utility_name ?? parsed.utility);
  const monthlyArr = parseMonthlyArray(parsed.monthly_kwh ?? parsed.monthlyUsage ?? null);
  const totalBill = safePositiveNumber(parsed.total_cost ?? parsed.totalBill ?? null);
  const annualUsage = safePositiveNumber(parsed.annualUsage ?? null);

  // complete: customerName, address, utility, monthlyUsage, and totalBill all non-null
  const hasMonthlyUsage = monthlyArr !== null && monthlyArr.length > 0;
  if (customerName && address && utility && hasMonthlyUsage && totalBill) {
    return 'complete';
  }

  // partial: at least utility AND (monthlyUsage OR annualUsage) non-null
  const hasUsageData = hasMonthlyUsage || annualUsage !== null;
  if (utility && hasUsageData) {
    return 'partial';
  }

  return 'failed';
}

// ─── Helper functions ───────────────────────────────────────────────────────────

function normalizeMimeType(mimeType: string): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' {
  if (mimeType.includes('png')) return 'image/png';
  if (mimeType.includes('gif')) return 'image/gif';
  if (mimeType.includes('webp')) return 'image/webp';
  return 'image/jpeg'; // default — JFIF, JPG, JPEG all map here
}

function safeString(val: unknown): string | null {
  if (typeof val === 'string' && val.trim().length > 0) return val.trim();
  return null;
}

function safePositiveNumber(val: unknown): number | null {
  if (typeof val === 'number' && isFinite(val) && val > 0) return val;
  if (typeof val === 'string') {
    const n = parseFloat(val.replace(/[^0-9.]/g, ''));
    if (!isNaN(n) && n > 0) return n;
  }
  return null;
}

function safeRate(val: unknown): number | null {
  const n = safePositiveNumber(val);
  if (n === null) return null;
  // If rate looks like cents (e.g. 12.5), convert to dollars
  // Typical US rates are 0.05–0.80 $/kWh
  // If value > 1 it's almost certainly in cents — convert
  if (n > 1 && n <= 100) return n / 100;
  if (n > 0 && n <= 5) return n; // already in dollars
  return null; // implausible
}

function parseBillingDate(val: unknown): string | null {
  if (typeof val !== 'string' || !val.trim()) return null;
  const s = val.trim();

  // Already ISO format YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // MM/DD/YY or MM/DD/YYYY
  const mdyMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (mdyMatch) {
    const [, m, d, y] = mdyMatch;
    const year = y.length === 2 ? (parseInt(y) >= 50 ? `19${y}` : `20${y}`) : y;
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // Month name: "Jul 18, 2025" or "July 18 2025"
  const monMatch = s.match(/^(\w+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (monMatch) {
    const months: Record<string, string> = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    };
    const mon = months[monMatch[1].toLowerCase().slice(0, 3)];
    if (mon) return `${monMatch[3]}-${mon}-${monMatch[2].padStart(2, '0')}`;
  }

  return s; // return as-is if unparseable
}

function parseMonthlyArray(val: unknown): number[] | null {
  if (!Array.isArray(val)) return null;
  const cleaned = val
    .map((v: any) => {
      if (typeof v === 'number' && isFinite(v) && v > 0) return v;
      if (v === null || v === undefined) return null; // null-padding is valid per spec
      if (typeof v === 'string') {
        const n = parseFloat(v.replace(/[^0-9.]/g, ''));
        return !isNaN(n) && n > 0 ? n : null;
      }
      return null;
    });

  // Must have at least 2 non-null values to be useful
  const nonNull = cleaned.filter((v): v is number => v !== null);
  if (nonNull.length < 2) return null;

  // Filter out implausible values (>100,000 kWh in a month is not residential)
  const validated = nonNull.filter(v => v <= 100000);
  if (validated.length < 2) return null;

  return validated;
}

function parseBillType(val: unknown): AiBillData['bill_type'] {
  if (val === 'electric' || val === 'gas' || val === 'combined') return val;
  return 'unknown';
}