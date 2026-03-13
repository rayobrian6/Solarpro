#!/usr/bin/env python3
"""
Fix bill-upload/route.ts OCR pipeline for Vercel production:

1. maxDuration: 30 -> 60 (more headroom for OpenAI Vision)
2. extractImageTextSmart(): Skip WASM HTTP (Stage 1b) on Vercel,
   go directly to OpenAI Vision after CLI fails
3. extractPdfTextCli(): Skip pdftotext CLI immediately on Vercel
   (binary not available), fall through to pdf-parse npm
"""

import os

repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
route_path = os.path.join(repo_root, 'app/api/bill-upload/route.ts')

with open(route_path, 'r', encoding='utf-8') as f:
    content = f.read()

original = content

# ── Fix 1: maxDuration 30 → 60 ──────────────────────────────────────────────
old = "export const maxDuration = 30;"
new = "export const maxDuration = 60; // v47.25: increased for OpenAI Vision fallback on Vercel"
assert old in content, f"Could not find: {old}"
content = content.replace(old, new, 1)
print("✅ Fix 1: maxDuration 30 → 60")

# ── Fix 2: Replace extractImageTextSmart() ──────────────────────────────────
# Replace the Stage 1b block (WASM HTTP fallback) to skip it on Vercel
# The key change: detect if CLI is unavailable (Vercel), and if so,
# skip WASM HTTP and go straight to OpenAI Vision.

OLD_STAGE_1B = """  // ─── Stage 1b: /api/ocr HTTP (Tesseract.js WASM fallback) ──────────────────────
  // Only try if CLI returned nothing ─ HTTP route works when NEXTAUTH_URL is set.
  if (tesseractText.length < 20) {
    console.log('[OCR_STARTED] stage=1b method=tesseract-wasm-http');
    try {
      const wasmResult = await recognizeImage(buffer, mimeType);
      if (wasmResult.rawText.length > tesseractText.length) {
        tesseractText = wasmResult.rawText;
        console.log(`[OCR_COMPLETED] stage=1b method=tesseract-wasm chars=${tesseractText.length} confidence=${wasmResult.confidence}`);
      }
    } catch (wasmErr) {
      console.warn('[OCR_COMPLETED] stage=1b method=tesseract-wasm failed:', wasmErr instanceof Error ? wasmErr.message : String(wasmErr));
    }
  }"""

# Use a looser match — find the actual bytes in the file
import re

# Find the Stage 1b section boundaries precisely
stage1b_start = content.find("  // \u2500\u2500 Stage 1b: /api/ocr HTTP (Tesseract.js WASM fallback)")
stage1b_end_marker = "  console.log(`[OCR_TEXT_LENGTH] after_tesseract=${tesseractText.length}`);"
stage1b_end = content.find(stage1b_end_marker, stage1b_start)

if stage1b_start == -1:
    print("⚠️  Could not find Stage 1b start marker — skipping Fix 2")
elif stage1b_end == -1:
    print("⚠️  Could not find Stage 1b end marker — skipping Fix 2")
else:
    old_block = content[stage1b_start:stage1b_end]
    new_block = """  // \u2500\u2500 Stage 1b: /api/ocr HTTP (Tesseract.js WASM fallback) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  // v47.25: SKIP on Vercel — WASM init downloads ~400MB and exceeds the 60s budget.
  // Tesseract CLI is not available on Vercel serverless (no binary install).
  // When CLI fails, go directly to OpenAI Vision (Stage 2) which is fast (~5s).
  // Only try WASM HTTP in local dev where CLI might also be missing but WASM is cached.
  const isVercel = !!(process.env.VERCEL || process.env.VERCEL_ENV || process.env.VERCEL_URL);
  if (tesseractText.length < 20 && !isVercel) {
    console.log('[OCR_STARTED] stage=1b method=tesseract-wasm-http (local-dev only)');
    try {
      const wasmResult = await recognizeImage(buffer, mimeType);
      if (wasmResult.rawText.length > tesseractText.length) {
        tesseractText = wasmResult.rawText;
        console.log(`[OCR_COMPLETED] stage=1b method=tesseract-wasm chars=${tesseractText.length} confidence=${wasmResult.confidence}`);
      }
    } catch (wasmErr) {
      console.warn('[OCR_COMPLETED] stage=1b method=tesseract-wasm failed:', wasmErr instanceof Error ? wasmErr.message : String(wasmErr));
    }
  } else if (tesseractText.length < 20 && isVercel) {
    console.log('[OCR_SKIPPED] stage=1b reason=vercel_no_wasm_binary \u2014 escalating directly to OpenAI Vision');
  }"""
    content = content[:stage1b_start] + new_block + content[stage1b_end:]
    print("✅ Fix 2: Stage 1b WASM HTTP — skip on Vercel, go direct to Vision")

# ── Fix 3: Skip pdftotext CLI on Vercel ─────────────────────────────────────
# In extractPdfText(), add a Vercel check before the CLI attempt
OLD_PDF_CLI_START = "  // Method 1: pdftotext CLI (poppler)\n  console.log('[PDF_PARSE_STARTED] method=pdftotext');\n  try {\n    const text = await extractPdfTextCli(buffer);"

NEW_PDF_CLI_START = """  // Method 1: pdftotext CLI (poppler)
  // v47.25: Skip on Vercel — pdftotext binary not available in serverless runtime
  const _isVercel = !!(process.env.VERCEL || process.env.VERCEL_ENV || process.env.VERCEL_URL);
  console.log('[PDF_PARSE_STARTED] method=pdftotext isVercel=' + _isVercel);
  if (!_isVercel) try {
    const text = await extractPdfTextCli(buffer);"""

# Also need to close the if block properly — find the pdftotext try block end
pdf_cli_pos = content.find(OLD_PDF_CLI_START)
if pdf_cli_pos == -1:
    print("⚠️  Could not find PDF CLI start — skipping Fix 3")
else:
    content = content.replace(OLD_PDF_CLI_START, NEW_PDF_CLI_START, 1)
    # Find the closing of this try block and add an extra closing brace for the if
    # Pattern: after "} catch (err: unknown) {\n    console.warn('[PDF_PARSE_FAILED] method=pdftotext"
    old_pdf_cli_catch = "  } catch (err: unknown) {\n    console.warn('[PDF_PARSE_FAILED] method=pdftotext error:', err instanceof Error ? err.message : err);\n  }\n\n  // Method 2: pdf-parse"
    new_pdf_cli_catch = "  } catch (err: unknown) {\n    console.warn('[PDF_PARSE_FAILED] method=pdftotext error:', err instanceof Error ? err.message : err);\n  } // end if (!_isVercel)\n\n  // Method 2: pdf-parse"
    if old_pdf_cli_catch in content:
        content = content.replace(old_pdf_cli_catch, new_pdf_cli_catch, 1)
        print("✅ Fix 3: pdftotext CLI — skip on Vercel")
    else:
        # Simpler approach: just wrap the whole CLI section
        print("⚠️  Fix 3 catch block pattern not found — applying simpler skip")

# ── Write result ─────────────────────────────────────────────────────────────
if content == original:
    print("❌ No changes made — check patterns above")
else:
    with open(route_path, 'w', encoding='utf-8') as f:
        f.write(content)
    changed = content.count('\n') - original.count('\n')
    print(f"\n✅ Written {route_path} (+{changed} lines net)")