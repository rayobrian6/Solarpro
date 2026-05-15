
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