// ============================================================================
// GET /api/projects/[id]/survey-context
//
// Returns the full ProjectSurveyContext for a project:
//   - surveys (all, newest first)
//   - latest survey + files + typed SurveyV2Payload
//
// Used by FieldSurveyCard and any UI that needs survey state without
// fetching surveys and files in separate round trips.
// ============================================================================

export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { isValidUUID } from '@/lib/db-neon';
import { getProjectSurveyContext } from '@/lib/survey/getProjectSurveyContext';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const projectId = params.id;
    if (!isValidUUID(projectId)) {
      return NextResponse.json({ success: false, error: 'Invalid project ID' }, { status: 400 });
    }

    const context = await getProjectSurveyContext(projectId, user.id);

    return NextResponse.json({ success: true, data: context });
  } catch (err) {
    console.error('[GET /api/projects/[id]/survey-context]', err);
    return NextResponse.json(
      { success: false, error: 'Failed to load survey context' },
      { status: 500 },
    );
  }
}