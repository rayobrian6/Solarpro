// ============================================================================
// lib/normalizeDocumentLabel.ts — Human-readable document label normalization
//
// PURPOSE:
//   Converts raw file names, file_type values, and label strings from DB
//   into clean, homeowner-friendly display labels.
//
// USAGE:
//   import { normalizeDocumentLabel } from '@/lib/normalizeDocumentLabel';
//   normalizeDocumentLabel('utility_bill')  // → "Utility Bill"
//   normalizeDocumentLabel('roof-1.jpg')    // → "Roof Photos"
//   normalizeDocumentLabel('main_panel')    // → "Main Panel Photos"
// ============================================================================

// Known label mappings — checked against lowercased, underscore-normalized input
const LABEL_MAP: Array<[RegExp, string]> = [
  [/\butility[_\s-]?bill\b/i,       'Utility Bill'],
  [/\bbill\b/i,                      'Utility Bill'],
  [/\butility[_\s-]?bill[_\s-]?summary\b/i, 'Utility Bill'],
  [/\bclient[_\s-]?profile\b/i,      'Client Profile'],
  [/\bmain[_\s-]?panel\b/i,          'Main Panel Photos'],
  [/\broof\b/i,                      'Roof Photos'],
  [/\bsite[_\s-]?survey\b/i,         'Site Survey Photos'],
  [/\bsite[_\s-]?survey[_\s-]?photo\b/i, 'Site Survey Photos'],
  [/\bphoto\b/i,                     'Site Survey Photos'],
  [/\bmeter\b/i,                     'Meter Photos'],
  [/\battic\b/i,                     'Attic Photos'],
  [/\bexterior\b/i,                  'Exterior Photos'],
  [/\bpanel\b/i,                     'Panel Photos'],
  [/\bpermit\b/i,                    'Permit Document'],
  [/\bproposal\b/i,                  'Proposal'],
  [/\bcontract\b/i,                  'Contract'],
  [/\bdesign\b/i,                    'System Design'],
  [/\bengineering\b/i,               'Engineering Report'],
  [/\binspection\b/i,                'Inspection Report'],
];

/**
 * normalizeDocumentLabel — converts a raw file name/label to a
 * homeowner-friendly display string.
 *
 * @param raw  Raw label from DB (file_name, label, file_type, etc.)
 * @returns    Clean, title-cased human-readable string
 */
export function normalizeDocumentLabel(raw: string | null | undefined): string {
  if (!raw || !raw.trim()) return 'Document';

  const input = raw.trim();

  // Check known mappings
  for (const [pattern, label] of LABEL_MAP) {
    if (pattern.test(input)) return label;
  }

  // Fallback: title-case the string, remove underscores/hyphens/extensions
  return input
    .replace(/\.[^.]+$/, '')          // remove file extension
    .replace(/[_\-]+/g, ' ')          // underscores/hyphens → spaces
    .replace(/\s+/g, ' ')             // collapse whitespace
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase()); // title case
}