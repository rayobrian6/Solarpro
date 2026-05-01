// ============================================================
// GET /api/engineering/permit-preview?projectId=xxx&sheet=PV-0
//
// Returns a single-page HTML document for iframe preview in the
// permit plan viewer (/engineering/permit).
//
// Architecture (v47.312):
//   1. Load the saved permit HTML from project_files
//      (file_name = 'permit_planset.html', saved by POST /api/engineering/permit)
//   2. Extract the Nth .page div that corresponds to the requested sheet
//   3. Wrap it in a minimal HTML shell and return it
//
// Sheet index (matches generatePermitHTML page assembly order exactly):
//   PV-0  → page index 0  (Cover Sheet)
//   PV-1  → page index 1  (Site Information)
//   PV-2  → page index 2  (Array Plan — Roof / Ground / Fence, system-routed)
//   PV-2B → page index 3  (Array Geometry & String Layout)
//   PV-3  → page index 4  (Structural Details — system-routed)
//   PV-4A → page index 5  (NEC Compliance)
//   PV-4B → page index 6  (Conductor Schedule)
//   PV-4C → page index 7  (Structural Calculations — ASCE 7-22)
//   PV-5  → page index 8  (Warning Labels)
//   SCHED → page index 9  (Equipment Schedule)
//   APP-A → page index 10 (Specification Sheets)
//   CERT  → page index 11 (Engineering Certification)
//   PE-1  → page index 12 (PE Structural Letter)
//   E-1   → page index 13 (Single-Line Diagram)
//
// If no saved HTML exists the route returns a styled "not yet generated"
// guidance page instead of an error.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest }         from '@/lib/auth';
import { getDbReady, isValidUUID }    from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

export const dynamic     = 'force-dynamic';
export const runtime     = 'nodejs';
export const maxDuration = 30;

// ── Sheet ID → page index map (must match generatePermitHTML page order) ──────
// v47.312: Sheet ID → page index map — must match generatePermitHTML() assembly order exactly.
// Page indices (0-based):
//   0=PV-0  1=PV-1  2=PV-2  3=PV-2B  4=PV-3  5=PV-4A  6=PV-4B  7=PV-4C
//   8=PV-5  9=SCHED  10=APP-A  11=CERT  12=PE-1  13=E-1
const SHEET_PAGE_INDEX: Record<string, number> = {
  'PV-0':  0,   // Cover Sheet
  'PV-1':  1,   // Site Information
  'PV-2':  2,   // Array Plan (Roof / Ground / Fence — system-routed)
  'PV-2B': 3,   // Array Geometry & String Layout
  'PV-3':  4,   // Structural Details (system-routed)
  'PV-4A': 5,   // NEC Compliance
  'PV-4B': 6,   // Conductor Schedule
  'PV-4C': 7,   // Structural Calculations (ASCE 7-22)
  'PV-5':  8,   // Warning Labels
  'SCHED': 9,   // Equipment Schedule
  'APP-A': 10,  // Specification Sheets
  'CERT':  11,  // Engineering Certification
  'PE-1':  12,  // PE Structural Letter
  'E-1':   13,  // Single-Line Diagram
};

const VALID_SHEETS = Object.keys(SHEET_PAGE_INDEX);

export async function GET(req: NextRequest) {
  try {
    // v48.6: Rate limiting — 10 req / 30s per IP (protects heavy compute + external APIs)
        const _rl = await checkRateLimit('engineering', getClientIp(req));
    if (!_rl.allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many requests. Please slow down.' },
        { status: 429 }
      );
    }

    // ── Auth ──────────────────────────────────────────────────────────────────
    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get('projectId');
    const sheetId   = (searchParams.get('sheet') ?? 'PV-0').toUpperCase();

    if (!projectId || !isValidUUID(projectId)) {
      return new NextResponse(
        errorPage('projectId (UUID) is required.'),
        { status: 400, headers: { 'Content-Type': 'text/html' } }
      );
    }

    if (!VALID_SHEETS.includes(sheetId)) {
      return new NextResponse(
        errorPage(`Sheet "${sheetId}" is not valid. Valid sheets: ${VALID_SHEETS.join(', ')}`),
        { status: 404, headers: { 'Content-Type': 'text/html' } }
      );
    }

    // ── Ownership check ───────────────────────────────────────────────────────
    const sql = await getDbReady();
    const projectRows = await sql`
      SELECT id, user_id, name
      FROM projects
      WHERE id = ${projectId}
        AND deleted_at IS NULL
    `;
    if (projectRows.length === 0) {
      return new NextResponse(errorPage('Project not found.'), {
        status: 404, headers: { 'Content-Type': 'text/html' },
      });
    }
    const projectRow = projectRows[0];
    if (projectRow.user_id !== user.id) {
      const roleRows = await sql`SELECT role FROM users WHERE id = ${user.id}`;
      if (roleRows[0]?.role !== 'super_admin' && roleRows[0]?.role !== 'admin') {
        return new NextResponse(errorPage('Forbidden.'), {
          status: 403, headers: { 'Content-Type': 'text/html' },
        });
      }
    }

    // ── Load saved permit HTML from project_files ─────────────────────────────
    const fileRows = await sql`
      SELECT file_data
      FROM project_files
      WHERE project_id = ${projectId}
        AND user_id    = ${projectRow.user_id}
        AND file_name  = 'permit_planset.html'
      LIMIT 1
    `;

    if (fileRows.length === 0 || !fileRows[0].file_data) {
      // No permit has been generated yet — return a friendly guidance page
      return new NextResponse(notGeneratedPage(projectId), {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }

    // ── Decode the stored HTML ────────────────────────────────────────────────
    const raw = fileRows[0].file_data instanceof Buffer
      ? fileRows[0].file_data.toString('utf8')
      : String(fileRows[0].file_data);

    // ── Extract the global stylesheet from the <style> block ─────────────────
    // The permit HTML has one big <style> block inside <head>. We need to
    // include it in the single-page preview so styles render correctly.
    const styleMatch = raw.match(/<style>([\s\S]*?)<\/style>/i);
    const globalStyle = styleMatch ? styleMatch[1] : '';

    // ── Extract the Nth .page div ─────────────────────────────────────────────
    // Strategy: split on class="page" boundaries. Each page is a top-level div.
    // We use a simple regex to find all <div class="page"...>...</div> blocks.
    const pageIndex = SHEET_PAGE_INDEX[sheetId] ?? 0;
    const pageHtml  = extractPageByIndex(raw, pageIndex);

    if (!pageHtml) {
      return new NextResponse(
        errorPage(`Could not extract page ${pageIndex + 1} (${sheetId}) from the saved permit. Try regenerating the permit.`),
        { status: 404, headers: { 'Content-Type': 'text/html' } }
      );
    }

    // ── Wrap in a minimal shell with the global styles ────────────────────────
    const fullHtml = wrapPage(pageHtml, globalStyle, sheetId, projectRow.name || projectId);

    return new NextResponse(fullHtml, {
      status: 200,
      headers: {
        'Content-Type':  'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });

  } catch (err: unknown) {
    console.error('[permit-preview] Error:', err);
    return new NextResponse(errorPage(`Internal error: ${(err as Error)?.message ?? 'Unknown error'}`), {
      status: 500,
      headers: { 'Content-Type': 'text/html' },
    });
  }
}

// ── extractPageByIndex ─────────────────────────────────────────────────────────
// Finds the Nth top-level <div class="page"> element in the HTML string.
// Uses a simple character-walking approach to handle nested divs correctly.

function extractPageByIndex(html: string, index: number): string | null {
  // Find all starting positions of class="page" divs
  const pageStarts: number[] = [];
  const searchStr = 'class="page"';
  let pos = 0;

  while (pos < html.length) {
    const found = html.indexOf(searchStr, pos);
    if (found === -1) break;

    // Walk backwards to find the opening <div
    let divStart = found;
    while (divStart > 0 && html[divStart] !== '<') divStart--;

    // Verify it's a <div
    if (html.substring(divStart, divStart + 4) === '<div') {
      pageStarts.push(divStart);
    }
    pos = found + searchStr.length;
  }

  if (index >= pageStarts.length) return null;

  const start = pageStarts[index];
  // Find the matching closing </div> by tracking nesting depth
  const end = findClosingDiv(html, start);
  if (end === -1) return null;

  return html.substring(start, end + 6); // +6 for "</div>"
}

// ── findClosingDiv ─────────────────────────────────────────────────────────────
// Given the position of an opening <div, walk forward tracking nesting depth
// and return the position of the matching </div>.

function findClosingDiv(html: string, openPos: number): number {
  let depth = 0;
  let pos   = openPos;

  while (pos < html.length) {
    const nextOpen  = html.indexOf('<div', pos);
    const nextClose = html.indexOf('</div>', pos);

    if (nextClose === -1) return -1;

    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      pos = nextOpen + 4;
    } else {
      depth--;
      if (depth === 0) return nextClose;
      pos = nextClose + 6;
    }
  }
  return -1;
}

// ── wrapPage ──────────────────────────────────────────────────────────────────
// Wraps an extracted .page div in a full HTML document with the global styles.

function wrapPage(pageHtml: string, globalStyle: string, sheetId: string, projectName: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${sheetId} — ${projectName}</title>
<style>
/* Global permit stylesheet */
${globalStyle}

/* Preview shell overrides */
html, body {
  margin: 0;
  padding: 0;
  background: #e8e8e8;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  min-height: 100vh;
}

/* Scale the 17×11 engineering sheet to fit the viewport */
.page-wrapper {
  padding: 20px;
  width: 100%;
  display: flex;
  justify-content: center;
}

.page {
  transform-origin: top center;
  box-shadow: 0 4px 20px rgba(0,0,0,0.3);
  background: #fff;
}
</style>
</head>
<body>
<div class="page-wrapper">
${pageHtml}
</div>
</body>
</html>`;
}

// ── notGeneratedPage ──────────────────────────────────────────────────────────
// Shown when no permit has been generated for this project yet.

function notGeneratedPage(projectId: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Permit Not Generated</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    font-family: Arial, 'Helvetica Neue', sans-serif;
    background: #111827;
    color: #f9fafb;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
  }
  .box {
    background: #1f2937;
    border: 1px solid #374151;
    border-radius: 12px;
    padding: 40px 48px;
    max-width: 520px;
    text-align: center;
  }
  .icon { font-size: 48px; margin-bottom: 16px; }
  h2 { font-size: 20px; font-weight: 700; margin-bottom: 12px; color: #f59e0b; }
  p  { color: #9ca3af; font-size: 14px; line-height: 1.6; margin-bottom: 16px; }
  .steps {
    background: #111827;
    border-radius: 8px;
    padding: 16px 20px;
    text-align: left;
    margin-top: 8px;
  }
  .steps li {
    color: #d1d5db;
    font-size: 13px;
    line-height: 1.8;
    margin-left: 16px;
  }
  .steps li::marker { color: #10b981; }
</style>
</head>
<body>
  <div class="box">
    <div class="icon">📋</div>
    <h2>Permit Package Not Yet Generated</h2>
    <p>No permit plan set has been generated for this project. Generate the permit to enable sheet-by-sheet preview.</p>
    <div class="steps">
      <ol class="steps">
        <li>Open the <strong>Engineering</strong> tab for this project</li>
        <li>Ensure the design pipeline is complete (green status)</li>
        <li>Click <strong>Generate Permit Package</strong></li>
        <li>Return here — all 14 sheets will be available</li>
      </ol>
    </div>
  </div>
</body>
</html>`;
}

// ── errorPage ─────────────────────────────────────────────────────────────────

function errorPage(message: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Preview Error</title>
<style>
  body { font-family: Arial, sans-serif; background: #1a1a1a; color: #fff;
         display: flex; align-items: center; justify-content: center;
         min-height: 100vh; margin: 0; }
  .box { background: #2a2a2a; border: 1px solid #444; border-radius: 8px;
         padding: 32px; max-width: 480px; text-align: center; }
  .icon { font-size: 40px; margin-bottom: 12px; }
  h2 { margin: 0 0 10px; color: #f59e0b; }
  p  { color: #aaa; font-size: 14px; line-height: 1.5; }
</style>
</head>
<body>
  <div class="box">
    <div class="icon">⚠️</div>
    <h2>Preview Unavailable</h2>
    <p>${message}</p>
  </div>
</body>
</html>`;
}