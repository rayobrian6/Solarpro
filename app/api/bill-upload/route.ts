import { NextRequest, NextResponse } from 'next/server';
import { parseBillText, validateBillData } from '@/lib/billOcr';
import { geocodeAddress } from '@/lib/locationEngine';
import { detectUtility } from '@/lib/utilityDetector';
import { getUserFromRequest } from '@/lib/auth';

// POST /api/bill-upload — upload utility bill PDF/JPG/PNG and extract data via OCR
export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const rawText = formData.get('text') as string | null; // allow direct text for testing

    if (!file && !rawText) {
      return NextResponse.json({ success: false, error: 'No file or text provided' }, { status: 400 });
    }

    let extractedText = rawText || '';

    if (file) {
      const fileType = file.type;
      const fileName = file.name.toLowerCase();

      // For PDF files — use pdftotext via system call
      if (fileType === 'application/pdf' || fileName.endsWith('.pdf')) {
        const buffer = Buffer.from(await file.arrayBuffer());
        extractedText = await extractPdfText(buffer);
      }
      // For images — use basic OCR approach (Tesseract if available, else return guidance)
      else if (
        fileType.startsWith('image/') ||
        fileName.endsWith('.jpg') || fileName.endsWith('.jpeg') ||
        fileName.endsWith('.png')
      ) {
        const buffer = Buffer.from(await file.arrayBuffer());
        extractedText = await extractImageText(buffer, fileType);
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
        error: 'Could not extract text from file. Please ensure the file is readable.',
        hint: 'Try uploading a text-based PDF or a clear image of your bill.',
      }, { status: 422 });
    }

    // Parse the extracted text
    const billData = parseBillText(extractedText);
    const validation = validateBillData(billData);

    // If we have a service address, geocode it and detect utility
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
          // Override utility name if URDB found a better match
          if (!billData.utilityProvider && utilityData?.utilityName) {
            billData.utilityProvider = utilityData.utilityName;
          }
          // Override rate if not extracted from bill
          if (!billData.electricityRate && utilityData?.avgRatePerKwh) {
            billData.electricityRate = utilityData.avgRatePerKwh;
          }
        }
      }
    }

    // Calculate system sizing recommendation
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

// ── PDF text extraction using pdftotext ───────────────────────────────────────
async function extractPdfText(buffer: Buffer): Promise<string> {
  const { execSync } = await import('child_process');
  const { writeFileSync, readFileSync, unlinkSync } = await import('fs');
  const { tmpdir } = await import('os');
  const { join } = await import('path');

  const tmpIn = join(tmpdir(), `bill_${Date.now()}.pdf`);
  const tmpOut = join(tmpdir(), `bill_${Date.now()}.txt`);

  try {
    writeFileSync(tmpIn, buffer);
    execSync(`pdftotext -layout "${tmpIn}" "${tmpOut}"`, { timeout: 15000 });
    const text = readFileSync(tmpOut, 'utf-8');
    return text;
  } catch (err: any) {
    console.error('[pdf extract]', err.message);
    return '';
  } finally {
    try { unlinkSync(tmpIn); } catch {}
    try { unlinkSync(tmpOut); } catch {}
  }
}

// ── Image text extraction using Tesseract OCR ─────────────────────────────────
async function extractImageText(buffer: Buffer, mimeType: string): Promise<string> {
  const { execSync } = await import('child_process');
  const { writeFileSync, readFileSync, unlinkSync } = await import('fs');
  const { tmpdir } = await import('os');
  const { join } = await import('path');

  const ext = mimeType.includes('png') ? 'png' : 'jpg';
  const tmpIn = join(tmpdir(), `bill_${Date.now()}.${ext}`);
  const tmpOut = join(tmpdir(), `bill_${Date.now()}`);

  try {
    writeFileSync(tmpIn, buffer);
    // Try tesseract OCR
    execSync(`tesseract "${tmpIn}" "${tmpOut}" -l eng --psm 6`, { timeout: 30000 });
    const text = readFileSync(`${tmpOut}.txt`, 'utf-8');
    return text;
  } catch {
    // Tesseract not available — return empty (will be handled gracefully)
    return '';
  } finally {
    try { unlinkSync(tmpIn); } catch {}
    try { unlinkSync(`${tmpOut}.txt`); } catch {}
  }
}

// ── System size recommendation ────────────────────────────────────────────────
function calculateRecommendedSystemSize(annualKwh: number, lat: number): number {
  // Sun hours by latitude (simplified)
  const sunHours = lat < 25 ? 5.5 : lat < 30 ? 5.2 : lat < 35 ? 4.8 :
                   lat < 40 ? 4.4 : lat < 45 ? 4.0 : 3.6;
  // System efficiency factor (inverter + wiring + temp losses)
  const systemEfficiency = 0.80;
  // kWh per kW per year
  const kwhPerKwPerYear = sunHours * 365 * systemEfficiency;
  // Required kW for 100% offset
  const requiredKw = annualKwh / kwhPerKwPerYear;
  // Round to nearest 0.1 kW
  return Math.round(requiredKw * 10) / 10;
}