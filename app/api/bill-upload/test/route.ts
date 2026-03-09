import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';

// eslint-disable-next-line @typescript-eslint/no-var-requires
let PDFParse: any = null;
let pdfParseLoadError = '';
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const m = require('pdf-parse');
  PDFParse = m.PDFParse ?? m.default?.PDFParse ?? null;
} catch (e: unknown) {
  pdfParseLoadError = e instanceof Error ? e.message : String(e);
}

// GET /api/bill-upload/test — diagnostic endpoint
// Returns info about what extraction methods are available on this runtime
export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results: Record<string, any> = {
    runtime: process.env.VERCEL ? 'vercel' : 'local',
    nodeVersion: process.version,
    env: {
      hasOpenAI: !!process.env.OPENAI_API_KEY,
      hasGoogleMaps: !!process.env.GOOGLE_MAPS_API_KEY,
      hasVercel: !!process.env.VERCEL,
    },
    pdfParse: {
      loaded: !!PDFParse,
      loadError: pdfParseLoadError || null,
      type: PDFParse ? typeof PDFParse : null,
    },
    pdftotext: false,
    pdf2pic: false,
  };

  // Test pdftotext CLI
  try {
    const { execSync } = require('child_process');
    execSync('pdftotext -v', { timeout: 3000, stdio: 'pipe' });
    results.pdftotext = true;
  } catch {
    results.pdftotext = false;
  }

  // Test pdf2pic
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pdf2picModule = require('pdf2pic');
    const fromBuffer = pdf2picModule.fromBuffer || pdf2picModule.default?.fromBuffer;
    results.pdf2pic = !!fromBuffer;
  } catch (e: unknown) {
    results.pdf2pic = false;
    results.pdf2picError = e instanceof Error ? e.message : String(e);
  }

  // Test OpenAI connectivity (just a HEAD check, no actual call)
  if (process.env.OPENAI_API_KEY) {
    try {
      const res = await fetch('https://api.openai.com/v1/models', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
        signal: AbortSignal.timeout(5000),
      });
      results.openaiConnectivity = res.ok ? 'ok' : `HTTP ${res.status}`;
    } catch (e: unknown) {
      results.openaiConnectivity = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
  } else {
    results.openaiConnectivity = 'no key';
  }

  return NextResponse.json(results);
}