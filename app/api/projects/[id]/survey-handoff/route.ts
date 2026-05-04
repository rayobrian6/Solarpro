// ============================================================================
// v47.437 - POST /api/projects/[id]/survey-handoff
//
// Mints a HS256 handoff JWT and returns the survey launch URL on THIS app:
//   https://solarpro.solutions/survey/<token>
//
// The project page calls this endpoint when the user clicks "Start Survey".
// The response URL is opened in a new tab (or passed to the mobile handoff).
//
// Auth: requires valid session (same JWT auth as all project routes).
// The project must belong to the authenticated user.
//
// Request: POST (no body required - project data is read from DB)
//
// Response 200:
//   { url: string, jti: string, exp: number }
//
// Response 400: project not found or not owned by user
// Response 500: env vars missing or token mint failed
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, isValidUUID} from '@/lib/db-neon';
import { mintHandoffToken } from '@/lib/survey/handoff/tokenMinter';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  // -- Auth ------------------------------------------------------------------
  const user = getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: projectId } = await context.params;
  if (!projectId || !isValidUUID(projectId)) {
    return NextResponse.json({ success: false, error: 'Invalid project ID format.' }, { status: 400 });
  }

  // -- Load project ----------------------------------------------------------
  let sql;
  try {
        const rl = await checkRateLimit('standard', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json({ success: false, error: 'Too many requests. Please slow down.' }, { status: 429 });
    }

    sql = await getDbReady();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[survey-handoff] DB connection failed: ${msg}`);
    return NextResponse.json({ error: 'Database unavailable' }, { status: 500 });
  }

  let project: Record<string, unknown> | null = null;
  try {
    const rows = await sql`
      SELECT id, name, address, lat, lng, status, user_id
        FROM projects
       WHERE id = ${projectId}
         AND user_id = ${user.id}
         AND deleted_at IS NULL
       LIMIT 1
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    project = rows[0] as Record<string, unknown>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[survey-handoff] project query failed: ${msg}`);
    return NextResponse.json({ error: 'Failed to load project' }, { status: 500 });
  }

  // -- Mint handoff token ----------------------------------------------------
  // The handoff URL must point to the PARTNER's mobile app, not SolarPro.
  // PARTNER_BASE_URL is the base URL of the partner survey backend.
  // The partner mounts its handoff router at /api/handoff/:token (GET).
  //
  // Previous implementation incorrectly used NEXT_PUBLIC_APP_URL (SolarPro's
  // own domain) with path /survey/<token> — this routed users back to SolarPro
  // instead of to the partner app, so the inspector never received the token.
  const partnerBaseUrl = process.env.PARTNER_BASE_URL?.trim();
  if (!partnerBaseUrl) {
    console.error('[survey-handoff] PARTNER_BASE_URL is not set');
    return NextResponse.json(
      { error: 'Survey partner URL is not configured' },
      { status: 500 },
    );
  }

  let url: string;
  let webUrl: string;
  try {
    const result = mintHandoffToken({
      project_id: project.id as string,
      project_name: (project.name as string) ?? undefined,
      site_address: (project.address as string) ?? undefined,
      latitude: project.lat != null ? Number(project.lat) : undefined,
      longitude: project.lng != null ? Number(project.lng) : undefined,
      // SSO identity — lets partner app auto-provision/match the SolarPro user
      solarpro_user_id: user.id,
      solarpro_email: user.email,
      solarpro_name: user.name,
      // Ownership routing (F-06) — partner stores this on the survey so the
      // webhook payload carries it back and ingest assigns to the right user.
      solarpro_project_id: project.id as string,
    });
    if (!result.ok) {
      const errResult = result as { ok: false; error: string };
      throw new Error(errResult.error);
    }
    // Build a deep link URL for the mobile app.
    // The mobile app registers the 'sitesurvey://' URI scheme and handles
    // sitesurvey://new-survey?token=<jwt> to open the NewSurveyScreen.
    url = `sitesurvey://new-survey?token=${encodeURIComponent(result.token)}`;
    // webUrl is the web-safe survey URL on this app (/survey/<token>).
    // Used by the QR code modal so the QR is scannable by any mobile browser.
    // NEXT_PUBLIC_APP_URL must be set in Vercel env (e.g. https://solarpro.solutions).
    const appBase = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');
    webUrl = appBase ? `${appBase}/survey/${result.token}` : `/survey/${result.token}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[survey-handoff] token mint failed: ${msg}`);
    return NextResponse.json(
      { error: 'Failed to generate handoff token' },
      { status: 500 },
    );
  }

  console.log(
    `[survey-handoff] minted token for projectId=${projectId} userId=${user.id}`,
  );
  // F-06: [HANDOFF OWNER] log — confirms ownership claims are embedded in the JWT
  // SECURITY FIX: Removed email from log line — PII must not appear in server logs
  console.log(
    `[HANDOFF OWNER] projectId=${projectId} solarpro_user_id=${user.id} solarpro_project_id=${projectId}`,
  );

  // url     = sitesurvey:// deep link (for window.open on desktop / native app)
  // webUrl  = https://solarpro.solutions/survey/<token> (for QR code — browser scannable)
  return NextResponse.json({ url, webUrl }, { status: 200 });
}