/**
 * lib/email.ts
 * -----------
 * Email service wrapper using Resend.
 * Falls back to console logging if RESEND_API_KEY is not configured,
 * so local dev works without any email setup.
 */

import { Resend } from 'resend';
import { getBaseUrl } from '@/lib/env';

function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey === 're_YOUR_RESEND_API_KEY_HERE') {
    return null;
  }
  return new Resend(apiKey);
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
    // Dev fallback — log to console (redacted to prevent PII leakage)
    console.log('\n========== EMAIL (dev fallback — RESEND_API_KEY not set) ==========');
    console.log(`To:      [redacted]`);
    console.log(`Subject: ${opts.subject}`);
    console.log('Body:    [redacted]');
    console.log('===================================================================\n');
    return { success: true };
  }

  try {
    const { error } = await resend.emails.send({
      from: 'SolarPro <noreply@solarpro.solutions>',
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
  } catch (err: unknown) {
    console.error('[email] sendEmail exception:', (err as Error)?.message);
    return { success: false, error: (err as Error)?.message };
  }
}

// ── Password Reset Email ─────────────────────────────────────────────────────

export async function sendPasswordResetEmail(
  to: string,
  resetToken: string
): Promise<{ success: boolean; error?: string }> {
  const appUrl = getBaseUrl();
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

// ── Proposal Viewed Notification ───────────────────────────────────────────
// Sent to the installer when a customer opens their proposal share link.
// Only fires on the FIRST view (viewCount goes from 0 → 1).

export async function sendProposalViewedEmail(opts: {
  installerEmail: string;
  installerName:  string;
  clientName:     string;
  proposalTitle:  string;
  proposalId:     string;
}): Promise<{ success: boolean; error?: string }> {
  const appUrl = getBaseUrl();
  const proposalUrl = `${appUrl}/proposals`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Proposal Viewed</title>
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

          <!-- Alert badge -->
          <tr>
            <td style="padding:32px 40px 0;">
              <div style="display:inline-block;background:rgba(139,92,246,0.15);border:1px solid rgba(139,92,246,0.4);border-radius:20px;padding:6px 16px;">
                <span style="font-size:12px;font-weight:700;color:#a78bfa;letter-spacing:0.06em;text-transform:uppercase;">👀 Proposal Viewed</span>
              </div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:20px 40px 32px;">
              <h1 style="font-size:22px;font-weight:800;color:#ffffff;margin:0 0 12px;">Your proposal was opened!</h1>
              <p style="font-size:15px;color:rgba(255,255,255,0.75);line-height:1.7;margin:0 0 24px;">
                <strong style="color:#ffffff;">${opts.clientName}</strong> just opened your proposal
                <strong style="color:#fbbf24;">${opts.proposalTitle}</strong>.
                This is a great time to follow up while it's fresh on their mind.
              </p>

              <!-- Info card -->
              <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:20px 24px;margin-bottom:28px;">
                <table cellpadding="0" cellspacing="0" width="100%">
                  <tr>
                    <td style="padding:4px 0;">
                      <span style="font-size:12px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:0.06em;">Client</span><br/>
                      <span style="font-size:15px;color:#ffffff;font-weight:600;">${opts.clientName}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0 4px;">
                      <span style="font-size:12px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:0.06em;">Proposal</span><br/>
                      <span style="font-size:15px;color:#ffffff;font-weight:600;">${opts.proposalTitle}</span>
                    </td>
                  </tr>
                </table>
              </div>

              <!-- CTA -->
              <table cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center">
                    <a href="${proposalUrl}"
                       style="display:inline-block;background:linear-gradient(135deg,#f97316,#ea580c);color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:8px;letter-spacing:0.02em;">
                      View Proposals Dashboard
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:rgba(0,0,0,0.2);padding:20px 40px;border-top:1px solid rgba(255,255,255,0.06);">
              <p style="font-size:11px;color:rgba(255,255,255,0.3);margin:0;text-align:center;line-height:1.8;">
                SolarPro — Operated by Under The Sun Solar<br/>
                This is an automated notification. You can manage notification settings in your account.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();

  const text = `
SolarPro — Proposal Viewed

${opts.clientName} just opened your proposal "${opts.proposalTitle}".

This is a great time to follow up while it's fresh on their mind.

View your proposals dashboard: ${proposalUrl}

---
SolarPro — Operated by Under The Sun Solar
`.trim();

  return sendEmail({
    to:      opts.installerEmail,
    subject: `👀 ${opts.clientName} viewed your proposal`,
    html,
    text,
  });
}

// ── Proposal Signed Notification ────────────────────────────────────────────
// Sent to the installer when a customer signs and accepts the proposal.

export async function sendProposalSignedEmail(opts: {
  installerEmail: string;
  installerName:  string;
  clientName:     string;
  signerName:     string;
  signerEmail:    string;
  proposalTitle:  string;
  proposalId:     string;
  signedAt:       string; // ISO string
}): Promise<{ success: boolean; error?: string }> {
  const appUrl = getBaseUrl();
  const proposalUrl = `${appUrl}/proposals`;
  const signedDate = new Date(opts.signedAt).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Proposal Signed</title>
</head>
<body style="margin:0;padding:0;background:#0a1628;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a1628;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#0f2044;border-radius:12px;border:1px solid rgba(16,185,129,0.4);overflow:hidden;max-width:560px;">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#0a1628 0%,#0f2044 100%);padding:32px 40px;border-bottom:3px solid #10b981;">
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

          <!-- Alert badge -->
          <tr>
            <td style="padding:32px 40px 0;">
              <div style="display:inline-block;background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.4);border-radius:20px;padding:6px 16px;">
                <span style="font-size:12px;font-weight:700;color:#34d399;letter-spacing:0.06em;text-transform:uppercase;">✅ Proposal Signed &amp; Accepted</span>
              </div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:20px 40px 32px;">
              <h1 style="font-size:22px;font-weight:800;color:#ffffff;margin:0 0 12px;">You've got a new customer! 🎉</h1>
              <p style="font-size:15px;color:rgba(255,255,255,0.75);line-height:1.7;margin:0 0 24px;">
                <strong style="color:#ffffff;">${opts.signerName}</strong> just signed and accepted your proposal
                <strong style="color:#fbbf24;">${opts.proposalTitle}</strong>.
                Time to get the project moving!
              </p>

              <!-- Info card -->
              <div style="background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.2);border-radius:10px;padding:20px 24px;margin-bottom:28px;">
                <table cellpadding="0" cellspacing="0" width="100%">
                  <tr>
                    <td style="padding:4px 0;">
                      <span style="font-size:12px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:0.06em;">Signed by</span><br/>
                      <span style="font-size:15px;color:#ffffff;font-weight:600;">${opts.signerName}</span>
                    </td>
                  </tr>
                  ${opts.signerEmail ? `
                  <tr>
                    <td style="padding:12px 0 4px;">
                      <span style="font-size:12px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:0.06em;">Signer Email</span><br/>
                      <span style="font-size:15px;color:#ffffff;font-weight:600;">${opts.signerEmail}</span>
                    </td>
                  </tr>` : ''}
                  <tr>
                    <td style="padding:12px 0 4px;">
                      <span style="font-size:12px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:0.06em;">Proposal</span><br/>
                      <span style="font-size:15px;color:#ffffff;font-weight:600;">${opts.proposalTitle}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0 4px;">
                      <span style="font-size:12px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:0.06em;">Signed on</span><br/>
                      <span style="font-size:15px;color:#34d399;font-weight:600;">${signedDate}</span>
                    </td>
                  </tr>
                </table>
              </div>

              <!-- CTA -->
              <table cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center">
                    <a href="${proposalUrl}"
                       style="display:inline-block;background:linear-gradient(135deg,#10b981,#059669);color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:8px;letter-spacing:0.02em;">
                      View Signed Proposal
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:rgba(0,0,0,0.2);padding:20px 40px;border-top:1px solid rgba(255,255,255,0.06);">
              <p style="font-size:11px;color:rgba(255,255,255,0.3);margin:0;text-align:center;line-height:1.8;">
                SolarPro — Operated by Under The Sun Solar<br/>
                This is an automated notification. The signed proposal is securely stored in your dashboard.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();

  const text = `
SolarPro — Proposal Signed & Accepted 🎉

${opts.signerName} just signed and accepted your proposal "${opts.proposalTitle}".

Signed by:  ${opts.signerName}${opts.signerEmail ? `\nEmail:      ${opts.signerEmail}` : ''}
Proposal:   ${opts.proposalTitle}
Signed on:  ${signedDate}

View your proposals dashboard: ${proposalUrl}

---
SolarPro — Operated by Under The Sun Solar
`.trim();

  return sendEmail({
    to:      opts.installerEmail,
    subject: `✅ ${opts.signerName} signed your proposal — new customer!`,
    html,
    text,
  });
}

// ── Project Stage Advance Notification ──────────────────────────────────────
// Sent to the homeowner when their project stage is advanced.
// Gives them the new stage name, what it means, and a link to their portal.

export async function sendStageAdvanceEmail(opts: {
  homeownerEmail:  string;
  homeownerName:   string;
  projectName:     string;
  newStage:        string;
  stageLabel:      string;
  stageBody:       string;
  stageNext:       string;
  portalUrl:       string;
  companyName:     string;
}): Promise<{ success: boolean; error?: string }> {
  const stageColors: Record<string, string> = {
    lead_submitted:  '#64748b',
    under_review:    '#3b82f6',
    site_survey:     '#06b6d4',
    design:          '#8b5cf6',
    proposal:        '#f59e0b',
    installation:    '#f97316',
    completed:       '#10b981',
  };
  const accentColor = stageColors[opts.newStage] ?? '#f59e0b';

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your Solar Project Update</title>
</head>
<body style="margin:0;padding:0;background:#07070e;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#07070e;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#0f1015;border-radius:14px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;max-width:560px;">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#0a0d14 0%,#0f1015 100%);padding:28px 36px;border-bottom:3px solid ${accentColor};">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="width:40px;height:40px;background:linear-gradient(135deg,#f97316,#fbbf24);border-radius:10px;text-align:center;vertical-align:middle;">
                    <span style="font-size:20px;line-height:40px;">☀️</span>
                  </td>
                  <td style="padding-left:12px;">
                    <div style="font-size:17px;font-weight:900;color:#ffffff;line-height:1.2;">${opts.companyName}</div>
                    <div style="font-size:10px;color:#fbbf24;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;">Solar Project Update</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Stage Badge -->
          <tr>
            <td style="padding:28px 36px 0;">
              <div style="display:inline-block;background:${accentColor}18;border:1px solid ${accentColor}44;border-radius:20px;padding:5px 14px;">
                <span style="font-size:11px;font-weight:700;color:${accentColor};letter-spacing:0.06em;text-transform:uppercase;">🔔 Stage Update</span>
              </div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:18px 36px 28px;">
              <h1 style="font-size:21px;font-weight:800;color:#ffffff;margin:0 0 10px;">Hi ${opts.homeownerName} 👋</h1>
              <p style="font-size:15px;color:rgba(255,255,255,0.7);line-height:1.7;margin:0 0 20px;">
                Great news! Your solar project <strong style="color:#ffffff;">${opts.projectName}</strong> has just moved to a new stage:
              </p>

              <!-- Stage card -->
              <div style="background:${accentColor}0d;border:1px solid ${accentColor}33;border-radius:12px;padding:20px 24px;margin-bottom:24px;">
                <div style="font-size:12px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;">New Stage</div>
                <div style="font-size:22px;font-weight:900;color:${accentColor};margin-bottom:10px;">${opts.stageLabel}</div>
                <p style="font-size:14px;color:rgba(255,255,255,0.7);line-height:1.6;margin:0 0 10px;">${opts.stageBody}</p>
                <div style="font-size:12px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px;">What's next</div>
                <p style="font-size:13px;color:rgba(255,255,255,0.65);margin:0;">${opts.stageNext}</p>
              </div>

              <!-- CTA -->
              <table cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center">
                    <a href="${opts.portalUrl}"
                       style="display:inline-block;background:${accentColor};color:#000000;font-size:15px;font-weight:700;text-decoration:none;padding:13px 32px;border-radius:8px;letter-spacing:0.01em;">
                      View My Project Dashboard →
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:rgba(0,0,0,0.25);padding:18px 36px;border-top:1px solid rgba(255,255,255,0.05);">
              <p style="font-size:11px;color:rgba(255,255,255,0.25);margin:0;text-align:center;line-height:1.7;">
                ${opts.companyName} — Powered by SolarPro<br/>
                You're receiving this because you have an active solar project with us.<br/>
                <a href="${opts.portalUrl}" style="color:rgba(255,255,255,0.35);text-decoration:underline;">View your portal</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();

  const text = `
Hi ${opts.homeownerName},

Your solar project "${opts.projectName}" has moved to a new stage: ${opts.stageLabel}

${opts.stageBody}

What's next: ${opts.stageNext}

View your project dashboard: ${opts.portalUrl}

---
${opts.companyName} — Powered by SolarPro
`.trim();

  return sendEmail({
    to:      opts.homeownerEmail,
    subject: `☀️ Project Update: ${opts.stageLabel} — ${opts.projectName}`,
    html,
    text,
  });
}

// ─── Portal OTP Login Email ───────────────────────────────────────────────────

/**
 * sendPortalOtpEmail — sends a 6-digit one-time passcode to a homeowner.
 * Called during the portal login flow; code expires in 10 minutes.
 */
export async function sendPortalOtpEmail(opts: {
  to:        string;
  name:      string;
  code:      string;        // 6-digit plaintext code (not stored)
  expiresIn: string;        // human-readable, e.g. "10 minutes"
}): Promise<{ success: boolean; error?: string }> {
  const displayName = opts.name.split(' ')[0] || opts.name;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your SolarPro Login Code</title>
</head>
<body style="margin:0;padding:0;background:#07070e;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#07070e;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">

        <!-- Header -->
        <tr>
          <td align="center" style="padding-bottom:32px;">
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:linear-gradient(135deg,rgba(245,158,11,0.25),rgba(245,158,11,0.08));
                            border:1px solid rgba(245,158,11,0.25);border-radius:14px;
                            padding:12px;width:48px;height:48px;text-align:center;vertical-align:middle;">
                  <span style="font-size:24px;line-height:1;">☀️</span>
                </td>
              </tr>
            </table>
            <p style="margin:12px 0 0;font-size:13px;font-weight:700;color:#fff;letter-spacing:0.04em;">
              SolarPro Homeowner Portal
            </p>
          </td>
        </tr>

        <!-- Card -->
        <tr>
          <td style="background:#0f172a;border:1px solid rgba(255,255,255,0.06);
                     border-radius:20px;padding:40px 36px;">

            <p style="margin:0 0 8px;font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.02em;">
              Hi ${displayName} 👋
            </p>
            <p style="margin:0 0 28px;font-size:15px;color:#94a3b8;line-height:1.6;">
              Here's your one-time login code for the homeowner portal.
              It expires in <strong style="color:#f59e0b;">${opts.expiresIn}</strong>.
            </p>

            <!-- OTP block -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
              <tr>
                <td align="center"
                    style="background:linear-gradient(135deg,rgba(245,158,11,0.12),rgba(245,158,11,0.05));
                           border:1.5px solid rgba(245,158,11,0.3);border-radius:16px;
                           padding:24px;">
                  <p style="margin:0 0 6px;font-size:11px;font-weight:700;color:#f59e0b;
                             letter-spacing:0.2em;text-transform:uppercase;">Your login code</p>
                  <p style="margin:0;font-size:42px;font-weight:900;color:#fff;
                             letter-spacing:0.18em;font-family:'Courier New',monospace;">
                    ${opts.code}
                  </p>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 24px;font-size:13px;color:#64748b;line-height:1.6;text-align:center;">
              Enter this code on the login page to access your project dashboard.<br/>
              If you didn't request this code, you can safely ignore this email.
            </p>

            <!-- Divider -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              <tr><td style="border-top:1px solid rgba(255,255,255,0.06);height:1px;font-size:0;">&nbsp;</td></tr>
            </table>

            <!-- Security note -->
            <table cellpadding="0" cellspacing="0" style="width:100%;">
              <tr>
                <td style="width:32px;vertical-align:top;padding-top:2px;">
                  <span style="font-size:16px;">🔒</span>
                </td>
                <td style="font-size:12px;color:#475569;line-height:1.5;">
                  We'll never ask for your code over the phone or by email.
                  Keep it private.
                </td>
              </tr>
            </table>

          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td align="center" style="padding-top:24px;">
            <p style="margin:0;font-size:11px;color:#334155;">
              SolarPro &mdash; Homeowner Portal &nbsp;|&nbsp; Powered by SolarPro
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>
`.trim();

  const text = `
Hi ${displayName},

Your one-time login code for the SolarPro Homeowner Portal is:

  ${opts.code}

This code expires in ${opts.expiresIn}.
Enter it on the portal login page to access your project dashboard.

If you didn't request this, you can safely ignore this email.

— SolarPro Homeowner Portal
`.trim();

  return sendEmail({
    to:      opts.to,
    subject: '🔑 Your SolarPro Portal Login Code',
    html,
    text,
  });
}
