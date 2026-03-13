/**
 * app/api/debug/bill/route.ts
 *
 * Bill upload pipeline diagnostic endpoint.
 * POST /api/debug/bill
 *
 * Upload a bill file (multipart/form-data, field: "file") and get a full
 * trace of every pipeline stage without saving anything to the database.
 *
 * Stages traced:
 *   1. File reception + buffer creation
 *   2. OCR text extraction (Tesseract CLI / WASM / Vision)
 *   3. Deterministic parsing (parseBill)
 *   4. AI fallback extraction (extractBillDataWithAI) -- only if fields < 3
 *   5. Rate validation (validateAndCorrectUtilityRate)
 *   6. Sizing estimate (if kWh available)
 *
 * Returns a detailed JSON object with every intermediate value for
 * debugging bill parsing failures in production.
 *
 * AUTH: Required (session cookie).
 *
 * NOTE: This route does NOT call geocodeAddress, matchUtility, or save to DB.
 *       For the full geocoding+sizing pipeline use /api/system-size directly.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { parseBill } from '@/lib/billParser';
import { extractBillDataWithAI } from '@/lib/billOcr';
import type { BillExtractResult } from '@/lib/billOcr';
import { validateAndCorrectUtilityRate } from '@/lib/utility-rules';

// Minimal inline OCR runner for diagnostics
async function runOcr(buf: Buffer, mime: string, name: string): Promise<{
  text: string;
  method: string;
  chars: number;
  error?: string;
}> {
  const debugLog: string[] = [];

  // PDF path
  if (mime === 'application/pdf' || name.toLowerCase().endsWith('.pdf')) {
    // Try pdftotext CLI
    try {
      const { execSync } = await import('child_process');
      const os = await import('os');
      const path = await import('path');
      const fs = await import('fs');
      const tmpIn  = path.join(os.tmpdir(), `dbg_bill_${Date.now()}.pdf`);
      const tmpOut = path.join(os.tmpdir(), `dbg_bill_${Date.now()}.txt`);
      fs.writeFileSync(tmpIn, buf);
      try {
        execSync(`pdftotext -layout "${tmpIn}" "${tmpOut}"`, { timeout: 10000 });
        const text = fs.readFileSync(tmpOut, 'utf8').trim();
        try { fs.unlinkSync(tmpIn); } catch {}
        try { fs.unlinkSync(tmpOut); } catch {}
        if (text.length >= 50) {
          return { text, method: 'pdftotext-cli', chars: text.length };
        }
        debugLog.push(`pdftotext returned ${text.length} chars (below threshold)`);
      } catch (e: any) {
        debugLog.push(`pdftotext failed: ${e.message}`);
        try { fs.unlinkSync(tmpIn); } catch {}
      }
    } catch (e: any) {
      debugLog.push(`pdftotext setup error: ${e.message}`);
    }

    // Try pdf-parse
    try {
      const pdfParseMod = await import('pdf-parse');
      const pdfParse = (pdfParseMod as any).default || (pdfParseMod as any).PDFParse || pdfParseMod;
      const result = typeof pdfParse === 'function' ? await pdfParse(buf) : null;
      if (result?.text && result.text.length >= 50) {
        return { text: result.text.trim(), method: 'pdf-parse', chars: result.text.length };
      }
      debugLog.push(`pdf-parse returned ${result?.text?.length ?? 0} chars (below threshold)`);
    } catch (e: any) {
      debugLog.push(`pdf-parse failed: ${e.message}`);
    }

    return {
      text: '',
      method: 'pdf-all-failed',
      chars: 0,
      error: `All PDF extraction methods failed. Log: ${debugLog.join(' | ')}`,
    };
  }

  // Image path -- try Tesseract CLI first
  try {
    const { execSync } = await import('child_process');
    const os = await import('os');
    const path = await import('path');
    const fs = await import('fs');

    const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
    const tmpIn  = path.join(os.tmpdir(), `dbg_bill_${Date.now()}.${ext}`);
    const tmpOut = path.join(os.tmpdir(), `dbg_bill_${Date.now()}`);
    fs.writeFileSync(tmpIn, buf);

    try {
      execSync(`tesseract "${tmpIn}" "${tmpOut}" --oem 1 --psm 3 -l eng`, { timeout: 15000 });
      const outFile = `${tmpOut}.txt`;
      if (fs.existsSync(outFile)) {
        const text = fs.readFileSync(outFile, 'utf8').trim();
        try { fs.unlinkSync(tmpIn); } catch {}
        try { fs.unlinkSync(outFile); } catch {}
        if (text.length >= 20) {
          return { text, method: 'tesseract-cli', chars: text.length };
        }
        debugLog.push(`tesseract-cli returned ${text.length} chars (below threshold)`);
      }
    } catch (e: any) {
      debugLog.push(`tesseract-cli failed: ${e.message}`);
      try { fs.unlinkSync(tmpIn); } catch {}
    }
  } catch (e: any) {
    debugLog.push(`tesseract-cli setup error: ${e.message}`);
  }

  // OpenAI Vision fallback
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    try {
      const base64 = buf.toString('base64');
      const imageUrl = `data:${mime};base64,${base64}`;
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o',
          max_tokens: 2000,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: 'Extract ALL text from this utility bill image. Return only raw text, no formatting.' },
              { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
            ],
          }],
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (resp.ok) {
        const json = await resp.json();
        const text = json.choices?.[0]?.message?.content || '';
        if (text.length > 20) {
          return { text, method: 'openai-vision', chars: text.length };
        }
        debugLog.push(`openai-vision returned ${text.length} chars`);
      } else {
        debugLog.push(`openai-vision HTTP ${resp.status}`);
      }
    } catch (e: any) {
      debugLog.push(`openai-vision error: ${e.message}`);
    }
  } else {
    debugLog.push('openai-vision skipped (no OPENAI_API_KEY)');
  }

  return {
    text: '',
    method: 'image-all-failed',
    chars: 0,
    error: `All image OCR methods failed. Log: ${debugLog.join(' | ')}`,
  };
}

export async function POST(req: NextRequest) {
  const startMs = Date.now();

  // -- Auth check --------------------------------------------------------------
  const user = getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const trace: Record<string, any> = {
    pipeline: 'debug/bill',
    timestamp: new Date().toISOString(),
    userId: user.id,
    stages: {},
  };

  // -- Stage 1: File reception -------------------------------------------------
  let buf: Buffer;
  let mime: string;
  let fileName: string;
  let fileSize: number;

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({
        success: false,
        error: 'No file provided. Send multipart/form-data with field "file".',
        trace,
      }, { status: 400 });
    }

    fileName = file.name || 'unknown';
    mime     = file.type || 'application/octet-stream';
    fileSize = file.size;
    buf      = Buffer.from(await file.arrayBuffer());

    trace.stages.reception = {
      ok: true,
      fileName,
      mime,
      fileSizeBytes: fileSize,
      fileSizeKb: Math.round(fileSize / 1024),
      bufferLength: buf.length,
      bufferMatch: buf.length === fileSize,
    };

    console.log(`[DEBUG_BILL_STAGE1] file=${fileName} mime=${mime} size=${fileSize}B bufLen=${buf.length}`);

    if (buf.length === 0) {
      trace.stages.reception.error = 'Buffer is empty (0 bytes)';
      return NextResponse.json({ success: false, error: 'Empty file buffer', trace }, { status: 422 });
    }
  } catch (e: any) {
    trace.stages.reception = { ok: false, error: e.message };
    return NextResponse.json({ success: false, error: `File reception failed: ${e.message}`, trace }, { status: 400 });
  }

  // -- Stage 2: OCR text extraction -------------------------------------------
  let ocrText = '';
  let ocrMethod = '';

  try {
    const ocrStart = Date.now();
    const ocrResult = await runOcr(buf, mime, fileName);
    const ocrMs = Date.now() - ocrStart;

    ocrText   = ocrResult.text;
    ocrMethod = ocrResult.method;

    trace.stages.ocr = {
      ok: ocrResult.chars > 0,
      method: ocrResult.method,
      chars: ocrResult.chars,
      elapsedMs: ocrMs,
      first500: ocrText.slice(0, 500),
      error: ocrResult.error || null,
    };

    console.log(`[DEBUG_BILL_STAGE2] ocr_method=${ocrMethod} chars=${ocrResult.chars} elapsedMs=${ocrMs}`);
  } catch (e: any) {
    trace.stages.ocr = { ok: false, error: e.message };
    console.warn(`[DEBUG_BILL_STAGE2] OCR threw: ${e.message}`);
  }

  // -- Stage 3: Deterministic parsing -----------------------------------------
  // BillParseResult fields: utility (ExtractedValue), monthlyArray, annual (ExtractedValue), rate (ExtractedValue)
  let parsedFields = 0;
  let parsedData: Record<string, any> = {
    utility:       null,
    monthly_kwh:   null,
    annual_kwh:    null,
    rate:          null,
    monthly_array: null,
    months_found:  0,
  };

  try {
    const parseStart = Date.now();
    const parsed = ocrText ? parseBill(ocrText) : null;
    const parseMs = Date.now() - parseStart;

    if (parsed) {
      parsedData = {
        utility:       parsed.utility?.value       ?? null,
        monthly_kwh:   parsed.currentMonthKwh      ?? null,
        annual_kwh:    parsed.annual?.value        ?? null,
        rate:          parsed.rate?.value          ?? null,
        monthly_array: parsed.monthlyArray?.filter(v => v > 0) ?? [],
        months_found:  parsed.monthsFound          ?? 0,
      };

      // Count non-null, non-empty fields as "found"
      parsedFields = [
        parsedData.utility,
        parsedData.monthly_kwh,
        parsedData.annual_kwh,
        parsedData.rate,
        (parsedData.monthly_array?.length > 0) ? true : null,
      ].filter(v => v !== null && v !== undefined).length;
    }

    trace.stages.parse = {
      ok: parsedFields > 0,
      fieldsFound: parsedFields,
      elapsedMs: parseMs,
      data: parsedData,
      debugLog: parsed?.debugLog?.slice(0, 20) ?? [],
    };

    console.log(`[DEBUG_BILL_STAGE3] deterministic_fields=${parsedFields} elapsedMs=${parseMs}`);
  } catch (e: any) {
    trace.stages.parse = { ok: false, error: e.message };
    console.warn(`[DEBUG_BILL_STAGE3] parseBill threw: ${e.message}`);
  }

  // -- Stage 4: AI fallback extraction (if fields < 3) -------------------------
  // BillExtractResult fields: monthlyKwh, annualKwh, electricityRate, utilityProvider, serviceAddress, customerName
  let usedAI = false;
  const emptyExtract: BillExtractResult = { success: false, confidence: 'low', extractedFields: [] };

  if (parsedFields < 3 && ocrText.length > 50) {
    try {
      const aiStart = Date.now();
      const aiResult = await extractBillDataWithAI(ocrText, emptyExtract);
      const aiMs = Date.now() - aiStart;
      usedAI = true;

      const aiData = {
        utility:     aiResult.utilityProvider   ?? null,
        monthly_kwh: aiResult.monthlyKwh        ?? null,
        annual_kwh:  aiResult.annualKwh         ?? null,
        rate:        aiResult.electricityRate   ?? null,
        address:     aiResult.serviceAddress    ?? null,
        customer:    aiResult.customerName      ?? null,
      };

      // Merge AI results into parsedData for missing fields
      if (!parsedData.utility  && aiData.utility)     parsedData.utility      = aiData.utility;
      if (!parsedData.monthly_kwh && aiData.monthly_kwh) parsedData.monthly_kwh = aiData.monthly_kwh;
      if (!parsedData.annual_kwh  && aiData.annual_kwh)  parsedData.annual_kwh  = aiData.annual_kwh;
      if (!parsedData.rate && aiData.rate)            parsedData.rate         = aiData.rate;

      const aiNonNull = Object.values(aiData).filter(v => v !== null && v !== undefined).length;

      trace.stages.ai_fallback = {
        ok: true,
        triggered: true,
        reason: `deterministic_fields=${parsedFields} < 3`,
        fieldsFromAI: aiNonNull,
        elapsedMs: aiMs,
        data: aiData,
      };

      console.log(`[DEBUG_BILL_STAGE4] ai_fields=${aiNonNull} elapsedMs=${aiMs}`);
    } catch (e: any) {
      trace.stages.ai_fallback = { ok: false, triggered: true, error: e.message };
      console.warn(`[DEBUG_BILL_STAGE4] AI fallback threw: ${e.message}`);
    }
  } else {
    trace.stages.ai_fallback = {
      ok: true,
      triggered: false,
      reason: parsedFields >= 3
        ? `deterministic_fields=${parsedFields} >= 3 (no AI needed)`
        : `ocr_text_too_short (${ocrText.length} chars)`,
    };
  }

  // -- Stage 5: Rate validation ------------------------------------------------
  let rateValidation: Record<string, any> = {};

  try {
    const rawRate   = parsedData.rate    ?? null;
    const utilityName = parsedData.utility ?? null;
    const rv = validateAndCorrectUtilityRate(rawRate, utilityName);

    rateValidation = {
      inputRate:    rawRate,
      outputRate:   rv.rate,
      source:       rv.source,
      corrected:    rv.corrected,
      suspect:      rv.suspect,
      originalRate: rv.originalRate,
      message: rv.corrected
        ? `Rate ${rv.suspect ? 'suspect (supply-only)' : 'out of range'}: $${rv.originalRate?.toFixed(3) ?? 'null'}/kWh -> $${rv.rate.toFixed(3)}/kWh (${rv.source})`
        : `Rate accepted: $${rv.rate.toFixed(3)}/kWh (${rv.source})`,
    };

    trace.stages.rate_validation = { ok: true, ...rateValidation };

    console.log(`[DEBUG_BILL_STAGE5] rate_source=${rv.source} rate=$${rv.rate.toFixed(3)} corrected=${rv.corrected}`);
  } catch (e: any) {
    trace.stages.rate_validation = { ok: false, error: e.message };
  }

  // -- Stage 6: Sizing estimate -----------------------------------------------
  const annualKwh = parsedData.annual_kwh
    ?? (parsedData.monthly_kwh ? parsedData.monthly_kwh * 12 : null)
    ?? (parsedData.monthly_array?.length > 0
        ? parsedData.monthly_array.reduce((s: number, v: number) => s + v, 0)
        : null);
  const finalRate = (rateValidation.outputRate as number) || 0.13;

  if (annualKwh && annualKwh > 0) {
    const productionFactor = 1200; // national average estimate for debug
    const systemKw   = Math.round((annualKwh / productionFactor) * 10) / 10;
    const panels     = Math.ceil(systemKw / 0.4);
    const cost       = Math.round(systemKw * 3000);
    const annSavings = Math.round(annualKwh * finalRate);

    trace.stages.sizing = {
      ok: true,
      annualKwh,
      productionFactor,
      systemKw,
      estimatedPanels: panels,
      estimatedCost: cost,
      annualSavingsEstimate: annSavings,
      note: 'Production factor 1200 kWh/kW/yr is a national average for debug only. Use /api/system-size for location-accurate sizing.',
    };

    console.log(`[DEBUG_BILL_STAGE6] annualKwh=${annualKwh} systemKw=${systemKw} panels=${panels}`);
  } else {
    trace.stages.sizing = {
      ok: false,
      reason: 'No kWh data extracted -- cannot estimate system size',
    };
  }

  // -- Summary -----------------------------------------------------------------
  const totalElapsedMs = Date.now() - startMs;
  const hasKwh     = !!(parsedData.annual_kwh || parsedData.monthly_kwh || (parsedData.monthly_array?.length > 0));
  const hasRate    = !!(parsedData.rate);
  const hasAddress = false; // address not in BillParseResult; comes from AI fallback only
  const hasUtility = !!(parsedData.utility);

  trace.summary = {
    totalElapsedMs,
    ocrSuccess:   (trace.stages.ocr?.chars || 0) > 0,
    parseSuccess: parsedFields > 0,
    usedAI,
    finalFields: {
      utility:     parsedData.utility     ?? null,
      monthly_kwh: parsedData.monthly_kwh ?? null,
      annual_kwh:  parsedData.annual_kwh  ?? null,
      rate:        parsedData.rate        ?? null,
      months_found:parsedData.months_found ?? 0,
    },
    hasKwh,
    hasRate,
    hasUtility,
    readyForSizing: hasKwh,
    recommendation: hasKwh
      ? 'READY: call POST /api/system-size with annual_kwh, address, utility, rate'
      : 'INSUFFICIENT: no kWh extracted -- bill may need manual entry or better OCR',
  };

  console.log(`[DEBUG_BILL_COMPLETE] elapsedMs=${totalElapsedMs} hasKwh=${hasKwh} usedAI=${usedAI} ocrMethod=${ocrMethod}`);

  return NextResponse.json({
    success: true,
    trace,
  }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}