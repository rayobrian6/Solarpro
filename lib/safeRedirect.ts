/**
 * Post-authentication redirect authority — the one answer to "may the browser
 * be sent to this `?redirect=` value?".
 *
 * The login page had its own prefix checks; the MFA challenge page had none and
 * assigned `searchParams.get('redirect')` straight to `window.location.href`,
 * so `/auth/mfa?redirect=https://evil.example` (or `javascript:...`) sent a
 * freshly MFA-verified user wherever the link said.
 *
 * Prefix checks are not enough on their own: the browser's URL parser strips
 * tabs/newlines and treats `\` as `/`, so `/\t/evil.com` and `/\evil.com`
 * both become `//evil.com`. So the value is resolved with the same WHATWG
 * parser the browser uses, against a fixed placeholder origin, and accepted
 * only if it stays on that origin. What comes back is the normalised
 * path + query + hash — never the raw input.
 */

const PLACEHOLDER_ORIGIN = 'https://same-origin.invalid';

export function safeRelativeRedirect(raw: string | null | undefined, fallback = '/dashboard'): string {
  if (typeof raw !== 'string' || raw.length === 0) return fallback;
  // Must be written as a same-site path; anything else (a scheme, a bare
  // host, a protocol-relative URL) is refused before parsing.
  if (!raw.startsWith('/')) return fallback;
  let url: URL;
  try {
    url = new URL(raw, PLACEHOLDER_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}
