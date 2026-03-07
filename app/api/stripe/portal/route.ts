import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { createPortalSession } from '@/lib/stripe';

export async function POST(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
    }

    const result = await createPortalSession(user.id);

    if (result.error) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, url: result.url });
  } catch (error: any) {
    console.error('Portal error:', error);
    return NextResponse.json({ success: false, error: error.message || 'Failed to create portal session' }, { status: 500 });
  }
}
