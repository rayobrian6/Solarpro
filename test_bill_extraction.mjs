/**
 * Standalone test for bill-upload extraction methods
 * Run: node test_bill_extraction.mjs
 * 
 * Tests each method independently to find what works on this runtime
 */

import { readFileSync } from 'fs';
import { execSync } from 'child_process';

const PDF_PATH = '2026_01_20_15594002.pdf';
const buffer = readFileSync(PDF_PATH);

console.log(`\n📄 Testing bill extraction on: ${PDF_PATH} (${buffer.length} bytes)\n`);
console.log('='.repeat(60));

// ── Test 1: pdf-parse ──────────────────────────────────────────
console.log('\n[1] Testing pdf-parse...');
try {
  const { createRequire } = await import('module');
  const require = createRequire(import.meta.url);
  const m = require('pdf-parse');
  const PDFParse = m.PDFParse;
  if (!PDFParse) throw new Error('PDFParse class not found in module');
  const parser = new PDFParse({ data: buffer });
  await parser.load();
  const result = await parser.getText();
  const text = (result.text || '').trim();
  console.log(`✅ pdf-parse: extracted ${text.length} chars`);
  console.log(`   Preview: ${text.substring(0, 100).replace(/\n/g, ' ')}`);
} catch (e) {
  console.log(`❌ pdf-parse failed: ${e.message}`);
}

// ── Test 2: pdftotext CLI ──────────────────────────────────────
console.log('\n[2] Testing pdftotext CLI...');
try {
  const { writeFileSync, readFileSync: rfs, unlinkSync } = await import('fs');
  const { tmpdir } = await import('os');
  const { join } = await import('path');
  const tmpIn = join(tmpdir(), `test_bill_${Date.now()}.pdf`);
  const tmpOut = join(tmpdir(), `test_bill_${Date.now()}.txt`);
  writeFileSync(tmpIn, buffer);
  execSync(`pdftotext -layout "${tmpIn}" "${tmpOut}"`, { timeout: 15000 });
  const text = rfs(tmpOut, 'utf-8');
  try { unlinkSync(tmpIn); } catch {}
  try { unlinkSync(tmpOut); } catch {}
  console.log(`✅ pdftotext: extracted ${text.trim().length} chars`);
  console.log(`   Preview: ${text.substring(0, 100).replace(/\n/g, ' ')}`);
} catch (e) {
  console.log(`❌ pdftotext failed: ${e.message}`);
}

// ── Test 3: OpenAI API key check ───────────────────────────────
console.log('\n[3] Checking OPENAI_API_KEY...');
const openaiKey = process.env.OPENAI_API_KEY;
if (!openaiKey) {
  console.log('⚠️  OPENAI_API_KEY not set — skipping OpenAI tests');
  console.log('   Set it with: OPENAI_API_KEY=sk-... node test_bill_extraction.mjs');
} else {
  console.log(`✅ OPENAI_API_KEY found: ${openaiKey.substring(0, 10)}...`);

  // ── Test 3a: pdf2pic conversion ──────────────────────────────
  console.log('\n[3a] Testing pdf2pic → PNG conversion...');
  let imageBuffer = null;
  try {
    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);
    const pdf2picModule = require('pdf2pic');
    const fromBuffer = pdf2picModule.fromBuffer || pdf2picModule.default?.fromBuffer;
    if (!fromBuffer) throw new Error('fromBuffer not found in pdf2pic');
    const converter = fromBuffer(buffer, { density: 200, format: 'png', width: 1700, height: 2200 });
    const page = await converter(1, { responseType: 'buffer' });
    if (page?.buffer) {
      imageBuffer = page.buffer;
      console.log(`✅ pdf2pic: converted to PNG (${imageBuffer.length} bytes)`);
    } else {
      throw new Error('No buffer returned from converter');
    }
  } catch (e) {
    console.log(`❌ pdf2pic failed: ${e.message}`);
  }

  // ── Test 3b: OpenAI Vision with PNG ─────────────────────────
  if (imageBuffer) {
    console.log('\n[3b] Testing OpenAI Vision (PDF→PNG→GPT-4o)...');
    try {
      const base64 = imageBuffer.toString('base64');
      const dataUrl = `data:image/png;base64,${base64}`;
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          max_tokens: 500,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: 'Extract all text from this utility bill image. Output only the raw text.' },
              { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
            ],
          }],
        }),
        signal: AbortSignal.timeout(25000),
      });
      if (res.ok) {
        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content?.trim();
        console.log(`✅ OpenAI Vision (PNG): extracted ${text?.length || 0} chars`);
        console.log(`   Preview: ${(text || '').substring(0, 100).replace(/\n/g, ' ')}`);
      } else {
        const err = await res.text();
        console.log(`❌ OpenAI Vision failed: HTTP ${res.status} — ${err.slice(0, 200)}`);
      }
    } catch (e) {
      console.log(`❌ OpenAI Vision error: ${e.message}`);
    }
  }

  // ── Test 3c: OpenAI Files API ────────────────────────────────
  console.log('\n[3c] Testing OpenAI Files API (upload PDF → gpt-4o)...');
  try {
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(buffer)], { type: 'application/pdf' }), 'bill.pdf');
    fd.append('purpose', 'assistants');

    const uploadRes = await fetch('https://api.openai.com/v1/files', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${openaiKey}` },
      body: fd,
      signal: AbortSignal.timeout(20000),
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      throw new Error(`Upload failed: HTTP ${uploadRes.status} — ${err.slice(0, 200)}`);
    }

    const uploadData = await uploadRes.json();
    const fileId = uploadData.id;
    console.log(`   Uploaded file ID: ${fileId}`);

    const chatRes = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: 'Extract all text from this utility bill PDF. Output only the raw text.' },
            { type: 'input_file', file_id: fileId },
          ],
        }],
      }),
      signal: AbortSignal.timeout(30000),
    });

    // Cleanup
    fetch(`https://api.openai.com/v1/files/${fileId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${openaiKey}` },
    }).catch(() => {});

    if (chatRes.ok) {
      const chatData = await chatRes.json();
      const text = chatData?.output?.[0]?.content?.[0]?.text?.trim()
        ?? chatData?.choices?.[0]?.message?.content?.trim();
      console.log(`✅ OpenAI Files API: extracted ${text?.length || 0} chars`);
      console.log(`   Preview: ${(text || '').substring(0, 100).replace(/\n/g, ' ')}`);
    } else {
      const err = await chatRes.text();
      console.log(`❌ OpenAI Files API chat failed: HTTP ${chatRes.status} — ${err.slice(0, 300)}`);
    }
  } catch (e) {
    console.log(`❌ OpenAI Files API error: ${e.message}`);
  }
}

console.log('\n' + '='.repeat(60));
console.log('Test complete.\n');