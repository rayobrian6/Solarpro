/**
 * Bearer auth for SolarPro's Render vision services (SAM2 + MiDaS, and the
 * OpenCV photo-vision worker).
 *
 * Those services now refuse every request except their health probe unless it
 * carries `Authorization: Bearer <VISION_SERVICE_TOKEN>` (see
 * sam2-service/service_auth.py). Every server-side call to them goes through
 * `withVisionServiceAuth` — the one place the header is attached — so a new
 * call site cannot forget it (tests/visionServiceCallsCarryAuth.test.ts
 * checks every fetch in these clients).
 *
 * Server-only: the token must never reach a browser bundle.
 *
 * With the token unset the header is simply omitted and the service answers
 * 401 ("service authentication is not configured" / "missing bearer token");
 * the existing unavailable / fallback paths in each client handle that the
 * same way they handle any other refusal.
 */

export const VISION_SERVICE_TOKEN_ENV = 'VISION_SERVICE_TOKEN';

export function visionServiceToken(): string | null {
  const raw = process.env[VISION_SERVICE_TOKEN_ENV];
  const token = typeof raw === 'string' ? raw.trim() : '';
  return token ? token : null;
}

/** `init` with the vision-service bearer attached (other headers kept). */
export function withVisionServiceAuth(init: RequestInit = {}): RequestInit {
  const token = visionServiceToken();
  if (!token) return init;
  const headers = new Headers(init.headers ?? undefined);
  headers.set('Authorization', `Bearer ${token}`);
  return { ...init, headers };
}
