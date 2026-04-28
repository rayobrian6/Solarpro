/**
 * POST /api/feedback
 * Submit user feedback (bug or suggestion) with optional screenshot.
 * Accepts multipart/form-data or JSON.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError } from '@/lib/db-neon';
import { BUILD_VERSION } from '@/lib/version';

// Max screenshot size: 5MB
const MAX_SCREENSHOT_SIZE = 5 * 1024 * 1024;

/** Ensure feedback table exists (auto-migration) */
async function ensureFeedbackTable(sql: any) {
  await sql`
    CREATE TABLE IF NOT EXISTS feedback (
      id              VARCHAR(36)   PRIMARY KEY DEFAULT gen_random_uuid()::text,
      type            VARCHAR(20)   NOT NULL,
      message         TEXT          NOT NULL,
      page_url        TEXT,
      user_id         VARCHAR(36)   NOT NULL,
      user_email      VARCHAR(255),
      screenshot_data BYTEA,
      screenshot_name VARCHAR(255),
      screenshot_mime VARCHAR(100),
      browser_info    TEXT,
      screen_size     VARCHAR(50),
      app_version     VARCHAR(50),
      status          VARCHAR(20)   NOT NULL DEFAULT 'new',
      created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
    )
  `;
}

export async function POST(req: NextRequest) {
  try {
    // SECURITY: Rate limiting — prevent feedback spam / storage abuse
    const { checkRateLimit, getClientIp } = await import('@/lib/rateLimiter');
    const rl = await checkRateLimit('feedback', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json({ success: false, error: 'Too many feedback submissions. Please slow down.' }, { status: 429 });
    }

    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
    }

    const sql = await getDbReady();
    await ensureFeedbackTable(sql);

    const contentType = req.headers.get('content-type') || '';

    let type: string = '';
    let message: string = '';
    let pageUrl: string = '';
    let browserInfo: string = '';
    let screenSize: string = '';
    let screenshotBuffer: Buffer | null = null;
    let screenshotName: string | null = null;
    let screenshotMime: string | null = null;

    if (contentType.includes('multipart/form-data')) {
      // Handle multipart form data
      const formData = await req.formData();
      type = (formData.get('type') as string) || '';
      message = (formData.get('message') as string) || '';
      pageUrl = (formData.get('pageUrl') as string) || '';
      browserInfo = (formData.get('browserInfo') as string) || '';
      screenSize = (formData.get('screenSize') as string) || '';

      const screenshot = formData.get('screenshot') as File | null;
      if (screenshot && screenshot.size > 0) {
        if (screenshot.size > MAX_SCREENSHOT_SIZE) {
          return NextResponse.json(
            { success: false, error: 'Screenshot must be under 5MB' },
            { status: 400 }
          );
        }
        screenshotBuffer = Buffer.from(await screenshot.arrayBuffer());
        screenshotName = screenshot.name;
        screenshotMime = screenshot.type;
      }
    } else {
      // Handle JSON
      const body = await req.json();
      type = body.type || '';
      message = body.message || '';
      pageUrl = body.pageUrl || '';
      browserInfo = body.browserInfo || '';
      screenSize = body.screenSize || '';

      // JSON screenshot as base64
      if (body.screenshotData && body.screenshotName) {
        const base64Data = body.screenshotData.replace(/^data:[^;]+;base64,/, '');
        screenshotBuffer = Buffer.from(base64Data, 'base64');
        screenshotName = body.screenshotName;
        screenshotMime = body.screenshotMime || 'image/png';
        if (screenshotBuffer.length > MAX_SCREENSHOT_SIZE) {
          return NextResponse.json(
            { success: false, error: 'Screenshot must be under 5MB' },
            { status: 400 }
          );
        }
      }
    }

    // Validation
    if (!type || !['bug', 'suggestion'].includes(type)) {
      return NextResponse.json(
        { success: false, error: 'Type must be "bug" or "suggestion"' },
        { status: 400 }
      );
    }
    if (!message || message.trim().length < 5) {
      return NextResponse.json(
        { success: false, error: 'Message must be at least 5 characters' },
        { status: 400 }
      );
    }

    // Insert — separate path for with/without screenshot to avoid BYTEA null issues
    let rows;
    if (screenshotBuffer) {
      rows = await sql`
        INSERT INTO feedback (
          type, message, page_url, user_id, user_email,
          screenshot_data, screenshot_name, screenshot_mime,
          browser_info, screen_size, app_version, status
        ) VALUES (
          ${type}, ${message.trim()}, ${pageUrl || null}, ${user.id}, ${user.email || null},
          ${screenshotBuffer}, ${screenshotName}, ${screenshotMime},
          ${browserInfo || null}, ${screenSize || null}, ${BUILD_VERSION}, 'new'
        )
        RETURNING id, type, message, status, created_at
      `;
    } else {
      rows = await sql`
        INSERT INTO feedback (
          type, message, page_url, user_id, user_email,
          browser_info, screen_size, app_version, status
        ) VALUES (
          ${type}, ${message.trim()}, ${pageUrl || null}, ${user.id}, ${user.email || null},
          ${browserInfo || null}, ${screenSize || null}, ${BUILD_VERSION}, 'new'
        )
        RETURNING id, type, message, status, created_at
      `;
    }

    return NextResponse.json({
      success: true,
      data: rows[0],
    });
  } catch (err: unknown) {
    console.error('[POST /api/feedback] ERROR:', (err as Error).message, (err as Error).stack);
    return handleRouteDbError('[POST /api/feedback]', err);
  }
}