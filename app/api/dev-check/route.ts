/**
 * GET /api/dev-check
 * LOCAL DEVELOPMENT ONLY — checks env vars are loaded.
 * Returns 404 in production.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';

export async function GET() {
  // Only available in local dev
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 404 });
  }

  const checks = {
    NODE_ENV: process.env.NODE_ENV || '(not set)',
    DATABASE_URL: (() => {
      const v = process.env.DATABASE_URL;
      if (!v) return '❌ NOT SET';
      if (v === 'YOUR_NEON_DATABASE_URL_HERE') return '❌ PLACEHOLDER — fill in .env.local';
      if (v.startsWith('postgres://') || v.startsWith('postgresql://')) return `✅ SET (starts with: ${v.slice(0, 25)}...)`;
      return `⚠️  SET but unexpected format (starts with: ${v.slice(0, 20)}...)`;
    })(),
    JWT_SECRET: (() => {
      const v = process.env.JWT_SECRET;
      if (!v) return '❌ NOT SET';
      if (v === 'your-super-secret-jwt-key-change-this-in-production') return '⚠️  Default value (OK for local dev)';
      return `✅ SET (length: ${v.length})`;
    })(),
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
      ? '✅ SET'
      : '⚠️  NOT SET (maps won\'t work)',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY
      ? '✅ SET'
      : '⚠️  NOT SET (AI features disabled)',
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_')
      ? '✅ SET (test key)'
      : process.env.STRIPE_SECRET_KEY
        ? '✅ SET'
        : '⚠️  NOT SET (billing disabled)',
  };

  const allCriticalOk = 
    !checks.DATABASE_URL.includes('❌') &&
    !checks.JWT_SECRET.includes('❌');

  return NextResponse.json({
    status: allCriticalOk ? '✅ Ready for local dev' : '❌ Missing critical env vars',
    checks,
    instructions: allCriticalOk
      ? 'All critical env vars are set. Auth should work.'
      : 'Fix the ❌ items above in solarpro/.env.local then restart npm run dev',
  }, { status: 200 });
}
