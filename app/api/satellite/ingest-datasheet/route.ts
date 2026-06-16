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
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import dns from 'node:dns/promises';
import net from 'node:net';
import { requireAuth } from '@/lib/security';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
import { ingestDatasheet } from '@/lib/satellite/datasheetIngestion';
import type { DatasheetIngestionResult } from '@/lib/satellite/types';

// ── SSRF guard ──────────────────────────────────────────────────────────────
// This endpoint fetches a user-supplied URL server-side, so without a guard an
// attacker could point it at internal/cloud-metadata addresses. Require https
// and reject any host that IS, or RESOLVES TO, a private/loopback/link-local IP.
function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;               // link-local / metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;     // CGNAT
    return false;
  }
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd')) return true;
  const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIp(mapped[1]);
  return false;
}

async function publicUrlError(raw: string): Promise<string | null> {
  let u: URL;
  try { u = new URL(raw); } catch { return 'Invalid URL format'; }
  if (u.protocol !== 'https:') return 'Only https:// URLs are allowed';
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    return 'URL host is not allowed';
  }
  if (net.isIP(host)) {
    return isPrivateIp(host) ? 'URL points to a private address' : null;
  }
  try {
    const addrs = await dns.lookup(host, { all: true });
    if (!addrs.length) return 'URL host could not be resolved';
    if (addrs.some((a) => isPrivateIp(a.address))) return 'URL resolves to a private address';
  } catch {
    return 'URL host could not be resolved';
  }
  return null;
}

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

    // SSRF-safe URL validation (https only; no private/loopback/link-local hosts)
    const urlError = await publicUrlError(url);
    if (urlError) {
      return NextResponse.json(
        { success: false, error: urlError },
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
