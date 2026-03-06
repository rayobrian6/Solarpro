/**
 * BUILD VERSION - Single source of truth for all version badges
 * Auto-increment BUILD_VERSION by 0.1 on every commit push
 */
export const BUILD_VERSION = 'v24.5';
export const BUILD_DATE = '2026-03-06';
export const BUILD_DESCRIPTION = 'NEC CONDUCTOR SIZING ENGINE';
export const BUILD_FEATURES = [
  'NEC 310.15 conductor ampacity',
  'NEC Chapter 9 conduit sizing',
  'Battery to Backup Interface computed wire',
  'Generator to ATS computed wire',
  '120% rule with battery backfeed',
  'IQ SC3 dual-mode ATS handling'
] as const;

export function getBuildBadge(): string {
  return `BUILD ${BUILD_VERSION} — ${BUILD_DESCRIPTION}`;
}