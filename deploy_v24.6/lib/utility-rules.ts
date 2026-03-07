// ============================================================
// Utility / AHJ Interconnection Rules Engine
// SolarPro v3.1 — NEC + Utility-Specific Logic
// ============================================================

import type { InterconnectionMethod } from './electrical-calc';

// ── Types ────────────────────────────────────────────────────

export interface UtilityRuleEntry {
  id: string;
  name: string;
  states: string[];
  preferredInterconnection: InterconnectionMethod;
  maxLoadSideBreaker: number;          // Max solar breaker allowed on load-side (A)
  maxSystemSizeKw: number;             // Max system size for simplified interconnection
  allowsMainBreakerDerate: boolean;
  allowsLineSideTap: boolean;
  requiresVisibleDisconnect: boolean;
  requiresProductionMeter: boolean;
  requiresAntiIslanding: boolean;
  requiresSmartInverter?: boolean;     // CA Rule 21
  rule21Compliant?: boolean;
  netMeteringAvailable: boolean;
  netMeteringMaxKw: number;
  netMeteringProgram: string;
  interconnectionApplicationRequired: boolean;
  interconnectionApplicationUrl: string;
  preApplicationRequired: boolean;
  preApplicationThresholdKw: number;
  studyRequiredAboveKw: number;
  ieee1547Compliant: boolean;
  ul1741Compliant: boolean;
  ruleReferences: UtilityRuleReference[];
  disconnectRequirements: DisconnectRequirements;
  labelingRequirements: string[];
  notes: string;
}

export interface UtilityRuleReference {
  rule: string;
  description: string;
  requirement: string;
}

export interface DisconnectRequirements {
  acDisconnect: boolean;
  acDisconnectVisible: boolean;
  acDisconnectLockable: boolean;
  utilityAccessible: boolean;
  notes: string;
}

export interface UtilityRecommendation {
  recommendedMethod: InterconnectionMethod;
  recommendedMethodLabel: string;
  utilityName: string;
  reason: string;
  loadSidePasses: boolean;
  utilityPreference: InterconnectionMethod;
  utilityAllowsLoadSide: boolean;
  utilityAllowsLineSideTap: boolean;
  utilityAllowsMainBreakerDerate: boolean;
  requiresVisibleDisconnect: boolean;
  requiresProductionMeter: boolean;
  requiresSmartInverter: boolean;
  netMeteringProgram: string;
  netMeteringAvailable: boolean;
  studyRequired: boolean;
  studyThresholdKw: number;
  applicationUrl: string;
  ruleReferences: UtilityRuleReference[];
  disconnectNotes: string;
  labelingRequirements: string[];
  utilityNotes: string;
  warnings: string[];
}

export interface JurisdictionInput {
  state: string;
  utilityName: string;
  ahjName: string;
  necVersion: string;
}

export interface InterconnectionInput {
  busRating: number;
  mainBreaker: number;
  solarBreakerRequired: number;
  systemDcKw: number;
  systemAcKw: number;
}

// ── Utility Registry (inline — loaded from JSON at build time) ──

// Inline registry so it works in both server and client contexts
const UTILITY_REGISTRY: Record<string, UtilityRuleEntry> = {
  'ameren': {
    id: 'ameren', name: 'Ameren', states: ['IL', 'MO'],
    preferredInterconnection: 'SUPPLY_SIDE_TAP',
    maxLoadSideBreaker: 40, maxSystemSizeKw: 1000,
    allowsMainBreakerDerate: true, allowsLineSideTap: true,
    requiresVisibleDisconnect: true, requiresProductionMeter: true,
    requiresAntiIslanding: true, netMeteringAvailable: true,
    netMeteringMaxKw: 1000, netMeteringProgram: 'Net Metering 2.0',
    interconnectionApplicationRequired: true,
    interconnectionApplicationUrl: 'https://www.ameren.com/illinois/business/solar',
    preApplicationRequired: false, preApplicationThresholdKw: 10,
    studyRequiredAboveKw: 10, ieee1547Compliant: true, ul1741Compliant: true,
    ruleReferences: [
      { rule: 'Ameren IL Tariff Sheet 10', description: 'Net Metering tariff for Illinois customers', requirement: 'Submit interconnection application before energizing' },
      { rule: 'ICC Docket 19-0368', description: 'Illinois Commerce Commission interconnection rules', requirement: 'All systems must comply with ICC interconnection standards' },
      { rule: 'IEEE 1547-2018', description: 'Standard for interconnection of distributed energy resources', requirement: 'Inverter must be IEEE 1547-2018 certified' },
    ],
    disconnectRequirements: {
      acDisconnect: true, acDisconnectVisible: true, acDisconnectLockable: true, utilityAccessible: true,
      notes: 'Ameren requires a visible, lockable AC disconnect accessible to utility personnel at the meter or service entrance',
    },
    labelingRequirements: [
      'NEC 705.10 — Identification of power sources',
      'NEC 690.54 — Equipment identification',
      "Ameren requires 'SOLAR ELECTRIC SYSTEM CONNECTED' placard at main panel",
    ],
    notes: 'Ameren Illinois prefers supply-side tap for systems where 120% rule is exceeded. Contact Ameren for systems above 10 kW AC.',
  },

  'comed': {
    id: 'comed', name: 'ComEd', states: ['IL'],
    preferredInterconnection: 'LOAD_SIDE',
    maxLoadSideBreaker: 60, maxSystemSizeKw: 2000,
    allowsMainBreakerDerate: true, allowsLineSideTap: true,
    requiresVisibleDisconnect: true, requiresProductionMeter: true,
    requiresAntiIslanding: true, netMeteringAvailable: true,
    netMeteringMaxKw: 2000, netMeteringProgram: 'Net Metering',
    interconnectionApplicationRequired: true,
    interconnectionApplicationUrl: 'https://www.comed.com/SiteCollectionDocuments/MyAccount/MyBillUsage/RenewableEnergy/InterconnectionApplication.pdf',
    preApplicationRequired: false, preApplicationThresholdKw: 10,
    studyRequiredAboveKw: 10, ieee1547Compliant: true, ul1741Compliant: true,
    ruleReferences: [
      { rule: 'ComEd Tariff DSGS', description: 'Distributed Solar Generation Service tariff', requirement: 'Net metering enrollment required before energizing' },
      { rule: 'ICC Docket 19-0368', description: 'Illinois Commerce Commission interconnection rules', requirement: 'All systems must comply with ICC interconnection standards' },
      { rule: 'IEEE 1547-2018', description: 'Standard for interconnection of distributed energy resources', requirement: 'Inverter must be IEEE 1547-2018 certified' },
    ],
    disconnectRequirements: {
      acDisconnect: true, acDisconnectVisible: true, acDisconnectLockable: true, utilityAccessible: true,
      notes: 'ComEd requires a visible, lockable AC disconnect. For load-side connection, disconnect must be within sight of the main panel.',
    },
    labelingRequirements: [
      'NEC 705.10 — Identification of power sources',
      'NEC 690.54 — Equipment identification',
      "ComEd requires 'SOLAR ELECTRIC SYSTEM CONNECTED' placard at utility meter",
    ],
    notes: 'ComEd allows load-side connection up to 60A solar breaker on 200A bus. For larger systems, supply-side tap or panel upgrade required.',
  },

  'duke': {
    id: 'duke', name: 'Duke Energy', states: ['NC', 'SC', 'FL', 'IN', 'OH', 'KY'],
    preferredInterconnection: 'LOAD_SIDE',
    maxLoadSideBreaker: 60, maxSystemSizeKw: 1000,
    allowsMainBreakerDerate: true, allowsLineSideTap: true,
    requiresVisibleDisconnect: true, requiresProductionMeter: true,
    requiresAntiIslanding: true, netMeteringAvailable: true,
    netMeteringMaxKw: 1000, netMeteringProgram: 'Net Metering',
    interconnectionApplicationRequired: true,
    interconnectionApplicationUrl: 'https://www.duke-energy.com/home/products/renewable-energy/solar-energy/solar-interconnection',
    preApplicationRequired: false, preApplicationThresholdKw: 20,
    studyRequiredAboveKw: 20, ieee1547Compliant: true, ul1741Compliant: true,
    ruleReferences: [
      { rule: 'Duke Energy Interconnection Standards', description: 'Duke Energy distributed generation interconnection requirements', requirement: 'Submit interconnection application and receive approval before energizing' },
      { rule: 'IEEE 1547-2018', description: 'Standard for interconnection of distributed energy resources', requirement: 'Inverter must be IEEE 1547-2018 certified' },
    ],
    disconnectRequirements: {
      acDisconnect: true, acDisconnectVisible: true, acDisconnectLockable: true, utilityAccessible: true,
      notes: 'Duke Energy requires a visible, lockable AC disconnect accessible to utility personnel. Must be within sight of the utility meter.',
    },
    labelingRequirements: [
      'NEC 705.10 — Identification of power sources',
      'NEC 690.54 — Equipment identification',
      "Duke Energy requires 'SOLAR ELECTRIC SYSTEM' placard at main panel and meter",
    ],
    notes: 'Duke Energy requires pre-approval for all interconnections. Systems above 20 kW AC may require an interconnection study.',
  },

  'pge': {
    id: 'pge', name: 'PG&E', states: ['CA'],
    preferredInterconnection: 'LOAD_SIDE',
    maxLoadSideBreaker: 60, maxSystemSizeKw: 1000,
    allowsMainBreakerDerate: true, allowsLineSideTap: true,
    requiresVisibleDisconnect: true, requiresProductionMeter: true,
    requiresAntiIslanding: true, requiresSmartInverter: true,
    rule21Compliant: true, netMeteringAvailable: true,
    netMeteringMaxKw: 1000, netMeteringProgram: 'NEM-3 (Net Billing Tariff)',
    interconnectionApplicationRequired: true,
    interconnectionApplicationUrl: 'https://www.pge.com/en_US/for-our-business-partners/interconnection-renewables/solar-and-renewable-programs/solar-and-renewable-programs.page',
    preApplicationRequired: false, preApplicationThresholdKw: 30,
    studyRequiredAboveKw: 30, ieee1547Compliant: true, ul1741Compliant: true,
    ruleReferences: [
      { rule: 'CPUC Rule 21', description: 'California Rule 21 Smart Inverter requirements', requirement: 'All inverters must meet Rule 21 advanced functions (Volt-VAR, Freq-Watt, Ramp Rate)' },
      { rule: 'NEM-3 / Net Billing Tariff', description: 'Net Energy Metering 3.0 — new systems after April 2023', requirement: 'NEM-3 compensation applies; battery storage strongly recommended' },
      { rule: 'Title 24 Part 3', description: 'California Electrical Code (NEC 2020 + CA amendments)', requirement: 'All installations must comply with California Title 24 Part 3' },
    ],
    disconnectRequirements: {
      acDisconnect: true, acDisconnectVisible: true, acDisconnectLockable: true, utilityAccessible: true,
      notes: 'PG&E requires a visible, lockable AC disconnect. California requires rapid shutdown per NEC 690.12 and Title 24.',
    },
    labelingRequirements: [
      'NEC 705.10 — Identification of power sources',
      'NEC 690.54 — Equipment identification',
      'California Title 24 labeling requirements',
      "PG&E requires 'SOLAR ELECTRIC SYSTEM CONNECTED' placard at utility meter",
      'Rapid shutdown label required at service entrance per NEC 690.56',
    ],
    notes: 'PG&E requires Rule 21 smart inverter compliance. NEM-3 applies to new systems after April 2023. Battery storage strongly recommended.',
  },

  'sce': {
    id: 'sce', name: 'Southern California Edison', states: ['CA'],
    preferredInterconnection: 'LOAD_SIDE',
    maxLoadSideBreaker: 60, maxSystemSizeKw: 1000,
    allowsMainBreakerDerate: true, allowsLineSideTap: true,
    requiresVisibleDisconnect: true, requiresProductionMeter: true,
    requiresAntiIslanding: true, requiresSmartInverter: true,
    rule21Compliant: true, netMeteringAvailable: true,
    netMeteringMaxKw: 1000, netMeteringProgram: 'NEM-3 (Net Billing Tariff)',
    interconnectionApplicationRequired: true,
    interconnectionApplicationUrl: 'https://www.sce.com/business/generating-your-own-power/solar-photovoltaic',
    preApplicationRequired: false, preApplicationThresholdKw: 30,
    studyRequiredAboveKw: 30, ieee1547Compliant: true, ul1741Compliant: true,
    ruleReferences: [
      { rule: 'CPUC Rule 21', description: 'California Rule 21 Smart Inverter requirements', requirement: 'All inverters must meet Rule 21 advanced functions' },
      { rule: 'NEM-3 / Net Billing Tariff', description: 'Net Energy Metering 3.0', requirement: 'NEM-3 compensation applies to new systems after April 2023' },
      { rule: 'Title 24 Part 3', description: 'California Electrical Code', requirement: 'All installations must comply with California Title 24 Part 3' },
    ],
    disconnectRequirements: {
      acDisconnect: true, acDisconnectVisible: true, acDisconnectLockable: true, utilityAccessible: true,
      notes: 'SCE requires a visible, lockable AC disconnect accessible to utility personnel.',
    },
    labelingRequirements: [
      'NEC 705.10 — Identification of power sources',
      'NEC 690.54 — Equipment identification',
      'California Title 24 labeling requirements',
      "SCE requires 'SOLAR ELECTRIC SYSTEM CONNECTED' placard at utility meter",
    ],
    notes: 'SCE follows CPUC Rule 21 smart inverter requirements. NEM-3 applies to new interconnections after April 2023.',
  },

  'fpl': {
    id: 'fpl', name: 'Florida Power & Light', states: ['FL'],
    preferredInterconnection: 'LOAD_SIDE',
    maxLoadSideBreaker: 60, maxSystemSizeKw: 2000,
    allowsMainBreakerDerate: true, allowsLineSideTap: true,
    requiresVisibleDisconnect: true, requiresProductionMeter: false,
    requiresAntiIslanding: true, netMeteringAvailable: true,
    netMeteringMaxKw: 2000, netMeteringProgram: 'Net Metering',
    interconnectionApplicationRequired: true,
    interconnectionApplicationUrl: 'https://www.fpl.com/clean-energy/solar/net-metering.html',
    preApplicationRequired: false, preApplicationThresholdKw: 10,
    studyRequiredAboveKw: 10, ieee1547Compliant: true, ul1741Compliant: true,
    ruleReferences: [
      { rule: 'FPL Tariff Sheet 9.020', description: 'FPL Net Metering tariff', requirement: 'Net metering enrollment required before energizing' },
      { rule: 'Florida Building Code 7th Edition', description: 'Structural requirements for solar installations', requirement: 'All installations must comply with Florida Building Code wind load requirements' },
      { rule: 'IEEE 1547-2018', description: 'Standard for interconnection of distributed energy resources', requirement: 'Inverter must be IEEE 1547-2018 certified' },
    ],
    disconnectRequirements: {
      acDisconnect: true, acDisconnectVisible: true, acDisconnectLockable: true, utilityAccessible: true,
      notes: 'FPL requires a visible, lockable AC disconnect. Florida high-wind requirements apply.',
    },
    labelingRequirements: [
      'NEC 705.10 — Identification of power sources',
      'NEC 690.54 — Equipment identification',
      "FPL requires 'SOLAR ELECTRIC SYSTEM CONNECTED' placard at utility meter",
    ],
    notes: 'FPL serves most of South and East Florida. Florida Building Code 7th Edition structural requirements apply.',
  },

  // ── Illinois Electric Cooperatives ──────────────────────────────────────────
  // All IL co-ops: ICC Docket 19-0368 interconnection rules, IL Net Metering Act (220 ILCS 5/16-107.5)
  // Net metering at retail rate ≤ 40 kW, $50 application fee, 30-day approval, anti-islanding required

  'swec-il': {
    id: 'swec-il', name: 'Southwestern Electric Cooperative', states: ['IL'],
    preferredInterconnection: 'LOAD_SIDE',
    maxLoadSideBreaker: 40, maxSystemSizeKw: 40,
    allowsMainBreakerDerate: true, allowsLineSideTap: true,
    requiresVisibleDisconnect: true, requiresProductionMeter: false,
    requiresAntiIslanding: true, netMeteringAvailable: true,
    netMeteringMaxKw: 40, netMeteringProgram: 'IL Net Metering (avoided cost rate)',
    interconnectionApplicationRequired: true,
    interconnectionApplicationUrl: 'https://www.swec.coop',
    preApplicationRequired: false, preApplicationThresholdKw: 10,
    studyRequiredAboveKw: 10, ieee1547Compliant: true, ul1741Compliant: true,
    ruleReferences: [
      { rule: 'ICC Docket 19-0368', description: 'Illinois Commerce Commission interconnection rules', requirement: 'All systems must comply with ICC interconnection standards' },
      { rule: '220 ILCS 5/16-107.5', description: 'Illinois Net Metering Act', requirement: 'Net metering enrollment required; excess credited at avoided cost rate' },
      { rule: 'IEEE 1547-2018', description: 'Standard for interconnection of distributed energy resources', requirement: 'Inverter must be IEEE 1547-2018 certified' },
    ],
    disconnectRequirements: {
      acDisconnect: true, acDisconnectVisible: true, acDisconnectLockable: true, utilityAccessible: true,
      notes: 'Visible, lockable AC disconnect required per ICC interconnection standards.',
    },
    labelingRequirements: ['NEC 705.10 — Identification of power sources', 'NEC 690.54 — Equipment identification'],
    notes: 'IL co-op. $50 application fee ≤10 kW. Net metering at avoided cost rate. Illinois Shines (ABP) available for RECs.',
  },

  'tri-county-il': {
    id: 'tri-county-il', name: 'Tri-County Electric Cooperative', states: ['IL'],
    preferredInterconnection: 'LOAD_SIDE',
    maxLoadSideBreaker: 40, maxSystemSizeKw: 40,
    allowsMainBreakerDerate: true, allowsLineSideTap: true,
    requiresVisibleDisconnect: true, requiresProductionMeter: false,
    requiresAntiIslanding: true, netMeteringAvailable: true,
    netMeteringMaxKw: 40, netMeteringProgram: 'IL Net Metering (retail rate)',
    interconnectionApplicationRequired: true,
    interconnectionApplicationUrl: 'https://www.tricountyelectric.org',
    preApplicationRequired: false, preApplicationThresholdKw: 10,
    studyRequiredAboveKw: 10, ieee1547Compliant: true, ul1741Compliant: true,
    ruleReferences: [
      { rule: 'ICC Docket 19-0368', description: 'Illinois Commerce Commission interconnection rules', requirement: 'All systems must comply with ICC interconnection standards' },
      { rule: '220 ILCS 5/16-107.5', description: 'Illinois Net Metering Act', requirement: 'Net metering enrollment required' },
      { rule: 'IEEE 1547-2018', description: 'Standard for interconnection of distributed energy resources', requirement: 'Inverter must be IEEE 1547-2018 certified' },
    ],
    disconnectRequirements: {
      acDisconnect: true, acDisconnectVisible: true, acDisconnectLockable: true, utilityAccessible: true,
      notes: 'Visible, lockable AC disconnect required per ICC interconnection standards.',
    },
    labelingRequirements: ['NEC 705.10 — Identification of power sources', 'NEC 690.54 — Equipment identification'],
    notes: 'IL co-op serving Marshall/Putnam/Stark/Bureau/Peoria counties. $50 application fee. Illinois Shines (ABP) available.',
  },

  'corn-belt-il': {
    id: 'corn-belt-il', name: 'Corn Belt Energy Corporation', states: ['IL'],
    preferredInterconnection: 'LOAD_SIDE',
    maxLoadSideBreaker: 40, maxSystemSizeKw: 40,
    allowsMainBreakerDerate: true, allowsLineSideTap: true,
    requiresVisibleDisconnect: true, requiresProductionMeter: false,
    requiresAntiIslanding: true, netMeteringAvailable: true,
    netMeteringMaxKw: 40, netMeteringProgram: 'IL Net Metering (retail rate)',
    interconnectionApplicationRequired: true,
    interconnectionApplicationUrl: 'https://www.cornbeltenergy.com',
    preApplicationRequired: false, preApplicationThresholdKw: 10,
    studyRequiredAboveKw: 10, ieee1547Compliant: true, ul1741Compliant: true,
    ruleReferences: [
      { rule: 'ICC Docket 19-0368', description: 'Illinois Commerce Commission interconnection rules', requirement: 'All systems must comply with ICC interconnection standards' },
      { rule: '220 ILCS 5/16-107.5', description: 'Illinois Net Metering Act', requirement: 'Net metering enrollment required; annual true-up in April' },
      { rule: 'IEEE 1547-2018', description: 'Standard for interconnection of distributed energy resources', requirement: 'Inverter must be IEEE 1547-2018 certified' },
    ],
    disconnectRequirements: {
      acDisconnect: true, acDisconnectVisible: true, acDisconnectLockable: true, utilityAccessible: true,
      notes: 'Visible, lockable AC disconnect required.',
    },
    labelingRequirements: ['NEC 705.10 — Identification of power sources', 'NEC 690.54 — Equipment identification'],
    notes: 'IL co-op serving McLean/DeWitt/Livingston/Woodford/Tazewell counties. USDA REAP grants available for agricultural members.',
  },

  'eastern-illini-il': {
    id: 'eastern-illini-il', name: 'Eastern Illini Electric Cooperative', states: ['IL'],
    preferredInterconnection: 'LOAD_SIDE',
    maxLoadSideBreaker: 40, maxSystemSizeKw: 40,
    allowsMainBreakerDerate: true, allowsLineSideTap: true,
    requiresVisibleDisconnect: true, requiresProductionMeter: false,
    requiresAntiIslanding: true, netMeteringAvailable: true,
    netMeteringMaxKw: 40, netMeteringProgram: 'IL Net Metering (retail rate)',
    interconnectionApplicationRequired: true,
    interconnectionApplicationUrl: 'https://www.eiec.coop',
    preApplicationRequired: false, preApplicationThresholdKw: 10,
    studyRequiredAboveKw: 10, ieee1547Compliant: true, ul1741Compliant: true,
    ruleReferences: [
      { rule: 'ICC Docket 19-0368', description: 'Illinois Commerce Commission interconnection rules', requirement: 'All systems must comply with ICC interconnection standards' },
      { rule: '220 ILCS 5/16-107.5', description: 'Illinois Net Metering Act', requirement: 'Net metering enrollment required' },
      { rule: 'IEEE 1547-2018', description: 'Standard for interconnection of distributed energy resources', requirement: 'Inverter must be IEEE 1547-2018 certified' },
    ],
    disconnectRequirements: {
      acDisconnect: true, acDisconnectVisible: true, acDisconnectLockable: true, utilityAccessible: true,
      notes: 'Visible, lockable AC disconnect required.',
    },
    labelingRequirements: ['NEC 705.10 — Identification of power sources', 'NEC 690.54 — Equipment identification'],
    notes: 'IL co-op serving Ford/Iroquois/Kankakee counties. Illinois Shines (ABP) available.',
  },

  'coles-moultrie-il': {
    id: 'coles-moultrie-il', name: 'Coles-Moultrie Electric Cooperative', states: ['IL'],
    preferredInterconnection: 'LOAD_SIDE',
    maxLoadSideBreaker: 40, maxSystemSizeKw: 40,
    allowsMainBreakerDerate: true, allowsLineSideTap: true,
    requiresVisibleDisconnect: true, requiresProductionMeter: false,
    requiresAntiIslanding: true, netMeteringAvailable: true,
    netMeteringMaxKw: 40, netMeteringProgram: 'IL Net Metering (retail rate)',
    interconnectionApplicationRequired: true,
    interconnectionApplicationUrl: 'https://www.cmec.coop',
    preApplicationRequired: false, preApplicationThresholdKw: 10,
    studyRequiredAboveKw: 10, ieee1547Compliant: true, ul1741Compliant: true,
    ruleReferences: [
      { rule: 'ICC Docket 19-0368', description: 'Illinois Commerce Commission interconnection rules', requirement: 'All systems must comply with ICC interconnection standards' },
      { rule: '220 ILCS 5/16-107.5', description: 'Illinois Net Metering Act', requirement: 'Net metering enrollment required' },
      { rule: 'IEEE 1547-2018', description: 'Standard for interconnection of distributed energy resources', requirement: 'Inverter must be IEEE 1547-2018 certified' },
    ],
    disconnectRequirements: {
      acDisconnect: true, acDisconnectVisible: true, acDisconnectLockable: true, utilityAccessible: true,
      notes: 'Visible, lockable AC disconnect required.',
    },
    labelingRequirements: ['NEC 705.10 — Identification of power sources', 'NEC 690.54 — Equipment identification'],
    notes: 'IL co-op serving Coles/Moultrie/Douglas/Shelby counties. Illinois Shines (ABP) available.',
  },

  'egyptian-il': {
    id: 'egyptian-il', name: 'Egyptian Electric Cooperative Association', states: ['IL'],
    preferredInterconnection: 'LOAD_SIDE',
    maxLoadSideBreaker: 40, maxSystemSizeKw: 40,
    allowsMainBreakerDerate: true, allowsLineSideTap: true,
    requiresVisibleDisconnect: true, requiresProductionMeter: false,
    requiresAntiIslanding: true, netMeteringAvailable: true,
    netMeteringMaxKw: 40, netMeteringProgram: 'IL Net Metering (retail rate)',
    interconnectionApplicationRequired: true,
    interconnectionApplicationUrl: 'https://www.egyptianelectric.coop',
    preApplicationRequired: false, preApplicationThresholdKw: 10,
    studyRequiredAboveKw: 10, ieee1547Compliant: true, ul1741Compliant: true,
    ruleReferences: [
      { rule: 'ICC Docket 19-0368', description: 'Illinois Commerce Commission interconnection rules', requirement: 'All systems must comply with ICC interconnection standards' },
      { rule: '220 ILCS 5/16-107.5', description: 'Illinois Net Metering Act', requirement: 'Net metering enrollment required' },
      { rule: 'IEEE 1547-2018', description: 'Standard for interconnection of distributed energy resources', requirement: 'Inverter must be IEEE 1547-2018 certified' },
    ],
    disconnectRequirements: {
      acDisconnect: true, acDisconnectVisible: true, acDisconnectLockable: true, utilityAccessible: true,
      notes: 'Visible, lockable AC disconnect required.',
    },
    labelingRequirements: ['NEC 705.10 — Identification of power sources', 'NEC 690.54 — Equipment identification'],
    notes: 'IL co-op serving Saline/Gallatin/White/Hamilton/Hardin counties (southern IL). USDA REAP grants available.',
  },

  'menard-il': {
    id: 'menard-il', name: 'Menard Electric Cooperative', states: ['IL'],
    preferredInterconnection: 'LOAD_SIDE',
    maxLoadSideBreaker: 40, maxSystemSizeKw: 40,
    allowsMainBreakerDerate: true, allowsLineSideTap: true,
    requiresVisibleDisconnect: true, requiresProductionMeter: false,
    requiresAntiIslanding: true, netMeteringAvailable: true,
    netMeteringMaxKw: 40, netMeteringProgram: 'IL Net Metering (retail rate)',
    interconnectionApplicationRequired: true,
    interconnectionApplicationUrl: 'https://www.menardelectric.coop',
    preApplicationRequired: false, preApplicationThresholdKw: 10,
    studyRequiredAboveKw: 10, ieee1547Compliant: true, ul1741Compliant: true,
    ruleReferences: [
      { rule: 'ICC Docket 19-0368', description: 'Illinois Commerce Commission interconnection rules', requirement: 'All systems must comply with ICC interconnection standards' },
      { rule: '220 ILCS 5/16-107.5', description: 'Illinois Net Metering Act', requirement: 'Net metering enrollment required' },
      { rule: 'IEEE 1547-2018', description: 'Standard for interconnection of distributed energy resources', requirement: 'Inverter must be IEEE 1547-2018 certified' },
    ],
    disconnectRequirements: {
      acDisconnect: true, acDisconnectVisible: true, acDisconnectLockable: true, utilityAccessible: true,
      notes: 'Visible, lockable AC disconnect required.',
    },
    labelingRequirements: ['NEC 705.10 — Identification of power sources', 'NEC 690.54 — Equipment identification'],
    notes: 'IL co-op serving Menard/Mason/Cass/Sangamon counties (central IL). Illinois Shines (ABP) available.',
  },

  'monroe-county-il': {
    id: 'monroe-county-il', name: 'Monroe County Electric Cooperative', states: ['IL'],
    preferredInterconnection: 'LOAD_SIDE',
    maxLoadSideBreaker: 40, maxSystemSizeKw: 40,
    allowsMainBreakerDerate: true, allowsLineSideTap: true,
    requiresVisibleDisconnect: true, requiresProductionMeter: false,
    requiresAntiIslanding: true, netMeteringAvailable: true,
    netMeteringMaxKw: 40, netMeteringProgram: 'IL Net Metering (retail rate)',
    interconnectionApplicationRequired: true,
    interconnectionApplicationUrl: 'https://www.monroecountyelectric.coop',
    preApplicationRequired: false, preApplicationThresholdKw: 10,
    studyRequiredAboveKw: 10, ieee1547Compliant: true, ul1741Compliant: true,
    ruleReferences: [
      { rule: 'ICC Docket 19-0368', description: 'Illinois Commerce Commission interconnection rules', requirement: 'All systems must comply with ICC interconnection standards' },
      { rule: '220 ILCS 5/16-107.5', description: 'Illinois Net Metering Act', requirement: 'Net metering enrollment required' },
      { rule: 'IEEE 1547-2018', description: 'Standard for interconnection of distributed energy resources', requirement: 'Inverter must be IEEE 1547-2018 certified' },
    ],
    disconnectRequirements: {
      acDisconnect: true, acDisconnectVisible: true, acDisconnectLockable: true, utilityAccessible: true,
      notes: 'Visible, lockable AC disconnect required.',
    },
    labelingRequirements: ['NEC 705.10 — Identification of power sources', 'NEC 690.54 — Equipment identification'],
    notes: 'IL co-op serving Monroe/Randolph counties (SW IL near St. Louis metro). Illinois Shines (ABP) available.',
  },

  'norris-il': {
    id: 'norris-il', name: 'Norris Electric Cooperative', states: ['IL'],
    preferredInterconnection: 'LOAD_SIDE',
    maxLoadSideBreaker: 40, maxSystemSizeKw: 40,
    allowsMainBreakerDerate: true, allowsLineSideTap: true,
    requiresVisibleDisconnect: true, requiresProductionMeter: false,
    requiresAntiIslanding: true, netMeteringAvailable: true,
    netMeteringMaxKw: 40, netMeteringProgram: 'IL Net Metering (retail rate)',
    interconnectionApplicationRequired: true,
    interconnectionApplicationUrl: 'https://www.norriselectric.coop',
    preApplicationRequired: false, preApplicationThresholdKw: 10,
    studyRequiredAboveKw: 10, ieee1547Compliant: true, ul1741Compliant: true,
    ruleReferences: [
      { rule: 'ICC Docket 19-0368', description: 'Illinois Commerce Commission interconnection rules', requirement: 'All systems must comply with ICC interconnection standards' },
      { rule: '220 ILCS 5/16-107.5', description: 'Illinois Net Metering Act', requirement: 'Net metering enrollment required' },
      { rule: 'IEEE 1547-2018', description: 'Standard for interconnection of distributed energy resources', requirement: 'Inverter must be IEEE 1547-2018 certified' },
    ],
    disconnectRequirements: {
      acDisconnect: true, acDisconnectVisible: true, acDisconnectLockable: true, utilityAccessible: true,
      notes: 'Visible, lockable AC disconnect required.',
    },
    labelingRequirements: ['NEC 705.10 — Identification of power sources', 'NEC 690.54 — Equipment identification'],
    notes: 'IL co-op serving Wayne/Edwards/Wabash/White/Lawrence counties (SE IL). USDA REAP grants available.',
  },

  'shelby-il': {
    id: 'shelby-il', name: 'Shelby Electric Cooperative', states: ['IL'],
    preferredInterconnection: 'LOAD_SIDE',
    maxLoadSideBreaker: 40, maxSystemSizeKw: 40,
    allowsMainBreakerDerate: true, allowsLineSideTap: true,
    requiresVisibleDisconnect: true, requiresProductionMeter: false,
    requiresAntiIslanding: true, netMeteringAvailable: true,
    netMeteringMaxKw: 40, netMeteringProgram: 'IL Net Metering (retail rate)',
    interconnectionApplicationRequired: true,
    interconnectionApplicationUrl: 'https://www.shelbyelectric.coop',
    preApplicationRequired: false, preApplicationThresholdKw: 10,
    studyRequiredAboveKw: 10, ieee1547Compliant: true, ul1741Compliant: true,
    ruleReferences: [
      { rule: 'ICC Docket 19-0368', description: 'Illinois Commerce Commission interconnection rules', requirement: 'All systems must comply with ICC interconnection standards' },
      { rule: '220 ILCS 5/16-107.5', description: 'Illinois Net Metering Act', requirement: 'Net metering enrollment required' },
      { rule: 'IEEE 1547-2018', description: 'Standard for interconnection of distributed energy resources', requirement: 'Inverter must be IEEE 1547-2018 certified' },
    ],
    disconnectRequirements: {
      acDisconnect: true, acDisconnectVisible: true, acDisconnectLockable: true, utilityAccessible: true,
      notes: 'Visible, lockable AC disconnect required.',
    },
    labelingRequirements: ['NEC 705.10 — Identification of power sources', 'NEC 690.54 — Equipment identification'],
    notes: 'IL co-op serving Shelby/Effingham/Fayette/Christian counties (central IL). Illinois Shines (ABP) available.',
  },

  'spoon-river-il': {
    id: 'spoon-river-il', name: 'Spoon River Electric Cooperative', states: ['IL'],
    preferredInterconnection: 'LOAD_SIDE',
    maxLoadSideBreaker: 40, maxSystemSizeKw: 40,
    allowsMainBreakerDerate: true, allowsLineSideTap: true,
    requiresVisibleDisconnect: true, requiresProductionMeter: false,
    requiresAntiIslanding: true, netMeteringAvailable: true,
    netMeteringMaxKw: 40, netMeteringProgram: 'IL Net Metering (retail rate)',
    interconnectionApplicationRequired: true,
    interconnectionApplicationUrl: 'https://www.srec.coop',
    preApplicationRequired: false, preApplicationThresholdKw: 10,
    studyRequiredAboveKw: 10, ieee1547Compliant: true, ul1741Compliant: true,
    ruleReferences: [
      { rule: 'ICC Docket 19-0368', description: 'Illinois Commerce Commission interconnection rules', requirement: 'All systems must comply with ICC interconnection standards' },
      { rule: '220 ILCS 5/16-107.5', description: 'Illinois Net Metering Act', requirement: 'Net metering enrollment required' },
      { rule: 'IEEE 1547-2018', description: 'Standard for interconnection of distributed energy resources', requirement: 'Inverter must be IEEE 1547-2018 certified' },
    ],
    disconnectRequirements: {
      acDisconnect: true, acDisconnectVisible: true, acDisconnectLockable: true, utilityAccessible: true,
      notes: 'Visible, lockable AC disconnect required.',
    },
    labelingRequirements: ['NEC 705.10 — Identification of power sources', 'NEC 690.54 — Equipment identification'],
    notes: 'IL co-op serving Fulton/Knox/Warren/McDonough counties (west-central IL). USDA REAP grants available.',
  },

  'western-illinois-il': {
    id: 'western-illinois-il', name: 'Western Illinois Electrical Coop', states: ['IL'],
    preferredInterconnection: 'LOAD_SIDE',
    maxLoadSideBreaker: 40, maxSystemSizeKw: 40,
    allowsMainBreakerDerate: true, allowsLineSideTap: true,
    requiresVisibleDisconnect: true, requiresProductionMeter: false,
    requiresAntiIslanding: true, netMeteringAvailable: true,
    netMeteringMaxKw: 40, netMeteringProgram: 'IL Net Metering (retail rate)',
    interconnectionApplicationRequired: true,
    interconnectionApplicationUrl: 'https://www.wiec.coop',
    preApplicationRequired: false, preApplicationThresholdKw: 10,
    studyRequiredAboveKw: 10, ieee1547Compliant: true, ul1741Compliant: true,
    ruleReferences: [
      { rule: 'ICC Docket 19-0368', description: 'Illinois Commerce Commission interconnection rules', requirement: 'All systems must comply with ICC interconnection standards' },
      { rule: '220 ILCS 5/16-107.5', description: 'Illinois Net Metering Act', requirement: 'Net metering enrollment required' },
      { rule: 'IEEE 1547-2018', description: 'Standard for interconnection of distributed energy resources', requirement: 'Inverter must be IEEE 1547-2018 certified' },
    ],
    disconnectRequirements: {
      acDisconnect: true, acDisconnectVisible: true, acDisconnectLockable: true, utilityAccessible: true,
      notes: 'Visible, lockable AC disconnect required.',
    },
    labelingRequirements: ['NEC 705.10 — Identification of power sources', 'NEC 690.54 — Equipment identification'],
    notes: 'IL co-op serving Adams/Brown/Pike/Schuyler counties (western IL near Missouri border). Illinois Shines (ABP) available.',
  },

  'pseg': {
    id: 'pseg', name: 'PSE&G', states: ['NJ'],
    preferredInterconnection: 'LOAD_SIDE',
    maxLoadSideBreaker: 60, maxSystemSizeKw: 2000,
    allowsMainBreakerDerate: true, allowsLineSideTap: true,
    requiresVisibleDisconnect: true, requiresProductionMeter: true,
    requiresAntiIslanding: true, netMeteringAvailable: true,
    netMeteringMaxKw: 2000, netMeteringProgram: 'Net Metering',
    interconnectionApplicationRequired: true,
    interconnectionApplicationUrl: 'https://nj.pseg.com/home/saveenergymoney/solarinformation',
    preApplicationRequired: false, preApplicationThresholdKw: 10,
    studyRequiredAboveKw: 10, ieee1547Compliant: true, ul1741Compliant: true,
    ruleReferences: [
      { rule: 'BPU Interconnection Standards', description: 'New Jersey Board of Public Utilities interconnection standards', requirement: 'All systems must comply with NJ BPU interconnection requirements' },
      { rule: 'NJ SREC-II Program', description: 'Solar Renewable Energy Certificate program', requirement: 'Register with NJ SREC-II program for incentives' },
      { rule: 'IEEE 1547-2018', description: 'Standard for interconnection of distributed energy resources', requirement: 'Inverter must be IEEE 1547-2018 certified' },
    ],
    disconnectRequirements: {
      acDisconnect: true, acDisconnectVisible: true, acDisconnectLockable: true, utilityAccessible: true,
      notes: 'PSE&G requires a visible, lockable AC disconnect. NJ requires licensed electrician for all solar installations.',
    },
    labelingRequirements: [
      'NEC 705.10 — Identification of power sources',
      'NEC 690.54 — Equipment identification',
      "PSE&G requires 'SOLAR ELECTRIC SYSTEM CONNECTED' placard at utility meter",
      'NJ SREC-II registration placard required',
    ],
    notes: 'PSE&G serves northern and central New Jersey. NJ SREC-II program registration required for incentives.',
  },
};

// Default fallback
const DEFAULT_UTILITY: UtilityRuleEntry = {
  id: 'default', name: 'Generic Utility', states: [],
  preferredInterconnection: 'LOAD_SIDE',
  maxLoadSideBreaker: 60, maxSystemSizeKw: 1000,
  allowsMainBreakerDerate: true, allowsLineSideTap: true,
  requiresVisibleDisconnect: true, requiresProductionMeter: false,
  requiresAntiIslanding: true, netMeteringAvailable: true,
  netMeteringMaxKw: 1000, netMeteringProgram: 'Net Metering',
  interconnectionApplicationRequired: true, interconnectionApplicationUrl: '',
  preApplicationRequired: false, preApplicationThresholdKw: 10,
  studyRequiredAboveKw: 10, ieee1547Compliant: true, ul1741Compliant: true,
  ruleReferences: [
    { rule: 'IEEE 1547-2018', description: 'Standard for interconnection of distributed energy resources', requirement: 'Inverter must be IEEE 1547-2018 certified' },
    { rule: 'UL 1741', description: 'Inverter, Converter, Controller and Interconnection System Equipment', requirement: 'All inverters must be UL 1741 listed' },
    { rule: 'NEC 705', description: 'Interconnected Electric Power Production Sources', requirement: 'All interconnections must comply with NEC Article 705' },
  ],
  disconnectRequirements: {
    acDisconnect: true, acDisconnectVisible: true, acDisconnectLockable: true, utilityAccessible: true,
    notes: 'Visible, lockable AC disconnect required. Verify specific requirements with local AHJ and utility.',
  },
  labelingRequirements: [
    'NEC 705.10 — Identification of power sources',
    'NEC 690.54 — Equipment identification',
    'Verify labeling requirements with local AHJ',
  ],
  notes: 'Generic utility rules applied. Verify specific interconnection requirements with your local utility and AHJ before permit submission.',
};

// ── Utility Lookup ────────────────────────────────────────────

export function getUtilityRules(utilityName: string): UtilityRuleEntry {
  if (!utilityName) return DEFAULT_UTILITY;
  const key = utilityName.toLowerCase()
    .replace(/[^a-z0-9]/g, '')   // strip punctuation
    .replace('pacificgaselectric', 'pge')
    .replace('pacificgas', 'pge')
    .replace('southerncaliforniaedison', 'sce')
    .replace('floridapowerlight', 'fpl')
    .replace('floridapowerandlight', 'fpl')
    .replace('dukeenergy', 'duke')
    .replace('pseg', 'pseg')
    .replace('publicserviceenterprisegroup', 'pseg')
    // IL Co-op aliases
    .replace('southwesternelectriccooperative', 'swecil')
    .replace('southwesternelectric', 'swecil')
    .replace('tricountyelectriccooperative', 'tricountyil')
    .replace('tricountyelectric', 'tricountyil')
    .replace('cornbeltenergycorporation', 'cornbeltil')
    .replace('cornbeltenergy', 'cornbeltil')
    .replace('easternillinielectriccooperative', 'easternilliniil')
    .replace('easternillini', 'easternilliniil')
    .replace('colesmoultrie', 'colesmoultriecooperativeil')
    .replace('egyptianelectric', 'egyptianil')
    .replace('menardelectric', 'menardil')
    .replace('monroecountyelectric', 'monroecountyil')
    .replace('norriselectric', 'norrisil')
    .replace('shelbyelectric', 'shelbyil')
    .replace('spoonriverelectric', 'spoonriveril')
    .replace('westernillinoiselectrical', 'westernillinoisil');

  // Direct match
  if (UTILITY_REGISTRY[key]) return UTILITY_REGISTRY[key];

  // Direct match on hyphenated id (e.g. 'swec-il' -> 'swecil')
  const keyNorm = key.replace(/-/g, '');
  for (const [id, entry] of Object.entries(UTILITY_REGISTRY)) {
    const idNorm = id.replace(/-/g, '');
    if (keyNorm === idNorm) return entry;
  }

  // Partial match on name
  for (const [id, entry] of Object.entries(UTILITY_REGISTRY)) {
    const idNorm = id.replace(/-/g, '');
    if (keyNorm.includes(idNorm) || idNorm.includes(keyNorm)) return entry;
    const nameNorm = entry.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (nameNorm.includes(keyNorm) || keyNorm.includes(nameNorm.substring(0, 8))) return entry;
  }

  return DEFAULT_UTILITY;
}

export function getUtilitiesByState(stateCode: string): UtilityRuleEntry[] {
  return Object.values(UTILITY_REGISTRY).filter(u => u.states.includes(stateCode));
}

export function getAllUtilityNames(): string[] {
  return Object.values(UTILITY_REGISTRY).map(u => u.name).sort();
}

// ── Method Labels ─────────────────────────────────────────────

const METHOD_LABELS: Record<InterconnectionMethod, string> = {
  LOAD_SIDE: 'Load-Side Breaker (120% Rule)',
  SUPPLY_SIDE_TAP: 'Supply-Side Tap (Line-Side)',
  MAIN_BREAKER_DERATE: 'Main Breaker Derate',
  PANEL_UPGRADE: 'Panel Upgrade',
};

// ── 120% Rule Check ───────────────────────────────────────────

function check120PercentRule(
  busRating: number,
  mainBreaker: number,
  solarBreaker: number,
  utilityMaxLoadSide: number,
): { passes: boolean; maxAllowed: number; reason: string } {
  const necMax = (busRating * 1.2) - mainBreaker;
  const effectiveMax = Math.min(necMax, utilityMaxLoadSide);
  const passes = solarBreaker <= effectiveMax && effectiveMax > 0;
  const reason = passes
    ? `120% rule satisfied: ${solarBreaker}A solar breaker ≤ ${effectiveMax}A max allowed on ${busRating}A bus`
    : effectiveMax <= 0
      ? `120% rule cannot be satisfied: ${busRating}A bus × 1.2 = ${busRating * 1.2}A < ${mainBreaker}A main breaker`
      : `120% rule exceeded: ${solarBreaker}A solar breaker > ${effectiveMax}A max allowed on ${busRating}A bus with ${mainBreaker}A main breaker`;
  return { passes, maxAllowed: Math.max(0, effectiveMax), reason };
}

// ── Recommendation Engine ─────────────────────────────────────

export function getRecommendedInterconnection(
  jurisdiction: JurisdictionInput,
  interconnection: InterconnectionInput,
): UtilityRecommendation {
  const utility = getUtilityRules(jurisdiction.utilityName);
  const warnings: string[] = [];

  // Check 120% rule with utility-specific max load-side breaker
  const loadSideCheck = check120PercentRule(
    interconnection.busRating,
    interconnection.mainBreaker,
    interconnection.solarBreakerRequired,
    utility.maxLoadSideBreaker,
  );

  // Determine recommended method
  let recommendedMethod: InterconnectionMethod;
  let reason: string;

  if (loadSideCheck.passes) {
    // 120% rule passes AND within utility's load-side limit
    recommendedMethod = 'LOAD_SIDE';
    reason = loadSideCheck.reason;
  } else {
    // 120% rule fails — check utility preferences in order
    if (utility.allowsLineSideTap) {
      recommendedMethod = 'SUPPLY_SIDE_TAP';
      reason = `${loadSideCheck.reason}. ${utility.name} allows supply-side tap (NEC 705.11) — 120% rule not applicable.`;
    } else if (utility.allowsMainBreakerDerate) {
      recommendedMethod = 'MAIN_BREAKER_DERATE';
      const necMax = (interconnection.busRating * 1.2) - interconnection.solarBreakerRequired;
      reason = `${loadSideCheck.reason}. ${utility.name} allows main breaker derate. Replace main breaker with ≤${necMax}A to satisfy 120% rule.`;
    } else {
      recommendedMethod = 'PANEL_UPGRADE';
      const requiredBus = Math.ceil((interconnection.mainBreaker + interconnection.solarBreakerRequired) / 1.2 / 25) * 25;
      reason = `${loadSideCheck.reason}. ${utility.name} does not allow supply-side tap or main breaker derate. Panel upgrade to ${requiredBus}A bus required.`;
    }

    // Override with utility preference if it differs and is more restrictive
    if (utility.preferredInterconnection !== 'LOAD_SIDE' && utility.preferredInterconnection !== recommendedMethod) {
      warnings.push(`${utility.name} prefers ${METHOD_LABELS[utility.preferredInterconnection]} — consider using utility-preferred method`);
    }
  }

  // Study required check
  const studyRequired = interconnection.systemAcKw > utility.studyRequiredAboveKw;
  if (studyRequired) {
    warnings.push(`System size (${interconnection.systemAcKw.toFixed(1)} kW AC) exceeds ${utility.studyRequiredAboveKw} kW — interconnection study may be required by ${utility.name}`);
  }

  // Smart inverter check
  if (utility.requiresSmartInverter) {
    warnings.push(`${utility.name} requires Rule 21 smart inverter compliance — verify inverter certification`);
  }

  // Net metering check
  if (!utility.netMeteringAvailable) {
    warnings.push(`${utility.name} does not offer net metering — verify compensation structure`);
  }

  return {
    recommendedMethod,
    recommendedMethodLabel: METHOD_LABELS[recommendedMethod],
    utilityName: utility.name,
    reason,
    loadSidePasses: loadSideCheck.passes,
    utilityPreference: utility.preferredInterconnection,
    utilityAllowsLoadSide: loadSideCheck.passes,
    utilityAllowsLineSideTap: utility.allowsLineSideTap,
    utilityAllowsMainBreakerDerate: utility.allowsMainBreakerDerate,
    requiresVisibleDisconnect: utility.requiresVisibleDisconnect,
    requiresProductionMeter: utility.requiresProductionMeter,
    requiresSmartInverter: utility.requiresSmartInverter ?? false,
    netMeteringProgram: utility.netMeteringProgram,
    netMeteringAvailable: utility.netMeteringAvailable,
    studyRequired,
    studyThresholdKw: utility.studyRequiredAboveKw,
    applicationUrl: utility.interconnectionApplicationUrl,
    ruleReferences: utility.ruleReferences,
    disconnectNotes: utility.disconnectRequirements.notes,
    labelingRequirements: utility.labelingRequirements,
    utilityNotes: utility.notes,
    warnings,
  };
}