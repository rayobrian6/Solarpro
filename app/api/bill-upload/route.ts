import { NextRequest, NextResponse } from 'next/server';
import { parseBillText, parseBillTextWithLLM, validateBillData } from '@/lib/billOcr';
import { geocodeAddress } from '@/lib/locationEngine';
import { detectUtility } from '@/lib/utilityDetector';
import { getUserFromRequest } from '@/lib/auth';

// Top-level reference so webpack marks pdf-parse as external (not bundled)
// Wrapped in try/catch so a missing native dep doesn't crash the module on cold start
// eslint-disable-next-line @typescript-eslint/no-var-requires
let PDFParse: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pdfParseModule = require('pdf-parse');
  PDFParse = pdfParseModule.PDFParse ?? pdfParseModule.default?.PDFParse ?? null;
} catch (e) {
  console.warn('[bill-upload] pdf-parse not available at module load:', e instanceof Error ? e.message : e);
}

// Vercel: allow up to 30s for OCR + geocoding on large files
export const maxDuration = 30;

// POST /api/bill-upload — upload utility bill PDF/JPG/PNG and extract data
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
      // ── Server-side size guard ──
      const MAX_SIZE = 10 * 1024 * 1024; // 10MB
      if (file.size > MAX_SIZE) {
        return NextResponse.json({
          success: false,
          error: 'File too large. Maximum size is 10MB. Please compress or re-scan your bill.',
        }, { status: 413 });
      }

      const fileType = file.type;
      const fileName = file.name.toLowerCase();
      const buffer = Buffer.from(await file.arrayBuffer());

      if (fileType === 'application/pdf' || fileName.endsWith('.pdf')) {
        const result = await extractPdfText(buffer);
        extractedText = result.text;
        extractionMethod = result.method;
      } else if (
        fileType.startsWith('image/') ||
        fileName.endsWith('.jpg') || fileName.endsWith('.jpeg') ||
        fileName.endsWith('.png') || fileName.endsWith('.jfif') ||
        fileName.endsWith('.webp')
      ) {
        extractedText = await extractImageText(buffer, fileType || 'image/jpeg');
        extractionMethod = 'image-vision';
      } else {
        return NextResponse.json({
          success: false,
          error: 'Unsupported file type. Please upload PDF, JPG, or PNG.',
        }, { status: 400 });
      }
    }

    if (!extractedText.trim()) {
      return NextResponse.json({
        success: false,
        error: 'Could not extract text from file. Please ensure the file is a clear, readable utility bill.',
        hint: extractionMethod.includes('image')
          ? 'For best results: take a clear photo in good lighting, or use a PDF from your utility portal.'
          : 'For best results: use a text-based PDF downloaded from your utility portal, not a scanned copy.',
        stage: extractionMethod,
      }, { status: 422 });
    }

    console.log(`[bill-upload] Extracted ${extractedText.length} chars via ${extractionMethod}`);

    // ── Parse the extracted text (with LLM fallback) ──
    const billData = await parseBillTextWithLLM(extractedText);
    const validation = validateBillData(billData);

    // ── Geocode service address and detect utility ──
    let locationData = null;
    let utilityData = null;

    if (billData.serviceAddress) {
      try {
        const geoResult = await geocodeAddress(billData.serviceAddress);
        if (geoResult.success && geoResult.location) {
          locationData = geoResult.location;
          const utilityResult = await detectUtility(
            geoResult.location.lat,
            geoResult.location.lng,
            geoResult.location.stateCode,
            geoResult.location.city,
          );
          if (utilityResult.success) {
            utilityData = utilityResult.utility;
            if (!billData.utilityProvider && utilityData?.utilityName) {
              billData.utilityProvider = utilityData.utilityName;
            }
            if (!billData.electricityRate && utilityData?.avgRatePerKwh) {
              billData.electricityRate = utilityData.avgRatePerKwh;
            }
          }
        }
      } catch (geoErr: unknown) {
        console.warn('[bill-upload] Geocoding failed:', geoErr instanceof Error ? geoErr.message : geoErr);
        // Non-fatal — continue without location data
      }
    }

    const annualKwh = billData.estimatedAnnualKwh || 0;
    const systemSizeKw = annualKwh > 0
      ? calculateRecommendedSystemSize(annualKwh, locationData?.lat || 35)
      : null;

    return NextResponse.json({
      success: true,
      billData,
      validation,
      locationData,
      utilityData,
      extractionMethod,
      systemSizing: systemSizeKw ? {
        recommendedKw: systemSizeKw,
        annualKwh,
        offsetPercent: 100,
        note: 'Based on 100% offset. Adjust offset percentage as needed.',
      } : null,
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[bill-upload]', msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// ── PDF text extraction ──────────────────────────────────────────────────────
async function extractPdfText(buffer: Buffer): Promise<{ text: string; method: string }> {
  // Method 1: pdf-parse v2 (top-level import — properly externalized by webpack on Vercel)
  try {
    if (PDFParse) {
      const parser = new PDFParse({ data: buffer });
      await parser.load();
      const result = await parser.getText();
      const text = (result.text || '').trim();
      console.log('[bill-upload] pdf-parse extracted', text.length, 'chars');
      // Accept any meaningful content (>50 chars)
      if (text.length > 50) {
        return { text, method: 'pdf-parse' };
      }
      console.log('[bill-upload] pdf-parse got sparse text — trying fallbacks');
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes('password') || msg.toLowerCase().includes('encrypt')) {
      throw new Error('PDF is password-protected. Please remove the password and re-upload.');
    }
    console.warn('[bill-upload] pdf-parse failed:', msg);
  }

  // Method 2: pdftotext CLI (available in sandbox/dev, NOT on Vercel)
  try {
    const cliText = await extractPdfTextCli(buffer);
    if (cliText.trim().length > 100) {
      console.log('[bill-upload] pdftotext extracted', cliText.length, 'chars');
      return { text: cliText, method: 'pdftotext' };
    }
  } catch {
    // not available
  }

  // Method 3: Google Vision API — convert PDF to image first via base64
  // Vision can handle PDF pages when sent as application/pdf
  const visionText = await extractPdfViaVision(buffer);
  if (visionText.trim().length > 50) {
    console.log('[bill-upload] Vision OCR extracted', visionText.length, 'chars from PDF');
    return { text: visionText, method: 'vision-pdf' };
  }

  // Method 4: Return whatever sparse text we got rather than nothing
  // Re-run pdf-parse and return even sparse results
  try {
    if (PDFParse) {
      const parser = new PDFParse({ data: buffer });
      await parser.load();
      const result = await parser.getText();
      const text = (result.text || '').trim();
      if (text.length > 0) {
        return { text, method: 'pdf-parse-sparse' };
      }
    }
  } catch { /* ignore */ }

  return { text: '', method: 'failed' };
}

// ── PDF CLI fallback (local/sandbox only) ────────────────────────────────────
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

// ── PDF → Vision API (sends raw PDF bytes, Vision handles first page) ────────
async function extractPdfViaVision(buffer: Buffer): Promise<string> {
  // Try pdf2pic to convert PDF page to image first
  let imageBuffer: Buffer | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pdf2picModule = require('pdf2pic');
    const fromBuffer = pdf2picModule.fromBuffer || pdf2picModule.default?.fromBuffer;
    if (fromBuffer) {
      const converter = fromBuffer(buffer, { density: 200, format: 'png', width: 1700, height: 2200 });
      const page = await converter(1, { responseType: 'buffer' });
      if (page && (page as { buffer?: Buffer }).buffer) {
        imageBuffer = (page as { buffer: Buffer }).buffer;
      }
    }
  } catch { /* pdf2pic not available on Vercel */ }

  // 1. OpenAI Vision — primary (works with both image/png and application/pdf)
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    try {
      const base64 = (imageBuffer || buffer).toString('base64');
      const mimeType = imageBuffer ? 'image/png' : 'application/pdf';
      const dataUrl = `data:${mimeType};base64,${base64}`;
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          max_tokens: 2000,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'This is a utility bill. Please extract ALL text from it exactly as it appears, preserving numbers, addresses, dates, and dollar amounts. Output only the raw extracted text, no commentary.',
              },
              { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
            ],
          }],
        }),
        signal: AbortSignal.timeout(25000),
      });
      if (res.ok) {
        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content?.trim();
        if (text && text.length > 20) {
          console.log('[bill-upload] OpenAI Vision (PDF) extracted', text.length, 'chars');
          return text;
        }
      }
    } catch (err: unknown) {
      console.warn('[bill-upload] OpenAI Vision PDF failed:', err instanceof Error ? err.message : err);
    }
  }

  // 2. Google Vision fallback
  const googleKey = process.env.GOOGLE_MAPS_API_KEY;
  if (googleKey) {
    try {
      const base64 = (imageBuffer || buffer).toString('base64');
      const mimeType = imageBuffer ? 'image/png' : 'application/pdf';
      const body = {
        requests: [{
          image: { content: base64 },
          features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }],
          imageContext: { languageHints: ['en'] },
        }],
      };
      const res = await fetch(
        `https://vision.googleapis.com/v1/images:annotate?key=${googleKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(25000),
        }
      );
      if (res.ok) {
        const data = await res.json();
        const text = data?.responses?.[0]?.fullTextAnnotation?.text;
        if (text?.trim().length > 20) return text;
        const error = data?.responses?.[0]?.error;
        if (error) console.warn('[bill-upload] Google Vision error:', error.message, 'mime:', mimeType);
      }
    } catch (err: unknown) {
      console.warn('[bill-upload] Google Vision PDF OCR failed:', err instanceof Error ? err.message : err);
    }
  }

  return '';
}

// ── Image text extraction: Google Vision API → Tesseract CLI fallback ────────
async function extractImageText(buffer: Buffer, mimeType: string): Promise<string> {
  // Normalize mime type for base64 data URL
  const safeMime = mimeType.startsWith('image/') ? mimeType : 'image/jpeg';

  // 1. OpenAI Vision (GPT-4o) — most reliable for utility bills
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    try {
      const base64 = buffer.toString('base64');
      const dataUrl = `data:${safeMime};base64,${base64}`;
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          max_tokens: 2000,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'This is a utility bill image. Please extract ALL text from it exactly as it appears, preserving numbers, addresses, dates, and dollar amounts. Output only the raw extracted text, no commentary.',
              },
              { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
            ],
          }],
        }),
        signal: AbortSignal.timeout(25000),
      });
      if (res.ok) {
        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content?.trim();
        if (text && text.length > 20) {
          console.log('[bill-upload] OpenAI Vision extracted', text.length, 'chars');
          return text;
        }
      } else {
        const errBody = await res.text();
        console.warn('[bill-upload] OpenAI Vision HTTP error:', res.status, errBody.slice(0, 200));
      }
    } catch (err: unknown) {
      console.warn('[bill-upload] OpenAI Vision failed:', err instanceof Error ? err.message : err);
    }
  }

  // 2. Google Cloud Vision API fallback (requires Vision API enabled on the key)
  const googleKey = process.env.GOOGLE_MAPS_API_KEY;
  if (googleKey) {
    try {
      const base64 = buffer.toString('base64');
      const body = {
        requests: [{
          image: { content: base64 },
          features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }],
          imageContext: { languageHints: ['en'] },
        }],
      };
      const res = await fetch(
        `https://vision.googleapis.com/v1/images:annotate?key=${googleKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(20000),
        }
      );
      if (res.ok) {
        const data = await res.json();
        const text = data?.responses?.[0]?.fullTextAnnotation?.text;
        if (text && text.trim().length > 20) {
          console.log('[bill-upload] Google Vision extracted', text.length, 'chars');
          return text;
        }
        const error = data?.responses?.[0]?.error;
        if (error) console.warn('[bill-upload] Google Vision error:', error.message);
      }
    } catch (err: unknown) {
      console.warn('[bill-upload] Google Vision failed:', err instanceof Error ? err.message : err);
    }
  }

  // 3. Tesseract CLI fallback (local/sandbox only — not available on Vercel)
  try {
    const { execSync } = await import('child_process');
    const { writeFileSync, readFileSync, unlinkSync } = await import('fs');
    const { tmpdir } = await import('os');
    const { join } = await import('path');
    const ext = safeMime.includes('png') ? 'png' : 'jpg';
    const tmpIn = join(tmpdir(), `bill_${Date.now()}.${ext}`);
    const tmpOut = join(tmpdir(), `bill_${Date.now()}`);
    writeFileSync(tmpIn, buffer);
    execSync(`tesseract "${tmpIn}" "${tmpOut}" -l eng --psm 6`, { timeout: 30000 });
    const text = readFileSync(`${tmpOut}.txt`, 'utf-8');
    try { unlinkSync(tmpIn); } catch {}
    try { unlinkSync(`${tmpOut}.txt`); } catch {}
    if (text.trim()) return text;
  } catch { /* not available */ }

  return '';
}

// ── System size recommendation ────────────────────────────────────────────────
function calculateRecommendedSystemSize(annualKwh: number, lat: number): number {
  const sunHours = lat < 25 ? 5.5 : lat < 30 ? 5.2 : lat < 35 ? 4.8 :
                   lat < 40 ? 4.4 : lat < 45 ? 4.0 : 3.6;
  const systemEfficiency = 0.80;
  const kwhPerKwPerYear = sunHours * 365 * systemEfficiency;
  const requiredKw = annualKwh / kwhPerKwPerYear;
  return Math.round(requiredKw * 10) / 10;
}