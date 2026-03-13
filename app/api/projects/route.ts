export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getProjectsByUser, createProject, getClientById, isValidUUID , handleRouteDbError } from '@/lib/db-neon';
import { geocodeAddress } from '@/lib/geocode';

export async function GET(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });

    const projects = await getProjectsByUser(user.id);
    return NextResponse.json({ success: true, data: projects });
  } catch (err: unknown) {
    return handleRouteDbError('[GET /api/pr', err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });

    const body = await req.json();
    const { clientId, name, systemType, notes, address, stateCode, city, county, zip, utilityName, utilityRatePerKwh, billData, systemSizeKw } = body;

    if (!name || typeof name !== 'string' || name.trim().length < 1) {
      return NextResponse.json({ success: false, error: 'Project name is required' }, { status: 400 });
    }
    if (!systemType || !['roof', 'ground', 'fence'].includes(systemType)) {
      return NextResponse.json({ success: false, error: 'systemType must be roof, ground, or fence' }, { status: 400 });
    }

    // ── Validate clientId ────────────────────────────────────────────────────
    let resolvedClientId: string | undefined = undefined;
    let client = null;
    if (clientId && typeof clientId === 'string' && clientId.trim()) {
      if (!isValidUUID(clientId.trim())) {
        console.warn(`[POST /api/projects] clientId "${clientId}" is not a valid UUID — ignoring`);
      } else {
        client = await getClientById(clientId.trim(), user.id);
        if (!client) {
          return NextResponse.json({ success: false, error: `Client not found: ${clientId}` }, { status: 404 });
        }
        resolvedClientId = clientId.trim();
      }
    }

    // ── Resolve project address ──────────────────────────────────────────────
    // Priority: explicit address > client address
    let projectAddress = (address && typeof address === 'string' && address.trim())
      ? address.trim()
      : client
        ? [client.address, client.city, client.state, client.zip].filter(Boolean).join(', ')
        : '';

    // ── Geocode address → lat/lng ────────────────────────────────────────────
    // Phase 2: Geocode on creation so design studio always has coordinates
    let lat: number | undefined;
    let lng: number | undefined;

    // First check if client already has coords (fastest path)
    if (client?.lat && client?.lng &&
        isFinite(client.lat) && isFinite(client.lng) &&
        !(client.lat === 33.4484 && client.lng === -112.0740)) {
      // Inherit client coords as starting point
      lat = client.lat;
      lng = client.lng;
      console.log(`[POST /api/projects] Using client coords: ${lat}, ${lng}`);
    } else if (projectAddress) {
      // Geocode the address
      try {
        const geo = await geocodeAddress(projectAddress);
        if (geo) {
          lat = geo.lat;
          lng = geo.lng;
          console.log(`[POST /api/projects] Geocoded "${projectAddress}" → ${lat}, ${lng}`);
        } else {
          console.warn(`[POST /api/projects] Geocoding returned null for "${projectAddress}"`);
        }
      } catch (geoErr: unknown) {
        // Non-fatal — project still creates, design studio will geocode on load
        console.warn(`[POST /api/projects] Geocoding failed (non-fatal):`, geoErr);
      }
    }

    const project = await createProject({
      userId: user.id,
      clientId: resolvedClientId,
      name: name.trim(),
      status: 'lead',
      systemType,
      notes: notes || '',
      address: projectAddress,
      lat,
      lng,
      stateCode: stateCode || undefined,
      city: city || undefined,
      county: county || undefined,
      zip: zip || undefined,
      utilityName: utilityName || undefined,
      utilityRatePerKwh: utilityRatePerKwh || undefined,
      systemSizeKw: systemSizeKw || undefined,
      billData: billData || undefined,
    });

    return NextResponse.json({ success: true, data: project }, { status: 201 });
  } catch (err: unknown) {
    return handleRouteDbError('[POST /api/pr', err);
  }
}