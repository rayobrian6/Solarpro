/**
 * lib/billPipeline.ts — Universal Utility Bill Parsing Pipeline (v47.213)
 *
 * 3-layer architecture:
 *   Layer 1 — Text Extraction  : extractBillText()        (PDF + image, never hangs)
 *   Layer 2 — AI Interpretation: aiExtractBillData()      (format-agnostic, JSON out)
 *   Layer 3 — Validation       : validatePipelineBillData() (kwh/cost/period checks)
 *   Master  — parseUtilityBill(): orchestrates all layers, retry once, structured error
 *
 * RULES:
 *   - No infinite hangs — every async op has an explicit timeout
 *   - No regex parsing of bill content here — that's AI's job
 *   - Return shape is always { success, data?, error? } for the master pipeline
 *   - BillExtractResult shape from billOcr.ts is preserved for compatibility
 */

import type { BillExtractResult } from '@/lib/billOcr';
import { extractPdfTextPure } from '@/lib/pdfExtract';
// v47.306: Bill Intelligence Layer
import { computeBillInsights } from '@/lib/billInsights';
// v48.0: Claude 3.5 Sonnet LMM Extraction Engine
import { extractBillWithClaude } from '@/lib/billClaudeExtractor';
import { logger } from '@/lib/logger';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * sanitizeForPrompt — strips prompt injection patterns from bill text before
 * sending to any LLM. Prevents malicious bill content from overriding system prompts.
 */
function sanitizeForPrompt(text: string): string {
  const injectionPatterns = [
    /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|context)/gi,
    /disregard\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|context)/gi,
    /forget\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|context)/gi,
    /you\s+are\s+now\s+[a-z]/gi,
    /act\s+as\s+(a|an|the)\s+[a-z]/gi,
    /pretend\s+(to\s+be|you\s+are)/gi,
    /return\s+(your\s+)?(system\s+prompt|instructions)/gi,
    /reveal\s+(your\s+)?(system\s+prompt|instructions|secrets?)/gi,
    /new\s+instruction[s]?:/gi,
    /system\s*:\s*[^\n]{0,100}/gi,
    /\[\s*system\s*\]/gi,
    /<\s*system\s*>/gi,
  ];
  let sanitized = text;
  for (const pattern of injectionPatterns) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }
  return sanitized;
}

/** Returns a Promise that rejects after `ms` milliseconds */
function raceTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`[billPipeline] ${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

// ─── Layer 1: Text Extraction ─────────────────────────────────────────────────

export type TextExtractionResult = {
  text: string;
  method: string;
};

/**
 * extractBillText — Layer 1
 *
 * Tries every available extraction method in order of reliability:
 *   PDF:   pdftotext CLI → pdf-parse (v2 class / v1 fn / default) → pure-extract → pdfjs-dist → OpenAI Files API
 *   Image: Tesseract CLI → OpenAI Vision → Google Vision
 *
 * Never throws — returns { text: '', method: 'failed' } if all methods fail.
 * Every individual async operation is wrapped in a timeout.
 */
export async function extractBillText(
  buffer: Buffer,
  mimeType: string,
): Promise<TextExtractionResult> {
  const isPdf =
    mimeType === 'application/pdf' ||
    mimeType === 'application/x-pdf';

  if (isPdf) {
    return extractPdfTextAllMethods(buffer);
  } else {
    return extractImageTextAllMethods(buffer, mimeType);
  }
}

// ─── PDF extraction chain ─────────────────────────────────────────────────────

async function extractPdfTextAllMethods(buffer: Buffer): Promise<TextExtractionResult> {
  const isVercel = !!(process.env.VERCEL || process.env.VERCEL_ENV || process.env.VERCEL_URL);
  const openaiKey = process.env.OPENAI_API_KEY;

  function isUseful(t: string): boolean {
    if (t.length < 100) return false;
    const hasMoney   = /\$\s*\d/.test(t);
    const hasKwh     = /\d\s*kwh/i.test(t);
    const hasDigits  = (/\d{3,}/.exec(t) || []).length > 0;
    const hasAddress = /street|ave|road|blvd|drive|lane|pl\b|st\b/i.test(t);
    const hasAccount = /account|service|billing|meter|customer/i.test(t);
    const score = [hasMoney, hasKwh, hasDigits, hasAddress, hasAccount].filter(Boolean).length;
    return score >= 2;
  }

  // Method 1: pdftotext CLI (skipped on Vercel — binary not available)
  if (!isVercel) {
    try {
      logger.debug('billPipeline', '[billPipeline] PDF method=pdftotext');
      const text = await raceTimeout(extractPdfCli(buffer), 15000, 'pdftotext');
      if (isUseful(text)) {
        logger.debug('billPipeline', `[billPipeline] PDF method=pdftotext SUCCESS chars=${text.length}`);
        return { text: normalizeOcrText(text), method: 'pdftotext' };
      }
    } catch (e) {
      logger.warn('billPipeline', '[billPipeline] pdftotext failed:', e instanceof Error ? e.message : e);
    }
  }

  // Method 2: pdf-parse (v2.4.5 class-based API; falls back to v1 and default export)
  try {
    logger.debug('billPipeline', '[billPipeline] PDF method=pdf-parse');
    const text = await raceTimeout(extractPdfParse(buffer), 15000, 'pdf-parse');
    if (isUseful(text)) {
      logger.debug('billPipeline', `[billPipeline] PDF method=pdf-parse SUCCESS chars=${text.length}`);
      return { text: normalizeOcrText(text), method: 'pdf-parse' };
    }
  } catch (e) {
    logger.warn('billPipeline', '[billPipeline] pdf-parse failed:', e instanceof Error ? e.message : e);
  }

  // Method 3: Pure Node.js stream extractor (no deps)
  try {
    logger.debug('billPipeline', '[billPipeline] PDF method=pure-extract');
    const text = extractPdfTextPure(buffer);
    if (isUseful(text)) {
      logger.debug('billPipeline', `[billPipeline] PDF method=pure-extract SUCCESS chars=${text.length}`);
      return { text: normalizeOcrText(text), method: 'pure-extract' };
    }
  } catch (e) {
    logger.warn('billPipeline', '[billPipeline] pure-extract failed:', e instanceof Error ? e.message : e);
  }

  // Method 4: pdfjs-dist (with hard timeouts on every operation to prevent Vercel hangs)
  try {
    logger.debug('billPipeline', '[billPipeline] PDF method=pdfjs-dist');
    const text = await raceTimeout(extractPdfJs(buffer), 20000, 'pdfjs-dist');
    if (isUseful(text)) {
      logger.debug('billPipeline', `[billPipeline] PDF method=pdfjs-dist SUCCESS chars=${text.length}`);
      return { text: normalizeOcrText(text), method: 'pdfjs-dist' };
    }
  } catch (e) {
    logger.warn('billPipeline', '[billPipeline] pdfjs-dist failed:', e instanceof Error ? e.message : e);
  }

  // Method 5: OpenAI Files API (last resort for PDF; uses gpt-4o to read PDF directly)
  if (openaiKey) {
    try {
      logger.debug('billPipeline', '[billPipeline] PDF method=openai-files-api');
      const text = await raceTimeout(extractPdfOpenAI(buffer, openaiKey), 35000, 'openai-files-api');
      if (text && text.length > 50) {
        logger.debug('billPipeline', `[billPipeline] PDF method=openai-files-api SUCCESS chars=${text.length}`);
        return { text: normalizeOcrText(text), method: 'openai-responses' };
      }
    } catch (e) {
      logger.warn('billPipeline', '[billPipeline] openai-files-api failed:', e instanceof Error ? e.message : e);
    }
  }

  console.error('[billPipeline] All PDF extraction methods exhausted');
  return { text: '', method: 'failed' };
}

// ─── PDF sub-extractors ───────────────────────────────────────────────────────

async function extractPdfCli(buffer: Buffer): Promise<string> {
  const { execSync, execFileSync } = await import('child_process');
  const { writeFileSync, readFileSync, unlinkSync } = await import('fs');
  const { tmpdir } = await import('os');
  const { join } = await import('path');
  const tmpIn  = join(tmpdir(), `bp_${Date.now()}.pdf`);
  const tmpOut = join(tmpdir(), `bp_${Date.now()}.txt`);
  writeFileSync(tmpIn, buffer);
  // SECURITY: execFileSync with argument array — avoids spawning a shell.
  execFileSync('pdftotext', ['-layout', tmpIn, tmpOut], { timeout: 14000 });
  const text = readFileSync(tmpOut, 'utf-8');
  try { unlinkSync(tmpIn); } catch {}
  try { unlinkSync(tmpOut); } catch {}
  return text;
}

async function extractPdfParse(buffer: Buffer): Promise<string> {
  const ppMod = require('pdf-parse') as any;
  logger.debug('billPipeline', `[billPipeline] pdf-parse module: hasPDFParse=${typeof ppMod?.PDFParse} isFunction=${typeof ppMod === 'function'}`);

  // Strategy A: v2.4.5 class-based API
  if (typeof ppMod?.PDFParse === 'function') {
    try {
      const inst = new ppMod.PDFParse({ data: buffer });
      await inst.load();
      const res = await inst.getText();
      const text = (typeof res === 'string' ? res : res?.text ?? '').trim();
      if (text.length > 0) {
        logger.debug('billPipeline', `[billPipeline] pdf-parse strategy=A chars=${text.length}`);
        return text;
      }
    } catch (e) {
      logger.warn('billPipeline', '[billPipeline] pdf-parse strategy A failed:', e instanceof Error ? e.message : e);
    }
  }

  // Strategy B: v1.x function API
  if (typeof ppMod === 'function') {
    try {
      const res = await ppMod(buffer);
      const text = (res?.text || '').trim();
      if (text.length > 0) {
        logger.debug('billPipeline', `[billPipeline] pdf-parse strategy=B chars=${text.length}`);
        return text;
      }
    } catch (e) {
      logger.warn('billPipeline', '[billPipeline] pdf-parse strategy B failed:', e instanceof Error ? e.message : e);
    }
  }

  // Strategy C: default export
  if (typeof ppMod?.default === 'function') {
    try {
      const res = await ppMod.default(buffer);
      const text = (res?.text || '').trim();
      if (text.length > 0) {
        logger.debug('billPipeline', `[billPipeline] pdf-parse strategy=C chars=${text.length}`);
        return text;
      }
    } catch (e) {
      logger.warn('billPipeline', '[billPipeline] pdf-parse strategy C failed:', e instanceof Error ? e.message : e);
    }
  }

  return '';
}

async function extractPdfJs(buffer: Buffer): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs' as any);
  const getDocument = pdfjsLib.getDocument ?? pdfjsLib.default?.getDocument;
  if (!getDocument) throw new Error('getDocument not found in pdfjs-dist');

  const uint8 = new Uint8Array(buffer);
  const doc = await raceTimeout(
    getDocument({
      data: uint8,
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true,
      disableFontFace: true,
      disableRange: true,
      disableStream: true,
    }).promise,
    8000,
    'pdfjs-dist getDocument'
  ) as { numPages: number; getPage: (n: number) => Promise<any> };

  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await raceTimeout(doc.getPage(i), 5000, `pdfjs getPage(${i})`);
    const content = await raceTimeout(
      (page as { getTextContent: () => Promise<{ items: any[] }> }).getTextContent(),
      5000,
      `pdfjs getTextContent(${i})`
    ) as { items: any[] };
    text += content.items.map((item: any) => ('str' in item ? item.str : '')).join(' ') + '\n';
  }
  return text.trim();
}

async function extractPdfOpenAI(buffer: Buffer, openaiKey: string): Promise<string> {
  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(buffer)], { type: 'application/pdf' }), 'bill.pdf');
  fd.append('purpose', 'user_data');

  const uploadRes = await fetch('https://api.openai.com/v1/files', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${openaiKey}` },
    body: fd,
    signal: AbortSignal.timeout(20000),
  });

  if (!uploadRes.ok) throw new Error(`OpenAI file upload failed: ${uploadRes.status}`);
  const uploadData = await uploadRes.json();
  const fileId = uploadData.id;

  // Clean up file after use (fire and forget)
  const cleanup = () => fetch(`https://api.openai.com/v1/files/${fileId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${openaiKey}` },
  }).catch(() => {});

  try {
    const respRes = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        input: [{
          role: 'user',
          content: [
            { type: 'input_file', file_id: fileId },
            { type: 'input_text', text: `Extract ALL text from this utility bill PDF exactly as it appears.\n\nCRITICAL: For any bar chart, graph, or table showing monthly electricity usage (kWh):\n- Output every single number from the chart/table as raw digits\n- Format them on one line like: "Monthly kWh history: 4188 2311 1418 761 318 460 881 901 1660 2296 1509 1354"\n- Do NOT summarize, average, or describe the chart — output the exact numbers\n\nOutput the complete raw text including all numbers, addresses, account numbers, dates, and kWh values. Preserve original formatting.` },
          ],
        }],
      }),
      signal: AbortSignal.timeout(25000),
    });

    cleanup();

    if (!respRes.ok) throw new Error(`OpenAI responses failed: ${respRes.status}`);
    const respData = await respRes.json();
    return respData?.output?.[0]?.content?.[0]?.text?.trim()
      ?? respData?.output?.[0]?.content?.trim()
      ?? '';
  } catch (e) {
    cleanup();
    throw e;
  }
}

// ─── Image extraction chain ───────────────────────────────────────────────────

async function extractImageTextAllMethods(buffer: Buffer, mimeType: string): Promise<TextExtractionResult> {
  const openaiKey = process.env.OPENAI_API_KEY;
  const googleKey = process.env.GOOGLE_VISION_API_KEY || process.env.GOOGLE_MAPS_API_KEY;

  // Method 1: Tesseract CLI
  try {
    logger.debug('billPipeline', '[billPipeline] Image method=tesseract-cli');
    const text = await raceTimeout(runTesseractCli(buffer, mimeType), 30000, 'tesseract-cli');
    if (text && text.length > 50) {
      logger.debug('billPipeline', `[billPipeline] Image method=tesseract-cli SUCCESS chars=${text.length}`);
      return { text: normalizeOcrText(text), method: 'tesseract-cli' };
    }
  } catch (e) {
    logger.warn('billPipeline', '[billPipeline] tesseract-cli failed:', e instanceof Error ? e.message : e);
  }

  // Method 2: OpenAI Vision
  if (openaiKey) {
    try {
      logger.debug('billPipeline', '[billPipeline] Image method=openai-vision');
      const text = await raceTimeout(extractImageOpenAIVision(buffer, mimeType, openaiKey), 20000, 'openai-vision');
      if (text && text.length > 50) {
        logger.debug('billPipeline', `[billPipeline] Image method=openai-vision SUCCESS chars=${text.length}`);
        return { text: normalizeOcrText(text), method: 'openai-vision' };
      }
    } catch (e) {
      logger.warn('billPipeline', '[billPipeline] openai-vision failed:', e instanceof Error ? e.message : e);
    }
  }

  // Method 3: Google Vision
  if (googleKey) {
    try {
      logger.debug('billPipeline', '[billPipeline] Image method=google-vision');
      const text = await raceTimeout(extractImageGoogleVision(buffer, googleKey), 20000, 'google-vision');
      if (text && text.length > 50) {
        logger.debug('billPipeline', `[billPipeline] Image method=google-vision SUCCESS chars=${text.length}`);
        return { text: normalizeOcrText(text), method: 'google-vision' };
      }
    } catch (e) {
      logger.warn('billPipeline', '[billPipeline] google-vision failed:', e instanceof Error ? e.message : e);
    }
  }

  console.error('[billPipeline] All image extraction methods exhausted');
  return { text: '', method: 'failed' };
}

async function runTesseractCli(buffer: Buffer, mimeType: string): Promise<string> {
  const { execFile } = await import('child_process');
  const { writeFile, readFile, unlink } = await import('fs/promises');
  const { join } = await import('path');
  const { tmpdir } = await import('os');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);

  // Check tesseract is available
  await execFileAsync('tesseract', ['--version'], { timeout: 3000 }).catch(() => {
    throw new Error('tesseract CLI not available');
  });

  const id = `bp_ocr_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const ext = mimeType.includes('png') ? 'png' : 'jpg';
  const tmpImg  = join(tmpdir(), `${id}.${ext}`);
  const tmpBase = join(tmpdir(), id);

  await writeFile(tmpImg, buffer);
  try {
    await execFileAsync('tesseract', [tmpImg, tmpBase, '-l', 'eng', '--psm', '3', '--oem', '3'], { timeout: 28000 });
    const raw = await readFile(`${tmpBase}.txt`, 'utf-8');
    return raw.trim();
  } finally {
    for (const f of [tmpImg, `${tmpBase}.txt`]) {
      try { await unlink(f); } catch {}
    }
  }
}

async function extractImageOpenAIVision(buffer: Buffer, mimeType: string, openaiKey: string): Promise<string> {
  const b64 = buffer.toString('base64');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${b64}`, detail: 'high' } },
          { type: 'text', text: 'Extract ALL text from this utility bill image exactly as it appears. Include all numbers, addresses, kWh values, account numbers, and dates. For bar charts or usage graphs, output each monthly number explicitly.' },
        ],
      }],
    }),
    signal: AbortSignal.timeout(18000),
  });
  if (!res.ok) throw new Error(`OpenAI vision failed: ${res.status}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content?.trim() ?? '';
}

async function extractImageGoogleVision(buffer: Buffer, apiKey: string): Promise<string> {
  const base64 = buffer.toString('base64');
  const res = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ image: { content: base64 }, features: [{ type: 'DOCUMENT_TEXT_DETECTION' }] }] }),
      signal: AbortSignal.timeout(18000),
    }
  );
  if (!res.ok) throw new Error(`Google Vision failed: ${res.status}`);
  const data = await res.json();
  return data?.responses?.[0]?.fullTextAnnotation?.text?.trim() ?? '';
}

// ─── OCR Normalization ────────────────────────────────────────────────────────

/**
 * normalizeOcrText — fix common OCR errors in utility bill text
 *
 * Rules applied (only in numeric/kWh contexts to avoid corrupting prose):
 *   - Collapse 3+ consecutive blank lines to 2
 *   - Remove null bytes and non-printable control chars
 *   - NWH / N.W.H / KWH → kWh  (OCR misread of kWh abbreviation)
 *   - l (lowercase L) → 1 when surrounded by digits (e.g. "4l8" → "418")
 *   - O (uppercase O) → 0 when surrounded by digits (e.g. "4O2" → "402")
 */
export function normalizeOcrText(text: string): string {
  return text
    // Remove null bytes and non-printable control chars (keep \n \t)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Collapse 3+ consecutive blank lines to 2
    .replace(/\n{3,}/g, '\n\n')
    // OCR: NWH / N.W.H / KWH → kWh
    .replace(/\bN\.?W\.?H\.?\b/gi, 'kWh')
    .replace(/\bK\.?W\.?H\.?\b/g,  'kWh')
    .replace(/\bkw-h\b/gi,         'kWh')
    // OCR: lowercase l between digits → 1  (e.g. 4l8 → 418)
    .replace(/(\d)l(\d)/g, '$11$2')
    // OCR: uppercase O between digits → 0  (e.g. 4O2 → 402)
    .replace(/(\d)O(\d)/g, '$10$2')
    // Trim trailing spaces from each line
    .replace(/[^\S\n]+$/gm, '')
    .trim();
}

// ─── Layer 2: AI Structured Extraction ───────────────────────────────────────

export interface AiBillData {
  utility_name: string | null;
  billing_period_start: string | null;
  billing_period_end: string | null;
  total_kwh: number | null;
  monthly_kwh: number[] | null;       // array of monthly values oldest→newest
  total_cost: number | null;
  electricity_rate: number | null;
  account_number: string | null;
  customer_name: string | null;
  service_address: string | null;
  bill_type: 'electric' | 'gas' | 'combined' | 'unknown' | null;
}

/**
 * aiExtractBillDataWithClaude — Layer 2 (Primary)
 *
 * v48.0: Claude 3.5 Sonnet multimodal extraction engine.
 * Accepts either an image buffer (best — no OCR loss) or raw text.
 * Falls back to GPT-4o-mini (aiExtractBillData) if:
 *   - ANTHROPIC_API_KEY is not set
 *   - Claude returns null / errors out
 *   - Claude result has status='failed' AND GPT has a better shot
 *
 * This is the new primary entry point for Layer 2 extraction.
 */
export async function aiExtractBillDataWithClaude(
  input: { imageBuffer: Buffer; mimeType: string } | { rawText: string },
): Promise<AiBillData | null> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  // Try Claude first
  if (anthropicKey) {
    try {
      logger.debug('billPipeline', '[billPipeline] Layer 2: trying Claude 3.5 Sonnet');
      const claudeResult = await extractBillWithClaude(input, { timeoutMs: 40000 });

      if (claudeResult && claudeResult.status !== 'failed') {
        logger.debug('billPipeline', `[billPipeline] Claude extraction SUCCESS status=${claudeResult.status} utility=${claudeResult.data.utility_name} kwh=${claudeResult.data.total_kwh} months=${claudeResult.data.monthly_kwh?.length ?? 0}`);
        return claudeResult.data;
      }

      if (claudeResult?.status === 'failed') {
        logger.warn('billPipeline', '[billPipeline] Claude returned status=failed — falling back to GPT-4o-mini');
      }
    } catch (err) {
      logger.warn('billPipeline', '[billPipeline] Claude extraction threw error — falling back to GPT:', err instanceof Error ? err.message : err);
    }
  } else {
    logger.debug('billPipeline', '[billPipeline] ANTHROPIC_API_KEY not set — using GPT-4o-mini directly');
  }

  // Fallback: GPT-4o-mini text extraction
  if ('rawText' in input) {
    return aiExtractBillData(input.rawText);
  }

  // If we have an image but Claude failed/unavailable, we can't do GPT vision here
  // (the route handler's image pipeline will handle it separately)
  logger.warn('billPipeline', '[billPipeline] Claude failed on image input and GPT text fallback unavailable — returning null');
  return null;
}

/**
 * aiExtractBillData — Layer 2 (GPT-4o-mini fallback)
 *
 * Sends raw text to GPT-4o-mini with a structured JSON prompt.
 * Format-agnostic: works on ANY utility bill text regardless of layout.
 * Hard 10-second timeout — never blocks the pipeline.
 *
 * @deprecated Use aiExtractBillDataWithClaude() for new code.
 *   This function is retained as the GPT fallback path.
 */
export async function aiExtractBillData(rawText: string): Promise<AiBillData | null> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    logger.debug('billPipeline', '[billPipeline] AI extraction skipped — no OPENAI_API_KEY');
    return null;
  }

  if (!rawText || rawText.trim().length < 20) {
    logger.debug('billPipeline', '[billPipeline] AI extraction skipped — text too short');
    return null;
  }

  logger.debug('billPipeline', `[billPipeline] AI extraction starting — textLen=${rawText.length}`);
  // PII REDACTED: raw OCR text must not appear in server logs

  // ── Log ALL kWh-like numbers found in the text for debugging ──────────────
  const kwhCandidates = extractAllKwhCandidates(rawText);
  logger.debug('billPipeline', `[billPipeline] kWh candidates found (${kwhCandidates.length}): ${kwhCandidates.map(c => `${c.value}(${c.label})`).join(', ')}`);

  const SYSTEM_PROMPT = `You are a utility bill data extraction expert. Extract structured data from utility bill text.

Return ONLY valid JSON matching this exact schema (use null for any field not found or uncertain):
{
  "utility_name": "string - utility company name (e.g. Dominion Energy, PG&E, Duke Energy)",
  "billing_period_start": "string - billing period start date in YYYY-MM-DD format. Handle formats like 07/18/25 - 08/15/25 or Jul 18, 2025",
  "billing_period_end": "string - billing period end date in YYYY-MM-DD format",
  "total_kwh": "number - the CURRENT MONTH electricity usage in kWh. PRIORITY ORDER: (1) Look for Billable Usage (kWh) or Billable Usage - use that number. (2) Total Usage, Electric Usage, kWh Used, kWh This Period. (3) Meter reading difference (current minus previous). IGNORE: average daily usage (e.g. 23 kWh/day), historical chart bars, prior year values, small numbers under 100 kWh unless the bill is very small. If multiple large kWh values exist, choose the one most recently labeled as current period usage.",
  "monthly_kwh": "array of numbers - ONLY fill this from a usage history chart or table showing MULTIPLE MONTHS. Extract all months shown oldest to newest. Leave null if no multi-month history is shown.",
  "total_cost": "number - the current charges for THIS billing period only. PRIORITY ORDER: (1) Current Electric Charges or Current Charges. (2) Total Current Charges. (3) Amount Due ONLY if there is no separate current charges line. IGNORE: Balance Forward, Previous Balance, Account Balance which may include prior unpaid amounts. Remove dollar signs and commas.",
  "electricity_rate": "number - cost per kWh in dollars. Convert cents to dollars: 12.5 cents/kWh becomes 0.125",
  "account_number": "string - account or customer number",
  "customer_name": "string - customer/account holder name",
  "service_address": "string - service/property address (not mailing address)",
  "bill_type": "electric or gas or combined or unknown"
}

CRITICAL RULES:
- total_kwh is the SINGLE number for current month usage. A reasonable monthly residential bill is 300 to 4000 kWh. Never use average daily usage (23 kWh) as the monthly total.
- monthly_kwh are the HISTORICAL bars/columns - a separate array from total_kwh.
- Billing dates in MM/DD/YY format: 07/18/25 means 2025-07-18.
- Return ONLY the JSON object, no explanation.`;

  const callAI = async (text: string): Promise<AiBillData | null> => {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        max_tokens: 1200,
        temperature: 0,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Extract data from this utility bill:\n\n${sanitizeForPrompt(text)}` },
        ],
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      logger.warn('billPipeline', `[billPipeline] AI extraction HTTP ${res.status}`);
      return null;
    }

    const completion = await res.json();
    const raw = completion.choices?.[0]?.message?.content ?? '{}';
    logger.debug('billPipeline', '[billPipeline] AI response:', raw.slice(0, 500));

    let ai: Partial<AiBillData> = {};
    try { ai = JSON.parse(raw); } catch { ai = {}; }

    // Parse total_kwh — handle string with commas
    let totalKwh: number | null = null;
    if (typeof ai.total_kwh === 'number' && ai.total_kwh > 0) {
      totalKwh = ai.total_kwh;
    } else if (typeof ai.total_kwh === 'string') {
      const parsed = parseFloat((ai.total_kwh as string).replace(/[^0-9.]/g, ''));
      if (!isNaN(parsed) && parsed > 0) totalKwh = parsed;
    }

    // Parse total_cost — handle "$1,435.40" strings
    let totalCost: number | null = null;
    if (typeof ai.total_cost === 'number' && ai.total_cost > 0) {
      totalCost = ai.total_cost;
    } else if (typeof ai.total_cost === 'string') {
      const parsed = parseFloat((ai.total_cost as string).replace(/[^0-9.]/g, ''));
      if (!isNaN(parsed) && parsed > 0) totalCost = parsed;
    }

    // Parse billing dates — handle MM/DD/YY, MM/DD/YYYY, and date ranges "07/18/25 - 08/15/25"
    const parseBillingDate = (raw: unknown): string | null => {
      if (typeof raw !== 'string' || !raw) return null;
      const s = raw.trim();
      // Already ISO format
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      // MM/DD/YY or MM/DD/YYYY
      const mdyMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
      if (mdyMatch) {
        const [, m, d, y] = mdyMatch;
        const year = y.length === 2 ? (parseInt(y) >= 50 ? `19${y}` : `20${y}`) : y;
        return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
      }
      // Month name formats: "Jul 18, 2025" or "July 18 2025"
      const monMatch = s.match(/^(\w+)\s+(\d{1,2}),?\s+(\d{4})$/);
      if (monMatch) {
        const months: Record<string,string> = {jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
        const mon = months[monMatch[1].toLowerCase().slice(0,3)];
        if (mon) return `${monMatch[3]}-${mon}-${monMatch[2].padStart(2,'0')}`;
      }
      return s; // Return as-is if can't parse
    };

    // Handle date range format "07/18/25 - 08/15/25" in billing_period_start
    let bpStart = ai.billing_period_start ?? null;
    let bpEnd = ai.billing_period_end ?? null;
    if (typeof bpStart === 'string' && bpStart.includes(' - ') && !bpEnd) {
      const parts = bpStart.split(' - ');
      bpStart = parts[0].trim();
      bpEnd = parts[1]?.trim() ?? null;
    }

    const result: AiBillData = {
      utility_name:          typeof ai.utility_name === 'string' && ai.utility_name.length > 1 ? ai.utility_name : null,
      billing_period_start:  parseBillingDate(bpStart),
      billing_period_end:    parseBillingDate(bpEnd),
      total_kwh:             totalKwh,
      monthly_kwh:           Array.isArray(ai.monthly_kwh) && ai.monthly_kwh.length >= 2
                               ? (ai.monthly_kwh as any[])
                                   .map((v: any) => typeof v === 'number' ? v : parseFloat(String(v)))
                                   .filter((v: number) => !isNaN(v) && v > 0 && v <= 100000)
                                   .slice(0, 13)
                               : null,
      total_cost:            totalCost,
      electricity_rate:      typeof ai.electricity_rate === 'number' && ai.electricity_rate > 0 && ai.electricity_rate < 5
                               ? ai.electricity_rate : null,
      account_number:        typeof ai.account_number === 'string' ? ai.account_number : null,
      customer_name:         typeof ai.customer_name === 'string' ? ai.customer_name : null,
      service_address:       typeof ai.service_address === 'string' ? ai.service_address : null,
      bill_type:             ['electric','gas','combined','unknown'].includes(ai.bill_type as string)
                               ? (ai.bill_type as AiBillData['bill_type']) : 'unknown',
    };

    // Failsafe: if AI returned an implausible monthly kWh, try to correct from candidates
    if (result.total_kwh !== null) {
      const kwh = result.total_kwh;
      if (kwh < 100 || kwh > 10000) {
        logger.warn('billPipeline', `[billPipeline] AI total_kwh=${kwh} is out of plausible range (100-10000) — checking candidates`);
        const bestCandidate = pickBestKwhCandidate(kwhCandidates);
        if (bestCandidate !== null) {
          logger.debug('billPipeline', `[billPipeline] Overriding AI total_kwh=${kwh} with candidate=${bestCandidate} (from text analysis)`);
          result.total_kwh = bestCandidate;
        } else {
          logger.warn('billPipeline', `[billPipeline] No plausible kWh candidate found — keeping AI value ${kwh}`);
        }
      } else {
        logger.debug('billPipeline', `[billPipeline] AI total_kwh=${kwh} is plausible (in range 100-10000)`);
      }
    } else if (kwhCandidates.length > 0) {
      // AI returned null for total_kwh — try to fill from text analysis
      const bestCandidate = pickBestKwhCandidate(kwhCandidates);
      if (bestCandidate !== null) {
        logger.debug('billPipeline', `[billPipeline] AI returned null total_kwh — using candidate=${bestCandidate} from text analysis`);
        result.total_kwh = bestCandidate;
      }
    }

    logger.debug('billPipeline', `[billPipeline] AI result: utility=${result.utility_name} kwh=${result.total_kwh} months=${result.monthly_kwh?.length ?? 0} cost=${result.total_cost} period=${result.billing_period_start} to ${result.billing_period_end}`);
    return result;
  };

  try {
    return await callAI(rawText.substring(0, 6000));
  } catch (err) {
    logger.warn('billPipeline', '[billPipeline] AI extraction failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

// ─── kWh candidate extraction (text analysis, not regex-dependent parsing) ───

interface KwhCandidate {
  value: number;
  label: string;   // surrounding label for debug
  priority: number; // higher = more likely to be the correct monthly total
}

/**
 * extractAllKwhCandidates — scans text for ALL numeric values near "kWh" mentions
 * and scores them by label priority.
 * Used for: (1) debug logging of all candidates, (2) fallback when AI fails.
 */
function extractAllKwhCandidates(text: string): KwhCandidate[] {
  const candidates: KwhCandidate[] = [];
  const lines = text.split('\n');

  for (const line of lines) {
    // Find all numbers on lines containing kWh
    if (!/kwh|kw-h|kilowatt/i.test(line)) continue;

    // Special case: "NNNN KWH @ rate amount" pattern — extract ONLY the value before KWH
    // This avoids picking up the rate (0.098) or charge amount (186.79) on the same line
    const kwhAtMatch = line.match(/\b(\d{1,5}(?:,\d{3})*)\s*kwh\s*@/i);
    if (kwhAtMatch) {
      const kwhValue = parseFloat(kwhAtMatch[1].replace(/,/g, ''));
      if (!isNaN(kwhValue) && kwhValue >= 100 && kwhValue <= 99999) {
        let priority = 88;
        if (kwhValue >= 200 && kwhValue <= 4000) priority += 10;
        candidates.push({ value: kwhValue, label: line.trim().slice(0, 80), priority });
        continue; // skip generic number extraction for this line
      }
    }

    const nums = [...line.matchAll(/\b(\d{1,5}(?:,\d{3})*(?:\.\d+)?)\b/g)]
      .map(m => parseFloat(m[1].replace(/,/g, '')))
      .filter(n => !isNaN(n) && n > 0);

    for (const value of nums) {
      if (value < 1 || value > 99999) continue;

      // Score by label quality
      let priority = 0;
      const lline = line.toLowerCase();

      // Highest priority: explicit "Billable Usage" label (Dominion Energy)
      if (/billable\s+usage/i.test(line))                    priority = 100;
      // High: "Total Usage", "Electric Usage", "kWh Used", "kWh This Period"
      else if (/total\s+(?:electric\s+)?usage/i.test(line))  priority = 90;
      else if (/electric\s+usage/i.test(line))               priority = 85;
      else if (/kwh\s+used|used\s+kwh/i.test(line))          priority = 85;
      else if (/kwh\s+this\s+period|this\s+period/i.test(line)) priority = 85;
      else if (/energy\s+used|energy\s+usage/i.test(line))   priority = 80;
      else if (/consumption/i.test(line))                    priority = 75;
      // High: "NNNN KWH @ rate" pattern — direct energy charge line (Milford-style bills)
      // e.g. "1906 KWH @ .098 186.79" — the kWh value precedes "KWH @"
      else if (/\d+\s*kwh\s*@/i.test(line))                  priority = 88;
      // High: "Energy Charge" lines that contain kWh value
      else if (/energy\s+charge/i.test(line))                priority = 82;
      // Medium: meter readings, current reading
      else if (/meter|reading/i.test(line))                  priority = 40;
      // Low: generic "kWh" lines
      else priority = 20;

      // Penalize values that are clearly wrong
      if (value < 50)   priority -= 60;  // Avg daily usage (e.g. 23 kWh)
      if (value > 8000) priority -= 20;  // Very high (possible but rare)

      // Penalize "avg", "average", "daily", "per day" context
      if (/avg|average|daily|per\s+day/i.test(lline)) priority -= 50;

      // Reward typical residential range 200-4000 kWh
      if (value >= 200 && value <= 4000) priority += 10;

      candidates.push({ value, label: line.trim().slice(0, 80), priority });
    }
  }

  // Deduplicate by value (keep highest priority for each value)
  const deduped = new Map<number, KwhCandidate>();
  for (const c of candidates) {
    const existing = deduped.get(c.value);
    if (!existing || c.priority > existing.priority) {
      deduped.set(c.value, c);
    }
  }

  return [...deduped.values()].sort((a, b) => b.priority - a.priority);
}

/**
 * pickBestKwhCandidate — returns the highest-priority plausible kWh value
 * from a list of candidates. Returns null if nothing plausible found.
 */
function pickBestKwhCandidate(candidates: KwhCandidate[]): number | null {
  const plausible = candidates.filter(c => c.value >= 100 && c.value <= 10000 && c.priority > 0);
  if (plausible.length === 0) return null;
  const best = plausible[0]; // already sorted by priority desc
  logger.debug('billPipeline', `[billPipeline] Best kWh candidate: ${best.value} (priority=${best.priority} label="${best.label}")`);
  return best.value;
}

// ─── Layer 3: Validation ──────────────────────────────────────────────────────

export interface PipelineValidationResult {
  valid: boolean;
  reasons: string[];
}

/**
 * validatePipelineBillData — Layer 3
 *
 * Returns { valid: true } when the data has at least:
 *   - Some kWh usage in a plausible range (100–10000)
 *   - OR some location/utility info
 * Returns { valid: false, reasons } with specific failure reasons.
 *
 * Failsafe range checks (per spec):
 *   - total_kwh < 100  → likely picked avg daily usage instead of monthly total → invalid
 *   - total_kwh > 10000 → implausible for residential monthly usage → invalid
 */
export function validatePipelineBillData(data: AiBillData | null): PipelineValidationResult {
  const reasons: string[] = [];

  if (!data) {
    return { valid: false, reasons: ['No AI result returned'] };
  }

  // kWh range validation
  let hasKwh = false;
  if (data.total_kwh !== null && data.total_kwh > 0) {
    if (data.total_kwh < 100) {
      reasons.push(`total_kwh=${data.total_kwh} is too low (< 100) — likely avg daily usage, not monthly total`);
    } else if (data.total_kwh > 10000) {
      reasons.push(`total_kwh=${data.total_kwh} is too high (> 10000) — likely misread or annual figure`);
    } else {
      hasKwh = true;
    }
  }

  // Monthly history counts as valid kWh even if total_kwh is bad
  if (!hasKwh && data.monthly_kwh !== null && data.monthly_kwh.length >= 3) {
    const reasonable = data.monthly_kwh.filter(v => v >= 100 && v <= 10000);
    if (reasonable.length >= 3) hasKwh = true;
  }

  const hasCost = data.total_cost !== null && data.total_cost > 0;
  const hasLocation = !!(data.service_address || data.utility_name);

  if (!hasKwh) reasons.push('No plausible kWh usage found');
  if (!hasCost) reasons.push('No bill cost found');
  if (!hasLocation) reasons.push('No location/utility found');

  // Valid if we have kWh (minimum to size a solar system)
  // OR if we have cost + utility (enough to proceed with manual sizing)
  const valid = hasKwh || (hasCost && hasLocation);

  logger.debug('billPipeline', `[billPipeline] Validation: valid=${valid} kwh=${data.total_kwh} hasKwh=${hasKwh} hasCost=${hasCost} hasLocation=${hasLocation} reasons=[${reasons.join('; ')}]`);
  return { valid, reasons };
}

// ─── AI Result → BillExtractResult mapping ───────────────────────────────────

/**
 * mapAiResultToBillExtractResult — converts AI JSON → existing BillExtractResult shape
 *
 * Preserves 100% backward compatibility with all existing consumers.
 */
export function mapAiResultToBillExtractResult(
  ai: AiBillData,
  rawText: string,
  extractionMethod: string,
): BillExtractResult {
  const monthlyHistory = ai.monthly_kwh && ai.monthly_kwh.length >= 2
    ? ai.monthly_kwh.filter(v => v > 0)
    : undefined;

  const monthsFound = monthlyHistory?.length ?? 0;

  const estimatedAnnualKwh =
    (monthsFound >= 10 ? monthlyHistory!.reduce((a, b) => a + b, 0) : undefined)
    ?? (monthsFound >= 3 ? Math.round(monthlyHistory!.reduce((a, b) => a + b, 0) / monthsFound * 12) : undefined)
    ?? (ai.total_kwh ? ai.total_kwh * 12 : undefined);

  // Pair monthlyKwh with annual on the SAME basis (average month) rather than an
  // arbitrary last-history bar — otherwise rate = currentCost / monthlyKwh mixes a
  // single month's kWh with the current period's dollars.
  const monthlyKwh = ai.total_kwh
    ?? (estimatedAnnualKwh
        ? Math.round(estimatedAnnualKwh / 12)
        : (monthlyHistory && monthlyHistory.length > 0
            ? Math.round(monthlyHistory[monthlyHistory.length - 1])
            : undefined));

  const extractedFields: string[] = [];
  if (ai.utility_name)         extractedFields.push('utilityProvider');
  if (ai.customer_name)        extractedFields.push('customerName');
  if (ai.service_address)      extractedFields.push('serviceAddress');
  if (ai.account_number)       extractedFields.push('accountNumber');
  if (monthlyKwh !== undefined) extractedFields.push('monthlyKwh');
  if (monthlyHistory && monthlyHistory.length > 0) extractedFields.push('monthlyUsageHistory');
  if (ai.electricity_rate)     extractedFields.push('electricityRate');
  if (ai.total_cost)           extractedFields.push('totalAmount');
  if (ai.billing_period_start) extractedFields.push('billingPeriod');

  const confidence: 'high' | 'medium' | 'low' =
    (monthsFound >= 10 || (estimatedAnnualKwh !== undefined && monthsFound >= 3)) ? 'high'
    : (monthsFound >= 3 || estimatedAnnualKwh !== undefined) ? 'medium'
    : 'low';

  return {
    success: extractedFields.length > 0,
    utilityProvider:     ai.utility_name ?? undefined,
    customerName:        ai.customer_name ?? undefined,
    serviceAddress:      ai.service_address ?? undefined,
    accountNumber:       ai.account_number ?? undefined,
    billingPeriodStart:  ai.billing_period_start ?? undefined,
    billingPeriodEnd:    ai.billing_period_end ?? undefined,
    monthlyKwh,
    annualKwh:           undefined,  // AI doesn't return explicit annual separate from sum
    monthlyUsageHistory: monthlyHistory,
    totalAmount:         ai.total_cost ?? undefined,
    electricityRate:     ai.electricity_rate ?? undefined,
    estimatedAnnualKwh,
    billType:            ai.bill_type ?? 'unknown',
    confidence,
    extractedFields,
    usedLlmFallback: true,
    rawText,
    // Fields not extracted by AI (retain undefined)
    billingDays:         undefined,
    fixedCharges:        undefined,
    demandCharge:        undefined,
    demandKw:            undefined,
    tier1Kwh:            undefined,
    tier2Kwh:            undefined,
    tier1Rate:           undefined,
    tier2Rate:           undefined,
    gasUsageTherm:       undefined,
    estimatedMonthlyBill: undefined,
    // v47.306: Bill Intelligence Layer — additive, never replaces existing fields
    billInsights: computeBillInsights(
      rawText,
      ai.total_cost ?? undefined,
      monthlyKwh ?? undefined,
      ai.electricity_rate ?? undefined,
    ),
  };
}

// ─── Master Pipeline ──────────────────────────────────────────────────────────

export interface PipelineResult {
  success: boolean;
  data?: BillExtractResult;
  rawText?: string;
  extractionMethod?: string;
  error?: string;
}

/**
 * parseUtilityBill — Master Pipeline
 *
 * Flow:
 *   1. extractBillText()          — get raw text (all methods, with timeouts)
 *   2. Log raw OCR output
 *   3. aiExtractBillData()        — AI structured extraction (10s timeout)
 *   4. validatePipelineBillData() — check result quality
 *   5. If invalid → retry AI once with first 3000 chars focused prompt
 *   6. If still invalid → return structured error
 *   7. Map to BillExtractResult and return
 *
 * The outer pipeline is wrapped in a 55s timeout (stays under Vercel's 60s limit).
 */
export async function parseUtilityBill(
  buffer: Buffer,
  mimeType: string,
): Promise<PipelineResult> {
  const startMs = Date.now();

  logger.debug('billPipeline', `[billPipeline] parseUtilityBill START mime=${mimeType} bytes=${buffer.length}`);

  try {
    // ── Step 1: Extract raw text ─────────────────────────────────────────────
    const extraction = await raceTimeout(
      extractBillText(buffer, mimeType),
      45000,
      'extractBillText'
    );

    const { text: rawText, method: extractionMethod } = extraction;
    logger.debug('billPipeline', `[billPipeline] Text extraction: method=${extractionMethod} chars=${rawText.length} ms=${Date.now() - startMs}`);

    if (!rawText || rawText.trim().length < 20) {
      return {
        success: false,
        rawText: '',
        extractionMethod,
        error: 'Bill text could not be extracted. Please try a clearer image or enter your usage manually.',
      };
    }

    // ── Step 2: Log raw OCR text ─────────────────────────────────────────────
    logger.debug('billPipeline', '[billPipeline] === RAW OCR TEXT START ===');
    rawText.split('\n').slice(0, 60).forEach(line => {
      if (line.trim()) console.log(`[ocr] ${line}`);
    });
    logger.debug('billPipeline', '[billPipeline] === RAW OCR TEXT END ===');

    // ── Step 3: AI structured extraction ────────────────────────────────────
    // v48.0: Claude 3.5 Sonnet is the primary extraction engine; GPT-4o-mini is the fallback
    let aiResult = await aiExtractBillDataWithClaude({ rawText });
    logger.debug('billPipeline', `[billPipeline] AI extraction (Claude primary): ms=${Date.now() - startMs}`);

    // ── Step 4: Validate ─────────────────────────────────────────────────────
    let validation = validatePipelineBillData(aiResult);
    logger.debug('billPipeline', `[billPipeline] Validation result: valid=${validation.valid} reasons=${validation.reasons.join(', ')}`);

    // ── Step 5: Retry once if kWh is out of range or missing ─────────────────
    // Use a focused prompt targeting the second half of the bill text (where
    // Billable Usage / meter readings tend to appear on multi-column layouts)
    const needsKwhRetry = !validation.valid
      || (aiResult?.total_kwh !== null && aiResult?.total_kwh !== undefined
          && (aiResult.total_kwh < 100 || aiResult.total_kwh > 10000));

    if (needsKwhRetry && rawText.trim().length > 50) {
      logger.debug('billPipeline', `[billPipeline] kWh retry triggered — kwh=${aiResult?.total_kwh} reasons=${validation.reasons.join(', ')}`);
      // Try with a different text slice: middle section often has meter data
      const midStart = Math.floor(rawText.length * 0.3);
      const focusedText = rawText.slice(midStart, midStart + 4000);
      const retryResult = await aiExtractBillDataWithClaude({ rawText: focusedText });
      const retryValidation = validatePipelineBillData(retryResult);
      logger.debug('billPipeline', `[billPipeline] Retry validation: valid=${retryValidation.valid} kwh=${retryResult?.total_kwh} ms=${Date.now() - startMs}`);

      // Use retry result if it's better
      if (retryValidation.valid && retryResult) {
        // Merge: keep original metadata (utility, address, etc.) but take better kWh
        if (aiResult && retryResult.total_kwh !== null && retryResult.total_kwh !== undefined) {
          const mergedKwh = (retryResult.total_kwh >= 100 && retryResult.total_kwh <= 10000)
            ? retryResult.total_kwh
            : aiResult.total_kwh;
          aiResult = {
            ...aiResult,
            total_kwh: mergedKwh,
            monthly_kwh: retryResult.monthly_kwh ?? aiResult.monthly_kwh,
            billing_period_start: aiResult.billing_period_start ?? retryResult.billing_period_start,
            billing_period_end: aiResult.billing_period_end ?? retryResult.billing_period_end,
          };
        } else {
          aiResult = retryResult;
        }
        validation = validatePipelineBillData(aiResult);
      }
    }

    // ── Step 6: Return error if still invalid ────────────────────────────────
    if (!validation.valid || !aiResult) {
      logger.warn('billPipeline', `[billPipeline] Pipeline failed — validation reasons: ${validation.reasons.join(', ')}`);
      return {
        success: false,
        rawText,
        extractionMethod,
        error: 'Unable to parse bill. Please check the file is a utility bill and try again, or enter your usage manually.',
      };
    }

    // ── Step 7: Map to BillExtractResult ─────────────────────────────────────
    const billData = mapAiResultToBillExtractResult(aiResult, rawText, extractionMethod);
    logger.debug('billPipeline', `[billPipeline] SUCCESS: fields=${billData.extractedFields.length} confidence=${billData.confidence} ms=${Date.now() - startMs}`);

    return {
      success: true,
      data: billData,
      rawText,
      extractionMethod,
    };

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[billPipeline] Unhandled error:', msg);
    return {
      success: false,
      rawText: '',
      extractionMethod: 'error',
      error: msg.includes('timed out')
        ? 'Bill processing timed out. Please try a smaller file or try again.'
        : 'Bill processing failed. Please try again.',
    };
  }
}