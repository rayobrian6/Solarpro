// ============================================================================
// POST /api/portal/bill-upload
//
// Portal-specific bill upload endpoint.
//
// Flow:
//   1. Verify portal session (cookie auth)
//   2. Validate project_id belongs to this client
//   3. Check if bill already exists → return early if so (no duplicate)
//   4. Forward file to /api/bill-upload for parsing (reuse existing pipeline)
//   5. Save the ORIGINAL BYTES, then the parsed summary, to project_files
//   6. If current stage is 'lead_submitted' → advance to 'under_review'
//   7. Return { success, billData, stageAdvanced }
//
// Rules:
//   - Portal session cookie only (no bearer token)
//   - project_id must belong to the authenticated client
//   - Only renders upload UI when stage is lead_submitted or under_review
//   - Idempotent: duplicate upload returns existing bill confirmation
// ============================================================================

export const maxDuration = 60;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getDbReady, handleRouteDbError, isValidUUID } from '@/lib/db-neon';
import { getPortalSession } from '@/lib/portalAuth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
import { writeMicroStage } from '@/lib/microStage';
import {
  PORTAL_BILL_SUMMARY_FILE_NAME,
  portalOriginalBillFileName,
} from '@/lib/portal/documents';

/**
 * The name the summary row used to have. Kept ONLY so a project that uploaded
 * before the original bytes were retained is still recognised as "already
 * uploaded" and is not silently re-parsed.
 */
const LEGACY_SUMMARY_FILE_NAME = 'Utility_Bill_Summary.json';

export async function POST(req: NextRequest) {
  // ── Rate limit ────────────────────────────────────────────────────────────
  const rl = await checkRateLimit('portal_read', getClientIp(req));
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 });
  }

  // ── Auth — portal session only ────────────────────────────────────────────
  const session = getPortalSession(req);
  if (!session) {
    return NextResponse.json(
      { success: false, error: 'Not authenticated', code: 'PORTAL_AUTH_REQUIRED' },
      { status: 401 },
    );
  }

  try {
    const formData = await req.formData();
    const file      = formData.get('file') as File | null;
    const projectId = formData.get('project_id') as string | null;

    if (!file) {
      return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 });
    }
    if (!projectId || !isValidUUID(projectId)) {
      return NextResponse.json({ success: false, error: 'Invalid project_id' }, { status: 400 });
    }

    const sql = await getDbReady();

    // ── Verify project belongs to this client ─────────────────────────────
    const projectRows = await sql`
      SELECT id, homeowner_stage, client_id
      FROM projects
      WHERE id = ${projectId}
        AND client_id = ${session.clientId}
        AND deleted_at IS NULL
      LIMIT 1
    `;
    if (projectRows.length === 0) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    const project = projectRows[0];
    const currentStage = project.homeowner_stage as string | null;

    // ── Check for existing bill (prevent duplicate upload UI) ─────────────
    //
    // 🚨 SCOPED TO THE SUMMARY ROW, NOT TO ANY `utility_bill` FILE.
    //
    // This check used to match any row with `file_type = 'utility_bill'`, which
    // is now TWO rows per upload (the original bytes and the parsed summary). If
    // it kept matching either one, an upload that stored the bytes and then
    // failed before writing the summary would be permanently stuck: the route
    // would answer `alreadyExists` forever and the parse would never be redone.
    //
    // The SUMMARY is what proves a parse completed, so it is what "already
    // uploaded" means. A half-finished upload is now retryable, which is the
    // opposite of the state this finding was about.
    const existingBill = await sql`
      SELECT id, created_at
      FROM project_files
      WHERE project_id = ${projectId}
        AND file_type   = 'utility_bill'
        AND file_name   IN (${PORTAL_BILL_SUMMARY_FILE_NAME}, ${LEGACY_SUMMARY_FILE_NAME})
      LIMIT 1
    `;
    if (existingBill.length > 0) {
      return NextResponse.json({
        success:      true,
        alreadyExists: true,
        message:      'Utility bill already received.',
        uploadedAt:   existingBill[0].created_at,
      });
    }

    // ── Forward file to /api/bill-upload for parsing ──────────────────────
    const parseFormData = new FormData();
    parseFormData.append('file', file);

    const parseRes = await fetch(
      `${req.nextUrl.origin}/api/bill-upload`,
      {
        method:  'POST',
        headers: { Cookie: req.headers.get('cookie') || '' },
        body:    parseFormData,
      },
    );

    const parseJson = await parseRes.json();

    if (!parseJson.success || !parseJson.billData) {
      return NextResponse.json(
        {
          success: false,
          error:   parseJson.error || 'Bill parsing failed. Please try a clearer image.',
          stage:   parseJson.stage ?? null,
          allow_manual_entry: parseJson.allow_manual_entry ?? false,
        },
        { status: parseRes.status >= 400 ? parseRes.status : 422 },
      );
    }

    const billData = parseJson.billData;

    // ── Save the ORIGINAL BYTES ───────────────────────────────────────────
    //
    // 🚨 THIS IS THE WHOLE POINT OF THE ROUTE AND IT WAS MISSING.
    //
    // Everything downstream — system size, production, savings, the proposal —
    // is derived from five numbers a parser guessed off this document, and the
    // route hands back a `confidence` score for that guess. Without the document
    // there is nothing to check the guess against, and no way to answer "are you
    // sure my usage is 14,200 kWh?" except to ask the homeowner to upload it
    // again, which the portal would not let them do.
    //
    // Written BEFORE the summary, and its failure FAILS THE REQUEST. That
    // ordering is deliberate: if this insert cannot be done, no summary row
    // exists either, so `alreadyExists` above does not latch and the homeowner
    // can simply try again. The old code's failure mode was the reverse — a
    // summary that permanently claimed a bill had been received.
    //
    // Size is already bounded: /api/bill-upload rejects anything over 10 MB with
    // a 413 before we reach this line, so nothing larger can arrive here.
    const originalBytes = Buffer.from(await file.arrayBuffer());
    const originalMime  = (file.type || '').trim() || 'application/octet-stream';
    const originalName  = portalOriginalBillFileName(file.type, file.name);

    // project_files requires user_id — use client_id as sentinel for portal uploads
    const portalUserId = session.clientId;

    try {
      await upsertProjectFile(sql, {
        projectId,
        clientId: session.clientId,
        userId:   portalUserId,
        fileName: originalName,
        mimeType: originalMime,
        bytes:    originalBytes,
        notes:    `Original utility bill uploaded via homeowner portal (as "${file.name}")`,
      });
    } catch (storeErr) {
      const msg = storeErr instanceof Error ? storeErr.message : String(storeErr);
      console.error(
        `[portal/bill-upload] ERROR: original bill bytes NOT stored for project=${projectId}: ${msg}`,
      );
      return NextResponse.json(
        {
          success: false,
          error:
            'We could not save your utility bill. Nothing was recorded — please try uploading it again.',
        },
        { status: 500 },
      );
    }

    // ── Save the parsed summary to project_files ───────────────────────────
    const summaryText = JSON.stringify({
      utilityProvider: billData.utilityProvider ?? null,
      monthlyKwh:      billData.monthlyKwh ?? null,
      annualKwh:       billData.annualKwh ?? billData.estimatedAnnualKwh ?? null,
      electricityRate: billData.electricityRate ?? null,
      confidence:      billData.confidence ?? null,
      uploadedVia:     'portal',
    });

    const buf = Buffer.from(summaryText, 'utf8');

    // 🚨 NAMED `Bill_Data_…`, WHICH IS NOT COSMETIC.
    //
    // app/engineering/page.tsx classifies a `utility_bill` file as "Bill Data"
    // when its name starts `Bill_Data_`, and as the "Original Utility Bill"
    // otherwise. Under the old name this 200-byte JSON summary WAS the thing the
    // installer's engineering page presented as the original document.
    await upsertProjectFile(sql, {
      projectId,
      clientId: session.clientId,
      userId:   portalUserId,
      fileName: PORTAL_BILL_SUMMARY_FILE_NAME,
      mimeType: 'application/json',
      bytes:    buf,
      notes:    'Parsed bill data (summary) — uploaded via homeowner portal',
    });

    // ── Write micro stages: bill_uploaded + bill_parsed ────────────────────
    // Critical events -- awaited so failures surface to the caller (writeMicroStage retries once internally)
    await writeMicroStage(projectId, 'bill_uploaded', session.clientId, {
      uploadedVia: 'portal',
      fileType: file.type,
    });
    await writeMicroStage(projectId, 'bill_parsed', session.clientId, {
      utilityProvider: billData.utilityProvider ?? null,
      monthlyKwh:      billData.monthlyKwh ?? null,
      annualKwh:       billData.annualKwh ?? null,
      confidence:      billData.confidence ?? null,
    });

    // ── Advance stage: lead_submitted → under_review ──────────────────────
    let stageAdvanced = false;
    if (currentStage === 'lead_submitted') {
      try {
        await sql`
          UPDATE projects
          SET homeowner_stage = 'under_review',
              updated_at      = NOW()
          WHERE id = ${projectId}
        `;
        await sql`
          INSERT INTO project_homeowner_stage_history
            (project_id, stage, changed_by, note)
          VALUES
            (${projectId}, 'under_review', NULL,
             'Auto-advanced: homeowner uploaded utility bill via portal')
        `;
        stageAdvanced = true;
        console.log(`[portal/bill-upload] Stage advanced for project=${projectId}: lead_submitted → under_review`);
      } catch (stageErr) {
        const msg = stageErr instanceof Error ? stageErr.message : String(stageErr);
        console.error(`[portal/bill-upload] ERROR: Stage advance failed for project=${projectId}: ${msg}`);
        // Non-fatal — file was saved successfully
      }
    }

    return NextResponse.json({
      success:       true,
      alreadyExists: false,
      stageAdvanced,
      newStage:      stageAdvanced ? 'under_review' : currentStage,
      message:       'Utility bill received. We\'re analyzing your energy usage now.',
      // The document itself is on file, not just the five numbers read off it.
      // Reported so a caller can tell the difference — the old route could not.
      originalStored: true,
      originalFileName: originalName,
      billData: {
        utilityProvider: billData.utilityProvider ?? null,
        monthlyKwh:      billData.monthlyKwh ?? null,
        annualKwh:       billData.annualKwh ?? null,
        confidence:      billData.confidence ?? null,
      },
    });

  } catch (e: unknown) {
    return handleRouteDbError('[api/portal/bill-upload]', e);
  }
}

/**
 * Writes one `project_files` row, replacing any previous row with the same
 * (project, user, file name).
 *
 * The ON CONFLICT target is the constraint the original code assumed, with the
 * same delete-then-insert fallback for databases that do not have it. Extracted
 * because there are now TWO rows per upload — the original bytes and the parsed
 * summary — and duplicating 30 lines of upsert is how a fallback path ends up
 * fixed in one copy and not the other.
 */
async function upsertProjectFile(
  sql: Awaited<ReturnType<typeof getDbReady>>,
  row: {
    projectId: string;
    clientId:  string;
    userId:    string;
    fileName:  string;
    mimeType:  string;
    bytes:     Buffer;
    notes:     string;
  },
): Promise<void> {
  try {
    await sql`
      INSERT INTO project_files
        (project_id, client_id, user_id, file_name, file_type, file_size, mime_type, file_data, notes)
      VALUES
        (${row.projectId}, ${row.clientId}, ${row.userId},
         ${row.fileName}, 'utility_bill', ${row.bytes.length},
         ${row.mimeType}, ${row.bytes},
         ${row.notes})
      ON CONFLICT (project_id, user_id, file_name)
      DO UPDATE SET
        file_data   = EXCLUDED.file_data,
        file_size   = EXCLUDED.file_size,
        mime_type   = EXCLUDED.mime_type,
        notes       = EXCLUDED.notes,
        upload_date = NOW()
    `;
  } catch {
    // Fallback if ON CONFLICT not supported on this constraint
    await sql`
      DELETE FROM project_files
      WHERE project_id = ${row.projectId}
        AND user_id    = ${row.userId}
        AND file_name  = ${row.fileName}
    `;
    await sql`
      INSERT INTO project_files
        (project_id, client_id, user_id, file_name, file_type, file_size, mime_type, file_data, notes)
      VALUES
        (${row.projectId}, ${row.clientId}, ${row.userId},
         ${row.fileName}, 'utility_bill', ${row.bytes.length},
         ${row.mimeType}, ${row.bytes},
         ${row.notes})
    `;
  }
}