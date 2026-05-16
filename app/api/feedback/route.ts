/**
 * POST /api/feedback
 * Submit user feedback (bug or suggestion) with optional screenshot.
 * Accepts multipart/form-data or JSON.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError } from '@/lib/db-neon';
import { BUILD_VERSION } from '@/lib/version';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

// ── Magic byte validation for screenshot images ─────────────────────────────
const ALLOWED_SCREENSHOT_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
]);

function isValidScreenshotMagic(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  // JPEG: FF D8 FF
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return true;
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return true;
  // WebP: RIFF????WEBP
  if (buf.length >= 12 &&
      buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return true;
  // GIF: GIF87a or GIF89a
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return true;
  return false;
}

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
        // ── Magic byte validation ──
        if (!isValidScreenshotMagic(screenshotBuffer)) {
          return NextResponse.json(
            { success: false, error: 'Screenshot file type not supported. Please use JPEG, PNG, WebP, or GIF.' },
            { status: 400 }
          );
        }
        if (!ALLOWED_SCREENSHOT_MIMES.has(screenshotMime)) {
          screenshotMime = 'image/jpeg'; // sanitize declared MIME
        }
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
        // ── Magic byte validation ──
        if (!isValidScreenshotMagic(screenshotBuffer)) {
          return NextResponse.json(
            { success: false, error: 'Screenshot file type not supported. Please use JPEG, PNG, WebP, or GIF.' },
            { status: 400 }
          );
        }
        if (!ALLOWED_SCREENSHOT_MIMES.has(screenshotMime)) {
          screenshotMime = 'image/jpeg'; // sanitize declared MIME
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
    // ── Field length caps ──
    if (message.trim().length > 5000) {
      return NextResponse.json({ success: false, error: 'Message must be 5000 characters or fewer.' }, { status: 400 });
    }
    if (pageUrl && pageUrl.length > 2000) {
      return NextResponse.json({ success: false, error: 'Page URL too long.' }, { status: 400 });
    }
    if (browserInfo && browserInfo.length > 500) {
      return NextResponse.json({ success: false, error: 'Browser info too long.' }, { status: 400 });
    }
    if (screenSize && screenSize.length > 50) {
      return NextResponse.json({ success: false, error: 'Screen size too long.' }, { status: 400 });
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