import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  // Dump ALL env var keys so we can see what's available
  const allKeys = Object.keys(process.env).sort();
  
  return NextResponse.json({
    total: allKeys.length,
    keys: allKeys,
    // Sample a few values (safe ones only)
    NODE_ENV: process.env.NODE_ENV,
    VERCEL: process.env.VERCEL,
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_REGION: process.env.VERCEL_REGION,
  });
}

export async function POST(req: NextRequest) {
  return NextResponse.json({ message: 'use GET first to see env keys' });
}