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


  // ═══════════════════════════════════════════════════════════════════════
  // v48.28 EXPANSION — Major IOU TOU Plans
  // ═══════════════════════════════════════════════════════════════════════

  // ── LADWP (Los Angeles) TOU-D-PRIME ─────────────────────────────────────
  {
    plan_id: 'ladwp_tou_d',
    plan_name: 'TOU-D-PRIME (Time-of-Use)',
    plan_description: 'LADWP residential TOU rate. On-peak: weekdays 1–5 PM (summer), 4–9 PM (winter). Solar production during mid-morning/early afternoon displaces on-peak usage.',
    utility_ids: ['ladwp_ca'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: true,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak', hours_description: 'Weekdays 1–5 PM (Jun–Sep), 4–9 PM (Oct–May)', summer_rate_per_kwh: 0.275, winter_rate_per_kwh: 0.22, applies_weekends: false, applies_holidays: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'All other hours', summer_rate_per_kwh: 0.14, winter_rate_per_kwh: 0.12, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.ladwp.com/account/understanding-your-rates/residential-electric-rates',
    eligibility_note: 'LADWP residential customers with smart meter.',
    solar_pro_note: 'LADWP NEM 1.0 (grandfathered to 20 yrs) for legacy customers; new customers on NBT. Battery strongly recommended to capture on-peak discharge value at 1–5 PM summer window.',
    last_verified: '2025-05',
  },

  // ── SMUD (Sacramento) TOU ────────────────────────────────────────────────
  {
    plan_id: 'smud_tou',
    plan_name: 'Time-of-Use EV/Solar Rate',
    plan_description: 'SMUD residential TOU. On-peak: 5–8 PM daily. Strong off-peak incentive for EV charging overnight. Solar-friendly with generous midday export window.',
    utility_ids: ['smud_ca'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: true,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak', hours_description: '5–8 PM daily (all year)', summer_rate_per_kwh: 0.30, winter_rate_per_kwh: 0.24, applies_weekends: true, applies_holidays: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: '8 PM–5 PM (all other hours)', summer_rate_per_kwh: 0.12, winter_rate_per_kwh: 0.11, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.smud.org/en/Rate-Information/Solar-customers',
    eligibility_note: 'SMUD residential customers; smart meter required.',
    solar_pro_note: 'SMUD offers favorable NEM 1.0 grandfathered terms; new installs under NBT. Solar production peaks well before 5 PM on-peak window — battery bridges the gap for maximum bill reduction.',
    last_verified: '2025-05',
  },

  // ── Con Edison (NYC/Westchester) TOU ─────────────────────────────────────
  {
    plan_id: 'coned_tou',
    plan_name: 'Time-of-Use Rate (EV or Residential)',
    plan_description: 'Con Edison TOU rates for NYC and Westchester. On-peak: 8 AM–10 PM weekdays (Jun–Sep), 8 AM–10 PM weekdays (Oct–May). High summer demand charges for large systems.',
    utility_ids: ['con_ed_ny'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: true,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak', hours_description: 'Weekdays 8 AM–10 PM year-round', summer_rate_per_kwh: 0.28, winter_rate_per_kwh: 0.22, applies_weekends: false, applies_holidays: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'Weekends, holidays, and 10 PM–8 AM', summer_rate_per_kwh: 0.12, winter_rate_per_kwh: 0.10, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.coned.com/en/accounts-billing/your-bill/time-of-use',
    eligibility_note: 'Con Edison residential customers; smart meter required.',
    solar_pro_note: 'Con Ed territory has the highest residential rates in the continental US ($0.25–0.35/kWh). NEM at full retail rate. Solar ROI is excellent; battery not required but optimizes on-peak dispatch.',
    last_verified: '2025-05',
  },

  // ── NYSEG / Niagara Mohawk / RG&E (Upstate NY) TOU ──────────────────────
  {
    plan_id: 'nyseg_tou',
    plan_name: 'Time-of-Use Rate (Residential)',
    plan_description: 'NYSEG/National Grid upstate NY TOU. On-peak: weekdays 2–7 PM. Full retail net metering applies. Strong solar fundamentals in upstate NY.',
    utility_ids: ['nyseg_ny', 'niagara_mohawk_ny', 'rg_e_ny', 'rochester_gas_electric_ny', 'central_hudson_ny', 'lipa_ny', 'orange_rockland_ny', 'o_r_ny'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: false,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak', hours_description: 'Weekdays 2–7 PM (Jun–Sep), 7 AM–11 PM (Oct–May)', summer_rate_per_kwh: 0.22, winter_rate_per_kwh: 0.18, applies_weekends: false, applies_holidays: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'All other hours', summer_rate_per_kwh: 0.12, winter_rate_per_kwh: 0.11, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.nyseg.com/YourAccount/ManageYourAccount/Rates/TimeofUse.aspx',
    solar_pro_note: 'NY mandates full retail NEM (1:1) for systems ≤ 25 kW residential. All NY utilities must honor net metering. NY-Sun incentives may also be available through NYSERDA.',
    last_verified: '2025-05',
  },

  // ── Georgia Power TOU ────────────────────────────────────────────────────
  {
    plan_id: 'georgia_power_tou',
    plan_name: 'TOU-RD (Time-of-Use Residential)',
    plan_description: 'Georgia Power TOU rate. On-peak: weekdays 2–7 PM. Net metering at full retail rate for systems ≤ 10 kW (Georgia Power capped net metering). Advanced Solar Initiative for larger systems.',
    utility_ids: ['georgia_power'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: true,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak', hours_description: 'Weekdays 2–7 PM (Jun–Sep), all year', summer_rate_per_kwh: 0.21, winter_rate_per_kwh: 0.18, applies_weekends: false, applies_holidays: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'All other hours', summer_rate_per_kwh: 0.09, winter_rate_per_kwh: 0.09, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.georgiapower.com/residential/billing-and-rates/rate-options.html',
    solar_pro_note: 'Georgia Power NEM is capped — confirm interconnection capacity at customer service center. Battery storage is valuable for shifting solar production to 2–7 PM on-peak window.',
    last_verified: '2025-05',
  },

  // ── Duke Energy Indiana TOU ──────────────────────────────────────────────
  {
    plan_id: 'duke_indiana_tou',
    plan_name: 'Time-of-Day Rate (Indiana)',
    plan_description: 'Duke Indiana time-of-day residential rate. On-peak: weekdays 2–8 PM. Indiana phased out retail NEM in 2022 — new solar customers receive wholesale/avoided-cost credit (~4–5 cents/kWh) for exports. Battery storage is critical to maximize self-consumption.',
    utility_ids: ['duke_indiana'],
    type: 'tou_rate',
    solar_friendly: false,
    battery_optimized: true,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak', hours_description: 'Weekdays 2–8 PM year-round', summer_rate_per_kwh: 0.18, winter_rate_per_kwh: 0.15, applies_weekends: false, applies_holidays: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'All other hours', summer_rate_per_kwh: 0.07, winter_rate_per_kwh: 0.07, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.duke-energy.com/home/products/time-of-day',
    solar_pro_note: 'Indiana HB 1278 (2022) eliminated retail NEM for new customers. Exports credited at avoided cost (~$0.04–0.05/kWh). Battery storage is essential to maximize self-consumption and avoid exporting at low avoided-cost rates.',
    last_verified: '2025-05',
  },

  // ── Duke Energy Carolinas / Progress (SC/NC) TOU ─────────────────────────
  {
    plan_id: 'duke_sc_tou',
    plan_name: 'Time-of-Use Home (Duke Carolinas)',
    plan_description: 'Duke Energy Carolinas and Progress TOU residential rate. On-peak: Mon–Fri 6–9 AM and 5–8 PM. PowerPair battery rebate up to $9,000 available.',
    utility_ids: ['duke_sc', 'dominion_energy_nc_nc'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: true,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak', hours_description: 'Mon–Fri 6–9 AM and 5–8 PM year-round', summer_rate_per_kwh: 0.22, winter_rate_per_kwh: 0.18, applies_weekends: false, applies_holidays: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'All other hours including weekends', summer_rate_per_kwh: 0.09, winter_rate_per_kwh: 0.09, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.duke-energy.com/home/products/time-of-use',
    solar_pro_note: 'Duke Carolinas serves SC and parts of NC. PowerPair rebate ($6,000–$9,000) available when pairing solar with battery. TOU morning peak (6–9 AM) favors battery dispatch before solar production ramps.',
    last_verified: '2025-05',
  },

  // ── Dominion Energy Virginia TOU ─────────────────────────────────────────
  {
    plan_id: 'dominion_va_tou',
    plan_name: 'Time-of-Use Rate (Dominion VA)',
    plan_description: 'Dominion Energy Virginia TOU residential rate. On-peak: Mon–Fri 6–9 AM and 3–7 PM. Full retail net metering (1:1) at the distribution rate. 12-month credit banking.',
    utility_ids: ['dominion_va', 'dominion_sc'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: true,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak', hours_description: 'Mon–Fri 6–9 AM and 3–7 PM year-round', summer_rate_per_kwh: 0.20, winter_rate_per_kwh: 0.17, applies_weekends: false, applies_holidays: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'All other hours', summer_rate_per_kwh: 0.08, winter_rate_per_kwh: 0.08, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.dominionenergy.com/virginia/rates-and-tariffs/residential-rate-schedules',
    solar_pro_note: 'Virginia mandates full retail NEM for systems ≤ 20 kW residential, ≤ 500 kW commercial. Dominion TOU dual morning/afternoon peaks favor battery dispatch before solar is generating.',
    last_verified: '2025-05',
  },

  // ── Puget Sound Energy (WA) TOU ──────────────────────────────────────────
  {
    plan_id: 'pse_tou',
    plan_name: 'EV Pricing Plan / Time-of-Use',
    plan_description: 'PSE residential TOU. On-peak: 6–9 PM daily. WA State full retail net metering (1:1) applies. Low off-peak rates incentivize EV charging overnight. Net metering annual true-up in April.',
    utility_ids: ['puget_sound_wa', 'snohomish_county_pud_wa', 'clark_pud_wa', 'seattle_city_light_wa'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: false,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak', hours_description: '6–9 PM daily (all year)', summer_rate_per_kwh: 0.24, winter_rate_per_kwh: 0.22, applies_weekends: true, applies_holidays: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'All other hours (9 PM–6 PM)', summer_rate_per_kwh: 0.09, winter_rate_per_kwh: 0.08, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.pse.com/en/rates-and-services/electric-rates',
    solar_pro_note: 'Washington State mandates full retail NEM (1:1) for systems ≤ 100 kW. PSE on-peak window (6–9 PM) is after typical solar production hours — battery is useful but not essential for most customers.',
    last_verified: '2025-05',
  },

  // ── Portland General Electric (OR) TOU ───────────────────────────────────
  {
    plan_id: 'pge_or_tou',
    plan_name: 'Time-of-Use Rate (PGE Oregon)',
    plan_description: 'Portland General Electric TOU. On-peak: Mon–Fri 5–9 PM. Oregon full retail NEM (1:1) for residential systems ≤ 25 kW. Annual true-up with excess paid at avoided-cost rate.',
    utility_ids: ['portland_general_or', 'pacificorp_or', 'eugene_water_electric_board_or'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: false,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak', hours_description: 'Mon–Fri 5–9 PM year-round', summer_rate_per_kwh: 0.22, winter_rate_per_kwh: 0.19, applies_weekends: false, applies_holidays: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'All other hours, weekends, holidays', summer_rate_per_kwh: 0.09, winter_rate_per_kwh: 0.09, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://portlandgeneral.com/energy-choices/home-energy-management/time-of-day',
    solar_pro_note: 'Oregon mandates retail NEM for residential ≤ 25 kW. PGE on-peak window (5–9 PM) is post-solar-production — battery storage extends the value of solar into peak hours.',
    last_verified: '2025-05',
  },

  // ── Xcel Energy (MN) TOU ─────────────────────────────────────────────────
  {
    plan_id: 'xcel_mn_tou',
    plan_name: 'Time-of-Day Rate (Xcel MN)',
    plan_description: 'Xcel Energy Minnesota residential TOU. On-peak: Mon–Fri 9 AM–9 PM summer, 6–9 AM and 5–9 PM winter. Full retail NEM applies in MN. Solar*Rewards performance incentive available.',
    utility_ids: ['xcel_mn'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: false,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak (Summer)', hours_description: 'Mon–Fri 9 AM–9 PM (Jun–Sep)', summer_rate_per_kwh: 0.18, applies_weekends: false },
      { period: 'on_peak', label: 'On-Peak (Winter)', hours_description: 'Mon–Fri 6–9 AM and 5–9 PM (Oct–May)', winter_rate_per_kwh: 0.15, applies_weekends: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'All other hours and weekends', summer_rate_per_kwh: 0.08, winter_rate_per_kwh: 0.07, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.xcelenergy.com/programs_and_rebates/residential_programs_and_rebates/solar_*_rewards_program',
    solar_pro_note: 'MN mandates retail NEM. Xcel Solar*Rewards pays per-kWh performance incentive on top of NEM credits. Summer on-peak (9 AM–9 PM) aligns perfectly with solar production.',
    last_verified: '2025-05',
  },

  // ── We Energies / Madison Gas & Electric (WI) TOU ────────────────────────
  {
    plan_id: 'we_energies_tou',
    plan_name: 'Time-of-Use Rate (Wisconsin)',
    plan_description: 'We Energies and MGE Wisconsin residential TOU. On-peak: Mon–Fri 8 AM–9 PM summer, 6–9 AM and 6–9 PM winter. Wisconsin full retail NEM for systems ≤ 20 kW.',
    utility_ids: ['we_energies_wi', 'madison_gas_electric_wi', 'alliant_wi'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: false,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak (Summer)', hours_description: 'Mon–Fri 8 AM–9 PM (Jun–Sep)', summer_rate_per_kwh: 0.20, applies_weekends: false },
      { period: 'on_peak', label: 'On-Peak (Winter)', hours_description: 'Mon–Fri 6–9 AM and 6–9 PM (Oct–May)', winter_rate_per_kwh: 0.17, applies_weekends: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'All other hours and weekends', summer_rate_per_kwh: 0.08, winter_rate_per_kwh: 0.07, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.we-energies.com/residential/rates/',
    solar_pro_note: 'Wisconsin mandates retail NEM for residential ≤ 20 kW. We Energies summer on-peak (8 AM–9 PM) covers prime solar hours — system should offset maximum on-peak usage to maximize bill savings.',
    last_verified: '2025-05',
  },

  // ── AEP Ohio / FirstEnergy / Dayton Power & Light TOU ────────────────────
  {
    plan_id: 'aep_oh_tou',
    plan_name: 'Time-of-Use Rate (Ohio IOU)',
    plan_description: 'Ohio IOU TOU rate. On-peak: Mon–Fri 3–7 PM. Ohio full retail NEM applies for systems ≤ 10 kW (≤ 100 kW commercial). Annual true-up excess paid at avoided-cost rate.',
    utility_ids: ['aep_oh', 'firstenergy_oh', 'duke_energy_ohio_oh', 'dayton_power_light_oh'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: false,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak', hours_description: 'Mon–Fri 3–7 PM year-round', summer_rate_per_kwh: 0.18, winter_rate_per_kwh: 0.16, applies_weekends: false, applies_holidays: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'All other hours, weekends, holidays', summer_rate_per_kwh: 0.07, winter_rate_per_kwh: 0.07, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.aepohio.com/account/billing/rates/timeofuse/',
    solar_pro_note: 'Ohio mandates NEM at full retail distribution rate. AEP OH on-peak window (3–7 PM) partially overlaps afternoon solar production — properly sized system can eliminate most on-peak consumption.',
    last_verified: '2025-05',
  },

  // ── FPL / Tampa Electric / Duke Florida TOU ──────────────────────────────
  {
    plan_id: 'fpl_tou',
    plan_name: 'Time-of-Use Residential (Florida IOUs)',
    plan_description: 'Florida IOU TOU rate. On-peak: Mon–Fri noon–9 PM (summer), 6–10 AM and 5–9 PM (winter). Florida mandates retail NEM for all systems. No system size cap for residential.',
    utility_ids: ['fpl_fl', 'tampa_electric_fl', 'gulf_power_fl', 'duke_fl', 'jea_fl', 'ouc_fl', 'lakeland_electric_fl', 'gainesville_regional_utilities_fl'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: true,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak (Summer)', hours_description: 'Mon–Fri noon–9 PM (Jun–Sep)', summer_rate_per_kwh: 0.16, applies_weekends: false },
      { period: 'on_peak', label: 'On-Peak (Winter)', hours_description: 'Mon–Fri 6–10 AM and 5–9 PM (Oct–May)', winter_rate_per_kwh: 0.14, applies_weekends: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'All other hours', summer_rate_per_kwh: 0.08, winter_rate_per_kwh: 0.07, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.fpl.com/rates/residential-time-of-use.html',
    solar_pro_note: 'Florida strong solar resource (5.5–6 peak sun hours). TOU summer noon–9 PM peak aligns with midday solar — good production offset. Battery beneficial for evening 5–9 PM winter peak.',
    last_verified: '2025-05',
  },

  // ── Ameren Missouri TOU ──────────────────────────────────────────────────
  {
    plan_id: 'ameren_mo_tou',
    plan_name: 'Renewable Choice / Time-of-Use (Ameren MO)',
    plan_description: 'Ameren Missouri TOU pricing. On-peak: Mon–Fri 2–8 PM summer, 6–9 AM and 5–8 PM winter. Missouri full retail NEM applies for systems ≤ 100 kW.',
    utility_ids: ['ameren_mo'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: true,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak (Summer)', hours_description: 'Mon–Fri 2–8 PM (Jun–Sep)', summer_rate_per_kwh: 0.17, applies_weekends: false },
      { period: 'on_peak', label: 'On-Peak (Winter)', hours_description: 'Mon–Fri 6–9 AM and 5–8 PM (Oct–May)', winter_rate_per_kwh: 0.14, applies_weekends: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'All other hours and weekends', summer_rate_per_kwh: 0.07, winter_rate_per_kwh: 0.07, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.ameren.com/missouri/residential/programs-products/renewable-choice',
    solar_pro_note: 'Missouri mandates retail NEM for systems ≤ 100 kW residential. Ameren MO summer 2–8 PM peak partially overlaps afternoon solar production. Battery recommended for capturing full peak-hour value.',
    last_verified: '2025-05',
  },

  // ── Evergy (KS / MO) TOU ─────────────────────────────────────────────────
  {
    plan_id: 'evergy_tou',
    plan_name: 'Time-of-Day Rate (Evergy)',
    plan_description: 'Evergy Kansas/Missouri TOU residential rate. On-peak: Mon–Fri 3–7 PM. Kansas full retail NEM. Missouri full retail NEM for systems ≤ 100 kW.',
    utility_ids: ['evergy_ks', 'westar_energy_ks', 'kansas_city_power_light_ks', 'evergy_mo_ks'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: false,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak', hours_description: 'Mon–Fri 3–7 PM year-round', summer_rate_per_kwh: 0.17, winter_rate_per_kwh: 0.14, applies_weekends: false, applies_holidays: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'All other hours, weekends, holidays', summer_rate_per_kwh: 0.07, winter_rate_per_kwh: 0.07, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://evergy.com/manage-account/your-bill/rate-information',
    solar_pro_note: 'Both KS and MO mandate full retail NEM. Evergy on-peak window (3–7 PM) partially aligns with afternoon solar — well-sized system eliminates most peak consumption.',
    last_verified: '2025-05',
  },

  // ── SRP (Salt River Project) Arizona TOU ─────────────────────────────────
  {
    plan_id: 'srp_tou',
    plan_name: 'SRP E-27 Solar Plan (Time-of-Use)',
    plan_description: 'SRP E-27 is the standard NEM plan for solar customers. On-peak: Mon–Fri 5–9 PM (summer). SRP pays avoided-cost rate (~2.8 cents/kWh) for exported energy — battery storage dramatically improves economics.',
    utility_ids: ['srp_az'],
    type: 'tou_rate',
    solar_friendly: false,
    battery_optimized: true,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak', hours_description: 'Mon–Fri 5–9 PM (May–Oct)', summer_rate_per_kwh: 0.26, applies_weekends: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'All other hours (9 PM–5 PM)', summer_rate_per_kwh: 0.07, winter_rate_per_kwh: 0.07, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.srpnet.com/price-plans/home/e-27',
    eligibility_note: 'SRP E-27 required for solar/NEM customers. Demand charge applies for usage above 1 kW peak.',
    solar_pro_note: 'SRP is not a traditional regulated utility (co-op structure). E-27 pays only ~2.8¢/kWh for exports — battery is REQUIRED to maximize self-consumption and discharge during $0.26/kWh on-peak hours.',
    last_verified: '2025-05',
  },

  // ── Tucson Electric Power (TEP) TOU ──────────────────────────────────────
  {
    plan_id: 'tep_tou',
    plan_name: 'Renewable Energy Credit Rate (TEP Solar TOU)',
    plan_description: 'TEP residential TOU for solar customers. On-peak: Mon–Fri 3–8 PM (summer), 5–9 PM (winter). Export credit ~7–9 cents/kWh (below retail). Battery maximizes self-consumption value.',
    utility_ids: ['tep_az', 'uns_electric_az'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: true,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak (Summer)', hours_description: 'Mon–Fri 3–8 PM (Apr–Oct)', summer_rate_per_kwh: 0.24, applies_weekends: false },
      { period: 'on_peak', label: 'On-Peak (Winter)', hours_description: 'Mon–Fri 5–9 PM (Nov–Mar)', winter_rate_per_kwh: 0.19, applies_weekends: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'All other hours', summer_rate_per_kwh: 0.08, winter_rate_per_kwh: 0.08, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.tep.com/electric-vehicles-and-solar/solar/',
    solar_pro_note: 'TEP export credits are below retail (~7–9¢/kWh). Battery storage dispatching during 3–8 PM on-peak window significantly outperforms simple NEM. Arizona 25% solar+battery adoption makes battery standard recommendation.',
    last_verified: '2025-05',
  },

  // ── NIPSCO / AES Indiana / AEP Indiana TOU ───────────────────────────────
  {
    plan_id: 'nipsco_tou',
    plan_name: 'Rider CV-TOU (Indiana IOUs)',
    plan_description: 'Indiana IOU time-of-use residential rate. On-peak: Mon–Fri 2–8 PM. Indiana eliminated retail NEM in 2022 — exports credited at avoided cost (~4–5 cents/kWh). Battery storage critical to maximize self-consumption.',
    utility_ids: ['nipsco_in', 'aes_indiana_in', 'aep_indiana'],
    type: 'tou_rate',
    solar_friendly: false,
    battery_optimized: true,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak', hours_description: 'Mon–Fri 2–8 PM year-round', summer_rate_per_kwh: 0.17, winter_rate_per_kwh: 0.14, applies_weekends: false, applies_holidays: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'All other hours, weekends, holidays', summer_rate_per_kwh: 0.07, winter_rate_per_kwh: 0.07, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.nipsco.com/home/products-and-services/renewable-programs',
    solar_pro_note: 'Indiana exports earn only avoided-cost (~4–5¢/kWh) for new solar customers (post-2022). Battery storage is the standard recommendation — self-consuming solar at retail rates (vs exporting at 4¢) dramatically improves project economics.',
    last_verified: '2025-05',
  },

  // ── Texas TDSP TOU Note (Oncor / CenterPoint / AEP TX) ───────────────────
  {
    plan_id: 'tx_tdsp_tou',
    plan_name: 'TDSP Wires Charge (Texas Deregulated Market)',
    plan_description: 'Texas electricity is deregulated — customers choose their Retail Electric Provider (REP) separately from the Transmission & Distribution Service Provider (TDSP). TDSPs (Oncor, CenterPoint, AEP Texas, TNMP) deliver power; REPs set rates and solar buyback terms.',
    utility_ids: ['oncor_tx', 'centerpoint_tx', 'aep_texas_tx', 'tnmp_tx', 'sharyland_tx', 'entergy_tx'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: false,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'Peak Hours (typical REP)', hours_description: 'Typical REP on-peak: weekdays 3–8 PM summer. Varies by chosen REP.', summer_rate_per_kwh: 0.15, applies_weekends: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'All other hours (varies by REP)', summer_rate_per_kwh: 0.08, winter_rate_per_kwh: 0.08, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.powertochoose.org',
    eligibility_note: 'In deregulated TX market, customer selects REP (e.g. Pulse Power, TXU, Green Mountain Energy) which sets actual solar buyback rates. TDSP is the wires company.',
    solar_pro_note: 'Texas has no statewide NEM mandate. Solar buyback depends on chosen REP — some offer full retail buyback (Green Mountain, Rhythm), others offer low avoided-cost. Advise customers to select a solar-friendly REP on powertochoose.org before installing solar.',
    last_verified: '2025-05',
  },

  // ── Rocky Mountain Power / PacifiCorp (UT/WY/ID) TOU ────────────────────
  {
    plan_id: 'rmp_tou',
    plan_name: 'Time-of-Use Pilot Rate (Rocky Mountain Power)',
    plan_description: 'Rocky Mountain Power (PacifiCorp) residential TOU in UT/WY/ID. On-peak: Mon–Fri 3–8 PM. Utah/WY/ID mandates retail NEM for qualifying systems. RMP Solar Incentive Program (SIP) may offer additional production incentive.',
    utility_ids: ['rockmtn_power_ut', 'pacificorp_wy', 'rocky_mountain_power_id', 'pacificorp_wa', 'pacificorp_or'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: false,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak', hours_description: 'Mon–Fri 3–8 PM year-round', summer_rate_per_kwh: 0.16, winter_rate_per_kwh: 0.13, applies_weekends: false, applies_holidays: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'All other hours, weekends, holidays', summer_rate_per_kwh: 0.07, winter_rate_per_kwh: 0.07, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.rockymountainpower.net/energy-economy/renewables/solar.html',
    solar_pro_note: 'RMP/PacifiCorp territories in UT, WY, ID, WA, OR all have retail NEM with some variations. UT net metering is 1:1 up to 25 kW residential. WY and ID have modest NEM with size caps. Check state-specific limits.',
    last_verified: '2025-05',
  },

  // ── Idaho Power TOU ───────────────────────────────────────────────────────
  {
    plan_id: 'idaho_power_tou',
    plan_name: 'Time-of-Use Rider (Idaho Power)',
    plan_description: 'Idaho Power residential TOU. On-peak: Mon–Fri 3–9 PM (summer), 7–11 AM and 5–9 PM (winter). Idaho retail NEM applies (1:1 net metering) for systems ≤ monthly consumption.',
    utility_ids: ['idaho_power', 'avista_id', 'avista_wa'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: false,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak (Summer)', hours_description: 'Mon–Fri 3–9 PM (Jun–Aug)', summer_rate_per_kwh: 0.17, applies_weekends: false },
      { period: 'on_peak', label: 'On-Peak (Winter)', hours_description: 'Mon–Fri 7–11 AM and 5–9 PM (Nov–Mar)', winter_rate_per_kwh: 0.13, applies_weekends: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'All other hours', summer_rate_per_kwh: 0.07, winter_rate_per_kwh: 0.07, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.idahopower.com/energy-environment/ways-to-save/home/time-of-use-rates/',
    solar_pro_note: 'Idaho Power has high hydro capacity — lower residential rates (~7–9 cents base). Solar still pencils well with NEM at retail rates. Summer 3–9 PM on-peak window slightly after solar peak — battery optional.',
    last_verified: '2025-05',
  },

  // ── MidAmerican Energy (IA / IL) TOU ─────────────────────────────────────
  {
    plan_id: 'midamerican_tou',
    plan_name: 'Time-of-Use Rate (MidAmerican Energy)',
    plan_description: 'MidAmerican Energy Iowa/Illinois TOU residential rate. On-peak: Mon–Fri 12–9 PM summer, 7 AM–9 PM winter. Iowa/Illinois retail NEM mandates apply.',
    utility_ids: ['midamerican_ia', 'midamerican_il'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: false,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak (Summer)', hours_description: 'Mon–Fri noon–9 PM (Jun–Sep)', summer_rate_per_kwh: 0.18, applies_weekends: false },
      { period: 'on_peak', label: 'On-Peak (Winter)', hours_description: 'Mon–Fri 7 AM–9 PM (Oct–May)', winter_rate_per_kwh: 0.14, applies_weekends: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'Nights, weekends, holidays', summer_rate_per_kwh: 0.06, winter_rate_per_kwh: 0.06, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.midamericanenergy.com/solar',
    solar_pro_note: 'MidAmerican Iowa is one of the largest renewable utilities in the US (>90% renewable). Iowa mandates retail NEM. Summer noon–9 PM on-peak covers full solar production window — excellent TOU alignment.',
    last_verified: '2025-05',
  },

  // ── National Grid (RI / MA Upstate) TOU ──────────────────────────────────
  {
    plan_id: 'natgrid_tou',
    plan_name: 'Time-of-Use Residential Rate (National Grid)',
    plan_description: 'National Grid RI and MA TOU. On-peak: 8 AM–8 PM daily. RI and MA retail NEM (1:1). MA SMART program provides additional incentive payments per kWh generated.',
    utility_ids: ['national_grid_ri', 'natgrid_ma'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: false,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak', hours_description: '8 AM–8 PM daily (all year)', summer_rate_per_kwh: 0.28, winter_rate_per_kwh: 0.26, applies_weekends: true, applies_holidays: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: '8 PM–8 AM daily', summer_rate_per_kwh: 0.12, winter_rate_per_kwh: 0.11, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.nationalgridus.com/ri-home/rates-and-tariffs',
    solar_pro_note: 'RI and MA have some of the highest electricity rates in the US ($0.25–0.32/kWh). Full retail NEM + MA SMART incentive makes solar extremely compelling. Battery storage useful but not required at current export rates.',
    last_verified: '2025-05',
  },

  // ── Hawaiian Electric (HECO) TOU ─────────────────────────────────────────
  {
    plan_id: 'heco_tou',
    plan_name: 'TOU+ / Customer Self-Supply (CSS)',
    plan_description: "Hawaiian Electric TOU programs. Hawaii moved away from NEM to Customer Self-Supply (CSS) — no grid export credit. ALL solar generation must be self-consumed or stored. Battery storage is MANDATORY for economic viability in Hawaii.",
    utility_ids: ['hawaiian_electric'],
    type: 'tou_rate',
    solar_friendly: false,
    battery_optimized: true,
    nem_compatible: false,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak', hours_description: '5–10 PM daily (highest grid demand)', summer_rate_per_kwh: 0.38, winter_rate_per_kwh: 0.35, applies_weekends: true, applies_holidays: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'Solar production hours (8 AM–5 PM)', summer_rate_per_kwh: 0.28, winter_rate_per_kwh: 0.25, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.hawaiianelectric.com/clean-energy-hawaii/going-solar/customer-self-supply',
    eligibility_note: 'New HECO customers: CSS program (no grid export). Legacy NEM customers: grandfathered until 2024–2025.',
    solar_pro_note: 'Hawaii has NO net metering for new customers — CSS program means zero export credits. Battery storage is REQUIRED (not optional) for a solar system to make economic sense. Recommend 1:1 battery-to-solar ratio minimum. Hawaii has highest US residential rates ($0.35–0.45/kWh) so self-consumption value is enormous.',
    last_verified: '2025-05',
  },

  // ── NorthWestern Energy (MT) TOU ─────────────────────────────────────────
  {
    plan_id: 'northwestern_mt_tou',
    plan_name: 'Time-of-Use Option (NorthWestern Energy)',
    plan_description: 'NorthWestern Energy Montana TOU. On-peak: Mon–Fri 3–8 PM (summer), 7–10 AM and 5–10 PM (winter). Montana retail NEM (1:1) for residential systems ≤ 50 kW.',
    utility_ids: ['northwestern_mt', 'mdu_mt'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: false,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak (Summer)', hours_description: 'Mon–Fri 3–8 PM (Jun–Sep)', summer_rate_per_kwh: 0.15, applies_weekends: false },
      { period: 'on_peak', label: 'On-Peak (Winter)', hours_description: 'Mon–Fri 7–10 AM and 5–10 PM (Oct–May)', winter_rate_per_kwh: 0.13, applies_weekends: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'All other hours', summer_rate_per_kwh: 0.07, winter_rate_per_kwh: 0.07, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.northwesternenergy.com/your-home/rates-and-service/rate-schedules',
    solar_pro_note: 'Montana mandates retail NEM for residential ≤ 50 kW. Low base rates ($0.09–0.11/kWh) but NEM still beneficial. Strong solar resource in eastern MT (5+ peak sun hours summer).',
    last_verified: '2025-05',
  },

  // ── PNM (New Mexico) TOU ──────────────────────────────────────────────────
  {
    plan_id: 'pnm_tou',
    plan_name: 'Time-of-Use Residential (PNM)',
    plan_description: 'PNM New Mexico TOU residential rate. On-peak: Mon–Fri 3–8 PM (summer). New Mexico retail NEM (1:1) mandated for systems ≤ 80 kW. Annual true-up excess paid at avoided-cost rate.',
    utility_ids: ['pnm_nm', 'el_paso_electric_nm', 'xcel_energy_nm_nm', 'southwestern_public_service_nm'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: false,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak', hours_description: 'Mon–Fri 3–8 PM (Jun–Sep)', summer_rate_per_kwh: 0.18, applies_weekends: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'All other hours', summer_rate_per_kwh: 0.08, winter_rate_per_kwh: 0.08, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.pnm.com/rates/solar',
    solar_pro_note: 'New Mexico has exceptional solar resource (>300 sun days). NM mandates 1:1 NEM up to 80 kW residential. PNM on-peak (3–8 PM) is after solar peak — afternoon battery discharge optimizes peak-hour offset.',
    last_verified: '2025-05',
  },

  // ── BGE / Pepco / Choptank / Delmarva (Maryland) TOU ─────────────────────
  {
    plan_id: 'bge_tou',
    plan_name: 'Time-of-Use Rate (Maryland IOUs)',
    plan_description: 'Maryland IOU TOU residential rates. On-peak: 10 AM–8 PM daily (Jun–Sep), 7 AM–11 PM (Oct–May). Maryland mandates full retail NEM (1:1). Strong SREC market adds ~$50–80/MWh additional income.',
    utility_ids: ['bge_md', 'pepco_md', 'choptank_md', 'delmarva_md', 'potomac_edison_md', 'southern_maryland_ec_md', 'a_n_ec_md', 'city_of_hagerstown_electric_md', 'city_of_thurmont_electric_md', 'easton_utilities_md'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: false,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak (Summer)', hours_description: '10 AM–8 PM daily (Jun–Sep)', summer_rate_per_kwh: 0.21, applies_weekends: true },
      { period: 'on_peak', label: 'On-Peak (Winter)', hours_description: '7 AM–11 PM weekdays (Oct–May)', winter_rate_per_kwh: 0.18, applies_weekends: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: '8 PM–10 AM (summer nights), winter off-peak hours', summer_rate_per_kwh: 0.09, winter_rate_per_kwh: 0.09, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://bge.com/EnergyEfficiency/BusinessPrograms/Pages/FlatDemand.aspx',
    solar_pro_note: 'Maryland mandates full retail NEM. Summer on-peak (10 AM–8 PM daily) covers full solar production window — every kWh produced offsets at on-peak rate. SREC program adds $50–80/MWh additional income ($60–100/yr per kW installed).',
    last_verified: '2025-05',
  },

  // ── Central Maine Power / Versant (Maine) TOU ────────────────────────────
  {
    plan_id: 'cmp_me_tou',
    plan_name: 'Time-of-Use Rate (Maine)',
    plan_description: 'Maine IOU TOU residential rate. On-peak: Mon–Fri 7 AM–9 PM. Maine full retail NEM (1:1) for residential systems ≤ 660 kW. Generous annual credit banking.',
    utility_ids: ['versant_power_me', 'bangor_hydro_electric_me', 'eastern_maine_ec_me'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: false,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak', hours_description: 'Mon–Fri 7 AM–9 PM year-round', summer_rate_per_kwh: 0.22, winter_rate_per_kwh: 0.20, applies_weekends: false, applies_holidays: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'Evenings, nights, weekends', summer_rate_per_kwh: 0.10, winter_rate_per_kwh: 0.10, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.cmpco.com/en/account-support/rates-and-tariffs.html',
    solar_pro_note: 'Maine mandates full retail NEM (1:1) up to 660 kW. High electricity rates ($0.20–0.28/kWh) make Maine excellent for solar ROI. On-peak covers prime solar production hours.',
    last_verified: '2025-05',
  },

  // ── Eversource / Unitil (NH) TOU ─────────────────────────────────────────
  {
    plan_id: 'eversource_nh_tou',
    plan_name: 'Time-of-Use Rate (New Hampshire)',
    plan_description: 'Eversource and Unitil NH TOU residential rate. On-peak: Mon–Fri 7 AM–7 PM. NH mandates full retail NEM for residential systems ≤ 100 kW. No system size cap for small residential.',
    utility_ids: ['eversource_nh', 'unitil_nh', 'granite_state_electric_nh', 'nh_ec_nh', 'new_hampshire_ec_nh'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: false,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak', hours_description: 'Mon–Fri 7 AM–7 PM year-round', summer_rate_per_kwh: 0.26, winter_rate_per_kwh: 0.24, applies_weekends: false, applies_holidays: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'Evenings, nights, weekends', summer_rate_per_kwh: 0.12, winter_rate_per_kwh: 0.11, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.eversource.com/content/nh/residential/accounts-billing/rates-and-tariffs',
    solar_pro_note: 'NH mandates full retail NEM up to 100 kW. High electricity rates ($0.22–0.28/kWh) make solar ROI excellent. On-peak (7 AM–7 PM) covers full solar production window — ideal TOU alignment.',
    last_verified: '2025-05',
  },

  // ── United Illuminating / Additional CT Utilities TOU ────────────────────
  {
    plan_id: 'ui_ct_tou',
    plan_name: 'Time-of-Use Rate (Connecticut)',
    plan_description: 'CT IOU TOU residential rate. On-peak: Mon–Fri 7 AM–9 PM summer, 7 AM–9 PM winter. CT mandates full retail NEM for residential systems ≤ 25 kW. Residential Solar Investment Program (RSIP) rebates available.',
    utility_ids: ['ui_ct', 'eversource_cl_ct', 'groton_utilities_ct', 'norwich_public_utilities_ct'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: false,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak', hours_description: 'Mon–Fri 7 AM–9 PM year-round', summer_rate_per_kwh: 0.29, winter_rate_per_kwh: 0.26, applies_weekends: false, applies_holidays: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'Evenings, nights, weekends', summer_rate_per_kwh: 0.13, winter_rate_per_kwh: 0.12, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.uinet.com/wps/portal/uinet/smartenergy/solarenergy/',
    solar_pro_note: 'CT mandates full retail NEM for residential ≤ 25 kW. Very high electricity rates ($0.24–0.32/kWh) make CT one of the best solar states. RSIP rebates add $300–$900 upfront incentive. On-peak covers prime solar hours.',
    last_verified: '2025-05',
  },

  // ── Appalachian Power / Rappahannock (Virginia cooperatives) TOU ──────────
  {
    plan_id: 'appalachian_va_tou',
    plan_name: 'Time-of-Use Rate (Virginia IOUs/Coops)',
    plan_description: 'Appalachian Power (AEP VA) and VA cooperative TOU rates. On-peak: Mon–Fri 6–10 AM and 5–9 PM. Virginia mandates full retail NEM for systems ≤ 20 kW residential, ≤ 500 kW commercial.',
    utility_ids: ['appalachian_power_va', 'rappahannock_electric_va', 'appalachian_power_wv', 'dominion_energy_nc_nc'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: true,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak', hours_description: 'Mon–Fri 6–10 AM and 5–9 PM year-round', summer_rate_per_kwh: 0.18, winter_rate_per_kwh: 0.16, applies_weekends: false, applies_holidays: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'All other hours', summer_rate_per_kwh: 0.07, winter_rate_per_kwh: 0.07, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.appalachianpower.com/energy/renewables/solar/',
    solar_pro_note: 'Virginia mandates full retail NEM. Dual morning/evening peaks — battery optimal for morning pre-solar peak dispatch. Solar covers 10 AM–5 PM midday dip. Well-suited for solar+battery.',
    last_verified: '2025-05',
  },

  // ── Alliant Energy / Black Hills Iowa TOU ────────────────────────────────
  {
    plan_id: 'alliant_ia_tou',
    plan_name: 'Time-of-Use Rate (Iowa)',
    plan_description: 'Alliant Energy (IPL) and Iowa utilities TOU. On-peak: Mon–Fri 2–7 PM summer, 7–9 AM and 5–9 PM winter. Iowa mandates retail NEM for residential systems ≤ 500 kW.',
    utility_ids: ['alliant_ia', 'alliant_wi', 'black_hills_energy_ia'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: false,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak (Summer)', hours_description: 'Mon–Fri 2–7 PM (Jun–Sep)', summer_rate_per_kwh: 0.16, applies_weekends: false },
      { period: 'on_peak', label: 'On-Peak (Winter)', hours_description: 'Mon–Fri 7–9 AM and 5–9 PM (Oct–May)', winter_rate_per_kwh: 0.13, applies_weekends: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'All other hours', summer_rate_per_kwh: 0.06, winter_rate_per_kwh: 0.06, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.alliantenergy.com/EnergyEfficiency/RenewableEnergy/RenewableEnergyforHome/SolarEnergy',
    solar_pro_note: 'Iowa mandates retail NEM up to 500 kW. Alliant Energy has committed to 100% clean energy. Summer 2–7 PM on-peak aligns with afternoon solar production — excellent TOU-solar alignment.',
    last_verified: '2025-05',
  },

  // ── Entergy (LA / AR / MS / TX) TOU ──────────────────────────────────────
  {
    plan_id: 'entergy_tou',
    plan_name: 'Residential TOU Rate (Entergy)',
    plan_description: 'Entergy Louisiana, Arkansas, Mississippi, and Texas TOU rate. On-peak: Mon–Fri noon–8 PM summer. Louisiana/AR/MS have retail NEM requirements. TX: no statewide NEM mandate (deregulated).',
    utility_ids: ['entergy_la', 'entergy_ar', 'entergy_ms', 'entergy_tx', 'swepco_la', 'swepco_ar'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: false,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak (Summer)', hours_description: 'Mon–Fri noon–8 PM (Jun–Sep)', summer_rate_per_kwh: 0.15, applies_weekends: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'All other hours', summer_rate_per_kwh: 0.07, winter_rate_per_kwh: 0.07, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.entergy-louisiana.com/save_money/residential_programs.aspx',
    solar_pro_note: 'Louisiana mandates retail NEM for residential systems. Arkansas and Mississippi have NEM with limits. Gulf Coast high solar resource (5–5.5 peak sun hours). TOU noon–8 PM summer peak covers prime solar production.',
    last_verified: '2025-05',
  },

  // ── OGE / PSO (Oklahoma) TOU ─────────────────────────────────────────────
  {
    plan_id: 'oge_tou',
    plan_name: 'Smart Hours / Time-of-Use (Oklahoma)',
    plan_description: 'Oklahoma Gas & Electric (OGE) and Public Service Company of Oklahoma (PSO) TOU residential rates. On-peak: Mon–Fri 2–7 PM summer. Oklahoma retail NEM for residential systems ≤ 25 kW.',
    utility_ids: ['oge_ok', 'pso_ok', 'oec_ok'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: false,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak', hours_description: 'Mon–Fri 2–7 PM (Jun–Sep)', summer_rate_per_kwh: 0.17, applies_weekends: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'All other hours including winter', summer_rate_per_kwh: 0.07, winter_rate_per_kwh: 0.07, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.oge.com/wps/portal/oge/save-energy/home/smarthours',
    solar_pro_note: 'Oklahoma mandates retail NEM for residential ≤ 25 kW. OGE Smart Hours is one of the most popular TOU programs in the south. Strong Oklahoma solar resource (5+ sun hours). 2–7 PM peak aligns with afternoon solar production.',
    last_verified: '2025-05',
  },

  // ── Indiana Rural Electric Cooperatives TOU ───────────────────────────────
  {
    plan_id: 'indiana_coop_tou',
    plan_name: 'Net Metering Rate (Indiana Cooperatives)',
    plan_description: 'Indiana rural electric cooperatives follow state net metering rules. Post-2022: avoided-cost export credit (~4–5 cents/kWh). Battery storage is strongly recommended to maximize self-consumption and avoid exporting at low avoided-cost rates.',
    utility_ids: ['bartholomew_county_remc_in','boone_county_remc_in','carroll_white_remc_in','clark_county_remc_in','daviess_martin_county_remc_in','decatur_county_remc_in','dubois_rec_in','fulton_county_remc_in','harrison_county_remc_in','henry_county_remc_in','hendricks_power_coop_in','jackson_county_remc_in','jay_county_remc_in','johnson_county_remc_in','kankakee_valley_remc_in','knox_county_remc_in','lagrange_county_remc_in','northeastern_remc_in','orange_county_remc_in','parke_county_remc_in','pulaski_white_remc_in','randolph_county_remc_in','rush_county_remc_in','south_central_indiana_remc_in','southeastern_indiana_remc_in','tipmont_remc_in','utilities_district_of_western_indiana_remc_in','wabash_valley_power_alliance_in','warren_county_remc_in','white_county_remc_in'],
    type: 'tou_rate',
    solar_friendly: false,
    battery_optimized: true,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'Peak (Demand)', hours_description: 'Mon–Fri 2–8 PM typical', summer_rate_per_kwh: 0.15, winter_rate_per_kwh: 0.13, applies_weekends: false, applies_holidays: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'All other hours', summer_rate_per_kwh: 0.07, winter_rate_per_kwh: 0.07, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.remc.com',
    solar_pro_note: 'Indiana HB 1278 (2022): new solar customers receive avoided-cost (~$0.04–0.05/kWh) for exports, NOT retail rate. Existing customers grandfathered until 2032. For new installs, battery storage is the key value-add — self-consuming solar at $0.13–0.15/kWh vs exporting at $0.04–0.05/kWh.',
    last_verified: '2025-05',
  },
// Inject before closing ]; of TOU_RATE_PLANS array

  // ── Alabama Power (Southern Company) ──────────────────────────────────────────
  {
    plan_id: 'alabama_power_tou',
    plan_name: 'Time-of-Use Rate (Residential TOU-1)',
    plan_description: 'Alabama Power residential TOU. On-peak: weekdays 12–9 PM June–Sept; 6 AM–9 PM Oct–May. Off-peak all other hours and weekends. Net metering at avoided-cost rate (~3–4¢/kWh) — battery critical.',
    utility_ids: ['alabama_power'],
    type: 'tou_rate',
    solar_friendly: false,
    battery_optimized: true,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak', hours_description: 'Weekdays 12–9 PM (Jun–Sep), 6 AM–9 PM (Oct–May)', summer_rate_per_kwh: 0.18, winter_rate_per_kwh: 0.15, applies_weekends: false, applies_holidays: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'All other hours, all weekends', summer_rate_per_kwh: 0.09, winter_rate_per_kwh: 0.08, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.alabamapower.com/account/ways-to-save/time-of-use.html',
    solar_pro_note: 'Alabama Power net metering pays avoided-cost (~3¢/kWh) — far below retail. Battery storage is essential to avoid exporting at these low rates. TOU plan allows arbitrage: battery charges off-peak (9¢) and covers on-peak hours (18¢ summer). Alabama also has a TVA-fed area — confirm which territory before quoting.',
    last_verified: '2025-05',
  },

  // ── TVA (Tennessee Valley Authority) region ───────────────────────────────────
  {
    plan_id: 'tva_tou',
    plan_name: 'Green Power Switch / Time-of-Use (TVA Territory)',
    plan_description: 'TVA-fed utilities (Nashville ES, Memphis LGW, Knoxville UB, Bristol TN) follow TVA wholesale TOU structure. On-peak: 1–9 PM weekdays June–Sept; 4 AM–10 AM and 4 PM–9 PM Oct–May. TVA net metering credits at avoided-cost rate.',
    utility_ids: ['tva_al', 'nashville_electric_service_tn', 'memphis_light_gas_water_tn', 'knoxville_utilities_board_tn', 'bristol_tennessee_essential_services_tn', 'fayetteville_public_utilities_tn', 'powell_clinch_utility_district_tn'],
    type: 'tou_rate',
    solar_friendly: false,
    battery_optimized: true,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak', hours_description: 'Weekdays 1–9 PM (Jun–Sep), AM/PM peaks (Oct–May)', summer_rate_per_kwh: 0.17, winter_rate_per_kwh: 0.14, applies_weekends: false, applies_holidays: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'All other hours and weekends', summer_rate_per_kwh: 0.08, winter_rate_per_kwh: 0.07, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.tva.com/energy/residential-customers/green-power-switch',
    solar_pro_note: 'TVA territory net metering is at avoided-cost (~2–4¢/kWh) under the 2019 TVA EnergyRight Solar policy. This makes battery storage critical for any TVA-territory solar install. Battery stores midday solar and discharges 1–9 PM at 17¢/kWh to maximize self-consumption value. TVA territory spans all of Tennessee and parts of AL, MS, GA, KY, NC, VA.',
    last_verified: '2025-05',
  },

  // ── Duke Energy Indiana ────────────────────────────────────────────────────────
  {
    plan_id: 'duke_indiana_tou',
    plan_name: 'Time-of-Use Pricing (Duke Indiana)',
    plan_description: 'Duke Energy Indiana residential TOU. On-peak: 2–7 PM weekdays June–Aug. Off-peak all other times. Indiana HB 1278 (2022) eliminated retail NEM — exports credited at avoided-cost (~4–5¢/kWh). Battery essential.',
    utility_ids: ['duke_indiana', 'aep_indiana'],
    type: 'tou_rate',
    solar_friendly: false,
    battery_optimized: true,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak', hours_description: 'Weekdays 2–7 PM (Jun–Aug only)', summer_rate_per_kwh: 0.24, winter_rate_per_kwh: 0.11, applies_weekends: false, applies_holidays: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'All other hours, all seasons', summer_rate_per_kwh: 0.10, winter_rate_per_kwh: 0.11, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.duke-energy.com/home/products/time-of-use',
    solar_pro_note: 'Indiana eliminated retail NEM in 2022 (HB 1278) — Duke Indiana exports now credit at avoided-cost (~4¢/kWh). Battery storage is essential for Indiana solar installs. Battery charges midday from solar (off-peak) and discharges 2–7 PM summer at 24¢/kWh on TOU plan. Payback without battery is dramatically longer under avoided-cost NEM.',
    last_verified: '2025-05',
  },

  // ── Hawaiian Electric (HECO) ──────────────────────────────────────────────────
  {
    plan_id: 'hawaiian_electric_tou',
    plan_name: 'Time-of-Use Rate / Smart Rate (Hawaiian Electric)',
    plan_description: 'Hawaiian Electric (HECO, MECO, HELCO) residential TOU. On-peak: 5–10 PM daily. Hawaii has the highest residential rates in the US (~$0.38–0.50/kWh). Exports credited at Customer Grid-Supply rate or self-supply allowed. Battery critical for avoiding on-peak grid draw.',
    utility_ids: ['hawaiian_electric'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: true,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak', hours_description: 'Daily 5–10 PM', summer_rate_per_kwh: 0.48, winter_rate_per_kwh: 0.44, applies_weekends: true, applies_holidays: true },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'All other hours (10 PM–5 PM)', summer_rate_per_kwh: 0.32, winter_rate_per_kwh: 0.30, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.hawaiianelectric.com/products-and-services/customer-renewable-programs',
    solar_pro_note: 'Hawaii has the highest electricity rates in the US (38–50¢/kWh). Under Customer Grid-Supply, HECO pays ~10¢/kWh for exports — well below retail. Self-Supply option (no exports, full self-consumption) often provides better ROI. Battery storage is financially critical in Hawaii — solar + battery is essentially the only configuration that makes sense under current HECO tariffs. Every kWh self-consumed saves 38–50¢.',
    last_verified: '2025-05',
  },

  // ── Eversource (Connecticut) ──────────────────────────────────────────────────
  {
    plan_id: 'eversource_ct_tou',
    plan_name: 'Time-of-Use Rate (Eversource CT / UI)',
    plan_description: 'Eversource Connecticut and UI (United Illuminating) residential TOU. On-peak: 8 AM–8 PM weekdays. Off-peak all other hours. CT has strong net metering at retail rate. ConnectedSolutions battery DR program pays up to $275/kW-year.',
    utility_ids: ['eversource_ct', 'eversource_cl_ct', 'bozrah_lp_ct', 'south_norwalk_electric_works_ct'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: true,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak', hours_description: 'Weekdays 8 AM–8 PM', summer_rate_per_kwh: 0.30, winter_rate_per_kwh: 0.24, applies_weekends: false, applies_holidays: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'Weekends and 8 PM–8 AM', summer_rate_per_kwh: 0.12, winter_rate_per_kwh: 0.10, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.eversource.com/content/ct-c/residential/my-account/billing-payments/about-your-bill/rate-plans/residential-time-of-use',
    solar_pro_note: 'Connecticut is a premier solar + storage market. Eversource CT TOU paired with ConnectedSolutions battery program ($275/kW-yr) provides excellent ROI. Solar on TOU maximizes self-consumption during 30¢/kWh on-peak hours. Full retail NEM at 30¢ for exports. CT also has RSIP solar rebate. Stack: TOU + ConnectedSolutions + RSIP + 30% ITC = among best economics on East Coast.',
    last_verified: '2025-05',
  },

  // ── PECO Energy (Pennsylvania) ────────────────────────────────────────────────
  {
    plan_id: 'peco_pa_tou',
    plan_name: 'Time-of-Use Pricing (PECO)',
    plan_description: 'PECO (Philadelphia area) and FirstEnergy PA utilities (Met-Ed, Penelec, Penn Lines) offer optional TOU rates. On-peak: 2–8 PM weekdays June–Sept. PA has full retail net metering. PECO territory covers Philadelphia, its suburbs, and most of southeast PA.',
    utility_ids: ['peco_pa', 'met_ed_pa', 'penelec_pa', 'penn_lines_pa', 'ugi_utilities_pa'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: true,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak', hours_description: 'Weekdays 2–8 PM (Jun–Sep)', summer_rate_per_kwh: 0.22, winter_rate_per_kwh: 0.14, applies_weekends: false, applies_holidays: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'All other hours and seasons', summer_rate_per_kwh: 0.11, winter_rate_per_kwh: 0.14, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.peco.com/MyAccount/MyBillUsage/Pages/TimeofUse.aspx',
    solar_pro_note: 'Pennsylvania mandates full retail net metering for systems ≤ 50 kW residential. PECO and FirstEnergy PA offer solid TOU plans where solar production overlaps the 2–8 PM on-peak window. PA SREC market was sunset but Act 40 (2023) created new alternative energy programs. Battery storage adds value for on-peak arbitrage. Pennsylvania is a strong, stable solar market.',
    last_verified: '2025-05',
  },

  // ── CMP / Versant (Maine) ─────────────────────────────────────────────────────
  {
    plan_id: 'cmp_me_tou',
    plan_name: 'Time-of-Use Rate (CMP / Versant Maine)',
    plan_description: 'Central Maine Power (CMP) and Versant Power residential TOU. On-peak: 9 AM–9 PM weekdays. Maine has strong solar economics with retail-rate net metering. Maine also has community solar programs through Competitive Electricity Providers.',
    utility_ids: ['cmp_me', 'van_buren_light_power_district_me'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: false,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak', hours_description: 'Weekdays 9 AM–9 PM', summer_rate_per_kwh: 0.20, winter_rate_per_kwh: 0.22, applies_weekends: false, applies_holidays: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'Weekends and 9 PM–9 AM', summer_rate_per_kwh: 0.11, winter_rate_per_kwh: 0.12, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.cmpco.com/account/billing-rates',
    solar_pro_note: 'Maine offers full retail NEM through annual net metering. CMP territory has good solar exposure despite northern latitude. Maine Solar Incentive Program provides additional rebates. Battery storage beneficial but not required for positive ROI. CMP TOU aligns well with solar production during 9 AM–5 PM midday off-peak — good self-consumption value.',
    last_verified: '2025-05',
  },

  // ── Eversource (Massachusetts) ────────────────────────────────────────────────
  {
    plan_id: 'eversource_ma_tou',
    plan_name: 'Time-of-Use / Real-Time Pricing (Eversource MA)',
    plan_description: 'Eversource Massachusetts residential TOU. On-peak: 9 AM–9 PM weekdays. Massachusetts SMART program pays per-kWh production for 10 years. ConnectedSolutions battery DR pays up to $275/kW-yr. National Grid MA has similar structure.',
    utility_ids: ['eversource_ma', 'national_grid_ma', 'natgrid_ma', 'cape_light_compact_ma', 'concord_municipal_light_plant_ma', 'belmont_municipal_light_ma', 'braintree_electric_light_ma', 'danvers_electric_ma'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: true,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak', hours_description: 'Weekdays 9 AM–9 PM', summer_rate_per_kwh: 0.32, winter_rate_per_kwh: 0.28, applies_weekends: false, applies_holidays: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'Weekends and 9 PM–9 AM', summer_rate_per_kwh: 0.14, winter_rate_per_kwh: 0.13, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.eversource.com/content/ma-c/residential/my-account/billing-payments/about-your-bill/rate-plans',
    solar_pro_note: 'Massachusetts is one of the best solar + storage markets in the US. Stack: Eversource TOU (32¢ on-peak) + SMART program (~10¢/kWh production payments for 10 years) + ConnectedSolutions battery DR ($275/kW-yr) + 30% federal ITC + MA state tax credit (15%, up to $1,000). Combined, payback can be under 6 years. Always include SMART and ConnectedSolutions in MA proposals.',
    last_verified: '2025-05',
  },

  // ── NV Energy (Nevada) ────────────────────────────────────────────────────────
  {
    plan_id: 'nv_energy_tou',
    plan_name: 'Time-of-Use Rate (NV Energy)',
    plan_description: 'NV Energy (Nevada Power / Sierra Pacific) residential TOU. On-peak: 3–8 PM daily May–Oct. Nevada has net metering at near-retail rate (NEM 2.0 for most customers). Battery storage captures midday solar surplus for 3–8 PM discharge.',
    utility_ids: ['nv_energy', 'ely_lp_nv', 'lincoln_county_power_district_nv', 'mt_wheeler_power_nv', 'overton_power_district_nv'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: true,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak', hours_description: 'Daily 3–8 PM (May–Oct)', summer_rate_per_kwh: 0.25, winter_rate_per_kwh: 0.12, applies_weekends: true, applies_holidays: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'All other hours and Nov–Apr', summer_rate_per_kwh: 0.11, winter_rate_per_kwh: 0.12, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.nvenergy.com/account-services/billing-options/time-of-use',
    solar_pro_note: 'Nevada has excellent solar resource (best in continental US) and NV Energy TOU aligns well with battery dispatch. On-peak window (3–8 PM) starts just as solar production declines — battery charged from midday solar discharges during on-peak at 25¢/kWh. NV Energy NEM 2.0 provides near-retail export credits. Nevada also has sales tax exemption on solar equipment. Strong market.',
    last_verified: '2025-05',
  },

  // ── Idaho Power ────────────────────────────────────────────────────────────────
  {
    plan_id: 'idaho_power_tou',
    plan_name: 'Time-of-Use Rate (Idaho Power)',
    plan_description: 'Idaho Power residential TOU. On-peak: 3–9 PM weekdays June–Sept. Idaho Power rates are among the lowest in the US (~10–13¢/kWh average). Idaho Power offers full retail net metering under IPUC rules. Clean Energy Discount available for solar customers.',
    utility_ids: ['idaho_power', 'idaho_county_lp_id', 'clearwater_power_id'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: false,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak', hours_description: 'Weekdays 3–9 PM (Jun–Sep)', summer_rate_per_kwh: 0.16, winter_rate_per_kwh: 0.09, applies_weekends: false, applies_holidays: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'All other hours', summer_rate_per_kwh: 0.09, winter_rate_per_kwh: 0.09, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.idahopower.com/energy-environment/energy-efficiency/home-products-programs/time-of-use/',
    solar_pro_note: 'Idaho Power has the lowest rates in the Pacific Northwest (~9–10¢ off-peak). Full retail NEM makes Idaho a good solar market despite low rates. TOU on-peak spread (16¢ vs 9¢ = 78% premium) is good for battery arbitrage. Idaho Power Clean Energy Discount provides modest bill credit for solar. Good market for solar-only proposals; battery adds value but ROI is longer than higher-rate states.',
    last_verified: '2025-05',
  },

  // ── DTE Energy (Michigan) ─────────────────────────────────────────────────────
  {
    plan_id: 'dte_mi_tou',
    plan_name: 'Time-of-Use Rate (DTE Energy Michigan)',
    plan_description: 'DTE Energy Michigan residential TOU. On-peak: 11 AM–7 PM weekdays June–Sept; 11 AM–7 PM Oct–May. Michigan has full retail net metering. DTE EV-TOU and EV Demand Rate also available for battery + EV customers.',
    utility_ids: ['dte_mi', 'great_lakes_energy_mi', 'holland_bpw_mi', 'lansing_board_of_wl_mi', 'traverse_city_lp_mi'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: true,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak', hours_description: 'Weekdays 11 AM–7 PM year-round', summer_rate_per_kwh: 0.20, winter_rate_per_kwh: 0.18, applies_weekends: false, applies_holidays: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'Weekends and 7 PM–11 AM', summer_rate_per_kwh: 0.09, winter_rate_per_kwh: 0.09, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.dteenergy.com/us/en/residential/billing-and-payments/rate-plans/time-of-use.html',
    solar_pro_note: 'DTE Michigan TOU on-peak (11 AM–7 PM) aligns perfectly with solar production hours — highest solar output occurs during peak period. Self-consumption value is maximized. Full retail NEM means exports during on-peak earn 20¢/kWh. DTE also offers connected battery programs for load management. Michigan is a solid solar market with retail NEM protection.',
    last_verified: '2025-05',
  },

  // ── Consumers Energy (Michigan) ───────────────────────────────────────────────
  {
    plan_id: 'consumers_mi_tou',
    plan_name: 'Time-of-Use Rate (Consumers Energy Michigan)',
    plan_description: 'Consumers Energy Michigan residential TOU. On-peak: 9 AM–10 PM weekdays (summer), 7 AM–11 PM weekdays (winter). Michigan full retail NEM. Consumers Energy Shift & Save program with demand response options.',
    utility_ids: ['consumers_mi'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: true,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak', hours_description: 'Weekdays 9 AM–10 PM (Jun–Sep), 7 AM–11 PM (Oct–May)', summer_rate_per_kwh: 0.16, winter_rate_per_kwh: 0.18, applies_weekends: false, applies_holidays: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'Weekends and all overnight hours', summer_rate_per_kwh: 0.08, winter_rate_per_kwh: 0.08, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.consumersenergy.com/residential/rates-and-programs/electric-rate-options/time-of-use',
    solar_pro_note: 'Consumers Energy MI has the widest TOU window in Michigan (9 AM–10 PM) which strongly overlaps solar production. Self-consumption value is high. Battery adds evening coverage after solar drops. Michigan solar market is solid with retail NEM. Consumers Energy also has a Shift & Save demand response program for battery owners.',
    last_verified: '2025-05',
  },

  // ── Minnesota Power / Otter Tail (Minnesota) ──────────────────────────────────
  {
    plan_id: 'mn_power_tou',
    plan_name: 'Time-of-Use Rate (Minnesota Power / Otter Tail)',
    plan_description: 'Minnesota Power and Otter Tail Power residential TOU. On-peak: 9 AM–9 PM weekdays. Minnesota has strong solar NEM policy (up to 120% annual netting). Xcel Energy MN also has Solar*Rewards program for production incentives.',
    utility_ids: ['minnesota_power_mn', 'otter_tail_power_mn', 'great_plains_energy_mn', 'east_central_energy_mn', 'connexus_energy_mn', 'dakota_electric_association_mn'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: false,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak', hours_description: 'Weekdays 9 AM–9 PM', summer_rate_per_kwh: 0.17, winter_rate_per_kwh: 0.16, applies_weekends: false, applies_holidays: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'Weekends and 9 PM–9 AM', summer_rate_per_kwh: 0.08, winter_rate_per_kwh: 0.08, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.mnpower.com/CustomerService/RatesSolarEnergy',
    solar_pro_note: 'Minnesota has one of the nation\'s best NEM policies — up to 120% of annual consumption can be netted at retail rate, with any surplus rolled over or credited. Xcel Energy MN Solar*Rewards pays additional production incentive. Minnesota cold climate means lower annual production but strong retail rates make the economics work. Battery storage adds value for TOU arbitrage but ROI is positive without it in most cases.',
    last_verified: '2025-05',
  },

  // ── Delmarva Power (Delaware) ─────────────────────────────────────────────────
  {
    plan_id: 'delmarva_de_tou',
    plan_name: 'Time-of-Use Rate (Delmarva Power / PEPCO Holdings)',
    plan_description: 'Delmarva Power (Delaware/Maryland Eastern Shore) residential TOU. On-peak: 2–7 PM weekdays June–Sept. Delaware and Maryland have strong NEM policies. PEPCO Holdings territory including Delmarva.',
    utility_ids: ['delmarva_de', 'city_of_dover_electric_de', 'lewes_bpw_de', 'milford_electric_de', 'newark_electric_de', 'seaford_electric_de'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: true,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak', hours_description: 'Weekdays 2–7 PM (Jun–Sep)', summer_rate_per_kwh: 0.21, winter_rate_per_kwh: 0.13, applies_weekends: false, applies_holidays: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'All other hours', summer_rate_per_kwh: 0.10, winter_rate_per_kwh: 0.13, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.delmarva.com/my-account/billing-and-payments/rate-options',
    solar_pro_note: 'Delaware has full retail NEM and favorable solar policy. Delmarva Power TOU on-peak (2–7 PM summer) aligns well with late-afternoon solar and battery dispatch. Delaware solar market benefits from: retail NEM, modest state solar incentive, and strong federal ITC. Battery adds value for peak coverage. Good straightforward market.',
    last_verified: '2025-05',
  },

  // ── Atlantic City Electric / JCP&L (New Jersey) ───────────────────────────────
  {
    plan_id: 'ace_nj_tou',
    plan_name: 'Time-of-Use Rate (Atlantic City Electric / JCP&L / Rockland)',
    plan_description: 'Atlantic City Electric, JCP&L (FirstEnergy NJ), and Rockland Electric residential TOU. On-peak: 2–7 PM weekdays June–Sept. NJ TREC and SuSI solar incentives available. Full retail NEM.',
    utility_ids: ['atlantic_city_nj', 'south_jersey_industries_nj', 'orange_rockland_utilities_nj', 'rockland_electric_nj'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: true,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak', hours_description: 'Weekdays 2–7 PM (Jun–Sep)', summer_rate_per_kwh: 0.22, winter_rate_per_kwh: 0.14, applies_weekends: false, applies_holidays: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'All other hours', summer_rate_per_kwh: 0.10, winter_rate_per_kwh: 0.14, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.atlanticcityelectric.com/my-account/billing-and-payments/rate-options',
    solar_pro_note: 'New Jersey is an excellent solar market for non-PSEG utilities as well. Atlantic City Electric and JCP&L territory qualifies for NJ SuSI (Successor Solar Incentive), TREC payments (~$90-152/MWh), full retail NEM, and 30% federal ITC. Battery pairs with PSEG ConnectedSolutions-equivalent programs. Total incentive stack makes NJ one of the best East Coast solar markets.',
    last_verified: '2025-05',
  },

  // ── Georgia Power EMC Cooperatives ────────────────────────────────────────────
  {
    plan_id: 'georgia_emc_tou',
    plan_name: 'Time-of-Use Rate (Georgia EMC Cooperatives)',
    plan_description: 'Georgia electric cooperatives (Cobb EMC, Carroll EMC, Greystone Power, Coweta-Fayette EMC, Flint Energies, Satilla REMC, Diverse Power) offer TOU rates. On-peak: weekdays 2–7 PM June–Sept. Georgia NEM capped — confirm interconnection availability. Battery recommended.',
    utility_ids: ['cobb_emc_ga', 'carroll_emc_ga', 'greystone_power_ga', 'coweta_fayette_emc_ga', 'flint_energies_ga', 'satilla_remc_ga', 'diverse_power_ga', 'georgia_power'],
    type: 'tou_rate',
    solar_friendly: false,
    battery_optimized: true,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak', hours_description: 'Weekdays 2–7 PM (Jun–Sep)', summer_rate_per_kwh: 0.19, winter_rate_per_kwh: 0.13, applies_weekends: false, applies_holidays: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'All other hours', summer_rate_per_kwh: 0.09, winter_rate_per_kwh: 0.13, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.cobbemc.com/residential/rates-programs/solar-energy',
    solar_pro_note: 'Georgia cooperative territory NEM is capped — confirm interconnection capacity before quoting. Battery storage is valuable here: 2–7 PM on-peak dispatch at 19¢/kWh avoids peak charges. Georgia Power also has Advanced Solar Initiative (ASI) for systems over 10 kW. Flint Energies and Diverse Power have unique solar programs — verify individually. Georgia has good solar resource and moderate rates.',
    last_verified: '2025-05',
  },

  // ── Rocky Mountain Power / PacifiCorp (Utah / Wyoming) ────────────────────────
  {
    plan_id: 'rocky_mountain_power_tou',
    plan_name: 'Time-of-Use Rate (Rocky Mountain Power / PacifiCorp)',
    plan_description: 'Rocky Mountain Power (Utah, Wyoming, Idaho portions) residential TOU. On-peak: 3–7 PM weekdays June–Sept. Utah and Wyoming net metering at retail rate. RMP Wattsmart Battery incentive available in Utah.',
    utility_ids: ['pacificorp_wy', 'carbon_power_light_ut', 'dixie_power_ut', 'flowell_electric_association_ut', 'moon_lake_electric_association_ut', 'bridgerland_electric_ut'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: true,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak', hours_description: 'Weekdays 3–7 PM (Jun–Sep)', summer_rate_per_kwh: 0.20, winter_rate_per_kwh: 0.11, applies_weekends: false, applies_holidays: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'All other hours', summer_rate_per_kwh: 0.09, winter_rate_per_kwh: 0.11, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.rockymountainpower.net/content/dam/pcorp/documents/en/rockymountainpower/rates-regulation/utah/tariffs/Residential_Time_of_Use.pdf',
    solar_pro_note: 'Rocky Mountain Power Wattsmart Battery program (up to $1,500 incentive for qualifying battery installs) makes Utah a strong battery market. TOU 3–7 PM on-peak aligns with battery discharge opportunity. Utah has retail NEM under Utah PSC rules. Solar resource in southern Utah/St. George area is among the best in the US. Combine with Wattsmart for strong proposals.',
    last_verified: '2025-05',
  },

  // ── Empire District Electric / Evergy (Missouri / Kansas) ─────────────────────
  {
    plan_id: 'empire_district_tou',
    plan_name: 'Time-of-Use Rate (Empire District / Evergy MO-KS)',
    plan_description: 'Empire District Electric and Evergy (Missouri and Kansas) residential TOU. On-peak: 2–7 PM weekdays June–Sept. Missouri and Kansas net metering at retail rate for systems ≤ 100 kW residential.',
    utility_ids: ['empire_district_electric_mo', 'sunflower_electric_power_corp_ks', 'midwest_energy_ks', 'cherryvale_utilities_ks'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: true,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak', hours_description: 'Weekdays 2–7 PM (Jun–Sep)', summer_rate_per_kwh: 0.18, winter_rate_per_kwh: 0.12, applies_weekends: false, applies_holidays: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'All other hours', summer_rate_per_kwh: 0.09, winter_rate_per_kwh: 0.12, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.empiredistrict.com/residential/rates',
    solar_pro_note: 'Missouri and Kansas are good solar markets with retail NEM. Empire District Electric and Evergy TOU plans allow battery arbitrage during 2–7 PM on-peak window. Xcel Energy Colorado (which has MO/KS presence) Solar*Rewards program may also be applicable in border areas. Straightforward solar market — no major policy risks.',
    last_verified: '2025-05',
  },

  // ── Duke Energy North Carolina ────────────────────────────────────────────────
  {
    plan_id: 'duke_nc_tou_full',
    plan_name: 'Time-of-Use (TOU-H) Rate — Duke NC / Progress Energy Carolinas',
    plan_description: 'Duke Energy Carolinas and Progress Energy Carolinas (NC/SC) residential TOU-H rate. On-peak: 1–9 PM weekdays June–Sept; 6–9 AM and 5–9 PM Oct–May. Duke NC has retail NEM for systems ≤ 1 MW. PowerPair battery program available.',
    utility_ids: ['duke_nc', 'yadkin_valley_telephone_membership_corp_nc'],
    type: 'tou_rate',
    solar_friendly: false,
    battery_optimized: true,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak', hours_description: 'Weekdays 1–9 PM (Jun–Sep); AM/PM peaks other months', summer_rate_per_kwh: 0.24, winter_rate_per_kwh: 0.19, applies_weekends: false, applies_holidays: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'All other hours and weekends', summer_rate_per_kwh: 0.09, winter_rate_per_kwh: 0.10, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.duke-energy.com/home/products/time-of-use',
    solar_pro_note: 'Duke NC TOU-H has wide summer on-peak window (1–9 PM). Solar production peaks before 1 PM on-peak window — battery storage is critical to capture excess midday solar and discharge during 1–9 PM at 24¢/kWh. Duke PowerPair battery incentive (up to $9,000) is one of the best battery rebates in the Southeast. Always pair battery with solar in Duke NC territory for maximum ROI.',
    last_verified: '2025-05',
  },

  // ── Salem Electric / Columbia River PUD (Oregon) ──────────────────────────────
  {
    plan_id: 'oregon_pud_tou',
    plan_name: 'Time-of-Use Rate (Oregon PUDs / Salem Electric / Columbia River)',
    plan_description: 'Oregon public utility districts and cooperatives (Salem Electric, Consumers Power OR, Clatskanie PUD, Clearwater Power OR) offer TOU rates. On-peak: 6–10 AM and 5–9 PM weekdays. Oregon has excellent solar NEM policy and Energy Trust solar rebates.',
    utility_ids: ['salem_electric_or', 'consumers_power_or', 'clearwater_power_or', 'clatskanie_pud_or'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: false,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak', hours_description: 'Weekdays 6–10 AM and 5–9 PM', summer_rate_per_kwh: 0.16, winter_rate_per_kwh: 0.18, applies_weekends: false, applies_holidays: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'All other hours and weekends', summer_rate_per_kwh: 0.08, winter_rate_per_kwh: 0.08, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.salemoregonelectric.com/rates',
    solar_pro_note: 'Oregon has strong solar policy including full retail NEM and Energy Trust of Oregon solar rebates (~$0.20–0.35/W). Oregon PUD TOU morning/evening peaks (not midday) mean solar + battery is ideal — battery charges from midday solar, covers evening 5–9 PM on-peak at 16¢/kWh. Oregon Energy Trust incentives significantly improve payback — always include in Oregon proposals.',
    last_verified: '2025-05',
  },

  // ── Inland Power & Light / Peninsula Light (Washington) ───────────────────────
  {
    plan_id: 'wa_small_iou_tou',
    plan_name: 'Time-of-Use Rate (WA Small IOUs / Co-ops)',
    plan_description: 'Washington state small IOUs and co-ops (Inland Power & Light, Peninsula Light, Benton PUD, Chelan PUD, Clallam PUD, Columbia REA) offer TOU rates. On-peak: 6 AM–10 PM weekdays. Washington net metering at retail rate. PSE FlexPower also available.',
    utility_ids: ['inland_power_light_wa', 'peninsula_light_company_wa', 'benton_pud_wa', 'chelan_county_pud_wa', 'clallam_county_pud_wa', 'columbia_rea_wa'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: false,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak', hours_description: 'Weekdays 6 AM–10 PM', summer_rate_per_kwh: 0.13, winter_rate_per_kwh: 0.15, applies_weekends: false, applies_holidays: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'Weekends and 10 PM–6 AM', summer_rate_per_kwh: 0.06, winter_rate_per_kwh: 0.06, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.inlandpowerlight.com/rates',
    solar_pro_note: 'Washington state has the lowest residential electricity rates in the continental US (~7–10¢/kWh average) due to abundant hydropower. Solar ROI is longer than high-rate states but retail NEM (Washington has strong NEM law), WA sales tax exemption on solar equipment, and federal ITC make it viable. Battery adds limited arbitrage value at these low rates — lead with solar-only proposals and offer battery as upgrade.',
    last_verified: '2025-05',
  },

  // ── Vermont Green Mountain Power / Burlington Electric ────────────────────────
  {
    plan_id: 'vermont_tou',
    plan_name: 'Time-of-Use Rate (Vermont GMP / Burlington Electric)',
    plan_description: 'Vermont Green Mountain Power (GMP) and Burlington Electric Department TOU. On-peak: 4–9 PM weekdays. Vermont has strong NEM policy (net metering at retail rate). GMP BYOD battery program pays $10.44/month for battery dispatch participation.',
    utility_ids: ['green_mountain_vt', 'burlington_electric_vt', 'village_of_hyde_park_electric_vt', 'village_of_johnson_electric_vt', 'village_of_ludlow_electric_vt', 'village_of_morrisville_wl_vt'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: true,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak', hours_description: 'Weekdays 4–9 PM', summer_rate_per_kwh: 0.24, winter_rate_per_kwh: 0.22, applies_weekends: false, applies_holidays: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'Weekends and 9 PM–4 PM', summer_rate_per_kwh: 0.12, winter_rate_per_kwh: 0.12, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://greenmountainpower.com/rates/',
    solar_pro_note: 'Vermont GMP BYOD (Bring Your Own Device) battery program pays $10.44/month ($125/year) for allowing utility dispatch of home battery. Combined with TOU on-peak arbitrage (24¢/kWh) and Vermont retail NEM, battery ROI is strong in Vermont. Vermont also has REF (Renewable Energy Fund) small grants for solar. Cold climate but excellent solar + battery economics. GMP is a progressive utility — strong customer service for solar installs.',
    last_verified: '2025-05',
  },

  // ── Mon Power / Appalachian Power (West Virginia) ─────────────────────────────
  {
    plan_id: 'wv_iou_tou',
    plan_name: 'Time-of-Use Rate (Mon Power / Appalachian Power WV)',
    plan_description: 'Mon Power (FirstEnergy WV) and Appalachian Power (AEP WV) residential TOU. On-peak: 10 AM–9 PM weekdays June–Sept. West Virginia has limited solar policy — net metering at retail rate for systems ≤ 25 kW. Battery recommended to maximize self-consumption.',
    utility_ids: ['mon_power_wv', 'monongalia_power_wv'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: true,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak', hours_description: 'Weekdays 10 AM–9 PM (Jun–Sep)', summer_rate_per_kwh: 0.17, winter_rate_per_kwh: 0.13, applies_weekends: false, applies_holidays: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'All other hours', summer_rate_per_kwh: 0.09, winter_rate_per_kwh: 0.13, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.monpower.com/residential/account/billing-payment/rates',
    solar_pro_note: 'West Virginia is an emerging solar market. Mon Power and Appalachian Power TOU plans allow daytime solar self-consumption during 17¢/kWh on-peak hours. West Virginia retail NEM (≤ 25 kW) provides fair export value. Limited state incentives beyond federal ITC. Straightforward sales pitch — focus on utility bill reduction and federal ITC.',
    last_verified: '2025-05',
  },

  // ── Kentucky Utilities / LG&E (Kentucky) ──────────────────────────────────────
  {
    plan_id: 'kentucky_iou_tou',
    plan_name: 'Time-of-Use Rate (Kentucky Utilities / LG&E / Duke KY)',
    plan_description: 'Kentucky Utilities (KU), Louisville Gas & Electric (LGE), and Duke Energy Kentucky residential TOU. On-peak: 1–7 PM weekdays June–Sept. Kentucky net metering at avoided-cost rate (~2–4¢/kWh) — battery critical for Kentucky solar proposals.',
    utility_ids: ['duke_energy_kentucky_ky', 'blue_grass_energy_ky', 'clark_energy_ky', 'cumberland_valley_electric_ky', 'farmers_recc_ky'],
    type: 'tou_rate',
    solar_friendly: false,
    battery_optimized: true,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak', hours_description: 'Weekdays 1–7 PM (Jun–Sep)', summer_rate_per_kwh: 0.17, winter_rate_per_kwh: 0.11, applies_weekends: false, applies_holidays: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'All other hours', summer_rate_per_kwh: 0.09, winter_rate_per_kwh: 0.11, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://lge-ku.com/rates-environment/rates/residential',
    solar_pro_note: 'Kentucky NEM (avoided-cost) pays only ~2–4¢/kWh for exports — among the least favorable in the US. Battery storage is REQUIRED for a competitive Kentucky solar proposal. Battery charges from solar (self-consumption) and discharges during 1–7 PM at 17¢/kWh, replacing grid purchase. Without battery, Kentucky solar ROI is very long. Duke Kentucky PowerPair equivalent programs — check for any current battery incentives.',
    last_verified: '2025-05',
  },

  // ── NPPD / LES / OPPD (Nebraska) ──────────────────────────────────────────────
  {
    plan_id: 'nebraska_iou_tou',
    plan_name: 'Time-of-Use Rate (NPPD / LES / OPPD Nebraska)',
    plan_description: 'Nebraska Public Power District (NPPD), Lincoln Electric System (LES), and Omaha Public Power District (OPPD) offer TOU rates. On-peak: 2–8 PM weekdays June–Aug. Nebraska net metering at retail rate for systems ≤ 25 kW.',
    utility_ids: ['les_ne', 'nppd_ne', 'oppd_ne', 'panhandle_rural_electric_membership_association_ne'],
    type: 'tou_rate',
    solar_friendly: true,
    battery_optimized: true,
    nem_compatible: true,
    requires_drop_nem: false,
    periods: [
      { period: 'on_peak', label: 'On-Peak', hours_description: 'Weekdays 2–8 PM (Jun–Aug)', summer_rate_per_kwh: 0.16, winter_rate_per_kwh: 0.09, applies_weekends: false, applies_holidays: false },
      { period: 'off_peak', label: 'Off-Peak', hours_description: 'All other hours', summer_rate_per_kwh: 0.08, winter_rate_per_kwh: 0.09, applies_weekends: true, applies_holidays: true },
    ],
    enrollment_url: 'https://www.les.com/rates-programs/rates',
    solar_pro_note: 'Nebraska is an underserved solar market with decent economics. NPPD, LES, and OPPD all offer retail NEM (≤ 25 kW) at competitive rates. LES Lincoln has a solar loan program. Battery adds value for summer TOU arbitrage (16¢ on-peak vs 8¢ off-peak = 100% spread). Nebraska wind is better than solar but strong solar resource in panhandle area.',
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


  // ═══════════════════════════════════════════════════════════════════════
  // v48.28 EXPANSION — Battery Incentive Programs
  // ═══════════════════════════════════════════════════════════════════════

  // ── Duke Energy PowerPair (NC/SC/FL/IN/OH) ───────────────────────────────
  {
    program_id: 'duke_powerpair_all',
    program_name: 'Duke Energy PowerPair Solar+Battery Rebate',
    utility_ids: ['duke_nc', 'duke_sc', 'duke_indiana', 'duke_energy_ohio_oh', 'duke_fl', 'duke_energy_kentucky_ky'],
    type: 'battery_incentive',
    status: 'active',
    value_description: '$6,000–$9,000 rebate for qualifying solar+battery systems (pilot enrollment)',
    value_flat: 9000,
    max_value: 9000,
    min_battery_kwh: 10,
    utility_dispatch: true,
    max_dispatch_events_per_year: 60,
    max_dispatch_hours_per_event: 4,
    enrollment_url: 'https://www.duke-energy.com/home/products/powerpair',
    program_description: 'Duke Energy PowerPair rebates customers who pair a new solar system with battery storage. Utility retains rights to dispatch battery during grid stress events (up to 60 per year, 4 hrs each). Rebate: $6,000 standard, up to $9,000 for income-qualified customers.',
    solar_pro_note: 'PowerPair is excellent deal — $6,000–$9,000 rebate effectively reduces battery cost dramatically. Dispatch events are rare and short. Recommend PowerPair enrollment for all Duke territory solar+battery installs.',
    last_verified: '2025-05',
  },

  // ── Georgia Power Advanced Solar Initiative / Battery DR ──────────────────
  {
    program_id: 'georgia_power_adr',
    program_name: 'Georgia Power Battery Demand Response',
    utility_ids: ['georgia_power', 'cobb_emc_ga', 'sawnee_emc_ga', 'jackson_emc_ga', 'walton_emc_ga', 'snapping_shoals_emc_ga', 'coweta_fayette_emc_ga', 'flint_energies_ga', 'greystone_power_ga', 'carroll_emc_ga'],
    type: 'demand_response',
    status: 'active',
    value_description: 'Battery demand-response bill credits; varies by program year',
    value_annual_per_kw: 150,
    utility_dispatch: true,
    max_dispatch_events_per_year: 40,
    max_dispatch_hours_per_event: 2,
    enrollment_url: 'https://www.georgiapower.com/residential/billing-and-rates/rate-options.html',
    program_description: 'Georgia Power and GA EMC demand response programs allow battery dispatch during peak demand events in exchange for annual bill credits. Georgia Power Advanced Solar Initiative (ASI) for larger commercial systems.',
    solar_pro_note: 'Georgia has mild NEM rules — battery demand-response programs are the primary battery incentive. Consider battery for Georgia Power customers who want to reduce demand charges and earn DR credits.',
    last_verified: '2025-05',
  },

  // ── Eversource ConnectedSolutions (CT/MA/NH) ─────────────────────────────
  {
    program_id: 'eversource_connected',
    program_name: 'ConnectedSolutions Battery Program',
    utility_ids: ['eversource_ct', 'eversource_cl_ct', 'eversource_ma', 'eversource_nh', 'ui_ct', 'natgrid_ma', 'national_grid_ri'],
    type: 'vpp',
    status: 'active',
    value_description: '$225–$275/kW per summer season for battery dispatch',
    value_annual_per_kw: 250,
    max_value: 4000,
    min_battery_kwh: 5,
    utility_dispatch: true,
    max_dispatch_events_per_year: 60,
    max_dispatch_hours_per_event: 3,
    enrollment_url: 'https://www.eversource.com/content/ct/residential/my-account/billing-payments/about-your-bill/managing-costs/connected-solutions',
    program_description: 'Eversource ConnectedSolutions pays ~$225–$275/kW summer season for enrolled batteries that discharge during grid peak events (typically hot summer afternoons). Average payment: $700–$1,200/season for typical residential battery. Available in CT, MA, NH.',
    solar_pro_note: 'ConnectedSolutions is one of the best battery incentive programs in the US. In NE territory: Eversource pays ~$250/kW for battery enrollment. 10 kWh battery earns ~$1,250/summer season on top of self-consumption savings. HIGHLY recommend enrolling all batteries in Eversource territory.',
    last_verified: '2025-05',
  },

  // ── Green Mountain Power BYOD (VT) ───────────────────────────────────────
  {
    program_id: 'gmp_byod_vt',
    program_name: 'GMP Bring Your Own Device (BYOD)',
    utility_ids: ['green_mountain_vt', 'burlington_electric_vt', 'vermont_ec_vt', 'washington_ec_vt'],
    type: 'vpp',
    status: 'active',
    value_description: '$850+/year for enrolled batteries (GMP dispatches during grid events)',
    value_annual_per_kw: 85,
    max_value: 2000,
    utility_dispatch: true,
    max_dispatch_events_per_year: 50,
    max_dispatch_hours_per_event: 2,
    enrollment_url: 'https://greenmountainpower.com/rebates-programs/energy-storage/bring-your-own-device/',
    program_description: 'GMP BYOD enrolls residential batteries in a virtual power plant. GMP dispatches during grid events; customers receive annual payments (~$850+ for typical 13.5 kWh Powerwall). GMP also leases Tesla Powerwalls to customers at $55/month.',
    solar_pro_note: 'Vermont has one of the best solar+storage ecosystems in the country. GMP BYOD + NEM full retail rate + net metering = compelling economics. Always recommend BYOD enrollment for GMP territory battery installs.',
    last_verified: '2025-05',
  },

  // ── National Grid / Unitil ConnectedSolutions (RI/MA) ────────────────────
  {
    program_id: 'natgrid_connected',
    program_name: 'National Grid ConnectedSolutions',
    utility_ids: ['natgrid_ma', 'unitil_ma', 'unitil_nh', 'cape_light_compact_ma'],
    type: 'vpp',
    status: 'active',
    value_description: '$225–$275/kW per summer season',
    value_annual_per_kw: 250,
    utility_dispatch: true,
    max_dispatch_events_per_year: 60,
    enrollment_url: 'https://www.nationalgridus.com/ma-home/clean-energy/energy-storage',
    program_description: 'National Grid ConnectedSolutions (MA) mirrors Eversource program — pays ~$250/kW summer season for battery dispatch participation.',
    solar_pro_note: 'MA ConnectedSolutions: ~$1,250/season for 10 kWh battery. Stacks with MA SMART solar incentive for solar+battery customers. One of the highest battery incentive rates in the US.',
    last_verified: '2025-05',
  },

  // ── PSEG Long Island Battery Storage Program ──────────────────────────────
  {
    program_id: 'pseg_li_battery',
    program_name: 'PSEG Long Island Bring Your Own Battery (BYOB)',
    utility_ids: ['lipa_ny', 'pseg_nj'],
    type: 'vpp',
    status: 'active',
    value_description: '$380/kW over 5 years for enrolled batteries',
    value_annual_per_kw: 76,
    utility_dispatch: true,
    max_dispatch_events_per_year: 40,
    enrollment_url: 'https://www.psegliny.com/aboutpseglongisland/ratesandtariffs/electricservicetariffs/energystoragetariff',
    program_description: 'PSEG Long Island BYOB program pays $380/kW over 5 years (~$76/kW/year) for battery enrollment in demand response. NY also has NYSERDA storage incentives available.',
    solar_pro_note: 'Long Island has very high electricity rates ($0.25–0.35/kWh). BYOB + full retail NEM makes solar+battery extremely compelling. NY-Sun incentives may also be available for the solar component.',
    last_verified: '2025-05',
  },

  // ── APS / SRP Arizona Battery Programs ───────────────────────────────────
  {
    program_id: 'aps_battery_az',
    program_name: 'APS Battery Reward / Storage Rewards Program',
    utility_ids: ['aps_az', 'srp_az', 'tep_az'],
    type: 'battery_incentive',
    status: 'active',
    value_description: '$200–$300/kWh battery rebate (one-time)',
    value_per_kwh_capacity: 250,
    max_value: 3000,
    min_battery_kwh: 8,
    utility_dispatch: false,
    enrollment_url: 'https://www.aps.com/en/residential/rates-and-programs/solar-and-battery-storage/battery-storage',
    program_description: 'APS offers battery storage rebates for residential customers. SRP and TEP have similar programs. Arizona has strong financial incentives for solar+battery given reduced export credit rates.',
    solar_pro_note: 'Arizona export credits are below retail — battery is the primary value driver for new solar installs. APS/SRP battery rebates offset part of battery cost. Combined with high solar production (>6 peak sun hrs), ROI is still excellent.',
    last_verified: '2025-05',
  },

  // ── Xcel Energy Battery Connect (CO/MN) ──────────────────────────────────
  {
    program_id: 'xcel_battery_connect',
    program_name: 'Xcel Energy Battery Connect / OptimizEV',
    utility_ids: ['xcel_co', 'psco_co', 'xcel_mn'],
    type: 'vpp',
    status: 'active',
    value_description: '$200/kW annual payment for battery enrollment',
    value_annual_per_kw: 200,
    utility_dispatch: true,
    max_dispatch_events_per_year: 30,
    max_dispatch_hours_per_event: 4,
    enrollment_url: 'https://www.xcelenergy.com/programs_and_rebates/residential_programs_and_rebates/battery_storage',
    program_description: 'Xcel Energy Battery Connect pays customers for battery dispatch during peak grid events. CO and MN programs. Also includes Solar*Rewards integration for solar+battery customers.',
    solar_pro_note: 'Xcel Battery Connect complements Solar*Rewards performance incentives — solar+battery customers can earn both production incentives (Solar*Rewards) and demand response payments (Battery Connect).',
    last_verified: '2025-05',
  },

  // ── OGE / PSO Oklahoma Battery Programs ───────────────────────────────────
  {
    program_id: 'oge_battery',
    program_name: 'OGE SmartHours Battery Integration',
    utility_ids: ['oge_ok', 'pso_ok'],
    type: 'demand_response',
    status: 'active',
    value_description: 'Bill credits for battery participation in SmartHours peak events',
    value_annual_per_kw: 100,
    utility_dispatch: false,
    enrollment_url: 'https://www.oge.com/wps/portal/oge/save-energy/home/smarthours',
    program_description: 'OGE SmartHours battery integration: customers can earn bill credits by dispatching battery storage during peak demand pricing events. Aligns well with solar self-consumption strategy.',
    solar_pro_note: 'OGE SmartHours TOU rate + battery creates compelling bill savings opportunity in OK. 2–7 PM summer peak is post-solar-peak — battery dispatches stored solar energy during highest-priced hours.',
    last_verified: '2025-05',
  },

  // ── TVA EnergyRight Battery Programs (TN) ────────────────────────────────
  {
    program_id: 'tva_battery',
    program_name: 'TVA Grid Relief Rider / Battery Program',
    utility_ids: ['tva_tn', 'tva_al', 'memphis_light_gas_water_tn', 'nashville_electric_service_tn', 'knoxville_utilities_board_tn'],
    type: 'demand_response',
    status: 'limited',
    value_description: 'Bill credits through local TVA distributor demand response programs; varies by LPC',
    value_annual_per_kw: 50,
    utility_dispatch: true,
    enrollment_url: 'https://energyright.com/for-homes/solar/',
    program_description: 'TVA distributes power to Local Power Companies (LPCs) in TN/AL/MS/KY/VA. TVA has limited NEM options (no statewide mandate) — solar typically credited at avoided-cost. Battery demand response programs available through some LPCs.',
    solar_pro_note: 'TVA territory has no statewide NEM mandate. LPCs have variable solar programs. Solar economics depend heavily on specific LPC policies — some offer retail NEM, others offer only avoided-cost (~3–5 cents/kWh). Battery maximizes self-consumption value. Research specific LPC program before sizing system.',
    last_verified: '2025-05',
  },

  // ── Portland General / PacifiCorp Oregon Battery ──────────────────────────
  {
    program_id: 'pge_or_battery',
    program_name: 'PGE Smart Battery Pilot / OR Storage Rebate',
    utility_ids: ['portland_general_or', 'pacificorp_or', 'eugene_water_electric_board_or'],
    type: 'battery_incentive',
    status: 'pilot',
    value_description: 'Up to $2,500 battery rebate through Oregon Energy Trust or utility pilot',
    value_flat: 2500,
    utility_dispatch: true,
    enrollment_url: 'https://www.energytrust.org/programs/storage/',
    program_description: 'Oregon Energy Trust (OET) offers storage incentives in PGE/PacifiCorp territory. PGE Smart Battery Pilot provides dispatch payments. OR mandates full retail NEM which makes solar fundamental economics strong.',
    solar_pro_note: 'Oregon full retail NEM makes solar compelling without battery. Battery becomes optional value-add — but OET rebates and pilot dispatch payments can improve overall project economics.',
    last_verified: '2025-05',
  },

  // ── NV Energy Battery Storage Rebate ─────────────────────────────────────
  {
    program_id: 'nv_energy_battery',
    program_name: 'NV Energy Battery Rebate Program',
    utility_ids: ['nv_energy'],
    type: 'battery_incentive',
    status: 'active',
    value_description: '$3,000 one-time battery rebate for residential storage systems',
    value_flat: 3000,
    min_battery_kwh: 10,
    utility_dispatch: false,
    enrollment_url: 'https://www.nvenergy.com/account-services/energy-solutions/renewable-energy/solar/battery-storage',
    program_description: 'NV Energy offers $3,000 one-time rebate for qualifying residential battery storage systems (minimum 10 kWh capacity). Nevada NEM is at 75% of retail rate — battery maximizes self-consumption and avoids exporting at reduced rate.',
    solar_pro_note: 'Nevada NEM pays ~75% of retail rate for exports. NV Energy $3,000 battery rebate + high self-consumption value makes battery the standard recommendation for NV solar installs. Nevada Class I NEM for ≤ 25 kW.',
    last_verified: '2025-05',
  },

  // ── Puget Sound Energy FlexPower (WA) ────────────────────────────────────
  {
    program_id: 'pse_flexpay',
    program_name: 'PSE FlexPower / Battery Storage Program',
    utility_ids: ['puget_sound_wa', 'snohomish_county_pud_wa', 'seattle_city_light_wa', 'clark_pud_wa'],
    type: 'demand_response',
    status: 'pilot',
    value_description: 'Annual dispatch payments ~$100–200/kW for enrolled WA batteries',
    value_annual_per_kw: 150,
    utility_dispatch: true,
    enrollment_url: 'https://www.pse.com/en/rates-and-services/electric-rates',
    program_description: 'Puget Sound Energy and WA PUD battery demand-response pilots. Washington mandates full retail NEM (1:1) — battery is supplementary value-add rather than essential economics fix.',
    solar_pro_note: 'WA retail NEM (1:1) means solar economics are strong without battery. PSE FlexPower dispatch payments make battery a bonus revenue stream. Recommend battery for customers wanting backup power + dispatch income.',
    last_verified: '2025-05',
  },

  // ── Dominion Virginia Battery Storage ────────────────────────────────────
  {
    program_id: 'dominion_va_battery',
    program_name: 'Dominion Energy Virginia Battery Storage Program',
    utility_ids: ['dominion_va', 'dominion_sc'],
    type: 'demand_response',
    status: 'active',
    value_description: 'Demand response credits for battery dispatch during peak events',
    value_annual_per_kw: 100,
    utility_dispatch: true,
    max_dispatch_events_per_year: 40,
    enrollment_url: 'https://www.dominionenergy.com/virginia/home/rates-programs/battery-storage',
    program_description: 'Dominion Energy VA battery demand response program. Customers receive annual bill credits for allowing utility to dispatch battery during peak grid events. Virginia mandates full retail NEM — battery adds incremental value on top of NEM.',
    solar_pro_note: 'Virginia full retail NEM makes solar fundamentally strong. Dominion battery DR program adds ~$100/kW/year incremental income. Recommend for customers wanting resilience + demand response income.',
    last_verified: '2025-05',
  },

  // ── Alabama Power / TVA Alabama Battery ──────────────────────────────────
  {
    program_id: 'alabama_power_battery',
    program_name: 'Alabama Power EnergySelect Battery Program',
    utility_ids: ['alabama_power', 'tva_al'],
    type: 'demand_response',
    status: 'limited',
    value_description: 'Limited residential battery DR; primarily commercial programs',
    value_annual_per_kw: 50,
    utility_dispatch: true,
    enrollment_url: 'https://www.alabamapower.com/residential/save-money-and-energy/renewable-energy/solar.html',
    program_description: 'Alabama Power and TVA Alabama have limited residential battery programs. AL does not have statewide NEM mandate — solar credited at avoided-cost (~3–5 cents/kWh). Battery is critical for economic viability.',
    solar_pro_note: 'Alabama has no statewide NEM — solar exports earn only ~3–5 cents/kWh avoided cost. Battery storage is ESSENTIAL for Alabama solar economics — maximize self-consumption at retail rates ($0.12–0.14/kWh).',
    last_verified: '2025-05',
  },

  // ── Mississippi / TVA Mississippi Battery ────────────────────────────────
  {
    program_id: 'ms_battery',
    program_name: 'Mississippi Power / Entergy MS Battery DR',
    utility_ids: ['entergy_ms', 'mississippi_power'],
    type: 'demand_response',
    status: 'limited',
    value_description: 'Limited residential battery programs; contact utility for current offerings',
    utility_dispatch: false,
    enrollment_url: 'https://www.mississippipower.com/residential/energy-savings/solar-energy',
    program_description: 'Mississippi has limited statewide NEM policy — some utilities offer voluntary programs. Solar economics in MS depend on self-consumption. Battery storage recommended.',
    solar_pro_note: 'Mississippi NEM is not mandated statewide. Entergy MS and Mississippi Power offer voluntary programs with below-retail export rates. Battery is recommended to maximize self-consumption value.',
    last_verified: '2025-05',
  },

  // ── FPL / Duke FL Battery Programs ───────────────────────────────────────
  {
    program_id: 'fpl_battery',
    program_name: 'FPL / Duke FL Battery Demand Response',
    utility_ids: ['fpl_fl', 'duke_fl', 'tampa_electric_fl', 'gulf_power_fl', 'jea_fl'],
    type: 'demand_response',
    status: 'active',
    value_description: 'Annual bill credits ~$100–200/kW for battery dispatch enrollment',
    value_annual_per_kw: 150,
    utility_dispatch: true,
    max_dispatch_events_per_year: 30,
    enrollment_url: 'https://www.fpl.com/rates/residential-time-of-use.html',
    program_description: 'Florida IOUs offer battery demand response programs with annual bill credits. Florida mandates full retail NEM — battery adds supplementary dispatch income and backup capability.',
    solar_pro_note: 'Florida NEM is favorable (full retail, no size cap). Battery DR payments are a bonus — primary value is backup power for hurricane season. Recommend battery for resilience + demand response income.',
    last_verified: '2025-05',
  },
// Inject before closing ]; of BATTERY_INCENTIVE_PROGRAMS array

  // ── Rocky Mountain Power Wattsmart Battery (Utah) ─────────────────────────────
  {
    program_id: 'rmp_wattsmart_battery_ut',
    program_name: 'Rocky Mountain Power Wattsmart Battery',
    utility_ids: ['pacificorp_wy', 'carbon_power_light_ut', 'dixie_power_ut', 'flowell_electric_association_ut'],
    type: 'battery_incentive',
    status: 'active',
    value_description: 'Up to $1,500 rebate for qualifying battery installations',
    value_flat: 1500,
    max_value: 1500,
    min_battery_kwh: 7,
    utility_dispatch: false,
    program_description: 'Rocky Mountain Power Wattsmart Battery program offers rebates for qualifying residential battery storage systems. Battery must be paired with solar or standalone. Utah homeowners can combine with 30% federal ITC on battery cost.',
    enrollment_url: 'https://www.rockymountainpower.net/energy-environment/clean-energy/battery-storage.html',
    solar_pro_note: 'RMP Wattsmart $1,500 rebate stacks with 30% federal ITC on battery. For a 13.5 kWh Tesla Powerwall (~$12,000 installed), net cost after ITC ($3,600) and rebate ($1,500) = ~$6,900. Battery also adds resilience value for Utah customers in wildfire-prone areas. Always include in Utah solar proposals.',
    last_verified: '2025-05',
  },

  // ── Hawaiian Electric Battery Bonus (Hawaii) ──────────────────────────────────
  {
    program_id: 'heco_battery_bonus_hi',
    program_name: 'Hawaiian Electric Smart Export / Battery Bonus Program',
    utility_ids: ['hawaiian_electric'],
    type: 'demand_response',
    status: 'active',
    value_description: '$850–$1,950 annual payment for battery dispatch participation (3–15 kWh systems)',
    value_annual_per_kw: 130,
    max_value: 1950,
    min_battery_kwh: 3,
    utility_dispatch: true,
    max_dispatch_events_per_year: 60,
    max_dispatch_hours_per_event: 2,
    program_description: 'Hawaiian Electric Smart Export program pays battery owners for grid dispatch during peak demand events. Given Hawaii\'s extreme electricity rates and isolated grid, battery storage is both financially essential and grid-critical. Hawaii also has customer self-supply options that eliminate export entirely.',
    enrollment_url: 'https://www.hawaiianelectric.com/products-and-services/customer-renewable-programs/battery-storage',
    solar_pro_note: 'Hawaii solar + battery is almost mandatory under current HECO tariffs. Hawaiian Electric Smart Export adds $850–$1,950/year income on top of the already-excellent self-consumption savings (38–50¢/kWh avoided). For a customer with $400/month electric bill, solar + battery can realistically eliminate or near-eliminate the bill. Hawaii proposals should always be solar + battery.',
    last_verified: '2025-05',
  },

  // ── Green Mountain Power BYOD (Vermont) ───────────────────────────────────────
  {
    program_id: 'gmp_byod_vt_v2',
    program_name: 'Green Mountain Power BYOD Battery Program (Enhanced)',
    utility_ids: ['green_mountain_vt', 'burlington_electric_vt'],
    type: 'demand_response',
    status: 'active',
    value_description: '$10.44/month ($125/yr) ongoing payment for dispatch participation',
    value_annual_per_kw: 9,
    max_value: 125,
    min_battery_kwh: 7,
    utility_dispatch: true,
    max_dispatch_events_per_year: 30,
    max_dispatch_hours_per_event: 4,
    program_description: 'Vermont Green Mountain Power BYOD (Bring Your Own Device) battery program pays qualifying battery owners $10.44/month in perpetuity for allowing utility dispatch during grid stress events. Battery must be customer-owned (not leased from GMP). GMP also rents Powerwalls at $55/month if customer prefers not to buy.',
    enrollment_url: 'https://greenmountainpower.com/innovation/battery-program/',
    solar_pro_note: 'GMP BYOD pays $125/year ongoing — not a one-time rebate. Over 10 years that\'s $1,250 in passive income from battery participation. Combined with Vermont retail NEM, TOU savings, and 30% ITC, Vermont battery + solar provides strong returns despite cold climate. GMP is the most progressive utility in New England for battery programs. Lead with BYOD in Vermont proposals.',
    last_verified: '2025-05',
  },

  // ── Eversource ConnectedSolutions CT (expanded) ───────────────────────────────
  {
    program_id: 'eversource_cs_ct',
    program_name: 'Eversource ConnectedSolutions CT (Battery Demand Response)',
    utility_ids: ['eversource_ct', 'eversource_cl_ct', 'bozrah_lp_ct', 'south_norwalk_electric_works_ct'],
    type: 'demand_response',
    status: 'active',
    value_description: 'Up to $275/kW-year demand response payment (summer season)',
    value_annual_per_kw: 275,
    max_value: 3700,
    min_battery_kwh: 7,
    utility_dispatch: true,
    max_dispatch_events_per_year: 60,
    max_dispatch_hours_per_event: 2,
    program_description: 'Eversource Connecticut ConnectedSolutions battery demand response program. Utility dispatches customer batteries during ISO-NE grid stress events (typically 100–120 hours/summer). Payment is $275/kW-year of battery rated power. A 13.5 kWh/5 kW Powerwall earns ~$1,375/year. Program runs June–September peak season.',
    enrollment_url: 'https://www.eversource.com/content/ct-c/residential/save-money-energy/connected-solutions',
    solar_pro_note: 'Eversource CT ConnectedSolutions is one of the highest-paying battery DR programs in the US ($275/kW-yr). A Tesla Powerwall 3 (11.5 kW) earns $3,162/year just from ConnectedSolutions payments. Combined with: CT TOU savings (30¢/kWh on-peak), RSIP solar rebate, retail NEM, and 30% ITC, Connecticut solar + battery ROI can be under 5 years. ConnectedSolutions is a must-include in every CT battery proposal.',
    last_verified: '2025-05',
  },

  // ── Minnesota Solar*Rewards Battery Incentive ────────────────────────────────
  {
    program_id: 'xcel_mn_battery_rewards',
    program_name: 'Xcel Energy Minnesota Battery Rewards Program',
    utility_ids: ['minnesota_power_mn', 'otter_tail_power_mn'],
    type: 'demand_response',
    status: 'pilot',
    value_description: 'Pilot: $200–$350/year for qualifying battery dispatch participation',
    value_annual_per_kw: 50,
    max_value: 350,
    min_battery_kwh: 7,
    utility_dispatch: true,
    max_dispatch_events_per_year: 20,
    max_dispatch_hours_per_event: 3,
    program_description: 'Minnesota Power and Otter Tail Power are piloting residential battery demand response programs to complement the existing Minnesota Solar*Rewards solar production incentive. Battery owners in pilot territory can earn dispatch payments during winter and summer peak events.',
    enrollment_url: 'https://www.mnpower.com/CustomerService/RatesSolarEnergy',
    solar_pro_note: 'Minnesota Solar*Rewards pays solar production incentives per kWh for the first 10 years. Battery pilot adds DR income. Minnesota has one of the nation\'s strongest NEM laws. For proposals in Minnesota Power or Otter Tail territory, stack Solar*Rewards + NEM + battery pilot + 30% ITC. Confirm pilot availability with utility — program may have limited enrollment.',
    last_verified: '2025-05',
  },

  // ── TVA EnergyRight Battery Incentive (expanded) ─────────────────────────────
  {
    program_id: 'tva_energyright_battery_expanded',
    program_name: 'TVA EnergyRight Storage Program (Expanded)',
    utility_ids: ['tva_al', 'nashville_electric_service_tn', 'memphis_light_gas_water_tn', 'knoxville_utilities_board_tn', 'bristol_tennessee_essential_services_tn', 'fayetteville_public_utilities_tn'],
    type: 'battery_incentive',
    status: 'active',
    value_description: 'Up to $1,000 upfront rebate + $10/month ongoing bill credit per qualifying battery',
    value_flat: 1000,
    max_value: 2200,
    min_battery_kwh: 5,
    utility_dispatch: true,
    max_dispatch_events_per_year: 20,
    max_dispatch_hours_per_event: 2,
    program_description: 'TVA EnergyRight battery storage program offers local power company rebates for qualifying battery installations. Battery must participate in grid dispatch. Programs vary by local distribution utility — Nashville ES, Memphis LGW, and KUB each administer their own version. Combined TVA wholesale backing makes this program stable long-term.',
    enrollment_url: 'https://www.tva.com/energy/our-power-system/grid-innovation/battery-storage',
    solar_pro_note: 'TVA territory (TN, AL, MS, GA, KY, NC, VA portions) has avoided-cost NEM (~2–4¢/kWh for exports). Battery storage is ESSENTIAL for TVA territory solar — self-consumption saves 8–17¢/kWh while exports earn only 2–4¢/kWh. TVA EnergyRight rebate ($1,000 upfront + $10/month) helps justify battery cost. Always pair battery with solar in TVA territory. Without battery, Tennessee/Alabama solar ROI is very poor.',
    last_verified: '2025-05',
  },

  // ── Alabama Power Battery Incentive ──────────────────────────────────────────
  {
    program_id: 'alabama_power_battery',
    program_name: 'Alabama Power Rate Saver / Energy Storage',
    utility_ids: ['alabama_power'],
    type: 'demand_response',
    status: 'limited',
    value_description: 'Up to $500/year bill credit for battery demand response participation',
    value_annual_per_kw: 50,
    max_value: 500,
    min_battery_kwh: 5,
    utility_dispatch: true,
    max_dispatch_events_per_year: 15,
    max_dispatch_hours_per_event: 2,
    program_description: 'Alabama Power Rate Saver program for residential battery and HVAC demand response. Battery owners may qualify for bill credits in exchange for utility dispatch during summer peak demand events. Alabama Power NEM pays avoided-cost rates (~3¢/kWh), making self-consumption the primary solar value driver.',
    enrollment_url: 'https://www.alabamapower.com/account/ways-to-save/energy-storage.html',
    solar_pro_note: 'Alabama Power pays only avoided-cost (~3¢/kWh) for solar exports. Battery storage changes the economics dramatically — self-consumption saves 9–18¢/kWh vs exporting at 3¢. Rate Saver DR credit adds up to $500/year. For Alabama solar proposals, battery is not optional — it is the primary value enabler. Lead with battery + solar as a package. Alabama has good solar resource (400+ sunny days equivalent).',
    last_verified: '2025-05',
  },

  // ── DTE Energy Battery Pilot (Michigan) ──────────────────────────────────────
  {
    program_id: 'dte_mi_battery_pilot',
    program_name: 'DTE Energy Connected Home Battery Program',
    utility_ids: ['dte_mi'],
    type: 'demand_response',
    status: 'pilot',
    value_description: 'Pilot: $30–$60/month bill credit for battery dispatch participation',
    value_annual_per_kw: 70,
    max_value: 720,
    min_battery_kwh: 7,
    utility_dispatch: true,
    max_dispatch_events_per_year: 30,
    max_dispatch_hours_per_event: 2,
    program_description: 'DTE Energy Michigan Connected Home battery pilot program. Battery owners in selected pilot areas receive bill credits in exchange for allowing DTE to dispatch battery during peak grid periods. Pilot is expanding as DTE adds smart grid infrastructure.',
    enrollment_url: 'https://www.dteenergy.com/us/en/residential/home-efficiency/connected-home.html',
    solar_pro_note: 'DTE Michigan TOU (11 AM–7 PM) aligns perfectly with solar production. Battery provides evening coverage after solar drops at 5–7 PM. DTE Connected Home pilot adds $360–$720/year income on top of TOU savings. Michigan retail NEM ensures fair export value. Michigan is an improving solar market — DTE has been expanding solar programs. Good state for solar + battery bundle.',
    last_verified: '2025-05',
  },

  // ── Kentucky Battery Incentive (Duke PowerPair KY equivalent) ────────────────
  {
    program_id: 'duke_ky_battery',
    program_name: 'Duke Energy Kentucky Battery Incentive',
    utility_ids: ['duke_energy_kentucky_ky'],
    type: 'battery_incentive',
    status: 'limited',
    value_description: 'Up to $1,500 rebate for battery storage systems',
    value_flat: 1500,
    max_value: 1500,
    min_battery_kwh: 7,
    utility_dispatch: false,
    program_description: 'Duke Energy Kentucky offers battery incentives for residential customers installing qualifying battery storage systems. Kentucky NEM at avoided-cost makes battery essential for solar ROI. Incentive availability varies — confirm current status with Duke Energy Kentucky customer service.',
    enrollment_url: 'https://www.duke-energy.com/home/products/battery-storage',
    solar_pro_note: 'Kentucky avoided-cost NEM (~2–4¢/kWh exports) makes battery non-negotiable for solar proposals. Duke Kentucky battery rebate ($1,500) combined with 30% federal ITC significantly reduces battery cost. Total battery incentive on a $10,000 battery system: $3,000 ITC + $1,500 rebate = $4,500 off. Net cost $5,500 for battery that saves hundreds per year at 17¢/kWh peak avoidance. Always include battery in KY proposals.',
    last_verified: '2025-05',
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

// ═══════════════════════════════════════════════════════════════════════
  // v48.28 EXPANSION — Solar Rebate Programs
  // ═══════════════════════════════════════════════════════════════════════

  // ── New Jersey SREC-II / SuSI ─────────────────────────────────────────────
  {
    program_id: 'nj_susi',
    program_name: 'NJ Successor Solar Incentive (SuSI) Program',
    utility_ids: ['pseg_nj', 'atlantic_city_nj', 'rockland_electric_nj', 'orange_rockland_utilities_nj', 'south_jersey_industries_nj', 'sussex_rural_ec_nj'],
    type: 'solar_rebate',
    status: 'active',
    value_description: 'SuSI pays $90–$140/MWh in solar incentives for 15 years (SREC-II market)',
    value_per_kwh_production: 0.10,
    stackable_with_federal_itc: true,
    enrollment_url: 'https://njcleanenergy.com/renewable-energy/programs/solar/solar-transition-srec',
    program_description: 'New Jersey SuSI (Successor Solar Incentive) replaces TREC with SREC-II program. Pays ~$90–$140/MWh for solar production for 15 years. Combined with full retail NEM and 30% ITC, NJ is one of the strongest solar states.',
    solar_pro_note: 'NJ SREC-II + full retail NEM + 30% ITC = one of the best solar ROI in the US (5–7 year payback). SREC-II adds ~$500–$900/year per 6 kW system. Always register for SuSI in NJ.',
    last_verified: '2025-05',
  },

  // ── New York NYSERDA NY-Sun ────────────────────────────────────────────────
  {
    program_id: 'nysun',
    program_name: 'NY-Sun Incentive Program (NYSERDA)',
    utility_ids: ['con_ed_ny', 'nyseg_ny', 'niagara_mohawk_ny', 'central_hudson_ny', 'lipa_ny', 'orange_rockland_ny', 'rg_e_ny', 'rochester_gas_electric_ny', 'o_r_ny'],
    type: 'solar_rebate',
    status: 'active',
    value_description: '$0.20–0.40/W upfront incentive through NY-Sun (varies by sector and utility territory)',
    value_per_kw: 300,
    stackable_with_federal_itc: true,
    enrollment_url: 'https://www.nyserda.ny.gov/All-Programs/NY-Sun',
    program_description: 'NYSERDA NY-Sun provides upfront incentives for residential solar installations across all NY utility territories. Residential: ~$0.20–0.40/W depending on territory. Combined with 25% state tax credit and federal ITC.',
    solar_pro_note: 'NY-Sun incentive + 25% NY state tax credit + 30% federal ITC = ~55% total incentive on system cost. NY has among the strongest incentive stacking in the US. Ensure contractor is NY-Sun registered.',
    last_verified: '2025-05',
  },

  // ── Maryland SREC Market ───────────────────────────────────────────────────
  {
    program_id: 'md_srec',
    program_name: 'Maryland Solar Renewable Energy Credits (SRECs)',
    utility_ids: ['bge_md', 'pepco_md', 'choptank_md', 'delmarva_md', 'potomac_edison_md', 'southern_maryland_ec_md', 'a_n_ec_md', 'easton_utilities_md'],
    type: 'solar_rebate',
    status: 'active',
    value_description: 'SREC market: ~$50–80/MWh; 6 kW system earns ~$400–600/year',
    value_per_kwh_production: 0.065,
    stackable_with_federal_itc: true,
    enrollment_url: 'https://energy.maryland.gov/Residential/Pages/solar/solar_energy.aspx',
    program_description: 'Maryland SRECs are traded on the open market. MD utilities must meet RPS requirements by purchasing SRECs or paying an Alternative Compliance Payment. Current SREC prices ~$50–80/MWh. Combined with full retail NEM and SREC income.',
    solar_pro_note: 'MD SREC market provides $50–80/MWh additional income. Register systems in GATS (PJM EIS) to generate and sell SRECs. Typically $400–600/year additional income per 6 kW system. Strong stacking with full retail NEM.',
    last_verified: '2025-05',
  },

  // ── Massachusetts SMART Program ───────────────────────────────────────────
  {
    program_id: 'ma_smart',
    program_name: 'Massachusetts SMART (Solar Massachusetts Renewable Target)',
    utility_ids: ['eversource_ma', 'eversource_ct', 'natgrid_ma', 'unitil_ma', 'cape_light_compact_ma', 'belmont_municipal_light_ma', 'braintree_electric_light_ma', 'concord_municipal_light_plant_ma', 'danvers_electric_ma', 'reading_municipal_light_ma', 'norwood_municipal_light_ma', 'peabody_municipal_light_ma'],
    type: 'solar_rebate',
    status: 'active',
    value_description: 'SMART pays $0.03–0.16/kWh generated for 10 years (varies by utility and allocation block)',
    value_per_kwh_production: 0.09,
    stackable_with_federal_itc: true,
    enrollment_url: 'https://www.mass.gov/smart-program',
    program_description: 'MA SMART is a performance-based incentive paying per kWh generated for 10 years. Base rate ~$0.03–0.16/kWh depending on utility territory and current allocation block. Battery adder of +$0.01–0.05/kWh for paired storage.',
    solar_pro_note: 'MA SMART + full retail NEM + 30% ITC + MA state tax credit (15%) = one of the strongest solar incentive stacks in the US. Solar+battery customers get additional SMART adder. MA has the highest solar ROI potential in New England.',
    last_verified: '2025-05',
  },

  // ── Connecticut RSIP ──────────────────────────────────────────────────────
  {
    program_id: 'ct_rsip',
    program_name: 'CT Residential Solar Investment Program (RSIP)',
    utility_ids: ['eversource_ct', 'eversource_cl_ct', 'ui_ct', 'groton_utilities_ct'],
    type: 'solar_rebate',
    status: 'active',
    value_description: '$0.463–$0.463/W upfront rebate through CT RSIP (declining block)',
    value_per_kw: 463,
    max_value: 10000,
    stackable_with_federal_itc: true,
    enrollment_url: 'https://www.ctcleanenergy.com/solar',
    program_description: 'Connecticut RSIP provides upfront incentives for residential solar through declining block structure. CT also has virtual net metering and community solar programs.',
    solar_pro_note: 'CT RSIP + full retail NEM + 30% ITC. CT has very high electricity rates ($0.24–0.32/kWh) — one of the best solar economics in the Northeast. Ensure RSIP enrollment through approved installer.',
    last_verified: '2025-05',
  },

  // ── Colorado Solar Rebates ────────────────────────────────────────────────
  {
    program_id: 'co_rebates',
    program_name: 'Colorado Solar Rebates (Xcel Solar*Rewards + CORE)',
    utility_ids: ['xcel_co', 'psco_co', 'holy_cross_energy_co', 'poudre_valley_rea_co', 'united_power_co', 'mountain_view_electric_association_co'],
    type: 'solar_rebate',
    status: 'active',
    value_description: 'Xcel Solar*Rewards: ~$0.02–0.05/kWh production incentive for 10 years; CORE rebates for rural co-ops',
    value_per_kwh_production: 0.03,
    stackable_with_federal_itc: true,
    enrollment_url: 'https://www.xcelenergy.com/programs_and_rebates/residential_programs_and_rebates/solar_*_rewards_program',
    program_description: 'Xcel Solar*Rewards pays per-kWh production incentive for 10 years (~$0.02–0.05/kWh current rate). Colorado rural co-ops may offer CORE rebates. CO also has full retail NEM.',
    solar_pro_note: 'CO Solar*Rewards is a strong performance incentive on top of full retail NEM. 6 kW system at 0.03/kWh earns ~$250/year for 10 years. Register systems through Xcel for Solar*Rewards enrollment.',
    last_verified: '2025-05',
  },

  // ── Washington State Solar Rebate ─────────────────────────────────────────
  {
    program_id: 'wa_solar_rebate',
    program_name: 'Washington State Solar Incentive / Net Metering',
    utility_ids: ['puget_sound_wa', 'seattle_city_light_wa', 'snohomish_county_pud_wa', 'clark_pud_wa', 'avista_wa', 'chelan_county_pud_wa', 'douglas_county_pud_wa', 'grant_county_pud_wa'],
    type: 'solar_rebate',
    status: 'active',
    value_description: 'WA sales tax exemption on solar equipment (saves ~6–10% of system cost)',
    value_per_kw: 0,
    stackable_with_federal_itc: true,
    enrollment_url: 'https://www.commerce.wa.gov/growing-the-economy/energy/energy-policy/',
    program_description: 'Washington State has full retail NEM mandate and sales tax exemption on solar equipment. WA also has production incentive programs through some utilities.',
    solar_pro_note: 'WA full retail NEM (1:1) is mandated for all utilities. WA sales tax exemption saves 8–10% on solar system cost. PacifiCorp/PSE territories: verify RMP Solar Incentive Program availability for additional production incentives.',
    last_verified: '2025-05',
  },

  // ── Oregon Energy Trust ───────────────────────────────────────────────────
  {
    program_id: 'oet_solar',
    program_name: 'Oregon Energy Trust (OET) Solar Rebate',
    utility_ids: ['portland_general_or', 'pacificorp_or', 'eugene_water_electric_board_or', 'pacific_county_pud_wa', 'clearwater_power_or'],
    type: 'solar_rebate',
    status: 'active',
    value_description: '$0.30–0.50/W upfront cash rebate through Oregon Energy Trust',
    value_per_kw: 400,
    max_value: 5000,
    stackable_with_federal_itc: true,
    enrollment_url: 'https://www.energytrust.org/programs/solar-electricity/',
    program_description: 'Oregon Energy Trust offers upfront cash rebates for residential solar installations in PGE and PacifiCorp territories. Combined with full retail NEM and 30% ITC.',
    solar_pro_note: 'OR OET rebate ($0.40/W) + full retail NEM + 30% ITC = strong solar incentive stack. OET is funded by utility customers (PGE/PacifiCorp). Must use OET-approved contractor to qualify.',
    last_verified: '2025-05',
  },

  // ── Minnesota Solar*Rewards / SEIA ────────────────────────────────────────
  {
    program_id: 'mn_solar_rewards',
    program_name: 'Xcel Energy Solar*Rewards (Minnesota)',
    utility_ids: ['xcel_mn', 'minnesota_power_mn', 'otter_tail_power_mn', 'connexus_energy_mn', 'dakota_electric_association_mn'],
    type: 'solar_rebate',
    status: 'active',
    value_description: 'Solar*Rewards: ~$0.02–0.07/kWh production for 10 years',
    value_per_kwh_production: 0.04,
    stackable_with_federal_itc: true,
    enrollment_url: 'https://www.xcelenergy.com/programs_and_rebates/residential_programs_and_rebates/solar_*_rewards_program',
    program_description: 'Xcel Energy Solar*Rewards Minnesota pays per-kWh production incentive for 10 years. MN also has full retail NEM mandate. Some MN utilities offer additional community solar garden opportunities.',
    solar_pro_note: 'MN Solar*Rewards + full retail NEM + 30% ITC. Minnesota has good solar resource (4.5–5 peak sun hrs). Solar*Rewards adds ~$350/year for 10 years on a 6 kW system. Strong incentive stack.',
    last_verified: '2025-05',
  },

  // ── Illinois Shines expansion (covers all IL utilities via state program) ──
  {
    program_id: 'il_shines_all',
    program_name: 'Illinois Shines (Adjustable Block Program) — All IL',
    utility_ids: ['swec_il','coles_moultrie_il','norris_electric_il','shelby_electric_il','corn_belt_energy_il','spoon_river_il','cwlp_il','midamerican_il','illinois_rural_ec_il','adams_ec_il','eastern_illini_ec_il','egyptian_ec_il','farmers_mutual_ec_il','illinois_valley_ec_il','jo_carroll_energy_il','kankakee_valley_ec_il','mcdonough_power_coop_il','menard_ec_il','monroe_county_ec_il','tri_county_ec_il','western_illinois_electrical_coop_il','city_of_naperville_electric_il','city_of_rochelle_electric_il'],
    type: 'solar_rebate',
    status: 'active',
    value_description: 'Performance-based SRECs: $60–90/MWh for 15 years (all IL utility customers)',
    value_per_kwh_production: 0.07,
    stackable_with_federal_itc: true,
    enrollment_url: 'https://illinoisshines.com',
    program_description: 'Illinois Shines (Adjustable Block Program) is a statewide performance-based incentive available to all IL utility customers regardless of which utility serves them. Pays $60–90/MWh for 15 years.',
    solar_pro_note: 'Illinois Shines applies to ALL Illinois utility customers — rural co-ops, municipals, and IOUs. The state program is utility-agnostic. IL Shines + IL NEM + 30% ITC = strong incentive stack for all IL solar customers.',
    last_verified: '2025-05',
  },

  // ── Rhode Island REF / SREC ────────────────────────────────────────────────
  {
    program_id: 'ri_srec',
    program_name: 'Rhode Island REF / SREC Program',
    utility_ids: ['national_grid_ri', 'pascoag_utility_district_ri', 'block_island_power_company_ri'],
    type: 'solar_rebate',
    status: 'active',
    value_description: 'RI SREC market: ~$30–60/MWh; ConnectedSolutions battery adds $250/kW',
    value_per_kwh_production: 0.04,
    stackable_with_federal_itc: true,
    enrollment_url: 'https://www.ri.gov/energy/renewable/',
    program_description: 'Rhode Island SREC market and REF (Renewable Energy Fund) provide incentives for solar. RI also has full retail NEM mandate. National Grid ConnectedSolutions battery program adds ~$250/kW annual payments.',
    solar_pro_note: 'RI full retail NEM + SREC income + ConnectedSolutions battery program (for storage). RI has high electricity rates ($0.22–0.30/kWh). Strong solar ROI especially with battery.',
    last_verified: '2025-05',
  },

  // ── Vermont Group Net Metering / VBSR ─────────────────────────────────────
  {
    program_id: 'vt_solar_incentives',
    program_name: 'Vermont Net Metering / VBSR Solar Incentives',
    utility_ids: ['burlington_electric_vt', 'vermont_ec_vt', 'washington_ec_vt', 'village_of_hyde_park_electric_vt', 'village_of_johnson_electric_vt', 'village_of_ludlow_electric_vt', 'village_of_morrisville_wl_vt', 'village_of_northfield_electric_vt', 'village_of_readsboro_electric_vt', 'village_of_stowe_electric_vt'],
    type: 'solar_rebate',
    status: 'active',
    value_description: 'VT full retail NEM + GMP BYOD battery payments ($850+/yr); SPEED tariff for some systems',
    value_per_kwh_production: 0.02,
    stackable_with_federal_itc: true,
    enrollment_url: 'https://publicservice.vermont.gov/topics/energy_generation/net-metering',
    program_description: 'Vermont Group Net Metering allows sharing solar credits across multiple meters. VT mandates full retail NEM. GMP BYOD adds battery income. Vermont is consistently top-5 solar state for incentive stack.',
    solar_pro_note: 'Vermont: full retail NEM + GMP BYOD battery payments + potential SPEED tariff. All VT utilities must honor NEM. VT municipal utilities often have favorable programs. Strong solar+storage incentive state.',
    last_verified: '2025-05',
  },

  // ── Georgia EMC Solar Rebates ──────────────────────────────────────────────
  {
    program_id: 'ga_emc_solar',
    program_name: 'Georgia EMC / PowerSouth Solar Rebate',
    utility_ids: ['cobb_emc_ga','sawnee_emc_ga','jackson_emc_ga','walton_emc_ga','snapping_shoals_emc_ga','coweta_fayette_emc_ga','flint_energies_ga','greystone_power_ga','carroll_emc_ga','diverse_power_ga','excelsior_emc_ga','habersham_emc_ga','hart_emc_ga','jefferson_energy_coop_ga','little_ocmulgee_emc_ga','middle_georgia_emc_ga','mitchell_emc_ga','ocmulgee_emc_ga','oconee_emc_ga','okefenokee_remc_ga','planters_emc_ga','rayle_emc_ga','satilla_remc_ga','slash_pine_emc_ga','sumter_emc_ga','three_notch_emc_ga','tri_county_emc_ga','upson_emc_ga','withlacoochee_emc_ga'],
    type: 'solar_rebate',
    status: 'active',
    value_description: 'Georgia EMCs: NEM at avoided-cost rate + federal ITC. Some EMCs offer small installation rebates.',
    stackable_with_federal_itc: true,
    enrollment_url: 'https://www.georgiaemc.com',
    program_description: 'Georgia Electric Membership Corporations (EMCs) are member-owned co-ops. NEM terms vary by individual EMC but typically credit exports at avoided-cost rather than retail rate. Some EMCs offer solar installation rebates.',
    solar_pro_note: 'GA EMCs: NEM typically at avoided cost (~3–5 cents/kWh) rather than full retail. Battery storage is strongly recommended for GA EMC customers to maximize self-consumption at retail rates. Check specific EMC NEM tariff before system sizing.',
    last_verified: '2025-05',
  },

  // ── Nebraska Solar Rebates ────────────────────────────────────────────────
  {
    program_id: 'ne_solar',
    program_name: 'Nebraska Public Power / OPPD Solar Program',
    utility_ids: ['nppd_ne', 'oppd_ne', 'les_ne'],
    type: 'solar_rebate',
    status: 'active',
    value_description: 'OPPD: $500 solar rebate; NE NEM at retail rate for qualifying systems',
    value_flat: 500,
    stackable_with_federal_itc: true,
    enrollment_url: 'https://www.oppd.com/services/for-your-home/solar-energy/',
    program_description: 'Nebraska public power districts offer solar programs. OPPD Solar Connect provides NEM at retail rate and small installation rebates. NPPD has residential solar programs with similar terms.',
    solar_pro_note: 'Nebraska NEM is generally at retail rate for qualifying systems. Nebraska has strong solar resource (5–5.5 peak sun hrs in western NE). Low base electricity rates (~$0.09–0.10/kWh) still make solar viable with federal ITC.',
    last_verified: '2025-05',
  },
// Inject before closing ]; of SOLAR_REBATE_PROGRAMS array

  // ── Hawaii GEMS / HEI Solar Rebate ────────────────────────────────────────────
  {
    program_id: 'heco_solar_rebate_hi',
    program_name: 'Hawaii State Solar Tax Credit + HECO Smart Export',
    utility_ids: ['hawaiian_electric'],
    type: 'solar_rebate',
    status: 'active',
    value_description: '35% Hawaii state tax credit (up to $5,000) + federal 30% ITC',
    value_per_kw: 350,
    max_value: 5000,
    stackable_with_federal_itc: true,
    enrollment_url: 'https://tax.hawaii.gov/forms/a1_b1_4renewable/',
    program_description: 'Hawaii offers a 35% state income tax credit on solar installation costs (up to $5,000 per system per year, up to $5,000 total across multiple years). This stacks on top of the 30% federal ITC. Hawaii homeowners can receive up to 65% of system cost covered by tax credits alone.',
    solar_pro_note: 'Hawaii is the most incentivized solar state in the US for tax credits: 35% state + 30% federal = 65% of system cost covered. For a $20,000 system: $7,000 state credit + $6,000 federal ITC = $13,000 in tax credits. Combined with avoiding 38–50¢/kWh electricity, Hawaii solar + battery payback can be 3–5 years. Always lead with the combined incentive story in Hawaii.',
    last_verified: '2025-05',
  },

  // ── Kentucky Solar Rebate ─────────────────────────────────────────────────────
  {
    program_id: 'kentucky_solar_rebate',
    program_name: 'Kentucky Utility Solar Rebate Programs',
    utility_ids: ['duke_energy_kentucky_ky', 'blue_grass_energy_ky', 'clark_energy_ky'],
    type: 'solar_rebate',
    status: 'limited',
    value_description: '$0.10–$0.25/W rebate for qualifying solar installations (varies by utility)',
    value_per_kw: 200,
    max_value: 1500,
    stackable_with_federal_itc: true,
    enrollment_url: 'https://lge-ku.com/rates-environment/renewable-energy',
    program_description: 'Kentucky utilities offer modest solar installation rebates for residential customers. Programs are utility-specific and funding-limited. Duke Energy Kentucky and Blue Grass Energy have offered per-watt rebates. Availability varies — confirm with utility before quoting.',
    solar_pro_note: 'Kentucky solar rebates are modest and availability limited. The bigger story in Kentucky is the REQUIREMENT for battery storage due to avoided-cost NEM. Focus proposals on: 30% federal ITC + battery rebate ($1,500) + self-consumption savings at 9–17¢/kWh. The anti-export economics make battery the hero of every Kentucky proposal.',
    last_verified: '2025-05',
  },

  // ── Michigan Residential Solar Rebate ────────────────────────────────────────
  {
    program_id: 'michigan_solar_rebate',
    program_name: 'Michigan MPSC Solar Rebate / DTE / Consumers Energy',
    utility_ids: ['dte_mi', 'consumers_mi', 'great_lakes_energy_mi', 'holland_bpw_mi'],
    type: 'solar_rebate',
    status: 'active',
    value_description: '$200–$500 one-time installation rebate (utility-specific)',
    value_flat: 350,
    max_value: 500,
    stackable_with_federal_itc: true,
    enrollment_url: 'https://www.dteenergy.com/us/en/residential/home-efficiency/renewable-energy/solar.html',
    program_description: 'Michigan utilities offer modest residential solar installation rebates under MPSC-approved programs. DTE Energy and Consumers Energy have periodic solar rebate openings for residential customers. Michigan retail NEM provides the primary financial value.',
    solar_pro_note: 'Michigan solar rebates are supplemental — the primary value drivers are retail NEM (20¢/kWh exports) and TOU self-consumption savings. DTE and Consumers TOU plans with wide on-peak windows (11 AM–7 PM, 9 AM–10 PM) are very solar-friendly. Michigan is a solid, stable market. Battery adds evening coverage and DR income potential.',
    last_verified: '2025-05',
  },

  // ── Vermont Renewable Energy Fund Solar Grant ─────────────────────────────────
  {
    program_id: 'vt_ref_solar',
    program_name: 'Vermont Clean Energy Development Fund (CEDF) Solar',
    utility_ids: ['green_mountain_vt', 'burlington_electric_vt', 'village_of_hyde_park_electric_vt', 'village_of_johnson_electric_vt', 'village_of_ludlow_electric_vt', 'village_of_morrisville_wl_vt'],
    type: 'solar_rebate',
    status: 'active',
    value_description: '$0.10–$0.20/W Vermont CEDF grant for small residential solar (varies by income tier)',
    value_per_kw: 150,
    max_value: 1500,
    stackable_with_federal_itc: true,
    enrollment_url: 'https://publicservice.vermont.gov/content/clean-energy-development-fund',
    program_description: 'Vermont Clean Energy Development Fund provides grants for residential renewable energy including solar. Income-qualified customers may receive enhanced rebates. Vermont also has annual net metering and the GMP BYOD battery program. Vermont Sustainably Priced Energy Enterprise Development (SPEED) program supports community solar.',
    solar_pro_note: 'Vermont has multiple solar incentive layers: CEDF grant + Vermont retail NEM + GMP BYOD battery DR ($125/yr) + 30% federal ITC. Vermont also has a $150 state income tax credit for solar. Cold climate but excellent incentive stack. Vermont GMP is one of the nation\'s most progressive utilities for solar and storage — very customer-friendly for installs.',
    last_verified: '2025-05',
  },

  // ── Delaware Solar Incentive ──────────────────────────────────────────────────
  {
    program_id: 'delaware_solar_rebate',
    program_name: 'Delaware Green Energy Program Solar Rebate',
    utility_ids: ['delmarva_de', 'city_of_dover_electric_de', 'lewes_bpw_de', 'milford_electric_de', 'newark_electric_de', 'seaford_electric_de'],
    type: 'solar_rebate',
    status: 'active',
    value_description: '$0.25/W rebate up to $1,000 (Delaware Green Energy Program)',
    value_per_kw: 250,
    max_value: 1000,
    stackable_with_federal_itc: true,
    enrollment_url: 'https://www.dnrec.delaware.gov/energy/information/home/solar-installation-program',
    program_description: 'Delaware Green Energy Program provides rebates for residential solar installations. Delaware also has full retail net metering and a SREC-like Renewable Portfolio Standard market. Delaware SREC prices have historically been modest but provide supplemental income.',
    solar_pro_note: 'Delaware is a solid solar market: Green Energy rebate ($0.25/W, up to $1,000) + retail NEM + 30% federal ITC. Delaware SREC market provides modest additional income. Delmarva territory has good solar resource and uncomplicated interconnection process. Lead with the total incentive stack — Delaware customers respond well to the comprehensive financial picture.',
    last_verified: '2025-05',
  },

  // ── Idaho Power / Avista Clean Energy Rebate ─────────────────────────────────
  {
    program_id: 'idaho_power_solar_rebate',
    program_name: 'Idaho Power / Avista Solar Generation Incentive',
    utility_ids: ['idaho_power', 'idaho_county_lp_id', 'clearwater_power_id', 'surprise_valley_electrification_corp_id'],
    type: 'solar_rebate',
    status: 'active',
    value_description: '$0.20/W rebate up to $500 (Idaho Power residential solar)',
    value_per_kw: 200,
    max_value: 500,
    stackable_with_federal_itc: true,
    enrollment_url: 'https://www.idahopower.com/energy-environment/energy-efficiency/home-products-programs/solar-panels/',
    program_description: 'Idaho Power offers a small residential solar generation incentive. Avista Utilities also has solar installation programs in northern Idaho. Idaho has full retail net metering under IPUC rules. Despite low electricity rates, federal ITC + retail NEM make Idaho a viable solar market.',
    solar_pro_note: 'Idaho Power has the lowest rates in the US (~9–10¢/kWh) which extends payback periods vs high-rate states. However, retail NEM + 30% federal ITC + Idaho rebate + no state income tax complexity creates decent economics for many Idaho homeowners. Focus on energy independence and rate protection narrative vs pure financial ROI. Battery not required for positive ROI but adds resilience in fire-prone rural areas.',
    last_verified: '2025-05',
  },

  // ── Alabama Power Solar Rebate / Southern Company ────────────────────────────
  {
    program_id: 'alabama_power_solar',
    program_name: 'Alabama Power Renewable Generation Rate Program',
    utility_ids: ['alabama_power'],
    type: 'solar_rebate',
    status: 'limited',
    value_description: 'Up to $0.15/W annual production payment (Renewable Generation Rate)',
    value_per_kwh_production: 0.03,
    max_value: 750,
    stackable_with_federal_itc: true,
    enrollment_url: 'https://www.alabamapower.com/account/ways-to-save/solar-resources.html',
    program_description: 'Alabama Power Renewable Generation Rate provides above-avoided-cost payments for solar production under certain utility programs. Alabama has minimal state solar incentives beyond the federal ITC. Net metering exports are at avoided-cost (~3¢/kWh). Battery storage is the primary strategy to maximize Alabama solar value.',
    solar_pro_note: 'Alabama is one of the more challenging solar markets due to avoided-cost NEM (~3¢/kWh). The Renewable Generation Rate program provides modest production payments but the primary financial strategy must be battery self-consumption. Alabama Power territory has excellent solar resource (one of the highest in the Southeast). Present proposals as solar + battery systems with self-consumption as the core value driver.',
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

  // ── California Munis: LADWP / SMUD Net Billing Tariff ────────────────────
  // LADWP and SMUD are the two largest CA munis; both adopted NBT-style policies after CPUC NEM 3.0
  {
    program_id: 'ladwp_smud_nbt',
    program_name: 'LADWP / SMUD Net Billing Tariff (NBT)',
    utility_ids: ['ladwp_ca', 'smud_ca'],
    type: 'nem_special',
    status: 'active',
    program_description:
      'LADWP and SMUD are not CPUC-regulated but adopted Net Billing Tariff-style policies aligned with California\'s post-NEM 3.0 framework. New solar customers receive export credits at avoided-cost rates (~8–12¢/kWh for SMUD; ~9–11¢/kWh for LADWP) rather than full retail. Legacy customers grandfathered on NEM 1.0 or older NBT terms for 20 years from install date.',
    export_rate_per_kwh: 0.10,
    tou_export_credit: true,
    annual_export_cap_note: 'Monthly netting; annual true-up at avoided-cost rate',
    enrollment_url: 'https://www.ladwp.com/account/understanding-your-rates/solar-customers',
    solar_pro_note:
      'LADWP and SMUD customers benefit from among the most favorable export rates of any CA muni utility (avoided-cost ~10¢/kWh vs. 6¢ for IOUs). Battery storage still recommended to capture LADWP 1–5 PM on-peak rates (27¢/kWh summer) and SMUD 5–8 PM peak (30¢/kWh). Confirm current NBT step with utility before proposal.',
    last_verified: '2025-05',
  },

  // ── California Munis: IID / Modesto ID / Turlock ID ─────────────────────
  // These three have unique NEM tariffs independent of CPUC
  {
    program_id: 'ca_independent_nem',
    program_name: 'California Independent Utility NEM (IID / Modesto ID / Turlock ID)',
    utility_ids: ['imperial_irrigation_district_ca', 'modesto_irrigation_district_ca', 'turlock_irrigation_district_ca'],
    type: 'nem_special',
    status: 'active',
    program_description:
      'Imperial Irrigation District (IID), Modesto Irrigation District (MID), and Turlock Irrigation District (TID) are not regulated by CPUC and maintain their own net metering tariffs. All three offer near-retail-rate net metering for residential solar systems ≤ 1 MW. Export credits are set by each district\'s board and have historically been more favorable than CPUC NEM 3.0 NBT rates.',
    export_rate_per_kwh: 0.11,
    tou_export_credit: false,
    annual_export_cap_note: 'Annual true-up; no statewide cap applies',
    enrollment_url: 'https://www.iid.com/energy/customers/solar-program',
    solar_pro_note:
      'IID, Modesto ID, and Turlock ID customers are NOT subject to California NEM 3.0. These districts set their own solar rates and have historically maintained more favorable export credits than PG&E/SCE/SDG&E. Battery storage is still beneficial (especially for TOU arbitrage) but is not financially required the way it is for CPUC IOU customers. Verify current tariff with each district before finalizing proposal.',
    last_verified: '2025-05',
  },

  // ── California Munis: Southern CA Munis (Burbank, Glendale, Pasadena, Anaheim) ─────
  {
    program_id: 'ca_socal_muni_nem',
    program_name: 'Southern CA Municipal Utility NEM (Burbank / Glendale / Pasadena / Anaheim)',
    utility_ids: ['burbank_wp_ca', 'glendale_water_power_ca', 'pasadena_wp_ca', 'anaheim_public_utilities_ca'],
    type: 'nem_special',
    status: 'active',
    program_description:
      'Burbank Water & Power, Glendale Water & Power, Pasadena Water & Power, and Anaheim Public Utilities are not CPUC-regulated and maintain independent net metering programs. All four offer annual net metering at near-retail rates for residential solar. Export credits are typically the utility\'s avoided-cost rate or volumetric retail rate depending on the tariff period. Systems must be interconnected per each utility\'s tariff.',
    export_rate_per_kwh: 0.12,
    tou_export_credit: false,
    annual_export_cap_note: 'Annual true-up at utility avoided-cost or retail rate (varies by utility)',
    solar_pro_note:
      'Southern California municipal utilities (Burbank, Glendale, Pasadena, Anaheim) offer better solar economics than nearby CPUC IOUs (SCE/SDG&E) because they are NOT subject to NEM 3.0. Export credits are closer to retail rate. Battery storage is beneficial for TOU arbitrage but ROI without battery is still strong. Each utility has slightly different interconnection requirements — verify tariff and application process before install.',
    last_verified: '2025-05',
  },

  // ── California Munis: Northern CA / Central CA Munis ───────────────────
  {
    program_id: 'ca_norcal_muni_nem',
    program_name: 'NorCal / Central CA Municipal Utility NEM',
    utility_ids: [
      'roseville_electric_ca', 'redding_electric_utility_ca', 'silicon_valley_power_ca',
      'lodi_electric_utility_ca', 'riverside_public_utilities_ca',
    ],
    type: 'nem_special',
    status: 'active',
    program_description:
      'Roseville Electric, Redding Electric, Silicon Valley Power (Santa Clara), Lodi Electric, and Riverside Public Utilities are not CPUC-regulated municipal utilities offering independent net metering programs. Most offer near-retail-rate annual net metering for residential solar systems. Roseville Electric (RCEA) has an excellent solar program with favorable export rates. Silicon Valley Power offers competitive NEM through the City of Santa Clara.',
    export_rate_per_kwh: 0.11,
    tou_export_credit: false,
    annual_export_cap_note: 'Annual true-up; terms set by each city\'s utility board',
    solar_pro_note:
      'These NorCal/Central CA munis are not subject to CPUC NEM 3.0. Export credits are set independently and tend to be more favorable than CPUC IOUs. Roseville Electric and Silicon Valley Power in particular have strong solar programs. Battery storage adds value but proposals can stand alone without battery for these utilities — unlike PG&E/SCE/SDG&E territory.',
    last_verified: '2025-05',
  },

  // ── California Munis: Rural / Smaller CA Munis ───────────────────────
  {
    program_id: 'ca_rural_muni_nem',
    program_name: 'California Rural Municipal Utility NEM (Plumas Sierra / Trinity PUD / Valley Electric)',
    utility_ids: ['plumas_sierra_rec_ca', 'trinity_pud_ca', 'valley_electric_association_ca'],
    type: 'nem_special',
    status: 'active',
    program_description:
      'Plumas-Sierra Rural Electric Cooperative, Trinity PUD, and Valley Electric Association are small California rural utilities with their own solar interconnection and net metering rules. These utilities are not CPUC-regulated and tend to have simpler, older NEM policies that may include full retail-rate credits. Solar resources in these service territories are generally excellent due to higher elevation and more sun hours.',
    export_rate_per_kwh: 0.10,
    tou_export_credit: false,
    annual_export_cap_note: 'Annual net metering; utility-specific terms',
    solar_pro_note:
      'Plumas-Sierra, Trinity PUD, and Valley Electric are rural CA utilities with favorable legacy NEM policies — not subject to CPUC NEM 3.0. Solar ROI without battery storage is strong in these territories. Interconnection queues are typically short vs. major IOUs. Confirm interconnection timeline and current export credit rate with utility before proposal.',
    last_verified: '2025-05',
  },

  // ── DC: Pepco District of Columbia Net Metering ──────────────────────
  {
    program_id: 'pepco_dc_nem',
    program_name: 'DC Net Metering (Pepco)',
    utility_ids: ['pepco_dc'],
    type: 'nem_special',
    status: 'active',
    program_description:
      'Pepco District of Columbia offers full retail-rate net metering for residential solar systems under DC Public Service Commission rules. DC mandates net metering at the full retail rate for systems up to 1 MW. Solar Renewable Energy Credits (SRECs) trade in the DC SREC market, providing additional income of ~$350–450/SREC (among the highest SREC values in the nation). DC solar incentive law is among the most pro-solar in the US.',
    export_rate_per_kwh: 0.14,
    tou_export_credit: false,
    annual_export_cap_note: 'Annual true-up at retail rate; DC SREC income is additional',
    enrollment_url: 'https://pepco.com/home/producingpower/renewableenergy/',
    solar_pro_note:
      'DC has exceptional solar economics: full retail-rate NEM (~14¢/kWh), among the highest SREC values in the nation ($350–450/SREC), 30% federal ITC, and DC property tax exemption for solar. Battery storage adds value but is not required for strong ROI. Ensure customer is aware of DC SREC income — it significantly shortens payback period.',
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


  // ═══════════════════════════════════════════════════════════════════════
  // v48.28 EXPANSION — State NEM Programs (all utilities)
  // ═══════════════════════════════════════════════════════════════════════

  // ── AK: Alaska Net Metering (Utility-Specific) ──────────────────────────────────────────────
  {
    program_id: 'ak_nem_ak',
    program_name: 'Alaska Net Metering (Utility-Specific)',
    utility_ids: ['chugach_ak', 'homer_electric_association_ak', 'kodiak_electric_association_ak', 'copper_valley_electric_ak', 'inside_passage_ec_ak', 'tlingit_haida_regional_electric_authority_ak', 'cordova_ec_ak', 'naknek_electric_association_ak'],
    type: 'nem_special',
    status: 'active',
    program_description: 'Alaska does not have a statewide NEM mandate. Most Alaska utilities offer voluntary NEM programs for small systems. Chugach Electric, Homer Electric, and GVEA offer retail NEM for systems ≤ 25 kW. Contact specific utility for current tariff.',
    tou_export_credit: false,
    enrollment_url: 'https://www.chugachelectric.com/residential/solar/',
    solar_pro_note: 'Alaska NEM varies by utility. High electricity rates ($0.18–0.28/kWh in urban areas) make solar viable despite shorter sun hours. System sizing should maximize summer production. AK solar may qualify for 30% federal ITC.',
    last_verified: '2025-05',
  },

  // ── AL: Alabama Net Metering (Voluntary) ──────────────────────────────────────────────
  {
    program_id: 'al_nem_al',
    program_name: 'Alabama Net Metering (Voluntary)',
    utility_ids: ['alabama_power', 'tva_al', 'joe_wheeler_emc_al', 'cullman_ec_al', 'north_alabama_ec_al', 'coosa_valley_ec_al', 'sand_mountain_ec_al', 'tallapoosa_river_ec_al', 'wiregrass_ec_al', 'baldwin_emc_al', 'clarke_washington_emc_al', 'tombigbee_ec_al', 'dixie_ec_al', 'pea_river_ec_al', 'pioneer_ec_al'],
    type: 'nem_special',
    status: 'active',
    program_description: 'Alabama does not have a statewide mandatory NEM law. Alabama Power and TVA-served utilities offer voluntary avoided-cost buyback programs (~3–5 cents/kWh for exports). Solar economics require maximizing self-consumption.',
    export_rate_per_kwh: 0.04,
    tou_export_credit: false,
    enrollment_url: 'https://www.alabamapower.com/residential/save-money-and-energy/renewable-energy/solar.html',
    solar_pro_note: 'Alabama has NO mandatory NEM. Exports earn only avoided cost (~3–5¢/kWh). BATTERY STORAGE IS CRITICAL for AL solar economics — self-consume at retail (~$0.13/kWh) vs export at $0.03–0.05/kWh. Size system conservatively to minimize exports.',
    last_verified: '2025-05',
  },

  // ── AR: Arkansas Net Metering ──────────────────────────────────────────────
  {
    program_id: 'ar_nem_ar',
    program_name: 'Arkansas Net Metering',
    utility_ids: ['entergy_ar', 'swepco_ar', 'arkansas_valley_ec_ar', 'c_l_ec_ar', 'carroll_ec_ar', 'clay_county_ec_ar', 'craighead_ec_ar', 'delta_electric_power_association_ar', 'farmers_ec_ar', 'first_ec_ar', 'mississippi_county_ec_ar', 'ouachita_ec_ar', 'ozarks_ec_ar', 'petit_jean_ec_ar', 'rich_mountain_ec_ar', 'south_central_arkansas_ec_ar', 'southwest_arkansas_ec_ar', 'white_river_valley_ec_ar'],
    type: 'nem_special',
    status: 'active',
    program_description: 'Arkansas mandates net metering for investor-owned utilities (Entergy AR, SWEPCO). Residential systems ≤ 25 kW eligible. Monthly excess credits roll over; annual excess paid at avoided cost. Rural co-ops have variable programs.',
    tou_export_credit: false,
    annual_export_cap_note: 'Annual excess at avoided cost',
    enrollment_url: 'https://www.entergy-arkansas.com/your_home/energy_efficiency/renewable_energy.aspx',
    solar_pro_note: 'AR IOUs (Entergy, SWEPCO) must offer NEM at retail rate monthly rollover. Co-ops vary — check specific co-op tariff. Annual true-up: excess kWh credits paid at avoided cost (~3–4 cents/kWh). System sizing: target 100% of annual consumption to avoid low-value annual excess.',
    last_verified: '2025-05',
  },

  // ── AZ: Arizona Net Metering (Reduced Rate) ──────────────────────────────────────────────
  {
    program_id: 'az_nem_gen_az',
    program_name: 'Arizona Net Metering (Reduced Rate)',
    utility_ids: ['aps_az', 'srp_az', 'tep_az', 'uns_electric_az', 'duncan_valley_ec_az', 'graham_county_ec_az', 'sulphur_springs_valley_ec_az', 'trico_ec_az', 'navopache_ec_az', 'mohave_ec_az', 'electrical_district_no_2_az', 'electrical_district_no_3_az', 'electrical_district_no_6_az', 'electrical_district_no_7_az'],
    type: 'nem_special',
    status: 'active',
    program_description: 'Arizona eliminated full retail NEM in 2017. Export credits are now set below retail rate (~7–11 cents/kWh depending on utility). APS: Resource Comparison Proxy; SRP: E-27 at avoided cost (~2.8 cents/kWh). Battery storage significantly improves economics.',
    export_rate_per_kwh: 0.09,
    tou_export_credit: false,
    enrollment_url: 'https://www.azcc.gov/utilities/electric',
    solar_pro_note: 'Arizona export rates are BELOW retail. APS: ~$0.10/kWh export rate. SRP E-27: ~$0.028/kWh (very low). TEP: ~$0.07–0.09/kWh. Battery storage is the standard recommendation for AZ solar — self-consume instead of exporting at low rates. Arizona has excellent solar resource (>6 peak sun hrs).',
    last_verified: '2025-05',
  },

  // ── CO: Colorado Net Metering (Full Retail) ──────────────────────────────────────────────
  {
    program_id: 'co_nem_co',
    program_name: 'Colorado Net Metering (Full Retail)',
    utility_ids: ['psco_co', 'black_hills_energy_co', 'holy_cross_energy_co', 'gunnison_county_electric_association_co', 'delta_montrose_electric_association_co', 'empire_electric_association_co', 'grand_valley_power_co', 'highline_electric_association_co', 'k_c_electric_association_co', 'la_plata_electric_association_co', 'mountain_parks_electric_co', 'mountain_view_electric_association_co', 'poudre_valley_rea_co', 'san_isabel_electric_co', 'san_luis_valley_rec_co', 'sangre_de_cristo_electric_co', 'southeast_colorado_power_association_co', 'tri_state_g_t_co', 'united_power_co', 'white_river_electric_association_co', 'y_w_electric_association_co'],
    type: 'nem_special',
    status: 'active',
    program_description: 'Colorado mandates full retail net metering for IOUs (Xcel/PSCo) for systems ≤ 120% of annual consumption. Monthly excess credits roll over at retail rate. Annual excess paid at avoided cost. Co-ops have varied programs.',
    tou_export_credit: false,
    annual_export_cap_note: 'Annual excess at avoided cost',
    enrollment_url: 'https://www.colorado.gov/pacific/dora/node/63286',
    solar_pro_note: 'CO IOUs must offer full retail NEM (1:1). Xcel Solar*Rewards adds per-kWh production incentive on top of NEM. Rural co-ops in CO have varied NEM policies — some offer full retail, others offer avoided cost. Always verify co-op tariff.',
    last_verified: '2025-05',
  },

  // ── CT: Connecticut Net Metering (Full Retail) ──────────────────────────────────────────────
  {
    program_id: 'ct_nem_ct',
    program_name: 'Connecticut Net Metering (Full Retail)',
    utility_ids: ['eversource_cl_ct', 'ui_ct', 'groton_utilities_ct', 'norwich_public_utilities_ct', 'south_norwalk_electric_works_ct', 'bozrah_lp_ct', 'jewett_city_department_of_public_utilities_ct'],
    type: 'nem_special',
    status: 'active',
    program_description: 'Connecticut mandates full retail net metering for residential systems ≤ 25 kW. Monthly kWh credit rollover; annual excess paid at avoided cost rate. CT also has virtual net metering for community solar.',
    tou_export_credit: false,
    annual_export_cap_note: 'Annual excess at avoided cost',
    enrollment_url: 'https://www.ctgreenbank.com/solar/net-metering/',
    solar_pro_note: 'CT full retail NEM for residential ≤ 25 kW. Very high electricity rates ($0.24–0.32/kWh) = excellent solar economics. RSIP rebates + NEM + 30% ITC = one of the best incentive stacks in the US.',
    last_verified: '2025-05',
  },

  // ── DE: Delaware Net Metering (Full Retail) ──────────────────────────────────────────────
  {
    program_id: 'de_nem_de',
    program_name: 'Delaware Net Metering (Full Retail)',
    utility_ids: ['delmarva_de', 'delaware_ec_de', 'city_of_dover_electric_de', 'milford_electric_de', 'newark_electric_de', 'seaford_electric_de', 'lewes_bpw_de'],
    type: 'nem_special',
    status: 'active',
    program_description: 'Delaware mandates full retail net metering for residential systems ≤ 25 kW. Monthly rollover; annual excess paid at avoided cost. DE has solar carve-out in RPS and SREC market.',
    tou_export_credit: false,
    annual_export_cap_note: 'Annual excess at avoided cost',
    enrollment_url: 'https://depsc.delaware.gov/electricity/net-metering/',
    solar_pro_note: 'DE full retail NEM + SREC market. Delmarva Power and DE co-ops must honor NEM. Strong solar incentive state with SREC income on top of NEM credits.',
    last_verified: '2025-05',
  },

  // ── FL: Florida Net Metering (Full Retail — All Utilities) ──────────────────────────────────────────────
  {
    program_id: 'fl_nem_all_fl',
    program_name: 'Florida Net Metering (Full Retail — All Utilities)',
    utility_ids: ['clay_ec_fl', 'central_florida_ec_fl', 'choctawhatchee_ec_fl', 'escambia_river_ec_fl', 'florida_keys_ec_fl', 'glades_ec_fl', 'gulf_coast_ec_fl', 'lee_county_ec_fl', 'okefenokee_remc_fl', 'peace_river_ec_fl', 'seminole_ec_fl', 'suwannee_valley_ec_fl', 'talquin_ec_fl', 'tri_county_ec_fl', 'withlacoochee_river_ec_fl', 'ouc_fl', 'lakeland_electric_fl'],
    type: 'nem_special',
    status: 'active',
    program_description: 'Florida mandates full retail net metering for all utilities (IOUs and cooperatives) for residential systems up to 2 MW. Monthly kWh credit rollover. Annual true-up: excess kWh cashed out at monthly avoided-cost rate.',
    tou_export_credit: false,
    annual_export_cap_note: 'Annual true-up at avoided cost',
    enrollment_url: 'https://www.floridapsc.com/industry/electric/net-metering',
    solar_pro_note: 'Florida NEM is among the best in the South — full retail rate, no size cap for residential, monthly rollover. Annual excess cash-out at avoided cost. Florida sales tax exemption on solar equipment saves ~6%. Strong solar resource (5.5–6 peak sun hrs). Recommend sizing at 95–100% of annual consumption.',
    last_verified: '2025-05',
  },

  // ── GA: Georgia Net Metering (Variable by Utility) ──────────────────────────────────────────────
  {
    program_id: 'ga_nem_ga',
    program_name: 'Georgia Net Metering (Variable by Utility)',
    utility_ids: ['georgia_power', 'cobb_emc_ga', 'sawnee_emc_ga', 'jackson_emc_ga', 'walton_emc_ga', 'snapping_shoals_emc_ga', 'coweta_fayette_emc_ga', 'flint_energies_ga', 'greystone_power_ga', 'carroll_emc_ga', 'diverse_power_ga', 'excelsior_emc_ga', 'habersham_emc_ga', 'hart_emc_ga', 'jefferson_energy_coop_ga', 'little_ocmulgee_emc_ga', 'middle_georgia_emc_ga', 'mitchell_emc_ga', 'ocmulgee_emc_ga', 'oconee_emc_ga', 'okefenokee_remc_ga', 'planters_emc_ga', 'rayle_emc_ga', 'satilla_remc_ga', 'slash_pine_emc_ga', 'sumter_emc_ga', 'three_notch_emc_ga', 'tri_county_emc_ga', 'upson_emc_ga', 'withlacoochee_emc_ga'],
    type: 'nem_special',
    status: 'active',
    program_description: 'Georgia does not have a statewide mandatory NEM law. Georgia Power offers NEM at retail rate for systems ≤ 10 kW (capped interconnection queue). Georgia EMCs offer variable programs — most credit exports at avoided cost (~3–5 cents/kWh) rather than retail.',
    export_rate_per_kwh: 0.04,
    tou_export_credit: false,
    annual_export_cap_note: 'Varies by utility',
    enrollment_url: 'https://www.georgiapower.com/residential/billing-and-rates/rate-options.html',
    solar_pro_note: 'Georgia Power NEM: retail rate for ≤ 10 kW (confirm queue capacity). GA EMCs: typically avoided-cost exports (~3–5¢/kWh). Battery storage strongly recommended for GA EMC customers. Georgia Power territory: battery still adds value for TOU optimization.',
    last_verified: '2025-05',
  },

  // ── HI: Hawaii Customer Self-Supply (CSS) — No Grid Export ──────────────────────────────────────────────
  {
    program_id: 'hi_css_hi',
    program_name: 'Hawaii Customer Self-Supply (CSS) — No Grid Export',
    utility_ids: ['hawaiian_electric'],
    type: 'nem_special',
    status: 'active',
    program_description: 'Hawaii eliminated net metering in 2015. New residential solar customers on Customer Self-Supply (CSS) — NO grid export credits. All solar production must be self-consumed or stored. Battery storage is REQUIRED for economic viability.',
    export_rate_per_kwh: 0.0,
    tou_export_credit: false,
    enrollment_url: 'https://www.hawaiianelectric.com/clean-energy-hawaii/going-solar/customer-self-supply',
    solar_pro_note: 'Hawaii CSS: ZERO export credits. Battery storage is NOT optional — it is MANDATORY for Hawaii solar to make economic sense. Recommend 1:1 battery-to-solar or larger. Hawaii has the highest US electricity rates ($0.35–0.45/kWh) — self-consumption value is enormous.',
    last_verified: '2025-05',
  },

  // ── IA: Iowa Net Metering (Full Retail) ──────────────────────────────────────────────
  {
    program_id: 'ia_nem_ia',
    program_name: 'Iowa Net Metering (Full Retail)',
    utility_ids: ['alliant_ia', 'midamerican_ia', 'black_hills_energy_ia', 'allamakee_clayton_ec_ia', 'boone_valley_ec_ia', 'buchanan_county_rec_ia', 'butler_county_rec_ia', 'central_iowa_power_coop_ia', 'clarke_ec_ia', 'consumers_energy_ia', 'corn_belt_power_coop_ia', 'eastern_iowa_light_power_coop_ia', 'farmers_ec_ia', 'grundy_county_rec_ia', 'guthrie_county_rec_ia', 'hawkeye_rec_ia', 'iowa_lakes_ec_ia', 'iowa_rural_ec_ia', 'linn_county_rec_ia', 'maquoketa_valley_ec_ia', 'marshall_county_rec_ia', 'midland_power_coop_ia', 'north_west_rec_ia', 'pella_muni_ia', 'raccoon_valley_ec_ia', 'southwest_iowa_rec_ia', 't_i_p_rural_ec_ia', 'tri_county_ec_ia', 'united_power_ia', 'western_iowa_power_coop_ia', 'woodbury_county_rec_ia'],
    type: 'nem_special',
    status: 'active',
    program_description: 'Iowa mandates full retail net metering for all utilities for systems up to 500 kW residential. Monthly kWh credit rollover. Annual excess paid at avoided-cost rate.',
    tou_export_credit: false,
    annual_export_cap_note: 'Annual excess at avoided cost',
    enrollment_url: 'https://www.iub.iowa.gov/',
    solar_pro_note: 'Iowa mandates retail NEM for residential ≤ 500 kW — one of the highest caps in the US. MidAmerican Energy dominates IA market with 100% renewable portfolio. Strong solar incentive state.',
    last_verified: '2025-05',
  },

  // ── ID: Idaho Net Metering (Full Retail) ──────────────────────────────────────────────
  {
    program_id: 'id_nem_id',
    program_name: 'Idaho Net Metering (Full Retail)',
    utility_ids: ['idaho_power', 'rocky_mountain_power_id', 'avista_id', 'clearwater_power_id', 'fall_river_rural_ec_id', 'idaho_county_lp_id', 'lost_river_ec_id', 'raft_river_rural_ec_id', 'salmon_river_ec_id', 'surprise_valley_electrification_corp_id', 'united_ec_id', 'bingham_county_ec_id', 'kootenai_ec_id', 'nez_perce_ec_id'],
    type: 'nem_special',
    status: 'active',
    program_description: 'Idaho mandates full retail net metering for residential systems not exceeding monthly consumption. Monthly excess credits roll over. Annual excess paid at avoided-cost rate. Idaho Power, Rocky Mountain Power, and Avista must comply.',
    tou_export_credit: false,
    annual_export_cap_note: 'Annual excess at avoided cost',
    enrollment_url: 'https://www.puc.idaho.gov/',
    solar_pro_note: 'Idaho NEM at retail rate with monthly rollover. Lower base rates (~$0.09–0.11/kWh) but NEM + 30% ITC still makes solar viable. Southern Idaho has excellent solar resource (5+ peak sun hrs summer).',
    last_verified: '2025-05',
  },

  // ── IN: Indiana Net Metering (Avoided Cost — Post 2022) ──────────────────────────────────────────────
  {
    program_id: 'in_nem_2022_in',
    program_name: 'Indiana Net Metering (Avoided Cost — Post 2022)',
    utility_ids: ['aep_indiana', 'duke_indiana', 'aes_indiana_in', 'nipsco_in', 'bartholomew_county_remc_in', 'boone_county_remc_in', 'carroll_white_remc_in', 'clark_county_remc_in', 'daviess_martin_county_remc_in', 'decatur_county_remc_in', 'dubois_rec_in', 'fulton_county_remc_in', 'harrison_county_remc_in', 'henry_county_remc_in', 'hendricks_power_coop_in', 'jackson_county_remc_in', 'jay_county_remc_in', 'johnson_county_remc_in', 'kankakee_valley_remc_in', 'knox_county_remc_in', 'lagrange_county_remc_in', 'northeastern_remc_in', 'orange_county_remc_in', 'parke_county_remc_in', 'pulaski_white_remc_in', 'randolph_county_remc_in', 'rush_county_remc_in', 'south_central_indiana_remc_in', 'southeastern_indiana_remc_in', 'tipmont_remc_in', 'utilities_district_of_western_indiana_remc_in', 'wabash_valley_power_alliance_in', 'warren_county_remc_in', 'white_county_remc_in'],
    type: 'nem_special',
    status: 'active',
    program_description: 'Indiana HB 1278 (2022) eliminated retail net metering for new solar customers. New customers receive avoided-cost credit (~4–5 cents/kWh) for grid exports. Existing retail NEM customers grandfathered until 2032. Battery storage is critical for new IN solar customers.',
    export_rate_per_kwh: 0.045,
    tou_export_credit: false,
    enrollment_url: 'https://www.in.gov/iurc/',
    solar_pro_note: 'Indiana ELIMINATED retail NEM in 2022. New customers: exports earn ~4–5¢/kWh (avoided cost). Existing customers: grandfathered at retail NEM until 2032. For new installs: BATTERY IS ESSENTIAL. Self-consume at $0.13–0.15/kWh vs export at $0.04–0.05/kWh. Recommend battery for all new IN solar installs.',
    last_verified: '2025-05',
  },

  // ── KS: Kansas Net Metering (Full Retail) ──────────────────────────────────────────────
  {
    program_id: 'ks_nem_ks',
    program_name: 'Kansas Net Metering (Full Retail)',
    utility_ids: ['evergy_ks', 'westar_energy_ks', 'kansas_city_power_light_ks', 'ark_valley_ec_ks', 'bluestem_ec_ks', 'butler_rural_ec_ks', 'caney_valley_ec_ks', 'cherryvale_utilities_ks', 'cimarron_ec_ks', 'columbus_ec_ks', 'flint_hills_rural_ec_ks', 'heartland_rural_ec_ks', 'kansas_electric_power_coop_ks', 'lane_scott_ec_ks', 'midwest_energy_ks', 'pioneer_ec_ks', 'prairie_land_ec_ks', 'rolling_hills_ec_ks', 'sedgwick_county_ec_ks', 'sunflower_electric_power_corp_ks', 'twin_valley_ec_ks', 'victory_ec_ks', 'western_cooperative_electric_association_ks'],
    type: 'nem_special',
    status: 'active',
    program_description: 'Kansas mandates full retail net metering for residential systems ≤ 25 kW. Monthly kWh credit rollover. Annual excess paid at avoided-cost rate. Evergy (Westar/KCPL) and co-ops must comply.',
    tou_export_credit: false,
    annual_export_cap_note: 'Annual excess at avoided cost',
    enrollment_url: 'https://www.kcc.ks.gov/',
    solar_pro_note: 'Kansas mandates retail NEM for residential ≤ 25 kW. Good solar resource in KS (5+ peak sun hrs). Low base rates ($0.11–0.13/kWh) but federal ITC + NEM makes solar viable with reasonable payback.',
    last_verified: '2025-05',
  },

  // ── KY: Kentucky Net Metering (Full Retail) ──────────────────────────────────────────────
  {
    program_id: 'ky_nem_ky',
    program_name: 'Kentucky Net Metering (Full Retail)',
    utility_ids: ['kentucky_utilities', 'lg_e_ky', 'ku_ky', 'duke_energy_kentucky_ky', 'blue_grass_energy_ky', 'clark_energy_ky', 'cumberland_valley_electric_ky', 'delta_natural_gas_ky', 'farmers_recc_ky', 'fleming_mason_energy_ky', 'grayson_recc_ky', 'inter_county_energy_ky', 'jackson_energy_ky', 'kenergy_ky', 'licking_valley_recc_ky', 'meade_county_recc_ky', 'nolin_recc_ky', 'owen_electric_ky', 'pennyrile_electric_ky', 'salt_river_electric_ky', 'shelby_energy_ky', 'south_kentucky_recc_ky', 'taylor_county_recc_ky', 'tri_county_ec_ky', 'warren_recc_ky', 'west_kentucky_recc_ky'],
    type: 'nem_special',
    status: 'active',
    program_description: 'Kentucky mandates full retail net metering for residential systems ≤ 30 kW. Monthly rollover at retail rate. Annual excess paid at avoided cost. Kentucky Utilities (LG&E/KU), Duke Kentucky, and co-ops comply.',
    tou_export_credit: false,
    annual_export_cap_note: 'Annual excess at avoided cost',
    enrollment_url: 'https://psc.ky.gov/',
    solar_pro_note: 'Kentucky mandates retail NEM up to 30 kW. Low base rates (~$0.10–0.12/kWh) but NEM + 30% ITC still provides reasonable ROI. KY has good summer solar resource. Residential payback typically 8–12 years.',
    last_verified: '2025-05',
  },

  // ── LA: Louisiana Net Metering (Full Retail) ──────────────────────────────────────────────
  {
    program_id: 'la_nem_la',
    program_name: 'Louisiana Net Metering (Full Retail)',
    utility_ids: ['entergy_la', 'swepco_la', 'beauregard_ec_la', 'bossier_rec_la', 'cajun_electric_power_coop_la', 'claiborne_ec_la', 'concordia_ec_la', 'dixie_emc_la', 'jefferson_davis_ec_la', 'northeast_louisiana_power_coop_la', 'pointe_coupee_emc_la', 'south_louisiana_ec_la', 'valley_emc_la', 'washington_st_tammany_ec_la'],
    type: 'nem_special',
    status: 'active',
    program_description: 'Louisiana mandates full retail net metering for residential systems ≤ 25 kW. Monthly kWh rollover. Annual excess paid at avoided cost. Entergy LA and SWEPCO must comply.',
    tou_export_credit: false,
    annual_export_cap_note: 'Annual excess at avoided cost',
    enrollment_url: 'https://www.lpsc.org/',
    solar_pro_note: 'Louisiana mandates retail NEM for residential ≤ 25 kW. Strong solar resource (5–5.5 peak sun hrs). Entergy LA and SWEPCO must comply. Good state for solar especially with federal ITC + utility rebates.',
    last_verified: '2025-05',
  },

  // ── MA: Massachusetts Net Metering (Full Retail) ──────────────────────────────────────────────
  {
    program_id: 'ma_nem_ma',
    program_name: 'Massachusetts Net Metering (Full Retail)',
    utility_ids: ['eversource_ma', 'natgrid_ma', 'unitil_ma', 'cape_light_compact_ma', 'belmont_municipal_light_ma', 'braintree_electric_light_ma', 'concord_municipal_light_plant_ma', 'danvers_electric_ma', 'groton_electric_light_ma', 'holden_municipal_light_ma', 'hull_municipal_lighting_plant_ma', 'littleton_electric_light_ma', 'mansfield_municipal_electric_ma', 'marblehead_municipal_light_ma', 'middleborough_gas_electric_ma', 'norwood_municipal_light_ma', 'peabody_municipal_light_ma', 'reading_municipal_light_ma', 'rowley_municipal_light_ma', 'shrewsbury_electric_cable_ma', 'sterling_municipal_light_ma', 'taunton_municipal_lighting_plant_ma', 'wakefield_municipal_gas_light_ma', 'westfield_gas_electric_ma', 'wilmington_municipal_light_ma'],
    type: 'nem_special',
    status: 'active',
    program_description: 'Massachusetts mandates full retail net metering for residential systems ≤ 25 kW. Monthly rollover indefinitely. Annual excess paid at avoided-cost rate. SMART program provides additional per-kWh production incentive. One of the strongest solar incentive states.',
    tou_export_credit: false,
    annual_export_cap_note: 'Annual excess at avoided cost',
    enrollment_url: 'https://www.mass.gov/net-metering',
    solar_pro_note: 'MA is consistently #1 or #2 best solar state. Full retail NEM + SMART incentive ($0.03–0.16/kWh for 10 yrs) + 25% state tax credit + 30% ITC = ~55% total incentive. MA utilities must honor NEM regardless of IOU or muni. ConnectedSolutions battery program adds ~$250/kW/season.',
    last_verified: '2025-05',
  },

  // ── MD: Maryland Net Metering (Full Retail) ──────────────────────────────────────────────
  {
    program_id: 'md_nem_md',
    program_name: 'Maryland Net Metering (Full Retail)',
    utility_ids: ['bge_md', 'pepco_md', 'choptank_md', 'delmarva_md', 'potomac_edison_md', 'southern_maryland_ec_md', 'a_n_ec_md', 'city_of_hagerstown_electric_md', 'city_of_thurmont_electric_md', 'easton_utilities_md'],
    type: 'nem_special',
    status: 'active',
    program_description: 'Maryland mandates full retail net metering for residential systems up to 200% of annual consumption. Monthly rollover at retail rate. Annual excess: excess kWh rolled over as dollar credit at month-end retail rate. SREC market provides additional incentive.',
    tou_export_credit: false,
    annual_export_cap_note: '200% annual consumption cap',
    enrollment_url: 'https://energy.maryland.gov/Residential/Pages/solar/solar_energy.aspx',
    solar_pro_note: 'MD full retail NEM + SREC market ($50–80/MWh). All MD utilities must comply. NEM cap (200% of consumption) is very generous. BGE, Pepco, and MD co-ops. Strong solar incentive state.',
    last_verified: '2025-05',
  },

  // ── ME: Maine Net Metering (Full Retail) ──────────────────────────────────────────────
  {
    program_id: 'me_nem_me',
    program_name: 'Maine Net Metering (Full Retail)',
    utility_ids: ['cmp_me', 'versant_power_me', 'bangor_hydro_electric_me', 'eastern_maine_ec_me', 'fox_islands_ec_me', 'houlton_water_company_me', 'van_buren_light_power_district_me'],
    type: 'nem_special',
    status: 'active',
    program_description: 'Maine mandates full retail net metering for systems ≤ 660 kW. Monthly rollover at retail rate. Annual excess credited at avoided-cost rate. CMP (Eversource) and Versant must comply.',
    tou_export_credit: false,
    annual_export_cap_note: 'Annual excess at avoided cost',
    enrollment_url: 'https://mpuc.maine.gov/',
    solar_pro_note: 'Maine mandates full retail NEM up to 660 kW — one of the highest residential caps. High electricity rates ($0.20–0.28/kWh) make solar excellent ROI. Maine has better solar resource than most expect (similar to New Jersey).',
    last_verified: '2025-05',
  },

  // ── MI: Michigan Net Metering (Full Retail) ──────────────────────────────────────────────
  {
    program_id: 'mi_nem_mi',
    program_name: 'Michigan Net Metering (Full Retail)',
    utility_ids: ['dte_mi', 'consumers_mi', 'uppco_mi', 'cherryland_ec_mi', 'cloverland_ec_mi', 'great_lakes_energy_mi', 'homeworks_tri_county_ec_mi', 'midwest_energy_coop_mi', 'ontonagon_county_rea_mi', 'presque_isle_electric_gas_coop_mi', 'thumb_ec_mi', 'traverse_city_lp_mi', 'zeeland_bpw_mi', 'lansing_board_of_wl_mi', 'holland_bpw_mi'],
    type: 'nem_special',
    status: 'active',
    program_description: 'Michigan mandates full retail net metering for residential systems ≤ 150 kW. Monthly rollover at retail rate. Annual excess: excess kWh credited at retail rate in MI (favorable policy). DTE, Consumers, and co-ops must comply.',
    tou_export_credit: false,
    annual_export_cap_note: 'Annual excess at retail rate (favorable)',
    enrollment_url: 'https://www.michigan.gov/mpsc/',
    solar_pro_note: 'Michigan NEM is favorable — full retail rate AND annual excess also at retail rate (no avoided-cost haircut). DTE and Consumers Energy both required to offer NEM. Good solar state with reasonable payback periods.',
    last_verified: '2025-05',
  },

  // ── MN: Minnesota Net Metering (Full Retail) ──────────────────────────────────────────────
  {
    program_id: 'mn_nem_mn',
    program_name: 'Minnesota Net Metering (Full Retail)',
    utility_ids: ['xcel_mn', 'minnesota_power_mn', 'great_plains_energy_mn', 'otter_tail_power_mn', 'connexus_energy_mn', 'dakota_electric_association_mn', 'east_central_energy_mn', 'goodhue_county_ec_mn', 'itasca_mantrap_coop_electrical_association_mn', 'kandiyohi_power_coop_mn', 'lake_region_ec_mn', 'mcleod_cooperative_power_association_mn', 'meeker_cooperative_lp_mn', 'mille_lacs_energy_coop_mn', 'minnesota_valley_ec_mn', 'nobles_cooperative_electric_mn', 'north_itasca_ec_mn', 'peoples_energy_coop_mn', 'red_lake_ec_mn', 'redwood_ec_mn', 'renville_sibley_cooperative_power_mn', 'rice_watonwan_ec_mn', 'runestone_electric_association_mn', 'south_central_electric_association_mn', 'stearns_electric_association_mn', 'todd_wadena_ec_mn', 'traverse_ec_mn', 'wild_rice_ec_mn', 'wright_hennepin_cooperative_electric_association_mn'],
    type: 'nem_special',
    status: 'active',
    program_description: 'Minnesota mandates full retail net metering for residential systems ≤ 40 kW. Monthly rollover at retail rate. Annual excess paid at avoided-cost rate. Xcel Solar*Rewards adds per-kWh production incentive.',
    tou_export_credit: false,
    annual_export_cap_note: 'Annual excess at avoided cost',
    enrollment_url: 'https://www.commerce.state.mn.us/renewables/',
    solar_pro_note: 'MN mandates retail NEM for residential ≤ 40 kW. Solar*Rewards adds ~$350–600/year for 10 years per 6 kW system. MN has strong incentive stack. Payback typically 7–10 years.',
    last_verified: '2025-05',
  },

  // ── MO: Missouri Net Metering (Full Retail) ──────────────────────────────────────────────
  {
    program_id: 'mo_nem_mo',
    program_name: 'Missouri Net Metering (Full Retail)',
    utility_ids: ['evergy_mo_ks', 'ameren_mo', 'empire_district_electric_mo', 'associated_ec_mo', 'barry_ec_mo', 'boone_ec_mo', 'callaway_ec_mo', 'central_missouri_ec_mo', 'citizens_electric_corp_mo', 'clark_ec_mo', 'co_mo_ec_mo', 'consolidated_ec_mo', 'cuivre_river_ec_mo', 'farmers_ec_mo', 'gascosage_ec_mo', 'grundy_ec_mo', 'howard_ec_mo', 'intercounty_ec_mo', 'laclede_ec_mo', 'lewis_county_rural_ec_mo', 'macon_ec_mo', 'meramec_ec_mo', 'missouri_rural_ec_mo', 'new_mac_ec_mo', 'nodaway_valley_ec_mo', 'northeast_missouri_electric_power_coop_mo', 'osage_valley_ec_mo', 'ozark_border_ec_mo', 'pemiscot_dunklin_ec_mo', 'platte_clay_ec_mo', 'ralls_county_ec_mo', 'sac_osage_ec_mo', 'se_missouri_ec_mo', 'southwest_ec_mo', 'three_rivers_ec_mo', 'webster_ec_mo', 'white_river_valley_ec_mo'],
    type: 'nem_special',
    status: 'active',
    program_description: 'Missouri mandates full retail net metering for residential systems ≤ 100 kW. Monthly rollover at retail rate. Annual excess paid at avoided-cost rate. Ameren MO and Evergy must comply. Co-ops have varied programs.',
    tou_export_credit: false,
    annual_export_cap_note: 'Annual excess at avoided cost',
    enrollment_url: 'https://psc.mo.gov/',
    solar_pro_note: 'Missouri mandates retail NEM for residential ≤ 100 kW. Ameren MO and Evergy must comply. Co-ops have variable policies — some offer retail NEM, others only avoided cost. Always verify specific co-op tariff.',
    last_verified: '2025-05',
  },

  // ── MS: Mississippi Net Metering (Voluntary) ──────────────────────────────────────────────
  {
    program_id: 'ms_nem_ms',
    program_name: 'Mississippi Net Metering (Voluntary)',
    utility_ids: ['entergy_ms', 'mississippi_power', 'alcorn_county_electric_power_association_ms', 'bolivar_electric_power_association_ms', 'coahoma_electric_power_association_ms', 'coast_electric_power_association_ms', 'delta_electric_power_association_ms', 'dixie_electric_power_association_ms', 'four_county_electric_power_association_ms', 'jones_county_electric_power_association_ms', 'magnolia_electric_power_association_ms', 'mississippi_delta_electric_power_association_ms', 'north_east_mississippi_electric_power_association_ms', 'pearl_river_valley_electric_power_association_ms', 'singing_river_electric_power_association_ms', 'southwest_mississippi_electric_power_association_ms', 'tallahatchie_valley_electric_power_association_ms', 'tippah_electric_power_association_ms', 'tombigbee_electric_power_association_ms', 'twin_county_electric_power_association_ms'],
    type: 'nem_special',
    status: 'active',
    program_description: 'Mississippi does not have a statewide mandatory NEM law. Entergy MS and Mississippi Power offer voluntary programs with below-retail export rates (~3–5 cents/kWh). Solar economics require maximizing self-consumption.',
    export_rate_per_kwh: 0.04,
    tou_export_credit: false,
    enrollment_url: 'https://www.mississippipower.com/residential/energy-savings/solar-energy',
    solar_pro_note: 'Mississippi: no mandatory NEM. Exports earn ~3–5¢/kWh. Battery storage is strongly recommended for MS solar customers. Mississippi has excellent solar resource (5–5.5 peak sun hrs) — solar can still be economic with battery maximizing self-consumption.',
    last_verified: '2025-05',
  },

  // ── MT: Montana Net Metering (Full Retail) ──────────────────────────────────────────────
  {
    program_id: 'mt_nem_mt',
    program_name: 'Montana Net Metering (Full Retail)',
    utility_ids: ['northwestern_mt', 'mdu_mt', 'flathead_ec_mt', 'glacier_ec_mt', 'hill_county_ec_mt', 'mid_yellowstone_ec_mt', 'missoula_ec_mt', 'ravalli_county_ec_mt', 'sheridan_ec_mt', 'sun_river_ec_mt', 'tongue_river_ec_mt', 'triangle_ec_mt', 'vigilante_ec_mt', 'yellowstone_valley_ec_mt'],
    type: 'nem_special',
    status: 'active',
    program_description: 'Montana mandates full retail net metering for residential systems ≤ 50 kW. Monthly rollover at retail rate. Annual excess paid at avoided-cost rate. NorthWestern Energy and MDU must comply.',
    tou_export_credit: false,
    annual_export_cap_note: 'Annual excess at avoided cost',
    enrollment_url: 'https://psc.mt.gov/',
    solar_pro_note: 'Montana mandates retail NEM for residential ≤ 50 kW. Good solar resource in eastern MT. NorthWestern Energy and Montana-Dakota Utilities must honor NEM. Reasonable payback with 30% ITC.',
    last_verified: '2025-05',
  },

  // ── NC: North Carolina Net Metering (Cooperatives) ──────────────────────────────────────────────
  {
    program_id: 'nc_nem_coops_nc',
    program_name: 'North Carolina Net Metering (Cooperatives)',
    utility_ids: ['dominion_energy_nc_nc', 'blue_ridge_emc_nc', 'brunswick_emc_nc', 'cape_hatteras_ec_nc', 'carteret_craven_ec_nc', 'central_emc_nc', 'edgecombe_martin_county_emc_nc', 'energyunited_emc_nc', 'four_county_emc_nc', 'french_broad_emc_nc', 'halifax_emc_nc', 'haywood_emc_nc', 'jones_onslow_emc_nc', 'lumbee_river_emc_nc', 'new_hanover_county_emc_nc', 'pee_dee_emc_nc', 'piedmont_emc_nc', 'randolph_emc_nc', 'roanoke_ec_nc', 'rutherford_emc_nc', 'south_river_emc_nc', 'surry_yadkin_emc_nc', 'tideland_emc_nc', 'tri_county_emc_nc', 'union_power_coop_nc', 'wake_emc_nc', 'yadkin_valley_telephone_membership_corp_nc'],
    type: 'nem_special',
    status: 'active',
    program_description: 'North Carolina co-ops must offer net metering under the NC Utilities Commission ruling. NC EMCs credit exports at retail rate with monthly rollover. Duke NC already covered separately. Annual excess paid at avoided cost.',
    tou_export_credit: false,
    annual_export_cap_note: 'Annual excess at avoided cost',
    enrollment_url: 'https://www.ncuc.commerce.state.nc.us/',
    solar_pro_note: 'NC co-ops required to offer NEM at retail rate. Duke NC PowerPair battery rebate ($6,000–$9,000) available for solar+battery. NC has good solar resource (5+ peak sun hrs). Duke NC NEM + PowerPair is compelling solar+battery combination.',
    last_verified: '2025-05',
  },

  // ── ND: North Dakota Net Metering (Full Retail) ──────────────────────────────────────────────
  {
    program_id: 'nd_nem_nd',
    program_name: 'North Dakota Net Metering (Full Retail)',
    utility_ids: ['otter_tail_nd', 'xcel_energy_nd_nd', 'montana_dakota_utilities_nd', 'basin_electric_power_coop_nd', 'cass_county_ec_nd', 'cavalier_rural_ec_nd', 'dakotas_ec_nd', 'dickey_rural_networks_nd', 'dunn_county_ec_nd', 'emmons_logan_ec_nd', 'garrison_diversion_conservancy_district_nd', 'kem_ec_nd', 'mclean_ec_nd', 'mor_gran_sou_ec_nd', 'mountrail_williams_ec_nd', 'north_central_ec_nd', 'nodak_ec_nd', 'oliver_mercer_ec_nd', 'roughrider_ec_nd', 'slope_ec_nd', 'tri_county_ec_nd', 'west_plains_ec_nd'],
    type: 'nem_special',
    status: 'active',
    program_description: 'North Dakota mandates full retail net metering for residential systems ≤ 100 kW. Monthly rollover at retail rate. Annual excess paid at avoided-cost rate. Xcel Energy ND and MDU must comply.',
    tou_export_credit: false,
    annual_export_cap_note: 'Annual excess at avoided cost',
    enrollment_url: 'https://psc.nd.gov/',
    solar_pro_note: 'North Dakota mandates retail NEM for residential ≤ 100 kW. Lower solar resource in ND (~4.5 peak sun hrs) but very favorable NEM policy. Federal ITC makes solar viable. Western ND has better solar than eastern ND.',
    last_verified: '2025-05',
  },

  // ── NE: Nebraska Net Metering (Full Retail) ──────────────────────────────────────────────
  {
    program_id: 'ne_nem_ne',
    program_name: 'Nebraska Net Metering (Full Retail)',
    utility_ids: ['nppd_ne', 'oppd_ne', 'les_ne', 'burt_county_ppd_ne', 'butler_ppd_ne', 'cedar_knox_ppd_ne', 'chimney_rock_ppd_ne', 'cornhusker_ppd_ne', 'cuming_county_ppd_ne', 'custer_ppd_ne', 'dawson_ppd_ne', 'elkhorn_rural_ppd_ne', 'farmers_merchants_ec_ne', 'frontier_ppd_ne', 'garfield_ppd_ne', 'grant_county_ppd_ne', 'howard_greeley_rural_ppd_ne', 'husker_emc_ne', 'loup_valleys_rural_ppd_ne', 'mccook_ppd_ne', 'midwest_emc_ne', 'niobrara_valley_emc_ne', 'north_central_ppd_ne', 'northeast_nebraska_ec_ne', 'northwest_rural_ppd_ne', 'o_g_ec_ne', 'panhandle_rural_electric_membership_association_ne', 'perennial_ppd_ne', 'polk_county_rural_ppd_ne', 'seward_county_ppd_ne', 'south_central_ppd_ne', 'southeast_nebraska_ppd_ne', 'southern_ppd_ne', 'southwest_ppd_ne', 'twin_valleys_ppd_ne', 'wheat_belt_ppd_ne', 'wheatland_ec_ne', 'york_county_seward_county_ppd_ne'],
    type: 'nem_special',
    status: 'active',
    program_description: 'Nebraska mandates full retail net metering for residential systems ≤ 25 kW. Monthly rollover at retail rate. Annual excess paid at avoided-cost rate. NPPD, OPPD, and LES must comply.',
    tou_export_credit: false,
    annual_export_cap_note: 'Annual excess at avoided cost',
    enrollment_url: 'https://www.psc.ne.gov/',
    solar_pro_note: 'Nebraska mandates retail NEM for residential ≤ 25 kW. All Nebraska public utilities must comply. Good solar resource in western NE (5.5+ peak sun hrs). Low base rates (~$0.09–0.10/kWh) but federal ITC makes solar viable.',
    last_verified: '2025-05',
  },

  // ── NH: New Hampshire Net Metering (Full Retail) ──────────────────────────────────────────────
  {
    program_id: 'nh_nem_nh',
    program_name: 'New Hampshire Net Metering (Full Retail)',
    utility_ids: ['eversource_nh', 'unitil_nh', 'nh_ec_nh', 'granite_state_electric_nh', 'new_hampshire_ec_nh', 'wolfeboro_power_nh', 'littleton_wl_nh'],
    type: 'nem_special',
    status: 'active',
    program_description: 'New Hampshire mandates full retail net metering for residential systems ≤ 100 kW. Monthly rollover at retail rate. Annual excess: excess kWh at avoided-cost. Eversource NH and Unitil must comply.',
    tou_export_credit: false,
    annual_export_cap_note: 'Annual excess at avoided cost',
    enrollment_url: 'https://www.puc.nh.gov/Sustainable%20Energy/NetMetering/NetMetering.htm',
    solar_pro_note: 'NH mandates retail NEM for residential ≤ 100 kW. High electricity rates ($0.22–0.28/kWh) make solar excellent ROI. Eversource NH ConnectedSolutions battery program adds ~$250/kW/season. Strong incentive stack.',
    last_verified: '2025-05',
  },

  // ── NJ: New Jersey Net Metering (Full Retail) ──────────────────────────────────────────────
  {
    program_id: 'nj_nem_nj',
    program_name: 'New Jersey Net Metering (Full Retail)',
    utility_ids: ['pseg_nj', 'atlantic_city_nj', 'rockland_electric_nj', 'sussex_rural_ec_nj', 'south_jersey_industries_nj', 'orange_rockland_utilities_nj'],
    type: 'nem_special',
    status: 'active',
    program_description: 'New Jersey mandates full retail net metering for residential systems with no specific size cap. Monthly rollover at retail rate. Annual excess paid at avoided-cost rate. PSEG NJ and ACE must comply. SuSI program adds performance incentive.',
    tou_export_credit: false,
    annual_export_cap_note: 'Annual excess at avoided cost',
    enrollment_url: 'https://njcleanenergy.com/renewable-energy/programs/solar/solar-transition-srec',
    solar_pro_note: 'NJ full retail NEM + SuSI performance incentive ($90–140/MWh for 15 yrs) + 30% ITC = one of the best solar incentive stacks in the US. NJ typically has 5–7 year payback. Always register for SuSI program.',
    last_verified: '2025-05',
  },

  // ── NM: New Mexico Net Metering (Full Retail) ──────────────────────────────────────────────
  {
    program_id: 'nm_nem_nm',
    program_name: 'New Mexico Net Metering (Full Retail)',
    utility_ids: ['pnm_nm', 'el_paso_electric_nm', 'xcel_energy_nm_nm', 'central_new_mexico_ec_nm', 'columbus_ec_nm', 'continental_divide_ec_nm', 'farmers_ec_nm', 'jemez_mountains_ec_nm', 'kit_carson_ec_nm', 'lea_county_ec_nm', 'mora_san_miguel_ec_nm', 'otero_county_ec_nm', 'roosevelt_county_ec_nm', 'sierra_ec_nm', 'socorro_ec_nm', 'southwestern_public_service_nm', 'springer_ec_nm', 'tri_state_g_t_nm', 'tucumcari_ec_nm', 'valencia_county_ec_nm'],
    type: 'nem_special',
    status: 'active',
    program_description: 'New Mexico mandates full retail net metering for residential systems ≤ 80 kW. Monthly rollover at retail rate. Annual excess paid at avoided-cost rate. PNM and co-ops must comply.',
    tou_export_credit: false,
    annual_export_cap_note: 'Annual excess at avoided cost',
    enrollment_url: 'https://www.nmprc.state.nm.us/',
    solar_pro_note: 'NM mandates retail NEM for residential ≤ 80 kW. Excellent solar resource (>5.5 peak sun hrs statewide). PNM and rural co-ops must honor NEM. Federal ITC + NEM = strong ROI in NM.',
    last_verified: '2025-05',
  },

  // ── NV: Nevada Net Metering (75% of Retail Rate) ──────────────────────────────────────────────
  {
    program_id: 'nv_nem_75_nv',
    program_name: 'Nevada Net Metering (75% of Retail Rate)',
    utility_ids: ['nv_energy', 'valley_electric_association_nv', 'mt_wheeler_power_nv', 'overton_power_district_nv', 'lincoln_county_power_district_nv', 'ely_lp_nv', 'wells_rural_electric_company_nv', 'harney_ec_nv'],
    type: 'nem_special',
    status: 'active',
    program_description: 'Nevada restored net metering in 2017 after briefly eliminating it. Current export credit rate is approximately 75% of retail rate (~8–12 cents/kWh). Rate scheduled to gradually decline. NV Energy battery rebate ($3,000) available.',
    export_rate_per_kwh: 0.1,
    tou_export_credit: false,
    enrollment_url: 'https://pucnv.gov/',
    solar_pro_note: 'Nevada NEM at 75% of retail rate (~$0.10/kWh for NV Energy). Lower than full retail but still significantly above avoided cost. Battery storage extends value of solar into peak evening hours. NV Energy $3,000 battery rebate helps offset battery cost. Nevada Class I NEM for ≤ 25 kW.',
    last_verified: '2025-05',
  },

  // ── NY: New York Net Metering (Full Retail) ──────────────────────────────────────────────
  {
    program_id: 'ny_nem_ny',
    program_name: 'New York Net Metering (Full Retail)',
    utility_ids: ['con_ed_ny', 'nyseg_ny', 'niagara_mohawk_ny', 'central_hudson_ny', 'lipa_ny', 'orange_rockland_ny', 'rg_e_ny', 'o_r_ny', 'rochester_gas_electric_ny', 'delaware_county_ec_ny', 'oneida_madison_ec_ny', 'otsego_ec_ny', 'steuben_rural_ec_ny', 'sullivan_county_ec_ny', 'claverack_rural_ec_ny', 'jefferson_county_ec_ny', 'lewis_county_rural_ec_ny'],
    type: 'nem_special',
    status: 'active',
    program_description: 'New York mandates full retail net metering for residential systems ≤ 25 kW. All NY utilities must comply. NY-Sun incentive provides upfront cash incentive. 25% state tax credit stacks with 30% federal ITC.',
    tou_export_credit: false,
    annual_export_cap_note: 'Annual excess at avoided cost',
    enrollment_url: 'https://www.nyserda.ny.gov/All-Programs/NY-Sun',
    solar_pro_note: 'NY full retail NEM + NY-Sun incentive ($0.20–0.40/W) + 25% state tax credit + 30% ITC = ~55% total incentive stack. All NY utilities must honor NEM. LIPA (Long Island) has additional BYOB battery program.',
    last_verified: '2025-05',
  },

  // ── OH: Ohio Net Metering (Full Retail) ──────────────────────────────────────────────
  {
    program_id: 'oh_nem_oh',
    program_name: 'Ohio Net Metering (Full Retail)',
    utility_ids: ['aep_oh', 'firstenergy_oh', 'duke_energy_ohio_oh', 'dayton_power_light_oh', 'adams_rural_ec_oh', 'buckeye_rural_ec_oh', 'carroll_ec_oh', 'consolidated_ec_oh', 'darke_rural_ec_oh', 'delaware_rural_ec_oh', 'firelands_ec_oh', 'frontier_power_oh', 'guernsey_muskingum_ec_oh', 'hancock_wood_ec_oh', 'holmes_wayne_ec_oh', 'licking_rural_electrification_oh', 'lorain_medina_rural_ec_oh', 'mid_ohio_energy_coop_oh', 'north_central_ec_oh', 'northwestern_rural_ec_oh', 'ohio_rural_electric_cooperatives_oh', 'paulding_putnam_ec_oh', 'pioneer_rural_ec_oh', 'south_central_power_oh', 'tri_county_rural_ec_oh', 'union_rural_ec_oh', 'vinton_county_ec_oh', 'washington_ec_oh'],
    type: 'nem_special',
    status: 'active',
    program_description: 'Ohio mandates full retail net metering for residential systems ≤ 10 kW (≤ 100 kW commercial). Monthly rollover at retail rate. Annual excess paid at avoided-cost rate. AEP Ohio, FirstEnergy, and co-ops must comply.',
    tou_export_credit: false,
    annual_export_cap_note: 'Annual excess at avoided cost; 10 kW residential cap',
    enrollment_url: 'https://puco.ohio.gov/',
    solar_pro_note: 'Ohio NEM: full retail for residential ≤ 10 kW. System sizing capped at 10 kW for NEM eligibility. Moderate electricity rates ($0.12–0.15/kWh). Payback typically 9–12 years. Ohio co-ops must also honor NEM under state rules.',
    last_verified: '2025-05',
  },

  // ── OK: Oklahoma Net Metering (Full Retail) ──────────────────────────────────────────────
  {
    program_id: 'ok_nem_ok',
    program_name: 'Oklahoma Net Metering (Full Retail)',
    utility_ids: ['oge_ok', 'pso_ok', 'oec_ok', 'alfalfa_ec_ok', 'caddo_ec_ok', 'canadian_valley_ec_ok', 'central_rural_ec_ok', 'choctaw_ec_ok', 'cimarron_ec_ok', 'consolidated_rural_ec_ok', 'cotton_ec_ok', 'creek_ec_ok', 'east_central_ec_ok', 'harmon_electric_association_ok', 'indian_ec_ok', 'kay_ec_ok', 'kiamichi_ec_ok', 'lake_region_ec_ok', 'midwest_ec_ok', 'northfork_ec_ok', 'northeast_oklahoma_ec_ok', 'northwestern_ec_ok', 'oklahoma_ec_ok', 'ozarks_ec_ok', 'peoples_ec_ok', 'red_river_valley_rea_ok', 'rural_ec_ok', 'southeastern_ec_ok', 'southwest_rural_electric_association_ok', 'verdigris_valley_ec_ok', 'western_farmers_ec_ok', 'woodward_ec_ok'],
    type: 'nem_special',
    status: 'active',
    program_description: 'Oklahoma mandates full retail net metering for residential systems ≤ 25 kW. Monthly rollover at retail rate. Annual excess paid at avoided-cost rate. OGE, PSO, and co-ops must comply.',
    tou_export_credit: false,
    annual_export_cap_note: 'Annual excess at avoided cost',
    enrollment_url: 'https://www.occ.ok.gov/',
    solar_pro_note: 'Oklahoma mandates retail NEM for residential ≤ 25 kW. Good solar resource (5+ peak sun hrs). OGE SmartHours TOU rate aligns well with afternoon solar production. Reasonable payback with 30% ITC.',
    last_verified: '2025-05',
  },

  // ── OR: Oregon Net Metering (Full Retail) ──────────────────────────────────────────────
  {
    program_id: 'or_nem_or',
    program_name: 'Oregon Net Metering (Full Retail)',
    utility_ids: ['portland_general_or', 'pacificorp_or', 'blachly_lane_ec_or', 'clatskanie_pud_or', 'clearwater_power_or', 'columbia_basin_ec_or', 'columbia_river_pud_or', 'consumers_power_or', 'coos_curry_ec_or', 'emerald_pud_or', 'eugene_water_electric_board_or', 'harney_ec_or', 'hood_river_ec_or', 'lane_ec_or', 'lincoln_ec_or', 'lost_river_ec_or', 'midstate_ec_or', 'northern_wasco_county_pud_or', 'oregon_trail_ec_or', 'salem_electric_or', 'tillamook_pud_or', 'umatilla_ec_or', 'wasco_ec_or', 'west_oregon_ec_or'],
    type: 'nem_special',
    status: 'active',
    program_description: 'Oregon mandates full retail net metering for residential systems ≤ 25 kW. Monthly rollover at retail rate. Annual excess paid at avoided-cost rate. PGE and PacifiCorp must comply. Oregon Energy Trust provides additional rebates.',
    tou_export_credit: false,
    annual_export_cap_note: 'Annual excess at avoided cost',
    enrollment_url: 'https://www.energytrust.org/programs/solar-electricity/',
    solar_pro_note: 'Oregon full retail NEM + Oregon Energy Trust rebate ($0.30–0.50/W) + 30% ITC. PGE and PacifiCorp must honor NEM. Oregon is a strong solar incentive state especially with OET rebates.',
    last_verified: '2025-05',
  },

  // ── PA: Pennsylvania Net Metering (Full Retail) ──────────────────────────────────────────────
  {
    program_id: 'pa_nem_pa',
    program_name: 'Pennsylvania Net Metering (Full Retail)',
    utility_ids: ['peco_pa', 'penelec_pa', 'met_ed_pa', 'adams_ec_pa', 'bedford_rural_ec_pa', 'claverack_rural_ec_pa', 'new_enterprise_rural_ec_pa', 'northwestern_rural_ec_pa', 'palmerton_telephone_pa', 'penn_lines_pa', 'pike_ec_pa', 'rea_energy_coop_pa', 'sullivan_county_rural_ec_pa', 'tri_county_rural_ec_pa', 'ugi_utilities_pa', 'valley_rural_ec_pa', 'wellsboro_electric_company_pa'],
    type: 'nem_special',
    status: 'active',
    program_description: 'Pennsylvania mandates full retail net metering for residential systems ≤ 50 kW. Monthly rollover at retail rate. Annual excess paid at avoided-cost rate. PECO, PPL, and co-ops must comply. PA has SREC market.',
    tou_export_credit: false,
    annual_export_cap_note: 'Annual excess at avoided cost',
    enrollment_url: 'https://www.puc.pa.gov/',
    solar_pro_note: 'Pennsylvania mandates retail NEM for residential ≤ 50 kW. PA SREC market provides additional income ($20–40/MWh). PECO, PPL, MetEd, Penelec, and PA co-ops must honor NEM. Reasonable solar ROI with SREC + NEM + ITC.',
    last_verified: '2025-05',
  },

  // ── RI: Rhode Island Net Metering (Full Retail) ──────────────────────────────────────────────
  {
    program_id: 'ri_nem_ri',
    program_name: 'Rhode Island Net Metering (Full Retail)',
    utility_ids: ['national_grid_ri', 'pascoag_utility_district_ri', 'block_island_power_company_ri'],
    type: 'nem_special',
    status: 'active',
    program_description: 'Rhode Island mandates full retail net metering for residential systems with no specific size cap. Monthly rollover at retail rate. Annual excess paid at avoided-cost rate. National Grid RI must comply. SREC market provides additional income.',
    tou_export_credit: false,
    annual_export_cap_note: 'Annual excess at avoided cost',
    enrollment_url: 'https://www.ri.gov/energy/renewable/',
    solar_pro_note: 'Rhode Island full retail NEM + SREC income + ConnectedSolutions battery program. Very high electricity rates ($0.22–0.30/kWh) make RI solar excellent ROI. National Grid is the primary utility.',
    last_verified: '2025-05',
  },

  // ── SC: South Carolina Net Metering (Reduced Rate) ──────────────────────────────────────────────
  {
    program_id: 'sc_nem_sc',
    program_name: 'South Carolina Net Metering (Reduced Rate)',
    utility_ids: ['dominion_sc', 'duke_sc', 'aiken_ec_sc', 'berkeley_ec_sc', 'black_river_ec_sc', 'blue_ridge_ec_sc', 'broad_river_ec_sc', 'coastal_ec_sc', 'edisto_ec_sc', 'four_oaks_energy_sc', 'horry_ec_sc', 'laurens_ec_sc', 'little_river_ec_sc', 'lynches_river_ec_sc', 'mid_carolina_ec_sc', 'newberry_ec_sc', 'palmetto_ec_sc', 'pee_dee_ec_sc', 'santee_ec_sc', 'tri_county_ec_sc', 'york_ec_sc'],
    type: 'nem_special',
    status: 'active',
    program_description: 'South Carolina requires utilities to offer net metering but at reduced export rates — typically 2.2–6.5 cents/kWh depending on utility. Duke SC and Dominion SC export rates are below retail. Battery storage significantly improves economics.',
    export_rate_per_kwh: 0.05,
    tou_export_credit: false,
    enrollment_url: 'https://psc.sc.gov/',
    solar_pro_note: 'South Carolina export rates are BELOW retail (~2.2–6.5¢/kWh). Duke SC PowerPair battery rebate ($6,000–$9,000) is the key incentive. Battery storage is strongly recommended for SC solar to maximize self-consumption and earn PowerPair rebate.',
    last_verified: '2025-05',
  },

  // ── SD: South Dakota Net Metering (Full Retail) ──────────────────────────────────────────────
  {
    program_id: 'sd_nem_sd',
    program_name: 'South Dakota Net Metering (Full Retail)',
    utility_ids: ['xcel_energy_sd_sd', 'montana_dakota_utilities_sd', 'black_hills_energy_sd_sd', 'basin_electric_power_coop_sd', 'bon_homme_yankton_electric_association_sd', 'butte_ec_sd', 'central_ec_sd', 'cherry_todd_ec_sd', 'codington_clark_ec_sd', 'corn_belt_power_coop_sd', 'dakota_energy_coop_sd', 'east_river_electric_power_coop_sd', 'fem_electric_association_sd', 'grand_ec_sd', 'h_d_ec_sd', 'lacreek_electric_association_sd', 'lake_region_electric_association_sd', 'moreau_grand_ec_sd', 'northern_ec_sd', 'oahe_ec_sd', 'sioux_valley_energy_sd', 'southeastern_ec_sd', 'traverse_ec_sd', 'west_central_ec_sd', 'west_river_electric_association_sd'],
    type: 'nem_special',
    status: 'active',
    program_description: 'South Dakota mandates full retail net metering for residential systems ≤ 100 kW. Monthly rollover at retail rate. Annual excess paid at avoided-cost rate. Xcel SD, MDU, and co-ops must comply.',
    tou_export_credit: false,
    annual_export_cap_note: 'Annual excess at avoided cost',
    enrollment_url: 'https://puc.sd.gov/',
    solar_pro_note: 'South Dakota mandates retail NEM for residential ≤ 100 kW. Lower electricity rates ($0.10–0.12/kWh) but federal ITC + NEM still provides viable economics. Western SD has better solar resource.',
    last_verified: '2025-05',
  },

  // ── TN: Tennessee TVA Net Metering (LPC Programs Vary) ──────────────────────────────────────────────
  {
    program_id: 'tn_tva_nem_tn',
    program_name: 'Tennessee TVA Net Metering (LPC Programs Vary)',
    utility_ids: ['tva_tn', 'memphis_light_gas_water_tn', 'nashville_electric_service_tn', 'knoxville_utilities_board_tn', 'bristol_tennessee_essential_services_tn', 'appalachian_ec_tn', 'caney_fork_ec_tn', 'cumberland_emc_tn', 'duck_river_emc_tn', 'fayetteville_public_utilities_tn', 'forked_deer_ec_tn', 'gibson_emc_tn', 'holston_ec_tn', 'meriwether_lewis_ec_tn', 'middle_tennessee_emc_tn', 'mountain_ec_tn', 'pickwick_ec_tn', 'powell_clinch_utility_district_tn', 'sequachee_valley_ec_tn', 'southwest_tennessee_emc_tn', 'tri_county_emc_tn', 'upper_cumberland_emc_tn', 'volunteer_energy_coop_tn'],
    type: 'nem_special',
    status: 'active',
    program_description: 'Tennessee is primarily served by TVA through Local Power Companies (LPCs). TVA has no statewide NEM mandate — individual LPCs set their solar programs. Some LPCs offer retail NEM, others offer avoided-cost buyback (~3–5 cents/kWh). Research specific LPC program.',
    export_rate_per_kwh: 0.04,
    tou_export_credit: false,
    annual_export_cap_note: 'Varies by Local Power Company',
    enrollment_url: 'https://energyright.com/for-homes/solar/',
    solar_pro_note: 'TVA territory: NEM depends on your specific Local Power Company (LPC). Some LPCs (Nashville Electric, Knoxville Utilities, Memphis Light Gas & Water) offer favorable programs. Others offer only avoided cost. Research your specific LPC before sizing system. Battery recommended when LPC offers only avoided-cost buyback.',
    last_verified: '2025-05',
  },

  // ── TX: Texas — No Statewide NEM (Deregulated Market) ──────────────────────────────────────────────
  {
    program_id: 'tx_no_state_nem_tx',
    program_name: 'Texas — No Statewide NEM (Deregulated Market)',
    utility_ids: ['oncor_tx', 'centerpoint_tx', 'entergy_tx', 'aep_texas_tx', 'tnmp_tx', 'sharyland_tx', 'pedernales_ec_tx', 'bluebonnet_ec_tx', 'brazos_electric_power_coop_tx', 'bowie_cass_ec_tx', 'cap_rock_energy_tx', 'cherokee_county_ec_tx', 'coleman_county_ec_tx', 'concho_valley_ec_tx', 'coserv_electric_tx', 'deep_east_texas_ec_tx', 'denton_county_ec_tx', 'dickens_ec_tx', 'east_texas_ec_tx', 'farmers_ec_tx', 'grayson_collin_ec_tx', 'gulf_coast_ec_tx', 'guadalupe_valley_ec_tx', 'hamilton_county_ec_tx', 'heart_of_texas_ec_tx', 'houston_county_ec_tx', 'jasper_newton_ec_tx', 'karnes_ec_tx', 'lamar_county_ec_tx', 'lighthouse_ec_tx', 'lyntegar_ec_tx', 'mcculloch_ec_tx', 'mclennan_county_ec_tx', 'medina_ec_tx', 'mid_south_ec_tx', 'navarro_county_ec_tx', 'nueces_ec_tx', 'panola_harrison_ec_tx', 'peoples_ec_tx', 'rayburn_country_ec_tx', 'rio_grande_ec_tx', 'rusk_county_ec_tx', 'sam_houston_ec_tx', 'san_bernard_ec_tx', 'san_patricio_ec_tx', 'southwestern_electric_power_tx', 'swisher_ec_tx', 'taylor_ec_tx', 'tri_county_ec_tx', 'trinity_valley_ec_tx', 'united_cooperative_services_tx', 'victoria_ec_tx', 'wharton_county_ec_tx', 'wood_county_ec_tx'],
    type: 'nem_special',
    status: 'active',
    program_description: 'Texas does not have a statewide net metering mandate. The electricity market is deregulated — customers choose their Retail Electric Provider (REP) which sets solar buyback rates. Some REPs offer full retail buyback (Green Mountain Energy, Rhythm, Pulse Power); others offer avoided cost. TDSPs (Oncor, CenterPoint, AEP TX, TNMP) are just the wires.',
    tou_export_credit: false,
    annual_export_cap_note: 'Depends on chosen REP',
    enrollment_url: 'https://www.powertochoose.org',
    solar_pro_note: 'Texas solar buyback depends entirely on chosen REP. Solar-friendly REPs: Green Mountain Energy, Pulse Power, Rhythm Energy offer full retail or near-retail buyback. Non-solar-friendly REPs: low avoided-cost only. ADVISE CUSTOMERS to select a solar-friendly REP before solar install. Use powertochoose.org to compare REP plans.',
    last_verified: '2025-05',
  },

  // ── UT: Utah Net Metering (Full Retail) ──────────────────────────────────────────────
  {
    program_id: 'ut_nem_ut',
    program_name: 'Utah Net Metering (Full Retail)',
    utility_ids: ['rockmtn_power_ut', 'dixie_power_ut', 'bridgerland_electric_ut', 'carbon_power_light_ut', 'flowell_electric_association_ut', 'garkane_energy_coop_ut', 'moon_lake_electric_association_ut', 'mt_wheeler_power_ut', 'provo_city_power_ut', 'spanish_fork_power_ut', 'st_george_city_power_ut', 'strawberry_electric_service_district_ut', 'utah_associated_municipal_power_systems_ut', 'uintah_basin_electric_association_ut'],
    type: 'nem_special',
    status: 'active',
    program_description: 'Utah mandates full retail net metering for residential systems ≤ 25 kW. Monthly rollover at retail rate. Annual excess paid at avoided-cost rate. Rocky Mountain Power must comply. Utah solar rebates through RMP available.',
    tou_export_credit: false,
    annual_export_cap_note: 'Annual excess at avoided cost',
    enrollment_url: 'https://psc.utah.gov/',
    solar_pro_note: 'Utah mandates retail NEM for residential ≤ 25 kW. Rocky Mountain Power (PacifiCorp) is dominant utility. Good solar resource in southern UT (5.5–6 peak sun hrs). Federal ITC + NEM = solid ROI.',
    last_verified: '2025-05',
  },

  // ── VA: Virginia Net Metering (Full Retail) ──────────────────────────────────────────────
  {
    program_id: 'va_nem_va',
    program_name: 'Virginia Net Metering (Full Retail)',
    utility_ids: ['dominion_va', 'appalachian_power_va', 'rappahannock_electric_va', 'a_n_ec_va', 'barc_ec_va', 'central_virginia_ec_va', 'community_ec_va', 'craig_botetourt_ec_va', 'mecklenburg_ec_va', 'new_peoples_bank_va', 'northern_neck_ec_va', 'northern_virginia_ec_va', 'powell_river_ec_va', 'prince_george_ec_va', 'shenandoah_valley_ec_va', 'southside_ec_va', 'virginia_ec_va'],
    type: 'nem_special',
    status: 'active',
    program_description: 'Virginia mandates full retail net metering for residential systems ≤ 20 kW. Monthly rollover at retail rate. Annual excess paid at avoided-cost rate. Dominion Energy VA and Appalachian Power must comply.',
    tou_export_credit: false,
    annual_export_cap_note: 'Annual excess at avoided cost; 20 kW residential cap',
    enrollment_url: 'https://www.scc.virginia.gov/',
    solar_pro_note: 'Virginia mandates retail NEM for residential ≤ 20 kW. Dominion VA and Appalachian Power required to comply. VA co-ops also must honor NEM. Virginia Clean Economy Act (VCEA) is driving rapid solar adoption. Good medium-term policy stability.',
    last_verified: '2025-05',
  },

  // ── VT: Vermont Net Metering (Full Retail) ──────────────────────────────────────────────
  {
    program_id: 'vt_nem_vt',
    program_name: 'Vermont Net Metering (Full Retail)',
    utility_ids: ['green_mountain_vt', 'burlington_electric_vt', 'vermont_ec_vt', 'washington_ec_vt', 'village_of_hyde_park_electric_vt', 'village_of_johnson_electric_vt', 'village_of_ludlow_electric_vt', 'village_of_morrisville_wl_vt', 'village_of_northfield_electric_vt', 'village_of_readsboro_electric_vt', 'village_of_stowe_electric_vt'],
    type: 'nem_special',
    status: 'active',
    program_description: 'Vermont mandates full retail net metering for residential systems ≤ 15 kW (up to 500 kW under Group Net Metering). Monthly rollover at retail rate. Annual excess paid at avoided-cost rate. GMP BYOD battery program pays $850+/year.',
    tou_export_credit: false,
    annual_export_cap_note: 'Annual excess at avoided cost',
    enrollment_url: 'https://publicservice.vermont.gov/topics/energy_generation/net-metering',
    solar_pro_note: 'Vermont full retail NEM + GMP BYOD battery ($850+/year) + 30% ITC. GMP actively promotes solar+battery — one of the most innovative utility battery programs in the US. All VT utilities must honor NEM.',
    last_verified: '2025-05',
  },

  // ── WA: Washington Net Metering (Full Retail) ──────────────────────────────────────────────
  {
    program_id: 'wa_nem_wa',
    program_name: 'Washington Net Metering (Full Retail)',
    utility_ids: ['puget_sound_wa', 'pacificorp_wa', 'seattle_city_light_wa', 'avista_wa', 'benton_pud_wa', 'chelan_county_pud_wa', 'clark_pud_wa', 'clallam_county_pud_wa', 'columbia_rea_wa', 'cowiche_valley_ec_wa', 'douglas_county_pud_wa', 'ferry_county_pud_wa', 'franklin_pud_wa', 'grant_county_pud_wa', 'grays_harbor_pud_wa', 'inland_power_light_wa', 'jefferson_county_pud_wa', 'kittitas_county_pud_wa', 'klickitat_pud_wa', 'lewis_county_pud_wa', 'lincoln_ec_wa', 'mason_county_pud_1_wa', 'mason_county_pud_3_wa', 'nespelem_valley_ec_wa', 'okanogan_county_pud_wa', 'pacific_county_pud_wa', 'peninsula_light_company_wa', 'puget_sound_coop_wa', 'raft_river_rural_ec_wa', 'skamania_county_pud_wa', 'snohomish_county_pud_wa', 'tanner_ec_wa', 'wahkiakum_county_pud_wa', 'whatcom_county_pud_wa', 'yakima_county_ec_wa'],
    type: 'nem_special',
    status: 'active',
    program_description: 'Washington mandates full retail net metering for residential systems ≤ 100 kW. All utilities must comply. Monthly rollover at retail rate. Annual excess paid at avoided-cost rate. WA sales tax exemption on solar equipment.',
    tou_export_credit: false,
    annual_export_cap_note: 'Annual excess at avoided cost',
    enrollment_url: 'https://www.commerce.wa.gov/growing-the-economy/energy/energy-policy/',
    solar_pro_note: 'Washington mandates full retail NEM (1:1) up to 100 kW. ALL utilities (PSE, Seattle City Light, PUDs, co-ops) must comply. WA sales tax exemption saves 8–10% on system cost. Strong incentive state.',
    last_verified: '2025-05',
  },

  // ── WI: Wisconsin Net Metering (Full Retail) ──────────────────────────────────────────────
  {
    program_id: 'wi_nem_wi',
    program_name: 'Wisconsin Net Metering (Full Retail)',
    utility_ids: ['we_energies_wi', 'alliant_wi', 'madison_gas_electric_wi', 'dairyland_power_coop_wi', 'adams_columbia_ec_wi', 'barron_ec_wi', 'bayfield_ec_wi', 'buffalo_jackson_ec_wi', 'clark_ec_wi', 'dunn_energy_coop_wi', 'eau_claire_energy_coop_wi', 'jump_river_ec_wi', 'kickapoo_valley_ec_wi', 'lakelands_ec_wi', 'oakdale_ec_wi', 'polk_burnett_ec_wi', 'price_ec_wi', 'richland_ec_wi', 'rock_energy_coop_wi', 'scenic_rivers_energy_coop_wi', 'taylor_ec_wi', 'tri_county_ec_wi', 'vernon_ec_wi', 'viroqua_ec_wi', 'westby_cooperative_electric_association_wi', 'wood_county_ec_wi'],
    type: 'nem_special',
    status: 'active',
    program_description: 'Wisconsin mandates full retail net metering for residential systems ≤ 20 kW. Monthly rollover at retail rate. Annual excess paid at avoided-cost rate. We Energies, MGE, Alliant, and co-ops must comply.',
    tou_export_credit: false,
    annual_export_cap_note: 'Annual excess at avoided cost; 20 kW cap',
    enrollment_url: 'https://psc.wi.gov/',
    solar_pro_note: 'Wisconsin mandates retail NEM for residential ≤ 20 kW. We Energies, MGE, Alliant must comply. Wisconsin co-ops also required. Good solar state with reasonable payback periods (8–10 years).',
    last_verified: '2025-05',
  },

  // ── WV: West Virginia Net Metering (Full Retail) ──────────────────────────────────────────────
  {
    program_id: 'wv_nem_wv',
    program_name: 'West Virginia Net Metering (Full Retail)',
    utility_ids: ['mon_power_wv', 'potomac_edison_wv', 'appalachian_power_wv', 'monongalia_power_wv', 'wheeling_power_wv', 'pocahontas_county_public_service_district_wv', 'greenbrier_valley_ec_wv', 'harrison_rural_electrification_association_wv', 'mountaineer_gas_wv', 'pendleton_community_bank_wv', 'pocahontas_county_psd_wv', 'randolph_macon_ec_wv', 'shenandoah_valley_ec_wv', 'upshur_rural_ec_wv', 'wayne_county_psd_wv', 'wirt_county_psd_wv'],
    type: 'nem_special',
    status: 'active',
    program_description: 'West Virginia mandates full retail net metering for residential systems ≤ 25 kW. Monthly rollover at retail rate. Annual excess paid at avoided-cost rate. Mon Power, Appalachian Power, and co-ops must comply.',
    tou_export_credit: false,
    annual_export_cap_note: 'Annual excess at avoided cost',
    enrollment_url: 'https://psc.wv.gov/',
    solar_pro_note: 'West Virginia mandates retail NEM for residential ≤ 25 kW. Mon Power (FirstEnergy), Appalachian Power, and WV co-ops must comply. Lower electricity rates but federal ITC + NEM makes solar viable.',
    last_verified: '2025-05',
  },

  // ── WY: Wyoming Net Metering (Full Retail) ──────────────────────────────────────────────
  {
    program_id: 'wy_nem_wy',
    program_name: 'Wyoming Net Metering (Full Retail)',
    utility_ids: ['pacificorp_wy', 'black_hills_energy_wy_wy', 'bridger_valley_electric_association_wy', 'carbon_power_light_wy', 'high_west_energy_wy', 'highline_electric_association_wy', 'lower_valley_energy_wy', 'niobrara_electric_association_wy', 'powder_river_energy_corp_wy', 'tri_county_electric_association_wy', 'wheatland_rural_electric_association_wy', 'wyrulec_company_wy'],
    type: 'nem_special',
    status: 'active',
    program_description: 'Wyoming mandates full retail net metering for residential systems ≤ 25 kW. Monthly rollover. Annual excess at avoided cost. Rocky Mountain Power (PacifiCorp) and co-ops must comply.',
    tou_export_credit: false,
    annual_export_cap_note: 'Annual excess at avoided cost',
    enrollment_url: 'https://psc.wyo.gov/',
    solar_pro_note: 'Wyoming mandates retail NEM for residential ≤ 25 kW. Rocky Mountain Power (PacifiCorp) serves most of WY. Good solar resource in southern WY. Federal ITC + NEM = viable solar economics.',
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
