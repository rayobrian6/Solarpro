/**
 * lib/pdf/generatePdf.ts
 *
 * Shared PDF generation utility for all SolarPro PDF export routes.
 *
 * Strategy:
 *   1. Try Puppeteer + @sparticuz/chromium-min (works on Vercel serverless)
 *   2. Fall back to wkhtmltopdf (works in sandbox / self-hosted)
 *   3. Return null if both fail (callers serve HTML as fallback)
 *
 * Usage:
 *   import { generatePdfFromHtml, PdfOptions } from '@/lib/pdf/generatePdf';
 *   const pdf = await generatePdfFromHtml(html, { format: 'Letter' });
 */

import { writeFile, readFile, unlink } from 'fs/promises';
import path from 'path';
import os from 'os';

export interface PdfOptions {
  /** Puppeteer PDF format (default: 'Letter') */
  format?: 'Letter' | 'A4' | 'Legal';
  /** Page width for wkhtmltopdf (e.g. '8.5in') — only used as fallback */
  widthIn?: string;
  /** Page height for wkhtmltopdf (e.g. '11in') — only used as fallback */
  heightIn?: string;
  /** Landscape orientation (default: false) */
  landscape?: boolean;
  /** Print media type (default: true) */
  printBackground?: boolean;
  /** Margin (Puppeteer style, default: '0' on all sides) */
  margin?: { top?: string; right?: string; bottom?: string; left?: string };
  /** Scale factor for Puppeteer (default: 1) */
  scale?: number;
  /** Timeout in ms (default: 40000) */
  timeout?: number;
  /** D4 — verify the embedded canonical faces before printing (default true).
   *  Only a non-authoritative preview may set this false. */
  requireCanonicalFonts?: boolean;
  /** D4 — refuse the wkhtmltopdf preview fallback. Any caller producing a
   *  permit-release artifact MUST set this: a preview PDF has different
   *  geometry and must never be mistaken for the approved one. */
  authoritativeOnly?: boolean;
}

/** D4 — the machine-readable marker every non-authoritative PDF carries. */
export const NON_AUTHORITATIVE_NOTICE = 'NON-AUTHORITATIVE PREVIEW — NOT FOR PERMIT SUBMISSION';

/** D4 — a canonical-font failure. It is a DISTINCT error type because the
 *  puppeteer path's own try/catch turns every failure into `null`, and `null`
 *  means "fall through to wkhtmltopdf". A font mismatch must never become a
 *  silent substitution, so this one escapes the catch and propagates. */
export class CanonicalFontError extends Error {
  readonly isCanonicalFontError = true;
  constructor(message: string) { super(message); this.name = 'CanonicalFontError'; }
}

// ── Puppeteer + chromium-min ──────────────────────────────────────────────────
async function generateWithPuppeteer(html: string, opts: PdfOptions): Promise<Uint8Array | null> {
  try {
    // Dynamically import so the module is tree-shaken in environments that don't need it
    const puppeteer = await import('puppeteer-core');
    const chromium  = require('@sparticuz/chromium-min');

    // chromium.executablePath() returns a remote URL on Lambda/Vercel pointing to
    // a compressed Chromium binary hosted on S3. It downloads + caches it on first use.
    const execPath: string = await chromium.executablePath(
      'https://github.com/Sparticuz/chromium/releases/download/v147.0.0/chromium-v147.0.0-pack.tar'
    );

    const browser = await puppeteer.launch({
      args:            chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath:  execPath,
      headless:        true,
    });

    const page = await browser.newPage();

    // Set content directly (avoids file:// URL issues in serverless)
    await page.setContent(html, { waitUntil: 'load', timeout: opts.timeout ?? 40000 });

    // ── D4 — THE AUTHORITATIVE FONT GATE ──────────────────────────────────
    // The browser PDF is the authoritative artifact, so it must be rendered by
    // the SAME embedded bytes the HTML declares — never by a Lambda-installed
    // face or a fontconfig substitution. Waiting for `document.fonts.ready` is
    // NOT sufficient on its own: a malformed or substituted face can still leave
    // the status 'loaded'. Each canonical face is checked individually, and the
    // metrics are measured with NO fallback in the stack so a missing face
    // measures as the generic default rather than quietly passing.
    const fontState = await page.evaluate(async () => {
      await (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready;
      const d = document as unknown as { fonts: { status: string; size: number; check(f: string): boolean } };
      const ctx = document.createElement('canvas').getContext('2d')!;
      const S = 'MMMMMMWWWWiiiill1234567890 The quick brown fox jumps over the lazy dog';
      const w = (f: string): number => { ctx.font = f; return +ctx.measureText(S).width.toFixed(2); };
      return {
        status: d.fonts.status,
        size: d.fonts.size,
        checks: {
          sans400: d.fonts.check('400 16px "SolarPro Sans"'),
          sans700: d.fonts.check('700 16px "SolarPro Sans"'),
          mono400: d.fonts.check('400 16px "SolarPro Mono"'),
          mono700: d.fonts.check('700 16px "SolarPro Mono"'),
          symbols: d.fonts.check('400 16px "SolarPro Symbols"'),
        },
        sansPx: w('400 16px "SolarPro Sans"'),
        monoPx: w('400 16px "SolarPro Mono"'),
      };
    });
    if (opts.requireCanonicalFonts !== false) {
      const missing = Object.entries(fontState.checks).filter(([, ok]) => !ok).map(([k]) => k);
      const TOL = 0.015;
      const sansOff = Math.abs(fontState.sansPx - 571.73) / 571.73 > TOL;
      const monoOff = Math.abs(fontState.monoPx - 672.11) / 672.11 > TOL;
      if (missing.length || sansOff || monoOff) {
        // FAIL CLOSED. Returning null here would silently fall through to
        // wkhtmltopdf, which is exactly the substitution this gate exists to
        // prevent — so it throws instead.
        await browser.close();
        // MUST be CanonicalFontError, not a plain Error. The catch below only
        // re-throws this class; a plain Error is swallowed into `return null`,
        // which means "try wkhtmltopdf" — the exact silent substitution this
        // gate exists to prevent. The class was declared and instanceof-checked
        // but never constructed anywhere in the repo, so the fail-closed
        // refusal had never once fired.
        throw new CanonicalFontError(
          'AUTHORITATIVE PDF REFUSED — the canonical font pack did not render.\n'
          + `  faces not loaded : ${missing.join(', ') || 'none'}\n`
          + `  fonts.status     : ${fontState.status} (${fontState.size} faces)\n`
          + `  SolarPro Sans    : ${fontState.sansPx}px (expected 571.73 ±1.5%)\n`
          + `  SolarPro Mono    : ${fontState.monoPx}px (expected 672.11 ±1.5%)\n`
          + 'A permit PDF rendered with substituted fonts has different geometry from the '
          + 'approved artifact. Fix the embed; do not fall back.',
        );
      }
    }

    // Explicit page dimensions win over 'format' — the permit planset is
    // ANSI B (17in × 11in); ignoring widthIn/heightIn printed engineering
    // sheets onto Letter paper. With explicit dims the orientation is already
    // encoded (17 wide × 11 high IS landscape), so landscape must be false or
    // Chrome transposes the paper a second time.
    const pdfBuffer = await page.pdf({
      ...(opts.widthIn && opts.heightIn
        ? { width: opts.widthIn, height: opts.heightIn, landscape: false }
        : { format: opts.format ?? 'Letter', landscape: opts.landscape ?? false }),
      printBackground: opts.printBackground ?? true,
      margin: {
        top:    opts.margin?.top    ?? '0',
        right:  opts.margin?.right  ?? '0',
        bottom: opts.margin?.bottom ?? '0',
        left:   opts.margin?.left   ?? '0',
      },
      scale: opts.scale ?? 1,
      timeout: opts.timeout ?? 40000,
    });

    await browser.close();
    return new Uint8Array(pdfBuffer);
  } catch (err) {
    // A canonical-font failure is NOT a "puppeteer failed, try something else"
    // condition. Swallowing it here would return null and hand the job to
    // wkhtmltopdf — producing a permit PDF with substituted fonts and different
    // geometry, which is the exact outcome the gate exists to prevent.
    // Duck-type as well as instanceof: bundlers can duplicate this module in a
    // serverless build, and two copies of the class make `instanceof` false for
    // an object that IS a canonical-font failure — which would silently restore
    // the swallow this fix removes.
    if (err instanceof CanonicalFontError
      || (err as { isCanonicalFontError?: boolean })?.isCanonicalFontError === true) throw err;
    console.warn('[generatePdf] Puppeteer failed:', (err as Error).message?.substring(0, 200));
    return null;
  }
}

// ── wkhtmltopdf (local/sandbox fallback) ─────────────────────────────────────
async function generateWithWkhtmltopdf(html: string, opts: PdfOptions): Promise<Uint8Array | null> {
  const tmpDir  = os.tmpdir();
  const ts      = Date.now();
  const htmlPath = path.join(tmpDir, `sp-pdf-${ts}.html`);
  const pdfPath  = path.join(tmpDir, `sp-pdf-${ts}.pdf`);

  try {
    await writeFile(htmlPath, html, 'utf8');

    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);

    const args = [
      '--margin-top',    '0',
      '--margin-right',  '0',
      '--margin-bottom', '0',
      '--margin-left',   '0',
      '--dpi',           '150',
      '--image-dpi',     '150',
      '--image-quality', '90',
      '--enable-local-file-access',
      '--disable-smart-shrinking',
      '--zoom',          String(opts.scale ?? 1),
      '--quiet',
      '--print-media-type',
    ];

    // Page geometry — the two forms are MUTUALLY EXCLUSIVE.
    //
    // Explicit dimensions already encode orientation (24 wide × 18 high IS
    // landscape). Passing `--orientation Landscape` alongside them makes Qt
    // transpose the paper a SECOND time, so a 24×18 engineering sheet prints on
    // an 18×24 portrait page — the identical double-transposition the puppeteer
    // branch documents and avoids. The previous code emitted --orientation
    // unconditionally and then spliced out only --page-size, leaving the
    // transposing flag in place.
    if (opts.widthIn && opts.heightIn) {
      args.push('--page-width', opts.widthIn, '--page-height', opts.heightIn);
    } else {
      args.push('--page-size',   opts.format === 'A4' ? 'A4' : 'Letter');
      args.push('--orientation', opts.landscape ? 'Landscape' : 'Portrait');
    }

    args.push(htmlPath, pdfPath);

    await execFileAsync('wkhtmltopdf', args, { timeout: opts.timeout ?? 40000 });
    return new Uint8Array(await readFile(pdfPath));
  } catch (err) {
    console.warn('[generatePdf] wkhtmltopdf failed:', (err as Error).message?.substring(0, 200));
    return null;
  } finally {
    try { await unlink(htmlPath); } catch { /* ignore */ }
    try { await unlink(pdfPath); } catch { /* ignore */ }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate a PDF from HTML string.
 * Tries Puppeteer first (Vercel-compatible), falls back to wkhtmltopdf.
 * Returns null if both fail — callers should serve HTML as last resort.
 */
export async function generatePdfFromHtml(
  html: string,
  opts: PdfOptions = {}
): Promise<{ pdf: Uint8Array; method: string; authoritative: boolean; previewOnly?: boolean; notice?: string } | null> {
  // 1. Try Puppeteer (works on Vercel serverless via @sparticuz/chromium-min).
  //    D4: this is THE AUTHORITATIVE PATH. It verifies the embedded canonical
  //    faces before printing and THROWS on a mismatch rather than returning
  //    null — a font failure must not become a silent fallback.
  const puppeteerPdf = await generateWithPuppeteer(html, opts);
  if (puppeteerPdf) return { pdf: puppeteerPdf, method: 'puppeteer', authoritative: true };

  // 2. wkhtmltopdf — PREVIEW ONLY.
  //    D4: wkhtmltopdf does not consume the embedded WOFF2 faces the same way
  //    Chromium does, so its geometry is not the approved geometry. It may never
  //    satisfy permit release, engineering approval, acceptance page-fit,
  //    snapshot digest approval or golden comparison. Callers that need an
  //    authoritative artifact must pass `authoritativeOnly` and get null here.
  if (opts.authoritativeOnly) {
    console.warn('[generatePdf] authoritative PDF unavailable; refusing the non-authoritative preview fallback.');
    return null;
  }
  const wkPdf = await generateWithWkhtmltopdf(html, opts);
  if (wkPdf) return { pdf: wkPdf, method: 'wkhtmltopdf', authoritative: false, previewOnly: true, notice: NON_AUTHORITATIVE_NOTICE };

  // 3. Both failed
  return null;
}
