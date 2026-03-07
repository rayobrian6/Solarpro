/**
 * BUILD VERSION - Single source of truth for all version badges
 * Auto-increment BUILD_VERSION by 0.1 on every commit push
 */
export const BUILD_VERSION = 'v27.7';
export const BUILD_DATE = '2026-03-07';
export const BUILD_DESCRIPTION = 'EQUIPMENT LIBRARY REFACTOR';
export const BUILD_FEATURES = [
  'Hardware Config → Equipment Library rebrand',
  'Removed Pricing tab from Hardware Config',
  'Added user equipment persistence with autosave',
  'Added Edit, Duplicate, Disable, Datasheet buttons to equipment cards',
  'Batteries tab added to Equipment Library',
  'New equipment types: SolarPanel, Inverter, Battery, MountingSystem',
  'Database migration for user_equipment_* tables',
  'Equipment save API with debounce autosave',
  'Default equipment library + user custom equipment merge pattern',
] as const;

export function getBuildBadge(): string {
  return `BUILD ${BUILD_VERSION} — ${BUILD_DESCRIPTION}`;
}