// ============================================================================
// lib/siteSurveys/aerialGeometry/eagleViewOrders.ts
//
// Durable lifecycle for EagleView roof Measurement Orders (table: migration 095).
// Place an order → record it pending → finalise (parse + store facets) when the
// report completes. Finalisation is poll-based here; the future
// /api/eagleview/webhook can call completeOrderFromReport() directly instead.
//
// ADDITIVE: this only reads/writes the new eagleview_orders table + calls the
// EagleView provider. It does not touch the 3D engine, planset, or any existing
// table — the parsed facets are stored here for a later, separate wiring step.
// ============================================================================

import { getDbWithRetry } from '@/lib/db-ready';
import type { AerialGeometryRequest, RoofFacet } from './types';
import { placeRoofOrder, isRoofReportReady, parseRoofFromReport } from './eagleViewProvider';

export interface EagleViewOrderRow {
  id: string;
  report_id: number;
  order_id: number | null;
  status: 'pending' | 'complete' | 'failed';
  env: string | null;
  project_id: string | null;
  survey_id: string | null;
  address: string | null;
  state: string | null;
  facet_count: number | null;
  facets: RoofFacet[] | null;
}

function evEnv(): string {
  return process.env.EAGLEVIEW_ENV === 'production' ? 'production' : 'sandbox';
}

/** Place a roof order for an address and record it as pending. Returns reportId. */
export async function orderRoofForAddress(
  req: AerialGeometryRequest,
  link?: { projectId?: string; surveyId?: string },
): Promise<number> {
  const reportId = await placeRoofOrder(req);
  const sql = await getDbWithRetry();
  await sql`
    INSERT INTO eagleview_orders (report_id, status, env, project_id, survey_id, address, city, state, zip, lat, lng)
    VALUES (${reportId}, 'pending', ${evEnv()}, ${link?.projectId ?? null}, ${link?.surveyId ?? null},
            ${req.address ?? null}, ${req.city ?? null}, ${req.state ?? null}, ${req.zip ?? null}, ${req.lat}, ${req.lng})
    ON CONFLICT (report_id) DO NOTHING
  `;
  return reportId;
}

export async function getOrderByReportId(reportId: number | string): Promise<EagleViewOrderRow | null> {
  const sql = await getDbWithRetry();
  const rows = await sql`SELECT * FROM eagleview_orders WHERE report_id = ${reportId} LIMIT 1`;
  return (rows[0] as EagleViewOrderRow) ?? null;
}

/** Parse a finished report and store its facets. Idempotent; used by webhook + poller. */
export async function completeOrderFromReport(reportId: number | string): Promise<number> {
  const result = await parseRoofFromReport(reportId);
  const sql = await getDbWithRetry();
  await sql`
    UPDATE eagleview_orders
       SET status = 'complete', facets = ${JSON.stringify(result.facets)}::jsonb,
           facet_count = ${result.facets.length}, completed_at = NOW(), updated_at = NOW(), error = NULL
     WHERE report_id = ${reportId}
  `;
  return result.facets.length;
}

async function failOrder(reportId: number | string, message: string): Promise<void> {
  const sql = await getDbWithRetry();
  await sql`UPDATE eagleview_orders SET status = 'failed', error = ${message.slice(0, 500)}, updated_at = NOW() WHERE report_id = ${reportId}`;
}

/**
 * Poll-based finaliser: for each pending order whose geometry file is ready,
 * parse + store its facets. Bounded by `limit`. Safe to run on a schedule; the
 * webhook will eventually make this a fallback rather than the primary path.
 */
export async function finalizePendingOrders(limit = 10): Promise<{ checked: number; completed: number }> {
  const sql = await getDbWithRetry();
  const pending = await sql`SELECT report_id FROM eagleview_orders WHERE status = 'pending' ORDER BY created_at ASC LIMIT ${limit}`;
  let completed = 0;
  for (const row of pending) {
    const reportId = Number((row as { report_id: number }).report_id);
    try {
      if (await isRoofReportReady(reportId)) {
        await completeOrderFromReport(reportId);
        completed++;
      }
    } catch (e) {
      await failOrder(reportId, e instanceof Error ? e.message : String(e));
    }
  }
  return { checked: pending.length, completed };
}

/** Completed roof facets for a project (most recent complete order), if any. */
export async function getCompletedFacetsForProject(projectId: string): Promise<RoofFacet[] | null> {
  const sql = await getDbWithRetry();
  const rows = await sql`
    SELECT facets FROM eagleview_orders
     WHERE project_id = ${projectId} AND status = 'complete' AND facets IS NOT NULL
     ORDER BY completed_at DESC NULLS LAST LIMIT 1
  `;
  const facets = (rows[0] as { facets?: RoofFacet[] } | undefined)?.facets;
  return facets ?? null;
}
