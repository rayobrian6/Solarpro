// ============================================================================
// app/api/debug/force-ingest/route.ts  —  Force Ingest from Partner DB
//
// PROOF OF LIFE: Bypass the broken webhook system. Pull survey data directly
// from the partner PostgreSQL database and write it into SolarPro's DB.
//
// DEBUG ONLY — isolated, safe, no side effects on production paths.
//
// POST /api/debug/force-ingest
//   → pulls partner surveys + photos from partner Postgres
//   → upserts into SolarPro: projects + project_physical_data + project_files
//   → returns { success, surveysProcessed, photosProcessed, results[] }
//
// GET /api/debug/force-ingest
//   → returns current state: ingested surveys visible in SolarPro DB
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { getDbReady, createSiteSurvey, bulkAddSiteSurveyFiles, isValidUUID } from '@/lib/db-neon';
import pg from 'pg';
import { resolveIngestOwner } from '@/lib/survey/ingest/ownerResolver';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

export const dynamic  = 'force-dynamic';
export const runtime  = 'nodejs';
export const maxDuration = 60;

// ── Partner DB connection ─────────────────────────────────────────────────────

// SECURITY: Read partner DB URL from env var — never hardcode credentials in source.
// Set PARTNER_SURVEY_DB_URL in Vercel environment variables.
const PARTNER_DB_URL = process.env.PARTNER_SURVEY_DB_URL || '';
const PARTNER_CDN_BASE = 'https://site-survey-api-bpyz.onrender.com';

// SolarPro default ingest user (must exist in SolarPro users table)
const SOLARPRO_INGEST_USER_ID = process.env.SURVEY_INGEST_DEFAULT_USER_ID ?? '';

// ── Partner data shapes ───────────────────────────────────────────────────────

interface PartnerSurvey {
  id:             string;
  project_name:   string;
  site_name:      string;
  site_address:   string | null;
  inspector_name: string;
  category_name:  string | null;
  latitude:       number | null;
  longitude:      number | null;
  gps_accuracy:   number | null;
  survey_date:    string;
  status:         string;
  notes:          string | null;
  metadata:       Record<string, unknown> | null;
  created_at:     string;
  // F-06: Ownership routing — populated from SolarPro handoff JWT claims
  solarpro_user_id:    string | null;
  solarpro_project_id: string | null;
  solarpro_email:      string | null;
  // F-06b: Inspector identity fields (may be present even without JWT claims)
  inspector_email:     string | null;
}

interface PartnerPhoto {
  id:          string;
  survey_id:   string;
  filename:    string;
  label:       string | null;
  file_path:   string;
  mime_type:   string | null;
  captured_at: string | null;
}

interface IngestResult {
  surveyId:    string;
  siteName:    string;
  address:     string | null;
  action:      'created' | 'updated' | 'skipped';
  projectId:   string | null;
  photosAdded: number;
  error?:      string;
}

// ── Category label → Photo category ──────────────────────────────────────────

function inferPhotoCategory(
  label: string | null,
  filename: string,
): string {
  const src = (label ?? filename).toLowerCase();
  if (src.includes('roof'))       return 'roof';
  if (src.includes('meter'))      return 'meter';
  if (src.includes('panel'))      return 'panel';
  if (src.includes('overhead') || src.includes('obstruct')) return 'obstruction';
  if (src.includes('access') || src.includes('site'))       return 'site';
  return 'site';
}

// ── Map partner metadata → project_physical_data fields ──────────────────────

function buildPhysicalData(survey: PartnerSurvey): Record<string, unknown> {
  const meta = survey.metadata ?? {};

  // roof_mount fields
  const roofMaterial   = (meta.roof_material   as string  | undefined) ?? null;
  const rafterSpacing  = (meta.rafter_spacing  as string  | undefined) ?? null;
  const rafterSize     = (meta.rafter_size     as string  | undefined) ?? null;
  const azimuth        = (meta.azimuth         as number  | undefined) ?? null;
  const roofAgeYears   = (meta.roof_age_years  as number  | undefined) ?? null;

  // ground_mount fields
  const soilType       = (meta.soil_type       as string  | undefined) ?? null;
  const slopeDegrees   = (meta.slope_degrees   as number  | undefined) ?? null;
  const trenchingPath  = (meta.trenching_path  as string  | undefined) ?? null;

  const mountingNotes = [
    rafterSize   ? `rafter_size=${rafterSize}`   : null,
    rafterSpacing? `rafter_spacing=${rafterSpacing}` : null,
    trenchingPath? `trenching=${trenchingPath}`  : null,
    soilType     ? `soil=${soilType}`            : null,
    slopeDegrees != null ? `slope=${slopeDegrees}°` : null,
  ].filter(Boolean).join(', ') || null;

  return {
    // Columns that exist in project_physical_data (migration 013)
    roof_material:          roofMaterial,
    roof_age_years:         roofAgeYears,
    rafter_spacing_in:      rafterSpacing ? parseInt(rafterSpacing) : null,
    interconnection_point:  null,
    panel_brand:            null,
    access_notes:           survey.site_address,   // closest available field
    mounting_notes:         mountingNotes,
    source:                 'survey',
  };
}

// ── GET — return current ingested survey state ────────────────────────────────

export async function GET(req: NextRequest) {
  // Block only when explicitly disabled via env var.
  // Set DISABLE_DEBUG_ENDPOINTS=true in Vercel to lock down after mass onboard.
  // Do NOT gate on VERCEL_ENV=production — admin portal runs on production Vercel.
  if (process.env.DISABLE_DEBUG_ENDPOINTS === 'true') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const sql = await getDbReady();

    const projects = await sql`
      SELECT
        p.id, p.name, p.address, p.lat, p.lng, p.status, p.survey_external_id,
        p.created_at, p.user_id,
        p.survey_meta,
        (SELECT COUNT(*) FROM project_files pf WHERE pf.project_id = p.id) AS photo_count,
        ppd.roof_material, ppd.access_notes AS ppd_access_notes,
        ppd.mounting_notes, ppd.source,
        u.email AS owner_email, u.name AS owner_name
      FROM projects p
      LEFT JOIN project_physical_data ppd ON ppd.project_id = p.id
      LEFT JOIN users u ON u.id = p.user_id
      WHERE p.origin = 'survey'
      ORDER BY p.created_at DESC
      LIMIT 50
    `;

    const photos = await sql`
      SELECT pf.project_id, pf.file_url, pf.file_name, pf.notes, pf.file_type, pf.created_at
      FROM project_files pf
      WHERE pf.project_id = ANY(${projects.map((p: Record<string, unknown>) => p.id as string)})
      ORDER BY pf.created_at DESC
    `;

    // Group photos by project
    const photosByProject: Record<string, typeof photos> = {};
    for (const photo of photos) {
      const pid = photo.project_id as string;
      if (!photosByProject[pid]) photosByProject[pid] = [];
      photosByProject[pid].push(photo);
    }

    return NextResponse.json({
      success: true,
      count: projects.length,
      projects: projects.map((p: Record<string, unknown>) => ({
        ...p,
        photos: photosByProject[p.id as string] ?? [],
      })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// ── POST — run force ingest from partner DB ───────────────────────────────────

export async function POST(req: NextRequest) {
  // Block only when explicitly disabled via env var.
  if (process.env.DISABLE_DEBUG_ENDPOINTS === 'true') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // ── Rate limiting ──────────────────────────────────────────────────────────
  const rl = await checkRateLimit('admin', getClientIp(req));
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 });
  }

  const results: IngestResult[] = [];
  let photosProcessed = 0;

  // SECURITY FIX: Removed email from log — PII must not appear in server logs
  console.log('[FORCE INGEST] Starting — adminId:', admin.id);

  // ── Resolve SolarPro ingest user ──────────────────────────────────────────
  let ingestUserId = SOLARPRO_INGEST_USER_ID;
  try {
    const sql = await getDbReady();
    if (!ingestUserId) {
      // Fall back to the first admin user
      const adminUsers = await sql`
        SELECT id FROM users WHERE role IN ('admin','super_admin') LIMIT 1
      `;
      ingestUserId = adminUsers[0]?.id ?? '';
    }
    if (!ingestUserId) {
      return NextResponse.json({
        success: false,
        error: 'No ingest user found. Set SURVEY_INGEST_DEFAULT_USER_ID env var.',
      }, { status: 500 });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: `SolarPro DB init failed: ${msg}` }, { status: 500 });
  }

  // ── Connect to partner DB ─────────────────────────────────────────────────
  // Guard: if PARTNER_SURVEY_DB_URL is not configured, return a clear error
  // instead of letting pg.Pool default to localhost:5432 (ECONNREFUSED).
  if (!PARTNER_DB_URL) {
    return NextResponse.json({
      success: false,
      error:
        'PARTNER_SURVEY_DB_URL is not configured. ' +
        'Set this environment variable to the partner PostgreSQL connection string. ' +
        'To fix existing misowned surveys without the partner DB, use the ' +
        '"Fix All Defaults" button in the Live Survey Data panel instead.',
      code: 'PARTNER_DB_NOT_CONFIGURED',
    }, { status: 503 });
  }

  const partnerPool = new pg.Pool({
    connectionString: PARTNER_DB_URL,
    ssl: { rejectUnauthorized: false },
    max: 3,
  });

  try {
    // ── Fetch all partner surveys ──────────────────────────────────────────
    const { rows: surveys } = await partnerPool.query<PartnerSurvey>(`
      SELECT
        s.id, s.project_name, s.site_name, s.site_address,
        s.inspector_name, s.category_name, s.latitude, s.longitude,
        s.gps_accuracy, s.survey_date::text, s.status, s.notes,
        s.metadata, s.created_at::text,
        s.solarpro_user_id, s.solarpro_project_id, s.solarpro_email,
        s.inspector_email
      FROM surveys s
      WHERE s.deleted_at IS NULL
        AND s.status = 'submitted'
      ORDER BY s.survey_date DESC
    `);

    console.log(`[FORCE INGEST] Fetched ${surveys.length} partner surveys`);

    // ── Fetch all partner photos ───────────────────────────────────────────
    const { rows: allPhotos } = await partnerPool.query<PartnerPhoto>(`
      SELECT id, survey_id, filename, label, file_path, mime_type, captured_at::text
      FROM survey_photos
      ORDER BY survey_id, captured_at
    `);

    // Group photos by survey_id
    const photosBySurvey: Record<string, PartnerPhoto[]> = {};
    for (const photo of allPhotos) {
      if (!photosBySurvey[photo.survey_id]) photosBySurvey[photo.survey_id] = [];
      photosBySurvey[photo.survey_id].push(photo);
    }

    console.log(`[FORCE INGEST] Found ${allPhotos.length} photos across ${Object.keys(photosBySurvey).length} surveys`);

    // ── Process each survey ────────────────────────────────────────────────
    const sql = await getDbReady();

    for (const survey of surveys) {
      const result: IngestResult = {
        surveyId:    survey.id,
        siteName:    survey.site_name,
        address:     survey.site_address,
        action:      'skipped',
        projectId:   null,
        photosAdded: 0,
      };

      try {
        // F-06: Resolve owner per survey (claim → default fallback)
        const ownerResolution = await resolveIngestOwner(
          survey.solarpro_user_id    ?? null,
          `force-ingest:${survey.id}`,
          survey.solarpro_email      ?? null,
          survey.solarpro_project_id ?? null,
          survey.inspector_email     ?? null,
          survey.inspector_name      ?? null,
        );
        const surveyOwnerId = ownerResolution?.ownerId ?? ingestUserId;
        const surveyOwnerSource = ownerResolution?.ownerSource ?? 'default';

        if (survey.solarpro_user_id) {
          console.log(
            `[FORCE INGEST] [INGEST OWNER RESOLVED] survey=${survey.id} ` +
            `solarpro_user_id=${survey.solarpro_user_id} ownerId=${surveyOwnerId} source=${surveyOwnerSource}`,
          );
        }

        // ── Upsert project ──────────────────────────────────────────────
        const projectName = `${survey.site_name} — ${survey.category_name ?? 'Survey'}`;
        const address     = survey.site_address ?? '';

        const existingRows = await sql`
          SELECT id FROM projects
          WHERE user_id = ${surveyOwnerId}
            AND survey_external_id = ${survey.id}
          LIMIT 1
        `;

        let projectId: string;

        if (existingRows.length > 0) {
          projectId = existingRows[0].id as string;
          // Update address/name + refresh survey_meta ownership claims (F-06)
          const updateMeta = JSON.stringify({
            inspector:           survey.inspector_name,
            category:            survey.category_name,
            survey_date:         survey.survey_date,
            site_name:           survey.site_name,
            source:              'force_ingest',
            metadata:            survey.metadata,
            owner_source:        surveyOwnerSource,
            solarpro_user_id:    survey.solarpro_user_id ?? null,
            solarpro_project_id: survey.solarpro_project_id ?? null,
          });
          await sql`
            UPDATE projects
            SET name        = ${projectName},
                address     = ${address},
                lat         = ${survey.latitude ?? null},
                lng         = ${survey.longitude ?? null},
                survey_meta = COALESCE(survey_meta, '{}'::jsonb) || ${updateMeta}::jsonb,
                updated_at  = now()
            WHERE id = ${projectId}
          `;
          result.action = 'updated';
        } else {
          const inserted = await sql`
            INSERT INTO projects (
              user_id, name, status, system_type, notes, address, lat, lng,
              origin, survey_external_id, survey_meta
            ) VALUES (
              ${surveyOwnerId},
              ${projectName},
              'lead',
              'roof',
              ${survey.notes ?? ''},
              ${address},
              ${survey.latitude ?? null},
              ${survey.longitude ?? null},
              'survey',
              ${survey.id},
              ${JSON.stringify({
                inspector:           survey.inspector_name,
                category:            survey.category_name,
                survey_date:         survey.survey_date,
                site_name:           survey.site_name,
                source:              'force_ingest',
                metadata:            survey.metadata,
                // F-06: ownership provenance
                owner_source:        surveyOwnerSource,
                solarpro_user_id:    survey.solarpro_user_id ?? null,
                solarpro_project_id: survey.solarpro_project_id ?? null,
              })}
            )
            ON CONFLICT (user_id, survey_external_id)
              WHERE survey_external_id IS NOT NULL
            DO UPDATE SET
              name    = EXCLUDED.name,
              address = EXCLUDED.address,
              lat     = EXCLUDED.lat,
              lng     = EXCLUDED.lng,
              updated_at = now()
            RETURNING id
          `;
          projectId = inserted[0].id as string;
          result.action = 'created';
        }

        result.projectId = projectId;
        console.log(`[FORCE INGEST] Survey "${survey.site_name}" → project ${projectId} (${result.action})`);

        // ── Upsert project_physical_data ────────────────────────────────
        const pd = buildPhysicalData(survey);
        await sql`
          INSERT INTO project_physical_data (
            project_id,
            roof_material, roof_age_years, rafter_spacing_in,
            interconnection_point, panel_brand,
            access_notes, mounting_notes,
            source
          ) VALUES (
            ${projectId},
            ${pd.roof_material as string | null},
            ${pd.roof_age_years as number | null},
            ${pd.rafter_spacing_in as number | null},
            ${pd.interconnection_point as string | null},
            ${pd.panel_brand as string | null},
            ${pd.access_notes as string | null},
            ${pd.mounting_notes as string | null},
            ${'survey'}
          )
          ON CONFLICT (project_id)
          DO UPDATE SET
            roof_material        = EXCLUDED.roof_material,
            roof_age_years       = EXCLUDED.roof_age_years,
            rafter_spacing_in    = EXCLUDED.rafter_spacing_in,
            access_notes         = EXCLUDED.access_notes,
            mounting_notes       = EXCLUDED.mounting_notes,
            updated_at           = now()
        `;

        // ── Insert photos into project_files ────────────────────────────
        const surveyPhotos = photosBySurvey[survey.id] ?? [];
        for (const photo of surveyPhotos) {
          const fileUrl  = `${PARTNER_CDN_BASE}${photo.file_path}`;
          const category = inferPhotoCategory(photo.label, photo.filename);
          const extId    = `partner-photo-${photo.id}`;

          await sql`
            INSERT INTO project_files (
              project_id, user_id, file_name, file_type, mime_type,
              file_url, notes, external_id, status
            ) VALUES (
              ${projectId},
              ${surveyOwnerId},
              ${photo.filename},
              ${'photo'},
              ${photo.mime_type ?? 'image/jpeg'},
              ${fileUrl},
              ${photo.label ?? category},
              ${extId},
              ${'ready'}
            )
            ON CONFLICT (project_id, external_id)
              WHERE external_id IS NOT NULL
            DO NOTHING
          `;
          result.photosAdded++;
          photosProcessed++;
        }

        // ── Create site_surveys row + site_survey_files ────────────────────────
        // site_surveys requires a client_id (NOT NULL). Resolve or auto-create
        // a client so that photos appear in the project/client survey UI panels.
        try {
          let clientId: string | null = null;

          // Step 1: find the project's client_id (may have been set on a prior run)
          const projectRow = await sql`
            SELECT client_id FROM projects WHERE id = ${projectId} AND user_id = ${surveyOwnerId} LIMIT 1
          `;
          clientId = (projectRow[0] as Record<string, unknown> | undefined)?.client_id as string | null;

          // Step 2: if no client, look for an existing client by address
          if (!clientId && survey.site_address) {
            const byAddr = await sql`
              SELECT id FROM clients
              WHERE user_id = ${surveyOwnerId}
                AND LOWER(TRIM(address)) = LOWER(TRIM(${survey.site_address}))
              LIMIT 1
            `;
            const found = (byAddr[0] as Record<string, unknown> | undefined)?.id as string | null;
            if (found && isValidUUID(found)) clientId = found;
          }

          // Step 3: auto-create a client from survey data if none found
          if (!clientId) {
            const placeholderEmail = `survey-${survey.id.slice(0, 8)}@survey.local`;
            const inserted = await sql`
              INSERT INTO clients (user_id, name, email, address, lat, lng)
              VALUES (
                ${surveyOwnerId},
                ${projectName},
                ${placeholderEmail},
                ${survey.site_address ?? ''},
                ${survey.latitude ?? null},
                ${survey.longitude ?? null}
              )
              ON CONFLICT DO NOTHING
              RETURNING id
            `;
            const newId = (inserted[0] as Record<string, unknown> | undefined)?.id as string | null;
            if (newId && isValidUUID(newId)) {
              clientId = newId;
              console.log(`[FORCE INGEST] Auto-created client clientId=${clientId} for survey "${survey.site_name}"`);
            }
          }

          // Step 4: backfill project.client_id if still missing
          if (clientId && isValidUUID(clientId)) {
            await sql`
              UPDATE projects SET client_id = ${clientId}, updated_at = now()
              WHERE id = ${projectId} AND user_id = ${surveyOwnerId} AND client_id IS NULL
            `;

            // Step 5: upsert site_surveys row (idempotent via external_survey_id)
            const siteSurvey = await createSiteSurvey({
              clientId,
              projectId,
              createdBy:        surveyOwnerId,
              source:           'standalone',
              status:           'completed',
              addressSnapshot:  survey.site_address ?? null,
              surveyData:       null,
              inspectorName:    survey.inspector_name ?? null,
              externalSurveyId: survey.id,
              deliveryId:       null,
            });

            // Step 6: upsert site_survey_files for each photo
            const surveyPhotosForFiles = photosBySurvey[survey.id] ?? [];
            if (surveyPhotosForFiles.length > 0) {
              const surveyFiles = surveyPhotosForFiles.map((photo) => ({
                surveyId: siteSurvey.id,
                fileUrl:  `${PARTNER_CDN_BASE}${photo.file_path}`,
                fileType: 'photo' as const,
                label:    photo.label ?? inferPhotoCategory(photo.label, photo.filename),
                filename: photo.filename ?? null,
                mimeType: photo.mime_type ?? 'image/jpeg',
              }));
              await bulkAddSiteSurveyFiles(surveyFiles);
              console.log(`[FORCE INGEST] site_survey_files inserted count=${surveyFiles.length} surveyId=${siteSurvey.id}`);
            }
          }
        } catch (siteSurveyErr) {
          const msg = siteSurveyErr instanceof Error ? siteSurveyErr.message : String(siteSurveyErr);
          console.warn(`[FORCE INGEST] site_surveys upsert failed (non-fatal): ${msg}`);
        }

        console.log(`[FORCE INGEST] "${survey.site_name}" — ${result.photosAdded} photos attached`);

      } catch (surveyErr) {
        const msg = surveyErr instanceof Error ? surveyErr.message : String(surveyErr);
        result.error = msg;
        console.error(`[FORCE INGEST] ERROR on survey ${survey.id}: ${msg}`);
      }

      results.push(result);
    }

    console.log(`[FORCE INGEST] Done — ${results.length} surveys, ${photosProcessed} photos`);

    return NextResponse.json({
      success:          true,
      surveysProcessed: results.length,
      photosProcessed,
      results,
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[FORCE INGEST] Fatal error:', msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  } finally {
    await partnerPool.end().catch(() => {});
  }
}