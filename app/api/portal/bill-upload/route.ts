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
//   5. Save parsed bill + raw file reference to project_files
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
    const existingBill = await sql`
      SELECT id, created_at
      FROM project_files
      WHERE project_id = ${projectId}
        AND file_type   = 'utility_bill'
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

    // ── Save bill reference to project_files ──────────────────────────────
    const summaryText = JSON.stringify({
      utilityProvider: billData.utilityProvider ?? null,
      monthlyKwh:      billData.monthlyKwh ?? null,
      annualKwh:       billData.annualKwh ?? billData.estimatedAnnualKwh ?? null,
      electricityRate: billData.electricityRate ?? null,
      confidence:      billData.confidence ?? null,
      uploadedVia:     'portal',
    });

    const buf = Buffer.from(summaryText, 'utf8');

    // project_files requires user_id — use client_id as sentinel for portal uploads
    const portalUserId = session.clientId;

    try {
      await sql`
        INSERT INTO project_files
          (project_id, client_id, user_id, file_name, file_type, file_size, mime_type, file_data, notes)
        VALUES
          (${projectId}, ${session.clientId}, ${portalUserId},
           'Utility_Bill_Summary.json', 'utility_bill', ${buf.length},
           'application/json', ${buf},
           'Uploaded via homeowner portal')
        ON CONFLICT (project_id, user_id, file_name)
        DO UPDATE SET
          file_data   = EXCLUDED.file_data,
          notes       = EXCLUDED.notes,
          upload_date = NOW()
      `;
    } catch {
      // Fallback if ON CONFLICT not supported on this constraint
      await sql`
        DELETE FROM project_files
        WHERE project_id = ${projectId}
          AND user_id    = ${portalUserId}
          AND file_name  = 'Utility_Bill_Summary.json'
      `;
      await sql`
        INSERT INTO project_files
          (project_id, client_id, user_id, file_name, file_type, file_size, mime_type, file_data, notes)
        VALUES
          (${projectId}, ${session.clientId}, ${portalUserId},
           'Utility_Bill_Summary.json', 'utility_bill', ${buf.length},
           'application/json', ${buf},
           'Uploaded via homeowner portal')
      `;
    }

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