/**
 * lib/jurisdictions/necVersions.ts
 * NEC version adoption by state + county overrides.
 * Data sourced from NFPA state adoption tracker (2024).
 */

export type NecVersion = '2017' | '2020' | '2023';

export interface JurisdictionData {
  stateCode: string;
  stateName: string;
  necVersion: NecVersion;
  // Special county/city overrides
  countyOverrides?: Record<string, NecVersion>;
  cityOverrides?: Record<string, NecVersion>;
  // Local amendments
  localAmendments: string[];
  // Permitting info
  permitRequired: boolean;
  permitAuthority: string;
  typicalPermitFee: string;
  typicalPermitDays: number;
  // Inspection requirements
  inspectionRequired: boolean;
  inspectionAuthority: string;
  // Special requirements
  specialRequirements: string[];
  // Utility interconnection
  interconnectionAuthority: string;
  interconnectionDays: number;
  // Fire setbacks (inches)
  roofSetbackInches: number;
  ridgeSetbackInches: number;
  // Rapid shutdown
  rapidShutdownRequired: boolean;
  rapidShutdownStandard: string;
}

export const JURISDICTION_DATA: Record<string, JurisdictionData> = {
  AL: {
    stateCode: 'AL', stateName: 'Alabama', necVersion: '2020',
    localAmendments: ['Alabama amendments to NEC 2020'],
    permitRequired: true, permitAuthority: 'Local Building Department',
    typicalPermitFee: '$150–$500', typicalPermitDays: 5,
    inspectionRequired: true, inspectionAuthority: 'Local Building Inspector',
    specialRequirements: ['Utility approval required before interconnection'],
    interconnectionAuthority: 'Alabama Power / Local Utility', interconnectionDays: 30,
    roofSetbackInches: 36, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2020)',
  },
  AK: {
    stateCode: 'AK', stateName: 'Alaska', necVersion: '2020',
    localAmendments: ['Alaska Fire Marshal amendments'],
    permitRequired: true, permitAuthority: 'Local Municipality',
    typicalPermitFee: '$200–$600', typicalPermitDays: 10,
    inspectionRequired: true, inspectionAuthority: 'State Fire Marshal / Local',
    specialRequirements: ['Snow load calculations required', 'Wind uplift calculations required'],
    interconnectionAuthority: 'Local Utility', interconnectionDays: 45,
    roofSetbackInches: 36, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2020)',
  },
  AZ: {
    stateCode: 'AZ', stateName: 'Arizona', necVersion: '2017',
    countyOverrides: { 'Maricopa': '2020', 'Pima': '2020', 'Pinal': '2017' },
    cityOverrides: { 'Phoenix': '2020', 'Tucson': '2020', 'Scottsdale': '2020', 'Mesa': '2020', 'Chandler': '2020' },
    localAmendments: ['Arizona does not adopt statewide — varies by jurisdiction'],
    permitRequired: true, permitAuthority: 'Local Building Department',
    typicalPermitFee: '$100–$400', typicalPermitDays: 3,
    inspectionRequired: true, inspectionAuthority: 'Local Building Inspector',
    specialRequirements: ['APS/SRP interconnection application required', 'HOA approval may be required'],
    interconnectionAuthority: 'APS / SRP / TEP', interconnectionDays: 20,
    roofSetbackInches: 18, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2017)',
  },
  AR: {
    stateCode: 'AR', stateName: 'Arkansas', necVersion: '2020',
    localAmendments: [],
    permitRequired: true, permitAuthority: 'Local Building Department',
    typicalPermitFee: '$100–$350', typicalPermitDays: 7,
    inspectionRequired: true, inspectionAuthority: 'Local Building Inspector',
    specialRequirements: [],
    interconnectionAuthority: 'Entergy Arkansas / Local Utility', interconnectionDays: 30,
    roofSetbackInches: 36, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2020)',
  },
  CA: {
    stateCode: 'CA', stateName: 'California', necVersion: '2023',
    localAmendments: ['Title 24 California Energy Code', 'CALGreen mandatory', 'CPUC Rule 21 interconnection'],
    permitRequired: true, permitAuthority: 'Local Building Department (AHJ)',
    typicalPermitFee: '$200–$800', typicalPermitDays: 3,
    inspectionRequired: true, inspectionAuthority: 'Local Building Inspector',
    specialRequirements: [
      'Title 24 compliance required',
      'CPUC Rule 21 interconnection for IOU territories',
      'NEM 3.0 applies for PG&E/SCE/SDG&E',
      'Fire setbacks per CAL FIRE requirements',
      'Seismic zone considerations',
    ],
    interconnectionAuthority: 'PG&E / SCE / SDG&E / LADWP', interconnectionDays: 15,
    roofSetbackInches: 36, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2023)',
  },
  CO: {
    stateCode: 'CO', stateName: 'Colorado', necVersion: '2020',
    cityOverrides: { 'Denver': '2020', 'Boulder': '2023', 'Fort Collins': '2020' },
    localAmendments: ['Colorado Solar Access Law protections'],
    permitRequired: true, permitAuthority: 'Local Building Department',
    typicalPermitFee: '$150–$500', typicalPermitDays: 5,
    inspectionRequired: true, inspectionAuthority: 'Local Building Inspector',
    specialRequirements: ['Wind/snow load calculations for mountain areas', 'HOA cannot prohibit solar'],
    interconnectionAuthority: 'Xcel Energy / Black Hills', interconnectionDays: 25,
    roofSetbackInches: 36, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2020)',
  },
  CT: {
    stateCode: 'CT', stateName: 'Connecticut', necVersion: '2020',
    localAmendments: ['Connecticut Supplement to NEC'],
    permitRequired: true, permitAuthority: 'Local Building Official',
    typicalPermitFee: '$200–$600', typicalPermitDays: 7,
    inspectionRequired: true, inspectionAuthority: 'Local Electrical Inspector',
    specialRequirements: ['Eversource/UI interconnection application', 'PURA approval for larger systems'],
    interconnectionAuthority: 'Eversource / UI', interconnectionDays: 30,
    roofSetbackInches: 36, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2020)',
  },
  DE: {
    stateCode: 'DE', stateName: 'Delaware', necVersion: '2020',
    localAmendments: [],
    permitRequired: true, permitAuthority: 'DEDO / Local Building Department',
    typicalPermitFee: '$150–$400', typicalPermitDays: 7,
    inspectionRequired: true, inspectionAuthority: 'State / Local Inspector',
    specialRequirements: [],
    interconnectionAuthority: 'Delmarva Power / Delaware Electric Coop', interconnectionDays: 30,
    roofSetbackInches: 36, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2020)',
  },
  FL: {
    stateCode: 'FL', stateName: 'Florida', necVersion: '2020',
    localAmendments: ['Florida Building Code (FBC) — Energy', 'High-velocity hurricane zone requirements'],
    permitRequired: true, permitAuthority: 'Local Building Department',
    typicalPermitFee: '$150–$600', typicalPermitDays: 5,
    inspectionRequired: true, inspectionAuthority: 'Local Building Inspector',
    specialRequirements: [
      'Florida Building Code compliance required',
      'Wind uplift calculations required (HVHZ in Miami-Dade/Broward)',
      'FPL/Duke interconnection application',
    ],
    interconnectionAuthority: 'FPL / Duke Energy Florida / Tampa Electric', interconnectionDays: 20,
    roofSetbackInches: 36, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2020)',
  },
  GA: {
    stateCode: 'GA', stateName: 'Georgia', necVersion: '2020',
    localAmendments: [],
    permitRequired: true, permitAuthority: 'Local Building Department',
    typicalPermitFee: '$100–$400', typicalPermitDays: 7,
    inspectionRequired: true, inspectionAuthority: 'Local Building Inspector',
    specialRequirements: ['Georgia Power interconnection application required'],
    interconnectionAuthority: 'Georgia Power / Local EMC', interconnectionDays: 30,
    roofSetbackInches: 36, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2020)',
  },
  HI: {
    stateCode: 'HI', stateName: 'Hawaii', necVersion: '2020',
    localAmendments: ['Hawaii amendments to NEC', 'HECO interconnection rules'],
    permitRequired: true, permitAuthority: 'County Building Department',
    typicalPermitFee: '$300–$900', typicalPermitDays: 14,
    inspectionRequired: true, inspectionAuthority: 'County Building Inspector',
    specialRequirements: [
      'HECO Customer Self-Supply (CSS) program',
      'Grid export may be restricted',
      'Hurricane strapping requirements',
    ],
    interconnectionAuthority: 'Hawaiian Electric / HELCO / KIUC', interconnectionDays: 45,
    roofSetbackInches: 36, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2020)',
  },
  ID: {
    stateCode: 'ID', stateName: 'Idaho', necVersion: '2017',
    localAmendments: [],
    permitRequired: true, permitAuthority: 'Local Building Department',
    typicalPermitFee: '$100–$350', typicalPermitDays: 5,
    inspectionRequired: true, inspectionAuthority: 'Local Building Inspector',
    specialRequirements: ['Snow load calculations required in northern Idaho'],
    interconnectionAuthority: 'Idaho Power / Rocky Mountain Power', interconnectionDays: 30,
    roofSetbackInches: 36, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2017)',
  },
  IL: {
    stateCode: 'IL', stateName: 'Illinois', necVersion: '2020',
    cityOverrides: { 'Chicago': '2017' },
    localAmendments: ['Illinois Commerce Commission rules', 'Chicago has own electrical code'],
    permitRequired: true, permitAuthority: 'Local Building Department',
    typicalPermitFee: '$150–$500', typicalPermitDays: 7,
    inspectionRequired: true, inspectionAuthority: 'Local Electrical Inspector',
    specialRequirements: ['ComEd/Ameren interconnection application', 'Illinois Shines SREC program'],
    interconnectionAuthority: 'ComEd / Ameren Illinois', interconnectionDays: 30,
    roofSetbackInches: 36, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2020)',
  },
  IN: {
    stateCode: 'IN', stateName: 'Indiana', necVersion: '2020',
    localAmendments: [],
    permitRequired: true, permitAuthority: 'Local Building Department',
    typicalPermitFee: '$100–$400', typicalPermitDays: 7,
    inspectionRequired: true, inspectionAuthority: 'Local Building Inspector',
    specialRequirements: [],
    interconnectionAuthority: 'Duke Energy Indiana / AES Indiana', interconnectionDays: 30,
    roofSetbackInches: 36, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2020)',
  },
  IA: {
    stateCode: 'IA', stateName: 'Iowa', necVersion: '2020',
    localAmendments: [],
    permitRequired: true, permitAuthority: 'Local Building Department',
    typicalPermitFee: '$100–$350', typicalPermitDays: 7,
    inspectionRequired: true, inspectionAuthority: 'Local Building Inspector',
    specialRequirements: [],
    interconnectionAuthority: 'MidAmerican Energy / Alliant Energy', interconnectionDays: 30,
    roofSetbackInches: 36, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2020)',
  },
  KS: {
    stateCode: 'KS', stateName: 'Kansas', necVersion: '2020',
    localAmendments: [],
    permitRequired: true, permitAuthority: 'Local Building Department',
    typicalPermitFee: '$100–$350', typicalPermitDays: 7,
    inspectionRequired: true, inspectionAuthority: 'Local Building Inspector',
    specialRequirements: ['Wind load calculations required (tornado zone)'],
    interconnectionAuthority: 'Evergy / Westar Energy', interconnectionDays: 30,
    roofSetbackInches: 36, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2020)',
  },
  KY: {
    stateCode: 'KY', stateName: 'Kentucky', necVersion: '2020',
    localAmendments: [],
    permitRequired: true, permitAuthority: 'Local Building Department',
    typicalPermitFee: '$100–$350', typicalPermitDays: 7,
    inspectionRequired: true, inspectionAuthority: 'Local Building Inspector',
    specialRequirements: [],
    interconnectionAuthority: 'LG&E / KU / Duke Energy Kentucky', interconnectionDays: 30,
    roofSetbackInches: 36, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2020)',
  },
  LA: {
    stateCode: 'LA', stateName: 'Louisiana', necVersion: '2020',
    localAmendments: [],
    permitRequired: true, permitAuthority: 'Local Building Department',
    typicalPermitFee: '$100–$400', typicalPermitDays: 7,
    inspectionRequired: true, inspectionAuthority: 'Local Building Inspector',
    specialRequirements: ['Hurricane wind load calculations required'],
    interconnectionAuthority: 'Entergy Louisiana / Cleco', interconnectionDays: 30,
    roofSetbackInches: 36, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2020)',
  },
  ME: {
    stateCode: 'ME', stateName: 'Maine', necVersion: '2020',
    localAmendments: [],
    permitRequired: true, permitAuthority: 'Local Building Department',
    typicalPermitFee: '$150–$500', typicalPermitDays: 10,
    inspectionRequired: true, inspectionAuthority: 'Local Electrical Inspector',
    specialRequirements: ['Snow load calculations required'],
    interconnectionAuthority: 'Central Maine Power / Versant Power', interconnectionDays: 30,
    roofSetbackInches: 36, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2020)',
  },
  MD: {
    stateCode: 'MD', stateName: 'Maryland', necVersion: '2020',
    localAmendments: ['Maryland Home Improvement Commission requirements'],
    permitRequired: true, permitAuthority: 'Local Building Department',
    typicalPermitFee: '$150–$500', typicalPermitDays: 7,
    inspectionRequired: true, inspectionAuthority: 'Local Building Inspector',
    specialRequirements: ['SREC market active', 'BGE/Pepco interconnection application'],
    interconnectionAuthority: 'BGE / Pepco / Delmarva Power', interconnectionDays: 25,
    roofSetbackInches: 36, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2020)',
  },
  MA: {
    stateCode: 'MA', stateName: 'Massachusetts', necVersion: '2020',
    localAmendments: ['527 CMR Massachusetts Electrical Code', 'SREC II / SMART program'],
    permitRequired: true, permitAuthority: 'Local Building Department',
    typicalPermitFee: '$200–$700', typicalPermitDays: 7,
    inspectionRequired: true, inspectionAuthority: 'Local Wiring Inspector',
    specialRequirements: [
      'MA Electrical Code 527 CMR compliance',
      'SMART program incentive application',
      'Eversource/National Grid interconnection',
    ],
    interconnectionAuthority: 'Eversource / National Grid', interconnectionDays: 30,
    roofSetbackInches: 36, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2020)',
  },
  MI: {
    stateCode: 'MI', stateName: 'Michigan', necVersion: '2020',
    localAmendments: [],
    permitRequired: true, permitAuthority: 'Local Building Department',
    typicalPermitFee: '$150–$500', typicalPermitDays: 7,
    inspectionRequired: true, inspectionAuthority: 'Local Electrical Inspector',
    specialRequirements: ['DTE/Consumers Energy interconnection application'],
    interconnectionAuthority: 'DTE Energy / Consumers Energy', interconnectionDays: 30,
    roofSetbackInches: 36, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2020)',
  },
  MN: {
    stateCode: 'MN', stateName: 'Minnesota', necVersion: '2020',
    localAmendments: ['Minnesota State Building Code'],
    permitRequired: true, permitAuthority: 'Local Building Department',
    typicalPermitFee: '$150–$500', typicalPermitDays: 7,
    inspectionRequired: true, inspectionAuthority: 'Local Building Inspector',
    specialRequirements: ['Snow load calculations required', 'Xcel Energy interconnection'],
    interconnectionAuthority: 'Xcel Energy / Minnesota Power', interconnectionDays: 30,
    roofSetbackInches: 36, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2020)',
  },
  MS: {
    stateCode: 'MS', stateName: 'Mississippi', necVersion: '2020',
    localAmendments: [],
    permitRequired: true, permitAuthority: 'Local Building Department',
    typicalPermitFee: '$100–$350', typicalPermitDays: 7,
    inspectionRequired: true, inspectionAuthority: 'Local Building Inspector',
    specialRequirements: [],
    interconnectionAuthority: 'Entergy Mississippi / Mississippi Power', interconnectionDays: 30,
    roofSetbackInches: 36, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2020)',
  },
  MO: {
    stateCode: 'MO', stateName: 'Missouri', necVersion: '2020',
    localAmendments: [],
    permitRequired: true, permitAuthority: 'Local Building Department',
    typicalPermitFee: '$100–$400', typicalPermitDays: 7,
    inspectionRequired: true, inspectionAuthority: 'Local Building Inspector',
    specialRequirements: [],
    interconnectionAuthority: 'Ameren Missouri / Evergy', interconnectionDays: 30,
    roofSetbackInches: 36, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2020)',
  },
  MT: {
    stateCode: 'MT', stateName: 'Montana', necVersion: '2017',
    localAmendments: [],
    permitRequired: true, permitAuthority: 'Local Building Department',
    typicalPermitFee: '$100–$350', typicalPermitDays: 10,
    inspectionRequired: true, inspectionAuthority: 'Local Building Inspector',
    specialRequirements: ['Snow load calculations required'],
    interconnectionAuthority: 'NorthWestern Energy', interconnectionDays: 30,
    roofSetbackInches: 36, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2017)',
  },
  NE: {
    stateCode: 'NE', stateName: 'Nebraska', necVersion: '2020',
    localAmendments: [],
    permitRequired: true, permitAuthority: 'Local Building Department',
    typicalPermitFee: '$100–$350', typicalPermitDays: 7,
    inspectionRequired: true, inspectionAuthority: 'Local Building Inspector',
    specialRequirements: [],
    interconnectionAuthority: 'OPPD / LES / NPPD', interconnectionDays: 30,
    roofSetbackInches: 36, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2020)',
  },
  NV: {
    stateCode: 'NV', stateName: 'Nevada', necVersion: '2020',
    localAmendments: [],
    permitRequired: true, permitAuthority: 'Local Building Department',
    typicalPermitFee: '$150–$500', typicalPermitDays: 5,
    inspectionRequired: true, inspectionAuthority: 'Local Building Inspector',
    specialRequirements: ['NV Energy interconnection application', 'NEM 3.0 applies'],
    interconnectionAuthority: 'NV Energy', interconnectionDays: 20,
    roofSetbackInches: 18, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2020)',
  },
  NH: {
    stateCode: 'NH', stateName: 'New Hampshire', necVersion: '2020',
    localAmendments: [],
    permitRequired: true, permitAuthority: 'Local Building Department',
    typicalPermitFee: '$150–$500', typicalPermitDays: 10,
    inspectionRequired: true, inspectionAuthority: 'Local Electrical Inspector',
    specialRequirements: ['Snow load calculations required'],
    interconnectionAuthority: 'Eversource NH / Unitil', interconnectionDays: 30,
    roofSetbackInches: 36, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2020)',
  },
  NJ: {
    stateCode: 'NJ', stateName: 'New Jersey', necVersion: '2017',
    localAmendments: ['NJ Uniform Construction Code (UCC)', 'SREC market active'],
    permitRequired: true, permitAuthority: 'Local Construction Official',
    typicalPermitFee: '$200–$700', typicalPermitDays: 10,
    inspectionRequired: true, inspectionAuthority: 'Local Electrical Sub-Code Official',
    specialRequirements: [
      'NJ UCC compliance required',
      'SREC-II / TRECs program',
      'PSE&G/JCP&L interconnection application',
    ],
    interconnectionAuthority: 'PSE&G / JCP&L / Atlantic City Electric', interconnectionDays: 30,
    roofSetbackInches: 36, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2017)',
  },
  NM: {
    stateCode: 'NM', stateName: 'New Mexico', necVersion: '2020',
    localAmendments: [],
    permitRequired: true, permitAuthority: 'Local Building Department',
    typicalPermitFee: '$100–$400', typicalPermitDays: 7,
    inspectionRequired: true, inspectionAuthority: 'Local Building Inspector',
    specialRequirements: [],
    interconnectionAuthority: 'PNM / El Paso Electric', interconnectionDays: 30,
    roofSetbackInches: 18, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2020)',
  },
  NY: {
    stateCode: 'NY', stateName: 'New York', necVersion: '2020',
    cityOverrides: { 'New York City': '2017' },
    localAmendments: ['NY State Uniform Fire Prevention and Building Code', 'NYC has own electrical code'],
    permitRequired: true, permitAuthority: 'Local Building Department',
    typicalPermitFee: '$200–$800', typicalPermitDays: 10,
    inspectionRequired: true, inspectionAuthority: 'Local Electrical Inspector',
    specialRequirements: [
      'VDER (Value of Distributed Energy Resources) tariff',
      'Con Edison / National Grid interconnection',
      'NY-Sun incentive program',
    ],
    interconnectionAuthority: 'Con Edison / National Grid / NYSEG', interconnectionDays: 30,
    roofSetbackInches: 36, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2020)',
  },
  NC: {
    stateCode: 'NC', stateName: 'North Carolina', necVersion: '2020',
    localAmendments: ['NC State Building Code'],
    permitRequired: true, permitAuthority: 'Local Building Department',
    typicalPermitFee: '$150–$500', typicalPermitDays: 7,
    inspectionRequired: true, inspectionAuthority: 'Local Building Inspector',
    specialRequirements: ['Duke Energy interconnection application', 'NC SREC market'],
    interconnectionAuthority: 'Duke Energy Carolinas / Duke Energy Progress', interconnectionDays: 25,
    roofSetbackInches: 36, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2020)',
  },
  ND: {
    stateCode: 'ND', stateName: 'North Dakota', necVersion: '2020',
    localAmendments: [],
    permitRequired: true, permitAuthority: 'Local Building Department',
    typicalPermitFee: '$100–$350', typicalPermitDays: 7,
    inspectionRequired: true, inspectionAuthority: 'Local Building Inspector',
    specialRequirements: ['Snow load calculations required'],
    interconnectionAuthority: 'Xcel Energy / Montana-Dakota Utilities', interconnectionDays: 30,
    roofSetbackInches: 36, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2020)',
  },
  OH: {
    stateCode: 'OH', stateName: 'Ohio', necVersion: '2020',
    localAmendments: ['Ohio Building Code'],
    permitRequired: true, permitAuthority: 'Local Building Department',
    typicalPermitFee: '$150–$500', typicalPermitDays: 7,
    inspectionRequired: true, inspectionAuthority: 'Local Building Inspector',
    specialRequirements: ['AEP/FirstEnergy interconnection application'],
    interconnectionAuthority: 'AEP Ohio / FirstEnergy / Duke Energy Ohio', interconnectionDays: 30,
    roofSetbackInches: 36, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2020)',
  },
  OK: {
    stateCode: 'OK', stateName: 'Oklahoma', necVersion: '2020',
    localAmendments: [],
    permitRequired: true, permitAuthority: 'Local Building Department',
    typicalPermitFee: '$100–$350', typicalPermitDays: 7,
    inspectionRequired: true, inspectionAuthority: 'Local Building Inspector',
    specialRequirements: ['Wind load calculations required (tornado alley)'],
    interconnectionAuthority: 'OG&E / PSO', interconnectionDays: 30,
    roofSetbackInches: 36, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2020)',
  },
  OR: {
    stateCode: 'OR', stateName: 'Oregon', necVersion: '2020',
    localAmendments: ['Oregon Residential Specialty Code'],
    permitRequired: true, permitAuthority: 'Local Building Department',
    typicalPermitFee: '$150–$500', typicalPermitDays: 7,
    inspectionRequired: true, inspectionAuthority: 'Local Electrical Inspector',
    specialRequirements: ['PGE/Pacific Power interconnection application'],
    interconnectionAuthority: 'Portland General Electric / Pacific Power', interconnectionDays: 30,
    roofSetbackInches: 36, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2020)',
  },
  PA: {
    stateCode: 'PA', stateName: 'Pennsylvania', necVersion: '2017',
    localAmendments: ['PA Uniform Construction Code (UCC)', 'SREC market active'],
    permitRequired: true, permitAuthority: 'Local Building Department',
    typicalPermitFee: '$150–$600', typicalPermitDays: 10,
    inspectionRequired: true, inspectionAuthority: 'Local Electrical Inspector',
    specialRequirements: ['PA UCC compliance', 'SREC market', 'PECO/PPL interconnection'],
    interconnectionAuthority: 'PECO / PPL / Duquesne Light', interconnectionDays: 30,
    roofSetbackInches: 36, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2017)',
  },
  RI: {
    stateCode: 'RI', stateName: 'Rhode Island', necVersion: '2020',
    localAmendments: [],
    permitRequired: true, permitAuthority: 'Local Building Department',
    typicalPermitFee: '$200–$600', typicalPermitDays: 7,
    inspectionRequired: true, inspectionAuthority: 'Local Electrical Inspector',
    specialRequirements: ['National Grid RI interconnection'],
    interconnectionAuthority: 'National Grid RI', interconnectionDays: 30,
    roofSetbackInches: 36, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2020)',
  },
  SC: {
    stateCode: 'SC', stateName: 'South Carolina', necVersion: '2020',
    localAmendments: [],
    permitRequired: true, permitAuthority: 'Local Building Department',
    typicalPermitFee: '$100–$400', typicalPermitDays: 7,
    inspectionRequired: true, inspectionAuthority: 'Local Building Inspector',
    specialRequirements: ['Duke Energy SC interconnection application'],
    interconnectionAuthority: 'Duke Energy SC / Dominion Energy SC', interconnectionDays: 30,
    roofSetbackInches: 36, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2020)',
  },
  SD: {
    stateCode: 'SD', stateName: 'South Dakota', necVersion: '2020',
    localAmendments: [],
    permitRequired: true, permitAuthority: 'Local Building Department',
    typicalPermitFee: '$100–$350', typicalPermitDays: 7,
    inspectionRequired: true, inspectionAuthority: 'Local Building Inspector',
    specialRequirements: ['Snow load calculations required'],
    interconnectionAuthority: 'Xcel Energy SD / Black Hills Energy', interconnectionDays: 30,
    roofSetbackInches: 36, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2020)',
  },
  TN: {
    stateCode: 'TN', stateName: 'Tennessee', necVersion: '2020',
    localAmendments: ['TVA Generation Partners program rules'],
    permitRequired: true, permitAuthority: 'Local Building Department',
    typicalPermitFee: '$100–$400', typicalPermitDays: 7,
    inspectionRequired: true, inspectionAuthority: 'Local Building Inspector',
    specialRequirements: ['TVA Generation Partners program', 'Local utility approval required'],
    interconnectionAuthority: 'TVA / Local Distributor', interconnectionDays: 30,
    roofSetbackInches: 36, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2020)',
  },
  TX: {
    stateCode: 'TX', stateName: 'Texas', necVersion: '2020',
    countyOverrides: { 'Harris': '2020', 'Dallas': '2020', 'Travis': '2020', 'Bexar': '2020' },
    cityOverrides: { 'Houston': '2020', 'Dallas': '2020', 'Austin': '2023', 'San Antonio': '2020', 'Fort Worth': '2020' },
    localAmendments: ['Texas does not adopt statewide — varies by municipality', 'Austin adopted NEC 2023'],
    permitRequired: true, permitAuthority: 'Local Building Department',
    typicalPermitFee: '$100–$500', typicalPermitDays: 5,
    inspectionRequired: true, inspectionAuthority: 'Local Building Inspector',
    specialRequirements: [
      'No statewide net metering mandate',
      'ERCOT grid (most of TX) — utility-specific rules',
      'Wind load calculations required',
    ],
    interconnectionAuthority: 'Oncor / CenterPoint / AEP Texas / Local Utility', interconnectionDays: 30,
    roofSetbackInches: 18, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2020)',
  },
  UT: {
    stateCode: 'UT', stateName: 'Utah', necVersion: '2020',
    localAmendments: [],
    permitRequired: true, permitAuthority: 'Local Building Department',
    typicalPermitFee: '$100–$400', typicalPermitDays: 5,
    inspectionRequired: true, inspectionAuthority: 'Local Building Inspector',
    specialRequirements: ['Rocky Mountain Power interconnection application'],
    interconnectionAuthority: 'Rocky Mountain Power', interconnectionDays: 25,
    roofSetbackInches: 18, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2020)',
  },
  VT: {
    stateCode: 'VT', stateName: 'Vermont', necVersion: '2020',
    localAmendments: ['Vermont Electrical Safety Rules'],
    permitRequired: true, permitAuthority: 'Local Building Department',
    typicalPermitFee: '$150–$500', typicalPermitDays: 10,
    inspectionRequired: true, inspectionAuthority: 'State Electrical Inspector',
    specialRequirements: ['Snow load calculations required', 'Green Mountain Power interconnection'],
    interconnectionAuthority: 'Green Mountain Power / Burlington Electric', interconnectionDays: 30,
    roofSetbackInches: 36, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2020)',
  },
  VA: {
    stateCode: 'VA', stateName: 'Virginia', necVersion: '2020',
    localAmendments: ['Virginia Uniform Statewide Building Code (USBC)'],
    permitRequired: true, permitAuthority: 'Local Building Department',
    typicalPermitFee: '$150–$500', typicalPermitDays: 7,
    inspectionRequired: true, inspectionAuthority: 'Local Building Inspector',
    specialRequirements: ['Dominion Energy interconnection application', 'SREC market'],
    interconnectionAuthority: 'Dominion Energy VA / Appalachian Power', interconnectionDays: 25,
    roofSetbackInches: 36, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2020)',
  },
  WA: {
    stateCode: 'WA', stateName: 'Washington', necVersion: '2020',
    localAmendments: ['Washington State Energy Code (WSEC)'],
    permitRequired: true, permitAuthority: 'Local Building Department',
    typicalPermitFee: '$150–$600', typicalPermitDays: 7,
    inspectionRequired: true, inspectionAuthority: 'Local Electrical Inspector',
    specialRequirements: ['Puget Sound Energy / Seattle City Light interconnection', 'Seismic zone considerations'],
    interconnectionAuthority: 'Puget Sound Energy / Seattle City Light', interconnectionDays: 30,
    roofSetbackInches: 36, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2020)',
  },
  WV: {
    stateCode: 'WV', stateName: 'West Virginia', necVersion: '2020',
    localAmendments: [],
    permitRequired: true, permitAuthority: 'Local Building Department',
    typicalPermitFee: '$100–$350', typicalPermitDays: 10,
    inspectionRequired: true, inspectionAuthority: 'Local Building Inspector',
    specialRequirements: [],
    interconnectionAuthority: 'Appalachian Power / Monongalia Power', interconnectionDays: 30,
    roofSetbackInches: 36, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2020)',
  },
  WI: {
    stateCode: 'WI', stateName: 'Wisconsin', necVersion: '2020',
    localAmendments: ['Wisconsin Commercial Building Code'],
    permitRequired: true, permitAuthority: 'Local Building Department',
    typicalPermitFee: '$150–$500', typicalPermitDays: 7,
    inspectionRequired: true, inspectionAuthority: 'Local Electrical Inspector',
    specialRequirements: ['Snow load calculations required', 'We Energies interconnection'],
    interconnectionAuthority: 'We Energies / WPS / Alliant Energy WI', interconnectionDays: 30,
    roofSetbackInches: 36, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2020)',
  },
  WY: {
    stateCode: 'WY', stateName: 'Wyoming', necVersion: '2017',
    localAmendments: [],
    permitRequired: true, permitAuthority: 'Local Building Department',
    typicalPermitFee: '$100–$350', typicalPermitDays: 10,
    inspectionRequired: true, inspectionAuthority: 'Local Building Inspector',
    specialRequirements: ['Wind load calculations required', 'Snow load calculations required'],
    interconnectionAuthority: 'Rocky Mountain Power / Black Hills Energy', interconnectionDays: 30,
    roofSetbackInches: 36, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2017)',
  },
  DC: {
    stateCode: 'DC', stateName: 'District of Columbia', necVersion: '2020',
    localAmendments: ['DC Construction Codes', 'SREC market active'],
    permitRequired: true, permitAuthority: 'DCRA (Dept of Consumer & Regulatory Affairs)',
    typicalPermitFee: '$200–$700', typicalPermitDays: 14,
    inspectionRequired: true, inspectionAuthority: 'DCRA Electrical Inspector',
    specialRequirements: ['SREC market', 'Pepco interconnection application'],
    interconnectionAuthority: 'Pepco', interconnectionDays: 30,
    roofSetbackInches: 36, ridgeSetbackInches: 18,
    rapidShutdownRequired: true, rapidShutdownStandard: 'NEC 690.12 (2020)',
  },
};

// ── Lookup function ───────────────────────────────────────────────────────────
export function getJurisdiction(
  stateCode: string,
  county?: string,
  city?: string,
): JurisdictionData | null {
  const base = JURISDICTION_DATA[stateCode];
  if (!base) return null;

  // Check city override first (most specific)
  if (city && base.cityOverrides) {
    for (const [cityKey, nec] of Object.entries(base.cityOverrides)) {
      if (city.toLowerCase().includes(cityKey.toLowerCase())) {
        return { ...base, necVersion: nec };
      }
    }
  }

  // Check county override
  if (county && base.countyOverrides) {
    for (const [countyKey, nec] of Object.entries(base.countyOverrides)) {
      if (county.toLowerCase().includes(countyKey.toLowerCase())) {
        return { ...base, necVersion: nec };
      }
    }
  }

  return base;
}

// ── NEC version rules ─────────────────────────────────────────────────────────
export interface NecRules {
  version: NecVersion;
  rapidShutdown: {
    required: boolean;
    withinArray: boolean;   // 2017+: within array boundary
    moduleLevel: boolean;   // 2020+: module-level required for rooftop
    timeLimit: number;      // seconds
  };
  arcFault: {
    required: boolean;
    dcArcFault: boolean;
  };
  groundFault: {
    required: boolean;
  };
  labeling: {
    dcConduitLabels: boolean;
    acDisconnectLabel: boolean;
    rapidShutdownLabel: boolean;
  };
  wireManagement: {
    exposedWiringAllowed: boolean;
    conduitRequired: boolean;
  };
}

export function getNecRules(version: NecVersion): NecRules {
  const base: NecRules = {
    version,
    rapidShutdown: { required: true, withinArray: false, moduleLevel: false, timeLimit: 30 },
    arcFault: { required: true, dcArcFault: false },
    groundFault: { required: true },
    labeling: { dcConduitLabels: true, acDisconnectLabel: true, rapidShutdownLabel: true },
    wireManagement: { exposedWiringAllowed: false, conduitRequired: true },
  };

  if (version === '2017') {
    return {
      ...base,
      rapidShutdown: { required: true, withinArray: true, moduleLevel: false, timeLimit: 30 },
      arcFault: { required: true, dcArcFault: false },
    };
  }
  if (version === '2020') {
    return {
      ...base,
      rapidShutdown: { required: true, withinArray: true, moduleLevel: true, timeLimit: 30 },
      arcFault: { required: true, dcArcFault: true },
    };
  }
  if (version === '2023') {
    return {
      ...base,
      rapidShutdown: { required: true, withinArray: true, moduleLevel: true, timeLimit: 30 },
      arcFault: { required: true, dcArcFault: true },
      wireManagement: { exposedWiringAllowed: false, conduitRequired: true },
    };
  }
  return base;
}