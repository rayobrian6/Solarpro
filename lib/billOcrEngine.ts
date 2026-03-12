/**
 * lib/billOcrEngine.ts
 * Stage 1 — Free Tesseract OCR for utility bill images.
 *
 * Uses the Tesseract CLI binary (tesseract.js worker_threads causes webpack
 * bundling crashes in Next.js App Router routes). CLI is zero-bundle, runs
 * as a child process, and is guaranteed not to interfere with the route module.
 *
 * OCR priority order:
 *   1. Tesseract CLI  (free, local — `tesseract` binary must be installed)
 *   2. Tesseract.js   (free, JS fallback — used only if CLI not available)
 *   3. OpenAI Vision  (paid fallback — only if confidence < 60 or no usage)
 *   4. Google Vision  (paid fallback — last resort)
 *
 * Windows install:  https://github.com/UB-Mannheim/tesseract/wiki
 * Mac install:      brew install tesseract
 * Linux install:    apt-get install tesseract-ocr
 */

import { execFile } from 'child_process';
import { writeFile, readFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface OcrResult {
  rawText: string;
  confidence: number;       // 0–100
  method: 'tesseract-cli' | 'tesseract-js' | 'openai-vision' | 'google-vision' | 'none';
  error?: string;
}

// ── Stage 1a: Tesseract CLI ──────────────────────────────────────────────────
/**
 * Run the system `tesseract` binary as a child process.
 * Writes buffer to a temp file, runs tesseract, reads output, cleans up.
 *
 * This avoids ALL webpack/worker_threads/bundling issues.
 * Returns confidence 0–100 estimated from output length heuristic
 * (Tesseract CLI does not emit a confidence score directly).
 */
export async function recognizeImageCli(
  buffer: Buffer,
  mimeType: string,
): Promise<OcrResult> {
  const ext = mimeType.includes('png') ? 'png' : 'jpg';
  const tmpId = `bill_ocr_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const tmpImg = join(tmpdir(), `${tmpId}.${ext}`);
  const tmpTxt = join(tmpdir(), tmpId); // tesseract appends .txt automatically

  console.log(`[bill-ocr] Tesseract CLI: buffer=${buffer.length}b, mime=${mimeType}`);

  try {
    // Write image to temp file
    await writeFile(tmpImg, buffer);

    // Run tesseract CLI: tesseract <input> <output_base> -l eng --psm 3
    // --psm 3 = fully automatic page segmentation (best for full documents)
    // --oem 3 = default OCR engine (LSTM neural net)
    await execFileAsync('tesseract', [tmpImg, tmpTxt, '-l', 'eng', '--psm', '3', '--oem', '3'], {
      timeout: 30000,
    });

    // Read the output text file
    const outputFile = `${tmpTxt}.txt`;
    const rawText = await readFile(outputFile, 'utf-8');

    // Estimate confidence from output quality:
    // - If we got >200 chars with recognizable words → high confidence
    // - If we got 50–200 chars → medium
    // - If we got <50 chars → low
    const wordCount = rawText.trim().split(/\s+/).filter(w => w.length > 2).length;
    const confidence = wordCount > 50 ? 82 : wordCount > 20 ? 65 : wordCount > 5 ? 45 : 20;

    console.log(`[bill-ocr] Tesseract CLI: chars=${rawText.length}, words=${wordCount}, est.confidence=${confidence}`);
    if (rawText.length > 0) {
      console.log(`[bill-ocr] Tesseract preview: ${rawText.slice(0, 200).replace(/\n/g, '↵')}`);
    }

    return { rawText, confidence, method: 'tesseract-cli' };

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[bill-ocr] Tesseract CLI failed: ${msg}`);
    return { rawText: '', confidence: 0, method: 'none', error: msg };
  } finally {
    // Clean up temp files
    for (const f of [tmpImg, `${tmpTxt}.txt`]) {
      try { await unlink(f); } catch { /* ignore */ }
    }
  }
}

// ── Stage 1b: Tesseract.js (JS fallback) ─────────────────────────────────────
/**
 * Use tesseract.js npm package as fallback when CLI is not available.
 * Dynamically imported to prevent webpack from trying to bundle worker_threads.
 *
 * NOTE: This may still fail in some Next.js environments due to worker_threads.
 * If it fails, the error is caught and we fall through to Vision APIs.
 */
export async function recognizeImageJs(
  buffer: Buffer,
  mimeType: string,
): Promise<OcrResult> {
  console.log(`[bill-ocr] Tesseract.js fallback: buffer=${buffer.length}b`);

  try {
    // Dynamic import to prevent webpack static analysis of worker_threads
    const Tesseract = await import('tesseract.js');
    const createWorker = Tesseract.createWorker ?? (Tesseract as any).default?.createWorker;

    if (!createWorker) {
      throw new Error('createWorker not found in tesseract.js');
    }

    const worker = await createWorker('eng', 1, {
      cachePath: '/tmp/tesseract-cache',
      logger: () => {},
    });

    try {
      const safeMime = mimeType.startsWith('image/') ? mimeType : 'image/jpeg';
      const dataUrl = `data:${safeMime};base64,${buffer.toString('base64')}`;
      const { data } = await (worker as any).recognize(dataUrl);

      const rawText = data.text ?? '';
      const confidence = Math.round(data.confidence ?? 0);

      console.log(`[bill-ocr] Tesseract.js: confidence=${confidence}, chars=${rawText.length}`);
      return { rawText, confidence, method: 'tesseract-js' };

    } finally {
      try { await (worker as any).terminate(); } catch { /* ignore */ }
    }

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[bill-ocr] Tesseract.js failed: ${msg}`);
    return { rawText: '', confidence: 0, method: 'none', error: msg };
  }
}

// ── Stage 1: Auto-select best Tesseract method ───────────────────────────────
/**
 * Try CLI first (preferred — no bundling issues), fall back to JS library.
 */
export async function recognizeImage(
  buffer: Buffer,
  mimeType: string,
): Promise<OcrResult> {
  // Try CLI first
  const cliResult = await recognizeImageCli(buffer, mimeType);
  if (cliResult.rawText.length > 30) {
    return cliResult;
  }

  // CLI not available or returned nothing — try JS library
  console.log('[bill-ocr] CLI produced no output — trying Tesseract.js');
  const jsResult = await recognizeImageJs(buffer, mimeType);
  if (jsResult.rawText.length > 30) {
    return jsResult;
  }

  // Both failed
  const error = cliResult.error || jsResult.error || 'All Tesseract methods failed';
  console.warn('[bill-ocr] All Tesseract methods failed');
  return { rawText: '', confidence: 0, method: 'none', error };
}

// ── Stage 3a: OpenAI Vision fallback ─────────────────────────────────────────
/**
 * Call OpenAI gpt-4o Vision as a fallback OCR engine.
 * Only used when Tesseract confidence < 60 OR no monthly usage detected.
 */
export async function recognizeImageWithVision(
  buffer: Buffer,
  mimeType: string,
  openaiKey: string,
): Promise<OcrResult> {
  const safeMime = mimeType.startsWith('image/') ? mimeType : 'image/jpeg';
  const base64 = buffer.toString('base64');
  const dataUrl = `data:${safeMime};base64,${base64}`;
  const base64SizeKb = Math.round(buffer.length * 4 / 3 / 1024);

  console.log(`[bill-ocr] OpenAI Vision fallback: mime=${safeMime}, ~${base64SizeKb}KB`);

  try {
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
              text: 'You are reading an electric utility bill image. Extract ALL text exactly as it appears. Pay special attention to: (1) handwritten month lists like "Jan 555 kWh" or "Jan 555 NWH", (2) printed tables under "Monthly Usage Summary" or "Your Monthly Usage Summary(kWh)" showing month names with numeric columns where the first column is the current year daily average kWh, (3) any yearly total kWh line. Output only the raw extracted text, preserving table layout with month names and numbers on the same line.',
            },
            {
              type: 'image_url',
              image_url: { url: dataUrl, detail: 'high' },
            },
          ],
        }],
      }),
      signal: AbortSignal.timeout(45000),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.warn(`[bill-ocr] OpenAI Vision HTTP ${res.status}: ${errBody.slice(0, 300)}`);
      return {
        rawText: '',
        confidence: 0,
        method: 'none',
        error: `OpenAI Vision ${res.status}: ${errBody.slice(0, 100)}`,
      };
    }

    const json = await res.json();
    const text = json?.choices?.[0]?.message?.content?.trim() ?? '';

    if (text.length < 20) {
      console.warn(`[bill-ocr] OpenAI Vision short response (${text.length} chars)`);
      return { rawText: '', confidence: 0, method: 'openai-vision', error: 'Empty response' };
    }

    console.log(`[bill-ocr] OpenAI Vision: ${text.length} chars`);
    return { rawText: text, confidence: 85, method: 'openai-vision' };

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[bill-ocr] OpenAI Vision failed: ${msg}`);
    return { rawText: '', confidence: 0, method: 'none', error: msg };
  }
}

// ── Stage 3b: Google Vision fallback ─────────────────────────────────────────
/**
 * Call Google Vision DOCUMENT_TEXT_DETECTION as last-resort fallback.
 */
export async function recognizeImageWithGoogle(
  buffer: Buffer,
  googleKey: string,
): Promise<OcrResult> {
  console.log(`[bill-ocr] Google Vision fallback: buffer=${buffer.length}b`);
  try {
    const base64 = buffer.toString('base64');
    const res = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${googleKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            image: { content: base64 },
            features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
          }],
        }),
        signal: AbortSignal.timeout(20000),
      }
    );

    if (!res.ok) {
      console.warn(`[bill-ocr] Google Vision HTTP ${res.status}`);
      return { rawText: '', confidence: 0, method: 'none' };
    }

    const data = await res.json();
    const text = data?.responses?.[0]?.fullTextAnnotation?.text?.trim() ?? '';

    if (text.length < 20) {
      console.warn('[bill-ocr] Google Vision returned empty text');
      return { rawText: '', confidence: 0, method: 'google-vision' };
    }

    console.log(`[bill-ocr] Google Vision: ${text.length} chars`);
    return { rawText: text, confidence: 80, method: 'google-vision' };

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[bill-ocr] Google Vision failed: ${msg}`);
    return { rawText: '', confidence: 0, method: 'none', error: msg };
  }
}