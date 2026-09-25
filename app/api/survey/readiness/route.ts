// ============================================================================
// Survey V2: POST /api/survey/readiness
//
// Runs the Engineering Requirement Registry against an IN-PROGRESS survey so
// the crew sees what engineering still needs while they are still on site.
//
// Until now that verdict existed only on the office page at
// /projects/[id]/survey/[surveyId], which the crew reads after driving home.
// Same engine, second renderer — this route adds no second requirements model.
//
// Request body: { token: string, photos: SurveyPhoto[] }
// Response:     { ok: true, readiness: FieldSurveyReadiness }
//
// Auth: the handoff JWT in the request body, exactly as /api/survey/upload-photo
// and /api/survey/submit do (no session cookie — this is a field device).
//
// Scoping: the survey id is taken from the VERIFIED token (claims.jti), never
// from the body. The route reads no database and no other survey's evidence, so
// a token can only ever produce a verdict about the photos it was handed.
//
// Pure ASCII, no Unicode.
// ============================================================================

export const maxDuration = 15;

import { NextRequest, NextResponse } from 'next/server';
import { verifyHandoffToken } from '../../../../lib/survey/handoff/tokenMinter';
import { buildFieldSurveyReadiness } from '../../../../lib/survey/v2/fieldReadiness';
import type { SurveyPhoto } from '../../../../lib/survey/v2/types';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

const MAX_PHOTOS = 200;

// ---------------------------------------------------------------------------
// Narrow an untrusted body entry to a SurveyPhoto. A malformed entry is
// DROPPED rather than coerced: an invented category would be an invented
// readiness verdict, and a crew acts on this number.
// ---------------------------------------------------------------------------
function toSurveyPhoto(value: unknown, index: number): SurveyPhoto | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const category = typeof record.category === 'string' ? record.category : '';
  const url = typeof record.url === 'string' ? record.url : '';
  if (!category || !url) return null;
  return {
    id: typeof record.id === 'string' && record.id ? record.id : `photo-${index}`,
    category: category as SurveyPhoto['category'],
    tag: typeof record.tag === 'string' ? record.tag : '',
    url,
    uploadKey: typeof record.uploadKey === 'string' ? record.uploadKey : '',
    capturedAt: typeof record.capturedAt === 'string' ? record.capturedAt : '',
    gps: null,
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const rl = await checkRateLimit('survey', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { token, photos } = body as { token?: unknown; photos?: unknown };
    if (typeof token !== 'string' || !token) {
      return NextResponse.json({ error: 'Missing token' }, { status: 400 });
    }

    const claims = verifyHandoffToken(token);
    if (!claims) {
      return NextResponse.json(
        { error: 'Invalid or expired survey token' },
        { status: 401 },
      );
    }

    if (!Array.isArray(photos)) {
      return NextResponse.json({ error: 'Missing photos array' }, { status: 400 });
    }
    if (photos.length > MAX_PHOTOS) {
      return NextResponse.json({ error: 'Too many photos' }, { status: 400 });
    }

    const parsed = photos
      .map((photo, index) => toSurveyPhoto(photo, index))
      .filter((photo): photo is SurveyPhoto => photo !== null);

    const readiness = buildFieldSurveyReadiness({
      // Scope comes from the verified token, never from the request body.
      surveyId: claims.jti,
      projectId: claims.project_id ?? null,
      inspectorName: claims.inspector_name ?? null,
      photos: parsed,
    });

    return NextResponse.json(
      { ok: true, readiness, photosEvaluated: parsed.length },
      { status: 200 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    console.error('[survey/readiness] error:', msg);
    return NextResponse.json({ error: 'Readiness check failed' }, { status: 500 });
  }
}
