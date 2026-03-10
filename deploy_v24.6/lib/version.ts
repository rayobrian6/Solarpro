/**
 * BUILD VERSION - Single source of truth for all version badges
 * Auto-increment BUILD_VERSION by 0.1 on every commit push
 */
export const BUILD_VERSION = 'v24.7';
export const BUILD_DATE = '2026-03-08';
export const BUILD_DESCRIPTION = 'ENGINEERING SEED PROPAGATION';
export const BUILD_FEATURES = [
  'Engineering seed generated from bill upload',
  'Seed stored as JSONB on project record',
  'Engineering page auto-populates from seed',
  'Proposals page uses seed as fallback data',
  'Synthetic layout + production from bill data',
  'Migration 009: projects.engineering_seed column'
] as const;

export function getBuildBadge(): string {
  return `BUILD ${BUILD_VERSION} — ${BUILD_DESCRIPTION}`;
}