import re

with open('lib/utility-rules.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the position right after getAllUtilityNames function closing brace
# and before the Method Labels comment
target = 'export function getAllUtilityNames(): string[] {\n  return Object.values(UTILITY_REGISTRY).map(u => u.name).sort();\n}'

rate_validation_code = '''
// ── Rate Validation ───────────────────────────────────────────────────────────
// Known retail rates by utility registry id.
// These are the RETAIL rates customers pay — NOT avoided cost / wholesale rates.
const UTILITY_RETAIL_RATES: Record<string, number> = {
  'pge':                   0.32,  // PG&E CA
  'sce':                   0.28,  // SCE CA
  'fpl':                   0.13,  // FPL FL
  'duke':                  0.13,  // Duke Energy
  'pseg':                  0.17,  // PSEG NJ
  'comed':                 0.13,  // ComEd IL
  'ameren':                0.12,  // Ameren IL
  'swec-il':               0.12,  // Southwestern Electric Cooperative IL
  'tri-county-il':         0.12,  // Tri-County Electric IL
  'corn-belt-il':          0.12,  // Corn Belt Energy IL
  'eastern-illini-il':     0.12,  // Eastern Illini Electric IL
  'coles-moultrie-il':     0.12,  // Coles-Moultrie Electric IL
  'egyptian-il':           0.12,  // Egyptian Electric IL
  'menard-il':             0.12,  // Menard Electric IL
  'monroe-county-il':      0.12,  // Monroe County Electric IL
  'norris-il':             0.12,  // Norris Electric IL
  'shelby-il':             0.12,  // Shelby Electric IL
  'spoon-river-il':        0.12,  // Spoon River Electric IL
  'western-illinois-il':   0.12,  // Western Illinois Electrical IL
};

// Minimum plausible retail electricity rate.
// Anything below this is likely an avoided cost / wholesale credit rate, NOT retail.
const MIN_VALID_RETAIL_RATE = 0.07; // $/kWh

/**
 * Validate and correct an extracted electricity rate.
 * If the extracted rate is below MIN_VALID_RETAIL_RATE (e.g. $0.038 avoided cost),
 * look up the utility\'s known retail rate and return that instead.
 */
export function validateAndCorrectUtilityRate(
  extractedRate: number | null | undefined,
  utilityName: string | null | undefined,
): {
  rate: number;
  corrected: boolean;
  originalRate: number | null;
  source: \'extracted\' | \'utility_db\' | \'national_default\';
} {
  const original = extractedRate ?? null;

  // If extracted rate looks valid, use it as-is
  if (extractedRate && extractedRate >= MIN_VALID_RETAIL_RATE) {
    return { rate: extractedRate, corrected: false, originalRate: original, source: \'extracted\' };
  }

  // Rate is missing or suspiciously low — look up utility DB
  if (utilityName) {
    const utilityEntry = getUtilityRules(utilityName);
    const utilityId = utilityEntry?.id;
    if (utilityId && UTILITY_RETAIL_RATES[utilityId]) {
      return {
        rate: UTILITY_RETAIL_RATES[utilityId],
        corrected: true,
        originalRate: original,
        source: \'utility_db\',
      };
    }
  }

  // Fall back to national average
  return {
    rate: 0.13,
    corrected: true,
    originalRate: original,
    source: \'national_default\',
  };
}

/**
 * Check if a system size exceeds the utility\'s net metering cap.
 * Returns a warning string if exceeded, null otherwise.
 */
export function checkNetMeteringLimit(
  systemKw: number,
  utilityName: string | null | undefined,
): string | null {
  if (!utilityName) return null;
  const utility = getUtilityRules(utilityName);
  if (!utility || utility.id === \'default\') return null;
  if (systemKw > utility.netMeteringMaxKw) {
    return `System size (${systemKw.toFixed(1)} kW) exceeds ${utility.name}\'s net metering cap of ${utility.netMeteringMaxKw} kW. Confirm interconnection rules before proceeding.`;
  }
  return null;
}

/**
 * Get the production factor (kWh/kW/year) for a utility\'s location.
 * Used for system sizing: system_kw = annual_kwh / production_factor
 */
export function getProductionFactor(utilityName: string | null | undefined): number {
  if (!utilityName) return 1250;
  const utility = getUtilityRules(utilityName);
  if (!utility || utility.id === \'default\') return 1250;
  if (utility.states.includes(\'IL\')) return 1280;
  if (utility.states.includes(\'CA\')) return 1600;
  if (utility.states.includes(\'FL\')) return 1500;
  if (utility.states.includes(\'NJ\') || utility.states.includes(\'NY\')) return 1100;
  return 1250;
}
'''

if target in content:
    new_content = content.replace(target, target + '\n' + rate_validation_code)
    with open('lib/utility-rules.ts', 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("SUCCESS: Rate validation functions added to utility-rules.ts")
else:
    print("ERROR: Target string not found")
    # Try to find it
    idx = content.find('getAllUtilityNames')
    print(f"getAllUtilityNames found at index: {idx}")
    print(repr(content[idx:idx+100]))