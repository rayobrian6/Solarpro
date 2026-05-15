/**
 * lib/utilityInterconnection.ts
 * v48.33 — Utility Interconnection Application & PTO Guidance Knowledge Base
 *
 * Per-utility registry of:
 *   - Interconnection Application (ICA) requirements, forms, portals, timelines
 *   - Permission to Operate (PTO) process, typical wait times, homeowner checklist
 *   - Common rejection reasons and how to avoid them
 *
 * WHY THIS EXISTS:
 *   Every solar installation requires two distinct utility approvals:
 *   1. Interconnection Agreement (ICA) — before construction or during permitting
 *   2. Permission to Operate (PTO) — after final inspection, before energization
 *
 *   Without a clear roadmap, homeowners frequently:
 *   - Submit incomplete interconnection apps (delays 30–90 days)
 *   - Miss required forms (e.g. signed net metering application)
 *   - Wait without understanding the PTO process (leads to cancellations)
 *   - Call the utility repeatedly for status updates (wastes time)
 *
 *   This file gives Solar Pro reps and homeowners utility-specific guidance
 *   embedded directly into permit packages and the engineering dashboard.
 *
 * Data sources: Utility tariff filings, DSIRE, utility interconnection portals,
 *               FERC Form 1 data, state PUC dockets, direct utility contacts.
 * Last updated: 2025-06
 *
 * Usage:
 *   import { getInterconnectionProfile, getPtoGuidance } from '@/lib/utilityInterconnection';
 *   const profile = getInterconnectionProfile('pge_ca');
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type InterconnectionPortalType =
  | 'online_portal'     // Utility has a dedicated online portal for ICA applications
  | 'email_submission'  // Application submitted by email
  | 'mail_only'         // Paper form mailed to utility
  | 'hybrid'            // Online form + email or mail backup
  | 'third_party';      // Third-party platform (e.g., UtilityAPI, PowerClerk)

export type PtoTrigger =
  | 'final_inspection'  // PTO issued after AHJ final inspection passed
  | 'utility_witness'   // Utility sends inspector to witness commissioning
  | 'self_certification'; // Installer self-certifies; utility approves remotely

export interface InterconnectionRequirement {
  /** Short label for this requirement */
  label: string;
  /** Detailed description of what is needed */
  description: string;
  /** Is this required for systems under 10 kW? */
  required_small_system: boolean;
  /** Is this required for systems 10–100 kW? */
  required_large_system: boolean;
  /** Is this typically prepared by the solar contractor or the homeowner? */
  prepared_by: 'contractor' | 'homeowner' | 'both';
}

export interface CommonRejection {
  reason: string;
  how_to_avoid: string;
}

export interface InterconnectionProfile {
  /** Matches utility_id in proposalTruthEngine.ts / utilityPrograms.ts */
  utility_id: string;
  utility_name: string;
  state: string;

  // ── Application Process ──────────────────────────────────────────────────
  portal_type: InterconnectionPortalType;
  /** Primary URL for the interconnection application / portal */
  application_url: string;
  /** Backup / info URL (tariff filing, FAQ page, etc.) */
  info_url?: string;
  /** Phone number for interconnection department */
  interconnection_phone?: string;
  /** Email for interconnection submissions / questions */
  interconnection_email?: string;

  // ── Application Form Details ─────────────────────────────────────────────
  /** Name of the application form / process */
  application_form_name: string;
  /** Does this utility require a signed NEM / net metering application? */
  requires_nem_application: boolean;
  /** Does this utility require a signed interconnection agreement (separate from NEM)? */
  requires_signed_ica: boolean;
  /** Does this utility require an anti-islanding test certification? */
  requires_anti_islanding_cert: boolean;
  /** Does this utility require a single-line diagram (SLD)? */
  requires_sld: boolean;
  /** Does this utility require a stamped PE plan set? */
  requires_stamped_planset: boolean;
  /** Does this utility require proof of homeowner's insurance? */
  requires_hoa_insurance?: boolean;

  requirements: InterconnectionRequirement[];

  // ── Timeline ─────────────────────────────────────────────────────────────
  /** Typical business days from complete application to approval (Level 1 / simplified) */
  ica_approval_days_min: number;
  ica_approval_days_max: number;
  /** Note explaining timeline variability */
  timeline_note: string;

  // ── PTO Process ──────────────────────────────────────────────────────────
  pto_trigger: PtoTrigger;
  /** Typical business days from PTO request to PTO letter (after final inspection) */
  pto_days_min: number;
  pto_days_max: number;
  /** Step-by-step PTO process for this utility */
  pto_steps: string[];
  /** Checklist for homeowner to verify before calling for PTO */
  homeowner_pto_checklist: string[];
  /** URL to submit PTO request / upload inspection card */
  pto_request_url?: string;

  // ── Common Pitfalls ──────────────────────────────────────────────────────
  common_rejections: CommonRejection[];

  /** Solar Pro notes for coaching the rep and homeowner */
  solar_pro_note: string;
  last_verified: string;
}

// ─── Interconnection Profiles Registry ──────────────────────────────────────

export const INTERCONNECTION_PROFILES: InterconnectionProfile[] = [

  // ── Pacific Gas & Electric (PG&E) — California ───────────────────────────
  {
    utility_id: 'pge_ca',
    utility_name: 'Pacific Gas & Electric',
    state: 'CA',
    portal_type: 'online_portal',
    application_url: 'https://www.pge.com/en/about/doing-business-with-pge/interconnections/net-energy-metering-program.html',
    info_url: 'https://www.pge.com/en/account/tariffs-and-rates/solar-net-energy-metering/solar-installer-hub.html',
    interconnection_phone: '1-877-743-4112',
    interconnection_email: 'SolarInterconnection@pge.com',
    application_form_name: 'PG&E Rule 21 / NEM 3.0 Application (SmartConnect Portal)',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: true,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      {
        label: 'Completed Rule 21 / NEM Application',
        description: 'Submit via PG&E SmartConnect portal. Requires system specs, inverter model, and installer license number (C-10 or C-46).',
        required_small_system: true,
        required_large_system: true,
        prepared_by: 'contractor',
      },
      {
        label: 'Single-Line Diagram (SLD)',
        description: 'Electrical SLD showing inverter, disconnect, meter, and utility connection point.',
        required_small_system: true,
        required_large_system: true,
        prepared_by: 'contractor',
      },
      {
        label: 'Signed Interconnection Agreement',
        description: 'Homeowner must sign the PG&E Interconnection Agreement. Sent electronically via DocuSign after application approval.',
        required_small_system: true,
        required_large_system: true,
        prepared_by: 'homeowner',
      },
      {
        label: 'NEM 3.0 Rate Schedule Enrollment',
        description: 'Homeowner selects NEM 3.0 billing tariff. Systems under 1 MW are automatically enrolled on NEM 3.0 (NBT). Enrollment happens at PTO, not at application.',
        required_small_system: true,
        required_large_system: true,
        prepared_by: 'homeowner',
      },
      {
        label: 'CSLB License Verification',
        description: 'Installer must hold valid CSLB C-10 (Electrical) or C-46 (Solar) contractor\'s license. License verified automatically at application.',
        required_small_system: true,
        required_large_system: true,
        prepared_by: 'contractor',
      },
    ],
    ica_approval_days_min: 10,
    ica_approval_days_max: 30,
    timeline_note: 'PG&E Expedited Review (systems ≤10 kW, no export limitations): 10 business days. Standard Review (10–1,000 kW): 15–30 business days. Grid studies required above 1 MW. Delays common in CAISO-constrained circuits — check hosting capacity map before submitting.',
    pto_trigger: 'final_inspection',
    pto_days_min: 3,
    pto_days_max: 15,
    pto_steps: [
      'Step 1: Pass AHJ (city/county) final inspection. Inspector stamps the permit card.',
      'Step 2: Contractor uploads signed inspection card to PG&E SmartConnect portal under "Upload Documents."',
      'Step 3: PG&E schedules meter upgrade if required (for NEM 3.0, a bidirectional meter is required — usually auto-scheduled by PG&E).',
      'Step 4: PG&E issues PTO letter via email to the address on file. This is the legal authorization to energize.',
      'Step 5: Installer or homeowner receives PTO letter, turns system on (flip disconnect, enable inverter via app).',
      'Step 6: Verify system is producing on the monitoring app. Confirm net metering credits appear on first bill.',
    ],
    homeowner_pto_checklist: [
      'City/county final inspection is PASSED (inspector has signed permit card)',
      'Contractor has uploaded the signed inspection card to PG&E portal',
      'Your email address on PG&E account is current (PTO letter is emailed)',
      'Meter socket is accessible (PG&E may need to swap meter for bidirectional)',
      'Do NOT turn on the inverter until PTO letter is received — energizing without PTO is a tariff violation',
    ],
    pto_request_url: 'https://www.pge.com/en/about/doing-business-with-pge/interconnections/net-energy-metering-program.html',
    common_rejections: [
      {
        reason: 'Incomplete SLD — missing utility disconnect location or meter base amperage',
        how_to_avoid: 'Use PG&E\'s SLD template. Include: main service panel rating, utility meter location, dedicated solar disconnect, and inverter AC output breaker size.',
      },
      {
        reason: 'System size exceeds 15% of minimum monthly load on the feeder (hosting capacity limit)',
        how_to_avoid: 'Check PG&E\'s DRP (Distribution Resources Plan) map before sizing. Reduce system size or add export limiting (DESL) to pass.',
      },
      {
        reason: 'Installer CSLB license expired or not registered with PG&E',
        how_to_avoid: 'Verify CSLB license is active and registered in PG&E portal under "Contractor Profile" before submitting any application.',
      },
      {
        reason: 'Homeowner did not sign Interconnection Agreement within 30 days',
        how_to_avoid: 'Send homeowner DocuSign link immediately after application approval. Applications auto-expire after 30 days if not signed.',
      },
    ],
    solar_pro_note: 'PG&E NEM 3.0 requires careful battery pairing analysis — export rates average only $0.05–0.08/kWh vs. $0.30–0.45 import rates. Always lead the PG&E pitch with battery storage (Tesla Powerwall, Enphase IQ, SunPower SunVault). The ICA timeline is typically 2–4 weeks, so submit the application at permit submittal to avoid delays. For PTO, 3–5 business days is realistic for small systems in non-congested areas.',
    last_verified: '2025-06',
  },

  // ── Southern California Edison (SCE) — California ────────────────────────
  {
    utility_id: 'sce_ca',
    utility_name: 'Southern California Edison',
    state: 'CA',
    portal_type: 'online_portal',
    application_url: 'https://www.sce.com/business/smart-energy-solar/solar-for-business/grid-interconnections/interconnecting-generation-under-rule-21',
    info_url: 'https://www.sce.com/about-sce/regulatory/cpuc-proceedings/solar',
    interconnection_phone: '1-800-655-4555',
    application_form_name: 'SCE Net Energy Metering Application (MyAccount Portal)',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: true,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      {
        label: 'NEM 3.0 / NBT Application via MyAccount',
        description: 'Submit via SCE MyAccount or contractor portal. Include: inverter model, system kW-DC, kW-AC, battery specs if applicable.',
        required_small_system: true,
        required_large_system: true,
        prepared_by: 'contractor',
      },
      {
        label: 'Single-Line Diagram',
        description: 'Must show service entrance, meter, solar disconnect, inverter, and all overcurrent protection.',
        required_small_system: true,
        required_large_system: true,
        prepared_by: 'contractor',
      },
      {
        label: 'Homeowner Signature on Interconnection Agreement',
        description: 'SCE sends ICA via DocuSign or mail. Must be returned within 30 days or application is cancelled.',
        required_small_system: true,
        required_large_system: true,
        prepared_by: 'homeowner',
      },
    ],
    ica_approval_days_min: 10,
    ica_approval_days_max: 30,
    timeline_note: 'Simplified (Expedited) Review for ≤10 kW residential systems: 10 business days. Standard Review for >10 kW: 20–30 business days. SGIP-eligible battery projects may require additional 2–4 weeks for SGIP enrollment coordination.',
    pto_trigger: 'final_inspection',
    pto_days_min: 5,
    pto_days_max: 20,
    pto_steps: [
      'Step 1: Complete AHJ final inspection. Obtain signed inspection card from inspector.',
      'Step 2: Contractor submits PTO request through SCE contractor portal or MyAccount, uploading inspection card.',
      'Step 3: SCE verifies the application file and inspection documentation.',
      'Step 4: SCE schedules meter exchange if bidirectional meter needed (allows 7–10 business days for meter work).',
      'Step 5: SCE issues PTO authorization via email. Do not energize before this letter.',
      'Step 6: Energize system. Verify generation on monitoring app and confirm TOU export credits on first bill.',
    ],
    homeowner_pto_checklist: [
      'AHJ final inspection passed and permit card signed by inspector',
      'Contractor has submitted PTO request with inspection card upload',
      'SCE account email is current for PTO letter delivery',
      'Meter socket is accessible (SCE may need to replace meter)',
      'SGIP reservation (if applicable) has been activated — contact SGIP administrator',
      'Do NOT turn on inverter until PTO letter received from SCE',
    ],
    pto_request_url: 'https://www.sce.com/business/smart-energy-solar/solar-for-business/grid-interconnections/interconnecting-generation-under-rule-21',
    common_rejections: [
      {
        reason: 'Export capacity exceeds circuit hosting capacity',
        how_to_avoid: 'Check SCE\'s Distribution System Atlas before sizing. Systems in congested areas can add Smart Inverter export limit to pass review.',
      },
      {
        reason: 'Battery AC coupling not properly shown on SLD',
        how_to_avoid: 'Show battery inverter as separate AC-coupled device with its own disconnect. SCE requires separate line item for battery in system specs.',
      },
    ],
    solar_pro_note: 'SCE NEM 3.0 (NBT) has the same low export rate structure as PG&E. Battery storage is essential to value proposition — without battery, solar ROI is 15+ years. Lead with SGIP battery rebate ($0.15–0.25/Wh for eligible customers). PTO typically runs 2–3 weeks including meter swap.',
    last_verified: '2025-06',
  },

  // ── San Diego Gas & Electric (SDG&E) — California ────────────────────────
  {
    utility_id: 'sdge_ca',
    utility_name: 'San Diego Gas & Electric',
    state: 'CA',
    portal_type: 'online_portal',
    application_url: 'https://www.sdge.com/more-information/customer-generation',
    info_url: 'https://www.sdge.com/clean-energy/solar-and-other-generation',
    interconnection_phone: '1-800-411-7343',
    application_form_name: 'SDG&E Rule 21 NEM Application',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: true,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      {
        label: 'Online Rule 21 Application',
        description: 'Application via SDG&E portal. Requires system specs, equipment list, SLD, and installer license number.',
        required_small_system: true,
        required_large_system: true,
        prepared_by: 'contractor',
      },
      {
        label: 'Signed NEM Agreement',
        description: 'Homeowner must sign NEM 3.0 enrollment agreement. SDG&E sends via email.',
        required_small_system: true,
        required_large_system: true,
        prepared_by: 'homeowner',
      },
    ],
    ica_approval_days_min: 10,
    ica_approval_days_max: 25,
    timeline_note: 'Expedited review (≤10 kW): 10 business days. SDG&E has high hosting capacity in most service territory. Coastal circuits near 92xxx ZIPs may have congestion — check DRP map.',
    pto_trigger: 'final_inspection',
    pto_days_min: 5,
    pto_days_max: 15,
    pto_steps: [
      'Step 1: Pass AHJ final inspection.',
      'Step 2: Contractor uploads inspection documentation to SDG&E portal.',
      'Step 3: SDG&E reviews and approves. Issues PTO letter via email.',
      'Step 4: If meter exchange needed, schedule within SDG&E appointment window.',
      'Step 5: Energize after PTO letter received.',
    ],
    homeowner_pto_checklist: [
      'AHJ inspection passed',
      'Contractor submitted PTO request to SDG&E portal',
      'Meter socket clear and accessible',
      'NEM agreement signed by homeowner',
      'Do not energize before PTO letter',
    ],
    common_rejections: [
      {
        reason: 'Inverter model not on CEC approved list',
        how_to_avoid: 'Verify inverter is on California Energy Commission (CEC) eligible equipment list before spec\'ing. All inverters must be UL 1741-SA certified.',
      },
    ],
    solar_pro_note: 'SDG&E has the highest residential rates in the US ($0.35–0.55+/kWh). Solar ROI is outstanding even under NEM 3.0 because bill offset value is so high. Always lead with solar + battery — SGIP rebate available. PTO in 1–3 weeks typical.',
    last_verified: '2025-06',
  },

  // ── ComEd — Illinois ──────────────────────────────────────────────────────
  {
    utility_id: 'comed_il',
    utility_name: 'ComEd (Commonwealth Edison)',
    state: 'IL',
    portal_type: 'online_portal',
    application_url: 'https://www.comed.com/SmartEnergy/SolarEnergy/Pages/InterconnectionProcessOverview.aspx',
    info_url: 'https://www.comed.com/SmartEnergy/SolarEnergy/Pages/SmallGeneratorInterconnection.aspx',
    interconnection_phone: '1-800-334-7661',
    interconnection_email: 'ComEdInterconnection@comed.com',
    application_form_name: 'ComEd Small Generator Interconnection Application (SGIA)',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: false,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      {
        label: 'Small Generator Interconnection Application (SGIA)',
        description: 'Submit via ComEd online portal. Requires: system kW-DC, inverter model and specs, site address, contact info.',
        required_small_system: true,
        required_large_system: true,
        prepared_by: 'contractor',
      },
      {
        label: 'Single-Line Diagram',
        description: 'Electrical SLD. For ≤10 kW systems, a simplified SLD is acceptable.',
        required_small_system: true,
        required_large_system: true,
        prepared_by: 'contractor',
      },
      {
        label: 'Net Metering Enrollment (Illinois ILSFA/AB)',
        description: 'Homeowner enrolls in Illinois Adjustable Block (AB) Program via ILSFA portal for solar incentives if applicable. Separate from interconnection.',
        required_small_system: false,
        required_large_system: false,
        prepared_by: 'contractor',
      },
    ],
    ica_approval_days_min: 15,
    ica_approval_days_max: 30,
    timeline_note: 'Expedited Process for certified inverters ≤10 kW: 15 business days. Fast Track (10–5,000 kW): 15 business days. Detailed Study required above 5 MW. Illinois Commerce Commission requires ComEd to process within 30 business days or provide status update.',
    pto_trigger: 'final_inspection',
    pto_days_min: 5,
    pto_days_max: 15,
    pto_steps: [
      'Step 1: Complete permit and pass AHJ final electrical inspection.',
      'Step 2: Installer notifies ComEd via online portal that inspection is complete, uploads permit card.',
      'Step 3: ComEd verifies application is complete and all requirements met.',
      'Step 4: ComEd sends PTO letter via email (may also require in-person meter read for older meters).',
      'Step 5: Installer receives PTO, activates system. Homeowner registers system with Illinois Shines (AB program) if pursuing SRECs.',
    ],
    homeowner_pto_checklist: [
      'Permit pulled and final inspection passed',
      'Interconnection agreement signed (sent by ComEd after ICA approval)',
      'Installer submitted PTO request with inspection documentation',
      'Illinois Adjustable Block (AB) Program enrollment completed (for SREC income)',
      'Do not energize before receiving ComEd PTO authorization letter',
    ],
    pto_request_url: 'https://www.comed.com/SmartEnergy/SolarEnergy/Pages/InterconnectionProcessOverview.aspx',
    common_rejections: [
      {
        reason: 'Application submitted with insufficient equipment details',
        how_to_avoid: 'Include complete inverter spec sheet with application. ComEd requires make, model, rated AC output, and IEEE 1547 compliance statement.',
      },
      {
        reason: 'System size exceeds 110% of 12-month average load',
        how_to_avoid: 'ComEd caps net metering at 110% of prior 12-month load. Size system to match annual consumption. Provide 12-month utility bills at application.',
      },
    ],
    solar_pro_note: 'ComEd Illinois SREC income (Illinois Adjustable Block Program, administered by IL-SHINES) can add $0.04–0.06/kWh equivalent value over 15 years — always include in proposal ROI. Interconnection approval typically 3–4 weeks. PTO 1–2 weeks after final inspection. Lead with AB Program enrollment as a major financial differentiator.',
    last_verified: '2025-06',
  },

  // ── Ameren Illinois ───────────────────────────────────────────────────────
  {
    utility_id: 'ameren_il',
    utility_name: 'Ameren Illinois',
    state: 'IL',
    portal_type: 'online_portal',
    application_url: 'https://www.ameren.com/service/renewables/solar',
    info_url: 'https://www.ameren.com/illinois/home/save-energy/solar',
    interconnection_phone: '1-800-755-5000',
    application_form_name: 'Ameren Illinois Distributed Generation Interconnection Application',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: false,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      {
        label: 'Distributed Generation Interconnection Application',
        description: 'Online application at ameren.com. Provide: system capacity (kW-DC and kW-AC), inverter model, service address, installer contact.',
        required_small_system: true,
        required_large_system: true,
        prepared_by: 'contractor',
      },
      {
        label: 'SLD and Equipment Specifications',
        description: 'Single-line diagram plus inverter spec sheet.',
        required_small_system: true,
        required_large_system: true,
        prepared_by: 'contractor',
      },
    ],
    ica_approval_days_min: 15,
    ica_approval_days_max: 30,
    timeline_note: 'Simplified Process (Expedited) for ≤10 kW: 15 business days typical. Ameren Illinois has good hosting capacity across most of Central/Southern IL. Rural circuits may have longer timelines.',
    pto_trigger: 'final_inspection',
    pto_days_min: 5,
    pto_days_max: 15,
    pto_steps: [
      'Step 1: Pass AHJ final inspection.',
      'Step 2: Installer uploads final inspection documentation to Ameren IL portal.',
      'Step 3: Ameren reviews and may schedule meter exchange for bidirectional meter.',
      'Step 4: Ameren issues PTO letter electronically.',
      'Step 5: Energize system after PTO received. Enroll in Power Smart Pricing (hourly TOU) to maximize savings.',
    ],
    homeowner_pto_checklist: [
      'AHJ final inspection passed',
      'Interconnection agreement signed',
      'Installer submitted PTO request with inspection card',
      'Consider enrolling in Ameren Power Smart Pricing after PTO for hourly rate savings',
    ],
    common_rejections: [
      {
        reason: 'Net metering application not submitted simultaneously with ICA',
        how_to_avoid: 'Submit NEM application at same time as interconnection application to avoid 2–3 week delay.',
      },
    ],
    solar_pro_note: 'Ameren Illinois\'s Power Smart Pricing (PSP) is a powerful sales tool — hourly rates can swing $0.02–$0.15/kWh, and battery owners can consistently dodge peak charges. Mention PSP enrollment at proposal stage. ICA + PTO typically 6–8 weeks total.',
    last_verified: '2025-06',
  },

  // ── Florida Power & Light (FPL) ───────────────────────────────────────────
  {
    utility_id: 'fpl_fl',
    utility_name: 'Florida Power & Light (FPL)',
    state: 'FL',
    portal_type: 'online_portal',
    application_url: 'https://www.fpl.com/netmetering.html',
    info_url: 'https://www.fpl.com/clean-energy/solar.html',
    interconnection_phone: '1-800-375-2434',
    application_form_name: 'FPL Distributed Generation Interconnection Application (DG Portal)',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: false,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      {
        label: 'FPL DG Portal Application',
        description: 'Submit via FPL DG portal. Requires: inverter specs, system kW-DC, site address, contractor license number.',
        required_small_system: true,
        required_large_system: true,
        prepared_by: 'contractor',
      },
      {
        label: 'SLD and Equipment List',
        description: 'Standard SLD required. Equipment list including inverter, panels, and disconnect switch.',
        required_small_system: true,
        required_large_system: true,
        prepared_by: 'contractor',
      },
      {
        label: 'Signed Net Metering Agreement',
        description: 'Homeowner signs FPL Net Metering Agreement. Sent by FPL after technical review.',
        required_small_system: true,
        required_large_system: true,
        prepared_by: 'homeowner',
      },
    ],
    ica_approval_days_min: 10,
    ica_approval_days_max: 20,
    timeline_note: 'FPL has one of the fastest interconnection timelines in the country for residential systems ≤10 kW: typically 10–20 business days. Florida statute 366.91 requires utilities to process within 30 business days.',
    pto_trigger: 'final_inspection',
    pto_days_min: 3,
    pto_days_max: 10,
    pto_steps: [
      'Step 1: Pass county final inspection. Receive signed permit card.',
      'Step 2: Upload final inspection documentation to FPL DG portal.',
      'Step 3: FPL may schedule a service appointment to install bidirectional meter (usually within 5–7 business days).',
      'Step 4: FPL issues PTO via email. Do not turn on system before this.',
      'Step 5: Turn on system. Monitor via inverter app. Net metering credits appear on next FPL bill.',
    ],
    homeowner_pto_checklist: [
      'County building final inspection passed and permit card signed',
      'Installer submitted PTO request to FPL with inspection docs',
      'FPL account email is correct for PTO letter',
      'Meter accessible for FPL service crew (bidirectional meter installation)',
      'Do not energize solar before FPL PTO letter received',
    ],
    common_rejections: [
      {
        reason: 'System AC capacity exceeds 115% of prior 12-month maximum demand',
        how_to_avoid: 'Size system to 100–110% of annual consumption. FPL restricts oversizing under Florida Net Metering rules. Provide 12-month bills.',
      },
    ],
    solar_pro_note: 'FPL is one of the fastest utilities for solar interconnection in the country. Standard ICA + PTO is typically 4–6 weeks total. Florida statute requires full retail NEM for systems ≤10 kW installed before 2027. Use this window urgently in your pitch — full retail net metering has a sunset date.',
    last_verified: '2025-06',
  },

  // ── Duke Energy Florida ───────────────────────────────────────────────────
  {
    utility_id: 'duke_fl',
    utility_name: 'Duke Energy Florida',
    state: 'FL',
    portal_type: 'online_portal',
    application_url: 'https://www.duke-energy.com/home/products/renewable-energy/generate-your-own',
    info_url: 'https://www.duke-energy.com/home/products/renewable-energy',
    interconnection_phone: '1-800-700-8744',
    application_form_name: 'Duke Energy Florida Distributed Generation Interconnection Application',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: false,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      {
        label: 'Online DG Application',
        description: 'Complete via Duke Energy\'s online portal. System specs, inverter model, installer license number required.',
        required_small_system: true,
        required_large_system: true,
        prepared_by: 'contractor',
      },
      {
        label: 'Single-Line Diagram',
        description: 'Electrical SLD showing all components.',
        required_small_system: true,
        required_large_system: true,
        prepared_by: 'contractor',
      },
    ],
    ica_approval_days_min: 15,
    ica_approval_days_max: 30,
    timeline_note: 'Duke Energy FL is typically 15–30 business days for residential systems. Slightly slower than FPL in practice.',
    pto_trigger: 'final_inspection',
    pto_days_min: 5,
    pto_days_max: 15,
    pto_steps: [
      'Step 1: Pass county final inspection.',
      'Step 2: Installer submits PTO request with inspection documentation to Duke Energy portal.',
      'Step 3: Duke Energy reviews and schedules meter upgrade if needed.',
      'Step 4: Duke Energy issues PTO letter via email.',
      'Step 5: Energize system after PTO received.',
    ],
    homeowner_pto_checklist: [
      'County final inspection passed',
      'Installer submitted PTO request',
      'Duke Energy account email current',
      'Do not energize before PTO letter',
    ],
    common_rejections: [
      {
        reason: 'Inverter not IEEE 1547-2018 compliant',
        how_to_avoid: 'Use only inverters with IEEE 1547-2018 certification for Florida grid support requirements.',
      },
    ],
    solar_pro_note: 'Duke Energy Florida has the same net metering sunset pressure as FPL — systems installed under current rules get retail NEM locked in for 20 years. Create urgency in pitch around NEM grandfathering window.',
    last_verified: '2025-06',
  },

  // ── BGE (Baltimore Gas & Electric) — Maryland ─────────────────────────────
  {
    utility_id: 'bge_md',
    utility_name: 'BGE (Baltimore Gas & Electric)',
    state: 'MD',
    portal_type: 'online_portal',
    application_url: 'https://www.bge.com/SmartEnergy/CleanEnergyOptions/Pages/Solar-Energy-Solar-Interconnection.aspx',
    info_url: 'https://www.bge.com/SmartEnergy/CleanEnergyOptions/Pages/Solar-Energy.aspx',
    interconnection_phone: '1-800-685-0123',
    application_form_name: 'BGE Interconnection Application (SmartEnergy Portal)',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: false,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      {
        label: 'BGE Interconnection Application',
        description: 'Submit via BGE SmartEnergy portal. Include system specs, SLD, and installer license.',
        required_small_system: true,
        required_large_system: true,
        prepared_by: 'contractor',
      },
    ],
    ica_approval_days_min: 10,
    ica_approval_days_max: 25,
    timeline_note: 'BGE processes residential systems (≤10 kW) in approximately 10–25 business days. Maryland law requires BGE to process within 30 days.',
    pto_trigger: 'final_inspection',
    pto_days_min: 5,
    pto_days_max: 15,
    pto_steps: [
      'Step 1: Pass AHJ final inspection.',
      'Step 2: Installer uploads inspection card to BGE portal.',
      'Step 3: BGE issues PTO letter and may schedule meter upgrade.',
      'Step 4: Energize after PTO letter received.',
      'Step 5: Register system for Maryland SRECs through GATS/PJM-ERTS.',
    ],
    homeowner_pto_checklist: [
      'Final inspection passed',
      'Installer submitted PTO request with inspection docs',
      'Maryland SREC registration initiated (earns income from day of PTO)',
      'Do not energize before PTO letter',
    ],
    common_rejections: [
      {
        reason: 'SREC registration not completed before energization',
        how_to_avoid: 'Register system with PJM-ERTS GATS system before PTO to ensure SRECs are credited from day one. Every week of delay = lost SREC income.',
      },
    ],
    solar_pro_note: 'Maryland SRECs (Solar Renewable Energy Credits) add significant ROI — currently $60–90/SREC, with each SREC representing 1 MWh of production. A typical 10 kW system earns ~12 SRECs/year. Always include SREC income in proposal financials. BGE territory has strong market value for solar + SRECs.',
    last_verified: '2025-06',
  },

  // ── Pepco Maryland/DC ─────────────────────────────────────────────────────
  {
    utility_id: 'pepco_md',
    utility_name: 'Pepco (Maryland)',
    state: 'MD',
    portal_type: 'online_portal',
    application_url: 'https://www.pepco.com/home/products-and-services/solar-energy/interconnection/',
    info_url: 'https://www.pepco.com/home/products-and-services/solar-energy/',
    interconnection_phone: '1-202-833-7500',
    application_form_name: 'Pepco Distributed Generation Interconnection Application',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: false,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      {
        label: 'Pepco DG Interconnection Application',
        description: 'Online application. Requires equipment list, SLD, system specs.',
        required_small_system: true,
        required_large_system: true,
        prepared_by: 'contractor',
      },
    ],
    ica_approval_days_min: 15,
    ica_approval_days_max: 30,
    timeline_note: 'Pepco residential interconnection: 15–30 business days. Maryland/DC grid has high interconnection volume — submit early.',
    pto_trigger: 'final_inspection',
    pto_days_min: 5,
    pto_days_max: 20,
    pto_steps: [
      'Step 1: Pass local final inspection.',
      'Step 2: Submit PTO request with inspection docs to Pepco portal.',
      'Step 3: Pepco reviews and may schedule meter work.',
      'Step 4: Pepco issues PTO letter.',
      'Step 5: Energize and register for MD SRECs.',
    ],
    homeowner_pto_checklist: [
      'Final inspection passed',
      'PTO request submitted',
      'SREC registration initiated',
      'Do not energize before PTO letter',
    ],
    common_rejections: [
      {
        reason: 'Incomplete equipment documentation',
        how_to_avoid: 'Attach full spec sheets for all inverters and panels including UL listing documentation.',
      },
    ],
    solar_pro_note: 'Pepco MD and DC customers have some of the highest electricity rates in the Mid-Atlantic ($0.15–0.19/kWh). Combined with MD SREC income, solar ROI is typically 6–9 years. Submit ICA at permit stage to avoid delays.',
    last_verified: '2025-06',
  },

  // ── PSEG New Jersey ───────────────────────────────────────────────────────
  {
    utility_id: 'pseg_nj',
    utility_name: 'PSE&G (Public Service Electric & Gas)',
    state: 'NJ',
    portal_type: 'online_portal',
    application_url: 'https://nj.pseg.com/home/saveenergymoney/solarenergy/interconnection',
    info_url: 'https://nj.pseg.com/home/saveenergymoney/solarenergy',
    interconnection_phone: '1-800-490-0075',
    application_form_name: 'PSE&G Net Metering / Interconnection Application (Customer Generation)',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: false,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      {
        label: 'Customer Generation Interconnection Application',
        description: 'Submit online. Include: system kW-DC, kW-AC, inverter model, equipment specs, SLD, and contractor\'s NJ Electrical Contractor license.',
        required_small_system: true,
        required_large_system: true,
        prepared_by: 'contractor',
      },
      {
        label: 'NJ-TRECS or SREC Registration',
        description: 'Register system with NJ Clean Energy SREC-II or TRECs (Transition Renewable Energy Certificates) program via NJCEP portal.',
        required_small_system: false,
        required_large_system: false,
        prepared_by: 'contractor',
      },
    ],
    ica_approval_days_min: 10,
    ica_approval_days_max: 20,
    timeline_note: 'PSE&G residential ≤10 kW: 10–20 business days. NJ BPU requires interconnection within 30 days. PSE&G has good hosting capacity in most suburban NJ circuits.',
    pto_trigger: 'final_inspection',
    pto_days_min: 5,
    pto_days_max: 15,
    pto_steps: [
      'Step 1: Pass local electrical inspection and receive Certificate of Approval.',
      'Step 2: Installer submits PTO request with certificate to PSE&G portal.',
      'Step 3: PSE&G verifies and issues PTO (bidirectional meter usually already in place for NEM customers).',
      'Step 4: Energize system after PTO letter received.',
      'Step 5: Register system for NJ TRECs/SRECs via NJCEP portal for ongoing income.',
    ],
    homeowner_pto_checklist: [
      'Municipal electrical inspection passed and certificate received',
      'Installer submitted PTO request to PSE&G',
      'NJ TREC registration initiated (earns income from day of PTO)',
      'PSE&G account email current for PTO letter',
      'Do not energize before PTO letter',
    ],
    common_rejections: [
      {
        reason: 'NJ Electrical Contractor license not on file',
        how_to_avoid: 'Ensure installer\'s NJ EC license number is included in application. PSE&G verifies license validity automatically.',
      },
    ],
    solar_pro_note: 'NJ TRECs (formerly SRECs) provide ~$91.20/TREC currently — a 10 kW system earns ~12 TRECs/year = $1,094/year in TREC income. Always include this in proposal financials. NJ solar + TREC income often produces a 5–7 year payback. PSE&G is one of the most solar-supportive utilities on the East Coast.',
    last_verified: '2025-06',
  },

  // ── PECO (Philadelphia Electric) — Pennsylvania ───────────────────────────
  {
    utility_id: 'peco_pa',
    utility_name: 'PECO Energy',
    state: 'PA',
    portal_type: 'online_portal',
    application_url: 'https://www.peco.com/MyAccount/MyBillUsage/Pages/Solar.aspx',
    info_url: 'https://www.peco.com/Safety/Environment/Pages/Solar.aspx',
    interconnection_phone: '1-800-494-4000',
    application_form_name: 'PECO Net Metering Application',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: false,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      {
        label: 'PECO Net Metering Application',
        description: 'Submit online. Includes: system specs, SLD, inverter model, contractor license.',
        required_small_system: true,
        required_large_system: true,
        prepared_by: 'contractor',
      },
    ],
    ica_approval_days_min: 15,
    ica_approval_days_max: 30,
    timeline_note: 'PECO residential ≤10 kW: 15–25 business days typical. PA PUC requires processing within 30 days for residential systems.',
    pto_trigger: 'final_inspection',
    pto_days_min: 5,
    pto_days_max: 15,
    pto_steps: [
      'Step 1: Pass local electrical inspection.',
      'Step 2: Installer uploads inspection documentation to PECO portal.',
      'Step 3: PECO issues PTO via email.',
      'Step 4: Energize after PTO received.',
      'Step 5: Register for PA SREC income through PJM-ERTS.',
    ],
    homeowner_pto_checklist: [
      'Electrical inspection passed',
      'PTO request submitted by installer',
      'PA SREC registration initiated',
      'Do not energize before PTO letter',
    ],
    common_rejections: [
      {
        reason: 'System size exceeds 110% of prior year load',
        how_to_avoid: 'Size system to match prior 12-month consumption. Provide 12-month bills to confirm compliance.',
      },
    ],
    solar_pro_note: 'PA SRECs trade at $30–50 currently. Include SREC income in proposal for PECO territory. Also mention PA Sunshine Solar Program legacy customers if applicable. PTO typically 2–3 weeks after inspection.',
    last_verified: '2025-06',
  },

  // ── Eversource (Massachusetts) ───────────────────────────────────────────
  {
    utility_id: 'eversource_ma',
    utility_name: 'Eversource Energy (Massachusetts)',
    state: 'MA',
    portal_type: 'online_portal',
    application_url: 'https://www.eversource.com/content/ema-c/residential/save-money-energy/explore-alternatives/solar-energy/interconnection-and-net-metering',
    info_url: 'https://www.eversource.com/content/ema-c/residential/save-money-energy/explore-alternatives/solar-energy',
    interconnection_phone: '1-800-592-2000',
    application_form_name: 'Eversource MA Net Metering / Interconnection Application',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: false,
    requires_sld: true,
    requires_stamped_planset: true,
    requirements: [
      {
        label: 'Interconnection Application',
        description: 'Submit via Eversource portal. Requires: SLD, equipment specs, MA contractor license (EL or A/B).',
        required_small_system: true,
        required_large_system: true,
        prepared_by: 'contractor',
      },
      {
        label: 'Stamped PE Plan Set (for systems >10 kW)',
        description: 'Massachusetts requires a Massachusetts PE-stamped plan set for systems above 10 kW.',
        required_small_system: false,
        required_large_system: true,
        prepared_by: 'contractor',
      },
      {
        label: 'MA SMART Program Enrollment (optional but valuable)',
        description: 'Enroll in MA SMART (Solar Massachusetts Renewable Target) program for additional $/kWh incentive. Capacity blocks sell out — enroll ASAP.',
        required_small_system: false,
        required_large_system: false,
        prepared_by: 'contractor',
      },
    ],
    ica_approval_days_min: 15,
    ica_approval_days_max: 45,
    timeline_note: 'Eversource MA residential: 15–30 business days for Expedited Review (≤25 kW). Slightly longer in Eastern MA (Boston suburbs) due to volume. MA DPU requires processing within 30 days for systems ≤25 kW.',
    pto_trigger: 'final_inspection',
    pto_days_min: 5,
    pto_days_max: 20,
    pto_steps: [
      'Step 1: Pass MA local electrical inspection.',
      'Step 2: Installer uploads inspection documentation to Eversource interconnection portal.',
      'Step 3: Eversource reviews and may schedule meter upgrade.',
      'Step 4: Eversource issues PTO letter via email.',
      'Step 5: Energize after PTO. Activate SMART program monitoring with MA DOER.',
    ],
    homeowner_pto_checklist: [
      'MA electrical inspection passed',
      'Eversource PTO request submitted with inspection docs',
      'SMART program enrollment completed (if applicable)',
      'Eversource account email current',
      'Do not energize before PTO letter',
    ],
    common_rejections: [
      {
        reason: 'MA SMART capacity block exhausted in the area',
        how_to_avoid: 'Check SMART program capacity availability by distribution company block before proposal. Inform homeowner of current incentive level.',
      },
    ],
    solar_pro_note: 'MA SMART program pays $0.15–0.20+/kWh over 10 years on top of net metering — transformative for ROI. A typical 10 kW system earns $1,500–2,000/year in SMART income. Always include SMART in proposal. Eversource ICA typically 3–6 weeks; submit at permit stage.',
    last_verified: '2025-06',
  },

  // ── Xcel Energy Colorado ──────────────────────────────────────────────────
  {
    utility_id: 'xcel_co',
    utility_name: 'Xcel Energy (Colorado)',
    state: 'CO',
    portal_type: 'online_portal',
    application_url: 'https://co.my.xcelenergy.com/s/renewable/solar-rewards',
    info_url: 'https://co.my.xcelenergy.com/s/renewable',
    interconnection_phone: '1-800-895-4999',
    application_form_name: 'Xcel Energy CO Interconnection Application (Renewable Connect Portal)',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: false,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      {
        label: 'Interconnection Application (Renewable Connect)',
        description: 'Submit online. Provide: system kW-DC, inverter model, SLD, contractor license.',
        required_small_system: true,
        required_large_system: true,
        prepared_by: 'contractor',
      },
    ],
    ica_approval_days_min: 10,
    ica_approval_days_max: 20,
    timeline_note: 'Xcel CO residential ≤10 kW: 10–20 business days. Colorado PUC requires within 30 days. Xcel is generally efficient in processing.',
    pto_trigger: 'final_inspection',
    pto_days_min: 5,
    pto_days_max: 15,
    pto_steps: [
      'Step 1: Pass local municipality final inspection.',
      'Step 2: Installer notifies Xcel Energy and uploads inspection docs.',
      'Step 3: Xcel schedules smart meter installation if needed.',
      'Step 4: Xcel issues PTO via email.',
      'Step 5: Energize after PTO received. Confirm net metering credits on first bill.',
    ],
    homeowner_pto_checklist: [
      'Local final inspection passed',
      'Installer submitted PTO request to Xcel',
      'Xcel account email current',
      'Smart meter accessible for installation',
      'Do not energize before PTO letter',
    ],
    common_rejections: [
      {
        reason: 'System size exceeds 120% of annual usage',
        how_to_avoid: 'Colorado allows up to 120% of prior 12-month consumption. Size appropriately and provide 12-month bill history.',
      },
    ],
    solar_pro_note: 'Xcel CO offers Solar*Rewards performance-based incentive (where available) plus full retail net metering. Xcel has one of the cleaner approval processes in the country. Include Xcel solar rebate in proposal if still available in the ZIP code. PTO typically 1–2 weeks after inspection.',
    last_verified: '2025-06',
  },

  // ── DTE Energy — Michigan ─────────────────────────────────────────────────
  {
    utility_id: 'dte_mi',
    utility_name: 'DTE Energy (Michigan)',
    state: 'MI',
    portal_type: 'online_portal',
    application_url: 'https://solutions.dteenergy.com/dte/en/Services/CleanVision-Service/Rooftop-Solar-and-Private-Generation/p/ROOFTOP_SOLAR',
    info_url: 'https://solutions.dteenergy.com/dte/en/Services/CleanVision-Service/Rooftop-Solar-and-Private-Generation/p/ROOFTOP_SOLAR',
    interconnection_phone: '1-800-477-4747',
    application_form_name: 'DTE Energy Distributed Generation Interconnection Application',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: false,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      {
        label: 'DG Interconnection Application',
        description: 'Submit online. System specs, SLD, equipment list, Michigan contractor license required.',
        required_small_system: true,
        required_large_system: true,
        prepared_by: 'contractor',
      },
    ],
    ica_approval_days_min: 15,
    ica_approval_days_max: 30,
    timeline_note: 'DTE residential: 15–30 business days. Michigan MPSC requires within 30 days for ≤20 kW systems.',
    pto_trigger: 'final_inspection',
    pto_days_min: 5,
    pto_days_max: 20,
    pto_steps: [
      'Step 1: Pass local electrical inspection.',
      'Step 2: Installer uploads inspection docs to DTE portal.',
      'Step 3: DTE reviews and may require meter upgrade (smart meter).',
      'Step 4: DTE issues PTO letter.',
      'Step 5: Energize system.',
    ],
    homeowner_pto_checklist: [
      'Electrical inspection passed',
      'PTO request submitted by installer',
      'DTE account email current',
      'Do not energize before PTO letter',
    ],
    common_rejections: [
      {
        reason: 'Installer not registered with DTE Energy solar contractor database',
        how_to_avoid: 'Register contractor with DTE Energy\'s approved solar installer list before submitting any applications.',
      },
    ],
    solar_pro_note: 'DTE Michigan offers the DTE ConnectedSolution battery demand-response program — one of the best residential battery programs in the Midwest. $525/year for Tesla Powerwall enrollment. Always include in battery proposals for DTE territory. PTO typically 2–4 weeks.',
    last_verified: '2025-06',
  },

  // ── APS (Arizona Public Service) ─────────────────────────────────────────
  {
    utility_id: 'aps_az',
    utility_name: 'Arizona Public Service (APS)',
    state: 'AZ',
    portal_type: 'online_portal',
    application_url: 'https://www.aps.com/en/Residential/Service-Plans/Understanding-Solar',
    info_url: 'https://www.aps.com/en/Residential/Service-Plans/Understanding-Solar',
    interconnection_phone: '1-602-371-7171',
    application_form_name: 'APS Distributed Energy Resource Application (DERa Portal)',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: false,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      {
        label: 'APS DERa Application',
        description: 'Online via APS DERa portal. System specs, SLD, equipment list, ROC license required.',
        required_small_system: true,
        required_large_system: true,
        prepared_by: 'contractor',
      },
      {
        label: 'Arizona ROC License',
        description: 'Installer must hold valid AZ Registrar of Contractors license. Solar contractors need CR-77 classification.',
        required_small_system: true,
        required_large_system: true,
        prepared_by: 'contractor',
      },
    ],
    ica_approval_days_min: 5,
    ica_approval_days_max: 20,
    timeline_note: 'APS is one of the fastest utilities — residential ≤10 kW typically 5–15 business days. Arizona\'s high solar adoption means APS has streamlined the process significantly.',
    pto_trigger: 'final_inspection',
    pto_days_min: 3,
    pto_days_max: 10,
    pto_steps: [
      'Step 1: Pass city or county final inspection.',
      'Step 2: Installer uploads inspection docs to APS DERa portal.',
      'Step 3: APS approves and issues PTO (often same day or next day for small systems).',
      'Step 4: Energize system.',
      'Step 5: Monitor APS account for net export credits.',
    ],
    homeowner_pto_checklist: [
      'Final inspection passed and permit card signed',
      'Installer uploaded inspection docs to APS portal',
      'APS account email current',
      'Do not energize before PTO letter (even though APS is fast)',
    ],
    common_rejections: [
      {
        reason: 'Export capacity causes voltage violations on circuit',
        how_to_avoid: 'APS has hosting capacity constraints in some East Valley circuits. Check APS DRP map. Add export limiting (Smart Inverter VW/VR mode) if flagged.',
      },
    ],
    solar_pro_note: 'APS export rates are low (~$0.026–0.044/kWh under APS Saver Choice or Resource Choice plans). Always pitch solar + battery for maximum bill savings. APS is one of the fastest utilities for PTO in the country — 3–5 business days is common. Use this speed as a sales point ("You\'ll be producing power in weeks, not months").',
    last_verified: '2025-06',
  },

  // ── SRP (Salt River Project) — Arizona ───────────────────────────────────
  {
    utility_id: 'srp_az',
    utility_name: 'Salt River Project (SRP)',
    state: 'AZ',
    portal_type: 'online_portal',
    application_url: 'https://www.srpnet.com/energy-savings-rebates/home/residential-solar/rooftop-solar',
    info_url: 'https://www.srpnet.com/energy-savings-rebates/home/residential-solar/rooftop-solar',
    interconnection_phone: '1-602-236-8888',
    application_form_name: 'SRP Customer Generation Interconnection Application',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: false,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      {
        label: 'SRP Customer Generation Application',
        description: 'Online via SRP portal. System specs, SLD, equipment list, AZ ROC license.',
        required_small_system: true,
        required_large_system: true,
        prepared_by: 'contractor',
      },
    ],
    ica_approval_days_min: 10,
    ica_approval_days_max: 20,
    timeline_note: 'SRP residential: 10–20 business days. SRP is a cooperative with efficient processes.',
    pto_trigger: 'final_inspection',
    pto_days_min: 3,
    pto_days_max: 10,
    pto_steps: [
      'Step 1: Pass local final inspection.',
      'Step 2: Installer notifies SRP and uploads inspection docs.',
      'Step 3: SRP issues PTO authorization.',
      'Step 4: Energize system.',
    ],
    homeowner_pto_checklist: [
      'Final inspection passed',
      'Installer submitted PTO request to SRP',
      'SRP account email current',
      'Do not energize before PTO authorization',
    ],
    common_rejections: [
      {
        reason: 'System not sized per SRP\'s 8 kW export cap for residential',
        how_to_avoid: 'SRP caps residential solar exports at 8 kW AC. Size system accordingly or add export limiting if system is larger.',
      },
    ],
    solar_pro_note: 'SRP has a controversial low export rate structure — but solar + battery is a strong value proposition here because battery charges at low SRP off-peak rates and displaces high-cost on-peak demand charges. SRP\'s E-27 rate has a significant demand charge that battery storage can shave dramatically.',
    last_verified: '2025-06',
  },

  // ── Duke Energy Carolinas / Duke Energy Progress ──────────────────────────
  {
    utility_id: 'duke_nc',
    utility_name: 'Duke Energy Carolinas / Duke Energy Progress',
    state: 'NC',
    portal_type: 'online_portal',
    application_url: 'https://www.duke-energy.com/home/products/renewable-energy/generate-your-own',
    info_url: 'https://www.duke-energy.com/home/products/renewable-energy',
    interconnection_phone: '1-800-777-9898',
    application_form_name: 'Duke Energy NC Distributed Generation Interconnection Application',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: false,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      {
        label: 'Online DG Interconnection Application',
        description: 'Submit via Duke Energy portal. System specs, SLD, equipment list, NC contractor license.',
        required_small_system: true,
        required_large_system: true,
        prepared_by: 'contractor',
      },
    ],
    ica_approval_days_min: 15,
    ica_approval_days_max: 30,
    timeline_note: 'Duke Energy NC: 15–30 business days for residential. NC Utilities Commission requires 30-day processing for ≤20 kW.',
    pto_trigger: 'final_inspection',
    pto_days_min: 5,
    pto_days_max: 20,
    pto_steps: [
      'Step 1: Pass state electrical inspection (NC DBIA).',
      'Step 2: Installer submits PTO request to Duke Energy with inspection docs.',
      'Step 3: Duke Energy reviews and issues PTO letter.',
      'Step 4: Energize system.',
      'Step 5: Apply for NC Renewable Energy Tax Credit (35% state credit, combined with 26–30% federal ITC).',
    ],
    homeowner_pto_checklist: [
      'NC state electrical inspection (DBIA) passed',
      'Duke Energy PTO request submitted',
      'NC Renewable Energy Tax Credit filing prepared (up to 35%)',
      'Do not energize before PTO letter',
    ],
    common_rejections: [
      {
        reason: 'NC state electrical inspection not completed (common mistake — city inspection is NOT sufficient)',
        how_to_avoid: 'NC requires both local municipal AND NC state electrical (DBIA) inspection. Both must be passed before PTO request.',
      },
    ],
    solar_pro_note: 'NC has a 35% state renewable energy tax credit (capped at $10,500) on top of the federal ITC — this is a MASSIVE financial advantage that most homeowners don\'t know about. Always lead with this in the pitch. Duke Energy PTO is typically 2–4 weeks. Mention the dual inspection requirement so homeowners understand the timeline.',
    last_verified: '2025-06',
  },

  // ── Georgia Power ─────────────────────────────────────────────────────────
  {
    utility_id: 'georgia_power',
    utility_name: 'Georgia Power',
    state: 'GA',
    portal_type: 'online_portal',
    application_url: 'https://www.georgiapower.com/content/dam/georgia-power/pdfs/company-pdfs/solar-pdfs/btm-distribution-interconnection-summary-residential.pdf',
    info_url: 'https://www.georgiapower.com/residential/solutions/solar.html',
    interconnection_phone: '1-888-655-5888',
    application_form_name: 'Georgia Power SSVR / Customer-Sited Renewable Application',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: false,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      {
        label: 'Customer-Sited Renewable Application',
        description: 'Online submission. System specs, SLD, Georgia contractor license (EA or EE).',
        required_small_system: true,
        required_large_system: true,
        prepared_by: 'contractor',
      },
    ],
    ica_approval_days_min: 10,
    ica_approval_days_max: 25,
    timeline_note: 'Georgia Power residential ≤10 kW: 10–25 business days. GPSC requires 30-day processing.',
    pto_trigger: 'final_inspection',
    pto_days_min: 5,
    pto_days_max: 15,
    pto_steps: [
      'Step 1: Pass local county electrical inspection.',
      'Step 2: Installer submits PTO request with inspection documentation.',
      'Step 3: Georgia Power issues PTO letter.',
      'Step 4: Energize system.',
    ],
    homeowner_pto_checklist: [
      'County electrical inspection passed',
      'PTO request submitted',
      'Georgia Power account email current',
      'Do not energize before PTO letter',
    ],
    common_rejections: [
      {
        reason: 'System size exceeds 10 kW without commercial application',
        how_to_avoid: 'Residential solar limit for standard interconnection is 10 kW-AC. For larger systems, use commercial application process.',
      },
    ],
    solar_pro_note: 'Georgia Power has moved to Avoided Cost rate for net metering exports (approximately $0.037/kWh) — much lower than retail. Battery storage is essential to maximize bill savings in Georgia Power territory. PTO typically 1–3 weeks. Georgia has no state income tax credit for solar, so lead with federal ITC only.',
    last_verified: '2025-06',
  },

  // ── Dominion Energy Virginia ──────────────────────────────────────────────
  {
    utility_id: 'dominion_va',
    utility_name: 'Dominion Energy Virginia',
    state: 'VA',
    portal_type: 'online_portal',
    application_url: 'https://www.dominionenergy.com/en/Virginia/Renewable-Energy-Programs/Net-Metering',
    info_url: 'https://www.dominionenergy.com/en/Virginia/Renewable-Energy-Programs',
    interconnection_phone: '1-866-366-4357',
    application_form_name: 'Dominion Energy VA Customer Solar Interconnection Application',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: false,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      {
        label: 'Customer Solar Interconnection Application',
        description: 'Online via Dominion Energy portal. System specs, SLD, VA DPOR license required.',
        required_small_system: true,
        required_large_system: true,
        prepared_by: 'contractor',
      },
    ],
    ica_approval_days_min: 15,
    ica_approval_days_max: 30,
    timeline_note: 'Dominion VA residential: 15–30 business days. SCC requires 30-day processing.',
    pto_trigger: 'final_inspection',
    pto_days_min: 5,
    pto_days_max: 20,
    pto_steps: [
      'Step 1: Pass VA local electrical inspection.',
      'Step 2: Installer submits PTO request with inspection card to Dominion portal.',
      'Step 3: Dominion issues PTO letter via email.',
      'Step 4: Energize system.',
    ],
    homeowner_pto_checklist: [
      'Local electrical inspection passed',
      'PTO request submitted by installer',
      'Dominion account email current',
      'Do not energize before PTO letter',
    ],
    common_rejections: [
      {
        reason: 'System exceeds 1 kW per kVA of service transformer',
        how_to_avoid: 'Verify transformer capacity in Dominion service entrance documentation. Oversized systems relative to transformer may require engineering review.',
      },
    ],
    solar_pro_note: 'Virginia\'s VCEA (Clean Economy Act) mandates aggressive utility renewable targets — use this as a political/environmental sales point. Dominion has a decent net metering program (full retail credits for ≤25 kW). VA has no state solar tax credit currently, so federal ITC is the primary incentive. PTO typically 2–4 weeks.',
    last_verified: '2025-06',
  },

  // ── Entergy Louisiana ─────────────────────────────────────────────────────
  {
    utility_id: 'entergy_la',
    utility_name: 'Entergy Louisiana',
    state: 'LA',
    portal_type: 'email_submission',
    application_url: 'https://www.entergylouisiana.com/net-metering/process',
    info_url: 'https://www.entergylouisiana.com/net-metering/process',
    interconnection_phone: '1-800-368-3749',
    interconnection_email: 'netmetering@entergy.com',
    application_form_name: 'Entergy Louisiana Distributed Generation Application',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: false,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      {
        label: 'DG Application (email or mail)',
        description: 'Email to netmetering@entergy.com. Include: system specs, SLD, homeowner contact, and contractor license.',
        required_small_system: true,
        required_large_system: true,
        prepared_by: 'contractor',
      },
    ],
    ica_approval_days_min: 20,
    ica_approval_days_max: 45,
    timeline_note: 'Entergy LA is one of the slower utilities — email-based process can take 20–45 business days. Follow up weekly. Louisiana PSC mandates 45-day processing window.',
    pto_trigger: 'final_inspection',
    pto_days_min: 10,
    pto_days_max: 30,
    pto_steps: [
      'Step 1: Pass local inspection.',
      'Step 2: Email completed PTO request package to Entergy netmetering email.',
      'Step 3: Entergy reviews and schedules meter upgrade (often requires service appointment).',
      'Step 4: Entergy sends PTO authorization letter.',
      'Step 5: Energize after PTO received.',
    ],
    homeowner_pto_checklist: [
      'Local inspection passed',
      'Installer emailed PTO request to Entergy',
      'Prepare for 2–4 week wait for Entergy response',
      'Do not energize before PTO authorization',
    ],
    common_rejections: [
      {
        reason: 'Email application missing required documents',
        how_to_avoid: 'Send complete package in one email: cover letter, application form, SLD, equipment specs, insurance certificate. Do not send in multiple emails.',
      },
    ],
    solar_pro_note: 'Entergy LA has a slow process — set proper expectations with homeowners (8–12 weeks total from permit to PTO is typical). Louisiana offers no state solar tax credit but the federal ITC is still significant. Entergy has very low electricity rates ($0.09–0.11/kWh) so solar ROI is longer — size systems carefully and consider battery for resilience pitch rather than savings-led pitch.',
    last_verified: '2025-06',
  },

  // ── Centerpoint Energy — Texas (Houston) ─────────────────────────────────
  {
    utility_id: 'centerpoint_tx',
    utility_name: 'CenterPoint Energy (Houston, TX)',
    state: 'TX',
    portal_type: 'online_portal',
    application_url: 'https://www.centerpointenergy.com/en-us/residential/services/electric-utility/electric-technology/solar-energy/connecting-your-system-to-the-grid?sa=ho',
    info_url: 'https://www.centerpointenergy.com/en-us/residential/services/electric-utility/electric-technology/solar-energy/connecting-your-system-to-the-grid?sa=ho',
    interconnection_phone: '1-800-332-7143',
    application_form_name: 'CenterPoint Energy Distributed Generation Interconnection Application',
    requires_nem_application: false,
    requires_signed_ica: true,
    requires_anti_islanding_cert: true,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      {
        label: 'CenterPoint DG Interconnection Application',
        description: 'Online application to CenterPoint (the wires company). Note: retail electric provider (REP) separately handles billing/credits. System specs, SLD, TDSP-registered installer required.',
        required_small_system: true,
        required_large_system: true,
        prepared_by: 'contractor',
      },
      {
        label: 'REP Coordination for Buyback',
        description: 'Texas ERCOT territory has no mandatory net metering. The homeowner\'s Retail Electric Provider (REP) determines the solar buyback rate. Coordinate with the homeowner\'s REP before installation.',
        required_small_system: true,
        required_large_system: true,
        prepared_by: 'both',
      },
      {
        label: 'Anti-Islanding Certification',
        description: 'Texas ERCOT requires IEEE 1547/UL 1741 anti-islanding compliance documentation with application.',
        required_small_system: true,
        required_large_system: true,
        prepared_by: 'contractor',
      },
    ],
    ica_approval_days_min: 10,
    ica_approval_days_max: 20,
    timeline_note: 'CenterPoint (Houston TDSP) residential ≤25 kW: 10–20 business days. Texas PUCT requires processing within 20 business days for residential.',
    pto_trigger: 'final_inspection',
    pto_days_min: 5,
    pto_days_max: 15,
    pto_steps: [
      'Step 1: Pass Houston city electrical inspection or county inspection.',
      'Step 2: Installer notifies CenterPoint with inspection documentation.',
      'Step 3: CenterPoint completes meter upgrade to advanced meter (if not already installed).',
      'Step 4: CenterPoint issues interconnection approval.',
      'Step 5: Contact homeowner\'s REP to enroll in solar buyback program (e.g., TXU SolarBuyback, Reliant Solar Advantage).',
      'Step 6: Energize system.',
    ],
    homeowner_pto_checklist: [
      'City/county electrical inspection passed',
      'CenterPoint interconnection approval received',
      'REP solar buyback enrollment confirmed (this is separate from CenterPoint!)',
      'Advanced meter installed by CenterPoint',
      'Do not energize before CenterPoint interconnection approval AND REP buyback enrollment',
    ],
    common_rejections: [
      {
        reason: 'Installer not registered as TDSP-approved installer in ERCOT system',
        how_to_avoid: 'Ensure installer is registered in the ERCOT/CenterPoint approved contractor database before submitting applications.',
      },
      {
        reason: 'Homeowner\'s REP does not offer solar buyback',
        how_to_avoid: 'Help homeowner switch to a REP with a strong solar buyback rate (e.g., TXU SolarBuyback at $0.035/kWh, or Rhythm Energy at higher rates). Do this BEFORE installation.',
      },
    ],
    solar_pro_note: 'Texas (ERCOT) is unique — CenterPoint is just the wires company, not the power seller. The homeowner\'s REP controls the solar export credit rate. This is a major differentiator: help your customer choose a REP with a strong solar buyback program. Rhythm Energy, TXU SolarBuyback, and others compete aggressively. ICA approval 2–3 weeks; total timeline to PTO is typically 4–8 weeks.',
    last_verified: '2025-06',
  },

  // ── Oncor — Texas (DFW) ───────────────────────────────────────────────────
  {
    utility_id: 'oncor_tx',
    utility_name: 'Oncor Electric Delivery (DFW, TX)',
    state: 'TX',
    portal_type: 'online_portal',
    application_url: 'https://www.oncor.com/EN/Pages/DG-Interconnection.aspx',
    info_url: 'https://www.oncor.com/EN/Pages/Renewable-Energy.aspx',
    interconnection_phone: '1-888-313-4747',
    application_form_name: 'Oncor Distributed Generation Interconnection Application',
    requires_nem_application: false,
    requires_signed_ica: true,
    requires_anti_islanding_cert: true,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      {
        label: 'Oncor DG Interconnection Application',
        description: 'Online portal application. Wires-only company in ERCOT. Separate REP buyback arrangement required.',
        required_small_system: true,
        required_large_system: true,
        prepared_by: 'contractor',
      },
    ],
    ica_approval_days_min: 10,
    ica_approval_days_max: 20,
    timeline_note: 'Oncor residential: 10–20 business days. Same PUCT 20-day requirement as other TX TDSPs.',
    pto_trigger: 'final_inspection',
    pto_days_min: 5,
    pto_days_max: 15,
    pto_steps: [
      'Step 1: Pass city/county electrical inspection.',
      'Step 2: Submit PTO request to Oncor with inspection docs.',
      'Step 3: Oncor approves interconnection.',
      'Step 4: Coordinate with homeowner\'s REP for solar buyback enrollment.',
      'Step 5: Energize system.',
    ],
    homeowner_pto_checklist: [
      'Local electrical inspection passed',
      'Oncor interconnection approval received',
      'REP solar buyback program enrolled (contact REP separately)',
      'Advanced meter installed',
      'Do not energize before Oncor approval AND REP enrollment',
    ],
    common_rejections: [
      {
        reason: 'Anti-islanding documentation not attached',
        how_to_avoid: 'Attach IEEE 1547 / UL 1741 SA compliance certificate for inverter with application.',
      },
    ],
    solar_pro_note: 'Same Texas ERCOT situation as CenterPoint — the REP buyback rate is the critical sales variable in the DFW market. Help homeowners pick the right REP. TXU Energy SolarBuyback, Green Mountain Energy, and Rhythm Energy are popular choices in the DFW area.',
    last_verified: '2025-06',
  },

  // ── Nevada Energy ─────────────────────────────────────────────────────────
  {
    utility_id: 'nv_energy',
    utility_name: 'NV Energy (Nevada)',
    state: 'NV',
    portal_type: 'online_portal',
    application_url: 'https://www.nvenergy.com/cleanenergy/solar/interconnection-process',
    info_url: 'https://www.nvenergy.com/cleanenergy/solar',
    interconnection_phone: '1-800-634-6359',
    application_form_name: 'NV Energy NEM-R (Net Metering Residential) Application',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: false,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      {
        label: 'NEM-R Application',
        description: 'Online application. System specs, SLD, NV contractor license (C-2 Electrical).',
        required_small_system: true,
        required_large_system: true,
        prepared_by: 'contractor',
      },
    ],
    ica_approval_days_min: 10,
    ica_approval_days_max: 25,
    timeline_note: 'NV Energy residential ≤25 kW: 10–25 business days. PUCN requires within 30 days.',
    pto_trigger: 'final_inspection',
    pto_days_min: 5,
    pto_days_max: 15,
    pto_steps: [
      'Step 1: Pass Clark County (or Washoe County) electrical inspection.',
      'Step 2: Submit PTO request to NV Energy with inspection documentation.',
      'Step 3: NV Energy issues PTO letter via email.',
      'Step 4: Energize system.',
    ],
    homeowner_pto_checklist: [
      'County electrical inspection passed',
      'Installer submitted PTO request to NV Energy',
      'NV Energy account email current',
      'Do not energize before PTO letter',
    ],
    common_rejections: [
      {
        reason: 'Application submitted outside NEM capacity cap window',
        how_to_avoid: 'Nevada has a statewide NEM capacity cap (3% of peak demand). Check PUCN docket for current availability. If cap is full, homeowner joins waitlist.',
      },
    ],
    solar_pro_note: 'Nevada NEM (grandfathered full retail) vs. newer reduced-export rates is a key talking point — customers installing now may get better terms than those who wait. Las Vegas solar production is among the highest in the country (>300 sunny days/year). Solar ROI in NV Energy territory is typically 7–10 years with clean federal ITC only.',
    last_verified: '2025-06',
  },

  // ── LADWP — Los Angeles, CA ────────────────────────────────────────────────
  {
    utility_id: 'ladwp_ca',
    utility_name: 'Los Angeles Department of Water and Power (LADWP)',
    state: 'CA',
    portal_type: 'online_portal',
    application_url: 'https://www.ladwp.com/residential-services/solar-programs/solar-rooftops',
    info_url: 'https://www.ladwp.com/residential-services/solar-programs',
    interconnection_phone: '1-800-342-5397',
    application_form_name: 'LADWP Solar Rooftop Program / Net Energy Metering Application',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: true,
    requires_sld: true,
    requires_stamped_planset: true,
    requirements: [
      { label: 'NEM Application', description: 'Submit NEM application online via LADWP Solar Rooftop portal. Include system specs and equipment list.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Single-Line Diagram', description: 'Engineer-stamped SLD required for systems over 10 kW.', required_small_system: false, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Equipment Spec Sheets', description: 'CEC-listed inverter and module spec sheets.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'City Permit', description: 'LADBS building permit must be obtained. LADWP coordinates with city during interconnection review.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
    ],
    ica_approval_days_min: 20,
    ica_approval_days_max: 45,
    timeline_note: 'LADWP typically takes 30–45 business days for interconnection approval. Systems over 10 kW or with battery storage may take longer due to additional engineering review.',
    pto_trigger: 'final_inspection',
    pto_days_min: 10,
    pto_days_max: 30,
    pto_steps: [
      '1. Pass City of LA building inspection — inspector signs off on the permit card.',
      '2. Upload signed inspection card to LADWP Solar Rooftop portal (or mail to LADWP).',
      '3. LADWP reviews inspection results and performs utility-side meter work.',
      '4. LADWP installs bi-directional net meter (usually 2–4 weeks after inspection upload).',
      '5. PTO letter issued by LADWP — system may be energized after receiving letter.',
    ],
    homeowner_pto_checklist: [
      'City building inspection passed and permit card signed',
      'Inspection card or approval uploaded to LADWP portal',
      'LADWP has your current mailing address for PTO letter',
      'Do NOT turn system on until LADWP PTO letter is received',
    ],
    common_rejections: [
      { reason: 'Incomplete NEM application — missing equipment specs', how_to_avoid: 'Include CEC-listed equipment data sheets and inverter model numbers with application.' },
      { reason: 'Permit not pulled before interconnection application', how_to_avoid: 'Obtain LADBS building permit before or concurrent with NEM application submission.' },
      { reason: 'System size exceeds NEM capacity at meter', how_to_avoid: 'Confirm NEM is available at address — LADWP may have localized NEM caps in some circuits.' },
    ],
    solar_pro_note: 'LADWP is LA city-owned and separate from SCE/SDG&E — it follows NEM 2.0 (not CA NEM 3.0). This is a key selling point: LADWP customers still get full retail-rate NEM credit. ROI is typically 6–9 years. High solar production (sunshine) and among highest city rates in CA make LADWP territory one of the best solar markets in the US.',
    last_verified: '2025-06',
  },

  // ── SMUD — Sacramento, CA ──────────────────────────────────────────────────
  {
    utility_id: 'smud_ca',
    utility_name: 'Sacramento Municipal Utility District (SMUD)',
    state: 'CA',
    portal_type: 'online_portal',
    application_url: 'https://www.smud.org/en/Going-Green/Solar-Power/For-your-home/How-to-Connect',
    info_url: 'https://www.smud.org/en/Going-Green/Solar-Power',
    interconnection_phone: '1-888-742-7683',
    application_form_name: 'SMUD Solar / Interconnection Application',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: true,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      { label: 'Interconnection Application', description: 'Online application via SMUD portal. Includes system size, equipment, and site information.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Single-Line Diagram', description: 'Required for all systems. Must show equipment, disconnects, and utility connection point.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Equipment Spec Sheets', description: 'CEC-listed module and inverter data sheets required.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Sacramento County Permit', description: 'Building permit from local AHJ required before SMUD can issue PTO.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
    ],
    ica_approval_days_min: 10,
    ica_approval_days_max: 30,
    timeline_note: 'SMUD is known for faster interconnection turnaround than CA IOUs. Small residential systems typically approved in 10–20 business days. Battery storage adds 5–15 days.',
    pto_trigger: 'final_inspection',
    pto_days_min: 5,
    pto_days_max: 15,
    pto_steps: [
      '1. Pass AHJ (city/county) building inspection — collect signed inspection card.',
      '2. Contact SMUD or submit inspection proof through SMUD portal.',
      '3. SMUD upgrades meter to bi-directional net meter within 1–2 weeks.',
      '4. SMUD sends PTO authorization — energize system only after authorization received.',
    ],
    homeowner_pto_checklist: [
      'Building permit inspection passed and card signed',
      'Inspection documentation submitted to SMUD',
      'Do NOT energize system until SMUD confirms PTO',
    ],
    common_rejections: [
      { reason: 'System over-sized for NEM eligibility', how_to_avoid: 'Size system to 100% of 12-month historical usage or less.' },
      { reason: 'Missing or incorrect SLD', how_to_avoid: "Use SMUD's SLD template or ensure your SLD matches SMUD's required format." },
    ],
    solar_pro_note: 'SMUD is a public utility and not subject to CA NEM 3.0. SMUD has its own NEM program with favorable export rates compared to PG&E/SCE/SDG&E. Sacramento\'s solar production is excellent (~2,200 kWh/kW/year). One of the best-value solar markets in California.',
    last_verified: '2025-06',
  },

  // ── Con Edison — New York City / Westchester, NY ────────────────────────────
  {
    utility_id: 'con_ed_ny',
    utility_name: 'Consolidated Edison (Con Edison)',
    state: 'NY',
    portal_type: 'online_portal',
    application_url: 'https://www.coned.com/en/save-money/using-distributed-generation-energy-sources/applying-for-interconnection',
    info_url: 'https://www.coned.com/en/save-money/using-distributed-generation-energy-sources',
    interconnection_phone: '1-800-752-6633',
    application_form_name: 'Con Edison Distributed Generation Interconnection Application',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: true,
    requires_sld: true,
    requires_stamped_planset: true,
    requirements: [
      { label: 'DG Interconnection Application', description: 'Submit via Con Edison online portal. Requires system specs, equipment list, and site address.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Stamped Single-Line Diagram', description: 'PE-stamped SLD required for all residential systems in NYC/Westchester.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Equipment Documentation', description: 'UL-listed inverter and module datasheets. NYC requires additional fire department labeling.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'NYC DOB Permit', description: 'NYC Department of Buildings permit required for NYC installations. Westchester requires local AHJ permit.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
    ],
    ica_approval_days_min: 30,
    ica_approval_days_max: 90,
    timeline_note: 'Con Edison interconnection is among the slowest in the nation due to NYC density and grid complexity. Expect 30–60 business days for standard residential. NYC DOB permitting adds additional time. Strongly recommend submitting interconnection and permit applications concurrently.',
    pto_trigger: 'final_inspection',
    pto_days_min: 15,
    pto_days_max: 45,
    pto_steps: [
      '1. Pass NYC DOB (or local AHJ) final inspection — collect signed inspection sign-off.',
      '2. Submit inspection documentation to Con Edison via interconnection portal.',
      '3. Con Edison performs site inspection / meter work (may require scheduling appointment).',
      '4. Con Edison installs net meter and issues PTO authorization letter.',
      '5. Energize system only after receiving Con Edison PTO letter.',
    ],
    homeowner_pto_checklist: [
      'NYC DOB or local AHJ final inspection passed',
      'Inspection documentation submitted to Con Edison',
      'Con Edison site visit scheduled if required',
      'Do NOT energize system until Con Edison PTO received',
    ],
    common_rejections: [
      { reason: 'Missing NYC-specific fire department labeling requirements', how_to_avoid: 'Ensure all rapid shutdown labels, roof access markings, and DC conduit labels comply with NYC FC 1204.2.' },
      { reason: 'PE stamp on SLD not licensed in New York State', how_to_avoid: 'PE stamp must be from a NY State-licensed professional engineer.' },
      { reason: 'System size exceeds 110% of annual usage', how_to_avoid: 'Con Edison requires system be sized to no more than 110% of prior 12-month usage.' },
    ],
    solar_pro_note: 'Con Edison territory (NYC + Westchester) is extremely challenging — high cost of installation, complex permitting, and slow utility. However NY state has excellent solar incentives: NY-Sun rebate ($0.20–$0.40/W), federal ITC, and strong net metering. ROI is typically 8–12 years but long-term value is high given NYC electricity rates (~$0.25–$0.30/kWh).',
    last_verified: '2025-06',
  },

  // ── LIPA — Long Island, NY ──────────────────────────────────────────────────
  {
    utility_id: 'lipa_ny',
    utility_name: 'Long Island Power Authority (LIPA / PSEG Long Island)',
    state: 'NY',
    portal_type: 'online_portal',
    application_url: 'https://www.psegliny.com/solar',
    info_url: 'https://www.psegliny.com/solar',
    interconnection_phone: '1-800-490-0025',
    application_form_name: 'LIPA/PSEG Long Island Interconnection Application',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: true,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      { label: 'Interconnection Application', description: 'Online application through PSEG Long Island solar portal. Includes equipment, site plan, and system size.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Single-Line Diagram', description: 'Standard SLD showing AC/DC disconnects, inverter, and utility connection.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Local AHJ Permit', description: 'Long Island town/village building permit required. Many LI municipalities have expedited solar permitting.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
    ],
    ica_approval_days_min: 20,
    ica_approval_days_max: 45,
    timeline_note: 'PSEG Long Island typically processes residential interconnections in 20–30 business days. Battery storage adds 10–20 days for additional review.',
    pto_trigger: 'final_inspection',
    pto_days_min: 10,
    pto_days_max: 25,
    pto_steps: [
      '1. Pass local town/village building inspection.',
      '2. Submit signed inspection card to PSEG Long Island via online portal or email.',
      '3. PSEG Long Island reviews and schedules meter upgrade.',
      '4. Bi-directional net meter installed and PTO issued.',
    ],
    homeowner_pto_checklist: [
      'Local AHJ building inspection passed',
      'Inspection documentation submitted to PSEG Long Island',
      'Do NOT turn on system until PTO received',
    ],
    common_rejections: [
      { reason: 'System over-sized relative to prior usage', how_to_avoid: 'Size to 100% of 12-month historical load or obtain LIPA pre-approval for oversized system.' },
    ],
    solar_pro_note: 'LIPA territory (Long Island) has excellent solar economics — high electricity rates (~$0.24/kWh), strong NY-Sun incentives, and full retail net metering (NY NEM 2.0). Long Island typically has shorter permitting timelines than NYC. Good ROI market: typically 7–10 years.',
    last_verified: '2025-06',
  },

  // ── NYSEG — Upstate New York ───────────────────────────────────────────────
  {
    utility_id: 'nyseg_ny',
    utility_name: 'New York State Electric & Gas (NYSEG)',
    state: 'NY',
    portal_type: 'online_portal',
    application_url: 'https://dps.ny.gov/distributed-generation-information',
    info_url: 'https://dps.ny.gov/distributed-generation-information',
    interconnection_phone: '1-800-572-1111',
    application_form_name: 'NYSEG Distributed Generation Interconnection Application',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: true,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      { label: 'DG Application', description: 'Submit NYSEG interconnection application online or via mail. Include system size and equipment documentation.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Single-Line Diagram', description: 'Required for all systems. Standard residential SLD acceptable for systems under 25 kW.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Local AHJ Permit', description: 'Town or county building permit required.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
    ],
    ica_approval_days_min: 15,
    ica_approval_days_max: 35,
    timeline_note: 'NYSEG processes most residential interconnections in 15–30 business days. Upstate NY municipalities typically have manageable permit timelines.',
    pto_trigger: 'final_inspection',
    pto_days_min: 10,
    pto_days_max: 25,
    pto_steps: [
      '1. Pass local AHJ building inspection.',
      '2. Submit inspection documentation to NYSEG.',
      '3. NYSEG installs net meter and issues PTO authorization.',
    ],
    homeowner_pto_checklist: [
      'Local building inspection passed and card signed',
      'Inspection documentation submitted to NYSEG',
      'Do NOT energize until NYSEG confirms PTO',
    ],
    common_rejections: [
      { reason: 'Missing completed interconnection application form', how_to_avoid: 'Use NYSEG\'s current form — check NYSEG website or NY DPS site for latest version.' },
    ],
    solar_pro_note: 'NYSEG territory spans upstate NY. NY NEM 2.0 provides full retail credit for exported energy. NY-Sun incentives available. Upstate rates are lower than NYC (~$0.18–$0.22/kWh) so ROI is typically 9–12 years. Excellent for customers with high usage.',
    last_verified: '2025-06',
  },

  // ── RG&E — Rochester, NY ───────────────────────────────────────────────────
  {
    utility_id: 'rg_e_ny',
    utility_name: 'Rochester Gas and Electric (RG&E)',
    state: 'NY',
    portal_type: 'online_portal',
    application_url: 'https://dps.ny.gov/distributed-generation-information',
    info_url: 'https://dps.ny.gov/distributed-generation-information',
    interconnection_phone: '1-800-743-1701',
    application_form_name: 'RG&E Distributed Generation Interconnection Application',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: true,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      { label: 'DG Application', description: 'Submit RG&E interconnection application. RG&E and NYSEG use similar processes under Avangrid.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Single-Line Diagram', description: 'Standard SLD required for all systems.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Monroe County / Local AHJ Permit', description: 'Building permit from relevant local authority.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
    ],
    ica_approval_days_min: 15,
    ica_approval_days_max: 35,
    timeline_note: 'RG&E (sister company to NYSEG under Avangrid) has similar interconnection timelines — 15–30 business days typical for residential.',
    pto_trigger: 'final_inspection',
    pto_days_min: 10,
    pto_days_max: 25,
    pto_steps: [
      '1. Pass Monroe County / local AHJ building inspection.',
      '2. Submit inspection documentation to RG&E.',
      '3. RG&E upgrades meter and issues PTO.',
    ],
    homeowner_pto_checklist: [
      'Local building inspection passed',
      'Documentation submitted to RG&E',
      'Do NOT energize until RG&E PTO received',
    ],
    common_rejections: [
      { reason: 'Incomplete application or missing equipment specs', how_to_avoid: 'Include UL-listed inverter and module datasheets with all applications.' },
    ],
    solar_pro_note: 'RG&E serves the Rochester metro area. Same NY NEM 2.0 as all NY utilities. NY-Sun incentives apply. Rochester rates ~$0.18–$0.21/kWh — moderate ROI market of 10–13 years. Strong NY-Sun rebate reduces payback significantly.',
    last_verified: '2025-06',
  },

  // ── Central Hudson — Hudson Valley, NY ────────────────────────────────────
  {
    utility_id: 'central_hudson_ny',
    utility_name: 'Central Hudson Gas & Electric',
    state: 'NY',
    portal_type: 'online_portal',
    application_url: 'https://www.cenhud.com/home/save-energy/solar-energy/interconnection',
    info_url: 'https://www.cenhud.com/home/save-energy/solar-energy/interconnection',
    interconnection_phone: '1-845-452-2700',
    application_form_name: 'Central Hudson Distributed Generation Interconnection Application',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: true,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      { label: 'DG Interconnection Application', description: 'Online application via Central Hudson portal. Include system specs and site information.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Single-Line Diagram', description: 'Required for all residential solar installations.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Local AHJ Permit', description: 'County/municipality building permit required.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
    ],
    ica_approval_days_min: 15,
    ica_approval_days_max: 35,
    timeline_note: 'Central Hudson typically processes residential interconnections in 15–30 business days. Hudson Valley has generally manageable permit processes.',
    pto_trigger: 'final_inspection',
    pto_days_min: 10,
    pto_days_max: 20,
    pto_steps: [
      '1. Pass local AHJ inspection.',
      '2. Submit inspection documentation to Central Hudson.',
      '3. Central Hudson installs net meter and issues PTO.',
    ],
    homeowner_pto_checklist: [
      'Local inspection passed',
      'Documentation submitted to Central Hudson',
      'Await Central Hudson PTO before energizing',
    ],
    common_rejections: [
      { reason: 'System over-sized for prior 12-month usage', how_to_avoid: 'Size system to no more than 110% of annual historical usage.' },
    ],
    solar_pro_note: 'Central Hudson serves the Hudson Valley region. Rates are higher than upstate (~$0.20–$0.26/kWh) making solar economics strong. NY-Sun incentives available. ROI typically 8–11 years.',
    last_verified: '2025-06',
  },

  // ── Hawaiian Electric (HECO) — Hawaii ─────────────────────────────────────
  {
    utility_id: 'hawaiian_electric',
    utility_name: 'Hawaiian Electric (HECO)',
    state: 'HI',
    portal_type: 'online_portal',
    application_url: 'https://www.hawaiianelectric.com/products-and-services/smart-renewable-energy-programs/previous-renewable-programs/generate-your-own-power',
    info_url: 'https://www.hawaiianelectric.com/about-us/performance-scorecards-and-metrics/interconnection-experience',
    interconnection_phone: '1-808-526-2226',
    application_form_name: 'Hawaiian Electric Customer Self-Supply (CSS) / Smart Export Application',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: true,
    requires_sld: true,
    requires_stamped_planset: true,
    requirements: [
      { label: 'CSS or Smart Export Application', description: 'Hawaii no longer has traditional NEM — customers enroll in Customer Self-Supply (CSS) or Smart Export program. Application via HECO portal.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'PE-Stamped Plan Set', description: 'Hawaii requires PE-stamped electrical plans for all systems.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Single-Line Diagram', description: 'Required as part of permit package.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Hawaii County / City & County of Honolulu Permit', description: 'Building permit from county DPP required.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
    ],
    ica_approval_days_min: 30,
    ica_approval_days_max: 90,
    timeline_note: 'Hawaiian Electric interconnection is notoriously slow due to grid saturation on O\'ahu, Maui, and Big Island. Expect 30–90 business days. Circuit capacity issues can cause additional delays. Early application recommended.',
    pto_trigger: 'final_inspection',
    pto_days_min: 15,
    pto_days_max: 60,
    pto_steps: [
      '1. Pass county (DPP) building inspection — collect signed inspection card.',
      '2. Submit inspection documentation to Hawaiian Electric along with all required commissioning forms.',
      '3. HECO performs interconnection review and may schedule utility witness inspection.',
      '4. HECO installs export meter/configuration and issues PTO authorization.',
      '5. Energize system ONLY after written PTO received from HECO.',
    ],
    homeowner_pto_checklist: [
      'County building inspection passed',
      'All commissioning documents submitted to HECO',
      'HECO site visit completed if scheduled',
      'ABSOLUTELY do NOT energize without HECO PTO — grid issues are serious in Hawaii',
    ],
    common_rejections: [
      { reason: 'Circuit at or near capacity — interconnection denied or deferred', how_to_avoid: 'Check HECO\'s hosting capacity map before sizing system. Consider battery-only or hybrid approach if circuit is constrained.' },
      { reason: 'Smart Export vs. CSS program confusion', how_to_avoid: 'Confirm which program the customer qualifies for before application. CSS: no export allowed. Smart Export: limited export at avoided-cost rate.' },
      { reason: 'Incomplete PE-stamped plan set', how_to_avoid: 'Hawaii requires full PE stamp on all electrical sheets. Ensure engineer is licensed in Hawaii.' },
    ],
    solar_pro_note: 'Hawaii is the most complex solar market in the US. No traditional NEM — all new systems go on CSS (zero export) or Smart Export (minimal export credit). Grid saturation is a real constraint. However, electricity rates are the highest in the nation ($0.38–$0.45/kWh) making battery-solar ROI excellent at 6–9 years. Always check HECO hosting capacity map before committing to system size.',
    last_verified: '2025-06',
  },

  // ── Puget Sound Energy — Washington State ─────────────────────────────────
  {
    utility_id: 'puget_sound_wa',
    utility_name: 'Puget Sound Energy (PSE)',
    state: 'WA',
    portal_type: 'online_portal',
    application_url: 'https://www.pse.com/en/pages/solar-power-and-renewables/solar/solar-installation',
    info_url: 'https://www.pse.com/en/pages/solar-power-and-renewables/solar/solar-installation',
    interconnection_phone: '1-888-225-5773',
    application_form_name: 'PSE Interconnection / Net Metering Application',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: true,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      { label: 'PSE Interconnection Application', description: 'Online application via PSE portal. Include system specs, inverter data, and site plan.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Single-Line Diagram', description: 'Standard SLD required for all systems.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Local AHJ Permit', description: 'County or city building permit required before PTO.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
    ],
    ica_approval_days_min: 15,
    ica_approval_days_max: 40,
    timeline_note: 'PSE typically processes interconnections in 15–30 business days. Washington State has a streamlined NEM process.',
    pto_trigger: 'final_inspection',
    pto_days_min: 10,
    pto_days_max: 20,
    pto_steps: [
      '1. Pass local AHJ building inspection.',
      '2. Submit signed inspection documentation to PSE.',
      '3. PSE upgrades meter to net meter and confirms PTO.',
    ],
    homeowner_pto_checklist: [
      'Local inspection passed',
      'PSE notified of inspection approval',
      'Do NOT energize until PSE confirms PTO',
    ],
    common_rejections: [
      { reason: 'System sized over 100% of prior year usage', how_to_avoid: 'WA NEM rules limit system to 100% of prior 12-month consumption.' },
    ],
    solar_pro_note: 'PSE serves the greater Seattle/Puget Sound region (excluding Seattle City Light). WA State has full retail net metering and a modest solar incentive. Lower electricity rates (~$0.12–$0.16/kWh) and moderate sun (1,600–1,800 kWh/kW/year) mean ROI is typically 12–16 years. Battery storage adds strong resilience value in WA.',
    last_verified: '2025-06',
  },

  // ── Avista — Eastern Washington / Northern Idaho ───────────────────────────
  {
    utility_id: 'avista_wa',
    utility_name: 'Avista Utilities',
    state: 'WA',
    portal_type: 'online_portal',
    application_url: 'https://www.avistautilities.com/savings/renewable-energy/solar',
    info_url: 'https://www.avistautilities.com/savings/renewable-energy/solar',
    interconnection_phone: '1-800-227-9187',
    application_form_name: 'Avista Net Metering / Interconnection Application',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: true,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      { label: 'Interconnection Application', description: 'Submit via Avista online portal or by mail. Include system specs and equipment documentation.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Single-Line Diagram', description: 'Required for all systems.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Local AHJ Permit', description: 'Spokane County or local city building permit required.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
    ],
    ica_approval_days_min: 10,
    ica_approval_days_max: 30,
    timeline_note: 'Avista is a smaller utility with faster turnaround than large IOUs. Typical residential approval in 10–20 business days.',
    pto_trigger: 'final_inspection',
    pto_days_min: 5,
    pto_days_max: 15,
    pto_steps: [
      '1. Pass local AHJ inspection.',
      '2. Submit inspection documentation to Avista.',
      '3. Avista installs net meter and authorizes PTO.',
    ],
    homeowner_pto_checklist: [
      'Local inspection passed',
      'Documentation sent to Avista',
      'Await Avista PTO before energizing',
    ],
    common_rejections: [
      { reason: 'System size exceeds prior year usage', how_to_avoid: 'Size to 100% of 12-month historical usage.' },
    ],
    solar_pro_note: 'Avista serves Spokane and eastern WA/northern ID. Lower rates (~$0.10–$0.13/kWh) mean longer payback periods (14–18 years), but strong federal ITC and moderate sun improve economics. Battery storage is a strong add-on for resilience.',
    last_verified: '2025-06',
  },

  // ── Avista Idaho ───────────────────────────────────────────────────────────
  {
    utility_id: 'avista_id',
    utility_name: 'Avista Utilities (Idaho)',
    state: 'ID',
    portal_type: 'online_portal',
    application_url: 'https://www.avistautilities.com/savings/renewable-energy/solar',
    info_url: 'https://www.avistautilities.com/savings/renewable-energy/solar',
    interconnection_phone: '1-800-227-9187',
    application_form_name: 'Avista Idaho Net Metering / Interconnection Application',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: true,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      { label: 'Interconnection Application', description: 'Same application process as Avista WA. Submit online or by mail.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Single-Line Diagram', description: 'Required for all systems.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Local AHJ Permit', description: 'Local city or county building permit required.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
    ],
    ica_approval_days_min: 10,
    ica_approval_days_max: 30,
    timeline_note: 'Same process as Avista WA. Idaho PUC rules apply. Typical approval in 10–20 business days.',
    pto_trigger: 'final_inspection',
    pto_days_min: 5,
    pto_days_max: 15,
    pto_steps: [
      '1. Pass local AHJ inspection.',
      '2. Submit inspection documentation to Avista.',
      '3. Avista installs net meter and issues PTO.',
    ],
    homeowner_pto_checklist: [
      'Local inspection passed',
      'Documentation sent to Avista',
      'Await Avista PTO before energizing',
    ],
    common_rejections: [
      { reason: 'System oversized for prior usage', how_to_avoid: 'Keep system at or below 100% of annual historical consumption.' },
    ],
    solar_pro_note: 'Avista Idaho (Coeur d\'Alene / northern Idaho) has some of the lowest electricity rates in the US (~$0.09–$0.12/kWh). Solar payback is long (16–20 years) but federal ITC makes it viable. Battery storage for outage protection is the primary value driver in this territory.',
    last_verified: '2025-06',
  },

  // ── Portland General Electric — Oregon ─────────────────────────────────────
  {
    utility_id: 'portland_general_or',
    utility_name: 'Portland General Electric (PGE)',
    state: 'OR',
    portal_type: 'online_portal',
    application_url: 'https://portlandgeneral.com/resources-for-solar-installers/interconnection-process-overview',
    info_url: 'https://portlandgeneral.com/solar',
    interconnection_phone: '1-503-228-6322',
    application_form_name: 'Portland General Electric Distributed Generation Interconnection Application',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: true,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      { label: 'DG Interconnection Application', description: 'Submit via PGE installer portal. Includes system specs, equipment list, and site information.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Single-Line Diagram', description: 'Required for all systems. Must show AC/DC disconnects, metering, and grounding.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Oregon / Local AHJ Permit', description: 'Building permit from Multnomah County, City of Portland, or relevant local authority.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
    ],
    ica_approval_days_min: 15,
    ica_approval_days_max: 40,
    timeline_note: 'PGE Oregon processes residential interconnections in 15–30 business days. Portland area permitting is manageable.',
    pto_trigger: 'final_inspection',
    pto_days_min: 10,
    pto_days_max: 20,
    pto_steps: [
      '1. Pass local AHJ building inspection.',
      '2. Submit inspection documentation to PGE via portal.',
      '3. PGE upgrades meter and issues PTO authorization.',
    ],
    homeowner_pto_checklist: [
      'AHJ inspection passed',
      'Documentation submitted to PGE',
      'Do NOT energize before PGE PTO',
    ],
    common_rejections: [
      { reason: 'System exceeds 100% of prior year usage', how_to_avoid: 'Oregon NEM caps system at 100% of 12-month usage.' },
    ],
    solar_pro_note: 'PGE Oregon serves Portland metro area. Oregon NEM 2.0 provides full retail credit. Moderate solar resource (1,200–1,500 kWh/kW/year in Portland) and rates ~$0.13–$0.17/kWh mean ROI is typically 12–16 years. Battery storage adds significant resilience value in the Pacific Northwest.',
    last_verified: '2025-06',
  },

  // ── Eversource CT ─────────────────────────────────────────────────────────
  {
    utility_id: 'eversource_ct',
    utility_name: 'Eversource Energy (Connecticut)',
    state: 'CT',
    portal_type: 'online_portal',
    application_url: 'https://www.eversource.com/content/ema-c/residential/save-money-energy/explore-alternatives/solar-energy/interconnection-and-net-metering',
    info_url: 'https://www.eversource.com/content/ema-c/residential/save-money-energy/explore-alternatives/solar-energy/interconnection-and-net-metering',
    interconnection_phone: '1-800-286-2000',
    application_form_name: 'Eversource CT Distributed Generation Interconnection Application',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: true,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      { label: 'DG Application', description: 'Online application via Eversource CT portal.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Single-Line Diagram', description: 'Required for all residential systems.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Connecticut / Local AHJ Permit', description: 'Town building permit required.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
    ],
    ica_approval_days_min: 20,
    ica_approval_days_max: 45,
    timeline_note: 'Eversource CT processes most residential interconnections in 20–35 business days. CT towns vary in permit timelines — Fairfield County tends to be slower.',
    pto_trigger: 'final_inspection',
    pto_days_min: 10,
    pto_days_max: 25,
    pto_steps: [
      '1. Pass town building inspection.',
      '2. Submit inspection approval to Eversource CT.',
      '3. Eversource installs net meter and issues PTO.',
    ],
    homeowner_pto_checklist: [
      'Town inspection passed',
      'Documentation sent to Eversource CT',
      'Await Eversource PTO before energizing',
    ],
    common_rejections: [
      { reason: 'System over-sized for prior year usage', how_to_avoid: 'CT NEM limits system to no more than 100% of prior 12-month usage.' },
    ],
    solar_pro_note: 'Eversource CT has among the highest electricity rates in the nation (~$0.24–$0.30/kWh). Connecticut has strong solar economics with full retail NEM, a CT Green Bank loan/rebate program, and CT ZREC/LREC programs for larger systems. ROI typically 7–10 years. Excellent solar market.',
    last_verified: '2025-06',
  },

  // ── Eversource NH ─────────────────────────────────────────────────────────
  {
    utility_id: 'eversource_nh',
    utility_name: 'Eversource Energy (New Hampshire)',
    state: 'NH',
    portal_type: 'online_portal',
    application_url: 'https://www.eversource.com/content/nh/residential/save-money-energy/explore-alternatives/solar-energy/interconnection-and-net-metering',
    info_url: 'https://www.eversource.com/content/nh/residential/save-money-energy/explore-alternatives/solar-energy/interconnection-and-net-metering',
    interconnection_phone: '1-800-662-7764',
    application_form_name: 'Eversource NH Net Metering / Interconnection Application',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: true,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      { label: 'DG Application', description: 'Online application via Eversource NH portal.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Single-Line Diagram', description: 'Required for all residential systems.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'NH / Local AHJ Permit', description: 'Town or city building permit required.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
    ],
    ica_approval_days_min: 15,
    ica_approval_days_max: 35,
    timeline_note: 'Eversource NH processes most residential applications in 15–25 business days. NH towns generally have manageable permitting.',
    pto_trigger: 'final_inspection',
    pto_days_min: 10,
    pto_days_max: 20,
    pto_steps: [
      '1. Pass local AHJ building inspection.',
      '2. Submit inspection documentation to Eversource NH.',
      '3. Eversource installs net meter and issues PTO.',
    ],
    homeowner_pto_checklist: [
      'Local inspection passed',
      'Documentation sent to Eversource NH',
      'Await Eversource PTO before energizing',
    ],
    common_rejections: [
      { reason: 'Missing signed net metering agreement', how_to_avoid: 'Ensure homeowner signs and returns the Eversource NH net metering agreement as part of the application package.' },
    ],
    solar_pro_note: 'NH has high electricity rates (~$0.22–$0.28/kWh) and full retail net metering, making solar economics strong. No state income tax or sales tax on solar. NH Saves rebate program may be available. ROI typically 8–11 years.',
    last_verified: '2025-06',
  },

  // ── CMP — Central Maine Power ──────────────────────────────────────────────
  {
    utility_id: 'cmp_me',
    utility_name: 'Central Maine Power (CMP)',
    state: 'ME',
    portal_type: 'online_portal',
    application_url: 'https://www.cmpco.com/suppliersandpartners/servicesandresources/interconnection',
    info_url: 'https://www.cmpco.com/suppliersandpartners/servicesandresources/interconnection/net-energy-billing',
    interconnection_phone: '1-800-750-4000',
    application_form_name: 'CMP Distributed Generation / Net Energy Billing Interconnection Application',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: true,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      { label: 'DG Application', description: 'Submit CMP interconnection application. Maine uses Net Energy Billing (NEB) rather than traditional NEM.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Single-Line Diagram', description: 'Required for all systems.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Maine / Local AHJ Permit', description: 'Town or city building permit required.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
    ],
    ica_approval_days_min: 15,
    ica_approval_days_max: 40,
    timeline_note: 'CMP processes most residential applications in 15–30 business days. Maine\'s Net Energy Billing program is straightforward for residential systems under 100 kW.',
    pto_trigger: 'final_inspection',
    pto_days_min: 10,
    pto_days_max: 20,
    pto_steps: [
      '1. Pass local AHJ building inspection.',
      '2. Submit inspection approval to CMP.',
      '3. CMP installs net meter and issues PTO authorization.',
    ],
    homeowner_pto_checklist: [
      'Local inspection passed',
      'Documentation sent to CMP',
      'Await CMP PTO before energizing',
    ],
    common_rejections: [
      { reason: 'NEB application incomplete or missing site documentation', how_to_avoid: 'Include all equipment specs and site plan with initial application to avoid back-and-forth.' },
    ],
    solar_pro_note: 'CMP serves southern and central Maine. Maine uses Net Energy Billing (NEB) — credits roll monthly, annual true-up at avoided cost. High electricity rates (~$0.20–$0.26/kWh) and Efficiency Maine incentives make solar viable despite limited winter sun. ROI typically 10–14 years.',
    last_verified: '2025-06',
  },

  // ── TEP — Tucson Electric Power, AZ ───────────────────────────────────────
  {
    utility_id: 'tep_az',
    utility_name: 'Tucson Electric Power (TEP)',
    state: 'AZ',
    portal_type: 'online_portal',
    application_url: 'https://www.tep.com/solar/',
    info_url: 'https://www.tep.com/solar/',
    interconnection_phone: '1-520-623-7711',
    application_form_name: 'TEP Distributed Energy Resources Interconnection Application',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: true,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      { label: 'DER Interconnection Application', description: 'Online application via TEP portal. Includes system specs, inverter data, and site address.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Single-Line Diagram', description: 'Required for all systems.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Pima County / City of Tucson Permit', description: 'Building permit required from local AHJ before PTO.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
    ],
    ica_approval_days_min: 15,
    ica_approval_days_max: 35,
    timeline_note: 'TEP processes most residential interconnections in 15–25 business days. Tucson area permitting is generally manageable.',
    pto_trigger: 'final_inspection',
    pto_days_min: 10,
    pto_days_max: 20,
    pto_steps: [
      '1. Pass Pima County / City of Tucson building inspection.',
      '2. Submit signed inspection documentation to TEP.',
      '3. TEP reviews, upgrades meter, and issues PTO.',
    ],
    homeowner_pto_checklist: [
      'Pima County or city inspection passed',
      'Inspection documentation submitted to TEP',
      'Await TEP PTO before energizing',
    ],
    common_rejections: [
      { reason: 'System sized over 125% of prior year usage', how_to_avoid: 'AZ ACC rules cap solar at 125% of prior 12-month consumption.' },
    ],
    solar_pro_note: 'TEP serves Tucson — second largest AZ solar market. Excellent solar resource (>320 sunny days/year, ~2,100 kWh/kW/year). AZ has no state income tax on solar. TEP has an export buy-back program but at reduced rates vs. retail. Battery storage for peak-demand shifting is strong value-add. ROI typically 7–10 years.',
    last_verified: '2025-06',
  },

  // ── Tampa Electric — Tampa Bay, FL ─────────────────────────────────────────
  {
    utility_id: 'tampa_electric_fl',
    utility_name: 'Tampa Electric (TECO)',
    state: 'FL',
    portal_type: 'online_portal',
    application_url: 'https://www.tampaelectric.com/solar',
    info_url: 'https://www.tampaelectric.com/solar',
    interconnection_phone: '1-813-223-0800',
    application_form_name: 'Tampa Electric Net Metering / Interconnection Application',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: true,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      { label: 'Net Metering Application', description: 'Online application via Tampa Electric solar portal. Includes system specs and equipment list.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Single-Line Diagram', description: 'Required for all systems.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Hillsborough County / Local AHJ Permit', description: 'Building permit from local county or municipality required.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
    ],
    ica_approval_days_min: 15,
    ica_approval_days_max: 35,
    timeline_note: 'Tampa Electric processes most residential interconnections in 15–25 business days. Florida has standardized interconnection rules under FPSC.',
    pto_trigger: 'final_inspection',
    pto_days_min: 10,
    pto_days_max: 20,
    pto_steps: [
      '1. Pass Hillsborough County / local AHJ building inspection.',
      '2. Submit inspection documentation to Tampa Electric.',
      '3. Tampa Electric installs net meter and issues PTO.',
    ],
    homeowner_pto_checklist: [
      'County/city inspection passed',
      'Documentation submitted to Tampa Electric',
      'Do NOT energize until Tampa Electric PTO received',
    ],
    common_rejections: [
      { reason: 'System size exceeds 110% of prior year usage', how_to_avoid: 'Florida PSC rules cap residential solar at 110% of prior 12-month consumption.' },
    ],
    solar_pro_note: 'Tampa Electric serves the Tampa Bay metro. Florida has full retail net metering and excellent solar production (~1,900 kWh/kW/year). FL solar property tax exemption and no state income tax. ROI typically 8–11 years. Hurricane-resilient battery+solar is a strong product in this market.',
    last_verified: '2025-06',
  },

  // ── JEA — Jacksonville, FL ─────────────────────────────────────────────────
  {
    utility_id: 'jea_fl',
    utility_name: 'JEA (Jacksonville Electric Authority)',
    state: 'FL',
    portal_type: 'online_portal',
    application_url: 'https://www.jea.com/solar',
    info_url: 'https://www.jea.com/solar',
    interconnection_phone: '1-904-665-6000',
    application_form_name: 'JEA Solar / Net Metering Interconnection Application',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: true,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      { label: 'JEA Solar Application', description: 'Submit via JEA online solar portal. Include system specs, inverter data, and site address.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Single-Line Diagram', description: 'Required for all residential systems.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'City of Jacksonville / Duval County Permit', description: 'Building permit from Duval County or City of Jacksonville required.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
    ],
    ica_approval_days_min: 10,
    ica_approval_days_max: 30,
    timeline_note: 'JEA as a municipal utility tends to be faster than large IOUs. Typical approval in 10–20 business days.',
    pto_trigger: 'final_inspection',
    pto_days_min: 7,
    pto_days_max: 15,
    pto_steps: [
      '1. Pass Duval County / City of Jacksonville building inspection.',
      '2. Submit inspection documentation to JEA.',
      '3. JEA installs net meter and issues PTO authorization.',
    ],
    homeowner_pto_checklist: [
      'Duval County inspection passed',
      'Documentation submitted to JEA',
      'Await JEA PTO before energizing',
    ],
    common_rejections: [
      { reason: 'Application submitted before building permit is pulled', how_to_avoid: 'Pull Duval County permit before or concurrent with JEA application.' },
    ],
    solar_pro_note: 'JEA is Jacksonville\'s municipally-owned utility. JEA has full retail net metering and reasonable rates (~$0.12–$0.15/kWh). Florida solar production is excellent. Municipal utilities often have faster processing than IOUs. ROI typically 9–12 years.',
    last_verified: '2025-06',
  },

  // ── OUC — Orlando Utilities Commission, FL ─────────────────────────────────
  {
    utility_id: 'ouc_fl',
    utility_name: 'Orlando Utilities Commission (OUC)',
    state: 'FL',
    portal_type: 'online_portal',
    application_url: 'https://www.ouc.com/solar',
    info_url: 'https://www.ouc.com/solar',
    interconnection_phone: '1-407-423-9100',
    application_form_name: 'OUC Solar / Net Metering Interconnection Application',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: true,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      { label: 'OUC Solar Application', description: 'Submit via OUC online portal. Include system specs and equipment documentation.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Single-Line Diagram', description: 'Required for all residential systems.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Orange County / City of Orlando Permit', description: 'Building permit required from local AHJ.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
    ],
    ica_approval_days_min: 10,
    ica_approval_days_max: 25,
    timeline_note: 'OUC as a municipal utility typically processes faster than investor-owned utilities. Most residential approvals in 10–20 business days.',
    pto_trigger: 'final_inspection',
    pto_days_min: 7,
    pto_days_max: 15,
    pto_steps: [
      '1. Pass Orange County / City of Orlando inspection.',
      '2. Submit inspection documentation to OUC.',
      '3. OUC installs net meter and authorizes PTO.',
    ],
    homeowner_pto_checklist: [
      'Local inspection passed',
      'Documentation submitted to OUC',
      'Await OUC PTO before energizing',
    ],
    common_rejections: [
      { reason: 'System sized over 110% of prior year usage', how_to_avoid: 'Florida rules cap residential solar at 110% of prior consumption.' },
    ],
    solar_pro_note: 'OUC serves Orlando and St. Cloud. Municipal utility with full retail NEM and historically strong customer service on interconnections. Florida solar production ~1,900 kWh/kW/year. ROI typically 9–12 years. Great market for battery+solar due to hurricane season.',
    last_verified: '2025-06',
  },

  // ── Consumers Energy — Michigan ────────────────────────────────────────────
  {
    utility_id: 'consumers_mi',
    utility_name: 'Consumers Energy (Michigan)',
    state: 'MI',
    portal_type: 'online_portal',
    application_url: 'https://www.consumersenergy.com/residential/renewable-energy/distributed-generation',
    info_url: 'https://www.consumersenergy.com/residential/renewable-energy',
    interconnection_phone: '1-800-477-5050',
    application_form_name: 'Consumers Energy Distributed Generation Interconnection Application',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: true,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      { label: 'DG Application', description: 'Submit via Consumers Energy online portal. Include system specs and equipment documentation.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Single-Line Diagram', description: 'Required for all systems.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Michigan / Local AHJ Permit', description: 'Municipality or county building permit required.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
    ],
    ica_approval_days_min: 20,
    ica_approval_days_max: 45,
    timeline_note: 'Consumers Energy is the largest Michigan utility and can have longer processing times. Expect 20–40 business days for residential interconnections.',
    pto_trigger: 'final_inspection',
    pto_days_min: 10,
    pto_days_max: 25,
    pto_steps: [
      '1. Pass local AHJ building inspection.',
      '2. Submit inspection documentation to Consumers Energy.',
      '3. Consumers Energy installs net meter and issues PTO.',
    ],
    homeowner_pto_checklist: [
      'Local inspection passed',
      'Documentation submitted to Consumers Energy',
      'Do NOT energize until Consumers Energy PTO received',
    ],
    common_rejections: [
      { reason: 'NEM capacity waitlist', how_to_avoid: 'Michigan has NEM caps — check current NEM availability before application. Waitlists have been cleared but monitor for future caps.' },
    ],
    solar_pro_note: 'Consumers Energy serves most of Michigan (lower and parts of upper peninsula). Michigan NEM provides full retail credit with annual true-up. Moderate solar resource (~1,400 kWh/kW/year). Rates ~$0.17–$0.21/kWh. ROI typically 11–15 years. EGLE MECS solar rebate may be available.',
    last_verified: '2025-06',
  },

  // ── We Energies — Wisconsin ────────────────────────────────────────────────
  {
    utility_id: 'we_energies_wi',
    utility_name: 'We Energies (Wisconsin Electric / Wisconsin Gas)',
    state: 'WI',
    portal_type: 'online_portal',
    application_url: 'https://www.we-energies.com/services/wi-customer-owned-generation',
    info_url: 'https://www.we-energies.com/services/wi-customer-owned-generation',
    interconnection_phone: '1-800-242-9137',
    application_form_name: 'We Energies Customer-Owned Generation / Net Metering Application',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: true,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      { label: 'Customer-Owned Generation Application', description: 'Submit via We Energies portal. Include system specs, equipment list, and site address.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Single-Line Diagram', description: 'Required for all residential systems.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Wisconsin / Local AHJ Permit', description: 'Municipality or county building permit required.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
    ],
    ica_approval_days_min: 15,
    ica_approval_days_max: 35,
    timeline_note: 'We Energies processes most residential applications in 15–30 business days. Wisconsin PSC interconnection rules are standardized.',
    pto_trigger: 'final_inspection',
    pto_days_min: 10,
    pto_days_max: 20,
    pto_steps: [
      '1. Pass local AHJ building inspection.',
      '2. Submit inspection documentation to We Energies.',
      '3. We Energies installs net meter and issues PTO.',
    ],
    homeowner_pto_checklist: [
      'Local inspection passed',
      'Documentation submitted to We Energies',
      'Await We Energies PTO before energizing',
    ],
    common_rejections: [
      { reason: 'System over-sized for prior year usage', how_to_avoid: 'WI rules cap net metering at 100% of annual consumption.' },
    ],
    solar_pro_note: 'We Energies serves Milwaukee metro and southeastern Wisconsin. Wisconsin NEM provides full retail credit with annual credit payout. Moderate solar resource (~1,300–1,500 kWh/kW/year). Rates ~$0.16–$0.20/kWh. ROI typically 12–16 years. Focus selling points on utility savings and energy independence.',
    last_verified: '2025-06',
  },

  // ── MidAmerican Energy — Iowa ──────────────────────────────────────────────
  {
    utility_id: 'midamerican_ia',
    utility_name: 'MidAmerican Energy (Iowa)',
    state: 'IA',
    portal_type: 'online_portal',
    application_url: 'https://www.midamericanenergy.com/customer-interconnection',
    info_url: 'https://www.midamericanenergy.com/customer-interconnection',
    interconnection_phone: '1-888-427-5632',
    application_form_name: 'MidAmerican Energy Customer Generation Interconnection Application',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: true,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      { label: 'Customer Interconnection Application', description: 'Submit via MidAmerican Energy portal. Include system specs and equipment documentation.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Single-Line Diagram', description: 'Required for all systems.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Iowa / Local AHJ Permit', description: 'Local building permit required.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
    ],
    ica_approval_days_min: 10,
    ica_approval_days_max: 30,
    timeline_note: 'MidAmerican Energy is known for efficient processing — typically 10–20 business days for residential applications.',
    pto_trigger: 'final_inspection',
    pto_days_min: 7,
    pto_days_max: 15,
    pto_steps: [
      '1. Pass local AHJ building inspection.',
      '2. Submit inspection documentation to MidAmerican.',
      '3. MidAmerican installs net meter and issues PTO.',
    ],
    homeowner_pto_checklist: [
      'Local inspection passed',
      'Documentation submitted to MidAmerican',
      'Await MidAmerican PTO before energizing',
    ],
    common_rejections: [
      { reason: 'System over-sized for prior year usage', how_to_avoid: 'Iowa NEM caps solar at 100% of 12-month historical consumption.' },
    ],
    solar_pro_note: 'MidAmerican Energy serves central Iowa and is known as one of the most solar-friendly utilities — they produce >60% of their energy from wind and have actively supported customer solar. Iowa NEM provides full retail credit. Moderate rates (~$0.12–$0.16/kWh) and moderate sun. ROI typically 12–16 years.',
    last_verified: '2025-06',
  },

  // ── Idaho Power ───────────────────────────────────────────────────────────
  {
    utility_id: 'idaho_power',
    utility_name: 'Idaho Power',
    state: 'ID',
    portal_type: 'online_portal',
    application_url: 'https://www.idahopower.com/energy-environment/producing-energy/small-power-producers/solar-power/',
    info_url: 'https://www.idahopower.com/energy-environment/producing-energy/small-power-producers',
    interconnection_phone: '1-208-388-2323',
    application_form_name: 'Idaho Power Net Metering / Interconnection Application',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: true,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      { label: 'Net Metering Application', description: 'Submit via Idaho Power online portal. Include system specs and equipment documentation.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Single-Line Diagram', description: 'Required for all residential systems.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Local AHJ Permit', description: 'City or county building permit required.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
    ],
    ica_approval_days_min: 10,
    ica_approval_days_max: 30,
    timeline_note: 'Idaho Power processes most residential applications in 10–20 business days. Idaho has efficient interconnection rules.',
    pto_trigger: 'final_inspection',
    pto_days_min: 7,
    pto_days_max: 15,
    pto_steps: [
      '1. Pass local AHJ building inspection.',
      '2. Submit inspection documentation to Idaho Power.',
      '3. Idaho Power installs net meter and issues PTO.',
    ],
    homeowner_pto_checklist: [
      'Local inspection passed',
      'Documentation submitted to Idaho Power',
      'Await Idaho Power PTO before energizing',
    ],
    common_rejections: [
      { reason: 'System sized over 100% of prior year usage', how_to_avoid: 'Idaho PUC rules cap net metering at 100% of 12-month historical consumption.' },
    ],
    solar_pro_note: 'Idaho Power has some of the lowest electricity rates in the US (~$0.09–$0.12/kWh), which makes solar payback long (15–20 years). However, excellent solar resource in southern Idaho (~2,000 kWh/kW/year) and the 30% federal ITC still provide compelling economics for long-term homeowners. Battery storage for grid independence is a strong selling point.',
    last_verified: '2025-06',
  },

  // ── Alabama Power ─────────────────────────────────────────────────────────
  {
    utility_id: 'alabama_power',
    utility_name: 'Alabama Power',
    state: 'AL',
    portal_type: 'online_portal',
    application_url: 'https://www.alabamapower.com/company/clean-energy/solar-energy.html',
    info_url: 'https://www.alabamapower.com/content/dam/alabama-power/pdfs-docs/Clean-Energy/APC%20DER%20TIR%20Guidebook.pdf',
    interconnection_phone: '1-800-245-2244',
    application_form_name: 'Alabama Power DER Interconnection Application',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: true,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      { label: 'DER Application', description: 'Submit Alabama Power DER interconnection application per TIR Guidebook requirements.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Single-Line Diagram', description: 'Required for all residential systems.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Local AHJ Permit', description: 'County or city building permit required.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
    ],
    ica_approval_days_min: 20,
    ica_approval_days_max: 60,
    timeline_note: 'Alabama Power interconnection can be slower than national averages due to historically limited solar infrastructure. Expect 20–45 business days. Alabama has significant fixed charges that reduce solar savings.',
    pto_trigger: 'final_inspection',
    pto_days_min: 10,
    pto_days_max: 25,
    pto_steps: [
      '1. Pass local AHJ building inspection.',
      '2. Submit inspection documentation to Alabama Power.',
      '3. Alabama Power reviews and installs net meter.',
      '4. PTO authorization issued after meter installation.',
    ],
    homeowner_pto_checklist: [
      'Local inspection passed',
      'Documentation submitted to Alabama Power',
      'Await Alabama Power PTO before energizing',
    ],
    common_rejections: [
      { reason: 'High fixed charges reduce system economics', how_to_avoid: 'Note: Alabama Power charges a $5/month DG surcharge. Ensure customer understands net savings after fixed charges before committing.' },
      { reason: 'Incomplete DER application', how_to_avoid: 'Follow the Alabama Power TIR Guidebook checklist exactly. Missing any required documentation causes significant delays.' },
    ],
    solar_pro_note: 'Alabama Power territory has complex solar economics — moderate rates (~$0.13/kWh) but significant fixed monthly charges reduce solar bill savings. Alabama Power also charges a DG surcharge. However, excellent solar resource (>280 sunny days/year, ~1,800 kWh/kW/year) and the 30% federal ITC provide solid long-term value. ROI typically 12–16 years with realistic expectations set.',
    last_verified: '2025-06',
  },

  // ── Rocky Mountain Power — Utah / Idaho ───────────────────────────────────
  {
    utility_id: 'rockmtn_power_ut',
    utility_name: 'Rocky Mountain Power (PacifiCorp — Utah)',
    state: 'UT',
    portal_type: 'online_portal',
    application_url: 'https://www.rockymountainpower.net/savings-energy-choices/customer-generation.html',
    info_url: 'https://www.rockymountainpower.net/savings-energy-choices/customer-generation.html',
    interconnection_phone: '1-888-221-7070',
    application_form_name: 'Rocky Mountain Power Net Metering Transition Program (NMTP) Application',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: true,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      { label: 'NMTP Application', description: 'Submit Rocky Mountain Power net metering transition program application. Utah transitioned from traditional NEM to NMTP in 2017.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Single-Line Diagram', description: 'Required for all residential systems.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Local AHJ Permit', description: 'County or city building permit required.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
    ],
    ica_approval_days_min: 15,
    ica_approval_days_max: 35,
    timeline_note: 'Rocky Mountain Power processes most residential applications in 15–25 business days. Utah municipalities generally have efficient permit processes.',
    pto_trigger: 'final_inspection',
    pto_days_min: 10,
    pto_days_max: 20,
    pto_steps: [
      '1. Pass local AHJ building inspection.',
      '2. Submit inspection documentation to Rocky Mountain Power.',
      '3. Rocky Mountain Power installs net billing meter and issues PTO.',
    ],
    homeowner_pto_checklist: [
      'Local inspection passed',
      'Documentation submitted to Rocky Mountain Power',
      'Await RMP PTO before energizing',
    ],
    common_rejections: [
      { reason: 'NMTP program misunderstanding — not traditional NEM', how_to_avoid: 'Ensure customer understands Utah NMTP: excess energy credited at wholesale rate (~$0.03–$0.05/kWh), not retail. System should be sized for self-consumption, not export.' },
    ],
    solar_pro_note: 'Rocky Mountain Power (RMP) serves most of Utah. Utah uses Net Metering Transition Program (NMTP) — export credits are at avoided cost (~$0.03–$0.05/kWh), not retail. Size systems for maximum self-consumption. Despite reduced export value, excellent solar resource (~2,000 kWh/kW/year), no UT income tax on solar, and 30% federal ITC make Utah a strong solar market. ROI typically 9–13 years when sized correctly.',
    last_verified: '2025-06',
  },

  // ── Rocky Mountain Power — Idaho ──────────────────────────────────────────
  {
    utility_id: 'rocky_mountain_power_id',
    utility_name: 'Rocky Mountain Power (PacifiCorp — Idaho)',
    state: 'ID',
    portal_type: 'online_portal',
    application_url: 'https://www.rockymountainpower.net/savings-energy-choices/customer-generation.html',
    info_url: 'https://www.rockymountainpower.net/savings-energy-choices/customer-generation.html',
    interconnection_phone: '1-888-221-7070',
    application_form_name: 'Rocky Mountain Power Idaho Net Metering Application',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: true,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      { label: 'Net Metering Application', description: 'Submit RMP Idaho net metering application online or by mail.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Single-Line Diagram', description: 'Required for all residential systems.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Local AHJ Permit', description: 'County or city building permit required.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
    ],
    ica_approval_days_min: 15,
    ica_approval_days_max: 35,
    timeline_note: 'Same process as RMP Utah with Idaho PUC rules applied.',
    pto_trigger: 'final_inspection',
    pto_days_min: 10,
    pto_days_max: 20,
    pto_steps: [
      '1. Pass local AHJ inspection.',
      '2. Submit inspection documentation to RMP.',
      '3. RMP installs net meter and issues PTO.',
    ],
    homeowner_pto_checklist: [
      'Local inspection passed',
      'Documentation submitted to RMP',
      'Await RMP PTO before energizing',
    ],
    common_rejections: [
      { reason: 'System over-sized for prior year usage', how_to_avoid: 'Idaho PUC limits net metering to 100% of prior 12-month consumption.' },
    ],
    solar_pro_note: 'RMP Idaho serves parts of eastern Idaho. Very low rates (~$0.09–$0.11/kWh) mean longer payback but excellent solar resource (~2,000 kWh/kW/year). Battery storage for energy independence is the primary value driver.',
    last_verified: '2025-06',
  },

  // ── Dominion SC — South Carolina ──────────────────────────────────────────
  {
    utility_id: 'dominion_sc',
    utility_name: 'Dominion Energy South Carolina',
    state: 'SC',
    portal_type: 'online_portal',
    application_url: 'https://www.dominionenergy.com/en/South-Carolina/Save-Energy/Solar-for-Your-Home',
    info_url: 'https://www.dominionenergy.com/en/South-Carolina/Save-Energy/Solar-for-Your-Home',
    interconnection_phone: '1-800-251-7234',
    application_form_name: 'Dominion Energy SC Net Energy Metering Application',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: true,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      { label: 'NEM Application', description: 'Submit via Dominion SC portal. Include system specs, equipment, and site plan.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Single-Line Diagram', description: 'Required for all residential systems.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'SC / Local AHJ Permit', description: 'County or municipality building permit required.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
    ],
    ica_approval_days_min: 20,
    ica_approval_days_max: 45,
    timeline_note: 'Dominion SC processes most residential applications in 20–35 business days. South Carolina has a standardized interconnection process.',
    pto_trigger: 'final_inspection',
    pto_days_min: 10,
    pto_days_max: 25,
    pto_steps: [
      '1. Pass local AHJ building inspection.',
      '2. Submit inspection documentation to Dominion SC.',
      '3. Dominion SC installs net meter and issues PTO.',
    ],
    homeowner_pto_checklist: [
      'Local inspection passed',
      'Documentation submitted to Dominion SC',
      'Await Dominion SC PTO before energizing',
    ],
    common_rejections: [
      { reason: 'System over-sized for prior year usage', how_to_avoid: 'SC rules cap NEM at 100% of 12-month prior consumption.' },
    ],
    solar_pro_note: 'Dominion SC serves central/eastern South Carolina. SC NEM provides full retail credit. Moderate rates (~$0.13–$0.16/kWh) and excellent solar production (~1,800 kWh/kW/year). SC solar tax credit (25%, up to $3,500) plus federal ITC improve ROI significantly. Typical payback 8–12 years.',
    last_verified: '2025-06',
  },

  // ── AEP Ohio ──────────────────────────────────────────────────────────────
  {
    utility_id: 'aep_oh',
    utility_name: 'AEP Ohio (Columbus Southern Power / Ohio Power)',
    state: 'OH',
    portal_type: 'online_portal',
    application_url: 'https://www.aepohio.com/clean-energy/renewable/solar',
    info_url: 'https://www.aepohio.com/clean-energy/renewable',
    interconnection_phone: '1-800-672-2231',
    application_form_name: 'AEP Ohio Distributed Generation Interconnection Application',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: true,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      { label: 'DG Application', description: 'Submit via AEP Ohio online portal or mail. Include system specs and equipment documentation.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Single-Line Diagram', description: 'Required for all residential systems.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Ohio / Local AHJ Permit', description: 'Municipality or county building permit required.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
    ],
    ica_approval_days_min: 20,
    ica_approval_days_max: 50,
    timeline_note: 'AEP Ohio processes most residential applications in 20–40 business days. Ohio has standardized interconnection rules under PUCO.',
    pto_trigger: 'final_inspection',
    pto_days_min: 10,
    pto_days_max: 25,
    pto_steps: [
      '1. Pass local AHJ building inspection.',
      '2. Submit inspection documentation to AEP Ohio.',
      '3. AEP Ohio installs net meter and issues PTO.',
    ],
    homeowner_pto_checklist: [
      'Local inspection passed',
      'Documentation submitted to AEP Ohio',
      'Await AEP Ohio PTO before energizing',
    ],
    common_rejections: [
      { reason: 'Application submitted without complete equipment documentation', how_to_avoid: 'Include CEC-listed equipment datasheets and specification sheets with all applications.' },
    ],
    solar_pro_note: 'AEP Ohio serves central and southeastern Ohio. Ohio NEM provides full retail credit with annual true-up. Moderate rates (~$0.13–$0.17/kWh) and moderate sun (~1,400 kWh/kW/year). Ohio has a solar sales tax exemption. ROI typically 11–15 years. Ohio SREC market is active — additional income stream for customers.',
    last_verified: '2025-06',
  },

  // ── NIPSCO — Northern Indiana ─────────────────────────────────────────────
  {
    utility_id: 'nipsco_in',
    utility_name: 'NIPSCO (Northern Indiana Public Service Company)',
    state: 'IN',
    portal_type: 'online_portal',
    application_url: 'https://www.nipsco.com/services/renewable-energy-programs/net-metering',
    info_url: 'https://www.nipsco.com/services/renewable-energy-programs/net-metering',
    interconnection_phone: '1-800-464-7726',
    application_form_name: 'NIPSCO Net Metering / Interconnection Application',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: true,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      { label: 'Net Metering Application', description: 'Submit via NIPSCO online portal or by mail. Include system specs and equipment documentation.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Single-Line Diagram', description: 'Required for all residential systems.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Indiana / Local AHJ Permit', description: 'Municipality or county building permit required.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
    ],
    ica_approval_days_min: 15,
    ica_approval_days_max: 40,
    timeline_note: 'NIPSCO processes most residential applications in 15–30 business days under Indiana IURC interconnection rules.',
    pto_trigger: 'final_inspection',
    pto_days_min: 10,
    pto_days_max: 20,
    pto_steps: [
      '1. Pass local AHJ building inspection.',
      '2. Submit inspection documentation to NIPSCO.',
      '3. NIPSCO installs net meter and issues PTO authorization.',
    ],
    homeowner_pto_checklist: [
      'Local inspection passed',
      'Documentation submitted to NIPSCO',
      'Await NIPSCO PTO before energizing',
    ],
    common_rejections: [
      { reason: 'System over-sized for annual usage', how_to_avoid: 'Indiana caps NEM at 100% of annual consumption.' },
    ],
    solar_pro_note: 'NIPSCO serves northern Indiana including South Bend, Fort Wayne, and Gary. Indiana NEM provides full retail credit (for now — Indiana has sunset provisions for NEM, verify current status). Moderate rates (~$0.14–$0.18/kWh) and moderate sun. ROI typically 11–15 years.',
    last_verified: '2025-06',
  },

  // ── LG&E / KU — Kentucky ──────────────────────────────────────────────────
  {
    utility_id: 'ku_ky',
    utility_name: 'Kentucky Utilities / LG&E (Louisville Gas and Electric)',
    state: 'KY',
    portal_type: 'online_portal',
    application_url: 'https://lge-ku.com/net-metering',
    info_url: 'https://lge-ku.com/net-metering',
    interconnection_phone: '1-800-981-0600',
    application_form_name: 'KU / LG&E Net Metering Application',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: true,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      { label: 'Net Metering Application', description: 'Submit via LG&E/KU online portal. Include system specs and equipment documentation.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Single-Line Diagram', description: 'Required for all residential systems.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Kentucky / Local AHJ Permit', description: 'Municipality or county building permit required.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
    ],
    ica_approval_days_min: 15,
    ica_approval_days_max: 40,
    timeline_note: 'LG&E/KU processes most residential applications in 15–30 business days under Kentucky PSC rules.',
    pto_trigger: 'final_inspection',
    pto_days_min: 10,
    pto_days_max: 20,
    pto_steps: [
      '1. Pass local AHJ building inspection.',
      '2. Submit inspection documentation to KU or LG&E.',
      '3. Utility installs net meter and issues PTO.',
    ],
    homeowner_pto_checklist: [
      'Local inspection passed',
      'Documentation submitted to KU/LG&E',
      'Await PTO before energizing',
    ],
    common_rejections: [
      { reason: 'System over-sized for annual usage', how_to_avoid: 'Kentucky caps net metering at 100% of annual consumption.' },
    ],
    solar_pro_note: 'LG&E and KU serve Louisville and central/eastern Kentucky. Kentucky NEM provides full retail credit with monthly rollover and annual true-up at avoided cost. Moderate rates (~$0.11–$0.15/kWh) and moderate sun (~1,400 kWh/kW/year). ROI typically 12–16 years. Federal ITC is the primary incentive as KY has no state solar incentive.',
    last_verified: '2025-06',
  },

  // ── Evergy — Kansas / Missouri ────────────────────────────────────────────
  {
    utility_id: 'evergy_ks',
    utility_name: 'Evergy (Kansas)',
    state: 'KS',
    portal_type: 'online_portal',
    application_url: 'https://www.evergy.com/residential/solar-wind-rooftop-solar',
    info_url: 'https://www.evergy.com/home/energy-products-services/solar-energy',
    interconnection_phone: '1-888-471-5275',
    application_form_name: 'Evergy Net Metering / Interconnection Application',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: true,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      { label: 'Net Metering Application', description: 'Submit via Evergy online portal. Include system specs and equipment documentation.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Single-Line Diagram', description: 'Required for all systems.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Kansas / Local AHJ Permit', description: 'Municipality or county building permit required.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
    ],
    ica_approval_days_min: 15,
    ica_approval_days_max: 35,
    timeline_note: 'Evergy processes most residential applications in 15–25 business days under Kansas Corporation Commission rules.',
    pto_trigger: 'final_inspection',
    pto_days_min: 10,
    pto_days_max: 20,
    pto_steps: [
      '1. Pass local AHJ building inspection.',
      '2. Submit inspection documentation to Evergy.',
      '3. Evergy installs net meter and issues PTO.',
    ],
    homeowner_pto_checklist: [
      'Local inspection passed',
      'Documentation submitted to Evergy',
      'Await Evergy PTO before energizing',
    ],
    common_rejections: [
      { reason: 'System over-sized for annual usage', how_to_avoid: 'Kansas NEM caps at 100% of prior 12-month consumption.' },
    ],
    solar_pro_note: 'Evergy serves Kansas City (KS side) and central/eastern Kansas. Kansas NEM provides retail credit with monthly rollover and annual true-up at avoided cost. Moderate rates (~$0.12–$0.15/kWh) and good sun (1,700–1,900 kWh/kW/year). Kansas has no state solar incentive but federal ITC applies. ROI typically 12–16 years.',
    last_verified: '2025-06',
  },

  // ── OG&E — Oklahoma ───────────────────────────────────────────────────────
  {
    utility_id: 'oge_ok',
    utility_name: 'Oklahoma Gas and Electric (OG&E)',
    state: 'OK',
    portal_type: 'online_portal',
    application_url: 'https://www.oge.com/wps/portal/oge/home/for-my-home/solar-wind-at-home',
    info_url: 'https://www.oge.com/wps/portal/oge/home/for-my-home/solar-wind-at-home',
    interconnection_phone: '1-405-272-9741',
    application_form_name: 'OG&E Net Metering / Interconnection Application',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: true,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      { label: 'Net Metering Application', description: 'Submit via OG&E online portal. Include system specs and equipment documentation.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Single-Line Diagram', description: 'Required for all residential systems.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Oklahoma / Local AHJ Permit', description: 'County or city building permit required.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
    ],
    ica_approval_days_min: 15,
    ica_approval_days_max: 40,
    timeline_note: 'OG&E processes most residential applications in 15–30 business days under OCC rules.',
    pto_trigger: 'final_inspection',
    pto_days_min: 10,
    pto_days_max: 20,
    pto_steps: [
      '1. Pass local AHJ building inspection.',
      '2. Submit inspection documentation to OG&E.',
      '3. OG&E installs net meter and issues PTO.',
    ],
    homeowner_pto_checklist: [
      'Local inspection passed',
      'Documentation submitted to OG&E',
      'Await OG&E PTO before energizing',
    ],
    common_rejections: [
      { reason: 'System sized over 100% of prior year usage', how_to_avoid: 'Oklahoma NEM caps residential solar at 100% of 12-month historical usage.' },
    ],
    solar_pro_note: 'OG&E serves Oklahoma City metro and surrounding areas (also parts of western Arkansas). Oklahoma NEM provides full retail credit. Excellent solar resource (~2,000 kWh/kW/year) and low rates (~$0.10–$0.13/kWh) — ROI is moderate at 13–17 years but federal ITC significantly improves economics. Strong storm/resilience value for battery storage.',
    last_verified: '2025-06',
  },

  // ── Entergy Texas ─────────────────────────────────────────────────────────
  {
    utility_id: 'entergy_tx',
    utility_name: 'Entergy Texas',
    state: 'TX',
    portal_type: 'online_portal',
    application_url: 'https://www.entergytexas.com/net-metering',
    info_url: 'https://www.entergytexas.com/net-metering',
    interconnection_phone: '1-800-968-8243',
    application_form_name: 'Entergy Texas Net Metering / Interconnection Application',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: true,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      { label: 'Net Metering Application', description: 'Submit via Entergy Texas net metering portal. Entergy TX is regulated — unlike most of TX which is ERCOT deregulated.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Single-Line Diagram', description: 'Required for all residential systems.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Texas / Local AHJ Permit', description: 'County or municipality building permit required.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
    ],
    ica_approval_days_min: 20,
    ica_approval_days_max: 45,
    timeline_note: 'Entergy Texas processes most residential applications in 20–35 business days under PUCT rules.',
    pto_trigger: 'final_inspection',
    pto_days_min: 10,
    pto_days_max: 25,
    pto_steps: [
      '1. Pass local AHJ building inspection.',
      '2. Submit inspection documentation to Entergy Texas.',
      '3. Entergy Texas installs net meter and issues PTO.',
    ],
    homeowner_pto_checklist: [
      'Local inspection passed',
      'Documentation submitted to Entergy Texas',
      'Await Entergy Texas PTO before energizing',
    ],
    common_rejections: [
      { reason: 'System exceeds 50 kW — different interconnection process required', how_to_avoid: 'Residential systems under 50 kW use simplified interconnection. Larger systems require additional engineering review.' },
    ],
    solar_pro_note: 'Note: Entergy Texas serves a regulated enclave in southeast Texas (Beaumont, Port Arthur areas) — NOT served by ERCOT. This is a key distinction from most of Texas. Full retail NEM applies. Moderate rates (~$0.12–$0.15/kWh) and excellent solar resource (~1,900 kWh/kW/year). ROI typically 10–14 years.',
    last_verified: '2025-06',
  },

  // ── Entergy Arkansas ──────────────────────────────────────────────────────
  {
    utility_id: 'entergy_ar',
    utility_name: 'Entergy Arkansas',
    state: 'AR',
    portal_type: 'online_portal',
    application_url: 'https://www.entergyarkansas.com/net-metering',
    info_url: 'https://www.entergyarkansas.com/net-metering',
    interconnection_phone: '1-800-368-3749',
    application_form_name: 'Entergy Arkansas Net Metering / Interconnection Application',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: true,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      { label: 'Net Metering Application', description: 'Submit via Entergy Arkansas net metering portal.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Single-Line Diagram', description: 'Required for all residential systems.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Arkansas / Local AHJ Permit', description: 'County or city building permit required.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
    ],
    ica_approval_days_min: 20,
    ica_approval_days_max: 45,
    timeline_note: 'Entergy Arkansas processes most residential applications in 20–35 business days under APSC rules.',
    pto_trigger: 'final_inspection',
    pto_days_min: 10,
    pto_days_max: 25,
    pto_steps: [
      '1. Pass local AHJ building inspection.',
      '2. Submit inspection documentation to Entergy Arkansas.',
      '3. Entergy Arkansas installs net meter and issues PTO.',
    ],
    homeowner_pto_checklist: [
      'Local inspection passed',
      'Documentation submitted to Entergy Arkansas',
      'Await Entergy Arkansas PTO before energizing',
    ],
    common_rejections: [
      { reason: 'System exceeds 300% of prior year usage — requires different application', how_to_avoid: 'AR has a 300% cap on NEM system sizing. Most residential systems are well under this.' },
    ],
    solar_pro_note: 'Entergy Arkansas serves central and eastern Arkansas. AR NEM provides full retail credit. Moderate rates (~$0.11–$0.14/kWh) and good solar resource (~1,700 kWh/kW/year). No state solar incentive but federal ITC applies. ROI typically 13–17 years.',
    last_verified: '2025-06',
  },

  // ── Entergy Mississippi ────────────────────────────────────────────────────
  {
    utility_id: 'entergy_ms',
    utility_name: 'Entergy Mississippi',
    state: 'MS',
    portal_type: 'online_portal',
    application_url: 'https://www.entergymississippi.com/net-metering',
    info_url: 'https://www.entergymississippi.com/net-metering',
    interconnection_phone: '1-800-368-3749',
    application_form_name: 'Entergy Mississippi Net Metering / Interconnection Application',
    requires_nem_application: true,
    requires_signed_ica: true,
    requires_anti_islanding_cert: true,
    requires_sld: true,
    requires_stamped_planset: false,
    requirements: [
      { label: 'Net Metering Application', description: 'Submit via Entergy Mississippi net metering portal.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Single-Line Diagram', description: 'Required for all residential systems.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
      { label: 'Mississippi / Local AHJ Permit', description: 'County or city building permit required.', required_small_system: true, required_large_system: true, prepared_by: 'contractor' },
    ],
    ica_approval_days_min: 20,
    ica_approval_days_max: 45,
    timeline_note: 'Entergy Mississippi processes most residential applications in 20–35 business days under MPSC rules.',
    pto_trigger: 'final_inspection',
    pto_days_min: 10,
    pto_days_max: 25,
    pto_steps: [
      '1. Pass local AHJ building inspection.',
      '2. Submit inspection documentation to Entergy Mississippi.',
      '3. Entergy Mississippi installs net meter and issues PTO.',
    ],
    homeowner_pto_checklist: [
      'Local inspection passed',
      'Documentation submitted to Entergy Mississippi',
      'Await Entergy Mississippi PTO before energizing',
    ],
    common_rejections: [
      { reason: 'System over-sized for prior year usage', how_to_avoid: 'MS caps NEM at 200% of annual consumption.' },
    ],
    solar_pro_note: 'Entergy Mississippi serves most of Mississippi. MS NEM provides full retail credit. Low rates (~$0.12/kWh) and moderate sun (~1,700 kWh/kW/year) mean ROI is typically 13–17 years. No state solar incentive. Federal ITC is the key incentive.',
    last_verified: '2025-06',
  },

];


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
    solar_pro_note: "Georgia Power's Advanced Solar Initiative and Commercial rooftop rates apply. EMCs (Jackson EMC, Walton EMC, etc.) have varying policies. No mandatory retail NEM — self-consumption maximization is key. ITC is primary incentive.",
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
    solar_pro_note: "LG&E/KU has a Tier-1 profile. Kentucky RECCs (Rural Electric Cooperative Corporations) cover ~60% of the state's land area. Co-op policies vary significantly — confirm export rate and meter policy before installation. Low electricity rates mean solar payback is 14–20 years without incentives.",
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
    nem_summary: "Tennessee is primarily served by TVA (Tennessee Valley Authority) and its ~155 local power companies (LPCs). TVA's Green Power Switch and Generation Partners programs provide avoided-cost compensation, not retail NEM. LPC policies vary but follow TVA framework.",
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
    solar_pro_note: "Green Mountain Power (GMP) is the primary utility in Vermont and has innovative battery/grid programs. GMP's \"bring your own battery\" and community solar programs are noteworthy. Vermont has high electricity rates (~$0.20/kWh) and strong renewable policy. Low irradiance vs. southern states but economics remain viable.",
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

// ─── Lookup Functions ────────────────────────────────────────────────────────

let _icaMap: Map<string, InterconnectionProfile> | null = null;

function buildIcaMap(): Map<string, InterconnectionProfile> {
  const map = new Map<string, InterconnectionProfile>();
  for (const profile of INTERCONNECTION_PROFILES) {
    map.set(profile.utility_id, profile);
  }
  return map;
}

/**
 * Get the interconnection profile for a specific utility.
 * Returns null if no profile exists for this utility.
 *
 * @param utilityId - The utility_id from proposalTruthEngine.ts / utilityPrograms.ts
 */
export function getInterconnectionProfile(utilityId: string): InterconnectionProfile | null {
  if (!_icaMap) _icaMap = buildIcaMap();
  return _icaMap.get(utilityId) ?? null;
}

/**
 * Get a formatted PTO roadmap string for use in permit packages and proposals.
 * Returns null if no profile exists.
 */
export function getPtoRoadmap(utilityId: string): string | null {
  const profile = getInterconnectionProfile(utilityId);
  if (!profile) return null;

  const steps = profile.pto_steps.join('\n');
  const ptoRange = `${profile.pto_days_min}–${profile.pto_days_max} business days`;
  const icaRange = `${profile.ica_approval_days_min}–${profile.ica_approval_days_max} business days`;

  return [
    `UTILITY: ${profile.utility_name}`,
    `ICA APPROVAL TIME: ${icaRange}`,
    `PTO WAIT TIME: ${ptoRange}`,
    ``,
    `PTO PROCESS:`,
    steps,
    ``,
    `HOMEOWNER CHECKLIST:`,
    profile.homeowner_pto_checklist.map(item => `• ${item}`).join('\n'),
  ].join('\n');
}

/**
 * Get all utility IDs that have interconnection profiles registered.
 */
export function getUtilitiesWithInterconnectionData(): string[] {
  if (!_icaMap) _icaMap = buildIcaMap();
  return Array.from(_icaMap.keys());
}

/**
 * Get a concise Solar Pro coaching note for a utility's interconnection process.
 */
export function getInterconnectionNote(utilityId: string): string | null {
  const profile = getInterconnectionProfile(utilityId);
  if (!profile) return null;
  return profile.solar_pro_note;
}

/**
 * Get the typical total timeline (ICA + PTO) for a utility in calendar weeks.
 * Returns a human-readable estimate string.
 */
export function getTypicalTotalTimeline(utilityId: string): string | null {
  const profile = getInterconnectionProfile(utilityId);
  if (!profile) return null;

  const minDays = profile.ica_approval_days_min + profile.pto_days_min;
  const maxDays = profile.ica_approval_days_max + profile.pto_days_max;
  const minWeeks = Math.ceil(minDays / 5);
  const maxWeeks = Math.ceil(maxDays / 5);

  return `${minWeeks}–${maxWeeks} weeks (ICA: ${profile.ica_approval_days_min}–${profile.ica_approval_days_max} days + PTO: ${profile.pto_days_min}–${profile.pto_days_max} days)`;
}
