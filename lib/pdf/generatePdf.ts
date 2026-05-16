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
}

// ── Puppeteer + chromium-min ──────────────────────────────────────────────────
async function generateWithPuppeteer(html: string, opts: PdfOptions): Promise<Uint8Array | null> {
  try {
    // Dynamically import so the module is tree-shaken in environments that don't need it
    const puppeteer = await import('puppeteer-core');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
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

    const pdfBuffer = await page.pdf({
      format:          opts.format ?? 'Letter',
      landscape:       opts.landscape ?? false,
      printBackground: opts.printBackground ?? true,
      margin: {
        top:    opts.margin?.top    ?? '0',
        right:  opts.margin?.right  ?? '0',
        bottom: opts.margin?.bottom ?? '0',
        left:   opts.margin?.left   ?? '0',
      },
      scale: opts.scale ?? 1,
    });

    await browser.close();
    return new Uint8Array(pdfBuffer);
  } catch (err) {
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
      '--page-size',       opts.format === 'A4' ? 'A4' : 'Letter',
      '--orientation',     opts.landscape ? 'Landscape' : 'Portrait',
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

    // Custom page dimensions (e.g. 24in x 18in for engineering sheets)
    if (opts.widthIn && opts.heightIn) {
      args.push('--page-width', opts.widthIn, '--page-height', opts.heightIn);
      // Remove the --page-size we added above since custom size overrides it
      const sizeIdx = args.indexOf('--page-size');
      if (sizeIdx >= 0) args.splice(sizeIdx, 2);
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
): Promise<{ pdf: Uint8Array; method: string } | null> {
  // 1. Try Puppeteer (works on Vercel serverless via @sparticuz/chromium-min)
  const puppeteerPdf = await generateWithPuppeteer(html, opts);
  if (puppeteerPdf) return { pdf: puppeteerPdf, method: 'puppeteer' };

  // 2. Fall back to wkhtmltopdf (works in sandbox / self-hosted)
  const wkPdf = await generateWithWkhtmltopdf(html, opts);
  if (wkPdf) return { pdf: wkPdf, method: 'wkhtmltopdf' };

  // 3. Both failed
  return null;
}
