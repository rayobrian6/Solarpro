/**
 * GET /api/dev/electrical-state?projectId=<uuid>
 *
 * 🚨 ONE ELECTRICAL STATE DUMP. Ray's RULE FIFTEEN:
 *
 *   "create one diagnostic endpoint/view that returns the current active truth, not six stores
 *    independently… Then separately show: legacy mirrors … and: mirrorsThatCouldWin: []
 *    If mirrorsThatCouldWin is not empty, the gauntlet is still open."
 *
 * The active truth comes from `loadElectricalProject` — the same assembly every production surface
 * uses, so this cannot report a state the drawing does not have. `mirrorsThatCouldWin` is computed
 * from the RAW COLUMNS against that truth: it is a question about the data, not a claim about the
 * codebase, which is the difference between this and the authority inspector beside it.
 *
 * Developer-only and authenticated, scoped to the caller's own project. It writes NOTHING, and in
 * particular it does not run the one-time canonicalization — looking at a project must not change it.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { isValidUUID } from '@/lib/db-neon';
import { electricalStateDump } from '@/lib/electrical/stateDump';
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
    return NextResponse.json({ success: false, error: 'projectId (UUID) required' }, { status: 400 });
  }
  try {
    const dump = await electricalStateDump(projectId, user.id);
    if (!dump) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }
    return NextResponse.json({
      success: true,
      // 🚨 THE HEADLINE, so the answer to "is the gauntlet still open?" is the first thing read.
      gauntletOpen: dump.mirrorsThatCouldWin.length > 0 || dump.conflicts.length > 0,
      dump,
    });
  } catch (err: unknown) {
    console.error('[dev/electrical-state] failed:', (err as Error)?.message);
    return NextResponse.json({ success: false, error: 'Could not read the electrical state' },
      { status: 500 });
  }
}
