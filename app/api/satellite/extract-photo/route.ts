// ============================================================================
// v47.439 - POST /api/satellite/extract-photo
//
// Photo extraction endpoint that analyzes uploaded survey photos to extract
// panel brand, breaker count, and roof condition.
//
// Input:  { photoUrls, structureType?, latitude?, longitude?, panelRating?,
//           roofAgeYears?, roofMaterial? }
// Output: { panelBrand, breakerSlots, roofCondition, analyzedCategories }
//
// Called by the survey steps when photos are uploaded.
// Results carry confidence + source for ConfidenceBadge UX.
// ============================================================================

export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/security';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
import { extractFromPhotos } from '@/lib/satellite/photoExtractor';
import type { PhotoExtractionResult } from '@/lib/satellite/types';

export async function POST(req: NextRequest) {
  // SECURITY: Require authenticated user
  const _auth = await requireAuth(req);
  if (_auth.response) return _auth.response;

  // RATE LIMIT: Photo extraction involves processing
  const _rl = await checkRateLimit('satellite', getClientIp(req));
  if (!_rl.allowed) {
    return NextResponse.json(
      { success: false, error: 'Too many requests. Please slow down.' },
      { status: 429 },
    );
  }

  try {
    const body = await req.json();
    const {
      photoUrls,
      structureType,
      latitude,
      longitude,
      panelRating,
      roofAgeYears,
      roofMaterial,
    } = body as {
      photoUrls?: Record<string, string>;
      structureType?: string;
      latitude?: number;
      longitude?: number;
      panelRating?: string;
      roofAgeYears?: number | null;
      roofMaterial?: string;
    };

    // Validate photo URLs
    if (!photoUrls || typeof photoUrls !== 'object' || Object.keys(photoUrls).length === 0) {
      return NextResponse.json(
        { success: false, error: 'photoUrls is required and must be a non-empty object' },
        { status: 400 },
      );
    }

    const result: PhotoExtractionResult = await extractFromPhotos({
      photoUrls,
      structureType,
      latitude,
      longitude,
      panelRating,
      roofAgeYears: roofAgeYears ?? null,
      roofMaterial,
    });

    return NextResponse.json({
      success: true,
      result,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[photo-extract] Extraction failed: ${msg}`);
    return NextResponse.json(
      { success: false, error: 'Photo extraction failed. Please try again.' },
      { status: 500 },
    );
  }
}
