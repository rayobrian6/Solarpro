import type { CADModel } from '@/lib/cad/types';
import type { EngineeringSurveyEvidence } from '@/lib/engineering/surveyEvidence';
import type { PermitInput } from '@/lib/permit/types';
import type { DocumentProvenanceBundle, DocumentTruthSource } from '@/lib/documentProvenance/types';
import type { EngineeringRequirementEvaluation, EngineeringRequirementId } from '@/lib/survey/evidence/engineeringRequirements';
import { getEngineeringDecisionDefinition, listEngineeringDecisionDefinitions } from './decisionRegistry';
import { runEngineeringDecisionAuditGuards } from './guards';
import { stableEngineeringStateHash } from '@/lib/engineeringStateInvalidation/hash';
import type {
  BuildEngineeringDecisionProvenanceInput,
  DecisionAwareBOMMetadata,
  DecisionAwareReadinessSummary,
  DecisionAwareSLDMetadata,
  DecisionConfidenceSource,
  EngineeringDecisionEvaluationBundle,
  EngineeringDecisionInputRef,
  EngineeringDecisionProvenanceRecord,
  EngineeringDecisionType,
} from './types';

export function buildEngineeringDecisionProvenanceBundle(
  input: BuildEngineeringDecisionProvenanceInput,
): EngineeringDecisionEvaluationBundle {
  const generatedAt = input.generatedAt ?? new Date(0).toISOString();
  const records = listEngineeringDecisionDefinitions()
    .flatMap(definition => buildDecisionRecord(definition.decisionType, input, generatedAt))
    .sort((a, b) => a.decisionId.localeCompare(b.decisionId));

  const bundle: EngineeringDecisionEvaluationBundle = {
    bundleId: input.bundleId,
    generatedAt,
    decisionRecords: records,
    decisionIds: uniqueSorted(records.map(record => record.decisionId)),
    requirementIds: uniqueSorted(records.flatMap(record => record.requirementIds)) as EngineeringRequirementId[],
    canonicalEvidenceIds: uniqueSorted(records.flatMap(record => record.canonicalEvidenceIds)),
    originatingSurveyIds: uniqueSorted(records.flatMap(record => record.originatingSurveyIds)),
    dependencyNodeIds: uniqueSorted(records.flatMap(record => record.dependencyNodeIds)),
    documentSectionIds: uniqueSorted(records.flatMap(record => record.documentSectionIds)),
    renderContextIds: uniqueSorted(records.flatMap(record => record.renderContextIds)),
    governingRuleIds: uniqueSorted(records.flatMap(record => record.governingRules.map(rule => rule.ruleId))),
    fallbackDecisionIds: uniqueSorted(records.filter(record => isFallback(record)).map(record => record.decisionId)),
    deterministicHash: deterministicDecisionHash(records),
    deterministicNotes: [
      'EngineeringDecisionProvenance v1 explains existing deterministic engineering values and metadata; it does not change sizing or layout logic.',
      'Decision records are sorted by stable decisionId and hashed from stable serialized fields.',
      'Fallback/default values are emitted as explicit decision provenance events instead of hidden assumptions.',
    ],
    auditGuards: [],
  };
  bundle.auditGuards = runEngineeringDecisionAuditGuards(records, { renderOutputExpected: true });
  return bundle;
}

export function buildDecisionAwareReadinessSummary(bundle: EngineeringDecisionEvaluationBundle, opts?: { engineeringStateSnapshot?: import('@/lib/engineeringStateInvalidation').EngineeringStateSnapshotReference | null }): DecisionAwareReadinessSummary {
  return {
    readinessSummaryId: `${bundle.bundleId}.readiness`,
    readinessStatus: bundle.decisionIds.length > 0 ? 'decision_provenance_available' : 'decision_provenance_missing',
    decisionCount: bundle.decisionIds.length,
    fallbackDecisionCount: bundle.fallbackDecisionIds.length,
    confidenceSource: bundle.fallbackDecisionIds.length > 0 ? 'explicit_default_policy_v1' : 'engineering_decision_registry_v1',
    decisionIds: bundle.decisionIds,
    fallbackDecisionIds: bundle.fallbackDecisionIds,
    governingRuleIds: bundle.governingRuleIds,
    canonicalEvidenceIds: bundle.canonicalEvidenceIds,
    deterministicNotes: [
      'Readiness summary references decision provenance bundle ids only; UI text must not manufacture reasoning outside records.',
      `${bundle.decisionIds.length} decision(s) and ${bundle.fallbackDecisionIds.length} fallback/default event(s) are available for readiness display.`,
    ],
    engineeringStateIds: bundle.decisionIds.map(id => `state:decision:${id}`).sort((a, b) => a.localeCompare(b)),
    stateGenerationHash: stableEngineeringStateHash('decision-readiness-generation', bundle.decisionIds),
    stateDependencyHash: stableEngineeringStateHash('decision-readiness-dependency', bundle.dependencyNodeIds),
    engineeringStateSnapshot: opts?.engineeringStateSnapshot ?? undefined,
  };
}

export function buildDecisionAwareBOMMetadata(input: {
  bomItems?: PermitInput['bom'] | null;
  decisionBundle?: EngineeringDecisionEvaluationBundle | null;
  engineeringStateSnapshot?: import('@/lib/engineeringStateInvalidation').EngineeringStateSnapshotReference | null;
}): DecisionAwareBOMMetadata[] {
  const bomItems = input.bomItems ?? [];
  const bundle = input.decisionBundle ?? null;
  const bomDecisionIds = bundle?.decisionRecords
    .filter(record => record.decisionType === 'bom_derivation' || record.engineeringDomain === 'bom')
    .map(record => record.decisionId) ?? [];
  const ruleIds = uniqueSorted(bundle?.decisionRecords
    .filter(record => record.decisionType === 'bom_derivation' || record.engineeringDomain === 'bom')
    .flatMap(record => record.governingRules.map(rule => rule.ruleId)) ?? []);
  const dependencyIds = uniqueSorted(bundle?.decisionRecords
    .filter(record => record.decisionType === 'bom_derivation' || record.engineeringDomain === 'bom')
    .flatMap(record => record.dependencyNodeIds) ?? []);

  return bomItems.map((item, index) => ({
    bomRowId: item.id ?? `bom-row-${String(index + 1).padStart(3, '0')}`,
    decisionIds: bomDecisionIds,
    governingRuleIds: ruleIds,
    dependencyNodeIds: dependencyIds,
    derivedFrom: uniqueSorted([item.derivedFrom, item.formula, item.necReference].filter(Boolean) as string[]),
    engineeringStateIds: [item.id ?? `bom-row-${String(index + 1).padStart(3, '0')}`].map(id => `state:bomRow:${id}`),
    stateGenerationHash: stableEngineeringStateHash('bom-row-generation', [item.id ?? `bom-row-${String(index + 1).padStart(3, '0')}`, ...bomDecisionIds]),
    stateDependencyHash: stableEngineeringStateHash('bom-row-dependency', dependencyIds),
    engineeringStateSnapshot: input.engineeringStateSnapshot ?? undefined,
  }));
}

export function buildDecisionAwareSLDMetadata(input: {
  decisionBundle?: EngineeringDecisionEvaluationBundle | null;
  engineeringStateSnapshot?: import('@/lib/engineeringStateInvalidation').EngineeringStateSnapshotReference | null;
}): DecisionAwareSLDMetadata {
  const bundle = input.decisionBundle ?? null;
  const sldRecords = bundle?.decisionRecords.filter(record =>
    record.engineeringDomain === 'sld'
    || record.documentSectionIds.some(sectionId => sectionId.startsWith('SLD.')),
  ) ?? [];
  const topology = sldRecords.find(record => record.decisionType === 'string_topology_selection');
  const interconnection = sldRecords.find(record => record.decisionType === 'utility_interconnection_assumption');
  return {
    sldMetadataId: `${bundle?.bundleId ?? 'decision-bundle-missing'}.sld`,
    decisionIds: uniqueSorted(sldRecords.map(record => record.decisionId)),
    governingRuleIds: uniqueSorted(sldRecords.flatMap(record => record.governingRules.map(rule => rule.ruleId))),
    dependencyNodeIds: uniqueSorted(sldRecords.flatMap(record => record.dependencyNodeIds)),
    fallbackDecisionIds: uniqueSorted(sldRecords.filter(record => record.decisionCategory === 'fallback_default').map(record => record.decisionId)),
    deterministicHash: bundle?.deterministicHash ?? 'decision-bundle-missing',
    topologyDecisionId: topology?.decisionId,
    interconnectionDecisionId: interconnection?.decisionId,
    engineeringStateIds: [`state:sldSection:${bundle?.bundleId ?? 'decision-bundle-missing'}.sld`],
    stateGenerationHash: stableEngineeringStateHash('sld-metadata-generation', sldRecords.map(record => record.decisionId)),
    stateDependencyHash: stableEngineeringStateHash('sld-metadata-dependency', sldRecords.flatMap(record => record.dependencyNodeIds)),
    engineeringStateSnapshot: input.engineeringStateSnapshot ?? undefined,
  };
}

function buildDecisionRecord(
  decisionType: EngineeringDecisionType,
  input: BuildEngineeringDecisionProvenanceInput,
  generatedAt: string,
): EngineeringDecisionProvenanceRecord[] {
  const definition = getEngineeringDecisionDefinition(decisionType);
  const context = buildContext(input);
  if (decisionType === 'ess_placement' && !hasEssInputs(input.permitInput ?? null)) {
    return [];
  }

  const selected = selectedValueForDecision(decisionType, input);
  const alternatives = alternativesForDecision(decisionType, input, selected.value);
  const fallback = selected.usedFallback || selected.value === null;
  const requirementIds = requirementIdsForDecision(decisionType, context);
  const canonicalEvidenceIds = uniqueSorted(requirementIds.flatMap(requirementId => context.evaluationByRequirement.get(requirementId)?.canonicalEvidenceIds ?? []));
  const originatingSurveyIds = uniqueSorted(requirementIds.flatMap(requirementId => context.evaluationByRequirement.get(requirementId)?.originatingSurveyIds.filter(Boolean) ?? []));
  const documentSectionIds = uniqueSorted(definition.affectedDocumentSectionIds.filter(sectionId =>
    context.documentSectionIds.size === 0 || context.documentSectionIds.has(sectionId) || sectionId.startsWith('BOM.') || sectionId.startsWith('ESS-'),
  ));
  const dependencyNodeIds = uniqueSorted([
    ...definition.engineeringDependencies,
    ...requirementIds.map(requirementId => `requirement:${requirementId}`),
    ...canonicalEvidenceIds.map(evidenceId => `canonicalEvidence:${evidenceId}`),
    ...documentSectionIds.map(sectionId => `documentSection:${sectionId}`),
  ]);
  const confidenceSource = resolveConfidenceSource(input, fallback);
  const truthSource = resolveTruthSource(input);
  const decisionInputs = decisionInputsForDefinition(definition.requiredInputs, definition.optionalInputs, input, selected, confidenceSource);

  return [{
    decisionId: `decision:${decisionType}`,
    decisionType,
    decisionCategory: fallback ? 'fallback_default' : definition.decisionCategory,
    engineeringDomain: definition.engineeringDomain,
    selectedValue: selected.value,
    alternativeValuesConsidered: alternatives,
    decisionReason: selected.reason,
    decisionInputs,
    requirementIds,
    canonicalEvidenceIds,
    originatingSurveyIds,
    dependencyNodeIds,
    documentSectionIds,
    renderContextIds: input.renderContextIds?.length ? uniqueSorted(input.renderContextIds) : ['renderContext:primary'],
    governingRules: definition.governingRules,
    equipmentConstraints: equipmentConstraintsForDecision(decisionType, input),
    utilityConstraints: utilityConstraintsForDecision(decisionType, input),
    geometryAssumptions: geometryAssumptionsForDecision(decisionType, input),
    confidenceSource,
    truthSource,
    derivedFrom: uniqueSorted([
      ...definition.requiredInputs,
      ...definition.optionalInputs.filter(key => hasInputValue(key, input)),
      input.documentProvenance ? 'DocumentProvenanceBundle' : '',
      input.surveyEvidence ? 'EngineeringSurveyEvidence' : '',
    ].filter(Boolean)),
    deterministicNotes: [
      ...definition.deterministicEvaluationNotes,
      fallback
        ? `Fallback/default surfaced explicitly by ${definition.missingInputBehavior}.`
        : 'Selected value is sourced from existing deterministic permit/CAD/system metadata.',
      'No new engineering sizing result is computed by this decision provenance record.',
    ],
    generatedAt,
  }];
}

function buildContext(input: BuildEngineeringDecisionProvenanceInput): {
  evaluationByRequirement: Map<EngineeringRequirementId, EngineeringRequirementEvaluation>;
  documentSectionIds: Set<string>;
} {
  const evaluations = input.surveyEvidence?.requirementEvaluation.allRequirements ?? [];
  return {
    evaluationByRequirement: new Map(evaluations.map(evaluation => [evaluation.requirementId, evaluation])),
    documentSectionIds: new Set(input.documentProvenance?.sections.map(section => section.sectionId) ?? []),
  };
}

function selectedValueForDecision(decisionType: EngineeringDecisionType, input: BuildEngineeringDecisionProvenanceInput): {
  value: string | number | boolean | null;
  usedFallback: boolean;
  reason: string;
} {
  const permit = input.permitInput ?? null;
  const project = permit?.project as Record<string, any> | undefined;
  const system = permit?.system;
  const firstInverter = system?.inverters?.[0] as Record<string, any> | undefined;
  const firstString = firstInverter?.strings?.[0] as Record<string, any> | undefined;
  const cad = input.cad ?? null;
  switch (decisionType) {
    case 'conductor_sizing':
      return selected(firstString?.wireGauge ?? project?.wireGauge ?? '#10 AWG', firstString?.wireGauge == null && project?.wireGauge == null, 'Existing conductor gauge metadata selected from string or project input.');
    case 'breaker_sizing': {
      const fallback = Math.ceil((((system?.totalAcKw ?? 0) * 1000 / 240) || 32) * 1.25 / 5) * 5;
      return selected(project?.backfeedBreakerA ?? project?.pvBackfeedA ?? fallback, project?.backfeedBreakerA == null && project?.pvBackfeedA == null, 'Existing breaker value selected from project input or documented deterministic fallback.');
    }
    case 'ocpd_selection':
      return selected(firstString?.ocpd ?? project?.backfeedBreakerA ?? 20, firstString?.ocpd == null && project?.backfeedBreakerA == null, 'Existing OCPD metadata selected from string/project input or explicit default.');
    case 'string_topology_selection':
      return selected(system?.topology ?? firstInverter?.type ?? 'string', system?.topology == null && firstInverter?.type == null, 'Existing topology metadata selected from system/inverter input.');
    case 'mppt_assignment':
      return selected(firstInverter?.mpptChannels ?? (String(system?.topology ?? '').toLowerCase() === 'micro' ? cad?.totalPanels ?? system?.totalPanels ?? null : 2), firstInverter?.mpptChannels == null, 'Existing MPPT channel metadata selected, with explicit topology default when missing.');
    case 'inverter_selection':
      return selected([firstInverter?.manufacturer, firstInverter?.model].filter(Boolean).join(' ') || 'Inverter review required', !firstInverter?.model, 'Existing inverter identity selected from system input.');
    case 'ess_placement':
      return selected(project?.batteryModel ?? 'ESS not present', !project?.batteryModel, 'ESS placement metadata selected only when ESS inputs are present.');
    case 'rapid_shutdown_placement':
      return selected(Boolean(project?.rapidShutdown), project?.rapidShutdown == null, 'Rapid shutdown status selected from permit project input.');
    case 'utility_interconnection_assumption':
      return selected(project?.interconnectionMethod ?? 'LOAD_SIDE', project?.interconnectionMethod == null, 'Interconnection method selected from project input or explicit load-side default.');
    case 'setback_assumption':
      return selected(project?.ahjRoofSetbackIn ?? cad?.roof?.setbackIn ?? 18, project?.ahjRoofSetbackIn == null && cad?.roof?.setbackIn == null, 'Setback value selected from AHJ/project/CAD metadata or explicit default.');
    case 'conduit_routing_assumption':
      return selected(`${project?.conduitType ?? 'EMT'} / ${project?.wireLength ?? 60} ft`, project?.conduitType == null || project?.wireLength == null, 'Conduit routing metadata selected from project input or explicit defaults.');
    case 'grounding_bonding_assumption':
      return selected(`${project?.conduitType ?? 'EMT'} grounding/bonding notes`, project?.conduitType == null, 'Grounding/bonding note provenance selected from wiring method metadata.');
    case 'placard_requirement':
      return selected(`PV placards for ${system?.totalDcKw ?? 0} kW DC / rapid shutdown ${Boolean(project?.rapidShutdown)}`, system?.totalDcKw == null, 'Placard requirement metadata selected from project/system inputs.');
    case 'layout_orientation_assumption': {
      const orientation = project?.panelPositions?.find((panel: any) => panel.orientation)?.orientation ?? project?.roofPlanes?.find((plane: any) => plane.azimuth)?.azimuth ?? cad?.systemType ?? 'unknown';
      return selected(orientation, orientation === 'unknown', 'Layout orientation metadata selected from panel/roof/CAD fields.');
    }
    case 'bom_derivation':
      return selected(`${permit?.bom?.length ?? 0} BOM row(s)`, !permit?.bom?.length, 'BOM provenance summarizes existing BOM rows and metadata.');
    case 'sld_metadata':
      return selected(`${system?.topology ?? firstInverter?.type ?? 'string'} / ${project?.interconnectionMethod ?? 'LOAD_SIDE'}`, system?.topology == null || project?.interconnectionMethod == null, 'SLD metadata selected from existing topology and interconnection fields.');
  }
}

function selected(value: string | number | boolean | null, usedFallback: boolean, reason: string) {
  return { value, usedFallback, reason };
}

function alternativesForDecision(
  decisionType: EngineeringDecisionType,
  input: BuildEngineeringDecisionProvenanceInput,
  selectedValue: string | number | boolean | null,
): EngineeringDecisionProvenanceRecord['alternativeValuesConsidered'] {
  const project = input.permitInput?.project as Record<string, any> | undefined;
  const system = input.permitInput?.system;
  const alternatives: EngineeringDecisionProvenanceRecord['alternativeValuesConsidered'] = [];
  if (decisionType === 'string_topology_selection') {
    for (const value of ['micro', 'optimizer', 'string']) {
      if (value !== selectedValue) alternatives.push({ value, rejectedReason: 'Existing system topology field selected a different deterministic topology.' });
    }
  } else if (decisionType === 'utility_interconnection_assumption') {
    for (const value of ['LOAD_SIDE', 'SUPPLY_SIDE_TAP', 'LINE_SIDE_TAP']) {
      if (value !== selectedValue) alternatives.push({ value, rejectedReason: 'Existing project interconnection method selected a different deterministic value.' });
    }
  } else if (decisionType === 'breaker_sizing') {
    for (const value of [project?.backfeedBreakerA, project?.pvBackfeedA, system?.totalAcKw ? Math.ceil((system.totalAcKw * 1000 / 240) * 1.25 / 5) * 5 : null].filter(v => v != null)) {
      if (value !== selectedValue) alternatives.push({ value, rejectedReason: 'Higher-priority existing breaker input or fallback policy selected another value.' });
    }
  }
  return alternatives.sort((a, b) => String(a.value).localeCompare(String(b.value)));
}

function decisionInputsForDefinition(
  required: string[],
  optional: string[],
  input: BuildEngineeringDecisionProvenanceInput,
  selected: { value: string | number | boolean | null; usedFallback: boolean },
  confidenceSource: DecisionConfidenceSource,
): EngineeringDecisionInputRef[] {
  const refs: EngineeringDecisionInputRef[] = [
    {
      inputKey: 'selectedValue',
      inputValue: selected.value,
      source: confidenceSource,
      deterministicRole: 'selected_value',
    },
  ];
  for (const key of required) {
    refs.push({
      inputKey: key,
      inputValue: summarizeInputValue(key, input),
      source: sourceForInputKey(key, input),
      deterministicRole: selected.usedFallback && !hasInputValue(key, input) ? 'fallback_default' : 'constraint',
    });
  }
  for (const key of optional.filter(key => hasInputValue(key, input)).slice(0, 8)) {
    refs.push({
      inputKey: key,
      inputValue: summarizeInputValue(key, input),
      source: sourceForInputKey(key, input),
      deterministicRole: 'metadata',
    });
  }
  return refs;
}

function requirementIdsForDecision(
  decisionType: EngineeringDecisionType,
  context: { evaluationByRequirement: Map<EngineeringRequirementId, EngineeringRequirementEvaluation> },
): EngineeringRequirementId[] {
  const byDecision: Partial<Record<EngineeringDecisionType, EngineeringRequirementId[]>> = {
    conductor_sizing: ['main_service_panel'],
    breaker_sizing: ['main_service_panel', 'utility_meter'],
    ocpd_selection: ['main_service_panel'],
    string_topology_selection: ['roof_overview', 'main_service_panel'],
    mppt_assignment: ['roof_overview'],
    inverter_selection: ['main_service_panel'],
    ess_placement: ['battery_location'],
    rapid_shutdown_placement: ['rapid_shutdown'],
    utility_interconnection_assumption: ['utility_meter', 'main_service_panel'],
    setback_assumption: ['roof_overview'],
    conduit_routing_assumption: ['main_service_panel', 'utility_meter'],
    grounding_bonding_assumption: ['main_service_panel', 'service_equipment_label'],
    placard_requirement: ['placards', 'rapid_shutdown'],
    layout_orientation_assumption: ['roof_overview'],
    bom_derivation: ['main_service_panel', 'roof_overview'],
    sld_metadata: ['main_service_panel', 'utility_meter', 'rapid_shutdown'],
  };
  return uniqueSorted((byDecision[decisionType] ?? []).filter(requirementId =>
    context.evaluationByRequirement.size === 0 || context.evaluationByRequirement.has(requirementId),
  )) as EngineeringRequirementId[];
}

function equipmentConstraintsForDecision(decisionType: EngineeringDecisionType, input: BuildEngineeringDecisionProvenanceInput): string[] {
  const inverter = input.permitInput?.system?.inverters?.[0];
  const constraints = [
    inverter?.manufacturer && inverter?.model ? `inverter:${inverter.manufacturer}:${inverter.model}` : '',
    inverter?.maxDcVoltage ? `maxDcVoltage:${inverter.maxDcVoltage}` : '',
    input.permitInput?.system?.topology ? `topology:${input.permitInput.system.topology}` : '',
  ].filter(Boolean) as string[];
  return ['inverter_selection', 'string_topology_selection', 'mppt_assignment', 'sld_metadata'].includes(decisionType) ? uniqueSorted(constraints) : [];
}

function utilityConstraintsForDecision(decisionType: EngineeringDecisionType, input: BuildEngineeringDecisionProvenanceInput): string[] {
  if (!['utility_interconnection_assumption', 'breaker_sizing', 'sld_metadata'].includes(decisionType)) return [];
  const project = input.permitInput?.project as Record<string, any> | undefined;
  return uniqueSorted([
    project?.utilityName ? `utility:${project.utilityName}` : '',
    project?.mainPanelAmps ? `mainPanel:${project.mainPanelAmps}A` : '',
    project?.panelBusRating ? `busbar:${project.panelBusRating}A` : '',
    project?.interconnectionMethod ? `interconnection:${project.interconnectionMethod}` : '',
  ].filter(Boolean) as string[]);
}

function geometryAssumptionsForDecision(decisionType: EngineeringDecisionType, input: BuildEngineeringDecisionProvenanceInput): string[] {
  if (!['setback_assumption', 'layout_orientation_assumption', 'conduit_routing_assumption'].includes(decisionType)) return [];
  return uniqueSorted([
    input.cad?.systemType ? `cad.systemType:${input.cad.systemType}` : '',
    input.cad?.roof?.setbackIn ? `cad.roof.setbackIn:${input.cad.roof.setbackIn}` : '',
    input.cad?.totalPanels ? `cad.totalPanels:${input.cad.totalPanels}` : '',
    input.surveyEvidence?.fieldEvidence?.hasRoofGeometry ? 'survey.fieldEvidence.hasRoofGeometry:true' : 'survey.fieldEvidence.hasRoofGeometry:false',
  ].filter(Boolean));
}

function resolveConfidenceSource(input: BuildEngineeringDecisionProvenanceInput, fallback: boolean): DecisionConfidenceSource {
  if (fallback) return 'explicit_default_policy_v1';
  if (input.documentProvenance) return 'document_provenance_bundle_v1';
  if (input.surveyEvidence?.evidenceTruthSource === 'canonical_manifest_v1') return 'canonical_manifest_v1';
  if (input.permitInput) return 'permit_input_canonical';
  return 'legacy_design_input';
}

function resolveTruthSource(input: BuildEngineeringDecisionProvenanceInput): DocumentTruthSource {
  return input.documentProvenance?.truthSource
    ?? input.surveyEvidence?.evidenceTruthSource
    ?? (input.permitInput ? 'permit_input_canonical' : 'legacy_design_input');
}

function sourceForInputKey(key: string, input: BuildEngineeringDecisionProvenanceInput): DecisionConfidenceSource {
  if (key.startsWith('system.') || key.startsWith('project.') || key.startsWith('input.bom')) return 'permit_input_canonical';
  if (key.startsWith('cad.')) return 'document_provenance_bundle_v1';
  if (key.includes('requirement')) return 'engineering_requirement_registry_v1';
  if (input.surveyEvidence?.evidenceTruthSource === 'canonical_manifest_v1') return 'canonical_manifest_v1';
  return 'engineering_decision_registry_v1';
}

function summarizeInputValue(key: string, input: BuildEngineeringDecisionProvenanceInput): string | number | boolean | null {
  const permit = input.permitInput ?? null;
  const project = permit?.project as Record<string, any> | undefined;
  const system = permit?.system;
  const inverter = system?.inverters?.[0] as Record<string, any> | undefined;
  const string = inverter?.strings?.[0] as Record<string, any> | undefined;
  if (key.includes('wireGauge')) return string?.wireGauge ?? project?.wireGauge ?? null;
  if (key.includes('isc')) return string?.isc ?? string?.panelIsc ?? project?.panelIsc ?? null;
  if (key.includes('ampacity')) return string?.ampacity ?? null;
  if (key.includes('ocpd')) return string?.ocpd ?? null;
  if (key.includes('backfeedBreakerA')) return project?.backfeedBreakerA ?? null;
  if (key.includes('pvBackfeedA')) return project?.pvBackfeedA ?? null;
  if (key.includes('totalAcKw')) return system?.totalAcKw ?? null;
  if (key.includes('totalDcKw')) return system?.totalDcKw ?? null;
  if (key.includes('topology')) return system?.topology ?? inverter?.type ?? null;
  if (key.includes('inverters[].manufacturer')) return inverter?.manufacturer ?? null;
  if (key.includes('inverters[].model')) return inverter?.model ?? null;
  if (key.includes('inverters[].acOutputKw')) return inverter?.acOutputKw ?? null;
  if (key.includes('mpptChannels')) return inverter?.mpptChannels ?? null;
  if (key.includes('batteryModel')) return project?.batteryModel ?? null;
  if (key.includes('batteryCount')) return project?.batteryCount ?? null;
  if (key.includes('batteryKwh')) return project?.batteryKwh ?? null;
  if (key.includes('rapidShutdown')) return project?.rapidShutdown ?? null;
  if (key.includes('interconnectionMethod')) return project?.interconnectionMethod ?? null;
  if (key.includes('utilityName')) return project?.utilityName ?? null;
  if (key.includes('mainPanelAmps')) return project?.mainPanelAmps ?? null;
  if (key.includes('panelBusRating')) return project?.panelBusRating ?? null;
  if (key.includes('ahjRoofSetbackIn')) return project?.ahjRoofSetbackIn ?? null;
  if (key.includes('ahjRidgeSetbackIn')) return project?.ahjRidgeSetbackIn ?? null;
  if (key.includes('cad.roof.setbackIn')) return input.cad?.roof?.setbackIn ?? null;
  if (key.includes('conduitType')) return project?.conduitType ?? null;
  if (key.includes('wireLength')) return project?.wireLength ?? null;
  if (key.includes('panelPositions')) return project?.panelPositions?.length ?? null;
  if (key.includes('roofPlanes')) return project?.roofPlanes?.length ?? null;
  if (key.includes('input.bom')) return permit?.bom?.length ?? 0;
  if (key.includes('cad.totalPanels')) return input.cad?.totalPanels ?? null;
  if (key.includes('cad.systemType')) return input.cad?.systemType ?? null;
  return null;
}

function hasInputValue(key: string, input: BuildEngineeringDecisionProvenanceInput): boolean {
  const value = summarizeInputValue(key, input);
  return value !== null && value !== undefined && value !== '';
}

function hasEssInputs(permit: PermitInput | null): boolean {
  const project = permit?.project as Record<string, any> | undefined;
  return Boolean(project?.batteryModel || project?.batteryCount || project?.batteryKwh);
}

function isFallback(record: EngineeringDecisionProvenanceRecord): boolean {
  return record.decisionCategory === 'fallback_default'
    || record.decisionInputs.some(input => input.deterministicRole === 'fallback_default');
}

function deterministicDecisionHash(records: EngineeringDecisionProvenanceRecord[]): string {
  const payload = JSON.stringify(records.map(record => ({
    decisionId: record.decisionId,
    selectedValue: record.selectedValue,
    requirementIds: record.requirementIds,
    canonicalEvidenceIds: record.canonicalEvidenceIds,
    dependencyNodeIds: record.dependencyNodeIds,
    documentSectionIds: record.documentSectionIds,
    ruleIds: record.governingRules.map(rule => rule.ruleId),
    confidenceSource: record.confidenceSource,
    truthSource: record.truthSource,
  })));
  let hash = 5381;
  for (let i = 0; i < payload.length; i += 1) {
    hash = ((hash << 5) + hash) + payload.charCodeAt(i);
    hash >>>= 0;
  }
  return `decision-${hash.toString(16).padStart(8, '0')}`;
}

function uniqueSorted<T extends string>(values: Array<T | null | undefined>): T[] {
  return Array.from(new Set(values.filter(Boolean) as T[])).sort((a, b) => a.localeCompare(b));
}
