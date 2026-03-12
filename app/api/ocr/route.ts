/**
 * app/api/ocr/route.ts
 * Dedicated server-side OCR endpoint using Tesseract.js.
 *
 * WHY A SEPARATE ROUTE?
 * Tesseract.js uses worker_threads internally. When imported in a Next.js
 * route, webpack tries to statically bundle worker_threads and crashes the
 * entire module before any handler runs — returning HTML 500 instead of JSON.
 *
 * By isolating Tesseract in its own route file and declaring it in
 * serverComponentsExternalPackages, Next.js tells webpack to skip it entirely.
 * Node.js loads it natively at runtime — zero bundling issues.
 *
 * This route is called internally by bill-upload/route.ts — not by the browser.
 *
 * POST /api/ocr
 * Body: { imageBase64: string, mimeType: string }
 * Returns: { success: true, text: string, confidence: number, method: string }
 *       OR { success: false, error: string }
 */

import { NextRequest, NextResponse } from 'next/server';

// This directive tells Next.js to use the Node.js runtime (not Edge).
// Required for worker_threads / child_process / filesystem access.
export const runtime = 'nodejs';

// Max duration: 60s for OCR on large high-res bill images
export const maxDuration = 60;

// ── OCR confidence thresholds ────────────────────────────────────────────────
// Tesseract returns 0–100. Below 40 = likely garbage output.
const MIN_USABLE_CONFIDENCE = 40;

// ── POST handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { imageBase64, mimeType } = body as {
      imageBase64?: string;
      mimeType?: string;
    };

    if (!imageBase64) {
      return NextResponse.json(
        { success: false, error: 'Missing imageBase64' },
        { status: 400 },
      );
    }

    const safeMime = (mimeType ?? 'image/jpeg').startsWith('image/')
      ? (mimeType ?? 'image/jpeg')
      : 'image/jpeg';

    const buffer = Buffer.from(imageBase64, 'base64');
    console.log(`[ocr] Request: mime=${safeMime}, buffer=${buffer.length}b`);

    // ── Run Tesseract ──────────────────────────────────────────────────────
    const result = await runTesseract(buffer, safeMime);

    console.log(`[ocr] Result: method=${result.method}, confidence=${result.confidence}, chars=${result.text.length}`);
    if (result.text.length > 0) {
      console.log(`[ocr] Preview: ${result.text.slice(0, 150).replace(/\n/g, '↵')}`);
    }

    return NextResponse.json({
      success: result.confidence >= MIN_USABLE_CONFIDENCE || result.text.length > 50,
      text: result.text,
      confidence: result.confidence,
      method: result.method,
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[ocr] Fatal error:', msg);
    return NextResponse.json(
      { success: false, error: msg, text: '', confidence: 0 },
      { status: 500 },
    );
  }
}

// ── Tesseract runner ─────────────────────────────────────────────────────────
interface TesseractResult {
  text: string;
  confidence: number;
  method: 'tesseract-js' | 'tesseract-cli' | 'none';
  error?: string;
}

async function runTesseract(buffer: Buffer, mimeType: string): Promise<TesseractResult> {
  // Try Tesseract.js (npm package, WASM-based, works on any OS without install)
  const jsResult = await tryTesseractJs(buffer, mimeType);
  if (jsResult.text.length > 30) {
    return jsResult;
  }

  // Fallback: Tesseract CLI binary (faster, requires OS-level install)
  console.log('[ocr] Tesseract.js returned little text — trying CLI fallback');
  const cliResult = await tryTesseractCli(buffer, mimeType);
  if (cliResult.text.length > 30) {
    return cliResult;
  }

  // Both failed
  console.warn('[ocr] All Tesseract methods failed or returned empty text');
  return {
    text: jsResult.text || cliResult.text,
    confidence: Math.max(jsResult.confidence, cliResult.confidence),
    method: 'none',
    error: jsResult.error || cliResult.error || 'No text extracted',
  };
}

// ── Tesseract.js (WASM — no install required) ────────────────────────────────
async function tryTesseractJs(buffer: Buffer, mimeType: string): Promise<TesseractResult> {
  console.log('[ocr] Trying Tesseract.js (WASM)...');
  try {
    // require() instead of import — keeps webpack from statically analyzing this
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createWorker } = require('tesseract.js');

    const worker = await createWorker('eng', 1, {
      // Cache traineddata in /tmp — persists across warm Lambda/serverless invocations
      cachePath: '/tmp/tesseract-cache',
      // Suppress verbose progress logs in production
      logger: (m: any) => {
        if (m.status === 'recognizing text') {
          // Only log recognition progress at key points
          if (m.progress === 0 || m.progress === 1) {
            console.log(`[ocr] Tesseract.js: ${m.status} (${Math.round(m.progress * 100)}%)`);
          }
        }
      },
    });

    try {
      // Convert buffer to data URL for Tesseract
      const safeMime = mimeType.startsWith('image/') ? mimeType : 'image/jpeg';
      const dataUrl = `data:${safeMime};base64,${buffer.toString('base64')}`;

      const { data } = await worker.recognize(dataUrl);

      const rawText: string = data.text ?? '';
      const confidence: number = Math.round(data.confidence ?? 0);

      console.log(`[ocr] Tesseract.js: confidence=${confidence}, chars=${rawText.length}`);

      // Normalise common OCR errors on utility bills
      const normalisedText = normaliseOcrText(rawText);

      return { text: normalisedText, confidence, method: 'tesseract-js' };

    } finally {
      try { await worker.terminate(); } catch { /* ignore cleanup errors */ }
    }

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[ocr] Tesseract.js failed:', msg);
    return { text: '', confidence: 0, method: 'none', error: msg };
  }
}

// ── Tesseract CLI (binary — optional, faster on systems where installed) ──────
async function tryTesseractCli(buffer: Buffer, mimeType: string): Promise<TesseractResult> {
  console.log('[ocr] Trying Tesseract CLI...');
  try {
    const { execFile } = await import('child_process');
    const { writeFile, readFile, unlink } = await import('fs/promises');
    const { join } = await import('path');
    const { tmpdir } = await import('os');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);

    const ext = mimeType.includes('png') ? 'png' : 'jpg';
    const id = `ocr_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const tmpImg = join(tmpdir(), `${id}.${ext}`);
    const tmpBase = join(tmpdir(), id);

    await writeFile(tmpImg, buffer);

    try {
      await execFileAsync('tesseract', [tmpImg, tmpBase, '-l', 'eng', '--psm', '3', '--oem', '3'], {
        timeout: 25000,
      });

      const rawText = await readFile(`${tmpBase}.txt`, 'utf-8');
      const normalisedText = normaliseOcrText(rawText);

      // Estimate confidence from word count (CLI doesn't emit numeric confidence)
      const wordCount = normalisedText.trim().split(/\s+/).filter(w => w.length > 2).length;
      const confidence = wordCount > 50 ? 82 : wordCount > 20 ? 70 : wordCount > 5 ? 55 : 25;

      console.log(`[ocr] Tesseract CLI: chars=${normalisedText.length}, words=${wordCount}, est.confidence=${confidence}`);
      return { text: normalisedText, confidence, method: 'tesseract-cli' };

    } finally {
      for (const f of [tmpImg, `${tmpBase}.txt`]) {
        try { await unlink(f); } catch { /* ignore */ }
      }
    }

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Don't warn if it's just "tesseract: command not found" — that's expected on cloud
    if (!msg.includes('ENOENT') && !msg.includes('not found')) {
      console.warn('[ocr] Tesseract CLI failed:', msg);
    } else {
      console.log('[ocr] Tesseract CLI not installed (expected on cloud) — skipped');
    }
    return { text: '', confidence: 0, method: 'none', error: msg };
  }
}

// ── OCR text normalisation ────────────────────────────────────────────────────
/**
 * Fix common Tesseract OCR errors on utility bills:
 *   - NWH → kWh  (CMP handwritten bills)
 *   - KWH → kWh
 *   - kw-h → kWh
 *   - kivh/kiwh/kiN → kWh  (font rendering artefacts)
 *   - 0 → O confusion in month names: "0ct" → "Oct"
 */
function normaliseOcrText(text: string): string {
  return text
    // kWh aliases
    .replace(/\bN\.?W\.?H\.?\b/gi, 'kWh')
    .replace(/\bK\.?W\.?H\.?\b/g,  'kWh')
    .replace(/\bkw-h\b/gi,         'kWh')
    .replace(/\bki[vwN]h?\b/gi,    'kWh')   // kivh, kiwh, kiNh artefacts
    // Month name OCR fixes
    .replace(/\b0ct\b/g, 'Oct')
    .replace(/\b0ov\b/gi, 'Nov')
    .replace(/\bJan\./g, 'Jan')
    .replace(/\bFeb\./g, 'Feb');
}