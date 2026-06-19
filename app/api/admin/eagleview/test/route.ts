// GET /api/admin/eagleview/test
//
// Admin-only EagleView connectivity check. Proves the sandbox credentials work
// end-to-end: (1) obtain an OAuth client-credentials token, (2) make an
// authenticated read (GetAvailableProducts + GetAccountDetails). Returns a clean
// JSON report — NEVER the token or secret itself. Open it in the browser while
// logged in as an admin.

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import {
  getEagleViewToken,
  getAvailableProducts,
  getAccountDetails,
} from '@/lib/siteSurveys/aerialGeometry/eagleViewProvider';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function GET(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  const env = process.env.EAGLEVIEW_ENV === 'production' ? 'production' : 'sandbox';
  const configured = !!(process.env.EAGLEVIEW_CLIENT_ID && process.env.EAGLEVIEW_CLIENT_SECRET);

  const report: Record<string, unknown> = { env, configured };
  if (!configured) {
    report.hint = 'Set EAGLEVIEW_CLIENT_ID and EAGLEVIEW_CLIENT_SECRET in this environment, then redeploy.';
    return NextResponse.json({ success: false, ...report });
  }

  // Step 1: token
  try {
    await getEagleViewToken();
    report.tokenObtained = true;
  } catch (e) {
    report.tokenObtained = false;
    report.tokenError = msg(e);
    return NextResponse.json({ success: false, ...report });
  }

  // Step 2: authenticated reads (each independent so we see which works)
  try {
    report.products = await getAvailableProducts();
  } catch (e) {
    report.productsError = msg(e);
  }
  try {
    report.account = await getAccountDetails();
  } catch (e) {
    report.accountError = msg(e);
  }

  const ok = report.tokenObtained === true && !report.productsError;
  return NextResponse.json({ success: ok, ...report });
}
