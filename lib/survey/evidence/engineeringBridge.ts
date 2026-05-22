import type { SurveyEvidenceManifest } from './manifest';

export interface SurveyEvidenceEngineeringBridge {
  readiness: 'blocked' | 'needs_review' | 'ready_for_engineering';
  electricalEvidence: string[];
  structuralEvidence: string[];
  roofLayoutEvidence: string[];
  sitePlanEvidence: string[];
  permitWarnings: string[];
  cadAutomationStatus: 'not_started';
}

export function buildSurveyEvidenceEngineeringBridge(
  manifest: SurveyEvidenceManifest | null | undefined,
): SurveyEvidenceEngineeringBridge {
  if (!manifest || manifest.summary.totalItems === 0) {
    return {
      readiness: 'blocked',
      electricalEvidence: [],
      structuralEvidence: [],
      roofLayoutEvidence: [],
      sitePlanEvidence: [],
      permitWarnings: ['No structured survey photo evidence manifest is available.'],
      cadAutomationStatus: 'not_started',
    };
  }

  const byCategory = new Map<string, number>();
  for (const item of manifest.items) {
    byCategory.set(item.category, (byCategory.get(item.category) ?? 0) + 1);
  }

  const electricalEvidence: string[] = [];
  if (byCategory.has('main_service_panel')) electricalEvidence.push('Main service panel photo evidence available for electrical sheet traceability.');
  if (byCategory.has('subpanel')) electricalEvidence.push('Subpanel photo evidence available for electrical review.');
  if (byCategory.has('meter')) electricalEvidence.push('Utility meter photo evidence available for interconnection traceability.');
  if (byCategory.has('disconnect')) electricalEvidence.push('Disconnect location/equipment evidence available for electrical notes.');
  if (byCategory.has('grounding')) electricalEvidence.push('Grounding/bonding photo evidence available for review.');

  const structuralEvidence: string[] = [];
  if (byCategory.has('attic') || byCategory.has('attic_access')) structuralEvidence.push('Attic/access photo evidence available for structural review.');
  if (byCategory.has('rafters')) structuralEvidence.push('Rafter photo evidence available for structural assumptions review.');

  const roofLayoutEvidence: string[] = [];
  if (byCategory.has('roof_plane')) roofLayoutEvidence.push('Roof plane overview evidence available for layout traceability.');
  if (byCategory.has('roof_surface')) roofLayoutEvidence.push('Roof surface detail evidence available for mounting notes.');
  if (byCategory.has('roof_edge')) roofLayoutEvidence.push('Roof edge evidence available for setback/layout review.');
  if (byCategory.has('ridge')) roofLayoutEvidence.push('Ridge evidence available for roof layout review.');
  if (byCategory.has('obstructions')) roofLayoutEvidence.push('Obstruction evidence available for layout warnings.');

  const sitePlanEvidence: string[] = [];
  if (byCategory.has('overview')) sitePlanEvidence.push('Site overview evidence available for site-plan traceability.');
  if (byCategory.has('battery_location')) sitePlanEvidence.push('Battery location evidence available for site-plan notes.');
  if (byCategory.has('inverter_location')) sitePlanEvidence.push('Inverter location evidence available for site-plan notes.');
  if (byCategory.has('gateway_location')) sitePlanEvidence.push('Gateway location evidence available for site-plan notes.');
  if (byCategory.has('trench_path')) sitePlanEvidence.push('Trench path evidence available for site-plan notes.');

  return {
    readiness: manifest.summary.completeness === 'sufficient' ? 'ready_for_engineering' : 'needs_review',
    electricalEvidence,
    structuralEvidence,
    roofLayoutEvidence,
    sitePlanEvidence,
    permitWarnings: manifest.warnings,
    cadAutomationStatus: 'not_started',
  };
}
