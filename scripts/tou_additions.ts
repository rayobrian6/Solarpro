
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