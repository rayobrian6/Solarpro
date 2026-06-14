// ============================================================================
// v47.441 - POST /api/satellite/ingest-datasheet
//
// Datasheet ingestion endpoint that fetches a manufacturer datasheet
// from a URL and extracts hardware specs (wattage, efficiency, voltage,
// current, etc.) for auto-populating the equipment database forms.
//
// Input:  { url, equipmentTypeHint?, manufacturerHint?, modelHint? }
// Output: { equipmentType, manufacturer, model, panelSpecs, inverterSpecs,
//           method, sourceUrl }
//
// Called by the admin hardware page when a user enters a datasheet URL.
// Results carry confidence + source for ConfidenceBadge UX.
// ============================================================================

export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/security';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
import { ingestDatasheet } from '@/lib/satellite/datasheetIngestion';
import type { DatasheetIngestionResult } from '@/lib/satellite/types';

export async function POST(req: NextRequest) {
  // SECURITY: Require authenticated user
  const _auth = await requireAuth(req);
  if (_auth.response) return _auth.response;

  // RATE LIMIT: Datasheet ingestion involves fetching external URLs
  const _rl = await checkRateLimit('satellite', getClientIp(req));
  if (!_rl.allowed) {
    return NextResponse.json(
      { success: false, error: 'Too many requests. Please slow down.' },
      { status: 429 },
    );
  }

  try {
    const body = await req.json();
    const { url, equipmentTypeHint, manufacturerHint, modelHint } = body as {
      url?: string;
      equipmentTypeHint?: 'panel' | 'string_inverter' | 'microinverter' | 'optimizer';
      manufacturerHint?: string;
      modelHint?: string;
    };

    // Validate URL
    if (!url || typeof url !== 'string') {
      return NextResponse.json(
        { success: false, error: 'url is required' },
        { status: 400 },
      );
    }

    // Basic URL validation
    try {
      new URL(url);
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid URL format' },
        { status: 400 },
      );
    }

    const result: DatasheetIngestionResult = await ingestDatasheet({
      url,
      equipmentTypeHint,
      manufacturerHint,
      modelHint,
    });

    return NextResponse.json({
      success: true,
      result,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[datasheet-ingest] Ingestion failed: ${msg}`);
    return NextResponse.json(
      { success: false, error: 'Datasheet ingestion failed. Please try again.' },
      { status: 500 },
    );
  }
}
