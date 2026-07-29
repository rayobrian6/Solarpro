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
import { resolveSnapshotAuthorityInputs } from '@/lib/permit/snapshot/authorityInputs';
import { PERMIT_ARTIFACT_PROFILE, type PlansetProfile } from '@/lib/permit/plansetProfile';
import type { PermitInput } from '@/lib/permit';
import { fetchAerialRoofData, type AerialRoofData } from '@/lib/permit/sections/sitePlan';
import { applyAerialEdgeSnapRegistration } from '@/lib/permit/utils/aerialEdgeSnap';
import { deskewArrayToTrue } from '@/lib/permit/utils/deskewArrayToTrue';

/**
 * Attach the county-GIS parcel boundary to input.aerialData.parcel when missing
 * (PV-2 site-context inset + PV-1 property lines read it). Non-fatal; returns
 * null-safe when the county isn't registered or the fetch fails — property lines
 * are then simply omitted (no fabricated lot geometry).
 */
async function attachParcelIfMissing(input: PermitInput): Promise<void> {
  const aerial = (input as unknown as { aerialData?: { parcel?: unknown; siteFeatures?: unknown } }).aerialData;
  if (!aerial) return;
  const lat = Number(input.project?.lat), lng = Number(input.project?.lng);
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) < 0.001) return;
  const county = (input.project as { county?: string | null })?.county || null;
  const state = (input.project?.address || '').match(/,\s*([A-Z]{2})\s+\d{5}/)?.[1] || null;
  try {
    if (!aerial.parcel) {
      const parcel = await fetchParcelBoundary(lat, lng, county, state);
      if (parcel) {
        (aerial as { parcel?: unknown }).parcel = parcel;
        console.log('[permit] parcel boundary attached:', parcel.polygon.length, 'pts, APN', parcel.apn ?? '—');
      }
    }
  } catch (e: unknown) {
    console.warn('[permit] parcel fetch skipped (non-fatal):', (e as Error)?.message);
  }
  // Nearmap AI ground surfaces (REAL driveways/walks/paving/footprints) — DB-
  // cached (migration 102) so a property costs AT MOST ONE AI parcel, ever.
  // Preferred over OSM; when present we skip the OSM call entirely.
  const _aerialX = aerial as { siteFeatures?: unknown; nearmapSurfaces?: unknown };
  try {
    if (!_aerialX.nearmapSurfaces && process.env.NEARMAP_API_KEY) {
      const nm = await getNearmapSurfacesCached(lat, lng, 55);
      if (nm) {
        _aerialX.nearmapSurfaces = nm;
        console.log('[permit] nearmap surfaces:', nm.driveways.length, 'driveways,', nm.buildings.length, 'buildings,', nm.paved.length, 'paved');
      }
    }
  } catch (e: unknown) {
    console.warn('[permit] nearmap surfaces skipped (non-fatal):', (e as Error)?.message);
  }
  // Real roads + surrounding building footprints (OSM) — fallback ONLY when
  // Nearmap didn't supply surfaces. Non-fatal.
  try {
    if (!_aerialX.siteFeatures && !_aerialX.nearmapSurfaces) {
      const sf = await fetchSiteFeatures(lat, lng, 160);
      if (sf) {
        _aerialX.siteFeatures = sf;
        console.log('[permit] site features attached:', sf.roads.length, 'roads,', sf.buildings.length, 'buildings');
      }
    }
  } catch (e: unknown) {
    console.warn('[permit] site features skipped (non-fatal):', (e as Error)?.message);
  }
}
import { detectAerialVisionObstructions } from '@/lib/aerial/aerialVisionObstructions';
import { fetchParcelBoundary } from '@/lib/aerial/parcelBoundary';
import { fetchSiteFeatures } from '@/lib/aerial/siteFeatures';
import { getNearmapSurfacesCached } from '@/lib/aerial/nearmapCache';
import { OBSTRUCTION_CLEARANCE_M } from '@/lib/aerial/nearmap';
import { normalizeToPermitInverters, designToPermitInverters } from '@/lib/system/designToEngineering';
import { getMicroinverterById } from '@/lib/equipment-db';

// Site Survey pipeline imports — survey data enriches the permit plan set
import { fromPhysicalData, type ProjectPhysicalDataRow } from '@/lib/siteSurvey/fromPhysicalData';
import { normalizeSurvey } from '@/lib/siteSurvey/normalizeSurvey';
import { enrichSurvey } from '@/lib/siteSurvey/enrichSurvey';
import { permitIntegration } from '@/lib/siteSurvey/permitIntegration';
import { collectEngineeringSurveyEvidence } from '@/lib/engineering/surveyEvidence';
import { getProjectSurveyContext } from '@/lib/survey/getProjectSurveyContext';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
import { canonicalToCADInputs, CanonicalBridgeError } from '@/lib/cad/canonicalBridge';
import type { CanonicalBuildingModel } from '@/lib/siteSurveys/unifiedGeometry/types';

// Phase 1 spine: authoritative roof geometry from the persisted canonical model
import { getCanonicalModel } from '@/lib/siteSurveys/unifiedGeometry/canonicalModelStore';
import { canonicalToPermitRoofPlanes, isCanonicalUsableForPlanset } from '@/lib/siteSurveys/unifiedGeometry/canonicalToPermit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';          // Ensure Node.js runtime (Buffer, child_process)
export const maxDuration = 60;            // 60s — aerial API calls can take 10-15s total

// ═══════════════════════════════════════════════════════════════════════════
// AAC WS-9 — PRIOR SNAPSHOT DIGEST (the engineering-review lookup key).
//
// A digest-bound approval can only be FOUND if something knows which digest to
// look for, and the CURRENT digest does not exist until the build completes.
// The prior artifact's digest is the correct lookup key: it is the set the
// reviewer actually saw. Whether that approval still COVERS the set being built
// is decided afterwards, by the existing `reviewedDigest === meta.digest` check
// in certPages / validate / the issue-state gate. So this helper can never
// clear anything on its own — it only makes a real approval visible.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * AAC WS-10 — pin the planset output profile on the input the artifact is built
 * from. The PERMIT ARTIFACT defaults to the compact 'permit' profile; a caller
 * that wants the full internal package asks for it explicitly (body field or
 * `?plansetProfile=full`). This is a COMPOSITION choice only — the snapshot,
 * the release registry and the BOM are built identically either way.
 */
function applyPlansetProfile(input: PermitInput, req: NextRequest): void {
  const carrier = input as unknown as { plansetProfile?: PlansetProfile };
  const fromQuery = req.nextUrl?.searchParams?.get('plansetProfile');
  const requested = carrier.plansetProfile ?? (fromQuery === 'full' || fromQuery === 'permit' ? fromQuery : undefined);
  carrier.plansetProfile = requested ?? PERMIT_ARTIFACT_PROFILE;
}

/** Read the digest off an input that already carries a frozen snapshot. */
function attachPriorSnapshotDigest(input: PermitInput): void {
  const d = (input as unknown as { _snapshot?: { meta?: { digest?: string } } })._snapshot?.meta?.digest;
  if (typeof d === 'string' && d.trim()) {
    (input as unknown as Record<string, unknown>)._priorSnapshotDigest = d;
  }
}

/** Read the prior digest from the stored permit_input.json. Fail-soft in every
 *  direction: no projectId, no row, unparseable JSON or a DB failure all leave
 *  the input untouched, and the review requirement then stays open. */
async function attachPriorSnapshotDigestFromStore(input: PermitInput, projectId: string | undefined): Promise<void> {
  if (!projectId || !isValidUUID(projectId)) return;
  try {
    const sql = await getDbReady();
    const rows = await sql`
      SELECT file_data FROM project_files
      WHERE project_id = ${projectId} AND file_name = 'permit_input.json'
      ORDER BY updated_at DESC NULLS LAST LIMIT 1
    `;
    const buf = (rows as { file_data?: Buffer }[])[0]?.file_data;
    if (!buf) return;
    const prior = JSON.parse(Buffer.from(buf).toString('utf8')) as { _snapshot?: { meta?: { digest?: string } } };
    const d = prior?._snapshot?.meta?.digest;
    if (typeof d === 'string' && d.trim()) {
      (input as unknown as Record<string, unknown>)._priorSnapshotDigest = d;
    }
  } catch {
    // fail-soft: an unreadable prior artifact is not an approval, and never a gate.
  }
}

function isRoofPermitRequest(input: PermitInput): boolean {
  // Error 5n fix: layout.type, layout.groundArrays, layout.fenceSegments, and
  // project.systemType are all on their respective PermitInput types — no `as any` needed.
  const layoutType = String(input.layout?.type ?? '').toLowerCase().trim();
  if (layoutType === 'roof') return true;
  if (layoutType === 'ground_mount' || layoutType === 'ground' || layoutType === 'solar_fence' || layoutType === 'fence') return false;

  const projectType = String(input.project?.systemType ?? '').toLowerCase().trim();
  if (projectType === 'roof') return true;
  // Bug fix: original had `layoutType === 'ground'` instead of `projectType === 'ground'`
  if (projectType === 'ground_mount' || projectType === 'ground' || projectType === 'solar_fence' || projectType === 'fence') return false;

  const hasGround = (input.layout?.groundArrays?.length ?? 0) > 0;
  const hasFence = (input.layout?.fenceSegments?.length ?? 0) > 0;
  return !hasGround && !hasFence;
}

function isExplicitDraftOrLegacyPermit(req: NextRequest, input: PermitInput): boolean {
  const qs = req.nextUrl.searchParams;
  const queryMode = String(qs.get('mode') ?? qs.get('permitMode') ?? '').toLowerCase().trim();
  const queryDraft = qs.get('draft') === 'true' || qs.get('legacy') === 'true' || qs.get('allowLegacyRoofGeometry') === 'true';
  const bodyMode = String(input.mode ?? input.permitMode ?? input.intent ?? '').toLowerCase().trim();
  return queryDraft || queryMode === 'draft' || queryMode === 'legacy' || bodyMode === 'draft' || bodyMode === 'legacy' || input.draft === true || input.allowLegacyRoofGeometry === true;
}

function extractCanonicalBuildingModel(input: PermitInput): CanonicalBuildingModel | null {
  const candidate =
    input.canonicalBuildingModel ??
    input.canonical_building_model ??
    input._canonicalBuildingModel ??
    null;

  if (!candidate || typeof candidate !== 'object') return null;
  if (candidate.schemaVersion !== 'canonical_building_model_v1') return null;
  return candidate as CanonicalBuildingModel;
}


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

    // Load saved permit HTML + the input snapshot (for self-healing regeneration)
    const fileRows = await sql`
      SELECT file_name, file_data FROM project_files
      WHERE project_id = ${projectId}
        AND user_id    = ${projectRow.user_id}
        AND file_name  IN ('permit_planset.html', 'permit_input.json')
    `;
    const _toStr = (d: unknown) => d instanceof Buffer ? d.toString('utf8') : String(d ?? '');
    let html = _toStr((fileRows as Array<{ file_name: string; file_data: unknown }>).find(r => r.file_name === 'permit_planset.html')?.file_data);
    const inputJson = _toStr((fileRows as Array<{ file_name: string; file_data: unknown }>).find(r => r.file_name === 'permit_input.json')?.file_data);

    // ── Staleness / self-heal ────────────────────────────────────────
    // Every engine bump used to hard-409 preview AND pdf until the user
    // manually regenerated ('Permit preview failed'). With the enriched-input
    // snapshot saved at POST time we regenerate HERE with the current engine;
    // dead-ends remain only when nothing usable exists.
    {
      const metaMatch = html.match(/<meta\s+name="planset-version"\s+content="(\d+)"/);
      const savedVerNum = metaMatch ? parseInt(metaMatch[1], 10) : 0;
      const isStale = savedVerNum < PLANSET_ENGINE_VERSION;
      if ((!html || isStale) && inputJson) {
        try {
          const savedInput = JSON.parse(inputJson) as PermitInput;
          // Square the array to true lines (de-skew azimuth + grid) before
          // anything else reads it — see utils/deskewArrayToTrue.ts.
          deskewArrayToTrue(savedInput);
          // Attach the county-GIS parcel boundary if the saved snapshot predates
          // the site-context feature (non-fatal, null-safe).
          await attachParcelIfMissing(savedInput);
          // Google-fallback aerials need the async edge-snap registration
          // computed before the (sync) render — see utils/aerialEdgeSnap.ts.
          await applyAerialEdgeSnapRegistration(savedInput);
          // AAC WS-1 — GET/POST PARITY. This path used to call generatePermitHTML
          // with NO snapshotAuthority, so a regenerated preview silently used the
          // fail-soft defaults and could disagree with the POST artifact (audit
          // §7.11 / §5 "two wiring gaps"). BOTH permit paths now run the SAME
          // resolution lifecycle before the sync build. It never throws.
          // AAC WS-9 — the PRIOR snapshot digest, so engineering-review-record@v1
          // can look for a licensed approval bound to the set that was last
          // produced. The build re-checks `reviewedDigest === meta.digest`, so a
          // stale approval still fails closed; this only lets a CURRENT one be
          // seen at all.
          attachPriorSnapshotDigest(savedInput);
          const selfHealAuthority = await resolveSnapshotAuthorityInputs(savedInput);
          const freshHtml = generatePermitHTML(savedInput, undefined, selfHealAuthority);
          console.log(`[permit/GET] Self-heal: regenerated v${savedVerNum || 0} -> v${PLANSET_ENGINE_VERSION} from permit_input.json`
            + ` (resolution: ${selfHealAuthority.resolution?.iterations ?? 0} iteration(s), stabilized=${selfHealAuthority.resolution?.stabilized ?? false})`, { projectId });
          html = freshHtml;
          // Persist the fresh copy (best-effort)
          try {
            const freshBuf = Buffer.from(freshHtml, 'utf8');
            await sql`
              INSERT INTO project_files
                (project_id, client_id, user_id, file_name, file_type, file_size, mime_type, file_data, notes)
              VALUES
                (${projectId}, ${null}, ${projectRow.user_id},
                 'permit_planset.html', 'permit_planset', ${freshBuf.length},
                 'text/html', ${freshBuf}, 'Auto-regenerated by preview/pdf endpoint')
              ON CONFLICT (project_id, user_id, file_name)
              DO UPDATE SET file_type = EXCLUDED.file_type, file_size = EXCLUDED.file_size,
                mime_type = EXCLUDED.mime_type, file_data = EXCLUDED.file_data,
                notes = EXCLUDED.notes, upload_date = NOW()
            `;
          } catch (persistErr: unknown) {
            console.warn('[permit/GET] Self-heal persist failed (serving fresh HTML anyway):',
              persistErr instanceof Error ? persistErr.message : persistErr);
          }
        } catch (regenErr: unknown) {
          console.warn('[permit/GET] Self-heal regeneration failed — serving stale copy if available:',
            regenErr instanceof Error ? regenErr.message : regenErr);
        }
      }
      if (!html) {
        return NextResponse.json({
          success: false,
          error: 'No permit package found for this project. Generate the permit first from the Engineering page.',
          code: 'PERMIT_NOT_GENERATED',
        }, { status: 404 });
      }
    }
    // ── End staleness / self-heal ────────────────────────────────────

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
    const projectId = body.projectId || project.projectId;
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
          // Error 5p fix: all fields accessed on project are on PermitInput.project type
          // Hub values are unknown (Record<string, unknown>) so cast those instead
          if (!project.clientName   && hub.clientName)       project.clientName   = String(hub.clientName);
          if (!project.address      && hub.serviceAddress)   project.address      = String(hub.serviceAddress);
          if (!project.lat          && hub.lat)              project.lat          = Number(hub.lat);
          if (!project.lng          && hub.lng)              project.lng          = Number(hub.lng);
          if (!project.city         && hub.city)             project.city         = String(hub.city);
          if (!project.state        && hub.state)            project.state        = String(hub.state);
          if (!project.zip          && hub.zip)              project.zip          = String(hub.zip);
          if (!project.utilityName  && hub.utilityProvider)  project.utilityName  = String(hub.utilityProvider);
          // ── Error 3e fix: backfill APN from Client_Profile if available ──
          if (!project.apn && hub.apn)             project.apn = String(hub.apn);
          if (!project.apn && hub.parcelNumber)    project.apn = String(hub.parcelNumber);
          if (!project.apn && hub.parcel_id)       project.apn = String(hub.parcel_id);
          console.log('[permit/hub] Backfilled from Client_Profile.json:', {
            projectId, clientName: project.clientName, address: project.address,
            apn: project.apn || '(not found)',
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
            project.systemType = dbSysType;
          } else {
            console.log('[permit/POST] system_type OK — DB:', dbSysType, 'matches sent:', sentSysType);
          }

          // FIX v47.318: Also correct body.layout.type if it does not match the DB system type.
          // This fixes the case where rowToLayout defaulted layout.systemType to 'roof' when
          // layouts.system_type was NULL, causing the frontend to send layout.type='roof'.
          const canonicalType = dbToCanonicalType(dbSysType);
          const sentLayoutType = (body.layout?.type || '').toLowerCase().trim();
          if (body.layout && sentLayoutType !== canonicalType) {
            console.warn('[permit/POST] FIX v47.318: layout.type mismatch — DB canonical:', canonicalType,
              'sent:', sentLayoutType, '| DB layout row type:', dbLayoutType, '— correcting layout.type');
            body.layout.type = canonicalType;
          }
          // Also correct layout.systemType (the legacy field on the layout object)
          if (body.layout) {
            const sentLayoutSys = (body.layout?.systemType || '').toLowerCase().trim();
            if (sentLayoutSys !== dbSysType) {
              body.layout.systemType = dbSysType;
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
        layoutPanels: project.panelPositions?.length ?? 0,
        engineeringPanels: 0,
      }, { status: 422 });
    }

    // STEP 5 -- PERMIT INPUT LOGGING
    // Error 5p fix: panelPositions and roofPlanes are on PermitInput.project type
    const _panelPositions = project.panelPositions as Array<unknown> | undefined;
    const _roofPlanes     = project.roofPlanes     as Array<unknown> | undefined;
    console.log('[PERMIT INPUT]', {
      projectName:        project.projectName,
      address:            project.address,
      panelCount:         body.system?.totalPanels ?? 0,
      panelPositionCount: Array.isArray(_panelPositions) ? _panelPositions.length : 'MISSING',
      roofPlaneCount:     Array.isArray(_roofPlanes) ? _roofPlanes.length : 'MISSING',
      hasPanelPositions:  Array.isArray(_panelPositions) && _panelPositions.length > 0,
      hasRoofPlanes:      Array.isArray(_roofPlanes) && _roofPlanes.length > 0,
    });

    // ── Normalize compliance: ensure it always has at least a skeleton so
    //    page functions never crash on compliance.jurisdiction?.xxx access
    //    when the frontend omits or sends null/undefined compliance.
    if (!body.compliance) {
      body.compliance = {
        overallStatus: 'PASS',
        jurisdiction: {
          state:      project.address?.match(/,\s*([A-Z]{2})\s+\d{5}/)?.[1] || '—',
          necVersion: '2020',
          ahj:        project.ahj || '—',
          permitNotes: undefined,
        },
      };
    } else if (!body.compliance.jurisdiction) {
      body.compliance.jurisdiction = {
        state:      project.address?.match(/,\s*([A-Z]{2})\s+\d{5}/)?.[1] || '—',
        necVersion: '2020',
        ahj:        project.ahj || '—',
      };
    }

    // ── Normalize system: ensure inverters array exists
    if (!body.system) {
      body.system = {
        totalDcKw:   0,
        totalAcKw:   0,
        totalPanels: 0,
        dcAcRatio:   1,
        topology:    'microinverter',
        inverters:   [],
      };
    } else if (!body.system.inverters) {
      body.system.inverters = [];
    }

    // ── Backfill inverters/strings from the PERSISTED design when the POSTed
    // payload is empty or a single-string placeholder ────────────────────────
    // The planset is built from the Engineering page's live React state at click
    // time; when that's empty/stale it renders the default "1 string of N + micro"
    // and discards the real structure (e.g. 11/11/4) + equipment. We pull the
    // authoritative structure from the DB and run it through normalizeToPermitInverters,
    // which GUARANTEES a complete shape (every field the renderer reads), so a
    // partial/stale record can never feed malformed data into generation. Any
    // failure → keep the original payload (never breaks the permit).
    try {
      const invs = (body.system.inverters as any[]) || [];
      const postedStrings = invs.reduce((s, inv) => s + ((inv?.strings?.length) ?? 0), 0);
      const placeholder = invs.length === 0 || (invs.length === 1 && ((invs[0]?.strings?.length ?? 0) <= 1));
      if (placeholder && projectId && isValidUUID(projectId)) {
        const sql = await getDbReady();
        let derived: ReturnType<typeof normalizeToPermitInverters> = null;

        // 1) Saved engineering_config (authoritative engineered state), normalized.
        try {
          const ecRows = await sql`SELECT engineering_config FROM projects WHERE id = ${projectId} LIMIT 1`;
          const ec = ecRows[0]?.engineering_config as any;
          if (Array.isArray(ec?.inverters)) derived = normalizeToPermitInverters(ec.inverters);
        } catch (ecErr) {
          console.log('[permit/POST] engineering_config read skipped:', (ecErr as Error)?.message);
        }

        // 2) Fall back to the 3D design (layout.design_electrical).
        if (!derived) {
          try {
            const loRows = await sql`SELECT design_electrical FROM layouts WHERE project_id = ${projectId} ORDER BY updated_at DESC LIMIT 1`;
            const de = loRows[0]?.design_electrical as any;
            if (de && Array.isArray(de.strings) && de.strings.length > 0) {
              derived = designToPermitInverters(de, { selectedInverterId: (project as any).selectedInverter?.id });
            }
          } catch (deErr) {
            // design_electrical column may not exist yet (migration 096) — non-fatal
            console.log('[permit/POST] design_electrical read skipped:', (deErr as Error)?.message);
          }
        }

        // Only override when the derived structure is richer than the placeholder
        // (more strings), or when the POSTed payload was empty.
        if (derived && derived.length > 0) {
          const derivedStrings = derived.reduce((s, inv) => s + inv.strings.length, 0);
          if (invs.length === 0 || derivedStrings > postedStrings) {
            body.system.inverters = derived as any;
            const t = derived[0].type;
            body.system.topology = t === 'micro' ? 'microinverter' : t === 'optimizer' ? 'optimizer' : 'string';
            console.log('[permit/POST] Backfilled inverters from persisted design:',
              derived.length, 'inverter(s),', derivedStrings, 'strings, topology', body.system.topology);
          }
        }
      }
    } catch (backfillErr) {
      console.log('[permit/POST] inverter backfill failed (non-fatal):', (backfillErr as Error)?.message);
    }

    // ─── Hybrid per-sub self-heal (permit integrity — E-1 "INVERTER NOT SELECTED") ─
    // A Design-Studio round-trip / reload can hand the permit an in-memory config
    // whose inverters lost their subSystemKey tags AND whose subSystems map is
    // gone. The per-sub resolver then collapses EVERY hybrid lane to '—' — E-1
    // prints "INVERTER NOT SELECTED" on all three (roof/ground/fence), each
    // defaulting to a generic STRING INVERTER even for the roof micros. The saved
    // engineering_config is authoritative and survives the round-trip in the DB,
    // so restore the per-sub association from it: the subSystems MAP (which alone
    // lets resolveEquipmentBySubSystem fill each lane from subSystems[key].inverterId
    // — verified) PLUS re-tag the posted inverters by inverterId match. Fill-only:
    // a payload that still carries tags/map is respected untouched. Non-fatal.
    try {
      if (projectId && isValidUUID(projectId)) {
        const _invs = (body.system?.inverters as any[]) || [];
        const _anyTag = _invs.some(i => i?.subSystemKey || (i?.strings || []).some((s: any) => s?.subSystemKey));
        const _mapOk = !!(body.project as any)?.subSystems && Object.keys((body.project as any).subSystems).length > 0;
        if ((!_anyTag || !_mapOk) && _invs.length > 0) {
          const sql = await getDbReady();
          const ecRows = await sql`SELECT engineering_config FROM projects WHERE id = ${projectId} LIMIT 1`;
          const ec = ecRows[0]?.engineering_config as any;
          const savedInvs: any[] = Array.isArray(ec?.inverters) ? ec.inverters : [];
          if (!_mapOk && ec?.subSystems && Object.keys(ec.subSystems).length > 0) {
            (body.project as any).subSystems = ec.subSystems;
            console.log('[permit/POST] hybrid self-heal: restored subSystems map from engineering_config →', Object.keys(ec.subSystems).join(','));
          }
          if (!_anyTag && savedInvs.length > 0) {
            const idToKey = new Map<string, string>();
            for (const si of savedInvs) if (si?.inverterId && si?.subSystemKey) idToKey.set(String(si.inverterId), String(si.subSystemKey));
            let _tagged = 0;
            for (const inv of _invs) {
              const k = inv?.inverterId ? idToKey.get(String(inv.inverterId)) : undefined;
              if (k) {
                inv.subSystemKey = k;
                for (const st of (inv.strings || [])) if (st) st.subSystemKey = k;
                _tagged++;
              }
            }
            if (_tagged > 0) console.log('[permit/POST] hybrid self-heal: re-tagged', _tagged, 'inverter(s) from engineering_config by inverterId');
          }
        }
      }
    } catch (healErr) {
      console.log('[permit/POST] hybrid self-heal skipped (non-fatal):', (healErr as Error)?.message);
    }

    // ─── P0-12: normalize inverter `type` to the canonical enum ─────────────
    // Clients/DB rows have stored brand strings ('ecoflow', model names) in
    // inverter.type — every `type === 'micro'` topology fork downstream then
    // works only by accident. Canonical values: 'micro' | 'string' | 'optimizer';
    // hybrid all-in-one units count as 'string' for topology forks. Resolution:
    // equipment-db micro record by inverterId wins, else a 'micro' substring,
    // else 'string'. Empty types are left alone (topology-based forks handle them).
    {
      const CANONICAL_INV_TYPES = new Set(['micro', 'string', 'optimizer']);
      for (const inv of (body.system.inverters as Array<{ type?: string; inverterId?: string }>) || []) {
        if (!inv) continue;
        const rawType = String(inv.type ?? '').toLowerCase().trim();
        if (!rawType || CANONICAL_INV_TYPES.has(rawType)) continue;
        const mapped = (inv.inverterId && getMicroinverterById(String(inv.inverterId))) ? 'micro'
          : rawType.includes('micro') ? 'micro'
          : 'string';
        console.warn('[permit/POST] P0-12 inverter type normalized:', `'${inv.type}'`, '→', `'${mapped}'`,
          inv.inverterId ? `(inverterId=${inv.inverterId})` : '(no inverterId)');
        inv.type = mapped;
      }
    }

    // ─── Auto-populate AHJ data from national database ──────────────────────
    {
      const stateFromAddr = (body.project?.address || '').match(/,\s*([A-Z]{2})\s+\d{5}/)?.[1] || '';
      const sc = body.project.state || stateFromAddr;
      const ct = body.project.city || '';
      const cn = body.project.county || '';
      if (sc) {
        try {
          // Dynamic import to avoid build-time issues
          const ahjModule = await import('@/lib/jurisdictions/ahj-national').catch(() => null);
          const searchAhjFn = ahjModule?.searchAhj || ahjModule?.default?.searchAhj;
          if (typeof searchAhjFn === 'function') {
            const ahjResults = searchAhjFn({ stateCode: sc, city: ct, county: cn });
            if (Array.isArray(ahjResults) && ahjResults.length > 0) {
              // Enrich with real NREL SolarTRACE permit-process data (online/instant
              // permitting, median permit cost, median permit days) where available.
              const overlayMod = await import('@/lib/jurisdictions/solartraceOverlay').catch(() => null);
              const ar = overlayMod?.enrichWithSolarTrace ? overlayMod.enrichWithSolarTrace(ahjResults[0]) : ahjResults[0];
              console.log('[permit/AHJ] Found:', ar.ahjName, '| wind:', ar.windSpeedMph, 'mph | snow:', ar.groundSnowLoadPsf, 'psf');
              // THE AHJ DATABASE IS THE SINGLE SOURCE OF TRUTH (Ray, 2026-07-01).
              // These fields were fill-if-empty, so a per-project snapshot taken at
              // design time silently beat later corrections to the database. DB now
              // WINS at planset time; the project value survives only when the DB
              // has nothing for that field. Overrides are logged for the audit trail.
              const _ahjWins = <T>(cur: T | undefined | null, db: T | undefined | null, name: string): T | undefined => {
                if (db == null || (db as unknown) === '') return cur ?? undefined;
                if (cur != null && (cur as unknown) !== '' && cur !== db) {
                  console.log(`[permit/AHJ] override ${name}: project=${cur} → ahjdb=${db}`);
                }
                return db;
              };
              body.project.ahjName          = _ahjWins(body.project.ahjName, ar.ahjName, 'ahjName');
              // ── AAC WS-4 (2026-07-27): THE TABLE NO LONGER WINS ON SITE HAZARDS ──
              // Ray's 2026-07-01 "AHJ DB is the single source of truth" ruling is
              // about AHJ POLICY (setbacks, fees, plan-check days, the enforced NEC
              // year). Wind speed, ground snow and the seismic design category are
              // NOT AHJ policy — they are SITE properties of a coordinate, and the
              // curated ahj-national row carries them with no ordinance, no
              // effective date and no hash. (The live AHJ registry client refuses to
              // publish them for exactly this reason: ahjRegistry.ts:134-138.)
              // Braidon proved the cost: the table would force 110 mph / 20 psf /
              // SDC 'B'; the ASCE 7-22 + USGS retrieval returns 107.5 mph /
              // 23.3 psf / SDC 'D'. So for these three the table is now a
              // FILL-IF-EMPTY fallback, and where each value came from is STAMPED,
              // so the WS-4 resolver can tell an authority that disagrees with the
              // retrieval (⇒ OPERATOR_CONFIRMATION) from a sourceless default
              // (⇒ superseded outright).
              const _hadWind = body.project.ahjWindSpeedMph != null;
              const _hadSnow = body.project.ahjGroundSnowPsf != null;
              const _hadSdc  = project.seismicCategory != null && String(project.seismicCategory) !== '';
              if (!_hadWind && ar.windSpeedMph != null) body.project.ahjWindSpeedMph = ar.windSpeedMph;
              if (!_hadSnow && ar.groundSnowLoadPsf != null) body.project.ahjGroundSnowPsf = ar.groundSnowLoadPsf;
              if (!_hadSdc && ar.seismicDesignCategory) project.seismicCategory = ar.seismicDesignCategory;
              (body.project as Record<string, unknown>).environmentalValueProvenance = {
                windSpeedMph: _hadWind ? 'operator-entered'
                  : body.project.ahjWindSpeedMph != null ? 'unprovenanced-table' : 'absent',
                groundSnowPsf: _hadSnow ? 'operator-entered'
                  : body.project.ahjGroundSnowPsf != null ? 'unprovenanced-table' : 'absent',
                seismicDesignCategory: _hadSdc ? 'operator-entered'
                  : project.seismicCategory ? 'unprovenanced-table' : 'absent',
                basis: 'Wind / ground snow / SDC are SITE properties of a coordinate, not AHJ policy. The curated '
                  + 'ahj-national table has no adoption ordinance, no effective date and no hash, so it fills these '
                  + 'only when the project carries nothing, and never overwrites an operator value. The authority is '
                  + 'the ASCE 7 hazard retrieval (environmental-load-authority@v1).',
                tableOffered: {
                  windSpeedMph: ar.windSpeedMph ?? null,
                  groundSnowLoadPsf: ar.groundSnowLoadPsf ?? null,
                  seismicDesignCategory: ar.seismicDesignCategory ?? null,
                  record: ar.id ?? null,
                },
              };
              body.project.ahjRoofSetbackIn  = _ahjWins(body.project.ahjRoofSetbackIn, ar.roofSetbackInches, 'roofSetbackIn');
              body.project.ahjRidgeSetbackIn = _ahjWins(body.project.ahjRidgeSetbackIn, ar.ridgeSetbackInches, 'ridgeSetbackIn');
              body.project.ahjNecVersion    = _ahjWins(body.project.ahjNecVersion, ar.necVersion, 'necVersion');
              body.project.ahjPermitFee     = _ahjWins(body.project.ahjPermitFee, ar.typicalPermitFee, 'permitFee');
              body.project.ahjPlanCheckDays = _ahjWins(body.project.ahjPlanCheckDays, ar.typicalPlanCheckDays, 'planCheckDays');
              if (!body.project.ahjSpecialRequirements || body.project.ahjSpecialRequirements.length === 0) {
                body.project.ahjSpecialRequirements = [
                  ...(ar.specialRequirements || []),
                  ...(ar.planSetRequirements || []).slice(0, 4),
                ];
              }
              // Propagate to compliance.jurisdiction — DB-first, same rule as above.
              if (!body.compliance.jurisdiction) {
                body.compliance.jurisdiction = { state: sc, necVersion: ar.necVersion, ahj: ar.ahjName };
              } else {
                body.compliance.jurisdiction.ahj        = _ahjWins(body.compliance.jurisdiction.ahj, ar.ahjName, 'jurisdiction.ahj');
                body.compliance.jurisdiction.necVersion = _ahjWins(body.compliance.jurisdiction.necVersion, ar.necVersion, 'jurisdiction.necVersion');
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
    // ── Authoritative aerial center (Ray, 2026-06-30) ───────────────────────────
    // The aerial MUST frame the CUSTOMER'S house. We cannot trust the design's panel
    // centroid OR the stored project.lat/lng for "which house": when this project was
    // created the address geocoded ~1 house off, so the roof was traced on the NEIGHBOR
    // and the stored coord points there too — both are on the wrong building (confirmed:
    // 3 Melvin Dr design sits ~17 m NORTH of the real house). The address geocode is the
    // only authority for which building is the subject, so re-geocode it FRESH here. US
    // Census is parcel-accurate for US street addresses, needs no key, and returns the
    // same correct house the Design Studio fly-in lands on. Fall back to the stored coord
    // only if the geocode fails.
    let _centerLat = body.project.lat, _centerLng = body.project.lng;
    const _addr = body.project?.address || '';
    if (_addr) {
      try {
        const _cu = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(_addr)}&benchmark=Public_AR_Current&format=json`;
        const _cr = await fetch(_cu, { signal: AbortSignal.timeout(6000) });
        const _cj = await _cr.json() as { result?: { addressMatches?: Array<{ coordinates?: { x?: number; y?: number } }> } };
        const _m = _cj?.result?.addressMatches?.[0]?.coordinates;
        if (_m && isFinite(Number(_m.y)) && isFinite(Number(_m.x)) && Math.abs(Number(_m.y)) > 0.001) {
          _centerLat = Number(_m.y);
          _centerLng = Number(_m.x);
          console.log('[permit/aerial] authoritative center from Census geocode', _centerLat, _centerLng);
        } else {
          console.warn('[permit/aerial] Census returned no match — using stored project coords');
        }
      } catch (_ge) {
        console.warn('[permit/aerial] Census geocode failed (non-fatal), using stored coords:', (_ge as Error)?.message);
      }
    }
    // Center the aerial on the DESIGN geometry ("3D drives 2D" — the design is the
    // authority for framing). The request body already carries the design
    // roofPlanes/panels (read above), so compute the centroid NOW and pass it as
    // arrayCenter; chooseAerialCenter frames on it, guarded to <300m from the geocode
    // pin against cross-contamination. Falls back to the geocode pin when there's no
    // design geometry on the body (the post-enrichment re-center covers that case).
    const _bodyMean = (pts: Array<{ lat?: number; lng?: number }>) => {
      const v = pts.filter(p => p && isFinite(Number(p.lat)) && isFinite(Number(p.lng)) && Math.abs(Number(p.lat)) > 0.001);
      if (!v.length) return undefined;
      return { lat: v.reduce((s, p) => s + Number(p.lat), 0) / v.length, lng: v.reduce((s, p) => s + Number(p.lng), 0) / v.length };
    };
    const _bodyPanels = (project.panelPositions ?? []) as Array<{ lat?: number; lng?: number }>;
    const _bodyVerts = ((project.roofPlanes ?? []) as Array<{ vertices?: Array<{ lat?: number; lng?: number }> }>).flatMap(rp => rp.vertices ?? []);
    const _bodyDesignCenter = _bodyMean(_bodyPanels) ?? _bodyMean(_bodyVerts);
    if (_bodyDesignCenter) console.log('[permit/aerial] initial fetch centered on DESIGN centroid', _bodyDesignCenter.lat.toFixed(6), _bodyDesignCenter.lng.toFixed(6));

    const aerialData = await fetchAerialRoofData(
      _centerLat,
      _centerLng,
      _addr,
      _bodyDesignCenter,
    ).catch((aerialErr: any) => {
      console.log('[permit/POST] fetchAerialRoofData THREW:', aerialErr?.message);
      return { error: 'Aerial fetch threw: ' + aerialErr?.message } as AerialRoofData;
    });
    const aerialMs = Date.now() - aerialStart;
    console.log('[permit/POST] Aerial fetch completed in', aerialMs, 'ms');
    console.log('[permit/POST] aerialData.imageBase64:', aerialData.imageBase64 ? `YES (${aerialData.imageBase64.length} chars)` : 'NO');
    console.log('[permit/POST] aerialData.roofSegments:', aerialData.roofSegments?.length ?? 0);
    console.log('[permit/POST] aerialData.error:', aerialData.error || 'none');
    // County-GIS parcel boundary for the PV-2 site-context inset (+ PV-1 property
    // lines). Uses the accurate (re-geocoded) center. Null-safe when the county
    // isn't registered — property lines are then omitted (no fabricated lot).
    if (aerialData && !(aerialData as { parcel?: unknown }).parcel
        && isFinite(_centerLat) && isFinite(_centerLng) && Math.abs(_centerLat) > 0.001) {
      try {
        const _stateP = body.project?.state || (body.project?.address || '').match(/,\s*([A-Z]{2})\s+\d{5}/)?.[1] || null;
        const _parcel = await fetchParcelBoundary(_centerLat, _centerLng, body.project?.county || null, _stateP);
        if (_parcel) {
          (aerialData as { parcel?: unknown }).parcel = _parcel;
          console.log('[permit/POST] parcel boundary:', _parcel.polygon.length, 'pts, APN', _parcel.apn ?? '—');
        }
      } catch (e: unknown) { console.warn('[permit/POST] parcel fetch skipped (non-fatal):', (e as Error)?.message); }
    }
    // NOTE: site-context surfaces (Nearmap AI / OSM) are fetched LATER, AFTER the
    // aerial re-center (which replaces enrichedBody.aerialData) — see below. If
    // fetched here they'd be wiped by that re-assignment (the bug that dropped
    // driveways/buildings from PV-2 while the re-fetched parcel survived).
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
        // NOTE: Column names MUST match the actual DB schema (migration 013 + 017).
        //   roof_pitch (TEXT enum) NOT roof_pitch_degrees
        //   panel_rating_amps (INTEGER) NOT main_panel_rating_amps
        //   available_breaker_slots (TEXT) NOT breaker_spaces_available
        //   usable_roof_pct (INTEGER 0-100) NOT usable_area_sqft
        //   Additional columns added by migration 050+ (IF NOT EXISTS):
        //     decking_thickness_in, structural_notes, busbar_rating_amps,
        //     breaker_spaces_available, has_existing_solar, total_roof_area_sqft,
        //     usable_area_sqft, site_address, lat, lng, main_panel_rating_amps,
        //     roof_pitch_degrees
        const physRows = await sqlSurvey`
          SELECT
            id, project_id,
            roof_material, roof_age_years, roof_condition,
            roof_pitch, roof_pitch_degrees,
            rafter_spacing_in, decking_thickness_in, structural_notes,
            panel_rating_amps, main_panel_rating_amps,
            available_breaker_slots, breaker_spaces_available,
            busbar_rating_amps,
            interconnection_point, panel_brand, has_existing_solar, electrical_notes,
            obstructions, usable_roof_pct,
            total_roof_area_sqft, usable_area_sqft,
            access_notes, mounting_notes, setback_notes,
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
            const surveyContext = await getProjectSurveyContext(projectId, user.id);
            const evidenceHygiene = surveyContext.evidenceHygiene;
            const canonicalManifest = evidenceHygiene?.canonicalManifest ?? null;
            const surveyEvidence = collectEngineeringSurveyEvidence(enriched, {
              canonicalManifest,
              evidenceDuplicateGroups: evidenceHygiene?.evidenceDuplicateGroups,
              sessions: evidenceHygiene?.sessions,
            });
            enrichedBody.surveyEvidence = surveyEvidence;
            const { patch, sheetData, permitLog, warnings } = permitIntegration(enriched);

            console.log('[permit/survey] evidence completeness:', surveyEvidence.completeness, {
              canonicalEvidenceCount: surveyEvidence.canonicalEvidenceCount,
              rawPhotoCount: surveyEvidence.rawPhotoCount,
              truthSource: surveyEvidence.evidenceTruthSource,
              missingCategories: surveyEvidence.missingCategories,
              warnings: surveyEvidence.warnings.length,
              blockers: surveyEvidence.blockers.length,
            });

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
              if (pp.roofPlanes != null && !enrichedBody.project.roofPlanes?.length) {
                // pp is Record<string, unknown>; cast roofPlanes to the correct PermitInput type
                enrichedBody.project.roofPlanes = pp.roofPlanes as typeof enrichedBody.project.roofPlanes;
                console.log('[permit/survey] project.roofPlanes set from survey');
              }
              // lat/lng: backfill if missing from design body
              if (pp.lat != null && !(ep.lat)) { ep.lat = pp.lat; }
              if (pp.lng != null && !(ep.lng)) { ep.lng = pp.lng; }
            }

            // compliance.*: append survey notes; preserve existing overallStatus unless survey is worse
            if (patch.compliance) {
              // Error 5r fix: compliance structural/electrical are `any` — no `as any` needed for access
              const existingCompliance = enrichedBody.compliance;
              if (patch.compliance.overallStatus === 'warning' && existingCompliance?.overallStatus === 'pass') {
                existingCompliance.overallStatus = 'warning';
              }
              if (patch.compliance.structural) {
                existingCompliance.structural = {
                  ...existingCompliance.structural,
                  ...(patch.compliance.structural),
                };
              }
              if (patch.compliance.electrical) {
                existingCompliance.electrical = {
                  ...existingCompliance.electrical,
                  ...(patch.compliance.electrical),
                };
              }
            }

            // aerialData.*: use survey roof segments only if aerial fetch returned none
            if (
              patch.aerialData?.roofSegments?.length &&
              !enrichedBody.aerialData?.roofSegments?.length
            ) {
              enrichedBody.aerialData = {
                ...(enrichedBody.aerialData ?? {}),
                roofSegments: patch.aerialData.roofSegments,
              };
              console.log('[permit/survey] aerialData.roofSegments backfilled from survey CAD surfaces');
            }

            // overrides: append survey overrides (never replace design overrides)
            if (patch.overrides?.length) {
              const existingOverrides = enrichedBody.overrides ?? [];
              enrichedBody.overrides = [...existingOverrides, ...patch.overrides];
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

    // ── Authoritative roof geometry from the persisted CanonicalBuildingModel ──
    // (Roadmap Phase 1 — survey→canonical→planset spine.) When a survey for this
    // project has a promoted_canonical / cad_safe model, its roof planes are the
    // AUTHORITATIVE source and OVERRIDE design-body / placeholder planes (e.g. the
    // pitch-20/azimuth-360 stubs). If no such model exists — nothing promoted yet,
    // or migration 087 not applied — getCanonicalModel returns null and this is a
    // safe no-op, leaving the prior design/survey roof planes untouched.
    if (projectId && isValidUUID(projectId)) {
      try {
        const sqlCanon = await getDbReady();
        const surveyRows = (await sqlCanon`
          SELECT id FROM site_surveys
          WHERE project_id = ${projectId}
          ORDER BY created_at DESC
        `) as Array<{ id: string }>;

        let usedModel = false;
        for (const { id: surveyId } of surveyRows) {
          const model = await getCanonicalModel(surveyId);
          if (!isCanonicalUsableForPlanset(model)) continue;
          const planes = canonicalToPermitRoofPlanes(model);
          if (planes.length === 0) continue;

          enrichedBody.project.roofPlanes = planes;
          enrichedBody.project.roofPlanesSource = 'canonical_building_model';
          console.log(
            `[permit/canonical] project.roofPlanes set from CanonicalBuildingModel ` +
            `survey=${surveyId} planes=${planes.length} authority=${model.authority.state} ` +
            `(authoritative override of design/placeholder geometry)`,
          );
          // Also attach the model for the CAD bridge gate below
          enrichedBody.canonicalBuildingModel = model;
          usedModel = true;
          break;
        }
        if (!usedModel) {
          console.log(
            '[permit/canonical] No usable CanonicalBuildingModel for project', projectId,
            '— keeping design/survey roof planes',
          );
        }
      } catch (canonErr: unknown) {
        // Non-critical: permit still generates with design/survey values
        console.warn('[permit/canonical] Canonical model lookup error (non-critical):',
          canonErr instanceof Error ? (canonErr as Error).message : canonErr);
      }
    }

    // ── Canonical roof geometry gate ────────────────────────────────────────
    // Submission-ready roof plansets must use reviewed/cad-safe CanonicalBuildingModel
    // roof geometry. Legacy project.roofPlanes remain available only for explicit
    // draft/legacy generation so old previews do not silently masquerade as permit-ready.
    // The DB lookup above may have attached a canonicalBuildingModel to enrichedBody;
    // alternatively the caller may supply one in the request body.
    const isRoofPermit = isRoofPermitRequest(enrichedBody);
    const allowDraftLegacyRoofGeometry = isExplicitDraftOrLegacyPermit(req, enrichedBody);
    const canonicalBuildingModel = extractCanonicalBuildingModel(enrichedBody);

    // A promoted CanonicalBuildingModel is required for SUBMISSION-READY plansets,
    // but a project with real design roof geometry (Google-Solar / aerial roofPlanes
    // + GPS panel positions) should still GENERATE — as a draft — rather than hard-
    // 422. Hard-blocking here meant any project without a promoted canonical model
    // (i.e. most studio designs) could not produce a planset at all. Treat real
    // design geometry as sufficient for a draft generation.
    const _designRoofPlanes = (enrichedBody.project?.roofPlanes ?? []) as Array<{ vertices?: Array<{ lat?: number; lng?: number }> }>;
    const _designPanels = (enrichedBody.project?.panelPositions ?? []) as Array<{ lat?: number; lng?: number }>;
    const hasRealDesignRoofGeometry =
      _designRoofPlanes.some(p =>
        Array.isArray(p?.vertices) && p.vertices.length >= 3 &&
        p.vertices.every(v => isFinite(Number(v?.lat)) && isFinite(Number(v?.lng)) && Math.abs(Number(v?.lat)) > 0.001),
      ) &&
      _designPanels.some(p => isFinite(Number(p?.lat)) && isFinite(Number(p?.lng)) && Math.abs(Number(p?.lat)) > 0.001);

    if (isRoofPermit) {
      if (!canonicalBuildingModel) {
        if (!allowDraftLegacyRoofGeometry && !hasRealDesignRoofGeometry) {
          console.error('[PERMIT BLOCKED] CANONICAL_ROOF_GEOMETRY_REQUIRED', { projectId, designRoofPlanes: _designRoofPlanes.length, designPanels: _designPanels.length });
          return NextResponse.json({
            success: false,
            error: 'CANONICAL_ROOF_GEOMETRY_REQUIRED',
            code: 'CANONICAL_ROOF_GEOMETRY_REQUIRED',
            message: 'Roof permit generation needs roof geometry: either a promoted CanonicalBuildingModel (for a submission-ready set) or real design roof planes + panel positions from the Design Studio. This project has neither — open the design, detect/draw the roof and place panels, then regenerate.',
            projectId,
          }, { status: 422 });
        }
        if (!allowDraftLegacyRoofGeometry && hasRealDesignRoofGeometry) {
          console.warn('[PERMIT DRAFT] No promoted CanonicalBuildingModel — generating a DRAFT planset from real design roof geometry (not submission-ready)', { projectId, designRoofPlanes: _designRoofPlanes.length, designPanels: _designPanels.length });
        } else {
          console.warn('[PERMIT DRAFT/LEGACY] Proceeding without CanonicalBuildingModel roof geometry by explicit request', { projectId });
        }
      } else {
        try {
          const bridge = canonicalToCADInputs(canonicalBuildingModel, {
            originLat: project.lat ?? undefined,
            originLng: project.lng ?? undefined,
          });
          if (bridge.roofPlanes.length === 0 && !allowDraftLegacyRoofGeometry) {
            console.error('[PERMIT BLOCKED] CANONICAL_ROOF_PLANES_MISSING', { projectId, surveyId: canonicalBuildingModel.surveyId });
            return NextResponse.json({
              success: false,
              error: 'CANONICAL_ROOF_PLANES_MISSING',
              code: 'CANONICAL_ROOF_PLANES_MISSING',
              message: 'Submission-ready roof permit generation requires at least one CAD-safe canonical roof plane polygon.',
              projectId,
              surveyId: canonicalBuildingModel.surveyId,
            }, { status: 422 });
          }
          enrichedBody._canonicalBuildingModel = canonicalBuildingModel;
          enrichedBody._canonicalCADBridge = bridge;
          console.log('[PERMIT CANONICAL ROOF]', {
            projectId,
            surveyId: canonicalBuildingModel.surveyId,
            roofPlanes: bridge.roofPlanesConverted,
            obstructions: bridge.obstructionsConverted,
            electricalNodes: bridge.electricalNodesConverted,
          });
        } catch (bridgeErr: unknown) {
          const message = bridgeErr instanceof Error ? bridgeErr.message : String(bridgeErr);
          if (!allowDraftLegacyRoofGeometry) {
            console.error('[PERMIT BLOCKED] CANONICAL_ROOF_GEOMETRY_INVALID', { projectId, message });
            return NextResponse.json({
              success: false,
              error: 'CANONICAL_ROOF_GEOMETRY_INVALID',
              code: 'CANONICAL_ROOF_GEOMETRY_INVALID',
              message,
              projectId,
            }, { status: bridgeErr instanceof CanonicalBridgeError ? 422 : 500 });
          }
          console.warn('[PERMIT DRAFT/LEGACY] Canonical roof geometry invalid; proceeding by explicit request', { projectId, message });
        }
      }
    }

    // ── v47.314 Canonical Pipeline ──────────────────────────────────────────
    // systemType / panels / geometry are resolved exclusively by buildCanonical()
    // inside generatePermitHTML(). layout.type is the ONLY source of truth.
    // The old FINAL SYSTEM TYPE ENFORCEMENT block (v47.293+) has been removed.
    // buildCanonical() throws on missing / invalid layout — no silent fallbacks.
    // ─────────────────────────────────────────────────────────────────────────
    console.log('[PLANSET VERSION]', PLANSET_ENGINE_VERSION);
    // Explicit opt-in for the non-authoritative CAD preview appendix in generated permit packages.
    // The appendix is additive only: it does not replace PV-2/PV-3 and does not mutate CAD, engineering, NEC, BOM, routing, workflow, recommendations, or permit authority.
    enrichedBody.cadAppendixPreviewV1 = true;

    // ── Error 3e fix: APN server-side enrichment ──────────────────────────
    // APN is needed on every permit page (coverSheet, sitePlan, titleBlock,
    // certPages, peLetter) but was never passed from the frontend and never
    // populated server-side. The hub backfill above covers Client_Profile.json,
    // but the APN may also live in the property enrichment data (ATTOM API)
    // stored in network_opportunities.parcel_id. Try to fetch it from there.
    // Error 5p fix: apn is on PermitInput.project type — no `as any` needed
    {
      if (!enrichedBody.project.apn && projectId && isValidUUID(projectId)) {
        try {
          const apnSql = await getDbReady();
          // Try network_opportunities (property enrichment pipeline)
          const apnRows = await apnSql`
            SELECT parcel_id FROM network_opportunities
            WHERE project_id = ${projectId}
            LIMIT 1
          `;
          if (apnRows.length > 0 && apnRows[0].parcel_id) {
            enrichedBody.project.apn = apnRows[0].parcel_id;
            console.log('[permit/APN] Backfilled from network_opportunities.parcel_id:', enrichedBody.project.apn);
          }
        } catch (apnErr: unknown) {
          // Non-critical — APN will show placeholder
          console.warn('[permit/APN] Lookup error (non-critical):', (apnErr as Error)?.message);
        }
      }
      // Final fallback: if we still have no APN, leave as placeholder logic
      // in the template files to show "—" or "___________________"
      if (!enrichedBody.project.apn) {
        console.log('[permit/APN] No APN found in any source — templates will show placeholder');
      }
    }

    // ── Error 3f fix: Designer server-side fallback ──────────────────────
    // project.designer is a required PermitInput field but defaults to empty
    // string on the frontend (page.tsx line 472: designer: ''). The smart
    // defaults (line 5361) only patch it client-side, so if the user hasn't
    // filled the field AND hasn't clicked auto-fill, designer arrives as ''.
    // All permit templates fall back to '—' or '________________________________'
    // which looks broken on a professional permit document. Fix: if designer
    // is empty after all enrichment, default to 'SolarPro Engineering'.
    // Error 5p fix: designer is on PermitInput.project type — no `as any` needed
    {
      // NEVER default the Designer/Engineer-of-Record to the software vendor —
      // "SolarPro Engineering" printed as the EOR on CERT was a teardown P1
      // (the platform is not a licensed design firm). Leave blank; CERT renders
      // a fill-in line, which is what a wet-stamping PE expects.
      if (!enrichedBody.project.designer || enrichedBody.project.designer.trim() === '') {
        console.log('[permit/DESIGNER] Designer empty — leaving blank for EOR fill-in');
      }
    }

    // ── Re-center the aerial on the DESIGN geometry (Ray, 2026-06-30: "3D drives 2D") ──
    // The planset must frame whatever the user built in 3D. The design's real
    // roof/panel GPS only lands on enrichedBody AFTER canonical/survey enrichment
    // (above), so the initial aerial fetch used the address geocode. Now that we
    // have the geometry, re-fetch centered on the array centroid — passed as
    // arrayCenter so chooseAerialCenter's corruption guard still applies (a centroid
    // implausibly far from the geocode pin is rejected as cross-contaminated).
    {
      const _mean = (pts: Array<{ lat?: number; lng?: number }>) => {
        const v = pts.filter(p => p && isFinite(Number(p.lat)) && isFinite(Number(p.lng)) && Math.abs(Number(p.lat)) > 0.001);
        if (!v.length) return null;
        return { lat: v.reduce((s, p) => s + Number(p.lat), 0) / v.length, lng: v.reduce((s, p) => s + Number(p.lng), 0) / v.length };
      };
      const _panels = (enrichedBody.project?.panelPositions ?? []) as Array<{ lat?: number; lng?: number }>;
      const _verts = ((enrichedBody.project?.roofPlanes ?? []) as Array<{ vertices?: Array<{ lat?: number; lng?: number }> }>)
        .flatMap(rp => rp.vertices ?? []);
      const _designCenter = _mean(_panels) ?? _mean(_verts);
      if (_designCenter) {
        const _cosLat = Math.cos((_centerLat || 0) * Math.PI / 180);
        const _offM = Math.hypot(
          (_designCenter.lat - _centerLat) * 111320,
          (_designCenter.lng - _centerLng) * 111320 * _cosLat,
        );
        // Re-fetch whenever the design centroid differs meaningfully (>3 m) from the
        // geocode-centered image — the DESIGN is authoritative for framing ("3D drives
        // 2D"), and a 7-8 m geocode-vs-design gap (neighbour parcel) was under the old
        // 12 m gate so it never re-centred. Skip only near-identical (<3 m) or obvious
        // corruption (>1 km); chooseAerialCenter re-checks the 300 m guard on the fetch.
        if (_offM > 3 && _offM < 1000) {
          console.log('[permit/aerial] re-centering on design geometry', _offM.toFixed(0), 'm from geocode');
          const _recentered = await fetchAerialRoofData(_centerLat, _centerLng, _addr, _designCenter)
            .catch((e: any) => { console.warn('[permit/aerial] re-center fetch failed (keeping geocode image):', e?.message); return null; });
          if (_recentered && _recentered.imageBase64) enrichedBody.aerialData = _recentered;
        }
      }
    }

    // ── Parcel boundary (county GIS registry) → PV-1 property line + APN ──────
    // Verified county endpoints only (Madison IL live); fail-safe null keeps
    // the sheet honest — no property line is better than a guessed one.
    try {
      const _plat = Number(enrichedBody.project?.lat), _plng = Number(enrichedBody.project?.lng);
      const parcel = await fetchParcelBoundary(_plat, _plng,
        (enrichedBody.project as any)?.county, (enrichedBody.project as any)?.state);
      if (parcel) {
        (enrichedBody.aerialData as any) = { ...(enrichedBody.aerialData ?? {}), parcel };
        if (!enrichedBody.project.apn && parcel.apn) {
          (enrichedBody.project as any).apn = parcel.apn;
          console.log('[parcel] APN backfilled into title block:', parcel.apn);
        }
      }
    } catch (parcelErr: unknown) {
      console.log('[parcel] lookup skipped:', (parcelErr as Error)?.message);
    }

    // ── Site-context ground surfaces for the PV-2 site plan ───────────────────
    // Fetched HERE (after the aerial re-center replaced aerialData, and next to
    // the re-fetched parcel) so they actually survive to the render. Nearmap AI
    // (REAL driveways/walks/paving/footprints, DB-cached ≤1 parcel/property) is
    // preferred; OSM roads/buildings are the fallback when Nearmap is absent.
    {
      const _slat = Number(enrichedBody.project?.lat), _slng = Number(enrichedBody.project?.lng);
      const _ax = enrichedBody.aerialData as { siteFeatures?: unknown; nearmapSurfaces?: unknown } | undefined;
      if (_ax && isFinite(_slat) && isFinite(_slng) && Math.abs(_slat) > 0.001) {
        if (!_ax.nearmapSurfaces && process.env.NEARMAP_API_KEY) {
          try {
            const _nm = await getNearmapSurfacesCached(_slat, _slng, 55);
            if (_nm) {
              _ax.nearmapSurfaces = _nm;
              console.log('[permit/POST] nearmap surfaces:', _nm.driveways.length, 'driveways,', _nm.buildings.length, 'buildings,', _nm.paved.length, 'paved');
            } else {
              console.log('[permit/POST] nearmap surfaces: none (fetch returned null)');
            }
          } catch (e: unknown) { console.warn('[permit/POST] nearmap surfaces skipped:', (e as Error)?.message); }
        }
        if (!_ax.siteFeatures && !_ax.nearmapSurfaces) {
          try {
            const _sf = await fetchSiteFeatures(_slat, _slng, 160);
            if (_sf) {
              _ax.siteFeatures = _sf;
              console.log('[permit/POST] site features (OSM fallback):', _sf.roads.length, 'roads,', _sf.buildings.length, 'buildings');
            }
          } catch (e: unknown) { console.warn('[permit/POST] site features skipped:', (e as Error)?.message); }
        }
      }
    }

    // ── Survey-photo GPS hints → PV-1 equipment markers (tier 1) ──────────────
    // SurveyV2 photo capture samples device geolocation at snap time (mig 099).
    // A meter/main-panel photo GPS pins the equipment to the correct wall, so
    // the PV-1 marker reads 'PER SURVEY PHOTO GPS' instead of the street-side
    // guess (Ray, 2026-07-02: the heuristic is a coin flip on corner lots).
    if (projectId && isValidUUID(projectId)) {
      try {
        const sqlHints = await getDbReady();
        const hintRows = await sqlHints`
          SELECT ssf.label, ssf.gps_lat, ssf.gps_lng, ssf.gps_accuracy_m
          FROM site_survey_files ssf
          JOIN site_surveys ss ON ss.id = ssf.survey_id
          WHERE ss.project_id = ${projectId}
            AND ssf.gps_lat IS NOT NULL AND ssf.gps_lng IS NOT NULL
            AND ssf.label ~* '(meter|main_panel|msp|disconnect|service_entrance)'
          ORDER BY ssf.created_at DESC
          LIMIT 12
        `;
        if (hintRows.length > 0) {
          (enrichedBody.project as any).surveyPhotoHints = (hintRows as Array<Record<string, unknown>>).map(r => ({
            // equipmentLocator matches on label text: meter|utility / msp|main.?panel / disconnect
            label: String(r.label ?? ''),
            gps: { lat: Number(r.gps_lat), lng: Number(r.gps_lng) },
          }));
          console.log('[permit/equipment]', hintRows.length, 'survey photo GPS hint(s):',
            (hintRows as Array<Record<string, unknown>>).map(r => `${r.label}@±${r.gps_accuracy_m ?? '?'}m`).join(', '));
        }
      } catch (hintErr: unknown) {
        // gps columns may predate migration 099 — heuristic tier still runs
        console.log('[permit/equipment] survey GPS hints unavailable:', (hintErr as Error)?.message);
      }
    }

    // ── Roof obstructions (Nearmap AI, from the same call as the frame snap) ──
    // Forward to project.roofObstructions: roofCAD projects them into the local
    // frame + filters colliding panels, and PV-2 draws them with keep-out rings.
    {
      const _obs = (enrichedBody.aerialData as any)?.obstructions;
      if (Array.isArray(_obs) && _obs.length > 0) {
        (enrichedBody.project as any).roofObstructions = _obs.map((o: any) => ({
          type: o.type, description: o.description, polygon: o.polygon, clearanceM: o.clearanceM,
        }));
        console.log('[permit/obstructions]', _obs.length, 'Nearmap AI obstruction(s) attached to project:', _obs.map((o: any) => o.type).join(', '));
      }
      // Canopy is meaningful only over OUR roof — the AI AOI covers neighbors,
      // and a neighbor's tree rendered a giant green blob on PV-1 (Ray, 07-03).
      {
        const _ro = (enrichedBody.project as any).roofObstructions as any[] | undefined;
        const _designPlanes = (enrichedBody.project?.roofPlanes ?? []) as Array<{ vertices?: Array<{lat:number;lng:number}> }>;
        if (_ro?.length && _designPlanes.length) {
          const _rings = _designPlanes.map(rp => (rp.vertices ?? [])).filter(r => r.length >= 3);
          const _pip = (lat: number, lng: number, ring: Array<{lat:number;lng:number}>) => {
            let ins = false;
            for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
              const yi = ring[i].lat, xi = ring[i].lng, yj = ring[j].lat, xj = ring[j].lng;
              if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) ins = !ins;
            }
            return ins;
          };
          const kept = _ro.filter((o: any) => o.type !== 'canopy' ||
            (Array.isArray(o.polygon) && _rings.some(r =>
              o.polygon.some((v: any) => _pip(v.lat, v.lng, r)) || r.some(v => _pip(v.lat, v.lng, o.polygon)))));
          if (kept.length !== _ro.length) {
            console.log('[permit/obstructions] dropped', _ro.length - kept.length, 'canopy blob(s) not over OUR roof (neighbor trees)');
            (enrichedBody.project as any).roofObstructions = kept;
          }
        }
      }
      // ── Aerial-vision obstruction sweep (Ray, 2026-07-03: the tree-hidden
      // vent Nearmap AI missed). Claude vision reads the SAME stitched HD
      // aerial for roof penetrations; detections land in roofObstructions
      // with 'aerial vision — field verify' provenance. Fail-safe to none.
      try {
        const _ad = enrichedBody.aerialData as any;
        const _planes = (enrichedBody.project?.roofPlanes ?? []) as Array<{ vertices?: Array<{lat:number;lng:number}> }>;
        if (!_ad?.imageBase64) console.log('[aerialVision] SKIPPED — no aerial image on this generate');
        else if (_ad.imageSource !== 'nearmap') console.log('[aerialVision] SKIPPED — aerial source is', _ad.imageSource, '(needs nearmap HD)');
        else if (_planes.length === 0) console.log('[aerialVision] SKIPPED — no roof planes on project');
        if (_ad?.imageBase64 && _ad.imageSource === 'nearmap' && _planes.length > 0) {
          const visionObs = await detectAerialVisionObstructions({
            imageBase64: _ad.imageBase64,
            imageWidth: _ad.imageWidth || 1440,
            imageHeight: _ad.imageHeight || 810,
            lat: _ad.lat, lng: _ad.lng, zoom: _ad.zoom || 21,
            roofPlanes: _planes,
            existing: ((enrichedBody.project as any).roofObstructions ?? []).filter((o: any) => Array.isArray(o.polygon)),
          });
          if (visionObs.length > 0) {
            const withClearance = visionObs.map(o => ({
              type: o.type, description: o.description, polygon: o.polygon,
              clearanceM: OBSTRUCTION_CLEARANCE_M[o.type] ?? OBSTRUCTION_CLEARANCE_M.other,
            }));
            (enrichedBody.project as any).roofObstructions = [
              ...(((enrichedBody.project as any).roofObstructions) ?? []),
              ...withClearance,
            ];
            console.log('[permit/obstructions] aerial vision added', visionObs.length, 'obstruction(s):',
              visionObs.map(o => o.description).join('; '));
          }
        }
      } catch (visErr: unknown) {
        console.log('[permit/obstructions] aerial vision sweep skipped:', (visErr as Error)?.message);
      }
    }

    // Google-fallback aerials: compute the design→imagery edge-snap shift
    // before the (sync) render. The shift lands in aerialData.registrationShift
    // and is persisted with the permit_input.json snapshot below (the GET
    // self-heal recomputes it anyway).
    // Square the array to true lines (de-skew per-plane azimuth + grid noise)
    // before rendering AND before the snapshot is saved, so every sheet draws
    // the arrays on true horizontal/vertical lines — see deskewArrayToTrue.ts.
    deskewArrayToTrue(enrichedBody);

    await applyAerialEdgeSnapRegistration(enrichedBody);

    // W4 §8/§9/§12 — resolve the async document-registry + digest-invalidation
    // authority (lib/documents + lib/reconciliation) BEFORE the sync render and
    // thread it into the snapshot build. Fail-soft: never throws (a
    // DB-unavailable read resolves to the not-satisfied default), so the RT-MINI
    // blockers stay firing and ISSUED FOR PERMIT remains impossible until a
    // verified document is archived (migrations 113/114 pending).
    // AAC WS-9 — carry the PRIOR snapshot digest onto the input so the
    // engineering-review resolver can look for a licensed approval bound to the
    // set that was last produced for this project. This is a READ of the stored
    // artifact only, it is fail-soft, and it can never satisfy the gate on its
    // own: the build re-checks `reviewedDigest === meta.digest` against the
    // digest it is about to freeze, so an approval of a superseded set is
    // refused exactly as it must be.
    await attachPriorSnapshotDigestFromStore(enrichedBody, projectId);
    // ── AAC WS-10 — the PERMIT ARTIFACT defaults to the compact permit profile.
    // The full internal package (RS-1 review status, the SCHED procurement
    // continuations, APP-A, the certification placeholders, DS-n inline) is
    // still generatable on demand: post `plansetProfile: 'full'`. The snapshot,
    // the release registry, every requirement and the BOM are identical under
    // both profiles — only the page composition differs.
    applyPlansetProfile(enrichedBody, req);
    const snapshotAuthority = await resolveSnapshotAuthorityInputs(enrichedBody);
    const html = generatePermitHTML(enrichedBody, storedSldSvg, snapshotAuthority);
    console.log('[PLANSET GENERATED]', { systemType: enrichedBody.project?.systemType, panels: enrichedBody.system?.totalPanels, version: PLANSET_ENGINE_VERSION });

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

        // Also snapshot the fully-enriched INPUT. The GET preview/PDF endpoint
        // regenerates from this with the CURRENT engine whenever the saved HTML
        // is stale — every engine version bump used to 409 preview AND pdf
        // until the user manually regenerated ("Permit preview failed").
        const inputBuf = Buffer.from(JSON.stringify(enrichedBody), 'utf8');
        await sqlSave`
          INSERT INTO project_files
            (project_id, client_id, user_id, file_name, file_type, file_size, mime_type, file_data, notes)
          VALUES
            (${projectId}, ${null}, ${user.id},
             'permit_input.json', 'permit_input', ${inputBuf.length},
             'application/json', ${inputBuf}, 'Auto-saved by permit generator (regeneration snapshot)')
          ON CONFLICT (project_id, user_id, file_name)
          DO UPDATE SET
            file_type   = EXCLUDED.file_type,
            file_size   = EXCLUDED.file_size,
            mime_type   = EXCLUDED.mime_type,
            file_data   = EXCLUDED.file_data,
            notes       = EXCLUDED.notes,
            upload_date = NOW()
        `;
        console.log('[permit/save] Saved permit_input.json snapshot', { projectId, size: inputBuf.length });
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
