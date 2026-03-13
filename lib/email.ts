/**
 * lib/email.ts
 * -----------
 * Email service wrapper using Resend.
 * Falls back to console logging if RESEND_API_KEY is not configured,
 * so local dev works without any email setup.
 */

import { Resend } from 'resend';

function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey === 're_YOUR_RESEND_API_KEY_HERE') {
    return null;
  }
  return new Resend(apiKey);
}

function getAppUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'https://solarpro-v31.vercel.app';
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendEmail(opts: SendEmailOptions): Promise<{ success: boolean; error?: string }> {
  const resend = getResendClient();

  if (!resend) {
    // Dev fallback — log to console
    console.log('\n========== EMAIL (dev fallback — RESEND_API_KEY not set) ==========');
    console.log(`To:      ${opts.to}`);
    console.log(`Subject: ${opts.subject}`);
    console.log('Body:');
    console.log(opts.text);
    console.log('===================================================================\n');
    return { success: true };
  }

  try {
    const { error } = await resend.emails.send({
      from: 'SolarPro <noreply@underthesun.solutions>',
      to:   opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    });

    if (error) {
      console.error('[email] Resend error:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: any) {
    console.error('[email] sendEmail exception:', err?.message);
    return { success: false, error: err?.message };
  }
}

// ── Password Reset Email ──────────────────────────────────────────────────────

export async function sendPasswordResetEmail(
  to: string,
  resetToken: string
): Promise<{ success: boolean; error?: string }> {
  const appUrl = getAppUrl();
  const resetLink = `${appUrl}/auth/reset-password?token=${resetToken}`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SolarPro Password Reset</title>
</head>
<body style="margin:0;padding:0;background:#0a1628;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a1628;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#0f2044;border-radius:12px;border:1px solid rgba(249,115,22,0.3);overflow:hidden;max-width:560px;">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#0a1628 0%,#0f2044 100%);padding:32px 40px;border-bottom:3px solid #f97316;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="width:44px;height:44px;background:linear-gradient(135deg,#f97316,#fbbf24);border-radius:10px;text-align:center;vertical-align:middle;">
                    <span style="font-size:22px;line-height:44px;">☀️</span>
                  </td>
                  <td style="padding-left:14px;">
                    <div style="font-size:20px;font-weight:900;color:#ffffff;line-height:1.2;">SolarPro</div>
                    <div style="font-size:11px;color:#fbbf24;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;">Design Platform</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">
              <h1 style="font-size:22px;font-weight:800;color:#ffffff;margin:0 0 12px;">Password Reset Request</h1>
              <p style="font-size:15px;color:rgba(255,255,255,0.75);line-height:1.7;margin:0 0 24px;">
                We received a request to reset the password for your SolarPro account associated with this email address.
              </p>
              <p style="font-size:15px;color:rgba(255,255,255,0.75);line-height:1.7;margin:0 0 32px;">
                Click the button below to create a new password. This link will expire in <strong style="color:#fbbf24;">1 hour</strong>.
              </p>

              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center">
                    <a href="${resetLink}"
                       style="display:inline-block;background:linear-gradient(135deg,#f97316,#ea580c);color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:8px;letter-spacing:0.02em;">
                      Reset My Password
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Divider -->
              <hr style="border:none;border-top:1px solid rgba(255,255,255,0.1);margin:32px 0;" />

              <!-- Link fallback -->
              <p style="font-size:13px;color:rgba(255,255,255,0.45);line-height:1.6;margin:0 0 8px;">
                If the button doesn't work, copy and paste this link into your browser:
              </p>
              <p style="font-size:12px;color:#f97316;word-break:break-all;margin:0 0 32px;">
                ${resetLink}
              </p>

              <!-- Warning -->
              <div style="background:rgba(249,115,22,0.08);border:1px solid rgba(249,115,22,0.25);border-radius:8px;padding:16px 20px;">
                <p style="font-size:13px;color:rgba(255,255,255,0.6);margin:0;line-height:1.6;">
                  <strong style="color:#fbbf24;">Didn't request this?</strong><br/>
                  If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged and this link will expire automatically.
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:rgba(0,0,0,0.2);padding:20px 40px;border-top:1px solid rgba(255,255,255,0.06);">
              <p style="font-size:11px;color:rgba(255,255,255,0.3);margin:0;text-align:center;line-height:1.8;">
                SolarPro — Operated by Under The Sun Solar<br/>
                This is an automated message. Please do not reply to this email.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`.trim();

  const text = `
SolarPro — Password Reset

We received a request to reset the password for your SolarPro account.

Click the link below to create a new password (expires in 1 hour):

${resetLink}

If you did not request a password reset, you can safely ignore this email.
Your password will remain unchanged.

---
SolarPro — Operated by Under The Sun Solar
`.trim();

  return sendEmail({
    to,
    subject: 'SolarPro — Password Reset',
    html,
    text,
  });
}