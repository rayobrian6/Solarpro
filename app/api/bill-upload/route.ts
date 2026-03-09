import { NextRequest, NextResponse } from 'next/server';
import { parseBillText, parseBillTextWithLLM, validateBillData } from '@/lib/billOcr';
import { geocodeAddress } from '@/lib/locationEngine';
import { detectUtility } from '@/lib/utilityDetector';
import { getUserFromRequest } from '@/lib/auth';

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
    let extractionStage = 'text';

    if (file) {
      // ── Client-side size guard (server-side enforcement) ──
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
        extractionStage = 'pdf';
        extractedText = await extractPdfText(buffer);
      } else if (
        fileType.startsWith('image/') ||
        fileName.endsWith('.jpg') || fileName.endsWith('.jpeg') ||
        fileName.endsWith('.png') || fileName.endsWith('.jfif') ||
        fileName.endsWith('.webp')
      ) {
        extractionStage = 'image';
        extractedText = await extractImageText(buffer, fileType || 'image/jpeg');
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
        hint: extractionStage === 'image'
          ? 'For best results: take a clear photo in good lighting, or use a PDF from your utility portal.'
          : 'For best results: use a text-based PDF downloaded from your utility portal, not a scanned copy.',
        stage: extractionStage,
      }, { status: 422 });
    }

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
      } catch (geoErr: any) {
        console.warn('[bill-upload] Geocoding failed:', geoErr.message);
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
      systemSizing: systemSizeKw ? {
        recommendedKw: systemSizeKw,
        annualKwh,
        offsetPercent: 100,
        note: 'Based on 100% offset. Adjust offset percentage as needed.',
      } : null,
    });

  } catch (err: any) {
    console.error('[bill-upload]', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// ── PDF text extraction ──────────────────────────────────────────────────────
async function extractPdfText(buffer: Buffer): Promise<string> {
  let text = '';

  // Step 1: Try pdf-parse (handles text-based PDFs — works on Vercel)
  try {
    const pdfParseModule = await import('pdf-parse');
    const PDFParseClass = (pdfParseModule as any).PDFParse;
    if (PDFParseClass) {
      const parser = new PDFParseClass();
      const data = await parser.parse(buffer);
      text = data.text || '';
    } else {
      const pdfParseFn = (pdfParseModule as any).default || pdfParseModule;
      if (typeof pdfParseFn === 'function') {
        const data = await pdfParseFn(buffer, { max: 0 });
        text = data.text || '';
      }
    }
  } catch (err: any) {
    // Detect password-protected PDF
    if (err.message?.toLowerCase().includes('password') || err.message?.toLowerCase().includes('encrypt')) {
      throw new Error('PDF is password-protected. Please remove the password and re-upload.');
    }
    console.warn('[pdf-parse] Error:', err.message);
  }

  // Step 2: If text is sparse (<50 meaningful chars), it's likely a scanned PDF
  // Route through Google Vision for OCR
  if (text.trim().length < 50) {
    console.log('[bill-upload] Sparse PDF text detected — attempting Vision OCR on PDF');
    const visionText = await extractScannedPdfViaVision(buffer);
    if (visionText.trim().length > text.trim().length) {
      text = visionText;
    }
  }

  // Step 3: Local CLI fallback (sandbox/dev only — not available on Vercel)
  if (!text.trim()) {
    text = await extractPdfTextCli(buffer);
  }

  return text;
}

// ── Scanned PDF → Vision API (convert first page to image via base64 embed) ──
async function extractScannedPdfViaVision(buffer: Buffer): Promise<string> {
  // Try pdf2pic if installed (optional dependency)
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pdf2picModule = require('pdf2pic');
    const fromBuffer = pdf2picModule.fromBuffer || pdf2picModule.default?.fromBuffer;
    if (!fromBuffer) throw new Error('pdf2pic not available');
    const converter = fromBuffer(buffer, {
      density: 200,
      format: 'png',
      width: 1700,
      height: 2200,
    });
    const page = await converter(1, { responseType: 'buffer' });
    if (page && (page as any).buffer) {
      return await extractImageText((page as any).buffer as Buffer, 'image/png');
    }
  } catch {
    // pdf2pic not installed — fall through
  }

  // Fallback: send raw PDF bytes to Vision (Vision can handle PDF directly)
  const googleKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!googleKey) return '';

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
        signal: AbortSignal.timeout(25000),
      }
    );
    if (res.ok) {
      const data = await res.json();
      const text = data?.responses?.[0]?.fullTextAnnotation?.text;
      if (text?.trim().length > 20) {
        console.log('[bill-upload] Vision OCR on PDF extracted', text.length, 'chars');
        return text;
      }
    }
  } catch (err: any) {
    console.warn('[bill-upload] Vision PDF OCR failed:', err.message);
  }
  return '';
}

// ── PDF CLI fallback (local/sandbox only) ────────────────────────────────────
async function extractPdfTextCli(buffer: Buffer): Promise<string> {
  try {
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
  } catch {
    return '';
  }
}

// ── Image text extraction: Google Vision API → Tesseract CLI fallback ────────
async function extractImageText(buffer: Buffer, mimeType: string): Promise<string> {
  // 1. Try Google Cloud Vision API (uses same Google API key)
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
        if (error) {
          console.warn('[bill-upload] Google Vision error:', error.message);
        }
      }
    } catch (err: any) {
      console.warn('[bill-upload] Google Vision failed:', err.message);
    }
  }

  // 2. Fallback: Tesseract CLI (works in local/sandbox, not Vercel)
  try {
    const { execSync } = await import('child_process');
    const { writeFileSync, readFileSync, unlinkSync } = await import('fs');
    const { tmpdir } = await import('os');
    const { join } = await import('path');
    const ext = mimeType.includes('png') ? 'png' : 'jpg';
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