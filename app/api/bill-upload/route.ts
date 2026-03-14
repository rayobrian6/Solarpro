export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { parseBillText, validateBillData, extractBillDataWithAI } from '@/lib/billOcr';
import type { BillExtractResult } from '@/lib/billOcr';
import { getUserFromRequest } from '@/lib/auth';
import { extractPdfTextPure } from '@/lib/pdfExtract';
import { logEnvStatus } from '@/lib/env-check';

// Log env status once per cold start for deployment observability
logEnvStatus('bill-upload');
// billOcrEngine and billParser are imported dynamically inside extractImageTextSmart()
// to prevent webpack from bundling tesseract.js worker_threads at module load time.
// Static import of tesseract.js causes HTML 500 errors before the route handler runs.

// Top-level reference so webpack marks pdf-parse as external (not bundled)
let PDFParse: any = null;
try {
  const pdfParseModule = require('pdf-parse');
  PDFParse = pdfParseModule.PDFParse ?? pdfParseModule.default?.PDFParse ?? null;
} catch (e) {
  console.warn('[bill-upload] pdf-parse not available:', e instanceof Error ? e.message : e);
}

// Vercel: OCR+parse only — must complete in < 30s (well under 60s limit)
// Geocoding, utility matching, sizing moved to /api/system-size
export const maxDuration = 60; // v47.25: increased for OpenAI Vision fallback on Vercel

// POST /api/bill-upload
// Responsibilities: buffer creation, OCR/text extraction, bill field parsing.
// Does NOT: geocode, match utility, validate rate, calculate system size, create DB records.
// All heavy async work happens in /api/system-size (called by frontend after this returns).

function safeJsonError(msg: string, status = 500): NextResponse {
  return NextResponse.json({ success: false, error: msg }, { status });
}

// 6-second timeout guard — returns a rejected promise after ms
function timeoutAfter(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Operation timed out after ${ms}ms`)), ms)
  );
}

export async function POST(req: NextRequest) {
  const startMs = Date.now();

  // ── JSON Error Boundary ────────────────────────────────────────────────────
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

    console.log(`[UPLOAD_RECEIVED] file=${file?.name ?? 'none'} size=${file?.size ?? 0} hasText=${!!rawText} openai=${!!process.env.OPENAI_API_KEY} ts=${new Date().toISOString()}`);
    console.log(`[BILL_UPLOAD_STARTED] file=${file?.name ?? 'none'} size=${file?.size ?? 0} hasText=${!!rawText} openai=${!!process.env.OPENAI_API_KEY}`);

    let extractedText = rawText || '';
    let extractionMethod = 'text';

    if (file) {
      const MAX_SIZE = 10 * 1024 * 1024;
      if (file.size > MAX_SIZE) {
        return NextResponse.json({ success: false, error: 'File too large. Maximum size is 10MB.' }, { status: 413 });
      }

      const fileType = file.type;
      const fileName = file.name.toLowerCase();

      console.log(`[FILE_RECEIVED] name=${fileName} type=${fileType} size=${file.size} openai=${!!process.env.OPENAI_API_KEY}`);

      // Create buffer ONCE — used for ALL downstream operations (OCR, PDF parse, save)
      const buffer = Buffer.from(await file.arrayBuffer());
      console.log(`[FILE_BUFFER_CREATED] bytes=${buffer.length} mime=${fileType}`);
      console.log(`[FILE_SIZE_BYTES] bytes=${buffer.length} kb=${Math.round(buffer.length/1024)} mime=${fileType} name=${fileName}`);
      if (buffer.length === 0) {
        console.error('[FILE_BUFFER_CREATED] ERROR: buffer is 0 bytes — file.arrayBuffer() returned empty');
        return NextResponse.json({ success: false, error: 'File buffer is empty. Please try uploading again.', stage: 'buffer' }, { status: 422 });
      }

      if (fileType === 'application/pdf' || fileName.endsWith('.pdf')) {
        // PDF path — wrap in 6s timeout guard
        const result = await Promise.race([
          extractPdfText(buffer),
          timeoutAfter(20000).catch(() => ({ text: '', method: 'timeout' })),
        ]) as { text: string; method: string };
        extractedText = result.text;
        extractionMethod = result.method;
        console.log(`[OCR_COMPLETED] method=${result.method} chars=${result.text.length}`);
      } else if (
        fileType.startsWith('image/') ||
        fileName.endsWith('.jpg') || fileName.endsWith('.jpeg') ||
        fileName.endsWith('.png') || fileName.endsWith('.jfif') ||
        fileName.endsWith('.webp')
      ) {
        const safeMime = fileType.startsWith('image/') ? fileType : 'image/jpeg';
        console.log(`[OCR_STARTED] name=${fileName} type=${safeMime} size=${buffer.length}`);

        // Image path — wrap in 6s OCR timeout guard, return partial if exceeded
        const ocrResult = await Promise.race([
          extractImageTextSmart(buffer, safeMime),
          timeoutAfter(20000).catch(() => ({ text: '', method: 'timeout', confidence: 0 })),
        ]) as { text: string; method: string; confidence: number };
        extractedText = ocrResult.text;
        extractionMethod = ocrResult.method;

        console.log(`[OCR_COMPLETED] chars=${extractedText.length} method=${ocrResult.method} confidence=${ocrResult.confidence}`);
        console.log(`[TEXT_LENGTH] chars=${extractedText.length} ms=${Date.now() - startMs}`);

        if (extractedText.length > 50) {
          console.log(`[OCR_SUCCESS] method=${ocrResult.method} chars=${extractedText.length}`);
        } else {
          console.warn(`[OCR_FAILED] method=${ocrResult.method} chars=${extractedText.length}`);
        }
      } else {
        return NextResponse.json({ success: false, error: 'Unsupported file type. Please upload PDF, JPG, or PNG.' }, { status: 400 });
      }

      console.log(`[FILE_SAVED] buffer_intact=${buffer.length > 0} extracted_chars=${extractedText.length}`);
    }

    if (!extractedText.trim()) {
      // OCR failed completely — return a soft failure that lets the UI show manual entry
      // rather than a hard error. This matches Step 5 of the OCR reliability spec.
      console.warn(`[OCR_FAILED] all methods returned empty text name=${file?.name ?? 'none'} mime=${file?.type ?? 'none'} size=${file?.size ?? 0} openai=${!!process.env.OPENAI_API_KEY}`);
      return NextResponse.json({
        success: false,
        status: 'ocr_failed',
        error: 'Bill text could not be extracted. Please try a clearer image or enter your usage manually.',
        allow_manual_entry: true,
        stage: extractionMethod,
        debug: {
          hasOpenAI: !!process.env.OPENAI_API_KEY,
          pdfParseLoaded: !!PDFParse,
          fileType: file?.type,
          fileSize: file?.size,
        },
      }, { status: 422 });
    }

    console.log(`[TEXT_LENGTH] chars=${extractedText.length} method=${extractionMethod} ms=${Date.now() - startMs}`);
    console.log(`[OCR_TEXT_FIRST_500] method=${extractionMethod} preview=${JSON.stringify(extractedText.slice(0, 500))}`);

    // ── RAW OCR TEXT LOG ──────────────────────────────────────────────────────
    console.log('[bill-upload] === RAW OCR TEXT ===');
    const ocrLines = extractedText.split('\n');
    for (const line of ocrLines.slice(0, 60)) {
      if (line.trim()) console.log(`[ocr-raw] ${line}`);
    }
    if (ocrLines.length > 60) {
      console.log(`[ocr-raw] ... (${ocrLines.length - 60} more lines)`);
    }
    console.log('[bill-upload] === END RAW OCR TEXT ===');

    // ── Deterministic parsing ──────────────────────────────────────────────────
    console.log('[bill-upload] Parsing bill text (deterministic)...');
    const { parseBill } = await import('@/lib/billParser');

    const parseResult = parseBill(extractedText);

    for (const line of parseResult.debugLog) {
      console.log(line);
    }

    // Stage B: extract non-usage fields (address, account, charges)
    const legacyResult = parseBillText(extractedText);

    // ── Map BillParseResult → BillExtractResult ────────────────────────────────
    const monthlyArray = parseResult.monthlyArray;
    const monthsFound  = parseResult.monthsFound;
    const annualKwh    = parseResult.annual?.value ?? undefined;

    const monthlyKwh: number | undefined =
      parseResult.currentMonthKwh ??
      (monthsFound > 0 ? Math.round(monthlyArray.reduce((s, v) => s + v, 0) / monthsFound) : undefined);

    const estimatedAnnualKwh: number | undefined =
      annualKwh ??
      (monthsFound >= 10 ? monthlyArray.reduce((s, v) => s + v, 0) : undefined) ??
      (monthsFound >= 3 ? Math.round((monthlyArray.reduce((s, v) => s + v, 0) / monthsFound) * 12) : undefined) ??
      legacyResult.estimatedAnnualKwh;

    const electricityRate: number | undefined =
      parseResult.rate?.value ?? legacyResult.electricityRate ?? undefined;

    const utilityProvider: string | undefined =
      parseResult.utility?.value ?? legacyResult.utilityProvider ?? undefined;

    const extractedFields: string[] = [];
    if (utilityProvider)              extractedFields.push('utilityProvider');
    if (legacyResult.customerName)    extractedFields.push('customerName');
    if (legacyResult.serviceAddress)  extractedFields.push('serviceAddress');
    if (legacyResult.accountNumber)   extractedFields.push('accountNumber');
    if (monthlyKwh !== undefined)     extractedFields.push('monthlyKwh');
    if (annualKwh !== undefined)      extractedFields.push('annualKwh');
    if (monthsFound > 0)              extractedFields.push('monthlyUsageHistory');
    if (electricityRate !== undefined) extractedFields.push('electricityRate');
    if (legacyResult.totalAmount)     extractedFields.push('totalAmount');
    if (legacyResult.billingPeriodStart) extractedFields.push('billingPeriod');

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

    console.log(`[FIELDS_EXTRACTED] count=${extractedFields.length} fields=${extractedFields.join(',') || 'none'} monthlyKwh=${monthlyKwh ?? 'null'} annualKwh=${annualKwh ?? 'null'} confidence=${confidence} ms=${Date.now() - startMs}`);
    console.log(`[AI_FIELDS_EXTRACTED] deterministic: utility="${utilityProvider ?? 'none'}" monthlyKwh=${monthlyKwh ?? 'null'} annualKwh=${annualKwh ?? 'null'} rate=${electricityRate ?? 'null'} address="${legacyResult.serviceAddress ?? 'none'}" customer="${legacyResult.customerName ?? 'none'}"`);
    console.log(`[PARSED_DATA_OBJECT] ${JSON.stringify({ utilityProvider, monthlyKwh, annualKwh, electricityRate, address: legacyResult.serviceAddress, customer: legacyResult.customerName, confidence, fieldCount: extractedFields.length })}`);

    // ── AI Extraction Fallback ────────────────────────────────────────────────
    let finalBillData = billData;
    if (extractedFields.length === 0 && extractedText.trim().length > 50) {
      console.log('[AI_EXTRACTION_STARTED] reason=zero_fields_extracted');
      finalBillData = await Promise.race([
        extractBillDataWithAI(extractedText, billData),
        timeoutAfter(10000).catch(() => billData),
      ]) as BillExtractResult;
      console.log(`[AI_EXTRACTION_COMPLETE] fields=${finalBillData.extractedFields?.join(',') || 'none'} confidence=${finalBillData.confidence}`);
    } else if (extractedFields.length < 2 && extractedText.trim().length > 100) {
      console.log(`[AI_EXTRACTION_STARTED] reason=low_field_count fields=${extractedFields.length}`);
      finalBillData = await Promise.race([
        extractBillDataWithAI(extractedText, billData),
        timeoutAfter(10000).catch(() => billData),
      ]) as BillExtractResult;
      console.log(`[AI_EXTRACTION_COMPLETE] fields=${finalBillData.extractedFields?.join(',') || 'none'} confidence=${finalBillData.confidence}`);
    }

    const aiFieldCount = finalBillData.extractedFields?.length ?? 0;
    console.log(`[AI_EXTRACTION_RESULT] totalFields=${aiFieldCount} usedAI=${finalBillData.usedLlmFallback} monthlyKwh=${finalBillData.monthlyKwh ?? 'null'} annualKwh=${finalBillData.estimatedAnnualKwh ?? 'null'} utility="${finalBillData.utilityProvider ?? 'none'}" address="${finalBillData.serviceAddress ?? 'none'}"`);

    // ── Hard fail on completely empty parse ───────────────────────────────────
    const hasAnyKwh = (finalBillData.monthlyKwh ?? 0) > 0
      || (finalBillData.estimatedAnnualKwh ?? 0) > 0
      || (finalBillData.annualKwh ?? 0) > 0
      || (finalBillData.monthlyUsageHistory?.length ?? 0) > 0;
    const hasLocation = !!(finalBillData.serviceAddress || finalBillData.utilityProvider);
    const totalFinalFields = finalBillData.extractedFields?.length ?? 0;

    if (totalFinalFields === 0 && !hasAnyKwh && !hasLocation && file) {
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

    const elapsedMs = Date.now() - startMs;
    console.log(`[BILL_UPLOAD_RETURNING] fields=${totalFinalFields} confidence=${finalBillData.confidence} elapsedMs=${elapsedMs}`);
    console.log(`[API_RESPONSE_SENT] success=true fields=${totalFinalFields} hasKwh=${hasAnyKwh} hasLocation=${hasLocation} usedAI=${finalBillData.usedLlmFallback} elapsedMs=${elapsedMs}`);
    console.log(`[DB_SAVE_STARTED] note=bill-upload-route-does-not-save-to-DB — frontend calls /api/bills after project creation`);
    console.log(`[DB_SAVE_COMPLETE] note=DB-save-handled-by-frontend-after-project-creation`);

    // ── Return parsed bill data only ──────────────────────────────────────────
    // Geocoding, utility matching, rate validation, and system sizing
    // are handled by the frontend calling /api/system-size separately.
    return NextResponse.json({
      success: true,
      billData: finalBillData,
      extractionEvidence,
      extractionMethod,
      // These are null — frontend must call /api/system-size for these
      locationData: null,
      utilityData: null,
      matchedUtility: null,
      systemSizing: null,
      rateValidation: null,
      validation: { valid: true, warnings: [], errors: [] },
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    const stack = err instanceof Error ? err.stack?.split('\n').slice(0, 5).join(' | ') : '';
    console.error('[BILL_UPLOAD_ERROR] Fatal error:', msg);
    console.error('[BILL_UPLOAD_ERROR] Stack:', stack);

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

  function isUsefulText(t: string): boolean {
    if (t.length < 100) return false;
    const hasMoney    = /\$\s*\d/.test(t);
    const hasKwh      = /\d\s*kwh/i.test(t);
    const hasDigits   = (/\d{3,}/.exec(t) || []).length > 0;
    const hasAddress  = /street|ave|road|blvd|drive|lane|pl\b|st\b/i.test(t);
    const hasAccount  = /account|service|billing|meter|customer/i.test(t);
    const score = [hasMoney, hasKwh, hasDigits, hasAddress, hasAccount].filter(Boolean).length;
    return score >= 2;
  }

  // Method 1: pdftotext CLI (poppler)
  // v47.25: Skip on Vercel — pdftotext binary not available in serverless runtime
  const _isVercel = !!(process.env.VERCEL || process.env.VERCEL_ENV || process.env.VERCEL_URL);
  console.log('[PDF_PARSE_STARTED] method=pdftotext isVercel=' + _isVercel);
  if (!_isVercel) try {
    const text = await extractPdfTextCli(buffer);
    if (isUsefulText(text)) {
      console.log(`[PDF_PARSE_SUCCESS] method=pdftotext chars=${text.length}`);
      return { text, method: 'pdftotext' };
    }
    console.warn(`[bill-upload] pdftotext returned low-quality text (${text.length} chars) — trying next method`);
  } catch (err: unknown) {
    console.warn('[PDF_PARSE_FAILED] method=pdftotext error:', err instanceof Error ? err.message : err);
  } // end if (!_isVercel)

  // Method 2: pdf-parse (npm library)
  console.log('[PDF_PARSE_STARTED] method=pdf-parse');
  try {
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

  // Method 3: Pure Node.js stream extractor
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

  // Method 4: pdfjs-dist
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

  // Method 5: OpenAI Files API + Responses API
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
          signal: AbortSignal.timeout(25000),
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
        }
      }
    } catch (err: unknown) {
      console.warn('[PDF_PARSE_FAILED] method=openai-files-api error:', err instanceof Error ? err.message : err);
    }
  }

  // Method 6: Google Vision
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

  console.error('[PDF_PARSE_FAILED] All PDF extraction methods exhausted — no usable text');
  return { text: '', method: 'failed' };
}

// ── PDF CLI fallback ────────────────────────────────────────────────────────────
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

// ── Inline Tesseract CLI runner ────────────────────────────────────────────────
async function runTesseractCliInline(buffer: Buffer, mimeType: string): Promise<string> {
  try {
    const { execFile } = await import('child_process');
    const { writeFile, readFile, unlink } = await import('fs/promises');
    const { join } = await import('path');
    const { tmpdir } = await import('os');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);

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

// ── Smart 3-stage image extraction ────────────────────────────────────────────
async function extractImageTextSmart(
  buffer: Buffer,
  mimeType: string,
): Promise<{ text: string; method: string; confidence: number }> {
  const openaiKey = process.env.OPENAI_API_KEY;
  // Note: GOOGLE_VISION_API_KEY is separate from GOOGLE_MAPS_API_KEY
  const googleVisionKey = process.env.GOOGLE_VISION_API_KEY || process.env.GOOGLE_MAPS_API_KEY;

  const { recognizeImage, recognizeImageWithVision, recognizeImageWithGoogle } =
    await import('@/lib/billOcrEngine');
  const { parseMonthlyUsage } = await import('@/lib/billParser');

  // ── Log OCR input for observability (Step 1 of audit) ──────────────────────
  console.log(`[OCR_INPUT_BUFFER_LENGTH] bytes=${buffer.length}`);
  console.log(`[OCR_INPUT_MIME_TYPE] mime=${mimeType}`);
  console.log(`[OCR_INPUT_FILE_SIZE] kb=${Math.round(buffer.length / 1024)}`);

  if (buffer.length === 0) {
    console.error('[OCR_INPUT_BUFFER_LENGTH] ERROR: buffer is empty — upload pipeline broken');
    return { text: '', method: 'empty-buffer', confidence: 0 };
  }

  // ── Stage 1: Inline Tesseract CLI (fastest, most reliable on Vercel) ───────
  // Try CLI directly FIRST — avoids the HTTP round-trip to /api/ocr which
  // can fail on cold start when NEXTAUTH_URL / NEXT_PUBLIC_APP_URL is not set.
  console.log('[OCR_STARTED] stage=1 method=tesseract-cli-inline');
  let tesseractText = '';
  try {
    tesseractText = await runTesseractCliInline(buffer, mimeType);
    console.log(`[OCR_COMPLETED] stage=1 method=tesseract-cli chars=${tesseractText.length}`);
  } catch (cliErr) {
    console.warn('[OCR_COMPLETED] stage=1 method=tesseract-cli failed:', cliErr instanceof Error ? cliErr.message : String(cliErr));
  }

  // ── Stage 1b: /api/ocr HTTP (Tesseract.js WASM fallback) ───────────────────
  // v47.25: SKIP on Vercel — WASM init downloads ~400MB and exceeds the 60s budget.
  // Tesseract CLI is not available on Vercel serverless (no binary install).
  // When CLI fails, go directly to OpenAI Vision (Stage 2) which is fast (~5s).
  // Only try WASM HTTP in local dev where CLI might also be missing but WASM is cached.
  const isVercel = !!(process.env.VERCEL || process.env.VERCEL_ENV || process.env.VERCEL_URL);
  if (tesseractText.length < 20 && !isVercel) {
    console.log('[OCR_STARTED] stage=1b method=tesseract-wasm-http (local-dev only)');
    try {
      const wasmResult = await recognizeImage(buffer, mimeType);
      if (wasmResult.rawText.length > tesseractText.length) {
        tesseractText = wasmResult.rawText;
        console.log(`[OCR_COMPLETED] stage=1b method=tesseract-wasm chars=${tesseractText.length} confidence=${wasmResult.confidence}`);
      }
    } catch (wasmErr) {
      console.warn('[OCR_COMPLETED] stage=1b method=tesseract-wasm failed:', wasmErr instanceof Error ? wasmErr.message : String(wasmErr));
    }
  } else if (tesseractText.length < 20 && isVercel) {
    console.log('[OCR_SKIPPED] stage=1b reason=vercel_no_wasm_binary — escalating directly to OpenAI Vision');
  }  console.log(`[OCR_TEXT_LENGTH] after_tesseract=${tesseractText.length}`);

  // ── Evaluate Tesseract result ───────────────────────────────────────────────
  if (tesseractText.length >= 20) {
    const parseCheck = parseMonthlyUsage(tesseractText);
    const hasUsage = parseCheck.monthsFound >= 3 || parseCheck.annualUsage !== null;
    console.log(`[OCR_COMPLETED] tesseract_sufficient=${hasUsage} monthsFound=${parseCheck.monthsFound} chars=${tesseractText.length}`);

    // If Tesseract found good usage data, skip Vision (save cost)
    if (hasUsage && tesseractText.length > 100) {
      console.log('[OCR_COMPLETED] stage=tesseract method=tesseract-cli sufficient — skipping Vision (cost $0)');
      return { text: tesseractText, method: 'tesseract-cli', confidence: 75 };
    }
    // Tesseract got text but no usage — Vision may do better, fall through
    console.log('[OCR_STARTED] stage=2 reason=no_usage_in_tesseract_text — trying Vision');
  } else {
    // Tesseract got < 20 chars — Vision is required
    console.warn(`[OCR_FAILED] stage=1 chars=${tesseractText.length} — escalating to Vision`);
  }

  // ── Stage 2: OpenAI Vision (direct call, not via /api/ocr) ─────────────────
  // Call Vision directly from here so we don't depend on the HTTP route.
  if (openaiKey) {
    console.log('[OCR_STARTED] stage=2 method=openai-vision');
    try {
      const visionResult = await recognizeImageWithVision(buffer, mimeType, openaiKey);
      console.log(`[OCR_COMPLETED] stage=2 method=openai-vision chars=${visionResult.rawText.length} confidence=${visionResult.confidence}`);
      console.log(`[OCR_TEXT_LENGTH] after_vision=${visionResult.rawText.length}`);

      if (visionResult.rawText.length >= 20) {
        // Compare Vision vs Tesseract — pick better result
        const visionParse = parseMonthlyUsage(visionResult.rawText);
        const tesseractParse = tesseractText.length >= 20 ? parseMonthlyUsage(tesseractText) : null;

        const visionMonths = visionParse.monthsFound;
        const tessMonths = tesseractParse?.monthsFound ?? 0;

        if (visionMonths >= tessMonths || (visionParse.annualUsage !== null && (tesseractParse?.annualUsage ?? null) === null)) {
          console.log(`[OCR_COMPLETED] method=openai-vision chosen months=${visionMonths} vs tesseract=${tessMonths}`);
          return { text: visionResult.rawText, method: 'openai-vision', confidence: visionResult.confidence };
        } else {
          console.log(`[OCR_COMPLETED] method=tesseract-kept months=${tessMonths} > vision=${visionMonths}`);
          return { text: tesseractText, method: 'tesseract-kept', confidence: 70 };
        }
      }
    } catch (vErr) {
      console.warn('[OCR_COMPLETED] stage=2 method=openai-vision failed:', vErr instanceof Error ? vErr.message : String(vErr));
    }
  } else {
    console.warn('[OCR_STARTED] stage=2 SKIPPED — OPENAI_API_KEY not set');
  }

  // ── Stage 3: Google Vision (last resort) ────────────────────────────────────
  if (googleVisionKey) {
    console.log('[OCR_STARTED] stage=3 method=google-vision');
    try {
      const googleResult = await recognizeImageWithGoogle(buffer, googleVisionKey);
      console.log(`[OCR_COMPLETED] stage=3 method=google-vision chars=${googleResult.rawText.length}`);
      console.log(`[OCR_TEXT_LENGTH] after_google=${googleResult.rawText.length}`);
      if (googleResult.rawText.length >= 20) {
        return { text: googleResult.rawText, method: 'google-vision', confidence: googleResult.confidence };
      }
    } catch (gErr) {
      console.warn('[OCR_COMPLETED] stage=3 method=google-vision failed:', gErr instanceof Error ? gErr.message : String(gErr));
    }
  }

  // ── Return whatever Tesseract got (even low confidence) ────────────────────
  if (tesseractText.length > 0) {
    console.warn(`[OCR_COMPLETED] method=tesseract-low-confidence chars=${tesseractText.length} — returning partial`);
    return { text: tesseractText, method: 'tesseract-low-confidence', confidence: 30 };
  }

  console.error('[OCR_FAILED] all stages exhausted — returning empty');
  return { text: '', method: 'failed', confidence: 0 };
}

// ── System size helper (kept for internal use if needed) ───────────────────────
function calculateRecommendedSystemSize(annualKwh: number, lat: number): number {
  const sunHours = lat < 25 ? 5.5 : lat < 30 ? 5.2 : lat < 35 ? 4.8 : lat < 40 ? 4.4 : lat < 45 ? 4.0 : 3.6;
  const kwhPerKwPerYear = sunHours * 365 * 0.80;
  return Math.round((annualKwh / kwhPerKwPerYear) * 10) / 10;
}