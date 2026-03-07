import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db-neon';

export async function POST(req: NextRequest) {
  try {
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

    // Log lead (replace with email provider when ready)
    console.log('=== ENTERPRISE LEAD ===');
    console.log('To: sales@underthesun.solutions');
    console.log('Subject: Enterprise Lead:', companyName);
    console.log('Reply-To:', contactEmail);
    console.log(emailBody);
    console.log('=======================');

    // Store in DB (best effort — table created in migration 007)
    try {
      const sql = getDb();
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
  } catch (error: any) {
    console.error('Enterprise contact error:', error);
    return NextResponse.json({ success: false, error: 'Failed to submit. Please email sales@underthesun.solutions directly.' }, { status: 500 });
  }
}
