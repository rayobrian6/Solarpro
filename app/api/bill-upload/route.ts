import { NextRequest, NextResponse } from 'next/server';
import { parseBillText, parseBillTextWithLLM, validateBillData } from '@/lib/billOcr';
import { geocodeAddress } from '@/lib/locationEngine';
import { detectUtility } from '@/lib/utilityDetector';
import { getUserFromRequest } from '@/lib/auth';

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
      return NextResponse.json({
        success: false,
        error: 'Could not extract text from file. Please ensure the file is a clear, readable utility bill.',
        stage: extractionMethod,
      }, { status: 422 });
    }

    console.log(`[bill-upload] Extracted ${extractedText.length} chars via ${extractionMethod}`);

    const billData = await parseBillTextWithLLM(extractedText);
    const validation = validateBillData(billData);

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
            if (!billData.utilityProvider && utilityData?.utilityName) billData.utilityProvider = utilityData.utilityName;
            if (!billData.electricityRate && utilityData?.avgRatePerKwh) billData.electricityRate = utilityData.avgRatePerKwh;
          }
        }
      } catch (geoErr: unknown) {
        console.warn('[bill-upload] Geocoding failed:', geoErr instanceof Error ? geoErr.message : geoErr);
      }
    }

    const annualKwh = billData.estimatedAnnualKwh || 0;
    const systemSizeKw = annualKwh > 0 ? calculateRecommendedSystemSize(annualKwh, locationData?.lat || 35) : null;

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
        note: 'Based on 100% offset.',
      } : null,
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[bill-upload] Fatal error:', msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// ── PDF extraction ────────────────────────────────────────────────────────────
async function extractPdfText(buffer: Buffer): Promise<{ text: string; method: string }> {
  const openaiKey = process.env.OPENAI_API_KEY;

  // Method 1: OpenAI — upload PDF as file, use gpt-4o to extract text
  // This is the most reliable method on Vercel (no native deps)
  if (openaiKey) {
    console.log('[bill-upload] Trying OpenAI Files API...');
    try {
      const fd = new FormData();
      fd.append('file', new Blob([new Uint8Array(buffer)], { type: 'application/pdf' }), 'bill.pdf');
      fd.append('purpose', 'assistants');

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

        // Use responses API with input_file
        const chatRes = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openaiKey}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o',
            input: [{
              role: 'user',
              content: [
                { type: 'input_text', text: 'Extract ALL text from this utility bill PDF exactly as it appears. Preserve all numbers, addresses, dates, kWh values, and dollar amounts. Output only the raw extracted text.' },
                { type: 'input_file', file_id: fileId },
              ],
            }],
          }),
          signal: AbortSignal.timeout(30000),
        });

        // Cleanup file async
        fetch(`https://api.openai.com/v1/files/${fileId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${openaiKey}` },
        }).catch(() => {});

        if (chatRes.ok) {
          const chatData = await chatRes.json();
          const text = chatData?.output?.[0]?.content?.[0]?.text?.trim()
            ?? chatData?.choices?.[0]?.message?.content?.trim();
          if (text && text.length > 50) {
            console.log('[bill-upload] OpenAI Files API extracted', text.length, 'chars');
            return { text, method: 'openai-files' };
          }
          console.warn('[bill-upload] OpenAI Files API returned short text:', text?.length, 'chars');
          console.warn('[bill-upload] Response keys:', Object.keys(chatData).join(', '));
        } else {
          const errText = await chatRes.text();
          console.warn('[bill-upload] OpenAI responses API failed:', chatRes.status, errText.slice(0, 300));

          // Fallback: try chat/completions with file attachment
          console.log('[bill-upload] Trying chat/completions with file...');
          const chatRes2 = await fetch('https://api.openai.com/v1/chat/completions', {
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
                  { type: 'text', text: 'Extract ALL text from this utility bill PDF exactly as it appears. Output only the raw extracted text.' },
                  { type: 'file', file: { file_id: uploadData.id } },
                ],
              }],
            }),
            signal: AbortSignal.timeout(30000),
          });
          if (chatRes2.ok) {
            const chatData2 = await chatRes2.json();
            const text2 = chatData2?.choices?.[0]?.message?.content?.trim();
            if (text2 && text2.length > 50) {
              console.log('[bill-upload] chat/completions file extracted', text2.length, 'chars');
              return { text: text2, method: 'openai-chat-file' };
            }
          } else {
            const err2 = await chatRes2.text();
            console.warn('[bill-upload] chat/completions file failed:', chatRes2.status, err2.slice(0, 200));
          }
        }
      } else {
        const errText = await uploadRes.text();
        console.warn('[bill-upload] OpenAI file upload failed:', uploadRes.status, errText.slice(0, 200));
      }
    } catch (err: unknown) {
      console.warn('[bill-upload] OpenAI Files API error:', err instanceof Error ? err.message : err);
    }
  } else {
    console.warn('[bill-upload] No OPENAI_API_KEY — skipping OpenAI extraction');
  }

  // Method 2: pdf-parse (works locally, may fail on Vercel)
  console.log('[bill-upload] Trying pdf-parse, PDFParse loaded:', !!PDFParse);
  try {
    if (PDFParse) {
      const parser = new PDFParse({ data: buffer });
      await parser.load();
      const result = await parser.getText();
      const text = (result.text || '').trim();
      console.log('[bill-upload] pdf-parse extracted', text.length, 'chars');
      if (text.length > 50) return { text, method: 'pdf-parse' };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes('password') || msg.toLowerCase().includes('encrypt')) {
      throw new Error('PDF is password-protected. Please remove the password and re-upload.');
    }
    console.warn('[bill-upload] pdf-parse failed:', msg);
  }

  // Method 3: pdftotext CLI (local only)
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

  // 1. OpenAI Vision
  if (openaiKey) {
    try {
      const base64 = buffer.toString('base64');
      const dataUrl = `data:${safeMime};base64,${base64}`;
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o',
          max_tokens: 2000,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: 'Extract ALL text from this utility bill image exactly as it appears. Output only the raw extracted text.' },
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
          console.log('[bill-upload] OpenAI Vision extracted', text.length, 'chars from image');
          return text;
        }
      } else {
        const errBody = await res.text();
        console.warn('[bill-upload] OpenAI Vision error:', res.status, errBody.slice(0, 200));
      }
    } catch (err: unknown) {
      console.warn('[bill-upload] OpenAI Vision failed:', err instanceof Error ? err.message : err);
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