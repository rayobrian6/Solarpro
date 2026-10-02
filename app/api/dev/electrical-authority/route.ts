/**
 * GET /api/dev/electrical-authority?projectId=<uuid>
 *
 * 🚨 THE DEVELOPER AUTHORITY INSPECTOR. Ray: "This is a diagnostic tool, not another authority."
 *
 * For one project it prints every canonical electrical fact with its owner, its persisted source,
 * its current value, its provenance, who may write it, which production surfaces consume it, any
 * legacy mirror and WHY that mirror cannot win — plus the electrical revision and the exact inputs
 * it was taken over, so "which fact moved the revision?" is answerable without a debugger.
 *
 * DEVELOPER-ONLY, gated the way `app/api/dev-check/route.ts` is: VERCEL_ENV for Vercel (NODE_ENV is
 * always 'production' there, even on preview, so it cannot gate preview) with a NODE_ENV fallback
 * for non-Vercel hosting. It still requires authentication and still scopes the read to the calling
 * user's own project — a diagnostic is not an excuse to widen access to somebody else's design.
 *
 * It writes NOTHING. In particular it does not run the one-time canonicalization: looking at a
 * project must not change it, or the inspector would alter the thing it is inspecting.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { isValidUUID } from '@/lib/db-neon';
import { loadElectricalProject } from '@/lib/electrical/loadElectricalProject';
import { inspectElectricalAuthority, mirrorsThatCouldWin } from '@/lib/electrical/authorityInspector';
// 🚨 IMPORTED, NOT DEFINED HERE. A Next.js route module may export only its HTTP handlers and the
// known config keys — any other export fails the generated route-type check at build time. Defining
// the gate here so a test could import it would have broken `next build`.
import { devDiagnosticsAllowed } from '@/lib/devDiagnostics';

export async function GET(req: NextRequest) {
  if (!devDiagnosticsAllowed()) {
    return NextResponse.json({ error: 'Not available in production' }, { status: 404 });
  }

  const user = getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
  }

  const projectId = req.nextUrl.searchParams.get('projectId');
  if (!projectId || !isValidUUID(projectId)) {
    return NextResponse.json(
      { success: false, error: 'projectId (UUID) required' }, { status: 400 },
    );
  }

  try {
    const loaded = await loadElectricalProject(projectId, user.id);
    if (!loaded) {
      return NextResponse.json(
        { success: false, error: 'Project not found' }, { status: 404 },
      );
    }
    const report = inspectElectricalAuthority(loaded);
    return NextResponse.json({
      success: true,
      report,
      // 🚨 THE ANSWER THAT MUST BE "NO". Ray: "Can another persisted field disagree and win? The
      // acceptable answer to #5 is NO." Non-empty ⇒ a mirror exists with no stated mechanism.
      mirrorsThatCouldWin: mirrorsThatCouldWin(report),
    });
  } catch (e) {
    console.error('[dev/electrical-authority]', e);
    return NextResponse.json(
      { success: false, error: (e as Error)?.message ?? 'Inspection failed' }, { status: 500 },
    );
  }
}
