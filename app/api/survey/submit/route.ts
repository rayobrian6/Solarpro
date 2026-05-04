// ============================================================================
// v47.438 - Survey V2: POST /api/survey/submit
//
// Accepts the completed survey payload, verifies the JWT, validates required
// fields, then forwards to the webhook ingest pipeline via the existing
// POST /api/webhooks/survey-complete endpoint (internal call).
//
// Request body: { token: string, payload: SurveyV2Payload }
//
// Auth: JWT in request body (no session cookie - mobile field device).
//
// v47.438: Handles standalone surveys (project_id === "__standalone__"):
//   - Skips the project_id === payload.projectId check for standalone tokens.
//   - Validates that selectedClientId OR selectedProjectId is present for
//     standalone surveys (ensures the field worker made a selection).
//   - Forwards solarpro_selected_project_id and solarpro_selected_client_id
//     to the ingest pipeline via the webhook body.
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
import { REQUIRED_PHOTO_CATEGORIES, STANDALONE_PROJECT_ID } from '../../../../lib/survey/v2/types';
import type { SurveyV2Payload } from '../../../../lib/survey/v2/types';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // -- Rate limiting -------------------------------------------------------
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

    const isStandalone =
      claims.project_id === STANDALONE_PROJECT_ID || claims.standalone === true;

    // For non-standalone surveys: verify payload.projectId matches JWT project_id.
    // For standalone surveys: the project_id is "__standalone__" in both places — skip match.
    if (!isStandalone && payload.projectId !== claims.project_id) {
      return NextResponse.json(
        { error: 'Token project_id does not match payload projectId' },
        { status: 400 },
      );
    }

    const validationError = validatePayload(payload, isStandalone);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
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

    // Build the webhook envelope body.
    // v47.438: Add solarpro_selected_project_id and solarpro_selected_client_id
    // for standalone surveys. These are forwarded to projectLinkResolver.
    const webhookBodyObj: Record<string, unknown> = {
      // Envelope fields required by envelopeValidator.ts
      event:        'survey.completed',
      event_id:     payload.surveyId,
      survey_id:    payload.surveyId,
      completed_at: payload.submittedAt,
      schemaVersion: payload.schemaVersion,
      // F-06 ownership claims — forwarded from the verified handoff JWT.
      solarpro_user_id:    claims.solarpro_user_id    ?? null,
      solarpro_project_id: claims.solarpro_project_id ?? null,
      solarpro_email:      claims.solarpro_email       ?? null,
      // Survey payload fields
      projectId:         payload.projectId,
      submittedAt:       payload.submittedAt,
      inspectorName:     payload.inspectorName,
      siteOverview:      payload.siteOverview,
      roofConditions:    payload.roofConditions,
      electricalService: payload.electricalService,
      obstructions:      payload.obstructions,
      photos:            payload.photos,
    };

    // v47.438: Forward on-device picker selections for standalone surveys
    if (isStandalone) {
      webhookBodyObj['solarpro_selected_project_id'] = payload.selectedProjectId ?? null;
      webhookBodyObj['solarpro_selected_client_id']  = payload.selectedClientId  ?? null;
    }

    const webhookBodyStr = JSON.stringify(webhookBodyObj);

    const { createHmac } = await import('crypto');
    const signature = createHmac('sha256', webhookSecret)
      .update(webhookBodyStr)
      .digest('hex');

    // Construct internal webhook URL — always this app, never the partner app
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    const webhookUrl = `${baseUrl.replace(/\/$/, '')}/api/webhooks/survey-complete`;

    const webhookRes = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-survey-signature': `sha256=${signature}`,
      },
      body: webhookBodyStr,
    });

    if (!webhookRes.ok) {
      const webhookResBody = await webhookRes.json().catch(() => ({}));
      const msg = (webhookResBody as { error?: string }).error ?? `Ingest failed (${webhookRes.status})`;
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
//
// v47.438: For standalone surveys, additionally validates that either
// selectedClientId or selectedProjectId is present.
// ---------------------------------------------------------------------------
function validatePayload(payload: SurveyV2Payload, isStandalone: boolean): string | null {
  if (!payload.schemaVersion || payload.schemaVersion !== '2.0') {
    return 'Invalid schemaVersion - expected 2.0';
  }

  if (!payload.surveyId) return 'Missing surveyId';
  if (!payload.projectId) return 'Missing projectId';
  if (!payload.submittedAt) return 'Missing submittedAt';
  if (!payload.inspectorName?.trim()) return 'Missing inspectorName';

  // v47.438: Standalone surveys must have a client or project selection.
  // This ensures the survey can be attached to the correct project in the DB.
  if (isStandalone) {
    const hasSelection =
      (typeof payload.selectedProjectId === 'string' && payload.selectedProjectId.trim()) ||
      (typeof payload.selectedClientId === 'string' && payload.selectedClientId.trim());
    if (!hasSelection) {
      return 'Standalone survey must have a selectedProjectId or selectedClientId';
    }
  }

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