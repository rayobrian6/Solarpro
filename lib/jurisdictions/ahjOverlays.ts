// ============================================================
// AHJ SPECIAL-CASE OVERLAYS — lib/jurisdictions/ahjOverlays.ts
// v1.0
//
// Some AHJs impose constraints that go beyond what NEC alone
// dictates. This module provides structured per-AHJ overlays
// that the compliance engine can apply on top of the base
// NEC ruleset returned by ahj.ts / necVersions.ts.
//
// Currently covered:
//   1. CA Rule 21 (CPUC — all CA IOU territories: PG&E, SCE, SDG&E)
//   2. HECO Rule 14H / 14J (Oahu / Neighbor Islands, Hawaii)
//   3. PREPA (Puerto Rico Electric Power Authority)
//   4. NYC (New York City Electrical Code — Local Law 39)
//   5. NEM 3.0 overlay (CA post-April-2023 systems)
//   6. FL Net Metering (Florida PSC Rule 25-6.065)
//   7. TX PUCT (ERCOT interconnection — Rule 25.211)
//
// How it works:
//   - Each overlay is an AhjOverlay object that lists additional
//     ComplianceOverrideItems on top of the base checklist.
//   - applyAhjOverlay(baseChecklist, stateCode, utilityName) merges
//     the overlay items into the checklist.
//   - Overlays can ADD new items, MODIFY existing items (by id),
//     or DISABLE base items that the AHJ doesn't enforce.
// ============================================================

import type { ComplianceCheckItem } from './ahj';

// ── Types ────────────────────────────────────────────────────────────────────

export type OverlayAction = 'add' | 'modify' | 'disable';

export interface OverlayItem {
  /** Action: add a new item, modify an existing one, or disable one */
  action: OverlayAction;
  /** For 'modify'/'disable': ID of the base item to target */
  targetId?: string;
  /** The compliance item data (required for 'add' and 'modify') */
  item?: Partial<ComplianceCheckItem>;
}

export interface AhjOverlay {
  id: string;
  name: string;
  authority: string;            // Regulatory body (CPUC, HECO, PREPA, etc.)
  appliesTo: {
    stateCodes?: string[];      // State codes this overlay applies to
    utilities?: string[];       // Utility names (substring match, case-insensitive)
    ahjIds?: string[];          // Specific AHJ IDs from ahj-national.ts
    cities?: string[];          // City names (case-insensitive)
  };
  description: string;
  referenceUrl?: string;
  effectiveDate: string;
  items: OverlayItem[];
}

// ── Registry ─────────────────────────────────────────────────────────────────

export const AHJ_OVERLAYS: AhjOverlay[] = [

  // ── CA Rule 21 (CPUC) ─────────────────────────────────────────────────────
  {
    id: 'ca-rule-21',
    name: 'California Rule 21 (CPUC)',
    authority: 'California Public Utilities Commission (CPUC)',
    appliesTo: {
      stateCodes: ['CA'],
      utilities: ['pge', 'pg&e', 'pacific gas', 'sce', 'southern california edison', 'sdg&e', 'san diego gas'],
    },
    description: 'CPUC Rule 21 governs interconnection of distributed generation ≤1 MW for all CA IOU territories. ' +
      'Requires smart inverter functions (Rule 21 Section H), anti-islanding, LVRT/HVRT, frequency ride-through, ' +
      'reactive power capability, and NEM 3.0 billing structure for new systems (post April 15, 2023).',
    referenceUrl: 'https://www.cpuc.ca.gov/industries-and-topics/electrical-energy/infrastructure/electric-power-procurement/dem',
    effectiveDate: '2023-04-15',
    items: [
      {
        action: 'add',
        item: {
          id: 'ca_rule21_smart_inverter',
          category: 'Interconnection — CA Rule 21',
          requirement: 'Smart inverter required: must support Rule 21 Section H functions — Volt-VAR, Freq-Watt, Volt-Watt, fixed power factor, ramp rate control, anti-islanding, LVRT/HVRT',
          necReference: 'CPUC Rule 21 §H (UL 1741-SA / IEEE 1547-2018)',
          required: true,
          notes: 'All inverters must be certified to UL 1741-SA or UL 1741-SB. Must register with CPUC Interconnection Portal.',
        },
      },
      {
        action: 'add',
        item: {
          id: 'ca_rule21_nem3',
          category: 'Interconnection — CA Rule 21',
          requirement: 'NEM 3.0 billing applies for new PTO applications after April 15, 2023. Export compensation at avoided-cost rate (≈$0.02–$0.08/kWh). Battery storage strongly recommended to maximize self-consumption.',
          necReference: 'CPUC D.22-12-056 (NEM 3.0)',
          required: true,
          notes: 'NEM 2.0 grandfathering ends April 2026. Size battery to shift 70–80% of export to evening peak.',
        },
      },
      {
        action: 'add',
        item: {
          id: 'ca_rule21_pto',
          category: 'Interconnection — CA Rule 21',
          requirement: 'Permission to Operate (PTO) required from utility before activation. Do NOT energize system without PTO letter.',
          necReference: 'CPUC Rule 21 §B.2',
          required: true,
          notes: 'PTO timeline: 15–30 business days after passing inspection. Utility must approve before system goes live.',
        },
      },
      {
        action: 'add',
        item: {
          id: 'ca_title24',
          category: 'CA Title 24 Energy Code',
          requirement: 'Title 24 Part 6 compliance required. New residential construction must include solar per CEC mandatory provisions.',
          necReference: 'California Energy Code Title 24 Part 6 (2022)',
          required: true,
          notes: 'Applies to new construction. Battery storage required for new homes with solar in many jurisdictions.',
        },
      },
      {
        action: 'add',
        item: {
          id: 'ca_cal_fire_setbacks',
          category: 'CA CAL FIRE Setbacks',
          requirement: 'Additional setbacks required in State Responsibility Areas (SRAs) and Very High Fire Hazard Severity Zones (VHFHSZ). ' +
            'Confirm whether the site is in an SRA — if so, ember-resistant materials and additional clearances required.',
          necReference: 'CAL FIRE 14 CCR §1299',
          required: false,   // conditional on SRA designation
          notes: 'Check SRA designation at osfm.fire.ca.gov/map. Non-SRA sites: standard IFC setbacks apply.',
        },
      },
    ],
  },

  // ── HECO Rule 14H / 14J (Hawaii) ──────────────────────────────────────────
  {
    id: 'heco-rule-14h',
    name: 'HECO Rule 14H / 14J (Hawaii)',
    authority: 'Hawaiian Electric Company (HECO) / HECO subsidiaries (MECO, HELCO)',
    appliesTo: {
      stateCodes: ['HI'],
      utilities: ['heco', 'hawaiian electric', 'meco', 'maui electric', 'helco', 'hawaii electric light'],
    },
    description: 'HECO Rule 14H governs PV systems ≤100 kW on Oahu. Rule 14J governs neighbor island systems. ' +
      'Hawaii has the most restrictive interconnection requirements in the US due to grid stability concerns. ' +
      'Penetration caps, export limiting, and mandatory smart inverter certification are required.',
    referenceUrl: 'https://www.hawaiianelectric.com/products-and-services/customer-renewable-programs/rooftop-solar',
    effectiveDate: '2024-01-01',
    items: [
      {
        action: 'add',
        item: {
          id: 'heco_smart_export',
          category: 'Interconnection — HECO Rule 14H',
          requirement: 'Smart Export program required for new systems. Export limited to ≤75% of circuit capacity or per feeder cap. ' +
            'Some circuits are at or near cap — check HECO Hosting Capacity map before sizing.',
          necReference: 'HECO Rule 14H §8',
          required: true,
          notes: 'Check hosting capacity at heco-portals.com. Oversized exports may require detailed interconnection study ($$$).',
        },
      },
      {
        action: 'add',
        item: {
          id: 'heco_ul1741sa',
          category: 'Interconnection — HECO Rule 14H',
          requirement: 'UL 1741-SA (Grid Support Utility Interactive) certification required for all inverters. ' +
            'Must support: Volt-VAR, Volt-Watt, Frequency-Watt, anti-islanding, LVRT (0.16s at 0V), HVRT.',
          necReference: 'HECO Rule 14H §5 / UL 1741-SA',
          required: true,
          notes: 'Verify inverter is on HECO approved inverter list (updated quarterly). SolarEdge, Enphase, SMA are generally approved.',
        },
      },
      {
        action: 'add',
        item: {
          id: 'heco_css_self_supply',
          category: 'Interconnection — HECO Rule 14H',
          requirement: 'Customer Self-Supply (CSS) program: size system to cover annual consumption (no export). ' +
            'Smart Export: allows export up to feeder cap. Choose program before submitting interconnection application.',
          necReference: 'HECO Rule 14H / Customer Renewable Programs',
          required: true,
          notes: 'CSS avoids export cap issues. Smart Export required for battery-eligible storage+solar combinations.',
        },
      },
      {
        action: 'add',
        item: {
          id: 'heco_rsd_hurricane',
          category: 'Structural — HECO / Hawaii',
          requirement: 'Hurricane wind uplift calculations required. Design for 160 mph basic wind speed (ASCE 7-22 Risk Category II). ' +
            'Racking must be ICC-certified for hurricane exposure category D.',
          necReference: 'Hawaii State Building Code (HRS Chapter 107) / ASCE 7-22',
          required: true,
          notes: 'Hawaii is in ASCE 7 Wind Zone IV. All racking datasheets must show 160+ mph rating. Standard mainland mounts FAIL.',
        },
      },
    ],
  },

  // ── PREPA (Puerto Rico) ────────────────────────────────────────────────────
  {
    id: 'prepa-pr',
    name: 'PREPA / LUMA (Puerto Rico)',
    authority: 'Puerto Rico Electric Power Authority (PREPA) / LUMA Energy',
    appliesTo: {
      stateCodes: ['PR'],
      utilities: ['prepa', 'luma', 'luma energy', 'puerto rico electric'],
    },
    description: 'LUMA Energy (PREPA operator) governs DG interconnection in Puerto Rico. ' +
      'Net metering capped at 40% of utility peak demand per feeder. ' +
      'Very high hurricane exposure requires special structural certifications. ' +
      'Energy storage incentives available via Puerto Rico Act 114.',
    referenceUrl: 'https://lumaenergypr.com/en/my-home/net-metering/',
    effectiveDate: '2022-06-01',
    items: [
      {
        action: 'add',
        item: {
          id: 'prepa_net_metering_cap',
          category: 'Interconnection — PREPA/LUMA',
          requirement: 'Net metering cap: 40% of feeder peak demand. Many feeders are at or near cap — submit interconnection inquiry FIRST before finalizing system size.',
          necReference: 'Puerto Rico Act 17 (2019) / PREB Order 2019-0026',
          required: true,
          notes: 'Act 17 mandates 100% renewable by 2050 but interconnection queue delays are common. Budget 60–180 days.',
        },
      },
      {
        action: 'add',
        item: {
          id: 'prepa_hurricane_rating',
          category: 'Structural — PREPA/Puerto Rico',
          requirement: 'Hurricane wind design required: 185 mph basic wind speed (ASCE 7-22 Risk Category II, Exposure D). ' +
            'Racking must be PE-stamped for 185 mph. IBC 2021 compliance required.',
          necReference: 'Puerto Rico Building Code (2018 IBC + PR amendments) / ASCE 7-22',
          required: true,
          notes: 'Post-Maria (2017), Puerto Rico has the strictest hurricane wind requirements. Many standard mounts are NOT approved.',
        },
      },
      {
        action: 'add',
        item: {
          id: 'prepa_pe_stamp',
          category: 'Permitting — Puerto Rico',
          requirement: 'PE stamp from Puerto Rico–licensed Professional Engineer required on all structural and electrical plan sets.',
          necReference: 'Puerto Rico Engineers and Surveyors Act (Law 173-1998)',
          required: true,
          notes: 'Out-of-state PE stamps NOT accepted. PR PE registration required. Budget 2–4 weeks for PR PE review.',
        },
      },
      {
        action: 'add',
        item: {
          id: 'prepa_storage_incentive',
          category: 'Incentives — Puerto Rico',
          requirement: 'Battery storage incentives available: Act 114 (2007) + IRS 30% ITC. Grid-forming storage strongly recommended given grid reliability.',
          necReference: 'Puerto Rico Act 114-2007',
          required: false,
          notes: 'Many PR customers size for island-mode due to frequent outages. Tesla Powerwall, Enphase IQ Battery, Franklin aPower approved.',
        },
      },
    ],
  },

  // ── NYC Local Law 39 / NYC Electrical Code ────────────────────────────────
  {
    id: 'nyc-local-law-39',
    name: 'NYC Electrical Code (Local Law 39)',
    authority: 'New York City Department of Buildings (DOB)',
    appliesTo: {
      stateCodes: ['NY'],
      cities: ['new york city', 'new york', 'brooklyn', 'bronx', 'manhattan', 'queens', 'staten island'],
    },
    description: 'NYC uses its own Electrical Code (based on NEC 2017 + amendments via Local Law 39). ' +
      'All solar installations require a DOB Special Inspection if >100A. ' +
      'Con Edison interconnection required — uses NEM tariff SC-15. ' +
      'Ballasted rooftop systems require structural sign-off from a NYC-licensed PE.',
    referenceUrl: 'https://www1.nyc.gov/site/buildings/industry/photovoltaic-systems.page',
    effectiveDate: '2020-01-01',
    items: [
      {
        action: 'modify',
        targetId: 'permit',
        item: {
          notes: 'NYC DOB filing required. Use eFiling Center (DOB NOW: Build). Filing fee: $280 + $1.50/kW. Licensed NYC Master Electrician required as applicant of record. PE/RA sign-off required for structural.',
        },
      },
      {
        action: 'add',
        item: {
          id: 'nyc_special_inspection',
          category: 'NYC DOB Special Inspection',
          requirement: 'DOB Special Inspection required for PV systems with inverter capacity >100A or any roof penetration on occupied buildings. ' +
            'Special Inspector must be DOB-approved.',
          necReference: 'NYC Building Code BC 1705.12 / RCNY §104-01',
          required: true,
          notes: 'Budget 1–4 weeks for DOB inspection scheduling. Inspections can be backlogged. Request as early as possible.',
        },
      },
      {
        action: 'add',
        item: {
          id: 'nyc_coned_interconnection',
          category: 'Interconnection — Con Edison',
          requirement: 'Con Edison interconnection application required (SC-15 tariff for residential NEM). ' +
            'Systems >25 kW require detailed study. NEM 2.0 grandfathering available through 2027.',
          necReference: 'Con Edison Service Classification No. 15 (Revised)',
          required: true,
          notes: 'Con Edison has 30–60 day review timeline. Submit interconnection application 30+ days before expected installation.',
        },
      },
      {
        action: 'add',
        item: {
          id: 'nyc_ballast_structural',
          category: 'Structural — NYC Ballasted Systems',
          requirement: 'Ballasted flat-roof PV systems require structural analysis by NYC-licensed PE. ' +
            'Dead load must not exceed roof capacity. Typically requires 5–10 psf available capacity above existing dead load.',
          necReference: 'NYC Building Code BC 1605 / ASCE 7-22',
          required: true,
          notes: 'Many NYC flat roofs (pre-1970) cannot support ballasted systems without structural reinforcement. Penetrating mount preferred.',
        },
      },
      {
        action: 'add',
        item: {
          id: 'nyc_master_electrician',
          category: 'Permitting — NYC',
          requirement: 'NYC Master Electrician (license class A) required as electrical contractor of record. ' +
            'Master Electrician must sign all DOB electrical work permits (EW permits).',
          necReference: 'NYC Administrative Code §27-3017',
          required: true,
          notes: 'Non-NYC Master Electricians cannot pull NYC permits. Verify license at NYC DOB License Search.',
        },
      },
    ],
  },

  // ── Florida Net Metering (PSC Rule 25-6.065) ──────────────────────────────
  {
    id: 'fl-net-metering',
    name: 'Florida Net Metering (PSC Rule 25-6.065)',
    authority: 'Florida Public Service Commission (FPSC)',
    appliesTo: {
      stateCodes: ['FL'],
      utilities: ['fpl', 'florida power & light', 'florida power and light', 'duke energy florida',
                  'duke', 'tampa electric', 'teco', 'florida public utilities', 'clay electric'],
    },
    description: 'Florida PSC Rule 25-6.065 governs net metering for IOUs. ' +
      'Net metering billing at retail rate through 2029 (phase-out per SB 1024). ' +
      'All systems require utility interconnection agreement and anti-islanding.',
    referenceUrl: 'https://www.psc.state.fl.us/Industry/Electric/NetMeter',
    effectiveDate: '2022-08-01',
    items: [
      {
        action: 'add',
        item: {
          id: 'fl_net_metering_2029',
          category: 'Interconnection — Florida NEM',
          requirement: 'Net metering at retail rate available for existing customers through 2029 (SB 1024 phase-out). ' +
            'New customers after Jan 2024 receive avoided-cost rate for excess exports. Size system to minimize exports.',
          necReference: 'Florida PSC Rule 25-6.065 / SB 1024 (2022)',
          required: true,
          notes: 'SB 1024 reduces export value significantly after 2029. Self-consumption optimization and battery storage recommended.',
        },
      },
      {
        action: 'add',
        item: {
          id: 'fl_wind_design',
          category: 'Structural — Florida Wind',
          requirement: 'Florida Building Code wind design required. Coastal zones: 150–180 mph. Inland: 120–140 mph. ' +
            'Racking must have FL Product Approval Number (NOA for Miami-Dade or FL Product Approval for other counties).',
          necReference: 'Florida Building Code 7th Ed. / ASCE 7-22',
          required: true,
          notes: 'Miami-Dade County requires NOA (Notice of Acceptance) for all products. Broward, Palm Beach follow suit. Verify racking NOA.',
        },
      },
    ],
  },

  // ── Texas PUCT / ERCOT ────────────────────────────────────────────────────
  {
    id: 'tx-puct-ercot',
    name: 'Texas PUCT / ERCOT Interconnection',
    authority: 'Public Utility Commission of Texas (PUCT) / ERCOT',
    appliesTo: {
      stateCodes: ['TX'],
      utilities: ['oncor', 'centerpoint', 'tnmp', 'aep texas', 'texas new mexico power'],
    },
    description: 'Texas has no statewide net metering mandate (deregulated market). ' +
      'Interconnection via TDSP (Transmission Distribution Service Provider). ' +
      'Standard Interconnection Process (SIP) for systems ≤10 kW; Simplified for >10 kW. ' +
      'Buyback programs vary by REP (Retail Electric Provider).',
    referenceUrl: 'https://www.puc.texas.gov/industry/electric/rules/subrules/electric/25.211/25.211.pdf',
    effectiveDate: '2023-01-01',
    items: [
      {
        action: 'add',
        item: {
          id: 'tx_no_net_metering',
          category: 'Interconnection — Texas',
          requirement: 'Texas has NO statewide net metering requirement. Buyback rates vary by REP — confirm buyback rate BEFORE customer signs contract. ' +
            'Most buyback rates are ≈$0.02–$0.08/kWh (wholesale ERCOT). Some REPs offer 1:1 buyback.',
          necReference: 'PUCT Rule 25.211 / ERCOT Protocols §10',
          required: true,
          notes: 'Recommend sizing for self-consumption first. Battery storage ROI is strong in TX given no retail export credit.',
        },
      },
      {
        action: 'add',
        item: {
          id: 'tx_tdsp_interconnection',
          category: 'Interconnection — Texas TDSP',
          requirement: 'Interconnection application required to TDSP (Oncor / CenterPoint / TNMP / AEP Texas). ' +
            'SIP (<10 kW): ~15 days. Non-SIP (>10 kW): 90–180 days. System cannot be energized before TDSP approval.',
          necReference: 'PUCT Rule 25.211',
          required: true,
          notes: 'TDSP approval is separate from REP buyback agreement. Both required. Oncor SIP Portal: oncorconnect.com.',
        },
      },
    ],
  },

];

// ── Overlay Matching Logic ────────────────────────────────────────────────────

/**
 * Find all overlays that apply to a given site.
 *
 * @param stateCode   Two-letter state code (e.g. 'CA', 'HI')
 * @param utilityName Utility name (e.g. 'PG&E', 'HECO') — substring matched
 * @param city        City name (e.g. 'New York City') — substring matched
 * @param ahjId       AHJ ID from ahj-national.ts (e.g. 'ca-los-angeles-county')
 */
export function getApplicableOverlays(
  stateCode: string,
  utilityName?: string,
  city?: string,
  ahjId?: string,
): AhjOverlay[] {
  const state = (stateCode || '').toUpperCase();
  const utility = (utilityName || '').toLowerCase();
  const cityLow = (city || '').toLowerCase();

  return AHJ_OVERLAYS.filter(overlay => {
    const { appliesTo } = overlay;

    // State match
    if (appliesTo.stateCodes && appliesTo.stateCodes.length > 0) {
      if (!appliesTo.stateCodes.includes(state)) return false;
    }

    // Utility match (if utility filter specified on overlay)
    if (appliesTo.utilities && appliesTo.utilities.length > 0 && utility) {
      const utilityMatch = appliesTo.utilities.some(u => utility.includes(u.toLowerCase()));
      if (!utilityMatch) return false;
    }

    // City match (if city filter specified)
    if (appliesTo.cities && appliesTo.cities.length > 0) {
      const cityMatch = appliesTo.cities.some(c => cityLow.includes(c.toLowerCase()));
      if (!cityMatch) return false;
    }

    // AHJ ID match
    if (appliesTo.ahjIds && appliesTo.ahjIds.length > 0 && ahjId) {
      const ahjMatch = appliesTo.ahjIds.includes(ahjId);
      if (!ahjMatch) return false;
    }

    return true;
  });
}

/**
 * Apply overlays to a base compliance checklist.
 * Returns the merged checklist with overlay items integrated.
 *
 * @param base     Base compliance checklist from generateComplianceChecklist()
 * @param overlays Overlays returned by getApplicableOverlays()
 */
export function applyAhjOverlays(
  base: ComplianceCheckItem[],
  overlays: AhjOverlay[],
): ComplianceCheckItem[] {
  let result = [...base];

  for (const overlay of overlays) {
    for (const entry of overlay.items) {
      if (entry.action === 'add' && entry.item) {
        // Add new item (avoid duplicates by id)
        const newItem: ComplianceCheckItem = {
          id:           entry.item.id           ?? `overlay_${overlay.id}_${Math.random().toString(36).slice(2)}`,
          category:     entry.item.category     ?? overlay.name,
          requirement:  entry.item.requirement  ?? '',
          necReference: entry.item.necReference ?? overlay.authority,
          required:     entry.item.required     ?? true,
          notes:        entry.item.notes,
        };
        if (!result.find(r => r.id === newItem.id)) {
          result.push(newItem);
        }
      } else if (entry.action === 'modify' && entry.targetId && entry.item) {
        // Modify existing item
        result = result.map(item =>
          item.id === entry.targetId
            ? { ...item, ...entry.item as Partial<ComplianceCheckItem> }
            : item
        );
      } else if (entry.action === 'disable' && entry.targetId) {
        // Remove item from checklist (AHJ doesn't require it)
        result = result.filter(item => item.id !== entry.targetId);
      }
    }
  }

  return result;
}

/**
 * Full AHJ compliance check with overlays applied.
 * Convenience wrapper that:
 *   1. Gets base checklist from AHJ info
 *   2. Finds applicable overlays
 *   3. Merges overlays into checklist
 *   4. Returns augmented checklist + applied overlay IDs
 */
export function getFullComplianceChecklist(params: {
  base: ComplianceCheckItem[];
  stateCode: string;
  utilityName?: string;
  city?: string;
  ahjId?: string;
}): {
  checklist: ComplianceCheckItem[];
  appliedOverlays: string[];
} {
  const overlays = getApplicableOverlays(
    params.stateCode,
    params.utilityName,
    params.city,
    params.ahjId,
  );
  const checklist = applyAhjOverlays(params.base, overlays);
  return {
    checklist,
    appliedOverlays: overlays.map(o => o.id),
  };
}

/**
 * Return a summary of applicable overlay requirements for a given site.
 * Used for quick display in the engineering sidebar.
 */
export function getAhjOverlaySummary(
  stateCode: string,
  utilityName?: string,
  city?: string,
): {
  hasOverlays: boolean;
  overlayNames: string[];
  keyWarnings: string[];
} {
  const overlays = getApplicableOverlays(stateCode, utilityName, city);

  if (overlays.length === 0) {
    return { hasOverlays: false, overlayNames: [], keyWarnings: [] };
  }

  // Extract the highest-priority warning from each overlay (first 'add' item)
  const keyWarnings: string[] = [];
  for (const overlay of overlays) {
    const firstAdd = overlay.items.find(i => i.action === 'add');
    if (firstAdd?.item?.requirement) {
      // Truncate to ~100 chars for display
      const req = firstAdd.item.requirement;
      keyWarnings.push(req.length > 120 ? req.slice(0, 117) + '…' : req);
    }
  }

  return {
    hasOverlays: true,
    overlayNames: overlays.map(o => o.name),
    keyWarnings,
  };
}
