/**
 * lib/billOcrEngine.ts
 * OCR engine for utility bill images.
 *
 * ARCHITECTURE:
 * This module calls the internal /api/ocr route for Tesseract OCR.
 * Tesseract.js is isolated in its own route to prevent webpack from
 * bundling worker_threads at compile time (which causes HTML 500 errors).
 *
 * Priority chain:
 *   1. Internal /api/ocr  (Tesseract.js WASM — free, no install required)
 *   2. Tesseract CLI       (faster if binary installed — auto-detected)
 *   3. OpenAI Vision       (paid — only if Tesseract confidence < 60 or no usage)
 *   4. Google Vision       (paid — last resort)
 */

export interface OcrResult {
  rawText: string;
  confidence: number;       // 0–100
  method: 'tesseract-js' | 'tesseract-cli' | 'openai-vision' | 'google-vision' | 'none';
  error?: string;
}

// ── Internal base URL for server-to-server calls ──────────────────────────────
function getBaseUrl(): string {
  // In Next.js server environment, use NEXTAUTH_URL or NEXT_PUBLIC_APP_URL
  // Falls back to localhost:3000 for local dev
  return (
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}` ||
    'http://localhost:3000'
  );
}

// ── Stage 1: Internal OCR route (Tesseract.js WASM) ──────────────────────────
/**
 * Call the internal /api/ocr endpoint which runs Tesseract.js in isolation.
 * This is the primary OCR path — free, no API key required.
 *
 * The route is called server-to-server (within the same Next.js process)
 * so it works identically in local dev and on Vercel/cloud.
 */
export async function recognizeImage(
  buffer: Buffer,
  mimeType: string,
): Promise<OcrResult> {
  const safeMime = mimeType.startsWith('image/') ? mimeType : 'image/jpeg';
  const imageBase64 = buffer.toString('base64');

  console.log(`[bill-ocr] Calling internal /api/ocr: mime=${safeMime}, buffer=${buffer.length}b`);

  try {
    const baseUrl = getBaseUrl();
    const res = await fetch(`${baseUrl}/api/ocr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64, mimeType: safeMime }),
      signal: AbortSignal.timeout(55000), // OCR can take 30–50s on first cold start
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[bill-ocr] /api/ocr returned HTTP ${res.status}: ${errText.slice(0, 200)}`);
      return {
        rawText: '',
        confidence: 0,
        method: 'none',
        error: `OCR route HTTP ${res.status}`,
      };
    }

    const json = await res.json();

    if (!json.success && !json.text) {
      console.warn(`[bill-ocr] /api/ocr failed: ${json.error}`);
      return {
        rawText: '',
        confidence: 0,
        method: 'none',
        error: json.error,
      };
    }

    const rawText: string = json.text ?? '';
    const confidence: number = json.confidence ?? 0;
    const method = (json.method ?? 'tesseract-js') as OcrResult['method'];

    console.log(`[bill-ocr] /api/ocr success: method=${method}, confidence=${confidence}, chars=${rawText.length}`);

    return { rawText, confidence, method };

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[bill-ocr] /api/ocr call failed: ${msg}`);
    return { rawText: '', confidence: 0, method: 'none', error: msg };
  }
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
              text: `You are reading an electric utility bill image. Extract ALL text exactly as it appears on the bill.\n\nPAY SPECIAL ATTENTION TO:\n1. The utility company name at the top of the bill (e.g. "Central Maine Power", "Eversource", "National Grid", "Versant Power").\n2. Handwritten month lists such as "Jan 555 kWh", "Feb 609 NWH", "Mar 736" — a list of month names with numbers.\n3. Printed monthly usage tables labeled "Your Monthly Usage Summary(kWh)" or "Monthly Usage Summary" — rows of month names followed by numbers (e.g. "Jan  362  324  298"). Each row is one month; the FIRST number is the most recent year kWh.\n4. The electricity rate — lines like "Energy Charge 362 kWh @ $0.12534" or "0.12534 per kWh" or "Rate: $0.198/kWh".\n5. Any annual or 12-month total kWh line.\n6. The service address.\n\nOutput ONLY the raw extracted text. Preserve table layout — keep month names and numbers on the same line. Do NOT summarize.`,
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