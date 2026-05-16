// ============================================================================
// GET /api/clients/[id]/site-surveys — list all surveys for a client
// ============================================================================

export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getSiteSurveysByClient, isValidUUID } from '@/lib/db-neon';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const clientId = params.id;
    if (!isValidUUID(clientId)) {
      return NextResponse.json({ success: false, error: 'Invalid client ID' }, { status: 400 });
    }

    const surveys = await getSiteSurveysByClient(clientId, user.id);
    return NextResponse.json({ success: true, data: surveys });
  } catch (err) {
    console.error('[GET /api/clients/[id]/site-surveys]', err);
    return NextResponse.json({ success: false, error: 'Failed to load surveys' }, { status: 500 });
  }
}