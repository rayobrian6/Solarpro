export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { parseBillText, validateBillData, extractBillDataWithAI } from '@/lib/billOcr';
import type { BillExtractResult } from '@/lib/billOcr';
import { geocodeAddress } from '@/lib/locationEngine';
import { detectUtility } from '@/lib/utilityDetector';
import { getUserFromRequest } from '@/lib/auth';
import { handleRouteDbError } from '@/lib/db-neon';
import { extractPdfTextPure } from '@/lib/pdfExtract';
import { validateAndCorrectUtilityRate, checkNetMeteringLimit, getProductionFactor } from '@/lib/utility-rules';
import { matchUtility } from '@/lib/utilityMatcher';
// billOcrEngine and billParser are imported dynamically inside extractImageTextSmart()
// to prevent webpack from bundling tesseract.js worker_threads at module load time.
// Static import of tesseract.js causes HTML 500 errors before the route handler runs.

// Top-level reference so webpack marks pdf-parse as external (not bundled)
// eslint-disable-next-line @typescript-eslint/no-var-requires
let PDFParse: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pdfParseModule = require('pdf-parse');
  PDFParse = pdfParseModule.PDFParse ?? pdfParseModule.default?.PDFParse ?? null;
} catch (e) {
  console.warn('[bill-upload] pdf-parse not available:', e instanceof Error ? e.message : e);
}

// Vercel: allow up to 60s for OCR + geocoding
export const maxDuration = 60;

// POST /api/bill-upload
// Safety helper — guarantees JSON even if called outside the main try/catch
function safeJsonError(msg: string, status = 500): NextResponse {
  return NextResponse.json({ success: false, error: msg }, { status });
}

export async function POST(req: NextRequest) {
  // ── JSON Error Boundary ──────────────────────────────────────────────────────
  // Catches any uncaught throw (including module load errors, type errors, etc.)
  // and guarantees a JSON response is always returned — never an HTML error page.
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const rawText = formData.get('text') as string | null;

    if (!file && !rawText) {
      return NextResponse.json({ success: false, error: 'No file or text provided' }, { status: 400 });
    }

    let extractedText = rawText || '';
    let extractionMethod = 'text';

    if (file) {
      const MAX_SIZE = 10 * 1024 * 1024;
      if (file.size > MAX_SIZE) {
        return NextResponse.json({ success: false, error: 'File too large. Maximum size is 10MB.' }, { status: 413 });
      }

      const fileType = file.type;
      const fileName = file.name.toLowerCase();

      // ── TASK 2: FILE_RECEIVED log ─────────────────────────────────────────
      console.log(`[FILE_RECEIVED] name=${fileName} type=${fileType} size=${file.size} openai=${!!process.env.OPENAI_API_KEY}`);

      // Create buffer ONCE — used for ALL downstream operations (OCR, PDF parse, save)
      // Do NOT read file.arrayBuffer() again after this point.
      const buffer = Buffer.from(await file.arrayBuffer());

      // ── TASK 2: FILE_BUFFER_CREATED log ──────────────────────────────────
      console.log(`[FILE_BUFFER_CREATED] bytes=${buffer.length} mime=${fileType}`);
      console.log(`[FILE_UPLOADED] name=${fileName} type=${fileType} size=${buffer.length} openai=${!!process.env.OPENAI_API_KEY}`);

      if (fileType === 'application/pdf' || fileName.endsWith('.pdf')) {
        const result = await extractPdfText(buffer);
        extractedText = result.text;
        extractionMethod = result.method;
        console.log(`[bill-upload] PDF extraction result: method=${result.method}, chars=${result.text.length}`);
      } else if (
        fileType.startsWith('image/') ||
        fileName.endsWith('.jpg') || fileName.endsWith('.jpeg') ||
        fileName.endsWith('.png') || fileName.endsWith('.jfif') ||
        fileName.endsWith('.webp')
      ) {
        const safeMime = fileType.startsWith('image/') ? fileType : 'image/jpeg';
        console.log(`[OCR_STARTED] name=${fileName} type=${safeMime} size=${buffer.length}`);
        const ocrResult = await extractImageTextSmart(buffer, safeMime);
        extractedText = ocrResult.text;
        extractionMethod = ocrResult.method;

        // ── TASK 2: OCR_TEXT_LENGTH log ───────────────────────────────────
        console.log(`[OCR_TEXT_LENGTH] chars=${extractedText.length} method=${ocrResult.method} confidence=${ocrResult.confidence}`);

        if (extractedText.length > 50) {
          console.log(`[OCR_SUCCESS] method=${ocrResult.method} chars=${extractedText.length} confidence=${ocrResult.confidence}`);
        } else {
          console.warn(`[OCR_FAILED] method=${ocrResult.method} chars=${extractedText.length} confidence=${ocrResult.confidence}`);
        }
      } else {
        return NextResponse.json({ success: false, error: 'Unsupported file type. Please upload PDF, JPG, or PNG.' }, { status: 400 });
      }

      // ── TASK 2: FILE_SAVED log (buffer used, not re-read) ────────────────
      // Note: actual DB/storage save happens later using this same buffer.
      // We log here to confirm buffer was successfully created and OCR attempted.
      console.log(`[FILE_SAVED] buffer_intact=${buffer.length > 0} extracted_chars=${extractedText.length}`);
    }

    if (!extractedText.trim()) {
      const visionError = null;
      return NextResponse.json({
        success: false,
        error: 'Could not extract text from file. Please ensure the file is a clear, readable utility bill.',
        stage: extractionMethod,
        visionError,
        debug: {
          hasOpenAI: !!process.env.OPENAI_API_KEY,
          pdfParseLoaded: !!PDFParse,
          fileType: file?.type,
          fileSize: file?.size,
          visionError,
        },
      }, { status: 422 });
    }

    console.log(`[bill-upload] Extracted ${extractedText.length} chars via ${extractionMethod}`);

    // ── RAW OCR TEXT LOG ──────────────────────────────────────────────────────
    // Log the raw OCR text before any parsing — critical for debugging failures
    console.log('[bill-upload] === RAW OCR TEXT ===');
    const ocrLines = extractedText.split('\n');
    for (const line of ocrLines.slice(0, 60)) {
      if (line.trim()) console.log(`[ocr-raw] ${line}`);
    }
    if (ocrLines.length > 60) {
      console.log(`[ocr-raw] ... (${ocrLines.length - 60} more lines)`);
    }
    console.log('[bill-upload] === END RAW OCR TEXT ===');

    // ── Deterministic parsing ─────────────────────────────────────────────────
    // Stage A: parseBill() — authoritative deterministic source for all usage fields.
    //          Same input → same output always. No LLM rewrites of numeric fields.
    // Stage B: parseBillText() — extracts non-usage fields (address, account, charges).
    //          Only fills gaps; never overrides Stage A usage values.
    console.log('[bill-upload] Parsing bill text (deterministic)...');
    const { parseBill } = await import('@/lib/billParser');

    const parseResult = parseBill(extractedText);

    // Log the full debug trace for observability
    for (const line of parseResult.debugLog) {
      console.log(line);
    }

    // Stage B: extract non-usage fields only (address, account, billing period, charges)
    const legacyResult = parseBillText(extractedText);

    // ── Map BillParseResult → BillExtractResult ───────────────────────────────
    // Usage fields come EXCLUSIVELY from parseBill() (deterministic, source-ranked).
    // Non-usage fields come from parseBillText() only when parseBill() has no value.
    const monthlyArray = parseResult.monthlyArray;
    const monthsFound  = parseResult.monthsFound;
    const annualKwh    = parseResult.annual?.value ?? undefined;

    // Monthly kWh: use current month from parseBill, or best from monthly array
    const monthlyKwh: number | undefined =
      parseResult.currentMonthKwh ??
      (monthsFound > 0 ? Math.round(monthlyArray.reduce((s, v) => s + v, 0) / monthsFound) : undefined);

    // estimatedAnnualKwh: A1 explicit annual > A2 sum of monthly > A3 legacy
    const estimatedAnnualKwh: number | undefined =
      annualKwh ??
      (monthsFound >= 10 ? monthlyArray.reduce((s, v) => s + v, 0) : undefined) ??
      (monthsFound >= 3 ? Math.round((monthlyArray.reduce((s, v) => s + v, 0) / monthsFound) * 12) : undefined) ??
      legacyResult.estimatedAnnualKwh;

    // Rate: parseBill() returns null if not found — never guess
    const electricityRate: number | undefined =
      parseResult.rate?.value ?? legacyResult.electricityRate ?? undefined;

    // Utility: parseBill() header detection wins, then legacy
    const utilityProvider: string | undefined =
      parseResult.utility?.value ?? legacyResult.utilityProvider ?? undefined;

    // Build extractedFields list for downstream compatibility
    const extractedFields: string[] = [];
    if (utilityProvider)      extractedFields.push('utilityProvider');
    if (legacyResult.customerName) extractedFields.push('customerName');
    if (legacyResult.serviceAddress) extractedFields.push('serviceAddress');
    if (legacyResult.accountNumber) extractedFields.push('accountNumber');
    if (monthlyKwh !== undefined) extractedFields.push('monthlyKwh');
    if (annualKwh !== undefined) extractedFields.push('annualKwh');
    if (monthsFound > 0) extractedFields.push('monthlyUsageHistory');
    if (electricityRate !== undefined) extractedFields.push('electricityRate');
    if (legacyResult.totalAmount) extractedFields.push('totalAmount');
    if (legacyResult.billingPeriodStart) extractedFields.push('billingPeriod');

    // Confidence: based on months found and evidence quality
    const confidence: 'high' | 'medium' | 'low' =
      (monthsFound >= 10 || (annualKwh !== undefined && monthsFound >= 3)) ? 'high' :
      (monthsFound >= 3  || annualKwh !== undefined) ? 'medium' : 'low';

    const billData: BillExtractResult = {
      success: extractedFields.length > 0,
      customerName:       legacyResult.customerName,
      serviceAddress:     legacyResult.serviceAddress,
      utilityProvider,
      accountNumber:      legacyResult.accountNumber,
      billingPeriodStart: legacyResult.billingPeriodStart,
      billingPeriodEnd:   legacyResult.billingPeriodEnd,
      billingDays:        legacyResult.billingDays,
      monthlyKwh,
      annualKwh,
      monthlyUsageHistory: monthsFound > 0 ? monthlyArray.filter(v => v > 0) : legacyResult.monthlyUsageHistory,
      totalAmount:        legacyResult.totalAmount,
      electricityRate,
      fixedCharges:       legacyResult.fixedCharges,
      demandCharge:       legacyResult.demandCharge,
      demandKw:           legacyResult.demandKw,
      tier1Kwh:           legacyResult.tier1Kwh,
      tier2Kwh:           legacyResult.tier2Kwh,
      tier1Rate:          legacyResult.tier1Rate,
      tier2Rate:          legacyResult.tier2Rate,
      billType:           legacyResult.billType,
      gasUsageTherm:      legacyResult.gasUsageTherm,
      estimatedAnnualKwh,
      estimatedMonthlyBill: legacyResult.estimatedMonthlyBill,
      confidence,
      extractedFields,
      usedLlmFallback: false,
      rawText: extractedText,
    };

    // ── TASK 2: PARSED_FIELDS_COUNT log ──────────────────────────────────────
    console.log(`[PARSED_FIELDS_COUNT] count=${extractedFields.length} fields=${extractedFields.join(',') || 'none'} monthlyKwh=${monthlyKwh ?? 'null'} annualKwh=${annualKwh ?? 'null'} confidence=${confidence}`);
    console.log('[bill-upload] Bill parsed (deterministic). Fields:', extractedFields.join(', ') || 'none');
    console.log('[bill-upload] Confidence:', confidence, '| monthlyKwh:', monthlyKwh, '| annualKwh:', annualKwh, '| monthsFound:', monthsFound, '| address:', legacyResult.serviceAddress);

    // ── AI Extraction Fallback ────────────────────────────────────────────────
    // If zero fields extracted (OCR text exists but regex found nothing),
    // use structured AI extraction to fill in what's available.
    // This never overrides deterministic usage values — only fills structural gaps.
    let finalBillData = billData;
    if (extractedFields.length === 0 && extractedText.trim().length > 50) {
      console.log('[AI_EXTRACTION_STARTED] reason=zero_fields_extracted');
      finalBillData = await extractBillDataWithAI(extractedText, billData);
      console.log(`[AI_EXTRACTION_COMPLETE] fields=${finalBillData.extractedFields?.join(',') || 'none'} confidence=${finalBillData.confidence}`);
    } else if (extractedFields.length < 2 && extractedText.trim().length > 100) {
      // Also try AI if very few fields found — may have OCR issues
      console.log(`[AI_EXTRACTION_STARTED] reason=low_field_count fields=${extractedFields.length}`);
      finalBillData = await extractBillDataWithAI(extractedText, billData);
      console.log(`[AI_EXTRACTION_COMPLETE] fields=${finalBillData.extractedFields?.join(',') || 'none'} confidence=${finalBillData.confidence}`);
    }

    // ── TASK 2: AI_EXTRACTION_RESULT log ────────────────────────────────────
    const aiFieldCount = finalBillData.extractedFields?.length ?? 0;
    console.log(`[AI_EXTRACTION_RESULT] totalFields=${aiFieldCount} usedAI=${finalBillData.usedLlmFallback} monthlyKwh=${finalBillData.monthlyKwh ?? 'null'} annualKwh=${finalBillData.estimatedAnnualKwh ?? 'null'} utility="${finalBillData.utilityProvider ?? 'none'}" address="${finalBillData.serviceAddress ?? 'none'}"`);

    // ── TASK 3: HARD FAIL on completely empty parse payload ──────────────────
    // If BOTH deterministic parsing AND AI extraction returned nothing usable,
    // do NOT silently proceed with 0 kWh defaults → 0.0 kW system.
    // Return a clear error so the user can re-upload or enter manually.
    //
    // Empty is defined as: no kWh data (monthly or annual) AND no utility AND
    // no address — i.e. the parser found absolutely nothing meaningful.
    const hasAnyKwh = (finalBillData.monthlyKwh ?? 0) > 0
      || (finalBillData.estimatedAnnualKwh ?? 0) > 0
      || (finalBillData.annualKwh ?? 0) > 0
      || (finalBillData.monthlyUsageHistory?.length ?? 0) > 0;
    const hasLocation = !!(finalBillData.serviceAddress || finalBillData.utilityProvider);
    const totalFinalFields = finalBillData.extractedFields?.length ?? 0;

    if (totalFinalFields === 0 && !hasAnyKwh && !hasLocation && file) {
      // Complete parse failure — cannot silently proceed
      console.warn(`[PARSE_EMPTY_FAIL] name=${file.name} extractedChars=${extractedText.length} method=${extractionMethod} — returning 422`);
      return NextResponse.json({
        success: false,
        error: 'Bill text could not be extracted. Please re-upload a clearer image or enter manually.',
        stage: extractionMethod,
        parseEmpty: true,
        debug: {
          hasOpenAI: !!process.env.OPENAI_API_KEY,
          extractedChars: extractedText.length,
          method: extractionMethod,
          fieldsFound: totalFinalFields,
        },
      }, { status: 422 });
    }

    // Extraction evidence — returned to UI for transparency
    const extractionEvidence = {
      monthlySource:       parseResult.monthlySource,
      monthlyConfidence:   parseResult.monthlyConfidence,
      monthsFound,
      monthlyEvidence:     parseResult.monthlyEvidence,
      annualSource:        parseResult.annual?.source_type ?? 'none',
      annualSourceText:    parseResult.annual?.source_text ?? null,
      utilitySource:       parseResult.utility?.source_type ?? 'none',
      rateSource:          parseResult.rate?.source_type ?? 'none',
      debugLog:            parseResult.debugLog,
    };

    // Validation is deferred — run AFTER geocoding + utility matching + rate correction
    // so warnings accurately reflect the final resolved values (not the pre-match state).
    let locationData = null;
    let utilityData = null;
    let matchedUtility = null;

    if (finalBillData.serviceAddress) {
      console.log('[bill-upload] Geocoding address:', finalBillData.serviceAddress);
      try {
        const geoResult = await geocodeAddress(finalBillData.serviceAddress);
        if (geoResult.success && geoResult.location) {
          locationData = geoResult.location;
          console.log('[bill-upload] Geocoded:', locationData.city, locationData.stateCode);

          // P1/P2/P3: Match parsed utility name against DB + state fallback
          const parsedUtilityName = finalBillData.utilityProvider || null;
          console.log(`[bill-upload] Matching utility name: "${parsedUtilityName}" for state: ${locationData.stateCode}`);
          try {
            matchedUtility = await matchUtility(parsedUtilityName, locationData.stateCode);
            if (matchedUtility) {
              // effectiveRate = retailRate (v47.11 new column) ?? defaultResidentialRate (legacy)
              // retailRate is the accurate all-in rate; legacy was often supply-only or stale
              const dbRate = matchedUtility.effectiveRate ?? matchedUtility.defaultResidentialRate;
              console.log(`[bill-upload] Utility matched: "${matchedUtility.utilityName}" via ${matchedUtility.source}, retailRate: ${matchedUtility.retailRate}, legacyRate: ${matchedUtility.defaultResidentialRate}, effectiveRate: ${dbRate}`);
              if (!finalBillData.utilityProvider) {
                finalBillData.utilityProvider = matchedUtility.utilityName;
              }
              if (!finalBillData.electricityRate && dbRate) {
                finalBillData.electricityRate = dbRate;
                console.log(`[bill-upload] Using DB retail rate: $${dbRate}/kWh from matched utility (source: ${matchedUtility.source})`);
              }
            } else {
              console.warn('[bill-upload] No utility match found in DB or state fallback');
            }
          } catch (matchErr: unknown) {
            console.warn('[bill-upload] Utility matching failed:', matchErr instanceof Error ? matchErr.message : matchErr);
          }

          // Geo-based utility detection (fallback if no name match)
          const utilityResult = await detectUtility(
            geoResult.location.lat,
            geoResult.location.lng,
            geoResult.location.stateCode,
            geoResult.location.city,
          );
          if (utilityResult.success) {
            utilityData = utilityResult.utility;
            if (!finalBillData.utilityProvider && utilityData?.utilityName) {
              finalBillData.utilityProvider = utilityData.utilityName;
            }
            if (!finalBillData.electricityRate && utilityData?.avgRatePerKwh) {
              finalBillData.electricityRate = utilityData.avgRatePerKwh;
            }
          }
        } else {
          console.warn('[bill-upload] Geocoding failed:', geoResult.error);
        }
      } catch (geoErr: unknown) {
        console.warn('[bill-upload] Geocoding threw:', geoErr instanceof Error ? geoErr.message : geoErr);
      }
    } else {
      console.warn('[bill-upload] No service address found in bill data');
    }

    // ── Rate Validation ───────────────────────────────────────────────────────
    // Correct rates outside valid retail range ($0.10-$0.60/kWh).
    // Below $0.10 = suspect — likely supply-only/generation component from bill (not retail).
    //   e.g. CMP supply charge ~$0.069 vs all-in retail ~$0.265. Falls back to DB rate.
    // Above $0.60 = likely a misparse (total bill amount vs per-kWh rate).
    // FIX v47.13 T1d/T1e: Added structured logging + raised floor to $0.10
    const utilityNameForRate = finalBillData.utilityProvider || utilityData?.utilityName || null;
    const preValidationRate = finalBillData.electricityRate ?? null;
    const rateValidation = validateAndCorrectUtilityRate(preValidationRate, utilityNameForRate);
    if (rateValidation.corrected) {
      console.log(`[UTILITY_RATE_SELECTED] source=${rateValidation.source} rate=$${rateValidation.rate.toFixed(3)}/kWh originalRate=$${rateValidation.originalRate?.toFixed(3) ?? 'null'} suspect=${rateValidation.suspect} utility="${utilityNameForRate}"`);
      finalBillData.electricityRate = rateValidation.rate;
    } else {
      console.log(`[UTILITY_RATE_SELECTED] source=extracted rate=$${rateValidation.rate.toFixed(3)}/kWh suspect=false utility="${utilityNameForRate}"`);
    }
    console.log(`[UTILITY_RATE_SOURCE] extracted=$${preValidationRate?.toFixed(3) ?? 'null'} final=$${finalBillData.electricityRate?.toFixed(3) ?? 'null'} corrected=${rateValidation.corrected} source=${rateValidation.source}`);

    // Structured parse complete log
    console.log(`[BILL_PARSE_COMPLETE] utility="${finalBillData.utilityProvider ?? 'unknown'}" monthlyKwh=${finalBillData.monthlyKwh ?? 'null'} annualKwh=${finalBillData.estimatedAnnualKwh ?? 'null'} rate=$${finalBillData.electricityRate?.toFixed(3) ?? 'null'} confidence=${finalBillData.confidence} fields=${finalBillData.extractedFields?.join(',') ?? 'none'}`);

    // ── Deferred Validation ───────────────────────────────────────────────────
    // Run AFTER geocoding + utility matching + rate correction so warnings reflect
    // final resolved values. Context suppresses stale warnings when values were resolved.
    const resolvedMatchedUtility = matchedUtility?.utilityName ?? utilityData?.utilityName ?? null;
    const validation = validateBillData(finalBillData, {
      matchedUtilityName: resolvedMatchedUtility,
      finalRate: finalBillData.electricityRate ?? null,
    });
    console.log('[bill-upload] Validation:', validation.valid, validation.errors?.join(', ') || 'ok');
    if (validation.warnings.length > 0) {
      console.log('[bill-upload] Validation warnings:', validation.warnings.join(' | '));
    }

    // ── TASK 4: System Size Gate — ONLY run if usable kWh data present ────────
    // Do NOT size with 0 kWh defaults — that produces fake 0.0 kW results.
    // Minimum requirement: estimatedAnnualKwh > 0 OR monthlyKwh > 0.
    console.log('[bill-upload] Calculating system size...');
    const annualKwhForSizing = finalBillData.estimatedAnnualKwh || 0;
    const monthlyKwhForSizing = finalBillData.monthlyKwh || 0;

    // Use utility-aware production factor for accurate sizing
    const productionFactor = getProductionFactor(utilityNameForRate, locationData?.stateCode ?? null);

    let systemSizeKw: number | null = null;

    if (annualKwhForSizing > 0) {
      // Primary: use annual kWh
      systemSizeKw = Math.round((annualKwhForSizing / productionFactor) * 10) / 10;
      // ── TASK 2: SIZING_INPUTS_READY log ─────────────────────────────────
      console.log(`[SIZING_INPUTS_READY] annualKwh=${annualKwhForSizing} productionFactor=${productionFactor} systemSizeKw=${systemSizeKw}`);
    } else if (monthlyKwhForSizing > 0) {
      // Fallback: extrapolate from monthly
      const annualFromMonthly = monthlyKwhForSizing * 12;
      systemSizeKw = Math.round((annualFromMonthly / productionFactor) * 10) / 10;
      console.log(`[SIZING_INPUTS_READY] monthlyKwh=${monthlyKwhForSizing} extrapolatedAnnual=${annualFromMonthly} productionFactor=${productionFactor} systemSizeKw=${systemSizeKw}`);
    } else {
      // ── TASK 2: SIZING_SKIPPED_EMPTY_PARSE log ──────────────────────────
      console.warn(`[SIZING_SKIPPED_EMPTY_PARSE] annualKwh=0 monthlyKwh=0 — no kWh data to size system`);
      systemSizeKw = null;
    }

    console.log(`[bill-upload] System size: ${systemSizeKw} kW for ${annualKwhForSizing} kWh/yr (factor: ${productionFactor})`);

    // ── Net Metering Guardrail ────────────────────────────────────────────────
    const netMeteringWarning = systemSizeKw
      ? checkNetMeteringLimit(systemSizeKw, utilityNameForRate)
      : null;
    if (netMeteringWarning) {
      console.warn(`[bill-upload] Net metering warning: ${netMeteringWarning}`);
      if (!validation.warnings) (validation as any).warnings = [];
      (validation as any).warnings.push(netMeteringWarning);
    }

    // ── Bill Persistence (when projectId provided in form data) ───────────────
    const projectId = formData.get('projectId') as string | null;
    const userId = user.id as string;
    let savedBillId: string | null = null;

    if (projectId) {
      try {
        const { saveBill: saveBillFn } = await import('@/lib/db-neon');
        const savedBill = await saveBillFn({
          projectId,
          userId,
          utilityName: finalBillData.utilityProvider || null,
          monthlyKwh: finalBillData.monthlyKwh || null,
          annualKwh: finalBillData.estimatedAnnualKwh || annualKwhForSizing || null,
          electricRate: rateValidation.rate || null,
          parsedJson: {
            billData: finalBillData,
            locationData,
            utilityData,
            matchedUtility,
            systemSizing: systemSizeKw
              ? { recommendedKw: systemSizeKw, annualKwh: annualKwhForSizing, offsetPercent: 100, productionFactor }
              : null,
          } as Record<string, unknown>,
        });
        savedBillId = savedBill?.id ?? null;
        console.log(`[bill-upload] Bill saved to DB: ${savedBillId}`);
      } catch (billErr: unknown) {
        console.warn('[bill-upload] Bill persistence failed:', billErr instanceof Error ? billErr.message : billErr);
      }
    }

    console.log('[bill-upload] Returning success response');
    return NextResponse.json({
      success: true,
      billData: finalBillData,
      extractionEvidence,
      validation,
      locationData,
      utilityData,
      matchedUtility: matchedUtility ? {
        id: matchedUtility.id,
        utilityName: matchedUtility.utilityName,
        state: matchedUtility.state,
        defaultResidentialRate: matchedUtility.defaultResidentialRate,
        retailRate: matchedUtility.retailRate,
        effectiveRate: matchedUtility.effectiveRate,
        netMetering: matchedUtility.netMetering,
        source: matchedUtility.source,
      } : null,
      extractionMethod,
      savedBillId,
      rateValidation: {
        corrected: rateValidation.corrected,
        suspect: rateValidation.suspect,
        originalRate: rateValidation.originalRate,
        correctedRate: rateValidation.rate,
        source: rateValidation.source,
        message: rateValidation.corrected
          ? `Rate ${rateValidation.suspect ? 'suspect (supply-only component)' : 'out of range'}: $${rateValidation.originalRate?.toFixed(3) ?? 'null'}/kWh → $${rateValidation.rate.toFixed(3)}/kWh (${rateValidation.source})`
          : null,
      },
      systemSizing: systemSizeKw ? {
        recommendedKw: systemSizeKw,
        annualKwh: annualKwhForSizing,
        offsetPercent: 100,
        note: `Based on 100% offset. Production factor: ${productionFactor} kWh/kW/yr.`,
      } : null,
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    const stack = err instanceof Error ? err.stack?.split('\n').slice(0, 5).join(' | ') : '';
    console.error('[BILL_UPLOAD_ERROR] Fatal error:', msg);
    console.error('[BILL_UPLOAD_ERROR] Stack:', stack);

    // Map common failure modes to friendly messages
    let friendlyMsg = 'Bill processing failed. Please try again.';
    if (msg.includes('extract') || msg.includes('OCR') || msg.includes('text')) {
      friendlyMsg = 'Bill processing failed — could not extract readable text from the file.';
    } else if (msg.includes('timeout') || msg.includes('ETIMEDOUT')) {
      friendlyMsg = 'Bill processing timed out. Please try a smaller file or try again.';
    } else if (msg.includes('Unauthorized') || msg.includes('401')) {
      friendlyMsg = 'Session expired. Please log in again.';
    } else if (msg.includes('size') || msg.includes('large')) {
      friendlyMsg = 'File is too large. Please upload a file under 10MB.';
    }

    return NextResponse.json({ 
      success: false, 
      error: friendlyMsg,
      detail: msg,
    }, { status: 500 });
  }
}

// ── PDF extraction ─────────────────────────────────────────────────────────────
async function extractPdfText(buffer: Buffer): Promise<{ text: string; method: string }> {
  const openaiKey = process.env.OPENAI_API_KEY;

  // ── Helper: does text look like real bill content? ────────────────────────
  // The pure-stream extractor sometimes returns chart labels ("J F M A M") or
  // font-metadata fragments.  A real bill has digits, $ signs, or kWh mentions.
  function isUsefulText(t: string): boolean {
    if (t.length < 100) return false;
    const hasMoney    = /\$\s*\d/.test(t);
    const hasKwh      = /\d\s*kwh/i.test(t);
    const hasDigits   = (/\d{3,}/.exec(t) || []).length > 0;
    const hasAddress  = /street|ave|road|blvd|drive|lane|pl\b|st\b/i.test(t);
    const hasAccount  = /account|service|billing|meter|customer/i.test(t);
    const score = [hasMoney, hasKwh, hasDigits, hasAddress, hasAccount].filter(Boolean).length;
    return score >= 2;   // need at least 2 bill-like signals
  }

  // ── Method 1: pdftotext CLI (poppler) ────────────────────────────────────
  // Best quality, available on Vercel serverless and most Linux environments.
  // Handles layout-preserving extraction, which our regex parser relies on.
  console.log('[PDF_PARSE_STARTED] method=pdftotext');
  try {
    const text = await extractPdfTextCli(buffer);
    if (isUsefulText(text)) {
      console.log(`[PDF_PARSE_SUCCESS] method=pdftotext chars=${text.length}`);
      return { text, method: 'pdftotext' };
    }
    console.warn(`[bill-upload] pdftotext returned low-quality text (${text.length} chars) — trying next method`);
  } catch (err: unknown) {
    console.warn('[PDF_PARSE_FAILED] method=pdftotext error:', err instanceof Error ? err.message : err);
  }

  // ── Method 2: pdf-parse (npm library) ────────────────────────────────────
  // Reliable Node.js PDF parser.  The module exports { PDFParse: fn } in v2.x.
  console.log('[PDF_PARSE_STARTED] method=pdf-parse');
  try {
    // pdf-parse v2.x: module object has .PDFParse function  
    const ppMod = require('pdf-parse') as any;
    const ppFn: ((buf: Buffer) => Promise<{ text: string; numpages: number }>) | null =
      typeof ppMod === 'function' ? ppMod :
      typeof ppMod?.PDFParse === 'function' ? ppMod.PDFParse :
      typeof ppMod?.default === 'function' ? ppMod.default :
      null;
    if (!ppFn) throw new Error('pdf-parse: no callable export found');
    const result = await ppFn(buffer);
    const text = (result.text || '').trim();
    if (isUsefulText(text)) {
      console.log(`[PDF_PARSE_SUCCESS] method=pdf-parse chars=${text.length} pages=${result.numpages}`);
      return { text, method: 'pdf-parse' };
    }
    console.warn(`[bill-upload] pdf-parse returned low-quality text (${text.length} chars)`);
  } catch (err: unknown) {
    console.warn('[PDF_PARSE_FAILED] method=pdf-parse error:', err instanceof Error ? err.message : err);
  }

  // ── Method 3: Pure Node.js stream extractor ───────────────────────────────
  // Zero external deps.  Works when pdftotext and pdf-parse are unavailable.
  // May return chart labels on some PDFs — gated by isUsefulText().
  console.log('[PDF_PARSE_STARTED] method=pure-extract');
  try {
    const text = extractPdfTextPure(buffer);
    if (isUsefulText(text)) {
      console.log(`[PDF_PARSE_SUCCESS] method=pure-extract chars=${text.length}`);
      return { text, method: 'pure-extract' };
    }
    console.warn(`[bill-upload] Pure extractor returned low-quality text (${text.length} chars)`);
  } catch (err: unknown) {
    console.warn('[PDF_PARSE_FAILED] method=pure-extract error:', err instanceof Error ? err.message : err);
  }

  // ── Method 4: pdfjs-dist (may fail on Vercel due to missing canvas) ───────
  console.log('[PDF_PARSE_STARTED] method=pdfjs-dist');
  try {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs' as any);
    const getDocument = pdfjsLib.getDocument ?? pdfjsLib.default?.getDocument;
    if (!getDocument) throw new Error('getDocument not found in pdfjs-dist');
    const uint8 = new Uint8Array(buffer);
    const doc = await getDocument({
      data: uint8,
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true,
      disableFontFace: true,
    }).promise;
    let text = '';
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((item: any) => ('str' in item ? item.str : '')).join(' ') + '\n';
    }
    text = text.trim();
    if (isUsefulText(text)) {
      console.log(`[PDF_PARSE_SUCCESS] method=pdfjs-dist chars=${text.length}`);
      return { text, method: 'pdfjs-dist' };
    }
    console.warn(`[bill-upload] pdfjs-dist returned low-quality text (${text.length} chars)`);
  } catch (err: unknown) {
    console.warn('[PDF_PARSE_FAILED] method=pdfjs-dist error:', err instanceof Error ? err.message : err);
  }

  // ── Method 5: OpenAI Files API + Responses API ────────────────────────────
  // Only used when all local extraction fails (has API cost).
  if (openaiKey) {
    console.log('[PDF_PARSE_STARTED] method=openai-files-api');
    try {
      const fd = new FormData();
      fd.append('file', new Blob([new Uint8Array(buffer)], { type: 'application/pdf' }), 'bill.pdf');
      fd.append('purpose', 'user_data');

      const uploadRes = await fetch('https://api.openai.com/v1/files', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${openaiKey}` },
        body: fd,
        signal: AbortSignal.timeout(20000),
      });

      if (uploadRes.ok) {
        const uploadData = await uploadRes.json();
        const fileId = uploadData.id;
        console.log('[bill-upload] OpenAI file uploaded:', fileId);

        const respRes = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
          body: JSON.stringify({
            model: 'gpt-4o',
            input: [{
              role: 'user',
              content: [
                { type: 'input_file', file_id: fileId },
                { type: 'input_text', text: 'Extract ALL text from this utility bill PDF. Output only the raw extracted text, preserving all numbers, addresses, and kWh values.' },
              ],
            }],
          }),
          signal: AbortSignal.timeout(30000),
        });

        fetch(`https://api.openai.com/v1/files/${fileId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${openaiKey}` },
        }).catch(() => {});

        if (respRes.ok) {
          const respData = await respRes.json();
          const text = respData?.output?.[0]?.content?.[0]?.text?.trim()
            ?? respData?.output?.[0]?.content?.trim();
          if (text && text.length > 50) {
            console.log(`[PDF_PARSE_SUCCESS] method=openai-files-api chars=${text.length}`);
            return { text, method: 'openai-responses' };
          }
          console.warn('[bill-upload] OpenAI Responses API empty. Keys:', Object.keys(respData).join(', '));
        } else {
          const errText = await respRes.text();
          console.warn('[bill-upload] OpenAI Responses API failed:', respRes.status, errText.slice(0, 300));
        }
      } else {
        const errText = await uploadRes.text();
        console.warn('[bill-upload] OpenAI upload failed:', uploadRes.status, errText.slice(0, 200));
      }
    } catch (err: unknown) {
      console.warn('[PDF_PARSE_FAILED] method=openai-files-api error:', err instanceof Error ? err.message : err);
    }
  } else {
    console.warn('[bill-upload] No OPENAI_API_KEY — skipping OpenAI extraction');
  }

  // ── Method 6: Google Vision ────────────────────────────────────────────────
  const googleKey = process.env.GOOGLE_MAPS_API_KEY;
  if (googleKey) {
    console.log('[PDF_PARSE_STARTED] method=google-vision');
    try {
      const base64 = buffer.toString('base64');
      const res = await fetch(
        `https://vision.googleapis.com/v1/images:annotate?key=${googleKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requests: [{ image: { content: base64 }, features: [{ type: 'DOCUMENT_TEXT_DETECTION' }] }] }),
          signal: AbortSignal.timeout(20000),
        }
      );
      if (res.ok) {
        const data = await res.json();
        const text = data?.responses?.[0]?.fullTextAnnotation?.text;
        if (text?.trim().length > 50) {
          console.log(`[PDF_PARSE_SUCCESS] method=google-vision chars=${text.length}`);
          return { text, method: 'google-vision' };
        }
      }
    } catch (err: unknown) {
      console.warn('[PDF_PARSE_FAILED] method=google-vision error:', err instanceof Error ? err.message : err);
    }
  }

  // ── All methods failed ─────────────────────────────────────────────────────
  console.error('[PDF_PARSE_FAILED] All PDF extraction methods exhausted — no usable text');
  return { text: '', method: 'failed' };
}

// ── PDF CLI fallback ───────────────────────────────────────────────────────────
async function extractPdfTextCli(buffer: Buffer): Promise<string> {
  const { execSync } = await import('child_process');
  const { writeFileSync, readFileSync, unlinkSync } = await import('fs');
  const { tmpdir } = await import('os');
  const { join } = await import('path');
  const tmpIn = join(tmpdir(), `bill_${Date.now()}.pdf`);
  const tmpOut = join(tmpdir(), `bill_${Date.now()}.txt`);
  writeFileSync(tmpIn, buffer);
  execSync(`pdftotext -layout "${tmpIn}" "${tmpOut}"`, { timeout: 15000 });
  const text = readFileSync(tmpOut, 'utf-8');
  try { unlinkSync(tmpIn); } catch {}
  try { unlinkSync(tmpOut); } catch {}
  return text;
}

// ── Smart 3-stage image extraction ────────────────────────────────────────────
// Stage 1: Tesseract CLI (free, no API cost) — primary OCR
// Stage 2: Check if monthly usage was detected from Tesseract output
// Stage 3: OpenAI Vision / Google Vision fallback ONLY if:
//          - Tesseract confidence < 60, OR
//          - No monthly usage detected from Tesseract text
//
// Uses dynamic imports to prevent webpack from bundling tesseract.js
// worker_threads at module load time (causes HTML 500 before handler runs).
// ── Inline Tesseract CLI runner ────────────────────────────────────────────────
// Called as Stage 1b fallback when the /api/ocr HTTP call returns empty or 401.
// Runs tesseract directly in this process — no network hop needed.
// Returns empty string if CLI is not installed (Vercel does not have it; local dev does).
async function runTesseractCliInline(buffer: Buffer, mimeType: string): Promise<string> {
  try {
    const { execFile } = await import('child_process');
    const { writeFile, readFile, unlink } = await import('fs/promises');
    const { join } = await import('path');
    const { tmpdir } = await import('os');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);

    // Quick availability check
    await execFileAsync('tesseract', ['--version'], { timeout: 3000 }).catch(() => {
      throw new Error('tesseract CLI not available');
    });

    const id = `ocr_inline_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const ext = mimeType.includes('png') ? 'png' : 'jpg';
    const tmpImg  = join(tmpdir(), `${id}.${ext}`);
    const tmpBase = join(tmpdir(), id);

    await writeFile(tmpImg, buffer);
    try {
      await execFileAsync(
        'tesseract',
        [tmpImg, tmpBase, '-l', 'eng', '--psm', '3', '--oem', '3'],
        { timeout: 30000 },
      );
      const raw = await readFile(`${tmpBase}.txt`, 'utf-8');
      return raw.trim();
    } finally {
      for (const f of [tmpImg, `${tmpBase}.txt`]) {
        try { await unlink(f); } catch { /* ignore */ }
      }
    }
  } catch {
    return '';
  }
}

async function extractImageTextSmart(
  buffer: Buffer,
  mimeType: string,
): Promise<{ text: string; method: string; confidence: number }> {
  const openaiKey = process.env.OPENAI_API_KEY;
  const googleKey = process.env.GOOGLE_MAPS_API_KEY;

  // Dynamic imports — prevents webpack from statically bundling these modules
  const { recognizeImage, recognizeImageWithVision, recognizeImageWithGoogle } =
    await import('@/lib/billOcrEngine');
  const { parseMonthlyUsage } = await import('@/lib/billParser');

  // ── Stage 1: Tesseract OCR via /api/ocr (free, no key needed) ─────────────
  // recognizeImage() does an internal HTTP fetch to /api/ocr.
  // /api/ocr is in PUBLIC_PATHS so no auth cookie is needed.
  // If the fetch fails (401, network error, timeout), rawText is '' and we fall through.
  console.log('[bill-upload] Stage 1: Tesseract OCR via /api/ocr...');
  const tesseractResult = await recognizeImage(buffer, mimeType);

  if (tesseractResult.rawText.length > 50) {
    // ── Stage 2: Check if we got usable monthly data ───────────────────────
    const parseCheck = parseMonthlyUsage(tesseractResult.rawText);
    const hasUsage = parseCheck.monthsFound >= 3 || parseCheck.annualUsage !== null;

    console.log(`[bill-upload] Tesseract: confidence=${tesseractResult.confidence}, chars=${tesseractResult.rawText.length}, monthsFound=${parseCheck.monthsFound}, annualLine=${parseCheck.annualUsage}, hasUsage=${hasUsage}`);

    // Good OCR with usage data — use it directly, no AI needed
    if (tesseractResult.confidence >= 60 && hasUsage) {
      console.log('[bill-upload] Tesseract sufficient — skipping Vision API (cost $0)');
      return {
        text: tesseractResult.rawText,
        method: 'tesseract',
        confidence: tesseractResult.confidence,
      };
    }

    // Decent OCR but no usage found — try Vision as supplement
    if (tesseractResult.confidence >= 60 && !hasUsage) {
      console.log('[bill-upload] Tesseract high confidence but no usage detected — trying Vision fallback');
    } else {
      console.log(`[bill-upload] Tesseract confidence low (${tesseractResult.confidence}) — trying Vision fallback`);
    }
  } else {
    // Stage 1 returned little/no text — may be a 401 or network failure.
    // Try inline Tesseract CLI directly (bypasses HTTP entirely) as Stage 1b.
    if (tesseractResult.rawText.length === 0 && tesseractResult.error?.includes('401')) {
      console.warn('[bill-upload] Stage 1 got 401 from /api/ocr — trying inline Tesseract CLI fallback');
    } else {
      console.log(`[bill-upload] Tesseract returned too little text (${tesseractResult.rawText.length} chars) — trying inline CLI fallback`);
    }

    // ── Stage 1b: Inline Tesseract CLI (bypasses HTTP, no auth needed) ──────
    try {
      const inlineText = await runTesseractCliInline(buffer, mimeType);
      if (inlineText.length > 50) {
        console.log(`[bill-upload] Stage 1b inline CLI: ${inlineText.length} chars — using result`);
        const parseCheck1b = parseMonthlyUsage(inlineText);
        const hasUsage1b = parseCheck1b.monthsFound >= 3 || parseCheck1b.annualUsage !== null;
        if (hasUsage1b) {
          return { text: inlineText, method: 'tesseract-cli-inline', confidence: 75 };
        }
        // Has text but no clear usage — keep as candidate, continue to Vision
        tesseractResult.rawText = inlineText;
        (tesseractResult as any).confidence = 60;
      } else {
        console.log(`[bill-upload] Stage 1b inline CLI: only ${inlineText.length} chars — continuing to Vision`);
      }
    } catch (cliErr) {
      console.warn('[bill-upload] Stage 1b inline CLI failed:', cliErr instanceof Error ? cliErr.message : String(cliErr));
    }
  }

  // ── Stage 3: Vision API fallback ──────────────────────────────────────────
  // Only reached if Tesseract confidence < 60 OR no monthly usage detected

  if (openaiKey) {
    console.log('[bill-upload] Stage 3a: OpenAI Vision fallback...');
    const visionResult = await recognizeImageWithVision(buffer, mimeType, openaiKey);
    if (visionResult.rawText.length > 50) {
      const visionParse = parseMonthlyUsage(visionResult.rawText);
      const tesseractParse = tesseractResult.rawText.length > 50
        ? parseMonthlyUsage(tesseractResult.rawText)
        : null;

      if (
        visionParse.monthsFound >= (tesseractParse?.monthsFound ?? 0) ||
        (visionParse.annualUsage !== null && tesseractParse?.annualUsage === null)
      ) {
        console.log(`[bill-upload] Using OpenAI Vision text (${visionParse.monthsFound} months vs Tesseract ${tesseractParse?.monthsFound ?? 0})`);
        return {
          text: visionResult.rawText,
          method: 'openai-vision-fallback',
          confidence: visionResult.confidence,
        };
      } else {
        console.log(`[bill-upload] Keeping Tesseract text (${tesseractParse?.monthsFound ?? 0} months vs Vision ${visionParse.monthsFound})`);
        return {
          text: tesseractResult.rawText,
          method: 'tesseract-kept',
          confidence: tesseractResult.confidence,
        };
      }
    }
  }

  if (googleKey) {
    console.log('[bill-upload] Stage 3b: Google Vision fallback...');
    const googleResult = await recognizeImageWithGoogle(buffer, googleKey);
    if (googleResult.rawText.length > 50) {
      return {
        text: googleResult.rawText,
        method: 'google-vision-fallback',
        confidence: googleResult.confidence,
      };
    }
  }

  // All stages failed — return best we have
  if (tesseractResult.rawText.length > 20) {
    console.log('[bill-upload] All vision fallbacks failed — using low-confidence Tesseract result');
    return {
      text: tesseractResult.rawText,
      method: 'tesseract-low-confidence',
      confidence: tesseractResult.confidence,
    };
  }

  console.error('[bill-upload] All OCR stages failed — no text extracted');
  return { text: '', method: 'failed', confidence: 0 };
}

// ── System size ───────────────────────────────────────────────────────────────
function calculateRecommendedSystemSize(annualKwh: number, lat: number): number {
  const sunHours = lat < 25 ? 5.5 : lat < 30 ? 5.2 : lat < 35 ? 4.8 : lat < 40 ? 4.4 : lat < 45 ? 4.0 : 3.6;
  const kwhPerKwPerYear = sunHours * 365 * 0.80;
  return Math.round((annualKwh / kwhPerKwPerYear) * 10) / 10;
}