// lib/rateLimitGuard.ts
// Centralized rate limiting guard for API routes.
// Ensures ALL API routes have appropriate rate limiting per SOC 2 CC6.1
// and ISO 27001 A.12.6.1 (vulnerability / abuse protection).
//
// USAGE in route handlers:
//   import { rateLimitGuard } from '@/lib/rateLimitGuard';
//
//   export async function POST(req: NextRequest) {
//     const guard = await rateLimitGuard(req, 'standard');
//     if (guard.blocked) return guard.response;
//     // ... route logic ...
//   }
//
// For routes that need a specific limiter key:
//   const guard = await rateLimitGuard(req, 'admin');
//   const guard = await rateLimitGuard(req, 'engineering');
//
// For auth routes (already have custom rate limiting):
//   const guard = await rateLimitGuard(req, 'login');
//
// This replaces the need for manual checkRateLimit + getClientIp
// + 429 response boilerplate in every single route handler.

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp, LimiterKey } from '@/lib/rateLimiter';

export interface RateLimitResult {
  blocked: boolean;
  response?: NextResponse;
  ip: string;
}

/**
 * Rate limiting guard for API route handlers.
 * Returns { blocked: false, ip } if the request is allowed,
 * or { blocked: true, response } if the request should be rejected with 429.
 *
 * @param req - The NextRequest object
 * @param limiterKey - Which rate limiter to use (from LimiterKey union)
 * @param customMessage - Optional custom error message for 429 response
 */
export async function rateLimitGuard(
  req: NextRequest,
  limiterKey: LimiterKey = 'standard',
  customMessage?: string,
): Promise<RateLimitResult> {
  const ip = getClientIp(req);
  const result = await checkRateLimit(limiterKey, ip);

  if (!result.allowed) {
    return {
      blocked: true,
      ip,
      response: NextResponse.json(
        {
          success: false,
          error: customMessage || 'Too many requests. Please wait before trying again.',
        },
        { status: 429 }
      ),
    };
  }

  return { blocked: false, ip };
}

/**
 * Rate limiting specifically for admin routes.
 * Uses the 'admin' limiter key with tighter limits.
 */
export async function adminRateLimitGuard(
  req: NextRequest,
): Promise<RateLimitResult> {
  return rateLimitGuard(req, 'admin', 'Too many admin requests. Please wait before trying again.');
}

/**
 * Rate limiting for engineering/compute-intensive routes.
 * Uses the 'engineering' limiter key.
 */
export async function engineeringRateLimitGuard(
  req: NextRequest,
): Promise<RateLimitResult> {
  return rateLimitGuard(req, 'engineering', 'Compute limit reached. Please wait before requesting another calculation.');
}
