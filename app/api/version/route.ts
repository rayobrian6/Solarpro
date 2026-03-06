import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    buildVersion: 'BUILD v24',
    timestamp: '2026-03-06',
    description: 'NEC CONDUCTOR SIZING ENGINE',
    gitCommit: '89cd7998',
    features: [
      'NEC 310.15 conductor ampacity',
      'NEC Chapter 9 conduit sizing',
      'Battery to Backup Interface computed wire',
      'Generator to ATS computed wire',
      '120% rule with battery backfeed',
      'IQ SC3 dual-mode ATS handling'
    ]
  });
}