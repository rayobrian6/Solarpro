/**
 * @vitest-environment jsdom
 *
 * tests/mfaRedirectStaysOnSite.test.tsx
 *
 * The MFA challenge page assigned `?redirect=` straight to
 * window.location.href after a successful verification, so a phishing link to
 * /auth/mfa?redirect=https://evil.example delivered a freshly-verified user
 * to the attacker (and `javascript:` URLs ran on our origin). It now goes
 * through lib/safeRedirect.ts, the same rule the login page uses.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const params = vi.hoisted(() => ({ value: new URLSearchParams() }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => params.value,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import MFAChallengePage from '@/app/auth/mfa/page';

let assigned: string[] = [];
const realLocation = window.location;

beforeEach(() => {
  assigned = [];
  // jsdom cannot navigate; capture what the page assigns instead.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      ...realLocation,
      set href(v: string) { assigned.push(v); },
      get href() { return 'http://localhost/auth/mfa'; },
    },
  });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 })));
});
afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
  vi.unstubAllGlobals();
});

async function verifyWith(redirect: string) {
  params.value = new URLSearchParams({ method: 'totp', redirect });
  render(<MFAChallengePage />);
  const input = await screen.findByPlaceholderText('000000');
  fireEvent.change(input, { target: { value: '123456' } });
  fireEvent.submit(input.closest('form')!);
  await waitFor(() => expect(assigned.length).toBeGreaterThan(0));
  return assigned[assigned.length - 1];
}

describe('🚨 MFA success never leaves the site', () => {
  it.each([
    'https://evil.example/phish',
    '//evil.example/phish',
    'javascript:alert(document.cookie)',
    '/\\evil.example',
  ])('?redirect=%s lands on /dashboard', async (hostile) => {
    expect(await verifyWith(hostile)).toBe('/dashboard');
  });

  it('a same-site path is honoured', async () => {
    expect(await verifyWith('/projects/abc?tab=design')).toBe('/projects/abc?tab=design');
  });
});
