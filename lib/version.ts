/**
 * BUILD VERSION - Single source of truth for all version badges
 * Auto-increment BUILD_VERSION by 0.1 on every commit push
 */
export const BUILD_VERSION = 'v28.2';
export const BUILD_DATE = '2026-03-07';
export const BUILD_DESCRIPTION = 'PLAN GATING + TRIAL EXPIRATION';
export const BUILD_FEATURES = [
  'PlanGate component — reusable feature lock screen with upgrade CTA',
  'Engineering page gated — requires Professional plan',
  'Proposals page — Starter gets preview-only (no generate, no PDF download)',
  'Projects page — Starter limited to 2 projects with upgrade prompt',
  'Clients page — Starter limited to 5 clients with upgrade prompt',
  'Trial expiration redirect — expired users redirected to /subscribe',
  'Subscribe page — expired=1 banner for redirected users',
  'UpgradeModal integrated across all gated pages',
] as const;

export function getBuildBadge(): string {
  return `BUILD ${BUILD_VERSION} — ${BUILD_DESCRIPTION}`;
}