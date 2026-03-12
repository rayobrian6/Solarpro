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

  'central-maine-power': {
    id: 'central-maine-power', name: 'Central Maine Power', states: ['ME'],
    preferredInterconnection: 'LOAD_SIDE',
    maxLoadSideBreaker: 60, maxSystemSizeKw: 660,
    allowsMainBreakerDerate: true, allowsLineSideTap: true,
    requiresVisibleDisconnect: true, requiresProductionMeter: true,
    requiresAntiIslanding: true, netMeteringAvailable: true,
    netMeteringMaxKw: 660, netMeteringProgram: 'Net Metering at Retail Rate',
    interconnectionApplicationRequired: true,
    interconnectionApplicationUrl: 'https://www.cmpco.com/en/account-tools/solar-and-net-energy-billing.html',
    preApplicationRequired: false, preApplicationThresholdKw: 10,
    studyRequiredAboveKw: 100, ieee1547Compliant: true, ul1741Compliant: true,
    ruleReferences: [
      { rule: 'Maine PUC Chapter 313', description: 'Net Energy Billing rules for Maine', requirement: 'Net metering enrollment required before energizing; annual true-up in April' },
      { rule: 'IEEE 1547-2018', description: 'Standard for interconnection of distributed energy resources', requirement: 'Inverter must be IEEE 1547-2018 certified' },
      { rule: 'Maine Building Codes', description: 'Maine electrical and building codes', requirement: 'All installations must comply with Maine Electrical Code' },
    ],
    disconnectRequirements: {
      acDisconnect: true, acDisconnectVisible: true, acDisconnectLockable: true, utilityAccessible: true,
      notes: 'CMP requires a visible, lockable AC disconnect accessible to utility personnel at the meter or service entrance.',
    },
    labelingRequirements: [
      'NEC 705.10 — Identification of power sources',
      'NEC 690.54 — Equipment identification',
      "CMP requires 'SOLAR ELECTRIC SYSTEM CONNECTED' placard at main panel",
    ],
    notes: 'Central Maine Power serves 60%+ of Maine. Net metering at retail rate up to 660 kW. Maine offers SREC incentives through Efficiency Maine.',
  },

  'versant-power': {
    id: 'versant-power', name: 'Versant Power', states: ['ME'],
    preferredInterconnection: 'LOAD_SIDE',
    maxLoadSideBreaker: 60, maxSystemSizeKw: 660,
    allowsMainBreakerDerate: true, allowsLineSideTap: true,
    requiresVisibleDisconnect: true, requiresProductionMeter: true,
    requiresAntiIslanding: true, netMeteringAvailable: true,
    netMeteringMaxKw: 660, netMeteringProgram: 'Net Energy Billing at Retail Rate',
    interconnectionApplicationRequired: true,
    interconnectionApplicationUrl: 'https://www.versantpower.com/residential/solar/',
    preApplicationRequired: false, preApplicationThresholdKw: 10,
    studyRequiredAboveKw: 100, ieee1547Compliant: true, ul1741Compliant: true,
    ruleReferences: [
      { rule: 'Maine PUC Chapter 313', description: 'Net Energy Billing rules for Maine', requirement: 'Net metering enrollment required' },
      { rule: 'IEEE 1547-2018', description: 'Standard for interconnection of distributed energy resources', requirement: 'Inverter must be IEEE 1547-2018 certified' },
    ],
    disconnectRequirements: {
      acDisconnect: true, acDisconnectVisible: true, acDisconnectLockable: true, utilityAccessible: true,
      notes: 'Versant Power (formerly Emera Maine) requires a visible, lockable AC disconnect.',
    },
    labelingRequirements: [
      'NEC 705.10 — Identification of power sources',
      'NEC 690.54 — Equipment identification',
    ],
    notes: 'Versant Power serves northern and eastern Maine (Bangor Hydro-Electric territory). Net Energy Billing at retail rate.',
  },

  'eversource-ma': {
    id: 'eversource-ma', name: 'Eversource Energy', states: ['MA', 'CT', 'NH'],
    preferredInterconnection: 'LOAD_SIDE',
    maxLoadSideBreaker: 60, maxSystemSizeKw: 2000,
    allowsMainBreakerDerate: true, allowsLineSideTap: true,
    requiresVisibleDisconnect: true, requiresProductionMeter: true,
    requiresAntiIslanding: true, netMeteringAvailable: true,
    netMeteringMaxKw: 2000, netMeteringProgram: 'Net Metering at Retail Rate',
    interconnectionApplicationRequired: true,
    interconnectionApplicationUrl: 'https://www.eversource.com/content/residential/products-services/clean-energy-options/net-metering',
    preApplicationRequired: false, preApplicationThresholdKw: 25,
    studyRequiredAboveKw: 25, ieee1547Compliant: true, ul1741Compliant: true,
    ruleReferences: [
      { rule: 'DOER 225 CMR 20', description: 'Massachusetts net metering regulations', requirement: 'Net metering enrollment required; excess credits roll over monthly' },
      { rule: 'IEEE 1547-2018', description: 'Standard for interconnection of distributed energy resources', requirement: 'Inverter must be IEEE 1547-2018 certified' },
    ],
    disconnectRequirements: {
      acDisconnect: true, acDisconnectVisible: true, acDisconnectLockable: true, utilityAccessible: true,
      notes: 'Eversource requires a visible, lockable AC disconnect accessible to utility personnel.',
    },
    labelingRequirements: [
      'NEC 705.10 — Identification of power sources',
      'NEC 690.54 — Equipment identification',
      "Eversource requires 'SOLAR ELECTRIC SYSTEM CONNECTED' placard at utility meter",
    ],
    notes: 'Eversource serves MA, CT, and NH. MA SMART program available for incentives. CT Residential Solar Incentive Program (RSIP) available.',
  },

  'national-grid-ma': {
    id: 'national-grid-ma', name: 'National Grid', states: ['MA', 'NY', 'RI'],
    preferredInterconnection: 'LOAD_SIDE',
    maxLoadSideBreaker: 60, maxSystemSizeKw: 2000,
    allowsMainBreakerDerate: true, allowsLineSideTap: true,
    requiresVisibleDisconnect: true, requiresProductionMeter: true,
    requiresAntiIslanding: true, netMeteringAvailable: true,
    netMeteringMaxKw: 2000, netMeteringProgram: 'Net Metering at Retail Rate',
    interconnectionApplicationRequired: true,
    interconnectionApplicationUrl: 'https://www.nationalgridus.com/MA-Home/Renewable-Energy/Solar-Information',
    preApplicationRequired: false, preApplicationThresholdKw: 25,
    studyRequiredAboveKw: 25, ieee1547Compliant: true, ul1741Compliant: true,
    ruleReferences: [
      { rule: 'DOER 225 CMR 20', description: 'Massachusetts net metering regulations', requirement: 'Net metering enrollment required' },
      { rule: 'IEEE 1547-2018', description: 'Standard for interconnection of distributed energy resources', requirement: 'Inverter must be IEEE 1547-2018 certified' },
    ],
    disconnectRequirements: {
      acDisconnect: true, acDisconnectVisible: true, acDisconnectLockable: true, utilityAccessible: true,
      notes: 'National Grid requires a visible, lockable AC disconnect.',
    },
    labelingRequirements: [
      'NEC 705.10 — Identification of power sources',
      'NEC 690.54 — Equipment identification',
    ],
    notes: 'National Grid serves eastern MA, upstate NY, and RI. MA SMART program and RI ConnectedSolutions available.',
  },

  'green-mountain-power': {
    id: 'green-mountain-power', name: 'Green Mountain Power', states: ['VT'],
    preferredInterconnection: 'LOAD_SIDE',
    maxLoadSideBreaker: 60, maxSystemSizeKw: 500,
    allowsMainBreakerDerate: true, allowsLineSideTap: true,
    requiresVisibleDisconnect: true, requiresProductionMeter: false,
    requiresAntiIslanding: true, netMeteringAvailable: true,
    netMeteringMaxKw: 500, netMeteringProgram: 'Net Metering at Retail Rate',
    interconnectionApplicationRequired: true,
    interconnectionApplicationUrl: 'https://greenmountainpower.com/account-tools/solar/',
    preApplicationRequired: false, preApplicationThresholdKw: 15,
    studyRequiredAboveKw: 150, ieee1547Compliant: true, ul1741Compliant: true,
    ruleReferences: [
      { rule: 'Vermont PUC Net Metering Rule', description: 'Vermont net metering rules', requirement: 'Net metering enrollment required; 1-year payback period applies' },
      { rule: 'IEEE 1547-2018', description: 'Standard for interconnection of distributed energy resources', requirement: 'Inverter must be IEEE 1547-2018 certified' },
    ],
    disconnectRequirements: {
      acDisconnect: true, acDisconnectVisible: true, acDisconnectLockable: true, utilityAccessible: true,
      notes: 'GMP requires a visible, lockable AC disconnect.',
    },
    labelingRequirements: [
      'NEC 705.10 — Identification of power sources',
      'NEC 690.54 — Equipment identification',
    ],
    notes: 'Green Mountain Power serves ~75% of Vermont. VT Clean Energy Development Fund incentives available. GMP offers innovative battery leasing programs.',
  },

  'unitil': {
    id: 'unitil', name: 'Unitil', states: ['NH', 'MA'],
    preferredInterconnection: 'LOAD_SIDE',
    maxLoadSideBreaker: 60, maxSystemSizeKw: 1000,
    allowsMainBreakerDerate: true, allowsLineSideTap: true,
    requiresVisibleDisconnect: true, requiresProductionMeter: false,
    requiresAntiIslanding: true, netMeteringAvailable: true,
    netMeteringMaxKw: 1000, netMeteringProgram: 'Net Metering at Retail Rate',
    interconnectionApplicationRequired: true,
    interconnectionApplicationUrl: 'https://www.unitil.com/renewable-energy/solar',
    preApplicationRequired: false, preApplicationThresholdKw: 10,
    studyRequiredAboveKw: 10, ieee1547Compliant: true, ul1741Compliant: true,
    ruleReferences: [
      { rule: 'NH PUC Interconnection Standards', description: 'New Hampshire interconnection requirements', requirement: 'All systems must comply with NH PUC standards' },
      { rule: 'IEEE 1547-2018', description: 'Standard for interconnection of distributed energy resources', requirement: 'Inverter must be IEEE 1547-2018 certified' },
    ],
    disconnectRequirements: {
      acDisconnect: true, acDisconnectVisible: true, acDisconnectLockable: true, utilityAccessible: true,
      notes: 'Unitil requires a visible, lockable AC disconnect.',
    },
    labelingRequirements: [
      'NEC 705.10 — Identification of power sources',
      'NEC 690.54 — Equipment identification',
    ],
    notes: 'Unitil serves portions of NH (Concord, Fitchburg) and northern MA. NH Electric Co-op territory borders Unitil service areas.',
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
    // NE utility aliases
    .replace('centralmainepowerco', 'centralmainepower')
    .replace('centralmainepowercorp', 'centralmainepower')
    .replace('centralmainepowercorporation', 'centralmainepower')
    .replace('cmpco', 'centralmainepower')
    .replace('versantpower', 'versantpower')
    .replace('bangorhydroelectric', 'versantpower')
    .replace('ameramainepower', 'versantpower')
    .replace('eversourceenergy', 'eversourcema')
    .replace('eversource', 'eversourcema')
    .replace('nationalgrid', 'nationalgridma')
    .replace('greenmountainpower', 'greenmountainpower')
    .replace('gmp', 'greenmountainpower')
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

// Valid retail electricity rate range: $0.10-$0.60/kWh.
// Below MIN: suspect rate — likely a supply-only/generation component extracted from bill
//   (e.g. CMP supply charge ~$0.069/kWh) instead of all-in retail. Maine retail is ~$0.265.
//   $0.10 is the residential retail floor across all US states (no state is below that).
// Above MAX: likely a misparse (e.g. total bill amount mistaken for per-kWh rate).
// FIX v47.13 T1d: raised from $0.06 → $0.10 to catch supply-only rates like CMP's $0.069
const MIN_VALID_RETAIL_RATE = 0.10; // $/kWh — residential retail floor (was $0.06, too low)
const MAX_VALID_RETAIL_RATE = 0.60; // $/kWh

// -- Full utility rate breakdown (2024/2025 EIA + utility tariff data) --------
// retailRate    = total all-in rate customer pays per kWh (supply + delivery)
// supplyRate    = energy/generation component only
// distributionRate = poles, wires, local delivery
// transmissionRate = high-voltage grid transport
// fixedMonthlyCharge = fixed customer/meter charge in $/month
// Sources: EIA Form 861 (2023/2024), utility tariff sheets, CPUC/state PUC filings
export interface UtilityRateBreakdown {
  retailRate: number;          // $/kWh -- ALWAYS use this for solar savings calculations
  supplyRate?: number;         // $/kWh -- generation/energy component
  distributionRate?: number;   // $/kWh -- local delivery
  transmissionRate?: number;   // $/kWh -- high-voltage transport
  fixedMonthlyCharge?: number; // $/month -- fixed customer charge
  netMeteringType?: 'retail_rate' | 'avoided_cost' | 'nem3_export' | 'none';
  lastUpdated?: string;        // ISO date of rate data
  rateSource?: string;         // EIA, tariff sheet, etc.
}

// Known rate breakdowns by utility registry id -- accurate 2024/2025 EIA + tariff data.
// retailRate = what customers ACTUALLY pay per kWh all-in.
// Solar savings calculations MUST use retailRate, never supply-only rates.
const UTILITY_RATE_BREAKDOWNS: Record<string, UtilityRateBreakdown> = {
  // -- California -----------------------------------------------------------
  // PG&E CA: E-1 residential 2024. High due to PCIA + wildfire surcharges.
  'pge': {
    retailRate: 0.338,
    supplyRate: 0.128,
    distributionRate: 0.142,
    transmissionRate: 0.031,
    fixedMonthlyCharge: 15.27,
    netMeteringType: 'nem3_export',
    lastUpdated: '2024-11-01',
    rateSource: 'CPUC PG&E E-1 tariff 2024',
  },
  // SCE CA: Tier 1/2 blended residential 2024
  'sce': {
    retailRate: 0.295,
    supplyRate: 0.115,
    distributionRate: 0.138,
    transmissionRate: 0.029,
    fixedMonthlyCharge: 10.00,
    netMeteringType: 'nem3_export',
    lastUpdated: '2024-11-01',
    rateSource: 'CPUC SCE D-RSGHP tariff 2024',
  },
  // -- Florida --------------------------------------------------------------
  // FPL FL: EV-1 residential 2024 all-in
  'fpl': {
    retailRate: 0.138,
    supplyRate: 0.068,
    distributionRate: 0.052,
    transmissionRate: 0.012,
    fixedMonthlyCharge: 9.99,
    netMeteringType: 'retail_rate',
    lastUpdated: '2024-09-01',
    rateSource: 'FPSC FPL EV-1 tariff 2024',
  },
  // -- Duke Energy (multi-state) --------------------------------------------
  // Duke Energy: blended NC/SC/FL/IN residential 2024
  'duke': {
    retailRate: 0.135,
    supplyRate: 0.065,
    distributionRate: 0.055,
    transmissionRate: 0.010,
    fixedMonthlyCharge: 14.00,
    netMeteringType: 'retail_rate',
    lastUpdated: '2024-07-01',
    rateSource: 'EIA Form 861 2023 + Duke tariff 2024',
  },
  // -- New Jersey -----------------------------------------------------------
  // PSE&G NJ: residential RS tariff 2024 all-in
  'pseg': {
    retailRate: 0.178,
    supplyRate: 0.098,
    distributionRate: 0.062,
    transmissionRate: 0.014,
    fixedMonthlyCharge: 7.04,
    netMeteringType: 'retail_rate',
    lastUpdated: '2024-10-01',
    rateSource: 'NJBPU PSE&G RS tariff 2024',
  },
  // -- Illinois IOUs --------------------------------------------------------
  // ComEd IL: blended residential 2024 (supply + delivery)
  'comed': {
    retailRate: 0.148,
    supplyRate: 0.072,
    distributionRate: 0.063,
    transmissionRate: 0.010,
    fixedMonthlyCharge: 9.95,
    netMeteringType: 'retail_rate',
    lastUpdated: '2024-06-01',
    rateSource: 'ICC ComEd BES tariff 2024',
  },
  // Ameren IL: residential rate all-in 2024
  'ameren': {
    retailRate: 0.128,
    supplyRate: 0.060,
    distributionRate: 0.055,
    transmissionRate: 0.010,
    fixedMonthlyCharge: 11.00,
    netMeteringType: 'retail_rate',
    lastUpdated: '2024-06-01',
    rateSource: 'ICC Ameren IL residential tariff 2024',
  },
  // -- Illinois co-ops (EIA 861 IL co-op avg 2023/2024) ---------------------
  'swec-il':             { retailRate: 0.132, fixedMonthlyCharge: 15.00, netMeteringType: 'retail_rate', lastUpdated: '2024-01-01', rateSource: 'EIA 861 IL co-op avg 2023' },
  'tri-county-il':       { retailRate: 0.132, fixedMonthlyCharge: 15.00, netMeteringType: 'retail_rate', lastUpdated: '2024-01-01', rateSource: 'EIA 861 IL co-op avg 2023' },
  'corn-belt-il':        { retailRate: 0.132, fixedMonthlyCharge: 16.00, netMeteringType: 'retail_rate', lastUpdated: '2024-01-01', rateSource: 'EIA 861 IL co-op avg 2023' },
  'eastern-illini-il':   { retailRate: 0.132, fixedMonthlyCharge: 15.00, netMeteringType: 'retail_rate', lastUpdated: '2024-01-01', rateSource: 'EIA 861 IL co-op avg 2023' },
  'coles-moultrie-il':   { retailRate: 0.132, fixedMonthlyCharge: 15.00, netMeteringType: 'retail_rate', lastUpdated: '2024-01-01', rateSource: 'EIA 861 IL co-op avg 2023' },
  'egyptian-il':         { retailRate: 0.128, fixedMonthlyCharge: 14.00, netMeteringType: 'retail_rate', lastUpdated: '2024-01-01', rateSource: 'EIA 861 IL co-op avg 2023' },
  'menard-il':           { retailRate: 0.132, fixedMonthlyCharge: 15.00, netMeteringType: 'retail_rate', lastUpdated: '2024-01-01', rateSource: 'EIA 861 IL co-op avg 2023' },
  'monroe-county-il':    { retailRate: 0.130, fixedMonthlyCharge: 15.00, netMeteringType: 'retail_rate', lastUpdated: '2024-01-01', rateSource: 'EIA 861 IL co-op avg 2023' },
  'norris-il':           { retailRate: 0.130, fixedMonthlyCharge: 14.00, netMeteringType: 'retail_rate', lastUpdated: '2024-01-01', rateSource: 'EIA 861 IL co-op avg 2023' },
  'shelby-il':           { retailRate: 0.132, fixedMonthlyCharge: 15.00, netMeteringType: 'retail_rate', lastUpdated: '2024-01-01', rateSource: 'EIA 861 IL co-op avg 2023' },
  'spoon-river-il':      { retailRate: 0.130, fixedMonthlyCharge: 14.00, netMeteringType: 'retail_rate', lastUpdated: '2024-01-01', rateSource: 'EIA 861 IL co-op avg 2023' },
  'western-illinois-il': { retailRate: 0.130, fixedMonthlyCharge: 14.00, netMeteringType: 'retail_rate', lastUpdated: '2024-01-01', rateSource: 'EIA 861 IL co-op avg 2023' },
  // -- New England ----------------------------------------------------------
  // CMP ME: EIA ME residential avg Jan-Sep 2024 = $0.265/kWh.
  // CORRECTION: Previous value was $0.198 -- that was 2022 EIA data, pre-energy-crisis.
  // 2024 actual: supply ~$0.138 (BGS standard offer) + delivery ~$0.122 = ~$0.265 all-in.
  'central-maine-power': {
    retailRate: 0.265,
    supplyRate: 0.138,
    distributionRate: 0.098,
    transmissionRate: 0.022,
    fixedMonthlyCharge: 9.00,
    netMeteringType: 'retail_rate',
    lastUpdated: '2024-09-01',
    rateSource: 'EIA Electric Power Monthly Oct 2024 + CMP tariff sheet 14',
  },
  // Versant Power ME: northern/eastern ME, slightly higher than CMP (lower density grid)
  'versant-power': {
    retailRate: 0.272,
    supplyRate: 0.138,
    distributionRate: 0.105,
    transmissionRate: 0.022,
    fixedMonthlyCharge: 10.25,
    netMeteringType: 'retail_rate',
    lastUpdated: '2024-09-01',
    rateSource: 'EIA Electric Power Monthly Oct 2024 + Versant tariff 2024',
  },
  // Eversource MA/CT/NH: 2024 avg ~$0.248 (down from 2023 peak ~$0.32 due to supply drop)
  'eversource-ma': {
    retailRate: 0.248,
    supplyRate: 0.128,
    distributionRate: 0.098,
    transmissionRate: 0.016,
    fixedMonthlyCharge: 9.96,
    netMeteringType: 'retail_rate',
    lastUpdated: '2024-10-01',
    rateSource: 'EIA Electric Power Monthly Oct 2024 + Eversource D-1 tariff',
  },
  // National Grid MA/NY/RI: 2024 MA residential avg ~$0.248
  'national-grid-ma': {
    retailRate: 0.248,
    supplyRate: 0.128,
    distributionRate: 0.100,
    transmissionRate: 0.015,
    fixedMonthlyCharge: 7.00,
    netMeteringType: 'retail_rate',
    lastUpdated: '2024-10-01',
    rateSource: 'EIA Electric Power Monthly Oct 2024 + National Grid R1 tariff',
  },
  // Green Mountain Power VT: 2024 residential avg ~$0.215 (EIA VT avg)
  'green-mountain-power': {
    retailRate: 0.215,
    supplyRate: 0.098,
    distributionRate: 0.098,
    transmissionRate: 0.016,
    fixedMonthlyCharge: 22.78,
    netMeteringType: 'retail_rate',
    lastUpdated: '2024-09-01',
    rateSource: 'EIA Electric Power Monthly Oct 2024 + GMP R tariff 2024',
  },
  // Unitil NH/MA: NH 2024 residential avg ~$0.235 (EIA NH avg)
  'unitil': {
    retailRate: 0.235,
    supplyRate: 0.118,
    distributionRate: 0.098,
    transmissionRate: 0.016,
    fixedMonthlyCharge: 11.35,
    netMeteringType: 'retail_rate',
    lastUpdated: '2024-09-01',
    rateSource: 'EIA Electric Power Monthly Oct 2024 + Unitil G tariff 2024',
  },
};

// Backward-compat shim: simple retailRate lookup by utility id
const UTILITY_RETAIL_RATES: Record<string, number> = Object.fromEntries(
  Object.entries(UTILITY_RATE_BREAKDOWNS).map(([id, b]) => [id, b.retailRate])
);


/**
 * Get the full rate breakdown for a utility by name.
 * Returns null if the utility is not in the UTILITY_RATE_BREAKDOWNS registry.
 * Use this to access retailRate, supplyRate, distributionRate, etc.
 */
export function getUtilityRateBreakdown(utilityName: string | null | undefined): UtilityRateBreakdown | null {
  if (!utilityName) return null;
  const utilityEntry = getUtilityRules(utilityName);
  if (!utilityEntry || utilityEntry.id === 'default') return null;
  return UTILITY_RATE_BREAKDOWNS[utilityEntry.id] ?? null;
}

/**
 * Validate and correct an extracted electricity rate.
 *
 * Priority:
 *   1. Utility registry rate -- if extracted rate is SUSPECT (< $0.10), always override with DB rate
 *      This catches supply-only/generation-component rates extracted from bills
 *      (e.g. CMP supply charge ~$0.069/kWh instead of all-in retail ~$0.265/kWh)
 *   2. extractedRate -- if within valid retail range ($0.10-$0.60/kWh) AND no DB override, use as-is
 *   3. Utility registry rate -- fallback for missing/invalid rates
 *   4. National default ($0.13/kWh)
 *
 * Corrects if:
 *   - Rate is missing/null
 *   - Rate < $0.10/kWh (suspect — likely supply-only component, not retail)
 *     FIX v47.13: raised from $0.06 to $0.10 — no US state has residential retail below $0.10
 *   - Rate > $0.60/kWh (likely a misparse -- total charge vs per-kWh rate)
 */
export function validateAndCorrectUtilityRate(
  extractedRate: number | null | undefined,
  utilityName: string | null | undefined,
): {
  rate: number;
  corrected: boolean;
  originalRate: number | null;
  source: 'extracted' | 'utility_db' | 'national_default';
  suspect: boolean;
} {
  const original = extractedRate ?? null;

  // FIX v47.13 T1d: If we have a DB rate for this utility, ALWAYS prefer it over a suspect
  // extracted rate (< $0.10). OCR frequently picks up supply-only line items (e.g. CMP $0.069)
  // instead of the all-in retail rate ($0.265). DB rate is authoritative 2024/2025 data.
  const dbRate = (() => {
    if (!utilityName) return null;
    const utilityEntry = getUtilityRules(utilityName);
    const utilityId = utilityEntry?.id;
    if (utilityId && UTILITY_RETAIL_RATES[utilityId]) return UTILITY_RETAIL_RATES[utilityId];
    return null;
  })();

  // If extracted rate is within valid retail range AND not suspect, use it
  // But if DB rate exists, only trust extracted if it's reasonably close (within 50% of DB rate)
  const isSuspect =
    extractedRate === null ||
    extractedRate === undefined ||
    extractedRate < MIN_VALID_RETAIL_RATE ||
    extractedRate > MAX_VALID_RETAIL_RATE;

  if (!isSuspect) {
    // Rate is in valid range — but if DB rate exists and extracted is far below DB, flag as suspect
    const isUnreasonablyLow = dbRate !== null && extractedRate! < dbRate * 0.5;
    if (!isUnreasonablyLow) {
      return { rate: extractedRate!, corrected: false, originalRate: original, source: 'extracted', suspect: false };
    }
    // Extracted is less than 50% of known DB rate — likely a supply-only component
    if (dbRate) {
      return { rate: dbRate, corrected: true, originalRate: original, source: 'utility_db', suspect: true };
    }
  }

  // Rate is missing, too low (avoided cost/supply-only), or too high (misparse) — look up utility DB
  if (dbRate) {
    return {
      rate: dbRate,
      corrected: true,
      originalRate: original,
      source: 'utility_db',
      suspect: isSuspect,
    };
  }

  // Fall back to national average
  return {
    rate: 0.13,
    corrected: true,
    originalRate: original,
    source: 'national_default',
    suspect: isSuspect,
  };
}

/**
 * Check if a system size exceeds the utility's net metering cap.
 * Returns a warning string if exceeded, null otherwise.
 */
export function checkNetMeteringLimit(
  systemKw: number,
  utilityName: string | null | undefined,
): string | null {
  if (!utilityName) return null;
  const utility = getUtilityRules(utilityName);
  if (!utility || utility.id === 'default') return null;
  if (systemKw > utility.netMeteringMaxKw) {
    return `System size (${systemKw.toFixed(1)} kW) exceeds ${utility.name}'s net metering cap of ${utility.netMeteringMaxKw} kW. Confirm interconnection rules before proceeding.`;
  }
  return null;
}

/**
 * Get the production factor (kWh/kW/year) for a utility's location.
 * Used for system sizing: system_kw = annual_kwh / production_factor
 */
export function getProductionFactor(utilityName: string | null | undefined, stateCode?: string | null): number {
  // Use stateCode directly if provided (more reliable than name lookup)
  const state = stateCode?.toUpperCase();
  if (state) {
    if (['CA', 'NV', 'AZ', 'NM'].includes(state)) return 1600;
    if (['FL', 'TX', 'GA', 'SC', 'NC'].includes(state)) return 1500;
    if (['CO', 'UT', 'OR', 'WA'].includes(state)) return 1350;
    if (['IL', 'IN', 'OH', 'MO', 'KS'].includes(state)) return 1280;
    if (['NY', 'NJ', 'CT', 'PA', 'DE', 'MD', 'VA'].includes(state)) return 1100;
    if (['ME', 'NH', 'VT', 'MA', 'RI'].includes(state)) return 1050;
    if (['MI', 'WI', 'MN'].includes(state)) return 1150;
    return 1250; // national average for unlisted states
  }
  if (!utilityName) return 1250;
  const utility = getUtilityRules(utilityName);
  if (!utility || utility.id === 'default') return 1250;
  if (utility.states.includes('IL')) return 1280;
  if (utility.states.includes('CA')) return 1600;
  if (utility.states.includes('FL')) return 1500;
  if (utility.states.includes('NJ') || utility.states.includes('NY')) return 1100;
  if (utility.states.includes('ME') || utility.states.includes('NH') ||
      utility.states.includes('VT') || utility.states.includes('MA')) return 1050;
  return 1250;
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