/**
 * app/api/debug/ocr/route.ts
 *
 * Debug endpoint for testing OCR in isolation.
 * Accepts a multipart file upload and returns:
 *   - file_size, mime_type
 *   - ocr_text_length, first_500_chars
 *   - which OCR method succeeded
 *   - full debug log
 *
 * POST /api/debug/ocr
 * Body: multipart/form-data with field "file"
 *
 * ⚠️  This endpoint is for internal debugging only.
 *     It is protected by auth — must be logged in to use.
 *     Do NOT expose to the public internet without auth.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const startMs = Date.now();

  // Auth check — must be logged in
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const debugLog: string[] = [];

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'No file provided. Send multipart/form-data with field "file".' },
        { status: 400 },
      );
    }

    const fileName = file.name?.toLowerCase() ?? '';
    const mimeType = file.type || 'application/octet-stream';
    const fileSize = file.size;

    debugLog.push(`[debug-ocr] file=${file.name} mime=${mimeType} size=${fileSize}`);

    // ── Read buffer ─────────────────────────────────────────────────────────
    const buffer = Buffer.from(await file.arrayBuffer());
    debugLog.push(`[debug-ocr] buffer_length=${buffer.length}`);

    if (buffer.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'File buffer is empty — upload may have failed',
        file_name: file.name,
        file_size: fileSize,
        mime_type: mimeType,
        buffer_length: 0,
        debugLog,
      }, { status: 422 });
    }

    // ── Determine file type ─────────────────────────────────────────────────
    const isPdf = mimeType === 'application/pdf' || fileName.endsWith('.pdf');
    const isImage =
      mimeType.startsWith('image/') ||
      fileName.endsWith('.jpg') || fileName.endsWith('.jpeg') ||
      fileName.endsWith('.png') || fileName.endsWith('.webp') ||
      fileName.endsWith('.jfif');

    debugLog.push(`[debug-ocr] isPdf=${isPdf} isImage=${isImage}`);

    let ocrText = '';
    let ocrMethod = 'none';
    let ocrConfidence = 0;

    if (isPdf) {
      // ── PDF path ──────────────────────────────────────────────────────────
      debugLog.push('[debug-ocr] Trying pdftotext CLI...');
      try {
        const { execFile } = await import('child_process');
        const { writeFile, readFile, unlink } = await import('fs/promises');
        const { join } = await import('path');
        const { tmpdir } = await import('os');
        const { promisify } = await import('util');
        const execFileAsync = promisify(execFile);

        const id = `debug_ocr_${Date.now()}`;
        const tmpPdf = join(tmpdir(), `${id}.pdf`);
        const tmpTxt = join(tmpdir(), `${id}.txt`);
        await writeFile(tmpPdf, buffer);

        try {
          await execFileAsync('pdftotext', ['-layout', tmpPdf, tmpTxt], { timeout: 15000 });
          const raw = await readFile(tmpTxt, 'utf-8');
          ocrText = raw.trim();
          ocrMethod = 'pdftotext';
          ocrConfidence = 90;
          debugLog.push(`[debug-ocr] pdftotext success: ${ocrText.length} chars`);
        } finally {
          for (const f of [tmpPdf, tmpTxt]) {
            try { await unlink(f); } catch { /* ignore */ }
          }
        }
      } catch (pdfErr: unknown) {
        const msg = pdfErr instanceof Error ? pdfErr.message : String(pdfErr);
        debugLog.push(`[debug-ocr] pdftotext failed: ${msg}`);
      }

      // pdf-parse fallback
      if (ocrText.length < 50) {
        debugLog.push('[debug-ocr] Trying pdf-parse...');
        try {
          const ppMod = require('pdf-parse') as any;
          const ppFn = typeof ppMod === 'function' ? ppMod
            : typeof ppMod?.PDFParse === 'function' ? ppMod.PDFParse
            : typeof ppMod?.default === 'function' ? ppMod.default
            : null;
          if (ppFn) {
            const result = await ppFn(buffer);
            const text = (result.text || '').trim();
            if (text.length > ocrText.length) {
              ocrText = text;
              ocrMethod = 'pdf-parse';
              ocrConfidence = 80;
              debugLog.push(`[debug-ocr] pdf-parse success: ${ocrText.length} chars`);
            }
          }
        } catch (ppErr: unknown) {
          const msg = ppErr instanceof Error ? ppErr.message : String(ppErr);
          debugLog.push(`[debug-ocr] pdf-parse failed: ${msg}`);
        }
      }

    } else if (isImage) {
      // ── Image path: Tesseract CLI ────────────────────────────────────────
      debugLog.push('[debug-ocr] Trying Tesseract CLI...');
      try {
        const { execFile } = await import('child_process');
        const { writeFile, readFile, unlink } = await import('fs/promises');
        const { join } = await import('path');
        const { tmpdir } = await import('os');
        const { promisify } = await import('util');
        const execFileAsync = promisify(execFile);

        // Check CLI available
        await execFileAsync('tesseract', ['--version'], { timeout: 3000 });

        const id = `debug_ocr_${Date.now()}`;
        const ext = mimeType.includes('png') ? 'png' : 'jpg';
        const tmpImg = join(tmpdir(), `${id}.${ext}`);
        const tmpBase = join(tmpdir(), id);

        await writeFile(tmpImg, buffer);
        try {
          await execFileAsync(
            'tesseract',
            [tmpImg, tmpBase, '-l', 'eng', '--psm', '3', '--oem', '3'],
            { timeout: 30000 },
          );
          const raw = await readFile(`${tmpBase}.txt`, 'utf-8');
          ocrText = raw.trim();
          ocrMethod = 'tesseract-cli';
          const wordCount = ocrText.split(/\s+/).filter(w => w.length > 2).length;
          ocrConfidence = wordCount > 100 ? 85 : wordCount > 50 ? 80 : wordCount > 20 ? 70 : 50;
          debugLog.push(`[debug-ocr] tesseract CLI success: ${ocrText.length} chars confidence=${ocrConfidence}`);
        } finally {
          for (const f of [tmpImg, `${tmpBase}.txt`]) {
            try { await unlink(f); } catch { /* ignore */ }
          }
        }
      } catch (cliErr: unknown) {
        const msg = cliErr instanceof Error ? cliErr.message : String(cliErr);
        debugLog.push(`[debug-ocr] tesseract CLI failed: ${msg}`);
      }

      // OpenAI Vision fallback
      if (ocrText.length < 20 && process.env.OPENAI_API_KEY) {
        debugLog.push('[debug-ocr] Trying OpenAI Vision...');
        try {
          const safeMime = mimeType.startsWith('image/') ? mimeType : 'image/jpeg';
          const base64 = buffer.toString('base64');
          const dataUrl = `data:${safeMime};base64,${base64}`;

          const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
              model: 'gpt-4o',
              max_tokens: 2000,
              messages: [{
                role: 'user',
                content: [
                  { type: 'text', text: 'Extract ALL text from this utility bill image. Output only raw extracted text.' },
                  { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
                ],
              }],
            }),
            signal: AbortSignal.timeout(30000),
          });

          if (res.ok) {
            const json = await res.json();
            const text = json?.choices?.[0]?.message?.content?.trim() ?? '';
            if (text.length > ocrText.length) {
              ocrText = text;
              ocrMethod = 'openai-vision';
              ocrConfidence = 85;
              debugLog.push(`[debug-ocr] OpenAI Vision success: ${ocrText.length} chars`);
            }
          } else {
            debugLog.push(`[debug-ocr] OpenAI Vision HTTP ${res.status}`);
          }
        } catch (vErr: unknown) {
          const msg = vErr instanceof Error ? vErr.message : String(vErr);
          debugLog.push(`[debug-ocr] OpenAI Vision failed: ${msg}`);
        }
      } else if (ocrText.length < 20) {
        debugLog.push('[debug-ocr] OpenAI Vision skipped — OPENAI_API_KEY not set');
      }

    } else {
      debugLog.push(`[debug-ocr] Unsupported file type: ${mimeType}`);
    }

    const elapsedMs = Date.now() - startMs;
    debugLog.push(`[debug-ocr] Done in ${elapsedMs}ms method=${ocrMethod} chars=${ocrText.length}`);

    console.log(`[DEBUG_OCR] file=${file.name} mime=${mimeType} size=${fileSize} method=${ocrMethod} chars=${ocrText.length} elapsed=${elapsedMs}ms`);

    return NextResponse.json({
      success: ocrText.length > 0,
      file_name: file.name,
      file_size: fileSize,
      mime_type: mimeType,
      buffer_length: buffer.length,
      ocr_method: ocrMethod,
      ocr_confidence: ocrConfidence,
      ocr_text_length: ocrText.length,
      first_500_chars: ocrText.slice(0, 500),
      elapsed_ms: elapsedMs,
      env: {
        hasOpenAI: !!process.env.OPENAI_API_KEY,
        hasGoogleVision: !!(process.env.GOOGLE_VISION_API_KEY || process.env.GOOGLE_MAPS_API_KEY),
        hasTesseractCli: null, // checked above in log
      },
      debugLog,
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[DEBUG_OCR] Fatal error:', msg);
    debugLog.push(`[debug-ocr] FATAL: ${msg}`);
    return NextResponse.json(
      { success: false, error: msg, debugLog },
      { status: 500 },
    );
  }
}