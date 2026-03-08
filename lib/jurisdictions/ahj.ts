/**
 * lib/jurisdictions/ahj.ts
 * Authority Having Jurisdiction (AHJ) lookup and interconnection rules.
 */

import { getJurisdiction, getNecRules, type JurisdictionData, type NecRules } from './necVersions';

export interface AhjInfo {
  // Identity
  ahjName: string;
  stateCode: string;
  county: string;
  city: string;
  // NEC
  necVersion: string;
  necRules: NecRules;
  // Jurisdiction data
  jurisdiction: JurisdictionData;
  // Permit
  permitRequired: boolean;
  permitAuthority: string;
  typicalPermitFee: string;
  typicalPermitDays: number;
  // Inspection
  inspectionRequired: boolean;
  inspectionAuthority: string;
  // Interconnection
  interconnectionAuthority: string;
  interconnectionDays: number;
  // Fire / setbacks
  roofSetbackInches: number;
  ridgeSetbackInches: number;
  // Special requirements
  specialRequirements: string[];
  localAmendments: string[];
  // Rapid shutdown
  rapidShutdownRequired: boolean;
  rapidShutdownStandard: string;
}

export interface AhjLookupResult {
  success: boolean;
  ahj?: AhjInfo;
  error?: string;
}

export function lookupAhj(
  stateCode: string,
  county: string,
  city: string,
): AhjLookupResult {
  const jurisdiction = getJurisdiction(stateCode, county, city);
  if (!jurisdiction) {
    return { success: false, error: `No jurisdiction data for state: ${stateCode}` };
  }

  const necRules = getNecRules(jurisdiction.necVersion);

  // Build AHJ name
  let ahjName = '';
  if (city) ahjName = `City of ${city}`;
  else if (county) ahjName = `${county} County`;
  else ahjName = `${jurisdiction.stateName} State`;

  return {
    success: true,
    ahj: {
      ahjName,
      stateCode,
      county,
      city,
      necVersion: `NEC ${jurisdiction.necVersion}`,
      necRules,
      jurisdiction,
      permitRequired: jurisdiction.permitRequired,
      permitAuthority: jurisdiction.permitAuthority,
      typicalPermitFee: jurisdiction.typicalPermitFee,
      typicalPermitDays: jurisdiction.typicalPermitDays,
      inspectionRequired: jurisdiction.inspectionRequired,
      inspectionAuthority: jurisdiction.inspectionAuthority,
      interconnectionAuthority: jurisdiction.interconnectionAuthority,
      interconnectionDays: jurisdiction.interconnectionDays,
      roofSetbackInches: jurisdiction.roofSetbackInches,
      ridgeSetbackInches: jurisdiction.ridgeSetbackInches,
      specialRequirements: jurisdiction.specialRequirements,
      localAmendments: jurisdiction.localAmendments,
      rapidShutdownRequired: jurisdiction.rapidShutdownRequired,
      rapidShutdownStandard: jurisdiction.rapidShutdownStandard,
    },
  };
}

// ── Generate compliance checklist based on AHJ ───────────────────────────────
export interface ComplianceCheckItem {
  id: string;
  category: string;
  requirement: string;
  necReference: string;
  required: boolean;
  notes?: string;
}

export function generateComplianceChecklist(ahj: AhjInfo): ComplianceCheckItem[] {
  const items: ComplianceCheckItem[] = [];
  const nec = ahj.necRules;
  const ver = ahj.necVersion;

  // Rapid Shutdown
  if (nec.rapidShutdown.required) {
    items.push({
      id: 'rsd_required',
      category: 'Rapid Shutdown',
      requirement: `Rapid shutdown device required — system must de-energize within ${nec.rapidShutdown.timeLimit}s`,
      necReference: `NEC 690.12 (${ver})`,
      required: true,
      notes: nec.rapidShutdown.moduleLevel
        ? 'Module-level power electronics (MLPE) or dedicated RSD required'
        : 'Array boundary shutdown acceptable',
    });
  }

  // Arc Fault
  if (nec.arcFault.required) {
    items.push({
      id: 'afci_required',
      category: 'Arc Fault Protection',
      requirement: 'DC arc fault circuit interrupter (AFCI) required',
      necReference: `NEC 690.11 (${ver})`,
      required: nec.arcFault.dcArcFault,
      notes: nec.arcFault.dcArcFault ? 'DC AFCI required per NEC 2020+' : 'AC AFCI may satisfy requirement',
    });
  }

  // Ground Fault
  items.push({
    id: 'gfdi_required',
    category: 'Ground Fault Protection',
    requirement: 'Ground fault detection and interruption (GFDI) required',
    necReference: `NEC 690.5 (${ver})`,
    required: true,
  });

  // DC Labeling
  if (nec.labeling.dcConduitLabels) {
    items.push({
      id: 'dc_labels',
      category: 'Labeling',
      requirement: 'All DC conduit, raceways, and enclosures must be labeled "WARNING: PHOTOVOLTAIC POWER SOURCE"',
      necReference: `NEC 690.31 (${ver})`,
      required: true,
    });
  }

  // Rapid Shutdown Label
  if (nec.labeling.rapidShutdownLabel) {
    items.push({
      id: 'rsd_label',
      category: 'Labeling',
      requirement: 'Rapid shutdown initiation device must be labeled per NEC 690.56',
      necReference: `NEC 690.56 (${ver})`,
      required: true,
    });
  }

  // AC Disconnect
  if (nec.labeling.acDisconnectLabel) {
    items.push({
      id: 'ac_disconnect',
      category: 'Disconnects',
      requirement: 'AC disconnect required within sight of inverter',
      necReference: `NEC 690.15 (${ver})`,
      required: true,
    });
  }

  // Wire Management
  if (nec.wireManagement.conduitRequired) {
    items.push({
      id: 'conduit',
      category: 'Wire Management',
      requirement: 'All DC wiring must be in conduit or use listed PV wire',
      necReference: `NEC 690.31 (${ver})`,
      required: true,
    });
  }

  // Roof setbacks
  items.push({
    id: 'roof_setback',
    category: 'Fire Access',
    requirement: `Roof setback: ${ahj.roofSetbackInches}" from eave/rake edges; ${ahj.ridgeSetbackInches}" from ridge`,
    necReference: 'IFC 605.11 / Local Fire Code',
    required: true,
    notes: `${ahj.ahjName} fire access requirements`,
  });

  // Permit
  if (ahj.permitRequired) {
    items.push({
      id: 'permit',
      category: 'Permitting',
      requirement: `Building/electrical permit required from ${ahj.permitAuthority}`,
      necReference: 'Local Building Code',
      required: true,
      notes: `Typical fee: ${ahj.typicalPermitFee} | Typical timeline: ${ahj.typicalPermitDays} business days`,
    });
  }

  // Interconnection
  items.push({
    id: 'interconnection',
    category: 'Interconnection',
    requirement: `Utility interconnection application required — ${ahj.interconnectionAuthority}`,
    necReference: 'IEEE 1547 / Utility Tariff',
    required: true,
    notes: `Typical timeline: ${ahj.interconnectionDays} days`,
  });

  // Special requirements
  ahj.specialRequirements.forEach((req, i) => {
    items.push({
      id: `special_${i}`,
      category: 'Special Requirements',
      requirement: req,
      necReference: 'Local Requirement',
      required: true,
    });
  });

  return items;
}