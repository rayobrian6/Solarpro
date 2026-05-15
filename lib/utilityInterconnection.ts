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
    info_url: 'https://www.fpl.com/clean-energy/solar/net-metering.html',
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
    info_url: 'https://www.duke-energy.com/home/products/solar-energy',
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
    info_url: 'https://www.xcelenergy.com/programs_and_rebates/residential_programs_and_rebates/solar_*_incentives_and_net_metering',
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
    info_url: 'https://www.dteenergy.com/us/en/residential/products-and-services/generating-your-own-power/solar-energy.html',
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
    info_url: 'https://www.aps.com/en/Residential/Service-Plans/Compare-Service-Plans/Distributed-Energy-Resources',
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
    info_url: 'https://www.srpnet.com/energy-savings-rebates/home/residential-solar/rooftop-solar/installation-process',
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
    info_url: 'https://www.duke-energy.com/home/products/solar-energy',
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
    info_url: 'https://www.georgiapower.com/solar.html',
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
    info_url: 'https://www.dominionenergy.com/virginia/savings-and-energy-efficiency/solar-energy',
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

];

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
