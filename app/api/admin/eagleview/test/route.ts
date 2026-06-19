// GET /api/admin/eagleview/test
//
// Admin-only EagleView connectivity check. Proves the sandbox credentials work
// end-to-end: (1) obtain an OAuth client-credentials token, (2) make an
// authenticated read (GetAvailableProducts + GetAccountDetails). Returns a clean
// JSON report — NEVER the token or secret itself. Open it in the browser while
// logged in as an admin.

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { getEagleViewToken } from '@/lib/siteSurveys/aerialGeometry/eagleViewProvider';

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

  // Step 2: probe candidate base+path combos to find the real routing.
  // The token is valid (step 1), so 404 = wrong URL, 401/403 = right URL wrong
  // auth-shape, 200/400 = right URL. We report status + a short body snippet.
  let token = '';
  try { token = await getEagleViewToken(); } catch { /* already reported */ }

  const candidates = [
    'https://sandbox.apicenter.eagleview.com/GetAvailableProducts',
    'https://sandbox.apicenter.eagleview.com/measurementorders/GetAvailableProducts',
    'https://sandbox.apicenter.eagleview.com/v3/Order/GetAccountDetails',
    'https://sandbox.apicenter.eagleview.com/measurementorders/v3/Order/GetAccountDetails',
    'https://sandbox.apicenter.eagleview.com/v3/Report/GetReport?reportId=1',
    'https://sandbox.apis.eagleview.com/GetAvailableProducts',
    'https://sandbox.apis.eagleview.com/measurementorders/GetAvailableProducts',
    'https://sandbox.apis.eagleview.com/measurementorders/v3/Order/GetAccountDetails',
  ];

  const probe: Array<{ url: string; status: number | string; body: string }> = [];
  for (const url of candidates) {
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
      const body = (await r.text().catch(() => '')).slice(0, 120);
      probe.push({ url, status: r.status, body });
    } catch (e) {
      probe.push({ url, status: 'ERR', body: msg(e).slice(0, 120) });
    }
  }
  report.probe = probe;

  const hit = probe.find((p) => typeof p.status === 'number' && p.status < 400);
  report.workingUrl = hit?.url ?? null;
  return NextResponse.json({ success: !!hit, ...report });
}
