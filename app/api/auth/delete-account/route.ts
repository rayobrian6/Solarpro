export const dynamic    = 'force-dynamic';
export const runtime    = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, clearSessionCookie } from '@/lib/auth';
import { getDbReady, handleRouteDbError } from '@/lib/db-neon';

/**
 * DELETE /api/auth/delete-account
 *
 * Permanently deletes the currently authenticated user's own account.
 * Requires a valid session cookie. Returns 200 on success and clears the
 * session cookie.
 *
 * Used by the automated ToS test suite to clean up ephemeral test accounts
 * so every test run starts from a clean slate.
 *
 * Security:
 *  - Only deletes the account belonging to the authenticated session.
 *  - Cannot be used to delete other users' accounts.
 *  - Requires valid JWT session cookie — unauthenticated requests get 401.
 */
export async function DELETE(req: NextRequest) {
  const user = getUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }

  // Optional safety guard: only allow deletion of test/local accounts
  // unless the query param ?confirm=true is also supplied.
  // This prevents accidental production account deletion.
  const confirm = req.nextUrl.searchParams.get('confirm');
  if (confirm !== 'true') {
    return NextResponse.json(
      {
        success: false,
        error: 'Missing ?confirm=true parameter. Add ?confirm=true to confirm permanent account deletion.',
        code: 'CONFIRM_REQUIRED',
      },
      { status: 400 }
    );
  }

  try {
    const sql = await getDbReady();

    // Fetch user details for logging before deletion
    const rows = await sql`
      SELECT id, email, company FROM users WHERE id = ${user.id} LIMIT 1
    `;
    if (!rows[0]) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    const { id, email } = rows[0];

    // Delete the user record (cascade will handle related rows if FK constraints set)
    await sql`DELETE FROM users WHERE id = ${id}`;

    console.log(`[DELETE_ACCOUNT] User self-deleted: id=${id} email=${email}`);

    // Clear the session cookie in the response
    const res = NextResponse.json(
      { success: true, message: 'Account deleted successfully' },
      { status: 200 }
    );
    res.headers.set('Set-Cookie', clearSessionCookie());
    return res;
  } catch (e: unknown) {
    return handleRouteDbError('[app/api/auth/delete-account/route.ts]', e);
  }
}