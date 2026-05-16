// v48.32 Solar Rebate Program Additions
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

