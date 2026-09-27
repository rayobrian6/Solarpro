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
import { nearmapImageBounds, groundResolutionCmPerPx, fetchNearmapStaticAerial } from '@/lib/aerial/nearmap';
import {
  workzoneGate, isStoredWorkzone, WORKZONE_FILE_NAME,
  WORKZONE_WIDTH_PX, WORKZONE_HEIGHT_PX, type StoredWorkzone,
} from '@/lib/aerial/projectWorkzone';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Read a `bytea` column back as text.
 *
 * 🚨 A `Buffer` CHECK ALONE IS NOT ENOUGH. `file_data` is bytea, and what a driver hands back for
 * it is not fixed: node-postgres gives a `Buffer`, and PGlite gives a plain `Uint8Array` — which
 * is NOT an instance of Buffer. The previous shape (`raw instanceof Buffer ? … : String(raw)`)
 * turned a Uint8Array into "123,34,105,…" and the record silently failed to parse, so a workzone
 * that had just been written came back as "no imagery". Caught against a real Postgres.
 */
function bytesToText(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === 'string') return raw;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(raw)) return raw.toString('utf8');
  if (raw instanceof Uint8Array) return new TextDecoder().decode(raw);
  // Some drivers parse a json/jsonb column into an object before it ever reaches here.
  if (typeof raw === 'object') { try { return JSON.stringify(raw); } catch { return null; } }
  return null;
}

/** `file_data` is a JSON/bytea column; read it back without trusting its shape. */
function parseStored(raw: unknown): StoredWorkzone | null {
  try {
    const json = bytesToText(raw);
    if (!json) return null;
    const v = JSON.parse(json);
    return isStoredWorkzone(v) ? v : null;
  } catch { return null; }
}

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

    // 🚨 THE PROJECT'S OWN ACQUIRED WORKZONE COMES FIRST.
    //
    // Before this existed, the only Nearmap imagery a project could have was whatever the PERMIT
    // generator happened to buy — which is why Nearmap could not be reached without first driving
    // another part of the product. A workzone acquired by POST below is stored here and is the
    // project's imagery from then on; `permit_input.json` remains a valid source because that
    // image is equally paid for and equally the project's.
    const wz = await sql`
      SELECT file_data FROM project_files
      WHERE project_id = ${projectId} AND file_name = ${WORKZONE_FILE_NAME}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const wzRaw = (wz as Array<{ file_data: unknown }>)[0]?.file_data;
    if (wzRaw) {
      const stored = parseStored(wzRaw);
      if (stored) {
        const bounds = nearmapImageBounds(
          stored.lat, stored.lng, stored.zoom, stored.imageWidth, stored.imageHeight);
        if (bounds) {
          return NextResponse.json({
            success: true, available: true,
            source: 'nearmap',
            imageDataUrl: stored.imageBase64,
            bounds,
            zoom: stored.zoom,
            widthPx: stored.imageWidth,
            heightPx: stored.imageHeight,
            resolutionCmPerPx: groundResolutionCmPerPx(stored.lat, stored.zoom),
            // R19: the tile API supplies no capture date, so none is reported. `acquiredAt` is
            // when SolarPro fetched it and is deliberately NOT presented as a capture date.
            captureDate: null,
            captureDateKnown: false,
            acquisition: 'reused',
            acquiredAt: stored.acquiredAt ?? null,
          });
        }
      }
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

    // Same decoder as the workzone above, for the same reason: `String(uint8Array)` produces
    // "123,34,105,…" and the stored aerial reads as absent.
    const json = bytesToText(raw) ?? '';
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

// ═══════════════════════════════════════════════════════════════════════════
// POST — ACQUIRE THIS PROJECT'S NEARMAP WORKZONE. ONCE.
//
// 🚨 THE LIVE DEFECT THIS CLOSES. "I still have to enter the old 2D environment first and select
// Nearmap before I can effectively get Nearmap into the 3D workflow... Find why the old 2D
// workflow is currently the only thing that initializes/fetches/populates the aerial state. Move
// that acquisition/state authority to the project/imagery layer, not to the 2D UI."
//
// It was true: the only two things that had ever bought Nearmap imagery were the 2D canvas's tile
// fetcher (a component lifecycle) and the permit generator (a different workflow entirely).
// Neither belongs to the project, so the studio had nothing of its own to show.
//
// THE GATE IS `workzoneGate`, and it is the SAME pure function the picker uses to decide whether
// to disable itself — so the reason the button gives and the reason the server gives cannot drift:
//   · a project that exists and belongs to the caller
//   · with a RESOLVED lat/lng — the address gate. "Do not make an imagery request before the
//     location gate passes."
//   · that can be stored to, or a toggle would re-buy on every switch.
//
// THE BOUND is one 1440x810 frame centred on the project — about 84 m x 47 m at z21, the same
// extent the permit site plan has always acquired. Panning does not extend it.
//
// ACQUIRE ONCE: if a workzone is already stored, this returns it and calls nothing. The
// underlying `fetchNearmapStaticAerial` additionally refuses outright for 15 minutes after a
// 401/403/429 at this location, so a refusal cannot be re-stormed.
// ═══════════════════════════════════════════════════════════════════════════
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await ctx.params;
    const user = await getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const sql = await getDbReady();
    const owned = await sql`
      SELECT id, lat, lng FROM projects
      WHERE id = ${projectId} AND user_id = ${user.id} AND deleted_at IS NULL
    `;
    const project = (owned as Array<{ id: string; lat: number | null; lng: number | null }>)[0] ?? null;

    // A project row IS the storable thing, so `storable` is exactly "the row exists".
    const gate = workzoneGate(project, !!project);
    if (!gate.ok) {
      // 200, not an error: "no address yet" is a state the UI renders, not a failure.
      return NextResponse.json({
        success: true, available: false, acquired: false,
        code: gate.code, reason: gate.reason,
      });
    }

    // Already bought? Then nothing is bought again.
    const existing = await sql`
      SELECT file_data FROM project_files
      WHERE project_id = ${projectId} AND file_name = ${WORKZONE_FILE_NAME}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    if (parseStored((existing as Array<{ file_data: unknown }>)[0]?.file_data)) {
      return NextResponse.json({
        success: true, available: true, acquired: false, acquisition: 'reused',
        reason: 'This project already has its Nearmap workzone.',
      });
    }

    const loc = gate.location!;
    const aerial = await fetchNearmapStaticAerial(loc.lat, loc.lng, {
      widthPx: WORKZONE_WIDTH_PX, heightPx: WORKZONE_HEIGHT_PX,
    });
    if (!aerial || !aerial.imageBase64) {
      // 🚨 NO SUBSTITUTION. The fetcher returns null for a missing key, a refusal, or a genuine
      // coverage gap. Saying so is the whole of R18's "never masquerade one provider as another" —
      // the caller keeps showing the native imagery and is told why.
      return NextResponse.json({
        success: true, available: false, acquired: false,
        code: 'unavailable',
        reason: 'Nearmap returned no imagery for this location. Nothing has been substituted for '
          + 'it — the native imagery is still what is on screen.',
      });
    }

    const record: StoredWorkzone = {
      imageSource: 'nearmap',
      imageBase64: aerial.imageBase64,
      imageWidth: aerial.imageWidth,
      imageHeight: aerial.imageHeight,
      zoom: aerial.zoom,
      lat: loc.lat,
      lng: loc.lng,
      // When SolarPro fetched it. NOT a capture date — the tile API supplies none (R19).
      acquiredAt: new Date().toISOString(),
    };
    const buf = Buffer.from(JSON.stringify(record), 'utf8');
    await sql`
      INSERT INTO project_files
        (project_id, client_id, user_id, file_name, file_type, file_size, mime_type, file_data, notes)
      VALUES
        (${projectId}, ${null}, ${user.id},
         ${WORKZONE_FILE_NAME}, 'aerial_workzone', ${buf.length},
         'application/json', ${buf}, 'Nearmap project workzone — acquired once, reused')
      ON CONFLICT (project_id, user_id, file_name)
      DO UPDATE SET
        file_size   = EXCLUDED.file_size,
        file_data   = EXCLUDED.file_data,
        upload_date = NOW()
    `;

    return NextResponse.json({
      success: true, available: true, acquired: true, acquisition: 'acquired',
      zoom: aerial.zoom,
      resolutionCmPerPx: groundResolutionCmPerPx(loc.lat, aerial.zoom),
    });
  } catch (err: unknown) {
    return handleRouteDbError('[POST /api/projects/[id]/aerial-reference]', err);
  }
}
