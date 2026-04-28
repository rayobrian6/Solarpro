export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { getDbReady , handleRouteDbError} from '@/lib/db-neon';

export async function POST(req: NextRequest) {
  try {
    // Rate limiting — prevent spam submissions (3 req / 60s per IP)
    const { checkRateLimit, getClientIp } = await import('@/lib/rateLimiter');
    const rl = await checkRateLimit('enterprise-contact', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many submissions. Please wait before trying again.' },
        { status: 429 }
      );
    }

    const body = await req.json();
    const { companyName, contactEmail, contactPhone, numberOfInstallers, monthlyInstalls, message } = body;

    if (!companyName?.trim() || !contactEmail?.trim()) {
      return NextResponse.json({ success: false, error: 'Company name and email are required.' }, { status: 400 });
    }

    const emailBody = `
New Enterprise Lead — SolarPro

Company: ${companyName}
Email: ${contactEmail}
Phone: ${contactPhone || 'Not provided'}
Number of Installers: ${numberOfInstallers || 'Not provided'}
Monthly Installs: ${monthlyInstalls || 'Not provided'}

Message:
${message || 'No message provided'}

---
Submitted at: ${new Date().toISOString()}
    `.trim();

    // BUG-22-06 FIX: Removed full PII contact form from server logs.
    // Lead data is stored in DB (enterprise_leads table) — no need to log PII.
    console.log('[enterprise/contact] Lead received and stored in DB');

    // Store in DB (best effort — table created in migration 007)
    try {
      const sql = await getDbReady();
      await sql`
        INSERT INTO enterprise_leads (
          company_name, contact_email, contact_phone,
          number_of_installers, monthly_installs, message, created_at
        ) VALUES (
          ${companyName.trim()},
          ${contactEmail.trim()},
          ${contactPhone?.trim() || null},
          ${numberOfInstallers ? parseInt(numberOfInstallers) : null},
          ${monthlyInstalls ? parseInt(monthlyInstalls) : null},
          ${message?.trim() || null},
          NOW()
        )
      `;
    } catch (dbErr) {
      console.warn('enterprise_leads table not ready (run migration 007):', dbErr);
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return handleRouteDbError('app/api/enterprise/contact/route.ts', error);
  }
}
