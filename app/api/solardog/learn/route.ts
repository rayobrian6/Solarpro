/**
 * POST /api/solardog/learn
 *
 * Save a learned navigation alias for the current user.
 * Called by SolarDog when it detects a "learn" intent:
 *   User: "command center is dashboard"
 *   SolarDog: saves { phrase: "command center", route: "/dashboard", label: "Dashboard" }
 *
 * Body: { phrase: string, route: string, label?: string }
 * Response: { ok: true, phrase, route, label }
 */

export const maxDuration = 30;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { solardogSaveAlias } from '@/lib/db-neon';
import { SITE_MAP, normalizePhrase } from '@/lib/solardog/siteMap';
import { resolveRoute } from '@/lib/solardog/resolveRoute';
import { rateLimitGuard } from '@/lib/rateLimitGuard';

export async function POST(req: NextRequest) {
  const rlGuard = await rateLimitGuard(req, 'solar-api');
  if (rlGuard.blocked) return rlGuard.response;

  const user = getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { phrase?: string; route?: string; label?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const phrase = (body.phrase ?? '').trim().toLowerCase();
  let   route  = (body.route  ?? '').trim();
  let   label  = (body.label  ?? '').trim();

  if (!phrase || phrase.length < 2) {
    return NextResponse.json({ error: 'phrase is required (min 2 chars)' }, { status: 400 });
  }

  // If route is not a path (e.g. user said "command center is dashboard"),
  // resolve the target string against our site map
  if (!route.startsWith('/')) {
    const resolved = resolveRoute(route);
    if (resolved.route && resolved.confidence !== 'none') {
      route = resolved.route.route;
      label = label || resolved.route.label;
    } else {
      return NextResponse.json({
        error: `Could not resolve "${route}" to a known route. Try using the exact page name.`,
        known: SITE_MAP.map(r => r.label),
      }, { status: 422 });
    }
  } else {
    // Validate that the route actually exists in our site map
    const known = SITE_MAP.find(r => r.route === route);
    if (!known) {
      return NextResponse.json({
        error: `Route "${route}" is not in the site map.`,
        known: SITE_MAP.map(r => r.route),
      }, { status: 422 });
    }
    label = label || known.label;
  }

  await solardogSaveAlias(user.id, phrase, route, label);

  console.info('[SolarDog] learned alias saved', {
    userId: user.id.substring(0, 8) + '...',
    phrase,
    route,
    label,
  });

  return NextResponse.json({ ok: true, phrase, route, label });
}