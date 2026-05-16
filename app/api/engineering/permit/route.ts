// ============================================================
// Permit Package PDF Generator — SolarPro V4
// POST /api/engineering/permit
//
// MODULARIZED: All page generators + orchestrator live in lib/permit/
// This file is a thin controller handling auth, DB, PDF conversion.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, isValidUUID } from '@/lib/db-neon';
import { checkPipelineGuard, extractCanonicalSnapshot } from '@/lib/engineering/pipelineGuard';
import { getMountingSystemById } from '@/lib/mounting-hardware-db';
import { generatePdfFromHtml } from '@/lib/pdf/generatePdf';

// Permit engine imports (modularized)
import { generatePermitHTML, PLANSET_ENGINE_VERSION, PDF_PAGE_CONFIG } from '@/lib/permit';
import type { PermitInput } from '@/lib/permit';
import { fetchAerialRoofData } from '@/lib/permit/sections/sitePlan';

// Site Survey pipeline imports — survey data enriches the permit plan set
import { fromPhysicalData, type ProjectPhysicalDataRow } from '@/lib/siteSurvey/fromPhysicalData';
import { normalizeSurvey } from '@/lib/siteSurvey/normalizeSurvey';
import { enrichSurvey } from '@/lib/siteSurvey/enrichSurvey';
import { permitIntegration } from '@/lib/siteSurvey/permitIntegration';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';          // Ensure Node.js runtime (Buffer, child_process)
export const maxDuration = 60;            // 60s — aerial API calls can take 10-15s total


// ─── Route Handler ────────────────────────────────────────────────────────────

// ── GET /api/engineering/permit?projectId=xxx[&format=pdf] ────────────────────
// Serves the saved permit HTML (or PDF) from project_files.
// Requires the permit to have been generated via POST first.
// Used by the Download button in the permit viewer.
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

    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });

    const projectId = req.nextUrl.searchParams.get('projectId');
    const format    = req.nextUrl.searchParams.get('format') || 'pdf';

    if (!projectId || !isValidUUID(projectId)) {
      return NextResponse.json({ success: false, error: 'projectId (UUID) required' }, { status: 400 });
    }

    const sql = await getDbReady();

    // Ownership check
    const projectRows = await sql`
      SELECT id, user_id, name FROM projects WHERE id = ${projectId} AND deleted_at IS NULL
    `;
    if (projectRows.length === 0) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }
    const projectRow = projectRows[0];
    if (projectRow.user_id !== user.id) {
      const roleRows = await sql`SELECT role FROM users WHERE id = ${user.id}`;
      if (roleRows[0]?.role !== 'super_admin' && roleRows[0]?.role !== 'admin') {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
      }
    }

    // Load saved permit HTML
    const fileRows = await sql`
      SELECT file_data FROM project_files
      WHERE project_id = ${projectId}
        AND user_id    = ${projectRow.user_id}
        AND file_name  = 'permit_planset.html'
      LIMIT 1
    `;

    if (fileRows.length === 0 || !fileRows[0].file_data) {
      return NextResponse.json({
        success: false,
        error: 'No permit package found for this project. Generate the permit first from the Engineering page.',
        code: 'PERMIT_NOT_GENERATED',
      }, { status: 404 });
    }

    const html = fileRows[0].file_data instanceof Buffer
      ? fileRows[0].file_data.toString('utf8')
      : String(fileRows[0].file_data);

    // ── Staleness check ─────────────────────────────────────────────────────
    // Reads the <meta name="planset-version"> tag embedded in every saved HTML.
    // If the saved version is older than PLANSET_ENGINE_VERSION, force regenerate.
    // Falls back gracefully if the meta tag is absent (pre-v47.312 plansets always stale).
    {
      const metaMatch = html.match(/<meta\s+name="planset-version"\s+content="(\d+)"/);
      const savedVerNum = metaMatch ? parseInt(metaMatch[1], 10) : 0;
      if (savedVerNum < PLANSET_ENGINE_VERSION) {
        const savedVerLabel = savedVerNum > 0 ? `v47.${savedVerNum - 47000}` : 'pre-v47.312 (no version tag)';
        console.warn(`[permit/GET] Stale planset detected: ${savedVerLabel} < v47.${PLANSET_ENGINE_VERSION - 47000} \u2014 forcing regenerate`);
        return NextResponse.json({
          success: false,
          error: `Your saved permit package was generated with an older version (${savedVerLabel}). Please click "Generate Permit Package" again to create an updated version with the latest fixes.`,
          code: 'PERMIT_STALE',
          savedVersion: savedVerLabel,
          minimumVersion: `v47.${PLANSET_ENGINE_VERSION - 47000}`,
        }, { status: 409 });
      }
    }
    // ── End staleness check ──────────────────────────────────────────────────

    const safeProjectName = (projectRow.name || 'project')
      .replace(/[^\x00-\xFF]/g, '')
      .replace(/[\r\n]/g, '')
      .replace(/[^\w\s\-\.]/g, '_')
      .trim() || 'project';

    if (format === 'html') {
      return new NextResponse(html, {
        headers: {
          'Content-Type': 'text/html',
          'Content-Disposition': `attachment; filename="PermitPackage-${safeProjectName}.html"`,
        },
      });
    }

    // PDF via Puppeteer+chromium (Vercel-compatible)
    const pdfResult = await generatePdfFromHtml(html, {
      landscape: true,
      widthIn: PDF_PAGE_CONFIG.width,
      heightIn: PDF_PAGE_CONFIG.height,
    });

    if (pdfResult) {
      return new NextResponse(pdfResult.pdf as unknown as BodyInit, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="PermitPackage-${safeProjectName}.pdf"`,
          'Cache-Control': 'no-store',
          'X-Pdf-Method': pdfResult.method,
        },
      });
    }

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html',
        'Content-Disposition': `attachment; filename="PermitPackage-${safeProjectName}.html"`,
        'X-Pdf-Method': 'html-fallback',
      },
    });

  } catch (error: unknown) {
    console.error('[permit/GET] Error:', error);
    return NextResponse.json(
      { success: false, error: (error as Error).message || 'Download failed' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });

    const body = await req.json() as PermitInput;
    const { project } = body;

    if (!project) {
      return NextResponse.json({ success: false, error: 'Missing project data' }, { status: 400 });
    }

    // ── Hub read: backfill missing fields from Client_Profile.json ────────────
    // If the caller passes a projectId we read the hub file and fill any gaps.
    // This means the permit route works even if the UI didn't send every field.
    const projectId = (body as any).projectId || (project as any).projectId;
    if (projectId && isValidUUID(projectId)) {
      try {
        const sql = await getDbReady();
        const rows = await sql`
          SELECT file_data FROM project_files
          WHERE project_id = ${projectId}
            AND user_id    = ${user.id}
            AND file_name  = 'Client_Profile.json'
          LIMIT 1
        `;
        if (rows.length > 0 && rows[0].file_data) {
          const hub = JSON.parse(
            rows[0].file_data instanceof Buffer
              ? rows[0].file_data.toString('utf8')
              : String(rows[0].file_data)
          ) as Record<string, unknown>;
          const p = project as any;
          // Backfill only if field is missing/empty
          if (!p.clientName   && hub.clientName)       p.clientName   = hub.clientName;
          if (!p.address      && hub.serviceAddress)   p.address      = hub.serviceAddress;
          if (!p.lat          && hub.lat)              p.lat          = hub.lat;
          if (!p.lng          && hub.lng)              p.lng          = hub.lng;
          if (!p.city         && hub.city)             p.city         = hub.city;
          if (!p.state        && hub.state)            p.state        = hub.state;
          if (!p.zip          && hub.zip)              p.zip          = hub.zip;
          if (!p.utilityName  && hub.utilityProvider)  p.utilityName  = hub.utilityProvider;
          console.log('[permit/hub] Backfilled from Client_Profile.json:', {
            projectId, clientName: p.clientName, address: p.address,
          });
        }
      } catch (hubErr: unknown) {
        // Non-critical — permit generates even without hub data
        console.warn('[permit/hub] Hub read failed (non-critical):',
          hubErr instanceof Error ? (hubErr as Error).message : hubErr);
      }
    }

    // ── Canonical pipeline guard ────────────────────────────────────────────
    // STEP 5 of canonical pipeline directive: if canonicalSnapshot is missing,
    // warn in logs. The permit route has its own validation chain (validateCanonicalStrict)
    // which will catch missing data. This guard surfaces an explicit PIPELINE_NOT_EXECUTED
    // error to help the caller understand WHY the permit cannot be generated.
    if (projectId && isValidUUID(projectId)) {
      try {
        const guardSql = await getDbReady();
        const projRows = await guardSql`
          SELECT canonical_snapshot FROM projects
          WHERE id      = ${projectId}
            AND user_id = ${user.id}
          LIMIT 1
        `;
        if (projRows.length > 0) {
          const snap = extractCanonicalSnapshot(projRows[0] as Record<string, unknown>);
          const guardResult = checkPipelineGuard(snap, projectId);
          if (guardResult) {
            // Log the warning but do NOT hard-block — permit has its own validation
            // that will catch missing data with detailed messages.
            console.warn('[PERMIT_PIPELINE_GUARD]', {
              projectId,
              status: 'PIPELINE_NOT_EXECUTED — canonicalSnapshot missing or incomplete',
              note: "Proceeding with permit route's own validation chain",
            });
          } else {
            console.log('[PERMIT_PIPELINE_GUARD]', { projectId, status: 'canonicalSnapshot valid ✓' });
          }
        }
      } catch (guardErr: unknown) {
        // Non-fatal — canonical_snapshot column may not exist yet (run /api/migrate)
        console.warn('[PERMIT_PIPELINE_GUARD_ERROR]', (guardErr as Error)?.message ?? String(guardErr));
      }
    }

    // FIX v47.293 / v47.318: Server-side system_type correction.
    // The frontend may send project.systemType='roof' for fence/ground projects
    // if the engineering_seed.system_type was hardcoded 'roof' (preliminary route bug).
    // FIX v47.318: Also reads layouts.system_type from DB and patches body.layout.type
    // so that buildCanonical() receives the correct canonical type even when the DB
    // layout row has system_type=NULL (rowToLayout defaults to 'roof').
    // Guard: always read the authoritative system_type from projects/layouts tables and correct it.
    if (projectId && isValidUUID(projectId)) {
      try {
        const sqlSt = await getDbReady();
        // Read both projects.system_type (authoritative) and layouts.system_type (layout row)
        const stRows = await sqlSt`
          SELECT p.system_type AS proj_sys_type, l.system_type AS layout_sys_type
          FROM projects p
          LEFT JOIN layouts l ON l.project_id = p.id AND l.user_id = p.user_id
          WHERE p.id = ${projectId} AND p.deleted_at IS NULL
          ORDER BY l.updated_at DESC NULLS LAST
          LIMIT 1
        `;
        if (stRows.length > 0 && stRows[0].proj_sys_type) {
          const dbSysType    = String(stRows[0].proj_sys_type).toLowerCase().trim();
          const dbLayoutType = stRows[0].layout_sys_type
            ? String(stRows[0].layout_sys_type).toLowerCase().trim()
            : null;
          const sentSysType = (project.systemType || '').toLowerCase().trim();

          // Helper: convert DB 'fence'/'ground'/'roof' to canonical layout.type value
          const dbToCanonicalType = (s: string): string => {
            if (s === 'fence')  return 'solar_fence';
            if (s === 'ground') return 'ground_mount';
            return s; // 'roof' stays 'roof'
          };

          // Correct project.systemType if DB differs from what was sent
          if (dbSysType !== sentSysType) {
            console.log('[permit/POST] FIX v47.293: system_type mismatch — DB:', dbSysType, 'sent:', sentSysType, '— using DB value');
            (project as any).systemType = dbSysType;
          } else {
            console.log('[permit/POST] system_type OK — DB:', dbSysType, 'matches sent:', sentSysType);
          }

          // FIX v47.318: Also correct body.layout.type if it does not match the DB system type.
          // This fixes the case where rowToLayout defaulted layout.systemType to 'roof' when
          // layouts.system_type was NULL, causing the frontend to send layout.type='roof'.
          const canonicalType = dbToCanonicalType(dbSysType);
          const sentLayoutType = ((body.layout as any)?.type || '').toLowerCase().trim();
          if (body.layout && sentLayoutType !== canonicalType) {
            console.warn('[permit/POST] FIX v47.318: layout.type mismatch — DB canonical:', canonicalType,
              'sent:', sentLayoutType, '| DB layout row type:', dbLayoutType, '— correcting layout.type');
            (body.layout as any).type = canonicalType;
          }
          // Also correct layout.systemType (the legacy field on the layout object)
          if (body.layout) {
            const sentLayoutSys = ((body.layout as any)?.systemType || '').toLowerCase().trim();
            if (sentLayoutSys !== dbSysType) {
              (body.layout as any).systemType = dbSysType;
            }
          }
        }
      } catch (stErr: unknown) {
        console.warn('[permit/POST] Could not read project system_type from DB (non-critical):', (stErr as Error).message);
      }
    }

    // FIX v47.54: ENGINEERING_MODEL_STALE guard.
    // Block permit generation if totalPanels is 0 or missing.
    // This prevents the permit from silently generating with stale/default values
    // when the design layout has not been propagated to the engineering model.
    const guardPanels = body.system?.totalPanels ?? 0;
    if (guardPanels === 0) {
      console.error('[PERMIT BLOCKED] ENGINEERING_MODEL_STALE: totalPanels=0 — layout not propagated to engineering model');
      return NextResponse.json({
        success: false,
        error: 'ENGINEERING_MODEL_STALE',
        message: 'Permit generation blocked: panel count is 0. The design layout has not been propagated to the engineering model. Please open the Engineering page, wait for the pipeline sync to complete, then try again.',
        code: 'ENGINEERING_MODEL_STALE',
        layoutPanels: (project as any).panelPositions?.length ?? 0,
        engineeringPanels: 0,
      }, { status: 422 });
    }

    // STEP 5 -- PERMIT INPUT LOGGING
    const _pAny           = project as any;
    const _panelPositions = _pAny.panelPositions as Array<unknown> | undefined;
    const _roofPlanes     = _pAny.roofPlanes     as Array<unknown> | undefined;
    console.log('[PERMIT INPUT]', {
      projectName:        project.projectName,
      address:            project.address,
      panelCount:         _pAny.panelCount ?? _pAny.totalModules,
      panelPositionCount: Array.isArray(_panelPositions) ? _panelPositions.length : 'MISSING',
      roofPlaneCount:     Array.isArray(_roofPlanes) ? _roofPlanes.length : 'MISSING',
      hasPanelPositions:  Array.isArray(_panelPositions) && _panelPositions.length > 0,
      hasRoofPlanes:      Array.isArray(_roofPlanes) && _roofPlanes.length > 0,
    });

    // ── Normalize compliance: ensure it always has at least a skeleton so
    //    page functions never crash on compliance.jurisdiction?.xxx access
    //    when the frontend omits or sends null/undefined compliance.
    if (!body.compliance) {
      (body as any).compliance = {
        overallStatus: 'PASS',
        jurisdiction: {
          state:      project.address?.match(/,\s*([A-Z]{2})\s+\d{5}/)?.[1] || '—',
          necVersion: '2020',
          ahj:        (project as any).ahj || '—',
          permitNotes: undefined,
        },
      };
    } else if (!body.compliance.jurisdiction) {
      body.compliance.jurisdiction = {
        state:      project.address?.match(/,\s*([A-Z]{2})\s+\d{5}/)?.[1] || '—',
        necVersion: '2020',
        ahj:        (project as any).ahj || '—',
      };
    }

    // ── Normalize system: ensure inverters array exists
    if (!body.system) {
      (body as any).system = {
        totalDcKw:   0,
        totalAcKw:   0,
        totalPanels: 0,
        dcAcRatio:   1,
        topology:    'microinverter',
        inverters:   [],
      };
    } else if (!body.system.inverters) {
      (body.system as any).inverters = [];
    }

    // ─── Auto-populate AHJ data from national database ──────────────────────
    {
      const stateFromAddr = (body.project?.address || '').match(/,\s*([A-Z]{2})\s+\d{5}/)?.[1] || '';
      const sc = (body.project as any).state || stateFromAddr;
      const ct = (body.project as any).city || '';
      const cn = (body.project as any).county || '';
      if (sc) {
        try {
          // Dynamic import to avoid build-time issues
          const ahjModule = await import('@/lib/jurisdictions/ahj-national').catch(() => null);
          const searchAhjFn = (ahjModule as any)?.searchAhj || (ahjModule as any)?.default?.searchAhj;
          if (typeof searchAhjFn === 'function') {
            const ahjResults = searchAhjFn({ stateCode: sc, city: ct, county: cn });
            if (Array.isArray(ahjResults) && ahjResults.length > 0) {
              const ar = ahjResults[0] as any;
              console.log('[permit/AHJ] Found:', ar.ahjName, '| wind:', ar.windSpeedMph, 'mph | snow:', ar.groundSnowLoadPsf, 'psf');
              if (!(body.project as any).ahjName) (body.project as any).ahjName = ar.ahjName;
              if (!(body.project as any).ahjWindSpeedMph) (body.project as any).ahjWindSpeedMph = ar.windSpeedMph;
              if (!(body.project as any).ahjGroundSnowPsf) (body.project as any).ahjGroundSnowPsf = ar.groundSnowLoadPsf;
              if (!(body.project as any).ahjRoofSetbackIn) (body.project as any).ahjRoofSetbackIn = ar.roofSetbackInches;
              if (!(body.project as any).ahjRidgeSetbackIn) (body.project as any).ahjRidgeSetbackIn = ar.ridgeSetbackInches;
              if (!(body.project as any).ahjNecVersion) (body.project as any).ahjNecVersion = ar.necVersion;
              if (!(body.project as any).ahjPermitFee) (body.project as any).ahjPermitFee = ar.typicalPermitFee;
              if (!(body.project as any).ahjPlanCheckDays) (body.project as any).ahjPlanCheckDays = ar.typicalPlanCheckDays;
              if (!(body.project as any).ahjSpecialRequirements || (body.project as any).ahjSpecialRequirements.length === 0) {
                (body.project as any).ahjSpecialRequirements = [
                  ...(ar.specialRequirements || []),
                  ...(ar.planSetRequirements || []).slice(0, 4),
                ];
              }
              // Propagate to compliance.jurisdiction
              if (!body.compliance.jurisdiction) {
                body.compliance.jurisdiction = { state: sc, necVersion: ar.necVersion, ahj: ar.ahjName };
              } else {
                if (!body.compliance.jurisdiction.ahj) body.compliance.jurisdiction.ahj = ar.ahjName;
                if (!body.compliance.jurisdiction.necVersion) body.compliance.jurisdiction.necVersion = ar.necVersion;
                if (!body.compliance.jurisdiction.state) body.compliance.jurisdiction.state = sc;
              }
            }
          }
        } catch (ahjErr: unknown) {
          console.log('[permit/AHJ] lookup error (non-critical):', (ahjErr as Error)?.message);
        }
      }
    }

    // Fetch aerial roof data (satellite image + Solar API roof segments)
    // This runs server-side so we can embed the base64 image in the PDF
    console.log('[permit/POST] Starting aerial fetch for project address [redacted]');
    console.log('[permit/POST] lat/lng: [redacted]');
    const aerialStart = Date.now();
    const aerialData = await fetchAerialRoofData(
      (body.project as any).lat,
      (body.project as any).lng,
      body.project?.address || ''
    ).catch((aerialErr: any) => {
      console.log('[permit/POST] fetchAerialRoofData THREW:', aerialErr?.message);
      return { error: 'Aerial fetch threw: ' + aerialErr?.message } as any;
    });
    const aerialMs = Date.now() - aerialStart;
    console.log('[permit/POST] Aerial fetch completed in', aerialMs, 'ms');
    console.log('[permit/POST] aerialData.imageBase64:', aerialData.imageBase64 ? `YES (${aerialData.imageBase64.length} chars)` : 'NO');
    console.log('[permit/POST] aerialData.roofSegments:', aerialData.roofSegments?.length ?? 0);
    console.log('[permit/POST] aerialData.error:', aerialData.error || 'none');
    const enrichedBody: PermitInput = { ...body, aerialData };

    // ── Fetch latest stored SLD SVG for this project ──────────────────────
    // Priority: project_files SLD_*.svg (written by save-outputs route when
    // the user clicks "Generate SLD" in the Engineering tab).
    // Falls back to undefined → pageSingleLineDiagram shows the fallback message.
    let storedSldSvg: string | undefined;
    if (projectId && isValidUUID(projectId)) {
      try {
        const sql2 = await getDbReady();
        const sldRows = await sql2`
          SELECT file_data, file_name
          FROM project_files
          WHERE project_id = ${projectId}
            AND user_id    = ${user.id}
            AND file_name  LIKE 'SLD_%.svg'
          ORDER BY created_at DESC NULLS LAST, id DESC
          LIMIT 1
        `;
        if (sldRows.length > 0 && sldRows[0].file_data) {
          const raw = sldRows[0].file_data instanceof Buffer
            ? sldRows[0].file_data.toString('utf8')
            : String(sldRows[0].file_data);
          if (raw.trim().startsWith('<svg')) {
            storedSldSvg = raw;
            console.log('[permit/SLD] Loaded stored SLD from project_files:', sldRows[0].file_name, `(${raw.length} chars)`);
          }
        } else {
          console.log('[permit/SLD] No stored SLD found in project_files — E-1 will show fallback message');
        }
      } catch (sldErr: unknown) {
        console.warn('[permit/SLD] SLD fetch failed (non-critical):', sldErr instanceof Error ? (sldErr as Error).message : sldErr);
      }
    }


    // ── Site Survey Integration ─────────────────────────────────────────────
    // If project_physical_data exists for this project, run the full survey
    // pipeline (fromPhysicalData → normalizeSurvey → enrichSurvey →
    // permitIntegration) and deep-merge the PermitInputPatch into enrichedBody.
    //
    // MERGE STRATEGY (survey wins for physical measurements; design pipeline wins
    // for system/layout values):
    //   project.*     — survey wins for roofType, roofPitch, rafterSize,
    //                   rafterSpacing, mainPanelAmps, mainPanelBrand,
    //                   utilityMeter, interconnectionMethod, panelBusRating,
    //                   roofPlanes; design pipeline wins for everything else
    //   compliance.*  — survey notes are appended; existing status preserved
    //   aerialData.*  — survey roofSegments used only if aerial fetch returned none
    //   overrides     — survey overrides are appended (never replace)
    //
    // Non-critical: any failure here is logged; permit generation continues
    // with the design pipeline values only.
    // ─────────────────────────────────────────────────────────────────────────
    if (projectId && isValidUUID(projectId)) {
      try {
        const sqlSurvey = await getDbReady();

        // 1. Fetch project_physical_data row (written by the Site Survey ingest pipeline)
        const physRows = await sqlSurvey`
          SELECT
            id, project_id,
            roof_material, roof_age_years, roof_condition, roof_pitch_degrees,
            rafter_spacing_in, decking_thickness_in, structural_notes,
            main_panel_rating_amps, busbar_rating_amps, breaker_spaces_available,
            interconnection_point, panel_brand, has_existing_solar, electrical_notes,
            total_roof_area_sqft, usable_area_sqft, access_notes, mounting_notes,
            site_address, lat, lng, updated_at
          FROM project_physical_data
          WHERE project_id = ${projectId}
          LIMIT 1
        `;

        if (physRows.length === 0) {
          console.log('[permit/survey] No project_physical_data found for project', projectId, '— skipping survey enrichment');
        } else {
          const physRow = physRows[0] as ProjectPhysicalDataRow;
          console.log('[permit/survey] Found project_physical_data row, running survey pipeline...');

          // 2. Build RawSurveyPayload from DB row (also fetches project_files photos)
          const rawSurvey = await fromPhysicalData(projectId, physRow);

          if (rawSurvey) {
            // 3. Normalize → Enrich → Integrate
            const normalized = normalizeSurvey(rawSurvey);
            const enriched   = enrichSurvey(normalized);
            const { patch, sheetData, permitLog, warnings } = permitIntegration(enriched);

            // Log pipeline results
            permitLog.forEach(l => console.log('[permit/survey]', l));
            if (warnings.length > 0) {
              console.warn('[permit/survey] Warnings:', warnings);
            }
            console.log('[permit/survey] sheetData.pv1SiteDescription:', sheetData.pv1SiteDescription);
            console.log('[permit/survey] sheetData.pv3FeasibilitySummary:', sheetData.pv3FeasibilitySummary);

            // 4. Deep-merge patch into enrichedBody
            // project.*: survey wins for physical measurements only
            if (patch.project) {
              const pp = patch.project as Record<string, unknown>;
              const ep = enrichedBody.project as Record<string, unknown>;
              // Physical measurement fields — survey is authoritative
              const SURVEY_WINS_FIELDS = [
                'roofType', 'roofPitch', 'rafterSize', 'rafterSpacing',
                'mainPanelAmps', 'mainPanelBrand', 'utilityMeter',
                'interconnectionMethod', 'panelBusRating',
              ] as const;
              for (const field of SURVEY_WINS_FIELDS) {
                if (pp[field] != null) {
                  ep[field] = pp[field];
                  console.log(`[permit/survey] project.${field} = ${pp[field]} (survey)`);
                }
              }
              // roofPlanes: add survey planes if none exist in design body
              if (pp.roofPlanes != null && !(enrichedBody.project as any).roofPlanes?.length) {
                (enrichedBody.project as any).roofPlanes = pp.roofPlanes;
                console.log('[permit/survey] project.roofPlanes set from survey');
              }
              // lat/lng: backfill if missing from design body
              if (pp.lat != null && !(ep.lat)) { ep.lat = pp.lat; }
              if (pp.lng != null && !(ep.lng)) { ep.lng = pp.lng; }
            }

            // compliance.*: append survey notes; preserve existing overallStatus unless survey is worse
            if (patch.compliance) {
              const existingCompliance = enrichedBody.compliance as any;
              if (patch.compliance.overallStatus === 'warning' && existingCompliance?.overallStatus === 'pass') {
                existingCompliance.overallStatus = 'warning';
              }
              if (patch.compliance.structural) {
                existingCompliance.structural = {
                  ...existingCompliance.structural,
                  ...(patch.compliance.structural as any),
                };
              }
              if (patch.compliance.electrical) {
                existingCompliance.electrical = {
                  ...existingCompliance.electrical,
                  ...(patch.compliance.electrical as any),
                };
              }
            }

            // aerialData.*: use survey roof segments only if aerial fetch returned none
            if (
              patch.aerialData?.roofSegments?.length &&
              !(enrichedBody.aerialData as any)?.roofSegments?.length
            ) {
              (enrichedBody as any).aerialData = {
                ...(enrichedBody.aerialData ?? {}),
                roofSegments: patch.aerialData.roofSegments,
              };
              console.log('[permit/survey] aerialData.roofSegments backfilled from survey CAD surfaces');
            }

            // overrides: append survey overrides (never replace design overrides)
            if (patch.overrides?.length) {
              const existingOverrides = (enrichedBody as any).overrides ?? [];
              (enrichedBody as any).overrides = [...existingOverrides, ...patch.overrides];
              console.log('[permit/survey] appended', patch.overrides.length, 'survey override(s)');
            }

          } else {
            console.warn('[permit/survey] fromPhysicalData returned null — skipping survey enrichment');
          }
        }
      } catch (surveyErr: unknown) {
        // Non-critical: permit still generates with design pipeline values
        console.warn('[permit/survey] Survey pipeline error (non-critical):',
          surveyErr instanceof Error ? (surveyErr as Error).message : surveyErr);
      }
    }

    // ── v47.314 Canonical Pipeline ──────────────────────────────────────────
    // systemType / panels / geometry are resolved exclusively by buildCanonical()
    // inside generatePermitHTML(). layout.type is the ONLY source of truth.
    // The old FINAL SYSTEM TYPE ENFORCEMENT block (v47.293+) has been removed.
    // buildCanonical() throws on missing / invalid layout — no silent fallbacks.
    // ─────────────────────────────────────────────────────────────────────────
    console.log('[PLANSET VERSION]', PLANSET_ENGINE_VERSION);
    const html = generatePermitHTML(enrichedBody, storedSldSvg);
    console.log('[PLANSET GENERATED]', { systemType: enrichedBody.project?.systemType, panels: (enrichedBody as any).system?.totalPanels, version: PLANSET_ENGINE_VERSION });

    // ── Save permit HTML to project_files for permit-preview GET endpoint ──────
    // Stored under file_name 'permit_planset.html' so the preview route can
    // load it and extract individual .page divs by index without re-running
    // the full generation pipeline.
    if (projectId && isValidUUID(projectId)) {
      try {
        const sqlSave = await getDbReady();
        const htmlBuf = Buffer.from(html, 'utf8');
        await sqlSave`
          INSERT INTO project_files
            (project_id, client_id, user_id, file_name, file_type, file_size, mime_type, file_data, notes)
          VALUES
            (${projectId}, ${null}, ${user.id},
             'permit_planset.html', 'permit_planset', ${htmlBuf.length},
             'text/html', ${htmlBuf}, 'Auto-saved by permit generator')
          ON CONFLICT (project_id, user_id, file_name)
          DO UPDATE SET
            file_type   = EXCLUDED.file_type,
            file_size   = EXCLUDED.file_size,
            mime_type   = EXCLUDED.mime_type,
            file_data   = EXCLUDED.file_data,
            notes       = EXCLUDED.notes,
            upload_date = NOW()
        `;
        console.log('[permit/save] Saved permit_planset.html to project_files', { projectId, size: htmlBuf.length });
      } catch (saveErr: unknown) {
        // Non-critical — permit still returns even if cache save fails
        console.warn('[permit/save] Failed to save permit HTML to project_files:',
          saveErr instanceof Error ? (saveErr as Error).message : saveErr);
      }
    }

    const format = req.nextUrl.searchParams.get('format') || 'html';

    // Sanitize project name to ASCII-safe characters for HTTP headers (ByteString limit: 0-255)
    const safeProjectName = (project.projectName || 'project')
      .replace(/[^\x00-\xFF]/g, '')
      .replace(/[\r\n]/g, '')
      .replace(/[^\w\s\-\.]/g, '_')
      .trim() || 'project';

    if (format === 'html') {
      return new NextResponse(html, {
        headers: {
          'Content-Type': 'text/html',
          'Content-Disposition': `inline; filename="permit-${safeProjectName}.html"`,
        },
      });
    }

    // PDF via Puppeteer+chromium (Vercel-compatible)
    const pdfResult = await generatePdfFromHtml(html, {
      landscape: true,
      widthIn: PDF_PAGE_CONFIG.width,
      heightIn: PDF_PAGE_CONFIG.height,
    });

    if (pdfResult) {
      return new NextResponse(pdfResult.pdf as unknown as BodyInit, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="PermitPackage-${safeProjectName}.pdf"`,
          'Cache-Control': 'no-store',
          'X-Pdf-Method': pdfResult.method,
        },
      });
    }

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html',
        'Content-Disposition': `attachment; filename="PermitPackage-${safeProjectName}.html"`,
        'X-Pdf-Method': 'html-fallback',
      },
    });

  } catch (error: unknown) {
    console.error('Permit package error:', error);
    return NextResponse.json(
      { success: false, error: (error as Error).message || 'Permit package generation failed' },
      { status: 500 }
    );
  }
}
