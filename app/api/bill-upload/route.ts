import { NextRequest, NextResponse } from 'next/server';
import { parseBillText, validateBillData } from '@/lib/billOcr';
import type { BillExtractResult } from '@/lib/billOcr';
import { geocodeAddress } from '@/lib/locationEngine';
import { detectUtility } from '@/lib/utilityDetector';
import { getUserFromRequest } from '@/lib/auth';
import { extractPdfTextPure } from '@/lib/pdfExtract';
import { validateAndCorrectUtilityRate, checkNetMeteringLimit, getProductionFactor } from '@/lib/utility-rules';
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
export async function POST(req: NextRequest) {
  // ── JSON Error Boundary ──────────────────────────────────────────────────
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
      const buffer = Buffer.from(await file.arrayBuffer());

      console.log(`[bill-upload] File: ${fileName}, type: ${fileType}, size: ${buffer.length}`);
      console.log(`[bill-upload] OpenAI key present: ${!!process.env.OPENAI_API_KEY}`);
      console.log(`[bill-upload] PDFParse loaded: ${!!PDFParse}`);

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
        const ocrResult = await extractImageTextSmart(buffer, safeMime);
        extractedText = ocrResult.text;
        extractionMethod = ocrResult.method;
        console.log(`[bill-upload] Image extraction result: method=${ocrResult.method}, chars=${extractedText.length}, confidence=${ocrResult.confidence}`);
      } else {
        return NextResponse.json({ success: false, error: 'Unsupported file type. Please upload PDF, JPG, or PNG.' }, { status: 400 });
      }
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

    console.log('[bill-upload] Bill parsed (deterministic). Fields:', extractedFields.join(', ') || 'none');
    console.log('[bill-upload] Confidence:', confidence, '| monthlyKwh:', monthlyKwh, '| annualKwh:', annualKwh, '| monthsFound:', monthsFound, '| address:', legacyResult.serviceAddress);

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

    const validation = validateBillData(billData);
    console.log('[bill-upload] Validation:', validation.valid, validation.errors?.join(', ') || 'ok');

    let locationData = null;
    let utilityData = null;

    if (billData.serviceAddress) {
      console.log('[bill-upload] Geocoding address:', billData.serviceAddress);
      try {
        const geoResult = await geocodeAddress(billData.serviceAddress);
        if (geoResult.success && geoResult.location) {
          locationData = geoResult.location;
          console.log('[bill-upload] Geocoded:', locationData.city, locationData.stateCode);
          const utilityResult = await detectUtility(
            geoResult.location.lat,
            geoResult.location.lng,
            geoResult.location.stateCode,
            geoResult.location.city,
          );
          if (utilityResult.success) {
            utilityData = utilityResult.utility;
            if (!billData.utilityProvider && utilityData?.utilityName) billData.utilityProvider = utilityData.utilityName;
            if (!billData.electricityRate && utilityData?.avgRatePerKwh) billData.electricityRate = utilityData.avgRatePerKwh;
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

    // ── Rate Validation ──────────────────────────────────────────────────────
    // If extracted rate looks like avoided cost (< $0.07/kWh), replace with
    // the utility's known retail rate from the rules database.
    const utilityNameForRate = billData.utilityProvider || utilityData?.utilityName || null;
    const rateValidation = validateAndCorrectUtilityRate(billData.electricityRate ?? null, utilityNameForRate);
    if (rateValidation.corrected) {
      console.log(`[bill-upload] Rate corrected: $${rateValidation.originalRate?.toFixed(3) ?? 'null'} → $${rateValidation.rate.toFixed(3)}/kWh (source: ${rateValidation.source})`);
      billData.electricityRate = rateValidation.rate;
    } else {
      console.log(`[bill-upload] Rate valid: $${billData.electricityRate?.toFixed(3)}/kWh`);
    }

    // ── System Size Calculation ───────────────────────────────────────────────
    console.log('[bill-upload] Calculating system size...');
    const annualKwhForSizing = billData.estimatedAnnualKwh || 0;
    // Use utility-aware production factor for accurate sizing
    const productionFactor = getProductionFactor(utilityNameForRate);
    const systemSizeKw = annualKwhForSizing > 0
      ? Math.round((annualKwhForSizing / productionFactor) * 10) / 10
      : null;
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

    console.log('[bill-upload] Returning success response');
    return NextResponse.json({
      success: true,
      billData,
      extractionEvidence,
      validation,
      locationData,
      utilityData,
      extractionMethod,
      rateValidation: rateValidation.corrected ? {
        corrected: true,
        originalRate: rateValidation.originalRate,
        correctedRate: rateValidation.rate,
        source: rateValidation.source,
        message: `Rate corrected from $${rateValidation.originalRate?.toFixed(3) ?? 'null'}/kWh (likely avoided cost) to $${rateValidation.rate.toFixed(3)}/kWh (retail rate)`,
      } : null,
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
    console.error('[bill-upload] Fatal error:', msg);
    console.error('[bill-upload] Stack:', stack);
    return NextResponse.json({ 
      success: false, 
      error: msg,
      stack: stack?.slice(0, 300),
    }, { status: 500 });
  }
}

// ── PDF extraction ────────────────────────────────────────────────────────────
async function extractPdfText(buffer: Buffer): Promise<{ text: string; method: string }> {
  const openaiKey = process.env.OPENAI_API_KEY;

  // Method 1: Pure Node.js PDF extractor (zero external deps, guaranteed to work on Vercel)
  // Uses built-in zlib to decompress PDF streams + regex to extract text operators
  // No canvas, no DOMMatrix, no workers, no native modules needed
  console.log('[bill-upload] Trying pure Node.js PDF extractor...');
  try {
    const text = extractPdfTextPure(buffer);
    console.log('[bill-upload] Pure extractor got', text.length, 'chars');
    if (text.length > 50) return { text, method: 'pure-extract' };
    console.warn('[bill-upload] Pure extractor returned too little text:', text.length, 'chars');
  } catch (err: unknown) {
    console.warn('[bill-upload] Pure extractor failed:', err instanceof Error ? err.message : err);
  }

  // Method 1b: pdfjs-dist legacy (fallback - may fail on Vercel due to missing canvas globals)
  console.log('[bill-upload] Trying pdfjs-dist legacy...');
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
    console.log('[bill-upload] pdfjs-dist extracted', text.length, 'chars');
    if (text.length > 50) return { text, method: 'pdfjs-dist' };
  } catch (err: unknown) {
    console.warn('[bill-upload] pdfjs-dist failed:', err instanceof Error ? err.message : err);
  }

  // Method 2: OpenAI Files API + Responses API
  if (openaiKey) {
    console.log('[bill-upload] Trying OpenAI Files API + Responses API...');
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
                { type: 'input_text', text: 'Extract ALL text from this utility bill PDF. Output only the raw extracted text.' },
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
            console.log('[bill-upload] Responses API extracted', text.length, 'chars');
            return { text, method: 'openai-responses' };
          }
          console.warn('[bill-upload] Responses API empty. Keys:', Object.keys(respData).join(', '));
        } else {
          const errText = await respRes.text();
          console.warn('[bill-upload] Responses API failed:', respRes.status, errText.slice(0, 300));
        }
      } else {
        const errText = await uploadRes.text();
        console.warn('[bill-upload] OpenAI upload failed:', uploadRes.status, errText.slice(0, 200));
      }
    } catch (err: unknown) {
      console.warn('[bill-upload] OpenAI Files+Responses error:', err instanceof Error ? err.message : err);
    }
  } else {
    console.warn('[bill-upload] No OPENAI_API_KEY — skipping OpenAI extraction');
  }

  // Method 2: pdftotext CLI (local only)
  try {
    const cliText = await extractPdfTextCli(buffer);
    if (cliText.trim().length > 100) {
      console.log('[bill-upload] pdftotext extracted', cliText.length, 'chars');
      return { text: cliText, method: 'pdftotext' };
    }
  } catch { /* not available on Vercel */ }

  // Method 4: Google Vision
  const googleKey = process.env.GOOGLE_MAPS_API_KEY;
  if (googleKey) {
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
          console.log('[bill-upload] Google Vision extracted', text.length, 'chars');
          return { text, method: 'google-vision' };
        }
      }
    } catch { /* ignore */ }
  }

  console.error('[bill-upload] All PDF extraction methods failed');
  return { text: '', method: 'failed' };
}

// ── PDF CLI fallback ──────────────────────────────────────────────────────────
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

// ── Smart 3-stage image extraction ──────────────────────────────────────────
// Stage 1: Tesseract CLI (free, no API cost) — primary OCR
// Stage 2: Check if monthly usage was detected from Tesseract output
// Stage 3: OpenAI Vision / Google Vision fallback ONLY if:
//          - Tesseract confidence < 60, OR
//          - No monthly usage detected from Tesseract text
//
// Uses dynamic imports to prevent webpack from bundling tesseract.js
// worker_threads at module load time (causes HTML 500 before handler runs).
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

  // ── Stage 1: Tesseract OCR (free) ─────────────────────────────────────────
  console.log('[bill-upload] Stage 1: Tesseract OCR...');
  const tesseractResult = await recognizeImage(buffer, mimeType);

  if (tesseractResult.rawText.length > 50) {
    // ── Stage 2: Check if we got usable monthly data ─────────────────────────
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
    console.log(`[bill-upload] Tesseract returned too little text (${tesseractResult.rawText.length} chars) — trying Vision fallback`);
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