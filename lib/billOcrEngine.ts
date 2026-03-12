/**
 * lib/billOcrEngine.ts
 * Stage 1 — Free Tesseract.js OCR for utility bill images.
 *
 * This module replaces OpenAI Vision as the PRIMARY OCR engine.
 * OpenAI Vision is only called as a fallback when:
 *   - Tesseract confidence < 60
 *   - OR no monthly usage was detected from Tesseract output
 *
 * Works in Next.js API routes (Node.js runtime, server-side only).
 * Tesseract.js v7 uses a bundled WASM + traineddata that is downloaded
 * once from jsDelivr CDN and cached in /tmp on the server.
 */

import { createWorker } from 'tesseract.js';

export interface OcrResult {
  rawText: string;
  confidence: number;       // 0–100 (Tesseract mean word confidence)
  method: 'tesseract' | 'openai-vision' | 'google-vision' | 'none';
  error?: string;
}

// ── Tesseract OCR ────────────────────────────────────────────────────────────
/**
 * Run Tesseract.js OCR on an image buffer.
 * Supports JPEG, PNG, WEBP, BMP, TIFF (any format Tesseract handles).
 *
 * Returns confidence 0–100.  A score ≥ 60 is considered usable.
 * If recognition fails, returns confidence = 0 and empty rawText.
 */
export async function recognizeImage(
  buffer: Buffer,
  mimeType: string,
): Promise<OcrResult> {
  console.log(`[bill-ocr] Tesseract: starting, buffer=${buffer.length}b, mime=${mimeType}`);

  let worker: Awaited<ReturnType<typeof createWorker>> | null = null;

  try {
    // v7 API: createWorker(lang, oem, options)
    // cachePath → /tmp so traineddata is cached between warm Lambda invocations
    worker = await createWorker('eng', 1, {
      cachePath: '/tmp/tesseract-cache',
      logger: () => {}, // suppress progress logs
    });

    // Convert buffer to a data URL so Tesseract can load it
    const safeMime = mimeType.startsWith('image/') ? mimeType : 'image/jpeg';
    const base64 = buffer.toString('base64');
    const dataUrl = `data:${safeMime};base64,${base64}`;

    const { data } = await worker.recognize(dataUrl);

    const rawText = data.text ?? '';
    // Tesseract returns confidence per word — use the mean confidence of the whole page
    const confidence = Math.round(data.confidence ?? 0);

    console.log(`[bill-ocr] Tesseract: confidence=${confidence}, chars=${rawText.length}`);
    if (rawText.length > 0) {
      console.log(`[bill-ocr] Tesseract preview: ${rawText.slice(0, 200).replace(/\n/g, '↵')}`);
    }

    return { rawText, confidence, method: 'tesseract' };

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[bill-ocr] Tesseract failed: ${msg}`);
    return { rawText: '', confidence: 0, method: 'none', error: msg };
  } finally {
    if (worker) {
      try { await worker.terminate(); } catch { /* ignore */ }
    }
  }
}

// ── OpenAI Vision fallback ───────────────────────────────────────────────────
/**
 * Call OpenAI gpt-4o Vision as a fallback OCR engine.
 * Only used when Tesseract confidence < 60 OR no monthly usage detected.
 *
 * Returns the raw extracted text or '' on failure.
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
      return { rawText: '', confidence: 0, method: 'none', error: `OpenAI Vision ${res.status}` };
    }

    const json = await res.json();
    const text = json?.choices?.[0]?.message?.content?.trim() ?? '';

    if (text.length < 20) {
      console.warn(`[bill-ocr] OpenAI Vision returned short text (${text.length} chars). finish_reason=${json?.choices?.[0]?.finish_reason}`);
      return { rawText: '', confidence: 0, method: 'openai-vision', error: 'Empty response' };
    }

    console.log(`[bill-ocr] OpenAI Vision: ${text.length} chars`);
    // Vision doesn't give a numeric confidence — treat as 85 (high)
    return { rawText: text, confidence: 85, method: 'openai-vision' };

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[bill-ocr] OpenAI Vision failed: ${msg}`);
    return { rawText: '', confidence: 0, method: 'none', error: msg };
  }
}

// ── Google Vision fallback ───────────────────────────────────────────────────
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