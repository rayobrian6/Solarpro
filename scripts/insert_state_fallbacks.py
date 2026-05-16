#!/usr/bin/env python3
"""Insert STATE_ICA_FALLBACKS block into utilityInterconnection.ts at line 3053."""

import sys

INSERT_AFTER_LINE = 3052  # 1-based: insert after the closing ]; of INTERCONNECTION_PROFILES

STATE_ICA_BLOCK = '''
// ─── State-Level ICA Fallbacks (Tier 2) ──────────────────────────────────────
// Used when a utility_id does NOT match a Tier-1 InterconnectionProfile.
// Covers co-ops, munis, and smaller IOUs that follow the state PUC process.

export interface StateIcaFallback {
  state: string;                      // 2-letter code
  state_name: string;
  regulatory_body: string;
  rules_url: string;
  dsire_url: string;
  typical_ica_days_min: number;
  typical_ica_days_max: number;
  typical_pto_days_min: number;
  typical_pto_days_max: number;
  nem_type: 'full_retail' | 'net_billing' | 'avoided_cost' | 'varies' | 'none';
  nem_summary: string;
  generic_steps: string[];
  solar_pro_note: string;
  last_verified: string;
}

export const STATE_ICA_FALLBACKS: StateIcaFallback[] = [

  // ── Alabama ──────────────────────────────────────────────────────────────
  {
    state: 'AL',
    state_name: 'Alabama',
    regulatory_body: 'Alabama Public Service Commission (APSC)',
    rules_url: 'https://www.psc.alabama.gov/Commission/orders/2012/U-3826.pdf',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=AL',
    typical_ica_days_min: 30,
    typical_ica_days_max: 60,
    typical_pto_days_min: 5,
    typical_pto_days_max: 20,
    nem_type: 'avoided_cost',
    nem_summary: 'Alabama utilities credit excess generation at avoided-cost rate (wholesale), not retail. Most customers see minimal bill credit for exports.',
    generic_steps: [
      'Submit interconnection application with SLD and equipment specs to local utility',
      'Pay application fee (typically $50–$200 for residential)',
      'Utility reviews for technical feasibility (up to 30 business days)',
      'Execute interconnection agreement',
      'Install system and pass local electrical inspection',
      'Utility installs bi-directional meter',
      'Receive Permission to Operate (PTO)',
    ],
    solar_pro_note: 'Alabama has minimal solar-friendly policy. Large IOUs (Alabama Power) have their own process; rural co-ops use APSC guidelines. Expect avoided-cost compensation — ROI is typically 14–20 years without incentives.',
    last_verified: '2025-06',
  },

  // ── Arkansas ─────────────────────────────────────────────────────────────
  {
    state: 'AR',
    state_name: 'Arkansas',
    regulatory_body: 'Arkansas Public Service Commission (APSC)',
    rules_url: 'https://www.apscservices.info/PDF/11/11-027-R_323_1.pdf',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=AR',
    typical_ica_days_min: 20,
    typical_ica_days_max: 45,
    typical_pto_days_min: 5,
    typical_pto_days_max: 15,
    nem_type: 'full_retail',
    nem_summary: 'Arkansas NEM provides full retail credit for net exports up to system size that offsets annual consumption. Excess credits roll over monthly; true-up annually at avoided cost.',
    generic_steps: [
      'Submit interconnection application with SLD to utility',
      'Pay application fee',
      'Utility completes technical review (15–30 business days)',
      'Execute interconnection and NEM agreement',
      'Pass local electrical inspection',
      'Utility installs bi-directional meter',
      'PTO granted',
    ],
    solar_pro_note: 'Arkansas has mandatory NEM for IOUs and most co-ops. Entergy Arkansas and OG&E have their own portals. Co-ops follow APSC Docket 11-027-R. Competitive solar market with moderate incentives.',
    last_verified: '2025-06',
  },

  // ── Arizona ───────────────────────────────────────────────────────────────
  {
    state: 'AZ',
    state_name: 'Arizona',
    regulatory_body: 'Arizona Corporation Commission (ACC)',
    rules_url: 'https://www.azcc.gov/utilities/electric/net-metering',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=AZ',
    typical_ica_days_min: 15,
    typical_ica_days_max: 45,
    typical_pto_days_min: 5,
    typical_pto_days_max: 10,
    nem_type: 'net_billing',
    nem_summary: 'Arizona moved to Net Billing (Resource Comparison Proxy) for new customers. Exports credited at avoided-cost-based RCP rate (~$0.075/kWh in 2024), lower than retail. Legacy NEM 1.0/2.0 grandfathered.',
    generic_steps: [
      'Submit application via utility online portal or paper form with SLD',
      'Pay application fee (APS ~$100, TEP ~$50)',
      'Utility performs 15-day simplified review (systems ≤10 kW AC)',
      'Execute net billing agreement',
      'Pass local/AHJ electrical inspection',
      'Utility installs bi-directional meter within 10 business days',
      'Activate system after meter confirmation',
    ],
    solar_pro_note: 'APS, TEP, and UNS Energy each have their own interconnection portals. Small AZ co-ops follow ACC rules. Net billing RCP rate is utility-specific — confirm current rate before sizing for export. Battery storage strongly recommended under net billing.',
    last_verified: '2025-06',
  },

  // ── California ────────────────────────────────────────────────────────────
  {
    state: 'CA',
    state_name: 'California',
    regulatory_body: 'California Public Utilities Commission (CPUC)',
    rules_url: 'https://www.cpuc.ca.gov/industries-and-topics/electrical-energy/demand-side-management/net-energy-metering',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=CA',
    typical_ica_days_min: 10,
    typical_ica_days_max: 30,
    typical_pto_days_min: 3,
    typical_pto_days_max: 10,
    nem_type: 'net_billing',
    nem_summary: 'California NEM 3.0 (Net Billing Tariff, NBT) effective April 2023 for new customers: exports credited at Avoided Cost Calculator (ACC) rate, significantly below retail. PG&E/SCE/SDG&E all on NBT. Legacy NEM 1.0/2.0 grandfathered 20 years from enrollment.',
    generic_steps: [
      'Submit online application via utility portal (PG&E, SCE, or SDG&E)',
      'Upload SLD, equipment list, and permit',
      'Utility reviews (10 business days for simple systems)',
      'Conditional Permission to Install (CPTI) issued',
      'Pass local building inspection and get final permit',
      'Submit final documentation to utility',
      'Utility conducts final inspection if needed',
      'Permission to Operate (PTO) issued',
    ],
    solar_pro_note: 'For non-IOU customers (LADWP, SMUD, PacifiCorp, smaller munis), use their specific profile if available. Under NBT, self-consumption maximization and battery storage are critical for economics. CSI/SGIP incentives available for storage.',
    last_verified: '2025-06',
  },

  // ── Colorado ──────────────────────────────────────────────────────────────
  {
    state: 'CO',
    state_name: 'Colorado',
    regulatory_body: 'Colorado Public Utilities Commission (CPUC-CO)',
    rules_url: 'https://puc.colorado.gov/electric/rates-and-tariffs/net-metering',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=CO',
    typical_ica_days_min: 15,
    typical_ica_days_max: 45,
    typical_pto_days_min: 5,
    typical_pto_days_max: 15,
    nem_type: 'full_retail',
    nem_summary: 'Colorado NEM provides full retail credit for net exports. Monthly rollover of credits; any remaining credits at year-end paid at avoided cost. System size limited to 120% of annual consumption.',
    generic_steps: [
      'Submit interconnection application with SLD to utility (Xcel, Black Hills, or co-op)',
      'Pay application fee',
      'Utility performs technical review (15–30 business days)',
      'Execute interconnection and net metering agreement',
      'Pass county/city electrical inspection',
      'Utility installs net meter',
      'PTO issued',
    ],
    solar_pro_note: 'Xcel Energy (CO) has its own process (covered under Tier-1 profile). Black Hills Energy and rural co-ops use CPUC-CO rules. Colorado has strong solar market with Xcel rebates and CORE rebates for co-op customers.',
    last_verified: '2025-06',
  },

  // ── Connecticut ───────────────────────────────────────────────────────────
  {
    state: 'CT',
    state_name: 'Connecticut',
    regulatory_body: 'Public Utilities Regulatory Authority (PURA)',
    rules_url: 'https://portal.ct.gov/PURA/Electric/Solar-Distributed-Generation',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=CT',
    typical_ica_days_min: 15,
    typical_ica_days_max: 30,
    typical_pto_days_min: 5,
    typical_pto_days_max: 10,
    nem_type: 'net_billing',
    nem_summary: 'Connecticut uses NEM with credits at retail rate for net exports. Systems up to 2 MW eligible. PURA oversees Eversource CT and UI (United Illuminating). Excess credits paid at avoided cost at year-end.',
    generic_steps: [
      'Submit application via utility portal (Eversource CT or UI)',
      'Upload SLD and equipment specs',
      'Utility reviews (15 business days for residential)',
      'Execute interconnection agreement',
      'Pass local electrical inspection',
      'Utility installs bi-directional meter',
      'PTO granted',
    ],
    solar_pro_note: 'Connecticut has one of the strongest solar programs: PURA ZREC/LREC programs, Eversource and UI net metering, plus CTGREENBANK incentives. Eversource CT has its own Tier-1 profile. UI (United Illuminating/Avangrid) follows PURA rules.',
    last_verified: '2025-06',
  },

  // ── Washington DC ─────────────────────────────────────────────────────────
  {
    state: 'DC',
    state_name: 'District of Columbia',
    regulatory_body: 'DC Public Service Commission (DC PSC)',
    rules_url: 'https://dcpsc.org/Consumers/Renewable-Energy.aspx',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=DC',
    typical_ica_days_min: 15,
    typical_ica_days_max: 30,
    typical_pto_days_min: 5,
    typical_pto_days_max: 10,
    nem_type: 'full_retail',
    nem_summary: 'DC NEM provides full retail credit for net exports. Pepco (Exelon) is the sole IOU serving DC. Monthly rollover; year-end excess paid at avoided cost. Community solar (virtual net metering) also available.',
    generic_steps: [
      'Submit application to Pepco (Exelon) via online portal',
      'Upload SLD and equipment documentation',
      'Pepco technical review (15 business days)',
      'Execute interconnection agreement',
      'Pass DC DCRA electrical inspection',
      'Pepco installs bi-directional meter',
      'PTO issued',
    ],
    solar_pro_note: 'DC has strong SREC market (DC SREC prices historically $300–$450/SREC). Solar installations are space-constrained (dense urban). DOEE Solar for All program for low-income households. Pepco processes are efficient for residential.',
    last_verified: '2025-06',
  },

  // ── Delaware ──────────────────────────────────────────────────────────────
  {
    state: 'DE',
    state_name: 'Delaware',
    regulatory_body: 'Delaware Public Service Commission (DPSC)',
    rules_url: 'https://depsc.delaware.gov/electric-utilities/',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=DE',
    typical_ica_days_min: 15,
    typical_ica_days_max: 30,
    typical_pto_days_min: 5,
    typical_pto_days_max: 10,
    nem_type: 'full_retail',
    nem_summary: 'Delaware NEM provides full retail credit for net exports up to system size. Delmarva Power (Exelon) and Delaware Electric Cooperative serve most of DE. Monthly rollover; year-end true-up at avoided cost.',
    generic_steps: [
      'Submit application to Delmarva Power or co-op',
      'Upload SLD and equipment specs',
      'Utility technical review (15 business days)',
      'Execute net metering agreement',
      'Pass local electrical inspection',
      'Utility installs bi-directional meter',
      'PTO granted',
    ],
    solar_pro_note: 'Delaware Green Energy Fund and SREC market available. Delmarva Power (Exelon/BGE parent) process is similar to Maryland. Small state — most systems are residential rooftop under 25 kW.',
    last_verified: '2025-06',
  },

  // ── Florida ───────────────────────────────────────────────────────────────
  {
    state: 'FL',
    state_name: 'Florida',
    regulatory_body: 'Florida Public Service Commission (FPSC)',
    rules_url: 'https://www.floridapsc.com/industry/electric/solar',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=FL',
    typical_ica_days_min: 10,
    typical_ica_days_max: 30,
    typical_pto_days_min: 5,
    typical_pto_days_max: 10,
    nem_type: 'full_retail',
    nem_summary: 'Florida NEM provides full retail credit for net exports. FPL, Duke FL, Tampa Electric, Gulf Power (now Duke), and OUC each have their own processes. Monthly rollover; true-up annually at avoided cost for surplus.',
    generic_steps: [
      'Submit application via utility portal (FPL, Duke FL, TECO, or JEA)',
      'Upload SLD and equipment specs',
      'Utility reviews (10–20 business days)',
      'Execute interconnection agreement',
      'Pass county electrical inspection',
      'Utility installs bi-directional meter',
      'PTO issued',
    ],
    solar_pro_note: 'Florida is top-3 solar market nationally. FPL, TECO, and JEA have Tier-1 profiles. Rural co-ops (Gulf Coast, Peace River, etc.) follow FPSC Chapter 25-6.065 rules. No state income tax on solar incentives — ITC is key incentive.',
    last_verified: '2025-06',
  },

  // ── Georgia ───────────────────────────────────────────────────────────────
  {
    state: 'GA',
    state_name: 'Georgia',
    regulatory_body: 'Georgia Public Service Commission (GPSC)',
    rules_url: 'https://psc.ga.gov/utilities/electric/solar-program/',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=GA',
    typical_ica_days_min: 20,
    typical_ica_days_max: 45,
    typical_pto_days_min: 5,
    typical_pto_days_max: 15,
    nem_type: 'avoided_cost',
    nem_summary: 'Georgia does not have mandatory NEM. Georgia Power (Southern Company) uses a "Buy All/Sell All" or avoided-cost compensation model for most customers. EMCs (co-ops) have their own policies, often avoided cost.',
    generic_steps: [
      'Submit interconnection application to Georgia Power or local EMC',
      'Upload SLD and equipment documentation',
      'Utility technical review (20–30 business days)',
      'Execute interconnection agreement',
      'Pass local building/electrical inspection',
      'Utility installs appropriate meter',
      'PTO granted',
    ],
    solar_pro_note: 'Georgia Power\'s Advanced Solar Initiative and Commercial rooftop rates apply. EMCs (Jackson EMC, Walton EMC, etc.) have varying policies. No mandatory retail NEM — self-consumption maximization is key. ITC is primary incentive.',
    last_verified: '2025-06',
  },

  // ── Hawaii ────────────────────────────────────────────────────────────────
  {
    state: 'HI',
    state_name: 'Hawaii',
    regulatory_body: 'Hawaii Public Utilities Commission (HPUC)',
    rules_url: 'https://puc.hawaii.gov/energy/distributed-generation/',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=HI',
    typical_ica_days_min: 15,
    typical_ica_days_max: 60,
    typical_pto_days_min: 5,
    typical_pto_days_max: 15,
    nem_type: 'net_billing',
    nem_summary: 'Hawaii ended NEM in 2015. Current tariffs: Customer Grid Supply (CGS/CGS+) at avoided cost (~$0.09–0.18/kWh), Customer Self Supply (CSS) for battery-coupled systems with no grid export. Smart Export tariffs vary by island.',
    generic_steps: [
      'Submit application via Hawaiian Electric (HECO/MECO/HELCO) online portal',
      'Upload SLD, equipment specs, and shading analysis',
      'Hawaiian Electric reviews (15–45 business days; longer on neighbor islands)',
      'Receive Conditional Permission to Install',
      'Pass county electrical inspection',
      'Submit as-built drawings',
      'Final meter set and PTO',
    ],
    solar_pro_note: 'Hawaiian Electric has a Tier-1 profile. Co-ops do not exist in Hawaii. All Hawaiian Electric companies (HECO, MECO, HELCO) follow HPUC rules. Battery storage is strongly recommended given CGS export rates. High electricity rates ($0.38–0.44/kWh) make self-consumption extremely valuable.',
    last_verified: '2025-06',
  },

  // ── Iowa ──────────────────────────────────────────────────────────────────
  {
    state: 'IA',
    state_name: 'Iowa',
    regulatory_body: 'Iowa Utilities Board (IUB)',
    rules_url: 'https://iub.iowa.gov/regulated-utilities/electric/net-metering',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=IA',
    typical_ica_days_min: 20,
    typical_ica_days_max: 45,
    typical_pto_days_min: 5,
    typical_pto_days_max: 15,
    nem_type: 'full_retail',
    nem_summary: 'Iowa NEM provides full retail credit for net exports for systems up to 500 kW. Monthly rollover; annual true-up at avoided cost for surplus. MidAmerican Energy and Alliant Energy (IPL) are the main IOUs.',
    generic_steps: [
      'Submit interconnection application to MidAmerican, Alliant, or co-op',
      'Upload SLD and equipment list',
      'Utility technical review (20–30 business days)',
      'Execute net metering agreement',
      'Pass local electrical inspection',
      'Utility installs bi-directional meter',
      'PTO granted',
    ],
    solar_pro_note: 'MidAmerican Energy has a Tier-1 profile. Alliant Energy (IPL) and rural co-ops follow IUB rules. Iowa has no state income tax credit for solar but has strong federal ITC. Wind is dominant but solar growing rapidly.',
    last_verified: '2025-06',
  },

  // ── Idaho ─────────────────────────────────────────────────────────────────
  {
    state: 'ID',
    state_name: 'Idaho',
    regulatory_body: 'Idaho Public Utilities Commission (IPUC)',
    rules_url: 'https://puc.idaho.gov/electricity/solar-power/',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=ID',
    typical_ica_days_min: 20,
    typical_ica_days_max: 45,
    typical_pto_days_min: 5,
    typical_pto_days_max: 15,
    nem_type: 'full_retail',
    nem_summary: 'Idaho NEM provides full retail credit for net exports up to 25 kW (residential). Idaho Power, Rocky Mountain Power (PacifiCorp), and Avista each have IPUC-approved tariffs. Monthly rollover; year-end excess at avoided cost.',
    generic_steps: [
      'Submit application to Idaho Power, Rocky Mountain Power, or Avista',
      'Upload SLD and equipment specs',
      'Utility technical review (20–30 business days)',
      'Execute NEM agreement',
      'Pass local electrical inspection',
      'Utility installs net meter',
      'PTO issued',
    ],
    solar_pro_note: 'Idaho Power, Rocky Mountain Power ID, and Avista ID have Tier-1 profiles. Co-ops follow IPUC rules. Low electricity rates ($0.09–0.11/kWh) mean longer payback periods. High solar irradiance in southern Idaho partially offsets low rates.',
    last_verified: '2025-06',
  },

  // ── Illinois ──────────────────────────────────────────────────────────────
  {
    state: 'IL',
    state_name: 'Illinois',
    regulatory_body: 'Illinois Commerce Commission (ICC)',
    rules_url: 'https://www.icc.illinois.gov/electricity/net-metering',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=IL',
    typical_ica_days_min: 15,
    typical_ica_days_max: 30,
    typical_pto_days_min: 5,
    typical_pto_days_max: 10,
    nem_type: 'full_retail',
    nem_summary: 'Illinois NEM provides full retail credit for net exports for ComEd and Ameren customers. Monthly rollover; annual true-up at avoided cost. Illinois Shines (SREC program) provides additional incentives via Adjustable Block Program (ABP).',
    generic_steps: [
      'Submit application via ComEd or Ameren IL online portal',
      'Upload SLD and equipment list',
      'Utility reviews (15 business days for residential)',
      'Execute interconnection and NEM agreement',
      'Pass local/AHJ electrical inspection',
      'Utility installs bi-directional meter',
      'PTO issued; register for Illinois Shines ABP separately',
    ],
    solar_pro_note: 'Illinois Shines (Adjustable Block Program) provides front-loaded SREC payments (REC payments over 15 years, paid upfront by IPA). This significantly improves solar economics. ComEd territory (northern IL) has slightly better interconnection process than Ameren.',
    last_verified: '2025-06',
  },

  // ── Indiana ───────────────────────────────────────────────────────────────
  {
    state: 'IN',
    state_name: 'Indiana',
    regulatory_body: 'Indiana Utility Regulatory Commission (IURC)',
    rules_url: 'https://www.in.gov/iurc/electric-utility/solar/',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=IN',
    typical_ica_days_min: 20,
    typical_ica_days_max: 45,
    typical_pto_days_min: 5,
    typical_pto_days_max: 15,
    nem_type: 'net_billing',
    nem_summary: 'Indiana replaced full retail NEM with net metering that transitions to avoided-cost compensation after 2022 for new customers. Duke Energy Indiana, AES Indiana, and NIPSCO follow IURC rules. Monthly credits; true-up annually.',
    generic_steps: [
      'Submit interconnection application to Duke Energy IN, AES Indiana, or NIPSCO',
      'Upload SLD and equipment specs',
      'Utility technical review (20–30 business days)',
      'Execute interconnection agreement',
      'Pass local electrical inspection',
      'Utility installs bi-directional meter',
      'PTO issued',
    ],
    solar_pro_note: 'NIPSCO has a Tier-1 profile. Indiana solar economics weakened after NEM reform — self-consumption and battery storage important. Federal ITC is primary incentive. Duke Energy IN and AES Indiana customers should confirm current export rate before sizing.',
    last_verified: '2025-06',
  },

  // ── Kansas ────────────────────────────────────────────────────────────────
  {
    state: 'KS',
    state_name: 'Kansas',
    regulatory_body: 'Kansas Corporation Commission (KCC)',
    rules_url: 'https://kcc.ks.gov/electric-utility/net-metering',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=KS',
    typical_ica_days_min: 20,
    typical_ica_days_max: 45,
    typical_pto_days_min: 5,
    typical_pto_days_max: 15,
    nem_type: 'full_retail',
    nem_summary: 'Kansas NEM provides full retail credit for net exports for Evergy and other regulated IOUs. Monthly rollover; true-up annually at avoided cost. System size limited to 150% of annual load.',
    generic_steps: [
      'Submit application to Evergy or local co-op',
      'Upload SLD and equipment documentation',
      'Utility technical review (20–30 business days)',
      'Execute NEM agreement',
      'Pass local electrical inspection',
      'Utility installs net meter',
      'PTO granted',
    ],
    solar_pro_note: 'Evergy KS has a Tier-1 profile. Smaller co-ops (Wheatland Electric, Victory Electric, etc.) follow KCC rules. Kansas has abundant solar resource but low retail rates (~$0.11/kWh) mean longer payback. No state solar tax credit.',
    last_verified: '2025-06',
  },

  // ── Kentucky ──────────────────────────────────────────────────────────────
  {
    state: 'KY',
    state_name: 'Kentucky',
    regulatory_body: 'Kentucky Public Service Commission (KPSC)',
    rules_url: 'https://psc.ky.gov/Home/Industry?id=1',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=KY',
    typical_ica_days_min: 20,
    typical_ica_days_max: 45,
    typical_pto_days_min: 5,
    typical_pto_days_max: 15,
    nem_type: 'full_retail',
    nem_summary: 'Kentucky NEM provides full retail credit for LG&E/KU customers (E.ON). Rural co-ops (Jackson Energy, Salt River RECC, etc.) have varying policies. Monthly rollover; excess annually at avoided cost.',
    generic_steps: [
      'Submit application to LG&E/KU or local RECC co-op',
      'Upload SLD and equipment specs',
      'Utility technical review (20–30 business days)',
      'Execute interconnection and NEM agreement',
      'Pass local electrical inspection',
      'Utility installs bi-directional meter',
      'PTO issued',
    ],
    solar_pro_note: 'LG&E/KU has a Tier-1 profile. Kentucky RECCs (Rural Electric Cooperative Corporations) cover ~60% of the state\'s land area. Co-op policies vary significantly — confirm export rate and meter policy before installation. Low electricity rates mean solar payback is 14–20 years without incentives.',
    last_verified: '2025-06',
  },

  // ── Louisiana ─────────────────────────────────────────────────────────────
  {
    state: 'LA',
    state_name: 'Louisiana',
    regulatory_body: 'Louisiana Public Service Commission (LPSC)',
    rules_url: 'https://lpsc.louisiana.gov/electric',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=LA',
    typical_ica_days_min: 20,
    typical_ica_days_max: 45,
    typical_pto_days_min: 5,
    typical_pto_days_max: 15,
    nem_type: 'full_retail',
    nem_summary: 'Louisiana NEM provides full retail credit for Entergy Louisiana, Cleco, and SWEPCO customers. Monthly rollover; true-up annually. Entergy TX handles East TX border areas; Entergy LA covers most of state.',
    generic_steps: [
      'Submit application to Entergy Louisiana, Cleco, or SWEPCO',
      'Upload SLD and equipment list',
      'Utility technical review (20–30 business days)',
      'Execute NEM agreement',
      'Pass local electrical inspection',
      'Utility installs net meter',
      'PTO granted',
    ],
    solar_pro_note: 'Louisiana has a state solar income tax credit (50% of cost, up to $12,500) in addition to federal ITC. High humidity and heat slightly reduce solar output vs. industry averages. Hurricane-resistant racking required by state code.',
    last_verified: '2025-06',
  },

  // ── Massachusetts ─────────────────────────────────────────────────────────
  {
    state: 'MA',
    state_name: 'Massachusetts',
    regulatory_body: 'Department of Public Utilities (DPU)',
    rules_url: 'https://www.mass.gov/info-details/solar-energy-in-massachusetts',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=MA',
    typical_ica_days_min: 15,
    typical_ica_days_max: 30,
    typical_pto_days_min: 5,
    typical_pto_days_max: 10,
    nem_type: 'full_retail',
    nem_summary: 'Massachusetts NEM provides full retail credit for net exports. Eversource MA, National Grid MA, and Unitil are main IOUs. Monthly rollover; excess paid at wholesale at year-end. SMART program (Solar Massachusetts Renewable Target) provides additional incentive.',
    generic_steps: [
      'Submit application via utility portal (Eversource MA, National Grid, or Unitil)',
      'Upload SLD and equipment specs',
      'Utility reviews (15 business days for residential)',
      'Execute interconnection and NEM agreement',
      'Pass local electrical inspection (Title V if septic nearby)',
      'Utility installs bi-directional meter',
      'PTO issued; register for SMART program separately if applicable',
    ],
    solar_pro_note: 'Massachusetts SMART program provides monthly adder payments per kWh generated (declining block program). Combined with NEM + federal ITC, MA has excellent solar economics despite moderate irradiance. Eversource MA and Eversource NH share parent but have separate DPU/PUC processes.',
    last_verified: '2025-06',
  },

  // ── Maryland ──────────────────────────────────────────────────────────────
  {
    state: 'MD',
    state_name: 'Maryland',
    regulatory_body: 'Maryland Public Service Commission (MPSC)',
    rules_url: 'https://www.psc.state.md.us/electricity/interconnections/',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=MD',
    typical_ica_days_min: 15,
    typical_ica_days_max: 30,
    typical_pto_days_min: 5,
    typical_pto_days_max: 10,
    nem_type: 'full_retail',
    nem_summary: 'Maryland NEM provides full retail credit for BGE, Pepco, Delmarva Power, and SMECO customers. Monthly rollover; annual true-up at avoided cost. SREC market active — MD SRECs trade $50–$90/SREC.',
    generic_steps: [
      'Submit application via utility portal (BGE, Pepco MD, Delmarva, or SMECO)',
      'Upload SLD and equipment documentation',
      'Utility reviews (15 business days for residential)',
      'Execute interconnection and NEM agreement',
      'Pass local electrical inspection',
      'Utility installs bi-directional meter',
      'PTO issued',
    ],
    solar_pro_note: 'Maryland SREC market + NEM + federal ITC creates strong economics. BGE territory (Baltimore) has strong solar adoption. Maryland Clean Energy Center offers low-interest loans. SREC registration required through PJM GATS.',
    last_verified: '2025-06',
  },

  // ── Maine ─────────────────────────────────────────────────────────────────
  {
    state: 'ME',
    state_name: 'Maine',
    regulatory_body: 'Maine Public Utilities Commission (MPUC)',
    rules_url: 'https://www.maine.gov/mpuc/regulated-utilities/electric/distributed-generation/',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=ME',
    typical_ica_days_min: 15,
    typical_ica_days_max: 30,
    typical_pto_days_min: 5,
    typical_pto_days_max: 10,
    nem_type: 'full_retail',
    nem_summary: 'Maine NEM provides full retail credit for CMP and Versant (Emera Maine) customers. Monthly rollover; true-up annually at avoided cost. Community solar (CSPM) also active.',
    generic_steps: [
      'Submit application via CMP or Versant portal',
      'Upload SLD and equipment list',
      'Utility reviews (15 business days for residential)',
      'Execute NEM agreement',
      'Pass local electrical inspection',
      'Utility installs bi-directional meter',
      'PTO granted',
    ],
    solar_pro_note: 'CMP (Central Maine Power) has a Tier-1 profile. Versant (formerly Emera Maine/Bangor Hydro) covers northern ME. Maine offers a state income tax credit (25% of cost, up to $500/year) plus federal ITC. Community solar popular in Maine.',
    last_verified: '2025-06',
  },

  // ── Michigan ──────────────────────────────────────────────────────────────
  {
    state: 'MI',
    state_name: 'Michigan',
    regulatory_body: 'Michigan Public Service Commission (MPSC)',
    rules_url: 'https://www.michigan.gov/mpsc/electricity/distributed-generation',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=MI',
    typical_ica_days_min: 20,
    typical_ica_days_max: 45,
    typical_pto_days_min: 5,
    typical_pto_days_max: 15,
    nem_type: 'net_billing',
    nem_summary: 'Michigan moved from NEM to Inflow/Outflow billing (net billing at avoided cost for exports) for new customers after Clean Energy Future Act (2023). Consumers Energy and DTE Energy are main IOUs. Legacy NEM customers grandfathered.',
    generic_steps: [
      'Submit application via Consumers Energy or DTE Energy online portal',
      'Upload SLD and equipment specs',
      'Utility reviews (20–30 business days)',
      'Execute distributed generation agreement',
      'Pass local electrical inspection',
      'Utility installs bidirectional meter',
      'PTO issued',
    ],
    solar_pro_note: 'Consumers Energy MI has a Tier-1 profile. DTE Energy follows similar MPSC rules. Michigan net billing export rate is lower than retail — battery storage and self-consumption maximization are important. MI Saves financing available.',
    last_verified: '2025-06',
  },

  // ── Minnesota ─────────────────────────────────────────────────────────────
  {
    state: 'MN',
    state_name: 'Minnesota',
    regulatory_body: 'Minnesota Public Utilities Commission (MPUC)',
    rules_url: 'https://mn.gov/puc/activities/edockets/search-documents.jsp',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=MN',
    typical_ica_days_min: 20,
    typical_ica_days_max: 45,
    typical_pto_days_min: 5,
    typical_pto_days_max: 15,
    nem_type: 'full_retail',
    nem_summary: 'Minnesota NEM provides full retail credit for Xcel Energy MN, Minnesota Power, and Otter Tail customers. Monthly rollover; true-up annually. Solar*Rewards program (Xcel) provides additional incentive.',
    generic_steps: [
      'Submit application to Xcel MN, Minnesota Power, or Otter Tail',
      'Upload SLD and equipment documentation',
      'Utility reviews (20–30 business days)',
      'Execute net metering agreement',
      'Pass local electrical inspection',
      'Utility installs net meter',
      'PTO granted',
    ],
    solar_pro_note: 'Xcel Energy MN Solar*Rewards program pays per-kWh incentive for 10 years (waiting list varies). MN has cold climate — system output lower in winter but summer production strong. Co-ops cover significant rural area and follow MPUC rules.',
    last_verified: '2025-06',
  },

  // ── Missouri ──────────────────────────────────────────────────────────────
  {
    state: 'MO',
    state_name: 'Missouri',
    regulatory_body: 'Missouri Public Service Commission (MPSC-MO)',
    rules_url: 'https://psc.mo.gov/CMSInternetData/Electricity/solar.htm',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=MO',
    typical_ica_days_min: 20,
    typical_ica_days_max: 45,
    typical_pto_days_min: 5,
    typical_pto_days_max: 15,
    nem_type: 'full_retail',
    nem_summary: 'Missouri NEM provides full retail credit for Ameren MO and Evergy MO customers. Monthly rollover; true-up annually at avoided cost. System size limited to 100% of annual consumption.',
    generic_steps: [
      'Submit application to Ameren MO or Evergy MO',
      'Upload SLD and equipment list',
      'Utility reviews (20–30 business days)',
      'Execute NEM agreement',
      'Pass local electrical inspection',
      'Utility installs net meter',
      'PTO issued',
    ],
    solar_pro_note: 'Missouri has moderate solar economics — no state solar incentive but federal ITC applies. Ameren MO (AmerenUE) covers eastern MO; Evergy MO covers western/Kansas City area. Rural co-ops follow MPSC-MO rules.',
    last_verified: '2025-06',
  },

  // ── Mississippi ───────────────────────────────────────────────────────────
  {
    state: 'MS',
    state_name: 'Mississippi',
    regulatory_body: 'Mississippi Public Service Commission (MSPSC)',
    rules_url: 'https://www.psc.ms.gov/electricity',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=MS',
    typical_ica_days_min: 20,
    typical_ica_days_max: 45,
    typical_pto_days_min: 5,
    typical_pto_days_max: 15,
    nem_type: 'full_retail',
    nem_summary: 'Mississippi NEM provides full retail credit for Entergy Mississippi customers. Co-ops vary. Monthly rollover; annual true-up at avoided cost.',
    generic_steps: [
      'Submit application to Entergy Mississippi or local co-op',
      'Upload SLD and equipment documentation',
      'Utility reviews (20–30 business days)',
      'Execute NEM agreement',
      'Pass local electrical inspection',
      'Utility installs bi-directional meter',
      'PTO granted',
    ],
    solar_pro_note: 'Entergy Mississippi has a Tier-1 profile. MS co-ops (Mississippi Band, Coast Electric, etc.) follow MSPSC rules. Low electricity rates (~$0.12/kWh) and minimal state incentives mean longer payback periods. Federal ITC is primary incentive.',
    last_verified: '2025-06',
  },

  // ── Montana ───────────────────────────────────────────────────────────────
  {
    state: 'MT',
    state_name: 'Montana',
    regulatory_body: 'Montana Public Service Commission (MPSC-MT)',
    rules_url: 'https://psc.mt.gov/Consumers/Electricity',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=MT',
    typical_ica_days_min: 20,
    typical_ica_days_max: 45,
    typical_pto_days_min: 5,
    typical_pto_days_max: 15,
    nem_type: 'full_retail',
    nem_summary: 'Montana NEM provides full retail credit for NorthWestern Energy (NWE) customers. Monthly rollover; true-up annually. System size limited to 50 kW for residential.',
    generic_steps: [
      'Submit application to NorthWestern Energy or local co-op',
      'Upload SLD and equipment specs',
      'Utility reviews (20–30 business days)',
      'Execute NEM agreement',
      'Pass local electrical inspection',
      'Utility installs net meter',
      'PTO issued',
    ],
    solar_pro_note: 'NorthWestern Energy is the primary IOU in Montana. Montana co-ops (Yellowstone Valley, Glacier Electric, etc.) follow MPSC-MT rules. Montana has a state property tax exemption for solar. Cold climate reduces annual output but ITC applies fully.',
    last_verified: '2025-06',
  },

  // ── North Carolina ────────────────────────────────────────────────────────
  {
    state: 'NC',
    state_name: 'North Carolina',
    regulatory_body: 'North Carolina Utilities Commission (NCUC)',
    rules_url: 'https://www.ncuc.net/solar/',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=NC',
    typical_ica_days_min: 15,
    typical_ica_days_max: 30,
    typical_pto_days_min: 5,
    typical_pto_days_max: 10,
    nem_type: 'full_retail',
    nem_summary: 'North Carolina NEM provides full retail credit for Duke Energy Carolinas and Duke Energy Progress customers. Monthly rollover; true-up annually at avoided cost. NC is a top-5 solar state nationally.',
    generic_steps: [
      'Submit application via Duke Energy NC online portal',
      'Upload SLD and equipment documentation',
      'Duke reviews (15 business days for residential)',
      'Execute interconnection and NEM agreement',
      'Pass county electrical inspection',
      'Duke installs bi-directional meter',
      'PTO issued',
    ],
    solar_pro_note: 'Duke Energy Carolinas and Duke Energy Progress together serve most of NC. NC DEQ has strong renewable programs. NC business tax credit (35% for commercial) available. Residential ITC applies. NC is a major utility-scale solar state but residential market also strong.',
    last_verified: '2025-06',
  },

  // ── North Dakota ──────────────────────────────────────────────────────────
  {
    state: 'ND',
    state_name: 'North Dakota',
    regulatory_body: 'North Dakota Public Service Commission (NDPSC)',
    rules_url: 'https://www.psc.nd.gov/regulation/electric/interconnection.shtml',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=ND',
    typical_ica_days_min: 20,
    typical_ica_days_max: 45,
    typical_pto_days_min: 5,
    typical_pto_days_max: 15,
    nem_type: 'full_retail',
    nem_summary: 'North Dakota NEM provides full retail credit for Basin Electric, Xcel MN (border areas), and local co-ops. Monthly rollover; annual true-up.',
    generic_steps: [
      'Submit application to MDU, Xcel, or local co-op',
      'Upload SLD and equipment specs',
      'Utility reviews (20–30 business days)',
      'Execute NEM agreement',
      'Pass local electrical inspection',
      'Utility installs net meter',
      'PTO granted',
    ],
    solar_pro_note: 'North Dakota has low solar adoption due to cold climate and low electricity rates. Most of the state served by co-ops under NDPSC rules. No state solar incentive but federal ITC applies. Wind energy is dominant renewable.',
    last_verified: '2025-06',
  },

  // ── Nebraska ──────────────────────────────────────────────────────────────
  {
    state: 'NE',
    state_name: 'Nebraska',
    regulatory_body: 'Nebraska Power Review Board (NPRB)',
    rules_url: 'https://www.powerreview.nebraska.gov/',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=NE',
    typical_ica_days_min: 20,
    typical_ica_days_max: 45,
    typical_pto_days_min: 5,
    typical_pto_days_max: 15,
    nem_type: 'full_retail',
    nem_summary: 'Nebraska is unique: all electric utilities are publicly owned (no investor-owned utilities). LB 824 (2009) requires all public power entities to offer net metering at retail rate. Monthly rollover; annual true-up.',
    generic_steps: [
      'Submit application to OPPD, LES, NPPD, or local public power district',
      'Upload SLD and equipment documentation',
      'Utility reviews (20–30 business days)',
      'Execute net metering agreement',
      'Pass local electrical inspection',
      'Utility installs bi-directional meter',
      'PTO issued',
    ],
    solar_pro_note: 'Nebraska has 100% public power — no IOUs. OPPD (Omaha), LES (Lincoln), and NPPD serve most customers. Each entity has its own process but all must follow NPRB net metering rules. Low rates (~$0.10/kWh) mean longer payback.',
    last_verified: '2025-06',
  },

  // ── New Hampshire ─────────────────────────────────────────────────────────
  {
    state: 'NH',
    state_name: 'New Hampshire',
    regulatory_body: 'New Hampshire Public Utilities Commission (NHPUC)',
    rules_url: 'https://www.puc.nh.gov/Regulatory/Docketbk/2017/17-096.html',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=NH',
    typical_ica_days_min: 15,
    typical_ica_days_max: 30,
    typical_pto_days_min: 5,
    typical_pto_days_max: 10,
    nem_type: 'full_retail',
    nem_summary: 'New Hampshire NEM provides full retail credit for Eversource NH and Liberty Utilities (NH Electric Co-op) customers. Monthly rollover; annual true-up. NH Renewable Portfolio Standard (RPS) supports solar.',
    generic_steps: [
      'Submit application via Eversource NH or Liberty Utilities portal',
      'Upload SLD and equipment specs',
      'Utility reviews (15 business days for residential)',
      'Execute NEM agreement',
      'Pass local electrical inspection',
      'Utility installs net meter',
      'PTO granted',
    ],
    solar_pro_note: 'Eversource NH has a Tier-1 profile. Liberty Utilities (NH Electric Co-op territory) follows NHPUC rules. NH SREC market available via Clean Energy NH. State rebate program (NH REIP) provides additional incentive for small systems.',
    last_verified: '2025-06',
  },

  // ── New Jersey ────────────────────────────────────────────────────────────
  {
    state: 'NJ',
    state_name: 'New Jersey',
    regulatory_body: 'New Jersey Board of Public Utilities (NJBPU)',
    rules_url: 'https://www.njcleanenergy.com/renewable-energy/programs/solar-programs',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=NJ',
    typical_ica_days_min: 10,
    typical_ica_days_max: 30,
    typical_pto_days_min: 5,
    typical_pto_days_max: 10,
    nem_type: 'full_retail',
    nem_summary: 'New Jersey NEM provides full retail credit for JCP&L, PSE&G, Atlantic City Electric, and Rockland Electric customers. Monthly rollover; annual true-up at avoided cost. TREC (Transition Renewable Energy Certificate) program active.',
    generic_steps: [
      'Submit application via utility portal (PSE&G, JCP&L, or ACE)',
      'Upload SLD and equipment documentation',
      'Utility reviews (10–15 business days for residential)',
      'Execute NEM agreement',
      'Pass local electrical inspection (NJ requires licensed electrician)',
      'Utility installs bi-directional meter',
      'PTO issued; register TRECs with PJM GATS',
    ],
    solar_pro_note: 'New Jersey has one of the strongest solar SREC/TREC markets. NJBPU oversees NJ Successor Solar Incentive (SuSI) program. TRECs pay ~$90/MWh for small residential systems. NJ has very high electricity rates (~$0.18/kWh) making solar highly economic.',
    last_verified: '2025-06',
  },

  // ── New Mexico ────────────────────────────────────────────────────────────
  {
    state: 'NM',
    state_name: 'New Mexico',
    regulatory_body: 'New Mexico Public Regulation Commission (NMPRC)',
    rules_url: 'https://www.nmprc.state.nm.us/utilities/elec.htm',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=NM',
    typical_ica_days_min: 15,
    typical_ica_days_max: 45,
    typical_pto_days_min: 5,
    typical_pto_days_max: 10,
    nem_type: 'full_retail',
    nem_summary: 'New Mexico NEM provides full retail credit for PNM, El Paso Electric NM, and Xcel NM customers. Monthly rollover; annual true-up. NM has strong solar resource (5.5+ peak sun hours statewide).',
    generic_steps: [
      'Submit application to PNM, El Paso Electric, or Xcel NM',
      'Upload SLD and equipment specs',
      'Utility reviews (15–30 business days)',
      'Execute NEM agreement',
      'Pass local electrical inspection',
      'Utility installs net meter',
      'PTO granted',
    ],
    solar_pro_note: 'PNM (Public Service Company of NM) and rural co-ops follow NMPRC rules. NM has strong solar resource and federal ITC. State tax credit (10% of cost, up to $6,000) available. High desert climate — dust management important for performance.',
    last_verified: '2025-06',
  },

  // ── Nevada ────────────────────────────────────────────────────────────────
  {
    state: 'NV',
    state_name: 'Nevada',
    regulatory_body: 'Nevada Public Utilities Commission (NVPUC)',
    rules_url: 'https://puc.nv.gov/Electricity/Consumer_Resources/Net_Metering/',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=NV',
    typical_ica_days_min: 15,
    typical_ica_days_max: 30,
    typical_pto_days_min: 5,
    typical_pto_days_max: 10,
    nem_type: 'net_billing',
    nem_summary: 'Nevada net metering (NEM 3.0) credits exports at time-of-use avoided cost rate, not full retail. NV Energy (NPC and SPPC) are the main IOUs. Legacy NEM customers grandfathered. Battery storage improves economics significantly.',
    generic_steps: [
      'Submit application via NV Energy online portal',
      'Upload SLD and equipment documentation',
      'NV Energy reviews (15 business days for residential)',
      'Execute net metering agreement',
      'Pass county/city electrical inspection',
      'NV Energy installs bi-directional meter',
      'PTO issued',
    ],
    solar_pro_note: 'Nevada has excellent solar resource but NEM 3.0 export rate is lower than retail. NV Energy (owned by Berkshire Hathaway) processes are generally efficient. No state solar tax credit but strong irradiance makes economics viable. Battery storage pairing strongly recommended.',
    last_verified: '2025-06',
  },

  // ── New York ──────────────────────────────────────────────────────────────
  {
    state: 'NY',
    state_name: 'New York',
    regulatory_body: 'New York Public Service Commission (NYPSC)',
    rules_url: 'https://www.nyserda.ny.gov/All-Programs/NY-Sun',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=NY',
    typical_ica_days_min: 15,
    typical_ica_days_max: 45,
    typical_pto_days_min: 5,
    typical_pto_days_max: 15,
    nem_type: 'full_retail',
    nem_summary: 'New York uses Value of Distributed Energy Resources (VDER) "Value Stack" tariff for new NEM customers, which is more complex than simple NEM but can exceed retail in some cases. Legacy NEM customers grandfathered. All NY IOUs follow NYPSC rules.',
    generic_steps: [
      'Submit application via utility portal (Con Ed, National Grid NY, NYSEG, RG&E, Central Hudson, or Orange & Rockland)',
      'Upload SLD and equipment list',
      'Utility reviews (15–30 business days)',
      'Execute interconnection and VDER/NEM agreement',
      'Pass local electrical inspection',
      'Utility installs bi-directional or interval meter',
      'PTO issued; register with NYSERDA NY-Sun if eligible for incentive',
    ],
    solar_pro_note: 'Con Edison, LIPA/PSEG-LI, NYSEG, RG&E, and Central Hudson have Tier-1 profiles. NYSERDA NY-Sun incentive provides per-watt incentive (declining block). VDER Value Stack calculation depends on location, time of use, and grid needs. NYC has specific building code requirements.',
    last_verified: '2025-06',
  },

  // ── Ohio ──────────────────────────────────────────────────────────────────
  {
    state: 'OH',
    state_name: 'Ohio',
    regulatory_body: 'Public Utilities Commission of Ohio (PUCO)',
    rules_url: 'https://www.puco.ohio.gov/puco/index.cfm/industry-information/industry-topics/net-metering/',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=OH',
    typical_ica_days_min: 20,
    typical_ica_days_max: 45,
    typical_pto_days_min: 5,
    typical_pto_days_max: 15,
    nem_type: 'full_retail',
    nem_summary: 'Ohio NEM provides full retail credit for AEP Ohio, FirstEnergy, Duke Energy OH, and Dayton Power & Light customers. Monthly rollover; true-up annually at avoided cost.',
    generic_steps: [
      'Submit application to AEP Ohio, FirstEnergy, Duke OH, or DP&L',
      'Upload SLD and equipment documentation',
      'Utility reviews (20–30 business days)',
      'Execute NEM agreement',
      'Pass local electrical inspection',
      'Utility installs net meter',
      'PTO granted',
    ],
    solar_pro_note: 'AEP Ohio has a Tier-1 profile. Ohio co-ops (Buckeye Power, etc.) follow PUCO rules. Ohio has moderate solar resource. No state solar incentive but federal ITC applies. Ohio SREC market is minimal — economics driven by NEM + ITC.',
    last_verified: '2025-06',
  },

  // ── Oklahoma ──────────────────────────────────────────────────────────────
  {
    state: 'OK',
    state_name: 'Oklahoma',
    regulatory_body: 'Oklahoma Corporation Commission (OCC)',
    rules_url: 'https://www.occeweb.com/EP/electric.htm',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=OK',
    typical_ica_days_min: 20,
    typical_ica_days_max: 45,
    typical_pto_days_min: 5,
    typical_pto_days_max: 15,
    nem_type: 'full_retail',
    nem_summary: 'Oklahoma NEM provides full retail credit for OG&E, PSO (AEP), and OEC co-ops. Monthly rollover; annual true-up at avoided cost.',
    generic_steps: [
      'Submit application to OG&E, PSO, or local co-op',
      'Upload SLD and equipment specs',
      'Utility reviews (20–30 business days)',
      'Execute NEM agreement',
      'Pass local electrical inspection',
      'Utility installs bi-directional meter',
      'PTO issued',
    ],
    solar_pro_note: 'OG&E has a Tier-1 profile. PSO (AEP Oklahoma) and co-ops follow OCC rules. Oklahoma has strong solar resource but low electricity rates (~$0.10/kWh). No state solar incentive. Tornado-resistant racking required in many areas — confirm AHJ requirements.',
    last_verified: '2025-06',
  },

  // ── Oregon ────────────────────────────────────────────────────────────────
  {
    state: 'OR',
    state_name: 'Oregon',
    regulatory_body: 'Oregon Public Utility Commission (OPUC)',
    rules_url: 'https://www.oregon.gov/puc/Pages/renewable-energy.aspx',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=OR',
    typical_ica_days_min: 15,
    typical_ica_days_max: 30,
    typical_pto_days_min: 5,
    typical_pto_days_max: 10,
    nem_type: 'full_retail',
    nem_summary: 'Oregon NEM provides full retail credit for Portland General Electric, Pacific Power (PacifiCorp), and Idaho Power OR territory. Monthly rollover; annual true-up. Oregon Energy Trust provides rebates.',
    generic_steps: [
      'Submit application via PGE, Pacific Power, or Idaho Power OR portal',
      'Upload SLD and equipment list',
      'Utility reviews (15 business days for residential)',
      'Execute NEM agreement',
      'Pass local/county electrical inspection',
      'Utility installs net meter',
      'PTO granted; apply for Oregon Energy Trust rebate separately',
    ],
    solar_pro_note: 'Portland General Electric has a Tier-1 profile. Pacific Power (PacifiCorp OR) and rural co-ops follow OPUC rules. Oregon Energy Trust offers $0.20–0.40/watt cash rebate. Western Oregon has moderate irradiance; Eastern Oregon (high desert) has better production.',
    last_verified: '2025-06',
  },

  // ── Pennsylvania ──────────────────────────────────────────────────────────
  {
    state: 'PA',
    state_name: 'Pennsylvania',
    regulatory_body: 'Pennsylvania Public Utility Commission (PAPUC)',
    rules_url: 'https://www.puc.pa.gov/filing-resources/industries-we-serve/electric/solar/',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=PA',
    typical_ica_days_min: 15,
    typical_ica_days_max: 30,
    typical_pto_days_min: 5,
    typical_pto_days_max: 10,
    nem_type: 'full_retail',
    nem_summary: 'Pennsylvania NEM provides full retail credit for PECO, PPL, Met-Ed, West Penn, Penelec, and Duquesne Light customers. Monthly rollover; annual true-up at avoided cost. PA SREC market active (PASERP).',
    generic_steps: [
      'Submit application via utility portal (PECO, PPL, or FirstEnergy PA)',
      'Upload SLD and equipment documentation',
      'Utility reviews (15 business days for residential)',
      'Execute interconnection and NEM agreement',
      'Pass local electrical inspection (PA UCC)',
      'Utility installs bi-directional meter',
      'PTO issued; register SRECs with GATS',
    ],
    solar_pro_note: 'Pennsylvania SREC market ($35–$55/SREC) plus NEM + ITC makes PA a solid solar market. FirstEnergy PA utilities (Met-Ed, Penelec, West Penn) share parent but may have varying application processes. PECO (Exelon) has streamlined online process.',
    last_verified: '2025-06',
  },

  // ── Rhode Island ──────────────────────────────────────────────────────────
  {
    state: 'RI',
    state_name: 'Rhode Island',
    regulatory_body: 'Rhode Island Public Utilities Commission (RIPUC)',
    rules_url: 'https://rienergyresources.com/programs/rhode-island-distributed-generation/',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=RI',
    typical_ica_days_min: 15,
    typical_ica_days_max: 30,
    typical_pto_days_min: 5,
    typical_pto_days_max: 10,
    nem_type: 'full_retail',
    nem_summary: 'Rhode Island NEM provides full retail credit for National Grid RI customers. Monthly rollover; annual true-up. Rhode Island Commerce Corporation offers REG grant program.',
    generic_steps: [
      'Submit application via National Grid RI portal',
      'Upload SLD and equipment list',
      'National Grid reviews (15 business days)',
      'Execute NEM agreement',
      'Pass local electrical inspection',
      'National Grid installs net meter',
      'PTO granted',
    ],
    solar_pro_note: 'National Grid RI is the sole IOU in Rhode Island. RI has strong solar incentives including the Renewable Energy Growth (REG) program which offers fixed tariff payments. High electricity rates (~$0.24/kWh) make solar very economic. Small state — most systems are residential rooftop.',
    last_verified: '2025-06',
  },

  // ── South Carolina ────────────────────────────────────────────────────────
  {
    state: 'SC',
    state_name: 'South Carolina',
    regulatory_body: 'South Carolina Public Service Commission (SCPSC)',
    rules_url: 'https://www.psc.sc.gov/page/utilities',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=SC',
    typical_ica_days_min: 20,
    typical_ica_days_max: 45,
    typical_pto_days_min: 5,
    typical_pto_days_max: 15,
    nem_type: 'full_retail',
    nem_summary: 'South Carolina NEM provides full retail credit for Dominion Energy SC, Duke Energy SC, and Santee Cooper customers. Monthly rollover; annual true-up. SC Clean Energy Act (2019) mandated improvements.',
    generic_steps: [
      'Submit application to Dominion SC, Duke Energy SC, or Santee Cooper',
      'Upload SLD and equipment documentation',
      'Utility reviews (20–30 business days)',
      'Execute NEM agreement',
      'Pass local electrical inspection',
      'Utility installs bi-directional meter',
      'PTO issued',
    ],
    solar_pro_note: 'Dominion Energy SC has a Tier-1 profile. Duke Energy SC and Santee Cooper follow SCPSC rules. SC co-ops (Central Electric, Santee Cooper-affiliated, etc.) have varying policies. State solar tax credit (25% of cost, up to $3,500/year) available.',
    last_verified: '2025-06',
  },

  // ── South Dakota ──────────────────────────────────────────────────────────
  {
    state: 'SD',
    state_name: 'South Dakota',
    regulatory_body: 'South Dakota Public Utilities Commission (SDPUC)',
    rules_url: 'https://puc.sd.gov/utilities/electric/default.aspx',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=SD',
    typical_ica_days_min: 20,
    typical_ica_days_max: 45,
    typical_pto_days_min: 5,
    typical_pto_days_max: 15,
    nem_type: 'full_retail',
    nem_summary: 'South Dakota NEM provides full retail credit for NorthWestern Energy SD, Montana-Dakota Utilities, and Xcel SD border territory. Monthly rollover; annual true-up.',
    generic_steps: [
      'Submit application to NorthWestern Energy, MDU, or local co-op',
      'Upload SLD and equipment specs',
      'Utility reviews (20–30 business days)',
      'Execute NEM agreement',
      'Pass local electrical inspection',
      'Utility installs net meter',
      'PTO granted',
    ],
    solar_pro_note: 'South Dakota has low solar adoption due to cold climate and low electricity rates. Co-ops cover significant rural area. No state solar incentive. Federal ITC is primary incentive. Northern latitude means lower annual production than southern states.',
    last_verified: '2025-06',
  },

  // ── Tennessee ─────────────────────────────────────────────────────────────
  {
    state: 'TN',
    state_name: 'Tennessee',
    regulatory_body: 'Tennessee Regulatory Authority (TRA) / TVA',
    rules_url: 'https://www.tva.com/energy/running-the-power-system/generation-technologies/solar',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=TN',
    typical_ica_days_min: 20,
    typical_ica_days_max: 60,
    typical_pto_days_min: 5,
    typical_pto_days_max: 20,
    nem_type: 'avoided_cost',
    nem_summary: 'Tennessee is primarily served by TVA (Tennessee Valley Authority) and its ~155 local power companies (LPCs). TVA\'s Green Power Switch and Generation Partners programs provide avoided-cost compensation, not retail NEM. LPC policies vary but follow TVA framework.',
    generic_steps: [
      'Identify local power company (LPC) serving your address (TVA does not bill retail customers directly)',
      'Submit interconnection application to your LPC',
      'LPC and TVA review (20–45 business days)',
      'Execute Generation Partners or standard interconnection agreement',
      'Pass local electrical inspection',
      'LPC installs appropriate meter',
      'PTO granted',
    ],
    solar_pro_note: 'TVA territory is unique — TVA sets wholesale rates, ~155 LPCs handle retail billing. No traditional retail NEM in TVA territory. TVA Generation Partners pays above avoided cost for some systems. Solar economics driven by self-consumption + ITC. Tennessee Valley has moderate solar resource.',
    last_verified: '2025-06',
  },

  // ── Texas ─────────────────────────────────────────────────────────────────
  {
    state: 'TX',
    state_name: 'Texas',
    regulatory_body: 'Public Utility Commission of Texas (PUCT)',
    rules_url: 'https://www.puc.texas.gov/industry/electric/Interconnection.aspx',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=TX',
    typical_ica_days_min: 10,
    typical_ica_days_max: 30,
    typical_pto_days_min: 5,
    typical_pto_days_max: 10,
    nem_type: 'varies',
    nem_summary: 'Texas (ERCOT deregulated) has no statewide NEM mandate. Retail Electric Providers (REPs) offer varying buyback rates for excess generation — some at retail, some at market rate, some at avoided cost. Oncor, CenterPoint, AEP TX, and TNMP are the TDUs (distribution utilities); REPs handle billing.',
    generic_steps: [
      'Submit interconnection application to TDU (Oncor, CenterPoint, AEP TX, or TNMP)',
      'Upload SLD and equipment documentation',
      'TDU reviews (10–15 business days for residential)',
      'TDU approves interconnection (separate from billing)',
      'Notify Retail Electric Provider (REP) to update account for solar credits',
      'Pass local electrical inspection',
      'TDU installs bi-directional meter',
      'Begin generating — confirm buyback rate with REP',
    ],
    solar_pro_note: 'Texas solar is deregulated (ERCOT). The TDU handles physical interconnection; the REP handles billing and buyback credits. Choose a REP with favorable solar buyback rate (e.g., Green Mountain Energy, TXU, Reliant solar plans). Entergy TX (non-ERCOT East TX) follows PUCT/LPSC traditional NEM rules and has a Tier-1 profile.',
    last_verified: '2025-06',
  },

  // ── Utah ──────────────────────────────────────────────────────────────────
  {
    state: 'UT',
    state_name: 'Utah',
    regulatory_body: 'Utah Public Service Commission (UPSC)',
    rules_url: 'https://psc.utah.gov/utilities/electric/solar/',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=UT',
    typical_ica_days_min: 15,
    typical_ica_days_max: 30,
    typical_pto_days_min: 5,
    typical_pto_days_max: 10,
    nem_type: 'net_billing',
    nem_summary: 'Utah moved to net billing (export at avoided cost) for new customers after 2017 NEM reform. Rocky Mountain Power (PacifiCorp) is main IOU. Legacy NEM grandfathered through 2035. Monthly credit; annual true-up.',
    generic_steps: [
      'Submit application via Rocky Mountain Power online portal',
      'Upload SLD and equipment specs',
      'Rocky Mountain Power reviews (15 business days)',
      'Execute net metering/net billing agreement',
      'Pass local/county electrical inspection',
      'Rocky Mountain Power installs bi-directional meter',
      'PTO issued',
    ],
    solar_pro_note: 'Rocky Mountain Power UT has a Tier-1 profile. Utah has excellent solar resource (5.5+ peak sun hours). Net billing export rate is lower than retail — self-consumption maximization is important. Federal ITC is primary incentive. Utah has no state solar tax credit.',
    last_verified: '2025-06',
  },

  // ── Virginia ──────────────────────────────────────────────────────────────
  {
    state: 'VA',
    state_name: 'Virginia',
    regulatory_body: 'Virginia State Corporation Commission (VASCC)',
    rules_url: 'https://www.scc.virginia.gov/pages/Renewable-Energy-Resources',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=VA',
    typical_ica_days_min: 15,
    typical_ica_days_max: 30,
    typical_pto_days_min: 5,
    typical_pto_days_max: 10,
    nem_type: 'full_retail',
    nem_summary: 'Virginia NEM provides full retail credit for Dominion Energy VA, AEP Virginia (Appalachian Power), and Northern Virginia Electric Cooperative customers. Monthly rollover; annual true-up. Virginia Clean Economy Act (2020) set strong renewable mandates.',
    generic_steps: [
      'Submit application via Dominion VA or AEP VA online portal',
      'Upload SLD and equipment documentation',
      'Utility reviews (15 business days for residential)',
      'Execute interconnection and NEM agreement',
      'Pass local electrical inspection',
      'Utility installs bi-directional meter',
      'PTO issued',
    ],
    solar_pro_note: 'Dominion Energy VA is the primary IOU and has an efficient online process. Virginia Clean Economy Act mandates aggressive renewable growth. No state solar tax credit but high electricity rates (~$0.13/kWh) and good irradiance make economics solid. Northern VA tech corridor has strong solar adoption.',
    last_verified: '2025-06',
  },

  // ── Vermont ───────────────────────────────────────────────────────────────
  {
    state: 'VT',
    state_name: 'Vermont',
    regulatory_body: 'Vermont Public Utility Commission (VTPUC)',
    rules_url: 'https://puc.vermont.gov/electric/net-metering',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=VT',
    typical_ica_days_min: 15,
    typical_ica_days_max: 30,
    typical_pto_days_min: 5,
    typical_pto_days_max: 10,
    nem_type: 'full_retail',
    nem_summary: 'Vermont NEM provides full retail credit for Green Mountain Power (GMP) and Washington Electric Co-op customers. Monthly rollover; annual true-up. Vermont Clean Energy Development Fund provides additional incentives.',
    generic_steps: [
      'Submit application via Green Mountain Power online portal',
      'Upload SLD and equipment documentation',
      'GMP reviews (15 business days)',
      'Execute NEM agreement',
      'Pass local electrical inspection',
      'GMP installs net meter',
      'PTO granted',
    ],
    solar_pro_note: 'Green Mountain Power (GMP) is the primary utility in Vermont and has innovative battery/grid programs. GMP\'s "bring your own battery" and community solar programs are noteworthy. Vermont has high electricity rates (~$0.20/kWh) and strong renewable policy. Low irradiance vs. southern states but economics remain viable.',
    last_verified: '2025-06',
  },

  // ── Washington ────────────────────────────────────────────────────────────
  {
    state: 'WA',
    state_name: 'Washington',
    regulatory_body: 'Washington Utilities and Transportation Commission (WUTC)',
    rules_url: 'https://www.utc.wa.gov/regulated-industries/utilities/electric-utilities/distributed-generation',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=WA',
    typical_ica_days_min: 15,
    typical_ica_days_max: 30,
    typical_pto_days_min: 5,
    typical_pto_days_max: 10,
    nem_type: 'full_retail',
    nem_summary: 'Washington NEM provides full retail credit for Puget Sound Energy, Pacific Power WA, and Avista WA customers. Monthly rollover; annual true-up. Multiple public utility districts (PSPs/PUDs) also offer NEM at retail.',
    generic_steps: [
      'Submit application via PSE, Pacific Power, or Avista WA portal',
      'Upload SLD and equipment documentation',
      'Utility reviews (15 business days for residential)',
      'Execute NEM agreement',
      'Pass local/county electrical inspection',
      'Utility installs net meter',
      'PTO issued',
    ],
    solar_pro_note: 'Puget Sound Energy, Avista WA, and Pacific Power WA have Tier-1 profiles. Washington PUDs (Snohomish, Clark, Chelan, etc.) are regulated differently — each PUD has its own NEM tariff. Western WA has lower irradiance; Eastern WA is sunnier. Washington does not have a state income tax so no solar tax credit applicable.',
    last_verified: '2025-06',
  },

  // ── Wisconsin ─────────────────────────────────────────────────────────────
  {
    state: 'WI',
    state_name: 'Wisconsin',
    regulatory_body: 'Public Service Commission of Wisconsin (PSCW)',
    rules_url: 'https://psc.wi.gov/Pages/Programs/RenewableResources.aspx',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=WI',
    typical_ica_days_min: 20,
    typical_ica_days_max: 45,
    typical_pto_days_min: 5,
    typical_pto_days_max: 15,
    nem_type: 'full_retail',
    nem_summary: 'Wisconsin NEM provides full retail credit for We Energies, WPS (Wisconsin Public Service), Alliant WI, and MG&E customers. Monthly rollover; annual true-up at avoided cost.',
    generic_steps: [
      'Submit application to We Energies, WPS, Alliant WI, or MG&E',
      'Upload SLD and equipment documentation',
      'Utility reviews (20–30 business days)',
      'Execute NEM agreement',
      'Pass local electrical inspection',
      'Utility installs net meter',
      'PTO granted',
    ],
    solar_pro_note: 'We Energies WI has a Tier-1 profile. WPS (Wisconsin Public Service) and Alliant Energy WI follow PSCW rules. Focus on Energy (WI utility program) offers rebates for solar. Cold climate reduces annual output but summer production strong. High heating and cooling loads make solar+storage attractive.',
    last_verified: '2025-06',
  },

  // ── West Virginia ─────────────────────────────────────────────────────────
  {
    state: 'WV',
    state_name: 'West Virginia',
    regulatory_body: 'West Virginia Public Service Commission (WVPSC)',
    rules_url: 'https://www.psc.state.wv.us/scripts/webforms/edocket/default.aspx',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=WV',
    typical_ica_days_min: 20,
    typical_ica_days_max: 60,
    typical_pto_days_min: 5,
    typical_pto_days_max: 20,
    nem_type: 'full_retail',
    nem_summary: 'West Virginia NEM provides full retail credit for Appalachian Power (AEP) and Potomac Edison (FirstEnergy) customers. Monthly rollover; annual true-up. WV is historically coal-focused with slower solar adoption.',
    generic_steps: [
      'Submit application to Appalachian Power or Potomac Edison',
      'Upload SLD and equipment documentation',
      'Utility reviews (20–45 business days)',
      'Execute interconnection and NEM agreement',
      'Pass local electrical inspection',
      'Utility installs bi-directional meter',
      'PTO issued',
    ],
    solar_pro_note: 'West Virginia has low solar adoption but NEM is available. Appalachian Power (AEP WV) and Potomac Edison (FirstEnergy WV) serve most of the state. No state solar incentive. Federal ITC is primary incentive. Mountainous terrain can limit roof orientation and shading may be a factor.',
    last_verified: '2025-06',
  },

  // ── Wyoming ───────────────────────────────────────────────────────────────
  {
    state: 'WY',
    state_name: 'Wyoming',
    regulatory_body: 'Wyoming Public Service Commission (WYPSC)',
    rules_url: 'https://psc.wyo.gov/electric/',
    dsire_url: 'https://programs.dsireusa.org/system/program?state=WY',
    typical_ica_days_min: 20,
    typical_ica_days_max: 45,
    typical_pto_days_min: 5,
    typical_pto_days_max: 15,
    nem_type: 'full_retail',
    nem_summary: 'Wyoming NEM provides full retail credit for Rocky Mountain Power WY (PacifiCorp) and Cheyenne Light customers. Monthly rollover; annual true-up at avoided cost.',
    generic_steps: [
      'Submit application to Rocky Mountain Power WY or Cheyenne Light',
      'Upload SLD and equipment specs',
      'Utility reviews (20–30 business days)',
      'Execute NEM agreement',
      'Pass local electrical inspection',
      'Utility installs net meter',
      'PTO granted',
    ],
    solar_pro_note: 'Rocky Mountain Power WY (PacifiCorp) is the primary IOU. Wyoming has minimal solar adoption despite good irradiance in the southeast. No state solar incentive. Federal ITC applies. Wind energy is dominant renewable in Wyoming.',
    last_verified: '2025-06',
  },

];

// ─── State Fallback Lookup Function ──────────────────────────────────────────

let _stateFallbackMap: Map<string, StateIcaFallback> | null = null;

function buildStateFallbackMap(): Map<string, StateIcaFallback> {
  const map = new Map<string, StateIcaFallback>();
  for (const fallback of STATE_ICA_FALLBACKS) {
    map.set(fallback.state.toUpperCase(), fallback);
    map.set(fallback.state_name.toLowerCase(), fallback);
  }
  return map;
}

export function getStateIcaFallback(stateOrName: string): StateIcaFallback | null {
  if (!_stateFallbackMap) _stateFallbackMap = buildStateFallbackMap();
  return _stateFallbackMap.get(stateOrName.toUpperCase()) ??
    _stateFallbackMap.get(stateOrName.toLowerCase()) ??
    null;
}

export function getStateFallbackStates(): string[] {
  return STATE_ICA_FALLBACKS.map(f => f.state);
}

'''

def main():
    filepath = '/workspace/solarpro-git/lib/utilityInterconnection.ts'
    
    with open(filepath, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    total_lines = len(lines)
    print(f"Total lines: {total_lines}")
    
    # Find the insert point: after line 3052 (1-based), which is index 3051 (0-based)
    # Lines 3051 and 3052 (0-based) are "];\n" and "\n"
    # We want to insert AFTER the blank line (index 3052, 0-based) — i.e., before line 3054 (1-based)
    # Actually let's find the exact line with "];\n" that closes INTERCONNECTION_PROFILES
    # We know from grep it's line 3052 (1-based) = index 3051 (0-based)
    
    insert_index = 3053  # 0-based, insert before this index (= before line 3054 1-based)
    
    # Verify what's at surrounding lines
    print(f"Line {insert_index-1} (0-based {insert_index-2}): {lines[insert_index-2]!r}")
    print(f"Line {insert_index} (0-based {insert_index-1}): {lines[insert_index-1]!r}")
    print(f"Line {insert_index+1} (0-based {insert_index}): {lines[insert_index]!r}")
    
    # Insert the block
    new_lines = lines[:insert_index] + [STATE_ICA_BLOCK] + lines[insert_index:]
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.writelines(new_lines)
    
    print(f"Done. New total lines: {len(new_lines)}")
    print("Insertion successful!")

if __name__ == '__main__':
    main()
