// ═══════════════════════════════════════════════════════════════════════════
// GET /api/projects/[id]/aerial-reference
//
// THE PROJECT'S ALREADY-ACQUIRED AERIAL, AS A GEOREFERENCED REFERENCE LAYER.
//
// 🚨 WHY THIS ROUTE EXISTS AND WHAT IT DELIBERATELY DOES NOT DO.
//
// Ray asked for Nearmap imagery as a switchable reference layer inside the 3D Design Studio, with
// three constraints:
//
//   1. "Do not build a second Nearmap acquisition path. Nearmap is expensive. Repeated display
//      toggles must not blindly reacquire the same imagery."
//   2. "Do not leave Nearmap effectively admin-only if ordinary authorized project
//      designers/operators are supposed to use it. The rule should be based on the user's
//      legitimate access to the organization/project + Nearmap capability/entitlement, not simply
//      `is admin`." (R18)
//   3. "Do not invent a Nearmap capture date... If the actual Nearmap response/reference does not
//      provide a trustworthy capture date: omit the date or display 'Capture date unavailable'."
//      And: no hard-coded 7.5 cm/px claim unless the resolution is actually known. (R19)
//
// SO THIS ROUTE ACQUIRES NOTHING. It reads imagery the project has ALREADY PAID FOR: the permit
// route writes its whole input to `project_files` as `permit_input.json`, and that input's
// `aerialData` carries the stitched aerial as a data URI plus the centre lat/lng, the zoom and the
// pixel dimensions. `lib/fieldMeasurement/permitAccess.ts` already reads that same row for another
// purpose. Nothing read the IMAGE back out, so it was paid for and unused.
//
// Zero tile requests, zero credits, no upstream call of any kind — which is what makes the display
// toggle safe to press repeatedly.
//
// ENTITLEMENT (R18): the gate is the caller's legitimate access to THE PROJECT, the same
// `projects WHERE id = ... AND user_id = ... AND deleted_at IS NULL` check every other
// project-scoped route in this codebase uses. It is NOT `requireAdminApi`. The admin gate on
// `/api/admin/nearmap-tile` is a gate on SPENDING — fetching new tiles — and reusing an image the
// project already owns is not spending. A designer who can open the project can see the project's
// own aerial.
//
// PROVENANCE (R19): `imageSource` is reported as recorded, never inferred. The capture date is
// reported only if the stored record actually carries one, and `captureDateKnown: false` otherwise
// so the caller can say "Capture date unavailable" rather than print something. The resolution is
// COMPUTED from the zoom and the latitude, not taken from a brand claim.
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError } from '@/lib/db-neon';
import { nearmapImageBounds, groundResolutionCmPerPx } from '@/lib/aerial/nearmap';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await ctx.params;
    const user = await getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    if (!projectId) {
      return NextResponse.json({ success: false, error: 'projectId required' }, { status: 400 });
    }

    const sql = await getDbReady();

    // Entitlement: legitimate access to this project. Not an admin check.
    const owned = await sql`
      SELECT id FROM projects
      WHERE id = ${projectId} AND user_id = ${user.id} AND deleted_at IS NULL
    `;
    if ((owned as unknown[]).length === 0) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    const rows = await sql`
      SELECT file_data FROM project_files
      WHERE project_id = ${projectId} AND file_name = 'permit_input.json'
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const raw = (rows as Array<{ file_data: unknown }>)[0]?.file_data;
    if (!raw) {
      // Not an error — this project simply has no acquired aerial yet. The caller shows that
      // plainly rather than falling back to another provider while claiming this one.
      return NextResponse.json({
        success: true, available: false,
        reason: 'No aerial has been acquired for this project yet. One is stored when a permit '
          + 'package is generated.',
      });
    }

    const json = raw instanceof Buffer ? raw.toString('utf8') : String(raw);
    let input: { aerialData?: Record<string, unknown> } | null = null;
    try { input = JSON.parse(json); } catch {
      return NextResponse.json({
        success: true, available: false,
        reason: 'The stored permit input for this project could not be read.',
      });
    }

    const a = input?.aerialData;
    const imageDataUrl = typeof a?.imageBase64 === 'string' ? a.imageBase64 : null;
    const lat = Number(a?.lat), lng = Number(a?.lng), zoom = Number(a?.zoom);
    const widthPx = Number(a?.imageWidth), heightPx = Number(a?.imageHeight);

    if (!imageDataUrl) {
      return NextResponse.json({
        success: true, available: false,
        reason: 'The stored permit input for this project carries no aerial image.',
      });
    }

    // 🚨 NO IMAGE WITHOUT A RECTANGLE. An aerial with no usable georeferencing cannot be shown as
    // a reference layer: it would sit somewhere arbitrary under the geometry and an operator would
    // trace a house against a lie. Refusing is the honest answer.
    const bounds = nearmapImageBounds(lat, lng, zoom, widthPx, heightPx);
    if (!bounds) {
      return NextResponse.json({
        success: true, available: false,
        reason: 'The stored aerial cannot be georeferenced — its centre, zoom or pixel size is '
          + 'missing, so its position on the ground is unknown.',
      });
    }

    const source = a?.imageSource === 'nearmap' ? 'nearmap'
                 : a?.imageSource === 'google' ? 'google'
                 : 'unknown';

    // R19 — the capture date, only if it is really there. `AerialRoofData` carries no date field
    // today, and the two dates that DO exist in this codebase belong to the Nearmap AI product,
    // whose own comment records that it shares only a registration FRAME with the tiles and not a
    // capture date. Binding one to this image would be inventing it.
    const captureDateRaw = (a as { captureDate?: unknown; surveyDate?: unknown })?.captureDate
      ?? (a as { surveyDate?: unknown })?.surveyDate;
    const captureDate = typeof captureDateRaw === 'string' && captureDateRaw.trim()
      ? captureDateRaw.trim() : null;

    return NextResponse.json({
      success: true,
      available: true,
      source,
      imageDataUrl,
      bounds,
      zoom,
      widthPx,
      heightPx,
      // Computed, so it can be stated truthfully. Null when the latitude or zoom make it unknowable.
      resolutionCmPerPx: groundResolutionCmPerPx(lat, zoom),
      captureDate,
      captureDateKnown: captureDate !== null,
      // Said out loud, because the whole point of this route is that pressing the toggle is free.
      acquisition: 'reused',
    });
  } catch (err: unknown) {
    return handleRouteDbError('[GET /api/projects/[id]/aerial-reference]', err);
  }
}
