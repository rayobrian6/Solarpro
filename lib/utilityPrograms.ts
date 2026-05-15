/**
 * lib/utilityPrograms.ts
 * v48.27 — Utility-Level Programs & Charge-Type Knowledge Base
 *
 * Per-utility registry of:
 *   - TOU / time-differentiated rate plans (hourly, 2-tier, 3-tier)
 *   - Battery storage incentives & demand-response programs
 *   - Solar / DG rebates
 *   - Special net metering programs (VPP, community solar, export adders)
 *
 * Data sources: Utility tariff filings, DSIRE, utility program pages, EIA, CPUC.
 * Last updated: 2025-06
 *
 * Usage:
 *   import { getUtilityPrograms } from '@/lib/utilityPrograms';
 *   const programs = getUtilityPrograms('ameren_il');
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type TouPeriod = 'on_peak' | 'mid_peak' | 'off_peak' | 'super_off_peak';
export type ProgramType =
  | 'tou_rate'          // Time-of-use rate plan
  | 'hourly_pricing'    // Real-time / hourly wholesale-based pricing
  | 'battery_incentive' // Storage rebate / lease / demand-response payment
  | 'solar_rebate'      // Per-kW or per-kWh solar installation rebate
  | 'nem_special'       // Enhanced or special NEM/net-billing program
  | 'vpp'               // Virtual Power Plant program
  | 'demand_response'   // DR program (non-battery)
  | 'ev_rate'           // EV-specific TOU rate
  | 'community_solar';  // Community / shared solar program

export type ProgramStatus = 'active' | 'limited' | 'waitlist' | 'pilot' | 'expired';

/** A single period block in a TOU rate plan */
export interface TouPeriodRate {
  period: TouPeriod;
  label: string;               // e.g. "On-Peak", "Super Off-Peak"
  hours_description: string;   // human-readable hours e.g. "4–9 PM daily"
  summer_rate_per_kwh?: number; // $/kWh during summer (Jun–Sep typical)
  winter_rate_per_kwh?: number; // $/kWh during winter (Oct–May typical)
  applies_weekends?: boolean;   // whether on-peak applies on weekends
  applies_holidays?: boolean;   // whether on-peak applies on holidays
}

/** Full TOU rate plan definition */
export interface TouRatePlan {
  plan_id: string;
  plan_name: string;
  plan_description: string;
  /** Which utility_ids this plan applies to */
  utility_ids: string[];
  type: 'tou_rate' | 'hourly_pricing' | 'ev_rate';
  /** True if this plan is recommended for solar customers */
  solar_friendly: boolean;
  /** True if this plan is recommended for battery owners */
  battery_optimized: boolean;
  /** True if this plan is available to solar NEM customers */
  nem_compatible: boolean;
  /** True if net metering must be dropped to use this plan */
  requires_drop_nem: boolean;
  periods: TouPeriodRate[];
  /** Demand charge per kW (if any) */
  demand_charge_per_kw?: number;
  demand_charge_note?: string;
  /** Optional enrollment URL */
  enrollment_url?: string;
  /** Eligibility note (e.g. "requires smart meter") */
  eligibility_note?: string;
  /** Solar Pro recommendation text shown in proposal/engineering */
  solar_pro_note: string;
  last_verified: string; // YYYY-MM
}

/** Battery / storage incentive program */
export interface BatteryIncentiveProgram {
  program_id: string;
  program_name: string;
  utility_ids: string[];        // which utility profiles this applies to
  type: 'battery_incentive' | 'vpp' | 'demand_response';
  status: ProgramStatus;
  /** Incentive value description (human-readable) */
  value_description: string;
  /** Annual payment or one-time rebate in $ */
  value_per_kwh_capacity?: number;  // $/kWh of battery capacity (one-time rebate)
  value_annual_per_kw?: number;     // $/kW annual demand-response payment
  value_flat?: number;              // flat $ amount (one-time)
  max_value?: number;               // cap in $
  /** Battery size requirements */
  min_battery_kwh?: number;
  max_battery_kwh?: number;
  /** Dispatch constraints (utility controls battery during events) */
  utility_dispatch: boolean;
  max_dispatch_events_per_year?: number;
  max_dispatch_hours_per_event?: number;
  /** Enrollment URL */
  enrollment_url?: string;
  program_description: string;
  solar_pro_note: string;
  last_verified: string;
}

/** Solar installation rebate */
export interface SolarRebateProgram {
  program_id: string;
  program_name: string;
  utility_ids: string[];
  type: 'solar_rebate';
  status: ProgramStatus;
  value_description: string;
  value_per_kw?: number;            // $/W or $/kW rebate
  value_flat?: number;              // flat $ rebate
  value_per_kwh_production?: number; // performance-based $/kWh
  max_value?: number;
  max_system_kw?: number;
  stackable_with_federal_itc: boolean;
  enrollment_url?: string;
  program_description: string;
  solar_pro_note: string;
  last_verified: string;
}

/** Special / enhanced net metering program */
export interface NemSpecialProgram {
  program_id: string;
  program_name: string;
  utility_ids: string[];
  type: 'nem_special' | 'community_solar';
  status: ProgramStatus;
  /** Description of what makes this NEM program special */
  program_description: string;
  /** Export credit rate (if fixed) */
  export_rate_per_kwh?: number;
  /** True if export credit varies by TOU period */
  tou_export_credit: boolean;
  /** Annual cap on exports (kWh or $) */
  annual_export_cap_note?: string;
  enrollment_url?: string;
  solar_pro_note: string;
  last_verified: string;
}

/** Combined utility program bundle (returned by getUtilityPrograms) */
export interface UtilityProgramBundle {
  utility_id: string;
  utility_name: string;
  /** Available TOU / rate plans */
  tou_plans: TouRatePlan[];
  /** Battery / VPP / demand-response programs */
  battery_incentives: BatteryIncentiveProgram[];
  /** Solar rebates */
  solar_rebates: SolarRebateProgram[];
  /** Special NEM programs */
  nem_programs: NemSpecialProgram[];
  /** High-level summary for Solar Pro UI */
  summary: string;
}

// ─── TOU Rate Plans Registry ──────────────────────────────────────────────────

export const TOU_RATE_PLANS: TouRatePlan[] = [

  // ── Ameren Illinois: Power Smart Pricing (PSP) ──────────────────────────────
  {
    plan_id: 'ameren_il_psp',
    plan_name: 'Power Smart Pricing (PSP)',
    plan_description:
      'Hourly pricing program for Illinois residential customers. Electricity price varies each hour based on actual MISO wholesale market prices posted the evening before. Shifting high-consumption tasks (laundry, EV charging, dishwasher) to lower-priced hours typically saves 10–15%.',
    utility_ids: ['ameren_il'],
    type: 'hourly_pricing',
    solar_friendly: true,
    battery_optimized: true,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      {
        period: 'off_peak',
        label: 'Low-Price Hours',
        hours_description: 'Late night / early morning (typically 11 PM–6 AM); varies daily',
        summer_rate_per_kwh: 0.02,
        winter_rate_per_kwh: 0.015,
        applies_weekends: true,
        applies_holidays: true,
      },
      {
        period: 'on_peak',
        label: 'High-Price Hours',
        hours_description: 'Late afternoon in summer (3–8 PM); winter mornings/evenings; varies daily — prices posted nightly after 5 PM',
        summer_rate_per_kwh: 0.08,
        winter_rate_per_kwh: 0.06,
        applies_weekends: true,
        applies_holidays: true,
      },
    ],
    enrollment_url: 'https://www.ameren.com/account/prot/manage-programs',
    eligibility_note: 'Illinois residential customers only. Prices based on MISO day-ahead market; check nightly at ameren.com/bill/rates/power-smart-pricing/prices or call 1-877-655-6028.',
    solar_pro_note:
      'PSP is ideal for solar + battery customers in Ameren Illinois territory (ZIP 62xxx, 61xxx). Solar production displaces the highest on-peak hours while a battery can store midday surplus and discharge during the 3–8 PM high-price window, maximizing savings on this variable-rate plan.',
    last_verified: '2025-05',
  },

  // ── Ameren Missouri: Anytime Users (flat baseline) ──────────────────────────
  {
    plan_id: 'ameren_mo_anytime',
    plan_name: 'Anytime Users (Standard Flat Rate)',
    plan_description:
      'Standard Ameren Missouri residential rate. Summer (Jun–Sep): 15.6¢/kWh flat. Winter (Oct–May): 10.6¢/kWh for first 750 kWh, 7.1¢/kWh above 750 kWh.',
    utility_ids: ['ameren_mo'],
    type: 'tou_rate',
    solar_friendly: false,
    battery_optimized: false,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      {
        period: 'off_peak',
        label: 'All Hours — Summer',
        hours_description: 'All hours, June–September',
        summer_rate_per_kwh: 0.156,
        applies_weekends: true,
        applies_holidays: true,
      },
      {
        period: 'off_peak',
        label: 'All Hours — Winter (Tier 1)',
        hours_description: 'All hours, October–May, first 750 kWh',
        winter_rate_per_kwh: 0.106,
        applies_weekends: true,
        applies_holidays: true,
      },
      {
        period: 'off_peak',
        label: 'All Hours — Winter (Tier 2)',
        hours_description: 'All hours, October–May, above 750 kWh',
        winter_rate_per_kwh: 0.071,
        applies_weekends: true,
        applies_holidays: true,
      },
    ],
    eligibility_note: 'Missouri residential customers. Net metering compatible.',
    solar_pro_note:
      'Anytime Users is the default Ameren Missouri plan. Solar customers should consider Evening/Morning Savers or Overnight Savers for better solar-hour economics. Battery storage adds limited value on this flat-rate plan unless paired with demand-response events.',
    last_verified: '2025-05',
  },

  // ── Ameren Missouri: Evening / Morning Savers ───────────────────────────────
  {
    plan_id: 'ameren_mo_evening_morning',
    plan_name: 'Evening/Morning Savers',
    plan_description:
      'Two-period TOU. On-Peak 9 AM–9 PM year-round. Off-Peak 9 PM–9 AM. Summer on-peak: 15.81¢/kWh; off-peak: 15.24¢/kWh. Winter on-peak (≤750 kWh): 10.73¢; off-peak (≤750 kWh): 10.45¢. Compatible with net metering.',
    utility_ids: ['ameren_mo'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: false,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      {
        period: 'on_peak',
        label: 'On-Peak',
        hours_description: '9 AM – 9 PM, all days',
        summer_rate_per_kwh: 0.1581,
        winter_rate_per_kwh: 0.1073,
        applies_weekends: true,
        applies_holidays: true,
      },
      {
        period: 'off_peak',
        label: 'Off-Peak',
        hours_description: '9 PM – 9 AM, all days',
        summer_rate_per_kwh: 0.1524,
        winter_rate_per_kwh: 0.1045,
        applies_weekends: true,
        applies_holidays: true,
      },
    ],
    eligibility_note: 'Requires smart meter. Only TOU plan fully compatible with Ameren Missouri net metering.',
    solar_pro_note:
      'Best Ameren Missouri plan for solar-only customers. On-peak hours (9 AM–9 PM) align with most solar production hours, maximizing the value of self-consumption credits. NEM-compatible — the only off-peak/on-peak plan that fully supports net metering exports.',
    last_verified: '2025-05',
  },

  // ── Ameren Missouri: Overnight Savers ──────────────────────────────────────
  {
    plan_id: 'ameren_mo_overnight',
    plan_name: 'Overnight Savers',
    plan_description:
      'Low overnight rate ideal for EV owners or high-overnight-usage households. On-Peak 6 AM–10 PM. Off-Peak 10 PM–6 AM. Summer off-peak: 7.3¢/kWh. Winter off-peak: 6.3¢/kWh. Summer on-peak: 18.4¢. Winter on-peak: 10.3¢.',
    utility_ids: ['ameren_mo'],
    type: 'tou_rate',
    solar_friendly: false,
    battery_optimized: true,
    nem_compatible: false,
    requires_drop_nem: true,
    periods: [
      {
        period: 'on_peak',
        label: 'On-Peak',
        hours_description: '6 AM – 10 PM, all days',
        summer_rate_per_kwh: 0.184,
        winter_rate_per_kwh: 0.103,
        applies_weekends: true,
        applies_holidays: true,
      },
      {
        period: 'off_peak',
        label: 'Off-Peak',
        hours_description: '10 PM – 6 AM, all days',
        summer_rate_per_kwh: 0.073,
        winter_rate_per_kwh: 0.063,
        applies_weekends: true,
        applies_holidays: true,
      },
    ],
    eligibility_note: 'Requires smart meter. Solar customers must drop net metering to enroll (register as qualifying facility instead).',
    solar_pro_note:
      'Overnight Savers offers the lowest off-peak rate among Ameren MO plans (6.3–7.3¢/kWh). Ideal for EV charging (charge overnight). For solar customers, requires dropping NEM — only beneficial if battery storage captures midday solar surplus and discharges during 18.4¢ summer on-peak hours.',
    last_verified: '2025-05',
  },

  // ── Ameren Missouri: Smart Savers ──────────────────────────────────────────
  {
    plan_id: 'ameren_mo_smart_savers',
    plan_name: 'Smart Savers',
    plan_description:
      'Three-period TOU with demand charge. Summer on-peak 3–7 PM M–F at 40.5¢/kWh (extreme peak); mid-peak 6 AM–3 PM and 7–10 PM at 12.2¢; off-peak 10 PM–6 AM at 7.7¢. Winter: on-peak 6–8 AM and 6–8 PM M–F at 18.6¢; mid-peak 8 AM–6 PM and 8–10 PM at ~12¢; off-peak 10 PM–6 AM at ~5.1¢. Demand charge: $9.28/kW summer, $3.83/kW winter.',
    utility_ids: ['ameren_mo'],
    type: 'tou_rate',
    solar_friendly: false,
    battery_optimized: true,
    nem_compatible: false,
    requires_drop_nem: true,
    periods: [
      {
        period: 'on_peak',
        label: 'On-Peak (Critical)',
        hours_description: 'Summer: 3–7 PM M–F; Winter: 6–8 AM and 6–8 PM M–F (holidays off)',
        summer_rate_per_kwh: 0.405,
        winter_rate_per_kwh: 0.186,
        applies_weekends: false,
        applies_holidays: false,
      },
      {
        period: 'mid_peak',
        label: 'Mid-Peak',
        hours_description: 'Summer: 6 AM–3 PM and 7–10 PM M–F; all day weekends. Winter: 8 AM–6 PM and 8–10 PM M–F',
        summer_rate_per_kwh: 0.122,
        winter_rate_per_kwh: 0.12,
        applies_weekends: false,
        applies_holidays: false,
      },
      {
        period: 'off_peak',
        label: 'Off-Peak',
        hours_description: '10 PM – 6 AM, all days including holidays',
        summer_rate_per_kwh: 0.077,
        winter_rate_per_kwh: 0.051,
        applies_weekends: true,
        applies_holidays: true,
      },
    ],
    demand_charge_per_kw: 9.28,
    demand_charge_note: '$9.28/kW summer on peak kW; $3.83/kW winter. Based on highest demand hour 6 AM–10 PM.',
    eligibility_note: 'Requires smart meter. Net metering customers must register as qualifying facility (drop standard NEM).',
    solar_pro_note:
      'Smart Savers has extreme summer on-peak rates (40.5¢/kWh, 3–7 PM M–F). A battery that fully covers the 3–7 PM peak window provides maximum bill savings on this plan. Solar alone is less effective since peak hours begin after solar output declines — battery + solar is the optimal combination.',
    last_verified: '2025-05',
  },

  // ── Ameren Missouri: Ultimate Savers ───────────────────────────────────────
  {
    plan_id: 'ameren_mo_ultimate',
    plan_name: 'Ultimate Savers',
    plan_description:
      'Highest-spread plan with demand charge. Summer on-peak 3–7 PM M–F at 34.1¢/kWh; off-peak all other hours at 5.8¢/kWh. Winter on-peak 6:30–8:30 AM M–F at 18.6¢; off-peak all other hours at 5.1¢. Demand charge applies. Lowest overall off-peak rate of any Ameren MO plan.',
    utility_ids: ['ameren_mo'],
    type: 'tou_rate',
    solar_friendly: false,
    battery_optimized: true,
    nem_compatible: false,
    requires_drop_nem: true,
    periods: [
      {
        period: 'on_peak',
        label: 'On-Peak',
        hours_description: 'Summer: 3–7 PM M–F; Winter: 6:30–8:30 AM M–F',
        summer_rate_per_kwh: 0.341,
        winter_rate_per_kwh: 0.186,
        applies_weekends: false,
        applies_holidays: false,
      },
      {
        period: 'off_peak',
        label: 'Off-Peak',
        hours_description: 'All other hours (weekends/holidays all off-peak)',
        summer_rate_per_kwh: 0.058,
        winter_rate_per_kwh: 0.051,
        applies_weekends: true,
        applies_holidays: true,
      },
    ],
    demand_charge_note: 'Demand charge based on peak 1-hour demand 6 AM–10 PM.',
    eligibility_note: 'Requires smart meter. Net metering customers must drop NEM.',
    solar_pro_note:
      'Ultimate Savers offers the lowest off-peak rate (5.1–5.8¢/kWh) of any Ameren MO plan — ideal for high overnight usage or EV charging. Combined with a battery that covers the narrow 3–7 PM summer peak, this plan can produce significant annual savings. Not recommended for solar-only (NEM incompatible).',
    last_verified: '2025-05',
  },

  // ── ComEd Illinois: Hourly Pricing ─────────────────────────────────────────
  {
    plan_id: 'comed_hourly_pricing',
    plan_name: 'Hourly Pricing Program',
    plan_description:
      'Real-time pricing program for ComEd residential customers. Electricity price varies each hour based on wholesale Day-Ahead market prices (PJM). Prices posted daily. Customers with solar + battery can earn premium credits during high-price hours. Approximately 10–15% average savings for participants who shift usage.',
    utility_ids: ['comed_il'],
    type: 'hourly_pricing',
    solar_friendly: true,
    battery_optimized: true,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      {
        period: 'off_peak',
        label: 'Low-Price Hours',
        hours_description: 'Typically midnight–6 AM, varies by day and season',
        summer_rate_per_kwh: 0.02,
        winter_rate_per_kwh: 0.015,
        applies_weekends: true,
        applies_holidays: true,
      },
      {
        period: 'on_peak',
        label: 'High-Price Hours',
        hours_description: 'Typically 3–8 PM summer; varies daily. Extreme events can exceed $1/kWh',
        summer_rate_per_kwh: 0.08,
        winter_rate_per_kwh: 0.055,
        applies_weekends: true,
        applies_holidays: true,
      },
    ],
    enrollment_url: 'https://hourlypricing.comed.com/',
    eligibility_note: 'Requires smart meter (AMI). Customers must enroll via hourlypricing.comed.com. Compatible with net metering.',
    solar_pro_note:
      'ComEd Hourly Pricing rewards solar + battery owners most during summer high-demand events when prices can spike above $0.50/kWh. A battery charged from solar midday and discharged during 3–8 PM peak windows maximizes earnings. Compatible with net metering — solar exports receive the real-time hourly price.',
    last_verified: '2025-05',
  },

  // ── Xcel Energy Colorado: Time-of-Use Pricing ──────────────────────────────
  {
    plan_id: 'xcel_co_tou',
    plan_name: 'Time-of-Use Pricing (Colorado)',
    plan_description:
      'Voluntary TOU rate for Colorado residential customers. On-Peak M–F 3–7 PM year-round. Off-Peak all other hours including weekends. On-peak rate ~23.9¢/kWh; off-peak ~11.3¢/kWh (2024 rates, subject to change). EV charging credit available.',
    utility_ids: ['xcel_co', 'psco_co'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: true,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      {
        period: 'on_peak',
        label: 'On-Peak',
        hours_description: '3 PM – 7 PM, Monday–Friday year-round',
        summer_rate_per_kwh: 0.239,
        winter_rate_per_kwh: 0.239,
        applies_weekends: false,
        applies_holidays: false,
      },
      {
        period: 'off_peak',
        label: 'Off-Peak',
        hours_description: 'All other hours; all day weekends and holidays',
        summer_rate_per_kwh: 0.113,
        winter_rate_per_kwh: 0.113,
        applies_weekends: true,
        applies_holidays: true,
      },
    ],
    enrollment_url: 'https://co.my.xcelenergy.com/s/billing-payment/residential-rates/time-of-use-pricing',
    eligibility_note: 'Requires smart meter. Colorado residential customers only.',
    solar_pro_note:
      'Xcel TOU in Colorado has a 3–7 PM on-peak window — solar production typically ends before or during this window. A battery that captures excess midday solar and discharges 3–7 PM maximizes savings at the 23.9¢ on-peak rate. Compatible with Solar*Rewards NEM program.',
    last_verified: '2025-05',
  },

  // ── PG&E California: E-TOU-C (default residential TOU) ──────────────────────
  {
    plan_id: 'pge_ca_etou_c',
    plan_name: 'E-TOU-C (Residential Time-of-Use)',
    plan_description:
      'Default residential TOU rate for PG&E California customers. Peak 4–9 PM daily year-round at ~44¢/kWh. Off-peak all other hours at ~29¢/kWh. Super off-peak 9 PM–midnight and midnight–3 AM varies. Under NEM 3.0 (Solar Billing Plan), solar export credits follow avoided-cost tariff (~5–6¢/kWh), making battery storage essential.',
    utility_ids: ['pge_ca'],
    type: 'tou_rate',
    solar_friendly: false,
    battery_optimized: true,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      {
        period: 'on_peak',
        label: 'Peak',
        hours_description: '4 PM – 9 PM, every day',
        summer_rate_per_kwh: 0.449,
        winter_rate_per_kwh: 0.401,
        applies_weekends: true,
        applies_holidays: true,
      },
      {
        period: 'off_peak',
        label: 'Off-Peak',
        hours_description: 'All other hours outside peak window',
        summer_rate_per_kwh: 0.292,
        winter_rate_per_kwh: 0.270,
        applies_weekends: true,
        applies_holidays: true,
      },
      {
        period: 'super_off_peak',
        label: 'Super Off-Peak (Winter only)',
        hours_description: '9 PM – 3 PM, October–May (overnight and daytime)',
        winter_rate_per_kwh: 0.232,
        applies_weekends: true,
        applies_holidays: true,
      },
    ],
    enrollment_url: 'https://www.pge.com/en/account/rate-plans.html',
    eligibility_note: 'Default rate for most residential PG&E customers. Solar customers on NEM 3.0 receive export credits at avoided-cost rate (~5–6¢/kWh), not retail rate.',
    solar_pro_note:
      'Under PG&E NEM 3.0, solar export credits are paid at avoided-cost (~5–6¢/kWh) rather than retail rate. Battery storage is critical to capture solar midday surplus and self-consume during the 4–9 PM peak (44¢/kWh). Without battery, ROI on solar in PG&E territory is significantly reduced versus pre-NEM 3.0.',
    last_verified: '2025-05',
  },

  // ── PG&E California: E-ELEC (all-electric home) ────────────────────────────
  {
    plan_id: 'pge_ca_e_elec',
    plan_name: 'E-ELEC (Electric Home Rate)',
    plan_description:
      'PG&E rate for all-electric homes. Designed for homes that have converted from gas. Features super off-peak rates 9 PM–3 PM in winter, making overnight/daytime charging economical. Peak 4–9 PM. Optimized for heat pumps, EVs, and whole-home electrification.',
    utility_ids: ['pge_ca'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: true,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      {
        period: 'on_peak',
        label: 'Peak',
        hours_description: '4 PM – 9 PM, every day',
        summer_rate_per_kwh: 0.449,
        winter_rate_per_kwh: 0.385,
        applies_weekends: true,
        applies_holidays: true,
      },
      {
        period: 'off_peak',
        label: 'Off-Peak',
        hours_description: '3 PM – 4 PM and 9 PM – 9 AM',
        summer_rate_per_kwh: 0.260,
        winter_rate_per_kwh: 0.240,
        applies_weekends: true,
        applies_holidays: true,
      },
      {
        period: 'super_off_peak',
        label: 'Super Off-Peak',
        hours_description: '9 AM – 3 PM daily (solar production hours)',
        summer_rate_per_kwh: 0.215,
        winter_rate_per_kwh: 0.195,
        applies_weekends: true,
        applies_holidays: true,
      },
    ],
    enrollment_url: 'https://www.pge.com/en/account/rate-plans/electric-home.html',
    eligibility_note: 'All-electric homes (no gas service). Ideal for solar + battery + heat pump combination.',
    solar_pro_note:
      'E-ELEC super off-peak hours (9 AM–3 PM) align with peak solar production — ideal for daytime EV charging and high loads. Battery storage captures midday solar and discharges during 4–9 PM peak at 44¢/kWh, providing excellent ROI in all-electric homes.',
    last_verified: '2025-05',
  },

  // ── SCE California: TOU-D-PRIME ─────────────────────────────────────────────
  {
    plan_id: 'sce_ca_tou_d_prime',
    plan_name: 'TOU-D-PRIME (Solar/EV Optimized)',
    plan_description:
      'Southern California Edison TOU-D-PRIME rate. On-peak 4–9 PM daily. Mid-peak 3–4 PM. Super off-peak 8 AM–3 PM (captures solar hours). Designed for solar + battery or EV customers. NEM 3.0 export credits at avoided-cost rate.',
    utility_ids: ['sce_ca'],
    type: 'tou_rate',
    solar_friendly: false,
    battery_optimized: true,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      {
        period: 'on_peak',
        label: 'On-Peak',
        hours_description: '4 PM – 9 PM, every day',
        summer_rate_per_kwh: 0.530,
        winter_rate_per_kwh: 0.430,
        applies_weekends: true,
        applies_holidays: true,
      },
      {
        period: 'mid_peak',
        label: 'Mid-Peak',
        hours_description: '3 PM – 4 PM, every day',
        summer_rate_per_kwh: 0.340,
        winter_rate_per_kwh: 0.290,
        applies_weekends: true,
        applies_holidays: true,
      },
      {
        period: 'super_off_peak',
        label: 'Super Off-Peak',
        hours_description: '8 AM – 3 PM, every day',
        summer_rate_per_kwh: 0.178,
        winter_rate_per_kwh: 0.155,
        applies_weekends: true,
        applies_holidays: true,
      },
    ],
    enrollment_url: 'https://www.sce.com/residential/rates',
    solar_pro_note:
      'SCE NEM 3.0 (Net Billing Tariff) pays avoided-cost credits (~6–8¢/kWh) for exports. With on-peak rates at 53¢/kWh, a battery charging from solar midday (super off-peak at 18¢) and discharging 4–9 PM provides exceptional arbitrage. Battery storage is effectively mandatory for good solar ROI in SCE territory under NEM 3.0.',
    last_verified: '2025-05',
  },

  // ── SDG&E California: TOU-DR1 ───────────────────────────────────────────────
  {
    plan_id: 'sdge_ca_tou_dr1',
    plan_name: 'TOU-DR1 (Default TOU)',
    plan_description:
      'San Diego Gas & Electric default residential TOU. On-peak 4–9 PM every day (~59¢/kWh summer). Off-peak all other hours. Super off-peak available for EV/solar-optimized plans. Highest residential rates in the continental US. NEM 3.0 applies.',
    utility_ids: ['sdge_ca'],
    type: 'tou_rate',
    solar_friendly: false,
    battery_optimized: true,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      {
        period: 'on_peak',
        label: 'On-Peak',
        hours_description: '4 PM – 9 PM, every day',
        summer_rate_per_kwh: 0.590,
        winter_rate_per_kwh: 0.480,
        applies_weekends: true,
        applies_holidays: true,
      },
      {
        period: 'off_peak',
        label: 'Off-Peak / Super Off-Peak',
        hours_description: 'All other hours; super off-peak 12–6 AM',
        summer_rate_per_kwh: 0.360,
        winter_rate_per_kwh: 0.310,
        applies_weekends: true,
        applies_holidays: true,
      },
    ],
    solar_pro_note:
      'SDG&E has the highest residential rates in the US (~59¢/kWh peak). Under NEM 3.0, export credits are at avoided cost, making battery storage critical. With the 4–9 PM on-peak rate, every kWh self-consumed avoids 59¢ in charges. Battery + solar ROI in SDG&E territory is among the best nationally.',
    last_verified: '2025-05',
  },

  // ── Duke Energy Carolinas / Progress: TOU ──────────────────────────────────
  {
    plan_id: 'duke_tou',
    plan_name: 'Residential Time-of-Use Rate',
    plan_description:
      'Duke Energy Carolinas and Progress TOU rate. On-peak M–F 6 AM–10 AM and 6–10 PM (~19–24¢/kWh). Off-peak all other hours (~7–8¢/kWh). Weekends and holidays off-peak. Pairs with PowerPair solar+battery incentive.',
    utility_ids: ['duke_energy_nc', 'duke_energy_sc', 'duke_energy_progress_nc'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: true,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      {
        period: 'on_peak',
        label: 'On-Peak',
        hours_description: '6–10 AM and 6–10 PM, M–F',
        summer_rate_per_kwh: 0.240,
        winter_rate_per_kwh: 0.210,
        applies_weekends: false,
        applies_holidays: false,
      },
      {
        period: 'off_peak',
        label: 'Off-Peak',
        hours_description: 'All other hours; all day weekends and holidays',
        summer_rate_per_kwh: 0.075,
        winter_rate_per_kwh: 0.070,
        applies_weekends: true,
        applies_holidays: true,
      },
    ],
    enrollment_url: 'https://www.duke-energy.com/home/billing/time-of-use',
    solar_pro_note:
      'Duke TOU combined with the PowerPair battery incentive (up to $9,000) provides excellent value. Battery charges from solar during off-peak hours and discharges during morning/evening on-peak windows when grid power is 24¢/kWh. Stacks well with federal ITC.',
    last_verified: '2025-05',
  },

  // ── PSE&G New Jersey: Time-of-Use ──────────────────────────────────────────
  {
    plan_id: 'pseg_nj_tou',
    plan_name: 'Time-of-Use Electric Rate',
    plan_description:
      'PSE&G residential TOU rate for New Jersey customers. On-peak M–F 2–7 PM at higher rate; off-peak all other hours. Pairs well with NJ TREC solar incentive and PSEG ConnectedSolutions battery demand-response program.',
    utility_ids: ['pseg_nj'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: true,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      {
        period: 'on_peak',
        label: 'On-Peak',
        hours_description: '2 PM – 7 PM, Monday–Friday',
        summer_rate_per_kwh: 0.220,
        winter_rate_per_kwh: 0.190,
        applies_weekends: false,
        applies_holidays: false,
      },
      {
        period: 'off_peak',
        label: 'Off-Peak',
        hours_description: 'All other hours; all day weekends and holidays',
        summer_rate_per_kwh: 0.105,
        winter_rate_per_kwh: 0.095,
        applies_weekends: true,
        applies_holidays: true,
      },
    ],
    enrollment_url: 'https://nj.myaccount.pseg.com/myservicepublic/time-of-use',
    solar_pro_note:
      'PSE&G TOU pairs well with ConnectedSolutions battery demand-response (up to $275/kW-year). Solar reduces on-peak consumption during 2–7 PM window; battery provides additional arbitrage and DR revenue. Stacks with NJ TREC solar performance credits.',
    last_verified: '2025-05',
  },

  // ── Consumers Energy Michigan: Nighttime Savers ────────────────────────────
  {
    plan_id: 'consumers_mi_nighttime',
    plan_name: 'Nighttime Savers Rate',
    plan_description:
      'Consumers Energy Michigan off-peak overnight rate. On-peak 9 AM–10 PM daily. Off-peak 10 PM–9 AM. Off-peak rate significantly lower (~$0.063/kWh) vs on-peak (~$0.161/kWh). Ideal for EV owners. Summer rate applicable Jun–Aug.',
    utility_ids: ['consumers_energy_mi'],
    type: 'tou_rate',
    solar_friendly: false,
    battery_optimized: true,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      {
        period: 'on_peak',
        label: 'On-Peak',
        hours_description: '9 AM – 10 PM, every day',
        summer_rate_per_kwh: 0.161,
        winter_rate_per_kwh: 0.145,
        applies_weekends: true,
        applies_holidays: true,
      },
      {
        period: 'off_peak',
        label: 'Off-Peak',
        hours_description: '10 PM – 9 AM, every day',
        summer_rate_per_kwh: 0.063,
        winter_rate_per_kwh: 0.055,
        applies_weekends: true,
        applies_holidays: true,
      },
    ],
    enrollment_url: 'https://www.consumersenergy.com/residential/account-and-billing/rates/electric-rates-and-programs/rate-plan-options/nighttime-savers',
    solar_pro_note:
      'Consumers Energy Nighttime Savers offers low overnight rates for EV charging. Solar production occurs during on-peak hours (9 AM–10 PM) at 16¢/kWh — good self-consumption value. Battery adds arbitrage opportunity storing overnight cheap power for daytime discharge.',
    last_verified: '2025-05',
  },

  // ── NV Energy Nevada: TOU ───────────────────────────────────────────────────
  {
    plan_id: 'nvenergy_tou',
    plan_name: 'Time-of-Use (NV Energy)',
    plan_description:
      'NV Energy residential TOU for Nevada customers. On-peak summer Jun–Sep: 3–8 PM weekdays at ~22¢/kWh; off-peak all other hours at ~11¢/kWh. Winter on-peak 6–9 AM and 6–9 PM. GSRP (Green Energy Rider) available for NEM solar customers.',
    utility_ids: ['nv_energy_nv', 'sierra_pacific_power_nv'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: true,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      {
        period: 'on_peak',
        label: 'On-Peak',
        hours_description: 'Summer: 3–8 PM M–F; Winter: 6–9 AM and 6–9 PM M–F',
        summer_rate_per_kwh: 0.219,
        winter_rate_per_kwh: 0.185,
        applies_weekends: false,
        applies_holidays: false,
      },
      {
        period: 'off_peak',
        label: 'Off-Peak',
        hours_description: 'All other hours; all day weekends and holidays',
        summer_rate_per_kwh: 0.112,
        winter_rate_per_kwh: 0.098,
        applies_weekends: true,
        applies_holidays: true,
      },
    ],
    solar_pro_note:
      'NV Energy TOU: on-peak window starts at 3 PM, slightly after solar peak. Battery storing midday solar for 3–8 PM discharge maximizes value. Nevada has good solar resource — high self-consumption is the primary solar savings mechanism since NEM export rates may be below retail.',
    last_verified: '2025-05',
  },

  // ── APS Arizona: TOU-E ──────────────────────────────────────────────────────
  {
    plan_id: 'aps_az_tou_e',
    plan_name: 'Saver Choice Plus (APS TOU)',
    plan_description:
      'APS Arizona residential TOU with strong peak/off-peak spread. On-peak summer Jun–Sep: 3–8 PM M–F at ~30¢/kWh. Off-peak nights and weekends at ~9¢/kWh. APS has shifted to avoided-cost export credits (not full retail NEM) post-2017 for new customers. Storage Rewards pilot program available.',
    utility_ids: ['aps_az'],
    type: 'tou_rate',
    solar_friendly: false,
    battery_optimized: true,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      {
        period: 'on_peak',
        label: 'On-Peak',
        hours_description: 'Summer (Jun–Sep): 3–8 PM M–F. Winter: 5–9 PM M–F',
        summer_rate_per_kwh: 0.299,
        winter_rate_per_kwh: 0.245,
        applies_weekends: false,
        applies_holidays: false,
      },
      {
        period: 'off_peak',
        label: 'Off-Peak',
        hours_description: 'All other hours; all day weekends',
        summer_rate_per_kwh: 0.092,
        winter_rate_per_kwh: 0.082,
        applies_weekends: true,
        applies_holidays: true,
      },
    ],
    enrollment_url: 'https://www.aps.com/en/Utility/Regulatory-and-Legal/Rate-case',
    solar_pro_note:
      'APS on-peak hours (3–8 PM) start after solar production peak in Arizona. Battery storage capturing midday solar and discharging 3–8 PM at 30¢/kWh provides excellent ROI. APS Storage Rewards pilot pays battery owners for peak-period dispatch. Check current pilot availability.',
    last_verified: '2025-05',
  },

];

// ─── Battery Incentive Programs Registry ──────────────────────────────────────

export const BATTERY_INCENTIVE_PROGRAMS: BatteryIncentiveProgram[] = [

  // ── Duke Energy: PowerPair (NC/SC) ──────────────────────────────────────────
  {
    program_id: 'duke_powerpair',
    program_name: 'PowerPair Solar + Battery Incentive',
    utility_ids: ['duke_energy_nc', 'duke_energy_sc', 'duke_energy_progress_nc'],
    type: 'battery_incentive',
    status: 'active',
    value_description: 'Up to $9,000 one-time rebate for solar + battery system (up to $3,600 for battery portion)',
    value_flat: 9000,
    max_value: 9000,
    min_battery_kwh: 3,
    utility_dispatch: true,
    max_dispatch_events_per_year: 60,
    max_dispatch_hours_per_event: 4,
    enrollment_url: 'https://www.duke-energy.com/home/products/powerpair',
    program_description:
      'Duke Energy PowerPair provides one-time rebates for solar + battery storage installations. Residential customers in NC/SC can receive up to $9,000 for a solar+battery system or up to $3,600 for battery-only additions. The utility retains dispatch rights during peak events (up to 60 events/year, 4 hours each).',
    solar_pro_note:
      'PowerPair is one of the most generous utility battery rebates in the Southeast. Combining the $9,000 PowerPair with the 30% federal ITC substantially reduces battery payback. Works with Duke TOU rate for maximum savings.',
    last_verified: '2025-05',
  },

  // ── Green Mountain Power Vermont: Battery Lease / BYOD ─────────────────────
  {
    program_id: 'gmp_battery_lease',
    program_name: 'Home Energy Storage Lease / BYOD',
    utility_ids: ['green_mountain_power_vt'],
    type: 'battery_incentive',
    status: 'active',
    value_description: 'Battery lease for $55–$75/month (GMP-owned Powerwall/Enphase) OR BYOD program pays up to $2,600 for customer-owned battery enrolled in GMP grid services',
    value_flat: 2600,
    min_battery_kwh: 10,
    utility_dispatch: true,
    enrollment_url: 'https://greenmountainpower.com/rebates-programs/home-energy-storage/',
    program_description:
      'Green Mountain Power pioneered utility-owned home battery programs. Customers can lease a Tesla Powerwall or Enphase IQ Battery for a low monthly fee (~$55–75/month), providing backup power while GMP uses the battery for grid services. The Bring Your Own Device (BYOD) program pays customers up to $2,600 for enrolling their own battery in GMP grid services (dispatch during peak events).',
    solar_pro_note:
      'GMP is the most innovative utility battery program in the US. For Vermont solar customers, pairing solar with a GMP-leased or enrolled battery provides backup power and reduces upfront battery cost. The battery lease includes warranty and insurance — unique nationally.',
    last_verified: '2025-05',
  },

  // ── Eversource Massachusetts: ConnectedSolutions ───────────────────────────
  {
    program_id: 'eversource_ma_connected_solutions',
    program_name: 'ConnectedSolutions Battery Demand Response',
    utility_ids: ['eversource_ma', 'national_grid_ma', 'natgrid_ma'],
    type: 'demand_response',
    status: 'active',
    value_description: 'Approximately $275/kW of battery capacity per year (seasonal payments)',
    value_annual_per_kw: 275,
    min_battery_kwh: 3,
    utility_dispatch: true,
    max_dispatch_events_per_year: 60,
    max_dispatch_hours_per_event: 2,
    enrollment_url: 'https://www.masssave.com/residential/rebates-offers-services/connectedsolutions',
    program_description:
      'ConnectedSolutions (administered by Mass Save / Eversource) pays battery owners approximately $275/kW per year for allowing the utility to dispatch their battery during summer and winter peak events. Events last up to 2 hours each, up to 60 per year. The battery still provides backup power at all other times. No upfront cost to participate.',
    solar_pro_note:
      'ConnectedSolutions is the most financially attractive battery DR program in New England. A 10 kWh battery earns roughly $2,750/year in payments. Combined with Massachusetts SMART solar incentive and high Eversource rates (>31¢/kWh), solar + battery ROI in MA is exceptional.',
    last_verified: '2025-05',
  },

  // ── PSEG Long Island: Battery Storage Rewards ─────────────────────────────
  {
    program_id: 'pseg_li_battery_rewards',
    program_name: 'Battery Storage Rewards Program',
    utility_ids: ['pseg_long_island_ny', 'lipa_ny'],
    type: 'demand_response',
    status: 'active',
    value_description: 'Up to $1,500 per year for enrolled home batteries (demand-response dispatch)',
    value_annual_per_kw: 150,
    min_battery_kwh: 5,
    utility_dispatch: true,
    enrollment_url: 'https://www.psegliny.com/saveenergyandmoney/GreenEnergy/SolarEnergy/EnergyStorageRewards',
    program_description:
      'PSEG Long Island pays homeowners for enrolling their battery storage systems in the Battery Storage Rewards demand-response program. Payments up to ~$150/kW-year for battery dispatch during peak grid events on Long Island.',
    solar_pro_note:
      'Long Island has high rates (~25¢/kWh) and strong incentives. PSEG LI Battery Storage Rewards pays for battery dispatch while the battery still provides solar self-consumption benefits at other times. Pairs well with NY-Sun incentive.',
    last_verified: '2025-05',
  },

  // ── California: SGIP Battery Rebate ─────────────────────────────────────────
  {
    program_id: 'sgip_ca',
    program_name: 'California SGIP Battery Storage Rebate',
    utility_ids: ['pge_ca', 'sce_ca', 'sdge_ca', 'socal_gas_ca'],
    type: 'battery_incentive',
    status: 'active',
    value_description: 'Up to $200/kWh of battery capacity for residential customers in equity/fire-threat zones; standard residential ~$150/kWh (2024, step down annually)',
    value_per_kwh_capacity: 200,
    max_value: 3000,
    min_battery_kwh: 1,
    utility_dispatch: false,
    enrollment_url: 'https://www.selfgenca.com/',
    program_description:
      'Self-Generation Incentive Program (SGIP) provides rebates for behind-the-meter battery storage in California. Residential standard step: ~$150/kWh. Equity, low-income, and high-fire-threat-district customers receive enhanced rates up to $1,000/kWh for the first 2–3 kWh. Funded by PG&E, SCE, SDG&E, and SoCalGas rate surcharges.',
    solar_pro_note:
      'SGIP is the premier California battery rebate, stacking with the 30% federal ITC. Under NEM 3.0, battery storage is essential for solar ROI in PG&E/SCE/SDG&E territory — SGIP helps offset battery cost. Check current step availability as incentive levels decline over time.',
    last_verified: '2025-05',
  },

  // ── Xcel Colorado: Renewable Battery Connect ────────────────────────────────
  {
    program_id: 'xcel_co_battery_connect',
    program_name: 'Renewable Battery Connect Program',
    utility_ids: ['xcel_co', 'psco_co'],
    type: 'battery_incentive',
    status: 'active',
    value_description: 'Approximately $200–$400 per year for enrolled battery systems (depends on battery size and dispatch events)',
    value_annual_per_kw: 50,
    min_battery_kwh: 3,
    utility_dispatch: true,
    max_dispatch_events_per_year: 40,
    enrollment_url: 'https://co.my.xcelenergy.com/s/renewable/battery-connect',
    program_description:
      'Xcel Energy Renewable Battery Connect in Colorado enrolls customer-owned batteries for grid services. Xcel dispatches batteries during peak demand events and compensates owners. Pairs with Xcel TOU rate and Solar*Rewards NEM program.',
    solar_pro_note:
      'Xcel Renewable Battery Connect provides passive income from the battery while still serving as backup and solar arbitrage device. Combined with Xcel TOU and Solar*Rewards NEM, solar + battery economics in Colorado are solid.',
    last_verified: '2025-05',
  },

  // ── ComEd Illinois: Distributed Generation Solar Rebate ──────────────────
  {
    program_id: 'comed_dg_rebate',
    program_name: 'ComEd Distributed Generation (DG) Rebate',
    utility_ids: ['comed_il'],
    type: 'battery_incentive',
    status: 'limited',
    value_description: 'Up to $300/kW for qualifying solar or solar+storage systems (subject to annual funding caps)',
    value_per_kwh_capacity: 300,
    max_value: 4500,
    utility_dispatch: false,
    enrollment_url: 'https://programs.dsireusa.org/system/program/detail/22233/comed-distributed-generation-rebates',
    program_description:
      'ComEd DG Rebate provides one-time rebates for residential solar and/or battery storage systems. Up to $300/kW for solar-only or solar+battery. Funding is limited each program year — early application recommended. ComEd also supports Illinois Shines (ABP) SREC program.',
    solar_pro_note:
      'ComEd DG Rebate stacks with Illinois Shines SRECs and 30% federal ITC, making Illinois one of the most incentive-rich solar markets. Combined with ComEd Hourly Pricing and battery storage, IL solar projects have excellent ROI.',
    last_verified: '2025-05',
  },

  // ── APS Arizona: Storage Rewards Pilot ─────────────────────────────────────
  {
    program_id: 'aps_storage_rewards',
    program_name: 'Storage Rewards Pilot Program',
    utility_ids: ['aps_az'],
    type: 'demand_response',
    status: 'pilot',
    value_description: 'Bill credits for battery owners who allow APS dispatch during summer peak events',
    utility_dispatch: true,
    max_dispatch_events_per_year: 30,
    max_dispatch_hours_per_event: 4,
    enrollment_url: 'https://www.aps.com/en/About/Sustainability-and-Innovation/Technology-and-Innovation/Storage-Rewards',
    program_description:
      'APS Storage Rewards pilot allows battery owners to earn bill credits by letting APS dispatch their batteries during summer peak hours (typically 3–8 PM). Paired with APS TOU rate to maximize self-consumption and demand-response revenue.',
    solar_pro_note:
      'APS Storage Rewards combined with Saver Choice Plus TOU rate creates a compelling battery case in Arizona. Battery charges from solar midday, earns bill credits when APS dispatches 3–8 PM. Check current pilot enrollment availability.',
    last_verified: '2025-05',
  },

  // ── NV Energy Nevada: Battery Rebate ────────────────────────────────────────
  {
    program_id: 'nvenergy_battery_rebate',
    program_name: 'NV Energy Home Battery Rebate',
    utility_ids: ['nv_energy_nv', 'sierra_pacific_power_nv'],
    type: 'battery_incentive',
    status: 'limited',
    value_description: 'Up to $1,500 one-time rebate for qualifying residential battery storage systems',
    value_flat: 1500,
    max_value: 1500,
    min_battery_kwh: 3,
    utility_dispatch: false,
    program_description:
      'NV Energy offers periodic rebates for residential battery storage. Funding is subject to availability. Check NV Energy website for current program status. Stacks with federal ITC (30%).',
    solar_pro_note:
      'NV Energy battery rebate reduces storage upfront cost in Nevada. Combined with strong solar irradiance and TOU rate, solar + battery provides solid ROI in NV Energy territory.',
    last_verified: '2025-04',
  },

];

// ─── Solar Rebate Programs Registry ──────────────────────────────────────────

export const SOLAR_REBATE_PROGRAMS: SolarRebateProgram[] = [

  // ── Xcel Energy Colorado: Solar*Rewards ────────────────────────────────────
  {
    program_id: 'xcel_solar_rewards',
    program_name: 'Solar*Rewards Program (Colorado)',
    utility_ids: ['xcel_co', 'psco_co'],
    type: 'solar_rebate',
    status: 'active',
    value_description: 'Performance-based incentive (PBI): ~$0.03–0.05/kWh generated for first 10 years',
    value_per_kwh_production: 0.04,
    max_system_kw: 25,
    stackable_with_federal_itc: true,
    enrollment_url: 'https://co.my.xcelenergy.com/s/renewable/solar',
    program_description:
      'Xcel Energy Solar*Rewards is a performance-based incentive paying residential solar customers per kWh generated over 10 years. Rate varies by program year. Also includes NEM at retail rate for exports up to 120% of annual consumption.',
    solar_pro_note:
      'Solar*Rewards PBI adds approximately $400–600/year in additional income for a typical 6–8 kW system. Stacks with federal ITC and Xcel TOU. Colorado is an excellent solar market.',
    last_verified: '2025-05',
  },

  // ── Duke Energy: NC Solar Rebate ────────────────────────────────────────────
  {
    program_id: 'duke_nc_solar_rebate',
    program_name: 'Duke Energy NC Solar Rebate Program',
    utility_ids: ['duke_energy_nc', 'duke_energy_progress_nc'],
    type: 'solar_rebate',
    status: 'active',
    value_description: 'Up to $6,000 one-time rebate for residential solar ($0.60/W up to 10 kW)',
    value_per_kw: 600,
    max_value: 6000,
    max_system_kw: 10,
    stackable_with_federal_itc: true,
    enrollment_url: 'https://www.duke-energy.com/home/products/renewable-energy/nc-solar-rebates',
    program_description:
      'Duke Energy North Carolina offers a $0.60/W solar rebate (up to $6,000) for residential customers. Applies to new grid-tied solar installations. Must be applied for prior to installation. Stacks with federal ITC and NC state tax credit.',
    solar_pro_note:
      'Duke NC Solar Rebate + PowerPair battery rebate can total up to $15,000 in utility incentives before the 30% federal ITC. North Carolina is one of the most incentive-rich utility markets on the East Coast.',
    last_verified: '2025-05',
  },

  // ── ComEd / Illinois Shines: SREC / ABP ─────────────────────────────────────
  {
    program_id: 'illinois_shines',
    program_name: 'Illinois Shines (Adjustable Block Program)',
    utility_ids: ['comed_il', 'ameren_il'],
    type: 'solar_rebate',
    status: 'active',
    value_description: 'Performance-based SRECs: typically $60–90/MWh for 15 years (paid upfront or over time)',
    value_per_kwh_production: 0.075,
    max_system_kw: 25,
    stackable_with_federal_itc: true,
    enrollment_url: 'https://illinoisshines.com/',
    program_description:
      'Illinois Shines (ABP) is Illinois\' SREC program, providing 15-year renewable energy credit contracts for solar systems under 25 kW. Block pricing varies by program year and system size. Residential systems in ComEd and Ameren IL territory qualify. Credits are worth ~$60–90/MWh depending on current block pricing.',
    solar_pro_note:
      'Illinois Shines is one of the best solar incentive programs in the Midwest. A 6 kW system producing ~7,500 kWh/year earns ~$562/year in SRECs for 15 years ($8,400 total), stacking with the 30% ITC. ComEd Hourly Pricing + Illinois Shines makes Illinois an excellent solar market.',
    last_verified: '2025-05',
  },

  // ── Green Mountain Power: VSEAP Solar ──────────────────────────────────────
  {
    program_id: 'gmp_solar_program',
    program_name: 'Vermont Solar Net Metering (Standard Offer + GMP)',
    utility_ids: ['green_mountain_power_vt'],
    type: 'solar_rebate',
    status: 'active',
    value_description: 'Net metering at retail rate; Standard Offer for larger systems; Vermont solar property tax exemption (100%)',
    stackable_with_federal_itc: true,
    enrollment_url: 'https://greenmountainpower.com/rebates-programs/',
    program_description:
      'GMP offers full retail rate net metering for residential solar (up to 150% of annual consumption). Vermont provides 100% property tax exemption for solar installations. GMP has no solar rebate per se but the battery lease/BYOD program effectively reduces storage cost.',
    solar_pro_note:
      'Vermont full retail NEM + GMP battery lease creates exceptional solar + storage economics. Vermont has the second-highest electricity rates in the US (~26¢/kWh) and 100% property tax exemption. GMP territory is one of the most favorable solar markets in New England.',
    last_verified: '2025-05',
  },

];

// ─── Special NEM Programs Registry ───────────────────────────────────────────

export const NEM_SPECIAL_PROGRAMS: NemSpecialProgram[] = [

  // ── California: NEM 3.0 / Net Billing Tariff ──────────────────────────────
  {
    program_id: 'ca_nem3',
    program_name: 'California NEM 3.0 / Net Billing Tariff (NBT)',
    utility_ids: ['pge_ca', 'sce_ca', 'sdge_ca'],
    type: 'nem_special',
    status: 'active',
    program_description:
      'Effective April 2023 for new solar customers. Export credits are paid at avoided-cost rate (~5–8¢/kWh) rather than full retail rate. NEM 1.0/2.0 grandfathered customers retain retail-rate credits for 20 years from install date. Under NEM 3.0, battery storage is financially essential to self-consume solar during peak hours rather than export at low credit rates.',
    export_rate_per_kwh: 0.065,
    tou_export_credit: true,
    annual_export_cap_note: 'Export credits apply monthly; unused credits roll over at avoided-cost rate',
    solar_pro_note:
      'Critical note for California solar proposals: Under NEM 3.0, exporting solar is worth only ~6¢/kWh while self-consumption during peak hours avoids 40–59¢/kWh charges. Battery storage is required to capture peak-hour savings. Proposals should always show solar + battery for California customers. Customers who installed before April 2023 have grandfathered NEM 2.0 (retail rate credits) — these systems have superior economics.',
    last_verified: '2025-05',
  },

  // ── Massachusetts: SMART Program ──────────────────────────────────────────
  {
    program_id: 'ma_smart',
    program_name: 'Massachusetts SMART (Solar Massachusetts Renewable Target)',
    utility_ids: ['eversource_ma', 'national_grid_ma', 'natgrid_ma', 'eversource_cl_ct'],
    type: 'nem_special',
    status: 'active',
    program_description:
      'SMART provides incentive payments for solar energy production through a 10-year contract, paid directly on the monthly utility bill. Base compensation rate varies by utility and program block (~$0.06–0.15/kWh depending on block and adders). Enhanced rates available for low-income customers, dual-axis trackers, and storage-paired systems.',
    export_rate_per_kwh: 0.10,
    tou_export_credit: false,
    enrollment_url: 'https://www.mass.gov/solar-massachusetts-renewable-target-smart-program',
    solar_pro_note:
      'Massachusetts SMART program pays solar customers ~$0.10/kWh (typical block rate) for all solar production for 10 years, stacked on top of net metering credits. Combined with high Eversource rates (31¢/kWh), ConnectedSolutions battery DR ($275/kW-yr), and 30% ITC, Massachusetts offers some of the best solar economics in the nation.',
    last_verified: '2025-05',
  },

  // ── New Jersey: Net Metering + TREC ────────────────────────────────────────
  {
    program_id: 'nj_nem_trec',
    program_name: 'New Jersey Net Metering + TREC',
    utility_ids: ['pseg_nj', 'jcpl_nj', 'ace_nj', 'rce_nj'],
    type: 'nem_special',
    status: 'active',
    program_description:
      'New Jersey offers full retail-rate net metering (annual true-up). Additionally, Transition Renewable Energy Certificates (TRECs) provide quarterly performance payments for solar generation. TRECs pay ~$90–152/MWh depending on the market. Solar + storage systems may qualify for enhanced incentives under NJ Board of Public Utilities programs.',
    export_rate_per_kwh: 0.12,
    tou_export_credit: false,
    annual_export_cap_note: 'Annual true-up at retail rate; no cap on exports',
    enrollment_url: 'https://nj.pseg.com/saveenergyandmoney/solarandrenewableenergy/netmetering',
    solar_pro_note:
      'New Jersey TREC payments (~$0.12/MWh × 1,000 = $120/year per MWh) provide passive income on solar production for 15 years. Combined with retail-rate NEM and PSEG ConnectedSolutions battery program, New Jersey is a top solar + storage market on the East Coast.',
    last_verified: '2025-05',
  },

  // ── Illinois: Net Metering ──────────────────────────────────────────────────
  {
    program_id: 'il_net_metering',
    program_name: 'Illinois Net Metering (ComEd & Ameren)',
    utility_ids: ['comed_il', 'ameren_il'],
    type: 'nem_special',
    status: 'active',
    program_description:
      'Illinois mandates retail-rate net metering for systems up to 40 kW residential, up to 2 MW commercial. Monthly rollover of kWh credits. Annual true-up: excess credits expire (no cash payment) but customer starts fresh each year. ComEd Hourly Pricing participants receive the prevailing real-time wholesale price for exports each hour.',
    export_rate_per_kwh: 0.14,
    tou_export_credit: true,
    annual_export_cap_note: 'Annual excess credits forfeit at true-up (no cash payment)',
    solar_pro_note:
      'Illinois net metering at retail rate is strong policy. For ComEd Hourly Pricing customers, solar exports receive the actual real-time market price — which can exceed retail during peak events. Illinois Shines SREC stacks on top, making IL a top-tier solar market.',
    last_verified: '2025-05',
  },

  // ── Nevada: Net Metering (NVE) ─────────────────────────────────────────────
  {
    program_id: 'nv_net_metering',
    program_name: 'Nevada Net Metering (NV Energy)',
    utility_ids: ['nv_energy_nv', 'sierra_pacific_power_nv'],
    type: 'nem_special',
    status: 'active',
    program_description:
      'Nevada net metering provides retail-rate credits for monthly surplus solar. Annual true-up: excess credits paid at avoided-cost rate (not retail). NV Energy uses TOU-based export credits in some rate plans. Note: Nevada sharply curtailed NEM in 2016 and restored it in 2017 — current program is full retail-rate NEM with annual true-up at avoided cost for annual excess.',
    export_rate_per_kwh: 0.11,
    tou_export_credit: false,
    solar_pro_note:
      'Nevada retail-rate NEM is solid but annual excess credits are only paid at avoided cost. Sizing solar to ~95–100% of annual consumption avoids annual excess forfeit. High solar irradiance in NV means excellent production. Battery storage reduces grid exports and captures peak arbitrage value.',
    last_verified: '2025-05',
  },

  // ── Texas: ERCOT No Statewide NEM ──────────────────────────────────────────
  {
    program_id: 'tx_no_nem',
    program_name: 'Texas: No Statewide Net Metering (Utility-Specific Buyback)',
    utility_ids: ['oncor_tx', 'aep_texas_tx', 'centerpoint_energy_tx', 'tnmp_tx'],
    type: 'nem_special',
    status: 'active',
    program_description:
      'Texas has no statewide net metering mandate. ERCOT (deregulated market) customers choose a retail electric provider (REP) that sets buyback rates. Buyback rates vary widely by REP: some offer retail-rate buyback, others offer wholesale-only (~2–5¢/kWh). Oncor, AEP, CenterPoint own poles/wires (TDUs) — they do not set buyback rates. Common solar-friendly REPs: Reliant (Centerpoint), TXU/Vistra, Green Mountain Energy.',
    export_rate_per_kwh: 0.05,
    tou_export_credit: false,
    solar_pro_note:
      'Texas solar customers must choose a REP with a favorable solar buyback plan. Solar-friendly REPs include Reliant (buyback at avoided cost) and Green Mountain Energy (flat buyback). Without retail NEM, self-consumption is critical — size solar to consumption and consider battery storage to capture on-peak self-consumption value.',
    last_verified: '2025-05',
  },

  // ── Florida: Retail Net Metering ───────────────────────────────────────────
  {
    program_id: 'fl_net_metering',
    program_name: 'Florida Net Metering',
    utility_ids: ['fpl_fl', 'florida_power_light_fl', 'duke_energy_fl', 'teco_tampa_fl', 'fpl'],
    type: 'nem_special',
    status: 'active',
    program_description:
      'Florida Public Service Commission mandates retail-rate net metering for all IOUs (FPL, Duke, TECO, FPU). Monthly banking of surplus kWh credits. Annual true-up: excess credits are paid at avoided cost (wholesale rate, ~3–5¢/kWh). NEM is net-metering for systems up to 2 MW. Rate case ongoing — monitor for potential changes to annual true-up terms.',
    export_rate_per_kwh: 0.14,
    tou_export_credit: false,
    annual_export_cap_note: 'Annual excess credits paid at avoided cost rate (~3–5¢/kWh)',
    solar_pro_note:
      'Florida retail NEM is favorable for monthly self-consumption. Sizing system at or below 100% annual consumption avoids low avoided-cost annual true-up. Florida has no state income tax, strong solar resource, and sales tax exemption on solar equipment — strong fundamentals.',
    last_verified: '2025-05',
  },

];

// ─── UTILITY_PROGRAMS_MAP ─────────────────────────────────────────────────────
// Primary lookup map: utility_id → UtilityProgramBundle

const PROGRAMS_MAP: Record<string, UtilityProgramBundle> = {};

function buildProgramsMap(): Record<string, UtilityProgramBundle> {
  const map: Record<string, UtilityProgramBundle> = {};

  // Collect all utility_ids from all programs
  const allIds = new Set<string>([
    ...TOU_RATE_PLANS.flatMap(p => p.utility_ids),
    ...BATTERY_INCENTIVE_PROGRAMS.flatMap(p => p.utility_ids),
    ...SOLAR_REBATE_PROGRAMS.flatMap(p => p.utility_ids),
    ...NEM_SPECIAL_PROGRAMS.flatMap(p => p.utility_ids),
  ]);

  for (const uid of allIds) {
    const touPlans      = TOU_RATE_PLANS.filter(p => p.utility_ids.includes(uid));
    const batteryProgs  = BATTERY_INCENTIVE_PROGRAMS.filter(p => p.utility_ids.includes(uid));
    const solarRebates  = SOLAR_REBATE_PROGRAMS.filter(p => p.utility_ids.includes(uid));
    const nemProgs      = NEM_SPECIAL_PROGRAMS.filter(p => p.utility_ids.includes(uid));

    const summaryParts: string[] = [];
    if (touPlans.length > 0) {
      const solarFriendly = touPlans.filter(t => t.solar_friendly);
      const battOpt       = touPlans.filter(t => t.battery_optimized);
      summaryParts.push(`${touPlans.length} TOU/rate plan(s) available` +
        (solarFriendly.length ? ` (${solarFriendly.length} solar-friendly)` : '') +
        (battOpt.length ? `, ${battOpt.length} battery-optimized` : ''));
    }
    if (batteryProgs.length > 0) {
      summaryParts.push(`${batteryProgs.length} battery incentive/DR program(s): ` +
        batteryProgs.map(b => b.program_name).join(', '));
    }
    if (solarRebates.length > 0) {
      summaryParts.push(`${solarRebates.length} solar rebate program(s): ` +
        solarRebates.map(r => r.program_name).join(', '));
    }
    if (nemProgs.length > 0) {
      summaryParts.push(`NEM/export program: ${nemProgs.map(n => n.program_name).join(', ')}`);
    }

    map[uid] = {
      utility_id: uid,
      utility_name: uid.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      tou_plans:         touPlans,
      battery_incentives: batteryProgs,
      solar_rebates:     solarRebates,
      nem_programs:      nemProgs,
      summary:           summaryParts.join('. ') || 'Standard flat rate — no special programs on record.',
    };
  }

  return map;
}

// ─── Public API ───────────────────────────────────────────────────────────────

let _programsMap: Record<string, UtilityProgramBundle> | null = null;

/**
 * Get the full utility program bundle for a given utility_id.
 * Returns null if no programs are registered for this utility.
 */
export function getUtilityPrograms(utilityId: string): UtilityProgramBundle | null {
  if (!_programsMap) {
    _programsMap = buildProgramsMap();
  }
  return _programsMap[utilityId] ?? null;
}

/**
 * Get TOU plans for a specific utility.
 */
export function getTouPlans(utilityId: string): TouRatePlan[] {
  return TOU_RATE_PLANS.filter(p => p.utility_ids.includes(utilityId));
}

/**
 * Get battery incentive programs for a specific utility.
 */
export function getBatteryIncentives(utilityId: string): BatteryIncentiveProgram[] {
  return BATTERY_INCENTIVE_PROGRAMS.filter(p => p.utility_ids.includes(utilityId));
}

/**
 * Get solar rebate programs for a specific utility.
 */
export function getSolarRebates(utilityId: string): SolarRebateProgram[] {
  return SOLAR_REBATE_PROGRAMS.filter(p => p.utility_ids.includes(utilityId));
}

/**
 * Get special NEM programs for a specific utility.
 */
export function getNemPrograms(utilityId: string): NemSpecialProgram[] {
  return NEM_SPECIAL_PROGRAMS.filter(p => p.utility_ids.includes(utilityId));
}

/**
 * Quick check: does this utility have any battery incentives?
 */
export function hasBatteryIncentives(utilityId: string): boolean {
  return BATTERY_INCENTIVE_PROGRAMS.some(p => p.utility_ids.includes(utilityId));
}

/**
 * Quick check: does this utility have any solar rebates?
 */
export function hasSolarRebates(utilityId: string): boolean {
  return SOLAR_REBATE_PROGRAMS.some(p => p.utility_ids.includes(utilityId));
}

/**
 * Quick check: does this utility have TOU plans?
 */
export function hasTouPlans(utilityId: string): boolean {
  return TOU_RATE_PLANS.some(p => p.utility_ids.includes(utilityId));
}

/**
 * Get all utility_ids that have any programs registered.
 */
export function getUtilitiesWithPrograms(): string[] {
  if (!_programsMap) {
    _programsMap = buildProgramsMap();
  }
  return Object.keys(_programsMap);
}

/**
 * Get a concise Solar Pro recommendation string for a utility's programs.
 * Returns null if no programs registered.
 */
export function getUtilityProgramNote(utilityId: string): string | null {
  const programs = getUtilityPrograms(utilityId);
  if (!programs) return null;

  const notes: string[] = [];

  // Lead with TOU plan note if solar-friendly plan exists
  const solarFriendlyTou = programs.tou_plans.find(t => t.solar_friendly);
  const batteryTou = programs.tou_plans.find(t => t.battery_optimized && !t.solar_friendly);
  const hourlyPlan = programs.tou_plans.find(t => t.type === 'hourly_pricing');

  if (hourlyPlan) {
    notes.push(`⚡ Hourly pricing available (${hourlyPlan.plan_name}) — battery storage maximizes savings by dispatching during high-price hours.`);
  } else if (solarFriendlyTou) {
    notes.push(`☀️ Solar-friendly TOU plan: ${solarFriendlyTou.plan_name} — on-peak hours align with solar production.`);
  }
  if (batteryTou && !hourlyPlan) {
    notes.push(`🔋 Battery-optimized TOU plan: ${batteryTou.plan_name} — significant peak/off-peak rate spread.`);
  }

  // Battery incentives
  const activeBattery = programs.battery_incentives.filter(b => b.status === 'active');
  if (activeBattery.length > 0) {
    notes.push(`💰 Battery incentive: ${activeBattery[0].program_name} — ${activeBattery[0].value_description}.`);
  }

  // Solar rebates
  const activeRebates = programs.solar_rebates.filter(r => r.status === 'active');
  if (activeRebates.length > 0) {
    notes.push(`🌞 Solar rebate: ${activeRebates[0].program_name} — ${activeRebates[0].value_description}.`);
  }

  // NEM special
  const nemProgram = programs.nem_programs[0];
  if (nemProgram) {
    notes.push(`📋 NEM policy: ${nemProgram.program_name}.`);
  }

  return notes.length > 0 ? notes.join('\n') : null;
}
