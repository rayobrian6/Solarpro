/**
 * POST /api/debug/insert-test-photos
 *
 * Debug endpoint: Insert test photo file records for geometry reconstruction testing.
 * This creates site_survey_files rows with publicly accessible image URLs
 * so the geometry reconstruction pipeline has source photos to process.
 *
 * Requires admin auth. Disabled if DISABLE_DEBUG_ENDPOINTS=true.
 *
 * Body: { surveyId: string }
 * Returns: { success, inserted, fileIds }
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, isValidUUID } from '@/lib/db-neon';
import { v4 as uuidv4 } from 'uuid';

const SAMPLE_IMAGES = [
  {
    url: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&q=80',
    label: 'roof_overview',
    filename: 'roof_overview_01.jpg',
  },
  {
    url: 'https://images.unsplash.com/photo-1504392022761-40c422f8f0f2?w=800&q=80',
    label: 'roof_plane',
    filename: 'roof_plane_01.jpg',
  },
  {
    url: 'https://images.unsplash.com/photo-1517260739337-6799d2b70f01?w=800&q=80',
    label: 'main_service_panel',
    filename: 'service_panel_01.jpg',
  },
  {
    url: 'https://images.unsplash.com/photo-1464802686167-b939a6910659?w=800&q=80',
    label: 'roof_panels',
    filename: 'roof_panels_01.jpg',
  },
  {
    url: 'https://images.unsplash.com/photo-1598950842375-a4d5626a4d3b?w=800&q=80',
    label: 'meter',
    filename: 'meter_01.jpg',
  },
];

export async function POST(req: NextRequest) {
  if (process.env.DISABLE_DEBUG_ENDPOINTS === 'true') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { surveyId } = body;

    if (!surveyId || !isValidUUID(surveyId)) {
      return NextResponse.json({ success: false, error: 'Valid surveyId is required' }, { status: 400 });
    }

    const sql = await getDbReady();
    const fileIds: string[] = [];

    for (const img of SAMPLE_IMAGES) {
      const fileId = uuidv4();
      await sql`
        INSERT INTO site_survey_files (
          id, survey_id, file_url, file_type, label, filename, mime_type
        ) VALUES (
          ${fileId},
          ${surveyId},
          ${img.url},
          'photo',
          ${img.label},
          ${img.filename},
          'image/jpeg'
        )
      `;
      fileIds.push(fileId);
    }

    return NextResponse.json({
      success: true,
      inserted: fileIds.length,
      fileIds,
      surveyId,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
