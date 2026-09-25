/**
 * tests/emailNeverSilentlySucceeds.test.ts
 *
 * THE PRODUCT SAID THE HOMEOWNER HAD THE PROPOSAL. NOTHING HAD BEEN SENT.
 *
 * 🚨 A SILENT SUCCESS IS WORSE THAN AN ERROR, BECAUSE NOBODY GOES LOOKING.
 *
 * `sendEmail` falls back to a console log when `RESEND_API_KEY` is unset or
 * still the placeholder, so local development works with no email setup. That
 * is right, and it stays.
 *
 * What was wrong is that the fallback returned `{ success: true }`
 * UNCONDITIONALLY — with no NODE_ENV gate. So a production deploy whose key was
 * missing or never replaced reported every email as sent. Callers believe that:
 * the proposal route stamps `sent_at` and the UI tells the installer the
 * homeowner has it.
 *
 * The failure mode is an installer waiting on a reply to a proposal that was
 * never delivered, with the product showing it as sent — and no error anywhere
 * to prompt anyone to check.
 *
 * Found by the competitor failure hunt while cataloguing what makes users
 * distrust a tool. It was ours, not a rival's.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './support/stripSource';

const ROOT = join(__dirname, '..');
const EMAIL_SRC = stripComments(readFileSync(join(ROOT, 'lib', 'email.ts'), 'utf8'));

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV };
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

/** Load a fresh copy of the module under the current env. */
async function loadEmail() {
  return import('../lib/email');
}

describe('🚨 an unconfigured production deploy does not claim to have sent mail', () => {
  it('refuses, and says why, when the key is missing in production', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.RESEND_API_KEY;
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { sendEmail } = await loadEmail();
    const res = await sendEmail({ to: 'a@b.com', subject: 'Your proposal', html: '<p/>', text: '' });

    expect(res.success, 'an unconfigured production deploy reported the email as sent').toBe(false);
    expect(res.error, 'the refusal did not say what was wrong').toBeTruthy();
    expect(String(res.error)).toMatch(/RESEND_API_KEY|not configured/i);
  });

  it('refuses on the PLACEHOLDER key too — that is the likelier mistake', async () => {
    // A deploy that copied .env.example forward has the placeholder, not an
    // empty value, and it looks configured at a glance.
    process.env.NODE_ENV = 'production';
    process.env.RESEND_API_KEY = 're_YOUR_RESEND_API_KEY_HERE';
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { sendEmail } = await loadEmail();
    const res = await sendEmail({ to: 'a@b.com', subject: 'Your proposal', html: '<p/>', text: '' });
    expect(res.success).toBe(false);
  });

  it('and it logs the refusal, so the deploy is diagnosable', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.RESEND_API_KEY;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { sendEmail } = await loadEmail();
    await sendEmail({ to: 'a@b.com', subject: 'Your proposal', html: '<p/>', text: '' });
    expect(spy).toHaveBeenCalled();
    expect(String(spy.mock.calls[0]?.[0] ?? '')).toMatch(/REFUSED/);
  });
});

describe('development keeps its console fallback', () => {
  it('a dev machine with no key still "sends", so local work needs no setup', async () => {
    // 🚨 THE POINT OF THE FALLBACK, AND IT MUST SURVIVE. Making this fail in
    // development would mean every contributor needs a Resend account before
    // they can click anything — which is how a fallback like this gets
    // reintroduced without the production gate.
    process.env.NODE_ENV = 'development';
    delete process.env.RESEND_API_KEY;
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const { sendEmail } = await loadEmail();
    const res = await sendEmail({ to: 'a@b.com', subject: 'Hello', html: '<p/>', text: '' });
    expect(res.success).toBe(true);
  });

  it('the dev log still redacts the recipient and the body', async () => {
    // The fallback prints to a shared console; it must not become a PII leak
    // just because it is development.
    process.env.NODE_ENV = 'development';
    delete process.env.RESEND_API_KEY;
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { sendEmail } = await loadEmail();
    await sendEmail({ to: 'homeowner@example.com', subject: 'Hello', html: '<p>secret</p>', text: 'secret' });

    const printed = spy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(printed, 'the dev fallback leaked the recipient').not.toMatch(/homeowner@example\.com/);
    expect(printed, 'the dev fallback leaked the body').not.toMatch(/secret/);
    expect(printed).toMatch(/redacted/);
  });
});

describe('the gate is on the environment, not on a caller remembering', () => {
  it('sendEmail itself decides — no caller is trusted to check', () => {
    // If the gate moved into callers, every future caller would have to
    // remember it, and the one that forgets is the one that stamps sent_at.
    expect(EMAIL_SRC).toMatch(/process\.env\.NODE_ENV === 'production'/);
    const i = EMAIL_SRC.indexOf('if (!resend) {');
    expect(i, 'the fallback branch is gone').toBeGreaterThan(-1);
    const branch = EMAIL_SRC.slice(i, EMAIL_SRC.indexOf('\n  }', i));
    expect(branch, 'the production refusal left the fallback branch')
      .toMatch(/return \{\s*success: false/);
  });
});
