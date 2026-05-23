import type { OpenSourceToolLicensePosture } from './openSourceToolTypes';

const APPROVED_LICENSES = new Set(['MIT', 'APACHE-2.0', 'BSD-2-CLAUSE', 'BSD-3-CLAUSE', 'ISC']);
const CAUTION_LICENSES = new Set(['MPL-2.0', 'LGPL-2.1', 'LGPL-3.0']);
const BLOCKED_LICENSES = new Set(['GPL', 'GPL-2.0', 'GPL-3.0', 'AGPL', 'AGPL-3.0', 'SSPL', 'UNKNOWN', 'UNLICENSED', 'NON-COMMERCIAL', 'RESEARCH-ONLY']);

export function normalizeLicense(license: string): string {
  return license.trim().toUpperCase();
}

export function classifyLicensePosture(license: string): OpenSourceToolLicensePosture {
  const normalized = normalizeLicense(license);
  if (!normalized) return 'blocked';
  if (APPROVED_LICENSES.has(normalized)) return 'approved';
  if (CAUTION_LICENSES.has(normalized)) return 'caution';
  if (BLOCKED_LICENSES.has(normalized)) return 'blocked';
  if (normalized.includes('AGPL') || normalized.includes('GPL') || normalized.includes('UNKNOWN')) return 'blocked';
  if (normalized.includes('NON-COMMERCIAL') || normalized.includes('RESEARCH')) return 'blocked';
  return 'caution';
}

export function licenseIsBlocked(license: string): boolean {
  return classifyLicensePosture(license) === 'blocked';
}
