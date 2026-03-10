/**
 * BUILD VERSION - Single source of truth for all version badges
 * Auto-increment BUILD_VERSION by 0.1 on every commit push
 */
export const BUILD_VERSION = 'v24.8';
export const BUILD_DATE = '2026-03-09';
export const BUILD_DESCRIPTION = 'ENGINEERING ENGINE HYDRATION FROM BILL SEED';
export const BUILD_FEATURES = [
  'Engineering seed now includes synthetic_layout + synthetic_eng_config',
  'Preliminary endpoint saves full PlacedPanel[] + eng config into seed JSONB',
  'Engineering page fully hydrates from seed: inverters, panels, strings, tilt, azimuth',
  'synthetic_eng_config drives exact inverterId, panelId, wireGauge, conduitType',
  'Utility matched by name from seed.utility + seed.state_code',
  'runCalc() auto-triggered 300ms after seed hydration',
  'Banner shows only after real engine state is initialized',
  'Debug logging: seed, synthetic_layout, synthetic_eng_config, patches, project',
  'EngineeringSeed type extended: tilt, azimuth, client_name, service_address, synthetic_layout, synthetic_eng_config',
] as const;

export function getBuildBadge(): string {
  return `BUILD ${BUILD_VERSION} — ${BUILD_DESCRIPTION}`;
}