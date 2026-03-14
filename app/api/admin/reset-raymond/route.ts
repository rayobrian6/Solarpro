import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/admin/reset-raymond
 *
 * This route has been permanently disabled.
 *
 * Reason: It previously reset a specific user's password to a hardcoded weak value
 * ('ChangeMe123!') and elevated their role to super_admin using a hardcoded token
 * ('solarpro-fix-2024'). Both the token and the fallback password were committed
 * to the repository and must be treated as compromised.
 *
 * To reset a user password, use the standard admin panel or a secure one-time
 * password reset flow with a high-entropy token stored in environment variables.
 */
export async function GET() {
  return NextResponse.json(
    {
      success: false,
      error: 'This endpoint has been permanently disabled for security reasons.',
      code: 'ENDPOINT_DISABLED',
    },
    { status: 410 }
  );
}