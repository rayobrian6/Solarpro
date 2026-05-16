// ============================================================================
// GET   /api/site-surveys/[surveyId]  — survey detail + files
// PATCH /api/site-surveys/[surveyId]  — update (attach project, status, notes)
// ============================================================================

export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import {
  getSiteSurveyById,
  getSiteSurveyFiles,
  updateSiteSurvey,
  isValidUUID,
} from '@/lib/db-neon';

// ---------------------------------------------------------------------------
// GET — survey detail + all files
// ---------------------------------------------------------------------------
export async function GET(
  req: NextRequest,
  { params }: { params: { surveyId: string } },
) {
  try {
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { surveyId } = params;
    if (!isValidUUID(surveyId)) {
      return NextResponse.json({ success: false, error: 'Invalid survey ID' }, { status: 400 });
    }

    const [survey, files] = await Promise.all([
      getSiteSurveyById(surveyId, user.id),
      getSiteSurveyFiles(surveyId),
    ]);

    if (!survey) {
      return NextResponse.json({ success: false, error: 'Survey not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: { survey, files } });
  } catch (err) {
    console.error('[GET /api/site-surveys/[surveyId]]', err);
    return NextResponse.json({ success: false, error: 'Failed to load survey' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH — partial update (attach to project, change status, add notes)
// ---------------------------------------------------------------------------
export async function PATCH(
  req: NextRequest,
  { params }: { params: { surveyId: string } },
) {
  try {
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { surveyId } = params;
    if (!isValidUUID(surveyId)) {
      return NextResponse.json({ success: false, error: 'Invalid survey ID' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));

    // Validate projectId if provided
    if (body.projectId && !isValidUUID(body.projectId)) {
      return NextResponse.json({ success: false, error: 'Invalid project ID' }, { status: 400 });
    }

    const validStatuses = ['draft', 'completed', 'reviewed'];
    if (body.status && !validStatuses.includes(body.status)) {
      return NextResponse.json({ success: false, error: 'Invalid status' }, { status: 400 });
    }

    const updated = await updateSiteSurvey(surveyId, user.id, {
      projectId:       body.projectId,
      status:          body.status,
      addressSnapshot: body.addressSnapshot,
      surveyData:      body.surveyData,
      notes:           body.notes,
      inspectorName:   body.inspectorName,
    });

    if (!updated) {
      return NextResponse.json({ success: false, error: 'Survey not found or unauthorized' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (err) {
    console.error('[PATCH /api/site-surveys/[surveyId]]', err);
    return NextResponse.json({ success: false, error: 'Failed to update survey' }, { status: 500 });
  }
}