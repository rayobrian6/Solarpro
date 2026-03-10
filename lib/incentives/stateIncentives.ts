/**
 * lib/incentives/stateIncentives.ts
 * Comprehensive solar incentive database for all 50 U.S. states.
 * Includes state tax credits, rebates, SRECs, property tax exemptions, sales tax exemptions.
 * Data current as of 2024 — sources: DSIRE, SEIA, state energy offices.
 */

export type IncentiveType =
  | 'federal_itc'
  | 'state_tax_credit'
  | 'state_rebate'
  | 'utility_rebate'
  | 'srec'
  | 'trec'
  | 'property_tax_exemption'
  | 'sales_tax_exemption'
  | 'net_metering'
  | 'performance_payment'
  | 'loan_program';

export interface Incentive {
  id: string;
  name: string;
  type: IncentiveType;
  // Value
  valueType: 'percent' | 'flat' | 'per_kwh' | 'per_kw' | 'varies';
  value: number;           // percent (0-100) or flat $ or $/kWh or $/kW
  maxValue?: number;       // max $ cap
  // Eligibility
  residential: boolean;
  commercial: boolean;
  // Details
  description: string;
  administrator: string;
  expirationDate?: string;
  websiteUrl?: string;
  // Stackable
  stackable: boolean;      // can be combined with other incentives
}

export interface StateIncentiveProfile {
  stateCode: string;
  stateName: string;
  incentives: Incentive[];
  // Summary
  totalResidentialValue: string;  // e.g. "Up to $15,000"
  solarFriendlyRating: 1 | 2 | 3 | 4 | 5;  // 5 = most incentives
  notes: string[];
}

// ── Federal ITC (applies to all states) ──────────────────────────────────────
export const FEDERAL_ITC: Incentive = {
  id: 'federal_itc_30',
  name: 'Federal Solar Investment Tax Credit (ITC)',
  type: 'federal_itc',
  valueType: 'percent',
  value: 30,
  residential: true,
  commercial: true,
  description: 'Federal tax credit equal to 30% of total solar system cost (equipment + installation). Applies to systems installed through 2032, then steps down to 26% (2033) and 22% (2034).',
  administrator: 'IRS / U.S. Treasury',
  expirationDate: '2032-12-31',
  websiteUrl: 'https://www.energy.gov/eere/solar/homeowners-guide-federal-tax-credit-solar-photovoltaics',
  stackable: true,
};

// ── State incentive database ──────────────────────────────────────────────────
export const STATE_INCENTIVES: Record<string, StateIncentiveProfile> = {
  AL: {
    stateCode: 'AL', stateName: 'Alabama',
    incentives: [],
    totalResidentialValue: 'Federal ITC only',
    solarFriendlyRating: 2,
    notes: ['No state tax credit', 'Property tax exemption varies by county', 'Net metering available from Alabama Power'],
  },
  AK: {
    stateCode: 'AK', stateName: 'Alaska',
    incentives: [
      {
        id: 'ak_rebate', name: 'Alaska Energy Authority Rebate', type: 'state_rebate',
        valueType: 'flat', value: 0, maxValue: 0,
        residential: true, commercial: false,
        description: 'Limited rebate programs available through AEA for rural areas',
        administrator: 'Alaska Energy Authority', stackable: true,
      },
    ],
    totalResidentialValue: 'Federal ITC + limited rebates',
    solarFriendlyRating: 2,
    notes: ['No statewide tax credit', 'Rural energy programs available', 'High electricity rates make solar attractive'],
  },
  AZ: {
    stateCode: 'AZ', stateName: 'Arizona',
    incentives: [
      {
        id: 'az_tax_credit', name: 'Arizona Residential Solar Energy Credit', type: 'state_tax_credit',
        valueType: 'percent', value: 25, maxValue: 1000,
        residential: true, commercial: false,
        description: '25% state income tax credit on solar installation costs, capped at $1,000 per residence.',
        administrator: 'Arizona Department of Revenue',
        websiteUrl: 'https://azdor.gov/tax-credits/solar-energy-credit',
        stackable: true,
      },
      {
        id: 'az_property_tax', name: 'Arizona Solar Property Tax Exemption', type: 'property_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: true,
        description: 'Solar energy systems are exempt from property tax assessment.',
        administrator: 'Arizona Department of Revenue', stackable: true,
      },
      {
        id: 'az_sales_tax', name: 'Arizona Solar Sales Tax Exemption', type: 'sales_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: true,
        description: 'Solar energy equipment is exempt from state sales tax.',
        administrator: 'Arizona Department of Revenue', stackable: true,
      },
    ],
    totalResidentialValue: 'Up to $1,000 state credit + property/sales tax exemptions',
    solarFriendlyRating: 4,
    notes: ['Strong solar resource', 'APS/SRP have utility rebate programs (check current availability)', 'HOA cannot prohibit solar'],
  },
  AR: {
    stateCode: 'AR', stateName: 'Arkansas',
    incentives: [
      {
        id: 'ar_property_tax', name: 'Arkansas Solar Property Tax Exemption', type: 'property_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: false,
        description: 'Residential solar systems exempt from property tax.',
        administrator: 'Arkansas Assessment Coordination Division', stackable: true,
      },
    ],
    totalResidentialValue: 'Federal ITC + property tax exemption',
    solarFriendlyRating: 2,
    notes: ['No state tax credit', 'Net metering available'],
  },
  CA: {
    stateCode: 'CA', stateName: 'California',
    incentives: [
      {
        id: 'ca_sgip', name: 'Self-Generation Incentive Program (SGIP)', type: 'state_rebate',
        valueType: 'per_kw', value: 200, maxValue: 1000000,
        residential: true, commercial: true,
        description: 'SGIP provides rebates for battery storage systems paired with solar. Residential: up to $200/kWh for storage.',
        administrator: 'CPUC / PG&E / SCE / SDG&E',
        websiteUrl: 'https://www.selfgenca.com/',
        stackable: true,
      },
      {
        id: 'ca_property_tax', name: 'California Solar Property Tax Exclusion', type: 'property_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: true,
        description: 'Active solar energy systems excluded from property tax assessment through 2026.',
        administrator: 'California Board of Equalization', stackable: true,
      },
      {
        id: 'ca_nem3', name: 'NEM 3.0 Net Billing Tariff', type: 'net_metering',
        valueType: 'per_kwh', value: 0.08,
        residential: true, commercial: true,
        description: 'NEM 3.0 (April 2023+): Export compensation at avoided cost (~$0.05-0.08/kWh). Pairs well with battery storage.',
        administrator: 'CPUC / PG&E / SCE / SDG&E', stackable: true,
      },
    ],
    totalResidentialValue: 'SGIP battery rebate + property tax exclusion',
    solarFriendlyRating: 4,
    notes: ['NEM 3.0 reduces export value — battery storage recommended', 'LADWP/SMUD have separate programs', 'Title 24 requires solar on new homes'],
  },
  CO: {
    stateCode: 'CO', stateName: 'Colorado',
    incentives: [
      {
        id: 'co_xcel_rebate', name: 'Xcel Energy Solar*Rewards Program', type: 'utility_rebate',
        valueType: 'per_kw', value: 50, maxValue: 500,
        residential: true, commercial: false,
        description: 'Xcel Energy offers performance-based incentives for solar installations.',
        administrator: 'Xcel Energy', stackable: true,
      },
      {
        id: 'co_property_tax', name: 'Colorado Solar Property Tax Exemption', type: 'property_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: false,
        description: 'Residential solar systems exempt from property tax.',
        administrator: 'Colorado Division of Property Taxation', stackable: true,
      },
      {
        id: 'co_sales_tax', name: 'Colorado Solar Sales Tax Exemption', type: 'sales_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: true,
        description: 'Solar energy equipment exempt from state sales tax.',
        administrator: 'Colorado Department of Revenue', stackable: true,
      },
    ],
    totalResidentialValue: 'Utility rebates + property/sales tax exemptions',
    solarFriendlyRating: 4,
    notes: ['HOA cannot prohibit solar', 'Multiple utility rebate programs available', 'Strong solar resource'],
  },
  CT: {
    stateCode: 'CT', stateName: 'Connecticut',
    incentives: [
      {
        id: 'ct_zrec', name: 'Connecticut Zero-Emission Renewable Energy Credit (ZREC)', type: 'srec',
        valueType: 'per_kwh', value: 0.05,
        residential: true, commercial: true,
        description: 'Long-term contracts for renewable energy credits from solar systems.',
        administrator: 'CT DEEP / Eversource / UI', stackable: true,
      },
      {
        id: 'ct_residential_solar', name: 'CT Green Bank Residential Solar Loan', type: 'loan_program',
        valueType: 'flat', value: 0,
        residential: true, commercial: false,
        description: 'Low-interest solar loans through CT Green Bank Smart-E Loan program.',
        administrator: 'Connecticut Green Bank',
        websiteUrl: 'https://www.ctgreenbank.com/',
        stackable: true,
      },
      {
        id: 'ct_property_tax', name: 'Connecticut Solar Property Tax Exemption', type: 'property_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: false,
        description: 'Residential solar systems exempt from property tax.',
        administrator: 'Connecticut OPM', stackable: true,
      },
    ],
    totalResidentialValue: 'ZREC payments + property tax exemption + low-interest loans',
    solarFriendlyRating: 4,
    notes: ['High electricity rates make solar very attractive', 'CT Green Bank financing available'],
  },
  DE: {
    stateCode: 'DE', stateName: 'Delaware',
    incentives: [
      {
        id: 'de_srec', name: 'Delaware SREC Program', type: 'srec',
        valueType: 'per_kwh', value: 0.025,
        residential: true, commercial: true,
        description: 'Solar Renewable Energy Credits tradeable in the SREC market.',
        administrator: 'Delaware PSC', stackable: true,
      },
      {
        id: 'de_green_energy', name: 'Delaware Green Energy Program Rebate', type: 'state_rebate',
        valueType: 'per_kw', value: 100, maxValue: 500,
        residential: true, commercial: false,
        description: 'Rebate for residential solar installations.',
        administrator: 'Delaware DNREC', stackable: true,
      },
    ],
    totalResidentialValue: 'Up to $500 rebate + SREC income',
    solarFriendlyRating: 3,
    notes: ['SREC market active', 'Net metering at retail rate'],
  },
  FL: {
    stateCode: 'FL', stateName: 'Florida',
    incentives: [
      {
        id: 'fl_property_tax', name: 'Florida Solar Property Tax Exemption', type: 'property_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: false,
        description: 'Residential solar systems are exempt from property tax assessment.',
        administrator: 'Florida Department of Revenue', stackable: true,
      },
      {
        id: 'fl_sales_tax', name: 'Florida Solar Sales Tax Exemption', type: 'sales_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: true,
        description: 'Solar energy equipment exempt from Florida sales tax (6%).',
        administrator: 'Florida Department of Revenue', stackable: true,
      },
    ],
    totalResidentialValue: 'Property + sales tax exemptions (saves ~$1,500-3,000)',
    solarFriendlyRating: 4,
    notes: ['No state income tax credit', 'Strong solar resource', 'Net metering at retail rate', 'FPL has limited rebate programs'],
  },
  GA: {
    stateCode: 'GA', stateName: 'Georgia',
    incentives: [
      {
        id: 'ga_property_tax', name: 'Georgia Solar Property Tax Exemption', type: 'property_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: false,
        description: 'Solar energy systems exempt from property tax.',
        administrator: 'Georgia Department of Revenue', stackable: true,
      },
    ],
    totalResidentialValue: 'Federal ITC + property tax exemption',
    solarFriendlyRating: 3,
    notes: ['No state tax credit', 'Georgia Power has limited solar programs', 'Net metering available but limited'],
  },
  HI: {
    stateCode: 'HI', stateName: 'Hawaii',
    incentives: [
      {
        id: 'hi_tax_credit', name: 'Hawaii Renewable Energy Technologies Income Tax Credit', type: 'state_tax_credit',
        valueType: 'percent', value: 35, maxValue: 5000,
        residential: true, commercial: false,
        description: '35% state income tax credit on solar installation costs, capped at $5,000 per system.',
        administrator: 'Hawaii Department of Taxation',
        websiteUrl: 'https://tax.hawaii.gov/',
        stackable: true,
      },
      {
        id: 'hi_property_tax', name: 'Hawaii Solar Property Tax Exemption', type: 'property_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: false,
        description: 'Solar energy systems exempt from property tax.',
        administrator: 'County Tax Offices', stackable: true,
      },
    ],
    totalResidentialValue: 'Up to $5,000 state credit + property tax exemption',
    solarFriendlyRating: 5,
    notes: ['Highest electricity rates in US — excellent ROI', 'CSS program replaces NEM', 'Battery storage highly recommended'],
  },
  ID: {
    stateCode: 'ID', stateName: 'Idaho',
    incentives: [
      {
        id: 'id_deduction', name: 'Idaho Residential Alternative Energy Deduction', type: 'state_tax_credit',
        valueType: 'percent', value: 40, maxValue: 5000,
        residential: true, commercial: false,
        description: '40% deduction on solar installation costs in year 1, then 20% for next 3 years. Max $5,000/year.',
        administrator: 'Idaho State Tax Commission', stackable: true,
      },
    ],
    totalResidentialValue: 'Up to $5,000/year deduction over 4 years',
    solarFriendlyRating: 3,
    notes: ['Low electricity rates reduce payback benefit', 'Net metering at retail rate'],
  },
  IL: {
    stateCode: 'IL', stateName: 'Illinois',
    incentives: [
      {
        id: 'il_shines', name: 'Illinois Shines (Adjustable Block Program)', type: 'srec',
        valueType: 'per_kwh', value: 0.075,
        residential: true, commercial: true,
        description: 'Illinois Shines provides Renewable Energy Credits (RECs) for solar. Residential systems receive upfront payment for 15 years of RECs.',
        administrator: 'Illinois Power Agency',
        websiteUrl: 'https://illinoisshines.com/',
        stackable: true,
      },
      {
        id: 'il_property_tax', name: 'Illinois Solar Property Tax Exemption', type: 'property_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: false,
        description: 'Solar energy systems exempt from property tax for 4 years.',
        administrator: 'Illinois Department of Revenue', stackable: true,
      },
      {
        id: 'il_sales_tax', name: 'Illinois Solar Sales Tax Exemption', type: 'sales_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: true,
        description: 'Solar energy equipment exempt from state sales tax.',
        administrator: 'Illinois Department of Revenue', stackable: true,
      },
    ],
    totalResidentialValue: 'Illinois Shines REC payment (~$5,000-15,000) + tax exemptions',
    solarFriendlyRating: 5,
    notes: ['Illinois Shines provides significant upfront value', 'Net metering at retail rate', 'ComEd/Ameren service territories'],
  },
  IN: {
    stateCode: 'IN', stateName: 'Indiana',
    incentives: [
      {
        id: 'in_property_tax', name: 'Indiana Solar Property Tax Deduction', type: 'property_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: false,
        description: 'Solar energy systems exempt from property tax assessment.',
        administrator: 'Indiana Department of Local Government Finance', stackable: true,
      },
      {
        id: 'in_sales_tax', name: 'Indiana Solar Sales Tax Exemption', type: 'sales_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: true,
        description: 'Solar energy equipment exempt from Indiana sales tax.',
        administrator: 'Indiana Department of Revenue', stackable: true,
      },
    ],
    totalResidentialValue: 'Federal ITC + property/sales tax exemptions',
    solarFriendlyRating: 3,
    notes: ['Net metering at retail rate', 'No state tax credit'],
  },
  IA: {
    stateCode: 'IA', stateName: 'Iowa',
    incentives: [
      {
        id: 'ia_tax_credit', name: 'Iowa Solar Energy System Tax Credit', type: 'state_tax_credit',
        valueType: 'percent', value: 15, maxValue: 5000,
        residential: true, commercial: true,
        description: '15% state tax credit on solar installation costs, capped at $5,000.',
        administrator: 'Iowa Department of Revenue', stackable: true,
      },
      {
        id: 'ia_property_tax', name: 'Iowa Solar Property Tax Exemption', type: 'property_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: false,
        description: 'Solar energy systems exempt from property tax for 5 years.',
        administrator: 'Iowa Department of Revenue', stackable: true,
      },
      {
        id: 'ia_sales_tax', name: 'Iowa Solar Sales Tax Exemption', type: 'sales_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: true,
        description: 'Solar energy equipment exempt from Iowa sales tax.',
        administrator: 'Iowa Department of Revenue', stackable: true,
      },
    ],
    totalResidentialValue: 'Up to $5,000 state credit + property/sales tax exemptions',
    solarFriendlyRating: 4,
    notes: ['Strong incentive package', 'Net metering at retail rate'],
  },
  KS: {
    stateCode: 'KS', stateName: 'Kansas',
    incentives: [
      {
        id: 'ks_property_tax', name: 'Kansas Solar Property Tax Exemption', type: 'property_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: false,
        description: 'Solar energy systems exempt from property tax.',
        administrator: 'Kansas Department of Revenue', stackable: true,
      },
    ],
    totalResidentialValue: 'Federal ITC + property tax exemption',
    solarFriendlyRating: 2,
    notes: ['No state tax credit', 'Net metering available'],
  },
  KY: {
    stateCode: 'KY', stateName: 'Kentucky',
    incentives: [
      {
        id: 'ky_property_tax', name: 'Kentucky Solar Property Tax Exemption', type: 'property_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: false,
        description: 'Solar energy systems exempt from property tax.',
        administrator: 'Kentucky Department of Revenue', stackable: true,
      },
    ],
    totalResidentialValue: 'Federal ITC + property tax exemption',
    solarFriendlyRating: 2,
    notes: ['No state tax credit', 'Net metering at retail rate'],
  },
  LA: {
    stateCode: 'LA', stateName: 'Louisiana',
    incentives: [
      {
        id: 'la_property_tax', name: 'Louisiana Solar Property Tax Exemption', type: 'property_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: false,
        description: 'Solar energy systems exempt from property tax.',
        administrator: 'Louisiana Tax Commission', stackable: true,
      },
      {
        id: 'la_sales_tax', name: 'Louisiana Solar Sales Tax Exemption', type: 'sales_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: true,
        description: 'Solar energy equipment exempt from state sales tax.',
        administrator: 'Louisiana Department of Revenue', stackable: true,
      },
    ],
    totalResidentialValue: 'Federal ITC + property/sales tax exemptions',
    solarFriendlyRating: 3,
    notes: ['No state tax credit', 'Net metering available'],
  },
  ME: {
    stateCode: 'ME', stateName: 'Maine',
    incentives: [
      {
        id: 'me_property_tax', name: 'Maine Solar Property Tax Exemption', type: 'property_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: false,
        description: 'Solar energy systems exempt from property tax.',
        administrator: 'Maine Revenue Services', stackable: true,
      },
      {
        id: 'me_sales_tax', name: 'Maine Solar Sales Tax Exemption', type: 'sales_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: true,
        description: 'Solar energy equipment exempt from Maine sales tax.',
        administrator: 'Maine Revenue Services', stackable: true,
      },
    ],
    totalResidentialValue: 'Federal ITC + property/sales tax exemptions',
    solarFriendlyRating: 3,
    notes: ['High electricity rates improve ROI', 'Net metering at retail rate'],
  },
  MD: {
    stateCode: 'MD', stateName: 'Maryland',
    incentives: [
      {
        id: 'md_srec', name: 'Maryland SREC Program', type: 'srec',
        valueType: 'per_kwh', value: 0.04,
        residential: true, commercial: true,
        description: 'Solar Renewable Energy Credits (SRECs) tradeable in MD market. Value varies with market.',
        administrator: 'Maryland PSC', stackable: true,
      },
      {
        id: 'md_grant', name: 'Maryland Residential Clean Energy Grant', type: 'state_rebate',
        valueType: 'flat', value: 1000, maxValue: 1000,
        residential: true, commercial: false,
        description: '$1,000 grant for residential solar installations.',
        administrator: 'Maryland Energy Administration',
        websiteUrl: 'https://energy.maryland.gov/',
        stackable: true,
      },
      {
        id: 'md_property_tax', name: 'Maryland Solar Property Tax Credit', type: 'property_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: false,
        description: 'Solar energy systems exempt from property tax.',
        administrator: 'Maryland Department of Assessments and Taxation', stackable: true,
      },
      {
        id: 'md_sales_tax', name: 'Maryland Solar Sales Tax Exemption', type: 'sales_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: true,
        description: 'Solar energy equipment exempt from Maryland sales tax.',
        administrator: 'Maryland Comptroller', stackable: true,
      },
    ],
    totalResidentialValue: '$1,000 grant + SREC income + property/sales tax exemptions',
    solarFriendlyRating: 4,
    notes: ['Active SREC market', 'Net metering at retail rate', 'BGE/Pepco service territories'],
  },
  MA: {
    stateCode: 'MA', stateName: 'Massachusetts',
    incentives: [
      {
        id: 'ma_smart', name: 'Massachusetts SMART Program', type: 'performance_payment',
        valueType: 'per_kwh', value: 0.10,
        residential: true, commercial: true,
        description: 'Solar Massachusetts Renewable Target (SMART): fixed incentive payments for 10 years based on production. Rate varies by utility and block.',
        administrator: 'MA DOER / Eversource / National Grid / Unitil',
        websiteUrl: 'https://www.mass.gov/solar-massachusetts-renewable-target-smart-program',
        stackable: true,
      },
      {
        id: 'ma_tax_credit', name: 'Massachusetts Residential Solar Tax Credit', type: 'state_tax_credit',
        valueType: 'percent', value: 15, maxValue: 1000,
        residential: true, commercial: false,
        description: '15% state income tax credit on solar installation costs, capped at $1,000.',
        administrator: 'Massachusetts Department of Revenue', stackable: true,
      },
      {
        id: 'ma_property_tax', name: 'Massachusetts Solar Property Tax Exemption', type: 'property_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: false,
        description: 'Solar energy systems exempt from property tax for 20 years.',
        administrator: 'Massachusetts DOR', stackable: true,
      },
      {
        id: 'ma_sales_tax', name: 'Massachusetts Solar Sales Tax Exemption', type: 'sales_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: true,
        description: 'Solar energy equipment exempt from Massachusetts sales tax.',
        administrator: 'Massachusetts DOR', stackable: true,
      },
    ],
    totalResidentialValue: 'SMART payments (~$3,000-8,000) + $1,000 state credit + tax exemptions',
    solarFriendlyRating: 5,
    notes: ['SMART program provides significant long-term value', 'High electricity rates', 'Net metering at retail rate'],
  },
  MI: {
    stateCode: 'MI', stateName: 'Michigan',
    incentives: [
      {
        id: 'mi_property_tax', name: 'Michigan Solar Property Tax Exemption', type: 'property_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: false,
        description: 'Solar energy systems exempt from property tax.',
        administrator: 'Michigan Department of Treasury', stackable: true,
      },
      {
        id: 'mi_sales_tax', name: 'Michigan Solar Sales Tax Exemption', type: 'sales_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: true,
        description: 'Solar energy equipment exempt from Michigan sales tax.',
        administrator: 'Michigan Department of Treasury', stackable: true,
      },
    ],
    totalResidentialValue: 'Federal ITC + property/sales tax exemptions',
    solarFriendlyRating: 3,
    notes: ['Inflow/Outflow billing (not full retail NEM)', 'DTE/Consumers Energy programs available'],
  },
  MN: {
    stateCode: 'MN', stateName: 'Minnesota',
    incentives: [
      {
        id: 'mn_xcel_solar_rewards', name: 'Xcel Energy Solar*Rewards Program', type: 'performance_payment',
        valueType: 'per_kwh', value: 0.08,
        residential: true, commercial: false,
        description: 'Performance-based incentive for solar production from Xcel Energy.',
        administrator: 'Xcel Energy', stackable: true,
      },
      {
        id: 'mn_property_tax', name: 'Minnesota Solar Property Tax Exemption', type: 'property_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: false,
        description: 'Solar energy systems exempt from property tax.',
        administrator: 'Minnesota Department of Revenue', stackable: true,
      },
      {
        id: 'mn_sales_tax', name: 'Minnesota Solar Sales Tax Exemption', type: 'sales_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: true,
        description: 'Solar energy equipment exempt from Minnesota sales tax.',
        administrator: 'Minnesota Department of Revenue', stackable: true,
      },
    ],
    totalResidentialValue: 'Xcel performance payments + property/sales tax exemptions',
    solarFriendlyRating: 4,
    notes: ['Net metering at retail rate', 'Xcel Solar*Rewards available in Xcel territory'],
  },
  MS: {
    stateCode: 'MS', stateName: 'Mississippi',
    incentives: [],
    totalResidentialValue: 'Federal ITC only',
    solarFriendlyRating: 2,
    notes: ['No state incentives', 'Net metering available', 'Low electricity rates reduce ROI'],
  },
  MO: {
    stateCode: 'MO', stateName: 'Missouri',
    incentives: [
      {
        id: 'mo_property_tax', name: 'Missouri Solar Property Tax Exemption', type: 'property_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: false,
        description: 'Solar energy systems exempt from property tax.',
        administrator: 'Missouri State Tax Commission', stackable: true,
      },
    ],
    totalResidentialValue: 'Federal ITC + property tax exemption',
    solarFriendlyRating: 2,
    notes: ['No state tax credit', 'Net metering at retail rate'],
  },
  MT: {
    stateCode: 'MT', stateName: 'Montana',
    incentives: [
      {
        id: 'mt_tax_credit', name: 'Montana Alternative Energy System Tax Credit', type: 'state_tax_credit',
        valueType: 'percent', value: 100, maxValue: 500,
        residential: true, commercial: false,
        description: 'Tax credit up to $500 for residential solar installations.',
        administrator: 'Montana Department of Revenue', stackable: true,
      },
      {
        id: 'mt_property_tax', name: 'Montana Solar Property Tax Exemption', type: 'property_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: false,
        description: 'Solar energy systems exempt from property tax.',
        administrator: 'Montana Department of Revenue', stackable: true,
      },
    ],
    totalResidentialValue: 'Up to $500 state credit + property tax exemption',
    solarFriendlyRating: 3,
    notes: ['Net metering at retail rate', 'Low electricity rates'],
  },
  NE: {
    stateCode: 'NE', stateName: 'Nebraska',
    incentives: [
      {
        id: 'ne_property_tax', name: 'Nebraska Solar Property Tax Exemption', type: 'property_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: false,
        description: 'Solar energy systems exempt from property tax.',
        administrator: 'Nebraska Department of Revenue', stackable: true,
      },
      {
        id: 'ne_sales_tax', name: 'Nebraska Solar Sales Tax Exemption', type: 'sales_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: true,
        description: 'Solar energy equipment exempt from Nebraska sales tax.',
        administrator: 'Nebraska Department of Revenue', stackable: true,
      },
    ],
    totalResidentialValue: 'Federal ITC + property/sales tax exemptions',
    solarFriendlyRating: 3,
    notes: ['Net metering at retail rate', 'Public power utilities (OPPD, LES, NPPD)'],
  },
  NV: {
    stateCode: 'NV', stateName: 'Nevada',
    incentives: [
      {
        id: 'nv_property_tax', name: 'Nevada Solar Property Tax Abatement', type: 'property_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: true,
        description: 'Solar energy systems exempt from property tax.',
        administrator: 'Nevada Department of Taxation', stackable: true,
      },
      {
        id: 'nv_sales_tax', name: 'Nevada Solar Sales Tax Exemption', type: 'sales_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: true,
        description: 'Solar energy equipment exempt from Nevada sales tax.',
        administrator: 'Nevada Department of Taxation', stackable: true,
      },
    ],
    totalResidentialValue: 'Federal ITC + property/sales tax exemptions',
    solarFriendlyRating: 4,
    notes: ['Excellent solar resource', 'NEM 3.0 reduces export value', 'Battery storage recommended'],
  },
  NH: {
    stateCode: 'NH', stateName: 'New Hampshire',
    incentives: [
      {
        id: 'nh_rebate', name: 'NH Electric Coop Solar Rebate', type: 'utility_rebate',
        valueType: 'per_kw', value: 100, maxValue: 1000,
        residential: true, commercial: false,
        description: 'Rebate for solar installations in NH Electric Coop territory.',
        administrator: 'NH Electric Coop', stackable: true,
      },
      {
        id: 'nh_property_tax', name: 'New Hampshire Solar Property Tax Exemption', type: 'property_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: false,
        description: 'Solar energy systems exempt from property tax.',
        administrator: 'NH DRA', stackable: true,
      },
    ],
    totalResidentialValue: 'Federal ITC + property tax exemption + utility rebates',
    solarFriendlyRating: 3,
    notes: ['High electricity rates improve ROI', 'Net metering at retail rate'],
  },
  NJ: {
    stateCode: 'NJ', stateName: 'New Jersey',
    incentives: [
      {
        id: 'nj_trec', name: 'New Jersey Transition Renewable Energy Certificate (TREC)', type: 'trec',
        valueType: 'per_kwh', value: 0.091,
        residential: true, commercial: true,
        description: 'TRECs pay $91.20 per MWh (9.12¢/kWh) for solar production for 15 years.',
        administrator: 'NJ BPU / PSE&G / JCP&L',
        websiteUrl: 'https://njcleanenergy.com/',
        stackable: true,
      },
      {
        id: 'nj_property_tax', name: 'New Jersey Solar Property Tax Exemption', type: 'property_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: false,
        description: 'Solar energy systems exempt from property tax.',
        administrator: 'NJ Division of Taxation', stackable: true,
      },
      {
        id: 'nj_sales_tax', name: 'New Jersey Solar Sales Tax Exemption', type: 'sales_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: true,
        description: 'Solar energy equipment exempt from NJ sales tax.',
        administrator: 'NJ Division of Taxation', stackable: true,
      },
    ],
    totalResidentialValue: 'TREC payments (~$5,000-12,000 over 15 years) + tax exemptions',
    solarFriendlyRating: 5,
    notes: ['TREC program provides significant long-term value', 'Net metering at retail rate', 'High electricity rates'],
  },
  NM: {
    stateCode: 'NM', stateName: 'New Mexico',
    incentives: [
      {
        id: 'nm_tax_credit', name: 'New Mexico Solar Market Development Tax Credit', type: 'state_tax_credit',
        valueType: 'percent', value: 10, maxValue: 6000,
        residential: true, commercial: true,
        description: '10% state income tax credit on solar installation costs, capped at $6,000.',
        administrator: 'New Mexico Taxation and Revenue Department', stackable: true,
      },
      {
        id: 'nm_property_tax', name: 'New Mexico Solar Property Tax Exemption', type: 'property_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: false,
        description: 'Solar energy systems exempt from property tax.',
        administrator: 'NM Taxation and Revenue', stackable: true,
      },
      {
        id: 'nm_sales_tax', name: 'New Mexico Solar Sales Tax Deduction', type: 'sales_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: true,
        description: 'Solar energy equipment exempt from gross receipts tax.',
        administrator: 'NM Taxation and Revenue', stackable: true,
      },
    ],
    totalResidentialValue: 'Up to $6,000 state credit + property/sales tax exemptions',
    solarFriendlyRating: 4,
    notes: ['Excellent solar resource', 'Net metering at retail rate'],
  },
  NY: {
    stateCode: 'NY', stateName: 'New York',
    incentives: [
      {
        id: 'ny_tax_credit', name: 'New York State Solar Energy System Equipment Credit', type: 'state_tax_credit',
        valueType: 'percent', value: 25, maxValue: 5000,
        residential: true, commercial: false,
        description: '25% state income tax credit on solar installation costs, capped at $5,000.',
        administrator: 'New York State Department of Taxation and Finance',
        websiteUrl: 'https://www.tax.ny.gov/',
        stackable: true,
      },
      {
        id: 'ny_sun', name: 'NY-Sun Incentive Program', type: 'state_rebate',
        valueType: 'per_kw', value: 200, maxValue: 5000,
        residential: true, commercial: false,
        description: 'NY-Sun provides upfront incentives for residential solar installations. Amount varies by utility territory and system size.',
        administrator: 'NYSERDA',
        websiteUrl: 'https://www.nyserda.ny.gov/ny-sun',
        stackable: true,
      },
      {
        id: 'ny_property_tax', name: 'New York Solar Property Tax Exemption', type: 'property_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: false,
        description: 'Solar energy systems exempt from property tax for 15 years.',
        administrator: 'NY State Board of Real Property Services', stackable: true,
      },
      {
        id: 'ny_sales_tax', name: 'New York Solar Sales Tax Exemption', type: 'sales_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: true,
        description: 'Solar energy equipment exempt from NY state and local sales tax.',
        administrator: 'NY Department of Taxation and Finance', stackable: true,
      },
    ],
    totalResidentialValue: 'Up to $5,000 state credit + NY-Sun rebate + tax exemptions',
    solarFriendlyRating: 5,
    notes: ['NY-Sun provides significant upfront incentive', 'VDER tariff for export compensation', 'High electricity rates'],
  },
  NC: {
    stateCode: 'NC', stateName: 'North Carolina',
    incentives: [
      {
        id: 'nc_property_tax', name: 'North Carolina Solar Property Tax Exemption', type: 'property_tax_exemption',
        valueType: 'percent', value: 80,
        residential: true, commercial: false,
        description: '80% of solar system value excluded from property tax assessment.',
        administrator: 'NC Department of Revenue', stackable: true,
      },
      {
        id: 'nc_sales_tax', name: 'North Carolina Solar Sales Tax Exemption', type: 'sales_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: true,
        description: 'Solar energy equipment exempt from NC sales tax.',
        administrator: 'NC Department of Revenue', stackable: true,
      },
    ],
    totalResidentialValue: 'Federal ITC + 80% property tax exemption + sales tax exemption',
    solarFriendlyRating: 3,
    notes: ['No state tax credit', 'Net metering at retail rate', 'Duke Energy service territory'],
  },
  ND: {
    stateCode: 'ND', stateName: 'North Dakota',
    incentives: [
      {
        id: 'nd_tax_credit', name: 'North Dakota Renewable Energy Tax Credit', type: 'state_tax_credit',
        valueType: 'percent', value: 3, maxValue: 3000,
        residential: true, commercial: true,
        description: '3% income tax credit on solar installation costs, capped at $3,000.',
        administrator: 'North Dakota Office of State Tax Commissioner', stackable: true,
      },
      {
        id: 'nd_property_tax', name: 'North Dakota Solar Property Tax Exemption', type: 'property_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: false,
        description: 'Solar energy systems exempt from property tax for 5 years.',
        administrator: 'ND State Tax Commissioner', stackable: true,
      },
    ],
    totalResidentialValue: 'Up to $3,000 state credit + property tax exemption',
    solarFriendlyRating: 3,
    notes: ['Net metering at retail rate', 'Low electricity rates'],
  },
  OH: {
    stateCode: 'OH', stateName: 'Ohio',
    incentives: [
      {
        id: 'oh_srec', name: 'Ohio SREC Market', type: 'srec',
        valueType: 'per_kwh', value: 0.01,
        residential: true, commercial: true,
        description: 'Ohio SRECs tradeable in regional market. Value varies.',
        administrator: 'Ohio PUC', stackable: true,
      },
      {
        id: 'oh_property_tax', name: 'Ohio Solar Property Tax Exemption', type: 'property_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: false,
        description: 'Solar energy systems exempt from property tax.',
        administrator: 'Ohio Department of Taxation', stackable: true,
      },
      {
        id: 'oh_sales_tax', name: 'Ohio Solar Sales Tax Exemption', type: 'sales_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: true,
        description: 'Solar energy equipment exempt from Ohio sales tax.',
        administrator: 'Ohio Department of Taxation', stackable: true,
      },
    ],
    totalResidentialValue: 'Federal ITC + SREC income + property/sales tax exemptions',
    solarFriendlyRating: 3,
    notes: ['Net metering at retail rate', 'SREC market active'],
  },
  OK: {
    stateCode: 'OK', stateName: 'Oklahoma',
    incentives: [
      {
        id: 'ok_property_tax', name: 'Oklahoma Solar Property Tax Exemption', type: 'property_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: false,
        description: 'Solar energy systems exempt from property tax.',
        administrator: 'Oklahoma Tax Commission', stackable: true,
      },
    ],
    totalResidentialValue: 'Federal ITC + property tax exemption',
    solarFriendlyRating: 2,
    notes: ['No state tax credit', 'Net metering available'],
  },
  OR: {
    stateCode: 'OR', stateName: 'Oregon',
    incentives: [
      {
        id: 'or_rebate', name: 'Oregon Solar + Storage Rebate Program', type: 'state_rebate',
        valueType: 'flat', value: 5000, maxValue: 5000,
        residential: true, commercial: false,
        description: 'Oregon offers rebates up to $5,000 for solar + storage systems. Income-qualified households may receive higher amounts.',
        administrator: 'Oregon Department of Energy',
        websiteUrl: 'https://www.oregon.gov/energy/Incentives/',
        stackable: true,
      },
      {
        id: 'or_property_tax', name: 'Oregon Solar Property Tax Exemption', type: 'property_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: false,
        description: 'Solar energy systems exempt from property tax.',
        administrator: 'Oregon Department of Revenue', stackable: true,
      },
    ],
    totalResidentialValue: 'Up to $5,000 rebate + property tax exemption',
    solarFriendlyRating: 4,
    notes: ['Net metering at retail rate', 'Income-qualified rebates available'],
  },
  PA: {
    stateCode: 'PA', stateName: 'Pennsylvania',
    incentives: [
      {
        id: 'pa_srec', name: 'Pennsylvania SREC Market', type: 'srec',
        valueType: 'per_kwh', value: 0.04,
        residential: true, commercial: true,
        description: 'Pennsylvania SRECs tradeable in regional market. Value varies with market conditions.',
        administrator: 'PA PUC', stackable: true,
      },
      {
        id: 'pa_property_tax', name: 'Pennsylvania Solar Property Tax Exemption', type: 'property_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: false,
        description: 'Solar energy systems exempt from property tax.',
        administrator: 'PA Department of Revenue', stackable: true,
      },
      {
        id: 'pa_sales_tax', name: 'Pennsylvania Solar Sales Tax Exemption', type: 'sales_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: true,
        description: 'Solar energy equipment exempt from PA sales tax.',
        administrator: 'PA Department of Revenue', stackable: true,
      },
    ],
    totalResidentialValue: 'Federal ITC + SREC income + property/sales tax exemptions',
    solarFriendlyRating: 4,
    notes: ['Active SREC market', 'Net metering at retail rate', 'PECO/PPL service territories'],
  },
  RI: {
    stateCode: 'RI', stateName: 'Rhode Island',
    incentives: [
      {
        id: 'ri_srec', name: 'Rhode Island SREC Program', type: 'srec',
        valueType: 'per_kwh', value: 0.03,
        residential: true, commercial: true,
        description: 'Rhode Island SRECs tradeable in regional market.',
        administrator: 'RI PUC', stackable: true,
      },
      {
        id: 'ri_property_tax', name: 'Rhode Island Solar Property Tax Exemption', type: 'property_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: false,
        description: 'Solar energy systems exempt from property tax.',
        administrator: 'RI Division of Taxation', stackable: true,
      },
      {
        id: 'ri_sales_tax', name: 'Rhode Island Solar Sales Tax Exemption', type: 'sales_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: true,
        description: 'Solar energy equipment exempt from RI sales tax.',
        administrator: 'RI Division of Taxation', stackable: true,
      },
    ],
    totalResidentialValue: 'Federal ITC + SREC income + property/sales tax exemptions',
    solarFriendlyRating: 4,
    notes: ['High electricity rates', 'Net metering at retail rate'],
  },
  SC: {
    stateCode: 'SC', stateName: 'South Carolina',
    incentives: [
      {
        id: 'sc_tax_credit', name: 'South Carolina Solar Energy Tax Credit', type: 'state_tax_credit',
        valueType: 'percent', value: 25, maxValue: 3500,
        residential: true, commercial: false,
        description: '25% state income tax credit on solar installation costs, capped at $3,500.',
        administrator: 'South Carolina Department of Revenue', stackable: true,
      },
      {
        id: 'sc_property_tax', name: 'South Carolina Solar Property Tax Exemption', type: 'property_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: false,
        description: 'Solar energy systems exempt from property tax.',
        administrator: 'SC Department of Revenue', stackable: true,
      },
    ],
    totalResidentialValue: 'Up to $3,500 state credit + property tax exemption',
    solarFriendlyRating: 4,
    notes: ['Strong state incentive', 'Net metering at retail rate'],
  },
  SD: {
    stateCode: 'SD', stateName: 'South Dakota',
    incentives: [
      {
        id: 'sd_property_tax', name: 'South Dakota Solar Property Tax Exemption', type: 'property_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: false,
        description: 'Solar energy systems exempt from property tax.',
        administrator: 'SD Department of Revenue', stackable: true,
      },
    ],
    totalResidentialValue: 'Federal ITC + property tax exemption',
    solarFriendlyRating: 2,
    notes: ['No state income tax', 'Net metering at retail rate'],
  },
  TN: {
    stateCode: 'TN', stateName: 'Tennessee',
    incentives: [
      {
        id: 'tn_property_tax', name: 'Tennessee Solar Property Tax Exemption', type: 'property_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: false,
        description: 'Solar energy systems exempt from property tax.',
        administrator: 'TN Department of Revenue', stackable: true,
      },
    ],
    totalResidentialValue: 'Federal ITC + property tax exemption',
    solarFriendlyRating: 2,
    notes: ['TVA Generation Partners program', 'No state income tax', 'Limited net metering'],
  },
  TX: {
    stateCode: 'TX', stateName: 'Texas',
    incentives: [
      {
        id: 'tx_property_tax', name: 'Texas Solar Property Tax Exemption', type: 'property_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: false,
        description: 'Solar energy systems exempt from property tax assessment.',
        administrator: 'Texas Comptroller', stackable: true,
      },
      {
        id: 'tx_austin_energy', name: 'Austin Energy Value of Solar Tariff', type: 'performance_payment',
        valueType: 'per_kwh', value: 0.097,
        residential: true, commercial: false,
        description: 'Austin Energy pays ~9.7¢/kWh for all solar production (Value of Solar tariff).',
        administrator: 'Austin Energy', stackable: true,
      },
      {
        id: 'tx_cps_rebate', name: 'CPS Energy Solar Rebate', type: 'utility_rebate',
        valueType: 'per_kw', value: 600, maxValue: 2400,
        residential: true, commercial: false,
        description: 'CPS Energy (San Antonio) offers $600/kW rebate for residential solar.',
        administrator: 'CPS Energy', stackable: true,
      },
    ],
    totalResidentialValue: 'Property tax exemption + utility rebates (varies by utility)',
    solarFriendlyRating: 3,
    notes: ['No statewide net metering', 'Utility-specific programs vary significantly', 'No state income tax'],
  },
  UT: {
    stateCode: 'UT', stateName: 'Utah',
    incentives: [
      {
        id: 'ut_tax_credit', name: 'Utah Renewable Energy Systems Tax Credit', type: 'state_tax_credit',
        valueType: 'percent', value: 25, maxValue: 2000,
        residential: true, commercial: false,
        description: '25% state income tax credit on solar installation costs, capped at $2,000.',
        administrator: 'Utah State Tax Commission', stackable: true,
      },
      {
        id: 'ut_property_tax', name: 'Utah Solar Property Tax Exemption', type: 'property_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: false,
        description: 'Solar energy systems exempt from property tax.',
        administrator: 'Utah State Tax Commission', stackable: true,
      },
      {
        id: 'ut_sales_tax', name: 'Utah Solar Sales Tax Exemption', type: 'sales_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: true,
        description: 'Solar energy equipment exempt from Utah sales tax.',
        administrator: 'Utah State Tax Commission', stackable: true,
      },
    ],
    totalResidentialValue: 'Up to $2,000 state credit + property/sales tax exemptions',
    solarFriendlyRating: 4,
    notes: ['Excellent solar resource', 'Net metering at retail rate', 'Rocky Mountain Power territory'],
  },
  VT: {
    stateCode: 'VT', stateName: 'Vermont',
    incentives: [
      {
        id: 'vt_property_tax', name: 'Vermont Solar Property Tax Exemption', type: 'property_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: false,
        description: 'Solar energy systems exempt from property tax.',
        administrator: 'Vermont Department of Taxes', stackable: true,
      },
      {
        id: 'vt_sales_tax', name: 'Vermont Solar Sales Tax Exemption', type: 'sales_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: true,
        description: 'Solar energy equipment exempt from Vermont sales tax.',
        administrator: 'Vermont Department of Taxes', stackable: true,
      },
    ],
    totalResidentialValue: 'Federal ITC + property/sales tax exemptions',
    solarFriendlyRating: 3,
    notes: ['High electricity rates', 'Net metering at retail rate', 'Green Mountain Power programs'],
  },
  VA: {
    stateCode: 'VA', stateName: 'Virginia',
    incentives: [
      {
        id: 'va_property_tax', name: 'Virginia Solar Property Tax Exemption', type: 'property_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: false,
        description: 'Solar energy systems exempt from property tax.',
        administrator: 'Virginia Department of Taxation', stackable: true,
      },
      {
        id: 'va_sales_tax', name: 'Virginia Solar Sales Tax Exemption', type: 'sales_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: true,
        description: 'Solar energy equipment exempt from Virginia sales tax.',
        administrator: 'Virginia Department of Taxation', stackable: true,
      },
    ],
    totalResidentialValue: 'Federal ITC + property/sales tax exemptions',
    solarFriendlyRating: 3,
    notes: ['Net metering at retail rate', 'Dominion Energy territory', 'SREC market developing'],
  },
  WA: {
    stateCode: 'WA', stateName: 'Washington',
    incentives: [
      {
        id: 'wa_sales_tax', name: 'Washington Solar Sales Tax Exemption', type: 'sales_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: true,
        description: 'Solar energy equipment exempt from Washington sales tax (9.5%).',
        administrator: 'Washington Department of Revenue', stackable: true,
      },
      {
        id: 'wa_property_tax', name: 'Washington Solar Property Tax Exemption', type: 'property_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: false,
        description: 'Solar energy systems exempt from property tax.',
        administrator: 'Washington Department of Revenue', stackable: true,
      },
    ],
    totalResidentialValue: 'Federal ITC + property/sales tax exemptions (saves ~$1,500-3,000)',
    solarFriendlyRating: 3,
    notes: ['No state income tax', 'Net metering at retail rate', 'Low electricity rates reduce ROI'],
  },
  WV: {
    stateCode: 'WV', stateName: 'West Virginia',
    incentives: [],
    totalResidentialValue: 'Federal ITC only',
    solarFriendlyRating: 1,
    notes: ['No state incentives', 'Net metering available', 'Low electricity rates'],
  },
  WI: {
    stateCode: 'WI', stateName: 'Wisconsin',
    incentives: [
      {
        id: 'wi_focus_rebate', name: 'Focus on Energy Solar Rebate', type: 'utility_rebate',
        valueType: 'flat', value: 500, maxValue: 2000,
        residential: true, commercial: false,
        description: 'Focus on Energy program offers rebates for residential solar installations.',
        administrator: 'Focus on Energy / We Energies / WPS',
        websiteUrl: 'https://focusonenergy.com/',
        stackable: true,
      },
      {
        id: 'wi_property_tax', name: 'Wisconsin Solar Property Tax Exemption', type: 'property_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: false,
        description: 'Solar energy systems exempt from property tax.',
        administrator: 'Wisconsin Department of Revenue', stackable: true,
      },
      {
        id: 'wi_sales_tax', name: 'Wisconsin Solar Sales Tax Exemption', type: 'sales_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: true,
        description: 'Solar energy equipment exempt from Wisconsin sales tax.',
        administrator: 'Wisconsin Department of Revenue', stackable: true,
      },
    ],
    totalResidentialValue: 'Up to $2,000 Focus on Energy rebate + property/sales tax exemptions',
    solarFriendlyRating: 3,
    notes: ['Net metering at retail rate', 'Focus on Energy rebates available'],
  },
  WY: {
    stateCode: 'WY', stateName: 'Wyoming',
    incentives: [
      {
        id: 'wy_property_tax', name: 'Wyoming Solar Property Tax Exemption', type: 'property_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: false,
        description: 'Solar energy systems exempt from property tax.',
        administrator: 'Wyoming Department of Revenue', stackable: true,
      },
    ],
    totalResidentialValue: 'Federal ITC + property tax exemption',
    solarFriendlyRating: 2,
    notes: ['No state income tax', 'Net metering at retail rate', 'Low electricity rates'],
  },
  DC: {
    stateCode: 'DC', stateName: 'District of Columbia',
    incentives: [
      {
        id: 'dc_srec', name: 'DC SREC Market', type: 'srec',
        valueType: 'per_kwh', value: 0.40,
        residential: true, commercial: true,
        description: 'DC SRECs are among the most valuable in the country (~$400/MWh). DC has aggressive RPS requirements.',
        administrator: 'DC PSC / DOEE',
        websiteUrl: 'https://doee.dc.gov/',
        stackable: true,
      },
      {
        id: 'dc_property_tax', name: 'DC Solar Property Tax Exemption', type: 'property_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: false,
        description: 'Solar energy systems exempt from property tax.',
        administrator: 'DC Office of Tax and Revenue', stackable: true,
      },
      {
        id: 'dc_sales_tax', name: 'DC Solar Sales Tax Exemption', type: 'sales_tax_exemption',
        valueType: 'percent', value: 100,
        residential: true, commercial: true,
        description: 'Solar energy equipment exempt from DC sales tax.',
        administrator: 'DC Office of Tax and Revenue', stackable: true,
      },
    ],
    totalResidentialValue: 'High-value SREC income (~$400/MWh) + property/sales tax exemptions',
    solarFriendlyRating: 5,
    notes: ['DC SRECs are among the most valuable nationally', 'Net metering at retail rate', 'High electricity rates'],
  },
};

// ── Get incentives for a state ────────────────────────────────────────────────
export function getStateIncentives(stateCode: string): StateIncentiveProfile | null {
  return STATE_INCENTIVES[stateCode] || null;
}

// ── Calculate total incentive value for a system ─────────────────────────────
export interface IncentiveCalculation {
  incentiveId: string;
  incentiveName: string;
  type: IncentiveType;
  calculatedValue: number;
  description: string;
  notes?: string;
}

export function calculateIncentives(
  stateCode: string,
  systemCost: number,
  systemKw: number,
  annualKwh: number,
  isResidential: boolean = true,
): {
  federal: IncentiveCalculation;
  state: IncentiveCalculation[];
  total: number;
  cashTotal: number;
  nonCashStateTotal: number;
  netSystemCost: number;
  summary: string;
} {
  // Federal ITC
  const federalValue = Math.round(systemCost * (FEDERAL_ITC.value / 100));
  const federal: IncentiveCalculation = {
    incentiveId: FEDERAL_ITC.id,
    incentiveName: FEDERAL_ITC.name,
    type: FEDERAL_ITC.type,
    calculatedValue: federalValue,
    description: `${FEDERAL_ITC.value}% × $${systemCost.toLocaleString()} system cost`,
  };

  // State incentives
  const profile = STATE_INCENTIVES[stateCode];
  const stateCalcs: IncentiveCalculation[] = [];

  if (profile) {
    for (const incentive of profile.incentives) {
      if (isResidential && !incentive.residential) continue;
      if (!isResidential && !incentive.commercial) continue;

      let value = 0;
      let description = '';

      switch (incentive.valueType) {
        case 'percent':
          value = Math.min(
            Math.round(systemCost * (incentive.value / 100)),
            incentive.maxValue || Infinity
          );
          description = `${incentive.value}% × $${systemCost.toLocaleString()}${incentive.maxValue ? ` (capped at $${incentive.maxValue.toLocaleString()})` : ''}`;
          break;
        case 'flat':
          value = Math.min(incentive.value, incentive.maxValue || incentive.value);
          description = `Flat rebate: $${value.toLocaleString()}`;
          break;
        case 'per_kw':
          value = Math.min(
            Math.round(incentive.value * systemKw),
            incentive.maxValue || Infinity
          );
          description = `$${incentive.value}/kW × ${systemKw} kW${incentive.maxValue ? ` (capped at $${incentive.maxValue.toLocaleString()})` : ''}`;
          break;
        case 'per_kwh':
          // For SRECs/TRECs: estimate 15-year value
          const years = incentive.type === 'srec' || incentive.type === 'trec' ? 15 : 10;
          value = Math.round(incentive.value * annualKwh * years);
          description = `$${incentive.value}/kWh × ${annualKwh.toLocaleString()} kWh/yr × ${years} years`;
          break;
        case 'varies':
          value = 0;
          description = 'Value varies — contact administrator';
          break;
      }

      if (value > 0 || incentive.valueType === 'varies') {
        stateCalcs.push({
          incentiveId: incentive.id,
          incentiveName: incentive.name,
          type: incentive.type,
          calculatedValue: value,
          description,
          notes: incentive.description,
        });
      }
    }
  }

  // ── Separate CASH incentives (reduce net cost) from NON-CASH benefits ──────
  // Property tax exemptions and sales tax exemptions do NOT reduce the purchase
  // price — they are ongoing benefits, not upfront cash. SRECs are future income.
  // Only federal ITC, state tax credits, rebates, and utility rebates are cash.
  const CASH_TYPES: IncentiveType[] = [
    'federal_itc', 'state_tax_credit', 'state_rebate', 'utility_rebate', 'performance_payment',
  ];
  const NON_CASH_TYPES: IncentiveType[] = [
    'property_tax_exemption', 'sales_tax_exemption', 'srec', 'trec', 'net_metering', 'loan_program',
  ];

  const cashStateTotal    = stateCalcs.filter(i => CASH_TYPES.includes(i.type)).reduce((s, i) => s + i.calculatedValue, 0);
  const nonCashStateTotal = stateCalcs.filter(i => NON_CASH_TYPES.includes(i.type)).reduce((s, i) => s + i.calculatedValue, 0);
  const stateTotal        = stateCalcs.reduce((s, i) => s + i.calculatedValue, 0);

  // Net system cost = only subtract CASH incentives (ITC + cash rebates/credits)
  const cashTotal      = federalValue + cashStateTotal;
  const netSystemCost  = Math.max(0, systemCost - cashTotal);

  // total = all incentives (for display purposes — clearly labeled in UI)
  const total = federalValue + stateTotal;

  return {
    federal,
    state: stateCalcs,
    total,
    cashTotal,
    nonCashStateTotal,
    netSystemCost,
    summary: `Federal ITC: $${federalValue.toLocaleString()} + Cash Rebates/Credits: $${cashStateTotal.toLocaleString()} = Net Cost: $${netSystemCost.toLocaleString()} (+ $${nonCashStateTotal.toLocaleString()} in non-cash benefits)`,
  };
}