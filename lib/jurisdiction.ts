// ============================================================
// Jurisdiction Logic Engine
// NEC adoption by state + local amendments
// ============================================================

export interface JurisdictionInfo {
  state: string;
  stateCode: string;
  county?: string;
  necVersion: '2014' | '2017' | '2020' | '2023';
  necAdoptionYear: number;
  localAmendments: LocalAmendment[];
  utilityRules: UtilityRule[];
  specialRequirements: string[];
  ahj: string; // Authority Having Jurisdiction description
  permitNotes: string;
}

export interface LocalAmendment {
  code: string;
  description: string;
  impact: 'electrical' | 'structural' | 'fire' | 'administrative';
  severity: 'required' | 'modified' | 'exempted';
}

export interface UtilityRule {
  rule: string;
  description: string;
  requirement: string;
}

// NEC adoption by state (as of 2024)
// Source: NFPA NEC adoption map
const STATE_NEC_ADOPTION: Record<string, { nec: '2014' | '2017' | '2020' | '2023'; year: number; notes: string }> = {
  AL: { nec: '2020', year: 2023, notes: 'Alabama adopted NEC 2020' },
  AK: { nec: '2020', year: 2022, notes: 'Alaska adopted NEC 2020' },
  AZ: { nec: '2017', year: 2019, notes: 'Arizona adopted NEC 2017; some counties on 2020' },
  AR: { nec: '2020', year: 2023, notes: 'Arkansas adopted NEC 2020' },
  CA: { nec: '2022', year: 2023, notes: 'California uses Title 24 (based on NEC 2020 with CA amendments)' } as any,
  CO: { nec: '2020', year: 2021, notes: 'Colorado adopted NEC 2020' },
  CT: { nec: '2020', year: 2022, notes: 'Connecticut adopted NEC 2020' },
  DE: { nec: '2020', year: 2022, notes: 'Delaware adopted NEC 2020' },
  FL: { nec: '2020', year: 2023, notes: 'Florida adopted NEC 2020 with Florida Building Code amendments' },
  GA: { nec: '2020', year: 2023, notes: 'Georgia adopted NEC 2020' },
  HI: { nec: '2020', year: 2022, notes: 'Hawaii adopted NEC 2020' },
  ID: { nec: '2017', year: 2019, notes: 'Idaho adopted NEC 2017' },
  IL: { nec: '2020', year: 2023, notes: 'Illinois adopted NEC 2020' },
  IN: { nec: '2020', year: 2022, notes: 'Indiana adopted NEC 2020' },
  IA: { nec: '2020', year: 2022, notes: 'Iowa adopted NEC 2020' },
  KS: { nec: '2020', year: 2023, notes: 'Kansas adopted NEC 2020' },
  KY: { nec: '2017', year: 2019, notes: 'Kentucky adopted NEC 2017' },
  LA: { nec: '2020', year: 2023, notes: 'Louisiana adopted NEC 2020' },
  ME: { nec: '2020', year: 2022, notes: 'Maine adopted NEC 2020' },
  MD: { nec: '2020', year: 2022, notes: 'Maryland adopted NEC 2020' },
  MA: { nec: '2020', year: 2023, notes: 'Massachusetts adopted NEC 2020 with MA amendments' },
  MI: { nec: '2017', year: 2019, notes: 'Michigan adopted NEC 2017' },
  MN: { nec: '2020', year: 2023, notes: 'Minnesota adopted NEC 2020' },
  MS: { nec: '2020', year: 2023, notes: 'Mississippi adopted NEC 2020' },
  MO: { nec: '2017', year: 2019, notes: 'Missouri adopted NEC 2017; local jurisdictions vary' },
  MT: { nec: '2020', year: 2022, notes: 'Montana adopted NEC 2020' },
  NE: { nec: '2020', year: 2023, notes: 'Nebraska adopted NEC 2020' },
  NV: { nec: '2020', year: 2022, notes: 'Nevada adopted NEC 2020' },
  NH: { nec: '2020', year: 2022, notes: 'New Hampshire adopted NEC 2020' },
  NJ: { nec: '2017', year: 2019, notes: 'New Jersey adopted NEC 2017 with NJ amendments' },
  NM: { nec: '2020', year: 2022, notes: 'New Mexico adopted NEC 2020' },
  NY: { nec: '2020', year: 2022, notes: 'New York adopted NEC 2020 with NY amendments' },
  NC: { nec: '2020', year: 2023, notes: 'North Carolina adopted NEC 2020' },
  ND: { nec: '2020', year: 2022, notes: 'North Dakota adopted NEC 2020' },
  OH: { nec: '2017', year: 2019, notes: 'Ohio adopted NEC 2017' },
  OK: { nec: '2020', year: 2023, notes: 'Oklahoma adopted NEC 2020' },
  OR: { nec: '2020', year: 2022, notes: 'Oregon adopted NEC 2020 with Oregon amendments' },
  PA: { nec: '2017', year: 2019, notes: 'Pennsylvania adopted NEC 2017; Philadelphia on 2020' },
  RI: { nec: '2020', year: 2022, notes: 'Rhode Island adopted NEC 2020' },
  SC: { nec: '2020', year: 2023, notes: 'South Carolina adopted NEC 2020' },
  SD: { nec: '2020', year: 2022, notes: 'South Dakota adopted NEC 2020' },
  TN: { nec: '2020', year: 2023, notes: 'Tennessee adopted NEC 2020' },
  TX: { nec: '2020', year: 2023, notes: 'Texas adopted NEC 2020; local jurisdictions may vary' },
  UT: { nec: '2020', year: 2022, notes: 'Utah adopted NEC 2020' },
  VT: { nec: '2020', year: 2022, notes: 'Vermont adopted NEC 2020' },
  VA: { nec: '2020', year: 2022, notes: 'Virginia adopted NEC 2020' },
  WA: { nec: '2020', year: 2022, notes: 'Washington adopted NEC 2020 with WA amendments' },
  WV: { nec: '2017', year: 2019, notes: 'West Virginia adopted NEC 2017' },
  WI: { nec: '2017', year: 2019, notes: 'Wisconsin adopted NEC 2017' },
  WY: { nec: '2020', year: 2022, notes: 'Wyoming adopted NEC 2020' },
  DC: { nec: '2020', year: 2022, notes: 'Washington DC adopted NEC 2020' },
};

// State-specific solar amendments and requirements
const STATE_SOLAR_AMENDMENTS: Record<string, LocalAmendment[]> = {
  CA: [
    { code: 'CA-690-1', description: 'California Title 24 Part 3 — NEC 2020 with CA amendments', impact: 'electrical', severity: 'required' },
    { code: 'CA-RSP', description: 'Rapid Shutdown required for all rooftop PV (690.12)', impact: 'fire', severity: 'required' },
    { code: 'CA-AFCI', description: 'Arc Fault Circuit Interrupter required for PV systems', impact: 'electrical', severity: 'required' },
    { code: 'CA-GFDI', description: 'Ground Fault Detection and Interruption required', impact: 'electrical', severity: 'required' },
    { code: 'CA-SOLAR-MANDATE', description: 'New residential construction requires solar PV (Title 24 2020)', impact: 'administrative', severity: 'required' },
  ],
  FL: [
    { code: 'FL-FBC', description: 'Florida Building Code 7th Edition solar provisions apply', impact: 'structural', severity: 'required' },
    { code: 'FL-WIND', description: 'High wind zone requirements — ASCE 7-22 wind speeds apply', impact: 'structural', severity: 'required' },
    { code: 'FL-HURRICANE', description: 'Hurricane impact requirements for coastal counties', impact: 'structural', severity: 'required' },
  ],
  TX: [
    { code: 'TX-LOCAL', description: 'Texas has no statewide building code — local jurisdictions govern', impact: 'administrative', severity: 'required' },
    { code: 'TX-ERCOT', description: 'ERCOT interconnection rules apply for most of Texas', impact: 'electrical', severity: 'required' },
  ],
  NY: [
    { code: 'NY-ECCC', description: 'New York Energy Conservation Construction Code applies', impact: 'electrical', severity: 'required' },
    { code: 'NY-FIRE', description: 'NYC Fire Code Chapter 38 for NYC installations', impact: 'fire', severity: 'required' },
    { code: 'NY-SETBACK', description: 'NYC requires 18" setback from roof edges and ridges', impact: 'fire', severity: 'required' },
  ],
  MA: [
    { code: 'MA-527', description: '527 CMR 12.00 Massachusetts Electrical Code (NEC 2020 + MA amendments)', impact: 'electrical', severity: 'required' },
    { code: 'MA-RSP', description: 'Rapid Shutdown required per 527 CMR', impact: 'fire', severity: 'required' },
  ],
  NJ: [
    { code: 'NJ-UNIFORM', description: 'NJ Uniform Construction Code applies', impact: 'administrative', severity: 'required' },
    { code: 'NJ-SREC', description: 'NJ SREC-II program registration required for incentives', impact: 'administrative', severity: 'required' },
  ],
  AZ: [
    { code: 'AZ-ACC', description: 'Arizona Administrative Code R14-2-101 governs PV installations', impact: 'electrical', severity: 'required' },
  ],
  CO: [
    { code: 'CO-WILDFIRE', description: 'Wildfire mitigation requirements in WUI zones', impact: 'fire', severity: 'required' },
  ],
  HI: [
    { code: 'HI-HECO', description: 'HECO/MECO/HELCO interconnection rules apply', impact: 'electrical', severity: 'required' },
    { code: 'HI-SMART', description: 'Smart Export Guarantee program requirements', impact: 'administrative', severity: 'required' },
  ],
};

// Common utility interconnection rules
const UTILITY_RULES: Record<string, UtilityRule[]> = {
  DEFAULT: [
    { rule: 'IEEE 1547', description: 'Standard for Interconnection of Distributed Energy Resources', requirement: 'All grid-tied inverters must be IEEE 1547 compliant' },
    { rule: 'UL 1741', description: 'Inverter, Converter, Controller and Interconnection System Equipment', requirement: 'All inverters must be UL 1741 listed' },
    { rule: 'NET-METERING', description: 'Net metering agreement required', requirement: 'Submit interconnection application to utility before energizing' },
    { rule: 'ANTI-ISLANDING', description: 'Anti-islanding protection required', requirement: 'Inverter must have certified anti-islanding protection' },
  ],
  CA: [
    { rule: 'RULE-21', description: 'California Rule 21 Smart Inverter requirements', requirement: 'All inverters must meet Rule 21 advanced functions (Volt-VAR, Freq-Watt, etc.)' },
    { rule: 'NEM-3', description: 'Net Energy Metering 3.0 (NEM-3)', requirement: 'New systems interconnected after April 2023 fall under NEM-3 tariff' },
  ],
  TX: [
    { rule: 'ERCOT-DG', description: 'ERCOT Distributed Generation Interconnection', requirement: 'Systems >10kW require ERCOT interconnection study' },
  ],
  NY: [
    { rule: 'CON-ED-DG', description: 'Con Edison Distributed Generation requirements (NYC)', requirement: 'Pre-application required for systems >25kW' },
    { rule: 'VDER', description: 'Value of Distributed Energy Resources tariff', requirement: 'VDER compensation applies to new NY systems' },
  ],
  HI: [
    { rule: 'HECO-DG', description: 'HECO Distributed Generation Interconnection', requirement: 'Smart Export program enrollment required' },
  ],
};

// Parse state code from address string
export function parseStateFromAddress(address: string): string {
  if (!address) return 'UNKNOWN';

  // Try to match state abbreviation (2 capital letters before zip or at end)
  const stateMatch = address.match(/\b([A-Z]{2})\b(?:\s+\d{5})?/g);
  if (stateMatch) {
    // Find the last 2-letter match that's a valid state
    for (let i = stateMatch.length - 1; i >= 0; i--) {
      const candidate = stateMatch[i].trim().replace(/\s+\d{5}/, '').trim();
      if (STATE_NEC_ADOPTION[candidate]) return candidate;
    }
  }

  // Try full state names
  const stateNames: Record<string, string> = {
    'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR',
    'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE',
    'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
    'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS',
    'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
    'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS',
    'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV',
    'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
    'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK',
    'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
    'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT',
    'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV',
    'wisconsin': 'WI', 'wyoming': 'WY', 'district of columbia': 'DC',
  };

  const lower = address.toLowerCase();
  for (const [name, code] of Object.entries(stateNames)) {
    if (lower.includes(name)) return code;
  }

  return 'UNKNOWN';
}

export function getJurisdictionInfo(address: string, county?: string): JurisdictionInfo {
  const stateCode = parseStateFromAddress(address);
  const stateData = STATE_NEC_ADOPTION[stateCode];

  if (!stateData) {
    return {
      state: 'Unknown',
      stateCode: 'UNKNOWN',
      county,
      necVersion: '2020',
      necAdoptionYear: 2023,
      localAmendments: [],
      utilityRules: UTILITY_RULES.DEFAULT,
      specialRequirements: ['Verify NEC version with local AHJ before permit submission'],
      ahj: 'Unknown — verify with local building department',
      permitNotes: 'Could not determine jurisdiction. Please verify NEC version and local requirements with the AHJ.',
    };
  }

  const amendments = STATE_SOLAR_AMENDMENTS[stateCode] || [];
  const utilityRules = [
    ...UTILITY_RULES.DEFAULT,
    ...(UTILITY_RULES[stateCode] || []),
  ];

  const specialRequirements: string[] = [];

  // NEC 2017+ rapid shutdown
  if (stateData.nec === '2017' || stateData.nec === '2020' || stateData.nec === '2023') {
    specialRequirements.push('Rapid Shutdown required per NEC 690.12 (module-level, within 30 seconds)');
  }

  // State-specific requirements
  if (stateCode === 'CA') {
    specialRequirements.push('California Title 24 compliance required');
    specialRequirements.push('Smart inverter functions required (Rule 21)');
    specialRequirements.push('NEM-3 tariff applies to new interconnections (post April 2023)');
  }
  if (stateCode === 'FL') {
    specialRequirements.push('Florida Building Code 7th Edition structural requirements');
    specialRequirements.push('High wind zone — verify ASCE 7-22 wind speed for county');
  }
  if (stateCode === 'HI') {
    specialRequirements.push('HECO Smart Export program enrollment required');
  }
  if (stateCode === 'NY') {
    specialRequirements.push('NYC: 18" setback from roof edges required (Fire Code)');
  }
  if (stateCode === 'NJ') {
    specialRequirements.push('NJ SREC-II registration required for incentives');
  }

  // Determine AHJ description
  const ahjDescriptions: Record<string, string> = {
    CA: 'Local Building Department (city/county) + California Energy Commission',
    FL: 'Local Building Department + Florida Building Commission',
    TX: 'Local Building Department (no statewide code)',
    NY: 'Local Building Department + NYC DOB (for NYC)',
    NJ: 'Local Construction Official + NJ DCA',
    MA: 'Local Building Department + MA Board of State Examiners of Electricians',
    DEFAULT: 'Local Building Department',
  };

  const permitNotes = [
    `${stateData.notes}.`,
    `Permit required from local building department.`,
    `Electrical permit required — licensed electrician may be required depending on jurisdiction.`,
    `Utility interconnection application required before energizing.`,
  ].join(' ');

  return {
    state: getStateName(stateCode),
    stateCode,
    county,
    necVersion: stateData.nec as '2014' | '2017' | '2020' | '2023',
    necAdoptionYear: stateData.year,
    localAmendments: amendments,
    utilityRules,
    specialRequirements,
    ahj: ahjDescriptions[stateCode] || ahjDescriptions.DEFAULT,
    permitNotes,
  };
}

function getStateName(code: string): string {
  const names: Record<string, string> = {
    AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas',
    CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
    FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho',
    IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
    KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
    MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
    MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
    NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
    NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
    OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
    SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
    VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia',
    WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia',
  };
  return names[code] || code;
}

// Get design temperatures for a state (ASHRAE 99.6% heating design dry-bulb temp)
//
// SOURCE:
// All minTemp values are sourced from the ASHRAE 2005 Handbook of Fundamentals,
// "Climatic Design Conditions" table, 99.6% annual cumulative frequency of
// occurrence (cold conditions), dry-bulb temperature.
//
// Primary reference: FGIA "ASHRAE 99.6% HDB Temperature (°F) — Major U.S.
// Cities and State Capitals" (2025), extracted from the 2005 ASHRAE HoF via
// WMO observing stations.
// URL: https://fgiaonline.org/wp-content/uploads/2025/02/ASHRAE-Temperatures-for-Major-US-Cities.pdf
//
// Secondary reference for county-level verification: RESNET "Design Temperature
// Limits by State and County" Appendix A (2018/2019).
// URL: https://www.resnet.us/wp-content/uploads/Appendix-A-HVAC-Design-Temperature-Limits-v4-2019-09-27_Clean.pdf
//
// METHODOLOGY:
// For NEC 690.7 cold-Voc string sizing, we use the COLDEST city in each state
// from the ASHRAE table, then apply a conservative 1-2 degree C rounding toward colder.
// This ensures string Voc never exceeds the inverter's max DC input voltage
// anywhere in the state, per NEC 690.7(A) requirements.
//
// minTemp values are in degrees C. Conversion: C = (F - 32) * 5/9
//
// maxTemp values (summer design temps) are ASHRAE 0.4% cooling dry-bulb from
// the same source, used for derate/clamp calculations (NEC 310.15).
//
// STATE-BY-STATE SOURCES:
// AK: Anchorage  -10.7F = -23.7C -> -24C  (Juneau 3.4F is warmer)
// HI: Honolulu    60.8F =  16.0C -> +16C  (prior value of 60 was F stored in C field)
// FL: Tallahassee 24.9F =  -3.9C ->  -4C  (Jacksonville 28.6F, Tallahassee colder)
// AZ: Tucson      31.6F =  -0.2C ->   0C  (Phoenix 37.2F; Tucson is colder)
// TX: Lubbock     12.6F = -10.8C -> -11C  (coldest TX city; Dallas 19.9F, Austin 25.7F)
// CA: Bakersfield 32.4F =   0.2C ->  -1C  (coldest CA inland; LA 43.9F, SF 37.8F)
// CO: Denver      -4.0F = -20.0C -> -21C  (Aurora -1.1F; Denver is colder)
// MN: Minneapolis -14.9F = -26.1C -> -27C  (= St. Paul; coldest MN city in table)
// ND: Bismarck   -20.8F = -29.3C -> -30C  (only ND city; -30 is slightly conservative)
// SD: Pierre     -13.3F = -25.2C -> -26C
// MT: Helena     -17.1F = -27.3C -> -28C
// WY: Cheyenne    -6.2F = -21.2C -> -22C
// ID: Boise        1.6F = -16.9C -> -18C  (conservative rounding)
// NV: Las Vegas   28.9F =  -1.7C ->  -2C  (only NV city in ASHRAE table)
// UT: Salt Lake City 7.0F = -13.9C -> -15C  (conservative rounding)
// NM: Santa Fe     0.5F = -17.5C -> -18C  (colder than Albuquerque 15.9F)
// WA: Olympia     18.0F =  -7.8C ->  -9C  (colder than Seattle 23.8F)
// OR: Portland    21.9F =  -5.6C ->  -7C  (Salem 20.5F similar; Portland used)
// NY: Albany      -2.9F = -19.4C -> -20C  (coldest NY; Buffalo 2.2F, NYC 12.8F)
// MA: Boston       7.7F = -13.5C -> -14C
// NJ: Trenton     10.1F = -12.2C -> -13C  (Newark 10.3F; Trenton slightly colder)
// PA: Pittsburgh   1.8F = -16.8C -> -17C  (coldest PA; Harrisburg 8.3F, Philly 11.6F)
// OH: Toledo      -1.8F = -18.8C -> -19C  (coldest OH; Akron 0.1F, Cleveland 1.0F)
// MI: Lansing     -3.5F = -19.7C -> -21C  (coldest MI; Detroit 0.2F)
// WI: Wausau     -13.0F = -25.0C -> -25C  (coldest WI; Madison -10.3F, MKE -5.2F)
// IL: Chicago     -5.0F = -20.6C -> -21C  (coldest IL; Springfield -3.3F)
// IN: Fort Wayne  -3.6F = -19.8C -> -20C  (colder than Indianapolis -1.8F)
// GA: Atlanta     18.8F =  -7.3C ->  -8C
// NC: Greensboro  15.0F =  -9.4C -> -10C  (coldest NC; Charlotte 19.0F)
// SC: Columbia    20.8F =  -6.2C ->  -7C
// VA: Richmond    14.7F =  -9.6C -> -10C  (colder than Norfolk 20.4F)
// MD: Baltimore   12.3F = -10.9C -> -11C
// KY: Lexington    4.5F = -15.3C -> -16C  (Frankfort listed as "see Lexington")
// WV: Charleston   6.7F = -13.9C -> -14C
// TN: Nashville   11.6F = -11.3C -> -12C  (colder than Memphis 16.8F)
// AR: Little Rock 16.9F =  -8.4C ->  -9C
// LA: Baton Rouge 27.0F =  -2.8C ->  -3C  (New Orleans 30.6F is warmer)
// MS: Jackson     21.1F =  -6.1C ->  -7C
// AL: Birmingham  18.6F =  -7.4C ->  -8C
// OK: Tulsa        9.4F = -12.0C -> -13C  (Tulsa slightly colder than OKC 10.3F)
// KS: Topeka      -1.6F = -18.7C -> -19C  (colder than Wichita 2.6F)
// MO: Kansas City -2.1F = -19.0C -> -20C  (KC coldest; Jeff City -0.3F, StL 2.0F)
// IA: Des Moines  -7.8F = -22.1C -> -23C  (conservative rounding)
// NE: Omaha       -8.1F = -22.3C -> -23C  (colder than Lincoln -6.3F)
// CT: Hartford     2.9F = -16.2C -> -17C
// NH: Concord     -6.2F = -21.2C -> -22C
// VT: Montpelier -10.1F = -23.4C -> -24C
// ME: Augusta     -3.4F = -19.7C -> -20C
// RI: Providence   6.1F = -14.4C -> -15C  (conservative rounding)
// DE: Dover       13.8F = -10.1C -> -11C
// DC: Washington  15.9F =  -8.9C ->  -9C
export function getDesignTemperatures(stateCode: string): { minTemp: number; maxTemp: number } {
  const temps: Record<string, { minTemp: number; maxTemp: number }> = {
    // Extreme cold
    AK: { minTemp: -24, maxTemp:  75 },   // Anchorage -10.7F = -23.7C
    ND: { minTemp: -30, maxTemp:  90 },   // Bismarck -20.8F = -29.3C
    MN: { minTemp: -27, maxTemp:  90 },   // Minneapolis -14.9F = -26.1C
    MT: { minTemp: -28, maxTemp:  95 },   // Helena -17.1F = -27.3C
    WI: { minTemp: -25, maxTemp:  90 },   // Wausau -13.0F = -25.0C
    SD: { minTemp: -26, maxTemp:  95 },   // Pierre -13.3F = -25.2C
    WY: { minTemp: -22, maxTemp:  95 },   // Cheyenne -6.2F = -21.2C
    NH: { minTemp: -22, maxTemp:  90 },   // Concord -6.2F = -21.2C
    VT: { minTemp: -24, maxTemp:  90 },   // Montpelier -10.1F = -23.4C
    // Very cold
    CO: { minTemp: -21, maxTemp:  95 },   // Denver -4.0F = -20.0C
    IL: { minTemp: -21, maxTemp:  95 },   // Chicago -5.0F = -20.6C
    MI: { minTemp: -21, maxTemp:  90 },   // Lansing -3.5F = -19.7C
    IN: { minTemp: -20, maxTemp:  90 },   // Fort Wayne -3.6F = -19.8C
    NY: { minTemp: -20, maxTemp:  90 },   // Albany -2.9F = -19.4C
    MO: { minTemp: -20, maxTemp:  95 },   // Kansas City -2.1F = -19.0C
    OH: { minTemp: -19, maxTemp:  90 },   // Toledo -1.8F = -18.8C
    KS: { minTemp: -19, maxTemp: 100 },   // Topeka -1.6F = -18.7C
    NM: { minTemp: -18, maxTemp: 105 },   // Santa Fe 0.5F = -17.5C
    ID: { minTemp: -18, maxTemp: 100 },   // Boise 1.6F = -16.9C
    // Cold
    IA: { minTemp: -23, maxTemp:  90 },   // Des Moines -7.8F = -22.1C
    NE: { minTemp: -23, maxTemp:  95 },   // Omaha -8.1F = -22.3C
    ME: { minTemp: -20, maxTemp:  90 },   // Augusta -3.4F = -19.7C
    PA: { minTemp: -17, maxTemp:  90 },   // Pittsburgh 1.8F = -16.8C
    CT: { minTemp: -17, maxTemp:  90 },   // Hartford 2.9F = -16.2C
    KY: { minTemp: -16, maxTemp:  90 },   // Lexington 4.5F = -15.3C
    UT: { minTemp: -15, maxTemp: 100 },   // Salt Lake City 7.0F = -13.9C
    RI: { minTemp: -15, maxTemp:  90 },   // Providence 6.1F = -14.4C
    MA: { minTemp: -14, maxTemp:  90 },   // Boston 7.7F = -13.5C
    WV: { minTemp: -14, maxTemp:  90 },   // Charleston 6.7F = -13.9C
    NJ: { minTemp: -13, maxTemp:  90 },   // Trenton 10.1F = -12.2C
    OK: { minTemp: -13, maxTemp: 100 },   // Tulsa 9.4F = -12.0C
    TN: { minTemp: -12, maxTemp:  95 },   // Nashville 11.6F = -11.3C
    TX: { minTemp: -11, maxTemp: 105 },   // Lubbock 12.6F = -10.8C
    DE: { minTemp: -11, maxTemp:  90 },   // Dover 13.8F = -10.1C
    MD: { minTemp: -11, maxTemp:  90 },   // Baltimore 12.3F = -10.9C
    // Moderate
    VA: { minTemp: -10, maxTemp:  90 },   // Richmond 14.7F = -9.6C
    NC: { minTemp: -10, maxTemp:  95 },   // Greensboro 15.0F = -9.4C
    DC: { minTemp:  -9, maxTemp:  90 },   // Washington DC 15.9F = -8.9C
    AR: { minTemp:  -9, maxTemp:  95 },   // Little Rock 16.9F = -8.4C
    WA: { minTemp:  -9, maxTemp:  95 },   // Olympia 18.0F = -7.8C
    GA: { minTemp:  -8, maxTemp:  95 },   // Atlanta 18.8F = -7.3C
    AL: { minTemp:  -8, maxTemp:  95 },   // Birmingham 18.6F = -7.4C
    OR: { minTemp:  -7, maxTemp: 100 },   // Portland 21.9F = -5.6C
    MS: { minTemp:  -7, maxTemp:  95 },   // Jackson 21.1F = -6.1C
    SC: { minTemp:  -7, maxTemp:  95 },   // Columbia 20.8F = -6.2C
    // Mild
    LA: { minTemp:  -3, maxTemp:  95 },   // Baton Rouge 27.0F = -2.8C
    NV: { minTemp:  -2, maxTemp: 110 },   // Las Vegas 28.9F = -1.7C
    CA: { minTemp:  -1, maxTemp: 105 },   // Bakersfield 32.4F = 0.2C (coldest CA city)
    AZ: { minTemp:   0, maxTemp: 110 },   // Tucson 31.6F = -0.2C (colder than Phoenix)
    FL: { minTemp:  -4, maxTemp:  95 },   // Tallahassee 24.9F = -3.9C
    // Tropical
    HI: { minTemp:  16, maxTemp:  90 },   // Honolulu 60.8F = 16.0C (prior 60 was F value in C field)
    // Fallback
    DEFAULT: { minTemp: -10, maxTemp: 95 },
  };
  const entry = temps[stateCode] || temps.DEFAULT;
  // BUG FIX: the maxTemp values above are ASHRAE 0.4% cooling dry-bulb in °F
  // (e.g. IL 95°F), but every downstream consumer treats designTempMax as °C
  // (NEC 310.15 conductor derating, 690.8 Isc correction). Treating 95°F as 95°C
  // pushed the temp-derating factor to its worst-case (~0.41) and false-failed AC
  // feeder sizing (#2/0 reading 71.8A). Convert °F → °C here so the ambient is
  // correct. minTemp is already stored in °C (see header comment) — left as-is.
  return { minTemp: entry.minTemp, maxTemp: Math.round((entry.maxTemp - 32) * 5 / 9) };
}

// Get ground snow load for a state (simplified — actual values from ASCE 7 maps)
export function getGroundSnowLoad(stateCode: string): number {
  const snowLoads: Record<string, number> = {
    AK: 100, HI: 0, FL: 0, TX: 5, CA: 10, AZ: 5,
    CO: 50, MN: 50, ND: 50, SD: 40, MT: 50, WY: 50,
    ID: 40, NV: 15, UT: 40, NM: 20, WA: 25, OR: 25,
    NY: 40, MA: 40, NJ: 25, PA: 30, OH: 25, MI: 40,
    WI: 40, IL: 25, IN: 25, GA: 5, NC: 15, SC: 5,
    VA: 20, MD: 20, DEFAULT: 20,
  };
  return snowLoads[stateCode] || snowLoads.DEFAULT;
}

// Get design wind speed for a state (mph, ASCE 7-22 Risk Category II)
export function getDesignWindSpeed(stateCode: string): number {
  const windSpeeds: Record<string, number> = {
    FL: 160, HI: 130, TX: 130, LA: 140, MS: 140, AL: 130,
    GA: 120, SC: 130, NC: 130, VA: 115, MD: 115, DE: 115,
    NJ: 115, NY: 115, CT: 115, RI: 120, MA: 120, NH: 110,
    ME: 110, VT: 105, PA: 110, OH: 105, IN: 105, IL: 105,
    MI: 105, WI: 105, MN: 105, IA: 105, MO: 105, KY: 105,
    TN: 110, AR: 110, OK: 115, KS: 110, NE: 110, SD: 110,
    ND: 110, MT: 110, WY: 105, CO: 105, NM: 105, AZ: 100,
    UT: 100, NV: 100, ID: 100, WA: 110, OR: 110, CA: 110,
    AK: 110, DEFAULT: 115,
  };
  return windSpeeds[stateCode] || windSpeeds.DEFAULT;
}