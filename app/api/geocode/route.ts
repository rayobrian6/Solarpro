import { NextRequest, NextResponse } from 'next/server';
import { geocodeAddress } from '@/lib/locationEngine';

// POST /api/geocode — resolve full location metadata from address
export async function POST(req: NextRequest) {
  try {
    const { address } = await req.json();
    if (!address?.trim()) {
      return NextResponse.json({ success: false, error: 'Address required' }, { status: 400 });
    }
    const result = await geocodeAddress(address);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// GET /api/geocode?address=... — same but via query param
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address') || '';
  if (!address.trim()) {
    return NextResponse.json({ success: false, error: 'Address required' }, { status: 400 });
  }
  const result = await geocodeAddress(address);
  return NextResponse.json(result);
}