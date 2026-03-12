import { NextRequest, NextResponse } from 'next/server';
import { parseBillText, parseBillTextWithLLM, validateBillData } from '@/lib/billOcr';
import { geocodeAddress } from '@/lib/locationEngine';
import { detectUtility } from '@/lib/utilityDetector';
import { getUserFromRequest } from '@/lib/auth';
import { extractPdfTextPure } from '@/lib/pdfExtract';
import { validateAndCorrectUtilityRate, checkNetMeteringLimit, getProductionFactor } from '@/lib/utility-rules';

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
        extractedText = await extractImageText(buffer, safeMime);
        extractionMethod = 'image-vision';
        console.log(`[bill-upload] Image extraction result: chars=${extractedText.length}`);
      } else {
        return NextResponse.json({ success: false, error: 'Unsupported file type. Please upload PDF, JPG, or PNG.' }, { status: 400 });
      }
    }

    if (!extractedText.trim()) {
      const visionError = (extractImageText as any)._lastError || null;
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

    console.log('[bill-upload] Parsing bill text...');
    const billData = await parseBillTextWithLLM(extractedText);
    console.log('[bill-upload] Bill parsed. Fields:', billData.extractedFields?.join(', ') || 'none');
    console.log('[bill-upload] Confidence:', billData.confidence, '| monthlyKwh:', billData.monthlyKwh, '| address:', billData.serviceAddress);

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
    const annualKwh = billData.estimatedAnnualKwh || 0;
    // Use utility-aware production factor for accurate sizing
    const productionFactor = getProductionFactor(utilityNameForRate);
    const systemSizeKw = annualKwh > 0
      ? Math.round((annualKwh / productionFactor) * 10) / 10
      : null;
    console.log(`[bill-upload] System size: ${systemSizeKw} kW for ${annualKwh} kWh/yr (factor: ${productionFactor})`);

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
        annualKwh,
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

// ── Image extraction ──────────────────────────────────────────────────────────
async function extractImageText(buffer: Buffer, mimeType: string): Promise<string> {
  const safeMime = mimeType.startsWith('image/') ? mimeType : 'image/jpeg';
  const openaiKey = process.env.OPENAI_API_KEY;
  const base64SizeKb = Math.round(buffer.length * 4 / 3 / 1024);
  console.log(`[bill-upload] extractImageText: mime=${safeMime}, buffer=${buffer.length}b, base64~${base64SizeKb}KB, hasOpenAI=${!!openaiKey}`);

  // 1. OpenAI Vision
  if (openaiKey) {
    try {
      const base64 = buffer.toString('base64');
      const dataUrl = `data:${safeMime};base64,${base64}`;
      console.log(`[bill-upload] Sending to OpenAI Vision: dataUrl length=${dataUrl.length}`);
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o',
          max_tokens: 2000,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: 'Extract ALL text from this utility bill image exactly as it appears. Pay special attention to: (1) any handwritten month lists like "Jan 555 kWh", (2) printed tables beneath "Monthly Usage Summary" or "Your Monthly Usage Summary(kWh)" showing month names with numeric columns, (3) any yearly total kWh. Output only the raw extracted text, preserving the table layout with month names and numbers on the same line.' },
              { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
            ],
          }],
        }),
        signal: AbortSignal.timeout(45000),
      });
      if (res.ok) {
        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content?.trim();
        if (text && text.length > 20) {
          console.log('[bill-upload] OpenAI Vision extracted', text.length, 'chars from image');
          return text;
        }
        console.warn('[bill-upload] OpenAI Vision returned empty/short text. finish_reason:', data?.choices?.[0]?.finish_reason, '| usage:', JSON.stringify(data?.usage));
        // Don't return '' here — fall through to Google Vision fallback
      } else {
        const errBody = await res.text();
        console.warn('[bill-upload] OpenAI Vision HTTP error:', res.status, errBody.slice(0, 400));
        // Store error for debug surfacing but continue to next method
        (extractImageText as any)._lastError = `OpenAI Vision ${res.status}: ${errBody.slice(0, 200)}`;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[bill-upload] OpenAI Vision failed:', msg);
      (extractImageText as any)._lastError = msg;
    }
  }

  // 2. Google Vision fallback
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
        if (text?.trim().length > 20) {
          console.log('[bill-upload] Google Vision extracted', text.length, 'chars from image');
          return text;
        }
      }
    } catch { /* ignore */ }
  }

  return '';
}

// ── System size ───────────────────────────────────────────────────────────────
function calculateRecommendedSystemSize(annualKwh: number, lat: number): number {
  const sunHours = lat < 25 ? 5.5 : lat < 30 ? 5.2 : lat < 35 ? 4.8 : lat < 40 ? 4.4 : lat < 45 ? 4.0 : 3.6;
  const kwhPerKwPerYear = sunHours * 365 * 0.80;
  return Math.round((annualKwh / kwhPerKwPerYear) * 10) / 10;
}