/**
 * GET /api/solardog/aliases
 *
 * Fetch all learned navigation aliases for the current user.
 * Called by SolarDog on startup to prime the resolver with user's custom mappings.
 *
 * Response: { aliases: SiteAlias[] }
 *
 * DELETE /api/solardog/aliases?phrase=<phrase>
 * Remove a specific learned alias.
 */

export const maxDuration = 30;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { solardogGetAliases, solardogDeleteAlias } from '@/lib/db-neon';
import { rateLimitGuard } from '@/lib/rateLimitGuard';

export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const aliases = await solardogGetAliases(user.id);
  return NextResponse.json({ aliases });
}

export async function DELETE(req: NextRequest) {
  const rlGuard = await rateLimitGuard(req, 'solar-api');
  if (rlGuard.blocked) return rlGuard.response;

  const user = getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url    = new URL(req.url);
  const phrase = url.searchParams.get('phrase');
  if (!phrase) {
    return NextResponse.json({ error: 'phrase query param required' }, { status: 400 });
  }

  await solardogDeleteAlias(user.id, phrase);
  return NextResponse.json({ ok: true, deleted: phrase });
}