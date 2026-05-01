export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { bulkSoftDeleteProjects, handleRouteDbError } from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

// POST /api/projects/bulk-delete
// Body: { ids: string[] }
// Soft-deletes all projects owned by the authenticated user whose IDs are in the list.
// Returns { success: true, deleted: string[], skipped: string[] }
export async function POST(req: NextRequest) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  // Rate limit
  const rl = await checkRateLimit('standard', getClientIp(req));
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 });
  }

  try {
    const body = await req.json();
    const ids: unknown = body?.ids;

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ success: false, error: 'ids must be a non-empty array' }, { status: 400 });
    }

    // Sanitise: only strings, max 200 at a time
    const stringIds = (ids as unknown[]).filter((id): id is string => typeof id === 'string').slice(0, 200);

    const deleted = await bulkSoftDeleteProjects(stringIds, user.id);
    const deletedSet = new Set(deleted);
    const skipped = stringIds.filter(id => !deletedSet.has(id));

    return NextResponse.json({ success: true, deleted, skipped });
  } catch (e: unknown) {
    return handleRouteDbError('[POST /api/projects/bulk-delete]', e);
  }
}