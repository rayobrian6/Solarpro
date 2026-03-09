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

export const maxDuration = 30;

// POST /api/bill-upload/test — upload a PDF and get back raw debug info
// Shows exactly which extraction method works and what text was extracted
export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get('file') as File | null;

  const debug: Record<string, any> = {
    runtime: process.env.VERCEL ? 'vercel' : 'local',
    nodeVersion: process.version,
    hasOpenAI: !!process.env.OPENAI_API_KEY,
    hasGoogleMaps: !!process.env.GOOGLE_MAPS_API_KEY,
    pdfParseLoaded: !!PDFParse,
    pdfParseError: pdfParseError || null,
    steps: [],
  };

  if (!file) {
    return NextResponse.json({ ...debug, error: 'No file uploaded' });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  debug.fileSize = buffer.length;
  debug.fileName = file.name;

  // Step 1: pdf-parse
  try {
    if (PDFParse) {
      const parser = new PDFParse({ data: buffer });
      await parser.load();
      const result = await parser.getText();
      const text = (result.text || '').trim();
      debug.steps.push({ method: 'pdf-parse', chars: text.length, preview: text.substring(0, 100), success: text.length > 50 });
    } else {
      debug.steps.push({ method: 'pdf-parse', error: 'PDFParse class not loaded', success: false });
    }
  } catch (e: unknown) {
    debug.steps.push({ method: 'pdf-parse', error: e instanceof Error ? e.message : String(e), success: false });
  }

  // Step 2: OpenAI Files API
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    try {
      const fd = new FormData();
      fd.append('file', new Blob([new Uint8Array(buffer)], { type: 'application/pdf' }), 'bill.pdf');
      fd.append('purpose', 'assistants');

      const uploadRes = await fetch('https://api.openai.com/v1/files', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${openaiKey}` },
        body: fd,
        signal: AbortSignal.timeout(15000),
      });

      if (!uploadRes.ok) {
        const err = await uploadRes.text();
        debug.steps.push({ method: 'openai-upload', httpStatus: uploadRes.status, error: err.slice(0, 200), success: false });
      } else {
        const uploadData = await uploadRes.json();
        const fileId = uploadData.id;
        debug.steps.push({ method: 'openai-upload', fileId, success: true });

        // Try responses API
        const chatRes = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
          body: JSON.stringify({
            model: 'gpt-4o',
            input: [{
              role: 'user',
              content: [
                { type: 'input_text', text: 'Extract all text from this utility bill. Output only raw text.' },
                { type: 'input_file', file_id: fileId },
              ],
            }],
          }),
          signal: AbortSignal.timeout(25000),
        });

        // Cleanup
        fetch(`https://api.openai.com/v1/files/${fileId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${openaiKey}` },
        }).catch(() => {});

        if (chatRes.ok) {
          const chatData = await chatRes.json();
          const text = chatData?.output?.[0]?.content?.[0]?.text?.trim();
          debug.steps.push({ method: 'openai-responses-api', chars: text?.length || 0, preview: text?.substring(0, 100), success: (text?.length || 0) > 50, responseKeys: Object.keys(chatData) });
        } else {
          const err = await chatRes.text();
          debug.steps.push({ method: 'openai-responses-api', httpStatus: chatRes.status, error: err.slice(0, 300), success: false });
        }
      }
    } catch (e: unknown) {
      debug.steps.push({ method: 'openai-files-api', error: e instanceof Error ? e.message : String(e), success: false });
    }
  } else {
    debug.steps.push({ method: 'openai-files-api', error: 'No OPENAI_API_KEY', success: false });
  }

  return NextResponse.json(debug);
}

// GET — environment check only
export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  return NextResponse.json({
    runtime: process.env.VERCEL ? 'vercel' : 'local',
    nodeVersion: process.version,
    hasOpenAI: !!process.env.OPENAI_API_KEY,
    hasGoogleMaps: !!process.env.GOOGLE_MAPS_API_KEY,
    pdfParseLoaded: !!PDFParse,
    pdfParseError: pdfParseError || null,
  });
}