/**
 * Where may /api/auth/authorize deliver a freshly minted SSO token?
 *
 * The token is a 10-minute bearer credential for the signed-in user, sent to
 * the caller-supplied `redirect_uri`. Anything this list admits can receive a
 * user's sign-in.
 *
 *   · Default: the production app's own scheme, `sitesurvey://`, only.
 *   · AUTHORIZE_ALLOWED_REDIRECTS (comma-separated prefixes) replaces the
 *     default, with two kinds of entry refused because they admit hosts an
 *     attacker controls:
 *       - a bare `exp://` / `exps://` — Expo Go's shared scheme, ANY host: a
 *         logged-in user who opened a crafted link handed their token to an
 *         attacker's Expo project;
 *       - any `exp(s)://u.expo.dev…` entry — Expo's shared EAS-update host,
 *         where anyone can publish an update and get a matching URL.
 *     A specific development host (e.g. `exp://192.168.1.20:8081`) is still
 *     admitted when an operator lists it.
 *
 * Previously the default admitted bare `exp://` and the bare prefix
 * `com.underthesun.`; the app's Expo Go testing against production relied on
 * it. Expo Go cannot be made safe by prefix, so that workflow should use a
 * development build with the `sitesurvey://` scheme.
 */

export const DEFAULT_ALLOWED_REDIRECT_PREFIXES: readonly string[] = Object.freeze(['sitesurvey://']);

const SHARED_EXPO = /^exps?:\/\/(u\.expo\.dev(?=[/:?#]|$)|$)/i;

export interface AllowedRedirectPrefixes {
  allowed: string[];
  /** Entries refused because they admit attacker-controlled hosts. */
  ignored: string[];
}

export function parseAllowedRedirectPrefixes(envValue: string | null | undefined): AllowedRedirectPrefixes {
  const raw = (envValue ?? '').trim();
  const entries = raw
    ? raw.split(',').map(s => s.trim()).filter(s => s.length > 0)
    : [...DEFAULT_ALLOWED_REDIRECT_PREFIXES];
  const allowed: string[] = [];
  const ignored: string[] = [];
  for (const e of entries) {
    if (SHARED_EXPO.test(e)) ignored.push(e);
    else allowed.push(e);
  }
  return { allowed, ignored };
}

/** Exact prefix match — never a substring match (https://evil/sitesurvey:// must fail). */
export function isRedirectAllowed(redirectUri: string, allowed: readonly string[]): boolean {
  if (!redirectUri) return false;
  return allowed.some(prefix => redirectUri.startsWith(prefix));
}
