/**
 * app/api/ocr/route.ts
 * Dedicated server-side OCR endpoint using Tesseract.
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
 * Returns: { success: true, text: string, confidence: number, method: string, debugLog: string[] }
 *       OR { success: false, error: string }
 *
 * v46.1 CHANGES:
 *   - Image preprocessing pipeline (EXIF rotate, grayscale, contrast, threshold, upscale)
 *   - Multi-pass OCR: PSM 3 (auto) + PSM 6 (single block), best result wins
 *   - Raw OCR text logged before any parsing
 *   - Tesseract CLI preferred over WASM (faster, better accuracy on Tesseract 5.x)
 */

import { NextRequest, NextResponse } from 'next/server';

// This directive tells Next.js to use the Node.js runtime (not Edge).
// Required for worker_threads / child_process / filesystem access.
export const runtime = 'nodejs';

// Max duration: 60s for OCR on large high-res bill images
export const maxDuration = 60;

// ── OCR confidence thresholds ──────────────────────────────────────────────
// Tesseract returns 0–100. Below 40 = likely garbage output.
const MIN_USABLE_CONFIDENCE = 40;

// ── POST handler ────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const debugLog: string[] = [];

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

    const rawBuffer = Buffer.from(imageBase64, 'base64');
    debugLog.push(`[ocr] Request: mime=${safeMime}, buffer=${rawBuffer.length}b`);

    // ── Step 1: Image preprocessing ──────────────────────────────────────────
    // Auto-rotate (EXIF), grayscale, normalize contrast, sharpen, threshold
    // This dramatically improves Tesseract accuracy on phone bill photos.
    let ocrBuffer: Buffer = rawBuffer;
    try {
      const { preprocessBillImage } = await import('@/lib/billImagePreprocess');
      const prepResult = await preprocessBillImage(rawBuffer, debugLog);
      ocrBuffer = prepResult.buffer;
    } catch (prepErr: unknown) {
      const msg = prepErr instanceof Error ? prepErr.message : String(prepErr);
      debugLog.push(`[ocr] Preprocessing failed (${msg}) — using original image`);
    }

    // ── Step 2: Multi-pass OCR ────────────────────────────────────────────────
    const result = await runMultiPassTesseract(ocrBuffer, safeMime, debugLog);

    // ── Step 3: Log raw OCR text (critical for debugging) ─────────────────────
    debugLog.push(`[ocr] === RAW OCR TEXT (${result.text.length} chars) ===`);
    // Log first 1000 chars of raw text in chunks for readability
    const preview = result.text.slice(0, 1000);
    for (const line of preview.split('\n').slice(0, 50)) {
      if (line.trim()) debugLog.push(`[ocr-raw] ${line}`);
    }
    if (result.text.length > 1000) {
      debugLog.push(`[ocr-raw] ... (${result.text.length - 1000} more chars)`);
    }
    debugLog.push(`[ocr] === END RAW OCR TEXT ===`);

    // Emit debug log to server console
    for (const line of debugLog) {
      console.log(line);
    }

    debugLog.push(`[ocr] Result: method=${result.method}, confidence=${result.confidence}, chars=${result.text.length}`);

    return NextResponse.json({
      success: result.confidence >= MIN_USABLE_CONFIDENCE || result.text.length > 50,
      text: result.text,
      confidence: result.confidence,
      method: result.method,
      debugLog,
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[ocr] Fatal error:', msg);
    debugLog.push(`[ocr] FATAL: ${msg}`);
    return NextResponse.json(
      { success: false, error: msg, text: '', confidence: 0, debugLog },
      { status: 500 },
    );
  }
}

// ── Multi-pass Tesseract runner ──────────────────────────────────────────────
interface TesseractResult {
  text: string;
  confidence: number;
  method: 'tesseract-cli' | 'tesseract-js' | 'none';
  error?: string;
}

/**
 * Run two OCR passes with different page segmentation modes and return the
 * result with the most text content.
 *
 * PSM 3 = Fully automatic page segmentation (default) — good for full bills
 * PSM 6 = Assume a single uniform block of text — good for structured tables
 *
 * We prefer CLI (Tesseract 5.x binary) over WASM for better accuracy.
 */
async function runMultiPassTesseract(
  buffer: Buffer,
  mimeType: string,
  log: string[],
): Promise<TesseractResult> {
  // Try CLI first — Tesseract 5.x binary is more accurate than WASM
  const cliAvailable = await checkTesseractCli();

  if (cliAvailable) {
    log.push('[ocr] Tesseract CLI available — running multi-pass OCR');

    // Pass 1: PSM 3 — auto layout (standard)
    const pass1 = await tryTesseractCli(buffer, mimeType, 3, log);
    log.push(`[ocr] CLI PSM 3: ${pass1.text.length} chars, confidence=${pass1.confidence}`);

    // Pass 2: PSM 6 — single uniform text block (better for bill tables)
    const pass2 = await tryTesseractCli(buffer, mimeType, 6, log);
    log.push(`[ocr] CLI PSM 6: ${pass2.text.length} chars, confidence=${pass2.confidence}`);

    // Choose the pass with more text content (longer = more data extracted)
    const best = pass1.text.length >= pass2.text.length ? pass1 : pass2;
    const bestPsm = pass1.text.length >= pass2.text.length ? 3 : 6;
    log.push(`[ocr] Best pass: PSM ${bestPsm} (${best.text.length} chars)`);

    if (best.text.length > 30) {
      return best;
    }
  }

  // Fallback: Tesseract.js WASM (works on any cloud without binary install)
  log.push('[ocr] Falling back to Tesseract.js WASM...');

  // WASM Pass 1: standard
  const wasm1 = await tryTesseractJs(buffer, mimeType, log);
  log.push(`[ocr] WASM PSM 3: ${wasm1.text.length} chars, confidence=${wasm1.confidence}`);

  if (wasm1.text.length > 30) {
    return wasm1;
  }

  log.push('[ocr] All Tesseract passes returned minimal text');
  return {
    text: wasm1.text,
    confidence: wasm1.confidence,
    method: 'none',
    error: 'Minimal text extracted from all passes',
  };
}

// ── Check if Tesseract CLI is available ──────────────────────────────────────
let _cliAvailable: boolean | null = null;
async function checkTesseractCli(): Promise<boolean> {
  if (_cliAvailable !== null) return _cliAvailable;
  try {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);
    await execFileAsync('tesseract', ['--version'], { timeout: 3000 });
    _cliAvailable = true;
  } catch {
    _cliAvailable = false;
  }
  return _cliAvailable;
}

// ── Tesseract CLI (binary — Tesseract 5.x) ───────────────────────────────────
async function tryTesseractCli(
  buffer: Buffer,
  mimeType: string,
  psm: number,
  log: string[],
): Promise<TesseractResult> {
  try {
    const { execFile } = await import('child_process');
    const { writeFile, readFile, unlink } = await import('fs/promises');
    const { join } = await import('path');
    const { tmpdir } = await import('os');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);

    // Always write as PNG for CLI (preprocessed buffer is PNG)
    const id = `ocr_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const ext = mimeType.includes('png') ? 'png' : 'jpg';
    const tmpImg = join(tmpdir(), `${id}.${ext}`);
    const tmpBase = join(tmpdir(), id);

    await writeFile(tmpImg, buffer);

    try {
      await execFileAsync(
        'tesseract',
        [tmpImg, tmpBase, '-l', 'eng', '--psm', String(psm), '--oem', '3'],
        { timeout: 30000 },
      );

      const rawText = await readFile(`${tmpBase}.txt`, 'utf-8');
      const normalisedText = normaliseOcrText(rawText);

      // Estimate confidence from word count (CLI doesn't emit numeric confidence)
      const wordCount = normalisedText.trim().split(/\s+/).filter(w => w.length > 2).length;
      const confidence = wordCount > 100 ? 85 : wordCount > 50 ? 80 : wordCount > 20 ? 70 : wordCount > 5 ? 55 : 25;

      log.push(`[ocr] CLI PSM${psm}: chars=${normalisedText.length}, words=${wordCount}, conf=${confidence}`);
      return { text: normalisedText, confidence, method: 'tesseract-cli' };

    } finally {
      for (const f of [tmpImg, `${tmpBase}.txt`]) {
        try { await unlink(f); } catch { /* ignore */ }
      }
    }

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('ENOENT') && !msg.includes('not found')) {
      log.push(`[ocr] CLI PSM${psm} failed: ${msg}`);
    }
    return { text: '', confidence: 0, method: 'none', error: msg };
  }
}

// ── Tesseract.js (WASM — no install required) ─────────────────────────────────
async function tryTesseractJs(
  buffer: Buffer,
  mimeType: string,
  log: string[],
): Promise<TesseractResult> {
  log.push('[ocr] Trying Tesseract.js (WASM)...');
  try {
    // require() instead of import — keeps webpack from statically analyzing this
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createWorker } = require('tesseract.js');

    const worker = await createWorker('eng', 1, {
      cachePath: '/tmp/tesseract-cache',
      logger: (m: any) => {
        if (m.status === 'recognizing text' && (m.progress === 0 || m.progress === 1)) {
          log.push(`[ocr] WASM: ${m.status} ${Math.round(m.progress * 100)}%`);
        }
      },
    });

    try {
      const safeMime = mimeType.startsWith('image/') ? mimeType : 'image/jpeg';
      const dataUrl = `data:${safeMime};base64,${buffer.toString('base64')}`;

      const { data } = await worker.recognize(dataUrl);

      const rawText: string = data.text ?? '';
      const confidence: number = Math.round(data.confidence ?? 0);
      const normalisedText = normaliseOcrText(rawText);

      log.push(`[ocr] WASM: confidence=${confidence}, chars=${normalisedText.length}`);
      return { text: normalisedText, confidence, method: 'tesseract-js' };

    } finally {
      try { await worker.terminate(); } catch { /* ignore cleanup errors */ }
    }

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.push(`[ocr] WASM failed: ${msg}`);
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
 *   - 0ct → Oct  (zero/O confusion in month names)
 *   - l → 1  (lowercase L vs digit 1 in numbers)
 */
function normaliseOcrText(text: string): string {
  return text
    // kWh aliases — must come first
    .replace(/\bN\.?W\.?H\.?\b/gi, 'kWh')
    .replace(/\bK\.?W\.?H\.?\b/g,  'kWh')
    .replace(/\bkw-h\b/gi,         'kWh')
    .replace(/\bki[vwN]h?\b/gi,    'kWh')   // kivh, kiwh, kiNh artefacts
    .replace(/\bkVVh\b/gi,         'kWh')   // double-V artefact
    .replace(/\bkWFh?\b/gi,        'kWh')   // kWF artefact
    // Month name OCR fixes
    .replace(/\b0ct\b/g, 'Oct')
    .replace(/\b0ov\b/gi, 'Nov')
    .replace(/\bJan\./g, 'Jan')
    .replace(/\bFeb\./g, 'Feb')
    // Fix "l" (lowercase L) that appears as digit in kWh values
    // e.g. "l,234 kWh" → "1,234 kWh"
    .replace(/\bl([,0-9])/g, '1$1')
    // Fix O→0 in numbers (but not in month names already fixed above)
    .replace(/(\d)O(\d)/g, '$10$2');
}