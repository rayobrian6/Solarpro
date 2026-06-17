// ============================================================================
// v47.438 - POST /api/satellite/analyze
//
// Satellite analysis endpoint that orchestrates obstruction detection
// and roof analysis. Returns results compatible with the
// ComputedField + ConfidenceBadge + RecommendationCard UX pattern.
//
// Input:  { latitude, longitude, address?, structureType? }
// Output: { obstructions, roof, liveApiUsed }
//
// Called by the survey steps on mount when lat/lng are available.
// ============================================================================

export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/security';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
import { detectObstructions } from '@/lib/satellite/obstructionDetector';
import { analyzeRoof } from '@/lib/satellite/roofAnalyzer';
import { detectServiceEntrance } from '@/lib/satellite/streetViewDetector';
import type { SatelliteAnalysisResult } from '@/lib/satellite/types';

export async function POST(req: NextRequest) {
  // SECURITY: Require authenticated user
  const _auth = await requireAuth(req);
  if (_auth.response) return _auth.response;

  // RATE LIMIT: Satellite analysis involves external API calls
  const _rl = await checkRateLimit('satellite', getClientIp(req));
  if (!_rl.allowed) {
    return NextResponse.json(
      { success: false, error: 'Too many requests. Please slow down.' },
      { status: 429 },
    );
  }

  try {
    const body = await req.json();
    const { latitude, longitude, address, structureType } = body as {
      latitude?: number;
      longitude?: number;
      address?: string;
      structureType?: string;
    };

    // Validate required fields
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return NextResponse.json(
        { success: false, error: 'latitude and longitude are required' },
        { status: 400 },
      );
    }

    // Validate coordinate ranges
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      return NextResponse.json(
        { success: false, error: 'Invalid coordinates' },
        { status: 400 },
      );
    }

    // Run obstruction detection + roof analysis + service entrance detection in parallel
    const [obstructionResult, roofResult, serviceEntranceResult] = await Promise.all([
      detectObstructions({
        lat: latitude,
        lng: longitude,
        address,
        structureType: structureType || undefined,
      }),
      analyzeRoof({
        lat: latitude,
        lng: longitude,
        address,
        structureType: structureType || undefined,
      }),
      detectServiceEntrance({
        lat: latitude,
        lng: longitude,
        address,
        structureType: structureType || undefined,
      }),
    ]);

    const result: SatelliteAnalysisResult = {
      obstructions: obstructionResult,
      roof: roofResult,
      serviceEntrance: serviceEntranceResult,
      liveApiUsed: obstructionResult.method !== 'heuristic' || roofResult.method !== 'heuristic' || serviceEntranceResult.method !== 'heuristic',
    };

    return NextResponse.json({
      success: true,
      result,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[satellite] Analysis failed: ${msg}`);
    return NextResponse.json(
      { success: false, error: 'Satellite analysis failed. Please try again.' },
      { status: 500 },
    );
  }
}
