import { NextRequest, NextResponse } from 'next/server';
import { parseBillText, validateBillData } from '@/lib/billOcr';
import { geocodeAddress } from '@/lib/locationEngine';
import { detectUtility } from '@/lib/utilityDetector';
import { getUserFromRequest } from '@/lib/auth';

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

    if (file) {
      const fileType = file.type;
      const fileName = file.name.toLowerCase();
      const buffer = Buffer.from(await file.arrayBuffer());

      if (fileType === 'application/pdf' || fileName.endsWith('.pdf')) {
        extractedText = await extractPdfText(buffer);
      } else if (
        fileType.startsWith('image/') ||
        fileName.endsWith('.jpg') || fileName.endsWith('.jpeg') ||
        fileName.endsWith('.png') || fileName.endsWith('.jfif') ||
        fileName.endsWith('.webp')
      ) {
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
        hint: 'For best results: use a text-based PDF, or a clear photo of your bill with good lighting.',
      }, { status: 422 });
    }

    // Parse the extracted text
    const billData = parseBillText(extractedText);
    const validation = validateBillData(billData);

    // Geocode service address and detect utility
    let locationData = null;
    let utilityData = null;

    if (billData.serviceAddress) {
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

// ── PDF text extraction using pdf-parse (pure JS, works on Vercel) ───────────
async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    // Dynamic import to avoid issues with Next.js bundling
    // pdf-parse v2 exports PDFParse class (not a default function)
    const pdfParseModule = await import('pdf-parse');
    // Try v2 class-based API first, fall back to v1 default export
    const PDFParseClass = (pdfParseModule as any).PDFParse;
    if (PDFParseClass) {
      const parser = new PDFParseClass();
      const data = await parser.parse(buffer);
      return data.text || '';
    }
    // v1 fallback: default export is a function
    const pdfParseFn = (pdfParseModule as any).default || pdfParseModule;
    if (typeof pdfParseFn === 'function') {
      const data = await pdfParseFn(buffer, { max: 0 });
      return data.text || '';
    }
    throw new Error('pdf-parse: no usable export found');
  } catch (err: any) {
    console.error('[pdf-parse]', err.message);
    // Fallback: try pdftotext CLI (works in local/sandbox env)
    return extractPdfTextCli(buffer);
  }
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
        // Check for API errors
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