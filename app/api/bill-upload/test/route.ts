import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';

// eslint-disable-next-line @typescript-eslint/no-var-requires
let PDFParse: any = null;
let pdfParseError = '';
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const m = require('pdf-parse');
  PDFParse = m.PDFParse ?? m.default?.PDFParse ?? null;
} catch (e: unknown) {
  pdfParseError = e instanceof Error ? e.message : String(e);
}

export const maxDuration = 60;

// GET — environment check only (no file needed)
export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  return NextResponse.json({
    runtime: process.env.VERCEL ? 'vercel' : 'local',
    nodeVersion: process.version,
    hasOpenAI: !!process.env.OPENAI_API_KEY,
    openaiKeyPrefix: process.env.OPENAI_API_KEY?.slice(0, 7) || null,
    hasGoogleMaps: !!process.env.GOOGLE_MAPS_API_KEY,
    pdfParseLoaded: !!PDFParse,
    pdfParseError: pdfParseError || null,
    timestamp: new Date().toISOString(),
  });
}

// POST — upload a PDF and get back raw debug info for each extraction method
export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get('file') as File | null;

  const debug: Record<string, any> = {
    runtime: process.env.VERCEL ? 'vercel' : 'local',
    nodeVersion: process.version,
    hasOpenAI: !!process.env.OPENAI_API_KEY,
    openaiKeyPrefix: process.env.OPENAI_API_KEY?.slice(0, 7) || null,
    hasGoogleMaps: !!process.env.GOOGLE_MAPS_API_KEY,
    pdfParseLoaded: !!PDFParse,
    pdfParseError: pdfParseError || null,
    steps: [] as any[],
  };

  if (!file) {
    return NextResponse.json({ ...debug, error: 'No file uploaded' });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  debug.fileSize = buffer.length;
  debug.fileName = file.name;
  debug.fileType = file.type;

  // Step 1: pdf-parse
  try {
    if (PDFParse) {
      const parser = new PDFParse({ data: buffer });
      await parser.load();
      const result = await parser.getText();
      const text = (result.text || '').trim();
      debug.steps.push({ method: 'pdf-parse', chars: text.length, preview: text.substring(0, 150), success: text.length > 50 });
    } else {
      debug.steps.push({ method: 'pdf-parse', error: 'PDFParse class not loaded: ' + pdfParseError, success: false });
    }
  } catch (e: unknown) {
    debug.steps.push({ method: 'pdf-parse', error: e instanceof Error ? e.message : String(e), success: false });
  }

  // Step 2: Raw text extraction from PDF buffer
  try {
    const rawText = buffer.toString('latin1');
    const readable = rawText.match(/[\x20-\x7E]{4,}/g) || [];
    const hint = readable.join(' ').replace(/\s+/g, ' ').slice(0, 500);
    debug.steps.push({ method: 'raw-text-extract', chars: hint.length, preview: hint.substring(0, 150), success: hint.length > 100 });
  } catch (e: unknown) {
    debug.steps.push({ method: 'raw-text-extract', error: e instanceof Error ? e.message : String(e), success: false });
  }

  // Step 3: OpenAI Files API with user_data purpose + Responses API
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    let uploadedFileId: string | null = null;

    // 3a: Upload file
    try {
      const fd = new FormData();
      fd.append('file', new Blob([new Uint8Array(buffer)], { type: 'application/pdf' }), 'bill.pdf');
      fd.append('purpose', 'user_data');

      const uploadRes = await fetch('https://api.openai.com/v1/files', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${openaiKey}` },
        body: fd,
        signal: AbortSignal.timeout(15000),
      });

      if (!uploadRes.ok) {
        const err = await uploadRes.text();
        debug.steps.push({ method: 'openai-upload-user_data', httpStatus: uploadRes.status, error: err.slice(0, 300), success: false });
      } else {
        const uploadData = await uploadRes.json();
        uploadedFileId = uploadData.id;
        debug.steps.push({ method: 'openai-upload-user_data', fileId: uploadedFileId, purpose: uploadData.purpose, success: true });
      }
    } catch (e: unknown) {
      debug.steps.push({ method: 'openai-upload-user_data', error: e instanceof Error ? e.message : String(e), success: false });
    }

    // 3b: Responses API
    if (uploadedFileId) {
      try {
        const respRes = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
          body: JSON.stringify({
            model: 'gpt-4o',
            input: [
              {
                role: 'user',
                content: [
                  { type: 'input_file', file_id: uploadedFileId },
                  { type: 'input_text', text: 'Extract all text from this utility bill. Output only raw text.' },
                ],
              },
            ],
          }),
          signal: AbortSignal.timeout(30000),
        });

        if (respRes.ok) {
          const respData = await respRes.json();
          const text = respData?.output?.[0]?.content?.[0]?.text?.trim()
            ?? respData?.output?.[0]?.content?.trim();
          debug.steps.push({
            method: 'openai-responses-api',
            httpStatus: 200,
            chars: text?.length || 0,
            preview: text?.substring(0, 150),
            responseKeys: Object.keys(respData),
            outputStructure: JSON.stringify(respData?.output?.[0]).slice(0, 200),
            success: (text?.length || 0) > 50,
          });
        } else {
          const err = await respRes.text();
          debug.steps.push({ method: 'openai-responses-api', httpStatus: respRes.status, error: err.slice(0, 400), success: false });
        }
      } catch (e: unknown) {
        debug.steps.push({ method: 'openai-responses-api', error: e instanceof Error ? e.message : String(e), success: false });
      }

      // Cleanup
      fetch(`https://api.openai.com/v1/files/${uploadedFileId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${openaiKey}` },
      }).catch(() => {});
    }

    // 3c: GPT-4o with raw text hint
    try {
      const rawText = buffer.toString('latin1');
      const readable = rawText.match(/[\x20-\x7E]{4,}/g) || [];
      const hint = readable.join(' ').replace(/\s+/g, ' ').slice(0, 4000);

      if (hint.length > 200) {
        const chatRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
          body: JSON.stringify({
            model: 'gpt-4o',
            max_tokens: 500,
            messages: [
              { role: 'system', content: 'You are a utility bill parser. Reconstruct bill info from raw PDF text.' },
              { role: 'user', content: `Raw PDF text (first 4000 chars):\n\n${hint}\n\nExtract: customer name, address, kWh usage, bill amount, utility name.` },
            ],
          }),
          signal: AbortSignal.timeout(20000),
        });

        if (chatRes.ok) {
          const chatData = await chatRes.json();
          const text = chatData?.choices?.[0]?.message?.content?.trim();
          debug.steps.push({ method: 'gpt4o-text-hint', chars: text?.length || 0, preview: text?.substring(0, 150), success: (text?.length || 0) > 50 });
        } else {
          const err = await chatRes.text();
          debug.steps.push({ method: 'gpt4o-text-hint', httpStatus: chatRes.status, error: err.slice(0, 200), success: false });
        }
      } else {
        debug.steps.push({ method: 'gpt4o-text-hint', error: 'Not enough readable text in PDF', hintLength: hint.length, success: false });
      }
    } catch (e: unknown) {
      debug.steps.push({ method: 'gpt4o-text-hint', error: e instanceof Error ? e.message : String(e), success: false });
    }
  } else {
    debug.steps.push({ method: 'openai-all', error: 'No OPENAI_API_KEY set', success: false });
  }

  return NextResponse.json(debug);
}