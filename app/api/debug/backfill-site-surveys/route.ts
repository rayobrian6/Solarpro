// ============================================================================
// app/api/debug/backfill-site-surveys/route.ts
//
// Recovery endpoint: finds all survey-origin projects that have a
// survey_external_id but no corresponding site_surveys row, then pulls
// their photos from project_files and creates the missing site_surveys +
// site_survey_files rows.
//
// This is safe to run multiple times — createSiteSurvey uses
// ON CONFLICT (external_survey_id) DO NOTHING.
//
// POST /api/debug/backfill-site-surveys
//   → returns { success, fixed, skipped, errors[], results[] }
//
// GET /api/debug/backfill-site-surveys
//   → returns { orphaned: [...] } — projects that need backfilling
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { getDbReady, createSiteSurvey, bulkAddSiteSurveyFiles, isValidUUID } from '@/lib/db-neon';

export const dynamic    = 'force-dynamic';
export const runtime    = 'nodejs';
export const maxDuration = 60;

// ── GET — list orphaned projects (survey-origin, no site_surveys row) ────────

export async function GET(req: NextRequest) {
  if (process.env.DISABLE_DEBUG_ENDPOINTS === 'true') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const sql = await getDbReady();

    const orphaned = await sql`
      SELECT
        p.id,
        p.name,
        p.address,
        p.survey_external_id,
        p.client_id,
        p.user_id,
        p.created_at,
        u.email AS owner_email,
        (SELECT COUNT(*) FROM project_files pf WHERE pf.project_id = p.id) AS photo_count,
        (SELECT COUNT(*) FROM site_surveys ss WHERE ss.project_id = p.id) AS survey_count
      FROM projects p
      LEFT JOIN users u ON u.id = p.user_id
      WHERE p.origin = 'survey'
        AND p.survey_external_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM site_surveys ss WHERE ss.project_id = p.id
        )
      ORDER BY p.created_at DESC
      LIMIT 100
    `;

    return NextResponse.json({
      success: true,
      orphanedCount: orphaned.length,
      orphaned,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// ── POST — backfill missing site_surveys rows ─────────────────────────────────

export async function POST(req: NextRequest) {
  if (process.env.DISABLE_DEBUG_ENDPOINTS === 'true') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const sql = await getDbReady();

    // Step 1: find all survey-origin projects with no site_surveys row
    const orphaned = await sql`
      SELECT
        p.id          AS project_id,
        p.name,
        p.address,
        p.lat,
        p.lng,
        p.client_id,
        p.user_id,
        p.survey_external_id,
        ppd.inspector_name
      FROM projects p
      LEFT JOIN project_physical_data ppd ON ppd.project_id = p.id
      WHERE p.origin = 'survey'
        AND p.survey_external_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM site_surveys ss WHERE ss.project_id = p.id
        )
      ORDER BY p.created_at DESC
      LIMIT 100
    `;

    if (orphaned.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No orphaned projects found — all survey-origin projects already have site_surveys rows.',
        fixed: 0,
        skipped: 0,
        errors: [],
        results: [],
      });
    }

    const results: Array<{
      projectId: string;
      projectName: string;
      status: 'fixed' | 'skipped' | 'error';
      siteSurveyId?: string;
      photosAdded: number;
      clientId?: string;
      clientCreated?: boolean;
      error?: string;
    }> = [];

    let fixed   = 0;
    let skipped = 0;

    for (const row of orphaned as Array<Record<string, unknown>>) {
      const projectId         = row.project_id as string;
      const projectName       = (row.name as string) || 'Survey Client';
      const projectAddress    = (row.address as string) || '';
      const ownerId           = row.user_id as string;
      const surveyExternalId  = row.survey_external_id as string;
      const inspectorName     = (row.inspector_name as string | null) ?? null;
      const lat               = row.lat as number | null;
      const lng               = row.lng as number | null;

      try {
        // ── Resolve client_id ─────────────────────────────────────────────
        let clientId = (row.client_id as string | null) ?? null;
        let clientCreated = false;

        // Step A: check if project already has a client
        if (!clientId) {
          const projRow = await sql`
            SELECT client_id FROM projects WHERE id = ${projectId} LIMIT 1
          `;
          clientId = (projRow[0] as Record<string, unknown> | undefined)?.client_id as string | null ?? null;
        }

        // Step B: find existing client by address
        if (!clientId && projectAddress) {
          const byAddr = await sql`
            SELECT id FROM clients
            WHERE user_id = ${ownerId}
              AND LOWER(TRIM(address)) = LOWER(TRIM(${projectAddress}))
            LIMIT 1
          `;
          const found = (byAddr[0] as Record<string, unknown> | undefined)?.id as string | null ?? null;
          if (found && isValidUUID(found)) clientId = found;
        }

        // Step C: auto-create client if still none found
        if (!clientId) {
          const placeholderEmail = `survey-${surveyExternalId.slice(0, 8)}@survey.local`;
          const inserted = await sql`
            INSERT INTO clients (user_id, name, email, address, lat, lng)
            VALUES (
              ${ownerId},
              ${projectName},
              ${placeholderEmail},
              ${projectAddress},
              ${lat ?? null},
              ${lng ?? null}
            )
            ON CONFLICT DO NOTHING
            RETURNING id
          `;
          const newId = (inserted[0] as Record<string, unknown> | undefined)?.id as string | null ?? null;
          if (newId && isValidUUID(newId)) {
            clientId = newId;
            clientCreated = true;
            console.log(`[BACKFILL] Auto-created client clientId=${clientId} for project "${projectName}"`);
          }
        }

        if (!clientId || !isValidUUID(clientId)) {
          results.push({
            projectId,
            projectName,
            status: 'skipped',
            photosAdded: 0,
            error: 'Could not resolve or create client_id',
          });
          skipped++;
          continue;
        }

        // Backfill project.client_id if missing
        await sql`
          UPDATE projects SET client_id = ${clientId}, updated_at = now()
          WHERE id = ${projectId} AND user_id = ${ownerId} AND client_id IS NULL
        `;

        // ── Create site_surveys row ────────────────────────────────────────
        const siteSurvey = await createSiteSurvey({
          clientId,
          projectId,
          createdBy:        ownerId,
          source:           'standalone',
          status:           'completed',
          addressSnapshot:  projectAddress || null,
          surveyData:       null,
          inspectorName:    inspectorName,
          externalSurveyId: surveyExternalId,
          deliveryId:       null,
        });

        // ── Pull photos from project_files and create site_survey_files ───
        const photos = await sql`
          SELECT file_url, file_name, notes, file_type
          FROM project_files
          WHERE project_id = ${projectId}
          ORDER BY created_at ASC
        `;

        let photosAdded = 0;
        if (photos.length > 0) {
          const surveyFiles = (photos as Array<Record<string, unknown>>).map(photo => ({
            surveyId: siteSurvey.id,
            fileUrl:  photo.file_url as string,
            fileType: 'photo' as const,
            label:    (photo.notes as string | null) ?? _guessLabel(photo.file_name as string | null),
            filename: (photo.file_name as string | null) ?? null,
            mimeType: 'image/jpeg',
          }));
          photosAdded = await bulkAddSiteSurveyFiles(surveyFiles);
          console.log(`[BACKFILL] site_survey_files inserted count=${photosAdded} surveyId=${siteSurvey.id}`);
        }

        results.push({
          projectId,
          projectName,
          status: 'fixed',
          siteSurveyId: siteSurvey.id,
          photosAdded,
          clientId,
          clientCreated,
        });
        fixed++;
        console.log(`[BACKFILL] Fixed project "${projectName}" projectId=${projectId} siteSurveyId=${siteSurvey.id} photos=${photosAdded}`);

      } catch (rowErr) {
        const msg = rowErr instanceof Error ? rowErr.message : String(rowErr);
        console.error(`[BACKFILL] Failed for projectId=${projectId}: ${msg}`);
        results.push({
          projectId,
          projectName,
          status: 'error',
          photosAdded: 0,
          error: msg,
        });
        skipped++;
      }
    }

    return NextResponse.json({
      success: true,
      fixed,
      skipped,
      errors: results.filter(r => r.status === 'error').map(r => `${r.projectName}: ${r.error}`),
      results,
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _guessLabel(filename: string | null): string {
  if (!filename) return 'photo';
  const lower = filename.toLowerCase();
  if (lower.includes('panel') || lower.includes('meter'))   return 'main_panel';
  if (lower.includes('roof'))                                return 'roof_overview';
  if (lower.includes('attic'))                               return 'attic';
  if (lower.includes('exterior') || lower.includes('front')) return 'exterior';
  if (lower.includes('utility') || lower.includes('room'))   return 'utility_room';
  return 'photo';
}