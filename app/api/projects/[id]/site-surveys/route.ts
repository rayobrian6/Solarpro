// ============================================================================
// GET  /api/projects/[id]/site-surveys  — list surveys for a project
// POST /api/projects/[id]/site-surveys  — create a survey linked to a project
// ============================================================================

export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { rateLimitGuard } from '@/lib/rateLimitGuard';
import {
  getSiteSurveysByProject,
  createSiteSurvey,
  getProjectById,
  isValidUUID,
} from '@/lib/db-neon';

// ---------------------------------------------------------------------------
// GET — list surveys for project
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const projectId = params.id;
    if (!isValidUUID(projectId)) {
      return NextResponse.json({ success: false, error: 'Invalid project ID' }, { status: 400 });
    }

    const surveys = await getSiteSurveysByProject(projectId, user.id);
    return NextResponse.json({ success: true, data: surveys });
  } catch (err) {
    console.error('[GET /api/projects/[id]/site-surveys]', err);
    return NextResponse.json({ success: false, error: 'Failed to load surveys' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST — create survey linked to project (office-side manual creation)
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const projectId = params.id;
    if (!isValidUUID(projectId)) {
      return NextResponse.json({ success: false, error: 'Invalid project ID' }, { status: 400 });
    }

    // Verify project belongs to user and get client_id
    const project = await getProjectById(projectId, user.id);
    if (!project) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }
    if (!project.clientId) {
      return NextResponse.json(
        { success: false, error: 'Project has no associated client — attach a client first' },
        { status: 422 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const survey = await createSiteSurvey({
      clientId:        project.clientId,
      projectId:       projectId,
      createdBy:       user.id,
      source:          'project_handoff',
      status:          body.status ?? 'completed',
      addressSnapshot: body.addressSnapshot ?? project.address ?? null,
      surveyData:      body.surveyData ?? null,
      inspectorName:   body.inspectorName ?? null,
      notes:           body.notes ?? null,
      externalSurveyId: body.externalSurveyId ?? null,
      deliveryId:      body.deliveryId ?? null,
    });

    return NextResponse.json({ success: true, data: survey }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/projects/[id]/site-surveys]', err);
    return NextResponse.json({ success: false, error: 'Failed to create survey' }, { status: 500 });
  }
}