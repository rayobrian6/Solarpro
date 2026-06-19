// GET /api/admin/eagleview/test
//
// Admin-only EagleView sandbox probe. Confirms auth + pulls the sample report
// (69110976) summary + the EV Measurement JSON geometry file, returning a
// COMPACT SHAPE of the geometry (keys + array shapes, not the full data) so we
// can see the facet schema and write the parser. Never returns the token/secret.

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import {
  getEagleViewToken,
  getAvailableProducts,
  getReport,
  getReportFileText,
  EV_FILE_TYPE,
} from '@/lib/siteSurveys/aerialGeometry/eagleViewProvider';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

const SAMPLE_REPORT_ID = 69110976; // Tiburon, CA — completed sandbox report (from Postman collection)

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Compact structural summary: keys + nested keys + array shapes, no bulk data. */
function shape(v: unknown, depth = 0): unknown {
  if (depth > 6) return '…';
  if (Array.isArray(v)) return v.length === 0 ? [] : [`len=${v.length}`, shape(v[0], depth + 1)];
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>)) o[k] = shape((v as Record<string, unknown>)[k], depth + 1);
    return o;
  }
  if (typeof v === 'string') return v.length > 24 ? `str(${v.length})` : v;
  return typeof v;
}

export async function GET(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  const env = process.env.EAGLEVIEW_ENV === 'production' ? 'production' : 'sandbox';
  const configured = !!(process.env.EAGLEVIEW_CLIENT_ID && process.env.EAGLEVIEW_CLIENT_SECRET);
  const report: Record<string, unknown> = { env, configured };
  if (!configured) return NextResponse.json({ success: false, ...report });

  try {
    await getEagleViewToken();
    report.tokenObtained = true;
  } catch (e) {
    return NextResponse.json({ success: false, ...report, tokenError: msg(e) });
  }

  // Products (corrected path)
  try {
    const p = await getAvailableProducts();
    report.products = shape(p);
  } catch (e) {
    report.productsError = msg(e);
  }

  // Sample report summary
  try {
    report.report = await getReport(SAMPLE_REPORT_ID);
  } catch (e) {
    report.reportError = msg(e);
  }

  // The geometry JSON file — return its SHAPE + a small raw snippet
  try {
    const f = await getReportFileText(SAMPLE_REPORT_ID, EV_FILE_TYPE.MEASUREMENT_JSON);
    report.geometryFile = { status: f.status, contentType: f.contentType, length: f.body.length };
    try {
      const parsed = JSON.parse(f.body);
      report.geometryShape = shape(parsed);
      report.geometryRawSnippet = f.body.slice(0, 1500);
    } catch {
      report.geometryRawSnippet = f.body.slice(0, 1500); // not JSON (maybe a redirect/link)
    }
  } catch (e) {
    report.geometryError = msg(e);
  }

  return NextResponse.json({ success: report.tokenObtained === true, ...report });
}
