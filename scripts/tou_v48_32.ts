// v48.32 TOU Rate Plan Additions — Major IOUs and Large Utilities Not Yet Covered
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

