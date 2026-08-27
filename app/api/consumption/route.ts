/**
 * app/api/consumption/route.ts
 *
 * POST /api/consumption — submit a Consumption Profile form.
 * GET  /api/consumption — health check.
 *
 * This is a STUB. The real backend persistence is owned by the
 * platform team. The stub:
 *   - Validates the same way the client does (lib/consumption/validation.ts)
 *   - Generates an id, stamps createdAt/updatedAt
 *   - Echoes the result back
 *
 * The contract this route exposes:
 *   POST { profile: ConsumptionProfileForm }
 *   200 { success: true, data: ConsumptionProfileResult }
 *   400 { success: false, error: string, errors?: Record<string,string> }
 *
 * When the real backend lands, the only change required is to swap
 * the body of POST for a DB call — the contract stays the same and
 * the form keeps working.
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { validateConsumptionProfile } from '@/lib/consumption/validation';
import type { ConsumptionProfileForm, ConsumptionProfileResult } from '@/lib/consumption/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PostBody {
  profile?: Partial<ConsumptionProfileForm>;
  projectId?: string;
}

export async function POST(req: NextRequest) {
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  if (!body || typeof body !== 'object' || !body.profile) {
    return NextResponse.json(
      { success: false, error: 'Missing `profile` field in request body' },
      { status: 400 },
    );
  }

  const result = validateConsumptionProfile(body.profile);
  if (result.ok === 'error') {
    return NextResponse.json(
      {
        success: false,
        error: 'Validation failed',
        errors: result.errors,
      },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const data: ConsumptionProfileResult = {
    id: randomUUID(),
    projectId: body.projectId,
    profile: result.data,
    createdAt: now,
    updatedAt: now,
  };

  return NextResponse.json({ success: true, data }, { status: 200 });
}

export async function GET() {
  return NextResponse.json(
    {
      success: true,
      data: {
        status: 'ok',
        route: 'consumption',
        methods: ['POST'],
        // We do not list UTILITY_PROVIDERS here on purpose: the option
        // lists live client-side. When the real backend ships a
        // /api/consumption/options endpoint, this is where it slots in.
      },
    },
    { status: 200 },
  );
}
