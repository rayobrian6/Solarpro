// ============================================================================
// v47.437 - Survey V2: POST /api/survey/submit
//
// Accepts the completed survey payload, verifies the JWT, validates required
// fields, then forwards to the webhook ingest pipeline via the existing
// POST /api/webhooks/survey-complete endpoint (internal call).
//
// Request body: { token: string, payload: SurveyV2Payload }
//
// Auth: JWT in request body (no session cookie - mobile field device).
//
// Returns:
//   200 { ok: true, surveyId }  - submitted + ingested
//   400 { error }               - validation failure
//   401 { error }               - invalid/expired token
//   500 { error }               - internal error
//
// Pure ASCII, no Unicode.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { verifyHandoffToken } from '../../../../lib/survey/handoff/tokenMinter';
import { REQUIRED_PHOTO_CATEGORIES } from '../../../../lib/survey/v2/types';
import type { SurveyV2Payload } from '../../../../lib/survey/v2/types';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // ── Rate limiting ────────────────────────────────────────────────────────
    const rl = await checkRateLimit('survey', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }
    const body = await req.json().catch(() => null);

    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { token, payload } = body as { token?: string; payload?: SurveyV2Payload };

    // Validate token
    if (typeof token !== 'string' || !token) {
      return NextResponse.json({ error: 'Missing token' }, { status: 400 });
    }

    // Verify JWT
    const claims = verifyHandoffToken(token);
    if (!claims) {
      return NextResponse.json(
        { error: 'Invalid or expired survey token' },
        { status: 401 },
      );
    }

    // Validate payload shape
    if (!payload || typeof payload !== 'object') {
      return NextResponse.json({ error: 'Missing payload' }, { status: 400 });
    }

    const validationError = validatePayload(payload);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    // Verify payload project_id matches token claim
    if (payload.projectId !== claims.project_id) {
      return NextResponse.json(
        { error: 'Token project_id does not match payload projectId' },
        { status: 400 },
      );
    }

    // ---------------------------------------------------------------------------
    // Forward to internal webhook ingest pipeline
    // ---------------------------------------------------------------------------
    const webhookSecret = process.env.SURVEY_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error('[survey/submit] SURVEY_WEBHOOK_SECRET not set');
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 },
      );
    }

    // Build HMAC-SHA256 signature for the internal webhook call
    const webhookBody = JSON.stringify({
      schemaVersion: payload.schemaVersion,
      surveyId: payload.surveyId,
      projectId: payload.projectId,
      submittedAt: payload.submittedAt,
      inspectorName: payload.inspectorName,
      siteOverview: payload.siteOverview,
      roofConditions: payload.roofConditions,
      electricalService: payload.electricalService,
      obstructions: payload.obstructions,
      photos: payload.photos,
    });

    const { createHmac } = await import('crypto');
    const signature = createHmac('sha256', webhookSecret)
      .update(webhookBody)
      .digest('hex');

    // Construct internal webhook URL - always this app, never the partner app
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    const webhookUrl = `${baseUrl.replace(/\/$/, '')}/api/webhooks/survey-complete`;

    const webhookRes = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-survey-signature': `sha256=${signature}`,
      },
      body: webhookBody,
    });

    if (!webhookRes.ok) {
      const webhookBody2 = await webhookRes.json().catch(() => ({}));
      const msg = (webhookBody2 as { error?: string }).error ?? `Ingest failed (${webhookRes.status})`;
      console.error('[survey/submit] ingest pipeline error:', msg);
      return NextResponse.json(
        { error: 'Survey was received but ingest pipeline failed. Contact support.' },
        { status: 500 },
      );
    }

    const ingestResult = await webhookRes.json().catch(() => ({}));

    return NextResponse.json(
      {
        ok: true,
        surveyId: payload.surveyId,
        ingest: ingestResult,
      },
      { status: 200 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    console.error('[survey/submit] error:', msg);
    return NextResponse.json({ error: 'Submission failed' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// validatePayload - checks required fields before forwarding to ingest
// ---------------------------------------------------------------------------
function validatePayload(payload: SurveyV2Payload): string | null {
  if (!payload.schemaVersion || payload.schemaVersion !== '2.0') {
    return 'Invalid schemaVersion - expected 2.0';
  }

  if (!payload.surveyId) return 'Missing surveyId';
  if (!payload.projectId) return 'Missing projectId';
  if (!payload.submittedAt) return 'Missing submittedAt';
  if (!payload.inspectorName?.trim()) return 'Missing inspectorName';

  // Step 1 - site overview
  const s = payload.siteOverview;
  if (!s) return 'Missing siteOverview';
  if (!s.projectName?.trim()) return 'Missing siteOverview.projectName';
  if (!s.siteAddress?.trim()) return 'Missing siteOverview.siteAddress';
  if (!s.structureType) return 'Missing siteOverview.structureType';
  if (!s.stories) return 'Missing siteOverview.stories';

  // Step 2 - roof
  const r = payload.roofConditions;
  if (!r) return 'Missing roofConditions';
  if (!r.roofMaterial) return 'Missing roofConditions.roofMaterial';
  if (!r.roofPitch) return 'Missing roofConditions.roofPitch';
  if (!r.rafterSpacing) return 'Missing roofConditions.rafterSpacing';
  if (!r.roofCondition) return 'Missing roofConditions.roofCondition';

  // Step 3 - electrical
  const e = payload.electricalService;
  if (!e) return 'Missing electricalService';
  if (!e.panelBrand) return 'Missing electricalService.panelBrand';
  if (!e.panelRating) return 'Missing electricalService.panelRating';
  if (!e.availableBreakerSlots) return 'Missing electricalService.availableBreakerSlots';
  if (!e.meterSocketType) return 'Missing electricalService.meterSocketType';
  if (!e.interconnectionPoint) return 'Missing electricalService.interconnectionPoint';
  if (!e.serviceEntrance) return 'Missing electricalService.serviceEntrance';

  // Step 5 - required photos
  if (!Array.isArray(payload.photos)) return 'Missing photos array';

  const capturedCategories = payload.photos.map((p) => p.category);
  const missingPhotos = REQUIRED_PHOTO_CATEGORIES.filter(
    (cat) => !capturedCategories.includes(cat),
  );
  if (missingPhotos.length > 0) {
    return `Missing required photos: ${missingPhotos.join(', ')}`;
  }

  return null;
}