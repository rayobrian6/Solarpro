import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getClientsByUser, createClient } from '@/lib/db-neon';

export async function GET(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });

    const clients = await getClientsByUser(user.id);
    return NextResponse.json({ success: true, data: clients });
  } catch (err) {
    console.error('[GET /api/clients]', err);
    return NextResponse.json({ success: false, error: 'Failed to fetch clients' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });

    const body = await req.json();
    const {
      name, email, phone, address, city, state, zip, lat, lng,
      utilityProvider, monthlyKwh, annualKwh, averageMonthlyKwh,
      averageMonthlyBill, annualBill, utilityRate
    } = body;

    // Field-level validation — never silent fail
    const errors: Record<string, string> = {};
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      errors.name = 'Name must be at least 2 characters';
    }
    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = 'Valid email address is required';
    }
    if (!address || typeof address !== 'string' || address.trim().length < 5) {
      errors.address = 'Full address is required';
    }

    if (Object.keys(errors).length > 0) {
      return NextResponse.json({ success: false, error: 'Validation failed', fields: errors }, { status: 400 });
    }

    // Calculate derived fields
    const calcAnnualKwh = annualKwh ||
      (monthlyKwh ? monthlyKwh.reduce((s: number, v: number) => s + v, 0) : (averageMonthlyKwh || 1000) * 12);
    const calcAvgMonthly = averageMonthlyKwh || Math.round(calcAnnualKwh / 12);
    const calcRate = utilityRate || (averageMonthlyBill && calcAvgMonthly ? averageMonthlyBill / calcAvgMonthly : 0.13);

    const client = await createClient({
      userId: user.id,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone || '',
      address: address.trim(),
      city: city || '',
      state: state || '',
      zip: zip || '',
      lat: lat || undefined,
      lng: lng || undefined,
      utilityProvider: utilityProvider || '',
      monthlyKwh: monthlyKwh || Array(12).fill(calcAvgMonthly),
      annualKwh: calcAnnualKwh,
      averageMonthlyKwh: calcAvgMonthly,
      averageMonthlyBill: averageMonthlyBill || Math.round(calcAvgMonthly * calcRate),
      annualBill: annualBill || Math.round(calcAnnualKwh * calcRate),
      utilityRate: calcRate,
    });

    return NextResponse.json({ success: true, data: client }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/clients]', err);
    const message = err instanceof Error ? err.message : 'Failed to create client';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}