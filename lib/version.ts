/**
 * BUILD VERSION - Single source of truth for all version badges
 * Auto-increment BUILD_VERSION by 0.1 on every commit push
 */
export const BUILD_VERSION = 'v28.4';
export const BUILD_DATE = '2026-03-07';
export const BUILD_DESCRIPTION = 'FREE PASS + AUTH FIXES';
export const BUILD_FEATURES = [
  'FIXED: useSubscription hook — correctly unwraps /api/auth/me { data: {...} } response',
  'FIXED: billing/page.tsx — correctly unwraps nested API response, no more login redirect',
  'FIXED: AppShell trial redirect — free_pass users never redirected to /subscribe',
  'FIXED: checkAccess — free_pass status always returns allowed=true regardless of isFreePass flag',
  'FIXED: AppShell isFreePass detection — also checks subscriptionStatus === free_pass',
  'NEW: /api/admin/free-pass — grant/revoke/list free passes by email with admin secret',
  'NEW: /api/admin/free-pass added to middleware PUBLIC_PATHS',
] as const;

export function getBuildBadge(): string {
  return `BUILD ${BUILD_VERSION} — ${BUILD_DESCRIPTION}`;
}